-- Migration number: 0003 	 Per-shipment check interval

-- The cron ticks every 5 minutes; each shipment is only checked once it's due.
ALTER TABLE shipments ADD COLUMN check_interval_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE shipments ADD COLUMN next_check_at TEXT;  -- NULL = check on the next tick

CREATE INDEX IF NOT EXISTS idx_shipments_due
  ON shipments (is_active, next_check_at);
