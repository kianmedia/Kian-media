-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Pending client projects: placeholder-email fix (RUN ONCE)
-- SUPERSEDES the project RPCs in docs/portal_projects_pending_clients_admin_RUNME.sql
-- (running THIS file alone is sufficient for the project-creation flow). Idempotent.
--
-- Live bug: creating a project without a client email failed with
--   "null value in column email of relation clients violates not-null constraint"
-- because clients.email is NOT NULL. Fix (least invasive; keeps clients.email NOT NULL
-- and projects.client_id NOT NULL):
--   • For a client with no real email, store an INTERNAL placeholder:
--       pending+<uuid>@pending.kian.local
--     and flag it with clients.email_is_placeholder = true.
--   • The placeholder is internal only — the UI shows "لم يتم إضافة بريد العميل" and
--     never renders it; badge = "غير مرتبط".
--   • Real profile emails can never equal a placeholder (reserved @pending.kian.local
--     domain), so a placeholder can never accidentally match a real user.
--   • Adding a real email later clears the placeholder flag and links a matching
--     account; sync_projects_for_current_user() ignores placeholder emails.
-- SECURITY DEFINER, set search_path = public, is_admin()-gated. No RLS weakened.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- Pending clients need a nullable user_id and a placeholder-email flag.
alter table public.clients alter column user_id drop not null;
alter table public.clients add column if not exists email_is_placeholder boolean not null default false;

-- Internal placeholder generator (reserved domain — never a real user).
create or replace function public.gen_pending_email() returns text
language sql volatile set search_path = public as $$
  select 'pending+' || replace(gen_random_uuid()::text, '-', '') || '@pending.kian.local';
$$;

