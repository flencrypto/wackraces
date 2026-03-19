/**
 * Operations Agent
 *
 * Responsibilities:
 *  - Periodically checks the health of every application service:
 *      • API  – HTTP GET /health
 *      • Redis – PING command
 *      • PostgreSQL – simple SELECT 1 query
 *  - Publishes a HEALTH_REPORT to the Orchestrator after every check cycle.
 *  - Sends an ALERT to the Orchestrator whenever a service transitions from
 *    healthy → unhealthy (edge-triggered, not level-triggered) so the
 *    Orchestrator can escalate to the Debug Agent.
 *  - Responds to CHECK_HEALTH commands for on-demand checks.
 */

import * as http from 'http';
import * as net from 'net';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { publish, subscribe } from './bus';
import { config } from './config';
import type { AgentMessage, HealthCheck, HealthReport } from './types';

const AGENT = 'ops' as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[OpsAgent] ${msg}`);
}

/** HTTP GET with timeout; resolves to status code or throws. */
function httpGet(url: string, timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // discard body
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/** TCP reachability check. */
function tcpCheck(host: string, port: number, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket
      .connect(port, host, () => {
        socket.destroy();
        resolve();
      })
      .on('error', (err) => {
        socket.destroy();
        reject(err);
      })
      .on('timeout', () => {
        socket.destroy();
        reject(new Error('timeout'));
      });
  });
}

// ─── Per-service checks ───────────────────────────────────────────────────────

async function checkApi(): Promise<HealthCheck> {
  const start = Date.now();
  const url = `${config.apiBaseUrl}/health`;
  try {
    const status = await httpGet(url);
    const latencyMs = Date.now() - start;
    const healthy = status === 200;
    if (!healthy) log(`⚠️  API returned HTTP ${status}`);
    return {
      service: 'api',
      healthy,
      latencyMs,
      error: healthy ? undefined : `HTTP ${status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      service: 'api',
      healthy: false,
      latencyMs: Date.now() - start,
      error: String((err as Error).message),
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  // Use a short-lived client so we don't interfere with the shared bus client
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    connectTimeout: 3_000,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    const latencyMs = Date.now() - start;
    const healthy = pong === 'PONG';
    return {
      service: 'redis',
      healthy,
      latencyMs,
      error: healthy ? undefined : `unexpected PING reply: ${pong}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      service: 'redis',
      healthy: false,
      latencyMs: Date.now() - start,
      error: String((err as Error).message),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    client.disconnect();
  }
}

async function checkPostgres(): Promise<HealthCheck> {
  const start = Date.now();
  const pool = new Pool({
    connectionString: config.pgConnectionString,
    connectionTimeoutMillis: 3_000,
    max: 1,
  });
  try {
    await pool.query('SELECT 1');
    const latencyMs = Date.now() - start;
    return {
      service: 'postgres',
      healthy: true,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      service: 'postgres',
      healthy: false,
      latencyMs: Date.now() - start,
      error: String((err as Error).message),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// ─── Full health sweep ────────────────────────────────────────────────────────

async function runHealthChecks(): Promise<HealthReport> {
  const [api, redis, postgres] = await Promise.all([
    checkApi(),
    checkRedis(),
    checkPostgres(),
  ]);
  const checks = [api, redis, postgres];
  const allHealthy = checks.every((c) => c.healthy);

  checks.forEach((c) => {
    const icon = c.healthy ? '✅' : '❌';
    log(`${icon}  ${c.service}: ${c.healthy ? `${c.latencyMs} ms` : c.error}`);
  });

  return { allHealthy, checks, timestamp: new Date().toISOString() };
}

// ─── State – track previous health to emit ALERT only on transitions ─────────

const prevHealthy: Record<string, boolean> = {};

function detectDegradations(report: HealthReport): void {
  for (const check of report.checks) {
    const was = prevHealthy[check.service];
    const now = check.healthy;

    if (was === true && !now) {
      // Transitioned healthy → unhealthy – alert the orchestrator
      log(`🚨  ${check.service} is DOWN – sending alert`);
      publish(AGENT, 'orchestrator', 'ALERT', {
        service: check.service,
        error: check.error ?? 'health check failed',
        checkedAt: check.checkedAt,
      });
    } else if (was === false && now) {
      // Recovered
      log(`🟢  ${check.service} recovered`);
      publish(AGENT, 'orchestrator', 'STATUS_UPDATE', {
        event: 'SERVICE_RECOVERED',
        service: check.service,
      });
    }

    prevHealthy[check.service] = now;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startOpsAgent(): void {
  log('Operations Agent starting …');

  const runCycle = async (): Promise<void> => {
    const report = await runHealthChecks();
    publish(
      AGENT,
      'orchestrator',
      'HEALTH_REPORT',
      report as unknown as Record<string, unknown>,
    );
    detectDegradations(report);
  };

  // Listen for on-demand CHECK_HEALTH commands and heartbeats
  subscribe((msg: AgentMessage) => {
    if (msg.to !== AGENT && msg.to !== 'all') return;

    switch (msg.type) {
      case 'HEARTBEAT':
        publish(AGENT, 'orchestrator', 'HEARTBEAT_ACK', { agent: AGENT });
        break;

      case 'COMMAND':
        if ((msg.payload as { action?: string }).action === 'CHECK_HEALTH') {
          runCycle().catch((err: unknown) =>
            log(`Error in on-demand check: ${String(err)}`),
          );
        }
        break;

      default:
        break;
    }
  });

  // Run immediately on start, then on the configured interval
  runCycle().catch((err: unknown) => log(`Initial health check error: ${String(err)}`));
  setInterval(() => {
    runCycle().catch((err: unknown) => log(`Health check error: ${String(err)}`));
  }, config.opsIntervalMs);

  publish(AGENT, 'orchestrator', 'STATUS_UPDATE', {
    agent: AGENT,
    status: 'ready',
    intervalMs: config.opsIntervalMs,
  });

  log(`Operations Agent ready. Checking health every ${config.opsIntervalMs / 1000} s.`);
}
