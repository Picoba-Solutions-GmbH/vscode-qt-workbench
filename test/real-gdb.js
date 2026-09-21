'use strict';
// Checks breakpoints added while the program runs against a real gdb, the C/C++ extension's
// debug adapter and a real Qt application. Not part of run.sh: it needs all three. Run it
// after changing gdb-interrupt.js or gdb/, or for a new gdb or C/C++ extension version.
//
//   node test/real-gdb.js <program> <project folder> <source:line the program runs whenever its QML loads>
//
//   PATH="/c/Qt/6.11.2/mingw_64/bin:$PATH" node test/real-gdb.js D:/QT/Test/builds/qt-mingw-debug/appTest.exe D:/QT/Test viewmodels/basics.cpp:13
//
// The program must be built with QT_QML_DEBUG and find its Qt libraries. It is launched the
// way VS Code launches a cppdbg configuration with QML hot reload: through
// resolveDebugConfigurationWithSubstitutedVariables and the debug adapter tracker of
// src/gdb-interrupt.js, with every message passing the tracker. Hot reload makes the program
// load its QML again, which runs the line. Then, while the program runs: a breakpoint is added
// and must bind and hit, sent again unchanged, removed, and Pause must stop the program once.
// Environment:
//   GDB       gdb to use (default: Qt's MinGW gdb, C:/Qt/Tools/mingw1310_64/bin/gdb.exe)
//   ADAPTER   OpenDebugAD7.exe (default: the newest C/C++ extension in ~/.vscode/extensions)
//   SETTINGS  JSON of qtWorkbench.* overrides, e.g. {"gdbInterrupt":false} to see it fail
//   EXT_DIR   the extension to test (default: this one)

const Module = require('module');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const EXT_DIR = process.env.EXT_DIR || path.resolve(__dirname, '..');
const [PROGRAM, PROJECT, LOCATION] = process.argv.slice(2);
if (!LOCATION || !/:\d+$/.test(LOCATION)) {
  console.error('usage: node test/real-gdb.js <program> <project folder> <source:line>');
  process.exit(2);
}
const SOURCE = path.win32.normalize(path.resolve(PROJECT, LOCATION.replace(/:\d+$/, '')));
const LINE = Number(/:(\d+)$/.exec(LOCATION)[1]);
const GDB = process.env.GDB || 'C:/Qt/Tools/mingw1310_64/bin/gdb.exe';

function findAdapter() {
  if (process.env.ADAPTER) return process.env.ADAPTER;
  const dir = path.join(process.env.USERPROFILE || '', '.vscode', 'extensions');
  const cpptools = fs.readdirSync(dir).filter((d) => /^ms-vscode\.cpptools-\d/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (cpptools.length === 0) throw new Error('no C/C++ extension in ' + dir + '; set ADAPTER');
  return path.join(dir, cpptools[cpptools.length - 1], 'debugAdapters', 'bin', 'OpenDebugAD7.exe');
}

// --- the extension's gdb-interrupt.js behind a stubbed vscode --------------------------

const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
const SETTINGS = JSON.parse(process.env.SETTINGS || '{}');
const logLines = [];
const registered = {};
const vscode = {
  debug: {
    registerDebugConfigurationProvider: (type, provider) => { registered.provider = provider; return { dispose() {} }; },
    registerDebugAdapterTrackerFactory: (type, factory) => { registered.factory = factory; return { dispose() {} }; }
  },
  window: {
    createOutputChannel: () => ({ appendLine: (l) => { logLines.push(l); console.log('   [log] ' + l); }, show() {}, dispose() {} })
  },
  workspace: {
    getConfiguration: () => ({
      get: (k, d) => {
        if (k in SETTINGS) return SETTINGS[k];
        const p = MANIFEST.contributes.configuration.properties['qtWorkbench.' + k];
        return p ? p.default : d;
      }
    })
  }
};
const realRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  return id === 'vscode' ? vscode : realRequire.apply(this, arguments);
};
const subscriptions = [];
require(path.join(EXT_DIR, 'src/log.js')).log.init();
require(path.join(EXT_DIR, 'src/gdb-interrupt.js')).registerGdbInterrupt({ subscriptions });
const { ResourceTree, findBuildQrcFiles } = require(path.join(EXT_DIR, 'src/hot-reload/resource-tree'));
const { findBuildDir } = require(path.join(EXT_DIR, 'src/hot-reload/launch'));
const { HotReloadSession } = require(path.join(EXT_DIR, 'src/hot-reload/session'));

// --- checks ------------------------------------------------------------------------------

