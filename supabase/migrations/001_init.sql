-- My Money: private storage for one owner.
-- Every table has Row Level Security on. Browser code can only touch its own rows in `kv`,
-- and only if it is the owner. Bank connections are readable by server functions only.

create table if not exists public.owner (
  id uuid primary key references auth.users(id) on delete cascade,
  singleton boolean not null default true unique check (singleton), -- at most one owner
  created_at timestamptz not null default now()
);
alter table public.owner enable row level security;
-- no policies: only the service role (server functions) can read/write it

create table if not exists public.kv (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.kv enable row level security;

create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owner o where o.id = auth.uid());
$$;
revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to authenticated;

create policy "owner reads own kv" on public.kv for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_owner()));
create policy "owner inserts own kv" on public.kv for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_owner()));
create policy "owner updates own kv" on public.kv for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_owner()))
  with check (user_id = (select auth.uid()) and (select private.is_owner()));
create policy "owner deletes own kv" on public.kv for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_owner()));

-- Bank connections (tokens are encrypted by the server before they are stored)
create table if not exists public.connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  data text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.connections enable row level security;
-- no policies: browser can never read tokens

-- Short-lived OAuth state for the LHV login round trip
create table if not exists public.oauth_state (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_state enable row level security;
-- no policies

-- App-wide values (e.g. the LHV client registration), server only
create table if not exists public.app_config (
  key text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
-- no policies

-- Least privilege: browsers may only touch kv (and RLS limits that to the owner's own rows).
revoke all on public.kv, public.owner, public.connections, public.oauth_state, public.app_config from anon, authenticated;
grant select, insert, update, delete on public.kv to authenticated;
-- Server functions (service role) need full access to do their job.
grant select, insert, update, delete on public.kv, public.owner, public.connections, public.oauth_state, public.app_config to service_role;
