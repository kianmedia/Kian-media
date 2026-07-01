-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Media: watermarked previews (image + audio) + final delivery
-- RUN ONCE in Supabase SQL editor. Safe to rerun (idempotent).
-- EXTENDS docs/portal_quote_project_preview_fixes_RUNME.sql (Part C — the
-- deliverable_preview_assets table + list/stream RPCs + 'deliverable-previews'
-- bucket must already exist). Adds: direct-upload/needs_worker support, an
-- originals bucket, and a separate final-delivery model.
--
-- Security: originals/finals/source ids/storage paths are ADMIN-ONLY. Clients read
-- only safe metadata via SECURITY DEFINER RPCs and stream bytes through
-- authenticated routes that verify project membership. No public buckets. No RLS
-- weakened. Does NOT touch notification/WhatsApp/Zoho/delivery objects.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) Extend preview assets: originals path + 'needs_worker' status ─────────
alter table public.deliverable_preview_assets add column if not exists original_storage_path text; -- admin-only
alter table public.deliverable_preview_assets drop constraint if exists deliverable_preview_assets_status_check;
alter table public.deliverable_preview_assets drop constraint if exists dpa_status_ck;
alter table public.deliverable_preview_assets
  add constraint dpa_status_ck check (status in ('processing','ready','failed','needs_worker'));

