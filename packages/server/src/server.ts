import fastify, { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import pino from 'pino';
import { config } from './config.js';
import { prometheus } from './metrics.js';
import { Sequencer } from './board/sequencer.js';
import { RoomManager } from './board/room.js';
import { ConnectionHandler } from './ws/connection.js';

export interface ServerInstance {
  app: FastifyInstance;
  wss: WebSocketServer;
  redis: Redis;
  subRedis: Redis;
  sequencer: Sequencer;
  roomManager: RoomManager;
  close: () => Promise<void>;
}

export async function createServer(customConfig?: Partial<typeof config>): Promise<ServerInstance> {
  const mergedConfig = { ...config, ...customConfig };
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

  const app = fastify({ logger: false });

  const redis = new Redis(mergedConfig.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  const subRedis = new Redis(mergedConfig.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  await redis.connect();
  await subRedis.connect();

  const sequencer = new Sequencer(redis);
  await sequencer.init();

  const roomManager = new RoomManager(redis, subRedis);

  // Health endpoint
  app.get('/healthz', async (_req, reply) => {
    try {
      const pingResult = await redis.ping();
      if (pingResult === 'PONG') {
        return reply.status(200).send({
          status: 'ok',
          redis: 'connected',
          instanceId: mergedConfig.instanceId,
        });
      }
      return reply.status(503).send({ status: 'unhealthy', redis: 'disconnected' });
    } catch (err: any) {
      return reply.status(503).send({ status: 'unhealthy', error: err.message });
    }
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', prometheus.register.contentType);
    return reply.send(await prometheus.register.metrics());
  });

  // Attach raw WebSocket Server
  const wss = new WebSocketServer({
    server: app.server,
    maxPayload: mergedConfig.maxMessageBytes,
  });

  const connectionHandlers = new Map<WebSocket, ConnectionHandler>();

  wss.on('connection', (ws: WebSocket) => {
    const handler = new ConnectionHandler(ws, roomManager, sequencer);
    connectionHandlers.set(ws, handler);

    ws.on('close', () => {
      connectionHandlers.delete(ws);
    });
  });

  // Heartbeat ping/pong cleanup
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const handler = connectionHandlers.get(ws);
      if (!handler) return;

      if (!handler.isAlive) {
        ws.terminate();
        connectionHandlers.delete(ws);
        return;
      }

      handler.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, mergedConfig.heartbeatIntervalMs);

  const close = async (): Promise<void> => {
    clearInterval(heartbeatTimer);

    // Gracefully close all sockets with 1012 (Service Restart)
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1012, 'Server restarting');
      }
    }

    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await app.close();
    subRedis.disconnect();
    redis.disconnect();
  };

  return {
    app,
    wss,
    redis,
    subRedis,
    sequencer,
    roomManager,
    close,
  };
}
