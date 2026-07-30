# EMAIL PROVIDER CONTRACT — Communications Hub

**Contract version:** `1` (`COMMS_CONTRACT_VERSION` in `lib/server/commsProvider.ts:35`)
**Status:** specified, tested, and **not connected to anything**. The only provider that
exists is a mock. There is no `fetch()` anywhere in `lib/server/commsProvider.ts` and there
must not be one until the go-live guide says so.

---

## 0) Why this document exists

The platform has exactly one mail relay: a Google Apps Script Web App that owns the Gmail
credentials. It has never delivered a portal notification, because it contains no handler
for the payload the portal sends. That failure was invisible for a long time — the relay
answered HTTP 200 with a health banner and the old code counted that as "sent".

So this contract is written **acknowledgment-first**: the exact bytes, the exact reply that
counts as delivery, and the exact replies that do not.

---

## 1) Transport

| | |
|---|---|
| Method | `POST` |
| URL | `PORTAL_NOTIFY_ENDPOINT`, falling back to `SHEETS_ENDPOINT` (`lib/submitForm.ts:6`) |
| Content-Type | `text/plain;charset=utf-8` — Apps Script rejects a JSON preflight; the body is still JSON |
| Redirects | **must follow**. `/exec` answers `302` and the real body is behind it |
| Timeout | 20 s hard ceiling. A timeout is a normal, burnable attempt (`network_error`) |
| Batching | none. **One request per recipient.** A shared `To` line is how one bad address kills a whole send and how a client sees a colleague's address |

---

## 2) Request payload

Built by `buildRelayPayload()` (`lib/server/commsProvider.ts:99`). Deterministic: the admin
preview renders this exact object, so what is reviewed is what would be sent.

```jsonc
{
  "_type": "portal_notify",          // the discriminator the handler branches on
  "contract_version": 1,
  "To": "person@example.com",        // exactly one address
  "Subject": "…",                    // rendered from comms_templates, never empty
  "Body": "…",                       // plain text, Arabic or English
  "Event": "deliverable.preview_sent",
  "Link": "https://www.kianmedia.com/client-portal/…",
  "Locale": "ar",
  "IdempotencyKey": "<event>:<entity>:<user>:<channel>",
  "CorrelationId": "<uuid>",
  "Signature": "<hex>",              // present only when signing is configured
  "SignedAt": "<ISO-8601>"
}
```

**Field rules**

* `Subject` is never empty. The database rejects an empty template subject.
* `Body` for an external recipient is rendered from a `client`-scoped template and has
  already passed rules R1 and R2 (see §5).
* `IdempotencyKey` is stable for a given (event, entity, recipient, channel). A relay may
  drop an exact repeat on it without knowing anything about our schema.
* `CorrelationId` is **internal**. It appears in the payload for relay-side log correlation
  and must never be rendered into a message a client reads. `comms_body_has_restricted_content()`
  treats the literal string `correlation_id` as restricted for exactly this reason.

---

## 3) Signature

Optional. Enabled by setting `COMMS_RELAY_SIGNING_SECRET` on both sides.

HMAC-SHA256 over a **canonical string**, not over `JSON.stringify` — key order and
whitespace are not stable across runtimes, so signing serialized JSON produces signatures
that verify on one platform and fail on another.

`canonicalSigningString()` (`lib/server/commsProvider.ts:132`) joins these with `\n`, in
this order:

```
v<contract_version>
<_type>
<Event>
<To>
<IdempotencyKey>
<CorrelationId>
<SignedAt>
<HMAC-SHA256("kian.body", Subject + "\n" + Body) as hex>
```

The message text is included as a **hash**, not as text: the signed string stays short and
no log that records "what was signed" ends up holding message bodies.

Verification is constant-time (`verifyRelaySignature()`, `:155`).

**Replay window.** `docs/apps_script_portal_notify_HANDLER.gs` rejects a `SignedAt` more
than **±10 minutes** from the relay's own clock (`KIAN_PORTAL_SIGNATURE_WINDOW_MS`) and
answers `signature_expired`. The window is the relay's choice; ±10 minutes is what the
shipped handler uses, and it is wide enough for a queued row that waits before its attempt.

**Relay-side idempotency.** The handler remembers each `IdempotencyKey` for six hours and
returns the earlier acknowledgment with `duplicate: true` rather than sending a second
message. The reply is the *stored* one, so `sent` keeps its original positive value and the
classifier still records a delivery — a retry after a lost response settles correctly
instead of failing.

