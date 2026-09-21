'use strict';

/**
 * A CMake project the way Qt Creator's project tree shows it, read from the CMakeLists.txt
 * files rather than from a configured build: the targets of each directory with their
 * files in CMake's source groups, the directories add_subdirectory() adds, and the other
 * files CMake reads -- included modules, configure_file() inputs, vcpkg.json.
 *
 * Only as much CMake is evaluated as file lists need: variables, list(), file(GLOB),
 * include() and add_subdirectory(). Every branch of an if() counts, a foreach() body is
 * read once, and functions and macros are not called. A value that depends on a variable
 * that is not known, or on a generator expression, is left out rather than guessed at.
 */

const path = require('path');
const { cmakeCommands } = require('../cmake-syntax');
const { key, toPosix } = require('../paths');

// CMake's default source groups, in the order cmMakefile creates them. A file goes to the
// first group that lists it, else to the last one whose expression matches its path.
const DEFAULT_GROUPS = [
  ['', /^.*$/],
  ['Source Files', /\.(C|F|D|c|c\+\+|cc|cpp|mpp|cxx|ixx|cppm|ccm|cxxm|c\+\+m|cu|f|f90|for|fpp|ftn|m|mm|rc|def|r|odl|idl|hpj|bat)$/],
  ['Header Files', /\.(h|hh|h\+\+|hm|hpp|hxx|in|txx|inl)$/],
  ['Precompile Header File', /cmake_pch(_[^.]+)?\.(h|hxx)$/],
  ['CMake Rules', /\.rule$/],
  ['Resources', /\.(pdf|plist|png|jpeg|jpg|storyboard|xcassets|zip)$/],
  ['Object Files', /\.(lo|o|obj)$/]
];

/** Arguments of add_executable, add_library and their qt_ forms that are not sources. */
const TARGET_FLAGS = new Set([
  'WIN32',
  'MACOSX_BUNDLE',
  'EXCLUDE_FROM_ALL',
  'MANUAL_FINALIZATION',
  'STATIC',
  'SHARED',
  'MODULE',
  'OBJECT',
  'INTERFACE'
]);
const TARGET_OPTIONS = new Set(['PLUGIN_TYPE', 'CLASS_NAME', 'OUTPUT_TARGETS']); // each takes one value

const MAX_INCLUDE_DEPTH = 32;
const MAX_GLOB_DEPTH = 16;

/** `text` with its ${VAR} references replaced; null when it needs a variable not set, $ENV{} or a generator expression. */
function expandText(text, vars) {
  let out = text;
  for (let i = 0; i < 16 && out.includes('${'); i++) {
    let unknown = false;
    out = out.replace(/\$\{([^${}]*)\}/g, (_, name) => {
      if (vars.has(name)) return vars.get(name);
      unknown = true;
      return '';
    });
    if (unknown) return null;
  }
  return /\$(?:\{|<|ENV\{|CACHE\{)/.test(out) ? null : out;
}

/** A command's arguments with variables expanded, an unquoted one split into its list items; null for one that can't be. */
function expandArgs(args, vars) {
  const out = [];
  for (const arg of args) {
    const text = expandText(arg.text, vars);
    if (text === null) out.push(null);
    else if (arg.quoted) out.push(text);
    else out.push(...text.split(';').filter((item) => item !== ''));
  }
  return out;
}

function isKeyword(value) {
  return value !== null && /^[A-Z][A-Z0-9_]*$/.test(value);
}

/** The values following each of the `wanted` keywords, until the next keyword: Map keyword -> [value]. */
function sections(args, wanted) {
  const out = new Map();
  let current = null;
  for (const value of args) {
    if (isKeyword(value)) {
      current = value;
    } else if (wanted.has(current)) {
      if (!out.has(current)) out.set(current, []);
      out.get(current).push(value);
    }
  }
  return out;
}

function listOf(vars, name) {
  const value = vars.get(name);
  return value ? value.split(';').filter(Boolean) : [];
}

/** A CMake regular expression as a JavaScript one, or null when it isn't one. */
function cmakeRegex(source) {
  try {
    return source === null || source === undefined ? null : new RegExp(source);
  } catch (_) {
    return null;
  }
}

/** One path segment of a glob: *, ? and [...], case-insensitive where the file system is. */
function segmentRegex(segment) {
  const body = segment
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c === '[' || c === ']' ? c : c.replace(/[.+^${}()|\\]/g, '\\$&')))
    .join('');
  try {
    return new RegExp('^' + body + '$', process.platform === 'win32' ? 'i' : '');
  } catch (_) {
    return null;
  }
}

const hasWildcard = (segment) => /[*?[]/.test(segment);

/** The group a file of a target goes to, by CMake's rules. */
function groupOf(groups, filePath) {
  const k = key(filePath);
  const listed = groups.find((g) => g.files.has(k));
  if (listed) return listed.name;
  const full = toPosix(filePath);
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].regex && groups[i].regex.test(full)) return groups[i].name;
  }
  return '';
}

