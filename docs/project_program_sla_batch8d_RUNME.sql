-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 8D — التزامات البرامج ومحرّك القياس ومصفوفة التسليم للعميل
--            (Program Commitments, SLA Measurement & Client Delivery Matrix)
--
-- ── ما أثبته التدقيق (قراءة فقط، ٦ محاور) قبل كتابة سطر واحد ────────────────
-- ١) لا يوجد أيّ نظام SLA أو التزامات أو مصفوفة تسليم في المستودع (١١٩ ترحيلًا).
--    الشيء الوحيد القائم هو approval_sla_hours في 5A ⇒ project_approvals.due_at.
--    فهذه الدفعة تبني من الصفر، وتعيد استخدام سابقة 5A (مخطَّط due_at + فعليّ
--    decided_at) بدل اختراع نمط جديد.
-- ٢) **الطوابع الزمنية الحقيقية** (مختومة من الخادم، صالحة للقياس):
--      · project_status_history.created_at (to_stage='delivered') ← التسليم الفعليّ
--      · project_activity.created_at عبر pc_log (معاملاتيّ، لا يبتلع خطأ)
--      · deliverable_reviews.created_at (+resolved_at) ← قرار **العميل** حصرًا
--      · project_deliverable_versions.approved_at ← اعتماد **الطاقم**
--      · project_deliverable_versions.created_at / deliverable_versions.uploaded_at
--      · deliverable_versions.final_master_uploaded_at
--      · project_approvals.requested_at / due_at / decided_at
--      · project_shoot_sessions.wrap_time ← انتهاء التصوير الفعليّ
--      · client_comments.created_at / resolved_at
--    **وطوابع مزيّفة يحرم استعمالها كـ«فعليّ»**:
--      · project_core.delivery_date — تاريخ مخطَّط يُكتب يدويًّا ولا يُختم (فخّ 8A)
--      · projects.actual_release_date — رغم اسمه: `date` من حقل إدخال يدويّ، كاتبه
--        الوحيد project_unit_metadata_upsert، ولا مُشغِّل يختمه (فخّ جديد مؤكَّد)
--      · activity_log — يبتلع كل استثناء (exception when others then null) ⇒
--        best-effort؛ نفضّل project_activity حيثما توفّر الاثنان.
-- ٣) العميل لا يمكنه اجتياز pc_can_read_project إطلاقًا (is_staff()=false له)،
--    فكل دالّة إدارية هنا محميّة تلقائيًّا. سطح العميل الوحيد دالّة واحدة ذات
--    بوّابة عميل صريحة (is_client_owner) لا تُوسِّع pc_can_read_project.
-- ٤) client_program_view_enabled كان علمًا ميتًا (يُكتب ولا يُقرأ) ⇒ 8D يمنحه
--    معناه الحقيقيّ داخل بوّابة الخادم لا في الواجهة.
--
-- ── ما لا تفعله هذه الدفعة ──────────────────────────────────────────────────
-- لا أسعار · لا عقود · لا Zoho · لا فواتير · لا مالية · لا عهدة · لا حذف بيانات ·
-- لا كتابة progress · لا core_stage جديد · لا نظام مهام/إغلاق/اعتماد موازٍ ·
-- لا إعادة تعريف can_access_project/pc_can_read_project/is_client_owner/is_client_side ·
-- لا مستوى هرميّ ثالث · لا توريث وصول من الأب إلى الفرع في شيفرة 8D (كل وحدة
-- تُفحَص بذاتها) · لا تخزين لنتيجة التزام أو علم خرق — كلّها مشتقّة.
--
-- ترتيب التشغيل: … 5A → 5B → 5C → 6A → 6B → 6C → 7A → 7B → 8A → 8B → 8C → **8D**.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '8D PREFLIGHT: pc_can_read_project مفقودة (Project Core غير مطبّق)'; end if;
  if to_regprocedure('public.program_can(uuid,text)') is null
    then raise exception '8D PREFLIGHT: 8A غير مطبّقة (program_can مفقودة)'; end if;
  if to_regclass('public.project_program_settings') is null
    then raise exception '8D PREFLIGHT: 8A غير مطبّقة (project_program_settings مفقود)'; end if;
  if to_regprocedure('public.pc_is_master(uuid)') is null
    then raise exception '8D PREFLIGHT: هرمية 6A غير مطبّقة (pc_is_master مفقودة)'; end if;
  if to_regclass('public.project_program_plan_runs') is null
    then raise exception '8D PREFLIGHT: 8B غير مطبّقة (project_program_plan_runs مفقود)'; end if;
  -- مصادر القياس الفعليّة: بلا سجلّ المراحل لا يوجد «تسليم فعليّ» أصلًا.
  if to_regclass('public.project_status_history') is null
    then raise exception '8D PREFLIGHT: project_status_history مفقود (لا مصدر تسليم فعليّ)'; end if;
  if to_regclass('public.project_activity') is null
    then raise exception '8D PREFLIGHT: project_activity مفقود (لا سجلّ أحداث معاملاتيّ)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='unit_number')
    then raise exception '8D PREFLIGHT: بيانات الوحدة (8A) مفقودة على projects'; end if;
  -- الاستدعاءات غير المحروسة باستثناء تُحلَّل وقت التنفيذ: غيابها يُسقط الدالّة كلّها،
  -- فنجعلها شرطًا صريحًا هنا بدل فشل غامض لاحقًا.
  if to_regprocedure('public.pc_project_closure_status(uuid)') is null
    then raise exception '8D PREFLIGHT: 5C غير مطبّقة (pc_project_closure_status مفقودة)'; end if;
  if to_regprocedure('public.is_client_owner(uuid)') is null
    then raise exception '8D PREFLIGHT: is_client_owner مفقودة (بوّابة العميل)'; end if;
  if to_regprocedure('public.ops_can_view()') is null or to_regprocedure('public.ops_visible_ids(jsonb)') is null
    then raise exception '8D PREFLIGHT: 7B غير مطبّقة (مركز العمليات)'; end if;
  if to_regprocedure('public.exec_visible_projects(jsonb)') is null
    then raise exception '8D PREFLIGHT: 5B غير مطبّقة (exec_visible_projects)'; end if;
  if to_regclass('public.deliverable_reviews') is null or to_regclass('public.client_comments') is null
    then raise exception '8D PREFLIGHT: جداول مراجعات/ملاحظات العميل مفقودة'; end if;
  if to_regclass('public.project_approvals') is null
    then raise exception '8D PREFLIGHT: project_approvals مفقود (زمن الاعتماد)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='project_shoot_sessions' and column_name='wrap_time')
    then raise exception '8D PREFLIGHT: project_shoot_sessions.wrap_time مفقود (زمن التسليم من التصوير)'; end if;
  -- أعمدة تُستعمل بلا حارس استثناء في القراءات: غيابها 42703 وقت التشغيل لا الترحيل.
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='client_comments' and column_name='status')
    then raise exception '8D PREFLIGHT: client_comments.status مفقود (deliverable_comments_resolution غير مطبّق)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='deliverable_reviews' and column_name='is_deleted')
    then raise exception '8D PREFLIGHT: deliverable_reviews.is_deleted مفقود'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='project_approvals' and column_name='is_deleted')
    then raise exception '8D PREFLIGHT: project_approvals.is_deleted مفقود'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الصلاحيات — مفتاحان فقط، ولكلٍّ نقطة إنفاذ فعلية في هذا الملف (درس 7A).
