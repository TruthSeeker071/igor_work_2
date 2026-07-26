-- FlightWay V2 S2 — contact form inbox (D22).
-- Additive only; the D1 database is SHARED between the prototype and
-- production, so nothing here drops or rewrites an existing column. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
-- (`--env production` is REQUIRED — the D1 binding lives under [env.production]
-- in wrangler.toml, deliberately; the bare invocation in SETUP.md fails.)
--
-- Why a table at all when POST /contact also emails hello@flightway.ai: email
-- is a delivery mechanism, not storage. Resend can be down, the alias can be
-- misconfigured (it is an open Jacob checklist item as of this migration), and a
-- support message that only ever existed in someone's inbox is unrecoverable.
-- The row is the record of truth; the email is the notification.

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,          -- server-generated; clients never choose an id
  ts TEXT NOT NULL,             -- ISO8601 UTC, server-stamped
  email TEXT NOT NULL,          -- normalized (lowercased/trimmed) reply address
  name TEXT,                    -- optional, as typed. Its own column rather than
                                -- prefixed onto `body`: concatenating then
                                -- re-truncating to the body cap would silently
                                -- drop the tail of the message this row exists
                                -- to preserve.
  topic TEXT NOT NULL,          -- validated against the server allowlist
  body TEXT NOT NULL,           -- truncated server-side; free text, user-authored
  status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'read' | 'closed' (S3 admin panel)
  -- Everything below is context, never identity. user_id is filled in only when
  -- the sender happened to be signed in, so a logged-in student's message can be
  -- tied to their account without ever asking them to state who they are.
  user_id TEXT,                 -- normalized email from the session, or NULL
  ip_hash TEXT,                 -- peppered SHA-256, first 32 hex. Never a raw IP.
  user_agent TEXT               -- truncated; for reproducing "the form broke"
);

-- The inbox view is "newest first", and the only other query is "unread".
CREATE INDEX IF NOT EXISTS idx_contact_messages_ts ON contact_messages(ts);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status, ts);
