# PROTECTED_ARCHITECTURE — الأنظمة الممنوع تجاوزها

> **الحالة:** مُنتَج ضمن مهمة `MASTER_ORDER_FINAL.md` (READ-ONLY audit).
> **الفرع:** `docs/v2_1-audit` · **HEAD:** `7b92391` (2026-08-02)
> **المصدر:** قراءة الكود و`docs/*.sql` فقط — **لا اتصال بـProduction، لا SQL، لا تعديل.**

---

## كيف يُقرأ هذا الملف

كل نظام أدناه **مُتحقَّق من وجوده في المستودع** (عمود «الدليل»). التحقق يخص **الكود
لا Production** — لأن حالة التطبيق مُصنَّفة في
[`DATABASE_APPLICATION_STATUS.md`](DATABASE_APPLICATION_STATUS.md).

**قوة الحماية** ثلاث درجات:

| الرمز | المعنى |
|---|---|
| 🔒 **PROTECTED** | مُتحقَّق في الكود. تجاوزه = مخالفة. أي مقترح يمسّه يحتاج اعتماد خالد المنفصل. |
| ⚠️ **PROTECTED — WITH KNOWN DUPLICATION** | النظام محمي، **لكن يوجد ازدواج قائم أصلًا** يجب أن تعالجه v2.1 لا أن تزيده. |
| ❓ **CANDIDATE — NEEDS PRODUCTION PROOF** | مُتحقَّق في الكود لكن دوره كـ«مصدر حقيقة» يحتاج إثباتًا حيًا قبل تثبيت الحماية. |

> **القاعدة الحاكمة (G13):** قبل أي جدول/RPC/خدمة/دور جديد — ابحث عن النظام القائم،
> وثّق جداوله، وإن غطّى ≥60% **وجب توسيعه**. الحقول شديدة التخصص → **Extension Table**
> مرتبط بالسجل القائم. **يُمنع مصدر بيانات موازٍ لنفس الحقيقة، ويُمنع محرك ثانٍ لحساب
> الحالة أو التقدم أو المالية أو الصلاحيات.** أي جدول جديد يجب أن يحمل فقرة «لماذا لا
> يمكن توسيع الموجود».

---

## P-1 🔒 Project Operational Snapshot — المصدر الوحيد للتقدم والحالة

| | |
|---|---|
| **الكائن** | `public.project_operational_snapshot(p_project uuid)` |
| **الدليل** | `docs/project_operational_snapshot_RUNME.sql:32` |
| **المستهلك** | `lib/portal/projects.ts:35` → `prpc<OperationalSnapshot>(...)` |
| **الالتزام في الواجهة** | `app/client-portal/projects/[id]/page.tsx:149` يحمل تعليقًا صريحًا: *«all from `project_operational_snapshot` — no card can contradict the progress»* |
| **يغطّي** | Overall progress · Current phase · Lifecycle · Shooting status |
| **أنظمة داعمة** | `project_progress_RUNME.sql` · `project_core_progress_engine_FIX_RUNME.sql` · `project_stage_sync_RUNME.sql` |

**ممنوع:**
- ❌ أي منطق مستقل لحساب نسبة التقدم في TypeScript أو في RPC ثانية.
- ❌ أي لوحة/تقرير/تطبيق جوال يحسب التقدم بنفسه بدل استهلاك هذا المصدر.
- ❌ قراءة `projects.status` مباشرة كبديل — راجع `project_core` أولًا.

**مسموح:** إضافة **حقول** إلى مخرَج اللقطة، وبناء عارضين جدد **فوقها**.

---

## P-2 🔒 دورة حياة المشروع + آلة الحالة + بوابات الانتقال

| | |
|---|---|
| **الكائنات** | `project_core` · `project_status_history` · `project_transition_requests` (+ `_archive`) · `project_lifecycle_hold_cancel` · `project_phase3_closure` · `project_phase4_final_closure` |
| **الكود** | `lib/project-core/lifecycle.ts` · `lib/portal/transitions.ts` |
| **الاختبارات** | `tests/project_lifecycle_e2e.test.js` · `tests/transition_approval.test.js` · `tests/project_transition_requests_ui.test.js` |
| **الملفات** | `project_core_FINAL_RUNME.sql` · `project_transition_approval_RUNME.sql` (847 سطر) |

**ممنوع:** آلة حالة ثانية · تحديث `core_stage` من خارج بوابات الانتقال · تخطّي بوابة موافقة.

**قاعدة موثّقة يجب الحفاظ عليها:** الإغلاق يبقى في `project_closure_requests`
و`core_stage` يظل `delivered` حتى `final_close` — عندها فقط يقلبه `set_stage` إلى `closed`.

---

## P-3 ⚠️ Deliverable Workflow — محمي، **مع ازدواج قائم**

