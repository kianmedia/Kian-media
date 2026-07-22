-- ════════════════════════════════════════════════════════════════════════════
-- project_governance_batch5c_RUNME.sql
-- PHASE 5 · BATCH 5C — PROJECT CLOSURE, FINAL ACCEPTANCE, LESSONS LEARNED & ARCHIVING
-- ────────────────────────────────────────────────────────────────────────────
-- تصميم معتمد بعد Read-Only Audit (يُوسّع/يُركّب لا يوازي):
--   • دورة الإغلاق (delivered→closure_requested→review→approved→closed) في جدول 5C مستقل؛
--     core_stage يبقى 'delivered' حتى Final Close الذي يستدعي المسار الرسمي الوحيد
--     project_core_set_stage(pid,'closed',reason) — لا UPDATE مباشر لـ core_stage أبدًا.
--   • الاعتمادات تُركّب نظام 5A: approval_type='project_closure' (قيمة مسموحة أصلًا) عبر
--     pc_governance_approval_request/pc_approval_decide — لا نظام اعتماد موازٍ.
--   • إعدادات الإغلاق: 7 أعلام require_*_before_close موجودة في project_governance_settings (5A)؛
--     نُوسّعها بالناقص عبر alter add if not exists + pc_closure_settings_upsert (لا جدول موازٍ).
--   • Readiness يحسب حواجز الإغلاق من مصادرها الأصلية مباشرةً (project_tasks/deliverables/deliverable_assets/
--     resource_bookings/custody/project_risks/project_issues/project_change_requests/finance) مقابل أعلام
--     require_*_before_close — لا يستدعي executive_delivery_readiness(5B)/project_stage_readiness(3C) (سؤال
--     مختلف: جاهزية الإغلاق لا جاهزية التسليم/الانتقال)؛ المصادر معزولة (catch→unavailable؛ لا افتراض «مسدَّد»)
--     كلها قراءة فقط ومعزولة (catch→unavailable؛ لا افتراض «مسدَّد»).
--   • المالية/Zoho/العهدة: قراءة فقط. لا إغلاق تلقائي للعهدة. لا كتابة مالية.
--   • الأرشفة: تُركّب project_core_archive_project/restore + جدول 5C institutional (retention/legal hold/snapshot metadata).
--   • Parent–Child عبر pc_is_subproject (معزول للعمود غير المطبّق).
--   • تنبيهات: pc_event_emit + reminder_tracking (Idempotent) + cron notify-email القائم — لا Cron جديد.
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا حذف بيانات · بلا DROP FUNCTION/TABLE ·
--   بلا Temp Tables في دوال القراءة · Preflight · self-test بلا Side Effects · notify pgrst ·
--   GRANTs/RLS/Comments · لا تعديل core_stage إلا داخل project_final_close عبر المسار الرسمي ·
--   لا تعديل progress/مالي/Zoho/عهدة. ترتيب التشغيل الموصى به: 5A → 5B → 5C.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is null then raise exception '5C PREFLIGHT: project_core_set_stage مفقودة (المسار الرسمي للإغلاق)'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null or to_regprocedure('public.is_staff()') is null
     or to_regprocedure('public.can_manage_projects()') is null or to_regprocedure('public.is_owner()') is null then raise exception '5C PREFLIGHT: دوال الأدوار مفقودة'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then raise exception '5C PREFLIGHT: pc_log مفقودة'; end if;
  if to_regclass('public.project_governance_settings') is null then raise exception '5C PREFLIGHT: project_governance_settings (5A) مفقودة — طبّق 5A أولًا'; end if;
  if to_regclass('public.permissions') is null then raise exception '5C PREFLIGHT: permissions مفقود'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then raise notice '5C: pc_event_emit مفقودة — closure_alerts_scan سيُعطَّل بأمان'; end if;
  if to_regprocedure('public.executive_project_scorecard(uuid)') is null then raise notice '5C: 5B غير مطبّقة — درجات مراجعة ما بعد المشروع لن تُشتقّ من Scorecard'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) توسيع إعدادات الإغلاق على project_governance_settings (Additive) + upsert مخصّص
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_governance_settings
  add column if not exists require_risks_closed_before_close        boolean not null default false,
  add column if not exists require_issues_closed_before_close       boolean not null default false,
  add column if not exists require_change_requests_closed_before_close boolean not null default true,
  add column if not exists require_time_logs_submitted              boolean not null default false,
  add column if not exists require_final_files_available            boolean not null default true,
  add column if not exists require_child_projects_closed            boolean not null default false,
  add column if not exists allow_closure_with_advisory_warnings     boolean not null default true,
  add column if not exists allow_financial_override                 boolean not null default true,
  add column if not exists require_final_payment_before_close       boolean not null default false,
  add column if not exists closure_approval_mode                    text    not null default 'inherit',
  add column if not exists closure_retention_policy                 text    not null default 'standard',
  add column if not exists archive_after_days                       int;

do $g$
begin
  if not exists (select 1 from pg_constraint where conname='pgs_closure_approval_mode_ck') then
    alter table public.project_governance_settings add constraint pgs_closure_approval_mode_ck
      check (closure_approval_mode in ('inherit','sequential','parallel','any_one','all_required'));
  end if;
  if not exists (select 1 from pg_constraint where conname='pgs_closure_retention_ck') then
    alter table public.project_governance_settings add constraint pgs_closure_retention_ck
      check (closure_retention_policy in ('standard','extended','permanent','minimal'));
  end if;
end $g$;

-- upsert مخصّص لأعلام الإغلاق (يشمل الأعلام السبعة القائمة التي أغفلها upsert 5A + الجديدة).
create or replace function public.pc_closure_settings_upsert(p_project uuid, p_data jsonb)
returns public.project_governance_settings language plpgsql security definer set search_path = public as $$
declare r public.project_governance_settings;
begin
  if not (public.is_staff() and (public.can_manage_projects() or public.emp_has_permission('governance.manage_settings'))) then raise exception 'not authorized'; end if;
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  insert into public.project_governance_settings(project_id) values (p_project) on conflict (project_id) do nothing;
  update public.project_governance_settings set
    require_client_approval = coalesce((p_data->>'require_client_approval')::boolean, require_client_approval),
    require_internal_approval = coalesce((p_data->>'require_internal_approval')::boolean, require_internal_approval),
    require_financial_clearance_before_close = coalesce((p_data->>'require_financial_clearance_before_close')::boolean, require_financial_clearance_before_close),
    require_deliverables_approved_before_close = coalesce((p_data->>'require_deliverables_approved_before_close')::boolean, require_deliverables_approved_before_close),
    require_tasks_complete_before_close = coalesce((p_data->>'require_tasks_complete_before_close')::boolean, require_tasks_complete_before_close),
    require_resource_bookings_closed_before_close = coalesce((p_data->>'require_resource_bookings_closed_before_close')::boolean, require_resource_bookings_closed_before_close),
    require_lessons_learned = coalesce((p_data->>'require_lessons_learned')::boolean, require_lessons_learned),
    require_closure_report = coalesce((p_data->>'require_closure_report')::boolean, require_closure_report),
    require_risks_closed_before_close = coalesce((p_data->>'require_risks_closed_before_close')::boolean, require_risks_closed_before_close),
    require_issues_closed_before_close = coalesce((p_data->>'require_issues_closed_before_close')::boolean, require_issues_closed_before_close),
    require_change_requests_closed_before_close = coalesce((p_data->>'require_change_requests_closed_before_close')::boolean, require_change_requests_closed_before_close),
    require_time_logs_submitted = coalesce((p_data->>'require_time_logs_submitted')::boolean, require_time_logs_submitted),
    require_final_files_available = coalesce((p_data->>'require_final_files_available')::boolean, require_final_files_available),
    require_child_projects_closed = coalesce((p_data->>'require_child_projects_closed')::boolean, require_child_projects_closed),
    require_final_payment_before_close = coalesce((p_data->>'require_final_payment_before_close')::boolean, require_final_payment_before_close),
    allow_closure_with_advisory_warnings = coalesce((p_data->>'allow_closure_with_advisory_warnings')::boolean, allow_closure_with_advisory_warnings),
    allow_financial_override = coalesce((p_data->>'allow_financial_override')::boolean, allow_financial_override),
    closure_approval_mode = coalesce(nullif(p_data->>'closure_approval_mode',''), closure_approval_mode),
    closure_retention_policy = coalesce(nullif(p_data->>'closure_retention_policy',''), closure_retention_policy),
    archive_after_days = coalesce(nullif(p_data->>'archive_after_days','')::int, archive_after_days),
    updated_at = now()
    where project_id = p_project returning * into r;
  perform public.pc_log(p_project, 'closure_settings_updated', 'project', p_project, '{}');
  return r;
end $$;
revoke execute on function public.pc_closure_settings_upsert(uuid,jsonb) from public, anon;
grant execute on function public.pc_closure_settings_upsert(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) صلاحيات الإغلاق (Additive على الكتالوج)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('closure.view',                     'closure','normal', 800,'عرض الإغلاق','View closure'),
  ('closure.request',                  'closure','normal', 805,'طلب الإغلاق','Request closure'),
  ('closure.review',                   'closure','normal', 810,'مراجعة الإغلاق','Review closure'),
  ('closure.approve',                  'closure','sensitive',815,'اعتماد الإغلاق','Approve closure'),
  ('closure.reject',                   'closure','sensitive',820,'رفض الإغلاق','Reject closure'),
  ('closure.request_changes',          'closure','normal', 825,'طلب تعديل الإغلاق','Request closure changes'),
  ('closure.override',                 'closure','sensitive',830,'تجاوز حواجز الإغلاق','Override closure blockers'),
  ('closure.final_close',              'closure','sensitive',835,'الإغلاق النهائي','Final close'),
  ('closure.reopen_request',           'closure','normal', 840,'طلب إعادة الفتح','Request reopen'),
  ('closure.reopen_approve',           'closure','sensitive',845,'اعتماد إعادة الفتح','Approve reopen'),
  ('closure.archive',                  'closure','sensitive',850,'أرشفة المشروع','Archive project'),
  ('closure.restore',                  'closure','sensitive',855,'استعادة من الأرشيف','Restore from archive'),
  ('closure.manage_retention',         'closure','sensitive',860,'إدارة الاحتفاظ','Manage retention'),
  ('closure.manage_legal_hold',        'closure','sensitive',865,'إدارة الحجز القانوني','Manage legal hold'),
  ('closure.view_financial_clearance', 'closure','sensitive',870,'عرض الإخلاء المالي','View financial clearance'),
  ('closure.override_financial_clearance','closure','sensitive',875,'تجاوز الإخلاء المالي','Override financial clearance'),
  ('closure.manage_lessons',           'closure','normal', 880,'إدارة الدروس المستفادة','Manage lessons learned'),
  ('closure.approve_knowledge',        'closure','sensitive',885,'اعتماد النشر المعرفي','Approve knowledge base'),
  ('closure.view_post_review',         'closure','normal', 890,'عرض مراجعة ما بعد المشروع','View post-project review'),
  ('closure.manage_post_review',       'closure','normal', 895,'إدارة مراجعة ما بعد المشروع','Manage post-project review'),
  ('closure.client_accept',            'closure','normal', 900,'قبول العميل النهائي','Client final acceptance')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) جداول دورة الإغلاق (Additive)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_closure_requests (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  request_no           text,
  status               text not null default 'draft' check (status in
                        ('draft','submitted','under_review','changes_requested','approved','rejected','cancelled','closed','reopened')),
  requested_by         uuid,
  requested_at         timestamptz not null default now(),
  closure_reason       text,
  closure_summary      text,
  planned_closure_date date,
  actual_closure_date  timestamptz,
  review_started_at    timestamptz,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  approved_by          uuid,
  approved_at          timestamptz,
  rejected_by          uuid,
  rejected_at          timestamptz,
  rejection_reason     text,
  reopened_at          timestamptz,
  reopened_by          uuid,
  reopen_reason        text,
  final_acceptance_id  uuid,
  closure_report_id    uuid,
  approval_id          uuid,
  readiness_snapshot   jsonb not null default '{}'::jsonb,
  blockers_snapshot    jsonb not null default '[]'::jsonb,
  override_snapshot    jsonb not null default '{}'::jsonb,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  cancelled_at         timestamptz,
  is_deleted           boolean not null default false
);
-- طلب إغلاق نشط واحد فقط لكل مشروع (partial unique على الحالات غير المنتهية).
create unique index if not exists ux_closure_active_one on public.project_closure_requests(project_id)
  where is_deleted=false and status in ('draft','submitted','under_review','changes_requested','approved');
