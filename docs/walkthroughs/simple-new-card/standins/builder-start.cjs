// A stand-in for starting the test-data tool from Verify (PLAN §135), with made-up data: what the
// Verify file's "launch" runs. `node builder-start.cjs <port> <delay ms>` prints a few build-like
// lines, then after the delay answers GET /api/scenarios on 127.0.0.1:<port> with one scenario, and
// keeps running until it is stopped. `node builder-start.cjs fail` prints an error and exits 3, as a
// tool that can't start would.
const http = require('node:http');

if (process.argv[2] === 'fail') {
  console.log('Sample build: restoring packages');
  console.error('Sample error: the made-up project file was not found');
  process.exit(3);
}
const port = Number(process.argv[2] || 18909);
const delay = Number(process.argv[3] || 1500);
console.log('Sample build: restoring packages');
console.log('Sample build: compiling');
setTimeout(() => {
  http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && p === '/api/scenarios') return res.end(JSON.stringify([{ scenarioId: 'sc-started', versionNumber: 1, name: 'Sample started here', createdAtUtc: '2026-01-05T00:00:00Z', isLocked: false, tags: ['sample'] }]));
    res.statusCode = 404;
    res.end('{}');
  }).listen(port, '127.0.0.1', () => console.log(`Sample tool listening on http://127.0.0.1:${port}`));
}, delay);
