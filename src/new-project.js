'use strict';

/**
 * New Qt Project...: a project written from a template in templates/ -- the template, the
 * folder it goes in and its name chosen, and for a vcpkg template a Qt kit and a vcpkg,
 * whose CMakePresets.json is the one Set Up vcpkg writes, as is vcpkg.json when the template
 * has none of its own. Then opened.
 */

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IgnoreRules } = require('./ignore');
const { log } = require('./log');
const { key, toPosix } = require('./paths');
const { VCPKG_MANIFEST, newPresetsFile, presetsFor } = require('./presets/cmake-presets');
const { compareVersions, findVisualStudios } = require('./presets/kits');
const { chooseKit, chooseVcpkg, logKitAndVcpkg, names } = require('./setup-picks');

const TITLE = 'New Qt Project';
const TEMPLATES_DIR = path.join(__dirname, 'templates');
/** How a template's files spell the project's name. */
const PROJECT_NAME = '%{ProjectName}';
/** A project name is its CMake project's, its QML module's and, after app, its executable's. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const REMEMBERED_LOCATION = 'qtWorkbench.newProject.location';

/**
 * The templates, the default first. `files` is the folder in templates/ holding a template's files.
 * A vcpkg template gets the presets Set Up vcpkg writes, and an empty vcpkg.json unless it has
 * one of its own. `sharedLibraries` builds its packages as shared libraries on Linux and macOS
 * too, whose triplets are static: for a port that only builds as one.
 */
const TEMPLATES = [
  {
    label: 'Qt Quick Application',
    detail: 'A window with four views, themed QML components and the C++ types they use, in one QML module',
    files: 'qt-app'
  },
  {
    label: 'Qt Quick Application with vcpkg',
    detail: 'The same, with a vcpkg.json for its libraries and CMake presets that build it with a Qt kit and vcpkg',
    files: 'qt-app',
    vcpkg: true
  },
  {
    label: 'Qt Quick Application with Core Library',
    detail: 'An expense tracker: a core library with the data and the rules and no user interface, the Qt Quick application showing it, and the core\'s tests',
    files: 'qt-core-app'
  },
  {
    label: 'Qt Quick Application with vcpkg Libraries',
    detail: 'JSON with nlohmann-json, CSV with csv-parser, REST calls with restc-cpp and a Siemens S7 PLC client with snap7, all from vcpkg',
    files: 'qt-libs',
    vcpkg: true,
    // snap7 builds only as a shared library.
    sharedLibraries: true
  }
];

/** The triplet building shared libraries for `triplet`: the Linux and macOS ones build static libraries. */
function sharedTriplet(triplet) {
  return /-(?:linux|osx)$/.test(triplet) ? triplet + '-dynamic' : triplet;
}

async function stat(p) {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (_) {
    return null;
  }
}

/** The Qt version a template's CMakeLists.txt requires with qt_standard_project_setup(REQUIRES), or null. */
async function requiredQt(template) {
  const text = await fs.promises.readFile(path.join(TEMPLATES_DIR, template.files, 'CMakeLists.txt'), 'utf8');
  const m = /qt_standard_project_setup[ \t]*\([^)]*\bREQUIRES[ \t]+(\d+(?:\.\d+)*)/i.exec(text);
  return m ? m[1] : null;
}

/** A template's files, [{rel, text}] in path order, with `name` for the project's name. */
async function templateFiles(template, name) {
  const root = path.join(TEMPLATES_DIR, template.files);
  const files = [];
  const walk = async (dir) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push({ rel: toPosix(path.relative(root, full)), text: (await fs.promises.readFile(full, 'utf8')).split(PROJECT_NAME).join(name) });
    }
  };
  await walk(root);
  return files;
}