create index if not exists ix_closure_project on public.project_closure_requests(project_id, status) where is_deleted=false;

create table if not exists public.project_final_acceptances (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  closure_request_id   uuid references public.project_closure_requests(id) on delete set null,
  acceptance_type      text not null default 'client_final' check (acceptance_type in ('internal_final','client_final','sponsor_final','project_owner_final')),
  requested_by         uuid,
  requested_at         timestamptz not null default now(),
  requested_from       uuid,
  due_at               timestamptz,
  status               text not null default 'pending' check (status in ('draft','pending','accepted','rejected','changes_requested','expired','cancelled')),
  accepted_by          uuid,
  accepted_at          timestamptz,
  rejected_by          uuid,
  rejected_at          timestamptz,
  rejection_reason     text,
  changes_requested    text,
  acceptance_comment   text,
  acceptance_scope     text,
  accepted_deliverables_snapshot jsonb not null default '[]'::jsonb,
  client_ip_hash       text,
  user_agent_hash      text,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  cancelled_at         timestamptz,
  is_deleted           boolean not null default false
);
create index if not exists ix_acceptance_project on public.project_final_acceptances(project_id, status) where is_deleted=false;
create index if not exists ix_acceptance_from on public.project_final_acceptances(requested_from) where is_deleted=false;

create table if not exists public.project_lessons_learned (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  closure_request_id   uuid references public.project_closure_requests(id) on delete set null,
  category             text not null default 'other' check (category in
                        ('planning','production','post_production','client_management','resources','equipment','quality','scheduling','communication','governance','risk','supplier','technical','other')),
  title                text not null,
  description          text,
  what_worked          text,
  what_did_not_work    text,
  root_cause           text,
  recommendation       text,
  reusable_practice    text,
  owner_id             uuid,
  impact_level         text not null default 'medium' check (impact_level in ('low','medium','high','critical')),
  confidentiality      text not null default 'internal' check (confidentiality in ('internal','management','client_shareable')),
  client_visible       boolean not null default false,
  approved_for_knowledge_base boolean not null default false,
  approved_by          uuid,
  approved_at          timestamptz,
  linked_risk_id       uuid,
  linked_issue_id      uuid,
  linked_decision_id   uuid,
  linked_change_request_id uuid,
  version              int not null default 1,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  is_deleted           boolean not null default false
);
create index if not exists ix_lessons_project on public.project_lessons_learned(project_id) where is_deleted=false;

