'use strict';
// Drives one rename through the extension against a project on disk, the way VS Code
// would, and stubs just enough of the vscode API for that. Either a file move:
//
//   harness.js <project root> '[["old/path", "new/path"], ...]'
//
//   onWillRenameFiles -> apply the WorkspaceEdit -> perform the move -> onDidRenameFiles
//
// or Rename Symbol (F2) on a C/C++ identifier:
//
//   harness.js <project root> '{"file": "basics.h", "symbol": "Foo", "newName": "Bar"}'
//
//   the rename widget asks the rename providers in VS Code's order -> apply the WorkspaceEdit
//
// or a delete of files or folders:
//
//   harness.js <project root> '{"delete": ["views/BasicsView.qml", "components"]}'
//
//   onWillDeleteFiles -> apply the WorkspaceEdit -> delete them -> onDidDeleteFiles
//
// or one of the New QML/C++ File commands, as from the explorer context menu:
//
//   harness.js <project root> '{"command": "qtWorkbench.newQmlFile", "at": "views", "name": "Foo"}'
//
//   the command -> the input box answers `name` if it validates -> apply the WorkspaceEdit -> save
//
// `at` is the folder or file right-clicked; left out, the command runs from the palette.
// New Qt Project and Set Up vcpkg with CMake Presets run the same way, choosing in their quick picks:
//
//   harness.js <project root> '{"command": "qtWorkbench.setUpVcpkg", "at": ".", "picks": ["Qt 6.11.2 MinGW 64-bit", "Browse..."], "browse": ["${work}/vcpkg"], "answer": "Replace"}'
//
// Each quick pick prints `PICK:` and its items, and takes the item labelled like the next of
// `picks` (codicons left out); none left is Escape. A quick pick of several items prints
// [x] before those picked at first, and takes a list of labels. Each folder dialog takes the
// next of `browse`, and a modal message answers `answer`, its detail logged on `[detail]` lines.
// ${work} is the folder holding the project.
//
// or a debug session with QML hot reload, against a fake Qt application (fake-qml-app.js):
//
//   harness.js <project root> '{"debug": {"args": ["-qmljsdebugger=host:127.0.0.1,port:${port},block,services:QmlPreview"], "program": "..."}, "steps": [...]}'
//
//   onDidStartDebugSession -> the steps -> onDidTerminateDebugSession
//
// ${port} is the fake application's port. Steps, one key each:
//   {"connect": true}           wait until the extension has connected ({"connect": ms}: at most ms)
//   {"request": ":/qt/qml/..."} the application reads a file and waits for the answer (${root} = project root)
//   {"write": "views/X.qml", "text": "..."}  change a file on disk
//   {"save": "views/X.qml"}     VS Code saved it;  {"watch": "..."}: the file watcher saw it change
//   {"appError": "..."}         the application reports a load error
//   {"command": "qtWorkbench.reloadQml"}, {"wait": 300}, {"end": true} (the session ends)
//   {"status": true}            print the status bar item
// Prints `> <step>` and then every message the application got since the step before.
//
// or the Qt Project Explorer, clicked through step by step:
//
//   harness.js <project root> '{"explorer": [{"tree": true}, {"command": "...", "node": "Test > appTest", ...}]}'
//
// A node is named by the labels from its root down, joined with " > ". Steps, one kind each:
//   {"tree": true}               print the tree: one node per line, label and description, indented
//   {"item": "<node>"}           print the TreeItem VS Code gets for a node
//   {"command": "qtWorkbench.projectExplorer.rename", "node": "<node>", "nodes": ["<node>", ...]}
//                                run a command from the node's context menu (`nodes`: the selection);
//                                "input" answers the input box, "answer" a modal message, and
//                                "picks" and "browse" quick picks and folder dialogs, as for a command
//   {"drag": ["<node>", ...], "onto": "<node>"}  drag nodes onto another one; "answer" as above
//   {"editor": "views/X.qml"}    make X.qml the active editor
//   {"write": "CMakeLists.txt", "text": "..."}  change a file on disk; the file watcher sees it
// Renames and deletes made through applyEdit run the extension's file operation participants
// and fire the watcher, as in VS Code. Prints `> <step>` before what each step printed.
//
// The rename starts at the first whole-word `symbol` in `file`. Behind the extension's
// provider sits a fake C++ language server that renames every whole-word occurrence in
// the project's C/C++ files outside build folders; `cppFiles` limits it to a list.
//
// Prints `SAVED: <files>` after a move or delete, `EDITED: <files>` after a rename, the
// extension's log, and a diff of the project. A new file prints `PROMPT: <suggested name>`,
// `INVALID:` or `WARNING: <validation message>`, `CREATED:`, `SAVED:` and
// `OPENED: <file>:<line>:<character>`; a folder opened prints `OPENED FOLDER: <folder> <options>`,
// one added to the workspace `ADDED TO WORKSPACE: <folder>`. Environment:
//   EXT_DIR    extension to load (default: this repository)
//   SETTINGS   JSON of qtWorkbench.* overrides, e.g. {"useGitignore":false}; other extensions'
//              settings by their full name, e.g. {"qt-core.qtInstallationRoot":"${work}/Qt"}
//   PROCESS_ENV  JSON of environment variables the extension sees, e.g. {"VCPKG_ROOT":"${work}/vcpkg"}
//   EXTENSIONS   comma-separated ids of the other extensions installed, e.g. theqtcompany.qt-cpp
//   DIRTY      comma-separated project files that already have unsaved edits
//   AUTOSAVE   "false" to turn files.refactoring.autoSave off
//   LS_STRINGS "1" for a fake language server that also renames inside string literals
//   NO_FOLDER  "1" for a window with no folder open: the project root is then only where paths are shown from
//   ACTIVE_PRESET  the configure preset active in CMake Tools, as cmake.activeConfigurePresetName answers
// A notification with progress prints `PROGRESS: <title>: <message>` for each message.
//
// findFiles() approximates the extension's scan glob by walking the tree and filtering
// on the same name/extension set the glob encodes; exclude globs are honoured.

