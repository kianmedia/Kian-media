-- ═══════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — CONSENT STORAGE ADDENDUM (PROPOSAL ONLY — NOT RUN)
--
-- Today: signup consent (privacy + terms) is captured at signup time into the
-- GoTrue user metadata (raw_user_meta_data: privacy_accepted_at,
-- terms_accepted_at, consent_version). That is durable enough to prove consent,
-- but it is not queryable from the portal's public schema.
--
-- If you want durable, queryable consent columns on profiles, run this after
-- review. Optional ip / user_agent columns are included but the FRONTEND does
-- NOT have a safe way to capture a trustworthy IP — leave those null unless a
-- backend/Edge Function populates them later. No frontend change needed.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists terms_accepted_at   timestamptz,
  add column if not exists consent_version      text,
  add column if not exists consent_user_agent   text;   -- optional; populate server-side only
  -- consent_ip inet — intentionally omitted: the browser cannot self-report a
  -- trustworthy IP; add it later only if an Edge Function captures it.

-- Let users persist their own consent timestamps (column-scoped grant; RLS
-- already restricts profiles updates to the owner via the existing policy).
grant update (privacy_accepted_at, terms_accepted_at, consent_version)
  on public.profiles to authenticated;

-- Then, in lib/portal/account.ts / PortalShell, the post-signup profile sync
-- can write these alongside name/company/mobile. (Frontend change deferred
-- until this addendum is approved + run.)
