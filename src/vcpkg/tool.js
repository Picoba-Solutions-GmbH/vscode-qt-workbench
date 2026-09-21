'use strict';

/**
 * The vcpkg tool in a vcpkg folder: its executable, the ports it knows, and running it --
 * vcpkg add port, vcpkg install as vcpkg's toolchain file runs it when CMake configures, and
 * vcpkg print-usage.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { toPosix } = require('../paths');

/** vcpkg's executable in the vcpkg folder `root`: vcpkg.exe on Windows, where bootstrap-vcpkg puts it. */
function vcpkgExecutable(root, platform) {
  return path.join(root, platform === 'win32' ? 'vcpkg.exe' : 'vcpkg');
}

async function readJson(p) {
  try {
    return JSON.parse(await fs.promises.readFile(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * The ports of the vcpkg in `root`, by name: [{name, version, description}], the version from
 * versions/baseline.json and the description from the port's vcpkg.json -- as far as they can
 * be read. A port another registry brings is not among them.
 */
async function availablePorts(root) {
  let names = [];
  try {
    names = (await fs.promises.readdir(path.join(root, 'ports'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (_) {
    return [];
  }
  const baseline = ((await readJson(path.join(root, 'versions', 'baseline.json'))) || {}).default || {};
  const ports = await Promise.all(
    names.map(async (name) => {
      const manifest = (await readJson(path.join(root, 'ports', name, 'vcpkg.json'))) || {};
      const entry = baseline[name] || {};
      const version = entry.baseline || manifest.version || manifest['version-string'] || manifest['version-semver'] || manifest['version-date'] || '';
      const portVersion = entry.baseline ? entry['port-version'] : manifest['port-version'];
      const description = Array.isArray(manifest.description) ? manifest.description.join(' ') : manifest.description;
      return { name, version: version + (portVersion ? '#' + portVersion : ''), description: typeof description === 'string' ? description : '' };
    })
  );
  return ports.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The arguments of vcpkg add port adding `port` to the manifest in the working folder, with the vcpkg in `root`. */
function addPortArgs(root, port) {
  return ['add', 'port', port, '--vcpkg-root=' + toPosix(root)];
}

/**
 * The arguments of vcpkg install installing the manifest in `manifestDir` into `installRoot`
 * for `triplet` and `hostTriplet`, as vcpkg's toolchain file passes them. A triplet that is
 * null is left to vcpkg.
 */
function installArgs({ root, manifestDir, installRoot, triplet, hostTriplet }) {
  return [
    'install',
    ...(triplet ? ['--triplet=' + triplet] : []),
    ...(hostTriplet ? ['--host-triplet=' + hostTriplet] : []),
    '--vcpkg-root=' + toPosix(root),
    '--x-wait-for-lock',
    '--x-manifest-root=' + toPosix(manifestDir),
    '--x-install-root=' + toPosix(installRoot)
  ];
}

/**
 * The arguments of vcpkg print-usage printing what vcpkg says about using `spec`, a package
 * 'port:triplet' installed in `installRoot`, with the vcpkg in `root`: the usage file it
 * installed, or the CMake targets vcpkg finds in its files -- as vcpkg install prints it.
 */
function printUsageArgs(root, installRoot, spec) {
  return ['print-usage', spec, '--vcpkg-root=' + toPosix(root), '--x-install-root=' + toPosix(installRoot)];
}

/** The last line of vcpkg's output that reports an error, without "error: ", or null. */
function lastError(output) {
  const errors = String(output).split(/\r?\n/).filter((line) => /^error:/.test(line));
  return errors.length > 0 ? errors[errors.length - 1].replace(/^error:\s*/, '') : null;
}

/** Stop `child` and the processes it started: vcpkg runs CMake, which runs the compiler. */
function stop(child, platform) {
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    child.kill();
  }
}

/**
 * Run the vcpkg executable `exe` with `args` in `cwd` with the environment `env`. Each line of
 * its output goes to `onLine` as it comes. Resolves {code, output, stopped, error}: `code` is
 * null when it could not start or was stopped, `error` why it could not start. `token`, a
 * cancellation token, stops it.
 */
function runVcpkg(exe, args, { cwd, env, platform, onLine, token }) {
  return new Promise((resolve) => {
    let output = '';
    let pending = '';
    let stopped = false;
    let settled = false;
    let listener = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (listener) listener.dispose();
      if (pending) onLine(pending);
      resolve({ output, stopped, error: null, ...result });
    };
    let child;
    try {
      child = spawn(exe, args, { cwd, env, windowsHide: true });
    } catch (err) {
      finish({ code: null, error: err.message });
      return;
    }
    const take = (chunk) => {
      output += chunk;
      pending += chunk;
      let nl;
      while ((nl = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, nl).replace(/\r$/, ''));
        pending = pending.slice(nl + 1);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    if (token) {
      listener = token.onCancellationRequested(() => {
        stopped = true;
        stop(child, platform);
      });
    }
    child.on('error', (err) => finish({ code: null, error: err.message }));
    child.on('close', (code) => finish({ code: stopped ? null : code }));
  });
}

module.exports = { vcpkgExecutable, availablePorts, addPortArgs, installArgs, printUsageArgs, lastError, runVcpkg };
