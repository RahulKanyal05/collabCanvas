import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, ServerInstance } from '../src/server.js';
import {
  ClientMessage,
  ServerMessage,
  JoinedMessage,
  SequencedOpMessage,
  SnapshotMessage,
} from '@collab/protocol';

describe('Multi-Instance Synchronization and Failover', () => {
  let instance1: ServerInstance;
  let instance2: ServerInstance;
  const port1 = 4911;
  const port2 = 4912;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  beforeAll(async () => {
    instance1 = await createServer({
      port: port1,
      redisUrl,
      instanceId: 'inst-test-1',
      heartbeatIntervalMs: 60000,
    });
    await instance1.app.listen({ port: port1, host: '127.0.0.1' });

    instance2 = await createServer({
      port: port2,
      redisUrl,
      instanceId: 'inst-test-2',
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

    const waitFor = (predicate: (msg: ServerMessage) => boolean, timeoutMs = 6000): Promise<ServerMessage> => {
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
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.on('close', () => resolve());
        ws.close();
      });
    };

    return { ws, messages, send, waitFor, close };
  }

  it('clients connected to different server instances converge across Redis pub/sub', async () => {
    const boardId = 'cross-instance-convergence';
    const clientA = createTestClient(port1); // connected to instance 1
    const clientB = createTestClient(port2); // connected to instance 2

    await new Promise((r) => clientA.ws.on('open', r));
    await new Promise((r) => clientB.ws.on('open', r));

    // Client A joins instance 1
    clientA.send({
      type: 'join',
      boardId,
      clientName: 'Alice',
      clientColor: '#ff0000',
    });
    const aJoined = (await clientA.waitFor((m) => m.type === 'joined')) as JoinedMessage;

    // Client B joins instance 2
    clientB.send({
      type: 'join',
      boardId,
      clientName: 'Bob',
      clientColor: '#00ff00',
    });
    const bJoined = (await clientB.waitFor((m) => m.type === 'joined')) as JoinedMessage;

    // Client A creates rect on instance 1
    clientA.send({
      type: 'op',
      boardId,
      op: {
        type: 'create',
        clientOpId: 'op-a-1',
        object: {
          id: 'multi-rect-1',
          type: 'rect',
          owner: aJoined.clientId,
          x: 10,
          y: 20,
          width: 80,
          height: 40,
          color: '#ff0000',
          strokeWidth: 2,
        },
      },
    });

    // Client B should receive op on instance 2 via Redis Pub/Sub
    const bReceivedOp1 = (await clientB.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'op-a-1'
    )) as SequencedOpMessage;

    expect(bReceivedOp1.seq).toBeGreaterThan(0);

    // Client B updates rect on instance 2
    clientB.send({
      type: 'op',
      boardId,
      op: {
        type: 'update',
        clientOpId: 'op-b-1',
        objectId: 'multi-rect-1',
        patch: { x: 75, color: '#00ff00' },
      },
    });

    // Client A should receive op on instance 1 via Redis Pub/Sub
    const aReceivedOp2 = (await clientA.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'op-b-1'
    )) as SequencedOpMessage;

    expect(aReceivedOp2.seq).toBeGreaterThan(bReceivedOp1.seq);

    await clientA.close();
    await clientB.close();
  });

  it('killing one instance causes clients to reconnect to the other without lost ops', async () => {
    const boardId = 'failover-test-board';

    // Start a dedicated third instance to kill so instance 2 stays alive
    const killPort = 4913;
    const instanceToKill = await createServer({
      port: killPort,
      redisUrl,
      instanceId: 'inst-to-kill',
      heartbeatIntervalMs: 60000,
    });
    await instanceToKill.app.listen({ port: killPort, host: '127.0.0.1' });

    // Client connects to instanceToKill
    let client = createTestClient(killPort);
    await new Promise((r) => client.ws.on('open', r));

    client.send({
      type: 'join',
      boardId,
      clientName: 'Charlie',
      clientColor: '#3b82f6',
    });
    const joined = (await client.waitFor((m) => m.type === 'joined')) as JoinedMessage;

    // Send Op 1
    client.send({
      type: 'op',
      boardId,
      op: {
        type: 'create',
        clientOpId: 'failover-op-1',
        object: {
          id: 'failover-rect-1',
          type: 'rect',
          owner: joined.clientId,
          x: 10,
          y: 20,
          width: 50,
          height: 50,
          color: '#ffffff',
          strokeWidth: 2,
        },
      },
    });

    const op1 = (await client.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'failover-op-1'
    )) as SequencedOpMessage;
    const lastConfirmedSeq = op1.seq;

    // Abruptly kill instanceToKill (simulating instance failure / restart)
    const closePromise = new Promise<number>((resolve) => {
      client.ws.on('close', (code) => {
        resolve(code);
      });
    });
    await instanceToKill.close();
    const receivedCloseCode = await closePromise;

    // Verify graceful close code (1012 Service Restart)
    expect(receivedCloseCode).toBe(1012);

    // Client reconnects to instance2 (port2)
    const reconnectedClient = createTestClient(port2);
    await new Promise((r) => reconnectedClient.ws.on('open', r));

    reconnectedClient.send({
      type: 'join',
      boardId,
      clientName: 'Charlie',
      clientColor: '#3b82f6',
    });
    await reconnectedClient.waitFor((m) => m.type === 'joined');

    // Client requests resume from lastConfirmedSeq
    reconnectedClient.send({
      type: 'resume',
      boardId,
      lastSeq: lastConfirmedSeq,
    });

    // Or sends a fresh op on instance 2
    reconnectedClient.send({
      type: 'op',
      boardId,
      op: {
        type: 'update',
        clientOpId: 'failover-op-2',
        objectId: 'failover-rect-1',
        patch: { x: 120 },
      },
    });

    const op2 = (await reconnectedClient.waitFor(
      (m) => m.type === 'op' && (m as SequencedOpMessage).op.clientOpId === 'failover-op-2'
    )) as SequencedOpMessage;

    expect(op2.seq).toBeGreaterThan(lastConfirmedSeq);

    // Verify full board snapshot has both ops preserved!
    const snapshotManager = instance2.sequencer.getSnapshotManager();
    const finalState = await snapshotManager.getLatestSnapshot(boardId);
    expect(finalState.objects['failover-rect-1']).toBeDefined();
    expect(finalState.objects['failover-rect-1'].x).toBe(120);

    await reconnectedClient.close();
  });
});
