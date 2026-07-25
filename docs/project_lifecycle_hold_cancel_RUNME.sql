-- ════════════════════════════════════════════════════════════════════════════
-- project_lifecycle_hold_cancel_RUNME.sql        (PROJECT PLATFORM V1 CLOSURE)
--
-- الهدف: إكمال دورة حياة المشروع بحالتَي «تعليق» و«إلغاء» — وهما الحالتان الوحيدتان
-- من دورة الحياة المطلوبة غير الممثَّلتين في القاعدة (تحقّقتُ حيًّا: CHECK على
-- project_core.core_stage يسمح بـ13 قيمة ليس فيها on_hold ولا cancelled).
--
-- ★ لا يُعاد بناء أي شيء. لا يُمَسّ project_core_set_stage القائم إطلاقًا ★
--   السبب: تلك الدالّة مُعرَّفة في أربعة ملفّات SQL مختلفة ولا يمكن الجزم بأي نسخة
--   هي المنشورة حاليًّا، فاستبدالها يخاطر بإسقاط حرّاس انتقال قائمة وتعمل. لذلك:
--     • نُوسِّع قيد CHECK فقط (توسيع لا يُبطِل أي صفّ قائم).
--     • نُضيف دالّة واحدة مخصّصة project_core_hold_action للتعليق/الاستئناف/الإلغاء.
--     • المسار الخطّي (planning→ready→…→closed) يبقى حصريًّا لـproject_core_set_stage،
--       وهي سترفض on_hold/cancelled بـ'bad_stage' — وهذا سلوك صحيح ومقصود:
--       التعليق إجراء تشغيليّ بسبب إلزاميّ، لا خطوة في المسار.
--
-- ★ الاستئناف بلا عمود جديد ★ مرحلة ما قبل التعليق تُقرأ من project_status_history
--   (from_stage لآخر انتقال إلى on_hold) — فلا تكرار للبيانات ولا عمود إضافيّ.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات ·
-- SECURITY DEFINER + search_path ثابت · Self-test داخل DO.
-- التشغيل: psql "$DATABASE_URL" -f docs/project_lifecycle_hold_cancel_RUNME.sql
-- المتطلّبات السابقة: project_core_FINAL_RUNME.sql (جدول project_core + status_history)
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.project_core') is null then raise exception 'PREFLIGHT: project_core missing — run project_core_FINAL_RUNME.sql first'; end if;
  if to_regclass('public.project_status_history') is null then raise exception 'PREFLIGHT: project_status_history missing'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then raise exception 'PREFLIGHT: can_manage_projects() missing'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then raise exception 'PREFLIGHT: pc_log missing'; end if;
end $pre$;

begin;

-- ─── §1 توسيع قيد المرحلة ليقبل on_hold / cancelled ───────────────────────────
-- توسيعٌ فقط: كل صفّ قائم يبقى صالحًا. نكتشف اسم القيد ديناميكيًّا (أُنشئ inline).
do $widen$
declare v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'project_core'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%core_stage%'
  limit 1;

  if v_con is not null then
    -- إن كان القيد يسمح فعلًا بـon_hold فلا شيء لعمله (إعادة تشغيل آمنة).
    if exists (select 1 from pg_constraint c where c.conname = v_con
               and pg_get_constraintdef(c.oid) like '%on_hold%') then
      raise notice 'LIFECYCLE: core_stage already allows on_hold/cancelled — skipping.';
      return;
    end if;
    execute format('alter table public.project_core drop constraint %I', v_con);
  end if;

  alter table public.project_core
    add constraint project_core_core_stage_check
    check (core_stage in ('lead_approved','project_created','planning','ready','scheduled',
                          'in_production','post_production','internal_review','client_review',
                          'revision','approved','delivered','closed',
                          'on_hold','cancelled'));
end $widen$;

-- ─── §2 إجراء التعليق / الاستئناف / الإلغاء ───────────────────────────────────
-- p_action: 'hold' | 'resume' | 'cancel'
-- • السبب إلزاميّ في الثلاثة (متطلّب صريح: أسباب إلزاميّة للـOverride والإغلاق الاستثنائيّ).
-- • الصلاحية: إدارة المشاريع فقط (can_manage_projects) — لا محرّر ولا عميل.
-- • 'hold'   : من أي مرحلة نشِطة (ليست closed/cancelled/on_hold).
-- • 'resume' : من on_hold فقط، ويعود إلى المرحلة المسجّلة قبل التعليق (أو planning احتياطًا).
-- • 'cancel' : من أي مرحلة عدا closed (الإغلاق النهائيّ لا يُلغى — يُعاد فتحه بمسار الإقفال).
-- كل انتقال يُسجَّل في project_status_history (note = السبب) + pc_log + إشعار الفريق.
create or replace function public.project_core_hold_action(
  p_project uuid, p_action text, p_reason text)
returns public.project_core
language plpgsql security definer set search_path = public as $$
declare
  r public.project_core;
  v_from text;
  v_to   text;
  v_reason text := nullif(btrim(p_reason), '');
  v_prev text;
