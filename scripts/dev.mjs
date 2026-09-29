// Runs the server (restarting on change) and the Vite dev server together.
import { spawn, spawnSync } from 'node:child_process';

const procs = [
  spawn('node --watch-path=server --watch-path=shared server/index.ts', { stdio: 'inherit', shell: true }),
  spawn('pnpm exec vite', { stdio: 'inherit', shell: true }),
];

// With shell: true, kill() only reaches the shell; on Windows that orphans `node --watch`, which keeps the port.
function killTree(p) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill();
}
const stop = () => { for (const p of procs) killTree(p); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
