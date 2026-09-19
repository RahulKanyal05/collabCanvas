import React, { useEffect, useRef, useState } from 'react';
import { ulid } from 'ulid';
import { BoardState, CanvasObject, Point } from '@collab/protocol';
import { ClientSyncEngine, CursorInfo } from '../sync/client-sync.js';
import { ToolType } from './Toolbar.js';
import { renderCanvas } from '../canvas/renderer.js';
import { findTopmostHit } from '../canvas/geometry.js';

interface CanvasProps {
  syncEngine: ClientSyncEngine;
  tool: ToolType;
  color: string;
  strokeWidth: number;
}

export const Canvas: React.FC<CanvasProps> = ({ syncEngine, tool, color, strokeWidth }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Synced state
  const [boardState, setBoardState] = useState<BoardState>(syncEngine.getViewState());
  const [cursors, setCursors] = useState<Map<string, CursorInfo>>(new Map());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  // Pointer dragging state
  const isPointerDownRef = useRef(false);
  const activeObjectIdRef = useRef<string | null>(null);
  const startPosRef = useRef<Point>({ x: 0, y: 0 });
  const initialObjPosRef = useRef<Point>({ x: 0, y: 0 });

  // Stroke point batching (~25ms interval)
  const batchedPointsRef = useRef<Point[]>([]);
  const batchTimerRef = useRef<any>(null);

  // Subscribe to sync engine updates
  useEffect(() => {
    const unsubState = syncEngine.subscribeState((newState) => {
      setBoardState(newState);
    });
    const unsubCursors = syncEngine.subscribeCursors((newCursors) => {
      setCursors(newCursors);
    });

    return () => {
      unsubState();
      unsubCursors();
    };
  }, [syncEngine]);

  // Canvas rendering loop via requestAnimationFrame
  useEffect(() => {
    let animationFrameId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      const objectsList = Object.values(boardState.objects);
      renderCanvas(ctx, width, height, dpr, objectsList, selectedObjectId, cursors);

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [boardState, cursors, selectedObjectId]);

  const flushBatchedPoints = () => {
    const objectId = activeObjectIdRef.current;
    const points = batchedPointsRef.current;
    if (objectId && points.length > 0 && syncEngine.clientId) {
      syncEngine.submitOp({
        type: 'append_points',
        clientOpId: ulid(),
        objectId,
        owner: syncEngine.clientId,
        points: [...points],
      });
      batchedPointsRef.current = [];
    }
  };

  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    isPointerDownRef.current = true;
    startPosRef.current = coords;

    const objectsList = Object.values(boardState.objects);

    if (tool === 'move') {
      const hit = findTopmostHit(objectsList, coords.x, coords.y);
      if (hit) {
        setSelectedObjectId(hit.id);
        activeObjectIdRef.current = hit.id;
        initialObjPosRef.current = { x: hit.x, y: hit.y };
      } else {
        setSelectedObjectId(null);
        activeObjectIdRef.current = null;
      }
    } else if (tool === 'eraser') {
      const hit = findTopmostHit(objectsList, coords.x, coords.y);
      if (hit) {
        syncEngine.submitOp({
          type: 'delete',
          clientOpId: ulid(),
          objectId: hit.id,
        });
      }
    } else if (tool === 'stroke') {
      const id = ulid();
      activeObjectIdRef.current = id;
      batchedPointsRef.current = [];

      const initialStroke: CanvasObject = {
        id,
        type: 'stroke',
        owner: syncEngine.clientId || 'anonymous',
        x: coords.x,
        y: coords.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        points: [coords],
        deleted: false,
        fieldSeqs: {},
      };

      syncEngine.submitOp({
        type: 'create',
        clientOpId: ulid(),
        object: initialStroke,
      });

      // Start batch interval
      batchTimerRef.current = setInterval(flushBatchedPoints, 25);
    } else if (tool === 'rect' || tool === 'ellipse') {
      const id = ulid();
      activeObjectIdRef.current = id;

      const initialShape: CanvasObject = {
        id,
        type: tool,
        owner: syncEngine.clientId || 'anonymous',
        x: coords.x,
        y: coords.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        deleted: false,
        fieldSeqs: {},
      };

      syncEngine.submitOp({
        type: 'create',
        clientOpId: ulid(),
        object: initialShape,
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    // Broadcast cursor throttled
    syncEngine.sendCursor(coords.x, coords.y);

    if (!isPointerDownRef.current) return;

    if (tool === 'stroke') {
      batchedPointsRef.current.push(coords);
    } else if (tool === 'rect' || tool === 'ellipse') {
      const id = activeObjectIdRef.current;
      if (id) {
        const width = coords.x - startPosRef.current.x;
        const height = coords.y - startPosRef.current.y;
        syncEngine.submitOp({
          type: 'update',
          clientOpId: ulid(),
          objectId: id,
          patch: { width, height },
        });
      }
    } else if (tool === 'move') {
      const id = activeObjectIdRef.current;
      if (id) {
        const dx = coords.x - startPosRef.current.x;
        const dy = coords.y - startPosRef.current.y;
        syncEngine.submitOp({
          type: 'update',
          clientOpId: ulid(),
          objectId: id,
          patch: {
            x: initialObjPosRef.current.x + dx,
            y: initialObjPosRef.current.y + dy,
          },
        });
      }
    } else if (tool === 'eraser') {
      const objectsList = Object.values(boardState.objects);
      const hit = findTopmostHit(objectsList, coords.x, coords.y);
      if (hit) {
        syncEngine.submitOp({
          type: 'delete',
          clientOpId: ulid(),
          objectId: hit.id,
        });
      }
    }
  };

  const handlePointerUp = () => {
    if (batchTimerRef.current) {
      clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    flushBatchedPoints();

    isPointerDownRef.current = false;
    if (tool !== 'move') {
      activeObjectIdRef.current = null;
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={`canvas-viewport tool-${tool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
};