/** What is wrong with `input` as the name of a new project in `location`, or undefined. */
async function problemWithName(location, input) {
  const name = input.trim();
  if (name === '') return 'Enter a project name.';
  if (!NAME.test(name)) {
    return name + ' cannot name a project: it names its QML module and CMake target too, so start it with a letter and use only letters, digits and _.';
  }
  const dir = path.join(location, name);
  const st = await stat(dir);
  if (!st) return undefined;
  if ((st.type & vscode.FileType.Directory) === 0) return name + ' is a file in that folder.';
  // A folder made for the project, perhaps with git init run in it, is fine.
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  if (entries.some(([entry]) => !entry.startsWith('.'))) return name + ' already exists there, and is not empty.';
  return undefined;
}

/** The folder to create the project's folder in: browsed to, starting where the last project went. */
async function chooseLocation(context) {
  const folders = vscode.workspace.workspaceFolders || [];
  const start = context.globalState.get(REMEMBERED_LOCATION) || (folders.length > 0 ? path.dirname(folders[0].uri.fsPath) : os.homedir());
  const picked = await vscode.window.showOpenDialog({
    title: TITLE + ': Location',
    openLabel: 'Choose Location',
    defaultUri: vscode.Uri.file(start),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false
  });
  return picked && picked.length > 0 ? picked[0].fsPath : null;
}

/**
 * Open the new project: in this window when no folder is open, else as the user answers --
 * this window, a new one, or added to the workspace. Nothing to do when it is a workspace folder already.
 */
async function openProject(projectDir, name, template) {
  const uri = vscode.Uri.file(projectDir);
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.some((folder) => key(folder.uri.fsPath) === key(projectDir))) {
    log.appendLine('  a workspace folder already: nothing to open');
    if (!vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) return;
    vscode.window.showInformationMessage('Qt Workbench: created ' + name + ' from the ' + template.label + ' template.', 'Show Log').then((pick) => {
      if (pick === 'Show Log') log.show(true);
    });
    return;
  }
  // Opening a folder in this window restarts the extensions: log first.
  if (folders.length === 0) {
    log.appendLine('  opened in this window');
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
    return;
  }
  const [open, openNew, add] = ['Open', 'Open in New Window', 'Add to Workspace'];
  const answer = await vscode.window.showInformationMessage(
    'Open ' + name + '?',
    { modal: true, detail: 'Qt Workbench created it in ' + toPosix(projectDir) + ' from the ' + template.label + ' template.' },
    open,
    openNew,
    add
  );
  if (answer === open) {
    log.appendLine('  opened in this window');
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
  } else if (answer === openNew) {
    log.appendLine('  opened in a new window');
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
  } else if (answer === add) {
    log.appendLine('  added to the workspace');
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri });
  } else {
    log.appendLine('  not opened');
  }
}

