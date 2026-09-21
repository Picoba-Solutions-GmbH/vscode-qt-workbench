'use strict';

/**
 * The client side of Qt's QmlPreview debug service (qmldbg_preview), the service Qt
 * Creator's QML Preview uses. While a client is connected, the application asks it for
 * every file and directory its QML engine reads -- "Request" -- and the client answers
 * with the contents ("File", "Directory") or "Error" to let the application read its own
 * copy, which it then never asks for again. "Load" clears the engine's component cache
 * and creates the given root component anew, reading everything through the client.
 *
 * Command numbers are QQmlPreviewClient::Command in QtQmlDebug.
 */

const { EventEmitter } = require('events');
const { DataReader, DataWriter } = require('./data-stream');

const Command = {
  File: 0,
  Load: 1,
  Request: 2,
  Error: 3,
  Rerun: 4,
  Directory: 5,
  ClearCache: 6,
  Zoom: 7,
  Fps: 8,
  AnimationSpeed: 9
};

class QmlPreviewClient extends EventEmitter {
  constructor() {
    super();
    this.name = 'QmlPreview';
    this.connection = null;
  }

  messageReceived(message) {
    const reader = new DataReader(message);
    const command = reader.int8();
    if (command === Command.Request) this.emit('request', reader.string());
    // Not 'error': an EventEmitter throws that one when nobody listens.
    else if (command === Command.Error) this.emit('appError', reader.string());
  }

  send(writer) {
    return this.connection ? this.connection.send(this.name, writer.toBuffer()) : false;
  }

  sendFile(path, contents) {
    return this.send(new DataWriter().int8(Command.File).string(path).bytes(contents));
  }

  sendDirectory(path, entries) {
    return this.send(new DataWriter().int8(Command.Directory).string(path).stringList(entries));
  }

  sendError(path) {
    return this.send(new DataWriter().int8(Command.Error).string(path));
  }

  load(url) {
    return this.send(new DataWriter().int8(Command.Load).url(url));
  }

  clearCache() {
    return this.send(new DataWriter().int8(Command.ClearCache));
  }
}

module.exports = { QmlPreviewClient, Command };