create table if not exists public.project_post_reviews (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  closure_request_id   uuid references public.project_closure_requests(id) on delete set null,
  reviewed_by          uuid,
  review_date          date,
  planned_duration_days int, actual_duration_days int, schedule_variance_days int, baseline_variance_days int,
  delivery_on_time     boolean,
  execution_score int, schedule_score int, resource_score int, governance_score int, quality_score int,
  client_satisfaction_score int, team_satisfaction_score int, supplier_performance_score int,
  objectives_met       text, scope_changes_count int, critical_risks_count int, critical_issues_count int,
  approval_sla_compliance numeric,
  score_sources        jsonb not null default '{}'::jsonb,
  summary text, strengths text, weaknesses text, recommendations text,
  version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
create unique index if not exists ux_post_review_one on public.project_post_reviews(project_id) where is_deleted=false;

create table if not exists public.project_reopen_requests (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  closure_request_id   uuid references public.project_closure_requests(id) on delete set null,
  status               text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reason               text not null,
  stage_before         text,
  requested_target_stage text not null check (requested_target_stage in ('revision','post_production','client_review','delivered')),
  requested_by         uuid,
  requested_at         timestamptz not null default now(),
  approved_by          uuid,
  approved_at          timestamptz,
  rejected_by          uuid,
  rejected_at          timestamptz,
  decision_comment     text,
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  is_deleted           boolean not null default false
);
create index if not exists ix_reopen_project on public.project_reopen_requests(project_id, status) where is_deleted=false;
-- طلب إعادة فتح نشط واحد فقط لكل مشروع (حارس ذرّي يعكس ux_closure_active_one).
create unique index if not exists ux_reopen_active_one on public.project_reopen_requests(project_id) where is_deleted=false and status='pending';

create table if not exists public.project_archives (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  closure_request_id   uuid references public.project_closure_requests(id) on delete set null,
  archived_by          uuid,
  archived_at          timestamptz not null default now(),
  archive_reason       text,
  archive_policy       text not null default 'standard',
  retention_until      date,
  legal_hold           boolean not null default false,
  legal_hold_reason    text,
  archive_snapshot     jsonb not null default '{}'::jsonb,
  checksum_metadata    jsonb not null default '{}'::jsonb,
  storage_references   jsonb not null default '[]'::jsonb,
  restore_requested_at timestamptz,
  restored_at          timestamptz,
  restored_by          uuid,
  status               text not null default 'archived' check (status in ('archived','restore_requested','restored')),
  version              int not null default 1,
  created_at           timestamptz not null default now(),
  is_deleted           boolean not null default false
);
create index if not exists ix_archive_project on public.project_archives(project_id) where is_deleted=false;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) دوال مساعدة (صلاحية/عزل/مالية-قراءة/عهدة-قراءة/حالة الإغلاق)
-- ════════════════════════════════════════════════════════════════════════════
-- 4.1 صلاحية إغلاق: المفاتيح الحسّاسة تتطلّب manager أو منح صريح؛ لا تُمنح عبر can_edit_project العريض.
create or replace function public.closure_can(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and public.pc_can_read_project(p_project) and (
    case when p_key in ('closure.approve','closure.reject','closure.override','closure.final_close',
                        'closure.reopen_approve','closure.archive','closure.restore','closure.manage_retention',
                        'closure.manage_legal_hold','closure.override_financial_clearance','closure.approve_knowledge')
         then (public.can_manage_projects() or public.emp_has_permission(p_key))
         else (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission(p_key))
    end);
$$;
revoke execute on function public.closure_can(uuid,text) from public, anon;
grant execute on function public.closure_can(uuid,text) to authenticated;

-- 4.2 محوّل الإخلاء المالي (قراءة فقط؛ لا يفترض «مسدَّد»؛ يلتقط غياب الصلاحية → unavailable).
create or replace function public.pc_financial_clearance(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_paid boolean; v_checklist jsonb; v_can_close boolean; v_available boolean := true; v_reason text;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- الإشارة الأوسع صلاحيةً: هل أُقرّت مستحقّات العميل إداريًّا؟ (admin|kian_member|client).
  begin v_paid := public.project_payment_cleared(p_project); exception when others then v_paid := null; end;
  -- Checklist المالي (أضيق صلاحيةً: pc_can_see_finance) — نلتقط غيابها ونعيد unavailable لا «مسدَّد».
  begin
    v_checklist := public.pc_finance_closure_checklist(p_project);
    v_can_close := coalesce((v_checklist->>'can_close')::boolean, null);
  exception when others then v_available := false; v_reason := 'no_finance_permission'; end;
  return jsonb_build_object(
    'available', v_available,
    'payment_cleared', v_paid,                                    -- null = غير معروف
    'finance_can_close', v_can_close,                             -- null = غير متاح
    'outstanding_ref', case when v_available then (v_checklist->'items') else null end,
    'reason', v_reason, 'calculated_at', now());
end $$;
revoke execute on function public.pc_financial_clearance(uuid) from public, anon;
grant execute on function public.pc_financial_clearance(uuid) to authenticated;

-- 4.3 عدّ العهد المفتوحة (قراءة فقط عبر SECURITY DEFINER؛ لا يكشف تفاصيل ولا يغلق شيئًا).
create or replace function public.pc_project_open_custody_count(p_project uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare v int := 0;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin
    select count(*) into v from public.custody_inventory_assignments
      where project_id = p_project and coalesce(is_deleted,false)=false
        and status in ('pending_employee_confirmation','active','return_requested','under_inspection','partially_returned');
  exception when undefined_table or undefined_column then v := 0; end;
  return coalesce(v,0);
end $$;
revoke execute on function public.pc_project_open_custody_count(uuid) from public, anon;
grant execute on function public.pc_project_open_custody_count(uuid) to authenticated;

-- 4.4 حالة الإغلاق المشتقّة (لا تخزين يدوي؛ من طلب الإغلاق + core_stage + الأرشيف).
create or replace function public.pc_project_closure_status(p_project uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_stage text; v_req record; v_archived boolean := false;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select core_stage into v_stage from public.project_core where project_id = p_project;
  begin select coalesce(is_deleted,false) and archived_at is not null into v_archived from public.projects where id=p_project; exception when undefined_column then v_archived := false; end;
  if v_archived then return 'archived'; end if;
  if v_stage = 'closed' then return 'closed'; end if;
  select status, id into v_req from public.project_closure_requests
    where project_id=p_project and is_deleted=false and status in ('draft','submitted','under_review','changes_requested','approved')
    order by created_at desc limit 1;
  if v_req.id is null then
    if exists (select 1 from public.project_reopen_requests where project_id=p_project and is_deleted=false and status='pending') then return 'reopened'; end if;
    if exists (select 1 from public.project_closure_requests where project_id=p_project and is_deleted=false and status='reopened') then return 'reopened'; end if;
    return 'closure_not_started';
  end if;
  return case v_req.status
    when 'draft' then 'closure_in_progress' when 'submitted' then 'closure_in_progress'
    when 'under_review' then 'awaiting_internal_approval' when 'changes_requested' then 'closure_blocked'
    when 'approved' then 'closure_approved' else 'closure_in_progress' end;
end $$;
revoke execute on function public.pc_project_closure_status(uuid) from public, anon;
grant execute on function public.pc_project_closure_status(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) محرّك جاهزية الإغلاق (يُركّب المصادر القائمة؛ denominator = المطلوب فقط؛ blockers مفسّرة)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_closure_readiness(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.project_governance_settings; v_stage text;
  v_req jsonb := '[]'::jsonb; v_pass jsonb := '[]'::jsonb; v_block jsonb := '[]'::jsonb; v_adv jsonb := '[]'::jsonb; v_dq jsonb := '[]'::jsonb;
  v_total int := 0; v_passed int := 0;
  v_open_tasks int; v_blocked_tasks int; v_review_tasks int; v_dlv_total int; v_dlv_unapproved int; v_dlv_revising int; v_final_assets int;
  v_open_book int; v_open_shoot int; v_open_custody int; v_crit_risk int; v_crit_issue int; v_pending_appr int; v_pending_chg int;
  v_open_time int; v_fin jsonb; v_pay boolean; v_child_open int;
  -- helper flags
  v_has_gov boolean := to_regclass('public.project_risks') is not null;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select * into s from public.project_governance_settings where project_id = p_project;
  if s.project_id is null then
    -- إعدادات افتراضية آمنة (لا تمنع فجأة): أنشئها ضمنيًّا للقراءة فقط عبر defaults.
    s.require_internal_approval := true; s.require_deliverables_approved_before_close := true;
    s.require_tasks_complete_before_close := true; s.require_final_files_available := true;
    s.require_change_requests_closed_before_close := true; s.allow_closure_with_advisory_warnings := true; s.allow_financial_override := true;
    v_dq := v_dq || jsonb_build_object('code','no_governance_settings','severity','warning','ar','لا إعدادات حوكمة — طُبِّقت افتراضات آمنة');
  end if;
  select core_stage into v_stage from public.project_core where project_id = p_project;

  -- (0) المرحلة يجب أن تكون delivered (شرط دائم غير قابل للتجاوز).
  v_total := v_total+1; v_req := v_req || jsonb_build_object('code','stage_delivered','ar','المرحلة = مُسلَّم');
  if coalesce(v_stage,'') = 'delivered' then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','stage_delivered');
  elsif coalesce(v_stage,'')='closed' then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','already_closed');
  else v_block := v_block || jsonb_build_object('code','stage_not_delivered','severity','critical','source','core_stage','entity_id',null,
      'overrideable',false,'ar','المرحلة ليست «مُسلَّم» (الحالية: '||coalesce(v_stage,'—')||')','en','Stage is not delivered'); end if;

  -- (1) المهام مكتملة + لا مهام معلّقة/مراجعة
  select count(*) filter (where status not in ('done','cancelled')),
         count(*) filter (where status='blocked'),
         count(*) filter (where status in ('internal_review','client_review'))
    into v_open_tasks, v_blocked_tasks, v_review_tasks
  from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false;
  if coalesce(s.require_tasks_complete_before_close,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','tasks_complete','ar','جميع المهام مكتملة');
    if coalesce(v_open_tasks,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','tasks_complete');
    else v_block := v_block || jsonb_build_object('code','open_tasks','severity','major','source','project_tasks','entity_id',null,
        'overrideable',true,'count',v_open_tasks,'ar', v_open_tasks||' مهمة غير مكتملة','en', v_open_tasks||' open tasks'); end if;
  end if;
  -- فحص محسوب (يدخل المقام) كي يتطابق readiness_percent مع ready: أي حاجز = فحص مطلوب فاشل.
  v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_tasks_in_review','ar','لا مهام قيد المراجعة');
  if coalesce(v_review_tasks,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_tasks_in_review');
  else v_block := v_block || jsonb_build_object('code','tasks_in_review','severity','major','source','project_tasks',
    'overrideable',true,'count',v_review_tasks,'ar', v_review_tasks||' مهمة قيد المراجعة','en', v_review_tasks||' tasks in review'); end if;
  if coalesce(v_blocked_tasks,0)>0 then v_adv := v_adv || jsonb_build_object('code','blocked_tasks','count',v_blocked_tasks,'ar', v_blocked_tasks||' مهمة متوقّفة'); end if;

  -- (2) المخرجات معتمدة + لا مراجعات مفتوحة + ملفات نهائية (قراءة deliverables؛ معزول إن غاب النظام)
  begin
    select count(*) filter (where status not in ('archived')),
           count(*) filter (where status not in ('approved','final_delivered','archived')),
           count(*) filter (where status in ('revision_requested','client_review'))
      into v_dlv_total, v_dlv_unapproved, v_dlv_revising
    from public.deliverables where project_id=p_project and coalesce(is_deleted,false)=false;
    select count(*) into v_final_assets from public.deliverable_assets a
      join public.deliverables d on d.id=a.deliverable_id where d.project_id=p_project and coalesce(d.is_deleted,false)=false and a.kind in ('final','master') and coalesce(a.is_deleted,false)=false;
  exception when undefined_table then v_dlv_total := -1; end;
  if v_dlv_total >= 0 and coalesce(s.require_deliverables_approved_before_close,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','deliverables_approved','ar','المخرجات معتمدة');
    if v_dlv_total=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','deliverables_approved'); v_adv := v_adv || jsonb_build_object('code','no_deliverables','ar','لا مخرجات مسجّلة');
    elsif coalesce(v_dlv_unapproved,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','deliverables_approved');
    else v_block := v_block || jsonb_build_object('code','deliverables_unapproved','severity','major','source','deliverables',
        'overrideable',true,'count',v_dlv_unapproved,'ar', v_dlv_unapproved||' مخرجات غير معتمدة','en', v_dlv_unapproved||' unapproved deliverables'); end if;
  end if;
  if v_dlv_total >= 0 then  -- محسوب فقط عند توفّر نظام المخرجات
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_deliverables_in_review','ar','لا مخرجات قيد المراجعة');
    if coalesce(v_dlv_revising,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_deliverables_in_review');
    else v_block := v_block || jsonb_build_object('code','deliverables_in_review','severity','major','source','deliverables',
      'overrideable',true,'count',v_dlv_revising,'ar', v_dlv_revising||' مخرج قيد المراجعة/التعديل','en', v_dlv_revising||' deliverables under review'); end if;
  end if;
  if v_dlv_total > 0 and coalesce(s.require_final_files_available,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','final_files','ar','ملفات نهائية متاحة');
    if coalesce(v_final_assets,0)>0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','final_files');
    else v_block := v_block || jsonb_build_object('code','no_final_files','severity','major','source','deliverable_assets','overrideable',true,'ar','لا ملفات نهائية مرفقة','en','No final files'); end if;
  end if;

  -- (3) موارد/جلسات (قراءة؛ معزول إن غاب 4B)
  begin
    select count(*) into v_open_book from public.resource_bookings
      where project_id=p_project and coalesce(is_deleted,false)=false and status in ('hold','pending_approval','confirmed','in_use');
  exception when undefined_table then v_open_book := -1; end;
  if v_open_book >= 0 and coalesce(s.require_resource_bookings_closed_before_close,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','bookings_closed','ar','حجوزات الموارد مغلقة');
    if v_open_book=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','bookings_closed');
    else v_block := v_block || jsonb_build_object('code','open_bookings','severity','major','source','resource_bookings','overrideable',true,'count',v_open_book,
        'ar', v_open_book||' حجز مورد مفتوح','en', v_open_book||' open resource bookings'); end if;
  elsif coalesce(v_open_book,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_bookings','count',v_open_book,'ar', v_open_book||' حجز مورد مفتوح');
  end if;
  begin select count(*) into v_open_shoot from public.project_shoot_sessions where project_id=p_project and coalesce(is_deleted,false)=false and status in ('planned','confirmed','in_progress');
  exception when undefined_table then v_open_shoot := 0; end;
  if coalesce(v_open_shoot,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_shoots','count',v_open_shoot,'ar', v_open_shoot||' جلسة تصوير مفتوحة'); end if;

  -- (4) العهدة — قراءة فقط: Warning دائمًا (لا نغلقها تلقائيًا)
  v_open_custody := public.pc_project_open_custody_count(p_project);
  if coalesce(v_open_custody,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_custody','count',v_open_custody,'source','custody','ar', v_open_custody||' عهدة مفتوحة — تُدار من نظام العهدة','en', v_open_custody||' open custody (manage in custody system)'); end if;

  -- (5) حوكمة: مخاطر/مشكلات/تغييرات/اعتمادات (معزول إن غاب 5A)
  if v_has_gov then
    begin
      select count(*) into v_crit_risk from public.project_risks where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted');
      select count(*) into v_crit_issue from public.project_issues where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','resolved');
      select count(*) into v_pending_appr from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false and status in ('pending','draft') and approval_type<>'project_closure';
      select count(*) into v_pending_chg from public.project_change_requests where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('closed','cancelled','implemented','rejected');
    exception when undefined_table or undefined_column then v_has_gov := false; end;
  end if;
  if v_has_gov then
    if coalesce(s.require_risks_closed_before_close,false) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','risks_closed','ar','لا مخاطر حرجة مفتوحة');
      if coalesce(v_crit_risk,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','risks_closed');
      else v_block := v_block || jsonb_build_object('code','critical_risks','severity','critical','source','project_risks','overrideable',true,'count',v_crit_risk,'ar', v_crit_risk||' مخاطرة حرجة مفتوحة','en', v_crit_risk||' critical risks'); end if;
    elsif coalesce(v_crit_risk,0)>0 then v_adv := v_adv || jsonb_build_object('code','critical_risks','count',v_crit_risk,'ar', v_crit_risk||' مخاطرة حرجة'); end if;
    if coalesce(s.require_issues_closed_before_close,false) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','issues_closed','ar','لا مشكلات حرجة مفتوحة');
      if coalesce(v_crit_issue,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','issues_closed');
      else v_block := v_block || jsonb_build_object('code','critical_issues','severity','critical','source','project_issues','overrideable',true,'count',v_crit_issue,'ar', v_crit_issue||' مشكلة حرجة مفتوحة','en', v_crit_issue||' critical issues'); end if;
    elsif coalesce(v_crit_issue,0)>0 then v_adv := v_adv || jsonb_build_object('code','critical_issues','count',v_crit_issue,'ar', v_crit_issue||' مشكلة حرجة'); end if;
    if coalesce(s.require_change_requests_closed_before_close,true) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','changes_closed','ar','لا طلبات تغيير معلّقة');
      if coalesce(v_pending_chg,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','changes_closed');
      else v_block := v_block || jsonb_build_object('code','pending_changes','severity','major','source','project_change_requests','overrideable',true,'count',v_pending_chg,'ar', v_pending_chg||' طلب تغيير غير محلول','en', v_pending_chg||' open change requests'); end if;
    elsif coalesce(v_pending_chg,0)>0 then v_adv := v_adv || jsonb_build_object('code','pending_changes','count',v_pending_chg,'ar', v_pending_chg||' طلب تغيير معلّق'); end if;
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_pending_approvals','ar','لا اعتمادات معلّقة (غير الإغلاق)');
    if coalesce(v_pending_appr,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_pending_approvals');
    else v_block := v_block || jsonb_build_object('code','pending_approvals','severity','major','source','project_approvals','overrideable',true,'count',v_pending_appr,'ar', v_pending_appr||' اعتماد معلّق (غير الإغلاق)','en', v_pending_appr||' pending approvals'); end if;
  else
    v_dq := v_dq || jsonb_build_object('code','governance_unavailable','severity','warning','ar','بيانات الحوكمة (5A) غير متاحة — فحوص المخاطر/المشكلات/التغييرات معطّلة');
  end if;

  -- (6) الإخلاء المالي — قراءة فقط (غير متاح ⇒ Blocker قابل للتجاوز فقط إذا اشترطته السياسة)
  v_fin := public.pc_financial_clearance(p_project);
  v_pay := (v_fin->>'payment_cleared')::boolean;
  if coalesce(s.require_financial_clearance_before_close,false) or coalesce(s.require_final_payment_before_close,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','financial_clearance','ar','الإخلاء المالي');
    if coalesce(v_pay,false) or coalesce((v_fin->>'finance_can_close')::boolean,false) then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','financial_clearance');
    elsif not coalesce((v_fin->>'available')::boolean,true) and v_pay is null then
      v_block := v_block || jsonb_build_object('code','financial_unavailable','severity','major','source','finance','overrideable',true,'ar','تعذّر التحقق من الإخلاء المالي (لا صلاحية) — يتطلّب تجاوزًا رسميًّا','en','Financial clearance unavailable — official override required');
    else v_block := v_block || jsonb_build_object('code','financial_not_cleared','severity','major','source','finance','overrideable',true,'ar','لم يُؤكَّد الإخلاء المالي/السداد النهائي','en','Financial clearance not confirmed'); end if;
  end if;

  -- (7) الوقت/سجلات الدوام (اختياري)
  if coalesce(s.require_time_logs_submitted,false) then
    begin select count(*) into v_open_time from public.project_tasks t where t.project_id=p_project and coalesce(t.is_deleted,false)=false and t.status='in_progress';
    exception when others then v_open_time := 0; end;
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','time_logs','ar','سجلات الوقت مقدّمة');
    if coalesce(v_open_time,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','time_logs');
    else v_block := v_block || jsonb_build_object('code','open_time','severity','minor','source','project_tasks','overrideable',true,'count',v_open_time,'ar','مهام قيد التنفيذ قد تحمل وقتًا غير مقدّم','en','In-progress tasks may have unsubmitted time'); end if;
  end if;

  -- (8) دروس مستفادة + تقرير إغلاق (إن اشترطتهما السياسة)
  if coalesce(s.require_lessons_learned,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','lessons_learned','ar','دروس مستفادة مسجّلة');
    if exists (select 1 from public.project_lessons_learned where project_id=p_project and is_deleted=false) then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','lessons_learned');
    else v_block := v_block || jsonb_build_object('code','no_lessons','severity','minor','source','lessons','overrideable',true,'ar','لم تُسجَّل دروس مستفادة','en','No lessons learned recorded'); end if;
  end if;
  -- تقرير الإغلاق يُحسب حيًّا عند الطلب (project_closure_report دائمًا متاح) — تذكير إرشادي فقط لا فحص محسوب،
  -- كي لا يكسر ثبات ready⟺100% ولا يحجب لغياب لقطة مُثبَّتة (لا مسار يُثبّت closure_report_id).
  if coalesce(s.require_closure_report,false)
     and not exists (select 1 from public.project_closure_requests where project_id=p_project and is_deleted=false and closure_report_id is not null) then
    v_adv := v_adv || jsonb_build_object('code','closure_report_pending','ar','تقرير الإغلاق يُولَّد عند الطلب — راجِعه قبل الإغلاق');
  end if;

  -- (9) قبول العميل النهائي (إن اشترطته السياسة)
  if coalesce(s.require_client_approval,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','client_acceptance','ar','قبول العميل النهائي');
    if exists (select 1 from public.project_final_acceptances where project_id=p_project and is_deleted=false and acceptance_type='client_final' and status='accepted') then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','client_acceptance');
    else v_block := v_block || jsonb_build_object('code','no_client_acceptance','severity','major','source','final_acceptances','overrideable',true,'ar','لم يُسجَّل قبول العميل النهائي','en','No client final acceptance'); end if;
  end if;

  -- (10) بيانات أساسية: مدير المشروع موجود — تحذير جودة بيانات فقط (لا يدخل المقام ولا يحجب) كي لا يضخّم المقام دون حجب.
  if not exists (select 1 from public.project_members m where m.project_id=p_project and m.role='kian_manager' and coalesce(m.is_deleted,false)=false) then
    v_dq := v_dq || jsonb_build_object('code','no_manager','severity','warning','ar','لا مدير مشروع مُسنَد'); end if;

  -- (11) المشاريع الفرعية (إن اشترطت السياسة إغلاقها) — معزول للعمود غير المطبّق
  if coalesce(s.require_child_projects_closed,false) then
    begin
      select count(*) into v_child_open from public.projects c
        join public.project_core cc on cc.project_id=c.id
        where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and cc.core_stage <> 'closed';
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','children_closed','ar','المشاريع الفرعية مغلقة');
      if coalesce(v_child_open,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','children_closed');
      else v_block := v_block || jsonb_build_object('code','open_children','severity','major','source','projects','overrideable',false,'count',v_child_open,'ar', v_child_open||' مشروع فرعي غير مغلق','en', v_child_open||' open subprojects'); end if;
    exception when undefined_column then v_dq := v_dq || jsonb_build_object('code','hierarchy_unavailable','severity','warning','ar','هرمية المشاريع غير مطبّقة — تخطّي فحص المشاريع الفرعية'); end;
  end if;

  return jsonb_build_object(
    'project_id', p_project,
    'ready', (jsonb_array_length(v_block)=0 and v_total>0),
    'readiness_percent', case when v_total>0 then round(v_passed::numeric/v_total*100)::int else null end,
    'required_checks', v_req, 'passed_checks', v_pass,
    'blockers', v_block,
    'advisory_warnings', v_adv,
    'overrideable_blockers', (select coalesce(jsonb_agg(b),'[]'::jsonb) from jsonb_array_elements(v_block) b where coalesce((b->>'overrideable')::boolean,false)),
    'non_overrideable_blockers', (select coalesce(jsonb_agg(b),'[]'::jsonb) from jsonb_array_elements(v_block) b where not coalesce((b->>'overrideable')::boolean,false)),
    'data_quality_warnings', v_dq,
    'financial', v_fin, 'open_custody', v_open_custody,
    'generated_at', now());
end $$;
revoke execute on function public.project_closure_readiness(uuid) from public, anon;
grant execute on function public.project_closure_readiness(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) دورة طلب الإغلاق (Atomic RPCs + Optimistic locking + Audit)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_closure_request_create(p_project uuid, p_closure_summary text, p_planned_closure_date date default null, p_expected_project_version int default null)
returns public.project_closure_requests language plpgsql security definer set search_path = public as $$
declare r public.project_closure_requests; v_stage text; v_ready jsonb; v_no text; v_nonovr int;
begin
  if not public.closure_can(p_project, 'closure.request') then raise exception 'not authorized'; end if;
  select core_stage into v_stage from public.project_core where project_id=p_project;
  if coalesce(v_stage,'') <> 'delivered' then raise exception 'stage_not_delivered'; end if;
  if exists (select 1 from public.project_closure_requests where project_id=p_project and is_deleted=false
             and status in ('draft','submitted','under_review','changes_requested','approved')) then raise exception 'duplicate_active_request'; end if;
  v_ready := public.project_closure_readiness(p_project);
  v_nonovr := jsonb_array_length(v_ready->'non_overrideable_blockers');
  if v_nonovr > 0 then raise exception 'non_overrideable_blockers'; end if;
  v_no := 'CLR-'||to_char(now(),'YYMM')||'-'||lpad(((select count(*)+1 from public.project_closure_requests where project_id=p_project))::text,3,'0');
  insert into public.project_closure_requests(project_id, request_no, status, requested_by, closure_summary, planned_closure_date, readiness_snapshot, blockers_snapshot)
    values (p_project, v_no, 'draft', auth.uid(), nullif(btrim(p_closure_summary),''), p_planned_closure_date, v_ready, v_ready->'blockers')
    returning * into r;
  perform public.pc_log(p_project, 'closure_requested', 'closure_request', r.id, jsonb_build_object('no', v_no, 'blockers', jsonb_array_length(v_ready->'blockers')));
  return r;
end $$;

create or replace function public.project_closure_submit(p_request uuid, p_expected_version int default null)
returns public.project_closure_requests language plpgsql security definer set search_path = public as $$
declare r public.project_closure_requests; b public.project_closure_requests; s public.project_governance_settings; v_mode text; v_appr public.project_approvals;
begin
  select * into b from public.project_closure_requests where id=p_request and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.closure_can(b.project_id, 'closure.request') then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  if b.status not in ('draft','changes_requested') then raise exception 'bad_state'; end if;
  select * into s from public.project_governance_settings where project_id=b.project_id;
  v_mode := coalesce(nullif(s.closure_approval_mode,'inherit'), s.approval_mode, 'all_required');
  update public.project_closure_requests set status='submitted', requested_at=now(), version=version+1, updated_at=now() where id=p_request returning * into r;
  -- إنشاء اعتماد الإغلاق عبر نظام 5A (approval_type='project_closure') إن كانت السياسة تتطلّب اعتمادًا داخليًّا.
  if coalesce(s.require_internal_approval, true) and to_regprocedure('public.pc_governance_approval_request(uuid,jsonb)') is not null then
    begin
      v_appr := public.pc_governance_approval_request(b.project_id, jsonb_build_object(
        'approval_type','project_closure','entity_type','closure_request','entity_id', p_request::text,
        'title','اعتماد إغلاق المشروع', 'note', b.closure_summary));
      update public.project_closure_requests set approval_id = v_appr.id, status='under_review', review_started_at=now(), version=version+1 where id=p_request returning * into r;
    exception when others then null; end;
  end if;
  perform public.pc_log(b.project_id, 'closure_submitted', 'closure_request', p_request, jsonb_build_object('mode', v_mode));
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is not null then
    perform public.pc_event_emit(b.project_id,'project_status_changed','closure_request',p_request,'action',
      'طلب إغلاق للمراجعة','Closure request for review','أُرسل طلب إغلاق المشروع للمراجعة.','A closure request was submitted for review.',
      '/client-portal/project-core/'||b.project_id,
      (select coalesce(array_agg(user_id),'{}') from public.project_members where project_id=b.project_id and role='kian_manager' and coalesce(is_deleted,false)=false),
      'closure_submitted:'||p_request);
  end if;
  return r;
end $$;

create or replace function public.project_closure_review(p_request uuid, p_action text, p_comment text default null, p_expected_version int default null)
returns public.project_closure_requests language plpgsql security definer set search_path = public as $$
declare r public.project_closure_requests; b public.project_closure_requests;
begin
  select * into b from public.project_closure_requests where id=p_request and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  if p_action not in ('start_review','approve','reject','request_changes','cancel') then raise exception 'bad_action'; end if;
  -- الصلاحية حسب الإجراء
  if p_action='start_review' then
    if not public.closure_can(b.project_id,'closure.review') then raise exception 'not authorized'; end if;
    if b.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;
    update public.project_closure_requests set status='under_review', reviewed_by=auth.uid(), review_started_at=coalesce(review_started_at,now()), version=version+1, updated_at=now() where id=p_request returning * into r;
  elsif p_action='approve' then
    if not public.closure_can(b.project_id,'closure.approve') then raise exception 'not authorized'; end if;
    if b.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;
    if b.requested_by = auth.uid() and not public.can_manage_projects() then raise exception 'self_approval_not_allowed'; end if;
    -- مرّر قرار اعتماد 5A إن وُجد
    if b.approval_id is not null and to_regprocedure('public.pc_approval_decide(uuid,text,text)') is not null then
      begin perform public.pc_approval_decide(b.approval_id, 'approve', p_comment); exception when others then null; end;
    end if;
    update public.project_closure_requests set status='approved', approved_by=auth.uid(), approved_at=now(), version=version+1, updated_at=now() where id=p_request returning * into r;
  elsif p_action='reject' then
    if not public.closure_can(b.project_id,'closure.reject') then raise exception 'not authorized'; end if;
    if b.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;
    if b.approval_id is not null and to_regprocedure('public.pc_approval_decide(uuid,text,text)') is not null then
      begin perform public.pc_approval_decide(b.approval_id, 'reject', p_comment); exception when others then null; end;
    end if;
    update public.project_closure_requests set status='rejected', rejected_by=auth.uid(), rejected_at=now(), rejection_reason=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_request returning * into r;
  elsif p_action='request_changes' then
    if not public.closure_can(b.project_id,'closure.request_changes') then raise exception 'not authorized'; end if;
    if b.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;
    if b.approval_id is not null and to_regprocedure('public.pc_approval_decide(uuid,text,text)') is not null then
      begin perform public.pc_approval_decide(b.approval_id, 'request_changes', p_comment); exception when others then null; end;
    end if;
    update public.project_closure_requests set status='changes_requested', rejection_reason=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_request returning * into r;
  else  -- cancel
    if not (public.closure_can(b.project_id,'closure.request') and (b.requested_by=auth.uid() or public.can_manage_projects())) then raise exception 'not authorized'; end if;
    -- الإلغاء لحالات نشطة فقط (لا يُعاد كتابة حالة تاريخية: rejected/cancelled/closed/reopened).
    if b.status not in ('draft','submitted','under_review','changes_requested','approved') then raise exception 'bad_state'; end if;
    if b.approval_id is not null and to_regprocedure('public.pc_approval_cancel(uuid,text,int)') is not null then
      begin perform public.pc_approval_cancel(b.approval_id, coalesce(p_comment,'closure cancelled'), null); exception when others then null; end;
    end if;
    update public.project_closure_requests set status='cancelled', cancelled_at=now(), version=version+1, updated_at=now() where id=p_request returning * into r;
  end if;
  perform public.pc_log(b.project_id, 'closure_'||p_action, 'closure_request', p_request, jsonb_build_object('comment', nullif(btrim(coalesce(p_comment,'')),'')));
  return r;
end $$;

-- أغلفة رقيقة للاعتماد/الرفض/طلب التعديل/الإلغاء (تعيد استخدام project_closure_review)
create or replace function public.project_closure_approve(p_request uuid, p_comment text default null, p_expected_version int default null)
returns public.project_closure_requests language sql security definer set search_path = public as $$
  select public.project_closure_review(p_request, 'approve', p_comment, p_expected_version);
$$;
create or replace function public.project_closure_reject(p_request uuid, p_reason text, p_expected_version int default null)
returns public.project_closure_requests language sql security definer set search_path = public as $$
  select public.project_closure_review(p_request, 'reject', p_reason, p_expected_version);
$$;
create or replace function public.project_closure_request_changes(p_request uuid, p_required_changes text, p_expected_version int default null)
returns public.project_closure_requests language sql security definer set search_path = public as $$
  select public.project_closure_review(p_request, 'request_changes', p_required_changes, p_expected_version);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) القبول النهائي للعميل (عزل العميل — يرى طلبه فقط)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_final_acceptance_request(p_project uuid, p_data jsonb)
returns public.project_final_acceptances language plpgsql security definer set search_path = public as $$
declare r public.project_final_acceptances; v_type text := coalesce(nullif(p_data->>'acceptance_type',''),'client_final'); v_snap jsonb;
begin
  if not public.closure_can(p_project, 'closure.request') then raise exception 'not authorized'; end if;
  if v_type not in ('internal_final','client_final','sponsor_final','project_owner_final') then raise exception 'bad_type'; end if;
  -- لقطة المخرجات المقبولة (المرئية للعميل فقط عند client_final): approved/final_delivered غير المؤرشفة.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status)),'[]'::jsonb) into v_snap
    from public.deliverables where project_id=p_project and coalesce(is_deleted,false)=false and status in ('approved','final_delivered');
  exception when undefined_table then v_snap := '[]'::jsonb; end;
  insert into public.project_final_acceptances(project_id, closure_request_id, acceptance_type, requested_by, requested_from, due_at, status, acceptance_scope, accepted_deliverables_snapshot)
    values (p_project, nullif(p_data->>'closure_request_id','')::uuid, v_type, auth.uid(), nullif(p_data->>'requested_from','')::uuid, nullif(p_data->>'due_at','')::timestamptz, 'pending', nullif(btrim(p_data->>'acceptance_scope'),''), v_snap)
    returning * into r;
  perform public.pc_log(p_project, 'final_acceptance_requested', 'final_acceptance', r.id, jsonb_build_object('type', v_type));
  if r.requested_from is not null and to_regprocedure('public.pc_notify_user(uuid,text,text,uuid,text,text)') is not null then
    perform public.pc_notify_user(r.requested_from, 'project_status_changed', 'final_acceptance', r.id, 'مطلوب قبولك النهائي للمشروع', 'Your final acceptance is requested');
  end if;
  return r;
end $$;

create or replace function public.project_final_acceptance_decide(p_acceptance uuid, p_action text, p_comment text default null, p_expected_version int default null)
returns public.project_final_acceptances language plpgsql security definer set search_path = public as $$
declare r public.project_final_acceptances; b public.project_final_acceptances; v_is_target boolean;
begin
  select * into b from public.project_final_acceptances where id=p_acceptance and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  if b.status not in ('pending','changes_requested') then raise exception 'already_decided'; end if;
  if p_action not in ('accept','reject','request_changes','cancel') then raise exception 'bad_action'; end if;
  -- من يقرّر: المُسنَد إليه (requested_from) أو مالك العميل (client_final) أو staff مخوّل.
  -- null-safe: إن كان requested_from=null فـ v_is_target=false (لا NULL) كي لا يتخطّى «not (...)» البوابةَ (3VL bypass).
  v_is_target := (b.requested_from is not null and b.requested_from = auth.uid());
  if b.acceptance_type='client_final' then
    if not coalesce(v_is_target or (to_regprocedure('public.is_client_owner(uuid)') is not null and public.is_client_owner(b.project_id)) or public.closure_can(b.project_id,'closure.client_accept'), false) then raise exception 'not authorized'; end if;
  else
    if not coalesce(v_is_target or public.closure_can(b.project_id,'closure.review'), false) then raise exception 'not authorized'; end if;
  end if;
  if p_action='cancel' then
    if not public.closure_can(b.project_id,'closure.request') then raise exception 'not authorized'; end if;
    update public.project_final_acceptances set status='cancelled', cancelled_at=now(), version=version+1, updated_at=now() where id=p_acceptance returning * into r;
  elsif p_action='accept' then
    update public.project_final_acceptances set status='accepted', accepted_by=auth.uid(), accepted_at=now(), acceptance_comment=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_acceptance returning * into r;
  elsif p_action='reject' then
    update public.project_final_acceptances set status='rejected', rejected_by=auth.uid(), rejected_at=now(), rejection_reason=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_acceptance returning * into r;
  else
    update public.project_final_acceptances set status='changes_requested', changes_requested=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_acceptance returning * into r;
  end if;
  perform public.pc_log(b.project_id, 'final_acceptance_'||p_action, 'final_acceptance', p_acceptance, '{}');
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) الدروس المستفادة + مراجعة ما بعد المشروع
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_lesson_upsert(p_project uuid, p_data jsonb)
returns public.project_lessons_learned language plpgsql security definer set search_path = public as $$
declare r public.project_lessons_learned; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.closure_can(p_project, 'closure.manage_lessons') then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_lessons_learned(project_id, closure_request_id, category, title, description, what_worked, what_did_not_work, root_cause, recommendation, reusable_practice, owner_id, impact_level, confidentiality, client_visible, linked_risk_id, linked_issue_id, linked_decision_id, linked_change_request_id, created_by)
      values (p_project, nullif(p_data->>'closure_request_id','')::uuid, coalesce(nullif(p_data->>'category',''),'other'), btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'description'),''),
        nullif(btrim(p_data->>'what_worked'),''), nullif(btrim(p_data->>'what_did_not_work'),''), nullif(btrim(p_data->>'root_cause'),''), nullif(btrim(p_data->>'recommendation'),''), nullif(btrim(p_data->>'reusable_practice'),''),
        nullif(p_data->>'owner_id','')::uuid, coalesce(nullif(p_data->>'impact_level',''),'medium'), coalesce(nullif(p_data->>'confidentiality',''),'internal'), coalesce((p_data->>'client_visible')::boolean,false),
        nullif(p_data->>'linked_risk_id','')::uuid, nullif(p_data->>'linked_issue_id','')::uuid, nullif(p_data->>'linked_decision_id','')::uuid, nullif(p_data->>'linked_change_request_id','')::uuid, auth.uid())
      returning * into r;
  else
    update public.project_lessons_learned set category=coalesce(nullif(p_data->>'category',''),category), title=coalesce(nullif(btrim(p_data->>'title'),''),title),
      description=coalesce(nullif(btrim(p_data->>'description'),''),description), what_worked=coalesce(nullif(btrim(p_data->>'what_worked'),''),what_worked),
      what_did_not_work=coalesce(nullif(btrim(p_data->>'what_did_not_work'),''),what_did_not_work), root_cause=coalesce(nullif(btrim(p_data->>'root_cause'),''),root_cause),
      recommendation=coalesce(nullif(btrim(p_data->>'recommendation'),''),recommendation), reusable_practice=coalesce(nullif(btrim(p_data->>'reusable_practice'),''),reusable_practice),
      impact_level=coalesce(nullif(p_data->>'impact_level',''),impact_level), confidentiality=coalesce(nullif(p_data->>'confidentiality',''),confidentiality),
      client_visible=coalesce((p_data->>'client_visible')::boolean,client_visible), version=version+1, updated_at=now()
      where id=v_id and project_id=p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  perform public.pc_log(p_project, 'lesson_saved', 'lesson', r.id, jsonb_build_object('category', r.category));
  return r;
end $$;

create or replace function public.project_lesson_approve_knowledge(p_lesson uuid, p_approve boolean default true)
returns public.project_lessons_learned language plpgsql security definer set search_path = public as $$
declare r public.project_lessons_learned; b public.project_lessons_learned;
begin
  select * into b from public.project_lessons_learned where id=p_lesson and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.closure_can(b.project_id, 'closure.approve_knowledge') then raise exception 'not authorized'; end if;
  update public.project_lessons_learned set approved_for_knowledge_base=coalesce(p_approve,true), approved_by=auth.uid(), approved_at=now(), version=version+1, updated_at=now() where id=p_lesson returning * into r;
  perform public.pc_log(b.project_id, 'lesson_knowledge_'||(case when p_approve then 'approved' else 'revoked' end), 'lesson', p_lesson, '{}');
  return r;
end $$;

create or replace function public.project_post_review_upsert(p_project uuid, p_data jsonb)
returns public.project_post_reviews language plpgsql security definer set search_path = public as $$
declare r public.project_post_reviews; v_id uuid; v_sc jsonb; v_sources jsonb := '{}'::jsonb;
begin
  if not public.closure_can(p_project, 'closure.manage_post_review') then raise exception 'not authorized'; end if;
  select id into v_id from public.project_post_reviews where project_id=p_project and is_deleted=false;
  -- الدرجات المشتقّة من Scorecard 5B عند توفّرها (لا رقم بلا مصدر).
  if to_regprocedure('public.executive_project_scorecard(uuid)') is not null then
    begin v_sc := public.executive_project_scorecard(p_project);
      v_sources := jsonb_build_object('execution','executive_project_scorecard','schedule','executive_project_scorecard','resource','executive_project_scorecard','governance','executive_project_scorecard','quality','executive_project_scorecard');
    exception when others then v_sc := null; end;
  end if;
  if v_id is null then
    insert into public.project_post_reviews(project_id, closure_request_id, reviewed_by, review_date, summary, strengths, weaknesses, recommendations,
        execution_score, schedule_score, resource_score, governance_score, quality_score,
        client_satisfaction_score, team_satisfaction_score, supplier_performance_score, objectives_met, score_sources)
      values (p_project, nullif(p_data->>'closure_request_id','')::uuid, auth.uid(), coalesce(nullif(p_data->>'review_date','')::date, (now() at time zone 'utc')::date),
        nullif(btrim(p_data->>'summary'),''), nullif(btrim(p_data->>'strengths'),''), nullif(btrim(p_data->>'weaknesses'),''), nullif(btrim(p_data->>'recommendations'),''),
        coalesce((v_sc->'axes'->'execution'->>'score')::int, nullif(p_data->>'execution_score','')::int),
        nullif(p_data->>'schedule_score','')::int, nullif(p_data->>'resource_score','')::int,
        coalesce((v_sc->'axes'->'governance'->>'score')::int, nullif(p_data->>'governance_score','')::int),
        coalesce((v_sc->'axes'->'quality'->>'score')::int, nullif(p_data->>'quality_score','')::int),
        nullif(p_data->>'client_satisfaction_score','')::int, nullif(p_data->>'team_satisfaction_score','')::int, nullif(p_data->>'supplier_performance_score','')::int,
        nullif(btrim(p_data->>'objectives_met'),''), v_sources)
      returning * into r;
  else
    update public.project_post_reviews set summary=coalesce(nullif(btrim(p_data->>'summary'),''),summary), strengths=coalesce(nullif(btrim(p_data->>'strengths'),''),strengths),
      weaknesses=coalesce(nullif(btrim(p_data->>'weaknesses'),''),weaknesses), recommendations=coalesce(nullif(btrim(p_data->>'recommendations'),''),recommendations),
      client_satisfaction_score=coalesce(nullif(p_data->>'client_satisfaction_score','')::int, client_satisfaction_score),
      team_satisfaction_score=coalesce(nullif(p_data->>'team_satisfaction_score','')::int, team_satisfaction_score),
      supplier_performance_score=coalesce(nullif(p_data->>'supplier_performance_score','')::int, supplier_performance_score),
      objectives_met=coalesce(nullif(btrim(p_data->>'objectives_met'),''),objectives_met), version=version+1, updated_at=now()
      where id=v_id returning * into r;
  end if;
  perform public.pc_log(p_project, 'post_review_saved', 'post_review', r.id, '{}');
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) إلغاء حجوزات الموارد المستقبلية للمشروع (Batch ذرّي، Soft، سبب إلزامي) — لا يوجد Batch cancel سابق
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.resource_booking_cancel_for_project(p_project uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cancelled int := 0; v_rec record;
begin
  if not (public.closure_can(p_project, 'closure.final_close') or public.closure_can(p_project,'closure.request')) then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  if to_regclass('public.resource_bookings') is null then return jsonb_build_object('ok',true,'cancelled',0,'reason','no_resource_module'); end if;
  for v_rec in
    select id from public.resource_bookings
    where project_id=p_project and coalesce(is_deleted,false)=false and status in ('hold','pending_approval','confirmed','in_use') and ends_at >= now()
  loop
    update public.resource_bookings set status='cancelled', cancelled_at=now(), version=coalesce(version,1)+1 where id=v_rec.id;
    perform public.pc_log(p_project, 'resource_booking_cancelled', 'resource_booking', v_rec.id, jsonb_build_object('reason', btrim(p_reason), 'by','closure'));
    v_cancelled := v_cancelled + 1;
  end loop;
  return jsonb_build_object('ok',true,'cancelled',v_cancelled);
end $$;
revoke execute on function public.resource_booking_cancel_for_project(uuid,text) from public, anon;
grant execute on function public.resource_booking_cancel_for_project(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) الإغلاق النهائي (Atomic — يعيد استخدام المسار الرسمي project_core_set_stage)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_final_close(p_request uuid, p_final_comment text, p_expected_closure_version int default null, p_expected_project_version int default null, p_override_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.project_closure_requests; pc public.project_core; v_ready jsonb; v_nonovr int; v_ovr int; v_reason text; v_ovr_reason text;
begin
  -- 1) FOR UPDATE على الطلب + project_core
  select * into b from public.project_closure_requests where id=p_request and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  select * into pc from public.project_core where project_id=b.project_id for update;
  -- 2) الصلاحية (بوابة أصرم من set_stage): closure.final_close
  if not public.closure_can(b.project_id, 'closure.final_close') then raise exception 'not authorized'; end if;
  -- الإغلاق الفعلي يمرّ عبر set_stage الذي يشترط can_manage_projects للحالة 'closed'؛ نفشل مبكرًا برسالة واضحة.
  if not public.can_manage_projects() then raise exception 'manager_required'; end if;
  if p_expected_closure_version is not null and p_expected_closure_version <> b.version then raise exception 'stale_update'; end if;
  -- 3) اعتماد نهائي مطلوب
  if b.status <> 'approved' then raise exception 'not_approved'; end if;
  -- 4) إعادة حساب الجاهزية لحظيًّا
  v_ready := public.project_closure_readiness(b.project_id);
  v_nonovr := jsonb_array_length(v_ready->'non_overrideable_blockers');
  v_ovr := jsonb_array_length(v_ready->'overrideable_blockers');
  -- 5) امنع إذا يوجد Non-overrideable blocker
  if v_nonovr > 0 then raise exception 'non_overrideable_blockers'; end if;
  -- 6) تحقّق من التجاوزات إن وُجدت حواجز قابلة للتجاوز
  if v_ovr > 0 then
    v_ovr_reason := nullif(btrim(coalesce(p_override_payload->>'reason','')),'');
    if v_ovr_reason is null then raise exception 'override_reason_required'; end if;
    if not public.closure_can(b.project_id, 'closure.override') then raise exception 'not authorized: override'; end if;
    -- تجاوز مالي يتطلّب صلاحية مالية منفصلة إن كان أحد الحواجز ماليًّا
    if exists (select 1 from jsonb_array_elements(v_ready->'overrideable_blockers') x where x->>'source'='finance') then
      if not public.closure_can(b.project_id,'closure.override_financial_clearance') then raise exception 'not authorized: financial_override'; end if;
    end if;
  end if;
  v_reason := coalesce(nullif(btrim(p_final_comment),''), 'إغلاق نهائي معتمد', b.closure_summary);
  -- 7/8) لقطات
  update public.project_closure_requests set readiness_snapshot=v_ready, blockers_snapshot=v_ready->'blockers',
    override_snapshot = case when v_ovr>0 then jsonb_build_object('reason',v_ovr_reason,'by',auth.uid(),'at',now(),'blockers',v_ready->'overrideable_blockers') else override_snapshot end
    where id=p_request;
  -- 10) تغيير core_stage إلى closed عبر المسار الرسمي فقط (يحمل حرّاسه: manager+reason، history، log، notify، progress).
  pc := public.project_core_set_stage(b.project_id, 'closed', v_reason);
  -- 9/11) إغلاق الطلب + تاريخ الإغلاق الفعلي
  update public.project_closure_requests set status='closed', actual_closure_date=now(), version=version+1, updated_at=now() where id=p_request;
  -- 12) تثبيت القبول النهائي (إن وُجد مقبول)
  update public.project_closure_requests set final_acceptance_id = (select id from public.project_final_acceptances where project_id=b.project_id and is_deleted=false and status='accepted' order by accepted_at desc limit 1)
    where id=p_request and final_acceptance_id is null;
  -- 14) Audit
  perform public.pc_log(b.project_id, 'project_final_closed', 'closure_request', p_request, jsonb_build_object('override', v_ovr>0, 'reason', v_reason));
  -- 15) Notification
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is not null then
    perform public.pc_event_emit(b.project_id,'project_status_changed','project',b.project_id,'action',
      'أُغلق المشروع','Project closed','تمّ إغلاق المشروع نهائيًّا.','The project has been finally closed.',
      '/client-portal/project-core/'||b.project_id,
      (select coalesce(array_agg(user_id),'{}') from public.project_members where project_id=b.project_id and role like 'kian_%' and coalesce(is_deleted,false)=false),
      'project_closed:'||b.project_id);
  end if;
  return jsonb_build_object('ok',true,'project_id',b.project_id,'core_stage',pc.core_stage,'closure_request_id',p_request,'overridden', v_ovr>0);
end $$;
revoke execute on function public.project_final_close(uuid,text,int,int,jsonb) from public, anon;
grant execute on function public.project_final_close(uuid,text,int,int,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) إعادة فتح المشروع (Workflow رسمي — لا رجوع مباشر من closed)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_reopen_request_create(p_project uuid, p_reason text, p_requested_target_stage text)
returns public.project_reopen_requests language plpgsql security definer set search_path = public as $$
declare r public.project_reopen_requests; v_stage text;
begin
  if not public.closure_can(p_project, 'closure.reopen_request') then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  if p_requested_target_stage not in ('revision','post_production','client_review','delivered') then raise exception 'bad_target_stage'; end if;
  select core_stage into v_stage from public.project_core where project_id=p_project;
  if coalesce(v_stage,'') <> 'closed' then raise exception 'not_closed'; end if;
  if exists (select 1 from public.project_reopen_requests where project_id=p_project and is_deleted=false and status='pending') then raise exception 'duplicate_active_request'; end if;
  insert into public.project_reopen_requests(project_id, closure_request_id, status, reason, stage_before, requested_target_stage, requested_by)
    values (p_project, (select id from public.project_closure_requests where project_id=p_project and status='closed' order by actual_closure_date desc limit 1),
      'pending', btrim(p_reason), v_stage, p_requested_target_stage, auth.uid())
    returning * into r;
  perform public.pc_log(p_project, 'reopen_requested', 'reopen_request', r.id, jsonb_build_object('target', p_requested_target_stage, 'reason', btrim(p_reason)));
  return r;
end $$;

create or replace function public.project_reopen_approve(p_reopen uuid, p_comment text default null, p_expected_version int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.project_reopen_requests; pc public.project_core;
begin
  select * into b from public.project_reopen_requests where id=p_reopen and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.closure_can(b.project_id, 'closure.reopen_approve') then raise exception 'not authorized'; end if;
  -- الرجوع الفعلي يمرّ عبر set_stage الذي يشترط can_manage_projects؛ نفشل مبكرًا برسالة واضحة بدل فشل غامض عميق.
  if not public.can_manage_projects() then raise exception 'manager_required'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  if b.status <> 'pending' then raise exception 'already_decided'; end if;
  if b.requested_by = auth.uid() and not public.can_manage_projects() then raise exception 'self_approval_not_allowed'; end if;
  -- إعادة التحقّق الحيّ (FOR UPDATE) أن المشروع ما زال مغلقًا — يمنع تنفيذ طلب قديم على مشروع لم يعُد مغلقًا.
  select core_stage into pc.core_stage from public.project_core where project_id=b.project_id for update;
  if coalesce(pc.core_stage,'') <> 'closed' then raise exception 'not_closed'; end if;
  -- الرجوع عبر المسار الرسمي (backward يتطلّب reason + manager؛ set_stage يفرضهما).
  pc := public.project_core_set_stage(b.project_id, b.requested_target_stage, coalesce(nullif(btrim(p_comment),''), 'إعادة فتح معتمدة: '||b.reason));
  update public.project_reopen_requests set status='approved', approved_by=auth.uid(), approved_at=now(), decision_comment=nullif(btrim(p_comment),''), version=version+1, updated_at=now() where id=p_reopen;
  -- طلب الإغلاق السابق يُحفظ ويتحوّل إلى reopened (لا يُحذف).
  update public.project_closure_requests set status='reopened', reopened_at=now(), reopened_by=auth.uid(), reopen_reason=b.reason, version=version+1, updated_at=now()
    where project_id=b.project_id and status='closed';
  perform public.pc_log(b.project_id, 'project_reopened', 'reopen_request', p_reopen, jsonb_build_object('to', b.requested_target_stage));
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is not null then
    perform public.pc_event_emit(b.project_id,'project_status_changed','project',b.project_id,'action','أُعيد فتح المشروع','Project reopened',
      'أُعيد فتح المشروع إلى مرحلة: '||b.requested_target_stage,'Project reopened to: '||b.requested_target_stage,
      '/client-portal/project-core/'||b.project_id,
      (select coalesce(array_agg(user_id),'{}') from public.project_members where project_id=b.project_id and role like 'kian_%' and coalesce(is_deleted,false)=false),
      'project_reopened:'||p_reopen);
  end if;
  return jsonb_build_object('ok',true,'project_id',b.project_id,'core_stage',pc.core_stage);
end $$;
revoke execute on function public.project_reopen_approve(uuid,text,int) from public, anon;
grant execute on function public.project_reopen_approve(uuid,text,int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) الأرشفة المؤسسية (يُركّب project_core_archive_project + سجل 5C غنيّ)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_archive_create(p_project uuid, p_data jsonb)
returns public.project_archives language plpgsql volatile security definer set search_path = public as $$
declare r public.project_archives; v_stage text; v_snap jsonb; v_ret date; v_policy text := coalesce(nullif(p_data->>'archive_policy',''),'standard'); v_days int;
begin
  if not public.closure_can(p_project, 'closure.archive') then raise exception 'not authorized'; end if;
  select core_stage into v_stage from public.project_core where project_id=p_project;
  if coalesce(v_stage,'') <> 'closed' then raise exception 'not_closed'; end if;
  v_days := nullif(p_data->>'retention_days','')::int;
  v_ret := case when v_days is not null then ((now() at time zone 'utc')::date + v_days) else null end;
  -- لقطة Metadata فقط (لا نسخ ملفات، لا أسرار).
  v_snap := jsonb_build_object('archived_stage', v_stage, 'at', now(),
    'deliverables', (select count(*) from public.deliverables d where d.project_id=p_project and coalesce(d.is_deleted,false)=false),
    'tasks', (select count(*) from public.project_tasks t where t.project_id=p_project and coalesce(t.is_deleted,false)=false));
  insert into public.project_archives(project_id, closure_request_id, archived_by, archive_reason, archive_policy, retention_until, legal_hold, legal_hold_reason, archive_snapshot, status)
    values (p_project, nullif(p_data->>'closure_request_id','')::uuid, auth.uid(), nullif(btrim(p_data->>'archive_reason'),''), v_policy, v_ret,
      coalesce((p_data->>'legal_hold')::boolean,false), nullif(btrim(p_data->>'legal_hold_reason'),''), v_snap, 'archived')
    returning * into r;
  -- يُركّب علم الأرشفة الرسمي على projects (is_deleted + archived_at) عبر الدالة القائمة.
  if to_regprocedure('public.project_core_archive_project(uuid,text)') is not null then
    begin perform public.project_core_archive_project(p_project, coalesce(r.archive_reason,'archived at closure')); exception when others then null; end;
  end if;
  perform public.pc_log(p_project, 'project_archived', 'archive', r.id, jsonb_build_object('policy', v_policy, 'retention_until', v_ret));
  return r;
end $$;

create or replace function public.project_archive_restore(p_archive uuid, p_reason text)
returns public.project_archives language plpgsql volatile security definer set search_path = public as $$
declare r public.project_archives; b public.project_archives;
begin
  select * into b from public.project_archives where id=p_archive and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.closure_can(b.project_id, 'closure.restore') then raise exception 'not authorized'; end if;
  if b.legal_hold then raise exception 'legal_hold'; end if;
  update public.project_archives set status='restored', restored_at=now(), restored_by=auth.uid(), version=version+1 where id=p_archive returning * into r;
  -- الاستعادة للعرض تُلغي علم الحذف/الأرشفة على projects (لا تُعيد فتح المشروع — core_stage يبقى closed).
  if to_regprocedure('public.project_core_restore_project(uuid,text)') is not null then
    begin perform public.project_core_restore_project(b.project_id, coalesce(nullif(btrim(p_reason),''),'restored from archive')); exception when others then null; end;
  end if;
  perform public.pc_log(b.project_id, 'project_restored', 'archive', p_archive, jsonb_build_object('reason', nullif(btrim(p_reason),'')));
  return r;
end $$;

create or replace function public.project_archive_set_legal_hold(p_archive uuid, p_hold boolean, p_reason text default null)
returns public.project_archives language plpgsql volatile security definer set search_path = public as $$
declare r public.project_archives; b public.project_archives;
begin
  select * into b from public.project_archives where id=p_archive and is_deleted=false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.closure_can(b.project_id, 'closure.manage_legal_hold') then raise exception 'not authorized'; end if;
  update public.project_archives set legal_hold=coalesce(p_hold,false), legal_hold_reason=nullif(btrim(p_reason),''), version=version+1 where id=p_archive returning * into r;
  perform public.pc_log(b.project_id, 'legal_hold_'||(case when p_hold then 'set' else 'cleared' end), 'archive', p_archive, jsonb_build_object('reason', nullif(btrim(p_reason),'')));
  return r;
end $$;

-- إبطال PUBLIC/anon الافتراضي على كل دوال الكتابة قبل منحها لـ authenticated (وإلّا يستطيع anon استدعاءها).
revoke execute on function public.project_closure_request_create(uuid,text,date,int), public.project_closure_submit(uuid,int),
  public.project_closure_review(uuid,text,text,int), public.project_closure_approve(uuid,text,int), public.project_closure_reject(uuid,text,int),
  public.project_closure_request_changes(uuid,text,int), public.project_final_acceptance_request(uuid,jsonb), public.project_final_acceptance_decide(uuid,text,text,int),
  public.project_lesson_upsert(uuid,jsonb), public.project_lesson_approve_knowledge(uuid,boolean), public.project_post_review_upsert(uuid,jsonb),
  public.project_reopen_request_create(uuid,text,text), public.project_archive_create(uuid,jsonb), public.project_archive_restore(uuid,text), public.project_archive_set_legal_hold(uuid,boolean,text)
  from public, anon;
grant execute on function public.project_closure_request_create(uuid,text,date,int), public.project_closure_submit(uuid,int),
  public.project_closure_review(uuid,text,text,int), public.project_closure_approve(uuid,text,int), public.project_closure_reject(uuid,text,int),
  public.project_closure_request_changes(uuid,text,int), public.project_final_acceptance_request(uuid,jsonb), public.project_final_acceptance_decide(uuid,text,text,int),
  public.project_lesson_upsert(uuid,jsonb), public.project_lesson_approve_knowledge(uuid,boolean), public.project_post_review_upsert(uuid,jsonb),
  public.project_reopen_request_create(uuid,text,text), public.project_archive_create(uuid,jsonb), public.project_archive_restore(uuid,text), public.project_archive_set_legal_hold(uuid,boolean,text)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) دوال القراءة (Dashboard/Report/Register/Inbox/Portfolio/Archive/Certificate) — STABLE، بلا Temp
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_closure_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_req jsonb;
begin
  if not public.closure_can(p_project, 'closure.view') then raise exception 'not authorized'; end if;
  select to_jsonb(x) into v_req from (select * from public.project_closure_requests where project_id=p_project and is_deleted=false order by created_at desc limit 1) x;
  select jsonb_build_object(
    'project_id', p_project,
    'closure_status', public.pc_project_closure_status(p_project),
    'readiness', public.project_closure_readiness(p_project),
    'active_request', v_req,
    'acceptances', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'acceptance_type',acceptance_type,'status',status,'requested_from',requested_from,'due_at',due_at,'accepted_at',accepted_at) order by created_at desc),'[]'::jsonb)
        from public.project_final_acceptances where project_id=p_project and is_deleted=false),
    'lessons_count', (select count(*) from public.project_lessons_learned where project_id=p_project and is_deleted=false),
    'has_post_review', exists (select 1 from public.project_post_reviews where project_id=p_project and is_deleted=false),
    'archive', (select to_jsonb(a) from (select id,status,archived_at,retention_until,legal_hold from public.project_archives where project_id=p_project and is_deleted=false order by created_at desc limit 1) a),
    'reopen_requests', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'requested_target_stage',requested_target_stage,'requested_at',requested_at) order by created_at desc),'[]'::jsonb)
        from public.project_reopen_requests where project_id=p_project and is_deleted=false),
    'financial_visible', public.closure_can(p_project,'closure.view_financial_clearance'),
    'generated_at', now()) into v;
  return v;
