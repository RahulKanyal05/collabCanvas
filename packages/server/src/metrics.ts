import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'collab_' });

export const activeConnections = new client.Gauge({
  name: 'collab_active_connections',
  help: 'Number of active WebSocket connections on this server instance',
  labelNames: ['instance_id'],
});

export const opsTotal = new client.Counter({
  name: 'collab_ops_total',
  help: 'Total number of operations sequenced by this server',
  labelNames: ['op_type'],
});

export const fanoutLatencySeconds = new client.Histogram({
  name: 'collab_fanout_latency_seconds',
  help: 'End-to-end server fanout latency from sequencing to broadcast in seconds',
  labelNames: ['board_id'],
  buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
});

export const activeBoards = new client.Gauge({
  name: 'collab_active_boards',
  help: 'Number of boards currently active on this instance',
});

export { client as prometheus };
