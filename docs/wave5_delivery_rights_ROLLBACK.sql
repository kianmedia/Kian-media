-- WAVE 5 · delivery_rights · ROLLBACK.
-- §1 يزيل ما أُضيف بلا فقد بيانات. ⚠️ إزالة الحُرّاس تُعيد فتح ثغرة الكاتب
--    النهائيّ المزدوج — لا تفعلها إلّا بقصد.
begin;
drop trigger if exists trg_dv_block_legacy_writes on public.project_deliverable_versions;
drop trigger if exists trg_dv_integrity_guard     on public.deliverable_versions;
drop function if exists public.dv_block_legacy_writes();
drop function if exists public.dv_integrity_guard();
drop index if exists public.deliverable_versions_one_final;
drop view if exists public.deliverable_showreel_v;
drop function if exists public.pc_client_can_approve(uuid,uuid);
drop function if exists public.pc_client_can_view(uuid,uuid);
-- 🔴 أوّل ما يُسحب عمليًّا: وصول anon إلى التحقّق من الرمز.
revoke all on function public.delivery_link_check(text) from anon;
drop function if exists public.delivery_link_check(text);
drop function if exists public.delivery_link_issue(uuid,uuid,integer,integer,text);
drop function if exists public.delivery_link_revoke(uuid,text);
drop function if exists public.deliverable_rights_set(uuid,jsonb);
commit;

-- §2 · إزالة أعمدة الحقوق — 🔴 تُفقد أذون العرض المسجَّلة. عن قصد فقط.
-- begin;
-- alter table public.deliverables drop constraint if exists deliverables_rights_coherent;
-- alter table public.deliverables drop column if exists showreel_allowed;
-- alter table public.deliverables drop column if exists confidential;
-- alter table public.deliverables drop column if exists rights_note;
-- alter table public.deliverables drop column if exists rights_set_by;
-- alter table public.deliverables drop column if exists rights_set_at;
-- commit;

-- §3 · إزالة روابط التسليم — 🔴 تُبطل كلّ رابط مُصدَر. عن قصد فقط.
-- begin;
-- drop table if exists public.delivery_share_links;
-- commit;
