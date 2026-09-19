import {
  BoardState,
  ClientMessage,
  ClientOp,
  createEmptyBoardState,
  SequencedOp,
  ServerMessage,
  UserPresence,
} from '@collab/protocol';
import { computeOptimisticState, handleSequencedOp } from './reconcile.js';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'full'
  | 'error';

export interface CursorInfo {
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeen: number;
}

export interface ClientSyncConfig {
  wsUrl: string;
  boardId: string;
  clientName: string;
  clientColor: string;
  WebSocketClass?: any;
}

export class ClientSyncEngine {
  private ws: any | null = null;
  private WebSocketImpl: any;
  private status: ConnectionStatus = 'disconnected';
  private errorMessage: string | null = null;

  public clientId: string | null = null;
  private confirmedState: BoardState = createEmptyBoardState();
  private pendingOps: ClientOp[] = [];
  private viewState: BoardState = createEmptyBoardState();

  private gapBuffer: Map<number, SequencedOp> = new Map();
  private isResuming: boolean = false;

  private cursors: Map<string, CursorInfo> = new Map();
  private presence: UserPresence[] = [];

  private lastCursorSendTime: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: any = null;
  private explicitlyDisconnected: boolean = false;

  private stateListeners: Set<(state: BoardState) => void> = new Set();
  private cursorListeners: Set<(cursors: Map<string, CursorInfo>) => void> = new Set();
  private presenceListeners: Set<(presence: UserPresence[]) => void> = new Set();
  private statusListeners: Set<(status: ConnectionStatus, message?: string | null) => void> = new Set();

