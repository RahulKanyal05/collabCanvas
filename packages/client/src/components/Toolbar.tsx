import React, { useEffect } from 'react';

export type ToolType = 'stroke' | 'rect' | 'ellipse' | 'move' | 'eraser';

interface ToolbarProps {
  currentTool: ToolType;
  currentColor: string;
  currentWidth: number;
  onSelectTool: (tool: ToolType) => void;
  onSelectColor: (color: string) => void;
  onSelectWidth: (width: number) => void;
}

const PALETTE = [
  '#ffffff', // White
  '#f43f5e', // Rose
  '#f97316', // Orange
  '#eab308', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#a855f7', // Purple
];

const STROKE_WIDTHS = [2, 4, 8, 14];

export const Toolbar: React.FC<ToolbarProps> = ({
  currentTool,
  currentColor,
  currentWidth,
  onSelectTool,
  onSelectColor,
  onSelectWidth,
}) => {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          onSelectTool('move');
          break;
        case 'b':
          onSelectTool('stroke');
          break;
        case 'r':
          onSelectTool('rect');
          break;
        case 'e':
          onSelectTool('ellipse');
          break;
        case 'x':
          onSelectTool('eraser');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectTool]);

  return (
    <div className="toolbar-dock">
      {/* Tool Group */}
      <div className="tool-group">
        <button
          className={`tool-btn ${currentTool === 'move' ? 'active' : ''}`}
          onClick={() => onSelectTool('move')}
          title="Move / Select (V)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3l14 9-7 2-3 7L5 3z" />
          </svg>
          <span className="tool-shortcut">V</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'stroke' ? 'active' : ''}`}
          onClick={() => onSelectTool('stroke')}
          title="Freehand Brush (B)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
          </svg>
          <span className="tool-shortcut">B</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'rect' ? 'active' : ''}`}
          onClick={() => onSelectTool('rect')}
          title="Rectangle (R)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
          <span className="tool-shortcut">R</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'ellipse' ? 'active' : ''}`}
          onClick={() => onSelectTool('ellipse')}
          title="Ellipse (E)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="12" rx="10" ry="7" />
          </svg>
          <span className="tool-shortcut">E</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'eraser' ? 'active' : ''}`}
          onClick={() => onSelectTool('eraser')}
          title="Eraser (X)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z" />
            <path d="M17 17L7 7" />
          </svg>
          <span className="tool-shortcut">X</span>
        </button>
      </div>

      <div className="divider" />

      {/* Color Palette */}
      <div className="color-swatches">
        {PALETTE.map((color) => (
          <button
            key={color}
            className={`color-swatch ${currentColor === color ? 'selected' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => onSelectColor(color)}
            title={color}
          />
        ))}
      </div>

      <div className="divider" />

      {/* Width Picker */}
      <div className="width-picker">
        {STROKE_WIDTHS.map((width) => (
          <button
            key={width}
            className={`width-btn ${currentWidth === width ? 'active' : ''}`}
            onClick={() => onSelectWidth(width)}
            title={`${width}px width`}
          >
            <span
              className="width-dot"
              style={{
                width: Math.min(width, 16),
                height: Math.min(width, 16),
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};
