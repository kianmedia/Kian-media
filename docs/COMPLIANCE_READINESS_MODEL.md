# Compliance Readiness — Explainable Rule Model

`public.vcc_readiness(p_context text)` — **rule-based, not AI.** The returned JSON carries
`engine: "rule_based"` and `ai_used: false`, and the RUNME self-test fails if the marker
disappears. Every row carries the reason, in Arabic, written by the function that made the
judgement — the explanation cannot drift from the verdict because they are produced together.

---

## 1) One definition of "valid"

Validity is **`public.tvn_doc_valid()` and nothing else**:

```
verified = true  AND  (expires_on IS NULL OR expires_on >= current_date)
```

This package **extends** that function with an `owner_kind = 'company'` branch rather than
writing a second one. The original guard (`p_owner_id is null ⇒ false`) is preserved for
`profile` / `vendor` / `asset`; only a company owner — which has no owner id, because the
company profile is a single row — is exempt.

> ⚠️ Without that extension every company document would read "not valid" while being
> verified and current: a silent failure that looks like an answer. The POSTCHECK asserts all
> four branches are present.

The readiness engine calls `tvn_doc_valid` for the **verdict** and reads the document columns
only to **explain** it. When several documents of a type exist, the engine picks the *best*
(verified first, then unexpired, then highest version) so the explanation matches the verdict.

## 2) Requirements are data, not code

`public.vcc_readiness_requirements` — readable by any holder of `compliance.view`:

| Column | Meaning |
|---|---|
| `requirement_key` + `context` | Unique. Contexts: `general`, `government`, `tender`, `client_vendor_registration`, `media_production`. A call evaluates `general` **plus** the requested context. |
| `kind` | `document` \| `profile_field` \| `capability` |
| `doc_type` | FK to `tvn_document_types` — the type that satisfies a document requirement |
| `profile_field` | The company-profile column (or `contact_procurement`) for a field requirement |
| `is_mandatory` | Mandatory requirements decide the state; optional ones only raise warnings |
| `required_language` | `ar` \| `en` \| `both` — a document in the wrong language is **not** met |
| `min_version` | Version floor |

A table CHECK guarantees every requirement carries its reference: a `document` requirement
without a `doc_type` is impossible. Without it such a row would never be checked and would
read as satisfied.

Seeded: commercial register, tax certificate, ZATCA, Zakat, GOSI, Saudization (Nitaqat),
chamber of commerce, national address, bank letter, insurance, HSE policy, privacy policy,
Arabic and English company profiles, legal name, masked CR, masked VAT, national address,
HQ city, Arabic/English about, procurement contact; plus `media_production` (drone permit,
public liability, HSE certificate) and `government` (articles, municipality licence,
authorised signatory).

## 3) Per-requirement verdicts

| Verdict | Meaning |
|---|---|
| `met` | Valid per `tvn_doc_valid`, correct language, version ≥ floor |
| `missing` | No document of that type / empty field / no capability |
| `unverified` | Uploaded but not verified. **Uploading is not verifying.** |
| `expired` | Was verified; the expiry date has passed |
| `wrong_language` | Present and valid, but not in the required language |
| `wrong_version` | Present and valid, but below `min_version` |

## 4) Overall state

| State | Condition | Meaning shown to the owner |
|---|---|---|
| `not_configured` | zero active requirements | **"The rules have not been written yet."** Not "0 %". A zero here would read as "we are non-compliant" and be false. |
| `expired_blockers` | ≥1 mandatory requirement `expired` | Do not submit anything |
| `incomplete` | ≥1 mandatory requirement missing / unverified / wrong language / wrong version | |
| `ready_with_warnings` | all mandatory met, but an optional gap or an expiry inside the warning window | |
| `ready` | all mandatory met, no warnings | |

Warning window: `vcc_settings.readiness_warning_days`, default 30.

## 5) Alerts

Reminder windows are read from **one place**: `tvn_settings.doc_reminder_days`
(default `{90,60,30,7}`), with `vcc_settings.fallback_reminder_days` as an explicit fallback —
not a competing source.

`vcc_scan_compliance(p_emit)`:

- `p_emit = false` → pure read. Nothing is written, nothing is enqueued.
- `p_emit = true` → requires `can_verify_compliance_documents()`, then:
  - flips genuinely expired company documents to `verified = false, doc_status = 'expired'`
    (an authorised, audited act — leaving `verified = true` on an expired document would make
    `tvn_doc_valid` lie in every report), and
  - **enqueues** `compliance.document_expiring` / `document_expired` /
    `grant_expiring` / `registration_deadline_near` / `readiness_degraded` into the
    Communications Hub.

### ⛔ Enqueuing is not sending
Every hub channel is `dry_run = true`. This package never touches `comms_channels`, never
passes `dry_run`, and the self-test **fails** if any `vcc_*` function mentions
`comms_channel_set` or `dry_run`. Events are registered on the `portal` channel only — no
email, no WhatsApp, no SMS. The UI says "أُدرجت N حدثًا … لا شيء يُرسَل".

Each emission carries an idempotency key (`entity : date-or-bucket`) written to
`tvn_event_log`, so a scan run twice does not produce a second alert.
