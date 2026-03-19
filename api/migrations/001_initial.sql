CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'FAN' CHECK (role IN ('FAN','PARTICIPANT','ORGANIZER','SUPERADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  year INT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  default_public_delay_sec INT NOT NULL DEFAULT 600,
  default_public_blur_m INT NOT NULL DEFAULT 400,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','LIVE','ARCHIVED')),
  settings JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordinal INT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  route_polyline TEXT,
  settings JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('START','MID','FINISH','BONUS')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INT NOT NULL,
  ordinal INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS cars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  car_number TEXT NOT NULL,
  team_name TEXT,
  display_name TEXT,
  avatar_url TEXT,
  sponsor_tags TEXT[] DEFAULT '{}',
  sharing_mode TEXT NOT NULL DEFAULT 'LIVE' CHECK (sharing_mode IN ('LIVE','DELAYED','CITY_ONLY','PAUSED')),
  public_delay_sec INT,
  public_blur_m INT,
  is_hidden_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS car_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('DRIVER','NAVIGATOR','MEDIA')),
  UNIQUE(user_id, car_id)
);

CREATE TABLE IF NOT EXISTS location_pings_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  heading_deg REAL,
  battery_pct REAL,
  source TEXT CHECK (source IN ('GPS','NETWORK','FUSED')),
  ingest_id TEXT,
  ts_device TIMESTAMPTZ,
  ts_server_received TIMESTAMPTZ,
  ts_normalized TIMESTAMPTZ,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  reject_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS location_pings_raw_dedup ON location_pings_raw(car_id, ts_device);
CREATE INDEX IF NOT EXISTS location_pings_raw_car_ts ON location_pings_raw(car_id, ts DESC);

CREATE TABLE IF NOT EXISTS car_last_state (
  car_id UUID PRIMARY KEY REFERENCES cars(id) ON DELETE CASCADE,
  last_ts TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  status TEXT CHECK (status IN ('MOVING','STOPPED','OFFLINE','OFF_ROUTE','PAUSED')),
  last_stage_id UUID REFERENCES stages(id),
  next_checkpoint_id UUID REFERENCES checkpoints(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkpoint_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  checkpoint_id UUID NOT NULL REFERENCES checkpoints(id),
  stage_id UUID NOT NULL REFERENCES stages(id),
  event_id UUID NOT NULL REFERENCES events(id),
  arrived_at TIMESTAMPTZ NOT NULL,
  confidence REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  caption TEXT,
  media JSONB NOT NULL DEFAULT '[]',
  city_label TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (moderation_status IN ('PENDING','APPROVED','HIDDEN')),
  created_by UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('LIKE','FIRE','CLAP')),
  UNIQUE(post_id, user_id, type)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, car_id)
);

CREATE INDEX IF NOT EXISTS follows_user_id ON follows(user_id);
CREATE INDEX IF NOT EXISTS follows_car_id ON follows(car_id);

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('ALL','FANS','PARTICIPANTS')),
  created_by UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforces uniqueness of checkpoint completions per (car, checkpoint, stage)
CREATE TABLE IF NOT EXISTS stage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  checkpoint_id UUID NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  arrived_at TIMESTAMPTZ NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(car_id, checkpoint_id, stage_id)
);

CREATE INDEX IF NOT EXISTS stage_runs_car_stage ON stage_runs(car_id, stage_id);

-- Leaderboard: summary of stage completion times per car
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  total_time_sec INT,
  checkpoints_completed INT NOT NULL DEFAULT 0,
  last_checkpoint_at TIMESTAMPTZ,
  rank INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, stage_id, car_id)
);

CREATE INDEX IF NOT EXISTS leaderboard_event_stage ON leaderboard_entries(event_id, stage_id, rank);
