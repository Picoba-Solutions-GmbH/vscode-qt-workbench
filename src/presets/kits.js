'use strict';

/**
 * Qt kits a CMake preset can build with: where to look for them, what each one is -- read
 * from its own mkspecs/qconfig.pri, not guessed from its folder name -- and the compiler,
 * generator and vcpkg triplet that go with it.
 *
 * A kit is {dir, version, major, label, problem} when it cannot be used, and otherwise also
 *
 *   {id, compilerLabel, generator, architecture, multiConfig, compilers: {c, cxx}, gdb,
 *    path: [dirs], pathSeparator, qtToolchain, triplet, hostTriplet}
 *
 * with `architecture`, `compilers`, `gdb` (MinGW's), `qtToolchain` (Qt 6) and `hostTriplet`
 * only where they apply.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { key, toPosix } = require('../paths');

/** QT_ARCH, or Node's process.arch, as vcpkg names the architecture. */
const ARCHITECTURES = { x86_64: 'x64', x64: 'x64', amd64: 'x64', i386: 'x86', i686: 'x86', x86: 'x86', arm64: 'arm64', aarch64: 'arm64' };

/** vcpkg's architecture as the Visual Studio generators name the platform. */
const VS_PLATFORMS = { x64: 'x64', x86: 'Win32', arm64: 'ARM64' };

const BITS = { x64: '64-bit', x86: '32-bit', arm64: 'ARM64' };

/** The first Qt version whose CMake API has QT_QML_GENERATE_QMLLS_INI. */
const QMLLS_INI_SINCE = [6, 7];

async function exists(p) {
  try {
    await fs.promises.stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function readText(p) {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (_) {
    return null;
  }
}

/** The variables a .pri file assigns: `NAME = value`, with `+=` appending. */
function parsePri(text) {
  const vars = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^[ \t]*([A-Za-z_][\w.]*)[ \t]*(\+?=)[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!m) continue;
    vars.set(m[1], m[2] === '+=' && vars.has(m[1]) ? vars.get(m[1]) + ' ' + m[3] : m[3]);
  }
  return vars;
}

/** {major, minor, patch, text} of QT_<name>_MAJOR_VERSION and the rest, or null. */
function compilerVersion(pri, name) {
  const part = (which) => pri.get('QT_' + name + '_' + which + '_VERSION');
  if (!/^\d+$/.test(part('MAJOR') || '')) return null;
  const [major, minor, patch] = ['MAJOR', 'MINOR', 'PATCH'].map((which) => Number(part(which) || 0));
  return { major, minor, patch, text: major + '.' + minor + '.' + patch };
}

/**
 * Where to look for kits: the Qt extension's Qt installation root, or where the Qt
 * installer puts Qt when it is not set, and the kits of the Qt extension's additional Qt
 * paths, which name their qmake or qtpaths.
 */
function qtSearchPaths({ installationRoot, additionalQtPaths, env, platform, home }) {
  const dirs = [];
  if (installationRoot) dirs.push(installationRoot);
  else if (platform === 'win32') dirs.push((env.SystemDrive || 'C:') + '\\Qt');
  else if (home) dirs.push(path.join(home, 'Qt'));
  for (const entry of Array.isArray(additionalQtPaths) ? additionalQtPaths : []) {
    const p = typeof entry === 'string' ? entry : entry && typeof entry.path === 'string' ? entry.path : '';
    if (!p) continue;
    dirs.push(/^(?:qmake|qtpaths)\d*(?:\.exe)?$/i.test(path.basename(p)) ? path.dirname(path.dirname(p)) : p);
  }
  return dirs;
}

/** The kit folders in `dir`: itself, a Qt version folder's kits, or an installation root's. */
async function kitDirsIn(dir, depth = 2) {
  if (await exists(path.join(dir, 'mkspecs', 'qconfig.pri'))) return [dir];
  if (depth === 0) return [];
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) found.push(...(await kitDirsIn(path.join(dir, entry.name), depth - 1)));
  }
  return found;
}

function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

