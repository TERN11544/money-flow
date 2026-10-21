-- Run once in Supabase SQL Editor before enabling cloud sync.
create table if not exists public.money_flow_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.money_flow_data enable row level security;
revoke all on table public.money_flow_data from anon, authenticated;
grant select, insert, update, delete on table public.money_flow_data to authenticated;

drop policy if exists "Users can read their own Money Flow data" on public.money_flow_data;
create policy "Users can read their own Money Flow data"
  on public.money_flow_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own Money Flow data" on public.money_flow_data;
create policy "Users can insert their own Money Flow data"
  on public.money_flow_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Money Flow data" on public.money_flow_data;
create policy "Users can update their own Money Flow data"
  on public.money_flow_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Money Flow data" on public.money_flow_data;
create policy "Users can delete their own Money Flow data"
  on public.money_flow_data for delete to authenticated
  using ((select auth.uid()) = user_id);
