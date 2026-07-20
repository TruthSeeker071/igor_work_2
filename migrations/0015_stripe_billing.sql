-- FlightWay — Stripe billing (free/paid merge §3). Additive; safe against the
-- existing schema. Apply with:  npx wrangler d1 migrations apply flightway-db --remote
--
-- No new entitlement dimension: the Interview Sprint is two weeks of premium on
-- the plan/plan_expires_at columns migration 0008 already added (§9), so nothing
-- here touches how entitlements are read.

-- Links a FlightWay account to its Stripe customer, so a returning buyer reuses
-- one customer record and the Customer Portal (functions/stripe/portal.js) has
-- something to open.
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- Webhook idempotency. Stripe delivers at-least-once; functions/stripe/webhook.js
-- claims an event id here before handling it (and deletes the row again if the
-- handler throws, so a genuine failure is still retryable).
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,          -- Stripe's evt_… id
  type TEXT,
  received_at TEXT              -- ISO
);
