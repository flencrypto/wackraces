import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import type { AgentMessage, AgentName, MessageType } from './types';

/** In-process event bus – all agents share this instance. */
export const bus = new EventEmitter();
bus.setMaxListeners(20);

const REDIS_CHANNEL = 'agent:messages';

/**
 * Publish a message on the local bus.
 * When a Redis publisher is provided the message is also relayed via
 * Redis Pub/Sub so agents running in separate containers can receive it.
 */
export function publish(
  from: AgentName,
  to: AgentName | 'all',
  type: MessageType,
  payload: Record<string, unknown>,
  redisPub?: Redis,
): void {
  const msg: AgentMessage = {
    id: randomUUID(),
    from,
    to,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };

  // Local delivery
  bus.emit('message', msg);

  // Remote delivery (best-effort – silently skipped if Redis is unavailable)
  if (redisPub) {
    redisPub.publish(REDIS_CHANNEL, JSON.stringify(msg)).catch(() => undefined);
  }
}

/**
 * Subscribe to messages on the local bus (and optionally on Redis).
 */
export function subscribe(
  listener: (msg: AgentMessage) => void,
  redisSub?: Redis,
): void {
  bus.on('message', listener);

  if (redisSub) {
    redisSub.subscribe(REDIS_CHANNEL).catch(() => undefined);
    redisSub.on('message', (_channel: string, raw: string) => {
      try {
        const msg: AgentMessage = JSON.parse(raw) as AgentMessage;
        listener(msg);
      } catch {
        // ignore malformed messages
      }
    });
  }
}
