import { WebSocket } from 'ws';
import { Redis } from 'ioredis';
import {
  CursorBroadcastMessage,
  PresenceMessage,
  SequencedOpMessage,
  ServerMessage,
  UserPresence,
} from '@collab/protocol';
import { fanoutLatencySeconds, activeBoards } from '../metrics.js';
import { config } from '../config.js';

export interface ClientConnectionInfo {
  boardId: string;
  clientId: string;
  name: string;
  color: string;
}

export class RoomManager {
  private localRooms = new Map<string, Set<WebSocket>>();
  private socketInfo = new Map<WebSocket, ClientConnectionInfo>();
  private boardPresence = new Map<string, Map<string, UserPresence>>();
  private subscribedBoards = new Set<string>();

  constructor(
    private redis: Redis,
    private subRedis: Redis
  ) {
    this.setupPubSub();
  }

  private setupPubSub(): void {
    this.subRedis.on('message', (channel: string, message: string) => {
      this.handlePubSubMessage(channel, message);
    });
  }

  private handlePubSubMessage(channel: string, rawMessage: string): void {
    const parts = channel.split(':');
    if (parts.length < 3 || parts[0] !== 'board') return;

    const boardId = parts[1];
    const channelType = parts[2]; // 'ops' or 'ephemeral'
    const sockets = this.localRooms.get(boardId);
    if (!sockets || sockets.size === 0) return;

    try {
      const data = JSON.parse(rawMessage);

      if (channelType === 'ops') {
        // Record fanout latency
        if (data.serverTimestamp) {
          const latencySec = (Date.now() - data.serverTimestamp) / 1000;
          if (latencySec >= 0) {
            fanoutLatencySeconds.observe({ board_id: boardId }, latencySec);
          }
        }

        const opMessage: SequencedOpMessage = {
          type: 'op',
          boardId,
          seq: data.seq,
          op: data.op,
          serverTimestamp: data.serverTimestamp,
        };
        this.broadcastToLocalSockets(sockets, JSON.stringify(opMessage));
      } else if (channelType === 'ephemeral') {
        // Broadcast cursor or presence directly
        this.broadcastToLocalSockets(sockets, rawMessage);
      }
    } catch {
      // Ignore malformed pub/sub message
    }
  }

  private broadcastToLocalSockets(sockets: Set<WebSocket>, payload: string, exclude?: WebSocket): void {
    for (const ws of sockets) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  async join(
    ws: WebSocket,
    boardId: string,
    clientId: string,
    name: string,
    color: string
  ): Promise<{ success: boolean; reason?: 'BOARD_FULL' }> {
    const membersKey = `board:${boardId}:members`;

    // Atomic join check and member add via Redis pipeline or check
    const currentCount = await this.redis.scard(membersKey);
    if (currentCount >= config.maxUsersPerBoard) {
      return { success: false, reason: 'BOARD_FULL' };
    }

    await this.redis.sadd(membersKey, clientId);

    // Track locally
    let sockets = this.localRooms.get(boardId);
    if (!sockets) {
      sockets = new Set<WebSocket>();
      this.localRooms.set(boardId, sockets);
      activeBoards.set(this.localRooms.size);
    }
    sockets.add(ws);

    const info: ClientConnectionInfo = { boardId, clientId, name, color };
    this.socketInfo.set(ws, info);

    let presenceMap = this.boardPresence.get(boardId);
    if (!presenceMap) {
      presenceMap = new Map();
      this.boardPresence.set(boardId, presenceMap);
    }
    presenceMap.set(clientId, { clientId, name, color });

    // Ensure Redis Pub/Sub subscription
    if (!this.subscribedBoards.has(boardId)) {
      this.subscribedBoards.add(boardId);
      await this.subRedis.subscribe(`board:${boardId}:ops`, `board:${boardId}:ephemeral`);
    }

    // Broadcast presence update
    await this.publishPresence(boardId);

    return { success: true };
  }

  async leave(ws: WebSocket): Promise<void> {
    const info = this.socketInfo.get(ws);
    if (!info) return;

    const { boardId, clientId } = info;
    this.socketInfo.delete(ws);

    const membersKey = `board:${boardId}:members`;
    await this.redis.srem(membersKey, clientId).catch(() => {});

    const sockets = this.localRooms.get(boardId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.localRooms.delete(boardId);
        activeBoards.set(this.localRooms.size);

        if (this.subscribedBoards.has(boardId)) {
          this.subscribedBoards.delete(boardId);
          await this.subRedis.unsubscribe(`board:${boardId}:ops`, `board:${boardId}:ephemeral`).catch(() => {});
        }
      }
    }

    const presenceMap = this.boardPresence.get(boardId);
    if (presenceMap) {
      presenceMap.delete(clientId);
      if (presenceMap.size === 0) {
        this.boardPresence.delete(boardId);
      }
    }

    if (this.redis.status === 'ready') {
      await this.publishPresence(boardId).catch(() => {});
    }
  }

  getClientInfo(ws: WebSocket): ClientConnectionInfo | undefined {
    return this.socketInfo.get(ws);
  }

  async publishCursor(boardId: string, cursorMessage: CursorBroadcastMessage): Promise<void> {
    await this.redis.publish(`board:${boardId}:ephemeral`, JSON.stringify(cursorMessage));
  }

  async publishPresence(boardId: string): Promise<void> {
    const presenceMap = this.boardPresence.get(boardId);
    const users: UserPresence[] = presenceMap ? Array.from(presenceMap.values()) : [];

    const msg: PresenceMessage = {
      type: 'presence',
      boardId,
      users,
    };
    await this.redis.publish(`board:${boardId}:ephemeral`, JSON.stringify(msg));
  }

  sendToSocket(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