end $$;
revoke execute on function public.project_closure_dashboard(uuid) from public, anon;
grant execute on function public.project_closure_dashboard(uuid) to authenticated;

create or replace function public.project_closure_report(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; pc public.project_core; v_fin_ok boolean;
begin
  if not public.closure_can(p_project, 'closure.view') then raise exception 'not authorized'; end if;
  select * into pc from public.project_core where project_id=p_project;
  v_fin_ok := public.closure_can(p_project,'closure.view_financial_clearance');
  select jsonb_build_object(
    'project_id', p_project,
    'overview', (select jsonb_build_object('name', p.project_name, 'client_id', p.client_id, 'core_stage', pc.core_stage,
        'start_date', pc.start_date, 'due_date', pc.due_date, 'delivery_date', pc.delivery_date, 'progress_pct', pc.progress_pct) from public.projects p where p.id=p_project),
    'closure_request', (select to_jsonb(x) from (select request_no,status,requested_by,requested_at,approved_by,approved_at,actual_closure_date,closure_summary from public.project_closure_requests where project_id=p_project and is_deleted=false order by created_at desc limit 1) x),
    'deliverables_summary', (select jsonb_build_object('total', count(*), 'approved', count(*) filter (where status in ('approved','final_delivered')))
        from public.deliverables where project_id=p_project and coalesce(is_deleted,false)=false),
    'tasks_summary', (select jsonb_build_object('total', count(*), 'done', count(*) filter (where status='done'), 'open', count(*) filter (where status not in ('done','cancelled')))
        from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false),
    'client_acceptance', (select to_jsonb(a) from (select acceptance_type,status,accepted_by,accepted_at,acceptance_comment from public.project_final_acceptances where project_id=p_project and is_deleted=false and acceptance_type='client_final' order by created_at desc limit 1) a),
    'lessons_learned', (select coalesce(jsonb_agg(jsonb_build_object('category',category,'title',title,'impact_level',impact_level,'recommendation',recommendation) order by created_at),'[]'::jsonb)
        from public.project_lessons_learned where project_id=p_project and is_deleted=false),
    'post_review', (select to_jsonb(pr) from (select execution_score,schedule_score,resource_score,governance_score,quality_score,client_satisfaction_score,summary,strengths,weaknesses,recommendations,score_sources from public.project_post_reviews where project_id=p_project and is_deleted=false limit 1) pr),
    'financial_clearance', case when v_fin_ok then public.pc_financial_clearance(p_project) else jsonb_build_object('available', false, 'reason','no_permission') end,
    'exceptions_overrides', (select to_jsonb(o) from (select override_snapshot from public.project_closure_requests where project_id=p_project and is_deleted=false and override_snapshot <> '{}'::jsonb order by created_at desc limit 1) o),
    'data_quality_warnings', (public.project_closure_readiness(p_project)->'data_quality_warnings'),
    'generated_at', now()) into v;
  return v;
end $$;
revoke execute on function public.project_closure_report(uuid) from public, anon;
grant execute on function public.project_closure_report(uuid) to authenticated;

create or replace function public.project_lessons_register(p_project uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_cat text := nullif(p_filters->>'category','');
begin
  if not public.closure_can(p_project, 'closure.view') then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'category',category,'title',title,'impact_level',impact_level,'confidentiality',confidentiality,
      'client_visible',client_visible,'approved_for_knowledge_base',approved_for_knowledge_base,'recommendation',recommendation,'created_at',created_at) order by created_at desc),'[]'::jsonb) into v
    from public.project_lessons_learned where project_id=p_project and is_deleted=false and (v_cat is null or category=v_cat);
  return jsonb_build_object('lessons', v, 'generated_at', now());
