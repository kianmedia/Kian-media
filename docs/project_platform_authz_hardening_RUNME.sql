-- ════════════════════════════════════════════════════════════════════════════
-- project_platform_authz_hardening_RUNME.sql        ★★ أولويّة قصوى — أمنيّ ★★
--
-- يُغلق تسريبًا مُثبَتًا حيًّا على الإنتاج: استدعاء **غير مُصادَق** بالمفتاح العامّ
-- (المضمَّن في حزمة المتصفّح ويراه أي زائر) أعاد بيانات الشركة الحقيقية:
--     POST /rest/v1/rpc/company_execution_report  →  200
--     {"health_distribution":{"healthy":20},"total_overdue_tasks":2,
--      "bottleneck_by_status":{"todo":41,"in_progress":2,"internal_review":1}}
--
-- ═══ السبب الجذريّ (سببان متضافران) ═══
-- (١) انهيار NULL في حرّاس الصلاحية:
--        staff_role()            → NULL لغير المُصادَق (auth.uid() فارغ ⇒ لا صفّ)
--        can_manage_projects()   := is_owner() or staff_role() in ('manager')
--                                 = false OR NULL  =  **NULL**
--     وفي plpgsql:  if not NULL then raise …  ⇒  الشرط ليس TRUE ⇒ **لا يُرفع الاستثناء**.
--     فكلّ بوّابة مكتوبة بهذا النمط هي كود ميّت. وبما أنّ الدوالّ SECURITY DEFINER
--     فهي تتجاوز RLS أيضًا ⇒ تُنفَّذ القراءة/الكتابة كاملة.
--     تحقّق حيّ: is_staff/is_owner/is_admin تُعيد false (سليمة)، بينما
--                can_manage_projects / can_see_financials / staff_reads_all_projects → null.
-- (٢) PostgreSQL يمنح EXECUTE إلى PUBLIC افتراضيًّا. ملفّات أُضيفت فيها
--     grant … to authenticated بلا revoke ⇒ بقيت anon قادرة على الاستدعاء.
--
-- ═══ العلاج ═══
--  §1 إصلاح انهيار NULL: coalesce(...,false) — بنفس التواقيع، بلا DROP، ودون تغيير
--     أي دلالة للمستخدم المُصادَق (قيمته أصلًا true/false؛ يتغيّر فقط حال NULL ⇒ false).
--  §2 سحب EXECUTE من public/anon عن دوالّ **البيانات** في منصّة المشاريع، وإعادة
--     منحها لـauthenticated. يُنفَّذ ديناميكيًّا من pg_proc فيلتقط التواقيع والأحمال
--     الزائدة (overloads) بدقّة — بلا تخمين توقيع.
--     ⚠️ لا تُسحب صلاحية **الحرّاس** نفسها: بعضها يُستدعى داخل سياسات RLS، وسحبها
--        قد يُعطِّل صفحات عامّة. إصلاح NULL يكفي — هي لا تُعيد بيانات.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات · Self-test.
-- التشغيل: psql "$DATABASE_URL" -f docs/project_platform_authz_hardening_RUNME.sql
-- شغّله **قبل** أي ملفّ آخر في دفعة الإغلاق.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.staff_role()') is null then raise exception 'PREFLIGHT: staff_role() missing'; end if;
  if to_regprocedure('public.is_owner()')  is null then raise exception 'PREFLIGHT: is_owner() missing';  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1  إصلاح انهيار NULL — نفس المنطق حرفيًّا، مغلَّفًا بـcoalesce(...,false)
--     (الدلالة للمستخدم المُصادَق لا تتغيّر إطلاقًا؛ يتغيّر فقط أنّ «غير معروف» ⇒ «لا»)
-- ملاحظة: staff_role() تبقى كما هي — NULL فيها تعني «لا دور»، وهي دلالة صحيحة.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.can_manage_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager'), false);
$$;

create or replace function public.can_see_financials() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','sales'), false);
$$;

create or replace function public.can_support() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','support'), false);
$$;

create or replace function public.staff_reads_all_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','support','readonly'), false);
$$;

create or replace function public.can_final_deliver() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.can_manage_projects(), false);
$$;

create or replace function public.can_manage_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner(), false);
$$;

create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.can_manage_projects()
    or (public.staff_role() = 'editor' and public.project_role(p_project) = 'kian_editor'),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2  سحب EXECUTE من public/anon عن دوالّ البيانات، وإعادة المنح لـauthenticated
