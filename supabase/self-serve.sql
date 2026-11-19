-- ════════════════════════════════════════════════════════════
--  ReplyBot AI — self-serve accounts
--  Run once in Supabase: SQL Editor → New query → paste → Run.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════

-- One row per business that signs up.
create table if not exists public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null unique references auth.users(id) on delete cascade,
  embed_key               text not null unique,
  name                    text not null,
  industry                text,
  phone                   text,
  email                   text,
  booking_url             text,
  website                 text,
  hours                   text,
  services                text,
  faq                     text,
  greeting                text,
  extra_instructions      text,
  primary_color           text not null default '#0EA5E9',
  alert_email             text,
  plan                    text not null default 'starter',
  subscription_status     text not null default 'trialing',
  trial_ends_at           timestamptz,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Saved chats + extracted lead info (one row per visitor session).
create table if not exists public.conversations (
  id             uuid primary key default gen_random_uuid(),
  session_id     text not null unique,
  business_id    uuid references public.businesses(id) on delete cascade,
  messages       jsonb not null default '[]'::jsonb,
  lead_name      text,
  lead_email     text,
  lead_phone     text,
  business_type  text,
  problem        text,
  score          integer not null default 0,
  tier           text not null default 'Cold',
  qualified      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Tag each chat with the business it belongs to (for older databases).
-- Existing rows (your own demo bot) keep business_id = null.
alter table public.conversations
  add column if not exists business_id uuid references public.businesses(id) on delete cascade;
create index if not exists conversations_business_id_idx
  on public.conversations (business_id, updated_at desc);
create index if not exists conversations_updated_at_idx
  on public.conversations (updated_at desc);

-- Lock both tables to the server. The server uses the service key, which
-- bypasses these rules; browsers using the public anon key get nothing.
alter table public.businesses    enable row level security;
alter table public.conversations enable row level security;
