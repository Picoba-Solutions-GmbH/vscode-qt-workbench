'use strict';

/**
 * Adding a new file to the project: CMakeLists.txt, .pro/.pri, .qrc and qmldir files
 * that list files like it get an entry for it. Each kind is looked for from the file's
 * own directory up to its workspace folder, and the nearest one with a place for it is
 * used -- the registrars in registrars/ decide what that place is.
 */

const vscode = require('vscode');
const path = require('path');
const { fileReader } = require('./documents');
const { IgnoreRules, workspaceFolderOf } = require('./ignore');
const { log } = require('./log');
const { extOf, key, toPosix } = require('./paths');
const { makeOffsetToPosition } = require('./text');
const { registerInCMake } = require('./registrars/cmake');
const { familyOf } = require('./registrars/lists');
const { registerInQmake } = require('./registrars/qmake');
const { registerInQmldir } = require('./registrars/qmldir');
const { registerInQrc } = require('./registrars/resources');

function isListingFile(name) {
  const ext = extOf(name);
  return name.toLowerCase() === 'cmakelists.txt' || name === 'qmldir' || ext === '.pro' || ext === '.pri' || ext === '.qrc';
}

/**
 * The directories from `dir` up to its workspace folder, nearest first, each with the
 * files in it that can list others: [{dir, files}]. Outside a workspace folder, `dir` alone.
 */
async function directoriesAbove(dir) {
  const folder = workspaceFolderOf(dir);
  const chain = [];
  for (let current = dir; ; current = path.dirname(current)) {
    let entries = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(current));
    } catch (_) {
      // a folder the new file's name creates does not exist yet
    }
    const files = entries
      .filter(([name, type]) => (type & vscode.FileType.File) !== 0 && isListingFile(name))
      .map(([name]) => path.join(current, name))
      .sort();
    chain.push({ dir: current, files });
    if (!folder || key(current) === key(folder) || path.dirname(current) === current) break;
  }
  return chain;
}

/**
 * The edit adding `newPath`, a file about to be created, to the files that list its
 * neighbours: {edit, touched: [{uri, what}], notes: [{uri, note}], warnings}. `notes` are
 * files that need no entry because they pick the new file up already.
 */
async function addToProject(newPath) {
  const cfg = vscode.workspace.getConfiguration('qtWorkbench');
  const result = { edit: new vscode.WorkspaceEdit(), touched: [], notes: [], warnings: [] };
  const relative = (p) => toPosix(vscode.workspace.asRelativePath(p));
  const warn = (message) => {
    result.warnings.push(message);
    log.appendLine('  ! ' + message);
  };

  const registrars = [];
  if (cfg.get('updateCMake', true)) registrars.push(registerInCMake, registerInQmake);
  if (cfg.get('updateQrc', true)) registrars.push(registerInQrc);
  if (cfg.get('updateQmldir', true)) registrars.push(registerInQmldir);
  if (registrars.length === 0 || !familyOf(newPath)) return result;

  const chain = await directoriesAbove(path.dirname(newPath));
  const ignore = await IgnoreRules.load();
  await ignore.classify([newPath].concat(...chain.map((c) => c.files)));
  if (ignore.isIgnored(newPath)) {
    warn(relative(newPath) + ' is inside a build or ignored directory, so it was not added to any build file.');
    return result;
  }
  for (const c of chain) c.files = c.files.filter((f) => !ignore.isIgnored(f));

  const readFile = fileReader();
  for (const register of registrars) {
    const found = await register(chain, newPath, readFile);
    if (!found) continue;
    const uri = vscode.Uri.file(found.file);
    if (found.note) {
      result.notes.push({ uri, note: found.note });
      log.appendLine('  ' + relative(uri) + ': ' + found.note);
      continue;
    }
    const posAt = makeOffsetToPosition(await readFile(found.file));
    result.edit.replace(uri, new vscode.Range(posAt(found.edit.start), posAt(found.edit.end)), found.edit.text);
    result.touched.push({ uri, what: found.what });
    log.appendLine('  * ' + relative(uri) + ': added ' + found.what);
  }

  if (result.touched.length === 0 && result.notes.length === 0) {
    warn(
      relative(newPath) + ' was not added to any build file: no CMakeLists.txt, .pro or .pri' +
        (familyOf(newPath) === 'qml' ? ', .qrc or qmldir' : '') +
        ' in its folder or above lists files like it.'
    );
  }
  return result;
}

module.exports = { addToProject };
