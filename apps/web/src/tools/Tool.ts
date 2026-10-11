import type { Point } from '@whiteboard/shared';
import type { Camera } from '../canvas/camera.js';
import type { BoardStore } from '../store/boardStore.js';

export interface ToolContext {
  store: BoardStore;
  camera: Camera;
  setCamera: (camera: Camera) => void;
  openTextEditor?: (pos: Point, existingTextId?: string) => void;
}

export interface Tool {
  name: string;
  onPointerDown(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void;
  onPointerMove(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void;
  onPointerUp(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
  cancel?(ctx: ToolContext): void;
}
