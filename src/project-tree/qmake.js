'use strict';

/**
 * A qmake project the way Qt Creator's project tree shows it: the files of a .pro and of
 * each file it include()s, by kind -- Headers, Sources, Forms, State charts, Resources,
 * QML, Other files -- and the projects its SUBDIRS name. Assignments in every scope count,
 * as in Qt Creator. A value built from a variable that is not known is left out.
 */

const path = require('path');
const { qmakeAssignments } = require('../qmake-syntax');
const { key, toPosix } = require('../paths');

/** The groups, in the order Qt Creator shows them. */
const GROUPS = ['Headers', 'Sources', 'Forms', 'State charts', 'Resources', 'QML', 'Other files'];

/** The group of each variable listing files; null: QML for .qml files, Other files for the rest. */
const FILE_VARIABLES = new Map([
  ['HEADERS', 'Headers'],
  ['OBJECTIVE_HEADERS', 'Headers'],
  ['PRECOMPILED_HEADER', 'Headers'],
  ['SOURCES', 'Sources'],
  ['OBJECTIVE_SOURCES', 'Sources'],
  ['LEXSOURCES', 'Sources'],
  ['YACCSOURCES', 'Sources'],
  ['FORMS', 'Forms'],
  ['STATECHARTS', 'State charts'],
  ['RESOURCES', 'Resources'],
  ['DISTFILES', null],
  ['OTHER_FILES', null],
  ['TRANSLATIONS', 'Other files'],
  ['ICON', 'Other files'],
  ['QMAKE_INFO_PLIST', 'Other files']
]);

const MAX_INCLUDE_DEPTH = 16;

