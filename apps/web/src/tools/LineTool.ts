import type { Obj, Point } from '@whiteboard/shared';
import { constrainTo45Degrees } from '../canvas/snapping.js';
import type { Tool, ToolContext } from './Tool.js';

export class LineTool implements Tool {
  name = 'line';
  private startScreenPt: Point = { x: 0, y: 0 };
  private startWorldPt: Point = { x: 0, y: 0 };
  private isDrawing = false;

  onPointerDown(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.startScreenPt = screenPt;
    this.startWorldPt = worldPt;
    this.isDrawing = true;

    const draft: Obj = {
      id: crypto.randomUUID(),
      type: 'line',
      deleted: false,
      props: {
        x1: worldPt.x,
        y1: worldPt.y,
        x2: worldPt.x + 1,
        y2: worldPt.y + 1,
        stroke: ctx.store.style.stroke,
        strokeWidth: ctx.store.style.strokeWidth,
      },
    };

    ctx.store.setDraft(draft);
  }

  onPointerMove(_screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (!this.isDrawing || !ctx.store.draftObj) return;

    let targetWorldPt = worldPt;
    if (e.shiftKey) {
      targetWorldPt = constrainTo45Degrees(this.startWorldPt, worldPt);
    }

    const updatedDraft: Obj = {
      ...ctx.store.draftObj,
      props: {
        ...ctx.store.draftObj.props,
        x1: this.startWorldPt.x,
        y1: this.startWorldPt.y,
        x2: targetWorldPt.x,
        y2: targetWorldPt.y,
      },
    };

    ctx.store.setDraft(updatedDraft);
  }

  onPointerUp(screenPt: Point, _worldPt: Point, _e: PointerEvent, ctx: ToolContext): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const draft = ctx.store.draftObj;
    ctx.store.setDraft(null);

    if (!draft) return;

    const distScreen = Math.hypot(
      screenPt.x - this.startScreenPt.x,
      screenPt.y - this.startScreenPt.y,
    );

    const x1 = Number(draft.props.x1);
    const y1 = Number(draft.props.y1);
    const x2 = Number(draft.props.x2);
    const y2 = Number(draft.props.y2);

    // Endpoints must differ and screen distance >= 3px
    if (distScreen >= 3 && (x1 !== x2 || y1 !== y2)) {
      ctx.store.submit({
        type: 'CREATE_OBJECT',
        object: draft,
      });

      ctx.store.setSelected(draft.id);

      if (!ctx.store.isToolLocked) {
        ctx.store.setActiveTool('select');
      }
    }
  }

  cancel(ctx: ToolContext): void {
    this.isDrawing = false;
    ctx.store.setDraft(null);
  }
}
