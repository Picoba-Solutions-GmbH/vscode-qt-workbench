'use strict';

/**
 * Just enough C++ for class renames: where classes, structs and namespaces are
 * declared, and which of them QML knows by their C++ name.
 */

/**
 * QML_ELEMENT names a type after its class. These give it another name, or none,
 * or tie it to a type declared elsewhere -- a class carrying one of them keeps its
 * QML name when the class is renamed.
 */
const NOT_NAMED_AFTER_CLASS = new Set([
  'QML_NAMED_ELEMENT',
  'QML_ANONYMOUS',
  'QML_FOREIGN',
  'QML_FOREIGN_NAMESPACE',
  'QML_VALUE_TYPE',
  'QML_INTERFACE',
  'QML_SEQUENTIAL_CONTAINER'
]);

/** Offset just past the end of the line at `i`, following backslash continuations. */
function endOfDirective(text, i) {
  for (;;) {
    const nl = text.indexOf('\n', i);
    if (nl === -1) return text.length;
    const lineEnd = text[nl - 1] === '\r' ? nl - 1 : nl;
    if (text[lineEnd - 1] !== '\\') return nl;
    i = nl + 1;
  }
}

/**
 * Identifier and punctuation tokens of a C/C++ file, skipping comments, string and
 * character literals, and preprocessor lines. Tokens are {text, start, end}.
 */
function cppTokens(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  let atLineStart = true;

  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    const lineStart = atLineStart;
    atLineStart = false;

    if (lineStart && c === '#') {
      i = endOfDirective(text, i);
    } else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /\w/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (text[j] === '"' && /^(?:u8|u|U|L)?R$/.test(word)) {
        // raw string: R"delim( ... )delim"
        const paren = text.indexOf('(', j + 1);
        const delim = paren === -1 ? '' : text.slice(j + 1, paren);
        const close = paren === -1 ? -1 : text.indexOf(')' + delim + '"', paren);
        i = close === -1 ? n : close + delim.length + 2;
        continue;
      }
      out.push({ text: word, start: i, end: j });
      i = j;
    } else if (/[0-9]/.test(c)) {
      // 1'000'000 and 0x1Fu: a digit separator must not open a character literal
      while (i < n && /[\w.']/.test(text[i])) i++;
    } else {
      const len = c === ':' && text[i + 1] === ':' ? 2 : 1;
      out.push({ text: text.slice(i, i + len), start: i, end: i + len });
      i += len;
    }
  }
  return out;
}

/**
 * The class, struct and namespace definitions of a file, with the identifiers used
 * directly in their body (not inside a nested class or function):
 * [{kind, name, start, end, members}], where start/end are the offsets of the name.
 *
 * Export macros and attributes before the name (`class MYLIB_EXPORT Foo`,
 * `class [[deprecated]] Foo`), `final`, base clauses and nested names
 * (`namespace a::b`) are understood. Forward declarations, `enum class`,
 * `friend class` and template parameters define nothing and are not reported.
 */
function cppDeclarations(text) {
  const tokens = cppTokens(text);
  const decls = [];
  const open = []; // one entry per unclosed '{': the declaration it opened, or null
  const isIdent = (t) => /^[A-Za-z_]/.test(t);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.text === '{') {
      open.push(null);
      continue;
    }
    if (tok.text === '}') {
      open.pop();
      continue;
    }
    const inside = open.length > 0 ? open[open.length - 1] : null;
    if (inside && isIdent(tok.text)) inside.members.add(tok.text);

    const kind = tok.text;
    if (kind !== 'class' && kind !== 'struct' && kind !== 'namespace') continue;
    const prev = i > 0 ? tokens[i - 1].text : '';
    if (prev === 'enum' || prev === 'friend' || prev === '<' || prev === ',') continue;

    // The name is the last identifier before the base clause or the body.
    let name = null;
    let j = i + 1;
    for (; j < tokens.length; j++) {
      const t = tokens[j].text;
      if (t === '{' || t === ':') break;
      if (t === '[') {
        for (let depth = 0; j < tokens.length; j++) {
          if (tokens[j].text === '[') depth++;
          else if (tokens[j].text === ']' && --depth === 0) break;
        }
        continue;
      }
      if (t === '::' || t === 'final') continue;
      if (!isIdent(t)) {
        name = null;
        break;
      }
      name = tokens[j];
    }
    if (!name) continue;

    // Past the base clause to the body; reaching a ';' first means no definition.
    let body = j;
    while (body < tokens.length && tokens[body].text !== '{' && tokens[body].text !== ';') body++;
    if (body >= tokens.length || tokens[body].text !== '{') continue;

    const decl = { kind, name: name.text, start: name.start, end: name.end, members: new Set() };
    decls.push(decl);
    open.push(decl);
    i = body;
  }
  return decls;
}

/**
 * Definitions QML knows under their C++ name: a class or struct with QML_ELEMENT,
 * or a namespace with Q_NAMESPACE and QML_ELEMENT.
 */
function qmlNamedDeclarations(text) {
  if (!text.includes('QML_ELEMENT')) return [];
  return cppDeclarations(text).filter(
    (d) => d.members.has('QML_ELEMENT') && ![...d.members].some((m) => NOT_NAMED_AFTER_CLASS.has(m))
  );
}

module.exports = { cppDeclarations, qmlNamedDeclarations };
