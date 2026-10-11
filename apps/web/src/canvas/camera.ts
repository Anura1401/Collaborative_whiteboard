import type { Point, RectBounds } from '@whiteboard/shared';

export interface Camera {
  x: number; // World X at top-left of viewport
  y: number; // World Y at top-left of viewport
  zoom: number; // Scale factor (0.1 to 8.0)
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8.0;

export function createDefaultCamera(): Camera {
  return { x: 0, y: 0, zoom: 1.0 };
}

export function screenToWorld(screenPoint: Point, camera: Camera): Point {
  return {
    x: screenPoint.x / camera.zoom + camera.x,
    y: screenPoint.y / camera.zoom + camera.y,
  };
}

export function worldToScreen(worldPoint: Point, camera: Camera): Point {
  return {
    x: (worldPoint.x - camera.x) * camera.zoom,
    y: (worldPoint.y - camera.y) * camera.zoom,
  };
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function zoomAt(camera: Camera, screenPivot: Point, zoomFactor: number): Camera {
  const currentWorldPivot = screenToWorld(screenPivot, camera);
  const nextZoom = clampZoom(camera.zoom * zoomFactor);

  if (nextZoom === camera.zoom) {
    return camera;
  }

  const nextX = currentWorldPivot.x - screenPivot.x / nextZoom;
  const nextY = currentWorldPivot.y - screenPivot.y / nextZoom;

  return {
    x: nextX,
    y: nextY,
    zoom: nextZoom,
  };
}

export function setZoomAt(camera: Camera, screenPivot: Point, targetZoom: number): Camera {
  const currentWorldPivot = screenToWorld(screenPivot, camera);
  const nextZoom = clampZoom(targetZoom);

  const nextX = currentWorldPivot.x - screenPivot.x / nextZoom;
  const nextY = currentWorldPivot.y - screenPivot.y / nextZoom;

  return {
    x: nextX,
    y: nextY,
    zoom: nextZoom,
  };
}

export function panCamera(camera: Camera, screenDeltaX: number, screenDeltaY: number): Camera {
  return {
    ...camera,
    x: camera.x - screenDeltaX / camera.zoom,
    y: camera.y - screenDeltaY / camera.zoom,
  };
}

export function fitBounds(
  bounds: RectBounds,
  viewportWidth: number,
  viewportHeight: number,
  padding = 64,
): Camera {
  if (bounds.width <= 0 || bounds.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return createDefaultCamera();
  }

  const availableW = Math.max(10, viewportWidth - padding * 2);
  const availableH = Math.max(10, viewportHeight - padding * 2);

  const zoomX = availableW / bounds.width;
  const zoomY = availableH / bounds.height;
  const nextZoom = clampZoom(Math.min(zoomX, zoomY, 1.0)); // Don't over-zoom small shapes past 100%

  const centerWorldX = bounds.x + bounds.width / 2;
  const centerWorldY = bounds.y + bounds.height / 2;

  const nextX = centerWorldX - viewportWidth / (2 * nextZoom);
  const nextY = centerWorldY - viewportHeight / (2 * nextZoom);

  return {
    x: nextX,
    y: nextY,
    zoom: nextZoom,
  };
}
