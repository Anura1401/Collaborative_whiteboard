import {
  getBounds,
  getHandles,
  type Obj,
  type PresenceUser,
  type RectBounds,
} from '@whiteboard/shared';

import type { Camera } from './camera.js';
import type { SnapGuide } from './snapping.js';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  viewportWidth: number;
  viewportHeight: number;
  selectedId: string | null;
  hoveredId: string | null;
  draftObj: Obj | null;
  overrides?: Record<string, Record<string, unknown>>;
  guides?: SnapGuide[];
  isResizing?: boolean;
  theme?: 'light' | 'dark';
}

export function isBoundsInViewport(bounds: RectBounds, camera: Camera, vw: number, vh: number): boolean {
  const worldLeft = camera.x;
  const worldTop = camera.y;
  const worldRight = camera.x + vw / camera.zoom;
  const worldBottom = camera.y + vh / camera.zoom;

  return !(
    bounds.x + bounds.width < worldLeft ||
    bounds.x > worldRight ||
    bounds.y + bounds.height < worldTop ||
    bounds.y > worldBottom
  );
}

export function drawBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  vw: number,
  vh: number,
  theme = 'light',
): void {
  // Base background: sleek dark slate (not pure black)
  ctx.fillStyle = theme === 'dark' ? '#1e1e24' : '#f5f5f5';
  ctx.fillRect(0, 0, vw, vh);

  // Dot grid
  const gridSize = 20;
  const scaledGrid = gridSize * camera.zoom;

  // Fade dots when zoomed far out (< 0.4x)
  if (scaledGrid < 8) return;

  const alpha = Math.min(0.55, Math.max(0.1, (scaledGrid - 8) / 20));
  ctx.fillStyle = theme === 'dark' ? `rgba(148, 163, 184, ${alpha * 0.45})` : `rgba(0, 0, 0, ${alpha * 0.25})`;

  const startX = ((-camera.x * camera.zoom) % scaledGrid + scaledGrid) % scaledGrid;
  const startY = ((-camera.y * camera.zoom) % scaledGrid + scaledGrid) % scaledGrid;

  for (let x = startX; x < vw; x += scaledGrid) {
    for (let y = startY; y < vh; y += scaledGrid) {
      ctx.fillRect(Math.floor(x), Math.floor(y), 1.5, 1.5);
    }
  }
}

export function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: Obj,
  overrideProps?: Record<string, unknown>,
): void {
  if (obj.deleted) return;
  const p = overrideProps ? { ...obj.props, ...overrideProps } : obj.props;

  ctx.save();

  switch (obj.type) {
    case 'rect': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const width = Number(p['width'] ?? 1);
      const height = Number(p['height'] ?? 1);
      const fill = String(p['fill'] ?? 'none');
      const stroke = String(p['stroke'] ?? '#000000');
      const strokeWidth = Number(p['strokeWidth'] ?? 1);

      ctx.beginPath();
      ctx.rect(x, y, width, height);

      if (fill !== 'none') {
        ctx.fillStyle = fill;
        ctx.fill();
      }

      if (strokeWidth > 0 && stroke !== 'none') {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }
      break;
    }

    case 'ellipse': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const width = Number(p['width'] ?? 1);
      const height = Number(p['height'] ?? 1);
      const fill = String(p['fill'] ?? 'none');
      const stroke = String(p['stroke'] ?? '#000000');
      const strokeWidth = Number(p['strokeWidth'] ?? 1);

      const rx = width / 2;
      const ry = height / 2;
      const cx = x + rx;
      const cy = y + ry;

      if (rx > 0 && ry > 0) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

        if (fill !== 'none') {
          ctx.fillStyle = fill;
          ctx.fill();
        }

        if (strokeWidth > 0 && stroke !== 'none') {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }
      }
      break;
    }

    case 'line': {
      const x1 = Number(p['x1'] ?? 0);
      const y1 = Number(p['y1'] ?? 0);
      const x2 = Number(p['x2'] ?? 0);
      const y2 = Number(p['y2'] ?? 0);
      const stroke = String(p['stroke'] ?? '#000000');
      const strokeWidth = Number(p['strokeWidth'] ?? 1);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
    }

    case 'stroke': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const points = (p['points'] as number[]) ?? [];
      const color = String(p['color'] ?? '#000000');
      const strokeWidth = Number(p['strokeWidth'] ?? 2);

      if (points.length >= 4) {
        ctx.beginPath();
        ctx.moveTo(x + points[0]!, y + points[1]!);
        for (let i = 2; i < points.length; i += 2) {
          ctx.lineTo(x + points[i]!, y + points[i + 1]!);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      break;
    }

    case 'text': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const width = Number(p['width'] ?? 200);
      const text = String(p['text'] ?? '');
      const fontSize = Number(p['fontSize'] ?? 16);
      const color = String(p['color'] ?? '#000000');

      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';

      // Simple word wrap
      const words = text.split(' ');
      let currentLine = '';
      let lineY = y;
      const lineHeight = fontSize * 1.25;

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > width && currentLine !== '') {
          ctx.fillText(currentLine, x, lineY);
          currentLine = word;
          lineY += lineHeight;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        ctx.fillText(currentLine, x, lineY);
      }
      break;
    }
  }

  ctx.restore();
}

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: Obj,
  camera: Camera,
  isResizing = false,
): void {
  const bounds = getBounds(obj);
  const strokeWidth = 1.5 / camera.zoom;
  const handleSize = 8 / camera.zoom;

  ctx.save();
  ctx.strokeStyle = '#0D99FF';
  ctx.lineWidth = strokeWidth;
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Draw handles
  const handles = getHandles(obj);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0D99FF';
  ctx.lineWidth = strokeWidth;

  for (const [, pt] of Object.entries(handles)) {
    if (!pt) continue;
    ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
  }

  // Size label during resize
  if (isResizing) {
    const label = `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
    ctx.font = `${10 / camera.zoom}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#18181b';
    const textMetrics = ctx.measureText(label);
    const labelW = textMetrics.width + 8 / camera.zoom;
    const labelH = 16 / camera.zoom;
    const labelX = bounds.x + bounds.width / 2 - labelW / 2;
    const labelY = bounds.y + bounds.height + 8 / camera.zoom;

    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, labelX + 4 / camera.zoom, labelY + labelH / 2);
  }

  ctx.restore();
}

