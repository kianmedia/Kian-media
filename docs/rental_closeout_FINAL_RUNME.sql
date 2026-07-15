-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — إغلاق مرحلة تأجير المعدات (آخر التعديلات فوق قاعدة Production الحالية)
-- ────────────────────────────────────────────────────────────────────────────
-- ملف واحد نهائي، idempotent، غير هدّام، بلا Foundation، بلا Fixtures. يشمل فقط ما تبقّى:
--   1) custody_rental_delete(p_rental_id uuid, p_reason text) — التوقيع الصحيح + منطق
--      كامل (تحرير الحجوزات + إرجاع الكمية + movements + حذف آمن حسب FK + Audit + إشعار).
--   2) custody_rental_expire_stale_drafts — انتهاء المسودّة بحسب آخر نشاط (لا يلغي جلسة
--      رفع نشطة): بلا أدلة و updated_at قديم >Nد، أو أي مسودة >6 ساعات.
--   3) توسيع قيد أنواع notifications ليشمل rental_deleted + rental_draft_expired
--      (إعادة إعلان القائمة كاملة + الجديدين — لا حذف لأي نوع).
--   4) grants/revokes + validation + reload schema.
--
-- الصلاحيات: الحذف = civ_can_admin() (المالك/السوبر أدمن/حساب admin) فقط — لا مستأجر
-- ولا موظف ولا أمين عهدة. الإشعارات = نظام notifications الحالي (civ_notify*).
-- التسليم/الإرجاع/الفحص/الإقفال RPCs موجودة ومطبّقة (تحقّقنا حيًا) — لا يُعاد بناؤها.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.civ_can_admin()') is null
     or to_regprocedure('public.civ_can_manage()') is null
     or to_regclass('public.custody_rental_requests') is null
     or to_regclass('public.custody_rental_items') is null then
    raise exception 'PREFLIGHT: أساس التأجير غير مطبّق — شغّل rental_insurance_production_RUNME.sql ثم rental_v1_final_production_RUNME.sql أولًا';
  end if;
end $$;

begin;

-- ═══ 0) إصلاح رفع صور الأدلة للمستأجر (السبب الجذري المُثبَت) ═══
-- سياسات storage للمخزن rental-evidence كانت تتحقق من ملكية المستأجر عبر subquery مباشر
-- على custody_rental_requests — وسياسته النهائية للقراءة = موظفين فقط ⇒ المستأجر لا يقرأ
-- طلبه ⇒ الـEXISTS فارغ ⇒ رفع صورته يُرفض 403. الحل: تحقّق عبر دالة SECURITY DEFINER
-- تتجاوز RLS الطلبات (auth.uid() يبقى المستأجر).
create or replace function public.rental_evidence_is_owner(p_name text, p_draft_only boolean default false)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select exists (
    select 1 from public.custody_rental_requests req
    join public.custody_rental_customers c on c.id = req.customer_id
    where c.user_id = auth.uid()
      and req.id::text = (storage.foldername(p_name))[2]
      and (not p_draft_only or req.status = 'draft'));
$$;
revoke all on function public.rental_evidence_is_owner(text, boolean) from public, anon;
grant  execute on function public.rental_evidence_is_owner(text, boolean) to authenticated;

drop policy if exists "rental evidence write v2" on storage.objects;
create policy "rental evidence write v2" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-evidence' and (storage.foldername(name))[1] = 'rental'
    and (public.civ_can_manage() or public.rental_evidence_is_owner(name, false)));
drop policy if exists "rental evidence read v2" on storage.objects;
create policy "rental evidence read v2" on storage.objects for select to authenticated
  using (bucket_id = 'rental-evidence'
    and (public.civ_can_manage() or public.civ_can_finance() or public.rental_evidence_is_owner(name, false)));
drop policy if exists "rental evidence delete v2" on storage.objects;
create policy "rental evidence delete v2" on storage.objects for delete to authenticated
  using (bucket_id = 'rental-evidence'
    and (public.civ_can_manage() or public.rental_evidence_is_owner(name, true)));

