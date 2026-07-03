-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Deliverable delete fix: dedicated admin soft-delete RPC (RUN ONCE)
--
-- Live bug: deleting a review/preview deliverable showed "تم حذف المعاينة" but the
-- row stayed visible; a second attempt showed "تعذر حذف المعاينة".
-- Root cause (fixed in code, lib/portal/deliverables.ts): the admin deliverables
-- list did NOT filter is_deleted=false, and the "admin all dlv" RLS policy lets
-- admins read EVERY row — so a soft-deleted row remained visible. The first
-- soft_delete DID work (is_deleted=true → returned true → "success"); the second
-- attempt hit `where is_deleted=false` → 0 rows → false → "تعذر حذف".
--
-- This migration adds a DEDICATED, unambiguous admin RPC for the delete action
-- (clearer intent + admin-only gate than the shared generic soft_delete). It does
-- NOT alter the generic soft_delete and does NOT weaken RLS.
--
-- deliverables has is_deleted / deleted_at / deleted_by (SoftDeletable) but NO
-- updated_at column, so updated_at is intentionally not set.
-- Idempotent, SECURITY DEFINER set search_path = public, is_admin()-gated.
-- Does NOT touch WhatsApp/n8n/Meta/Resend/Zoho/notification-delivery/media objects.
-- ════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.admin_soft_delete_deliverable(p_deliverable uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.deliverables
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid()
   where id = p_deliverable and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;   -- false when the id doesn't exist or is already deleted
end; $$;
revoke execute on function public.admin_soft_delete_deliverable(uuid) from public, anon;
grant  execute on function public.admin_soft_delete_deliverable(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   -- As an ADMIN session — soft-delete a preview and confirm the flag flips:
--   select public.admin_soft_delete_deliverable('<deliverable_id>');   -- expect true
--   select id, is_deleted, deleted_at, deleted_by from public.deliverables where id = '<deliverable_id>';
--   -- Deleting again returns false (already deleted), no error:
--   select public.admin_soft_delete_deliverable('<deliverable_id>');   -- expect false
--   -- The admin/client list query now excludes it:
--   select count(*) from public.deliverables where project_id = '<project_id>' and is_deleted = false;
-- ════════════════════════════════════════════════════════════════════════
