-- WAVE 4 · ROLLBACK.
-- §1 يوقف الميزة بلا فقد بيانات — الجدولان والعرض يبقيان.
begin;
-- 🔴 أوّل ما يُسحب: وصول anon.
revoke all on function public.crm_testimonial_invite_check(text) from anon;
drop function if exists public.crm_testimonial_invite_check(text);
drop function if exists public.crm_testimonial_invite_issue(uuid,int);
drop function if exists public.crm_testimonial_invite_revoke(uuid,text);
drop function if exists public.crm_tender_upsert(uuid,jsonb);
drop function if exists public.crm_win_rate_report(jsonb);
drop function if exists public.crm_seasonality_report(int);
drop function if exists public.crm_silent_clients(int);
drop function if exists public.crm_weekly_digest(date);
commit;

-- §2 · إسقاط العرض المشتقّ. 🟢 بلا فقد بيانات — لا يخزّن شيئًا أصلًا.
-- begin;
-- drop view if exists public.crm_client_health_v;
-- commit;

-- §3 · إزالة تامّة — 🔴 تُفقد بيانات المناقصات والدعوات. عن قصد فقط.
-- begin;
-- drop table if exists public.crm_testimonial_invites;
-- drop table if exists public.crm_opportunity_tender;
-- commit;
