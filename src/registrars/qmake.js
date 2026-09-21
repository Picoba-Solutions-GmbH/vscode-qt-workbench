'use strict';

/**
 * Adding a new C/C++ file to a qmake project: HEADERS or SOURCES of the nearest .pro or
 * .pri that lists files.
 */

const path = require('path');
const { HEADER_EXT, extOf, relFrom } = require('../paths');
const { PWD, qmakeAssignments, qmakeValuePath } = require('../qmake-syntax');
const { eolOf, indentAt, indentUnit, lineEndAt, startsLine } = require('../text');
const { bestList, familyOf } = require('./lists');

function spell(rel, like) {
  const value = (like ? (PWD.exec(like.text) || [''])[0] : '') + rel;
  return (like && like.quoted) || /\s/.test(value) ? '"' + value + '"' : value;
}

/** The edit adding `newPath` to an assignment, one value per line when it lists them that way. */
function insertion(list, place, newPath) {
  const { text } = list;
  const eol = eolOf(text);
  const entry = spell(relFrom(list.dir, newPath), place.like);
  const after = place.after;

  if (!after) {
    const lineEnd = lineEndAt(text, list.head);
    if (list.end > lineEnd) return { start: lineEnd, end: lineEnd, text: eol + indentUnit(text) + entry }; // `HEADERS += \`
    return { start: list.head, end: list.head, text: ' ' + entry };
  }
  const lineEnd = lineEndAt(text, after.end);
  const rest = text.slice(after.end, lineEnd);
  if (!startsLine(text, after.start) || rest.includes('#')) return { start: after.end, end: after.end, text: ' ' + entry };
  const indent = indentAt(text, after.start);
  if (/^[ \t]*\\[ \t]*$/.test(rest)) return { start: lineEnd, end: lineEnd, text: eol + indent + entry + ' \\' };
  return { start: after.end, end: after.end, text: ' \\' + eol + indent + entry };
}

/**
 * Add `newPath` to HEADERS or SOURCES of the nearest .pro or .pri, from its own directory
 * up, that lists either: {file, what, edit}, or null. When the files there only list the
 * other variable, a new assignment follows the last one.
 */
async function registerInQmake(chain, newPath, readFile) {
  if (familyOf(newPath) !== 'cpp') return null;
  const variable = HEADER_EXT.has(extOf(newPath)) ? 'HEADERS' : 'SOURCES';

  for (const { files } of chain) {
    const lists = [];
    const others = [];
    for (const file of files.filter((f) => extOf(f) === '.pro' || extOf(f) === '.pri')) {
      const text = await readFile(file);
      if (text === null) continue;
      const dir = path.dirname(file);
      for (const assignment of qmakeAssignments(text)) {
        if (!/^(?:SOURCES|HEADERS)$/.test(assignment.variable) || !/^[+*]?=$/.test(assignment.operator)) continue;
        // unconditional before scoped, and the .pro before an included .pri
        const rank = (assignment.scoped ? 2 : 0) + (extOf(file) === '.pri' ? 1 : 0);
        const items = assignment.items.map((item) => ({ ...item, path: qmakeValuePath(dir, item.text) }));
        const list = { ...assignment, items, file, text, dir, rank };
        (assignment.variable === variable ? lists : others).push(list);
      }
    }

    const best = bestList(lists, newPath);
    if (best) return { file: best.list.file, what: 'to ' + variable, edit: insertion(best.list, best.placement, newPath) };
    if (others.length > 0) {
      const home = others.slice().sort((a, b) => a.rank - b.rank)[0].file;
      const last = others.filter((o) => o.file === home).pop();
      const eol = eolOf(last.text);
      const text = eol + eol + variable + ' += \\' + eol + indentUnit(last.text) + spell(relFrom(last.dir, newPath), null);
      return { file: home, what: 'to a new ' + variable, edit: { start: last.end, end: last.end, text } };
    }
  }
  return null;
}

module.exports = { registerInQmake };
