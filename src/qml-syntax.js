'use strict';

/**
 * Just enough QML syntax for the rewriters: import statements, identifier tokens,
 * and where a new import line goes.
 */

const { isUrlScheme } = require('./paths');
const { collect } = require('./text');

/** Directory/file imports (`import "views" as V`) and module imports (`import Test 1.0 as T`). */
function parseQmlImports(text) {
  const dirs = collect(text, /^([ \t]*import[ \t]+")([^"\n]+)("[^\n]*)/gm, 2)
    .filter((hit) => !isUrlScheme(hit.raw))
    .map((hit) => {
      const q = /^"[ \t]*as[ \t]+(\w+)/.exec(hit.match[3]);
      return { raw: hit.raw, qualifier: q ? q[1] : '' };
    });
  const modules = [];
  const re = /^[ \t]*import[ \t]+([A-Za-z_][\w.]*)(?:[ \t]+\d+(?:\.\d+)?)?(?:[ \t]+as[ \t]+(\w+))?/gm;
  let m;
  while ((m = re.exec(text)) !== null) modules.push({ uri: m[1], qualifier: m[2] || '' });
  return { dirs, modules };
}

/**
 * Identifier tokens of a QML document, skipping comments, string literals and
 * import/pragma lines. A token that follows a `.` records the identifier the dot
 * hangs off, so a qualified `W.BasicsView` can be told apart from a member access
 * such as `root.BasicsView`.
 */
function qmlIdentifiers(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  let atLineStart = true;
  let lastIdent = null; // the previous significant token, when it was an identifier
  let afterDot = false;
  let dotOwner = null;

  while (i < n) {
    const c = text[i];
    if (atLineStart) {
      atLineStart = false;
      if (/^[ \t]*(?:import|pragma)\b/.test(text.slice(i, i + 32))) {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? n : nl;
        continue;
      }
    }
    if (c === '\n') {
      atLineStart = true;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < n && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
      i++;
      lastIdent = null;
      afterDot = false;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(text[j])) j++;
      const tok = { name: text.slice(i, j), start: i, end: j, dotted: afterDot, qualifier: afterDot ? dotOwner : null };
      out.push(tok);
      lastIdent = tok;
      afterDot = false;
      i = j;
    } else if (/[0-9]/.test(c)) {
      while (i < n && /[\w.]/.test(text[i])) i++;
      lastIdent = null;
      afterDot = false;
    } else if (c === '.') {
      afterDot = true;
      dotOwner = lastIdent && !lastIdent.dotted ? lastIdent.name : null;
      lastIdent = null;
      i++;
    } else {
      lastIdent = null;
      afterDot = false;
      i++;
    }
  }
  return out;
}

/**
 * End of the last import line that survives, or of the pragma block, or the top
 * of the file. Lines being removed are skipped so an insertion never lands
 * inside a deleted range.
 */
function importInsertOffset(text, skipLineStarts) {
  let end = null;
  for (const re of [/^[ \t]*import[ \t]+\S[^\n\r]*/gm, /^[ \t]*pragma[ \t]+\S[^\n\r]*/gm]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (skipLineStarts && skipLineStarts.has(m.index)) continue;
      end = m.index + m[0].length;
    }
    if (end !== null) return end;
  }
  return 0;
}

module.exports = { parseQmlImports, qmlIdentifiers, importInsertOffset };
