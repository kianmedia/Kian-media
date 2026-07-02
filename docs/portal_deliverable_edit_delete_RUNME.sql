-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Admin edit/delete of review/preview deliverables (RUN ONCE)
--
-- Feature: admins can EDIT (title/type/preview URL) and DELETE existing preview
-- deliverables in "إدارة مخرجات المراجعة".
--
-- DELETE needs NO change — it reuses the existing admin-gated soft_delete RPC:
--   select public.soft_delete('deliverables', '<deliverable_id>');
-- (deliverables is already in soft_delete's whitelist; RLS filters is_deleted=false,
--  so a soft-deleted item disappears from BOTH the admin and client lists.)
--
-- EDIT: admin_set_deliverable already updates status / preview_url / vimeo. This
-- extends it to also update title + type. The old 5-arg signature is DROPPED and
-- re-created with two extra OPTIONAL params, so there is a single unambiguous
-- function (adding params without dropping would create an overload → PostgREST
-- "could not choose the best candidate" ambiguity). Existing 5-arg callers keep
-- working (the two new params default null → title/type unchanged).
--
-- Idempotent, admin-gated (is_admin), SECURITY DEFINER set search_path = public.
-- Does NOT weaken RLS. Does NOT touch WhatsApp/Zoho/quotes/invoices/notifications.
-- ════════════════════════════════════════════════════════════════════════
begin;

drop function if exists public.admin_set_deliverable(uuid, text, boolean, text, text);

create or replace function public.admin_set_deliverable(
  p_dlv uuid, p_status text default null, p_allow_download boolean default null,
  p_preview_url text default null, p_vimeo_url text default null,
  p_title text default null, p_type text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status is not null and p_status <> all (array[
     'draft','internal_review','client_review','revision_requested',
     'approved','final_delivered','archived']) then
    raise exception 'invalid deliverable status: %', p_status;
  end if;
  if p_type is not null and p_type <> all (array['video','photo','other']) then
    raise exception 'invalid deliverable type: %', p_type;
  end if;
  update public.deliverables
     set status           = coalesce(p_status, status),
         allow_download   = coalesce(p_allow_download, allow_download),
         preview_url      = coalesce(p_preview_url, preview_url),
         vimeo_review_url = coalesce(p_vimeo_url, vimeo_review_url),
         title            = coalesce(nullif(trim(p_title), ''), title),
         type             = coalesce(p_type, type)
   where id = p_dlv and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_deliverable(uuid,text,boolean,text,text,text,text) from public, anon;
grant  execute on function public.admin_set_deliverable(uuid,text,boolean,text,text,text,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   -- The single 7-arg function exists (no ambiguous overload):
--   select oid::regprocedure from pg_proc where proname = 'admin_set_deliverable';
--     -- expect exactly: admin_set_deliverable(uuid,text,boolean,text,text,text,text)
--   -- As an ADMIN session — edit title + type:
--   select public.admin_set_deliverable('<deliverable_id>', null, null, null, null, 'عنوان جديد', 'photo');
--   -- Soft-delete a preview link (disappears from admin + client via RLS):
--   select public.soft_delete('deliverables', '<deliverable_id>');
--   select id, title, type, is_deleted from public.deliverables where id = '<deliverable_id>';
-- ════════════════════════════════════════════════════════════════════════
