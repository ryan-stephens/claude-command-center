// A stand-in for a team's okteto helper (PLAN §114): writes okteto.yml in the API's folder the way such
// a helper does, with a fixed SSH port (remote: 22000) and a debugger forward beside the API's own.
const fs = require('node:fs');
const path = require('node:path');
const name = `${path.basename(process.cwd())}-dev`;
fs.writeFileSync('okteto.yml', `dev:\n  ${name}:\n    remote: 22000\n    forward:\n      - 8080:8080\n      - 5005:5005\n    sync:\n      - .:/src\n`);
console.log(`The manifest for ${name} is saved to okteto.yml. You may now run: okteto up`);
