import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
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
  fastify.get('/v1/ws', { websocket: true, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, (connection, request) => {
    // @fastify/websocket v8 changed the handler parameter type. In v8 the raw WebSocket
    // is either the connection directly (newer) or accessed via .socket (older SocketStream).
    // This cast handles both shapes safely.
    const ws: WebSocket = (connection as unknown as { socket: WebSocket }).socket ?? connection as unknown as WebSocket;

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
      ws,
      subscriptions: new Set(),
      isOps,
      lastSent: new Map(),
    };
    clients.add(client);

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        // Support both spec format { type: "SUBSCRIBE", channels: [...] }
        // and simple { action: "subscribe", channel: "..." }
        const channels: string[] = [];
        if (msg.type === 'SUBSCRIBE' && Array.isArray(msg.channels)) {
          channels.push(...(msg.channels as string[]));
        } else if (msg.action === 'subscribe' && typeof msg.channel === 'string') {
          channels.push(msg.channel as string);
        } else if (msg.type === 'UNSUBSCRIBE' && Array.isArray(msg.channels)) {
          (msg.channels as string[]).forEach((ch) => client.subscriptions.delete(ch));
          ws.send(JSON.stringify({ type: 'UNSUBSCRIBED', channels: msg.channels }));
          return;
        } else if (msg.action === 'unsubscribe' && typeof msg.channel === 'string') {
          client.subscriptions.delete(msg.channel as string);
          ws.send(JSON.stringify({ unsubscribed: msg.channel }));
          return;
        }

        for (const channel of channels) {
          if (channel.startsWith('ops:') && !client.isOps) {
            ws.send(JSON.stringify({ error: 'Unauthorized channel', channel }));
            continue;
          }
          client.subscriptions.add(channel);
        }
        if (channels.length > 0) {
          ws.send(JSON.stringify({ type: 'SUBSCRIBED', channels }));
        }
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid message' }));
      }
    });

    ws.on('close', () => {
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
      if (client.ws.readyState === 1 /* OPEN */) {
        client.ws.send(JSON.stringify({ channel, data: JSON.parse(message) }));
      }
    }
  });
}
