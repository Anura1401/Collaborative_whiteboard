import type { Point } from '@whiteboard/shared';
import { panCamera } from '../canvas/camera.js';
import type { Tool, ToolContext } from './Tool.js';

export class HandTool implements Tool {
  name = 'hand';
  private isPanning = false;
  private lastScreenPt: Point = { x: 0, y: 0 };

  onPointerDown(screenPt: Point, _worldPt: Point, e: PointerEvent, _ctx: ToolContext): void {
    if (e.button !== 0 && e.button !== 1) return;
    this.isPanning = true;
    this.lastScreenPt = screenPt;
  }

  onPointerMove(screenPt: Point, _worldPt: Point, _e: PointerEvent, ctx: ToolContext): void {
    if (!this.isPanning) return;

    const dx = screenPt.x - this.lastScreenPt.x;
    const dy = screenPt.y - this.lastScreenPt.y;
    this.lastScreenPt = screenPt;

    ctx.setCamera(panCamera(ctx.camera, dx, dy));
  }

  onPointerUp(_screenPt: Point, _worldPt: Point, _e: PointerEvent, _ctx: ToolContext): void {
    this.isPanning = false;
  }

  cancel(): void {
    this.isPanning = false;
  }
}
