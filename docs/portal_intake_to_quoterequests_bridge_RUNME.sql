-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — bridge guest website quote requests (public_intake) into the
-- existing admin quote workflow (quote_requests). ADDITIVE + idempotent.
--
-- PROBLEM: guest quote submissions land in public_intake (email-keyed, nullable
-- user_id) and show in the CLIENT portal, but the ADMIN "Quote Requests" list,
-- the pending-list RPC, and the Zoho estimate-create pipeline all read only the
-- canonical quote_requests path — so admins never see the new requests and can't
-- click "إنشاء تقدير من هذا الطلب".
--
-- FIX (smallest safe bridge = PROMOTION): copy each request_type='quote' intake
-- row into quote_requests (every downstream surface already speaks quote_requests:
-- the inbox, list_pending_quote_requests, the ?open deep-link, the Zoho create
-- route, the "فتح العرض" flip, and client-visibility rules). Made safe by:
--   • making quote_requests.user_id NULLABLE (a guest has no account yet),
--   • adding inline contact columns (email/full_name/company/phone/...) so the two
--     contact-resolving RPCs no longer depend on a profiles row,
--   • a source_intake_id idempotency key (one intake → at most one request → at
--     most one Zoho estimate),
--   • teaching get_quote_request_for_estimate / list_pending_quote_requests to
--     COALESCE inline columns over the (absent) profile.
-- Promotion creates a 'new' quote_requests row ONLY — it NEVER creates a Zoho
-- estimate (that still happens only when an admin clicks the button).
--
-- Depends on: portal_email_linking_RUNME (public_intake, capture_public_intake),
-- phase0 (quote_requests, notify), portal_zoho_estimates_RUNME (get_quote_request_for_estimate),
-- portal_open_quote_fix_RUNME (list_pending_quote_requests), can_manage_quotes().
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Make quote_requests guest-capable (additive) ════════════════════
alter table public.quote_requests alter column user_id drop not null;
alter table public.quote_requests add column if not exists email             text;
alter table public.quote_requests add column if not exists full_name         text;
alter table public.quote_requests add column if not exists company           text;
alter table public.quote_requests add column if not exists phone             text;
alter table public.quote_requests add column if not exists preferred_contact text;
alter table public.quote_requests add column if not exists source            text;
alter table public.quote_requests add column if not exists source_intake_id  uuid references public.public_intake(id) on delete set null;
-- Idempotency key: one public_intake row → one quote_request. NULLs are distinct,
-- so existing (manual) requests with NULL source_intake_id are unaffected.
create unique index if not exists uq_quote_requests_source_intake
  on public.quote_requests(source_intake_id);

-- RLS note: the existing policies are (user_id = auth.uid()) OR is_admin(). A guest
-- row has user_id NULL, so it NEVER matches the client-facing policy and is reachable
-- only via is_admin()/can_manage_quotes() (SECURITY DEFINER) paths — exactly intended.
-- Do NOT add any authenticated SELECT policy that would match user_id IS NULL rows.

-- ════════ 2) Promote one intake quote row → a quote_request (service-side) ════
create or replace function public.promote_intake_to_quote_request(p_intake uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi record; v_qr uuid;
begin
  -- Dedupe: already promoted?
  select id into v_qr from public.quote_requests where source_intake_id = p_intake limit 1;
  if v_qr is not null then return v_qr; end if;

  select * into v_pi from public.public_intake
    where id = p_intake and request_type = 'quote' and not is_deleted;
  if not found then return null; end if;

  insert into public.quote_requests
    (user_id, reference, services, description, city, preferred_date,
     email, full_name, company, phone, preferred_contact, source, source_intake_id, status)
  values (v_pi.user_id,
          coalesce(nullif(v_pi.reference,''), 'WEB-' || left(p_intake::text, 8)),
          coalesce(v_pi.services, '{}'),
          v_pi.details, v_pi.city,
          case when v_pi.preferred_date ~ '^\d{4}-\d{2}-\d{2}$' then v_pi.preferred_date::date else null end,
          lower(v_pi.email), v_pi.full_name, v_pi.company, v_pi.phone, v_pi.preferred_contact,
          coalesce(nullif(v_pi.source,''), 'website'), p_intake, 'new')
  on conflict (source_intake_id) do nothing
  returning id into v_qr;

  if v_qr is null then  -- lost a race; re-read the winner
    select id into v_qr from public.quote_requests where source_intake_id = p_intake limit 1;
  end if;

  -- Tidy: reflect that the intake has entered the quote workflow (non-breaking; MyRequests still reads it).
  update public.public_intake set status = 'reviewing', updated_at = now()
    where id = p_intake and status = 'new';
  return v_qr;
end; $$;
revoke execute on function public.promote_intake_to_quote_request(uuid) from public, anon, authenticated;
grant  execute on function public.promote_intake_to_quote_request(uuid) to service_role;

-- ════════ 3) Capture → auto-promote quote rows + deep-link the notification ═══
-- (Replaces the body from portal_email_linking_RUNME.sql. Same 14-arg signature.)
create or replace function public.capture_public_intake(
  p_user uuid, p_type text, p_email text, p_phone text, p_name text, p_company text, p_city text,
  p_reference text, p_services text[], p_details text, p_preferred_date text, p_preferred_contact text,
  p_source text, p_files jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text; v_qr uuid;
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

  if v_type = 'quote' then
    -- Make it appear in the admin quote workflow. This does NOT create a Zoho estimate.
    -- The t_quote_created trigger on the new quote_requests row already emits the admin
    -- notification with entity_type='quote_request' (deep-links to ?open=<id>), so we do
    -- NOT notify again here (avoids a duplicate). Fallback only if promotion yields nothing.
    v_qr := public.promote_intake_to_quote_request(v_id);
    if v_qr is null then
      perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id,
                            'طلب جديد من الموقع', 'New request from the website');
    end if;
  else
    perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id,
                          'طلب جديد من الموقع', 'New request from the website');
  end if;
  return v_id;
