import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from repository root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  /** Root directory of the monorepo */
  rootDir: path.resolve(__dirname, '../../'),

  /** API base URL used by the Ops Agent health checks */
  apiBaseUrl: env('AGENTS_API_BASE_URL', 'http://localhost:3000'),

  /** PostgreSQL connection (reuses existing POSTGRES_* env or DATABASE_URL) */
  pgConnectionString: env(
    'DATABASE_URL',
    'postgresql://wackraces:wackraces@localhost:5432/wackraces',
  ),

  /** Redis connection */
  redis: {
    host: env('REDIS_HOST', 'localhost'),
    port: envInt('REDIS_PORT', 6379),
    password: process.env['REDIS_PASSWORD'],
  },

  /** How often the Ops Agent polls health (ms) */
  opsIntervalMs: envInt('AGENTS_OPS_INTERVAL_MS', 30_000),

  /** How often the Orchestrator sends heartbeats (ms) */
  heartbeatIntervalMs: envInt('AGENTS_HEARTBEAT_INTERVAL_MS', 15_000),

  /** Seconds of idle after which an agent is considered dead */
  heartbeatTimeoutSec: envInt('AGENTS_HEARTBEAT_TIMEOUT_SEC', 60),

  /** Whether to use Docker Compose for log collection (set to "true" in Docker) */
  useDocker: env('AGENTS_USE_DOCKER', 'false') === 'true',

  /** Optional HTTP port for the Orchestrator status dashboard */
  statusPort: envInt('AGENTS_STATUS_PORT', 4000),
};
