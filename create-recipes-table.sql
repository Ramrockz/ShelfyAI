-- Create recipes table with components column
-- Run this in your Supabase SQL Editor
-- COMPLETE RESET - This will drop and recreate the table from scratch

-- STEP 1: Drop ALL policies (including any with different names)
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'recipes') LOOP
    EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON recipes';
  END LOOP;
END $$;

-- STEP 2: Drop the table completely to ensure clean slate
DROP TABLE IF EXISTS recipes CASCADE;

-- STEP 3: Create the recipes table from scratch
CREATE TABLE recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  name TEXT NOT NULL,
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'ready',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- STEP 4: Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- STEP 5: Create indexes for better performance
CREATE INDEX idx_recipes_profile_id ON recipes(profile_id);
CREATE INDEX idx_recipes_created_at ON recipes(created_at DESC);

-- STEP 6: Enable Row Level Security
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- STEP 7: Create PERMISSIVE policies (explicitly allow access)
-- These are the simplest possible policies to avoid recursion
CREATE POLICY "enable_read_access" 
ON recipes FOR SELECT 
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_insert_access" 
ON recipes FOR INSERT 
TO authenticated
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_update_access" 
ON recipes FOR UPDATE 
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text))
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_delete_access" 
ON recipes FOR DELETE 
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));
