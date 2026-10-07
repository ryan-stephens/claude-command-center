// A stand-in `okteto` (PLAN §114). `okteto up [-f manifest]`: like the real one, it holds the local side
// of every forward and the remote: SSH port, failing as okteto does when one is already in use; the
// first forward's local port is the API, which answers "api <folder>". `okteto down`: exits.
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const a = process.argv.slice(2);
if (a[0] !== 'up') process.exit(0);
const file = a.includes('-f') ? a[a.indexOf('-f') + 1] : 'okteto.yml';
const text = fs.readFileSync(file, 'utf8');
const fwd = [...text.matchAll(/-\s*(\d+):(\d+)/g)].map((m) => Number(m[1]));
const remote = /remote:\s*(\d+)/.exec(text);
const name = path.basename(process.cwd());
const fail = (p) => { console.log(`x Couldn't connect to your development container: local port ${p} is already in-use in your local machine`); process.exit(1); };
const hold = [...fwd.slice(1), ...(remote ? [Number(remote[1])] : [])];
let left = hold.length + 1;
const ready = () => { if (--left === 0) console.log(`Now listening on: http://[::]:${fwd[0]}`); };
for (const p of hold) net.createServer().listen(p, '127.0.0.1', ready).on('error', () => fail(p));
http.createServer((q, r) => r.end(`api ${name}`)).listen(fwd[0], '127.0.0.1', ready).on('error', () => fail(fwd[0]));
console.log(`i Forwarding ${fwd.join(', ')}${remote ? `; SSH on ${remote[1]}` : '; SSH on a port okteto picks'}`);
