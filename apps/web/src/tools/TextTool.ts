import type { Point } from '@whiteboard/shared';
import type { Tool, ToolContext } from './Tool.js';

export class TextTool implements Tool {
  name = 'text';
  private downWorldPt: Point | null = null;

  onPointerDown(_screenPt: Point, worldPt: Point, e: PointerEvent, _ctx: ToolContext): void {
    if (e.button !== 0) return;
    this.downWorldPt = worldPt;
  }

  onPointerMove(): void {}

  onPointerUp(_screenPt: Point, _worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (e.button !== 0 || !this.downWorldPt) return;
    const pt = this.downWorldPt;
    this.downWorldPt = null;

    if (ctx.openTextEditor) {
      ctx.openTextEditor(pt);
    }

    if (!ctx.store.isToolLocked) {
      ctx.store.setActiveTool('select');
    }
  }

  cancel(): void {
    this.downWorldPt = null;
  }
}
