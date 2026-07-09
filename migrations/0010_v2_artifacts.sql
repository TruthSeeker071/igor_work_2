-- FlightWay 2.0 — artifact-per-waypoint (Pillar B3). Additive; safe against schema.
-- Apply with:  wrangler d1 migrations apply flightway-db
--
-- Every completed waypoint can produce something showable (a repo, memo, 1-pager,
-- sim review). These rows are the student's portfolio — our answer to Forage
-- certificates — rendered as an "Evidence" list on the portal.

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  waypoint_id TEXT,
  type        TEXT NOT NULL,        -- repo | doc | analysis | design | other
  title       TEXT NOT NULL,
  note        TEXT,                 -- ≤200 chars
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_email ON artifacts (email);
