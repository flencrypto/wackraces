import { PingBatchSchema, ReactionSchema, CreateEventSchema, UpdateSharingSchema } from '../src/schemas';

describe('PingBatchSchema', () => {
  test('accepts valid batch with car_id at top level', () => {
    const batch = {
      car_id: '550e8400-e29b-41d4-a716-446655440000',
      device_id: 'device-123',
      pings: [
        {
          ts: '2026-06-22T10:01:02Z',
          lat: 47.37,
          lng: 8.54,
          accuracy_m: 12,
          speed_mps: 22.1,
          heading_deg: 180,
          battery_pct: 42,
          source: 'GPS' as const,
        },
      ],
    };
    const result = PingBatchSchema.parse(batch);
    expect(result.car_id).toBe(batch.car_id);
    expect(result.pings).toHaveLength(1);
    expect(result.pings[0].lat).toBe(47.37);
  });

  test('rejects more than 200 pings', () => {
    const pings = Array.from({ length: 201 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 5, 22, 10, 0, i)).toISOString(),
      lat: 47.37,
      lng: 8.54,
    }));
    expect(() => PingBatchSchema.parse({
      car_id: '550e8400-e29b-41d4-a716-446655440000',
      pings,
    })).toThrow();
  });

  test('rejects invalid car_id', () => {
    expect(() => PingBatchSchema.parse({
      car_id: 'not-a-uuid',
      pings: [],
    })).toThrow();
  });

  test('rejects out of range lat', () => {
    expect(() => PingBatchSchema.parse({
      car_id: '550e8400-e29b-41d4-a716-446655440000',
      pings: [{ ts: '2026-06-22T10:01:02Z', lat: 999, lng: 8.54 }],
    })).toThrow();
  });

  test('accepts batch without optional fields', () => {
    const result = PingBatchSchema.parse({
      car_id: '550e8400-e29b-41d4-a716-446655440000',
      pings: [{ ts: '2026-06-22T10:01:02Z', lat: 0, lng: 0 }],
    });
    expect(result.pings[0].accuracy_m).toBeUndefined();
    expect(result.pings[0].source).toBeUndefined();
  });
});

describe('ReactionSchema', () => {
  test('accepts valid reaction types', () => {
    expect(ReactionSchema.parse({ type: 'LIKE' }).type).toBe('LIKE');
    expect(ReactionSchema.parse({ type: 'FIRE' }).type).toBe('FIRE');
    expect(ReactionSchema.parse({ type: 'CLAP' }).type).toBe('CLAP');
  });

  test('rejects invalid reaction type', () => {
    expect(() => ReactionSchema.parse({ type: 'THUMBS_UP' })).toThrow();
  });
});

describe('CreateEventSchema', () => {
  test('accepts valid event', () => {
    const result = CreateEventSchema.parse({
      slug: 'wacky-2026',
      name: 'Wacky Races 2026',
      year: 2026,
    });
    expect(result.status).toBe('DRAFT');
    expect(result.default_public_delay_sec).toBe(600);
    expect(result.default_public_blur_m).toBe(400);
  });

  test('rejects slug with uppercase', () => {
    expect(() => CreateEventSchema.parse({
      slug: 'Wacky-2026',
      name: 'Wacky Races',
      year: 2026,
    })).toThrow();
  });

  test('rejects invalid year', () => {
    expect(() => CreateEventSchema.parse({
      slug: 'wacky-2026',
      name: 'Test',
      year: 1999,
    })).toThrow();
  });

  test('allows delay between 0 and 1800 seconds', () => {
    const r = CreateEventSchema.parse({
      slug: 'test-event',
      name: 'Test',
      year: 2026,
      default_public_delay_sec: 1800,
    });
    expect(r.default_public_delay_sec).toBe(1800);
  });
});

describe('UpdateSharingSchema', () => {
  test('accepts all valid sharing modes', () => {
    for (const mode of ['LIVE', 'DELAYED', 'CITY_ONLY', 'PAUSED'] as const) {
      const r = UpdateSharingSchema.parse({ sharing_mode: mode });
      expect(r.sharing_mode).toBe(mode);
    }
  });

  test('rejects invalid sharing mode', () => {
    expect(() => UpdateSharingSchema.parse({ sharing_mode: 'HIDDEN' })).toThrow();
  });
});