const Module = require('module');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.argv[2];
const ARG = JSON.parse(process.argv[3]);
const MOVES = Array.isArray(ARG) ? ARG : null; // [[old, new], ...] relative to ROOT
const NEW_FILE = !MOVES && ARG.command ? ARG : null; // {command, at, name}
const DELETES = !MOVES && ARG.delete ? ARG.delete : null; // [path, ...] relative to ROOT
const DEBUG = !MOVES && ARG.debug ? ARG : null; // {debug: configuration, steps}
const EXPLORER = !MOVES && ARG.explorer ? ARG.explorer : null; // [step, ...]
const SYMBOL = MOVES || NEW_FILE || DELETES || DEBUG || EXPLORER ? null : ARG; // {file, symbol, newName, cppFiles}

// What the user types into the next input box, and clicks in the next modal message.
let INPUT = NEW_FILE ? NEW_FILE.name : undefined;
let ANSWER = NEW_FILE ? NEW_FILE.answer : undefined;
// What the user picks in the next quick picks, and the folders chosen in the next folder dialogs.
const WORK_DIR = path.dirname(path.resolve(ROOT));
const withWork = (s) => s.split('${work}').join(WORK_DIR);
const PICKS = NEW_FILE && NEW_FILE.picks ? [...NEW_FILE.picks] : [];
const BROWSE = NEW_FILE && NEW_FILE.browse ? NEW_FILE.browse.map(withWork) : [];
/** A path as tests expect it: forward slashes, the work folder as ${work}. */
const shownPath = (s) => String(s).split(path.sep).join('/').split(WORK_DIR.split(path.sep).join('/')).join('${work}');
for (const [k, v] of Object.entries(JSON.parse(process.env.PROCESS_ENV || '{}'))) process.env[k] = withWork(v);

const SCAN_NAMES = new Set(['cmakelists.txt', 'qmldir']);
const SCAN_EXT = new Set([
  '.cmake', '.pro', '.pri', '.prf', '.qrc', '.ui', '.qml', '.js', '.mjs',
  '.c', '.cc', '.cpp', '.cxx', '.m', '.mm', '.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp'
]);
const EXCLUDE_DIRS = new Set(['.git', 'node_modules']);

function excluded(name) {
  return EXCLUDE_DIRS.has(name.toLowerCase());
}

// Defaults straight from the extension manifest, so settings behave as in VS Code.
const EXT_DIR = process.env.EXT_DIR || path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
const DEFAULTS = {};
for (const [k, v] of Object.entries(MANIFEST.contributes.configuration.properties)) {
  DEFAULTS[k.replace(/^qtWorkbench\./, '')] = v.default;
}

// Minimal glob support: enough for the ** / * / {a,b} patterns the extension uses.
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
function splitBraces(glob) {
  if (!glob) return [];
  const inner = glob.startsWith('{') && glob.endsWith('}') ? glob.slice(1, -1) : glob;
  return inner.split(',').map(globToRegex);
}

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}
class Selection extends Range {
  constructor(anchor, active) { super(anchor, active); this.anchor = anchor; this.active = active; }
}
class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; }
  static file(p) { return new Uri(path.resolve(p)); }
  static joinPath(u, ...parts) { return new Uri(path.join(u.fsPath, ...parts)); }
  static parse(s) { return { scheme: s.split(':')[0], toString: () => s }; }
  toString() { return 'file://' + this.fsPath; }
}
class WorkspaceEdit {
  // _files: fsPath -> {uri, edits: [{range, newText}]}
  constructor() { this._files = new Map(); this._creates = []; this._renames = []; this._deletes = []; }
  replace(uri, range, newText) {
    if (!this._files.has(uri.fsPath)) this._files.set(uri.fsPath, { uri, edits: [] });
    this._files.get(uri.fsPath).edits.push({ range, newText });
  }
  insert(uri, position, newText) { this.replace(uri, new Range(position, position), newText); }
  createFile(uri, options) { this._creates.push({ uri, options: options || {} }); }
  renameFile(oldUri, newUri, options) { this._renames.push({ oldUri, newUri, options: options || {} }); }
  deleteFile(uri, options) { this._deletes.push({ uri, options: options || {} }); }
  get(uri) { return this._files.has(uri.fsPath) ? this._files.get(uri.fsPath).edits : []; }
  entries() { return [...this._files.values()].map((f) => [f.uri, f.edits]); }
}

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
const InputBoxValidationSeverity = { Info: 1, Warning: 2, Error: 3 };
const QuickPickItemKind = { Separator: -1, Default: 0 };

