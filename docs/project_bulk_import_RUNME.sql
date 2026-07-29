-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — الاستيراد الجماعي العامّ (دفعات · معاينة · تشغيل تجريبي · تنفيذ)
-- docs/project_bulk_import_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الترتيب الإلزامي ★
--   1. docs/project_platform_large_projects_PREFLIGHT.sql / RUNME / POSTCHECK
--   2. docs/project_bulk_import_PREFLIGHT.sql        (قراءة فقط)
--   3. **هذا الملفّ**
--   4. docs/project_bulk_import_POSTCHECK.sql        (قراءة فقط)
--
-- ★ الفكرة في سطر واحد ★
--   الملفّ (Excel/CSV) يتحوّل إلى **صفوف staging** داخل القاعدة، تُعايَن وتُشغَّل
--   تجريبيًّا وتُنفَّذ — وكل صفّ مربوط بمفتاح مصدر (external_key). إعادة تشغيل نفس
--   الملفّ لا تُنشئ شيئًا، لأن كل صفّ يجد نفسه موجودًا فيتخطّى.
--
-- ★ نموذج عامّ لا يعرف أيّ مشروع بعينه ★
--   لا جدول ولا عمود ولا قيمة تحمل اسم عميل أو مشروع. `profile` نصّ حرّ يصف
--   ملفّ التعيين (mapping profile) الذي استُعمل خارج القاعدة — بيانات لا بنية.
--   المراحل ليست ثابتة العدد، والمخرجات ليست بالضرورة فيديو، والتاريخ اختياريّ.
--
-- ★ الحدود المقصودة (وأسبابها) ★
--   1. entity_type ∈ ('stage','deliverable') فقط. 'project' مرفوض صراحةً:
--      المشروع الرئيسي يُنشئه المالك بيده ويُمرَّر معرّفه كهدف للدفعة. ملفّ Excel
--      لا يجوز أن يُنجب مشاريع حقيقية.
--   2. external_key **إلزاميّ** لكل صفّ — بدونه لا معنى لكلمة «نفس الصفّ»،
--      ولا يمكن ضمان أن التشغيل الثاني لا يُنشئ شيئًا.
--      ★ مكانه: public.deliverable_internal (جدول جانبي كوادر-فقط) للمخرجات،
--        و public.projects.external_key للمراحل. لم يعد على deliverables:
--        RLS تُصفّي الصفوف لا الأعمدة، فوجوده هناك كان يعني أن العميل يقرأ
--        مفاتيح المصدر والملاحظات الداخلية بـ select يدويّ عبر PostgREST.
--   3. حالات المخرجات المسموحة: draft · internal_review فقط.
--      client_review/approved/final_delivered تُطلق إشعارات وبريدًا للعميل عبر
--      مشغّلات قائمة (phase0 t_deliverable_change · batch9d trg_preview_staff_notify)
--      ⇒ استيراد 79 صفًّا كان سيرسل 79 إشعارًا. تُرفض في المعاينة برسالة صريحة.
--
-- ⛔ هذا الملفّ **لا يُنشئ أيّ مشروع ولا أيّ مخرج عند تطبيقه**. الفحص الذاتي
--    في §6 يقارن العددين قبل/بعد ويُجهض المعاملة كلّها عند أيّ فرق.
--
-- ★ التكرار ★ idempotent بالكامل.  ★ التراجع ★ docs/project_bulk_import_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · فحص قبْليّ داخل الملفّ (خارج المعاملة)
-- ─────────────────────────────────────────────────────────────────────────────
do $pre$
declare v_miss text := ''; c text;
begin
  -- الأعمدة العاملة على deliverables.
  foreach c in array array['stage_id','content_type','client_visible',
                           'schedule_status','planned_start_date','expected_units','completed_units',
                           'recurrence_type','sort_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_miss := v_miss || ' deliverables.' || c; end if;
  end loop;
  -- ★ الحقول الداخلية تسكن الجدول الجانبي (كوادر فقط): RLS تُصفّي الصفوف لا
  --   الأعمدة، فوجودها على deliverables كان يعني أن العميل يقرؤها مباشرةً.
  if to_regclass('public.deliverable_internal') is null then
    v_miss := v_miss || ' public.deliverable_internal';
  else
    foreach c in array array['deliverable_id','internal_notes','external_key','import_batch_id',
                             'source_row_number','source_file_name','metadata']
    loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='deliverable_internal' and column_name=c)
        then v_miss := v_miss || ' deliverable_internal.' || c; end if;
    end loop;
  end if;
  -- بقاء أيّ حقل داخلي على deliverables = التسريب حيّ ⇒ ارفض التشغيل.
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_miss := v_miss || ' ★deliverables.' || c || '-ما-زال-موجودًا★'; end if;
  end loop;
  foreach c in array array['parent_project_id','project_scope','stage_order','schedule_status','planned_start_date']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='projects' and column_name=c)
      then v_miss := v_miss || ' projects.' || c; end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then v_miss := v_miss || ' ux_deliverable_internal_external_key'; end if;
  if to_regclass('public.deliverable_content_types') is null
    then v_miss := v_miss || ' public.deliverable_content_types'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then v_miss := v_miss || ' project_core_create_project(jsonb)'; end if;
  if to_regprocedure('public.can_manage_projects()') is null
    then v_miss := v_miss || ' can_manage_projects()'; end if;
  if v_miss <> '' then
    raise exception E'BULK_IMPORT PREFLIGHT: ناقص:%\n  شغّل docs/project_platform_large_projects_RUNME.sql أوّلًا.', v_miss;
  end if;
end $pre$;


begin;

select set_config('kian.bi_projects_before',     (select count(*)::text from public.projects),     true),
       set_config('kian.bi_deliverables_before', (select count(*)::text from public.deliverables), true);


-- ════════════════════════════════════════════════════════════════════════════
-- §1) أثر الاستيراد على public.projects (المراحل مشاريع فرعية ⇒ تحتاج مفتاحًا)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.projects add column if not exists external_key    text;
alter table public.projects add column if not exists import_batch_id uuid;

create unique index if not exists ux_projects_external_key
  on public.projects (external_key) where external_key is not null;
create index if not exists idx_projects_import_batch
  on public.projects (import_batch_id) where import_batch_id is not null;

comment on column public.projects.external_key is
  'مفتاح المصدر الخارجي للمرحلة/المشروع المستورَد — أساس idempotency (فهرس فريد جزئيّ).';


