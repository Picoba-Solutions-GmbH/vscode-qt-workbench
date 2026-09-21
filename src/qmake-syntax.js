'use strict';

/**
 * Just enough qmake syntax to add a file to a variable or take one out: assignments,
 * their continued lines and their values, with offsets.
 */

const path = require('path');
const { lineEndAt } = require('./text');

const PWD = /^\$\$(?:PWD|\{PWD\})\//;

/** True when `offset` is inside a `scope { ... }` block. */
function inBlock(text, offset) {
  let depth = 0;
  for (const line of text.slice(0, offset).split('\n')) {
    for (const c of line.replace(/#.*/, '')) {
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0;
}

/**
 * The assignments of a .pro, .pri or .prf file: [{variable, operator, scoped, start, head, end, lines, items}].
 *
 *   start   offset of the line the assignment starts on
 *   head    offset just past its operator
 *   end     end of its last line, before the line break
 *   lines   [{start, end, continued, backslash}]: each line it spans; `backslash` is
 *           the range of a continuation's `\` with the space around it
 *   items   [{start, end, text, quoted, line}]: its values, `line` indexing `lines`
 *
 * `scoped` is set for `win32: SOURCES += ...` and for assignments inside a `{ }` block.
 */
function qmakeAssignments(text) {
  const out = [];
  const re = /^[ \t]*([^=\n#]*:[ \t]*)?([A-Za-z_][\w.]*)[ \t]*([+*~-]?=)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const assignment = {
      variable: m[2],
      operator: m[3],
      scoped: Boolean(m[1]) || inBlock(text, m.index),
      start: m.index,
      head: m.index + m[0].length,
      end: 0,
      lines: [],
      items: []
    };
    let lineStart = m.index;
    let i = assignment.head;
    for (;;) {
      const end = lineEndAt(text, i);
      const hash = text.indexOf('#', i);
      const code = text.slice(i, hash !== -1 && hash < end ? hash : end);
      const continuation = /[ \t]*\\[ \t]*$/.exec(code);
      const body = continuation ? code.slice(0, continuation.index) : code;
      const values = /"[^"]*"|[^\s"]+/g;
      let v;
      while ((v = values.exec(body)) !== null) {
        const quoted = v[0][0] === '"';
        assignment.items.push({
          start: i + v.index,
          end: i + v.index + v[0].length,
          text: quoted ? v[0].slice(1, -1) : v[0],
          quoted,
          line: assignment.lines.length
        });
      }
      assignment.lines.push({
        start: lineStart,
        end,
        continued: Boolean(continuation),
        backslash: continuation ? { start: i + continuation.index, end: i + code.length } : null
      });
      assignment.end = end;
      const nl = text.indexOf('\n', end);
      if (!continuation || nl === -1) break;
      lineStart = i = nl + 1;
    }
    out.push(assignment);
    re.lastIndex = Math.max(re.lastIndex, assignment.end);
  }
  return out;
}

/** The file a value names, resolved against the directory of the .pro/.pri, or null for `$$VARIABLE`s. */
function qmakeValuePath(dir, value) {
  const plain = value.replace(PWD, '');
  return plain !== '' && !plain.includes('$') ? path.resolve(dir, plain) : null;
}

module.exports = { PWD, qmakeAssignments, qmakeValuePath };
