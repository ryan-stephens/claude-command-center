// A stand-in compiling dev server for walkthroughs (PLAN §113): like webpack's, it serves and prints its
// address at once, says it didn't compile after a moment, then that it compiled, after the seconds given.
// node ui-compile.cjs <port> [seconds to compile, default 6]
const http = require('node:http');
const port = Number(process.argv[2]);
const secs = Number(process.argv[3] ?? 6);
http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>stand-in compiling ui</h1>'); }).listen(port, () => {
  console.log(`<i> [webpack-dev-server] Project is running at: http://localhost:${port}/`);
  setTimeout(() => console.log('Failed to compile.'), (secs * 1000) / 2);
  setTimeout(() => console.log(`webpack 5.98.0 compiled successfully in ${secs * 1000} ms`), secs * 1000);
});
setInterval(() => {}, 1000);
