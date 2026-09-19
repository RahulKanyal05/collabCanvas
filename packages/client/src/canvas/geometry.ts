import { CanvasObject, Point } from '@collab/protocol';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ResizeHandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeHandle {
  type: ResizeHandleType;
  x: number;
  y: number;
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

  // Rect, Ellipse, Sticky, Text, Arrow, Line
  const left = Math.min(obj.x, obj.x + obj.width);
  const top = Math.min(obj.y, obj.y + obj.height);
  const right = Math.max(obj.x, obj.x + obj.width);
  const bottom = Math.max(obj.y, obj.y + obj.height);
  const pad = Math.max(obj.strokeWidth || 2, 6);

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
 * Tests if point (px, py) in world coordinates hits a canvas object.
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

  if (obj.type === 'rect' || obj.type === 'sticky' || obj.type === 'text') {
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
    return norm <= 1.25;
  }

  if (obj.type === 'arrow' || obj.type === 'line') {
    const start = { x: obj.x, y: obj.y };
    const end = { x: obj.x + obj.width, y: obj.y + obj.height };
    const threshold = Math.max(obj.strokeWidth + 6, 10);
    return distToSegment({ x: px, y: py }, start, end) <= threshold;
  }

  return false;
}

/**
 * Finds the topmost object at coordinates (px, py).
 */
export function findTopmostHit(objects: CanvasObject[], px: number, py: number): CanvasObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitTestObject(objects[i], px, py)) {
      return objects[i];
    }
  }
  return null;
}

/**
 * Calculates 8 resize handles for a bounding box.
 */
export function getResizeHandles(bbox: BoundingBox): ResizeHandle[] {
  const midX = (bbox.minX + bbox.maxX) / 2;
  const midY = (bbox.minY + bbox.maxY) / 2;

  return [
    { type: 'nw', x: bbox.minX, y: bbox.minY },
    { type: 'n', x: midX, y: bbox.minY },
    { type: 'ne', x: bbox.maxX, y: bbox.minY },
    { type: 'e', x: bbox.maxX, y: midY },
    { type: 'se', x: bbox.maxX, y: bbox.maxY },
    { type: 's', x: midX, y: bbox.maxY },
    { type: 'sw', x: bbox.minX, y: bbox.maxY },
    { type: 'w', x: bbox.minX, y: midY },
  ];
}

/**
 * Tests if point (px, py) hits any resize handle of the selected bounding box.
 */
export function hitTestResizeHandles(
  bbox: BoundingBox,
  px: number,
  py: number,
  tolerance = 8
): ResizeHandleType | null {
  const handles = getResizeHandles(bbox);
  for (const h of handles) {
    if (Math.hypot(px - h.x, py - h.y) <= tolerance) {
      return h.type;
    }
  }
  return null;
}
