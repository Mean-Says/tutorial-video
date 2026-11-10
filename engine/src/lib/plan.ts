import {
  EditPlan,
  type CalloutFx,
  type ClickFx,
  type CursorKey,
  type KeyFx,
  type ResolvedTheme,
  type Segment,
  type SeriesSpec,
  type Take,
  type TakeEvent,
  type VideoSpec,
} from '../schema.ts';
import { DEFAULT_CAMERA, focusBox, planCamera, type FocusTarget } from './camera.ts';
import { DEFAULT_EDIT, planStepClips, readingSeconds, stepWindows, type EditOptions, type StepWindow } from './timeline.ts';

const PRESETS: Record<SeriesSpec['tema']['preset'], Omit<ResolvedTheme, 'janela' | 'logo'>> = {
  aurora: {
    bg1: '#0b1020',
    bg2: '#312e81',
    accent: '#8b5cf6',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.72)',
    surface: 'rgba(255,255,255,0.08)',
    frameBar: '#1b1d2a',
    dark: true,
  },
  grafite: {
    bg1: '#0d0f12',
    bg2: '#273041',
    accent: '#22c55e',
    text: '#f8fafc',
    muted: 'rgba(248,250,252,0.7)',
    surface: 'rgba(255,255,255,0.07)',
    frameBar: '#1c1f26',
    dark: true,
  },
  claro: {
    bg1: '#f4f6fb',
    bg2: '#dbe4f3',
    accent: '#2563eb',
    text: '#0f172a',
    muted: '#475569',
    surface: 'rgba(15,23,42,0.06)',
    frameBar: '#e9edf3',
    dark: false,
  },
};

export function resolveTheme(tema: SeriesSpec['tema']): ResolvedTheme {
  const base = PRESETS[tema.preset];
  return { ...base, accent: tema.cor_destaque ?? base.accent, janela: tema.janela, logo: tema.logo };
}

/** Host + path only: query strings and fragments often carry tokens and never belong in a video. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

const KEY_NAMES: Record<string, string> = {
  Meta: '⌘',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: '⌥',
  Shift: '⇧',
  Enter: '↵ Enter',
  Tab: '⇥ Tab',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Espaço',
};

export function formatKey(combo: string): string {
  return combo
    .split('+')
    .filter(Boolean)
    .map((k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k))
    .join('+');
}

export interface StepSource {
  take: Take;
  window: StepWindow;
}

/** Each step comes from the most recent take that recorded it completely. */
export function findStepSources(video: VideoSpec, takes: Take[]): { sources: Map<string, StepSource>; missing: string[] } {
  const sources = new Map<string, StepSource>();
  for (const take of takes) {
    for (const [id, window] of stepWindows(take.events)) sources.set(id, { take, window });
  }
  const missing = video.passos.map((p) => p.id).filter((id) => !sources.has(id));
  return { sources, missing };
}

function urlAt(take: Take, t: number): string | undefined {
  let url = take.startUrl;
  for (const e of take.events) {
    if (e.t > t) break;
    if (e.type === 'nav' && e.url) url = e.url;
  }
  return url;
}

function groupKeys(events: Array<Extract<TakeEvent, { type: 'key' }>>, toFrame: (t: number) => number, fps: number): KeyFx[] {
  const out: Array<KeyFx & { count: number; raw: string; lastT: number }> = [];
  for (const e of events) {
    const prev = out.at(-1);
    if (prev && prev.raw === e.key && e.t - prev.lastT < 0.6) {
      prev.count++;
      prev.lastT = e.t;
      prev.dur = Math.max(prev.dur, toFrame(e.t) - prev.f + Math.round(0.9 * fps));
      continue;
    }
    out.push({ f: toFrame(e.t), dur: Math.round(0.9 * fps), label: formatKey(e.key), count: 1, raw: e.key, lastT: e.t });
  }
  return out.map(({ f, dur, label, count }) => ({ f, dur, label: count > 1 ? `${label} ×${count}` : label }));
}

