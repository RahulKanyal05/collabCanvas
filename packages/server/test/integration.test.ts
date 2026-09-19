import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, ServerInstance } from '../src/server.js';
import {
  ClientMessage,
  ServerMessage,
  JoinedMessage,
  SnapshotMessage,
  SequencedOpMessage,
} from '@collab/protocol';

describe('Server Integration & Multi-Client Synchronization', () => {
  let serverInstance: ServerInstance;
  const testPort = 4999;
  const boardId = 'test-board-sync';

  beforeAll(async () => {
    serverInstance = await createServer({
      port: testPort,
      redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      maxUsersPerBoard: 50,
      heartbeatIntervalMs: 60000,
    });
    await serverInstance.app.listen({ port: testPort, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await serverInstance.close();
  });

  function createTestClient(): {
    ws: WebSocket;
    messages: ServerMessage[];
    send: (msg: ClientMessage) => void;
    waitFor: (predicate: (msg: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
    close: () => Promise<void>;
  } {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
    const messages: ServerMessage[] = [];

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString('utf-8')) as ServerMessage;
      messages.push(parsed);
    });

    const send = (msg: ClientMessage) => {
      ws.send(JSON.stringify(msg));
    };

    const waitFor = (predicate: (msg: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> => {
      return new Promise((resolve, reject) => {
        const found = messages.find(predicate);
        if (found) return resolve(found);

        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for message. Received: ${JSON.stringify(messages)}`));
        }, timeoutMs);

        const handler = (data: any) => {
          try {
            const parsed = JSON.parse(data.toString('utf-8')) as ServerMessage;
            if (predicate(parsed)) {
              clearTimeout(timer);
              ws.off('message', handler);
              resolve(parsed);
            }
          } catch {}
        };

        ws.on('message', handler);
      });
    };

    const close = () => {
      return new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
        ws.close();
      });
    };

    return { ws, messages, send, waitFor, close };
  }

  it('connects two clients and verifies they see ops in identical sequence order', async () => {
    const client1 = createTestClient();
    const client2 = createTestClient();

    // Wait for open
    await new Promise((r) => client1.ws.on('open', r));
    await new Promise((r) => client2.ws.on('open', r));

    // Client 1 joins
    client1.send({
      type: 'join',
      boardId,
      clientName: 'Alice',
      clientColor: '#ff0000',
    });
    const c1Joined = (await client1.waitFor((m) => m.type === 'joined')) as JoinedMessage;
    expect(c1Joined.clientId).toBeDefined();

    const c1Snapshot = (await client1.waitFor((m) => m.type === 'snapshot')) as SnapshotMessage;
    expect(c1Snapshot.seq).toBeGreaterThanOrEqual(0);

    // Client 2 joins
    client2.send({
      type: 'join',
      boardId,
      clientName: 'Bob',
      clientColor: '#0000ff',
    });
    const c2Joined = (await client2.waitFor((m) => m.type === 'joined')) as JoinedMessage;
    expect(c2Joined.clientId).toBeDefined();

    // Client 1 sends create op
    client1.send({
      type: 'op',
      boardId,
      op: {
        type: 'create',
        clientOpId: 'c1-op-1',
        object: {
          id: 'obj-sync-1',
          type: 'rect',
          owner: c1Joined.clientId,
          x: 10,
          y: 20,
          width: 50,
          height: 50,
          color: '#ff0000',
          strokeWidth: 2,
        },
      },
    });

    // Client 2 sends update op
    client2.send({
      type: 'op',
      boardId,
      op: {
        type: 'update',
        clientOpId: 'c2-op-1',
        objectId: 'obj-sync-1',
        patch: { x: 99 },
      },
    });

    // Both clients should receive both ops
    const c1Op1 = (await client1.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'c1-op-1'
    )) as SequencedOpMessage;

    const c1Op2 = (await client1.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'c2-op-1'
    )) as SequencedOpMessage;

    const c2Op1 = (await client2.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'c1-op-1'
    )) as SequencedOpMessage;

    const c2Op2 = (await client2.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'c2-op-1'
    )) as SequencedOpMessage;

    // Verify identical sequence numbers!
    expect(c1Op1.seq).toBe(c2Op1.seq);
    expect(c1Op2.seq).toBe(c2Op2.seq);
    expect(c1Op1.seq).toBeLessThan(c1Op2.seq);

    await client1.close();
    await client2.close();
  });

  it('rejects connection when board exceeds max users limit (50)', async () => {
    const fullBoardId = 'board-capacity-test';
    // Fill up to max (let's test with a small mock or test max)
    // Server config has maxUsersPerBoard: 50
    // We can add 50 dummy members to Redis set directly to simulate full board
    const membersKey = `board:${fullBoardId}:members`;
    for (let i = 0; i < 50; i++) {
      await serverInstance.redis.sadd(membersKey, `dummy-user-${i}`);
    }

    const client51 = createTestClient();
    await new Promise((r) => client51.ws.on('open', r));

    client51.send({
      type: 'join',
      boardId: fullBoardId,
      clientName: 'User51',
      clientColor: '#ffffff',
    });

    const errorMsg = await client51.waitFor((m) => m.type === 'error');
    expect((errorMsg as any).code).toBe('BOARD_FULL');

    await client51.close();
    await serverInstance.redis.del(membersKey);
  });
});
