# Phase 1 — S5 Notes (Notification Center · Profile/Settings · Polish)
**Status: built, local-only, awaiting owner verification · 2026-06-14**

## What S5 implemented
- **Notification Center** (`/client-portal/notifications`) — real list from `notifications` (RLS-filtered): title (AR/EN), type chip, timestamp, read/unread dot. **Cards are clickable** → open a detail modal (title, type, time, read status) with a context-aware "Open related section" button that routes by `entity_type`/`entity_id`. Clicking marks personally-targeted unread items read. "Mark all read" for own unread. Works for lead/client (own) and admin (own + admin broadcasts). Component: `components/portal/NotificationsView.tsx`.
  - **Routing map** (uses `notifications.entity_type` + `entity_id`, both already populated by Phase-0 `notify()` triggers):
    - `project` → `/client-portal/projects/{entity_id}` (exact)
    - `quote_request` → `/client-portal/quotes?open={entity_id}` (admin inbox auto-expands that quote's detail)
    - `message` → `/client-portal/messages`
    - `file_link` → `/client-portal/files`
    - `deliverable` / `project_note` → `/client-portal/projects` (section-level; exact project would need a deliverable→project resolve, see future DB note)
    - null/unknown entity → detail modal only (Close)
- **Unread badge** in the portal shell tab bar — red count on the Notifications tab; polls on mount, on route change, on window focus, and every 60s. No realtime subscriptions, no external push. Counts only personally-targeted unread (`recipient_id = me`) so admin broadcasts don't stick the badge.
- **Profile / Settings** (`/client-portal/profile`) — editable full_name, company, mobile (validated); read-only email (with "contact us to change" note); preferred-language picker; notification-preference toggles (portal live; email + WhatsApp saved but labeled "قريباً/planned"); marketing opt-in. Saves via column-granted `updateMyProfile` / `updateMyPrefs`. Admin sees the same + a "staff & permissions coming later" note. Component: `components/portal/ProfileSettings.tsx`.
- **Admin Dashboard polish** — count tiles (new quotes, client messages, client files, projects) + a **Recent Activity** feed (from admin notifications, since `activity_log` has no client grant). No client form, no fake data.
- **Client Overview polish** — quick actions + **Recent Notifications** and **Recent Quote Requests** blocks (client/lead). Project quick-action preserved for clients.
- **Bug fix (surfaced during S5):** the signup→profile sync stash is now **email-scoped** — it only syncs into the same account that signed up, and is always cleared otherwise. Previously a leftover stash could write into the next account that logged in without a name (this contaminated the admin profile during testing — see cleanup below).

## What current RLS already allows (no SQL needed for S5)
- `notifications`: own read + admin broadcasts (admin); mark-read on own rows (`read_at` column grant). ✓
- `notification_preferences`: own read + update of `portal_enabled/email_enabled/whatsapp_enabled`. ✓
- `profiles`: own read + update of `full_name/company/mobile/preferred_lang/marketing_opt_in`. ✓
- Admin counts: `quote_requests/messages/file_links/projects` readable by admin via admin-all policies. ✓

## What requires FUTURE DB/RPC (not done in S5; no SQL run)
- **Mark-read for admin broadcast notifications** — broadcasts have `recipient_id = null`, so the per-user mark-read policy can't touch them. A future model (per-admin fan-out, or a `notification_reads` join table) is needed if admins want to clear broadcasts. For now they're a read-only feed.
- **Admin "recent activity" from `activity_log`** — `activity_log` has no `authenticated` grant; S5 uses admin notifications as the activity feed instead. A future admin RPC (`admin_recent_activity()`) could expose the full audit log.
- **External notification delivery** (email/WhatsApp) — preferences are stored; delivery is a later phase via Edge Functions (no secrets in frontend).

## Notification delivery roadmap
1. ✅ **In-portal notifications** (this phase)
2. ✅ **Unread badge** (this phase)
3. ⏳ PWA / browser push (later — web-push subscription stored server-side, sent from an Edge Function)
4. ⏳ Zoho Cliq internal team alerts (later — Edge Function consuming `integration_outbox`)
5. ⏳ Telegram bot fallback (later)

**Not implemented in S5:** external push, Zoho, WhatsApp, Telegram, Cliq, AI. No external API calls from the browser; no new paid services.

## ⚠️ Cleanup needed by owner (data contamination from testing)
During S4/S5 testing, the admin account **kianalebtikar@gmail.com** had its `full_name` set to **"Mobile Test User"** and `mobile` to **"0501234567"** by the old (now-fixed) stash-sync bug. Fix in 30s: sign in as that admin → **الإعدادات / Settings** → correct name & mobile → Save. (The bug that caused it is fixed; it can't recur.)

## Debug UI
The S4 quote success card keeps an honest user-facing status (request saved / external alert sent or soft warning) for all users, plus a **localhost-only** debug panel (guarded by `window.location.hostname` ∈ {localhost,127.0.0.1}) — impossible to render on the production domain.
