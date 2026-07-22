-- ════════════════════════════════════════════════════════════════════════════
-- project_governance_batch5a_RUNME.sql
-- PHASE 5 · BATCH 5A — GOVERNANCE, RISKS, ISSUES, DECISIONS & CHANGE CONTROL
-- ────────────────────────────────────────────────────────────────────────────
-- تصميم معتمد بعد Read-Only Audit (يُوسّع لا يوازي):
--   • project_risks موجود → يُوسَّع (probability/impact/score/category/response/residual/links).
--   • project_approvals موجود → يُوسَّع (approval_type/entity/sequence/required_role/version/…).
--   • project_members.role دور مفرد (نظامي) → جدول علائقي project_member_roles لأدوار الحوكمة المتعددة.
--   • project_stage_readiness موجود → يُبنى فوقه Stage Gate.
--   • Audit عبر pc_log/project_activity_feed؛ إشعارات عبر pc_event_emit + reminder_tracking.
--   • جديد: governance_settings/issues/decisions/assumptions/change_requests (+جداول ربط).
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا حذف بيانات · بلا DROP FUNCTION/TABLE ·
--   بلا Temp Tables في دوال القراءة · لا يمسّ core_stage/progress/المالية/Zoho/العهدة · Preflight ·
--   self-test يُلغي المعاملة عند الفشل · notify pgrst · GRANTs/RLS/Comments.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
begin
  if to_regclass('public.project_risks') is null or to_regclass('public.project_approvals') is null
     or to_regclass('public.project_members') is null or to_regclass('public.projects') is null
     or to_regprocedure('public.pc_can_read_project(uuid)') is null or to_regprocedure('public.can_manage_projects()') is null
     or to_regprocedure('public.is_staff()') is null or to_regprocedure('public.emp_has_permission(text)') is null
     or to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null
     or to_regclass('public.reminder_tracking') is null then
    raise exception '5A preflight: نقص الأساس (project_risks/project_approvals/project_members/pc_can_read_project/can_manage_projects/is_staff/emp_has_permission/pc_log/pc_event_emit/reminder_tracking).';
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) أدوار المشروع (علائقي، متعدّد) — منفصلة عن System roles/professions/job titles
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_member_roles (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_role text not null check (project_role in
                 ('project_owner','project_manager','project_coordinator','team_member',
                  'reviewer','client_representative','sponsor','approver','observer')),
  added_by     uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  is_deleted   boolean not null default false,
  unique (project_id, user_id, project_role)
);
comment on table public.project_member_roles is '5A: أدوار الحوكمة داخل المشروع فقط — لا تمنح صلاحيات نظامية خارج المشروع.';
create index if not exists ix_pmr_project on public.project_member_roles(project_id) where is_deleted = false;
create index if not exists ix_pmr_user on public.project_member_roles(user_id) where is_deleted = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) إعدادات حوكمة المشروع — افتراضيات آمنة لا تغيّر سلوك المشاريع الحالية فجأة
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_governance_settings (
  project_id  uuid primary key references public.projects(id) on delete cascade,
  governance_mode        text not null default 'standard'  check (governance_mode in ('standard','strict','lightweight')),
  approval_mode          text not null default 'all_required' check (approval_mode in ('sequential','parallel','any_one','all_required')),
  stage_gate_mode        text not null default 'advisory'  check (stage_gate_mode in ('advisory','enforced')),
  change_control_mode    text not null default 'advisory'  check (change_control_mode in ('advisory','approval_required')),
  risk_threshold         int  not null default 15 check (risk_threshold between 1 and 25),
  issue_escalation_threshold text not null default 'high' check (issue_escalation_threshold in ('low','medium','high','critical')),
  approval_sla_hours     int  not null default 48 check (approval_sla_hours > 0),
  require_client_approval               boolean not null default false,
  require_internal_approval             boolean not null default true,
  require_financial_clearance_before_close boolean not null default false,
  require_deliverables_approved_before_close boolean not null default true,
  require_tasks_complete_before_close   boolean not null default true,
  require_resource_bookings_closed_before_close boolean not null default false,
  require_lessons_learned               boolean not null default false,
  require_closure_report                boolean not null default false,
  escalation_recipients  uuid[] not null default '{}',
  version     int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.project_governance_settings is '5A: إعدادات حوكمة لكل مشروع؛ غيابها = وضع standard/advisory الآمن.';

-- ════════════════════════════════════════════════════════════════════════════
-- §3) توسيع project_risks (Additive) — probability/impact/score/severity مشتقة، فئة، استجابة، متبقٍّ، روابط
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_risks
  add column if not exists category text not null default 'operational',
  add column if not exists probability int not null default 3,
  add column if not exists impact int not null default 3,
  add column if not exists risk_score int not null default 9,
  add column if not exists response_strategy text,
  add column if not exists contingency_plan text,
  add column if not exists trigger_condition text,
  add column if not exists residual_probability int,
  add column if not exists residual_impact int,
  add column if not exists residual_score int,
  add column if not exists linked_task_id uuid,
  add column if not exists linked_deliverable_id uuid,
  add column if not exists linked_resource_id uuid,
  add column if not exists linked_change_request_id uuid,
  add column if not exists client_visible boolean not null default false,
  add column if not exists identified_by uuid,
  add column if not exists identified_at timestamptz not null default now(),
  add column if not exists due_date date,
  add column if not exists closed_at timestamptz,
  add column if not exists version int not null default 1;