-- ═══ 1) حذف طلب التأجير (المالك/السوبر أدمن/admin) — التوقيع الصحيح ═══
-- نُسقط أي توقيع قديم (uuid) قبل إنشاء التوقيع الجديد (uuid,text) لتفادي Overload يربك Schema Cache.
drop function if exists public.custody_rental_delete(uuid);
create or replace function public.custody_rental_delete(p_rental_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_assets uuid[];
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;   -- المالك/سوبر/admin فقط
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  -- المعدات مع المستأجر: لا حذف مباشر — يجب إتمام الإرجاع/تسجيل المفقود والإقفال أولًا.
  if r.status in ('active','overdue') then raise exception 'active_rental_cannot_be_deleted'; end if;

  -- أصول البنود المحجوزة (لإعادة حساب التوفّر بعد التحرير).
  select array_agg(distinct asset_id) into v_assets from public.custody_rental_items where request_id = p_rental_id;

  -- (أ) تحرير حجوزات المخزون المرتبطة.
  update public.custody_inventory_reservations set status = 'cancelled'
   where id in (select reservation_id from public.custody_rental_items
                where request_id = p_rental_id and reservation_id is not null);
  -- (أ.٢) إعادة الكمية المخصومة فعليًا وقت التسليم للبنود المسحوبة/المطلوب إرجاعها (لم تُفحص بعد).
  --       التسليم يخصم quantity_available؛ الفحص وحده يعيده. البنود reserved لم تُخصم أصلًا
  --       (تُحسب ديناميكيًا)، وreturned/inspected/damaged/missing لا تُعاد هنا (مُعالَجة/مفقودة).
  update public.custody_inventory_assets a
     set quantity_available = a.quantity_available + s.qty
    from (select asset_id, sum(quantity) as qty from public.custody_rental_items
          where request_id = p_rental_id and status in ('issued','return_requested') group by asset_id) s
   where a.id = s.asset_id;
  -- (ب) أي بند ما زال reserved/issued/return_requested → لا يبقى محجوزًا/مسحوبًا بعد الحذف.
  update public.custody_rental_items set status = 'returned'
   where request_id = p_rental_id and status in ('reserved','issued','return_requested');
  -- (ج) إلغاء العقود غير النهائية.
  update public.custody_rental_contracts set status = 'cancelled'
   where request_id = p_rental_id and status in ('draft','signed');

  -- (د) إعادة حساب التوفّر لكل أصل متأثر (الآلية الحالية — تعتمد الكمية/الحالة ديناميكيًا).
  if v_assets is not null and to_regprocedure('public.civ_set_avail(uuid)') is not null then
    perform public.civ_set_avail(a) from unnest(v_assets) a;
  end if;

  -- (هـ) حذف الأبناء بترتيب آمن للمفاتيح (inspections تشير إلى items/contracts بلا cascade).
  delete from public.custody_rental_evidence  where request_id = p_rental_id;
  delete from public.custody_rental_charges   where request_id = p_rental_id;
  if to_regclass('public.custody_rental_inspections') is not null then
    delete from public.custody_rental_inspections
      where item_id     in (select id from public.custody_rental_items     where request_id = p_rental_id)
         or contract_id in (select id from public.custody_rental_contracts where request_id = p_rental_id);
  end if;
  delete from public.custody_rental_items     where request_id = p_rental_id;
  delete from public.custody_rental_contracts where request_id = p_rental_id;
  delete from public.custody_rental_events    where request_id = p_rental_id;
  delete from public.custody_rental_requests  where id = p_rental_id;

  -- (و) Audit + إشعار (best-effort — لا يكسر الحذف).
  perform public.custody_audit('rental_deleted', 'custody_rental_request', p_rental_id,
    jsonb_build_object('request_number', r.request_number, 'status', r.status, 'reason', p_reason));
  perform public.civ_notify_managers('rental_deleted', p_rental_id,
    'حُذف طلب تأجير '||coalesce(r.request_number,'')||' — '||left(p_reason,120),
    'Rental request deleted '||coalesce(r.request_number,''));
  return jsonb_build_object('ok', true, 'deleted', p_rental_id, 'request_number', r.request_number);
end $$;
revoke all on function public.custody_rental_delete(uuid, text) from public, anon;
grant  execute on function public.custody_rental_delete(uuid, text) to authenticated;

-- ═══ 2) انتهاء صلاحية المسودّات بحسب آخر نشاط (لا يلغي جلسة رفع نشطة) ═══
create or replace function public.custody_rental_expire_stale_drafts(p_minutes int default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_n int; v_min int := greatest(15, coalesce(p_minutes, 15)); v_assets uuid[];
begin
  -- مرشّحو الإلغاء: مسودّة بلا أدلة و«آخر نشاط» (updated_at) مضى عليه v_min دقيقة،
  -- أو أي مسودّة مضى عليها 6 ساعات (مهجورة فعليًا حتى لو رُفعت صور). لا نلغي مسودّة
  -- لها أدلة وعمرها < 6 ساعات (جلسة رفع/توقيع نشطة).
  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.custody_rental_requests r
    where r.status = 'draft' and (
      (r.updated_at < now() - make_interval(mins => v_min)
         and not exists (select 1 from public.custody_rental_evidence e where e.request_id = r.id))
      or r.updated_at < now() - interval '6 hours');
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return jsonb_build_object('ok', true, 'expired', 0); end if;

  select array_agg(distinct asset_id) into v_assets from public.custody_rental_items where request_id = any(v_ids);
  update public.custody_inventory_reservations set status = 'cancelled'
   where id in (select reservation_id from public.custody_rental_items where request_id = any(v_ids) and reservation_id is not null);
  update public.custody_rental_items set status = 'returned'
   where request_id = any(v_ids) and status = 'reserved';
  update public.custody_rental_contracts set status = 'cancelled'
   where request_id = any(v_ids) and status in ('draft','signed');
  update public.custody_rental_requests
     set status = 'cancelled',
         internal_note = left(concat_ws(' | ', nullif(internal_note, ''), 'auto-expired stale draft'), 1000),
         updated_at = now()
   where id = any(v_ids);
  if v_assets is not null and to_regprocedure('public.civ_set_avail(uuid)') is not null then
    perform public.civ_set_avail(a) from unnest(v_assets) a;
  end if;
  return jsonb_build_object('ok', true, 'expired', v_n);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM, 'expired', 0);
