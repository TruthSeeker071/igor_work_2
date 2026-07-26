-- FlightWay V2 S1 — self-hosted analytics (D19: no external vendors, ever).
-- Additive only; the D1 database is SHARED between the prototype and
-- production, so nothing here drops or rewrites an existing column. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote
--
-- Three tables, one job each:
--   events        raw append-only beacon rows, pruned at 90 days
--   events_daily  the rollup every admin dashboard query reads (S3)
--   server_errors the self-hosted stand-in for Sentry (table only here; the
--                 logServerError helper + admin panel land in S3, and creating
--                 the table now means Phase 0 ships ONE migration, not two)
--
-- Why `user_id` holds the normalized email: every other table in this schema
-- keys users by email (users.email is the PK; roadmaps, career_analyses,
-- comp_grants all follow). A hash here would buy little — the row is already
-- account-linked by definition — and would cost S3 every dashboard join. The
-- privacy stance lives one level up instead: props may never carry PII, the
-- server derives user_id from the session cookie (never from the request body),
-- and history is never retro-rewritten when an anon visitor signs in.

-- One row per client event. Written only by POST /events (and the Stripe
-- webhook, for revenue events that must not depend on a browser being open).
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,          -- server-generated; clients never choose an id
  ts TEXT NOT NULL,             -- ISO8601 UTC, server-stamped (client clocks lie)
  day TEXT NOT NULL,            -- YYYY-MM-DD slice of ts; written, not generated
  anon_id TEXT NOT NULL,        -- localStorage fw_anon_v1 uuid; no cookies
  user_id TEXT,                 -- normalized email from the session, or NULL
  name TEXT NOT NULL,           -- validated against the server allowlist
  path TEXT,                    -- page path only, never a query string
  props TEXT,                   -- JSON, <=1KB, PII-scrubbed
  ref TEXT,                     -- first-touch referrer host
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ua_class TEXT                 -- 'mobile' | 'desktop' | 'bot' (bots are dropped)
);
CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);
CREATE INDEX IF NOT EXISTS idx_events_day_name ON events(day, name);
CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anon_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
-- The prune (`DELETE FROM events WHERE day < ?`) and the rollup's day scan both
-- lead with `day`; without this they are full scans once the table is real.
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);

-- Yesterday, aggregated. The rollup is idempotent: it DELETEs the day's rows
-- and re-INSERTs them, so a re-run (or a cron retry) can never double-count.
CREATE TABLE IF NOT EXISTS events_daily (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  uniques_anon INTEGER NOT NULL DEFAULT 0,
  uniques_user INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
CREATE INDEX IF NOT EXISTS idx_events_daily_day ON events_daily(day);

-- Unhandled function errors. Written by S3's logServerError(env, route, err);
-- nothing reads or writes it in S1. Deliberately tiny: a message and a route
-- are enough to see "checkout is throwing" without becoming a log warehouse.
CREATE TABLE IF NOT EXISTS server_errors (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  route TEXT,
  message TEXT,                 -- truncated; never a raw request body
  detail TEXT                   -- JSON blob (status, stack head), also truncated
);
CREATE INDEX IF NOT EXISTS idx_server_errors_ts ON server_errors(ts);
CREATE INDEX IF NOT EXISTS idx_server_errors_day_route ON server_errors(day, route);
