// Run before pnpm start / dev / doctor: cc-control needs Node 24 (node:sqlite, TypeScript run
// directly, the Windows certificate store). Older Nodes fail while loading with errors that don't
// say that, so say it here, plainly.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`cc-control needs Node.js 24 or later; this is ${process.versions.node}.`);
  console.error('Install Node 24 LTS (https://nodejs.org, or: winget install OpenJS.NodeJS.LTS), open a new terminal, and check with node -v.');
  process.exit(1);
}
