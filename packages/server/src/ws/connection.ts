import { WebSocket } from 'ws';
import { ulid } from 'ulid';
import {
  ClientMessageSchema,
  ErrorMessage,
  JoinedMessage,
  SnapshotMessage,
  ResumedMessage,
  CursorBroadcastMessage,
} from '@collab/protocol';
import { RoomManager } from '../board/room.js';
import { Sequencer } from '../board/sequencer.js';
import { RateLimiter } from './rate-limit.js';
import { config } from '../config.js';
import { activeConnections } from '../metrics.js';

export class ConnectionHandler {
  public isAlive: boolean = true;
  private rateLimiter: RateLimiter;
  private clientId: string | null = null;
  private boardId: string | null = null;

  constructor(
    private ws: WebSocket,
    private roomManager: RoomManager,
    private sequencer: Sequencer
  ) {
    this.rateLimiter = new RateLimiter(config.rateLimitOpsPerSec, config.rateLimitOpsPerSec);
    this.setupSocket();
    activeConnections.inc({ instance_id: config.instanceId });
  }

  private setupSocket(): void {
    this.ws.on('message', async (data: Buffer | string) => {
      await this.handleRawMessage(data);
    });

    this.ws.on('pong', () => {
      this.isAlive = true;
    });

    this.ws.on('close', async () => {
      activeConnections.dec({ instance_id: config.instanceId });
      await this.roomManager.leave(this.ws);
    });

    this.ws.on('error', async () => {
      activeConnections.dec({ instance_id: config.instanceId });
      await this.roomManager.leave(this.ws);
    });
  }

  private sendError(code: ErrorMessage['code'], message: string): void {
    const errorMsg: ErrorMessage = { type: 'error', code, message };
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(errorMsg));
    }
  }

  private async handleRawMessage(data: Buffer | string): Promise<void> {
    const dataString = typeof data === 'string' ? data : data.toString('utf-8');

    if (Buffer.byteLength(dataString) > config.maxMessageBytes) {
      this.sendError('INVALID_MESSAGE', `Message exceeds maximum allowed size of ${config.maxMessageBytes} bytes`);
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(dataString);
    } catch {
      this.sendError('INVALID_MESSAGE', 'Malformed JSON payload');
      return;
    }

    const validation = ClientMessageSchema.safeParse(parsed);
    if (!validation.success) {
      this.sendError('INVALID_MESSAGE', `Schema validation failed: ${validation.error.message}`);
      return;
    }

    const message = validation.data;

    switch (message.type) {
      case 'pong': {
        this.isAlive = true;
        break;
      }

      case 'join': {
        const generatedClientId = ulid();
        const joinResult = await this.roomManager.join(
          this.ws,
          message.boardId,
          generatedClientId,
          message.clientName,
          message.clientColor
        );

        if (!joinResult.success) {
          this.sendError('BOARD_FULL', 'This board has reached its maximum capacity of 50 concurrent users.');
          return;
        }

        this.clientId = generatedClientId;
        this.boardId = message.boardId;

        // Send joined confirmation
        const joinedMsg: JoinedMessage = {
          type: 'joined',
          boardId: message.boardId,
          clientId: generatedClientId,
          maxUsers: config.maxUsersPerBoard,
        };
        this.ws.send(JSON.stringify(joinedMsg));

        // Fetch and send latest snapshot
        const snapshot = await this.sequencer.getSnapshotManager().getLatestSnapshot(message.boardId);
        const snapshotMsg: SnapshotMessage = {
          type: 'snapshot',
          boardId: message.boardId,
          seq: snapshot.seq,
          objects: snapshot.objects,
        };
        this.ws.send(JSON.stringify(snapshotMsg));
        break;
      }

      case 'op': {
        if (!this.boardId || !this.clientId) {
          this.sendError('NOT_JOINED', 'You must join a board before submitting operations.');
          return;
        }

        if (!this.rateLimiter.tryConsume()) {
          this.sendError('RATE_LIMITED', 'Operation rate limit exceeded. Please throttle local edits.');
          return;
        }

        try {
          // Atomically sequence op via Lua, append to stream, and publish
          await this.sequencer.sequenceOp(this.boardId, message.op);
        } catch (err: any) {
          this.sendError('INTERNAL_ERROR', 'Failed to sequence operation on server');
        }
        break;
      }

      case 'resume': {
        if (!this.boardId) {
          this.sendError('NOT_JOINED', 'You must join a board before requesting replay.');
          return;
        }

        const missedOps = await this.sequencer.getOpsSince(this.boardId, message.lastSeq);
        if (missedOps === null) {
          // Stream was trimmed past lastSeq; fall back to full snapshot
          const snapshot = await this.sequencer.getSnapshotManager().getLatestSnapshot(this.boardId);
          const snapshotMsg: SnapshotMessage = {
            type: 'snapshot',
            boardId: this.boardId,
            seq: snapshot.seq,
            objects: snapshot.objects,
          };
          this.ws.send(JSON.stringify(snapshotMsg));
        } else {
          const resumedMsg: ResumedMessage = {
            type: 'resumed',
            boardId: this.boardId,
            ops: missedOps,
          };
          this.ws.send(JSON.stringify(resumedMsg));
        }
        break;
      }

      case 'cursor': {
        if (!this.boardId || !this.clientId) return;
        const clientInfo = this.roomManager.getClientInfo(this.ws);
        if (!clientInfo) return;

        const cursorMsg: CursorBroadcastMessage = {
          type: 'cursor',
          boardId: this.boardId,
          clientId: this.clientId,
          name: clientInfo.name,
          color: clientInfo.color,
          x: message.x,
          y: message.y,
        };
        await this.roomManager.publishCursor(this.boardId, cursorMsg);
        break;
      }
    }
  }
}
