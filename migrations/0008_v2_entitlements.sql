-- FlightWay 2.0 — entitlements (Pillar 0.3). Additive; safe against existing schema.
-- Apply with:  wrangler d1 migrations apply flightway-db
--
-- Plan gating ships "dark": until the PAYWALL_ENABLED Pages var is "true",
-- functions/_lib/entitlements.js treats everyone as premium (beta). These columns
-- are what a later Stripe webhook writes to flip a user to premium/lifetime.

ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free';       -- free | premium | lifetime
ALTER TABLE users ADD COLUMN plan_expires_at TEXT;            -- ISO; null = no expiry (lifetime / beta grant)