/** Visual Studio installations with the C++ tools, as vswhere lists them. */
function runVswhere(exe) {
  const args = ['-all', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-format', 'json', '-utf8'];
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: 15000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/**
 * The Visual Studio installations with C++ tools, newest first: {dir, major, year, name, generator}.
 * vswhere names VS 2022 by its year and VS 2026 by its major version, so the year comes
 * from the display name when the product line gives none.
 */
async function findVisualStudios(env, platform, run = runVswhere) {
  if (platform !== 'win32' || !env['ProgramFiles(x86)']) return [];
  let list;
  try {
    list = JSON.parse(await run(path.join(env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')));
  } catch (_) {
    return []; // no vswhere: no Visual Studio 2017 or later
  }
  const found = [];
  for (const vs of Array.isArray(list) ? list : []) {
    const major = parseInt(vs.installationVersion, 10);
    const line = vs.catalog && vs.catalog.productLineVersion;
    const year = /^\d{4}$/.test(line || '') ? line : (/\b(20\d\d)\b/.exec(vs.displayName || '') || [])[1];
    if (!major || !year || !vs.installationPath) continue;
    found.push({ dir: vs.installationPath, major, year, name: vs.displayName || 'Visual Studio ' + year, generator: 'Visual Studio ' + major + ' ' + year, version: vs.installationVersion });
  }
  return found.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * What the kit in `dir` is, and what building with it takes. `ctx` is {platform, arch,
 * visualStudios}: the system the presets are for, its processor as Node names it, and
 * findVisualStudios' answer.
 */
async function readKit(dir, ctx) {
  const pri = parsePri(await readText(path.join(dir, 'mkspecs', 'qconfig.pri')));
  const version = pri.get('QT_VERSION') || '';
  const major = Number(version.split('.')[0]);
  const folder = path.basename(dir);
  const kit = { dir, version, major, label: 'Qt ' + (version || '?') + ' ' + folder };
  const unusable = (problem) => ({ ...kit, problem });

  if (!/^\d+\.\d+/.test(version) || major < 5) return unusable('its mkspecs/qconfig.pri names no Qt version');
  if (/(?:^|\s)cross_compile(?:\s|$)/.test(pri.get('QT.global.enabled_features') || '')) {
    return unusable('it builds for another system (Android, WebAssembly, iOS...), which needs a vcpkg triplet and toolchain of its own');
  }
  // qconfig.pri names the compiler, not the system: GCC builds both Linux and MinGW kits. The
  // kit's own tools say which system it runs on.
  const { platform } = ctx;
  const tool = async (ext) => (await exists(path.join(dir, 'bin', 'qtpaths' + ext))) || exists(path.join(dir, 'bin', 'qmake' + ext));
  if (platform === 'win32' ? !(await tool('.exe')) : (await tool('.exe')) || !(await tool(''))) {
    return unusable(platform === 'win32' ? 'it is no kit for Windows: it has no bin/qtpaths.exe or bin/qmake.exe' : 'it is no kit for ' + platform + ': it has no bin/qtpaths or bin/qmake');
  }
  if (major >= 6) {
    // Qt's own installer keeps the CMake package files under the kit's own prefix, next to
    // mkspecs. Some Linux distributions (Arch, Debian...) split a Qt6 package's mkspecs and
    // tools into their own data folder but keep its CMake package files in the system's
    // shared lib/cmake instead, one level up from that folder.
    const colocated = path.join(dir, 'lib', 'cmake', 'Qt' + major, 'qt.toolchain.cmake');
    const shared = path.join(path.dirname(dir), 'cmake', 'Qt' + major, 'qt.toolchain.cmake');
    kit.qtToolchain = (await exists(colocated)) ? colocated : shared;
    if (!(await exists(kit.qtToolchain))) {
      return unusable('it has no qt.toolchain.cmake in lib/cmake/Qt' + major + ' or ' + toPosix(path.dirname(dir)) + '/cmake/Qt' + major);
    }
  }
  const [qtMinor] = version.split('.').slice(1).map(Number);
  kit.qmllsIni = compareVersions(major + '.' + qtMinor, QMLLS_INI_SINCE.join('.')) >= 0;

  const architecture = platform === 'darwin' ? ARCHITECTURES[ctx.arch] : ARCHITECTURES[(pri.get('QT_ARCH') || '').split(/\s+/)[0]];
  if (!architecture) return unusable('its QT_ARCH, ' + (pri.get('QT_ARCH') || 'not set') + ', is no architecture vcpkg has triplets for');
  const suffix = architecture === 'x64' ? '' : '-' + architecture;
  const tools = path.join(path.dirname(path.dirname(dir)), 'Tools');
  const qtBin = path.join(dir, 'bin');
  kit.pathSeparator = platform === 'win32' ? ';' : ':';

  const gcc = compilerVersion(pri, 'GCC');
  const clang = compilerVersion(pri, 'CLANG') || compilerVersion(pri, 'APPLE_CLANG');

  if (platform === 'win32' && (/^msvc/i.test(folder) || compilerVersion(pri, 'MSVC'))) {
    const vs = ctx.visualStudios[0];
    const year = (/^msvc(\d{4})/i.exec(folder) || [])[1];
    kit.label = 'Qt ' + version + ' MSVC' + (year ? ' ' + year : '') + ' ' + BITS[architecture];
    if (!vs) return unusable('it needs Visual Studio with the C++ tools, and vswhere found none');
    return {
      ...kit,
      id: 'msvc' + suffix,
      compilerLabel: vs.name,
      generator: vs.generator,
      architecture: VS_PLATFORMS[architecture],
      multiConfig: true,
      path: [qtBin],
      triplet: architecture + '-windows'
    };
  }

  if (platform === 'win32' && gcc) {
    kit.label = 'Qt ' + version + ' MinGW ' + BITS[architecture];
    // Qt's installer names the MinGW a kit was built with by its version: GCC 13.1.0 is mingw1310_64.
    const name = 'mingw' + gcc.major + gcc.minor + gcc.patch + '_' + (architecture === 'x86' ? '32' : '64');
    const bin = path.join(tools, name, 'bin');
    const needed = ['gcc.exe', 'g++.exe', 'mingw32-make.exe'];
    for (const exe of needed) {
      if (!(await exists(path.join(bin, exe)))) {
        return unusable('it was built with GCC ' + gcc.text + ', and ' + toPosix(path.join(bin, exe)) + ' is missing: add MinGW ' + gcc.text + ' with the Qt Maintenance Tool');
      }
    }
    const gdb = path.join(bin, 'gdb.exe');
    return {
      ...kit,
      id: 'mingw' + suffix,
      compilerLabel: 'MinGW ' + gcc.text,
      generator: 'MinGW Makefiles',
      compilers: { c: path.join(bin, 'gcc.exe'), cxx: path.join(bin, 'g++.exe') },
      gdb: (await exists(gdb)) ? gdb : undefined,
      path: [qtBin, bin],
      triplet: architecture + '-mingw-dynamic',
      // vcpkg builds the tools it runs during a build for the host triplet, x64-windows by
      // default, which needs Visual C++. Without it, MinGW builds them too.
      hostTriplet: ctx.visualStudios.length === 0 ? architecture + '-mingw-dynamic' : undefined
    };
  }

  if (platform === 'win32' && clang) {
    return unusable('it was built with Clang (llvm-mingw), and vcpkg builds its MinGW triplets with GCC');
  }

  const ninja = path.join(tools, 'Ninja', platform === 'win32' ? 'ninja.exe' : 'ninja');
  const hasNinja = await exists(ninja);
  const unix = {
    generator: hasNinja ? 'Ninja' : 'Unix Makefiles',
    path: hasNinja ? [qtBin, path.dirname(ninja)] : [qtBin]
  };
  if (platform === 'linux' && gcc) {
    return { ...kit, ...unix, label: 'Qt ' + version + ' GCC ' + BITS[architecture], id: 'gcc' + suffix, compilerLabel: 'GCC', triplet: architecture + '-linux' };
  }
  if (platform === 'darwin' && clang) {
    return { ...kit, ...unix, label: 'Qt ' + version + ' macOS', id: 'macos', compilerLabel: 'Apple Clang', triplet: architecture + '-osx' };
  }
  return unusable("its mkspecs/qconfig.pri names no compiler Qt Workbench can set up on " + platform);
}

/** The kits in `dirs` (installation roots, version folders or kit folders), each once, newest first. */
async function findKits(dirs, ctx) {
  const seen = new Set();
  const kits = [];
  for (const dir of dirs) {
    for (const kitDir of await kitDirsIn(dir)) {
      if (seen.has(key(kitDir))) continue;
      seen.add(key(kitDir));
      kits.push(await readKit(kitDir, ctx));
    }
  }
  return kits.sort((a, b) => Boolean(a.problem) - Boolean(b.problem) || compareVersions(b.version, a.version) || a.label.localeCompare(b.label));
}

module.exports = { parsePri, qtSearchPaths, kitDirsIn, compareVersions, findVisualStudios, readKit, findKits };
