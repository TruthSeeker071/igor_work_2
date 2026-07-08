-- FlightWay 2.0 — execution layer: A3 receipts (weekly vector snapshots).
-- Additive only; safe against existing schema. Apply with:
--   wrangler d1 migrations apply flightway-db
--
-- One row per user per ISO week (e.g. '2026-W28') holding a snapshot of the
-- personality/objective vectors, so the portal can show "what moved this month".
-- Written lazily on the first /receipts load of the week (idempotent upsert).

CREATE TABLE IF NOT EXISTS vector_snapshots (
  email            TEXT NOT NULL,
  week             TEXT NOT NULL,          -- ISO week, e.g. '2026-W28'
  personality_json TEXT,                   -- JSON array of dimension values
  objective_json   TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (email, week)
);

CREATE INDEX IF NOT EXISTS idx_vector_snapshots_email ON vector_snapshots (email);
