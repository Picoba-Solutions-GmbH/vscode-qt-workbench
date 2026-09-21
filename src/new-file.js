'use strict';

/**
 * New QML File..., New C++ Source File... and New C++ Header File... in the explorer:
 * ask for a name, create the file from a small template and add it to the build files
 * that list its neighbours -- all in one edit -- then save it and open it.
 */

const vscode = require('vscode');
const path = require('path');
const { saveFiles } = require('./documents');
const { workspaceFolderOf } = require('./ignore');
const { log } = require('./log');
const { HEADER_EXT, extOf, isAbsolutePathLike, isCppFile, isQmlTypeName, key, toPosix } = require('./paths');
const { addToProject } = require('./registration');
const { confirmAdding, showCreated } = require('./summary');

const SOURCE_EXT = ['.cpp', '.cc', '.cxx', '.c', '.mm', '.m'];

async function stat(p) {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (_) {
    return null;
  }
}

/** `import QtQuick` as the .qml files next to it spell it, so a Qt 5 project keeps its version number. */
async function qtQuickImport(dir) {
  let entries = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  } catch (_) {
    // a new folder: nothing to copy
  }
  const qmlFiles = entries
    .filter(([name, type]) => (type & vscode.FileType.File) !== 0 && extOf(name) === '.qml')
    .map(([name]) => name)
    .sort();
  for (const name of qmlFiles.slice(0, 5)) {
    try {
      const text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(dir, name)))).toString('utf8');
      const m = /^[ \t]*import[ \t]+QtQuick(?:[ \t]+\d+(?:\.\d+)?)?[ \t]*(?=\r?$)/m.exec(text);
      if (m) return m[0].trim();
    } catch (_) {
      // unreadable: try the next one
    }
  }
  return 'import QtQuick';
}

/** Templates: the new file's text and the [line, character] to put the cursor at. */
const templates = {
  async qml(filePath) {
    return { text: (await qtQuickImport(path.dirname(filePath))) + '\n\nItem {\n\n}\n', cursor: [3, 0] };
  },

  async source(filePath) {
    const stem = path.basename(filePath, path.extname(filePath));
    for (const ext of HEADER_EXT) {
      if (await stat(path.join(path.dirname(filePath), stem + ext))) {
        return { text: '#include "' + stem + ext + '"\n\n', cursor: [2, 0] };
      }
    }
    return { text: '', cursor: [0, 0] };
  },

  async header(filePath) {
    if (vscode.workspace.getConfiguration('qtWorkbench').get('headerGuard', 'ifndef') === 'pragmaOnce') {
      return { text: '#pragma once\n\n', cursor: [2, 0] };
    }
    const guard = path.basename(filePath).toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^(?=\d)/, '_');
    return { text: '#ifndef ' + guard + '\n#define ' + guard + '\n\n\n\n#endif // ' + guard + '\n', cursor: [3, 0] };
  }
};

const KINDS = [
  { command: 'qtWorkbench.newQmlFile', title: 'New QML File', noun: 'QML file', exts: ['.qml'], template: templates.qml, placeHolder: 'MyView' },
  { command: 'qtWorkbench.newCppSource', title: 'New C++ Source File', noun: 'C++ source file', exts: SOURCE_EXT, partners: [...HEADER_EXT], template: templates.source, placeHolder: 'myclass' },
  { command: 'qtWorkbench.newCppHeader', title: 'New C++ Header File', noun: 'C++ header', exts: [...HEADER_EXT], partners: SOURCE_EXT, template: templates.header, placeHolder: 'myclass' }
];

/** The path `input` names under `dir`, with the kind's extension added unless it already has one. */
function pathFor(kind, dir, input) {
  const name = input.trim().replace(/\\/g, '/');
  return path.join(dir, kind.exts.includes(extOf(name)) ? name : name + kind.exts[0]);
}

