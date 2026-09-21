'use strict';

/**
 * CMakeLists.txt, *.cmake and qmake project files: paths that follow a move, and entries
 * that go when their file is deleted.
 */

const vscode = require('vscode');
const path = require('path');
const { argumentRange, cmakeArgPath, cmakeCommands, commandRange, isCMakeKeyword } = require('../cmake-syntax');
const { extOf, relFrom, toPosix } = require('../paths');
const { qmakeAssignments, qmakeValuePath } = require('../qmake-syntax');
const { blockRange, collect, escapeRe, lineRange, removalEdits } = require('../text');

/**
 * CMakeLists.txt / *.cmake / *.pro / *.pri.
 *
 * These list sources as paths relative to the file's own directory, so every
 * moved file is a straight token substitution. Bare tokens are matched with a
 * strict boundary so `basics.h` never matches the tail of `viewmodels/basics.h`.
 */
async function rewriteBuildFile(text, filePath, ctx) {
  const edits = [];
  const dir = path.dirname(filePath);
  const newDir = path.dirname(ctx.mapPath(filePath));
  const flags = process.platform === 'win32' ? 'gi' : 'g';

  if (ctx.moves(filePath)) {
    ctx.warn(
      path.basename(filePath) +
        ' itself moved; only the moved entries were rewritten. Check its other relative paths.'
    );
  }

  for (const mv of ctx.fileMoves) {
    const oldRel = relFrom(dir, mv.oldPath);
    const newRel = relFrom(newDir, mv.newPath);
    if (oldRel === newRel) continue;

    const spellings = [oldRel];
    const backslashed = oldRel.split('/').join('\\');
    if (backslashed !== oldRel) spellings.push(backslashed);

    for (const spelling of spellings) {
      // bare or quoted token: views/X.qml, "views/X.qml", (views/X.qml)
      const bare = new RegExp(
        '(^|[\\s"\'()])(' + escapeRe(spelling) + ')(?=$|[\\s"\'()])',
        flags + 'm'
      );
      for (const hit of collect(text, bare, 2)) {
        edits.push({ start: hit.start, end: hit.end, text: newRel });
      }

      // ${CMAKE_CURRENT_SOURCE_DIR}/views/X.qml and friends
      const prefixed = new RegExp(
        '(\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}[\\\\/])(' + escapeRe(spelling) + ')(?=$|[\\s"\'()])',
        flags
      );
      for (const hit of collect(text, prefixed, 2)) {
        edits.push({ start: hit.start, end: hit.end, text: newRel });
      }
    }
  }
  return edits;
}

/** Commands whose file arguments are lists an entry can leave without breaking the call. */
const CMAKE_LISTS =
  /^(?:set|list|source_group|install|target_sources|add_executable|add_library|set_property|set_source_files_properties|qt\d*_\w+)$/;

/** Commands that only test for a file; a deleted one does no harm there. */
const CMAKE_CONDITIONS = /^(?:if|elseif|while)$/;

/** The arguments a command means nothing without, or null when it stands on its own. */
function requiredFiles(name, args) {
  const until = (from, stop) => {
    const rest = args.slice(from);
    const i = rest.findIndex((a) => !a.quoted && stop.test(a.text));
    return i === -1 ? rest : rest.slice(0, i);
  };
  if (name === 'set_source_files_properties') return until(0, /^(?:PROPERTIES|DIRECTORY|TARGET_DIRECTORY)$/);
  if (name === 'set_property' && args.length > 0 && args[0].text === 'SOURCE') {
    return until(1, /^(?:PROPERTY|APPEND|APPEND_STRING|DIRECTORY|TARGET_DIRECTORY)$/);
  }
  if (name === 'target_sources') return args.slice(1).filter((a) => !isCMakeKeyword(a));
  if (name === 'list' && args.length > 0 && /^(?:APPEND|PREPEND|REMOVE_ITEM)$/.test(args[0].text)) return args.slice(2);
  return null;
}

/**
 * CMakeLists.txt / *.cmake: every argument naming a deleted file goes from the lists
 * that hold it. A command left without the files it exists for goes entirely --
 * set_source_files_properties(Theme.qml ...), a target_sources with no sources --
 * as does add_subdirectory of a deleted directory and include() of a deleted file.
 * Anywhere else a deleted file is named, removing it could break the call, so that
 * is left alone with a warning.
 */
