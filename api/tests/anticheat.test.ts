/**
 * Anti-cheat validation tests.
 *
 * Mirrors the pure validation logic in the processor without importing it
 * directly (the processor has no test harness), keeping unit tests fast.
 */

const EARTH_RADIUS_M = 6371000;
const MAX_SPEED_MPS = 80;
const MAX_RAW_ACCURACY_M = 1000;

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface StreamPing {
  carId: string;
  lat: number;
  lng: number;
  ts: string;
  accuracy_m?: number;
}

interface LastState {
  last_lat?: number;
  last_lng?: number;
  last_ts?: string;
}

function validatePing(
  msg: StreamPing,
  lastState: LastState | undefined,
  serverNow: Date
): { valid: boolean; reject_reason: string | null } {
  const pingTs = new Date(msg.ts);

  const tsDiffMs = Math.abs(serverNow.getTime() - pingTs.getTime());
  if (tsDiffMs > 5 * 60 * 1000) {
    return { valid: false, reject_reason: 'TIMESTAMP_SANITY' };
  }

  if (msg.accuracy_m !== undefined && msg.accuracy_m > MAX_RAW_ACCURACY_M) {
    return { valid: false, reject_reason: 'ABSURD_ACCURACY' };
  }

  if (lastState?.last_lat !== undefined && lastState.last_lng !== undefined && lastState.last_ts) {
    const dist = haversineDistance(lastState.last_lat, lastState.last_lng, msg.lat, msg.lng);
    const timeDiffMs = pingTs.getTime() - new Date(lastState.last_ts).getTime();
    if (timeDiffMs > 0) {
      const impliedSpeed = dist / (timeDiffMs / 1000);
      if (impliedSpeed > MAX_SPEED_MPS) {
        return { valid: false, reject_reason: 'TELEPORT_DETECTED' };
      }
    }
  }

  return { valid: true, reject_reason: null };
}

const SERVER_NOW = new Date('2024-03-01T12:00:00Z');
const VALID_PING: StreamPing = {
  carId: 'car-1',
  lat: 48.8566,
  lng: 2.3522,
  ts: SERVER_NOW.toISOString(),
  accuracy_m: 15,
};

describe('Anti-cheat: timestamp sanity', () => {
  test('accepts ping within 5 minutes', () => {
    expect(validatePing(VALID_PING, undefined, SERVER_NOW).valid).toBe(true);
  });

  test('accepts ping exactly 5 minutes old', () => {
    const ts = new Date(SERVER_NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(validatePing({ ...VALID_PING, ts }, undefined, SERVER_NOW).valid).toBe(true);
  });

  test('rejects ping older than 5 minutes', () => {
    const ts = new Date(SERVER_NOW.getTime() - 5 * 60 * 1000 - 1).toISOString();
    const result = validatePing({ ...VALID_PING, ts }, undefined, SERVER_NOW);
    expect(result.valid).toBe(false);
    expect(result.reject_reason).toBe('TIMESTAMP_SANITY');
  });

  test('rejects ping more than 5 minutes in the future', () => {
    const ts = new Date(SERVER_NOW.getTime() + 5 * 60 * 1000 + 1000).toISOString();
    const result = validatePing({ ...VALID_PING, ts }, undefined, SERVER_NOW);
    expect(result.valid).toBe(false);
    expect(result.reject_reason).toBe('TIMESTAMP_SANITY');
  });
});

describe('Anti-cheat: accuracy gate', () => {
  test('accepts ping at accuracy limit (1000m)', () => {
    expect(validatePing({ ...VALID_PING, accuracy_m: 1000 }, undefined, SERVER_NOW).valid).toBe(true);
  });

  test('rejects ping with accuracy above limit', () => {
    const result = validatePing({ ...VALID_PING, accuracy_m: 1001 }, undefined, SERVER_NOW);
    expect(result.valid).toBe(false);
    expect(result.reject_reason).toBe('ABSURD_ACCURACY');
  });

  test('accepts ping with no accuracy field', () => {
    expect(validatePing({ ...VALID_PING, accuracy_m: undefined }, undefined, SERVER_NOW).valid).toBe(true);
  });
});

describe('Anti-cheat: teleport detection', () => {
  const lastState: LastState = {
    last_lat: 48.8566,
    last_lng: 2.3522,
    last_ts: SERVER_NOW.toISOString(),
  };

  test('accepts normal movement speed', () => {
    const newLat = 48.8566 + (100 / 111320);
    const newTs = new Date(SERVER_NOW.getTime() + 10000).toISOString();
    expect(validatePing({ ...VALID_PING, lat: newLat, ts: newTs }, lastState, new Date(newTs)).valid).toBe(true);
  });

  test('rejects teleport (>80 m/s implied speed)', () => {
    const newTs = new Date(SERVER_NOW.getTime() + 1000).toISOString();
    const result = validatePing(
      { ...VALID_PING, lat: 51.5074, lng: -0.1278, ts: newTs },
      lastState,
      new Date(newTs)
    );
    expect(result.valid).toBe(false);
    expect(result.reject_reason).toBe('TELEPORT_DETECTED');
  });

  test('accepts first ping with no last state', () => {
    expect(validatePing(VALID_PING, undefined, SERVER_NOW).valid).toBe(true);
  });

  test('ignores movement check when timeDiffMs <= 0', () => {
    expect(validatePing({ ...VALID_PING, lat: 51.5074, lng: -0.1278 }, lastState, SERVER_NOW).valid).toBe(true);
  });
});
