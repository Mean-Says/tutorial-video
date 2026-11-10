import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Capture, RawEvent, Take, type Rect, type TakeEvent } from '../schema.ts';
import {
  encodeTake,
  findFlashRuns,
  grabFrameRGB,
  magentaBox,
  magentaFraction,
  motionProfile,
  probe,
  savePng,
  scanFrames,
  tidyBox,
  type Box,
  type Run,
} from './video.ts';

export const TAKE_FPS = 30;

export interface ClockMap {
  toVideo: (pageMs: number) => number;
  scale: number;
  driftMs: number;
}

/**
 * Maps page time (Date.now() at the flash) to video time (first magenta frame).
 * Two flashes also correct a capture clock that runs slightly fast or slow.
 */
export function clockMap(pairs: Array<{ page: number; video: number }>): ClockMap {
  if (pairs.length === 0) throw new Error('Nenhum flash de sincronização pareado.');
  const a = pairs[0]!;
  const b = pairs.at(-1)!;
  if (pairs.length === 1 || b.page - a.page < 1000) {
    return { toVideo: (ms) => a.video + (ms - a.page) / 1000, scale: 1, driftMs: 0 };
  }
  const scale = (b.video - a.video) / ((b.page - a.page) / 1000);
  const driftMs = Math.round(((b.video - a.video) - (b.page - a.page) / 1000) * 1000);
  return { toVideo: (ms) => a.video + ((ms - a.page) / 1000) * scale, scale, driftMs };
}

export function readRawEvents(takeDir: string): RawEvent[] {
  const files = readdirSync(takeDir).filter((f) => /^events.*\.json$/.test(f) || f === 'marks.jsonl');
  const seen = new Set<string>();
  const out: RawEvent[] = [];
  for (const f of files.sort()) {
    const text = readFileSync(path.join(takeDir, f), 'utf8').trim();
    if (!text) continue;
    const items: unknown[] = f.endsWith('.jsonl') ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(text)].flat();
    for (const item of items) {
      const parsed = RawEvent.safeParse(item);
      if (!parsed.success) continue;
      const key = JSON.stringify([parsed.data.type, parsed.data.t, parsed.data.x, parsed.data.y, parsed.data.name, parsed.data.key]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed.data);
    }
  }
  return out.sort((p, q) => p.t - q.t);
}

