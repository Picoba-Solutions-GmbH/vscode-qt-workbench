'use strict';

/**
 * Which debug sessions need their running program stopped for gdb, and what their launch
 * configuration gets.
 *
 * To change breakpoints in a running program, or pause it, the C/C++ extension (cppdbg)
 * sends gdb -exec-interrupt and waits for the program to stop. On Windows, gdb before 15
 * reads no command while the program runs -- the gdb 11.2 of Qt's MinGW among them -- so the
 * program never stops: new breakpoints stay "Attempting to bind" and Pause does nothing.
 */

const fs = require('fs');
const { execFile } = require('child_process');

// Checked against the C/C++ extension 1.34: gdb 15.1 and 17.1 stop the program themselves,
// 11.2 does not. 12 to 14 get the help too: when they stop the program themselves, the
// tracker sees it stopped and leaves it alone.
const FIRST_GDB_THAT_STOPS_ITSELF = 15;

// Once the program is stopped for it, gdb reads the -exec-interrupt it was sent, and sends
// the program a Ctrl+C. Ignored, that neither stops the program again nor reaches it.
const SIGINT_COMMAND = 'handle SIGINT nostop noprint nopass';

/** The gdb a cppdbg configuration runs on this Windows machine, or null for any other session. */
function localGdb(configuration, platform = process.platform) {
  if (platform !== 'win32' || !configuration || configuration.type !== 'cppdbg') return null;
  if (configuration.MIMode && configuration.MIMode !== 'gdb') return null;
  if (configuration.miDebuggerServerAddress || configuration.debugServerPath || configuration.pipeTransport || configuration.coreDumpPath) {
    return null;
  }
  return configuration.miDebuggerPath || 'gdb';
}

/** {major, minor, text} from the output of `gdb --version`, or null. */
function parseGdbVersion(output) {
  const line = String(output || '').split(/\r?\n/)[0].trim();
  const m = /^GNU gdb\b.*?(\d+)\.(\d+)/.exec(line);
  return m ? { major: Number(m[1]), minor: Number(m[2]), text: line } : null;
}

function runVersion(gdb) {
  return new Promise((resolve, reject) => {
    execFile(gdb, ['--version'], { timeout: 10000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const versions = new Map(); // gdb -> {mtimeMs, version: Promise}

/** The version of a gdb, asked once per executable and again when it changes; null when it doesn't run. */
function readGdbVersion(gdb, run = runVersion) {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(gdb).mtimeMs;
  } catch (_) {
    // found on PATH
  }
  const known = versions.get(gdb);
  if (known && known.mtimeMs === mtimeMs) return known.version;
  const version = Promise.resolve()
    .then(() => run(gdb))
    .then(parseGdbVersion, () => null);
  versions.set(gdb, { mtimeMs, version });
  return version;
}

function needsInterrupt(version) {
  return !!version && version.major < FIRST_GDB_THAT_STOPS_ITSELF;
}

/** The configuration with SIGINT_COMMAND added to its setupCommands; itself when it has it already. */
function withSigintIgnored(configuration) {
  const commands = Array.isArray(configuration.setupCommands) ? configuration.setupCommands : [];
  if (commands.some((c) => c && typeof c.text === 'string' && c.text.trim() === SIGINT_COMMAND)) return configuration;
  return {
    ...configuration,
    setupCommands: [
      ...commands,
      { description: 'Qt Workbench: ignore the Ctrl+C gdb sends after a stop for new breakpoints', text: SIGINT_COMMAND, ignoreFailures: true }
    ]
  };
}

module.exports = { SIGINT_COMMAND, localGdb, parseGdbVersion, readGdbVersion, needsInterrupt, withSigintIgnored };