-- قيود آمنة (guarded) على أعمدة النطاق/الحالة الموسّعة
do $g$
begin
  if not exists (select 1 from pg_constraint where conname='project_risks_probability_ck') then
    alter table public.project_risks add constraint project_risks_probability_ck check (probability between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname='project_risks_impact_ck') then
    alter table public.project_risks add constraint project_risks_impact_ck check (impact between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname='project_risks_category_ck') then
    alter table public.project_risks add constraint project_risks_category_ck check (category in
      ('schedule','resource','equipment','technical','quality','client','financial_reference','legal','safety','operational','supplier','reputation','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname='project_risks_response_ck') then
    alter table public.project_risks add constraint project_risks_response_ck check (response_strategy is null or response_strategy in ('avoid','mitigate','transfer','accept','exploit','enhance'));
  end if;
end $g$;

-- توسيع vocabulary لحالة المخاطر بأمان: القيد الأساسي = ('open','mitigating','closed','accepted') ولا يسمح
-- بـ'occurred' (حالة المخاطرة المتحقّقة التي يكتبها pc_risk_to_issue). أسقِط أي CHECK على status بالتعريف
-- (لا بالاسم المُخمَّن؛ Postgres يعيد كتابة IN كـ«= ANY(ARRAY[...])») ثم أضِف القيد الموسّع. توسيع للمسموح فقط،
-- كل القيم القديمة تبقى صالحة ⇒ Idempotent وبلا فقد بيانات.
do $g$
declare c text;
begin
  for c in select con.conname from pg_constraint con
    where con.conrelid = 'public.project_risks'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~* '\ystatus\y'
      and con.conname <> 'project_risks_status_ck2'
  loop
    execute 'alter table public.project_risks drop constraint ' || quote_ident(c);
  end loop;
  if not exists (select 1 from pg_constraint where conname='project_risks_status_ck2') then
    alter table public.project_risks add constraint project_risks_status_ck2 check
      (status in ('open','mitigating','closed','accepted','occurred'));
  end if;
end $g$;

-- Trigger: risk_score = probability×impact، وseverity مشتقة منه (لا تخزين يدوي يناقض score). residual_score كذلك.
create or replace function public.project_risk_derive() returns trigger language plpgsql set search_path = public as $$
begin
  new.risk_score := coalesce(new.probability,3) * coalesce(new.impact,3);
  new.severity := case when new.risk_score >= 20 then 'critical' when new.risk_score >= 12 then 'high'
                       when new.risk_score >= 5 then 'medium' else 'low' end;
  if new.residual_probability is not null and new.residual_impact is not null then
    new.residual_score := new.residual_probability * new.residual_impact;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_project_risk_derive on public.project_risks;
create trigger trg_project_risk_derive before insert or update on public.project_risks
  for each row execute function public.project_risk_derive();

-- Backfill آمن ومُتكرِّر: صفوف قديمة بـprobability/impact افتراضية (3,3/score 9) لكن severity غير medium
-- ⇒ اشتق probability/impact من الـseverity القديمة كي لا يتناقض score مع severity (الـtrigger يوحّدهما).
-- شرط (prob=3,imp=3,score=9,severity في critical/high/low) لا يتحقق إلا لصفوف ما قبل الهجرة ⇒ Idempotent.
update public.project_risks
  set probability = case severity when 'critical' then 5 when 'high' then 4 when 'low' then 2 else 3 end,
      impact      = case severity when 'critical' then 5 when 'high' then 4 when 'low' then 2 else 3 end
  where probability = 3 and impact = 3 and risk_score = 9 and severity in ('critical','high','low');

-- ════════════════════════════════════════════════════════════════════════════
-- §4) توسيع project_approvals (Additive) — approval_type/entity/sequence/required_role/version/…
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_approvals
  add column if not exists approval_type text not null default 'deliverable_approval',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists due_at timestamptz,
  add column if not exists decision text,
  add column if not exists rejection_reason text,
  add column if not exists sequence_order int not null default 0,
  add column if not exists required_role text,
  add column if not exists required_user_id uuid,
  add column if not exists version int not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists is_deleted boolean not null default false;

-- توسيع vocabulary الحالة بأمان: أسقِط أي CHECK على status (بالتعريف لا بالاسم المُخمَّن، كي لا يبقى
-- قيد قديم أضيق يمنع الحالات الجديدة)، ثم أضِف القيد الموسّع. لا حذف بيانات (توسيع للمسموح فقط).
do $g$
declare c text;
begin
  -- ملاحظة: Postgres يعيد كتابة IN كـ«= ANY (ARRAY[...])»؛ نطابق على ذكر عمود status فقط لا على 'IN'.
  for c in select con.conname from pg_constraint con
    where con.conrelid = 'public.project_approvals'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~* '\ystatus\y'
      and con.conname <> 'project_approvals_status_ck2'
  loop
    execute 'alter table public.project_approvals drop constraint ' || quote_ident(c);
  end loop;
  if not exists (select 1 from pg_constraint where conname='project_approvals_status_ck2') then
    alter table public.project_approvals add constraint project_approvals_status_ck2 check
      (status in ('draft','pending','approved','rejected','revision_requested','changes_requested','cancelled','expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname='project_approvals_type_ck') then
    alter table public.project_approvals add constraint project_approvals_type_ck check (approval_type in
      ('project_start','scope_approval','schedule_approval','budget_acknowledgement','script_approval','preproduction_approval',
       'shooting_readiness','internal_review','client_review','deliverable_approval','change_request_approval','stage_transition','project_closure'));
  end if;
end $g$;
create index if not exists ix_approvals_project_status on public.project_approvals(project_id, status, due_at) where coalesce(is_deleted,false)=false;
create index if not exists ix_approvals_required_user on public.project_approvals(required_user_id) where coalesce(is_deleted,false)=false;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) سجل المشكلات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_issues (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  description  text,
  category     text not null default 'operational' check (category in
                 ('schedule','resource','equipment','technical','quality','client','financial_reference','legal','safety','operational','supplier','reputation','other')),
  severity     text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status       text not null default 'open' check (status in ('open','investigating','action_required','resolving','monitoring','resolved','closed','rejected')),
  owner_id     uuid references auth.users(id),
  reported_by  uuid references auth.users(id),
  reported_at  timestamptz not null default now(),
  due_date     date,
  root_cause   text,
  impact_description text,
  resolution_plan text,
  resolution_summary text,
  linked_risk_id uuid references public.project_risks(id) on delete set null,
  linked_task_id uuid,
  linked_deliverable_id uuid,
  linked_resource_booking_id uuid,
  client_visible boolean not null default false,
  escalated_at timestamptz,
  closed_at    timestamptz,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_issues_project on public.project_issues(project_id, severity, status) where is_deleted = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) سجل القرارات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_decisions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  decision     text,
  rationale    text,
  alternatives_considered text,
  impact       text,
  decided_by   uuid references auth.users(id),
  decided_at   timestamptz,
  effective_date date,
  review_date  date,
  status       text not null default 'proposed' check (status in ('proposed','approved','superseded','reversed','archived')),
  linked_risk_id uuid references public.project_risks(id) on delete set null,
  linked_issue_id uuid references public.project_issues(id) on delete set null,
  linked_change_request_id uuid,
  linked_task_id uuid,
  client_visible boolean not null default false,
  supersedes_decision_id uuid references public.project_decisions(id) on delete set null,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_decisions_project on public.project_decisions(project_id, status, review_date) where is_deleted = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) سجل الافتراضات (خفيف)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_assumptions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  statement    text not null,
  source       text,
  owner_id     uuid references auth.users(id),
  validation_date date,
  status       text not null default 'unverified' check (status in ('unverified','validating','confirmed','invalid','expired')),
  validation_result text,
  impact_if_false text,
  linked_risk_id uuid references public.project_risks(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_assumptions_project on public.project_assumptions(project_id, status, validation_date) where is_deleted = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) طلبات التغيير + جداول الربط العلائقية
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_change_requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  request_no   text,
  title        text not null,
  description  text,
  change_type  text not null default 'scope' check (change_type in ('scope','schedule','resource','deliverable','quality','technical','client_request','compliance','other')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  status       text not null default 'draft' check (status in ('draft','submitted','impact_analysis','pending_approval','approved','rejected','implementing','implemented','verified','closed','cancelled')),
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  reason       text,
  scope_impact text,
  schedule_impact_days int,
  resource_impact text,
  quality_impact text,
  financial_impact_reference text,
  implementation_plan text,
  rollback_plan text,
  decision      text,
  decision_by   uuid references auth.users(id),
  decision_at   timestamptz,
  approval_id   uuid references public.project_approvals(id) on delete set null,
  implemented_at timestamptz,
  closed_at    timestamptz,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_cr_project on public.project_change_requests(project_id, status) where is_deleted = false;

create table if not exists public.change_request_tasks (
  change_request_id uuid not null references public.project_change_requests(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  primary key (change_request_id, task_id));
create table if not exists public.change_request_deliverables (
  change_request_id uuid not null references public.project_change_requests(id) on delete cascade,
  deliverable_id uuid not null,
  primary key (change_request_id, deliverable_id));
create table if not exists public.change_request_resources (
  change_request_id uuid not null references public.project_change_requests(id) on delete cascade,
  resource_id uuid not null,
  primary key (change_request_id, resource_id));

-- ════════════════════════════════════════════════════════════════════════════
-- §9) الصلاحيات (Catalog)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('governance.view',              'governance','normal', 500,'عرض الحوكمة','View governance'),
  ('governance.manage_settings',   'governance','sensitive',505,'إدارة إعدادات الحوكمة','Manage governance settings'),
  ('governance.manage_roles',      'governance','sensitive',510,'إدارة أدوار المشروع','Manage project roles'),
  ('approvals.view',               'governance','normal', 515,'عرض الاعتمادات','View approvals'),
  ('approvals.request',            'governance','normal', 520,'طلب اعتماد','Request approval'),
  ('approvals.decide',             'governance','normal', 525,'اتخاذ قرار اعتماد','Decide approval'),
  ('approvals.reassign',           'governance','sensitive',530,'إعادة تعيين اعتماد','Reassign approval'),
  ('approvals.override',           'governance','sensitive',535,'تجاوز اعتماد','Override approval'),
  ('risks.view',                   'governance','normal', 540,'عرض المخاطر','View risks'),
  ('risks.create',                 'governance','normal', 545,'إنشاء مخاطرة','Create risk'),
  ('risks.edit',                   'governance','normal', 550,'تعديل مخاطرة','Edit risk'),
  ('risks.close',                  'governance','normal', 555,'إغلاق مخاطرة','Close risk'),
  ('issues.view',                  'governance','normal', 560,'عرض المشكلات','View issues'),
  ('issues.create',                'governance','normal', 565,'إنشاء مشكلة','Create issue'),
  ('issues.edit',                  'governance','normal', 570,'تعديل مشكلة','Edit issue'),
  ('issues.close',                 'governance','normal', 575,'إغلاق مشكلة','Close issue'),
  ('decisions.view',               'governance','normal', 580,'عرض القرارات','View decisions'),
  ('decisions.create',             'governance','normal', 585,'إنشاء قرار','Create decision'),
  ('decisions.approve',            'governance','sensitive',590,'اعتماد قرار','Approve decision'),
  ('assumptions.view',             'governance','normal', 595,'عرض الافتراضات','View assumptions'),
  ('assumptions.manage',           'governance','normal', 600,'إدارة الافتراضات','Manage assumptions'),
  ('changes.view',                 'governance','normal', 605,'عرض طلبات التغيير','View changes'),
  ('changes.create',               'governance','normal', 610,'إنشاء طلب تغيير','Create change'),
  ('changes.analyze',              'governance','normal', 615,'تحليل أثر التغيير','Analyze change'),
  ('changes.approve',              'governance','sensitive',620,'اعتماد التغيير','Approve change'),
  ('changes.apply',                'governance','sensitive',625,'تطبيق التغيير','Apply change'),
  ('stage_gates.view',             'governance','normal', 630,'عرض بوابات المراحل','View stage gates'),
  ('stage_gates.override',         'governance','sensitive',635,'تجاوز بوابة المرحلة','Override stage gate')
on conflict (key) do nothing;
-- محاذاة حساسية مفاتيح الاعتماد مع معاملة gov_can لها كحسّاسة (on conflict do nothing لا يُحدّث؛ هذا idempotent).
update public.permissions set sensitivity = 'sensitive'
  where key in ('decisions.approve','changes.approve','approvals.override','stage_gates.override') and coalesce(sensitivity,'') <> 'sensitive';

-- ════════════════════════════════════════════════════════════════════════════
-- §10) دوال الصلاحية الداخلية
-- ════════════════════════════════════════════════════════════════════════════
-- 10.1 صلاحية حوكمة (مرساة is_staff — عزل العميل على مستوى RPC أيضًا)
create or replace function public.gov_can(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  -- المفاتيح الحسّاسة (أدوار/إعدادات/اعتماد وتطبيق التغيير/تجاوز البوابة/إعادة الإسناد) لا يمنحها فرع
  -- can_edit_project العريض؛ تتطلّب إمّا مدير مشاريع أو منح الصلاحية الصريح — كي لا يتجاوز أيّ «محرِّر» المنح الدقيق.
  -- بقية المفاتيح التشغيلية تبقى متاحة للمحرِّر (can_edit_project).
  select public.is_staff() and public.pc_can_read_project(p_project) and (
    case when p_key in ('governance.manage_roles','governance.manage_settings','changes.approve','changes.apply',
                        'approvals.reassign','approvals.override','stage_gates.override','decisions.approve')
         then (public.can_manage_projects() or public.emp_has_permission(p_key))
         else (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission(p_key))
    end);
$$;
revoke execute on function public.gov_can(uuid,text) from public, anon;
grant execute on function public.gov_can(uuid,text) to authenticated;

-- 10.2 هل يملك المستخدم دورًا مشروعيًا معيّنًا؟
create or replace function public.pc_has_project_role(p_project uuid, p_user uuid, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_member_roles r
    where r.project_id = p_project and r.user_id = p_user and r.project_role = p_role and r.is_deleted = false);
$$;
revoke execute on function public.pc_has_project_role(uuid,uuid,text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) RPCs — أدوار المشروع + إعدادات الحوكمة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_project_role_add(p_project uuid, p_user uuid, p_role text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.gov_can(p_project, 'governance.manage_roles') then raise exception 'not authorized'; end if;
  if p_role not in ('project_owner','project_manager','project_coordinator','team_member','reviewer','client_representative','sponsor','approver','observer')
    then raise exception 'bad_role'; end if;
  insert into public.project_member_roles(project_id, user_id, project_role, added_by)
    values (p_project, p_user, p_role, auth.uid())
    on conflict (project_id, user_id, project_role) do update set is_deleted = false
    returning id into v_id;
  perform public.pc_log(p_project, 'project_role_added', 'member_role', v_id, jsonb_build_object('user', p_user, 'role', p_role));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.pc_project_role_remove(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.project_member_roles where id = p_id;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.gov_can(v_proj, 'governance.manage_roles') then raise exception 'not authorized'; end if;
  update public.project_member_roles set is_deleted = true where id = p_id;
  perform public.pc_log(v_proj, 'project_role_removed', 'member_role', p_id, '{}');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pc_governance_settings_upsert(p_project uuid, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.project_governance_settings;
begin
  if not public.gov_can(p_project, 'governance.manage_settings') then raise exception 'not authorized'; end if;
  insert into public.project_governance_settings(project_id) values (p_project) on conflict (project_id) do nothing;
  update public.project_governance_settings set
    governance_mode = coalesce(nullif(p_data->>'governance_mode',''), governance_mode),
    approval_mode = coalesce(nullif(p_data->>'approval_mode',''), approval_mode),
    stage_gate_mode = coalesce(nullif(p_data->>'stage_gate_mode',''), stage_gate_mode),
    change_control_mode = coalesce(nullif(p_data->>'change_control_mode',''), change_control_mode),
    risk_threshold = coalesce(nullif(p_data->>'risk_threshold','')::int, risk_threshold),
    approval_sla_hours = coalesce(nullif(p_data->>'approval_sla_hours','')::int, approval_sla_hours),
    require_client_approval = coalesce((p_data->>'require_client_approval')::boolean, require_client_approval),
    require_internal_approval = coalesce((p_data->>'require_internal_approval')::boolean, require_internal_approval),
    require_deliverables_approved_before_close = coalesce((p_data->>'require_deliverables_approved_before_close')::boolean, require_deliverables_approved_before_close),
    require_tasks_complete_before_close = coalesce((p_data->>'require_tasks_complete_before_close')::boolean, require_tasks_complete_before_close),
    require_resource_bookings_closed_before_close = coalesce((p_data->>'require_resource_bookings_closed_before_close')::boolean, require_resource_bookings_closed_before_close),
    require_financial_clearance_before_close = coalesce((p_data->>'require_financial_clearance_before_close')::boolean, require_financial_clearance_before_close),
    version = version + 1, updated_at = now()
    where project_id = p_project returning * into r;
  perform public.pc_log(p_project, 'governance_settings_updated', 'project', p_project, jsonb_build_object('mode', r.governance_mode));
  return to_jsonb(r);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) RPCs — Risk register (توسيع pc_risk_upsert بأمان: legacy severity → probability/impact)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_risk_upsert(p_project uuid, p_data jsonb)
returns public.project_risks language plpgsql security definer set search_path = public as $$
declare r public.project_risks; v_id uuid := nullif(p_data->>'id','')::uuid; v_sev text; v_prob int; v_imp int;
begin
  if not public.gov_can(p_project, 'risks.create') and not (v_id is not null and public.gov_can(p_project,'risks.edit')) then raise exception 'not authorized'; end if;
  v_sev := nullif(p_data->>'severity','');
  v_prob := coalesce(nullif(p_data->>'probability','')::int, case v_sev when 'critical' then 5 when 'high' then 4 when 'low' then 2 else 3 end);
  v_imp  := coalesce(nullif(p_data->>'impact','')::int,      case v_sev when 'critical' then 5 when 'high' then 4 when 'low' then 2 else 3 end);
  if v_prob not between 1 and 5 or v_imp not between 1 and 5 then raise exception 'bad_scale'; end if;
  if v_id is null then
    insert into public.project_risks(project_id, title, description, likelihood, status, mitigation, probability, impact,
        category, response_strategy, contingency_plan, trigger_condition, residual_probability, residual_impact,
        linked_task_id, linked_deliverable_id, linked_resource_id, client_visible, due_date, created_by, identified_by)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'description'),''),
        coalesce(nullif(p_data->>'likelihood',''),'possible'), coalesce(nullif(p_data->>'status',''),'open'),
        nullif(btrim(p_data->>'mitigation'),''), v_prob, v_imp,
        coalesce(nullif(p_data->>'category',''),'operational'), nullif(p_data->>'response_strategy',''),
        nullif(btrim(p_data->>'contingency_plan'),''), nullif(btrim(p_data->>'trigger_condition'),''),
        nullif(p_data->>'residual_probability','')::int, nullif(p_data->>'residual_impact','')::int,
        nullif(p_data->>'linked_task_id','')::uuid, nullif(p_data->>'linked_deliverable_id','')::uuid, nullif(p_data->>'linked_resource_id','')::uuid,
        coalesce((p_data->>'client_visible')::boolean, false), nullif(p_data->>'due_date','')::date, auth.uid(), auth.uid())
      returning * into r;
    perform public.pc_log(p_project, 'risk_added', 'risk', r.id, jsonb_build_object('severity', r.severity, 'score', r.risk_score));
  else
    update public.project_risks set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      description = coalesce(nullif(btrim(p_data->>'description'),''), description),
      likelihood = coalesce(nullif(p_data->>'likelihood',''), likelihood), status = coalesce(nullif(p_data->>'status',''), status),
      mitigation = coalesce(nullif(btrim(p_data->>'mitigation'),''), mitigation),
      -- لا تَكتُب probability/impact إلا إذا زوّدها المُستدعي فعليًا (probability/impact/severity)؛ وإلا أبقِ القائم.
      -- بدون هذا الشرط كان التعديل الجزئي (مثل تغيير الحالة من RisksTab القديمة بلا probability) يفرض 3×3 ويهبط
      -- بمخاطرة 5×5 حرجة إلى 3×3 متوسطة (فساد بيانات). الـtrigger يعيد اشتقاق score/severity من القيم النهائية.
      probability = case when nullif(p_data->>'probability','') is not null or nullif(p_data->>'severity','') is not null then v_prob else probability end,
      impact      = case when nullif(p_data->>'impact','')      is not null or nullif(p_data->>'severity','') is not null then v_imp  else impact end,
      category = coalesce(nullif(p_data->>'category',''), category),
      response_strategy = coalesce(nullif(p_data->>'response_strategy',''), response_strategy),
      contingency_plan = coalesce(nullif(btrim(p_data->>'contingency_plan'),''), contingency_plan),
      trigger_condition = coalesce(nullif(btrim(p_data->>'trigger_condition'),''), trigger_condition),
      residual_probability = coalesce(nullif(p_data->>'residual_probability','')::int, residual_probability),
      residual_impact = coalesce(nullif(p_data->>'residual_impact','')::int, residual_impact),
      client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      due_date = coalesce(nullif(p_data->>'due_date','')::date, due_date),
      closed_at = case when coalesce(nullif(p_data->>'status',''), status) in ('closed','accepted') then coalesce(closed_at, now()) else null end,
      version = version + 1
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.pc_log(p_project, 'risk_updated', 'risk', v_id, jsonb_build_object('severity', r.severity));
  end if;
  return r;
end $$;

-- تحويل مخاطرة تحقّقت إلى مشكلة (لا تلقائيًا — بطلب المستخدم)
create or replace function public.pc_risk_to_issue(p_risk uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.project_risks; v_issue uuid;
begin
  select * into v from public.project_risks where id = p_risk and is_deleted = false;
  if v.id is null then raise exception 'not_found'; end if;
  if not public.gov_can(v.project_id, 'issues.create') then raise exception 'not authorized'; end if;
  insert into public.project_issues(project_id, title, description, category, severity, owner_id, reported_by, linked_risk_id, root_cause)
    values (v.project_id, v.title, v.description, coalesce(v.category,'operational'), v.severity, v.owner_id, auth.uid(), v.id,
      'تحوّلت من مخاطرة محقّقة') returning id into v_issue;
  update public.project_risks set status = 'occurred', version = version + 1 where id = p_risk;
  perform public.pc_log(v.project_id, 'risk_became_issue', 'issue', v_issue, jsonb_build_object('risk', p_risk));
  return jsonb_build_object('ok', true, 'issue_id', v_issue);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) RPCs — Issues / Decisions / Assumptions (upsert موحّد + إغلاق/تصعيد)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_issue_upsert(p_project uuid, p_data jsonb)
returns public.project_issues language plpgsql security definer set search_path = public as $$
declare r public.project_issues; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.gov_can(p_project, 'issues.create') and not (v_id is not null and public.gov_can(p_project,'issues.edit')) then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_issues(project_id, title, description, category, severity, status, owner_id, reported_by,
        due_date, root_cause, impact_description, resolution_plan, linked_risk_id, linked_task_id, client_visible)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'description'),''),
        coalesce(nullif(p_data->>'category',''),'operational'), coalesce(nullif(p_data->>'severity',''),'medium'),
        coalesce(nullif(p_data->>'status',''),'open'), nullif(p_data->>'owner_id','')::uuid, auth.uid(),
        nullif(p_data->>'due_date','')::date, nullif(btrim(p_data->>'root_cause'),''), nullif(btrim(p_data->>'impact_description'),''),
        nullif(btrim(p_data->>'resolution_plan'),''), nullif(p_data->>'linked_risk_id','')::uuid, nullif(p_data->>'linked_task_id','')::uuid,
        coalesce((p_data->>'client_visible')::boolean, false)) returning * into r;
    perform public.pc_log(p_project, 'issue_added', 'issue', r.id, jsonb_build_object('severity', r.severity));
  else
    update public.project_issues set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      description = coalesce(nullif(btrim(p_data->>'description'),''), description),
      category = coalesce(nullif(p_data->>'category',''), category), severity = coalesce(nullif(p_data->>'severity',''), severity),
      status = coalesce(nullif(p_data->>'status',''), status), owner_id = coalesce(nullif(p_data->>'owner_id','')::uuid, owner_id),
      due_date = coalesce(nullif(p_data->>'due_date','')::date, due_date), root_cause = coalesce(nullif(btrim(p_data->>'root_cause'),''), root_cause),
      resolution_plan = coalesce(nullif(btrim(p_data->>'resolution_plan'),''), resolution_plan),
      resolution_summary = coalesce(nullif(btrim(p_data->>'resolution_summary'),''), resolution_summary),
      client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      closed_at = case when coalesce(nullif(p_data->>'status',''), status) in ('resolved','closed','rejected') then coalesce(closed_at, now()) else null end,
      version = version + 1, updated_at = now()
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.pc_log(p_project, 'issue_updated', 'issue', v_id, '{}');
  end if;
  return r;
