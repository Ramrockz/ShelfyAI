-- Add receipt columns to the sales table
-- Run this once in Supabase SQL Editor

ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_urls JSONB;

-- Optional: index for querying by receipt presence
CREATE INDEX IF NOT EXISTS idx_sales_receipt_urls ON sales USING GIN (receipt_urls);
