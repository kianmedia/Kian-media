-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — GRANULAR PERMISSION ENFORCEMENT (RUN ONCE)  [enforcement v2]
--
-- Wires module authorization to emp_has_permission(user,key). Canonical rule:
--   full-access roles (owner/admin/manager)  OR  (project member/authorized staff
--   AND emp_has_permission(auth.uid(), SPECIFIC_KEY))
-- Reads stay membership-based for basic visibility; MUTATIONS require the key.
-- Finance stays role-based (can_see_financials / pc_can_see_finance) and system_only
-- keys are never resolvable through professions (emp_has_permission returns false).
--
-- Migration compatibility (READ BEFORE APPLYING — this is an INTENTIONAL tightening):
--   • Owner / Admin / Manager are never denied by any gate below (short-circuit true).
--   • Professions that already carried perm_manage_preproduction / perm_manage_custody
--     keep working: the catalog backfill mapped those flags to preproduction.* and to
--     custody.* NORMAL keys, so pp_can()/custody_authz() still pass for them.
--   • BEHAVIOR CHANGE — pre-production is NARROWED. The OLD gate pp_can_manage(project)
--     was pure PROJECT MEMBERSHIP: ANY project member could create/edit/delete pre-
--     production. pp_can(project,key) now requires the SPECIFIC granular key. A project
--     member whose profession does NOT grant preproduction.create/edit/delete (and who
--     is not owner/admin/manager) LOSES pre-production mutation. This is the requested
--     enforcement (a Photographer must not get general Pre-Production admin unless
--     granted) — NOT a bug. ROLLOUT: before/with applying this, grant the needed
--     preproduction.* keys (Admin ▸ Professions ▸ ⚙ الصلاحيات, or the Project-Manager
--     template) to every profession that legitimately manages pre-production.
--   • SENSITIVE custody image delete/restore is newly split out behind its own key
--     (custody.delete_asset_images / restore) — excluded from the normal backfill, so a
--     Custody Manager can issue/return but CANNOT delete evidence unless explicitly
--     granted. Run AFTER permission_catalog_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then miss := miss || ' emp_has_permission (شغّل permission_catalog_RUNME.sql)'; end if;
  if to_regprocedure('public.is_owner()')            is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.project_role(uuid)')    is null then miss := miss || ' project_role(uuid)'; end if;
  if to_regprocedure('public.civ_can_admin()')       is null then miss := miss || ' civ_can_admin() (custody)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- ── §0 RETURN-TYPE COMPATIBILITY — diagnostic + guarded self-heal ────────────
