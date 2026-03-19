import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireRole } from '../auth/middleware';
import { UpdatePostSchema, CreateBroadcastSchema, ManualCheckpointSchema, OpsCarOverrideSchema } from '../schemas';
import { auditLog } from '../services/audit';

export async function opsRoutes(fastify: FastifyInstance): Promise<void> {
  const isOrg = requireRole('ORGANIZER', 'SUPERADMIN');

  // Get precise car last states for ops map
  fastify.get('/v1/ops/events/:id/map', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await query(
        `SELECT c.id, c.car_number, c.display_name, c.sharing_mode,
                cls.last_ts, cls.last_lat, cls.last_lng, cls.status,
                cls.last_stage_id, cls.next_checkpoint_id, cls.updated_at
         FROM cars c
         LEFT JOIN car_last_state cls ON cls.car_id = c.id
         WHERE c.event_id = $1`,
        [id]
      );
      return reply.send(result.rows);
    }
  );

  // Get moderation queue
  fastify.get('/v1/ops/events/:id/posts', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const q = request.query as { status?: string };
      const status = q.status ?? 'PENDING';
      const result = await query(
        `SELECT p.*, u.email as author_email
         FROM posts p
         JOIN users u ON u.id = p.created_by
         WHERE p.event_id = $1 AND p.moderation_status = $2
         ORDER BY p.created_at ASC`,
        [id, status]
      );
      return reply.send(result.rows);
    }
  );

  // Moderate post
  fastify.patch('/v1/ops/posts/:id', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = UpdatePostSchema.parse(request.body);
      const result = await query(
        'UPDATE posts SET moderation_status = $1 WHERE id = $2 RETURNING *',
        [body.moderation_status, id]
      );
      if (!result.rows[0]) return reply.status(404).send({ error: 'Post not found' });
      await auditLog(request.user!.sub, 'MODERATE_POST', 'post', id, { moderation_status: body.moderation_status });
      return reply.send(result.rows[0]);
    }
  );

  // Create broadcast
  fastify.post('/v1/ops/events/:id/broadcasts', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = CreateBroadcastSchema.parse(request.body);
      const userId = request.user!.sub;
      const result = await query(
        `INSERT INTO broadcasts (event_id, title, body, audience, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, body.title, body.body, body.audience, userId]
      );
      await auditLog(userId, 'CREATE_BROADCAST', 'event', id, { audience: body.audience });
      return reply.status(201).send(result.rows[0]);
    }
  );

  // Manual checkpoint override
  fastify.post('/v1/ops/cars/:id/checkpoint', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = ManualCheckpointSchema.parse(request.body);
      const result = await query(
        `INSERT INTO checkpoint_events (car_id, checkpoint_id, stage_id, event_id, arrived_at, confidence)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, body.checkpoint_id, body.stage_id, body.event_id,
         body.arrived_at, body.confidence]
      );
      await auditLog(request.user!.sub, 'MANUAL_CHECKPOINT', 'car', id,
        { checkpoint_id: body.checkpoint_id, arrived_at: body.arrived_at });
      return reply.status(201).send(result.rows[0]);
    }
  );

  // Organizer car overrides (hide, delay, city-only)
  fastify.patch('/v1/ops/cars/:id', { preHandler: isOrg },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = OpsCarOverrideSchema.parse(request.body);
      const ALLOWED_FIELDS = new Set(['is_hidden_public', 'sharing_mode', 'public_delay_sec', 'public_blur_m']);
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(body)) {
        if (val !== undefined && ALLOWED_FIELDS.has(key)) {
          fields.push(`${key} = $${idx++}`);
          values.push(val);
        }
      }
      if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
      values.push(id);
      const result = await query(
        `UPDATE cars SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (!result.rows[0]) return reply.status(404).send({ error: 'Car not found' });
      await auditLog(request.user!.sub, 'CAR_OVERRIDE', 'car', id, body as Record<string, unknown>);
      return reply.send(result.rows[0]);
    }
  );
}
