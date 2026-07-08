-- FlightWay 2.0 — Week 1 fake-door pricing capture (Monetization validation).
-- Additive only; safe against the existing schema and Jacob's migrations.
-- Apply with the existing D1 flow:  wrangler d1 migrations apply flightway-db
--
-- Captures "Start free trial" clicks on pricing.html so we can measure
-- pricing-page CTR before writing any Stripe code. Validation gate from the
-- product plan: integrate payments only after >=5% of active users click through.

CREATE TABLE IF NOT EXISTS pricing_intents (
  id          TEXT PRIMARY KEY,
  email       TEXT,                 -- optional; captured if the visitor is signed in / opts in
  tier        TEXT NOT NULL,        -- monthly | annual | lifetime | sprint
  source      TEXT,                 -- pricing card / CTA the click came from
  ip_hash     TEXT,                 -- peppered SHA-256, coarse abuse signal only (never a raw IP)
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pricing_intents_created ON pricing_intents (created_at);
CREATE INDEX IF NOT EXISTS idx_pricing_intents_tier    ON pricing_intents (tier);
