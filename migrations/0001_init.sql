-- Admin analytics schema (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 migrations apply ai-backgammon-stats --remote
-- Privacy: no raw IP, no User-Agent string, no keys/endpoints/prompts are ever stored.

CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  first_seen    TEXT NOT NULL,              -- ISO-8601 UTC
  last_seen     TEXT NOT NULL,
  day           TEXT NOT NULL,              -- YYYY-MM-DD (UTC), the salt-rotation day
  ip_hash       TEXT,                       -- HMAC(secret, day|ip), truncated; rotates daily
  country       TEXT,
  asn           INTEGER,
  as_org        TEXT,
  referrer_host TEXT,
  utm_source    TEXT,
  device_type   TEXT,
  browser       TEXT,
  os            TEXT,
  language      TEXT,
  viewport_w    INTEGER,
  viewport_h    INTEGER,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  bot_score     INTEGER,
  landing_path  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_first_seen ON sessions (first_seen);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions (day);

CREATE TABLE IF NOT EXISTS games (
  game_id      TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  duration_s   INTEGER,
  mode         TEXT NOT NULL,               -- humanVsAi | aiVsAi
  match_type   TEXT,                        -- mirror | custom
  ai_provider  TEXT,
  ai_model     TEXT,
  difficulty   TEXT,
  outcome      TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | finished | abandoned
  winner       TEXT,
  turns        INTEGER,
  moves        INTEGER,
  undo_count   INTEGER,
  pause_count  INTEGER,
  ai_errors    TEXT,                        -- JSON {code: count}
  board_style  TEXT,
  theme        TEXT
);

CREATE INDEX IF NOT EXISTS idx_games_started_at ON games (started_at);
CREATE INDEX IF NOT EXISTS idx_games_session ON games (session_id);

-- Long-term aggregates kept after raw rows are purged (retention: 90 days).
CREATE TABLE IF NOT EXISTS daily_stats (
  day        TEXT NOT NULL,
  country    TEXT NOT NULL,
  sessions   INTEGER NOT NULL DEFAULT 0,
  games      INTEGER NOT NULL DEFAULT 0,
  finished   INTEGER NOT NULL DEFAULT 0,
  abandoned  INTEGER NOT NULL DEFAULT 0,
  duration_s INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country)
);

