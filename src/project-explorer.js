'use strict';

/**
 * Qt Project Explorer: Qt Creator's project tree in the explorer side bar. What it shows
 * comes from project-tree/; this is the view around it. A click opens a file. Rename,
 * Delete and dragging files onto a folder make the workspace edits the explorer makes, so
 * the references to the files are updated as for any move or delete. The tree is read
 * again when a build file changes, a file is created or deleted, the git branch changes, or
 * vcpkg installs packages.
 */

const vscode = require('vscode');
const path = require('path');
const { IgnoreRules, excludeGlob } = require('./ignore');
const { log } = require('./log');
const { key } = require('./paths');
const { loadTree } = require('./project-tree/tree');

const VIEW = 'qtWorkbench.projectExplorer';
const HAS_PROJECT_FILES = 'qtWorkbench.projectExplorer.hasProjectFiles';
const DRAG_MIME = 'application/vnd.code.tree.qtworkbench.projectexplorer';
const PROJECT_GLOB = '**/{CMakeLists.txt,*.pro}';
const REFRESH_MS = 300;

/** Files whose contents shape the tree. Any file created or deleted can change it too. */
const BUILD_FILE = /^(?:CMakeLists\.txt|CMakePresets\.json|CMakeUserPresets\.json|vcpkg\.json)$|\.(?:cmake|pro|pri|prf|qrc)$/i;
const PROJECT_FILE = /^CMakeLists\.txt$|\.pro$/i;
/** vcpkg's install database, which changes when vcpkg installs, in a build folder too. */
const VCPKG_DATABASE = /[\\/]vcpkg_installed[\\/]vcpkg[\\/](?:status|updates[\\/][^\\/]+)$/i;

function describeError(err) {
  return err && err.stack ? err.stack : String(err);
}

async function readText(p) {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(p))).toString('utf8');
  } catch (_) {
    return null;
  }
}

/** The branch checked out in the git repository holding `dir`, a short commit when detached, or null. */
async function gitBranch(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    const dotGit = path.join(d, '.git');
    let stat = null;
    try {
      stat = await vscode.workspace.fs.stat(vscode.Uri.file(dotGit));
    } catch (_) {
      // not the repository's root
    }
    if (stat) {
      let gitDir = dotGit;
      if ((stat.type & vscode.FileType.Directory) === 0) {
        // a worktree or submodule: .git is a file naming the real git directory
        const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec((await readText(dotGit)) || '');
        if (!m) return null;
        gitDir = path.resolve(d, m[1]);
      }
      const head = ((await readText(path.join(gitDir, 'HEAD'))) || '').trim();
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      return ref ? ref[1] : /^[0-9a-f]{40}/i.test(head) ? head.slice(0, 7) : null;
    }
    if (path.dirname(d) === d) return null;
  }
}

/**
 * How project-tree/ reads the disk: nothing in a build tree or ignored by git is read.
 * `classified` are the paths `rules` has asked git about already.
 */
function projectIo(rules, classified) {
  const asked = new Set(classified.map(key));
  const classify = async (paths) => {
    const fresh = paths.filter((p) => !asked.has(key(p)));
    for (const p of fresh) asked.add(key(p));
    if (fresh.length > 0) await rules.classify(fresh);
  };
  return {
    async readFile(p) {
      if (rules.inBuildTree(p)) return null;
      await classify([p]);
      return rules.isIgnored(p) ? null : readText(p);
    },
    async readDirectory(p) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        return entries.map(([name, type]) => [name, (type & vscode.FileType.Directory) !== 0]);
      } catch (_) {
        return null;
      }
    },
    async stat(p) {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(p));
        return (stat.type & vscode.FileType.Directory) !== 0 ? 'directory' : 'file';
      } catch (_) {
        return null;
      }
    },
    skipDirectory(p) {
      return /^(?:\.git|node_modules)$/i.test(path.basename(p)) || rules.inBuildTree(path.join(p, '_'));
    },
    classify,
    isIgnored: (p) => rules.isIgnored(p),
    branch: gitBranch,
    // vcpkg's, not the project's: its install database is read in a build folder or an ignored one too.
    readVcpkgInstalled: readText
  };
}

