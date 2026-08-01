# COMMUNICATIONS HUB — MANUAL ACCEPTANCE

> # ⛔ DOCUMENTATION — DO NOT PASTE INTO THE SQL EDITOR
> # ⛔ ملفّ توثيقيّ — لا يُنسخ إلى محرّر SQL
>
> **EN —** This is a **Markdown** checklist, not executable SQL. Pasting it into the
> Supabase SQL Editor raises `ERROR: 42601 syntax error at or near "#"`. Nothing is
> wrong with the database when that happens: the wrong kind of file was executed.
> Perform these steps **in a browser**, signed in as the roles named below.
>
> **ع —** هذا ملفّ **Markdown** توثيقيّ ولا يُنسخ إلى محرّر SQL. نسخُه هناك يرفع
> `ERROR: 42601` عند «#»، وليس في قاعدة البيانات عطل: نُفِّذ نوعُ ملفٍّ خاطئ.
> نفِّذ الخطوات **في المتصفّح** بحسابات الأدوار المذكورة أدناه.
>
> ✅ `.sql` = يُنفَّذ في محرّر SQL  ·  📄 `.md` = يُقرأ ويُنفَّذ يدويًّا في المتصفّح


**Who runs this:** the owner, on production, after `docs/communications_hub_RUNME.sql`.
**How long:** about 25 minutes.
**What it proves:** the hub is installed, locked down, honest, and **still sending
nothing**. Passing this checklist is *not* permission to go live — that is
`docs/COMMUNICATIONS_GO_LIVE_GUIDE.md`, and it is a separate, later decision.

Record the result of every step. A step that cannot be performed is a **FAIL**, not a
skip: "we could not check" is how the last two cycles produced forged "sent" signals.

---

## 0) Before you start

| # | Precondition | How to confirm |
|---|---|---|
| 0.1 | Code is deployed | The portal page `/client-portal/communications` loads |
| 0.2 | SQL not yet run | Expected at this point — the page must show «الميزة بانتظار تفعيل قاعدة البيانات» and **not** an error |
| 0.3 | Apps Script handler NOT deployed | `GET /api/comms/process` answers `apps_script_handler_deployed: false` |

**Step 0.2 is itself an acceptance test.** If the page shows a permission error or a blank
screen instead of the Arabic waiting notice, stop: feature detection is broken.

---

## A — Install

| # | Action | Expected | Result |
|---|---|---|---|
| A.1 | Run `docs/communications_hub_PREFLIGHT.sql` | Rows only; no error. Note which existing objects are PRESENT | ☐ |
| A.2 | Note the legacy baseline printed by the PREFLIGHT (`email_deliveries` counts) | Write the numbers down — A.6 compares against them | ☐ |
| A.3 | Run `docs/communications_hub_RUNME.sql` | Ends with `COMMUNICATIONS HUB SELF-TEST PASSED — N catalogue events…` | ☐ |
| A.4 | Re-run the RUNME immediately | Same success. It is idempotent; a second run must change nothing | ☐ |
| A.5 | Run `docs/communications_hub_POSTCHECK.sql` | Every `check_id` reads PASS or INFO. **Any FAIL stops acceptance** | ☐ |
| A.6 | Compare the POSTCHECK legacy notice with A.2 | Identical. The hub must not have touched `email_deliveries` | ☐ |

---

## B — Nothing sends (the point of the whole phase)

| # | Action | Expected | Result |
|---|---|---|---|
| B.1 | POSTCHECK `B.channels_safe` | PASS — email and whatsapp disabled, every channel `dry_run` | ☐ |
| B.2 | POSTCHECK `B.no_live_sends_recorded` | PASS — zero non-dry-run sends | ☐ |
| B.3 | Open the hub page as an admin | Header shows **«وضع تجريبي — لن يتم إرسال رسالة حقيقية»** | ☐ |
| B.4 | Press **معالجة الطابور الآن (محاكاة)** | Result line ends with the same sentence, and `إرسال فعلي = 0` | ☐ |
| B.5 | Check your inbox after B.4 | **No email arrives.** If one does, stop everything and report it | ☐ |
| B.6 | `GET /api/comms/process` | `provider: "mock"`, `sends_anything: false` | ☐ |

---

## C — Honest states, never a forged success

| # | Action | Expected | Result |
|---|---|---|---|
| C.1 | Find any row whose status is `sent` while `dry_run` is on | It reads **«محاكاة — لم يُرسل فعليًا»**, never «أُرسل» | ☐ |
| C.2 | Export CSV | The same row exports as `sent (dry_run)`, not `sent` | ☐ |
| C.3 | Queue-health tiles | «محاكاة (لم تُرسل)» and «إرسال فعلي» are two separate numbers, never summed | ☐ |
| C.4 | «منسوخة من القديم» tile | Mirrored legacy rows are counted here, not in «إرسال فعلي» | ☐ |
| C.5 | Take one channel out of dry-run, then press process, then put it back | The row settles as a **failure** with `no_provider_ack` — not a success. Put the channel back to dry-run immediately | ☐ |

