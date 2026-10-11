import { MAX_SIZE, MIN_SIZE, MIN_TEXT_WIDTH } from './limits.js';
import type { HandleType, Obj, Point, RectBounds } from './types.js';

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  // Projection scalar t on line segment [a, b]
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}

export function simplifyPoints(points: number[], epsilon: number): number[] {
  if (points.length <= 4) {
    return [...points];
  }

  const numPoints = points.length / 2;
  const keep = new Uint8Array(numPoints);
  keep[0] = 1;
  keep[numPoints - 1] = 1;

  function rdp(startIndex: number, endIndex: number) {
    if (endIndex <= startIndex + 1) return;

    const ax = points[startIndex * 2]!;
    const ay = points[startIndex * 2 + 1]!;
    const bx = points[endIndex * 2]!;
    const by = points[endIndex * 2 + 1]!;

    let maxDist = 0;
    let maxIdx = startIndex;

    for (let i = startIndex + 1; i < endIndex; i++) {
      const px = points[i * 2]!;
      const py = points[i * 2 + 1]!;
      const dist = distanceToSegment({ x: px, y: py }, { x: ax, y: ay }, { x: bx, y: by });
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      rdp(startIndex, maxIdx);
      rdp(maxIdx, endIndex);
    }
  }

  rdp(0, numPoints - 1);

  const result: number[] = [];
  for (let i = 0; i < numPoints; i++) {
    if (keep[i]) {
      result.push(points[i * 2]!, points[i * 2 + 1]!);
    }
  }

  // Ensure at least 2 points (4 numbers) are kept
  if (result.length < 4 && points.length >= 4) {
    return [points[0]!, points[1]!, points[points.length - 2]!, points[points.length - 1]!];
  }

  return result;
}

export function getBounds(obj: Obj): RectBounds {
  const p = obj.props;
  switch (obj.type) {
    case 'rect':
    case 'ellipse': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const width = Number(p['width'] ?? 0);
      const height = Number(p['height'] ?? 0);
      return { x, y, width, height };
    }

    case 'line': {
      const x1 = Number(p['x1'] ?? 0);
      const y1 = Number(p['y1'] ?? 0);
      const x2 = Number(p['x2'] ?? 0);
      const y2 = Number(p['y2'] ?? 0);
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      return { x: minX, y: minY, width, height };
    }

    case 'stroke': {
      const originX = Number(p['x'] ?? 0);
      const originY = Number(p['y'] ?? 0);
      const pts = (p['points'] as number[]) ?? [];
      if (pts.length === 0) {
        return { x: originX, y: originY, width: 0, height: 0 };
      }

      let minX = pts[0]!;
      let maxX = pts[0]!;
      let minY = pts[1]!;
      let maxY = pts[1]!;

      for (let i = 0; i < pts.length; i += 2) {
        const px = pts[i]!;
        const py = pts[i + 1]!;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }

      return {
        x: originX + minX,
        y: originY + minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    case 'text': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const width = Number(p['width'] ?? MIN_TEXT_WIDTH);
      const fontSize = Number(p['fontSize'] ?? 16);
      const text = String(p['text'] ?? '');
      // Fallback rough height calculation: at least 1 line (fontSize * 1.25)
      const linesCount = Math.max(1, text.split('\n').length);
      const height = Math.max(fontSize * 1.25 * linesCount, fontSize * 1.25);
      return { x, y, width, height };
    }

    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function getHandles(obj: Obj): Partial<Record<HandleType, Point>> {
  const p = obj.props;
  if (obj.type === 'line') {
    return {
      start: { x: Number(p['x1'] ?? 0), y: Number(p['y1'] ?? 0) },
      end: { x: Number(p['x2'] ?? 0), y: Number(p['y2'] ?? 0) },
    };
  }

  const bounds = getBounds(obj);
  const { x, y, width, height } = bounds;

  if (obj.type === 'text') {
    // Text only resizes horizontally via e and w handles
    return {
      w: { x, y: y + height / 2 },
      e: { x: x + width, y: y + height / 2 },
    };
  }

  if (obj.type === 'stroke') {
    return {};
  }

  // Rect and Ellipse: 8 handles
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

export function resizeFromHandle(
  obj: Obj,
  handle: HandleType,
  delta: Point,
  lockAspect = false,
): Record<string, unknown> {
  const p = obj.props;

  if (obj.type === 'line') {
    if (handle === 'start') {
      return {
        x1: Number(p['x1'] ?? 0) + delta.x,
        y1: Number(p['y1'] ?? 0) + delta.y,
      };
    }
    if (handle === 'end') {
      return {
        x2: Number(p['x2'] ?? 0) + delta.x,
        y2: Number(p['y2'] ?? 0) + delta.y,
      };
    }
    return {};
  }

  const origX = Number(p['x'] ?? 0);
  const origY = Number(p['y'] ?? 0);
  const origW = Number(p['width'] ?? MIN_SIZE);
  const origH = Number(p['height'] ?? MIN_SIZE);

  let newX = origX;
  let newY = origY;
  let newW = origW;
  let newH = origH;

  const minW = obj.type === 'text' ? MIN_TEXT_WIDTH : MIN_SIZE;
  const minH = MIN_SIZE;

  // Compute unconstrained resize
  switch (handle) {
    case 'e':
      newW = origW + delta.x;
      break;
    case 'w':
      newW = origW - delta.x;
      newX = origX + delta.x;
      break;
    case 's':
      newH = origH + delta.y;
      break;
    case 'n':
      newH = origH - delta.y;
      newY = origY + delta.y;
      break;
    case 'se':
      newW = origW + delta.x;
      newH = origH + delta.y;
      break;
    case 'sw':
      newW = origW - delta.x;
      newX = origX + delta.x;
      newH = origH + delta.y;
      break;
    case 'ne':
      newW = origW + delta.x;
      newH = origH - delta.y;
      newY = origY + delta.y;
      break;
    case 'nw':
      newW = origW - delta.x;
      newX = origX + delta.x;
      newH = origH - delta.y;
      newY = origY + delta.y;
      break;
    default:
      break;
  }

  // Aspect ratio lock (for rect and ellipse)
  if (lockAspect && origW > 0 && origH > 0 && obj.type !== 'text') {
    const ratio = origW / origH;
    if (handle === 'e' || handle === 'w') {
      newH = newW / ratio;
    } else if (handle === 'n' || handle === 's') {
      newW = newH * ratio;
    } else {
      const scale = Math.max(Math.abs(newW / origW), Math.abs(newH / origH));
      newW = origW * scale;
      newH = origH * scale;
      if (handle === 'nw') {
        newX = origX + origW - newW;
        newY = origY + origH - newH;
      } else if (handle === 'ne') {
        newY = origY + origH - newH;
      } else if (handle === 'sw') {
        newX = origX + origW - newW;
      }
    }
  }

  // Prevent flipping and enforce bounds
  if (newW < minW) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      newX = origX + origW - minW;
    }
    newW = minW;
  }
  if (newH < minH) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      newY = origY + origH - minH;
    }
    newH = minH;
  }

  newW = Math.min(newW, MAX_SIZE);
  newH = Math.min(newH, MAX_SIZE);

  if (obj.type === 'text') {
    return { x: newX, width: newW };
  }

  return {
    x: newX,
    y: newY,
    width: newW,
    height: newH,
  };
}

