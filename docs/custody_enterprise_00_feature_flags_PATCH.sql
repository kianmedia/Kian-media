-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 00: Feature Flags + Finance role + Audit + Notify
-- ملف Patch مستقل idempotent. يُشغَّل بعد:
--   docs/portal_custody_inventory_system_v1_RUNME.sql
--   docs/portal_custody_inventory_employee_self_service_PATCH.sql
-- لا يعدّل أي SQL مطبّق ولا يلمس العهدة اليدوية/التأجير/Zoho/الفوترة/HR القديمة.
-- الأساس الذي تبني عليه بقية الـ patches: أعلام + أدوار مالية + تدقيق + أنواع إشعارات.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) إعدادات المؤسسة + أعلام المزايا (سطر واحد id=1) ───
create table if not exists public.custody_enterprise_settings (
  id                              int primary key default 1 check (id = 1),
  -- أعلام تشغيلية آمنة (مفعّلة افتراضيًا)
  qr_scanning_enabled             boolean not null default true,
  barcode_enabled                 boolean not null default true,
  custody_kits_enabled            boolean not null default true,
  asset_components_enabled        boolean not null default true,
  project_linking_enabled         boolean not null default true,
  employee_signature_enabled      boolean not null default true,
  detailed_conditions_enabled     boolean not null default true,
  overdue_alerts_enabled          boolean not null default true,
  incident_reporting_enabled      boolean not null default true,
  purchase_requests_enabled       boolean not null default true,
  maintenance_vendor_billing_enabled boolean not null default true,
  -- أعلام خلف إعداد (معطّلة حتى اكتمال التكامل/النص القانوني/الأجهزة)
  gps_sessions_enabled            boolean not null default false,
  external_trackers_enabled       boolean not null default false,
  client_rental_portal_enabled    boolean not null default false,
  depreciation_enabled            boolean not null default false,
  zoho_asset_sync_enabled         boolean not null default false,
  insurance_claims_enabled        boolean not null default false,
  custody_offline_enabled         boolean not null default false,
  custody_mobile_app_enabled      boolean not null default false,
  -- إعدادات عامة
  overdue_escalation_hours        int not null default 24,
  gps_retention_days              int not null default 30,
  ack_version                     int not null default 1,
  updated_by                      uuid references auth.users(id),
  updated_at                      timestamptz not null default now()
);
insert into public.custody_enterprise_settings (id) values (1) on conflict (id) do nothing;
alter table public.custody_enterprise_settings enable row level security;
-- لا سياسات قراءة مباشرة — عبر RPC فقط.

-- ─── 2) دور مالي (يرى التكلفة/الفواتير/التأمين/Zoho؛ لا يعدّل المخزون) ───
create or replace function public.civ_can_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() = 'finance';
$$;
revoke execute on function public.civ_can_finance() from public, anon;
grant  execute on function public.civ_can_finance() to authenticated;

-- ─── 3) تدقيق موحّد للنظام (يعيد استخدام log_activity كخدمة، آمن الفشل) ───
create or replace function public.custody_audit(p_action text, p_etype text, p_eid uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(auth.uid(), 'admin', 'custody.' || p_action, coalesce(p_etype,'custody_enterprise'), p_eid, coalesce(p_meta,'{}'::jsonb));
exception when others then return;   -- التدقيق best-effort — لا يكسر العملية
end; $$;
revoke execute on function public.custody_audit(text,text,uuid,jsonb) from public, anon, authenticated;

-- ─── 4) قراءة/تعديل الأعلام ───
create or replace function public.custody_enterprise_get_flags() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into r from public.custody_enterprise_settings where id = 1;
  if r.id is null then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'qr_scanning_enabled', r.qr_scanning_enabled, 'barcode_enabled', r.barcode_enabled,
    'custody_kits_enabled', r.custody_kits_enabled, 'asset_components_enabled', r.asset_components_enabled,
    'project_linking_enabled', r.project_linking_enabled, 'employee_signature_enabled', r.employee_signature_enabled,
    'detailed_conditions_enabled', r.detailed_conditions_enabled, 'overdue_alerts_enabled', r.overdue_alerts_enabled,
    'incident_reporting_enabled', r.incident_reporting_enabled, 'purchase_requests_enabled', r.purchase_requests_enabled,
    'maintenance_vendor_billing_enabled', r.maintenance_vendor_billing_enabled,
    'gps_sessions_enabled', r.gps_sessions_enabled, 'external_trackers_enabled', r.external_trackers_enabled,
    'client_rental_portal_enabled', r.client_rental_portal_enabled, 'depreciation_enabled', r.depreciation_enabled,
    'zoho_asset_sync_enabled', r.zoho_asset_sync_enabled, 'insurance_claims_enabled', r.insurance_claims_enabled,
    'custody_offline_enabled', r.custody_offline_enabled, 'custody_mobile_app_enabled', r.custody_mobile_app_enabled,
    'overdue_escalation_hours', r.overdue_escalation_hours, 'gps_retention_days', r.gps_retention_days, 'ack_version', r.ack_version
  );
end; $$;

