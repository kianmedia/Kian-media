-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 8A — إدارة البرامج والإنتاج المستمرّ (Program & Continuous Production)
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط):
--   • لا يوجد أيّ نظام برامج/حملات/حلقات/عقود مستمرّة (بحث شامل: صفر جداول وصفر دوال).
--   • الهرمية (6A/6B) جاهزة ومستواها ثابت master→subproject، وتحمل على public.projects:
--     parent_project_id / project_scope / sequence_number / project_code / display_label /
--     subproject_label_singular+plural / rollup_weight / client_visibility.
--     **ملاحظة**: project_code وdisplay_label وsubproject_label_* أعمدة من Batch 1 بلا أيّ
--     مستهلك في الشيفرة (بحث في lib/ وcomponents/ = صفر) ⇒ لا نبني عليها ولا نكسرها.
--   • sequence_number = الترتيب داخل الأب، ويحرسه ux_projects_parent_seq (فهرس جزئي).
--   • project_hierarchy_rollup / _parent_dashboard (6A/6B) تُعطي التجميع المشتقّ.
--
-- قرار التصميم: بيانات «الوحدة» تُخزَّن كأعمدة على public.projects تمامًا كما فعلت
-- الهرمية، لا في جدول ربط منفصل. السبب: تفرّد unit_number يجب أن يكون داخل الأب،
-- و(parent_project_id, unit_number) على نفس الجدول يعطي فهرسًا فريدًا جزئيًّا لا
-- يمكن أن ينحرف عند نقل الفرع — بينما جدول منفصل يحتاج parent_project_id مُنسَخًا
-- وتزامنًا هشًّا. هذا نفس نمط ux_projects_parent_seq القائم.
--
-- قيود ملتزَم بها: إضافات فقط · لا مستوى هرمي ثالث · لا core_stage جديد · لا كتابة
-- على progress · لا نظام مهام/اعتماد/إغلاق موازٍ · لا إعادة تعريف بوّابات الوصول ·
-- لا مالية · لا Zoho · لا عهدة · لا جداول مؤقتة في دوال القراءة.
--
-- ترتيب التشغيل: … → 6A → 6B → 6C → 7A → 7B → 8A.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '8A PREFLIGHT: pc_can_read_project مفقودة (Project Core غير مطبّق)'; end if;
  if to_regprocedure('public.pc_is_master(uuid)') is null
    then raise exception '8A PREFLIGHT: هرمية 6A غير مطبّقة (pc_is_master مفقودة)'; end if;
  if to_regprocedure('public.project_hierarchy_rollup(uuid)') is null
    then raise exception '8A PREFLIGHT: project_hierarchy_rollup مفقودة (شغّل 6A)'; end if;
  if to_regprocedure('public.hier_can(uuid,text)') is null
    then raise exception '8A PREFLIGHT: بوابة الهرمية hier_can مفقودة'; end if;
  if to_regclass('public.projects') is null or to_regclass('public.project_core') is null
    then raise exception '8A PREFLIGHT: جداول المشاريع مفقودة'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الصلاحيات (تُضاف إلى الكتالوج القائم — الفئة projects_tasks الموجودة فعلًا)
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice '8A: كتالوج الصلاحيات غير موجود — صلاحيات البرامج تُتخطّى'; return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
    ('programs.view',              'projects_tasks','normal', 950,'عرض البرنامج','View program'),
    ('programs.manage_settings',   'projects_tasks','normal', 952,'إدارة إعدادات البرنامج','Manage program settings'),
    ('programs.manage_units',      'projects_tasks','normal', 954,'إدارة وحدات البرنامج','Manage program units'),
    ('programs.export',            'projects_tasks','normal', 956,'تصدير تقارير البرنامج','Export program reports')
  on conflict (key) do nothing;
end $perm$;

