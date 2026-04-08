-- Create storage bucket for expense receipts
-- Run this in Supabase SQL Editor

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('expenses', 'expenses', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for the expenses bucket
CREATE POLICY "Users can upload their own expense receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own expense receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own expense receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
