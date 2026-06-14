# Phase 1 — Lead & Client Portal UI · Implementation Plan
**v1.0 · 2026-06-12 · Status: PLANNING — no code yet · Builds on deployed Phase 0 schema (see phase0_migration.sql, EXECUTED)**

---

## 0. Inputs & locked decisions

| Decision | Choice | Why |
|---|---|---|
| Data access | **Plain REST (PostgREST + GoTrue), no Supabase SDK** | Consistent with existing `lib/portalAuth.ts`; zero new deps; SDK deferred to Phase 5 (realtime) |
| Login activity | **Do NOT call `log_login()`** | The `auth.sessions` trigger is live — a client call would double-log. RPC stays as dormant fallback |
| Routing | **Nested App-Router routes** under `/client-portal/*` | Deep-linkable tabs, project detail pages, clean place for `/admin` and future tabs |
| Tabs | **Registry-driven nav** (config array → role-filtered) | Adding "Center of Opportunities" later = 1 registry entry + 1 route, no refactor |
| Refresh model | **Polling** (45–60s + on window focus) for notifications/chat | No SDK; realtime is Phase 5 |
| Quote mirror | Portal quote → `quote_requests` **and** existing Apps Script Sheet (`sheet_mirrored=true`) | Roadmap transition decision |
| Styling/i18n | Existing design system (`btn-red`, `glass`, eyebrow…) + existing `useI18n` AR/EN RTL | Visual continuity with the live site |
| Old page | Current `/client-portal/page.tsx` is **replaced** by the new shell in one cut, after feature parity (login + legacy dashboard view preserved via Projects tab) | No long-lived duplicate |

---

## 1. DB addendum (small SQL, run before coding — Phase 1.0)

> **STATUS: ✅ EXECUTED 2026-06-12 (S1 rev 2)** — verified by S1-V (10 checks, 0 FAIL).
> Authoritative SQL: [`docs/phase1_addendum_s1.sql`](phase1_addendum_s1.sql).
> rev 2 note: rev 1 rolled back atomically due to a wrong `admin_notify` signature
> in its revoke/grant lines — corrected to `(uuid,text,text,uuid,text,text)`.
> The sketch below is the original planning outline, kept for context.

Phase 0 deliberately gave `authenticated` no write grants on admin-managed tables. The minimum admin UI therefore uses **SECURITY DEFINER admin RPCs** (validate `is_admin()` inside, single audited path) instead of broad grants. Plus one **security hardening fix** discovered in planning:

```sql
-- A. HARDENING: internal functions are EXECUTE-able by PUBLIC by Postgres default.
--    notify()/log_activity() must not be callable from the browser:
revoke execute on function public.notify(uuid,text,text,text,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.log_activity(uuid,text,text,text,uuid,jsonb) from public, anon, authenticated;
-- (log_login keeps its grant — harmless, idempotent semantics, dormant fallback)

-- B. ADMIN RPCs (all: require is_admin() inside, raise otherwise; all audited):
-- admin_set_project_status(p_project uuid, p_status text)            → update projects.status (triggers notify+log)
-- admin_add_deliverable(p_project uuid, p_title text, p_type text,
--                       p_preview_url text, p_vimeo_url text,
--                       p_status text default 'draft')               → insert deliverables
-- admin_set_deliverable(p_dlv uuid, p_status text default null,
--                       p_allow_download boolean default null,
--                       p_preview_url text default null)             → guarded update (final-delivery gate still enforced by trigger)
-- admin_add_final_asset(p_dlv uuid, p_url text)                      → insert deliverable_assets(kind='final')
-- admin_notify(p_user uuid, p_type text, p_etype text, p_eid uuid,
--              p_ar text, p_en text)                                 → wraps notify() for manual client notifications
-- admin_set_account(p_user uuid, p_type text, p_status text,
--                   p_level text, p_company uuid)                    → profile lifecycle (audited via existing trigger)
```

Admin replies to support messages, project chat (`sender_role='admin'`), project notes, and **internal comments** need **no addendum** — grants + policies already allow them for admins/kian members.

---

## 2. Routes & information architecture