end $$;

create or replace function public.pc_decision_upsert(p_project uuid, p_data jsonb)
returns public.project_decisions language plpgsql security definer set search_path = public as $$
declare r public.project_decisions; v_id uuid := nullif(p_data->>'id','')::uuid; v_old public.project_decisions;
begin
  if not public.gov_can(p_project, 'decisions.create') then raise exception 'not authorized'; end if;
  -- بوابة حسّاسة: اعتماد قرار (status=approved) يتطلّب 'decisions.approve' لا مجرّد 'decisions.create' — كي لا
  -- «يعتمد» محرِّرٌ عاديّ قرارًا (ويُبطِل قرارًا معتمَدًا عبر supersede) بلا الصلاحية الحسّاسة. تُطبَّق على الإنشاء المعتمَد.
  if v_id is null and coalesce(nullif(p_data->>'status',''),'proposed') = 'approved'
     and not public.gov_can(p_project, 'decisions.approve') then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_decisions(project_id, title, decision, rationale, alternatives_considered, impact, status,
        effective_date, review_date, linked_risk_id, linked_issue_id, linked_task_id, client_visible, supersedes_decision_id,
        decided_by, decided_at)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'decision'),''), nullif(btrim(p_data->>'rationale'),''),
        nullif(btrim(p_data->>'alternatives_considered'),''), nullif(btrim(p_data->>'impact'),''), coalesce(nullif(p_data->>'status',''),'proposed'),
        nullif(p_data->>'effective_date','')::date, nullif(p_data->>'review_date','')::date, nullif(p_data->>'linked_risk_id','')::uuid,
        nullif(p_data->>'linked_issue_id','')::uuid, nullif(p_data->>'linked_task_id','')::uuid, coalesce((p_data->>'client_visible')::boolean, false),
        nullif(p_data->>'supersedes_decision_id','')::uuid,
        case when coalesce(nullif(p_data->>'status',''),'proposed')='approved' then auth.uid() end,
        case when coalesce(nullif(p_data->>'status',''),'proposed')='approved' then now() end) returning * into r;
    -- إبطال القرار القديم فقط عندما يكون القرار الجديد «معتمَدًا» فعلًا؛ مُسوَّدة/مقترح لا تُبطِل قرارًا معتمَدًا.
    if r.supersedes_decision_id is not null and r.status = 'approved' then
      update public.project_decisions set status='superseded', version=version+1, updated_at=now()
        where id = r.supersedes_decision_id and project_id=p_project and status <> 'superseded';
    end if;
    perform public.pc_log(p_project, 'decision_added', 'decision', r.id, jsonb_build_object('status', r.status));
  else
    -- القرار المعتمد ثابت تمامًا: لا يُعدّل بأي حال (ولا يُنزَع اعتماده بتغيير حالته إلى proposed/reversed…)؛ يُبطَل
    -- فقط بإنشاء قرار جديد يُبطِله (supersede). يشمل ذلك حظر «تحييد» قرار معتمَد بخفض حالته من قِبل محرِّر عاديّ.
    select * into v_old from public.project_decisions where id = v_id and project_id = p_project;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status = 'approved' then raise exception 'approved_immutable'; end if;
    -- الانتقال إلى «معتمَد» (من حالة غير معتمَدة) يتطلّب البوابة الحسّاسة 'decisions.approve'.
    if coalesce(nullif(p_data->>'status',''), v_old.status) = 'approved' and coalesce(v_old.status,'') <> 'approved'
       and not public.gov_can(p_project, 'decisions.approve') then raise exception 'not authorized'; end if;
    update public.project_decisions set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      decision = coalesce(nullif(btrim(p_data->>'decision'),''), decision), rationale = coalesce(nullif(btrim(p_data->>'rationale'),''), rationale),
      impact = coalesce(nullif(btrim(p_data->>'impact'),''), impact), status = coalesce(nullif(p_data->>'status',''), status),
      review_date = coalesce(nullif(p_data->>'review_date','')::date, review_date), client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      decided_by = case when coalesce(nullif(p_data->>'status',''), status)='approved' then coalesce(decided_by, auth.uid()) else decided_by end,
      decided_at = case when coalesce(nullif(p_data->>'status',''), status)='approved' then coalesce(decided_at, now()) else decided_at end,
      version = version + 1, updated_at = now()
      where id = v_id returning * into r;
    -- الإبطال يقع مرّة واحدة عند اعتماد قرار كان يُبطِل غيره (لم يكن معتمَدًا من قبل).
    if r.supersedes_decision_id is not null and r.status = 'approved' and coalesce(v_old.status,'') <> 'approved' then
      update public.project_decisions set status='superseded', version=version+1, updated_at=now()
        where id = r.supersedes_decision_id and project_id=p_project and status <> 'superseded';
    end if;
    perform public.pc_log(p_project, 'decision_updated', 'decision', v_id, jsonb_build_object('status', r.status));
  end if;
  return r;
