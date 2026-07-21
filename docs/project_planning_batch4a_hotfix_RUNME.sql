-- ════════════════════════════════════════════════════════════════════════════
-- project_planning_batch4a_hotfix_RUNME.sql — HOTFIX لـ«المخطط الزمني» (Spinner دائم)
-- ────────────────────────────────────────────────────────────────────────────
-- السبب الجذري (مُثبَت): project_schedule_preview / project_critical_path /
--   project_gantt_snapshot أُنشئت STABLE وتستخدم CREATE TEMPORARY TABLE. PostgREST
--   يشغّل الدوال STABLE داخل معاملة READ ONLY، فيفشل إنشاء الجدول المؤقت بخطأ
--   «cannot execute CREATE TABLE in a read-only transaction» ⇒ ترجع الـRPC خطأً
--   ⇒ الواجهة (بلا Error state) تبقى على Spinner. الدالة العاملة project_core_dashboard
--   تستخدم نفس نمط الجدول المؤقت لكنها VOLATILE فتعمل.
--
-- الإصلاح: تحويل الدوال الثلاث إلى VOLATILE فقط (بلا تغيير الجسم، بلا DROP، بلا حذف
--   بيانات). ALTER FUNCTION آمن وIdempotent. لا يمسّ Phase 3 ولا أي شيء آخر.
--
-- التشغيل: شغّل هذا الملف على Production بعد project_planning_batch4a_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.project_gantt_snapshot(uuid,boolean)') is null then miss := miss||' project_gantt_snapshot'; end if;
  if to_regprocedure('public.project_critical_path(uuid)')          is null then miss := miss||' project_critical_path'; end if;
  if to_regprocedure('public.project_schedule_preview(uuid)')       is null then miss := miss||' project_schedule_preview'; end if;
  if miss <> '' then raise exception 'نقص (%). شغّل project_planning_batch4a_RUNME.sql أولًا.', miss; end if;
end $pf$;

begin;

-- تحويل الدوال المستخدِمة للجداول المؤقتة إلى VOLATILE (كي يشغّلها PostgREST بمعاملة
--   قابلة للكتابة فينجح CREATE TEMPORARY TABLE). لا تغيير على المنطق/التوقيع/الصلاحيات.
alter function public.project_schedule_preview(uuid) volatile;
alter function public.project_critical_path(uuid) volatile;
alter function public.project_gantt_snapshot(uuid, boolean) volatile;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق بعد التشغيل ──
do $v$
declare v_bad int;
begin
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.provolatile <> 'v'
      and p.proname in ('project_schedule_preview','project_critical_path','project_gantt_snapshot');
  raise notice 'hotfix4a: functions still non-volatile = % (must be 0)', v_bad;
  if v_bad <> 0 then raise exception 'ما زالت دالة STABLE/IMMUTABLE مع جدول مؤقت'; end if;
end $v$;
