import {
  detectCheckpointArrival,
  haversineDistance,
  isPingInsideCheckpoint,
  passesAccuracyGate,
  passesSpeedGate,
  Ping,
  Checkpoint,
} from '../src/services/checkpoint';

const checkpoint: Checkpoint = {
  id: 'cp-001',
  lat: 48.8566,
  lng: 2.3522,
  radius_m: 100,
};

function makeTs(offsetMs: number = 0): Date {
  return new Date(Date.UTC(2024, 2, 1, 12, 0, 0) + offsetMs);
}

describe('haversineDistance', () => {
  test('distance between same point is 0', () => {
    expect(haversineDistance(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  test('distance between Paris and London is approximately 343km', () => {
    const dist = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(340000);
    expect(dist).toBeLessThan(350000);
  });

  test('distance calculation is symmetric', () => {
    const d1 = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278);
    const d2 = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

describe('isPingInsideCheckpoint', () => {
  test('ping at same location is inside', () => {
    const ping: Ping = { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs() };
    expect(isPingInsideCheckpoint(ping, checkpoint)).toBe(true);
  });

  test('ping far away is outside', () => {
    const ping: Ping = { lat: 48.9, lng: 2.5, ts: makeTs() };
    expect(isPingInsideCheckpoint(ping, checkpoint)).toBe(false);
  });

  test('ping slightly outside radius without accuracy', () => {
    const ping: Ping = { lat: 48.8566 + 0.0015, lng: 2.3522, ts: makeTs() };
    expect(isPingInsideCheckpoint(ping, checkpoint)).toBe(false);
  });
});

describe('passesAccuracyGate', () => {
  test('passes when accuracy is undefined', () => {
    expect(passesAccuracyGate({ lat: 0, lng: 0, ts: makeTs() })).toBe(true);
  });

  test('passes when accuracy is within threshold', () => {
    expect(passesAccuracyGate({ lat: 0, lng: 0, ts: makeTs(), accuracy_m: 50 })).toBe(true);
  });

  test('passes at the boundary (150m)', () => {
    expect(passesAccuracyGate({ lat: 0, lng: 0, ts: makeTs(), accuracy_m: 150 })).toBe(true);
  });

  test('fails when accuracy exceeds threshold', () => {
    expect(passesAccuracyGate({ lat: 0, lng: 0, ts: makeTs(), accuracy_m: 151 })).toBe(false);
  });
});

describe('passesSpeedGate', () => {
  test('passes when speed is undefined', () => {
    expect(passesSpeedGate({ lat: 0, lng: 0, ts: makeTs() })).toBe(true);
  });

  test('passes when speed is within threshold', () => {
    expect(passesSpeedGate({ lat: 0, lng: 0, ts: makeTs(), speed_mps: 20 })).toBe(true);
  });

  test('passes at the boundary (30 m/s)', () => {
    expect(passesSpeedGate({ lat: 0, lng: 0, ts: makeTs(), speed_mps: 30 })).toBe(true);
  });

  test('fails when speed exceeds threshold', () => {
    expect(passesSpeedGate({ lat: 0, lng: 0, ts: makeTs(), speed_mps: 31 })).toBe(false);
  });
});

describe('detectCheckpointArrival', () => {
  test('returns null for empty pings', () => {
    expect(detectCheckpointArrival([], checkpoint)).toBeNull();
  });

  test('single ping inside does not trigger', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs() },
    ];
    expect(detectCheckpointArrival(pings, checkpoint)).toBeNull();
  });

  test('2 consecutive pings inside trigger arrival', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0) },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(5000) },
    ];
    const result = detectCheckpointArrival(pings, checkpoint);
    expect(result).not.toBeNull();
    expect(result!.checkpointId).toBe(checkpoint.id);
    expect(result!.arrivedAt.getTime()).toBe(makeTs(0).getTime());
  });

  test('dwell time >= 20s triggers arrival', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0) },
      { lat: checkpoint.lat + 0.0005, lng: checkpoint.lng, ts: makeTs(25000) },
    ];
    expect(detectCheckpointArrival(pings, checkpoint)).not.toBeNull();
  });

  test('ping outside resets consecutive count', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0) },
      { lat: 48.9, lng: 2.5, ts: makeTs(5000) },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(10000) },
    ];
    expect(detectCheckpointArrival(pings, checkpoint)).toBeNull();
  });

  test('confidence score is between 0 and 1', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0), accuracy_m: 10 },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(5000), accuracy_m: 10 },
    ];
    const result = detectCheckpointArrival(pings, checkpoint);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  test('speed gate: ping with speed > 30 m/s does not trigger arrival', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0), speed_mps: 50 },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(5000), speed_mps: 50 },
    ];
    expect(detectCheckpointArrival(pings, checkpoint)).toBeNull();
  });

  test('accuracy gate: pings with poor accuracy do not trigger arrival', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0), accuracy_m: 200 },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(5000), accuracy_m: 200 },
    ];
    expect(detectCheckpointArrival(pings, checkpoint)).toBeNull();
  });

  test('valid pings after gated ones can still trigger', () => {
    const pings: Ping[] = [
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(0), speed_mps: 50 },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(1000), speed_mps: 10 },
      { lat: checkpoint.lat, lng: checkpoint.lng, ts: makeTs(2000), speed_mps: 10 },
    ];
    const result = detectCheckpointArrival(pings, checkpoint);
    expect(result).not.toBeNull();
    expect(result!.arrivedAt.getTime()).toBe(makeTs(1000).getTime());
  });
});