function isOnDisk(node) {
  return Boolean(node) && (node.kind === 'file' || node.kind === 'folder') && !node.missing;
}

/** `nodes` on disk, each once, without those inside a folder that is among them too. */
function outermost(nodes) {
  const onDisk = nodes.filter(isOnDisk);
  const unique = [...new Map(onDisk.map((n) => [key(n.path), n])).values()];
  return unique.filter((n) => !unique.some((other) => other !== n && key(n.path).startsWith(key(other.path) + path.sep)));
}

function treeItem(node) {
  const State = vscode.TreeItemCollapsibleState;
  const item = new vscode.TreeItem(node.label, node.children.length === 0 ? State.None : node.expanded ? State.Expanded : State.Collapsed);
  item.id = node.id;
  item.description = node.description;
  item.tooltip = node.tooltip;
  item.contextValue = node.contextValue;
  // A file or folder gets the file icon theme's icon and the git and problem decorations.
  if (!node.missing && (node.kind === 'file' || node.kind === 'folder' || node.kind === 'directory')) {
    item.resourceUri = vscode.Uri.file(node.path);
  }
  if (node.icon) {
    item.iconPath = new vscode.ThemeIcon(node.icon, node.missing ? new vscode.ThemeColor('problemsWarningIcon.foreground') : undefined);
  } else {
    item.iconPath = node.kind === 'file' ? vscode.ThemeIcon.File : vscode.ThemeIcon.Folder;
  }
  if (node.kind === 'file' && !node.missing) {
    item.command = { command: 'vscode.open', title: 'Open', arguments: [item.resourceUri] };
  }
  return item;
}

class ProjectExplorer {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.view = null;
    this.roots = [];
    this.byFile = new Map(); // key -> the node a file is revealed at
    this.loading = null;
    this.stale = true;
    this.timer = null;
    this.rules = new IgnoreRules([]); // the last load's, to tell build output from project files
  }

  getTreeItem(node) {
    return treeItem(node);
  }

  getParent(node) {
    return node.parent || undefined;
  }

  getChildren(node) {
    if (node) return node.children;
    if (this.stale) {
      // One read at a time, so the last one to finish is the newest.
      this.stale = false;
      this.loading = (this.loading || Promise.resolve()).then(() => this.load());
    }
    return this.loading;
  }

  async load() {
    let roots = [];
    const folders = (vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
    try {
      if (folders.length > 0) {
        const rules = await IgnoreRules.load();
        const found = (await vscode.workspace.findFiles(PROJECT_GLOB, excludeGlob())).map((u) => u.fsPath);
        await rules.classify(found);
        const files = found.filter((p) => !rules.isIgnored(p));
        this.rules = rules;
        roots = await loadTree(
          {
            cmake: files.filter((p) => path.basename(p).toLowerCase() === 'cmakelists.txt'),
            qmake: files.filter((p) => /\.pro$/i.test(p))
          },
          folders,
          projectIo(rules, found)
        );
      }
    } catch (err) {
      log.appendLine('! Qt Project Explorer could not read the projects: ' + describeError(err));
    }
    this.roots = roots;
    this.index();
    return roots;
  }

  /** Where each file is revealed: its first node outside a .qrc, else its first inside one. */
  index() {
    const outside = new Map();
    const inside = new Map();
    const visit = (node, inQrc) => {
      if (node.kind === 'file' && !node.missing) {
        const map = inQrc ? inside : outside;
        if (!map.has(key(node.path))) map.set(key(node.path), node);
      }
      for (const child of node.children) visit(child, inQrc || node.kind === 'file');
    };
    for (const root of this.roots) visit(root, false);
    this.byFile = new Map([...inside, ...outside]);
  }

  /** Read the projects again once changes stop coming for a moment; if the view is hidden, when it is shown. */
  schedule() {
    this.stale = true;
    clearTimeout(this.timer);
    if (this.view && this.view.visible) this.timer = setTimeout(() => this.emitter.fire(), REFRESH_MS);
  }

  refreshNow() {
    clearTimeout(this.timer);
    this.stale = true;
    this.emitter.fire();
  }

  onDidChangeVisibility() {
    if (!this.view.visible) return;
    if (this.stale) this.emitter.fire();
    this.revealActiveFile();
  }

  onFileEvent(p, createdOrDeleted) {
    if (/[\\/]\.git[\\/]HEAD$/i.test(p) || VCPKG_DATABASE.test(p)) {
      this.schedule(); // another branch checked out, or vcpkg installed packages
      return;
    }
    if (/[\\/](?:\.git|node_modules)[\\/]/i.test(p) || this.rules.inBuildTree(p)) return;
    const name = path.basename(p);
    if (createdOrDeleted && PROJECT_FILE.test(name)) updateContext();
    if (createdOrDeleted || BUILD_FILE.test(name)) this.schedule();
  }

  /** Select the active editor's file, as the explorer does. */
  async revealActiveFile() {
    if (!this.view || !this.view.visible) return;
    if (!vscode.workspace.getConfiguration('qtWorkbench').get('projectExplorerAutoReveal', true)) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return;
    await this.getChildren();
    const node = this.byFile.get(key(editor.document.uri.fsPath));
    if (!node || this.view.selection.includes(node)) return;
    try {
      await this.view.reveal(node, { select: true, focus: false });
    } catch (_) {
      // the tree changed while revealing: the next change of editor tries again
    }
  }

  dispose() {
    clearTimeout(this.timer);
    this.emitter.dispose();
  }
}