async function newProject(context) {
  const items = [];
  for (const template of TEMPLATES) {
    const qt = await requiredQt(template);
    items.push({ label: template.label, description: 'CMake' + (qt ? ', Qt ' + qt + ' or later' : ''), detail: template.detail, template, qt });
  }
  const pick = await vscode.window.showQuickPick(items, { title: TITLE, placeHolder: 'Template to start the project from', matchOnDetail: true });
  if (!pick) return;
  const { template, qt } = pick;

  const location = await chooseLocation(context);
  if (!location) return;
  const input = await vscode.window.showInputBox({
    title: TITLE,
    prompt: 'Creates ' + toPosix(path.join(location, '<name>')) + '. The QML module gets the name too, and the executable is app<name>.',
    placeHolder: 'MyApp',
    validateInput: (text) => problemWithName(location, text)
  });
  if (input === undefined) return;
  const problem = await problemWithName(location, input);
  const name = input.trim();
  const projectDir = path.join(location, name);
  if (problem) {
    vscode.window.showErrorMessage('Qt Workbench: cannot create ' + toPosix(projectDir) + ': ' + problem);
    return;
  }
  log.header('new project ' + toPosix(projectDir) + ' from the ' + template.label + ' template');

  const rules = await IgnoreRules.load();
  const listFile = path.join(projectDir, 'CMakeLists.txt');
  await rules.classify([listFile]);
  if (rules.isIgnored(listFile)) {
    log.appendLine('  ! inside a build or ignored directory: nothing written');
    vscode.window.showErrorMessage('Qt Workbench: ' + toPosix(projectDir) + ' is inside a build folder or ignored by git, so no project is created there.');
    return;
  }

  const files = await templateFiles(template, name);
  if (template.vcpkg) {
    const visualStudios = await findVisualStudios(process.env, process.platform);
    if (process.platform === 'win32') {
      log.appendLine('  Visual Studio with C++ tools: ' + (visualStudios.map((vs) => vs.name + ' (' + vs.generator + ')').join(', ') || 'none'));
    }
    let kit = await chooseKit(context, visualStudios, TITLE + ': Qt Kit');
    if (!kit) return;
    if (template.sharedLibraries && sharedTriplet(kit.triplet) !== kit.triplet) {
      log.appendLine('  triplet ' + sharedTriplet(kit.triplet) + ' for ' + kit.triplet + ': the template needs shared libraries');
      kit = { ...kit, triplet: sharedTriplet(kit.triplet) };
    }
    if (qt && compareVersions(kit.version, qt) < 0) {
      log.appendLine('  ! ' + kit.label + ': the template needs Qt ' + qt + ' or later. Nothing written');
      vscode.window.showErrorMessage('Qt Workbench: ' + template.label + ' needs Qt ' + qt + ' or later, and ' + kit.label + ' is older.');
      return;
    }
    const vcpkg = await chooseVcpkg(context, projectDir, null, visualStudios, TITLE + ': vcpkg');
    if (!vcpkg) return;
    logKitAndVcpkg(kit, vcpkg);
    const presets = presetsFor(kit, vcpkg);
    const all = (list) => names(presets[list].map((p) => p.name));
    files.push({ rel: 'CMakePresets.json', text: newPresetsFile(presets), note: 'configure presets ' + all('configurePresets') + ' and build presets ' + all('buildPresets') });
    const manifest = files.find((file) => file.rel === 'vcpkg.json');
    if (manifest) {
      const dependencies = (JSON.parse(manifest.text).dependencies || []).map((d) => (typeof d === 'string' ? d : d.name));
      manifest.note = dependencies.length > 0 ? 'dependencies ' + names(dependencies) : 'no dependencies yet';
    } else {
      files.push({ rel: 'vcpkg.json', text: VCPKG_MANIFEST, note: 'no dependencies yet' });
    }
  }

  // The questions took a while: the folder may be taken by now.
  const taken = await problemWithName(location, name);
  if (taken) {
    log.appendLine('  ! ' + taken + ' Nothing written');
    vscode.window.showErrorMessage('Qt Workbench: cannot create ' + toPosix(projectDir) + ': ' + taken);
    return;
  }
  const dirs = new Set();
  let current = null;
  try {
    for (const file of files) {
      current = file.rel;
      const filePath = path.join(projectDir, ...file.rel.split('/'));
      if (!dirs.has(key(path.dirname(filePath)))) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
        dirs.add(key(path.dirname(filePath)));
      }
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(file.text, 'utf8'));
      log.appendLine('  * ' + file.rel + (file.note ? ': ' + file.note : ''));
    }
  } catch (err) {
    log.appendLine('  ! could not write ' + current + ': ' + (err && err.message ? err.message : String(err)));
    vscode.window.showErrorMessage('Qt Workbench: could not write ' + toPosix(path.join(projectDir, current)) + ': ' + (err && err.message ? err.message : String(err)));
    return;
  }
  await context.globalState.update(REMEMBERED_LOCATION, location);
  await openProject(projectDir, name, template);
}

function registerNewProject(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('qtWorkbench.newProject', async () => {
      try {
        await newProject(context);
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    })
  );
}

module.exports = { registerNewProject };
