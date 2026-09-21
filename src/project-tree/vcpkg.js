'use strict';

/**
 * The vcpkg packages of a CMake project, for the Qt Project Explorer: the dependencies in its
 * vcpkg.json, as vcpkg installed them where the project's presets have vcpkg install -- the
 * vcpkg_installed folder of a preset's build folder -- or where vcpkg install run in the
 * project folder puts them.
 */

const path = require('path');
const { key } = require('../paths');
const { configurePresets, vcpkgOf } = require('../presets/configure-presets');
const { databaseFiles, dependencyTree, installedPackages, manifestDependencies } = require('../vcpkg/installed');

/**
 * The folders vcpkg installs the project in `projectDir` into, each once: [{dir, triplet,
 * hostTriplet, presets}] for the configure presets building with vcpkg, then the project's
 * own vcpkg_installed, for no triplet in particular.
 */
function installRoots(projectDir, presets) {
  const roots = new Map();
  for (const preset of presets.filter((p) => !p.hidden)) {
    const vcpkg = vcpkgOf(preset);
    if (!vcpkg || !vcpkg.installRoot) continue;
    const k = key(vcpkg.installRoot);
    if (!roots.has(k)) roots.set(k, { dir: vcpkg.installRoot, triplet: vcpkg.triplet, hostTriplet: vcpkg.hostTriplet, presets: [] });
    roots.get(k).presets.push(preset.name);
  }
  const own = path.join(projectDir, 'vcpkg_installed');
  if (!roots.has(key(own))) roots.set(key(own), { dir: own, triplet: null, hostTriplet: null, presets: [] });
  return [...roots.values()];
}

/**
 * The vcpkg packages of `project` (readCMakeProject): {manifest, error, packages, roots}, or
 * null when it has no vcpkg.json. `packages` is dependencyTree's, `roots` the install folders
 * holding packages; `error` says why vcpkg.json could not be read. `presetFiles` are the
 * project's preset files that may be read, `io` reads the disk as for readCMakeProject and
 * has readVcpkgInstalled(p), which reads vcpkg's install database wherever it is.
 */
async function readVcpkgPackages(project, presetFiles, io, env = process.env, platform = process.platform) {
  const manifest = path.join(project.dir, 'vcpkg.json');
  if ((await io.stat(manifest)) !== 'file') return null;
  const text = await io.readFile(manifest);
  if (text === null) return null;
  let dependencies;
  try {
    dependencies = manifestDependencies(text);
  } catch (err) {
    return { manifest, error: err.message, packages: [], roots: [] };
  }

  const files = [];
  for (const file of presetFiles) {
    const presetText = await io.readFile(file);
    if (presetText !== null) files.push({ path: file, text: presetText });
  }
  const roots = [];
  for (const root of installRoots(project.dir, configurePresets(files, project.dir, env, platform))) {
    const updates = await io.readDirectory(path.join(root.dir, 'vcpkg', 'updates'));
    const texts = [];
    for (const file of databaseFiles(root.dir, (updates || []).filter(([, isDirectory]) => !isDirectory).map(([name]) => name))) {
      const databaseText = await io.readVcpkgInstalled(file);
      if (databaseText !== null) texts.push(databaseText);
    }
    const packages = installedPackages(texts);
    if (packages.size > 0) roots.push({ ...root, packages });
  }
  return { manifest, error: null, packages: dependencyTree(dependencies, roots), roots };
}

module.exports = { readVcpkgPackages };
