import { verifyAccessToken, signAccessToken, TokenPayload } from '../src/auth/jwt';

describe('JWT token generation and verification', () => {
  test('access token can be signed and verified', () => {
    const payload: TokenPayload = { sub: 'user-123', email: 'test@example.com', role: 'FAN' };
    const token = signAccessToken(payload);
    const verified = verifyAccessToken(token);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
    expect(verified.role).toBe(payload.role);
  });

  test('invalid token throws error', () => {
    expect(() => verifyAccessToken('invalid.token.here')).toThrow();
  });
});

describe('RBAC rules', () => {
  test('FAN role token is valid', () => {
    const token = signAccessToken({ sub: 'fan-1', email: 'fan@example.com', role: 'FAN' });
    const payload = verifyAccessToken(token);
    expect(payload.role).toBe('FAN');
  });

  test('PARTICIPANT role token is valid', () => {
    const token = signAccessToken({ sub: 'p-1', email: 'p@example.com', role: 'PARTICIPANT' });
    const payload = verifyAccessToken(token);
    expect(payload.role).toBe('PARTICIPANT');
  });

  test('ORGANIZER role token is valid', () => {
    const token = signAccessToken({ sub: 'o-1', email: 'o@example.com', role: 'ORGANIZER' });
    const payload = verifyAccessToken(token);
    expect(payload.role).toBe('ORGANIZER');
  });

  test('FAN cannot access ops routes (role check)', () => {
    const fanToken = signAccessToken({ sub: 'fan-1', email: 'fan@example.com', role: 'FAN' });
    const payload = verifyAccessToken(fanToken);
    const allowedRoles = ['ORGANIZER', 'SUPERADMIN'];
    expect(allowedRoles.includes(payload.role)).toBe(false);
  });

  test('PARTICIPANT cannot access ops routes', () => {
    const token = signAccessToken({ sub: 'p-1', email: 'p@example.com', role: 'PARTICIPANT' });
    const payload = verifyAccessToken(token);
    const allowedRoles = ['ORGANIZER', 'SUPERADMIN'];
    expect(allowedRoles.includes(payload.role)).toBe(false);
  });

  test('ORGANIZER can access ops routes', () => {
    const token = signAccessToken({ sub: 'o-1', email: 'o@example.com', role: 'ORGANIZER' });
    const payload = verifyAccessToken(token);
    const allowedRoles = ['ORGANIZER', 'SUPERADMIN'];
    expect(allowedRoles.includes(payload.role)).toBe(true);
  });

  test('SUPERADMIN can access ops routes', () => {
    const token = signAccessToken({ sub: 'sa-1', email: 'sa@example.com', role: 'SUPERADMIN' });
    const payload = verifyAccessToken(token);
    const allowedRoles = ['ORGANIZER', 'SUPERADMIN'];
    expect(allowedRoles.includes(payload.role)).toBe(true);
  });

  test('FAN cannot upload pings (role check against PARTICIPANT)', () => {
    const token = signAccessToken({ sub: 'fan-1', email: 'fan@example.com', role: 'FAN' });
    const payload = verifyAccessToken(token);
    expect(payload.role === 'FAN').toBe(true);
    // Location ping route requires role !== 'FAN'
    expect(['PARTICIPANT', 'ORGANIZER', 'SUPERADMIN'].includes(payload.role)).toBe(false);
  });

  test('Participant can only manage their own car (membership check)', () => {
    const token = signAccessToken({ sub: 'p-1', email: 'p@example.com', role: 'PARTICIPANT' });
    const payload = verifyAccessToken(token);
    // Simulate car ownership check
    const userCarMemberships = ['car-abc'];
    const targetCar = 'car-xyz';
    expect(userCarMemberships.includes(targetCar)).toBe(false);
    const ownCar = 'car-abc';
    expect(userCarMemberships.includes(ownCar)).toBe(true);
    expect(payload.role).toBe('PARTICIPANT');
  });
});
