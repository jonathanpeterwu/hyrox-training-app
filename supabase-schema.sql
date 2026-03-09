-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- This creates the table and RLS policies for the HYROX training app.

-- 1. Create the user_data table
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb,
  workout_log jsonb,
  workout_overrides jsonb,
  progression_overrides jsonb,
  day_messages jsonb,
  plan_messages jsonb,
  updated_at timestamptz default now()
);

-- 2. Enable Row Level Security
alter table public.user_data enable row level security;

-- 3. Users can only read/write their own data
create policy "Users can read own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id);

-- 4. Index for fast lookups
create index if not exists idx_user_data_user_id on public.user_data(user_id);