/** Lines without their comments, so a commented-out include() is not read. */
function withoutComments(text) {
  return text.replace(/#[^\n]*/g, (comment) => ' '.repeat(comment.length));
}

/** The include() calls of a file: [{start, argument}]. */
function includeCalls(text) {
  const out = [];
  const re = /\binclude\s*\(\s*("[^"\n]*"|[^\s,)]+)/g;
  let m;
  while ((m = re.exec(withoutComments(text))) !== null) {
    out.push({ start: m.index, argument: m[1].replace(/^"|"$/g, '') });
  }
  return out;
}

/** qmake's values joined back where a $$function(...) call was split at its spaces. */
function joinCalls(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && /\$\$\{?\w+\(/.test(last) && (last.match(/\(/g) || []).length > (last.match(/\)/g) || []).length) {
      out[out.length - 1] = last + ' ' + item;
    } else {
      out.push(item);
    }
  }
  return out;
}

class Evaluator {
  constructor(io) {
    this.io = io;
    this.lists = new Map(); // key -> project file read
    this.nodes = []; // the nodes of the project being read, which a -= takes files out of
  }

  /**
   * `value` with its variables replaced: a list of values, or null when it uses a
   * variable, property or function this does not know.
   */
  async expand(value, vars, pwd) {
    const files = /^\$\$files\(\s*("[^"]*"|[^,)\s]+)\s*(?:,\s*(true|false)\s*)?\)$/.exec(value);
    if (files) {
      const pattern = await this.expand(files[1].replace(/^"|"$/g, ''), vars, pwd);
      return pattern && pattern.length === 1 ? this.glob(path.resolve(pwd, pattern[0]), files[2] === 'true') : null;
    }

    let unknown = false;
    let list = null;
    const out = value.replace(/\$\$(?:\{(\w+)\}|(\w+))(?!\s*\()/g, (whole, braced, plain) => {
      const name = braced || plain;
      const values = name === 'PWD' || name === 'IN_PWD' ? [toPosix(pwd)] : vars.get(name);
      if (!values) {
        unknown = true;
        return '';
      }
      if (whole === value) list = values; // a whole value naming a list: all its items
      return values.join(' ');
    });
    if (unknown || /\$\$/.test(out)) return null;
    return list || [out];
  }

  /** The files a $$files() glob matches, recursively when asked. */
  async glob(pattern, recursive) {
    const dir = path.dirname(pattern);
    const name = new RegExp(
      '^' + path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      process.platform === 'win32' ? 'i' : ''
    );
    const out = [];
    const visit = async (d, depth) => {
      if (this.io.skipDirectory(d)) return;
      for (const [entry, isDirectory] of (await this.io.readDirectory(d)) || []) {
        if (!isDirectory) {
          if (name.test(entry)) out.push(path.join(d, entry));
        } else if (recursive && depth < MAX_INCLUDE_DEPTH) {
          await visit(path.join(d, entry), depth + 1);
        }
      }
    };
    await visit(dir, 0);
    return out.sort();
  }

  /** Read a .pro, or a file it includes, into `node`, with the variables of the project so far. False when it can't be read. */
  async file(node, vars, chain) {
    const text = await this.io.readFile(node.file);
    if (text === null) return false;
    this.lists.set(key(node.file), node.file);
    const pwd = path.dirname(node.file);
    const inner = [...chain, key(node.file)];

    const statements = [
      ...qmakeAssignments(text).map((a) => ({ start: a.start, assignment: a })),
      ...includeCalls(text).map((c) => ({ start: c.start, include: c.argument }))
    ].sort((a, b) => a.start - b.start);

    for (const statement of statements) {
      if (statement.include !== undefined) {
        await this.include(node, statement.include, vars, pwd, inner);
        continue;
      }
      const { variable, operator, items } = statement.assignment;
      const values = [];
      for (const item of joinCalls(items.map((i) => i.text))) {
        values.push(...((await this.expand(item, vars, pwd)) || []));
      }
      this.assign(node, variable, operator, values, vars, pwd);
    }
    return true;
  }

  assign(node, variable, operator, values, vars, pwd) {
    const current = vars.get(variable) || [];
    if (operator === '=') vars.set(variable, values);
    else if (operator === '+=') vars.set(variable, current.concat(values));
    else if (operator === '*=') vars.set(variable, [...new Set(current.concat(values))]);
    else if (operator === '-=') vars.set(variable, current.filter((v) => !values.includes(v)));
    else vars.delete(variable); // ~= is a regular expression replacement: the values are unknown now

    if (variable === 'SUBDIRS' && operator !== '-=') {
      for (const value of values) node.subdirs.push({ name: value, pwd });
    }
    if (!FILE_VARIABLES.has(variable)) return;
    const paths = values.map((v) => path.resolve(pwd, v));
    if (operator === '-=') {
      const removed = new Set(paths.map(key));
      for (const n of this.nodes) for (const [group, files] of n.groups) n.groups.set(group, files.filter((p) => !removed.has(key(p))));
      return;
    }
    // Qt Creator's cumulative reading: an = in some scope adds to what other scopes listed.
    for (const p of paths) {
      const group = FILE_VARIABLES.get(variable) || (/\.qml$/i.test(p) ? 'QML' : 'Other files');
      if (!node.groups.has(group)) node.groups.set(group, []);
      const files = node.groups.get(group);
      if (!files.some((f) => key(f) === key(p))) files.push(p);
    }
  }

  async include(node, argument, vars, pwd, chain) {
    const expanded = await this.expand(argument, vars, pwd);
    if (!expanded || expanded.length !== 1 || chain.length > MAX_INCLUDE_DEPTH) return;
    const file = path.resolve(pwd, expanded[0]);
    if (chain.includes(key(file)) || this.io.skipDirectory(path.dirname(file)) || (await this.io.stat(file)) !== 'file') return;
    const child = this.node(file);
    if (await this.file(child, vars, chain)) node.includes.push(child);
  }

  node(file) {
    const node = {
      kind: 'qmake',
      file,
      dir: path.dirname(file),
      name: path.basename(file, path.extname(file)),
      groups: new Map(),
      includes: [],
      subprojects: [],
      subdirs: []
    };
    this.nodes.push(node);
    return node;
  }

  /** A .pro and everything it includes, then the projects its SUBDIRS name. Null when it can't be read. */
  async project(file, chain) {
    const saved = this.nodes;
    this.nodes = [];
    const node = this.node(file);
    const vars = new Map([
      ['_PRO_FILE_', [toPosix(file)]],
      ['_PRO_FILE_PWD_', [toPosix(path.dirname(file))]],
      ['TARGET', [node.name]]
    ]);
    const read = await this.file(node, vars, chain);
    const subdirs = this.nodes.flatMap((n) => n.subdirs);
    for (const n of this.nodes) finishGroups(n);
    this.nodes = saved;
    if (!read) return null;

    for (const { name, pwd } of subdirs) {
      const sub = await this.subproject(name, vars, pwd);
      if (!sub || this.lists.has(key(sub)) || chain.includes(key(sub))) continue;
      const project = await this.project(sub, [...chain, key(file)]);
      if (project) node.subprojects.push(project);
    }
    return node;
  }

  /** The .pro a SUBDIRS entry names: name.file, name.subdir, a .pro path, or the folder's own .pro. */
  async subproject(name, vars, pwd) {
    const file = (vars.get(name + '.file') || [])[0];
    if (file) return path.resolve(pwd, file);
    const dir = path.resolve(pwd, (vars.get(name + '.subdir') || [name])[0]);
    if (/\.pro$/i.test(dir)) return (await this.io.stat(dir)) === 'file' ? dir : null;
    if (this.io.skipDirectory(dir)) return null;
    const own = path.join(dir, path.basename(dir) + '.pro');
    if ((await this.io.stat(own)) === 'file') return own;
    const pros = ((await this.io.readDirectory(dir)) || []).filter(([n, isDirectory]) => !isDirectory && /\.pro$/i.test(n));
    return pros.length === 1 ? path.join(dir, pros[0][0]) : null;
  }
}

/** Groups in Qt Creator's order, without empty ones: [{name, files}]. */
function finishGroups(node) {
  node.groups = GROUPS.filter((g) => node.groups.has(g) && node.groups.get(g).length > 0).map((g) => ({
    name: g,
    files: node.groups.get(g)
  }));
  delete node.subdirs;
}

/**
 * Read the qmake project `file` (.pro):
 *
 *   {kind: 'qmake', file, dir, name, groups, includes, subprojects, lists}
 *
 * `groups` are [{name, files}] in Qt Creator's order. `includes` are the files it
 * include()s, each of the same shape listing the files assigned in it, and `subprojects`
 * the projects of its SUBDIRS. `lists` holds every project file read. `io` is as for
 * readCMakeProject. Null when `file` can't be read.
 */
async function readQmakeProject(file, io) {
  const evaluator = new Evaluator(io);
  const project = await evaluator.project(file, []);
  if (project) project.lists = [...evaluator.lists.values()];
  return project;
}

module.exports = { readQmakeProject };
