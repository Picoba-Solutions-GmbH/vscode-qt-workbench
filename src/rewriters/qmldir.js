'use strict';

/**
 * Hand-written qmldir files: entries that follow a move, and entries of deleted files.
 */

const vscode = require('vscode');
const path = require('path');
const { key, relFrom, toPosix } = require('../paths');
const { collect, lineRange, removalEdits } = require('../text');

/**
 * Hand-written qmldir files: [singleton] Type 1.0 Path.qml. The path follows the
 * file, and a type name spelled the same as the file follows a rename of it.
 */
async function rewriteQmldir(text, filePath, ctx) {
  const edits = [];
  const dir = path.dirname(filePath);
  const newDir = path.dirname(ctx.mapPath(filePath));
  const re =
    /^([ \t]*(?:singleton[ \t]+|internal[ \t]+)?)([A-Za-z_]\w*)([ \t]+(?:\d+\.\d+[ \t]+)?)(\S+\.(?:qml|js))[ \t]*$/gm;

  for (const hit of collect(text, re, 4)) {
    const target = path.resolve(dir, hit.raw);
    if (!(await ctx.exists(target))) continue;

    const typeName = hit.match[2];
    const rename = ctx.typeRenames.find((r) => key(r.oldPath) === key(target));
    if (rename && rename.oldName === typeName) {
      const nameStart = hit.match.index + hit.match[1].length;
      edits.push({ start: nameStart, end: nameStart + typeName.length, text: rename.newName });
    }

    const newRaw = relFrom(newDir, ctx.mapPath(target));
    if (newRaw === hit.raw) continue;
    if (newRaw.startsWith('..')) {
      ctx.warn(
        hit.raw +
          ' moved outside the directory of ' +
          toPosix(vscode.workspace.asRelativePath(filePath)) +
          '; a qmldir cannot reference it. Fix that entry by hand.'
      );
      continue;
    }
    edits.push({ start: hit.start, end: hit.end, text: newRaw });
  }
  return edits;
}

/** Hand-written qmldir files: the type entries of deleted files go. */
function removeFromQmldir(text, filePath, ctx) {
  const dir = path.dirname(filePath);
  const ranges = [];
  const re = /^[ \t]*(?:singleton[ \t]+|internal[ \t]+)?[A-Za-z_]\w*(?:[ \t]+\d+\.\d+)?[ \t]+(\S+\.(?:qml|js))[ \t]*\r?$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (ctx.isDeletedFile(path.resolve(dir, m[1]))) ranges.push(lineRange(text, m.index));
  }
  return removalEdits(ranges);
}

module.exports = { rewriteQmldir, removeFromQmldir };
