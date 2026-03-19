export interface SanitizeInput {
  lat: number;
  lng: number;
  ts: Date;
  policy: {
    sharingMode: 'LIVE' | 'DELAYED' | 'CITY_ONLY' | 'PAUSED';
    delaySec: number;
    blurM: number;
    /** Override time-bucket duration. Defaults to 180 000 ms (3 min) per spec. */
    jitterChangeMs?: number;
  };
  carId?: string;
  /** Secret salt injected from config — kept out of output. */
  jitterSalt?: string;
}

export interface SanitizeOutput {
  lat: number | null;
  lng: number | null;
  ts: Date;
  status: string;
  cityOnly: boolean;
  // NOTE: accuracy_m / speed_mps / heading_deg are NEVER present in the output
}

const DEG_PER_METER_LAT = 1 / 111320;
/** Per-spec: jitter time bucket is floor(ts / 180s) */
const DEFAULT_JITTER_CHANGE_MS = 180_000;
/**
 * Range used to normalise hash outputs to [-1, 1].
 * Must stay in sync with the same constant in processor/src/index.ts.
 */
const JITTER_NORM = 2000;

/**
 * Deterministic jitter using the spec formula:
 *   bucket  = floor(ts_ms / jitterChangeMs)
 *   seed    = `${carId}:${bucket}:${salt}`
 *   offset  in [-blurM, +blurM] in each axis
 */
function deterministicJitter(
  carId: string,
  timeBucketMs: number,
  blurM: number,
  salt: string
): { dLat: number; dLng: number } {
  const seed = `${carId}:${timeBucketMs}:${salt}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const hash2 = (Math.imul(31, hash) + 7) | 0;

  const nx = ((hash % JITTER_NORM) - JITTER_NORM / 2) / (JITTER_NORM / 2);
  const ny = ((hash2 % JITTER_NORM) - JITTER_NORM / 2) / (JITTER_NORM / 2);

  return {
    dLat: nx * blurM * DEG_PER_METER_LAT,
    dLng: ny * blurM * DEG_PER_METER_LAT,
  };
}

export function sanitizeLocation(input: SanitizeInput): SanitizeOutput {
  const {
    lat,
    lng,
    ts,
    policy,
    carId = 'default',
    jitterSalt = '',
  } = input;
  const {
    sharingMode,
    delaySec,
    blurM,
    jitterChangeMs = DEFAULT_JITTER_CHANGE_MS,
  } = policy;

  if (sharingMode === 'PAUSED') {
    return { lat: null, lng: null, ts, status: 'PAUSED', cityOnly: false };
  }

  if (sharingMode === 'CITY_ONLY') {
    return { lat: null, lng: null, ts, status: 'CITY_ONLY', cityOnly: true };
  }

  // Apply time delay — public timestamp is shifted backward
  const publicTs = new Date(ts.getTime() - delaySec * 1000);

  // Apply blur with deterministic jitter (spec: bucket = floor(ts / 180s))
  const timeBucket = Math.floor(ts.getTime() / jitterChangeMs);
  const { dLat, dLng } = deterministicJitter(carId, timeBucket, blurM, jitterSalt);

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
