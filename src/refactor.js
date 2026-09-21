'use strict';

/**
 * Turns one rename or delete into a single WorkspaceEdit by running the rewriters over
 * the project's files: every rewriter for a file move, the QML type rewriters for a C++
 * class rename, the removal of file list entries for a delete.
 */

const vscode = require('vscode');
const path = require('path');
const { DELETED, MoveContext, buildContext, buildDeleteContext } = require('./context');
const { qmlNamedDeclarations } = require('./cpp-syntax');
const { fileReader } = require('./documents');
const { log } = require('./log');
const { extOf, isBuildFile, isCppFile, isQmlLike, isQmlTypeName, key, toPosix } = require('./paths');
const { IgnoreRules, excludeGlob } = require('./ignore');
const { SCAN_GLOB, buildTypeIndexes, collectProjectRoots, collectQmlModules, cppModulesOf } = require('./project');
const { dedupe, makeOffsetToPosition, makePositionToOffset } = require('./text');
const { removeFromBuildFile, rewriteBuildFile } = require('./rewriters/build-files');
const { rewriteIncludes } = require('./rewriters/includes');
const { rewritePathStrings } = require('./rewriters/path-strings');
const { rewriteQmlImports } = require('./rewriters/qml-imports');
const { renameTypeReferences, rewriteModuleTypeStrings } = require('./rewriters/qml-types');
const { removeFromQmldir, rewriteQmldir } = require('./rewriters/qmldir');
const { removeFromQrc, rewriteQrc, rewriteXmlAttrPaths } = require('./rewriters/resources');

/**
 * The project files a rename may read or edit -- build trees and ignored files left
 * out -- with include roots, the type index and the QML modules collected from them.
 */
async function scanProject(ctx, ignore, readFile) {
  let candidates = await vscode.workspace.findFiles(SCAN_GLOB, excludeGlob());
  const skipped = await ignore.classify(candidates.map((u) => u.fsPath));
  candidates = candidates.filter((u) => !ignore.isIgnored(u.fsPath));
  if (ignore.buildDirs.length > 0) {
    log.appendLine(
      '  skipping ' + ignore.buildDirs.length + ' build dir(s): ' +
        ignore.buildDirs.map((d) => toPosix(vscode.workspace.asRelativePath(d))).join(', ')
    );
  }
  if (skipped.git > 0) {
    log.appendLine('  skipping ' + skipped.git + ' file(s) ignored by git');
  }
  for (const folder of ignore.gitUnavailable) {
    log.appendLine(
      '  .gitignore not applied in ' + toPosix(folder) + ': not a git repository, or git not found'
    );
  }
  const buildFiles = candidates.filter((u) => isBuildFile(u.fsPath));
  collectProjectRoots(ctx, buildFiles);
  buildTypeIndexes(ctx, candidates);
  await collectQmlModules(ctx, buildFiles, readFile);
  return candidates;
}

/**
 * Run `rewrite(text, fsPath)` over every candidate and gather the edits into one
 * WorkspaceEdit. Edits overlapping one that `existing` already makes to the same
 * file are left out, so the two can be applied together.
 */
async function collectEdits(candidates, ignore, readFile, rewrite, existing) {
  const edit = new vscode.WorkspaceEdit();
  const touched = [];
  // By path key: the same file may be spelled with another drive letter case in `existing`.
  const existingEdits = new Map((existing ? existing.entries() : []).map(([u, list]) => [key(u.fsPath), list]));

  for (const uri of candidates) {
    const fsPath = uri.fsPath;
    const text = await readFile(fsPath);
    if (text === null) continue;

    let edits = await rewrite(text, fsPath);
    if (existingEdits.has(key(fsPath)) && edits.length > 0) {
      const offsetAt = makePositionToOffset(text);
      const taken = existingEdits
        .get(key(fsPath))
        .map((e) => ({ start: offsetAt(e.range.start), end: offsetAt(e.range.end) }));
      edits = edits.filter((e) => !taken.some((t) => e.start <= t.end && t.start <= e.end));
    }
    if (edits.length === 0) continue;
    // Last line of defence for the one hard rule: nothing inside a build tree or an
    // ignored path is ever edited, whichever rewriter produced the change.
    if (ignore.isIgnored(fsPath)) {
      log.appendLine('  ! not editing ' + toPosix(vscode.workspace.asRelativePath(uri)) + ': build or ignored path');
      continue;
    }
    edits = dedupe(edits);

    const posAt = makeOffsetToPosition(text);
    for (const e of edits) {
      edit.replace(uri, new vscode.Range(posAt(e.start), posAt(e.end)), e.text);
    }
    touched.push({ uri, count: edits.length });
    log.appendLine(
      '  * ' + toPosix(vscode.workspace.asRelativePath(uri)) + ': ' + edits.length + ' change(s)'
    );
  }

  if (touched.length === 0) {
    log.appendLine('  (no references needed updating)');
    return null;
  }
  return { edit, touched };
}

