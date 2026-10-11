import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { runMigrations, closePool } from './db/pool.js';
import { registerRoutes, setShuttingDown } from './http/routes.js';
import { createWebSocketGateway } from './ws/gateway.js';
import { roomManager } from './rooms/RoomManager.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim().toLowerCase());

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin.toLowerCase()) ||
        (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
      ) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await registerRoutes(fastify);

  const wsGateway = createWebSocketGateway();

  fastify.server.on('upgrade', (req, socket, head) => {
    wsGateway.handleUpgrade(req, socket, head).catch((err) => {
      console.error('Upgrade handler failure:', err);
      socket.destroy();
    });
  });

  return { fastify, wsGateway };
}

export async function startServer() {
  try {
    await runMigrations();
  } catch (err) {
    console.error('Failed to run database migrations:', err);
  }

  const { fastify, wsGateway } = await buildApp();

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, starting graceful shutdown...`);
    setShuttingDown(true);

    // Stop accepting upgrades and close all sockets with 1012
    wsGateway.closeAllSockets(1012, 'Server restarting');

    // Drain room queues and close room manager
    await roomManager.closeAll();

    // Close HTTP server & Database connection pool
    await fastify.close();
    await closePool();

    console.log('Shutdown completed cleanly.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Whiteboard server listening on http://0.0.0.0:${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('main.js')) {
  startServer();
}