| | |
|---|---|
| **الجداول** | `deliverables` · `deliverable_versions` · `deliverable_reviews` · `deliverable_assets` · `deliverable_downloads` · `deliverable_receipts` · `deliverable_final_opens` · `deliverable_internal` · `deliverable_content_types` · `client_comments` · `project_delivery_release` |
| **الدوال (عيّنة)** | `admin_add_deliverable_version` · `deliverable_version_summary` · `client_open_final_preview` · `client_confirm_final_receipt` · `client_download_deliverable` · `can_final_deliver` · `can_finalize_deliverable` · `deliverables_stage_guard` · `admin_set_release_policy` · `pc_release_window_ok` |
| **الملفات** | `deliverable_versions_RUNME.sql` · `deliverable_comments_resolution_RUNME.sql` · `deliverable_final_master_RUNME.sql` · `deliverable_final_receipt_RUNME.sql` · `deliverable_delivery_audit_RUNME.sql` · `deliverable_versions_autocreate_RUNME.sql` · `project_delivery_release_policy_RUNME.sql` · `project_delivery_payment_gate_RUNME.sql` |

### ⚠️ الازدواج القائم (D-4)
جدولان لإصدارات المخرجات:
- `public.deliverable_versions` — `docs/deliverable_versions_RUNME.sql:45`
- `public.project_deliverable_versions` — `docs/project_core_FINAL_RUNME.sql:287`

ولهما كاتبان مختلفان للنسخة النهائية، وهناك مُشغِّل ينشئ V1 تلقائيًا
(`deliverable_versions_autocreate_RUNME.sql`).

**ممنوع:** ❌ إنشاء `deliverable_versions` **من جديد** · ❌ Workflow اعتماد موازٍ ·
❌ فقدان أي إصدار أو تعليق أو اعتماد سابق · ❌ **إضافة جدول إصدارات ثالث**.

**مطلوب من v2.1:** بند صريح لحسم الازدواج D-4 (أيهما المصدر؟ وكيف يُوحَّد بلا فقد بيانات؟)
— **قبل** أي توسعة في §A (Branded Delivery Pages، `showreel_allowed`/`confidential`،
عدّاد التحميلات، الانتهاء/الإلغاء). كل هذه **امتدادات** لا أنظمة.

---

## P-4 ⚠️ خدمة الإشعارات — محمية، **بمسارين قائمين**

### المسار 1 — الأصلي/الموحّد
`notifications` · `notification_preferences` · `notification_events` ·
`notification_delivery_log` · `notification_cron_runs` · `email_deliveries` ·
`integration_outbox` · **`notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid)`**
(المحرّك المركزي، `docs/global_notifications_core_batch10_RUNME.sql:42`، محجوب عن
`public/anon/authenticated` بـ`revoke`).

### المسار 2 — Communications Hub
`comms_outbox` · `comms_channels` · `comms_templates` · `comms_preferences` ·
`comms_event_catalog` · `comms_rate_counters` · `comms_audit`
+ `lib/server/commsLegacyAdapter.ts` (محوّل توافق) + `lib/server/commsKillSwitch.ts`.

### المرسِلات وقنوات الدخول
`/api/integrations/{project,custody,rental,hr,whatsapp,custody-inventory}/notify` ·
`/api/integrations/notify/drain` · `/api/comms/{process,legacy-notify}` ·
`/api/cron/notify-email`.

**ممنوع:** ❌ خدمة إشعارات ثالثة · ❌ Weekly Digest أو Permit/Maintenance alerts أو Push
كأنظمة مستقلة — كلها **أحداث في نفس الـOutbox** · ❌ Push كنظام؛ Push = **قناة جديدة**
· ❌ تعطيل أي مسار قائم بلا اعتماد مستقل.

**مطلوب من v2.1:** بند «توحيد المسارين» + **Idempotency** ضد الإرسال المزدوج + حالة
Retry وسجل فشل واضح.

### 🔒 حماية خاصة — إصلاح anonymous email relay
ثغرة موثّقة: `nt_enqueue_email` كانت `security definer` ممنوحة لـ`authenticated` تأخذ
المستلِم والموضوع والنص من المتصل ⇒ **أي مسجَّل يرسل بريدًا من هوية كيان الابتكار**.
أُغلقت 2026-07-27. **الاختبارات الحارسة:** `tests/comms_anon_zero_access.test.js` ·
`tests/email_backbone_phase1.test.js` · `tests/relay_handler_batch11.test.js`.
❌ **ممنوع منعًا باتًا إعادة فتح مسار إرسال عام غير محمي.**

---

## P-5 🔒 منع الحجز المزدوج — الحماية في القاعدة لا في الواجهة

