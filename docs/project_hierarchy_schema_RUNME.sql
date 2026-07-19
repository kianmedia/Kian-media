-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — PROJECT HIERARCHY · BATCH 1: SCHEMA + COMPATIBILITY  (RUN ONCE)
--
-- Adds the master / subproject hierarchy to the EXISTING public.projects table via
-- a self-reference (parent_project_id → projects.id). NON-BREAKING by construction:
-- pure additive DDL + one feature-flag table. Creates NO project rows, changes NO
-- query / RLS policy / access helper / create-update RPC. Every existing project
-- becomes 'standalone' automatically via the column default.
--
-- Read-only audit findings this batch is built on:
--   • projects is a BASE table (never CREATEd in docs, only ALTERed); PK id uuid;
--     client_id uuid NOT NULL; company_id uuid nullable; status is FREE-TEXT (no DB
--     CHECK); soft-delete (is_deleted/deleted_at/deleted_by) + archive already exist.
--   • project_type + progress_pct live on the 1:1 companion public.project_core, NOT
--     on projects — so the hierarchy discriminator uses a NEW, collision-free column
--     name: project_scope (verified zero repo occurrences).
--   • trg_pc_autoinit AFTER INSERT auto-creates a project_core row for ANY new project
--     → subprojects/masters get their operational layer for free.
--   • RLS resolves per-row via can_access_project()/project_role() with NO parent
--     inheritance — untouched here; client-visibility inheritance is Batch 2.
--
-- Architectural decision: all hierarchy columns live on public.projects (structural
-- identity kept self-contained + matches the requested column list). progress_pct
-- stays on project_core (the progress engine reads projects.progress_mode +
-- project_core.progress_pct together; both keyed 1:1 on the same id).
--
-- Cross-row integrity a CHECK cannot express (parent must be a master, same client,
-- no nesting/cycles, no deleting a master with live children) is enforced by a
-- SECURITY DEFINER BEFORE trigger that is a NO-OP for standalone/master rows and all
-- existing operations. Two-level-only + acyclicity follow automatically: a subproject
-- may only point at a master, and a master may not have a parent.
--
-- Idempotent · non-destructive · no data deletion · no column rename. Depends on:
-- public.projects, public.project_core, is_admin(), is_owner(), can_manage_projects(),
-- is_staff(). Feature flag OFF by default (project_hierarchy_settings.hierarchy_enabled).
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects')     is null then miss := miss || ' projects'; end if;
  if to_regclass('public.project_core') is null then miss := miss || ' project_core'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.is_owner()')            is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.is_staff()')            is null then miss := miss || ' is_staff()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة الهرمية على public.projects (كلها Additive) ═══
alter table public.projects add column if not exists parent_project_id         uuid references public.projects(id) on delete restrict;
alter table public.projects add column if not exists project_scope             text not null default 'standalone';
alter table public.projects add column if not exists sequence_number           int;
alter table public.projects add column if not exists project_code              text;
alter table public.projects add column if not exists display_label             text;
alter table public.projects add column if not exists subproject_label_singular text;
alter table public.projects add column if not exists subproject_label_plural   text;
alter table public.projects add column if not exists template_id               uuid;    -- FK added in Batch 3 (templates)
alter table public.projects add column if not exists rollup_weight             numeric not null default 1;
alter table public.projects add column if not exists progress_mode             text not null default 'hybrid';
alter table public.projects add column if not exists operational_stage         text;
alter table public.projects add column if not exists client_visibility         text not null default 'inherit';
alter table public.projects add column if not exists closure_status            text not null default 'open';
alter table public.projects add column if not exists closed_at                 timestamptz;
alter table public.projects add column if not exists closed_by                 uuid references auth.users(id);
alter table public.projects add column if not exists closure_notes             text;
alter table public.projects add column if not exists reopened_at               timestamptz;
alter table public.projects add column if not exists reopened_by               uuid references auth.users(id);
alter table public.projects add column if not exists reopen_reason             text;

-- Defensive backfill (the column defaults already make every existing row a
-- consistent standalone; this is belt-and-suspenders and re-run-safe).
update public.projects set project_scope     = 'standalone' where project_scope     is null;
update public.projects set rollup_weight     = 1            where rollup_weight     is null;
update public.projects set progress_mode     = 'hybrid'     where progress_mode     is null;
update public.projects set client_visibility = 'inherit'    where client_visibility is null;
update public.projects set closure_status    = 'open'       where closure_status    is null;

