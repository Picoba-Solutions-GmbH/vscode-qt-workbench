'use strict';

/**
 * What the extension must never scan or edit. Three layers, always combined:
 *
 *   - build trees, by folder name (build, builds, build-*, cmake-build-*) and by what
 *     they hold (a CMakeCache.txt or .qmake.stash with no project file next to it),
 *     whichever tool made them. These are skipped unconditionally.
 *   - everything git ignores. git itself is asked, so nested .gitignore files,
 *     negations, .git/info/exclude and the global excludes file all count exactly as
 *     they do for git.
 *   - the user's own qtWorkbench.exclude globs.
 */

const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const { extOf, key, toPosix } = require('./paths');

/** Folder names that are build output for every Qt toolchain in common use. */
const BUILD_DIR_NAME = /^(?:build|builds|build-.+|cmake-build-.+)$/i;
const BUILD_DIR_GLOBS = ['**/build/**', '**/builds/**', '**/build-*/**', '**/cmake-build-*/**'];

const GIT_TIMEOUT_MS = 15000;

/** The exclude glob for findFiles: build folders always, plus the user's globs. */
function excludeGlob() {
  const user = vscode.workspace.getConfiguration('qtWorkbench').get('exclude', []);
  return '{' + BUILD_DIR_GLOBS.concat(user).join(',') + '}';
}

async function exists(p) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Build trees recognised by content rather than name: a CMakeCache.txt or a
 * .qmake.stash. A directory that also holds the project file is an in-source build
 * and is kept -- its generated files are left to .gitignore.
 */
async function findBuildDirectories() {
  const markers = await vscode.workspace.findFiles(
    '**/{CMakeCache.txt,.qmake.stash}',
    '**/{node_modules,.git}/**'
  );
  const dirs = [];
  for (const marker of markers) {
    const dir = path.dirname(marker.fsPath);
    if (await exists(path.join(dir, 'CMakeLists.txt'))) continue;
    let hasProFile = false;
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
      hasProFile = entries.some(([name]) => extOf(name) === '.pro');
    } catch (_) {
      // unreadable: treat it as a build tree
    }
    if (!hasProFile) dirs.push(dir);
  }
  return dirs;
}

function isInside(filePath, dirs) {
  const k = key(filePath);
  return dirs.some((d) => k.startsWith(key(d) + path.sep));
}

/** The innermost workspace folder containing `p`, or null. */
function workspaceFolderOf(p) {
  const k = key(p);
  let best = null;
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const fk = key(folder.uri.fsPath);
    if ((k === fk || k.startsWith(fk + path.sep)) && (!best || fk.length > key(best).length)) {
      best = folder.uri.fsPath;
    }
  }
  return best;
}

function gitExecutable() {
  const configured = vscode.workspace.getConfiguration('git').get('path');
  const first = Array.isArray(configured) ? configured[0] : configured;
  return typeof first === 'string' && first ? first : 'git';
}

/**
 * Ask git which of `relPaths` (relative to `cwd`) it ignores, in one
 * `git check-ignore --stdin -z` call. Like git, it never reports a tracked file: a
 * file committed despite an ignore rule is part of the project. Resolves to null
 * when git cannot answer -- not installed, not a repository, or too slow.
 */
function gitCheckIgnore(cwd, relPaths) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      child = spawn(gitExecutable(), ['check-ignore', '--stdin', '-z'], { cwd, windowsHide: true });
    } catch (_) {
      done(null);
      return;
    }
    const out = [];
    timer = setTimeout(() => {
      child.kill();
      done(null);
    }, GIT_TIMEOUT_MS);
    child.on('error', () => done(null));
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {}); // git can exit before reading everything, e.g. outside a repo
    child.on('close', (code) => {
      // 0: some paths are ignored, 1: none are, anything else: git could not answer
      if (code !== 0 && code !== 1) return done(null);
      done(Buffer.concat(out).toString('utf8').split('\0').filter(Boolean));
    });
    child.stdin.end(relPaths.join('\0') + '\0');
  });
}

class IgnoreRules {
  constructor(buildDirs) {
    this.buildDirs = buildDirs; // directories holding a CMakeCache.txt / .qmake.stash
    this.gitIgnored = new Set(); // key(path) of every path git reported as ignored
    this.gitUnavailable = new Set(); // workspace folders git could not answer for
  }

  static async load() {
    return new IgnoreRules(await findBuildDirectories());
  }

  /**
   * True for a path inside a build tree, found by folder name or by marker file.
   * Names are only judged inside the workspace folder, so a workspace that itself
   * lives under some D:\build\ directory is not mistaken for build output.
   */
  inBuildTree(p) {
    if (isInside(p, this.buildDirs)) return true;
    const folder = workspaceFolderOf(p);
    if (!folder) return false;
    const dirs = path.relative(folder, p).split(/[\\/]/).slice(0, -1);
    return dirs.some((name) => BUILD_DIR_NAME.test(name));
  }

  /** True for a path in a build tree, or one git reported as ignored in classify(). */
  isIgnored(p) {
    return this.inBuildTree(p) || this.gitIgnored.has(key(p));
  }

  /**
   * Work out which of `paths` are ignored, asking git once per workspace folder, and
   * remember the answer for isIgnored(). Returns how many each layer took out.
   */
  async classify(paths) {
    const outsideBuild = paths.filter((p) => !this.inBuildTree(p));
    const counts = { build: paths.length - outsideBuild.length, git: 0 };
    if (!vscode.workspace.getConfiguration('qtWorkbench').get('useGitignore', true)) return counts;

    const byFolder = new Map();
    for (const p of outsideBuild) {
      const folder = workspaceFolderOf(p);
      if (!folder) continue;
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push(p);
    }
    for (const [folder, list] of byFolder) {
      const ignored = await gitCheckIgnore(folder, list.map((p) => toPosix(path.relative(folder, p))));
      if (ignored === null) {
        this.gitUnavailable.add(folder);
        continue;
      }
      for (const rel of ignored) this.gitIgnored.add(key(path.resolve(folder, rel)));
    }
    counts.git = outsideBuild.filter((p) => this.gitIgnored.has(key(p))).length;
    return counts;
  }
}

module.exports = { IgnoreRules, excludeGlob, workspaceFolderOf };
