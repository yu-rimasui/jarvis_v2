CREATE TABLE analysis_claims (
  source_item_id TEXT PRIMARY KEY
    REFERENCES source_items(id) ON DELETE CASCADE,
  owner_run_id TEXT NOT NULL
    REFERENCES processing_runs(id) ON DELETE CASCADE,
  claim_token TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > claimed_at)
) STRICT;

CREATE INDEX analysis_claims_expires_at_index
  ON analysis_claims (expires_at);
