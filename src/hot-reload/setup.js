'use strict';

/**
 * What debugging a CMake project with QML hot reload takes: a debug configuration that
 * starts the program with -qmljsdebugger, and QT_QML_DEBUG in its Debug build -- without it
 * the program ignores -qmljsdebugger. Also a console for the Debug build, so qDebug() output
 * shows: Qt's templates make a GUI application, which has none on Windows.
 */

const path = require('path');
const { ON_TARGET, cmakeCommands, commandsWithDepth } = require('../cmake-syntax');
const { key, toPosix } = require('../paths');
const { eolOf, indentAt, lineEndAt, lineRange, startsLine } = require('../text');
const { parseQmlDebugger, qmlDebuggerValue } = require('./launch');

const CONFIGURATION_NAME = 'Debug Qt Application with QML hot reload';
const QML_DEBUGGER_ARG = '-qmljsdebugger=host:127.0.0.1,port:${command:qtWorkbench.qmlHotReloadPort},block,services:QmlPreview';

// Where Qt's binaries were built, which the Qt C++ extension maps to Qt's sources.
const QT_BUILD_DIRS = {
  win32: ['Q:/qt5_workdir/w/s', 'C:/work/build/qt5_workdir/w/s', 'c:/users/qt/work/qt', 'c:/Users/qt/work/install', '/Users/qt/work/qt'],
  linux: ['/home/qt/work/qt'],
  darwin: ['/Users/qt/work/qt']
};
const PLATFORM_KEYS = { win32: 'windows', linux: 'linux', darwin: 'osx' };

const CREATES = /^(?:qt6?_add_executable|add_executable)$/i;
const TRUE_CONSTANT = /^(?:1|ON|YES|TRUE|Y)$/i;
const CONSOLE_VALUE = '$<NOT:$<CONFIG:Debug>>';
const QML_DEBUG_COMMENT = '# Honour -qmljsdebugger in Debug builds: QML debugging, profiling and live preview / hot reload';
const CONSOLE_COMMENT = '# Console app in Debug so stdout/qDebug reach the terminal; GUI app otherwise';

/**
 * The debug configuration starting CMake Tools' launch target with QML hot reload, for this
 * `platform`. On Windows `kit` (presets/kits.js) decides the debugger: MinGW's gdb, or the
 * Visual Studio debugger for MSVC. `qtCpp` is whether the Qt C++ extension is installed,
 * whose commands name Qt's natvis file, sources and folders for the kit CMake Tools uses.
 */
function hotReloadConfiguration({ platform, kit, qtCpp }) {
  const msvc = platform === 'win32' && /^msvc/.test(kit.id);
  const configuration = {
    name: CONFIGURATION_NAME,
    type: msvc ? 'cppvsdbg' : 'cppdbg',
    request: 'launch',
    program: '${command:cmake.launchTargetPath}',
    args: [QML_DEBUGGER_ARG],
    stopAtEntry: false,
    cwd: '${workspaceFolder}'
  };
  if (qtCpp) {
    configuration.visualizerFile = '${command:qt-cpp.natvis}';
    if (!msvc) configuration.showDisplayString = true;
  }

  const system = {};
  if (qtCpp && QT_BUILD_DIRS[platform]) {
    system.sourceFileMap = Object.fromEntries(QT_BUILD_DIRS[platform].map((dir) => [dir, '${command:qt-cpp.sourceDirectory}']));
  }
  if (platform === 'win32') {
    // The kit's DLLs first, not those of another Qt on PATH.
    system.environment = qtCpp
      ? [
          { name: 'PATH', value: '${command:qt-cpp.qtDir};${env:PATH}' },
          { name: 'QT_QPA_PLATFORM_PLUGIN_PATH', value: '${command:qt-cpp.QT_QPA_PLATFORM_PLUGIN_PATH}' },
          { name: 'QML_IMPORT_PATH', value: '${command:qt-cpp.QML_IMPORT_PATH}' }
        ]
      : [{ name: 'PATH', value: toPosix(path.join(kit.dir, 'bin')) + ';${env:PATH}' }];
    if (!msvc) {
      system.MIMode = 'gdb';
      system.miDebuggerPath = toPosix(kit.gdb);
    }
  } else {
    system.MIMode = platform === 'darwin' ? 'lldb' : 'gdb';
  }
  if (PLATFORM_KEYS[platform]) configuration[PLATFORM_KEYS[platform]] = system;
  return configuration;
}

