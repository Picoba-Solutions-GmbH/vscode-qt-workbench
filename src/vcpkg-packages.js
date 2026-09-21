'use strict';

/**
 * Add vcpkg Package...: a port chosen among those of the vcpkg the project's presets build
 * with is added to vcpkg.json with vcpkg add port, installed with vcpkg install as a configure
 * with the preset installs it, and then found and linked in the CMakeLists.txt of a target, as
 * vcpkg's usage for it says. When vcpkg fails, vcpkg.json is put back as it was.
 *
 * Remove vcpkg Package...: packages chosen among the dependencies in vcpkg.json are taken out
 * of it, and what their usage adds out of the project's CMakeLists.txt files, in one edit; then
 * vcpkg install, which uninstalls what vcpkg.json no longer needs. vcpkg print-usage says what
 * the usage is, while the package is still installed.
 *
 * Running vcpkg is in vcpkg/tool.js, reading its usage in vcpkg/usage.js, the CMake edits in
 * vcpkg/cmake-edits.js.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { fileReader, saveFiles } = require('./documents');
const { IgnoreRules } = require('./ignore');
const { log } = require('./log');
const { key, toPosix } = require('./paths');
const { configurePresets, presetEnvironment, vcpkgOf } = require('./presets/configure-presets');
const { isVcpkgRoot } = require('./presets/vcpkg');
const { projectIo } = require('./project-explorer');
const { readCMakeProject } = require('./project-tree/cmake');
const { chooseProject, names, shown } = require('./setup-picks');
const { makeOffsetToPosition } = require('./text');
const { usageEdits, usageRemovals } = require('./vcpkg/cmake-edits');
const { databaseFiles, dependencyRemovals, installedFor, installedPackages, manifestDependencies } = require('./vcpkg/installed');
const { addPortArgs, availablePorts, installArgs, lastError, printUsageArgs, runVcpkg, vcpkgExecutable } = require('./vcpkg/tool');
const { ON_MAIN, recipes, usageCommands, usageOf } = require('./vcpkg/usage');

const SET_UP = 'Set Up vcpkg';
/** What the two commands say where they share their first steps. */
const ADD = {
  title: 'Add vcpkg Package',
  header: 'add a vcpkg package to ',
  again: 'add the package again',
  ignored: 'so no package is added to it',
  written: 'and vcpkg add port writes it',
  presetPlaceHolder: 'Configure preset to install the package for'
};
const REMOVE = {
  title: 'Remove vcpkg Package',
  header: 'remove vcpkg packages from ',
  again: 'remove the package again',
  ignored: 'so no package is removed from it',
  written: 'and removing a package writes it',
  presetPlaceHolder: 'Configure preset to uninstall the packages for',
  remove: true
};
const TITLE = ADD.title;
/** A port's name, as vcpkg allows it. */
const PORT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** chooseTarget's answer for a project without a target to use a package in. */
const NO_TARGET = { none: true };

async function readText(p) {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (_) {
    return null;
  }
}

