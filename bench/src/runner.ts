import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { ulid } from 'ulid';
import { createServer, ServerInstance } from '@collab/server';
import {
  ClientMessage,
  ServerMessage,
  SequencedOpMessage,
  CursorBroadcastMessage,
} from '@collab/protocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

interface BenchResult {
  clients: number;
  workload: string;
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
  cpuPercent: number;
  memMb: number;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return Number(sorted[index].toFixed(2));
}

async function runBenchmarkForClients(
  numClients: number,
  port1: number,
  port2: number,
  boardId: string,
  durationMs: number = 5000
): Promise<BenchResult> {
  console.log(`\n--- Starting Benchmark Run with ${numClients} clients (Duration: ${durationMs / 1000}s) ---`);

  const sockets: WebSocket[] = [];
  const latenciesMs: number[] = [];
  let totalOpsReceived = 0;

  // Track send timestamps: clientOpId -> hrtime BigInt
  const sendTimestamps = new Map<string, bigint>();

  // Connect N clients split between instances
  const clientPromises = Array.from({ length: numClients }, (_, i) => {
    const port = i % 2 === 0 ? port1 : port2;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);

    return new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'join',
            boardId,
            clientName: `BenchBot-${i}`,
            clientColor: '#38bdf8',
          })
        );
      });

      ws.on('message', (data) => {
        const receiveNs = process.hrtime.bigint();
        try {
          const msg = JSON.parse(data.toString('utf-8')) as ServerMessage;

          if (msg.type === 'joined') {
            resolve();
          } else if (msg.type === 'op') {
            totalOpsReceived++;
            const clientOpId = (msg as SequencedOpMessage).op.clientOpId;
            const sentNs = sendTimestamps.get(clientOpId);
            if (sentNs) {
              const latency = Number(receiveNs - sentNs) / 1e6;
              latenciesMs.push(latency);
            }
          } else if (msg.type === 'cursor') {
            totalOpsReceived++;
            // Extract embedded timestamp in client name if available
            const cursorMsg = msg as CursorBroadcastMessage;
            if (cursorMsg.name.startsWith('ts_')) {
              const sentNs = BigInt(cursorMsg.name.replace('ts_', ''));
              const latency = Number(receiveNs - sentNs) / 1e6;
              latenciesMs.push(latency);
            }
          }
        } catch {}
      });

      ws.on('error', (err) => reject(err));
    });
  });

  await Promise.all(clientPromises);
  console.log(`All ${numClients} clients joined successfully.`);

  // Measure CPU usage start
  const startCpu = process.cpuUsage();
  const startTime = Date.now();

  // Send continuous traffic
  let running = true;
  const sendIntervals: any[] = [];

  for (let i = 0; i < numClients; i++) {
    const ws = sockets[i];
    const clientIndex = i;

    // Stroke drawing loop (~40 ops/sec per client)
    const opInterval = setInterval(() => {
      if (!running || ws.readyState !== WebSocket.OPEN) return;
      const opId = `bench_${clientIndex}_${ulid()}`;
      sendTimestamps.set(opId, process.hrtime.bigint());

      ws.send(
        JSON.stringify({
          type: 'op',
          boardId,
          op: {
            type: 'create',
            clientOpId: opId,
            object: {
              id: `obj_${opId}`,
              type: 'rect',
              owner: `bot-${clientIndex}`,
              x: Math.random() * 800,
              y: Math.random() * 600,
              width: 40,
              height: 40,
              color: '#38bdf8',
              strokeWidth: 2,
            },
          },
        })
      );
    }, 25);

    // Cursor movement loop (~30 Hz)
    const cursorInterval = setInterval(() => {
      if (!running || ws.readyState !== WebSocket.OPEN) return;
      const cursorNs = process.hrtime.bigint().toString();
      ws.send(
        JSON.stringify({
          type: 'cursor',
          boardId,
          x: Math.round(Math.random() * 1000),
          y: Math.round(Math.random() * 800),
        })
      );
    }, 33);

    sendIntervals.push(opInterval, cursorInterval);
  }

  // Run for specified duration
  await new Promise((r) => setTimeout(r, durationMs));

  // Stop traffic
  running = false;
  for (const interval of sendIntervals) {
    clearInterval(interval);
  }

  // Allow short drain period
  await new Promise((r) => setTimeout(r, 800));

  const endCpu = process.cpuUsage(startCpu);
  const elapsedSec = (Date.now() - startTime) / 1000;
  const cpuPercent = Number(
    (((endCpu.user + endCpu.system) / 1000 / (elapsedSec * 1000)) * 100).toFixed(1)
  );
  const memMb = Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1));

  // Close client sockets
  for (const ws of sockets) {
    ws.close();
  }

  latenciesMs.sort((a, b) => a - b);
  const p50 = calculatePercentile(latenciesMs, 50);
  const p95 = calculatePercentile(latenciesMs, 95);
  const p99 = calculatePercentile(latenciesMs, 99);
  const throughput = Number((totalOpsReceived / elapsedSec).toFixed(1));

  console.log(`Results for N=${numClients}:`);
  console.log(`  Throughput: ${throughput} ops/sec`);
  console.log(`  p50: ${p50} ms | p95: ${p95} ms | p99: ${p99} ms`);
  console.log(`  CPU: ${cpuPercent}% | Memory: ${memMb} MB`);

  return {
    clients: numClients,
    workload: 'Continuous Drawing + Cursors',
    throughput,
    p50,
    p95,
    p99,
    cpuPercent,
    memMb,
  };
}

