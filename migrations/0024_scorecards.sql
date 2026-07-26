-- FlightWay V2 S16 — Live-posting readiness scorecard (plan §5 S16).
--
-- One row per RUN, never one row per user: the whole point of persisting these
-- is the trend line ("you were 41% ready in September and you are 63% now"), and
-- a table that overwrites the previous report cannot draw one.
--
-- `report` is the full sanitized JSON payload (postings, requirements, actions).
-- The scalar columns beside it are denormalized copies of numbers the report
-- already contains, and that is deliberate: the trend chart and the Month in
-- Review read `score` for a dozen rows, and parsing a dozen JSON blobs to plot a
-- dozen integers is work with no payoff. The report stays the source of truth —
-- nothing recomputes a score from the columns.
--
-- `user_id` holds the account email, matching `deadlines` and `applications`
-- (0020/0022) rather than `artifacts`/`resumes` (which use `email`). Both
-- conventions are live; the newer tables use `user_id` and account.js's purge
-- classifies by column name, so this row belongs in USER_ID_TABLES.

CREATE TABLE IF NOT EXISTS scorecards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  career_slug TEXT NOT NULL DEFAULT '',
  career_name TEXT NOT NULL DEFAULT '',
  score       INTEGER NOT NULL DEFAULT 0,
  met         INTEGER NOT NULL DEFAULT 0,
  partial     INTEGER NOT NULL DEFAULT 0,
  missing     INTEGER NOT NULL DEFAULT 0,
  postings    INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'manual',
  report      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- The only two access patterns: "this student's latest" and "this student's
-- last N, newest first". One composite index serves both.
CREATE INDEX IF NOT EXISTS idx_scorecards_user ON scorecards (user_id, created_at DESC);

-- The quarterly cron sweep asks "whose newest report is older than 85 days?"
-- across ALL users, which the per-user index above cannot answer without a
-- scan. Kept separate rather than widened: the sweep reads two columns.
CREATE INDEX IF NOT EXISTS idx_scorecards_created ON scorecards (created_at DESC);
