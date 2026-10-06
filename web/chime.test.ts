import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chimeWav } from './chime.ts';

test('a chime is a 16-bit mono WAV as long as its notes, never clipping', () => {
  const two = chimeWav([660, 880], 0.2);
  const v = new DataView(two.buffer);
  const text = (at: number, n: number) => String.fromCharCode(...two.slice(at, at + n));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint16(34, true), 16); // bits
  const rate = v.getUint32(24, true);
  const samples = v.getUint32(40, true) / 2;
  assert.equal(two.length, 44 + samples * 2);
  assert.ok(Math.abs(samples / rate - 0.42) < 0.01, `${samples / rate} s`);
  let peak = 0;
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(v.getInt16(44 + i * 2, true)));
  assert.ok(peak > 0.15 * 0x7fff && peak < 0.3 * 0x7fff, `peak ${peak / 0x7fff}`);
  assert.ok(Math.abs(chimeWav([520], 0.1).length - (44 + Math.ceil(0.3 * rate) * 2)) <= 2);
});