let pass = 0;
let fail = 0;
function check(what, ok) {
  if (ok) pass++;
  else fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + what);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
  const configuration = await registered.provider.resolveDebugConfigurationWithSubstitutedVariables(undefined, {
    name: 'real-gdb', type: 'cppdbg', request: 'launch',
    program: path.win32.normalize(path.resolve(PROGRAM)),
    args: ['-qmljsdebugger=host:127.0.0.1,port:' + port + ',block,services:QmlPreview'],
    stopAtEntry: false, cwd: path.win32.normalize(path.resolve(PROJECT)),
    MIMode: 'gdb', miDebuggerPath: GDB
  });
  const tracker = await registered.factory.createDebugAdapterTracker({ configuration });
  console.log('gdb: ' + GDB + (tracker ? ' (helped)' : ' (not helped)'));
  console.log('setupCommands: ' + JSON.stringify((configuration.setupCommands || []).map((c) => c.text)));

  const adapter = findAdapter();
  const da = spawn(adapter, [], { cwd: path.dirname(adapter) });
  let seq = 1;
  const pending = new Map();
  const events = [];
  const send = (message) => {
    if (tracker) tracker.onWillReceiveMessage(message);
    const body = JSON.stringify(message);
    da.stdin.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
  };
  const request = (command, args) => new Promise((resolve) => {
    const message = { seq: seq++, type: 'request', command, arguments: args };
    pending.set(message.seq, resolve);
    send(message);
  });
  let buffer = Buffer.alloc(0);
  da.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const header = buffer.indexOf('\r\n\r\n');
      if (header < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.slice(0, header).toString())[1]);
      if (buffer.length < header + 4 + length) return;
      const message = JSON.parse(buffer.slice(header + 4, header + 4 + length).toString());
      buffer = buffer.slice(header + 4 + length);
      if (tracker) tracker.onDidSendMessage(message);
      if (message.type === 'response') {
        const resolve = pending.get(message.request_seq);
        pending.delete(message.request_seq);
        if (resolve) resolve(message);
      } else if (message.type === 'event') {
        events.push(message);
        if (message.event === 'stopped') {
          const b = message.body;
          console.log('   [stopped] ' + b.reason + (b.source ? ' ' + path.basename(b.source.path || '') + ':' + b.line : ''));
        }
      }
    }
  });

  await request('initialize', { clientID: 'vscode', adapterID: 'cppdbg', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, locale: 'en' });
  const launched = request('launch', configuration);
  for (let i = 0; i < 600 && !events.some((e) => e.event === 'initialized'); i++) await sleep(50);
  await request('setExceptionBreakpoints', { filters: [] });
  await request('configurationDone', {});
  const launch = await launched;
  check('launched', launch.success);

  const build = findBuildDir(PROGRAM);
  const tree = new ResourceTree();
  for (const qrc of findBuildQrcFiles(build)) tree.addQrc(qrc);
  const session = new HotReloadSession({
    hosts: ['127.0.0.1'], ports: [port], block: true, resources: tree,
    sourceRoots: [path.resolve(PROJECT)], excludeRoots: [build], log: () => {}
  });
  session.start();
  for (let i = 0; i < 300 && !session.rootUrl; i++) await sleep(100);
  check('hot reload connected', session.state === 'connected');
  await sleep(3000);

  // Waits `ms`, continuing every stop; returns them as "reason file:line".
  let seen = 0;
  const settle = async (ms) => {
    const stops = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const all = events.filter((e) => e.event === 'stopped');
      while (seen < all.length) {
        const { body } = all[seen++];
        stops.push(body.reason + (body.source ? ' ' + path.basename(body.source.path || '') + ':' + body.line : ''));
        await request('continue', { threadId: body.threadId });
      }
      await sleep(50);
    }
    return stops;
  };
  const inSource = (stop) => stop.startsWith('breakpoint ' + path.basename(SOURCE) + ':');
  const source = { name: path.basename(SOURCE), path: SOURCE };
  const breaks = () => logLines.filter((l) => l.includes('stopped the running program')).length;

  console.log('--- a breakpoint added while the program runs');
  let before = breaks();
  await request('setBreakpoints', { source, breakpoints: [{ line: LINE }], sourceModified: false });
  let stops = await settle(3000);
  check('no stop but at the breakpoint: [' + stops + ']', stops.every(inSource));
  check('it binds', events.some((e) => e.event === 'breakpoint' && e.body.breakpoint.verified && !e.body.breakpoint.message));
  console.log('  (stopped by Qt Workbench: ' + (breaks() - before) + ')');
  session.reload(session.servedFiles(), { always: true });
  stops = await settle(5000);
  check('reloading the QML hits it: [' + stops + ']', stops.length > 0 && stops.every(inSource));
  stops = await settle(3000);
  check('no other stop afterwards: [' + stops + ']', stops.every(inSource));

  console.log('--- the same breakpoints again');
  before = breaks();
  await request('setBreakpoints', { source, breakpoints: [{ line: LINE }], sourceModified: false });
  stops = await settle(2000);
  check('the program is not stopped for nothing (' + (breaks() - before) + '): [' + stops + ']', breaks() === before && stops.every(inSource));

  console.log('--- the breakpoint removed while the program runs');
  await request('setBreakpoints', { source, breakpoints: [], sourceModified: false });
  stops = await settle(2000);
  check('no stop: [' + stops + ']', stops.length === 0);
  session.reload(session.servedFiles(), { always: true });
  stops = await settle(5000);
  check('reloading no longer stops: [' + stops + ']', stops.length === 0);

  console.log('--- Pause');
  await request('pause', { threadId: 1 });
  stops = await settle(3000);
  check('stops once: [' + stops + ']', stops.length === 1 && stops[0] === 'pause');
  stops = await settle(3000);
  check('runs on after Continue: [' + stops + ']', stops.length === 0);
  check('still running', !events.some((e) => e.event === 'exited' || e.event === 'terminated'));

  session.stop();
  await request('disconnect', { terminateDebuggee: true });
  if (tracker && tracker.onExit) tracker.onExit();
  for (const s of subscriptions) s.dispose();
  await sleep(1000);
  da.kill();
  console.log('PASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})();
