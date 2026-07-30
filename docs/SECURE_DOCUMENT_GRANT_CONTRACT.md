# Secure Document Grant — Contract

The sharpest security surface in the compliance centre: a way to let someone **outside the
user table** read a specific company document, for a bounded time, a bounded number of times.

---

## 1) The token

| Property | How it is guaranteed |
|---|---|
| Strong and random | `'kvc_' || two v4 UUIDs` → ~244 bits of entropy from the system CSPRNG |
| **Stored only as a hash** | `token_hash = encode(sha256(convert_to(token,'utf8')),'hex')`. There is **no column** that can hold the raw token; the POSTCHECK and the RUNME self-test both fail if one appears. It cannot leak from a backup, a replica, or a query log. |
| Shown exactly once | `vcc_grant_issue` returns it and refuses a second issue: *"صدر رمز لهذه المنحة سابقًا ولا يُعاد إظهاره"*. The UI warns **before** the click, not after. |
| Expiring | `expires_at` is set from `ttl_days` (default 7, hard max 30). Re-checked on **every** open. |
| Revocable | `vcc_grant_revoke` needs a written reason; the next open fails immediately. |
| Use-limited | `max_opens` (1–500) and `max_downloads` (0–100). Counters increment **before** any reference is returned; hitting a limit flips the grant to `exhausted`. |
| Never in a URL the server sees | The share link is `/secure-document#<token>`. A URL fragment is not sent to the server, not written to an access log, and not forwarded in `Referer`. The page reads it client-side and POSTs it in a body. `GET /api/public/secure-document` returns 405 on purpose. |

## 2) What the token cannot do

| Requirement | Mechanism |
|---|---|
| **Must not reveal a storage path** | `vcc_grant_open` returns `storage_bucket`/`storage_path` only to the server, only for a `download`/document action. The route signs them and returns **only the signed URL**. The path never enters a browser response. The grant-level `open` response has no path at all. |
| **Must not reach a document outside its grant** | Access is by row in `vcc_grant_documents`. A correct-but-unattached `document_id` returns `not_in_grant` and is logged as a denial. |
| **Must stop when the document is revoked or expired** | The document is re-validated on **every** open: `verified = true AND doc_status = 'verified' AND (expires_on is null OR expires_on >= current_date)`. Revoking or archiving a document sets `verified = false` (enforced by `tvn_doc_verified_iff_status`), so it drops out instantly with no change to the grant. |
| **Must never give a directory listing** | The RPC never reads `storage.objects`. The bucket is private with no `anon` grant, and its SELECT policy calls `vcc_storage_readable()`, which returns **false for any object with no registry row**. |
| Must not be an existence oracle | Unknown token, expired token, revoked token, not-yet-started token all return the identical `invalid_or_expired`. Only download-specific refusals are distinguished, and only after the grant itself has been proven valid. |

## 3) V1 rule — sensitive links need a request **and** an approval

Enforced by `trg_vcc_grant_document_guard`, a **table trigger** (not just function logic):

- If the document is `confidential`/`restricted` **or** its type is `never_public`, then the
  grant must have `request_id is not null` **and** `approved_by is not null`.
- The document must already be `verified` and unexpired. *Uploading is not verifying, and
  sharing is stricter than viewing.*
- `allow_download` is refused unless the document itself is `is_downloadable`.
- The document list cannot be edited once the grant leaves `draft`/`pending_approval`.

The approval itself is **owner-only** (`vcc_grant_approve` → `vcc_is_owner()`), deliberately
separate from `can_issue_secure_document_grants()`: whoever prepares the link is not whoever
authorises it.

## 4) Lifecycle

```
draft ──add documents──► (pending_approval) ──owner approve──► approved
      ──issue (token shown once)──► active ──► expired | exhausted | revoked
```

`vcc_grant_active_needs_token` makes `status='active'` impossible without both a token hash
and an approver. There is no path from `draft` to a working link.

## 5) ⛔ Delivery

**The link is never emailed, messaged, or sent by this system.** No code path in the SQL, the
TypeScript layer, the server route, or the UI transmits it. After issue, the state is
`ready_for_manual_sharing` — «جاهز للمشاركة اليدوية» — and an authorised employee copies it by
hand. `vcc_access()` reports `delivery_enabled: false` so the UI cannot promise otherwise.

`recipient_email` is stored as **metadata only**, with a stored note saying so.

## 6) Audit

`vcc_grant_access_log` records every `open`, `download`, **and `denied`** with the reason.
Recording only successes would make token-guessing invisible.

The visitor is identified by a **salted SHA-256 fingerprint** computed in the route from IP +
user-agent. The raw IP and user-agent are never stored — that is personal data about a third
party with whom there is no relationship, and the fingerprint answers the only question that
matters ("was this the same client 40 times?").

## 7) The one service-key path

`app/api/public/secure-document/route.ts` is the only place in the module that uses the
service key, and it copies `deliverable-download` exactly:

1. **Authorise first** — `vcc_grant_open` resolves the token, applies every rule above, and
   writes the audit row.
2. **Then sign** — a 120-second signed URL for the `{bucket, path}` the RPC *returned*.
3. **Never** for a bucket/path taken from the request body. That inversion is precisely the
   "universal cross-bucket read oracle" the audit identified, and the pinned
   `tvn_doc_bucket_pinned` CHECK closes the other half of it.

Signed URLs are bearer tokens; 120 s is the control. The route sets
`Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, and `/secure-document` is
disallowed in `robots.ts`.

## 8) Known limitation (V1, stated honestly)

The **watermark is an identity string displayed with the document and stored on the grant**,
not pixels burned into the PDF. It makes every view attributable in the audit log and on
screen; it does not survive a screenshot or a re-export. Burning a watermark into the file
requires server-side rendering that this package deliberately does not add.
