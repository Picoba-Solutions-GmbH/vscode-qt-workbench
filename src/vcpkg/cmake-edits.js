'use strict';

/**
 * The edits adding a recipe of vcpkg's usage (vcpkg/usage.js) to the CMakeLists.txt creating
 * a target, the target taking the place of vcpkg's `main`. Its find commands go after the
 * file's last find_package(), and its target_link_libraries(main ...) items and the like into
 * the target's own command of that name, laid out like it -- or into a new one after the last
 * command naming the target. What the file, or a CMakeLists.txt above it, has already is not
 * added again.
 *
 * And the edits taking a port's usage out of a project's CMakeLists.txt files again, when the
 * port is removed.
 */

const { COMMENT_ONLY, ON_TARGET, argumentRange, cmakeCommands, commandRange, commandsWithDepth } = require('../cmake-syntax');
const { joinEdits } = require('../json-syntax');
const { eolOf, indentAt, lineEndAt, lineRange, removalEdits, startsLine } = require('../text');
const { FIND, ON_MAIN } = require('./usage');

const CREATES = /^(?:(?:qt\d*_)?add_(?:executable|library)|qt\d*_add_(?:plugin|qml_module))$/i;
const SCOPE = /^(?:PRIVATE|PUBLIC|INTERFACE)$/;
// target_link_libraries also has the old keywords; a target's calls either all use keywords or none does.
const LINK_KEYWORD = /^(?:PRIVATE|PUBLIC|INTERFACE|LINK_PRIVATE|LINK_PUBLIC|LINK_INTERFACE_LIBRARIES)$/;
/** Flags before the items of a target command: target_include_directories(main SYSTEM BEFORE PRIVATE ...). */
const FLAG = /^(?:SYSTEM|BEFORE|AFTER)$/;
/** The commands find_package(PkgConfig) brings. */
const PKG_CONFIG = /^pkg_(?:check_modules|search_module)$/;

const isKeyword = (arg, re) => !arg.quoted && re.test(arg.text);
const isItem = (arg) => !isKeyword(arg, LINK_KEYWORD) && !isKeyword(arg, FLAG);
const raw = (text, arg) => text.slice(arg.start, arg.end);
/** Whether the command `a` of a file finds what the usage command `b` finds: the same command for the same package, whatever else it says. */
const same = (a, b) => a.name.toLowerCase() === b.name && Boolean(a.args[0] && b.args[0]) && a.args[0].text === b.args[0].text;
/** "a", "a and b", "a, b and c". */
const andList = (list) => (list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]);

/** The items of a usage command after `main`, by the keyword before them: [{scope, items}], `scope` null before any. */
function scopedItems(command) {
  const out = [];
  for (const arg of command.args.slice(1)) {
    if (isKeyword(arg, LINK_KEYWORD)) out.push({ scope: arg.text, items: [] });
    else if (out.length === 0) out.push({ scope: null, items: [raw(command.text, arg)] });
    else out[out.length - 1].items.push(raw(command.text, arg));
  }
  return out.filter((s) => s.items.length > 0);
}

