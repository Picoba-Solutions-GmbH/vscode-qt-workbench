'use strict';

/**
 * Set Up vcpkg with CMake Presets...: choose a Qt kit and a vcpkg, and the CMake project
 * gets configure and build presets building it with both -- in a new CMakePresets.json, or
 * added to its own -- and a vcpkg.json when it has none. One edit, saved and opened.
 * Finding kits and vcpkg, and writing the presets, is in presets/.
 */

const vscode = require('vscode');
const path = require('path');
const { fileReader, saveFiles } = require('./documents');
const { IgnoreRules } = require('./ignore');
const { log } = require('./log');
const { key } = require('./paths');
const { VCPKG_MANIFEST, mergePresets, newPresetsFile, presetsFor } = require('./presets/cmake-presets');
const { versionOf } = require('./presets/cmake-tool');
const { findVisualStudios } = require('./presets/kits');
const { chooseKit, chooseProject, chooseVcpkg, logKitAndVcpkg, names, shown } = require('./setup-picks');
const { makeOffsetToPosition } = require('./text');
const { installCMake } = require('./cmake-install');

const TITLE = 'Set Up vcpkg with CMake Presets';

async function stat(p) {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (_) {
    return null;
  }
}

function logOutcome(file, outcome) {
  for (const list of ['configurePresets', 'buildPresets']) {
    const noun = list === 'configurePresets' ? 'configure' : 'build';
    for (const [what, done] of [['added', 'added'], ['replaced', 'replaced'], ['unchanged', 'already there']]) {
      if (outcome[list][what].length > 0) log.appendLine('  ' + file + ': ' + noun + ' presets ' + names(outcome[list][what]) + ' ' + done);
    }
  }
}

