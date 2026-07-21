import 'dotenv/config';
import { prisma } from '@football-ai/database';
import { app } from './app.js';
import { env } from './env.js';

const server = app.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}/api`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
