-- FlightWay V2 S12 — Application Tracker + Evidence Locker columns (plan §5 S12).
-- Additive; safe against existing schema. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
--
-- `applications` is the find → tailor → practice → track pipeline. `user_id` holds
-- the NORMALIZED EMAIL, consistent with `events`, `email_log` and `deadlines` —
-- `users.email` is the PK of this schema, so a second identifier would buy nothing
-- and cost every join. Purged with the account (functions/account.js USER_ID_TABLES).
--
-- Dedupe: `opportunity_ref` is a stable hash of the saved opportunity's URL. The
-- partial UNIQUE index means pressing Save twice on the same Opportunity Finder
-- result is a no-op rather than two rows, while a manually typed application
-- (NULL ref) can be created as many times as the student wants.

CREATE TABLE IF NOT EXISTS applications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  source          TEXT NOT NULL,        -- finder | manual
  opportunity_ref TEXT,                 -- stable hash of the source url (finder saves)
  company         TEXT,
  role            TEXT NOT NULL,
  career_slug     TEXT,
  status          TEXT NOT NULL,        -- interested | applied | interviewing | offer | closed
  url             TEXT,
  notes           TEXT,
  deadline_id     TEXT,                 -- optional link into `deadlines` (S9)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  -- NULL until `status` actually moves. `updated_at` is bumped by a notes edit
  -- and set on creation, so counting "applications you moved this week" off it
  -- would report typo fixes and fresh saves as progress. Two columns because
  -- they answer two different questions.
  status_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications (user_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications (user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_ref
  ON applications (user_id, opportunity_ref) WHERE opportunity_ref IS NOT NULL;

-- Evidence Locker (§5 S12: "if schema needs columns (e.g. title, link), extend
-- via this session's migration"). `title` already existed in 0010; `url` is the
-- link that makes an artifact showable rather than merely recorded, and
-- `updated_at` is what the new edit flow writes.
ALTER TABLE artifacts ADD COLUMN url TEXT;
ALTER TABLE artifacts ADD COLUMN updated_at TEXT;
