# Architectural Decision Records (ADRs) & Dependency Justifications

## Table of Contents
1. [ADR 001: Raw WebSocket (`ws`) vs Socket.io](#adr-001-raw-websocket-ws-vs-socketio)
2. [ADR 002: Redis Streams vs Alternatives (Kafka, Postgres, Redis Lists)](#adr-002-redis-streams-vs-alternatives)
3. [ADR 003: Server-Sequenced Op Log vs OT vs CRDT](#adr-003-server-sequenced-op-log-vs-ot-vs-crdt)
4. [ADR 004: Per-Field Last-Writer-Wins (LWW) Semantics](#adr-004-per-field-last-writer-wins-lww-semantics)
5. [ADR 005: Tombstone Deletions](#adr-005-tombstone-deletions)
6. [ADR 006: Snapshotting and Compaction via Redis Locks](#adr-006-snapshotting-and-compaction)
7. [ADR 007: Pub/Sub Loss Recovery via Stream Replay](#adr-007-pubsub-loss-recovery-via-stream-replay)
8. [ADR 008: Ephemeral Data Channel (Cursors & Presence)](#adr-008-ephemeral-data-channel)
9. [Dependency Justifications](#dependency-justifications)

---

## ADR 001: Raw WebSocket (`ws`) vs Socket.io
- **Context**: Real-time bidirectional client-server communication is required for canvas syncing, cursor streaming, and room presence.
- **Options Considered**:
  1. `socket.io`: Provides automatic reconnect, fallback to HTTP long polling, room abstractions, and packet framing.
  2. Raw `ws`: Minimal RFC 6455 compliant WebSocket server with explicit framing and zero protocol abstraction overhead.
- **Choice**: Raw `ws`.
- **Tradeoffs**:
  - *Pros*: Explicit, transparent wire protocol; zero mystery abstraction layers; full control over binary/JSON serialization and heartbeats; lighter footprint.
  - *Cons*: Reconnection, backoff, and room fan-out must be built explicitly.

---

## ADR 002: Redis Streams vs Alternatives
- **Context**: The server cluster needs an append-only, ordered log of operations per board that supports retention, historical replay (`XRANGE`), and compaction.
- **Options Considered**:
  1. Apache Kafka: Heavyweight distributed broker; requires ZooKeeper/KRaft and high operational overhead for a whiteboard app.
  2. PostgreSQL with `LISTEN`/`NOTIFY`: High persistence guarantees, but higher write latency for high-frequency whiteboard strokes.
  3. Redis Lists: Fast, but lacking range-based sequencing identifiers and bounded trimming without index tracking.
  4. Redis Streams (`XADD`, `XRANGE`, `XTRIM`): Native persistent time-series/op log with range queries, sub-millisecond append latency, and simple compaction.
- **Choice**: Redis Streams (`ioredis`).
- **Tradeoffs**:
  - *Pros*: Memory-efficient, sub-millisecond sequencing and appending, native range queries for catch-up/resume, fits alongside Redis Pub/Sub.
  - *Cons*: Single Redis instance is an operational SPOF without Redis Sentinel/Cluster.

---

## ADR 003: Server-Sequenced Op Log vs OT vs CRDT
- **Context**: Collaborative canvas requires multi-user synchronization with conflict resolution and optimistic local rendering.
- **Options Considered**:
  1. Operational Transformation (OT): Requires central server with complex transformation matrices across concurrent operations.
  2. Conflict-free Replicated Data Types (CRDTs, e.g. Yjs, Automerge): High client-side memory footprint, complex tombstone garbage collection, non-trivial wire overhead.
  3. Server-Sequenced Operation Log with Per-Field Last-Writer-Wins (LWW).
- **Choice**: Server-Sequenced Operation Log with Per-Field LWW.
- **Why It Is Sufficient Here**:
  - Whiteboard objects (rectangles, ellipses, strokes) are independent entities with distinct ULIDs.
  - Freehand strokes are append-only and single-author during drawing.
  - Object movements or style edits (color, size, position) are discrete property modifications.
  - An atomic server sequence number (`board:{id}:seq` via Lua) defines a strict total ordering across all operations.
- **Where It Would Break**:
  - Collaborative rich text editing inside a shared text block. LWW at character or field level results in overwritten characters or interleaved nonsense rather than true intention-preserving text splices.

---

## ADR 004: Per-Field Last-Writer-Wins (LWW) Semantics
- **Context**: Two users may concurrently edit different properties of the same canvas object (e.g. User A changes color while User B changes position).
- **Options Considered**:
  1. Whole-object LWW: The later operation overwrites all fields of the earlier operation, discarding concurrent non-conflicting field edits.
  2. Per-field LWW: Each field tracks the sequence number of the operation that last modified it. A patch only overwrites fields where `op.seq > fieldSeq[field]`.
- **Choice**: Per-Field LWW.
- **Tradeoffs**:
  - *Pros*: Fine-grained conflict resolution allows concurrent orthogonal edits (e.g. moving while recoloring).
  - *Cons*: Slightly higher memory per object (tracks field sequence versions).

---

## ADR 005: Tombstone Deletions
- **Context**: When an object is deleted, in-flight operations (updates or append_points) may arrive afterwards due to network delay.
- **Options Considered**:
  1. Hard delete (remove key from map immediately): Late-arriving operations might recreate or corrupt state if not carefully checked.
  2. Soft delete / Tombstone (`deleted: true` with tombstone seq): Once marked deleted, any subsequent `update` or `append_points` is strictly ignored.
- **Choice**: Tombstone Deletions.
- **Tradeoffs**:
  - *Pros*: Deterministic convergence across out-of-order deliveries.
  - *Cons*: Tombstones remain in memory until board snapshot compaction prunes them.

---

## ADR 006: Snapshotting and Compaction
- **Context**: Op log cannot grow indefinitely in Redis Streams as memory is bounded. New clients joining need fast snapshot loading rather than replaying tens of thousands of ops.
- **Options Considered**:
  1. Never compact: Stream memory grows unbounded; join latency degrades linearly with board history.
  2. Compaction every 500 ops guarded by distributed lock (`SET board:{id}:snapshot_lock <id> NX PX 5000`): One server instance folds stream into a snapshot and trims the stream to the snapshot seq.
- **Choice**: Compaction every 500 ops via distributed lock.
- **Tradeoffs**:
  - *Pros*: Constant-time join loading; bounded Redis memory usage; no concurrent duplicate snapshot writes.
  - *Cons*: Replay window is bounded to the uncompacted stream tail. Clients disconnected longer than the compaction window must perform full snapshot recovery.

---

## ADR 007: Pub/Sub Loss Recovery via Stream Replay
- **Context**: Redis Pub/Sub provides at-most-once delivery without buffering. A transient network hiccup or socket stall could drop a sequenced message.
- **Options Considered**:
  1. Rely purely on Pub/Sub: Dropped message causes client state to silently diverge.
  2. Gap detection on client (`incoming.seq > lastConfirmedSeq + 1`) triggers `resume { lastSeq }`: Server reads missed ops from Redis Stream (`XRANGE`) or issues full snapshot if stream was compacted.
- **Choice**: Gap Detection with Redis Stream Replay.
- **Tradeoffs**:
  - *Pros*: Self-healing client connections; guaranteed eventual consistency despite lossy pub/sub.
  - *Cons*: Requires client gap buffer and server stream range query logic.

---

## ADR 008: Ephemeral Data Channel
- **Context**: Cursors and presence have high update frequency (~30 Hz per user) but zero historical value. Persisting cursors to Redis Streams would waste IOPS and memory.
- **Options Considered**:
  1. Sequence and persist cursor updates in the op log.
  2. Separate unpersisted Pub/Sub channel (`board:{id}:ephemeral`) with client-side 30 Hz throttling.
- **Choice**: Separate unpersisted Pub/Sub channel.
- **Tradeoffs**:
  - *Pros*: Negligible overhead; zero storage footprint; high interactivity.
  - *Cons*: Lost cursor messages are never replayed (by design; latest position renders next frame).

---

## Dependency Justifications

| Package | Purpose & Justification |
|---|---|
| `ws` | Minimal RFC 6455 compliant WebSocket implementation for explicit, predictable real-time protocol. |
| `fastify` | High-performance, low-overhead HTTP framework for `/healthz`, `/metrics`, and serving client assets. |
| `ioredis` | Robust Redis client with first-class support for Streams, Pub/Sub, and atomic Lua script execution. |
| `zod` | Declarative schema validation runtime ensuring all inbound network messages conform to strict types. |
| `pino` | Fast, structured JSON logger with minimal event-loop overhead for high-throughput WebSocket servers. |
| `prom-client` | Prometheus metrics instrumentation for active connections, op throughput, and broadcast latency. |
| `ulid` | Universally Unique Lexicographically Sortable Identifiers for conflict-free client object IDs. |
| `react` & `react-dom` | Declarative UI framework for whiteboard toolbar, presence overlays, and connection status banners. |
| `vite` | Fast, modern build tool and development server for React + TypeScript. |
| `vitest` | Ultra-fast unit and integration test runner with native TypeScript and ESM support. |
| `fast-check` | Property-based testing framework for verifying convergence invariants across randomized operation sequences. |
