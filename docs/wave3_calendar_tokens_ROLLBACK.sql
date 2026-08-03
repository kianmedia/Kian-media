-- WAVE 3 · V2-3.6 · ROLLBACK.
-- §1 يوقف الميزة فورًا بلا فقد بيانات — وهو ما تريده في حادثة.
begin;
-- 🔴 أوّل ما يُسحب: وصول anon. ثانية واحدة تكفي لإغلاق الباب.
revoke all on function public.prodops_calendar_feed(text) from anon;
drop function if exists public.prodops_calendar_feed(text);
drop function if exists public.prodops_calendar_token_issue(text,text,integer,integer);
drop function if exists public.prodops_calendar_token_revoke(uuid,text);
commit;

-- §2 · إزالة الجدول — 🔴 تُفقد كلّ الرموز المُصدَرة. أزل التعليق عن قصد فقط.
-- begin;
-- drop table if exists public.ops_calendar_tokens;
-- commit;
