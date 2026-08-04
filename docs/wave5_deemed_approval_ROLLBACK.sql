-- WAVE 5 · deemed_approval · ROLLBACK.
-- §1 يوقف الميزة فورًا بلا فقد بيانات. الجدولان يبقيان بسجلّهما.
begin;
drop function if exists public.deemed_approval_evaluate(uuid);
drop function if exists public.deemed_approval_set(uuid,jsonb);
commit;

-- §2 · إزالة تامّة — 🔴 يُفقد سجلّ الإشعارات والأساس التعاقديّ المسجَّل،
--     وهو دليل قد يُحتاج في نزاع. عن قصد فقط.
-- begin;
-- drop table if exists public.deemed_approval_notices;
-- drop table if exists public.deemed_approval_config;
-- commit;
