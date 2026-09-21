'use strict';

/**
 * Set Up QML Hot Reload Debugging...: what debugging a CMake project with QML hot reload
 * still takes, offered to pick from -- the debug configuration in launch.json, QT_QML_DEBUG
 * and a console for the Debug build in CMakeLists.txt -- and made in one edit. What each
 * change is comes from hot-reload/setup.js.
 */

const vscode = require('vscode');
const path = require('path');
const { fileReader, saveFiles } = require('./documents');
const { CONFIGURATION_NAME, cmakeChanges, hotReloadConfiguration, hotReloadConfigurationNames, newLaunchFile } = require('./hot-reload/setup');
const { IgnoreRules, workspaceFolderOf } = require('./ignore');
const { addToLists, joinEdits, parseJson, plain } = require('./json-syntax');
const { log } = require('./log');
const { key, toPosix } = require('./paths');
const { findKits, findVisualStudios } = require('./presets/kits');
const { projectIo } = require('./project-explorer');
const { readCMakeProject } = require('./project-tree/cmake');
const { chooseKit, chooseProject, names, pickKit, shown } = require('./setup-picks');
const { makeOffsetToPosition } = require('./text');

const TITLE = 'Set Up QML Hot Reload Debugging';

/**
 * The Qt kit the project builds with, which decides the debugger on Windows: the one its
 * presets give the Qt extension (VSCODE_QT_INSTALLATION), else one chosen.
 */
async function debuggingKit(context, projectDir, rules, readFile) {
  const visualStudios = await findVisualStudios(process.env, process.platform);
  const presetFiles = ['CMakePresets.json', 'CMakeUserPresets.json'].map((name) => path.join(projectDir, name));
  await rules.classify(presetFiles);
  const dirs = [];
  for (const file of presetFiles.filter((p) => !rules.isIgnored(p))) {
    let presets;
    try {
      presets = plain(parseJson((await readFile(file)) || '')).configurePresets;
    } catch (_) {
      continue; // no presets, or not JSON
    }
    for (const preset of Array.isArray(presets) ? presets : []) {
      const qtCpp = preset && preset.vendor && preset.vendor['qt-cpp'];
      if (qtCpp && typeof qtCpp.VSCODE_QT_INSTALLATION === 'string') dirs.push(qtCpp.VSCODE_QT_INSTALLATION);
    }
  }
  const kits = (await findKits(dirs, { platform: process.platform, arch: process.arch, visualStudios })).filter((k) => !k.problem);
  if (kits.length > 0) log.appendLine('  Qt kits in the presets: ' + kits.map((k) => k.label).join(', '));

  const kit = kits.length === 1 ? kits[0] : kits.length > 1 ? await pickKit(kits, TITLE + ': Qt Kit') : await chooseKit(context, visualStudios, TITLE + ': Qt Kit');
  if (kit && kit.compilers && !kit.gdb) {
    const bin = toPosix(path.dirname(kit.compilers.cxx));
    log.appendLine('  ! ' + kit.label + ': no gdb.exe in ' + bin);
    vscode.window.showErrorMessage('Qt Workbench: ' + bin + ' has no gdb.exe to debug ' + kit.label + ' with. Add it with the Qt Maintenance Tool.');
    return null;
  }
  return kit;
}

const CHANGE_LABELS = {
  qmlDebug: (change) => ({
    label: shown(change.file) + ': QT_QML_DEBUG for ' + change.target + ' in Debug builds',
    description: 'without it the application ignores -qmljsdebugger'
  }),
  console: (change) => ({
    label: shown(change.file) + ': a console for ' + change.target + ' in Debug builds',
    description: 'WIN32_EXECUTABLE $<NOT:$<CONFIG:Debug>>, so qDebug() output shows'
  })
};

