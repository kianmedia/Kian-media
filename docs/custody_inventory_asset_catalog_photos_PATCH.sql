-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody: RPC صور كتالوج الأصل من الخادم (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
-- تُصلح عدم ظهور الصور: بدل قراءة العميل المباشرة من storage (تحجبها RLS)، تقرأ هذه
-- الدالة storage.objects على الخادم (SECURITY DEFINER) وتدمجها مع سجلات asset_files.
-- • المسار المؤكد فقط: name LIKE '{asset_id}/asset_photo/%' (لا asset_code، ولا بحث UUID
--   في segment آخر — حتى يثبت LIVE_DIAGNOSTIC وجود مسارات Legacy مختلفة).
-- • داخل مجلد asset_photo حصرًا + MIME صورة (image/*)، لا الامتداد وحده. بلا تكرار، الأساسية أولًا.
-- الصلاحية: civ_can_manage() + الأصل موجود — يُتحقَّق قبل قراءة storage.objects.
-- لا يمنح العميل SELECT مباشرًا على storage.objects، ولا يوسّع أي storage policy.
-- يُشغَّل بعد v1 + asset_editing (يستخدم is_primary). آمن للتكرار.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.custody_inv_get_asset_catalog_photos(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare j jsonb;
begin
  -- التحقق من الصلاحية قبل قراءة storage.objects: مدير عهدة/مالك + الأصل موجود.
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.custody_inventory_assets where id = p_asset_id) then raise exception 'not_found'; end if;

  with db as (   -- سجلات الجدول (قابلة للإدارة)
    select f.id as file_id, f.file_path as storage_path, f.is_primary, f.created_at,
           not exists (select 1 from storage.objects o
                       where o.bucket_id = 'custody-inventory-assets' and o.name = f.file_path) as missing_in_storage
    from public.custody_inventory_asset_files f
    where f.asset_id = p_asset_id and f.is_deleted = false and f.file_type = 'asset_photo'
  ),
  orphan as (   -- صور التخزين تحت مجلد asset_photo لهذا الأصل حصرًا (المسار المؤكد + MIME صورة، لا الامتداد وحده)
    select o.name as storage_path
    from storage.objects o
    where o.bucket_id = 'custody-inventory-assets'
      and o.name like p_asset_id::text || '/asset_photo/%'
      and coalesce(o.metadata->>'mimetype','') like 'image/%'
      and not exists (select 1 from db d where d.storage_path = o.name)
  )
  select jsonb_agg(x order by pri desc, ca desc nulls last) into j
  from (
    select jsonb_build_object(
             'bucket','custody-inventory-assets','storage_path', storage_path, 'file_id', file_id,
             'is_primary', is_primary, 'source','database', 'created_at', created_at,
             'missing_in_storage', missing_in_storage) as x,
           (is_primary)::int as pri, created_at as ca
    from db
    union all
    select jsonb_build_object(
             'bucket','custody-inventory-assets','storage_path', storage_path, 'file_id', null,
             'is_primary', false, 'source','storage_orphan', 'created_at', null,
             'missing_in_storage', false),
           0, null
    from orphan
  ) u;
  return coalesce(j, '[]'::jsonb);
end; $$;

revoke all    on function public.custody_inv_get_asset_catalog_photos(uuid) from public, anon;
grant  execute on function public.custody_inv_get_asset_catalog_photos(uuid) to authenticated;

commit;

-- ─── تحقق (SELECT فقط) ───
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='custody_inv_get_asset_catalog_photos';
