// A stand-in API for walkthroughs: answers "api <name>" on the port given, and stays up.
const http = require('node:http');
const port = Number(process.argv[2]);
const name = process.argv[3] || 'api';
// Each request is logged, the way an API does, so the Output view (§84) has lines to follow.
http.createServer((req, res) => { console.log(`${name} ${req.method} ${req.url}`); res.end(`${name} ${req.url}`); }).listen(port, () => console.log(`${name} listening on ${port}`));
