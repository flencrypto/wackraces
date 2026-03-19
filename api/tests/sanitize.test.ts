import { sanitizeLocation, SanitizeInput } from '../src/services/sanitize';

const baseInput: SanitizeInput = {
  lat: 48.8566,
  lng: 2.3522,
  ts: new Date('2024-03-01T12:00:00Z'),
  policy: {
    sharingMode: 'LIVE',
    delaySec: 600,
    blurM: 400,
  },
  carId: 'test-car-1',
};

describe('sanitizeLocation', () => {
  test('PAUSED mode returns null lat/lng', () => {
    const input: SanitizeInput = {
      ...baseInput,
      policy: { ...baseInput.policy, sharingMode: 'PAUSED' },
    };
    const result = sanitizeLocation(input);
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
    expect(result.status).toBe('PAUSED');
    expect(result.cityOnly).toBe(false);
  });

  test('CITY_ONLY returns null lat/lng with cityOnly=true', () => {
    const input: SanitizeInput = {
      ...baseInput,
      policy: { ...baseInput.policy, sharingMode: 'CITY_ONLY' },
    };
    const result = sanitizeLocation(input);
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
    expect(result.status).toBe('CITY_ONLY');
    expect(result.cityOnly).toBe(true);
  });

  test('DELAYED mode applies correct time offset', () => {
    const input: SanitizeInput = {
      ...baseInput,
      policy: { ...baseInput.policy, sharingMode: 'DELAYED', delaySec: 600 },
    };
    const result = sanitizeLocation(input);
    const expectedTs = new Date(baseInput.ts.getTime() - 600 * 1000);
    expect(result.ts.getTime()).toBe(expectedTs.getTime());
    expect(result.status).toBe('DELAYED');
  });

  test('LIVE mode applies time offset', () => {
    const result = sanitizeLocation(baseInput);
    const expectedTs = new Date(baseInput.ts.getTime() - 600 * 1000);
    expect(result.ts.getTime()).toBe(expectedTs.getTime());
  });

  test('Blur keeps location within expected radius (~3 decimal precision)', () => {
    const result = sanitizeLocation(baseInput);
    expect(result.lat).not.toBeNull();
    expect(result.lng).not.toBeNull();
    // Check 3 decimal place precision
    const latStr = result.lat!.toString();
    const lngStr = result.lng!.toString();
    const latDecimals = latStr.includes('.') ? latStr.split('.')[1].length : 0;
    const lngDecimals = lngStr.includes('.') ? lngStr.split('.')[1].length : 0;
    expect(latDecimals).toBeLessThanOrEqual(3);
    expect(lngDecimals).toBeLessThanOrEqual(3);
  });

  test('Output never contains raw accuracy/speed/heading', () => {
    const result = sanitizeLocation(baseInput);
    expect(result).not.toHaveProperty('accuracy_m');
    expect(result).not.toHaveProperty('speed_mps');
    expect(result).not.toHaveProperty('heading_deg');
  });

  test('Precision rounded to 3 decimal places', () => {
    const result = sanitizeLocation({ ...baseInput, policy: { ...baseInput.policy, blurM: 400 } });
    if (result.lat !== null) {
      const latStr = result.lat.toString();
      const decimals = latStr.includes('.') ? latStr.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(3);
    }
  });

  test('Deterministic jitter is consistent for same input', () => {
    const r1 = sanitizeLocation(baseInput);
    const r2 = sanitizeLocation(baseInput);
    expect(r1.lat).toBe(r2.lat);
    expect(r1.lng).toBe(r2.lng);
  });
});