end $$;
revoke all on function public.custody_rental_expire_stale_drafts(int) from public, anon;
grant  execute on function public.custody_rental_expire_stale_drafts(int) to authenticated;

commit;

-- ═══ 3) توسيع أنواع notifications (إعادة إعلان القائمة كاملة + الجديدين — لا حذف) ═══
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
  'rental_revision_requested',
  -- CLOSEOUT (جديد)
  'rental_deleted','rental_draft_expired','rental_handover_completed','rental_return_completed'
));
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'delete_fn' as k, pg_get_function_identity_arguments(oid) as args,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('anon', oid, 'execute') as anon_exec
  from pg_proc where proname = 'custody_rental_delete';
select 'delete_overloads' as k, count(*) as n from pg_proc where proname = 'custody_rental_delete';   -- يجب = 1
select 'expire_fn' as k, pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'custody_rental_expire_stale_drafts';
select 'notif_types_added' as k,
  (position('rental_deleted' in pg_get_constraintdef(oid)) > 0) as has_deleted,
  (position('rental_draft_expired' in pg_get_constraintdef(oid)) > 0) as has_expired
  from pg_constraint where conname = 'notifications_type_check' and conrelid = 'public.notifications'::regclass;
select 'stale_drafts_now' as k, count(*) from public.custody_rental_requests
  where status = 'draft' and updated_at < now() - interval '15 minutes'
    and not exists (select 1 from public.custody_rental_evidence e where e.request_id = custody_rental_requests.id);
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (يدوي عند الحاجة فقط):
-- begin;
--   drop function if exists public.custody_rental_delete(uuid, text);
--   drop function if exists public.custody_rental_expire_stale_drafts(int);
--   -- قيد الإشعارات: أعد إعلانه بالقائمة السابقة (rental_v1_final:260) دون الجديدين.
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