async function computeWorkspaceEdit(files) {
  const cfg = vscode.workspace.getConfiguration('qtWorkbench');
  const ignore = await IgnoreRules.load();
  const ctx = await buildContext(files, ignore);
  if (ctx.fileMoves.length === 0) {
    if (ctx.ignoredMoves > 0) {
      log.header(ctx.ignoredMoves + ' file(s) moved inside a build or ignored directory; nothing to update');
    }
    return null;
  }

  log.header(ctx.fileMoves.length + ' file(s) moved');
  for (const mv of ctx.fileMoves) {
    log.appendLine('  ' + toPosix(mv.oldPath) + '  ->  ' + toPosix(mv.newPath));
  }
  for (const r of ctx.typeRenames) {
    log.appendLine('  type ' + r.oldName + '  ->  ' + r.newName);
  }
  if (ctx.ignoredMoves > 0) {
    log.appendLine('  ' + ctx.ignoredMoves + ' moved file(s) inside build or ignored directories left out');
  }

  const readFile = fileReader();
  const candidates = await scanProject(ctx, ignore, readFile);

  const result = await collectEdits(candidates, ignore, readFile, async (text, fsPath) => {
    const ext = extOf(fsPath);
    let edits = [];

    if (cfg.get('updateCMake', true) && isBuildFile(fsPath)) {
      edits = edits.concat(await rewriteBuildFile(text, fsPath, ctx));
    }
    if (cfg.get('updateIncludes', true) && isCppFile(fsPath)) {
      edits = edits.concat(await rewriteIncludes(text, fsPath, ctx));
    }
    if (cfg.get('updateQml', true) && isQmlLike(fsPath)) {
      const types = renameTypeReferences(text, fsPath, ctx);
      edits = edits.concat(types.edits);
      edits = edits.concat(await rewriteQmlImports(text, fsPath, ctx, types.renamed));
    }
    if (cfg.get('updateQml', true) && (isQmlLike(fsPath) || isCppFile(fsPath))) {
      edits = edits.concat(await rewritePathStrings(text, fsPath, ctx));
      edits = edits.concat(rewriteModuleTypeStrings(text, fsPath, ctx));
    }
    if (cfg.get('updateQrc', true) && (ext === '.qrc' || ext === '.ui')) {
      edits = edits.concat(await rewriteQrc(text, fsPath, ctx));
      edits = edits.concat(await rewriteXmlAttrPaths(text, fsPath, ctx));
    }
    if (cfg.get('updateQmldir', true) && path.basename(fsPath).toLowerCase() === 'qmldir') {
      edits = edits.concat(await rewriteQmldir(text, fsPath, ctx));
    }
    return edits;
  });
  return result && { ...result, ctx };
}

/**
 * The classes QML knows by name whose definition `cppEdit` renames to `newName`:
 * [{oldName, path}]. The language server decided which symbol is being renamed; a
 * class counts only when the server's edit replaces the name in its definition, so a
 * variable or a class of the same name elsewhere is never taken for it.
 */
