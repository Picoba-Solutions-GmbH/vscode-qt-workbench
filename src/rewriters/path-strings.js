'use strict';

/**
 * File paths and qrc:/ URLs inside QML and C++ string literals.
 */

const vscode = require('vscode');
const path = require('path');
const { ASSET_EXT, isAbsolutePathLike, isUrlScheme, key, relFrom } = require('../paths');
const { collect } = require('../text');

/**
 * File paths inside string literals: Loader { source: "views/X.qml" },
 * Image { source: "images/logo.png" }, Qt.createComponent("..."), plus the
 * qrc:/ URLs that point into a qt_add_qml_module.
 */
async function rewritePathStrings(text, filePath, ctx) {
  const edits = [];
  const cfg = vscode.workspace.getConfiguration('qtWorkbench');
  const ownDir = path.dirname(filePath);
  const newOwnDir = path.dirname(ctx.mapPath(filePath));
  const re = new RegExp('(")([^"\\n]*\\.(?:' + ASSET_EXT + '))(")', 'gi');

  for (const hit of collect(text, re, 2)) {
    const raw = hit.raw;
    let newRaw = null;

    const resourceMatch = /^(qrc:\/{0,2}|:\/)(.*)$/i.exec(raw);
    if (resourceMatch) {
      if (!cfg.get('updateResourceUrls', true)) continue;
      newRaw = await remapResourceUrl(raw, resourceMatch, ctx);
    } else {
      if (isUrlScheme(raw) || isAbsolutePathLike(raw)) continue;
      const target = path.resolve(ownDir, raw);
      if (!(await ctx.exists(target))) continue;
      const candidate = relFrom(newOwnDir, ctx.mapPath(target));
      if (candidate !== raw) newRaw = candidate;
    }

    if (newRaw && newRaw !== raw) {
      edits.push({ start: hit.start, end: hit.end, text: newRaw });
    }
  }
  return edits;
}

/** Translate qrc:/qt/qml/<URI>/views/X.qml through the move, if we know the module. */
async function remapResourceUrl(raw, resourceMatch, ctx) {
  const scheme = resourceMatch[1];
  let body = resourceMatch[2];
  if (!body.startsWith('/')) body = '/' + body;

  for (const mod of ctx.qmlModules) {
    const prefix = '/qt/qml/' + mod.uri.split('.').join('/') + '/';
    if (!body.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const relInModule = body.slice(prefix.length);
    const onDisk = path.resolve(mod.dir, relInModule);
    if (!(await ctx.exists(onDisk))) continue;

    const moved = ctx.mapPath(onDisk);
    if (key(moved) === key(onDisk)) continue;

    const newRel = relFrom(mod.dir, moved);
    if (newRel.startsWith('..')) {
      ctx.warn(raw + ' now points outside the ' + mod.uri + ' module directory; left untouched.');
      return null;
    }
    const base = scheme.endsWith('/') ? scheme.slice(0, -1) : scheme;
    return base + prefix + newRel;
  }
  return null;
}

module.exports = { rewritePathStrings };
