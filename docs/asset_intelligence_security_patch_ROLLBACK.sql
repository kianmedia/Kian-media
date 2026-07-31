-- ════════════════════════════════════════════════════════════════════════════
-- docs/asset_intelligence_security_patch_ROLLBACK.sql
--
-- ⚠️⚠️ اقرأ قبل التشغيل ⚠️⚠️
--   هذا التراجع **يُعيد فتح EXECUTE لـPUBLIC** على كلّ دوالّ العهدة — أي يُعيد
--   بالضبط الحالة التي أوقف الفحصُ الترحيلةَ بسببها، ويُعيد وراثة anon معها.
--   لا تُشغّله إلّا إذا ثبت أنّ الرقعة كسرت مسارًا حقيقيًّا في الواجهة، وبعد
--   أن تُسجّل أيّ مسار انكسر. الأصحّ عادةً: أضِف الدالّة الناقصة إلى
--   APP_SURFACE في الرقعة وأعِد تشغيلها — لا أن تُعيد فتح PUBLIC للجميع.
--   ولا يمسّ هذا الملفّ بيانات العهدة ولا أجسام الدوالّ ولا الزنادات.
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $rb$
declare r record; n int := 0;
begin
  for r in select p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')
  loop
    execute format('grant execute on function %s to public', r.sig);
    n := n + 1;
  end loop;
  raise notice 'ASSET PATCH ROLLBACK: أُعيد EXECUTE لـPUBLIC على % دالّة — وanon يرث مجدّدًا.', n;
end $rb$;
commit;
