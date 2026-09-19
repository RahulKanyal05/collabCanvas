import { z } from 'zod';

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const CanvasObjectTypeSchema = z.enum(['stroke', 'rect', 'ellipse']);

export const CanvasObjectSchema = z.object({
  id: z.string().min(1).max(64),
  type: CanvasObjectTypeSchema,
  owner: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string().min(1).max(32),
  strokeWidth: z.number().min(0.5).max(100),
  points: z.array(PointSchema).optional(),
  deleted: z.boolean(),
  fieldSeqs: z.record(z.string(), z.number()),
});

export const InitialCanvasObjectSchema = CanvasObjectSchema.omit({
  deleted: true,
  fieldSeqs: true,
});

export const CreateOpSchema = z.object({
  type: z.literal('create'),
  clientOpId: z.string().min(1).max(64),
  object: InitialCanvasObjectSchema,
});

export const AppendPointsOpSchema = z.object({
  type: z.literal('append_points'),
  clientOpId: z.string().min(1).max(64),
  objectId: z.string().min(1).max(64),
  points: z.array(PointSchema).min(1).max(1000),
  owner: z.string().min(1).max(64),
});

export const UpdateOpSchema = z.object({
  type: z.literal('update'),
  clientOpId: z.string().min(1).max(64),
  objectId: z.string().min(1).max(64),
  patch: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    color: z.string().min(1).max(32).optional(),
    strokeWidth: z.number().min(0.5).max(100).optional(),
  }),
});

export const DeleteOpSchema = z.object({
  type: z.literal('delete'),
  clientOpId: z.string().min(1).max(64),
  objectId: z.string().min(1).max(64),
});

export const ClientOpSchema = z.discriminatedUnion('type', [
  CreateOpSchema,
  AppendPointsOpSchema,
  UpdateOpSchema,
  DeleteOpSchema,
]);

export const SequencedOpSchema = z.object({
  seq: z.number().int().nonnegative(),
  boardId: z.string().min(1).max(64),
  op: ClientOpSchema,
  serverTimestamp: z.number(),
});

// Inbound Client Messages
export const JoinMessageSchema = z.object({
  type: z.literal('join'),
  boardId: z.string().min(1).max(64),
  clientName: z.string().min(1).max(32),
  clientColor: z.string().min(1).max(32),
});

export const OpMessageSchema = z.object({
  type: z.literal('op'),
  boardId: z.string().min(1).max(64),
  op: ClientOpSchema,
});

export const ResumeMessageSchema = z.object({
  type: z.literal('resume'),
  boardId: z.string().min(1).max(64),
  lastSeq: z.number().int().nonnegative(),
});

export const CursorMessageSchema = z.object({
  type: z.literal('cursor'),
  boardId: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  OpMessageSchema,
  ResumeMessageSchema,
  CursorMessageSchema,
  PongMessageSchema,
]);

// Outbound Server Messages
export const JoinedMessageSchema = z.object({
  type: z.literal('joined'),
  boardId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64),
  maxUsers: z.number().int().positive(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  boardId: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  objects: z.record(z.string(), CanvasObjectSchema),
});

export const SequencedOpMessageSchema = z.object({
  type: z.literal('op'),
  boardId: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  op: ClientOpSchema,
  serverTimestamp: z.number(),
});

export const ResumedMessageSchema = z.object({
  type: z.literal('resumed'),
  boardId: z.string().min(1).max(64),
  ops: z.array(SequencedOpSchema),
});

export const CursorBroadcastMessageSchema = z.object({
  type: z.literal('cursor'),
  boardId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64),
  name: z.string(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
});

export const UserPresenceSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  color: z.string(),
});

export const PresenceMessageSchema = z.object({
  type: z.literal('presence'),
  boardId: z.string().min(1).max(64),
  users: z.array(UserPresenceSchema),
});

export const ErrorCodeSchema = z.enum([
  'BOARD_FULL',
  'INVALID_MESSAGE',
  'RATE_LIMITED',
  'STREAM_TRIMMED',
  'NOT_JOINED',
  'INTERNAL_ERROR',
]);

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: ErrorCodeSchema,
  message: z.string(),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  JoinedMessageSchema,
  SnapshotMessageSchema,
  SequencedOpMessageSchema,
  ResumedMessageSchema,
  CursorBroadcastMessageSchema,
  PresenceMessageSchema,
  ErrorMessageSchema,
  PingMessageSchema,
]);
