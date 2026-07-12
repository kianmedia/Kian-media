-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Inventory: تشخيص صور الأصول (قراءة فقط — لا يعدّل أي بيانات)
-- ────────────────────────────────────────────────────────────────────────────
-- شغّله في Supabase SQL Editor لإثبات أين الصور القديمة ولماذا لا تظهر.
-- لا INSERT/UPDATE/DELETE — SELECT فقط. آمن للتشغيل المتكرر.
-- المسار المتوقّع للصورة في التخزين: {asset_id}/asset_photo/{ts}_{name}
--   ⇒ (storage.foldername(name))[1] = asset_id ، [2] = نوع الملف.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) عدد الأصول (غير المحذوفة / الكل).
select 'assets_live'    as metric, count(*) from public.custody_inventory_assets where is_deleted = false
union all select 'assets_all', count(*) from public.custody_inventory_assets;

-- 2) عدد سجلات asset_files (كل الأنواع، غير محذوفة).
select 'asset_files_live' as metric, count(*) from public.custody_inventory_asset_files where is_deleted = false;

-- 3) عدد صور asset_photo (سجلات، غير محذوفة).
select 'asset_photo_rows' as metric, count(*) from public.custody_inventory_asset_files
 where is_deleted = false and file_type = 'asset_photo';

-- 4) عدد ملفات Storage داخل bucket الأصول.
select 'storage_objects_in_assets_bucket' as metric, count(*) from storage.objects
 where bucket_id = 'custody-inventory-assets';
-- 4-ب) تفصيل حسب النوع (المجلد الثاني في المسار).
select coalesce((storage.foldername(name))[2],'(root)') as folder_type, count(*)
  from storage.objects where bucket_id = 'custody-inventory-assets' group by 1 order by 2 desc;

-- 5) الأصول التي لها ملفات Storage (asset_photo) ولا يوجد لها asset_files row — «يتيمة».
with obj as (
  select name, (storage.foldername(name))[1] as aid_txt
  from storage.objects
  where bucket_id = 'custody-inventory-assets' and (storage.foldername(name))[2] = 'asset_photo'
    and coalesce(metadata->>'mimetype','') like 'image/%'
)
select 'storage_only_no_row' as metric, count(*) from obj o
 where not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = o.name);
-- 5-ب) عيّنة من الملفات اليتيمة (حتى 50).
with obj as (
  select name, (storage.foldername(name))[1] as aid_txt
  from storage.objects
  where bucket_id = 'custody-inventory-assets' and (storage.foldername(name))[2] = 'asset_photo'
    and coalesce(metadata->>'mimetype','') like 'image/%'
)
select o.name as storage_path, o.aid_txt as asset_id_from_path,
       exists (select 1 from public.custody_inventory_assets a where a.id::text = o.aid_txt) as asset_exists
  from obj o
 where not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = o.name)
 limit 50;

-- 6) الأصول التي لها مسار صورة في عمود قديم (لا يوجد عمود صورة على الأصول في هذا النظام — للتأكيد).
select 'assets_have_image_column' as metric,
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='custody_inventory_assets'
                 and column_name in ('image_url','photo_url','thumbnail_url','cover_url','primary_photo_path','photo_path','image_path')) as ok;

-- 7) الأصول التي لها asset_files لكن الملف غير موجود في Storage (سجل بلا ملف).
select 'row_without_storage' as metric, count(*) from public.custody_inventory_asset_files f
 where f.is_deleted = false
   and not exists (select 1 from storage.objects o where o.bucket_id = 'custody-inventory-assets' and o.name = f.file_path);

-- 8) صور asset_files مؤرشفة (is_deleted = true) — «صور لكن deleted».
select 'archived_photo_rows' as metric, count(*) from public.custody_inventory_asset_files
 where is_deleted = true and file_type = 'asset_photo';

-- 9) ملفات asset_files بنوع مختلف عن asset_photo (فواتير/ضمانات/…): يجب ألا تُعرض كصور كتالوج.
select file_type, count(*) from public.custody_inventory_asset_files
 where is_deleted = false group by file_type order by 2 desc;

-- 10) ملفات Storage لا يمكن ربطها بأصل معروف (asset_id في المسار غير موجود/غير صالح).
with obj as (
  select name, (storage.foldername(name))[1] as aid_txt
  from storage.objects where bucket_id = 'custody-inventory-assets'
)
select 'unresolvable_storage_objects' as metric, count(*) from obj o
 where o.aid_txt is null
    or o.aid_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (select 1 from public.custody_inventory_assets a where a.id::text = o.aid_txt);

-- 11) صور مكررة لنفس asset_id + نفس المسار في asset_files (يجب ألا توجد — file_path فريد منطقيًا).
select file_path, count(*) from public.custody_inventory_asset_files
 where is_deleted = false group by file_path having count(*) > 1 order by 2 desc limit 50;

-- 12) أصول لها أكثر من is_primary = true (يجب ألا توجد — صورة أساسية واحدة كحدّ أقصى).
select asset_id, count(*) as primary_count from public.custody_inventory_asset_files
 where is_deleted = false and file_type = 'asset_photo' and is_primary = true
 group by asset_id having count(*) > 1 order by 2 desc;

-- 13) أصول لها صور asset_photo لكن بلا صورة أساسية.
select 'photos_without_primary' as metric, count(*) from (
  select asset_id from public.custody_inventory_asset_files
   where is_deleted = false and file_type = 'asset_photo'
   group by asset_id
  having bool_or(is_primary) = false
) x;