-- ════════════════════════════════════════════════════════════════════════════
-- §2) جداول الـ staging والتدقيق
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.import_batches (
  id                uuid primary key default gen_random_uuid(),
  profile           text not null,                     -- اسم ملفّ التعيين (بيانات، لا بنية)
  source_file_name  text,
  target_project_id uuid references public.projects(id) on delete set null,
  status            text not null default 'draft',
  counts            jsonb not null default '{}'::jsonb,
  notes             text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  previewed_at      timestamptz,
  dry_run_at        timestamptz,
  executed_at       timestamptz,
  executed_by       uuid references auth.users(id)
);

create table if not exists public.import_rows (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.import_batches(id) on delete cascade,
  row_number   int  not null,
  external_key text,
  entity_type  text not null,
  action       text not null default 'create',
  status       text not null default 'pending',
  error        text,
  payload      jsonb not null default '{}'::jsonb,
  result_id    uuid,
  applied_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (batch_id, row_number)
);

-- أثر التدقيق: كل انتقال حالة وكل قرار على مستوى الدفعة.
create table if not exists public.import_batch_events (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.import_batches(id) on delete cascade,
  event      text not null,
  actor_id   uuid references auth.users(id),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname='import_batches_status_ck') then
    alter table public.import_batches add constraint import_batches_status_ck
      check (status in ('draft','previewed','dry_run','executed','partially_executed','failed','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname='import_rows_entity_ck') then
    alter table public.import_rows add constraint import_rows_entity_ck
      check (entity_type in ('stage','deliverable'));
  end if;
  if not exists (select 1 from pg_constraint where conname='import_rows_action_ck') then
    alter table public.import_rows add constraint import_rows_action_ck
      check (action in ('create','skip','error'));
  end if;
  if not exists (select 1 from pg_constraint where conname='import_rows_status_ck') then
    alter table public.import_rows add constraint import_rows_status_ck
      check (status in ('pending','valid','invalid','applied','skipped','failed'));
  end if;
end $ck$;

create index if not exists idx_import_rows_batch    on public.import_rows (batch_id, row_number);
create index if not exists idx_import_rows_key      on public.import_rows (external_key) where external_key is not null;
create index if not exists idx_import_rows_status   on public.import_rows (batch_id, status);
create index if not exists idx_import_events_batch  on public.import_batch_events (batch_id, created_at desc);
create index if not exists idx_import_batches_state on public.import_batches (status, created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- §3) البوّابة والمساعدات
--     كل بوّابة plpgsql تُغلّف كل استدعاء خارجيّ بـ exception: تبعية غائبة تعني
--     «امنع»، لا «انهَر» ولا «افتح». ولا مسار يُعيد NULL أبدًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.import_can_manage()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if auth.uid() is null then return false; end if;
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  if coalesce(v,false) then return true; end if;
  begin v := coalesce(public.emp_has_permission('projects.import'), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- can_manage_projects وحدها تكفي لإنشاء مشروع فرعي (شرط project_core_create_project).
create or replace function public.import_can_create_stages()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- نصّ → text[]: يقبل مصفوفة JSON أو نصًّا مفصولًا بفواصل/فواصل عربية.
create or replace function public.import_text_array(p jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare v text[];
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'array' then
    select array_agg(btrim(x)) into v
      from jsonb_array_elements_text(p) t(x) where btrim(x) <> '';
  elsif jsonb_typeof(p) = 'string' then
    select array_agg(btrim(x)) into v
      from unnest(regexp_split_to_array(p #>> '{}', '[,،;]+')) t(x) where btrim(x) <> '';
  else
    return null;
  end if;
  if v is null or cardinality(v) = 0 then return null; end if;
  return v;
end $$;

create or replace function public.import_audit(p_batch uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.import_batch_events (batch_id, event, actor_id, detail)
  values (p_batch, p_event, auth.uid(), coalesce(p_detail,'{}'::jsonb));
exception when others then
  return;   -- التدقيق لا يُفشل عملية أبدًا
end $$;

create or replace function public.import_batch_guard(p_batch uuid, p_allowed text[])
returns public.import_batches language plpgsql security definer set search_path = public as $$
declare b public.import_batches;
begin
  if not coalesce(public.import_can_manage(), false) then raise exception 'not authorized'; end if;
  select * into b from public.import_batches where id = p_batch for update;
  if b.id is null then raise exception 'batch_not_found'; end if;
  if p_allowed is not null and not (b.status = any (p_allowed)) then
    raise exception 'batch_status_not_allowed: % (المسموح: %)', b.status, array_to_string(p_allowed, ', ');
  end if;
  return b;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- §4) الدوالّ التشغيلية
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 4.1 إنشاء دفعة ─────────────────────────────────────────────────────────
create or replace function public.import_batch_create(
  p_profile          text,
  p_source_file_name text default null,
  p_target_project   uuid default null,
  p_notes            text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prof text;
begin
  if not coalesce(public.import_can_manage(), false) then raise exception 'not authorized'; end if;
  v_prof := nullif(btrim(coalesce(p_profile,'')),'');
  if v_prof is null then raise exception 'profile_required'; end if;
  if p_target_project is not null
     and not exists (select 1 from public.projects
                      where id = p_target_project and coalesce(is_deleted,false) = false)
    then raise exception 'target_project_not_found'; end if;

  insert into public.import_batches (profile, source_file_name, target_project_id, notes, created_by, status)
  values (v_prof, nullif(btrim(coalesce(p_source_file_name,'')),''), p_target_project,
          nullif(btrim(coalesce(p_notes,'')),''), auth.uid(), 'draft')
  returning id into v_id;

  perform public.import_audit(v_id, 'batch_created',
    jsonb_build_object('profile', v_prof, 'source_file_name', p_source_file_name, 'target_project_id', p_target_project));
  return jsonb_build_object('ok', true, 'batch_id', v_id, 'status', 'draft');
end $$;

-- ─── 4.2 تحميل الصفوف (يستبدل صفوف الدفعة بالكامل) ──────────────────────────
--     p_rows = مصفوفة JSON من عناصر:
--       { "row_number": 1, "entity_type": "stage"|"deliverable",
--         "external_key": "...", "payload": { ... } }
create or replace function public.import_batch_load_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.import_batches; e jsonb; v_n int := 0; v_i int := 0;
begin
  b := public.import_batch_guard(p_batch, array['draft','previewed','dry_run']);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_must_be_array'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0    then raise exception 'rows_empty'; end if;
  if v_n > 5000 then raise exception 'rows_limit_exceeded: % (الحدّ 5000)', v_n; end if;

  delete from public.import_rows where batch_id = p_batch;

  for e in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    insert into public.import_rows (batch_id, row_number, external_key, entity_type, payload, status, action)
    values (p_batch,
            coalesce(nullif(e->>'row_number','')::int, v_i),
            nullif(btrim(coalesce(e->>'external_key','')),''),
            lower(btrim(coalesce(e->>'entity_type','deliverable'))),
            case when jsonb_typeof(e->'payload') = 'object' then e->'payload' else '{}'::jsonb end,
            'pending', 'create')
    on conflict (batch_id, row_number) do update
      set external_key = excluded.external_key,
          entity_type  = excluded.entity_type,
          payload      = excluded.payload,
          status       = 'pending', action = 'create', error = null,
          result_id    = null, applied_at = null;
  end loop;

  update public.import_batches
     set status = 'draft', counts = jsonb_build_object('total', v_n), updated_at = now()
   where id = p_batch;

  perform public.import_audit(p_batch, 'rows_loaded', jsonb_build_object('total', v_n));
  return jsonb_build_object('ok', true, 'batch_id', p_batch, 'loaded', v_n, 'status', 'draft');
end $$;

-- ─── 4.3 المعاينة / التحقّق ─────────────────────────────────────────────────
--     تُصنّف كل صفّ: valid+create · valid+skip (موجود مسبقًا) · invalid+error.
--     ★ لا تكتب صفّ عمل واحدًا — تكتب في import_rows فقط.
create or replace function public.import_batch_preview(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches; r record;
  v_err text; v_action text; v_result uuid;
  v_target uuid; v_target_scope text; v_target_client uuid;
  v_stage_keys text[]; v_dup_keys text[];
  v_valid int := 0; v_invalid int := 0; v_create int := 0; v_skip int := 0;
  v_stages int := 0; v_dlv int := 0; v_total int;
  v_warn jsonb := '[]'::jsonb; v_errs jsonb := '[]'::jsonb;
  v_key text; v_ct text; v_sk text; v_status text; v_sched text; v_prio text; v_rec text;
begin
  b := public.import_batch_guard(p_batch, array['draft','previewed','dry_run']);
  v_target := b.target_project_id;

  select count(*) into v_total from public.import_rows where batch_id = p_batch;
  if v_total = 0 then raise exception 'no_rows_loaded'; end if;

  if v_target is null then
    v_warn := v_warn || to_jsonb('target_project_required'::text);
  else
    select p.project_scope, p.client_id into v_target_scope, v_target_client
      from public.projects p where p.id = v_target and coalesce(p.is_deleted,false) = false;
    if v_target_scope is null then v_warn := v_warn || to_jsonb('target_project_not_found'::text); end if;
  end if;

  -- مفاتيح المراحل داخل نفس الملفّ (لحلّ stage_external_key قبل التنفيذ)
  select coalesce(array_agg(external_key), array[]::text[]) into v_stage_keys
    from public.import_rows where batch_id = p_batch and entity_type = 'stage' and external_key is not null;

  -- تكرار المفتاح داخل الملفّ نفسه
  select coalesce(array_agg(external_key), array[]::text[]) into v_dup_keys
    from (select external_key from public.import_rows
           where batch_id = p_batch and external_key is not null
           group by external_key having count(*) > 1) s;

  for r in select * from public.import_rows where batch_id = p_batch order by row_number loop
    v_err := null; v_action := 'create'; v_result := null;
    v_key := nullif(btrim(coalesce(r.external_key,'')),'');

    -- (1) قواعد عامّة
    if v_key is null then
      v_err := 'external_key_required — بدونه لا يمكن ضمان أن التشغيل الثاني لا يُنشئ نسخة ثانية';
    elsif v_key = any (v_dup_keys) then
      v_err := 'duplicate_external_key_in_file — المفتاح مكرّر داخل نفس الملفّ';
    elsif r.entity_type not in ('stage','deliverable') then
      v_err := 'unsupported_entity_type: ' || r.entity_type ||
               ' — المدعوم: stage, deliverable. إنشاء المشاريع الرئيسية يدويّ بقرار المالك.';
    elsif v_target is null or v_target_scope is null then
      v_err := 'target_project_required — أنشئ المشروع الرئيسي بيدك ومرّر معرّفه كهدف للدفعة';
    end if;

    -- (2) قواعد المرحلة
    if v_err is null and r.entity_type = 'stage' then
      if coalesce(btrim(r.payload->>'name'),'') = '' then
        v_err := 'stage_name_required';
      elsif not coalesce(public.import_can_create_stages(), false) then
        v_err := 'stage_creation_requires_can_manage_projects — صلاحية projects.import وحدها لا تكفي لإنشاء مشروع فرعي';
      else
        select id into v_result from public.projects
         where external_key = v_key and coalesce(is_deleted,false) = false limit 1;
        if v_result is not null then v_action := 'skip'; end if;
      end if;
    end if;

    -- (3) قواعد المخرج
    if v_err is null and r.entity_type = 'deliverable' then
      if coalesce(btrim(r.payload->>'title'),'') = '' then
        v_err := 'title_required';
      end if;

      v_ct := nullif(lower(btrim(coalesce(r.payload->>'content_type',''))),'');
      if v_err is null and v_ct is not null
         and not exists (select 1 from public.deliverable_content_types t where t.key = v_ct and t.is_active) then
        v_err := 'unknown_content_type: ' || v_ct || ' — أضِفه إلى deliverable_content_types أو صحّح الملفّ';
      end if;

      v_status := nullif(lower(btrim(coalesce(r.payload->>'status',''))),'');
      if v_err is null and v_status is not null and v_status not in ('draft','internal_review') then
        v_err := 'status_not_allowed_in_import: ' || v_status ||
                 ' — client_review/approved/final_delivered تُطلق إشعارات وبريدًا للعميل لكل صفّ';
      end if;

      v_sched := nullif(lower(btrim(coalesce(r.payload->>'schedule_status',''))),'');
      if v_err is null and v_sched is not null
         and v_sched not in ('awaiting_schedule','scheduled','in_progress','done','on_hold','cancelled') then
        v_err := 'bad_schedule_status: ' || v_sched;
      end if;

      v_prio := nullif(lower(btrim(coalesce(r.payload->>'priority',''))),'');
      if v_err is null and v_prio is not null and v_prio not in ('low','normal','high','urgent') then
        v_err := 'bad_priority: ' || v_prio;
      end if;

      v_rec := nullif(lower(btrim(coalesce(r.payload->>'recurrence_type',''))),'');
      if v_err is null and v_rec is not null
         and v_rec not in ('none','daily','weekly','biweekly','monthly','quarterly','custom') then
        v_err := 'bad_recurrence_type: ' || v_rec;
      end if;

      if v_err is null and coalesce(btrim(r.payload->>'expected_units'),'') <> '' then
        begin
          if (r.payload->>'expected_units')::int < 0 then v_err := 'expected_units_negative'; end if;
        exception when others then v_err := 'expected_units_not_an_integer'; end;
      end if;

      -- المرحلة: إمّا مفتاح مرحلة في نفس الملفّ، أو مرحلة موجودة بالفعل، أو بلا مرحلة.
      v_sk := nullif(btrim(coalesce(r.payload->>'stage_external_key','')),'');
      if v_err is null and v_sk is not null
         and not (v_sk = any (v_stage_keys))
         and not exists (select 1 from public.projects
                          where external_key = v_sk and coalesce(is_deleted,false) = false) then
        v_err := 'stage_not_found: ' || v_sk || ' — لا صفّ مرحلة بهذا المفتاح في الملفّ ولا مرحلة قائمة';
      end if;

      if v_err is null then
        -- ★ idempotency: المفتاح يسكن الجدول الجانبي، فالبحث يمرّ عبره.
        select d.id into v_result
          from public.deliverable_internal i
          join public.deliverables d on d.id = i.deliverable_id
         where i.external_key = v_key and coalesce(d.is_deleted,false) = false limit 1;
        if v_result is not null then v_action := 'skip'; end if;
      end if;
    end if;

    -- (4) تسجيل النتيجة
    if v_err is not null then
      v_action := 'error';
      update public.import_rows set status='invalid', action='error', error=v_err, result_id=null where id = r.id;
      v_invalid := v_invalid + 1;
      if jsonb_array_length(v_errs) < 50 then
        v_errs := v_errs || jsonb_build_object('row_number', r.row_number, 'external_key', v_key, 'error', v_err);
      end if;
    else
      update public.import_rows set status='valid', action=v_action, error=null, result_id=v_result where id = r.id;
      v_valid := v_valid + 1;
      if v_action = 'skip' then v_skip := v_skip + 1; else v_create := v_create + 1; end if;
      if r.entity_type = 'stage' then v_stages := v_stages + 1; else v_dlv := v_dlv + 1; end if;
    end if;
  end loop;

  -- تنبيه شفّاف: هدف standalone سيُرقّى إلى master عند التنفيذ (إن وُجدت مراحل).
  if v_stages > 0 and coalesce(v_target_scope,'') = 'standalone' then
    v_warn := v_warn || to_jsonb('target_will_be_promoted_to_master'::text);
  end if;

  update public.import_batches
     set status = 'previewed', previewed_at = now(), updated_at = now(),
         counts = jsonb_build_object('total', v_total, 'valid', v_valid, 'invalid', v_invalid,
                                     'to_create', v_create, 'to_skip', v_skip,
                                     'stages', v_stages, 'deliverables', v_dlv)
   where id = p_batch;

  perform public.import_audit(p_batch, 'previewed',
    jsonb_build_object('total', v_total, 'valid', v_valid, 'invalid', v_invalid,
                       'to_create', v_create, 'to_skip', v_skip));

  return jsonb_build_object(
    'ok', (v_invalid = 0), 'batch_id', p_batch, 'status', 'previewed',
    'total', v_total, 'valid', v_valid, 'invalid', v_invalid,
    'to_create', v_create, 'to_skip', v_skip,
    'stages', v_stages, 'deliverables', v_dlv,
    'warnings', v_warn, 'errors', v_errs,
    'note_ar', case when v_skip > 0
                 then v_skip || ' صفًّا موجود مسبقًا وسيُتخطّى — التنفيذ لن يُنشئ نسخة ثانية.'
                 else 'لا صفوف مكرّرة — كلّها جديدة.' end);
end $$;

-- ─── 4.4 المحرّك الفعليّ (داخليّ — لا يُمنح لأحد) ────────────────────────────
--     يُطبّق الصفوف الصالحة فقط: المراحل أوّلًا ثم المخرجات (كي تُحلّ المفاتيح).
--     كل صفّ داخل كتلة exception خاصّة ⇒ صفّ واحد فاسد لا يُسقط الدفعة.
create or replace function public.import_batch_execute_core(p_batch uuid, p_allow_partial boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.import_batches; r record;
  v_target uuid; v_client uuid; v_scope text; v_promoted boolean := false;
  v_created int := 0; v_skipped int := 0; v_failed int := 0;
  v_invalid int; v_errs jsonb := '[]'::jsonb;
  v_new uuid; v_proj uuid; v_stage uuid; v_seq int; v_res jsonb;
  v_key text; v_sk text; v_msg text;
begin
  select * into b from public.import_batches where id = p_batch;
  if b.id is null then raise exception 'batch_not_found'; end if;
  v_target := b.target_project_id;
  if v_target is null then raise exception 'target_project_required'; end if;

  select p.id, p.client_id, p.project_scope into v_proj, v_client, v_scope
    from public.projects p where p.id = v_target and coalesce(p.is_deleted,false) = false for update;
  if v_proj is null then raise exception 'target_project_not_found'; end if;

  select count(*) into v_invalid from public.import_rows where batch_id = p_batch and status = 'invalid';
  if v_invalid > 0 and not coalesce(p_allow_partial,false) then
    raise exception 'batch_has_invalid_rows: % — صحّح الملفّ أو مرّر p_allow_partial = true', v_invalid;
  end if;

  -- ترقية الهدف إلى «رئيسي» عند وجود مراحل (شرط حارس الهرمية parent_must_be_master).
  -- معزولة: قاعدة حوكمة في حزمة الهرمية قد ترفضها ⇒ نُعطي رسالة قابلة للتنفيذ
  -- بدل رسالة Trigger غامضة تُسقط الدفعة كلّها بلا تفسير.
  if coalesce(v_scope,'standalone') = 'standalone'
     and exists (select 1 from public.import_rows
                  where batch_id = p_batch and entity_type='stage' and status='valid' and action='create') then
    begin
      update public.projects set project_scope = 'master' where id = v_target;
      v_promoted := true;
      perform public.import_audit(p_batch, 'target_promoted_to_master', jsonb_build_object('project_id', v_target));
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception 'target_promotion_failed: % — رقِّ المشروع الهدف إلى «رئيسي» يدويًّا ثم أعد التنفيذ',
        left(coalesce(v_msg,'unknown'), 200);
    end;
  end if;

  -- ══ المرور الأول: المراحل ══
  for r in select * from public.import_rows
            where batch_id = p_batch and entity_type = 'stage' and status = 'valid'
            order by row_number loop
    v_key := r.external_key; v_new := null; v_msg := null;
    begin
      -- إعادة فحص idempotency داخل نفس المعاملة (TOCTOU)
      select id into v_new from public.projects
       where external_key = v_key and coalesce(is_deleted,false) = false limit 1;

      if v_new is not null then
        update public.import_rows set status='skipped', action='skip', result_id=v_new, applied_at=now()
         where id = r.id;
        v_skipped := v_skipped + 1;
      else
        v_res := public.project_core_create_project(jsonb_build_object(
                   'project_name',      btrim(r.payload->>'name'),
                   'client_id',         v_client::text,
                   'core_stage',        'planning',
                   'description',       nullif(btrim(coalesce(r.payload->>'notes','')),''),
                   'project_scope',     'subproject',
                   'parent_project_id', v_target::text));
        v_new := nullif(v_res->>'project_id','')::uuid;
        if v_new is null then raise exception 'create_project_returned_no_id'; end if;

        -- ضبط الهرمية وحقول الاستيراد صراحةً: النسخة المطبَّقة من
        -- project_core_create_project قد تتجاهل حقول الهرمية (تعدّدت نسخها).
        update public.projects
           set parent_project_id  = v_target,
               project_scope      = 'subproject',
               external_key       = v_key,
               import_batch_id    = p_batch,
               stage_order        = coalesce(nullif(btrim(coalesce(r.payload->>'stage_order','')),'')::int, r.row_number),
               planned_start_date = nullif(btrim(coalesce(r.payload->>'planned_start_date','')),'')::date,
               schedule_status    = coalesce(nullif(lower(btrim(coalesce(r.payload->>'schedule_status',''))),''),
                                             'awaiting_schedule')
         where id = v_new;

        -- ترقيم الفرع إن كان عمود الهرمية موجودًا (اختياريّ)
        if exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='projects' and column_name='sequence_number') then
          execute 'select coalesce(max(sequence_number),0)+1 from public.projects where parent_project_id = $1'
             into v_seq using v_target;
          execute 'update public.projects set sequence_number = coalesce(sequence_number, $2) where id = $1'
            using v_new, v_seq;
        end if;

        update public.import_rows set status='applied', action='create', result_id=v_new, applied_at=now()
         where id = r.id;
        v_created := v_created + 1;
      end if;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      update public.import_rows set status='failed', error=left(coalesce(v_msg,'unknown'), 500) where id = r.id;
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errs) < 50 then
        v_errs := v_errs || jsonb_build_object('row_number', r.row_number, 'entity','stage',
                                               'external_key', v_key, 'error', left(coalesce(v_msg,'unknown'),300));
      end if;
    end;
  end loop;

  -- ══ المرور الثاني: المخرجات ══
  for r in select * from public.import_rows
            where batch_id = p_batch and entity_type = 'deliverable' and status = 'valid'
            order by row_number loop
    v_key := r.external_key; v_new := null; v_msg := null;
    begin
      -- إعادة فحص idempotency داخل نفس المعاملة (TOCTOU) — عبر الجدول الجانبي.
      select d.id into v_new
        from public.deliverable_internal i
        join public.deliverables d on d.id = i.deliverable_id
       where i.external_key = v_key and coalesce(d.is_deleted,false) = false limit 1;

      if v_new is not null then
        update public.import_rows set status='skipped', action='skip', result_id=v_new, applied_at=now()
         where id = r.id;
        v_skipped := v_skipped + 1;
      else
        -- حلّ المرحلة: صفّ مرحلة في نفس الدفعة، أو مرحلة قائمة بنفس المفتاح.
        v_sk := nullif(btrim(coalesce(r.payload->>'stage_external_key','')),'');
        v_stage := null;
        if v_sk is not null then
          select id into v_stage from public.projects
           where external_key = v_sk and coalesce(is_deleted,false) = false limit 1;
          if v_stage is null then raise exception 'stage_not_created: %', v_sk; end if;
        end if;
        -- المخرج يسكن مشروع المرحلة (إن وُجدت) كي يظهر تقدّم المرحلة على المرحلة نفسها.
        v_proj := coalesce(v_stage, v_target);

        insert into public.deliverables (
          project_id, stage_id, title, content_type, status,
          platforms, execution_details, proposed_caption, priority, client_visible,
          schedule_status, planned_start_date, due_date,
          expected_units, completed_units, recurrence_type, recurrence_config,
          requires_shooting, requires_editing, requires_design, requires_printing,
          sort_order)
        values (
          v_proj, v_stage,
          btrim(r.payload->>'title'),
          coalesce(nullif(lower(btrim(coalesce(r.payload->>'content_type',''))),''), 'custom'),
          coalesce(nullif(lower(btrim(coalesce(r.payload->>'status',''))),''), 'draft'),
          public.import_text_array(r.payload->'platforms'),
          nullif(btrim(coalesce(r.payload->>'execution_details','')),''),
          nullif(btrim(coalesce(r.payload->>'proposed_caption','')),''),
          nullif(lower(btrim(coalesce(r.payload->>'priority',''))),''),
          coalesce((nullif(btrim(coalesce(r.payload->>'client_visible','')),''))::boolean, false),
          coalesce(nullif(lower(btrim(coalesce(r.payload->>'schedule_status',''))),''), 'awaiting_schedule'),
          nullif(btrim(coalesce(r.payload->>'planned_start_date','')),'')::date,
          nullif(btrim(coalesce(r.payload->>'due_date','')),'')::date,
          nullif(btrim(coalesce(r.payload->>'expected_units','')),'')::int,
          coalesce(nullif(btrim(coalesce(r.payload->>'completed_units','')),'')::int, 0),
          coalesce(nullif(lower(btrim(coalesce(r.payload->>'recurrence_type',''))),''), 'none'),
          case when jsonb_typeof(r.payload->'recurrence_config') = 'object'
               then r.payload->'recurrence_config' else null end,
          coalesce((nullif(btrim(coalesce(r.payload->>'requires_shooting','')),''))::boolean, false),
          coalesce((nullif(btrim(coalesce(r.payload->>'requires_editing','')),''))::boolean, false),
          coalesce((nullif(btrim(coalesce(r.payload->>'requires_design','')),''))::boolean, false),
          coalesce((nullif(btrim(coalesce(r.payload->>'requires_printing','')),''))::boolean, false),
          coalesce(nullif(btrim(coalesce(r.payload->>'sort_order','')),'')::int, r.row_number))
        returning id into v_new;

        -- ★ الحقول الداخلية في الجدول الجانبي — العميل لا يرى صفًّا منها.
        --   الإدراجان داخل كتلة begin/exception واحدة: أيّ إخفاق (ومنه
        --   unique_violation على external_key) يتراجع عن **الاثنين** معًا
        --   بفضل نقطة الحفظ الضمنية لكتلة PL/pgSQL ⇒ لا مخرج يتيم بلا مفتاح.
        insert into public.deliverable_internal (
          deliverable_id, internal_notes, external_key, import_batch_id,
          source_row_number, source_file_name, metadata)
        values (
          v_new,
          nullif(btrim(coalesce(r.payload->>'internal_notes','')),''),
          v_key, p_batch, r.row_number, b.source_file_name,
          case when jsonb_typeof(r.payload->'metadata') = 'object' then r.payload->'metadata' else '{}'::jsonb end);

        update public.import_rows set status='applied', action='create', result_id=v_new, applied_at=now()
         where id = r.id;
        v_created := v_created + 1;
      end if;
    exception
      when unique_violation then
        -- سباق: صفّ آخر أنشأه بيننا. هذا **نجاح** للـ idempotency لا فشل.
        -- كتلة begin/exception تراجعت عن إدراجَي المخرج والجدول الجانبي معًا،
        -- فلا يبقى مخرج بلا مفتاح. نلتقط الصفّ الفائز ونُعلنه تخطّيًا.
        select i.deliverable_id into v_new
          from public.deliverable_internal i where i.external_key = v_key limit 1;
        update public.import_rows set status='skipped', action='skip', result_id=v_new, applied_at=now()
         where id = r.id;
        v_skipped := v_skipped + 1;
      when others then
        get stacked diagnostics v_msg = message_text;
        update public.import_rows set status='failed', error=left(coalesce(v_msg,'unknown'), 500) where id = r.id;
        v_failed := v_failed + 1;
        if jsonb_array_length(v_errs) < 50 then
          v_errs := v_errs || jsonb_build_object('row_number', r.row_number, 'entity','deliverable',
                                                 'external_key', v_key, 'error', left(coalesce(v_msg,'unknown'),300));
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'batch_id', p_batch, 'created', v_created, 'skipped', v_skipped, 'failed', v_failed,
    'invalid', v_invalid, 'target_promoted_to_master', v_promoted, 'errors', v_errs);
end $$;

-- ─── 4.5 التشغيل التجريبي — ينفّذ كل شيء ثم **يتراجع** ──────────────────────
--     الحيلة: نستدعي المحرّك داخل كتلة، ثم نرفع استثناءً مقصودًا يُسقط المعاملة
--     الفرعية (فتزول كل الكتابات)، ونمرّر التقرير في حقل DETAIL كي ينجو من
--     التراجع. ثم نسجّل حدث التدقيق **بعد** الالتقاط فيبقى محفوظًا.
create or replace function public.import_batch_dry_run(p_batch uuid, p_allow_partial boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.import_batches; v_detail text; v_report jsonb;
begin
  b := public.import_batch_guard(p_batch, array['draft','previewed','dry_run']);
  begin
    v_report := public.import_batch_execute_core(p_batch, p_allow_partial);
    raise exception using errcode = 'KI001', message = 'DRY_RUN_ROLLBACK', detail = v_report::text;
  exception
    when sqlstate 'KI001' then
      get stacked diagnostics v_detail = pg_exception_detail;
      v_report := v_detail::jsonb;
    when others then
      get stacked diagnostics v_detail = message_text;
      v_report := jsonb_build_object('aborted', true, 'error', left(coalesce(v_detail,'unknown'), 500));
  end;

  update public.import_batches
     set status = case when coalesce((v_report->>'aborted')::boolean,false) then 'failed' else 'dry_run' end,
         dry_run_at = now(), updated_at = now(),
         counts = coalesce(counts,'{}'::jsonb) || jsonb_build_object('dry_run', v_report)
   where id = p_batch;
  perform public.import_audit(p_batch, 'dry_run', v_report);

  return jsonb_build_object('ok', not coalesce((v_report->>'aborted')::boolean,false),
                            'dry_run', true, 'committed', false,
                            'batch_id', p_batch, 'report', v_report,
                            'note_ar', 'تشغيل تجريبي: لم يُكتب أيّ صفّ حقيقي — الأرقام أعلاه هي ما سيحدث عند التنفيذ.');
end $$;

-- ─── 4.6 التنفيذ الحقيقي ────────────────────────────────────────────────────
create or replace function public.import_batch_execute(p_batch uuid, p_allow_partial boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.import_batches; v_report jsonb; v_status text;
begin
  -- الدفعة المنفَّذة لا تُنفَّذ مرّتين: تُعيد تقريرها بلا أيّ كتابة.
  select * into b from public.import_batches where id = p_batch;
  if b.id is not null and b.status = 'executed' then
    if not coalesce(public.import_can_manage(), false) then raise exception 'not authorized'; end if;
    return jsonb_build_object('ok', true, 'batch_id', p_batch, 'status', 'executed',
      'created', 0, 'skipped', 0, 'noop', true,
      'note_ar', 'هذه الدفعة نُفِّذت من قبل — لم يُنشأ شيء. لإعادة استيراد نفس الملفّ أنشئ دفعة جديدة (ستتخطّى كل صفّ موجود).');
  end if;

  -- import_batch_guard يأخذ FOR UPDATE على صفّ الدفعة ⇒ تنفيذان متزامنان يتسلسلان،
  -- والخاسر يُعيد قراءة الصفّ فيجده 'executed' فيرفض. لا حاجة إلى قفل إضافي.
  b := public.import_batch_guard(p_batch, array['previewed','dry_run','partially_executed']);

  v_report := public.import_batch_execute_core(p_batch, p_allow_partial);

  v_status := case when coalesce((v_report->>'failed')::int,0) > 0 then 'partially_executed' else 'executed' end;
  update public.import_batches
     set status = v_status, executed_at = now(), executed_by = auth.uid(), updated_at = now(),
         counts = coalesce(counts,'{}'::jsonb) || jsonb_build_object('execution', v_report)
   where id = p_batch;
  perform public.import_audit(p_batch, 'executed', v_report);

  return jsonb_build_object('ok', true, 'batch_id', p_batch, 'status', v_status,
    'created', coalesce((v_report->>'created')::int,0),
    'skipped', coalesce((v_report->>'skipped')::int,0),
    'failed',  coalesce((v_report->>'failed')::int,0),
    'report', v_report,
    'note_ar', 'تشغيل نفس الملفّ مجدّدًا في دفعة جديدة سيتخطّى كل صفّ أُنشئ هنا ولن يُنشئ نسخة ثانية.');
end $$;

-- ─── 4.7 التقرير والقائمة والإلغاء ──────────────────────────────────────────
create or replace function public.import_batch_report(p_batch uuid, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.import_batches; v_rows jsonb; v_ev jsonb;
begin
  if not coalesce(public.import_can_manage(), false) then raise exception 'not authorized'; end if;
  select * into b from public.import_batches where id = p_batch;
  if b.id is null then raise exception 'batch_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'row_number', x.row_number, 'entity_type', x.entity_type, 'external_key', x.external_key,
           'action', x.action, 'status', x.status, 'error', x.error, 'result_id', x.result_id
         ) order by x.row_number), '[]'::jsonb) into v_rows
    from (select * from public.import_rows where batch_id = p_batch
           order by row_number limit greatest(coalesce(p_limit,500),1)) x;

  select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'at', e.created_at, 'detail', e.detail)
           order by e.created_at desc), '[]'::jsonb) into v_ev
    from (select * from public.import_batch_events where batch_id = p_batch
           order by created_at desc limit 50) e;

  return jsonb_build_object(
    'batch', jsonb_build_object('id', b.id, 'profile', b.profile, 'source_file_name', b.source_file_name,
                                'target_project_id', b.target_project_id, 'status', b.status,
                                'counts', b.counts, 'notes', b.notes,
                                'created_at', b.created_at, 'previewed_at', b.previewed_at,
                                'dry_run_at', b.dry_run_at, 'executed_at', b.executed_at),
    'rows', v_rows, 'events', v_ev);
end $$;

create or replace function public.import_batch_list(p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.import_can_manage(), false) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'profile', b.profile, 'source_file_name', b.source_file_name,
           'target_project_id', b.target_project_id, 'status', b.status, 'counts', b.counts,
           'created_at', b.created_at, 'executed_at', b.executed_at) order by b.created_at desc), '[]'::jsonb)
    into v
    from (select * from public.import_batches order by created_at desc
           limit greatest(coalesce(p_limit,50),1) offset greatest(coalesce(p_offset,0),0)) b;
  return coalesce(v, '[]'::jsonb);
