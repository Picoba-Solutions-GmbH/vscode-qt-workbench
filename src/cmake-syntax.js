'use strict';

/**
 * Just enough CMake syntax to add a file to a list or take one out: command
 * invocations and their arguments, with offsets. Comments are skipped.
 */

const path = require('path');
const { blockRange, lineEndAt, lineRange } = require('./text');

const CURRENT_DIR = /^\$\{CMAKE_CURRENT_(?:SOURCE|LIST)_DIR\}\//;
/** The rest of a line holding nothing, or a line comment. */
const COMMENT_ONLY = /^[ \t]*(?:#(?!\[=*\[).*)?$/;

// Commands whose first argument is a target, unlike project() or find_package(), which may share its name.
const ON_TARGET = /^(?:add_executable|add_library|add_dependencies|set_target_properties|target_\w+|qt\d*_(?:add|target|finalize|import)_\w+)$/i;
const BLOCK_START = /^(?:if|foreach|while|function|macro|block)$/i;
const BLOCK_END = /^(?:endif|endforeach|endwhile|endfunction|endmacro|endblock)$/i;

/** Offset just past a comment at `i`: a `#` line comment or a `#[[ ]]` bracket comment. */
function skipComment(text, i) {
  const bracket = /^#\[(=*)\[/.exec(text.slice(i, i + 64));
  if (bracket) {
    const close = text.indexOf(']' + bracket[1] + ']', i + bracket[0].length);
    return close === -1 ? text.length : close + bracket[1].length + 2;
  }
  const nl = text.indexOf('\n', i);
  return nl === -1 ? text.length : nl;
}

/** Read the arguments of `command` from its opening parenthesis; returns the offset past its closing one. */
function parseArguments(text, command) {
  const n = text.length;
  let depth = 1;
  let i = command.open + 1;
  while (i < n) {
    const c = text[i];
    if (c === '(') {
      depth++;
      i++;
    } else if (c === ')') {
      if (--depth === 0) {
        command.close = i;
        return i + 1;
      }
      i++;
    } else if (c === '#') {
      i = skipComment(text, i);
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, n);
      command.args.push({ text: text.slice(i + 1, Math.min(j, n)), start: i, end, quoted: true });
      i = end;
    } else if (c === '[' && /^\[=*\[/.test(text.slice(i, i + 64))) {
      // bracket argument: [[ ... ]] or [=[ ... ]=]
      const open = /^\[(=*)\[/.exec(text.slice(i, i + 64));
      const close = text.indexOf(']' + open[1] + ']', i + open[0].length);
      const end = close === -1 ? n : close + open[1].length + 2;
      command.args.push({ text: text.slice(i + open[0].length, close === -1 ? n : close), start: i, end, quoted: true });
      i = end;
    } else {
      let j = i;
      while (j < n && !/[\s()#"]/.test(text[j])) j += text[j] === '\\' ? 2 : 1;
      command.args.push({ text: text.slice(i, j), start: i, end: j, quoted: false });
      i = j;
    }
  }
  command.close = n;
  return n;
}

/**
 * The command invocations of a CMake file: [{name, start, open, close, args}], where
 * `open` and `close` are the offsets of its parentheses and each argument is
 * {text, start, end, quoted} -- `text` without its quotes, the offsets spanning them.
 * Nested parentheses (`if((A) OR B)`) stay inside their invocation.
 */
function cmakeCommands(text) {
  const commands = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '#') {
      i = skipComment(text, i);
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(text[j])) j++;
      let open = j;
      while (open < n && (text[open] === ' ' || text[open] === '\t')) open++;
      if (text[open] !== '(') {
        i = j;
        continue;
      }
      const command = { name: text.slice(i, j), start: i, open, close: n, args: [] };
      i = parseArguments(text, command);
      commands.push(command);
    } else {
      i++;
    }
  }
  return commands;
}

/** The commands of a CMake file, each with `depth`: how many if(), foreach(), function() ... blocks it is in. */
function commandsWithDepth(text) {
  let depth = 0;
  return cmakeCommands(text).map((c) => {
    if (BLOCK_END.test(c.name)) depth = Math.max(0, depth - 1);
    const command = { ...c, depth };
    if (BLOCK_START.test(c.name)) depth++;
    return command;
  });
}

/**
 * The path an argument names, resolved against the CMakeLists.txt's directory -- with
 * or without ${CMAKE_CURRENT_SOURCE_DIR}/ -- or null when it depends on other variables.
 */
function cmakeArgPath(dir, arg) {
  const plain = arg.text.replace(CURRENT_DIR, '');
  return plain !== '' && !plain.includes('$') && !plain.includes(';') ? path.resolve(dir, plain) : null;
}

/** Keywords such as QML_FILES, PRIVATE or PROPERTIES: unquoted, upper case. */
function isCMakeKeyword(arg) {
  return !arg.quoted && /^[A-Z][A-Z0-9_]*$/.test(arg.text);
}

/** The range taking out a whole command: its lines, when it has them to itself. */
function commandRange(text, command) {
  const end = Math.min(command.close + 1, text.length);
  const alone =
    /^[ \t]*$/.test(text.slice(lineRange(text, command.start).start, command.start)) &&
    COMMENT_ONLY.test(text.slice(end, lineEndAt(text, end)));
  return alone ? blockRange(text, command.start, command.close) : { start: command.start, end };
}

/**
 * The range taking out one argument: its line when it had one to itself, else the
 * argument and the space that set it apart. An argument alone before the closing
 * parenthesis takes the line break before it, so `)` joins the argument kept before it.
 */
function argumentRange(text, command, arg, keptBefore) {
  const line = lineRange(text, arg.start);
  const before = text.slice(line.start, arg.start);
  const after = text.slice(arg.end, lineEndAt(text, arg.end));
  const spaceAfter = /^[ \t]*/.exec(after)[0].length;
  if (/^[ \t]*$/.test(before)) {
    if (COMMENT_ONLY.test(after)) return line;
    const from = keptBefore ? keptBefore.end : command.open + 1;
    if (/^[ \t]*\)/.test(after) && !text.slice(from, arg.start).includes('#')) return { start: from, end: arg.end };
    return { start: arg.start, end: arg.end + spaceAfter };
  }
  const spaceBefore = /[ \t]*$/.exec(before)[0].length;
  return spaceBefore > 0 ? { start: arg.start - spaceBefore, end: arg.end } : { start: arg.start, end: arg.end + spaceAfter };
}

module.exports = {
  CURRENT_DIR,
  COMMENT_ONLY,
  ON_TARGET,
  cmakeCommands,
  commandsWithDepth,
  cmakeArgPath,
  isCMakeKeyword,
  commandRange,
  argumentRange
};
