# Build Brief — Kian Equipment Custody & Rental Module
### بريف بناء — نظام عهدة وتأجير المعدات لكيان

---

## كيف تستخدم هذا الملف (لـ خالد)

1. افتح **Claude Code** داخل مجلد مشروع بوابة كيان (الريبو).
2. الصق هذا الملف كاملاً، واطلب: **"ابدأ بالمرحلة 0 فقط — استكشاف وخطة، بدون أي تعديل."**
3. راجع الخطة ووافق → ينتقل للمرحلة 1 (الـ SQL) ويتوقف عشان توافق **قبل** تطبيق أي migration.
4. بعد موافقتك يبني المراحل 2–6 على فرع مستقل بدون commit/push.
5. المرحلة 7 تقسية (Hardening) ويتوقف قبل أي نشر — أنت تختبر وتنشر بموافقتك.

> ملف البروتوتايب `kian-custody-prototype.jsx` هو **المرجع لتجربة المستخدم والتدفق والشكل** — يلتزم البناء به.

---

## 1. Project summary

Add a single module to the existing Kian client portal that manages **equipment check-out / check-in with photo evidence and admin oversight**, serving two audiences over one shared engine:

- **Internal custody** — employees take equipment out for field shoots, photograph it, return it, and an admin closes the record.
- **External rental** — clients register, sign a binding rental contract, receive equipment after admin approval, return it, and an admin closes the record.

The two flows share one data engine: one records table, one evidence/photo system, one notification layer, one append-only audit trail. Do **not** build them as two disconnected features.

This is an **additive** module on isolated new routes. The existing production site and existing routes must remain untouched.

---

## 2. Hard guardrails (NON-NEGOTIABLE)

These override any other instruction. If a step requires breaking one, **stop and ask Khaled.**

1. Work only on a new feature branch: `feat/equipment-custody-rental`.
2. **No `git commit`, `git push`, or deploy without Khaled's explicit approval.**
3. **No schema migration or production DB change without Khaled's explicit approval.** Present the full SQL and wait.
4. **No Supabase service-role key** anywhere in app/runtime code. Cross-user writes use `SECURITY DEFINER` RPCs with internal guards.
5. **RLS enabled on every new table**, with explicit policies. No table ships without RLS.
6. Do **not** modify existing routes, pages, or components. The only allowed touch to existing code is adding one navigation entry/link — and that must be confirmed first.
7. WhatsApp is **staged**: the notification system is built channel-ready, but WhatsApp stays behind a disabled flag until Meta Business verification is complete. Portal + email work now.
8. No new third-party services beyond what the repo already uses, unless approved.

---

## 3. Tech stack & integration

Target stack (confirm against the repo in Phase 0): **Next.js 14 (App Router) · Supabase (Postgres + Auth + Storage) · Vercel · n8n** for outbound automation.

Integrate with the portal's **existing** auth, profile/role mechanism, routing layout, and design system (Tailwind / component library). Match existing conventions rather than introducing new ones. The prototype's dark cinematic look (stone + red, viewfinder corner brackets on photo frames) is the intended visual language — reconcile it with the portal's existing design tokens in Phase 0.

---

## 4. Roles & auth

Three roles: `employee`, `renter`, `admin`.

- **Employee** and **admin** are existing portal users. Reuse the portal's current role system. If none exists, propose adding `app_role` to the existing profile table (employee | renter | admin) — under the migration approval gate.
- **Renter** is **self-registered**: a public sign-up creates a Supabase Auth user, a `renter_profiles` row, and assigns the `renter` role. Self-registration only opens the rental tab; it grants **no** ability to approve or close — those are admin-only at the two control points (handover approval, closure).
- Employee name & phone are **pulled from the user's existing profile** (never typed). Renter identity is pulled from `renter_profiles`.
- "Admin" in the notification matrix = **all users with the admin role**.

---

## 5. Data model (propose as migration in Phase 1)

### Enums
- `record_kind`: `custody` | `rental`
- `record_status`: `out` | `review_handover` | `rented` | `review_return` | `closed` | `rejected` | `flagged`
- `party_role`: `employee` | `renter`
- `ack_type`: `custody` | `rental_contract`
- `notif_channel`: `portal` | `email` | `whatsapp`

### Tables

**`renter_profiles`** — renter KYC (mandatory before delivery)
- `user_id uuid primary key references auth.users(id) on delete cascade`
- `full_name text not null`
- `id_number text not null`
- `phone text not null`
- `email text not null`
- `address text not null`
- `created_at timestamptz not null default now()`

