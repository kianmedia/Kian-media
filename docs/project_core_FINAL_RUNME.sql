-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — منصة إدارة وتشغيل المشاريع (Enterprise Project Operations)
-- ملف واحد، Idempotent، Production-Safe، Backward-Compatible.
--
-- المبدأ المعماري: طبقة تشغيلية إضافية فوق جداول المشاريع القائمة دون المساس بها.
--   • لا يُعدّل أي جدول قديم (projects / project_members / deliverables / …).
--   • يعيد استخدام دوال الصلاحية الحيّة: can_access_project(uuid),
--     can_manage_projects(), can_edit_project(uuid), is_owner(), is_staff(),
--     is_admin(), project_role(uuid)، ودالة الإشعار notify(...).
--   • دورة حياة تشغيلية منفصلة (project_core.core_stage) عن حالة العميل
--     (projects.status الحالية) — لا تكسر admin_set_project_status ولا الـ7 قيم.
--   • الإشعارات تعيد استخدام نوعَين قائمَين ضمن الأساس (project_status_changed
--     و project_note_new) لتفادي إعادة إعلان CHECK الضخم — صفر خطر على الأنواع.
--
-- كل الجداول: create if not exists. كل الدوال: create or replace + security definer
-- + set search_path=public. كل السياسات: drop if exists ثم create. لا حذف بيانات.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) الجداول
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 امتداد 1:1 لكل مشروع — دورة الحياة التشغيلية + ملخص الأولوية/الميزانية/الصحة.
create table if not exists public.project_core (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  core_stage     text not null default 'project_created'
                 check (core_stage in ('lead_approved','project_created','planning','ready','scheduled',
                        'in_production','post_production','internal_review','client_review','revision',
                        'approved','delivered','closed')),
  priority       text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  health         text not null default 'on_track' check (health in ('on_track','at_risk','off_track')),
  start_date     date,
  due_date       date,
  delivery_date  date,
  budget_amount  numeric check (budget_amount is null or budget_amount >= 0),
  estimated_cost numeric check (estimated_cost is null or estimated_cost >= 0),
  actual_cost    numeric check (actual_cost is null or actual_cost >= 0),
  currency       text not null default 'SAR',
  progress_pct   int not null default 0 check (progress_pct between 0 and 100),
  project_type   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id)
);

