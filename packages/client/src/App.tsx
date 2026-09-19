import React, { useEffect, useMemo, useState } from 'react';
import { ulid } from 'ulid';
import { UserPresence } from '@collab/protocol';
import { ClientSyncEngine, ConnectionStatus } from './sync/client-sync.js';
import { PresenceBar } from './components/PresenceBar.js';
import { Toolbar, ToolType } from './components/Toolbar.js';
import { Canvas } from './components/Canvas.js';

const RANDOM_COLORS = [
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

function getOrCreateUser(): { name: string; color: string } {
  let name = localStorage.getItem('collab_username');
  let color = localStorage.getItem('collab_usercolor');

  if (!name) {
    name = `Artist-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem('collab_username', name);
  }
  if (!color) {
    color = RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
    localStorage.setItem('collab_usercolor', color);
  }

  return { name, color };
}

function getBoardIdFromUrl(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/b\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  const newBoardId = ulid().toLowerCase();
  window.history.replaceState(null, '', `/b/${newBoardId}`);
  return newBoardId;
}

export const App: React.FC = () => {
  const [boardId] = useState<string>(getBoardIdFromUrl);
  const user = useMemo(() => getOrCreateUser(), []);

  // UI tool states
  const [tool, setTool] = useState<ToolType>('stroke');
  const [color, setColor] = useState<string>('#ffffff');
  const [width, setWidth] = useState<number>(4);

  // Sync state
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [presence, setPresence] = useState<UserPresence[]>([]);

  // Setup sync engine
  const syncEngine = useMemo(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    return new ClientSyncEngine({
      wsUrl,
      boardId,
      clientName: user.name,
      clientColor: user.color,
    });
  }, [boardId, user]);

  useEffect(() => {
    const unsubStatus = syncEngine.subscribeStatus((newStatus, msg) => {
      setStatus(newStatus);
      setErrorMessage(msg || null);
    });

    const unsubPresence = syncEngine.subscribePresence((newPresence) => {
      setPresence(newPresence);
    });

    syncEngine.connect();

    return () => {
      unsubStatus();
      unsubPresence();
      syncEngine.disconnect();
    };
  }, [syncEngine]);

  return (
    <div className="app-container">
      {/* Top Header Navigation & Presence */}
      <PresenceBar
        boardId={boardId}
        presence={presence}
        status={status}
        currentUserId={syncEngine.clientId}
      />

      {/* Error / Capacity Warning Banner */}
      {errorMessage && (
        <div className="error-banner">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* HTML5 Canvas Viewport */}
      <Canvas
        syncEngine={syncEngine}
        tool={tool}
        color={color}
        strokeWidth={width}
      />

      {/* Floating Modern Toolbar */}
      <Toolbar
        currentTool={tool}
        currentColor={color}
        currentWidth={width}
        onSelectTool={setTool}
        onSelectColor={setColor}
        onSelectWidth={setWidth}
      />
    </div>
  );
};
