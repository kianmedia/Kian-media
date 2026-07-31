-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_security_patch_ROLLBACK.sql
--
-- ⚠️ اقرأ قبل التشغيل: هذا التراجع **يُعيد فتح** EXECUTE لـPUBLIC على دالّتَي
--    الزناد، أي يُعيد الحالة التي رصدها الفحص. لا تُشغّله إلّا إذا ثبت أنّ
--    السحب كسر شيئًا فعليًّا — ولا ينبغي أن يكسر: EXECUTE على دالّة زناد يُفحص
--    عند CREATE TRIGGER لا عند إطلاقه.
--    ولا يمسّ هذا الملفّ بيانات العملاء المحتملين ولا أجسام الدوالّ.
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $rb$
declare f text;
begin
  foreach f in array array['public.lsr_rules_frozen()', 'public.lsr_touch()'] loop
    if to_regprocedure(f) is null then
      raise notice 'LSR PATCH ROLLBACK: % غائبة — تُخطّى', f; continue; end if;
    execute format('grant execute on function %s to public', f);
  end loop;
  raise notice 'LSR PATCH ROLLBACK: أُعيد EXECUTE لـPUBLIC — الحالة كما كانت قبل الرقعة.';
end $rb$;
commit;