end $$;

create or replace function public.pc_assumption_upsert(p_project uuid, p_data jsonb)
returns public.project_assumptions language plpgsql security definer set search_path = public as $$
declare r public.project_assumptions; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.gov_can(p_project, 'assumptions.manage') then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_assumptions(project_id, statement, source, owner_id, validation_date, status, validation_result, impact_if_false, linked_risk_id)
      values (p_project, btrim(coalesce(p_data->>'statement','')), nullif(btrim(p_data->>'source'),''), nullif(p_data->>'owner_id','')::uuid,
        nullif(p_data->>'validation_date','')::date, coalesce(nullif(p_data->>'status',''),'unverified'), nullif(btrim(p_data->>'validation_result'),''),
        nullif(btrim(p_data->>'impact_if_false'),''), nullif(p_data->>'linked_risk_id','')::uuid) returning * into r;
  else
    update public.project_assumptions set statement = coalesce(nullif(btrim(p_data->>'statement'),''), statement),
      status = coalesce(nullif(p_data->>'status',''), status), validation_result = coalesce(nullif(btrim(p_data->>'validation_result'),''), validation_result),
      validation_date = coalesce(nullif(p_data->>'validation_date','')::date, validation_date), updated_at = now()
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  perform public.pc_log(p_project, 'assumption_saved', 'assumption', r.id, jsonb_build_object('status', r.status));
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §14) RPCs — Change requests + Impact preview + Apply
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_change_request_upsert(p_project uuid, p_data jsonb)
returns public.project_change_requests language plpgsql security definer set search_path = public as $$
declare r public.project_change_requests; v_id uuid := nullif(p_data->>'id','')::uuid; v_no text; v_old public.project_change_requests; v_new text;
begin
  if not public.gov_can(p_project, 'changes.create') then raise exception 'not authorized'; end if;
  -- بوابات حسّاسة عند الإنشاء المباشر بحالة متقدّمة: البتّ (approved/rejected) ⇒ 'changes.approve'؛ وحالات التنفيذ/الإنهاء
  -- (implementing/implemented/verified/closed) ⇒ 'changes.apply' — كي لا يقفز محرِّرٌ عاديّ فوق آلية الاعتماد/التطبيق
  -- (not_approved + changes.apply) في project_change_request_apply بمجرّد 'changes.create'.
  if v_id is null and coalesce(nullif(p_data->>'status',''),'draft') in ('approved','rejected')
     and not public.gov_can(p_project, 'changes.approve') then raise exception 'not authorized'; end if;
  if v_id is null and coalesce(nullif(p_data->>'status',''),'draft') in ('implementing','implemented','verified','closed')
     and not public.gov_can(p_project, 'changes.apply') then raise exception 'not authorized'; end if;
  if v_id is null then
    v_no := 'CR-'||to_char(now(),'YYMM')||'-'||lpad(((select count(*)+1 from public.project_change_requests where project_id=p_project))::text,3,'0');
    insert into public.project_change_requests(project_id, request_no, title, description, change_type, requested_by, status, priority,
        reason, scope_impact, schedule_impact_days, resource_impact, quality_impact, financial_impact_reference, implementation_plan, rollback_plan)
      values (p_project, v_no, btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'description'),''),
        coalesce(nullif(p_data->>'change_type',''),'scope'), auth.uid(), coalesce(nullif(p_data->>'status',''),'draft'),
        coalesce(nullif(p_data->>'priority',''),'normal'), nullif(btrim(p_data->>'reason'),''), nullif(btrim(p_data->>'scope_impact'),''),
        nullif(p_data->>'schedule_impact_days','')::int, nullif(btrim(p_data->>'resource_impact'),''), nullif(btrim(p_data->>'quality_impact'),''),
        nullif(btrim(p_data->>'financial_impact_reference'),''), nullif(btrim(p_data->>'implementation_plan'),''), nullif(btrim(p_data->>'rollback_plan'),''))
      returning * into r;
    perform public.pc_log(p_project, 'change_request_created', 'change_request', r.id, jsonb_build_object('no', v_no));
  else
    select * into v_old from public.project_change_requests where id = v_id and project_id = p_project;
    if v_old.id is null then raise exception 'not_found'; end if;
    v_new := coalesce(nullif(p_data->>'status',''), v_old.status);
    -- البتّ حصريّ لحائز 'changes.approve'. تُشترط إذا: (أ) الطلب «معتمَد» أصلًا ⇒ أي تعديل عليه محظور (سلامة ما سيُطبَّق)، أو
    -- (ب) نُقِل فعليًا إلى حالة مبتوتة (approved/rejected) مختلفة ⇒ يمنع draft→approved وrejected→approved وapproved→rejected.
    -- يبقى مسموحًا للمحرِّر: تعديل المسوّدة، وإعادة فتح طلب مرفوض (rejected→draft)، وتعديل حقول طلب مرفوض دون تغيير حالته.
    if (coalesce(v_old.status,'') = 'approved'
        or (v_new in ('approved','rejected') and v_new is distinct from coalesce(v_old.status,'')))
       and not public.gov_can(p_project, 'changes.approve') then raise exception 'not authorized'; end if;
    -- الانتقال إلى حالات التنفيذ/الإنهاء (implementing/implemented/verified/closed) يتجاوز آلية التطبيق ⇒ يتطلّب 'changes.apply'.
    if v_new in ('implementing','implemented','verified','closed') and v_new is distinct from coalesce(v_old.status,'')
       and not public.gov_can(p_project, 'changes.apply') then raise exception 'not authorized'; end if;
    update public.project_change_requests set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      description = coalesce(nullif(btrim(p_data->>'description'),''), description), change_type = coalesce(nullif(p_data->>'change_type',''), change_type),
      status = coalesce(nullif(p_data->>'status',''), status), priority = coalesce(nullif(p_data->>'priority',''), priority),
      schedule_impact_days = coalesce(nullif(p_data->>'schedule_impact_days','')::int, schedule_impact_days),
      scope_impact = coalesce(nullif(btrim(p_data->>'scope_impact'),''), scope_impact), rollback_plan = coalesce(nullif(btrim(p_data->>'rollback_plan'),''), rollback_plan),
      decision = coalesce(nullif(p_data->>'decision',''), decision), version = version + 1, updated_at = now()
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.pc_log(p_project, 'change_request_updated', 'change_request', v_id, '{}');
  end if;
  return r;
