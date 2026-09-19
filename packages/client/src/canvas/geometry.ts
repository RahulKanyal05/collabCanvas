import { CanvasObject, Point } from '@collab/protocol';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getObjectBoundingBox(obj: CanvasObject): BoundingBox {
  if (obj.type === 'stroke' && obj.points && obj.points.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of obj.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    const padding = Math.max(obj.strokeWidth, 8);
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }

  // Rect or Ellipse
  const left = Math.min(obj.x, obj.x + obj.width);
  const top = Math.min(obj.y, obj.y + obj.height);
  const right = Math.max(obj.x, obj.x + obj.width);
  const bottom = Math.max(obj.y, obj.y + obj.height);
  const pad = Math.max(obj.strokeWidth, 6);

  return {
    minX: left - pad,
    minY: top - pad,
    maxX: right + pad,
    maxY: bottom + pad,
  };
}

function distToSegment(p: Point, v: Point, w: Point): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

/**
 * Tests if point (px, py) hits a canvas object.
 */
export function hitTestObject(obj: CanvasObject, px: number, py: number): boolean {
  if (obj.deleted) return false;

  const bbox = getObjectBoundingBox(obj);
  if (px < bbox.minX || px > bbox.maxX || py < bbox.minY || py > bbox.maxY) {
    return false;
  }

  if (obj.type === 'stroke' && obj.points) {
    const threshold = Math.max(obj.strokeWidth + 4, 8);
    for (let i = 0; i < obj.points.length - 1; i++) {
      const d = distToSegment({ x: px, y: py }, obj.points[i], obj.points[i + 1]);
      if (d <= threshold) return true;
    }
    return false;
  }

  if (obj.type === 'rect') {
    const left = Math.min(obj.x, obj.x + obj.width);
    const top = Math.min(obj.y, obj.y + obj.height);
    const right = Math.max(obj.x, obj.x + obj.width);
    const bottom = Math.max(obj.y, obj.y + obj.height);
    const pad = 6;
    return px >= left - pad && px <= right + pad && py >= top - pad && py <= bottom + pad;
  }

  if (obj.type === 'ellipse') {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const rx = Math.max(Math.abs(obj.width / 2), 4);
    const ry = Math.max(Math.abs(obj.height / 2), 4);
    const norm = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2);
    return norm <= 1.2; // slight tolerance
  }

  return false;
}

/**
 * Finds the topmost object at coordinates (px, py).
 */
export function findTopmostHit(objects: CanvasObject[], px: number, py: number): CanvasObject | null {
  // Check in reverse order (topmost rendered last)
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitTestObject(objects[i], px, py)) {
      return objects[i];
    }
  }
  return null;
}