-- 1.2 سجل انتقالات دورة الحياة (Audit).
create table if not exists public.project_status_history (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  note        text,
  changed_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- 1.3 سجل النشاط المرئي للفريق (يختلف عن activity_log الإداري العام).
create table if not exists public.project_activity (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- 1.4 المهام (+المهام الفرعية عبر parent_task_id).
create table if not exists public.project_tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  parent_task_id uuid references public.project_tasks(id) on delete cascade,
  title          text not null,
  description    text,
  status         text not null default 'todo'
                 check (status in ('todo','in_progress','blocked','in_review','done','cancelled')),
  priority       text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id    uuid references auth.users(id),
  start_date     date,
  due_date       date,
  estimated_hours numeric check (estimated_hours is null or estimated_hours >= 0),
  actual_hours    numeric check (actual_hours is null or actual_hours >= 0),
  progress_pct   int not null default 0 check (progress_pct between 0 and 100),
  labels         text[] not null default '{}',
  sort_order     int not null default 0,
  recurring      text check (recurring is null or recurring in ('daily','weekly','monthly')),
  created_by     uuid references auth.users(id),
  completed_at   timestamptz,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.project_task_checklists (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.project_tasks(id) on delete cascade,
  label      text not null,
  is_done    boolean not null default false,
  sort_order int not null default 0,
  done_by    uuid references auth.users(id),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.project_tasks(id) on delete cascade,
  author_id  uuid references auth.users(id),
  body       text not null check (length(btrim(body)) between 1 and 8000),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.task_followers (
  task_id    uuid not null references public.project_tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create table if not exists public.task_dependencies (
  task_id            uuid not null references public.project_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.project_tasks(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dep_no_self check (task_id <> depends_on_task_id)
);

create table if not exists public.task_files (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.project_tasks(id) on delete cascade,
  file_url    text not null,
  file_name   text,
  mime_type   text,
  uploaded_by uuid references auth.users(id),
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 1.5 تتبّع الوقت.
create table if not exists public.project_time_logs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  task_id     uuid references public.project_tasks(id) on delete set null,
  user_id     uuid references auth.users(id),
  minutes     int not null check (minutes > 0 and minutes <= 1440),
  logged_for  date not null default (now() at time zone 'utc')::date,
  note        text,
  created_at  timestamptz not null default now()
);

-- 1.6 التكاليف (حساسة — تُقرأ للإدارة/المالية فقط).
create table if not exists public.project_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  category    text not null default 'general'
              check (category in ('general','crew','equipment','transport','location','post','licensing','other')),
  description text,
  amount      numeric not null check (amount >= 0),
  currency    text not null default 'SAR',
  cost_date   date not null default (now() at time zone 'utc')::date,
  created_by  uuid references auth.users(id),
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 1.7 المخاطر.
create table if not exists public.project_risks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  description text,
  severity    text not null default 'medium' check (severity in ('low','medium','high','critical')),
  likelihood  text not null default 'possible' check (likelihood in ('rare','possible','likely','almost_certain')),
  status      text not null default 'open' check (status in ('open','mitigating','closed','accepted')),
  mitigation  text,
  owner_id    uuid references auth.users(id),
  is_deleted  boolean not null default false,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 1.8 الاجتماعات.
create table if not exists public.project_meetings (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null,
  scheduled_at     timestamptz,
  duration_minutes int check (duration_minutes is null or duration_minutes > 0),
  location         text,
  meeting_url      text,
  notes            text,
  created_by       uuid references auth.users(id),
  is_deleted       boolean not null default false,
  created_at       timestamptz not null default now()
);

-- 1.9 المواقع.
create table if not exists public.project_locations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  address     text,
  lat         numeric,
  lng         numeric,
  note        text,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 1.10 جلسات التصوير.
create table if not exists public.project_shoot_sessions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  title             text not null,
  session_date      date,
  call_time         timestamptz,
  location          text,
  location_id       uuid references public.project_locations(id) on delete set null,
  crew              jsonb not null default '[]',
  equipment         jsonb not null default '[]',
  vehicles          jsonb not null default '[]',
  permits           text,
  safety_notes      text,
  client_contact    text,
  weather_note      text,
  shot_list         jsonb not null default '[]',
  checklist         jsonb not null default '[]',
  attendance        jsonb not null default '[]',
  status            text not null default 'planned'
                    check (status in ('planned','confirmed','in_progress','completed','cancelled')),
  completion_report text,
  created_by        uuid references auth.users(id),
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 1.11 الاعتمادات (تعميم فوق deliverable_reviews — يشمل داخلي/مدير/عميل + المشروع).
create table if not exists public.project_approvals (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id) on delete cascade,
  kind           text not null default 'internal' check (kind in ('internal','manager','client')),
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','revision_requested')),
  title          text,
  note           text,
  decision_note  text,
  requested_by   uuid references auth.users(id),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- 1.12 الوسوم.
create table if not exists public.project_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text not null default '#6b7280',
  created_at timestamptz not null default now()
);
create table if not exists public.project_tag_map (
  project_id uuid not null references public.projects(id) on delete cascade,
  tag_id     uuid not null references public.project_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, tag_id)
);

-- 1.13 القوالب.
create table if not exists public.project_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  spec        jsonb not null default '{}',
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 1.14 إصدارات المُخرجات (Versioning إضافي فوق deliverables القائم).
create table if not exists public.project_deliverable_versions (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  version        int not null,
  preview_url    text,
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  unique (deliverable_id, version)
);

-- 1.15 اعتماديات المشاريع (مشروع يعتمد على مشروع آخر).
create table if not exists public.project_dependencies (
  project_id            uuid not null references public.projects(id) on delete cascade,
  depends_on_project_id uuid not null references public.projects(id) on delete cascade,
  dep_type              text not null default 'blocks' check (dep_type in ('blocks','related','duplicates')),
  created_at            timestamptz not null default now(),
  primary key (project_id, depends_on_project_id),
  constraint project_dep_no_self check (project_id <> depends_on_project_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) الفهارس
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists idx_pc_stage           on public.project_core(core_stage);
create index if not exists idx_pc_priority         on public.project_core(priority);
create index if not exists idx_psh_project         on public.project_status_history(project_id, created_at desc);
create index if not exists idx_pact_project        on public.project_activity(project_id, created_at desc);
create index if not exists idx_ptasks_project      on public.project_tasks(project_id) where is_deleted = false;
create index if not exists idx_ptasks_assignee     on public.project_tasks(assignee_id) where is_deleted = false;
create index if not exists idx_ptasks_status       on public.project_tasks(status) where is_deleted = false;
create index if not exists idx_ptasks_parent       on public.project_tasks(parent_task_id) where is_deleted = false;
create index if not exists idx_ptasks_due          on public.project_tasks(due_date) where is_deleted = false;
create index if not exists idx_pchk_task           on public.project_task_checklists(task_id);
create index if not exists idx_tcom_task           on public.task_comments(task_id) where is_deleted = false;
create index if not exists idx_tfol_user           on public.task_followers(user_id);
create index if not exists idx_tfiles_task         on public.task_files(task_id) where is_deleted = false;
create index if not exists idx_ptime_project       on public.project_time_logs(project_id, logged_for desc);
create index if not exists idx_ptime_task          on public.project_time_logs(task_id);
create index if not exists idx_pcost_project       on public.project_costs(project_id) where is_deleted = false;
create index if not exists idx_prisk_project       on public.project_risks(project_id) where is_deleted = false;
create index if not exists idx_pmeet_project       on public.project_meetings(project_id) where is_deleted = false;
create index if not exists idx_ploc_project        on public.project_locations(project_id) where is_deleted = false;
create index if not exists idx_pshoot_project      on public.project_shoot_sessions(project_id) where is_deleted = false;
create index if not exists idx_pappr_project       on public.project_approvals(project_id, created_at desc);
create index if not exists idx_pappr_status        on public.project_approvals(status);
create index if not exists idx_ptagmap_tag         on public.project_tag_map(tag_id);
create index if not exists idx_pdv_deliverable     on public.project_deliverable_versions(deliverable_id, version desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS — القراءة عبر can_access_project / can_manage_projects / can_see_financials.
--    الكتابة: الجداول التشغيلية الأساسية عبر RPCs فقط (لا منح insert/update)؛
--    الجداول الثانوية عبر RLS مباشرة (منح + سياسات with check).
-- ════════════════════════════════════════════════════════════════════════════

-- مُمكّن على الجميع.
alter table public.project_core                enable row level security;
alter table public.project_status_history      enable row level security;
alter table public.project_activity            enable row level security;
alter table public.project_tasks               enable row level security;
alter table public.project_task_checklists     enable row level security;
alter table public.task_comments               enable row level security;
alter table public.task_followers              enable row level security;
alter table public.task_dependencies           enable row level security;
alter table public.task_files                  enable row level security;
alter table public.project_time_logs           enable row level security;
alter table public.project_costs               enable row level security;
alter table public.project_risks               enable row level security;
alter table public.project_meetings            enable row level security;
alter table public.project_locations           enable row level security;
alter table public.project_shoot_sessions      enable row level security;
alter table public.project_approvals           enable row level security;
alter table public.project_tags                enable row level security;
alter table public.project_tag_map             enable row level security;
alter table public.project_templates           enable row level security;
alter table public.project_deliverable_versions enable row level security;
alter table public.project_dependencies        enable row level security;

-- Project Core منصّة داخلية للفريق: القراءة للكوادر فقط. مالك/مدير/دعم/قراءة-فقط
-- يرون كل المشاريع (staff_reads_all_projects)؛ باقي الكوادر يرون مشاريعهم المُسندة
-- (can_access_project). العملاء (غير staff) مُستبعَدون تمامًا — لا تسرّب مالي/تشغيلي.
create or replace function public.pc_can_read_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.staff_reads_all_projects() or (public.is_staff() and public.can_access_project(p_project));
$$;
revoke all on function public.pc_can_read_project(uuid) from public, anon;
grant  execute on function public.pc_can_read_project(uuid) to authenticated;

-- READ policies (staff-scoped).
drop policy if exists pc_read on public.project_core;
create policy pc_read on public.project_core for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists psh_read on public.project_status_history;
create policy psh_read on public.project_status_history for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists pact_read on public.project_activity;
create policy pact_read on public.project_activity for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists ptasks_read on public.project_tasks;
create policy ptasks_read on public.project_tasks for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists pchk_read on public.project_task_checklists;
create policy pchk_read on public.project_task_checklists for select to authenticated
  using (exists (select 1 from public.project_tasks t where t.id = task_id and public.pc_can_read_project(t.project_id)));

drop policy if exists tcom_read on public.task_comments;
create policy tcom_read on public.task_comments for select to authenticated
  using (exists (select 1 from public.project_tasks t where t.id = task_id and public.pc_can_read_project(t.project_id)));

drop policy if exists tfol_read on public.task_followers;
create policy tfol_read on public.task_followers for select to authenticated
  using (exists (select 1 from public.project_tasks t where t.id = task_id and public.pc_can_read_project(t.project_id)));

drop policy if exists tdep_read on public.task_dependencies;
create policy tdep_read on public.task_dependencies for select to authenticated
  using (exists (select 1 from public.project_tasks t where t.id = task_id and public.pc_can_read_project(t.project_id)));

drop policy if exists tfiles_read on public.task_files;
create policy tfiles_read on public.task_files for select to authenticated
  using (exists (select 1 from public.project_tasks t where t.id = task_id and public.pc_can_read_project(t.project_id)));

drop policy if exists ptime_read on public.project_time_logs;
create policy ptime_read on public.project_time_logs for select to authenticated
  using (public.pc_can_read_project(project_id));

-- التكاليف/الميزانية حساسة: الإدارة/المالية فقط (فوق قيد الفريق).
drop policy if exists pcost_read on public.project_costs;
create policy pcost_read on public.project_costs for select to authenticated
  using (public.pc_can_read_project(project_id) and (public.can_manage_projects() or public.can_see_financials()));

drop policy if exists prisk_read on public.project_risks;
create policy prisk_read on public.project_risks for select to authenticated
  using (public.pc_can_read_project(project_id));

drop policy if exists pmeet_read on public.project_meetings;
create policy pmeet_read on public.project_meetings for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists ploc_read on public.project_locations;
create policy ploc_read on public.project_locations for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists pshoot_read on public.project_shoot_sessions;
create policy pshoot_read on public.project_shoot_sessions for select to authenticated
  using (public.pc_can_read_project(project_id));

-- الاعتمادات: الفريق يرى الكل؛ ومالك العميل يرى اعتمادات نوعها client فقط (ليقرّرها).
drop policy if exists pappr_read on public.project_approvals;
create policy pappr_read on public.project_approvals for select to authenticated
  using (public.pc_can_read_project(project_id) or (kind = 'client' and public.can_access_project(project_id)));

drop policy if exists ptags_read on public.project_tags;
create policy ptags_read on public.project_tags for select to authenticated using (true);

drop policy if exists ptagmap_read on public.project_tag_map;
create policy ptagmap_read on public.project_tag_map for select to authenticated using (public.pc_can_read_project(project_id));

drop policy if exists ptmpl_read on public.project_templates;
create policy ptmpl_read on public.project_templates for select to authenticated using (public.is_staff());

drop policy if exists pdv_read on public.project_deliverable_versions;
create policy pdv_read on public.project_deliverable_versions for select to authenticated
  using (exists (select 1 from public.deliverables d where d.id = deliverable_id and public.pc_can_read_project(d.project_id)));

drop policy if exists pdep_read on public.project_dependencies;
create policy pdep_read on public.project_dependencies for select to authenticated using (public.pc_can_read_project(project_id));

-- WRITE policies + grants للجداول الثانوية (مباشرة عبر RLS — الإدارة/محرر المشروع).
-- (الجداول الأساسية تبقى RPC-only: لا منح كتابة.)
grant select on public.project_core, public.project_status_history, public.project_activity,
  public.project_tasks, public.project_task_checklists, public.task_comments, public.task_followers,
  public.task_dependencies, public.task_files, public.project_time_logs, public.project_costs,
  public.project_risks, public.project_meetings, public.project_locations, public.project_shoot_sessions,
  public.project_approvals, public.project_tags, public.project_tag_map, public.project_templates,
  public.project_deliverable_versions, public.project_dependencies to authenticated;

-- منح كتابة للجداول الثانوية فقط (RLS with check تفرض الصلاحية).
grant insert, update, delete on public.project_costs, public.project_risks, public.project_meetings,
  public.project_locations, public.project_shoot_sessions, public.project_tags, public.project_tag_map,
  public.project_templates, public.project_deliverable_versions, public.project_dependencies,
  public.task_files to authenticated;

-- سياسات كتابة الجداول الثانوية.
do $mk$
declare t text; cond text;
begin
  -- جداول مرتبطة بمشروع مباشرة: الكتابة لمن يدير/يحرّر المشروع.
  for t in select unnest(array['project_risks','project_meetings','project_locations',
                               'project_shoot_sessions','project_dependencies']) loop
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (public.can_manage_projects() or public.can_edit_project(project_id))
      with check (public.can_manage_projects() or public.can_edit_project(project_id))$f$, t||'_write', t);
  end loop;
  -- التكاليف: الإدارة/المالية.
  execute 'drop policy if exists project_costs_write on public.project_costs';
  execute $f$create policy project_costs_write on public.project_costs for all to authenticated
    using (public.can_manage_projects() or public.can_see_financials())
    with check (public.can_manage_projects() or public.can_see_financials())$f$;
  -- الوسوم العامة + القوالب: الإدارة فقط.
  execute 'drop policy if exists project_tags_write on public.project_tags';
  execute $f$create policy project_tags_write on public.project_tags for all to authenticated
    using (public.can_manage_projects()) with check (public.can_manage_projects())$f$;
  execute 'drop policy if exists project_templates_write on public.project_templates';
  execute $f$create policy project_templates_write on public.project_templates for all to authenticated
    using (public.can_manage_projects()) with check (public.can_manage_projects())$f$;
  -- ربط الوسوم بالمشروع.
  execute 'drop policy if exists project_tag_map_write on public.project_tag_map';
  execute $f$create policy project_tag_map_write on public.project_tag_map for all to authenticated
    using (public.can_manage_projects() or public.can_edit_project(project_id))
    with check (public.can_manage_projects() or public.can_edit_project(project_id))$f$;
  -- إصدارات المُخرجات: محرّر/مدير المشروع (عبر deliverable → project).
  execute 'drop policy if exists project_deliverable_versions_write on public.project_deliverable_versions';
  execute $f$create policy project_deliverable_versions_write on public.project_deliverable_versions for all to authenticated
    using (exists (select 1 from public.deliverables d where d.id = deliverable_id
                   and (public.can_manage_projects() or public.can_edit_project(d.project_id))))
    with check (exists (select 1 from public.deliverables d where d.id = deliverable_id
                   and (public.can_manage_projects() or public.can_edit_project(d.project_id))))$f$;
  -- ملفات المهام: محرّر/مدير المشروع (عبر task → project).
  execute 'drop policy if exists task_files_write on public.task_files';
  execute $f$create policy task_files_write on public.task_files for all to authenticated
    using (exists (select 1 from public.project_tasks t where t.id = task_id
                   and (public.can_manage_projects() or public.can_edit_project(t.project_id))))
    with check (exists (select 1 from public.project_tasks t where t.id = task_id
                   and (public.can_manage_projects() or public.can_edit_project(t.project_id))))$f$;
end $mk$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) دوال مساعدة داخلية (النشاط + الإشعارات) — security definer.
-- ════════════════════════════════════════════════════════════════════════════

-- تسجيل نشاط مشروع.
create or replace function public.pc_log(p_project uuid, p_action text, p_etype text, p_eid uuid, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_activity(project_id, actor_id, action, entity_type, entity_id, detail)
  values (p_project, auth.uid(), p_action, p_etype, p_eid, coalesce(p_detail,'{}'::jsonb));
end $$;

-- إشعار كوادر كيان في المشروع (kian_%) عدا الفاعل. يعيد استخدام النوعَين القائمَين.
create or replace function public.pc_notify_team(p_project uuid, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text, p_exclude uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(pm.user_id, 'user', p_type, p_etype, p_eid, p_ar, p_en)
    from public.project_members pm
   where pm.project_id = p_project and pm.is_deleted = false
     and pm.role like 'kian_%'
     and (p_exclude is null or pm.user_id <> p_exclude);
end $$;

-- إشعار مستخدم واحد (تخطّي إن كان هو الفاعل أو NULL).
create or replace function public.pc_notify_user(p_user uuid, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  perform public.notify(p_user, 'user', p_type, p_etype, p_eid, p_ar, p_en);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) دورة الحياة + الملخّص
-- ════════════════════════════════════════════════════════════════════════════

-- إنشاء/جلب صفّ project_core (Idempotent). لا يُغيّر مرحلة قائمة.
create or replace function public.project_core_ensure(p_project uuid)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select * into r from public.project_core where project_id = p_project;
  if r.project_id is null then
    insert into public.project_core(project_id, updated_by) values (p_project, auth.uid())
      on conflict (project_id) do nothing;
    select * into r from public.project_core where project_id = p_project;
  end if;
  return r;
end $$;

-- تغيير مرحلة دورة الحياة (Audit + نشاط + إشعار).
create or replace function public.project_core_set_stage(p_project uuid, p_stage text, p_note text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_from text;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if p_stage not in ('lead_approved','project_created','planning','ready','scheduled','in_production',
                     'post_production','internal_review','client_review','revision','approved','delivered','closed')
    then raise exception 'bad_stage'; end if;
  -- التقط المرحلة السابقة قبل أي كتابة (NULL إن لم يوجد صفّ) — حتى يُسجَّل أول انتقال أيضًا.
  select core_stage into v_from from public.project_core where project_id = p_project;
  insert into public.project_core(project_id, core_stage, updated_by)
    values (p_project, p_stage, auth.uid())
    on conflict (project_id) do update set core_stage = p_stage, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  if v_from is distinct from p_stage then
    insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
      values (p_project, v_from, p_stage, nullif(btrim(p_note),''), auth.uid());
    perform public.pc_log(p_project, 'stage_changed', 'project', p_project,
      jsonb_build_object('from', v_from, 'to', p_stage));
    perform public.pc_notify_team(p_project, 'project_status_changed', 'project', p_project,
      'تغيّرت مرحلة المشروع إلى '||p_stage, 'Project stage changed to '||p_stage, auth.uid());
  end if;
  return r;
end $$;

-- تحديث ملخّص المشروع (أولوية/صحة/تواريخ/ميزانية/تكلفة/نوع/تقدّم).
create or replace function public.project_core_set_meta(p_project uuid, p_data jsonb)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_fin boolean;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  -- الحقول المالية تُحدَّث فقط لمن يملك صلاحية مالية (لا لمحرّر غير مالي).
  v_fin := public.can_manage_projects() or public.can_see_financials();
  insert into public.project_core(project_id, updated_by) values (p_project, auth.uid())
    on conflict (project_id) do nothing;
  update public.project_core set
    priority       = coalesce(nullif(p_data->>'priority','')::text, priority),
    health         = coalesce(nullif(p_data->>'health','')::text, health),
    start_date     = coalesce(nullif(p_data->>'start_date','')::date, start_date),
    due_date       = coalesce(nullif(p_data->>'due_date','')::date, due_date),
    delivery_date  = coalesce(nullif(p_data->>'delivery_date','')::date, delivery_date),
    budget_amount  = case when v_fin then coalesce(nullif(p_data->>'budget_amount','')::numeric, budget_amount) else budget_amount end,
    estimated_cost = case when v_fin then coalesce(nullif(p_data->>'estimated_cost','')::numeric, estimated_cost) else estimated_cost end,
    actual_cost    = case when v_fin then coalesce(nullif(p_data->>'actual_cost','')::numeric, actual_cost) else actual_cost end,
    project_type   = coalesce(nullif(p_data->>'project_type','')::text, project_type),
    progress_pct   = coalesce(nullif(p_data->>'progress_pct','')::int, progress_pct),
    currency       = coalesce(nullif(p_data->>'currency','')::text, currency),
    updated_at = now(), updated_by = auth.uid()
    where project_id = p_project returning * into r;
  -- لا نسجّل الأرقام المالية في سجل النشاط (يقرؤه كوادر غير ماليين).
  perform public.pc_log(p_project, 'meta_updated', 'project', p_project,
    (p_data - 'budget_amount' - 'estimated_cost' - 'actual_cost'));
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) المهام
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.pc_task_create(p_project uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_parent uuid; v_assignee uuid;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
  v_parent := nullif(p_data->>'parent_task_id','')::uuid;
  if v_parent is not null and not exists (select 1 from public.project_tasks where id = v_parent and project_id = p_project)
    then raise exception 'bad_parent'; end if;
  v_assignee := nullif(p_data->>'assignee_id','')::uuid;
  insert into public.project_tasks(project_id, parent_task_id, title, description, status, priority,
      assignee_id, start_date, due_date, estimated_hours, labels, sort_order, recurring, created_by)
    values (p_project, v_parent, btrim(p_data->>'title'), nullif(p_data->>'description',''),
      coalesce(nullif(p_data->>'status',''),'todo'), coalesce(nullif(p_data->>'priority',''),'normal'),
      v_assignee, nullif(p_data->>'start_date','')::date, nullif(p_data->>'due_date','')::date,
      nullif(p_data->>'estimated_hours','')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p_data->'labels')='array' then p_data->'labels' else '[]'::jsonb end) x), '{}'),
      coalesce(nullif(p_data->>'sort_order','')::int, 0), nullif(p_data->>'recurring',''), auth.uid())
    returning * into r;
  perform public.pc_log(p_project, 'task_created', 'task', r.id, jsonb_build_object('title', r.title));
  if v_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (r.id, v_assignee) on conflict do nothing;
    perform public.pc_notify_user(v_assignee, 'project_note_new', 'task', r.id,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  return r;
end $$;

create or replace function public.pc_task_update(p_task uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_proj uuid; v_old_assignee uuid; v_new_assignee uuid; v_old_status text;
begin
  select project_id, assignee_id, status into v_proj, v_old_assignee, v_old_status
    from public.project_tasks where id = p_task and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  v_new_assignee := coalesce(nullif(p_data->>'assignee_id','')::uuid, v_old_assignee);
  update public.project_tasks set
    title          = coalesce(nullif(p_data->>'title',''), title),
    description     = coalesce(nullif(p_data->>'description',''), description),
    status          = coalesce(nullif(p_data->>'status',''), status),
    priority        = coalesce(nullif(p_data->>'priority',''), priority),
    assignee_id     = v_new_assignee,
    start_date      = coalesce(nullif(p_data->>'start_date','')::date, start_date),
    due_date        = coalesce(nullif(p_data->>'due_date','')::date, due_date),
    estimated_hours = coalesce(nullif(p_data->>'estimated_hours','')::numeric, estimated_hours),
    actual_hours    = coalesce(nullif(p_data->>'actual_hours','')::numeric, actual_hours),
    progress_pct    = coalesce(nullif(p_data->>'progress_pct','')::int, progress_pct),
    labels          = case when jsonb_typeof(p_data->'labels')='array'
                        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'labels') x), labels) else labels end,
    sort_order      = coalesce(nullif(p_data->>'sort_order','')::int, sort_order),
    completed_at    = case when coalesce(nullif(p_data->>'status',''), status) = 'done' and completed_at is null then now()
                           when coalesce(nullif(p_data->>'status',''), status) <> 'done' then null else completed_at end,
    updated_at = now()
    where id = p_task returning * into r;
  perform public.pc_log(v_proj, 'task_updated', 'task', p_task, p_data - 'labels');
  if v_new_assignee is distinct from v_old_assignee and v_new_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (p_task, v_new_assignee) on conflict do nothing;
    perform public.pc_notify_user(v_new_assignee, 'project_note_new', 'task', p_task,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  if r.status is distinct from v_old_status then
    perform public.pc_notify_team(v_proj, 'project_note_new', 'task', p_task,
      'تحدّثت حالة مهمة: '||r.title, 'Task status changed: '||r.title, auth.uid());
  end if;
  return r;
end $$;

create or replace function public.pc_task_delete(p_task uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.project_tasks where id = p_task and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  -- حذف ناعم للمهمة وكل مهامها الفرعية على أي عمق (شجرة parent_task_id).
  with recursive sub(id) as (
    select id from public.project_tasks where id = p_task
    union all
    select t.id from public.project_tasks t join sub on t.parent_task_id = sub.id
  )
  update public.project_tasks set is_deleted = true, updated_at = now()
    where id in (select id from sub);
  perform public.pc_log(v_proj, 'task_deleted', 'task', p_task, '{}');
  return true;
end $$;

create or replace function public.pc_task_comment(p_task uuid, p_body text)
returns public.task_comments language plpgsql security definer set search_path = public as $$
declare r public.task_comments; v_proj uuid; v_title text; v_assignee uuid;
begin
  select project_id, title, assignee_id into v_proj, v_title, v_assignee from public.project_tasks where id = p_task and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pc_can_read_project(v_proj) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'body_required'; end if;
  insert into public.task_comments(task_id, author_id, body) values (p_task, auth.uid(), btrim(p_body)) returning * into r;
  insert into public.task_followers(task_id, user_id) values (p_task, auth.uid()) on conflict do nothing;
  perform public.pc_log(v_proj, 'task_comment', 'task', p_task, '{}');
  -- إشعار المتابعين (عدا الكاتب).
  perform public.pc_notify_user(tf.user_id, 'project_note_new', 'task', p_task,
      'تعليق جديد على مهمة: '||v_title, 'New comment on task: '||v_title)
    from public.task_followers tf where tf.task_id = p_task and tf.user_id <> auth.uid();
  return r;
end $$;

create or replace function public.pc_task_checklist_add(p_task uuid, p_label text)
returns public.project_task_checklists language plpgsql security definer set search_path = public as $$
declare r public.project_task_checklists; v_proj uuid;
begin
  select project_id into v_proj from public.project_tasks where id = p_task and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_label),'') = '' then raise exception 'label_required'; end if;
  insert into public.project_task_checklists(task_id, label, sort_order)
    values (p_task, btrim(p_label),
      coalesce((select max(sort_order)+1 from public.project_task_checklists where task_id = p_task), 0))
    returning * into r;
  return r;
end $$;

create or replace function public.pc_task_checklist_toggle(p_item uuid, p_done boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select t.project_id into v_proj from public.project_task_checklists c
    join public.project_tasks t on t.id = c.task_id where c.id = p_item;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  update public.project_task_checklists
    set is_done = p_done, done_by = case when p_done then auth.uid() else null end,
        done_at = case when p_done then now() else null end
    where id = p_item;
  return true;
end $$;

create or replace function public.pc_task_follow(p_task uuid, p_follow boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.project_tasks where id = p_task and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pc_can_read_project(v_proj) then raise exception 'not authorized'; end if;
  if p_follow then insert into public.task_followers(task_id, user_id) values (p_task, auth.uid()) on conflict do nothing;
  else delete from public.task_followers where task_id = p_task and user_id = auth.uid(); end if;
  return true;
end $$;

create or replace function public.pc_task_set_dependency(p_task uuid, p_depends_on uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_proj2 uuid;
begin
  select project_id into v_proj  from public.project_tasks where id = p_task and is_deleted = false;
  select project_id into v_proj2 from public.project_tasks where id = p_depends_on and is_deleted = false;
  if v_proj is null or v_proj2 is null then raise exception 'not_found'; end if;
  if v_proj <> v_proj2 then raise exception 'cross_project_dependency'; end if;
  if p_task = p_depends_on then raise exception 'self_dependency'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if p_on then insert into public.task_dependencies(task_id, depends_on_task_id) values (p_task, p_depends_on) on conflict do nothing;
  else delete from public.task_dependencies where task_id = p_task and depends_on_task_id = p_depends_on; end if;
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) الوقت
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_time_log(p_project uuid, p_task uuid, p_minutes int, p_for_date date default null, p_note text default null)
returns public.project_time_logs language plpgsql security definer set search_path = public as $$
declare r public.project_time_logs;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if p_minutes is null or p_minutes <= 0 or p_minutes > 1440 then raise exception 'bad_minutes'; end if;
  if p_task is not null and not exists (select 1 from public.project_tasks where id = p_task and project_id = p_project)
    then raise exception 'bad_task'; end if;
  insert into public.project_time_logs(project_id, task_id, user_id, minutes, logged_for, note)
    values (p_project, p_task, auth.uid(), p_minutes,
      coalesce(p_for_date, (now() at time zone 'utc')::date), nullif(btrim(p_note),''))
    returning * into r;
  if p_task is not null then
    update public.project_tasks set actual_hours = coalesce(actual_hours,0) + (p_minutes::numeric/60.0), updated_at = now()
      where id = p_task;
  end if;
  perform public.pc_log(p_project, 'time_logged', 'task', p_task, jsonb_build_object('minutes', p_minutes));
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) الاعتمادات (منع Double Decision)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_approval_request(p_project uuid, p_kind text, p_title text default null, p_deliverable uuid default null, p_note text default null)
returns public.project_approvals language plpgsql security definer set search_path = public as $$
declare r public.project_approvals;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if p_kind not in ('internal','manager','client') then raise exception 'bad_kind'; end if;
  if p_deliverable is not null and not exists (select 1 from public.deliverables where id = p_deliverable and project_id = p_project)
    then raise exception 'bad_deliverable'; end if;
  insert into public.project_approvals(project_id, deliverable_id, kind, title, note, requested_by)
    values (p_project, p_deliverable, p_kind, nullif(btrim(p_title),''), nullif(btrim(p_note),''), auth.uid())
    returning * into r;
  perform public.pc_log(p_project, 'approval_requested', 'approval', r.id, jsonb_build_object('kind', p_kind));
  if p_kind = 'client' then
    -- إشعار مالك العميل.
    perform public.pc_notify_user(pm.user_id, 'project_status_changed', 'approval', r.id,
        'طلب اعتماد جديد لمشروعك', 'New approval request for your project')
      from public.project_members pm where pm.project_id = p_project and pm.role = 'client_owner' and pm.is_deleted = false;
  else
    perform public.pc_notify_team(p_project, 'project_status_changed', 'approval', r.id,
      'طلب اعتماد جديد ('||p_kind||')', 'New approval request ('||p_kind||')', null);
  end if;
  return r;
end $$;

create or replace function public.pc_approval_decide(p_approval uuid, p_decision text, p_note text default null)
returns public.project_approvals language plpgsql security definer set search_path = public as $$
declare r public.project_approvals; v_proj uuid; v_kind text; v_status text; v_requester uuid;
begin
  select project_id, kind, status, requested_by into v_proj, v_kind, v_status, v_requester
    from public.project_approvals where id = p_approval for update;
  if v_proj is null then raise exception 'not_found'; end if;
  if v_status <> 'pending' then raise exception 'already_decided'; end if;   -- منع Double Decision
  if p_decision not in ('approved','rejected','revision_requested') then raise exception 'bad_decision'; end if;
  -- صلاحية القرار حسب النوع: client → مالك العميل؛ internal/manager → مدير المشاريع.
  if v_kind = 'client' then
    if not public.is_client_owner(v_proj) and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  else
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  update public.project_approvals set status = p_decision, decision_note = nullif(btrim(p_note),''),
      decided_by = auth.uid(), decided_at = now()
    where id = p_approval returning * into r;
  perform public.pc_log(v_proj, 'approval_'||p_decision, 'approval', p_approval, '{}');
  perform public.pc_notify_user(v_requester, 'project_status_changed', 'approval', p_approval,
    'تم البتّ في طلب الاعتماد: '||p_decision, 'Approval decision: '||p_decision);
  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) لوحة القيادة (Dashboard) — RPC مُجمِّعة، staff فقط.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_core_dashboard()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'active',           count(*) filter (where coalesce(pc.core_stage,'project_created') not in ('closed','delivered')),
    'overdue',          count(*) filter (where pc.due_date is not null and pc.due_date < (now() at time zone 'utc')::date
                                          and coalesce(pc.core_stage,'') not in ('closed','delivered')),
    'awaiting_client',  count(*) filter (where pc.core_stage = 'client_review'),
    'awaiting_staff',   count(*) filter (where pc.core_stage in ('internal_review','revision')),
    'near_delivery',    count(*) filter (where pc.core_stage in ('approved','post_production')),
    'closed',           count(*) filter (where pc.core_stage in ('closed','delivered')),
    'at_risk',          count(*) filter (where pc.health in ('at_risk','off_track')),
    'total_budget',     coalesce(sum(pc.budget_amount),0),
    'total_cost',       coalesce(sum(pc.actual_cost),0)
  ) into v
  from public.projects p
  left join public.project_core pc on pc.project_id = p.id
  where p.is_deleted = false;

  return v || jsonb_build_object(
    'open_tasks',  (select count(*) from public.project_tasks where is_deleted = false and status not in ('done','cancelled')),
    'my_tasks',    (select count(*) from public.project_tasks where is_deleted = false and assignee_id = auth.uid() and status not in ('done','cancelled')),
    'overdue_tasks', (select count(*) from public.project_tasks where is_deleted = false and due_date is not null
                        and due_date < (now() at time zone 'utc')::date and status not in ('done','cancelled')),
    'pending_approvals', (select count(*) from public.project_approvals where status = 'pending'),
    'hours_logged_30d', coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs
                          where created_at >= now() - interval '30 days'),0)
  );
