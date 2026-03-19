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

export function createSubscriber(): Redis {
  return new Redis(config.redisUrl);
}
