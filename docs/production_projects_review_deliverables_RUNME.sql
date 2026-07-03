-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — PRODUCTION HOTFIX: review/preview + deliverable fixes (RUN ONCE)
--
-- Combines ONLY the tested review/deliverable SQL for the official site. The
-- project pending/placeholder-email + client-linking RPCs are ALREADY in
-- production (docs/production_quote_projects_only_RUNME.sql, deployed with 482ca43)
-- and are NOT repeated here.
--
-- Contents:
--   A) Review recipient_shape fix — adding a review/preview to an unlinked/pending
--      client no longer fails with "notifications recipient_shape".
--   B) Deliverable EDIT — extend admin_set_deliverable to also update title + type.
--   C) Deliverable DELETE — dedicated admin_soft_delete_deliverable RPC.
--
-- Idempotent, safe to rerun. SECURITY DEFINER fns set search_path = public and are
-- admin-gated (is_admin()). Does NOT weaken RLS. Contains NO WhatsApp/n8n/Meta/
-- Resend/email/Zoho/notification-delivery/media/storage/Drive/audio objects, and NO
-- conflicting project RPCs.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── A) Review recipient_shape fix ────────────────────────────────────────────
-- The deliverables trigger notifies each recipient from project_client_user_ids();
-- for a pending/unlinked client (clients.user_id IS NULL) it returned a NULL row,
-- so notify(NULL,'user',...) violated recipient_shape and rolled back the save.
-- 1) return only REAL recipients (user_id NOT NULL); 2) notify() defensively skips
-- a 'user' notification with a NULL recipient. Constraint is NOT weakened.
create or replace function public.project_client_user_ids(p_project uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select pm.user_id from public.project_members pm
   where pm.project_id = p_project and pm.role like 'client\_%' and pm.is_deleted = false
     and pm.user_id is not null
  union
  select c.user_id from public.clients c
   join public.projects p on p.client_id = c.id
   where p.id = p_project and c.is_deleted = false
     and c.user_id is not null;
$$;

create or replace function public.notify(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- A user notification with no recipient is meaningless (and would break
  -- recipient_shape) → skip. Admin broadcasts (role='admin') keep NULL recipient.
  if p_role = 'user' and p_recipient is null then
    return;
  end if;
  if p_role = 'user' and exists (select 1 from public.notification_preferences
                                 where user_id = p_recipient and portal_enabled = false) then
    return;
  end if;
  insert into public.notifications (recipient_id, recipient_role, type, entity_type, entity_id, title_ar, title_en)
  values (p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);
end; $$;

-- ── B) Deliverable EDIT: admin_set_deliverable also updates title + type ──────
-- Drop the old 5-arg signature and recreate with two extra OPTIONAL params so
-- there is a single unambiguous function (avoids a PostgREST overload). Existing
-- 5-arg callers keep working (title/type default null → unchanged).
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

-- ── C) Deliverable DELETE: dedicated admin soft-delete RPC ────────────────────
-- deliverables has is_deleted/deleted_at/deleted_by (SoftDeletable) but NO
-- updated_at column, so updated_at is not set. Returns false if the id is missing
-- or already deleted. The admin list filters is_deleted=false (code) so a deleted
-- preview disappears from the admin AND client lists.
create or replace function public.admin_soft_delete_deliverable(p_deliverable uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.deliverables
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid()
   where id = p_deliverable and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_soft_delete_deliverable(uuid) from public, anon;
grant  execute on function public.admin_soft_delete_deliverable(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   -- A) unlinked project yields NO client recipients (was a NULL row → violation):
--   select * from public.project_client_user_ids('<unlinked_project_id>');   -- 0 rows
--   select * from public.project_client_user_ids('<linked_project_id>');     -- ≥1 row
--   -- B) single unambiguous 7-arg edit function + edit title/type as admin:
--   select oid::regprocedure from pg_proc where proname = 'admin_set_deliverable';
--   select public.admin_set_deliverable('<deliverable_id>', null,null,null,null, 'عنوان جديد', 'photo');
--   -- C) soft-delete a preview (true first time, false if already deleted):
--   select public.admin_soft_delete_deliverable('<deliverable_id>');         -- true
--   select public.admin_soft_delete_deliverable('<deliverable_id>');         -- false
--   select id, is_deleted, deleted_at from public.deliverables where id = '<deliverable_id>';
--   -- recipient_shape constraint still present (NOT weakened):
--   select conname from pg_constraint where conrelid='public.notifications'::regclass and conname='recipient_shape';
-- ════════════════════════════════════════════════════════════════════════
