-- WAVE 6 · compliance_knowledge · ROLLBACK.
-- §1 يزيل الدوالّ والعرض بلا فقد بيانات — العرض لا يخزّن شيئًا أصلًا،
--    والمصادر الثلاثة تبقى كما هي بالكامل.
begin;
drop function if exists public.sop_attach_to_task(uuid,uuid);
drop function if exists public.sop_list(text);
drop function if exists public.sop_items_list(uuid);
drop function if exists public.hse_register_list(jsonb);
drop view if exists public.hse_register_v;
commit;

-- §2 · إزالة خطوات الإجراءات — 🔴 تُفقد. ⚠️ ولا تُحذف وثائق
--     ai_knowledge_sources بحال: هي قاعدة المعرفة القائمة ولا تخصّ هذه الحزمة.
-- begin;
-- drop table if exists public.sop_items;
-- commit;