class Evaluator {
  constructor(io) {
    this.io = io;
    this.lists = new Map(); // key -> CMakeLists.txt read
    this.modules = new Map(); // key -> other file CMake reads
    this.targets = new Map(); // name -> target
  }

  /**
   * The directory `dir` as add_subdirectory() enters it, from `parent`'s scope (none for the
   * top); null when its CMakeLists.txt can't be read.
   */
  async directory(dir, parent) {
    const file = path.join(dir, 'CMakeLists.txt');
    const node = { file, dir, name: null, targets: [], subdirectories: [] };
    const scope = {
      dir,
      node,
      parent,
      // A subdirectory starts with copies of its parent's variables and source groups.
      vars: new Map(parent ? parent.vars : []),
      groups: parent
        ? parent.groups.map((g) => ({ ...g, files: new Set(g.files) }))
        : DEFAULT_GROUPS.map(([name, regex]) => ({ name, regex, files: new Set() }))
    };
    scope.vars.set('CMAKE_CURRENT_SOURCE_DIR', toPosix(dir));
    if (!parent) scope.vars.set('CMAKE_SOURCE_DIR', toPosix(dir));
    this.lists.set(key(file), file);
    if (await this.listFile(file, scope, [])) return node;
    this.lists.delete(key(file));
    return null;
  }

  /** Run the commands of a CMakeLists.txt or an included file in `scope`. False when it can't be read. */
  async listFile(file, scope, chain) {
    const text = await this.io.readFile(file);
    if (text === null) return false;
    const vars = scope.vars;
    const saved = ['CMAKE_CURRENT_LIST_DIR', 'CMAKE_CURRENT_LIST_FILE'].map((name) => [name, vars.get(name)]);
    vars.set('CMAKE_CURRENT_LIST_DIR', toPosix(path.dirname(file)));
    vars.set('CMAKE_CURRENT_LIST_FILE', toPosix(file));

    const inner = [...chain, key(file)];
    let definitions = 0; // depth inside function() and macro() bodies, which only run when called
    for (const command of cmakeCommands(text)) {
      const name = command.name.toLowerCase();
      if (name === 'function' || name === 'macro') definitions++;
      else if (name === 'endfunction' || name === 'endmacro') definitions = Math.max(0, definitions - 1);
      else if (definitions === 0) await this.run(name.replace(/^qt\d*_/, 'qt_'), expandArgs(command.args, vars), scope, inner);
    }

    for (const [name, value] of saved) {
      if (value === undefined) vars.delete(name);
      else vars.set(name, value);
    }
    return true;
  }

