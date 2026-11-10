import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TakeEvent } from '../src/schema.ts';
import { DEFAULT_EDIT, findSettle, mergeIntervals, planStepClips, readingSeconds, stepWindows } from '../src/lib/timeline.ts';

const fps = 30;
/** Motion profile: still everywhere except the given [start, end) second ranges. */
const motionWith = (seconds: number, busy: Array<[number, number]>, level = 5) =>
  Array.from({ length: Math.round(seconds * fps) }, (_, i) => (busy.some(([a, b]) => i / fps >= a && i / fps < b) ? level : 0));

describe('mergeIntervals', () => {
  it('merges overlapping and near intervals, drops empty ones', () => {
    assert.deepEqual(
      mergeIntervals(
        [
          [5, 6],
          [1, 2],
          [1.5, 3],
          [3.2, 4],
          [7, 7],
        ],
        0.3,
      ),
      [
        [1, 4],
        [5, 6],
      ],
    );
  });
});

describe('stepWindows', () => {
  it('keeps the last complete attempt and ignores aborted ones', () => {
    const ev: TakeEvent[] = [
      { type: 'mark', t: 1, name: 'start:a' },
      { type: 'mark', t: 2, name: 'abort:a' },
      { type: 'mark', t: 3, name: 'start:a' },
      { type: 'mark', t: 6, name: 'end:a' },
      { type: 'mark', t: 7, name: 'start:b' },
    ];
    const w = stepWindows(ev);
    assert.deepEqual(w.get('a'), { start: 3, end: 6 });
    assert.equal(w.has('b'), false);
  });
});

describe('findSettle', () => {
  it('finds when the screen stops changing', () => {
    const m = motionWith(10, [[2, 4]]);
    assert.equal(findSettle(m, fps, 1, 10, 0.5, 0.6), 1);
    assert.ok(Math.abs(findSettle(m, fps, 2.5, 10, 0.5, 0.6) - 4) < 0.05);
  });
});

describe('planStepClips', () => {
  const src = 'videos/x/take-1/take.mp4';

  it('cuts a long still gap (agent thinking) without speeding it up', () => {
    const events: TakeEvent[] = [
      { type: 'click', t: 3, x: 0.5, y: 0.5, rect: null },
      { type: 'click', t: 15, x: 0.6, y: 0.5, rect: null },
    ];
    const r = planStepClips(events, motionWith(20, []), { start: 1, end: 18 }, src, DEFAULT_EDIT, 2);
    assert.equal(r.clips.length, 2);
    assert.ok(r.clips.every((c) => c.rate === 1 && !c.freeze));
    assert.ok(r.removed > 9, `removed ${r.removed}`);
    // Both clicks land on kept frames, in order.
    assert.ok(r.toFrame(3) < r.toFrame(15));
    assert.ok(r.totalFrames < 8 * fps);
  });

  it('speeds up a short busy gap instead of jump-cutting it', () => {
    const events: TakeEvent[] = [
      { type: 'click', t: 2, x: 0.5, y: 0.5, rect: null },
      { type: 'click', t: 7, x: 0.5, y: 0.5, rect: null },
    ];
    const r = planStepClips(events, motionWith(10, [[3, 6]]), { start: 1, end: 9 }, src, DEFAULT_EDIT, 2);
    const fast = r.clips.filter((c) => c.rate > 1);
    assert.equal(fast.length, 1);
    assert.ok(fast[0]!.rate <= DEFAULT_EDIT.maxRate);
  });

  it('pads with a freeze frame when the caption needs more reading time', () => {
    const events: TakeEvent[] = [{ type: 'click', t: 2, x: 0.5, y: 0.5, rect: null }];
    const r = planStepClips(events, motionWith(5, []), { start: 1.5, end: 3.5 }, src, DEFAULT_EDIT, 6);
    assert.equal(r.totalFrames, 6 * fps);
    assert.equal(r.clips.at(-1)!.freeze, true);
  });

  it('lays clips out back to back', () => {
    const events: TakeEvent[] = [
      { type: 'click', t: 2, x: 0.5, y: 0.5, rect: null },
      { type: 'key', t: 9, key: 'Enter' },
      { type: 'nav', t: 9.2, url: 'https://x.dev/a' },
    ];
    const r = planStepClips(events, motionWith(14, [[9.2, 10]]), { start: 1, end: 13 }, src, DEFAULT_EDIT, 2);
    let at = 0;
    for (const c of r.clips) {
      assert.equal(c.from, at);
      at += c.dur;
    }
    assert.equal(at, r.totalFrames);
  });
});

describe('readingSeconds', () => {
  it('grows with the number of words', () => {
    assert.ok(readingSeconds('Clique em Salvar') < readingSeconds('Clique em Salvar', 'e depois confira a lista de vagas publicadas no painel'));
  });
});