**`custody_records`** — one row per custody/rental
- `id uuid primary key default gen_random_uuid()`
- `record_no text unique not null` — generated (e.g. `KM-0001`)
- `kind record_kind not null`
- `party_user_id uuid not null references auth.users(id)`
- `party_name text not null` — snapshot at creation
- `party_role party_role not null`
- `status record_status not null`
- `shortage boolean not null default false`
- `shortage_note text`
- `admin_note text`
- `overall_before_path text`
- `overall_after_path text`
- `ack_signed boolean not null default false`
- `ack_signature text`
- `ack_signed_at timestamptz`
- `ack_type ack_type`
- `ack_ip text` — captured at signing, for evidence
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()` (trigger to maintain)

**`custody_items`** — one row per piece (per-item photos)
- `id uuid primary key default gen_random_uuid()`
- `record_id uuid not null references custody_records(id) on delete cascade`
- `name text not null`
- `qty integer not null default 1 check (qty > 0)`
- `photo_before_path text`
- `photo_after_path text`
- `position integer not null default 0`

**`custody_events`** — append-only audit trail
- `id uuid primary key default gen_random_uuid()`
- `record_id uuid not null references custody_records(id) on delete cascade`
- `actor_user_id uuid references auth.users(id)`
- `body text not null`
- `created_at timestamptz not null default now()`

**`notifications`** — in-portal feed (mirror of what's also emailed/WhatsApp'd)
- `id uuid primary key default gen_random_uuid()`
- `audience_user_id uuid not null references auth.users(id)`
- `record_id uuid references custody_records(id) on delete cascade`
- `body text not null`
- `urgent boolean not null default false`
- `channels notif_channel[] not null default '{portal,email,whatsapp}'`
- `read_at timestamptz`
- `created_at timestamptz not null default now()`

### RLS policy intent (implement explicitly, verify with negative tests)
- `custody_records`: SELECT if `party_user_id = auth.uid()` OR caller is admin. INSERT if `party_user_id = auth.uid()` and the `kind`/initial `status` are valid for the caller's role. State transitions go through guarded RPCs (below) — do **not** allow free UPDATE.
- `custody_items`, `custody_events`: visible iff parent record is visible; writes via the same guarded actions.
- `notifications`: SELECT if `audience_user_id = auth.uid()`. No direct client INSERT.
- `renter_profiles`: SELECT/UPSERT if `user_id = auth.uid()`; admin may SELECT all.

### Guarded RPCs (`SECURITY DEFINER`, internal role checks) — no service-role key
- `submit_checkout(...)` — employee creates a custody record (status `out`) + items + overall before path; writes event; notifies admins + self.
- `submit_rental_request(...)` — renter creates rental record (status `review_handover`) + items + contract signature fields; writes event; notifies admins + self.
- `submit_return(record_id, after_paths, overall_after, shortage, note)` — party (owner) attaches after-evidence, sets status `review_return`; writes event; notifies admins (urgent if shortage) + party.
- `admin_approve_handover(record_id)` — admin only → status `rented`; event; notify renter.
- `admin_close(record_id)` — admin only → status `closed`, or `flagged` if `shortage`; event; notify party.
- `admin_reject(record_id, note)` — admin only → status `rejected`; event; notify party.
- `admin_add_note(record_id, note)` — admin only; event; notify party.
- `notify(audience_user_id, record_id, body, urgent)` — internal helper used by the above; inserts notification + (Phase 6) posts to the n8n webhook.

Each admin RPC must assert the caller's admin role and raise on failure.

---

## 6. Storage

- Private bucket: `custody-evidence` (not public).
- Path convention:
  - per item before: `{record_id}/before/item-{item_id}.jpg`
  - per item after: `{record_id}/after/item-{item_id}.jpg`
  - overall before: `{record_id}/before/overall.jpg`
  - overall after: `{record_id}/after/overall.jpg`
- Storage RLS: a party may upload/read only within their own record's folder; admin may read all.
- Display via **signed URLs** only. Never expose public object URLs.
- Enforce upload **content-type = image/\*** and a **max file size** (e.g. 10 MB) client- and server-side.

---

## 7. Routes & pages (additive, isolated)

Create new routes under the portal (final paths confirmed in Phase 0; suggested):
- `/(portal)/equipment/custody` — employee: "my custody" list + checkout form + return panel.
- `/(portal)/equipment/rentals` — renter: registration gate → rental tab (request + "my rentals" + return).
- `/(portal)/equipment/admin` — admin: queue (urgent first) + all records + approve/close/reject/note. Admin-gated.

Components mirror the prototype 1:1 in behavior:
- Per-item photo capture (mobile camera) + overall photo, at **both** checkout/handover and return.
- Click-to-sign block (checkbox = signature) rendering the bilingual contract/acknowledgment text below.
- Record card = the "report": shows party info, status, per-item **before/after** thumbnails, overall **before/after**, signature line, admin note, and the full event timeline — all on **one page**, which is exactly the admin view.

---

## 8. Notifications (channel-ready; WhatsApp staged)

A single server function `emitNotification(event)`:
1. Inserts in-portal notification rows via the `notify` RPC (one per recipient).
2. POSTs the event payload to the n8n webhook at env `N8N_NOTIFY_WEBHOOK_URL`.

n8n fans out: **email now**; the **WhatsApp** node stays disabled while env `WHATSAPP_ENABLED=false`. Records still carry `channels = {portal,email,whatsapp}` so WhatsApp lights up the moment Meta verification clears and the flag flips — no code change.

### Event matrix (who gets notified)
| Event | Admins | The party (employee/renter) |
|---|---|---|
| Custody checkout (employee receives) | ✅ | ✅ |
| Rental request submitted | ✅ | ✅ (confirmation) |
| Admin approves handover (renter receives) | — | ✅ |
| Return submitted | ✅ (urgent if shortage) | ✅ |
| Admin closes | — | ✅ |
| Admin rejects / adds note | — | ✅ |

Urgent (shortage/damage at return) must be visibly distinct in-portal and flagged in the email/WhatsApp payload.

---

## 9. Legal text (bilingual — embed verbatim)

> The system produces strong documentary evidence (signed acknowledgment + timestamp + IP + per-item/overall photos + audit log). This is **not legal advice**; have a Saudi lawyer review the final contract wording for enforceability before going live.

### A. Custody acknowledgment (`ack_type = custody`)
| # | العربية | English |
|---|---|---|
| 1 | أستلم المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات. | I receive the listed equipment in sound and complete condition, as documented by the attached per-item and overall photos. |
| 2 | أتحمل المسؤولية الكاملة عن العهدة من لحظة الاستلام حتى إعادتها واعتماد الإقفال من الإدارة. | I bear full responsibility for the custody from the moment of receipt until its return and management's approval of closure. |
| 3 | أي فقد أو تلف أو نقص يقع تحت مسؤوليتي، وألتزم بمعالجته وفق سياسة المؤسسة. | Any loss, damage, or shortage falls under my responsibility, and I commit to remedying it per company policy. |

**Acceptance line —** AR: «أقر باستلام العهدة وأتعهد بالمسؤولية الكاملة عنها حتى إقفالها من الإدارة. (التأشير هنا بمثابة توقيع)» · EN: "I acknowledge receipt of the custody and undertake full responsibility for it until closed by management. (Checking here constitutes a signature.)"

### B. Equipment rental contract (`ack_type = rental_contract`)
| # | العربية | English |
|---|---|---|
| 1 | يقر المستأجر باستلام المعدات الموضحة بحالة سليمة وكاملة وفق الصور المرفقة لكل قطعة وإجمالي المعدات. | The Lessee acknowledges receipt of the listed equipment in sound and complete condition, as documented by the attached per-item and overall photos. |
| 2 | يتحمل المستأجر المسؤولية القانونية والمالية الكاملة عن المعدات من لحظة الاستلام حتى إعادتها واعتماد الإقفال من إدارة كيان. | The Lessee bears full legal and financial responsibility for the equipment from receipt until its return and Kian management's approval of closure. |
| 3 | في حال أي فقد أو تلف أو سرقة أو نقص، يلتزم المستأجر بقيمة الإصلاح أو الاستبدال بالقيمة السوقية الكاملة دون اعتراض. | In the event of any loss, damage, theft, or shortage, the Lessee shall pay the full cost of repair or replacement at full market value without objection. |
| 4 | تبقى جميع المعدات ملكاً خالصاً لمؤسسة كيان، ولا يحق للمستأجر تأجيرها من الباطن أو نقل حيازتها للغير. | All equipment remains the sole property of Kian; the Lessee may not sublease it or transfer possession to any third party. |
| 5 | يلتزم المستأجر بإعادة المعدات في الموعد المتفق عليه، ويخضع أي تأخير لرسوم إضافية عن كل يوم. | The Lessee shall return the equipment by the agreed date; any delay is subject to additional daily fees. |
| 6 | يحق لكيان المطالبة بقيمة التأمين واتخاذ الإجراءات النظامية اللازمة عند الإخلال بأي بند من هذا العقد. | Kian reserves the right to claim the security deposit and pursue all lawful measures upon breach of any clause herein. |
| 7 | يُعد تأشير المستأجر بالموافقة الإلكترونية أدناه توقيعاً ملزماً وإقراراً بقراءة العقد كاملاً وفهم شروطه. | The Lessee's electronic acceptance below constitutes a binding signature and acknowledgment of having fully read and understood this contract. |

**Acceptance line —** AR: «أقر بأني قرأت عقد الإيجار كاملاً، وأوافق على جميع شروطه، وأتعهد بالمسؤولية القانونية والمالية الكاملة عن المعدات. (التأشير هنا بمثابة توقيع ملزم)» · EN: "I confirm I have read this rental contract in full, agree to all its terms, and undertake full legal and financial responsibility for the equipment. (Checking here constitutes a binding signature.)"

---

## 10. Build phases (each with its stop/approval gate)

**Phase 0 — Discovery & plan (المرحلة 0: استكشاف).** Read the repo. Report: auth setup, profile/role mechanism, routing layout, design tokens/UI library, existing email + n8n wiring, and the record-number generation approach. Produce an integration map + a final ordered task list. **Modify nothing. STOP — Khaled approves.**

**Phase 1 — Schema migration (المرحلة 1: قاعدة البيانات).** Write the full migration: enums, tables, RLS policies, guarded RPCs, storage bucket + storage policies, `updated_at` trigger, `record_no` generation. Present the complete SQL. **STOP — Khaled reviews and approves BEFORE applying. Apply only after approval.**

**Phase 2 — Data layer.** Typed Supabase queries / server actions wrapping the RPCs; signed-URL helpers for evidence.

**Phase 3 — Employee custody UI.** Checkout (per-item + overall capture & upload, click-to-sign acknowledgment), "my custody" list, return panel.

**Phase 4 — Renter registration + rental UI.** Public renter sign-up → `renter_profiles` + role; rental tab; rental request (photos + bilingual contract click-to-sign); "my rentals" + return.

**Phase 5 — Admin console.** Queue (urgent first), before/after on one page, approve / close / reject / note — admin-only enforced at RPC + UI.

**Phase 6 — Notifications wiring.** `emitNotification` → portal rows + n8n webhook; WhatsApp behind `WHATSAPP_ENABLED=false`; full event matrix.

**Phase 7 — Pre-Deploy Hardening (المرحلة 7: تقسية).** RLS audit with negative tests (each role tries forbidden reads/writes and is denied); confirm no service-role key; signed URLs only; zod validation on all inputs; upload content-type + size limits; rate limiting on RPCs; error/empty states; keyboard focus + reduced-motion; mobile pass. Produce a hardening report. **STOP — Khaled approves before any deploy.**

Throughout all phases: feature branch only; **no commit / push / deploy without explicit approval**; do not touch existing routes/components (one nav link excepted, after confirmation).

---

## 11. Acceptance criteria / QA checklist

- Employee can check out (name/phone auto-pulled), capture per-item + overall before photos, sign, submit; record appears as `out`.
- Employee can return with per-item + overall after photos and a shortage path; record moves to `review_return`; shortage raises an urgent admin notification.
- Renter must complete registration (name, ID, phone, email, address) before the rental tab opens.
- Renter request requires per-item + overall photos and a signed rental contract; record is `review_handover`.
- Admin (only) can approve handover, close, reject, add notes. Non-admins are denied at the RPC level (verified by negative test).
- Admin sees before/after (per item + overall) for any record on a single page, plus the full audit timeline and signer/timestamp.
- Notifications reach both admins and the party at receipt and at return, via portal + email; WhatsApp payload is produced but suppressed by the flag.
- All evidence is private (signed URLs); RLS denies cross-user access; no service-role key in the codebase.
- Existing site/routes unchanged; everything new lives on the isolated routes.

---

## 12. Out of scope (deferred by decision)

Equipment inventory/catalog (records reference free-text items for now), Nafath identity/signature integration, Zoho Books billing & rental pricing, automated security-deposit tracking, and hand-drawn signatures. Build so these can be layered in later without rework — especially: today's free-text items map cleanly to a future inventory table, and the click-to-sign block can later be swapped for Nafath.