--     الفئة projects_tasks لأنها الفئة الوحيدة التي تعرضها شاشة الصلاحيات
--     (PERMISSION_CATEGORIES) — فئة جديدة تعني مفتاحًا غير قابل للمنح.
--     البوّابة نفسها هي program_can القائمة: مفتاح غير 'programs.view' لا يصير
--     true تلقائيًّا، بل يمرّ بـcan_manage_projects/emp_has_permission/can_edit_project.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice '8D: كتالوج الصلاحيات غير موجود — تخطّي المفاتيح'; return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
    ('programs.commitments.view','projects_tasks','normal', 970,'عرض التزامات البرنامج ومؤشّرات الالتزام','View program commitments & SLA'),
    ('programs.commitments.manage','projects_tasks','sensitive', 975,'إدارة التزامات البرنامج','Manage program commitments')
  on conflict (key) do nothing;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) جدول الالتزامات — الهدف فقط يُخزَّن. النتيجة والحالة والخرق كلّها مشتقّة.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_program_commitments (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  commitment_key  text not null,
  commitment_type text not null default 'custom'
                  check (commitment_type in ('total_unit_volume','periodic_unit_volume','monthly_output',
                        'on_time_delivery_rate','delivery_turnaround','review_turnaround',
                        'revision_turnaround','approval_turnaround','response_turnaround','custom')),
  name_ar         text not null,
  name_en         text,
  description     text,
  target_value    numeric check (target_value is null or target_value >= 0),
  target_unit     text not null default 'count'
                  check (target_unit in ('count','percent','hours','days','business_days','minutes')),
  period_type     text not null default 'project'
                  check (period_type in ('project','daily','weekly','monthly','quarterly','yearly','custom')),
  period_start    date,
  period_end      date,
  effective_from  date,
  effective_to    date,
  -- عتبتان بنفس وحدة الهدف. الاتجاه مشتقّ من النوع لا مخزَّن:
  -- نِسَب «كلّما زاد أفضل» (percent/count) ضدّ مُدد «كلّما قلّ أفضل» (hours/days/…).
  warning_threshold  numeric,
  critical_threshold numeric,
  measurement_source text,
  client_visible  boolean not null default false,
  is_active       boolean not null default true,
  version         int not null default 1,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  constraint ppc_period_chk check (period_end is null or period_start is null or period_end >= period_start),
  constraint ppc_effective_chk check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
-- مفتاح الالتزام فريد داخل البرنامج، وللأحياء فقط (الأرشفة لا تحجز المفتاح).
create unique index if not exists ux_ppc_project_key
  on public.project_program_commitments(project_id, commitment_key)
  where archived_at is null;
create index if not exists idx_ppc_project on public.project_program_commitments(project_id, is_active);

-- الالتزام للبرنامج (master) وحده — حارس على مستوى القاعدة لا على مستوى الـRPC فقط
-- (نفس عرف trg_program_settings_guard في 8A).
create or replace function public.program_commitment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- الأرشفة (إخفاء ناعم) تبقى ممكنة حتى لو خُفّض البرنامج لاحقًا إلى مستقل — وإلّا
  -- عَلِقت صفوفه غير قابلة للإدارة. الإنشاء والتعديل العاديّ يظلّان للـmaster وحده.
  if not (tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null)
     and not public.pc_is_master(new.project_id) then
    raise exception 'program_requires_master';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.program_commitment_guard() from public, anon, authenticated;
drop trigger if exists trg_program_commitment_guard on public.project_program_commitments;
create trigger trg_program_commitment_guard before insert or update on public.project_program_commitments
  for each row execute function public.program_commitment_guard();

-- RLS بعرف 5C (الأشدّ): قراءة للطاقم المصرَّح له فقط، ولا سياسة كتابة إطلاقًا،
-- مع نزع الكتابة صراحةً من authenticated حتى لا تفتحها سياسة `for all` سهوًا.
alter table public.project_program_commitments enable row level security;
drop policy if exists ppc_read on public.project_program_commitments;
create policy ppc_read on public.project_program_commitments for select to authenticated
  using (public.is_staff() and public.pc_can_read_project(project_id));
revoke all on public.project_program_commitments from anon;
revoke insert, update, delete on public.project_program_commitments from authenticated, anon;
grant select on public.project_program_commitments to authenticated;

comment on table public.project_program_commitments is
  '8D: أهداف التزام البرنامج فقط. النتيجة/الحالة/الخرق مشتقّة في project_program_commitment_results ولا تُخزَّن.';

-- ════════════════════════════════════════════════════════════════════════════
-- §3) كتابة الالتزامات — RPC ذرّي بقفل متفائل وتدقيق، بلا كتابة مباشرة للجدول.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_commitment_upsert(
  p_project uuid, p_data jsonb, p_expected_version int default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_key text; v_cur record; v_type text; v_unit text; v_period text;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not public.program_can(p_project, 'programs.commitments.manage') then raise exception 'not authorized'; end if;
  if not public.pc_is_master(p_project) then raise exception 'program_requires_master'; end if;

  v_key := nullif(btrim(p_data->>'commitment_key'),'');
  if v_key is null then raise exception 'commitment_key_required'; end if;
  if coalesce(btrim(p_data->>'name_ar'),'') = '' then raise exception 'name_required'; end if;
  v_type   := coalesce(nullif(p_data->>'commitment_type',''),'custom');
  v_unit   := coalesce(nullif(p_data->>'target_unit',''),'count');
  v_period := coalesce(nullif(p_data->>'period_type',''),'project');
  v_id := nullif(p_data->>'id','')::uuid;

  if v_id is not null then
    -- القفل قبل فحص النسخة: بلا FOR UPDATE يقرأ متزامنان النسخة نفسها فيمرّان معًا.
    select * into v_cur from public.project_program_commitments
      where id = v_id and project_id = p_project for update;
    if v_cur.id is null then raise exception 'not_found'; end if;
    if v_cur.archived_at is not null then raise exception 'commitment_archived'; end if;
    if p_expected_version is not null and p_expected_version <> v_cur.version
      then raise exception 'stale_update'; end if;

    update public.project_program_commitments set
      commitment_key  = v_key,
      commitment_type = v_type,
      name_ar         = btrim(p_data->>'name_ar'),
      name_en         = case when p_data ? 'name_en' then nullif(btrim(p_data->>'name_en'),'') else name_en end,
      description     = case when p_data ? 'description' then nullif(btrim(p_data->>'description'),'') else description end,
      target_value    = case when p_data ? 'target_value' then nullif(p_data->>'target_value','')::numeric else target_value end,
      target_unit     = v_unit,
      period_type     = v_period,
      period_start    = case when p_data ? 'period_start' then nullif(p_data->>'period_start','')::date else period_start end,
      period_end      = case when p_data ? 'period_end' then nullif(p_data->>'period_end','')::date else period_end end,
      effective_from  = case when p_data ? 'effective_from' then nullif(p_data->>'effective_from','')::date else effective_from end,
      effective_to    = case when p_data ? 'effective_to' then nullif(p_data->>'effective_to','')::date else effective_to end,
      warning_threshold  = case when p_data ? 'warning_threshold' then nullif(p_data->>'warning_threshold','')::numeric else warning_threshold end,
      critical_threshold = case when p_data ? 'critical_threshold' then nullif(p_data->>'critical_threshold','')::numeric else critical_threshold end,
      measurement_source = case when p_data ? 'measurement_source' then nullif(btrim(p_data->>'measurement_source'),'') else measurement_source end,
      client_visible  = case when p_data ? 'client_visible' then (p_data->>'client_visible')::boolean else client_visible end,
      is_active       = case when p_data ? 'is_active' then (p_data->>'is_active')::boolean else is_active end,
      version         = version + 1,
      updated_by      = auth.uid(),
      updated_at      = now()
    where id = v_id;
    perform public.pc_log(p_project, 'program_commitment_updated', 'project', p_project,
      jsonb_build_object('commitment_id', v_id, 'key', v_key, 'type', v_type));
  else
    insert into public.project_program_commitments(
      project_id, commitment_key, commitment_type, name_ar, name_en, description,
      target_value, target_unit, period_type, period_start, period_end,
      effective_from, effective_to, warning_threshold, critical_threshold,
      measurement_source, client_visible, is_active, created_by, updated_by)
    values (p_project, v_key, v_type, btrim(p_data->>'name_ar'),
      nullif(btrim(p_data->>'name_en'),''), nullif(btrim(p_data->>'description'),''),
      nullif(p_data->>'target_value','')::numeric, v_unit, v_period,
      nullif(p_data->>'period_start','')::date, nullif(p_data->>'period_end','')::date,
      nullif(p_data->>'effective_from','')::date, nullif(p_data->>'effective_to','')::date,
      nullif(p_data->>'warning_threshold','')::numeric, nullif(p_data->>'critical_threshold','')::numeric,
      nullif(btrim(p_data->>'measurement_source'),''),
      coalesce((p_data->>'client_visible')::boolean, false),
      coalesce((p_data->>'is_active')::boolean, true), auth.uid(), auth.uid())
    returning id into v_id;
    perform public.pc_log(p_project, 'program_commitment_created', 'project', p_project,
      jsonb_build_object('commitment_id', v_id, 'key', v_key, 'type', v_type));
  end if;

  select * into v_cur from public.project_program_commitments where id = v_id;
  return jsonb_build_object('ok', true, 'commitment_id', v_id, 'version', v_cur.version);
exception
  when unique_violation then raise exception 'duplicate_commitment_key';
end $$;
revoke execute on function public.project_program_commitment_upsert(uuid,jsonb,int) from public, anon;
grant execute on function public.project_program_commitment_upsert(uuid,jsonb,int) to authenticated;

-- الأرشفة إخفاء ناعم — لا حذف ولا تعديل صامت لسجلّ تاريخيّ.
create or replace function public.project_program_commitment_archive(p_commitment uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cur record;
begin
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into v_cur from public.project_program_commitments where id = p_commitment for update;
  if v_cur.id is null then raise exception 'not_found'; end if;
  if not public.pc_can_read_project(v_cur.project_id) then raise exception 'not authorized'; end if;
  if not public.program_can(v_cur.project_id, 'programs.commitments.manage') then raise exception 'not authorized'; end if;
  if v_cur.archived_at is not null then raise exception 'already_archived'; end if;

  update public.project_program_commitments
     set archived_at = now(), is_active = false, version = version + 1,
         updated_by = auth.uid(), updated_at = now()
   where id = p_commitment;
  perform public.pc_log(v_cur.project_id, 'program_commitment_archived', 'project', v_cur.project_id,
    jsonb_build_object('commitment_id', p_commitment, 'key', v_cur.commitment_key, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'commitment_id', p_commitment);
end $$;
revoke execute on function public.project_program_commitment_archive(uuid,text) from public, anon;
grant execute on function public.project_program_commitment_archive(uuid,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) المُثبِّت الوحيد لـ«التسليم الفعليّ» — مُساعد داخليّ لا يُمنح لأحد.
--     يُشتقّ من project_status_history (مختوم من الخادم داخل كل RPC للمرحلة)،
--     ويشترط أن يكون المشروع فعلًا في delivered/closed الآن حتى لا يُحتسب مرورٌ
--     عابر بالمرحلة ثم رجوع. غياب الصفّ ⇒ NULL ⇒ «غير متاح» لا صفر.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pgm_unit_delivered_at(p_project uuid)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v_stage text; v_at timestamptz;
begin
  select core_stage into v_stage from public.project_core where project_id = p_project;
  if coalesce(v_stage,'') not in ('delivered','closed') then return null; end if;
  select min(created_at) into v_at from public.project_status_history
   where project_id = p_project and to_stage = 'delivered';
  return v_at;   -- قد تبقى NULL لو قفز المالك المرحلة: «غير متاح» لا تاريخ ملفَّق
end $$;
revoke execute on function public.pgm_unit_delivered_at(uuid) from public, anon, authenticated;
comment on function public.pgm_unit_delivered_at(uuid) is
  '8D: التسليم الفعليّ = أول انتقال موثَّق إلى delivered، وبشرط أن تكون المرحلة الحالية delivered/closed. لا يستعمل delivery_date اليدويّ.';

-- ════════════════════════════════════════════════════════════════════════════
-- §5) محرّك القياس — نداء واحد لكل التزامات البرنامج. كل نتيجة تعلن معادلتها
--     وبسطها ومقامها وحجم عيّنتها وجودة مصدرها، وتُرجع unavailable بدل رقم ملفَّق.
-- ════════════════════════════════════════════════════════════════════════════
-- المُحرِّك الداخليّ **غير المحروس** — يُستدعى فقط بعد بوّابة صريحة من مُستدعيه.
-- p_client_view: false ⇒ رؤية الطاقم لكل وحدة (pc_can_read_project)، true ⇒ رؤية
-- العميل (is_client_owner). فصل المنطق عن البوّابة يتيح سطح العميل بلا استعارة
-- بوّابة الطاقم (التي لا يمرّ بها العميل أبدًا) وبلا توسيع pc_can_read_project.
create or replace function public.pgm_commitment_results_core(
  p_project uuid, p_from date, p_to date, p_client_view boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  c record; v_out jsonb := '[]'::jsonb;
  v_from date; v_to date;
  v_num numeric; v_den numeric; v_actual numeric; v_n int;
  v_status text; v_formula text; v_formula_ar text; v_quality text; v_missing text;
  v_variance numeric; v_higher_better boolean;
  v_units int; v_all_units int; v_is_duration boolean;
begin
  for c in
    select * from public.project_program_commitments
     where project_id = p_project and archived_at is null and is_active = true
     order by commitment_type, commitment_key
  loop
    -- نافذة القياس: الوسيطة تفوز، ثمّ نافذة الالتزام، ثمّ نوع الفترة حول اليوم.
    v_from := coalesce(p_from, c.period_start,
      case c.period_type when 'daily'     then v_today
                         when 'weekly'    then date_trunc('week',  v_today)::date
                         when 'monthly'   then date_trunc('month', v_today)::date
                         when 'quarterly' then date_trunc('quarter', v_today)::date
                         when 'yearly'    then date_trunc('year',  v_today)::date
                         else null end);
    v_to := coalesce(p_to, c.period_end,
      case c.period_type when 'daily'     then v_today
                         when 'weekly'    then (date_trunc('week',  v_today) + interval '6 days')::date
                         when 'monthly'   then (date_trunc('month', v_today) + interval '1 month - 1 day')::date
                         when 'quarterly' then (date_trunc('quarter', v_today) + interval '3 months - 1 day')::date
                         when 'yearly'    then (date_trunc('year',  v_today) + interval '1 year - 1 day')::date
                         else null end);
    v_num := null; v_den := null; v_actual := null; v_n := 0;
    v_quality := 'measured'; v_missing := null; v_higher_better := true;
    v_formula := c.commitment_type; v_formula_ar := null; v_is_duration := false;

    -- النوع الدوريّ يزوّد نافذته بنفسه إن لم تُحسم (المعالج قد يترك الفترة «على
    -- المشروع كاملًا») — وإلّا لا نافذة ⇒ لا رقم (لا صفر مكان المجهول).
    if c.commitment_type in ('periodic_unit_volume','monthly_output') and (v_from is null or v_to is null) then
      v_from := coalesce(v_from, date_trunc('month', v_today)::date);
      v_to   := coalesce(v_to,  (date_trunc('month', v_today) + interval '1 month - 1 day')::date);
    end if;

    -- سريان الالتزام يقصّ النافذة (لا نقيس خارج مدّة الالتزام).
    if c.effective_from is not null then v_from := greatest(coalesce(v_from, c.effective_from), c.effective_from); end if;
    if c.effective_to   is not null then v_to   := least(coalesce(v_to,   c.effective_to),   c.effective_to);   end if;
    -- نافذة مقلوبة (سريان يقصّها إلى العدم) ⇒ لا قياس بدل صفر ملفَّق.
    if v_from is not null and v_to is not null and v_from > v_to then
      v_quality := 'unavailable'; v_missing := 'measurement_window_empty';
    end if;

    -- ═══ (أ) حجم الوحدات — كلّي أو دوريّ/شهريّ ═══
    if c.commitment_type in ('total_unit_volume','periodic_unit_volume','monthly_output') then
      v_higher_better := true;
      if v_quality = 'measured' then
      -- التسليم يُحسب مرّة واحدة لكل وحدة (LATERAL) لا ثلاثًا داخل filter.
      -- v_all_units يعدّ **كل** الأبناء (بلا فلتر رؤية) لكشف الرؤية الجزئية: بسط
      -- محكوم بالرؤية ومقام = هدف ثابت كان يُنتِج نقصًا وهميًّا لمن لا يرى كل الوحدات.
      -- المقام يبقى بلا فلتر رؤية (v_all_units) لكشف الرؤية الجزئية؛ البسط وعدد
      -- الوحدات المرئية يحملان مُحدِّد الرؤية بأنفسهما داخل الـFILTER. بلا هذا كان
      -- v_all_units = v_units دائمًا فيموت فرع «الرؤية الجزئية».
      select count(*) filter (where vis.ok and u.delivered_at is not null
              and (c.commitment_type = 'total_unit_volume'
                   or (u.delivered_at at time zone 'Asia/Riyadh')::date between v_from and v_to)),
             count(*) filter (where vis.ok),
             count(*)
        into v_num, v_units, v_all_units
      from public.projects ch
      cross join lateral (select public.pgm_unit_delivered_at(ch.id) as delivered_at) u
      cross join lateral (select (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
                                       else public.pc_can_read_project(ch.id) end) as ok) vis
      where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false;
      v_actual := v_num; v_den := c.target_value; v_n := v_units;
      v_formula := case c.commitment_type when 'total_unit_volume' then 'units_delivered_total'
                                          else 'units_delivered_in_period' end;
      v_formula_ar := case c.commitment_type
        when 'total_unit_volume' then 'عدد الوحدات التي بلغت مرحلة «مُسلَّم» فعليًّا (سجلّ المراحل) ÷ الهدف'
        else 'عدد الوحدات المسلَّمة فعليًّا داخل الفترة (بتوقيت الرياض) ÷ الهدف' end;
      if v_units = 0 then
        v_quality := 'unavailable'; v_missing := 'no_units'; v_actual := null; v_num := null;
      elsif v_all_units is not null and v_units < v_all_units then
        -- رؤية جزئية: نُبلّغ صراحةً بدل رقم يبدو كاملًا.
        v_quality := 'partial'; v_missing := 'partial_unit_visibility';
      end if;
      end if;

    -- ═══ (ب) نسبة التسليم في الموعد ═══
    elsif c.commitment_type = 'on_time_delivery_rate' then
      v_higher_better := true;
      if v_quality = 'measured' then
      -- المقام: الوحدات التي تملك **موعدًا مخطَّطًا** و**تسليمًا فعليًّا داخل النافذة** معًا.
      -- v_from/v_to تُطبَّق على تاريخ التسليم الفعليّ (كبقيّة المقاييس)؛ بلا ذلك كانت
      -- النسبة عمريّة رغم إعلانها فترةً محدَّدة.
      select count(*) filter (where d.planned is not null and d.in_window),
             count(*) filter (where d.planned is not null and d.in_window
                                and (d.actual at time zone 'Asia/Riyadh')::date <= d.planned),
             count(*)
        into v_den, v_num, v_units
      from (
        select ch.id,
               coalesce(ch.planned_release_date, pc.due_date) as planned,
               u.actual,
               (u.actual is not null
                and (v_from is null or (u.actual at time zone 'Asia/Riyadh')::date >= v_from)
                and (v_to   is null or (u.actual at time zone 'Asia/Riyadh')::date <= v_to)) as in_window
        from public.projects ch
        left join public.project_core pc on pc.project_id = ch.id
        cross join lateral (select public.pgm_unit_delivered_at(ch.id) as actual) u
        where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
          and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
      ) d;
      v_n := coalesce(v_den,0)::int;
      v_formula := 'on_time_delivery_rate';
      v_formula_ar := 'الوحدات المسلَّمة في موعدها أو قبله ÷ الوحدات ذات موعد مخطَّط وتسليم فعليّ داخل نافذة القياس (بتوقيت الرياض، المئوية)';
      if coalesce(v_den,0) = 0 then
        v_quality := 'unavailable';
        v_missing := case when v_units = 0 then 'no_units' else 'no_unit_has_both_planned_and_actual' end;
      else
        v_actual := round(v_num / v_den * 100, 1);   -- المقام موجب هنا حتمًا
      end if;
      end if;

    -- ═══ (ج) زمن التسليم من انتهاء التصوير ═══
    elsif c.commitment_type = 'delivery_turnaround' then
      v_higher_better := false; v_is_duration := true;
      select avg(extract(epoch from (d.actual - d.wrapped)) / 3600.0), count(*)
        into v_actual, v_n
      from (
        select public.pgm_unit_delivered_at(ch.id) as actual,
               (select max(s.wrap_time) from public.project_shoot_sessions s
                 where s.project_id = ch.id and coalesce(s.is_deleted,false) = false
                   and s.status = 'completed' and s.wrap_time is not null) as wrapped
        from public.projects ch
        where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
          and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
      ) d
      where d.actual is not null and d.wrapped is not null and d.actual >= d.wrapped
        and (v_from is null or (d.actual at time zone 'Asia/Riyadh')::date >= v_from)
        and (v_to   is null or (d.actual at time zone 'Asia/Riyadh')::date <= v_to);
      v_num := v_actual; v_den := c.target_value;
      v_formula := 'hours_from_shoot_wrap_to_delivered';
      v_formula_ar := 'متوسّط الساعات من آخر انتهاء تصوير موثَّق (wrap_time لجلسة مكتملة) إلى التسليم الفعليّ';
      if v_n = 0 then v_quality := 'unavailable'; v_missing := 'shoot_wrap_or_delivery_not_recorded'; v_actual := null; end if;

    -- ═══ (د) زمن مراجعة العميل: من الإرسال إليه إلى قراره ═══
    elsif c.commitment_type = 'review_turnaround' then
      v_higher_better := false; v_is_duration := true;
      select avg(extract(epoch from (r.decided - r.sent)) / 3600.0), count(*)
        into v_actual, v_n
      from (
        select rv.created_at as decided,
               (select max(a.created_at) from public.project_activity a
                 where a.project_id = ch.id and a.action = 'deliverable_sent_client'
                   and a.entity_id = dl.id and a.created_at <= rv.created_at) as sent
        from public.projects ch
        join public.deliverables dl on dl.project_id = ch.id and coalesce(dl.is_deleted,false) = false
        join public.deliverable_reviews rv on rv.deliverable_id = dl.id and coalesce(rv.is_deleted,false) = false
        where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
          and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
          and (v_from is null or (rv.created_at at time zone 'Asia/Riyadh')::date >= v_from)
          and (v_to   is null or (rv.created_at at time zone 'Asia/Riyadh')::date <= v_to)
      ) r
      where r.sent is not null and r.decided >= r.sent;
      v_num := v_actual; v_den := c.target_value;
      v_formula := 'hours_from_sent_to_client_to_client_decision';
      v_formula_ar := 'متوسّط الساعات من إرسال النسخة للعميل (سجلّ deliverable_sent_client) إلى قرار العميل (deliverable_reviews)';
      if v_n = 0 then v_quality := 'unavailable'; v_missing := 'no_send_event_paired_with_a_client_decision'; v_actual := null; end if;

    -- ═══ (هـ) زمن التعديل: من طلب العميل تعديلًا إلى رفع نسخة جديدة ═══
    elsif c.commitment_type = 'revision_turnaround' then
      v_higher_better := false; v_is_duration := true;
      select avg(extract(epoch from (x.next_version - x.asked)) / 3600.0), count(*)
        into v_actual, v_n
      from (
        select rv.created_at as asked,
               least(
                 (select min(pv.created_at) from public.project_deliverable_versions pv
                   where pv.deliverable_id = dl.id and pv.created_at > rv.created_at),
                 (select min(dv.uploaded_at) from public.deliverable_versions dv
                   where dv.deliverable_id = dl.id and coalesce(dv.is_deleted,false) = false
                     and dv.uploaded_at > rv.created_at
                     and (nullif(btrim(coalesce(dv.preview_url,'')),'') is not null
                       or nullif(btrim(coalesce(dv.vimeo_video_id,'')),'') is not null
                       or nullif(btrim(coalesce(dv.vimeo_review_url,'')),'') is not null))
               ) as next_version
        from public.projects ch
        join public.deliverables dl on dl.project_id = ch.id and coalesce(dl.is_deleted,false) = false
        join public.deliverable_reviews rv on rv.deliverable_id = dl.id and rv.decision = 'revision_requested'
                                                    and coalesce(rv.is_deleted,false) = false
        where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
          and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
          and (v_from is null or (rv.created_at at time zone 'Asia/Riyadh')::date >= v_from)
          and (v_to   is null or (rv.created_at at time zone 'Asia/Riyadh')::date <= v_to)
      ) x
      where x.next_version is not null;
      v_num := v_actual; v_den := c.target_value;
      v_formula := 'hours_from_revision_requested_to_next_version';
      v_formula_ar := 'متوسّط الساعات من طلب العميل تعديلًا إلى رفع النسخة التالية (أيّ مسار نسخ، وبمرجع أصل حقيقيّ)';
      if v_n = 0 then v_quality := 'unavailable'; v_missing := 'no_revision_followed_by_a_new_version'; v_actual := null; end if;

    -- ═══ (و) زمن الاعتماد — يعيد استخدام آليّة 5A كاملةً ═══
    elsif c.commitment_type = 'approval_turnaround' then
      v_higher_better := false; v_is_duration := true;
      select avg(extract(epoch from (ap.decided_at - ap.requested_at)) / 3600.0), count(*)
        into v_actual, v_n
      from public.projects ch
      join public.project_approvals ap on ap.project_id = ch.id and coalesce(ap.is_deleted,false) = false
      where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
        and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
        and ap.decided_at is not null and ap.requested_at is not null
        and ap.decided_at >= ap.requested_at
        and (v_from is null or (ap.decided_at at time zone 'Asia/Riyadh')::date >= v_from)
        and (v_to   is null or (ap.decided_at at time zone 'Asia/Riyadh')::date <= v_to);
      v_num := v_actual; v_den := c.target_value;
      v_formula := 'hours_from_approval_requested_to_decided';
      v_formula_ar := 'متوسّط الساعات من طلب الاعتماد (requested_at) إلى القرار (decided_at) — مصدر 5A';
      if v_n = 0 then v_quality := 'unavailable'; v_missing := 'no_decided_approval_in_period'; v_actual := null; end if;

    -- ═══ (ز) زمن الاستجابة لملاحظات العميل ═══
    elsif c.commitment_type = 'response_turnaround' then
      v_higher_better := false; v_is_duration := true;
      begin
        select avg(extract(epoch from (cc.resolved_at - cc.created_at)) / 3600.0), count(*)
          into v_actual, v_n
        from public.projects ch
        join public.deliverables dl on dl.project_id = ch.id and coalesce(dl.is_deleted,false) = false
        join public.client_comments cc on cc.deliverable_id = dl.id and coalesce(cc.is_deleted,false) = false
        where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
          and (case when p_client_view then coalesce(public.is_client_owner(ch.id),false)
             else public.pc_can_read_project(ch.id) end)
          and cc.resolved_at is not null and cc.resolved_at >= cc.created_at
          and (v_from is null or (cc.resolved_at at time zone 'Asia/Riyadh')::date >= v_from)
          and (v_to   is null or (cc.resolved_at at time zone 'Asia/Riyadh')::date <= v_to);
      exception when undefined_table or undefined_column then
        v_actual := null; v_n := 0; v_quality := 'unavailable'; v_missing := 'client_comments_source_unavailable';
      end;
      v_num := v_actual; v_den := c.target_value;
      v_formula := 'hours_from_client_comment_to_resolution';
      v_formula_ar := 'متوسّط الساعات من ملاحظة العميل إلى معالجتها (client_comments.resolved_at)';
      if v_n = 0 and v_missing is null then v_quality := 'unavailable'; v_missing := 'no_resolved_client_comment_in_period'; v_actual := null; end if;

    -- ═══ (ح) مخصّص — لا معادلة معلنة ⇒ لا رقم. صراحةً. ═══
    else
      v_quality := 'unavailable'; v_missing := 'custom_commitment_has_no_declared_formula';
      v_formula := 'custom'; v_formula_ar := 'التزام مخصّص: يُتابَع يدويًّا ولا يُحسب آليًّا';
    end if;

    -- ═══ تحويل الوحدة: المدد تُقاس بالساعات، فنحوّلها إلى وحدة الهدف المعلنة قبل
    --     أيّ مقارنة. الوحدات غير القابلة للتعبير عن مدّة (count/percent/يوم عمل)
    --     تُرفض صراحةً بدل مقارنة ساعات بعدد. ═══
    if v_is_duration and v_actual is not null and v_quality <> 'unavailable' then
      if    c.target_unit = 'hours'   then null;                       -- كما هي
      elsif c.target_unit = 'minutes' then v_actual := v_actual * 60.0;
      elsif c.target_unit = 'days'    then v_actual := v_actual / 24.0;
      else v_quality := 'unavailable'; v_missing := 'target_unit_incompatible_with_duration';
           v_actual := null; end if;
      v_num := v_actual;   -- البسط يتبع القيمة المحوَّلة
    end if;

    -- ═══ الحالة: تُقاس بالعتبات، واتجاهها مشتقّ من وحدة الهدف لا مخزَّن ═══
    if v_quality = 'unavailable' or v_actual is null then
      v_status := 'unavailable';
    elsif c.target_value is null then
      v_status := 'unavailable'; v_missing := coalesce(v_missing, 'no_target_value');
    elsif v_n = 0 then
      v_status := 'not_started';
    else
      if v_higher_better then
        v_status := case
          when v_actual >= c.target_value then 'met'
          when c.critical_threshold is not null and v_actual < c.critical_threshold then 'breached'
          when c.warning_threshold  is not null and v_actual < c.warning_threshold  then 'warning'
          when c.critical_threshold is null and c.warning_threshold is null then 'warning'
          else 'warning' end;
      else
        v_status := case
          when v_actual <= c.target_value then 'met'
          when c.critical_threshold is not null and v_actual > c.critical_threshold then 'breached'
          when c.warning_threshold  is not null and v_actual > c.warning_threshold  then 'warning'
          when c.critical_threshold is null and c.warning_threshold is null then 'warning'
          else 'warning' end;
      end if;
    end if;
    v_variance := case when v_actual is null or c.target_value is null then null
                       else round(v_actual - c.target_value, 2) end;

    v_out := v_out || jsonb_build_object(
      'commitment_id', c.id, 'commitment_key', c.commitment_key, 'commitment_type', c.commitment_type,
      'name_ar', c.name_ar, 'name_en', c.name_en, 'client_visible', c.client_visible,
      'target', c.target_value, 'actual', case when v_actual is null then null else round(v_actual, 2) end,
      'numerator', case when v_num is null then null else round(v_num, 2) end,
      'denominator', case when v_den is null then null else round(v_den, 2) end,
      'unit', c.target_unit, 'status', v_status, 'variance', v_variance,
      'higher_is_better', v_higher_better,
      'formula_key', v_formula, 'formula_ar', v_formula_ar,
      'sample_size', v_n, 'period_from', v_from, 'period_to', v_to,
      'source_quality', v_quality, 'missing_data_reason', v_missing,
      'warning_threshold', c.warning_threshold, 'critical_threshold', c.critical_threshold,
      'generated_at', now());
  end loop;

  return jsonb_build_object('project_id', p_project, 'results', v_out,
    'today', v_today, 'generated_at', now(),
    'timezone_note', 'الحسابات بـtimestamptz والمقارنات اليومية بتوقيت Asia/Riyadh');
end $$;
revoke execute on function public.pgm_commitment_results_core(uuid,date,date,boolean) from public, anon, authenticated;
comment on function public.pgm_commitment_results_core(uuid,date,date,boolean) is
  '8D: مُحرِّك القياس الداخليّ غير المحروس — لا يُمنح لأحد؛ يُستدعى فقط بعد بوّابة صريحة من مُستدعيه.';

-- الواجهة العامّة المحروسة (رؤية الطاقم) — بوّابتها صريحة قبل استدعاء المُحرِّك.
create or replace function public.project_program_commitment_results(
  p_project uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not public.program_can(p_project, 'programs.commitments.view') then raise exception 'not authorized'; end if;
  return public.pgm_commitment_results_core(p_project, p_from, p_to, false);
end $$;
revoke execute on function public.project_program_commitment_results(uuid,date,date) from public, anon;
grant execute on function public.project_program_commitment_results(uuid,date,date) to authenticated;
comment on function public.project_program_commitment_results(uuid,date,date) is
  '8D: نتائج الالتزامات (رؤية الطاقم) — مشتقّة بالكامل، كل نتيجة تعلن معادلتها ومقامها وحجم عيّنتها، وunavailable بدل رقم ملفَّق.';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) توقّع الخرق — مشتقّ ومشروط. لا يظهر توقّع بلا عيّنة كافية ولا بمعدّل صفريّ،
--     ولا يُنتِج تاريخًا غير منطقيّ، ولا يُخزَّن علم خرق البتّة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_sla_forecast(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_res jsonb; r jsonb; v_out jsonb := '[]'::jsonb;
  v_breached int := 0; v_warning int := 0; v_unavailable int := 0; v_met int := 0;
  v_rate numeric; v_remaining numeric; v_days numeric; v_eta date;
  v_fstatus text; v_freason text; v_start date; v_last date; v_delivered numeric;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not public.program_can(p_project, 'programs.commitments.view') then raise exception 'not authorized'; end if;

  v_res := public.project_program_commitment_results(p_project, null, null);
  for r in select * from jsonb_array_elements(v_res->'results') loop
    if    (r->>'status') = 'breached'    then v_breached := v_breached + 1;
    elsif (r->>'status') = 'warning'     then v_warning := v_warning + 1;
    elsif (r->>'status') = 'unavailable' then v_unavailable := v_unavailable + 1;
    elsif (r->>'status') = 'met'         then v_met := v_met + 1; end if;

    v_fstatus := 'unavailable'; v_freason := null; v_eta := null; v_rate := null;
    -- التوقّع لحجم الوحدات وحده: المعادلة قابلة للتفسير وقابلة للتحقّق.
    if (r->>'commitment_type') = 'total_unit_volume' and (r->>'target') is not null then
      v_delivered := (r->>'actual')::numeric;
      -- المعدّل غير المتحيّز: (n-١) فاصلًا زمنيًّا على المدى من أوّل تسليم إلى آخره،
      -- لا n تسليمًا على المدى من الأوّل إلى اليوم (الذي يخلط نقطة النهاية بالبداية).
      select (min(u.at) at time zone 'Asia/Riyadh')::date,
             (max(u.at) at time zone 'Asia/Riyadh')::date
        into v_start, v_last
        from public.projects ch
        cross join lateral (select public.pgm_unit_delivered_at(ch.id) as at) u
       where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
         and public.pc_can_read_project(ch.id) and u.at is not null;
      v_days := case when v_start is null or v_last is null then null else greatest(v_last - v_start, 0) end;
      if coalesce(v_delivered,0) < 3 then
        v_freason := 'sample_size_below_minimum';           -- أقلّ من ٣ تسليمات: لا معدّل موثوق
      elsif v_start is null or coalesce(v_days,0) < 14 then
        v_freason := 'measurement_window_too_short';        -- امتداد التسليمات أقلّ من أسبوعين
      else
        v_rate := (v_delivered - 1) / (v_days / 30.0);      -- فواصل/٣٠ يومًا (المقام موجب هنا)
        v_remaining := (r->>'target')::numeric - v_delivered;
        if v_remaining <= 0 then
          v_fstatus := 'target_reached'; v_freason := null;
        elsif v_rate <= 0 then
          v_freason := 'zero_delivery_rate';
        else
          -- نفحص عدد الأيام المتبقّية قبل تحويله إلى تاريخ حتى لا يفيض ::int/التاريخ
          -- لهدف مبالَغ فيه — السقف يُطبَّق على العدد لا بعد بناء التاريخ.
          v_days := (v_remaining / v_rate) * 30.0;      -- إعادة استعمال v_days كأيام متبقّية
          if v_days > 1825 then v_eta := null; v_freason := 'projection_beyond_reasonable_horizon';
          else v_eta := v_today + v_days::int; v_fstatus := 'projected'; end if;
        end if;
      end if;
    else
      v_freason := 'forecast_not_defined_for_this_commitment_type';
    end if;

    v_out := v_out || jsonb_build_object(
      'commitment_id', r->'commitment_id', 'commitment_key', r->>'commitment_key',
      'name_ar', r->>'name_ar', 'status', r->>'status',
      'currently_breached', (r->>'status') = 'breached',
      'approaching_warning', (r->>'status') = 'warning',
      'forecast_status', v_fstatus, 'forecast_reason', v_freason,
      'forecast_rate_per_30d', case when v_rate is null then null else round(v_rate, 2) end,
      'forecasted_completion', v_eta,
      'forecasted_breach', case when v_fstatus <> 'projected' then null
        else (v_eta is not null and (select period_end from public.project_program_commitments
                                      where id = (r->>'commitment_id')::uuid) is not null
              and v_eta > (select period_end from public.project_program_commitments
                            where id = (r->>'commitment_id')::uuid)) end,
      'formula_ar', 'المعدّل = (عدد التسليمات − ١) ÷ (امتداد التسليمات بالأيام ÷ ٣٠). التاريخ المتوقَّع = اليوم + (المتبقّي ÷ المعدّل × ٣٠).');
  end loop;

  return jsonb_build_object('project_id', p_project, 'forecasts', v_out,
    'counters', jsonb_build_object('met', v_met, 'warning', v_warning,
      'breached', v_breached, 'unavailable', v_unavailable),
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_program_sla_forecast(uuid) from public, anon;
grant execute on function public.project_program_sla_forecast(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) مصفوفة التسليم — صفّ لكل وحدة. الترقيم **داخل** الـCTE فلا تُنفَّذ الاستعلامات
--     المرتبطة إلا لصفحة واحدة (درس 6B)، وpc_can_read_project لكل صفّ، وأبناء
--     مباشرون فقط (لا مستوى ثالث).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_delivery_matrix(
  p_project uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int, 0), 0);
  v_status text := nullif(p_filters->>'status','');
  v_stage  text := nullif(p_filters->>'core_stage','');
  v_season int  := nullif(p_filters->>'season_number','')::int;
  v_batch  int  := nullif(p_filters->>'batch_number','')::int;
  v_ws     text := nullif(p_filters->>'workstream','');
  v_mgr    uuid := nullif(p_filters->>'manager_id','')::uuid;
  v_search text := nullif(btrim(p_filters->>'search'),'');
  v_rows jsonb; v_total int;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not public.program_can(p_project, 'programs.view') then raise exception 'not authorized'; end if;

  with visible as (
    select ch.id, ch.project_name, ch.unit_number, ch.unit_code, ch.unit_type,
           ch.season_number, ch.batch_number, ch.workstream,
           ch.planned_release_date, ch.sequence_number,
           pc.core_stage, pc.progress_pct, pc.health, pc.start_date, pc.due_date,
           public.pgm_unit_delivered_at(ch.id) as delivered_at
    from public.projects ch
    left join public.project_core pc on pc.project_id = ch.id
    where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
      and public.pc_can_read_project(ch.id)
      and (v_stage  is null or pc.core_stage = v_stage)
      and (v_season is null or ch.season_number = v_season)
      and (v_batch  is null or ch.batch_number = v_batch)
      and (v_ws     is null or ch.workstream = v_ws)
      and (v_search is null or ch.project_name ilike '%'||v_search||'%'
           or coalesce(ch.unit_code,'') ilike '%'||v_search||'%')
  ), enriched as (
    select v.*,
      (select pr.full_name from public.project_members m
         join public.profiles pr on pr.id = m.user_id
        where m.project_id = v.id and m.role = 'kian_manager' and coalesce(m.is_deleted,false)=false
        order by m.created_at limit 1) as manager_name,
      (select m.user_id from public.project_members m
        where m.project_id = v.id and m.role = 'kian_manager' and coalesce(m.is_deleted,false)=false
        order by m.created_at limit 1) as manager_id
    from visible v
  ), filtered as (
    select * from enriched e
     where (v_mgr is null or e.manager_id = v_mgr)
       and (v_status is null
            or (v_status = 'late'            and e.delivered_at is null
                                              and coalesce(e.planned_release_date, e.due_date) is not null
                                              and coalesce(e.planned_release_date, e.due_date) < v_today)
            or (v_status = 'delivered'       and e.delivered_at is not null)
            or (v_status = 'closed'          and e.core_stage = 'closed')
            or (v_status = 'awaiting_client' and e.core_stage = 'client_review')
            or (v_status = 'no_planned_date' and e.planned_release_date is null and e.due_date is null)
            or (v_status = 'unavailable_data' and e.delivered_at is null
                and e.core_stage in ('delivered','closed')))
  ), counted as (select count(*) as n from filtered),
  page as (
    select * from filtered
     order by unit_number nulls last, sequence_number nulls last, project_name
     limit v_limit offset v_offset
  )
  select (select n from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'project_id', p.id, 'project_name', p.project_name,
           'unit_number', p.unit_number, 'unit_code', p.unit_code, 'unit_type', p.unit_type,
           'season_number', p.season_number, 'batch_number', p.batch_number, 'workstream', p.workstream,
           'core_stage', p.core_stage, 'progress_pct', p.progress_pct, 'health', p.health,
           'manager_id', p.manager_id, 'manager_name', p.manager_name,
           'planned_start', p.start_date, 'planned_end', p.due_date,
           'planned_release_date', p.planned_release_date,
           -- التسليم الفعليّ الوحيد الموثوق. NULL = لم يُوثَّق، لا «اليوم».
           'actual_delivery_at', p.delivered_at,
           'days_early_late', case when p.delivered_at is null
                                     or coalesce(p.planned_release_date, p.due_date) is null then null
             else ((p.delivered_at at time zone 'Asia/Riyadh')::date
                   - coalesce(p.planned_release_date, p.due_date)) end,
           'deliverables_total', (select count(*) from public.deliverables d
                                   where d.project_id = p.id and coalesce(d.is_deleted,false)=false),
           'current_deliverable', (select jsonb_build_object('id', d.id, 'title', d.title, 'status', d.status)
                                     from public.deliverables d
                                    where d.project_id = p.id and coalesce(d.is_deleted,false)=false
                                    order by case d.status when 'final_delivered' then 5 when 'approved' then 4
                                                           when 'client_review' then 3 when 'revision_requested' then 2
                                                           when 'internal_review' then 1 else 0 end desc,
                                             d.created_at desc limit 1),
           'awaiting_client', exists (select 1 from public.deliverables d
                                       where d.project_id = p.id and coalesce(d.is_deleted,false)=false
                                         and d.status = 'client_review'),
           'revision_requested', exists (select 1 from public.deliverables d
                                          where d.project_id = p.id and coalesce(d.is_deleted,false)=false
                                            and d.status = 'revision_requested'),
           'needs_final_master', exists (select 1 from public.deliverables d
                                          where d.project_id = p.id and coalesce(d.is_deleted,false)=false
                                            and d.status in ('approved','final_delivered')
                                            and not exists (select 1 from public.project_deliverable_versions pv
                                                             where pv.deliverable_id = d.id and pv.is_final = true)),
           'pending_approvals', (select count(*) from public.project_approvals ap
                                  where ap.project_id = p.id and ap.status = 'pending'),
           'closure_status', case when to_regprocedure('public.pc_project_closure_status(uuid)') is null then null
                                  else public.pc_project_closure_status(p.id) end,
           'missing_data', (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
                              select 'no_planned_date' as w where coalesce(p.planned_release_date, p.due_date) is null
                              union all
                              select 'delivered_without_recorded_timestamp'
                                where p.core_stage in ('delivered','closed') and p.delivered_at is null
                              union all
                              select 'no_unit_number' where p.unit_number is null) q(w))
         ) order by p.unit_number nulls last, p.sequence_number nulls last, p.project_name), '[]'::jsonb)
    into v_total, v_rows
  from page p;

  return jsonb_build_object('project_id', p_project, 'rows', v_rows,
    'total', coalesce(v_total,0), 'limit', v_limit, 'offset', v_offset,
    'has_more', v_offset + v_limit < coalesce(v_total,0),
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_program_delivery_matrix(uuid,jsonb) from public, anon;
grant execute on function public.project_program_delivery_matrix(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) ما ينتظر العميل — عرض إداريّ. لا يرسل تذكيرًا ولا ينشئ نظام إشعارات موازيًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_client_actions(
  p_project uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 300);
  v_stale int := greatest(coalesce((p_filters->>'stale_days')::int, 3), 1);
  v_rows jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  if not public.program_can(p_project, 'programs.view') then raise exception 'not authorized'; end if;

  -- waiting_since يُحسب مرّة واحدة لكل صفّ (LATERAL)، ثمّ الترتيب والتقطيع عليه —
  -- بلا ذلك كان التعبير يتكرّر ٨ مرّات في الصفّ، وكان LIMIT يسبق الترتيب فيقتطع
  -- الأقدم انتظارًا (وهو الأهمّ) عشوائيًّا.
  select coalesce(jsonb_agg(s.x order by s.waiting_since asc nulls last), '[]'::jsonb) into v_rows from (
    select ws.waiting_since,
      jsonb_build_object(
        'project_id', ch.id, 'project_name', ch.project_name, 'unit_number', ch.unit_number,
        'deliverable_id', d.id, 'deliverable_title', d.title,
        'kind', case d.status when 'client_review' then 'awaiting_client_decision'
                              when 'revision_requested' then 'revision_not_yet_resent' end,
        'waiting_since', ws.waiting_since,
        'days_waiting', case when ws.waiting_since is null then null
                             else v_today - (ws.waiting_since at time zone 'Asia/Riyadh')::date end,
        'stale', case when ws.waiting_since is null then false
                      else (v_today - (ws.waiting_since at time zone 'Asia/Riyadh')::date) >= v_stale end,
        'open_client_comments', (select count(*) from public.client_comments cc
                                  where cc.deliverable_id = d.id and coalesce(cc.is_deleted,false) = false
                                    and coalesce(cc.status,'open') <> 'resolved')
      ) as x
    from public.projects ch
    join public.deliverables d on d.project_id = ch.id and coalesce(d.is_deleted,false) = false
    cross join lateral (
      select coalesce(
        (select max(a.created_at) from public.project_activity a
          where a.project_id = ch.id and a.entity_id = d.id and a.action = 'deliverable_sent_client'),
        (select max(rv.created_at) from public.deliverable_reviews rv
          where rv.deliverable_id = d.id and coalesce(rv.is_deleted,false) = false)) as waiting_since
    ) ws
    where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
      and public.pc_can_read_project(ch.id)
      and d.status in ('client_review','revision_requested')
    order by ws.waiting_since asc nulls last
    limit v_limit
  ) s;

  return jsonb_build_object('project_id', p_project, 'rows', v_rows,
    'stale_days', v_stale, 'today', v_today, 'generated_at', now(),
    'note', 'عرض فقط — 8D لا يرسل أيّ تذكير تلقائيّ ولا ينشئ قناة إشعارات جديدة');
end $$;
revoke execute on function public.project_program_client_actions(uuid,jsonb) from public, anon;
grant execute on function public.project_program_client_actions(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) ملخّص البرنامج للعميل — سطح العميل الوحيد في 8D.
--     بوّابة عميل صريحة (is_client_owner) ولا توسيع لـpc_can_read_project.
--     كل وحدة تُفحَص **بذاتها** — لا توريث رؤية من الأب إلى الفرع في هذه الشيفرة.
--     ولا يخرج منها: مخاطر · مشكلات · حوكمة · موارد · تعارضات · مالية · ملاحظات
--     داخلية · قوائم إغلاق · التزامات غير client_visible.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_client_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_enabled boolean; v_name text; v_scope text;
  v_units jsonb; v_sla jsonb; v_res jsonb; r jsonb;
  v_total int := 0; v_delivered int := 0; v_waiting int := 0;
begin
  -- بوّابة العميل صراحةً: is_client_owner للمشروع الرئيسي نفسه.
  if not coalesce(public.is_client_owner(p_project), false) then raise exception 'not authorized'; end if;
  select p.project_name, p.project_scope into v_name, v_scope
    from public.projects p where p.id = p_project and coalesce(p.is_deleted,false) = false;
  if v_name is null then raise exception 'not_found'; end if;
  if v_scope <> 'master' then raise exception 'program_requires_master'; end if;
  -- العلم الميت في 8A يصير بوّابة حقيقية هنا: بلا تفعيل صريح لا يوجد سطح عميل.
  select client_program_view_enabled into v_enabled
    from public.project_program_settings where project_id = p_project;
  if not coalesce(v_enabled, false) then raise exception 'client_program_view_disabled'; end if;

  -- الوحدات: كل وحدة تمرّ ببوّابتها الخاصّة، ولا شيء يُشتقّ من كون الأب مرئيًّا.
  select coalesce(jsonb_agg(u order by u->>'unit_number'), '[]'::jsonb),
         count(*), count(*) filter (where (u->>'delivered')::boolean),
         count(*) filter (where (u->>'awaiting_your_review')::boolean)
    into v_units, v_total, v_delivered, v_waiting
  from (
    select jsonb_build_object(
      'project_id', ch.id, 'project_name', ch.project_name,
      'unit_number', ch.unit_number, 'unit_code', ch.unit_code,
      'planned_release_date', ch.planned_release_date,
      'stage_label_ar', case pc.core_stage
        when 'closed' then 'مكتمل' when 'delivered' then 'مُسلَّم'
        when 'client_review' then 'بانتظار مراجعتك' when 'revision' then 'قيد التعديل'
        when 'approved' then 'معتمد' else 'قيد العمل' end,
      'progress_pct', pc.progress_pct,
      'delivered', public.pgm_unit_delivered_at(ch.id) is not null,
      'delivered_at', public.pgm_unit_delivered_at(ch.id),
      'awaiting_your_review', exists (select 1 from public.deliverables d
                                       where d.project_id = ch.id and coalesce(d.is_deleted,false)=false
                                         and d.status = 'client_review'),
      'available_deliverables', (select count(*) from public.deliverables d
                                  where d.project_id = ch.id and coalesce(d.is_deleted,false)=false
                                    and d.status in ('client_review','approved','final_delivered'))
    ) as u
    from public.projects ch
    left join public.project_core pc on pc.project_id = ch.id
    where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false) = false
      and coalesce(public.is_client_owner(ch.id), false)     -- ← فحص مستقلّ لكل وحدة
  ) s;

  -- التزامات client_visible فقط، وبأرقامها المشتقّة نفسها. نستدعي المُحرِّك الداخليّ
  -- برؤية العميل (p_client_view=true) بدل الواجهة العامّة المحروسة بـpc_can_read_project
  -- (التي لا يمرّ بها العميل أبدًا فكانت القائمة تعود فارغة دائمًا). البوّابة تمّت أعلاه.
  v_sla := '[]'::jsonb;
  begin
    v_res := public.pgm_commitment_results_core(p_project, null, null, true);
  exception when others then v_res := null;   -- محرّك القياس مساعد؛ فشله لا يُسقط سطح العميل
  end;
  if v_res is not null then
    for r in select * from jsonb_array_elements(v_res->'results') loop
      if coalesce((r->>'client_visible')::boolean, false) then
        v_sla := v_sla || jsonb_build_object(
          'name_ar', r->>'name_ar', 'target', r->'target', 'actual', r->'actual',
          'unit', r->>'unit', 'status', r->>'status', 'period_from', r->'period_from',
          'period_to', r->'period_to', 'formula_ar', r->>'formula_ar');
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'project_id', p_project, 'program_name', v_name,
    'units', v_units, 'units_total', v_total,
    'units_delivered', v_delivered, 'units_awaiting_you', v_waiting,
    'next_release_date', (select min(ch.planned_release_date) from public.projects ch
                           where ch.parent_project_id = p_project and coalesce(ch.is_deleted,false)=false
                             and coalesce(public.is_client_owner(ch.id), false)
                             and ch.planned_release_date is not null
                             and ch.planned_release_date >= v_today),
    'commitments', v_sla,
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.project_program_client_summary(uuid) from public, anon;
grant execute on function public.project_program_client_summary(uuid) to authenticated;
comment on function public.project_program_client_summary(uuid) is
  '8D: سطح العميل الوحيد. بوّابة is_client_owner لكل وحدة على حدة + client_program_view_enabled. لا مخاطر/حوكمة/موارد/مالية.';

-- ════════════════════════════════════════════════════════════════════════════
-- §10) تكامل مركز العمليات والإدارة التنفيذية — قراءات إضافية فقط.
--      لا تُغيَّر معادلة أيّ Score قائم؛ SLA قسم معلوماتيّ منفصل.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.program_sla_attention(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[]; v_pid uuid; v_res jsonb; r jsonb;
  v_rows jsonb := '[]'::jsonb; v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 50), 1), 100);
  v_scanned int := 0; v_name text;
