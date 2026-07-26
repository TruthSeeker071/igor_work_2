-- FlightWay V2 S15 — shareable career map + referral loop (plan §5 S15, D4/D24).
-- Additive; safe against existing schema. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote --env production
--
-- Until it is applied every S15 surface degrades to an explicit, honest "not
-- switched on yet" (same contract S9/S11/S12 used): the share button still
-- renders and still downloads a PNG (that path is pure client canvas and needs
-- no database at all), "create a public link" reports that link sharing is not
-- enabled, /s/<id> 404s, /r/<code> redirects home without binding anything, and
-- the invite card says so out loud. None of that is an error state.

-- ---------------------------------------------------------------- shares
--
-- One row per link the user EXPLICITLY created. Nothing here is written by a
-- background path: a share page that appears without a deliberate action is a
-- privacy incident, not a growth feature, so the only writer is POST /share.
--
-- `user_id` holds the normalized email, consistent with `events`, `email_log`,
-- `deadlines` and `applications`. Purged with the account
-- (functions/account.js USER_ID_TABLES).
--
-- `id` is 22 chars of base62 from crypto.getRandomValues — ~131 bits. The page
-- is unauthenticated by design (that is what makes it shareable), so the id IS
-- the capability and it has to be unguessable rather than merely unique.
--
-- `payload` is the JSON the card was rendered from (first name + up to three
-- matches). Kept so the page can re-render text server-side for crawlers and
-- for anyone the PNG fails to load for — never re-derived from live user data,
-- because a share is a snapshot of what the user previewed and consented to,
-- not a live window into their account.
--
-- `img_key` is the COACH_KV key holding the PNG. It carries the owner's email
-- as a colon-delimited segment (`shareimg:<email>:<id>`) precisely so the
-- account-purge KV sweep finds and deletes it without a second list to keep in
-- sync — see the sweep note in functions/account.js.
--
-- `revoked_at` is a tombstone, not a delete: the row stays so a revoked id can
-- never be re-issued to a different snapshot, and so /s/<id> answers 404 for a
-- link that is already pasted into a group chat.
CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  payload     TEXT NOT NULL,
  img_key     TEXT,
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id, created_at DESC);

-- ------------------------------------------------------------- referral code
--
-- Short, unique, url-safe. Generated lazily the first time a user opens an
-- invite surface, NOT at signup: most accounts will never share a link, and a
-- code minted for everyone is a bigger unique-index to maintain for nothing.
-- The UNIQUE index is what makes the generate-and-retry loop safe.
ALTER TABLE users ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- ------------------------------------------------------------------ referrals
--
-- One row per BOUND referee — created at signup, never at visit time. A row per
-- anonymous /r/<code> hit would be unbounded free writes for anyone with a
-- terminal; the visit is recorded as a `referral_visit` analytics event
-- instead, which is where a count belongs (see docs/EVENTS.md).
--
-- status: signed_up -> converted -> credited, plus a terminal `void`.
--   signed_up  the referee bound at registration; nothing owed yet
--   converted  the referee's first successful payment landed (claimed here
--              FIRST, before any Stripe call, so a webhook replay cannot
--              double-credit)
--   credited   the referrer's Stripe customer balance actually carries the credit
--   void       an admin killed it, or a fraud guard refused it permanently
--
-- Both id columns hold normalized emails. They are NOT named `user_id`/`email`
-- on purpose — the row is about a relationship between two accounts, and
-- collapsing either side into the generic name would make the purge
-- classification ambiguous. scripts/test-account-purge.mjs knows both names.
--
-- `signup_ip_hash` is the same peppered hash `checkRateLimit` already uses. It
-- is the only fraud signal stored, it is never reversible to an address, and it
-- exists so "one person, twelve accounts, one afternoon" is detectable.
CREATE TABLE IF NOT EXISTS referrals (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  referrer_id    TEXT,
  referee_id     TEXT,
  status         TEXT NOT NULL,
  flags          TEXT,
  signup_ip_hash TEXT,
  credit_cents   INTEGER,
  created_at     TEXT NOT NULL,
  converted_at   TEXT,
  credited_at    TEXT,
  voided_at      TEXT,
  void_reason    TEXT
);
-- Bind-once. SQLite allows many NULLs in a UNIQUE index, which is exactly what
-- the account purge needs: it nulls the departing side rather than deleting the
-- row, and several anonymized rows must be able to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status, created_at DESC);