begin
  if p_project is null then raise exception 'project_required'; end if;
  if p_action not in ('hold','resume','cancel') then raise exception 'bad_action'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;

  select core_stage into v_from from public.project_core where project_id = p_project;
  if v_from is null then raise exception 'project_not_initialized'; end if;

  if p_action = 'hold' then
    if v_from in ('closed','cancelled') then raise exception 'cannot_hold_from_%', v_from; end if;
    if v_from = 'on_hold' then select * into r from public.project_core where project_id = p_project; return r; end if;
    v_to := 'on_hold';

  elsif p_action = 'resume' then
    if v_from <> 'on_hold' then raise exception 'not_on_hold'; end if;
    -- المرحلة السابقة = from_stage لآخر انتقال إلى on_hold (لا عمود جديد، لا تكرار بيانات).
    select h.from_stage into v_prev
      from public.project_status_history h
     where h.project_id = p_project and h.to_stage = 'on_hold'
     order by h.created_at desc
     limit 1;
    v_to := coalesce(nullif(v_prev, 'on_hold'), 'planning');

  else -- cancel
    if v_from = 'closed' then raise exception 'cannot_cancel_closed'; end if;
    if v_from = 'cancelled' then select * into r from public.project_core where project_id = p_project; return r; end if;
    v_to := 'cancelled';
  end if;

  update public.project_core
     set core_stage = v_to, updated_at = now(), updated_by = auth.uid()
   where project_id = p_project
  returning * into r;

  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
  values (p_project, v_from, v_to, v_reason, auth.uid());

  perform public.pc_log(p_project, 'stage_' || p_action, 'project', p_project,
    jsonb_build_object('from', v_from, 'to', v_to, 'reason', left(v_reason, 500)));

  -- الإشعار أثر جانبيّ بعد التثبيت: فشله لا يُلغي الإجراء (قانون عزل الإجراء عن الإشعار).
  begin
    perform public.pc_notify_team(p_project,
      'project_status_changed', 'project', p_project,
      case p_action when 'hold'   then 'تم تعليق المشروع مؤقتًا'
                    when 'resume' then 'تمّت إعادة تشغيل المشروع'
                    else 'تم إلغاء المشروع' end,
      case p_action when 'hold'   then 'Project put on hold'
                    when 'resume' then 'Project resumed'
                    else 'Project cancelled' end,
      auth.uid());
  exception when others then null;
  end;

  return r;
end $$;

-- ─── §3 الصلاحيات: المستخدم المُصادَق يستدعيها؛ الحماية داخلها (can_manage_projects) ───
do $g$
begin
  execute 'revoke all on function public.project_core_hold_action(uuid,text,text) from public, anon';
  execute 'grant execute on function public.project_core_hold_action(uuid,text,text) to authenticated, service_role';
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «LIFECYCLE FAIL …». لا يكتب أي صفّ (تحقّق تعريفيّ فقط).
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text;
begin
  if to_regprocedure('public.project_core_hold_action(uuid,text,text)') is null then
    raise exception 'LIFECYCLE FAIL: project_core_hold_action missing'; end if;

  select pg_get_constraintdef(con.oid) into v_def
  from pg_constraint con join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname='public' and rel.relname='project_core' and con.contype='c'
    and pg_get_constraintdef(con.oid) ilike '%core_stage%' limit 1;

  if v_def is null then raise exception 'LIFECYCLE FAIL: core_stage check constraint vanished'; end if;
  if v_def not like '%on_hold%'   then raise exception 'LIFECYCLE FAIL: on_hold not permitted'; end if;
  if v_def not like '%cancelled%' then raise exception 'LIFECYCLE FAIL: cancelled not permitted'; end if;
  -- التوسيع لا يُسقط أي قيمة قائمة:
  if v_def not like '%delivered%' or v_def not like '%closed%' or v_def not like '%planning%' then
    raise exception 'LIFECYCLE FAIL: widening dropped an existing stage value'; end if;

  if exists (select 1 from information_schema.routine_privileges
             where routine_schema='public' and routine_name='project_core_hold_action' and grantee='anon') then
    raise exception 'LIFECYCLE FAIL: anon must not execute the hold action'; end if;

  raise notice 'LIFECYCLE SELF-TEST PASSED — hold/resume/cancel ready (linear stages untouched).';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (شغّلها بعد التطبيق)
--   1) القيد يقبل الحالتين الجديدتين:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conrelid='public.project_core'::regclass and contype='c'
--         and pg_get_constraintdef(oid) ilike '%core_stage%';
--   2) الدالّة موجودة وصلاحياتها صحيحة:
--      select routine_name, grantee, privilege_type from information_schema.routine_privileges
--       where routine_schema='public' and routine_name='project_core_hold_action';
--   3) لا مشروع تأثّر بالتطبيق (توسيع بحت):
--      select core_stage, count(*) from public.project_core group by 1 order by 2 desc;
--
-- ROLLBACK / RECOVERY
--   • لا حاجة لتراجع: الملفّ إضافيّ بحت ولا يحذف بيانات.
--   • للتراجع الاختياريّ عن الدالّة فقط:
--       drop function if exists public.project_core_hold_action(uuid,text,text);
--     (اترك القيد موسَّعًا — تضييقه سيُبطِل أي مشروع صار on_hold/cancelled.)
-- ════════════════════════════════════════════════════════════════════════════
