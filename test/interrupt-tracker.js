'use strict';
// Drives src/gdb/interrupt-tracker.js through one debug session's messages, with a fake
// helper whose program state the steps set:
//
//   interrupt-tracker.js '[{"event": "process", "body": {"systemProcessId": 42}}, {"request": "setBreakpoints", "seq": 5}, {"wait": 200}]'
//
// Steps, one key each:
//   {"request": "<command>", "seq": n}        VS Code sends the debug adapter a request
//   {"response": "<command>", "seq": n}       the adapter answers request n ("success": false to fail it)
//   {"event": "<event>", "body": {...}}       the adapter sends an event
//   {"program": "running"}                    what the helper finds: running, stopped, gone or "error <message>"
//   {"wait": ms}
// Prints `> <step>`, then what the helper was asked (repeats of the same question once) and
// the log lines, without their time, since the step before.
//
//   EXT_DIR  extension to load (default: this repository)
//   WAIT_MS  how long the tracker waits for an answer (default: 60)

const path = require('path');

const EXT_DIR = process.env.EXT_DIR || path.resolve(__dirname, '..');
const { InterruptTracker } = require(path.join(EXT_DIR, 'src/gdb/interrupt-tracker'));

const steps = JSON.parse(process.argv[2]);
let program = 'running';
let out = [];
const said = (line) => {
  if (out[out.length - 1] !== line) out.push(line);
};
const helper = {
  state: async (pid, bits) => {
    said('helper: state ' + pid + (bits === 32 ? ' (32-bit)' : ''));
    return program;
  },
  breakInto: async (pid, bits) => {
    said('helper: break ' + pid + (bits === 32 ? ' (32-bit)' : ''));
    return program === 'running' ? 'break' : program;
  }
};
const tracker = new InterruptTracker({
  helper,
  gdb: 'gdb 11.2',
  log: (line) => said('log: ' + line.replace(/^\[[^\]]*\] /, '')),
  waitMs: Number(process.env.WAIT_MS || 60)
});

(async () => {
  for (const step of steps) {
    console.log('> ' + JSON.stringify(step));
    if (step.request) tracker.onWillReceiveMessage({ type: 'request', seq: step.seq, command: step.request, arguments: {} });
    else if (step.response) tracker.onDidSendMessage({ type: 'response', request_seq: step.seq, command: step.response, success: step.success !== false });
    else if (step.event) tracker.onDidSendMessage({ type: 'event', event: step.event, body: step.body || {} });
    else if (step.program) program = step.program;
    else if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
    for (const line of out) console.log('  ' + line);
    out = [];
  }
})();
