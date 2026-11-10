import { spawn } from 'node:child_process';

/** Thin, typed wrappers around ffmpeg/ffprobe plus the pixel analysis the pipeline needs. */

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export function run(cmd: string, args: string[], onStdout?: (chunk: Buffer) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (c: Buffer) => (onStdout ? onStdout(c) : out.push(c)));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code: code ?? -1 }));
  });
}

export async function runOk(cmd: string, args: string[], onStdout?: (chunk: Buffer) => void): Promise<RunResult> {
  const r = await run(cmd, args, onStdout);
  if (r.code !== 0) throw new Error(`${cmd} falhou (código ${r.code}): ${r.stderr.trim().split('\n').slice(-5).join(' | ')}`);
  return r;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
}

export async function probe(file: string): Promise<VideoInfo> {
  const { stdout } = await runOk('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,avg_frame_rate,r_frame_rate:format=duration',
    '-of',
    'json',
    file,
  ]);
  const j = JSON.parse(stdout.toString()) as {
    streams?: Array<{ width: number; height: number; avg_frame_rate?: string; r_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  if (!s) throw new Error(`Sem stream de vídeo em ${file}`);
  const ratio = (r?: string) => {
    const [n, d] = (r ?? '0/1').split('/').map(Number);
    return d ? n! / d : 0;
  };
  return { width: s.width, height: s.height, duration: Number(j.format?.duration ?? 0), fps: ratio(s.avg_frame_rate) || ratio(s.r_frame_rate) };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanOptions {
  fps: number;
  width: number;
  pixFmt: 'rgb24' | 'gray';
  crop?: Box;
}

/**
 * Streams decoded frames at a fixed rate. The `fps=` filter comes first so frame N here
 * is frame N of any other pass that also starts with `fps=` (analysis and encode stay aligned).
 */
export async function scanFrames(
  file: string,
  o: ScanOptions,
  onFrame: (frame: Buffer, index: number, w: number, h: number) => void,
): Promise<number> {
  const info = await probe(file);
  const srcW = o.crop?.w ?? info.width;
  const srcH = o.crop?.h ?? info.height;
  const w = o.width;
  const h = Math.max(2, Math.round((srcH * w) / srcW / 2) * 2);
  const bpp = o.pixFmt === 'rgb24' ? 3 : 1;
  const size = w * h * bpp;
  const vf = [`fps=${o.fps}`, o.crop ? `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y}` : null, `scale=${w}:${h}:flags=area`]
    .filter(Boolean)
    .join(',');
  let pending: Buffer = Buffer.alloc(0);
  let index = 0;
  await runOk('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', o.pixFmt, '-'], (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= size) {
      onFrame(pending.subarray(0, size), index++, w, h);
      pending = pending.subarray(size);
    }
  });
  return index;
}

/** The sync flash is pure #ff00ff; after h264 it stays far from anything a UI normally shows. */
export const isMagenta = (r: number, g: number, b: number) => r > 170 && b > 170 && g < 110;

export function magentaFraction(rgb: Buffer, w: number, h: number): number {
  let n = 0;
  for (let i = 0; i < rgb.length; i += 3) if (isMagenta(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)) n++;
  return n / (w * h);
}

export interface Run {
  start: number;
  end: number;
}

/** Contiguous frames whose magenta share is close to the peak (the viewport may be a small part of the screen). */
export function findFlashRuns(fractions: number[], minPeak = 0.04): Run[] {
  const peak = Math.max(0, ...fractions);
  if (peak < minPeak) return [];
  const threshold = peak * 0.6;
  const runs: Run[] = [];
  let start = -1;
  fractions.forEach((f, i) => {
    if (f >= threshold && start < 0) start = i;
    if (f < threshold && start >= 0) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: fractions.length - 1 });
  return runs.filter((r) => r.end - r.start >= 1);
}

/** Bounding box of the flash: rows/columns that are mostly magenta. Robust to small overlays on top of it. */
export function magentaBox(rgb: Buffer, w: number, h: number): Box | null {
  const rows = new Uint32Array(h);
  const cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    let o = y * w * 3;
    for (let x = 0; x < w; x++, o += 3) {
      if (isMagenta(rgb[o]!, rgb[o + 1]!, rgb[o + 2]!)) {
        rows[y]!++;
        cols[x]!++;
      }
    }
  }
  const rmax = Math.max(...rows);
  const cmax = Math.max(...cols);
  if (rmax === 0) return null;
  const first = (a: Uint32Array, lim: number) => a.findIndex((v) => v > lim);
  const last = (a: Uint32Array, lim: number) => a.length - 1 - [...a].reverse().findIndex((v) => v > lim);
  const y0 = first(rows, rmax * 0.5);
  const y1 = last(rows, rmax * 0.5);
  const x0 = first(cols, cmax * 0.5);
  const x1 = last(cols, cmax * 0.5);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Even-aligned box shrunk by `inset` px per side (blended chroma edges and browser borders). */
export function tidyBox(b: Box, inset: { top: number; right: number; bottom: number; left: number }, bounds: { w: number; h: number }): Box {
  let x = b.x + inset.left;
  let y = b.y + inset.top;
  let w = b.w - inset.left - inset.right;
  let h = b.h - inset.top - inset.bottom;
  if (x % 2) (x++, w--);
  if (y % 2) (y++, h--);
  w = Math.min(w, bounds.w - x);
  h = Math.min(h, bounds.h - y);
  return { x, y, w: Math.floor(w / 2) * 2, h: Math.floor(h / 2) * 2 };
}

export async function grabFrameRGB(file: string, t: number): Promise<{ rgb: Buffer; w: number; h: number }> {
  const info = await probe(file);
  const { stdout } = await runOk('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (stdout.length !== info.width * info.height * 3) throw new Error(`Frame inesperado em ${file} @ ${t}s`);
  return { rgb: stdout, w: info.width, h: info.height };
}

export async function savePng(file: string, t: number, out: string, opts: { crop?: Box; width?: number } = {}): Promise<void> {
  const vf = [opts.crop ? `crop=${opts.crop.w}:${opts.crop.h}:${opts.crop.x}:${opts.crop.y}` : null, opts.width ? `scale=${opts.width}:-2` : null]
    .filter(Boolean)
    .join(',');
  await runOk('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), out]);
}

/** Per-frame mean absolute difference of a small grayscale version: ~0 when nothing on screen changes. */
export async function motionProfile(file: string, fps: number): Promise<number[]> {
  const motion: number[] = [];
  let prev: Buffer | null = null;
  await scanFrames(file, { fps, width: 192, pixFmt: 'gray' }, (frame) => {
    if (!prev) motion.push(0);
    else {
      let s = 0;
      for (let i = 0; i < frame.length; i++) s += Math.abs(frame[i]! - prev[i]!);
      motion.push(Math.round((s / frame.length) * 100) / 100);
    }
    prev = Buffer.from(frame);
  });
  return motion;
}

export async function encodeTake(raw: string, out: string, crop: Box, fps: number): Promise<void> {
  const scale = crop.w > 3200 ? ',scale=3200:-2:flags=lanczos' : '';
  await runOk('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    raw,
    '-vf',
    `fps=${fps},crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}${scale}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '16',
    '-g',
    '15',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    out,
  ]);
}

export async function contactSheet(video: string, out: string, every = 3): Promise<void> {
  await runOk('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `fps=1/${every},scale=480:-2,tile=4x4:padding=6:color=0x222222`, '-frames:v', '1', out]);
}
