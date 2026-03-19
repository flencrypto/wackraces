/**
 * Tests for production config validation and health check.
 */

describe('config production validation', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('throws if JWT_SECRET is the default value in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'dev-secret-change-in-prod';
    process.env.JWT_REFRESH_SECRET = 'a-valid-refresh-secret-that-is-long-enough-for-prod';
    expect(() => require('../src/config')).toThrow('JWT_SECRET must be set to a strong secret in production');
  });

  test('throws if JWT_REFRESH_SECRET is the default value in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-valid-strong-secret-that-is-long-enough-1234';
    process.env.JWT_REFRESH_SECRET = 'dev-refresh-secret';
    expect(() => require('../src/config')).toThrow('JWT_REFRESH_SECRET must be set to a strong secret in production');
  });

  test('throws if JWT_SECRET is shorter than 32 chars in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'tooshort';
    process.env.JWT_REFRESH_SECRET = 'a-valid-refresh-secret-that-is-long-enough-for-prod';
    expect(() => require('../src/config')).toThrow('JWT_SECRET must be at least 32 characters in production');
  });

  test('throws if JWT_REFRESH_SECRET is shorter than 32 chars in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-valid-strong-secret-that-is-long-enough-1234';
    process.env.JWT_REFRESH_SECRET = 'tooshort';
    expect(() => require('../src/config')).toThrow('JWT_REFRESH_SECRET must be at least 32 characters in production');
  });

  test('does not throw in development with default secrets', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'dev-secret-change-in-prod';
    process.env.JWT_REFRESH_SECRET = 'dev-refresh-secret';
    expect(() => require('../src/config')).not.toThrow();
  });

  test('does not throw in production with strong secrets', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-valid-strong-secret-that-is-long-enough-1234';
    process.env.JWT_REFRESH_SECRET = 'a-valid-refresh-secret-that-is-long-enough-for-prod';
    expect(() => require('../src/config')).not.toThrow();
  });

  test('exports CORS_ORIGIN from environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGIN = 'https://wackraces.example.com';
    const { config } = require('../src/config') as typeof import('../src/config');
    expect(config.corsOrigin).toBe('https://wackraces.example.com');
  });

  test('exports dbPoolMax from environment', () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_POOL_MAX = '15';
    const { config } = require('../src/config') as typeof import('../src/config');
    expect(config.dbPoolMax).toBe(15);
  });
});
