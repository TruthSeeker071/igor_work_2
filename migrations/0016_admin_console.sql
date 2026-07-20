-- FlightWay — admin console + comp grants. Additive only; the D1 database is
-- shared between the prototype and production, so nothing here drops or
-- rewrites an existing column. Apply with:
--   npx wrangler d1 migrations apply flightway-db --remote
--
-- Design note: a comp grant is NOT a new entitlement dimension. Applying one
-- writes the SAME users.plan / users.plan_expires_at columns migration 0008
-- added, so getPlan() picks it up with zero extra reads and the three
-- entitlement chokepoints (resolveEntitlement / requirePlan / checkFeatureLimit)
-- are untouched. plan_source only records WHO wrote those columns, so revoke
-- and the Stripe webhook can tell a comp apart from a purchase.

-- 'comp' | 'stripe' | NULL (legacy/beta grants and free users).
ALTER TABLE users ADD COLUMN plan_source TEXT;

-- One row per comped email. The email may not have an account yet: such a row
-- stays pending (applied_at IS NULL) until functions/auth/register.js consumes
-- it right after the user row is created.
CREATE TABLE IF NOT EXISTS comp_grants (
  email TEXT PRIMARY KEY,       -- normalized (trimmed, lowercased)
  plan TEXT NOT NULL,           -- premium | lifetime
  expires_at TEXT,              -- ISO; null = no expiry
  granted_by TEXT,              -- admin email that created it
  created_at TEXT,              -- ISO
  applied_at TEXT,              -- ISO; null = pending (no account yet)
  revoked_at TEXT,              -- ISO; null = live
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_comp_grants_pending ON comp_grants(applied_at);

-- Sub-admins. The ROOT admin is NEVER stored here — it lives only in the
-- ROOT_ADMIN_EMAIL Pages env var, so no D1 write can create or remove it.
CREATE TABLE IF NOT EXISTS admin_roles (
  email TEXT PRIMARY KEY,
  granted_by TEXT,
  created_at TEXT
);

-- Append-only. Nothing in the app ever UPDATEs or DELETEs a row here.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,          -- uuid
  actor_email TEXT,
  action TEXT,                  -- e.g. grant.create, grant.revoke, admin.add
  target_email TEXT,
  detail TEXT,                  -- JSON blob
  created_at TEXT               -- ISO
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
