'use strict';

/**
 * QML hot reload while debugging. When a debug session starts a program with
 * -qmljsdebugger=...,services:QmlPreview, connect to it; whenever a project file it
 * loaded changes on disk, send it the new contents and have it create its root component
 * again. The protocol and the resource bookkeeping live in hot-reload/.
 */

const vscode = require('vscode');
const net = require('net');
const { IgnoreRules, excludeGlob } = require('./ignore');
const { log } = require('./log');
const { key } = require('./paths');
const { findBuildDir, previewTarget } = require('./hot-reload/launch');
const { ResourceTree, findBuildQrcFiles } = require('./hot-reload/resource-tree');
const { HotReloadSession } = require('./hot-reload/session');

// Save All writes several files in a row: one reload for all of them.
const DEBOUNCE_MS = 100;

const starting = new Set(); // ids of debug sessions whose hot reload is being set up
const active = new Map(); // debug session id -> {name, session, lastError}
let statusItem = null;
let watcher = null;
const changed = new Map(); // key(path) -> path
let flushTimer = null;

function enabled() {
  return vscode.workspace.getConfiguration('qtWorkbench').get('qmlHotReload', true);
}

function relative(p) {
  return vscode.workspace.asRelativePath(p, false);
}

/** A free port on the loopback interface, for ${command:qtWorkbench.qmlHotReloadPort} in launch.json. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

/**
 * The resources the program has compiled in, from the .qrc files of its own build tree
 * (every build tree in the workspace when the program is not in one), plus the .qrc
 * files in the sources, which AUTORCC and qmake compile directly.
 */
async function loadResources(program) {
  const rules = await IgnoreRules.load();
  const own = findBuildDir(program);
  const buildDirs = own ? [own] : rules.buildDirs;
  const tree = new ResourceTree();
  for (const dir of buildDirs) for (const qrc of findBuildQrcFiles(dir)) tree.addQrc(qrc);
  const sourceQrcs = await vscode.workspace.findFiles('**/*.qrc', excludeGlob());
  for (const uri of sourceQrcs.filter((u) => /\.qrc$/i.test(u.fsPath))) tree.addQrc(uri.fsPath);
  const excludeRoots = new Map([...rules.buildDirs, ...buildDirs].map((d) => [key(d), d]));
  return { tree, buildDirs, excludeRoots: [...excludeRoots.values()] };
}

async function onDidStartDebugSession(debugSession) {
  const target = previewTarget(debugSession.configuration);
  if (!target) return;
  log.header('QML hot reload: debug session "' + debugSession.name + '"');
  const reason = target.skip || (enabled() ? null : 'qtWorkbench.qmlHotReload is off');
  if (reason) {
    log.appendLine('  not connecting: ' + reason);
    if (target.block) {
      vscode.window.showWarningMessage(
        'QML hot reload is not connecting to "' + debugSession.name + '", which waits for a QML debug client (-qmljsdebugger=...,block): ' + reason + '.'
      );
    }
    return;
  }

  starting.add(debugSession.id);
  const { tree, buildDirs, excludeRoots } = await loadResources(debugSession.configuration.program);
  if (!starting.delete(debugSession.id)) return; // ended while we were reading the build tree
  log.appendLine(
    '  ' + tree.size + ' compiled-in file(s) from ' + tree.qrcFiles.length + ' .qrc file(s)' +
      (buildDirs.length ? ' of ' + buildDirs.map(relative).join(', ') : '')
  );
  if (tree.size === 0) log.appendLine('  ! no .qrc found: only QML files the application reads from disk can reload');

  const session = new HotReloadSession({
    hosts: target.hosts,
    ports: target.ports,
    block: target.block,
    resources: tree,
    sourceRoots: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    excludeRoots,
    log: (line) => log.appendLine(line)
  });
  const entry = { name: debugSession.name, session, lastError: null };
  active.set(debugSession.id, entry);
  session.on('state', updateStatus);
  session.on('appError', (message) => {
    entry.lastError = message.trim();
    updateStatus();
    vscode.window.showWarningMessage('QML hot reload: ' + entry.lastError, 'Show Log').then((choice) => {
      if (choice) log.show(true);
    });
  });
  ensureWatcher();
  log.appendLine('  waiting for the application on ' + target.hosts.join(' or ') + ', port ' + target.ports.join(', '));
  session.start();
  updateStatus();
}

