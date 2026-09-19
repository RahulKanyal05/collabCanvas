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
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2" fill="none" />
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
            {copied ? '✓' : '📋'}
          </button>
        </div>
      </div>

      <div className="presence-section">
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
