'use strict';

/**
 * Adding a new file to CMakeLists.txt: a .qml file to QML_FILES of qt_add_qml_module,
 * a C/C++ file to its target's sources -- to whichever list already holds its
 * neighbours.
 */

const path = require('path');
const { CURRENT_DIR, cmakeArgPath, cmakeCommands, isCMakeKeyword: isKeyword } = require('../cmake-syntax');
const { escapeRe, eolOf, indentAt, indentUnit, lineEndAt, startsLine } = require('../text');
const { isAbsolutePathLike, relFrom } = require('../paths');
const { bestList, familyOf } = require('./lists');

/** Arguments of add_executable / add_library and their qt_ forms that come before the sources. */
const TARGET_OPTIONS = new Set([
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

function itemsOf(args, dir) {
  return args.map((arg) => ({ ...arg, path: cmakeArgPath(dir, arg) }));
}

/** Keyword sections of a command's arguments: [{keyword, args}]. */
function sections(args) {
  const out = [];
  for (const arg of args) {
    if (isKeyword(arg)) out.push({ keyword: arg, args: [] });
    else if (out.length > 0) out[out.length - 1].args.push(arg);
  }
  return out;
}

/**
 * Every list in a CMakeLists.txt a file of `family` could be added to:
 * [{command, head, items, rank, nested, what, section}]. The items follow `head`, the
 * argument a first item would go after; `nested` lists sit under a keyword and are
 * indented one level deeper than it. `section` is set when the command lacks the
 * keyword, and the insertion adds it after the command's last argument.
 */
function cmakeLists(commands, dir, family) {
  const lists = [];
  const holdsFamily = (items) => items.some((item) => item.path && familyOf(item.path) === family);

  for (const command of commands) {
    const name = command.name.toLowerCase();
    const args = command.args;
    if (args.length === 0) continue;
    const label = command.name + '(' + args[0].text + ')';
    const add = (list) => lists.push({ command, nested: false, section: null, ...list });

    if (/^qt\d*_add_qml_module$/.test(name)) {
      const keyword = family === 'qml' ? 'QML_FILES' : 'SOURCES';
      const found = sections(args.slice(1)).filter((s) => s.keyword.text === keyword);
      for (const s of found) {
        add({ head: s.keyword, items: itemsOf(s.args, dir), rank: 0, nested: true, what: keyword + ' of ' + label });
      }
      if (found.length === 0) {
        add({ head: args[args.length - 1], items: [], rank: 3, section: keyword, what: keyword + ' of ' + label });
      }
    } else if (family === 'qml' && /^qt\d*_target_qml_sources$/.test(name)) {
      for (const s of sections(args.slice(1)).filter((s) => s.keyword.text === 'QML_FILES')) {
        add({ head: s.keyword, items: itemsOf(s.args, dir), rank: 1, nested: true, what: 'QML_FILES of ' + label });
      }
    } else if (family === 'qml' && /^qt\d*_add_resources$/.test(name)) {
      for (const s of sections(args.slice(1)).filter((s) => s.keyword.text === 'FILES')) {
        const items = itemsOf(s.args, dir);
        if (holdsFamily(items)) add({ head: s.keyword, items, rank: 2, nested: true, what: 'FILES of ' + label });
      }
    } else if (family === 'cpp' && /^(?:qt\d*_)?add_(?:executable|library)$/.test(name)) {
      if (args.some((a) => !a.quoted && (a.text === 'IMPORTED' || a.text === 'ALIAS'))) continue;
      let k = 1;
      while (k < args.length && !args[k].quoted && TARGET_OPTIONS.has(args[k].text)) k++;
      add({ head: args[k - 1], items: itemsOf(args.slice(k), dir), rank: 2, what: label });
    } else if (family === 'cpp' && name === 'target_sources') {
      // PRIVATE and PUBLIC sources are built into the target; INTERFACE ones and file sets are not
      const scopes = [];
      let section = null;
      for (const arg of args.slice(1)) {
        if (!arg.quoted && /^(?:PRIVATE|PUBLIC|INTERFACE|FILE_SET)$/.test(arg.text)) {
          section = arg.text === 'PRIVATE' || arg.text === 'PUBLIC' ? { keyword: arg, args: [] } : null;
          if (section) scopes.push(section);
        } else if (section) {
          section.args.push(arg);
        }
      }
      for (const s of scopes) {
        add({ head: s.keyword, items: itemsOf(s.args, dir), rank: 1, nested: true, what: s.keyword.text + ' of ' + label });
      }
    } else if (name === 'set' || (name === 'list' && args[0].text === 'APPEND')) {
      const at = name === 'set' ? 0 : 1;
      if (args.length <= at + 1 || args.some((a) => !a.quoted && (a.text === 'CACHE' || a.text === 'PARENT_SCOPE'))) {
        continue;
      }
      const items = itemsOf(args.slice(at + 1), dir);
      const variable = command.name + '(' + args.slice(0, at + 1).map((a) => a.text).join(' ') + ')';
      if (holdsFamily(items)) add({ head: args[at], items, rank: 1, what: variable });
    }
  }
  return lists;
}

function globRegex(glob) {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : escapeRe(c)))
    .join('');
  return new RegExp('^' + body + '$', process.platform === 'win32' ? 'i' : '');
}

