import { describe, it, expect } from 'vitest';
import {
  distanceToSegment,
  simplifyPoints,
  getBounds,
  getHandles,
  resizeFromHandle,
  hitTest,
  type Obj,
} from '../src/index.js';

describe('geometry - distanceToSegment', () => {
  it('calculates orthogonal distance correctly', () => {
    const dist = distanceToSegment({ x: 5, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBe(10);
  });

  it('calculates distance to endpoints when off-segment', () => {
    const dist = distanceToSegment({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dist).toBe(5);
  });
});

describe('geometry - simplifyPoints (RDP)', () => {
  it('reduces colinear points on a line', () => {
    const straightLine = [0, 0, 10, 10, 20, 20, 30, 30, 40, 40];
    const simplified = simplifyPoints(straightLine, 1.0);
    expect(simplified).toEqual([0, 0, 40, 40]);
  });

  it('preserves significant bends', () => {
    const withSpike = [0, 0, 10, 0, 10, 50, 20, 0];
    const simplified = simplifyPoints(withSpike, 1.0);
    expect(simplified.length).toBeGreaterThanOrEqual(6);
  });

  it('never returns fewer than 2 points (4 numbers) when given >= 4 numbers', () => {
    const pts = [0, 0, 0.1, 0.1, 0.2, 0.2];
    const simplified = simplifyPoints(pts, 10.0);
    expect(simplified.length).toBe(4);
  });
});

describe('geometry - getBounds & getHandles', () => {
  const rectObj: Obj = {
    id: 'r1',
    type: 'rect',
    deleted: false,
    props: { x: 100, y: 50, width: 200, height: 150, fill: '#fff', stroke: '#000', strokeWidth: 2 },
  };

  const lineObj: Obj = {
    id: 'l1',
    type: 'line',
    deleted: false,
    props: { x1: 10, y1: 20, x2: 110, y2: 120, stroke: '#000', strokeWidth: 2 },
  };

  it('returns exact bounding box for rect and line', () => {
    expect(getBounds(rectObj)).toEqual({ x: 100, y: 50, width: 200, height: 150 });
    expect(getBounds(lineObj)).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it('returns 8 handles for rect and 2 for line', () => {
    const rectHandles = getHandles(rectObj);
    expect(Object.keys(rectHandles)).toHaveLength(8);
    expect(rectHandles.nw).toEqual({ x: 100, y: 50 });
    expect(rectHandles.se).toEqual({ x: 300, y: 200 });

    const lineHandles = getHandles(lineObj);
    expect(lineHandles.start).toEqual({ x: 10, y: 20 });
    expect(lineHandles.end).toEqual({ x: 110, y: 120 });
  });
});

describe('geometry - resizeFromHandle', () => {
  const rectObj: Obj = {
    id: 'r1',
    type: 'rect',
    deleted: false,
    props: { x: 100, y: 100, width: 200, height: 100, fill: '#fff', stroke: '#000', strokeWidth: 2 },
  };

  it('resizes from SE handle without moving origin', () => {
    const changes = resizeFromHandle(rectObj, 'se', { x: 50, y: 20 });
    expect(changes).toEqual({ x: 100, y: 100, width: 250, height: 120 });
  });

  it('resizes from NW handle adjusting origin and dimensions', () => {
    const changes = resizeFromHandle(rectObj, 'nw', { x: -30, y: -20 });
    expect(changes).toEqual({ x: 70, y: 80, width: 230, height: 120 });
  });

  it('maintains aspect ratio when locked', () => {
    // 200 x 100 has aspect ratio 2:1
    const changes = resizeFromHandle(rectObj, 'se', { x: 40, y: 0 }, true);
    expect(changes.width).toBe(240);
    expect(changes.height).toBe(120);
  });
});

describe('geometry - hitTest', () => {
  const filledRect: Obj = {
    id: 'r1',
    type: 'rect',
    deleted: false,
    props: { x: 100, y: 100, width: 200, height: 100, fill: '#ff0000', stroke: '#000', strokeWidth: 2 },
  };

  const hollowRect: Obj = {
    id: 'r2',
    type: 'rect',
    deleted: false,
    props: { x: 100, y: 100, width: 200, height: 100, fill: 'none', stroke: '#000', strokeWidth: 2 },
  };

  it('detects interior hit on filled rectangle and misses outside', () => {
    expect(hitTest(filledRect, { x: 150, y: 150 }, 5)).toBe(true);
    expect(hitTest(filledRect, { x: 50, y: 50 }, 5)).toBe(false);
  });

  it('detects border-only hit on hollow rectangle', () => {
    // Center of hollow rect should NOT hit
    expect(hitTest(hollowRect, { x: 200, y: 150 }, 5)).toBe(false);
    // Point on border should hit
    expect(hitTest(hollowRect, { x: 100, y: 150 }, 5)).toBe(true);
  });
});
