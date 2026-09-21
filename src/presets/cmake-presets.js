'use strict';

/**
 * The CMake presets that build a project with a Qt kit and vcpkg, and the edits adding
 * them to a CMakePresets.json: a whole new file, or presets added to an existing one
 * without touching the rest of it.
 *
 * For a kit with the id mingw they are a hidden base preset qt-mingw, holding the kit and
 * vcpkg, and qt-mingw-debug and qt-mingw-release inheriting it, each also a build preset.
 */

const { addToLists, joinEdits, member, parseJson } = require('../json-syntax');
const { toPosix } = require('../paths');

const VCPKG_MANIFEST =
  '{\n' +
  '  "$schema": "https://raw.githubusercontent.com/microsoft/vcpkg-tool/main/docs/vcpkg.schema.json",\n' +
  '  "dependencies": []\n' +
  '}\n';

// Build presets need version 2; 3 (CMake 3.21) is what CMake Tools and the Qt extensions write.
const NEW_FILE_VERSION = 3;
const LOWEST_VERSION = 2;
const LISTS = ['configurePresets', 'buildPresets'];

/** {configurePresets, buildPresets} for `kit` (presets/kits.js) and `vcpkg` (presets/vcpkg.js). */
function presetsFor(kit, vcpkg) {
  const base = 'qt' + (kit.major === 6 ? '' : kit.major) + '-' + kit.id;
  const cacheVariables = {};
  if (kit.compilers) {
    cacheVariables.CMAKE_C_COMPILER = toPosix(kit.compilers.c);
    cacheVariables.CMAKE_CXX_COMPILER = toPosix(kit.compilers.cxx);
  }
  cacheVariables.CMAKE_TOOLCHAIN_FILE = vcpkg.toolchain;
  if (kit.qtToolchain) cacheVariables.VCPKG_CHAINLOAD_TOOLCHAIN_FILE = toPosix(kit.qtToolchain);
  else cacheVariables.CMAKE_PREFIX_PATH = toPosix(kit.dir);
  cacheVariables.VCPKG_TARGET_TRIPLET = kit.triplet;
  if (kit.hostTriplet) cacheVariables.VCPKG_HOST_TRIPLET = kit.hostTriplet;
  if (kit.qmllsIni) cacheVariables.QT_QML_GENERATE_QMLLS_INI = 'ON';

  const hidden = { name: base, hidden: true, generator: kit.generator };
  if (kit.architecture) hidden.architecture = { value: kit.architecture, strategy: 'set' };
  Object.assign(hidden, {
    binaryDir: '${sourceDir}/builds/${presetName}',
    environment: { PATH: kit.path.map(toPosix).concat('$penv{PATH}').join(kit.pathSeparator) },
    vendor: { 'qt-cpp': { VSCODE_QT_INSTALLATION: toPosix(kit.dir) } },
    cacheVariables
  });

  const types = ['Debug', 'Release'];
  const configurePresets = types.map((type) => ({
    name: base + '-' + type.toLowerCase(),
    displayName: kit.label + ' ' + type + ' (vcpkg)',
    description: type + ' build with Qt ' + kit.version + ', ' + kit.compilerLabel + ' and vcpkg',
    inherits: base,
    cacheVariables: { CMAKE_BUILD_TYPE: type }
  }));
  const buildPresets = types.map((type, i) => {
    const preset = { name: configurePresets[i].name, configurePreset: configurePresets[i].name };
    if (kit.multiConfig) preset.configuration = type;
    return preset;
  });
  return { configurePresets: [hidden, ...configurePresets], buildPresets };
}

/** A new CMakePresets.json holding `presets`. */
function newPresetsFile(presets) {
  const file = { version: NEW_FILE_VERSION, cmakeMinimumRequired: { major: 3, minor: 21, patch: 0 }, ...presets };
  return JSON.stringify(file, null, 2) + '\n';
}

/**
 * The edits adding `presets` to the CMakePresets.json `text`, as {edits: [{start, end, text}],
 * configurePresets: {added, replaced, unchanged}, buildPresets: {...}} with preset names.
 * A preset of the same name that differs is replaced where it stands; the others go after
 * the last preset of their list, laid out like the file (json-syntax.js addToLists).
 * Throws a SyntaxError when the file is no JSON object of presets.
 */
function mergePresets(text, presets) {
  const root = parseJson(text);
  if (root.type !== 'object') throw new SyntaxError('it holds no JSON object');
  const result = addToLists(text, root, LISTS.map((name) => [name, presets[name]]));
  const version = member(root, 'version');
  if (version && version.value.type === 'number' && version.value.value < LOWEST_VERSION) {
    result.edits = joinEdits([...result.edits, { start: version.value.start, end: version.value.end, text: String(LOWEST_VERSION) }]);
  }
  return result;
}

module.exports = { VCPKG_MANIFEST, presetsFor, newPresetsFile, mergePresets };
