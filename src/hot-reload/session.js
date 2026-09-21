'use strict';

/**
 * Hot reload for one running application. Keeps trying its QML debug server until the
 * application listens, answers the preview service's requests from the project's files,
 * and on reload sends the files that changed and has the root component created again.
 *
 * Knows nothing of VS Code, so the tests can drive it against a real application.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { QmlDebugConnection } = require('./debug-connection');
const { QmlPreviewClient } = require('./preview-client');
const { isResourcePath, resourcePath } = require('./resource-tree');
const { key } = require('../paths');

const RETRY_MS = 300;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

function isInside(file, dir) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digest(contents) {
  return crypto.createHash('sha1').update(contents).digest('hex');
}

class HotReloadSession extends EventEmitter {
  /**
   * @param {object} options
   * @param {string[]} options.hosts        addresses to try in turn ("localhost" can be either family)
   * @param {number[]} options.ports        ports to try in turn (-qmljsdebugger=port:from-to)
   * @param {ResourceTree} options.resources what the application has compiled in
   * @param {string[]} options.sourceRoots  folders whose files are served when read from disk
   * @param {string[]} options.excludeRoots folders never served from disk, e.g. the build tree
   * @param {boolean} [options.block]       started with -qmljsdebugger=...,block: it waits for us before loading
   * @param {string} [options.rootUrl]      the root component, when known up front
   * @param {(line: string) => void} [options.log]
   *
   * Events: 'state' (connecting | connected | stopped), 'appError' (message from the
   * application, e.g. a QML syntax error after a reload).
   */
  constructor(options) {
    super();
    this.hosts = options.hosts;
    this.ports = options.ports;
    this.resources = options.resources;
    this.sourceRoots = options.sourceRoots || [];
    this.excludeRoots = options.excludeRoots || [];
    this.block = !!options.block;
    this.log = options.log || (() => {});
    this.state = 'stopped';
    this.connection = null;
    this.client = null;
    this.reconnecting = false; // a connection came and went: the application no longer waits for us
    this.served = new Map(); // key(file on disk) -> {file, paths: Set of paths it was served as}
    this.sent = new Map(); // key(file on disk) -> digest of the contents the application last got
    this.rootUrl = options.rootUrl || null;
    // Whether the service knows its root component on this connection. It takes the first
    // .qml file it is sent as the root and replaces the scene with it, so until it knows,
    // only a file that really is the root may be sent.
    this.rootKnown = false;
    this.requests = 0;
  }

  get endpoint() {
    return this.hosts[0] + ':' + this.ports.join(',');
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }

  start() {
    if (this.state !== 'stopped') return;
    this.stopped = false;
    this.run();
  }

  stop() {
    this.stopped = true;
    if (this.connection) this.connection.close();
    this.setState('stopped');
  }

  async run() {
    this.setState('connecting');
    let attempt = 0;
    let lastFailure = '';
    while (!this.stopped) {
      const host = this.hosts[attempt % this.hosts.length];
      const port = this.ports[attempt % this.ports.length];
      attempt++;
      const connection = new QmlDebugConnection();
      const client = new QmlPreviewClient();
      connection.addService(client);
      // Before connecting: the application's first requests can come in the same packet
      // as its answer to the hello.
      this.prepare(client);
      this.connection = connection;
      const closed = new Promise((resolve) => connection.once('close', resolve));
      let services;
      try {
        services = await connection.connect(host, port);
      } catch (err) {
        const failure = String(err && err.code ? err.code : err && err.message);
        if (failure !== lastFailure && !/ECONNREFUSED|EADDRNOTAVAIL/.test(failure)) {
          this.log('  waiting for ' + host + ':' + port + ': ' + failure);
        }
        lastFailure = failure;
        this.connection = null;
        await delay(RETRY_MS);
        continue;
      }
      if (this.stopped) {
        connection.close();
        break;
      }
      if (!services.has('QmlPreview')) {
        this.log('  ' + host + ':' + port + ' offers no QmlPreview service (it has: ' + ([...services.keys()].join(', ') || 'none') + ')');
        this.emit('appError', 'The application offers no QmlPreview debug service. Start it with -qmljsdebugger=...,services:QmlPreview.');
        connection.close();
        this.stop();
        break;
      }

      this.client = client;
      this.log('  connected to ' + host + ':' + port);
      this.setState('connected');
      await closed;
      this.client = null;
      this.connection = null;
      this.reconnecting = true;
      if (this.stopped) break;
      this.log('  connection to ' + host + ':' + port + ' closed, waiting for the application again');
      this.setState('connecting');
      attempt = 0;
      lastFailure = '';
    }
    this.setState('stopped');
  }

  /** A connection attempt starts afresh: nothing sent yet, root not named. */
  prepare(client) {
    this.served.clear();
    this.sent.clear();
    this.rootKnown = false;
    client.on('request', (p) => this.answer(client, p));
    client.on('appError', (message) => {
      this.log('  application: ' + message);
      this.emit('appError', message);
    });
  }

  /** What the application finds at a path it reads: a file or directory of ours, or null to read its own. */
  lookup(requestPath) {
    if (isResourcePath(requestPath)) return this.resources.lookup(requestPath);
    const file = path.resolve(requestPath);
    if (!this.sourceRoots.some((r) => isInside(file, r)) || this.excludeRoots.some((r) => isInside(file, r))) return null;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (_) {
      return null;
    }
    if (stat.isDirectory()) return { kind: 'directory', entries: fs.readdirSync(file).sort() };
    return { kind: 'file', file };
  }

  answer(client, requestPath) {
    this.requests++;
    const found = this.lookup(requestPath);
    if (found && found.kind === 'directory') {
      client.sendDirectory(requestPath, found.entries);
      return;
    }
    let contents = found ? this.read(found.file) : null;
    if (contents && requestPath.endsWith('.qml') && !this.rootKnown) {
      if (this.block && !this.reconnecting) {
        // The application waited for us, so the first QML file its engine reads is the
        // root component it was asked to load.
        this.rootUrl = this.urlOf(requestPath);
        this.rootKnown = true;
        this.log('  root component: ' + this.rootUrl);
      } else {
        // Connected while the application was already running: this could be any
        // component, and sending it would make it the root. It keeps its own copy.
        contents = null;
      }
    }
    if (!contents) {
      client.sendError(requestPath);
      return;
    }
    client.sendFile(requestPath, contents);
    const k = key(found.file);
    if (!this.served.has(k)) this.served.set(k, { file: found.file, paths: new Set() });
    this.served.get(k).paths.add(requestPath);
    this.sent.set(k, digest(contents));
  }

  read(file) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
      return fs.readFileSync(file);
    } catch (_) {
      return null;
    }
  }

  urlOf(requestPath) {
    return isResourcePath(requestPath) ? 'qrc:' + resourcePath(requestPath) : pathToFileURL(requestPath).href;
  }

  /** Without a root seen yet (no "block"), a module's Main.qml is the best guess. */
  guessRootUrl() {
    const mains = this.resources.resources().filter((r) => /\/main\.qml$/i.test(r));
    return mains.length === 1 ? 'qrc:' + mains[0] : null;
  }

  /** The paths the application knows a file on disk by. */
  pathsOf(file) {
    const served = this.served.get(key(file));
    const paths = new Set(served ? served.paths : []);
    for (const r of this.resources.resourcesOf(file)) paths.add(':' + r);
    return paths;
  }

  /** The files on disk the application got from us on this connection. */
  servedFiles() {
    return [...this.served.values()].map((s) => s.file);
  }

  /**
   * Send the application the files among `files` it knows whose contents differ from
   * what it last got, then have it create its root component again. Returns
   * {url, files}, {error}, or null when there was nothing to reload -- unless `always`,
   * which reloads even when no file changed.
   */
  reload(files, { always = false } = {}) {
    const known = files.filter((f) => this.pathsOf(f).size > 0);
    if (known.length === 0 && !always) return null;
    const updates = [];
    for (const file of known) {
      const contents = this.read(file);
      if (!contents) continue;
      const hash = digest(contents);
      if (this.sent.get(key(file)) !== hash) updates.push({ file, contents, hash });
    }
    if (updates.length === 0 && !always) return null;
    if (!this.client) return { error: 'the application is not connected (yet)' };
    const url = this.rootUrl || this.guessRootUrl();
    if (!url) {
      return { error: 'the root component is not known: start the application with -qmljsdebugger=...,block so it waits for hot reload' };
    }
    if (!this.rootKnown) {
      // Name the root first, or the service would take the first file below for it.
      this.client.load(url);
      this.rootKnown = true;
    }
    for (const { file, contents, hash } of updates) {
      for (const p of this.pathsOf(file)) this.client.sendFile(p, contents);
      this.sent.set(key(file), hash);
    }
    this.client.load(url);
    return { url, files: updates.map((u) => u.file) };
  }
}

module.exports = { HotReloadSession };
