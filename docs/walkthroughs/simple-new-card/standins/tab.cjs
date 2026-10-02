// A stand-in for `claude` in a card's tab (§87's walkthrough): the launcher starts it in the
// console and types into that console; this reads the keys raw and writes each one to a file, so
// the walkthrough can see exactly what arrived. Exits when a line says bye, or after 90 s.
const fs = require('node:fs');
const out = process.argv[2];
fs.writeFileSync(out, '');
// What Claude Code shows under its input box: the launcher types nothing until it sees this.
process.stdout.write('\n> \n  ? for shortcuts\n');
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
let line = '';
process.stdin.on('data', (chunk) => {
  fs.appendFileSync(out, chunk);
  line += chunk;
  if (/bye\r?\n?$/.test(line) || /bye\r$/.test(line)) process.exit(0);
  if (chunk.includes('\r')) line = '';
});
setTimeout(() => process.exit(0), 90_000);
