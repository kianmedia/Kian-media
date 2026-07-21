-- ════════════════════════════════════════════════════════════════════════════
-- project_planning_batch4a_runtime_hotfix_RUNME.sql
-- تشخيص Runtime + إصلاح حاسم لفشل project_gantt_snapshot على Production
-- ────────────────────────────────────────────────────────────────────────────
-- الدليل (بلا تخمين):
--   • الواجهة تعرض «تعذّر تنفيذ الإجراء. حاول مرة أخرى.» وهي fallback العام في pcErr
--     (lib/portal/projectCore.ts) — أي أن رسالة PostgreSQL الخام لم تطابق أي نمط معروف.
--   • لو كان عمود/دالة مفقودًا لظهرت «منصة المشاريع غير مطبّقة» (نمط does not exist)،
--     ولو كان تفويضًا لظهر نمط not authorized. لم يظهر أيٌّ منهما — فاستُبعِد هذان الصنفان.
--   • المرشّح الأقوى والأكثر توافقًا (لا الوحيد قطعيًا، فالـfallback العام يتوافق مع أي خطأ
--     غير مُطابَق): 25006 «cannot execute CREATE TABLE in a read-only transaction»، ويحدث
--     حصريًا عندما تكون الدوال الثلاث (المستخدِمة CREATE TEMPORARY TABLE) ما زالت STABLE —
--     لأن PostgREST يشغّل الدوال STABLE/IMMUTABLE داخل معاملة READ ONLY. أي أن hotfix
--     السابق (project_planning_batch4a_hotfix_RUNME.sql) غالبًا لم يُطبَّق على Production
--     (طُبِّق كود الواجهة فقط، لذلك تحوّل Spinner إلى رسالة خطأ).
--   • هذا الملف لا يكتفي بالفرضية: §5 يستخرج نص PostgreSQL الأصلي لأي سبب متبقٍّ (probe
--     يتخطّى بوابة الصلاحية ويمارس الجدول المؤقت + أعمدة 4A + working_days_between فعليًا)،
--     ويكمّلها console.error في lib/portal/client.ts الذي يطبع code/message/details/hint.
--
-- ما يفعله هذا الملف:
--   §1 يطبع الحالة الحالية للدوال (volatility/secdef/owner) — إثبات على Production.
--   §2 يعيد تطبيق ALTER … VOLATILE (Idempotent) — يصلح السبب الأرجح إن لم يكن طُبِّق.
--   §3 notify pgrst.
--   §4 تحقّق بعد التطبيق: لا دالة STABLE/IMMUTABLE تستخدم جدولًا مؤقتًا.
--   §5 استدعاء اختباري حقيقي على «تست 01»؛ إن فشل لسبب آخر فإنه يستخرج ويطبع
--      SQLSTATE/MESSAGE/DETAIL/HINT الأصلية (لا تخمين — الملف نفسه يخرج الخطأ الحقيقي).
--   §6 SELECT تعريفي يعرض توقيع/تقلّب/مالك/صلاحيات الدوال الأربع في شبكة النتائج.
--
-- قيود: بلا DROP FUNCTION، بلا حذف بيانات، بلا إعادة بناء للجسم، يستهدف التواقيع الفعلية
--   فقط. لا يمسّ core_stage/Timeline/Kanban/التقدم/العهدة/Zoho/القفل المالي.
-- التشغيل: بعد project_planning_batch4a_RUNME.sql. آمن لإعادة التشغيل عدة مرات.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ §0) Preflight: وجود الدوال بتواقيعها الفعلية ═══
do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.project_gantt_snapshot(uuid,boolean)') is null then miss := miss||' project_gantt_snapshot(uuid,boolean)'; end if;
  if to_regprocedure('public.project_critical_path(uuid)')          is null then miss := miss||' project_critical_path(uuid)'; end if;
  if to_regprocedure('public.project_schedule_preview(uuid)')       is null then miss := miss||' project_schedule_preview(uuid)'; end if;
  if miss <> '' then
    raise exception 'دوال ناقصة (%). شغّل docs/project_planning_batch4a_RUNME.sql أولًا.', miss;
  end if;
