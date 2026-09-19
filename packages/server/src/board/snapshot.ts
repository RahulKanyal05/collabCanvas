import { Redis } from 'ioredis';
import { BoardState, createEmptyBoardState, applySequencedOp, SequencedOp } from '@collab/protocol';

export interface StoredSnapshot {
  seq: number;
  objects: BoardState['objects'];
}

export class SnapshotManager {
  constructor(private redis: Redis) {}

  /**
   * Builds the current board snapshot by loading the saved snapshot from Redis
   * and folding all stream tail entries that occurred after that snapshot.
   */
  async getLatestSnapshot(boardId: string): Promise<BoardState> {
    const snapshotKey = `board:${boardId}:snapshot`;
    const streamKey = `board:${boardId}:ops`;

    let state: BoardState = createEmptyBoardState();

    const rawSnapshot = await this.redis.get(snapshotKey);
    if (rawSnapshot) {
      try {
        const parsed = JSON.parse(rawSnapshot) as StoredSnapshot;
        state = {
          seq: parsed.seq,
          objects: parsed.objects,
        };
      } catch {
        state = createEmptyBoardState();
      }
    }

    // Read all ops in stream
    const entries = await this.redis.xrange(streamKey, '-', '+');
    for (const [streamId, fields] of entries) {
      const payloadIndex = fields.indexOf('payload');
      if (payloadIndex !== -1 && payloadIndex + 1 < fields.length) {
        try {
          const sequencedOp = JSON.parse(fields[payloadIndex + 1]) as SequencedOp;
          if (sequencedOp.seq > state.seq) {
            state = applySequencedOp(state, sequencedOp);
          }
        } catch {
          // Ignore corrupt entry
        }
      }
    }

    return state;
  }

  /**
   * Attempts to acquire distributed lock and compact the board stream.
   * Compaction folds all unapplied operations into board:{boardId}:snapshot
   * and trims stream entries older than the snapshot.
   */
  async tryCompact(boardId: string, instanceId: string): Promise<boolean> {
    const lockKey = `board:${boardId}:snapshot_lock`;
    const snapshotKey = `board:${boardId}:snapshot`;
    const streamKey = `board:${boardId}:ops`;

    // Acquire lock for 5 seconds
    const acquired = await this.redis.set(lockKey, instanceId, 'PX', 5000, 'NX');
    if (!acquired) {
      return false;
    }

    try {
      const latestState = await this.getLatestSnapshot(boardId);
      const snapshotPayload: StoredSnapshot = {
        seq: latestState.seq,
        objects: latestState.objects,
      };

      await this.redis.set(snapshotKey, JSON.stringify(snapshotPayload));

      // Trim stream: find entry matching latestState.seq or trim entries older than that entry
      const entries = await this.redis.xrange(streamKey, '-', '+');
      const entryIdsToDelete: string[] = [];

      for (const [id, fields] of entries) {
        const seqIdx = fields.indexOf('seq');
        if (seqIdx !== -1 && seqIdx + 1 < fields.length) {
          const entrySeq = parseInt(fields[seqIdx + 1], 10);
          if (entrySeq < latestState.seq) {
            entryIdsToDelete.push(id);
          }
        }
      }

      if (entryIdsToDelete.length > 0) {
        await this.redis.xdel(streamKey, ...entryIdsToDelete);
      }

      return true;
    } finally {
      // Release lock safely
      const unlockScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(unlockScript, 1, lockKey, instanceId);
    }
  }
}