| | |
|---|---|
| **العقد** | `raise exception … using errcode = '23P01', hint = '<scope>:<code>'` |
| **النطاقات** | `person:` (`operations_center_RUNME.sql:1078`, `:1153`) · `equipment:` (`:1113`) · `location:` (`:1143`) |
| **حارس ثانٍ بنفس العقد** | `civ_guard_reservation` / `civ_double_booking` — `asset_intelligence_RUNME.sql:759`, `:788` |
| **الحارس على الجدول لا داخل RPC** | `asset_intelligence_RUNME.sql:1978` — لا التفاف عبر مسار كتابة آخر |
| **فحص ذاتي** | `:1984` — الحزمة تفشل إن لم يرفع الحارس `23P01` |
| **تحقّق من نصف التطبيق** | `asset_intelligence_PREFLIGHT.sql:209` يرفض التشغيل إن كان `prodops` نصف مطبَّق |
| **ترجمة الواجهة** | `lib/portal/pgerror.ts` → `kind:"conflict"`, `verdict:"conflict"` |
| **الاختبارات** | `tests/asset_lifecycle_guards.test.js` · `tests/talent_assignment_rules.test.js` |

**الرسالة العربية المعتمدة (لا تُستبدل بـ«حاول مرة أخرى»):**
> «تعارض: السجلّ محجوز أو مرتبط بفترة متقاطعة. هذه ليست ترحيلة ناقصة ولا عطلًا — غيّر
> الفترة أو حرّر الحجز القائم، فإعادة المحاولة دون تغيير سترفَض مجددًا.»

**ممنوع:** ❌ محرك Conflict Detection جديد · ❌ الاكتفاء بتحذير UI حيث تمنع القاعدة ·
❌ استخدام `23505` بدل `23P01` (مستثنى عمدًا من المصنّف).
**مسموح:** توسعة النطاق لما لا تغطيه الثلاثة الحالية — **بنفس العقد ونفس شكل الـhint**.

---

## P-6 🔒 مصنّف أخطاء PostgreSQL — `lib/portal/pgerror.ts`

عشر نتائج لا تُخلط أبدًا. الملف يوثّق داخله **دورة تصحيح إنتاج ضائعة** سببها خلط
`42703` بـ«الترحيلة غير مطبّقة».

**قواعد لا تُخالف:**
- `42501` يُصنَّف **قبل** أي فرع مخطط — الرفض الأمني لا يُروى كقصة عمود ناقص.
- `42703` = **طلبنا نحن خاطئ**، لا ترحيلة ناقصة.
- «الترحيل معلّق» يُعرض **فقط** لـ`missing_function` أو `missing_table`.
- 0 صفوف **ليست خطأ**.
- `pgIsMigrationPending` و`pgIsConflict` **لا يصحّان معًا أبدًا** — واختبار يثبّت ذلك.
- التسجيل مُنقَّح: `pgRedact` يزيل JWT/مفاتيح/بريد/UUID/أرقام، و**الـURL كاملًا** لأنه
  يحمل قيم الفلاتر أي بيانات حقيقية.

**ممنوع:** ❌ مصنّف أخطاء ثانٍ · ❌ تجاوزه برسائل خام · ❌ تسجيل URL أو بيانات شخصية.

---

## P-7 ⚠️ CRM — مصدر الحقيقة التجاري، **مع ازدواج كيان العميل**

| | |
|---|---|
| **الجداول** | `crm_*` (22): `crm_companies` · `crm_contacts` · `crm_leads` · `crm_opportunities` · `crm_pipelines` · `crm_stages` · `crm_stage_history` · `crm_activities` · `crm_targets` · `crm_teams` · `crm_team_members` · `crm_commission_{plans,assignments,records}` · `crm_approval_requests` · `crm_audit` · `crm_import_batches` · `crm_lead_score_rules` · `crm_competitors` · `crm_settings` |
| **التسجيل والتوجيه** | `lsr_*` (12): `lsr_lead_profile` · `lsr_rules`/`_rulesets`/`_factors` · `lsr_routing_rules` · `lsr_territories` · `lsr_agents` · `lsr_assignments` · `lsr_review_queue` · `lsr_score_manual` · `lsr_audit` · `lsr_event_log` |
| **العقود** | `docs/CRM_PROJECT_HANDOFF_CONTRACT.md` · `docs/LEAD_ROUTING_CONTRACT.md` · `docs/LEAD_SCORING_RULES.md` |

### ⚠️ الازدواج القائم (D-9)
ثلاثة تمثيلات لكيان العميل: `companies` · `crm_companies` · `clients` (`lib/clients.ts`).

**ممنوع:** ❌ CRM موازٍ · ❌ **Tender Pipeline منفصل** — المناقصة = `crm_opportunities`
بنوع/مرحلة أو Extension Table مرتبطة · ❌ تكرار بيانات الجهة داخل جدول `tenders` ·
❌ `client_health` كجدول مستقل — يُشتق من CRM والمشاريع · ❌ `follow_ups` جديدة —
تُستخدم `crm_activities` ونظام المهام القائم.

---

## P-8 🔒 المالية — مصدر الحقيقة + حماية استنتاج الأرباح

