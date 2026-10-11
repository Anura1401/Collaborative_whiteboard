import { getBounds, type Obj, type Point, type RectBounds } from '@whiteboard/shared';

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number; // world coordinate
  start: number;
  end: number;
}

export interface SnapResult {
  deltaX: number;
  deltaY: number;
  guides: SnapGuide[];
}

export function computeSnapping(
  movingBounds: RectBounds,
  otherObjects: Obj[],
  zoom: number,
  thresholdScreenPx = 6,
): SnapResult {
  const thresholdWorld = thresholdScreenPx / zoom;
  let bestDeltaX = 0;
  let bestDeltaY = 0;
  let minDiffX = thresholdWorld;
  let minDiffY = thresholdWorld;

  const guides: SnapGuide[] = [];

  const mLeft = movingBounds.x;
  const mCenterX = movingBounds.x + movingBounds.width / 2;
  const mRight = movingBounds.x + movingBounds.width;

  const mTop = movingBounds.y;
  const mCenterY = movingBounds.y + movingBounds.height / 2;
  const mBottom = movingBounds.y + movingBounds.height;

  for (const other of otherObjects) {
    if (other.deleted) continue;
    const b = getBounds(other);

    const oLeft = b.x;
    const oCenterX = b.x + b.width / 2;
    const oRight = b.x + b.width;

    const oTop = b.y;
    const oCenterY = b.y + b.height / 2;
    const oBottom = b.y + b.height;

    // Vertical snaps (X alignments)
    const xAlignments = [
      { m: mLeft, o: oLeft, diff: oLeft - mLeft },
      { m: mLeft, o: oRight, diff: oRight - mLeft },
      { m: mCenterX, o: oCenterX, diff: oCenterX - mCenterX },
      { m: mRight, o: oLeft, diff: oLeft - mRight },
      { m: mRight, o: oRight, diff: oRight - mRight },
    ];

    for (const align of xAlignments) {
      const absDiff = Math.abs(align.diff);
      if (absDiff < minDiffX) {
        minDiffX = absDiff;
        bestDeltaX = align.diff;
      }
    }

    // Horizontal snaps (Y alignments)
    const yAlignments = [
      { m: mTop, o: oTop, diff: oTop - mTop },
      { m: mTop, o: oBottom, diff: oBottom - mTop },
      { m: mCenterY, o: oCenterY, diff: oCenterY - mCenterY },
      { m: mBottom, o: oTop, diff: oTop - mBottom },
      { m: mBottom, o: oBottom, diff: oBottom - mBottom },
    ];

    for (const align of yAlignments) {
      const absDiff = Math.abs(align.diff);
      if (absDiff < minDiffY) {
        minDiffY = absDiff;
        bestDeltaY = align.diff;
      }
    }
  }

  // If snapped X, build guide line
  if (bestDeltaX !== 0) {
    const snappedX = mCenterX + bestDeltaX;
    guides.push({
      orientation: 'vertical',
      position: snappedX,
      start: mTop - 200,
      end: mBottom + 200,
    });
  }

  // If snapped Y, build guide line
  if (bestDeltaY !== 0) {
    const snappedY = mCenterY + bestDeltaY;
    guides.push({
      orientation: 'horizontal',
      position: snappedY,
      start: mLeft - 200,
      end: mRight + 200,
    });
  }

  return {
    deltaX: bestDeltaX,
    deltaY: bestDeltaY,
    guides,
  };
}

export function constrainTo45Degrees(start: Point, current: Point): Point {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.hypot(dx, dy);

  return {
    x: start.x + dist * Math.cos(snapAngle),
    y: start.y + dist * Math.sin(snapAngle),
  };
}