export function planCursor(points: Array<{ f: number; x: number; y: number }>, start: { x: number; y: number }, fps: number): CursorKey[] {
  const keys: CursorKey[] = [{ f: 0, x: start.x, y: start.y }];
  for (const p of [...points].sort((a, b) => a.f - b.f)) {
    const prev = keys.at(-1)!;
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (dist < 0.003) continue;
    const glide = Math.round(Math.min(0.75, Math.max(0.3, 0.3 + dist * 0.6)) * fps);
    const arrive = Math.max(prev.f + 1, p.f - 1);
    const depart = Math.max(prev.f, arrive - glide);
    if (depart > prev.f) keys.push({ f: depart, x: prev.x, y: prev.y });
    keys.push({ f: arrive, x: p.x, y: p.y });
  }
  return keys;
}

export interface BuildResult {
  plan: EditPlan;
  warnings: string[];
  stats: Array<{ step: string; take: string; rawSeconds: number; outSeconds: number; removedSeconds: number }>;
}

export function buildPlan(
  series: SeriesSpec,
  video: VideoSpec,
  takes: Take[],
  opts: { next?: string; edit?: Partial<EditOptions> } = {},
): BuildResult {
  const fps = series.tema.fps;
  const edit: EditOptions = { ...DEFAULT_EDIT, ...opts.edit, fps };
  const camera = { ...DEFAULT_CAMERA, fps, zoomMax: series.tema.zoom_max };
  const warnings: string[] = [];
  const stats: BuildResult['stats'] = [];

  const { sources, missing } = findStepSources(video, takes);
  if (missing.length > 0) {
    throw new Error(`Passos sem gravação completa (faltam marcas start:/end:): ${missing.join(', ')}`);
  }

  const segments: Segment[] = [];
  let at = 0;
  const pushSegment = (s: Segment) => {
    segments.push(s);
    at += s.dur;
  };

  if (series.tema.intro) {
    const secs = Math.min(8, Math.max(3.5, readingSeconds(video.titulo, video.subtitulo, ...video.aprendizados)));
    pushSegment({
      kind: 'intro',
      from: at,
      dur: Math.round(secs * fps),
      titulo: video.titulo,
      subtitulo: video.subtitulo,
      aprendizados: video.aprendizados,
    });
  }

  let carry: { take: string; x: number; y: number } | null = null;

  video.passos.forEach((step, i) => {
    const { take, window } = sources.get(step.id)!;
    const minSeconds = readingSeconds(step.titulo, step.texto, step.dica);
    const { clips, totalFrames, toFrame, removed } = planStepClips(take.events, take.motion, window, take.video, edit, minSeconds);
    const inWin = take.events.filter((e) => e.t >= window.start && e.t <= window.end);

    const clicks: ClickFx[] = [];
    const points: Array<{ f: number; x: number; y: number }> = [];
    const targets: FocusTarget[] = [];
    const breakers: number[] = [];
    const callouts: CalloutFx[] = [];
    const keyEvents: Array<Extract<TakeEvent, { type: 'key' }>> = [];

    for (const e of inWin) {
      const f = toFrame(e.t);
      switch (e.type) {
        case 'click': {
          clicks.push({ f, x: e.x, y: e.y });
          points.push({ f, x: e.x, y: e.y });
          const box = focusBox(e, e.rect);
          if (box) targets.push({ f, box });
          break;
        }
        case 'move':
          points.push({ f, x: e.x, y: e.y });
          break;
        case 'input': {
          const box = focusBox(null, e.rect);
          if (box) targets.push({ f, box });
          break;
        }
        case 'callout': {
          const dur = Math.round((e.dur ?? readingSeconds(e.label) + 0.6) * fps);
          callouts.push({ f, dur, rect: e.rect, label: e.label });
          const box = focusBox(null, e.rect);
          if (box) targets.push({ f, box });
          break;
        }
        case 'key':
          keyEvents.push(e);
          break;
        case 'nav':
        case 'scroll':
          breakers.push(f);
          break;
        case 'mark':
          break;
      }
    }

    // A callout drawn over content that has since scrolled away would point at the wrong thing.
    for (const c of callouts) {
      const stop = breakers.find((b) => b > c.f);
      if (stop !== undefined) c.dur = Math.max(1, Math.min(c.dur, stop - c.f));
      c.dur = Math.min(c.dur, totalFrames - c.f);
    }

    const start = carry && carry.take === take.id ? { x: carry.x, y: carry.y } : { x: 0.5, y: 0.55 };
    const cursor = planCursor(points, start, fps);
    const lastCursor = cursor.at(-1)!;
    carry = { take: take.id, x: lastCursor.x, y: lastCursor.y };

    const urls: Array<{ f: number; url: string }> = [];
    const firstUrl = urlAt(take, window.start);
    if (firstUrl) urls.push({ f: 0, url: displayUrl(firstUrl) });
    for (const e of inWin) {
      if (e.type === 'nav' && e.url && displayUrl(e.url) !== urls.at(-1)?.url) urls.push({ f: toFrame(e.t), url: displayUrl(e.url) });
    }

    if (clicks.length === 0 && keyEvents.length === 0 && inWin.every((e) => e.type === 'mark')) {
      warnings.push(`Passo "${step.id}": nenhuma ação registrada (o recorder estava injetado?). O vídeo mostra só a tela parada.`);
    }

    pushSegment({
      kind: 'step',
      from: at,
      dur: totalFrames,
      index: i + 1,
      total: video.passos.length,
      titulo: step.titulo,
      texto: step.texto,
      dica: step.dica,
      urls,
      aspect: take.width / take.height,
      clips,
      camera: step.zoom === 'off' ? [{ f: 0, z: 1, cx: 0.5, cy: 0.5 }] : planCamera(targets, breakers, totalFrames, camera),
      cursor,
      clicks,
      keys: groupKeys(keyEvents, toFrame, fps),
      callouts,
    });
    stats.push({
      step: step.id,
      take: take.id,
      rawSeconds: Number((window.end - window.start).toFixed(1)),
      outSeconds: Number((totalFrames / fps).toFixed(1)),
      removedSeconds: Number(removed.toFixed(1)),
    });
  });

  const intro = segments.find((s) => s.kind === 'intro');
  const lastStep = segments.findLast((s) => s.kind === 'step');
  if (intro?.kind === 'intro' && lastStep?.kind === 'step') {
    const clip = lastStep.clips.findLast((c) => !c.freeze) ?? lastStep.clips.at(-1)!;
    intro.preview = { src: clip.src, t: Math.max(clip.srcStart, clip.srcEnd - 0.1), aspect: lastStep.aspect };
  }

  if (series.tema.outro) {
    const resumo = video.passos.map((p) => p.titulo);
    const secs = Math.min(7, Math.max(3.5, readingSeconds(...resumo.slice(0, 7), opts.next) * 0.7));
    pushSegment({ kind: 'outro', from: at, dur: Math.round(secs * fps), titulo: 'Recapitulando', resumo, proximo: opts.next });
  }

  const chapters = segments.map((s) => ({
    t: Number((s.from / fps).toFixed(2)),
    titulo: s.kind === 'intro' ? 'Introdução' : s.kind === 'outro' ? 'Resumo' : `Passo ${s.index} — ${s.titulo}`,
  }));

  const plan = EditPlan.parse({
    version: 1,
    fps,
    width: 1920,
    height: 1080,
    durationInFrames: at,
    produto: series.produto,
    tituloVideo: video.titulo,
    idioma: series.idioma,
    theme: resolveTheme(series.tema),
    segments,
    audio: { musica: series.audio.musica, volume: series.audio.volume_musica, cliques: series.audio.cliques },
    chapters,
  });
  return { plan, warnings, stats };
}
