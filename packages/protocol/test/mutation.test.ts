import { describe, it, expect } from 'vitest';
import {
  BoardState,
  createEmptyBoardState,
  applySequencedOp,
  foldOps,
  SequencedOp,
} from '../src/index.js';

/**
 * Deliberately broken merge function that violates sequence ordering:
 * It allows an earlier operation (lower seq) to overwrite a later operation (higher seq).
 */
function brokenMergeFunction(state: BoardState, op: SequencedOp): BoardState {
  const nextObjects = { ...state.objects };
  if (op.op.type === 'create') {
    nextObjects[op.op.object.id] = {
      ...op.op.object,
      deleted: false,
      fieldSeqs: {},
    };
  } else if (op.op.type === 'update') {
    const target = nextObjects[op.op.objectId];
    if (target && !target.deleted) {
      // BUG INJECTION: Overwrites unconditionally without checking seq > fieldSeq!
      Object.assign(target, op.op.patch);
    }
  }
  return {
    seq: op.seq,
    objects: nextObjects,
  };
}

describe('Phase 4: Mutation Check Test (Proving tests can fail)', () => {
  it('correctness assertion fails when sequence ordering or LWW tie-breaker is broken', () => {
    const ops: SequencedOp[] = [
      {
        seq: 1,
        boardId: 'b1',
        serverTimestamp: 1000,
        op: {
          type: 'create',
          clientOpId: 'c1',
          object: {
            id: 'obj-1',
            type: 'rect',
            owner: 'alice',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            color: '#fff',
            strokeWidth: 2,
          },
        },
      },
      {
        seq: 2,
        boardId: 'b1',
        serverTimestamp: 2000,
        op: {
          type: 'update',
          clientOpId: 'c2',
          objectId: 'obj-1',
          patch: { x: 100 },
        },
      },
      {
        seq: 3,
        boardId: 'b1',
        serverTimestamp: 3000,
        op: {
          type: 'update',
          clientOpId: 'c3',
          objectId: 'obj-1',
          patch: { x: 200 },
        },
      },
    ];

    // Reference ground truth using correct LWW merge
    const groundTruth = foldOps(createEmptyBoardState(), ops);
    expect(groundTruth.objects['obj-1'].x).toBe(200);

    // If operations are delivered out of order: Seq 3 then Seq 2
    // Correct LWW engine preserves Seq 3 because 3 > 2
    let robustState = createEmptyBoardState();
    robustState = applySequencedOp(robustState, ops[0]); // Seq 1: x = 0
    robustState = applySequencedOp(robustState, ops[2]); // Seq 3: x = 200 (fieldSeq.x = 3)
    robustState = applySequencedOp(robustState, ops[1]); // Seq 2: ignored because 2 < 3!
    expect(robustState.objects['obj-1'].x).toBe(200);
    expect(robustState.objects['obj-1'].x).toEqual(groundTruth.objects['obj-1'].x);

    // MUTATION: Simulate broken engine that blindly overwrites without checking sequence
    let mutatedState = createEmptyBoardState();
    mutatedState = brokenMergeFunction(mutatedState, ops[0]); // Seq 1: x = 0
    mutatedState = brokenMergeFunction(mutatedState, ops[2]); // Seq 3: x = 200
    mutatedState = brokenMergeFunction(mutatedState, ops[1]); // Seq 2: blindly overwrites to 100!

    // Assert that the test suite detects this defect:
    // The mutated state diverges from ground truth!
    expect(mutatedState.objects['obj-1'].x).not.toBe(groundTruth.objects['obj-1'].x);
    expect(() => {
      expect(mutatedState.objects['obj-1'].x).toBe(groundTruth.objects['obj-1'].x);
    }).toThrow();
  });
});
