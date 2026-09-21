'use strict';

/**
 * Adding a new .qml file to the .qrc resource file that lists the QML files near it.
 */

const path = require('path');
const { extOf, key, relFrom } = require('../paths');
const { eolOf, indentAt, startsLine } = require('../text');
const { bestList, familyOf } = require('./lists');

/** The <file> entries of a .qrc: items spanning the whole element. */
function qrcItems(text, dir) {
  const items = [];
  const re = /<file\b[^>]*>([^<]*)<\/file>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].trim();
    items.push({ start: m.index, end: m.index + m[0].length, text: value, quoted: false, path: value ? path.resolve(dir, value) : null });
  }
  return items;
}

/**
 * Add a new .qml file to the nearest .qrc, from its own directory up, that lists QML
 * files: {file, what, edit}, or null.
 */
async function registerInQrc(chain, newPath, readFile) {
  if (familyOf(newPath) !== 'qml') return null;
  for (const { files } of chain) {
    const lists = [];
    for (const file of files.filter((f) => extOf(f) === '.qrc')) {
      const text = await readFile(file);
      if (text === null) continue;
      const items = qrcItems(text, path.dirname(file));
      if (items.some((item) => item.path && familyOf(item.path) === 'qml')) lists.push({ file, text, items, rank: 0 });
    }
    const best = bestList(lists, newPath);
    if (!best) continue;

    // After a QML file of its folder, else the last QML file: never among the images of another <qresource prefix>.
    const { file, text, items } = best.list;
    const qml = items.filter((item) => item.path && familyOf(item.path) === 'qml');
    const after = qml.filter((item) => key(path.dirname(item.path)) === key(path.dirname(newPath))).pop() || qml.pop();
    const element = '<file>' + relFrom(path.dirname(file), newPath).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</file>';
    const insert = startsLine(text, after.start) ? eolOf(text) + indentAt(text, after.start) + element : element;
    const open = text.lastIndexOf('<qresource', after.start);
    const resource = open === -1 ? null : /^<qresource\b[^>]*>/.exec(text.slice(open));
    return {
      file,
      what: resource ? 'to ' + resource[0] : element,
      edit: { start: after.end, end: after.end, text: insert }
    };
  }
  return null;
}

module.exports = { registerInQrc };
