import Redis from 'ioredis';
import { Pool } from 'pg';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://wackraces:wackraces@localhost:5432/wackraces';
const EARTH_RADIUS_M = 6371000;
/** Jitter time bucket duration — offset changes slowly to avoid "dot chasing" */
const JITTER_CHANGE_INTERVAL_MS = 3 * 60 * 1000;
/** Deduplication window for checkpoint arrivals (in minutes) */
const CHECKPOINT_DEDUP_WINDOW_MINUTES = 5;

const pool = new Pool({ connectionString: DATABASE_URL });
const subscriber = new Redis(REDIS_URL);
const publisher = new Redis(REDIS_URL);

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface PingMessage {
  carId: string;
  lat: number;
  lng: number;
  ts: string;
  accuracy_m?: number;
}

async function processPing(msg: PingMessage): Promise<void> {
  const { carId, lat, lng, ts } = msg;
  const pingTs = new Date(ts);

  const lastStateResult = await pool.query(
    'SELECT last_lat, last_lng, last_ts FROM car_last_state WHERE car_id = $1',
    [carId]
  );
  const lastState = lastStateResult.rows[0] as { last_lat?: number; last_lng?: number; last_ts?: string } | undefined;

  let movementStatus: string = 'MOVING';
  if (lastState?.last_lat !== undefined && lastState?.last_lng !== undefined && lastState?.last_ts) {
    const dist = haversineDistance(lastState.last_lat, lastState.last_lng, lat, lng);
    const timeDiffMs = pingTs.getTime() - new Date(lastState.last_ts).getTime();
    const speedMps = timeDiffMs > 0 ? dist / (timeDiffMs / 1000) : 0;
    if (speedMps < 0.5 && dist < 10) movementStatus = 'STOPPED';
  }

  // Look up car/event info
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

  const delaySec = car.public_delay_sec ?? car.default_public_delay_sec ?? 600;
  const publicTs = new Date(pingTs.getTime() - delaySec * 1000);

  // Checkpoint detection: check all active checkpoints in current stage
  if (currentStageId) {
    const checkpointResult = await pool.query(
      `SELECT * FROM checkpoints WHERE stage_id = $1 AND is_active = true ORDER BY ordinal`,
      [currentStageId]
    );

    for (const cp of checkpointResult.rows as { id: string; lat: number; lng: number; radius_m: number }[]) {
      const dist = haversineDistance(lat, lng, cp.lat, cp.lng);
      if (dist <= cp.radius_m + (msg.accuracy_m ?? 0) * 0.5) {
        // Check for recent duplicate (within 5 minutes)
        const existingResult = await pool.query(
          `SELECT id FROM checkpoint_events
           WHERE car_id = $1 AND checkpoint_id = $2
           AND arrived_at > NOW() - ($3 * interval '1 minute')`,
          [carId, cp.id, CHECKPOINT_DEDUP_WINDOW_MINUTES]
        );

        if (existingResult.rowCount === 0) {
          await pool.query(
            `INSERT INTO checkpoint_events (car_id, checkpoint_id, stage_id, event_id, arrived_at, confidence)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [carId, cp.id, currentStageId, car.event_id, pingTs, 0.8]
          );

          // Update next_checkpoint_id to the next unvisited checkpoint
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

          // Emit checkpoint arrival to ops + public channels
          await publisher.publish(`ops:event:${car.event_id}`, JSON.stringify({
            type: 'CHECKPOINT_ARRIVED',
            carId,
            checkpointId: cp.id,
            stageId: currentStageId,
            arrivedAt: pingTs.toISOString(),
          }));

          await publisher.publish(`public:event:${car.event_id}`, JSON.stringify({
            type: 'CHECKPOINT_ARRIVED',
            carId,
            checkpointId: cp.id,
            stageId: currentStageId,
            arrivedAt: pingTs.toISOString(),
          }));
        }
      }
    }
  }

  // Emit ops car update (precise location)
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

  // Emit public car update (sanitised: delayed + rounded)
  if (!car.is_hidden_public && car.sharing_mode !== 'PAUSED' && car.sharing_mode !== 'CITY_ONLY') {
    const blurM = car.public_blur_m ?? car.default_public_blur_m ?? 400;
    // Simple deterministic jitter
    const timeBucket = Math.floor(pingTs.getTime() / JITTER_CHANGE_INTERVAL_MS);
    let hash = 0;
    const seed = `${carId}:${timeBucket}`;
    for (let i = 0; i < seed.length; i++) {
      hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
    }
    const hash2 = (Math.imul(31, hash) + 7) | 0;
    const dLat = ((hash % 1000) / 1000) * blurM / 111320;
    const dLng = ((hash2 % 1000) / 1000) * blurM / 111320;

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

async function main(): Promise<void> {
  console.log('Location processor starting...');

  await subscriber.subscribe('location:ingest', (err) => {
    if (err) {
      console.error('Failed to subscribe:', err);
      process.exit(1);
    }
    console.log('Subscribed to location:ingest');
  });

  subscriber.on('message', async (_channel: string, message: string) => {
    try {
      const ping = JSON.parse(message) as PingMessage;
      await processPing(ping);
    } catch (err) {
      console.error('Error processing ping:', err);
    }
  });

  const shutdown = async (): Promise<void> => {
    console.log('Shutting down processor...');
    await subscriber.quit();
    await publisher.quit();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Processor failed to start:', err);
  process.exit(1);
});
