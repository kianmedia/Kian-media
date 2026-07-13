-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Inventory: Backfill صور الأصول + تحصين خصوصية الملفات (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
-- يعالج: صور مرفوعة إلى bucket «custody-inventory-assets» بلا سجل في asset_files
--        (لأن مسار الإضافة القديم لم يتحقق من نجاح attach) ⇒ تبويب الصور يظهر «لا صور».
-- • لا hard delete. لا يلمس العهدة/التأجير القديم/Zoho/الفواتير/عروض الأسعار.
-- • آمن للتكرار: لا ينشئ سجلًا مكررًا (يتحقق من file_path)، ولا ينقل مستندات مالية كصور.
-- • يربط الصورة بأصلها من مسار التخزين المؤكّد: {asset_id}/asset_photo/{ts}_{name}.
--   الصور غير القابلة للربط تبقى في Storage ولا تُحذف — تظهر في تقرير unresolved.
-- يُشغَّل بعد: v1 + self_service + enterprise_00 + enterprise_01 + asset_editing.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Backfill: أنشئ سجل asset_files لكل صورة يتيمة في التخزين ───
-- الشرط: bucket الأصول، المجلد الثاني = asset_photo، MIME صورة، asset_id صالح وموجود،
--        ولا يوجد سجل بنفس المسار (idempotent).
-- يطابق UUID الأصل كـ segment في أي موضع من المسار (مستقل عن ترتيب {uuid}/asset_photo أو غيره)،
-- ويستبعد مجلدات المستندات المالية، ويقتصر على صور (image/*).
with candidates as (
  select
    o.name                                   as file_path,
    regexp_replace(o.name, '^.*/', '')       as base_name,
    o.metadata->>'mimetype'                  as mime,
    nullif(o.metadata->>'size','')::bigint   as size_bytes,
    o.owner                                  as owner_uid,
    o.created_at                             as created_at,
    storage.foldername(o.name)               as segs
  from storage.objects o
  where o.bucket_id = 'custody-inventory-assets'
    and coalesce(o.metadata->>'mimetype','') like 'image/%'
    and not (array['invoice','warranty','purchase_document','maintenance_report','insurance_document','supplier_quote'] && storage.foldername(o.name))
),
resolved as (
  select c.*,
    (select seg from unnest(c.segs) seg
      where seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and exists (select 1 from public.custody_inventory_assets a where a.id::text = seg)
      limit 1) as aid_txt
  from candidates c
),
valid as (
  select r.* from resolved r
  where r.aid_txt is not null
    and not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = r.file_path)
)
insert into public.custody_inventory_asset_files
  (asset_id, file_type, file_path, file_name, mime_type, size_bytes, uploaded_by, created_at, is_deleted, is_primary)
select v.aid_txt::uuid, 'asset_photo', v.file_path, v.base_name, v.mime, v.size_bytes,
       -- uploaded_by يشير إلى auth.users: لا تثق بمالك التخزين (قد يكون معلّقًا) وإلا فشل الـinsert كله.
       case when v.owner_uid is not null and exists (select 1 from auth.users u where u.id = v.owner_uid) then v.owner_uid else null end,
       coalesce(v.created_at, now()), false, false
from valid v;

-- ─── 2) تطبيع الصورة الأساسية ───
-- 2-أ) إن وُجدت أكثر من صورة أساسية لأصل: أبقِ الأقدم فقط.
update public.custody_inventory_asset_files f set is_primary = false
where f.is_primary = true and f.is_deleted = false and f.file_type = 'asset_photo'
  and f.id not in (
    select distinct on (asset_id) id from public.custody_inventory_asset_files
    where is_primary = true and is_deleted = false and file_type = 'asset_photo'
    order by asset_id, created_at asc, id
  );

-- 2-ب) الأصول التي لها صور بلا أساسية: اجعل الأقدم أساسية.
update public.custody_inventory_asset_files f set is_primary = true
where f.id in (
  select distinct on (asset_id) id from public.custody_inventory_asset_files
  where is_deleted = false and file_type = 'asset_photo'
    and asset_id not in (
      select asset_id from public.custody_inventory_asset_files
      where is_primary = true and is_deleted = false and file_type = 'asset_photo')
  order by asset_id, created_at asc, id
);

-- ─── 3) تحصين خصوصية الملفات (RLS): المستندات المالية لأصحاب الصلاحية المالية فقط ───
-- الأنواع المالية (invoice/warranty/purchase_document/maintenance_report) لا يراها المدير/أمين
-- العهدة غير المالي. الصور والكتالوج (asset_photo/manual/other) تبقى مرئية للمدراء.
drop policy if exists civ_asset_files_read on public.custody_inventory_asset_files;
create policy civ_asset_files_read on public.custody_inventory_asset_files
  for select to authenticated using (
    public.civ_can_manage() and (
      file_type in ('asset_photo','manual','other') or public.civ_can_finance()
    )
  );

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) تقرير الـBackfill (SELECT فقط)
-- ════════════════════════════════════════════════════════════════════════════
select 'assets_with_photos' as metric,
       count(distinct asset_id) as value
  from public.custody_inventory_asset_files where is_deleted = false and file_type = 'asset_photo'
union all
select 'asset_photo_rows_total',
       count(*) from public.custody_inventory_asset_files where is_deleted = false and file_type = 'asset_photo'
union all
select 'storage_photos_total',
       count(*) from storage.objects
       where bucket_id = 'custody-inventory-assets' and (storage.foldername(name))[2] = 'asset_photo'
         and coalesce(metadata->>'mimetype','') like 'image/%'
union all
-- ما زال يتيمًا بعد الـbackfill (يجب أن يكون = عدد unresolvable فقط).
select 'still_orphan_after_backfill',
       count(*) from storage.objects o
       where o.bucket_id = 'custody-inventory-assets' and (storage.foldername(o.name))[2] = 'asset_photo'
         and coalesce(o.metadata->>'mimetype','') like 'image/%'
         and not exists (select 1 from public.custody_inventory_asset_files f where f.file_path = o.name)
union all
select 'assets_with_primary',
       count(distinct asset_id) from public.custody_inventory_asset_files
       where is_deleted = false and file_type = 'asset_photo' and is_primary = true;

-- 5) تقرير الصور غير القابلة للربط (unresolved) — لم تُلمَس، لم تُحذف.
with obj as (
  select name, (storage.foldername(name))[1] as aid_txt, metadata->>'mimetype' as mime
  from storage.objects where bucket_id = 'custody-inventory-assets'
    and (storage.foldername(name))[2] = 'asset_photo'
)
select o.name as storage_path, o.aid_txt as asset_id_from_path,
       case
         when o.aid_txt is null or o.aid_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'bad_path'
         when not exists (select 1 from public.custody_inventory_assets a where a.id::text = o.aid_txt) then 'asset_not_found'
         when coalesce(o.mime,'') not like 'image/%' then 'not_image'
         else 'ok'
       end as reason
  from obj o
 where o.aid_txt is null
    or o.aid_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not exists (select 1 from public.custody_inventory_assets a where a.id::text = o.aid_txt)
    or coalesce(o.mime,'') not like 'image/%'
 limit 200;
