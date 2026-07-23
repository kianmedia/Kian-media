-- ════════════════════════════════════════════════════════════════════════════
-- project_hierarchy_batch6a_RUNME.sql
-- BATCH 6A — PROJECT HIERARCHY ACTIVATION (master ⇄ subproject) — RUN ONCE
-- ────────────────────────────────────────────────────────────────────────────
-- ملف موحّد نهائي يُفعّل الهرمية فعليًّا. مبنيّ على Read-Only Audit للملفّين السابقين:
--   • docs/project_hierarchy_schema_RUNME.sql (Batch 1) — نواته سليمة ⇒ أُعيد استخدامها هنا.
--   • docs/project_hierarchy_security_RUNME.sql (Batch 2) — يُعيد تعريف
--     can_access_project/is_client_side/is_client_owner (≈50 سياسة RLS + ≈30 بوابة RPC خلفها)
--     ويحوي خطر تصعيد كامن (client_id is distinct from my_client_id ⇒ NULL is distinct from NULL = FALSE).
--     ⇒ 6A **لا يعيد تعريف أيّ دالة وصول أساسية**. §22 مُحقَّق بنيويًّا: الوصول لكل صف على حدة بلا
--     أيّ توريث من الأب ⇒ رؤية المشروع الرئيسي لا تمنح رؤية الفروع؛ والعميل لا يرى إلا مشاريعه.
--
-- انحراف Batch 1 المُستبعَد عمدًا (كان سيُنشئ مصادر حقيقة مكرّرة مع أطوار 3/4/5 اللاحقة):
--   ✗ projects.progress_mode        — مملوك لـ project_core.progress_mode (3C: lifecycle/tasks/hybrid/manual،
--                                      وself-test 3C يؤكّد الافتراضي 'lifecycle') — مفردات مختلفة تمامًا.
--   ✗ projects.operational_stage    — مملوك لـ project_core.core_stage (مصدر دورة الحياة الوحيد).
--   ✗ projects.closure_status/closed_at/closed_by/closure_notes/reopened_* — مملوك لـ 5C
--                                      (project_closure_requests + pc_project_closure_status المشتقّة).
--   (إن كان Batch 1 قد طُبّق سابقًا فالأعمدة موجودة؛ 6A يتجاهلها ولا يقرأها — لا مصدر حقيقة ثانٍ.)
--
-- المفردات: project_scope ∈ (standalone | master | subproject) — كما في Batch 1 وكما تعتمده
-- pc_is_subproject/pc_client_cap. الواجهة تعرضها عربيًّا: مستقل/رئيسي/فرعي (لا قيم DB جديدة).
--
-- عمق الهرمية: مستويان (رئيسي ← فرعي) بحكم القيد + الحارس (الفرع أبوه master، والـmaster بلا أب)
-- ⇒ الدورات مستحيلة بنيويًّا، ولا عدّ مزدوج في تجميعات 4C/5B/5C. أُضيف حارس دورات تكراريّ دفاعيًّا.
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا حذف بيانات · بلا DROP FUNCTION/TABLE ·
--   بلا Temp Tables · Preflight · self-test بلا Side Effects · notify pgrst · GRANTs/RLS/Comments ·
--   لا يمسّ core_stage/progress/المالية/Zoho/العهدة · لا يعيد تعريف دوال الوصول.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.projects') is null or to_regclass('public.project_core') is null then raise exception '6A PREFLIGHT: projects/project_core مفقودة'; end if;
  if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.can_manage_projects()') is null
     or to_regprocedure('public.is_owner()') is null or to_regprocedure('public.pc_can_read_project(uuid)') is null
     then raise exception '6A PREFLIGHT: دوال الأدوار/الوصول مفقودة'; end if;
  if to_regprocedure('public.pc_is_subproject(uuid)') is null then raise exception '6A PREFLIGHT: pc_is_subproject مفقودة (Phase 4C) — طبّق 4C أولًا'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null then raise exception '6A PREFLIGHT: project_core_create_project مفقودة'; end if;
  if to_regprocedure('public.project_status_for_stage(text)') is null then raise exception '6A PREFLIGHT: project_status_for_stage مفقودة (طبّق project_stage_sync أولًا)'; end if;
  -- تبعيات تُستخدم وقت الإنشاء (hier_can/الصلاحيات) — نفشل مبكرًا بدل الإجهاض في منتصف المعاملة.
  if to_regclass('public.permissions') is null or to_regprocedure('public.emp_has_permission(text)') is null
     or to_regprocedure('public.can_edit_project(uuid)') is null then raise exception '6A PREFLIGHT: كتالوج الصلاحيات/can_edit_project مفقود'; end if;
  if to_regprocedure('public.project_progress_snapshot(uuid)') is null then raise notice '6A: project_progress_snapshot مفقودة — التجميع سيسقط إلى progress_pct'; end if;
  if to_regprocedure('public.project_subprojects_summary(uuid)') is null then raise notice '6A: project_subprojects_summary مفقودة — ستُنشأ هنا'; end if;
  -- عمود client_id غير قابل للتفريغ شرط سلامة قاعدة «نفس العميل» في الحارس.
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='client_id' and is_nullable='YES')
    then raise notice '6A تحذير: projects.client_id يقبل NULL — قاعدة «نفس العميل» تعتمد المقارنة الصارمة'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) أعمدة الهرمية على public.projects (نواة Batch 1 — بلا الأعمدة المنحرفة)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.projects add column if not exists parent_project_id         uuid references public.projects(id) on delete restrict;
