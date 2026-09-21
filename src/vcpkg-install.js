'use strict';

/**
 * Install vcpkg: git clone it into a folder chosen by the user, then run its bootstrap script.
 * Offered as its own command, and as a choice in Set Up vcpkg's vcpkg picker (setup-picks.js)
 * when bootstrapping vcpkg for a project. Cloning and bootstrapping are in vcpkg/bootstrap.js,
 * running them is runVcpkg in vcpkg/tool.js.
 */

const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { log } = require('./log');
const { toPosix } = require('./paths');
const { isVcpkgRoot } = require('./presets/vcpkg');
const { bootstrapCommand, cloneArgs, REPO_URL } = require('./vcpkg/bootstrap');
const { runVcpkg } = require('./vcpkg/tool');

async function stat(p) {
  try {
    return await vscode.workspace.fs.stat(vscode.Uri.file(p));
  } catch (_) {
    return null;
  }
}

async function hasGit() {
  const result = await runVcpkg('git', ['--version'], { cwd: os.tmpdir(), env: process.env, platform: process.platform, onLine: () => {} });
  return result.code === 0;
}

/** Where to run `exe args`, logging what runs and its output as it comes. */
function runLogged(exe, args, { cwd, env, progress, token, message, label }) {
  progress.report({ message });
  log.appendLine('  $ ' + (label || [exe, ...args].join(' ')));
  return runVcpkg(exe, args, { cwd, env, platform: process.platform, token, onLine: (line) => log.appendLine('    ' + line) });
}

/** Why a run that did not succeed failed, as the log and the notifications say it. */
function failure(result) {
  return result.stopped ? 'was stopped' : result.error ? 'could not run: ' + result.error : 'failed with exit code ' + result.code;
}

/**
 * Clones and bootstraps vcpkg into a folder the user picks (as `<picked>/vcpkg`), asked with
 * `title`. Returns the folder it was installed into, or null when it was cancelled, declined
 * or failed -- the reason is logged and shown either way.
 */
async function installVcpkg(title) {
  log.header('install vcpkg');
  if (!(await hasGit())) {
    log.appendLine('  ! git is not on PATH: install it, then try again');
    const pick = await vscode.window.showErrorMessage('Qt Workbench: git is not on PATH. Install it from git-scm.com, then Install vcpkg again.', 'Open git-scm.com');
    if (pick) vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
    return null;
  }

  const picked = await vscode.window.showOpenDialog({
    title: title + ': Folder for vcpkg',
    openLabel: 'Clone vcpkg Here',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(os.homedir())
  });
  if (!picked || picked.length === 0) return null;
  const dir = path.join(picked[0].fsPath, 'vcpkg');
  if (await stat(dir)) {
    log.appendLine('  ! ' + toPosix(dir) + ' already exists: choose another folder, or remove it first');
    vscode.window.showErrorMessage('Qt Workbench: ' + toPosix(dir) + ' already exists. Choose another folder, or remove it first.');
    return null;
  }

  log.appendLine('  cloning ' + REPO_URL + ' into ' + toPosix(dir));
  log.show(true);
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Qt Workbench: install vcpkg', cancellable: true },
    async (progress, token) => {
      const cloned = await runLogged('git', cloneArgs(dir), { cwd: path.dirname(dir), env: process.env, progress, token, message: 'git clone' });
      if (cloned.code !== 0) return { step: 'clone', result: cloned };
      const { exe, args, label } = bootstrapCommand(process.platform);
      const bootstrapped = await runLogged(exe, args, { cwd: dir, env: process.env, progress, token, message: 'bootstrap-vcpkg', label });
      return { step: 'bootstrap', result: bootstrapped };
    }
  );

  if (outcome.result.code !== 0) {
    const why = failure(outcome.result);
    log.appendLine('  ! ' + outcome.step + ' ' + why);
    const pick = await vscode.window.showErrorMessage('Qt Workbench: installing vcpkg ' + why + ' (' + outcome.step + ').', 'Show Log');
    if (pick) log.show(true);
    return null;
  }
  if (!(await isVcpkgRoot(dir))) {
    log.appendLine('  ! ' + toPosix(dir) + ' does not look like vcpkg after bootstrapping');
    vscode.window.showErrorMessage('Qt Workbench: ' + toPosix(dir) + ' does not look like vcpkg after bootstrapping.');
    return null;
  }
  log.appendLine('  vcpkg installed in ' + toPosix(dir));
  return dir;
}

function registerVcpkgInstall(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('qtWorkbench.installVcpkg', async () => {
      try {
        const dir = await installVcpkg('Install vcpkg');
        if (!dir) return;
        const pick = await vscode.window.showInformationMessage(
          'Qt Workbench: vcpkg installed in ' + toPosix(dir) + '.',
          'Set Up vcpkg with CMake Presets...'
        );
        if (pick) vscode.commands.executeCommand('qtWorkbench.setUpVcpkg');
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    })
  );
}

module.exports = { installVcpkg, registerVcpkgInstall };