-- Re-create the admin write RPC to also persist original_storage_path (source_provider
-- accepts 'google_drive' | 'direct_upload' | 'internal' — no CHECK, so additive).
create or replace function public.admin_save_preview_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(p->>'project_id','') is null then raise exception 'project_id required'; end if;
  if (p->>'asset_type') not in ('image','audio') then raise exception 'invalid asset_type'; end if;
  insert into public.deliverable_preview_assets
    (deliverable_id, review_id, project_id, asset_type, source_provider, source_file_id, source_folder_id,
     original_file_name, original_storage_path, preview_storage_path, preview_mime_type,
     watermark_applied, status, error_message, created_by)
  values (
    nullif(p->>'deliverable_id','')::uuid, nullif(p->>'review_id','')::uuid, (p->>'project_id')::uuid,
    p->>'asset_type', coalesce(nullif(p->>'source_provider',''),'google_drive'),
    nullif(p->>'source_file_id',''), nullif(p->>'source_folder_id',''), nullif(p->>'original_file_name',''),
    nullif(p->>'original_storage_path',''), coalesce(p->>'preview_storage_path',''), nullif(p->>'preview_mime_type',''),
    coalesce((p->>'watermark_applied')::boolean, true),
    coalesce(nullif(p->>'status',''),'processing'), nullif(p->>'error_message',''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_save_preview_asset(jsonb) from public, anon;
grant  execute on function public.admin_save_preview_asset(jsonb) to authenticated;

-- Admin delete of a preview asset (row only; storage cleanup is best-effort in-app).
create or replace function public.admin_delete_preview_asset(p_asset uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.deliverable_preview_assets where id = p_asset;
  return found;
end; $$;
revoke execute on function public.admin_delete_preview_asset(uuid) from public, anon;
grant  execute on function public.admin_delete_preview_asset(uuid) to authenticated;

-- Admin list of preview assets for a project (ALL statuses, incl. source ids — admin only).
create or replace function public.admin_list_preview_assets(p_project uuid)
returns setof public.deliverable_preview_assets
language sql stable security definer set search_path = public as $$
  select * from public.deliverable_preview_assets
   where public.is_admin() and project_id = p_project
   order by created_at desc;
$$;
revoke execute on function public.admin_list_preview_assets(uuid) from public, anon;
grant  execute on function public.admin_list_preview_assets(uuid) to authenticated;

-- ── 2) FINAL delivery assets (clean, no watermark) ───────────────────────────
create table if not exists public.deliverable_final_assets (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  deliverable_id       uuid references public.deliverables(id) on delete set null,
  asset_type           text not null check (asset_type in ('audio','image','video','file')),
  final_storage_path   text not null,                 -- ADMIN-ONLY (private bucket)
  original_file_name   text,
  mime_type            text,
  is_available_to_client boolean not null default false,
  delivered_at         timestamptz,
  delivered_by         uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_dfa_project on public.deliverable_final_assets(project_id);

alter table public.deliverable_final_assets enable row level security;
-- Admin only on the base table (holds the private storage path). Clients read via RPC.
drop policy if exists dfa_admin_all on public.deliverable_final_assets;
create policy dfa_admin_all on public.deliverable_final_assets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.deliverable_final_assets to authenticated;

-- Admin: record an uploaded final asset.
create or replace function public.admin_save_final_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nullif(p->>'project_id','') is null then raise exception 'project_id required'; end if;
  if (p->>'asset_type') not in ('audio','image','video','file') then raise exception 'invalid asset_type'; end if;
  if nullif(p->>'final_storage_path','') is null then raise exception 'final_storage_path required'; end if;
  insert into public.deliverable_final_assets
    (project_id, deliverable_id, asset_type, final_storage_path, original_file_name, mime_type, created_by)
  values ((p->>'project_id')::uuid, nullif(p->>'deliverable_id','')::uuid, p->>'asset_type',
          p->>'final_storage_path', nullif(p->>'original_file_name',''), nullif(p->>'mime_type',''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_save_final_asset(jsonb) from public, anon;
grant  execute on function public.admin_save_final_asset(jsonb) to authenticated;

-- Admin: make a final asset available to the client (or revoke).
create or replace function public.admin_set_final_availability(p_asset uuid, p_available boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.deliverable_final_assets
     set is_available_to_client = coalesce(p_available,false),
         delivered_at = case when coalesce(p_available,false) then now() else delivered_at end,
         delivered_by = case when coalesce(p_available,false) then auth.uid() else delivered_by end,
         updated_at = now()
   where id = p_asset;
  return found;
end; $$;
revoke execute on function public.admin_set_final_availability(uuid,boolean) from public, anon;
grant  execute on function public.admin_set_final_availability(uuid,boolean) to authenticated;

create or replace function public.admin_delete_final_asset(p_asset uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.deliverable_final_assets where id = p_asset;
  return found;
end; $$;
revoke execute on function public.admin_delete_final_asset(uuid) from public, anon;
grant  execute on function public.admin_delete_final_asset(uuid) to authenticated;

-- Admin: all final assets for a project (incl. path — admin only).
create or replace function public.admin_list_final_assets(p_project uuid)
returns setof public.deliverable_final_assets
language sql stable security definer set search_path = public as $$
  select * from public.deliverable_final_assets
   where public.is_admin() and project_id = p_project
   order by created_at desc;
$$;
revoke execute on function public.admin_list_final_assets(uuid) from public, anon;
grant  execute on function public.admin_list_final_assets(uuid) to authenticated;

-- CLIENT-FACING: available finals only, SAFE metadata (no storage path).
create or replace function public.list_project_final_assets(p_project uuid)
returns table (id uuid, deliverable_id uuid, asset_type text, original_file_name text,
               mime_type text, delivered_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.deliverable_id, a.asset_type, a.original_file_name, a.mime_type, a.delivered_at
  from public.deliverable_final_assets a
  where a.is_available_to_client = true
    and (public.is_admin() or public.is_project_member(a.project_id))
    and a.project_id = p_project
  order by a.delivered_at desc nulls last, a.created_at desc;
$$;
revoke execute on function public.list_project_final_assets(uuid) from public, anon;
grant  execute on function public.list_project_final_assets(uuid) to authenticated;

-- STREAM AUTH (server-only): returns the final storage path ONLY to an admin or a
-- project member, and ONLY when the asset is available to the client.
create or replace function public.get_final_asset_for_stream(p_asset uuid)
returns table (final_storage_path text, mime_type text, original_file_name text, asset_type text)
language sql stable security definer set search_path = public as $$
  select a.final_storage_path, a.mime_type, a.original_file_name, a.asset_type
  from public.deliverable_final_assets a
  where a.id = p_asset
    and (public.is_admin() or (a.is_available_to_client = true and public.is_project_member(a.project_id)));
$$;
revoke execute on function public.get_final_asset_for_stream(uuid) from public, anon;
grant  execute on function public.get_final_asset_for_stream(uuid) to authenticated;

-- ── 3) Private storage buckets (NOT public) ──────────────────────────────────
insert into storage.buckets (id, name, public) values ('deliverable-originals','deliverable-originals', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('deliverable-finals','deliverable-finals', false)       on conflict (id) do nothing;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   select id, name, public from storage.buckets where id in ('deliverable-previews','deliverable-originals','deliverable-finals'); -- all public=false
--   select conname from pg_constraint where conrelid = 'public.deliverable_preview_assets'::regclass and contype='c'; -- includes dpa_status_ck
--   -- as a CLIENT (their JWT): select * from public.list_project_final_assets('<project_id>'); -- available finals only, no path
--   select id, asset_type, status from public.deliverable_preview_assets order by created_at desc limit 5;
-- ════════════════════════════════════════════════════════════════════════