/** A new launch.json holding `configuration`, laid out as VS Code writes one. */
function newLaunchFile(configuration) {
  return JSON.stringify({ version: '0.2.0', configurations: [configuration] }, null, 4) + '\n';
}

/**
 * The names of the debug configurations in `configurations` that start the program for hot
 * reload: QmlPreview without the QML debugger's services. Their variables are not resolved
 * yet, so the port is not looked at.
 */
function hotReloadConfigurationNames(configurations) {
  return (Array.isArray(configurations) ? configurations : [])
    .filter((c) => {
      const value = c && qmlDebuggerValue(c.args);
      if (!value) return false;
      const { services, file } = parseQmlDebugger(value);
      return services.includes('QmlPreview') && !services.some((s) => /^(?:QmlDebugger|V8Debugger)$/.test(s)) && !file;
    })
    .map((c) => c.name);
}

/** The executable targets in a readCMakeProject() directory and its subdirectories, with the project() name in force there. */
function executables(directory, projectName) {
  const name = directory.name || projectName;
  return [
    ...directory.targets.filter((t) => t.type === 'executable').map((target) => ({ target, projectName: name })),
    ...directory.subdirectories.flatMap((sub) => executables(sub, name))
  ];
}

/** Where the WIN32_EXECUTABLE of a target is set last: {key, value} of a property, {keyword} of add_executable(... WIN32), or null. */
function win32Setting(commands, names, creating) {
  let setting = null;
  for (const c of commands) {
    if (/^set_target_properties$/i.test(c.name)) {
      const p = c.args.findIndex((a) => !a.quoted && a.text === 'PROPERTIES');
      if (p < 0 || !c.args.slice(0, p).some(names)) continue;
      for (let i = p + 1; i + 1 < c.args.length; i += 2) {
        if (c.args[i].text === 'WIN32_EXECUTABLE') setting = { key: c.args[i], value: c.args[i + 1] };
      }
    } else if (/^set_property$/i.test(c.name) && c.args[0] && c.args[0].text === 'TARGET') {
      const p = c.args.findIndex((a) => !a.quoted && a.text === 'PROPERTY');
      const targets = p < 0 ? [] : c.args.slice(1, p);
      if (!targets.some(names) || targets.some((a) => /^APPEND/.test(a.text))) continue;
      if (c.args[p + 1] && c.args[p + 1].text === 'WIN32_EXECUTABLE' && c.args[p + 2]) setting = { key: c.args[p + 1], value: c.args[p + 2] };
    } else if (creating.includes(c)) {
      const keyword = c.args.slice(1, 4).find((a) => !a.quoted && a.text === 'WIN32');
      if (keyword) setting = { keyword };
    }
  }
  return setting;
}

/** The edit taking the argument `arg` out: its line when it has one of its own, else it and the space before it. */
function removeArgument(text, arg) {
  const line = lineRange(text, arg.start);
  const rest = text.slice(arg.end, line.end);
  if (startsLine(text, arg.start) && /^[ \t]*\r?\n?$/.test(rest)) return { start: line.start, end: line.end, text: '' };
  if (startsLine(text, arg.start)) return { start: arg.start, end: arg.end + /^[ \t]*/.exec(rest)[0].length, text: '' };
  let start = arg.start;
  while (start > 0 && /[ \t]/.test(text[start - 1])) start--;
  return { start, end: arg.end, text: '' };
}

/**
 * What the executable targets of `project` (project-tree/cmake.js readCMakeProject) that
 * use QML still need in the CMakeLists.txt creating them: {changes, notes}. A change is
 * {kind, target, file, edits}, `kind` 'qmlDebug' or 'console' and `edits` [{start, end, text}]
 * offsets into the file's text as `readFile` returns it; `notes` say what needs nothing, and why.
 */
