ALTER TABLE content_drafts
  ADD COLUMN evidence_scope TEXT NOT NULL DEFAULT 'source_only'
    CHECK (
      evidence_scope IN ('source_only', 'completed_experiment')
    );

ALTER TABLE content_drafts
  ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE content_draft_events (
  id TEXT PRIMARY KEY,
  content_draft_id TEXT NOT NULL
    REFERENCES content_drafts(id) ON DELETE CASCADE,
  from_status TEXT
    CHECK (
      from_status IS NULL
      OR from_status IN (
        'draft',
        'needs_review',
        'approved',
        'published',
        'rejected'
      )
    ),
  to_status TEXT NOT NULL
    CHECK (
      to_status IN (
        'draft',
        'needs_review',
        'approved',
        'published',
        'rejected'
      )
    ),
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX content_draft_events_draft_index
  ON content_draft_events (content_draft_id, created_at, id);