alter table public.projects add column if not exists project_scope             text not null default 'standalone';
alter table public.projects add column if not exists sequence_number           int;
alter table public.projects add column if not exists project_code              text;
alter table public.projects add column if not exists display_label             text;
alter table public.projects add column if not exists subproject_label_singular text;
alter table public.projects add column if not exists subproject_label_plural   text;
alter table public.projects add column if not exists rollup_weight             numeric not null default 1;
alter table public.projects add column if not exists client_visibility         text not null default 'inherit';

-- Backfill دفاعي مُتكرِّر (الافتراضات تكفي؛ هذا حزام أمان).
update public.projects set project_scope     = 'standalone' where project_scope     is null;
update public.projects set rollup_weight     = 1            where rollup_weight     is null;
update public.projects set client_visibility = 'inherit'    where client_visibility is null;

do $g$
begin
  if not exists (select 1 from pg_constraint where conname='projects_scope_ck') then
    alter table public.projects add constraint projects_scope_ck check (project_scope in ('standalone','master','subproject')); end if;
  if not exists (select 1 from pg_constraint where conname='projects_no_self_parent_ck') then
    alter table public.projects add constraint projects_no_self_parent_ck check (parent_project_id is null or parent_project_id <> id); end if;
  if not exists (select 1 from pg_constraint where conname='projects_scope_parent_ck') then
    alter table public.projects add constraint projects_scope_parent_ck check (
      (project_scope = 'subproject' and parent_project_id is not null)
      or (project_scope in ('standalone','master') and parent_project_id is null)); end if;
  if not exists (select 1 from pg_constraint where conname='projects_client_visibility_ck') then
    alter table public.projects add constraint projects_client_visibility_ck check (client_visibility in ('inherit','visible','hidden')); end if;
  if not exists (select 1 from pg_constraint where conname='projects_rollup_weight_ck') then
    alter table public.projects add constraint projects_rollup_weight_ck check (rollup_weight >= 0); end if;
end $g$;

create index if not exists idx_projects_parent on public.projects(parent_project_id) where is_deleted = false;
create index if not exists idx_projects_scope  on public.projects(project_scope)     where is_deleted = false;
create unique index if not exists ux_projects_parent_seq on public.projects(parent_project_id, sequence_number)
  where parent_project_id is not null and sequence_number is not null and is_deleted = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) حارس السلامة عبر الصفوف (Batch 1 — مُثبت) + حارس دورات تكراريّ دفاعيّ
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.projects_hierarchy_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record; v_depth int := 0; v_cur uuid;
begin
  -- (أ) قواعد الفرع — تُفحص عند الإنشاء، وعند تغيّر حقول الهرمية، وعند الاستعادة فقط.
  -- لا تُعاد على كل تعديل عاديّ لفرع حيّ: فرعا (ب)/(ج) يمنعان أصلًا أرشفة/تخفيض/تغيير عميل مشروع رئيسي
  -- له فروع حيّة ⇒ الأب لا يمكن أن يصير غير صالح بينما الفرع حيّ. هذا يتجنّب أيضًا قفل الأب (FOR SHARE)
  -- عند كل كتابة على فرع (تسلسل غير ضروريّ بين كتابات الأب والفرع).
  if new.project_scope = 'subproject'
     and (tg_op = 'INSERT'
          or new.parent_project_id is distinct from old.parent_project_id
          or new.project_scope   is distinct from old.project_scope
          or new.client_id       is distinct from old.client_id
          or (coalesce(old.is_deleted,false) = true and coalesce(new.is_deleted,false) = false)) then
    if new.parent_project_id is null then raise exception 'subproject_requires_parent'; end if;
    -- FOR SHARE: يمنع Write-Skew (TOCTOU). يتعارض مع FOR NO KEY UPDATE/FOR UPDATE الذي يأخذه أيّ
    -- UPDATE على صف الأب ⇒ تتسلسل المعاملتان ويعيد الخاسر القراءة فيرفع الخطأ الصحيح
    -- (parent_is_deleted / parent_must_be_master / subproject_client_must_match_master).
    select id, project_scope, client_id, is_deleted, parent_project_id into p
      from public.projects where id = new.parent_project_id for share;
    if p.id is null then raise exception 'parent_not_found'; end if;
    if coalesce(p.is_deleted,false) then raise exception 'parent_is_deleted'; end if;
    if p.project_scope <> 'master' then raise exception 'parent_must_be_master'; end if;
    if new.client_id is distinct from p.client_id then raise exception 'subproject_client_must_match_master'; end if;
    -- حارس دورات تكراريّ (دفاعيّ): مستحيل بنيويًّا في مستويين، لكنه يحمي أيّ توسعة مستقبلية.
    v_cur := p.parent_project_id;
    while v_cur is not null and v_depth < 16 loop
      if v_cur = new.id then raise exception 'circular_hierarchy'; end if;
      select parent_project_id into v_cur from public.projects where id = v_cur;
      v_depth := v_depth + 1;
    end loop;
    if v_depth >= 16 then raise exception 'hierarchy_too_deep'; end if;
  end if;

  -- (ب) منع الحذف الناعم لمشروع رئيسي له فروع حيّة
  if tg_op = 'UPDATE' and new.project_scope = 'master'
     and coalesce(new.is_deleted,false) = true and coalesce(old.is_deleted,false) = false then
    if exists (select 1 from public.projects c where c.parent_project_id = new.id and coalesce(c.is_deleted,false) = false)
      then raise exception 'master_has_live_subprojects'; end if;
  end if;

  -- (ج) تجميد هوية المشروع الرئيسي ما دامت له فروع حيّة (يسدّ ثغرة «تخفيض» الأب)
  if tg_op = 'UPDATE' and old.project_scope = 'master'
     and (new.project_scope <> old.project_scope or new.parent_project_id is not null or new.client_id is distinct from old.client_id) then
    if exists (select 1 from public.projects c where c.parent_project_id = old.id and coalesce(c.is_deleted,false) = false)
      then raise exception 'master_with_children_immutable_scope_parent_client'; end if;
  end if;

  return new;