/** Show the view only in a workspace with a CMakeLists.txt or a .pro in it. */
async function updateContext() {
  try {
    const found = await vscode.workspace.findFiles(PROJECT_GLOB, excludeGlob(), 1);
    await vscode.commands.executeCommand('setContext', HAS_PROJECT_FILES, found.length > 0);
  } catch (err) {
    log.appendLine('! Qt Project Explorer: ' + describeError(err));
  }
}

/** What is wrong with renaming `oldName` in `dir` to `input`, or undefined. */
async function renameProblem(dir, oldName, input) {
  const name = input.trim();
  if (name === '') return 'Enter a name.';
  if (/[\\/]/.test(name)) return 'A name cannot contain / or \\. To move the file, drag it onto a folder.';
  if (/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return '"' + name + '" is not a valid file or folder name.';
  if (key(path.join(dir, name)) !== key(path.join(dir, oldName))) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dir, name)));
      return name + ' already exists here.';
    } catch (_) {
      // free
    }
  }
  return undefined;
}

async function renameNode(node) {
  if (!isOnDisk(node)) return;
  const dir = path.dirname(node.path);
  const name = path.basename(node.path);
  const stem = node.kind === 'file' ? name.length - path.extname(name).length : name.length;
  const input = await vscode.window.showInputBox({
    title: 'Rename ' + name,
    prompt: 'References to it are updated, as for a rename in the explorer.',
    value: name,
    valueSelection: [0, stem > 0 ? stem : name.length],
    validateInput: (text) => renameProblem(dir, name, text)
  });
  if (input === undefined || input.trim() === name) return;
  const problem = await renameProblem(dir, name, input);
  if (problem) {
    vscode.window.showErrorMessage(problem);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(vscode.Uri.file(node.path), vscode.Uri.file(path.join(dir, input.trim())), { overwrite: false });
  if (!(await vscode.workspace.applyEdit(edit))) vscode.window.showErrorMessage('Qt Workbench: could not rename ' + name + '.');
}

async function deleteNodes(nodes) {
  const list = outermost(nodes);
  if (list.length === 0) return;
  const trash = vscode.workspace.getConfiguration('files').get('enableTrash', true);
  if (vscode.workspace.getConfiguration('explorer').get('confirmDelete', true)) {
    const bin = process.platform === 'win32' ? 'Recycle Bin' : 'Trash';
    const one = list.length === 1;
    const what = one
      ? "'" + path.basename(list[0].path) + "'" + (list[0].kind === 'folder' ? ' and its contents' : '')
      : 'the following ' + list.length + ' files and folders';
    const detail =
      (one ? '' : list.map((n) => path.basename(n.path)).join('\n') + '\n\n') +
      (trash ? 'You can restore ' + (one ? 'it' : 'them') + ' from the ' + bin + '.' : 'This action is irreversible!');
    const button = trash ? 'Move to ' + bin : 'Delete';
    const message = 'Are you sure you want to ' + (trash ? '' : 'permanently ') + 'delete ' + what + '?';
    if ((await vscode.window.showWarningMessage(message, { modal: true, detail }, button)) !== button) return;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const node of list) {
    // `folder`, as the explorer passes it: VS Code does not read a folder's contents to keep
    // for undo then, and undo creates a folder again, not a file. Not in the API's typings,
    // but passed through to the edit.
    edit.deleteFile(vscode.Uri.file(node.path), { recursive: true, ignoreIfNotExists: true, folder: node.kind === 'folder' });
  }
  if (!(await vscode.workspace.applyEdit(edit))) vscode.window.showErrorMessage('Qt Workbench: could not delete ' + list.map((n) => path.basename(n.path)).join(', ') + '.');
}

/** Move `nodes` into the folder `target` stands for: a folder, a group's or target's directory, or a file's folder. */
async function moveNodes(nodes, target) {
  const dir = target.kind === 'file' ? path.dirname(target.path) : target.path;
  const moves = outermost(nodes)
    .map((node) => ({ from: node.path, to: path.join(dir, path.basename(node.path)) }))
    .filter((m) => key(path.dirname(m.from)) !== key(dir) && !(key(dir) + path.sep).startsWith(key(m.from) + path.sep));
  if (moves.length === 0) return;
  for (const move of moves) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(move.to));
      vscode.window.showErrorMessage("A file or folder named '" + path.basename(move.to) + "' already exists in '" + path.basename(dir) + "'.");
      return;
    } catch (_) {
      // free
    }
  }
  if (vscode.workspace.getConfiguration('explorer').get('confirmDragAndDrop', true)) {
    const what = moves.length === 1 ? "'" + path.basename(moves[0].from) + "'" : 'the following ' + moves.length + ' files and folders';
    const message = 'Are you sure you want to move ' + what + " into '" + path.basename(dir) + "'?";
    const detail = moves.length === 1 ? undefined : moves.map((m) => path.basename(m.from)).join('\n');
    if ((await vscode.window.showWarningMessage(message, { modal: true, detail }, 'Move')) !== 'Move') return;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const move of moves) edit.renameFile(vscode.Uri.file(move.from), vscode.Uri.file(move.to), { overwrite: false });
  if (!(await vscode.workspace.applyEdit(edit))) vscode.window.showErrorMessage('Qt Workbench: could not move ' + moves.map((m) => path.basename(m.from)).join(', ') + '.');
}

