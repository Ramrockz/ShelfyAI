-- Add tier column to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro'));

-- Update existing users to have the free tier
UPDATE user_settings 
SET tier = 'free' 
WHERE tier IS NULL;