async function renamedQmlClasses(cppEdit, newName, readFile) {
  const found = [];
  for (const [uri, textEdits] of cppEdit.entries()) {
    if (uri.scheme !== 'file' || !isCppFile(uri.fsPath)) continue;
    const text = await readFile(uri.fsPath);
    if (!text) continue;
    const offsetAt = makePositionToOffset(text);
    const replaced = new Set(
      textEdits
        .filter((e) => e.newText === newName)
        .map((e) => offsetAt(e.range.start) + ':' + offsetAt(e.range.end))
    );
    for (const d of qmlNamedDeclarations(text)) {
      if (d.name !== newName && replaced.has(d.start + ':' + d.end)) found.push({ oldName: d.name, path: uri.fsPath });
    }
  }
  return found;
}

/**
 * The QML side of a C++ rename. `cppEdit` is the language server's edit for renaming a
 * symbol to `newName`; when that symbol is a class QML knows by name, the result holds
 * the edits to its QML references -- a separate WorkspaceEdit that never overlaps
 * `cppEdit`. Null when there is nothing to add.
 */
async function computeClassRenameEdit(cppEdit, newName) {
  const readFile = fileReader();
  const classes = await renamedQmlClasses(cppEdit, newName, readFile);
  if (classes.length === 0) return null;

  // A class defined inside a build tree or an ignored path is not part of the project.
  const ignore = await IgnoreRules.load();
  await ignore.classify(classes.map((c) => c.path));
  const inProject = classes.filter((c) => !ignore.isIgnored(c.path));
  if (inProject.length === 0) return null;

  const ctx = new MoveContext();
  log.header('C++ class renamed');
  for (const c of inProject) {
    log.appendLine('  type ' + c.oldName + '  ->  ' + newName + '  (' + toPosix(c.path) + ')');
  }
  if (!isQmlTypeName(newName)) {
    ctx.warn(
      newName + ' is not a QML type name (it must start with a capital letter); QML references to ' +
        inProject[0].oldName + ' were left unchanged.'
    );
    return null;
  }

  const candidates = await scanProject(ctx, ignore, readFile);
  for (const c of inProject) {
    const modules = cppModulesOf(ctx, c.path);
    if (modules.length === 0) {
      ctx.warn(
        toPosix(vscode.workspace.asRelativePath(c.path)) + ' is not built into any qt_add_qml_module target, ' +
          'so it is unknown which QML files see ' + c.oldName + '; its QML references were left unchanged.'
      );
      continue;
    }
    ctx.typeRenames.push({ oldName: c.oldName, newName, oldPath: c.path, newPath: c.path, modules });
  }
  if (ctx.typeRenames.length === 0) return null;

  const result = await collectEdits(
    candidates,
    ignore,
    readFile,
    async (text, fsPath) => {
      let edits = [];
      if (isQmlLike(fsPath)) edits = edits.concat(renameTypeReferences(text, fsPath, ctx).edits);
      if (isQmlLike(fsPath) || isCppFile(fsPath)) edits = edits.concat(rewriteModuleTypeStrings(text, fsPath, ctx));
      return edits;
    },
    cppEdit
  );
  return result && { ...result, ctx };
}

/**
 * Where `text` still refers to a deleted file: the edits the move rewriters would make for
 * the stand-in rename of buildDeleteContext, found without warnings that only a real
 * rename would call for.
 */
async function danglingReferences(text, fsPath, ctx, cfg) {
  ctx.quiet = true;
  try {
    let edits = [];
    if (cfg.get('updateIncludes', true) && isCppFile(fsPath)) {
      edits = edits.concat(await rewriteIncludes(text, fsPath, ctx));
    }
    if (cfg.get('updateQml', true) && isQmlLike(fsPath)) {
      edits = edits.concat(renameTypeReferences(text, fsPath, ctx).edits);
    }
    if (cfg.get('updateQml', true) && (isQmlLike(fsPath) || isCppFile(fsPath))) {
      edits = edits.concat(await rewritePathStrings(text, fsPath, ctx), rewriteModuleTypeStrings(text, fsPath, ctx));
    }
    if (cfg.get('updateQrc', true) && extOf(fsPath) === '.ui') {
      edits = edits.concat(await rewriteXmlAttrPaths(text, fsPath, ctx));
    }
    return edits.filter((e) => e.end > e.start);
  } finally {
    ctx.quiet = false;
  }
}