/** Where an edit starting a new line after the argument ending at `offset` goes: past a comment ending its line. */
function newLineAt(text, offset) {
  const end = lineEndAt(text, offset);
  return /^[ \t]*(?:#(?!\[=*\[).*)?$/.test(text.slice(offset, end)) ? end : offset;
}

/**
 * The edit adding `items` to `command` (commandsWithDepth), in its `scope` section: after that
 * section's last item, or in a new section after its last argument. `scope` null adds them
 * after the last argument, for a target_link_libraries() without keywords.
 */
function addItems(text, command, scope, items) {
  const eol = eolOf(text);
  const args = command.args;
  // After `arg`: one item per line where it has a line of its own, else on its line.
  const after = (arg) => {
    if (!startsLine(text, arg.start) || arg === args[0]) return { start: arg.end, end: arg.end, text: ' ' + items.join(' ') };
    const at = newLineAt(text, arg.end);
    return { start: at, end: at, text: items.map((item) => eol + indentAt(text, arg.start) + item).join('') };
  };

  if (scope === null) return after(args[args.length - 1]);
  const keywords = args.map((arg, i) => ({ arg, i })).filter(({ arg, i }) => i > 0 && isKeyword(arg, LINK_KEYWORD));
  const own = keywords.filter(({ arg }) => arg.text === scope).pop();
  if (own) {
    const next = keywords.find(({ i }) => i > own.i);
    const section = args.slice(own.i + 1, next ? next.i : args.length);
    if (section.length === 0) return { start: own.arg.end, end: own.arg.end, text: ' ' + items.join(' ') };
    return after(section[section.length - 1]);
  }
  // A new section: on a line of its own where the last section or the last argument has one.
  const last = args[args.length - 1];
  const lastKeyword = keywords[keywords.length - 1];
  const line = scope + ' ' + items.join(' ');
  if (lastKeyword && startsLine(text, lastKeyword.arg.start)) {
    const at = newLineAt(text, last.end);
    return { start: at, end: at, text: eolOf(text) + indentAt(text, lastKeyword.arg.start) + line };
  }
  if (startsLine(text, last.start) && last !== args[0]) {
    const at = newLineAt(text, last.end);
    return { start: at, end: at, text: eolOf(text) + indentAt(text, last.start) + line };
  }
  return { start: last.end, end: last.end, text: ' ' + line };
}

/**
 * The edits adding `commands` -- recipe commands (usage.js) -- to the CMakeLists.txt `text`
 * for `target`, {name, projectName}: the target's name and the project() name in force where
 * it is created, for ${PROJECT_NAME}. `above` are the texts of the CMakeLists.txt files in the
 * folders above, whose find commands count as there.
 *
 * Returns {edits: [{start, end, text}], added, present, notes}: `added` and `present` the
 * commands as they now read in the file, `notes` why nothing could be added.
 */
function usageEdits(text, commands, target, above = []) {
  const result = { edits: [], added: [], present: [], notes: [] };
  const eol = eolOf(text);
  const all = commandsWithDepth(text);
  const names = (arg) => Boolean(arg) && (arg.text === target.name || (arg.text === '${PROJECT_NAME}' && target.projectName === target.name));
  const naming = all.filter((c) => ON_TARGET.test(c.name) && names(c.args[0]));
  if (naming.length === 0) {
    result.notes.push('no command in it names ' + target.name);
    return result;
  }
  const spelled = naming[0].args[0].text;
  /** The command at depth 0 holding `command`: itself, or the block it is in. */
  const outermost = (command) => all.slice(0, all.indexOf(command) + 1).reverse().find((c) => c.depth === 0);
  const edits = [];

  // Find commands, each once: after the last find_package(), else before the target is created.
  const known = [...all, ...above.flatMap((t) => cmakeCommands(t))];
  const finds = [];
  for (const command of commands.filter((c) => FIND.test(c.name))) {
    if (finds.some((f) => same(f, command)) || result.present.includes(command.text)) continue;
    if (known.some((c) => same(c, command))) result.present.push(command.text);
    else finds.push(command);
  }
  if (finds.length > 0) {
    const lastFind = all.filter((c) => c.depth === 0 && /^find_package$/i.test(c.name)).pop();
    if (lastFind) {
      const at = lineEndAt(text, lastFind.close);
      const indent = indentAt(text, lastFind.start);
      edits.push({ start: at, end: at, text: finds.map((c) => eol + indent + c.text).join('') });
    } else {
      const creating = naming.find((c) => CREATES.test(c.name)) || naming[0];
      const anchor = outermost(creating);
      const at = lineRange(text, anchor.start).start;
      const indent = indentAt(text, anchor.start);
      edits.push({ start: at, end: at, text: finds.map((c) => indent + c.text + eol).join('') + eol });
    }
    result.added.push(...finds.map((c) => c.text));
  }

  // Items for the target, by command and scope, each once.
  const groups = [];
  for (const command of commands.filter((c) => ON_MAIN.test(c.name))) {
    for (const { scope, items } of scopedItems(command)) {
      let group = groups.find((g) => g.name === command.name && g.scope === scope);
      if (!group) groups.push((group = { name: command.name, scope, items: [] }));
      for (const item of items) if (!group.items.includes(item)) group.items.push(item);
    }
  }
  // A new command goes after the last command naming the target, or after the block holding it.
  const blockEnd = (command) => all.slice(all.indexOf(command) + 1).find((c) => c.depth === 0) || command;
  const anchor = naming.map((c) => (c.depth === 0 ? c : blockEnd(c))).reduce((a, b) => (b.start > a.start ? b : a));
  const created = [];
  for (const group of groups) {
    const existing = all.filter((c) => c.name.toLowerCase() === group.name && names(c.args[0]));
    const listed = new Set(existing.flatMap((c) => c.args.slice(1).map((arg) => raw(text, arg))));
    const fresh = group.items.filter((item) => !listed.has(item));
    const shown = (items, scope) => group.name + '(' + spelled + (scope ? ' ' + scope : '') + ' ' + items.join(' ') + ')';
    const plain = group.name === 'target_link_libraries' && existing.length > 0 && !existing.some((c) => c.args.slice(1).some((a) => isKeyword(a, LINK_KEYWORD)));
    const scope = plain ? null : group.scope && SCOPE.test(group.scope) ? group.scope : 'PRIVATE';
    const there = group.items.filter((item) => listed.has(item));
    if (there.length > 0) result.present.push(shown(there, scope));
    if (fresh.length === 0) continue;
    const into = existing.filter((c) => c.depth === 0).pop();
    if (into) {
      edits.push(addItems(text, into, scope, fresh));
    } else {
      created.push(shown(fresh, scope));
    }
    result.added.push(shown(fresh, scope));
  }
  if (created.length > 0) {
    const at = lineEndAt(text, anchor.close);
    const indent = indentAt(text, anchor.start);
    edits.push({ start: at, end: at, text: eol + eol + created.map((line) => indent + line).join(eol) });
  }
  result.edits = joinEdits(edits);
  return result;
}

/**
 * The ranges taking the arguments `gone` out of `command` (cmakeCommands) in `text`: a line
 * whose arguments all go goes whole, else each goes with the space that set it apart.
 */
function argumentRanges(text, command, gone) {
  const lines = new Map();
  for (const arg of command.args) {
    const at = lineRange(text, arg.start).start;
    if (!lines.has(at)) lines.set(at, []);
    lines.get(at).push(arg);
  }
  const ranges = [];
  let keptBefore = null;
  for (const arg of command.args) {
    if (!gone.has(arg)) {
      keptBefore = arg;
      continue;
    }
    const line = lines.get(lineRange(text, arg.start).start);
    const last = line[line.length - 1];
    const whole = line.every((a) => gone.has(a)) && startsLine(text, line[0].start) && COMMENT_ONLY.test(text.slice(last.end, lineEndAt(text, last.end)));
    ranges.push(whole ? lineRange(text, arg.start) : argumentRange(text, command, arg, keptBefore));
  }
  return ranges;
}

/**
 * The edits taking a port's usage out of the CMakeLists.txt files `texts` of a project, when
 * the port is removed. `commands` are the find commands and the commands adding to `main` of
 * its usage (usage.js usageCommands). A find command goes where a file has it, whatever else
 * it says. The items of a command adding to `main` go from every command of that name, for
 * whatever target: with the keyword before them when they were all it had, and the whole
 * command when they were all of its items.
 *
 * What stays is what the usage of a port the project keeps has too -- `keep` [{port,
 * commands}], as `commands` -- and find_package(PkgConfig) while any file has a
 * pkg_check_modules() or pkg_search_module() left.
 *
 * Returns one {edits, removed, kept} for each text: `removed` what goes, as it reads -- a whole
 * command, or "<items> in <command>(<target>)" -- and `kept` [what, why] for what stays.
 */
function usageRemovals(texts, commands, keep = []) {
  const finds = commands.filter((c) => FIND.test(c.name));
  const items = new Map(); // command name -> the items of the usage's commands of that name
  for (const command of commands.filter((c) => ON_MAIN.test(c.name))) {
    if (!items.has(command.name)) items.set(command.name, new Set());
    for (const arg of command.args.slice(1).filter(isItem)) items.get(command.name).add(raw(command.text, arg));
  }
  const keptBy = (has) => keep.filter((k) => k.commands.some(has)).map((k) => k.port);
  const because = (ports) => andList(ports) + ', still in vcpkg.json, ' + (ports.length > 1 ? 'use' : 'uses') + ' it too';
  const oneLine = (text, command) => text.slice(command.start, command.close + 1).replace(/\s+/g, ' ');

  const files = texts.map((text) => ({ text, ranges: [], removed: [], kept: [], pkgConfig: [], pkgLeft: false }));
  for (const file of files) {
    const text = file.text;
    for (const command of cmakeCommands(text)) {
      const name = command.name.toLowerCase();
      if (FIND.test(name)) {
        const mine = finds.some((f) => same(command, f));
        const by = mine ? keptBy((k) => FIND.test(k.name) && same(command, k)) : [];
        if (PKG_CONFIG.test(name) && (!mine || by.length > 0)) file.pkgLeft = true;
        if (!mine) continue;
        if (by.length > 0) {
          file.kept.push([oneLine(text, command), because(by)]);
        } else if (name === 'find_package' && command.args[0].text === 'PkgConfig') {
          file.pkgConfig.push(command); // decided once every file is read
        } else {
          file.ranges.push(commandRange(text, command));
          file.removed.push(oneLine(text, command));
        }
        continue;
      }
      if (!items.has(name) || command.args.length < 2) continue;
      const args = command.args.slice(1);
      const gone = new Set();
      for (const arg of args.filter((a) => isItem(a) && items.get(name).has(raw(text, a)))) {
        const by = keptBy((k) => k.name === name && k.args.slice(1).some((a) => raw(k.text, a) === raw(text, arg)));
        if (by.length > 0) file.kept.push([raw(text, arg) + ' in ' + command.name + '(' + command.args[0].text + ')', because(by)]);
        else gone.add(arg);
      }
      if (gone.size === 0) continue;
      if (args.every((a) => !isItem(a) || gone.has(a))) {
        file.ranges.push(commandRange(text, command));
        file.removed.push(oneLine(text, command));
        continue;
      }
      file.removed.push([...gone].map((a) => raw(text, a)).join(' ') + ' in ' + command.name + '(' + command.args[0].text + ')');
      // A keyword whose items all go, goes with them.
      args.forEach((arg, i) => {
        if (!isKeyword(arg, LINK_KEYWORD)) return;
        const next = args.findIndex((a, j) => j > i && isKeyword(a, LINK_KEYWORD));
        const section = args.slice(i + 1, next === -1 ? args.length : next);
        if (section.length > 0 && section.every((a) => gone.has(a))) gone.add(arg);
      });
      file.ranges.push(...argumentRanges(text, command, gone));
    }
  }

  const pkgLeft = files.some((f) => f.pkgLeft);
  for (const file of files) {
    for (const command of file.pkgConfig) {
      if (pkgLeft) {
        file.kept.push([oneLine(file.text, command), 'a pkg_check_modules() or pkg_search_module() left needs it']);
      } else {
        file.ranges.push(commandRange(file.text, command));
        file.removed.push(oneLine(file.text, command));
      }
    }
  }
  return files.map((f) => ({ edits: removalEdits(f.ranges), removed: f.removed, kept: f.kept }));
}

module.exports = { usageEdits, usageRemovals };
