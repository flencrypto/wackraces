import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config';
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
  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await fastify.register(websocket);

  await fastify.register(authRoutes);
  await fastify.register(eventRoutes);
  await fastify.register(carRoutes);
  await fastify.register(locationRoutes);
  await fastify.register(postRoutes);
  await fastify.register(mediaRoutes);
  await fastify.register(opsRoutes);
  await fastify.register(wsRoutes);

  // Error handler for Zod validation errors
  fastify.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') {
      return reply.status(400).send({ error: 'Validation error', details: error.message });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  startRedisSubscriber();

  await fastify.listen({ port: config.port, host: config.host });
  console.log(`Server running on ${config.host}:${config.port}`);
}

const gracefulShutdown = async (signal: string): Promise<void> => {
  console.log(`Received ${signal}, shutting down...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
