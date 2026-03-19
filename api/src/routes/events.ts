import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireRole } from '../auth/middleware';
import { CreateEventSchema, CreateStageSchema, CreateCheckpointSchema, CreateCarSchema } from '../schemas';
import { sanitizeLocation } from '../services/sanitize';
import { config } from '../config';

export async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  // Public: get event by slug
  fastify.get('/v1/events/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const result = await query(
      'SELECT id, slug, name, year, starts_at, ends_at, status, settings FROM events WHERE slug = $1',
      [slug]
    );
    if (!result.rows[0]) return reply.status(404).send({ error: 'Event not found' });
    return reply.send(result.rows[0]);
  });

  // Public: get stages for event
  fastify.get('/v1/events/:eventId/stages', async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const stages = await query(
      `SELECT s.*, json_agg(c.* ORDER BY c.ordinal) FILTER (WHERE c.id IS NOT NULL) as checkpoints
       FROM stages s
       LEFT JOIN checkpoints c ON c.stage_id = s.id AND c.is_active = true
       WHERE s.event_id = $1
       GROUP BY s.id ORDER BY s.ordinal`,
      [eventId]
    );
    return reply.send(stages.rows);
  });

  // Public: get cars with sanitized positions
  fastify.get('/v1/events/:eventId/cars', async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const event = await query(
      'SELECT default_public_delay_sec, default_public_blur_m FROM events WHERE id = $1',
      [eventId]
    );
    if (!event.rows[0]) return reply.status(404).send({ error: 'Event not found' });

    const cars = await query(
      `SELECT c.id, c.car_number, c.team_name, c.display_name, c.avatar_url, c.sponsor_tags,
              c.sharing_mode, c.public_delay_sec, c.public_blur_m, c.is_hidden_public,
              cls.last_ts, cls.last_lat, cls.last_lng, cls.status as movement_status,
              cls.last_stage_id, cls.next_checkpoint_id
       FROM cars c
       LEFT JOIN car_last_state cls ON cls.car_id = c.id
       WHERE c.event_id = $1 AND c.is_hidden_public = false`,
      [eventId]
    );

    const sanitized = cars.rows.map((car) => {
      const delaySec = car.public_delay_sec ?? event.rows[0].default_public_delay_sec ?? config.defaultPublicDelaySec;
      const blurM = car.public_blur_m ?? event.rows[0].default_public_blur_m ?? config.defaultPublicBlurM;

      if (!car.last_lat || !car.last_lng || !car.last_ts) {
        return { ...car, last_lat: null, last_lng: null };
      }

      const sanitizedLoc = sanitizeLocation({
        lat: car.last_lat,
        lng: car.last_lng,
        ts: new Date(car.last_ts),
        policy: {
          sharingMode: car.sharing_mode,
          delaySec,
          blurM,
        },
        carId: car.id,
      });

      return {
        id: car.id,
        car_number: car.car_number,
        team_name: car.team_name,
        display_name: car.display_name,
        avatar_url: car.avatar_url,
        sponsor_tags: car.sponsor_tags,
        last_lat: sanitizedLoc.lat,
        last_lng: sanitizedLoc.lng,
        last_ts: sanitizedLoc.ts,
        status: sanitizedLoc.status,
        cityOnly: sanitizedLoc.cityOnly,
        movement_status: car.movement_status,
        last_stage_id: car.last_stage_id,
        next_checkpoint_id: car.next_checkpoint_id,
      };
    });

    return reply.send(sanitized);
  });

  // Organizer: create event
  fastify.post('/v1/events', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateEventSchema.parse(request.body);
    const result = await query(
      `INSERT INTO events (slug, name, year, starts_at, ends_at, default_public_delay_sec, default_public_blur_m, status, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [body.slug, body.name, body.year, body.starts_at ?? null, body.ends_at ?? null,
       body.default_public_delay_sec, body.default_public_blur_m, body.status, JSON.stringify(body.settings)]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // Organizer: update event
  fastify.patch('/v1/events/:id', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = CreateEventSchema.partial().parse(request.body);
    const ALLOWED_FIELDS = new Set([
      'slug', 'name', 'year', 'starts_at', 'ends_at',
      'default_public_delay_sec', 'default_public_blur_m', 'status', 'settings',
    ]);
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined && ALLOWED_FIELDS.has(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(key === 'settings' ? JSON.stringify(val) : val);
      }
    }
    if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
    values.push(id);
    const result = await query(
      `UPDATE events SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows[0]) return reply.status(404).send({ error: 'Event not found' });
    return reply.send(result.rows[0]);
  });

  // Organizer: create stage
  fastify.post('/v1/events/:id/stages', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = CreateStageSchema.parse(request.body);
    const result = await query(
      `INSERT INTO stages (event_id, name, ordinal, starts_at, ends_at, route_polyline, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, body.name, body.ordinal, body.starts_at ?? null, body.ends_at ?? null,
       body.route_polyline ?? null, JSON.stringify(body.settings)]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // Organizer: create checkpoint
  fastify.post('/v1/stages/:id/checkpoints', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = CreateCheckpointSchema.parse(request.body);
    const result = await query(
      `INSERT INTO checkpoints (stage_id, name, type, lat, lng, radius_m, ordinal, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, body.name, body.type, body.lat, body.lng, body.radius_m, body.ordinal, body.is_active]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // Organizer: create car
  fastify.post('/v1/events/:id/cars', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = CreateCarSchema.parse(request.body);
    const result = await query(
      `INSERT INTO cars (event_id, car_number, team_name, display_name, avatar_url, sponsor_tags,
                        sharing_mode, public_delay_sec, public_blur_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, body.car_number, body.team_name ?? null, body.display_name ?? null,
       body.avatar_url ?? null, body.sponsor_tags,
       body.sharing_mode, body.public_delay_sec ?? null, body.public_blur_m ?? null]
    );
    return reply.status(201).send(result.rows[0]);
  });
}
