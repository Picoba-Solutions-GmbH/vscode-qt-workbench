'use strict';

/**
 * What a debug configuration tells hot reload: where the program's QML debug server will
 * listen (its -qmljsdebugger argument, parsed the way QQmlDebugServer parses it) and
 * which build tree the program comes from.
 */

const fs = require('fs');
const path = require('path');

const MAX_PORTS = 64;
// Services that belong to the QML debugger. It connects to the same server, and the
// server takes one client at a time.
const DEBUGGER_SERVICES = new Set(['QmlDebugger', 'V8Debugger']);

/** The value of the -qmljsdebugger= argument in `args`, a list or a command line. */
function qmlDebuggerValue(args) {
  const list = Array.isArray(args) ? args : typeof args === 'string' ? [args] : [];
  for (const arg of list) {
    const m = /(?:^|\s)-qmljsdebugger=("?)([^\s"]+)\1/.exec(String(arg));
    if (m) return m[2];
  }
  return null;
}

/** -qmljsdebugger=host:127.0.0.1,port:3768[-3770],block,services:QmlPreview,DebugTranslation */
function parseQmlDebugger(value) {
  const result = { host: null, ports: [], block: false, file: null, services: [] };
  let inServices = false;
  for (const token of value.split(',')) {
    if (token.startsWith('port:')) {
      const m = /^port:(\d+)(?:-(\d+))?$/.exec(token);
      if (m) {
        const from = Number(m[1]);
        const to = Math.min(Number(m[2] || m[1]), from + MAX_PORTS - 1);
        for (let p = from; p <= to; p++) result.ports.push(p);
      }
    } else if (token.startsWith('host:')) {
      result.host = token.slice(5);
    } else if (token === 'block') {
      result.block = true;
    } else if (token.startsWith('file:')) {
      result.file = token.slice(5);
    } else if (token.startsWith('services:')) {
      inServices = true;
      result.services.push(token.slice(9));
    } else if (inServices && token) {
      result.services.push(token);
    }
  }
  return result;
}

/**
 * Whether hot reload should connect to the program a debug configuration starts.
 * Returns null when it has no -qmljsdebugger argument or does not ask for QmlPreview,
 * {skip: reason, block} when it asks but cannot be served, else {hosts, ports, block}.
 */
function previewTarget(configuration) {
  const value = qmlDebuggerValue(configuration && configuration.args);
  if (!value) return null;
  const parsed = parseQmlDebugger(value);
  if (!parsed.services.includes('QmlPreview')) return null;
  const block = parsed.block;
  if (parsed.services.some((s) => DEBUGGER_SERVICES.has(s))) {
    return { block, skip: 'it also enables the QML debugger (' + parsed.services.filter((s) => DEBUGGER_SERVICES.has(s)).join(', ') + '), which takes the only connection the application accepts' };
  }
  if (parsed.file) return { block, skip: 'file:' + parsed.file + ' makes the application connect out to a local socket; use host:127.0.0.1,port:<port> instead' };
  if (parsed.ports.length === 0) return { block, skip: 'no port:<port> in -qmljsdebugger=' + value };
  // Without host, with a wildcard, or with a name -- Qt only takes numeric addresses --
  // the server listens on every address, so this machine's loopback reaches it.
  const h = parsed.host;
  const everywhere = !h || h === '0.0.0.0' || h === '::' || !/^[\d.]+$|:/.test(h);
  const hosts = everywhere ? ['127.0.0.1', '::1'] : [h];
  return { hosts, ports: parsed.ports, block };
}

/** The build tree a program was built in: the nearest folder up holding CMakeCache.txt or .qmake.stash. */
function findBuildDir(program) {
  if (typeof program !== 'string' || !program) return null;
  let dir = path.dirname(path.resolve(program));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'CMakeCache.txt')) || fs.existsSync(path.join(dir, '.qmake.stash'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

module.exports = { qmlDebuggerValue, parseQmlDebugger, previewTarget, findBuildDir };
