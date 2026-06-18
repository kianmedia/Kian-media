-- ════════════════════════════════════════════════════════════════════════
-- HOTFIX: grant SELECT on the whatsapp_* tables to the `authenticated` role.
--
-- Root cause of "/client-portal/admin/whatsapp shows 0 conversations": the
-- tables had RLS policies but NO table-level SELECT grant, so the browser's
-- authenticated role was denied at the privilege layer before RLS even ran.
-- This project has no `alter default privileges`, so each table needs an
-- explicit grant (same as opportunity_requests / assignment_notes / invoices).
--
-- Run this once in Supabase → SQL Editor. Idempotent and safe to re-run.
-- RLS still decides WHICH rows each user sees; this only unlocks the tables.
-- SELECT only — all writes remain locked to the SECURITY DEFINER RPCs.
-- `anon` (logged-out/public) is intentionally NOT granted.
-- ════════════════════════════════════════════════════════════════════════
grant select on public.whatsapp_contacts        to authenticated;
grant select on public.whatsapp_conversations    to authenticated;
grant select on public.whatsapp_messages         to authenticated;
grant select on public.whatsapp_assignments      to authenticated;
grant select on public.whatsapp_internal_notes   to authenticated;
grant select on public.whatsapp_events           to authenticated;
