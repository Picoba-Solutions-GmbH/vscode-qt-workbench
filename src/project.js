'use strict';

/**
 * What the project looks like around a move or a class rename: the files to scan,
 * include roots, the QML type index and the qt_add_qml_module declarations. What to
 * leave out of the scan is decided in ignore.js.
 */

const vscode = require('vscode');
const path = require('path');
const { extOf, isCppFile, isQmlTypeName, key } = require('./paths');

const SCAN_GLOB =
  '**/{CMakeLists.txt,qmldir,*.cmake,*.pro,*.pri,*.prf,*.qrc,*.ui,*.qml,*.js,*.mjs,' +
  '*.c,*.cc,*.cpp,*.cxx,*.m,*.mm,*.h,*.hh,*.hpp,*.hxx,*.inl,*.ipp}';

/** Include roots Qt sets up implicitly: every workspace root and every CMake dir. */
function collectProjectRoots(ctx, buildFiles) {
  const roots = new Map();
  for (const folder of vscode.workspace.workspaceFolders || []) {
    roots.set(key(folder.uri.fsPath), folder.uri.fsPath);
  }
  for (const bf of buildFiles) {
    if (path.basename(bf.fsPath).toLowerCase() === 'cmakelists.txt') {
      const dir = path.dirname(bf.fsPath);
      roots.set(key(dir), dir);
    }
  }
  ctx.includeRoots = [...roots.values()];
}

/**
 * Index every .qml file by the type name it defines, both where it lives now and
 * where it will live after the move, and count .qml files per directory, so
 * imports can follow the types a file actually uses.
 */
function buildTypeIndexes(ctx, candidates) {
  const add = (index, typeName, dir) => {
    if (!index.has(typeName)) index.set(typeName, new Map());
    index.get(typeName).set(key(dir), dir);
  };
  const count = (counts, k) => counts.set(k, (counts.get(k) || 0) + 1);
  for (const uri of candidates) {
    const p = uri.fsPath;
    count(ctx.basenameCount, path.basename(p).toLowerCase());
    if (extOf(p) !== '.qml') continue;

    const newPath = ctx.mapPath(p);
    const before = path.dirname(p);
    const after = path.dirname(newPath);
    count(ctx.qmlCountBefore, key(before));
    count(ctx.qmlCountAfter, key(after));
    // Each side is keyed by the name the file has on that side, so a rename
    // moves the type to its new name in the after-index.
    const nameBefore = path.basename(p, path.extname(p));
    const nameAfter = path.basename(newPath, path.extname(newPath));
    if (isQmlTypeName(nameBefore)) add(ctx.typeIndexBefore, nameBefore, before);
    if (isQmlTypeName(nameAfter)) add(ctx.typeIndexAfter, nameAfter, after);
  }
}

/** The arguments of a CMake command, unquoted, without comments. */
function cmakeArgs(raw) {
  return raw
    .replace(/#[^\n]*/g, '')
    .split(/\s+/)
    .map((token) => token.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/** A source entry as a path, or null for keywords and paths that depend on variables. */
function cmakeSourcePath(dir, entry) {
  const plain = entry.replace(/^\$\{CMAKE_CURRENT_(?:SOURCE|LIST)_DIR\}[\\/]/, '');
  if (plain.includes('$') || !isCppFile(plain)) return null;
  return path.resolve(dir, plain);
}

/**
 * Find qt_add_qml_module(... URI Foo.Bar ... QML_FILES a.qml b.qml ...), so qrc:/
 * URLs can be translated and it is known which .qml files share a module -- the
 * files of one module see each other's types without any import.
 *
 * C++ sources belong to a module through its target: a QML_ELEMENT class is
 * registered in the module of whichever target compiles it, whether it is listed
 * under SOURCES or in qt_add_executable / add_library / target_sources.
 */
async function collectQmlModules(ctx, buildFiles, readFile) {
  const targetUris = new Map(); // target -> [URI]
  const targetSources = new Map(); // target -> [source path]
  const addSource = (target, p) => {
    if (!targetSources.has(target)) targetSources.set(target, []);
    targetSources.get(target).push(p);
  };

  for (const bf of buildFiles) {
    if (path.basename(bf.fsPath).toLowerCase() !== 'cmakelists.txt') continue;
    const text = await readFile(bf.fsPath);
    if (!text) continue;
    const dir = path.dirname(bf.fsPath);
    const re = /qt\d*_add_qml_module\s*\(([\s\S]*?)\)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const uri = /(?:^|\s)URI\s+"?([A-Za-z_][\w.]*)"?/i.exec(m[1]);
      if (!uri) continue;
      ctx.qmlModules.push({ uri: uri[1], dir });
      const args = cmakeArgs(m[1]);
      if (!targetUris.has(args[0])) targetUris.set(args[0], []);
      targetUris.get(args[0]).push(uri[1]);

      // Each file list runs until the next all-caps keyword (SOURCES, RESOURCES, ...).
      let section = null;
      for (const entry of args.slice(1)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(entry)) {
          section = entry;
        } else if (section === 'QML_FILES' && extOf(entry) === '.qml' && !entry.includes('$')) {
          ctx.qmlModuleMembers.set(key(path.resolve(dir, entry)), uri[1]);
        } else if (section === 'SOURCES') {
          const source = cmakeSourcePath(dir, entry);
          if (source) addSource(args[0], source);
        }
      }
    }

    const targets = /\b(?:qt\d*_add_executable|qt\d*_add_library|add_executable|add_library|target_sources)\s*\(([\s\S]*?)\)/gi;
    while ((m = targets.exec(text)) !== null) {
      const args = cmakeArgs(m[1]);
      for (const entry of args.slice(1)) {
        const source = cmakeSourcePath(dir, entry);
        if (source) addSource(args[0], source);
      }
    }
  }

  for (const [target, uris] of targetUris) {
    for (const source of targetSources.get(target) || []) {
      const k = key(source);
      ctx.cppModuleMembers.set(k, [...new Set((ctx.cppModuleMembers.get(k) || []).concat(uris))]);
    }
  }
}

/**
 * The QML modules a C++ file's types are registered in: those of the targets that
 * list it, or -- as AUTOMOC picks up the header of a listed foo.cpp -- that list a
 * source of the same name next to it.
 */
function cppModulesOf(ctx, filePath) {
  const direct = ctx.cppModuleMembers.get(key(filePath));
  if (direct) return direct;
  const stem = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)));
  const uris = new Set();
  for (const ext of ['.cpp', '.cc', '.cxx', '.c', '.mm']) {
    for (const uri of ctx.cppModuleMembers.get(key(stem + ext)) || []) uris.add(uri);
  }
  return [...uris];
}

module.exports = { SCAN_GLOB, collectProjectRoots, buildTypeIndexes, collectQmlModules, cppModulesOf };
