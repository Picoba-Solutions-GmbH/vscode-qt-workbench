'use strict';

/**
 * Where a new file goes among the lists that could hold it. A list is a run of items --
 * the arguments of a CMake command, the values of a qmake variable, the <file> entries
 * of a .qrc -- each {start, end, text, quoted, path}, where `path` is the file the item
 * names, or null when it names none (`${PROJECT_SOURCES}`, `URI`).
 */

const path = require('path');
const { HEADER_EXT, extOf, isCppFile, key } = require('../paths');

/** 'qml' for a .qml file, 'cpp' for C/C++ sources and headers, null for anything else. */
function familyOf(p) {
  if (extOf(p) === '.qml') return 'qml';
  return isCppFile(p) ? 'cpp' : null;
}

function stemKey(p) {
  return key(path.join(path.dirname(p), path.basename(p, path.extname(p))));
}

/** How many leading path segments two directories share. */
function commonDepth(a, b) {
  const x = key(a).split(path.sep);
  const y = key(b).split(path.sep);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/**
 * How well `items` suit `newPath`, and where in them it goes.
 *
 *   score  [partner listed, listed files of its directory, depth of the closest listed
 *          file] -- the partner being foo.cpp for a new foo.h, in the same directory
 *   after  the item to insert after: the partner; else the last file of its directory,
 *          when that directory's files are listed together; else the last item
 *   like   the item whose spelling (quotes, ${CMAKE_CURRENT_SOURCE_DIR}/) to copy
 */
function placement(items, newPath) {
  const family = familyOf(newPath);
  const dir = key(path.dirname(newPath));
  const own = [];
  items.forEach((item, index) => {
    if (item.path && familyOf(item.path) === family) own.push({ item, index });
  });
  const siblings = own.filter(({ item }) => key(path.dirname(item.path)) === dir);
  const partner =
    family === 'cpp'
      ? siblings.find(
          ({ item }) =>
            stemKey(item.path) === stemKey(newPath) && HEADER_EXT.has(extOf(item.path)) !== HEADER_EXT.has(extOf(newPath))
        )
      : undefined;
  const depth = own.reduce(
    (d, { item }) => Math.max(d, commonDepth(path.dirname(item.path), path.dirname(newPath))),
    -1
  );

  const lastSibling = siblings[siblings.length - 1];
  const together = lastSibling && lastSibling.index - siblings[0].index === siblings.length - 1;
  let after = items.length > 0 ? items[items.length - 1] : null;
  if (partner) after = partner.item;
  else if (together) after = lastSibling.item;

  const like = partner || lastSibling || own[own.length - 1];
  return { score: [partner ? 1 : 0, siblings.length, depth], after, like: like ? like.item : null };
}

/**
 * The list of `lists` -- each {items, rank} -- that suits `newPath` best, with its
 * placement: {list, placement}, or null when there are none. Equal scores go to the
 * lower rank, then to the earlier list.
 */
function bestList(lists, newPath) {
  let best = null;
  for (const list of lists) {
    const p = placement(list.items, newPath);
    const score = p.score.concat([-list.rank]);
    const i = best ? score.findIndex((v, k) => v !== best.score[k]) : -1;
    if (!best || (i !== -1 && score[i] > best.score[i])) best = { list, placement: p, score };
  }
  return best && { list: best.list, placement: best.placement };
}

module.exports = { familyOf, placement, bestList };
