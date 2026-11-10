import type { Clip, TakeEvent } from '../schema.ts';

/**
 * Turns a raw take (Claude acting at agent speed, with long pauses while it thinks)
 * into a tight sequence of clips. Pure functions only, so every rule is unit-tested.
 */

export type Interval = [number, number];

export interface EditOptions {
  fps: number;
  /** Seconds kept before each action, so the cursor can glide in. */
  pre: number;
  /** Seconds kept after each click / keystroke / input. */
  post: number;
  /** Seconds of lead-in before the first action of a step (time to read the caption). */
  firstLead: number;
  /** Seconds kept after a navigation or scroll (page loading / moving). */
  navPost: number;
  /** Seconds the final result stays on screen after the page settles. */
  resultHold: number;
  /** Seconds of stillness that count as "the page has settled". */
  settleQuiet: number;
  /** Per-frame motion below this is "still" (mean abs diff, 0..255 at 192px wide). */
  motionThreshold: number;
  /** Sum of motion across a gap below this means the frames on both sides look identical. */
  seamlessBudget: number;
  /** Max output seconds a busy (non-still) gap may take once sped up. */
  gapOutMax: number;
  /** Fastest playback rate used to compress a busy gap. */
  maxRate: number;
  /** Gaps shorter than this are simply kept. */
  joinGap: number;
}

export const DEFAULT_EDIT: EditOptions = {
  fps: 30,
  pre: 0.8,
  post: 1.0,
  firstLead: 1.0,
  navPost: 1.6,
  resultHold: 1.4,
  settleQuiet: 0.5,
  motionThreshold: 0.6,
  seamlessBudget: 3,
  gapOutMax: 0.8,
  maxRate: 6,
  joinGap: 0.35,
};

export function mergeIntervals(intervals: Interval[], joinGap = 0): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + joinGap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export interface StepWindow {
  start: number;
  end: number;
}

/**
 * Reads `start:<id>` / `end:<id>` / `abort:<id>` marks. The LAST complete start→end pair
 * wins, so a botched attempt can be redone in the same take: abort, reset, start again.
 */
export function stepWindows(events: TakeEvent[]): Map<string, StepWindow> {
  const pending = new Map<string, number>();
  const done = new Map<string, StepWindow>();
  const marks = events.filter((e): e is Extract<TakeEvent, { type: 'mark' }> => e.type === 'mark').sort((a, b) => a.t - b.t);
  for (const m of marks) {
    const sep = m.name.indexOf(':');
    if (sep < 0) continue;
    const kind = m.name.slice(0, sep);
    const id = m.name.slice(sep + 1);
    if (kind === 'start') pending.set(id, m.t);
    else if (kind === 'abort') pending.delete(id);
    else if (kind === 'end') {
      const start = pending.get(id);
      if (start !== undefined && m.t > start) done.set(id, { start, end: m.t });
      pending.delete(id);
    }
  }
  return done;
}

const frameIndex = (t: number, fps: number) => Math.max(0, Math.round(t * fps));

/** Sum of per-frame motion between two times. */
export function motionSum(motion: number[], fps: number, a: number, b: number): number {
  let s = 0;
  for (let i = frameIndex(a, fps); i <= Math.min(motion.length - 1, frameIndex(b, fps)); i++) s += motion[i] ?? 0;
  return s;
}

/** First time ≥ `from` where the screen stays still for `quiet` seconds; `to` if it never does. */
export function findSettle(motion: number[], fps: number, from: number, to: number, quiet: number, threshold: number): number {
  const need = Math.max(1, Math.round(quiet * fps));
  let run = 0;
  for (let i = frameIndex(from, fps); i <= Math.min(motion.length - 1, frameIndex(to, fps)); i++) {
    if ((motion[i] ?? 0) < threshold) {
      run++;
      if (run >= need) return (i - need + 1) / fps;
    } else run = 0;
  }
  return to;
}

const ACTION_TYPES = new Set<TakeEvent['type']>(['click', 'move', 'key', 'input', 'scroll', 'nav', 'callout']);

