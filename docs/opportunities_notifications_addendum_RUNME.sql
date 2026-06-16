-- ════════════════════════════════════════════════════════════════════════
-- ADDENDUM — NOT RUN. In-portal notifications + role routing for the
-- Opportunities Center. Builds on docs/opportunities_center_RUNME.sql (already
-- run). Copy the begin;…commit; block into the Supabase SQL Editor after approval.
-- Re-runnable. Rollback is a SEPARATE commented block at the bottom.
--
-- WHAT IT DOES (item 4 + 6): when a public opportunity request is submitted, it
-- creates in-portal notifications (the bell) routed by type:
--   • owner/admin (recipient_role='admin' broadcast) — see ALL requests
--   • super_admin staff — ALL types
--   • HR staff — job_application/training/freelancer/talent/volunteer
--   • manager staff — collaboration/co_production/media_partnership/sponsorship/supplier
-- Recipients can READ those requests (RLS already allows owner/admin/manager/hr).
-- finance/support/sales/editor/readonly/clients are NOT notified and cannot read
-- opportunities — unchanged. Only the submit RPC + the notifications type CHECK
-- change; no other object is touched and no RLS is weakened.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) Allow the new in-portal notification type. Re-create the inline CHECK with
--    the existing 9 values + 'opportunity_new' (do NOT drop any existing value).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed',
  'opportunity_new'));

-- 2) Re-create submit_opportunity_request to ALSO create routed notifications.
create or replace function public.submit_opportunity_request(
  p_type text, p_full_name text, p_email text default null, p_phone text default null,
  p_city text default null, p_message text default null,
  p_details jsonb default '{}'::jsonb, p_consent boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text; v_ar text; v_en text; r record;
begin
  if p_type <> all (array['job_application','training','collaboration','co_production',
                          'freelancer','supplier','media_partnership','talent',
                          'sponsorship','volunteer']) then
    raise exception 'invalid opportunity type';
  end if;
  if coalesce(trim(p_full_name),'') = '' then raise exception 'full name required'; end if;
  if p_consent is not true then raise exception 'consent required'; end if;

  v_num := 'OPP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.opportunity_seq')::text, 5, '0');
  insert into public.opportunity_requests
    (request_number, opportunity_type, full_name, email, phone, city, message, details, consent, source)
  values
    (v_num, p_type, trim(p_full_name), nullif(trim(coalesce(p_email,'')),''),
     nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_city,'')),''),
     nullif(trim(coalesce(p_message,'')),''), coalesce(p_details,'{}'::jsonb), true, 'public')
  returning id into v_id;

  v_ar := 'طلب فرصة جديد — ' || trim(p_full_name) || ' (' || v_num || ')';
  v_en := 'New opportunity request — ' || trim(p_full_name) || ' (' || v_num || ')';

  -- owner/admin broadcast (recipient_role='admin' requires recipient_id IS NULL).
  perform public.notify(null, 'admin', 'opportunity_new', 'opportunity', v_id, v_ar, v_en);

  -- Routed per-user notifications for super_admin (all), HR (HR types), manager (business types).
  for r in
    select id from public.profiles
    where account_status = 'active' and (
      staff_role = 'super_admin'
      or (staff_role = 'hr'      and p_type in ('job_application','training','freelancer','talent','volunteer'))
      or (staff_role = 'manager' and p_type in ('collaboration','co_production','media_partnership','sponsorship','supplier'))
    )
  loop
    perform public.notify(r.id, 'user', 'opportunity_new', 'opportunity', v_id, v_ar, v_en);
  end loop;

  return v_num;
end; $$;
-- CREATE OR REPLACE preserves the existing ACL; re-issue grants to be explicit.
revoke execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) from public;
grant  execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) to anon, authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ✅ After this runs: submitting a request pings owner/admin (+ super_admin) and
--    the routed HR/manager staff in-portal (bell). The notification entity_type
--    is 'opportunity' → clicking it opens /client-portal/opportunities (handled
--    in the app's NotificationsView). The dashboard "new requests" count cards
--    already work without this addendum (they query opportunity_requests directly).
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DO NOT RUN unless reverting (kept commented).
-- ────────────────────────────────────────────────────────────────────────
-- begin;
--   -- revert submit_opportunity_request to the no-notify version (see
--   --   docs/opportunities_center_RUNME.sql for the original body), then:
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed'));
-- commit;
-- ════════════════════════════════════════════════════════════════════════
