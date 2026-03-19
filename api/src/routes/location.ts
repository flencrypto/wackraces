import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireAuth } from '../auth/middleware';
import { PingBatchSchema } from '../schemas';
import { publish } from '../services/redis';

export async function locationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/location/pings:batch', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const user = request.user;

    if (user.role === 'FAN') {
      return reply.status(403).send({ error: 'Participants only' });
    }

    const body = PingBatchSchema.parse(request.body);
    const now = new Date();

    let accepted = 0;
    let deduped = 0;
    let rejected = 0;

    for (const ping of body.pings) {
      // Validate car membership
      const membership = await query(
        'SELECT id FROM car_memberships WHERE user_id = $1 AND car_id = $2',
        [user.sub, ping.car_id]
      );
      if (membership.rowCount === 0) {
        rejected++;
        continue;
      }

      try {
        const result = await query(
          `INSERT INTO location_pings_raw
           (car_id, ts, lat, lng, accuracy_m, speed_mps, heading_deg, battery_pct, source, ingest_id,
            ts_device, ts_server_received, ts_normalized)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (car_id, ts_device) DO NOTHING
           RETURNING id`,
          [
            ping.car_id,
            ping.ts_device,
            ping.lat,
            ping.lng,
            ping.accuracy_m ?? null,
            ping.speed_mps ?? null,
            ping.heading_deg ?? null,
            ping.battery_pct ?? null,
            ping.source ?? null,
            ping.ingest_id ?? null,
            ping.ts_device,
            now.toISOString(),
            ping.ts_device,
          ]
        );

        if (result.rowCount === 0) {
          deduped++;
        } else {
          accepted++;
          // Publish to Redis for processor
          await publish('location:ingest', {
            carId: ping.car_id,
            lat: ping.lat,
            lng: ping.lng,
            ts: ping.ts_device,
            accuracy_m: ping.accuracy_m,
          });
        }
      } catch {
        rejected++;
      }
    }

    return reply.send({ accepted, deduped, rejected });
  });
}
