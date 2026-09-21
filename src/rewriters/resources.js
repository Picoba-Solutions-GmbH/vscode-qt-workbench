'use strict';

/**
 * .qrc resource files and resource references in .ui files: paths that follow a move, and
 * .qrc entries of deleted files.
 */

const vscode = require('vscode');
const path = require('path');
const { ASSET_EXT, isAbsolutePathLike, isUrlScheme, relFrom } = require('../paths');
const { collect, lineRange, removalEdits } = require('../text');

/** .qrc resource files, plus resource references inside .ui files. */
async function rewriteQrc(text, filePath, ctx) {
  const edits = [];
  const preserveAlias = vscode.workspace
    .getConfiguration('qtWorkbench')
    .get('qrcPreserveAlias', true);
  const dir = path.dirname(filePath);
  const newDir = path.dirname(ctx.mapPath(filePath));
  const re = /(<file\b[^>]*>)([^<\n]+)(<\/file>)/g;

  for (const hit of collect(text, re, 2)) {
    const raw = hit.raw.trim();
    const lead = hit.raw.length - hit.raw.replace(/^\s+/, '').length;
    const target = path.resolve(dir, raw);
    if (!(await ctx.exists(target))) continue;
    const newRaw = relFrom(newDir, ctx.mapPath(target));
    if (newRaw === raw) continue;

    edits.push({ start: hit.start + lead, end: hit.start + lead + raw.length, text: newRaw });

    const openTag = hit.match[1];
    if (preserveAlias && !/\balias\s*=/.test(openTag)) {
      // Keep the :/ URL stable by pinning the old path as the alias.
      const insertAt = hit.start - 1; // just before the closing > of <file ...>
      edits.push({ start: insertAt, end: insertAt, text: ' alias="' + raw + '"' });
    }
  }
  return edits;
}

/** location="x.qrc" / resource="x.qrc" attributes in .ui and other XML. */
async function rewriteXmlAttrPaths(text, filePath, ctx) {
  const edits = [];
  const dir = path.dirname(filePath);
  const newDir = path.dirname(ctx.mapPath(filePath));
  const re = new RegExp(
    '((?:location|resource|source|href|src)\\s*=\\s*")([^"\\n]*\\.(?:qrc|' + ASSET_EXT + '))(")',
    'gi'
  );
  for (const hit of collect(text, re, 2)) {
    const raw = hit.raw;
    if (isUrlScheme(raw) || isAbsolutePathLike(raw)) continue;
    const target = path.resolve(dir, raw);
    if (!(await ctx.exists(target))) continue;
    const newRaw = relFrom(newDir, ctx.mapPath(target));
    if (newRaw !== raw) edits.push({ start: hit.start, end: hit.end, text: newRaw });
  }
  return edits;
}

/** .qrc files: the <file> entries of deleted files go, with their line when they had one to themselves. */
function removeFromQrc(text, filePath, ctx) {
  const dir = path.dirname(filePath);
  const ranges = [];
  const re = /<file\b[^>]*>([^<\n]+)<\/file>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!ctx.isDeletedFile(path.resolve(dir, m[1].trim()))) continue;
    const line = lineRange(text, m.index);
    const end = m.index + m[0].length;
    const alone = /^[ \t]*$/.test(text.slice(line.start, m.index)) && /^[ \t]*\r?\n?$/.test(text.slice(end, line.end));
    ranges.push(alone ? line : { start: m.index, end });
  }
  return removalEdits(ranges);
}

module.exports = { rewriteQrc, rewriteXmlAttrPaths, removeFromQrc };
