-- Fix infinite recursion in recipes RLS policy
-- The issue occurs when a policy references itself or creates a circular dependency

-- First, drop existing policies on recipes table
DROP POLICY IF EXISTS "Users can view their own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can insert their own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can update their own recipes" ON recipes;
DROP POLICY IF EXISTS "Users can delete their own recipes" ON recipes;

-- Recreate simple, non-recursive policies
CREATE POLICY "Users can view their own recipes" 
ON recipes FOR SELECT 
TO authenticated 
USING (profile_id = auth.uid());

CREATE POLICY "Users can insert their own recipes" 
ON recipes FOR INSERT 
TO authenticated 
WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can update their own recipes" 
ON recipes FOR UPDATE 
TO authenticated 
USING (profile_id = auth.uid())
WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can delete their own recipes" 
ON recipes FOR DELETE 
TO authenticated 
USING (profile_id = auth.uid());
