'use strict';

/**
 * The configure presets a project has, as CMake resolves them: `inherits` followed, and the
 * macros in binaryDir, toolchainFile, cacheVariables and environment expanded -- those that
 * can be without configuring: ${sourceDir}, ${presetName}, $env{} and the like. A value with
 * a macro that can't be expanded, such as $vendor{}, is left out rather than guessed at.
 * Also what a preset building with vcpkg has vcpkg install with: the vcpkg, the triplets and
 * the folder, as vcpkg's toolchain file does when CMake configures.
 */

const path = require('path');
const { parseJson, plain } = require('../json-syntax');
const { toPosix } = require('../paths');
const { TOOLCHAIN } = require('./vcpkg');

const HOST_SYSTEM_NAMES = { win32: 'Windows', linux: 'Linux', darwin: 'Darwin' };

/** A variable of `env` by name, ignoring case where the system does. */
function envValue(env, name, platform) {
  if (platform !== 'win32') return env[name];
  const found = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return found === undefined ? undefined : env[found];
}

/** A cacheVariables value as a string: a string, a boolean, or {type, value}; null to unset, undefined when it is none. */
function cacheValue(value) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value && typeof value === 'object') return cacheValue(value.value);
  return undefined;
}

/** The presets of `raw` (name -> {preset, file}) merged along their `inherits`: an earlier parent wins over a later one, the preset itself over both. */
function inherit(raw) {
  const merged = new Map();
  // A preset inheriting one that is missing, or itself, is an error to CMake: it is left out.
  const merge = (name, chain) => {
    if (merged.has(name)) return merged.get(name);
    const entry = raw.get(name);
    if (!entry || chain.includes(name)) return null;
    const own = entry.preset;
    const names = Array.isArray(own.inherits) ? own.inherits : typeof own.inherits === 'string' ? [own.inherits] : [];
    const parents = names.map((parent) => merge(parent, [...chain, name]));
    if (parents.includes(null)) {
      if (chain.length === 0) merged.set(name, null);
      return null;
    }
    const out = { name, file: entry.file, hidden: own.hidden === true, displayName: own.displayName, cacheVariables: {}, environment: {} };
    for (const field of ['generator', 'binaryDir', 'toolchainFile']) {
      const from = [own, ...parents].find((p) => typeof p[field] === 'string');
      if (from) out[field] = from[field];
    }
    for (const source of [...parents.slice().reverse(), { cacheVariables: own.cacheVariables, environment: own.environment }]) {
      for (const [k, v] of Object.entries(source.cacheVariables && typeof source.cacheVariables === 'object' ? source.cacheVariables : {})) {
        const value = cacheValue(v);
        if (value !== undefined) out.cacheVariables[k] = value;
      }
      for (const [k, v] of Object.entries(source.environment && typeof source.environment === 'object' ? source.environment : {})) {
        if (v === null || typeof v === 'string') out.environment[k] = v;
      }
    }
    merged.set(name, out);
    return out;
  };
  return [...raw.keys()].map((name) => merge(name, [])).filter(Boolean);
}

/**
 * Expands the macros of the preset `preset` of the project in `projectDir`. `expand(value)`
 * returns the value, or null when it holds a macro that can't be expanded. $env{} looks at
 * the preset's own environment first, then at `env`; $penv{} only at `env`.
 */
function expander(preset, projectDir, env, platform) {
  const macros = {
    sourceDir: toPosix(projectDir),
    sourceParentDir: toPosix(path.dirname(projectDir)),
    sourceDirName: path.basename(projectDir),
    presetName: preset.name,
    generator: preset.generator,
    hostSystemName: HOST_SYSTEM_NAMES[platform],
    fileDir: toPosix(path.dirname(preset.file)),
    dollar: '$',
    pathListSep: platform === 'win32' ? ';' : ':'
  };
  const resolving = new Set();
  const own = new Map();
  // The preset's own value of a variable, expanded; undefined when it sets none, or sets it to null.
  const ownVariable = (name) => {
    const k = Object.keys(preset.environment).find((n) => (platform === 'win32' ? n.toUpperCase() === name.toUpperCase() : n === name));
    if (k === undefined || preset.environment[k] === null) return undefined;
    if (own.has(k)) return own.get(k);
    if (resolving.has(k)) return null;
    resolving.add(k);
    const value = expand(preset.environment[k]);
    resolving.delete(k);
    own.set(k, value);
    return value;
  };
  function expand(value) {
    let failed = false;
    const out = value.replace(/\$(\w*)\{([^{}]*)\}/g, (all, namespace, name) => {
      let found;
      if (namespace === '') found = macros[name];
      else if (namespace === 'env') {
        found = ownVariable(name);
        if (found === undefined) found = envValue(env, name, platform);
        if (found === undefined) found = ''; // CMake expands an unset variable to nothing
      } else if (namespace === 'penv') {
        found = envValue(env, name, platform);
        if (found === undefined) found = '';
      }
      if (typeof found !== 'string') failed = true;
      return typeof found === 'string' ? found : all;
    });
    return failed ? null : out;
  }
  return { expand, variable: ownVariable };
}

