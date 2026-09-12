-- Add onboarding columns to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_store_count TEXT CHECK (onboarding_store_count IN ('1', '2-5', 'more-than-5')),
ADD COLUMN IF NOT EXISTS onboarding_categories JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS onboarding_order_volume TEXT CHECK (onboarding_order_volume IN ('1-10', '11-50', 'more-than-50')),
ADD COLUMN IF NOT EXISTS personalized_categories_enabled BOOLEAN DEFAULT true;

-- Update existing users to have personalized categories enabled
UPDATE user_settings 
SET personalized_categories_enabled = true 
WHERE personalized_categories_enabled IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN user_settings.onboarding_completed IS 'Whether user has completed the onboarding flow';
COMMENT ON COLUMN user_settings.onboarding_store_count IS 'Number of stores user manages: 1, 2-5, or more-than-5';
COMMENT ON COLUMN user_settings.onboarding_categories IS 'Array of product category preferences selected during onboarding';
COMMENT ON COLUMN user_settings.onboarding_order_volume IS 'Monthly order volume: 1-10, 11-50, or more-than-50';
COMMENT ON COLUMN user_settings.personalized_categories_enabled IS 'Whether to filter categories based on onboarding preferences';