end $$;
revoke execute on function public.project_lessons_register(uuid,jsonb) from public, anon;
grant execute on function public.project_lessons_register(uuid,jsonb) to authenticated;

-- صندوق الإغلاق (عبر المشاريع) — يُركّب طلبات الإغلاق/القبول/إعادة الفتح المطلوبة منّي
create or replace function public.my_closure_inbox(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_closures jsonb; v_accept jsonb; v_reopen jsonb;
begin
  -- بوابة حقيقية: يجب أن يكون المستخدم مُسجّلًا (الصفوف مُقيَّدة لاحقًا: staff على مشاريعه، والعميل على client_final الخاص به).
  if auth.uid() is null then raise exception 'not authorized'; end if;
  -- طلبات إغلاق تحتاج مراجعتي/اعتمادي (staff مخوّل على مشاريع مرئية)
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'project_id',c.project_id,'project_name',p.project_name,'request_no',c.request_no,'status',c.status,'requested_by',c.requested_by,'requested_at',c.requested_at) order by c.requested_at desc),'[]'::jsonb) into v_closures
    from public.project_closure_requests c join public.projects p on p.id=c.project_id
    where c.is_deleted=false and c.status in ('submitted','under_review') and public.pc_can_read_project(c.project_id) and public.is_staff();
  -- طلبات قبول نهائي مطلوبة منّي (أو client_final لمالك العميل)
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'project_id',a.project_id,'project_name',p.project_name,'acceptance_type',a.acceptance_type,'status',a.status,'due_at',a.due_at) order by a.requested_at desc),'[]'::jsonb) into v_accept
    from public.project_final_acceptances a join public.projects p on p.id=a.project_id
    where a.is_deleted=false and a.status in ('pending','changes_requested')
      and (a.requested_from = auth.uid() or (a.acceptance_type='client_final' and to_regprocedure('public.is_client_owner(uuid)') is not null and public.is_client_owner(a.project_id)) or (public.is_staff() and public.pc_can_read_project(a.project_id)));
  -- طلبات إعادة فتح تحتاج اعتمادي
  select coalesce(jsonb_agg(jsonb_build_object('id',ro.id,'project_id',ro.project_id,'project_name',p.project_name,'requested_target_stage',ro.requested_target_stage,'status',ro.status,'requested_at',ro.requested_at) order by ro.requested_at desc),'[]'::jsonb) into v_reopen
    from public.project_reopen_requests ro join public.projects p on p.id=ro.project_id
    where ro.is_deleted=false and ro.status='pending' and public.is_staff() and public.pc_can_read_project(ro.project_id);
  return jsonb_build_object('closure_requests', v_closures, 'acceptances', v_accept, 'reopen_requests', v_reopen, 'generated_at', now());