async function cmakeChanges(project, readFile) {
  const texts = new Map();
  const read = async (file) => {
    if (!texts.has(key(file))) texts.set(key(file), await readFile(file));
    return texts.get(key(file));
  };
  const changes = [];
  const notes = [];
  const found = executables(project, null);
  if (found.length === 0) notes.push('no executable target');

  for (const { target, projectName } of found) {
    const file = path.join(target.dir, 'CMakeLists.txt');
    const text = await read(file);
    const names = (arg) => Boolean(arg) && (arg.text === target.name || (arg.text === '${PROJECT_NAME}' && projectName === target.name));
    const commands = text === null ? [] : commandsWithDepth(text);
    const creating = commands.filter((c) => CREATES.test(c.name) && names(c.args[0]));
    if (creating.length === 0) {
      notes.push(target.name + ': no add_executable() or qt_add_executable() naming it in its CMakeLists.txt');
      continue;
    }
    const linksQml = (c) => /^target_link_libraries$/i.test(c.name) && names(c.args[0]) && c.args.some((a) => /\bQt[^\s:]*::(?:Qml|Quick)/.test(a.text));
    if (!target.files.some((f) => /\.qml$/i.test(f.path)) && !commands.some(linksQml)) {
      notes.push(target.name + ': uses no QML');
      continue;
    }

    // New commands go after the last one naming the target, in the outermost block that has one.
    const eol = eolOf(text);
    const naming = commands.filter((c) => ON_TARGET.test(c.name) && names(c.args[0]));
    const level = Math.min(...naming.map((c) => c.depth));
    const anchor = naming.filter((c) => c.depth === level).pop();
    const at = lineEndAt(text, anchor.close);
    const indent = indentAt(text, anchor.start);
    const spelled = creating[0].args[0].text;
    const block = (comment, line) => ({ start: at, end: at, text: eol + eol + indent + comment + eol + indent + line });

    const setting = win32Setting(commands, names, creating);
    if (setting && setting.keyword) {
      changes.push({
        kind: 'console',
        target: target.name,
        file,
        edits: [removeArgument(text, setting.keyword), block(CONSOLE_COMMENT, 'set_target_properties(' + spelled + ' PROPERTIES WIN32_EXECUTABLE ' + CONSOLE_VALUE + ')')]
      });
    } else if (setting && TRUE_CONSTANT.test(setting.value.text)) {
      const edits = [{ start: setting.value.start, end: setting.value.end, text: CONSOLE_VALUE }];
      if (startsLine(text, setting.key.start)) {
        const lineStart = lineRange(text, setting.key.start).start;
        edits.push({ start: lineStart, end: lineStart, text: indentAt(text, setting.key.start) + CONSOLE_COMMENT + eol });
      }
      changes.push({ kind: 'console', target: target.name, file, edits });
    } else {
      notes.push(target.name + ': ' + (setting ? 'WIN32_EXECUTABLE is ' + setting.value.text + ', left as it is' : 'a console application in every build'));
    }

    let defined = false;
    for (const list of project.lists) {
      const listText = await read(list);
      const definesIt = (c) => c.args.some((a) => /\bQT_QML_DEBUG\b/.test(a.text)) && (!/^target_/i.test(c.name) || names(c.args[0]));
      if (listText !== null && cmakeCommands(listText).some(definesIt)) defined = true;
    }
    if (defined) {
      notes.push(target.name + ': QT_QML_DEBUG is defined already');
    } else {
      const line = 'target_compile_definitions(' + spelled + ' PRIVATE $<$<CONFIG:Debug>:QT_QML_DEBUG>)';
      changes.push({ kind: 'qmlDebug', target: target.name, file, edits: [block(QML_DEBUG_COMMENT, line)] });
    }
  }
  return { changes, notes };
}

module.exports = { CONFIGURATION_NAME, hotReloadConfiguration, newLaunchFile, hotReloadConfigurationNames, cmakeChanges };
