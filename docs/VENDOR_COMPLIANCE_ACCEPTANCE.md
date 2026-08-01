# Vendor & Compliance Center — Manual Acceptance

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


Run on a **non-production** project first. Every test below is a behaviour the owner can see;
none requires reading SQL. `✅` = expected. `❌` = stop and report.

You need three accounts: **O** (owner), **M** (manage_documents only), **V** (verify_documents
only). Plus **S** (view_request_status only) and **P** (view_operational_documents only) for
tests 14–16.

---

## A. Feature detection — before the SQL is applied

| # | Step | Expected |
|---|---|---|
| 1 | Open `/client-portal/compliance` | ✅ Page renders with «الميزة بانتظار تفعيل قاعدة البيانات». ❌ Blank screen, crash, or fabricated rows |
| 2 | Open `/secure-document#anything` | ✅ "هذه الخدمة لم تُفعَّل بعد على الخادم". ❌ "الرابط غير صالح" (blames the sender for our gap) |

Now apply PREFLIGHT → RUNME → POSTCHECK.

| 3 | POSTCHECK | ✅ Every row `PASS` or `ℹ️ INFO` |

## B. Upload is not verification

| # | Step | Expected |
|---|---|---|
| 4 | As **M**, register `commercial_register` with a PDF | ✅ Status «مرفوعة (غير موثَّقة)» + the hint that it is not counted or shared. ❌ Anything reading "verified" |
| 5 | Check readiness | ✅ The commercial-register row says «غير موثَّق» with the reason. ❌ `met` |
| 6 | As **M**, try to verify that same document | ✅ No verify button; if forced, «من رفع الوثيقة لا يوثّقها» |
| 7 | As **V**, verify it with a note | ✅ Status «موثَّقة»; readiness count increases by one |
| 8 | As **V**, try to verify a document whose `expires_on` is in the past | ✅ Refused: «لا تُوثَّق وثيقة منتهية» |

## C. Sensitivity

| # | Step | Expected |
|---|---|---|
| 9 | As **M**, register `bank_letter` and try sensitivity «عامّة» | ✅ Refused — the type can never be public |
| 10 | As **V** (no `view_restricted`), open the document list | ✅ The bank letter is **absent**, and an amber line says restricted documents exist that you may not see. ❌ A short list with no explanation |
| 11 | As **O**, same list | ✅ Bank letter visible, masked number shown |
| 12 | As **V**, open a restricted file directly from storage | ✅ Refused by the storage policy |

## D. Registration workflow — no false submission

| # | Step | Expected |
|---|---|---|
| 13 | As **O**, create a request with required types and a deadline | ✅ Checklist auto-created; document rows marked «مشتقّ … لا يُعلَّم يدويًّا» |
| 14 | Try to tick a document checklist row | ✅ Not possible |
| 15 | Move `preparing_documents` → `submitted_manually` directly | ✅ Refused: transition not allowed |
| 16 | Move to `pending_owner_approval`, then as **M** try `ready_for_manual_submission` | ✅ Refused — owner only |
| 17 | As **O** approve, then `submitted_manually` **without** a reference | ✅ Refused. With a reference + channel ✅ recorded, and the note says the system submitted nothing electronically |
| 18 | As **S** open the centre | ✅ Only the status board: number, organisation, status, priority, deadline. ❌ Any portal reference, note, contact, attachment or document |

## E. Secure grants — the sharp edge

| # | Step | Expected |
|---|---|---|
| 19 | As grant issuer, create a grant and try to attach an **unverified** document | ✅ Refused: «لا تُشارَك وثيقة غير موثَّقة» |
| 20 | Attach the **bank letter** to a grant with no `request_id` | ✅ Refused: sensitive document needs a linked request **and** owner approval |
| 21 | Try to issue before approval | ✅ Refused |
| 22 | As the issuer (not owner) try to approve | ✅ Refused — approval is owner-only |
| 23 | As **O** approve, then issue | ✅ The token appears **once**, with a warning shown *before* the click |
| 24 | Reload the page | ✅ The token is gone and cannot be retrieved. `token_hint` (last 6 chars) only |
| 25 | Try to issue again | ✅ Refused: «صدر رمز لهذه المنحة سابقًا» |
| 26 | Look for a "send / email" button | ✅ **None exists.** State is «جاهز للمشاركة اليدوية» |
| 27 | Open `/secure-document#<token>` in a private window | ✅ Recipient, purpose, expiry, opens/downloads left, watermark identity, and only the attached documents |
| 28 | Check the browser address bar and any server log | ✅ The token is after `#` and never leaves the browser as part of a URL |
| 29 | Click «عرض» | ✅ Opens; the counter decreases. The response contains a signed URL only — **no storage path** |
| 30 | Wait > 2 minutes and reuse the signed URL | ✅ Expired |
| 31 | Change the `documentId` in the request to another real document | ✅ `not_in_grant`, and a `denied` row appears in the grant audit |
| 32 | Exceed `max_opens` | ✅ Blocked; grant becomes «استُنفد» |
| 33 | Revoke the **document** (as V), reload the link | ✅ It disappears from the list / is refused, without touching the grant |
| 34 | Revoke the **grant**, reload | ✅ «هذا الرابط غير صالح أو انتهت صلاحيته» |
| 35 | Try a random 40-character token | ✅ Exactly the same message as #34 — no way to tell the two apart |
| 36 | Open the grant audit | ✅ Opens, downloads **and denials** are listed |

## F. Readiness honesty

| # | Step | Expected |
|---|---|---|
| 37 | Deactivate all requirement rows, reload readiness | ✅ «لم تُعدّ قواعد الجاهزية بعد» — **not** 0 %, not "not ready" |
| 38 | Set one mandatory document to expire yesterday, run the scan | ✅ State `expired_blockers`; the row says «انتهت في …»; the document flips out of `verified` |
| 39 | Read the scan result | ✅ "أُدرجت N حدثًا … لا شيء يُرسَل" |
| 40 | Check any inbox | ✅ **No email, no WhatsApp, no SMS.** Hub channels remain `dry_run` |

## G. Nothing else broke

| # | Step | Expected |
|---|---|---|
| 41 | `node --test tests/` | ✅ All pass, including `tests/project_platform_freeze.test.js` |
| 42 | Open a talent/vendor profile document (if the TVN UI exists) | ✅ Unchanged behaviour; `tvn_doc_valid` still answers for profiles |
| 43 | `npm run typecheck` and `npm run build` | ✅ Exit 0 |

---

## Sign-off

| Item | Result | Notes |
|---|---|---|
| A. Feature detection (1–3) | ☐ | |
| B. Upload ≠ verification (4–8) | ☐ | |
| C. Sensitivity (9–12) | ☐ | |
| D. Registration (13–18) | ☐ | |
| E. Grants (19–36) | ☐ | |
| F. Readiness (37–40) | ☐ | |
| G. Regressions (41–43) | ☐ | |

**Known V1 limitation to accept explicitly:** the watermark is a displayed and audited
identity string, not pixels burned into the PDF. See
`docs/SECURE_DOCUMENT_GRANT_CONTRACT.md` §8.