  async run(name, args, scope, chain) {
    const vars = scope.vars;
    switch (name) {
      case 'project':
        if (!args[0]) return;
        if (!scope.node.name) scope.node.name = args[0];
        vars.set('PROJECT_NAME', args[0]);
        vars.set('PROJECT_SOURCE_DIR', toPosix(scope.dir));
        vars.set(args[0] + '_SOURCE_DIR', toPosix(scope.dir));
        if (!vars.has('CMAKE_PROJECT_NAME')) vars.set('CMAKE_PROJECT_NAME', args[0]);
        return;
      case 'set':
        return this.set(args, scope);
      case 'unset':
        if (args[0]) (args.includes('PARENT_SCOPE') && scope.parent ? scope.parent.vars : vars).delete(args[0]);
        return;
      case 'list':
        return this.list(args, vars);
      case 'file':
        return this.fileGlob(args, scope);
      case 'include':
        return this.include(args, scope, chain);
      case 'find_package':
        return this.findModule(args[0] ? 'Find' + args[0] : null, scope);
      case 'configure_file':
        return this.addModule(args[0] ? path.resolve(scope.dir, args[0]) : null);
      case 'add_subdirectory':
        return this.addSubdirectory(args, scope);
      case 'add_executable':
      case 'add_library':
      case 'qt_add_executable':
      case 'qt_add_library':
      case 'qt_add_plugin':
        return this.addTarget(name, args, scope);
      case 'add_custom_target': {
        const found = sections(args.slice(1), new Set(['SOURCES']));
        if (args[0] && found.has('SOURCES')) this.addFiles(this.target(args[0], 'custom', scope), found.get('SOURCES'), scope);
        return;
      }
      case 'target_sources': {
        const target = this.targets.get(args[0]);
        const found = sections(args.slice(1), new Set(['PRIVATE', 'PUBLIC', 'FILES']));
        if (target) for (const values of found.values()) this.addFiles(target, values, scope);
        return;
      }
      case 'qt_add_qml_module':
      case 'qt_target_qml_sources': {
        // qt_add_qml_module creates its backing target when there is none yet.
        const target = name === 'qt_add_qml_module' && args[0] ? this.target(args[0], 'library', scope) : this.targets.get(args[0]);
        if (!target) return;
        const found = sections(args.slice(1), new Set(['QML_FILES', 'SOURCES', 'RESOURCES']));
        this.addFiles(target, (found.get('QML_FILES') || []).concat(found.get('SOURCES') || []), scope);
        this.addFiles(target, found.get('RESOURCES') || [], scope, true);
        return;
      }
      case 'qt_add_resources':
      case 'qt_add_shaders': {
        // Only the target form: qt_add_resources(<VAR> file.qrc) adds nothing to a target itself.
        const target = this.targets.get(args[0]);
        if (target) this.addFiles(target, sections(args.slice(2), new Set(['FILES'])).get('FILES') || [], scope, true);
        return;
      }
      case 'qt_add_ui': {
        const target = this.targets.get(args[0]);
        if (target) this.addFiles(target, sections(args.slice(1), new Set(['SOURCES'])).get('SOURCES') || [], scope);
        return;
      }
      case 'source_group':
        return this.sourceGroup(args, scope);
      default:
    }
  }

  set(args, scope) {
    const [name, ...rest] = args;
    if (!name || name.startsWith('ENV{')) return;
    const cache = rest.indexOf('CACHE');
    const toParent = cache === -1 && rest[rest.length - 1] === 'PARENT_SCOPE';
    const values = (cache !== -1 ? rest.slice(0, cache) : toParent ? rest.slice(0, -1) : rest).filter((v) => v !== null);
    const vars = toParent ? (scope.parent ? scope.parent.vars : null) : scope.vars;
    if (!vars || (cache !== -1 && vars.has(name))) return; // a normal variable hides the cache entry
    if (values.length === 0 && cache === -1) vars.delete(name);
    else vars.set(name, values.join(';'));
  }

  list(args, vars) {
    const [operation, name, ...rest] = args;
    if (!name) return;
    const values = rest.filter((v) => v !== null);
    let items = listOf(vars, name);
    switch (operation) {
      case 'APPEND':
        items.push(...values);
        break;
      case 'PREPEND':
        items.unshift(...values);
        break;
      case 'INSERT':
        items.splice(Number(values[0]) || 0, 0, ...values.slice(1));
        break;
      case 'REMOVE_ITEM':
        items = items.filter((item) => !values.includes(item));
        break;
      case 'REMOVE_DUPLICATES':
        items = [...new Set(items)];
        break;
      case 'FILTER': {
        const re = values[1] === 'REGEX' ? cmakeRegex(values[2]) : null;
        if (!re) return;
        items = items.filter((item) => re.test(item) === (values[0] === 'INCLUDE'));
        break;
      }
      case 'TRANSFORM':
        if (values.length !== 2 || (values[0] !== 'APPEND' && values[0] !== 'PREPEND')) {
          vars.delete(name); // a transformation not modelled: the items are unknown now
          return;
        }
        items = items.map((item) => (values[0] === 'APPEND' ? item + values[1] : values[1] + item));
        break;
      default:
        return;
    }
    vars.set(name, items.join(';'));
  }

  /** file(GLOB ...) and file(GLOB_RECURSE ...), evaluated against the files on disk. */
  async fileGlob(args, scope) {
    const recurse = args[0] === 'GLOB_RECURSE';
    if ((!recurse && args[0] !== 'GLOB') || !args[1]) return;
    let relative;
    const patterns = [];
    for (let i = 2; i < args.length; i++) {
      if (args[i] === 'LIST_DIRECTORIES') i++;
      else if (args[i] === 'RELATIVE') relative = args[++i];
      else if (args[i] !== 'CONFIGURE_DEPENDS' && args[i] !== 'FOLLOW_SYMLINKS') patterns.push(args[i]);
    }
    if (relative === null || patterns.includes(null)) {
      scope.vars.delete(args[1]);
      return;
    }
    const found = new Map();
    for (const pattern of patterns) {
      for (const p of await this.glob(path.resolve(scope.dir, pattern), recurse)) found.set(key(p), p);
    }
    const base = relative === undefined ? null : path.resolve(scope.dir, relative);
    const values = [...found.values()].sort().map((p) => toPosix(base ? path.relative(base, p) : p));
    scope.vars.set(args[1], values.join(';'));
  }

