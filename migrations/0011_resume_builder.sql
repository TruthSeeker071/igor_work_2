-- FlightWay 2.0 — Resume Builder v2 (extends Pillar D2). Additive; safe against schema.
-- Apply with:  wrangler d1 migrations apply flightway-db
--
-- Base resumes + per-job tailored versions. Bullets (with provenance `src`)
-- live inside the resume JSON — no separate bullets table, no cross-table sync.

CREATE TABLE IF NOT EXISTS resumes (
  id          TEXT PRIMARY KEY,          -- crypto.randomUUID()
  email       TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'My resume',
  json        TEXT NOT NULL,             -- canonical resume object (schema v1)
  updated_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resumes_email ON resumes (email);

CREATE TABLE IF NOT EXISTS resume_versions (
  id          TEXT PRIMARY KEY,
  resume_id   TEXT NOT NULL,
  email       TEXT NOT NULL,             -- denormalized for auth checks
  job_title   TEXT,                      -- <=120 chars
  job_text    TEXT,                      -- <=6000 chars, the pasted posting
  json        TEXT NOT NULL,             -- tailored resume object
  score_json  TEXT,                      -- {match, matched:[], gaps:[]}
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resume_versions_email ON resume_versions (email);
CREATE INDEX IF NOT EXISTS idx_resume_versions_resume ON resume_versions (resume_id);
