-- FlightWay 2.0 — opt-in nudge emails (Pillar B2). Additive; safe against schema.
-- Apply with:  wrangler d1 migrations apply flightway-db
--
-- notify_optin: 1 if the user asked for the weekly Flight Plan nudge (default off).
-- notify_token_hash: the deterministic one-click unsubscribe token (see
-- functions/_lib/notify-token.js). Stored for reference; unsubscribe re-derives it.

ALTER TABLE users ADD COLUMN notify_optin INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN notify_token_hash TEXT;