end $$;

-- تقويم المشروع (مهام/اجتماعات/جلسات تصوير ضمن نطاق) — RPC للقراءة.
create or replace function public.project_core_calendar(p_from date, p_to date, p_project uuid default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'date',due_date,'status',status,'priority',priority))
              from public.project_tasks where is_deleted=false and due_date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'at',scheduled_at))
              from public.project_meetings where is_deleted=false and (scheduled_at at time zone 'utc')::date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb),
    'shoots', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'date',session_date,'call_time',call_time,'status',status))
              from public.project_shoot_sessions where is_deleted=false and session_date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) المشغّلات (updated_at) — عبر دالة مشتركة إن لم توجد.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_pc_touch on public.project_core;
create trigger trg_pc_touch before update on public.project_core for each row execute function public.pc_touch_updated_at();
drop trigger if exists trg_ptasks_touch on public.project_tasks;
create trigger trg_ptasks_touch before update on public.project_tasks for each row execute function public.pc_touch_updated_at();
drop trigger if exists trg_prisk_touch on public.project_risks;
create trigger trg_prisk_touch before update on public.project_risks for each row execute function public.pc_touch_updated_at();
drop trigger if exists trg_pshoot_touch on public.project_shoot_sessions;
create trigger trg_pshoot_touch before update on public.project_shoot_sessions for each row execute function public.pc_touch_updated_at();
drop trigger if exists trg_ptmpl_touch on public.project_templates;
create trigger trg_ptmpl_touch before update on public.project_templates for each row execute function public.pc_touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 11) الصلاحيات على الدوال — لا public/anon، فقط authenticated.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'project_core_ensure(uuid)','project_core_set_stage(uuid,text,text)','project_core_set_meta(uuid,jsonb)',
    'pc_task_create(uuid,jsonb)','pc_task_update(uuid,jsonb)','pc_task_delete(uuid)','pc_task_comment(uuid,text)',
    'pc_task_checklist_add(uuid,text)','pc_task_checklist_toggle(uuid,boolean)','pc_task_follow(uuid,boolean)',
    'pc_task_set_dependency(uuid,uuid,boolean)','pc_time_log(uuid,uuid,integer,date,text)',
    'pc_approval_request(uuid,text,text,uuid,text)','pc_approval_decide(uuid,text,text)',
    'project_core_dashboard()','project_core_calendar(date,date,uuid)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $g$;