  constructor(private config: ClientSyncConfig) {
    this.WebSocketImpl =
      config.WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!this.WebSocketImpl) {
      throw new Error('No WebSocket implementation provided or found in environment');
    }
  }

  // Event Subscription
  subscribeState(cb: (state: BoardState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.viewState);
    return () => this.stateListeners.delete(cb);
  }

  subscribeCursors(cb: (cursors: Map<string, CursorInfo>) => void): () => void {
    this.cursorListeners.add(cb);
    cb(new Map(this.cursors));
    return () => this.cursorListeners.delete(cb);
  }

  subscribePresence(cb: (presence: UserPresence[]) => void): () => void {
    this.presenceListeners.add(cb);
    cb(this.presence);
    return () => this.presenceListeners.delete(cb);
  }

  subscribeStatus(cb: (status: ConnectionStatus, message?: string | null) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status, this.errorMessage);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(status: ConnectionStatus, message: string | null = null): void {
    this.status = status;
    this.errorMessage = message;
    for (const listener of this.statusListeners) {
      listener(status, message);
    }
  }

  private emitState(): void {
    this.viewState = computeOptimisticState(this.confirmedState, this.pendingOps);
    for (const listener of this.stateListeners) {
      listener(this.viewState);
    }
  }

  private emitCursors(): void {
    const copy = new Map(this.cursors);
    for (const listener of this.cursorListeners) {
      listener(copy);
    }
  }

  private emitPresence(): void {
    for (const listener of this.presenceListeners) {
      listener(this.presence);
    }
  }

  // Connection Lifecycle
  connect(): void {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    this.explicitlyDisconnected = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new this.WebSocketImpl(this.config.wsUrl);
    } catch (err: any) {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Send join message
      this.send({
        type: 'join',
        boardId: this.config.boardId,
        clientName: this.config.clientName,
        clientColor: this.config.clientColor,
      });
    };

    this.ws.onmessage = (event: any) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = (event: any) => {
      if (this.explicitlyDisconnected) {
        this.setStatus('disconnected');
        return;
      }

      if (event.code === 1012) {
        // Service Restart: server shutting down for rollout, reconnect immediately
        this.scheduleReconnect(100);
      } else {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // WS error will trigger close handler
    };
  }

  disconnect(): void {
    this.explicitlyDisconnected = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  private scheduleReconnect(explicitDelay?: number): void {
    if (this.status === 'full') return; // Do not reconnect if board full
    if (this.explicitlyDisconnected) return;

    this.setStatus('reconnecting');
    this.reconnectAttempts += 1;

    const baseDelay = explicitDelay !== undefined
      ? explicitDelay
      : Math.min(10000, 500 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8)));
    const jitter = 0.8 + 0.4 * Math.random();
    const delay = Math.round(baseDelay * jitter);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Inbound Message Handler
  private handleMessage(rawData: string | Buffer): void {
    const text = typeof rawData === 'string' ? rawData : rawData.toString();
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'ping': {
        this.send({ type: 'pong' });
        break;
      }

      case 'joined': {
        this.clientId = message.clientId;
        this.setStatus('connected');
        // If we had a prior confirmedState, request a resume from where we left off
        if (this.confirmedState.seq > 0) {
          this.isResuming = true;
          this.send({
            type: 'resume',
            boardId: this.config.boardId,
            lastSeq: this.confirmedState.seq,
          });
        }
        break;
      }

      case 'snapshot': {
        // Full snapshot received (on join or fallback from trimmed stream)
        this.confirmedState = {
          seq: message.seq,
          objects: message.objects,
        };
        this.gapBuffer.clear();
        this.isResuming = false;
        this.emitState();
        break;
      }

      case 'resumed': {
        // Replayed stream operations
        for (const seqOp of message.ops) {
          this.applyIncomingOp(seqOp);
        }
        this.isResuming = false;
        // Process any buffered ops after replay
        this.drainGapBuffer();
        this.emitState();
        break;
      }

      case 'op': {
        this.handleIncomingSequencedOp(message);
        break;
      }

      case 'cursor': {
        if (message.clientId === this.clientId) return; // Don't show own cursor
        this.cursors.set(message.clientId, {
          clientId: message.clientId,
          name: message.name,
          color: message.color,
          x: message.x,
          y: message.y,
          lastSeen: Date.now(),
        });
        this.emitCursors();
        break;
      }

      case 'presence': {
        this.presence = message.users;
        // Remove cursors for users who left
        const activeIds = new Set(this.presence.map((u) => u.clientId));
        for (const id of this.cursors.keys()) {
          if (!activeIds.has(id)) {
            this.cursors.delete(id);
          }
        }
        this.emitPresence();
        this.emitCursors();
        break;
      }

      case 'error': {
        if (message.code === 'BOARD_FULL') {
          this.setStatus('full', message.message);
          this.disconnect();
        } else {
          this.setStatus('error', message.message);
        }
        break;
      }
    }
  }

  private handleIncomingSequencedOp(opMsg: SequencedOp): void {
    if (this.isResuming) {
      // While waiting for resume/snapshot replay, buffer incoming ops
      this.gapBuffer.set(opMsg.seq, opMsg);
      return;
    }

    const expectedSeq = this.confirmedState.seq + 1;

    if (opMsg.seq < expectedSeq) {
      // Duplicate or past op; ignore
      return;
    }

    if (opMsg.seq > expectedSeq) {
      // Gap detected! Pub/Sub missed an op or network delivered out-of-order
      this.gapBuffer.set(opMsg.seq, opMsg);
      this.isResuming = true;
      this.send({
        type: 'resume',
        boardId: this.config.boardId,
        lastSeq: this.confirmedState.seq,
      });
      return;
    }

    // Exact expected next op
    this.applyIncomingOp(opMsg);
    this.drainGapBuffer();
    this.emitState();
  }

  private applyIncomingOp(opMsg: SequencedOp): void {
    const { nextConfirmed, nextPending } = handleSequencedOp(
      this.confirmedState,
      this.pendingOps,
      opMsg
    );
    this.confirmedState = nextConfirmed;
    this.pendingOps = nextPending;
  }

  private drainGapBuffer(): void {
    let nextSeq = this.confirmedState.seq + 1;
    while (this.gapBuffer.has(nextSeq)) {
      const bufferedOp = this.gapBuffer.get(nextSeq)!;
      this.gapBuffer.delete(nextSeq);
      this.applyIncomingOp(bufferedOp);
      nextSeq = this.confirmedState.seq + 1;
    }
  }

  // Public Methods for UI Actions
  submitOp(op: ClientOp): void {
    this.pendingOps.push(op);
    this.emitState(); // Optimistic local render

    this.send({
      type: 'op',
      boardId: this.config.boardId,
      op,
    });
  }

  sendCursor(x: number, y: number): void {
    const now = Date.now();
    // Throttled to ~30 Hz (33ms)
    if (now - this.lastCursorSendTime >= 33) {
      this.lastCursorSendTime = now;
      this.send({
        type: 'cursor',
        boardId: this.config.boardId,
        x,
        y,
      });
    }
  }

  getViewState(): BoardState {
    return this.viewState;
  }

  getPendingOps(): ClientOp[] {
    return [...this.pendingOps];
  }

  getConfirmedState(): BoardState {
    return this.confirmedState;
  }
}