| | |
|---|---|
| **الجداول** | `fin_*` (24): `fin_budgets` · `fin_budget_lines` · `fin_costs` · `fin_cost_centers` · `fin_revenue` · `fin_receivables` · `fin_collections` · **`fin_payment_milestones`** · `fin_contracts` · `fin_retainers` · `fin_expense_{requests,approvals,categories}` · `fin_purchase_{requests,request_items,orders,order_items}` · `fin_suppliers` · `fin_approval_thresholds` · `fin_attachments` · `fin_audit` · `fin_zoho_outbox` |
| **نواة المشروع المالية** | `project_costs` · `project_expenses` · `project_phase_budgets` · `project_revenue_schedule` · `project_financial_alerts` · `project_finance_settings` · `pc_project_financials()` |
| **البوابة** | `can_see_financials()` · `pc_can_read_project(uuid)` |
| **الاختبارات** | `tests/commercial_operations_financial_isolation.test.js` · `tests/quoting_profit_guard.test.js` · `tests/crm_commission_isolation.test.js` · `tests/talent_rates_privacy.test.js` · `tests/commercial_ledger_immutability.test.js` |

### ⚠️ الازدواج القائم (D-5)
`project_costs` **و** `fin_costs` **و** `project_expenses` تمثّل تكاليف.

**ممنوع:** ❌ إنشاء `project_costs` أو `payment_milestones` — **كلاهما موجود بالفعل** ·
❌ محرك مالي ثانٍ · ❌ إعادة حساب الأرقام في Executive Dashboard بدل استهلاكها ·
❌ إضعاف حماية استنتاج الأرباح.

**الفصل الإلزامي بين ستة مفاهيم** (لا تُخلط في جدول واحد):
Operational budget · Actual costs · Payment milestones · Official invoices ·
Zoho payment status · Forecast cash flow.

**⚠️ Phase B غير مؤكدة** — راجع `DATABASE_APPLICATION_STATUS.md` §8 قبل أي بند مالي.

---

## P-9 🔒 حدّ Zoho Books — الفواتير الرسمية

| | |
|---|---|
| **الكود** | `lib/server/zoho.ts` · `zohoBooks.ts` · `zohoBooksEstimates.ts` · `zohoBooksInvoices.ts` · `zohoBooksSync.ts` · `zohoUpsert.ts` · `zohoDescription.ts` |
| **المسارات** | `/api/integrations/zoho/{webhook,sync-invoices,invoice-from-estimate,estimate-{admin,pdf,respond},accept-with-billing}` |
| **الجداول** | `zoho_books_settings` · `zoho_entity_mappings` · `zoho_account_mappings` · `zoho_sync_jobs` · `zoho_webhook_events` · `fin_zoho_outbox` · `custody_zoho_sync_{log,outbox}` |
| **الجدولة** | `/api/cron/zoho-sync` — يوميًا 03:20 (`vercel.json`) |
| **العقد** | `docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md` |
| **الأعلام** | `ZOHO_BOOKS_ESTIMATES_ENABLED` · `ZOHO_BOOKS_ESTIMATE_DRAFT_ONLY` · `ZOHO_BOOKS_SYNC_MODE` |

### 🔒 **G7 (النص المعتمد — يُقتبس حرفيًا في أي خطة)**
> **“Do not add, replace, disable or alter the existing Zoho integration. Preserve existing
> code paths and flags. Any Zoho expansion requires a separate approved brief.”**

**ممنوع:** ❌ نظام فواتير رسمي داخلي ينافس Zoho · ❌ تعديل أي مسار أو علم قائم ·
❌ توسعة Zoho ضمن v2.1 بلا Brief منفصل معتمد.

---

## P-10 🔒 نموذج الموظف / المهنة / التكليف / الصلاحية — أربع طبقات لا تُخلط

| الطبقة | الكائنات |
|---|---|
| **Auth Role** | `auth.users` + Supabase Auth + `mfa_settings` |
| **System Permission** | `profiles.account_type` · `staff_role()` · `permissions` (**124 صلاحية ذرّية**) · `employee_permission_overrides` · `emp_has_permission` / `emp_can` |
| **Profession** | `professions` · `employee_professions` · `profession_permissions` · `custody_profession_bridge_RUNME.sql` |
| **Project Assignment** | `project_members` · `project_member_roles` · `project_task_assignees` · `hr_field_task_assignees` · `assignment_notes` |
| **Production Role** | داخل `ops_job_crew` / `tvn_assignments` |

**الملفات:** `employee_professions_RUNME.sql` · `permission_catalog_RUNME.sql` (548 سطر) ·
`permission_enforcement_RUNME.sql` · `professions_grants_and_hardening_RUNME.sql` ·
`staff_roles_task_assignment_RUNME.sql`
**العقد:** `docs/PROJECT_ROLE_PERMISSION_MATRIX.md` · `docs/ROLE_MODEL_DECISION_REPORT.md`

