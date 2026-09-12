-- Add reorder tracking fields to ingredients
-- Run once in Supabase SQL editor
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS reorder_date DATE,
  ADD COLUMN IF NOT EXISTS delivery_days INTEGER;