-- ═══ 2) قيود سلامة البيانات (same-row CHECKs — تُتحقّق ضد الصفوف القائمة بأمان) ═══
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_scope_ck') then
    alter table public.projects add constraint projects_scope_ck
      check (project_scope in ('standalone','master','subproject'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_no_self_parent_ck') then
    alter table public.projects add constraint projects_no_self_parent_ck
      check (parent_project_id is null or parent_project_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_scope_parent_ck') then
    alter table public.projects add constraint projects_scope_parent_ck
      check (
           (project_scope = 'subproject'                 and parent_project_id is not null)
        or (project_scope in ('standalone','master')     and parent_project_id is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_client_visibility_ck') then
    alter table public.projects add constraint projects_client_visibility_ck
      check (client_visibility in ('inherit','visible','hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_closure_status_ck') then
    alter table public.projects add constraint projects_closure_status_ck
      check (closure_status in ('open','closed','reopened'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_progress_mode_ck') then
    alter table public.projects add constraint projects_progress_mode_ck
      check (progress_mode in ('calculated','manual','hybrid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_rollup_weight_ck') then
    alter table public.projects add constraint projects_rollup_weight_ck
      check (rollup_weight >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_operational_stage_ck') then
    alter table public.projects add constraint projects_operational_stage_ck
      check (operational_stage is null or operational_stage in
             ('preproduction','production','postproduction','client_review','delivery'));
  end if;
end $c$;

-- ═══ 3) الفهارس (Partial، تتبع اصطلاح is_deleted=false) ═══
create index if not exists idx_projects_parent on public.projects(parent_project_id) where is_deleted = false;
create index if not exists idx_projects_scope  on public.projects(project_scope)     where is_deleted = false;
-- منع تكرار sequence_number داخل نفس Master، وتكرار project_code داخل نفس المؤسسة.
create unique index if not exists ux_projects_parent_seq on public.projects(parent_project_id, sequence_number)
  where parent_project_id is not null and sequence_number is not null and is_deleted = false;
create unique index if not exists ux_projects_company_code on public.projects(company_id, project_code)
  where company_id is not null and project_code is not null and is_deleted = false;

-- ═══ 4) حارس سلامة الهرمية (cross-row) — NO-OP للمستقل/الرئيسي والعمليات القائمة ═══
create or replace function public.projects_hierarchy_guard() returns trigger
language plpgsql security definer set search_path = public as $g$
declare pr record;
begin
  -- (أ) مشروع فرعي: الأب يجب أن يكون master حيًّا ولنفس العميل (يمنع التداخل والدوائر تلقائيًا).
  if new.project_scope = 'subproject' then
    if new.parent_project_id is null then raise exception 'subproject_requires_parent'; end if;
    select id, project_scope, client_id, is_deleted into pr
      from public.projects where id = new.parent_project_id;
    if pr.id is null then raise exception 'parent_not_found'; end if;
    if coalesce(pr.is_deleted,false) then raise exception 'parent_is_deleted'; end if;
    if pr.project_scope <> 'master' then raise exception 'parent_must_be_master'; end if;   -- ⇒ لا Subproject داخل Subproject، ولا دوائر
    if new.client_id is distinct from pr.client_id then raise exception 'subproject_client_must_match_master'; end if;
  end if;

  -- (ب) منع الحذف الناعم لمشروع رئيسي لديه مشاريع فرعية حيّة.
  if tg_op = 'UPDATE' and new.project_scope = 'master'
     and coalesce(old.is_deleted,false) = false and coalesce(new.is_deleted,false) = true then
    if exists (select 1 from public.projects s
               where s.parent_project_id = new.id and s.project_scope = 'subproject'
                 and coalesce(s.is_deleted,false) = false) then
      raise exception 'master_has_live_subprojects';
    end if;
  end if;

  -- (ج) حماية من جهة الأب: مشروع رئيسي لديه مشاريع فرعية حيّة لا يجوز تحويله (خفض رتبته
  -- إلى subproject/standalone) ولا إعادة ربطه بأب ولا تغيير عميله — وإلا لأمكن كسر قاعدة
  -- المستويين (M2→M→S) أو ترك مشروع فرعي مربوطًا بأب غير master، أو باختلاف العميل. الحارس
  -- كان يتحقق من جهة الابن فقط؛ هذا يسدّ الثغرة من جهة الأب.
  if tg_op = 'UPDATE' and old.project_scope = 'master'
     and ( new.project_scope     is distinct from old.project_scope
        or new.parent_project_id is not null
        or new.client_id         is distinct from old.client_id ) then
    if exists (select 1 from public.projects s
               where s.parent_project_id = old.id and s.project_scope = 'subproject'
                 and coalesce(s.is_deleted,false) = false) then
      raise exception 'master_with_children_immutable_scope_parent_client';
    end if;
  end if;

  return new;
end $g$;

drop trigger if exists trg_projects_hierarchy_guard on public.projects;
create trigger trg_projects_hierarchy_guard
  before insert or update on public.projects
  for each row execute function public.projects_hierarchy_guard();

-- ═══ 5) Feature Flag (singleton settings — نمط custody_enterprise) ═══
create table if not exists public.project_hierarchy_settings (
  id                int primary key default 1 check (id = 1),
  hierarchy_enabled boolean not null default false,   -- OFF حتى تُشحن دفعات الواجهة
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);
insert into public.project_hierarchy_settings(id) values (1) on conflict (id) do nothing;
alter table public.project_hierarchy_settings enable row level security;   -- لا سياسة قراءة مباشرة؛ عبر RPC فقط

-- قراءة العلم (كادر) / تحديثه (مالك/إدارة مشاريع).
create or replace function public.project_hierarchy_get_flags()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select * into v from public.project_hierarchy_settings where id = 1;
  return jsonb_build_object('hierarchy_enabled', coalesce(v.hierarchy_enabled,false),
                            'updated_at', v.updated_at);
end $$;

create or replace function public.project_hierarchy_admin_update_flags(p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  update public.project_hierarchy_settings set
    hierarchy_enabled = coalesce((p_data->>'hierarchy_enabled')::boolean, hierarchy_enabled),
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
  begin perform public.log_activity(auth.uid(), 'admin', 'project_hierarchy.flag_updated', 'system', null,
    jsonb_build_object('hierarchy_enabled', p_data->>'hierarchy_enabled')); exception when others then null; end;
  return true;
end $$;

-- Helper: هل الميزة مفعّلة؟ (يُقرأ من الخادم؛ يتجاوز RLS).
create or replace function public.project_hierarchy_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select hierarchy_enabled from public.project_hierarchy_settings where id = 1), false);
$$;

-- ═══ 6) Grants ═══
grant select on public.project_hierarchy_settings to authenticated;
do $g$
declare f text;
begin
  foreach f in array array[
    'public.project_hierarchy_get_flags()',
    'public.project_hierarchy_admin_update_flags(jsonb)',
    'public.project_hierarchy_enabled()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.projects_hierarchy_guard() from public, anon';  -- trigger-only
end $g$;

-- ═══ 7) VALIDATION ═══
do $v$
declare miss text := '';
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='project_scope') = 0 then miss := miss || ' projects.project_scope'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='parent_project_id') = 0 then miss := miss || ' projects.parent_project_id'; end if;
  if (select count(*) from pg_constraint where conname = 'projects_scope_parent_ck') = 0 then miss := miss || ' projects_scope_parent_ck'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_projects_hierarchy_guard') then miss := miss || ' trg_projects_hierarchy_guard'; end if;
  if to_regclass('public.project_hierarchy_settings') is null then miss := miss || ' project_hierarchy_settings'; end if;
  if to_regprocedure('public.project_hierarchy_enabled()') is null then miss := miss || ' project_hierarchy_enabled'; end if;
  -- every pre-existing project must now be a valid standalone (no accidental breakage).
  if exists (select 1 from public.projects where project_scope is null or project_scope not in ('standalone','master','subproject')) then
    miss := miss || ' (found invalid project_scope on existing rows)'; end if;
  if exists (select 1 from public.projects where project_scope <> 'subproject' and parent_project_id is not null) then
    miss := miss || ' (found non-subproject with a parent)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- ─── فحوص ما بعد التشغيل (Read-only) ───
--  -- كل المشاريع الحالية أصبحت standalone بلا أب:
--  select project_scope, count(*) from public.projects group by 1;                 -- توقّع: standalone = N، لا master/subproject
--  select count(*) from public.projects where parent_project_id is not null;        -- توقّع: 0
--  -- العلم مطفأ افتراضيًا:
--  select public.project_hierarchy_enabled();                                       -- توقّع: false
--  -- الحارس يمنع أبًا غير master (يجب أن يرمي parent_must_be_master):
--  -- (اختبار يدوي في بيئة اختبار فقط — لا تشغّله على Production)
