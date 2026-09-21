'use strict';

/**
 * The Qt Project Explorer's tree: which CMakeLists.txt and .pro files are projects of
 * their own, and the nodes shown for them -- files nested in folders relative to their
 * target or project, as Qt Creator nests them, and a .qrc file's prefixes and files below it.
 *
 * A node is a plain object:
 *
 *   {id, kind, label, description, tooltip, path, icon, contextValue, expanded, missing, parent, children}
 *
 * `kind` is project, directory (a CMake subdirectory), include (a file a .pro includes),
 * target, group (a source group, or another list that is no folder), folder, file, vcpkg
 * (a CMake project's vcpkg packages) or package (one of them).
 * `path` is the file or folder the node stands for; a project, target or group stands for
 * its directory, and vcpkg nodes for their project's. `icon` names a codicon; without one,
 * folders and files get the file icon theme's.
 */

const path = require('path');
const { parseQrc } = require('../hot-reload/resource-tree');
const { key, toPosix } = require('../paths');
const { readCMakeProject } = require('./cmake');
const { readQmakeProject } = require('./qmake');
const { readVcpkgPackages } = require('./vcpkg');

const TARGET_ICONS = { executable: 'tools', library: 'library', plugin: 'plug', custom: 'gear' };

function depth(p) {
  return p.split(/[\\/]/).length;
}

