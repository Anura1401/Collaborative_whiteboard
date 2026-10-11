import { MAX_STROKE_NUMBERS, simplifyPoints, type Obj, type Point } from '@whiteboard/shared';
import type { Tool, ToolContext } from './Tool.js';

export class PenTool implements Tool {
  name = 'pen';
  private rawPoints: Point[] = [];
  private lastScreenPt: Point = { x: 0, y: 0 };
  private isDrawing = false;

  onPointerDown(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.isDrawing = true;
    this.rawPoints = [worldPt];
    this.lastScreenPt = screenPt;

    const draft: Obj = {
      id: crypto.randomUUID(),
      type: 'stroke',
      deleted: false,
      props: {
        x: worldPt.x,
        y: worldPt.y,
        points: [0, 0],
        color: ctx.store.style.stroke,
        strokeWidth: ctx.store.style.strokeWidth,
      },
    };

    ctx.store.setDraft(draft);
  }

  onPointerMove(screenPt: Point, worldPt: Point, _e: PointerEvent, ctx: ToolContext): void {
    if (!this.isDrawing) return;

    const distScreen = Math.hypot(
      screenPt.x - this.lastScreenPt.x,
      screenPt.y - this.lastScreenPt.y,
    );

    // Sample point only if at least 2 screen pixels from previous
    if (distScreen >= 2) {
      this.rawPoints.push(worldPt);
      this.lastScreenPt = screenPt;

      if (ctx.store.draftObj && this.rawPoints.length > 0) {
        const origin = this.rawPoints[0]!;
        const relativePts: number[] = [];
        for (const pt of this.rawPoints) {
          relativePts.push(pt.x - origin.x, pt.y - origin.y);
        }

        const updatedDraft: Obj = {
          ...ctx.store.draftObj,
          props: {
            ...ctx.store.draftObj.props,
            points: relativePts,
          },
        };
        ctx.store.setDraft(updatedDraft);
      }
    }
  }

  onPointerUp(_screenPt: Point, _worldPt: Point, _e: PointerEvent, ctx: ToolContext): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    ctx.store.setDraft(null);

    if (this.rawPoints.length < 2) return;

    const origin = this.rawPoints[0]!;
    const flatPoints: number[] = [];
    for (const pt of this.rawPoints) {
      flatPoints.push(pt.x - origin.x, pt.y - origin.y);
    }

    // Simplify with epsilon = 0.5 / zoom
    let epsilon = 0.5 / ctx.camera.zoom;
    let simplified = simplifyPoints(flatPoints, epsilon);

    // If exceeding stroke number cap, simplify harder
    while (simplified.length > MAX_STROKE_NUMBERS && epsilon < 50) {
      epsilon *= 1.5;
      simplified = simplifyPoints(flatPoints, epsilon);
    }

    if (simplified.length >= 4) {
      const strokeObj: Obj = {
        id: crypto.randomUUID(),
        type: 'stroke',
        deleted: false,
        props: {
          x: origin.x,
          y: origin.y,
          points: simplified,
          color: ctx.store.style.stroke,
          strokeWidth: ctx.store.style.strokeWidth,
        },
      };

      ctx.store.submit({
        type: 'CREATE_OBJECT',
        object: strokeObj,
      });
    }

    this.rawPoints = [];
  }

  cancel(ctx: ToolContext): void {
    this.isDrawing = false;
    this.rawPoints = [];
    ctx.store.setDraft(null);
  }
}