export function drawHoverOutline(ctx: CanvasRenderingContext2D, obj: Obj, camera: Camera): void {
  const bounds = getBounds(obj);
  ctx.save();
  ctx.strokeStyle = 'rgba(13, 153, 255, 0.5)';
  ctx.lineWidth = 1 / camera.zoom;
  ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.restore();
}

export function drawGuides(ctx: CanvasRenderingContext2D, guides: SnapGuide[], camera: Camera): void {
  ctx.save();
  ctx.strokeStyle = '#d946ef'; // Magenta
  ctx.lineWidth = 1 / camera.zoom;

  for (const guide of guides) {
    ctx.beginPath();
    if (guide.orientation === 'vertical') {
      ctx.moveTo(guide.position, guide.start);
      ctx.lineTo(guide.position, guide.end);
    } else {
      ctx.moveTo(guide.start, guide.position);
      ctx.lineTo(guide.end, guide.position);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawRemoteDragPreviews(
  ctx: CanvasRenderingContext2D,
  remoteDragPreviews: Record<string, { clientId: string; changes: Record<string, unknown>; lastSeen: number }>,
  objects: Record<string, Obj>,
  presenceUsers: PresenceUser[],
  camera: Camera,
  now = Date.now(),
): void {
  const userMap = new Map(presenceUsers.map((u) => [u.clientId, u]));

  for (const [objId, preview] of Object.entries(remoteDragPreviews)) {
    if (now - preview.lastSeen > 3000) continue;
    const obj = objects[objId];
    if (!obj || obj.deleted) continue;

    const user = userMap.get(preview.clientId);
    const color = user?.color || '#0d99ff';
    const name = user?.name || 'Collaborator';

    const tempObj: Obj = {
      ...obj,
      props: { ...obj.props, ...preview.changes },
    };
    const bounds = getBounds(tempObj);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

    // Label on top
    const label = `${name} is moving`;
    ctx.font = `600 ${10 / camera.zoom}px Inter, system-ui, sans-serif`;
    const metrics = ctx.measureText(label);
    const pillW = metrics.width + 10 / camera.zoom;
    const pillH = 16 / camera.zoom;
    const pillX = bounds.x;
    const pillY = Math.max(0, bounds.y - pillH - 4 / camera.zoom);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 4 / camera.zoom);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + 5 / camera.zoom, pillY + pillH / 2);
    ctx.restore();
  }
}

export function drawRemoteCursors(
  ctx: CanvasRenderingContext2D,
  remoteCursors: Record<string, { x: number; y: number; lastSeen: number }>,
  presenceUsers: PresenceUser[],
  camera: Camera,
  now = Date.now(),
): void {
  const userMap = new Map(presenceUsers.map((u) => [u.clientId, u]));

  for (const [clientId, cursor] of Object.entries(remoteCursors)) {
    const age = now - cursor.lastSeen;
    if (age > 10000) continue; // Inactive after 10s

    const user = userMap.get(clientId);
    const color = user?.color || '#0d99ff';
    const name = user?.name || 'Anonymous';

    // Fade if aging between 6s and 10s
    let alpha = 1;
    if (age > 6000) {
      alpha = Math.max(0, 1 - (age - 6000) / 4000);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    const z = camera.zoom;
    const cx = cursor.x;
    const cy = cursor.y;

    // Draw cursor arrow
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / z;
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 4 / z;
    ctx.shadowOffsetY = 1 / z;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 16 / z);
    ctx.lineTo(cx + 4.5 / z, cy + 12 / z);
    ctx.lineTo(cx + 9 / z, cy + 20 / z);
    ctx.lineTo(cx + 12.5 / z, cy + 18 / z);
    ctx.lineTo(cx + 8 / z, cy + 10.5 / z);
    ctx.lineTo(cx + 14 / z, cy + 10.5 / z);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Draw name badge pill next to cursor
    ctx.font = `600 ${11 / z}px Inter, system-ui, sans-serif`;
    const textMetrics = ctx.measureText(name);
    const badgeW = textMetrics.width + 12 / z;
    const badgeH = 18 / z;
    const badgeX = cx + 12 / z;
    const badgeY = cy + 14 / z;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4 / z);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, badgeX + 6 / z, badgeY + badgeH / 2);

    ctx.restore();
  }
}

