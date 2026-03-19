import Redis from 'ioredis';
import { Pool } from 'pg';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://wackraces:wackraces@localhost:5432/wackraces';
const STREAM_NAME = process.env.REDIS_STREAM_NAME ?? 'loc_ingest';
const GROUP_NAME = process.env.REDIS_STREAM_GROUP ?? 'loc_processor_group';
const CONSUMER_NAME = process.env.HOSTNAME ?? 'processor-1';
/** Per-spec: jitter time bucket is floor(ts / 180 000 ms) */
const JITTER_CHANGE_INTERVAL_MS = 180_000;
/** Secret salt for deterministic jitter — must match JITTER_SALT in API */
const JITTER_SALT = process.env.JITTER_SALT ?? 'dev-jitter-salt';
const EARTH_RADIUS_M = 6371000;
/** Anti-cheat: maximum plausible speed in m/s (80 m/s ≈ 288 km/h) */
const MAX_SPEED_MPS = 80;
/** Anti-cheat: GPS accuracy worse than this is rejected outright */
const MAX_RAW_ACCURACY_M = 1000;
/** Dead-letter stream for messages that could not be processed */
const DEAD_LETTER_STREAM = 'loc_ingest_dlq';
/** Maximum delivery attempts before dead-lettering a message */
const MAX_DELIVERY_ATTEMPTS = 3;
/** Default public blur radius in metres — matches api/src/config.ts default */
const DEFAULT_PUBLIC_BLUR_M = 400;
/**
 * Range used to normalise hash outputs to [-1, 1].
 * Must stay in sync with the same constant in api/src/services/sanitize.ts.
 */
const JITTER_NORM = 2000;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

const redisOptions = {
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
  maxRetriesPerRequest: null,
};

const consumer = new Redis(REDIS_URL, redisOptions);
const publisher = new Redis(REDIS_URL, redisOptions);

consumer.on('error', (err) => console.error('Consumer Redis error', err));
publisher.on('error', (err) => console.error('Publisher Redis error', err));

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Deterministic jitter — must match the implementation in api/src/services/sanitize.ts.
 * Seed = `${carId}:${bucket}:${salt}` where bucket = floor(ts_ms / 180_000).
 */