end $$;

-- تحليل الأثر (قراءة فقط، لا يحفظ)
create or replace function public.project_change_impact_preview(p_change uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cr public.project_change_requests; v_finish0 date; v_finish1 date; v_tasks jsonb; v_conf int;
begin
  select * into cr from public.project_change_requests where id = p_change and is_deleted = false;
  if cr.id is null then raise exception 'not_found'; end if;
  if not public.gov_can(cr.project_id, 'changes.analyze') then raise exception 'not authorized'; end if;
  select max(due_date) into v_finish0 from public.project_tasks where project_id = cr.project_id and coalesce(is_deleted,false)=false and status <> 'cancelled';
  v_finish1 := case when cr.schedule_impact_days is not null then v_finish0 + cr.schedule_impact_days else v_finish0 end;
  select coalesce(jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title)), '[]'::jsonb) into v_tasks
    from public.change_request_tasks crt join public.project_tasks t on t.id = crt.task_id where crt.change_request_id = p_change;
  v_conf := 0;
  if to_regprocedure('public.resource_booking_conflicts(uuid,timestamptz,timestamptz,uuid,numeric)') is not null then
    select count(*) into v_conf from public.resource_bookings b where b.project_id = cr.project_id and b.is_deleted=false
      and b.status in ('hold','pending_approval','confirmed','in_use')
      and exists (select 1 from public.resource_booking_conflicts(b.resource_id,b.starts_at,b.ends_at,b.id,b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'));
  end if;
  return jsonb_build_object('change_request_id', p_change, 'affected_tasks', v_tasks,
    'affected_deliverables', (select coalesce(jsonb_agg(deliverable_id),'[]'::jsonb) from public.change_request_deliverables where change_request_id=p_change),
    'affected_resources', (select coalesce(jsonb_agg(resource_id),'[]'::jsonb) from public.change_request_resources where change_request_id=p_change),
    'schedule_delta_days', cr.schedule_impact_days, 'project_finish_before', v_finish0, 'project_finish_after', v_finish1,
    'booking_conflicts', v_conf, 'financial_impact_reference', cr.financial_impact_reference,
    'open_risks', (select count(*) from public.project_risks where project_id=cr.project_id and is_deleted=false and status not in ('closed','accepted') and severity in ('high','critical')),
    'warnings', case when cr.schedule_impact_days is not null and cr.schedule_impact_days>0 then jsonb_build_array(jsonb_build_object('type','schedule_slip','ar','قد يؤخّر التسليم '||cr.schedule_impact_days||' يومًا')) else '[]'::jsonb end,
    'calculation_method', 'schedule_impact_days على أقصى due؛ لا يحفظ. التغييرات الفعلية للمهام تُطبّق يدويًا عبر المخطط.', 'calculated_at', now());
end $$;

-- التطبيق: بعد الاعتماد فقط؛ ذرّي؛ لا يمسّ core_stage/المالية؛ لا يعدّل تواريخ المهام تلقائيًا (تبقى يدوية عبر المخطط) — يوثّق ويُغلق الدورة
create or replace function public.project_change_request_apply(p_change uuid, p_expected_version int, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cr public.project_change_requests;
begin
  select * into cr from public.project_change_requests where id = p_change and is_deleted = false for update;
  if cr.id is null then raise exception 'not_found'; end if;
  if not public.gov_can(cr.project_id, 'changes.apply') then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> cr.version then raise exception 'stale_update'; end if;
  -- لا تطبيق إلا بعد اعتماد (approval معتمد أو حالة approved)
  if cr.status not in ('approved') and not exists (select 1 from public.project_approvals a where a.id = cr.approval_id and a.status='approved')
    then raise exception 'not_approved'; end if;
  update public.project_change_requests set status='implemented', implemented_at=now(), version=version+1, updated_at=now() where id = p_change;
  perform public.pc_log(cr.project_id, 'change_request_applied', 'change_request', p_change,
    jsonb_build_object('schedule_impact_days', cr.schedule_impact_days, 'note', 'تُطبّق تعديلات المهام يدويًا عبر المخطط'));
  return jsonb_build_object('ok', true, 'status', 'implemented',
    'note_ar', 'وُثِّق التطبيق. عدّل المهام المتأثرة يدويًا عبر المخطط (لا تغيير تلقائي لتواريخ المهام).');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §15) RPCs — Approvals (governance flow + قرار/إلغاء/إعادة تعيين، توسيع الحالي)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_governance_approval_request(p_project uuid, p_data jsonb)
returns public.project_approvals language plpgsql security definer set search_path = public as $$
declare r public.project_approvals; v_type text; v_entity text; v_eid uuid;
begin
  if not public.gov_can(p_project, 'approvals.request') then raise exception 'not authorized'; end if;
  v_type := coalesce(nullif(p_data->>'approval_type',''), 'internal_review');
  v_entity := nullif(p_data->>'entity_type',''); v_eid := nullif(p_data->>'entity_id','')::uuid;
  -- منع Duplicate Pending لنفس (type,entity)
  if exists (select 1 from public.project_approvals where project_id=p_project and approval_type=v_type
      and coalesce(entity_id,'00000000-0000-0000-0000-000000000000')=coalesce(v_eid,'00000000-0000-0000-0000-000000000000')
      and status in ('draft','pending') and coalesce(is_deleted,false)=false)
    then raise exception 'duplicate_pending'; end if;
  insert into public.project_approvals(project_id, approval_type, entity_type, entity_id, kind, status, title, note, requested_by,
      due_at, sequence_order, required_role, required_user_id)
    values (p_project, v_type, v_entity, v_eid,
      case when v_type in ('client_review','deliverable_approval') then 'client' else 'internal' end, 'pending',
      nullif(btrim(p_data->>'title'),''), nullif(btrim(p_data->>'note'),''), auth.uid(),
      coalesce(nullif(p_data->>'due_at','')::timestamptz, now() + (coalesce((select approval_sla_hours from public.project_governance_settings where project_id=p_project),48) || ' hours')::interval),
      coalesce(nullif(p_data->>'sequence_order','')::int, 0), nullif(p_data->>'required_role',''), nullif(p_data->>'required_user_id','')::uuid)
    returning * into r;
  perform public.pc_log(p_project, 'approval_requested', 'approval', r.id, jsonb_build_object('type', v_type));
  if r.required_user_id is not null then
    perform public.pc_event_emit(p_project, 'approval_requested', 'approval', r.id, 'action', 'طلب اعتماد يحتاج قرارك', 'Approval needs your decision', null, null,
      '/client-portal/project-core/'||p_project||'?tab=governance', array[r.required_user_id], 'appr_req:'||r.id);
  end if;
  return r;
end $$;

-- قرار الاعتماد (توسيع بنفس التوقيع 3-args لتفادي Overload مع الدالة الحالية):
-- actions approve/reject/request_changes + منع self-approval + قيود الحالة. الحماية من القرار
-- المزدوج عبر status='pending' + FOR UPDATE (لا حاجة لـexpected_version على هذه الدالة).
create or replace function public.pc_approval_decide(p_approval uuid, p_decision text, p_note text default null)
returns public.project_approvals language plpgsql security definer set search_path = public as $$
declare r public.project_approvals; b public.project_approvals; v_new text;
begin
  select * into b from public.project_approvals where id = p_approval for update;
  if b.id is null then raise exception 'not_found'; end if;
  if coalesce(b.is_deleted,false) then raise exception 'not_found'; end if;
  if b.status not in ('pending','draft') then raise exception 'already_decided'; end if;
  -- خريطة الإجراءات (تدعم القيم القديمة والجديدة). القيمة المخزَّنة القياسية لطلب التعديل هي 'revision_requested'
  -- (وهي ما تعرضه ApprovalsTab القديمة عبر APPROVAL_STATUS_LABELS)؛ لا نُخزّن 'changes_requested' كيلا تظهر
  -- الحالة فارغة في الواجهة القديمة. الطلب الجديد (request_changes) يُطبَّع أيضًا إلى 'revision_requested'.
  v_new := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected'
    when 'request_changes' then 'revision_requested' when 'revision_requested' then 'revision_requested'
    when 'approved' then 'approved' when 'rejected' then 'rejected' else null end;
  if v_new is null then raise exception 'bad_decision'; end if;
  -- الصلاحية: client → مالك العميل؛ داخلي → approvals.decide + is_staff. required_user_id إن حُدّد يقصر القرار عليه.
  if b.kind = 'client' then
    if not public.is_client_owner(b.project_id) and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  else
    if not public.gov_can(b.project_id, 'approvals.decide') then raise exception 'not authorized'; end if;
  end if;
  if b.required_user_id is not null and b.required_user_id <> auth.uid() and not public.can_manage_projects() then raise exception 'not_your_approval'; end if;
  -- منع اعتماد الطالب لطلبه (إلا مدير المشاريع)
  if v_new = 'approved' and b.requested_by = auth.uid() and not public.can_manage_projects() then raise exception 'self_approval_not_allowed'; end if;
  update public.project_approvals set status = v_new, decision = v_new, decision_note = nullif(btrim(p_note),''),
      rejection_reason = case when v_new='rejected' then nullif(btrim(p_note),'') else rejection_reason end,
      decided_by = auth.uid(), decided_at = now(), version = coalesce(version,1) + 1, updated_at = now()
    where id = p_approval returning * into r;
  perform public.pc_log(b.project_id, 'approval_'||v_new, 'approval', p_approval, '{}');
  if b.requested_by is not null then
    perform public.pc_notify_user(b.requested_by, 'project_status_changed', 'approval', p_approval,
      'قرار الاعتماد: '||v_new, 'Approval decision: '||v_new);
  end if;
  return r;
end $$;

create or replace function public.pc_approval_cancel(p_approval uuid, p_reason text, p_expected_version int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.project_approvals;
begin
  select * into b from public.project_approvals where id = p_approval for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not (public.gov_can(b.project_id, 'approvals.request') and (b.requested_by = auth.uid() or public.can_manage_projects())) then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> coalesce(b.version,1) then raise exception 'stale_update'; end if;
  if b.status not in ('pending','draft') then raise exception 'already_decided'; end if;
  update public.project_approvals set status='cancelled', cancelled_at=now(), decision_note=nullif(btrim(p_reason),''), version=coalesce(version,1)+1, updated_at=now() where id=p_approval;
  perform public.pc_log(b.project_id, 'approval_cancelled', 'approval', p_approval, '{}');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pc_approval_reassign(p_approval uuid, p_new_user uuid, p_reason text, p_expected_version int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.project_approvals;
begin
  select * into b from public.project_approvals where id = p_approval for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not public.gov_can(b.project_id, 'approvals.reassign') then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> coalesce(b.version,1) then raise exception 'stale_update'; end if;
  if b.status <> 'pending' then raise exception 'already_decided'; end if;
  update public.project_approvals set required_user_id = p_new_user, version=coalesce(version,1)+1, updated_at=now() where id=p_approval;
  perform public.pc_log(b.project_id, 'approval_reassigned', 'approval', p_approval, jsonb_build_object('to', p_new_user, 'reason', p_reason));
  perform public.pc_event_emit(b.project_id, 'approval_requested', 'approval', p_approval, 'action', 'أُعيد إليك اعتماد', 'Approval reassigned to you', null, null,
    '/client-portal/project-core/'||b.project_id||'?tab=governance', array[p_new_user], 'appr_reassign:'||p_approval);
  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §16) Stage Gate + Governance Dashboard + Health + Inbox (قراءة، بلا N+1، بلا Temp Tables)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_stage_gate_check(p_project uuid, p_target text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ready jsonb; v_gov jsonb; v_mode text; v_crit_risks int; v_crit_issues int; v_pending_changes int; v_open_appr int; v_blockers jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin v_ready := public.project_stage_readiness(p_project); exception when others then v_ready := '{}'::jsonb; end;
  select stage_gate_mode into v_mode from public.project_governance_settings where project_id = p_project;
  v_mode := coalesce(v_mode, 'advisory');
  select count(*) into v_crit_risks from public.project_risks where project_id=p_project and is_deleted=false and status not in ('closed','accepted') and severity='critical';
  select count(*) into v_crit_issues from public.project_issues where project_id=p_project and is_deleted=false and status not in ('resolved','closed','rejected') and severity='critical';
  select count(*) into v_pending_changes from public.project_change_requests where project_id=p_project and is_deleted=false and status in ('submitted','impact_analysis','pending_approval');
  select count(*) into v_open_appr from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false and status='pending';
  v_blockers := (select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select jsonb_build_object('type','critical_risks','count',v_crit_risks,'ar',v_crit_risks||' مخاطرة حرجة مفتوحة') x where v_crit_risks>0
      union all select jsonb_build_object('type','critical_issues','count',v_crit_issues,'ar',v_crit_issues||' مشكلة حرجة مفتوحة') where v_crit_issues>0
      union all select jsonb_build_object('type','pending_changes','count',v_pending_changes,'ar',v_pending_changes||' طلب تغيير معلّق') where v_pending_changes>0
      union all select jsonb_build_object('type','open_approvals','count',v_open_appr,'ar',v_open_appr||' اعتماد معلّق') where v_open_appr>0) z);
  return jsonb_build_object('project_id', p_project, 'target', p_target, 'stage_gate_mode', v_mode,
    'readiness', v_ready, 'gate_blockers', v_blockers, 'blocked', (jsonb_array_length(v_blockers) > 0),
    'can_override', public.gov_can(p_project,'stage_gates.override'),
    'note_ar', case when v_mode='enforced' then 'وضع enforced: تُمنع الترقية حتى المعالجة أو تجاوز رسمي.' else 'وضع advisory: تحذير فقط، يمكن المتابعة.' end,
    'calculated_at', now());
end $$;
revoke execute on function public.project_stage_gate_check(uuid,text) from public, anon;
grant execute on function public.project_stage_gate_check(uuid,text) to authenticated;

-- الصحّة (مشتقة، مفسّرة، لا Black Box، لا تُخزَّن)
create or replace function public.project_governance_health(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_crit_risks int; v_crit_issues int; v_overdue_appr int; v_pending_changes int; v_stale_decisions int; v_expired_assumptions int;
  v_score int := 100; v_reasons jsonb := '[]'::jsonb; v_status text;
begin
  if not (public.pc_can_read_project(p_project) and public.gov_can(p_project,'governance.view')) then raise exception 'not authorized'; end if;
  select count(*) into v_crit_risks from public.project_risks where project_id=p_project and is_deleted=false and status not in ('closed','accepted') and severity='critical';
  select count(*) into v_crit_issues from public.project_issues where project_id=p_project and is_deleted=false and status not in ('resolved','closed','rejected') and severity='critical';
  select count(*) into v_overdue_appr from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false and status='pending' and due_at is not null and due_at < now();
  select count(*) into v_pending_changes from public.project_change_requests where project_id=p_project and is_deleted=false and status in ('submitted','impact_analysis','pending_approval');
  select count(*) into v_stale_decisions from public.project_decisions where project_id=p_project and is_deleted=false and status='approved' and review_date is not null and review_date < (now() at time zone 'utc')::date;
  select count(*) into v_expired_assumptions from public.project_assumptions where project_id=p_project and is_deleted=false and status in ('expired','unverified') and validation_date is not null and validation_date < (now() at time zone 'utc')::date;
  v_score := v_score - v_crit_risks*20 - v_crit_issues*20 - v_overdue_appr*10 - v_pending_changes*5 - v_stale_decisions*5 - v_expired_assumptions*3;
  v_score := greatest(v_score, 0);
  v_reasons := (select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select jsonb_build_object('type','critical_risks','severity','critical','count',v_crit_risks,'ar',v_crit_risks||' مخاطرة حرجة') x where v_crit_risks>0
      union all select jsonb_build_object('type','critical_issues','severity','critical','count',v_crit_issues,'ar',v_crit_issues||' مشكلة حرجة') where v_crit_issues>0
      union all select jsonb_build_object('type','overdue_approvals','severity','high','count',v_overdue_appr,'ar',v_overdue_appr||' اعتماد متأخر') where v_overdue_appr>0
      union all select jsonb_build_object('type','pending_changes','severity','medium','count',v_pending_changes,'ar',v_pending_changes||' تغيير معلّق') where v_pending_changes>0
      union all select jsonb_build_object('type','stale_decisions','severity','medium','count',v_stale_decisions,'ar',v_stale_decisions||' قرار يحتاج مراجعة') where v_stale_decisions>0
      union all select jsonb_build_object('type','expired_assumptions','severity','low','count',v_expired_assumptions,'ar',v_expired_assumptions||' افتراض غير مؤكّد') where v_expired_assumptions>0) z);
  v_status := case when v_crit_risks+v_crit_issues>0 or v_score<50 then 'critical' when v_overdue_appr>0 or v_score<70 then 'at_risk'
                   when v_pending_changes+v_stale_decisions>0 or v_score<90 then 'attention' else 'healthy' end;
  return jsonb_build_object('project_id', p_project, 'health_status', v_status, 'health_score', v_score, 'reasons', v_reasons,
    'counts', jsonb_build_object('critical_risks',v_crit_risks,'critical_issues',v_crit_issues,'overdue_approvals',v_overdue_appr,
       'pending_changes',v_pending_changes,'stale_decisions',v_stale_decisions,'expired_assumptions',v_expired_assumptions),
    'calculated_at', now());
end $$;
revoke execute on function public.project_governance_health(uuid) from public, anon;
grant execute on function public.project_governance_health(uuid) to authenticated;

-- لوحة الحوكمة الموحّدة (RPC واحد، بلا N+1)
create or replace function public.project_governance_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.pc_can_read_project(p_project) and public.gov_can(p_project,'governance.view')) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'project_id', p_project,
    'settings', coalesce((select to_jsonb(s) from public.project_governance_settings s where s.project_id=p_project), '{}'::jsonb),
    'health', public.project_governance_health(p_project),
    'stage_gate', public.project_stage_gate_check(p_project, null),
    'pending_approvals', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'approval_type',a.approval_type,'title',a.title,'status',a.status,'due_at',a.due_at,
        'required_user_id',a.required_user_id,'overdue',(a.due_at is not null and a.due_at<now())) order by a.due_at nulls last),'[]'::jsonb)
      from public.project_approvals a where a.project_id=p_project and coalesce(a.is_deleted,false)=false and a.status in ('pending','draft')),
    'risks', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'category',r.category,'probability',r.probability,'impact',r.impact,
        'risk_score',r.risk_score,'severity',r.severity,'status',r.status,'owner_id',r.owner_id,'client_visible',r.client_visible) order by r.risk_score desc),'[]'::jsonb)
      from public.project_risks r where r.project_id=p_project and r.is_deleted=false and r.status not in ('closed')),
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'severity',i.severity,'status',i.status,'due_date',i.due_date,'owner_id',i.owner_id) order by (case i.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end)),'[]'::jsonb)
      from public.project_issues i where i.project_id=p_project and i.is_deleted=false and i.status not in ('closed','resolved')),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'status',d.status,'review_date',d.review_date) order by d.created_at desc),'[]'::jsonb)
      from public.project_decisions d where d.project_id=p_project and d.is_deleted=false),
    'assumptions', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'statement',a.statement,'status',a.status,'validation_date',a.validation_date) order by a.created_at desc),'[]'::jsonb)
      from public.project_assumptions a where a.project_id=p_project and a.is_deleted=false),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'request_no',c.request_no,'title',c.title,'change_type',c.change_type,'status',c.status,'priority',c.priority,'schedule_impact_days',c.schedule_impact_days) order by c.created_at desc),'[]'::jsonb)
      from public.project_change_requests c where c.project_id=p_project and c.is_deleted=false and c.status not in ('closed','cancelled')),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id',mr.id,'user_id',mr.user_id,'project_role',mr.project_role)),'[]'::jsonb)
      from public.project_member_roles mr where mr.project_id=p_project and mr.is_deleted=false),
    -- مطابِق تمامًا لمرشِّح مصفوفة 'risks' أدناه (يستثني 'closed' فقط) كي يطابق عدّاد الخلية عناصر القائمة عند النقر.
    'risk_matrix', (select coalesce(jsonb_object_agg(cell, cnt),'{}'::jsonb) from (
        select (probability||'x'||impact) as cell, count(*) as cnt from public.project_risks
        where project_id=p_project and is_deleted=false and status not in ('closed') group by probability, impact) m),
    'generated_at', now()) into v;
  return v;
