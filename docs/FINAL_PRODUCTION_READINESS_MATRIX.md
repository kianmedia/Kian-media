# FINAL PRODUCTION READINESS MATRIX

State of every module at the end of the program. **Code ships before SQL** throughout: an
un-applied module renders «الميزة بانتظار تفعيل قاعدة البيانات» with its RUNME filename, and
explicitly says the problem is not the user's permissions.

Legend — **Code**: in the working tree. **SQL**: the migration package exists (⚠️ *not run* —
nothing in this session executed SQL). **Tests**: automated coverage. **Live**: requires a
human with real accounts.

---

## 1. Modules

| # | Module | Code | SQL package | Tests | Live test still required |
|---|---|---|---|---|---|
| 1 | Communications hub | ✅ | ✅ 5 files (+ AFTER_FAILURE_VERIFY) | ✅ | preferences screen as a signed-in user, **after** the anon revoke |
| 2 | Production operations | ✅ | ✅ 4 | ✅ | double-booking attempt |
| 3 | CRM / sales | ✅ | ✅ 4 | ✅ | lead → handoff |
| 4 | Finance & profitability | ✅ | ✅ 4 | ✅ | owner vs non-owner vs collections |
| 5 | Commercial subscriptions | ✅ | ✅ 4 | ✅ | VAT + ledger immutability |
| 6 | Smart quoting | ✅ | ✅ 4 | ✅ | profit guard with a real quote |
| 7 | Lead scoring & routing | ✅ | ✅ 4 | ✅ | routing to a real owner |
| 8 | Custody / asset intelligence | ✅ | ✅ 4 | ✅ | QR + costing |
| 9 | Talent & vendor network | ✅ | ✅ 4 | ✅ | rate privacy as a non-owner |
| 10 | Vendor compliance | ✅ | ✅ 4 | ✅ | secure grant expiry |
| 11 | Case studies | ✅ | ✅ 4 | ✅ | confidentiality on a published study |
| 12 | Executive reporting *(LAST package)* | ✅ | ✅ 4 | ✅ | **3 accounts**: owner / non-owner staff / client |
| 13 | **Live operations** | ✅ | ✅ 4 | ✅ 83 | client link end-to-end + status transitions |
| 14 | **PWA V1** | ✅ | **none — none invented** | ✅ 77 | install + offline + logout on a real device |
| 15 | **Kian assistant** | ✅ | ✅ 4 | ✅ 137 | retrieval as owner vs sales vs client |

---

## 2. Apply order

The executive package composes the others, so it must stay **last**. Live ops and the
assistant are **optional** dependencies of it: absent, their KPIs read *unavailable* with the
RUNME filename; they never read as zero, and they never block the package from running.

```
1  communications_hub          PREFLIGHT → RUNME → POSTCHECK
2  operations_center
3  crm_sales_FOUNDATION
4  lead_scoring_routing
5  smart_quoting
6  commercial_subscriptions
7  finance_profitability
8  asset_intelligence
9  talent_vendor_network
10 vendor_compliance_center
11 case_studies_platform
12 live_operations_dashboard        ← optional for #15
13 kian_ai_assistant                ← optional for #15
14 (PWA — no SQL)
15 executive_reporting          ★ LAST ★
```

Every RUNME is transactional and idempotent, uses no `CONCURRENTLY`, and carries a static
self-test. Every POSTCHECK is read-only and returns a **single result set**.

---

## 3. Blocking items before production

| Priority | Item | Owner action |
|---|---|---|
| **P0** | No SQL has been applied | run each package PREFLIGHT → RUNME → POSTCHECK in the order above, reading the NOTICEs |
| **P0** | `communications_hub` PREFLIGHT §8 | read the `AUTHENTICATED DEPENDENCY` notice **before** running the RUNME. `held ONLY VIA PUBLIC` naming any table is the interesting case; the RUNME handles it, but you should see it |
| **P0** | Nothing is committed or pushed | review the diff, then commit and push yourself |
| **P1** | Live 3-account test for executive reporting | `docs/EXECUTIVE_REPORTING_ACCEPTANCE.md` |
| **P1** | Live-ops client-link test | `docs/LIVE_OPS_GO_LIVE.md` — issue, open, revoke, re-open; confirm the revoked link is indistinguishable from an unknown one |
| **P1** | PWA on a real device | install, go offline, confirm read-only + honest failure, sign out, confirm caches are gone |
| **P2** | Assistant knowledge base is empty | it will answer «لا توجد لدي معلومة معتمدة كافية للإجابة» until sources are added and approved. That is correct behaviour, not a fault |
| **P2** | AI provider not configured | intentional for V1. `lib/server/aiProvider.ts` is an interface with no `fetch` |

---

## 4. Deliberate non-features (do not report as bugs)

* **The assistant does not call a model.** No provider, no key, no `fetch`. Every response
  says so.
* **Live-ops telemetry is not connected.** All technical states are human entries;
  `telemetry_connected` is `false` in every payload and an uptime figure cannot be labelled
  `telemetry_verified` without a real verified reading.
* **PWA push is foundation only.** No `push` listener exists. See `docs/PWA_PUSH_CONTRACT.md`.
* **Offline is read-only.** No write queue, no background replay — an offline write fails
  immediately and honestly.
* **A revoked live-ops link looks exactly like an unknown one.** That is the design; a
  distinguishable response would make the link an oracle.
* **The project platform is frozen.** No new feature touches it.

---

## 5. Verification state at the end of this pass

| Gate | Result |
|---|---|
| Freeze guard | **3/3** — frozen-path diff empty |
| `npx tsc --noEmit` | see the run log in the session summary |
| `npm test` | full suite |
| `npx eslint .` | full tree |
| `npm run build` | production build |
| Secret scan | no JWT / `sk-` / `AKIA` / PEM key in `app lib components docs public tests` |
| Client-data leak scan | no forbidden live-ops or assistant column reaches the executive engine or any client payload |
| Non-vacuity | 5 mutations → 5 failures → 5 exact restores |

**No SQL was executed. Nothing was committed, pushed or deployed.**