C.5 is the single most important test in this document. It proves that even a
mis-configuration cannot manufacture a "sent".

---

## D — Client isolation (rules R1 and R2)

| # | Action | Expected | Result |
|---|---|---|---|
| D.1 | Sign in as a **client** and open `/client-portal/communications` | Denied with a permission message — **not** the migration notice | ☐ |
| D.2 | As a client, call `comms_dashboard` directly (browser console, anon key) | `not_authorized` | ☐ |
| D.3 | Hub → preview `risk.critical_raised` with scope **نسخة العميل** | No client template exists for an internal event; preview refuses | ☐ |
| D.4 | Hub → preview any client event with `finance.invoice_issued` selected | The financial warning appears: R2 would block it | ☐ |
| D.5 | POSTCHECK `C.external_fails_closed` | PASS — an unknown user counts as EXTERNAL | ☐ |
| D.6 | POSTCHECK `C.no_client_template_for_internal_event` | PASS | ☐ |

---

## E — The browser can no longer reach a mail relay

This is the defect the phase existed to close. Test it as an attacker would.

| # | Action | Expected | Result |
|---|---|---|---|
| E.1 | Open the **public** opportunities page, DevTools → Network, submit a real request | The only request is the Supabase RPC. **No request to `script.google.com`** | ☐ |
| E.2 | Confirm the submission still notifies staff | A portal notification for the new opportunity appears for the admins | ☐ |
| E.3 | While signed out, `POST /api/comms/legacy-notify` with any body | `401 not_authenticated` | ☐ |
| E.4 | As a signed-in **client**, POST the same | `403 not_authorized` | ☐ |
| E.5 | As an admin, POST with `"event":"opportunity_new"` | `400 event_not_relayable_from_browser` | ☐ |
| E.6 | As an admin, POST with `"event":"anything_else"` | `400 unknown_legacy_event` | ☐ |
| E.7 | As an admin, POST a valid event with `"to":"attacker@example.com"` | Answer is `dry_run_completed`; the created row's recipient is **not** that address, and its meta records `legacy_to_discarded` | ☐ |
| E.8 | Assign a staff member to a project (AdminStaff) | The confirmation reads «تم التكليف ✓ — وضع تجريبي — لن يتم إرسال رسالة حقيقية» — never "staff notified" | ☐ |

---

## F — Queue mechanics

| # | Action | Expected | Result |
|---|---|---|---|
| F.1 | Press **معالجة الطابور الآن** twice in a row | The second press claims nothing new; no row is processed twice | ☐ |
| F.2 | Trigger the same business action twice (e.g. re-assign the same staff member) | `duplicates_suppressed` increases; the outbox does **not** gain a second identical row | ☐ |
| F.3 | Open a failed row → **إعادة المحاولة يدويًا** | Row returns to `queued`, attempts reset, an audit entry is written | ☐ |
| F.4 | Open a queued row → **إلغاء قبل الإرسال** | Row becomes `cancelled` with the reason recorded | ☐ |
| F.5 | Try to cancel a row that is already `sent` | Refused with «فات وقت الإلغاء» | ☐ |
| F.6 | Try **إعادة المحاولة** on a row imported from the legacy queue | Refused with the legacy-mirror message — this is double-send protection | ☐ |
| F.7 | As a **view-only** staff user, open a row | No retry/cancel buttons, and the recipient address is masked | ☐ |
| F.8 | As that same view-only user, call `comms_retry` directly | `not_authorized` — the button was a courtesy, the RPC is the control | ☐ |

---

## G — Preferences and templates

| # | Action | Expected | Result |
|---|---|---|---|
| G.1 | Open the preference centre, switch a category off, reload | The setting persists | ☐ |
| G.2 | Confirm a **mandatory** category cannot be switched off | It is marked as mandatory and ignores the preference | ☐ |
| G.3 | Preview one event in `ar` and in `en` | Both render; no `{{token}}` is left unfilled | ☐ |
| G.4 | Publish a template edit | The version number increases; the old version is retained, not overwritten | ☐ |
| G.5 | Preview after publishing | The new version's text is what a send would use | ☐ |

---

## H — Sign-off

| Question | Answer |
|---|---|
| Did any email arrive during this checklist? | ☐ No (required) |
| Any FAIL above? | ☐ None |
| `live_sent` seen anywhere other than 0? | ☐ No (required) |
| Legacy `email_deliveries` counts unchanged? | ☐ Yes |
| Apps Script handler still undeployed? | ☐ Yes (expected at this stage) |

Owner signature / date: ________________________

**Accepting this checklist accepts an inert system.** Going live is
`docs/COMMUNICATIONS_GO_LIVE_GUIDE.md`, stage by stage, and stage 4 (deploying the Apps
Script handler) is the first step that can put a message in front of a human.
