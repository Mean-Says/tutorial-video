import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CAMERA, focusBox, groupTargets, planCamera, viewFor } from '../src/lib/camera.ts';
import { cameraAt, cameraTransform } from '../src/remotion/layout.ts';

const o = DEFAULT_CAMERA;

describe('focusBox', () => {
  it('uses a small element rect, falls back to a box around the point for huge ones', () => {
    assert.deepEqual(focusBox({ x: 0.5, y: 0.5 }, [0.4, 0.4, 0.1, 0.05])?.map((v) => Number(v.toFixed(2))), [0.38, 0.38, 0.14, 0.09]);
    const big = focusBox({ x: 0.5, y: 0.5 }, [0, 0, 1, 1])!;
    assert.ok(big[2] < 0.3);
  });
});

describe('viewFor', () => {
  it('caps zoom and keeps the view inside the screen', () => {
    const v = viewFor([0.95, 0.95, 0.02, 0.02], o);
    assert.equal(v.z, o.zoomMax);
    assert.ok(v.cx <= 1 - 0.5 / v.z + 1e-9 && v.cy <= 1 - 0.5 / v.z + 1e-9);
  });
});

describe('groupTargets', () => {
  it('splits on distance, time and navigation', () => {
    const g = groupTargets(
      [
        { f: 30, box: [0.1, 0.1, 0.1, 0.05] },
        { f: 45, box: [0.15, 0.12, 0.1, 0.05] },
        { f: 60, box: [0.8, 0.8, 0.1, 0.05] },
        { f: 400, box: [0.8, 0.82, 0.1, 0.05] },
      ],
      [],
      o,
    );
    assert.equal(g.length, 3);
    const withNav = groupTargets(
      [
        { f: 30, box: [0.1, 0.1, 0.1, 0.05] },
        { f: 45, box: [0.12, 0.1, 0.1, 0.05] },
      ],
      [40],
      o,
    );
    assert.equal(withNav.length, 2);
  });
});

describe('planCamera', () => {
  it('zooms in before the action, back out at the end, with increasing frames', () => {
    const keys = planCamera([{ f: 60, box: [0.7, 0.1, 0.1, 0.05] }], [], 200, o);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i]!.f > keys[i - 1]!.f, JSON.stringify(keys));
    const atAction = cameraAt(keys, 60);
    assert.ok(atAction.z > 1.5, `zoom at action ${atAction.z}`);
    assert.equal(cameraAt(keys, 199).z, 1);
    assert.equal(keys[0]!.z, 1);
  });

  it('leaves the zoom right after a click that navigates', () => {
    const keys = planCamera([{ f: 60, box: [0.85, 0.05, 0.08, 0.04] }], [60], 300, o);
    const atClick = cameraAt(keys, 60);
    assert.ok(atClick.z > 1.15 && atClick.z <= 1.4 + 1e-9, `gentle punch-in, got ${atClick.z}`);
    assert.equal(cameraAt(keys, 60 + Math.round(0.9 * 30)).z, 1);
  });

  it('stays still when the action area is already large', () => {
    const keys = planCamera([{ f: 60, box: [0.1, 0.1, 0.7, 0.7] }], [], 200, o);
    assert.equal(keys.length, 1);
  });

  it('survives an action in the very last frames', () => {
    const keys = planCamera([{ f: 98, box: [0.2, 0.2, 0.05, 0.05] }], [], 100, o);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i]!.f > keys[i - 1]!.f);
    assert.equal(cameraAt(keys, 99).z, 1);
  });
});

describe('cameraTransform', () => {
  it('is the identity at zoom 1', () => {
    assert.equal(cameraTransform({ f: 0, z: 1, cx: 0.5, cy: 0.5 }, 1000, 500), 'translate(0.00px, 0.00px) scale(1.0000)');
  });
});
