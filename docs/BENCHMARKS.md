# Benchmarks & Measurements

All figures in this document must be produced directly by measurement scripts located in this repository (`bench/`). No estimated, fabricated, or theoretical numbers are permitted.

## Summary Status
- End-to-end latency (0 ms injected latency): TBD (run `npm run bench`)
- End-to-end latency (20 ms injected latency via Toxiproxy): TBD (run `npm run bench`)
- Single-Stage vs Multi-Stage Docker Image Size: TBD (run `npm run bench`)

## Methodology & Hardware Specification
- **Hardware**: TBD (run `npm run bench`)
- **OS**: Windows / Linux (Docker)
- **Node.js**: TBD (run `npm run bench`)
- **Redis**: Redis 7 Alpine
- **Measurement Tool**: `bench/src/runner.ts` using single-process monotonic clock (`process.hrtime.bigint()`) to eliminate clock skew between clients.

---

## 1. End-to-End Latency (0 ms Injected Latency)

| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |
|---|---|---|---|---|---|---|---|
| 10 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |
| 25 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |
| 50 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |

---

## 2. End-to-End Latency (20 ms Injected Latency via Toxiproxy)

| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |
|---|---|---|---|---|---|---|---|
| 10 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |
| 25 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |
| 50 | Continuous Drawing + Cursors | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) | TBD (run `npm run bench`) |

---

## 3. Docker Image Size Comparison

| Image Variant | Build Type | Image Size (MB) | Notes |
|---|---|---|---|
| `collab-canvas:naive` | Single-stage build | TBD (run `npm run bench`) | Includes full dev dependencies, typescript, compilers |
| `collab-canvas:prod` | Multi-stage build | TBD (run `npm run bench`) | Minimal Alpine runtime, pruned production dependencies, non-root user |