async function setUpHotReload(context, uri) {
  const rules = await IgnoreRules.load();
  const readFile = fileReader();
  const projectDir = await chooseProject(uri, rules, readFile, TITLE);
  if (!projectDir) return;
  const listFile = path.join(projectDir, 'CMakeLists.txt');
  log.header('set up QML hot reload debugging for ' + shown(listFile));

  // The workspace folder's launch.json is VS Code's, not the project's: it is written even
  // where git ignores .vscode.
  const launchPath = path.join(workspaceFolderOf(projectDir) || projectDir, '.vscode', 'launch.json');
  const launchName = shown(launchPath);
  const launchText = await readFile(launchPath);
  let launchRoot = null;
  if (launchText !== null) {
    try {
      launchRoot = parseJson(launchText, { comments: true });
      if (launchRoot.type !== 'object') throw new SyntaxError('it holds no JSON object');
      addToLists(launchText, launchRoot, [['configurations', []]]);
    } catch (err) {
      log.appendLine('  ! ' + launchName + ' cannot be read: ' + err.message + '. Nothing written');
      vscode.window.showErrorMessage('Qt Workbench: ' + launchName + ' cannot be read: ' + err.message + '. Fix it, then set up QML hot reload again.');
      return;
    }
  }

  const items = [];
  let configuration = null;
  const configurations = launchRoot ? plain(launchRoot).configurations : [];
  const existing = hotReloadConfigurationNames(configurations);
  if (existing.length > 0) {
    log.appendLine('  ' + launchName + ': ' + names(existing) + ' already start' + (existing.length === 1 ? 's' : '') + ' the application with QML hot reload');
  } else {
    let kit = null;
    if (process.platform === 'win32') {
      kit = await debuggingKit(context, projectDir, rules, readFile);
      if (!kit) return;
      log.appendLine('  Qt kit: ' + kit.label + ' in ' + toPosix(kit.dir) + (kit.gdb ? ', debugged with ' + toPosix(kit.gdb) : ', debugged with the Visual Studio debugger'));
    }
    const qtCpp = Boolean(vscode.extensions.getExtension('theqtcompany.qt-cpp'));
    configuration = hotReloadConfiguration({ platform: process.platform, kit, qtCpp });
    const replaces = Array.isArray(configurations) && configurations.some((c) => c && c.name === CONFIGURATION_NAME);
    items.push({
      label: launchName + ': ' + CONFIGURATION_NAME,
      description: launchText === null ? 'a new launch.json' : replaces ? 'replaces the configuration of that name' : 'added to its configurations',
      picked: !replaces,
      launch: true
    });
  }

  const project = await readCMakeProject(listFile, projectIo(rules, []));
  const cmake = project ? await cmakeChanges(project, readFile) : { changes: [], notes: [shown(listFile) + ' cannot be read'] };
  for (const note of cmake.notes) log.appendLine('  ' + note);
  // Needed ones first; the edits keep cmakeChanges' order.
  const byKind = (kind) => cmake.changes.filter((c) => c.kind === kind).map((change) => ({ ...CHANGE_LABELS[kind](change), picked: true, change }));
  items.push(...byKind('qmlDebug'), ...byKind('console'));

  if (items.length === 0) {
    vscode.window.showInformationMessage('Qt Workbench: QML hot reload debugging is set up already. The log says what was found.');
    return;
  }
  const chosen = await vscode.window.showQuickPick(items, {
    title: TITLE,
    placeHolder: 'What to set up for debugging with QML hot reload',
    canPickMany: true,
    ignoreFocusOut: true
  });
  if (!chosen || chosen.length === 0) {
    log.appendLine('  nothing chosen');
    return;
  }
  for (const item of items) log.appendLine((chosen.includes(item) ? '  * ' : '  not chosen: ') + item.label);

  const edit = new vscode.WorkspaceEdit();
  const created = [];
  const edited = [];
  let launchUri = null;
  if (chosen.some((item) => item.launch)) {
    launchUri = vscode.Uri.file(launchPath);
    if (launchText === null) {
      edit.createFile(launchUri, { overwrite: false });
      edit.insert(launchUri, new vscode.Position(0, 0), newLaunchFile(configuration));
      created.push(launchUri);
    } else {
      const toPosition = makeOffsetToPosition(launchText);
      for (const e of addToLists(launchText, launchRoot, [['configurations', [configuration]]]).edits) {
        edit.replace(launchUri, new vscode.Range(toPosition(e.start), toPosition(e.end)), e.text);
      }
      edited.push(launchUri);
    }
  }
  const byFile = new Map();
  for (const change of cmake.changes) {
    if (!chosen.some((item) => item.change === change)) continue;
    if (!byFile.has(key(change.file))) byFile.set(key(change.file), { file: change.file, edits: [] });
    byFile.get(key(change.file)).edits.push(...change.edits);
  }
  for (const { file, edits } of byFile.values()) {
    const uri = vscode.Uri.file(file);
    const toPosition = makeOffsetToPosition(await readFile(file));
    for (const e of joinEdits(edits)) edit.replace(uri, new vscode.Range(toPosition(e.start), toPosition(e.end)), e.text);
    edited.push(uri);
  }

  const dirtyBefore = new Set(vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => key(d.uri.fsPath)));
  if (!(await vscode.workspace.applyEdit(edit))) {
    log.appendLine('  ! could not apply the changes');
    vscode.window.showErrorMessage('Qt Workbench: could not set up QML hot reload debugging.');
    return;
  }
  // As for New File: a created launch.json is written, edited files follow files.refactoring.autoSave.
  const toSave = [...created];
  if (vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true)) {
    toSave.push(...edited.filter((u) => !dirtyBefore.has(key(u.fsPath))));
  }
  await saveFiles(toSave);
  if (launchUri) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(launchUri));

  const cmakeTools = Boolean(vscode.extensions.getExtension('ms-vscode.cmake-tools'));
  if (launchUri && !cmakeTools) log.appendLine('  ! CMake Tools is not installed: ${command:cmake.launchTargetPath} in the configuration needs it');
  if (!vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) return;
  const next = byFile.size > 0 ? ' Build the Debug build again, then start debugging.' : launchUri ? ' Start debugging with it.' : '';
  const files = [...(launchUri ? [launchName] : []), ...[...byFile.values()].map((f) => shown(f.file))];
  vscode.window
    .showInformationMessage('Qt Workbench: set up QML hot reload debugging in ' + names(files) + '.' + next + (launchUri && !cmakeTools ? ' It needs the CMake Tools extension.' : ''), 'Show Log')
    .then((pick) => {
      if (pick === 'Show Log') log.show(true);
    });
}

function registerHotReloadSetup(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('qtWorkbench.setUpHotReload', async (uri) => {
      try {
        await setUpHotReload(context, uri);
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    })
  );
}

module.exports = { registerHotReloadSetup };