function walk(dir, out, markers) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (excluded(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, markers);
    else {
      const n = e.name.toLowerCase();
      if (markers) {
        if (n === 'cmakecache.txt' || n === '.qmake.stash') out.push(Uri.file(full));
      } else if (SCAN_NAMES.has(n) || SCAN_EXT.has(path.extname(n))) out.push(Uri.file(full));
    }
  }
}

const OVERRIDES = JSON.parse(process.env.SETTINGS || '{}');
const logLines = [];
const saved = [];
const created = [];
const commands = new Map();
let opened = null; // {fsPath, editor}
const DIRTY = new Set((process.env.DIRTY || '').split(',').filter(Boolean)
  .map((r) => path.resolve(ROOT, r).toLowerCase()));
const docFor = (fsPath, dirty) => ({
  uri: Uri.file(fsPath),
  isDirty: dirty,
  getText: () => fs.readFileSync(fsPath, 'utf8'),
  save: async () => { saved.push(path.relative(ROOT, fsPath).split(path.sep).join('/')); return true; }
});

const StatusBarAlignment = { Left: 1, Right: 2 };
class ThemeColor {
  constructor(id) { this.id = id; }
}
const Disposable = { from: (...items) => ({ dispose: () => items.forEach((d) => d.dispose()) }) };
const noDispose = { dispose: () => {} };