function onDidTerminateDebugSession(debugSession) {
  starting.delete(debugSession.id);
  const entry = active.get(debugSession.id);
  if (!entry) return;
  active.delete(debugSession.id);
  entry.session.stop();
  log.appendLine('[' + new Date().toLocaleTimeString() + '] QML hot reload: debug session "' + entry.name + '" ended');
  if (active.size === 0) disposeWatcher();
  updateStatus();
}

function queue(fsPath) {
  if (active.size === 0) return;
  changed.set(key(fsPath), fsPath);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, DEBOUNCE_MS);
}

function flush() {
  const files = [...changed.values()];
  changed.clear();
  for (const entry of active.values()) report(entry, entry.session.reload(files));
}

function report(entry, result) {
  if (!result) return;
  log.header('QML hot reload: "' + entry.name + '"');
  if (result.error) {
    log.appendLine('  ! not reloaded: ' + result.error);
    vscode.window.setStatusBarMessage('$(warning) QML hot reload: ' + result.error, 5000);
    return;
  }
  entry.lastError = null;
  const what = result.files.length ? result.files.map(relative).join(', ') : 'no changed files';
  log.appendLine('  sent ' + what + ', reloading ' + result.url);
  updateStatus();
}

/** Reload every connected application now, sending the files it got from us that changed since. */
function reloadNow() {
  const connected = [...active.values()].filter((e) => e.session.state === 'connected');
  if (connected.length === 0) {
    vscode.window.showInformationMessage(
      active.size === 0
        ? 'QML hot reload: no debug session started with -qmljsdebugger=...,services:QmlPreview.'
        : 'QML hot reload: the application is not connected yet.'
    );
    return;
  }
  for (const entry of connected) report(entry, entry.session.reload(entry.session.servedFiles(), { always: true }));
}

function ensureWatcher() {
  if (watcher) return;
  const w = vscode.workspace.createFileSystemWatcher('**/*', false, false, true);
  watcher = vscode.Disposable.from(
    w,
    w.onDidChange((uri) => queue(uri.fsPath)),
    w.onDidCreate((uri) => queue(uri.fsPath))
  );
}

function disposeWatcher() {
  if (watcher) watcher.dispose();
  watcher = null;
}

function updateStatus() {
  if (active.size === 0) {
    if (statusItem) statusItem.hide();
    return;
  }
  if (!statusItem) {
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
    statusItem.name = 'QML Hot Reload';
  }
  const entries = [...active.values()];
  const connected = entries.filter((e) => e.session.state === 'connected');
  const failed = connected.find((e) => e.lastError);
  statusItem.backgroundColor = undefined;
  if (failed) {
    statusItem.text = '$(warning) QML Hot Reload';
    statusItem.tooltip = 'The last reload of "' + failed.name + '" failed:\n' + failed.lastError + '\n\nFix the file and save it again. Click to show the log.';
    statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusItem.command = 'qtWorkbench.showLog';
  } else if (connected.length > 0) {
    statusItem.text = '$(flame) QML Hot Reload';
    statusItem.tooltip = 'Connected to ' + connected.map((e) => '"' + e.name + '"').join(', ') + '. Saving a QML file reloads it.\nClick to reload now.';
    statusItem.command = 'qtWorkbench.reloadQml';
  } else {
    statusItem.text = '$(sync~spin) QML Hot Reload';
    statusItem.tooltip = 'Waiting for ' + entries.map((e) => '"' + e.name + '" on port ' + e.session.ports.join(', ')).join(', ') + '. Click to show the log.';
    statusItem.command = 'qtWorkbench.showLog';
  }
  statusItem.show();
}

function registerQmlHotReload(context) {
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((s) =>
      onDidStartDebugSession(s).catch((err) => log.appendLine('  ! QML hot reload failed: ' + (err && err.stack ? err.stack : String(err))))
    ),
    vscode.debug.onDidTerminateDebugSession(onDidTerminateDebugSession),
    // Saving is what matters; the watcher also sees files changed outside the editor.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file') queue(doc.uri.fsPath);
    }),
    vscode.commands.registerCommand('qtWorkbench.reloadQml', reloadNow),
    vscode.commands.registerCommand('qtWorkbench.qmlHotReloadPort', freePort),
    {
      dispose() {
        for (const entry of active.values()) entry.session.stop();
        active.clear();
        clearTimeout(flushTimer);
        disposeWatcher();
        if (statusItem) statusItem.dispose();
        statusItem = null;
      }
    }
  );
}

module.exports = { registerQmlHotReload };
