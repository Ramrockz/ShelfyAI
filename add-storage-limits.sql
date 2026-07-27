-- Add storage tracking to user_settings table
-- Run this in Supabase SQL Editor

-- Add storage columns
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT DEFAULT 10485760; -- Default 10MB for free tier

-- Update existing users to have proper storage limits based on their tier
-- Free: 10MB, Starter: 50MB, Pro: 250MB
UPDATE user_settings
SET storage_limit_bytes = CASE
  WHEN tier = 'free' THEN 10485760        -- 10 MB (~20 receipts)
  WHEN tier = 'starter' THEN 52428800   -- 50 MB (~100 receipts)
  WHEN tier = 'pro' THEN 262144000      -- 250 MB (~500 receipts)
  ELSE 10485760                          -- Default to free tier
END
WHERE storage_limit_bytes = 0 OR storage_limit_bytes = 104857600; -- Update rows with old defaults

-- Create function to update storage usage when receipts are uploaded/deleted
CREATE OR REPLACE FUNCTION update_user_storage()
RETURNS TRIGGER AS $$
DECLARE
  file_size BIGINT;
  user_uuid UUID;
  bucket_name TEXT;
BEGIN
  -- Determine which bucket this operation is for
  IF TG_OP = 'INSERT' THEN
    bucket_name := NEW.bucket_id;
  ELSE
    bucket_name := OLD.bucket_id;
  END IF;
  
  -- Only process if this is the expenses bucket
  IF bucket_name != 'expenses' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    -- Extract user ID from the file path (first folder in path is user_id)
    user_uuid := (storage.foldername(NEW.name))[1]::UUID;
    -- When file is uploaded, increase storage_used_bytes
    file_size := (NEW.metadata->>'size')::BIGINT;
    IF file_size IS NOT NULL THEN
      UPDATE user_settings
      SET storage_used_bytes = storage_used_bytes + file_size
      WHERE user_id = user_uuid;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Extract user ID from the file path
    user_uuid := (storage.foldername(OLD.name))[1]::UUID;
    -- When file is deleted, decrease storage_used_bytes
    file_size := (OLD.metadata->>'size')::BIGINT;
    IF file_size IS NOT NULL THEN
      UPDATE user_settings
      SET storage_used_bytes = GREATEST(0, storage_used_bytes - file_size)
      WHERE user_id = user_uuid;
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically track storage usage
DROP TRIGGER IF EXISTS track_storage_usage ON storage.objects;
CREATE TRIGGER track_storage_usage
AFTER INSERT OR DELETE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION update_user_storage();

-- Add check to prevent uploads exceeding storage limit
-- This will be enforced in the application code, but we can add a comment/function
CREATE OR REPLACE FUNCTION check_storage_limit(user_uuid UUID, file_size_bytes BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  current_usage BIGINT;
  storage_limit BIGINT;
BEGIN
  SELECT storage_used_bytes, storage_limit_bytes
  INTO current_usage, storage_limit
  FROM user_settings
  WHERE user_id = user_uuid;
  
  -- Return true if user has enough space, false otherwise
  RETURN (current_usage + file_size_bytes) <= storage_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a view for easy storage stats per user
CREATE OR REPLACE VIEW user_storage_stats AS
SELECT 
  user_id,
  tier,
  storage_used_bytes,
  storage_limit_bytes,
  ROUND((storage_used_bytes::DECIMAL / NULLIF(storage_limit_bytes, 0)) * 100, 2) as storage_percent_used,
  storage_limit_bytes - storage_used_bytes as storage_remaining_bytes,
  -- Human-readable formats
  pg_size_pretty(storage_used_bytes) as storage_used,
  pg_size_pretty(storage_limit_bytes) as storage_limit,
  pg_size_pretty(storage_limit_bytes - storage_used_bytes) as storage_remaining
FROM user_settings;

-- Grant access to the view
GRANT SELECT ON user_storage_stats TO authenticated;

COMMENT ON COLUMN user_settings.storage_used_bytes IS 'Total storage used by user in bytes (automatically updated by trigger)';
COMMENT ON COLUMN user_settings.storage_limit_bytes IS 'Storage limit based on user tier: Free=10MB, Starter=50MB, Pro=250MB';
