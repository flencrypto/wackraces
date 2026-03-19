import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { query } from '../db';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/jwt';
import { RegisterSchema, LoginSchema, RefreshSchema } from '../schemas';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = RegisterSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);

    try {
      const result = await query(
        `INSERT INTO users (email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, created_at`,
        [body.email, body.phone ?? null, passwordHash, body.role]
      );
      const user = result.rows[0];
      const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
      const refreshToken = signRefreshToken({ sub: user.id, email: user.email, role: user.role });
      return reply.status(201).send({ accessToken, refreshToken, user });
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw err;
    }
  });

  fastify.post('/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = LoginSchema.parse(request.body);
    const result = await query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [body.email]
    );
    const user = result.rows[0];
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, email: user.email, role: user.role });
    return reply.send({ accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } });
  });

  fastify.post('/v1/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = RefreshSchema.parse(request.body);
    try {
      const payload = verifyRefreshToken(body.refreshToken);
      const accessToken = signAccessToken({ sub: payload.sub, email: payload.email, role: payload.role });
      const refreshToken = signRefreshToken({ sub: payload.sub, email: payload.email, role: payload.role });
      return reply.send({ accessToken, refreshToken });
    } catch {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }
  });

  fastify.post('/v1/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    // In production, invalidate token in Redis/DB. For now, acknowledge logout.
    return reply.send({ message: 'Logged out' });
  });
}
