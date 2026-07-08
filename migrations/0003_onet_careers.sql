CREATE TABLE IF NOT EXISTS onet_careers (
  soc TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  soc_major TEXT NOT NULL,
  hub_zone TEXT NOT NULL,
  layout_x REAL,
  layout_y REAL,
  job_zone INTEGER,
  hub_featured INTEGER DEFAULT 0,
  hub_id INTEGER,
  derived_from_soc TEXT,
  vector_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_onet_title_norm ON onet_careers(title_norm);
CREATE INDEX IF NOT EXISTS idx_onet_hub_zone ON onet_careers(hub_zone);
CREATE INDEX IF NOT EXISTS idx_onet_layout ON onet_careers(layout_x, layout_y);
CREATE INDEX IF NOT EXISTS idx_onet_hub_featured ON onet_careers(hub_featured);
