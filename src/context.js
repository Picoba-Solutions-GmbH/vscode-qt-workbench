'use strict';

/**
 * Everything the rewriters need to know about one rename: which files move where,
 * directory moves expanded to their files, and which QML types get a new name.
 * A C++ class rename moves no files; its context carries only the type rename.
 */

const vscode = require('vscode');
const path = require('path');
const { log } = require('./log');
const { extOf, isQmlTypeName, key } = require('./paths');

class MoveContext {
  constructor() {
    this.fileMoves = []; // [{oldPath, newPath}], leaves only
    this.dirMoves = []; // [{oldPath, newPath}], renamed directories
    this.moveMap = new Map(); // key(oldPath) -> newPath
    this.existsCache = new Map();
    this.includeRoots = []; // dirs an #include "..." may be resolved against
    this.qmlModules = []; // [{uri, dir}] from qt_add_qml_module
    this.typeIndexBefore = new Map(); // TypeName -> Map(dirKey -> dir), pre-move
    this.typeIndexAfter = new Map(); // TypeName -> Map(dirKey -> dir), post-move
    this.qmlCountBefore = new Map(); // dirKey -> number of .qml files, pre-move
    this.qmlCountAfter = new Map(); // dirKey -> number of .qml files, post-move
    // [{oldName, newName, oldPath, newPath}] .qml files whose type name changes, and
    // [{oldName, newName, oldPath, newPath, modules}] C++ classes QML knows by name, where
    // the paths are the declaring file and `modules` the URIs it is registered in
    this.typeRenames = [];
    this.qmlModuleMembers = new Map(); // key(.qml path) -> URI of the qt_add_qml_module listing it
    this.cppModuleMembers = new Map(); // key(C++ source path) -> [URI] of the modules its target builds
    this.basenameCount = new Map(); // lower-case file name -> how many project files carry it
    this.ignoredMoves = 0; // moved or deleted files that started inside a build tree or ignored path
    this.deleted = null; // for a delete: {files: Set of key(path), dirs: [path]}
    this.quiet = false; // while set, warn() records nothing
    this.warnings = [];
  }

  /** True for a file this delete removes. */
  isDeletedFile(p) {
    return this.deleted !== null && this.deleted.files.has(key(p));
  }

  /** True for a directory this delete removes, or one inside it. */
  isDeletedDir(p) {
    if (this.deleted === null) return false;
    const k = key(p);
    return this.deleted.dirs.some((d) => k === key(d) || k.startsWith(key(d) + path.sep));
  }

  /** Where a path ends up once this rename is applied. */
  mapPath(p) {
    const k = key(p);
    if (this.moveMap.has(k)) return this.moveMap.get(k);
    for (const dm of this.dirMoves) {
      const dk = key(dm.oldPath);
      if (k === dk) return dm.newPath;
      if (k.startsWith(dk + path.sep)) {
        return path.join(dm.newPath, path.relative(dm.oldPath, p));
      }
    }
    return p;
  }

  /** True if anything about this path changes. */
  moves(p) {
    return key(this.mapPath(p)) !== key(p);
  }

  /** URIs of the modules a renamed type is registered in. */
  typeModules(rename) {
    if (rename.modules) return rename.modules;
    const uri = this.qmlModuleMembers.get(key(rename.oldPath));
    return uri ? [uri] : [];
  }

  async exists(p) {
    const k = key(p);
    if (this.existsCache.has(k)) return this.existsCache.get(k);
    let result = false;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(p));
      result = true;
    } catch (_) {
      result = false;
    }
    this.existsCache.set(k, result);
    return result;
  }

  async isDirectory(p) {
    try {
      const st = await vscode.workspace.fs.stat(vscode.Uri.file(p));
      return (st.type & vscode.FileType.Directory) !== 0;
    } catch (_) {
      return false;
    }
  }

  warn(msg) {
    if (this.quiet) return;
    this.warnings.push(msg);
    log.appendLine('  ! ' + msg);
  }
}

async function walkFiles(uri, out) {
  let entries;
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch (_) {
    return;
  }
  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(uri, name);
    if (type & vscode.FileType.Directory) await walkFiles(child, out);
    else out.push(child);
  }
}

