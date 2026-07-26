-- FlightWay V2 S17 — Network mapper (plan §5 S17, D13).
--
-- A `kind:'network'` roadmap step says "List 5 people to reach out to" and is the
-- least actionable line in the product: it names no person, no channel and no
-- first sentence. This table is what that step becomes — one row per person the
-- student is actually going to contact, carrying the archetype we suggested, the
-- message we drafted, and where they got to with it.
--
-- **FlightWay never sends any of this.** There is no send column and no provider
-- integration by design: the student copies the draft, edits it, and sends it
-- from their own account. `status` is therefore the student's own report of what
-- happened, not an observation — which is why 'sent' is a value they set and not
-- one we can ever infer.
--
-- `archetype` is the machine key ('alum', 'professor', …) and `label` is the
-- rendered sentence at the time the row was made. Both are stored: the key is
-- what dedupes a suggestion the student already has, and the label is what they
-- read — regenerating the label from the key later would silently rewrite a row
-- if their school or target career changed since.
--
-- `status_at` is NULL at creation and moves ONLY on a real status change, exactly
-- as `applications.status_at` does (0022). `updated_at` moves on a notes edit
-- too, so the digest's stale-draft nudge reads `status_at` — a student who fixed
-- a typo on Tuesday has not re-drafted anything, and telling them their draft is
-- fresh because they touched it would defeat the nudge.
--
-- `user_id` holds the account email, matching `deadlines`, `applications` and
-- `scorecards` (0020/0022/0024). account.js's purge classifies by column name,
-- so this row belongs in USER_ID_TABLES.

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  archetype   TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  org_type    TEXT NOT NULL DEFAULT '',
  how_to_find TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  org         TEXT NOT NULL DEFAULT '',
  channel     TEXT NOT NULL DEFAULT 'email',
  status      TEXT NOT NULL DEFAULT 'suggested',
  draft_subject TEXT NOT NULL DEFAULT '',
  draft_body    TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  career_slug TEXT NOT NULL DEFAULT '',
  step_id     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  status_at   TEXT
);

-- The panel's only read: "this student's list, newest first".
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts (user_id, created_at DESC);

-- The digest's weekly sweep asks "whose drafts have sat unsent for a week?"
-- across ALL users, which the per-user index cannot answer without a scan.
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts (status, status_at);
