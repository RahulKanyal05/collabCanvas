import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, ServerInstance } from '../src/server.js';
import {
  ClientMessage,
  ServerMessage,
  JoinedMessage,
  SequencedOpMessage,
} from '@collab/protocol';

describe('Phase 4: Chaos Integration Test (Instance termination mid-run)', () => {
  let instance1: ServerInstance;
  let instance2: ServerInstance;
  const port1 = 4921;
  const port2 = 4922;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const boardId = 'chaos-resilience-board';

  beforeAll(async () => {
    instance1 = await createServer({
      port: port1,
      redisUrl,
      instanceId: 'chaos-inst-1',
      heartbeatIntervalMs: 60000,
    });
    await instance1.app.listen({ port: port1, host: '127.0.0.1' });

    instance2 = await createServer({
      port: port2,
      redisUrl,
      instanceId: 'chaos-inst-2',
      heartbeatIntervalMs: 60000,
    });
    await instance2.app.listen({ port: port2, host: '127.0.0.1' });
  });

  afterAll(async () => {
    try {
      await instance1.close();
    } catch {}
    try {
      await instance2.close();
    } catch {}
  });

  function createTestClient(port: number): {
    ws: WebSocket;
    messages: ServerMessage[];
    send: (msg: ClientMessage) => void;
    waitFor: (predicate: (msg: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
    close: () => Promise<void>;
  } {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: ServerMessage[] = [];

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString('utf-8')) as ServerMessage;
        messages.push(parsed);
      } catch {}
    });

    const send = (msg: ClientMessage) => {
      ws.send(JSON.stringify(msg));
    };

    const waitFor = (predicate: (msg: ServerMessage) => boolean, timeoutMs = 8000): Promise<ServerMessage> => {
      return new Promise((resolve, reject) => {
        const found = messages.find(predicate);
        if (found) return resolve(found);

        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for message. Total received: ${messages.length}`));
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
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.on('close', () => resolve());
        ws.close();
      });
    };

    return { ws, messages, send, waitFor, close };
  }

  it('abruptly terminates an instance mid-stream and asserts full convergence across clients', async () => {
    // Client A connects to instance 1
    const clientA = createTestClient(port1);
    // Client B connects to instance 2
    const clientB = createTestClient(port2);

    await new Promise((r) => clientA.ws.on('open', r));
    await new Promise((r) => clientB.ws.on('open', r));

    clientA.send({ type: 'join', boardId, clientName: 'Alice', clientColor: '#f43f5e' });
    const aJoined = (await clientA.waitFor((m) => m.type === 'joined')) as JoinedMessage;

    clientB.send({ type: 'join', boardId, clientName: 'Bob', clientColor: '#10b981' });
    const bJoined = (await clientB.waitFor((m) => m.type === 'joined')) as JoinedMessage;

    // Both send simultaneous create ops
    clientA.send({
      type: 'op',
      boardId,
      op: {
        type: 'create',
        clientOpId: 'chaos-a-1',
        object: {
          id: 'rect-chaos-a',
          type: 'rect',
          owner: aJoined.clientId,
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          color: '#f43f5e',
          strokeWidth: 2,
        },
      },
    });

    clientB.send({
      type: 'op',
      boardId,
      op: {
        type: 'create',
        clientOpId: 'chaos-b-1',
        object: {
          id: 'rect-chaos-b',
          type: 'rect',
          owner: bJoined.clientId,
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          color: '#10b981',
          strokeWidth: 2,
        },
      },
    });

    // Wait until both clients receive the initial ops
    await clientA.waitFor((m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'chaos-b-1');
    const aLastOp = (await clientA.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'chaos-a-1'
    )) as SequencedOpMessage;

    const lastConfirmedA = aLastOp.seq;

    // CHAOS: Kill instance 1 mid-stream!
    await instance1.close();

    // Client A reconnects to instance 2 (the surviving instance)
    const clientAReconnected = createTestClient(port2);
    await new Promise((r) => clientAReconnected.ws.on('open', r));

    clientAReconnected.send({
      type: 'join',
      boardId,
      clientName: 'Alice',
      clientColor: '#f43f5e',
    });
    await clientAReconnected.waitFor((m) => m.type === 'joined');

    // Resume from lastConfirmedA
    clientAReconnected.send({
      type: 'resume',
      boardId,
      lastSeq: lastConfirmedA,
    });

    // Client A sends update on instance 2
    clientAReconnected.send({
      type: 'op',
      boardId,
      op: {
        type: 'update',
        clientOpId: 'chaos-a-2',
        objectId: 'rect-chaos-a',
        patch: { x: 777 },
      },
    });

    // Client B also sends another update on instance 2
    clientB.send({
      type: 'op',
      boardId,
      op: {
        type: 'update',
        clientOpId: 'chaos-b-2',
        objectId: 'rect-chaos-b',
        patch: { y: 888 },
      },
    });

    // Verify both clients on instance 2 receive the new updates
    await clientAReconnected.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'chaos-b-2'
    );
    await clientB.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'chaos-a-2'
    );

    // Assert final ground-truth snapshot from Redis
    const snapshotManager = instance2.sequencer.getSnapshotManager();
    const finalSnapshot = await snapshotManager.getLatestSnapshot(boardId);

    expect(finalSnapshot.objects['rect-chaos-a']).toBeDefined();
    expect(finalSnapshot.objects['rect-chaos-a'].x).toBe(777);

    expect(finalSnapshot.objects['rect-chaos-b']).toBeDefined();
    expect(finalSnapshot.objects['rect-chaos-b'].y).toBe(888);

    await clientA.close();
    await clientB.close();
    await clientAReconnected.close();
  });
});
