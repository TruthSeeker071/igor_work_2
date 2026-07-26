-- FlightWay V2 S9 — Deadline Radar (D12).
--
-- Externally-imposed urgency, persisted. Until now the only "deadline" in the
-- product was whatever the Opportunity Finder happened to have left in its KV
-- cache (functions/_lib/deadlines.js) — read-only, per-career, evicted after a
-- day, and invisible to the cron. This table is the durable record: it survives
-- a cache eviction, a career change and a roadmap rebuild, it can be alerted on
-- from a scheduled Worker, and the student can add their own rows to it.
--
-- `user_id` holds the NORMALIZED EMAIL, consistent with `events` and
-- `email_log` (users.email is the PK of this schema). Purged with the account
-- via account.js USER_ID_TABLES — test:purge fails if that classification is
-- ever dropped.
--
-- Dates are stored as bare `YYYY-MM-DD` and always compared UTC-anchored
-- (`<date>T00:00:00Z`). A deadline is a calendar day, not an instant: storing a
-- timestamp would make "closes in 3 days" flip a day depending on where the
-- reader is sitting.
--
-- DEDUPE. A weekly refresh re-asks the web the same question, so the same
-- program comes back over and over with slightly different wording and
-- occasionally a slightly different date. Two guards:
--   `title_key`   normalized title (deadline-core.js normalizeTitleKey) — the
--                 near-window merge in deadline-store.js matches on this plus a
--                 +/-31 day date window, which is what actually prevents
--                 duplicates when a refresh corrects a date across a month
--                 boundary.
--   `dedupe_key`  `title_key|YYYY-MM` under a UNIQUE index — the backstop, so
--                 two concurrent writers cannot both insert the same row.
--
-- ALERTS. `alerted_t14` / `alerted_t3` are the exactly-once markers for the two
-- cron alert tiers. They are written only after a send SUCCEEDS, so a transient
-- Resend failure retries the next night instead of silently swallowing the one
-- warning the feature exists to give.

CREATE TABLE IF NOT EXISTS deadlines (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  org          TEXT NOT NULL DEFAULT '',
  -- internship | fellowship | competition | club | application-window
  kind         TEXT NOT NULL DEFAULT 'application-window',
  due_date     TEXT NOT NULL,
  url          TEXT NOT NULL DEFAULT '',
  -- 'grounded' (extracted from web evidence) | 'manual' (the student typed it)
  source       TEXT NOT NULL DEFAULT 'grounded',
  career_slug  TEXT NOT NULL DEFAULT '',
  -- tracked | dismissed | done
  status       TEXT NOT NULL DEFAULT 'tracked',
  title_key    TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL,
  alerted_t14  TEXT,
  alerted_t3   TEXT,
  created_at   TEXT NOT NULL,
  refreshed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deadlines_dedupe ON deadlines (user_id, dedupe_key);
-- The radar read: one user's upcoming rows, soonest first.
CREATE INDEX IF NOT EXISTS idx_deadlines_user_due ON deadlines (user_id, status, due_date);
-- The near-window merge: this user's rows for one normalized title.
CREATE INDEX IF NOT EXISTS idx_deadlines_user_title ON deadlines (user_id, title_key);
-- The nightly alert sweep: every tracked row landing in a date window, across
-- all users. Leads with status because the sweep always filters on it.
CREATE INDEX IF NOT EXISTS idx_deadlines_alert ON deadlines (status, due_date);
