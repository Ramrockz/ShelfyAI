-- Add receipt_url column to sales table
-- Run this in Supabase SQL Editor

ALTER TABLE sales
ADD COLUMN IF NOT EXISTS receipt_url TEXT;

COMMENT ON COLUMN sales.receipt_url IS 'URL of uploaded receipt image stored in Supabase Storage';
