-- Tracks one row per user per calendar day recording their device type,
-- browser, and OS, for the in-app analytics dashboard (mobile vs desktop
-- usage breakdown). Run this once in the Supabase SQL editor.

create table if not exists device_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null default current_date,
  device_type text not null check (device_type in ('mobile', 'tablet', 'desktop')),
  browser text,
  os text,
  created_at timestamptz not null default now(),
  unique (user_id, session_date)
);

alter table device_sessions enable row level security;

create policy "Users can insert their own device sessions"
  on device_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own device sessions"
  on device_sessions for update
  using (auth.uid() = user_id);

create policy "Users can read their own device sessions"
  on device_sessions for select
  using (auth.uid() = user_id);