**ممنوع:** ❌ `crew_members` موازٍ للموظفين · ❌ `roles[]` كمصفوفة داخل سجل الطاقم — جدول
ربط · ❌ خلط الطبقات الأربع · ❌ تكرار بيانات الموظف/جواله/مدينته في مصدر ثانٍ ·
❌ **`crew_assignments` جديد** — التكليفات قائمة.

**المستقلون الخارجيون:** ⚠️ **`tvn_profiles` وعائلة Talent & Vendor Network (14 جدولًا)
هي بالفعل نظام المستقلين الخارجيين.** أي مقترح `crew_contractors` **يجب أن يبدأ بإثبات
لماذا لا يكفي `tvn_*`** — والافتراض الابتدائي أنه يكفي.
**الأجر المتفق عليه** يعيش في `tvn_profile_rates` / `tvn_assignments` (يختلف بين المشاريع)
— محمي بـ`tests/talent_rates_privacy.test.js`.

---

## P-11 ⚠️ نموذج العهدة والأصول — محمي، **بعائلتين قائمتين**

| العائلة | الجداول |
|---|---|
| **الجديدة (المعتمدة)** | `custody_inventory_*` (≈25): `assets` · `categories` · `locations` · `assignments` + `assignment_items` · `movements` · `reservations` · `maintenance` + `maintenance_plans` · `kits` + `kit_items` + `kit_versions` + `kit_movements` · `audits` + `audit_items` · `evidence` · `asset_files` · `asset_components` · `asset_changes` · `meter_readings` · `settings` |
| **القديمة** | `custody_items` · `custody_records` · `custody_photos` · `custody_events` · `custody_signatures` · `custody_liabilities` + `custody_liability_events` |
| **المؤسسية** | `custody_qr_events` · `custody_incidents` + `_actions` · `custody_gps_{points,sessions}` · `custody_offline_operations` · `custody_purchase_*` (5) · `custody_condition_reports` · `custody_external_trackers` · `custody_vendors` · `custody_alert_deliveries` |
| **التأجير** | `custody_rental_*` (9) · `renter_profiles` · `insurance_claims*` · `asset_insurance_policies` · `policy_assets` |

**العقود:** `docs/QR_SECURITY_CONTRACT.md` · `docs/ASSET_COSTING_CONTRACT.md` ·
`docs/CUSTODY_AND_MAINTENANCE_WORKFLOW.md` · `docs/ASSET_CUSTODY_CURRENT_STATE_AUDIT.md`

**ممنوع:** ❌ Equipment System جديد · ❌ تكرار سجل الصرف/الاسترجاع ·
❌ **`equipment_usage_log` كجدول مُدخَل يدويًا** — الاستخدام **يُشتق** من Call Sheets
والتكليفات والعهد (دفتر الاستخدام الملحق بثلاثة مُشغِّلات موجود في
`asset_intelligence_RUNME.sql`) · ❌ عرض بيانات العهدة/الأسعار/الموظفين للعامة ·
❌ فقد أي صورة أو سجل قديم · ❌ جداول `maintenance` أو `asset history` جديدة — موجودة.

**QR:** موجود (`custody_qr_events`, `lib/qr/{qr,code128}.ts`) بحمولة فقيرة ومعدَّلة ومُدقَّقة.
أي «QR يفتح صفحة عامة» **يجب أن يخضع لـ`QR_SECURITY_CONTRACT.md`** ويراعي صلاحية المشاهد.

---

## P-12 ⚠️ سجل التدقيق — **الحماية مشروطة بقرار خالد**

| النوع | الكائنات |
|---|---|
| **المركزي** | `activity_log` + `log_activity(uuid,text,text,text,uuid,jsonb)` — `docs/activity_log_role_hardening_RUNME.sql:29` (محجوب عن `public`/`anon`، ممنوح لـ`authenticated`) |
| **الموزّع (14 جدولًا)** | `crm_audit` · `fin_audit` · `cs_audit` · `sq_audit` · `csub_audit` · `tvn_audit` + `tvn_event_log` · `lsr_audit` + `lsr_event_log` · `liveops_audit` · `ops_audit` · `ai_audit` · `comms_audit` · `mgmt_audit` · `custody_inventory_audits` |

⚠️ **الوضع الراهن يخالف مبدأ «لا سجل ثانٍ» — لكن المخالفة قائمة قبل v2 ولم تُنشئها.**

**ممنوع:** ❌ **سجل تدقيق رقم 16** · ❌ Audit Log Viewer يكتب سجله الخاص.
**مطلوب:** ❗ **سؤال Gate A:** أي سجل هو مرجع العارض — `activity_log` وحده، أم عارض
موحّد يقرأ الخمسة عشر بلا كتابة؟ (توصيتي: **الثاني** — عارض قراءة فقط، بلا جدول جديد.)

---

## P-13 🔒 المشاريع الأب–الابن (Parent–Child) والبرامج

