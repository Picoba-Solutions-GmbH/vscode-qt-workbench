'use strict';

/**
 * The extension's output channel, shared by every module. The channel itself is
 * created on activation; until then, logging is a no-op.
 */

const vscode = require('vscode');

// Logged on activation and on every move, so a window still running an older
// build after an update is obvious from the log.
const VERSION = require('../package.json').version;

let channel = null;

const log = {
  /** Create the channel. Returns it so activation can dispose of it. */
  init() {
    channel = vscode.window.createOutputChannel('Qt Workbench');
    return channel;
  },
  appendLine(line) {
    if (channel) channel.appendLine(line);
  },
  /** Start the entry for one update, stamped with the time and the version doing it. */
  header(what) {
    this.appendLine('');
    this.appendLine('[' + new Date().toLocaleTimeString() + '] v' + VERSION + ': ' + what);
  },
  show(preserveFocus) {
    if (channel) channel.show(preserveFocus);
  }
};

module.exports = { log, VERSION };
