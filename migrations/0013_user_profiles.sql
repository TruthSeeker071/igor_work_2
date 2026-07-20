-- Canonical user-object storage (docs/USER_OBJECT_MASTERPLAN.md, Phase 4).
-- Raw backfill from quiz_profiles: payloads stay v1 — loadUser normalizes on
-- read forever, and each row upgrades to the v2 shape lazily on its next save.
-- quiz_profiles stays in place, frozen, for one release as rollback; a later
-- 0014 drops it.
CREATE TABLE IF NOT EXISTS user_profiles (
  email TEXT PRIMARY KEY,
  payload TEXT,
  updated_at TEXT
);

INSERT OR IGNORE INTO user_profiles (email, payload, updated_at)
  SELECT email, payload, updated_at FROM quiz_profiles;