async function setUpVcpkg(context, uri) {
  const rules = await IgnoreRules.load();
  const readFile = fileReader();
  const projectDir = await chooseProject(uri, rules, readFile, TITLE);
  if (!projectDir) return;

  const presetsPath = path.join(projectDir, 'CMakePresets.json');
  const manifestPath = path.join(projectDir, 'vcpkg.json');
  const presetsName = shown(presetsPath);
  const manifestName = shown(manifestPath);
  log.header('set up vcpkg for ' + shown(path.join(projectDir, 'CMakeLists.txt')));

  await rules.classify([path.join(projectDir, 'CMakeLists.txt'), presetsPath, manifestPath]);
  const ignored = [presetsPath, manifestPath].find((p) => rules.isIgnored(p));
  if (ignored) {
    log.appendLine('  ! ' + shown(ignored) + ' is inside a build or ignored directory: nothing written');
    vscode.window.showErrorMessage('Qt Workbench: ' + shown(ignored) + ' is ignored by git or inside a build folder, so it is not written.');
    return;
  }

  const presetsText = await readFile(presetsPath);
  if (presetsText !== null) {
    try {
      mergePresets(presetsText, { configurePresets: [], buildPresets: [] });
    } catch (err) {
      log.appendLine('  ! ' + presetsName + ' cannot be read: ' + err.message + '. Nothing written');
      vscode.window.showErrorMessage('Qt Workbench: ' + presetsName + ' cannot be read: ' + err.message + '. Fix it, then set up vcpkg again.');
      return;
    }
  }

  const cmakeVersion = await versionOf('cmake', process.env, process.platform);
  log.appendLine('  cmake: ' + (cmakeVersion || 'not on PATH'));
  if (!cmakeVersion) {
    vscode.window.showWarningMessage('Qt Workbench: cmake is not on PATH. CMake Tools needs it to configure with the presets this writes.', 'Install CMake').then((pick) => {
      if (pick === 'Install CMake') installCMake();
    });
  }

  const visualStudios = await findVisualStudios(process.env, process.platform);
  if (process.platform === 'win32') {
    log.appendLine('  Visual Studio with C++ tools: ' + (visualStudios.map((vs) => vs.name + ' (' + vs.generator + ')').join(', ') || 'none'));
  }
  const kit = await chooseKit(context, visualStudios, TITLE + ' (1/2)');
  if (!kit) return;
  const vcpkg = await chooseVcpkg(context, projectDir, presetsText, visualStudios, TITLE + ' (2/2)');
  if (!vcpkg) return;
  logKitAndVcpkg(kit, vcpkg);

  const presets = presetsFor(kit, vcpkg);
  const edit = new vscode.WorkspaceEdit();
  const presetsUri = vscode.Uri.file(presetsPath);
  const created = [];
  if (presetsText === null) {
    edit.createFile(presetsUri, { overwrite: false });
    edit.insert(presetsUri, new vscode.Position(0, 0), newPresetsFile(presets));
    created.push(presetsUri);
    const all = (list) => presets[list].map((p) => p.name);
    log.appendLine('  * ' + presetsName + ': created, with configure presets ' + names(all('configurePresets')) + ' and build presets ' + names(all('buildPresets')));
  } else {
    const merged = mergePresets(presetsText, presets);
    const replaced = [...new Set([...merged.configurePresets.replaced, ...merged.buildPresets.replaced])];
    if (replaced.length > 0) {
      const answer = await vscode.window.showWarningMessage(
        presetsName + ' already has presets named ' + names(replaced) + '. Replace them?',
        { modal: true, detail: 'They are replaced by presets for ' + kit.label + ' and vcpkg. The other presets stay as they are.' },
        'Replace'
      );
      if (answer !== 'Replace') {
        log.appendLine('  not changed: replacing ' + names(replaced) + ' was declined');
        return;
      }
    }
    logOutcome(presetsName, merged);
    const toPosition = makeOffsetToPosition(presetsText);
    for (const e of merged.edits) edit.replace(presetsUri, new vscode.Range(toPosition(e.start), toPosition(e.end)), e.text);
  }

  if (await stat(manifestPath)) {
    log.appendLine('  ' + manifestName + ': already there, left as it is');
  } else {
    const manifestUri = vscode.Uri.file(manifestPath);
    edit.createFile(manifestUri, { overwrite: false });
    edit.insert(manifestUri, new vscode.Position(0, 0), VCPKG_MANIFEST);
    created.push(manifestUri);
    log.appendLine('  * ' + manifestName + ': created, with no dependencies yet');
  }

  if (created.length === 0 && edit.entries().length === 0) {
    vscode.window.showInformationMessage('Qt Workbench: ' + presetsName + ' already builds with ' + kit.label + ' and vcpkg.');
    return;
  }
  const dirtyBefore = new Set(vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => key(d.uri.fsPath)));
  if (!(await vscode.workspace.applyEdit(edit))) {
    log.appendLine('  ! could not write ' + presetsName);
    vscode.window.showErrorMessage('Qt Workbench: could not write ' + presetsName + '.');
    return;
  }

  // Created files are always written; an existing CMakePresets.json follows
  // files.refactoring.autoSave, as after a move, and never when it had unsaved changes.
  const toSave = [...created];
  if (presetsText !== null && vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true) && !dirtyBefore.has(key(presetsPath))) {
    toSave.push(presetsUri);
  }
  await saveFiles(toSave);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(presetsUri));

  if (!vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) return;
  const configure = presets.configurePresets.filter((p) => !p.hidden).map((p) => p.name);
  const select = 'Select Configure Preset';
  const buttons = vscode.extensions.getExtension('ms-vscode.cmake-tools') ? [select, 'Show Log'] : ['Show Log'];
  vscode.window
    .showInformationMessage('Qt Workbench: ' + presetsName + ' builds with ' + kit.label + ' and vcpkg in ' + names(configure) + '.', ...buttons)
    .then((pick) => {
      if (pick === select) vscode.commands.executeCommand('cmake.selectConfigurePreset');
      else if (pick === 'Show Log') log.show(true);
    });
}

function registerVcpkgSetup(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('qtWorkbench.setUpVcpkg', async (uri) => {
      try {
        await setUpVcpkg(context, uri);
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    })
  );
}

module.exports = { registerVcpkgSetup };
