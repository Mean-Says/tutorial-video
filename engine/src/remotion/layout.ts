import type { CameraKey, CursorKey } from '../schema.ts';

export const CANVAS = { w: 1920, h: 1080 };

export interface StepLayout {
  /** Window frame (bar + content) position and size on the canvas. */
  x: number;
  y: number;
  fw: number;
  fh: number;
  bar: number;
  /** Content (the recorded page) size. */
  cw: number;
  ch: number;
  captionTop: number;
}

/** Frame as large as possible while leaving a band under it for the step caption. */
export function stepLayout(aspect: number, janela: boolean): StepLayout {
  const bar = janela ? 40 : 0;
  const maxW = 1640;
  const maxH = 860;
  let cw = maxW;
  let ch = cw / aspect;
  if (ch + bar > maxH) {
    ch = maxH - bar;
    cw = ch * aspect;
  }
  cw = Math.round(cw);
  ch = Math.round(ch);
  const fh = ch + bar;
  const x = Math.round((CANVAS.w - cw) / 2);
  const y = 34;
  return { x, y, fw: cw, fh, bar, cw, ch, captionTop: y + fh + 22 };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Eased interpolation over keyframes sorted by `f`; holds the first/last value outside the range. */
export function sampleKeys<K extends { f: number }>(keys: K[], frame: number, mix: (a: K, b: K, t: number) => K): K {
  if (keys.length === 0) throw new Error('sampleKeys: no keys');
  if (frame <= keys[0]!.f) return keys[0]!;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (frame <= b.f) return mix(a, b, easeInOutCubic((frame - a.f) / Math.max(1, b.f - a.f)));
  }
  return keys.at(-1)!;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function cameraAt(keys: CameraKey[], frame: number): CameraKey {
  const k = sampleKeys(keys, frame, (a, b, t) => ({ f: frame, z: lerp(a.z, b.z, t), cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t) }));
  const z = Math.max(1, k.z);
  const half = 0.5 / z;
  return { ...k, z, cx: Math.min(1 - half, Math.max(half, k.cx)), cy: Math.min(1 - half, Math.max(half, k.cy)) };
}

export function cursorAt(keys: CursorKey[], frame: number): CursorKey {
  return sampleKeys(keys, frame, (a, b, t) => ({ f: frame, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }));
}

/** CSS transform that shows the camera view of a cw×ch layer (transform-origin 0 0). */
export function cameraTransform(cam: CameraKey, cw: number, ch: number): string {
  const tx = cw / 2 - cam.cx * cw * cam.z;
  const ty = ch / 2 - cam.cy * ch * cam.z;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${cam.z.toFixed(4)})`;
}
