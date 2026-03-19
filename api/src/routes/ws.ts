import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { verifyAccessToken } from '../auth/jwt';
import { createSubscriber } from '../services/redis';
import { config } from '../config';

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  isOps: boolean;
  lastSent: Map<string, number>;
}

const clients = new Set<WsClient>();

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/ws', { websocket: true }, (socket, request) => {
    let isOps = false;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(authHeader.slice(7));
        isOps = payload.role === 'ORGANIZER' || payload.role === 'SUPERADMIN';
      } catch {
        // Public client
      }
    }

    const client: WsClient = {
      ws: socket,
      subscriptions: new Set(),
      isOps,
      lastSent: new Map(),
    };
    clients.add(client);

    socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'subscribe' && typeof msg.channel === 'string') {
          const channel: string = msg.channel;
          if (channel.startsWith('ops:') && !client.isOps) {
            socket.send(JSON.stringify({ error: 'Unauthorized channel' }));
            return;
          }
          client.subscriptions.add(channel);
          socket.send(JSON.stringify({ subscribed: channel }));
        } else if (msg.action === 'unsubscribe' && typeof msg.channel === 'string') {
          client.subscriptions.delete(msg.channel);
          socket.send(JSON.stringify({ unsubscribed: msg.channel }));
        }
      } catch {
        socket.send(JSON.stringify({ error: 'Invalid message' }));
      }
    });

    socket.on('close', () => {
      clients.delete(client);
    });
  });
}

export function startRedisSubscriber(): void {
  const subscriber = createSubscriber();

  subscriber.psubscribe('public:*', 'ops:*', (err) => {
    if (err) console.error('Redis psubscribe error', err);
  });

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const now = Date.now();
    for (const client of clients) {
      if (!client.subscriptions.has(channel)) continue;
      const rateLimit = client.isOps ? config.wsRateLimitOpsMs : config.wsRateLimitPublicMs;
      const lastSent = client.lastSent.get(channel) ?? 0;
      if (now - lastSent < rateLimit) continue;
      client.lastSent.set(channel, now);
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ channel, data: JSON.parse(message) }));
      }
    }
  });
}
