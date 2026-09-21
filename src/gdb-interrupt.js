'use strict';

/**
 * Breakpoints added while the program runs, and Pause, for C/C++ extension (cppdbg) debug
 * sessions whose gdb can't stop a running program itself: gdb before 15 on Windows, like the
 * gdb 11.2 of Qt's MinGW. Their launch configuration gets gdb to ignore Ctrl+C, and a debug
 * adapter tracker stops the program when gdb doesn't. The parts that need no VS Code are in gdb/.
 */

const vscode = require('vscode');
const { log } = require('./log');
const { BreakHelper } = require('./gdb/break-helper');
const { InterruptTracker } = require('./gdb/interrupt-tracker');
const { SIGINT_COMMAND, localGdb, needsInterrupt, readGdbVersion, withSigintIgnored } = require('./gdb/launch');

let helper = null; // shared by the sessions being helped
let helped = 0;

function enabled() {
  return vscode.workspace.getConfiguration('qtWorkbench').get('gdbInterrupt', true);
}

/** The version of the session's gdb when it needs the help, else null. */
async function gdbToHelp(configuration) {
  if (!enabled()) return null;
  const gdb = localGdb(configuration);
  if (!gdb) return null;
  const version = await readGdbVersion(gdb);
  return needsInterrupt(version) ? version : null;
}

const configurationProvider = {
  async resolveDebugConfigurationWithSubstitutedVariables(folder, configuration) {
    const version = await gdbToHelp(configuration);
    if (!version) return configuration;
    const resolved = withSigintIgnored(configuration);
    log.header('debug session "' + configuration.name + '": ' + version.text);
    log.appendLine('  this gdb cannot stop the running program for new breakpoints or Pause: Qt Workbench stops it');
    if (resolved !== configuration) log.appendLine('  added to setupCommands: ' + SIGINT_COMMAND);
    return resolved;
  }
};

function releaseHelper() {
  helped--;
  if (helped === 0 && helper) {
    helper.dispose();
    helper = null;
  }
}

const trackerFactory = {
  async createDebugAdapterTracker(session) {
    const version = await gdbToHelp(session.configuration);
    if (!version) return undefined;
    if (!helper) {
      helper = new BreakHelper();
      // PowerShell takes a moment to start: have it ready before the first breakpoint.
      helper.start().then((problem) => {
        if (problem) log.appendLine('  ! cannot stop a running program, breakpoints added while it runs may not bind: ' + problem);
      });
    }
    helped++;
    const tracker = new InterruptTracker({
      helper,
      gdb: 'gdb ' + version.major + '.' + version.minor,
      log: (line) => log.appendLine(line)
    });
    let released = false;
    return {
      onWillReceiveMessage: (message) => tracker.onWillReceiveMessage(message),
      onDidSendMessage: (message) => tracker.onDidSendMessage(message),
      onExit: () => {
        if (released) return;
        released = true;
        releaseHelper();
      }
    };
  }
};

function registerGdbInterrupt(context) {
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('cppdbg', configurationProvider),
    vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', trackerFactory),
    {
      dispose() {
        if (helper) helper.dispose();
        helper = null;
        helped = 0;
      }
    }
  );
}

module.exports = { registerGdbInterrupt };
