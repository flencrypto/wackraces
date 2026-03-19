export interface Ping {
  lat: number;
  lng: number;
  ts: Date;
  accuracy_m?: number;
  speed_mps?: number;
}

export interface Checkpoint {
  id: string;
  lat: number;
  lng: number;
  radius_m: number;
}

export interface CheckpointResult {
  checkpointId: string;
  arrivedAt: Date;
  confidence: number;
}

const EARTH_RADIUS_M = 6371000;
const ACCURACY_BASELINE_M = 100;
/** Pings with accuracy worse than this are treated as low-confidence */
const MAX_ACCURACY_FOR_GATE_M = 150;
/** Vehicles faster than this are unlikely to be legitimately crossing a checkpoint zone */
const CHECKPOINT_MAX_SPEED_MPS = 30;

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function isPingInsideCheckpoint(ping: Ping, checkpoint: Checkpoint): boolean {
  const dist = haversineDistance(ping.lat, ping.lng, checkpoint.lat, checkpoint.lng);
  const effectiveRadius = checkpoint.radius_m + (ping.accuracy_m ?? 0) * 0.5;
  return dist <= effectiveRadius;
}

/** Accuracy gate: returns true when the ping passes (should be used). */
export function passesAccuracyGate(ping: Ping): boolean {
  if (ping.accuracy_m === undefined) return true;
  return ping.accuracy_m <= MAX_ACCURACY_FOR_GATE_M;
}

/** Speed gate: returns true when the ping passes (should be used). */
export function passesSpeedGate(ping: Ping): boolean {
  if (ping.speed_mps === undefined) return true;
  return ping.speed_mps <= CHECKPOINT_MAX_SPEED_MPS;
}

function calculateConfidence(pingsInside: Ping[], _checkpoint: Checkpoint): number {
  if (pingsInside.length === 0) return 0;

  const firstTs = pingsInside[0].ts.getTime();
  const lastTs = pingsInside[pingsInside.length - 1].ts.getTime();
  const dwellMs = lastTs - firstTs;
  const dwellFactor = Math.min(dwellMs / 60000, 1) * 0.5;

  const avgAccuracy =
    pingsInside.reduce((sum, p) => sum + (p.accuracy_m ?? 50), 0) / pingsInside.length;
  const accuracyFactor = Math.max(0, (1 - avgAccuracy / ACCURACY_BASELINE_M)) * 0.5;

  return Math.min(1, dwellFactor + accuracyFactor);
}

export function detectCheckpointArrival(
  pings: Ping[],
  checkpoint: Checkpoint
): CheckpointResult | null {
  if (pings.length === 0) return null;

  let consecutiveInside = 0;
  let firstInsideTs: Date | null = null;
  let pingsInside: Ping[] = [];

  for (const ping of pings) {
    if (!passesAccuracyGate(ping) || !passesSpeedGate(ping)) {
      consecutiveInside = 0;
      firstInsideTs = null;
      pingsInside = [];
      continue;
    }

    if (isPingInsideCheckpoint(ping, checkpoint)) {
      consecutiveInside++;
      if (!firstInsideTs) firstInsideTs = ping.ts;
      pingsInside.push(ping);

      if (consecutiveInside >= 2) {
        const confidence = calculateConfidence(pingsInside, checkpoint);
        return {
          checkpointId: checkpoint.id,
          arrivedAt: firstInsideTs,
          confidence: Math.max(confidence, 0.5),
        };
      }

      const dwellMs = ping.ts.getTime() - firstInsideTs.getTime();
      if (dwellMs >= 20000) {
        const confidence = calculateConfidence(pingsInside, checkpoint);
        return {
          checkpointId: checkpoint.id,
          arrivedAt: firstInsideTs,
          confidence: Math.max(confidence, 0.6),
        };
      }
    } else {
      consecutiveInside = 0;
      firstInsideTs = null;
      pingsInside = [];
    }
  }

  return null;
}
