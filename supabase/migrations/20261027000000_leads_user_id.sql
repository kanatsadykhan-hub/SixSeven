-- Optional sign-in: link a lead to its Supabase Auth user and let signed-in users
-- read only their own leads. Run by hand in the Supabase SQL editor; no build runs it.
--
-- Before running, inspect the current table (read-only):
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'leads' order by ordinal_position;
--   select relrowsecurity from pg_class where oid = 'public.leads'::regclass;
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'leads';
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'leads';

begin;

-- Owner of a lead; null = anonymous. Deleting a user keeps their leads.
alter table public.leads
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- The cabinet sorts by date. Skipped if the column exists; if it is added here,
-- existing rows get the time of this migration.
alter table public.leads
  add column if not exists created_at timestamptz not null default now();

create index if not exists leads_user_id_created_at_idx
  on public.leads (user_id, created_at desc);

alter table public.leads enable row level security;

-- Data API: anon gets nothing, signed-in users may only read (rows filtered by RLS).
-- Inserts keep going through api/lead.js with the secret key (service_role, which
-- bypasses RLS); service_role grants are not touched.
revoke all on table public.leads from anon, authenticated;
grant select on table public.leads to authenticated;

drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_own" on public.leads
  for select to authenticated
  using ((select auth.uid()) = user_id);

commit;

-- Rollback:
--   begin;
--   drop policy if exists "leads_select_own" on public.leads;
--   revoke select on table public.leads from authenticated;
--   drop index if exists public.leads_user_id_created_at_idx;
--   alter table public.leads drop column if exists user_id;
--   commit;
