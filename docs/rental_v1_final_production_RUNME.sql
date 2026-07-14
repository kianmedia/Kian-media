-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental & Insurance Portal V1 — FINAL UNIFIED PRODUCTION RUNME
-- ────────────────────────────────────────────────────────────────────────────
-- ملف واحد يجمع كل Hotfixes التأجير فوق القاعدة الحالية، بالترتيب الصحيح للاعتماديات.
-- شغّله بعد docs/rental_insurance_production_RUNME.sql (الأساس/Foundation).
-- الأجزاء: (1) Operational (2) RPC signatures+Availability (3) Client linking
--   (4) Renter self-service+Identity+Consent+Evidence+Reminders (5) Damage+Auto-invoice
--   (6) Request evidence upload fix (7) Server signed-upload + controlled return.
-- كل جزء idempotent · غير هدّام · لا يحذف بيانات · لا يعيد Foundation · بلا Fixtures.
-- بعد التشغيل فعّل: rental_insurance_enabled + rental_customer_portal_enabled
--   (+ rental_finance_enabled بعد اختبار الفواتير). WhatsApp يبقى معطّلًا.
-- ملاحظة الرفع: يلزم أيضًا ضبط متغيّرات الخادم SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL
--   حتى يعمل مسار الرفع الموقّع server-side (/api/rental/evidence/*).
-- ════════════════════════════════════════════════════════════════════════════



-- ╔════ PART: rental_portal_operational_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental Portal — OPERATIONAL HOTFIX (يُشغَّل بعد rental_insurance_production_RUNME.sql)
-- ────────────────────────────────────────────────────────────────────────────
-- يصلح ويكمل الطبقة التشغيلية دون إعادة تشغيل الأساس:
--   1) فحص التوفّر: أخطاء نافذة دقيقة (invalid_start/invalid_end/end_before_start)
--      + إخراج غني (available_quantity/conflict_reason/conflicting_source/next_available_at).
--   2) إعادة فحص التوفّر خادميًا عند الإرسال والاعتماد (منع الحجز المزدوج).
--   3) اعتماد/رفض/طلب تعديل صريح مع إشعار المستأجر.
--   4) ربط عميل البوابة (profiles) بـ custody_rental_customer عبر مفتاح ثابت (بلا تكرار).
--   5) طلب تأجير ذاتي للمستأجر عبر auth.uid() (لا customer_id من المتصفح) + بحث معدّات متاحة.
--   6) أعمدة موقع التسليم/الإرجاع ورسالة/سبب المستأجر.
--   7) دليل «إجمالي» للطلب + إلزام صور التسليم/الإرجاع.
-- idempotent · غير هدّام · لا يحذف أي طلب قائم · بلا fixtures · صالح على Production الحالية.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight خفيف: يجب أن يكون الأساس مطبّقًا ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null
     or to_regprocedure('public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric)') is null then
    raise exception 'HOTFIX PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  raise notice 'HOTFIX PREFLIGHT OK — الأساس موجود.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) أعمدة تشغيلية جديدة + فهرس ربط عميل البوابة (idempotent، غير هدّام)
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_rental_requests add column if not exists delivery_location text;
alter table public.custody_rental_requests add column if not exists return_location   text;
alter table public.custody_rental_requests add column if not exists rejection_reason  text;   -- سبب الرفض المرسل للمستأجر
alter table public.custody_rental_requests add column if not exists renter_message    text;   -- رسالة عامة للمستأجر (تعديل/ملاحظة)

-- مفتاح ثابت: عميل تأجير واحد لكل مستخدم بوابة (يمنع تكرار السجل عند كل ربط/طلب).
create unique index if not exists uq_rental_customer_user on public.custody_rental_customers(user_id) where user_id is not null;
-- فهرس بحث العملاء بالاسم/الشركة.
create index if not exists idx_rental_customers_name on public.custody_rental_customers(full_name);
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) فحص التوفّر — أخطاء نافذة دقيقة + إخراج غني (يستبدل النسخة السابقة بنفس التوقيع)
--    يحافظ على مفتاحَي available/reason اللذَين يعتمد عليهما add_item.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.custody_rental_availability(p_asset uuid, p_from timestamptz, p_to timestamptz, p_qty numeric default 1)
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
    return jsonb_build_object('available', false, 'reason', 'asset_'||a.availability_status,
      'conflict_reason', 'asset_'||a.availability_status, 'conflicting_source', 'asset_status',
      'free', 0, 'available_quantity', 0, 'requested', v_qty, 'total', a.quantity_total, 'asset_type', a.asset_type,
      'availability_status', a.availability_status, 'next_available_at', null);
  end if;
  -- كمية التأجير المتداخلة في حالات حاجزة (reserved غير مُسلَّم بعد؛ المُسلَّم مخصوم أصلًا).
  select coalesce(sum(i.quantity),0) into v_rent
    from public.custody_rental_items i
    join public.custody_rental_requests r on r.id = i.request_id
   where i.asset_id = p_asset and i.status = 'reserved'
     and r.status not in ('cancelled','rejected','closed')
     and r.rental_from is not null and r.rental_to is not null
     and r.rental_from < p_to and r.rental_to > p_from;
  -- محجوز العهدة الداخلية المتداخل.
  select coalesce(sum(res.quantity),0) into v_res
    from public.custody_inventory_reservations res
   where res.asset_id = p_asset and res.status = 'active'
     and coalesce(res.reserved_from, p_from) < p_to and coalesce(res.reserved_to, p_to) > p_from;
  v_free := a.quantity_available - v_rent - v_res;
  -- تحديد مصدر التعارض السائد.
  v_src := case
    when v_free >= v_qty then null
    when v_rent > 0 then 'other_rental'
    when v_res  > 0 then 'custody_reservation'
    when coalesce(a.quantity_in_maintenance,0) > 0 then 'maintenance'
    else 'insufficient_stock' end;
  -- أقرب وقت إتاحة (أدنى نهاية تأجير حاجز) — تقديري، فقط عند عدم التوفّر.
  if v_free < v_qty then
    select min(r.rental_to) into v_next
      from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
     where i.asset_id = p_asset and i.status = 'reserved'
       and r.status not in ('cancelled','rejected','closed')
       and r.rental_from < p_to and r.rental_to > p_from and r.rental_to > now();
  end if;
  return jsonb_build_object(
    'available', v_free >= v_qty, 'free', v_free, 'available_quantity', greatest(v_free,0), 'requested', v_qty,
    'total', a.quantity_total, 'committed', a.quantity_total - v_free, 'rented_overlap', v_rent, 'reserved_overlap', v_res,
    'in_maintenance', coalesce(a.quantity_in_maintenance,0), 'asset_type', a.asset_type, 'availability_status', a.availability_status,
    'reason', case when v_free >= v_qty then 'ok' else 'insufficient' end,
    'conflict_reason', case when v_free >= v_qty then null else 'insufficient' end,
    'conflicting_source', v_src, 'next_available_at', v_next);
end; $$;

-- نواة حساب المتاح — بلا بوابة دور (داخلية فقط، تُستدعى من دوال definer للمستأجر/إعادة الفحص).
-- الدالة العامة أعلاه (custody_rental_availability) تظل مقيّدة بـciv_can_manage للإدارة.
-- p_exclude_request: يُستثنى حجز هذا الطلب نفسه من الاحتساب (يمنع خصم حجز الطلب مرتين عند
--   إعادة الفحص بعد أن أصبحت كل بنوده reserved — وإلا رُفض كل إرسال/اعتماد بـquantity_unavailable).
create or replace function public.custody_rental_free_qty(p_asset uuid, p_from timestamptz, p_to timestamptz, p_exclude_request uuid default null)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare a record; v_rent numeric; v_res numeric;
begin
  select quantity_available as qa, availability_status as st into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.qa is null then return 0; end if;
  if a.st in ('lost','retired') then return 0; end if;
  select coalesce(sum(i.quantity),0) into v_rent
    from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
   where i.asset_id = p_asset and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
     and (p_exclude_request is null or r.id <> p_exclude_request)
     and r.rental_from is not null and r.rental_to is not null and r.rental_from < p_to and r.rental_to > p_from;
  select coalesce(sum(res.quantity),0) into v_res
    from public.custody_inventory_reservations res
   where res.asset_id = p_asset and res.status = 'active'
     and coalesce(res.reserved_from, p_from) < p_to and coalesce(res.reserved_to, p_to) > p_from;
  return a.qa - v_rent - v_res;
end; $$;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) إرسال/اعتماد/رفض/طلب تعديل — مع إعادة فحص التوفّر وإشعار المستأجر
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- 3-أ) إعادة فحص توفّر كل بنود الطلب داخل نفس المعاملة (يقفل الأصول بترتيب asset_id).
--      يُرفع 'quantity_unavailable' مع تفاصيل عند فشل أي بند. يُستدعى قبل الإرسال/الاعتماد.
create or replace function public.custody_rental_recheck(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; it record;
begin
  select * into r from public.custody_rental_requests where id = p_request;
  if r.id is null then raise exception 'not_found'; end if;
  if r.rental_from is null or r.rental_to is null then raise exception 'invalid_end'; end if;
  if r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  for it in select * from public.custody_rental_items where request_id = p_request and status = 'reserved' order by asset_id loop
    perform 1 from public.custody_inventory_assets where id = it.asset_id and is_deleted = false for update;
    -- استثنِ هذا الطلب نفسه: احسب المتاح للآخرين ثم قارنه بكامل كمية بنود هذا الطلب لنفس الأصل.
    if public.custody_rental_free_qty(it.asset_id, r.rental_from, r.rental_to, p_request)
       < (select coalesce(sum(x.quantity),0) from public.custody_rental_items x where x.request_id = p_request and x.asset_id = it.asset_id and x.status = 'reserved') then
      raise exception 'quantity_unavailable:%', it.asset_id;
    end if;
  end loop;
end; $$;

-- 3-ب) إرسال للاعتماد (إداري): يتحقق من النافذة + بند واحد + إعادة فحص، ثم draft→pending_approval.
create or replace function public.custody_rental_submit(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if r.rental_from is null then raise exception 'invalid_start'; end if;
  if r.rental_to is null then raise exception 'invalid_end'; end if;
  if r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  perform public.custody_rental_recheck(p_request);
  update public.custody_rental_requests set status = 'pending_approval', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'draft', 'pending_approval', auth.uid(), 'submitted');
  perform public.civ_notify_managers('rental_pending_approval', p_request, 'طلب تأجير بانتظار الاعتماد '||r.request_number, 'Rental pending approval '||r.request_number);
  return jsonb_build_object('ok', true, 'id', p_request, 'status', 'pending_approval');
end; $$;

-- 3-ج) اعتماد: يتحقق من اكتمال العميل + بند + النافذة + إعادة فحص داخل المعاملة، ثم approved.
create or replace function public.custody_rental_approve(p_request uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c record; v_uid uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending_approval' then raise exception 'bad_status'; end if;
  select * into c from public.custody_rental_customers where id = r.customer_id;
  if c.id is null or coalesce(trim(c.full_name),'') = '' then raise exception 'customer_incomplete'; end if;
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  if r.rental_from is null or r.rental_to is null or r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  perform public.custody_rental_recheck(p_request);   -- منع الحجز المزدوج لحظة الاعتماد
  update public.custody_rental_requests set status = 'approved', approved_by = auth.uid(),
    renter_message = coalesce(nullif(trim(p_message),''), renter_message), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'pending_approval', 'approved', auth.uid(), nullif(trim(p_message),''));
  begin perform public.custody_audit('rental_approved','custody_rental_request', p_request, '{}'::jsonb); exception when others then null; end;
  perform public.civ_notify_managers('rental_approved', p_request, 'اعتُمد طلب تأجير '||r.request_number, 'Rental approved '||r.request_number);
  v_uid := c.user_id;
  if v_uid is not null then perform public.civ_notify(v_uid, 'rental_approved', p_request, 'اعتُمد طلب تأجيرك '||r.request_number, 'Your rental was approved '||r.request_number); end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end; $$;

-- 3-د) رفض: سبب إلزامي يُرسل للمستأجر (بلا كشف ملاحظات داخلية).
create or replace function public.custody_rental_reject(p_request uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending_approval' then raise exception 'bad_status'; end if;
  update public.custody_rental_requests set status = 'rejected', rejection_reason = trim(p_reason), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'pending_approval', 'rejected', auth.uid(), trim(p_reason));
  perform public.civ_notify_managers('rental_rejected', p_request, 'رُفض طلب تأجير '||r.request_number, 'Rental rejected '||r.request_number);
  select * into c from public.custody_rental_customers where id = r.customer_id;
  if c.user_id is not null then perform public.civ_notify(c.user_id, 'rental_rejected', p_request, 'اعتُذر عن طلب تأجيرك '||r.request_number||': '||trim(p_reason), 'Your rental was declined '||r.request_number); end if;
  return jsonb_build_object('ok', true, 'status', 'rejected');
end; $$;

-- 3-هـ) طلب تعديل: يُعيد الطلب إلى draft مع ملاحظة للمستأجر ليعدّل ويعيد الإرسال.
create or replace function public.custody_rental_request_revision(p_request uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'note_required'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending_approval' then raise exception 'bad_status'; end if;
  update public.custody_rental_requests set status = 'draft', renter_message = trim(p_note), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'pending_approval', 'draft', auth.uid(), 'revision: '||trim(p_note));
  perform public.civ_notify_managers('rental_revision_requested', p_request, 'طلب تعديل تأجير '||r.request_number, 'Rental revision requested '||r.request_number);
  select * into c from public.custody_rental_customers where id = r.customer_id;
  if c.user_id is not null then perform public.civ_notify(c.user_id, 'rental_revision_requested', p_request, 'مطلوب تعديل على طلب تأجيرك '||r.request_number||': '||trim(p_note), 'Revision requested '||r.request_number); end if;
  return jsonb_build_object('ok', true, 'status', 'draft');
end; $$;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 3-ب) توسيع أنواع الإشعارات: إضافة rental_revision_requested (مع الحفاظ على كل ما سبق).
--   civ_notify يبتلع الأخطاء، فالإغفال لا يكسر الإجراء — لكن هذا يضمن وصول إشعار المستأجر.
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new','deliverable_new',
  'revision_requested','deliverable_approved','deliverable_final_delivered','project_status_changed',
  'opportunity_new','whatsapp_new','project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  'custody_checkout_new','rental_request_new','custody_return_submitted','custody_return_shortage',
  'custody_handover_approved','custody_closed','custody_rejected','custody_note_new',
  'custody_claim_pending','custody_claim_acknowledged',
  'hr_check_in','hr_check_out','hr_leave_new','hr_leave_decided','hr_task_new',
  'hr_task_started','hr_task_submitted','hr_task_closed','hr_attendance_adjusted','hr_note_new',
  'civ_asset_created','civ_asset_updated','civ_assignment_created','civ_confirm_pending',
  'civ_employee_confirmed','civ_employee_rejected','civ_return_requested','civ_return_accepted',
  'civ_return_rejected','civ_return_inspected','civ_damage_reported','civ_lost_reported','civ_maintenance_opened',
  'civ_maintenance_closed','civ_audit_started','civ_audit_approved','civ_audit_variance',
  'civ_stock_correction','civ_reservation_created','civ_custodian_changed',
  'civ_legacy_visibility_changed','civ_return_overdue','civ_warranty_expiring','civ_self_issue',
  'qr_reissued','kit_issued','kit_returned','custody_due_soon','custody_overdue','custody_escalated',
  'custody_incident_reported','custody_incident_updated','custody_signature_completed',
  'custody_location_started','custody_location_stopped','custody_offline_conflict',
  'rental_request_created','rental_contract_signed','rental_overdue',
  'maintenance_estimate_requested','maintenance_cost_approved','maintenance_completed',
  'purchase_request_created','purchase_request_approved','insurance_expiring','insurance_claim_updated','zoho_sync_failed',
  'rental_pending_approval','rental_approved','rental_rejected','rental_contract_ready','rental_handover_scheduled',
  'rental_activated','rental_due_soon','rental_return_requested','rental_return_inspection_required',
  'rental_damage_reported','rental_charges_pending','rental_deposit_release_pending','rental_closed',
  -- HOTFIX (جديد)
  'rental_revision_requested'
));
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) ربط عميل البوابة (profiles) — بحث مُصفّح + upsert بمفتاح ثابت (بلا تكرار)
-- ════════════════════════════════════════════════════════════════════════════
begin;
-- بحث عملاء البوابة (owner/super_admin/manager/custody_officer فقط) — أعمدة آمنة + pagination.
create or replace function public.custody_rental_admin_search_clients(p_q text default null, p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lim int; v_off int;
begin
  if not (public.civ_can_manage() or public.civ_can_admin()) then raise exception 'not authorized'; end if;
  v_lim := least(greatest(coalesce(p_limit,20),1),50); v_off := greatest(coalesce(p_offset,0),0);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'profile_id', p.id, 'full_name', p.full_name, 'company', p.company,
      'email', p.email, 'mobile', p.mobile, 'account_type', p.account_type) order by p.full_name nulls last)
    from public.profiles p
    where p.account_status = 'active' and p.account_type in ('client','admin')
      and (p_q is null or trim(p_q) = '' or p.full_name ilike '%'||p_q||'%' or p.company ilike '%'||p_q||'%'
           or p.email ilike '%'||p_q||'%' or p.mobile ilike '%'||p_q||'%')
    limit v_lim offset v_off), '[]'::jsonb);
end; $$;

-- ربط/إنشاء عميل تأجير من ملف بوابة — توقيع قانوني p_profile_id (drop لتغيّر اسم البارامتر)،
--   مفتاح ثابت user_id (upsert؛ لا تكرار)، رد قانوني (rental_customer_id/profile_id/...).
drop function if exists public.custody_rental_admin_link_portal_client(uuid);
create function public.custody_rental_admin_link_portal_client(p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare pr record; v_id uuid; v_party text;
begin
  if not (public.civ_can_admin() or public.civ_can_manage()) then raise exception 'not authorized'; end if;
  select id, full_name, company, email, mobile, account_type, account_status into pr from public.profiles where id = p_profile_id;
  if pr.id is null then raise exception 'profile_not_found'; end if;
  if pr.account_status <> 'active' or pr.account_type not in ('client','admin') then raise exception 'invalid_account'; end if;
  v_party := case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (p_profile_id, v_party, coalesce(nullif(trim(pr.full_name),''), pr.email, 'عميل'), nullif(trim(pr.company),''), pr.mobile, pr.email, auth.uid())
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_id;
  return jsonb_build_object('rental_customer_id', v_id, 'profile_id', pr.id, 'full_name', pr.full_name,
    'company', pr.company, 'email', pr.email, 'mobile', pr.mobile, 'account_type', pr.account_type);
end; $$;

-- إعادة إعلان admin_upsert مع موقع التسليم/الإرجاع (يحافظ على كل السلوك السابق + عمودين).
create or replace function public.custody_rental_admin_upsert_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; v_cust uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_cust := nullif(p_data->>'customer_id','')::uuid;
  if v_cust is null and coalesce(trim(p_data->>'full_name'),'') <> '' then
    insert into public.custody_rental_customers(party_type, full_name, company_name, phone, email, id_type, id_number_ref, tax_number, address, authorized_person, created_by)
      values (coalesce(nullif(p_data->>'party_type',''),'individual'), trim(p_data->>'full_name'), nullif(trim(p_data->>'company_name'),''),
              nullif(trim(p_data->>'phone'),''), nullif(trim(p_data->>'email'),''), nullif(p_data->>'id_type',''), nullif(trim(p_data->>'id_number_ref'),''),
              nullif(trim(p_data->>'tax_number'),''), nullif(trim(p_data->>'address'),''), nullif(trim(p_data->>'authorized_person'),''), auth.uid())
      returning id into v_cust;
  end if;
  v_id := nullif(p_data->>'id','')::uuid;
  if v_id is null then
    v_no := public.civ_gen_no('RNT');
    insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, rate_type, purpose, customer_note, internal_note, delivery_location, return_location, created_by)
      values (v_no, v_cust, 'draft', nullif(p_data->>'rental_from','')::timestamptz, nullif(p_data->>'rental_to','')::timestamptz,
              nullif(p_data->>'rate_type',''), nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'customer_note'),''), nullif(trim(p_data->>'internal_note'),''),
              nullif(trim(p_data->>'delivery_location'),''), nullif(trim(p_data->>'return_location'),''), auth.uid())
      returning id into v_id;
    insert into public.custody_rental_events(request_id, to_status, actor_id, reason) values (v_id, 'draft', auth.uid(), 'created');
    perform public.civ_notify_managers('rental_request_created', v_id, 'طلب تأجير جديد '||v_no, 'New rental request '||v_no);
  else
    update public.custody_rental_requests set
      customer_id = coalesce(v_cust, customer_id),
      rental_from = coalesce(nullif(p_data->>'rental_from','')::timestamptz, rental_from),
      rental_to   = coalesce(nullif(p_data->>'rental_to','')::timestamptz, rental_to),
      rate_type   = coalesce(nullif(p_data->>'rate_type',''), rate_type),
      purpose     = coalesce(nullif(trim(p_data->>'purpose'),''), purpose),
      customer_note = case when p_data ? 'customer_note' then nullif(trim(p_data->>'customer_note'),'') else customer_note end,
      internal_note = case when p_data ? 'internal_note' then nullif(trim(p_data->>'internal_note'),'') else internal_note end,
      delivery_location = case when p_data ? 'delivery_location' then nullif(trim(p_data->>'delivery_location'),'') else delivery_location end,
      return_location = case when p_data ? 'return_location' then nullif(trim(p_data->>'return_location'),'') else return_location end,
      updated_at = now()
    where id = v_id and status in ('draft','pending_approval');
    if not found then raise exception 'not_editable'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) طلب تأجير ذاتي للمستأجر — auth.uid() فقط (لا customer_id من المتصفح) + بحث معدّات
-- ════════════════════════════════════════════════════════════════════════════
begin;
-- يحل/ينشئ عميل التأجير المرتبط بالمستخدم من ملفه، ثم مسودة + بنود + (إرسال اختياري).
-- p_data: { rental_from, rental_to, delivery_location, return_location, purpose, customer_note,
--           items:[{asset_id, quantity}], submit:bool }
create or replace function public.custody_rental_customer_create_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; pr record; v_cust uuid; v_from timestamptz; v_to timestamptz; v_no text; v_req uuid; it jsonb;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not authorized'; end if;
  v_from := nullif(p_data->>'rental_from','')::timestamptz;
  v_to   := nullif(p_data->>'rental_to','')::timestamptz;
  if v_from is null then raise exception 'invalid_start'; end if;
  if v_to   is null then raise exception 'invalid_end'; end if;
  if v_to <= v_from then raise exception 'end_before_start'; end if;
  -- عميل التأجير المرتبط بالمستخدم (upsert بمفتاح ثابت — لا تكرار).
  select id, full_name, company, email, mobile into pr from public.profiles where id = v_uid;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (v_uid, case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end,
            coalesce(nullif(trim(pr.full_name),''), pr.email, 'مستأجر'), nullif(trim(pr.company),''), pr.mobile, pr.email, v_uid)
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_cust;
  -- المسودة.
  v_no := public.civ_gen_no('RNT');
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, delivery_location, return_location, purpose, customer_note, created_by)
    values (v_no, v_cust, 'draft', v_from, v_to, nullif(trim(p_data->>'delivery_location'),''), nullif(trim(p_data->>'return_location'),''),
            nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'customer_note'),''), v_uid)
    returning id into v_req;
  insert into public.custody_rental_events(request_id, to_status, actor_id, reason) values (v_req, 'draft', v_uid, 'customer_created');
  -- البنود (مع فحص توفّر لكل أصل ضمن النافذة).
  if jsonb_typeof(p_data->'items') = 'array' then
    for it in select * from jsonb_array_elements(p_data->'items') loop
      if (it->>'asset_id') is not null then
        perform 1 from public.custody_inventory_assets where id = (it->>'asset_id')::uuid and is_deleted = false for update;
        if public.custody_rental_free_qty((it->>'asset_id')::uuid, v_from, v_to) < coalesce((it->>'quantity')::numeric,1) then raise exception 'quantity_unavailable:%', it->>'asset_id'; end if;
        insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status)
          values (v_req, (it->>'asset_id')::uuid, coalesce((it->>'quantity')::numeric,1), coalesce((it->>'quantity')::numeric,1), 'reserved');
      end if;
    end loop;
  end if;
  -- إرسال اختياري.
  if coalesce((p_data->>'submit')::boolean, false) then
    if not exists (select 1 from public.custody_rental_items where request_id = v_req) then raise exception 'no_items'; end if;
    update public.custody_rental_requests set status = 'pending_approval', updated_at = now() where id = v_req;
    insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (v_req, 'draft', 'pending_approval', v_uid, 'customer_submitted');
    perform public.civ_notify_managers('rental_request_created', v_req, 'طلب تأجير جديد من مستأجر '||v_no, 'New self-service rental '||v_no);
  end if;
  return jsonb_build_object('ok', true, 'id', v_req, 'request_number', v_no, 'status', (select status from public.custody_rental_requests where id = v_req));
end; $$;

-- المستأجر يضيف بندًا إلى مسودته فقط (ملكية auth.uid) — مع فحص التوفّر.
create or replace function public.custody_rental_customer_add_item(p_request uuid, p_asset uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if r.rental_from is null or r.rental_to is null or r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  perform 1 from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if public.custody_rental_free_qty(p_asset, r.rental_from, r.rental_to) < coalesce(p_qty,1) then raise exception 'quantity_unavailable'; end if;
  insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status)
    values (p_request, p_asset, coalesce(p_qty,1), coalesce(p_qty,1), 'reserved');
  return jsonb_build_object('ok', true);
end; $$;

-- المستأجر يرسل مسودته للاعتماد.
create or replace function public.custody_rental_customer_submit(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if r.rental_from is null or r.rental_to is null or r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  perform public.custody_rental_recheck(p_request);
  update public.custody_rental_requests set status = 'pending_approval', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'draft', 'pending_approval', auth.uid(), 'customer_submitted');
  perform public.civ_notify_managers('rental_request_created', p_request, 'طلب تأجير جديد من مستأجر '||r.request_number, 'New self-service rental '||r.request_number);
  return jsonb_build_object('ok', true, 'status', 'pending_approval');
end; $$;

-- بحث المعدّات المتاحة للمستأجر ضمن نافذة — أعمدة آمنة (بلا تكلفة داخلية) + مسار صورة الكتالوج.
create or replace function public.custody_rental_customer_available_assets(p_from timestamptz, p_to timestamptz, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_rent numeric; v_res numeric; v_free numeric; v_out jsonb := '[]'::jsonb; v_photo text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  if p_from is null then raise exception 'invalid_start'; end if;
  if p_to is null then raise exception 'invalid_end'; end if;
  if p_to <= p_from then raise exception 'end_before_start'; end if;
  for a in
    select id, asset_code, asset_name, asset_type, quantity_available, quantity_total, quantity_in_maintenance, availability_status
      from public.custody_inventory_assets
     where is_deleted = false and availability_status not in ('lost','retired')
       and (p_q is null or trim(p_q) = '' or asset_name ilike '%'||p_q||'%' or asset_code ilike '%'||p_q||'%')
     order by asset_name limit 100
  loop
    select coalesce(sum(i.quantity),0) into v_rent from public.custody_rental_items i join public.custody_rental_requests r on r.id = i.request_id
      where i.asset_id = a.id and i.status = 'reserved' and r.status not in ('cancelled','rejected','closed')
        and r.rental_from < p_to and r.rental_to > p_from;
    select coalesce(sum(res.quantity),0) into v_res from public.custody_inventory_reservations res
      where res.asset_id = a.id and res.status = 'active' and coalesce(res.reserved_from,p_from) < p_to and coalesce(res.reserved_to,p_to) > p_from;
    v_free := a.quantity_available - v_rent - v_res;
    select file_path into v_photo from public.custody_inventory_asset_files
      where asset_id = a.id and is_deleted = false and file_type = 'asset_photo' order by is_primary desc nulls last, created_at desc limit 1;
    v_out := v_out || jsonb_build_object('asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
      'asset_type', a.asset_type, 'available_quantity', greatest(v_free,0), 'available', v_free > 0, 'photo_path', v_photo);
  end loop;
  return v_out;
end; $$;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) دليل «إجمالي» + إلزام صور التسليم/الإرجاع (يستبدل دالتَي الإكمال بنفس التوقيع)
-- ════════════════════════════════════════════════════════════════════════════
begin;
-- دليل عام: p_item قد يكون null (صورة إجمالية للطلب). p_stage: handover | return_inspection | return_request.
create or replace function public.custody_rental_add_evidence(p_request uuid, p_item uuid, p_stage text, p_path text, p_condition text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_stage not in ('handover','return_request','return_inspection') then raise exception 'bad_stage'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  select * into r from public.custody_rental_requests where id = p_request;
  if r.id is null then raise exception 'not_found'; end if;
  if p_item is not null and not exists (select 1 from public.custody_rental_items where id = p_item and request_id = p_request) then raise exception 'item_not_in_request'; end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, condition, note, uploaded_by)
    values (p_request, p_item, p_stage, p_path, nullif(p_condition,''), nullif(trim(p_note),''), auth.uid());
  if p_item is not null and p_stage = 'handover' then
    update public.custody_rental_items set condition_out = coalesce(nullif(p_condition,''), condition_out) where id = p_item;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- إكمال التسليم — يضيف اشتراط: صورة إجمالية واحدة على الأقل (item_id IS NULL, stage='handover').
create or replace function public.custody_rental_complete_handover(p_request uuid, p_customer_sig text, p_staff_sig text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; it record; v_missing int; v_overall int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('preparing','ready_for_handover') then raise exception 'bad_status'; end if;
  if coalesce(trim(p_customer_sig),'') = '' or coalesce(trim(p_staff_sig),'') = '' then raise exception 'signatures_required'; end if;
  if not exists (select 1 from public.custody_rental_contracts where request_id = p_request and status = 'signed') then raise exception 'contract_not_signed'; end if;
  -- كل بند: حالة قبل التسليم + صورة قطعة.
  select count(*) into v_missing from public.custody_rental_items i
   where i.request_id = p_request and (i.condition_out is null
     or not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'handover'));
  if v_missing > 0 then raise exception 'items_incomplete:%', v_missing; end if;
  -- صورة إجمالية إلزامية.
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'handover' and e.item_id is null;
  if v_overall = 0 then raise exception 'overall_photo_required'; end if;
  for it in select * from public.custody_rental_items where request_id = p_request order by asset_id loop
    perform 1 from public.custody_inventory_assets where id = it.asset_id and is_deleted = false for update;
    if (select quantity_available from public.custody_inventory_assets where id = it.asset_id) < it.quantity then
      raise exception 'insufficient_stock_at_handover:%', it.asset_id;
    end if;
    update public.custody_inventory_assets set quantity_available = quantity_available - it.quantity, updated_by = auth.uid(), updated_at = now() where id = it.asset_id;
    perform public.civ_set_avail(it.asset_id);
    insert into public.custody_inventory_movements(asset_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_by, reference_type, reference_id)
      select it.asset_id, 'rental_out', a2.quantity_available + it.quantity, -it.quantity, a2.quantity_available, 'تأجير '||r.request_number, auth.uid(), 'rental', p_request
      from public.custody_inventory_assets a2 where a2.id = it.asset_id;
    update public.custody_rental_items set status = 'issued' where id = it.id;
  end loop;
  update public.custody_rental_requests set status = 'active', actual_handover_at = now(), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'active', auth.uid(), 'handover complete');
  perform public.civ_notify_managers('rental_activated', p_request, 'تفعيل تأجير '||r.request_number, 'Rental activated '||r.request_number);
  return jsonb_build_object('ok', true);
end; $$;

-- إكمال الإرجاع — يضيف اشتراط صورة إرجاع إجمالية (item_id IS NULL, stage='return_inspection').
create or replace function public.custody_rental_complete_return(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_pending int; v_overall int;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'inspection_pending' then raise exception 'bad_status'; end if;
  select count(*) into v_pending from public.custody_rental_items where request_id = p_request and status in ('issued','return_requested');
  if v_pending > 0 then raise exception 'items_not_inspected:%', v_pending; end if;
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'return_inspection' and e.item_id is null;
  if v_overall = 0 then raise exception 'overall_return_photo_required'; end if;
  update public.custody_rental_requests set status = 'charges_pending', actual_return_at = now(), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id) values (p_request, r.status, 'charges_pending', auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) الصلاحيات (revoke من public/anon، grant للمستخدمين المصادَقين)
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_availability(uuid,timestamptz,timestamptz,numeric)',
    'custody_rental_recheck(uuid)','custody_rental_submit(uuid)','custody_rental_approve(uuid,text)',
    'custody_rental_reject(uuid,text)','custody_rental_request_revision(uuid,text)',
    'custody_rental_admin_search_clients(text,integer,integer)','custody_rental_admin_link_portal_client(uuid)',
    'custody_rental_customer_create_request(jsonb)','custody_rental_customer_add_item(uuid,uuid,numeric)',
    'custody_rental_customer_submit(uuid)','custody_rental_customer_available_assets(timestamptz,timestamptz,text)',
    'custody_rental_add_evidence(uuid,uuid,text,text,text,text)','custody_rental_complete_handover(uuid,text,text)',
    'custody_rental_complete_return(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
-- دوال داخلية فقط (تُستدعى من دوال definer) — اسحبها من authenticated/public/anon.
revoke execute on function public.custody_rental_recheck(uuid) from authenticated;
revoke all on function public.custody_rental_free_qty(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;
commit;

-- إعادة تحميل مخطط PostgREST.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Validation (SELECT فقط)
-- ════════════════════════════════════════════════════════════════════════════
select 'new_columns' as k,
  (select count(*) from information_schema.columns where table_name='custody_rental_requests' and column_name in ('delivery_location','return_location','rejection_reason','renter_message')) as request_cols;
select 'uq_customer_user' as k, count(*) as n from pg_indexes where indexname='uq_rental_customer_user';
select 'hotfix_rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'custody_rental_submit','custody_rental_approve','custody_rental_reject','custody_rental_request_revision',
  'custody_rental_admin_search_clients','custody_rental_admin_link_portal_client','custody_rental_customer_create_request',
  'custody_rental_customer_add_item','custody_rental_customer_submit','custody_rental_customer_available_assets',
  'custody_rental_add_evidence','custody_rental_recheck')
order by p.proname;
select 'availability_rich' as k,
  (to_regprocedure('public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric)') is not null) as exists;


-- ╔════ PART: rental_rpc_signatures_and_availability_HOTFIX_RUNME.sql ════╗

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


-- ╔════ PART: rental_client_linking_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — CLIENT LINKING HOTFIX (إصلاح اختيار وربط عميل البوابة)
-- ────────────────────────────────────────────────────────────────────────────
-- العطل الحي: عند الضغط على عميل غير مرتبط تظهر «الخدمة غير مهيأة بعد» لأن دالة الربط
--   custody_rental_admin_link_portal_client غير موجودة في مخزّن مخطط PostgREST المطبّق
--   (كانت ضمن الـHotfix التشغيلي غير المطبّق) — أو باسم بارامتر قديم (p_profile).
-- الحل: توقيع قانوني نهائي p_profile_id uuid + منع التكرار عبر unique index + تطبيع الرد.
-- idempotent · غير هدّام · لا يحذف عملاء/طلبات · لا يعيد Foundation · بلا Fixtures.
-- صالح على قاعدة Production الحالية. الخطوة اليدوية الوحيدة لهذا الإصلاح = تشغيله كاملًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight: فحص الـschema الفعلي (متطلبات موجودة مسبقًا) ───
do $$
begin
  if to_regclass('public.custody_rental_customers') is null or to_regclass('public.profiles') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.civ_can_manage()') is null or to_regprocedure('public.civ_can_admin()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة (طبّق custody_inventory v1).';
  end if;
  -- تأكيد الأعمدة الفعلية على custody_rental_customers (user_id مفتاح الربط الثابت).
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_customers' and column_name='user_id') then
    raise exception 'PREFLIGHT FAILED — custody_rental_customers.user_id مفقود (schema غير متوقّع).';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;

-- ─── 1) مفتاح منع التكرار: عميل تأجير واحد لكل مستخدم بوابة (idempotent) ───
create unique index if not exists uq_rental_customer_user on public.custody_rental_customers(user_id) where user_id is not null;

-- ─── 2) إزالة أي توقيع قديم متعارض بالأنواع صراحةً (اسم البارامتر تغيّر p_profile→p_profile_id،
--        وCREATE OR REPLACE لا يغيّر اسم بارامتر لنفس الأنواع ⇒ يلزم DROP بالتوقيع). لا DROP بالاسم فقط. ───
drop function if exists public.custody_rental_admin_link_portal_client(uuid);

-- ─── 3) التوقيع القانوني النهائي ───
create function public.custody_rental_admin_link_portal_client(p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare pr record; v_id uuid; v_party text;
begin
  -- الدور: owner/super_admin/admin/manager فقط. يمنع client/employee/anon.
  if not (public.civ_can_admin() or public.civ_can_manage()) then raise exception 'not authorized'; end if;
  -- تُقرأ بيانات العميل داخليًا من profiles (لا تُستقبل من المتصفح).
  select id, full_name, company, email, mobile, account_type, account_status into pr
    from public.profiles where id = p_profile_id;
  if pr.id is null then raise exception 'profile_not_found'; end if;
  if pr.account_status <> 'active' or pr.account_type not in ('client','admin') then raise exception 'invalid_account'; end if;
  v_party := case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end;
  -- إعادة استخدام السجل الموجود إن وُجد؛ وإلا إنشاء سجل واحد (upsert بمفتاح ثابت — لا تكرار).
  --   عند التعارض لا نُصفّي بيانات السجل القائم — نكتفي بلمسة updated_at ثم نعيد id نفسه.
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (p_profile_id, v_party, coalesce(nullif(trim(pr.full_name),''), pr.email, 'عميل'), nullif(trim(pr.company),''), pr.mobile, pr.email, auth.uid())
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_id;
  -- الرد القانوني الثابت (بيانات العميل من profiles للتعبئة التلقائية).
  return jsonb_build_object(
    'rental_customer_id', v_id, 'profile_id', pr.id, 'full_name', pr.full_name,
    'company', pr.company, 'email', pr.email, 'mobile', pr.mobile, 'account_type', pr.account_type);
end; $$;

-- ─── 4) الصلاحيات ───
revoke all on function public.custody_rental_admin_link_portal_client(uuid) from public, anon;
grant execute on function public.custody_rental_admin_link_portal_client(uuid) to authenticated;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Validation (SELECT/DO فقط) — يثبت التوقيع والصلاحيات والفهرس ومنع التكرار
-- ════════════════════════════════════════════════════════════════════════════
-- (1) نسخة واحدة فقط + التوقيع p_profile_id uuid:
select 'link_fn' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args, count(*) over () as versions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='custody_rental_admin_link_portal_client';
-- (3,4) Execute: authenticated=نعم، anon=لا:
select 'grants' as k, r.rolname, has_function_privilege(r.rolname, to_regprocedure('public.custody_rental_admin_link_portal_client(uuid)'), 'execute') as can_exec
from (values ('authenticated'),('anon')) r(rolname);
-- (5) فهرس منع التكرار موجود:
select 'unique_index' as k, indexname from pg_indexes where schemaname='public' and indexname='uq_rental_customer_user';
-- (6) لا تكرار حالي على user_id:
select 'dup_check' as k, coalesce(max(cnt),0) as max_per_user from (
  select user_id, count(*) cnt from public.custody_rental_customers where user_id is not null group by user_id) t;
-- (7,8) اختبار حي (يُلتقط الخطأ إن نُفّذ بلا JWT في محرّر SQL — لا يوقف الـValidation):
do $$
declare v_prof uuid; v1 jsonb; v2 jsonb;
begin
  select id into v_prof from public.profiles where account_status='active' and account_type in ('client','admin') limit 1;
  if v_prof is null then raise notice 'link sample: no eligible profile'; return; end if;
  begin
    v1 := public.custody_rental_admin_link_portal_client(v_prof);
    v2 := public.custody_rental_admin_link_portal_client(v_prof);  -- ثانية = يجب نفس المعرّف (لا تكرار)
    raise notice 'link sample: id1=% id2=% same=%', v1->>'rental_customer_id', v2->>'rental_customer_id', (v1->>'rental_customer_id') = (v2->>'rental_customer_id');
  exception when others then
    raise notice 'link sample skipped (%). الدالة موجودة؛ نفّذ الاختبار الحي من التطبيق بحساب مدير.', sqlerrm;
  end;
end $$;


-- ╔════ PART: rental_renter_binding_evidence_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — RENTER LEGAL-BINDING + EVIDENCE HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- يجعل طلب المستأجر ملزِمًا قانونيًا ومُوثَّقًا عند الإنشاء:
--   • هوية إلزامية: الاسم الكامل + الجوال + نوع/رقم الهوية + العنوان.
--   • توقيع إقرار/عقد قانوني من حساب المستأجر عند إنشاء الطلب.
--   • صورة إلزامية لكل معدة (حد أدنى 1) + صورة إجمالية (حد أدنى 1) عند الإنشاء.
--   • اختيار المعدة بالباركود/QR/الكود.
--   • تذكير قبل موعد التسليم (بوابة+إيميل) — يشغّله الكرون اليومي (دقة تقريبية).
-- idempotent · غير هدّام · لا يحذف طلبات/عملاء · لا يعيد Foundation · بلا Fixtures.
-- يُشغَّل بعد ملفات التأجير الحالية. الخطوة اليدوية الوحيدة لهذا الإصلاح = تشغيله كاملًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null or to_regclass('public.custody_rental_evidence') is null
     or to_regclass('public.custody_rental_customers') is null or to_regclass('public.custody_inventory_assets') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.civ_flag(text)') is null or to_regprocedure('public.civ_client_ip()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة.';
  end if;
  -- يعتمد على الطبقة التشغيلية (free_qty/recheck) — طبّق الـHotfix التشغيلي أولًا.
  if to_regprocedure('public.custody_rental_free_qty(uuid,timestamptz,timestamptz,uuid)') is null
     or to_regprocedure('public.custody_rental_recheck(uuid)') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_portal_operational_HOTFIX_RUNME.sql أولًا (custody_rental_free_qty/recheck مفقودة).';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;

-- ─── 1) أعمدة الإقرار/التوقيع عند الإنشاء + التذكير + توسيع مراحل الأدلة ───
alter table public.custody_rental_requests add column if not exists consent_signature_path text;
alter table public.custody_rental_requests add column if not exists consent_signed_at       timestamptz;
alter table public.custody_rental_requests add column if not exists consent_text            text;
alter table public.custody_rental_requests add column if not exists consent_ip              text;
alter table public.custody_rental_requests add column if not exists consent_ua              text;
alter table public.custody_rental_requests add column if not exists reminder_sent_at        timestamptz;

-- توسيع مراحل الأدلة: request (صور الإنشاء) + closeout (صور الإقفال) — مع الحفاظ على السابق.
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
commit;

-- ─── 2) دليل مرحلة الإنشاء للمستأجر (ملكيته فقط) ───
begin;
create or replace function public.custody_rental_customer_add_request_evidence(p_request uuid, p_item uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if p_item is not null and not exists (select 1 from public.custody_rental_items where id = p_item and request_id = p_request) then raise exception 'item_not_in_request'; end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, uploaded_by)
    values (p_request, p_item, 'request', p_path, auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
commit;

-- ─── 3) البحث عن معدة بالباركود/QR/الكود للمستأجر (أعمدة آمنة + توفّر) ───
begin;
create or replace function public.custody_rental_customer_lookup_asset(p_code text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_free numeric; v_photo text; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  v_code := nullif(trim(coalesce(p_code,'')),'');
  if v_code is null then raise exception 'code_required'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'end_before_start'; end if;
  select id, asset_code, asset_name, asset_type, serial_number, quantity_total, availability_status
    into a from public.custody_inventory_assets
   where is_deleted = false and (lower(barcode) = lower(v_code) or lower(qr_code_value) = lower(v_code) or lower(asset_code) = lower(v_code))
   limit 1;
  if a.id is null then return jsonb_build_object('found', false); end if;
  v_free := public.custody_rental_free_qty(a.id, p_from, p_to);
  select file_path into v_photo from public.custody_inventory_asset_files
    where asset_id = a.id and is_deleted = false and file_type = 'asset_photo' order by is_primary desc nulls last, created_at desc limit 1;
  return jsonb_build_object('found', true, 'asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'asset_type', a.asset_type, 'serial_number', a.serial_number, 'total_quantity', a.quantity_total,
    'available_quantity', greatest(coalesce(v_free,0),0), 'is_available', coalesce(v_free,0) > 0,
    'catalog_photo_path', v_photo, 'availability_status', a.availability_status);
end; $$;
commit;

-- ─── 3b) نص الإقرار/العقد للعرض للمستأجر (settings محمي بالـRLS للمدراء؛ هذا RPC آمن للقراءة) ───
create or replace function public.custody_rental_consent_text() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_terms text; v_ver int; v_curr text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select contract_terms_ar, contract_version, currency into v_terms, v_ver, v_curr from public.custody_rental_settings where id = 1;
  return jsonb_build_object('consent_text', coalesce(v_terms,''), 'version', coalesce(v_ver,1), 'currency', coalesce(v_curr,'SAR'));
end; $$;

-- ─── 4) إنشاء طلب المستأجر — يحفظ الهوية + الإقرار + البنود، ويعيد معرّفات البنود ───
--     لا يُرسِل تلقائيًا (الصور تُرفع بعد الإنشاء ثم يُستدعى submit الذي يتحقق من كل شيء).
begin;
create or replace function public.custody_rental_customer_create_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; pr record; v_cust uuid; v_from timestamptz; v_to timestamptz; v_no text; v_req uuid; it jsonb; av numeric; v_items jsonb := '[]'::jsonb; v_item uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not authorized'; end if;
  v_from := nullif(p_data->>'rental_from','')::timestamptz;
  v_to   := nullif(p_data->>'rental_to','')::timestamptz;
  if v_from is null then raise exception 'invalid_start'; end if;
  if v_to   is null then raise exception 'invalid_end'; end if;
  if v_to <= v_from then raise exception 'end_before_start'; end if;
  -- عميل التأجير المرتبط (upsert بمفتاح ثابت) + حفظ الهوية المُدخلة.
  select id, full_name, company, email, mobile into pr from public.profiles where id = v_uid;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (v_uid, case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end,
            coalesce(nullif(trim(p_data->>'full_name'),''), nullif(trim(pr.full_name),''), pr.email, 'مستأجر'),
            nullif(trim(pr.company),''), coalesce(nullif(trim(p_data->>'phone'),''), pr.mobile), pr.email, v_uid)
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_cust;
  -- تحديث حقول الهوية على العميل (لا تُصفّى القيم القائمة إن لم تُرسَل).
  update public.custody_rental_customers set
    full_name = coalesce(nullif(trim(p_data->>'full_name'),''), full_name),
    phone     = coalesce(nullif(trim(p_data->>'phone'),''), phone),
    id_type   = coalesce(nullif(p_data->>'id_type',''), id_type),
    id_number_ref = coalesce(nullif(trim(p_data->>'id_number_ref'),''), id_number_ref),
    address   = coalesce(nullif(trim(p_data->>'address'),''), address), updated_at = now()
  where id = v_cust;
  -- المسودة + الإقرار (إن أُرسل توقيعه الآن).
  v_no := public.civ_gen_no('RNT');
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, delivery_location, return_location, purpose, customer_note,
      consent_signature_path, consent_text, consent_signed_at, consent_ip, consent_ua, created_by)
    values (v_no, v_cust, 'draft', v_from, v_to, nullif(trim(p_data->>'delivery_location'),''), nullif(trim(p_data->>'return_location'),''),
            nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'customer_note'),''),
            nullif(trim(p_data->>'consent_signature_path'),''), nullif(trim(p_data->>'consent_text'),''),
            case when nullif(trim(p_data->>'consent_signature_path'),'') is not null then now() else null end,
            case when nullif(trim(p_data->>'consent_signature_path'),'') is not null then public.civ_client_ip() else null end,
            left(nullif(trim(p_data->>'consent_ua'),''),400), v_uid)
    returning id into v_req;
  insert into public.custody_rental_events(request_id, to_status, actor_id, reason) values (v_req, 'draft', v_uid, 'customer_created');
  -- البنود (مع فحص توفّر) — تعيد معرّفاتها لربط الصور.
  if jsonb_typeof(p_data->'items') = 'array' then
    for it in select * from jsonb_array_elements(p_data->'items') loop
      if (it->>'asset_id') is not null then
        perform 1 from public.custody_inventory_assets where id = (it->>'asset_id')::uuid and is_deleted = false for update;
        av := public.custody_rental_free_qty((it->>'asset_id')::uuid, v_from, v_to);
        if av < coalesce((it->>'quantity')::numeric,1) then raise exception 'quantity_unavailable:%', it->>'asset_id'; end if;
        insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status)
          values (v_req, (it->>'asset_id')::uuid, coalesce((it->>'quantity')::numeric,1), coalesce((it->>'quantity')::numeric,1), 'reserved')
          returning id into v_item;
        v_items := v_items || jsonb_build_object('item_id', v_item, 'asset_id', (it->>'asset_id')::uuid, 'quantity', coalesce((it->>'quantity')::numeric,1));
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_req, 'request_number', v_no, 'status', 'draft', 'items', v_items);
end; $$;

-- ─── 5) إرسال المستأجر — يضبط الإقرار (إن أُرسل) ثم يتحقق: هوية + بند + صورة لكل بند +
--        صورة إجمالية + توقيع الإقرار. توقيع موسّع (drop لتغيّر عدد الوسائط). ───
drop function if exists public.custody_rental_customer_submit(uuid);
create or replace function public.custody_rental_customer_submit(p_request uuid, p_consent_signature_path text default null, p_consent_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c record; v_missing int; v_overall int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers cc on cc.id = req.customer_id
    where req.id = p_request and cc.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if r.rental_from is null or r.rental_to is null or r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  -- ضبط توقيع الإقرار الآن إن أُرسل (يُوقَّع في مرحلة الصور بعد إنشاء المسودة).
  if nullif(trim(p_consent_signature_path),'') is not null then
    update public.custody_rental_requests set consent_signature_path = trim(p_consent_signature_path),
      consent_text = coalesce(nullif(trim(p_consent_text),''), consent_text), consent_signed_at = now(),
      consent_ip = public.civ_client_ip(), updated_at = now() where id = p_request;
    r.consent_signature_path := trim(p_consent_signature_path);
  end if;
  -- هوية إلزامية كاملة.
  select * into c from public.custody_rental_customers where id = r.customer_id;
  if coalesce(trim(c.full_name),'') = '' or coalesce(trim(c.phone),'') = '' or coalesce(c.id_type,'') = ''
     or coalesce(trim(c.id_number_ref),'') = '' or coalesce(trim(c.address),'') = '' then
    raise exception 'identity_incomplete';
  end if;
  -- بند واحد على الأقل.
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  -- صورة لكل بند (مرحلة request).
  select count(*) into v_missing from public.custody_rental_items i
    where i.request_id = p_request and not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'request');
  if v_missing > 0 then raise exception 'item_photo_required:%', v_missing; end if;
  -- صورة إجمالية واحدة على الأقل.
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'request' and e.item_id is null;
  if v_overall = 0 then raise exception 'overall_photo_required'; end if;
  -- توقيع الإقرار القانوني.
  if coalesce(trim(r.consent_signature_path),'') = '' then raise exception 'consent_required'; end if;
  -- إعادة فحص التوفّر (منع الحجز المزدوج).
  perform public.custody_rental_recheck(p_request);
  update public.custody_rental_requests set status = 'pending_approval', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'draft', 'pending_approval', auth.uid(), 'customer_submitted');
  perform public.civ_notify_managers('rental_request_created', p_request, 'طلب تأجير جديد من مستأجر '||r.request_number, 'New self-service rental '||r.request_number);
  if c.user_id is not null then perform public.civ_notify(c.user_id, 'rental_request_created', p_request, 'تم استلام طلب تأجيرك '||r.request_number||' وسيُراجَع', 'Your rental request was received '||r.request_number); end if;
  return jsonb_build_object('ok', true, 'status', 'pending_approval');
end; $$;
commit;

-- ─── 6) تذكير قبل موعد التسليم (بوابة + قائمة للإيميل) — idempotent عبر reminder_sent_at ───
--     يشغّله الكرون اليومي. دقة تقريبية (نافذة p_window_hours). خدمة (uid=null) أو مدير.
begin;
create or replace function public.custody_rental_due_reminders(p_window_hours int default 2) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_out jsonb := '[]'::jsonb; v_win interval;
begin
  if auth.uid() is not null and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_win := (greatest(coalesce(p_window_hours,2),1) || ' hours')::interval;
  for r in
    select req.id, req.request_number, req.rental_from, c.user_id as cust_uid, c.email as cust_email, c.full_name, c.company_name
      from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
     where req.status in ('approved','contract_pending_signature','scheduled','preparing','ready_for_handover')
       and req.rental_from is not null and req.rental_from > now() and req.rental_from <= now() + v_win
       and req.reminder_sent_at is null
  loop
    perform public.civ_notify_managers('rental_due_soon', r.id, 'قرب موعد تسليم تأجير '||r.request_number, 'Rental handover due soon '||r.request_number);
    if r.cust_uid is not null then perform public.civ_notify(r.cust_uid, 'rental_due_soon', r.id, 'تنبيه: موعد استلام تأجيرك '||r.request_number||' قريب', 'Reminder: your rental handover '||r.request_number||' is due soon'); end if;
    update public.custody_rental_requests set reminder_sent_at = now() where id = r.id;
    v_out := v_out || jsonb_build_object('request_id', r.id, 'request_number', r.request_number, 'rental_from', r.rental_from,
      'customer_email', r.cust_email, 'customer_user_id', r.cust_uid, 'party_name', coalesce(r.company_name, r.full_name));
  end loop;
  return jsonb_build_object('ok', true, 'reminded', jsonb_array_length(v_out), 'due', v_out);
end; $$;
commit;

-- ─── 6b) تخزين: يسمح للمستأجر المصادَق بكتابة أدلة الإنشاء + توقيع الإقرار (write-only)
--        داخل bucket rental-evidence تحت مسار rental/ فقط. القراءة تبقى للمدراء (سياسة SELECT
--        القائمة دون تغيير). السجل في القاعدة (add_request_evidence) هو البوابة الحقيقية. ───
begin;
drop policy if exists "rental evidence renter write" on storage.objects;
create policy "rental evidence renter write" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-evidence' and (storage.foldername(name))[1] = 'rental');
commit;

-- ─── 7) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_customer_add_request_evidence(uuid,uuid,text)',
    'custody_rental_customer_lookup_asset(text,timestamptz,timestamptz)',
    'custody_rental_consent_text()',
    'custody_rental_customer_create_request(jsonb)','custody_rental_customer_submit(uuid,text,text)',
    'custody_rental_due_reminders(integer)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'new_request_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_requests'
  and column_name in ('consent_signature_path','consent_signed_at','consent_text','reminder_sent_at');
select 'evidence_stages' as k, pg_get_constraintdef(oid) as def from pg_constraint where conname='custody_rental_evidence_stage_check';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_customer_add_request_evidence','custody_rental_customer_lookup_asset',
   'custody_rental_customer_create_request','custody_rental_customer_submit','custody_rental_due_reminders')
order by p.proname;
select 'grants' as k, p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_customer_add_request_evidence','custody_rental_customer_lookup_asset','custody_rental_due_reminders');


-- ╔════ PART: rental_damage_invoice_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — DAMAGE SETTLEMENT + AUTO-INVOICE HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- يكمل الدورة المالية للتلف:
--   • أنواع ضرر أوسع (dirty/scratch/dent/broken + السابقة) + اعتراض العميل.
--   • خصم الضرر من التأمين (موجود) + إن تجاوز التأمين أو غاب ⇒ فاتورة تلقائية للفرق
--     داخل جدول invoices الحالي (لا نظام مالي موازٍ)، مصدر rental_damage_charge،
--     ready_for_zoho=true، لا يتوقف الإقفال على Zoho.
--   • المستأجر يرى فاتورته (رقم/مبلغ/حالة/PDF) عبر RLS القياسي + RPC آمن.
-- idempotent · غير هدّام · لا يحذف بيانات · لا يعيد Foundation · بلا Fixtures.
-- يُشغَّل بعد ملفات التأجير + بعد نظام الفواتير. خلف علم rental_finance_enabled.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_charges') is null or to_regclass('public.custody_rental_requests') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if to_regclass('public.invoices') is null then
    raise exception 'PREFLIGHT FAILED — جدول invoices غير موجود (طبّق نظام الفواتير أولًا).';
  end if;
  if to_regprocedure('public.civ_gen_no(text)') is null or to_regprocedure('public.civ_can_finance()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) أعمدة الربط على invoices + الرسوم ───
alter table public.invoices add column if not exists source             text;
alter table public.invoices add column if not exists rental_id          uuid;
alter table public.invoices add column if not exists rental_customer_id uuid;
alter table public.invoices add column if not exists rental_claim_id    uuid;
alter table public.invoices add column if not exists ready_for_zoho     boolean not null default false;
alter table public.invoices add column if not exists description        text;
create index if not exists idx_invoices_rental on public.invoices(rental_id) where rental_id is not null;

alter table public.custody_rental_charges add column if not exists invoice_id uuid;
alter table public.custody_rental_charges add column if not exists objection  text;
-- توسيع أنواع الضرر (مع الحفاظ على السابق).
alter table public.custody_rental_charges drop constraint if exists custody_rental_charges_charge_type_check;
alter table public.custody_rental_charges add constraint custody_rental_charges_charge_type_check
  check (charge_type in ('damage','missing_item','missing_accessory','late_return','misuse','cleaning','other',
    'dirty','scratch','dent','broken'));
commit;

-- ─── 2) اعتماد الرسم + خصم التأمين + فاتورة تلقائية للفرق ───
begin;
create or replace function public.custody_rental_approve_charge(p_charge uuid, p_approved numeric, p_from_deposit numeric default 0, p_additional numeric default 0, p_reject boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch record; r record; v_remaining numeric; v_apply numeric; v_approved numeric; v_due numeric;
        v_inv uuid; v_no text; v_vatrate numeric; v_vat numeric; v_client uuid; v_uid uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_finance() then raise exception 'not authorized: finance only'; end if;
  select * into ch from public.custody_rental_charges where id = p_charge for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if ch.status <> 'reported' then raise exception 'already_decided'; end if;
  if p_reject then
    update public.custody_rental_charges set status = 'rejected', approved_by = auth.uid(), updated_at = now() where id = p_charge;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  v_approved := greatest(0, coalesce(p_approved,0));
  select * into r from public.custody_rental_requests where id = ch.request_id for update;
  v_remaining := greatest(0, r.deposit_received - r.deposit_applied - r.deposit_released);
  v_apply := least(greatest(0, coalesce(p_from_deposit,0)), v_remaining, v_approved);
  v_due := greatest(0, v_approved - v_apply);
  update public.custody_rental_charges set status = 'approved', approved_amount = v_approved,
    from_deposit = v_apply, additional_due = v_due, approved_by = auth.uid(), updated_at = now() where id = p_charge;
  -- خصم التأمين + تحديث حالته (partially/fully_applied حسب المتبقّي).
  if v_apply > 0 then
    update public.custody_rental_requests set deposit_applied = r.deposit_applied + v_apply,
      deposit_status = case
        when (r.deposit_received - (r.deposit_applied + v_apply) - r.deposit_released) <= 0 and r.deposit_received > 0 then 'fully_applied'
        when r.deposit_status in ('held','received') then 'partially_applied' else r.deposit_status end,
      updated_at = now() where id = ch.request_id;
  end if;
  -- فاتورة تلقائية للفرق (إن وُجد) — داخل invoices الحالي، خلف علم المالية.
  if v_due > 0 and public.civ_flag('rental_finance_enabled') then
    v_vatrate := coalesce(r.vat_rate, 15);
    v_vat := round(v_due * v_vatrate / 100.0, 2);
    v_no := public.civ_gen_no('RINV');
    -- ربط بعميل الفواتير إن كان للمستأجر حساب clients (وإلا يبقى null ويُقرأ عبر RPC التأجير الآمن).
    select cc.user_id into v_uid from public.custody_rental_customers cc where cc.id = r.customer_id;
    if v_uid is not null then select cl.id into v_client from public.clients cl where cl.user_id = v_uid and cl.is_deleted = false limit 1; end if;
    insert into public.invoices(invoice_number, client_id, status, currency, subtotal, vat, total,
        public_portal_visible, source, rental_id, rental_customer_id, rental_claim_id, description, ready_for_zoho, created_by)
      values (v_no, v_client, 'draft', coalesce(r.currency,'SAR'), v_due, v_vat, v_due + v_vat,
        true, 'rental_damage_charge', r.id, r.customer_id, p_charge,
        'فاتورة تلف تأجير '||r.request_number||coalesce(' — '||ch.description,''), true, auth.uid())
      returning id into v_inv;
    update public.custody_rental_charges set invoice_id = v_inv where id = p_charge;
    perform public.civ_notify_managers('rental_charges_pending', r.id, 'فاتورة تلف تأجير '||r.request_number||' بمبلغ '||(v_due + v_vat), 'Rental damage invoice '||r.request_number);
    if v_uid is not null then perform public.civ_notify(v_uid, 'rental_charges_pending', r.id, 'صدرت فاتورة أضرار على تأجيرك '||r.request_number||' بمبلغ '||(v_due + v_vat), 'A damage invoice was issued '||r.request_number); end if;
  end if;
  begin perform public.custody_audit('rental_charge_approved','custody_rental_charge', p_charge, jsonb_build_object('approved', v_approved, 'from_deposit', v_apply, 'additional_due', v_due, 'invoice', v_inv)); exception when others then null; end;
  return jsonb_build_object('ok', true, 'status', 'approved', 'from_deposit', v_apply, 'additional_due', v_due, 'invoice_id', v_inv);
end; $$;
commit;

-- ─── 3) تسجيل ضرر مع اعتراض العميل (توسيع add_charge غير مطلوب — objection يُضاف عبر RPC) ───
begin;
create or replace function public.custody_rental_charge_objection(p_charge uuid, p_objection text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch record; r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into ch from public.custody_rental_charges where id = p_charge;
  if ch.id is null then raise exception 'not_found'; end if;
  -- المستأجر صاحب الطلب أو الإدارة.
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = ch.request_id and (c.user_id = auth.uid() or public.civ_can_manage() or public.civ_can_finance());
  if r.id is null then raise exception 'not authorized'; end if;
  if coalesce(trim(p_objection),'') = '' then raise exception 'objection_required'; end if;
  update public.custody_rental_charges set objection = trim(p_objection), updated_at = now() where id = p_charge;
  perform public.civ_notify_managers('rental_damage_reported', ch.request_id, 'اعتراض على رسم تأجير', 'Charge objection');
  return jsonb_build_object('ok', true);
end; $$;

-- ─── 4) قراءة فواتير المستأجر لطلبه (آمنة — للمستأجر الخارجي بلا حساب clients) ───
create or replace function public.custody_rental_customer_invoices(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select exists (select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid()) into v_ok;
  if not v_ok then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'invoice_number', i.invoice_number, 'status', i.status, 'currency', i.currency,
    'subtotal', i.subtotal, 'vat', i.vat, 'total', i.total, 'pdf_url', i.pdf_url,
    'description', i.description, 'created_at', i.created_at) order by i.created_at desc)
    from public.invoices i where i.rental_id = p_request and i.source = 'rental_damage_charge' and not i.is_deleted), '[]'::jsonb);
end; $$;
commit;

-- ─── 5) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_approve_charge(uuid,numeric,numeric,numeric,boolean)',
    'custody_rental_charge_objection(uuid,text)',
    'custody_rental_customer_invoices(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'invoice_rental_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='invoices' and column_name in ('source','rental_id','rental_claim_id','ready_for_zoho');
select 'charge_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_charges' and column_name in ('invoice_id','objection');
select 'charge_types' as k, pg_get_constraintdef(oid) as def from pg_constraint where conname='custody_rental_charges_charge_type_check';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_approve_charge','custody_rental_charge_objection','custody_rental_customer_invoices')
order by p.proname;


-- ╔════ PART: rental_request_evidence_upload_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — REQUEST EVIDENCE UPLOAD HOTFIX (إصلاح رفع صور الطلب)
-- ────────────────────────────────────────────────────────────────────────────
-- العطل الحي: «تعذر رفع الصورة» — سببان: (1) bucket rental-evidence يقبل jpeg/png/webp
--   فقط فيرفض HEIC/HEIF (صور iPhone) وحدّ 10MB؛ (2) سياسة كتابة المستأجر غير مطبّقة/غير
--   محدّدة النطاق. الحل: توسيع MIME/الحجم + سياسات مُحكمة (موظف أي مسار / المستأجر مسارات
--   طلبه فقط) + RPC إرفاق موحّدة (تحقّق مسار/تكرار/وجود الملف/عدم الإغلاق) + RPC حذف قبل
--   الإرسال + RPC اكتمال. (العميل يطبّع الصور إلى JPEG قبل الرفع أيضًا.)
-- idempotent · غير هدّام · لا يحذف صورًا/طلبات · لا يعيد Foundation · بلا Fixtures.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null or to_regclass('public.custody_rental_evidence') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_evidence' and column_name='stage') then
    raise exception 'PREFLIGHT FAILED — custody_rental_evidence.stage مفقود.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) توسيع صيغ/حجم bucket rental-evidence (+HEIC/HEIF، 20MB) ───
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'],
       file_size_limit = 20971520
 where id = 'rental-evidence';

-- منع تكرار سطر دليل بنفس المسار (idempotent + retry آمن).
create unique index if not exists uq_rental_evidence_path on public.custody_rental_evidence(file_path);
create index if not exists idx_rental_evidence_stage on public.custody_rental_evidence(request_id, stage);
-- ضمان أن مرحلة 'request' مسموحة (لو طُبّق هذا الملف قبل binding) — superset، لا قيمة محذوفة.
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
commit;

-- ─── 2) سياسات Storage مُحكمة (تستبدل السياسات السابقة) ───
begin;
-- ملكية مسار: (storage.foldername(name))[2] = rental_id، والمستخدم صاحب هذا الطلب.
drop policy if exists "rental evidence write"        on storage.objects;
drop policy if exists "rental evidence renter write" on storage.objects;
drop policy if exists "rental evidence read"         on storage.objects;
drop policy if exists "rental evidence write v2"     on storage.objects;
drop policy if exists "rental evidence read v2"      on storage.objects;
drop policy if exists "rental evidence delete v2"    on storage.objects;

-- INSERT: موظف أي مسار rental/ ، أو المستأجر لمسار طلبه.
create policy "rental evidence write v2" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-evidence' and (storage.foldername(name))[1] = 'rental' and (
    public.civ_can_manage() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.id::text = (storage.foldername(name))[2])));

-- SELECT: موظف/مالية أي مسار، أو المستأجر أدلة طلبه (لتوليد Signed URL لصوره فقط).
create policy "rental evidence read v2" on storage.objects for select to authenticated
  using (bucket_id = 'rental-evidence' and (
    public.civ_can_manage() or public.civ_can_finance() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.id::text = (storage.foldername(name))[2])));

-- DELETE: المستأجر لمسار طلبه ما دام draft (حذف/استبدال قبل الإرسال)، أو موظف.
create policy "rental evidence delete v2" on storage.objects for delete to authenticated
  using (bucket_id = 'rental-evidence' and (
    public.civ_can_manage() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.status = 'draft' and req.id::text = (storage.foldername(name))[2])));
commit;

-- ─── 3) RPC إرفاق دليل موحّدة (مستأجر صاحب الطلب أو موظف) ───
begin;
create or replace function public.custody_rental_add_request_evidence(
  p_rental_id uuid, p_rental_item_id uuid default null, p_evidence_type text default 'item_photo',
  p_storage_path text default null, p_mime_type text default null, p_file_size bigint default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare r record; v_is_staff boolean; v_is_owner boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if p_evidence_type not in ('item_photo','overall_photo') then raise exception 'bad_evidence_type'; end if;
  if coalesce(trim(p_storage_path),'') = '' then raise exception 'path_required'; end if;
  if p_evidence_type = 'item_photo' and p_rental_item_id is null then raise exception 'item_required'; end if;
  if p_evidence_type = 'overall_photo' and p_rental_item_id is not null then raise exception 'overall_no_item'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'not_editable'; end if;
  v_is_staff := public.civ_can_manage();
  v_is_owner := exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid());
  if not (v_is_staff or v_is_owner) then raise exception 'not authorized'; end if;
  -- المستأجر لا يضيف إلا لمسودته.
  if v_is_owner and not v_is_staff and r.status <> 'draft' then raise exception 'not_editable'; end if;
  -- المسار يجب أن يبدأ بمسار هذا الطلب في bucket الأدلة.
  if position('rental/'||p_rental_id::text||'/' in p_storage_path) <> 1 then raise exception 'bad_path'; end if;
  if p_rental_item_id is not null and not exists (select 1 from public.custody_rental_items where id = p_rental_item_id and request_id = p_rental_id) then raise exception 'item_not_in_request'; end if;
  -- تأكيد أن كائن التخزين مرفوع فعلًا (يمنع سجلًا يتيمًا).
  if not exists (select 1 from storage.objects o where o.bucket_id = 'rental-evidence' and o.name = p_storage_path) then raise exception 'storage_object_missing'; end if;
  -- منع التكرار (idempotent / retry آمن) — إن وُجد نفس المسار نعيده ناجحًا.
  if exists (select 1 from public.custody_rental_evidence where file_path = p_storage_path) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, note, uploaded_by)
    values (p_rental_id, p_rental_item_id, 'request', p_storage_path,
            nullif(concat_ws(' ', p_mime_type, case when p_file_size is not null then '('||p_file_size||'B)' end),''), auth.uid());
  return jsonb_build_object('ok', true);
end; $$;

-- حذف دليل مرحلة الإنشاء قبل الإرسال (المستأجر لمسودته أو موظف). لا يحذف كائن التخزين هنا
--   (تتكفّل به الواجهة عبر سياسة DELETE)؛ يزيل سجل القاعدة فقط.
create or replace function public.custody_rental_remove_request_evidence(p_rental_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not (public.civ_can_manage() or exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid())) then raise exception 'not authorized'; end if;
  if not public.civ_can_manage() and r.status <> 'draft' then raise exception 'not_editable'; end if;
  delete from public.custody_rental_evidence where request_id = p_rental_id and stage = 'request' and file_path = p_path;
  return jsonb_build_object('ok', true);
end; $$;

-- حالة اكتمال صور الإنشاء (لعرض المعدات الناقصة صورها).
create or replace function public.custody_rental_request_evidence_status(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; v_items jsonb; v_overall int;
begin
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and (c.user_id = auth.uid() or public.civ_can_manage() or public.civ_can_finance());
  if r.id is null then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'asset_name', a.asset_name, 'asset_code', a.asset_code,
      'has_photo', exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'request'))
    order by a.asset_name), '[]'::jsonb) into v_items
    from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request;
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'request' and e.item_id is null;
  return jsonb_build_object('items', v_items, 'overall_count', v_overall,
    'all_items_have_photo', not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'has_photo')::boolean = false),
    'complete', v_overall > 0 and not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'has_photo')::boolean = false));
end; $$;
commit;

-- ─── 4) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_add_request_evidence(uuid,uuid,text,text,text,bigint)',
    'custody_rental_remove_request_evidence(uuid,text)',
    'custody_rental_request_evidence_status(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'bucket_mime' as k, allowed_mime_types, file_size_limit from storage.buckets where id = 'rental-evidence';
select 'evidence_policies' as k, policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'rental evidence%' order by policyname;
select 'uq_evidence_path' as k, count(*) from pg_indexes where indexname='uq_rental_evidence_path';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_add_request_evidence','custody_rental_remove_request_evidence','custody_rental_request_evidence_status')
order by p.proname;


-- ╔════ PART: rental_evidence_and_return_FINAL_HOTFIX_RUNME.sql ════╗

-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — EVIDENCE (server signed-upload) + CONTROLLED RETURN — FINAL HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- (1) رفع الأدلة عبر مسار خادمي (Signed Upload URL) — لا يعتمد على سياسة Storage
--     للمستأجر. الخادم يوقّع بمفتاح الخدمة ثم يستدعي custody_rental_finalize_evidence
--     (كمستخدم) للتحقق من الملكية/المسار/وجود الكائن/عدم التكرار وإنشاء السطر.
-- (2) دورة إرجاع مضبوطة للمستأجر: طلب إرجاع بصور لكل بند + إجمالية + توقيع، ثم الإدارة/
--     أمين العهدة يفحصون ويغلقون. المستأجر لا يغلق ولا يعيد الأصل available.
-- idempotent · غير هدّام · لا يحذف صورًا/طلبات · لا يعيد Foundation · بلا Fixtures.
-- يعتمد على الطبقة التشغيلية + binding (consent cols) — طبّق ملفات التأجير أولًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_evidence') is null or to_regclass('public.custody_rental_requests') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_requests' and column_name='consent_signature_path') then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_renter_binding_evidence_HOTFIX_RUNME.sql أولًا.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) أعمدة توقيع/ملاحظة الإرجاع + ضمان مراحل الأدلة ───
alter table public.custody_rental_requests add column if not exists return_consent_signature_path text;
alter table public.custody_rental_requests add column if not exists return_consent_signed_at       timestamptz;
alter table public.custody_rental_requests add column if not exists return_note                    text;
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
create unique index if not exists uq_rental_evidence_path on public.custody_rental_evidence(file_path);
commit;

-- ─── 2) finalize موحّد (يُستدعى من /api/rental/evidence/finalize كمستخدم) ───
begin;
create or replace function public.custody_rental_finalize_evidence(
  p_rental_id uuid, p_rental_item_id uuid default null, p_stage text default 'request',
  p_evidence_type text default 'item_photo', p_storage_path text default null,
  p_mime_type text default null, p_file_size bigint default null, p_condition text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare r record; v_is_staff boolean; v_is_owner boolean; v_ok_stage boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if p_stage not in ('request','handover','return_request','return_inspection') then raise exception 'bad_stage'; end if;
  if p_evidence_type not in ('item_photo','overall_photo','signature') then raise exception 'bad_evidence_type'; end if;
  if coalesce(trim(p_storage_path),'') = '' then raise exception 'path_required'; end if;
  if p_evidence_type = 'item_photo' and p_rental_item_id is null then raise exception 'item_required'; end if;
  if p_evidence_type <> 'item_photo' and p_rental_item_id is not null then raise exception 'overall_no_item'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'not_editable'; end if;
  v_is_staff := public.civ_can_manage();
  v_is_owner := exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid());
  if not (v_is_staff or v_is_owner) then raise exception 'not authorized'; end if;
  v_ok_stage := case p_stage
    when 'request'           then (v_is_staff or (v_is_owner and r.status = 'draft'))
    when 'return_request'    then (v_is_staff or (v_is_owner and r.status in ('active','overdue','return_requested')))
    when 'handover'          then (v_is_staff and r.status in ('scheduled','preparing','ready_for_handover'))
    when 'return_inspection' then (v_is_staff and r.status = 'inspection_pending')
    else false end;
  if not v_ok_stage then raise exception 'not_editable'; end if;
  if position('rental/'||p_rental_id::text||'/' in p_storage_path) <> 1 then raise exception 'bad_path'; end if;
  if p_rental_item_id is not null and not exists (select 1 from public.custody_rental_items where id = p_rental_item_id and request_id = p_rental_id) then raise exception 'item_not_in_request'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'rental-evidence' and o.name = p_storage_path) then raise exception 'storage_object_missing'; end if;
  -- التوقيع يُخزَّن على الطلب (لا سطر دليل).
  if p_evidence_type = 'signature' then
    if p_stage = 'request' then
      update public.custody_rental_requests set consent_signature_path = p_storage_path, consent_signed_at = now(), consent_ip = public.civ_client_ip(), updated_at = now() where id = p_rental_id;
    elsif p_stage = 'return_request' then
      update public.custody_rental_requests set return_consent_signature_path = p_storage_path, return_consent_signed_at = now(), updated_at = now() where id = p_rental_id;
    else raise exception 'signature_bad_stage'; end if;
    return jsonb_build_object('ok', true, 'signature', true);
  end if;
  if exists (select 1 from public.custody_rental_evidence where file_path = p_storage_path) then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, condition, note, uploaded_by)
    values (p_rental_id, p_rental_item_id, p_stage, p_storage_path, nullif(p_condition,''),
            nullif(concat_ws(' ', p_mime_type, case when p_file_size is not null then '('||p_file_size||'B)' end),''), auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
commit;

-- ─── 3) طلب إرجاع المستأجر — يتطلب صورة لكل بند + إجمالية + توقيع (لا يُغلق ولا يُرجع available) ───
begin;
create or replace function public.custody_rental_customer_request_return(p_request uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_missing int; v_overall int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('active','overdue') then raise exception 'bad_status'; end if;
  select count(*) into v_missing from public.custody_rental_items i
    where i.request_id = p_request and i.status in ('issued','return_requested')
      and not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'return_request');
  if v_missing > 0 then raise exception 'return_item_photo_required:%', v_missing; end if;
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'return_request' and e.item_id is null;
  if v_overall = 0 then raise exception 'return_overall_photo_required'; end if;
  if coalesce(trim(r.return_consent_signature_path),'') = '' then raise exception 'consent_required'; end if;
  update public.custody_rental_requests set status = 'return_requested', return_note = nullif(trim(p_note),''),
    customer_note = coalesce(nullif(trim(p_note),''), customer_note), updated_at = now() where id = p_request;
  update public.custody_rental_items set status = 'return_requested' where request_id = p_request and status = 'issued';
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'return_requested', auth.uid(), nullif(trim(p_note),''));
  perform public.civ_notify_managers('rental_return_requested', p_request, 'طلب إرجاع تأجير '||r.request_number, 'Return requested '||r.request_number);
  perform public.civ_notify(auth.uid(), 'rental_return_requested', p_request, 'تم استلام طلب إرجاعك '||r.request_number, 'Your return request was received '||r.request_number);
  return jsonb_build_object('ok', true, 'status', 'return_requested');
end; $$;

-- بنود المستأجر (معرّفات آمنة لربط صور الإرجاع بكل معدة).
create or replace function public.custody_rental_customer_items(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid()) then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'asset_name', a.asset_name, 'asset_code', a.asset_code, 'quantity', i.quantity, 'status', i.status) order by a.asset_name)
    from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request), '[]'::jsonb);
end; $$;
commit;

-- ─── 4) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_finalize_evidence(uuid,uuid,text,text,text,text,bigint,text)',
    'custody_rental_customer_request_return(uuid,text)','custody_rental_customer_items(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'return_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_requests' and column_name in ('return_consent_signature_path','return_consent_signed_at','return_note');
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_finalize_evidence','custody_rental_customer_request_return')
order by p.proname;
select 'grants' as k, p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_finalize_evidence','custody_rental_customer_request_return');
