import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireAuth } from '../auth/middleware';
import { PingBatchSchema } from '../schemas';
import { xaddPing } from '../services/redis';

export async function locationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/location/pings/batch', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const user = request.user;

    if (user.role === 'FAN') {
      return reply.status(403).send({ error: 'Participants only' });
    }

    const body = PingBatchSchema.parse(request.body);
    const carId = body.car_id;
    const now = new Date();

    const membership = await query(
      'SELECT id FROM car_memberships WHERE user_id = $1 AND car_id = $2',
      [user.sub, carId]
    );
    if (membership.rowCount === 0 && user.role !== 'ORGANIZER' && user.role !== 'SUPERADMIN') {
      return reply.status(403).send({ error: 'Not a member of this car' });
    }

    let accepted = 0;
    let deduped = 0;
    let rejected = 0;

    for (const ping of body.pings) {
      const deviceTs = new Date(ping.ts);
      const diffMs = Math.abs(now.getTime() - deviceTs.getTime());
      const tsNormalized = diffMs <= 5 * 60 * 1000 ? deviceTs : now;

      try {
        const result = await query(
          `INSERT INTO location_pings_raw
           (car_id, ts, lat, lng, accuracy_m, speed_mps, heading_deg, battery_pct, source, ingest_id,
            ts_device, ts_server_received, ts_normalized)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (car_id, ts_device) DO NOTHING
           RETURNING id`,
          [
            carId,
            tsNormalized.toISOString(),
            ping.lat,
            ping.lng,
            ping.accuracy_m ?? null,
            ping.speed_mps ?? null,
            ping.heading_deg ?? null,
            ping.battery_pct ?? null,
            ping.source ?? null,
            ping.ingest_id ?? null,
            deviceTs.toISOString(),
            now.toISOString(),
            tsNormalized.toISOString(),
          ]
        );

        if (result.rowCount === 0) {
          deduped++;
        } else {
          accepted++;
          await xaddPing({
            carId,
            lat: ping.lat,
            lng: ping.lng,
            ts: tsNormalized.toISOString(),
            accuracy_m: ping.accuracy_m,
            speed_mps: ping.speed_mps,
          });
        }
      } catch {
        rejected++;
      }
    }

    return reply.send({ accepted, deduped, rejected });
  });
}
