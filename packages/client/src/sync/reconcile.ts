import { BoardState, ClientOp, SequencedOp, applySequencedOp } from '@collab/protocol';

/**
 * Reconciles confirmed server state with local pending operations.
 * Pending operations are optimistically applied on top of the confirmed state.
 */
export function computeOptimisticState(confirmed: BoardState, pendingOps: ClientOp[]): BoardState {
  let optimisticState: BoardState = {
    seq: confirmed.seq,
    objects: { ...confirmed.objects },
  };

  let virtualSeq = confirmed.seq;
  for (const op of pendingOps) {
    virtualSeq += 1;
    const fakeSequencedOp: SequencedOp = {
      seq: virtualSeq,
      boardId: '',
      serverTimestamp: Date.now(),
      op,
    };
    optimisticState = applySequencedOp(optimisticState, fakeSequencedOp);
  }

  return optimisticState;
}

/**
 * Reconciles an incoming sequenced operation with confirmed state and local pending queue.
 * If the incoming op is the server's echo of our pending op, removes it from pending.
 */
export function handleSequencedOp(
  confirmed: BoardState,
  pendingOps: ClientOp[],
  incoming: SequencedOp
): { nextConfirmed: BoardState; nextPending: ClientOp[]; isEcho: boolean } {
  const nextConfirmed = applySequencedOp(confirmed, incoming);

  const echoIndex = pendingOps.findIndex((p) => p.clientOpId === incoming.op.clientOpId);
  const isEcho = echoIndex !== -1;

  let nextPending: ClientOp[];
  if (isEcho) {
    nextPending = [...pendingOps.slice(0, echoIndex), ...pendingOps.slice(echoIndex + 1)];
  } else {
    nextPending = pendingOps;
  }

  return {
    nextConfirmed,
    nextPending,
    isEcho,
  };
}
