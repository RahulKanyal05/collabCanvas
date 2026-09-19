import { CanvasObject } from '@collab/protocol';
import { CursorInfo } from '../sync/client-sync.js';
import { getObjectBoundingBox } from './geometry.js';

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  objects: CanvasObject[],
  selectedObjectId: string | null,
  cursors: Map<string, CursorInfo>
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Clear background
  ctx.fillStyle = '#0f172a'; // Deep slate dark mode
  ctx.fillRect(0, 0, width, height);

  // 2. Render subtle grid dots
  ctx.fillStyle = '#1e293b';
  const gridSize = 32;
  for (let x = gridSize; x < width; x += gridSize) {
    for (let y = gridSize; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Render Objects
  for (const obj of objects) {
    if (obj.deleted) continue;

    ctx.save();
    ctx.strokeStyle = obj.color;
    ctx.fillStyle = obj.color;
    ctx.lineWidth = obj.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (obj.type) {
      case 'stroke': {
        if (obj.points && obj.points.length > 0) {
          ctx.beginPath();
          if (obj.points.length === 1) {
            ctx.arc(obj.points[0].x, obj.points[0].y, obj.strokeWidth / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.moveTo(obj.points[0].x, obj.points[0].y);
            for (let i = 1; i < obj.points.length; i++) {
              ctx.lineTo(obj.points[i].x, obj.points[i].y);
            }
            ctx.stroke();
          }
        }
        break;
      }

      case 'rect': {
        const left = Math.min(obj.x, obj.x + obj.width);
        const top = Math.min(obj.y, obj.y + obj.height);
        const w = Math.abs(obj.width);
        const h = Math.abs(obj.height);
        ctx.beginPath();
        ctx.strokeRect(left, top, w, h);
        break;
      }

      case 'ellipse': {
        const cx = obj.x + obj.width / 2;
        const cy = obj.y + obj.height / 2;
        const rx = Math.max(Math.abs(obj.width / 2), 1);
        const ry = Math.max(Math.abs(obj.height / 2), 1);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // 4. Render selection outline
  if (selectedObjectId) {
    const selectedObj = objects.find((o) => o.id === selectedObjectId && !o.deleted);
    if (selectedObj) {
      const bbox = getObjectBoundingBox(selectedObj);
      ctx.save();
      ctx.strokeStyle = '#38bdf8'; // Sky blue dashed outline
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);

      // Draw corner handles
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.setLineDash([]);
      const handleSize = 6;
      const corners = [
        { x: bbox.minX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.minY },
        { x: bbox.minX, y: bbox.maxY },
        { x: bbox.maxX, y: bbox.maxY },
      ];
      for (const pt of corners) {
        ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
      }
      ctx.restore();
    }
  }

  // 5. Render Remote Cursors
  const now = Date.now();
  for (const cursor of cursors.values()) {
    // Fade out cursors inactive for > 15s
    if (now - cursor.lastSeen > 15000) continue;

    ctx.save();
    ctx.translate(cursor.x, cursor.y);

    // Cursor pointer
    ctx.fillStyle = cursor.color;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12.5);
    ctx.lineTo(8.5, 20);
    ctx.lineTo(11, 18.5);
    ctx.lineTo(7, 11);
    ctx.lineTo(13, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cursor Name Pill
    ctx.font = '500 11px Inter, sans-serif';
    const textWidth = ctx.measureText(cursor.name).width;
    const pillHeight = 18;
    const pillWidth = textWidth + 12;
    const pillX = 14;
    const pillY = 12;

    ctx.fillStyle = cursor.color;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(cursor.name, pillX + 6, pillY + 13);

    ctx.restore();
  }

  ctx.restore();
}
