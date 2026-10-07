// A stand-in `nx serve <app> --proxyConfig=<file> [--port N]` (PLAN §114). Without --port it serves on the
// project's own port, 4216; when that is taken it asks, as the Angular dev server does, and waits for an
// answer that never comes. It serves the proxy file it was given, so a walk can see which API it points at.
const fs = require('node:fs');
const http = require('node:http');
const a = process.argv.slice(2);
const flag = (n) => { const i = a.findIndex((x) => x === n || x.startsWith(`${n}=`)); if (i < 0) return undefined; return a[i].includes('=') ? a[i].split('=').slice(1).join('=') : a[i + 1]; };
const port = Number(flag('--port') ?? 4216);
const proxy = flag('--proxyConfig');
const s = http.createServer((q, r) => r.end(proxy ? fs.readFileSync(proxy, 'utf8') : 'no proxy'));
s.on('error', () => { console.log(`? Port ${port} is already in use.\nWould you like to use a different port? (Y/n)`); setInterval(() => {}, 1000); });
s.listen(port, '127.0.0.1', () => {
  console.log(`NX Web Development Server is listening at http://localhost:${port}/`);
  setTimeout(() => console.log('webpack compiled successfully'), 1500);
});
