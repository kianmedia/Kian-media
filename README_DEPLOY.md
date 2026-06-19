# Kian WhatsApp Sales — deploy & manual steps

> Branch: `feature/whatsapp-sales-system` (built on `feature/whatsapp-inbox-crm`).
> Nothing here is deployed/merged by the assistant. You review, run migrations,
> set secrets, and deploy yourself. Three approval checkpoints: **(أ)** before any
> production migration, **(ب)** before pointing the LIVE WhatsApp number at
> auto-replies/AI, **(ج)** before any production deploy.

---

## Phase 1 — what shipped (two-way reply, dry-run + gated)

- **Migration** `docs/whatsapp_sales_phase1_RUNME.sql` (ADDITIVE, REVERSIBLE):
  adds `whatsapp_conversations.sales_stage` (8-stage pipeline) + RPCs
  `wa_send_message`, `wa_mark_message_status`, `wa_set_sales_stage`.
- **Server route** `app/api/integrations/whatsapp/send/route.ts`: records the
  outbound reply (DB-authorized via the user's JWT) and only calls WhatsApp Cloud
  API when `WHATSAPP_SEND_ENABLED=true`; otherwise **dry-run** (recorded, not sent).
  The WhatsApp token is server-only.
- **Inbox UI**: reply box is now active (dry-run banner + per-message
  `dry-run/sent/failed` tag) and a **Sales stage** selector (owner/manager).

### Manual steps for Phase 1
1. **Checkpoint (أ):** review `docs/whatsapp_sales_phase1_RUNME.sql`, then run it in
   **Supabase → SQL Editor**. (Idempotent; rollback block at the bottom.)
2. Add env in **Vercel** (Server, not `NEXT_PUBLIC_`):
   - `WHATSAPP_SEND_ENABLED=false` (keep false for now — dry-run)
   - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION=v21.0`
     (only needed when you later flip to live send — Checkpoint ب)
3. **Checkpoint (ج):** redeploy when ready. The reply box works in dry-run with no
   WhatsApp credentials at all.

### Phase 1 acceptance (dry-run)
- Open a conversation at `/client-portal/admin/whatsapp`, type a reply, Send →
  message appears in the thread tagged **dry-run**; nothing is sent to WhatsApp.
- Change the **Sales stage**; it persists and shows in the list/detail.
- A read-only / unauthorized account is rejected by the database (not just the UI).

### Going live later (Checkpoint ب — do NOT do during testing)
Set `WHATSAPP_SEND_ENABLED=true` + real `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN`,
and test against a **test number first**. Until then, replies stay dry-run.

---

## Phase 2 — Zoho CRM wiring (idempotent lead upsert-by-phone, .sa DC)

- **Migration** `docs/whatsapp_zoho_phase2_RUNME.sql` (ADDITIVE, REVERSIBLE): adds
  `crm_synced_at` to `whatsapp_contacts`/`whatsapp_conversations` + a **service-role-only**
  RPC `wa_set_crm_lead` (writes the Zoho lead id back). `crm_lead_id` already existed.
- **`lib/server/zoho.ts`**: real `.sa` integration — OAuth refresh (cached, uses the
  token response's `api_domain`), **`/Leads/upsert` with `duplicate_check_fields:["Phone"]`**
  (one Lead per phone — create or update, no duplicates), field mapping
  (`Last_Name`, `Phone` as `+E.164`, `Lead_Source=WhatsApp`, `Description`,
  `sales_stage→Lead_Status`). Auth header `Zoho-oauthtoken`. Never logs secrets.
- **Ingest route**: on a new inbound message it upserts the lead and writes
  `crm_lead_id` back — **non-blocking** (ingest returns `ok:true` even if Zoho fails/unset).
- **Manual sync** `POST /api/integrations/whatsapp/zoho-sync` + a **“Sync to Zoho”**
  button in the inbox; a sales-stage change also best-effort re-syncs `Lead_Status`.
- Inbox shows the linked lead + last-sync time + an **Open lead in Zoho** link.

### Manual steps for Phase 2
1. **Checkpoint (أ):** review `docs/whatsapp_zoho_phase2_RUNME.sql`, then run it in Supabase.
2. **Vercel env (server-only, none `NEXT_PUBLIC_`):** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
   `ZOHO_REFRESH_TOKEN` (all minted on the **.sa** DC at `accounts.zoho.sa`),
   `ZOHO_ACCOUNTS_URL=https://accounts.zoho.sa`, `ZOHO_CRM_API_BASE=https://www.zohoapis.sa/crm/v5`.
3. **In Zoho CRM (one-time):** make **Phone** a *unique* field (so upsert dedupes rather
   than inserts duplicates); add `WhatsApp` to the `Lead_Source` picklist; verify the
   `Lead_Status` picklist contains the mapped values (`Not Contacted`, `Attempted to Contact`,
   `Contacted`, `Pre-Qualified`, `Contact in Future`, `Lost Lead`) — add custom ones
   (`Quote Sent`, `Converted`) if you want exact stage parity.
4. **Checkpoint (ج):** redeploy when ready. With `ZOHO_*` unset, everything is a safe no-op.

### Phase 2 acceptance (Preview)
- `ZOHO_*` unset → WhatsApp ingest still returns `ok:true`; no errors.
- `ZOHO_*` set (test/sandbox CRM) → a WhatsApp message creates **one** Lead (source
  WhatsApp); `crm_lead_id` + `crm_synced_at` populate on contact + conversation; a second
  message from the same number **updates** (no duplicate); the inbox shows the lead link;
  “Sync to Zoho” pushes the current sales stage as `Lead_Status`.

## Inbox hardening — routing, dept visibility, dedup, notifications, email

- **Migration** `docs/whatsapp_routing_phase2b_RUNME.sql` (ADDITIVE, REVERSIBLE):
  `assigned_department` + `unread_count` on conversations; dept-aware RLS
  (`wa_can_read_dept` + recreated SELECT policies); `wa_set_department`,
  `wa_mark_read` RPCs; ingest RPC now routes by department, counts unread, sends
  dept-scoped notifications with a message preview, and returns `crm_lead_id`;
  `whatsapp_staff_alert_settings` table + `wa_set_staff_alert` (future staff WA alerts).
- **Zoho duplicate fix** (`lib/server/zoho.ts`): known `crm_lead_id` → update by id;
  else **search** Phone+Mobile across variants (`+966…`, `966…`, `05…`, raw) → update
  if found, else create. No reliance on `/upsert`. Logs: `zoho_existing_lead_found`,
  `zoho_lead_created`, `zoho_lead_updated`, `zoho_duplicate_prevented`,
  `zoho_sync_skipped`, `zoho_sync_failed_non_blocking`. Still non-blocking.
- **Visible tab** “WhatsApp Inbox / صندوق واتساب” → `/client-portal/admin/whatsapp`
  for owner/admin/manager/sales/support/hr/finance only (clients never see it).
- **Notifications** now open the exact conversation (the inbox resolves a deep-linked
  `?conversation=<id>` even if it's outside the current filter); fallback opens the inbox.
- **Inbox UI**: department / sales-stage / priority / assignee / unread filters, unread
  badges, department control, Zoho linked/not-linked badge.
- **Email alerts** (`lib/server/notifyEmail.ts`): department-scoped, **gated**
  (`WHATSAPP_EMAIL_ALERTS_ENABLED`, default false), reuses the Apps Script channel,
  non-blocking.

### Manual steps
1. **Checkpoint (أ):** review + run `docs/whatsapp_routing_phase2b_RUNME.sql` in Supabase.
2. (Optional) Email alerts: set `WHATSAPP_EMAIL_ALERTS_ENABLED=true` **and** extend the
   Apps Script `doPost` to handle `Event:"whatsapp_new"` (recipients arrive in `To`).
3. Staff WhatsApp alerts stay OFF (`WHATSAPP_STAFF_ALERTS_ENABLED=false`) — schema only.
4. Marketing staff: assign them `staff_role='sales'` (the sales_marketing department) —
   there is no separate `marketing` role yet.

### Rollback
Run the ROLLBACK block in `docs/whatsapp_routing_phase2b_RUNME.sql` (restores the
category-based policies, drops the new columns/RPCs/table), and revert the commit.

## Phase A+B+C — stabilize, safe replies, email alerts

- **Migration** `docs/whatsapp_phaseABC_RUNME.sql` (ADDITIVE): `whatsapp_send_audit`
  table + `wa_record_send_audit` RPC (audits every reply attempt) and
  `wa_alert_recipients` RPC (resolves email recipients as a `SECURITY DEFINER`
  function — fixes the `service_role`-cannot-`SELECT`-`profiles` issue).
- **Phase B — replies:** the send route now (1) defaults to dry-run, (2) when
  live, BLOCKS any recipient not in `WHATSAPP_SEND_TEST_ALLOWLIST` (when set),
  (3) audits every attempt (dry_run/sent/failed/blocked), (4) the inbox shows the
  status tag + a **Retry** button on failed sends and the exact dry-run notice
  `وضع تجريبي: تم تسجيل الرد ولم يُرسل فعليًا`.
- **Phase C — email:** new incoming message emails owner/admin/manager + routed-
  department staff + the assignee only (via `wa_alert_recipients`); content has
  name/phone/preview/departments/priority/link; gated by `WHATSAPP_EMAIL_ALERTS_ENABLED`
  (default false); non-blocking. Logs: `whatsapp_email_alert_queued/sent/failed_non_blocking`.
- **Phase A — regression tests:** `scripts/whatsapp-routing.test.ts`. Run:
  ```
  node_modules/.bin/tsc lib/whatsapp/classify.ts lib/whatsapp/route.ts lib/whatsapp/summary.ts \
    scripts/whatsapp-routing.test.ts --outDir /tmp/kian-test --module commonjs --target es2019 \
    --skipLibCheck --moduleResolution node && node /tmp/kian-test/scripts/whatsapp-routing.test.js
  ```

### Manual steps (A+B+C)
1. **Checkpoint (أ):** run `docs/whatsapp_phaseABC_RUNME.sql` in Supabase (after the
   earlier migrations — it depends on `wa_can_read_dept` / `wa_can_read_routed`).
2. Real replies stay OFF: keep `WHATSAPP_SEND_ENABLED=false`. To test real sends to a
   single number: set `WHATSAPP_SEND_ENABLED=true` **and** `WHATSAPP_SEND_TEST_ALLOWLIST=<digits>`.
3. Email alerts: optional, set `WHATSAPP_EMAIL_ALERTS_ENABLED=true` + extend the Apps
   Script `doPost` for `Event:"whatsapp_new"`.

### Still to build (next turns): E AI agent (gated), G Zoho Books draft-only,
H dashboard, I full deploy docs.

## Ops batch — internal alerts + quote linking + start-conversation (gated OFF)

One additive migration: **`docs/whatsapp_ops_batch_RUNME.sql`** (review, then run in
Supabase → SQL Editor; rollback block at the bottom). It depends on the inbox, routing
phase 2b (`wa_can_read_dept`, `whatsapp_staff_alert_settings`, `wa_set_staff_alert`,
`wa_is_triager`), and multi-dept (`wa_can_read_routed`, `routed_departments`) migrations.

**Part 1 — Internal WhatsApp staff alerts (`WHATSAPP_INTERNAL_ALERTS_ENABLED=false`)**
- New `whatsapp_internal_alert_audit` + RPCs `wa_internal_alert_recipients` /
  `wa_log_internal_alert` (service_role). Recipients = active staff who enabled alerts
  **and** set a number, restricted to owner/admin/manager **+** the assignee **+**
  routed-department staff (by `staff_role`). Unrelated employees never receive alerts.
- Each staff member sets their number in the inbox header → **⚙️ alert settings**.
- Server sender `lib/server/whatsappInternalAlert.ts` runs from the incoming webhook
  (block 5c), **non-blocking**. Sends the approved `internal_alert_ar` template only.
  OFF by default; with creds but no allowlist match → `blocked`; no creds → `skipped`.
  Restrict with `WHATSAPP_INTERNAL_ALERTS_TEST_ALLOWLIST=<digits,…>`.

**Part 2 — Quote-request linking (no new flag)**
- New `whatsapp_quote_requests` table (separate from the portal `quote_requests`, which
  is `user_id NOT NULL` and can't hold anon WhatsApp leads). RLS = whoever can read the
  conversation. RPCs `wa_create_quote_request` (staff, in-inbox) and
  `wa_link_quote_request_public` (service_role, customer self-submit; dedupes by reusing
  the open `new` request). Both `notify()` sales/marketing + owner/admin/manager (+finance).
- Inbox conversation row: **إنشاء طلب عرض سعر / نسخ رابط الطلب / إرسال رابط الطلب**.
  Link format `/quote-request?source=whatsapp&conversation=<id>`. The public quote form
  best-effort POSTs to `/api/integrations/whatsapp/quote-request` after the Sheets
  submit — link-back never blocks or errors the customer (route always returns 200).
  Linked quotes show as a card (name/services/status/source/Zoho ↗) in the conversation.

**Part 3 — Start new conversation (`WHATSAPP_START_CONVERSATION_ENABLED=false`)**
- Inbox header **بدء محادثة جديدة** button — locked (🔒) until the flag is `true`.
- Modal collects phone/name/company/department/template/variables/reason. Brand-new
  numbers **require** an approved template (no free-form). Templates registry:
  `welcome_followup_ar`, `quote_followup_ar`, `appointment_confirmation_ar`,
  `invoice_followup_ar`, `hr_followup_ar` (see `docs/whatsapp_templates.md`).
- `POST /api/integrations/whatsapp/start-conversation` → RPC `wa_start_conversation`
  (triager-only) creates/attaches contact+conversation (dedupe by `wa_id`) and records
  the template message. The template is **actually sent only** when
  `WHATSAPP_TEMPLATE_SEND_ENABLED=true` **and** creds present **and** the number is on
  `WHATSAPP_TEMPLATE_TEST_ALLOWLIST` (if set). Otherwise **dry-run** (created, not sent).
  All attempts audited in `whatsapp_template_audit` (skipped/dry_run/sent/failed/blocked).

The `GET /api/integrations/whatsapp/send` diagnostic now also reports
`start_conversation_enabled`, `template_send_enabled`, `internal_alerts_enabled`
(booleans only). `WHATSAPP_SEND_ENABLED` behavior is unchanged.

### Manual steps (ops batch)
1. **Checkpoint (أ):** run `docs/whatsapp_ops_batch_RUNME.sql` in Supabase.
2. Submit the 6 templates in `docs/whatsapp_templates.md` to Meta for approval.
3. Staff set their alert numbers in the inbox (⚙️). Nothing sends while the flags are off.
4. To pilot: enable one flag at a time with its allowlist set to a single test number.

## Phase 1+2+4 — send-state UI, email completion, in-portal alerts (no migration)

- **Phase 1:** the inbox reads `GET /api/integrations/whatsapp/send` (returns
  `send_enabled` + presence booleans `token_present`/`phone_id_present`/`api_version`
  /`allowlist_count` — **no secret values**). Dry-run banner shows only when sending
  is off (`وضع تجريبي: الرد يسجل في المحادثة ولا يرسل فعليًا`); a green "live" note when on.
- **Phase 2:** the email alert now includes the **Zoho Lead link** and logs
  `whatsapp_email_alert_recipients_resolved`. (Recipients already resolved via the
  `wa_alert_recipients` RPC — owner/admin/manager + routed-department staff + assignee.)
- **Phase 4:** a 🔔/🔕 toggle (per-user, localStorage) enables an in-portal **sound**
  + **desktop notification** on a new message; an in-app toast fires for everyone.
  Alerts only trigger for conversations the viewer can see (RLS), so finance only
  hears finance-routed messages, etc. A header **unread total** badge is shown.
  (No schema change — uses the existing `unread_count` + polling.)

### Remaining program (each its own approved batch; all ship gated OFF)
- **Phase 5 — quote-request linking:** additive migration (link columns on
  `quote_requests`) + `/quote-request?source=whatsapp&conversation=…` + inbox
  buttons + admin display + conversation card.
- **Phase 3 — internal WhatsApp staff alerts:** settings UI + gated send path +
  audit + Meta template text (`WHATSAPP_INTERNAL_ALERTS_ENABLED`, allowlist).
- **Phase 6 — start new conversation:** template registry + form + gated template
  send (`WHATSAPP_START_CONVERSATION_ENABLED`/`WHATSAPP_TEMPLATE_SEND_ENABLED`).
- **Phase 7 — AI agent (gated):** provider abstraction + prompt/policy + draft-only
  suggestions UI + escalation (`AI_AGENT_ENABLED=false`, `AI_DRAFT_ONLY=true`).
- **Phase 8 — SLA/ops:** SLA timers, mentions, extra statuses, manual routed-dept add/remove.
- **Phase 9 — dashboard:** widgets + filters (read-only).
- **Phase 10 — production docs:** full migration order, prod env, launch checklist,
  token-rotation, n8n export.

Each migration-bearing phase will be presented as a RUNME file for your approval (guardrail #8).

## Standing items you own (per phase, as we reach them)
- **n8n:** export the live `Kian WhatsApp - LIVE Production` workflow as JSON so
  edits can be precise. The Meta webhook URL is never changed.
- **Zoho (.sa):** create the OAuth app, provide `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`
  and `ZOHO_ACCOUNTS_URL=https://accounts.zoho.sa`, `ZOHO_CRM_API_BASE=https://www.zohoapis.sa/crm/v5`. (Phase 2)
- **AI:** provide `AI_API_KEY` (Claude). AI auto-reply stays OFF on the live number
  until Checkpoint ب. (Phase 3)
- **Meta templates:** the WhatsApp follow-up templates (text provided in a later
  phase) must be submitted by you for Meta approval.

## Env summary (all server-only unless `NEXT_PUBLIC_`)
See `.env.example`. New in Phase 1: `WHATSAPP_SEND_ENABLED`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `AI_API_KEY`.

## Rollback (Phase 1)
- DB: run the rollback block in `docs/whatsapp_sales_phase1_RUNME.sql`.
- Code: revert the Phase 1 commit on `feature/whatsapp-sales-system`. The inbox
  reverts to read-only; nothing else is affected.
