// Seeds a test DB for walk-v2: one workspace of stand-in repos, with a stack of one UI and four APIs.
//   node docs/walkthroughs/v2/seed-v2.ts <db file> <repos folder> <standins folder>
import { saveStack } from '../../../server/stack.ts';
import { Store } from '../../../server/store.ts';

const [db, dir, standins] = process.argv.slice(2);
const store = new Store(db);
const repos = ['shop-ui', 'fees-api', 'payments-api', 'loans-api', 'audit-api'].map((r) => `${dir}/${r}`);
store.saveWorkspace({ id: 'ws-v2', name: 'Shop (walk)', color: 'orange', repos, home: `${dir}/fees-api`, notes: 'Made-up workspace for the v2 walk.' });
saveStack(store, 'ws-v2', {
  choose: { env: ['dev', 'uat'] },
  api: {
    steps: [`wait:"listening on" node ${standins}/flaky-api.cjs {{port}} {{name}} ${dir}`],
    proxy: { '/api/{{route}}/**': { target: 'http://localhost:{{port}}' } },
  },
  apis: [
    { repo: 'fees-api', values: { name: 'fees-api', route: 'fees' } },
    { repo: 'payments-api', values: { name: 'payments-api', route: 'payments' } },
    { repo: 'loans-api', values: { name: 'loans-api', route: 'loans' } },
    { repo: 'audit-api', values: { name: 'audit-api', route: 'audit' } },
  ],
  ui: { repo: 'shop-ui', proxyFile: 'proxy.conf.json', steps: [`wait:"Local:" node ${standins}/../simple-new-card/standins/ui.cjs {{uiPort}}`], url: 'http://localhost:4316' },
});
store.close();
console.log('seeded');
