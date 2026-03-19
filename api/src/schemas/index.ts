import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  role: z.enum(['FAN', 'PARTICIPANT', 'ORGANIZER']).default('FAN'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const RefreshSchema = z.object({
  refreshToken: z.string(),
});

export const CreateEventSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  default_public_delay_sec: z.number().int().min(0).default(600),
  default_public_blur_m: z.number().int().min(0).default(400),
  status: z.enum(['DRAFT', 'LIVE', 'ARCHIVED']).default('DRAFT'),
  settings: z.record(z.unknown()).default({}),
});

export const CreateStageSchema = z.object({
  name: z.string().min(1),
  ordinal: z.number().int().min(0),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  route_polyline: z.string().optional(),
  settings: z.record(z.unknown()).default({}),
});

export const CreateCheckpointSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['START', 'MID', 'FINISH', 'BONUS']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(1),
  ordinal: z.number().int().min(0),
  is_active: z.boolean().default(true),
});

export const CreateCarSchema = z.object({
  car_number: z.string().min(1),
  team_name: z.string().optional(),
  display_name: z.string().optional(),
  avatar_url: z.string().url().optional(),
  sponsor_tags: z.array(z.string()).default([]),
  sharing_mode: z.enum(['LIVE', 'DELAYED', 'CITY_ONLY', 'PAUSED']).default('LIVE'),
  public_delay_sec: z.number().int().min(0).optional(),
  public_blur_m: z.number().int().min(0).optional(),
});

export const UpdateSharingSchema = z.object({
  sharing_mode: z.enum(['LIVE', 'DELAYED', 'CITY_ONLY', 'PAUSED']),
  public_delay_sec: z.number().int().min(0).optional(),
  public_blur_m: z.number().int().min(0).optional(),
});

export const LocationPingSchema = z.object({
  ts: z.string().datetime(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).optional(),
  speed_mps: z.number().optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  battery_pct: z.number().min(0).max(100).optional(),
  source: z.enum(['GPS', 'NETWORK', 'FUSED']).optional(),
  ingest_id: z.string().optional(),
});

export const PingBatchSchema = z.object({
  car_id: z.string().uuid(),
  device_id: z.string().optional(),
  pings: z.array(LocationPingSchema).max(200),
});

export const CreatePostSchema = z.object({
  caption: z.string().optional(),
  media: z.array(z.object({ url: z.string(), type: z.string() })).default([]),
  city_label: z.string().optional(),
});

export const UpdatePostSchema = z.object({
  moderation_status: z.enum(['PENDING', 'APPROVED', 'HIDDEN']),
});

export const CreateBroadcastSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience: z.enum(['ALL', 'FANS', 'PARTICIPANTS']),
});

export const PresignSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  carId: z.string().uuid().optional(),
});

export const ManualCheckpointSchema = z.object({
  checkpoint_id: z.string().uuid(),
  arrived_at: z.string().datetime(),
  stage_id: z.string().uuid(),
  event_id: z.string().uuid(),
  confidence: z.number().min(0).max(1).default(1.0),
});

export const ReactionSchema = z.object({
  type: z.enum(['LIKE', 'FIRE', 'CLAP']),
});

export const OpsCarOverrideSchema = z.object({
  is_hidden_public: z.boolean().optional(),
  sharing_mode: z.enum(['LIVE', 'DELAYED', 'CITY_ONLY', 'PAUSED']).optional(),
  public_delay_sec: z.number().int().min(0).optional(),
  public_blur_m: z.number().int().min(0).optional(),
});