function deterministicJitter(
  carId: string,
  timeBucketMs: number,
  blurM: number
): { dLat: number; dLng: number } {
  const seed = `${carId}:${timeBucketMs}:${JITTER_SALT}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const hash2 = (Math.imul(31, hash) + 7) | 0;
  const nx = ((hash % JITTER_NORM) - JITTER_NORM / 2) / (JITTER_NORM / 2);
  const ny = ((hash2 % JITTER_NORM) - JITTER_NORM / 2) / (JITTER_NORM / 2);
  return {
    dLat: nx * blurM / 111320,
    dLng: ny * blurM / 111320,
  };
}

interface StreamPing {
  carId: string;
  lat: number;
  lng: number;
  ts: string;
  accuracy_m?: number;
  speed_mps?: number;
}

/** Parse a flat Redis Stream entry (field/value pairs) back into a structured object. */
function parseStreamEntry(fields: string[]): StreamPing | null {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  if (!obj['carId'] || !obj['lat'] || !obj['lng'] || !obj['ts']) return null;
  return {
    carId: obj['carId'],
    lat: parseFloat(obj['lat']),
    lng: parseFloat(obj['lng']),
    ts: obj['ts'],
    accuracy_m: obj['accuracy_m'] ? parseFloat(obj['accuracy_m']) : undefined,
    speed_mps: obj['speed_mps'] ? parseFloat(obj['speed_mps']) : undefined,
  };
}

/**
 * Anti-cheat validation. Returns { valid, reject_reason }.
 */
function validatePing(
  msg: StreamPing,
  lastState: { last_lat?: number; last_lng?: number; last_ts?: string } | undefined,
  serverNow: Date
): { valid: boolean; reject_reason: string | null } {
  const pingTs = new Date(msg.ts);

  // Timestamp sanity: ±5 minutes from server time
  const tsDiffMs = Math.abs(serverNow.getTime() - pingTs.getTime());
  if (tsDiffMs > 5 * 60 * 1000) {
    return { valid: false, reject_reason: 'TIMESTAMP_SANITY' };
  }

  // Absurd accuracy rejection
  if (msg.accuracy_m !== undefined && msg.accuracy_m > MAX_RAW_ACCURACY_M) {
    return { valid: false, reject_reason: 'ABSURD_ACCURACY' };
  }

  // Teleport detection: if we have a previous position, check implied speed
  if (lastState?.last_lat !== undefined && lastState.last_lng !== undefined && lastState.last_ts) {
    const dist = haversineDistance(lastState.last_lat, lastState.last_lng, msg.lat, msg.lng);
    const timeDiffMs = pingTs.getTime() - new Date(lastState.last_ts).getTime();
    if (timeDiffMs > 0) {
      const impliedSpeed = dist / (timeDiffMs / 1000);
      if (impliedSpeed > MAX_SPEED_MPS) {
        return { valid: false, reject_reason: 'TELEPORT_DETECTED' };
      }
    }
  }

  return { valid: true, reject_reason: null };
}

async function processPing(msg: StreamPing): Promise<void> {
  const { carId, lat, lng, ts } = msg;
  const pingTs = new Date(ts);
  const serverNow = new Date();

  // Load last known state for anti-cheat checks
  const lastStateResult = await pool.query(
    'SELECT last_lat, last_lng, last_ts FROM car_last_state WHERE car_id = $1',
    [carId]
  );
  const lastState = lastStateResult.rows[0] as {
    last_lat?: number; last_lng?: number; last_ts?: string;
  } | undefined;

  // Anti-cheat gates
  const { valid, reject_reason } = validatePing(msg, lastState, serverNow);
  if (!valid) {
    console.warn(`Ping rejected for car ${carId}: ${reject_reason}`);
    await pool.query(
      `UPDATE location_pings_raw SET is_valid = false, reject_reason = $1
       WHERE car_id = $2 AND ts_normalized = $3`,
      [reject_reason, carId, pingTs]
    ).catch((err) => console.debug('Non-critical: failed to mark raw ping invalid:', err));
    return;
  }

  // Movement status
  let movementStatus: string = 'MOVING';
  if (lastState?.last_lat !== undefined && lastState.last_lng !== undefined && lastState.last_ts) {
    const dist = haversineDistance(lastState.last_lat, lastState.last_lng, lat, lng);
    const timeDiffMs = pingTs.getTime() - new Date(lastState.last_ts).getTime();
    const speedMps = timeDiffMs > 0 ? dist / (timeDiffMs / 1000) : 0;
    if (speedMps < 0.5 && dist < 10) movementStatus = 'STOPPED';
  }

  // Look up car/event info (car override > event default per spec)
  const carResult = await pool.query(
    `SELECT c.id, c.sharing_mode, c.public_delay_sec, c.public_blur_m, c.is_hidden_public,
            e.id as event_id, e.default_public_delay_sec, e.default_public_blur_m
     FROM cars c JOIN events e ON e.id = c.event_id
     WHERE c.id = $1`,
    [carId]
  );
  const car = carResult.rows[0] as {
    id: string; sharing_mode: string; public_delay_sec: number | null;
    public_blur_m: number | null; is_hidden_public: boolean;
    event_id: string; default_public_delay_sec: number; default_public_blur_m: number;
  } | undefined;
  if (!car) return;

  // Determine current stage from active stage time windows
  const stageResult = await pool.query(
    `SELECT id FROM stages WHERE event_id = $1
     AND (starts_at IS NULL OR starts_at <= $2)
     AND (ends_at IS NULL OR ends_at >= $2)
     ORDER BY ordinal DESC LIMIT 1`,
    [car.event_id, pingTs]
  );
  const currentStageId: string | null = stageResult.rows[0]?.id ?? null;

  await pool.query(
    `INSERT INTO car_last_state (car_id, last_ts, last_lat, last_lng, status, last_stage_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (car_id) DO UPDATE SET
       last_ts = EXCLUDED.last_ts,
       last_lat = EXCLUDED.last_lat,
       last_lng = EXCLUDED.last_lng,
       status = EXCLUDED.status,
       last_stage_id = COALESCE(EXCLUDED.last_stage_id, car_last_state.last_stage_id),
       updated_at = NOW()`,
    [carId, pingTs, lat, lng, movementStatus, currentStageId]
  );

  // Strict precedence: car override > event default
  const delaySec = car.public_delay_sec ?? car.default_public_delay_sec ?? 600;
  const blurM = car.public_blur_m ?? car.default_public_blur_m ?? DEFAULT_PUBLIC_BLUR_M;
  const publicTs = new Date(pingTs.getTime() - delaySec * 1000);

  // Checkpoint detection: check all active checkpoints in current stage
  if (currentStageId) {
    const checkpointResult = await pool.query(
      `SELECT * FROM checkpoints WHERE stage_id = $1 AND is_active = true ORDER BY ordinal`,
      [currentStageId]
    );

    for (const cp of checkpointResult.rows as {
      id: string; lat: number; lng: number; radius_m: number;
    }[]) {
      const dist = haversineDistance(lat, lng, cp.lat, cp.lng);
      const effectiveRadius = cp.radius_m + (msg.accuracy_m ?? 0) * 0.5;

      // Speed gate: car moving too fast to count as a checkpoint arrival
      if (msg.speed_mps !== undefined && msg.speed_mps > 30) continue;
      // Accuracy gate: GPS reading too poor to be trusted
      if (msg.accuracy_m !== undefined && msg.accuracy_m > 150) continue;

      if (dist <= effectiveRadius) {
        try {
          // Uniqueness per (car_id, checkpoint_id, stage_id) via stage_runs
          await pool.query(
            `INSERT INTO stage_runs (car_id, stage_id, checkpoint_id, arrived_at, confidence)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (car_id, checkpoint_id, stage_id) DO NOTHING`,
            [carId, currentStageId, cp.id, pingTs, 0.8]
          );

          await pool.query(
            `INSERT INTO checkpoint_events
               (car_id, checkpoint_id, stage_id, event_id, arrived_at, confidence)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [carId, cp.id, currentStageId, car.event_id, pingTs, 0.8]
          );

          await pool.query(
            `UPDATE car_last_state SET next_checkpoint_id = (
               SELECT cp2.id FROM checkpoints cp2
               WHERE cp2.stage_id = $2 AND cp2.is_active = true AND cp2.ordinal > (
                 SELECT ordinal FROM checkpoints WHERE id = $3
               )
               ORDER BY cp2.ordinal LIMIT 1
             ) WHERE car_id = $1`,
            [carId, currentStageId, cp.id]
          );

          const cpPayload = JSON.stringify({
            type: 'CHECKPOINT_ARRIVED',
            carId,
            checkpointId: cp.id,
            stageId: currentStageId,
            arrivedAt: pingTs.toISOString(),
          });
          await publisher.publish(`ops:event:${car.event_id}`, cpPayload);
          await publisher.publish(`public:event:${car.event_id}`, cpPayload);
        } catch {
          // ON CONFLICT handles duplicates — not an error
        }
      }
    }
  }

  // Emit ops car update (precise location — no sanitisation for ops)
  await publisher.publish(`ops:event:${car.event_id}`, JSON.stringify({
    type: 'CAR_UPDATE',
    event_id: car.event_id,
    car_id: carId,
    ts: pingTs.toISOString(),
    lat,
    lng,
    status: movementStatus,
    stage_id: currentStageId,
    last_update_age_sec: 0,
  }));

  // Emit public car update (sanitised per spec: delay + deterministic jitter with salt)
  if (!car.is_hidden_public && car.sharing_mode !== 'PAUSED' && car.sharing_mode !== 'CITY_ONLY') {
    const timeBucket = Math.floor(pingTs.getTime() / JITTER_CHANGE_INTERVAL_MS);
    const { dLat, dLng } = deterministicJitter(carId, timeBucket, blurM);

    await publisher.publish(`public:event:${car.event_id}`, JSON.stringify({
      type: 'CAR_UPDATE',
      event_id: car.event_id,
      car_id: carId,
      ts: publicTs.toISOString(),
      lat: Math.round((lat + dLat) * 1000) / 1000,
      lng: Math.round((lng + dLng) * 1000) / 1000,
      status: movementStatus,
      stage_id: currentStageId,
      last_update_age_sec: Math.round(delaySec),
      // raw accuracy / speed / heading intentionally omitted from public payload
    }));
  } else if (car.sharing_mode === 'CITY_ONLY' && !car.is_hidden_public) {
    await publisher.publish(`public:event:${car.event_id}`, JSON.stringify({
      type: 'CAR_UPDATE',
      event_id: car.event_id,
      car_id: carId,
      status: 'CITY_ONLY',
      stage_id: currentStageId,
    }));
  }
}

