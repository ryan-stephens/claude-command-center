import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findForwards, rewriteForward } from './okteto.ts';

const V1 = `name: orders-api
image: registry.example/dotnet-dev:8
command: ["bash"]
sync:
  - .:/usr/src/app
forward:
  - 8080:8080
  - "5005:5005"   # debugger
  - 9229:web:9229
`;

test('a manifest’s forwards are read, in their forms', () => {
  assert.deepEqual(findForwards(V1), [{ local: 8080, remote: 8080 }, { local: 5005, remote: 5005 }, { local: 9229, remote: 9229 }]);
  assert.deepEqual(findForwards('dev:\n  api:\n    forward:\n      - localPort: 8080\n        remotePort: 80\n        name: web\n      - localPort: 5005\n        remotePort: 5005\n'), [{ local: 8080, remote: 80 }, { local: 5005, remote: 5005 }]);
  assert.deepEqual(findForwards('name: x\nsync:\n  - .:/app\n'), []);
});

test('one forward’s local side is changed: the one for the container port asked for, else the first', () => {
  const out = rewriteForward(V1, 18000, 8080);
  assert.match(out, /forward:\n  - 18000:8080\n  - "5005:5005"   # debugger\n  - 9229:web:9229\n/, 'only that line, the rest exactly as it was');
  assert.match(rewriteForward(V1, 18000, 5005), /- "18000:5005"   # debugger/);
  assert.match(rewriteForward(V1, 18000, 9229), /- 18000:web:9229/);
  assert.match(rewriteForward(V1, 18000, 4444), /- 18000:8080\n/, 'no forward for that port: the first');
  assert.match(rewriteForward(V1, 18000), /- 18000:8080\n/);
  const obj = rewriteForward('dev:\r\n  api:\r\n    forward:\r\n      - localPort: 8080\r\n        remotePort: 80\r\n      - localPort: 5005\r\n        remotePort: 5005\r\n', 18001, 5005);
  assert.ok(obj.includes('      - localPort: 18001\r\n        remotePort: 5005'), 'the object form, and CRLF kept');
  assert.ok(obj.includes('      - localPort: 8080\r\n        remotePort: 80'));
  assert.throws(() => rewriteForward('name: x\n', 18000), /no forward: line/);
});
