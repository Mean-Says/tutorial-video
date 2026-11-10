import type { CameraKey, Rect } from '../schema.ts';

/**
 * Screen-Studio-style automatic camera: zoom towards where the action is,
 * hold while related actions happen nearby, zoom back out when the context changes.
 */

export interface FocusTarget {
  /** Frame (segment-relative) when the action happens. */
  f: number;
  /** Area that must stay visible, normalized. */
  box: Rect;
}

export interface CameraOptions {
  fps: number;
  zoomMax: number;
  /** Zooms below this are not worth the motion. */
  zoomMin: number;
  /** Share of the view the focus box may fill. */
  fill: number;
  /** Largest union box (normalized, either axis) still treated as one area. */
  maxGroupSize: number;
  /** Seconds between actions that still count as the same group. */
  maxGroupGap: number;
  /** Seconds of the zoom-in move; it completes slightly before the action. */
  moveIn: number;
  moveOut: number;
  /** Seconds the camera holds on a group after its last action. */
  hold: number;
}

export const DEFAULT_CAMERA: CameraOptions = {
  fps: 30,
  zoomMax: 1.8,
  zoomMin: 1.15,
  fill: 0.7,
  maxGroupSize: 0.6,
  maxGroupGap: 2.5,
  moveIn: 0.6,
  moveOut: 0.5,
  hold: 0.9,
};

/** Area to frame for an action: the element's rect when known and reasonably small, else a box around the point. */
export function focusBox(point: { x: number; y: number } | null, rect: Rect | null): Rect | null {
  if (rect && rect[2] > 0 && rect[3] > 0 && rect[2] * rect[3] < 0.3) {
    const pad = 0.02;
    return [rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad];
  }
  if (point) return [point.x - 0.12, point.y - 0.1, 0.24, 0.2];
  return null;
}

const union = (a: Rect, b: Rect): Rect => {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0] + a[2], b[0] + b[2]);
  const y1 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, x1 - x0, y1 - y0];
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function viewFor(box: Rect, o: Pick<CameraOptions, 'zoomMax' | 'fill'>): { z: number; cx: number; cy: number } {
  const z = clamp(Math.min(o.fill / Math.max(box[2], 1e-3), o.fill / Math.max(box[3], 1e-3)), 1, o.zoomMax);
  const half = 0.5 / z;
  return {
    z,
    cx: clamp(box[0] + box[2] / 2, half, 1 - half),
    cy: clamp(box[1] + box[3] / 2, half, 1 - half),
  };
}

interface Group {
  f0: number;
  f1: number;
  box: Rect;
}

export function groupTargets(targets: FocusTarget[], breakers: number[], o: CameraOptions): Group[] {
  const groups: Group[] = [];
  const sorted = [...targets].sort((a, b) => a.f - b.f);
  for (const t of sorted) {
    const g = groups.at(-1);
    if (g) {
      const u = union(g.box, t.box);
      const near = t.f - g.f1 <= o.maxGroupGap * o.fps;
      const small = u[2] <= o.maxGroupSize && u[3] <= o.maxGroupSize;
      // A navigation on the same frame as the click (link/button that changes page) also breaks the group.
      const broken = breakers.some((b) => b >= g.f1 && b <= t.f);
      if (near && small && !broken) {
        g.f1 = t.f;
        g.box = u;
        continue;
      }
    }
    groups.push({ f0: t.f, f1: t.f, box: t.box });
  }
  return groups;
}

/**
 * Keyframes for one step segment. Starts and ends on the full view so consecutive
 * steps join without a jump; frames are strictly increasing.
 */
export function planCamera(targets: FocusTarget[], breakers: number[], segFrames: number, o: CameraOptions): CameraKey[] {
  const full = { z: 1, cx: 0.5, cy: 0.5 };
  const keys: CameraKey[] = [{ f: 0, ...full }];
  const last = Math.max(1, segFrames - 1);
  const moveIn = Math.round(o.moveIn * o.fps);
  const moveOut = Math.round(o.moveOut * o.fps);
  const hold = Math.round(o.hold * o.fps);
  const lead = Math.round(0.12 * o.fps);

  const push = (k: CameraKey) => {
    const prev = keys.at(-1)!;
    if (k.f <= prev.f || k.f > last) return;
    keys.push(k);
  };

  const navLinger = Math.round(0.3 * o.fps);
  const groups = groupTargets(targets, breakers, o)
    .map((g) => {
      // A single click that immediately changes the page gets a gentler punch-in: the next page is shown in full anyway.
      const navigates = g.f0 === g.f1 && breakers.some((b) => b >= g.f1 && b <= g.f1 + navLinger);
      return { ...g, view: viewFor(g.box, navigates ? { ...o, zoomMax: Math.min(o.zoomMax, 1.4) } : o) };
    })
    .filter((g) => g.view.z >= o.zoomMin);

  groups.forEach((g, i) => {
    const current = keys.at(-1)!;
    const arrive = Math.max(current.f + moveIn, g.f0 - lead);
    push({ f: arrive - moveIn, z: current.z, cx: current.cx, cy: current.cy });
    push({ f: arrive, ...g.view });

    // The page changes at a navigation/scroll: leave the zoom right after it instead of holding on stale content.
    const nextBreak = breakers.find((b) => b >= g.f1);
    let release = g.f1 + hold;
    if (nextBreak !== undefined && nextBreak <= release) release = nextBreak + navLinger;
    const next = groups[i + 1];
    const chainToNext = next && next.f0 - release < moveIn + moveOut && (nextBreak === undefined || nextBreak > next.f0);
    push({ f: Math.max(arrive + 1, release), ...g.view });
    if (!chainToNext) push({ f: Math.max(arrive + 2, release) + moveOut, ...full });
  });

  const tail = keys.at(-1)!;
  if (tail.z !== 1) {
    // Make sure the segment ends on the full view.
    const outStart = Math.max(tail.f + 1, last - moveOut);
    if (outStart < last) {
      push({ f: outStart, z: tail.z, cx: tail.cx, cy: tail.cy });
      push({ f: last, ...full });
    } else if (keys.length > 1) {
      keys[keys.length - 1] = { f: tail.f, ...full };
    }
  }
  return keys;
}
