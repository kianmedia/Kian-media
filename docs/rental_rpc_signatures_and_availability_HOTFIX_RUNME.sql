-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — RPC SIGNATURES + AVAILABILITY HOTFIX (توحيد التوقيعات وإظهار الكمية)
-- ────────────────────────────────────────────────────────────────────────────
-- يصلح 3 أعطال حية:
--   (1) بحث المستأجر يفشل: "Could not find function custody_rental_customer_available_assets".
--   (2) بحث الإدارة للعملاء يفشل/لا يعرض نتائج (عدم تطابق توقيع).
--   (3) فحص التوفّر يظهر "الكمية المتاحة: undefined" (اختلاف اسم الحقل).
-- السبب: قاعدة الإنتاج تشغّل نسخًا قديمة/أساسية (custody_rental_availability تعيد `free`
--   لا `available_quantity`، ودالتا البحث غير موجودتين في مخزّن مخطط PostgREST).
-- الحل: توقيعات قانونية موحّدة (PostgREST يطابق أسماء البارامترات حرفيًا) + إخراج موحّد
--   يحوي available_quantity. idempotent · غير هدّام · لا يحذف طلبات/عملاء · لا يعيد Foundation.
-- يُشغَّل بعد ملفات التأجير الحالية. الخطوة اليدوية الوحيدة لهذا الإصلاح = تشغيل هذا الملف كاملًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight: متطلبات موجودة مسبقًا (لا ينشئها هذا الملف) ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null or to_regclass('public.custody_rental_items') is null
     or to_regclass('public.custody_rental_customers') is null or to_regclass('public.custody_inventory_assets') is null
     or to_regclass('public.profiles') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.civ_can_manage()') is null or to_regprocedure('public.civ_can_admin()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة (طبّق custody_inventory v1).';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;

-- ─── 1) حذف أي توقيعات قديمة بالتوقيع الدقيق (يمنع Overload يربك PostgREST) ثم إعادة الإنشاء ───
--     نحذف بالأنواع فقط (لا بالاسم المجرد). آمن: الدوال تُستدعى من plpgsql (يُعاد الربط وقت النداء).
drop function if exists public.custody_rental_admin_search_clients(text, integer, integer);
drop function if exists public.custody_rental_customer_available_assets(timestamptz, timestamptz, text);
drop function if exists public.custody_rental_availability(uuid, timestamptz, timestamptz, numeric);

