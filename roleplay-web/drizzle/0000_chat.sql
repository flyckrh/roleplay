CREATE TABLE IF NOT EXISTS character_versions (
  id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  portrait TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES character_versions(id),
  transcript TEXT NOT NULL DEFAULT '[]',
  turns INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  pending TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_sessions_updated ON chat_sessions(updated_at);