```
app/client-portal/
├── layout.tsx                     I18nProvider + PortalShell (auth gate, profile, tab nav, bell)
├── page.tsx                       Overview (welcome)                      [lead+client+admin]
├── quotes/page.tsx                Quote list + new-quote form             [all]
├── messages/page.tsx              Support thread                          [all]
├── files/page.tsx                 File/link submissions                   [all]
├── offers/page.tsx                Offers (empty state)                    [all]
├── profile/page.tsx               Profile fields + company card + notification prefs + language [all]
├── projects/page.tsx              Projects list                           [client+admin]
├── projects/[id]/page.tsx         Project workspace: timeline · team · deliverable review ·
│                                  chat · notes · files                    [members only]
├── admin/page.tsx                 Minimal admin panel                     [admin only]
└── (reserved) opportunities/      Center of Opportunities — registry entry commented, added next phase
```

Tab registry (in `components/portal/nav.ts`): `{ key, href, ar, en, icon, roles: ['lead','client','admin'] }[]` — `projects` hidden for leads, `admin` only for admins, `opportunities` entry pre-written but commented.

---

## 3. File-by-file plan

### 3.1 `lib/portal/` (new — data layer)

| File | Contents | Supabase calls |
|---|---|---|
| `types.ts` | TS types for all Phase-0 tables + enums (status unions, roles) | — |
| `client.ts` | Core REST helper: `pget/ppost/ppatch/prpc` — auth header injection, auto refresh-retry on 401, `Prefer: count=exact` helper, normalized `{ok,data,error}` | all PostgREST/`/rpc` traffic |
| `auth.ts` | Evolves `lib/portalAuth.ts` (re-exported for compat): `signup(email,pw,meta)`, existing `login/refresh/logout`, `getMyProfile()`, status helpers | `POST /auth/v1/signup`, `/auth/v1/token`, `GET profiles?id=eq.<uid>` |
| `account.ts` | `updateProfile(cols)`, `getPrefs()`, `updatePrefs()` | PATCH `profiles`, GET/PATCH `notification_preferences` |
| `leads.ts` | `listQuotes()`, `createQuote()` (+ `submitToSheets` mirror + `makeRef('quote')` reuse), `listMessages()`, `sendMessage()`, `listFiles()`, `addFileLink()`, `listOffers()` | quote_requests / messages / file_links / offers |
| `notifications.ts` | `list(limit)`, `unreadCount()`, `markRead(id)`, `markAllRead()` | notifications (+ head count) |
| `projects.ts` | `listProjects()`, `getProject(id)`, `listMembers(id)`, `myRole(id)`, `listChat(id)`, `sendChat(id,body)`, `listNotes(id)`, `addNote(...)`, `listProjectFiles(id)`, `addProjectFile(...)` | projects / project_members / project_messages / project_notes / file_links |
| `deliverables.ts` | `listForProject(id)`, `listComments(dlvId)`, `addComment(dlvId, body, timecode?)`, `submitReview(dlvId, decision, comments)`, `getDownloadUrl(dlvId)` (RPC), `softDelete(table,id)` (RPC) | deliverables / client_comments / deliverable_reviews / rpc |
| `admin.ts` | Wrappers for the 6 admin RPCs + admin reads (all profiles? **No** — admin list views via existing policies: quotes, messages inbox) | rpc/admin_* + filtered selects |

### 3.2 `components/portal/` (new — UI layer)

