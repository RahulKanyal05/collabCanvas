import { Redis } from 'ioredis';
import { ClientOp, SequencedOp } from '@collab/protocol';
import { LuaSequencer } from './lua.js';
import { SnapshotManager } from './snapshot.js';
import { config } from '../config.js';
import { opsTotal } from '../metrics.js';

export class Sequencer {
  private lua: LuaSequencer;
  private snapshotManager: SnapshotManager;

  constructor(private redis: Redis) {
    this.lua = new LuaSequencer(redis);
    this.snapshotManager = new SnapshotManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.init();
  }

  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  /**
   * Atomically sequences an op via Lua script:
   * (a) INCR board:{id}:seq
   * (b) XADD board:{id}:ops with seq + op
   * (c) PUBLISH board:{id}:ops with sequenced op
   */
  async sequenceOp(boardId: string, op: ClientOp): Promise<SequencedOp> {
    const now = Date.now();
    const { seq, payload } = await this.lua.execute(boardId, JSON.stringify(op), now);
    opsTotal.inc({ op_type: op.type });

    if (seq % config.compactionIntervalOps === 0) {
      // Trigger compaction in background without blocking current op response
      this.snapshotManager.tryCompact(boardId, config.instanceId).catch(() => {});
    }

    return JSON.parse(payload) as SequencedOp;
  }

  /**
   * Retrieves all sequenced operations strictly after lastSeq.
   * If the stream has been trimmed past lastSeq + 1, returns null,
   * indicating that a full snapshot must be sent.
   */
  async getOpsSince(boardId: string, lastSeq: number): Promise<SequencedOp[] | null> {
    const streamKey = `board:${boardId}:ops`;
    const entries = await this.redis.xrange(streamKey, '-', '+');

    if (entries.length === 0) {
      // Stream is empty; check if lastSeq matches current board seq
      const currentSeqStr = await this.redis.get(`board:${boardId}:seq`);
      const currentSeq = currentSeqStr ? parseInt(currentSeqStr, 10) : 0;
      if (lastSeq >= currentSeq) {
        return [];
      }
      // If currentSeq > lastSeq but stream is empty, it was compacted
      return null;
    }

    const firstEntrySeqIdx = entries[0][1].indexOf('seq');
    const firstSeq = firstEntrySeqIdx !== -1 ? parseInt(entries[0][1][firstEntrySeqIdx + 1], 10) : 0;

    // If the earliest retained stream entry has seq > lastSeq + 1,
    // we have a gap from compaction.
    if (firstSeq > lastSeq + 1) {
      return null;
    }

    const ops: SequencedOp[] = [];
    for (const [, fields] of entries) {
      const payloadIdx = fields.indexOf('payload');
      if (payloadIdx !== -1 && payloadIdx + 1 < fields.length) {
        try {
          const sequencedOp = JSON.parse(fields[payloadIdx + 1]) as SequencedOp;
          if (sequencedOp.seq > lastSeq) {
            ops.push(sequencedOp);
          }
        } catch {
          // ignore
        }
      }
    }

    return ops;
  }
}
