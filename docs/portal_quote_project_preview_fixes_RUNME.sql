-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — urgent fixes + secure previews (RUN ONCE in Supabase SQL editor)
--
-- Part B: admin_create_project_for_client — resolves a real, non-null clients.id
--         from the selected account (profiles.id or email), creating the legacy
--         clients row if missing, then inserts the project + canonical membership.
-- Part C: deliverable_preview_assets table + RLS + client-safe read RPC for the
--         watermarked Drive previews (originals never exposed to clients).
--
-- Safe to rerun (idempotent: create-or-replace, add-column-if-not-exists,
-- drop-policy-if-exists). SECURITY DEFINER fns all set search_path = public and
-- are gated by existing permission helpers. Does NOT weaken existing RLS and does
-- NOT touch notification/WhatsApp/Zoho/delivery objects.
-- ════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- PART B — Project creation resolves a valid client_id (no more NOT-NULL crash)
-- ════════════════════════════════════════════════════════════════════════
-- Root cause: the create-project modal inserted a project without a client_id, but
-- legacy projects.client_id is NOT NULL → "null value in column client_id". This
-- RPC resolves the account to a real clients.id (legacy clients table links a
-- profile via clients.user_id), creating that clients row if it doesn't exist yet,
-- so the project always gets a valid non-null client_id. is_admin()-gated.
create or replace function public.admin_create_project_for_client(
  p_title    text,
  p_user     uuid default null,   -- profiles.id of the client account (preferred)
  p_email    text default null,   -- fallback: resolve the profile by email
  p_company  uuid default null,   -- companies.id (optional)
  p_status   text default 'request_received',
  p_notes    text default null,
  p_shooting date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_client uuid; v_proj uuid;
        v_email text; v_name text; v_comp text; v_mobile text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_title),'') = '' then raise exception 'project title required'; end if;
  if p_status <> all (array['request_received','pre_production','shooting_scheduled',
                            'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;

  -- 1) Resolve the account (profile) from user id, else from email.
  if p_user is not null then
    select id, email, full_name, company, mobile
      into v_uid, v_email, v_name, v_comp, v_mobile
      from public.profiles where id = p_user;
  elsif coalesce(trim(p_email),'') <> '' then
    select id, email, full_name, company, mobile
      into v_uid, v_email, v_name, v_comp, v_mobile
      from public.profiles where lower(email) = lower(trim(p_email))
      order by created_at limit 1;
  end if;
  if v_uid is null then
    -- No portal account for this email → caller shows the friendly Arabic message.
    raise exception 'client_not_linked';
  end if;

  -- 2) Find the legacy clients row for this account, or create it (links the project).
  select id into v_client
    from public.clients where user_id = v_uid and is_deleted = false
    order by created_at limit 1;
  if v_client is null then
    insert into public.clients (user_id, full_name, company, mobile, email)
    values (v_uid, v_name, v_comp, v_mobile, v_email)
    returning id into v_client;
  end if;

  if p_company is not null and not exists (
        select 1 from public.companies where id = p_company and is_deleted = false) then
    raise exception 'company not found or deleted';
  end if;

  -- 3) Insert the project with a guaranteed non-null client_id.
  insert into public.projects (project_name, status, client_id, company_id, notes, shooting_date)
  values (trim(p_title), p_status, v_client, p_company,
          nullif(trim(coalesce(p_notes,'')),''), p_shooting)
  returning id into v_proj;

  -- 4) Canonical membership link (idempotent — skip if already a member).
  if not exists (select 1 from public.project_members
                  where project_id = v_proj and user_id = v_uid and is_deleted = false) then
    insert into public.project_members (project_id, user_id, role, added_by)
    values (v_proj, v_uid, 'client_owner', auth.uid());
  end if;

  return v_proj;
end; $$;
revoke execute on function public.admin_create_project_for_client(text,uuid,text,uuid,text,text,date) from public, anon;
grant  execute on function public.admin_create_project_for_client(text,uuid,text,uuid,text,text,date) to authenticated;

-- Validation (Part B):
--   select public.admin_create_project_for_client('Test project', '<profiles.id>', null);  -- returns a project uuid
--   select id, project_name, client_id from public.projects order by created_at desc limit 3;  -- client_id must be NOT NULL
