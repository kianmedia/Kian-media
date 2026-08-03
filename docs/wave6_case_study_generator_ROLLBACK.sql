-- WAVE 6 · V2-6.8 · ROLLBACK.
-- §1 يزيل الدوالّ بلا فقد بيانات. الأعمدة تبقى بمحتواها (وهي provenance تدقيقيّ).
begin;
drop function if exists public.cs_generate_draft(uuid,text,text);
drop function if exists public.cs_draft_queue(text);
drop function if exists public.cs_mark_exported(uuid,text);
drop function if exists public.cs_source_allowed_fields();
commit;

-- §2 · إزالة الأعمدة — 🔴 يُفقد أثر المصدر والتصدير، وهو دليل مراجعة. عن قصد فقط.
-- ⚠️ ولا تُحذف دراسة حالة بحال: المنصّة قائمة ولا تخصّ هذه الحزمة.
-- begin;
-- alter table public.cs_case_studies drop column if exists generated_from_project;
-- alter table public.cs_case_studies drop column if exists generation_method;
-- alter table public.cs_case_studies drop column if exists generated_at;
-- alter table public.cs_case_studies drop column if exists generated_by;
-- alter table public.cs_case_studies drop column if exists source_provenance;
-- alter table public.cs_case_studies drop column if exists exported_at;
-- alter table public.cs_case_studies drop column if exists exported_by;
-- alter table public.cs_case_studies drop column if exists export_target;
-- commit;