async function setupToxiproxy(targetPort: number, proxyPort: number): Promise<boolean> {
  try {
    // Delete existing proxy if any
    await fetch(`http://127.0.0.1:8474/proxies/collab_proxy`, { method: 'DELETE' }).catch(() => {});

    // Create proxy
    const createRes = await fetch(`http://127.0.0.1:8474/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'collab_proxy',
        listen: `0.0.0.0:${proxyPort}`,
        upstream: `host.docker.internal:${targetPort}`,
        enabled: true,
      }),
    });

    if (!createRes.ok) {
      // If host.docker.internal isn't supported, try 127.0.0.1
      await fetch(`http://127.0.0.1:8474/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'collab_proxy',
          listen: `0.0.0.0:${proxyPort}`,
          upstream: `127.0.0.1:${targetPort}`,
          enabled: true,
        }),
      });
    }

    // Add 20ms latency toxic
    await fetch(`http://127.0.0.1:8474/proxies/collab_proxy/toxics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'latency_downstream',
        type: 'latency',
        stream: 'downstream',
        attributes: {
          latency: 20,
          jitter: 2,
        },
      }),
    });

    return true;
  } catch {
    return false;
  }
}

async function main() {
  const isToxiproxy = process.argv.includes('--toxiproxy');
  console.log(`Starting CollabCanvas Benchmark Suite (${isToxiproxy ? '20ms Injected Latency' : '0ms Latency'})...`);

  const port1 = 4931;
  const port2 = 4932;
  const toxiproxyPort = 8475;
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  if (isToxiproxy) {
    const ok = await setupToxiproxy(port1, toxiproxyPort);
    if (ok) {
      console.log(`Toxiproxy configured: injecting 20ms downstream latency on port ${toxiproxyPort}`);
    }
  }

  // Start two real server instances
  const instance1 = await createServer({
    port: port1,
    host: '0.0.0.0',
    redisUrl,
    instanceId: 'bench-inst-1',
    maxUsersPerBoard: 60,
    heartbeatIntervalMs: 60000,
  });
  await instance1.app.listen({ port: port1, host: '0.0.0.0' });

  const instance2 = await createServer({
    port: port2,
    host: '0.0.0.0',
    redisUrl,
    instanceId: 'bench-inst-2',
    maxUsersPerBoard: 60,
    heartbeatIntervalMs: 60000,
  });
  await instance2.app.listen({ port: port2, host: '0.0.0.0' });

  const clientPort1 = isToxiproxy ? toxiproxyPort : port1;
  const clientPort2 = isToxiproxy ? toxiproxyPort : port2;

  const results: BenchResult[] = [];
  const clientCounts = [10, 25, 50];

  for (const count of clientCounts) {
    const boardId = `bench-board-${count}-${Date.now()}`;
    const res = await runBenchmarkForClients(count, clientPort1, clientPort2, boardId, 5000);
    results.push(res);
  }

  await instance1.close();
  await instance2.close();

  // Read existing BENCHMARKS.md and update tables
  const docPath = path.resolve(rootDir, 'docs/BENCHMARKS.md');
  if (fs.existsSync(docPath)) {
    let content = fs.readFileSync(docPath, 'utf-8');

    // Update Hardware / Node info
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? `${cpus[0].model} (${cpus.length} cores)` : 'x86_64';
    const totalMem = `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB RAM`;
    content = content.replace(/\*\*Hardware\*\*: .*/, `**Hardware**: ${cpuModel}, ${totalMem}`);
    content = content.replace(/\*\*Node\.js\*\*: .*/, `**Node.js**: ${process.version}`);

    if (!isToxiproxy) {
      let table0ms = `| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |\n|---|---|---|---|---|---|---|---|\n`;
      for (const r of results) {
        table0ms += `| ${r.clients} | Continuous Drawing + Cursors | ${r.throughput} | ${r.p50} ms | ${r.p95} ms | ${r.p99} ms | ${r.cpuPercent}% | ${r.memMb} MB |\n`;
      }
      content = content.replace(
        /## 1\. End-to-End Latency \(0 ms Injected Latency\)[\s\S]*?(?=---)/,
        `## 1. End-to-End Latency (0 ms Injected Latency)\n\n${table0ms}\n`
      );
      content = content.replace(
        /- End-to-end latency \(0 ms injected latency\): .*/,
        `- End-to-end latency (0 ms injected latency): Measured (p50: ${results[0].p50} ms - ${results[2].p50} ms)`
      );
    } else {
      let table20ms = `| Clients (N) | Workload | Ops/Sec Throughput | Latency p50 | Latency p95 | Latency p99 | Server CPU (%) | Server Mem (MB) |\n|---|---|---|---|---|---|---|---|\n`;
      for (const r of results) {
        table20ms += `| ${r.clients} | Continuous Drawing + Cursors | ${r.throughput} | ${r.p50} ms | ${r.p95} ms | ${r.p99} ms | ${r.cpuPercent}% | ${r.memMb} MB |\n`;
      }
      content = content.replace(
        /## 2\. End-to-End Latency \(20 ms Injected Latency via Toxiproxy\)[\s\S]*?(?=---)/,
        `## 2. End-to-End Latency (20 ms Injected Latency via Toxiproxy)\n\n${table20ms}\n`
      );
      content = content.replace(
        /- End-to-end latency \(20 ms injected latency via Toxiproxy\): .*/,
        `- End-to-end latency (20 ms injected latency via Toxiproxy): Measured (p50: ${results[0].p50} ms - ${results[2].p50} ms)`
      );
    }

    fs.writeFileSync(docPath, content, 'utf-8');
    console.log(`\nUpdated docs/BENCHMARKS.md with actual measured values.`);
  }
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
