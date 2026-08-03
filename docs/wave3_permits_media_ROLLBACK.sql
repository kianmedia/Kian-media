-- WAVE 3 · إغلاق · ROLLBACK.
-- §1 يوقف الميزة بلا فقد بيانات — الجدولان يبقيان بمحتواهما.
begin;
drop function if exists public.prodops_permit_alerts_run();
drop function if exists public.prodops_permit_upsert(jsonb);
drop function if exists public.prodops_permit_delete(uuid,text);
drop function if exists public.prodops_permits_list(jsonb);
drop function if exists public.prodops_media_attach(text,uuid,text,text,text,text,integer);
drop function if exists public.prodops_media_delete(uuid,text);
drop function if exists public.prodops_media_list(text,uuid);
commit;

-- §2 · إزالة الربط عن الجدول القائم. 🔴 يُفقد أثر ربط تصاريح المهامّ بالسجلّ.
-- begin;
-- alter table public.ops_job_permits drop column if exists registry_permit_id;
-- commit;

-- §3 · إزالة تامّة — 🔴 تُفقد كلّ التصاريح والمرفقات المسجَّلة. عن قصد فقط.
-- begin;
-- drop table if exists public.ops_media;
-- drop table if exists public.ops_permits;
-- commit;
