'use strict';
// Checks QML hot reload against a real Qt application, which fake-qml-app.js only imitates.
// Not part of run.sh: it needs a Qt build. Run it after changing hot-reload/ or Qt versions.
//
//   node test/real-app.js <program> <project folder> <QML file to change, relative>
//
//   node test/real-app.js D:/QT/Test/builds/qt-mingw-debug/appTest.exe D:/QT/Test views/TasksView.qml
//
// The program must be built with QT_QML_DEBUG and find its Qt libraries (put Qt's bin on
// PATH). It is started twice, with and without -qmljsdebugger=...,block, and given the
// project's QML through HotReloadSession, the way the extension does -- except that the
// files served are copies in a temporary folder, so the project itself is never written.
// Each run changes the file twice, then breaks and restores it, and checks what the
// application printed. Environment: EXT_DIR, the extension to test (default: this one).

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const EXT_DIR = process.env.EXT_DIR || path.resolve(__dirname, '..');
const { findBuildDir } = require(path.join(EXT_DIR, 'src/hot-reload/launch'));
const { ResourceTree, findBuildQrcFiles } = require(path.join(EXT_DIR, 'src/hot-reload/resource-tree'));
const { HotReloadSession } = require(path.join(EXT_DIR, 'src/hot-reload/session'));

const [PROGRAM, PROJECT, CHANGE] = process.argv.slice(2).map((a, i) => (i < 2 ? path.resolve(a) : a));
if (!CHANGE) {
  console.error('usage: node test/real-app.js <program> <project folder> <QML file to change, relative>');
  process.exit(2);
}
const BUILD = findBuildDir(PROGRAM);
if (!BUILD) {
  console.error('no CMakeCache.txt or .qmake.stash above ' + PROGRAM);
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(what, ok, detail) {
  if (ok) pass++;
  else fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || !detail ? '' : '\n       ' + detail));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The build tree's resources, with every file of the project replaced by a copy in `copies`. */
function copiedResources(copies) {
  const built = new ResourceTree();
  for (const qrc of findBuildQrcFiles(BUILD)) built.addQrc(qrc);
  const tree = new ResourceTree();
  for (const [resource, file] of built.files) {
    const rel = path.relative(PROJECT, file);
    const inProject = !rel.startsWith('..') && !path.isAbsolute(rel) && path.relative(BUILD, file).startsWith('..');
    if (!inProject) {
      tree.add(resource, file);
      continue;
    }
    const copy = path.join(copies, rel);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(file, copy);
    tree.add(resource, copy);
  }
  return tree;
}

/** The file with a child object that prints `marker` when created, after the root object's opening line. */
function withMarker(text, marker) {
  const root = /^[A-Z][\w.]*\s*\{[ \t]*\r?$/m.exec(text);
  if (!root) throw new Error('no root object found in ' + CHANGE);
  const at = root.index + root[0].length;
  return text.slice(0, at) + '\n    QtObject { Component.onCompleted: console.log("' + marker + '") }' + text.slice(at);
}

async function run(block) {
  console.log('== ' + (block ? 'with' : 'without') + ' block ==');
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'qml-hot-reload-'));
  const tree = copiedResources(copies);
  const changed = path.join(copies, CHANGE);
  check(CHANGE + ' is compiled in', fs.existsSync(changed), 'not among the resources of ' + BUILD);
  if (!fs.existsSync(changed)) return;
  const original = fs.readFileSync(changed, 'utf8');

  const port = await freePort();
  const output = [];
  const app = spawn(PROGRAM, ['-qmljsdebugger=host:127.0.0.1,port:' + port + ',' + (block ? 'block,' : '') + 'services:QmlPreview'], {
    env: { ...process.env, QT_FORCE_STDERR_LOGGING: '1' }
  });
  const collect = (chunk) => output.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  app.stdout.on('data', collect);
  app.stderr.on('data', collect);
  const printed = (text) => output.filter((l) => l.includes(text)).length;

  const errors = [];
  const session = new HotReloadSession({
    hosts: ['127.0.0.1'],
    ports: [port],
    block,
    resources: tree,
    sourceRoots: [copies],
    excludeRoots: [BUILD],
    log: (line) => process.env.VERBOSE && console.log('       ' + line)
  });
  session.on('appError', (message) => errors.push(message));
  session.start();

  try {
    const until = Date.now() + 20000;
    while (session.state !== 'connected' && Date.now() < until) await sleep(100);
    check('connects', session.state === 'connected', 'application output:\n' + output.join('\n'));
    if (session.state !== 'connected') return;
    await sleep(block ? 4000 : 3000);
    check('the application runs', app.exitCode === null, 'exited with ' + app.exitCode + ':\n' + output.join('\n'));
    if (block) check('the root component was named by its first request', !!session.rootUrl, 'no QML file requested');
    else check('no QML file served before the first reload', session.servedFiles().every((f) => !f.endsWith('.qml')));

    for (const n of [1, 2]) {
      const marker = 'HOT-RELOAD-MARKER-' + n;
      fs.writeFileSync(changed, withMarker(original, marker));
      const result = session.reload([changed]);
      check('reload ' + n + ' sent', result && !result.error, JSON.stringify(result));
      await sleep(3000);
      check('reload ' + n + ' shows the change', printed(marker) >= 1, 'application output:\n' + output.slice(-20).join('\n'));
    }

    fs.writeFileSync(changed, original.replace(/\{/, '{ this is not QML'));
    session.reload([changed]);
    await sleep(3000);
    check('a syntax error is reported', errors.length > 0, 'no error from the application');
    check('and the application keeps running', app.exitCode === null);

    const before = errors.length;
    fs.writeFileSync(changed, withMarker(original, 'HOT-RELOAD-MARKER-RESTORED'));
    session.reload([changed]);
    await sleep(3000);
    check('restoring it reloads again', printed('HOT-RELOAD-MARKER-RESTORED') >= 1 && errors.length === before, errors.slice(before).join('\n'));
  } finally {
    session.stop();
    app.kill();
    await sleep(500);
    fs.rmSync(copies, { recursive: true, force: true });
  }
}

(async () => {
  await run(true);
  await run(false);
  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})();
