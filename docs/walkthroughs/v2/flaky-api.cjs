// A stand-in API for walk-v2: answers on the port given and stays up. While <dir>/<name>.hang exists
// it stops answering but keeps running (a hung process, not a crashed one), so the Switchboard can
// show it unhealthy; when the file goes, it answers again.
const http = require('node:http');
const fs = require('node:fs');
const [port, name, dir] = [Number(process.argv[2]), process.argv[3] || 'api', process.argv[4] || '.'];
const flag = `${dir}/${name}.hang`;
const server = http.createServer((req, res) => { console.log(`${name} ${req.method} ${req.url}`); res.end(`${name} ${req.url}`); });
let listening = false;
const open = () => server.listen(port, '127.0.0.1', () => { listening = true; console.log(`${name} listening on ${port}`); });
open();
setInterval(() => {
  const hang = fs.existsSync(flag);
  if (hang && listening) { listening = false; server.close(); console.log(`${name} hung (stopped answering)`); }
  if (!hang && !listening && !server.listening) open();
}, 500);