async function exists(p) {
  try {
    await fs.promises.stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

function showLogButton(message, kind = 'showInformationMessage', ...buttons) {
  vscode.window[kind]('Qt Workbench: ' + message, ...buttons, 'Show Log').then((pick) => {
    if (pick === 'Show Log') log.show(true);
  });
}

/** The notification saying what was done, unless qtWorkbench.showSummary is off. */
function summary(message) {
  if (vscode.workspace.getConfiguration('qtWorkbench').get('showSummary', true)) showLogButton(message);
}

function logUsage(port, usage) {
  log.appendLine("  vcpkg's usage of " + port + ':');
  for (const line of usage.split('\n')) log.appendLine('    ' + line);
}

const refresh = () => vscode.commands.executeCommand('qtWorkbench.projectExplorer.refresh');

/** What adding a package needs first, said with Set Up vcpkg with CMake Presets offered. */
function offerSetUp(projectDir, message) {
  log.appendLine('  ! ' + message);
  vscode.window.showErrorMessage('Qt Workbench: ' + message, SET_UP).then((pick) => {
    if (pick === SET_UP) vscode.commands.executeCommand('qtWorkbench.setUpVcpkg', vscode.Uri.file(projectDir));
  });
}

function refuse(message) {
  log.appendLine('  ! ' + message);
  vscode.window.showErrorMessage('Qt Workbench: ' + message);
}

const presetPaths = (projectDir) => ['CMakePresets.json', 'CMakeUserPresets.json'].map((name) => path.join(projectDir, name));

/** The configure preset to run vcpkg for: the only one, CMake Tools' active one when it is among them, or one chosen. */
async function choosePreset(presets, how) {
  if (presets.length === 1) return presets[0];
  if (vscode.extensions.getExtension('ms-vscode.cmake-tools')) {
    let active;
    try {
      active = await vscode.commands.executeCommand('cmake.activeConfigurePresetName');
    } catch (_) {
      active = undefined;
    }
    const preset = presets.find((p) => p.name === active);
    if (preset) {
      log.appendLine('  ' + preset.name + ': the configure preset active in CMake Tools');
      return preset;
    }
  }
  const pick = await vscode.window.showQuickPick(
    presets.map((preset) => {
      const vcpkg = vcpkgOf(preset);
      return { label: preset.name, description: preset.displayName, detail: (vcpkg.triplet || "vcpkg's default triplet") + ' · ' + shown(vcpkg.installRoot), preset };
    }),
    { title: how.title, placeHolder: how.presetPlaceHolder, matchOnDescription: true, ignoreFocusOut: true }
  );
  return pick ? pick.preset : null;
}

/** The port to add: one of the vcpkg in `root`, or one typed in. */
async function choosePort(root, dependencies) {
  const ports = await availablePorts(root);
  const listed = new Set(dependencies.map((d) => d.name));
  const items = ports.map((port) => ({
    label: port.name,
    description: [port.version, listed.has(port.name) ? 'in vcpkg.json' : ''].filter(Boolean).join(' · '),
    detail: port.description || undefined,
    port: port.name
  }));
  if (items.length > 0) items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: '$(edit) Another Port...', description: 'of another registry, or an overlay port', other: true });
  const pick = await vscode.window.showQuickPick(items, {
    title: TITLE,
    placeHolder: ports.length > 0 ? 'Port to add to vcpkg.json and install' : 'No ports in ' + toPosix(path.join(root, 'ports')) + ': type the name of one',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true
  });
  if (!pick) return null;
  if (!pick.other) return pick.port;
  const problem = (text) => (PORT_NAME.test(text.trim()) ? undefined : 'A port name has lower case letters, digits and dashes.');
  const input = await vscode.window.showInputBox({ title: TITLE, prompt: 'The port to add, as vcpkg add port takes it', placeHolder: 'fmt', validateInput: problem });
  return input === undefined || problem(input) ? null : input.trim();
}

/** The targets of a readCMakeProject() directory and its subdirectories a package can be used in, with the project() name in force there. */
function targetsOf(directory, projectName) {
  const name = directory.name || projectName;
  return [
    ...directory.targets.filter((t) => t.type !== 'custom').map((target) => ({ target, projectName: name })),
    ...directory.subdirectories.flatMap((sub) => targetsOf(sub, name))
  ];
}

/** The target to use the package in: the one named `wanted`, the only one, or one chosen. NO_TARGET when there is none, null when none was chosen. */
async function chooseTarget(project, wanted) {
  const targets = project ? targetsOf(project, null) : [];
  const named = targets.find((t) => t.target.name === wanted);
  if (named) return named;
  if (targets.length === 0) return NO_TARGET;
  if (targets.length === 1) return targets[0];
  const order = { executable: 0, library: 1, plugin: 2 };
  const pick = await vscode.window.showQuickPick(
    targets
      .slice()
      .sort((a, b) => order[a.target.type] - order[b.target.type])
      .map((t) => ({ label: t.target.name, description: t.target.type + ' in ' + shown(path.join(t.target.dir, 'CMakeLists.txt')), choice: t })),
    { title: TITLE, placeHolder: 'Target to find and link the package for', ignoreFocusOut: true }
  );
  return pick ? pick.choice : null;
}

