-- Tracks whether an order's items have been taken out of product stock,
-- so payment success and order cancellation can adjust stock idempotently.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_decremented BOOLEAN NOT NULL DEFAULT FALSE;
