import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { config } from './config';
import { pool } from './db';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { carRoutes } from './routes/cars';
import { locationRoutes } from './routes/location';
import { postRoutes } from './routes/posts';
import { mediaRoutes } from './routes/media';
import { opsRoutes } from './routes/ops';
import { wsRoutes, startRedisSubscriber } from './routes/ws';

const fastify = Fastify({ logger: true });

async function start(): Promise<void> {
  // CORS: allow configured origins only; in dev allow all
  const corsOrigin: boolean | string | RegExp | (string | RegExp)[] =
    config.corsOrigin ? config.corsOrigin.split(',').map((o) => o.trim()) : true;
  await fastify.register(cors, { origin: corsOrigin });

  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await fastify.register(websocket);

  // Health check — used by Docker/Kubernetes liveness & readiness probes
  fastify.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return reply.send({ status: 'ok', db: 'ok' });
    } catch (err) {
      fastify.log.error(err, 'Health check DB error');
      return reply.status(503).send({ status: 'error', db: 'down' });
    }
  });

  await fastify.register(authRoutes);
  await fastify.register(eventRoutes);
  await fastify.register(carRoutes);
  await fastify.register(locationRoutes);
  await fastify.register(postRoutes);
  await fastify.register(mediaRoutes);
  await fastify.register(opsRoutes);
  await fastify.register(wsRoutes);

  fastify.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: error.issues });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  startRedisSubscriber();

  await fastify.listen({ port: config.port, host: config.host });
}

const gracefulShutdown = async (signal: string): Promise<void> => {
  fastify.log.info({ signal }, 'Shutting down...');
  await fastify.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  fastify.log.error({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