-- ─── 2) فحص التوفّر — إخراج موحّد يحوي available_quantity/requested_quantity/total_quantity ───
--     يحافظ على مفتاح `available` (يعتمد عليه add_item) ومفتاح `free` (توافق خلفي).
create function public.custody_rental_availability(p_asset uuid, p_from timestamptz, p_to timestamptz, p_qty numeric default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_rent numeric; v_res numeric; v_free numeric; v_qty numeric; v_src text; v_next timestamptz;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_from is null then raise exception 'invalid_start'; end if;
  if p_to   is null then raise exception 'invalid_end'; end if;
  if p_to <= p_from then raise exception 'end_before_start'; end if;
  v_qty := coalesce(p_qty, 1);
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.id is null then raise exception 'asset_not_found'; end if;
  if a.availability_status in ('lost','retired') then
    return jsonb_build_object('available', false, 'available_quantity', 0, 'free', 0, 'requested_quantity', v_qty,
      'total_quantity', a.quantity_total, 'committed', a.quantity_total, 'conflict_reason', 'asset_'||a.availability_status,
      'conflicting_source', 'asset_status', 'availability_status', a.availability_status, 'asset_type', a.asset_type,
      'reason', 'asset_'||a.availability_status, 'next_available_at', null);
  end if;
  select coalesce(sum(i.quantity),0) into v_rent
    from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
   where i.asset_id = p_asset and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
     and r.rental_from is not null and r.rental_to is not null and r.rental_from < p_to and r.rental_to > p_from;
  select coalesce(sum(res.quantity),0) into v_res
    from public.custody_inventory_reservations res
   where res.asset_id = p_asset and res.status = 'active'
     and coalesce(res.reserved_from, p_from) < p_to and coalesce(res.reserved_to, p_to) > p_from;
  v_free := a.quantity_available - v_rent - v_res;
  v_src := case when v_free >= v_qty then null
    when v_rent > 0 then 'other_rental' when v_res > 0 then 'custody_reservation'
    when coalesce(a.quantity_in_maintenance,0) > 0 then 'maintenance' else 'insufficient_stock' end;
  if v_free < v_qty then
    select min(r.rental_to) into v_next
      from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
     where i.asset_id = p_asset and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
       and r.rental_from < p_to and r.rental_to > p_from and r.rental_to > now();
  end if;
  return jsonb_build_object(
    'available', v_free >= v_qty, 'available_quantity', greatest(v_free,0), 'free', greatest(v_free,0),
    'requested_quantity', v_qty, 'total_quantity', a.quantity_total, 'committed', a.quantity_total - v_free,
    'rented_overlap', v_rent, 'reserved_overlap', v_res, 'in_maintenance', coalesce(a.quantity_in_maintenance,0),
    'asset_type', a.asset_type, 'availability_status', a.availability_status,
    'reason', case when v_free >= v_qty then 'ok' else 'insufficient' end,
    'conflict_reason', case when v_free >= v_qty then null else 'insufficient' end,
    'conflicting_source', v_src, 'next_available_at', v_next);
end; $$;

-- ─── 3) بحث عملاء البوابة (إدارة فقط) — توقيع قانوني + total_count + rental_customer_id ───
create function public.custody_rental_admin_search_clients(p_q text default '', p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lim int; v_off int; v_total int; v_rows jsonb; v_q text;
begin
  if not (public.civ_can_admin() or public.civ_can_manage()) then raise exception 'not authorized'; end if;
  v_lim := least(greatest(coalesce(p_limit,20),1),50); v_off := greatest(coalesce(p_offset,0),0);
  v_q := nullif(trim(coalesce(p_q,'')),'');
  select count(*) into v_total from public.profiles p
   where p.account_status = 'active' and p.account_type in ('client','admin')
     and (v_q is null or p.full_name ilike '%'||v_q||'%' or p.company ilike '%'||v_q||'%' or p.email ilike '%'||v_q||'%' or p.mobile ilike '%'||v_q||'%');
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.full_name nulls last), '[]'::jsonb) into v_rows from (
    select p.id as profile_id, p.full_name, p.company, p.email, p.mobile, p.account_type,
           c.id as rental_customer_id
    from public.profiles p
    left join public.custody_rental_customers c on c.user_id = p.id and c.is_deleted = false
    where p.account_status = 'active' and p.account_type in ('client','admin')
      and (v_q is null or p.full_name ilike '%'||v_q||'%' or p.company ilike '%'||v_q||'%' or p.email ilike '%'||v_q||'%' or p.mobile ilike '%'||v_q||'%')
    order by p.full_name nulls last
    limit v_lim offset v_off) t;
  return jsonb_build_object('total_count', v_total, 'limit', v_lim, 'offset', v_off, 'rows', v_rows);
end; $$;

-- ─── 4) بحث معدّات المستأجر — توقيع قانوني (p_from,p_to,p_q) + أعمدة آمنة + كمية موحّدة ───
create function public.custody_rental_customer_available_assets(p_from timestamptz, p_to timestamptz, p_q text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_rent numeric; v_res numeric; v_free numeric; v_out jsonb := '[]'::jsonb; v_photo text; v_q text; v_reason text; v_next timestamptz;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  if p_from is null then raise exception 'invalid_start'; end if;
  if p_to   is null then raise exception 'invalid_end'; end if;
  if p_to <= p_from then raise exception 'end_before_start'; end if;
  v_q := nullif(trim(coalesce(p_q,'')),'');
  for a in
    select id, asset_code, asset_name, asset_type, serial_number, quantity_available, quantity_total, quantity_in_maintenance, availability_status
      from public.custody_inventory_assets
     where is_deleted = false and availability_status not in ('lost','retired')
       and (v_q is null or asset_name ilike '%'||v_q||'%' or asset_code ilike '%'||v_q||'%')
     order by asset_name limit 100
  loop
    select coalesce(sum(i.quantity),0) into v_rent from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
      where i.asset_id = a.id and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
        and r.rental_from < p_to and r.rental_to > p_from;
    select coalesce(sum(res.quantity),0) into v_res from public.custody_inventory_reservations res
      where res.asset_id = a.id and res.status = 'active' and coalesce(res.reserved_from,p_from) < p_to and coalesce(res.reserved_to,p_to) > p_from;
    v_free := a.quantity_available - v_rent - v_res;
    v_reason := case when v_free > 0 then null
      when v_rent > 0 then 'other_rental' when v_res > 0 then 'custody_reservation'
      when coalesce(a.quantity_in_maintenance,0) > 0 then 'maintenance' else 'insufficient_stock' end;
    v_next := null;
    if v_free <= 0 then
      select min(r.rental_to) into v_next from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
        where i.asset_id = a.id and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
          and r.rental_from < p_to and r.rental_to > p_from and r.rental_to > now();
    end if;
    select file_path into v_photo from public.custody_inventory_asset_files
      where asset_id = a.id and is_deleted = false and file_type = 'asset_photo' order by is_primary desc nulls last, created_at desc limit 1;
    -- أعمدة آمنة فقط — لا تكلفة/ملاحظات داخلية/عهدة موظفين/بيانات مالية.
    v_out := v_out || jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name, 'asset_type', a.asset_type,
      'serial_number', a.serial_number, 'catalog_photo_path', v_photo,
      'total_quantity', a.quantity_total, 'available_quantity', greatest(v_free,0),
      'is_available', v_free > 0, 'availability_reason', v_reason, 'next_available_at', v_next);
  end loop;
  return v_out;
