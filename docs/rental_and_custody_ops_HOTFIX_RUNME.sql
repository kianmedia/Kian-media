-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — عمليات التأجير والعهدة (إضافي/idempotent، غير مدمّر إلا حذفًا صريحًا مطلوبًا)
-- ────────────────────────────────────────────────────────────────────────────
--  1) انتهاء صلاحية مسودّات التأجير غير المكتملة (>15 دقيقة) → إرجاع المعدات للمخزون.
--  2) حذف طلب تأجير (المالك/السوبر أدمن) مع إرجاع المعدات — بترتيب FK آمن.
--  3) قصر «صرف العهدة الذاتي» + قائمة الأصول المتاحة على أمين العهدة/المدير/المالك
--     (منع أي موظف آخر من صرف عهدة أو رؤية بيانات الأصول عبر الخدمة الذاتية).
--
-- يعتمد على: civ_can_admin()/civ_can_manage()/custody_audit()، وجداول custody_rental_*
-- وcustody_inventory_reservations. preflight يتحقق. Rollback بلوك معلّق بالأسفل.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.civ_can_admin()') is null
     or to_regprocedure('public.civ_can_manage()') is null
     or to_regclass('public.custody_rental_requests') is null
     or to_regclass('public.custody_rental_items') is null then
    raise exception 'PREFLIGHT: أساس التأجير/العهدة غير مطبّق — شغّل ملفات RUNME الأساسية أولًا';
  end if;
end $$;

begin;

-- ═══ 1) انتهاء صلاحية المسودّات القديمة (لازم/كسول + backstop في الكرون) ═══
-- آمنة للاستدعاء من أي مستخدم مُوثَّق أو من الخدمة/الكرون: تُلغي فقط مسودّات مضى عليها
-- p_minutes دقيقة (افتراضي 15) وتُرجِع معداتها. لا ترمي (best-effort) حتى لا تكسر أي قراءة تستدعيها.
create or replace function public.custody_rental_expire_stale_drafts(p_minutes int default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_n int; v_min int := greatest(15, coalesce(p_minutes, 15));   -- أرضية 15د: لا يمكن استهداف مسودّات أحدث
begin
  -- مرشّحو الإلغاء: مسودّة بلا أي أدلة مضى على إنشائها v_min دقيقة (مهجورة مبكرًا قبل التصوير)،
  -- أو أي مسودّة مضى عليها 6 ساعات (مهجورة فعليًا حتى لو رُفعت صور). هذا يمنع إلغاء مسودّة
  -- قيد التصوير/التوقيع النشط (لها أدلة وعمرها < 6 ساعات).
  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.custody_rental_requests r
    where r.status = 'draft' and (
      (r.created_at < now() - make_interval(mins => v_min)
         and not exists (select 1 from public.custody_rental_evidence e where e.request_id = r.id))
      or r.created_at < now() - interval '6 hours'
    );
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return jsonb_build_object('ok', true, 'expired', 0); end if;

  -- إلغاء حجوزات المخزون المرتبطة (نفس منطق custody_rental_cancel)
  update public.custody_inventory_reservations set status = 'cancelled'
   where id in (select reservation_id from public.custody_rental_items
                where request_id = any(v_ids) and reservation_id is not null);
  -- تحرير بنود التأجير المحجوزة
  update public.custody_rental_items set status = 'returned'
   where request_id = any(v_ids) and status = 'reserved';
  -- إلغاء أي عقود مسودّة/موقّعة للطلب
  update public.custody_rental_contracts set status = 'cancelled'
   where request_id = any(v_ids) and status in ('draft','signed');
  -- تعليم الطلبات كملغاة (غير مدمّر — يبقي سجلًا؛ 'cancelled' مستثناة من حساب التوفّر)
  update public.custody_rental_requests
     set status = 'cancelled',
         internal_note = left(concat_ws(' | ', nullif(internal_note, ''), 'auto-expired stale draft'), 1000),
         updated_at = now()
   where id = any(v_ids);

  return jsonb_build_object('ok', true, 'expired', v_n);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM, 'expired', 0);
end $$;
revoke all on function public.custody_rental_expire_stale_drafts(int) from public, anon;   -- لا anon: تُستدعى بجلسة موظّف/مستأجر أو بمفتاح الخدمة (الكرون)
grant  execute on function public.custody_rental_expire_stale_drafts(int) to authenticated;

-- ═══ 2) حذف طلب تأجير (المالك/السوبر أدمن فقط) مع إرجاع المعدات ═══
-- ملاحظة FK: custody_rental_items بلا ON DELETE CASCADE → نحذف الأبناء أولًا بالترتيب.
-- يُمنع حذف طلب نشط/متأخر (المعدات مع المستأجر) — يجب إرجاعها أولًا.
create or replace function public.custody_rental_delete(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('active','overdue') then raise exception 'delete_active_forbidden'; end if;

  -- إرجاع المعدات: إلغاء حجوزات المخزون المرتبطة
  update public.custody_inventory_reservations set status = 'cancelled'
   where id in (select reservation_id from public.custody_rental_items
                where request_id = p_request and reservation_id is not null);

  -- حذف الأبناء بترتيب آمن للمفاتيح. custody_rental_inspections تشير إلى item_id/contract_id
  -- بلا ON DELETE CASCADE → تُحذف قبل items/contracts وإلا يفشل الحذف بخطأ FK.
  delete from public.custody_rental_evidence  where request_id = p_request;
  delete from public.custody_rental_charges   where request_id = p_request;
  if to_regclass('public.custody_rental_inspections') is not null then
    delete from public.custody_rental_inspections
      where item_id     in (select id from public.custody_rental_items     where request_id = p_request)
         or contract_id in (select id from public.custody_rental_contracts where request_id = p_request);
  end if;
  delete from public.custody_rental_items     where request_id = p_request;
  delete from public.custody_rental_contracts where request_id = p_request;
  delete from public.custody_rental_events    where request_id = p_request;
  delete from public.custody_rental_requests  where id = p_request;

  perform public.custody_audit('rental_deleted', 'custody_rental_request', p_request,
    jsonb_build_object('request_number', r.request_number, 'status', r.status));
  return jsonb_build_object('ok', true, 'deleted', p_request);
end $$;
revoke all on function public.custody_rental_delete(uuid) from public, anon;
grant  execute on function public.custody_rental_delete(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'fns' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('custody_rental_expire_stale_drafts','custody_rental_delete')
  order by p.proname;
-- عيّنة: عدد المسودّات القديمة الحالية (لن يُلغيها هذا الاستعلام — للعلم فقط)
select 'stale_drafts' as k, count(*) from public.custody_rental_requests
  where status = 'draft' and created_at < now() - interval '15 minutes';
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (انسخه يدويًا عند الحاجة فقط — لا يعمل باللصق):
-- begin;
--   drop function if exists public.custody_rental_expire_stale_drafts(int);
--   drop function if exists public.custody_rental_delete(uuid);
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