begin
  if not coalesce(public.ops_can_view(), false) then raise exception 'not authorized'; end if;
  v_ids := public.ops_visible_ids(coalesce(p_filters,'{}'::jsonb));
  if v_ids is null then v_ids := '{}'; end if;

  for v_pid, v_name in
    select p.id, p.project_name from public.projects p
     where p.id = any(v_ids) and p.project_scope = 'master' and coalesce(p.is_deleted,false) = false
     order by p.project_name
     limit v_limit
  loop
    v_scanned := v_scanned + 1;
    -- المُحرِّك الداخليّ مباشرةً (رؤية الطاقم): ops_can_view+ops_visible_ids بوّابة
    -- كافية، ونتجنّب ابتلاع رفض program_can الذي كان يُظهر «لا خطر» زورًا.
    begin v_res := public.pgm_commitment_results_core(v_pid, null, null, false);
    exception when others then v_res := null; end;
    if v_res is not null then
      for r in select * from jsonb_array_elements(v_res->'results') loop
        if (r->>'status') in ('breached','warning') then
          v_rows := v_rows || jsonb_build_object(
            'project_id', v_pid, 'project_name', v_name,
            'commitment_key', r->>'commitment_key', 'name_ar', r->>'name_ar',
            'status', r->>'status', 'target', r->'target', 'actual', r->'actual',
            'unit', r->>'unit', 'sample_size', r->'sample_size');
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('rows', v_rows, 'programs_scanned', v_scanned,
    'limit', v_limit, 'generated_at', now());
