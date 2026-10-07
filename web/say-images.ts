// Images in a message (PLAN §116): pasted, dropped or picked into the card chat's box (and the
// full-screen session's), sent with the message as the SDK takes them (base64, at most 5 of up to
// 5 MB each, as the server checks too).
import type { ImageAttachment } from '../shared/protocol.ts';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image waiting in a box: what is sent, and a preview URL for the thumbnail. */
export type Pasted = ImageAttachment & { url: string };

/** What sending says when there is no text, only images. */
export const IMAGE_ONLY_TEXT = 'What do you see in this image?';

/**
 * Which of the files given go in, beside `have` already waiting: images only, none over 5 MB (then
 * none at all, and why), and no more than 5 in all (the rest left out, and why).
 */
export function pickImages(have: number, files: { type: string; size: number; name?: string }[]): { take: number[]; note?: string } {
  const images = files.map((f, i) => ({ f, i })).filter(({ f }) => IMAGE_TYPES.includes(f.type));
  if (!images.length) return { take: [], ...(files.length ? { note: 'Only PNG, JPEG, GIF or WebP images can go in a message' } : {}) };
  const big = images.find(({ f }) => f.size > MAX_IMAGE_BYTES);
  if (big) return { take: [], note: `${big.f.name || 'That image'} is over 5 MB` };
  const room = Math.max(0, MAX_IMAGES - have);
  return { take: images.slice(0, room).map(({ i }) => i), ...(images.length > room ? { note: 'Up to 5 images per message' } : {}) };
}

/** Read an image file for sending: base64 without the data: prefix, plus a preview URL. */
export function readImage(file: File): Promise<Pasted> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve({ mediaType: file.type as ImageAttachment['mediaType'], data: url.slice(url.indexOf(',') + 1), url });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
