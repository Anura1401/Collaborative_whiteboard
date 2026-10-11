import { describe, it, expect } from 'vitest';
import {
  hitTest,
  type Obj,
} from '@whiteboard/shared';
import { screenToWorld, worldToScreen, type Camera } from '../src/canvas/camera.js';

describe('Hit testing at multiple zoom levels (0.1x to 8.0x)', () => {
  const rectObj: Obj = {
    id: 'r1',
    type: 'rect',
    deleted: false,
    props: {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
    },
  };

  const hollowEllipse: Obj = {
    id: 'e1',
    type: 'ellipse',
    deleted: false,
    props: {
      x: 500,
      y: 500,
      width: 100,
      height: 100,
      fill: 'none',
      stroke: '#000000',
      strokeWidth: 4,
    },
  };

  const lineObj: Obj = {
    id: 'l1',
    type: 'line',
    deleted: false,
    props: {
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 0,
      stroke: '#000000',
      strokeWidth: 2,
    },
  };

  const zoomLevels = [0.1, 0.5, 1.0, 2.0, 4.0, 8.0];

  for (const zoom of zoomLevels) {
    describe(`Zoom level: ${zoom}x`, () => {
      const camera: Camera = { x: 0, y: 0, zoom };
      const toleranceWorld = 6 / zoom; // 6 screen pixels converted to world

      it('hit-tests center of filled rectangle', () => {
        const centerWorld = { x: 200, y: 150 };
        const centerScreen = worldToScreen(centerWorld, camera);
        const mappedWorld = screenToWorld(centerScreen, camera);

        expect(hitTest(rectObj, mappedWorld, toleranceWorld)).toBe(true);
      });

      it('misses outside rectangle', () => {
        const outsideWorld = { x: 100 - toleranceWorld - 10, y: 100 - toleranceWorld - 10 };
        expect(hitTest(rectObj, outsideWorld, toleranceWorld)).toBe(false);
      });


      it('hit-tests hollow ellipse near border but misses center', () => {
        const borderWorld = { x: 500, y: 550 }; // leftmost point on circle
        const centerWorld = { x: 550, y: 550 }; // center

        expect(hitTest(hollowEllipse, borderWorld, toleranceWorld)).toBe(true);
        expect(hitTest(hollowEllipse, centerWorld, toleranceWorld)).toBe(false);
      });

      it('hit-tests line segment with tolerance', () => {
        const nearLine = { x: 50, y: toleranceWorld / 2 };
        const farFromLine = { x: 50, y: toleranceWorld * 2 };

        expect(hitTest(lineObj, nearLine, toleranceWorld)).toBe(true);
        expect(hitTest(lineObj, farFromLine, toleranceWorld)).toBe(false);
      });
    });
  }
});