| | |
|---|---|
| **الآلية** | `projects.parent_project_id` (مرجع ذاتي) + `projects.project_scope` |
| **الملفات** | `project_hierarchy_schema_RUNME.sql` · `_security_RUNME.sql` · `_batch6a_RUNME.sql` · `_batch6b_RUNME.sql` |
| **العلم** | `project_hierarchy_enabled` / `hierarchy_enabled` |
| **البرامج فوقها** | `project_programs_batch8a` (master=program, subproject=unit — **لا مستوى ثالث**) · `batch8b` · `project_program_sla_batch8d` |
| **الخدمة** | `lib/portal/projectHierarchy.ts` · `lib/portal/programs.ts` |

**ممنوع:** ❌ كسر المرجع الذاتي · ❌ **جدول حلقات مستقل** — قالب بودكاست ٢٥ حلقة =
مشاريع فرعية/مراحل بالبنية الحالية · ❌ مستوى هرمي ثالث · ❌ تكرار Timeline/Gantt/
Shooting status في جداول جديدة.

**⚠️ تحذير موثَّق:** `batch6a` **يستثني عمدًا** أعمدة من `batch6b` الأولي
(`progress_mode` / `operational_stage` / `closure_status`) لتعارضها مع 3C/5C، و**لا يطوي**
إعادة تعريف `can_access_project` (≈50 سياسة RLS + تصعيد كامن عند `client` فارغ).
❌ **ممنوع طي إعادة التعريف تلك ضمن أي حزمة v2.1 بلا مراجعة أمنية مستقلة.**

---

## P-14 🔒 Pre-production Center — ⚠️ **مع ازدواج Call Sheet ثنائي**

| | |
|---|---|
| **المركز** | `preproduction_items` · `preproduction_comments` — `docs/preproduction_center_RUNME.sql:37,70` + `preproduction_completion_RUNME.sql` |
| **الخدمة** | `lib/portal/preproduction.ts` (بإنفاذ صلاحية لكل إجراء) |
| **التشغيل الميداني** | `ops_jobs` + أبناؤه: `ops_job_{crew,equipment,permits,travel,vehicles,weather,hse,accommodation}` · `ops_daily_reports` · `ops_incidents` · `ops_delays` · `ops_media_{cards,backups}` · `ops_post_handoff` |
| **جلسات التصوير** | `project_shoot_sessions` |

### ⚠️ الازدواجات القائمة
| | المصادر |
|---|---|
| **D-1 Call Sheet** | `ops_call_sheets` (`operations_center_RUNME.sql:546`) **و** `project_call_sheets` (`project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql:22`) |
| **D-2 دوال Call Sheet** | `prodops_call_sheet` / `prodops_call_sheet_publish` **مقابل** `project_core_call_sheet_save` / `_send` / `_send_to` |
| **D-3 المواقع** | `ops_locations` · `project_locations` · `custody_inventory_locations` |
| التصاريح | `ops_job_permits` موجود **كابن لوظيفة** — لا سجل تصاريح عام |

**ممنوع:** ❌ مركز ما قبل إنتاج جديد · ❌ **Call Sheet ثالث** · ❌ Shooting Schedule ثانٍ
· ❌ **موقع رابع** · ❌ تكرار بيانات الطاقم داخل Call Sheet إن كانت في التكليفات.

**مطلوب من v2.1:** حسم D-1/D-2/D-3 **قبل** أي بند Call Sheets أو Locations. تفاصيل
golden hour / الطقس / تنبيه رياح الدرون / التاريخ البديل تبقى **مواصفات توسعة**
على `ops_job_weather` القائم لا نظامًا جديدًا.

---

## P-15 🔒 المسار العام وحفظ الـLeads

| | |
|---|---|
| **الجداول** | `public_intake` · `public_rate_limits` · `quote_requests` · `quote_items` · `quote_revision_requests` |
| **المسار** | `POST /api/public/intake` → `rpcAsService` → RPC التقاط → `public_intake` |
| **الحماية** | `rl_consume` + `lib/server/rateLimit.ts`: 12/ساعة/IP · 6/ساعة/بريد · جسم ≤100KB · سقوف طول · **200 دائمًا** (النموذج العام لا يعرض خطأ تقنيًا) |
| **الربط اللاحق** | `link_my_records_by_email` |

### 🔒 ثغرة مُصلَحة — ممنوع التراجع
`jwtSub()` كانت تفكّ حمولة الـJWT بـbase64 **بلا تحقق من التوقيع**، وتُمرَّر كـ`p_user`
إلى `public_intake.user_id` بينما سياسة القراءة `user_id = auth.uid() OR …` ⇒ **متصل
مجهول يزوّر `{"sub":"<uuid-الضحية>"}` ويحقن صفًا في بوابة أي ضحية.**
الآن: `authGetUserId()` يتحقق من التوكن مقابل GoTrue.
❌ **ممنوع إعادة أي فكّ JWT محلي بلا تحقق توقيع في أي مسار.**

