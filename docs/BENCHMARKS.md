# Benchmarks & Measurements

All figures in this document must be produced directly by measurement scripts located in this repository (`bench/`). No estimated, fabricated, or theoretical numbers are permitted.

## Summary Status
- End-to-end latency (0 ms injected latency): Measured (p50: 6.7 ms - 265.01 ms)
- End-to-end latency (20 ms injected latency via Toxiproxy): Measured (p50: 35.31 ms - 746.85 ms)
- Single-Stage vs Multi-Stage Docker Image Size: Measured (234MB vs 1.8GB)

## Methodology & Hardware Specification
- **Hardware**: AMD Ryzen 5 4600H with Radeon Graphics          (12 cores), 7 GB RAM
- **OS**: Windows / Linux (Docker)
- **Node.js**: v24.13.1
- **Redis**: Redis 7 Alpine
- **Measurement Tool**: `bench/src/runner.ts` using single-process monotonic clock (`process.hrtime.bigint()`) to eliminate clock skew between clients.

---

## 1. End-to-End Latency (0 ms Injected Latency)

| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |
|---|---|---|---|---|---|---|---|
| 10 | Continuous Drawing + Cursors | 4678 | 6.7 ms | 12.33 ms | 19.72 ms | 39.2% | 56.3 MB |
| 25 | Continuous Drawing + Cursors | 21586.2 | 39.43 ms | 110.03 ms | 396.46 ms | 91.3% | 46.6 MB |
| 50 | Continuous Drawing + Cursors | 31234.2 | 265.01 ms | 496.22 ms | 512.72 ms | 91% | 34.3 MB |

---

## 2. End-to-End Latency (20 ms Injected Latency via Toxiproxy)

| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |
|---|---|---|---|---|---|---|---|
| 10 | Continuous Drawing + Cursors | 4991.4 | 35.31 ms | 59.5 ms | 195.34 ms | 84.1% | 64.7 MB |
| 25 | Continuous Drawing + Cursors | 9264.8 | 226.83 ms | 300.29 ms | 423.92 ms | 79.7% | 43.9 MB |
| 50 | Continuous Drawing + Cursors | 13026.7 | 746.85 ms | 1055.54 ms | 1078.3 ms | 93.1% | 43.8 MB |

---

## 3. Docker Image Size Comparison

| Image Variant | Build Type | Image Size (MB) | Notes |
|---|---|---|---|
| `collab-canvas:naive` | Single-stage build | 1.8GB | Includes full dev dependencies, typescript, compilers |
| `collab-canvas:prod` | Multi-stage build | 234MB | Minimal Alpine runtime, pruned production dependencies, non-root user |
