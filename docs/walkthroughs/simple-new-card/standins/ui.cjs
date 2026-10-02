// A stand-in UI for walkthroughs: serves a page on the port given and prints its address, the way a dev server does.
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<h1>stand-in ui</h1><p>${req.url}</p>`); }).listen(port, () => console.log(`Local: http://localhost:${port}/`));