### ⚠️ فجوتان مفتوحتان
1. `components/Contact.tsx` **لا يحفظ شيئًا** — `window.open(wa.me/…)` فقط (`:30`).
2. الترتيب معكوس في النماذج الثلاثة الأخرى: `submitToSheets` (Apps Script) يُستدعى
   **قبل** `captureIntake` (Supabase).

**القاعدة الملزمة لـv2.1:** Apps Script **ليس** قاعدة بيانات الـLeads. Supabase أولًا
دائمًا؛ الـWebhook بعد نجاح الحفظ؛ وفشل Apps Script أو واتساب **لا يُفقد الطلب**.
واستخدم `quote_requests` القائم بدل جدول Leads مكرر حيثما يغطّي الحالة.

---

## P-16 🔒 محرك التقارير واللوحة التنفيذية

| | |
|---|---|
| **الكائنات** | `executive_kpi_catalog` · `executive_kpi_snapshots` · `executive_alert_rules` · `mgmt_report_cache` · `mgmt_audit` · `exec_*` / `executive_*` دوال |
| **الملفات** | `executive_reporting_RUNME.sql` (1,674) · `project_governance_batch5b_RUNME.sql` |
| **الخدمة** | `lib/portal/executive.ts` · `execReport.ts` |
| **CSV** | `lib/portal/csv.ts` — **أداة موحّدة قائمة** |
| **العقد** | `docs/EXECUTIVE_REPORTING_CONTRACT.md` · `docs/EXECUTIVE_REPORTING_ROLE_MATRIX.md` |

**ممنوع:** ❌ Reports Engine جديد · ❌ إعادة حساب المصادر · ❌ أداة CSV ثانية ·
❌ تسريب الهوامش والأرباح.
**محمي في كل تصدير:** ترميز عربي سليم · توقيت الرياض · إخفاء الأعمدة حسب الدور.
**مطلوب:** Inventory لكل التقارير القائمة قبل أي تقرير جديد. Seasonality من
`project_shoot_sessions` · Cash flow من `fin_*` · Equipment utilization من العهد وCall Sheets.

---

## P-17 🔒 Testimonials / Case Studies / Portfolio — Pipeline واحدة

| | |
|---|---|
| **Case Studies** | `cs_*` (13 جدول) + `case_studies_platform_RUNME.sql` (3,054) + `/case-studies` + `lib/server/publicCaseStudies.ts` — **مبني بالكامل** مع دورة تحرير واعتماد وسرّية |
| **العقود** | `docs/CASE_STUDY_CONFIDENTIALITY_CONTRACT.md` · `docs/CASE_STUDIES_EDITORIAL_WORKFLOW.md` · `docs/PUBLIC_MEDIA_SECURITY_CONTRACT.md` |
| **Testimonials** | **غير مدموج** — `feature/kian-operations-platform-v1`: `docs/kian_testimonials_v1_RUNME.sql` · `lib/portal/testimonials.ts` · `/share-experience` · `AdminTestimonials.tsx` · علم `testimonials_enabled` |
| **Portfolio** | مصفوفة `ITEMS` ثابتة داخل `components/Portfolio.tsx` (46 عملًا). **`content/portfolio.ts` غير موجود.** |

### 🔴 القيد الحاسم (يبقى ساريًا رغم اختلاف اسم الملف)
❌ **ممنوع تعديل ملف محتوى الأعمال تلقائيًا وقت التشغيل على Vercel** — نظام الملفات
للقراءة أصلًا، والكتابة تُفقد عند أول إعادة نشر. **ينطبق على
`components/Portfolio.tsx`** بوصفه المخزن الفعلي.
**المسار المعتمد:** Draft في القاعدة أو Export Queue → معاينة → موافقة → Script أو
Pull Request يُحدِّث ملف المحتوى → نشر بعد اعتماد خالد.

**ممنوع:** ❌ مولّد ثانٍ لـPortfolio أو Case Studies · ❌ نشر تلقائي بلا اعتماد ·
❌ **الإبقاء على `Testimonials.tsx` الثابت مع نظام التقييم** (خطر §M قائم اليوم).
**مطلوب:** Publication Consent للشعار والتقييم ودراسة الحالة.

---

## P-18 🔒 RLS و Soft Delete

- 258 `enable row level security` · 271 جدولًا بسياسات.
- `is_deleted` (2,266) · `deleted_at` (145) · `delete_reason` (103).
- بوابات: `pc_can_read_project` · `can_*()` (36) · `civ_*()` (46) · `is_owner/is_staff/is_admin`.

**ممنوع:** ❌ جدول جديد بلا RLS **deny-by-default** · ❌ إنفاذ صلاحية الاعتماد في UI فقط —
**تُفرَض في RLS/RPC** · ❌ حذف صلب لسجل مشمول بـSoft Delete · ❌ نظام أدوار موازٍ.
**`client_viewer` / `client_approver`** = قدرات ضمن `project_members` / `project_member_roles`،
**لا نموذج أدوار جديد**.
**مطلوب:** اختبار كل دور **إيجابيًا وسلبيًا**.