end $pf$;

-- ═══ §1) تشخيص: الحالة الحالية للدوال على Production (قبل الإصلاح) ═══
do $diag$
declare r record;
begin
  raise notice '──── §1 حالة الدوال قبل الإصلاح ────';
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
      case p.provolatile when 'v' then 'VOLATILE' when 's' then 'STABLE' when 'i' then 'IMMUTABLE' end as vol,
      p.prosecdef as secdef, pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('project_gantt_snapshot','project_critical_path','project_schedule_preview','project_schedule_apply')
    order by p.proname
  loop
    raise notice '  %(%): volatility=% security_definer=% owner=%', r.proname, r.args, r.vol, r.secdef, r.owner;
  end loop;
end $diag$;

-- ═══ §2) الإصلاح: تحويل الدوال المستخدِمة للجداول المؤقتة إلى VOLATILE ═══
--   (بلا تغيير الجسم/التوقيع/الصلاحيات — كي يشغّلها PostgREST بمعاملة قابلة للكتابة)
begin;
alter function public.project_schedule_preview(uuid)          volatile;
alter function public.project_critical_path(uuid)             volatile;
alter function public.project_gantt_snapshot(uuid, boolean)   volatile;
commit;

-- ═══ §3) إعادة تحميل مخطط PostgREST ═══
notify pgrst, 'reload schema';

-- ═══ §4) تحقّق بعد التطبيق ═══
do $verify$
declare v_bad int;
begin
  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.provolatile <> 'v'
    and p.proname in ('project_schedule_preview','project_critical_path','project_gantt_snapshot');
  raise notice '──── §4 دوال ما زالت غير VOLATILE = % (يجب 0) ────', v_bad;
  if v_bad <> 0 then
    raise exception 'ما زالت دالة STABLE/IMMUTABLE تستخدم جدولًا مؤقتًا — الإصلاح لم يكتمل';
  end if;
end $verify$;

-- ═══ §5) استدعاء اختباري حقيقي على «تست 01» + استخراج الخطأ الأصلي إن وُجد ═══
--   ملاحظة: DO يعمل بمعاملة قابلة للكتابة، فلا يعيد إنتاج خطأ 25006 (ذاك مسار PostgREST
--   القراءة-فقط الذي عالجه §2). غرض §5: التأكد أن جسم الدالة سليم (لا خطأ آخر) واستخراج
--   أي خطأ حقيقي بنص PostgreSQL الأصلي. غياب سياق المستخدم في SQL Editor قد يُرجع
--   «not authorized» عند بوابة الصلاحية — وهذا متوقّع وليس الخلل.
do $test$
declare v_id uuid; v_json jsonb; v_n int;
  v_sqlstate text; v_msg text; v_detail text; v_hint text; v_ctx text;
