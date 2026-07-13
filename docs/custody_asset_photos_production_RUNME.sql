-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Asset Photos: ملف الإنتاج الموحّد (RUNME) — idempotent، آمن للتكرار
-- ────────────────────────────────────────────────────────────────────────────
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor لإكمال إصلاح صور الأصول.
-- يفترض أن قاعدة v1 (custody_inventory_*) + patch التعديل (asset_editing) مطبّقان
--   (وجود جدول custody_inventory_asset_files + عمود is_primary + جدول asset_changes).
-- يحتوي فقط ما يلزم لإصلاح الصور + صلاحية الحذف — بلا تكرار داخلي.
-- لا hard delete. لا يلمس: hr-files / custody-evidence / العهدة القديمة / Zoho / الفواتير / العروض.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 0) متطلبات أساسية (idempotent) ───
alter table public.custody_inventory_asset_files add column if not exists is_primary boolean not null default false;

-- civ_can_finance (لسياسة RLS المالية) — مطابقة لتعريف enterprise_00.
create or replace function public.civ_can_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() = 'finance';
$$;
revoke all    on function public.civ_can_finance() from public, anon;
grant  execute on function public.civ_can_finance() to authenticated;

-- ─── 1) ربط ملف/صورة أصل: أول صورة كتالوج تصبح Primary تلقائيًا (تدقيق آمن الفشل) ───
create or replace function public.custody_inv_attach_asset_file(
  p_asset uuid, p_type text, p_path text, p_name text, p_mime text, p_size bigint, p_desc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text; v_first boolean;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  v_type := coalesce(nullif(p_type,''),'asset_photo');
  -- صورة الكتالوج يجب أن تكون صورة (لا PDF/مستند) — دفاع خادمي.
  if v_type = 'asset_photo' and p_mime is not null and p_mime not like 'image/%' then raise exception 'not_image'; end if;
  v_first := (v_type = 'asset_photo') and not exists (
    select 1 from public.custody_inventory_asset_files
    where asset_id = p_asset and file_type = 'asset_photo' and is_deleted = false and is_primary = true);
  begin
    insert into public.custody_inventory_asset_files(asset_id, file_type, file_path, file_name, mime_type, size_bytes, description, uploaded_by, is_primary)
      values (p_asset, v_type, p_path, p_name, p_mime, p_size, p_desc, auth.uid(), v_first)
      returning id into v_id;
  exception when unique_violation then   -- سباق نادر على الصورة الأساسية (فهرس فريد) → أدرج كغير أساسية
    insert into public.custody_inventory_asset_files(asset_id, file_type, file_path, file_name, mime_type, size_bytes, description, uploaded_by, is_primary)
      values (p_asset, v_type, p_path, p_name, p_mime, p_size, p_desc, auth.uid(), false)
      returning id into v_id;
  end;
  begin   -- التدقيق best-effort — لا يفشّل الربط إن لم يوجد جدول التغييرات بعد
    insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
      values (p_asset, auth.uid(), 'image_added', jsonb_build_array(jsonb_build_object('field','file','old',null,'new',p_name)), null);
  exception when undefined_table then null; when others then null; end;
  return v_id;
end; $$;
revoke all    on function public.custody_inv_attach_asset_file(uuid,text,text,text,text,bigint,text) from public, anon;
grant  execute on function public.custody_inv_attach_asset_file(uuid,text,text,text,text,bigint,text) to authenticated;

-- ─── 2) صور كتالوج الأصل من الخادم (المسار المؤكد فقط) ───
create or replace function public.custody_inv_get_asset_catalog_photos(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare j jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.custody_inventory_assets where id = p_asset_id) then raise exception 'not_found'; end if;
  with db as (
    select f.id as file_id, f.file_path as storage_path, f.is_primary, f.created_at,
           not exists (select 1 from storage.objects o
                       where o.bucket_id = 'custody-inventory-assets' and o.name = f.file_path) as missing_in_storage
    from public.custody_inventory_asset_files f
    where f.asset_id = p_asset_id and f.is_deleted = false and f.file_type = 'asset_photo'
      and coalesce(f.mime_type, 'image/x') like 'image/%'   -- استبعد أي صف غير صورة (لا يُعرض كصورة أساسية معطوبة)
  ),
  orphan as (
    select o.name as storage_path
    from storage.objects o
    where o.bucket_id = 'custody-inventory-assets'
      and o.name like p_asset_id::text || '/asset_photo/%'
      and coalesce(o.metadata->>'mimetype','') like 'image/%'
      and not exists (select 1 from db d where d.storage_path = o.name)
  )
  select jsonb_agg(x order by pri desc, ca desc nulls last) into j
  from (
    select jsonb_build_object('bucket','custody-inventory-assets','storage_path', storage_path, 'file_id', file_id,
             'is_primary', is_primary, 'source','database', 'created_at', created_at, 'missing_in_storage', missing_in_storage) as x,
           (is_primary)::int as pri, created_at as ca
    from db
    union all
    select jsonb_build_object('bucket','custody-inventory-assets','storage_path', storage_path, 'file_id', null,
             'is_primary', false, 'source','storage_orphan', 'created_at', null, 'missing_in_storage', false),
           0, null
    from orphan
  ) u;
  return coalesce(j, '[]'::jsonb);