---

## P-19 🔒 المفاتيح والأعلام والجدولة (قيود بيئية صلبة)

| القيد | الواقع |
|---|---|
| **Cron** | **3 مهام فقط** في `vercel.json` (03:00 / 03:10 / 03:20). خطة Hobby ⇒ ❌ لا background jobs إضافية. أي جدولة جديدة **تُضاف داخل هذه الثلاث أو عبر n8n**. |
| **الأعلام** | موزّعة على **18 جدول `*_settings`** + **~20 متغير بيئة**. لا سجل موحّد. |
| **`SENTRY_DSN`** | **Missing** — صفر إشارة لـSentry في المستودع. |
| **النسخ الاحتياطي** | **Missing** — لا سكربت ولا متغير ولا إجراء استعادة. |
| **بيئة Preview منفصلة** | **Missing** — لا أثر في `.env.example` ولا في أي مستند. |

**قاعدة §P الملزمة:** لكل علم — Owner · Default state · Activation steps · Rollback steps
· Removal date. ومع **إطفاء أعلام الميزات الكبيرة، تجربة الموقع والبوابة الحالية لا تتغير**.

---

## P-20 🔒 قيود إضافية مستمدة من أمر التدقيق (تُنقل نصًا إلى v2.1)

1. **الخطوة الصفرية Git:** أول أمر في أي مهمة تنفيذية = `git status --short --branch`.
   شجرة غير نظيفة ⇒ **توقف وأبلغ**. ❌ ممنوع `stash` / `reset` / `checkout` يتجاهل
   تغييرات / حذف أو نقل أي تغيير قائم — مهما كان السبب.
2. **سياسة الأسرار الثلاثية:** لا سر ولا Token ولا DSN ولا كلمة مرور في أي ملف أو تقرير.
   يُذكر **اسم المتغير وحالته فقط**: `Configured` / `Missing` / `Unknown`.
3. **Deemed Approval (الموافقة الحكمية):** `NEEDS KHALED CONFIRMATION` **والراية OFF**.
   ❌ **لا يُفترض ثبوت الأساس التعاقدي** قبل تحديد نسخة العقد النهائية الموقّعة ونص
   البند **لكل مشروع على حدة**. عقد بناء لا يُطبَّق تلقائيًا على «مسبار ١٠».
4. **Apple Guideline 4.2:** التطبيق ثنائي الدور (عميل + طاقم، شامل مسح QR للعهد) يُوصف
   **تعزيزًا للقيمة الأصلية** — ❌ **وليس ضمانًا لقبول Apple**.
5. **Demo Tenant:** ❌ لا `DEMO_MODE` داخل Production ببيانات وهمية. الحل بيئة
   Demo/Preview منفصلة بنفس الكود وبيئة مستقلة، **بلا أي بيانات أو مفاتيح إنتاج**.
   (✅ الخطر **غير قائم اليوم** — لا `DEMO_MODE` في المستودع.)
6. **الاختبارات على Preview/Local حصرًا — ❌ أبدًا على Production.**
7. **Mobile:** ❌ لا Mobile API يعيد بناء منطق الأعمال — المطلوب **RPC/API facade آمن
   فوق المنطق القائم**، يعيد استخدام Supabase Auth وRLS و`project_operational_snapshot`
   وخدمة الإشعارات وworkflows الاعتماد والعهدة القائمة.
8. **IDs ثابتة:** كل متطلب ذرّي يحمل `V2-<wave>.<item>-<letter>` ويُستخدم **نفسه** في كل
   المصفوفات والتقارير والمسودة.

---

## ملخص التصنيف

| الدرجة | العدد | البنود |
|---|---|---|
| 🔒 **PROTECTED** | **14** | P-1 · P-2 · P-5 · P-6 · P-8 · P-9 · P-10 · P-13 · P-15 · P-16 · P-17 · P-18 · P-19 · P-20 |
| ⚠️ **PROTECTED — WITH KNOWN DUPLICATION** | **5** | P-3 (D-4) · P-4 (مسارا إشعارات) · P-7 (D-9) · P-11 (عائلتا عهدة) · P-14 (D-1/D-2/D-3) |
| ❓ **CANDIDATE — NEEDS PRODUCTION PROOF** | **1** | P-12 (سجل التدقيق — يحتاج قرار خالد لا إثباتًا تقنيًا فقط) |

**الازدواجات القائمة العشرة (D-1…D-10)** مفصّلة في
[`EXISTING_CAPABILITIES.md`](EXISTING_CAPABILITIES.md) §8. **هي عبء موروث، لا نتيجة
للخطة الجديدة — وv2.1 مسؤولة عن عدم زيادتها، ويُفضَّل أن تحمل بندًا صريحًا لتقليصها.**
