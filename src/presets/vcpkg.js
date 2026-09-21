'use strict';

/**
 * Where vcpkg is, and how a preset spells the path to its toolchain file: relative to the
 * project when vcpkg sits inside it, through VCPKG_ROOT when that is the one, and as an
 * absolute path only otherwise.
 */

const fs = require('fs');
const path = require('path');
const { parseJson, plain } = require('../json-syntax');
const { key, toPosix } = require('../paths');

const TOOLCHAIN = 'scripts/buildsystems/vcpkg.cmake';

/** Folders in a project that commonly hold vcpkg as a git submodule. */
const IN_PROJECT = ['vcpkg', 'external/vcpkg', 'extern/vcpkg', '3rdparty/vcpkg', 'third_party/vcpkg'];

async function exists(p) {
  try {
    await fs.promises.stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

/** A vcpkg root has a .vcpkg-root marker and the CMake toolchain file. */
async function isVcpkgRoot(dir) {
  return (await exists(path.join(dir, '.vcpkg-root'))) && (await exists(path.join(dir, ...TOOLCHAIN.split('/'))));
}

function isInside(p, dir) {
  const rel = path.relative(dir, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** CMAKE_TOOLCHAIN_FILE for the vcpkg in `dir`, as the presets of the project in `projectDir` spell it. */
function toolchainPath(dir, projectDir, env) {
  if (isInside(dir, projectDir)) return '${sourceDir}/' + toPosix(path.relative(projectDir, dir)) + '/' + TOOLCHAIN;
  if (env.VCPKG_ROOT && key(env.VCPKG_ROOT) === key(dir)) return '$env{VCPKG_ROOT}/' + TOOLCHAIN;
  return toPosix(dir).replace(/\/+$/, '') + '/' + TOOLCHAIN;
}

/** The vcpkg roots the toolchain files of existing presets point to; `texts` are CMakePresets.json and CMakeUserPresets.json. */
function rootsInPresets(texts, projectDir, env) {
  const roots = [];
  for (const text of texts) {
    let presets;
    try {
      presets = plain(parseJson(text || '')).configurePresets;
    } catch (_) {
      continue; // no file, or not JSON
    }
    for (const preset of Array.isArray(presets) ? presets : []) {
      const cache = preset && preset.cacheVariables;
      for (let file of [preset && preset.toolchainFile, cache && cache.CMAKE_TOOLCHAIN_FILE]) {
        if (file && typeof file === 'object') file = file.value; // {"type": "FILEPATH", "value": ...}
        if (typeof file !== 'string' || !file.replace(/\\/g, '/').endsWith(TOOLCHAIN)) continue;
        const resolved = file
          .replace(/\$\{sourceDir\}/g, projectDir)
          .replace(/\$env\{(\w+)\}|\$penv\{(\w+)\}/g, (_, a, b) => env[a || b] || '\0');
        if (resolved.includes('\0') || /\$\{|\$env\{/.test(resolved)) continue;
        roots.push(path.resolve(projectDir, resolved.slice(0, -TOOLCHAIN.length)));
      }
    }
  }
  return roots;
}

/** The folders on PATH holding a vcpkg executable. */
function rootsOnPath(env, platform) {
  const exe = platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
  const roots = [];
  for (const dir of String(env.PATH || '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    try {
      roots.push(path.dirname(fs.realpathSync(path.join(dir, exe))));
    } catch (_) {
      // no vcpkg here
    }
  }
  return roots;
}

/**
 * The vcpkg roots found for the project in `projectDir`, each once: {dir, source, toolchain}.
 * In the project, VCPKG_ROOT, the project's presets, PATH, the ones chosen before
 * (`remembered`), then the one Visual Studio brings.
 */
async function findVcpkgRoots({ projectDir, env, platform, presetTexts, remembered, visualStudios }) {
  const candidates = [
    ...IN_PROJECT.map((dir) => ({ dir: path.join(projectDir, ...dir.split('/')), source: 'in the project' })),
    ...(env.VCPKG_ROOT ? [{ dir: env.VCPKG_ROOT, source: 'VCPKG_ROOT' }] : []),
    ...rootsInPresets(presetTexts, projectDir, env).map((dir) => ({ dir, source: 'in the existing presets' })),
    ...rootsOnPath(env, platform).map((dir) => ({ dir, source: 'on PATH' })),
    ...(remembered || []).map((dir) => ({ dir, source: 'chosen before' })),
    ...(visualStudios || []).map((vs) => ({ dir: path.join(vs.dir, 'VC', 'vcpkg'), source: 'comes with ' + vs.name }))
  ];
  const seen = new Set();
  const found = [];
  for (const candidate of candidates) {
    const dir = path.resolve(candidate.dir);
    if (seen.has(key(dir))) continue;
    seen.add(key(dir));
    if (await isVcpkgRoot(dir)) found.push({ dir, source: candidate.source, toolchain: toolchainPath(dir, projectDir, env) });
  }
  return found;
}

module.exports = { TOOLCHAIN, isVcpkgRoot, toolchainPath, findVcpkgRoots };
