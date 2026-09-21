'use strict';

/**
 * Install CMake: on Windows, winget install Kitware.CMake, offered from Set Up vcpkg when no
 * cmake is on PATH, and as its own command. Elsewhere there is no one package manager to run,
 * so this only points at cmake.org. If CMake Tools has no cmake.cmakePath set, it is pointed at
 * the installed cmake.exe, so the extension finds it without a window reload.
 * Whether cmake and winget are on PATH, and the install arguments, are in presets/cmake-tool.js.
 */

const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { log } = require('./log');
const { toPosix } = require('./paths');
const { CMAKE_WINGET_ID, versionOf, wingetInstallArgs } = require('./presets/cmake-tool');
const { runVcpkg } = require('./vcpkg/tool');

const CMAKE_DOWNLOAD = 'https://cmake.org/download/';

async function exists(p) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(p));
    return true;
  } catch (_) {
    return false;
  }
}

function openCMakeOrg() {
  vscode.env.openExternal(vscode.Uri.parse(CMAKE_DOWNLOAD));
}

/** ms-vscode.cmake-tools once it is installed and its configuration registered, or null after `timeoutMs`. */
function waitForCMakeTools(timeoutMs = 15000) {
  const found = vscode.extensions.getExtension('ms-vscode.cmake-tools');
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const done = (ext) => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(ext);
    };
    const timer = setTimeout(() => done(vscode.extensions.getExtension('ms-vscode.cmake-tools') || null), timeoutMs);
    const subscription = vscode.extensions.onDidChange(() => {
      const ext = vscode.extensions.getExtension('ms-vscode.cmake-tools');
      if (ext) done(ext);
    });
  });
}

/**
 * Installs CMake with winget on Windows, after asking. Elsewhere, and when winget is not on
 * PATH, only points at cmake.org. Returns the cmake.exe it installed, or null when it was
 * cancelled, declined, not needed or not possible -- the reason is logged and shown either way.
 */
async function installCMake() {
  log.header('install CMake');
  const already = await versionOf('cmake', process.env, process.platform);
  if (already) {
    log.appendLine('  cmake is already on PATH: ' + already);
    vscode.window.showInformationMessage('Qt Workbench: CMake is already installed (' + already + ').');
    return null;
  }

  if (process.platform !== 'win32') {
    log.appendLine('  ! not on Windows: install CMake with your package manager, or from ' + CMAKE_DOWNLOAD);
    const pick = await vscode.window.showInformationMessage('Qt Workbench: install CMake with your package manager, or from cmake.org.', 'Open cmake.org');
    if (pick) openCMakeOrg();
    return null;
  }
  if (!(await versionOf('winget', process.env, process.platform))) {
    log.appendLine('  ! winget is not on PATH: install CMake from ' + CMAKE_DOWNLOAD);
    const pick = await vscode.window.showErrorMessage('Qt Workbench: winget is not on PATH. Install CMake from cmake.org.', 'Open cmake.org');
    if (pick) openCMakeOrg();
    return null;
  }

  const answer = await vscode.window.showWarningMessage(
    'Qt Workbench: install CMake with winget?',
    { modal: true, detail: 'Runs winget install --id ' + CMAKE_WINGET_ID + ' -e, which installs CMake for this machine.' },
    'Install'
  );
  if (answer !== 'Install') {
    log.appendLine('  not installed: declined');
    return null;
  }

  log.show(true);
  const args = wingetInstallArgs();
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Qt Workbench: winget install CMake', cancellable: true },
    (progress, token) => {
      progress.report({ message: 'winget install' });
      log.appendLine('  $ winget ' + args.join(' '));
      return runVcpkg('winget', args, { cwd: os.tmpdir(), env: process.env, platform: process.platform, token, onLine: (line) => log.appendLine('    ' + line) });
    }
  );
  if (result.code !== 0) {
    const why = result.stopped ? 'was stopped' : result.error ? 'could not run: ' + result.error : 'failed with exit code ' + result.code;
    log.appendLine('  ! winget install ' + why);
    const pick = await vscode.window.showErrorMessage('Qt Workbench: winget install CMake ' + why + '.', 'Show Log');
    if (pick) log.show(true);
    return null;
  }
  log.appendLine('  CMake installed');

  const candidates = [
    process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'CMake', 'bin', 'cmake.exe'),
    process.env['LOCALAPPDATA'] && path.join(process.env['LOCALAPPDATA'], 'Programs', 'CMake', 'bin', 'cmake.exe')
  ].filter(Boolean);
  let exe = null;
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      exe = candidate;
      break;
    }
  }
  let cmakeTools = vscode.extensions.getExtension('ms-vscode.cmake-tools');
  if (!cmakeTools) {
    const pick = await vscode.window.showInformationMessage(
      'Qt Workbench: CMake installed. Install the CMake Tools extension too, to use it from VS Code?',
      'Install CMake Tools Extension'
    );
    if (pick === 'Install CMake Tools Extension') {
      log.appendLine('  installing the CMake Tools extension');
      await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.cmake-tools');
      cmakeTools = await waitForCMakeTools();
      log.appendLine('  ' + (cmakeTools ? 'CMake Tools extension installed' : 'CMake Tools extension: still not found after installing'));
    }
  }

  if (exe && cmakeTools && !vscode.workspace.getConfiguration('cmake').get('cmakePath')) {
    await vscode.workspace.getConfiguration('cmake').update('cmakePath', exe, vscode.ConfigurationTarget.Global);
    log.appendLine('  cmake.cmakePath set to ' + toPosix(exe) + ' (user settings), so CMake Tools finds it without a window reload');
    vscode.window.showInformationMessage('Qt Workbench: CMake installed, cmake.cmakePath set to ' + toPosix(exe) + '.');
    return exe;
  }
  if (!exe) log.appendLine('  cmake.exe not found at the usual winget location: reload the window so PATH picks it up');
  else if (!cmakeTools) log.appendLine('  cmake.cmakePath not set: the CMake Tools extension is still not installed');
  else log.appendLine('  cmake.cmakePath left as it is: already set');

  const pick = await vscode.window.showInformationMessage('Qt Workbench: CMake installed. Reload the window if CMake Tools does not see it.', 'Reload Window');
  if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
  return exe;
}

function registerCMakeInstall(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('qtWorkbench.installCMake', async () => {
      try {
        await installCMake();
      } catch (err) {
        log.appendLine('  ! failed: ' + (err && err.stack ? err.stack : String(err)));
        vscode.window.showErrorMessage('Qt Workbench failed: ' + String(err));
      }
    })
  );
}

module.exports = { installCMake, registerCMakeInstall };