| File | Purpose |
|---|---|
| `PortalShell.tsx` | Session→profile bootstrap; renders: AuthTabs (no session), BlockedScreen, InactiveBanner (read-only flag via context), TabNav + bell + content |
| `nav.ts` | Tab registry (incl. commented `opportunities` entry) |
| `AuthTabs.tsx` | Login tab (existing logic ported) + Signup tab (name, company, mobile, email, password, **marketing opt-in checkbox**) + "confirm your email" success state |
| `StatusScreens.tsx` | Blocked screen (contact WhatsApp), inactive read-only banner |
| `NotificationBell.tsx` | Fixed bell + unread badge (poll 60s/focus); opens panel |
| `NotificationPanel.tsx` | List, type→icon/deep-link map, mark read / mark all |
| `Overview.tsx` | Welcome, client_level badge, latest notifications, CTA cards (request quote / send message) |
| `QuoteForm.tsx` + `QuotesList.tsx` | Portal quote form (reuses SERVICES/BUDGETS arrays from `app/quote-request`), status chips per quote, soft-delete own `new` quotes |
| `MessagesThread.tsx` | Chat-style support thread (user right / Kian left), poll, send box (hidden when inactive) |
| `FilesPanel.tsx` | Link list + add form (URL validation), optional project selector for clients |
| `OffersPanel.tsx` | Honest empty state («لا توجد عروض حالياً») + render published offers when they exist |
| `ProfileSettings.tsx` | Editable: full_name, company, mobile, lang, marketing; read-only: email, account_type/level badges, company card; prefs toggles (portal ✅, email/WhatsApp visible but marked «قريباً» and disabled-styled-but-functional flags) |
| `ProjectsList.tsx` / `ProjectCard.tsx` | Member projects with status chip + company |
| `ProjectWorkspace/` → `Timeline.tsx` (port existing STATUS_STEPS UI), `TeamPanel.tsx`, `ProjectChat.tsx`, `NotesPanel.tsx`, `ProjectFiles.tsx` | Workspace sections |
| `DeliverableCard.tsx` | Status chip (client-visible states), version, watermark notice |
| `DeliverablePlayer.tsx` | `vimeo_review_url` iframe → else `preview_url` (YouTube/Drive embed or link). **No Vimeo API calls — URL embed only** |
| `CommentsThread.tsx` | Client comments with `mm:ss` timecode chips; timecode input helper (`00:01:32` ⇄ seconds) |
| `ReviewActions.tsx` | «اعتماد ✓» / «طلب تعديل ↺ + سبب» — rendered only when `myRole == client_owner` (or legacy) AND status `client_review`; confirmation modal |
| `DownloadButton.tsx` | Calls download RPC; renders only when status approved/final_delivered; hides on null |
| `admin/AdminPanel.tsx` + `AdminQuotesInbox.tsx`, `AdminMessagesInbox.tsx`, `AdminProjectOps.tsx` (status select → RPC; deliverable add/update forms; final-asset URL; allow_download toggle; manual notify form), `InternalCommentsPanel.tsx` (admin/kian only — **never imported into client components**) | Minimal admin UI (§5) |

### 3.3 Modified files

| File | Change |
|---|---|
| `app/client-portal/page.tsx` | Replaced by Overview page under new layout (legacy dashboard features preserved in Projects tab) |
| `lib/portalAuth.ts` | Becomes thin re-export of `lib/portal/auth.ts` (keeps old imports working) |
| `app/globals.css` | Portal additions: tab bar, badge, chat bubbles, timeline chips, toggle switch (~100 lines) |
| `docs/PORTAL_ROADMAP.md` | Mark Phase 1 in progress; record addendum |

**Not touched:** marketing site components, forms pages, layout.tsx, Center of Opportunities (reserved only).

---

## 4. UI states (every screen must implement)

| State | Behavior |
|---|---|
| Loading | Skeleton blocks (no spinners-only), per-tab |
| Empty | Arabic-first friendly empty state + primary CTA |
| Error | Inline error card + «إعادة المحاولة» retry; never a dead screen |
| Unauthenticated | AuthTabs (login/signup) |
| Signup success | «تحقق من بريدك لتفعيل الحساب» state with resend hint |
| Email unconfirmed login | GoTrue error mapped to clear Arabic message |
| `blocked` | Full-screen contact card — no data fetches |
| `inactive` | Banner + all mutating controls hidden/disabled (read-only context flag) |
| Lead vs client | Projects/(workspace) tabs hidden for leads — and RLS enforces it anyway |
| client_member vs owner | Review actions hidden for members (comment-only) |
| Offline/failed poll | Stale-data badge, silent retry |

---

## 5. Minimum admin UI recommendation (Phase 1 scope)

**Recommendation: one gated `/client-portal/admin` route — not a separate app — limited to the 6 daily operations**, everything else stays in Supabase dashboard until Phase 3:

1. **Quotes inbox** — list new quote_requests (read via existing admin policy)
2. **Support inbox** — reply to user messages (insert grant exists)
3. **Project status update** — dropdown → `admin_set_project_status` RPC (notifies client automatically via trigger)
4. **Deliverable ops** — add deliverable (title/type/preview URL/Vimeo URL), move status (draft → internal_review → client_review; final gate enforced by DB), paste final-asset URL, toggle allow_download — all via RPCs
5. **Manual client notification** — `admin_notify` RPC form
6. **Internal comments** — per project/deliverable, kian-only panel, visually separated (amber "داخلي — لا يظهر للعميل" banner)