-- ── Create a project — email/account OPTIONAL (placeholder used when absent) ──
drop function if exists public.admin_create_project_for_client(text,uuid,text,uuid,text,text,date);
create or replace function public.admin_create_project_for_client(
  p_title          text,
  p_client_name    text default null,
  p_client_company text default null,
  p_client_email   text default null,
  p_client_phone   text default null,
  p_status         text default 'request_received',
  p_shooting       date default null,
  p_notes          text default null,
  p_user           uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_client uuid; v_proj uuid; v_email text; v_prof_email text; v_linked text; v_ph boolean; v_client_email text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'project title required'; end if;
  if coalesce(nullif(trim(p_status),''),'request_received') <> all (array[
       'request_received','pre_production','shooting_scheduled',
       'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  v_email := lower(trim(coalesce(p_client_email,'')));
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;

  if p_user is not null then
    select email into v_prof_email from public.profiles where id = p_user;
    if v_prof_email is null then raise exception 'user not found'; end if;
    v_uid := p_user;
  elsif v_email <> '' then
    select id, email into v_uid, v_prof_email from public.profiles where lower(email) = v_email order by created_at limit 1;
  end if;

  if v_uid is not null then
    select id into v_client from public.clients where user_id = v_uid and is_deleted = false order by created_at limit 1;
    if v_client is null then
      v_client_email := lower(coalesce(nullif(v_email,''), nullif(trim(coalesce(v_prof_email,'')),''), public.gen_pending_email()));
      v_ph := v_client_email like '%@pending.kian.local';
      insert into public.clients (user_id, full_name, company, mobile, email, email_is_placeholder)
      values (v_uid, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
              nullif(trim(coalesce(p_client_phone,'')),''), v_client_email, v_ph)
      returning id into v_client;
    end if;
    v_linked := 'account';
  else
    if v_email <> '' then
      select id into v_client from public.clients
       where user_id is null and is_deleted = false and email_is_placeholder = false and lower(coalesce(email,'')) = v_email
       order by created_at limit 1;
    end if;
    if v_client is null then
      v_client_email := case when v_email <> '' then v_email else public.gen_pending_email() end;
      v_ph := (v_email = '');
      insert into public.clients (user_id, full_name, company, mobile, email, email_is_placeholder)
      values (null, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
              nullif(trim(coalesce(p_client_phone,'')),''), v_client_email, v_ph)
      returning id into v_client;
    end if;
    v_linked := case when v_email <> '' then 'email_pending' else 'unlinked' end;
  end if;

  insert into public.projects (project_name, status, client_id, notes, shooting_date)
  values (trim(p_title), coalesce(nullif(trim(p_status),''),'request_received'), v_client,
          nullif(trim(coalesce(p_notes,'')),''), p_shooting)
  returning id into v_proj;

  if v_uid is not null and not exists (
        select 1 from public.project_members where project_id = v_proj and user_id = v_uid and is_deleted = false) then
    insert into public.project_members (project_id, user_id, role, added_by) values (v_proj, v_uid, 'client_owner', auth.uid());
  end if;

  return jsonb_build_object('project_id', v_proj, 'client_id', v_client, 'linked', v_linked);
end; $$;
revoke execute on function public.admin_create_project_for_client(text,text,text,text,text,text,date,text,uuid) from public, anon;
grant  execute on function public.admin_create_project_for_client(text,text,text,text,text,text,date,text,uuid) to authenticated;

-- ── Edit a project + client contact; adding a real email links/reassigns safely ──
create or replace function public.admin_update_project(
  p_project        uuid,
  p_title          text default null,
  p_status         text default null,
  p_shooting       date default null,
  p_notes          text default null,
  p_client_name    text default null,
  p_client_company text default null,
  p_client_email   text default null,
  p_client_phone   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_target uuid; v_email text; v_profile uuid; v_cur_uid uuid; v_cur_email text; v_cur_ph boolean; v_linked text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.projects where id = p_project and is_deleted = false) then raise exception 'project not found'; end if;
  if p_status is not null and trim(p_status) <> '' and trim(p_status) <> all (array[
       'request_received','pre_production','shooting_scheduled',
       'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  v_email := lower(trim(coalesce(p_client_email,'')));
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid_email'; end if;

  update public.projects set
    project_name  = coalesce(nullif(trim(coalesce(p_title,'')),''), project_name),
    status        = coalesce(nullif(trim(coalesce(p_status,'')),''), status),
    shooting_date = p_shooting,
    notes         = nullif(trim(coalesce(p_notes,'')),'')
  where id = p_project
  returning client_id into v_client;

  select user_id, lower(coalesce(email,'')), email_is_placeholder into v_cur_uid, v_cur_email, v_cur_ph
    from public.clients where id = v_client;

  v_target := v_client;
  if v_email <> '' then
    select id into v_profile from public.profiles where lower(email) = v_email order by created_at limit 1;
    if v_profile is not null then
      select id into v_target from public.clients where user_id = v_profile and is_deleted = false order by created_at limit 1;
      if v_target is null then
        insert into public.clients (user_id, full_name, company, mobile, email, email_is_placeholder)
        values (v_profile, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
                nullif(trim(coalesce(p_client_phone,'')),''), v_email, false)
        returning id into v_target;
      end if;
      v_linked := 'account';
    elsif v_cur_uid is null then
      v_target := v_client;                    -- pending client: set the real email in place
      v_linked := 'email_pending';
    else
      -- current client is registered; a different email reassigns to a new pending client
      insert into public.clients (user_id, full_name, company, mobile, email, email_is_placeholder)
      values (null, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
              nullif(trim(coalesce(p_client_phone,'')),''), v_email, false)
      returning id into v_target;
      v_linked := 'email_pending';
    end if;
  end if;

  -- Apply contact edits to the resolved target client.
  update public.clients set
    full_name = coalesce(nullif(trim(coalesce(p_client_name,'')),''), full_name),
    company   = coalesce(nullif(trim(coalesce(p_client_company,'')),''), company),
    mobile    = coalesce(nullif(trim(coalesce(p_client_phone,'')),''), mobile),
    email     = case when v_email <> '' then v_email else email end,
    email_is_placeholder = case when v_email <> '' then false else email_is_placeholder end
  where id = v_target;

  if v_target <> v_client then update public.projects set client_id = v_target where id = p_project; end if;

  if v_profile is not null and not exists (
        select 1 from public.project_members where project_id = p_project and user_id = v_profile and is_deleted = false) then
    insert into public.project_members (project_id, user_id, role, added_by) values (p_project, v_profile, 'client_owner', auth.uid());
  end if;

  if v_email = '' then
    v_linked := case when v_cur_uid is not null then 'account'
                     when (v_cur_email <> '' and not coalesce(v_cur_ph,false)) then 'email_pending'
                     else 'unlinked' end;
  end if;

  return jsonb_build_object('project_id', p_project, 'client_id', v_target, 'linked', coalesce(v_linked,'unlinked'));
end; $$;
revoke execute on function public.admin_update_project(uuid,text,text,date,text,text,text,text,text) from public, anon;
grant  execute on function public.admin_update_project(uuid,text,text,date,text,text,text,text,text) to authenticated;

-- ── Manual link / reassign to an existing account (unchanged behaviour) ──
create or replace function public.admin_link_project_to_user(p_project uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_name text; v_comp text; v_mobile text; v_email text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.projects where id = p_project and is_deleted = false) then raise exception 'project not found'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  select id into v_client from public.clients where user_id = p_user and is_deleted = false order by created_at limit 1;
  if v_client is null then
    select full_name, company, mobile, email into v_name, v_comp, v_mobile, v_email from public.profiles where id = p_user;
    insert into public.clients (user_id, full_name, company, mobile, email, email_is_placeholder)
    values (p_user, v_name, v_comp, v_mobile,
            lower(coalesce(nullif(trim(coalesce(v_email,'')),''), public.gen_pending_email())),
            (coalesce(nullif(trim(coalesce(v_email,'')),''), 'x') like '%@pending.kian.local' or v_email is null))
    returning id into v_client;
  end if;
  update public.projects set client_id = v_client where id = p_project;
  if not exists (select 1 from public.project_members where project_id = p_project and user_id = p_user and is_deleted = false) then
    insert into public.project_members (project_id, user_id, role, added_by) values (p_project, p_user, 'client_owner', auth.uid());
  end if;
  return jsonb_build_object('project_id', p_project, 'client_id', v_client, 'linked', 'account');
end; $$;
revoke execute on function public.admin_link_project_to_user(uuid,uuid) from public, anon;
grant  execute on function public.admin_link_project_to_user(uuid,uuid) to authenticated;

-- ── Self-link on login: match REAL (non-placeholder) verified email only ──
create or replace function public.sync_projects_for_current_user()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_clients int := 0; v_members int := 0; v_c uuid; v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_email := lower(trim(coalesce((select email from public.profiles where id = v_uid), '')));
  if v_email = '' or v_email like '%@pending.kian.local' then return jsonb_build_object('linked_clients', 0, 'linked_members', 0); end if;

  update public.clients set user_id = v_uid
   where user_id is null and is_deleted = false and email_is_placeholder = false and lower(coalesce(email,'')) = v_email;
  get diagnostics v_clients = row_count;

  for v_c in select id from public.clients where user_id = v_uid and is_deleted = false loop
    insert into public.project_members (project_id, user_id, role, added_by)
    select p.id, v_uid, 'client_owner', v_uid
    from public.projects p
    where p.client_id = v_c and p.is_deleted = false
      and not exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = v_uid and m.is_deleted = false);
    get diagnostics v_n = row_count; v_members := v_members + v_n;
  end loop;
  return jsonb_build_object('linked_clients', v_clients, 'linked_members', v_members);
end; $$;
revoke execute on function public.sync_projects_for_current_user() from public, anon;
grant  execute on function public.sync_projects_for_current_user() to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   select public.admin_create_project_for_client('مشروع بدون بريد','خالد','شركة كيان'); -- linked: 'unlinked'
--   select id, email, email_is_placeholder from public.clients order by created_at desc limit 3; -- placeholder row flagged true
--   select public.admin_update_project('<project_id>', null,null,null,null,null,null,'real@example.com'); -- linked email_pending/account
--   -- No real user ever has a @pending.kian.local email:
--   select count(*) from public.profiles where lower(email) like '%@pending.kian.local'; -- expect 0
-- ════════════════════════════════════════════════════════════════════════
