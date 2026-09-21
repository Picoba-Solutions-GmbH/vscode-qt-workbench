'use strict';
// Plays vcpkg for cases/packages.sh. It is preloaded into a copy of the JavaScript runtime named
// vcpkg.exe (vcpkg elsewhere) with NODE_OPTIONS=--require=fake-vcpkg.js, so the extension starts
// it as it starts vcpkg's executable, in the vcpkg folder the copy is in:
//
//   vcpkg add port <name> [--vcpkg-root=...]   adds the port to vcpkg.json in the working folder,
//                                              sorted and laid out as vcpkg writes it, known or not
//   vcpkg install --triplet=... --host-triplet=... --x-manifest-root=... --x-install-root=...
//       installs the manifest's dependencies: the database files in vcpkg/updates, and
//       <triplet>/share/<port>/usage; removes the packages installed that they no longer
//       need; then prints the usage of each dependency, as vcpkg does
//   vcpkg print-usage <port>:<triplet> --x-install-root=...
//       prints the usage of a package installed there, as install does
//
// A port is a folder in ports/: its vcpkg.json (version, port-version, description and
// dependencies, {"name", "host": true} for a host one) and its usage file, if it has one.
// Without one, vcpkg prints the CMake targets it finds in the port's files: a `targets` file
// holds the package and its targets, "tinyxml2 tinyxml2::tinyxml2". A `fail` file makes its
// build fail. An `old` file in the vcpkg folder makes it a vcpkg from before print-usage.
// Every run is appended to invocations.log in the vcpkg folder as a JSON line: {args, cwd,
// path}, `path` the PATH it ran with.

const fs = require('fs');
const path = require('path');

