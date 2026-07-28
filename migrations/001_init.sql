CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('x', 'zenn', 'qiita', 'manual', 'fixture')),
  source_external_id TEXT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_url TEXT,
  normalized_url TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  published_at TEXT,
  collected_at TEXT NOT NULL,
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  topic_key TEXT
) STRICT;

CREATE UNIQUE INDEX source_items_source_external_id_unique
  ON source_items (source_type, source_external_id)
  WHERE source_external_id IS NOT NULL;

CREATE UNIQUE INDEX source_items_normalized_url_unique
  ON source_items (normalized_url)
  WHERE normalized_url IS NOT NULL;

CREATE INDEX source_items_collected_at_index
  ON source_items (collected_at DESC);

CREATE TABLE topic_clusters (
  id TEXT PRIMARY KEY,
  cluster_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE topic_cluster_items (
  cluster_id TEXT NOT NULL REFERENCES topic_clusters(id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, source_item_id)
) STRICT;

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL UNIQUE
    REFERENCES source_items(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  primary_category TEXT NOT NULL
    CHECK (
      primary_category IN (
        'AI Development',
        'Codex',
        'Claude Code',
        'AI Agents',
        'MCP',
        'Test Automation',
        'Software Engineering',
        'DevOps',
        'LLM Research',
        'Other'
      )
    ),
  secondary_categories_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confidence_reason TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  work_use TEXT NOT NULL,
  suggested_first_experiment TEXT NOT NULL,
  related_technologies_json TEXT NOT NULL DEFAULT '[]',
  related_repositories_json TEXT NOT NULL DEFAULT '[]',
  risks_and_limitations_json TEXT NOT NULL DEFAULT '[]',
  claims_json TEXT NOT NULL DEFAULT '[]',
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
) STRICT;

CREATE INDEX analyses_analyzed_at_index
  ON analyses (analyzed_at DESC);

CREATE TABLE rankings (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL UNIQUE
    REFERENCES analyses(id) ON DELETE CASCADE,
  relevance_score REAL NOT NULL
    CHECK (relevance_score >= 0 AND relevance_score <= 5),
  relevance_reason TEXT NOT NULL,
  novelty_score REAL NOT NULL
    CHECK (novelty_score >= 0 AND novelty_score <= 5),
  novelty_reason TEXT NOT NULL,
  actionability_score REAL NOT NULL
    CHECK (actionability_score >= 0 AND actionability_score <= 5),
  actionability_reason TEXT NOT NULL,
  author_credibility_score REAL NOT NULL
    CHECK (
      author_credibility_score >= 0
      AND author_credibility_score <= 5
    ),
  author_credibility_reason TEXT NOT NULL,
  overall_score INTEGER NOT NULL
    CHECK (overall_score >= 0 AND overall_score <= 100),
  ranked_at TEXT NOT NULL
) STRICT;

CREATE INDEX rankings_overall_score_index
  ON rankings (overall_score DESC, ranked_at DESC);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  source_analysis_id TEXT NOT NULL
    REFERENCES analyses(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  expected_value TEXT NOT NULL,
  smallest_first_step TEXT NOT NULL,
  required_tools_json TEXT NOT NULL DEFAULT '[]',
  estimated_effort TEXT NOT NULL,
  risk TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'proposed',
        'approved',
        'in_progress',
        'completed',
        'rejected',
        'blocked'
      )
    ),
  result TEXT,
  learned TEXT,
  next_decision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX experiments_status_index
  ON experiments (status, updated_at DESC);

CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL
    REFERENCES experiments(id) ON DELETE CASCADE,
  run_sequence INTEGER NOT NULL CHECK (run_sequence >= 1),
  result TEXT NOT NULL,
  verification_evidence TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (experiment_id, run_sequence)
) STRICT;

CREATE TABLE learnings (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE
    REFERENCES experiments(id) ON DELETE CASCADE,
  hypothesis_support TEXT NOT NULL
    CHECK (
      hypothesis_support IN (
        'supported',
        'partially_supported',
        'not_supported',
        'inconclusive'
      )
    ),
  reusable_knowledge TEXT NOT NULL,
  next_experiment TEXT,
  publishable_first_hand_experience TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE content_drafts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'instagram')),
  related_analysis_id TEXT NOT NULL
    REFERENCES analyses(id) ON DELETE RESTRICT,
  related_experiment_id TEXT
    REFERENCES experiments(id) ON DELETE SET NULL,
  hook TEXT NOT NULL,
  body TEXT NOT NULL,
  key_takeaway TEXT NOT NULL,
  source_links_json TEXT NOT NULL DEFAULT '[]',
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  status TEXT NOT NULL
    CHECK (
      status IN ('draft', 'needs_review', 'approved', 'published', 'rejected')
    ),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX content_drafts_status_index
  ON content_drafts (status, updated_at DESC);

CREATE TABLE processing_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL
    CHECK (
      operation IN (
        'collect',
        'analyze',
        'rank',
        'experiment',
        'draft',
        'digest',
        'migrate'
      )
    ),
  source_or_provider TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code TEXT,
  error_kind TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE INDEX processing_runs_started_at_index
  ON processing_runs (started_at DESC);
