'use strict';

/**
 * Project files as the editor holds them: reading prefers an open document's unsaved
 * text, and saving writes back the files an update edited.
 */

const vscode = require('vscode');
const { log } = require('./log');
const { key, toPosix } = require('./paths');

/** Reads each file once per update, preferring the editor's copy so unsaved changes are not clobbered. */
function fileReader() {
  const textCache = new Map();
  return async function readFile(fsPath) {
    const k = key(fsPath);
    if (textCache.has(k)) return textCache.get(k);
    let text = null;
    const open = vscode.workspace.textDocuments.find((d) => key(d.uri.fsPath) === k);
    if (open) {
      text = open.getText();
    } else {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
        text = Buffer.from(bytes).toString('utf8');
      } catch (_) {
        text = null;
      }
    }
    textCache.set(k, text);
    return text;
  };
}

/** Save each of `uris` that holds unsaved changes, logging how many were saved and what could not be. */
async function saveFiles(uris) {
  let saved = 0;
  for (const uri of uris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (doc.isDirty && (await doc.save())) saved++;
    } catch (err) {
      log.appendLine(
        '  ! could not save ' + toPosix(vscode.workspace.asRelativePath(uri)) + ': ' + String(err)
      );
    }
  }
  if (saved > 0) log.appendLine('  saved ' + saved + ' file(s)');
}

module.exports = { fileReader, saveFiles };