class EventEmitter {
  constructor() { this.listeners = []; this.event = (l) => { this.listeners.push(l); return noDispose; }; }
  fire(value) { for (const l of this.listeners) l(value); }
  dispose() { this.listeners = []; }
}
const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
class TreeItem {
  constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
}
class ThemeIcon {
  constructor(id, color) { this.id = id; this.color = color; }
}
ThemeIcon.File = new ThemeIcon('file');
ThemeIcon.Folder = new ThemeIcon('folder');
class DataTransferItem {
  constructor(value) { this.value = value; }
  async asString() { return typeof this.value === 'string' ? this.value : JSON.stringify(this.value); }
}
class DataTransfer {
  constructor() { this.items = new Map(); }
  get(mime) { return this.items.get(mime); }
  set(mime, item) { this.items.set(mime, item); }
}
const ViewColumn = { Active: -1, Beside: -2 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
const editorListeners = [];

/** A modal message answers ANSWER, its detail logged a line each after it; any other message is only logged. */
function message(kind) {
  return (text, ...rest) => {
    logLines.push('[' + kind + '] ' + text);
    const modal = rest[0] && typeof rest[0] === 'object' && rest[0].modal;
    if (modal && rest[0].detail) for (const line of rest[0].detail.split('\n')) logLines.push('[detail] ' + shownPath(line));
    return Promise.resolve(modal && rest.includes(ANSWER) ? ANSWER : undefined);
  };
}

function fireWatchers(event, uri) {
  for (const w of vscode.__watchers) if (!w.disposed && w[event]) w[event](uri);
}

const vscode = {
  Position, Range, Selection, Uri, WorkspaceEdit, FileType, InputBoxValidationSeverity, QuickPickItemKind,
  StatusBarAlignment, ThemeColor, Disposable, EventEmitter, TreeItem, TreeItemCollapsibleState,
  ThemeIcon, DataTransfer, DataTransferItem, ViewColumn, ProgressLocation,
  env: { openExternal: async (uri) => { console.log('OPENED EXTERNAL: ' + uri); return true; } },
  extensions: { getExtension: (id) => ((process.env.EXTENSIONS || '').split(',').includes(id) ? { id } : undefined) },
  debug: {
    onDidStartDebugSession: (h) => { vscode.__onDidStartDebug = h; return noDispose; },
    onDidTerminateDebugSession: (h) => { vscode.__onDidTerminateDebug = h; return noDispose; },
    registerDebugConfigurationProvider: () => noDispose,
    registerDebugAdapterTrackerFactory: () => noDispose
  },
  languages: {
    registerRenameProvider: (selector, provider) => {
      vscode.__renameProvider = provider;
      return { dispose: () => { if (vscode.__renameProvider === provider) vscode.__renameProvider = null; } };
    }
  },
  window: {
    onDidChangeActiveTextEditor: (h) => { editorListeners.push(h); return noDispose; },
    createOutputChannel: () => ({
      appendLine: (l) => logLines.push(l),
      show: () => {},
      dispose: () => {}
    }),
    showInformationMessage: message('info'),
    showErrorMessage: message('error'),
    showWarningMessage: message('warning'),
    createTreeView: (id, options) => {
      const view = {
        id,
        visible: true,
        selection: [],
        provider: options.treeDataProvider,
        dragAndDrop: options.dragAndDropController,
        reveal: async (node) => { view.selection = [node]; console.log('  revealed: ' + nodeName(node)); },
        onDidChangeVisibility: () => noDispose,
        onDidChangeSelection: () => noDispose,
        dispose: () => {}
      };
      vscode.__treeViews.set(id, view);
      return view;
    },
    setStatusBarMessage: (text) => { logLines.push('[status bar] ' + text); return noDispose; },
    withProgress: async (options, task) => {
      const token = { isCancellationRequested: false, onCancellationRequested: () => noDispose };
      return task({ report: (value) => console.log('PROGRESS: ' + options.title + ': ' + shownPath(value.message)) }, token);
    },
    createStatusBarItem: () => {
      const item = { text: '', visible: false, show() { item.visible = true; }, hide() { item.visible = false; }, dispose() { item.visible = false; } };
      vscode.__statusItem = item;
      return item;
    },
    activeTextEditor: undefined,
    showWorkspaceFolderPick: async () => vscode.workspace.workspaceFolders[0],
    // VS Code keeps the box open while validateInput reports an error; here that ends the command.
    showInputBox: async (options) => {
      console.log('PROMPT: ' + (options.value || ''));
      if (INPUT === undefined) return undefined; // Escape
      const problem = options.validateInput ? await options.validateInput(INPUT) : undefined;
      if (problem) {
        const error = typeof problem === 'string' || problem.severity === InputBoxValidationSeverity.Error;
        console.log((error ? 'INVALID: ' : 'WARNING: ') + (problem.message || problem));
        if (error) return undefined;
      }
      return INPUT;
    },
    showQuickPick: async (items, options) => {
      console.log('PICK: ' + (options && options.placeHolder ? shownPath(options.placeHolder) : ''));
      for (const item of items) {
        if (item.kind === QuickPickItemKind.Separator) {
          console.log('  --' + (item.label ? ' ' + item.label : ''));
          continue;
        }
        const parts = [item.label, item.description, item.detail].filter(Boolean).map(shownPath);
        const box = options && options.canPickMany ? (item.picked ? '[x] ' : '[ ] ') : '';
        console.log('  ' + box + parts.join(' | '));
      }
      const answer = PICKS.shift();
      if (answer === undefined) return undefined; // Escape
      const unicon = (label) => label.replace(/^\$\([^)]*\)\s*/, '');
      const find = (label) => {
        const item = items.find((i) => i.kind !== QuickPickItemKind.Separator && shownPath(unicon(i.label)) === label);
        if (!item) throw new Error('no item ' + label + ' in the quick pick');
        return item;
      };
      return options && options.canPickMany ? [].concat(answer).map(find) : find(answer);
    },
    showOpenDialog: async () => {
      const dir = BROWSE.shift();
      console.log('BROWSED: ' + (dir === undefined ? '(cancelled)' : shownPath(dir)));
      return dir === undefined ? undefined : [Uri.file(dir)];
    },
    showTextDocument: async (doc) => {
      opened = { fsPath: doc.uri.fsPath, editor: { selection: null } };
      return opened.editor;
    }
  },
  commands: {
    registerCommand: (id, handler) => { commands.set(id, handler); return { dispose: () => {} }; },
    executeCommand: (id, ...args) => executeCommand(id, ...args)
  },
  workspace: {
    workspaceFolders: process.env.NO_FOLDER === '1' ? undefined : [{ uri: Uri.file(ROOT), name: path.basename(ROOT), index: 0 }],
    updateWorkspaceFolders: (start, deleteCount, ...folders) => {
      for (const folder of folders) console.log('ADDED TO WORKSPACE: ' + shownPath(folder.uri.fsPath));
      return true;
    },
    get textDocuments() { return [...DIRTY].map((p) => docFor(p, true)); },
    // After the edit is applied every edited document is dirty, as in VS Code.
    openTextDocument: async (uri) => docFor(uri.fsPath, true),
    getConfiguration: (section) => ({
      get: (k, d) => {
        if (section === 'files' && k === 'refactoring.autoSave') return process.env.AUTOSAVE !== 'false';
        if (section === 'qtWorkbench' && k in OVERRIDES) return OVERRIDES[k];
        if (section !== 'qtWorkbench') {
          const value = OVERRIDES[section + '.' + k];
          const deep = (v) => (typeof v === 'string' ? withWork(v) : Array.isArray(v) ? v.map(deep) : v);
          if (value !== undefined) return deep(value);
        }
        return k in DEFAULTS ? DEFAULTS[k] : d;
      }
    }),
    asRelativePath: (p) => path.relative(ROOT, typeof p === 'string' ? p : p.fsPath).split(path.sep).join('/'),
    findFiles: async (include, exclude) => {
      const out = [];
      walk(ROOT, out, /CMakeCache\.txt/.test(include));
      const ex = splitBraces(exclude);
      return out.filter((u) => {
        const rel = path.relative(ROOT, u.fsPath).split(path.sep).join('/');
        return !ex.some((r) => r.test(rel));
      });
    },
    // File operations first, then the text edits, as VS Code applies them. A rename or a
    // delete runs the file operation participants and fires the watcher.
    applyEdit: async (edit) => {
      if (edit._renames.length > 0) {
        if (edit._renames.some((r) => !fs.existsSync(r.oldUri.fsPath) || (fs.existsSync(r.newUri.fsPath) && !r.options.overwrite))) return false;
        const files = edit._renames.map(({ oldUri, newUri }) => ({ oldUri, newUri }));
        let pending = null;
        await vscode.__onWillRename({ files, waitUntil: (p) => { pending = p; } });
        if (pending) applyEdit(await pending);
        for (const { oldUri, newUri } of files) {
          fs.mkdirSync(path.dirname(newUri.fsPath), { recursive: true });
          fs.renameSync(oldUri.fsPath, newUri.fsPath);
          console.log('  RENAMED: ' + relPath(oldUri.fsPath) + ' -> ' + relPath(newUri.fsPath));
          fireWatchers('delete', oldUri);
          fireWatchers('create', newUri);
        }
        await vscode.__onDidRename({ files });
      }
      if (edit._deletes.length > 0) {
        const files = edit._deletes.map((d) => d.uri);
        let pending = null;
        await vscode.__onWillDelete({ files, waitUntil: (p) => { pending = p; } });
        if (pending) applyEdit(await pending);
        for (const uri of files) {
          fs.rmSync(uri.fsPath, { recursive: true, force: true });
          console.log('  DELETED: ' + relPath(uri.fsPath));
          fireWatchers('delete', uri);
        }
        await vscode.__onDidDelete({ files });
      }
      for (const { uri, options } of edit._creates) {
        if (fs.existsSync(uri.fsPath) && !options.overwrite) {
          if (options.ignoreIfExists) continue;
          return false;
        }
        fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        fs.writeFileSync(uri.fsPath, '');
        created.push(relPath(uri.fsPath));
        fireWatchers('create', uri);
      }
      applyEdit(edit);
      return true;
    },
    onDidChangeWorkspaceFolders: () => noDispose,
    onDidChangeConfiguration: () => noDispose,
    onWillRenameFiles: (h) => { vscode.__onWillRename = h; return { dispose: () => {} }; },
    onDidRenameFiles: (h) => { vscode.__onDidRename = h; return { dispose: () => {} }; },
    onWillDeleteFiles: (h) => { vscode.__onWillDelete = h; return { dispose: () => {} }; },
    onDidDeleteFiles: (h) => { vscode.__onDidDelete = h; return { dispose: () => {} }; },
    onDidSaveTextDocument: (h) => { vscode.__onDidSave = h; return noDispose; },
    createFileSystemWatcher: () => {
      const w = {
        disposed: false,
        onDidChange: (h) => { w.change = h; return noDispose; },
        onDidCreate: (h) => { w.create = h; return noDispose; },
        onDidDelete: (h) => { w.delete = h; return noDispose; },
        dispose: () => { w.disposed = true; }
      };
      vscode.__watchers.push(w);
      return w;
    },
    fs: {
      stat: async (uri) => {
        const st = fs.statSync(uri.fsPath); // throws if missing, as the real API does
        return { type: st.isDirectory() ? FileType.Directory : FileType.File, size: st.size };
      },
      readDirectory: async (uri) =>
        fs.readdirSync(uri.fsPath, { withFileTypes: true })
          .map((e) => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]),
      readFile: async (uri) => fs.readFileSync(uri.fsPath),
      createDirectory: async (uri) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, bytes) => {
        fs.writeFileSync(uri.fsPath, bytes); // throws if the folder is missing
        created.push(relPath(uri.fsPath));
        fireWatchers('create', uri);
      }
    }
  }
};

