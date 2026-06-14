-- ═══════════════════════════════════════════════════════════════════════════
-- KIAN CLIENT PORTAL — PHASE 1 ADDENDUM S1 (rev 2)
--
-- STATUS: ✅ EXECUTED on production 2026-06-12 · verified by S1-V (10 checks, 0 FAIL)
-- rev 2 fix: rev 1 aborted (atomic rollback) because the admin_notify
--   revoke/grant lines used notify()'s 7-param signature; admin_notify's real
--   signature is (uuid,text,text,uuid,text,text) — no p_role parameter.
--
-- CONTENTS
--   A) Security hardening: revoke browser EXECUTE on notify()/log_activity()
--      (Postgres grants functions to PUBLIC by default — these were callable
--      from the browser via PostgREST /rpc until this addendum).
--      Triggers keep working (SECURITY DEFINER, owner = postgres).
--      RLS helpers (is_admin, is_active, …) intentionally NOT revoked —
--      policies evaluate them under the querying role.
--   B) The 6 minimum admin RPCs for the Phase-1 admin panel, every one
--      hard-guarded by is_admin() inside the function body.
--      Notable: admin_set_account() enforces the roadmap rule that
--      account_type='admin' is restricted to the two approved emails.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── A. HARDENING ────────────────────────────────────────────────────────────
revoke execute on function public.notify(uuid,text,text,text,uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.log_activity(uuid,text,text,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.notify(uuid,text,text,text,uuid,text,text)  to service_role;
grant execute on function public.log_activity(uuid,text,text,text,uuid,jsonb) to service_role;

-- ─── B1. Project status update ───────────────────────────────────────────────
create or replace function public.admin_set_project_status(p_project uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status <> all (array['request_received','pre_production','shooting_scheduled',
                            'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  update public.projects set status = p_status
   where id = p_project and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_project_status(uuid,text) from public, anon;
grant  execute on function public.admin_set_project_status(uuid,text) to authenticated;

-- ─── B2. Add deliverable ─────────────────────────────────────────────────────
create or replace function public.admin_add_deliverable(
  p_project uuid, p_title text, p_type text default 'video',
  p_preview_url text default null, p_vimeo_url text default null,
  p_status text default 'draft')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status <> all (array['draft','internal_review','client_review']) then
    raise exception 'new deliverables must start in draft/internal_review/client_review';
  end if;
  if p_type <> all (array['video','photo','other']) then
    raise exception 'invalid type: %', p_type;
  end if;
  if not exists (select 1 from public.projects where id = p_project and is_deleted = false) then
    raise exception 'project not found or deleted';
  end if;
  insert into public.deliverables (project_id, title, type, preview_url, vimeo_review_url, status)
  values (p_project, p_title, p_type, p_preview_url, p_vimeo_url, p_status)
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_add_deliverable(uuid,text,text,text,text,text) from public, anon;
grant  execute on function public.admin_add_deliverable(uuid,text,text,text,text,text) to authenticated;

-- ─── B3. Update deliverable (final-delivery gate stays trigger-enforced) ─────
create or replace function public.admin_set_deliverable(
  p_dlv uuid, p_status text default null, p_allow_download boolean default null,
  p_preview_url text default null, p_vimeo_url text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status is not null and p_status <> all (array[
     'draft','internal_review','client_review','revision_requested',
     'approved','final_delivered','archived']) then
    raise exception 'invalid deliverable status: %', p_status;
  end if;
  update public.deliverables
     set status           = coalesce(p_status, status),
         allow_download   = coalesce(p_allow_download, allow_download),
         preview_url      = coalesce(p_preview_url, preview_url),
         vimeo_review_url = coalesce(p_vimeo_url, vimeo_review_url)
   where id = p_dlv and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_deliverable(uuid,text,boolean,text,text) from public, anon;
grant  execute on function public.admin_set_deliverable(uuid,text,boolean,text,text) to authenticated;

-- ─── B4. Attach final-download asset ─────────────────────────────────────────
create or replace function public.admin_add_final_asset(p_dlv uuid, p_url text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.deliverables where id = p_dlv and is_deleted = false) then
    raise exception 'deliverable not found or deleted';
  end if;
  insert into public.deliverable_assets (deliverable_id, kind, url)
  values (p_dlv, 'final', p_url) returning id into v_id;
  perform public.log_activity(auth.uid(), 'admin', 'deliverable.asset_added',
                              'deliverable', p_dlv, jsonb_build_object('asset', v_id));
  return v_id;
end; $$;
revoke execute on function public.admin_add_final_asset(uuid,text) from public, anon;
grant  execute on function public.admin_add_final_asset(uuid,text) to authenticated;

-- ─── B5. Manual client notification (signature: uuid,text,text,uuid,text,text)
create or replace function public.admin_notify(
  p_user uuid, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'recipient profile not found';
  end if;
  perform public.notify(p_user, 'user', p_type, p_etype, p_eid, p_ar, p_en);
  perform public.log_activity(auth.uid(), 'admin', 'admin.notification_sent',
                              'profile', p_user, jsonb_build_object('type', p_type));
end; $$;
revoke execute on function public.admin_notify(uuid,text,text,uuid,text,text) from public, anon;
grant  execute on function public.admin_notify(uuid,text,text,uuid,text,text) to authenticated;

-- ─── B6. Account lifecycle (admin restricted to the two approved emails) ─────
create or replace function public.admin_set_account(
  p_user uuid, p_type text default null, p_status text default null,
  p_level text default null, p_company uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_type is not null and p_type <> all (array['lead','client','admin']) then
    raise exception 'invalid account_type: %', p_type;
  end if;
  if p_status is not null and p_status <> all (array['active','inactive','blocked']) then
    raise exception 'invalid account_status: %', p_status;
  end if;
  if p_level is not null and p_level <> all (array['prospect','active','vip']) then
    raise exception 'invalid client_level: %', p_level;
  end if;
  if p_type = 'admin' and not exists (
       select 1 from public.profiles
       where id = p_user
         and lower(email) in ('kianalebtikar@gmail.com','manager@kianmedia.com')) then
    raise exception 'admin role is restricted to the two approved emails (see PORTAL_ROADMAP §1)';
  end if;
  if p_company is not null and not exists (
       select 1 from public.companies where id = p_company and is_deleted = false) then
    raise exception 'company not found or deleted';
  end if;
  update public.profiles
     set account_type   = coalesce(p_type,   account_type),
         account_status = coalesce(p_status, account_status),
         client_level   = coalesce(p_level,  client_level),
         company_id     = coalesce(p_company, company_id)
   where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_account(uuid,text,text,text,uuid) from public, anon;
grant  execute on function public.admin_set_account(uuid,text,text,text,uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-V — VERIFICATION SUITE (run after the addendum)
-- ✅ Executed 2026-06-12: 10 rows, 0 FAIL
-- ═══════════════════════════════════════════════════════════════════════════
/*
create temp table _s1(chk text, result text);

insert into _s1 select '1.1 notify revoked (authenticated)',
 case when has_function_privilege('authenticated','public.notify(uuid,text,text,text,uuid,text,text)','execute')
 then 'FAIL' else 'PASS' end;
insert into _s1 select '1.2 notify revoked (anon)',
 case when has_function_privilege('anon','public.notify(uuid,text,text,text,uuid,text,text)','execute')
 then 'FAIL' else 'PASS' end;
insert into _s1 select '1.3 log_activity revoked (authenticated)',
 case when has_function_privilege('authenticated','public.log_activity(uuid,text,text,text,uuid,jsonb)','execute')
 then 'FAIL' else 'PASS' end;

insert into _s1 select '2.1 owner keeps notify',
 case when has_function_privilege('postgres','public.notify(uuid,text,text,text,uuid,text,text)','execute')
 then 'PASS' else 'FAIL' end;
insert into _s1 select '2.2 service_role keeps log_activity',
 case when has_function_privilege('service_role','public.log_activity(uuid,text,text,text,uuid,jsonb)','execute')
 then 'PASS' else 'FAIL' end;
insert into _s1 select '2.3 is_admin still callable by authenticated (policies need it)',
 case when has_function_privilege('authenticated','public.is_admin()','execute')
 then 'PASS' else 'FAIL' end;

insert into _s1 select '3.1 six admin RPCs exist',
 case when count(*)=6 then 'PASS' else 'FAIL: '||count(*) end
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('admin_set_project_status','admin_add_deliverable','admin_set_deliverable',
  'admin_add_final_asset','admin_notify','admin_set_account');
insert into _s1 select '3.2 RPCs granted to authenticated',
 case when bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
 then 'PASS' else 'FAIL' end
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'admin\_%';

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}',false);
set role authenticated;
do $$ begin begin
  perform public.admin_set_project_status('00000000-0000-4000-8000-00000000dead','editing');
  insert into _s1 values ('4.1 non-admin blocked from RPC','FAIL: executed');
exception when others then
  insert into _s1 values ('4.1 non-admin blocked from RPC','PASS: '||sqlerrm); end; end $$;
do $$ begin begin
  perform public.notify('00000000-0000-4000-8000-00000000dead'::uuid,'user','message_new',null,null,'x','x');
  insert into _s1 values ('4.2 direct notify() blocked','FAIL: executed');
exception when insufficient_privilege then
  insert into _s1 values ('4.2 direct notify() blocked','PASS: permission denied'); end; end $$;
reset role;

select * from _s1 order by chk;
*/