/** Dragging files within the tree moves them; dragged elsewhere, such as into an editor, they are their URIs. */
const dragAndDrop = {
  dragMimeTypes: ['text/uri-list'],
  dropMimeTypes: [DRAG_MIME],

  handleDrag(sources, dataTransfer) {
    const files = sources.filter(isOnDisk);
    if (files.length === 0) return;
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(files));
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(files.map((n) => vscode.Uri.file(n.path).toString()).join('\r\n')));
  },

  async handleDrop(target, dataTransfer) {
    const item = dataTransfer.get(DRAG_MIME);
    if (!item || !target || target.kind === 'vcpkg' || target.kind === 'package' || !Array.isArray(item.value)) return;
    await moveNodes(item.value, target);
  }
};

/** The nodes a command from the context menu or a key acts on: the clicked one with the rest of the selection. */
function chosenNodes(explorer, node, nodes) {
  if (node) return Array.isArray(nodes) && nodes.includes(node) ? nodes : [node];
  return explorer.view ? [...explorer.view.selection] : [];
}

function registerProjectExplorer(context) {
  const explorer = new ProjectExplorer();
  const view = vscode.window.createTreeView(VIEW, {
    treeDataProvider: explorer,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dragAndDrop
  });
  explorer.view = view;

  const command = (id, handler) =>
    vscode.commands.registerCommand(id, async (...args) => {
      try {
        await handler(...args);
      } catch (err) {
        log.appendLine('! ' + id + ' failed: ' + describeError(err));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    });
  // Commands that take a file or folder, run on the one a node stands for.
  const onPath = (target) => (node) => {
    const [first] = chosenNodes(explorer, node);
    return first ? vscode.commands.executeCommand(target, vscode.Uri.file(first.path)) : undefined;
  };
  // On its project: the top node's folder, and the target when it is run on one.
  const addVcpkgPackage = (node) => {
    const [first] = chosenNodes(explorer, node);
    if (!first) return vscode.commands.executeCommand('qtWorkbench.addVcpkgPackage');
    let project = first;
    while (project.parent) project = project.parent;
    return vscode.commands.executeCommand('qtWorkbench.addVcpkgPackage', vscode.Uri.file(project.path), {
      target: first.kind === 'target' ? first.label : undefined
    });
  };
  // The dependencies of vcpkg.json selected, of the first one's project; on vcpkg Packages, they are chosen.
  const removeVcpkgPackage = (node, nodes) => {
    const chosen = chosenNodes(explorer, node, nodes);
    if (chosen.length === 0) return vscode.commands.executeCommand('qtWorkbench.removeVcpkgPackage');
    const projectOf = (n) => (n.parent ? projectOf(n.parent) : n);
    const packages = chosen.filter((n) => n.contextValue === 'qtVcpkgPackage');
    const project = projectOf(packages[0] || chosen[0]);
    const ports = packages.filter((n) => projectOf(n) === project).map((n) => n.label);
    return vscode.commands.executeCommand('qtWorkbench.removeVcpkgPackage', vscode.Uri.file(project.path), ports.length > 0 ? { ports } : undefined);
  };
  const openToSide = (node) => {
    const files = chosenNodes(explorer, node).filter((n) => isOnDisk(n) && n.kind === 'file');
    for (const file of files) {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file.path), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    explorer,
    view,
    watcher,
    watcher.onDidCreate((uri) => explorer.onFileEvent(uri.fsPath, true)),
    watcher.onDidDelete((uri) => explorer.onFileEvent(uri.fsPath, true)),
    watcher.onDidChange((uri) => explorer.onFileEvent(uri.fsPath, false)),
    view.onDidChangeVisibility(() => explorer.onDidChangeVisibility()),
    vscode.window.onDidChangeActiveTextEditor(() => explorer.revealActiveFile()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      updateContext();
      explorer.schedule();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('qtWorkbench.exclude') || event.affectsConfiguration('qtWorkbench.useGitignore')) {
        updateContext();
        explorer.schedule();
      }
    }),
    command('qtWorkbench.projectExplorer.refresh', () => explorer.refreshNow()),
    command('qtWorkbench.projectExplorer.openToSide', openToSide),
    command('qtWorkbench.projectExplorer.revealInExplorer', onPath('revealInExplorer')),
    command('qtWorkbench.projectExplorer.copyPath', onPath('copyFilePath')),
    command('qtWorkbench.projectExplorer.copyRelativePath', onPath('copyRelativeFilePath')),
    command('qtWorkbench.projectExplorer.newQmlFile', onPath('qtWorkbench.newQmlFile')),
    command('qtWorkbench.projectExplorer.newCppSource', onPath('qtWorkbench.newCppSource')),
    command('qtWorkbench.projectExplorer.newCppHeader', onPath('qtWorkbench.newCppHeader')),
    command('qtWorkbench.projectExplorer.setUpVcpkg', onPath('qtWorkbench.setUpVcpkg')),
    command('qtWorkbench.projectExplorer.setUpHotReload', onPath('qtWorkbench.setUpHotReload')),
    command('qtWorkbench.projectExplorer.addVcpkgPackage', addVcpkgPackage),
    command('qtWorkbench.projectExplorer.removeVcpkgPackage', removeVcpkgPackage),
    command('qtWorkbench.projectExplorer.rename', (node) => renameNode(chosenNodes(explorer, node)[0])),
    command('qtWorkbench.projectExplorer.delete', (node, nodes) => deleteNodes(chosenNodes(explorer, node, nodes)))
  );
  updateContext();
}

module.exports = { registerProjectExplorer, projectIo };
