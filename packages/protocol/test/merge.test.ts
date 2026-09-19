import { describe, it, expect } from 'vitest';
import { createEmptyBoardState, applySequencedOp } from '../src/merge.js';
import { SequencedOp } from '../src/types.js';

describe('Merge Engine (applySequencedOp)', () => {
  it('creates an object and sets initial fieldSeqs to op seq', () => {
    const s0 = createEmptyBoardState();
    const op1: SequencedOp = {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: {
        type: 'create',
        clientOpId: 'c1',
        object: {
          id: 'rect-1',
          type: 'rect',
          owner: 'alice',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          color: '#ff0000',
          strokeWidth: 2,
        },
      },
    };

    const s1 = applySequencedOp(s0, op1);
    expect(s1.seq).toBe(1);
    expect(s1.objects['rect-1']).toBeDefined();
    expect(s1.objects['rect-1'].deleted).toBe(false);
    expect(s1.objects['rect-1'].fieldSeqs.x).toBe(1);
    expect(s1.objects['rect-1'].fieldSeqs.color).toBe(1);
  });

  it('ignores duplicate create with existing ID (idempotency)', () => {
    const s0 = createEmptyBoardState();
    const op1: SequencedOp = {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: {
        type: 'create',
        clientOpId: 'c1',
        object: {
          id: 'rect-1',
          type: 'rect',
          owner: 'alice',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          color: '#ff0000',
          strokeWidth: 2,
        },
      },
    };
    const s1 = applySequencedOp(s0, op1);

    const op2Duplicate: SequencedOp = {
      seq: 2,
      boardId: 'b1',
      serverTimestamp: 1001,
      op: {
        type: 'create',
        clientOpId: 'c2',
        object: {
          id: 'rect-1',
          type: 'rect',
          owner: 'bob',
          x: 999,
          y: 999,
          width: 999,
          height: 999,
          color: '#000000',
          strokeWidth: 10,
        },
      },
    };

    const s2 = applySequencedOp(s1, op2Duplicate);
    // State should still have alice's original object
    expect(s2.objects['rect-1'].x).toBe(10);
    expect(s2.objects['rect-1'].owner).toBe('alice');
    expect(s2.seq).toBe(2);
  });

  it('resolves concurrent updates with per-field Last-Writer-Wins (LWW)', () => {
    let s = createEmptyBoardState();
    // Seq 1: Alice creates rect at (10, 20) with red color
    s = applySequencedOp(s, {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: {
        type: 'create',
        clientOpId: 'c1',
        object: {
          id: 'rect-1',
          type: 'rect',
          owner: 'alice',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          color: '#ff0000',
          strokeWidth: 2,
        },
      },
    });

    // Seq 2: Bob moves rect to (30, 40)
    s = applySequencedOp(s, {
      seq: 2,
      boardId: 'b1',
      serverTimestamp: 1002,
      op: {
        type: 'update',
        clientOpId: 'c2',
        objectId: 'rect-1',
        patch: { x: 30, y: 40 },
      },
    });

    // Seq 3: Charlie recolors rect to green (#00ff00)
    s = applySequencedOp(s, {
      seq: 3,
      boardId: 'b1',
      serverTimestamp: 1003,
      op: {
        type: 'update',
        clientOpId: 'c3',
        objectId: 'rect-1',
        patch: { color: '#00ff00' },
      },
    });

    // Per-field result: x & y from Seq 2, color from Seq 3!
    expect(s.objects['rect-1'].x).toBe(30);
    expect(s.objects['rect-1'].y).toBe(40);
    expect(s.objects['rect-1'].color).toBe('#00ff00');
    expect(s.objects['rect-1'].fieldSeqs.x).toBe(2);
    expect(s.objects['rect-1'].fieldSeqs.color).toBe(3);
  });

  it('enforces tombstone deletion: subsequent updates and appends are ignored', () => {
    let s = createEmptyBoardState();
    s = applySequencedOp(s, {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: {
        type: 'create',
        clientOpId: 'c1',
        object: {
          id: 'stroke-1',
          type: 'stroke',
          owner: 'alice',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color: '#ffffff',
          strokeWidth: 2,
          points: [{ x: 0, y: 0 }],
        },
      },
    });

    // Seq 2: Delete stroke
    s = applySequencedOp(s, {
      seq: 2,
      boardId: 'b1',
      serverTimestamp: 1001,
      op: {
        type: 'delete',
        clientOpId: 'c2',
        objectId: 'stroke-1',
      },
    });

    expect(s.objects['stroke-1'].deleted).toBe(true);

    // Seq 3: Attempt update on deleted object
    s = applySequencedOp(s, {
      seq: 3,
      boardId: 'b1',
      serverTimestamp: 1002,
      op: {
        type: 'update',
        clientOpId: 'c3',
        objectId: 'stroke-1',
        patch: { color: '#ffff00' },
      },
    });

    // Should NOT have updated color
    expect(s.objects['stroke-1'].color).toBe('#ffffff');

    // Seq 4: Attempt append points on deleted object
    s = applySequencedOp(s, {
      seq: 4,
      boardId: 'b1',
      serverTimestamp: 1003,
      op: {
        type: 'append_points',
        clientOpId: 'c4',
        objectId: 'stroke-1',
        owner: 'alice',
        points: [{ x: 10, y: 10 }],
      },
    });

    // Points should remain only initial point
    expect(s.objects['stroke-1'].points?.length).toBe(1);
  });

  it('rejects append_points from non-owner', () => {
    let s = createEmptyBoardState();
    s = applySequencedOp(s, {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: {
        type: 'create',
        clientOpId: 'c1',
        object: {
          id: 'stroke-1',
          type: 'stroke',
          owner: 'alice',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color: '#ffffff',
          strokeWidth: 2,
          points: [{ x: 0, y: 0 }],
        },
      },
    });

    // Bob tries to append to Alice's stroke
    s = applySequencedOp(s, {
      seq: 2,
      boardId: 'b1',
      serverTimestamp: 1001,
      op: {
        type: 'append_points',
        clientOpId: 'c2',
        objectId: 'stroke-1',
        owner: 'bob',
        points: [{ x: 5, y: 5 }],
      },
    });

    // Bob's points should NOT be appended
    expect(s.objects['stroke-1'].points?.length).toBe(1);

    // Alice appends to her own stroke
    s = applySequencedOp(s, {
      seq: 3,
      boardId: 'b1',
      serverTimestamp: 1002,
      op: {
        type: 'append_points',
        clientOpId: 'c3',
        objectId: 'stroke-1',
        owner: 'alice',
        points: [{ x: 5, y: 5 }],
      },
    });

    expect(s.objects['stroke-1'].points?.length).toBe(2);
  });
});
