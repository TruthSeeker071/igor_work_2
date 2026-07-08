-- Runtime AI-derived "fragment" careers. Global (shared across users): the first
-- user to view/target a real O*NET base career spawns up to 3 specializations,
-- cached here for everyone. Row shape (row_json) matches the careers.json derived
-- row produced by scripts/derive-career.mjs (aiDerived/derivedFrom/vector/importance/
-- provenance) so store.getDerivedCareers + onet/vectors serve them like the static
-- sidecar. Synthetic SOCs live in the 99-1XXX.00 range (static sidecar owns 99-0XXX).
CREATE TABLE IF NOT EXISTS derived_careers (
  soc TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  derived_from_soc TEXT NOT NULL,
  title TEXT NOT NULL,
  row_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_derived_careers_from_soc ON derived_careers (derived_from_soc);