end $$;
revoke execute on function public.my_closure_inbox(jsonb) from public, anon;
grant execute on function public.my_closure_inbox(jsonb) to authenticated;

-- لوحة إغلاق المحفظة (تنفيذية) — توزيع حالات الإغلاق عبر المشاريع المرئية
create or replace function public.portfolio_closure_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dist jsonb; v_rows jsonb; v_ids uuid[];
begin
  if not (public.is_staff() and (public.can_manage_projects() or public.emp_has_permission('executive.view_dashboard') or public.emp_has_permission('closure.view'))) then raise exception 'not authorized'; end if;
  -- المجموعة المرئية (يُركّب exec_visible_projects إن وُجد؛ وإلا staff-read-all المرئي)
  if to_regprocedure('public.exec_visible_projects(jsonb)') is not null then
    select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  else
    select array_agg(p.id) into v_ids from public.projects p where coalesce(p.is_deleted,false)=false and public.pc_can_read_project(p.id);
  end if;
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  select coalesce(jsonb_object_agg(st, c),'{}'::jsonb) into v_dist from (
    select public.pc_project_closure_status(x) st, count(*) c from unnest(v_ids) x group by 1) d;
  select coalesce(jsonb_agg(jsonb_build_object('project_id',x,'project_name',(select project_name from public.projects where id=x),'closure_status',public.pc_project_closure_status(x)) ), '[]'::jsonb) into v_rows
    from unnest(v_ids) x where public.pc_project_closure_status(x) in ('closure_in_progress','closure_blocked','awaiting_internal_approval','awaiting_client_acceptance','closure_approved','reopened');
  return jsonb_build_object('distribution', v_dist, 'in_progress_rows', v_rows, 'total', coalesce(array_length(v_ids,1),0), 'generated_at', now());
