-- Migration number: 0002 	 Track individual BlueDart scans and the expected delivery date

-- Change detection now compares scan history rather than a single status value.
ALTER TABLE shipments ADD COLUMN expected_delivery_date TEXT;
-- Notification text waiting to be sent. Set together with the update, cleared once
-- Telegram accepts it, so a failed send is retried on the next cron run.
ALTER TABLE shipments ADD COLUMN pending_message TEXT;

CREATE INDEX IF NOT EXISTS idx_shipments_pending
  ON shipments (pending_message) WHERE pending_message IS NOT NULL;

-- status_events is replaced by scans (it never held production data).
DROP TABLE IF EXISTS status_events;

-- One row per row of BlueDart's "Status and Scans" table.
CREATE TABLE IF NOT EXISTS scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  location     TEXT    NOT NULL,
  details      TEXT    NOT NULL,
  scan_date    TEXT    NOT NULL,  -- as shown by BlueDart, e.g. "07 Mar 2026"
  scan_time    TEXT    NOT NULL,  -- as shown by BlueDart, e.g. "10:15"
  scan_key     TEXT    NOT NULL,  -- normalized date|time|location|details, for de-duplication
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shipment_id, scan_key)
);