end; $$;

-- ─── 5) الصلاحيات + إعادة تحميل المخطط ───
revoke all on function public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric) from public, anon;
revoke all on function public.custody_rental_admin_search_clients(text,integer,integer) from public, anon;
revoke all on function public.custody_rental_customer_available_assets(timestamptz,timestamptz,text) from public, anon;
grant execute on function public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric) to authenticated;
grant execute on function public.custody_rental_admin_search_clients(text,integer,integer) to authenticated;
grant execute on function public.custody_rental_customer_available_assets(timestamptz,timestamptz,text) to authenticated;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Validation (SELECT فقط) — يثبت التوقيعات وعدم وجود Overload وحقول الإخراج
-- ════════════════════════════════════════════════════════════════════════════
-- (1) التوقيعات الفعلية:
select 'signatures' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_admin_search_clients','custody_rental_customer_available_assets','custody_rental_availability')
order by p.proname;
-- (2) توقيع الإدارة يطابق p_q text, p_limit integer, p_offset integer:
select 'admin_sig_ok' as k,
  pg_get_function_identity_arguments(to_regprocedure('public.custody_rental_admin_search_clients(text,integer,integer)')) as args,
  to_regprocedure('public.custody_rental_admin_search_clients(text,integer,integer)') is not null as exists;
-- (3) توقيع المستأجر يطابق p_from timestamptz, p_to timestamptz, p_q text:
select 'customer_sig_ok' as k,
  pg_get_function_identity_arguments(to_regprocedure('public.custody_rental_customer_available_assets(timestamptz,timestamptz,text)')) as args,
  to_regprocedure('public.custody_rental_customer_available_assets(timestamptz,timestamptz,text)') is not null as exists;
-- (4) available_quantity موجود وعددي في مخرجات custody_rental_availability (على أول أصل نشط).
--     ملاحظة: الدالة مقيّدة بـciv_can_manage()؛ في محرّر SQL بلا JWT تكون auth.uid()=NULL فترفع
--     'not authorized' — نلتقط ذلك كـNOTICE (متوقّع) كي لا يوقف بقية الـValidation.
do $$
declare v_asset uuid; v_res jsonb; v_aq jsonb;
begin
  select id into v_asset from public.custody_inventory_assets where is_deleted=false and availability_status not in ('lost','retired') limit 1;
  if v_asset is null then raise notice 'availability sample: no active asset'; return; end if;
  begin
    v_res := public.custody_rental_availability(v_asset, now(), now()+interval '1 day', 1);
    v_aq := v_res->'available_quantity';
    raise notice 'availability sample: available_quantity=% (jsonb_typeof=%)', v_res->>'available_quantity', jsonb_typeof(v_aq);
    if jsonb_typeof(v_aq) <> 'number' then raise warning 'available_quantity is NOT numeric!'; end if;
  exception when others then
    raise notice 'availability sample skipped (%). الدالة موجودة؛ نفّذها من التطبيق بحساب مدير للتحقق الحي.', sqlerrm;
  end;
end $$;
-- (5) الصلاحيات للأدوار الصحيحة:
select 'grants' as k, p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join (values ('authenticated'),('anon')) r(rolname)
where n.nspname='public' and p.proname in
  ('custody_rental_admin_search_clients','custody_rental_customer_available_assets','custody_rental_availability')
order by p.proname, r.rolname;
-- (6) لا Overload قديمة (يجب أن يكون العدد = 1 لكل دالة):
select 'no_overload' as k, p.proname, count(*) as versions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_admin_search_clients','custody_rental_customer_available_assets','custody_rental_availability')
group by p.proname;
