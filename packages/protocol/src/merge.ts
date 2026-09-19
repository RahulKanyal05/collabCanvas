import { BoardState, CanvasObject, SequencedOp, ClientOp } from './types.js';

export function createEmptyBoardState(): BoardState {
  return {
    seq: 0,
    objects: {},
  };
}

/**
 * Pure state reducer applying a sequenced operation to a board state according to:
 * 1. Strict sequence ordering: Higher seq wins per field (LWW).
 * 2. Tombstone semantics: Deleted objects cannot be updated or appended to.
 * 3. Idempotent create: Re-creating an existing object ID is ignored.
 * 4. Stroke append-only: Only the original owner can append points to a stroke.
 */
export function applySequencedOp(state: BoardState, sequencedOp: SequencedOp): BoardState {
  const { seq, op } = sequencedOp;
  const nextObjects = { ...state.objects };

  switch (op.type) {
    case 'create': {
      const { object } = op;
      // Idempotency: if object already exists, ignore create
      if (nextObjects[object.id]) {
        break;
      }
      const initialFieldSeqs: Record<string, number> = {
        id: seq,
        type: seq,
        owner: seq,
        x: seq,
        y: seq,
        width: seq,
        height: seq,
        color: seq,
        strokeWidth: seq,
        points: seq,
        text: seq,
        fontSize: seq,
        fillColor: seq,
        deleted: seq,
      };

      nextObjects[object.id] = {
        ...object,
        deleted: false,
        fieldSeqs: initialFieldSeqs,
        points: object.points ? [...object.points] : undefined,
      };
      break;
    }

    case 'delete': {
      const { objectId } = op;
      const target = nextObjects[objectId];
      if (target) {
        // If already deleted at a higher or equal seq, do not downgrade seq
        if (target.deleted && (target.fieldSeqs.deleted ?? 0) >= seq) {
          break;
        }
        nextObjects[objectId] = {
          ...target,
          deleted: true,
          fieldSeqs: {
            ...target.fieldSeqs,
            deleted: seq,
          },
        };
      } else {
        // Tombstone for an object that hasn't been created or was pruned
        nextObjects[objectId] = {
          id: objectId,
          type: 'stroke',
          owner: 'unknown',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color: '#000000',
          strokeWidth: 1,
          deleted: true,
          fieldSeqs: {
            deleted: seq,
          },
        };
      }
      break;
    }

    case 'update': {
      const { objectId, patch } = op;
      const target = nextObjects[objectId];
      // Tombstoned or non-existent objects reject updates
      if (!target || target.deleted) {
        break;
      }

      const updatedTarget: CanvasObject = {
        ...target,
        fieldSeqs: { ...target.fieldSeqs },
      };

      let changed = false;
      const allowedKeys = [
        'x',
        'y',
        'width',
        'height',
        'color',
        'strokeWidth',
        'text',
        'fontSize',
        'fillColor',
      ] as const;

      for (const key of allowedKeys) {
        if (patch[key] !== undefined) {
          const currentFieldSeq = target.fieldSeqs[key] ?? 0;
          if (seq > currentFieldSeq) {
            // Per-field higher seq wins
            (updatedTarget as any)[key] = patch[key];
            updatedTarget.fieldSeqs[key] = seq;
            changed = true;
          }
        }
      }

      if (changed) {
        nextObjects[objectId] = updatedTarget;
      }
      break;
    }

    case 'append_points': {
      const { objectId, points, owner } = op;
      const target = nextObjects[objectId];
      // Must exist, not deleted, must be stroke, and author must match
      if (!target || target.deleted || target.type !== 'stroke' || target.owner !== owner) {
        break;
      }

      const currentPointsSeq = target.fieldSeqs.points ?? 0;
      if (seq > currentPointsSeq) {
        nextObjects[objectId] = {
          ...target,
          points: [...(target.points || []), ...points],
          fieldSeqs: {
            ...target.fieldSeqs,
            points: seq,
          },
        };
      }
      break;
    }
  }

  return {
    seq: Math.max(state.seq, seq),
    objects: nextObjects,
  };
}

/**
 * Replays a list of ordered sequenced operations onto an initial state.
 */
export function foldOps(initialState: BoardState, ops: SequencedOp[]): BoardState {
  return ops.reduce((state, op) => applySequencedOp(state, op), initialState);
}