const mode = (values: number[]): number | undefined => {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Converts page events (CSS px, epoch ms) into take events (normalized, video seconds). */
export function normalizeEvents(raw: RawEvent[], clock: ClockMap, viewport: { w: number; h: number }, duration: number): TakeEvent[] {
  const out: TakeEvent[] = [];
  let lastUrl: string | undefined;
  // The recorder only writes the viewport size when it changes, so carry the last known one forward.
  let current = { w: viewport.w, h: viewport.h };
  const norm = (e: RawEvent) => {
    if (e.vw && e.vh) current = { w: e.vw, h: e.vh };
    return current;
  };
  const rectOf = (e: RawEvent): Rect | null => {
    if (!e.rect) return null;
    const { w, h } = norm(e);
    const [l, t, rw, rh] = e.rect as [number, number, number, number];
    return [l / w, t / h, rw / w, rh / h];
  };
  for (const e of raw) {
    const t = Number(clock.toVideo(e.t).toFixed(3));
    if (t < 0 || t > duration) continue;
    const { w, h } = norm(e);
    switch (e.type) {
      case 'click':
        if (e.x === undefined || e.y === undefined) break;
        out.push({ type: 'click', t, x: e.x / w, y: e.y / h, rect: rectOf(e), label: e.label });
        break;
      case 'move':
        if (e.x === undefined || e.y === undefined) break;
        out.push({ type: 'move', t, x: e.x / w, y: e.y / h });
        break;
      case 'key':
        if (e.key) out.push({ type: 'key', t, key: e.key });
        break;
      case 'input':
        out.push({ type: 'input', t, rect: rectOf(e) });
        break;
      case 'scroll':
        out.push({ type: 'scroll', t });
        break;
      case 'nav':
      case 'inject':
        if (e.type === 'nav' || (e.url && e.url !== lastUrl)) out.push({ type: 'nav', t, url: e.url });
        break;
      case 'callout': {
        const r = rectOf(e);
        if (r) out.push({ type: 'callout', t, rect: r, label: e.label, dur: e.dur });
        break;
      }
      case 'mark':
        if (e.name) out.push({ type: 'mark', t, name: e.name });
        break;
      default:
        break;
    }
    if (e.url) lastUrl = e.url;
  }
  return out;
}

async function flashRuns(raw: string): Promise<Run[]> {
  const fractions: number[] = [];
  await scanFrames(raw, { fps: TAKE_FPS, width: 160, pixFmt: 'rgb24' }, (f, _i, w, h) => fractions.push(magentaFraction(f, w, h)));
  return findFlashRuns(fractions);
}

async function boxAt(raw: string, run: Run): Promise<Box | null> {
  const mid = (run.start + run.end) / 2 / TAKE_FPS;
  const { rgb, w, h } = await grabFrameRGB(raw, mid);
  return magentaBox(rgb, w, h);
}

export function findSeriesDir(from: string): string {
  let dir = path.resolve(from);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'serie.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`serie.json não encontrado acima de ${from}`);
}

export function readCapture(seriesDir: string): Capture | null {
  const f = path.join(seriesDir, 'captura.json');
  return existsSync(f) ? Capture.parse(JSON.parse(readFileSync(f, 'utf8'))) : null;
}

/**
 * Calibration: a full-screen recording with one flash tells us exactly where the
 * page viewport sits on the physical screen, whatever the Retina scale or display layout.
 */
export async function calibrate(seriesDir: string, recDir: string, margin = 8): Promise<{ capture: Capture; preview: string }> {
  const raw = path.join(recDir, 'raw.mkv');
  const info = await probe(raw);
  const runs = await flashRuns(raw);
  if (runs.length === 0) {
    throw new Error(
      'Nenhum flash magenta encontrado. A aba estava visível na tela 0, na frente das outras janelas? O terminal tem permissão de Gravação de Tela?',
    );
  }
  const box = await boxAt(raw, runs[0]!);
  if (!box) throw new Error('Flash encontrado, mas sem área magenta mensurável.');
  const crop = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    w: 0,
    h: 0,
  };
  crop.w = Math.floor((Math.min(info.width, box.x + box.w + margin) - crop.x) / 2) * 2;
  crop.h = Math.floor((Math.min(info.height, box.y + box.h + margin) - crop.y) / 2) * 2;
  const previous = readCapture(seriesDir);
  const capture: Capture = {
    version: 1,
    screen: { w: info.width, h: info.height },
    crop,
    insets: previous?.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(seriesDir, 'captura.json'), JSON.stringify(capture, null, 2));
  writeFileSync(path.join(seriesDir, 'captura.crop'), `${crop.w}:${crop.h}:${crop.x}:${crop.y}\n`);
  const after = Math.min(info.duration - 0.05, (runs[0]!.end + 6) / TAKE_FPS);
  const preview = path.join(recDir, 'viewport.png');
  await savePng(raw, after, preview, { crop: box, width: 1280 });
  return { capture, preview };
}

export interface PrepareReport {
  take: Take;
  crop: Box;
  flashesVideo: number;
  flashesPage: number;
  steps: string[];
  incomplete: string[];
  counts: Record<string, number>;
  warnings: string[];
}