const root = path.dirname(process.execPath);
// Node takes the first argument for a script, and makes it an absolute path.
const args = [path.basename(process.argv[1] || ''), ...process.argv.slice(2)];
const option = (name) => {
  const found = args.find((a) => a.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : null;
};
const pathVariable = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
fs.appendFileSync(path.join(root, 'invocations.log'), JSON.stringify({ args, cwd: process.cwd(), path: process.env[pathVariable] }) + '\n');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const portDir = (name) => path.join(root, 'ports', name);
const say = (text) => process.stdout.write(text + '\n');

/** The packages installed in `installRoot`, as 'name:triplet': the last paragraph for each in its database says "install ok installed". */
function installedSpecs(installRoot) {
  const updates = path.join(installRoot, 'vcpkg', 'updates');
  const files = [path.join(installRoot, 'vcpkg', 'status')];
  if (fs.existsSync(updates)) files.push(...fs.readdirSync(updates).sort().map((n) => path.join(updates, n)));
  const status = new Map();
  for (const file of files.filter((f) => fs.existsSync(f))) {
    for (const paragraph of fs.readFileSync(file, 'utf8').split(/\n\s*\n/)) {
      const field = (name) => (new RegExp('^' + name + ': (.*)$', 'm').exec(paragraph) || [])[1];
      if (field('Package') && !field('Feature')) status.set(field('Package') + ':' + field('Architecture'), field('Status'));
    }
  }
  return new Set([...status].filter(([, s]) => s === 'install ok installed').map(([spec]) => spec));
}

/** The CMake targets vcpkg finds in a port's files, for a port without a usage file. */
function printTargets(name) {
  const targets = path.join(portDir(name), 'targets');
  if (!fs.existsSync(targets)) return;
  const [pkg, ...names] = fs.readFileSync(targets, 'utf8').trim().split(/\s+/);
  say(name + ' provides CMake targets:\n');
  say('  # this is heuristically generated, and may not be correct');
  say('  find_package(' + pkg + ' CONFIG REQUIRED)');
  say('  target_link_libraries(main PRIVATE ' + names.join(' ') + ')\n');
}

function printUsage() {
  if (fs.existsSync(path.join(root, 'old'))) {
    say('error: invalid command: print-usage');
    process.exit(1);
  }
  const spec = args[1];
  const [name, triplet] = spec.split(':');
  const installRoot = option('x-install-root') || path.join(process.cwd(), 'vcpkg_installed');
  if (!installedSpecs(installRoot).has(spec)) {
    say('error: ' + spec + ' is not installed.');
    process.exit(1);
  }
  const usage = path.join(installRoot, triplet, 'share', name, 'usage');
  if (fs.existsSync(usage)) process.stdout.write(fs.readFileSync(usage, 'utf8') + '\n');
  else printTargets(name);
}

function addPort() {
  const manifestPath = path.join(process.cwd(), 'vcpkg.json');
  if (!fs.existsSync(manifestPath)) {
    say('error: could not locate a manifest (vcpkg.json) above the current working directory.');
    process.exit(1);
  }
  const manifest = readJson(manifestPath);
  const names = new Set((manifest.dependencies || []).map((d) => (typeof d === 'string' ? d : d.name)));
  const dependencies = manifest.dependencies || [];
  for (const name of args.slice(2).filter((a) => !a.startsWith('--'))) if (!names.has(name)) dependencies.push(name);
  manifest.dependencies = dependencies.sort((a, b) => {
    const x = typeof a === 'string' ? a : a.name;
    const y = typeof b === 'string' ? b : b.name;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  say('Succeeded in adding ports to vcpkg.json file.');
}

function install() {
  const triplet = option('triplet') || 'x64-windows';
  const hostTriplet = option('host-triplet') || 'x64-windows';
  const manifestRoot = option('x-manifest-root') || process.cwd();
  const installRoot = option('x-install-root') || path.join(manifestRoot, 'vcpkg_installed');
  const manifest = readJson(path.join(manifestRoot, 'vcpkg.json'));

  // The install plan: dependencies before the packages needing them.
  const plan = [];
  const visit = (name, forTriplet) => {
    if (plan.some((p) => p.name === name && p.triplet === forTriplet)) return;
    if (!fs.existsSync(path.join(portDir(name), 'vcpkg.json'))) {
      say('error: while loading ' + name + ':');
      say('error: ' + name + ' does not exist');
      process.exit(1);
    }
    const port = readJson(path.join(portDir(name), 'vcpkg.json'));
    const depends = [];
    for (const d of port.dependencies || []) {
      const host = typeof d === 'object' && d.host;
      const depName = typeof d === 'string' ? d : d.name;
      visit(depName, host ? hostTriplet : forTriplet);
      depends.push(depName + ':' + (host ? hostTriplet : forTriplet));
    }
    plan.push({ name, triplet: forTriplet, port, depends });
  };
  const requested = (manifest.dependencies || []).map((d) => (typeof d === 'string' ? d : d.name));
  for (const name of requested) visit(name, triplet);

  const updates = path.join(installRoot, 'vcpkg', 'updates');
  fs.mkdirSync(updates, { recursive: true });
  const installed = installedSpecs(installRoot);
  const isInstalled = (p) => installed.has(p.name + ':' + p.triplet);
  const spec = (p) => p.name + ':' + p.triplet + '@' + p.port.version + (p.port['port-version'] ? '#' + p.port['port-version'] : '');
  const fresh = plan.filter((p) => !isInstalled(p));
  // In manifest mode, what the manifest no longer needs is removed.
  const removals = [...installed].filter((s) => !plan.some((p) => p.name + ':' + p.triplet === s)).sort();
  if (plan.length > fresh.length) {
    say('The following packages are already installed:');
    for (const p of plan.filter((q) => isInstalled(q))) say('    ' + spec(p));
  }
  if (removals.length > 0) {
    say('The following packages will be removed:');
    for (const s of removals) say('    ' + s);
  }
  if (fresh.length > 0) {
    say('The following packages will be built and installed:');
    for (const p of fresh) say('    ' + spec(p));
  }
  let next = fs.readdirSync(updates).length;
  const total = removals.length + fresh.length;
  removals.forEach((s, i) => {
    say('Removing ' + (i + 1) + '/' + total + ' ' + s);
    const [name, forTriplet] = s.split(':');
    fs.rmSync(path.join(installRoot, forTriplet, 'share', name), { recursive: true, force: true });
    for (const state of ['half-installed', 'not-installed']) {
      const fields = ['Package: ' + name, 'Architecture: ' + forTriplet, 'Multi-Arch: same', 'Status: purge ok ' + state];
      fs.writeFileSync(path.join(updates, String(next++).padStart(10, '0')), fields.join('\n') + '\n');
    }
  });
  fresh.forEach((p, i) => {
    say('Installing ' + (removals.length + i + 1) + '/' + total + ' ' + spec(p) + '...');
    say('Building ' + spec(p) + '...');
    if (fs.existsSync(path.join(portDir(p.name), 'fail'))) {
      say('error: building ' + p.name + ':' + p.triplet + ' failed with: BUILD_FAILED');
      say('See https://learn.microsoft.com/vcpkg/troubleshoot/build-failures?WT.mc_id=vcpkg_inproduct_cli for more information.');
      process.exit(1);
    }
    const share = path.join(installRoot, p.triplet, 'share', p.name);
    fs.mkdirSync(share, { recursive: true });
    const usage = path.join(portDir(p.name), 'usage');
    if (fs.existsSync(usage)) fs.copyFileSync(usage, path.join(share, 'usage'));
    const fields = [
      'Package: ' + p.name,
      'Version: ' + p.port.version,
      ...(p.port['port-version'] ? ['Port-Version: ' + p.port['port-version']] : []),
      ...(p.depends.length > 0 ? ['Depends: ' + p.depends.join(', ')] : []),
      'Architecture: ' + p.triplet,
      'Multi-Arch: same',
      ...(p.port.description ? ['Description: ' + p.port.description] : [])
    ];
    for (const state of ['half-installed', 'installed']) {
      fs.writeFileSync(path.join(updates, String(next++).padStart(10, '0')), fields.concat('Status: install ok ' + state).join('\n') + '\n');
    }
  });

  for (const name of requested) {
    const usage = path.join(portDir(name), 'usage');
    if (fs.existsSync(usage)) process.stdout.write(fs.readFileSync(usage, 'utf8') + '\n');
    else printTargets(name);
  }
  say('All requested installations completed successfully in: 1.2 s');
}

if (args[0] === 'add' && args[1] === 'port') addPort();
else if (args[0] === 'install') install();
else if (args[0] === 'print-usage') printUsage();
else {
  say('error: fake vcpkg does not know ' + args.join(' '));
  process.exit(1);
}
process.exit(0);
