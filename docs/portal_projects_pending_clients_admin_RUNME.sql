-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Projects: pending (no-email) clients + admin management
-- RUN ONCE in Supabase SQL editor. Safe to rerun (idempotent).
--
-- Business change: an admin must be able to create/manage a project even when the
-- client has NO portal account and NO email yet. Model (uses the EXISTING
-- visibility logic — no RLS change):
--   • A "pending" client = a public.clients row with user_id = NULL (admin sees it
--     via is_admin(); no client sees it because my_client_id() never resolves it).
--   • projects.client_id stays NOT NULL → every project still has a real client_id.
--   • When the real client signs up/logs in with the same email,
--     sync_projects_for_current_user() sets that clients row's user_id → the project
--     appears automatically (can_access_project: p.client_id = my_client_id()).
--
-- Does NOT weaken RLS, does NOT make projects.client_id nullable, does NOT touch
-- notification/WhatsApp/Zoho/delivery objects. All SECURITY DEFINER fns set
-- search_path = public and are gated by is_admin() (or auth.uid() for the self-sync).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1) Allow pending clients: clients.user_id may be NULL (no-account client record).
--    No-op if already nullable. my_client_id()/link RPCs use inner joins, so NULL
--    user_id rows are simply invisible to clients until linked — exactly "pending".
alter table public.clients alter column user_id drop not null;

-- 2) Create a project for a client — email/account OPTIONAL. Replaces the prior
--    signature (which required a resolvable account). Returns project_id, client_id
--    and a 'linked' state: 'account' | 'email_pending' | 'unlinked'.
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
  p_user           uuid default null   -- optional explicit manual link to a profile
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_client uuid; v_proj uuid; v_email text; v_linked text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'project title required'; end if;
  if coalesce(nullif(trim(p_status),''),'request_received') <> all (array[
       'request_received','pre_production','shooting_scheduled',
       'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  v_email := lower(trim(coalesce(p_client_email,'')));
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  -- Resolve the target account (explicit manual link wins, else email match).
  if p_user is not null then
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
    v_uid := p_user;
  elsif v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email order by created_at limit 1; -- may stay null (pending)
  end if;

  -- Resolve / create the clients row.
  if v_uid is not null then
    select id into v_client from public.clients where user_id = v_uid and is_deleted = false order by created_at limit 1;
    if v_client is null then
      insert into public.clients (user_id, full_name, company, mobile, email)
      values (v_uid, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
              nullif(trim(coalesce(p_client_phone,'')),''), nullif(v_email,''))
      returning id into v_client;
    end if;
    v_linked := 'account';
  else
    -- Pending client (no account). Reuse a pending row with the same email if present.
    if v_email <> '' then
      select id into v_client from public.clients
       where user_id is null and is_deleted = false and lower(coalesce(email,'')) = v_email
       order by created_at limit 1;
    end if;
    if v_client is null then
      insert into public.clients (user_id, full_name, company, mobile, email)
      values (null, nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_client_company,'')),''),
              nullif(trim(coalesce(p_client_phone,'')),''), nullif(v_email,''))
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
    insert into public.project_members (project_id, user_id, role, added_by)
    values (v_proj, v_uid, 'client_owner', auth.uid());
  end if;

  return jsonb_build_object('project_id', v_proj, 'client_id', v_client, 'linked', v_linked);
end; $$;
revoke execute on function public.admin_create_project_for_client(text,text,text,text,text,text,date,text,uuid) from public, anon;
grant  execute on function public.admin_create_project_for_client(text,text,text,text,text,text,date,text,uuid) to authenticated;

