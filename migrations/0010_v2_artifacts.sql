-- FlightWay 2.0 — artifact-per-waypoint (Pillar B3) + gap link (evidence mega-system).
-- Additive; safe against existing schema. Apply with:
--   wrangler d1 migrations apply flightway-db
--
-- Portfolio rows (showable proof). Optional gap_id / dim_index link an artifact to a
-- skill-gap so logging it also stamps high-weight evidence on the focus tracker
-- and moves the O*NET objective vector (same pipeline as typed gap notes).

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  waypoint_id TEXT,
  gap_id      TEXT,
  dim_index   INTEGER,
  type        TEXT NOT NULL,        -- repo | doc | analysis | design | other
  title       TEXT NOT NULL,
  note        TEXT,                 -- ≤200 chars
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_email ON artifacts (email);
CREATE INDEX IF NOT EXISTS idx_artifacts_gap ON artifacts (email, gap_id);
