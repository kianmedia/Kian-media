-- WAVE 6 · assets_archive · ROLLBACK.
-- §1 يزيل الدوالّ بلا فقد بيانات.
begin;
drop function if exists public.project_rights_summary(uuid);

-- 🔴 الفهرس الفريد **مستقلّ** عن تعريف الجدول (لأنّه تعبيريّ)، فلا يسقط مع
-- إسقاط قيد ولا مع تعديل عمود — يجب إسقاطه بالاسم صراحةً.
-- ⚠️ وإسقاطه **لا يحذف بيانات**: يرفع عقد التفرّد فقط. وإعادة تشغيل RUNME
--    تُعيد إنشاءه (`if not exists`)، وقد تفشل حينها إن كانت صفوف مكرَّرة قد
--    أُدخلت أثناء غيابه — وهذا التوقّف مقصود لا عطل.
drop index if exists public.ml_title_license_uniq;
commit;

-- §2 · إزالة تامّة — 🔴 تُفقد تغطية التأمين وسجلّ الوسائط والتراخيص
--     **وإقرارات الظهور** (وهي مستندات قانونية قد تُحتاج في نزاع). عن قصد فقط.
-- begin;
-- drop table if exists public.model_releases;
-- drop table if exists public.music_license_project_links;
-- drop table if exists public.music_licenses;
-- drop table if exists public.archive_project_links;
-- drop table if exists public.archive_media;
-- drop table if exists public.asset_insurance_coverage;
-- commit;