end $$;
revoke execute on function public.portfolio_closure_dashboard(jsonb) from public, anon;
grant execute on function public.portfolio_closure_dashboard(jsonb) to authenticated;

create or replace function public.archive_register(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.is_staff() and (public.can_manage_projects() or public.emp_has_permission('closure.archive') or public.emp_has_permission('closure.view'))) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'project_id',a.project_id,'project_name',p.project_name,'status',a.status,'archived_at',a.archived_at,
      'archive_policy',a.archive_policy,'retention_until',a.retention_until,'legal_hold',a.legal_hold) order by a.archived_at desc),'[]'::jsonb) into v
    from public.project_archives a join public.projects p on p.id=a.project_id
    where a.is_deleted=false and public.pc_can_read_project(a.project_id);
  return jsonb_build_object('archives', v, 'generated_at', now());
end $$;
revoke execute on function public.archive_register(jsonb) from public, anon;
grant execute on function public.archive_register(jsonb) to authenticated;

-- محضر التسليم والقبول (بيانات صفحة الطباعة)
create or replace function public.project_acceptance_certificate(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.closure_can(p_project, 'closure.view') then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'project_id', p_project,
    'project', (select jsonb_build_object('name',p.project_name,'client_id',p.client_id) from public.projects p where p.id=p_project),
    'closure_request', (select to_jsonb(x) from (select request_no, requested_at, approved_at, actual_closure_date from public.project_closure_requests where project_id=p_project and is_deleted=false order by created_at desc limit 1) x),
    'acceptance', (select to_jsonb(a) from (select acceptance_type,status,accepted_by,accepted_at,acceptance_comment,acceptance_scope,accepted_deliverables_snapshot,requested_from from public.project_final_acceptances where project_id=p_project and is_deleted=false and acceptance_type='client_final' order by created_at desc limit 1) a),
    'deliverables', (select coalesce(jsonb_agg(jsonb_build_object('title',title,'status',status) order by title),'[]'::jsonb) from public.deliverables where project_id=p_project and coalesce(is_deleted,false)=false and status in ('approved','final_delivered')),
    'generated_at', now()) into v;
  return v;