/**
 * The configure presets in `files` -- [{path, text}] of CMakePresets.json and then
 * CMakeUserPresets.json, whose presets share one set of names -- of the project in
 * `projectDir`, as [{name, displayName, hidden, file, generator, binaryDir, toolchain,
 * cacheVariables, environment}]: `binaryDir` and `toolchain` are absolute paths or null,
 * `cacheVariables` expanded strings, and `environment` the preset's own variables expanded,
 * null for one it unsets. A file that is no JSON adds no presets.
 */
function configurePresets(files, projectDir, env, platform) {
  const raw = new Map();
  for (const file of files) {
    let presets;
    try {
      presets = plain(parseJson(file.text)).configurePresets;
    } catch (_) {
      continue;
    }
    for (const preset of Array.isArray(presets) ? presets : []) {
      if (preset && typeof preset.name === 'string' && !raw.has(preset.name)) raw.set(preset.name, { preset, file: file.path });
    }
  }
  return inherit(raw).map((preset) => {
    const { expand, variable } = expander(preset, projectDir, env, platform);
    const absolute = (value) => {
      const expanded = typeof value === 'string' ? expand(value) : null;
      return expanded ? path.resolve(projectDir, expanded) : null;
    };
    const cacheVariables = {};
    for (const [k, v] of Object.entries(preset.cacheVariables)) {
      const expanded = v === null ? null : expand(v);
      if (expanded !== null) cacheVariables[k] = expanded;
    }
    const environment = {};
    for (const k of Object.keys(preset.environment)) {
      const value = preset.environment[k] === null ? null : variable(k);
      if (value !== undefined && (value !== null || preset.environment[k] === null)) environment[k] = value;
    }
    return {
      name: preset.name,
      displayName: typeof preset.displayName === 'string' ? preset.displayName : undefined,
      hidden: preset.hidden,
      file: preset.file,
      generator: preset.generator,
      binaryDir: absolute(preset.binaryDir),
      toolchain: absolute(preset.toolchainFile !== undefined ? preset.toolchainFile : cacheVariables.CMAKE_TOOLCHAIN_FILE),
      cacheVariables,
      environment
    };
  });
}

/**
 * What a configure preset building with vcpkg's toolchain file has vcpkg install with:
 * {root, triplet, hostTriplet, installRoot}, or null for one that doesn't build with vcpkg.
 * `installRoot` is VCPKG_INSTALLED_DIR when the preset sets it, else vcpkg_installed in its
 * build folder, as vcpkg's toolchain file has it; null when neither is known.
 */
function vcpkgOf(preset) {
  const toolchain = preset.toolchain && toPosix(preset.toolchain);
  if (!toolchain || !toolchain.endsWith('/' + TOOLCHAIN)) return null;
  const installed = preset.cacheVariables.VCPKG_INSTALLED_DIR;
  let installRoot = null;
  if (installed) installRoot = path.isAbsolute(installed) ? path.resolve(installed) : null;
  else if (preset.binaryDir) installRoot = path.join(preset.binaryDir, 'vcpkg_installed');
  return {
    root: path.resolve(toolchain.slice(0, -TOOLCHAIN.length - 1)),
    triplet: preset.cacheVariables.VCPKG_TARGET_TRIPLET || null,
    hostTriplet: preset.cacheVariables.VCPKG_HOST_TRIPLET || null,
    installRoot
  };
}

/** `env` with the environment of `preset` (configurePresets) applied: its variables set, those it sets to null taken out. */
function presetEnvironment(preset, env, platform) {
  const out = { ...env };
  for (const [name, value] of Object.entries(preset.environment)) {
    for (const k of Object.keys(out)) {
      if (platform === 'win32' ? k.toUpperCase() === name.toUpperCase() : k === name) delete out[k];
    }
    if (value !== null) out[name] = value;
  }
  return out;
}

module.exports = { configurePresets, vcpkgOf, presetEnvironment };