/** "Main.qml still refers to deleted files: BasicsView (lines 12, 40), logo.png (line 7)" */
function describeDangling(text, fsPath, edits) {
  const posAt = makeOffsetToPosition(text);
  const lines = new Map(); // what the reference spells -> the lines it is on
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    const spelled = text.slice(e.start, e.end);
    const line = posAt(e.start).line + 1;
    if (!lines.has(spelled)) lines.set(spelled, []);
    if (!lines.get(spelled).includes(line)) lines.get(spelled).push(line);
  }
  const where = [...lines].map(([spelled, at]) => spelled + ' (line' + (at.length > 1 ? 's ' : ' ') + at.join(', ') + ')');
  return toPosix(vscode.workspace.asRelativePath(fsPath)) + ' still refers to deleted files: ' + where.join(', ');
}

/**
 * The C++ classes QML knows by name that a delete takes with it, added to the stand-in
 * renames so the QML still using them is found too.
 */
async function addDeletedClasses(ctx, readFile) {
  for (const mv of ctx.fileMoves) {
    if (!isCppFile(mv.oldPath)) continue;
    const text = await readFile(mv.oldPath);
    if (!text) continue;
    const modules = cppModulesOf(ctx, mv.oldPath);
    if (modules.length === 0) continue;
    for (const d of qmlNamedDeclarations(text)) {
      ctx.typeRenames.push({ oldName: d.name, newName: d.name + DELETED, oldPath: mv.oldPath, newPath: mv.oldPath, modules });
    }
  }
}

/**
 * The edit for deleting `uris` (files or directories): entries for the deleted files
 * taken out of CMakeLists.txt, *.cmake, *.pro, *.pri, .qrc and qmldir files. References
 * that code still makes to them -- #includes, QML types, paths in strings -- cannot be
 * fixed by removing them, so each file holding one gets a warning instead. Null when
 * nothing in the project was deleted.
 */
async function computeDeleteEdit(uris) {
  const cfg = vscode.workspace.getConfiguration('qtWorkbench');
  const ignore = await IgnoreRules.load();
  const ctx = await buildDeleteContext(uris, ignore);
  if (ctx.fileMoves.length === 0) {
    if (ctx.ignoredMoves > 0) {
      log.header(ctx.ignoredMoves + ' file(s) deleted inside a build or ignored directory; nothing to update');
    }
    return null;
  }

  log.header(ctx.fileMoves.length + ' file(s) deleted');
  for (const mv of ctx.fileMoves) log.appendLine('  ' + toPosix(mv.oldPath));
  if (ctx.ignoredMoves > 0) {
    log.appendLine('  ' + ctx.ignoredMoves + ' deleted file(s) inside build or ignored directories left out');
  }

  const readFile = fileReader();
  const candidates = (await scanProject(ctx, ignore, readFile)).filter((u) => !ctx.isDeletedFile(u.fsPath));
  await addDeletedClasses(ctx, readFile);

  const dangling = [];
  const result = await collectEdits(candidates, ignore, readFile, async (text, fsPath) => {
    const references = await danglingReferences(text, fsPath, ctx, cfg);
    if (references.length > 0) dangling.push(describeDangling(text, fsPath, references));

    let edits = [];
    if (cfg.get('updateCMake', true) && isBuildFile(fsPath)) {
      edits = edits.concat(removeFromBuildFile(text, fsPath, ctx));
    }
    if (cfg.get('updateQrc', true) && extOf(fsPath) === '.qrc') {
      edits = edits.concat(removeFromQrc(text, fsPath, ctx));
    }
    if (cfg.get('updateQmldir', true) && path.basename(fsPath).toLowerCase() === 'qmldir') {
      edits = edits.concat(removeFromQmldir(text, fsPath, ctx));
    }
    return edits;
  });
  for (const message of dangling) ctx.warn(message);
  return { ...(result || { edit: new vscode.WorkspaceEdit(), touched: [] }), ctx };
}

module.exports = { computeWorkspaceEdit, computeClassRenameEdit, computeDeleteEdit };
