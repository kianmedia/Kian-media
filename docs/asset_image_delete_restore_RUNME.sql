-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — ASSET IMAGE DELETE / RESTORE (RUN ONCE)  [P0-3]
--
-- Admin/Owner/Super-Admin already soft-delete an asset image via
-- custody_inv_admin_archive_asset_file (civ_can_admin, audited). This adds the
-- missing pieces:
--   • custody_inv_admin_list_archived_photos(asset) — list soft-deleted images
--   • custody_inv_admin_restore_asset_file(file)    — restore + audit
--   • a restricted Storage DELETE policy on custody-inventory-assets, gated on
--     civ_can_delete_asset() (Admin/Owner/Super-Admin only), so an explicit
--     permanent delete can remove the Storage object — ordinary employees and even
--     a Custody Manager cannot delete evidence via the API.
-- Soft delete stays the default (history preserved). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.custody_inventory_asset_files') is null then miss := miss || ' custody_inventory_asset_files'; end if;
  if to_regprocedure('public.civ_can_admin()')        is null then miss := miss || ' civ_can_admin()'; end if;
  if to_regprocedure('public.civ_can_delete_asset()') is null then miss := miss || ' civ_can_delete_asset() (شغّل custody_asset_photos_production_RUNME.sql)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

create or replace function public.custody_inv_admin_list_archived_photos(p_asset uuid)
returns table (file_id uuid, storage_path text, file_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  return query
    select id, file_path, file_name, created_at
    from public.custody_inventory_asset_files
    where asset_id = p_asset and is_deleted = true and file_type = 'asset_photo'
    order by created_at desc;
end $$;

create or replace function public.custody_inv_admin_restore_asset_file(p_file uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  select * into f from public.custody_inventory_asset_files where id = p_file and is_deleted = true;
  if f.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_asset_files set is_deleted = false where id = p_file;
  begin
    insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
      values (f.asset_id, auth.uid(), 'image_restored',
              jsonb_build_array(jsonb_build_object('field','file','old',null,'new',f.file_name)), null);
  exception when undefined_table then null; when others then null; end;
  return true;
end $$;

do $g$
declare fn text;
begin
  foreach fn in array array[
    'public.custody_inv_admin_list_archived_photos(uuid)',
    'public.custody_inv_admin_restore_asset_file(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end $g$;

-- Restricted permanent-delete of the Storage object (Admin/Owner/Super-Admin only).
drop policy if exists "civ assets bucket delete" on storage.objects;
create policy "civ assets bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'custody-inventory-assets' and public.civ_can_delete_asset());

do $v$
begin
  if to_regprocedure('public.custody_inv_admin_restore_asset_file(uuid)')  is null then raise exception 'فشل: restore'; end if;
  if to_regprocedure('public.custody_inv_admin_list_archived_photos(uuid)') is null then raise exception 'فشل: list_archived'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
