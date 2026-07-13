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

-- ربط/إنشاء عميل تأجير من ملف بوابة — مفتاح ثابت user_id (upsert؛ لا تكرار).
create or replace function public.custody_rental_admin_link_portal_client(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr record; v_id uuid;
begin
  if not (public.civ_can_manage() or public.civ_can_admin()) then raise exception 'not authorized'; end if;
  select id, full_name, company, email, mobile, account_type into pr from public.profiles where id = p_profile and account_status = 'active';
  if pr.id is null then raise exception 'profile_not_found'; end if;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (pr.id, case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end,
            coalesce(nullif(trim(pr.full_name),''), pr.email), nullif(trim(pr.company),''), pr.mobile, pr.email, auth.uid())
  on conflict (user_id) where user_id is not null do update set
    full_name = coalesce(nullif(trim(excluded.full_name),''), public.custody_rental_customers.full_name),
    company_name = coalesce(excluded.company_name, public.custody_rental_customers.company_name),
    phone = coalesce(excluded.phone, public.custody_rental_customers.phone),
    email = coalesce(excluded.email, public.custody_rental_customers.email), updated_at = now()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'customer_id', v_id, 'full_name', pr.full_name, 'company', pr.company, 'email', pr.email, 'phone', pr.mobile,
    'party_type', case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end);
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
