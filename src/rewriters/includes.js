'use strict';

/**
 * C/C++ #include "..." paths, including the files Qt generates from source names.
 */

const path = require('path');
const { HEADER_EXT, extOf, isAbsolutePathLike, key, relFrom } = require('../paths');
const { collect } = require('../text');

/**
 * C/C++ `#include "..."`.
 *
 * An include is resolved against the including file's directory first, then
 * against the project include roots -- Qt puts the target's source dir on the
 * include path, which is why `#include "apptheme.h"` resolves from
 * `singletons/apptheme.cpp`. The rewrite is expressed relative to whichever root
 * originally resolved it, so a root-relative include stays root-relative.
 */
async function rewriteIncludes(text, filePath, ctx) {
  const edits = [];
  const ownDir = path.dirname(filePath);
  const newOwnDir = path.dirname(ctx.mapPath(filePath));
  const re = /^([ \t]*#[ \t]*include[ \t]*")([^"\n]+)(")/gm;

  for (const hit of collect(text, re, 2)) {
    const raw = hit.raw;
    if (isAbsolutePathLike(raw)) continue;

    let matchedRoot = null;
    let target = null;
    for (const root of [ownDir, ...ctx.includeRoots]) {
      const candidate = path.resolve(root, raw);
      if (await ctx.exists(candidate)) {
        matchedRoot = root;
        target = candidate;
        break;
      }
    }
    // An include we cannot resolve on disk is one we must never guess at -- apart
    // from the files Qt generates from a source file's name.
    if (!target) {
      const generated = renameGeneratedInclude(raw, filePath, ctx);
      if (generated && generated !== raw) {
        edits.push({ start: hit.start, end: hit.end, text: generated });
      }
      continue;
    }

    const newTarget = ctx.mapPath(target);
    const newRoot = matchedRoot === ownDir ? newOwnDir : ctx.mapPath(matchedRoot);
    const newRaw = relFrom(newRoot, newTarget);
    if (newRaw !== raw) {
      edits.push({ start: hit.start, end: hit.end, text: newRaw });
    }
  }
  return edits;
}

/**
 * Includes of files Qt generates from a source file's name, which never exist in
 * the source tree: `foo.moc` (from the including foo.cpp itself), `moc_foo.cpp`
 * (from foo.h) and `ui_foo.h` (from foo.ui). They follow a rename of that source.
 * A header or form is matched when it sits next to the including file, or when it
 * is the only file of that name in the project.
 */
function renameGeneratedInclude(raw, filePath, ctx) {
  const slash = raw.lastIndexOf('/');
  const prefix = raw.slice(0, slash + 1);
  const name = raw.slice(slash + 1);

  let m = /^(\w+)\.moc$/.exec(name);
  if (m) {
    const newPath = ctx.mapPath(filePath);
    const oldBase = path.basename(filePath, path.extname(filePath));
    const newBase = path.basename(newPath, path.extname(newPath));
    return m[1] === oldBase && newBase !== oldBase ? prefix + newBase + '.moc' : null;
  }

  m = /^(moc_|ui_)(\w+)\.(cpp|h)$/.exec(name);
  if (!m) return null;
  const sourceExts = m[1] === 'moc_' ? HEADER_EXT : new Set(['.ui']);
  const sources = ctx.fileMoves.filter(
    (mv) => sourceExts.has(extOf(mv.oldPath)) && path.basename(mv.oldPath, path.extname(mv.oldPath)) === m[2]
  );
  let source = sources.find((mv) => key(path.dirname(mv.oldPath)) === key(path.dirname(filePath)));
  if (!source && sources.length === 1 && ctx.basenameCount.get(path.basename(sources[0].oldPath).toLowerCase()) === 1) {
    source = sources[0];
  }
  if (!source) return null;
  const newBase = path.basename(source.newPath, path.extname(source.newPath));
  return newBase === m[2] ? null : prefix + m[1] + newBase + '.' + m[3];
}

module.exports = { rewriteIncludes };
