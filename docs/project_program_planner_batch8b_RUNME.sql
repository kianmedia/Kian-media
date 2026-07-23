-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 8B — مخطّط الموجة المتدرّجة والإنشاء بالجملة (Rolling-Wave Planner)
--
-- الهدف: إنشاء وإدارة عشرات الوحدات (حلقة/مرحلة/شهر) بلا تكرار يدويّ، وبذرّية
-- كاملة: إمّا تُنشأ الدفعة كلّها أو لا شيء.
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط):
--   • 8A أعطى ملف البرنامج (project_program_settings) وبيانات الوحدة على projects.
--   • الإنشاء الرسميّ للمشروع الفرعيّ: project_core_create_project(jsonb) — يقبل
--     project_scope/parent_project_id/inherit_manager|team|governance ويعيد project_id،
--     ويقفل الأب FOR UPDATE ويحترم ux_projects_parent_seq (6A).
--   • تطبيق القالب: project_core_apply_template_v2(project, template, modules[], start)
--     (7A/ABSOLUTE_FINAL) — لا محرّك تطبيق جديد.
--   • project_unit_metadata_upsert (8A) يضبط رقم/كود/نوع الوحدة تحت قفل الأب.
--
-- ما تفعله هذه الدفعة: **تركيب** المسارين أعلاه داخل معاملة واحدة + معاينة بلا
-- كتابة + منع التكرار عبر idempotency_key + موجة متدرّجة (Rolling Wave) + تبنّي
-- الفروع القائمة + إزاحة تواريخ دفعة.
--
-- ممنوع هنا: Bulk Approval · Bulk Final Close · Bulk Archive · Bulk Delete ·
-- تغيير core_stage بالجملة · تعديل progress · مالية · Zoho · عهدة · حجز موارد آليّ.
--
-- ترتيب التشغيل: … → 6A → 6B → 6C → 7A → 7B → 8A → 8B.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then raise exception '8B PREFLIGHT: project_core_create_project مفقودة'; end if;
  if to_regprocedure('public.project_core_apply_template_v2(uuid,uuid,text[],date)') is null
    then raise exception '8B PREFLIGHT: محرّك تطبيق القوالب مفقود (شغّل 7A/ABSOLUTE_FINAL)'; end if;
  if to_regclass('public.project_program_settings') is null
    then raise exception '8B PREFLIGHT: 8A غير مطبّقة (project_program_settings مفقود)'; end if;
  if to_regprocedure('public.program_can(uuid,text)') is null
    then raise exception '8B PREFLIGHT: بوابة البرامج program_can مفقودة (8A)'; end if;
  if to_regprocedure('public.pc_is_master(uuid)') is null
    then raise exception '8B PREFLIGHT: هرمية 6A مفقودة'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) سجلّ تشغيلات الخطة — يمنع التكرار (Idempotency) ويوثّق ما أُنشئ
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_program_plan_runs (
  id                uuid primary key default gen_random_uuid(),
  parent_project_id uuid not null references public.projects(id) on delete cascade,
  idempotency_key   text not null,
  template_id       uuid,
  requested_count   int  not null default 0,
  created_count     int  not null default 0,
  first_unit_number int,
  last_unit_number  int,
  plan_payload      jsonb not null default '{}'::jsonb,
  summary           jsonb not null default '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (parent_project_id, idempotency_key)
);
create index if not exists idx_pppr_parent on public.project_program_plan_runs(parent_project_id, created_at desc);

alter table public.project_program_plan_runs enable row level security;
drop policy if exists pppr_read on public.project_program_plan_runs;
create policy pppr_read on public.project_program_plan_runs for select to authenticated
  using (public.pc_can_read_project(parent_project_id));
