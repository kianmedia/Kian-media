-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 1 · V2-1.6-C · تراجع التقاط المصدر
-- ⚠️ لم يُشغَّل. مقابل lead_attribution_utm_EXTENSION_RUNME.sql
--
-- (١) التراجع الآمن: احذف الدالّة فقط — يتوقف الالتقاط وتبقى البيانات.
--     المسار الخادمي يسجّل PUBLIC_INTAKE_ATTRIBUTION_NOT_RECORDED ويواصل عمله،
--     واستقبال الطلبات **لا يتأثّر** لأن الشقّ إضافي بالتصميم.
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop function if exists public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text);
commit;

-- ─── (٢) ⛔ تراجع كامل — يحذف بيانات إسناد حقيقية ⛔ ─────────────────────────
--   لا تُشغَّل إلا باعتماد خالد الصريح. احتفظ بنسخة أولًا:
--     create table public_intake_attribution_backup as
--       select id, utm_source, utm_medium, utm_campaign, utm_term,
--              utm_content, referrer, landing_path
--         from public.public_intake where utm_source is not null;
--
-- begin;
-- alter table public.public_intake drop column if exists landing_path;
-- alter table public.public_intake drop column if exists referrer;
-- alter table public.public_intake drop column if exists utm_content;
-- alter table public.public_intake drop column if exists utm_term;
-- alter table public.public_intake drop column if exists utm_campaign;
-- alter table public.public_intake drop column if exists utm_medium;
-- alter table public.public_intake drop column if exists utm_source;
-- commit;
