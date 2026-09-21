'use strict';

/**
 * Path keys, relative paths as Qt projects spell them, and which kind of file is which.
 */

const path = require('path');

const HEADER_EXT = new Set(['.h', '.hh', '.hpp', '.hxx', '.inl', '.ipp']);

const CPP_EXT = new Set(['.c', '.cc', '.cpp', '.cxx', '.m', '.mm', ...HEADER_EXT]);

const BUILD_NAMES = new Set(['cmakelists.txt']);

const BUILD_EXT = new Set(['.cmake', '.pro', '.pri', '.prf']);

/** Asset extensions worth chasing inside QML/C++ string literals. */
const ASSET_EXT =
  'qml|js|mjs|png|jpg|jpeg|svg|gif|webp|bmp|ico|ttf|otf|woff|woff2|json|' +
  'frag|vert|glsl|qsb|mesh|gltf|glb|wav|mp3|ogg|txt|csv|conf|ini|qm';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Case-normalised absolute path, used as a map key (Windows is case-insensitive). */
function key(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** Relative posix path from a directory to a file, the way Qt projects spell it. */
function relFrom(dir, file) {
  const r = toPosix(path.relative(dir, file));
  return r === '' ? '.' : r;
}

function extOf(p) {
  return path.extname(p).toLowerCase();
}

function isBuildFile(p) {
  return BUILD_NAMES.has(path.basename(p).toLowerCase()) || BUILD_EXT.has(extOf(p));
}

function isCppFile(p) {
  return CPP_EXT.has(extOf(p));
}

function isQmlLike(p) {
  const e = extOf(p);
  return e === '.qml' || e === '.js' || e === '.mjs';
}

function isUrlScheme(s) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** A .qml file only declares a type when its name is a capitalised identifier. */
function isQmlTypeName(name) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function isAbsolutePathLike(s) {
  return s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s);
}

module.exports = { HEADER_EXT, ASSET_EXT, toPosix, key, relFrom, extOf, isBuildFile, isCppFile, isQmlLike, isUrlScheme, isQmlTypeName, isAbsolutePathLike };
