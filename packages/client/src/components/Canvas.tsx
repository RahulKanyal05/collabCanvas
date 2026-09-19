import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ulid } from 'ulid';
import { BoardState, CanvasObject, Point } from '@collab/protocol';
import { ClientSyncEngine, CursorInfo } from '../sync/client-sync.js';
import { ToolType } from './Toolbar.js';
import { renderCanvas } from '../canvas/renderer.js';
import {
  findTopmostHit,
  getObjectBoundingBox,
  hitTestResizeHandles,
  ResizeHandleType,
} from '../canvas/geometry.js';

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

  // Viewport State (Pan & Zoom)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const isSpacePressedRef = useRef(false);

  // Inline editing state for sticky notes & text
  const [editingObject, setEditingObject] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    isSticky: boolean;
  } | null>(null);

  // Interaction refs
  const isPointerDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const activeObjectIdRef = useRef<string | null>(null);
  const activeHandleRef = useRef<ResizeHandleType | null>(null);
  const startScreenPosRef = useRef<Point>({ x: 0, y: 0 });
  const startWorldPosRef = useRef<Point>({ x: 0, y: 0 });
  const initialObjBoxRef = useRef<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  // Stroke point batching (~25ms)
  const batchedPointsRef = useRef<Point[]>([]);
  const batchTimerRef = useRef<any>(null);

  // Subscriptions
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

  // Coordinate transforms
  const screenToWorld = useCallback(
    (sx: number, sy: number): Point => ({
      x: Math.round((sx - pan.x) / zoom),
      y: Math.round((sy - pan.y) / zoom),
    }),
    [pan, zoom]
  );

  const worldToScreen = useCallback(
    (wx: number, wy: number): Point => ({
      x: Math.round(wx * zoom + pan.x),
      y: Math.round(wy * zoom + pan.y),
    }),
    [pan, zoom]
  );

  // Canvas Render Loop
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
      renderCanvas(ctx, width, height, dpr, objectsList, selectedObjectId, cursors, pan, zoom);

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [boardState, cursors, selectedObjectId, pan, zoom]);

  // Keyboard Shortcuts (Delete, Escape, Spacebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) {
          syncEngine.submitOp({
            type: 'delete',
            clientOpId: ulid(),
            objectId: selectedObjectId,
          });
          setSelectedObjectId(null);
        }
      } else if (e.key === 'Escape') {
        setSelectedObjectId(null);
        setEditingObject(null);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        if (!isPointerDownRef.current) {
          isPanningRef.current = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedObjectId, syncEngine]);

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

  const getScreenCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  // Mouse Wheel Zoom & Pan
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      // Zoom centered on cursor
      const zoomFactor = Math.exp(-e.deltaY * 0.002);
      const newZoom = Math.max(0.15, Math.min(4.0, zoom * zoomFactor));

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      setZoom(newZoom);
      setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
    } else {
      // Two-finger trackpad or wheel pan
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screenCoords = getScreenCoords(e);
    const worldCoords = screenToWorld(screenCoords.x, screenCoords.y);
    isPointerDownRef.current = true;
    startScreenPosRef.current = screenCoords;
    startWorldPosRef.current = worldCoords;

    // 1. Pan mode (Middle click, Spacebar held, or Hand tool)
    if (e.button === 1 || isSpacePressedRef.current || tool === 'hand') {
      isPanningRef.current = true;
      return;
    }

    const objectsList = Object.values(boardState.objects);

    // 2. Check for resize handle hit on selected object
    if (selectedObjectId) {
      const selectedObj = boardState.objects[selectedObjectId];
      if (selectedObj && !selectedObj.deleted) {
        const bbox = getObjectBoundingBox(selectedObj);
        const handleHit = hitTestResizeHandles(bbox, worldCoords.x, worldCoords.y, 10 / zoom);
        if (handleHit) {
          activeHandleRef.current = handleHit;
          activeObjectIdRef.current = selectedObj.id;
          initialObjBoxRef.current = {
            x: selectedObj.x,
            y: selectedObj.y,
            width: selectedObj.width,
            height: selectedObj.height,
          };
          return;
        }
      }
    }

    // 3. Move / Select Tool
    if (tool === 'move') {
      const hit = findTopmostHit(objectsList, worldCoords.x, worldCoords.y);
      if (hit) {
        setSelectedObjectId(hit.id);
        activeObjectIdRef.current = hit.id;
        initialObjBoxRef.current = {
          x: hit.x,
          y: hit.y,
          width: hit.width,
          height: hit.height,
        };
      } else {
        setSelectedObjectId(null);
        activeObjectIdRef.current = null;
      }
      return;
    }

    // 4. Eraser
    if (tool === 'eraser') {
      const hit = findTopmostHit(objectsList, worldCoords.x, worldCoords.y);
      if (hit) {
        syncEngine.submitOp({
          type: 'delete',
          clientOpId: ulid(),
          objectId: hit.id,
        });
      }
      return;
    }

    // 5. Sticky Note Creation
    if (tool === 'sticky') {
      const id = ulid();
      activeObjectIdRef.current = id;
      const stickyWidth = 180;
      const stickyHeight = 150;
      const initialSticky: CanvasObject = {
        id,
        type: 'sticky',
        owner: syncEngine.clientId || 'anonymous',
        x: worldCoords.x - stickyWidth / 2,
        y: worldCoords.y - stickyHeight / 2,
        width: stickyWidth,
        height: stickyHeight,
        color: '#1e293b',
        strokeWidth: 1,
        fillColor: color === '#ffffff' ? '#fef08a' : color,
        text: 'New Note',
        fontSize: 14,
        deleted: false,
        fieldSeqs: {},
      };

      syncEngine.submitOp({
        type: 'create',
        clientOpId: ulid(),
        object: initialSticky,
      });

      setSelectedObjectId(id);
      setEditingObject({
        id,
        text: 'New Note',
        x: initialSticky.x,
        y: initialSticky.y,
        width: stickyWidth,
        height: stickyHeight,
        fontSize: 14,
        isSticky: true,
      });
      return;
    }

    // 6. Text Object Creation
    if (tool === 'text') {
      const id = ulid();
      activeObjectIdRef.current = id;
      const initialText: CanvasObject = {
        id,
        type: 'text',
        owner: syncEngine.clientId || 'anonymous',
        x: worldCoords.x,
        y: worldCoords.y,
        width: 140,
        height: 36,
        color,
        strokeWidth: 1,
        text: 'Type something...',
        fontSize: 20,
        deleted: false,
        fieldSeqs: {},
      };

      syncEngine.submitOp({
        type: 'create',
        clientOpId: ulid(),
        object: initialText,
      });

      setSelectedObjectId(id);
      setEditingObject({
        id,
        text: 'Type something...',
        x: initialText.x,
        y: initialText.y,
        width: 180,
        height: 48,
        fontSize: 20,
        isSticky: false,
      });
      return;
    }

    // 7. Freehand Stroke
    if (tool === 'stroke') {
      const id = ulid();
      activeObjectIdRef.current = id;
      batchedPointsRef.current = [];

      const initialStroke: CanvasObject = {
        id,
        type: 'stroke',
        owner: syncEngine.clientId || 'anonymous',
        x: worldCoords.x,
        y: worldCoords.y,
        width: 0,
        height: 0,
        color,
        strokeWidth,
        points: [worldCoords],
        deleted: false,
        fieldSeqs: {},
      };

      syncEngine.submitOp({
        type: 'create',
        clientOpId: ulid(),
        object: initialStroke,
      });

      batchTimerRef.current = setInterval(flushBatchedPoints, 25);
      return;
    }

    // 8. Geometric Shapes (Rect, Ellipse, Arrow, Line)
    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line') {
      const id = ulid();
      activeObjectIdRef.current = id;

      const initialShape: CanvasObject = {
        id,
        type: tool,
        owner: syncEngine.clientId || 'anonymous',
        x: worldCoords.x,
        y: worldCoords.y,
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

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screenCoords = getScreenCoords(e);
    const worldCoords = screenToWorld(screenCoords.x, screenCoords.y);

    // Broadcast cursor position in world units
    syncEngine.sendCursor(worldCoords.x, worldCoords.y);

    if (!isPointerDownRef.current) return;

    // 1. Panning
    if (isPanningRef.current) {
      const dx = screenCoords.x - startScreenPosRef.current.x;
      const dy = screenCoords.y - startScreenPosRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      startScreenPosRef.current = screenCoords;
      return;
    }

    // 2. Resizing with handles
    if (activeHandleRef.current && activeObjectIdRef.current) {
      const handle = activeHandleRef.current;
      const init = initialObjBoxRef.current;
      const dx = worldCoords.x - startWorldPosRef.current.x;
      const dy = worldCoords.y - startWorldPosRef.current.y;

      let newX = init.x;
      let newY = init.y;
      let newW = init.width;
      let newH = init.height;

      if (handle.includes('e')) newW = init.width + dx;
      if (handle.includes('s')) newH = init.height + dy;
      if (handle.includes('w')) {
        newX = init.x + dx;
        newW = init.width - dx;
      }
      if (handle.includes('n')) {
        newY = init.y + dy;
        newH = init.height - dy;
      }

      syncEngine.submitOp({
        type: 'update',
        clientOpId: ulid(),
        objectId: activeObjectIdRef.current,
        patch: {
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        },
      });
      return;
    }

    // 3. Drawing Stroke
    if (tool === 'stroke') {
      batchedPointsRef.current.push(worldCoords);
      return;
    }

    // 4. Drawing Shapes (Rect, Ellipse, Arrow, Line)
    if (
      (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line') &&
      activeObjectIdRef.current
    ) {
      const width = worldCoords.x - startWorldPosRef.current.x;
      const height = worldCoords.y - startWorldPosRef.current.y;
      syncEngine.submitOp({
        type: 'update',
        clientOpId: ulid(),
        objectId: activeObjectIdRef.current,
        patch: { width, height },
      });
      return;
    }

    // 5. Moving Objects
    if (tool === 'move' && activeObjectIdRef.current) {
      const dx = worldCoords.x - startWorldPosRef.current.x;
      const dy = worldCoords.y - startWorldPosRef.current.y;
      syncEngine.submitOp({
        type: 'update',
        clientOpId: ulid(),
        objectId: activeObjectIdRef.current,
        patch: {
          x: initialObjBoxRef.current.x + dx,
          y: initialObjBoxRef.current.y + dy,
        },
      });
    }
  };

  // Pointer Up
  const handlePointerUp = () => {
    if (batchTimerRef.current) {
      clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    flushBatchedPoints();

    isPointerDownRef.current = false;
    isPanningRef.current = false;
    activeHandleRef.current = null;
    if (tool !== 'move') {
      activeObjectIdRef.current = null;
    }
  };

  // Double click to edit sticky note or text
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldCoords = screenToWorld(screenX, screenY);

    const hit = findTopmostHit(Object.values(boardState.objects), worldCoords.x, worldCoords.y);
    if (hit && (hit.type === 'sticky' || hit.type === 'text')) {
      setSelectedObjectId(hit.id);
      setEditingObject({
        id: hit.id,
        text: hit.text || '',
        x: hit.x,
        y: hit.y,
        width: Math.max(hit.width, 140),
        height: Math.max(hit.height, 60),
        fontSize: hit.fontSize || (hit.type === 'sticky' ? 14 : 20),
        isSticky: hit.type === 'sticky',
      });
    }
  };

  // Commit text editing
  const handleTextCommit = (newText: string) => {
    if (editingObject) {
      syncEngine.submitOp({
        type: 'update',
        clientOpId: ulid(),
        objectId: editingObject.id,
        patch: { text: newText },
      });
      setEditingObject(null);
    }
  };

  // Zoom Helpers
  const handleZoomIn = () => setZoom((z) => Math.min(4.0, Number((z * 1.2).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.15, Number((z / 1.2).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="canvas-wrapper">
      <canvas
        ref={canvasRef}
        className={`canvas-viewport tool-${tool} ${isPanningRef.current || tool === 'hand' ? 'panning' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />

      {/* Inline Text/Sticky Editor Overlay */}
      {editingObject && (
        <div
          className={`inline-editor-container ${editingObject.isSticky ? 'sticky-editor' : 'text-editor'}`}
          style={{
            left: worldToScreen(editingObject.x, editingObject.y).x,
            top: worldToScreen(editingObject.x, editingObject.y).y,
            width: editingObject.width * zoom,
            height: editingObject.height * zoom,
          }}
        >
          <textarea
            autoFocus
            defaultValue={editingObject.text}
            style={{
              fontSize: `${Math.max(12, editingObject.fontSize * zoom)}px`,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !editingObject.isSticky && !e.shiftKey) {
                e.preventDefault();
                handleTextCommit(e.currentTarget.value);
              } else if (e.key === 'Escape') {
                setEditingObject(null);
              }
            }}
            onBlur={(e) => handleTextCommit(e.target.value)}
          />
        </div>
      )}

      {/* Floating Modern Zoom & View Controller (Bottom-Left) */}
      <div className="zoom-dock">
        <button className="zoom-btn" onClick={handleZoomOut} title="Zoom Out (-)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span className="zoom-label" onClick={handleResetZoom} title="Reset View (100%)">
          {Math.round(zoom * 100)}%
        </span>
        <button className="zoom-btn" onClick={handleZoomIn} title="Zoom In (+)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div className="zoom-divider" />
        <button className="zoom-reset-btn" onClick={handleResetZoom} title="Recenter Origin">
          Recenter
        </button>
      </div>
    </div>
  );
};
