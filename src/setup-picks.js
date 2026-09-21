'use strict';

/**
 * What the Set Up and New Qt Project commands ask: the CMake project to set up, the Qt kit it
 * builds with -- one found where the Qt extension or Qt's installer puts kits, or one browsed
 * to -- and the vcpkg, found or browsed to as well.
 */

const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { excludeGlob, workspaceFolderOf } = require('./ignore');
const { log } = require('./log');
const { key, toPosix } = require('./paths');
const { findKits, qtSearchPaths } = require('./presets/kits');
const { findVcpkgRoots, isVcpkgRoot, toolchainPath } = require('./presets/vcpkg');
const { installVcpkg } = require('./vcpkg-install');

const REMEMBERED_KITS = 'qtWorkbench.vcpkgSetup.qtKits';
const REMEMBERED_VCPKG = 'qtWorkbench.vcpkgSetup.vcpkgRoots';
const GET_VCPKG = 'https://learn.microsoft.com/vcpkg/get_started/get-started';

async function stat(p) {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (_) {
    return null;
  }
}

/** A path as the workspace shows it. */
const shown = (p) => toPosix(vscode.workspace.asRelativePath(vscode.Uri.file(p)));

/** "a", "a and b", "a, b and c". */
function names(list) {
  return list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/** Keep `dir` among the last ten folders browsed to under `stateKey`. */
async function remember(context, stateKey, dir) {
  const list = context.globalState.get(stateKey, []).filter((d) => key(d) !== key(dir));
  await context.globalState.update(stateKey, [...list, dir].slice(-10));
}

/**
 * The folder of the CMake project to set up: the one the command was started on, else the
 * workspace's top-level CMake projects -- a CMakeLists.txt at a workspace folder's root, or
 * one calling project() with no CMakeLists.txt above it -- asking when there are several.
 */
async function chooseProject(uri, rules, readFile, title) {
  if (uri && typeof uri.fsPath === 'string') {
    if (uri.scheme !== 'file') return null;
    const st = await stat(uri.fsPath);
    const dir = st && (st.type & vscode.FileType.Directory) !== 0 ? uri.fsPath : path.dirname(uri.fsPath);
    if (await stat(path.join(dir, 'CMakeLists.txt'))) return dir;
    vscode.window.showErrorMessage('Qt Workbench: ' + shown(dir) + ' has no CMakeLists.txt, so it is no CMake project.');
    return null;
  }

  const found = (await vscode.workspace.findFiles('**/CMakeLists.txt', excludeGlob()))
    .map((u) => u.fsPath)
    .filter((p) => path.basename(p).toLowerCase() === 'cmakelists.txt');
  await rules.classify(found);
  const lists = found.filter((p) => !rules.isIgnored(p));
  const listDirs = new Set(lists.map((p) => key(path.dirname(p))));
  const projects = [];
  for (const file of lists) {
    const dir = path.dirname(file);
    const folder = workspaceFolderOf(dir);
    if (!folder) continue;
    let nested = false;
    for (let d = dir; key(d) !== key(folder) && path.dirname(d) !== d; ) {
      d = path.dirname(d);
      if (listDirs.has(key(d))) nested = true;
    }
    if (nested) continue;
    if (key(dir) !== key(folder) && !/^[ \t]*project[ \t]*\(/im.test((await readFile(file)) || '')) continue;
    projects.push(dir);
  }
  if (projects.length === 0) {
    vscode.window.showInformationMessage('Qt Workbench: no CMake project found, no CMakeLists.txt at the root of a workspace folder or calling project().');
    return null;
  }
  const editor = vscode.window.activeTextEditor;
  const active = editor && editor.document.uri.scheme === 'file' ? key(editor.document.uri.fsPath) : '';
  const holdsActive = (dir) => active.startsWith(key(dir) + path.sep);
  projects.sort((a, b) => holdsActive(b) - holdsActive(a) || (a < b ? -1 : a > b ? 1 : 0));
  if (projects.length === 1) return projects[0];
  const pick = await vscode.window.showQuickPick(
    projects.map((dir) => ({ label: path.basename(dir), description: shown(dir), dir })),
    { title, placeHolder: 'CMake project to set up' }
  );
  return pick ? pick.dir : null;
}

function kitItem(kit) {
  return { label: kit.label, description: toPosix(kit.dir), detail: [kit.compilerLabel, kit.generator, kit.triplet].join(' · '), kit };
}

/** One of the usable `kits`, chosen. */
async function pickKit(kits, title) {
  const pick = await vscode.window.showQuickPick(kits.map(kitItem), { title, placeHolder: 'Qt kit to build with', matchOnDescription: true });
  return pick ? pick.kit : null;
}

/** The kit a browsed folder holds: a kit folder, a Qt version folder or an installation root. */
async function browseKit(context, ctx, title) {
  const picked = await vscode.window.showOpenDialog({
    title: title + ': Qt Kit Folder',
    openLabel: 'Use Qt Kit',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false
  });
  if (!picked || picked.length === 0) return null;
  let dir = picked[0].fsPath;
  let kits = await findKits([dir], ctx);
  // A kit folder holds both bin and mkspecs; picking one of them by mistake (or a version
  // folder's bin) finds nothing below it, so the parent (and its parent) is tried too.
  for (let up = dir, tries = 0; kits.length === 0 && tries < 2; tries++) {
    const parent = path.dirname(up);
    if (parent === up) break;
    up = parent;
    kits = await findKits([up], ctx);
    if (kits.length > 0) dir = up;
  }
  log.appendLine('  browsed to ' + toPosix(picked[0].fsPath) + ': ' + (kits.map((k) => k.label).join(', ') || 'no Qt kit'));
  if (kits.length === 0) {
    vscode.window.showErrorMessage('Qt Workbench: no Qt kit in ' + toPosix(picked[0].fsPath) + '. A kit folder holds mkspecs/qconfig.pri.');
    return null;
  }
  if (dir !== picked[0].fsPath) log.appendLine('  found in ' + toPosix(dir) + ' instead');
  const usable = kits.filter((k) => !k.problem);
  if (usable.length === 0) {
    vscode.window.showErrorMessage('Qt Workbench: ' + kits[0].label + ' cannot be used: ' + kits[0].problem + '.');
    return null;
  }
  const kit = usable.length === 1 ? usable[0] : await pickKit(usable, title);
  if (kit) await remember(context, REMEMBERED_KITS, dir);
  return kit;
}

/**
 * The Qt kit, chosen among those found where the Qt extension or Qt's installer puts them
 * and those browsed to before, or browsed to. `visualStudios` is findVisualStudios' answer.
 */
async function chooseKit(context, visualStudios, title) {
  const qt = vscode.workspace.getConfiguration('qt-core');
  const ctx = { platform: process.platform, arch: process.arch, visualStudios };
  const dirs = [
    ...qtSearchPaths({
      installationRoot: qt.get('qtInstallationRoot', ''),
      additionalQtPaths: qt.get('additionalQtPaths', []),
      env: process.env,
      platform: process.platform,
      home: os.homedir()
    }),
    ...context.globalState.get(REMEMBERED_KITS, [])
  ];
  const kits = await findKits(dirs, ctx);
  log.appendLine('  Qt kits in ' + dirs.map(toPosix).join(', ') + ':' + (kits.length === 0 ? ' none' : ''));
  for (const kit of kits) {
    log.appendLine('    ' + toPosix(kit.dir) + ': ' + (kit.problem ? 'left out, ' + kit.problem : kit.label + ', ' + kit.compilerLabel));
  }

  const usable = kits.filter((k) => !k.problem);
  const unusable = kits.filter((k) => k.problem);
  const separator = (label) => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const items = usable.map(kitItem);
  if (unusable.length > 0) {
    items.push(separator('cannot be used'), ...unusable.map((kit) => ({ label: kit.label, description: toPosix(kit.dir), detail: kit.problem, kit })));
  }
  if (items.length > 0) items.push(separator(''));
  items.push({ label: '$(folder-opened) Browse...', description: 'a Qt kit folder, the one holding bin and mkspecs', browse: true });

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: usable.length > 0 ? 'Qt kit to build with' : 'No Qt kit found in ' + dirs.map(toPosix).join(', ') + ': browse to one',
    matchOnDescription: true,
    ignoreFocusOut: true
  });
  if (!pick) return null;
  if (pick.browse) return browseKit(context, ctx, title);
  if (pick.kit.problem) {
    vscode.window.showErrorMessage('Qt Workbench: ' + pick.kit.label + ' cannot be used: ' + pick.kit.problem + '.');
    return null;
  }
  return pick.kit;
}

