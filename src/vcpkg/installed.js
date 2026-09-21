'use strict';

/**
 * What vcpkg installed: the install database in a vcpkg_installed folder -- vcpkg/status and
 * the vcpkg/updates/ files written since, applied in order -- and the dependencies of a
 * vcpkg.json with the packages installed for them, each with the packages it depends on. And
 * the edits taking dependencies out of a vcpkg.json.
 */

const path = require('path');
const { member, parseJson, plain } = require('../json-syntax');
const { removalEdits } = require('../text');

/** The paragraphs of a status file: [{Field: value}], a field's continued lines joined with \n. */
function paragraphs(text) {
  const out = [];
  let current = null;
  let last = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*$/.test(line)) {
      current = null;
    } else if (/^[ \t]/.test(line)) {
      if (current && last) current[last] += '\n' + line.trim();
    } else {
      const m = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
      if (!m) continue;
      if (!current) {
        current = {};
        out.push(current);
      }
      current[m[1]] = m[2];
      last = m[1];
    }
  }
  return out;
}

/** 'name:triplet' of a Depends entry, whose triplet is `triplet` when it names none. */
function dependencySpec(entry, triplet) {
  const m = /^([^:[\s]+)(?:\[[^\]]*\])?(?::(\S+))?$/.exec(entry.trim());
  return m ? m[1] + ':' + (m[2] || triplet) : null;
}

/**
 * The packages installed, from the texts of a status file and of its updates, in order:
 * Map 'name:triplet' -> {name, triplet, version, description, features, depends}, `depends`
 * being 'name:triplet' too. A later paragraph for a package replaces an earlier one, and only
 * one whose Status is "install ok installed" counts.
 */
function installedPackages(texts) {
  const latest = new Map();
  for (const text of texts) {
    for (const p of paragraphs(text)) {
      if (p.Package && p.Architecture) latest.set(p.Package + ':' + p.Architecture + ':' + (p.Feature || ''), p);
    }
  }
  const installed = [...latest.values()].filter((p) => {
    const [want, , state] = String(p.Status || '').split(/\s+/);
    return want === 'install' && state === 'installed';
  });
  const depends = (p) => String(p.Depends || '').split(',').map((d) => dependencySpec(d, p.Architecture)).filter(Boolean);
  const packages = new Map();
  for (const p of installed.filter((q) => !q.Feature)) {
    const portVersion = p['Port-Version'] && p['Port-Version'] !== '0' ? '#' + p['Port-Version'] : '';
    packages.set(p.Package + ':' + p.Architecture, {
      name: p.Package,
      triplet: p.Architecture,
      version: (p.Version || '?') + portVersion,
      description: p.Description || '',
      features: [],
      depends: depends(p)
    });
  }
  for (const p of installed.filter((q) => q.Feature)) {
    const core = packages.get(p.Package + ':' + p.Architecture);
    if (!core) continue;
    if (p.Feature !== 'core') core.features.push(p.Feature);
    for (const d of depends(p)) if (!core.depends.includes(d)) core.depends.push(d);
  }
  return packages;
}

/** The files of the install database in `installRoot`, in the order they apply, given the names in its vcpkg/updates folder. */
function databaseFiles(installRoot, updates) {
  return [
    path.join(installRoot, 'vcpkg', 'status'),
    ...(updates || []).filter((name) => /^\d+$/.test(name)).sort().map((name) => path.join(installRoot, 'vcpkg', 'updates', name))
  ];
}

/**
 * The dependencies of the vcpkg.json `text`: [{name, host, features}]. Throws a SyntaxError
 * when it is no JSON object with a list of dependencies.
 */
