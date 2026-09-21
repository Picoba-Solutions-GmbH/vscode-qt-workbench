'use strict';

/**
 * JSON with offsets: every value knows where it starts and ends in the text, so an edit
 * can replace one value or add after another and leave the rest of the file as written.
 *
 *   {type: 'object', start, end, members: [{key, keyStart, value}]}
 *   {type: 'array', start, end, items: [value]}
 *   {type: 'string' | 'number' | 'boolean' | 'null', start, end, value}
 *
 * Strict JSON by default, as CMake reads CMakePresets.json. With {comments: true}, // and
 * block comments and trailing commas too, as VS Code reads launch.json. A byte-order mark
 * before the value is skipped.
 */

function parseJson(text, options = {}) {
  const comments = Boolean(options.comments);
  let i = 0;

  const fail = (what) => {
    const line = text.slice(0, i).split('\n').length;
    throw new SyntaxError(what + ' at line ' + line);
  };
  const skipSpace = () => {
    for (;;) {
      while (i < text.length && /[ \t\r\n]/.test(text[i])) i++;
      if (!comments || text[i] !== '/') return;
      if (text[i + 1] === '/') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl;
      } else if (text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        if (close === -1) fail('unclosed comment');
        i = close + 2;
      } else {
        return;
      }
    }
  };
  const expect = (c) => {
    if (text[i] !== c) fail(i < text.length ? 'expected ' + c : 'unexpected end');
    i++;
  };

  function string() {
    const start = i;
    expect('"');
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++;
      else if (text.charCodeAt(i) < 0x20) fail('control character in a string');
      i++;
    }
    expect('"');
    let value;
    try {
      value = JSON.parse(text.slice(start, i));
    } catch (_) {
      i = start;
      fail('invalid string');
    }
    return { type: 'string', start, end: i, value };
  }

  /** After a comma: true when a trailing comma, allowed with comments, closes the list with `close`. */
  function closesAfterComma(close) {
    skipSpace();
    if (!comments || text[i] !== close) return false;
    i++;
    return true;
  }

  function value() {
    skipSpace();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const members = [];
      skipSpace();
      if (text[i] === '}') {
        i++;
        return { type: 'object', start, end: i, members };
      }
      for (;;) {
        skipSpace();
        if (text[i] !== '"') fail('expected a property name');
        const key = string();
        skipSpace();
        expect(':');
        members.push({ key: key.value, keyStart: key.start, value: value() });
        skipSpace();
        if (text[i] === ',') {
          i++;
          if (closesAfterComma('}')) return { type: 'object', start, end: i, members };
          continue;
        }
        expect('}');
        return { type: 'object', start, end: i, members };
      }
    }
    if (c === '[') {
      i++;
      const items = [];
      skipSpace();
      if (text[i] === ']') {
        i++;
        return { type: 'array', start, end: i, items };
      }
      for (;;) {
        items.push(value());
        skipSpace();
        if (text[i] === ',') {
          i++;
          if (closesAfterComma(']')) return { type: 'array', start, end: i, items };
          continue;
        }
        expect(']');
        return { type: 'array', start, end: i, items };
      }
    }
    if (c === '"') return string();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail(i < text.length ? 'unexpected ' + JSON.stringify(c) : 'unexpected end');
    i += m[0].length;
    const type = m[0] === 'null' ? 'null' : m[0] === 'true' || m[0] === 'false' ? 'boolean' : 'number';
    return { type, start, end: i, value: JSON.parse(m[0]) };
  }

  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const root = value();
  skipSpace();
  if (i < text.length) fail('unexpected text after the value');
  return root;
}

/** The plain JavaScript value of a node. */
function plain(node) {
  if (node.type === 'object') return Object.fromEntries(node.members.map((m) => [m.key, plain(m.value)]));
  if (node.type === 'array') return node.items.map(plain);
  return node.value;
}

/** The member of an object node named `key` (the last one, as JSON.parse keeps), or undefined. */
function member(node, key) {
  if (!node || node.type !== 'object') return undefined;
  for (let k = node.members.length - 1; k >= 0; k--) if (node.members[k].key === key) return node.members[k];
  return undefined;
}

