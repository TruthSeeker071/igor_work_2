-- FlightWay V2 S19 — NPS + consented testimonials (plan §5 S19, D28).
--
-- Two tables rather than one, because they answer different questions and have
-- different lifetimes. `nps_responses` is a private measurement: it exists to
-- tell us whether the product is working, is never rendered to anybody but the
-- admin, and every row is one. `testimonials` is a PUBLICATION request: a row
-- there is text a student agreed to let us print, and the whole table is
-- readable by the world once a human approves it.
--
-- Three things here are load-bearing and easy to undo by accident:
--
-- 1. **`score` is nullable and `status` says why.** A student who closes the
--    card without answering writes a row too — `status='dismissed'`, `score`
--    NULL — because the 30-day frequency cap has to cover "asked and declined"
--    or checking off two tasks in one sitting asks twice. That makes the null a
--    real value with a meaning, so every average MUST filter on
--    `status='scored'`; an AVG(score) over this table silently reads the
--    response rate into the NPS. `test:nps` asserts the filter.
--
-- 2. **`display_name` and `school` are stored ONLY when the matching consent
--    box was ticked**, not merely hidden at render time. The redaction happens
--    once, at write, in `redactConsent` — so a future bug in the public read
--    path cannot leak a name the student never agreed to print, because the
--    name is not in the row. An unconsented field is the empty string, and the
--    two `consent_*` columns record what was actually agreed to so a later
--    reviewer can see the difference between "declined" and "never asked".
--
-- 3. **`quote` is a SNAPSHOT.** It is the sentence the student typed and
--    approved, stored verbatim. Nothing regenerates it, summarises it or
--    re-renders it from other fields — publishing a quote somebody did not
--    write under their own name is the one failure this feature cannot recover
--    from.
--
-- `user_id` holds the account email, matching `deadlines`, `applications`,
-- `scorecards` and `contacts` (0020/0022/0024/0025). account.js's purge
-- classifies by column name, so BOTH tables belong in USER_ID_TABLES — an
-- approved quote on the marketing homepage is the single most visible thing a
-- deletion request must remove.

CREATE TABLE IF NOT EXISTS nps_responses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  -- Which product moment triggered the ask ('flightplan_done' | 'roadmap_commit'
  -- | 'month_review'). Stored so a low score can be read against the surface
  -- that produced it rather than as one undifferentiated number.
  moment     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'scored',
  score      INTEGER,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- The cooldown read: "when did we last ask this person anything?" — one row,
-- newest first, which is the only query on the write path.
CREATE INDEX IF NOT EXISTS idx_nps_user ON nps_responses (user_id, created_at DESC);

-- The admin read: every scored response in a window, across all users.
CREATE INDEX IF NOT EXISTS idx_nps_created ON nps_responses (created_at);

CREATE TABLE IF NOT EXISTS testimonials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  -- The NPS row this grew out of, and a copy of its score. The copy is
  -- deliberate: the queue shows "9" beside the quote, and joining two tables to
  -- print one digit on a page that lists thirty of them is work with no payoff.
  nps_id        TEXT NOT NULL DEFAULT '',
  score         INTEGER,
  quote         TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  school        TEXT NOT NULL DEFAULT '',
  consent_name   INTEGER NOT NULL DEFAULT 0,
  consent_school INTEGER NOT NULL DEFAULT 0,
  -- 'pending' | 'approved' | 'featured' | 'rejected'. Nothing renders publicly
  -- except approved and featured; featured sorts first.
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT,
  reviewed_by   TEXT
);

-- The queue read ("what is pending?") and the public read ("what is approved?")
-- are the same shape.
CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials (status, created_at DESC);

-- One student cannot flood the queue; the write path checks this first.
CREATE INDEX IF NOT EXISTS idx_testimonials_user ON testimonials (user_id, created_at DESC);