/** The recipes of vcpkg's usage to add: the only one, else those chosen, the first needing no pkg-config checked. Null when none was chosen. */
async function chooseRecipes(found, port, targetName) {
  if (found.length <= 1) return found;
  const preferred = found.find((r) => !r.commands.some((c) => /^pkg_/.test(c.name))) || found[0];
  const items = found.map((recipe) => ({
    label: recipe.commands
      .filter((c) => ON_MAIN.test(c.name))
      .flatMap((c) => c.args.slice(1).filter((a) => !/^(?:PRIVATE|PUBLIC|INTERFACE)$/.test(a.text)).map((a) => c.text.slice(a.start, a.end)))
      .join(' '),
    description: recipe.label || undefined,
    detail: recipe.commands.map((c) => c.text).join('  '),
    picked: recipe === preferred,
    recipe
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    title: TITLE,
    placeHolder: 'vcpkg shows several ways to use ' + port + ': those to add for ' + targetName,
    canPickMany: true,
    ignoreFocusOut: true
  });
  return chosen && chosen.length > 0 ? chosen.map((item) => item.recipe) : null;
}

/** The packages vcpkg installed in `installRoot`, as installedPackages() gives them. */
async function installedIn(installRoot) {
  let updates = [];
  try {
    updates = await fs.promises.readdir(path.join(installRoot, 'vcpkg', 'updates'));
  } catch (_) {
    // no updates yet
  }
  const texts = (await Promise.all(databaseFiles(installRoot, updates).map(readText))).filter((t) => t !== null);
  return installedPackages(texts);
}

/** The package `port` as vcpkg installed it in `installRoot`, for `triplet` if it can, or null. */
async function installedPackage(installRoot, port, triplet) {
  const found = [...(await installedIn(installRoot)).values()].filter((p) => p.name === port);
  return found.find((p) => p.triplet === triplet) || found[0] || null;
}

/**
 * The first steps of both commands, `how` saying which: the project, and its vcpkg.json when it
 * can be written: {rules, readFile, projectDir, listFile, manifestPath, manifestName,
 * manifestText, dependencies}. Null, said why, when it can't.
 */
async function readManifest(uri, how) {
  const rules = await IgnoreRules.load();
  const readFile = fileReader();
  const projectDir = await chooseProject(uri, rules, readFile, how.title);
  if (!projectDir) return null;
  const listFile = path.join(projectDir, 'CMakeLists.txt');
  const manifestPath = path.join(projectDir, 'vcpkg.json');
  const manifestName = shown(manifestPath);
  const projectName = shown(projectDir) || path.basename(projectDir);
  log.header(how.header + shown(listFile));

  await rules.classify([manifestPath, ...presetPaths(projectDir)]);
  if (rules.isIgnored(manifestPath)) {
    refuse(manifestName + ' is ignored by git or inside a build folder, ' + how.ignored + '.');
    return null;
  }
  const manifestText = await readFile(manifestPath);
  if (manifestText === null) {
    if (how.remove) refuse(projectName + ' has no vcpkg.json, so it has no vcpkg package to remove.');
    else offerSetUp(projectDir, projectName + ' has no vcpkg.json. Set up vcpkg for it first.');
    return null;
  }
  if (vscode.workspace.textDocuments.some((d) => d.isDirty && key(d.uri.fsPath) === key(manifestPath))) {
    refuse(manifestName + ' has unsaved changes, ' + how.written + '. Save it, then ' + how.again + '.');
    return null;
  }
  let dependencies;
  try {
    dependencies = manifestDependencies(manifestText);
  } catch (err) {
    refuse(manifestName + ' cannot be read: ' + err.message + '. Fix it, then ' + how.again + '.');
    return null;
  }
  return { rules, readFile, projectDir, listFile, manifestPath, manifestName, manifestText, dependencies };
}

/**
 * The configure preset to run vcpkg for, and the vcpkg it builds with, for the project
 * readManifest() read: {preset, vcpkg, exe}. Null, said why, when there is none to run.
 */
async function chooseVcpkg({ rules, readFile, projectDir }, how) {
  const presetFiles = [];
  for (const file of presetPaths(projectDir)) {
    const text = rules.isIgnored(file) ? null : await readFile(file);
    if (text !== null) presetFiles.push({ path: file, text });
    else if (rules.isIgnored(file) && (await exists(file))) log.appendLine('  ' + shown(file) + ': ignored by git, not read');
  }
  const presets = configurePresets(presetFiles, projectDir, process.env, process.platform).filter((p) => !p.hidden && vcpkgOf(p));
  if (presets.length === 0) {
    const none = 'no configure preset of ' + (shown(projectDir) || path.basename(projectDir)) + " builds with vcpkg's toolchain file, so where vcpkg ";
    if (how.remove) refuse(none + 'installed its packages is not known.');
    else offerSetUp(projectDir, none + 'installs for the build is not known. Set up vcpkg first.');
    return null;
  }
  const preset = await choosePreset(presets, how);
  if (!preset) return null;
  const vcpkg = vcpkgOf(preset);
  log.appendLine(
    '  configure preset ' + preset.name + ': vcpkg ' + toPosix(vcpkg.root) + ', triplet ' + (vcpkg.triplet || "vcpkg's default") +
      (vcpkg.hostTriplet ? ', host triplet ' + vcpkg.hostTriplet : '') + (vcpkg.installRoot ? ', installs into ' + shown(vcpkg.installRoot) : '')
  );
  if (!vcpkg.installRoot) {
    refuse(preset.name + ' has no binaryDir, so the folder vcpkg installs into when CMake configures is not known.');
    return null;
  }
  if (!(await isVcpkgRoot(vcpkg.root))) {
    refuse(preset.name + ' builds with the vcpkg in ' + toPosix(vcpkg.root) + ', which is no vcpkg folder: it has no .vcpkg-root and scripts/buildsystems/vcpkg.cmake.');
    return null;
  }
  const exe = vcpkgExecutable(vcpkg.root, process.platform);
  if (!(await exists(exe))) {
    const bootstrap = process.platform === 'win32' ? 'bootstrap-vcpkg.bat' : 'bootstrap-vcpkg.sh';
    refuse(toPosix(vcpkg.root) + ' has no ' + path.basename(exe) + ' yet. Run ' + bootstrap + ' in it, then ' + how.again + '.');
    return null;
  }
  return { preset, vcpkg, exe };
}

/** Run vcpkg with `args` in the project folder, `message` on the notification and its output in the log as it comes. */
function runLogged(exe, args, { cwd, env, progress, token, message }) {
  progress.report({ message });
  log.appendLine('  $ vcpkg ' + args.join(' '));
  return runVcpkg(exe, args, { cwd, env, platform: process.platform, token, onLine: (line) => log.appendLine('    ' + line) });
}

/** Why a vcpkg run that did not succeed failed, as the log and the notifications say it. */
function failure(result) {
  return result.stopped ? 'was stopped' : result.error ? 'could not run: ' + result.error : 'failed: ' + (lastError(result.output) || 'exit code ' + result.code);
}

async function addVcpkgPackage(uri, options) {
  const manifest = await readManifest(uri, ADD);
  if (!manifest) return;
  const { rules, readFile, projectDir, listFile, manifestPath, manifestName, manifestText, dependencies } = manifest;
  const setup = await chooseVcpkg(manifest, ADD);
  if (!setup) return;
  const { preset, vcpkg, exe } = setup;

  const port = await choosePort(vcpkg.root, dependencies);
  if (!port) return;
  const project = await readCMakeProject(listFile, projectIo(rules, []));
  const choice = await chooseTarget(project, options && options.target);
  if (!choice) return;
  log.appendLine('  port: ' + port + (choice === NO_TARGET ? ', for no target: the project has none' : ', for ' + choice.target.name));

  const env = presetEnvironment(preset, process.env, process.platform);
  log.show(true);
  const { step, result } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Qt Workbench: ' + port, cancellable: true },
    async (progress, token) => {
      const run = (args, message) => runLogged(exe, args, { cwd: projectDir, env, progress, token, message });
      const added = await run(addPortArgs(vcpkg.root, port), 'vcpkg add port ' + port);
      if (added.code !== 0) return { step: 'add port', result: added };
      const args = installArgs({ root: vcpkg.root, manifestDir: projectDir, installRoot: vcpkg.installRoot, triplet: vcpkg.triplet, hostTriplet: vcpkg.hostTriplet });
      return { step: 'install', result: await run(args, 'vcpkg install for ' + preset.name + '. The log shows its output.') };
    }
  );

  const listedBefore = dependencies.some((d) => d.name === port);
  if (result.code !== 0) {
    const manifestNow = await readText(manifestPath);
    const restored = manifestNow !== null && manifestNow !== manifestText;
    if (restored) await fs.promises.writeFile(manifestPath, manifestText, 'utf8');
    const why = failure(result);
    log.appendLine('  ! vcpkg ' + step + ' ' + why);
    if (restored) log.appendLine('  ' + manifestName + ': put back as it was');
    const undone = !restored ? '' : listedBefore ? manifestName + ' is put back as it was, and ' : port + ' is taken out of ' + manifestName + ' again, and ';
    showLogButton('vcpkg ' + step + ' ' + why + '. ' + undone + 'CMakeLists.txt is not changed.', 'showErrorMessage');
    refresh();
    return;
  }
  log.appendLine('  ' + manifestName + ': ' + port + (listedBefore ? ' was in it already' : ' added'));
  const pkg = await installedPackage(vcpkg.installRoot, port, vcpkg.triplet);
  if (pkg) log.appendLine('  installed: ' + pkg.name + ':' + pkg.triplet + '@' + pkg.version);
  refresh();
  const installedWith = 'installed ' + port + ' with vcpkg for ' + preset.name;

  if (choice === NO_TARGET) {
    summary(installedWith + '. The project has no target to link it to.');
    return;
  }
  const usage = usageOf(port, result.output, pkg ? await readText(path.join(vcpkg.installRoot, pkg.triplet, 'share', port, 'usage')) : null);
  if (usage === null) {
    log.appendLine('  vcpkg says nothing about using ' + port + ' from CMake: CMakeLists.txt not changed');
    summary(installedWith + '. vcpkg says nothing about using it from CMake, so CMakeLists.txt is not changed.');
    return;
  }
  logUsage(port, usage);
  const found = recipes(usage);
  if (found.length === 0) {
    log.appendLine("  ! vcpkg's usage names no target_link_libraries(main ...) or the like outside if(): CMakeLists.txt not changed");
    summary(installedWith + ". Its usage has nothing to add to CMakeLists.txt by itself: the log shows it.");
    return;
  }
  const chosen = await chooseRecipes(found, port, choice.target.name);
  if (!chosen) {
    log.appendLine('  no way to use it chosen: CMakeLists.txt not changed');
    return;
  }

  const target = choice.target;
  const file = path.join(target.dir, 'CMakeLists.txt');
  const text = await readFile(file);
  const above = [];
  for (const list of project.lists) {
    const dir = path.dirname(list);
    if (key(dir) !== key(target.dir) && (key(target.dir) + path.sep).startsWith(key(dir) + path.sep)) above.push((await readFile(list)) || '');
  }
  const change = text === null ? { edits: [], added: [], present: [], notes: ['it cannot be read'] } : usageEdits(text, chosen.flatMap((r) => r.commands), { name: target.name, projectName: choice.projectName }, above);
  for (const recipe of chosen) for (const skipped of recipe.skipped) log.appendLine('  not added, as it is no find or target command: ' + skipped);
  for (const present of change.present) log.appendLine('  ' + shown(file) + ': ' + present + ' already there');
  for (const note of change.notes) log.appendLine('  ! ' + shown(file) + ': ' + note + ', so nothing is added');
  if (change.edits.length === 0) {
    const why = change.notes.length > 0 ? 'Add it to ' + shown(file) + ' by hand: the log shows how.' : shown(file) + ' finds and links it for ' + target.name + ' already.';
    summary(installedWith + '. ' + why);
    return;
  }

  const fileUri = vscode.Uri.file(file);
  const toPosition = makeOffsetToPosition(text);
  const edit = new vscode.WorkspaceEdit();
  for (const e of change.edits) edit.replace(fileUri, new vscode.Range(toPosition(e.start), toPosition(e.end)), e.text);
  const dirtyBefore = vscode.workspace.textDocuments.some((d) => d.isDirty && key(d.uri.fsPath) === key(file));
  if (!(await vscode.workspace.applyEdit(edit))) {
    refuse('could not change ' + shown(file) + '. ' + port + ' is installed: add it by hand, as the log shows.');
    return;
  }
  for (const added of change.added) log.appendLine('  * ' + shown(file) + ': ' + added);
  if (vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true) && !dirtyBefore) await saveFiles([fileUri]);
  summary(installedWith + ', and ' + shown(file) + ' finds and links it for ' + target.name + ': ' + names(change.added) + '.');
}

