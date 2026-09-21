'use strict';

/**
 * Adding a new .qml file to a hand-written qmldir.
 */

const path = require('path');
const { isQmlTypeName, key, relFrom } = require('../paths');
const { eolOf, lineEndAt } = require('../text');
const { familyOf, placement } = require('./lists');

/** The type entries of a qmldir, `[singleton] Type [1.0] Path.qml`, with the version each gives. */
function qmldirItems(text, dir) {
  const items = [];
  const re = /^[ \t]*(?:singleton[ \t]+|internal[ \t]+)?[A-Za-z_]\w*([ \t]+\d+\.\d+)?[ \t]+(\S+\.(?:qml|js))[ \t]*(?=\r?$)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[2],
      quoted: false,
      path: path.resolve(dir, m[2]),
      version: m[1] ? m[1].trim() : null
    });
  }
  return items;
}

/**
 * Add a new .qml file to the nearest qmldir above it: {file, what, edit}, or null. A qmldir
 * in the file's own directory always gets the entry; one further up only when it already
 * lists a file of that directory. The version is the one its neighbour is listed with.
 */
async function registerInQmldir(chain, newPath, readFile) {
  const typeName = path.basename(newPath, path.extname(newPath));
  if (familyOf(newPath) !== 'qml' || !isQmlTypeName(typeName)) return null;

  for (const { dir, files } of chain) {
    const file = files.find((f) => path.basename(f) === 'qmldir');
    if (!file) continue;
    const text = await readFile(file);
    if (text === null) return null;

    const items = qmldirItems(text, dir);
    const place = placement(items, newPath);
    if (key(dir) !== key(path.dirname(newPath)) && place.score[1] === 0) return null;

    const version = place.like ? place.like.version : '1.0';
    const line = typeName + (version ? ' ' + version : '') + ' ' + relFrom(dir, newPath);
    const eol = eolOf(text);
    if (place.after) {
      const end = lineEndAt(text, place.after.end);
      return { file, what: line, edit: { start: end, end, text: eol + line } };
    }
    const lead = text === '' || text.endsWith('\n') ? '' : eol;
    return { file, what: line, edit: { start: text.length, end: text.length, text: lead + line + eol } };
  }
  return null;
}

module.exports = { registerInQmldir };