revoke all on public.project_program_plan_runs from anon;
grant select on public.project_program_plan_runs to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) مولّد الخطة (نقيّ، بلا كتابة) — يُستعمل من المعاينة والتطبيق معًا
--     فمصدر الأسماء/الأرقام/التواريخ واحد ولا ينحرف بينهما.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.program_plan_build(p_parent uuid, p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_set public.project_program_settings;
  v_parent_name text; v_rows jsonb := '[]'::jsonb;
  v_count int; v_start_num int; v_prefix text; v_pattern text;
  v_cadence text; v_interval int; v_first date; v_dur int; v_gap int;
  v_season int; v_batch int; v_ws text; v_utype text;
  v_i int; v_num int; v_name text; v_code text; v_s date; v_e date; v_offset int;
  v_taken int[]; v_dupe int := 0;
  v_month_ar text[] := array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
begin
  -- بوابة إلزامية: الدالة SECURITY DEFINER وتقرأ اسم المشروع وإعدادات البرنامج،
  -- فبدونها يستطيع أيّ مستخدم مسجَّل (بما فيه العميل) استخراجها لأيّ مشروع.
  if not public.program_can(p_parent, 'programs.manage_units') then raise exception 'not authorized'; end if;
  select * into v_set from public.project_program_settings where project_id = p_parent;
  select project_name into v_parent_name from public.projects where id = p_parent;

  v_count     := greatest(coalesce((p_payload->>'count')::int, 0), 0);
  v_prefix    := coalesce(nullif(btrim(p_payload->>'numbering_prefix'),''), v_set.numbering_prefix);
  v_pattern   := coalesce(nullif(btrim(p_payload->>'name_pattern'),''), 'الوحدة {unit_number}');
  v_cadence   := coalesce(nullif(p_payload->>'cadence',''), coalesce(v_set.cadence_type,'none'));
  v_interval  := greatest(coalesce(nullif(p_payload->>'cadence_interval','')::int, coalesce(v_set.cadence_interval,1)), 1);
  v_first     := nullif(p_payload->>'first_start_date','')::date;
  v_dur       := coalesce(nullif(p_payload->>'unit_duration_days','')::int, v_set.default_child_duration_days);
  v_gap       := coalesce(nullif(p_payload->>'gap_days','')::int, 0);
  v_season    := nullif(p_payload->>'season_number','')::int;
  v_batch     := nullif(p_payload->>'batch_number','')::int;
  v_ws        := nullif(btrim(p_payload->>'workstream'),'');
  v_utype     := nullif(btrim(p_payload->>'unit_type'),'');

  -- الأرقام المستخدمة فعلًا داخل هذا الأب (الموجة المتدرّجة تُكمل ولا تُصادم).
  select coalesce(array_agg(unit_number), '{}'::int[]) into v_taken
    from public.projects
   where parent_project_id = p_parent and coalesce(is_deleted,false) = false and unit_number is not null;

  -- بداية الترقيم: المطلوب صراحةً، وإلّا التالي بعد أكبر رقم مستخدم، وإلّا إعداد البرنامج.
  v_start_num := coalesce(nullif(p_payload->>'start_number','')::int,
                          case when array_length(v_taken,1) is null then coalesce(v_set.numbering_start, 1)
                               else (select max(x) + 1 from unnest(v_taken) x) end);

  for v_i in 0 .. greatest(v_count - 1, -1) loop
    exit when v_count = 0;
    v_num := v_start_num + v_i;

    -- التواريخ: تسلسل بالمدّة + الفجوة، أو تواتر ثابت من أوّل تاريخ.
    v_offset := case v_cadence
                  when 'daily'    then v_i * v_interval
                  when 'weekly'   then v_i * 7 * v_interval
                  when 'biweekly' then v_i * 14 * v_interval
                  when 'monthly'  then null            -- يُحسب بالشهور أدناه
                  -- none/custom: تسلسل بالمدّة + الفجوة (custom يعني «يحدّده المستخدم بالمدّة/الفجوة»)
                  else v_i * (coalesce(v_dur,0) + v_gap)
                end;
    if v_first is null then v_s := null;
    elsif v_cadence = 'monthly' then v_s := (v_first + (v_i * v_interval) * interval '1 month')::date;
    else v_s := v_first + coalesce(v_offset, 0);
    end if;
    v_e := case when v_s is null or v_dur is null then null else v_s + greatest(v_dur - 1, 0) end;

    -- الاسم: أنماط معلنة (لا Black Box).
    v_name := v_pattern;
    -- greatest(2, length): lpad('100',2) تُعيد '10' — بطول ثابت تُقطع الأرقام ≥100.
    v_name := replace(v_name, '{unit_number:02}', lpad(v_num::text, greatest(2, length(v_num::text)), '0'));
    v_name := replace(v_name, '{unit_number}', v_num::text);
    v_name := replace(v_name, '{parent_name}', coalesce(v_parent_name, ''));
    -- بلا بادئة: نحذف الشرطة الفاصلة أيضًا حتى لا ينتج اسم مثل «-01».
    v_name := case when v_prefix is null then replace(replace(v_name, '{prefix}-', ''), '{prefix}', '')
                   else replace(v_name, '{prefix}', v_prefix) end;
    v_name := replace(v_name, '{season}', coalesce(v_season::text, ''));
    v_name := replace(v_name, '{month_name}',
                      case when v_s is null then '' else v_month_ar[extract(month from v_s)::int] end);
    v_name := nullif(btrim(v_name), '');
    if v_name is null then v_name := coalesce(v_parent_name,'وحدة') || ' — ' || v_num::text; end if;

    v_code := case when v_prefix is null then null
                   else v_prefix || '-' || lpad(v_num::text, greatest(2, length(v_num::text)), '0') end;
    if v_num = any(v_taken) then v_dupe := v_dupe + 1; end if;

    v_rows := v_rows || jsonb_build_object(
      'index', v_i, 'unit_number', v_num, 'unit_code', v_code, 'project_name', v_name,
      'unit_type', v_utype, 'season_number', v_season, 'batch_number', v_batch, 'workstream', v_ws,
      'start_date', v_s, 'due_date', v_e,
      'duplicate_number', (v_num = any(v_taken)));
  end loop;

  return jsonb_build_object(
    'rows', v_rows, 'count', v_count, 'start_number', v_start_num,
    'duplicate_count', v_dupe, 'parent_name', v_parent_name,
    'settings_present', (v_set.project_id is not null));
end $$;
revoke execute on function public.program_plan_build(uuid,jsonb) from public, anon;
grant execute on function public.program_plan_build(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) المعاينة — قراءة فقط، لا تكتب شيئًا إطلاقًا
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_plan_preview(p_parent uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_plan jsonb; v_set public.project_program_settings; v_warn jsonb := '[]'::jsonb;
  v_count int; v_existing int; v_tpl uuid; v_tpl_ok boolean := true; v_key text;
  v_replay jsonb; v_can boolean := true; v_errs jsonb := '[]'::jsonb;
begin
  if not public.program_can(p_parent, 'programs.manage_units') then raise exception 'not authorized'; end if;
  if not coalesce(public.pc_is_master(p_parent), false) then raise exception 'program_requires_master'; end if;

  select * into v_set from public.project_program_settings where project_id = p_parent;
  v_plan := public.program_plan_build(p_parent, p_payload);
  v_count := (v_plan->>'count')::int;
  v_tpl := coalesce(nullif(p_payload->>'template_id','')::uuid, v_set.default_child_template_id);
  v_key := nullif(btrim(p_payload->>'idempotency_key'),'');

  select count(*) into v_existing from public.projects
   where parent_project_id = p_parent and coalesce(is_deleted,false) = false;

  -- أخطاء تمنع التطبيق
  -- بوّابات مسار الإنشاء الرسميّ نفسها: بدونها تَعِد المعاينة بتطبيق يفشل حتمًا.
  if not coalesce(public.can_manage_projects(), false) then
    v_errs := v_errs || jsonb_build_object('code','requires_manage_projects','ar','إنشاء الوحدات يتطلّب صلاحية إدارة المشاريع'); v_can := false; end if;
  begin
    if not coalesce(public.project_hierarchy_enabled(), false) then
      v_errs := v_errs || jsonb_build_object('code','hierarchy_disabled','ar','هرمية المشاريع غير مُفعَّلة'); v_can := false; end if;
  exception when undefined_function then null; end;
  if v_count <= 0 then v_errs := v_errs || jsonb_build_object('code','count_required','ar','حدّد عدد الوحدات المطلوب إنشاؤها'); v_can := false; end if;
  if v_count > 100 then v_errs := v_errs || jsonb_build_object('code','count_too_large','ar','الحدّ الأقصى 100 وحدة في الدفعة الواحدة'); v_can := false; end if;
  if (v_plan->>'duplicate_count')::int > 0 then
    v_errs := v_errs || jsonb_build_object('code','duplicate_numbers','ar','بعض الأرقام مستخدمة بالفعل داخل هذا البرنامج'); v_can := false; end if;
  if v_tpl is not null then
    select exists (select 1 from public.project_templates where id = v_tpl and is_active = true) into v_tpl_ok;
    if not v_tpl_ok then v_errs := v_errs || jsonb_build_object('code','template_not_found','ar','القالب غير موجود أو مؤرشف'); v_can := false; end if;
  end if;
  -- تشغيل سابق بنفس المفتاح ⇒ التطبيق سيُعيد النتيجة السابقة بلا إنشاء جديد.
  if v_key is not null then
    select jsonb_build_object('created_count', created_count, 'created_at', created_at)
      into v_replay from public.project_program_plan_runs
     where parent_project_id = p_parent and idempotency_key = v_key;
  end if;

  -- تحذيرات (لا تمنع)
  if v_set.project_id is null then
    v_warn := v_warn || jsonb_build_object('code','no_program_settings','ar','لا ملف تشغيل للبرنامج — ستُستخدم القيم المُدخلة فقط'); end if;
  if v_set.target_units is not null and (v_existing + v_count) > v_set.target_units then
    v_warn := v_warn || jsonb_build_object('code','exceeds_target','ar','الإجمالي بعد الإنشاء يتجاوز العدد المستهدف',
      'target', v_set.target_units, 'after', v_existing + v_count); end if;
  if (p_payload->>'first_start_date') is null then
    v_warn := v_warn || jsonb_build_object('code','no_dates','ar','بلا تاريخ بداية: ستُنشأ الوحدات بلا تواريخ'); end if;
  if v_tpl is null then
    v_warn := v_warn || jsonb_build_object('code','no_template','ar','بلا قالب: ستُنشأ الوحدات فارغة من المهام والمخرجات'); end if;

  -- تحذير سعة: مدير البرنامج مسنَد لوحدات كثيرة نشطة (إشارة لا حجز).
  begin
    if exists (select 1 from public.project_members m
                where m.project_id = p_parent and m.role='kian_manager' and coalesce(m.is_deleted,false)=false) then
      v_warn := v_warn || (
        select coalesce(jsonb_agg(jsonb_build_object('code','manager_load','ar','مدير البرنامج مسنَد لوحدات نشطة كثيرة',
                 'active_units', c)), '[]'::jsonb)
        from (select count(*) c from public.projects ch join public.project_core pc on pc.project_id=ch.id
               where ch.parent_project_id = p_parent and coalesce(ch.is_deleted,false)=false
                 and pc.core_stage not in ('delivered','closed')) z where z.c >= 20);
    end if;
  exception when undefined_table or undefined_column then null; end;

  return jsonb_build_object(
    'plan', v_plan, 'template_id', v_tpl,
    'existing_units', v_existing,
    'target_units', v_set.target_units,
    'remaining_after', case when v_set.target_units is null then null
                            else greatest(v_set.target_units - (v_existing + v_count), 0) end,
    'warnings', v_warn, 'errors', v_errs,
    'already_applied', v_replay,
    'can_apply', (v_can and v_replay is null),
    'generated_at', now());
end $$;
revoke execute on function public.project_program_plan_preview(uuid,jsonb) from public, anon;
grant execute on function public.project_program_plan_preview(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) التطبيق الذرّي — كل الوحدات أو لا شيء (معاملة واحدة، لا وحدات جزئية)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_plan_apply(
  p_parent uuid, p_payload jsonb, p_idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_prev public.project_program_plan_runs;
  v_pre jsonb; v_plan jsonb; v_row jsonb; v_tpl uuid; v_modules text[];
  v_created uuid; v_res jsonb; v_n int := 0; v_ids jsonb := '[]'::jsonb;
  v_set public.project_program_settings; v_first int; v_last int;
begin
  if coalesce(btrim(p_idempotency_key),'') = '' then raise exception 'idempotency_key_required'; end if;
  if not public.program_can(p_parent, 'programs.manage_units') then raise exception 'not authorized'; end if;
  if not coalesce(public.pc_is_master(p_parent), false) then raise exception 'program_requires_master'; end if;

  -- قفل الأب: يسلسل تطبيقين متزامنين فلا يتصادم الترقيم (نفس نمط 6A/6B).
  perform 1 from public.projects where id = p_parent for update;

  -- إعادة تشغيل بنفس المفتاح ⇒ تُعاد النتيجة السابقة بلا إنشاء مكرّر.
  select * into v_prev from public.project_program_plan_runs
   where parent_project_id = p_parent and idempotency_key = btrim(p_idempotency_key);
  if v_prev.id is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'run_id', v_prev.id,
      'created_count', v_prev.created_count, 'summary', v_prev.summary);
  end if;

  -- إعادة التحقّق داخل المعاملة (المعاينة وحدها لا تكفي — قد تغيّرت الحالة).
  v_pre := public.project_program_plan_preview(p_parent, p_payload);
  if not coalesce((v_pre->>'can_apply')::boolean, false) then
    raise exception 'plan_not_applicable: %', coalesce(v_pre->'errors', '[]'::jsonb)::text;
  end if;

  select * into v_set from public.project_program_settings where project_id = p_parent;
  v_plan := v_pre->'plan';
  v_tpl := nullif(v_pre->>'template_id','')::uuid;
  if jsonb_typeof(p_payload->'modules') = 'array' then
    select array_agg(value::text) into v_modules
      from jsonb_array_elements_text(p_payload->'modules') as m(value)
     where value is not null and btrim(value) <> '';
    if v_modules is null or array_length(v_modules,1) is null then raise exception 'no_modules'; end if;
  end if;

  for v_row in select value from jsonb_array_elements(v_plan->'rows') loop
    -- الإنشاء عبر المسار الرسميّ فقط (يفرض الصلاحيات وقواعد الهرمية والعميل).
    v_res := public.project_core_create_project(jsonb_build_object(
      'project_name',      v_row->>'project_name',
      'project_scope',     'subproject',
      'parent_project_id', p_parent,
      'start_date',        v_row->>'start_date',
      'due_date',          v_row->>'due_date',
      -- مراحل البداية فقط: تمرير delivered/closed هنا = تعيين مرحلة بالجملة يتخطّى
      -- كل بوّابات دورة الحياة (project_core_set_stage هو الكاتب الوحيد المسموح).
      'core_stage',        case when coalesce(nullif(p_payload->>'core_stage',''), 'planning')
                                    in ('lead_approved','project_created','planning','ready')
                                then coalesce(nullif(p_payload->>'core_stage',''), 'planning')
                                else 'planning' end,
      'priority',          coalesce(nullif(p_payload->>'priority',''), 'normal'),
      'inherit_manager',   coalesce((p_payload->>'inherit_manager')::boolean, coalesce(v_set.default_manager_inheritance, true)),
      'inherit_team',      coalesce((p_payload->>'inherit_team')::boolean, coalesce(v_set.default_team_inheritance, false)),
      'inherit_governance',coalesce((p_payload->>'inherit_governance')::boolean, coalesce(v_set.default_governance_inheritance, false))
    ));
    v_created := nullif(v_res->>'project_id','')::uuid;
    if v_created is null then raise exception 'create_failed'; end if;

    -- بيانات الوحدة (الهوية التشغيلية) — مباشرة على الصفّ الجديد داخل نفس المعاملة.
    update public.projects set
      unit_number   = nullif(v_row->>'unit_number','')::int,
      unit_code     = nullif(v_row->>'unit_code',''),
      unit_type     = nullif(v_row->>'unit_type',''),
      season_number = nullif(v_row->>'season_number','')::int,
      batch_number  = nullif(v_row->>'batch_number','')::int,
      workstream    = nullif(v_row->>'workstream','')
    where id = v_created;

    -- تطبيق القالب عبر المحرّك القائم (لا محرّك جديد).
    if v_tpl is not null then
      perform public.project_core_apply_template_v2(v_created, v_tpl, v_modules, nullif(v_row->>'start_date','')::date);
    end if;

    v_n := v_n + 1;
    v_ids := v_ids || jsonb_build_object('project_id', v_created, 'unit_number', (v_row->>'unit_number')::int,
                                         'project_name', v_row->>'project_name');
    v_first := least(coalesce(v_first, (v_row->>'unit_number')::int), (v_row->>'unit_number')::int);
    v_last  := greatest(coalesce(v_last, (v_row->>'unit_number')::int), (v_row->>'unit_number')::int);
  end loop;

  if v_n = 0 then raise exception 'nothing_to_create'; end if;

  insert into public.project_program_plan_runs (parent_project_id, idempotency_key, template_id,
      requested_count, created_count, first_unit_number, last_unit_number, plan_payload, summary, created_by)
    values (p_parent, btrim(p_idempotency_key), v_tpl, (v_plan->>'count')::int, v_n, v_first, v_last,
      p_payload, jsonb_build_object('units', v_ids), auth.uid());

  perform public.pc_log(p_parent, 'program_units_created', 'project', p_parent,
    jsonb_build_object('count', v_n, 'first', v_first, 'last', v_last, 'template_id', v_tpl,
                       'idempotency_key', btrim(p_idempotency_key)));

  return jsonb_build_object('ok', true, 'replayed', false, 'created_count', v_n,
    'first_unit_number', v_first, 'last_unit_number', v_last, 'units', v_ids);
exception when unique_violation then
  raise exception 'duplicate_unit_number';
end $$;
revoke execute on function public.project_program_plan_apply(uuid,jsonb,text) from public, anon;
grant execute on function public.project_program_plan_apply(uuid,jsonb,text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) إزاحة تواريخ دفعة وحدات — معاينة ثمّ تطبيق، بسبب إلزاميّ وتدقيق
--     لا تمسّ core_stage ولا progress ولا تُلغي حجوزات.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_program_units_shift_dates(
  p_parent uuid, p_unit_ids uuid[], p_days int, p_reason text, p_apply boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_rows jsonb; v_n int := 0;
begin
  if not public.program_can(p_parent, 'programs.manage_units') then raise exception 'not authorized'; end if;
  if p_unit_ids is null or array_length(p_unit_ids,1) is null then raise exception 'no_units'; end if;
  if p_days is null or p_days = 0 then raise exception 'no_shift'; end if;
  if p_apply and coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;

  -- الوحدات المستهدفة: فروع هذا الأب فقط، ومرئية للمستخدم (لا كتابة خارج النطاق).
  select coalesce(jsonb_agg(jsonb_build_object('project_id', c.id, 'project_name', c.project_name,
           'from_start', pc.start_date, 'to_start', pc.start_date + p_days,
           'from_due', pc.due_date, 'to_due', pc.due_date + p_days) order by c.unit_number nulls last), '[]'::jsonb),
         count(*)
    into v_rows, v_n
  from public.projects c join public.project_core pc on pc.project_id = c.id
  where c.id = any(p_unit_ids) and c.parent_project_id = p_parent
    and coalesce(c.is_deleted,false) = false and public.pc_can_read_project(c.id)
    -- الكتابة تحتاج حقّ التحرير لا القراءة (نفس بوابة project_core الكاتبة).
    and (coalesce(public.can_manage_projects(),false) or coalesce(public.can_edit_project(c.id),false));

  if v_n = 0 then raise exception 'no_matching_units'; end if;

  if p_apply then
    -- تُحدَّث التواريخ فقط — لا مرحلة ولا تقدّم ولا حجوزات.
    update public.project_core pc set
      start_date = case when pc.start_date is null then null else pc.start_date + p_days end,
      due_date   = case when pc.due_date   is null then null else pc.due_date   + p_days end,
      updated_at = now()
    from public.projects c
    where c.id = pc.project_id and c.id = any(p_unit_ids) and c.parent_project_id = p_parent
      and coalesce(c.is_deleted,false) = false and public.pc_can_read_project(c.id)
      and (coalesce(public.can_manage_projects(),false) or coalesce(public.can_edit_project(c.id),false));

    perform public.pc_log(p_parent, 'program_units_dates_shifted', 'project', p_parent,
      jsonb_build_object('units', v_n, 'days', p_days, 'reason', btrim(p_reason)));
  end if;

  return jsonb_build_object('ok', true, 'applied', p_apply, 'units', v_n, 'days', p_days, 'rows', v_rows);
end $$;
revoke execute on function public.project_program_units_shift_dates(uuid,uuid[],int,text,boolean) from public, anon;
grant execute on function public.project_program_units_shift_dates(uuid,uuid[],int,text,boolean) to authenticated;

comment on function public.project_program_plan_preview(uuid,jsonb) is '8B: معاينة خطة الوحدات — قراءة فقط، لا تكتب.';
comment on function public.project_program_plan_apply(uuid,jsonb,text) is '8B: تطبيق ذرّي للخطة عبر project_core_create_project + apply_template_v2، بمنع تكرار عبر idempotency_key.';
comment on table public.project_program_plan_runs is '8B: سجلّ تشغيلات الخطة — يمنع التكرار ويوثّق ما أُنشئ.';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text;
begin
  foreach v_def in array array['public.program_plan_build(uuid,jsonb)','public.project_program_plan_preview(uuid,jsonb)',
      'public.project_program_plan_apply(uuid,jsonb,text)','public.project_program_units_shift_dates(uuid,uuid[],int,text,boolean)'] loop
    if to_regprocedure(v_def) is null then raise exception '8B FAIL: الدالة % مفقودة', v_def; end if;
  end loop;
  if to_regclass('public.project_program_plan_runs') is null then raise exception '8B FAIL: سجلّ التشغيلات مفقود'; end if;

  -- المعاينة قراءة فقط
  v_def := pg_get_functiondef('public.project_program_plan_preview(uuid,jsonb)'::regprocedure);
  if v_def !~* '\ystable\y' then raise exception '8B FAIL: المعاينة ليست stable (قد تكتب)'; end if;
  if v_def ~* '\yinsert into\y|\yupdate\s+public\.' then raise exception '8B FAIL: المعاينة تكتب بيانات'; end if;

  -- التطبيق يُركّب المسارين الرسميين ولا يكتب مباشرةً في projects عدا بيانات الوحدة
  v_def := pg_get_functiondef('public.project_program_plan_apply(uuid,jsonb,text)'::regprocedure);
  if position('project_core_create_project' in v_def) = 0
    then raise exception '8B FAIL: التطبيق لا يُركّب مسار الإنشاء الرسميّ'; end if;
  if position('project_core_apply_template_v2' in v_def) = 0
    then raise exception '8B FAIL: التطبيق لا يُركّب محرّك القوالب'; end if;
  if position('for update' in v_def) = 0 then raise exception '8B FAIL: التطبيق بلا قفل على الأب'; end if;
  if v_def ~* 'update\s+public\.project_core' then raise exception '8B FAIL: التطبيق يكتب على project_core'; end if;

  -- الإزاحة لا تمسّ المرحلة ولا التقدّم
  v_def := pg_get_functiondef('public.project_program_units_shift_dates(uuid,uuid[],int,text,boolean)'::regprocedure);
  if v_def ~* 'core_stage|progress_pct' then raise exception '8B FAIL: الإزاحة تمسّ المرحلة/التقدّم'; end if;
  if position('reason_required' in v_def) = 0 then raise exception '8B FAIL: الإزاحة بلا سبب إلزاميّ'; end if;

  raise notice '8B ✅ نجح الاختبار الذاتي — المعاينة/التطبيق الذرّي/Idempotency/الإزاحة.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
