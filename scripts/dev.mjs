// Runs the server (restarting on change) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node --watch-path=server --watch-path=shared server/index.ts', { stdio: 'inherit', shell: true }),
  spawn('pnpm exec vite', { stdio: 'inherit', shell: true }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
