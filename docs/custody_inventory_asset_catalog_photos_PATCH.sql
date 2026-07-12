-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody: RPC صور كتالوج الأصل من الخادم (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
-- تُصلح عدم ظهور الصور: بدل قراءة العميل المباشرة من storage (تحجبها RLS)، تقرأ هذه
-- الدالة storage.objects على الخادم (SECURITY DEFINER) وتدمجها مع سجلات asset_files.
-- • تبحث عن UUID الأصل (أو asset_code) كـ segment في المسار — مستقلة عن ترتيب المسار.
-- • تستبعد المستندات المالية (invoice/warranty/purchase_document/maintenance_report/insurance/supplier).
-- • صور فقط (image/*)، بلا تكرار (bucket+path)، الأساسية أولًا.
-- الصلاحية: civ_can_manage() (مدير/أمين عهدة/مالك) — الموظف/العميل عبر مسارات أخرى.
-- لا يمنح العميل SELECT مباشرًا على storage.objects، ولا يوسّع أي storage policy.
-- يُشغَّل بعد v1 + asset_editing (يستخدم is_primary). آمن للتكرار.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.custody_inv_get_asset_catalog_photos(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; j jsonb;
  fin_segs text[] := array['invoice','warranty','purchase_document','maintenance_report','insurance_document','supplier_quote'];
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select asset_code into v_code from public.custody_inventory_assets where id = p_asset_id;   -- قد يكون محذوفًا — لا يمنع العرض

  with db as (   -- سجلات الجدول (قابلة للإدارة)
    select f.id as file_id, f.file_path as storage_path, f.is_primary, f.created_at,
           not exists (select 1 from storage.objects o
                       where o.bucket_id = 'custody-inventory-assets' and o.name = f.file_path) as missing_in_storage
    from public.custody_inventory_asset_files f
    where f.asset_id = p_asset_id and f.is_deleted = false and f.file_type = 'asset_photo'
  ),
  orphan as (   -- صور في التخزين بلا صف (UUID أو asset_code كـ segment؛ لا مستندات مالية)
    select o.name as storage_path
    from storage.objects o
    where o.bucket_id = 'custody-inventory-assets'
      and coalesce(o.metadata->>'mimetype','') like 'image/%'
      and ( p_asset_id::text = any(storage.foldername(o.name))
            or (v_code is not null and v_code = any(storage.foldername(o.name))) )
      and not (fin_segs && storage.foldername(o.name))
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

revoke execute on function public.custody_inv_get_asset_catalog_photos(uuid) from public, anon;
grant  execute on function public.custody_inv_get_asset_catalog_photos(uuid) to authenticated;

commit;

-- ─── تحقق (SELECT فقط) ───
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='custody_inv_get_asset_catalog_photos';
