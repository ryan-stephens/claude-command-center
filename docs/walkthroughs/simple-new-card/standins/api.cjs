// A stand-in API for walkthroughs: answers "api <name>" on the port given, and stays up.
const http = require('node:http');
const port = Number(process.argv[2]);
const name = process.argv[3] || 'api';
http.createServer((req, res) => res.end(`${name} ${req.url}`)).listen(port, () => console.log(`${name} listening on ${port}`));