  /** The files an absolute glob matches; GLOB_RECURSE matches the file name part in every folder below. */
  async glob(pattern, recurse) {
    const segments = pattern.split(/[\\/]/);
    let fixed = 0;
    while (fixed < segments.length - 1 && !hasWildcard(segments[fixed])) fixed++;
    let dirs = [segments.slice(0, fixed).join(path.sep) + (fixed === 1 ? path.sep : '')];
    const fileName = segmentRegex(segments[segments.length - 1]);
    if (!fileName) return [];

    for (const segment of segments.slice(fixed, -1)) {
      const re = segmentRegex(segment);
      if (!re) return [];
      const next = [];
      for (const dir of dirs) {
        for (const [name, isDirectory] of (await this.io.readDirectory(dir)) || []) {
          if (isDirectory && re.test(name)) next.push(path.join(dir, name));
        }
      }
      dirs = next;
    }

    const out = [];
    const visit = async (dir, depth) => {
      if (this.io.skipDirectory(dir)) return;
      for (const [name, isDirectory] of (await this.io.readDirectory(dir)) || []) {
        if (!isDirectory) {
          if (fileName.test(name)) out.push(path.join(dir, name));
        } else if (recurse && depth < MAX_GLOB_DEPTH) {
          await visit(path.join(dir, name), depth + 1);
        }
      }
    };
    for (const dir of dirs) await visit(dir, 0);
    return out;
  }

  /** include(file) or include(Module): the file is read in the current scope. */
  async include(args, scope, chain) {
    const name = args[0];
    if (!name) return;
    let file = null;
    if (/[\\/]/.test(name) || /\.cmake$/i.test(name)) {
      file = path.resolve(scope.dir, name);
    } else {
      file = await this.findModule(name, scope);
    }
    if (!file || chain.length > MAX_INCLUDE_DEPTH || chain.includes(key(file))) return;
    if (await this.addModule(file)) await this.listFile(file, scope, chain);
  }

  /** `<name>.cmake` in the project's CMAKE_MODULE_PATH, added to the modules; null when it isn't there. */
  async findModule(name, scope) {
    if (!name) return null;
    for (const dir of listOf(scope.vars, 'CMAKE_MODULE_PATH')) {
      const file = path.resolve(scope.dir, dir, name + '.cmake');
      if (await this.addModule(file)) return file;
    }
    return null;
  }

  /** Remember a file CMake reads, if it is one outside a build tree. True when it is. */
  async addModule(file) {
    if (!file || this.io.skipDirectory(path.dirname(file)) || (await this.io.stat(file)) !== 'file') return false;
    this.modules.set(key(file), file);
    return true;
  }

  async addSubdirectory(args, scope) {
    if (!args[0]) return;
    const dir = path.resolve(scope.dir, args[0]);
    const file = path.join(dir, 'CMakeLists.txt');
    if (this.lists.has(key(file)) || this.io.skipDirectory(dir) || (await this.io.stat(file)) !== 'file') return;
    const subdirectory = await this.directory(dir, scope);
    if (subdirectory) scope.node.subdirectories.push(subdirectory);
  }

  async addTarget(command, args, scope) {
    const [name, ...rest] = args;
    if (!name || rest.includes('IMPORTED') || rest.includes('ALIAS')) return;
    const type = command.endsWith('executable') ? 'executable' : command === 'qt_add_plugin' ? 'plugin' : 'library';
    const target = this.target(name, type, scope);
    const sources = [];
    for (let i = 0; i < rest.length; i++) {
      if (TARGET_OPTIONS.has(rest[i])) i++;
      else if (!TARGET_FLAGS.has(rest[i])) sources.push(rest[i]);
    }
    this.addFiles(target, sources, scope);
  }

  /** The target called `name`, created in `scope`'s directory if it isn't defined yet. */
  target(name, type, scope) {
    let target = this.targets.get(name);
    if (!target) {
      target = { name, type, dir: scope.dir, groups: scope.groups, files: new Map(), resources: new Set() };
      this.targets.set(name, target);
      scope.node.targets.push(target);
    } else if (target.type === 'library' && type !== 'library') {
      target.type = type;
    }
    return target;
  }