-- PostgreSQL forbids CREATE OR REPLACE FUNCTION when the RETURN TYPE differs from an
-- existing same-signature function (SQLSTATE 42P13). This block runs BEFORE any of the
-- CREATE OR REPLACE statements below and:
--   (a) DIAGNOSTIC — RAISE NOTICE for every function this migration (re)creates,
--       reporting existing return type vs intended (and whether it's absent).
--   (b) SELF-HEAL — for a TRUE mismatch only, DROP that exact signature (never CASCADE)
--       so the CREATE below can recreate it. On a correctly-migrated DB every type
--       already matches → NOTHING is dropped, and rerunning is a no-op.
-- Intended return types (verified against each function's shipped definition):
--   pc_authz/custody_authz/pp_can = boolean (NEW here) · preproduction_upsert =
--   preproduction_items · preproduction_delete = boolean · preproduction_restore /
--   set_active / internal_approve = void · custody_inv_admin_archive/restore_asset_file
--   = boolean.  Only preproduction_delete ever differed (a prior draft used void).
do $rt$
declare
  sigs text[] := array[
    'public.pc_authz(uuid,text)',
    'public.custody_authz(text)',
    'public.pp_can(uuid,text)',
    'public.preproduction_upsert(uuid,jsonb)',
    'public.preproduction_delete(uuid,text)',
    'public.preproduction_restore(uuid)',
    'public.preproduction_set_active(uuid,boolean)',
    'public.preproduction_internal_approve(uuid)',
    'public.custody_inv_admin_archive_asset_file(uuid,text)',
    'public.custody_inv_admin_restore_asset_file(uuid)'
  ];
  wants text[] := array[
    'boolean','boolean','boolean','preproduction_items','boolean',
    'void','void','void','boolean','boolean'
  ];
  i int; oid_ regprocedure; cur text; want text;
begin
  for i in 1 .. array_length(sigs, 1) loop
    oid_ := to_regprocedure(sigs[i]);
    want := lower(wants[i]);
    if oid_ is null then
      raise notice 'ℹ %  → absent (will be created), intended=%', sigs[i], want;
    else
      cur := lower(regexp_replace(pg_get_function_result(oid_), '^public\.', ''));
      if cur = want then
        raise notice '✓ %  → return type OK (%)', sigs[i], cur;
      else
        raise notice '⚠ %  → INCOMPATIBLE return type existing=% intended=% → dropping (no CASCADE) to allow recreate', sigs[i], cur, want;
        execute format('drop function if exists %s', sigs[i]);
      end if;
    end if;
  end loop;
end $rt$;

-- ── Canonical authorization helpers ─────────────────────────────────────────
-- Project modules: full-access OR (member holding the granular permission).
create or replace function public.pc_authz(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.is_admin() or public.can_manage_projects()
      or (public.project_role(p_project) is not null and public.emp_has_permission(auth.uid(), p_key));
$$;
-- Custody (non-project): keeps the explicit access-role floor (manager/custody_officer)
-- for NORMAL actions, plus the granular permission path.
create or replace function public.custody_authz(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or public.staff_role() in ('manager','custody_officer')
      or public.emp_has_permission(auth.uid(), p_key);
$$;
do $g1$
begin
  execute 'revoke all on function public.pc_authz(uuid,text) from public, anon';
  execute 'grant execute on function public.pc_authz(uuid,text) to authenticated';
  execute 'revoke all on function public.custody_authz(text) from public, anon';
  execute 'grant execute on function public.custody_authz(text) to authenticated';
end $g1$;

-- ── PRE-PRODUCTION: per-action enforcement (keys are backfilled) ─────────────
-- pp_can(project,key): full-access OR (member AND permission). Replaces the blanket
-- pp_can_manage for the ACTION check, keeping pp_can_manage for membership reads.
create or replace function public.pp_can(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.can_manage_projects()
      or (public.project_role(p_project) is not null and public.emp_has_permission(auth.uid(), p_key));
$$;
revoke all on function public.pp_can(uuid,text) from public, anon;
grant execute on function public.pp_can(uuid,text) to authenticated;

-- upsert → preproduction.create (new) / preproduction.edit (existing)
create or replace function public.preproduction_upsert(p_project uuid, p_data jsonb)
returns public.preproduction_items language plpgsql security definer set search_path = public as $$
declare r public.preproduction_items; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if v_id is null then
    if not public.pp_can(p_project, 'preproduction.create') then raise exception 'not authorized'; end if;
  else
    if not public.pp_can(p_project, 'preproduction.edit') then raise exception 'not authorized'; end if;
  end if;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
  if v_id is null then
    insert into public.preproduction_items(project_id, section, title, body, detail, attachments, owner_id,
        profession, due_date, status, priority, client_visible, needs_approval, sort_order, created_by,
        contact_name, contact_mobile, needs_internal_approval, is_active, notes)
      values (p_project, p_data->>'section', btrim(p_data->>'title'), nullif(btrim(coalesce(p_data->>'body','')),''),
        coalesce(p_data->'detail','{}'::jsonb), coalesce(p_data->'attachments','[]'::jsonb),
        nullif(p_data->>'owner_id','')::uuid, nullif(btrim(coalesce(p_data->>'profession','')),''),
        nullif(p_data->>'due_date','')::date, coalesce(nullif(p_data->>'status',''),'todo'),
        coalesce(nullif(p_data->>'priority',''),'normal'), coalesce((p_data->>'client_visible')::boolean,false),
        coalesce((p_data->>'needs_approval')::boolean,false), coalesce(nullif(p_data->>'sort_order','')::int,0), auth.uid(),
        nullif(btrim(coalesce(p_data->>'contact_name','')),''), nullif(btrim(coalesce(p_data->>'contact_mobile','')),''),
        coalesce((p_data->>'needs_internal_approval')::boolean,false), coalesce((p_data->>'is_active')::boolean,true),
        nullif(btrim(coalesce(p_data->>'notes','')),''))
      returning * into r;
    perform public.log_activity(auth.uid(), 'admin', 'preproduction.created', 'project', p_project, jsonb_build_object('section', r.section, 'title', r.title));
  else
    update public.preproduction_items set
      title = btrim(p_data->>'title'),
      body = case when p_data ? 'body' then nullif(btrim(coalesce(p_data->>'body','')),'') else body end,
      detail = case when p_data ? 'detail' then coalesce(p_data->'detail','{}'::jsonb) else detail end,
      attachments = case when p_data ? 'attachments' then coalesce(p_data->'attachments','[]'::jsonb) else attachments end,
      owner_id = case when p_data ? 'owner_id' then nullif(p_data->>'owner_id','')::uuid else owner_id end,
      profession = case when p_data ? 'profession' then nullif(btrim(coalesce(p_data->>'profession','')),'') else profession end,
      due_date = case when p_data ? 'due_date' then nullif(p_data->>'due_date','')::date else due_date end,
      status = coalesce(nullif(p_data->>'status',''), status),
      priority = coalesce(nullif(p_data->>'priority',''), priority),
      client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      needs_approval = coalesce((p_data->>'needs_approval')::boolean, needs_approval),
      sort_order = coalesce(nullif(p_data->>'sort_order','')::int, sort_order),
      contact_name = case when p_data ? 'contact_name' then nullif(btrim(coalesce(p_data->>'contact_name','')),'') else contact_name end,
      contact_mobile = case when p_data ? 'contact_mobile' then nullif(btrim(coalesce(p_data->>'contact_mobile','')),'') else contact_mobile end,
      needs_internal_approval = coalesce((p_data->>'needs_internal_approval')::boolean, needs_internal_approval),
      is_active = coalesce((p_data->>'is_active')::boolean, is_active),
      notes = case when p_data ? 'notes' then nullif(btrim(coalesce(p_data->>'notes','')),'') else notes end,
      updated_at = now()
    where id = v_id and project_id = p_project and is_deleted = false
    returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.log_activity(auth.uid(), 'admin', 'preproduction.updated', 'project', p_project, jsonb_build_object('id', v_id, 'section', r.section));
  end if;
  return r;
end $$;

-- delete/restore → preproduction.delete · duplicate → create · set_active → edit
-- comment → comment · internal_approve → internal_approve
-- NOTE: returns BOOLEAN (not void) — the shipped preproduction_center_RUNME.sql
-- defined this as returns boolean, and the caller (lib/portal/preproduction.ts
-- deletePreproItem → prpc<boolean>) is typed on it. Keeping boolean means this is a
-- pure CREATE OR REPLACE with NO return-type change → no 42P13, no DROP on the normal
-- path. (An earlier draft used void, which caused the production 42P13; the §0 block
-- above self-heals any DB left in that void state.)
create or replace function public.preproduction_delete(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can(v_proj, 'preproduction.delete') then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;  -- restore shipped guard (was in preproduction_center); only the authz check is intentionally narrowed
  update public.preproduction_items set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = left(btrim(p_reason),500), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.deleted', 'project', v_proj, jsonb_build_object('id', p_id));
  return true;
end $$;

create or replace function public.preproduction_restore(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = true;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can(v_proj, 'preproduction.delete') then raise exception 'not authorized'; end if;
  update public.preproduction_items set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.restored', 'project', v_proj, jsonb_build_object('id', p_id));
end $$;

create or replace function public.preproduction_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can(v_proj, 'preproduction.edit') then raise exception 'not authorized'; end if;
  update public.preproduction_items set is_active = coalesce(p_active, true), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.active_changed', 'project', v_proj, jsonb_build_object('id', p_id, 'active', p_active));
end $$;

create or replace function public.preproduction_internal_approve(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can(v_proj, 'preproduction.internal_approve') then raise exception 'not authorized'; end if;
  update public.preproduction_items set internal_approved_by = auth.uid(), internal_approved_at = now(), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.internal_approved', 'project', v_proj, jsonb_build_object('id', p_id));
end $$;

-- ── CUSTODY: split the sensitive delete/restore + granular upload ────────────
-- Delete/restore ASSET IMAGES require the explicit sensitive key (NOT the blanket
-- manage flag). Admin/Owner/Super-Admin keep the floor; a Custody Manager can delete
-- evidence ONLY if custody.delete_asset_images is explicitly granted.
create or replace function public.custody_inv_admin_archive_asset_file(p_file uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not (public.civ_can_admin() or public.emp_has_permission(auth.uid(), 'custody.delete_asset_images')) then
    raise exception 'not authorized';
  end if;
  select * into f from public.custody_inventory_asset_files where id = p_file and is_deleted = false;
  if f.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_asset_files set is_deleted = true, is_primary = false where id = p_file;
  begin
    insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
      values (f.asset_id, auth.uid(), 'image_archived', jsonb_build_array(jsonb_build_object('field','file','old',f.file_name,'new',null)), nullif(trim(p_reason),''));
  exception when undefined_table then null; when others then null; end;
  return true;
end $$;

create or replace function public.custody_inv_admin_restore_asset_file(p_file uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not (public.civ_can_admin() or public.emp_has_permission(auth.uid(), 'custody.restore_asset_images')) then
    raise exception 'not authorized';
  end if;
  select * into f from public.custody_inventory_asset_files where id = p_file and is_deleted = true;
  if f.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_asset_files set is_deleted = false where id = p_file;
  begin
    insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
      values (f.asset_id, auth.uid(), 'image_restored', jsonb_build_array(jsonb_build_object('field','file','old',null,'new',f.file_name)), null);
  exception when undefined_table then null; when others then null; end;
  return true;
end $$;

-- Storage: upload requires custody.upload_asset_images (via custody_authz — keeps the
-- role floor); delete requires the sensitive delete key (admin floor + explicit grant).
drop policy if exists "civ assets bucket upload" on storage.objects;
create policy "civ assets bucket upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'custody-inventory-assets' and public.custody_authz('custody.upload_asset_images'));
drop policy if exists "civ assets bucket delete" on storage.objects;
create policy "civ assets bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'custody-inventory-assets'
         and (public.civ_can_admin() or public.emp_has_permission(auth.uid(), 'custody.delete_asset_images')));

-- Re-assert EXECUTE grants on every function this migration (re)creates. Idempotent on
-- the normal CREATE OR REPLACE path (grants were preserved there); REQUIRED on the §0
-- self-heal path, where a dropped+recreated function would otherwise lose its grants.
-- Matches each function's original grant (revoke public/anon; execute → authenticated —
-- the SECURITY DEFINER bodies self-check authorization internally). The 3 NEW helpers
-- (pc_authz/custody_authz/pp_can) are granted at their definitions above.
do $g2$
declare f text;
begin
  foreach f in array array[
    'public.preproduction_upsert(uuid,jsonb)',
    'public.preproduction_delete(uuid,text)',
    'public.preproduction_restore(uuid)',
    'public.preproduction_set_active(uuid,boolean)',
    'public.preproduction_internal_approve(uuid)',
    'public.custody_inv_admin_archive_asset_file(uuid,text)',
    'public.custody_inv_admin_restore_asset_file(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g2$;

do $v$
begin
  if to_regprocedure('public.pc_authz(uuid,text)') is null then raise exception 'فشل: pc_authz'; end if;
  if to_regprocedure('public.custody_authz(text)') is null then raise exception 'فشل: custody_authz'; end if;
  if to_regprocedure('public.pp_can(uuid,text)')   is null then raise exception 'فشل: pp_can'; end if;
  -- Post-heal grant assertion: preproduction_delete must be callable by authenticated
  -- (proves the §0 drop→recreate path, if it ran, restored EXECUTE).
  if not has_function_privilege('authenticated', 'public.preproduction_delete(uuid,text)', 'execute')
    then raise exception 'فشل: preproduction_delete غير ممنوح execute لـ authenticated'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
