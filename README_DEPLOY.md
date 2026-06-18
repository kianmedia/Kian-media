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
