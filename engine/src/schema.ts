import { z } from 'zod';

/**
 * Every file the pipeline reads or writes is validated by one of these schemas,
 * so a typo in a roteiro or a corrupted take fails loudly at the boundary
 * instead of producing a silently broken video.
 */

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use kebab-case (a-z, 0-9, -)');

/** [x, y, w, h], normalized to 0..1 of the recorded viewport. */
export const Rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Rect = z.infer<typeof Rect>;

// ───────────────────────────── Series & script (written by Claude) ─────────────────────────────

export const StepSpec = z.object({
  id: slug,
  titulo: z.string().min(1).max(60),
  texto: z.string().max(160).optional(),
  dica: z.string().max(120).optional(),
  acoes: z.array(z.string().min(1)).min(1),
  resultado_esperado: z.string().optional(),
  zoom: z.enum(['auto', 'off']).default('auto'),
});
export type StepSpec = z.infer<typeof StepSpec>;

export const VideoSpec = z.object({
  id: z.string().regex(/^\d{2}-[a-z0-9-]+$/, 'formato NN-slug, ex.: 01-criar-vaga'),
  titulo: z.string().min(1).max(70),
  subtitulo: z.string().max(90).optional(),
  aprendizados: z.array(z.string().min(1).max(70)).max(4).default([]),
  url_inicial: z.string().url(),
  pre_condicoes: z.array(z.string()).default([]),
  passos: z.array(StepSpec).min(1).max(12),
});
export type VideoSpec = z.infer<typeof VideoSpec>;

export const ThemeSpec = z.object({
  preset: z.enum(['aurora', 'grafite', 'claro']).default('aurora'),
  cor_destaque: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logo: z.string().optional(),
  janela: z.boolean().default(true),
  zoom_max: z.number().min(1).max(2.5).default(1.8),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  intro: z.boolean().default(true),
  outro: z.boolean().default(true),
});
export type ThemeSpec = z.infer<typeof ThemeSpec>;

export const AudioSpec = z.object({
  musica: z.string().optional(),
  volume_musica: z.number().min(0).max(1).default(0.12),
  cliques: z.boolean().default(false),
});

export const SeriesSpec = z.object({
  produto: z.string().min(1),
  titulo_serie: z.string().min(1),
  publico: z.string().optional(),
  idioma: z.string().default('pt-BR'),
  viewport: z
    .object({
      largura: z.number().int().min(800).max(2560).default(1280),
      altura: z.number().int().min(500).max(1600).default(720),
    })
    .prefault({}),
  tema: ThemeSpec.prefault({}),
  audio: AudioSpec.prefault({}),
  videos: z.array(z.string()).min(1),
});
export type SeriesSpec = z.infer<typeof SeriesSpec>;

// ───────────────────────────── Recording (written by recorder.js / tut mark) ─────────────────────────────

/** An event as logged in the page (CSS pixels, epoch milliseconds). */
export const RawEvent = z.object({
  type: z.enum(['click', 'move', 'key', 'input', 'scroll', 'nav', 'inject', 'flash', 'flash-failed', 'mark', 'callout']),
  t: z.number(),
  vw: z.number().positive().optional(),
  vh: z.number().positive().optional(),
  url: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  rect: z.array(z.number()).length(4).nullable().optional(),
  label: z.string().optional(),
  key: z.string().optional(),
  name: z.string().optional(),
  dur: z.number().positive().optional(),
});
export type RawEvent = z.infer<typeof RawEvent>;

/** An event mapped onto the cropped take: seconds of video time, normalized coordinates. */
export const TakeEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), t: z.number(), x: z.number(), y: z.number(), rect: Rect.nullable(), label: z.string().optional() }),
  z.object({ type: z.literal('move'), t: z.number(), x: z.number(), y: z.number() }),
  z.object({ type: z.literal('key'), t: z.number(), key: z.string() }),
  z.object({ type: z.literal('input'), t: z.number(), rect: Rect.nullable() }),
  z.object({ type: z.literal('scroll'), t: z.number() }),
  z.object({ type: z.literal('nav'), t: z.number(), url: z.string().optional() }),
  z.object({ type: z.literal('callout'), t: z.number(), rect: Rect, label: z.string().optional(), dur: z.number().optional() }),
  z.object({ type: z.literal('mark'), t: z.number(), name: z.string() }),
]);
export type TakeEvent = z.infer<typeof TakeEvent>;

export const Take = z.object({
  version: z.literal(1),
  id: z.string(),
  /** Path of the cropped take video, relative to the series directory. */
  video: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().positive(),
  viewport: z.object({ w: z.number().positive(), h: z.number().positive() }),
  startUrl: z.string().optional(),
  sync: z.object({ flashes: z.number().int(), scale: z.number(), driftMs: z.number() }),
  events: z.array(TakeEvent),
  /** Mean absolute frame difference per frame (0..255), used to find dead time. */
  motion: z.array(z.number()),
});
export type Take = z.infer<typeof Take>;