function postFor(e: TakeEvent, o: EditOptions): number {
  switch (e.type) {
    case 'nav':
    case 'scroll':
      return o.navPost;
    case 'move':
      return 0.4;
    case 'callout':
      return e.dur ?? 2.5;
    default:
      return o.post;
  }
}

export interface StepClips {
  clips: Clip[];
  totalFrames: number;
  /** Maps take time (s) to a frame of this segment. Times inside a removed gap snap to the next kept frame. */
  toFrame: (t: number) => number;
  /** Seconds of raw footage removed (dead time). */
  removed: number;
}

/**
 * Picks which parts of the take to keep for one step:
 * a window around every action, then the moment the result settles.
 * Still gaps are cut (the frames on both sides are identical, so the cut is invisible),
 * busy gaps are sped up, and the step is padded with a freeze frame if it is
 * shorter than the time needed to read its caption.
 */
export function planStepClips(
  events: TakeEvent[],
  motion: number[],
  win: StepWindow,
  src: string,
  o: EditOptions,
  minSeconds: number,
): StepClips {
  const acts = events.filter((e) => ACTION_TYPES.has(e.type) && e.t >= win.start && e.t <= win.end).sort((a, b) => a.t - b.t);

  const intervals: Interval[] = [];
  if (acts.length === 0) {
    intervals.push([win.start, Math.min(win.end, win.start + Math.max(2, minSeconds))]);
  } else {
    const first = acts[0]!.t;
    intervals.push([first - Math.max(o.firstLead, o.pre), first]);
    for (const e of acts) intervals.push([e.t - o.pre, e.t + postFor(e, o)]);
    const last = acts.at(-1)!.t;
    const settle = findSettle(motion, o.fps, last + 0.3, win.end, o.settleQuiet, o.motionThreshold);
    intervals.push([last, settle + o.resultHold]);
  }

  const kept = mergeIntervals(
    intervals.map(([a, b]) => [Math.max(win.start, a), Math.min(win.end, b)] as Interval),
    o.joinGap,
  );

  const pieces: Array<Omit<Clip, 'from' | 'dur'>> = [];
  let removed = 0;
  kept.forEach(([a, b], i) => {
    const prev = kept[i - 1];
    if (prev) {
      const gap = a - prev[1];
      const seamless = motionSum(motion, o.fps, prev[1], a) <= o.seamlessBudget;
      const rate = Math.min(o.maxRate, Math.max(1, gap / o.gapOutMax));
      if (!seamless && gap / rate <= o.gapOutMax * 1.5) {
        pieces.push({ src, srcStart: prev[1], srcEnd: a, rate, freeze: false });
        removed += gap - gap / rate;
      } else removed += gap;
    }
    pieces.push({ src, srcStart: a, srcEnd: b, rate: 1, freeze: false });
  });

  const clips: Clip[] = [];
  let cursor = 0;
  for (const p of pieces) {
    const dur = Math.max(1, Math.round(((p.srcEnd - p.srcStart) / p.rate) * o.fps));
    clips.push({ ...p, from: cursor, dur });
    cursor += dur;
  }

  const minFrames = Math.round(minSeconds * o.fps);
  const lastClip = clips.at(-1);
  if (lastClip && cursor < minFrames) {
    const holdAt = Math.max(lastClip.srcStart, lastClip.srcEnd - 1 / o.fps);
    clips.push({ src, srcStart: holdAt, srcEnd: holdAt, rate: 1, freeze: true, from: cursor, dur: minFrames - cursor });
    cursor = minFrames;
  }

  const playable = clips.filter((c) => !c.freeze);
  const toFrame = (t: number): number => {
    for (const c of playable) {
      if (t < c.srcStart) return c.from;
      if (t <= c.srcEnd) return Math.min(c.from + c.dur - 1, c.from + Math.round(((t - c.srcStart) / c.rate) * o.fps));
    }
    const tail = playable.at(-1);
    return tail ? tail.from + tail.dur - 1 : 0;
  };

  return { clips, totalFrames: cursor, toFrame, removed };
}

/** Seconds a viewer needs to read a caption: ~190 words per minute plus a beat to find it. */
export function readingSeconds(...texts: Array<string | undefined>): number {
  const words = texts
    .filter((t): t is string => Boolean(t))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return 1.2 + words / 3.2;
}