end; $$;
revoke all    on function public.custody_inv_get_asset_catalog_photos(uuid) from public, anon;
grant  execute on function public.custody_inv_get_asset_catalog_photos(uuid) to authenticated;

-- ─── 3) حالة صور الأصول (عدّاد/فلتر «بدون صورة» + شاشة الاستكمال) ───
--     has_photo = صف asset_photo غير محذوف ولملفه كائن تخزين موجود.
create or replace function public.custody_inv_admin_assets_photo_status(p_q text default null) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name, 'asset_type', a.asset_type,
      'serial_number', a.serial_number, 'category_id', a.category_id, 'warehouse_location_id', a.warehouse_location_id,
      'has_photo', exists (
        select 1 from public.custody_inventory_asset_files f
        where f.asset_id = a.id and f.file_type = 'asset_photo' and f.is_deleted = false
          and coalesce(f.mime_type, 'image/x') like 'image/%'
          and exists (select 1 from storage.objects o where o.bucket_id = 'custody-inventory-assets' and o.name = f.file_path
                      and coalesce(o.metadata->>'mimetype','') like 'image/%'))
      ) order by a.asset_name)
    from public.custody_inventory_assets a
    where a.is_deleted = false
      and ( p_q is null or a.asset_name ilike '%'||p_q||'%' or a.asset_code ilike '%'||p_q||'%'
            or coalesce(a.serial_number,'') ilike '%'||p_q||'%' )
  ), '[]'::jsonb);
end; $$;
revoke all    on function public.custody_inv_admin_assets_photo_status(text) from public, anon;
grant  execute on function public.custody_inv_admin_assets_photo_status(text) to authenticated;

-- ─── 4) صلاحية حذف/استعادة الأصل: المالك + السوبر أدمن + الأدمن فقط ───
create or replace function public.civ_can_delete_asset() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'active'
      and (account_type = 'admin' or staff_role = 'super_admin')
  );
$$;
revoke all    on function public.civ_can_delete_asset() from public, anon;
grant  execute on function public.civ_can_delete_asset() to authenticated;

-- ─── 5) تحصين خصوصية الملفات (RLS): المستندات المالية لأصحاب الصلاحية المالية فقط ───
drop policy if exists civ_asset_files_read on public.custody_inventory_asset_files;
create policy civ_asset_files_read on public.custody_inventory_asset_files
  for select to authenticated using (
    public.civ_can_manage() and (
      file_type in ('asset_photo','manual','other') or public.civ_can_finance()
    )
  );

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Backfill — صور موجودة في {asset_id}/asset_photo/% بلا صف asset_files (لا اسم، لا كود)
-- ════════════════════════════════════════════════════════════════════════════
begin;

