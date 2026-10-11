import {
  getBounds,
  getHandles,
  hitTest,
  resizeFromHandle,
  type HandleType,
  type Obj,
  type Point,
} from '@whiteboard/shared';
import { computeSnapping } from '../canvas/snapping.js';
import type { BoardStore } from '../store/boardStore.js';
import type { Tool, ToolContext } from './Tool.js';


export class SelectTool implements Tool {
  name = 'select';

  private isInteracting = false;
  private interactionMode: 'idle' | 'drag' | 'resize' = 'idle';
  private activeHandle: HandleType | null = null;
  private startScreenPt: Point = { x: 0, y: 0 };
  private startWorldPt: Point = { x: 0, y: 0 };
  private initialProps: Record<string, unknown> = {};
  private targetObj: Obj | null = null;
  private lastClickTime = 0;
  private lastDragPreviewTime = 0;

  onPointerDown(screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const { store, camera } = ctx;

    this.startScreenPt = screenPt;
    this.startWorldPt = worldPt;

    // 1. Check if clicking a handle on currently selected object
    if (store.selectedId) {
      const selectedObj = store.view.objects[store.selectedId];
      if (selectedObj && !selectedObj.deleted) {
        const handles = getHandles(selectedObj);
        const handleHitRadius = 8 / camera.zoom;

        for (const [hType, hPt] of Object.entries(handles)) {
          if (!hPt) continue;
          if (Math.hypot(worldPt.x - hPt.x, worldPt.y - hPt.y) <= handleHitRadius) {
            this.interactionMode = 'resize';
            this.activeHandle = hType as HandleType;
            this.targetObj = selectedObj;
            this.initialProps = { ...selectedObj.props };
            this.isInteracting = true;
            store.setIsResizing(true);
            return;
          }
        }
      }
    }

    // 2. Walk order front to back to hit-test objects
    const tolerance = 6 / camera.zoom;
    let hitObject: Obj | null = null;

    for (let i = store.view.order.length - 1; i >= 0; i--) {
      const id = store.view.order[i];
      if (!id) continue;
      const obj = store.view.objects[id];
      if (!obj || obj.deleted) continue;

      if (hitTest(obj, worldPt, tolerance)) {
        hitObject = obj;
        break;
      }
    }

    if (hitObject) {
      const now = Date.now();
      const isDoubleClick = now - this.lastClickTime < 350 && store.selectedId === hitObject.id;
      this.lastClickTime = now;

      // Double click text object opens editor
      if (isDoubleClick && hitObject.type === 'text' && ctx.openTextEditor) {
        ctx.openTextEditor({ x: Number(hitObject.props.x), y: Number(hitObject.props.y) }, hitObject.id);
        return;
      }

      store.setSelected(hitObject.id);
      this.interactionMode = 'drag';
      this.targetObj = hitObject;
      this.initialProps = { ...hitObject.props };
      this.isInteracting = true;
    } else {
      // Clicked empty space: deselect
      store.setSelected(null);
      this.interactionMode = 'idle';
      this.targetObj = null;
    }
  }

  onPointerMove(_screenPt: Point, worldPt: Point, e: PointerEvent, ctx: ToolContext): void {

    const { store, camera } = ctx;

    if (!this.isInteracting || !this.targetObj || !store.selectedId) {
      // Hover detection when idle
      const tolerance = 6 / camera.zoom;
      let hovered: string | null = null;
      for (let i = store.view.order.length - 1; i >= 0; i--) {
        const id = store.view.order[i];
        if (!id) continue;
        const obj = store.view.objects[id];
        if (obj && !obj.deleted && hitTest(obj, worldPt, tolerance)) {
          hovered = id;
          break;
        }
      }
      store.setHovered(hovered);
      return;
    }

    const deltaX = worldPt.x - this.startWorldPt.x;
    const deltaY = worldPt.y - this.startWorldPt.y;

    if (this.interactionMode === 'drag') {
      let finalDeltaX = deltaX;
      let finalDeltaY = deltaY;

      // Snapping (disabled if Ctrl or Cmd held)
      if (!e.ctrlKey && !e.metaKey) {
        const currentBounds = getBounds(this.targetObj);
        const translatedBounds = {
          ...currentBounds,
          x: currentBounds.x + deltaX,
          y: currentBounds.y + deltaY,
        };

        const otherObjects = store.view.order
          .filter((id) => id !== this.targetObj?.id)
          .map((id) => store.view.objects[id])
          .filter((o): o is Obj => Boolean(o && !o.deleted));

        const snap = computeSnapping(translatedBounds, otherObjects, camera.zoom);
        finalDeltaX += snap.deltaX;
        finalDeltaY += snap.deltaY;
        store.setGuides(snap.guides);
      } else {
        store.setGuides([]);
      }

      // Compute local props override
      const override: Record<string, unknown> = {};
      if ('x' in this.initialProps) {
        override.x = (Number(this.initialProps.x) || 0) + finalDeltaX;
        override.y = (Number(this.initialProps.y) || 0) + finalDeltaY;
      } else if ('x1' in this.initialProps) {
        override.x1 = (Number(this.initialProps.x1) || 0) + finalDeltaX;
        override.y1 = (Number(this.initialProps.y1) || 0) + finalDeltaY;
        override.x2 = (Number(this.initialProps.x2) || 0) + finalDeltaX;
        override.y2 = (Number(this.initialProps.y2) || 0) + finalDeltaY;
      }

      store.setOverrides({ [this.targetObj.id]: override });
    } else if (this.interactionMode === 'resize' && this.activeHandle) {
      const lockAspect = e.shiftKey;
      const resizedChanges = resizeFromHandle(
        this.targetObj,
        this.activeHandle,
        { x: deltaX, y: deltaY },
        lockAspect,
      );

      store.setOverrides({ [this.targetObj.id]: resizedChanges });
    }

    const now = Date.now();
    if (now - this.lastDragPreviewTime > 50 && this.targetObj && store.overrides[this.targetObj.id]) {
      this.lastDragPreviewTime = now;
      store.sendDragPreview(this.targetObj.id, store.overrides[this.targetObj.id]!);
    }
  }

  onPointerUp(screenPt: Point, _worldPt: Point, _e: PointerEvent, ctx: ToolContext): void {
    const { store } = ctx;
    if (!this.isInteracting || !this.targetObj || !store.selectedId) {
      this.reset(store);
      return;
    }

    const distScreen = Math.hypot(
      screenPt.x - this.startScreenPt.x,
      screenPt.y - this.startScreenPt.y,
    );

    // If moved more than 2 screen pixels, commit changes
    if (distScreen > 2 && store.overrides[this.targetObj.id]) {
      const changes = store.overrides[this.targetObj.id]!;
      store.setOverrides({});
      store.setGuides([]);
      store.setIsResizing(false);

      store.submit({
        type: 'SET_PROPS',
        objectId: this.targetObj.id,
        changes,
      });
    } else {
      store.setOverrides({});
      store.setGuides([]);
      store.setIsResizing(false);
    }

    this.reset(store);
  }

  cancel(ctx: ToolContext): void {
    this.reset(ctx.store);
  }

  private reset(store: BoardStore): void {
    this.isInteracting = false;
    this.interactionMode = 'idle';
    this.activeHandle = null;
    this.targetObj = null;
    this.initialProps = {};
    store.setOverrides({});
    store.setGuides([]);
    store.setIsResizing(false);
  }
}