/** What is wrong with `input` as the name of a new file of `kind` in `dir`: {message, severity}, or undefined. */
async function problemWith(kind, dir, input) {
  const error = (message) => ({ message, severity: vscode.InputBoxValidationSeverity.Error });
  const name = input.trim().replace(/\\/g, '/');
  if (name === '') return error('Enter a file name.');
  if (isAbsolutePathLike(name)) return error('Enter a name relative to the folder, such as ' + kind.placeHolder + ' or sub/' + kind.placeHolder + '.');
  const segments = name.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return error('Folder names cannot be empty, "." or "..".');
  const bad = segments.find((s) => /[<>:"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s));
  if (bad) return error('"' + bad + '" is not a valid file or folder name.');
  const ext = extOf(name);
  if (!kind.exts.includes(ext) && (ext === '.qml' || isCppFile(name))) {
    return error(path.posix.basename(name) + ' is not a ' + kind.noun + ': end the name in ' + kind.exts.slice(0, 3).join(', ') + ', or leave the extension out.');
  }

  const target = pathFor(kind, dir, input);
  for (let p = target; key(p) !== key(dir); p = path.dirname(p)) {
    const st = await stat(p);
    if (!st) continue;
    if (p === target) return error(toPosix(path.relative(dir, target)) + ' already exists here.');
    if ((st.type & vscode.FileType.Directory) === 0) return error(toPosix(path.relative(dir, p)) + ' is a file, not a folder.');
  }
  const stem = path.basename(target, path.extname(target));
  if (kind.exts[0] === '.qml' && !isQmlTypeName(stem)) {
    return {
      message: stem + ' is not a QML type name, so other QML files cannot use it as a type. Start it with a capital letter to make it one.',
      severity: vscode.InputBoxValidationSeverity.Warning
    };
  }
  return undefined;
}

/**
 * The folder the new file goes in, and the file the command was started from, if any:
 * the folder or file right-clicked in the explorer, else the active editor's file, else
 * a workspace folder. Null when there is nowhere to create it.
 */
async function whereToCreate(uri) {
  let from = null;
  if (uri && typeof uri.fsPath === 'string') {
    if (uri.scheme !== 'file') return null;
    const st = await stat(uri.fsPath);
    if (st && (st.type & vscode.FileType.Directory) !== 0) return { dir: uri.fsPath, from: null };
    from = uri.fsPath;
  } else {
    const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    if (doc && doc.uri.scheme === 'file' && workspaceFolderOf(doc.uri.fsPath)) from = doc.uri.fsPath;
  }
  if (from) return { dir: path.dirname(from), from };

  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    vscode.window.showInformationMessage('Open a folder first: the new file is added to the build files in it.');
    return null;
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to create the file in' });
  return folder ? { dir: folder.uri.fsPath, from: null } : null;
}

/** foo, when the command starts from foo.h and there is no foo.cpp yet (or the other way round). */
async function partnerName(kind, from) {
  if (!from || !kind.partners || !kind.partners.includes(extOf(from))) return '';
  const stem = path.basename(from, path.extname(from));
  for (const ext of kind.exts) {
    if (await stat(path.join(path.dirname(from), stem + ext))) return '';
  }
  return stem;
}

async function newFile(kind, uri) {
  const where = await whereToCreate(uri);
  if (!where) return;

  const folder = workspaceFolderOf(where.dir);
  const shown = folder ? toPosix(path.join(path.basename(folder), path.relative(folder, where.dir))) : toPosix(where.dir);
  const value = await partnerName(kind, where.from);
  const input = await vscode.window.showInputBox({
    title: kind.title,
    prompt: 'In ' + shown + '/ (' + kind.exts[0] + ' is added if left out). It is added to the build files that list the files next to it.',
    placeHolder: kind.placeHolder,
    value,
    valueSelection: [0, value.length],
    validateInput: (text) => problemWith(kind, where.dir, text)
  });
  if (input === undefined) return;
  const problem = await problemWith(kind, where.dir, input);
  if (problem && problem.severity === vscode.InputBoxValidationSeverity.Error) {
    vscode.window.showErrorMessage(problem.message);
    return;
  }

  const filePath = pathFor(kind, where.dir, input);
  const newUri = vscode.Uri.file(filePath);
  const name = toPosix(vscode.workspace.asRelativePath(newUri));
  log.header('new file ' + name);

  const edit = new vscode.WorkspaceEdit();
  const template = await kind.template(filePath);
  edit.createFile(newUri, { overwrite: false });
  if (template.text) edit.insert(newUri, new vscode.Position(0, 0), template.text);

  let added = { touched: [], notes: [], warnings: [] };
  try {
    const found = await addToProject(filePath);
    if (found.touched.length > 0 && !(await confirmAdding(name, found.touched))) {
      log.appendLine('  not added: skipped at the confirmation');
    } else {
      added = found;
      for (const [u, edits] of found.edit.entries()) {
        for (const e of edits) edit.replace(u, e.range, e.newText);
      }
    }
  } catch (err) {
    // The file is still created; only adding it to the build files failed.
    log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
    vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
  }

  const dirtyBefore = new Set(vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => key(d.uri.fsPath)));
  if (!(await vscode.workspace.applyEdit(edit))) {
    log.appendLine('  ! could not create ' + name);
    vscode.window.showErrorMessage('Qt Workbench: could not create ' + name + '.');
    return;
  }

  // The new file is always written; the build files it was added to follow
  // files.refactoring.autoSave, as after a move, and never when they had unsaved changes.
  const toSave = [newUri];
  if (vscode.workspace.getConfiguration('files').get('refactoring.autoSave', true)) {
    toSave.push(...added.touched.map((t) => t.uri).filter((u) => !dirtyBefore.has(key(u.fsPath))));
  }
  await saveFiles(toSave);

  const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(newUri));
  const cursor = new vscode.Position(template.cursor[0], template.cursor[1]);
  editor.selection = new vscode.Selection(cursor, cursor);
  showCreated(name, added);
}

function registerNewFileCommands(context) {
  for (const kind of KINDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(kind.command, async (uri) => {
        try {
          await newFile(kind, uri);
        } catch (err) {
          log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
          vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
        }
      })
    );
  }
}

module.exports = { registerNewFileCommands };
