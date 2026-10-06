// The chimes as WAV clips (PLAN §96): the same notes the Web Audio version played, rendered once to
// samples so an <audio> element plays them. Making an AudioContext blocked the page for ~200 ms on
// Windows, the first time a session finished or needed you; an <audio> element plays off the main
// thread. Pure, tested.

const RATE = 22050;

/** Sine notes `step` seconds apart, each rising to `peak` in 10 ms and fading by 0.25 s; 16-bit mono WAV. */
export function chimeWav(freqs: number[], peak: number, step = 0.12): Uint8Array<ArrayBuffer> {
  const noteLen = 0.3;
  const total = Math.ceil(((freqs.length - 1) * step + noteLen) * RATE);
  const samples = new Float32Array(total);
  const floor = 0.0001;
  freqs.forEach((freq, i) => {
    const start = Math.round(i * step * RATE);
    for (let n = 0; n < noteLen * RATE && start + n < total; n++) {
      const t = n / RATE;
      // The exponential ramps of the Web Audio version: floor → peak by 10 ms, → floor by 250 ms.
      const g = t < 0.01 ? floor * (peak / floor) ** (t / 0.01) : t < 0.25 ? peak * (floor / peak) ** ((t - 0.01) / 0.24) : floor;
      samples[start + n] += g * Math.sin(2 * Math.PI * freq * t);
    }
  });
  const bytes = new Uint8Array(44 + total * 2);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, total * 2, true);
  for (let i = 0; i < total; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return bytes;
}
