-- Performance indexes for production

-- Speed up checkpoint deduplication lookups in processor
CREATE INDEX IF NOT EXISTS checkpoint_events_car_cp_arrived
  ON checkpoint_events(car_id, checkpoint_id, arrived_at DESC);

-- Speed up ops moderation queue
CREATE INDEX IF NOT EXISTS posts_event_moderation
  ON posts(event_id, moderation_status, created_at ASC);

-- Speed up public feed
CREATE INDEX IF NOT EXISTS posts_event_approved_ts
  ON posts(event_id, created_at DESC)
  WHERE moderation_status = 'APPROVED';

-- Speed up car lookup by event for ops map
CREATE INDEX IF NOT EXISTS cars_event_id
  ON cars(event_id);

-- Speed up stage lookup by event + time window (processor stage detection)
CREATE INDEX IF NOT EXISTS stages_event_id_ordinal
  ON stages(event_id, ordinal DESC);

-- Speed up checkpoint lookup by stage
CREATE INDEX IF NOT EXISTS checkpoints_stage_id_active
  ON checkpoints(stage_id, ordinal)
  WHERE is_active = true;