/** The dependencies in vcpkg.json to remove, chosen; each with what `packageOf` says is installed for it. Null when none was chosen. */
async function choosePackages(dependencies, packageOf) {
  const items = dependencies.map((dependency) => {
    const pkg = packageOf(dependency);
    return {
      label: dependency.name,
      description: [pkg ? pkg.version : 'not installed', dependency.host ? 'host' : ''].filter(Boolean).join(' · '),
      detail: (pkg && pkg.description) || undefined,
      port: dependency.name
    };
  });
  const chosen = await vscode.window.showQuickPick(items, {
    title: REMOVE.title,
    placeHolder: 'Packages to take out of vcpkg.json and uninstall',
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true
  });
  return chosen && chosen.length > 0 ? [...new Set(chosen.map((item) => item.port))] : null;
}

async function removeVcpkgPackages(uri, options) {
  const manifest = await readManifest(uri, REMOVE);
  if (!manifest) return;
  const { rules, readFile, projectDir, listFile, manifestPath, manifestName, manifestText, dependencies } = manifest;
  if (dependencies.length === 0) {
    refuse(manifestName + ' has no dependencies, so there is no package to remove.');
    return;
  }
  let ports = options && Array.isArray(options.ports) ? [...new Set(options.ports)] : null;
  if (ports) {
    const missing = ports.filter((port) => !dependencies.some((d) => d.name === port));
    ports = ports.filter((port) => !missing.includes(port));
    if (ports.length === 0) {
      refuse(names(missing) + (missing.length > 1 ? ' are' : ' is') + ' not in ' + manifestName + ', so there is nothing to remove.');
      return;
    }
    for (const port of missing) log.appendLine('  ' + port + ': not in ' + manifestName + ', left alone');
  }
  const setup = await chooseVcpkg(manifest, REMOVE);
  if (!setup) return;
  const { preset, vcpkg, exe } = setup;
  const installed = await installedIn(vcpkg.installRoot);
  const packageOf = (dependency) => installedFor(installed, dependency, vcpkg.triplet, vcpkg.hostTriplet);
  const specOf = (pkg) => pkg.name + ':' + pkg.triplet;
  if (!ports) ports = await choosePackages(dependencies, packageOf);
  if (!ports) return;
  const what = names(ports);
  const them = ports.length > 1 ? 'them' : 'it';
  log.appendLine('  ports: ' + ports.join(', '));

  // What vcpkg says about using each package, while it is installed: the usage of those that
  // go is taken out of CMakeLists.txt, except what the usage of those that stay has too.
  const env = presetEnvironment(preset, process.env, process.platform);
  const usageOfPackage = async (pkg) => {
    const spec = specOf(pkg);
    const result = await runVcpkg(exe, printUsageArgs(vcpkg.root, vcpkg.installRoot, spec), { cwd: projectDir, env, platform: process.platform, onLine: () => {} });
    if (result.code === 0) return result.output.replace(/\s+$/, '');
    const file = await readText(path.join(vcpkg.installRoot, pkg.triplet, 'share', pkg.name, 'usage'));
    log.appendLine('  vcpkg print-usage ' + spec + ' ' + failure(result) + (file === null ? ', and it installed no usage file' : ': its usage file is read instead'));
    return file;
  };
  const usages = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Qt Workbench: vcpkg print-usage' }, async () => {
    const out = [];
    for (const dependency of dependencies) {
      const pkg = packageOf(dependency);
      out.push({ dependency, pkg, goes: ports.includes(dependency.name), usage: pkg ? await usageOfPackage(pkg) : null });
    }
    return out;
  });
  const going = usages.filter((u) => u.goes);
  const unknown = [];
  for (const u of going) {
    if (u.usage !== null) logUsage(u.dependency.name, u.usage);
    else if (!u.pkg) log.appendLine('  ! ' + u.dependency.name + ' is not installed in ' + shown(vcpkg.installRoot) + ", so its usage is not known: CMakeLists.txt keeps whatever uses it");
    else log.appendLine('  ! what vcpkg says about using ' + u.dependency.name + ' is not known: CMakeLists.txt keeps whatever uses it');
    if (u.usage === null) unknown.push(u.dependency.name);
  }

  const project = await readCMakeProject(listFile, projectIo(rules, []));
  const lists = project ? project.lists.filter((file) => !rules.isIgnored(file)) : [];
  const texts = [];
  for (const file of lists) texts.push((await readFile(file)) || '');
  const keep = usages.filter((u) => !u.goes && u.usage !== null).map((u) => ({ port: u.dependency.name, commands: usageCommands(u.usage) }));
  const changes = usageRemovals(texts, going.flatMap((u) => (u.usage === null ? [] : usageCommands(u.usage))), keep).map((change, i) => ({
    ...change,
    file: lists[i],
    text: texts[i]
  }));
  const edited = changes.filter((c) => c.edits.length > 0);
  const manifestEdits = dependencyRemovals(manifestText, ports).edits;

  // A package that one staying installed depends on stays installed: vcpkg install is for the others.
  const needs = new Map(); // 'name:triplet' -> the packages staying installed that depend on it
  const visit = (pkg, seen) => {
    for (const spec of pkg.depends) {
      if (!needs.has(spec)) needs.set(spec, []);
      if (!needs.get(spec).includes(pkg.name)) needs.get(spec).push(pkg.name);
      const dependency = installed.get(spec);
      if (dependency && !seen.has(spec)) visit(dependency, seen.add(spec));
    }
  };
  for (const u of usages.filter((u) => !u.goes && u.pkg)) visit(u.pkg, new Set());
  const needing = (spec) => needs.get(spec) || [];
  const keepsInstalled = (name, by) => 'vcpkg keeps ' + name + ' installed' + (by.length > 0 ? ': ' + names(by) + (by.length > 1 ? ' need' : ' needs') + ' it' : '') + '.';
  const dependsOn = (by) => (by.length > 0 ? ': ' + names(by) + (by.length > 1 ? ' depend' : ' depends') + ' on it' : '');
  const uninstalling = going.filter((u) => u.pkg && !needs.has(specOf(u.pkg)));
  const keptInstalled = going.filter((u) => u.pkg && needs.has(specOf(u.pkg))).map((u) => keepsInstalled(u.dependency.name, needing(specOf(u.pkg))));
  const notInstalled = going.filter((u) => !u.pkg).map((u) => u.dependency.name);

  // Nothing is written before the user has seen all of it.
  const detail = [manifestName + ': ' + what + (ports.length > 1 ? ' are' : ' is') + ' taken out.'];
  for (const c of edited) detail.push(shown(c.file) + ': ' + names(c.removed) + (c.removed.length > 1 ? ' are' : ' is') + ' taken out.');
  for (const c of changes) for (const [kept, why] of c.kept) detail.push(shown(c.file) + ' keeps ' + kept + ': ' + why + '.');
  if (unknown.length > 0) detail.push('What vcpkg says about using ' + names(unknown) + ' is not known, so CMakeLists.txt keeps whatever uses ' + (unknown.length > 1 ? 'them' : 'it') + ': the log says why.');
  else if (edited.length === 0 && changes.every((c) => c.kept.length === 0)) detail.push('No CMakeLists.txt uses what vcpkg says about using ' + them + '.');
  if (uninstalling.length > 0) {
    const which = uninstalling.length === ports.length ? them : names(uninstalling.map((u) => u.dependency.name));
    detail.push('Then vcpkg install uninstalls ' + which + ' from ' + shown(vcpkg.installRoot) + ', for ' + preset.name + '.');
  }
  detail.push(...keptInstalled);
  if (notInstalled.length > 0) detail.push('vcpkg has not installed ' + names(notInstalled) + ' for ' + preset.name + '.');
  const button = 'Remove';
  const answer = await vscode.window.showWarningMessage(
    'Remove the vcpkg package' + (ports.length > 1 ? 's ' : ' ') + what + '?',
    { modal: true, detail: detail.join('\n') },
    button
  );
  if (answer !== button) {
    log.appendLine('  not removed: cancelled');
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const replace = (file, text, edits) => {
    const uri = vscode.Uri.file(file);
    const toPosition = makeOffsetToPosition(text);
    for (const e of edits) edit.replace(uri, new vscode.Range(toPosition(e.start), toPosition(e.end)), e.text);
  };
  replace(manifestPath, manifestText, manifestEdits);
  for (const c of edited) replace(c.file, c.text, c.edits);
  const dirtyBefore = new Set(vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => key(d.uri.fsPath)));
  if (!(await vscode.workspace.applyEdit(edit))) {
    refuse('could not change ' + names([manifestName, ...edited.map((c) => shown(c.file))]) + ', so nothing is removed.');
    return;
  }
  log.appendLine('  * ' + manifestName + ': ' + what + ' taken out');
  for (const c of edited) for (const removed of c.removed) log.appendLine('  * ' + shown(c.file) + ': ' + removed + ' taken out');
  for (const c of changes) for (const [kept, why] of c.kept) log.appendLine('  ' + shown(c.file) + ': ' + kept + ' stays, as ' + why);
  // vcpkg reads vcpkg.json from disk, so it is saved whatever files.refactoring.autoSave says.
  const autoSave = vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true);
  await saveFiles([vscode.Uri.file(manifestPath), ...edited.filter((c) => autoSave && !dirtyBefore.has(key(c.file))).map((c) => vscode.Uri.file(c.file))]);

  const changed = names([manifestName, ...edited.map((c) => shown(c.file))]);
  const notKnown = unknown.length === 0 ? '' : ' What vcpkg says about using ' + names(unknown) + ' is not known, so CMakeLists.txt may still use ' + (unknown.length > 1 ? 'them' : 'it') + ': the log says why.';
  const tell = (message) => (unknown.length > 0 ? showLogButton(message + notKnown, 'showWarningMessage') : summary(message));
  for (const u of going.filter((u) => u.pkg && needs.has(specOf(u.pkg)))) log.appendLine('  ' + specOf(u.pkg) + ' stays installed' + dependsOn(needing(specOf(u.pkg))));
  const notThere = notInstalled.length > 0 ? ' vcpkg has not installed ' + names(notInstalled) + ' for ' + preset.name + '.' : '';
  if (uninstalling.length === 0) {
    log.appendLine('  nothing to uninstall: vcpkg install not run');
    refresh();
    tell('removed ' + what + ' from ' + changed + '.' + keptInstalled.map((s) => ' ' + s).join('') + notThere);
    return;
  }

  log.show(true);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Qt Workbench: ' + what, cancellable: true },
    (progress, token) => {
      const args = installArgs({ root: vcpkg.root, manifestDir: projectDir, installRoot: vcpkg.installRoot, triplet: vcpkg.triplet, hostTriplet: vcpkg.hostTriplet });
      return runLogged(exe, args, { cwd: projectDir, env, progress, token, message: 'vcpkg install for ' + preset.name + '. The log shows its output.' });
    }
  );
  refresh();
  if (result.code !== 0) {
    const why = failure(result);
    log.appendLine('  ! vcpkg install ' + why);
    showLogButton('vcpkg install ' + why + '. ' + what + (ports.length > 1 ? ' are' : ' is') + ' taken out of ' + changed + ' all the same: the next configure uninstalls ' + them + '.', 'showErrorMessage');
    return;
  }

  // What vcpkg did, from its database: a package still installed is one another still needs.
  const after = await installedIn(vcpkg.installRoot);
  const gone = [];
  for (const { pkg } of uninstalling) {
    const spec = specOf(pkg);
    if (!after.has(spec)) {
      log.appendLine('  uninstalled: ' + spec);
      gone.push(pkg.name);
      continue;
    }
    const by = [...after.values()].filter((p) => p.depends.includes(spec)).map((p) => p.name);
    log.appendLine('  ' + spec + ' stays installed' + dependsOn(by));
    keptInstalled.push(keepsInstalled(pkg.name, by));
  }
  const uninstalled = gone.length === 0 ? '' : ', and vcpkg uninstalled ' + (gone.length === ports.length ? them : names(gone)) + ' for ' + preset.name;
  tell('removed ' + what + ' from ' + changed + uninstalled + '.' + keptInstalled.map((s) => ' ' + s).join('') + notThere);
}

/** A command that logs what went wrong instead of failing silently. */
function command(id, run) {
  return vscode.commands.registerCommand(id, async (uri, options) => {
    try {
      await run(uri, options);
    } catch (err) {
      log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
      vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
    }
  });
}

function registerVcpkgPackages(context) {
  context.subscriptions.push(command('qtWorkbench.addVcpkgPackage', addVcpkgPackage), command('qtWorkbench.removeVcpkgPackage', removeVcpkgPackages));
}

module.exports = { registerVcpkgPackages };
