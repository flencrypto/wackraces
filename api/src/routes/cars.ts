import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireAuth, requireRole, requireCarMembership } from '../auth/middleware';
import { UpdateSharingSchema, OpsCarOverrideSchema } from '../schemas';

export async function carRoutes(fastify: FastifyInstance): Promise<void> {
  // Update sharing mode (participant for own car)
  fastify.patch('/v1/cars/:carId/sharing', {
    preHandler: requireCarMembership,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { carId } = request.params as { carId: string };
    const body = UpdateSharingSchema.parse(request.body);
    const result = await query(
      `UPDATE cars SET sharing_mode = $1, public_delay_sec = $2, public_blur_m = $3 WHERE id = $4 RETURNING *`,
      [body.sharing_mode, body.public_delay_sec ?? null, body.public_blur_m ?? null, carId]
    );
    if (!result.rows[0]) return reply.status(404).send({ error: 'Car not found' });
    return reply.send(result.rows[0]);
  });

  // Organizer update car
  fastify.patch('/v1/cars/:id', {
    preHandler: requireRole('ORGANIZER', 'SUPERADMIN'),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    return reply.send(result.rows[0]);
  });

  // Follow a car
  fastify.post('/v1/cars/:carId/follow', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { carId } = request.params as { carId: string };
    const userId = request.user!.sub;
    try {
      await query(
        'INSERT INTO follows (user_id, car_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, carId]
      );
    } catch {
      return reply.status(400).send({ error: 'Could not follow car' });
    }
    return reply.status(201).send({ message: 'Following' });
  });

  // Unfollow a car
  fastify.delete('/v1/cars/:carId/follow', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { carId } = request.params as { carId: string };
    const userId = request.user!.sub;
    await query('DELETE FROM follows WHERE user_id = $1 AND car_id = $2', [userId, carId]);
    return reply.send({ message: 'Unfollowed' });
  });
}
