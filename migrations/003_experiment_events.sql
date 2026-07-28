CREATE TABLE experiment_events (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL
    REFERENCES experiments(id) ON DELETE CASCADE,
  from_status TEXT
    CHECK (
      from_status IS NULL
      OR from_status IN (
        'proposed',
        'approved',
        'in_progress',
        'completed',
        'rejected',
        'blocked'
      )
    ),
  to_status TEXT NOT NULL
    CHECK (
      to_status IN (
        'proposed',
        'approved',
        'in_progress',
        'completed',
        'rejected',
        'blocked'
      )
    ),
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX experiment_events_experiment_index
  ON experiment_events (experiment_id, created_at, id);
