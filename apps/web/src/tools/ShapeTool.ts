import type { Obj, Point } from '@whiteboard/shared';
import type { Tool, ToolContext } from './Tool.js';

export class ShapeTool implements Tool {
  name: string;
  private shapeType: 'rect' | 'ellipse';
  private startScreenPt: Point = { x: 0, y: 0 };
  private startWorldPt: Point = { x: 0, y: 0 };
  private isDrawing = false;

  constructor(shapeType: 'rect' | 'ellipse') {
    this.name = shapeType;
    this.shapeType = shapeType;
  }

  onPointerDown(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.startScreenPt = screenPt;
    this.startWorldPt = worldPt;
    this.isDrawing = true;

    const draft: Obj = {
      id: crypto.randomUUID(),
      type: this.shapeType,
      deleted: false,
      props: {
        x: worldPt.x,
        y: worldPt.y,
        width: 1,
        height: 1,
        fill: ctx.store.style.fill,
        stroke: ctx.store.style.stroke,
        strokeWidth: ctx.store.style.strokeWidth,
      },
    };

    ctx.store.setDraft(draft);
  }

  onPointerMove(_screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (!this.isDrawing || !ctx.store.draftObj) return;

    let width = Math.abs(worldPt.x - this.startWorldPt.x);
    let height = Math.abs(worldPt.y - this.startWorldPt.y);

    if (e.shiftKey) {
      const side = Math.max(width, height);
      width = side;
      height = side;
    }

    const x = Math.min(this.startWorldPt.x, worldPt.x);
    const y = Math.min(this.startWorldPt.y, worldPt.y);

    const updatedDraft: Obj = {
      ...ctx.store.draftObj,
      props: {
        ...ctx.store.draftObj.props,
        x,
        y,
        width: Math.max(1, width),
        height: Math.max(1, height),
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

    // If draft >= 3 screen pixels, commit
    if (distScreen >= 3 && Number(draft.props.width) >= 1 && Number(draft.props.height) >= 1) {
      ctx.store.submit({
        type: 'CREATE_OBJECT',
        object: draft,
      });

      ctx.store.setSelected(draft.id);

      // Return to select unless locked
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