vscode.__watchers = [];
vscode.__treeViews = new Map();

const realRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') return vscode;
  return realRequire.apply(this, arguments);
};

const ext = require(path.join(EXT_DIR, MANIFEST.main));
const subs = [];
const globalState = new Map();
ext.activate({
  subscriptions: subs,
  globalState: { get: (k, d) => (globalState.has(k) ? globalState.get(k) : d), update: async (k, v) => { globalState.set(k, v); } }
});

// --- rename providers, asked the way VS Code asks them ----------------------

const relPath = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const CANCEL = { isCancellationRequested: false };

function textDocument(fsPath) {
  const text = fs.readFileSync(fsPath, 'utf8');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    uri: Uri.file(fsPath),
    languageId: 'cpp',
    getText: () => text,
    offsetAt: (pos) => starts[pos.line] + pos.character,
    positionAt: (off) => {
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= off) line++;
      return new Position(line, off - starts[line]);
    }
  };
}

function wordAt(doc, pos) {
  const text = doc.getText();
  let start = doc.offsetAt(pos);
  let end = start;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  if (start === end) return null;
  return { word: text.slice(start, end), range: new Range(doc.positionAt(start), doc.positionAt(end)) };
}

const CPP_FILE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const BUILD_DIR = /^(?:build|builds|build-.+|cmake-build-.+)$/i;

