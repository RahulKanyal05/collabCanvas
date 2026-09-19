export interface Point {
  x: number;
  y: number;
}

export type CanvasObjectType = 'stroke' | 'rect' | 'ellipse' | 'text' | 'sticky' | 'arrow' | 'line';

export interface CanvasObject {
  id: string; // ULID
  type: CanvasObjectType;
  owner: string; // userId / clientId
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  points?: Point[]; // For stroke, line, arrow
  text?: string; // For text and sticky notes
  fontSize?: number; // In world units
  fillColor?: string; // For sticky notes, shapes
  deleted: boolean;
  fieldSeqs: Record<string, number>;
}

export type InitialCanvasObject = Omit<CanvasObject, 'deleted' | 'fieldSeqs'>;

export interface CreateOp {
  type: 'create';
  clientOpId: string;
  object: InitialCanvasObject;
}

export interface AppendPointsOp {
  type: 'append_points';
  clientOpId: string;
  objectId: string;
  points: Point[];
  owner: string;
}

export interface UpdateOp {
  type: 'update';
  clientOpId: string;
  objectId: string;
  patch: Partial<Pick<CanvasObject, 'x' | 'y' | 'width' | 'height' | 'color' | 'strokeWidth' | 'text' | 'fontSize' | 'fillColor'>>;
}

export interface DeleteOp {
  type: 'delete';
  clientOpId: string;
  objectId: string;
}

export type ClientOp = CreateOp | AppendPointsOp | UpdateOp | DeleteOp;

export interface SequencedOp {
  seq: number;
  boardId: string;
  op: ClientOp;
  serverTimestamp: number;
}

// Inbound Messages (Client -> Server)
export interface JoinMessage {
  type: 'join';
  boardId: string;
  clientName: string;
  clientColor: string;
}

export interface OpMessage {
  type: 'op';
  boardId: string;
  op: ClientOp;
}

export interface ResumeMessage {
  type: 'resume';
  boardId: string;
  lastSeq: number;
}

export interface CursorMessage {
  type: 'cursor';
  boardId: string;
  x: number;
  y: number;
}

export interface PongMessage {
  type: 'pong';
}

export type ClientMessage =
  | JoinMessage
  | OpMessage
  | ResumeMessage
  | CursorMessage
  | PongMessage;

// Outbound Messages (Server -> Client)
export interface JoinedMessage {
  type: 'joined';
  boardId: string;
  clientId: string;
  maxUsers: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  boardId: string;
  seq: number;
  objects: Record<string, CanvasObject>;
}

export interface SequencedOpMessage {
  type: 'op';
  boardId: string;
  seq: number;
  op: ClientOp;
  serverTimestamp: number;
}

export interface ResumedMessage {
  type: 'resumed';
  boardId: string;
  ops: SequencedOp[];
}

export interface CursorBroadcastMessage {
  type: 'cursor';
  boardId: string;
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export interface UserPresence {
  clientId: string;
  name: string;
  color: string;
}

export interface PresenceMessage {
  type: 'presence';
  boardId: string;
  users: UserPresence[];
}

export type ErrorCode =
  | 'BOARD_FULL'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'STREAM_TRIMMED'
  | 'NOT_JOINED'
  | 'INTERNAL_ERROR';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export interface PingMessage {
  type: 'ping';
}

export type ServerMessage =
  | JoinedMessage
  | SnapshotMessage
  | SequencedOpMessage
  | ResumedMessage
  | CursorBroadcastMessage
  | PresenceMessage
  | ErrorMessage
  | PingMessage;

export interface BoardState {
  seq: number;
  objects: Record<string, CanvasObject>;
}
