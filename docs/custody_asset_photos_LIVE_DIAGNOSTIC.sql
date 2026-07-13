-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody: تشخيص حيّ لصور الأصول من قاعدة البيانات (قراءة فقط، لا تعديل)
-- ────────────────────────────────────────────────────────────────────────────
-- الهدف: إثبات المسار الحقيقي للصور في storage.objects (لا افتراض).
-- شغّل الكل في Supabase SQL Editor. لا INSERT/UPDATE/DELETE.
-- ملاحظة: عدّل :ASSET (UUID) في الاستعلامات 4 و7 لأصل حقيقي (مثل SONY FX3) إن أردت.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) جميع buckets المتعلقة بالعهدة/الأصول.
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id ilike '%custody%' or id ilike '%asset%' or id ilike '%equipment%'
 order by id;

-- 2) عدد storage.objects في كل bucket.
select bucket_id, count(*) as objects
  from storage.objects group by bucket_id order by objects desc;

-- 3) عيّنة أول 100 مسار (name/bucket/owner/mimetype/created_at).
select bucket_id, name, owner, metadata->>'mimetype' as mime, metadata->>'size' as size, created_at
  from storage.objects
 where bucket_id ilike '%custody%' or bucket_id ilike '%asset%'
 order by created_at desc nulls last
 limit 100;

-- 4) البحث عن مسارات تحتوي UUID أصل محدَّد (عدّل القيمة).
--    مثال: استبدل النص بـ id الأصل الحقيقي من custody_inventory_assets.
select bucket_id, name, metadata->>'mimetype' as mime
  from storage.objects
 where name ilike '%00000000-0000-0000-0000-000000000000%'   -- ← ضع هنا UUID الأصل
 limit 100;

-- 5) البحث عن مسارات تحتوي asset_code (لالتقاط رفع بالكود بدل الـUUID).
select o.bucket_id, o.name, a.asset_code
  from storage.objects o
  join public.custody_inventory_assets a
    on position(a.asset_code in o.name) > 0
 where o.bucket_id = 'custody-inventory-assets'
 limit 100;

-- 6) عدد صفوف custody_inventory_asset_files (كل الأنواع / صور فقط / غير محذوفة).
select 'asset_files_all' as metric, count(*) from public.custody_inventory_asset_files
union all select 'asset_files_photo_live', count(*) from public.custody_inventory_asset_files where file_type='asset_photo' and is_deleted=false;

-- 7) جميع صفوف asset_files لأصل محدَّد (عدّل القيمة).
select id, file_type, file_path, file_name, mime_type, is_deleted, is_primary, created_at
  from public.custody_inventory_asset_files
 where asset_id = '00000000-0000-0000-0000-000000000000'   -- ← ضع هنا UUID الأصل
 order by created_at desc;

-- 8) مقارنة asset_files.file_path مع storage.objects.name (تطابق كامل؟).
select 'rows_with_matching_object' as metric, count(*)
  from public.custody_inventory_asset_files f
  join storage.objects o on o.bucket_id='custody-inventory-assets' and o.name = f.file_path
 where f.is_deleted=false;

-- 9) ملفات صور في Storage بلا صف asset_files (يتيمة) — مع الـsegment الذي يطابق أصلًا.
with img as (
  select o.name, storage.foldername(o.name) as segs
  from storage.objects o
  where o.bucket_id='custody-inventory-assets' and coalesce(o.metadata->>'mimetype','') like 'image/%'
)
select count(*) as storage_images_without_row
  from img i
 where not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = i.name);

-- 10) صفوف asset_files بلا ملف في Storage.
select count(*) as rows_without_object
  from public.custody_inventory_asset_files f
 where f.is_deleted=false
   and not exists (select 1 from storage.objects o where o.bucket_id='custody-inventory-assets' and o.name=f.file_path);

-- 11) ★ الأهم: تجميع المسارات حسب أول/ثاني segment لكشف النمط الحقيقي.
--     يُظهر إن كان النمط {uuid}/asset_photo أم asset_photo/{uuid} أم غير ذلك.
select
  (storage.foldername(name))[1] as seg1,
  (storage.foldername(name))[2] as seg2,
  count(*) as n,
  bool_or((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as seg1_is_uuid,
  bool_or((storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as seg2_is_uuid
  from storage.objects
 where bucket_id='custody-inventory-assets'
 group by 1,2
 order by n desc
 limit 100;

-- 11-ب) كم seg1 قيمة UUID موجودة فعلًا في جدول الأصول؟
select
  count(*) filter (where (storage.foldername(name))[1] in (select id::text from public.custody_inventory_assets)) as seg1_matches_asset,
  count(*) filter (where (storage.foldername(name))[2] in (select id::text from public.custody_inventory_assets)) as seg2_matches_asset,
  count(*) as total_objects
  from storage.objects where bucket_id='custody-inventory-assets';