create or replace function public.custody_enterprise_admin_update_flags(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
  bool_keys text[] := array['qr_scanning_enabled','barcode_enabled','custody_kits_enabled','asset_components_enabled',
    'project_linking_enabled','employee_signature_enabled','detailed_conditions_enabled','overdue_alerts_enabled',
    'incident_reporting_enabled','purchase_requests_enabled','maintenance_vendor_billing_enabled','gps_sessions_enabled',
    'external_trackers_enabled','client_rental_portal_enabled','depreciation_enabled','zoho_asset_sync_enabled',
    'insurance_claims_enabled','custody_offline_enabled','custody_mobile_app_enabled'];
  int_keys text[] := array['overdue_escalation_hours','gps_retention_days','ack_version'];
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;   -- مالك/سوبر/أدمن فقط
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'patch_required'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(bool_keys) or k = any(int_keys)) then raise exception 'invalid_flag: %', k; end if;
  end loop;
  update public.custody_enterprise_settings s set
    qr_scanning_enabled = coalesce((p_patch->>'qr_scanning_enabled')::boolean, s.qr_scanning_enabled),
    barcode_enabled = coalesce((p_patch->>'barcode_enabled')::boolean, s.barcode_enabled),
    custody_kits_enabled = coalesce((p_patch->>'custody_kits_enabled')::boolean, s.custody_kits_enabled),
    asset_components_enabled = coalesce((p_patch->>'asset_components_enabled')::boolean, s.asset_components_enabled),
    project_linking_enabled = coalesce((p_patch->>'project_linking_enabled')::boolean, s.project_linking_enabled),
    employee_signature_enabled = coalesce((p_patch->>'employee_signature_enabled')::boolean, s.employee_signature_enabled),
    detailed_conditions_enabled = coalesce((p_patch->>'detailed_conditions_enabled')::boolean, s.detailed_conditions_enabled),
    overdue_alerts_enabled = coalesce((p_patch->>'overdue_alerts_enabled')::boolean, s.overdue_alerts_enabled),
    incident_reporting_enabled = coalesce((p_patch->>'incident_reporting_enabled')::boolean, s.incident_reporting_enabled),
    purchase_requests_enabled = coalesce((p_patch->>'purchase_requests_enabled')::boolean, s.purchase_requests_enabled),
    maintenance_vendor_billing_enabled = coalesce((p_patch->>'maintenance_vendor_billing_enabled')::boolean, s.maintenance_vendor_billing_enabled),
    gps_sessions_enabled = coalesce((p_patch->>'gps_sessions_enabled')::boolean, s.gps_sessions_enabled),
    external_trackers_enabled = coalesce((p_patch->>'external_trackers_enabled')::boolean, s.external_trackers_enabled),
    client_rental_portal_enabled = coalesce((p_patch->>'client_rental_portal_enabled')::boolean, s.client_rental_portal_enabled),
    depreciation_enabled = coalesce((p_patch->>'depreciation_enabled')::boolean, s.depreciation_enabled),
    zoho_asset_sync_enabled = coalesce((p_patch->>'zoho_asset_sync_enabled')::boolean, s.zoho_asset_sync_enabled),
    insurance_claims_enabled = coalesce((p_patch->>'insurance_claims_enabled')::boolean, s.insurance_claims_enabled),
    custody_offline_enabled = coalesce((p_patch->>'custody_offline_enabled')::boolean, s.custody_offline_enabled),
    custody_mobile_app_enabled = coalesce((p_patch->>'custody_mobile_app_enabled')::boolean, s.custody_mobile_app_enabled),
    overdue_escalation_hours = coalesce((p_patch->>'overdue_escalation_hours')::int, s.overdue_escalation_hours),
    gps_retention_days = coalesce((p_patch->>'gps_retention_days')::int, s.gps_retention_days),
    ack_version = coalesce((p_patch->>'ack_version')::int, s.ack_version),
    updated_by = auth.uid(), updated_at = now()
  where s.id = 1;
  perform public.custody_audit('flags_updated', 'custody_enterprise', null, p_patch);
  return public.custody_enterprise_get_flags();
end; $$;
revoke execute on function public.custody_enterprise_get_flags() from public, anon;
revoke execute on function public.custody_enterprise_admin_update_flags(jsonb) from public, anon;
grant  execute on function public.custody_enterprise_get_flags() to authenticated;
grant  execute on function public.custody_enterprise_admin_update_flags(jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) الإشعارات — إعادة إعلان القائمة كاملة (base 40 + civ v1 + self-issue) + 23 نوعًا
--    مؤسسيًا جديدًا. لا حذف لأي نوع.
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
  -- enterprise (23) جديد
  'qr_reissued','kit_issued','kit_returned','custody_due_soon','custody_overdue','custody_escalated',
  'custody_incident_reported','custody_incident_updated','custody_signature_completed',
  'custody_location_started','custody_location_stopped','custody_offline_conflict',
  'rental_request_created','rental_contract_signed','rental_overdue',
  'maintenance_estimate_requested','maintenance_cost_approved','maintenance_completed',
  'purchase_request_created','purchase_request_approved','insurance_expiring','insurance_claim_updated','zoho_sync_failed'
));
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'flags_table' as k, count(*) from information_schema.tables where table_name='custody_enterprise_settings';
select 'flags_rpcs'  as k, count(*) from pg_proc where proname in ('custody_enterprise_get_flags','custody_enterprise_admin_update_flags','civ_can_finance','custody_audit');
select 'settings_row' as k, count(*) from public.custody_enterprise_settings;
select 'notify_check' as k, count(*) from pg_constraint where conname='notifications_type_check';
-- ════════════════════════════════════════════════════════════════════════════