function byName(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Read the projects among `candidates` ({cmake: [CMakeLists.txt], qmake: [.pro]}), each
 * build file once: a CMakeLists.txt that another one adds with add_subdirectory() belongs
 * to that project, and so does a .pro another one names in SUBDIRS. A CMakeLists.txt is a
 * project of its own when it calls project() or sits at the root of a workspace folder;
 * a .pro next to a CMakeLists.txt already shown is the same project built another way.
 */
async function readProjects(candidates, folders, io) {
  const order = (a, b) => depth(a) - depth(b) || byName(a, b);
  const projects = [];
  const read = new Set();
  const cmakeDirs = new Set();

  for (const file of [...candidates.cmake].sort(order)) {
    if (read.has(key(file))) continue;
    const atRoot = folders.some((folder) => key(folder) === key(path.dirname(file)));
    if (!atRoot && !/^[ \t]*project[ \t]*\(/im.test((await io.readFile(file)) || '')) continue;
    const project = await readCMakeProject(file, io);
    if (!project) continue;
    for (const list of project.lists) {
      read.add(key(list));
      cmakeDirs.add(key(path.dirname(list)));
    }
    projects.push(project);
  }
  for (const file of [...candidates.qmake].sort(order)) {
    if (read.has(key(file)) || cmakeDirs.has(key(path.dirname(file)))) continue;
    const project = await readQmakeProject(file, io);
    if (!project) continue;
    for (const list of project.lists) read.add(key(list));
    projects.push(project);
  }
  return projects;
}

/** Every file a project's nodes show: build files, target sources, modules and presets. */
function projectFiles(project, out = []) {
  out.push(project.file);
  if (project.targets) {
    // a CMake project or one of its directories
    for (const target of project.targets) out.push(...target.files.map((f) => f.path));
    for (const sub of project.subdirectories) projectFiles(sub, out);
    out.push(...(project.modules || []), ...(project.presets || []));
  } else {
    for (const group of project.groups) out.push(...group.files);
    for (const child of project.includes.concat(project.subprojects)) projectFiles(child, out);
  }
  return out;
}

class TreeBuilder {
  constructor(status, qrcs, branches, vcpkg) {
    this.status = status; // key -> 'file', 'directory', 'ignored' or null (not found)
    this.qrcs = qrcs; // key of a .qrc -> its entries
    this.branches = branches; // key of a project directory -> git branch
    this.vcpkg = vcpkg; // key of a CMake project directory -> its vcpkg packages, or null
    this.ids = new Set();
  }

  shown(p) {
    return this.status.get(key(p)) !== 'ignored';
  }

  add(parent, kind, label, fields) {
    let id = (parent ? parent.id + '/' : '') + kind + ':' + (parent ? label : key(fields.path));
    for (let n = 2; this.ids.has(id); n++) id = id.replace(/#\d+$/, '') + '#' + n;
    this.ids.add(id);
    const node = { id, kind, label, parent, children: [], ...fields };
    if (parent) parent.children.push(node);
    return node;
  }

  file(parent, p, options = {}) {
    const status = this.status.get(key(p));
    const missing = status !== 'file' && status !== 'directory';
    const node = this.add(parent, status === 'directory' ? 'folder' : 'file', path.basename(p), {
      path: p,
      tooltip: toPosix(p),
      contextValue: missing ? 'qtMissingFile' : status === 'directory' ? 'qtFolder' : 'qtFile',
      description: options.describe ? options.describe(p) : undefined
    });
    if (missing) {
      node.missing = true;
      node.icon = 'warning';
      node.description = 'not found';
      node.tooltip = toPosix(p) + '\nListed in the project, but not found on disk.';
    }
    const entries = options.inQrc ? null : this.qrcs.get(key(p));
    if (entries && !missing) this.qrcEntries(node, entries, p);
    return node;
  }

  /** `files` under `parent`, nested in folders by their path relative to `base`. */
  files(parent, files, base, options) {
    const root = { folders: new Map(), files: [] };
    for (const p of files) {
      let at = root;
      let dir = base;
      for (const segment of folderSegments(base, path.dirname(p))) {
        dir = path.resolve(dir, segment);
        if (!at.folders.has(key(dir))) at.folders.set(key(dir), { name: segment, dir, folders: new Map(), files: [] });
        at = at.folders.get(key(dir));
      }
      at.files.push(p);
    }
    this.folder(parent, root, options);
  }

  folder(parent, folder, options) {
    const subfolders = [...folder.folders.values()].map(compress).sort((a, b) => byName(a.name, b.name));
    for (const sub of subfolders) {
      const node = this.add(parent, 'folder', sub.name, { path: sub.dir, tooltip: toPosix(sub.dir), contextValue: 'qtFolder' });
      this.folder(node, sub, options);
    }
    for (const p of folder.files.sort((a, b) => byName(path.basename(a), path.basename(b)))) this.file(parent, p, options);
  }

  /** A virtual folder of `files`, such as a source group or CMake Modules. */
  group(parent, label, files, base, options) {
    const node = this.add(parent, 'group', label, { path: base, contextValue: 'qtGroup' });
    this.files(node, files, base, options);
    return node;
  }

  /** The prefixes of a .qrc file and the files under each. */
  qrcEntries(node, entries, qrcFile) {
    const base = path.dirname(qrcFile);
    const byPrefix = new Map();
    const aliases = new Map();
    for (const entry of entries) {
      if (!this.shown(entry.file)) continue;
      if (!byPrefix.has(entry.prefix)) byPrefix.set(entry.prefix, []);
      byPrefix.get(entry.prefix).push(entry.file);
      if (entry.alias) aliases.set(key(entry.file), entry.alias);
    }
    const options = { inQrc: true, describe: (p) => aliases.get(key(p)) };
    for (const [prefix, files] of byPrefix) this.group(node, prefix, files, base, options);
  }

  cmake(directory, parent) {
    const top = !parent;
    const label = top ? directory.name || path.basename(directory.dir) : toPosix(path.relative(parent.path, directory.dir));
    const branch = top ? this.branches.get(key(directory.dir)) : null;
    const node = this.add(parent, top ? 'project' : 'directory', label, {
      path: directory.dir,
      icon: top ? 'project' : undefined,
      tooltip: toPosix(directory.file),
      contextValue: top ? 'qtCMakeProject' : 'qtProject',
      description: top ? (branch ? '[' + branch + ']' : undefined) : directory.name && directory.name !== label ? directory.name : undefined,
      expanded: top
    });
    this.file(node, directory.file);

    const targets = directory.targets.filter((t) => t.files.some((f) => this.shown(f.path)));
    for (const target of targets.sort((a, b) => byName(a.name, b.name))) {
      this.target(node, target, top && targets.length === 1 && directory.subdirectories.length === 0);
    }
    const subdirectories = directory.subdirectories.map((sub) => ({ sub, rel: toPosix(path.relative(directory.dir, sub.dir)) }));
    for (const { sub } of subdirectories.sort((a, b) => byName(a.rel, b.rel))) this.cmake(sub, node);

    if (top) {
      const vcpkg = this.vcpkg.get(key(directory.dir));
      if (vcpkg) this.vcpkgPackages(node, vcpkg, directory.dir);
      const presets = directory.presets.filter((p) => this.shown(p));
      if (presets.length > 0) this.group(node, 'CMake Presets', presets, directory.dir);
      const modules = directory.modules.filter((p) => this.shown(p));
      if (modules.length > 0) this.group(node, 'CMake Modules', modules, directory.dir);
    }
    return node;
  }

  /** vcpkg Packages: the dependencies in vcpkg.json as installed (project-tree/vcpkg.js), each with the packages it depends on. */
  vcpkgPackages(parent, vcpkg, dir) {
    const rel = (p) => toPosix(path.relative(dir, p)) || '.';
    const where = vcpkg.roots.map((root) => rel(root.dir) + (root.presets.length > 0 ? ' (' + root.presets.join(', ') + ')' : '')).join(', ');
    const node = this.add(parent, 'vcpkg', 'vcpkg Packages', {
      path: dir,
      icon: 'package',
      contextValue: 'qtVcpkgPackages',
      description: vcpkg.error ? 'vcpkg.json cannot be read' : undefined,
      tooltip: vcpkg.error
        ? toPosix(vcpkg.manifest) + ' cannot be read: ' + vcpkg.error
        : 'The dependencies in vcpkg.json' + (where ? ', as vcpkg installed them in ' + where : '. None is installed yet.')
    });
    const add = (at, pkg) => {
      const tooltip = pkg.installed
        ? [pkg.description, pkg.name + ':' + pkg.triplet + '@' + pkg.version + ' in ' + rel(pkg.root)]
        : ['In vcpkg.json, and not installed' + (where ? ' in ' + where : ' yet')];
      if (pkg.features.length > 0) tooltip.push('Features: ' + pkg.features.join(', '));
      const child = this.add(at, 'package', pkg.name, {
        path: dir,
        icon: 'package',
        // A dependency in vcpkg.json can be removed; a package it needs in turn cannot.
        contextValue: at === node ? 'qtVcpkgPackage' : 'qtVcpkgDependency',
        description: pkg.installed ? pkg.version + (pkg.host ? ' · host' : '') : 'not installed',
        tooltip: tooltip.filter(Boolean).join('\n'),
        missing: !pkg.installed
      });
      for (const dependency of pkg.dependencies) add(child, dependency);
    };
    for (const pkg of vcpkg.packages.slice().sort((a, b) => byName(a.name, b.name))) add(node, pkg);
    return node;
  }

  target(parent, target, expanded) {
    const node = this.add(parent, 'target', target.name, {
      path: target.dir,
      icon: TARGET_ICONS[target.type],
      tooltip: target.type === 'custom' ? 'custom target ' + target.name : target.type + ' ' + target.name,
      contextValue: 'qtTarget',
      expanded
    });
    // Source groups nest at "/": Source Files/Generated is Generated inside Source Files.
    const root = { groups: new Map(), files: [] };
    for (const file of target.files.filter((f) => this.shown(f.path))) {
      let at = root;
      for (const level of file.group.split('/').filter(Boolean)) {
        if (!at.groups.has(level)) at.groups.set(level, { groups: new Map(), files: [] });
        at = at.groups.get(level);
      }
      at.files.push(file.path);
    }
    this.sourceGroup(node, root, target.dir);
    return node;
  }

  sourceGroup(node, group, base) {
    for (const name of [...group.groups.keys()].sort(byName)) {
      const child = this.add(node, 'group', name, { path: base, contextValue: 'qtGroup' });
      this.sourceGroup(child, group.groups.get(name), base);
    }
    this.files(node, group.files, base);
  }

  qmake(project, parent, kind) {
    const branch = parent ? null : this.branches.get(key(project.dir));
    const node = this.add(parent, kind, project.name, {
      path: project.dir,
      icon: kind === 'include' ? 'file-submodule' : 'project',
      tooltip: toPosix(project.file),
      contextValue: 'qtProject',
      description: branch ? '[' + branch + ']' : undefined,
      expanded: !parent
    });
    this.file(node, project.file);
    for (const include of project.includes) this.qmake(include, node, 'include');
    for (const sub of project.subprojects) this.qmake(sub, node, 'project');
    for (const group of project.groups) {
      const files = group.files.filter((p) => this.shown(p));
      if (files.length > 0) this.group(node, group.name, files, project.dir);
    }
    return node;
  }
}

/**
 * The folders between `base` and `dir`, as node labels. A folder outside `base` is one
 * node named by its relative path, such as ../shared.
 */
function folderSegments(base, dir) {
  const rel = path.relative(base, dir);
  if (rel === '') return [];
  if (path.isAbsolute(rel)) return [toPosix(dir)]; // on another drive
  const parts = rel.split(path.sep);
  const inside = parts.findIndex((part) => part !== '..');
  if (inside === 0) return parts;
  if (inside === -1) return [parts.join('/')];
  return [parts.slice(0, inside + 1).join('/'), ...parts.slice(inside + 1)];
}

/** A folder holding nothing but one folder shows as one node: src/app. */
function compress(folder) {
  let out = folder;
  while (out.files.length === 0 && out.folders.size === 1) {
    const only = [...out.folders.values()][0];
    out = { ...only, name: out.name + '/' + only.name };
  }
  return out;
}

/**
 * Read the projects and build their nodes. Besides the calls readCMakeProject takes, `io`
 * has classify(paths), which works out which paths are ignored, isIgnored(p) after it,
 * branch(dir), the git branch a project directory is on, or null, and
 * readVcpkgInstalled(p), which reads vcpkg's install database wherever it is.
 */
async function loadTree(candidates, folders, io) {
  const projects = await readProjects(candidates, folders, io);
  const paths = new Map();
  for (const project of projects) for (const p of projectFiles(project)) paths.set(key(p), p);
  await io.classify([...paths.values()]);

  const qrcs = new Map();
  const entryPaths = new Map();
  for (const p of paths.values()) {
    if (!/\.qrc$/i.test(p) || io.isIgnored(p)) continue;
    const text = await io.readFile(p);
    if (text === null) continue;
    const entries = parseQrc(text, p);
    qrcs.set(key(p), entries);
    for (const entry of entries) if (!paths.has(key(entry.file))) entryPaths.set(key(entry.file), entry.file);
  }
  if (entryPaths.size > 0) await io.classify([...entryPaths.values()]);

  const status = new Map();
  await Promise.all(
    [...paths, ...entryPaths].map(async ([k, p]) => status.set(k, io.isIgnored(p) ? 'ignored' : await io.stat(p)))
  );
  const branches = new Map();
  for (const project of projects) branches.set(key(project.dir), await io.branch(project.dir));
  const vcpkg = new Map();
  for (const project of projects.filter((p) => p.kind === 'cmake')) {
    const presets = project.presets.filter((p) => status.get(key(p)) !== 'ignored');
    vcpkg.set(key(project.dir), await readVcpkgPackages(project, presets, io));
  }

  const builder = new TreeBuilder(status, qrcs, branches, vcpkg);
  return projects.map((project) => (project.kind === 'cmake' ? builder.cmake(project, null) : builder.qmake(project, null, 'project')));
}

module.exports = { loadTree };
