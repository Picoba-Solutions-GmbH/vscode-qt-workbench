'use strict';

/**
 * Entry point: hooks VS Code's file rename and delete events, applies the edit as part
 * of the operation, and saves the files it touched afterwards. C++ class renames are
 * hooked in class-rename.js, the New QML/C++ File commands in new-file.js, New Qt Project
 * in new-project.js, the Qt Project Explorer view in project-explorer.js, QML hot reload
 * while debugging in qml-hot-reload.js and setting a project up for it in
 * hot-reload-setup.js, stopping a running program for an old gdb in gdb-interrupt.js,
 * CMake presets with vcpkg in vcpkg-setup.js, and adding vcpkg packages in vcpkg-packages.js.
 */

const vscode = require('vscode');
const { registerClassRenames } = require('./class-rename');
const { registerCMakeInstall } = require('./cmake-install');
const { saveFiles } = require('./documents');
const { registerGdbInterrupt } = require('./gdb-interrupt');
const { registerHotReloadSetup } = require('./hot-reload-setup');
const { VERSION, log } = require('./log');
const { registerNewFileCommands } = require('./new-file');
const { registerNewProject } = require('./new-project');
const { registerProjectExplorer } = require('./project-explorer');
const { registerQmlHotReload } = require('./qml-hot-reload');
const { key } = require('./paths');
const { computeDeleteEdit, computeWorkspaceEdit } = require('./refactor');
const { confirmUpdate, showSummary } = require('./summary');
const { registerVcpkgInstall } = require('./vcpkg-install');
const { registerVcpkgPackages } = require('./vcpkg-packages');
const { registerVcpkgSetup } = require('./vcpkg-setup');

/** Files the running move or delete is editing that held no unsaved changes of their own. */
let pendingSaves = [];

function rememberForSave(result) {
  pendingSaves = result.touched
    .filter((t) => {
      const open = vscode.workspace.textDocuments.find((d) => key(d.uri.fsPath) === key(t.uri.fsPath));
      return !(open && open.isDirty);
    })
    .map((t) => vscode.Uri.file(result.ctx.mapPath(t.uri.fsPath)));
}

/**
 * VS Code applies a participant's edits but leaves the files unsaved, so a build would
 * still read the old CMakeLists.txt from disk. Once the move or delete is done, save
 * what was edited -- following files.refactoring.autoSave, and never saving a file that
 * already held unsaved changes before.
 */
async function onDidChangeFiles() {
  const uris = pendingSaves;
  pendingSaves = [];
  if (uris.length === 0) return;
  if (!vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true)) return;
  await saveFiles(uris);
}

/** Run `compute` as the participant of a file operation event: its edit goes with the operation. */
function participate(event, compute) {
  pendingSaves = [];
  if (!vscode.workspace.getConfiguration('qtWorkbench').get('enabled', true)) return;

  event.waitUntil(
    (async () => {
      let result;
      try {
        result = await compute();
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
        return new vscode.WorkspaceEdit();
      }
      if (!result) return new vscode.WorkspaceEdit();
      if (result.touched.length > 0 && !(await confirmUpdate(result))) return new vscode.WorkspaceEdit();

      showSummary(result);
      rememberForSave(result);
      return result.edit;
    })()
  );
}

function activate(context) {
  context.subscriptions.push(
    log.init(),
    vscode.workspace.onWillRenameFiles((event) => participate(event, () => computeWorkspaceEdit(event.files))),
    vscode.workspace.onDidRenameFiles(onDidChangeFiles),
    vscode.workspace.onWillDeleteFiles((event) => participate(event, () => computeDeleteEdit(event.files))),
    vscode.workspace.onDidDeleteFiles(onDidChangeFiles),
    vscode.commands.registerCommand('qtWorkbench.showLog', () => log.show(true))
  );
  registerClassRenames(context);
  registerNewFileCommands(context);
  registerNewProject(context);
  registerProjectExplorer(context);
  registerQmlHotReload(context);
  registerHotReloadSetup(context);
  registerGdbInterrupt(context);
  registerVcpkgSetup(context);
  registerVcpkgPackages(context);
  registerVcpkgInstall(context);
  registerCMakeInstall(context);
  log.appendLine('Qt Workbench ' + VERSION + ' active.');
}

function deactivate() {}

module.exports = { activate, deactivate };