/** Ensure the consumer group exists; if the stream doesn't exist yet, create it with $. */
async function ensureConsumerGroup(): Promise<void> {
  try {
    await consumer.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`Consumer group "${GROUP_NAME}" created on stream "${STREAM_NAME}"`);
  } catch (err: unknown) {
    // BUSYGROUP = group already exists; that's fine
    if (err instanceof Error && !err.message.includes('BUSYGROUP')) {
      throw err;
    }
  }
}

async function pollStream(): Promise<void> {
  // 1. Reclaim stale pending messages (idle > 5 000 ms)
  const claimed = await consumer.xautoclaim(
    STREAM_NAME, GROUP_NAME, CONSUMER_NAME,
    5000, '0-0', 'COUNT', 10
  ) as [string, Array<[string, string[]]>];

  for (const [id, fields] of (claimed[1] ?? [])) {
    await handleStreamEntry(id, fields, true);
  }

  // 2. Read new messages
  const results = await consumer.xreadgroup(
    'GROUP', GROUP_NAME, CONSUMER_NAME,
    'COUNT', 10, 'BLOCK', 2000,
    'STREAMS', STREAM_NAME, '>'
  ) as Array<[string, Array<[string, string[]]>]> | null;

  if (!results) return;
  for (const [, entries] of results) {
    for (const [id, fields] of entries) {
      await handleStreamEntry(id, fields, false);
    }
  }
}