end $$;

create or replace function public.import_batch_cancel(p_batch uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.import_batches;
begin
  b := public.import_batch_guard(p_batch, array['draft','previewed','dry_run']);
  update public.import_batches set status='cancelled', updated_at=now(),
         notes = coalesce(notes,'') || case when coalesce(btrim(p_reason),'') <> ''
                                            then E'\n[cancelled] ' || btrim(p_reason) else '' end
   where id = p_batch;
  perform public.import_audit(p_batch, 'cancelled', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'batch_id', p_batch, 'status', 'cancelled',
    'note_ar', 'أُلغيت الدفعة. لم يُمسّ أيّ مشروع أو مخرج — الإلغاء يخصّ صفوف الـ staging فقط.');
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- §5) RLS والمنح — لا شيء لـ anon، والكتابة عبر الدوالّ حصرًا
--     لا سياسة INSERT/UPDATE/DELETE على الجداول الثلاثة إطلاقًا ⇒ الكتابة
--     المباشرة من PostgREST مرفوضة دائمًا، حتى لمن يملك صلاحية الاستيراد.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.import_batches      enable row level security;
alter table public.import_rows         enable row level security;
alter table public.import_batch_events enable row level security;

drop policy if exists import_batches_read on public.import_batches;
create policy import_batches_read on public.import_batches for select to authenticated
  using (coalesce(public.import_can_manage(), false));

