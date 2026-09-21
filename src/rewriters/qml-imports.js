'use strict';

/**
 * QML directory imports that follow the types a file uses.
 */

const path = require('path');
const { extOf, isUrlScheme, key, relFrom } = require('../paths');
const { importInsertOffset } = require('../qml-syntax');
const { collect, lineRange } = require('../text');

/**
 * QML directory imports, kept in step with where the types a file uses live.
 *
 * Every `import "dir"` is judged by one question: after this move, does `dir`
 * still hold a type this file uses?
 *
 *   - It lost them all  -> the import is removed. If one of those types now
 *                          needs an import of its own, the line is repointed
 *                          in place instead (views -> pages).
 *   - It still has some -> the import stays, rebased if the file or the
 *                          directory itself moved.
 *
 * Any type the file used that is no longer in a directory it can see gets a new
 * import. A rewrite that would duplicate an existing import, or that points at
 * the file's own directory, removes the line instead.
 *
 * Imports that had nothing to do with this move are never touched: removal needs
 * the directory to have lost a type this file used, or to have been emptied.
 */
async function rewriteQmlImports(text, filePath, ctx, renamed = new Map()) {
  if (extOf(filePath) !== '.qml') return [];

  const ownDir = path.dirname(filePath);
  const newOwnDir = path.dirname(ctx.mapPath(filePath));
  const re = /^([ \t]*import[ \t]+")([^"\n]+)("[^\n]*)/gm;

  // Capitalised identifiers in the file, as spelled now and as they will be spelled
  // once this file's references to renamed types have been updated.
  const identsBefore = new Set(text.match(/\b[A-Z][A-Za-z0-9_]*\b/g) || []);
  const identsAfter = new Set([...identsBefore].map((t) => renamed.get(t) || t));
  const typesIn = (index, idents, dir) =>
    [...idents].filter((t) => index.has(t) && index.get(t).has(key(dir)));

  const imports = [];
  for (const hit of collect(text, re, 2)) {
    if (isUrlScheme(hit.raw)) continue;
    const dirBefore = path.resolve(ownDir, hit.raw);
    const qualifier = /^"[ \t]*as[ \t]+(\w+)/.exec(hit.match[3]);
    imports.push({
      hit,
      qualifier: qualifier ? qualifier[1] : '',
      dirBefore,
      dirAfter: ctx.mapPath(dirBefore),
      isDir: await ctx.isDirectory(dirBefore),
      action: 'keep', // keep | rewrite | remove
      reason: null, // why a remove happened: 'unused' may be repointed, 'redundant' may not
      newRaw: hit.raw
    });
  }

  // 1. Directories that no longer hold anything this file uses.
  for (const imp of imports) {
    if (!imp.isDir) continue;
    const usedBefore = typesIn(ctx.typeIndexBefore, identsBefore, imp.dirBefore);
    const usedAfter = typesIn(ctx.typeIndexAfter, identsAfter, imp.dirAfter);
    const emptied =
      (ctx.qmlCountBefore.get(key(imp.dirBefore)) || 0) > 0 &&
      (ctx.qmlCountAfter.get(key(imp.dirAfter)) || 0) === 0;
    if ((usedBefore.length > 0 || emptied) && usedAfter.length === 0) {
      // A qmldir can declare types under names that are not file names, so a
      // directory with one is never judged unused.
      if (await ctx.exists(path.join(imp.dirBefore, 'qmldir'))) continue;
      imp.action = 'remove';
      imp.reason = 'unused';
    }
  }

  // 2. Everything else follows the file and the directory to their new places.
  //    Unchanged imports claim their spot first, so a rewritten one that lands
  //    on an existing import is the one that goes.
  const visibleAfter = new Set([key(newOwnDir) + '|']);
  const isVisible = (dir, q) => visibleAfter.has(key(dir) + '|' + q);
  for (const imp of imports) {
    if (imp.action === 'remove') continue;
    imp.newRaw = relFrom(newOwnDir, imp.dirAfter);
    if (imp.isDir && imp.newRaw === imp.hit.raw) visibleAfter.add(key(imp.dirAfter) + '|' + imp.qualifier);
  }
  for (const imp of imports) {
    if (imp.action === 'remove' || imp.newRaw === imp.hit.raw) continue;
    if (imp.isDir && isVisible(imp.dirAfter, imp.qualifier)) {
      imp.action = 'remove';
      imp.reason = 'redundant';
    } else {
      imp.action = 'rewrite';
      if (imp.isDir) visibleAfter.add(key(imp.dirAfter) + '|' + imp.qualifier);
    }
  }

  // 3. Types this file used that it can no longer see. The destination is where
  //    the very file it resolved to went, so a type name that also exists
  //    elsewhere can never send the import to the wrong place.
  const visibleBefore = [{ dir: ownDir, qualifier: '' }].concat(
    imports.filter((i) => i.isDir).map((i) => ({ dir: i.dirBefore, qualifier: i.qualifier }))
  );
  const missing = new Map(); // dirKey|qualifier -> {dir, qualifier, fromKey}
  for (const typeName of identsBefore) {
    if (typeName === path.basename(filePath, '.qml')) continue;
    const beforeDirs = ctx.typeIndexBefore.get(typeName);
    if (!beforeDirs) continue;
    for (const vb of visibleBefore) {
      if (!beforeDirs.has(key(vb.dir))) continue;
      // Types behind a qmldir are declared there; the qmldir rewriter owns them.
      if (await ctx.exists(path.join(vb.dir, 'qmldir'))) continue;
      // Follow the very file the name resolved to -- it may have moved, been
      // renamed, or both -- and look it up under the name it has afterwards.
      const newFile = ctx.mapPath(path.join(beforeDirs.get(key(vb.dir)), typeName + '.qml'));
      const newDir = path.dirname(newFile);
      const k = key(newDir) + '|' + vb.qualifier;
      if (visibleAfter.has(k)) continue;
      const afterDirs = ctx.typeIndexAfter.get(path.basename(newFile, path.extname(newFile))) || new Map();
      if ([...afterDirs.keys()].some((d) => visibleAfter.has(d + '|' + vb.qualifier))) continue;
      missing.set(k, { dir: newDir, qualifier: vb.qualifier, fromKey: key(vb.dir) });
      visibleAfter.add(k); // one import serves every type that went there
    }
  }

  // 4. Repoint an unused import at the directory its own types moved to, so the
  //    import keeps its place in the file rather than being dropped and re-added.
  for (const imp of imports) {
    if (imp.reason !== 'unused') continue;
    for (const [k, m] of missing) {
      if (m.qualifier !== imp.qualifier || m.fromKey !== key(imp.dirBefore)) continue;
      missing.delete(k);
      imp.action = 'rewrite';
      imp.reason = null;
      imp.newRaw = relFrom(newOwnDir, m.dir);
      break;
    }
  }

  // 5. A file whose imports this move already edits also loses exact duplicates
  //    (same directory, same qualifier). They are no-ops in QML, and without this
  //    a file damaged by an older version of this extension would never heal.
  const editsImports =
    missing.size > 0 ||
    imports.some((i) => i.action === 'remove' || (i.action === 'rewrite' && i.newRaw !== i.hit.raw));
  if (editsImports) {
    const seen = new Set();
    for (const imp of imports) {
      if (!imp.isDir || imp.action === 'remove') continue;
      const k = key(path.resolve(newOwnDir, imp.newRaw)) + '|' + imp.qualifier;
      if (seen.has(k)) {
        imp.action = 'remove';
        imp.reason = 'duplicate';
      } else {
        seen.add(k);
      }
    }
  }

  const edits = [];
  const removedLineStarts = new Set();
  for (const imp of imports) {
    if (imp.action === 'rewrite' && imp.newRaw !== imp.hit.raw) {
      edits.push({ start: imp.hit.start, end: imp.hit.end, text: imp.newRaw });
    } else if (imp.action === 'remove') {
      const range = lineRange(text, imp.hit.start);
      removedLineStarts.add(range.start);
      edits.push({ start: range.start, end: range.end, text: '' });
    }
  }

  if (missing.size > 0) {
    const at = importInsertOffset(text, removedLineStarts);
    const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const lines = [...missing.values()].map(
      (m) => eol + 'import "' + relFrom(newOwnDir, m.dir) + '"' + (m.qualifier ? ' as ' + m.qualifier : '')
    );
    edits.push({ start: at, end: at, text: lines.join('') });
  }
  return edits;
}

module.exports = { rewriteQmlImports };
