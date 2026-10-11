import { getBounds, getHandles, type Point } from '@whiteboard/shared';
import {
  createDefaultCamera,
  panCamera,
  screenToWorld,
  setZoomAt,
  zoomAt,
  type Camera,
} from './camera.js';
import {
  drawBackgroundGrid,
  drawGuides,
  drawHoverOutline,
  drawObject,
  drawRemoteCursors,
  drawRemoteDragPreviews,
  drawSelectionBox,
  isBoundsInViewport,
} from './render.js';
import type { BoardStore } from '../store/boardStore.js';
import { SelectTool } from '../tools/SelectTool.js';
import { ShapeTool } from '../tools/ShapeTool.js';
import { LineTool } from '../tools/LineTool.js';
import { PenTool } from '../tools/PenTool.js';
import { TextTool } from '../tools/TextTool.js';
import { HandTool } from '../tools/HandTool.js';
import type { Tool, ToolContext } from '../tools/Tool.js';

export class CanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private store: BoardStore;
  private camera: Camera = createDefaultCamera();

  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private isSpaceDown = false;
  private isMiddlePanning = false;
  private lastPanPoint: Point = { x: 0, y: 0 };

  private tools: Record<string, Tool> = {
    select: new SelectTool(),
    rect: new ShapeTool('rect'),
    ellipse: new ShapeTool('ellipse'),
    line: new LineTool(),
    pen: new PenTool(),
    text: new TextTool(),
    hand: new HandTool(),
  };

  private openTextEditorCallback?: (worldPos: Point, existingTextId?: string) => void;
  private onCameraChangeCallback?: (camera: Camera) => void;

  private unsubscribeStore: (() => void) | null = null;
  private isPointerDown = false;

  constructor(
    canvas: HTMLCanvasElement,
    store: BoardStore,
    openTextEditor?: (worldPos: Point, existingTextId?: string) => void,
    onCameraChange?: (camera: Camera) => void,
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not obtain Canvas 2D context');
    this.ctx = context;
    this.store = store;
    this.openTextEditorCallback = openTextEditor;
    this.onCameraChangeCallback = onCameraChange;

    this.init();
  }

  private init(): void {
    this.setupResize();
    this.attachEventListeners();
    this.startRenderLoop();
    this.unsubscribeStore = this.store.subscribe(() => {
      this.updateCursor();
    });
    this.updateCursor();
  }

  private setupResize(): void {
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);

      if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.store.dirty = true;
      }
    };

    this.resizeObserver = new ResizeObserver(() => handleResize());
    if (this.canvas.parentElement) {
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    handleResize();
  }

  private getToolContext(): ToolContext {
    return {
      store: this.store,
      camera: this.camera,
      setCamera: (cam) => this.setCamera(cam),
      openTextEditor: this.openTextEditorCallback,
    };
  }

  public setCamera(newCamera: Camera): void {
    this.camera = newCamera;
    this.store.dirty = true;
    if (this.onCameraChangeCallback) {
      this.onCameraChangeCallback(this.camera);
    }
  }

  public getCamera(): Camera {
    return this.camera;
  }

  private getScreenPoint(e: PointerEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private attachEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  public updateCursor(worldPt?: Point): void {
    if (this.isSpaceDown || this.isMiddlePanning) {
      this.canvas.style.cursor = this.isMiddlePanning ? 'grabbing' : 'grab';
      return;
    }

    const tool = this.store.activeTool;
    switch (tool) {
      case 'hand':
        this.canvas.style.cursor = this.isPointerDown ? 'grabbing' : 'grab';
        break;

      case 'pen':
      case 'rect':
      case 'ellipse':
      case 'line':
        // Universal crosshair cursor across all platforms (Figma, Miro, Illustrator, Photoshop)
        this.canvas.style.cursor = 'crosshair';
        break;

      case 'text':
        this.canvas.style.cursor = 'text';
        break;

      case 'select': {
        if (worldPt && this.store.selectedId) {
          const selObj = this.store.view.objects[this.store.selectedId];
          if (selObj && !selObj.deleted) {
            const handles = getHandles(selObj);
            const radius = 8 / this.camera.zoom;
            for (const [hType, pt] of Object.entries(handles)) {
              if (pt && Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= radius) {
                switch (hType) {
                  case 'nw':
                  case 'se':
                    this.canvas.style.cursor = 'nwse-resize';
                    return;
                  case 'ne':
                  case 'sw':
                    this.canvas.style.cursor = 'nesw-resize';
                    return;
                  case 'n':
                  case 's':
                    this.canvas.style.cursor = 'ns-resize';
                    return;
                  case 'e':
                  case 'w':
                    this.canvas.style.cursor = 'ew-resize';
                    return;
                  case 'p1':
                  case 'p2':
                    this.canvas.style.cursor = 'crosshair';
                    return;
                }
              }
            }
          }
        }

        if (worldPt && this.store.hoveredId) {
          this.canvas.style.cursor = 'move';
        } else {
          this.canvas.style.cursor = 'default';
        }
        break;
      }

      default:
        this.canvas.style.cursor = 'default';
        break;
    }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.isPointerDown = true;
    const screenPt = this.getScreenPoint(e);
    const worldPt = screenToWorld(screenPt, this.camera);

    // Space drag or middle button pan
    if (this.isSpaceDown || e.button === 1) {
      this.isMiddlePanning = true;
      this.lastPanPoint = screenPt;
      this.updateCursor(worldPt);
      return;
    }

    const activeTool = this.tools[this.store.activeTool] ?? this.tools['select']!;
    activeTool.onPointerDown(screenPt, worldPt, e, this.getToolContext());
    this.updateCursor(worldPt);
    this.store.dirty = true;
  };

  private lastCursorSendTime = 0;

  private handlePointerMove = (e: PointerEvent): void => {
    const screenPt = this.getScreenPoint(e);
    const worldPt = screenToWorld(screenPt, this.camera);

    // Throttle live cursor broadcast (approx 25fps)
    const now = Date.now();
    if (now - this.lastCursorSendTime > 40) {
      this.lastCursorSendTime = now;
      this.store.sendCursor(Math.round(worldPt.x * 10) / 10, Math.round(worldPt.y * 10) / 10);
    }

    if (this.isMiddlePanning) {
      const dx = screenPt.x - this.lastPanPoint.x;
      const dy = screenPt.y - this.lastPanPoint.y;
      this.lastPanPoint = screenPt;
      this.setCamera(panCamera(this.camera, dx, dy));
      this.updateCursor(worldPt);
      return;
    }

    const activeTool = this.tools[this.store.activeTool] ?? this.tools['select']!;
    activeTool.onPointerMove(screenPt, worldPt, e, this.getToolContext());
    this.updateCursor(worldPt);
    this.store.dirty = true;
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.isPointerDown = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    if (this.isMiddlePanning) {
      this.isMiddlePanning = false;
    }

    const screenPt = this.getScreenPoint(e);
    const worldPt = screenToWorld(screenPt, this.camera);

    const activeTool = this.tools[this.store.activeTool] ?? this.tools['select']!;
    activeTool.onPointerUp(screenPt, worldPt, e, this.getToolContext());
    this.updateCursor(worldPt);
    this.store.dirty = true;
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const screenPt = this.getScreenPoint(e);

    // Pinch or Ctrl/Cmd + wheel = Zoom around cursor
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = Math.pow(0.992, e.deltaY);
      this.setCamera(zoomAt(this.camera, screenPt, zoomFactor));
    } else {
      // Plain wheel = Pan
      this.setCamera(panCamera(this.camera, -e.deltaX, -e.deltaY));
    }
    const worldPt = screenToWorld(screenPt, this.camera);
    this.updateCursor(worldPt);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore keyboard shortcuts if an input/textarea has focus
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.updateCursor();
    }

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          if (e.shiftKey) {
            this.store.redo();
          } else {
            this.store.undo();
          }
          return;
        case 'y':
          this.store.redo();
          return;
        case 'd':
          e.preventDefault();
          this.store.duplicateSelection();
          return;
        case 'c':
          this.store.copySelection();
          return;
        case 'v':
          this.store.paste();
          return;
        case '[':
          this.store.reorderSelection('back');
          return;
        case ']':
          this.store.reorderSelection('front');
          return;
      }
    }

    // Tool & navigation shortcuts without Ctrl/Cmd
    switch (e.key.toLowerCase()) {
      case 'v':
        this.store.setActiveTool('select');
        break;
      case 'r':
        this.store.setActiveTool('rect');
        break;
      case 'o':
        this.store.setActiveTool('ellipse');
        break;
      case 'l':
        this.store.setActiveTool('line');
        break;
      case 'p':
        this.store.setActiveTool('pen');
        break;
      case 't':
        this.store.setActiveTool('text');
        break;
      case 'h':
        this.store.setActiveTool('hand');
        break;
      case 'delete':
      case 'backspace':
        this.store.deleteSelection();
        break;
      case 'escape':
        this.store.setSelected(null);
        this.store.setDraft(null);
        this.store.setOverrides({});
        this.store.setGuides([]);
        break;
      case '[':
        this.store.reorderSelection('backward');
        break;
      case ']':
        this.store.reorderSelection('forward');
        break;
      case '+':
      case '=':
        this.setCamera(zoomAt(this.camera, { x: this.canvas.width / 2, y: this.canvas.height / 2 }, 1.2));
        break;
      case '-':
      case '_':
        this.setCamera(zoomAt(this.camera, { x: this.canvas.width / 2, y: this.canvas.height / 2 }, 0.8));
        break;
      case '0':
        if (e.shiftKey) {
          this.setCamera(setZoomAt(this.camera, { x: this.canvas.width / 2, y: this.canvas.height / 2 }, 1.0));
        }
        break;
      case 'arrowleft':
        this.store.nudge(e.shiftKey ? -10 : -1, 0);
        break;
      case 'arrowright':
        this.store.nudge(e.shiftKey ? 10 : 1, 0);
        break;
      case 'arrowup':
        this.store.nudge(0, e.shiftKey ? -10 : -1);
        break;
      case 'arrowdown':
        this.store.nudge(0, e.shiftKey ? 10 : 1);
        break;
    }

  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      this.updateCursor();
    }
  };

  private startRenderLoop(): void {
    const render = () => {
      const hasRemoteActivity =
        Object.keys(this.store.remoteCursors).length > 0 ||
        Object.keys(this.store.remoteDragPreviews).length > 0;

      if (this.store.dirty || hasRemoteActivity) {
        this.draw();
        this.store.dirty = false;
      }
      this.animationFrameId = requestAnimationFrame(render);
    };
    this.animationFrameId = requestAnimationFrame(render);
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr;
    const vh = this.canvas.height / dpr;

    this.ctx.save();
    this.ctx.scale(dpr, dpr);

    // Draw background grid
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    drawBackgroundGrid(this.ctx, this.camera, vw, vh, theme);

    // Set world transform
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Draw live objects in order (with viewport culling)
    for (const id of this.store.view.order) {
      const obj = this.store.view.objects[id];
      if (!obj || obj.deleted) continue;

      const bounds = getBounds(obj);
      if (!isBoundsInViewport(bounds, this.camera, vw, vh)) {
        continue;
      }

      const override = this.store.overrides[id];
      drawObject(this.ctx, obj, override);
    }

    // 2. Draw remote drag previews (ghost bounding boxes of teammates' drags)
    if (Object.keys(this.store.remoteDragPreviews).length > 0) {
      drawRemoteDragPreviews(
        this.ctx,
        this.store.remoteDragPreviews,
        this.store.view.objects,
        this.store.presenceUsers,
        this.camera,
      );
    }

    // 3. Draw local draft shape
    if (this.store.draftObj) {
      drawObject(this.ctx, this.store.draftObj);
    }

    // 4. Draw hover outline
    if (this.store.hoveredId && this.store.hoveredId !== this.store.selectedId) {
      const hoveredObj = this.store.view.objects[this.store.hoveredId];
      if (hoveredObj && !hoveredObj.deleted) {
        drawHoverOutline(this.ctx, hoveredObj, this.camera);
      }
    }

    // 5. Draw selection box and handles
    if (this.store.selectedId) {
      const selectedObj = this.store.view.objects[this.store.selectedId];
      if (selectedObj && !selectedObj.deleted) {
        const override = this.store.overrides[this.store.selectedId];
        const effectiveObj = override ? { ...selectedObj, props: { ...selectedObj.props, ...override } } : selectedObj;
        drawSelectionBox(this.ctx, effectiveObj, this.camera, this.store.isResizing);
      }
    }

    // 6. Draw snapping guides
    if (this.store.guides.length > 0) {
      drawGuides(this.ctx, this.store.guides, this.camera);
    }

    // 7. Draw remote collaborative cursors on top of everything
    if (Object.keys(this.store.remoteCursors).length > 0) {
      drawRemoteCursors(
        this.ctx,
        this.store.remoteCursors,
        this.store.presenceUsers,
        this.camera,
      );
    }

    this.ctx.restore();
  }
}
