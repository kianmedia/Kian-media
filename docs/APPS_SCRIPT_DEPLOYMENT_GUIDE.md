# APPS SCRIPT DEPLOYMENT GUIDE

## THE HEADLINE: IT IS NOT DEPLOYED

The Google Apps Script handler that portal email delivery depends on **has never been
deployed**. This is not a "probably" — it is the reason no portal notification email has
ever arrived, and it is the single external blocker in front of the whole email channel.

Nothing in this repository can fix it. The script lives in the owner's Google account.
No code here has credentials for it, and deploying it is explicitly out of scope for the
work that produced this guide. **A human has to do the steps below.**

Until then the system behaves correctly and honestly: every email attempt returns
`relay_handler_missing`, the row is requeued without burning an attempt, and no message is
lost or duplicated. The backlog self-heals within about 30 minutes of the handler going
live.

---

## 1) What is missing, precisely

The platform posts `_type: "portal_notify"`. The deployed Web App has no branch for that
value, so it returns immediately, sends nothing, and answers HTTP 200 with an opaque body.

A live probe of the deployed endpoint returns:

```json
{"ok":true,"message":"Kian Media forms API is live"}
```

That is a health banner, not a send receipt. `interpretRelayResponse()`
(`lib/server/projectNotify.ts:96-100`) refuses to treat it as delivery — which is why the
system now reports the outage instead of hiding it.

**The paste-ready source is already in this repo:** `docs/apps_script_portal_notify_HANDLER.gs`.

---

## 2) Deployment steps (owner only)

1. Open <https://script.google.com> in the Google account that owns the Kian forms script.
2. Open the existing Kian forms project. **Do not create a new one** — a new project gets a
   new `/exec` URL and every existing form integration would break.
3. Paste the contents of `docs/apps_script_portal_notify_HANDLER.gs` into the project,
   alongside the existing code. It adds two functions:
   * `kianHandlePortalNotify_(data)` — returns `null` for any `_type` other than
     `portal_notify`, so the existing `quote` / `meeting` / `upload` paths are untouched;
   * `kianJson_(obj)` — returns the reply as JSON.
4. Wire it into `doPost` **before** the existing branches, and return early when it handles
   the payload. Note the `kianJson_()` wrapper — `doPost` must return a `ContentService`
   output, never a bare object, or Apps Script raises an error and the caller sees a
   non-JSON body, which the platform correctly classifies as `relay_handler_missing`:
   ```js
   var portal = kianHandlePortalNotify_(data);
   if (portal) return kianJson_(portal);
   ```
5. **Script Properties** (Project Settings → Script Properties). Names only — never commit
   values, and never put a secret in the `.gs` file itself:

   | Name | Purpose | When |
   |---|---|---|
   | `KIAN_PORTAL_NOTIFY_SECRET` | HMAC key; must equal the Vercel env `COMMS_RELAY_SIGNING_SECRET` | strongly recommended — the `/exec` URL is public by design |
   | `KIAN_PORTAL_NOTIFY_REQUIRE_SIGNATURE` | `true` rejects every unsigned payload | only **after** every producer posts through the hub; before that it would break the legacy senders, which do not sign |

   The fallback recipient and the sender name are plain `var`s at the top of the handler
   file (`KIAN_PORTAL_FALLBACK_TO`, `KIAN_PORTAL_SENDER_NAME`); edit them in place.

   **Signature behaviour, exactly:**
   * no secret set → unsigned compatibility mode; the reply carries `mode:"legacy_unsigned"`;
   * secret set + payload carries `contract_version` (i.e. it came from the hub) →
     signature **required**, `bad_signature` / `signature_expired` otherwise;
   * secret set + legacy payload without `contract_version` → still accepted, until you
     set `KIAN_PORTAL_NOTIFY_REQUIRE_SIGNATURE=true`.

   The signed string is defined once, in `docs/EMAIL_PROVIDER_CONTRACT.md` §3, and built by
   `kianCanonicalString_()` on the script side and `canonicalSigningString()` on the server
   side. Changing one without the other produces permanent verification failure — run
   `kianTestCanonicalString_()` in the editor and compare before you suspect anything else.
6. **Deploy → Manage deployments → edit the existing deployment → New version → Deploy.**
   ⚠️ Without a **new version** the old code keeps serving and nothing changes. This is the
   single most common way this step silently fails.
   Keep: *Execute as: Me* · *Who has access: Anyone*.
7. Confirm the `/exec` URL is unchanged. If it changed, update `PORTAL_NOTIFY_ENDPOINT` in
   Vercel.

**Triggers are not required.** The script is request-driven; there is no time-based
function.

---

## 3) The reply the handler must produce

```json
{ "ok": true, "handler": "portal_notify", "sent": 1, "failed": 0, "recipients": 1 }
```

The `handler` tag is mandatory. An untagged reply — including a generic `{"ok":true}` — is
recorded as `relay_handler_missing` and is **not** counted as delivery. See
`docs/EMAIL_PROVIDER_CONTRACT.md` §4 for the full table.

---

## 4) How to verify it worked (and how to prove it did not)

**Positive test.** After deploying, from the communications board run one drain and check
that a row settles with `provider_message_id` set and `ack:true` in `provider_response`.
Nothing here is a live send while the hub's email channel is disabled and the provider is a
mock — so during this phase the honest expected result is that the *legacy* path stops
reporting `relay_handler_missing`, not that the hub sends.

**Negative test — do this once, deliberately.** Deploy a version **without** the handler and
confirm the system reports `relay_handler_missing` and leaves the rows `pending` with
`attempts` unchanged. If it reports success instead, something has regressed to trusting
HTTP 200 and must be fixed before going live.

**Idempotency test.** Perform the same business action twice. There must be exactly one
queue row, and the second attempt must report `already_sent` / duplicate-suppressed — not a
second message.

**Relay-side idempotency.** The handler also remembers each `IdempotencyKey` for six hours
in `CacheService` and **replays the earlier acknowledgment** (`duplicate: true`) instead of
mailing again. This is the second line of defence, for the one code path that has no
database-level key — `emitViaFallback()` in `lib/server/notifyEvent.ts`, which sends
directly when the SQL is not applied (`docs/LEGACY_EMAIL_DEDUPLICATION_AUDIT.md` §5).
`CacheService` may evict early under load, so it is a mitigation, not a guarantee; the
database key remains the primary control.

---

## 5) Quota

| Account type | Messages/day |
|---|---|
| Personal Gmail | 100 |
| Google Workspace | 1500 |

One request per recipient, so one event with six recipients costs six. Over quota, the
relay fails at the relay; the hub records a failure rather than a phantom send.

---

## 6) What this guide does **not** authorize

* It does not turn on the hub's email channel. That is a separate, deliberate step in
  `docs/COMMUNICATIONS_GO_LIVE_GUIDE.md`, and it must not be done on the same day.
* It does not enable rental notifications. `custody_inventory_settings.rental_email_queue_enabled`
  stays `false`; flipping it while a resolver-based producer also enqueues would create two
  queue rows under two different idempotency-key shapes — a guaranteed double-send
  (`docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md` §6.2).
* It does not replace the mock provider. `lib/server/commsProvider.ts` still has no network
  call, by design.
