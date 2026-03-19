export interface SanitizeInput {
  lat: number;
  lng: number;
  ts: Date;
  policy: {
    sharingMode: 'LIVE' | 'DELAYED' | 'CITY_ONLY' | 'PAUSED';
    delaySec: number;
    blurM: number;
    jitterChangeMs?: number;
  };
  carId?: string;
}

export interface SanitizeOutput {
  lat: number | null;
  lng: number | null;
  ts: Date;
  status: string;
  cityOnly: boolean;
}

const DEG_PER_METER_LAT = 1 / 111320;

function deterministicJitter(
  carId: string,
  timeBucketMs: number,
  blurM: number
): { dLat: number; dLng: number } {
  // Simple deterministic hash for jitter
  let hash = 0;
  const seed = `${carId}:${timeBucketMs}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const hash2 = (Math.imul(31, hash) + 7) | 0;

  // Map to [-1, 1] range
  const nx = (hash % 1000) / 1000;
  const ny = (hash2 % 1000) / 1000;

  const dLat = nx * blurM * DEG_PER_METER_LAT;
  const dLng = ny * blurM * DEG_PER_METER_LAT;
  return { dLat, dLng };
}

export function sanitizeLocation(input: SanitizeInput): SanitizeOutput {
  const { lat, lng, ts, policy, carId = 'default' } = input;
  const { sharingMode, delaySec, blurM, jitterChangeMs = 3 * 60 * 1000 } = policy;

  if (sharingMode === 'PAUSED') {
    return { lat: null, lng: null, ts, status: 'PAUSED', cityOnly: false };
  }

  if (sharingMode === 'CITY_ONLY') {
    return { lat: null, lng: null, ts, status: 'CITY_ONLY', cityOnly: true };
  }

  // Apply time delay
  const publicTs = new Date(ts.getTime() - delaySec * 1000);

  // Apply blur with deterministic jitter
  const timeBucket = Math.floor(ts.getTime() / jitterChangeMs);
  const { dLat, dLng } = deterministicJitter(carId, timeBucket, blurM);

  const blurredLat = Math.round((lat + dLat) * 1000) / 1000;
  const blurredLng = Math.round((lng + dLng) * 1000) / 1000;

  return {
    lat: blurredLat,
    lng: blurredLng,
    ts: publicTs,
    status: sharingMode === 'LIVE' ? 'LIVE' : 'DELAYED',
    cityOnly: false,
  };
}
