# KIAN PLATFORM — MASTER EXECUTION BRIEF v2.0 (SUPERSEDES v1 ENTIRELY)

> **How to use:** Replace `MASTER_BRIEF.md` at repo root with this file.
> First message to Claude Code:
> «اقرأ MASTER_BRIEF.md (v2) بالكامل والتزم به حرفياً. نفّذ مرحلة DELTA-AUDIT فقط، ثم توقف عند GATE A وانتظر اعتمادي.»
>
> **Language protocol:** Reports/questions to خالد → Arabic. Code/comments/commits → English. User-facing UI → Arabic-first RTL (+ English where Wave 1 adds it).
> **Mission of v2:** Bring the public site AND the client portal to international grade, then prepare and build native iOS/Android apps — after which the platform enters a stabilization era (bugfixes over features).

---

## 1. CONTEXT & VERIFIED PRODUCTION STATE (external audit, 2026-08-02)

Stack: Next.js 14 App Router + Supabase + Vercel (Hobby) + n8n. Portal S1–S5 complete and working — treat as fragile cargo, additive changes only.

Verified LIVE on production:
- ✅ ~10 unique portfolio descriptions (corporate section: العطيشان، ريفايفا، معادن ×2، الموارد البشرية، دايسر عنوان فقط، ريفي، زد، بوفيه عمر…) — KEEP, do not rewrite.
- ✅ Second phone number (+966543553038); implied-consent sentence on main contact form; rich /quote-request form incl. «كيف تعرفت علينا» attribution.
- ❌ Counters render `0+` in initial HTML (hero + بالأرقام). ❌ Empty testimonials section publicly visible. ❌ All routes share one title/canonical (https://kianmedia.com). ❌ No consent checkbox on any form. ❌ Category filter counts sum 54 vs 46 actual. ❌ ~36 descriptions still templated; 3 items titled «إعلان قصير». ❌ Main form → WhatsApp only (no persistence). ❌ OG image = square logo.png. ❌ Footer email info@ (contact@ absent).

**Repo may be AHEAD of production** (v1 G3 push freeze). Never assume; reconcile in DELTA-AUDIT. Never rebuild what exists in the repo — finish, fix, or deploy it.

## 2. NON-NEGOTIABLE GUARDRAILS (carried from v1 + additions)

- **G1 Branches:** feature branches only `feat/wave-<n>-<slug>`; never touch `main` directly.
- **G2 Database:** NEVER execute SQL against any DB. Schema changes = migration files in `supabase/migrations/` with `-- ROLLBACK:` section. STOP for manual application by خالد; resume after confirmation; regenerate types.
- **G3 Push freeze:** local commits allowed; **no push** until خالد confirms Vercel Preview env vars point to a separate non-production Supabase project. After confirmation: pushes to feature branches allowed; merge/deploy always require explicit «أعتمد».
- **G4 RLS:** every new table ships with RLS enabled + deny-by-default policies in the same migration.
- **G5 Secrets:** no service-role key anywhere; no secrets client-side; never print secret values in reports.
- **G6 Flags:** every user-visible change behind env-driven flag in `lib/flags.ts`, default OFF; site/portal must be 100% unchanged with flags off.
- **G7 Forbidden scope:** no AI features; no WhatsApp sending/automation; no Zoho API calls; no online payments; no Nafath; no frame-accurate review player until the Stream-vs-Mux decision (Backlog).
- **G8 Scheduling:** no Vercel cron; time-based jobs = n8n webhooks (`/api/hooks/*` with shared-secret header) or GitHub Actions `workflow_dispatch`.
- **G9 Reality wins:** if repo differs from brief, adapt minimally, log deviation; significant conflict → STOP and ask.
- **G10 UI:** Arabic-first RTL; designed Arabic empty states on every list view.
- **G11 Design discipline (new):** POLISH, don't redesign. Cinematic brand language: slow confident motion (300–500ms ease), restrained palette, Almarai. No layout rewrites of existing sections without explicit approval; changes expressed as tokens/refinements.
- **G12 Dependency budget (new):** every new package justified in the wave report (size, maintenance, alternative considered).

## 3. PROCESS & GATES

**Phase DELTA-AUDIT (read-only):**
1. `docs/REPO_AUDIT.md` — routes, portal modules, flags, forms, notification service entry points, unmerged feature branches and their contents.
2. `docs/SCHEMA_SNAPSHOT.md` — tables/columns/RLS from migrations + types (no DB connection).
3. **`docs/STATUS_MATRIX.md` — the truth table خالد asked for:** every item of v1 AND v2 with state ∈ {LIVE on prod / DONE in repo (unpushed) / PARTIAL / MISSING} + evidence (file/commit). Items already DONE are struck from execution.
4. `docs/EXECUTION_PLAN.md` — v2 waves mapped to reality; list exactly what DELTA removes as duplicate.
5. **⛔ GATE A** — await «أعتمد Wave 0». Ask the Gate-A questions (§7).

**Every wave:** implement → `docs/wave-reports/WAVE_<n>_REPORT.md` (§8) → local commit → **⛔ STOP** for «أعتمد».
**Definition of Done:** migrations (if any) + RLS + types + flag + Arabic empty states + `npm run build` passes + manual test steps. Site waves additionally: Lighthouse mobile ≥ 90 perf / 95 SEO / 95 a11y / 95 BP on changed pages, axe clean, before/after metrics in report.

## 4. WAVES

### WAVE 0 — SAFETY & HARDENING (verify-then-complete; nothing else first)
- 0.1 **Consent checkbox** (required, links `/privacy-policy`) on ALL forms: main contact + `/quote-request` `/book-meeting` `/upload-files` `/quick-access`. Label: «أوافق على سياسة الخصوصية وعلى تواصل كيان معي بخصوص طلبي». Persist consent+timestamp with each submission. (The current implied-consent sentence is NOT sufficient.)
- 0.2 **Secrets audit** → `docs/SECRETS_AUDIT.md` (locations/risk only; includes git history).
- 0.3 **Environment separation** → `docs/ENVIRONMENTS.md` + split `.env.example` + `scripts/seed-preview.ts`; precise dashboard runbook for خالد (second Supabase project for Preview).
- 0.4 **Backups** → `.github/workflows/db-backup.yml` (nightly pg_dump, `workflow_dispatch` until secrets set) + `docs/RESTORE_RUNBOOK.md` (target RTO ≤ 60 min).
- 0.5 **Observability** → `@sentry/nextjs` active only with `SENTRY_DSN`; `docs/OBSERVABILITY.md` incl. free uptime monitor.
- 0.6 **Public-surface security (new):** basic rate limiting middleware on form/API POST routes; security headers (HSTS, X-Frame-Options, Referrer-Policy, CSP report-only first).
- 0.7 **Email deliverability (new):** `docs/EMAIL_DNS.md` — SPF/DKIM/DMARC records for kianmedia.com so portal notifications land in inboxes.
- ⛔ GATE.

### WAVE 1 — WEBSITE: INTERNATIONAL-GRADE FOUNDATION
- 1.1 **i18n backbone first:** next-intl (or equivalent) with `/en` locale routing, hreflang, locale-aware metadata; full English parity for every public page; EN copy drafted at brand quality, marked «بانتظار مراجعة خالد». RTL/LTR correctness.
- 1.2 **Counters:** `content/stats.ts` single source; final numbers rendered server-side (animation starts from rendered value). Use 4000+ productions / 2000+ clients / 13 regions; years = ASK.
- 1.3 **Per-route metadata + canonicals (AR/EN)** for every route; **dynamic branded OG images 1200×630** via `@vercel/og` (retire square logo OG).
- 1.4 **Portfolio content:** move 46 works to `content/portfolio.ts`; write the remaining ~36 unique 1-line Arabic descriptions (preserve the live 10); rename the three «إعلان قصير» (clients = ASK); derive category counts from data (kills 54/46 forever).
- 1.5 **Testimonials:** section behind `SHOW_TESTIMONIALS` flag until ≥3 approved entries exist (reads the Wave-4 table; static file interim).
- 1.6 **Lead persistence:** main form POSTs to `LEADS_WEBHOOK_URL` (existing Apps Script pipeline) BEFORE opening WhatsApp (non-blocking on failure, Sentry-logged); unify source/UTM capture across all four route forms (quote-request pattern is the reference).
- 1.7 **Structured data:** JSON-LD `LocalBusiness` + `VideoObject` per work + `BreadcrumbList`, AR/EN.
- 1.8 **sitemap.xml + robots** + branded 404/500 pages.
- 1.9 **Performance pass:** hero.mp4 → poster + compressed rendition(s), lazy below-fold; `next/image` for all thumbnails with hqdefault fallback (maxres 404s); Almarai subset + `font-display: swap`. Targets: LCP < 2.5s mobile, CLS < 0.1, INP < 200ms.
- 1.10 **Accessibility AA:** contrast, focus states, alt text from titles, keyboard nav, `prefers-reduced-motion`.
- 1.11 **SEO landing system (on top of i18n):** template + 6 service pages (drone, live-streaming, real-estate, corporate-films, documentary, podcast) + 3 city pages (Riyadh, Jeddah, Dammam), AR+EN, behind `SHOW_SEO_PAGES`, out of sitemap until on.
- ⛔ GATE.

### WAVE 2 — WEBSITE: FLAGSHIP CREDIBILITY
- 2.1 **Case-study system:** `content/case-studies/` + template page (التحدي/المعالجة/الحرفة/النتيجة + stills + video + services chips); seed 6 flagships (معادن اليوم المفتوح ٢٠٢٥، وثائقيات القطيف/الدروازة، مهرجان أفلام السعودية، بث مباشر كبير، عرس فاخر، +1 = ASK, respecting «no execution details pre-agreement» rule); portfolio cards link «اقرأ القصة».
- 2.2 **Client logos strip:** use the 22 processed PNG logos (grayscale→color hover) to augment the text wall; only logos with usage OK (ASK if unsure).
- 2.3 **Trust page `/trust`:** security posture (RLS, encrypted-at-rest, backups, audit log), PDPL commitment, CR 1009179096, VAT 311047382900003, HSE statement — the procurement-questionnaire page, AR/EN.
- 2.4 **Proof upgrades:** press/awards/festival-coverage slots on «لماذا كيان».
- 2.5 **Contact unification:** resolve info@/sales@/contact@ (ASK decision), consistent NAP sitewide.
- ⛔ GATE.

### WAVE 3 — PORTAL: OPERATIONS CORE
- 3.1 **Call sheets:** `call_sheets` (project_id, shoot_date, location_id, status, weather_snapshot jsonb, golden_hour jsonb, backup_date, notes) + `call_sheet_crew` + `call_sheet_equipment` (link existing equipment tables per G9). Golden hour via `suncalc`; weather via Open-Meteo (keyless) server-side ≤48h pre-shoot; wind warning banner for drone days; printable Arabic view.
- 3.2 **Permits & documents:** `permits` (type GACA/municipal/other, authority, ref_no, dates, project_id?, file, status) + `crew_documents` (doc_type, expiry, file). 30/7-day expiry alerts via existing notification service (in-app + email ONLY). Private storage bucket, signed URLs, RLS.
- 3.3 **Crew DB:** `crew_members` (roles[], day_rate, contacts, city, internal_rating, active) + `crew_assignments` (dates, role, agreed_rate) with **overlap conflict detection** (blocking UI warning).
- 3.4 **Locations library:** `locations` (city, map_link, contact, parking/power/sound notes, permit_required) + `location_media`; selectable from call sheets.
- 3.5 **Project templates:** `project_templates` + `template_tasks`; seeds: فيلم مؤسسي، عرس، **بودكاست ٢٥ حلقة** (episode tracker — ready for سواليف أسرية).
- 3.6 **ICS feeds:** `calendar_tokens` → `/api/calendar/[token].ics` (shoot days, revocable long tokens).
- ⛔ GATE. Report must recommend starting the real pilot (مسبار ١٠) on Waves 0–3 before approving Wave 4.

### WAVE 4 — PORTAL: BUSINESS & PIPELINE
- 4.1 **Tender pipeline:** `tenders` (entity, title, deadline, submitted_value, cost_estimate, status draft/submitted/won/lost/no-bid, outcome_reason, project_id?) + `rate_card_items` (internal-only visibility) + dashboard (win-rate, value won, avg margin).
- 4.2 **Review-on-close loop:** `testimonials` (project_id, client_name, entity, rating, text_ar, status pending/approved/rejected, source). Trigger: project closed AND final milestone paid → tokenized review form by email. Admin moderation UI. **Approved entries auto-feed the Wave-1.5 site section** — one pipeline, no duplication.
- 4.3 **Weekly client digest:** per active project, activity-log summary email «هذا ما تم في مشروعك هذا الأسبوع»; n8n-scheduled (G8); per-client opt-out.
- 4.4 **Client health:** `client_health` view (last_project_date, days_silent) + `follow_ups` queue; rule-based (>180 days silent → suggested follow-up). Nothing auto-sends.
- 4.5 **Seasonality dashboard:** shoot-days per month × sector across years.
- ⛔ GATE.

### WAVE 5 — PORTAL: DELIVERY, RIGHTS & MONEY
- 5.1 **Deliverable versioning:** `deliverable_versions` (version_no, file/link, changelog_ar) + current pointer (adapt to existing tables per G9).
- 5.2 **Rights flag** on deliverables: `showreel_allowed`/`confidential`, set at approval; marketing filter view.
- 5.3 **Branded delivery pages:** `delivery_links` (token, expires_at, downloads_count, revoked) → public Kian-branded page, signed URLs, expiry, counter, archive-policy note («الاسترجاع بعد فترة الأرشفة خدمة مدفوعة»).
- 5.4 **Deemed-approval timer:** send → clock starts; day-7 reminder; day-10 `deemed_approved` + immutable audit entry citing contract clause. Flag `DEEMED_APPROVAL` OFF; per-project activation (Bena first — ASK).
- 5.5 **Money light:** `project_costs` (freelancer/rental/logistics/other) → per-project margin card; `payment_milestones` (if absent) → cash-flow calendar (in/out per month); **late-payment counter** + one-click formal Arabic notice **DRAFT** (reciprocal-suspension clause) — sending stays human.
- 5.6 **RBAC refinement:** `client_viewer` vs `client_approver` enforced in RLS (approvals + deemed-approval limited to approvers).
- ⛔ GATE.

### WAVE 6 — PORTAL: ASSETS, ARCHIVE, COMPLIANCE & KNOWLEDGE
- 6.1 **Equipment extensions** (extend existing custody module): printable QR per item → `/e/[id]` status page; `equipment_usage_log` (auto from call sheets) → utilization report; `maintenance_schedule` + alerts; asset-register fields (purchase_date, purchase_value, serial, insured).
- 6.2 **Archive registry:** `archive_media` (label, HDD/SSD/NAS/LTO, capacity, health, physical_location) + `archive_project_links` — «وين خام معادن ٢٠٢٤؟» in 10 seconds.
- 6.3 **Music licenses:** `music_licenses` (Envato/other, license_ref, track, project_id, file) + one-click printable per-project rights summary.
- 6.4 **HSE log:** `hse_incidents` (type injury/equipment-damage/near-miss, severity, actions, file) — clean exportable record for أرامكو/الهيئة الملكية tenders.
- 6.5 **Model releases:** `model_releases` (person, project, scope_ar, signed_at, method, file) — PDPL-minimal, private bucket, strict RLS.
- 6.6 **SOP library:** `sops` + `sop_items`; seeds: ما قبل إقلاع الدرون، ما قبل البث (إنترنت احتياطي/encoder)، تجهيز استوديو البودكاست; attachable to call sheets as required checklists.
- 6.7 **Post-mortems:** `project_postmortems` (went_well/went_wrong/change_next) — 3 fields at close.
- 6.8 **Case-study generator (template-based, NO AI):** closed + `showreel_allowed` project → pre-filled draft into `portfolio_drafts` queue → approved entries export to `content/portfolio.ts` AND Wave-2.1 case-study format. (v1's two generators merged into this one system.)
- ⛔ GATE.

### WAVE 7 — PORTAL: WORLD-CLASS UX & ENTERPRISE POLISH (new)
- 7.1 **Global search (Cmd+K):** projects/clients/deliverables/equipment via Postgres FTS (no external service).
- 7.2 **Notifications center UI:** bell + read states on the existing unified service.
- 7.3 **Audit-log viewer** (admin): filter by user/entity/date.
- 7.4 **Executive dashboard (خالد):** pipeline value, this-week shoots, crew/equipment utilization, 90-day cash flow, overdue payments — consumes Waves 4–6 data, adds no new sources.
- 7.5 **CSV export** per module.
- 7.6 **MFA (TOTP)** for internal roles via Supabase Auth.
- 7.7 **Demo tenant:** seeded fake client «شركة الأفق» + sample project for sales demos; flag `DEMO_MODE`.
- 7.8 **Playwright E2E smoke suite** (login, project view, deliverable approve, call-sheet create) + CI run on PRs (build/test only, no deploy).
- 7.9 **States audit:** empty/loading/error states across every portal route.
- ⛔ **STABILIZATION GATE:** recommend a 2-week bugfix-only freeze + pilot feedback digest before mobile work.

### WAVE 8 — MOBILE READINESS (web repo)
- 8.1 **PWA:** manifest, icons, installable portal shell (interim "app" while stores process).
- 8.2 **Mobile API surface:** `docs/MOBILE_API.md` documenting every table/RPC the app needs; add missing RPCs via gated migrations.
- 8.3 **Push infra:** `push_tokens` table + server route sending via Expo Push API as a new channel of the existing notification service (channels: in-app, email, push — still NO WhatsApp/SMS).
- 8.4 **Auth deep links:** `kian://` scheme flows (login, reset) compatible with Supabase Auth.
- ⛔ GATE.

### WAVE 9 — NATIVE APP (NEW repo `kian-app`; same guardrail spirit, no DB changes from this repo)
- 9.1 **Scaffold:** Expo (latest SDK) + expo-router + TypeScript + Supabase JS; Arabic-first RTL with ar/en i18n; brand theme (Almarai, cinematic dark) from day one.
- 9.2 **Dual-role experience (the Apple-4.2 answer — native utility, not a webview):**
  - **Client:** projects & progress, deliverables + approve (deemed-approval aware), delivery links, quotes/invoices view, notifications.
  - **Crew/Internal:** today's call sheet, shoot calendar, **equipment QR scanner** (expo-camera) for custody check-in/out, permit-expiry alerts.
- 9.3 **Push notifications** wired to Wave-8 infra; deep links into screens.
- 9.4 **EAS:** dev/preview/prod build profiles; icons/splash; env per profile.
- 9.5 **Store readiness:** `docs/STORE_SUBMISSION.md` — Apple Developer Program (company enrollment, D-U-N-S), privacy nutrition labels, App Review notes, Play Console listing, AR/EN screenshots plan.
- 9.6 **Explicit v1-app non-goals:** no payments, no chat, no AI.
- ⛔ FINAL GATE: store-submission checklist review with خالد → stabilization era begins.

## 5. REMOVED / MERGED vs v1 (dedup ledger)
- **Removed as DONE (verified live):** the ~10 corporate portfolio descriptions; second phone number. DELTA-AUDIT strikes anything else found done in repo.
- **Merged:** testimonials section + review-loop → one pipeline (1.5 + 4.2). Case-study/portfolio generators → one system (6.8) feeding two outputs (2.1 + portfolio.ts). SEO landing pages rebuilt ON i18n (1.11) instead of before it. P&L/cash-flow (5.5) feeds the exec dashboard (7.4) — no separate reports module.
- **Still deferred (Backlog):** frame-accurate review player (blocked on Stream vs Mux — decision requested at Gate A because the client app will want it), Nafath, Zoho API, online payments, WhatsApp automation, AI features, blog/insights.

## 6. STABILIZATION ERA (post-Wave-9 policy)
After final gate: features freeze by default. Only bugfixes, content updates via `content/*`, and security patches. Any new feature requires a new signed brief from خالد. This is how «الموقع النهائي والتطبيق النهائي» stays final.

## 7. OPEN INPUTS FROM خالد (ask at the right gate; never block unrelated work)
- **Gate A:** Has the Preview Supabase project been created (unlocks G3 pushes)? Stream vs Mux decision? Approve starting **Apple Developer enrollment NOW** (D-U-N-S + company verification takes weeks — parallel to Waves 0–7)? Vercel Pro upgrade recommendation (analytics/WAF/image-optimization headroom for a commercial international site) — yes/no?
- **Wave 1:** years-of-experience number; clients of the three «إعلان قصير»; `LEADS_WEBHOOK_URL`.
- **Wave 2:** 6th flagship case study; logo-usage confirmations; email unification decision (info@/sales@/contact@).
- **Wave 5:** activate deemed-approval on Bena/مسبار ١٠?
- **Wave 0:** `SENTRY_DSN`, backup destination secrets.

## 8. WAVE REPORT TEMPLATE (`docs/wave-reports/WAVE_<n>_REPORT.md`, Arabic)
1. ملخص ما تم (٣–٥ أسطر) • 2. **Migrations بانتظار التطبيق اليدوي** (الملفات + أمر التطبيق + خطة التراجع) • 3. الأعلام المضافة وحالتها • 4. خطوات الاختبار اليدوي • 5. قياسات الأداء قبل/بعد (لموجات الموقع) • 6. انحرافات G9 وأسبابها • 7. أسئلة تحتاج قرار خالد • 8. المقترح التالي.

---
*When in doubt: smaller diff, additive change, ask خالد. نبني منصة عالمية بانضباط كواليس سينمائي.* 🎬