end $$;
revoke execute on function public.program_sla_attention(jsonb) from public, anon;
grant execute on function public.program_sla_attention(jsonb) to authenticated;

create or replace function public.executive_program_sla(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[]; v_pid uuid; v_res jsonb; r jsonb;
  v_on int := 0; v_warn int := 0; v_breach int := 0; v_nodata int := 0;
  v_prog int := 0; v_with_data int := 0; v_worst text; v_total int := 0;
  v_ot_num numeric := 0; v_ot_den numeric := 0; v_ot_counted boolean;
  v_month int := 0; v_pending int := 0; v_tmp int := 0;
  v_from date := (date_trunc('month', (now() at time zone 'Asia/Riyadh')))::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 200);
begin
  if not coalesce(public.is_staff(), false) then raise exception 'not authorized'; end if;
  begin
    select coalesce(array_agg(x), '{}') into v_ids
      from public.exec_visible_projects(coalesce(p_filters,'{}'::jsonb)) x;
  exception when undefined_function then v_ids := '{}'; end;
  if v_ids is null then v_ids := '{}'; end if;
  -- إجمالي البرامج المرئية (قبل حدّ المسح) — لنُبلّغ الاقتطاع بصدق.
  select count(*) into v_total from public.projects p
   where p.id = any(v_ids) and p.project_scope = 'master' and coalesce(p.is_deleted,false) = false;

  for v_pid in
    select p.id from public.projects p
     where p.id = any(v_ids) and p.project_scope = 'master' and coalesce(p.is_deleted,false) = false
     order by p.project_name, p.id           -- مسح حتميّ (بلا ORDER BY كان الاقتطاع عشوائيًّا)
     limit v_limit
  loop
    v_prog := v_prog + 1;
    -- عدّادات المحفظة تُحسب لكل برنامج مرئيّ — **قبل** أيّ تخطٍّ لمن لا التزام له،
    -- وإلّا كانت «وحدات هذا الشهر» و«بانتظار العميل» تُسقط كل برنامج بلا SLA.
    select count(*) into v_tmp from public.projects ch
     cross join lateral (select public.pgm_unit_delivered_at(ch.id) as at) u
     where ch.parent_project_id = v_pid and coalesce(ch.is_deleted,false) = false
       and public.pc_can_read_project(ch.id)
       and (u.at at time zone 'Asia/Riyadh')::date >= v_from;
    v_month := v_month + coalesce(v_tmp,0);
    select count(*) into v_tmp from public.projects ch
      join public.deliverables d on d.project_id = ch.id and coalesce(d.is_deleted,false) = false
     where ch.parent_project_id = v_pid and coalesce(ch.is_deleted,false) = false
       and public.pc_can_read_project(ch.id) and d.status = 'client_review';
    v_pending := v_pending + coalesce(v_tmp,0);

    begin v_res := public.pgm_commitment_results_core(v_pid, null, null, false);
    exception when others then v_res := null; end;
    if v_res is null or jsonb_array_length(coalesce(v_res->'results','[]'::jsonb)) = 0 then
      v_nodata := v_nodata + 1; continue;
    end if;
    v_with_data := v_with_data + 1;
    v_worst := 'met'; v_ot_counted := false;
    for r in select * from jsonb_array_elements(v_res->'results') loop
      if (r->>'status') = 'breached' then v_worst := 'breached';
      elsif (r->>'status') = 'warning' and v_worst <> 'breached' then v_worst := 'warning';
      elsif (r->>'status') = 'unavailable' and v_worst = 'met' then v_worst := 'unavailable'; end if;
      -- التسليم في الموعد: مساهمة واحدة لكل برنامج (قد يحمل التزامَي نسبة بمفتاحين).
      if (r->>'commitment_type') = 'on_time_delivery_rate' and (r->>'denominator') is not null
         and not v_ot_counted then
        v_ot_num := v_ot_num + coalesce((r->>'numerator')::numeric, 0);
        v_ot_den := v_ot_den + coalesce((r->>'denominator')::numeric, 0);
        v_ot_counted := true;
      end if;
    end loop;
    if    v_worst = 'breached' then v_breach := v_breach + 1;
    elsif v_worst = 'warning'  then v_warn := v_warn + 1;
    elsif v_worst = 'met'      then v_on := v_on + 1;
    else  v_nodata := v_nodata + 1; end if;
  end loop;

  return jsonb_build_object(
    'programs_total', v_total, 'programs_scanned', v_prog,
    'programs_truncated', greatest(v_total - v_prog, 0),
    'programs_with_commitments', v_with_data,
    'programs_on_target', v_on, 'programs_warning', v_warn,
    'programs_breached', v_breach, 'programs_missing_sla_data', v_nodata,
    -- denominator=0 ⇒ null، لا صفر مضلِّل
    'on_time_delivery_rate', case when v_ot_den > 0 then round(v_ot_num / v_ot_den * 100, 1) else null end,
    'on_time_sample_size', v_ot_den,
    'units_delivered_this_month', v_month,
    'client_pending_actions', v_pending,
    'month_from', v_from,
    'score_note', 'قسم معلوماتيّ — 8D لا يغيّر معادلة أيّ Score تنفيذيّ قائم',
    'generated_at', now());