/**
 * The label of the file(GLOB ...) or file(GLOB_RECURSE ...) in `commands` whose pattern
 * matches `rel`, the new file's path relative to the CMakeLists.txt, or null.
 */
function globbedBy(commands, rel) {
  for (const command of commands) {
    const args = command.args;
    if (command.name.toLowerCase() !== 'file' || args.length < 3) continue;
    const recurse = args[0].text === 'GLOB_RECURSE';
    if (!recurse && args[0].text !== 'GLOB') continue;

    for (let k = 2; k < args.length; k++) {
      const arg = args[k].text;
      if (arg === 'LIST_DIRECTORIES' || arg === 'RELATIVE') {
        k++;
        continue;
      }
      const pattern = arg.replace(CURRENT_DIR, '');
      if (pattern.includes('$') || isAbsolutePathLike(pattern) || arg === 'CONFIGURE_DEPENDS' || arg === 'FOLLOW_SYMLINKS') {
        continue;
      }
      let matches = globRegex(pattern).test(rel);
      if (!matches && recurse) {
        // GLOB_RECURSE src/*.cpp also matches src/a/b.cpp
        const slash = pattern.lastIndexOf('/');
        const dirs = path.posix.dirname(rel).split('/');
        matches =
          globRegex(pattern.slice(slash + 1)).test(path.posix.basename(rel)) &&
          (slash === -1 || dirs.some((_, i) => globRegex(pattern.slice(0, slash)).test(dirs.slice(0, i + 1).join('/'))));
      }
      if (matches) return command.name + '(' + args[0].text + ' ' + args[1].text + ')';
    }
  }
  return null;
}

/** `rel` spelled like the item it goes next to: quoted, or under ${CMAKE_CURRENT_SOURCE_DIR}/. */
function spell(rel, like) {
  const prefix = like ? (CURRENT_DIR.exec(like.text) || [''])[0] : '';
  const value = prefix + rel;
  if ((like && like.quoted) || /[\s()#";\\]/.test(value)) return '"' + value.replace(/["\\]/g, '\\$&') + '"';
  return value;
}

/** Insert on a new line after the token ending at `offset`, past a comment that trails it. */
function onNextLine(text, offset, insert) {
  const end = lineEndAt(text, offset);
  const at = /^[ \t]*(?:#(?!\[=*\[).*)?$/.test(text.slice(offset, end)) ? end : offset;
  return { start: at, end: at, text: insert };
}

/** The edit adding `newPath` to `list`, laid out like the lines around it. */
function insertion(text, list, place, newPath, dir) {
  const eol = eolOf(text);
  const unit = indentUnit(text);
  const { command, head } = list;
  const entry = spell(relFrom(dir, newPath), place.like);
  const values = command.args.slice(1).filter((a) => !isKeyword(a));
  const indentOfFirst = (args) => {
    const own = args.find((a) => startsLine(text, a.start));
    return own ? indentAt(text, own.start) : null;
  };
  const brokenBefore = (offset, end) => text.slice(offset, end).includes('\n');

  if (list.section) {
    if (!brokenBefore(head.end, command.close)) {
      return { start: head.end, end: head.end, text: ' ' + list.section + ' ' + entry };
    }
    const keywordIndent = indentOfFirst(command.args.filter(isKeyword)) ?? indentAt(text, command.start) + unit;
    const valueIndent = indentOfFirst(values) ?? keywordIndent + unit;
    return onNextLine(text, head.end, eol + keywordIndent + list.section + eol + valueIndent + entry);
  }

  const after = place.after;
  if (after) {
    if (startsLine(text, after.start)) return onNextLine(text, after.end, eol + indentAt(text, after.start) + entry);
    return { start: after.end, end: after.end, text: ' ' + entry };
  }

  // An empty list: after its keyword, the target name or the last target option.
  const next = command.args.find((a) => a.start >= head.end);
  if (!brokenBefore(head.end, next ? next.start : command.close)) {
    return { start: head.end, end: head.end, text: ' ' + entry };
  }
  const deeper = list.nested || !startsLine(text, head.start);
  const indent = indentOfFirst(values) ?? indentAt(text, head.start) + (deeper ? unit : '');
  return onNextLine(text, head.end, eol + indent + entry);
}

/**
 * Add `newPath` to the nearest CMakeLists.txt, from its own directory up, that has a list
 * a file like it fits in: {file, what, edit}. A file(GLOB) there that already matches it
 * gives {file, note} instead. Null when no CMakeLists.txt has a place for it.
 */
async function registerInCMake(chain, newPath, readFile) {
  const family = familyOf(newPath);
  for (const { dir, files } of chain) {
    const file = files.find((f) => path.basename(f).toLowerCase() === 'cmakelists.txt');
    if (!file) continue;
    const text = await readFile(file);
    if (text === null) continue;

    const commands = cmakeCommands(text);
    const glob = globbedBy(commands, relFrom(dir, newPath));
    if (glob) return { file, note: glob + ' already picks it up' };
    const best = bestList(cmakeLists(commands, dir, family), newPath);
    if (best) {
      return { file, what: 'to ' + best.list.what, edit: insertion(text, best.list, best.placement, newPath, dir) };
    }
  }
  return null;
}

module.exports = { registerInCMake };