-- بوابة البرامج: تُركّب hier_can القائمة (لا بوابة وصول جديدة).
create or replace function public.program_can(p_project uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if not public.pc_can_read_project(p_project) then return false; end if;
  if p_key = 'programs.view' then return true; end if;          -- القراءة تكفيها رؤية المشروع
  if coalesce(public.can_manage_projects(), false) then return true; end if;
  begin v := public.emp_has_permission(p_key); exception when undefined_function or undefined_table then v := null; end;
  if coalesce(v, false) then return true; end if;
  -- من يملك تحرير المشروع الرئيسي يدير برنامجه (نفس منطق hier_can القائم).
  begin return coalesce(public.can_edit_project(p_project), false); exception when undefined_function then return false; end;
end $$;
revoke execute on function public.program_can(uuid,text) from public, anon;
grant execute on function public.program_can(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) بيانات الوحدة على الفرع — أعمدة على projects (نفس نمط الهرمية)
--     unit_number = الهوية التشغيلية (فريدة داخل الأب)؛ sequence_number يبقى للترتيب.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.projects add column if not exists unit_type            text;
alter table public.projects add column if not exists unit_number          int;
alter table public.projects add column if not exists unit_code            text;
alter table public.projects add column if not exists season_number        int;
alter table public.projects add column if not exists batch_number         int;
alter table public.projects add column if not exists workstream           text;
alter table public.projects add column if not exists planned_release_date date;
alter table public.projects add column if not exists actual_release_date  date;
alter table public.projects add column if not exists external_reference   text;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_unit_type_chk') then
    alter table public.projects add constraint projects_unit_type_chk check (
      unit_type is null or unit_type in ('phase','episode','location','month','event','campaign_item','batch','custom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_unit_number_chk') then
    alter table public.projects add constraint projects_unit_number_chk check (unit_number is null or unit_number >= 0);
  end if;
end $chk$;

-- تفرّد رقم الوحدة داخل الأب (فهرس جزئي — لا يمسّ المستقلّة ولا الفروع بلا رقم).
create unique index if not exists ux_projects_parent_unit_number
  on public.projects(parent_project_id, unit_number)
  where parent_project_id is not null and unit_number is not null and coalesce(is_deleted,false) = false;
create index if not exists idx_projects_unit_lookup
  on public.projects(parent_project_id, unit_type, season_number, batch_number)
  where parent_project_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) ملف تشغيل البرنامج — للمشروع الرئيسي فقط
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_program_settings (
  project_id                uuid primary key references public.projects(id) on delete cascade,
  operating_model           text not null default 'phased_program' check (operating_model in
                            ('phased_program','episode_series','monthly_retainer','campaign','multi_location','event_series','custom')),
  unit_label_ar             text,
  unit_label_en             text,
  numbering_prefix          text,
  numbering_start           int  not null default 1 check (numbering_start >= 0),
  target_units              int  check (target_units is null or target_units >= 0),
  planned_start_date        date,
  planned_end_date          date,
  cadence_type              text not null default 'none' check (cadence_type in ('none','daily','weekly','biweekly','monthly','custom')),
  cadence_interval          int  not null default 1 check (cadence_interval >= 1),
  default_child_template_id uuid,
  default_child_duration_days int check (default_child_duration_days is null or default_child_duration_days >= 0),
  default_manager_inheritance    boolean not null default true,
  default_team_inheritance       boolean not null default false,
  default_governance_inheritance boolean not null default false,
  default_closure_inheritance    boolean not null default false,
  require_all_units_closed_before_program_close boolean not null default true,
  client_program_view_enabled    boolean not null default false,
  version                   int not null default 1,
  created_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint program_dates_chk check (planned_end_date is null or planned_start_date is null or planned_end_date >= planned_start_date)
);
create index if not exists idx_pps_model on public.project_program_settings(operating_model);

alter table public.project_program_settings enable row level security;
-- القراءة: من يقرأ المشروع. الكتابة عبر RPC فقط (لا سياسة كتابة).
drop policy if exists pps_read on public.project_program_settings;
create policy pps_read on public.project_program_settings for select to authenticated
  using (public.pc_can_read_project(project_id));
revoke all on public.project_program_settings from anon;
grant select on public.project_program_settings to authenticated;

-- حارس: البرنامج للمشروع الرئيسي فقط، ولا يُترك ملف برنامج على فرع/مستقل.
create or replace function public.program_settings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_scope text;
begin
  select project_scope into v_scope from public.projects where id = new.project_id;
  if v_scope is null then raise exception 'project_not_found'; end if;
  if v_scope <> 'master' then raise exception 'program_requires_master'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.program_settings_guard() from public, anon, authenticated;
drop trigger if exists trg_program_settings_guard on public.project_program_settings;
create trigger trg_program_settings_guard before insert or update on public.project_program_settings
  for each row execute function public.program_settings_guard();

-- تنظيف تلقائيّ عند تغيّر نطاق المشروع: خفض مشروع رئيسي إلى مستقل (6A demote) كان
-- يترك صفّ برنامج يتيمًا — غير قابل للوصول عبر أيّ RPC (كلّها تشترط master)، ويُبعث
-- صامتًا عند إعادة الترقية، ويُفشل الاختبار الذاتي لهذا الملف في كل إعادة تشغيل.
-- كذلك فصل فرع إلى مستقل (detach) يترك بيانات وحدة لا معنى لها خارج برنامج.
create or replace function public.program_scope_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_scope is distinct from old.project_scope then
    if new.project_scope <> 'master' then
      delete from public.project_program_settings where project_id = new.id;
    end if;
    if new.project_scope <> 'subproject' then
      new.unit_type := null; new.unit_number := null; new.unit_code := null;
      new.season_number := null; new.batch_number := null; new.workstream := null;
      new.planned_release_date := null; new.actual_release_date := null; new.external_reference := null;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.program_scope_cleanup() from public, anon, authenticated;
drop trigger if exists trg_program_scope_cleanup on public.projects;
create trigger trg_program_scope_cleanup before update of project_scope on public.projects
  for each row execute function public.program_scope_cleanup();

-- ════════════════════════════════════════════════════════════════════════════
-- §4) كتابة الإعدادات (RPC ذرّي، تحقّق صلاحية + قفل متفائل)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_settings_upsert(p_project uuid, p_data jsonb, p_expected_version int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.project_program_settings; v_cur int;
begin
  if not public.program_can(p_project, 'programs.manage_settings') then raise exception 'not authorized'; end if;
  if not coalesce(public.pc_is_master(p_project), false) then raise exception 'program_requires_master'; end if;

  select version into v_cur from public.project_program_settings where project_id = p_project for update;
  if v_cur is not null and p_expected_version is not null and v_cur <> p_expected_version
    then raise exception 'stale_update'; end if;

  insert into public.project_program_settings as s (project_id, operating_model, unit_label_ar, unit_label_en,
      numbering_prefix, numbering_start, target_units, planned_start_date, planned_end_date,
      cadence_type, cadence_interval, default_child_template_id, default_child_duration_days,
      default_manager_inheritance, default_team_inheritance, default_governance_inheritance, default_closure_inheritance,
      require_all_units_closed_before_program_close, client_program_view_enabled, created_by)
    values (p_project,
      coalesce(nullif(p_data->>'operating_model',''),'phased_program'),
      nullif(btrim(p_data->>'unit_label_ar'),''), nullif(btrim(p_data->>'unit_label_en'),''),
      nullif(btrim(p_data->>'numbering_prefix'),''),
      coalesce(nullif(p_data->>'numbering_start','')::int, 1),
      nullif(p_data->>'target_units','')::int,
      nullif(p_data->>'planned_start_date','')::date, nullif(p_data->>'planned_end_date','')::date,
      coalesce(nullif(p_data->>'cadence_type',''),'none'),
      coalesce(nullif(p_data->>'cadence_interval','')::int, 1),
      nullif(p_data->>'default_child_template_id','')::uuid,
      nullif(p_data->>'default_child_duration_days','')::int,
      coalesce((p_data->>'default_manager_inheritance')::boolean, true),
      coalesce((p_data->>'default_team_inheritance')::boolean, false),
      coalesce((p_data->>'default_governance_inheritance')::boolean, false),
      coalesce((p_data->>'default_closure_inheritance')::boolean, false),
      coalesce((p_data->>'require_all_units_closed_before_program_close')::boolean, true),
      coalesce((p_data->>'client_program_view_enabled')::boolean, false),
      auth.uid())
  on conflict (project_id) do update set
      -- تحديث جزئي أمين: المفتاح الغائب لا يُصفّر القيمة القائمة.
      operating_model  = coalesce(nullif(p_data->>'operating_model',''), s.operating_model),
      unit_label_ar    = case when p_data ? 'unit_label_ar' then nullif(btrim(p_data->>'unit_label_ar'),'') else s.unit_label_ar end,
      unit_label_en    = case when p_data ? 'unit_label_en' then nullif(btrim(p_data->>'unit_label_en'),'') else s.unit_label_en end,
      numbering_prefix = case when p_data ? 'numbering_prefix' then nullif(btrim(p_data->>'numbering_prefix'),'') else s.numbering_prefix end,
      numbering_start  = coalesce(nullif(p_data->>'numbering_start','')::int, s.numbering_start),
      target_units     = case when p_data ? 'target_units' then nullif(p_data->>'target_units','')::int else s.target_units end,
      planned_start_date = case when p_data ? 'planned_start_date' then nullif(p_data->>'planned_start_date','')::date else s.planned_start_date end,
      planned_end_date   = case when p_data ? 'planned_end_date' then nullif(p_data->>'planned_end_date','')::date else s.planned_end_date end,
      cadence_type     = coalesce(nullif(p_data->>'cadence_type',''), s.cadence_type),
      cadence_interval = coalesce(nullif(p_data->>'cadence_interval','')::int, s.cadence_interval),
      default_child_template_id   = case when p_data ? 'default_child_template_id' then nullif(p_data->>'default_child_template_id','')::uuid else s.default_child_template_id end,
      default_child_duration_days = case when p_data ? 'default_child_duration_days' then nullif(p_data->>'default_child_duration_days','')::int else s.default_child_duration_days end,
      default_manager_inheritance    = coalesce((p_data->>'default_manager_inheritance')::boolean, s.default_manager_inheritance),
      default_team_inheritance       = coalesce((p_data->>'default_team_inheritance')::boolean, s.default_team_inheritance),
      default_governance_inheritance = coalesce((p_data->>'default_governance_inheritance')::boolean, s.default_governance_inheritance),
      default_closure_inheritance    = coalesce((p_data->>'default_closure_inheritance')::boolean, s.default_closure_inheritance),
      require_all_units_closed_before_program_close = coalesce((p_data->>'require_all_units_closed_before_program_close')::boolean, s.require_all_units_closed_before_program_close),
      client_program_view_enabled    = coalesce((p_data->>'client_program_view_enabled')::boolean, s.client_program_view_enabled),
      version = s.version + 1, updated_at = now()
  returning * into r;

  perform public.pc_log(p_project, 'program_settings_saved', 'project', p_project,
    jsonb_build_object('operating_model', r.operating_model, 'target_units', r.target_units, 'version', r.version));
  return to_jsonb(r);
end $$;
revoke execute on function public.project_program_settings_upsert(uuid,jsonb,int) from public, anon;
grant execute on function public.project_program_settings_upsert(uuid,jsonb,int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) بيانات الوحدة على فرع واحد (تُستعمل أيضًا في تبنّي الفروع القائمة — 8B)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_unit_metadata_upsert(p_project uuid, p_data jsonb, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_parent uuid; v_scope text; v_old_num int; v_new_num int;
begin
  -- عزل الابن أوّلًا: البرنامج لا يمنح وصولًا لفرع خارج نطاق قراءة المستخدم.
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- ترتيب القفل child ثمّ parent — نفس ترتيب project_hierarchy_move_subproject (6A)
  -- تفاديًا لانعكاس ترتيب الأقفال والجمود (deadlock) بين الدالّتين.
  select parent_project_id, project_scope, unit_number into v_parent, v_scope, v_old_num
    from public.projects where id = p_project for update;
  if v_scope is null then raise exception 'not_found'; end if;
  if v_scope <> 'subproject' or v_parent is null then raise exception 'unit_requires_subproject'; end if;
  if not public.program_can(v_parent, 'programs.manage_units') then raise exception 'not authorized'; end if;
  perform 1 from public.projects where id = v_parent for update;
  -- تحقّق صريح من النوع: CHECK يرفع check_violation لا unique_violation فتضيع الرسالة.
  if p_data ? 'unit_type' and nullif(btrim(p_data->>'unit_type'),'') is not null
     and (p_data->>'unit_type') not in ('phase','episode','location','month','event','campaign_item','batch','custom')
    then raise exception 'bad_unit_type'; end if;

  v_new_num := case when p_data ? 'unit_number' then nullif(p_data->>'unit_number','')::int else v_old_num end;
  -- إعادة الترقيم تتطلّب سببًا صريحًا (تغيير هوية تشغيلية).
  if v_old_num is not null and v_new_num is distinct from v_old_num and coalesce(btrim(p_reason),'') = ''
    then raise exception 'reason_required'; end if;

  update public.projects set
    unit_type            = case when p_data ? 'unit_type' then nullif(btrim(p_data->>'unit_type'),'') else unit_type end,
    unit_number          = v_new_num,
    unit_code            = case when p_data ? 'unit_code' then nullif(btrim(p_data->>'unit_code'),'') else unit_code end,
    season_number        = case when p_data ? 'season_number' then nullif(p_data->>'season_number','')::int else season_number end,
    batch_number         = case when p_data ? 'batch_number' then nullif(p_data->>'batch_number','')::int else batch_number end,
    workstream           = case when p_data ? 'workstream' then nullif(btrim(p_data->>'workstream'),'') else workstream end,
    planned_release_date = case when p_data ? 'planned_release_date' then nullif(p_data->>'planned_release_date','')::date else planned_release_date end,
    actual_release_date  = case when p_data ? 'actual_release_date' then nullif(p_data->>'actual_release_date','')::date else actual_release_date end,
    external_reference   = case when p_data ? 'external_reference' then nullif(btrim(p_data->>'external_reference'),'') else external_reference end
  where id = p_project;

  perform public.pc_log(p_project, 'unit_metadata_saved', 'project', p_project,
    jsonb_build_object('unit_number', v_new_num, 'previous_unit_number', v_old_num, 'reason', nullif(btrim(p_reason),'')));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'unit_number', v_new_num);
exception when unique_violation then
  raise exception 'duplicate_unit_number';
end $$;
revoke execute on function public.project_unit_metadata_upsert(uuid,jsonb,text) from public, anon;
grant execute on function public.project_unit_metadata_upsert(uuid,jsonb,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) لوحة البرنامج — مشتقّة بالكامل (لا تُخزَّن ولا تُكتب على تقدّم الأب)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_set public.project_program_settings; v_roll jsonb; v_own_health text;
  v_total int := 0; v_active int := 0; v_delayed int := 0; v_critical int := 0;
  v_delivered int := 0; v_closed int := 0; v_awaiting_client int := 0;
  v_earliest date; v_latest date; v_risks int := 0; v_issues int := 0; v_appr int := 0; v_changes int := 0;
  v_v7 int := 0; v_v30 int := 0; v_v90 int := 0; v_dated int := 0; v_agg_health text;
  v_milestones jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb; v_forecast jsonb;
  v_unplanned int; v_op_pct numeric;
begin
  if not public.program_can(p_project, 'programs.view') then raise exception 'not authorized'; end if;
  if not coalesce(public.pc_is_master(p_project), false) then raise exception 'program_requires_master'; end if;

  select * into v_set from public.project_program_settings where project_id = p_project;
  v_roll := public.project_hierarchy_rollup(p_project);          -- التقدّم المشتقّ (3C) — لا حساب موازٍ
  select health into v_own_health from public.project_core where project_id = p_project;

  -- عدّادات الوحدات + الصحّة المجمّعة + السرعة في **مسحة واحدة** على الفروع المباشرة.
  -- كل فرع مرئيّ يُحسب مرّة واحدة (لا Double Counting، ولا مستوى ثالث).
  -- تنبيه: project_hierarchy_rollup لا تُعيد children_aggregate_health (تلك في
  -- parent_dashboard/6B)، فنشتقّها هنا «أسوأ صحّة» بدل قراءة مفتاح غير موجود (=null دائمًا).
  -- والسرعة: delivery_date تاريخ **مُدخَل يدويًّا** ولا يُختم عند التسليم، فنشترط
  -- أن تكون الوحدة فعلًا delivered/closed وأن يكون التاريخ ماضيًا (لا مستقبل يضخّم الرقم).
  select count(*),
         count(*) filter (where pc.core_stage not in ('delivered','closed')),
         count(*) filter (where pc.due_date is not null and pc.due_date < v_today and pc.core_stage not in ('delivered','closed')),
         count(*) filter (where pc.health = 'off_track'),
         count(*) filter (where pc.core_stage = 'delivered'),
         count(*) filter (where pc.core_stage = 'closed'),
         count(*) filter (where pc.core_stage = 'client_review'),
         min(pc.due_date) filter (where pc.core_stage not in ('delivered','closed')),
         max(pc.due_date),
         case when count(*) filter (where pc.health='off_track') > 0 then 'off_track'
              when count(*) filter (where pc.health='at_risk')  > 0 then 'at_risk'
              when count(*) > 0 then 'on_track' else null end,
         count(*) filter (where pc.core_stage in ('delivered','closed')
                            and pc.delivery_date is not null and pc.delivery_date <= v_today and pc.delivery_date >= v_today - 7),
         count(*) filter (where pc.core_stage in ('delivered','closed')
                            and pc.delivery_date is not null and pc.delivery_date <= v_today and pc.delivery_date >= v_today - 30),
         count(*) filter (where pc.core_stage in ('delivered','closed')
                            and pc.delivery_date is not null and pc.delivery_date <= v_today and pc.delivery_date >= v_today - 90),
         count(*) filter (where pc.core_stage in ('delivered','closed') and pc.delivery_date is not null)
    into v_total, v_active, v_delayed, v_critical, v_delivered, v_closed, v_awaiting_client,
         v_earliest, v_latest, v_agg_health, v_v7, v_v30, v_v90, v_dated
  from public.projects c join public.project_core pc on pc.project_id = c.id
  where c.parent_project_id = p_project and coalesce(c.is_deleted,false) = false
    and public.pc_can_read_project(c.id);

  -- الحوكمة عبر الوحدات (5A) — معزولة إن لم تُطبَّق.
  begin
    select count(*) into v_risks from public.project_risks r
      join public.projects c on c.id = r.project_id
     where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
       and coalesce(r.is_deleted,false)=false and r.severity='critical' and r.status not in ('closed','accepted');
  exception when undefined_table or undefined_column then v_risks := null; end;
  begin
    select count(*) into v_issues from public.project_issues i
      join public.projects c on c.id = i.project_id
     where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
       and coalesce(i.is_deleted,false)=false and i.severity='critical' and i.status not in ('resolved','closed','rejected');
  exception when undefined_table or undefined_column then v_issues := null; end;
  begin
    select count(*) into v_changes from public.project_change_requests ch
      join public.projects c on c.id = ch.project_id
     where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
       and coalesce(ch.is_deleted,false)=false and ch.status in ('submitted','impact_analysis','pending_approval');
  exception when undefined_table or undefined_column then v_changes := null; end;
  begin
    select count(*) into v_appr from public.project_approvals a
      join public.projects c on c.id = a.project_id
     where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
       and coalesce(a.is_deleted,false)=false and a.status='pending' and a.due_at is not null and a.due_at < now();
  exception when undefined_table or undefined_column then v_appr := null; end;

  -- تعارضات الموارد: مُتعمَّد عدم عرضها هنا. resource_conflict_center لا تقبل تصفية
  -- بالمشروع، فرقمها على مستوى المنظّمة كلّها ونسبته إلى البرنامج تضليل. مركز
  -- العمليات (7B) ومركز التعارضات (4D) يعرضانه في نطاقه الصحيح.

  -- محطات البرنامج: Milestones على المشروع الرئيسي نفسه (لا فرع لكل محطة).
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', si.id, 'title', si.title,
        'at', si.start_at, 'status', si.status,
        'overdue', ((si.start_at at time zone 'Asia/Riyadh')::date < v_today and si.status not in ('done','cancelled')))
        order by si.start_at), '[]'::jsonb)
      into v_milestones
    from public.project_schedule_items si
    where si.project_id = p_project and coalesce(si.is_deleted,false)=false
      and coalesce(si.is_milestone,false)=true and si.status <> 'cancelled';
  exception when undefined_table or undefined_column then v_milestones := '[]'::jsonb; end;

  -- الوحدات غير المخطَّطة = المستهدف ناقص المنشأ (null إن لم يُحدَّد هدف — لا صفر مضلِّل).
  -- «المتبقّي إنشاؤه» لا «غير مخططة»: الفرق بين المستهدف والمنشأ. التجاوز يظهر كتحذير منفصل.
  v_unplanned := case when v_set.target_units is null then null else greatest(v_set.target_units - v_total, 0) end;
  -- الإنجاز التشغيلي بالعدد: المقام صفر ⇒ null.
  -- المقام = المستهدف إن حُدِّد (وإلّا المنشأ): بدونه يبلغ برنامج أنشأ وحدة واحدة وسلّمها 100%.
  v_op_pct := case when coalesce(v_set.target_units, v_total) > 0
                   then round((v_delivered + v_closed)::numeric / coalesce(v_set.target_units, v_total) * 100, 1)
                   else null end;

  -- توقّع إنهاء البرنامج من سرعة ٣٠ يومًا (مشتقّ ومعلن، لا Black Box).
  v_forecast := case
    when v_set.target_units is null or v_v30 = 0 or v_set.target_units <= (v_delivered + v_closed)
      then jsonb_build_object('available', false, 'reason',
             case when v_set.target_units is null then 'no_target' when v_v30 = 0 then 'no_velocity' else 'target_met' end)
    else jsonb_build_object('available', true,
           'remaining_units', v_set.target_units - (v_delivered + v_closed),
           'units_per_30d', v_v30,
           -- least(...,3650): يمنع integer out of range عند هدف ضخم وسرعة ضئيلة (كان يُسقط اللوحة كلّها)
           'projected_finish', v_today + least(
              ceil((v_set.target_units - (v_delivered + v_closed))::numeric / v_v30 * 30), 3650)::int,
           'basis', 'delivered_or_closed_units_with_delivery_date_last_30d')
  end;

  -- تحذيرات جودة البيانات (مشتقّة)
  select coalesce(jsonb_agg(w), '[]'::jsonb) into v_warnings from (
    select jsonb_build_object('code','units_without_number','ar','وحدات بلا رقم تشغيلي','count',count(*)) w
      from public.projects c where c.parent_project_id=p_project and coalesce(c.is_deleted,false)=false
        and public.pc_can_read_project(c.id) and c.unit_number is null
     having count(*) > 0
    union all
    select jsonb_build_object('code','units_without_due','ar','وحدات بلا موعد تسليم','count',count(*))
      from public.projects c join public.project_core pc on pc.project_id=c.id
     where c.parent_project_id=p_project and coalesce(c.is_deleted,false)=false
       and public.pc_can_read_project(c.id) and pc.due_date is null and pc.core_stage not in ('delivered','closed')
     having count(*) > 0
    union all
    select jsonb_build_object('code','target_exceeded','ar','الوحدات المنشأة تتجاوز المستهدف','count', v_total - v_set.target_units)
     where v_set.target_units is not null and v_total > v_set.target_units
  ) z;

  return jsonb_build_object(
    'project_id', p_project,
    'settings', case when v_set.project_id is null then null else to_jsonb(v_set) end,
    'units', jsonb_build_object(
      'target', v_set.target_units, 'created', v_total, 'unplanned', v_unplanned,
      'active', v_active, 'delayed', v_delayed, 'critical', v_critical,
      'awaiting_client', v_awaiting_client, 'delivered', v_delivered, 'closed', v_closed),
    -- صحّة الأب وصحّة الفروع منفصلتان صراحةً (لا رقم واحد يخلطهما)
    'own_health', v_own_health,
    'children_aggregate_health', to_jsonb(v_agg_health),
    'progress', jsonb_build_object(
      'own', v_roll->'own_progress',
      'children_aggregate', v_roll->'children_aggregate_progress',
      'operational_by_count_pct', v_op_pct),
    'dates', jsonb_build_object('earliest_due', v_earliest, 'latest_due', v_latest,
      'planned_start', v_set.planned_start_date, 'planned_end', v_set.planned_end_date),
    'velocity', jsonb_build_object('delivered_7d', v_v7, 'delivered_30d', v_v30, 'delivered_90d', v_v90,
      -- available=false يعني «لا وحدة مُسلَّمة/مغلقة تحمل تاريخ تسليم» لا «السرعة صفر».
      'available', (v_dated > 0), 'dated_units', v_dated,
      'basis', 'project_core.delivery_date (مُدخَل يدويًّا) للوحدات delivered/closed وبتاريخ ماضٍ'),
    'forecast', v_forecast,
    'governance', jsonb_build_object(
      'critical_risks', case when v_risks is null then to_jsonb('unavailable'::text) else to_jsonb(v_risks) end,
      'critical_issues', case when v_issues is null then to_jsonb('unavailable'::text) else to_jsonb(v_issues) end,
      'overdue_approvals', case when v_appr is null then to_jsonb('unavailable'::text) else to_jsonb(v_appr) end,
      'change_requests_pending', case when v_changes is null then to_jsonb('unavailable'::text) else to_jsonb(v_changes) end),
    'milestones', v_milestones,
    'warnings', v_warnings,
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_program_dashboard(uuid) from public, anon;
grant execute on function public.project_program_dashboard(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) سجلّ الوحدات — فلترة Server-side + Pagination + عزل per-row
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_units(p_project uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,50),1),200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_stage text := nullif(p_filters->>'core_stage','');
  v_utype text := nullif(p_filters->>'unit_type','');
  v_season int := nullif(p_filters->>'season_number','')::int;
  v_batch int := nullif(p_filters->>'batch_number','')::int;
  v_mgr uuid := nullif(p_filters->>'manager_id','')::uuid;
  v_health text := nullif(p_filters->>'health','');
  v_overdue boolean := coalesce((p_filters->>'overdue_only')::boolean,false);
  v_critical boolean := coalesce((p_filters->>'critical_only')::boolean,false);
  v_await boolean := coalesce((p_filters->>'awaiting_client')::boolean,false);
  v_notstarted boolean := coalesce((p_filters->>'not_started')::boolean,false);
  v_closed boolean := coalesce((p_filters->>'closed_only')::boolean,false);
  v_search text := nullif(btrim(p_filters->>'search'),'');
  v_rows jsonb; v_total int := 0;
