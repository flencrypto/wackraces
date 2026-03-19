import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, TokenPayload } from './jwt';
import { query } from '../db';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    request.user = payload;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.user || !roles.includes(request.user.role)) {
      reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

export async function requireCarMembership(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const params = request.params as Record<string, string>;
  const carId = params.carId ?? params.id;
  if (!carId || !request.user) {
    reply.status(400).send({ error: 'Car ID required' });
    return;
  }
  const result = await query(
    'SELECT id FROM car_memberships WHERE user_id = $1 AND car_id = $2',
    [request.user.sub, carId]
  );
  if (result.rowCount === 0) {
    reply.status(403).send({ error: 'Not a member of this car' });
  }
}