end $$;
revoke execute on function public.executive_program_sla(jsonb) from public, anon;
grant execute on function public.executive_program_sla(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_n int;
begin
  foreach v_def in array array[
      'public.project_program_commitment_upsert(uuid,jsonb,int)',
      'public.project_program_commitment_archive(uuid,text)',
      'public.project_program_commitment_results(uuid,date,date)',
      'public.project_program_sla_forecast(uuid)',
      'public.project_program_delivery_matrix(uuid,jsonb)',
      'public.project_program_client_actions(uuid,jsonb)',
      'public.project_program_client_summary(uuid)',
      'public.program_sla_attention(jsonb)',
      'public.executive_program_sla(jsonb)',
      'public.pgm_commitment_results_core(uuid,date,date,boolean)',
      'public.pgm_unit_delivered_at(uuid)'] loop
    if to_regprocedure(v_def) is null then raise exception '8D FAIL: الدالة % مفقودة', v_def; end if;
  end loop;

  -- الجدول يخزّن الهدف فقط: ممنوع عمود نتيجة/حالة/خرق محسوب
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='project_program_commitments'
               and column_name in ('actual_value','status','breached','is_breached','result','last_result'))
    then raise exception '8D FAIL: عمود نتيجة مخزَّنة على جدول الالتزامات'; end if;

  -- المحرّك الداخليّ مشتقّ ولا يكتب — وهو محلّ منطق القياس بعد فصله عن البوّابة.
  v_def := pg_get_functiondef('public.pgm_commitment_results_core(uuid,date,date,boolean)'::regprocedure);
  if v_def ~* 'insert into public\.|update\s+public\.|delete from public\.'
    then raise exception '8D FAIL: محرّك القياس يكتب بيانات'; end if;
  if position('delivery_date' in v_def) > 0
    then raise exception '8D FAIL: المحرّك يستعمل delivery_date اليدويّ كتسليم فعليّ'; end if;
  if position('actual_release_date' in v_def) > 0
    then raise exception '8D FAIL: المحرّك يستعمل actual_release_date اليدويّ كتسليم فعليّ'; end if;
  if position('unavailable' in v_def) = 0
    then raise exception '8D FAIL: لا حالة unavailable ⇒ أرقام ملفَّقة عند نقص البيانات'; end if;
  if position('sample_size' in v_def) = 0 or position('formula_ar' in v_def) = 0
    then raise exception '8D FAIL: نتيجة بلا حجم عيّنة أو بلا معادلة معلنة'; end if;
  -- النافذة تُطبَّق على النِّسَب والمدد لا على المهام فقط: كل فرع مقيس يقصّ بالنافذة
  if position('in_window' in v_def) = 0
    then raise exception '8D FAIL: نسبة التسليم بلا تطبيق نافذة القياس'; end if;
  if position('target_unit_incompatible_with_duration' in v_def) = 0
    then raise exception '8D FAIL: المدد تُقارَن بوحدة الهدف بلا تحويل/رفض'; end if;
  -- المُحرِّك الداخليّ لا يُمنح لأحد (بوّابته من مُستدعيه)
  if exists (select 1 from information_schema.role_routine_grants
             where routine_schema='public' and routine_name='pgm_commitment_results_core' and grantee='authenticated')
    then raise exception '8D FAIL: المُحرِّك الداخليّ ممنوح لـauthenticated'; end if;
  -- الواجهة العامّة تبقى محروسة قبل استدعاء المُحرِّك
  v_def := pg_get_functiondef('public.project_program_commitment_results(uuid,date,date)'::regprocedure);
  if position('program_can' in v_def) = 0 or position('pgm_commitment_results_core' in v_def) = 0
    then raise exception '8D FAIL: الواجهة العامّة بلا بوّابة أو لا تستدعي المُحرِّك'; end if;

  -- التسليم الفعليّ من سجلّ المراحل حصرًا
  v_def := pg_get_functiondef('public.pgm_unit_delivered_at(uuid)'::regprocedure);
  if position('project_status_history' in v_def) = 0
    then raise exception '8D FAIL: التسليم الفعليّ لا يُشتقّ من سجلّ المراحل'; end if;
  if position('delivery_date' in v_def) > 0
    then raise exception '8D FAIL: التسليم الفعليّ يستعمل تاريخًا يدويًّا'; end if;

  -- سطح العميل: بوّابة عميل + العلم + فحص كل وحدة، وبلا أيّ مصدر داخليّ
  v_def := pg_get_functiondef('public.project_program_client_summary(uuid)'::regprocedure);
  if position('is_client_owner' in v_def) = 0
    then raise exception '8D FAIL: ملخّص العميل بلا بوّابة عميل'; end if;
  if position('client_program_view_enabled' in v_def) = 0
    then raise exception '8D FAIL: ملخّص العميل يتجاهل تفعيل البرنامج'; end if;
  if v_def ~* 'project_risks|project_issues|project_decisions|budget|cost|profit|resource_booking|project_lessons'
    then raise exception '8D FAIL: ملخّص العميل يمسّ مصدرًا داخليًّا'; end if;
  -- التزام غير client_visible لا يخرج للعميل
  if position('client_visible' in v_def) = 0
    then raise exception '8D FAIL: ملخّص العميل لا يرشّح الالتزامات بعلم الظهور'; end if;

  -- المصفوفة: ترقيم داخل الاستعلام + فحص لكل صفّ + أبناء مباشرون فقط
  v_def := pg_get_functiondef('public.project_program_delivery_matrix(uuid,jsonb)'::regprocedure);
  if position('limit v_limit offset v_offset' in v_def) = 0
    then raise exception '8D FAIL: المصفوفة بلا ترقيم داخل الاستعلام'; end if;
  if position('public.pc_can_read_project(ch.id)' in v_def) = 0
    then raise exception '8D FAIL: المصفوفة بلا فحص وصول لكل وحدة'; end if;
  if position('parent_project_id = p_project' in v_def) = 0
    then raise exception '8D FAIL: المصفوفة لا تقتصر على الأبناء المباشرين'; end if;

  -- لا مالية ولا Zoho ولا عهدة ولا كتابة مرحلة/تقدّم في الملف كلّه
  for v_def in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('project_program_commitment_upsert','project_program_commitment_archive',
        'project_program_commitment_results','project_program_sla_forecast','project_program_delivery_matrix',
        'project_program_client_actions','project_program_client_summary','program_sla_attention','executive_program_sla') loop
    if v_def ~* 'zoho|custody|invoice|update\s+public\.project_core\s+set|progress_manual'
      then raise exception '8D FAIL: دالّة تمسّ الماليّة/Zoho/العهدة/التقدّم'; end if;
  end loop;

  -- الالتزام للبرنامج وحده — حارس على مستوى القاعدة
  select count(*) into v_n from pg_trigger where tgname = 'trg_program_commitment_guard' and not tgisinternal;
  if v_n = 0 then raise exception '8D FAIL: لا حارس master على جدول الالتزامات'; end if;

  -- RLS: قراءة فقط، وبلا سياسة كتابة
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='project_program_commitments' and policyname='ppc_read')
    then raise exception '8D FAIL: لا سياسة قراءة على جدول الالتزامات'; end if;
  if exists (select 1 from pg_policies where schemaname='public'
             and tablename='project_program_commitments' and cmd in ('INSERT','UPDATE','DELETE','ALL'))
    then raise exception '8D FAIL: سياسة كتابة مباشرة على جدول الالتزامات'; end if;

  raise notice '8D ✅ نجح الاختبار الذاتي — التزامات مشتقّة، تسليم فعليّ موثَّق، عزل عميل مُحكَم.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