**Unsigned mode** is valid and is the current default: the endpoint URL itself is the
secret. That is weak — the `/exec` URL must be reachable by "Anyone" for the relay to work
at all — so set the secret as soon as a real send is contemplated. Enforcement is staged:
the handler requires a signature on any payload carrying `contract_version` once a secret
exists, and rejects *everything* unsigned only when
`KIAN_PORTAL_NOTIFY_REQUIRE_SIGNATURE=true`, which must wait until the legacy senders
(which do not sign) are retired or migrated.

---

## 4) Response — the only thing that counts as delivery

The hub does not implement this classification twice. It calls
`interpretRelayResponse()` (`lib/server/projectNotify.ts:70`) through
`classifyRelayBody()` (`lib/server/commsProvider.ts:227`), so the hub and the existing
sender can never drift apart.

| Relay answers | Verdict | Hub outcome | Effect on the row |
|---|---|---|---|
| JSON with `handler:"portal_notify"` and `sent > 0` | **delivered** | `sent` + `ack:true` | terminal `sent` |
| JSON with `handler:"portal_notify"` and `sent = 0` | rejected | `failed` | retry with backoff, then dead-letter |
| JSON with `ok:false` / an `error` string | rejected | `failed` | retry, then dead-letter |
| Generic `{"ok":true}` with no handler tag | **NOT delivery** | `channel_deferred` | requeued in 30 min, **attempt handed back** |
| Non-JSON / HTML / empty body | **NOT delivery** | `channel_deferred` | requeued, attempt handed back |
| HTTP ≥ 400 | failure | `failed` | retry, then dead-letter |
| timeout / network error | failure | `failed` | retry, then dead-letter |

**Required success reply:**

```json
{ "ok": true, "handler": "portal_notify", "sent": 1, "failed": 0, "recipients": 1 }
```

> A bare `{"ok":true}` is explicitly refused. A live probe of the deployed Web App returns
> `{"ok":true,"message":"Kian Media forms API is live"}` — a health banner. Accepting a
> truthy `ok` would recreate the exact false success this whole contract exists to kill.

### The channel-vs-message distinction

`channel_deferred` is not a soft failure — it is a **different kind** of failure. The
message is fine; the channel is not (disabled, unconfigured, handler not deployed). Those
rows keep their attempt (`comms_settle` does `attempts = attempts - 1`) and requeue. Without
that, an undeployed handler would dead-letter the entire backlog in five cron runs and
destroy exactly the mail the deferral exists to preserve.

---

## 5) What the provider is never allowed to receive

Enforced before the payload is ever built, in the database:

* **R1** — a row whose `audience_scope = 'internal'` can never carry an external recipient.
  The `t_comms_outbox_guard` trigger recomputes externality from `profiles` rather than
  trusting the inserted value, so a direct `service_role` INSERT cannot get around it.
* **R2** — a row for an external recipient can never carry financial or internal content.
  Checked both by the catalogue flag `is_financial` and by
  `comms_body_has_restricted_content()`.

An unknown user is treated as **external** (`comms_is_external()` fails closed), so an
internal message is never delivered to somebody the system cannot identify.

---

## 6) Live-send checklist for whoever implements the real branch

The branch is marked in `lib/server/commsProvider.ts` inside `deliver()`. Replacing it is
the **only** code change required. It must:

1. `POST` the payload from `buildRelayPayload(m)` — do not rebuild it by hand.
2. `redirect: "follow"`, `AbortSignal.timeout(20_000)`, `cache: "no-store"`.
3. Read the response **body** and pass it to `classifyRelayBody()`. Never branch on
   `res.ok`.
4. Return the `CommsSendResult` unchanged. Do not synthesize `ack:true`.
5. Log counts and a masked address (`maskAddress()`), never the endpoint URL, never a
   token, never a full message body.
6. Change nothing else. `comms_settle` still refuses a non-dry-run `sent` without
   `ack:true`, and that refusal is the last line of defence against a forged success.

---

## 7) Quotas and hard external limits

* Gmail personal account: **100 messages/day**. Google Workspace: **1500/day**.
* One request per recipient means an event with 6 recipients costs 6 against the quota.
* Over quota the relay fails **at the relay**, and its reply will not carry
  `handler:"portal_notify"` with `sent > 0` — so the hub records a failure rather than a
  phantom send. That is correct, and it is also why `comms_event_catalog.rate_limit_hour`
  exists (default 200/hour/event, enforced by `comms_rate_check()` against a shared table,
  not per-instance memory).

---

## 8) WhatsApp

Placeholder only. `whatsappPlaceholder()` returns `channel_deferred` with
`whatsapp_not_implemented`. There is no customer-facing WhatsApp notification provider,
the channel ships disabled, and `lib/server/whatsappInternalAlert.ts` (internal staff
alerts over the Meta Cloud API, off by default) is a separate, untouched system.
