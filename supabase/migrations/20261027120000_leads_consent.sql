-- Proof of consent for each lead: when the server accepted it and which consent
-- text it was (CONSENT_VERSION in api/lead.js). Run by hand in the Supabase SQL
-- editor; no build runs it. Rows saved before this stay null: their consent was
-- checked but not recorded.
--
-- Grants and RLS are unchanged: "grant select" on the table covers new columns,
-- the read policy still returns only the user's own rows, and inserts keep going
-- through api/lead.js with the secret key.
--
-- Until this runs, api/lead.js saves leads without these two columns.

begin;

alter table public.leads
  add column if not exists consent_at timestamptz,
  add column if not exists consent_version text;

alter table public.leads drop constraint if exists leads_consent_version_length;
alter table public.leads add constraint leads_consent_version_length
  check (consent_version is null or char_length(consent_version) between 1 and 64);

commit;

-- Check afterwards (read-only):
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'leads'
--     and column_name in ('consent_at', 'consent_version');

-- Rollback:
--   begin;
--   alter table public.leads drop constraint if exists leads_consent_version_length;
--   alter table public.leads drop column if exists consent_version;
--   alter table public.leads drop column if exists consent_at;
--   commit;
