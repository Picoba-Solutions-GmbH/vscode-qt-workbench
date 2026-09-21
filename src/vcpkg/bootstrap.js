'use strict';

/**
 * Installing vcpkg itself: git clone it into a folder, then run its bootstrap script.
 * Running the commands is runVcpkg in tool.js, which runs any executable, not just vcpkg's.
 */

const path = require('path');

const REPO_URL = 'https://github.com/microsoft/vcpkg.git';

/** The arguments of git clone cloning vcpkg into `dir`, which must not exist yet. */
function cloneArgs(dir) {
  return ['clone', '--depth', '1', REPO_URL, dir];
}

/**
 * The executable and arguments of vcpkg's bootstrap script, run with `dir` as the working
 * folder. On Windows the .bat needs cmd.exe: spawn cannot run it directly.
 */
function bootstrapCommand(platform) {
  return platform === 'win32'
    ? { exe: 'cmd.exe', args: ['/d', '/s', '/c', 'bootstrap-vcpkg.bat', '-disableMetrics'], label: 'bootstrap-vcpkg.bat -disableMetrics' }
    : { exe: path.join('.', 'bootstrap-vcpkg.sh'), args: ['-disableMetrics'], label: 'bootstrap-vcpkg.sh -disableMetrics' };
}

module.exports = { REPO_URL, cloneArgs, bootstrapCommand };