async function buildContext(files, ignore) {
  const ctx = new MoveContext();

  for (const f of files) {
    const oldPath = f.oldUri.fsPath;
    const newPath = f.newUri.fsPath;
    let isDir = false;
    try {
      const st = await vscode.workspace.fs.stat(f.oldUri);
      isDir = (st.type & vscode.FileType.Directory) !== 0;
    } catch (_) {
      continue; // already gone: nothing left to resolve against
    }

    if (isDir) {
      ctx.dirMoves.push({ oldPath, newPath });
      const children = [];
      await walkFiles(f.oldUri, children);
      for (const c of children) {
        ctx.fileMoves.push({
          oldPath: c.fsPath,
          newPath: path.join(newPath, path.relative(oldPath, c.fsPath))
        });
      }
    } else {
      ctx.fileMoves.push({ oldPath, newPath });
    }
  }

  // A file that starts out inside a build tree or an ignored path is not part of the
  // project: moving it must not rewrite anything, least of all renamed QML types.
  await ignore.classify(ctx.fileMoves.map((mv) => mv.oldPath));
  const fromIgnored = ctx.fileMoves.filter((mv) => ignore.isIgnored(mv.oldPath));
  ctx.ignoredMoves = fromIgnored.length;
  ctx.fileMoves = ctx.fileMoves.filter((mv) => !ignore.isIgnored(mv.oldPath));

  // Deepest directory first, so nested renames resolve against the closest one.
  ctx.dirMoves.sort((a, b) => b.oldPath.length - a.oldPath.length);
  for (const mv of ctx.fileMoves) ctx.moveMap.set(key(mv.oldPath), mv.newPath);

  // A .qml file's name is its type name, so renaming the file renames the type.
  const renameTypes = vscode.workspace.getConfiguration('qtWorkbench').get('renameQmlTypes', true);
  for (const mv of renameTypes ? ctx.fileMoves : []) {
    if (extOf(mv.oldPath) !== '.qml' || extOf(mv.newPath) !== '.qml') continue;
    const oldName = path.basename(mv.oldPath, path.extname(mv.oldPath));
    const newName = path.basename(mv.newPath, path.extname(mv.newPath));
    if (oldName === newName || !isQmlTypeName(oldName)) continue;
    if (!isQmlTypeName(newName)) {
      ctx.warn(
        newName + ' is not a QML type name (it must start with a capital letter and contain ' +
          'only letters, digits and _); references to ' + oldName + ' were left unchanged.'
      );
      continue;
    }
    ctx.typeRenames.push({ oldName, newName, oldPath: mv.oldPath, newPath: mv.newPath });
  }

  return ctx;
}

const DELETED = '__deleted';

/**
 * The context for deleting `uris`, directories expanded to their files. `deleted` says
 * what goes. Nothing moves, but to find what still refers to a deleted file each one is
 * also mapped to a stand-in name no file has -- BasicsView.qml to BasicsView__deleted.qml,
 * type BasicsView to BasicsView__deleted -- so the edits the move rewriters make for that
 * rename are exactly the references the delete leaves dangling.
 */
async function buildDeleteContext(uris, ignore) {
  const ctx = new MoveContext();
  ctx.deleted = { files: new Set(), dirs: [] };

  let files = [];
  for (const uri of uris) {
    let isDir = false;
    try {
      isDir = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
    } catch (_) {
      continue; // already gone
    }
    if (isDir) {
      if (!ignore.inBuildTree(uri.fsPath)) ctx.deleted.dirs.push(uri.fsPath);
      const children = [];
      await walkFiles(uri, children);
      files = files.concat(children.map((c) => c.fsPath));
    } else {
      files.push(uri.fsPath);
    }
  }

  // A file inside a build tree or an ignored path is not part of the project.
  await ignore.classify(files);
  ctx.ignoredMoves = files.filter((p) => ignore.isIgnored(p)).length;
  files = files.filter((p) => !ignore.isIgnored(p));

  for (const oldPath of files) {
    const ext = path.extname(oldPath);
    const stem = path.basename(oldPath, ext);
    const newPath = path.join(path.dirname(oldPath), stem + DELETED + ext);
    ctx.deleted.files.add(key(oldPath));
    ctx.fileMoves.push({ oldPath, newPath });
    ctx.moveMap.set(key(oldPath), newPath);
    if (extOf(oldPath) === '.qml' && isQmlTypeName(stem)) {
      ctx.typeRenames.push({ oldName: stem, newName: stem + DELETED, oldPath, newPath });
    }
  }
  return ctx;
}

module.exports = { DELETED, MoveContext, buildContext, buildDeleteContext };
