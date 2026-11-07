-- Migration number: 0001 	 Initial schema: users, shipments, status_events

-- Telegram users who have talked to the bot.
CREATE TABLE IF NOT EXISTS users (
  chat_id     INTEGER PRIMARY KEY,
  username    TEXT,
  first_name  TEXT,
  is_blocked  INTEGER NOT NULL DEFAULT 0,  -- 1 when Telegram returns 403 (user blocked the bot)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per (user, AWB) being tracked.
CREATE TABLE IF NOT EXISTS shipments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id          INTEGER NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  awb              TEXT    NOT NULL,
  label            TEXT,                        -- optional nickname, e.g. "Amazon headphones"
  last_status      TEXT,                        -- normalized status, compared on each cron run
  last_status_text TEXT,                        -- human-readable status shown to the user
  last_location    TEXT,
  last_event_at    TEXT,                        -- carrier timestamp of the latest scan
  last_checked_at  TEXT,                        -- when the cron last checked this shipment
  is_active        INTEGER NOT NULL DEFAULT 1,  -- 0 after /untrack or once delivered
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chat_id, awb)
);

-- Cron picks active shipments, oldest-checked first.
CREATE INDEX IF NOT EXISTS idx_shipments_active_checked
  ON shipments (is_active, last_checked_at);

-- History: one row per detected status change.
CREATE TABLE IF NOT EXISTS status_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL,
  status_text  TEXT,
  location     TEXT,
  event_at     TEXT,
  is_terminal  INTEGER NOT NULL DEFAULT 0,  -- 1 for delivered / returned
  notified     INTEGER NOT NULL DEFAULT 0,  -- 1 once the Telegram notification was sent
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_status_events_shipment
  ON status_events (shipment_id, created_at);
