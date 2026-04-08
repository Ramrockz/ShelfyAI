# Feedback Table Setup

This SQL script creates the feedback table and sets up proper Row Level Security (RLS) policies.

## How to Run

1. Log into your Supabase dashboard
2. Go to the SQL Editor
3. Copy and paste the contents of `create-feedback-table.sql`
4. Click "Run" to execute the script

## What This Creates

- **feedback table** with columns:
  - `id`: Unique identifier (UUID)
  - `user_id`: Reference to the authenticated user
  - `score`: Rating from 1 to 5
  - `comment`: Optional text feedback
  - `created_at`: Timestamp of submission

- **Row Level Security Policies:**
  - Users can insert their own feedback
  - Users can read their own feedback

- **Indexes** for optimized queries on user_id and created_at

## Troubleshooting

If you see a "403 Forbidden" or "row-level security policy" error:
1. Make sure this SQL script has been run in your Supabase database
2. Verify that RLS is enabled on the feedback table
3. Confirm the policies are created correctly
