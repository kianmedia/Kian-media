-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — email-based auto-linking of guest submissions. ADDITIVE.
--
-- Problem: a visitor's quote/meeting/file submission only went to Google Sheets,
-- so after they sign up with the SAME verified email the portal had nothing to
-- show. This captures those submissions into public_intake (email-keyed) and links
-- them — plus their email-matched quotes — to the user on login.
--
-- Visibility is by the VERIFIED email (public.my_email() = the auth user's profile
-- email, set from auth at signup) OR a matching user_id OR staff. Anon can only
-- WRITE via the SECURITY DEFINER capture RPC (called server-side); never READ.
--
-- Depends on phase0 (profiles, notify), portal_zoho_estimates_RUNME (my_email(),
-- quotes.email), staff helpers (is_staff()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) public_intake — guest/lead submissions keyed by email ═══════════
create table if not exists public.public_intake (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  request_type      text not null check (request_type in ('quote','meeting','call','files','contact','other')),
  reference         text,
  email             text not null,
  phone             text,
  full_name         text,
  company           text,
  city              text,
  services          text[] not null default '{}',
  details           text,
  preferred_date    text,
  preferred_contact text,
  file_links        jsonb,   -- [{label,url}] from the upload-files form
  status            text not null default 'new' check (status in ('new','reviewing','quoted','scheduled','completed','closed')),
  source            text,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_public_intake_email on public.public_intake(lower(email), created_at);
create index if not exists idx_public_intake_user  on public.public_intake(user_id);
alter table public.public_intake enable row level security;
-- Read: own (by user_id OR verified email) + staff. Anon (no email/uid) sees nothing.
drop policy if exists public_intake_read on public.public_intake;
create policy public_intake_read on public.public_intake for select to authenticated using (
  not is_deleted and (
    user_id = auth.uid()
    or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__'))
    or public.is_staff()));
grant select on public.public_intake to authenticated;
-- NO insert/update/delete grants — writes go through the SECURITY DEFINER RPCs below.

-- ════════ 2) Capture a public submission (server-side; sets user_id if known) ═
create or replace function public.capture_public_intake(
  p_user uuid, p_type text, p_email text, p_phone text, p_name text, p_company text, p_city text,
  p_reference text, p_services text[], p_details text, p_preferred_date text, p_preferred_contact text,
  p_source text, p_files jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  if p_email is null or position('@' in p_email) = 0 then raise exception 'valid email required'; end if;
  v_type := case when p_type in ('quote','meeting','call','files','contact','other') then p_type else 'other' end;
  insert into public.public_intake
    (user_id, request_type, reference, email, phone, full_name, company, city, services, details,
     preferred_date, preferred_contact, file_links, source)
  values (p_user, v_type, nullif(p_reference,''), lower(trim(p_email)), nullif(p_phone,''), nullif(p_name,''),
          nullif(p_company,''), nullif(p_city,''), coalesce(p_services,'{}'), nullif(p_details,''),
          nullif(p_preferred_date,''), nullif(p_preferred_contact,''), p_files, nullif(p_source,''))
  returning id into v_id;
  -- Notify owner/admin + sales/manager of the new website request.
  perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id, 'طلب جديد من الموقع', 'New request from the website');
  return v_id;
end; $$;
revoke execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) from public, anon, authenticated;
grant  execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) to service_role;

-- ════════ 3) Link my email-matched records on login (authenticated) ══════════
create or replace function public.link_my_records_by_email() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; v_client uuid; v_intake int := 0; v_quotes int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_email := lower(trim(coalesce((select email from public.profiles where id = auth.uid()), '')));
  if v_email = '' then return jsonb_build_object('linked_intake', 0, 'linked_quotes', 0, 'has_client', false); end if;
  -- Attach guest intake rows submitted with this verified email.
  update public.public_intake set user_id = auth.uid(), updated_at = now()
   where user_id is null and lower(coalesce(email,'')) = v_email and not is_deleted;
  get diagnostics v_intake = row_count;
  -- Attach email-matched quotes/estimates to the client context (if a clients row exists).
  select id into v_client from public.clients where user_id = auth.uid() and is_deleted = false limit 1;
  if v_client is not null then
    update public.quotes set client_id = v_client, updated_at = now()
     where client_id is null and lower(coalesce(email,'')) = v_email and not is_deleted;
    get diagnostics v_quotes = row_count;
  end if;
  return jsonb_build_object('linked_intake', v_intake, 'linked_quotes', v_quotes, 'has_client', v_client is not null,
                           'recognized', (v_intake > 0 or exists (select 1 from public.quotes q where lower(coalesce(q.email,'')) = v_email and not q.is_deleted)));
end; $$;
revoke execute on function public.link_my_records_by_email() from public, anon;
grant  execute on function public.link_my_records_by_email() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.link_my_records_by_email();
--   drop function if exists public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb);
--   drop table if exists public.public_intake cascade;
-- commit;
