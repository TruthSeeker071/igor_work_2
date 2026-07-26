-- FlightWay V2 S4 — email infrastructure (verification + lifecycle + prefs).
-- Additive; safe against schema drift. Apply to the shared remote D1 with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
--
-- Shared-DB note: there is ONE flightway-db behind both Pages projects and the
-- cron Worker, so this must be applied once for BOTH the prototype and prod to
-- exercise verification. Until it is applied, the S4 code degrades gracefully
-- (every new-column read/write is wrapped in try/catch): signup still works,
-- verification/banner/prefs simply stay inert.

-- Soft email verification (D7). verified_at NULL = unverified; an ISO timestamp
-- = verified. verify_token_hash is the SHA-256 of a one-time random token (same
-- family as password_reset_tokens); verify_sent_at anchors the 48h TTL.
ALTER TABLE users ADD COLUMN verified_at TEXT;
ALTER TABLE users ADD COLUMN verify_token_hash TEXT;
ALTER TABLE users ADD COLUMN verify_sent_at TEXT;

-- Google OAuth linkage. The column lands here (S4's migration) per the plan so
-- S5 can add the flow without a second migration. Nothing reads it until S5.
ALTER TABLE users ADD COLUMN google_sub TEXT;

-- Notification categories (D10). notify_optin (the weekly digest) already exists
-- from 0009 with DEFAULT 0. The three new category columns ALSO default 0 on
-- purpose: ALTER ... ADD COLUMN backfills every pre-migration row with the
-- default, and the ~11 known-real pre-V2 accounts must NOT be silently enrolled
-- (D10 — they get an in-app prompt instead). createUser() explicitly writes 1
-- for all four columns on new rows, which IS the "defaults ON at signup" for
-- app-created accounts (disclosed at signup, one-click unsub, verified-only send).
ALTER TABLE users ADD COLUMN notify_deadlines INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_review INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_product INTEGER DEFAULT 0;

-- Grandfather (D7): every account that exists at migration time is a known-real
-- pre-V2 user — mark them verified so email-dependent features work for them
-- immediately. New rows created AFTER this run keep verified_at NULL (set by
-- createUser) until they click the verify link. Runs once; only touches rows
-- present now, and only where verified_at is still NULL (idempotent-safe).
UPDATE users SET verified_at = created_at WHERE verified_at IS NULL;

-- Idempotent, debuggable send log. One row per attempted send (sent/failed/
-- skipped). user_id is the normalized email (users.email is the PK), matching
-- events.user_id. Guards day-3 / welcome "exactly once per user" and gives the
-- admin a way to see a dead alias instead of a silent failure.
CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_log_user_type ON email_log(user_id, type);
CREATE INDEX IF NOT EXISTS idx_email_log_ts ON email_log(ts);
