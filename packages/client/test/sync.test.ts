import { describe, it, expect } from 'vitest';
import {
  computeOptimisticState,
  handleSequencedOp,
  ClientSyncEngine,
} from '../src/sync/index.js';
import {
  createEmptyBoardState,
  SequencedOp,
  ClientOp,
  SnapshotMessage,
  ResumedMessage,
} from '@collab/protocol';

describe('Client Sync Engine & Reconciliation', () => {
  it('optimistically applies pending ops on top of confirmed state', () => {
    const confirmed = createEmptyBoardState();
    const pendingCreate: ClientOp = {
      type: 'create',
      clientOpId: 'client-op-1',
      object: {
        id: 'rect-1',
        type: 'rect',
        owner: 'me',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: '#ff0000',
        strokeWidth: 2,
      },
    };

    const optimistic = computeOptimisticState(confirmed, [pendingCreate]);
    expect(optimistic.objects['rect-1']).toBeDefined();
    expect(optimistic.objects['rect-1'].x).toBe(10);
    expect(confirmed.objects['rect-1']).toBeUndefined(); // Confirmed state remains untouched
  });

  it('removes pending op upon receiving its sequenced echo from server', () => {
    const confirmed = createEmptyBoardState();
    const pendingOp: ClientOp = {
      type: 'create',
      clientOpId: 'client-op-1',
      object: {
        id: 'rect-1',
        type: 'rect',
        owner: 'me',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: '#ff0000',
        strokeWidth: 2,
      },
    };

    const incomingEcho: SequencedOp = {
      seq: 1,
      boardId: 'b1',
      serverTimestamp: 1000,
      op: pendingOp,
    };

    const { nextConfirmed, nextPending, isEcho } = handleSequencedOp(
      confirmed,
      [pendingOp],
      incomingEcho
    );

    expect(isEcho).toBe(true);
    expect(nextPending.length).toBe(0); // Cleared from pending
    expect(nextConfirmed.objects['rect-1']).toBeDefined();
    expect(nextConfirmed.seq).toBe(1);
  });

  it('handles remote ops while preserving in-flight pending ops', () => {
    // We have rect-1 in confirmed at (10, 20)
    let confirmed = createEmptyBoardState();
    confirmed = {
      seq: 1,
      objects: {
        'rect-1': {
          id: 'rect-1',
          type: 'rect',
          owner: 'me',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          color: '#ff0000',
          strokeWidth: 2,
          deleted: false,
          fieldSeqs: { x: 1, y: 1, color: 1 },
        },
      },
    };

    // We have pending op to move to x: 50
    const pendingMove: ClientOp = {
      type: 'update',
      clientOpId: 'my-move',
      objectId: 'rect-1',
      patch: { x: 50 },
    };

    // Remote op arrives: another user changed color to green (#00ff00) at seq: 2
    const remoteColorChange: SequencedOp = {
      seq: 2,
      boardId: 'b1',
      serverTimestamp: 2000,
      op: {
        type: 'update',
        clientOpId: 'remote-op',
        objectId: 'rect-1',
        patch: { color: '#00ff00' },
      },
    };

    const { nextConfirmed, nextPending, isEcho } = handleSequencedOp(
      confirmed,
      [pendingMove],
      remoteColorChange
    );

    expect(isEcho).toBe(false);
    expect(nextPending.length).toBe(1); // My move is still pending!
    expect(nextConfirmed.objects['rect-1'].color).toBe('#00ff00'); // Confirmed color updated

    // In optimistic view, both the remote color change AND my local move are visible!
    const view = computeOptimisticState(nextConfirmed, nextPending);
    expect(view.objects['rect-1'].color).toBe('#00ff00');
    expect(view.objects['rect-1'].x).toBe(50);
  });

  it('detects gap in sequence numbers, buffers, requests resume, and recovers', () => {
    // Mock WebSocket implementation
    const sentMessages: string[] = [];
    class MockWS {
      readyState = 1;
      onopen: any = null;
      onmessage: any = null;
      onclose: any = null;
      onerror: any = null;

      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }

      send(data: string) {
        sentMessages.push(data);
      }

      close() {}
    }

    const engine = new ClientSyncEngine({
      wsUrl: 'ws://mock',
      boardId: 'b1',
      clientName: 'Alice',
      clientColor: '#ff0000',
      WebSocketClass: MockWS,
    });

    let currentState = engine.getViewState();
    engine.subscribeState((s) => {
      currentState = s;
    });

    engine.connect();

    // Simulate join confirmation from server
    (engine as any).handleMessage(
      JSON.stringify({
        type: 'joined',
        boardId: 'b1',
        clientId: 'alice-id',
        maxUsers: 50,
      })
    );

    // Simulate snapshot: seq = 1 with a rect
    const snapshotMsg: SnapshotMessage = {
      type: 'snapshot',
      boardId: 'b1',
      seq: 1,
      objects: {
        'rect-1': {
          id: 'rect-1',
          type: 'rect',
          owner: 'alice-id',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: '#fff',
          strokeWidth: 1,
          deleted: false,
          fieldSeqs: { x: 1, y: 1 },
        },
      },
    };
    (engine as any).handleMessage(JSON.stringify(snapshotMsg));

    expect(currentState.seq).toBe(1);
    expect(currentState.objects['rect-1']).toBeDefined();

    // Now simulate an out-of-order op seq: 3 arriving (gap! missed seq 2)
    const gapOp: SequencedOp = {
      seq: 3,
      boardId: 'b1',
      serverTimestamp: 3000,
      op: {
        type: 'update',
        clientOpId: 'op-3',
        objectId: 'rect-1',
        patch: { x: 30 },
      },
    };
    (engine as any).handleMessage(
      JSON.stringify({
        type: 'op',
        ...gapOp,
      })
    );

    // State should NOT have applied seq 3 yet because seq 2 was missing!
    expect(currentState.seq).toBe(1);
    expect(currentState.objects['rect-1'].x).toBe(0);

    // Verify engine sent a resume request for lastSeq: 1
    const lastSent = JSON.parse(sentMessages[sentMessages.length - 1]);
    expect(lastSent.type).toBe('resume');
    expect(lastSent.lastSeq).toBe(1);

    // Simulate server response: resumed with missed op seq 2
    const resumedMsg: ResumedMessage = {
      type: 'resumed',
      boardId: 'b1',
      ops: [
        {
          seq: 2,
          boardId: 'b1',
          serverTimestamp: 2000,
          op: {
            type: 'update',
            clientOpId: 'op-2',
            objectId: 'rect-1',
            patch: { y: 20 },
          },
        },
      ],
    };
    (engine as any).handleMessage(JSON.stringify(resumedMsg));

    // Both seq 2 (from resumed) AND buffered seq 3 should now be applied!
    expect(currentState.seq).toBe(3);
    expect(currentState.objects['rect-1'].y).toBe(20);
    expect(currentState.objects['rect-1'].x).toBe(30);

    engine.disconnect();
  });
});
