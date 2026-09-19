export { createServer, ServerInstance } from './server.js';
export { config } from './config.js';
import { createServer } from './server.js';
import { config } from './config.js';

async function main() {
  const instance = await createServer();
  await instance.app.listen({ port: config.port, host: config.host });
  console.log(`CollabCanvas server [${config.instanceId}] running on http://${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    await instance.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