async function handleStreamEntry(id: string, fields: string[], isRetry: boolean): Promise<void> {
  const msg = parseStreamEntry(fields);
  if (!msg) {
    await consumer.xack(STREAM_NAME, GROUP_NAME, id);
    return;
  }

  if (isRetry) {
    // XPENDING per-message returns: [messageId, consumerName, idleTimeMs, deliveryCount]
    const pending = await consumer.xpending(STREAM_NAME, GROUP_NAME, id, id, 1) as Array<[string, string, number, number]>;
    if (pending.length > 0 && pending[0][3] >= MAX_DELIVERY_ATTEMPTS) {
      console.error(`Dead-lettering message ${id} after ${MAX_DELIVERY_ATTEMPTS} attempts`);
      await consumer.xadd(DEAD_LETTER_STREAM, '*', ...fields);
      await consumer.xack(STREAM_NAME, GROUP_NAME, id);
      return;
    }
  }

  try {
    await processPing(msg);
    await consumer.xack(STREAM_NAME, GROUP_NAME, id);
  } catch (err) {
    console.error(`Error processing stream entry ${id}:`, err);
    // Do NOT ACK — message stays in PEL for retry
  }
}

async function main(): Promise<void> {
  console.log('Location processor starting (Redis Streams mode)...');

  await ensureConsumerGroup();
  console.log(`Consuming stream "${STREAM_NAME}" in group "${GROUP_NAME}" as "${CONSUMER_NAME}"`);

  const loop = async (): Promise<void> => {
    await pollStream();
    setImmediate(loop);
  };
  loop().catch((err) => {
    console.error('Poll loop fatal error:', err);
    process.exit(1);
  });

  const shutdown = async (): Promise<void> => {
    console.log('Shutting down processor...');
    await consumer.quit();
    await publisher.quit();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection in processor', reason);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Processor failed to start:', err);
  process.exit(1);
});
