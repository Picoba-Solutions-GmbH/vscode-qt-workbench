'use strict';
// Stands in for a Qt application started with -qmljsdebugger=...,services:QmlPreview:
// the QML debug server's side of the handshake and of the QmlPreview service, as
// QQmlDebugServerImpl and QQmlPreviewServiceImpl speak them. The encoding is written out
// by hand here rather than borrowed from the extension, so a mistake there shows.
//
// Hot reload was checked against a real Qt 6.11 application; this fake reproduces what
// it was seen to do, so the tests can run anywhere.

const net = require('net');

const PREVIEW = { File: 0, Load: 1, Request: 2, Error: 3, Rerun: 4, Directory: 5, ClearCache: 6 };

function qstring(s) {
  const utf16 = Buffer.from(s, 'utf16le').swap16();
  const size = Buffer.alloc(4);
  size.writeUInt32BE(utf16.length);
  return Buffer.concat([size, utf16]);
}

function qbytes(b) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(b.length);
  return Buffer.concat([size, b]);
}

function int32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
}

function packet(body) {
  const size = Buffer.alloc(4);
  size.writeInt32LE(body.length + 4);
  return Buffer.concat([size, body]);
}

class Reader {
  constructor(b) { this.b = b; this.at = 0; }
  atEnd() { return this.at >= this.b.length; }
  int8() { return this.b.readInt8(this.at++); }
  int32() { const v = this.b.readInt32BE(this.at); this.at += 4; return v; }
  uint32() { const v = this.b.readUInt32BE(this.at); this.at += 4; return v; }
  bytes() { const n = this.uint32(); const v = this.b.subarray(this.at, this.at + n); this.at += n; return v; }
  string() { return Buffer.from(this.bytes()).swap16().toString('utf16le'); }
  strings() { const n = this.uint32(); const v = []; for (let i = 0; i < n; i++) v.push(this.string()); return v; }
}

class FakeQmlApp {
  constructor(services = ['QmlPreview', 'DebugTranslation']) {
    this.services = services;
    this.received = []; // what the client sent to the preview service, oldest first
    this.clientServices = null;
    this.connected = false;
    this.connections = 0;
    this.socket = null;
    this.waiters = [];
  }

  listen() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => this.accept(socket));
      this.server.listen(0, '127.0.0.1', () => resolve(this.server.address().port));
    });
  }

  accept(socket) {
    if (this.socket) { // QQmlDebugServer takes one client at a time
      socket.destroy();
      return;
    }
    this.socket = socket;
    this.connections++;
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= pending.readInt32LE(0)) {
        const size = pending.readInt32LE(0);
        this.dispatch(new Reader(pending.subarray(4, size)));
        pending = pending.subarray(size);
      }
    });
    socket.on('close', () => {
      this.socket = null;
      this.connected = false;
      this.notify();
    });
    socket.on('error', () => {});
  }

  dispatch(r) {
    const name = r.string();
    if (name === 'QDeclarativeDebugServer') {
      if (r.int32() !== 0) return;
      r.int32(); // protocol version
      this.clientServices = r.strings();
      const versions = Buffer.concat([int32(this.services.length), ...this.services.map(() => { const d = Buffer.alloc(8); d.writeDoubleBE(1); return d; })]);
      const names = Buffer.concat([int32(this.services.length), ...this.services.map(qstring)]);
      this.socket.write(packet(Buffer.concat([qstring('QDeclarativeDebugClient'), int32(0), int32(1), names, versions, int32(12)])));
      this.connected = true;
    } else if (name === 'QmlPreview') {
      const m = new Reader(r.bytes());
      const command = m.int8();
      if (command === PREVIEW.File) this.received.push({ command: 'FILE', path: m.string(), contents: Buffer.from(m.bytes()) });
      else if (command === PREVIEW.Directory) this.received.push({ command: 'DIRECTORY', path: m.string(), entries: m.strings() });
      else if (command === PREVIEW.Error) this.received.push({ command: 'ERROR', path: m.string() });
      else if (command === PREVIEW.Load) this.received.push({ command: 'LOAD', url: m.bytes().toString('utf8') });
      else this.received.push({ command: 'COMMAND ' + command });
    }
    this.notify();
  }

  notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** Resolves once `test()` holds, or with false after `ms`. */
  waitFor(test, ms = 5000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      const check = () => {
        if (test()) {
          clearTimeout(timer);
          resolve(true);
        } else this.waiters.push(check);
      };
      check();
    });
  }

  /** What the engine does when it reads a file: ask, and wait for the answer to that path. */
  async request(path) {
    const from = this.received.length;
    this.socket.write(packet(Buffer.concat([qstring('QmlPreview'), qbytes(Buffer.concat([Buffer.from([PREVIEW.Request]), qstring(path)]))])));
    const answered = () => this.received.slice(from).find((m) => m.path === path && m.command !== 'LOAD');
    await this.waitFor(() => !!answered());
    return answered() || { command: 'NO ANSWER', path };
  }

  /** A load error, as QQmlPreviewHandler reports one. */
  reportError(message) {
    this.socket.write(packet(Buffer.concat([qstring('QmlPreview'), qbytes(Buffer.concat([Buffer.from([PREVIEW.Error]), qstring(message)]))])));
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.server.close();
  }
}

/** One line per message, as the tests compare them. A file shows its first line. */
function describe(m) {
  if (m.command === 'FILE') return 'FILE ' + m.path + ' "' + m.contents.toString('utf8').split(/\r?\n/)[0] + '"';
  if (m.command === 'DIRECTORY') return 'DIRECTORY ' + m.path + ' [' + m.entries.join(',') + ']';
  if (m.command === 'ERROR') return 'ERROR ' + m.path;
  if (m.command === 'LOAD') return 'LOAD ' + m.url;
  return m.command + ' ' + (m.path || '');
}

module.exports = { FakeQmlApp, describe };
