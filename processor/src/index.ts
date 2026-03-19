import Redis from 'ioredis';
import { Pool } from 'pg';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://wackraces:wackraces@localhost:5432/wackraces';
const EARTH_RADIUS_M = 6371000;

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
  const lastState = lastStateResult.rows[0];

  let movementStatus: string = 'MOVING';
  if (lastState?.last_lat && lastState?.last_lng) {
    const dist = haversineDistance(lastState.last_lat, lastState.last_lng, lat, lng);
    const timeDiffMs = pingTs.getTime() - new Date(lastState.last_ts).getTime();
    const speedMps = timeDiffMs > 0 ? dist / (timeDiffMs / 1000) : 0;
    if (speedMps < 0.5 && dist < 10) movementStatus = 'STOPPED';
  }

  await pool.query(
    `INSERT INTO car_last_state (car_id, last_ts, last_lat, last_lng, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (car_id) DO UPDATE SET
       last_ts = EXCLUDED.last_ts,
       last_lat = EXCLUDED.last_lat,
       last_lng = EXCLUDED.last_lng,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [carId, pingTs, lat, lng, movementStatus]
  );

  const carResult = await pool.query(
    `SELECT c.sharing_mode, c.public_delay_sec, c.public_blur_m,
            e.default_public_delay_sec, e.default_public_blur_m
     FROM cars c JOIN events e ON e.id = c.event_id
     WHERE c.id = $1`,
    [carId]
  );
  const car = carResult.rows[0];
  if (!car) return;

  const delaySec = car.public_delay_sec ?? car.default_public_delay_sec ?? 600;
  const publicTs = new Date(pingTs.getTime() - delaySec * 1000);

  const checkpointResult = await pool.query(
    `SELECT cp.* FROM checkpoints cp
     JOIN stages s ON s.id = cp.stage_id
     JOIN car_last_state cls ON cls.last_stage_id = s.id
     WHERE cls.car_id = $1 AND cp.is_active = true
     ORDER BY cp.ordinal`,
    [carId]
  );

  for (const cp of checkpointResult.rows) {
    const dist = haversineDistance(lat, lng, cp.lat, cp.lng);
    if (dist <= cp.radius_m) {
      const existingResult = await pool.query(
        `SELECT id FROM checkpoint_events
         WHERE car_id = $1 AND checkpoint_id = $2
         AND arrived_at > NOW() - INTERVAL '5 minutes'`,
        [carId, cp.id]
      );

      if (existingResult.rowCount === 0) {
        const cpResult = await pool.query(
          `INSERT INTO checkpoint_events (car_id, checkpoint_id, stage_id, event_id, arrived_at, confidence)
           SELECT $1, $2, s.id, s.event_id, $3, $4
           FROM checkpoints cp JOIN stages s ON s.id = cp.stage_id WHERE cp.id = $2
           RETURNING *`,
          [carId, cp.id, pingTs, 0.8]
        );

        if (cpResult.rows[0]) {
          await publisher.publish('ops:checkpoint', JSON.stringify({
            type: 'checkpoint_arrival',
            carId,
            checkpointId: cp.id,
            arrivedAt: pingTs,
          }));
        }
      }
    }
  }

  await publisher.publish(`ops:event:${carId}`, JSON.stringify({
    type: 'car_location',
    carId,
    lat,
    lng,
    ts: pingTs,
    status: movementStatus,
  }));

  if (car.sharing_mode !== 'PAUSED' && car.sharing_mode !== 'CITY_ONLY') {
    await publisher.publish(`public:car:${carId}`, JSON.stringify({
      type: 'car_location',
      carId,
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      ts: publicTs,
      status: movementStatus,
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

  process.on('SIGTERM', async () => {
    console.log('Shutting down processor...');
    await subscriber.quit();
    await publisher.quit();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Processor failed to start:', err);
  process.exit(1);
});