/**
 * The vcpkg for the project in `projectDir`: one found for it, or one browsed to.
 * `presetsText` is its CMakePresets.json, or null; `visualStudios` is findVisualStudios' answer.
 */
async function chooseVcpkg(context, projectDir, presetsText, visualStudios, title) {
  const roots = await findVcpkgRoots({
    projectDir,
    env: process.env,
    platform: process.platform,
    presetTexts: [presetsText],
    remembered: context.globalState.get(REMEMBERED_VCPKG, []),
    visualStudios
  });
  log.appendLine(
    '  vcpkg found: ' +
      (roots.map((r) => toPosix(r.dir) + ' (' + r.source + ')').join(', ') || 'none, in the project, VCPKG_ROOT, the presets, PATH or Visual Studio')
  );

  const items = roots.map((root) => ({ label: toPosix(root.dir), description: root.source, detail: 'CMAKE_TOOLCHAIN_FILE: ' + root.toolchain, root }));
  if (items.length > 0) items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: '$(folder-opened) Browse...', description: 'the folder vcpkg was cloned into', browse: true });
  items.push({ label: '$(cloud-download) Install vcpkg...', description: 'git clone it and run its bootstrap script', install: true });
  if (roots.length === 0) items.push({ label: '$(link-external) Get vcpkg', description: 'how to install it by hand', get: true });

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: roots.length > 0 ? 'vcpkg to install the dependencies with' : 'No vcpkg found: browse to its folder, install it, or get it by hand',
    matchOnDescription: true,
    ignoreFocusOut: true
  });
  if (!pick) return null;
  if (pick.get) {
    vscode.env.openExternal(vscode.Uri.parse(GET_VCPKG));
    return null;
  }
  if (pick.install) {
    const dir = await installVcpkg(title);
    if (!dir) return null;
    await remember(context, REMEMBERED_VCPKG, dir);
    return { dir, source: 'installed just now', toolchain: toolchainPath(dir, projectDir, process.env) };
  }
  if (!pick.browse) return pick.root;

  const picked = await vscode.window.showOpenDialog({
    title: title + ': vcpkg Folder',
    openLabel: 'Use vcpkg',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false
  });
  if (!picked || picked.length === 0) return null;
  const dir = picked[0].fsPath;
  if (!(await isVcpkgRoot(dir))) {
    log.appendLine('  browsed to ' + toPosix(dir) + ': no vcpkg');
    vscode.window.showErrorMessage('Qt Workbench: ' + toPosix(dir) + ' is no vcpkg folder: it has no .vcpkg-root and scripts/buildsystems/vcpkg.cmake.');
    return null;
  }
  await remember(context, REMEMBERED_VCPKG, dir);
  return { dir, source: 'browsed to', toolchain: toolchainPath(dir, projectDir, process.env) };
}

/** The Qt kit and vcpkg chosen, for the log. */
function logKitAndVcpkg(kit, vcpkg) {
  log.appendLine(
    '  Qt kit: ' + kit.label + ' in ' + toPosix(kit.dir) + ', ' + kit.compilerLabel + ', ' + kit.generator + ', triplet ' + kit.triplet +
      (kit.hostTriplet ? ', host triplet ' + kit.hostTriplet + ' (no Visual C++ to build the tools vcpkg runs with)' : '')
  );
  log.appendLine('  vcpkg: ' + toPosix(vcpkg.dir) + ' (' + vcpkg.source + '), CMAKE_TOOLCHAIN_FILE ' + vcpkg.toolchain);
}

module.exports = { shown, names, remember, chooseProject, pickKit, chooseKit, chooseVcpkg, logKitAndVcpkg };