--     ديناميكيًّا: نمرّ على pg_proc فنلتقط التوقيع الفعليّ لكلّ اسم (بما فيه overloads).
--     لا يُلمس أيّ اسم غير مذكور، ولا تُسحب صلاحية service_role.
-- ════════════════════════════════════════════════════════════════════════════
do $revoke$
declare
  v_names text[] := array[
    -- تقارير/لوحات تكشف بيانات الشركة (سبب التسريب المُثبَت)
    'company_execution_report','team_execution_report','project_execution_dashboard',
    'project_execution_health','project_execution_report','project_activity_feed',
    'project_alerts','project_progress_snapshot','project_task_progress',
    'project_stage_readiness','project_schedule_preview','project_critical_path',
    -- كتابات دورة الحياة والمهام
    'project_stage_advance','project_core_set_progress_mode',
    'pc_task_assign','pc_task_set_parent','pc_project_tasks_board','pc_project_task_assignees',
    -- منح وصول/صلاحيات
    'admin_grant_client_project_access','project_hierarchy_admin_update_flags',
    'pc_client_cap','can_access_project','get_deliverable_download'
  ];
  r record; v_fixed int := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_names)
  loop
    execute format('revoke all on function %s from public', r.sig);
    -- anon قد لا يكون دورًا قائمًا في كل بيئة
    begin execute format('revoke all on function %s from anon', r.sig); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', r.sig); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to service_role', r.sig); exception when undefined_object then null; end;
    v_fixed := v_fixed + 1;
  end loop;
  raise notice 'AUTHZ §2: locked down % function signature(s).', v_fixed;
end $revoke$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «AUTHZ FAIL …»
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_leaky int; v_null_ok boolean;
begin
  -- (أ) لا حارس يُعيد NULL بعد الآن (نُقيّمها بلا مستخدم: auth.uid() فارغ داخل DO).
  if public.can_manage_projects()    is null then raise exception 'AUTHZ FAIL: can_manage_projects still NULL'; end if;
  if public.can_see_financials()     is null then raise exception 'AUTHZ FAIL: can_see_financials still NULL'; end if;
  if public.staff_reads_all_projects() is null then raise exception 'AUTHZ FAIL: staff_reads_all_projects still NULL'; end if;
  if public.can_support()            is null then raise exception 'AUTHZ FAIL: can_support still NULL'; end if;
  if public.can_final_deliver()      is null then raise exception 'AUTHZ FAIL: can_final_deliver still NULL'; end if;
  if public.can_manage_staff()       is null then raise exception 'AUTHZ FAIL: can_manage_staff still NULL'; end if;
  if public.can_edit_project(gen_random_uuid()) is null then raise exception 'AUTHZ FAIL: can_edit_project still NULL'; end if;

  -- (ب) الدلالة محفوظة: بلا مستخدم يجب أن تكون false (لا true).
  if public.can_manage_projects() is true then raise exception 'AUTHZ FAIL: unauthenticated must not manage projects'; end if;
  if public.can_see_financials()  is true then raise exception 'AUTHZ FAIL: unauthenticated must not see financials'; end if;

  -- (ج) لم تبقَ دالّة بيانات مذكورة قابلة للتنفيذ من anon/PUBLIC.
  select count(*) into v_leaky
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('company_execution_report','project_execution_dashboard','project_task_progress',
                      'project_alerts','project_stage_advance','project_core_set_progress_mode',
                      'admin_grant_client_project_access','pc_task_assign')
    -- فحص anon وحده كافٍ ودقيق: has_function_privilege يحتسب أيضًا ما يرثه anon من PUBLIC.
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_leaky > 0 then raise exception 'AUTHZ FAIL: % data function(s) still executable by anon/PUBLIC', v_leaky; end if;

  raise notice 'AUTHZ SELF-TEST PASSED — NULL-collapse closed and anon EXECUTE revoked.';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION (شغّلها من الطرفيّة بالمفتاح العامّ — كلّها يجب أن تفشل الآن)
--   set -a; . ./.env.local; set +a
--   curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/can_manage_projects" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" -d '{}'
--     المتوقّع: false   (كان: null)
--   curl -s -X POST ".../rpc/company_execution_report" … -d '{}'
--     المتوقّع: خطأ 42501 permission denied   (كان: بيانات الشركة الحقيقية)
--
-- تحقّق داخل SQL:
--   select proname, has_function_privilege('anon', oid, 'EXECUTE') as anon_can
--     from pg_proc where pronamespace='public'::regnamespace
--      and proname in ('company_execution_report','project_task_progress','project_stage_advance');
--   -- يجب أن تكون anon_can = false للجميع
--
-- ROLLBACK / RECOVERY
--   • الملفّ إضافيّ بحت: لا حذف بيانات ولا DROP TABLE. إعادة تشغيله آمنة.
--   • §1 يُعيد تعريف الدوالّ بنفس منطقها + coalesce؛ للتراجع أعِد تشغيل
--     docs/staff_roles_task_assignment_RUNME.sql (يستعيد النسخ الأصليّة — لكنّه
--     يُعيد فتح الثغرة، فلا تفعل ذلك إلا لتشخيص عابر).
--   • §2 صلاحيات فقط؛ للتراجع عن اسم بعينه:
--       grant execute on function public.<fn>(<sig>) to anon;
--   • أثر جانبيّ متوقَّع بعد التطبيق: أي واجهة كانت «تعمل» لأنّ الحارس كان ميّتًا
--     ستبدأ بإرجاع «not authorized» للمستخدم غير المخوّل — وهذا هو السلوك الصحيح.
-- ════════════════════════════════════════════════════════════════════════════
