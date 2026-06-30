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


-- ════════════════════════════════════════════════════════════════════════
-- PART C — Secure watermarked Drive previews (originals NEVER exposed to clients)
-- ════════════════════════════════════════════════════════════════════════
-- Only generated, watermarked preview assets are stored (private bucket) and shown
-- to clients through an authenticated server route. The Google Drive source ids/urls
-- are ADMIN-ONLY: they live on this table but are returned ONLY by the admin-gated
-- RLS, never by the client-facing RPCs below.
create table if not exists public.deliverable_preview_assets (
  id                  uuid primary key default gen_random_uuid(),
  deliverable_id      uuid references public.deliverables(id) on delete cascade,
  review_id           uuid,                              -- optional (review-record schemas)
  project_id          uuid not null references public.projects(id) on delete cascade,
  asset_type          text not null check (asset_type in ('image','audio')),
  source_provider     text not null default 'google_drive',
  source_file_id      text,                              -- ADMIN-ONLY (never in client RPC)
  source_folder_id    text,                              -- ADMIN-ONLY
  original_file_name  text,
  preview_storage_path text not null default '',         -- path in the private bucket ('' until ready)
  preview_mime_type   text,
  watermark_applied   boolean not null default true,
  status              text not null default 'processing' check (status in ('processing','ready','failed')),
  error_message       text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_dpa_project     on public.deliverable_preview_assets(project_id);
create index if not exists idx_dpa_deliverable on public.deliverable_preview_assets(deliverable_id);
create index if not exists idx_dpa_status      on public.deliverable_preview_assets(status);

alter table public.deliverable_preview_assets enable row level security;

-- Admin/manager only on the BASE table (full columns incl. source ids). Clients have
-- NO base-table policy → they can never read source_file_id/source_folder_id. They
-- read safe metadata through list_project_preview_assets() instead.
drop policy if exists dpa_admin_all on public.deliverable_preview_assets;
create policy dpa_admin_all on public.deliverable_preview_assets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.deliverable_preview_assets to authenticated;

-- Membership predicate: project_members link OR the legacy clients link.
create or replace function public.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = auth.uid() and m.is_deleted = false)
      or exists (select 1 from public.projects pr
                  where pr.id = p_project and pr.client_id = public.my_client_id());
$$;
revoke execute on function public.is_project_member(uuid) from public, anon;
grant  execute on function public.is_project_member(uuid) to authenticated;

-- CLIENT-FACING: list safe preview metadata for a project the caller belongs to.
-- Returns NO source ids/urls and NO storage path — only ids + display metadata.
create or replace function public.list_project_preview_assets(p_project uuid)
returns table (id uuid, deliverable_id uuid, asset_type text, original_file_name text,
               preview_mime_type text, status text, watermark_applied boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.deliverable_id, a.asset_type, a.original_file_name,
         a.preview_mime_type, a.status, a.watermark_applied, a.created_at
  from public.deliverable_preview_assets a
  where a.status = 'ready'
    and (public.is_admin() or public.is_project_member(a.project_id))
    and a.project_id = p_project
  order by a.created_at;
$$;
revoke execute on function public.list_project_preview_assets(uuid) from public, anon;
grant  execute on function public.list_project_preview_assets(uuid) to authenticated;

-- STREAM AUTH (server-only use): returns the storage path + mime for ONE asset, but
-- ONLY if the caller is admin or a member of the asset's project and it is 'ready'.
-- The authenticated stream route calls this AS THE USER, then streams the bytes via
-- the service role. The path/source never reaches the browser.
create or replace function public.get_preview_asset_for_stream(p_asset uuid)
returns table (preview_storage_path text, preview_mime_type text, asset_type text)
language sql stable security definer set search_path = public as $$
  select a.preview_storage_path, a.preview_mime_type, a.asset_type
  from public.deliverable_preview_assets a
  where a.id = p_asset and a.status = 'ready'
    and (public.is_admin() or public.is_project_member(a.project_id));
$$;
revoke execute on function public.get_preview_asset_for_stream(uuid) from public, anon;
grant  execute on function public.get_preview_asset_for_stream(uuid) to authenticated;

-- ADMIN write RPC (is_admin gated) — the import route calls this AS THE ADMIN to
-- record a generated preview asset. Source ids are stored (admin-only columns).
create or replace function public.admin_save_preview_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(p->>'project_id','') is null then raise exception 'project_id required'; end if;
  if (p->>'asset_type') not in ('image','audio') then raise exception 'invalid asset_type'; end if;
  insert into public.deliverable_preview_assets
    (deliverable_id, review_id, project_id, asset_type, source_provider, source_file_id, source_folder_id,
     original_file_name, preview_storage_path, preview_mime_type, watermark_applied, status, error_message, created_by)
  values (
    nullif(p->>'deliverable_id','')::uuid, nullif(p->>'review_id','')::uuid, (p->>'project_id')::uuid,
    p->>'asset_type', coalesce(nullif(p->>'source_provider',''),'google_drive'),
    nullif(p->>'source_file_id',''), nullif(p->>'source_folder_id',''), nullif(p->>'original_file_name',''),
    coalesce(p->>'preview_storage_path',''), nullif(p->>'preview_mime_type',''),
    coalesce((p->>'watermark_applied')::boolean, true),
    coalesce(nullif(p->>'status',''),'processing'), nullif(p->>'error_message',''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_save_preview_asset(jsonb) from public, anon;
grant  execute on function public.admin_save_preview_asset(jsonb) to authenticated;

-- Private storage bucket for generated previews (NOT public). All access is via the
-- service role in the server routes; clients never touch storage directly.
insert into storage.buckets (id, name, public)
values ('deliverable-previews', 'deliverable-previews', false)
on conflict (id) do nothing;

-- Validation (Part C):
--   select id, asset_type, status, watermark_applied from public.deliverable_preview_assets order by created_at desc limit 5;
--   -- As a CLIENT (their JWT): select * from public.list_project_preview_assets('<project_id>');  -- safe cols only, no source ids
--   select id, name, public from storage.buckets where id = 'deliverable-previews';  -- public must be false
