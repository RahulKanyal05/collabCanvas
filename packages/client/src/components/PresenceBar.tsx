import React, { useState } from 'react';
import { UserPresence } from '@collab/protocol';
import { ConnectionStatus } from '../sync/client-sync.js';

interface PresenceBarProps {
  boardId: string;
  presence: UserPresence[];
  status: ConnectionStatus;
  currentUserId: string | null;
}

export const PresenceBar: React.FC<PresenceBarProps> = ({
  boardId,
  presence,
  status,
  currentUserId,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPNG = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `canvas-${boardId.slice(0, 8)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'connected':
        return 'Live';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'full':
        return 'Board Full (50)';
      case 'error':
        return 'Error';
      default:
        return 'Offline';
    }
  };

  return (
    <header className="top-nav">
      <div className="brand-section">
        <div className="brand-logo" title="CollabCanvas">
          <svg viewBox="0 0 24 24">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#fff"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </div>
        <span className="brand-title">CollabCanvas</span>
        <div className="board-badge">
          <span>/b/{boardId.slice(0, 8)}...</span>
          <button
            className="copy-btn"
            onClick={handleCopyLink}
            title="Copy board share link"
          >
            {copied ? '✓ Copied' : '📋 Share'}
          </button>
        </div>
      </div>

      <div className="presence-section">
        <button
          className="export-btn"
          onClick={handleExportPNG}
          title="Export Canvas to PNG"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>Export</span>
        </button>

        <div className="avatars-container">
          {presence.slice(0, 6).map((u) => {
            const isMe = u.clientId === currentUserId;
            return (
              <div
                key={u.clientId}
                className="avatar-pill"
                style={{ backgroundColor: u.color }}
                title={`${u.name}${isMe ? ' (You)' : ''}`}
              >
                {u.name.charAt(0).toUpperCase()}
              </div>
            );
          })}
          {presence.length > 6 && (
            <div className="avatar-pill" style={{ backgroundColor: '#475569' }}>
              +{presence.length - 6}
            </div>
          )}
        </div>

        <div className={`status-badge status-${status}`}>
          <span className="status-dot" />
          <span>{getStatusLabel()}</span>
        </div>
      </div>
    </header>
  );
};
