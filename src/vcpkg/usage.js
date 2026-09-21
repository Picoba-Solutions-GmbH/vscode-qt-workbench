'use strict';

/**
 * What vcpkg install says about using a port from CMake, and the recipes in it; vcpkg
 * print-usage prints the same for an installed port. vcpkg prints
 * the usage file a port installs as it is, and for a port without one the CMake targets it
 * finds in the port's files ("<port> provides CMake targets:", heuristically generated). A
 * usage often offers several ways, such as a library or its header-only version: each is a
 * recipe, find_package() and the like with the target_link_libraries(main ...) and the like
 * that use what it found. `main` stands for the target to use the port in.
 */

const { cmakeCommands } = require('../cmake-syntax');
const { escapeRe } = require('../text');

/** Commands that find what a target then uses. */
const FIND = /^(?:find_package|find_path|find_library|find_file|find_program|pkg_check_modules|pkg_search_module)$/;
/** Commands adding a list of items to a target. */
const ON_MAIN = /^target_(?:link_libraries|include_directories|compile_definitions|compile_options|compile_features|link_directories|link_options)$/;
const BLOCK = /^(?:if|elseif|else|endif|foreach|endforeach|while|endwhile|function|endfunction|macro|endmacro|block|endblock)$/;

const lines = (text) => String(text).split(/\r?\n/).map((line) => line.replace(/\s+$/, ''));

/**
 * The usage vcpkg printed for `port` in `output`, the output of vcpkg install. `usageFile` is
 * the text of the usage file the port installed, or null: when the output holds it, that is
 * the usage. Otherwise the CMake targets vcpkg found for the port, or null when it printed neither.
 */
function usageOf(port, output, usageFile) {
  const out = lines(output);
  if (typeof usageFile === 'string') {
    const file = lines(usageFile);
    while (file.length > 0 && file[0] === '') file.shift();
    while (file.length > 0 && file[file.length - 1] === '') file.pop();
    for (let i = 0; file.length > 0 && i + file.length <= out.length; i++) {
      if (file.every((line, k) => out[i + k] === line)) return file.join('\n');
    }
  }
  const heading = new RegExp('^' + escapeRe(port) + ' (?:provides CMake targets|is header-only and can be used from CMake via):$');
  const start = out.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < out.length && (out[end] === '' || /^[ \t]/.test(out[end]))) end++;
  return out.slice(start, end).join('\n').replace(/\n+$/, '');
}

/**
 * The lines of a usage text that are not blank, in order: {line} for a comment or a line of
 * text, trimmed, and {command} for a command, {name, text, args}: `name` lower case, `text` on
 * one line, `args` as cmakeCommands() gives them with offsets into `text`.
 */
function usageParts(usage) {
  const out = [];
  const all = lines(usage);
  for (let i = 0; i < all.length; i++) {
    const line = all[i].trim();
    if (line === '') continue;
    if (!/^[A-Za-z_]\w*[ \t]*\(/.test(line)) {
      out.push({ line });
      continue;
    }
    // A command runs to its closing parenthesis, over the lines that takes.
    let text = line;
    let [command] = cmakeCommands(text);
    while (command.close >= text.length && i + 1 < all.length) {
      text += ' ' + all[++i].trim();
      [command] = cmakeCommands(text);
    }
    out.push({ command: { name: command.name.toLowerCase(), text: text.slice(0, command.close + 1), args: command.args } });
  }
  return out;
}

const isOnMain = (command) => ON_MAIN.test(command.name) && command.args.length > 0 && command.args[0].text === 'main';

/**
 * The recipes of a usage text, in its order: [{label, commands, skipped}]. `commands` are its
 * find commands and the commands adding to `main`, as usageParts() gives them. `skipped` are
 * the other commands in it, such as enable_testing(). `label` is the comment or line of text
 * before it, without a trailing colon, or null.
 *
 * A recipe ends where a find command, a comment or a line of text follows a command adding to
 * `main`. One with no such command is no recipe -- set(nlohmann-json_IMPLICIT_CONVERSIONS OFF)
 * for a triplet file -- and neither is one with if() or another block: that one needs a person.
 */
function recipes(usage) {
  const found = [];
  let current = null;
  let label = null;
  const close = () => {
    if (current && !current.block && current.commands.some((c) => ON_MAIN.test(c.name))) {
      found.push({ label: current.label, commands: current.commands, skipped: current.skipped });
    }
    current = null;
  };
  for (const part of usageParts(usage)) {
    if (!part.command) {
      if (current && current.commands.some((c) => ON_MAIN.test(c.name))) close();
      if (!current) label = part.line.replace(/^#+\s*/, '').replace(/:$/, '') || label;
      continue;
    }
    const command = part.command;
    if (FIND.test(command.name) && current && current.commands.some((c) => ON_MAIN.test(c.name))) close();
    if (!current) {
      current = { label, commands: [], skipped: [], block: false };
      label = null;
    }
    if (BLOCK.test(command.name)) current.block = true;
    if (FIND.test(command.name) || isOnMain(command)) current.commands.push(command);
    else current.skipped.push(command.text);
  }
  close();
  return found;
}

/**
 * Every find command and command adding to `main` in a usage text, in its order, as
 * usageParts() gives them: those of every recipe, and those inside if() too.
 */
function usageCommands(usage) {
  return usageParts(usage)
    .map((part) => part.command)
    .filter((command) => command && (FIND.test(command.name) || isOnMain(command)));
}

module.exports = { FIND, ON_MAIN, usageOf, recipes, usageCommands };
