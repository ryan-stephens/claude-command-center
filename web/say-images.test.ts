import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_IMAGE_BYTES, pickImages } from './say-images.ts';

const png = (size = 1000, name = 'a.png') => ({ type: 'image/png', size, name });

test('§116: which pasted, dropped or picked files go in a message', () => {
  assert.deepEqual(pickImages(0, [png(), png()]), { take: [0, 1] });
  assert.deepEqual(pickImages(0, [{ type: 'text/plain', size: 10 }, png()]), { take: [1] }, 'images only, by their place in the list');
  assert.deepEqual(pickImages(0, [{ type: 'application/pdf', size: 10 }]), { take: [], note: 'Only PNG, JPEG, GIF or WebP images can go in a message' });
  assert.deepEqual(pickImages(0, []), { take: [] }, 'nothing given: nothing said');
  assert.deepEqual(pickImages(4, [png(), png(), png()]), { take: [0], note: 'Up to 5 images per message' });
  assert.deepEqual(pickImages(5, [png()]), { take: [], note: 'Up to 5 images per message' });
  assert.deepEqual(pickImages(0, [png(), png(MAX_IMAGE_BYTES + 1, 'huge.png')]), { take: [], note: 'huge.png is over 5 MB' });
});
