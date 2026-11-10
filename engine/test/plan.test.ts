import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SeriesSpec, Take, VideoSpec, type TakeEvent } from '../src/schema.ts';
import { buildPlan, displayUrl, formatKey, planCursor } from '../src/lib/plan.ts';
import { clockMap, normalizeEvents } from '../src/lib/take.ts';
import { findFlashRuns, magentaBox, tidyBox } from '../src/lib/video.ts';

const series = SeriesSpec.parse({ produto: 'Radar', titulo_serie: 'Primeiros passos', videos: ['01-criar-vaga'] });
const video = VideoSpec.parse({
  id: '01-criar-vaga',
  titulo: 'Como criar uma vaga',
  url_inicial: 'https://app.radar.dev/vagas',
  aprendizados: ['Abrir o formulário', 'Publicar'],
  passos: [
    { id: 'abrir', titulo: 'Clique em Nova vaga', acoes: ['clicar em Nova vaga'] },
    { id: 'publicar', titulo: 'Publique', texto: 'Preencha o título e salve.', acoes: ['digitar', 'salvar'] },
  ],
});

const events: TakeEvent[] = [
  { type: 'nav', t: 0.5, url: 'https://app.radar.dev/vagas?token=secreto' },
  { type: 'mark', t: 2, name: 'start:abrir' },
  { type: 'click', t: 4, x: 0.8, y: 0.1, rect: [0.75, 0.08, 0.1, 0.04] },
  { type: 'mark', t: 12, name: 'end:abrir' },
  { type: 'mark', t: 13, name: 'start:publicar' },
  { type: 'click', t: 15, x: 0.4, y: 0.4, rect: [0.3, 0.38, 0.3, 0.04] },
  { type: 'input', t: 16, rect: [0.3, 0.38, 0.3, 0.04] },
  { type: 'key', t: 17, key: 'Meta+s' },
  { type: 'callout', t: 18, rect: [0.7, 0.85, 0.2, 0.05], label: 'Vaga salva' },
  { type: 'mark', t: 24, name: 'end:publicar' },
];

const take = Take.parse({
  version: 1,
  id: 'take-1',
  video: 'videos/01-criar-vaga/take-1/take.mp4',
  width: 2560,
  height: 1440,
  fps: 30,
  duration: 26,
  viewport: { w: 1280, h: 720 },
  startUrl: 'https://app.radar.dev/vagas',
  sync: { flashes: 2, scale: 1, driftMs: 0 },
  events,
  motion: Array.from({ length: 26 * 30 }, () => 0),
});

describe('buildPlan', () => {
  it('produces a valid plan with intro, one segment per step and outro', () => {
    const { plan, stats } = buildPlan(series, video, [take], { next: 'Como editar uma vaga' });
    assert.deepEqual(
      plan.segments.map((s) => s.kind),
      ['intro', 'step', 'step', 'outro'],
    );
    let at = 0;
    for (const s of plan.segments) {
      assert.equal(s.from, at);
      at += s.dur;
    }
    assert.equal(plan.durationInFrames, at);
    assert.equal(stats.length, 2);
    const step2 = plan.segments[2]!;
    assert.equal(step2.kind, 'step');
    if (step2.kind === 'step') {
      assert.equal(step2.keys[0]!.label, '⌘+S');
      assert.equal(step2.callouts.length, 1);
      assert.ok(step2.urls.every((u) => !u.url.includes('token')));
    }
  });

  it('refuses to plan when a step was never recorded', () => {
    const partial = Take.parse({ ...take, events: events.filter((e) => !(e.type === 'mark' && e.name.endsWith('publicar'))) });
    assert.throws(() => buildPlan(series, video, [partial]), /publicar/);
  });

  it('takes a re-recorded step from the newest take', () => {
    const retake = Take.parse({
      ...take,
      id: 'take-2',
      video: 'videos/01-criar-vaga/take-2/take.mp4',
      events: [
        { type: 'mark', t: 1, name: 'start:publicar' },
        { type: 'click', t: 2, x: 0.5, y: 0.5, rect: null },
        { type: 'mark', t: 5, name: 'end:publicar' },
      ],
    });
    const { stats } = buildPlan(series, video, [take, retake]);
    assert.equal(stats.find((s) => s.step === 'publicar')!.take, 'take-2');
    assert.equal(stats.find((s) => s.step === 'abrir')!.take, 'take-1');
  });
});

describe('helpers', () => {
  it('strips query strings from displayed URLs', () => {
    assert.equal(displayUrl('https://app.x.com/a/b?session=1#x'), 'app.x.com/a/b');
  });
  it('formats shortcuts', () => {
    assert.equal(formatKey('Meta+Shift+k'), '⌘+⇧+K');
    assert.equal(formatKey('Enter'), '↵ Enter');
  });
  it('glides the cursor and arrives before the click', () => {
    const keys = planCursor([{ f: 60, x: 0.9, y: 0.1 }], { x: 0.5, y: 0.5 }, 30);
    assert.equal(keys.at(-1)!.f, 59);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i]!.f > keys[i - 1]!.f);
  });
});

describe('sync and crop', () => {
  it('maps page time to video time and corrects drift with two flashes', () => {
    const c = clockMap([
      { page: 10_000, video: 1 },
      { page: 70_000, video: 61.6 },
    ]);
    assert.ok(Math.abs(c.toVideo(40_000) - 31.3) < 1e-6);
    assert.equal(c.driftMs, 600);
  });

  it('normalizes coordinates and drops events outside the video', () => {
    const out = normalizeEvents(
      [
        { type: 'click', t: 10_500, vw: 1280, vh: 720, x: 640, y: 360, rect: [600, 340, 80, 40] },
        { type: 'click', t: 1_000, vw: 1280, vh: 720, x: 1, y: 1 },
      ],
      clockMap([{ page: 10_000, video: 1 }]),
      { w: 1280, h: 720 },
      30,
    );
    assert.equal(out.length, 1);
    const e = out[0]!;
    assert.equal(e.type, 'click');
    if (e.type === 'click') {
      assert.equal(e.t, 1.5);
      assert.deepEqual([e.x, e.y], [0.5, 0.5]);
    }
  });

  it('finds flash runs and the magenta box', () => {
    assert.deepEqual(findFlashRuns([0, 0, 0.3, 0.31, 0.3, 0, 0, 0.29, 0.3, 0]), [
      { start: 2, end: 4 },
      { start: 7, end: 8 },
    ]);
    const w = 40;
    const h = 30;
    const rgb = Buffer.alloc(w * h * 3, 30);
    for (let y = 5; y < 25; y++)
      for (let x = 8; x < 36; x++) {
        const o = (y * w + x) * 3;
        rgb[o] = 255;
        rgb[o + 1] = 0;
        rgb[o + 2] = 255;
      }
    const box = magentaBox(rgb, w, h)!;
    assert.deepEqual(box, { x: 8, y: 5, w: 28, h: 20 });
    assert.deepEqual(tidyBox(box, { top: 2, right: 2, bottom: 2, left: 2 }, { w, h }), { x: 10, y: 8, w: 24, h: 14 });
  });
});