-- 3) Edit a project + its client contact. Adding an email later links the project
--    to a matching account automatically (or keeps it pending until signup).
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
declare v_client uuid; v_email text; v_profile uuid; v_cur_uid uuid; v_linked text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.projects where id = p_project and is_deleted = false) then
    raise exception 'project not found';
  end if;
  if p_status is not null and trim(p_status) <> '' and trim(p_status) <> all (array[
       'request_received','pre_production','shooting_scheduled',
       'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  v_email := lower(trim(coalesce(p_client_email,'')));
  if v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  update public.projects set
    project_name  = coalesce(nullif(trim(coalesce(p_title,'')),''), project_name),
    status        = coalesce(nullif(trim(coalesce(p_status,'')),''), status),
    shooting_date = p_shooting,
    notes         = nullif(trim(coalesce(p_notes,'')),'')
  where id = p_project
  returning client_id into v_client;

  -- Update the linked client contact (shared row for registered clients).
  if v_client is not null then
    update public.clients set
      full_name = coalesce(nullif(trim(coalesce(p_client_name,'')),''), full_name),
      company   = coalesce(nullif(trim(coalesce(p_client_company,'')),''), company),
      mobile    = coalesce(nullif(trim(coalesce(p_client_phone,'')),''), mobile),
      email     = case when v_email <> '' then v_email else email end
    where id = v_client
    returning user_id into v_cur_uid;

    if v_email <> '' then
      select id into v_profile from public.profiles where lower(email) = v_email order by created_at limit 1;
      if v_profile is not null then
        if v_cur_uid is null then
          update public.clients set user_id = v_profile where id = v_client; -- link pending → account
        end if;
        insert into public.project_members (project_id, user_id, role, added_by)
        select pr.id, v_profile, 'client_owner', auth.uid()
        from public.projects pr
        where pr.client_id = v_client and pr.is_deleted = false
          and not exists (select 1 from public.project_members m where m.project_id = pr.id and m.user_id = v_profile and m.is_deleted = false);
        v_linked := 'account';
      else
        v_linked := 'email_pending';
      end if;
    else
      v_linked := case when v_cur_uid is not null then 'account' else 'unlinked' end;
    end if;
  end if;

  return jsonb_build_object('project_id', p_project, 'client_id', v_client, 'linked', coalesce(v_linked,'unlinked'));
end; $$;
revoke execute on function public.admin_update_project(uuid,text,text,date,text,text,text,text,text) from public, anon;
grant  execute on function public.admin_update_project(uuid,text,text,date,text,text,text,text,text) to authenticated;

-- 4) Manual link / reassign a project to an existing portal account.
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
    insert into public.clients (user_id, full_name, company, mobile, email)
    values (p_user, v_name, v_comp, v_mobile, lower(nullif(trim(coalesce(v_email,'')),'')))
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

-- 5) On login/signup: attach pending clients (and their projects) by VERIFIED email.
--    Called best-effort from the portal bootstrap. Only matches the caller's own
--    verified profile email — cannot claim anyone else's records.
create or replace function public.sync_projects_for_current_user()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_clients int := 0; v_members int := 0; v_c uuid; v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_email := lower(trim(coalesce((select email from public.profiles where id = v_uid), '')));
  if v_email = '' then return jsonb_build_object('linked_clients', 0, 'linked_members', 0); end if;

  update public.clients set user_id = v_uid
   where user_id is null and is_deleted = false and lower(coalesce(email,'')) = v_email;
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

-- Reload PostgREST so the new/changed RPC signatures are exposed immediately.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   -- create a no-email project (admin session):
--   select public.admin_create_project_for_client('مشروع بدون بريد', 'خالد', 'شركة كيان', null, '0555000000');
--      -- → { project_id, client_id, linked: 'unlinked' }
--   -- create with email of an unregistered person:
--   select public.admin_create_project_for_client('مشروع ببريد', null, null, 'New.Lead@example.com');
--      -- → linked: 'email_pending'
--   -- add an email later:
--   select public.admin_update_project('<project_id>', null, null, null, null, null, null, 'client@example.com');
--   -- as the client (their JWT), after signup with the same email:
--   select public.sync_projects_for_current_user();   -- → linked_clients/linked_members > 0
--   select id, project_name, client_id from public.projects order by created_at desc limit 5; -- client_id NOT NULL
--   select id, name, public from storage.buckets where id = 'deliverable-previews'; -- (Part C, separate file)
-- ROLLBACK (best-effort):
--   drop function if exists public.sync_projects_for_current_user();
--   drop function if exists public.admin_link_project_to_user(uuid,uuid);
--   drop function if exists public.admin_update_project(uuid,text,text,date,text,text,text,text,text);
--   drop function if exists public.admin_create_project_for_client(text,text,text,text,text,text,date,text,uuid);
--   -- (clients.user_id NOT NULL is intentionally NOT restored — pending clients may exist.)
-- ════════════════════════════════════════════════════════════════════════
