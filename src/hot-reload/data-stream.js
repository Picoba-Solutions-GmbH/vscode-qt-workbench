'use strict';

/**
 * Just enough QDataStream to talk to Qt's QML debug services: big-endian integers, bool,
 * double, QString (UTF-16), QByteArray, QStringList and QUrl, in the encoding every Qt 5
 * and Qt 6 stream version shares for values under 4 GB.
 */

const NULL_SIZE = 0xffffffff;

class DataWriter {
  constructor() {
    this.chunks = [];
  }

  fixed(size, write) {
    const b = Buffer.alloc(size);
    write(b);
    this.chunks.push(b);
    return this;
  }

  int8(v) {
    return this.fixed(1, (b) => b.writeInt8(v));
  }

  bool(v) {
    return this.fixed(1, (b) => b.writeUInt8(v ? 1 : 0));
  }

  int32(v) {
    return this.fixed(4, (b) => b.writeInt32BE(v));
  }

  uint32(v) {
    return this.fixed(4, (b) => b.writeUInt32BE(v));
  }

  double(v) {
    return this.fixed(8, (b) => b.writeDoubleBE(v));
  }

  /** QByteArray: length, then the bytes. */
  bytes(buf) {
    this.uint32(buf.length);
    this.chunks.push(Buffer.from(buf));
    return this;
  }

  /** QString: byte length, then UTF-16BE. */
  string(s) {
    const utf16 = Buffer.from(s, 'utf16le').swap16();
    this.uint32(utf16.length);
    this.chunks.push(utf16);
    return this;
  }

  stringList(list) {
    this.uint32(list.length);
    for (const s of list) this.string(s);
    return this;
  }

  /** QUrl travels as the QByteArray of QUrl::toEncoded(). */
  url(u) {
    return this.bytes(Buffer.from(u, 'utf8'));
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

class DataReader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  atEnd() {
    return this.pos >= this.buf.length;
  }

  take(size) {
    if (this.pos + size > this.buf.length) throw new Error('QDataStream: read past the end of the packet');
    const at = this.pos;
    this.pos += size;
    return at;
  }

  int8() {
    return this.buf.readInt8(this.take(1));
  }

  bool() {
    return this.buf.readUInt8(this.take(1)) !== 0;
  }

  uint16() {
    return this.buf.readUInt16BE(this.take(2));
  }

  int32() {
    return this.buf.readInt32BE(this.take(4));
  }

  uint32() {
    return this.buf.readUInt32BE(this.take(4));
  }

  double() {
    return this.buf.readDoubleBE(this.take(8));
  }

  bytes() {
    const size = this.uint32();
    if (size === NULL_SIZE) return Buffer.alloc(0);
    const at = this.take(size);
    return this.buf.subarray(at, at + size);
  }

  string() {
    const size = this.uint32();
    if (size === NULL_SIZE) return '';
    const at = this.take(size);
    return Buffer.from(this.buf.subarray(at, at + size)).swap16().toString('utf16le');
  }

  stringList() {
    const count = this.uint32();
    const list = [];
    for (let i = 0; i < count; i++) list.push(this.string());
    return list;
  }

  doubleList() {
    const count = this.uint32();
    const list = [];
    for (let i = 0; i < count; i++) list.push(this.double());
    return list;
  }
}

module.exports = { DataWriter, DataReader };
