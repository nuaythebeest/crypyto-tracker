-- ============================================================
-- CRYPTO FUTURES SIGNAL TRACKER — V2 SUPABASE SCHEMA
-- Run this entire file in the Supabase SQL Editor once.
-- ============================================================

-- ============================================================
-- USER PROFILES
-- ============================================================
create table public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text not null default 'Trader',
  telegram_chat_id text default null,
  account_size numeric(12,2) not null default 600.00,
  risk_percent numeric(5,2) not null default 10.00,
  default_leverage int not null default 7,
  created_at timestamptz not null default now()
);

-- RLS: users can only read/write their own profile
alter table public.user_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);


-- ============================================================
-- TRADES
-- ============================================================
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry_price numeric(18,6) not null,
  stop_loss numeric(18,6) not null,
  tp1 numeric(18,6) not null,
  tp2 numeric(18,6) not null,
  tp3 numeric(18,6) not null,
  sl_distance_pct numeric(8,4),
  leverage int not null default 7,
  confidence int not null default 70,
  margin_used numeric(12,2),
  signal_time timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'paper' check (status in ('paper', 'taken', 'skipped', 'expired')),
  result text default null check (result in ('win', 'loss', 'partial', null)),
  exit_price numeric(18,6) default null,
  pnl_usdt numeric(12,2) default null,
  notes text default '',
  created_at timestamptz not null default now()
);

-- RLS: users can only access their own trades
alter table public.trades enable row level security;

create policy "Users can view own trades"
  on public.trades for select
  using (auth.uid() = user_id);

create policy "Users can insert own trades"
  on public.trades for insert
  with check (auth.uid() = user_id);

create policy "Users can update own trades"
  on public.trades for update
  using (auth.uid() = user_id);

create policy "Users can delete own trades"
  on public.trades for delete
  using (auth.uid() = user_id);


-- ============================================================
-- ALERTS
-- ============================================================
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  pair text not null,
  alert_type text not null,  -- 'new_signal' | 'tp1' | 'tp2' | 'tp3' | 'stop_loss' | 'loss_limit' | 'signal_expired'
  message text not null,
  price numeric(18,6) default null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS: users can only access their own alerts
alter table public.alerts enable row level security;

create policy "Users can view own alerts"
  on public.alerts for select
  using (auth.uid() = user_id);

create policy "Users can insert own alerts"
  on public.alerts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own alerts"
  on public.alerts for update
  using (auth.uid() = user_id);

-- Enable real-time on these tables
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.alerts;