/** True when `offset` is inside a "string" or after a // comment on its line. */
function inStringOrComment(text, offset) {
  let quoted = false;
  for (let i = text.lastIndexOf('\n', offset - 1) + 1; i < offset; i++) {
    if (quoted && text[i] === '\\') i++;
    else if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text.startsWith('//', i)) return true;
  }
  return quoted;
}

// Stands in for clangd or cpptools: renames the whole word in every C/C++ source, but
// not in strings or comments -- unless LS_STRINGS=1, as when the cpptools rename pane
// is told to include the string occurrences too.
const fakeLanguageServer = {
  prepareRename(doc, pos) {
    const w = wordAt(doc, pos);
    if (!w) throw new Error("The element can't be renamed.");
    return { range: w.range, placeholder: w.word };
  },
  provideRenameEdits(doc, pos, newName) {
    const { word } = wordAt(doc, pos);
    let targets;
    if (SYMBOL.cppFiles) {
      targets = SYMBOL.cppFiles.map((f) => path.join(ROOT, f));
    } else {
      const all = [];
      walk(ROOT, all, false);
      targets = all
        .map((u) => u.fsPath)
        .filter((p) => CPP_FILE.test(p) && !relPath(p).split('/').slice(0, -1).some((d) => BUILD_DIR.test(d)));
    }
    const edit = new WorkspaceEdit();
    for (const p of targets) {
      const target = textDocument(p);
      const re = new RegExp('\\b' + word + '\\b', 'g');
      let m;
      while ((m = re.exec(target.getText())) !== null) {
        if (process.env.LS_STRINGS !== '1' && inStringOrComment(target.getText(), m.index)) continue;
        const range = new Range(target.positionAt(m.index), target.positionAt(m.index + word.length));
        edit.replace(target.uri, range, newName);
      }
    }
    return edit;
  }
};

// The extension host's RenameAdapter (extHostLanguageFeatures.ts) turns a thrown error
// into a rejection.
async function ask(fn) {
  try {
    return await fn();
  } catch (err) {
    return { rejectReason: err.message };
  }
}

// RenameSkeleton in src/vs/editor/contrib/rename/browser/rename.ts: providers newest
// first; the one that resolves the location provides the edits, and a provider that
// answers nothing hands over to the next.
function renameSkeleton(doc, pos) {
  const providers = [vscode.__renameProvider, fakeLanguageServer].filter(Boolean);
  let first = 0;
  return {
    async resolveRenameLocation() {
      const rejects = [];
      for (first = 0; first < providers.length; first++) {
        const provider = providers[first];
        if (!provider.prepareRename) break;
        const res = await ask(() => provider.prepareRename(doc, pos, CANCEL));
        if (res && res.rejectReason) {
          rejects.push(res.rejectReason);
          continue;
        }
        if (!res || !res.placeholder) continue;
        return { range: res.range, text: res.placeholder };
      }
      first = 0;
      const w = wordAt(doc, pos);
      return { range: w && w.range, text: w ? w.word : '', rejectReason: rejects.length ? rejects.join('\n') : undefined };
    },
    async provideRenameEdits(newName) {
      const rejects = [];
      for (let i = first; i < providers.length; i++) {
        const res = await ask(() => providers[i].provideRenameEdits(doc, pos, newName, CANCEL));
        if (!res) {
          rejects.push('No result.');
          continue;
        }
        if (res.rejectReason) {
          rejects.push(res.rejectReason);
          continue;
        }
        return res;
      }
      return { rejectReason: rejects.join('\n') };
    }
  };
}

// The extension's own commands; vscode.prepareRename and vscode.executeDocumentRenameProvider
// (extHostApiCommands.ts); vscode.openFolder, printed; any other command does nothing.
async function executeCommand(id, uri, pos, newName) {
  if (commands.has(id)) return commands.get(id)(uri, pos, newName);
  if (id === 'cmake.activeConfigurePresetName') return process.env.ACTIVE_PRESET;
  if (id === 'vscode.openFolder') {
    console.log('OPENED FOLDER: ' + shownPath(uri.fsPath) + (pos ? ' ' + JSON.stringify(pos) : ''));
    return undefined;
  }
  if (id === 'vscode.prepareRename') {
    const loc = await renameSkeleton(textDocument(uri.fsPath), pos).resolveRenameLocation();
    if (loc.rejectReason) throw new Error(loc.rejectReason);
    return { range: loc.range, placeholder: loc.text };
  }
  if (id === 'vscode.executeDocumentRenameProvider') {
    const skeleton = renameSkeleton(textDocument(uri.fsPath), pos);
    const loc = await skeleton.resolveRenameLocation();
    if (loc.rejectReason) throw new Error(loc.rejectReason);
    const result = await skeleton.provideRenameEdits(newName);
    if (result.rejectReason) throw new Error(result.rejectReason);
    return result;
  }
  return undefined;
}

// --- drive a rename -------------------------------------------------------