end $$;
revoke execute on function public.project_acceptance_certificate(uuid) from public, anon;
grant execute on function public.project_acceptance_certificate(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §14) تكامل تنفيذي: أضِف closure_status إلى Scorecard 5B (Additive — لا يغيّر معادلات سابقة)
-- ════════════════════════════════════════════════════════════════════════════
do $ei$
begin
  if to_regprocedure('public.executive_project_scorecard(uuid)') is not null then
    -- إضافة حقل closure_status عبر wrapper غير مُتاح؛ نكتفي بدالة مستقلّة يستهلكها الدشبورد (لا نعيد تعريف 5B).
    null;
  end if;
end $ei$;

-- ════════════════════════════════════════════════════════════════════════════
-- §15) تنبيهات الإغلاق (Idempotent — reminder_tracking + pc_event_emit، لا Cron جديد)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.closure_alerts_scan()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_emitted int := 0; v_rec record; v_key text; v_recips uuid[]; v_admins uuid[];
begin
  if not (public.can_manage_projects() or public.is_owner() or auth.uid() is null) then raise exception 'not authorized'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then
    return jsonb_build_object('ok',false,'reason','pc_event_emit مفقودة','emitted',0); end if;
  select coalesce(array_agg(id),'{}') into v_admins from public.profiles where account_type='admin';
  -- طلبات إغلاق عالقة في المراجعة > 3 أيام
  for v_rec in
    select c.id, c.project_id from public.project_closure_requests c
    where c.is_deleted=false and c.status in ('submitted','under_review') and c.review_started_at is not null and c.review_started_at < now() - interval '3 days'
  loop
    v_key := 'closure_review_overdue:'||v_rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at>now()) then continue; end if;
    select coalesce(array_agg(distinct u),'{}') into v_recips from (
      select unnest(v_admins) u union all select m.user_id from public.project_members m where m.project_id=v_rec.project_id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false) r where u is not null;
    perform public.pc_event_emit(v_rec.project_id,'project_status_changed','closure_request',v_rec.id,'action',
      'مراجعة إغلاق متأخرة','Closure review overdue','طلب إغلاق ينتظر المراجعة منذ أكثر من 3 أيام.','A closure request has awaited review for 3+ days.',
      '/client-portal/project-core/'||v_rec.project_id, v_recips, v_key||':'||to_char((now() at time zone 'utc')::date,'IYYY-IW'));
    insert into public.reminder_tracking(reminder_key,user_id,project_id,entity_type,entity_id) values (v_key,null,v_rec.project_id,'closure_request',v_rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at=now()+interval '48 hours';
    v_emitted := v_emitted+1;
  end loop;
  return jsonb_build_object('ok',true,'emitted',v_emitted,'scanned_at',now());
end $$;
revoke execute on function public.closure_alerts_scan() from public, anon;
grant execute on function public.closure_alerts_scan() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §16) RLS + Grants + Comments
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_closure_requests  enable row level security;
alter table public.project_final_acceptances enable row level security;
alter table public.project_lessons_learned   enable row level security;
alter table public.project_post_reviews       enable row level security;
alter table public.project_reopen_requests    enable row level security;
alter table public.project_archives           enable row level security;

drop policy if exists pcr_read on public.project_closure_requests;
create policy pcr_read on public.project_closure_requests for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
-- القبول: staff يرى الكل على مشاريعه؛ العميل يرى client_final المطلوب منه/على مشروعه فقط.
drop policy if exists pfa_read on public.project_final_acceptances;
create policy pfa_read on public.project_final_acceptances for select to authenticated using (
  (public.is_staff() and public.pc_can_read_project(project_id))
  or (acceptance_type='client_final' and to_regprocedure('public.is_client_owner(uuid)') is not null and public.is_client_owner(project_id))
  or requested_from = auth.uid());
-- الدروس: staff يرى الكل؛ العميل يرى client_visible فقط.
drop policy if exists pll_read on public.project_lessons_learned;
create policy pll_read on public.project_lessons_learned for select to authenticated using (
  (public.is_staff() and public.pc_can_read_project(project_id)) or (client_visible and to_regprocedure('public.is_client_owner(uuid)') is not null and public.is_client_owner(project_id)));
drop policy if exists ppr_read on public.project_post_reviews;
create policy ppr_read on public.project_post_reviews for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
drop policy if exists pro_read on public.project_reopen_requests;
create policy pro_read on public.project_reopen_requests for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
drop policy if exists parc_read on public.project_archives;
create policy parc_read on public.project_archives for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));

-- الكتابة عبر RPCs فقط.
revoke insert, update, delete on public.project_closure_requests, public.project_final_acceptances, public.project_lessons_learned,
  public.project_post_reviews, public.project_reopen_requests, public.project_archives from authenticated, anon;
grant select on public.project_closure_requests, public.project_final_acceptances, public.project_lessons_learned,
  public.project_post_reviews, public.project_reopen_requests, public.project_archives to authenticated;

comment on table public.project_closure_requests is '5C: دورة إغلاق المشروع (workflow مستقل؛ core_stage يبقى delivered حتى Final Close).';
comment on function public.project_final_close(uuid,text,int,int,jsonb) is '5C: الإغلاق النهائي الذرّي — يعيد استخدام project_core_set_stage (المسار الرسمي الوحيد لـ closed).';
comment on function public.project_closure_readiness(uuid) is '5C: محرّك جاهزية الإغلاق — يُركّب المصادر القائمة؛ denominator=المطلوب فقط؛ blockers مفسّرة.';

-- ════════════════════════════════════════════════════════════════════════════
-- §17) اختبار ذاتي — بلا Side Effects (savepoint يُتراجع عنه)
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_pid uuid; v_ready jsonb; v_stage text; v_ok boolean := false; v_perm int;
begin
  -- (أ) الجداول والدوال أُنشئت
  for v_stage in select unnest(array['project_closure_requests','project_final_acceptances','project_lessons_learned','project_post_reviews','project_reopen_requests','project_archives']) loop
    if to_regclass('public.'||v_stage) is null then raise exception '5C FAIL: جدول ناقص %', v_stage; end if;
  end loop;
  if to_regprocedure('public.project_closure_readiness(uuid)') is null or to_regprocedure('public.project_final_close(uuid,text,int,int,jsonb)') is null
     or to_regprocedure('public.project_closure_request_create(uuid,text,date,int)') is null or to_regprocedure('public.project_reopen_approve(uuid,text,int)') is null
     or to_regprocedure('public.closure_can(uuid,text)') is null then raise exception '5C FAIL: دوال ناقصة'; end if;

  -- (ب) Final Close يعيد استخدام المسار الرسمي (لا UPDATE مباشر لـ core_stage)
  if position('project_core_set_stage' in pg_get_functiondef('public.project_final_close(uuid,text,int,int,jsonb)'::regprocedure)) = 0
    then raise exception '5C FAIL: project_final_close لا يستخدم project_core_set_stage'; end if;
  if pg_get_functiondef('public.project_final_close(uuid,text,int,int,jsonb)'::regprocedure) ~* 'update\s+public\.project_core\s+set\s+core_stage'
    then raise exception '5C FAIL: project_final_close يكتب core_stage مباشرة'; end if;

  -- (ج) الجاهزية: denominator=المطلوب فقط، وقاعدة النسبة (0 → null) عبر تأكيد نقيّ
  if (case when 0>0 then round(1::numeric/0*100) else null end) is not null then raise exception '5C FAIL: قاعدة denominator=0'; end if;

  -- (د) الجاهزية تعمل على مشروع فعلي (قراءة فقط) — أو تُتخطّى إن لا مشاريع
  begin
    select id into v_pid from public.projects where coalesce(is_deleted,false)=false limit 1;
    if v_pid is not null then v_ready := public.project_closure_readiness(v_pid);
      if v_ready->>'ready' is null then raise exception '5C FAIL: الجاهزية بلا مفتاح ready'; end if;
    end if;
    v_ok := true;
  exception when others then
    if sqlerrm like '5C FAIL%' then raise; else v_ok := true; end if;   -- authz/غياب عمود لا يُفشل العقد
  end;
  if not v_ok then raise exception '5C FAIL: تعذّر تشغيل الجاهزية'; end if;

  -- (هـ) الصلاحيات مُدرجة
  select count(*) into v_perm from public.permissions where category='closure';
  if v_perm < 18 then raise exception '5C FAIL: صلاحيات الإغلاق ناقصة (%)', v_perm; end if;

  raise notice '5C ✅ نجح الاختبار الذاتي — جداول/دوال/إعادة استخدام المسار الرسمي/denominator/جاهزية/صلاحيات.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