  /** Add source file arguments to a target, relative to the directory of the command naming them. */
  addFiles(target, values, scope, resource) {
    for (const value of values) {
      if (value === null || value === '') continue;
      const p = path.resolve(scope.dir, value);
      const k = key(p);
      if (!target.files.has(k)) target.files.set(k, p);
      if (resource) target.resources.add(k);
    }
  }

  sourceGroup(args, scope) {
    const group = (name) => {
      const normalized = name.split(/[\\/]+/).filter(Boolean).join('/');
      let found = scope.groups.find((g) => g.name === normalized);
      if (!found) {
        found = { name: normalized, regex: null, files: new Set() };
        scope.groups.push(found);
      }
      return found;
    };
    if (args[0] === null || args[0] === undefined) return;

    if (args[0] === 'TREE') {
      if (!args[1]) return;
      const root = path.resolve(scope.dir, args[1]);
      const found = sections(args.slice(2), new Set(['PREFIX', 'FILES']));
      const prefix = (found.get('PREFIX') || [''])[0] || '';
      for (const value of found.get('FILES') || []) {
        if (!value) continue;
        const p = path.resolve(scope.dir, value);
        const rel = path.relative(root, path.dirname(p));
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        group([prefix, ...rel.split(/[\\/]/)].join('/')).files.add(key(p));
      }
      return;
    }

    const target = group(args[0]);
    if (args.length === 2 && args[1] !== 'FILES' && args[1] !== 'REGULAR_EXPRESSION') {
      target.regex = cmakeRegex(args[1]); // source_group(name regex), the old form
      return;
    }
    const found = sections(args.slice(1), new Set(['FILES', 'REGULAR_EXPRESSION']));
    if (found.has('REGULAR_EXPRESSION')) target.regex = cmakeRegex(found.get('REGULAR_EXPRESSION')[0]);
    for (const value of found.get('FILES') || []) {
      if (value) target.files.add(key(path.resolve(scope.dir, value)));
    }
  }

  /**
   * Qt's finalizer: a target's .qml and .js files go to "Source Files", and the files it
   * compiles in as resources to "Resources". Then every file gets its group.
   */
  finish() {
    for (const target of this.targets.values()) {
      const named = (name) => target.groups.find((g) => g.name === name);
      for (const [k, p] of target.files) {
        if (/\.(qml|js)$/.test(p)) named('Source Files').files.add(k);
        else if (target.resources.has(k)) named('Resources').files.add(k);
      }
    }
    for (const target of this.targets.values()) {
      target.files = [...target.files.values()].map((p) => ({ path: p, group: groupOf(target.groups, p) }));
      delete target.groups;
      delete target.resources;
    }
  }
}

/**
 * Read the CMake project whose top-level CMakeLists.txt is `file`:
 *
 *   {kind: 'cmake', file, dir, name, targets, subdirectories, modules, presets, lists}
 *
 * `name` is its project() name, or null. `subdirectories` are directories of the same
 * shape without `modules`, `presets` and `lists`; a target is {name, type, dir, files},
 * `type` one of executable, library, plugin, custom, and each file {path, group}, the
 * group's levels joined by "/" ("" for none). `modules` are the other files CMake reads,
 * `presets` CMakePresets.json and CMakeUserPresets.json, `lists` every CMakeLists.txt read.
 *
 * `io` reads the disk: readFile(p) -> text or null, readDirectory(p) -> [[name, isDirectory]]
 * or null, stat(p) -> 'file', 'directory' or null, and skipDirectory(p), true for build
 * trees and other folders never to look into. Null when `file` can't be read.
 */
async function readCMakeProject(file, io) {
  const evaluator = new Evaluator(io);
  const top = await evaluator.directory(path.dirname(file), null);
  if (!top) return null;
  evaluator.finish();

  const presets = [];
  for (const name of ['CMakePresets.json', 'CMakeUserPresets.json']) {
    const p = path.join(top.dir, name);
    if ((await io.stat(p)) === 'file') presets.push(p);
  }
  // Read by vcpkg's toolchain file, which is what CMake reports it for.
  await evaluator.addModule(path.join(top.dir, 'vcpkg.json'));

  return {
    kind: 'cmake',
    ...top,
    modules: [...evaluator.modules.values()],
    presets,
    lists: [...evaluator.lists.values()]
  };
}

module.exports = { readCMakeProject };