end; $$;
revoke execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) from public, anon, authenticated;
grant  execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) to service_role;

-- ════════ 4) Estimate-create contact resolver: COALESCE inline over profile ═══
-- Guest rows have user_id NULL (no profile) → must read email/name/company/phone
-- from the inline quote_requests columns, else the Zoho create returns "no email".
create or replace function public.get_quote_request_for_estimate(p_request uuid)
returns table (email text, full_name text, company text, phone text, services text[], description text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(qr.email,''),      p.email),
         coalesce(nullif(qr.full_name,''),  p.full_name),
         coalesce(nullif(qr.company,''),    p.company),
         coalesce(nullif(qr.phone,''),      p.mobile),
         qr.services, qr.description
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where qr.id = p_request and coalesce(qr.is_deleted,false) = false;
$$;
revoke execute on function public.get_quote_request_for_estimate(uuid) from public, anon, authenticated;
grant  execute on function public.get_quote_request_for_estimate(uuid) to service_role;

-- ════════ 5) Pending list: show the guest email (inline over profile) ═════════
-- Same return signature as portal_open_quote_fix_RUNME — only the email source changes.
create or replace function public.list_pending_quote_requests()
returns table (
  id uuid, reference text, services text[], email text, city text, budget_range text,
  status text, created_at timestamptz, has_quote boolean,
  linked_quote_id uuid, quote_number text, zoho_estimate_id text, estimate_number text, estimate_url text
) language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, coalesce(nullif(qr.email,''), p.email) as email,
         qr.city, qr.budget_range, qr.status, qr.created_at,
         (lq.id is not null) as has_quote,
         lq.id, lq.quote_number, lq.zoho_estimate_id, lq.estimate_number, lq.estimate_url
  from public.quote_requests qr
  left join public.profiles p on p.id = qr.user_id
  left join lateral (
    select q.id, q.quote_number, q.zoho_estimate_id, q.estimate_number, q.estimate_url
    from public.quotes q
    where q.quote_request_id = qr.id and not q.is_deleted
    order by q.created_at desc
    limit 1
  ) lq on true
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
grant execute on function public.list_pending_quote_requests() to authenticated;

-- ════════ 6) BACKFILL existing guest quote intake rows ═══════════════════════
-- Idempotent via the unique source_intake_id index (re-runnable; skips done rows).
-- Each inserted row fires t_quote_created → one admin "New quote request" notification,
-- which is desirable here: it surfaces the previously-invisible test requests to the admin.
insert into public.quote_requests
  (user_id, reference, services, description, city, preferred_date,
   email, full_name, company, phone, preferred_contact, source, source_intake_id, status)
select pi.user_id,
       coalesce(nullif(pi.reference,''), 'WEB-' || left(pi.id::text, 8)),
       coalesce(pi.services, '{}'),
       pi.details, pi.city,
       case when pi.preferred_date ~ '^\d{4}-\d{2}-\d{2}$' then pi.preferred_date::date else null end,
       lower(pi.email), pi.full_name, pi.company, pi.phone, pi.preferred_contact,
       coalesce(nullif(pi.source,''), 'website'), pi.id, 'new'
from public.public_intake pi
where pi.request_type = 'quote' and not pi.is_deleted
on conflict (source_intake_id) do nothing;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run after):
--   select id, reference, email, source, source_intake_id, user_id, status
--     from public.quote_requests where source_intake_id is not null order by created_at desc;
--   -- each backfilled/captured guest quote should appear; admin inbox + pending list now show them.
--
-- ROLLBACK:
-- begin;
--   -- restore prior RPC bodies from their original files:
--   --   capture_public_intake          → docs/portal_email_linking_RUNME.sql (§2)
--   --   get_quote_request_for_estimate → docs/portal_zoho_estimates_RUNME.sql
--   --   list_pending_quote_requests    → docs/portal_open_quote_fix_RUNME.sql
--   drop function if exists public.promote_intake_to_quote_request(uuid);
--   delete from public.quote_requests where source_intake_id is not null;  -- remove promoted rows
--   drop index if exists public.uq_quote_requests_source_intake;
--   alter table public.quote_requests drop column if exists source_intake_id;
--   alter table public.quote_requests drop column if exists source;
--   alter table public.quote_requests drop column if exists preferred_contact;
--   alter table public.quote_requests drop column if exists phone;
--   alter table public.quote_requests drop column if exists company;
--   alter table public.quote_requests drop column if exists full_name;
--   alter table public.quote_requests drop column if exists email;
--   -- (only after confirming no guest rows remain) alter table public.quote_requests alter column user_id set not null;
-- commit;
