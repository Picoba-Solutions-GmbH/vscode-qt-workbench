'use strict';

/**
 * Rename Symbol (F2) on a C++ class that QML knows by name. The C++ language server
 * renames the C++ references; this adds the QML ones to the same edit, so the rename
 * widget applies both as one undo step, with preview and files.refactoring.autoSave
 * as for any rename.
 *
 * VS Code applies the edit of one rename provider only: the newest registered one
 * that answers. So this provider stands in front of the language server's. It asks
 * VS Code for the server's answer -- stepping aside while it does -- and returns that
 * answer with the QML edits added. Being the newest is what puts it in front, so it
 * registers again just before F2 runs a rename in a C/C++ editor, and whenever such
 * an editor becomes active.
 */

const vscode = require('vscode');
const { log } = require('./log');
const { computeClassRenameEdit } = require('./refactor');
const { confirmUpdate, showSummary } = require('./summary');

const LANGUAGES = ['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp'];
const SELECTOR = LANGUAGES.map((language) => ({ scheme: 'file', language }));

/** True while this provider asks the others; it answers nothing to those calls. */
let delegating = false;

async function askOtherProviders(command, ...args) {
  delegating = true;
  try {
    return await vscode.commands.executeCommand(command, ...args);
  } finally {
    delegating = false;
  }
}

function isOn() {
  const cfg = vscode.workspace.getConfiguration('qtWorkbench');
  return cfg.get('enabled', true) && cfg.get('renameCppTypes', true);
}

const provider = {
  // Answering with the server's location is what keeps this provider first in line
  // for the edits. Answering nothing hands the whole rename to the server.
  async prepareRename(document, position) {
    if (delegating || !isOn()) return undefined;
    try {
      return await askOtherProviders('vscode.prepareRename', document.uri, position);
    } catch (_) {
      return undefined; // VS Code asks the server next, and it rejects with its own message
    }
  },

  async provideRenameEdits(document, position, newName, token) {
    if (delegating || !isOn()) return undefined;
    let edit;
    try {
      edit = await askOtherProviders('vscode.executeDocumentRenameProvider', document.uri, position, newName);
    } catch (err) {
      // Answering nothing here would make VS Code ask the server a second time, so
      // report its rejection -- once, however many providers repeated it.
      const reasons = [...new Set(String(err && err.message ? err.message : err).split('\n'))];
      vscode.window.showInformationMessage(reasons.join('\n'));
      return new vscode.WorkspaceEdit();
    }
    if (!edit) return new vscode.WorkspaceEdit();
    if (token.isCancellationRequested) return edit;

    try {
      const result = await computeClassRenameEdit(edit, newName);
      if (result && (await confirmUpdate(result))) {
        showSummary(result);
        for (const [uri, edits] of result.edit.entries()) {
          for (const e of edits) edit.replace(uri, e.range, e.newText);
        }
      }
    } catch (err) {
      // The C++ rename goes ahead whatever happened here.
      log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
      vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
    }
    return edit;
  }
};

function registerClassRenames(context) {
  let registration = null;
  const register = () => {
    // A rename that already picked up the old registration falls through to the
    // language server alone; it does not fail.
    if (registration) registration.dispose();
    registration = vscode.languages.registerRenameProvider(SELECTOR, provider);
  };
  register();

  context.subscriptions.push(
    { dispose: () => registration.dispose() },
    // Bound to F2 in C/C++ editors: register, then run VS Code's own Rename Symbol.
    vscode.commands.registerCommand('qtWorkbench.renameSymbol', () => {
      register();
      return vscode.commands.executeCommand('editor.action.rename');
    }),
    // For Rename Symbol started from the context menu or the command palette.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file' && LANGUAGES.includes(editor.document.languageId)) {
        register();
      }
    })
  );
}

module.exports = { registerClassRenames };