with cand as (   -- المسار المؤكد فقط: seg1 = UUID الأصل، seg2 = asset_photo، MIME صورة
  select o.name as file_path,
         (storage.foldername(o.name))[1]        as aid_txt,
         regexp_replace(o.name, '^.*/', '')      as base_name,
         o.metadata->>'mimetype'                 as mime,
         nullif(o.metadata->>'size','')::bigint  as size_bytes,
         o.owner                                 as owner_uid,
         o.created_at                            as created_at
  from storage.objects o
  where o.bucket_id = 'custody-inventory-assets'
    and (storage.foldername(o.name))[2] = 'asset_photo'
    and coalesce(o.metadata->>'mimetype','') like 'image/%'
),
valid as (
  select c.* from cand c
  where c.aid_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.custody_inventory_assets a where a.id::text = c.aid_txt)
    and not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = c.file_path)
)
insert into public.custody_inventory_asset_files
  (asset_id, file_type, file_path, file_name, mime_type, size_bytes, uploaded_by, created_at, is_deleted, is_primary)
select v.aid_txt::uuid, 'asset_photo', v.file_path, v.base_name, v.mime, v.size_bytes,
       case when v.owner_uid is not null and exists (select 1 from auth.users u where u.id = v.owner_uid) then v.owner_uid else null end,
       coalesce(v.created_at, now()), false, false
from valid v;

-- تطبيع الأساسية: صورة أساسية واحدة كحدّ أقصى، وإن لا توجد فالأقدم.
update public.custody_inventory_asset_files f set is_primary = false
where f.is_primary = true and f.is_deleted = false and f.file_type = 'asset_photo'
  and f.id not in (select distinct on (asset_id) id from public.custody_inventory_asset_files
                   where is_primary = true and is_deleted = false and file_type = 'asset_photo'
                   order by asset_id, created_at asc, id);
update public.custody_inventory_asset_files f set is_primary = true
where f.id in (select distinct on (asset_id) id from public.custody_inventory_asset_files
               where is_deleted = false and file_type = 'asset_photo'
                 and asset_id not in (select asset_id from public.custody_inventory_asset_files
                                      where is_primary = true and is_deleted = false and file_type = 'asset_photo')
               order by asset_id, created_at asc, id);

-- صورة أساسية واحدة كحدّ أقصى لكل أصل (فهرس فريد جزئي) — يُنشأ بعد التطبيع أعلاه كي لا يفشل.
create unique index if not exists uniq_civ_primary_photo
  on public.custody_inventory_asset_files (asset_id)
  where is_primary and not is_deleted and file_type = 'asset_photo';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Validation (SELECT فقط) — تقرير الحالة بعد التشغيل
-- ════════════════════════════════════════════════════════════════════════════
-- الدوال موجودة:
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_inv_attach_asset_file','custody_inv_get_asset_catalog_photos',
   'custody_inv_admin_assets_photo_status','civ_can_delete_asset','civ_can_finance')
order by p.proname;

-- تقرير الصور:
select 'assets_live'               as metric, count(*) from public.custody_inventory_assets where is_deleted=false
union all
select 'asset_photo_rows_live',    count(*) from public.custody_inventory_asset_files where file_type='asset_photo' and is_deleted=false
union all
select 'storage_photos_in_bucket', count(*) from storage.objects
       where bucket_id='custody-inventory-assets' and (storage.foldername(name))[2]='asset_photo'
         and coalesce(metadata->>'mimetype','') like 'image/%'
union all
select 'linked_rows_with_object',  count(*) from public.custody_inventory_asset_files f
       where f.file_type='asset_photo' and f.is_deleted=false
         and exists (select 1 from storage.objects o where o.bucket_id='custody-inventory-assets' and o.name=f.file_path)
union all
-- أصول بدون صورة (لا صف asset_photo مربوط بكائن تخزين):
select 'assets_without_photo',     count(*) from public.custody_inventory_assets a
       where a.is_deleted=false
         and not exists (select 1 from public.custody_inventory_asset_files f
                         where f.asset_id=a.id and f.file_type='asset_photo' and f.is_deleted=false
                           and exists (select 1 from storage.objects o where o.bucket_id='custody-inventory-assets' and o.name=f.file_path))
union all
-- يتيمة متبقية (تخزين بلا صف — يجب أن تكون 0 بعد الـbackfill إلا غير القابلة للربط):
select 'orphan_storage_after',     count(*) from storage.objects o
       where o.bucket_id='custody-inventory-assets' and (storage.foldername(o.name))[2]='asset_photo'
         and coalesce(o.metadata->>'mimetype','') like 'image/%'
         and not exists (select 1 from public.custody_inventory_asset_files f where f.file_path=o.name);
