ALTER TABLE analyses
  ADD COLUMN trial_difficulty TEXT NOT NULL DEFAULT 'intermediate'
    CHECK (trial_difficulty IN ('beginner', 'intermediate', 'advanced'));

ALTER TABLE analyses
  ADD COLUMN required_environment_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE analyses
  ADD COLUMN hypothesis TEXT NOT NULL DEFAULT '小さな実践で有用性を確認できる';

ALTER TABLE analyses
  ADD COLUMN expected_value TEXT NOT NULL DEFAULT '採用判断に使える記録を得る';

ALTER TABLE analyses
  ADD COLUMN estimated_effort TEXT NOT NULL DEFAULT '30分';

ALTER TABLE analyses
  ADD COLUMN success_criteria TEXT NOT NULL DEFAULT '結果と根拠を記録できる';

ALTER TABLE analyses
  ADD COLUMN verification_method TEXT NOT NULL DEFAULT '実行ログと結果を比較する';

CREATE TABLE collector_states (
  source_name TEXT PRIMARY KEY,
  last_successful_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