-- الدوال المساعدة الداخلية: بلا منح تنفيذ للعميل (تُستدعى من الدوال الأخرى فقط).
revoke all on function public.pc_log(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.pc_notify_team(uuid,text,text,uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.pc_notify_user(uuid,text,text,uuid,text,text) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (للقراءة فقط — شغّلها بعد التطبيق)
-- ════════════════════════════════════════════════════════════════════════════
-- (أ) الجداول أُنشئت (المتوقع 21 صفًّا):
select count(*) as project_core_tables from information_schema.tables
 where table_schema='public' and table_name in (
  'project_core','project_status_history','project_activity','project_tasks','project_task_checklists',
  'task_comments','task_followers','task_dependencies','task_files','project_time_logs','project_costs',
  'project_risks','project_meetings','project_locations','project_shoot_sessions','project_approvals',
  'project_tags','project_tag_map','project_templates','project_deliverable_versions','project_dependencies');

-- (ب) الدوال أُنشئت + صلاحية authenticated + منع anon:
select proname, has_function_privilege('authenticated', oid, 'execute') auth_exec,
       has_function_privilege('anon', oid, 'execute') anon_exec
  from pg_proc where proname in (
    'project_core_set_stage','project_core_set_meta','pc_task_create','pc_task_update','pc_task_delete',
    'pc_task_comment','pc_approval_request','pc_approval_decide','pc_time_log','project_core_dashboard','project_core_calendar')
  order by proname;

-- (ج) RLS مُمكّن على كل جداول project_core (المتوقع كلها true):
select relname, relrowsecurity from pg_class
 where relname in ('project_core','project_tasks','task_comments','project_costs','project_approvals','project_activity')
 order by relname;