end $$;
revoke execute on function public.project_governance_dashboard(uuid) from public, anon;
grant execute on function public.project_governance_dashboard(uuid) to authenticated;

-- صندوق اعتماداتي (عبر المشاريع)
create or replace function public.my_approval_inbox(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_status text;
begin
  if not public.is_staff() and not public.emp_has_permission('approvals.view') then
    -- العميل يرى فقط اعتماداته المطلوبة منه (client kind) على مشاريعه
    null;
  end if;
  v_status := nullif(p_filters->>'status','');
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'project_id',a.project_id,
      'project_name',(select project_name from public.projects p where p.id=a.project_id),
      'approval_type',a.approval_type,'kind',a.kind,'title',a.title,'status',a.status,'due_at',a.due_at,
      'requested_by',a.requested_by,'required_user_id',a.required_user_id,
      'mine',(a.required_user_id=auth.uid()),'overdue',(a.due_at is not null and a.due_at<now() and a.status='pending')) order by a.due_at nulls last),'[]'::jsonb) into v
  from public.project_approvals a
  where coalesce(a.is_deleted,false)=false and public.pc_can_read_project(a.project_id)
    and (v_status is null or a.status = v_status)
    and (
      a.required_user_id = auth.uid()             -- مطلوب منّي
      or a.requested_by = auth.uid()               -- أنشأتُه
      or (public.is_staff() and public.gov_can(a.project_id,'approvals.view'))  -- staff مخوّل
      or (a.kind='client' and public.is_client_owner(a.project_id))            -- العميل يرى اعتماداته
    );
  return jsonb_build_object('approvals', v, 'generated_at', now());
