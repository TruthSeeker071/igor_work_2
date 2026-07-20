-- Mock-interview session log (debrief + 6-axis metric scores per session).
-- House style: email-keyed, TEXT ISO timestamps, IF NOT EXISTS, indexed on email.
CREATE TABLE IF NOT EXISTS interview_sessions (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  career      TEXT,
  soc         TEXT,
  persona     TEXT,            -- 'coach' | 'pressure'
  company     TEXT,            -- optional, opt-in company mode
  scores_json TEXT NOT NULL,   -- {communication,structure,specificity,technical,composure,fit,overall}
  debrief_json TEXT,           -- narrative verdict + highlights + next-time actions
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_email ON interview_sessions (email);
