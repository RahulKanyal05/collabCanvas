import React, { useEffect } from 'react';

export type ToolType =
  | 'move'
  | 'hand'
  | 'stroke'
  | 'sticky'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'eraser';

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
  '#fef08a', // Sticky Yellow
  '#bbf7d0', // Sticky Mint Green
  '#bae6fd', // Sticky Sky Blue
  '#fbcfe8', // Sticky Rose Pink
  '#f97316', // Vibrant Orange
  '#38bdf8', // Cyber Cyan
  '#818cf8', // Electric Indigo
];

const STROKE_WIDTHS = [2, 4, 8, 12];

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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v':
          onSelectTool('move');
          break;
        case 'h':
          onSelectTool('hand');
          break;
        case 'b':
          onSelectTool('stroke');
          break;
        case 's':
          onSelectTool('sticky');
          break;
        case 't':
          onSelectTool('text');
          break;
        case 'r':
          onSelectTool('rect');
          break;
        case 'e':
          onSelectTool('ellipse');
          break;
        case 'a':
          onSelectTool('arrow');
          break;
        case 'l':
          onSelectTool('line');
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
      {/* Primary Tool Group */}
      <div className="tool-group">
        <button
          className={`tool-btn ${currentTool === 'move' ? 'active' : ''}`}
          onClick={() => onSelectTool('move')}
          title="Select / Move (V)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3l14 9-7 2-3 7L5 3z" />
          </svg>
          <span className="tool-shortcut">V</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'hand' ? 'active' : ''}`}
          onClick={() => onSelectTool('hand')}
          title="Pan / Hand Tool (H or Space+Drag)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path d="M6 13a2 2 0 0 0-2 2v2a8 8 0 0 0 16 0v-4a2 2 0 0 0-2-2h-4" />
          </svg>
          <span className="tool-shortcut">H</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'stroke' ? 'active' : ''}`}
          onClick={() => onSelectTool('stroke')}
          title="Draw Brush (B)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
          </svg>
          <span className="tool-shortcut">B</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'sticky' ? 'active' : ''}`}
          onClick={() => onSelectTool('sticky')}
          title="Sticky Note (S)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="12" y2="17" />
          </svg>
          <span className="tool-shortcut">S</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'text' ? 'active' : ''}`}
          onClick={() => onSelectTool('text')}
          title="Text (T)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="12" y1="4" x2="12" y2="20" />
            <line x1="8" y1="20" x2="16" y2="20" />
          </svg>
          <span className="tool-shortcut">T</span>
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
          className={`tool-btn ${currentTool === 'arrow' ? 'active' : ''}`}
          onClick={() => onSelectTool('arrow')}
          title="Arrow (A)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="19" x2="19" y2="5" />
            <polyline points="10 5 19 5 19 14" />
          </svg>
          <span className="tool-shortcut">A</span>
        </button>

        <button
          className={`tool-btn ${currentTool === 'line' ? 'active' : ''}`}
          onClick={() => onSelectTool('line')}
          title="Line (L)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="19" x2="19" y2="5" />
          </svg>
          <span className="tool-shortcut">L</span>
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
            title={`${width}px`}
          >
            <div
              className="width-dot"
              style={{
                width: Math.max(3, Math.min(width * 1.5, 14)),
                height: Math.max(3, Math.min(width * 1.5, 14)),
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};
