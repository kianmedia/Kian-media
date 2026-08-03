-- WAVE 7 · V2-7.1 · ROLLBACK. لا فقد بيانات — لا شيء هنا يخزّن شيئًا.
begin;
drop function if exists public.global_search(text,int);
drop index if exists public.projects_fts_idx;
drop index if exists public.clients_fts_idx;
drop index if exists public.deliverables_fts_idx;
drop index if exists public.assets_fts_idx;
-- ⚠️ دوالّ التطبيع تُسقَط أخيرًا: الفهارس تعتمد عليها.
drop function if exists public.search_query(text);
drop function if exists public.search_vector(text);
drop function if exists public.search_norm(text);
commit;