export function hitTest(obj: Obj, point: Point, tolerance: number): boolean {
  const p = obj.props;
  const strokeWidth = Number(p['strokeWidth'] ?? 1);
  const effectiveTol = Math.max(tolerance, strokeWidth / 2);

  switch (obj.type) {
    case 'rect': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const w = Number(p['width'] ?? 0);
      const h = Number(p['height'] ?? 0);
      const fill = String(p['fill'] ?? 'none');

      const insideOuter =
        point.x >= x - effectiveTol &&
        point.x <= x + w + effectiveTol &&
        point.y >= y - effectiveTol &&
        point.y <= y + h + effectiveTol;

      if (!insideOuter) return false;

      if (fill !== 'none') {
        return true;
      }

      // If fill is 'none', only test near the border
      const insideInner =
        point.x > x + effectiveTol &&
        point.x < x + w - effectiveTol &&
        point.y > y + effectiveTol &&
        point.y < y + h - effectiveTol;

      return !insideInner;
    }

    case 'ellipse': {
      const x = Number(p['x'] ?? 0);
      const y = Number(p['y'] ?? 0);
      const w = Number(p['width'] ?? 0);
      const h = Number(p['height'] ?? 0);
      const fill = String(p['fill'] ?? 'none');

      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;

      if (rx <= 0 || ry <= 0) return false;

      const normDist =
        Math.pow(point.x - cx, 2) / Math.pow(rx + effectiveTol, 2) +
        Math.pow(point.y - cy, 2) / Math.pow(ry + effectiveTol, 2);

      if (normDist > 1) return false;

      if (fill !== 'none') return true;

      // Hollow ellipse: test outer vs inner
      const innerRx = Math.max(0.1, rx - effectiveTol);
      const innerRy = Math.max(0.1, ry - effectiveTol);
      const innerNormDist =
        Math.pow(point.x - cx, 2) / Math.pow(innerRx, 2) +
        Math.pow(point.y - cy, 2) / Math.pow(innerRy, 2);

      return innerNormDist >= 1;
    }

    case 'line': {
      const x1 = Number(p['x1'] ?? 0);
      const y1 = Number(p['y1'] ?? 0);
      const x2 = Number(p['x2'] ?? 0);
      const y2 = Number(p['y2'] ?? 0);

      const dist = distanceToSegment(point, { x: x1, y: y1 }, { x: x2, y: y2 });
      return dist <= effectiveTol;
    }

    case 'stroke': {
      const originX = Number(p['x'] ?? 0);
      const originY = Number(p['y'] ?? 0);
      const pts = (p['points'] as number[]) ?? [];
      if (pts.length < 4) return false;

      for (let i = 0; i < pts.length - 2; i += 2) {
        const a: Point = { x: originX + pts[i]!, y: originY + pts[i + 1]! };
        const b: Point = { x: originX + pts[i + 2]!, y: originY + pts[i + 3]! };
        if (distanceToSegment(point, a, b) <= effectiveTol) {
          return true;
        }
      }
      return false;
    }

    case 'text': {
      const bounds = getBounds(obj);
      return (
        point.x >= bounds.x - effectiveTol &&
        point.x <= bounds.x + bounds.width + effectiveTol &&
        point.y >= bounds.y - effectiveTol &&
        point.y <= bounds.y + bounds.height + effectiveTol
      );
    }

    default:
      return false;
  }
}
