import { CanvasObject, Point } from '@collab/protocol';
import { CursorInfo } from '../sync/client-sync.js';
import { getObjectBoundingBox, getResizeHandles } from './geometry.js';

export function renderCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  objects: CanvasObject[],
  selectedObjectId: string | null,
  cursors: Map<string, CursorInfo>,
  pan: Point = { x: 0, y: 0 },
  zoom = 1
): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Clear Screen
  ctx.fillStyle = '#0b0f19'; // Modern deep dark background
  ctx.fillRect(0, 0, width, height);

  // 2. Render Infinite Dynamic Dot Grid
  if (zoom >= 0.2) {
    const baseGridSize = 32;
    const worldLeft = -pan.x / zoom;
    const worldTop = -pan.y / zoom;
    const worldRight = (width - pan.x) / zoom;
    const worldBottom = (height - pan.y) / zoom;

    const startX = Math.floor(worldLeft / baseGridSize) * baseGridSize;
    const endX = Math.ceil(worldRight / baseGridSize) * baseGridSize;
    const startY = Math.floor(worldTop / baseGridSize) * baseGridSize;
    const endY = Math.ceil(worldBottom / baseGridSize) * baseGridSize;

    ctx.save();
    ctx.fillStyle = zoom > 0.5 ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)';
    const dotRadius = Math.max(1, Math.min(1.8 * zoom, 2.5));

    for (let wx = startX; wx <= endX; wx += baseGridSize) {
      const sx = wx * zoom + pan.x;
      for (let wy = startY; wy <= endY; wy += baseGridSize) {
        const sy = wy * zoom + pan.y;
        ctx.beginPath();
        ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 3. Apply World Transformation (Pan & Zoom)
  ctx.save();
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

  // 4. Render All World Objects
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
        if (obj.fillColor) {
          ctx.fillStyle = obj.fillColor;
          ctx.fillRect(left, top, w, h);
        }
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
        if (obj.fillColor) {
          ctx.fillStyle = obj.fillColor;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }

      case 'line': {
        ctx.beginPath();
        ctx.moveTo(obj.x, obj.y);
        ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
        ctx.stroke();
        break;
      }

      case 'arrow': {
        const startX = obj.x;
        const startY = obj.y;
        const endX = obj.x + obj.width;
        const endY = obj.y + obj.height;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Draw Arrowhead
        const angle = Math.atan2(endY - startY, endX - startX);
        const arrowLength = Math.max(obj.strokeWidth * 4, 14);
        const arrowAngle = Math.PI / 6;

        ctx.fillStyle = obj.color;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowLength * Math.cos(angle - arrowAngle),
          endY - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.lineTo(
          endX - arrowLength * Math.cos(angle + arrowAngle),
          endY - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'sticky': {
        const left = Math.min(obj.x, obj.x + obj.width);
        const top = Math.min(obj.y, obj.y + obj.height);
        const w = Math.abs(obj.width);
        const h = Math.abs(obj.height);
        const radius = 8;
        const noteBg = obj.fillColor || '#fef08a'; // default warm yellow

        // Card Drop Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 6;

        // Card Body
        ctx.fillStyle = noteBg;
        ctx.beginPath();
        ctx.roundRect(left, top, w, h, radius);
        ctx.fill();

        // Reset Shadow for stroke & content
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Little corner fold accent
        ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.beginPath();
        ctx.moveTo(left + w - 16, top);
        ctx.lineTo(left + w, top + 16);
        ctx.lineTo(left + w - 16, top + 16);
        ctx.closePath();
        ctx.fill();

        // Text Content
        if (obj.text) {
          ctx.fillStyle = '#1e293b'; // Charcoal text
          const fontSize = obj.fontSize || 14;
          ctx.font = `500 ${fontSize}px 'Inter', sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';

          const padding = 12;
          const maxWidth = Math.max(w - padding * 2, 20);
          const words = obj.text.split(' ');
          let line = '';
          let lineY = top + padding;
          const lineHeight = fontSize * 1.35;

          for (const word of words) {
            const testLine = line + word + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
              ctx.fillText(line, left + padding, lineY);
              line = word + ' ';
              lineY += lineHeight;
              if (lineY + lineHeight > top + h - padding) break;
            } else {
              line = testLine;
            }
          }
          if (line) {
            ctx.fillText(line, left + padding, lineY);
          }
        }
        break;
      }

      case 'text': {
        const fontSize = obj.fontSize || 20;
        ctx.font = `600 ${fontSize}px 'Outfit', 'Inter', sans-serif`;
        ctx.fillStyle = obj.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lines = (obj.text || 'Text').split('\n');
        const lineHeight = fontSize * 1.25;
        lines.forEach((l, i) => {
          ctx.fillText(l, obj.x, obj.y + i * lineHeight);
        });
        break;
      }
    }
    ctx.restore();
  }

  // 5. Render Selection Box & 8 Resize Handles
  if (selectedObjectId) {
    const selectedObj = objects.find((o) => o.id === selectedObjectId && !o.deleted);
    if (selectedObj) {
      const bbox = getObjectBoundingBox(selectedObj);
      ctx.save();

      // Dashed boundary
      ctx.strokeStyle = '#38bdf8'; // Sky blue
      ctx.lineWidth = Math.max(1 / zoom, 1.5);
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.strokeRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);

      // Handles
      const handles = getResizeHandles(bbox);
      const handleSize = Math.max(6 / zoom, 5);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = Math.max(1.5 / zoom, 1.5);

      for (const h of handles) {
        ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
      }

      ctx.restore();
    }
  }

  // 6. Render Remote Cursors in World Space
  const now = Date.now();
  for (const cursor of cursors.values()) {
    if (now - cursor.lastSeen > 15000) continue;

    ctx.save();
    ctx.translate(cursor.x, cursor.y);
    const cursorScale = Math.max(0.7, Math.min(1.2 / zoom, 1.5));
    ctx.scale(cursorScale, cursorScale);

    // Pointer
    ctx.fillStyle = cursor.color;
    ctx.strokeStyle = '#0b0f19';
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

    // Name Pill
    ctx.font = '600 11px Inter, sans-serif';
    const textWidth = ctx.measureText(cursor.name).width;
    const pillHeight = 18;
    const pillWidth = textWidth + 14;
    const pillX = 14;
    const pillY = 12;

    ctx.fillStyle = cursor.color;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(cursor.name, pillX + 7, pillY + 13);

    ctx.restore();
  }

  ctx.restore(); // Restore world transform
  ctx.restore(); // Restore dpr scale
}