end $$;
revoke execute on function public.my_approval_inbox(jsonb) from public, anon;
grant execute on function public.my_approval_inbox(jsonb) to authenticated;

-- ═══ §17) الصلاحيات على دوال الكتابة ═══
grant execute on function public.pc_project_role_add(uuid,uuid,text), public.pc_project_role_remove(uuid),
  public.pc_governance_settings_upsert(uuid,jsonb), public.pc_risk_to_issue(uuid), public.pc_issue_upsert(uuid,jsonb),
  public.pc_decision_upsert(uuid,jsonb), public.pc_assumption_upsert(uuid,jsonb), public.pc_change_request_upsert(uuid,jsonb),
  public.project_change_impact_preview(uuid), public.project_change_request_apply(uuid,int,jsonb),
  public.pc_governance_approval_request(uuid,jsonb), public.pc_approval_cancel(uuid,text,int), public.pc_approval_reassign(uuid,uuid,text,int)
  to authenticated;

-- ═══ §18) RLS — عزل العميل: لا يرى الحوكمة الداخلية إلا client_visible ═══
alter table public.project_member_roles          enable row level security;
alter table public.project_governance_settings   enable row level security;
alter table public.project_issues                enable row level security;
alter table public.project_decisions             enable row level security;
alter table public.project_assumptions           enable row level security;
alter table public.project_change_requests       enable row level security;