begin
  if not public.program_can(p_project, 'programs.view') then raise exception 'not authorized'; end if;

  with base as (
    select c.id, c.project_name, c.unit_number, c.unit_code, c.unit_type, c.season_number, c.batch_number,
           c.workstream, c.planned_release_date, c.actual_release_date, c.sequence_number,
           pc.core_stage, pc.health, pc.start_date, pc.due_date
      from public.projects c join public.project_core pc on pc.project_id = c.id
     where c.parent_project_id = p_project and coalesce(c.is_deleted,false) = false
       and public.pc_can_read_project(c.id)                                     -- العزل الحاسم لكل صف
       and (v_stage is null or pc.core_stage = v_stage)
       and (v_utype is null or c.unit_type = v_utype)
       and (v_season is null or c.season_number = v_season)
       and (v_batch is null or c.batch_number = v_batch)
       and (v_health is null or pc.health = v_health)
       and (not v_overdue or (pc.due_date is not null and pc.due_date < v_today and pc.core_stage not in ('delivered','closed')))
       and (not v_critical or pc.health = 'off_track')
       and (not v_await or pc.core_stage = 'client_review')
       and (not v_notstarted or pc.core_stage in ('lead_approved','project_created','planning'))
       and (not v_closed or pc.core_stage = 'closed')
       and (v_mgr is null or exists (select 1 from public.project_members m
              where m.project_id = c.id and m.user_id = v_mgr and m.role = 'kian_manager' and coalesce(m.is_deleted,false)=false))
       and (v_search is null or c.project_name ilike '%'||v_search||'%'
            or coalesce(c.unit_code,'') ilike '%'||v_search||'%'
            -- length<=9: رقم طويل جدًّا كان يرفع integer out of range بدل «لا نتائج»
            or (v_search ~ '^[0-9]{1,9}$' and c.unit_number = v_search::int))
  ), counted as (select count(*)::int c from base),
  paged as (
    -- التصفّح داخل الـCTE نفسه (LIMIT/OFFSET) لا عبر FILTER على التجميع: هكذا لا تُقيَّم
    -- الاستعلامات المرتبطة لكل صف مطابق بل لصفوف الصفحة فقط (نفس درس 6B).
    select b.* from base b
     order by coalesce(b.unit_number, 2147483647), coalesce(b.sequence_number, 2147483647), b.project_name, b.id
     limit v_limit offset v_offset
  )
  select (select c from counted),
    coalesce(jsonb_agg(jsonb_build_object(
      'project_id', p.id, 'project_name', p.project_name,
      'unit_number', p.unit_number, 'unit_code', p.unit_code, 'unit_type', p.unit_type,
      'season_number', p.season_number, 'batch_number', p.batch_number, 'workstream', p.workstream,
      'core_stage', p.core_stage, 'health', p.health,
      'start_date', p.start_date, 'due_date', p.due_date,
      'planned_release_date', p.planned_release_date, 'actual_release_date', p.actual_release_date,
      'progress_pct', public.pc_hier_effective_progress(p.id),
      'manager_name', (select coalesce(pr.full_name, pr.email) from public.project_members m
                        join public.profiles pr on pr.id = m.user_id
                       where m.project_id = p.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false
                       order by m.created_at limit 1),
      'overdue_tasks', (select count(*) from public.project_tasks t
                         where t.project_id = p.id and coalesce(t.is_deleted,false)=false
                           and t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today),
      'critical_risks', (select count(*) from public.project_risks r where r.project_id=p.id
                          and coalesce(r.is_deleted,false)=false and r.severity='critical' and r.status not in ('closed','accepted')),
      'critical_issues', (select count(*) from public.project_issues i where i.project_id=p.id
                           and coalesce(i.is_deleted,false)=false and i.severity='critical' and i.status not in ('resolved','closed','rejected')),
      'pending_approvals', (select count(*) from public.project_approvals a where a.project_id=p.id
                             and coalesce(a.is_deleted,false)=false and a.status='pending'),
      'closure_status', case when to_regprocedure('public.pc_project_closure_status(uuid)') is not null
                             then public.pc_project_closure_status(p.id) else null end)
      order by coalesce(p.unit_number, 2147483647), coalesce(p.sequence_number, 2147483647), p.project_name), '[]'::jsonb)
    into v_total, v_rows
  from paged p;

  return jsonb_build_object('units', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'has_more', (v_offset + v_limit) < v_total, 'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_program_units(uuid,jsonb) from public, anon;
grant execute on function public.project_program_units(uuid,jsonb) to authenticated;

comment on table public.project_program_settings is '8A: ملف تشغيل البرنامج — للمشروع الرئيسي فقط (حارس trg_program_settings_guard).';
comment on function public.project_program_dashboard(uuid) is '8A: لوحة البرنامج — مشتقّة بالكامل، تُركّب project_hierarchy_rollup ولا تكتب تقدّمًا.';
comment on function public.project_program_units(uuid,jsonb) is '8A: سجلّ وحدات البرنامج — فلترة Server-side وعزل per-row وPagination.';

-- ════════════════════════════════════════════════════════════════════════════
-- §8) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_n int;
begin
  foreach v_def in array array['public.program_can(uuid,text)','public.project_program_settings_upsert(uuid,jsonb,int)',
      'public.project_unit_metadata_upsert(uuid,jsonb,text)','public.project_program_dashboard(uuid)',
      'public.project_program_units(uuid,jsonb)'] loop
    if to_regprocedure(v_def) is null then raise exception '8A FAIL: الدالة % مفقودة', v_def; end if;
  end loop;
  if to_regclass('public.project_program_settings') is null then raise exception '8A FAIL: جدول الإعدادات مفقود'; end if;
  -- تفرّد رقم الوحدة داخل الأب
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_projects_parent_unit_number')
    then raise exception '8A FAIL: فهرس تفرّد رقم الوحدة مفقود'; end if;
  -- البرنامج للمشروع الرئيسي فقط
  if not exists (select 1 from pg_trigger where tgname='trg_program_settings_guard')
    then raise exception '8A FAIL: حارس master مفقود'; end if;
  -- اللوحة مشتقّة: لا تكتب على project_core ولا على progress
  v_def := pg_get_functiondef('public.project_program_dashboard(uuid)'::regprocedure);
  if v_def ~* 'update\s+public\.project_core' or v_def ~* 'update\s+public\.projects'
    then raise exception '8A FAIL: لوحة البرنامج تكتب بيانات'; end if;
  if position('project_hierarchy_rollup' in v_def) = 0
    then raise exception '8A FAIL: اللوحة لا تُركّب محرّك التقدّم القائم'; end if;
  -- العزل per-row في سجلّ الوحدات
  if position('pc_can_read_project' in pg_get_functiondef('public.project_program_units(uuid,jsonb)'::regprocedure)) = 0
    then raise exception '8A FAIL: سجلّ الوحدات بلا عزل per-row'; end if;
  -- لا صفوف برنامج على غير master (سلامة البيانات القائمة)
  select count(*) into v_n from public.project_program_settings s
    join public.projects p on p.id = s.project_id where p.project_scope <> 'master';
  if v_n > 0 then raise exception '8A FAIL: % صفّ برنامج على مشروع غير رئيسي', v_n; end if;
  raise notice '8A ✅ نجح الاختبار الذاتي — إعدادات البرنامج/بيانات الوحدة/اللوحة/السجلّ.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
