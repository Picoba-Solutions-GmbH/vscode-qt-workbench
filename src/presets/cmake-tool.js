'use strict';

/**
 * Whether cmake and winget are on PATH, and the winget command that installs CMake. Running a
 * command is runVcpkg in vcpkg/tool.js, which runs any executable, not just vcpkg's.
 */

const os = require('os');
const { runVcpkg } = require('../vcpkg/tool');

const CMAKE_WINGET_ID = 'Kitware.CMake';

/** The arguments of winget install installing CMake, accepting its and winget's own agreements. */
function wingetInstallArgs() {
  return ['install', '--id', CMAKE_WINGET_ID, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'];
}

/** The first line of `cmd --version`'s output, or null when it is not on PATH or fails. */
async function versionOf(cmd, env, platform) {
  const result = await runVcpkg(cmd, ['--version'], { cwd: os.tmpdir(), env, platform, onLine: () => {} });
  if (result.code !== 0) return null;
  const first = String(result.output).split(/\r?\n/)[0] || '';
  return first.trim() || null;
}

module.exports = { CMAKE_WINGET_ID, wingetInstallArgs, versionOf };
