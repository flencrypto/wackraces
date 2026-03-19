import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, { lazyConnect: false });
  }
  return redisClient;
}

export async function publish(channel: string, message: object): Promise<void> {
  const client = getRedisClient();
  await client.publish(channel, JSON.stringify(message));
}

/**
 * Write a ping to the Redis Stream `loc_ingest` for the processor consumer group.
 * Fields are stored flat (all string values) to stay compatible with XREADGROUP.
 */
export async function xaddPing(payload: Record<string, string | number | undefined | null>): Promise<void> {
  const client = getRedisClient();
  const args: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) {
      args.push(k, String(v));
    }
  }
  await client.xadd(config.redisStreamName, '*', ...args);
}

export function createSubscriber(): Redis {
  return new Redis(config.redisUrl);
}
