'use strict';

/**
 * QML type names that follow a .qml file rename or a C++ class rename, in QML and in
 * type-name strings.
 */

const vscode = require('vscode');
const path = require('path');
const { extOf, key, toPosix } = require('../paths');
const { parseQmlImports, qmlIdentifiers } = require('../qml-syntax');

/**
 * A .qml file's name *is* its type name, so renaming BasicsView.qml to
 * TestView.qml renames the type, and every identifier that resolves to that file
 * follows: `BasicsView {}`, `property BasicsView page`, `W.BasicsView {}`,
 * `BasicsView.SomeEnum`.
 *
 * A file resolves the name to the renamed file when it can see that file through
 *   - its own directory (same folder, no import needed),
 *   - a directory import, under that import's qualifier,
 *   - membership of the same qt_add_qml_module (a module's files see each other),
 *   - an `import <URI>` of that module, under its qualifier.
 * A C++ class registered with QML_ELEMENT is seen through the last two only: it has
 * no directory a QML file could import.
 *
 * If another file of the same name is visible the same way, the reference is
 * ambiguous and left alone with a warning. Comments, strings and member accesses
 * like `root.BasicsView` are never touched.
 *
 * Returns the edits and the names renamed in this file, which the import logic
 * needs to judge which directories the file still uses.
 */
function renameTypeReferences(text, filePath, ctx) {
  const result = { edits: [], renamed: new Map() };
  if (ctx.typeRenames.length === 0 || extOf(filePath) !== '.qml') return result;

  const ownDir = path.dirname(filePath);
  const ownModule = ctx.qmlModuleMembers.get(key(filePath));
  const imports = parseQmlImports(text);
  let tokens = null;

  for (const r of ctx.typeRenames) {
    if (!new RegExp('\\b' + r.oldName + '\\b').test(text)) continue;
    const oldDirKey = r.modules ? null : key(path.dirname(r.oldPath));

    // Qualifiers under which the old name means the renamed type ('' = unqualified).
    const qualifiers = new Set();
    if (key(ownDir) === oldDirKey) qualifiers.add('');
    for (const imp of imports.dirs) {
      if (key(path.resolve(ownDir, imp.raw)) === oldDirKey) qualifiers.add(imp.qualifier);
    }
    for (const theirModule of ctx.typeModules(r)) {
      if (ownModule === theirModule) qualifiers.add('');
      for (const imp of imports.modules) {
        if (imp.uri === theirModule) qualifiers.add(imp.qualifier);
      }
    }
    if (qualifiers.size === 0) continue;

    const others = [...(ctx.typeIndexBefore.get(r.oldName) || new Map()).keys()].filter((k) => k !== oldDirKey);
    const clash = others.some(
      (dirKey) =>
        (dirKey === key(ownDir) && qualifiers.has('')) ||
        imports.dirs.some(
          (imp) => key(path.resolve(ownDir, imp.raw)) === dirKey && qualifiers.has(imp.qualifier)
        )
    );
    if (clash) {
      ctx.warn(
        r.oldName + ' in ' + toPosix(vscode.workspace.asRelativePath(filePath)) +
          ' could mean more than one ' + (r.modules ? 'type' : 'file') + '; rename its references there by hand.'
      );
      continue;
    }

    tokens = tokens || qmlIdentifiers(text);
    for (const tok of tokens) {
      if (tok.name !== r.oldName) continue;
      const qualifier = tok.dotted ? tok.qualifier : '';
      if (qualifier === null || !qualifiers.has(qualifier)) continue;
      result.edits.push({ start: tok.start, end: tok.end, text: r.newName });
      result.renamed.set(r.oldName, r.newName);
    }
  }
  return result;
}

/**
 * Type names passed as strings: engine.loadFromModule("Test", "Main") in C++ and
 * Qt.createComponent("Test", "BasicsView") in QML. Renaming Main.qml without this
 * leaves the application unable to start.
 */
function rewriteModuleTypeStrings(text, filePath, ctx) {
  const edits = [];
  if (ctx.typeRenames.length === 0) return edits;

  const literal = '(?:QStringLiteral\\s*\\(\\s*|QLatin1String(?:View)?\\s*\\(\\s*|u8?|L)?"';
  const re = new RegExp(
    '\\b(?:loadFromModule|createComponent)\\s*\\(\\s*' + literal + '([\\w.]+)"\\s*\\)?\\s*(?:_s|_L1)?' +
      '\\s*,\\s*' + literal + '(\\w+)"',
    'g'
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const r = ctx.typeRenames.find((t) => t.oldName === m[2] && ctx.typeModules(t).includes(m[1]));
    if (!r) continue;
    const closingQuote = m.index + m[0].length - 1;
    edits.push({ start: closingQuote - m[2].length, end: closingQuote, text: r.newName });
  }
  return edits;
}

module.exports = { renameTypeReferences, rewriteModuleTypeStrings };