end $$;
revoke execute on function public.projects_hierarchy_guard() from public, anon, authenticated;

drop trigger if exists trg_projects_hierarchy_guard on public.projects;
create trigger trg_projects_hierarchy_guard before insert or update on public.projects
  for each row execute function public.projects_hierarchy_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- §3) علم التفعيل (يُصبح فعّالًا حقًّا: مسارات الإنشاء/النقل تستشيره)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_hierarchy_settings (
  id                 int primary key default 1 check (id = 1),
  hierarchy_enabled  boolean not null default false,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
insert into public.project_hierarchy_settings(id) values (1) on conflict (id) do nothing;
alter table public.project_hierarchy_settings enable row level security;
-- إصلاح: Batch 1 فعّل RLS بلا أيّ سياسة ⇒ select ممنوع فعليًّا رغم المنح. نضيف سياسة قراءة للموظفين.
drop policy if exists phs_read on public.project_hierarchy_settings;
create policy phs_read on public.project_hierarchy_settings for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.project_hierarchy_settings from authenticated, anon;
grant select on public.project_hierarchy_settings to authenticated;

create or replace function public.project_hierarchy_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select hierarchy_enabled from public.project_hierarchy_settings where id = 1), false);
$$;
revoke execute on function public.project_hierarchy_enabled() from public, anon;
grant execute on function public.project_hierarchy_enabled() to authenticated;

create or replace function public.project_hierarchy_get_flags()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select jsonb_build_object('hierarchy_enabled', hierarchy_enabled, 'updated_at', updated_at)
    into v from public.project_hierarchy_settings where id = 1;
  return coalesce(v, jsonb_build_object('hierarchy_enabled', false));
end $$;
revoke execute on function public.project_hierarchy_get_flags() from public, anon;
grant execute on function public.project_hierarchy_get_flags() to authenticated;

-- ملاحظة توافق: Batch 1 عرّفها `returns boolean`. CREATE OR REPLACE لا يغيّر نوع الإرجاع
-- (42P13 يُجهض الدفعة كلها)، وDROP FUNCTION ممنوع ⇒ نلتزم بالتوقيع نفسه.
create or replace function public.project_hierarchy_admin_update_flags(p_data jsonb)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  update public.project_hierarchy_settings set
    hierarchy_enabled = coalesce((p_data->>'hierarchy_enabled')::boolean, hierarchy_enabled),
    updated_by = auth.uid(), updated_at = now() where id = 1;
  -- تسجيل غير حَرِج (project_activity قد تشترط project_id) — لا يُفشل تغيير العلم.
  begin
    perform public.log_activity(auth.uid(), 'admin', 'project_hierarchy.flag_updated', 'system', null,
      jsonb_build_object('hierarchy_enabled', p_data->>'hierarchy_enabled'));
  exception when others then null; end;
  return true;
end $$;
revoke execute on function public.project_hierarchy_admin_update_flags(jsonb) from public, anon;
grant execute on function public.project_hierarchy_admin_update_flags(jsonb) to authenticated;

-- التفعيل الفعليّ لهذه الدفعة (idempotent).
update public.project_hierarchy_settings set hierarchy_enabled = true, updated_at = now() where id = 1;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) دوال الهرمية المساعدة (بنفس شكل pc_is_subproject: definer + عزل + REVOKE)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_is_master(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from public.projects where id = p_project and project_scope = 'master' and coalesce(is_deleted,false)=false);
exception when undefined_column then return false;
end $$;
revoke execute on function public.pc_is_master(uuid) from public, anon, authenticated;

