'use strict';

/**
 * Text helpers shared by the rewriters: regex matches with offsets, line ranges,
 * offset/position conversion and merging of overlapping edits. Only the conversion to a
 * Position needs VS Code.
 */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Map a byte offset in `text` to a Position without needing an open document. */
function makeOffsetToPosition(text) {
  // Required here, so the other helpers also serve modules that run without VS Code.
  const vscode = require('vscode');
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return function (offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - starts[lo]);
  };
}

/** The inverse: map a Position (line, character) in `text` to an offset. */
function makePositionToOffset(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (pos) => (starts[pos.line] === undefined ? text.length : starts[pos.line] + pos.character);
}

/**
 * Collect every match of `re` in `text`, reporting the offsets of capture group
 * `group`. Every regex passed here has flat, sequential capture groups, so the
 * group offset is the match start plus the length of the preceding groups.
 */
function collect(text, re, group) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    let off = m.index;
    for (let i = 1; i < group; i++) off += (m[i] || '').length;
    out.push({ raw: m[group], start: off, end: off + m[group].length, match: m });
  }
  return out;
}

/** The whole line containing `offset`, including its line break. */
function lineRange(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', offset);
  return { start, end: nl === -1 ? text.length : nl + 1 };
}

/** The line break a file uses: '\r\n' when it has any, '\n' otherwise. */
function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Offset of the end of the line holding `offset`, before its line break. */
function lineEndAt(text, offset) {
  const nl = text.indexOf('\n', offset);
  if (nl === -1) return text.length;
  return nl > offset && text[nl - 1] === '\r' ? nl - 1 : nl;
}

/** True when only spaces and tabs precede `offset` on its line. */
function startsLine(text, offset) {
  return /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset));
}

/** The leading whitespace of the line holding `offset`. */
function indentAt(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, Math.max(start, offset)))[0];
}

/** One level of indentation as `text` spells it: a tab, or its narrowest run of leading spaces (4 if it has none). */
function indentUnit(text) {
  if (/^\t/m.test(text)) return '\t';
  let unit = 0;
  const re = /^( +)\S/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (unit === 0 || m[1].length < unit) unit = m[1].length;
  }
  return ' '.repeat(unit >= 2 && unit <= 8 ? unit : 4);
}

/**
 * The whole lines from the one holding `from` to the one holding `to`, plus the blank
 * line after them when a blank line or the start of the file comes before: taking out a
 * block that stood between two blank lines leaves one.
 */
function blockRange(text, from, to) {
  const start = lineRange(text, from).start;
  let end = lineRange(text, to).end;
  const blank = (r) => /^[ \t]*\r?\n?$/.test(text.slice(r.start, r.end));
  const next = end < text.length ? lineRange(text, end) : null;
  if (next && blank(next) && (start === 0 || blank(lineRange(text, start - 1)))) end = next.end;
  return { start, end };
}

/** Edits deleting `ranges` ({start, end}), merged where they touch or overlap. */
function removalEdits(ranges) {
  const out = [];
  for (const r of ranges.slice().sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end, text: '' });
  }
  return out;
}

function dedupe(edits) {
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let lastEnd = -1;
  for (const e of edits) {
    if (e.start < lastEnd) continue; // overlapping rewrite: keep the first
    out.push(e);
    lastEnd = Math.max(lastEnd, e.end);
  }
  return out;
}

module.exports = {
  escapeRe,
  makeOffsetToPosition,
  makePositionToOffset,
  collect,
  lineRange,
  eolOf,
  lineEndAt,
  startsLine,
  indentAt,
  indentUnit,
  blockRange,
  removalEdits,
  dedupe
};
