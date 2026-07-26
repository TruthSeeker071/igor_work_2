-- FlightWay V2 S11 — admin broadcast composer (D11).
-- Additive; safe against schema drift. Apply to the shared remote D1 with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
--
-- One row per composed broadcast. The row IS the record of the send: who wrote
-- it, which segment it targeted, when it was queued, how many addresses it
-- actually reached. Individual deliveries still land in `email_log` through the
-- shared sendMail chokepoint, so "did this reach jane@" is answerable without
-- duplicating a recipient list here (which would be a second copy of the user
-- table that nobody purges).
--
-- Until this is applied the composer degrades rather than breaking: the admin
-- panel renders with an explicit "not migrated yet" note, and the cron's
-- broadcast step finds no table and returns.
CREATE TABLE IF NOT EXISTS broadcasts (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  -- The ADMIN who composed it. Named `actor_email` on purpose: `test:purge`
  -- treats that name as an identity column, so this table cannot be added to
  -- the schema without someone deciding what account deletion does with it.
  -- (The answer, recorded in functions/account.js, is the same as
  -- admin_audit_log's: it is kept. A send record a sender can erase by deleting
  -- their own account is worthless in the one case it exists for.)
  actor_email   TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body_md       TEXT NOT NULL,
  -- 'all' | 'free' | 'paid' | 'school' | 'active30'
  segment_kind  TEXT NOT NULL,
  -- free text for the 'school' segment; NULL otherwise
  segment_value TEXT,
  -- draft | scheduled | sending | sent | cancelled | failed
  status        TEXT NOT NULL,
  -- ISO instant the dispatcher may send at or after. "Send now" writes now().
  scheduled_at  TEXT,
  sent_at       TEXT,
  recipients    INTEGER NOT NULL DEFAULT 0,
  sent_count    INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  test_sent_at  TEXT
);

-- The dispatcher's only query: everything due, oldest first.
CREATE INDEX IF NOT EXISTS idx_broadcasts_due ON broadcasts(status, scheduled_at);
-- The console's list.
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at);