drop policy if exists pmr_read on public.project_member_roles;
create policy pmr_read on public.project_member_roles for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
drop policy if exists pgs_read on public.project_governance_settings;
create policy pgs_read on public.project_governance_settings for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
-- ملاحظة: pc_can_read_project = staff فقط (staff_reads_all_projects OR (is_staff AND can_access_project))، فلا
-- يتحقّق للعميل. لذا مسار العميل يمرّ عبر is_client_owner صراحةً: الموظّف يرى الكل، ومالك العميل يرى client_visible
-- على مشروعه فقط. (القراءة الفعلية تمرّ عبر دشبورد SECURITY DEFINER؛ هذه السياسات دفاع بالعمق للوصول المباشر.)
drop policy if exists pi_read on public.project_issues;
create policy pi_read on public.project_issues for select to authenticated using (public.pc_can_read_project(project_id) or (client_visible and public.is_client_owner(project_id)));
drop policy if exists pd_read on public.project_decisions;
create policy pd_read on public.project_decisions for select to authenticated using (public.pc_can_read_project(project_id) or (client_visible and public.is_client_owner(project_id)));
drop policy if exists pa_read on public.project_assumptions;
create policy pa_read on public.project_assumptions for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
drop policy if exists pcr_read on public.project_change_requests;
create policy pcr_read on public.project_change_requests for select to authenticated using (public.is_staff() and public.pc_can_read_project(project_id));
-- المخاطر: عزل client_visible أيضًا (إن لم يكن للجدول سياسة سابقة تكفي)
drop policy if exists prisk_client_read on public.project_risks;
create policy prisk_client_read on public.project_risks for select to authenticated using (public.pc_can_read_project(project_id) or (client_visible and public.is_client_owner(project_id)));

-- الكتابة عبر RPCs فقط
revoke insert, update, delete on public.project_member_roles, public.project_governance_settings, public.project_issues,
  public.project_decisions, public.project_assumptions, public.project_change_requests,
  public.change_request_tasks, public.change_request_deliverables, public.change_request_resources from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- §19) اختبار ذاتي — يُلغي المعاملة عند فشل العقد (منطق مشتقّ عبر savepoint، بلا آثار خارجية)
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_pid uuid; v_rid uuid; v_sev text; v_score int; v_ok boolean := false;
begin
  -- (أ) الدوال والجداول أُنشئت
  if to_regclass('public.project_member_roles') is null or to_regclass('public.project_issues') is null
     or to_regclass('public.project_decisions') is null or to_regclass('public.project_change_requests') is null then raise exception '5A FAIL: جداول ناقصة'; end if;
  if to_regprocedure('public.project_governance_dashboard(uuid)') is null or to_regprocedure('public.project_governance_health(uuid)') is null
     or to_regprocedure('public.pc_governance_approval_request(uuid,jsonb)') is null then raise exception '5A FAIL: دوال ناقصة'; end if;

  -- (ب) اشتقاق severity من probability×impact عبر savepoint (يُتراجع عنه)
  begin
    select id into v_pid from public.projects where coalesce(is_deleted,false)=false limit 1;
    if v_pid is not null then
      insert into public.project_risks(project_id, title, probability, impact, created_by)
        values (v_pid, '__selftest_risk__', 5, 5, null) returning id, severity, risk_score into v_rid, v_sev, v_score;
      if v_score <> 25 or v_sev <> 'critical' then raise exception '5A FAIL: risk_score/severity غير مشتقة (score=% sev=%)', v_score, v_sev; end if;
      -- تعديل ليصبح 2×2=4 → low
      update public.project_risks set probability=2, impact=2 where id=v_rid;
      select severity, risk_score into v_sev, v_score from public.project_risks where id=v_rid;
      if v_score <> 4 or v_sev <> 'low' then raise exception '5A FAIL: إعادة اشتقاق severity فشلت'; end if;
      -- حالة 'occurred' مسموحة بعد توسيع القيد (وإلا فشل pc_risk_to_issue بـ check_violation).
      update public.project_risks set status='occurred' where id=v_rid;
      -- تعديل جزئي (status فقط، بلا probability/impact) لا يجب أن يُغيّر النطاق 2×2 (حارس فساد بيانات B).
      select probability into v_score from public.project_risks where id=v_rid;
      if v_score <> 2 then raise exception '5A FAIL: تعديل الحالة غيّر probability (فساد بيانات)'; end if;
      v_ok := true;
    else v_ok := true; end if;
    raise exception '__sp_rollback__';
  exception when others then
    if sqlerrm <> '__sp_rollback__' then raise; end if;
  end;
  if not v_ok then raise exception '5A FAIL: لم يكتمل اختبار الاشتقاق'; end if;

  -- (ج) الصلاحيات مُدرجة
  if (select count(*) from public.permissions where category='governance') < 25 then raise exception '5A FAIL: صلاحيات الحوكمة ناقصة'; end if;

  raise notice '5A ✅ نجح الاختبار الذاتي — جداول/دوال/اشتقاق severity/صلاحيات.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