create or replace function public.pc_parent_of(p_project uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select parent_project_id into v from public.projects where id = p_project;
  return v;
exception when undefined_column then return null;
end $$;
revoke execute on function public.pc_parent_of(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) صلاحيات الهرمية
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('hierarchy.view',            'hierarchy','normal',   950,'عرض الهرمية','View hierarchy'),
  ('hierarchy.create_subproject','hierarchy','normal',  955,'إنشاء مشروع فرعي','Create subproject'),
  ('hierarchy.move',            'hierarchy','sensitive',960,'نقل مشروع فرعي','Move subproject'),
  ('hierarchy.detach',          'hierarchy','sensitive',965,'فصل مشروع فرعي','Detach subproject'),
  ('hierarchy.manage_settings', 'hierarchy','sensitive',970,'إدارة إعدادات الهرمية','Manage hierarchy settings')
on conflict (key) do nothing;

create or replace function public.hier_can(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and public.pc_can_read_project(p_project) and (
    case when p_key in ('hierarchy.move','hierarchy.detach','hierarchy.manage_settings')
         then (public.can_manage_projects() or public.emp_has_permission(p_key))
         else (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission(p_key))
    end);
$$;
revoke execute on function public.hier_can(uuid,text) from public, anon;
grant execute on function public.hier_can(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) إنشاء المشروع مع دعم الهرمية (توسيع أمين للدالة الرسمية — نفس التوقيع)
--     الوراثة اختيارية ومحدودة: العميل (إلزامي للفرع)، المدير، الفريق، إعدادات الحوكمة.
--     لا تُورَّث أبدًا: الميزانية/التواريخ/المهام/المخرجات.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_core_create_project(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_project uuid; v_stage text; v_mgr uuid; v_name text;
  v_scope text; v_parent uuid; pr record; v_seq int;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  v_name := btrim(coalesce(p_data->>'project_name',''));
  if v_name = '' then raise exception 'name_required'; end if;
  v_stage := coalesce(nullif(p_data->>'core_stage',''),'planning');
  if v_stage not in ('lead_approved','project_created','planning','ready','scheduled','in_production',
                     'post_production','internal_review','client_review','revision','approved','delivered','closed')
    then raise exception 'bad_stage'; end if;

  -- ═══ الهرمية ═══
  v_scope  := coalesce(nullif(p_data->>'project_scope',''),'standalone');
  if v_scope not in ('standalone','master','subproject') then raise exception 'bad_scope'; end if;
  v_parent := nullif(p_data->>'parent_project_id','')::uuid;
  if v_scope = 'subproject' then
    if not public.project_hierarchy_enabled() then raise exception 'hierarchy_disabled'; end if;
    if v_parent is null then raise exception 'parent_required'; end if;
    -- FOR UPDATE على الأب: يسلسل الإنشاءات المتزامنة تحت نفس الأب (يمنع تضارب ux_projects_parent_seq)
    -- ويمنع TOCTOU مع تعديل/أرشفة الأب.
    select id, client_id, project_scope, is_deleted into pr from public.projects where id = v_parent for update;
    if pr.id is null then raise exception 'parent_not_found'; end if;
    if coalesce(pr.is_deleted,false) then raise exception 'parent_is_deleted'; end if;
    if pr.project_scope <> 'master' then raise exception 'parent_must_be_master'; end if;
    if not public.hier_can(v_parent, 'hierarchy.create_subproject') then raise exception 'not authorized'; end if;
    -- العميل مُورَّث إلزاميًّا من الأب (قاعدة «نفس العميل» في الحارس).
    v_client := pr.client_id;
  else
    if v_parent is not null then raise exception 'parent_not_allowed_for_scope'; end if;
    if v_scope = 'master' and not public.project_hierarchy_enabled() then raise exception 'hierarchy_disabled'; end if;
  end if;

  -- ═══ العميل (لغير الفرع) ═══
  if v_client is null then
    v_client := nullif(p_data->>'client_id','')::uuid;
    if v_client is not null then
      if not exists (select 1 from public.clients where id = v_client and is_deleted = false) then raise exception 'bad_client'; end if;
    elsif coalesce(btrim(p_data->>'client_name'),'') <> '' then
      insert into public.clients(user_id, full_name, company, email, email_is_placeholder)
        values (null, btrim(p_data->>'client_name'), nullif(btrim(p_data->>'client_company'),''), public.gen_pending_email(), true)
        returning id into v_client;
    else
      raise exception 'client_required';
    end if;
  end if;

  -- ترقيم تسلسلي للفرع داخل أبيه (يحترم ux_projects_parent_seq).
  if v_scope = 'subproject' then
    select coalesce(max(sequence_number),0)+1 into v_seq from public.projects where parent_project_id = v_parent;
  end if;

  insert into public.projects(project_name, client_id, status, notes, project_scope, parent_project_id, sequence_number)
    values (v_name, v_client, public.project_status_for_stage(v_stage), nullif(btrim(p_data->>'description'),''),
            v_scope, v_parent, v_seq)
    returning id into v_project;   -- trg_pc_autoinit ينشئ project_core

  update public.project_core set
    core_stage    = v_stage,
    priority      = coalesce(nullif(p_data->>'priority',''),'normal'),
    start_date    = nullif(p_data->>'start_date','')::date,
    due_date      = nullif(p_data->>'due_date','')::date,
    budget_amount = case when (public.can_manage_projects() or public.can_see_financials())
                          then nullif(p_data->>'budget_amount','')::numeric else null end,
    project_type  = nullif(p_data->>'project_type',''),
    currency      = coalesce(nullif(p_data->>'currency',''),'SAR'),
    updated_at = now(), updated_by = auth.uid()
    where project_id = v_project;

  insert into public.project_members(project_id, user_id, role, added_by)
    values (v_project, auth.uid(), 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  v_mgr := nullif(p_data->>'manager_id','')::uuid;
  if v_mgr is not null and v_mgr <> auth.uid() then
    insert into public.project_members(project_id, user_id, role, added_by)
      values (v_project, v_mgr, 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  end if;

  -- ═══ وراثة اختيارية (فرع فقط) — لا ميزانية/تواريخ/مهام/مخرجات ═══
  if v_scope = 'subproject' then
    if coalesce((p_data->>'inherit_manager')::boolean,false) then
      insert into public.project_members(project_id, user_id, role, added_by)
        select v_project, m.user_id, 'kian_manager', auth.uid() from public.project_members m
        where m.project_id = v_parent and m.role = 'kian_manager' and coalesce(m.is_deleted,false)=false
        on conflict (project_id, user_id) do nothing;
    end if;
    if coalesce((p_data->>'inherit_team')::boolean,false) then
      insert into public.project_members(project_id, user_id, role, added_by)
        select v_project, m.user_id, m.role, auth.uid() from public.project_members m
        where m.project_id = v_parent and m.role like 'kian\_%' and coalesce(m.is_deleted,false)=false
        on conflict (project_id, user_id) do nothing;
    end if;
    if coalesce((p_data->>'inherit_governance')::boolean,false) then
      begin
        insert into public.project_governance_settings(project_id) values (v_project) on conflict (project_id) do nothing;
        update public.project_governance_settings t set
          governance_mode = s.governance_mode, approval_mode = s.approval_mode, stage_gate_mode = s.stage_gate_mode,
          change_control_mode = s.change_control_mode, require_client_approval = s.require_client_approval,
          require_internal_approval = s.require_internal_approval, updated_at = now()
          from public.project_governance_settings s
          where t.project_id = v_project and s.project_id = v_parent;
      exception when undefined_table or undefined_column then null;   -- 5A غير مطبّقة
      end;
    end if;
  end if;

  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (v_project, null, v_stage, 'project created', auth.uid());
  perform public.pc_log(v_project, 'project_created', 'project', v_project,
    jsonb_build_object('name', v_name, 'scope', v_scope, 'parent', v_parent));
  -- سجل جانب الأب: بلا اسم/بيانات الفرع (من يقرأ الأب قد لا يملك رؤية الفرع — §22). entity_id يكفي للربط،
  -- ولا يُحلّ إلا لمن يملك رؤية الفرع فعلًا.
  if v_parent is not null then
    perform public.pc_log(v_parent, 'subproject_created', 'project', v_project, '{}'::jsonb);
  end if;
  perform public.pc_notify_team(v_project, 'project_status_changed', 'project', v_project,
    'أُنشئ مشروع جديد: '||v_name, 'New project created: '||v_name, auth.uid());

  return jsonb_build_object('ok', true, 'project_id', v_project, 'stage', v_stage, 'project_scope', v_scope, 'parent_project_id', v_parent);
end $$;
revoke execute on function public.project_core_create_project(jsonb) from public, anon;
grant execute on function public.project_core_create_project(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) نقل الفرع إلى رئيسي آخر · فصله إلى مستقل (صلاحية + سبب إلزامي + Audit)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_move_subproject(p_project uuid, p_new_parent uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record; np record; v_seq int;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  select id, project_scope, parent_project_id, client_id, is_deleted into c from public.projects where id = p_project for update;
  if c.id is null then raise exception 'not_found'; end if;
  if coalesce(c.is_deleted,false) then raise exception 'project_is_deleted'; end if;
  if c.project_scope <> 'subproject' then raise exception 'not_a_subproject'; end if;
  -- الصلاحية على الفرع + الأب الجديد + **الأب الحالي** (لا يُنتزع فرع من أبٍ لا يملك المستخدم إدارته).
  if not (public.hier_can(p_project, 'hierarchy.move') and public.hier_can(p_new_parent, 'hierarchy.move')) then raise exception 'not authorized'; end if;
  if c.parent_project_id is not null and not public.hier_can(c.parent_project_id, 'hierarchy.move') then raise exception 'not authorized: source_parent'; end if;
  -- FOR UPDATE (لا FOR SHARE): نقلان متزامنان إلى نفس الأب يحسبان max(seq)+1 نفسه ⇒ 23505 على
  -- ux_projects_parent_seq. القفل الحصريّ يسلسلهما.
  select id, project_scope, client_id, is_deleted into np from public.projects where id = p_new_parent for update;
  if not public.project_hierarchy_enabled() then raise exception 'hierarchy_disabled'; end if;
  if np.id is null then raise exception 'parent_not_found'; end if;
  if coalesce(np.is_deleted,false) then raise exception 'parent_is_deleted'; end if;
  if np.project_scope <> 'master' then raise exception 'parent_must_be_master'; end if;
  if np.id = p_project then raise exception 'circular_hierarchy'; end if;
  if c.client_id is distinct from np.client_id then raise exception 'subproject_client_must_match_master'; end if;
  if c.parent_project_id = p_new_parent then return jsonb_build_object('ok', true, 'noop', true); end if;

  select coalesce(max(sequence_number),0)+1 into v_seq from public.projects where parent_project_id = p_new_parent;
  update public.projects set parent_project_id = p_new_parent, sequence_number = v_seq where id = p_project;
  perform public.pc_log(p_project, 'subproject_moved', 'project', p_project,
    jsonb_build_object('from_parent', c.parent_project_id, 'to_parent', p_new_parent, 'reason', btrim(p_reason)));
  perform public.pc_log(c.parent_project_id, 'subproject_moved_out', 'project', p_project, jsonb_build_object('to_parent', p_new_parent, 'reason', btrim(p_reason)));
  perform public.pc_log(p_new_parent, 'subproject_moved_in', 'project', p_project, jsonb_build_object('from_parent', c.parent_project_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'parent_project_id', p_new_parent);
end $$;
revoke execute on function public.project_hierarchy_move_subproject(uuid,uuid,text) from public, anon;
grant execute on function public.project_hierarchy_move_subproject(uuid,uuid,text) to authenticated;

-- ترقية مشروع قائم (مستقل) إلى «مشروع رئيسي» — بدونها تبقى كل المشاريع القائمة standalone للأبد
-- ولا يمكن بناء هرمية على بيانات حيّة. صلاحية حسّاسة + سبب إلزامي + Audit.
create or replace function public.project_hierarchy_promote_to_master(p_project uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  if not public.project_hierarchy_enabled() then raise exception 'hierarchy_disabled'; end if;
  select id, project_scope, parent_project_id, is_deleted into c from public.projects where id = p_project for update;
  if c.id is null then raise exception 'not_found'; end if;
  if coalesce(c.is_deleted,false) then raise exception 'project_is_deleted'; end if;
  if not public.hier_can(p_project, 'hierarchy.move') then raise exception 'not authorized'; end if;
  if c.project_scope = 'master' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if c.project_scope <> 'standalone' then raise exception 'only_standalone_can_be_promoted'; end if;
  update public.projects set project_scope = 'master' where id = p_project;   -- parent يبقى null (قيد scope_parent)
  perform public.pc_log(p_project, 'project_promoted_to_master', 'project', p_project, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'project_scope', 'master');
end $$;
revoke execute on function public.project_hierarchy_promote_to_master(uuid,text) from public, anon;
grant execute on function public.project_hierarchy_promote_to_master(uuid,text) to authenticated;

-- خفض مشروع رئيسي بلا فروع حيّة إلى مستقل (عكس الترقية) — الحارس (ج) يمنعه إن كانت له فروع.
create or replace function public.project_hierarchy_demote_to_standalone(p_project uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  select id, project_scope, is_deleted into c from public.projects where id = p_project for update;
  if c.id is null then raise exception 'not_found'; end if;
  -- خفض مشروع مؤرشف يترك فروعه المؤرشفة بلا مسار عودة (الاستعادة ترفع parent_must_be_master).
  if coalesce(c.is_deleted,false) then raise exception 'project_is_deleted'; end if;
  if not public.hier_can(p_project, 'hierarchy.move') then raise exception 'not authorized'; end if;
  if c.project_scope = 'standalone' then return jsonb_build_object('ok', true, 'noop', true); end if;
  if c.project_scope <> 'master' then raise exception 'only_master_can_be_demoted'; end if;
  if exists (select 1 from public.projects x where x.parent_project_id = p_project and coalesce(x.is_deleted,false)=false)
    then raise exception 'master_has_live_subprojects'; end if;
  update public.projects set project_scope = 'standalone' where id = p_project;
  perform public.pc_log(p_project, 'project_demoted_to_standalone', 'project', p_project, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'project_scope', 'standalone');
end $$;
revoke execute on function public.project_hierarchy_demote_to_standalone(uuid,text) from public, anon;
grant execute on function public.project_hierarchy_demote_to_standalone(uuid,text) to authenticated;

create or replace function public.project_hierarchy_detach_subproject(p_project uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c record;
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'reason_required'; end if;
  select id, project_scope, parent_project_id, is_deleted into c from public.projects where id = p_project for update;
  if c.id is null then raise exception 'not_found'; end if;
  if coalesce(c.is_deleted,false) then raise exception 'project_is_deleted'; end if;
  if c.project_scope <> 'subproject' then raise exception 'not_a_subproject'; end if;
  if not public.hier_can(p_project, 'hierarchy.detach') then raise exception 'not authorized'; end if;
  -- الفصل ينتزع الفرع من أبيه ⇒ يتطلّب صلاحية على الأب الحالي أيضًا.
  if c.parent_project_id is not null and not public.hier_can(c.parent_project_id, 'hierarchy.detach') then raise exception 'not authorized: source_parent'; end if;
  update public.projects set project_scope = 'standalone', parent_project_id = null, sequence_number = null where id = p_project;
  perform public.pc_log(p_project, 'subproject_detached', 'project', p_project,
    jsonb_build_object('from_parent', c.parent_project_id, 'reason', btrim(p_reason)));
  perform public.pc_log(c.parent_project_id, 'subproject_detached_out', 'project', p_project, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'project_id', p_project, 'project_scope', 'standalone');
end $$;
revoke execute on function public.project_hierarchy_detach_subproject(uuid,text) from public, anon;
grant execute on function public.project_hierarchy_detach_subproject(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) قائمة المشاريع الفرعية (توسيع الدالة القائمة — نفس التوقيع؛ لا موازٍ)
--     تضيف: المرحلة · المدير · الصحة · المخاطر/المشكلات — مع إبقاء العزل و undefined_column.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_subprojects_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', c.id, 'name', c.project_name, 'status', c.status,
      'core_stage', pc.core_stage, 'health', pc.health, 'priority', pc.priority,
      'start', coalesce(pc.start_date, (select min(start_date) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false)),
      'end',   coalesce(pc.due_date,   (select max(due_date)   from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false)),
      -- نفس محرّك التقدّم المستخدَم في التجميع (لا رقمان مختلفان للطفل نفسه في اللوحة ذاتها).
      'progress_pct', public.pc_hier_effective_progress(c.id),
      'rollup_weight', coalesce(c.rollup_weight,1),
      'manager_id', (select m.user_id from public.project_members m where m.project_id=c.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false limit 1),
      'manager_name', (select coalesce(pr.full_name, pr.email) from public.project_members m
                        join public.profiles pr on pr.id=m.user_id
                        where m.project_id=c.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false limit 1),
      'milestones', (select count(*) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false and coalesce(t.is_milestone,false)),
      'open_tasks', (select count(*) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')),
      'critical_risks',  public.pc_hier_risk_count(c.id, 'risk'),
      'critical_issues', public.pc_hier_risk_count(c.id, 'issue')
    ) order by coalesce(c.sequence_number, 9999), c.project_name), '[]'::jsonb) into v
    from public.projects c
    left join public.project_core pc on pc.project_id = c.id
    where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when undefined_column then v := '[]'::jsonb;   -- هجرة hierarchy غير مطبّقة
  end;
  return jsonb_build_object('project_id', p_project, 'subprojects', coalesce(v,'[]'::jsonb), 'generated_at', now());
end $$;
revoke execute on function public.project_subprojects_summary(uuid) from public, anon;
grant  execute on function public.project_subprojects_summary(uuid) to authenticated;

-- التقدّم الفعليّ من محرّك 3C الرسميّ (مع سقوط آمن إلى الكاش) — مصدر واحد للتقدّم في كل الهرمية.
create or replace function public.pc_hier_effective_progress(p_project uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  begin v := (public.project_progress_snapshot(p_project)->>'effective_progress')::int;
  exception when others then v := null; end;
  if v is null then select progress_pct into v from public.project_core where project_id = p_project; end if;
  return coalesce(v,0);
end $$;
revoke execute on function public.pc_hier_effective_progress(uuid) from public, anon, authenticated;

-- عدّاد مخاطر/مشكلات معزول (5A قد تكون غير مطبّقة)
create or replace function public.pc_hier_risk_count(p_project uuid, p_kind text)
returns int language plpgsql stable security definer set search_path = public as $$
declare v int := 0;
begin
  if p_kind = 'risk' then
    select count(*) into v from public.project_risks
      where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted');
  else
    select count(*) into v from public.project_issues
      where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','resolved');
  end if;
  return coalesce(v,0);
exception when undefined_table or undefined_column then return 0;
end $$;
revoke execute on function public.pc_hier_risk_count(uuid,text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) تجميع المشروع الرئيسي (own vs children) — مشتقّ، لا يُكتب على تقدّم الأب
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_rollup(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_own int; v_total int:=0; v_active int:=0; v_delayed int:=0; v_critical int:=0; v_closed int:=0;
  v_agg numeric; v_scope text; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select project_scope into v_scope from public.projects where id = p_project;
  -- مصدر التقدّم الرسميّ هو محرّك 3C (يحترم progress_mode)، لا الكاش progress_pct — كي لا يظهر رقمان مختلفان.
  begin v_own := (public.project_progress_snapshot(p_project)->>'effective_progress')::int;
  exception when others then select progress_pct into v_own from public.project_core where project_id = p_project; end;
  begin
    select count(*),
           count(*) filter (where pc.core_stage not in ('delivered','closed')),
           count(*) filter (where pc.due_date is not null and pc.due_date < v_today and pc.core_stage not in ('delivered','closed')),
           count(*) filter (where pc.health = 'off_track'),
           count(*) filter (where pc.core_stage = 'closed'),
           -- تجميع مرجَّح بـrollup_weight من نفس محرّك التقدّم الرسميّ (مشتقّ فقط — لا يُخزَّن على الأب)
           case when sum(coalesce(c.rollup_weight,1)) > 0
                then round(sum(coalesce(public.pc_hier_effective_progress(c.id),0) * coalesce(c.rollup_weight,1)) / sum(coalesce(c.rollup_weight,1)), 1)
                else null end
      into v_total, v_active, v_delayed, v_critical, v_closed, v_agg
    from public.projects c
    left join public.project_core pc on pc.project_id = c.id
    where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when undefined_column then v_total := 0;
  end;
  return jsonb_build_object(
    'project_id', p_project, 'project_scope', coalesce(v_scope,'standalone'),
    'own_progress', v_own,
    'children_aggregate_progress', v_agg,           -- null = لا فروع مرئية ⇒ غير متاح (لا 0 مضلّل)
    'total_children', coalesce(v_total,0), 'active_children', coalesce(v_active,0),
    'delayed_children', coalesce(v_delayed,0), 'critical_children', coalesce(v_critical,0),
    'closed_children', coalesce(v_closed,0),
    'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_rollup(uuid) from public, anon;
grant execute on function public.project_hierarchy_rollup(uuid) to authenticated;

-- قائمة المشاريع الرئيسية المرئية (لاختيار الأب عند إنشاء فرع) — بلا مساس بدشبورد المشاريع.
create or replace function public.project_hierarchy_masters_list(p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'project_name', p.project_name, 'client_id', p.client_id)
        order by p.project_name), '[]'::jsonb) into v
      from public.projects p
      where p.project_scope = 'master' and coalesce(p.is_deleted,false)=false
        and (p_client is null or p.client_id = p_client)
        and public.pc_can_read_project(p.id);
  exception when undefined_column then v := '[]'::jsonb;
  end;
  return jsonb_build_object('masters', coalesce(v,'[]'::jsonb), 'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_masters_list(uuid) from public, anon;
grant execute on function public.project_hierarchy_masters_list(uuid) to authenticated;

-- سياق الهرمية لصفحة المشروع (Breadcrumb: الأب ← الابن)
create or replace function public.project_hierarchy_context(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_scope text; v_parent uuid; v_pname text; v_can boolean := false;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin
    select project_scope, parent_project_id into v_scope, v_parent from public.projects where id = p_project;
    if v_parent is not null then
      v_can := public.pc_can_read_project(v_parent);
      if v_can then select project_name into v_pname from public.projects where id = v_parent; end if;
    end if;
  exception when undefined_column then v_scope := 'standalone'; v_parent := null;
  end;
  return jsonb_build_object('project_id', p_project, 'project_scope', coalesce(v_scope,'standalone'),
    'parent_project_id', v_parent, 'parent_name', v_pname, 'parent_readable', v_can,
    'hierarchy_enabled', public.project_hierarchy_enabled(), 'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_context(uuid) from public, anon;
grant execute on function public.project_hierarchy_context(uuid) to authenticated;

comment on column public.projects.project_scope is '6A: standalone | master | subproject — هوية الهرمية (الواجهة: مستقل/رئيسي/فرعي).';
comment on function public.project_hierarchy_rollup(uuid) is '6A: تجميع الفروع للأب — مشتقّ فقط، لا يُكتب على progress_pct للأب (لا عدّ مزدوج).';

-- ════════════════════════════════════════════════════════════════════════════
-- §10) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_bad int;
begin
  if to_regclass('public.project_hierarchy_settings') is null then raise exception '6A FAIL: جدول العلم مفقود'; end if;
  if to_regprocedure('public.project_hierarchy_rollup(uuid)') is null or to_regprocedure('public.project_hierarchy_move_subproject(uuid,uuid,text)') is null
     or to_regprocedure('public.project_hierarchy_detach_subproject(uuid,text)') is null or to_regprocedure('public.pc_is_master(uuid)') is null
     then raise exception '6A FAIL: دوال ناقصة'; end if;
  -- الأعمدة والقيود
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='parent_project_id')
    then raise exception '6A FAIL: parent_project_id مفقود'; end if;
  select count(*) into v_bad from unnest(array['projects_scope_ck','projects_no_self_parent_ck','projects_scope_parent_ck']) k
    where not exists (select 1 from pg_constraint where conname = k);
  if v_bad > 0 then raise exception '6A FAIL: % قيد هرمية مفقود', v_bad; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_projects_hierarchy_guard') then raise exception '6A FAIL: حارس الهرمية مفقود'; end if;
  -- سلامة البيانات القائمة
  select count(*) into v_bad from public.projects where project_scope is null or project_scope not in ('standalone','master','subproject');
  if v_bad > 0 then raise exception '6A FAIL: % صف بنطاق غير صالح', v_bad; end if;
  select count(*) into v_bad from public.projects where project_scope <> 'subproject' and parent_project_id is not null;
  if v_bad > 0 then raise exception '6A FAIL: % صف غير فرعيّ يحمل أبًا', v_bad; end if;
  select count(*) into v_bad from public.projects where parent_project_id = id;
  if v_bad > 0 then raise exception '6A FAIL: مشروع أبٌ لنفسه'; end if;
  -- لا تُطبَّق الأعمدة المنحرفة من Batch 1 في هذا الملف (تُترك لأصحابها 3C/5C)
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='projects' and column_name in ('operational_stage','closure_status','progress_mode')) then
    raise notice '6A: أعمدة Batch 1 المنحرفة موجودة (تطبيق سابق) — 6A لا يقرأها؛ core_stage/5C/3C هي المصادر.';
  end if;
  raise notice '6A ✅ نجح الاختبار الذاتي — أعمدة/قيود/حارس/دوال/سلامة بيانات.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
