// Phase 0 voice spike: serves spike/voice.html on http://localhost:7778 (loopback only).
// Run: pnpm spike:voice, then open the URL in Chrome and Edge and hold ` to talk.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 7778;
const page = new URL('./voice.html', import.meta.url);

createServer(async (req, res) => {
  if (req.url !== '/' && req.url !== '/voice.html') {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(await readFile(page));
}).listen(PORT, '127.0.0.1', () => {
  // localhost (not 127.0.0.1) so the browser treats it as a secure context for the mic.
  console.log(`voice spike: http://localhost:${PORT}  (hold \` to talk, Ctrl+C to stop)`);
});
