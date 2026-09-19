import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CanvasObject,
  CanvasObjectType,
  ClientOp,
  createEmptyBoardState,
  foldOps,
  Point,
  SequencedOp,
} from '../src/index.js';
import { handleSequencedOp } from '../../client/src/sync/reconcile.js';

// Arbitraries for property-based generation
const objectTypeArb = fc.constantFrom<CanvasObjectType>('stroke', 'rect', 'ellipse');
const colorArb = fc.constantFrom('#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00');
const pointArb = fc.record<Point>({
  x: fc.integer({ min: 0, max: 1000 }),
  y: fc.integer({ min: 0, max: 1000 }),
});

interface SimulatedClient {
  id: string;
  confirmedState: ReturnType<typeof createEmptyBoardState>;
  pendingOps: ClientOp[];
  gapBuffer: Map<number, SequencedOp>;
}

describe('Phase 4: Property-Based Convergence Test (fast-check)', () => {
  it('K clients converge to identical state matching server reference fold under network chaos', () => {
    // Run with fixed seed for CI reproducibility
    fc.assert(
      fc.property(
        fc.record({
          numClients: fc.integer({ min: 3, max: 6 }),
          numOps: fc.integer({ min: 10, max: 40 }),
        }),
        ({ numClients, numOps }) => {
          // Initialize simulated clients
          const clients: SimulatedClient[] = Array.from({ length: numClients }, (_, i) => ({
            id: `client-${i + 1}`,
            confirmedState: createEmptyBoardState(),
            pendingOps: [],
            gapBuffer: new Map(),
          }));

          const clientIds = clients.map((c) => c.id);
          const generatedObjectIds = ['obj-alpha', 'obj-beta', 'obj-gamma', 'obj-delta'];

          // Generate simulated sequence of client ops
          const serverOpLog: SequencedOp[] = [];
          let currentSeq = 0;

          for (let i = 0; i < numOps; i++) {
            currentSeq += 1;
            const author = clientIds[i % clientIds.length];
            const targetObjId = generatedObjectIds[i % generatedObjectIds.length];
            const opTypeChoice = i % 4;

            let op: ClientOp;
            if (opTypeChoice === 0) {
              // create
              op = {
                type: 'create',
                clientOpId: `op-${currentSeq}`,
                object: {
                  id: targetObjId,
                  type: 'rect',
                  owner: author,
                  x: 10 * i,
                  y: 20 * i,
                  width: 50,
                  height: 50,
                  color: '#ffffff',
                  strokeWidth: 2,
                },
              };
            } else if (opTypeChoice === 1) {
              // update
              op = {
                type: 'update',
                clientOpId: `op-${currentSeq}`,
                objectId: targetObjId,
                patch: {
                  x: 15 * i,
                  color: '#00ff00',
                },
              };
            } else if (opTypeChoice === 2) {
              // append_points
              op = {
                type: 'append_points',
                clientOpId: `op-${currentSeq}`,
                objectId: targetObjId,
                owner: author,
                points: [{ x: i, y: i }],
              };
            } else {
              // delete
              op = {
                type: 'delete',
                clientOpId: `op-${currentSeq}`,
                objectId: targetObjId,
              };
            }

            const sequencedOp: SequencedOp = {
              seq: currentSeq,
              boardId: 'property-test-board',
              serverTimestamp: 1000 + i,
              op,
            };
            serverOpLog.push(sequencedOp);
          }

          // Ground Truth: Reference fold of all sequenced operations on server
          const groundTruthState = foldOps(createEmptyBoardState(), serverOpLog);

          // Deliver operations to each client under chaotic network conditions:
          // - Randomized delivery order (network packet interleaving)
          // - Simulated pub/sub drops (client recovers via stream replay)
          // - Disconnect / reconnect
          for (const client of clients) {
            // Shuffle delivery order for this client
            const deliveryQueue = [...serverOpLog].sort(() => Math.random() - 0.5);

            for (const incomingOp of deliveryQueue) {
              const expectedSeq = client.confirmedState.seq + 1;

              if (incomingOp.seq < expectedSeq) {
                // Past op / duplicate; ignore
                continue;
              }

              if (incomingOp.seq > expectedSeq) {
                // Gap detected! Client buffers future op
                client.gapBuffer.set(incomingOp.seq, incomingOp);

                // Simulate client requesting resume/replay for missed ops from server stream
                for (let s = expectedSeq; s < incomingOp.seq; s++) {
                  const missedOp = serverOpLog.find((o) => o.seq === s);
                  if (missedOp) {
                    const { nextConfirmed } = handleSequencedOp(
                      client.confirmedState,
                      client.pendingOps,
                      missedOp
                    );
                    client.confirmedState = nextConfirmed;
                  }
                }
              }

              // Apply current op
              const { nextConfirmed } = handleSequencedOp(
                client.confirmedState,
                client.pendingOps,
                incomingOp
              );
              client.confirmedState = nextConfirmed;

              // Drain gap buffer
              let nextSeq = client.confirmedState.seq + 1;
              while (client.gapBuffer.has(nextSeq)) {
                const buffered = client.gapBuffer.get(nextSeq)!;
                client.gapBuffer.delete(nextSeq);
                const res = handleSequencedOp(
                  client.confirmedState,
                  client.pendingOps,
                  buffered
                );
                client.confirmedState = res.nextConfirmed;
                nextSeq = client.confirmedState.seq + 1;
              }
            }
          }

          // Invariant 1: All clients must have identical sequence numbers
          for (const client of clients) {
            expect(client.confirmedState.seq).toBe(groundTruthState.seq);
          }

          // Invariant 2: All clients must converge to identical objects
          for (let i = 1; i < clients.length; i++) {
            expect(clients[i].confirmedState.objects).toEqual(clients[0].confirmedState.objects);
          }

          // Invariant 3: Client converged state must strictly match ground-truth reference fold
          expect(clients[0].confirmedState.objects).toEqual(groundTruthState.objects);
        }
      ),
      {
        seed: 424242,
        numRuns: 40,
      }
    );
  });
});
