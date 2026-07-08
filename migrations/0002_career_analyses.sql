CREATE TABLE IF NOT EXISTS career_analyses (
  email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (email, slug)
);

CREATE INDEX IF NOT EXISTS idx_career_analyses_email ON career_analyses(email);