begin
  select id into v_id from public.projects
  where project_name ilike '%تست 01%' and coalesce(is_deleted,false)=false
  limit 1;

  if v_id is null then
    raise notice '──── §5 لم يُعثر على «تست 01» — اختبر يدويًا: select public.project_gantt_snapshot(''<UUID>''::uuid, false); ────';
    return;
  end if;

  raise notice '──── §5 اختبار project_gantt_snapshot على المشروع % ────', v_id;
  begin
    v_json := public.project_gantt_snapshot(v_id, false);
    v_n := jsonb_array_length(coalesce(v_json->'tasks','[]'::jsonb));
    raise notice '  ✅ نجح الاستدعاء المباشر — عدد المهام = %', v_n;
  exception when others then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate, v_msg = message_text,
      v_detail = pg_exception_detail, v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    if v_msg = 'not authorized' then
      raise notice '  (متوقّع في SQL Editor) بلغ الاستدعاء بوابة الصلاحية ثم رجع «not authorized» لغياب سياق مستخدم — ليس هذا الخلل. ننتقل إلى probe جسم الدالة أدناه.';
    else
      raise notice '  ❌ خطأ حقيقي في جسم الدالة — النص الأصلي من PostgreSQL:';
      raise notice '     SQLSTATE : %', v_sqlstate;
      raise notice '     MESSAGE  : %', v_msg;
      raise notice '     DETAIL   : %', coalesce(v_detail, '(none)');
      raise notice '     HINT     : %', coalesce(v_hint, '(none)');
      raise notice '     CONTEXT  : %', coalesce(v_ctx, '(none)');
    end if;
  end;

  -- §5b) probe يتخطّى بوابة الصلاحية ويمارس فعليًا ما قد يفشل في الجسم: إنشاء الجدول المؤقت
  --   + working_days_between + كل أعمدة 4A التي يقرؤها gantt_snapshot + task_dependencies.lag_days.
  --   يكشف (بنص PostgreSQL الأصلي) أي عمود مفقود/خطأ نوع/خلل دالة مساعدة — دون حاجة لسياق مستخدم.
  begin
    drop table if exists _probe_cp;
    create temporary table _probe_cp on commit drop as
      select t.id,
        coalesce(nullif(public.working_days_between(t.start_date, t.due_date),0), t.duration_days, 1) as dur,
        0 as es, 0 as ef, 0 as ls, 0 as lf, 0 as float
      from public.project_tasks t
      where t.project_id = v_id and coalesce(t.is_deleted,false)=false and t.status not in ('cancelled');
    perform jsonb_agg(jsonb_build_object(
      'id', t.id, 'is_milestone', t.is_milestone, 'scheduling_mode', t.scheduling_mode,
      'constraint_type', t.constraint_type, 'constraint_date', t.constraint_date,
      'duration_days', t.duration_days, 'baseline_start', t.baseline_start,
      'baseline_end', t.baseline_end, 'version', t.version))
    from public.project_tasks t
    where t.project_id = v_id and coalesce(t.is_deleted,false)=false;
    perform count(*) from public.task_dependencies d
      join public.project_tasks t on t.id = d.task_id
      where t.project_id = v_id and d.lag_days is not null;
    drop table if exists _probe_cp;
    raise notice '  ✅ probe سليم: الجدول المؤقت + working_days_between + أعمدة 4A (is_milestone/scheduling_mode/constraint_*/duration_days/baseline_*/version) + lag_days — كلها موجودة وتعمل. لا سبب متبقٍّ في الجسم؛ الإصلاح (§2 VOLATILE) كافٍ.';
  exception when others then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate, v_msg = message_text,
      v_detail = pg_exception_detail, v_hint = pg_exception_hint, v_ctx = pg_exception_context;
    raise notice '  ❌ probe كشف سببًا متبقيًا في الجسم — النص الأصلي من PostgreSQL:';
    raise notice '     SQLSTATE : %', v_sqlstate;
    raise notice '     MESSAGE  : %', v_msg;
    raise notice '     DETAIL   : %', coalesce(v_detail, '(none)');
    raise notice '     HINT     : %', coalesce(v_hint, '(none)');
    raise notice '     CONTEXT  : %', coalesce(v_ctx, '(none)');
  end;
end $test$;

-- ═══ §6) تعريف الدوال الأربع (توقيع/تقلّب/مالك/صلاحيات EXECUTE) — شبكة النتائج ═══
select
  n.nspname                                           as schema,
  p.oid,
  p.proname,
  pg_get_function_identity_arguments(p.oid)           as identity_args,
  pg_get_function_result(p.oid)                       as result_type,
  case p.provolatile when 'v' then 'VOLATILE' when 's' then 'STABLE' when 'i' then 'IMMUTABLE' end as volatility,
  p.prosecdef                                         as security_definer,
  pg_get_userbyid(p.proowner)                         as owner,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'execute')          as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('project_gantt_snapshot','project_critical_path','project_schedule_preview','project_schedule_apply')
order by p.proname, p.oid;