/** The same JSON, whatever the order of its object keys. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function lineIndent(text, offset) {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, offset))[0];
}

function startsLine(text, offset) {
  return /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset));
}

/** `edits` ({start, end, text}) in order, an insertion right where the edit before it ends joined to it, so they can't be applied in the wrong order. */
function joinEdits(edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = sorted.length - 1; i > 0; i--) {
    if (sorted[i].start === sorted[i].end && sorted[i].start === sorted[i - 1].end) {
      sorted[i - 1] = { ...sorted[i - 1], text: sorted[i - 1].text + sorted[i].text };
      sorted.splice(i, 1);
    }
  }
  return sorted;
}

/**
 * The edits adding objects to lists of the JSON object `root` parsed from `text`. `lists` is
 * [[name, objects]]: each object goes by its `name` field. One of the same name that is
 * already the same stays; one that differs is replaced where it stands; the others go after
 * the last item of the list, which is added at the end of `root` when missing. The new text is
 * laid out like the file: its indentation and line breaks.
 *
 * Returns {edits, [name]: {added, replaced, unchanged}} with the names of the objects.
 * Throws a SyntaxError when a list is not one.
 */
function addToLists(text, root, lists) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const first = root.members[0];
  const unit = first && startsLine(text, first.keyStart) && lineIndent(text, first.keyStart) ? lineIndent(text, first.keyStart) : '  ';
  const format = (value, indent) => JSON.stringify(value, null, unit).split('\n').join(eol + indent);

  const edits = [];
  const result = { edits };
  const newLists = [];
  for (const [name, objects] of lists) {
    const list = member(root, name);
    if (list && list.value.type !== 'array') throw new SyntaxError(name + ' is no list');
    const items = list ? list.value.items : [];
    const outcome = { added: [], replaced: [], unchanged: [] };
    result[name] = outcome;
    const fresh = [];
    for (const object of objects) {
      const same = items.find((item) => {
        const n = member(item, 'name');
        return n && n.value.value === object.name;
      });
      if (!same) {
        fresh.push(object);
        outcome.added.push(object.name);
      } else if (canonical(plain(same)) === canonical(object)) {
        outcome.unchanged.push(object.name);
      } else {
        edits.push({ start: same.start, end: same.end, text: format(object, lineIndent(text, same.start)) });
        outcome.replaced.push(object.name);
      }
    }
    if (fresh.length === 0) continue;
    if (!list) {
      newLists.push([name, fresh]);
    } else if (items.length > 0) {
      const last = items[items.length - 1];
      const indent = startsLine(text, last.start) ? lineIndent(text, last.start) : lineIndent(text, list.keyStart) + unit;
      edits.push({ start: last.end, end: last.end, text: fresh.map((o) => ',' + eol + indent + format(o, indent)).join('') });
    } else {
      const outer = lineIndent(text, list.keyStart);
      const inner = outer + unit;
      const body = fresh.map((o) => inner + format(o, inner)).join(',' + eol);
      edits.push({ start: list.value.start + 1, end: list.value.end - 1, text: eol + body + eol + outer });
    }
  }

  if (newLists.length > 0) {
    const last = root.members[root.members.length - 1];
    const indent = last && startsLine(text, last.keyStart) ? lineIndent(text, last.keyStart) : unit;
    const members = newLists.map(([name, fresh]) => {
      const body = fresh.map((o) => indent + unit + format(o, indent + unit)).join(',' + eol);
      return indent + JSON.stringify(name) + ': [' + eol + body + eol + indent + ']';
    });
    if (last) edits.push({ start: last.value.end, end: last.value.end, text: members.map((m) => ',' + eol + m).join('') });
    else edits.push({ start: root.start + 1, end: root.end - 1, text: eol + members.join(',' + eol) + eol });
  }
  result.edits = joinEdits(edits);
  return result;
}

module.exports = { parseJson, plain, member, canonical, joinEdits, addToLists };
