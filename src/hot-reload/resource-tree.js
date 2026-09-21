'use strict';

/**
 * The resources compiled into a Qt application, read back from the .qrc files rcc was
 * given: which file on disk is behind ":/qt/qml/Test/Main.qml", what a resource
 * directory lists, and which resource paths a source file was compiled into.
 *
 * For qt_add_qml_module these are the generated .qrc files under the build tree's
 * .qt/rcc (older Qt: .rcc), whose <file> entries point back at the source files. The
 * *_qml_module_dir_map.qrc next to the module's build output is left out: it maps the
 * module to the copies in the build tree, for tooling, and is not compiled in.
 */

const fs = require('fs');
const path = require('path');
const { key } = require('../paths');

const SKIP_DIR = /^(?:CMakeFiles|vcpkg_installed|_deps|\.cmake|Testing|node_modules|\.git|.+_autogen)$/i;
const TOOLING_QRC = /_qml_module_dir_map\.qrc$/i;
const MAX_DEPTH = 8;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] || whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function attribute(attrs, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs);
  return m ? decodeXml(m[1] !== undefined ? m[1] : m[2]) : null;
}

/** ":/a//b/", "qrc:///a/b" and "/a/b" all name the resource "/a/b". */
function resourcePath(p) {
  const s = p.replace(/^qrc:/i, '').replace(/^:/, '');
  return path.posix.normalize('/' + s.split('/').filter(Boolean).join('/'));
}

function isResourcePath(p) {
  return p.startsWith(':') || /^qrc:/i.test(p);
}

/**
 * The <file> entries of a .qrc as {resource, file, prefix, alias}. Like rcc: the alias,
 * or else the path as written, cleaned and without leading "../", goes under the
 * <qresource> prefix. `alias` is null for an entry without one.
 */
function parseQrc(text, qrcFile) {
  const dir = path.dirname(qrcFile);
  const entries = [];
  const blockRe = /<qresource\b([^>]*)>([\s\S]*?)<\/qresource>/g;
  let block;
  while ((block = blockRe.exec(text))) {
    const prefix = attribute(block[1], 'prefix') || '/';
    const fileRe = /<file\b([^>]*)>([^<]*)<\/file>/g;
    let entry;
    while ((entry = fileRe.exec(block[2]))) {
      const written = decodeXml(entry[2].trim());
      if (!written) continue;
      const alias = attribute(entry[1], 'alias');
      let name = path.posix.normalize(alias || written.replace(/\\/g, '/'));
      while (name.startsWith('../')) name = name.slice(3);
      entries.push({ resource: resourcePath(prefix + '/' + name), file: path.resolve(dir, written), prefix, alias });
    }
  }
  return entries;
}

class ResourceTree {
  constructor() {
    this.files = new Map(); // resource path -> file on disk
    this.dirs = new Map(); // resource directory -> Set of entry names
    this.bySource = new Map(); // key(file) -> Set of resource paths
    this.qrcFiles = [];
  }

  get size() {
    return this.files.size;
  }

  /** The first file listed under a resource path wins, as the first registered resource does in Qt. */
  add(resource, file) {
    if (this.files.has(resource)) return;
    this.files.set(resource, file);
    const k = key(file);
    if (!this.bySource.has(k)) this.bySource.set(k, new Set());
    this.bySource.get(k).add(resource);
    for (let child = resource; child !== '/'; child = path.posix.dirname(child)) {
      const parent = path.posix.dirname(child);
      if (!this.dirs.has(parent)) this.dirs.set(parent, new Set());
      this.dirs.get(parent).add(path.posix.basename(child));
    }
  }

  /** Add a .qrc's entries. A <file> naming a directory brings in everything below it, as in rcc. */
  addQrc(qrcFile) {
    let text;
    try {
      text = fs.readFileSync(qrcFile, 'utf8');
    } catch (_) {
      return;
    }
    this.qrcFiles.push(qrcFile);
    for (const { resource, file } of parseQrc(text, qrcFile)) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (_) {
        continue;
      }
      if (stat.isDirectory()) this.addDirectory(resource, file, 0);
      else this.add(resource, file);
    }
  }

  addDirectory(resource, dir, depth) {
    if (depth > MAX_DEPTH) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) this.addDirectory(resource + '/' + entry.name, child, depth + 1);
      else this.add(resource + '/' + entry.name, child);
    }
  }

  /** What the application finds at a ":/..." path: {kind: 'file', file}, {kind: 'directory', entries} or null. */
  lookup(requestPath) {
    const resource = resourcePath(requestPath);
    const file = this.files.get(resource);
    if (file) return { kind: 'file', file };
    const dir = this.dirs.get(resource);
    if (dir) return { kind: 'directory', entries: [...dir].sort() };
    return null;
  }

  /** The resource paths a file on disk was compiled into. */
  resourcesOf(file) {
    return [...(this.bySource.get(key(file)) || [])];
  }

  resources() {
    return [...this.files.keys()];
  }
}

/** Every .qrc rcc compiled in a build tree, generated ones included. */
function findBuildQrcFiles(buildDir) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIR.test(entry.name)) walk(path.join(dir, entry.name), depth + 1);
      } else if (/\.qrc$/i.test(entry.name) && !TOOLING_QRC.test(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  walk(buildDir, 0);
  // Generated rcc inputs first: they are the ones pointing at the sources.
  const rank = (f) => (/[\\/]\.(?:qt[\\/]rcc|rcc)[\\/]/i.test(f) ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

module.exports = { ResourceTree, parseQrc, resourcePath, isResourcePath, findBuildQrcFiles };