export async function prepareTake(takeDir: string): Promise<PrepareReport> {
  const seriesDir = findSeriesDir(takeDir);
  const raw = path.join(takeDir, 'raw.mkv');
  if (!existsSync(raw)) throw new Error(`Não achei ${raw}. A gravação foi parada com rec.sh stop?`);
  const capture = readCapture(seriesDir);
  const warnings: string[] = [];

  const events = readRawEvents(takeDir);
  const pageFlashes = events.filter((e) => e.type === 'flash');
  if (events.some((e) => e.type === 'flash-failed')) warnings.push('Algum flash falhou (aba oculta?). Confira a sincronia nos stills.');

  const runs = await flashRuns(raw);
  if (runs.length === 0) throw new Error('Nenhum flash magenta no vídeo: sem ele não dá para sincronizar nem recortar. Regrave a take.');
  if (pageFlashes.length === 0) throw new Error('O vídeo tem flash, mas os eventos não: salve o __tut.dump() da página em events-N.json.');

  const box = await boxAt(raw, runs[0]!);
  if (!box) throw new Error('Não consegui medir a área do flash.');
  if (runs.length > 1) {
    const box2 = await boxAt(raw, runs.at(-1)!);
    if (box2 && (Math.abs(box2.x - box.x) > 8 || Math.abs(box2.y - box.y) > 8 || Math.abs(box2.w - box.w) > 8 || Math.abs(box2.h - box.h) > 8)) {
      warnings.push('A área da página mudou entre o primeiro e o último flash (janela mexeu ou barra de debug apareceu). Confira o recorte.');
    }
  } else warnings.push('Só um flash no vídeo: sem correção de deriva do relógio (faça __tut.flash() também no fim).');

  const info = await probe(raw);
  const inset = { top: 2, right: 2, bottom: 2, left: 2 };
  if (capture) {
    inset.top += capture.insets.top;
    inset.right += capture.insets.right;
    inset.bottom += capture.insets.bottom;
    inset.left += capture.insets.left;
  }
  const crop = tidyBox(box, inset, { w: info.width, h: info.height });

  const out = path.join(takeDir, 'take.mp4');
  await encodeTake(raw, out, crop, TAKE_FPS);
  const takeInfo = await probe(out);
  const motion = await motionProfile(out, TAKE_FPS);

  const pairCount = Math.min(runs.length, pageFlashes.length);
  if (runs.length !== pageFlashes.length) {
    warnings.push(`Flashes no vídeo (${runs.length}) ≠ flashes na página (${pageFlashes.length}); usei o primeiro e o último.`);
  }
  const pairs =
    pairCount === 1
      ? [{ page: pageFlashes[0]!.t, video: runs[0]!.start / TAKE_FPS }]
      : [
          { page: pageFlashes[0]!.t, video: runs[0]!.start / TAKE_FPS },
          { page: pageFlashes.at(-1)!.t, video: runs.at(-1)!.start / TAKE_FPS },
        ];
  const clock = clockMap(pairs);
  if (Math.abs(clock.scale - 1) > 0.02) warnings.push(`Relógio da captura com deriva alta (escala ${clock.scale.toFixed(3)}): a máquina perdeu frames?`);

  const viewport = {
    w: mode(events.map((e) => e.vw).filter((v): v is number => v !== undefined)) ?? crop.w,
    h: mode(events.map((e) => e.vh).filter((v): v is number => v !== undefined)) ?? crop.h,
  };
  const takeEvents = normalizeEvents(events, clock, viewport, takeInfo.duration);

  const take = Take.parse({
    version: 1,
    id: path.basename(takeDir),
    video: path.relative(seriesDir, out).split(path.sep).join('/'),
    width: takeInfo.width,
    height: takeInfo.height,
    fps: TAKE_FPS,
    duration: takeInfo.duration,
    viewport,
    startUrl: events.find((e) => e.url)?.url,
    sync: { flashes: pairCount, scale: clock.scale, driftMs: clock.driftMs },
    events: takeEvents,
    motion,
  });
  writeFileSync(path.join(takeDir, 'take.json'), JSON.stringify(take));

  const counts: Record<string, number> = {};
  for (const e of takeEvents) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const marks = takeEvents.filter((e): e is Extract<TakeEvent, { type: 'mark' }> => e.type === 'mark').map((m) => m.name);
  const started = new Set(marks.filter((m) => m.startsWith('start:')).map((m) => m.slice(6)));
  const ended = new Set(marks.filter((m) => m.startsWith('end:')).map((m) => m.slice(4)));
  return {
    take,
    crop,
    flashesVideo: runs.length,
    flashesPage: pageFlashes.length,
    steps: [...ended],
    incomplete: [...started].filter((s) => !ended.has(s)),
    counts,
    warnings,
  };
}