Explicitly deferred to Phase 3: lead→client upgrades UI (use dashboard + `admin_set_account` RPC exists), company/member management UI, offers publishing UI, activity-timeline viewer, restore-deleted UI.

---

## 6. Security checklist (build-time rules)

- ✅ Only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the browser — **no service-role key anywhere in the repo or Vercel env**
- ✅ All authorization decisions are RLS/RPC-side; UI role-gating is UX only
- ✅ No Zoho/Vimeo API calls from the frontend (Vimeo = URL embed only)
- ✅ `notify()`/`log_activity()` EXECUTE revoked from browser roles (addendum A)
- ✅ Admin mutations only through `is_admin()`-validated RPCs
- ✅ Internal comments components never imported by client-facing components (separate module path)
- ✅ Soft-delete only via `soft_delete()` RPC; no DELETE anywhere

---

## 7. Acceptance checklist (Phase 1 exit)

**Auth & gates**
- [ ] Signup → confirm-email state → confirmed login lands on lead Overview; profile auto-row verified
- [ ] Wrong password / unconfirmed email show distinct Arabic messages
- [ ] blocked → contact screen; inactive → read-only (all submit controls absent)

**Lead tabs**
- [ ] Quote: submit → row in DB + Google Sheet + reference shown + admin notification; list shows status chips; own `new` quote deletable (soft)
- [ ] Messages: send/receive (admin reply visible ≤60s via poll)
- [ ] Files: add link with validation; list renders
- [ ] Offers: empty state correct; a dashboard-published offer appears without deploy
- [ ] Notifications: bell badge counts unread; open → mark read; deep-links to source tab
- [ ] Profile: edits persist; account_type/status/level NOT editable; prefs toggle works (mute test)
- [ ] Lead sees no Projects tab; direct URL to a project returns empty/redirect

**Client workspace**
- [ ] Projects list = membership only; project page shows timeline at current status + team
- [ ] Chat + notes + project files write/read correctly
- [ ] Deliverable in client_review renders player (Vimeo URL embed or preview)
- [ ] Timestamp comment 00:01:32 round-trips
- [ ] client_owner sees Approve/Revise; client_member doesn't; decision flips status + notifies admin
- [ ] Download button appears only after approved + allow_download; URL retrieved via RPC

**Admin minimal**
- [ ] Admin tab visible only to admin; all 6 operations work end-to-end (status change notifies smoke-test client)
- [ ] Internal comment invisible to the client account in the same project

**Security & quality**
- [ ] Addendum revokes verified (browser RPC call to notify() fails)
- [ ] `npm run build` clean; AR/RTL + EN/LTR pass on all new pages; mobile ≤390px usable
- [ ] Smoke-test client (khalednoman90@gmail.com) full regression on production

---

## 8. Coding order & estimates

| Step | Scope | Est. |
|---|---|---|
| **S1** ✅ DONE 2026-06-12 | DB addendum (revokes + 6 admin RPCs) via SQL Editor + verify — see `phase1_addendum_s1.sql` | 0.5 session |
| **S2** | `lib/portal/` core: client.ts, auth.ts (signup), types | 0.5 |
| **S3** | Shell: layout, PortalShell, AuthTabs, gates, tab registry, routing skeleton | 1 |
| **S4** | Lead tabs: Overview, Quotes (+Sheet mirror), Messages, Files | 1.5 |
| **S5** | Notification bell/panel + Profile/Settings (prefs) | 1 |
| **S6** | Offers tab + lead-tier polish + lead acceptance pass | 0.5 |
| **S7** | Client: projects list + workspace (timeline/team/chat/notes/files) | 1.5 |
| **S8** | Deliverable review: player, comments+timecode, approve/revise, download | 1.5 |
| **S9** | Admin minimal panel (6 ops) | 1 |
| **S10** | Bilingual/RTL/mobile QA + full acceptance checklist + production verify | 1 |
| | **Total** | **~10 sessions** |

Deploy strategy: S1–S6 can ship as a first production cut (lead portal live, client tab hidden behind role anyway); S7–S9 ship as the second cut. Each cut: build → commit → push → Vercel verify → smoke test — **only with explicit approval per cut**.
