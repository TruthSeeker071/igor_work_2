-- FlightWay V2 S18 — Interview Season Mode + Semester Loop (plan §5 S18, D13/D14).
-- Additive; safe against existing schema. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
--
-- TWO tables and TWO columns, and the columns are the interesting part.
--
-- §5 S18 says the season needs "persisted rubric scores per session (migration:
-- `mock_scores` **if not already persisted**)". They already are: 0012 created
-- `interview_sessions` and `functions/mock-interview.js` has been writing a
-- 6-axis `scores_json` to it since the mock-interview ship. So there is no
-- `mock_scores` table here and there never should be — a second copy of a score
-- is a second thing to disagree with the first. What the season actually needs
-- is the LINK from a session to the week of the program it belongs to, which is
-- two columns on the table that already holds the score.
--
-- `user_id` on the new tables holds the NORMALIZED EMAIL, matching `events`,
-- `deadlines`, `applications`, `shares`, `scorecards` and `contacts`. Note the
-- seam this creates with `interview_sessions`, which is `email`-keyed because it
-- predates that convention (0012). Nothing is renamed: a column rename on a live
-- table to win a naming argument is the worst trade in this schema.
--
-- Both tables are purged with the account (functions/account.js USER_ID_TABLES).

-- The 6-week Interview Season program. ONE active row per account, enforced by
-- the partial unique index below rather than by application code, because "one
-- active season" is the assumption every read in season-store.js makes and an
-- index is the only place that assumption cannot drift.
CREATE TABLE IF NOT EXISTS interview_seasons (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  career_slug  TEXT,
  career_name  TEXT,
  family       TEXT,                 -- career family key (interview-playbooks.js)
  status       TEXT NOT NULL,        -- active | completed | abandoned
  start_date   TEXT NOT NULL,        -- ISO yyyy-mm-dd, UTC day the 6 weeks start
  end_date     TEXT NOT NULL,        -- ISO yyyy-mm-dd, inclusive last day of week 6
  -- The whole program object: six weeks with their focus areas, personas and
  -- target axes, plus the role's real-world round format when grounding was on
  -- and had something to say. Stored WHOLE and never recomputed on read, for the
  -- same reason 0024 stores its report whole: a program read back in month three
  -- must be the program the student was working, even if the playbook copy or
  -- the week arc has been retuned since.
  program_json TEXT NOT NULL,
  format_src   TEXT,                 -- playbook | web  (where the round format came from)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ended_at     TEXT                  -- set when status leaves 'active'
);
CREATE INDEX IF NOT EXISTS idx_interview_seasons_user ON interview_seasons (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_seasons_one_active
  ON interview_seasons (user_id) WHERE status = 'active';

-- Which week of which program a mock interview belonged to. Both NULL for every
-- session run outside a season, which is most of them and always will be.
ALTER TABLE interview_sessions ADD COLUMN season_id TEXT;
ALTER TABLE interview_sessions ADD COLUMN season_week INTEGER;

-- The Semester Loop's record of one term. The user's term DATES are also
-- mirrored onto the user object (`identity.termSystem/termStart/termEnd`, via
-- KEY_MAP + the user-sync registry) so Marco and the client can read them
-- without a D1 round-trip — but the row is the record of the RITUAL, and one
-- column here is the reason the record cannot live in the user blob at all:
--
--   `regen_granted_at` is an ENTITLEMENT. §5 S18 grants +1 roadmap regeneration
--   at the end-of-term review, and the user blob is client-writable through the
--   quiz save path — a student who could edit it could grant themselves an
--   unlimited supply. The grant is idempotent because this column is written in
--   the same statement that checks it, and for no other reason.
CREATE TABLE IF NOT EXISTS terms (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  system           TEXT NOT NULL,    -- semester | quarter | trimester
  label            TEXT,             -- 'Fall 2026' (student-entered, sanitized)
  start_date       TEXT NOT NULL,    -- ISO yyyy-mm-dd
  end_date         TEXT NOT NULL,    -- ISO yyyy-mm-dd, inclusive
  outcomes_json    TEXT,             -- the 3 outcomes + course/club anchors + deliverable
  seeded_json      TEXT,             -- {nodeId, stepId, dueAt} per commitment the ritual created
  review_json      TEXT,             -- the end-of-term review, stored whole (0024's rule)
  regen_granted_at TEXT,             -- the +1 roadmap regen guard — NULL until granted, once
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_user ON terms (user_id, start_date DESC);
-- The cron's term-boundary sweep asks "whose term ended and has not been
-- reviewed" once per night across every account, so it reads by date, not user.
CREATE INDEX IF NOT EXISTS idx_terms_end ON terms (end_date);
