import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { Sequencer } from '../src/board/sequencer.js';

describe('Sequencer & SnapshotManager', () => {
  let redis: Redis;
  let sequencer: Sequencer;
  const boardId = 'test-board-sequencer';

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await redis.connect();
    sequencer = new Sequencer(redis);
    await sequencer.init();
    // Clean up test board keys
    await redis.del(
      `board:${boardId}:seq`,
      `board:${boardId}:ops`,
      `board:${boardId}:snapshot`,
      `board:${boardId}:snapshot_lock`
    );
  });

  afterAll(async () => {
    await redis.del(
      `board:${boardId}:seq`,
      `board:${boardId}:ops`,
      `board:${boardId}:snapshot`,
      `board:${boardId}:snapshot_lock`
    );
    redis.disconnect();
  });

  it('atomically assigns strictly incrementing sequence numbers', async () => {
    const op1 = await sequencer.sequenceOp(boardId, {
      type: 'create',
      clientOpId: 'c1',
      object: {
        id: 'rect-seq-1',
        type: 'rect',
        owner: 'user-1',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        color: '#ff0000',
        strokeWidth: 2,
      },
    });

    const op2 = await sequencer.sequenceOp(boardId, {
      type: 'update',
      clientOpId: 'c2',
      objectId: 'rect-seq-1',
      patch: { x: 50 },
    });

    expect(op1.seq).toBe(1);
    expect(op2.seq).toBe(2);
    expect(op2.seq).toBeGreaterThan(op1.seq);
  });

  it('fetches ops since lastSeq accurately from stream', async () => {
    const ops = await sequencer.getOpsSince(boardId, 1);
    expect(ops).not.toBeNull();
    expect(ops?.length).toBe(1);
    expect(ops![0].seq).toBe(2);
  });

  it('compacts stream into snapshot and trims earlier stream entries', async () => {
    const snapshotManager = sequencer.getSnapshotManager();
    const compacted = await snapshotManager.tryCompact(boardId, 'test-instance');
    expect(compacted).toBe(true);

    const snapshot = await snapshotManager.getLatestSnapshot(boardId);
    expect(snapshot.seq).toBe(2);
    expect(snapshot.objects['rect-seq-1']).toBeDefined();
    expect(snapshot.objects['rect-seq-1'].x).toBe(50);
  });
});
