const DEV_JWT_SECRET = 'dev-secret-change-in-prod';
const DEV_JWT_REFRESH_SECRET = 'dev-refresh-secret';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? DEV_JWT_REFRESH_SECRET,
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '30d',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://wackraces:wackraces@localhost:5432/wackraces',
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 20),
  dbIdleTimeoutMs: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000),
  dbConnectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisStreamName: process.env.REDIS_STREAM_NAME ?? 'loc_ingest',
  redisStreamGroup: process.env.REDIS_STREAM_GROUP ?? 'loc_processor_group',
  s3Bucket: process.env.S3_BUCKET ?? 'wackraces-media',
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Endpoint: process.env.S3_ENDPOINT ?? '',
  jitterSalt: process.env.JITTER_SALT ?? 'dev-jitter-salt',
  maxPingsPerBatch: 200,
  defaultPublicDelaySec: 600,
  defaultPublicBlurM: 400,
  wsRateLimitPublicMs: 3000,
  wsRateLimitOpsMs: 1000,
};

if (config.nodeEnv === 'production') {
  if (config.jwtSecret === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a strong secret in production');
  }
  if (config.jwtRefreshSecret === DEV_JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be set to a strong secret in production');
  }
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  if (config.jwtRefreshSecret.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production');
  }
}
