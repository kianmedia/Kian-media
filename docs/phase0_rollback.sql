-- ═══════════════════════════════════════════════════════════════════════════
-- KIAN CLIENT PORTAL — PHASE 0 ROLLBACK SCRIPT
-- ⚠️ RECOVERY ARTIFACT ONLY — run ONLY if Phase 0 must be fully reverted
--    AFTER a successful commit. (If the migration fails mid-run, you do NOT
--    need this file: Part 1 is one transaction and auto-rolls-back.)
--
-- What it does: removes every object Phase 0 created.
-- What it NEVER touches: existing rows in public.clients / public.projects,
--    auth.users, or any pre-Phase-0 policy/grant.
-- Data loss scope: only data created in the NEW tables after Phase 0 ran
--    (quotes, messages, notifications, log entries, …). Export them first if needed.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Triggers on pre-existing / auth tables
drop trigger if exists t_session_created     on auth.sessions;
drop trigger if exists on_auth_user_created  on auth.users;
drop trigger if exists t_project_change      on public.projects;

-- 2. Policies added to pre-existing tables (originals are untouched)
drop policy if exists "projects member read"     on public.projects;
drop policy if exists "projects live rows only"  on public.projects;
drop policy if exists "admin all projects"       on public.projects;
drop policy if exists "clients live rows only"   on public.clients;
drop policy if exists "admin all clients"        on public.clients;

-- 3. New tables (cascade removes their triggers, policies, indexes)
drop table if exists public.integration_outbox       cascade;
drop table if exists public.admin_notes              cascade;
drop table if exists public.project_messages         cascade;
drop table if exists public.deliverable_reviews      cascade;
drop table if exists public.internal_comments        cascade;
drop table if exists public.client_comments          cascade;
drop table if exists public.deliverable_assets       cascade;
drop table if exists public.deliverables             cascade;
drop table if exists public.project_notes            cascade;
drop table if exists public.offers                   cascade;
drop table if exists public.file_links               cascade;
drop table if exists public.messages                 cascade;
drop table if exists public.quote_requests           cascade;
drop table if exists public.project_members          cascade;
drop table if exists public.notifications            cascade;
drop table if exists public.notification_preferences cascade;
drop table if exists public.activity_log             cascade;
drop table if exists public.profiles                 cascade;
drop table if exists public.companies                cascade;

-- 4. Functions
drop function if exists public.trg_session_created()                cascade;
drop function if exists public.handle_new_user()                    cascade;
drop function if exists public.touch_updated_at()                   cascade;
drop function if exists public.trg_quote_created()                  cascade;
drop function if exists public.trg_message_created()                cascade;
drop function if exists public.trg_file_created()                   cascade;
drop function if exists public.trg_note_created()                   cascade;
drop function if exists public.trg_deliverable_change()             cascade;
drop function if exists public.trg_review_created()                 cascade;
drop function if exists public.trg_project_change()                 cascade;
drop function if exists public.trg_member_change()                  cascade;
drop function if exists public.trg_profile_audit()                  cascade;
drop function if exists public.soft_delete(text, uuid)              cascade;
drop function if exists public.restore_record(text, uuid)           cascade;
drop function if exists public.log_login()                          cascade;
drop function if exists public.get_deliverable_download(uuid)       cascade;
drop function if exists public.project_client_user_ids(uuid)        cascade;
drop function if exists public.is_kian_member(uuid)                 cascade;
drop function if exists public.is_client_owner(uuid)                cascade;
drop function if exists public.is_client_side(uuid)                 cascade;
drop function if exists public.can_access_project(uuid)             cascade;
drop function if exists public.project_role(uuid)                   cascade;
drop function if exists public.my_client_id()                       cascade;
drop function if exists public.is_not_blocked()                     cascade;
drop function if exists public.is_active()                          cascade;
drop function if exists public.is_admin()                           cascade;
drop function if exists public.notify(uuid, text, text, text, uuid, text, text) cascade;
drop function if exists public.log_activity(uuid, text, text, text, uuid, jsonb) cascade;

-- 5. OPTIONAL: columns added to pre-existing tables.
--    Leaving them in place is HARMLESS (defaults; unused). Uncomment only if
--    a pristine schema is required.
-- alter table public.projects drop column if exists company_id,
--   drop column if exists zoho_deal_id, drop column if exists zoho_books_invoice_id,
--   drop column if exists is_deleted, drop column if exists deleted_at,
--   drop column if exists deleted_by;
-- alter table public.clients drop column if exists is_deleted,
--   drop column if exists deleted_at, drop column if exists deleted_by;

commit;

notify pgrst, 'reload schema';