/** Apply a WorkspaceEdit to the files on disk; returns the files it changed. */
function applyEdit(edit) {
  const changed = [];
  for (const [uri, list] of edit.entries()) {
    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    const off = (pos) => starts[pos.line] + pos.character;
    // descending offset order so ranges stay valid
    const sorted = list
      .map((e) => ({ s: off(e.range.start), e: off(e.range.end), t: e.newText }))
      .sort((a, b) => b.s - a.s || b.e - a.e);
    // VS Code refuses the whole edit then (PieceTreeTextBuffer.applyEdits).
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].e > sorted[i - 1].s) throw new Error('Overlapping ranges are not allowed! (' + relPath(uri.fsPath) + ')');
    }
    let out = text;
    for (const e of sorted) out = out.slice(0, e.s) + e.t + out.slice(e.e);
    fs.writeFileSync(uri.fsPath, out);
    changed.push(relPath(uri.fsPath));
  }
  return changed;
}

async function moveFiles() {
  const files = MOVES.map(([o, n]) => ({
    oldUri: Uri.file(path.join(ROOT, o)),
    newUri: Uri.file(path.join(ROOT, n))
  }));

  let pending = null;
  await vscode.__onWillRename({ files, waitUntil: (p) => { pending = p; } });
  applyEdit(await pending);

  // perform the moves themselves
  for (const [o, n] of MOVES) {
    const from = path.join(ROOT, o);
    const to = path.join(ROOT, n);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }

  if (vscode.__onDidRename) await vscode.__onDidRename({ files });
  console.log('SAVED: ' + saved.sort().join(','));
}

// What the rename widget does on F2 (RenameController.run in rename.ts).
async function renameSymbol() {
  const doc = textDocument(path.join(ROOT, SYMBOL.file));
  const at = new RegExp('\\b' + SYMBOL.symbol + '\\b').exec(doc.getText());
  if (!at) throw new Error(SYMBOL.symbol + ' not found in ' + SYMBOL.file);
  const skeleton = renameSkeleton(doc, doc.positionAt(at.index));
  const loc = await skeleton.resolveRenameLocation();
  const result = loc.rejectReason ? loc : await skeleton.provideRenameEdits(SYMBOL.newName);
  if (result.rejectReason) console.log('REJECTED: ' + result.rejectReason);
  else console.log('EDITED: ' + applyEdit(result).sort().join(','));
}

async function deleteFiles() {
  const files = DELETES.map((p) => Uri.file(path.join(ROOT, p)));
  let pending = null;
  await vscode.__onWillDelete({ files, waitUntil: (p) => { pending = p; } });
  applyEdit(await pending);
  for (const uri of files) fs.rmSync(uri.fsPath, { recursive: true, force: true });
  if (vscode.__onDidDelete) await vscode.__onDidDelete({ files });
  console.log('SAVED: ' + saved.sort().join(','));
}

// What the explorer's context menu does: run the command with the right-clicked resource.
async function newFile() {
  const handler = commands.get(NEW_FILE.command);
  if (!handler) throw new Error('no such command: ' + NEW_FILE.command);
  await handler(NEW_FILE.at === undefined ? undefined : Uri.file(path.join(ROOT, NEW_FILE.at)));
  console.log('CREATED: ' + created.join(','));
  console.log('SAVED: ' + saved.sort().join(','));
  if (opened) {
    const at = opened.editor.selection ? opened.editor.selection.active : { line: '?', character: '?' };
    console.log('OPENED: ' + relPath(opened.fsPath) + ':' + at.line + ':' + at.character);
  }
}

// A debug session as VS Code runs one: the start event, which nobody awaits, then whatever
// happens while it runs, then the end.
async function debugSession() {
  const { FakeQmlApp, describe } = require('./fake-qml-app');
  const app = new FakeQmlApp();
  const port = await app.listen();
  const root = ROOT.split(path.sep).join('/');
  const configuration = JSON.parse(JSON.stringify(DEBUG.debug).split('${port}').join(String(port)));
  const session = { id: 'debug-1', name: 'Debug appTest', configuration };
  let seen = 0;
  const started = vscode.__onDidStartDebug(session);

  for (const step of DEBUG.steps) {
    console.log('> ' + JSON.stringify(step));
    const file = (rel) => Uri.file(path.join(ROOT, rel));
    if (step.connect) {
      const ok = await app.waitFor(() => app.connected, typeof step.connect === 'number' ? step.connect : 5000);
      console.log('  ' + (ok ? 'connected, asking for ' + app.clientServices.join(',') : 'not connected'));
    } else if (step.request) {
      await app.request(step.request.split('${root}').join(root));
    } else if (step.write) {
      fs.writeFileSync(path.join(ROOT, step.write), step.text);
    } else if (step.save) {
      vscode.__onDidSave({ uri: file(step.save) });
    } else if (step.watch) {
      for (const w of vscode.__watchers) if (!w.disposed && w.change) w.change(file(step.watch));
    } else if (step.appError) {
      app.reportError(step.appError);
    } else if (step.command) {
      await commands.get(step.command)();
    } else if (step.wait) {
      await new Promise((resolve) => setTimeout(resolve, step.wait));
    } else if (step.status) {
      const item = vscode.__statusItem;
      const color = item && item.backgroundColor ? ' [' + item.backgroundColor.id + ']' : '';
      console.log('  status: ' + (item && item.visible ? item.text + color + ' -> ' + item.command : '(hidden)'));
    } else if (step.end) {
      vscode.__onDidTerminateDebug(session);
      const closed = await app.waitFor(() => !app.socket, 2000);
      console.log('  application ' + (closed ? 'disconnected' : 'still connected'));
    }
    for (; seen < app.received.length; seen++) console.log('  app got ' + describe(app.received[seen]));
  }
  await started;
  // As VS Code does on shutdown, so no connection attempt or timer outlives the test.
  for (const s of subs) if (s && s.dispose) s.dispose();
  app.close();
}

