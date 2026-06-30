# n8n WhatsApp Send — response contract (portal ⇄ n8n ⇄ Meta)

The portal processor (`lib/server/deliveryWhatsApp.ts`) POSTs to
`N8N_WHATSAPP_SEND_WEBHOOK_URL` and now enforces **delivery truth**: a row is
marked **SENT only when n8n returns a confirmed Meta message id**. Anything else
is **FAILED** with a safe reason. This is what the n8n workflow must return.

## Request the portal sends (JSON body)
```json
{
  "to": "9665XXXXXXXX",
  "template_name": "quote_request_received_ar",
  "language": "ar",
  "variables": ["QR-2026-000123"],
  "event_type": "new_quote_request",
  "recipient_role": "client",
  "idempotency_key": "new_quote_request:<uuid>:<user-or-phone>:whatsapp"
}
```
Header `x-kian-send-secret: <N8N_WHATSAPP_SEND_SECRET>` is sent when that env is set
(must be ASCII). Use it in n8n's **Header Auth** credential on the webhook.

## Response the portal REQUIRES

**Success (Meta accepted) — return ONLY when Meta replied with `messages[0].id`:**
```json
{ "ok": true, "provider": "meta_cloud", "message_id": "wamid.HBgM..." }
```

**Error (Meta or n8n failed):**
```json
{ "ok": false, "provider": "meta_cloud", "error": "<safe reason>", "message": "<safe message>" }
```

How the portal interprets the response:
| n8n returns | Portal result |
|---|---|
| `{ ok:true, message_id:"wamid..." }` | **SENT**, `provider_message_id = wamid...` |
| `{ ok:false, error/message }` | **FAILED**, safe reason (401/OAuth → "Meta authentication failed …") |
| HTTP non‑2xx | **FAILED**, safe reason |
| `{ ok:true }` with **no** `message_id` | **FAILED**, "n8n did not return Meta message id" |
| empty/`{}` (e.g. webhook responded immediately) | **FAILED**, "n8n returned no Meta result" |

So a generic n8n 200 can **no longer** become SENT — Meta's `message_id` is mandatory.

## Exact n8n node changes

1. **Webhook (trigger)** → set **Respond** = **"Using 'Respond to Webhook' node"**
   (NOT "Immediately"). Otherwise n8n answers 200 before Meta is called and every
   row will now be FAILED with "n8n returned no Meta result".

2. **Send Template Message (HTTP Request → Meta Cloud API)**
   - Method `POST`, URL `https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages`
   - **Header** `Authorization` = `Bearer <valid Meta access token>` (this is the
     401 source — see below), `Content-Type: application/json`
   - Body: `messaging_product=whatsapp`, `to={{$json.to}}`, `type=template`,
     `template.name={{$json.template_name}}`, `template.language.code={{$json.language}}`,
     components from `variables`.
   - **On Error** = "Continue (using error output)" so failures route to the error node.

3. **Return Send Result** (Respond to Webhook, SUCCESS branch — only reached when
   the Meta node returns 2xx with `messages[0].id`):
   ```
   ={{ { "ok": true, "provider": "meta_cloud", "message_id": $json.messages[0].id } }}
   ```
   Response code 200. Do **not** emit this unless `messages[0].id` exists.

4. **Return Send Error** (Respond to Webhook, ERROR branch — always valid JSON):
   ```
   ={{ {
     "ok": false,
     "provider": "meta_cloud",
     "error": String($json.error?.error?.type || $json.error?.type || "send_error"),
     "message": String($json.error?.error?.message || $json.error?.message || "WhatsApp send failed").slice(0,240)
   } }}
   ```
   Response code 200 (or 502). Never return the access token or full phone number.

## The 401 OAuthException (current failure)

`401 Authentication / OAuthException` from Meta means the **access token used in the
n8n Authorization header is missing, expired, or invalid** — not a portal bug. When
this happens the portal now shows: **"Meta authentication failed — check
WHATSAPP_ACCESS_TOKEN / n8n Authorization credential"** (token value never shown).

Fix (regenerate a permanent token):
1. Meta **Business Manager → WhatsApp → API Setup** (or a **System User** under
   Business Settings for a non-expiring token).
2. Generate a token for the WhatsApp Business account with `whatsapp_business_messaging`
   (and `whatsapp_business_management`) permissions. A 24h test token expires — use a
   **System User permanent token**.
3. In **n8n**, open the Meta HTTP node's credential / the `Authorization` header and set
   `Bearer <new token>`. (If the portal Meta fallback is used instead of n8n, set
   `WHATSAPP_ACCESS_TOKEN` in Vercel — ASCII only.)
4. Re-run a test; the Meta node should return `messages[0].id`.
