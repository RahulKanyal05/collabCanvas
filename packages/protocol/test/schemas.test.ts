import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  CreateOpSchema,
  UpdateOpSchema,
  DeleteOpSchema,
} from '../src/schemas.js';

describe('Protocol Schemas', () => {
  it('validates join message', () => {
    const valid = {
      type: 'join',
      boardId: 'test-board',
      clientName: 'Alice',
      clientColor: '#ff0000',
    };
    expect(ClientMessageSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      type: 'join',
      boardId: '',
    };
    expect(ClientMessageSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates create op and client op message', () => {
    const validCreate = {
      type: 'op',
      boardId: 'b1',
      op: {
        type: 'create',
        clientOpId: 'op-1',
        object: {
          id: 'obj-1',
          type: 'rect',
          owner: 'user-1',
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          color: '#3b82f6',
          strokeWidth: 2,
        },
      },
    };
    expect(ClientMessageSchema.safeParse(validCreate).success).toBe(true);
  });

  it('validates update op with partial fields', () => {
    const validUpdate = {
      type: 'update',
      clientOpId: 'op-2',
      objectId: 'obj-1',
      patch: {
        x: 50,
        color: '#10b981',
      },
    };
    expect(UpdateOpSchema.safeParse(validUpdate).success).toBe(true);
  });

  it('validates server snapshot message', () => {
    const validSnapshot = {
      type: 'snapshot',
      boardId: 'b1',
      seq: 10,
      objects: {
        'obj-1': {
          id: 'obj-1',
          type: 'stroke',
          owner: 'user-1',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          color: '#ffffff',
          strokeWidth: 3,
          points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
          deleted: false,
          fieldSeqs: { x: 1, y: 1, points: 2 },
        },
      },
    };
    expect(ServerMessageSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('rejects invalid message type', () => {
    const invalid = {
      type: 'unknown_type',
      data: 123,
    };
    expect(ClientMessageSchema.safeParse(invalid).success).toBe(false);
    expect(ServerMessageSchema.safeParse(invalid).success).toBe(false);
  });
});
