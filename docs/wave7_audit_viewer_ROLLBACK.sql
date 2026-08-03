-- WAVE 7 · V2-7.3 · ROLLBACK. لا فقد بيانات — العارض قراءة فقط.
begin;
drop function if exists public.audit_viewer_list(jsonb);
drop function if exists public.audit_sources_registry();
commit;
