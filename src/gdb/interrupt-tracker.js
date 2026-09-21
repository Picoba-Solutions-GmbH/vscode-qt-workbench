'use strict';

/**
 * Watches one debug session's messages for the requests the C/C++ extension needs a stopped
 * program for -- breakpoint changes and Pause -- and stops the program when gdb doesn't.
 *
 * The C/C++ extension answers what it can do without gdb within milliseconds, and gives up
 * waiting for a breakpoint to bind after about 250 ms. A gdb that stops the program itself
 * does so within milliseconds too. So a request still unanswered after WAIT_MS, while the
 * program was running all along, is waiting for a stop that won't come: then the program is
 * stopped with the helper. gdb reports the stop, the C/C++ extension changes the breakpoints
 * and continues, or shows the pause.
 */

// Requests the C/C++ extension may need the program stopped for.
const NEEDS_STOP = new Set(['setBreakpoints', 'setFunctionBreakpoints', 'setExceptionBreakpoints', 'setDataBreakpoints', 'pause']);
// Requests whose success means the program runs again.
const RESUMES = new Set(['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'goto']);

const WAIT_MS = 150;
const POLL_MS = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class InterruptTracker {
  /**
   * helper: {state(pid, bits), breakInto(pid, bits)} as BreakHelper has them.
   * gdb: how the log names the debugger. log(line): the output channel.
   */
  constructor({ helper, gdb, log, waitMs = WAIT_MS }) {
    this.helper = helper;
    this.gdb = gdb;
    this.log = log;
    this.waitMs = waitMs;
    this.pid = 0;
    this.bits = 64;
    this.running = false;
    this.waiting = new Map(); // request seq -> command
    this.watching = null;
    this.reportedError = false;
  }

  /** A message from VS Code to the debug adapter. */
  onWillReceiveMessage(message) {
    if (!message || message.type !== 'request' || !NEEDS_STOP.has(message.command)) return;
    if (!this.running || !this.pid) return;
    this.waiting.set(message.seq, message.command);
    if (!this.watching) {
      this.watching = this.watch().finally(() => {
        this.watching = null;
      });
    }
  }

  /** A message from the debug adapter to VS Code. */
  onDidSendMessage(message) {
    if (!message) return;
    if (message.type === 'response') {
      // Pause is answered at once; what it waits for is the stop.
      if (this.waiting.get(message.request_seq) !== 'pause') this.waiting.delete(message.request_seq);
      if (message.success && RESUMES.has(message.command)) this.running = true;
      return;
    }
    if (message.type !== 'event') return;
    const body = message.body || {};
    if (message.event === 'process') {
      this.pid = body.systemProcessId || 0;
      this.bits = body.pointerSize === 32 ? 32 : 64;
      this.running = true;
    } else if (message.event === 'continued') {
      this.running = true;
    } else if (message.event === 'stopped') {
      this.running = false;
      this.waiting.clear();
    } else if (message.event === 'exited' || message.event === 'terminated') {
      this.running = false;
      this.pid = 0;
      this.waiting.clear();
    }
  }

  async watch() {
    const deadline = Date.now() + this.waitMs;
    while (this.waiting.size > 0 && this.running && this.pid) {
      const pid = this.pid;
      const what = [...new Set(this.waiting.values())].join(', ');
      if (Date.now() >= deadline) {
        this.waiting.clear();
        this.report(await this.helper.breakInto(pid, this.bits), what, pid);
        return;
      }
      const state = await this.helper.state(pid, this.bits);
      if (state !== 'running') {
        // Stopped: gdb stopped it, or it hit a breakpoint. Gone: nothing to stop.
        this.waiting.clear();
        this.report(state, what, pid);
        return;
      }
      await sleep(POLL_MS);
    }
  }

  report(result, what, pid) {
    const time = '[' + new Date().toLocaleTimeString() + '] ';
    if (result === 'break') {
      this.log(time + 'stopped the running program (pid ' + pid + ') for ' + what + ': ' + this.gdb + ' does not stop it itself');
    } else if (result.startsWith('error ') && !this.reportedError) {
      this.reportedError = true;
      this.log(time + '! could not stop the running program for ' + what + ', breakpoints added while it runs may not bind: ' + result.slice(6));
    }
  }
}

module.exports = { InterruptTracker, NEEDS_STOP, WAIT_MS };