export const Capture = z.object({
  version: z.literal(1),
  screen: z.object({ w: z.number().int(), h: z.number().int() }),
  /** Live crop applied while recording, in physical screen pixels (includes a safety margin). */
  crop: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() }),
  /** Extra pixels trimmed from each edge of the detected viewport (hides browser/extension borders). */
  insets: z
    .object({
      top: z.number().int().min(0).default(0),
      right: z.number().int().min(0).default(0),
      bottom: z.number().int().min(0).default(0),
      left: z.number().int().min(0).default(0),
    })
    .prefault({}),
  createdAt: z.string(),
});
export type Capture = z.infer<typeof Capture>;

// ───────────────────────────── Edit plan (input of the Remotion composition) ─────────────────────────────

export const Clip = z.object({
  src: z.string(),
  srcStart: z.number().nonnegative(),
  srcEnd: z.number().nonnegative(),
  rate: z.number().positive(),
  from: z.number().int().nonnegative(),
  dur: z.number().int().positive(),
  freeze: z.boolean(),
});
export type Clip = z.infer<typeof Clip>;

export const CameraKey = z.object({ f: z.number().int(), z: z.number().min(1), cx: z.number(), cy: z.number() });
export type CameraKey = z.infer<typeof CameraKey>;

export const CursorKey = z.object({ f: z.number().int(), x: z.number(), y: z.number() });
export type CursorKey = z.infer<typeof CursorKey>;

export const ClickFx = z.object({ f: z.number().int(), x: z.number(), y: z.number() });
export type ClickFx = z.infer<typeof ClickFx>;

export const KeyFx = z.object({ f: z.number().int(), dur: z.number().int().positive(), label: z.string() });
export type KeyFx = z.infer<typeof KeyFx>;

export const CalloutFx = z.object({ f: z.number().int(), dur: z.number().int().positive(), rect: Rect, label: z.string().optional() });
export type CalloutFx = z.infer<typeof CalloutFx>;

const segmentBase = { from: z.number().int().nonnegative(), dur: z.number().int().positive() };

export const IntroSegment = z.object({
  kind: z.literal('intro'),
  ...segmentBase,
  titulo: z.string(),
  subtitulo: z.string().optional(),
  aprendizados: z.array(z.string()),
  /** Final state of the tutorial, shown next to the title ("this is what you will get"). */
  preview: z.object({ src: z.string(), t: z.number().nonnegative(), aspect: z.number().positive() }).optional(),
});
export const StepSegment = z.object({
  kind: z.literal('step'),
  ...segmentBase,
  index: z.number().int().positive(),
  total: z.number().int().positive(),
  titulo: z.string(),
  texto: z.string().optional(),
  dica: z.string().optional(),
  /** Address shown in the window bar; changes at frame `f` (query strings are never included). */
  urls: z.array(z.object({ f: z.number().int(), url: z.string() })),
  aspect: z.number().positive(),
  clips: z.array(Clip).min(1),
  camera: z.array(CameraKey).min(1),
  cursor: z.array(CursorKey),
  clicks: z.array(ClickFx),
  keys: z.array(KeyFx),
  callouts: z.array(CalloutFx),
});
export const OutroSegment = z.object({
  kind: z.literal('outro'),
  ...segmentBase,
  titulo: z.string(),
  resumo: z.array(z.string()),
  proximo: z.string().optional(),
});
export const Segment = z.discriminatedUnion('kind', [IntroSegment, StepSegment, OutroSegment]);
export type IntroSegment = z.infer<typeof IntroSegment>;
export type StepSegment = z.infer<typeof StepSegment>;
export type OutroSegment = z.infer<typeof OutroSegment>;
export type Segment = z.infer<typeof Segment>;

export const ResolvedTheme = z.object({
  bg1: z.string(),
  bg2: z.string(),
  accent: z.string(),
  text: z.string(),
  muted: z.string(),
  surface: z.string(),
  frameBar: z.string(),
  dark: z.boolean(),
  janela: z.boolean(),
  logo: z.string().optional(),
});
export type ResolvedTheme = z.infer<typeof ResolvedTheme>;

export const EditPlan = z.object({
  version: z.literal(1),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationInFrames: z.number().int().positive(),
  produto: z.string(),
  tituloVideo: z.string(),
  idioma: z.string(),
  theme: ResolvedTheme,
  segments: z.array(Segment).min(1),
  audio: z.object({ musica: z.string().optional(), volume: z.number(), cliques: z.boolean() }),
  chapters: z.array(z.object({ t: z.number(), titulo: z.string() })),
});
export type EditPlan = z.infer<typeof EditPlan>;
