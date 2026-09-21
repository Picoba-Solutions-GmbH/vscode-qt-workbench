'use strict';

/**
 * One TCP connection to the QML debug server of a Qt application started with
 * -qmljsdebugger=host:...,port:...: the packet framing, the QDeclarativeDebugServer
 * handshake, and routing messages to and from the service clients added before connecting.
 *
 * A packet is a little-endian int32 size (counting itself) followed by a QDataStream
 * body. The client says hello first, naming the services it wants; the server answers
 * with the services it has. From then on every packet is a service name followed by one
 * or more QByteArray messages for it. The server accepts one client at a time.
 */

const net = require('net');
const { EventEmitter } = require('events');
const { DataReader, DataWriter } = require('./data-stream');

const SERVER_ID = 'QDeclarativeDebugServer';
const CLIENT_ID = 'QDeclarativeDebugClient';
const PROTOCOL_VERSION = 1;
// QDataStream::Qt_4_7, what the server starts with. Every message hot reload sends is
// encoded the same way in all later versions.
const DATA_STREAM_VERSION = 12;
const HELLO_TIMEOUT_MS = 5000;

function frame(body) {
  const size = Buffer.alloc(4);
  size.writeInt32LE(body.length + 4);
  return Buffer.concat([size, body]);
}

class QmlDebugConnection extends EventEmitter {
  constructor() {
    super();
    this.services = new Map(); // name -> client with messageReceived(buffer)
    this.serverServices = new Map(); // name -> version
    this.socket = null;
    this.pending = Buffer.alloc(0);
    this.connected = false;
  }

  addService(client) {
    this.services.set(client.name, client);
    client.connection = this;
  }

  /**
   * Connect and say hello. Resolves once the server has answered, with the services it
   * offers; rejects when nothing listens there, or what does never answers like a QML
   * debug server. Emits 'close' when an established connection ends.
   */
  connect(host, port) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = net.connect({ host, port });
      this.socket = socket;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('no answer to the QML debug hello')), HELLO_TIMEOUT_MS);

      socket.setNoDelay(true);
      socket.on('connect', () => {
        const hello = new DataWriter()
          .string(SERVER_ID)
          .int32(0)
          .int32(PROTOCOL_VERSION)
          .stringList([...this.services.keys()])
          .int32(DATA_STREAM_VERSION)
          .bool(true) // we accept several messages per packet
          .toBuffer();
        socket.write(frame(hello));
      });
      socket.on('data', (chunk) => {
        try {
          this.receive(chunk);
        } catch (err) {
          if (!settled) fail(err);
          else this.close();
          return;
        }
        if (this.connected && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(this.serverServices);
        }
      });
      socket.on('error', fail);
      socket.on('close', () => {
        fail(new Error('connection closed before the QML debug hello'));
        const wasConnected = this.connected;
        this.connected = false;
        if (this.socket === socket) this.socket = null;
        if (wasConnected) this.emit('close');
      });
    });
  }

  receive(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length >= 4) {
      const size = this.pending.readInt32LE(0);
      if (size < 4) throw new Error('invalid QML debug packet size ' + size);
      if (this.pending.length < size) break;
      const body = this.pending.subarray(4, size);
      this.pending = this.pending.subarray(size);
      this.dispatch(new DataReader(body));
    }
  }

  dispatch(reader) {
    const name = reader.string();
    if (name === CLIENT_ID) {
      const op = reader.int32();
      if (op === 0) {
        if (reader.int32() !== PROTOCOL_VERSION) throw new Error('unsupported QML debug protocol version');
        this.readServices(reader);
        this.connected = true;
      } else if (op === 1) {
        this.readServices(reader);
      }
      return;
    }
    const client = this.services.get(name);
    if (!client) return;
    while (!reader.atEnd()) client.messageReceived(reader.bytes());
  }

  readServices(reader) {
    const names = reader.stringList();
    const versions = reader.atEnd() ? [] : reader.doubleList();
    this.serverServices = new Map(names.map((n, i) => [n, versions[i] || 1]));
  }

  send(serviceName, message) {
    if (!this.socket || !this.connected) return false;
    this.socket.write(frame(new DataWriter().string(serviceName).bytes(message).toBuffer()));
    return true;
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

module.exports = { QmlDebugConnection };
