import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/middleware';
import { PresignSchema } from '../schemas';
import { config } from '../config';
import * as crypto from 'crypto';

export async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/media/presign', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = PresignSchema.parse(request.body);
    const key = `uploads/${body.carId ?? 'misc'}/${Date.now()}-${crypto.randomUUID()}-${body.filename}`;

    // Stub: in production, generate real S3 presigned URL
    const uploadUrl = config.s3Endpoint
      ? `${config.s3Endpoint}/${config.s3Bucket}/${key}?mock=true`
      : `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}?mock=true`;

    return reply.send({
      uploadUrl,
      key,
      bucket: config.s3Bucket,
      expiresIn: 3600,
    });
  });
}
