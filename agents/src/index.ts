/**
 * Entry point – starts all four agents in a single Node.js process.
 *
 * Startup order:
 *   1. Orchestrator – establishes the message bus and heartbeat loop
 *   2. Build Agent  – watches source files and handles BUILD commands
 *   3. Ops Agent    – begins health-check polling immediately
 *   4. Debug Agent  – waits for ANALYZE_LOGS commands
 *
 * All agents communicate through the shared in-process EventEmitter bus
 * (see bus.ts).  When Redis is reachable the bus is also bridged to
 * Redis Pub/Sub so agents can run across separate processes or containers.
 */

import { config } from './config';
import Redis from 'ioredis';
import { subscribe, publish } from './bus';
import { startOrchestrator } from './orchestrator';
import { startBuildAgent } from './build-agent';
import { startOpsAgent } from './ops-agent';
import { startDebugAgent } from './debug-agent';
import type { AgentMessage } from './types';

function log(msg: string): void {
  console.log(`[Agents] ${msg}`);
}

async function tryConnectRedis(): Promise<{ pub: Redis; sub: Redis } | null> {
  try {
    const opts = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    };
    const pub = new Redis(opts);
    const sub = new Redis(opts);
    await pub.connect();
    await sub.connect();
    log(`✅  Redis bridge connected (${config.redis.host}:${config.redis.port})`);
    return { pub, sub };
  } catch (err: unknown) {
    log(`⚠️   Redis bridge unavailable – using local bus only. (${String(err)})`);
    return null;
  }
}

async function main(): Promise<void> {
  log('═══════════════════════════════════════════════');
  log('  WackRaces Agent System');
  log('═══════════════════════════════════════════════');
  log(`  Root dir : ${config.rootDir}`);
  log(`  API URL  : ${config.apiBaseUrl}`);
  log(`  Status   : http://localhost:${config.statusPort}/status`);
  log('═══════════════════════════════════════════════');

  // Optionally bridge the local bus to Redis Pub/Sub
  const redis = await tryConnectRedis();
  if (redis) {
    // Relay inbound Redis messages onto the local bus (dedup loop-backs)
    const CHANNEL = 'agent:messages';
    await redis.sub.subscribe(CHANNEL);
    redis.sub.on('message', (_channel: string, raw: string) => {
      try {
        const msg: AgentMessage = JSON.parse(raw) as AgentMessage;
        // Re-emit on the local bus so all local agents receive it
        import('./bus').then(({ bus }) => bus.emit('message', msg)).catch(() => undefined);
      } catch {
        // ignore
      }
    });

    // Patch publish to also send via Redis (handled inside bus.ts when redisPub is
    // passed explicitly – here we just subscribe the sub client so remote messages
    // reach local agents; outbound bridging is wired in bus.ts).
    log('Redis Pub/Sub bridge active – remote agents will receive messages.');
  }

  // Start all four agents
  startOrchestrator();
  startBuildAgent();
  startOpsAgent();
  startDebugAgent();

  log('All four agents started successfully.');

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    log(`\nReceived ${signal} – shutting down gracefully …`);
    if (redis) {
      try {
        await redis.pub.quit();
        await redis.sub.quit();
      } catch {
        // ignore
      }
    }
    log('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });

  // Keep the process alive
  process.on('uncaughtException', (err: Error) => {
    log(`Uncaught exception: ${err.message}\n${err.stack ?? ''}`);
    // Notify orchestrator about the crash
    publish('debug', 'orchestrator', 'ALERT', {
      service: 'agents-process',
      error: err.message,
      stack: err.stack ?? '',
    });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log(`Unhandled rejection: ${msg}`);
    publish('debug', 'orchestrator', 'ALERT', {
      service: 'agents-process',
      error: msg,
    });
  });
}

main().catch((err: unknown) => {
  console.error('[Agents] Fatal startup error:', err);
  process.exit(1);
});