function removeFromCMake(text, filePath, ctx) {
  const dir = path.dirname(filePath);
  const ranges = [];

  for (const command of cmakeCommands(text)) {
    const name = command.name.toLowerCase();
    const args = command.args;
    if ((name === 'add_subdirectory' || name === 'include') && args.length > 0) {
      const target = cmakeArgPath(dir, args[0]);
      if (target && (name === 'include' ? ctx.isDeletedFile(target) : ctx.isDeletedDir(target))) {
        ranges.push(commandRange(text, command));
      }
      continue;
    }

    const gone = new Set(args.filter((a) => cmakeArgPath(dir, a) !== null && ctx.isDeletedFile(cmakeArgPath(dir, a))));
    if (gone.size === 0 || CMAKE_CONDITIONS.test(name)) continue;
    if (!CMAKE_LISTS.test(name)) {
      const first = [...gone][0];
      ctx.warn(
        toPosix(vscode.workspace.asRelativePath(filePath)) + ':' + text.slice(0, first.start).split('\n').length +
          ' still names ' + first.text + ' in ' + command.name + '(), and it was deleted. Fix that by hand.'
      );
      continue;
    }

    const required = requiredFiles(name, args);
    if (required && required.every((a) => gone.has(a))) {
      ranges.push(commandRange(text, command));
      continue;
    }
    let kept = null;
    for (const arg of args) {
      if (gone.has(arg)) ranges.push(argumentRange(text, command, arg, kept));
      else kept = arg;
    }
  }
  return removalEdits(ranges);
}

/** The range taking out one qmake value with the space that set it apart. */
function valueRange(text, item) {
  const before = text.slice(lineRange(text, item.start).start, item.start);
  const spaceBefore = /[ \t]*$/.exec(before)[0].length;
  if (spaceBefore > 0 && spaceBefore < before.length) return { start: item.start - spaceBefore, end: item.end };
  return { start: item.start, end: item.end + /^[ \t]*/.exec(text.slice(item.end))[0].length };
}

/**
 * *.pro / *.pri: values naming a deleted file or directory go from every assignment --
 * SOURCES, HEADERS, FORMS, RESOURCES, DISTFILES, SUBDIRS -- a value on a continued line
 * with its line, and an assignment left empty with its lines. `include()` of a deleted
 * .pri goes too.
 */
function removeFromQmake(text, filePath, ctx) {
  const dir = path.dirname(filePath);
  const ranges = [];
  const gone = (value) => {
    const p = qmakeValuePath(dir, value);
    return p !== null && (ctx.isDeletedFile(p) || ctx.isDeletedDir(p));
  };

  for (const assignment of qmakeAssignments(text)) {
    if (assignment.operator === '~=') continue; // a regular expression, not a list of values
    const dropped = new Set(assignment.items.filter((item) => gone(item.text)));
    if (dropped.size === 0) continue;
    if (dropped.size === assignment.items.length) {
      ranges.push(blockRange(text, assignment.start, assignment.end));
      continue;
    }

    const removedLines = new Set();
    assignment.lines.forEach((line, n) => {
      const values = assignment.items.filter((item) => item.line === n);
      if (n > 0 && values.length > 0 && values.every((item) => dropped.has(item))) {
        removedLines.add(n);
        ranges.push(lineRange(text, line.start));
      } else {
        for (const item of values.filter((v) => dropped.has(v))) ranges.push(valueRange(text, item));
      }
    });
    // With its last line gone, the continuation before it would swallow whatever follows.
    let last = assignment.lines.length - 1;
    if (removedLines.has(last)) {
      while (removedLines.has(last)) last--;
      const backslash = assignment.lines[last].backslash;
      if (backslash) ranges.push(backslash);
    }
  }

  const include = /^[ \t]*include[ \t]*\([ \t]*"?([^")\n]+?)"?[ \t]*\)[ \t]*(?:#.*)?\r?$/gm;
  let m;
  while ((m = include.exec(text)) !== null) {
    const target = qmakeValuePath(dir, m[1]);
    if (target && ctx.isDeletedFile(target)) ranges.push(lineRange(text, m.index));
  }
  return removalEdits(ranges);
}

/** A build file's entries for deleted files, removed: see removeFromCMake and removeFromQmake. */
function removeFromBuildFile(text, filePath, ctx) {
  const cmake = path.basename(filePath).toLowerCase() === 'cmakelists.txt' || extOf(filePath) === '.cmake';
  return cmake ? removeFromCMake(text, filePath, ctx) : removeFromQmake(text, filePath, ctx);
}

module.exports = { rewriteBuildFile, removeFromBuildFile };
