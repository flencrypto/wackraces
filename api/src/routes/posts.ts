import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db';
import { requireCarMembership } from '../auth/middleware';
import { CreatePostSchema } from '../schemas';

export async function postRoutes(fastify: FastifyInstance): Promise<void> {
  // Create post (car member)
  fastify.post('/v1/cars/:carId/posts', {
    preHandler: requireCarMembership,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { carId } = request.params as { carId: string };
    const body = CreatePostSchema.parse(request.body);
    const userId = request.user!.sub;

    const car = await query('SELECT event_id FROM cars WHERE id = $1', [carId]);
    if (!car.rows[0]) return reply.status(404).send({ error: 'Car not found' });

    const result = await query(
      `INSERT INTO posts (car_id, event_id, caption, media, city_label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [carId, car.rows[0].event_id, body.caption ?? null,
       JSON.stringify(body.media), body.city_label ?? null, userId]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // Get event feed (paginated, cursor-based)
  fastify.get('/v1/events/:eventId/feed', async (request: FastifyRequest, reply: FastifyReply) => {
    const { eventId } = request.params as { eventId: string };
    const query_params = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(parseInt(query_params.limit ?? '20'), 100);
    const cursor = query_params.cursor ?? null;

    let sql: string;
    let params: unknown[];

    if (cursor) {
      sql = `SELECT p.*, u.email as author_email
             FROM posts p
             JOIN users u ON u.id = p.created_by
             WHERE p.event_id = $1 AND p.moderation_status = 'APPROVED'
             AND p.created_at < $2
             ORDER BY p.created_at DESC LIMIT $3`;
      params = [eventId, new Date(cursor).toISOString(), limit + 1];
    } else {
      sql = `SELECT p.*, u.email as author_email
             FROM posts p
             JOIN users u ON u.id = p.created_by
             WHERE p.event_id = $1 AND p.moderation_status = 'APPROVED'
             ORDER BY p.created_at DESC LIMIT $2`;
      params = [eventId, limit + 1];
    }

    const result = await query(sql, params);
    const hasMore = result.rows.length > limit;
    const posts = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore ? posts[posts.length - 1].created_at : null;

    return reply.send({ posts, nextCursor, hasMore });
  });
}