// --- the Qt Project Explorer -------------------------------------------------

/** A node's labels from its root down, joined with " > ". */
function nodeName(node) {
  const labels = [];
  for (let n = node; n; n = n.parent) labels.unshift(n.label);
  return labels.join(' > ');
}

async function findNode(provider, name) {
  let nodes = await provider.getChildren();
  let node = null;
  for (const label of name.split(' > ')) {
    node = (nodes || []).find((n) => n.label === label);
    if (!node) throw new Error('no node ' + name + ' (stuck at ' + label + ')');
    nodes = await provider.getChildren(node);
  }
  return node;
}

async function printTree(provider, nodes, indent) {
  for (const node of nodes) {
    const item = provider.getTreeItem(node);
    console.log('  ' + indent + item.label + (item.description ? '  ' + item.description : ''));
    await printTree(provider, await provider.getChildren(node), indent + '  ');
  }
}

async function explorer() {
  const view = vscode.__treeViews.get('qtWorkbench.projectExplorer');
  const provider = view.provider;
  for (const step of EXPLORER) {
    console.log('> ' + JSON.stringify(step));
    INPUT = step.input;
    ANSWER = step.answer;
    PICKS.push(...(step.picks || []));
    BROWSE.push(...(step.browse || []).map(withWork));
    if (step.tree) {
      await printTree(provider, await provider.getChildren(), '');
    } else if (step.item) {
      const item = provider.getTreeItem(await findNode(provider, step.item));
      const shown = {
        collapsibleState: Object.keys(TreeItemCollapsibleState).find((k) => TreeItemCollapsibleState[k] === item.collapsibleState),
        contextValue: item.contextValue,
        icon: item.iconPath && item.iconPath.id + (item.iconPath.color ? ' ' + item.iconPath.color.id : ''),
        resourceUri: item.resourceUri && relPath(item.resourceUri.fsPath),
        command: item.command && item.command.command + ' ' + item.command.arguments.map((a) => relPath(a.fsPath)).join(' '),
        tooltip: item.tooltip && item.tooltip.split(ROOT.split(path.sep).join('/')).join('${root}')
      };
      for (const [k, v] of Object.entries(shown)) if (v !== undefined) console.log('  ' + k + ': ' + v);
    } else if (step.command) {
      const node = step.node ? await findNode(provider, step.node) : undefined;
      const nodes = step.nodes ? await Promise.all(step.nodes.map((n) => findNode(provider, n))) : node ? [node] : undefined;
      if (!step.node) view.selection = nodes || [];
      await commands.get(step.command)(node, nodes);
    } else if (step.drag) {
      const sources = await Promise.all(step.drag.map((n) => findNode(provider, n)));
      const transfer = new DataTransfer();
      await view.dragAndDrop.handleDrag(sources, transfer);
      console.log('  dragged: ' + [...transfer.items.keys()].join(', '));
      await view.dragAndDrop.handleDrop(await findNode(provider, step.onto), transfer);
    } else if (step.editor) {
      const uri = Uri.file(path.join(ROOT, step.editor));
      vscode.window.activeTextEditor = { document: { uri, languageId: path.extname(uri.fsPath).slice(1) } };
      await Promise.all(editorListeners.map((l) => l(vscode.window.activeTextEditor)));
    } else if (step.write) {
      fs.writeFileSync(path.join(ROOT, step.write), step.text);
      fireWatchers('change', Uri.file(path.join(ROOT, step.write)));
    }
  }
  console.log('SAVED: ' + saved.sort().join(','));
  for (const s of subs) if (s && s.dispose) s.dispose();
}

(async () => {
  try {
    await (MOVES ? moveFiles() : NEW_FILE ? newFile() : DELETES ? deleteFiles() : DEBUG ? debugSession() : EXPLORER ? explorer() : renameSymbol());
  } catch (err) {
    console.log('FAILED: ' + err.message);
    process.exitCode = 1;
  }
  console.log('===== LOG =====');
  console.log(logLines.join('\n'));
  console.log('');
  console.log('===== DIFF =====');
  // Only in a project that is its own repository: elsewhere `git add -A` would walk
  // up and stage files in whatever repository happens to enclose it.
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.log('(not a git repository: no diff)');
    return;
  }
  try {
    execSync('git add -A && git -c core.pager=cat diff --cached --no-color -U1', {
      cwd: ROOT, stdio: 'inherit'
    });
  } catch (e) {
    console.log('(diff failed: ' + e.message + ')');
  }
})();
