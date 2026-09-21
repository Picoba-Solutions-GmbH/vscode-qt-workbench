'use strict';

/**
 * Stops a running program for gdb. Node can't call DebugBreakProcess, so break-helper.ps1
 * does, in a Windows PowerShell process that is started once and answers one request per
 * line. A 32-bit program is stopped from the 32-bit PowerShell.
 */

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'break-helper.ps1');

/** The Windows PowerShell running break-helper.ps1 for programs of `bits`. */
function powershell(bits) {
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const system = bits === 32 && process.arch !== 'ia32' ? 'SysWOW64' : 'System32';
  return {
    command: path.join(windows, system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT]
  };
}

/** One helper process: requests go out in order, answers come back in order. */
class HelperProcess {
  constructor({ command, args }) {
    this.failure = null;
    this.waiters = [];
    this.child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
      }
    });
    this.child.stdin.on('error', () => {}); // the exit handler reports it
    this.child.on('error', (err) => this.fail(err.message));
    this.child.on('exit', (code) => this.fail('the helper exited with code ' + code));
    // null once ready, else what went wrong
    this.ready = this.next().then((line) => (line === 'ready' ? null : line.replace(/^error /, '')));
  }

  fail(why) {
    if (!this.failure) this.failure = why;
    for (const waiter of this.waiters.splice(0)) waiter('error ' + this.failure);
  }

  next() {
    return new Promise((resolve) => {
      if (this.failure) resolve('error ' + this.failure);
      else this.waiters.push(resolve);
    });
  }

  async ask(request) {
    const problem = await this.ready;
    if (problem) return 'error ' + problem;
    const answer = this.next();
    if (!this.failure) this.child.stdin.write(request + '\n');
    return answer;
  }

  dispose() {
    this.failure = this.failure || 'disposed';
    this.child.stdin.end();
    this.child.kill();
  }
}

class BreakHelper {
  /** launch(bits) -> {command, args}: how to start the helper; tests start a fake one. */
  constructor({ launch = powershell } = {}) {
    this.launch = launch;
    this.processes = new Map(); // bits -> HelperProcess
  }

  process(bits) {
    const key = bits === 32 ? 32 : 64;
    if (!this.processes.has(key)) this.processes.set(key, new HelperProcess(this.launch(key)));
    return this.processes.get(key);
  }

  /** Start the helper ahead of the first request. Resolves null, or what went wrong. */
  start(bits = 64) {
    return this.process(bits).ready;
  }

  /** 'running', 'stopped', 'gone' or 'error <message>'. */
  state(pid, bits) {
    return this.process(bits).ask('state ' + pid);
  }

  /** 'break' when it stopped the program, else as state(). */
  breakInto(pid, bits) {
    return this.process(bits).ask('break ' + pid);
  }

  dispose() {
    for (const helper of this.processes.values()) helper.dispose();
    this.processes.clear();
  }
}

module.exports = { BreakHelper, powershell };