drop policy if exists import_rows_read on public.import_rows;
create policy import_rows_read on public.import_rows for select to authenticated
  using (coalesce(public.import_can_manage(), false));

drop policy if exists import_events_read on public.import_batch_events;
create policy import_events_read on public.import_batch_events for select to authenticated
  using (coalesce(public.import_can_manage(), false));

revoke all on public.import_batches      from public, anon;
revoke all on public.import_rows         from public, anon;
revoke all on public.import_batch_events from public, anon;
grant select on public.import_batches, public.import_rows, public.import_batch_events to authenticated;

do $g$
declare f text;
begin
  foreach f in array array[
    'public.import_can_manage()',
    'public.import_can_create_stages()',
    'public.import_text_array(jsonb)',
    'public.import_batch_create(text,text,uuid,text)',
    'public.import_batch_load_rows(uuid,jsonb)',
    'public.import_batch_preview(uuid)',
    'public.import_batch_dry_run(uuid,boolean)',
    'public.import_batch_execute(uuid,boolean)',
    'public.import_batch_report(uuid,int)',
    'public.import_batch_list(int,int)',
    'public.import_batch_cancel(uuid,text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

-- داخليّة بحتة: لا تُمنح لأحد. استدعاؤها المباشر كان سيُنفّذ بلا معاينة ولا تراجع.
revoke all on function public.import_batch_execute_core(uuid,boolean) from public, anon, authenticated;
revoke all on function public.import_batch_guard(uuid,text[])         from public, anon, authenticated;
revoke all on function public.import_audit(uuid,text,jsonb)           from public, anon, authenticated;

do $perm$
begin
  if to_regclass('public.permissions') is not null then
    insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
      ('projects.import','projects','sensitive',1040,'الاستيراد الجماعي للمشاريع','Bulk project import')
    on conflict (key) do nothing;
  end if;
end $perm$;

comment on table public.import_batches is
  'دفعة استيراد: ملفّ واحد + ملفّ تعيين + مشروع هدف. لا تُنشأ منها بيانات إلّا عبر import_batch_execute.';
comment on table public.import_rows is
  'صفوف staging. external_key إلزاميّ وهو أساس idempotency: التنفيذ الثاني يتخطّى ولا يُنشئ.';
comment on table public.import_batch_events is
  'أثر التدقيق لكل انتقال حالة على مستوى الدفعة (إنشاء/تحميل/معاينة/تجريبي/تنفيذ/إلغاء).';
comment on function public.import_batch_dry_run(uuid,boolean) is
  'ينفّذ المحرّك كاملًا ثم يتراجع عبر استثناء مقصود؛ التقرير يُمرَّر في DETAIL كي ينجو من التراجع.';


-- ════════════════════════════════════════════════════════════════════════════
-- §6) الفحص الذاتي — أيّ إخفاق يُجهض المعاملة كلّها
-- ════════════════════════════════════════════════════════════════════════════
do $self$
declare v text := ''; f text; v_before int; v_after int; n int;
begin
  if to_regclass('public.import_batches')      is null then v := v || ' import_batches'; end if;
  if to_regclass('public.import_rows')         is null then v := v || ' import_rows'; end if;
  if to_regclass('public.import_batch_events') is null then v := v || ' import_batch_events'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects' and column_name='external_key')
    then v := v || ' projects.external_key'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_projects_external_key')
    then v := v || ' ux_projects_external_key'; end if;
  -- idempotency المخرجات تعتمد على الجدول الجانبي وفهرسه الفريد.
  if to_regclass('public.deliverable_internal') is null
    then v := v || ' public.deliverable_internal'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then v := v || ' ux_deliverable_internal_external_key'; end if;

  foreach f in array array[
    'public.import_can_manage()','public.import_can_create_stages()','public.import_text_array(jsonb)',
    'public.import_batch_create(text,text,uuid,text)','public.import_batch_load_rows(uuid,jsonb)',
    'public.import_batch_preview(uuid)','public.import_batch_dry_run(uuid,boolean)',
    'public.import_batch_execute(uuid,boolean)','public.import_batch_execute_core(uuid,boolean)',
    'public.import_batch_report(uuid,int)','public.import_batch_list(int,int)',
    'public.import_batch_cancel(uuid,text)','public.import_audit(uuid,text,jsonb)',
    'public.import_batch_guard(uuid,text[])']
  loop
    if to_regprocedure(f) is null then v := v || ' fn:' || f; end if;
  end loop;
  if v <> '' then raise exception 'SELF-TEST FAIL — كائنات مفقودة:%', v; end if;

  -- ★ لا مشروع ولا مخرج أُنشئ بالترحيل ★
  v_before := coalesce(nullif(current_setting('kian.bi_projects_before', true),''),'-1')::int;
  select count(*) into v_after from public.projects;
  if v_before >= 0 and v_before <> v_after then
    raise exception 'SELF-TEST FAIL — تغيّر عدد المشاريع من % إلى % (الترحيل يجب ألّا يُنشئ مشروعًا)', v_before, v_after;
  end if;
  v_before := coalesce(nullif(current_setting('kian.bi_deliverables_before', true),''),'-1')::int;
  select count(*) into v_after from public.deliverables;
  if v_before >= 0 and v_before <> v_after then
    raise exception 'SELF-TEST FAIL — تغيّر عدد المخرجات من % إلى %', v_before, v_after;
  end if;

  -- ★ استحالة الصفوف اليتيمة — تُفحص **بالقيد** لا بالعدّ ★
  --   الصيغة السابقة (`if n > 0 and not exists (select 1 from import_batches)`)
  --   كانت **لا تفشل أبدًا**: import_rows.batch_id عمود not null بمفتاح خارجيّ
  --   إلى import_batches، فوجود صفّ واحد يضمن رياضيًّا وجود دفعة تقابله. فحص
  --   يطبع PASS ولا يُثبت شيئًا. الضمانة الحقيقية هي القيد نفسه ⇒ نفحصه هو.
  select count(*) into n from pg_constraint
   where conrelid = 'public.import_rows'::regclass and contype = 'f'
     and confrelid = 'public.import_batches'::regclass;
  if n = 0 then
    raise exception 'SELF-TEST FAIL — لا مفتاح خارجيّ من import_rows إلى import_batches ⇒ صفوف staging يتيمة ممكنة'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='import_rows'
                and column_name='batch_id' and is_nullable='YES') then
    raise exception 'SELF-TEST FAIL — import_rows.batch_id يقبل NULL ⇒ صفّ staging بلا دفعة';
  end if;

  -- ★ لا منح لـ anon ★
  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and grantee='anon'
     and table_name in ('import_batches','import_rows','import_batch_events');
  if n > 0 then raise exception 'SELF-TEST FAIL — anon يملك % صلاحية على جداول الاستيراد', n; end if;
  select count(*) into n from information_schema.role_routine_grants
   where routine_schema='public' and grantee in ('anon','authenticated')
     and routine_name in ('import_batch_execute_core','import_batch_guard','import_audit');
  if n > 0 then raise exception 'SELF-TEST FAIL — دالّة داخلية ممنوحة (%)', n; end if;

  -- ★ لا سياسة كتابة مباشرة على جداول الاستيراد ★
  select count(*) into n from pg_policies
   where schemaname='public' and tablename in ('import_batches','import_rows','import_batch_events')
     and cmd <> 'SELECT';
  if n > 0 then raise exception 'SELF-TEST FAIL — % سياسة كتابة مباشرة (يجب أن تكون الكتابة عبر الدوالّ فقط)', n; end if;

  raise notice 'BULK_IMPORT SELF-TEST: PASS — 3 جداول · 11 دالّة مُتاحة + 3 داخلية · لا مشروع/مخرج أُنشئ · لا منح anon.';
end $self$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ دورة الاستعمال (تُنفَّذ من الواجهة، لا من هنا) ★
--   1. select public.import_batch_create('<profile>', '<file.xlsx>', '<target_project_uuid>');
--   2. select public.import_batch_load_rows('<batch>', '[ … ]'::jsonb);
--   3. select public.import_batch_preview('<batch>');    ← اقرأ invalid/errors
--   4. select public.import_batch_dry_run('<batch>');    ← لا يُكتب شيء
--   5. select public.import_batch_execute('<batch>');    ← التنفيذ الحقيقي
--   إعادة نفس الملفّ: كرّر 1→5 بدفعة جديدة. الخطوة 5 ستُنشئ **صفرًا** وتتخطّى الكلّ.
--
-- ثم شغّل docs/project_bulk_import_POSTCHECK.sql.
-- ════════════════════════════════════════════════════════════════════════════