function manifestDependencies(text) {
  const manifest = plain(parseJson(text));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new SyntaxError('it holds no JSON object');
  if (manifest.dependencies === undefined) return [];
  if (!Array.isArray(manifest.dependencies)) throw new SyntaxError('dependencies is no list');
  const out = [];
  for (const d of manifest.dependencies) {
    if (typeof d === 'string') out.push({ name: d, host: false, features: [] });
    else if (d && typeof d.name === 'string') {
      const features = (Array.isArray(d.features) ? d.features : []).map((f) => (f && typeof f === 'object' ? f.name : f)).filter((f) => typeof f === 'string');
      out.push({ name: d.name, host: d.host === true, features });
    }
  }
  return out;
}

/**
 * The edits taking the dependencies named in `ports` out of the vcpkg.json `text`, the rest of
 * it left as written: {edits, removed}, `removed` the names taken out. A list left empty is
 * written []. Throws a SyntaxError as manifestDependencies does.
 */
function dependencyRemovals(text, ports) {
  const root = parseJson(text);
  if (root.type !== 'object') throw new SyntaxError('it holds no JSON object');
  const list = member(root, 'dependencies');
  if (!list) return { edits: [], removed: [] };
  if (list.value.type !== 'array') throw new SyntaxError('dependencies is no list');
  const items = list.value.items;
  const nameOf = (item) => {
    if (item.type === 'string') return item.value;
    const name = member(item, 'name');
    return name && name.value.type === 'string' ? name.value.value : null;
  };
  const gone = items.filter((item) => ports.includes(nameOf(item)));
  const removed = [...new Set(gone.map(nameOf))];
  if (gone.length === 0) return { edits: [], removed };
  if (gone.length === items.length) return { edits: [{ start: list.value.start, end: list.value.end, text: '[]' }], removed };
  // An item goes up to the next one, or, at the end of the list, from the last one kept.
  const lastKept = items.filter((item) => !gone.includes(item)).pop();
  const ranges = gone.map((item) => {
    const i = items.indexOf(item);
    return i < items.indexOf(lastKept) ? { start: item.start, end: items[i + 1].start } : { start: lastKept.end, end: item.end };
  });
  return { edits: removalEdits(ranges), removed };
}

/**
 * The package installed for `dependency` ({name, host}) among `packages` (installedPackages):
 * for `triplet`, or `hostTriplet` for a host dependency when it is not null, and for any
 * triplet when that is null. Null when there is none.
 */
function installedFor(packages, dependency, triplet, hostTriplet) {
  const wanted = dependency.host ? hostTriplet || triplet : triplet;
  if (wanted) return packages.get(dependency.name + ':' + wanted) || null;
  return [...packages.values()].find((p) => p.name === dependency.name) || null;
}

/**
 * The `dependencies` (manifestDependencies) as installed in `roots` -- [{dir, triplet,
 * hostTriplet, packages}], `packages` from installedPackages -- each looked up in the first
 * root that has it: for the root's triplet, or its host triplet for a host dependency, and
 * for any triplet when the root has none. A node is {name, installed, version, triplet, host,
 * description, features, root, dependencies}; a dependency is `host` when it is installed for
 * another triplet than the package needing it.
 */
function dependencyTree(dependencies, roots) {
  const lookup = (root, dependency) => installedFor(root.packages, dependency, root.triplet, root.hostTriplet);
  const node = (pkg, root, parent, ancestors) => ({
    name: pkg.name,
    installed: true,
    version: pkg.version,
    triplet: pkg.triplet,
    host: Boolean(parent) && pkg.triplet !== parent.triplet,
    description: pkg.description,
    features: pkg.features,
    root: root.dir,
    dependencies: pkg.depends
      .map((spec) => root.packages.get(spec))
      .filter((dep) => dep && !ancestors.includes(dep))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((dep) => node(dep, root, pkg, [...ancestors, dep]))
  });
  return dependencies.map((dependency) => {
    for (const root of roots) {
      const pkg = lookup(root, dependency);
      if (pkg) return node(pkg, root, null, [pkg]);
    }
    return { name: dependency.name, installed: false, host: dependency.host, features: dependency.features, dependencies: [] };
  });
}

module.exports = { installedPackages, databaseFiles, manifestDependencies, dependencyRemovals, installedFor, dependencyTree };
