import { ulid } from 'ulid';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  maxUsersPerBoard: parseInt(process.env.MAX_USERS_PER_BOARD || '50', 10),
  maxMessageBytes: parseInt(process.env.MAX_MESSAGE_BYTES || String(64 * 1024), 10),
  rateLimitOpsPerSec: parseInt(process.env.RATE_LIMIT_OPS_PER_SEC || '60', 10),
  compactionIntervalOps: parseInt(process.env.COMPACTION_INTERVAL_OPS || '500', 10),
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
  instanceId: process.env.INSTANCE_ID || `inst_${ulid()}`,
};
