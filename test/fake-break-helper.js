'use strict';
// Plays break-helper.ps1 for cases/gdb.sh: `ready`, then `running` to every `state <pid>` and `break`
// to every `break <pid>`. With an argument, starts with `error <argument>` and exits instead.
// A request for pid 666 makes it exit with code 3 without answering.

if (process.argv[2]) {
  process.stdout.write('error ' + process.argv[2] + '\n');
  process.exit(1);
}
process.stdout.write('ready\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const [command, pid] = buffer.slice(0, end).trim().split(' ');
    buffer = buffer.slice(end + 1);
    if (pid === '666') process.exit(3);
    process.stdout.write((command === 'break' ? 'break' : 'running') + '\n');
  }
});
