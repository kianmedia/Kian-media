# EXISTING_CAPABILITIES — جرد القدرات القائمة فعليًا

> **الحالة:** مُنتَج ضمن مهمة `MASTER_ORDER_FINAL.md` (READ-ONLY audit).
> **الفرع:** `docs/v2_1-audit` · **HEAD وقت الجرد:** `7b92391` (2026-08-02)
> **المصدر:** قراءة المستودع فقط. **لم يُتصل بقاعدة Production ولم يُنفَّذ أي SQL.**
>
> ⚠️ **قاعدة قراءة هذا الملف:** «موجود في المستودع» ≠ «مطبّق على Production».
> عمود *Production* هنا يقول ما يمكن إثباته من المستندات فقط. راجع
> [`DATABASE_APPLICATION_STATUS.md`](DATABASE_APPLICATION_STATUS.md) قبل بناء أي قرار
> على حالة تطبيق SQL.
>
> 🚫 **سياسة الأسرار:** لا يحتوي هذا الملف أي قيمة سر أو مفتاح أو DSN. متغيرات البيئة
> تُذكر بالاسم وحالتها الثلاثية فقط: `Configured` / `Missing` / `Unknown`.

---

## 0) الخلاصة التنفيذية بالأرقام (دليل عددي)

| المقياس | العدد | كيف قيس |
|---|---|---|
| ملفات SQL في `docs/` | **292** | `ls docs/*.sql` |
| مستندات `.md` في `docs/` | **147** | `ls docs/*.md` |
| جداول مُعرَّفة عبر كل ملفات SQL (بعد إزالة التكرار) | **421** | `grep -o 'create table …'` |
| دوال/RPCs مُعرَّفة (بعد إزالة التكرار) | **1,662** | `grep -o 'create … function …'` |
| عبارات `enable row level security` | **258** | grep |
| جداول تحمل سياسات `create policy` | **271** | grep |
| ملفات اختبار في `tests/` | **239** | `ls tests` |
| وحدات خدمة في `lib/portal` + `lib/server` | **~120 ملف** | `find lib -name '*.ts'` |
| مسارات `app/` (صفحات + API) | **~100 مجلد مسار** | `find app -type d` |
| متغيرات بيئة يقرأها الكود | **68** | `grep 'process.env.'` |
| مجلدات `supabase/migrations` | **0** — لا يوجد نظام migrations رسمي | `ls supabase/migrations` |

**الاستنتاج الأول والأهم:** المستودع **ليس مشروعًا في بداياته**. هو منصة ناضجة جدًا
تغطي بالفعل الغالبية العظمى من مناطق التداخل A–Q المذكورة في أمر التدقيق. أي خطة
جديدة يجب أن تُكتب بصيغة **VERIFY & EXTEND** لا `KEEP — NEW` إلا في حالات نادرة
مُثبتة.

**الاستنتاج الثاني:** لا يوجد نظام migrations منظم (`supabase/migrations` فارغ).
كل تغيير قاعدة بيانات هو ملف `*_RUNME.sql` يدوي في `docs/`. هذا هو **مصدر عدم
اليقين البنيوي** في كامل المنصة: لا سجل آلي يقول أي ملف طُبِّق.

---

## 1) الموقع العام (Public Website)

**المسارات:** `app/page.tsx` · `/case-studies` · `/case-studies/[slug]` · `/quote-request`
· `/book-meeting` · `/upload-files` · `/opportunities` · `/live-status` · `/secure-document`
· `/assistant` · `/quick-access` · `/privacy-policy` · `/terms` · `/offline`

**مكوّنات الصفحة الرئيسية (بالترتيب الفعلي في `app/page.tsx:35-49`):**
`Hero → Showreel → Marquee → About → Services → Portfolio → CaseStudiesTeaser → Stats →
WhyKian → Process → Industries → Clients → Reviews → Social → Contact → Footer`

### 1.1 الأعمال (Portfolio)
| البند | الواقع | الدليل |
|---|---|---|
| مصدر البيانات | ثابت داخل المكوّن — مصفوفة `ITEMS` | `components/Portfolio.tsx` |
| **لا يوجد `content/portfolio.ts`** | الملف المذكور في أمر التدقيق §M **غير موجود** | `find . -name 'portfolio*'` → `lib/portal/portfolio.ts` فقط |
| عدد الأعمال المعروضة | **46** | `grep -c '^\s*{ id:'` |
| مجموع عضويات الفئات (مجموع عدّادات الفلاتر) | **56** (لا 54) | عدّ `cats: [...]` |
| توزيع الفئات | corporate 13 · events 9 · weddings 7 · realestate 7 · commercial 7 · documentary 6 · cinematic 4 · festivals 3 | grep |
| أعمال بوصف فريد (`dAr`) | **8 فقط** | grep |
| أعمال ترث وصف الفئة (مكرر) | **38** | 46 − 8 |
| أعمال باسم «إعلان قصير» | **3** — أسطر 109 / 111 / 113 | `grep -n 'إعلان قصير'` |

> **تفسير فجوة 56 مقابل 46:** ليست خطأ بيانات. عنصر واحد يمكن أن ينتمي لعدة فئات
> عمدًا (مثال: «معادن — اليوم المفتوح» = corporate + events). مجموع عدّادات الفلاتر
> يفوق عدد العناصر بالضرورة. **القرار المطلوب من خالد:** هل تُعرض العدّادات كما هي،
> أم يُضاف توضيح، أم تُمنع العضوية المتعددة؟

### 1.2 العدّادات
- `components/Stats.tsx` يحمل أربع قيم **ثابتة في الكود**: `20+` سنة خبرة · `4000+` إنتاج
  · `2000+` عميل · `13` منطقة.
- `components/Counter.tsx` يبدأ بـ`useState(0)` ⇒ **HTML الأولي (SSR) يعرض `0+` فعلًا**،
  ثم يتحرك بعد تشغيل JavaScript. توجد ثلاث طبقات إطلاق (رؤية فورية / IntersectionObserver /
  مهلة 1.2 ثانية) — أي أن العطل **ليس** في العميل، بل أن الرقم غير موجود في HTML لمحركات
  البحث ولمن يعطّل JS.
- ✅ **يطابق حرفيًا نتيجة الفحص الخارجي المؤرخ 2026-08-02.**

### 1.3 التقييمات و«آراء العملاء»
| المكوّن | الحالة | الدليل |
|---|---|---|
| `components/Reviews.tsx` | **مركّب في الصفحة** — حالة فارغة أنيقة («ستظهر هنا قريبًا») + رابط واتساب | `app/page.tsx:47` |
| `components/Testimonials.tsx` | **موجود لكنه غير مركّب** — كود ميت يحوي **3 شهادات وهمية ثابتة** بأسماء أشخاص | غير مستورد في `app/page.tsx` |
| نظام تقييمات فعلي | **موجود لكن غير مدموج** — على فرع `feature/kian-operations-platform-v1` | `docs/kian_testimonials_v1_RUNME.sql` · `lib/portal/testimonials.ts` · `app/share-experience/page.tsx` · `components/portal/AdminTestimonials.tsx` |

> ⚠️ **خطر §M مُتحقَّق:** المستودع يحوي **الشهادات الثابتة ونظام التقييم معًا** — تمامًا
> ما يمنعه أمر التدقيق. الحل ليس بناء نظام جديد، بل **دمج فرع Module 1 وحذف
> `Testimonials.tsx`**.

### 1.4 SEO / Metadata
| البند | الواقع | الدليل |
|---|---|---|
| Metadata مركزية | `app/layout.tsx:9` — عنوان ووصف وOG واحد لكل المسارات | ✔ |
| `canonical` | `alternates: { canonical: SITE }` — **ثابت `https://kianmedia.com` لكل المسارات** | `app/layout.tsx:44` |
| الاستثناء الوحيد | `/case-studies` و`/case-studies/[slug]` تملكان `generateMetadata` وcanonical صحيحًا | `app/case-studies/page.tsx:31` · `[slug]/page.tsx:46` |
| المسارات بلا metadata خاصة | `/quote-request` · `/book-meeting` · `/upload-files` · `/opportunities` · `/privacy-policy` · `/terms` · `/live-status` · `/assistant` | ❌ |
| OG image | `/logo.png` — **800×800 مربّع** (المطلوب 1200×630) | `app/layout.tsx` + `ls public/logo.png` |
| `sitemap.ts` / `robots.ts` / `manifest.ts` | **موجودة** ومشتقّة من `lib/site.ts` (مصدر أصل واحد) | `app/sitemap.ts` · `app/robots.ts` |
| `error.tsx` عام | موجود + 7 حدود خطأ داخل البوابة | `app/error.tsx` |
| Structured data | `ProfessionalService` + `Organization` JSON-LD | `app/layout.tsx` |
| i18n | `lib/i18n.tsx` — 54 سطرًا، `useI18n()` عربي/إنجليزي على مستوى المكوّن، **لا مسارات `/ar` و`/en`** | ✔ |

### 1.5 النماذج وحفظ الـLeads (§G)
| النموذج | يحفظ في Supabase؟ | يرسل لـApps Script؟ | واتساب؟ |
|---|---|---|---|
| `components/Contact.tsx` (الرئيسي) | ❌ **لا شيء** | ❌ | ✅ فقط `window.open(wa.me/…)` |
| `app/quote-request/page.tsx` | ✅ `captureIntake` | ✅ `submitToSheets` **أولًا** | ✅ |
| `app/book-meeting/page.tsx` | ✅ `captureIntake` | ✅ **أولًا** | ✅ |
| `app/upload-files/page.tsx` | ✅ `captureIntake` | ✅ **أولًا** | ✅ |

- **البنية التحتية موجودة بالكامل:** `POST /api/public/intake` → RPC بصلاحية service_role →
  جدول `public_intake`، مع Rate limiting (12/ساعة لكل IP، 6/ساعة لكل بريد)، وحدّ حجم
  100KB، وسقوف طول الحقول، وربط لاحق بالحساب عبر `link_my_records_by_email`.
- **ثغرة أمنية سابقة مُصلَحة وموثَّقة داخل الملف:** `jwtSub()` كانت تفكّ الـJWT **بلا
  تحقق من التوقيع** ⇒ حقن صف في بوابة أي ضحية. استُبدلت بـ`authGetUserId()`.
  🔒 **يجب حمايتها باختبار Regression — ممنوع التراجع عنها.**
- **فجوتان فعليتان فقط في §G:** (1) النموذج الرئيسي لا يستدعي `captureIntake` إطلاقًا؛
  (2) الترتيب معكوس — Apps Script يُستدعى **قبل** الحفظ في Supabase لا بعده.
- جملة الموافقة الضمنية موجودة (`components/Contact.tsx:234`) — **لا يوجد checkbox في أي
  نموذج**.
- `SHEETS_ENDPOINT` **مكتوب حرفيًا داخل `lib/submitForm.ts`** (لا متغير بيئة). يُذكر هنا
  كملاحظة معمارية؛ القيمة غير مُعادة هنا.

### 1.6 البريد وNAP
- `components/Footer.tsx:46` → `info@kianmedia.com` فقط.
- `components/Contact.tsx:154-155` → `info@` **و**`sales@` معًا.
- ⇒ **عدم توحيد مُثبَت.** قرار خالد مطلوب (سؤال Gate A).

---

## 2) البوابة — الوحدات القائمة

> كل وحدة أدناه لها: جداول + RPCs + RLS + خدمة TypeScript + واجهة. المصدر: تسميات
> الجداول والدوال المستخرجة من `docs/*.sql` ومقابلتها بـ`lib/` و`app/` و`components/`.

| # | الوحدة | بادئة الجداول | حزمة SQL | خدمة TS | الواجهة |
|---|---|---|---|---|---|
| 1 | **Project Core** (نواة المشاريع) | `project_core`, `projects`, `project_*` (≈70 جدول) | `project_core_*_RUNME.sql` (7 ملفات) | `lib/portal/projectCore.ts` | `/client-portal/project-core` + `[projectId]` |
| 2 | **Project Hierarchy** (Parent–Child) | `projects.parent_project_id`, `project_hierarchy_settings` | `project_hierarchy_{schema,security,batch6a,batch6b}` | `lib/portal/projectHierarchy.ts` | تبويب المشاريع الفرعية |
| 3 | **Programs / Units** (8A/8B/8D) | `project_program_settings`, `project_program_commitments`, `project_program_plan_runs` | `project_programs_batch8a` · `batch8b` · `batch8d` | `lib/portal/programs.ts`, `programSla.ts` | لوحة البرنامج |
| 4 | **Tasks** (3A/3B/3C) | `project_tasks`, `project_task_assignees`, `task_dependencies`, `task_comments`, `task_files`, `task_followers` | `project_tasks_batch3{a,b,c}` | `lib/project-core/taskWorkflow.ts` | تبويب المهام |
| 5 | **Planning / Gantt** (4A) | `project_schedule_items`, `project_schedule_dependencies`, `project_dependencies` | `project_planning_batch4a_RUNME` + 3 إصلاحات + `final_fix` | `lib/portal/planningWarnings.ts` | Gantt |
| 6 | **Resources & Booking** (4B/4C) | `planning_resources`, `resource_bookings`, `resource_availability_rules`, `resource_unavailability` | `project_resources_batch4b` · `batch4c_closure` | `lib/portal/projectResources.ts` | تبويب الموارد |
| 7 | **Governance** (5A) | `project_risks`, `project_issues`, `project_decisions`, `project_assumptions`, `project_change_requests`, `project_member_roles`, `project_governance_settings` | `project_governance_batch5a` | `lib/portal/projectGovernance.ts` | تبويب الحوكمة |
| 8 | **Executive** (5B) | `executive_kpi_catalog`, `executive_kpi_snapshots`, `executive_alert_rules` | `project_governance_batch5b` · `executive_reporting_RUNME` | `lib/portal/executive.ts`, `execReport.ts` | `/client-portal/executive` |
| 9 | **Closure** (5C/6C) | `project_closure_requests`, `project_lessons_learned`, `project_post_reviews`, `project_final_acceptances`, `project_reopen_requests`, `project_archives` | `project_governance_batch5c` · `project_closure_batch6c` | `lib/portal/projectClosure.ts` | `/project-core/[id]/closure-report` |
| 10 | **Templates** (7A) | `project_templates`, `project_template_versions` | `project_templates_batch7a` | `lib/portal/projectTemplates.ts` | القوالب |
| 11 | **Operations Center** (7B) | يستهلك مصادر قائمة | `project_operations_batch7b` | `lib/portal/opsCenter.ts` | `/client-portal/operations` |
| 12 | **Fast Lane** (8C) | `projects.operating_experience` | `project_fastlane_batch8c` | `lib/portal/fastlane.ts` | لقطة سريعة |
| 13 | **Pre-production** | `preproduction_items`, `preproduction_comments` | `preproduction_center_RUNME` · `preproduction_completion_RUNME` | `lib/portal/preproduction.ts` | تبويب ما قبل الإنتاج |
| 14 | **Production Ops** (`prodops`) | `ops_jobs`, `ops_call_sheets`, `ops_locations`, `ops_job_{crew,equipment,permits,travel,vehicles,weather,hse,accommodation}`, `ops_daily_reports`, `ops_incidents`, `ops_media_{cards,backups}`, `ops_post_handoff`, `ops_delays`, `ops_vehicles` | `operations_center_RUNME` (2,912 سطر) + PREFLIGHT/POSTCHECK/ROLLBACK | `lib/portal/operations.ts` | `/client-portal/operations` |
| 15 | **Deliverables & Delivery** | `deliverables`, `deliverable_versions`, `deliverable_reviews`, `deliverable_assets`, `deliverable_downloads`, `deliverable_receipts`, `deliverable_final_opens`, `deliverable_internal`, `client_comments`, `project_delivery_release` | `deliverable_*_RUNME` (6) · `project_delivery_{release_policy,payment_gate}` | `lib/portal/deliverables.ts` | تبويب المخرجات |
| 16 | **Custody / Assets** | `custody_inventory_*` (≈25 جدول) + `custody_*` القديم + `asset_insurance_policies` + `policy_assets` | `portal_custody_inventory_system_v1` · `asset_intelligence_RUNME` (2,143) · 8 PATCHes | `lib/portal/custody.ts`, `custodyInventory.ts`, `custodyEnterprise.ts`, `assetIntelligence.ts` | `/client-portal/equipment`, `/asset-custody` |
| 17 | **Rental & Insurance** | `custody_rental_*` (9 جداول) · `insurance_claims*` · `renter_profiles` | `rental_v1_final_production_RUNME` (1,714) · `rental_insurance_production_RUNME` (1,336) + 10 hotfixes | `lib/portal/rental.ts` + 3 | `/client-portal/rentals` |
| 18 | **HR** | `hr_*` (18 جدول) | `portal_hr_employee_portal_RUNME` + v2/v3/v3.1 | `lib/portal/hr.ts`, `lib/server/hrAuth.ts` | `/client-portal/employee` |
| 19 | **Employees / Professions / Permissions** | `professions`, `employee_professions`, `profession_permissions`, `permissions`, `employee_permission_overrides` | `employee_professions_RUNME` · `permission_catalog_RUNME` · `permission_enforcement_RUNME` | `lib/portal/professions.ts`, `roles.ts` | إدارة الصلاحيات |
| 20 | **CRM / Sales** | `crm_*` (22 جدول) | `crm_sales_FOUNDATION_RUNME` (3,977) | `lib/portal/crm.ts` | `/client-portal/crm` |
| 21 | **Lead Scoring & Routing** | `lsr_*` (12 جدول) | `lead_scoring_routing_RUNME` (3,267) + security patch | `lib/portal/leads.ts` | ضمن CRM |
| 22 | **Smart Quoting** | `sq_*` (14 جدول) — يشمل **Price Books وRate Cards وCost Rates** | `smart_quoting_RUNME` (2,964) | `lib/portal/quoting.ts` | `/client-portal/quoting` |
| 23 | **Finance & Profitability** | `fin_*` (24 جدول) — يشمل `fin_payment_milestones` و`fin_costs` و`fin_budgets` و`fin_receivables` و`fin_collections` و`fin_zoho_outbox` | `finance_profitability_RUNME` (3,805) · `project_core_FINANCE_RUNME` | `lib/portal/finance.ts`, `financeOps.ts` | `/client-portal/finance` |
| 24 | **Zoho Books** | `zoho_books_settings`, `zoho_entity_mappings`, `zoho_account_mappings`, `zoho_sync_jobs`, `zoho_webhook_events` | ضمن حزم متعددة | `lib/server/zohoBooks*.ts` (6 ملفات) | مسارات `/api/integrations/zoho/*` (7) |
| 25 | **Commercial Subscriptions** | `csub_*` (14 جدول) | `commercial_subscriptions_RUNME` (4,078) | `lib/portal/commercial.ts` | `/client-portal/offers` |
| 26 | **Talent & Vendor Network** | `tvn_*` (14 جدول) — **مكافئ `crew_contractors`** | `talent_vendor_network_RUNME` (2,358) | `lib/portal/talentNetwork.ts` | شبكة المواهب |
| 27 | **Vendor Compliance** | `vcc_*` (16 جدول) | `vendor_compliance_center_RUNME` (3,325) | `lib/portal/compliance.ts` | `/client-portal/compliance` |
| 28 | **Case Studies** | `cs_*` (13 جدول) | `case_studies_platform_RUNME` (3,054) | `lib/portal/caseStudies.ts`, `lib/server/publicCaseStudies.ts` | `/case-studies` عام + `/client-portal/case-studies` |
| 29 | **Live Operations** | `liveops_*` (13 جدول) | `live_operations_dashboard_RUNME` (2,314) | `lib/portal/liveOps.ts` | `/client-portal/live-operations` + `/live-status` عام |
| 30 | **Communications Hub** | `comms_outbox`, `comms_channels`, `comms_templates`, `comms_preferences`, `comms_event_catalog`, `comms_audit`, `comms_rate_counters` | `communications_hub_RUNME` (2,539) | `lib/server/commsHub.ts` + 3 | `/client-portal/communications` |
| 31 | **Notifications (القديم/الأساسي)** | `notifications`, `notification_preferences`, `notification_events`, `notification_delivery_log`, `notification_cron_runs`, `email_deliveries`, `integration_outbox` | `phase0_migration` · `global_notifications_*_batch10` (3) · `notifications_{recovery_batch9c,e2e_repair_batch9d}` | `lib/portal/notifications.ts`, `lib/server/notifyEvent.ts`, `notifyWorker.ts` | `/client-portal/notifications` |
| 32 | **WhatsApp** | `whatsapp_*` (14 جدول) | `whatsapp_inbox_RUNME` + 10 حزم | `lib/whatsapp/*` (6) + `lib/server/whatsappCloud.ts` | `/client-portal/admin/whatsapp` |
| 33 | **AI Assistant** | `ai_*` (15 جدول) | `kian_ai_assistant_RUNME` (2,214) | `lib/portal/aiAssistant.ts`, `lib/server/aiProvider.ts` | `/assistant` + `/client-portal/assistant` |
| 34 | **Opportunities** | `opportunity_requests`, `opportunity_messages`, `opportunity_request_notes` | `opportunities_center_RUNME` + addenda | `lib/opportunities.ts` | `/opportunities` عام + `/client-portal/opportunities` |
| 35 | **MFA** | `mfa_settings` | `mfa_foundation_batch_s1` · `mfa_assurance_s3` · `mfa_write_gate_s4a/s4b` | `lib/portal/mfa.ts` | ضمن الملف الشخصي |
| 36 | **Bulk Import** | `import_batches`, `import_batch_events`, `import_rows` | `project_bulk_import_RUNME` (1,008) | `lib/portal/import/*` (20 ملف) | `/api/portal/import/*` |
| 37 | **PWA** | لا SQL | — | `lib/pwa/*`, `public/sw.js` | `app/manifest.ts`, `app/offline` |
| 38 | **Mobile (Expo)** | يعيد استخدام Supabase | لا SQL | `apps/mobile/src/lib/{api,supabase}.ts` | `HomeScreen` · `LoginScreen` · `ScanScreen` |

### 2.1 إضافة بعد قراءة v2.0 — قدرات لم يرصدها الجرد الأول

راجعتُ هذا الملف بعد وصول `MASTER_BRIEF.md` (v2.0)، فكشف أن أربع قدرات يطلبها v2.0
**موجودة بالفعل** ولم يرصدها الجرد الأول:

| القدرة | الدليل | يقابل بند v2.0 |
|---|---|---|
| **CI فعّال على GitHub Actions** | `.github/workflows/ci.yml` — وظيفتان: `web` (lint → typecheck → test → build على `push` و`pull_request`) و`mobile` (typecheck + `expo-doctor`) | `V2-7.8-B` |
| **ترويسات أمان شاملة حيّة** | `next.config.js:14-60` — `X-Content-Type-Options` · `X-Frame-Options` · `X-XSS-Protection` · `Referrer-Policy` · `Permissions-Policy` (بتعليل موثَّق لـ`geolocation=(self)` يمنع كسر تسجيل حضور الموظفين) · **CSP بنصفين: منفَّذ (`frame-ancestors` · `base-uri` · `form-action` · `object-src` · `upgrade-insecure-requests`) + Report-Only للباقي**. ⚠️ **`HSTS` غير مدرج** | `V2-0.6-B` |
| **62 شعار عميل معالَج** | `public/clients` — v2.0 يقدّرها بـ22 | `V2-2.2-A` |
| **`/quick-access` صفحة روابط لا نموذج** | `app/quick-access/page.tsx` — `href` فقط إلى `/quote-request` و`/book-meeting` و`/upload-files` | `V2-0.1-E` (مبني على مقدمة خاطئة) |

---

## 3) الأنظمة العرضية (Cross-cutting)

### 3.1 الصلاحيات
- **ثلاث طبقات منفصلة قائمة فعلًا:**
  1. `profiles.account_type` + `staff_role()` — دور الوصول للنظام.
  2. `professions` + `employee_professions` + `profession_permissions` — المهنة.
  3. `permissions` + `employee_permission_overrides` — **124 صلاحية ذرّية** مُعرَّفة في
     `docs/permission_catalog_RUNME.sql`، مع محلّل `emp_has_permission` وغلاف توافق `emp_can`.
- بوابات دوال: `can_*()` (36 دالة) · `civ_*()` (46) · `pc_can_read_project(uuid)` ·
  `is_owner()` · `is_staff()` · `is_admin()`.

### 3.2 سجل التدقيق — ⚠️ **مُشتَّت لا مركزي**
- سجل مركزي: `activity_log` + `log_activity(uuid,text,text,text,uuid,jsonb)`
  (`docs/activity_log_role_hardening_RUNME.sql`).
- **لكن** توجد **14 جدول تدقيق منفصل** بالتوازي: `crm_audit` · `fin_audit` · `cs_audit`
  · `sq_audit` · `csub_audit` · `tvn_audit` · `lsr_audit` + `lsr_event_log` · `tvn_event_log`
  · `liveops_audit` · `ops_audit` · `ai_audit` · `comms_audit` · `mgmt_audit`
  · `custody_inventory_audits`.
- ⚠️ **سؤال Gate A إلزامي:** أي سجل هو المرجع لـ«Audit Log Viewer»؟ الحالة الراهنة
  تخالف مبدأ «لا سجل ثانٍ» — لكن المخالفة **قائمة أصلًا** ولم تُنشئها v2.

### 3.3 Soft Delete
`is_deleted` (2,266 إشارة) · `deleted_at` (145) · `delete_reason` (103) — النمط مطبَّق على
نطاق واسع مع سجل أسباب.

### 3.4 الإشعارات — ⚠️ **مساران متوازيان قائمان**
1. **المسار الأصلي:** `notifications` + `notification_events` + `email_deliveries`
   + `integration_outbox` + `notify_emit_event(...)` (المحرّك الموحّد، Batch 10).
2. **Communications Hub:** `comms_outbox` + `comms_channels` + `comms_templates`
   + `comms_preferences` + محوّل توافق `lib/server/commsLegacyAdapter.ts`
   + مفتاح إيقاف `lib/server/commsKillSwitch.ts`.
- المرسِلات: `/api/integrations/{project,custody,rental,hr,whatsapp,custody-inventory}/notify`
  + `/api/integrations/notify/drain` + `/api/comms/{process,legacy-notify}`.
- الجدولة: **3 Vercel crons فقط** (`vercel.json`): `custody-alerts` 03:00 ·
  `notify-email` 03:10 · `zoho-sync` 03:20.

### 3.5 منع الحجز المزدوج — **مطبَّق في القاعدة**
- الحارس يرفع `errcode = '23P01'` مع `hint` مُهيكل:
  - `person:<code>` (`operations_center_RUNME.sql:1078`, `:1153`)
  - `equipment:<code>` (`:1113`)
  - `location:<code>` (`:1143`)
  - `civ_guard_reservation` / `civ_double_booking` (`asset_intelligence_RUNME.sql:759`, `:788`)
- الحارس على **الجدول** لا داخل RPC واحدة (`asset_intelligence_RUNME.sql:1978`) — لا
  يمكن الالتفاف عليه بمسار كتابة آخر.
- الواجهة تترجمه: `lib/portal/pgerror.ts` يصنّف `23P01` كـ`conflict` برسالة عربية صريحة
  تقول «غيّر الفترة أو حرّر الحجز القائم» و**لا** تقول «حاول مرة أخرى» ولا «ترحيلة ناقصة».
- ⇒ **§D من أمر التدقيق منفَّذ بالكامل.** لا مساحة لمحرك تعارض جديد.

### 3.6 تصنيف أخطاء PostgreSQL — أصل معماري نادر
`lib/portal/pgerror.ts` يفصل 10 نتائج لا تُخلط أبدًا، ويوثّق داخله دورة تصحيح إنتاج
كاملة ضاعت بسبب خلط `42703` بـ«الترحيلة غير مطبّقة». **يجب حمايته صراحة.**

---

## 4) الاختبارات القائمة (239 ملف)

**تغطية موجودة بالفعل من قائمة Wave 0 (§O):**

| اختبار §O المطلوب | موجود؟ | الدليل |
|---|---|---|
| Login | جزئي | `mfa_*`, `authz_identity_s4pre.test.js` |
| Project visibility by role | ✅ | `project_platform_freeze.test.js`, `editor_least_privilege.test.js`, `authz_*` (6) |
| Client project view | ✅ | `commercial_client_isolation.test.js`, `case_studies_project_read_guard.test.js` |
| Deliverable version view | ✅ | `deliverable_internal_isolation.test.js` |
| Client comment | جزئي | `v1_closure_fixes.test.js` |
| Approve / Reject | ✅ | `transition_approval.test.js`, `crm_owner_approval.test.js`, `commercial_owner_approval.test.js` |
| **Double-booking rejection (`23P01`)** | ✅ | `asset_lifecycle_guards.test.js`, `talent_assignment_rules.test.js` |
| Financial visibility restrictions | ✅ | `commercial_operations_financial_isolation.test.js`, `quoting_profit_guard.test.js`, `crm_commission_isolation.test.js`, `talent_rates_privacy.test.js` |
| Operational snapshot consistency | ✅ | `project_lifecycle_e2e.test.js`, `project_platform_stabilization.test.js` |
| Quote request persistence | ✅ | `public_forms_honest_success_phase1.test.js` |
| **Anonymous email relay rejection** | ✅ | `comms_anon_zero_access.test.js`, `email_backbone_phase1.test.js`, `relay_handler_batch11.test.js` |
| Equipment custody permissions | ✅ | `custody_acl_matrix.test.js`, `asset_authz_and_costing.test.js` |

> **استنتاج §O:** الحد الأدنى المطلوب في Wave 0 **موجود تقريبًا بالكامل**. Wave 0
> ليست «بناء اختبارات» بل **تشغيلها والتحقق من خضرتها على Preview**.
> `npm test` = `node --test tests/`. **لم تُشغَّل في هذه المهمة (READ-ONLY).**

**فئات اختبار إضافية غير مطلوبة في §O لكنها قائمة:** حماية حقن الأوامر في المساعد الذكي
(`ai_prompt_injection`) · صحة حزم SQL (`sql_*` — 7 ملفات) · خصوصية PWA
(`pwa_lifecycle_privacy`, `pwa_service_worker_security`) · ثبات دفتر الأستاذ
(`commercial_ledger_immutability`) · سلامة النوع الاجتماعي في إسناد المواهب
(`talent_gender_safety`).

---

## 5) متغيرات البيئة — الأسماء والحالة فقط (68 متغيرًا)

> 🚫 لا قيم. الحالة: `Configured` = مُعرَّف في `.env.local` محليًا · `Unknown` = يقرأه
> الكود ولا يمكن إثبات حالته على Vercel من المستودع · `Missing` = لا يوجد له أثر إطلاقًا.

| المجموعة | المتغيرات | الحالة |
|---|---|---|
| Supabase (عام) | `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Configured** (محليًا) |
| Supabase (خادم) | `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | **Unknown** |
| الموقع | `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_PORTAL_URL` · `PORTAL_PUBLIC_URL` | **Unknown** |
| Cron | `CRON_SECRET` | **Unknown** |
| البريد / التتابع | `PORTAL_NOTIFY_ENDPOINT` · `COMMS_RELAY_SIGNING_SECRET` · `COMMS_LEGACY_RELAY_ENABLED` · `COMMS_LEGACY_SENDERS_ENABLED` · `NEXT_PUBLIC_COMMS_LEGACY_NOTIFY_ENABLED` | **Unknown** |
| تنبيهات البريد لكل وحدة | `CUSTODY_EMAIL_ALERTS_ENABLED` · `HR_EMAIL_ALERTS_ENABLED` · `PROJECT_EMAIL_ALERTS_ENABLED` · `WHATSAPP_EMAIL_ALERTS_ENABLED` | **Unknown** |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_API_VERSION` · `WHATSAPP_SEND_ENABLED` · `WHATSAPP_SEND_TEST_ALLOWLIST` · `WHATSAPP_TEMPLATE_SEND_ENABLED` · `WHATSAPP_TEMPLATE_TEST_ALLOWLIST` · `WHATSAPP_START_CONVERSATION_ENABLED` · `WHATSAPP_INTERNAL_ALERTS_ENABLED` · `WHATSAPP_INTERNAL_ALERTS_TEST_ALLOWLIST` · `WHATSAPP_AUTO_QUOTE_LINK_{ENABLED,DRY_RUN,COOLDOWN_HOURS,TEST_ALLOWLIST}` · `NEXT_PUBLIC_WA_DEBUG` | **Unknown** |
| Zoho | `ZOHO_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN,ORGANIZATION_ID,ACCOUNTS_BASE,ACCOUNTS_BASE_URL,ACCOUNTS_URL,API_BASE_URL,CRM_API_BASE}` · `ZOHO_BOOKS_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN,ORGANIZATION_ID,API_BASE,VAT_TAX_ID,WEBHOOK_SECRET,SYNC_MODE,ESTIMATES_ENABLED,ESTIMATE_DRAFT_ONLY}` | **Unknown** |
| n8n | `N8N_NOTIFY_WEBHOOK_URL` · `N8N_NOTIFY_SECRET` · `N8N_WHATSAPP_INGEST_SECRET` | **Unknown** |
| المساعد الذكي | `AI_PROVIDER` · `AI_API_KEY` · `AI_AGENT_ENABLED` · `AI_DRAFT_ONLY` · `AI_TEST_ALLOWLIST` · `AI_PUBLIC_FP_SALT` | **Unknown** (موثّق أنه غير مُهيّأ عمدًا في V1) |
| Salts | `LIVE_STATUS_FP_SALT` · `SECURE_DOCUMENT_FP_SALT` | **Unknown** |
| أعلام | `NEXT_PUBLIC_ORG_ADMIN_ROLE_ENABLED` · `QUOTE_REQUEST_CUSTOMER_EMAIL_ENABLED` · `QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_{ENABLED,TEST_ALLOWLIST}` | **Unknown** |
| Vercel/Expo (تلقائي) | `VERCEL_ENV` · `VERCEL_GIT_COMMIT_SHA` · `NODE_ENV` · `EAS_PROJECT_ID` · `EXPO_PUBLIC_SUPABASE_{URL,ANON_KEY}` | **Unknown** |
| **مراقبة** | **`SENTRY_DSN`** | **Missing** — لا إشارة واحدة لـSentry في الكود أو `package.json` |
| **نسخ احتياطي** | لا متغيرات نسخ احتياطي في الكود | **Missing** |

> ⇒ **بندا Observability وBackups في Wave 0 هما `KEEP — NEW` حقيقيان** — نادر في هذا
> المستودع، وهذا يرفع أولويتهما.

---

## 6) الأعلام داخل قاعدة البيانات (جداول `*_settings`)

الأعلام ليست في متغيرات البيئة فحسب، بل في جداول إعدادات: `custody_inventory_settings`
· `custody_enterprise_settings` · `crm_settings` · `cs_settings` · `csub_settings`
· `sq_settings` · `lsr_settings` · `tvn_settings` · `vcc_settings` · `ai_settings`
· `hr_settings` · `mfa_settings` · `zoho_books_settings` · `custody_rental_settings`
· `project_{finance,governance,hierarchy,program}_settings` · `planning_calendar_settings`
· `whatsapp_staff_alert_settings`.

أمثلة موثَّقة: `rental_email_queue_enabled` (OFF مُثبَتة) · `testimonials_enabled`
(على الفرع غير المدموج) · `hierarchy_enabled` · `client_program_view_enabled`
· `custody_kits_enabled` · `insurance_claims_enabled` · `assistant_enabled`.

⚠️ **لا يوجد سجل أعلام موحّد** يذكر لكل علم: المالك / الحالة الافتراضية / خطوات التفعيل
/ خطوات التراجع / تاريخ الإزالة (المطلوب في §P). ⇒ **`KEEP — NEW`: سجل الأعلام.**

---

## 7) حالة Git

- **HEAD:** `7b92391` — `fix(acceptance): make function identity an OID, not a rendered signature`
- **`main` متطابق مع `origin/main`** — لا commits محلية غير مدفوعة.
  ⚠️ هذا **يُبطل** ما تقوله `docs/MANUAL_ACTIONS_QUEUE.md` (M-000) و
  `docs/FINAL_PRODUCTION_READINESS_MATRIX.md` («لا شيء مدفوع») — كلاهما **قديم/متجاوز**.
- الوسم الوحيد: `project-platform-v1.0.0`.

### 7.1 الفروع غير المدمجة (7 فروع فقط من 34)

| الفرع | commits غير مدمجة | آخر تاريخ | المحتوى |
|---|---|---|---|
| `feature/kian-operations-platform-v1` | **6** | 2026-07-15 | **Testimonials Module 1** — `kian_testimonials_v1_RUNME.sql`, `lib/portal/testimonials.ts`, `/share-experience`, `AdminTestimonials.tsx`, تعديل `Reviews.tsx` |
| `fix/portal-urgent-preview` | **29** | 2026-07-01 | معاينات مرفوعة مباشرة + علامة مائية + تسليم نهائي آمن + عملاء «بلا بريد» |
| `fix/deliverable-soft-delete-confirmed` | **27** | 2026-07-03 | حذف المعاينة كان يُظهر نجاحًا كاذبًا |
| `release/portal-whatsapp-final` · `feature/admin-deliverable-edit-delete` · `fix/release-projects-review-combined-preview` | **26** لكل | 2026-07-03 | نفس السلسلة: تحرير/حذف روابط المراجعة + بوابة موافقة WhatsApp + التقاط هاتف العرض |
| `fix/review-preview-unlinked-client-notification` | **25** | 2026-07-02 | إضافة مراجعة لمشروع غير مربوط لم تعد تفشل |

**الفروع الـ27 الباقية مدموجة بالكامل (0 commits فريدة).**

> 🔎 **الأهم:** الست فروع الأخيرة كلها **من عائلة واحدة** حول المخرجات/المعاينات/
> إشعارات التسليم، وكلها **قديمة (2026-07-01→03)** بينما `main` تقدّم شهرًا كاملًا
> بعدها. **يجب فحص ما إذا كان `main` قد أعاد تنفيذ هذه الإصلاحات بطريقة أخرى قبل
> اقتراح دمجها** — الدمج الأعمى خطر تراجع (regression) حقيقي. ⇒ سؤال Gate A.

---

## 8) ازدواجات قائمة **قبل** v2 (لم تُنشئها الخطة الجديدة)

هذه ليست مخاطر مقترحة — هي **واقع في المستودع اليوم**، ويجب أن تعالجها v2.1 لا أن تزيدها.

| # | الحقيقة الواحدة | المصادر المتوازية | الدليل |
|---|---|---|---|
| D-1 | **Call Sheet** | `ops_call_sheets` **و** `project_call_sheets` | `operations_center_RUNME.sql:546` · `project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql:22` |
| D-2 | **دوال Call Sheet** | `prodops_call_sheet` / `prodops_call_sheet_publish` **مقابل** `project_core_call_sheet_save` / `_send` / `_send_to` | grep على الدوال |
| D-3 | **المواقع** | `ops_locations` · `project_locations` · `custody_inventory_locations` | ثلاثة ملفات RUNME |
| D-4 | **إصدارات المخرجات** | `deliverable_versions` **و** `project_deliverable_versions` | `deliverable_versions_RUNME.sql:45` · `project_core_FINAL_RUNME.sql:287` |
| D-5 | **التكاليف** | `project_costs` **و** `fin_costs` **و** `project_expenses` | `project_core_*` مقابل `finance_profitability_RUNME` |
| D-6 | **الإشعارات** | مسار `notifications/notify_emit_event` **و** `comms_outbox` | §3.4 أعلاه |
| D-7 | **سجل التدقيق** | `activity_log` **و** 14 جدول `*_audit` | §3.2 أعلاه |
| D-8 | **الشهادات** | `Testimonials.tsx` ثابت (ميت) **و** نظام Testimonials على فرع غير مدموج | §1.3 أعلاه |
| D-9 | **الشركات/العملاء** | `companies` **و** `crm_companies` **و** `clients` (`lib/clients.ts`) | grep |
| D-10 | **العهدة** | عائلة `custody_*` القديمة **و** عائلة `custody_inventory_*` الجديدة | موثّق في `docs/ASSET_CUSTODY_CURRENT_STATE_AUDIT.md` |

---

## 9) ما هو **فعلًا** غير موجود (مرشّحو `KEEP — NEW`)

بعد جرد 421 جدولًا و1,662 دالة، هذه هي البنود التي **لم أجد لها أي أثر** في المستودع:

| # | البند | دليل الغياب |
|---|---|---|
| N-1 | **Sentry / Observability** | صفر إشارة لـ`SENTRY` في `app`/`lib`/`components`/`package.json` |
| N-2 | **Backups + Restore drill** | لا سكربت، لا متغير، لا مستند إجراء استعادة |
| N-3 | **بيئة Supabase منفصلة للـPreview** | لا أثر لها في `.env.example` ولا في أي مستند |
| N-4 | **Email deliverability (SPF/DKIM/DMARC)** | لا مستند ولا فحص |
| N-5 | **سجل أعلام موحّد** (Owner/Default/Activation/Rollback/Removal) | الأعلام مبعثرة على 18 جدول إعدادات + 20 متغير بيئة |
| N-6 | **Consent checkbox في النماذج** | جملة ضمنية فقط في `Contact.tsx:234` |
| N-7 | **UTM / Attribution capture** | `public_intake` يقبل `source` نصيًا فقط، لا حقول UTM |
| N-8 | **i18n بمسارات `/ar` و`/en`** | `lib/i18n.tsx` على مستوى المكوّن فقط |
| N-9 | **Cmd+K Search عبر Postgres FTS** | لا `tsvector` ولا `to_tsquery` في أي RUNME |
| N-10 | **Music licenses · Model releases · HSE registry · SOP · Post-mortems (كسجلات مستقلة)** | `ops_job_hse` موجود كحقل داخل الوظيفة فقط؛ الباقي غائب |
| N-11 | **Universal Links / App Links / Crash reporting / Session revocation** في تطبيق Expo | `apps/mobile` = 3 شاشات فقط |
| N-12 | **Offline write/sync queue** | موثّق صراحةً كـ«ميزة غير موجودة عمدًا» في `FINAL_PRODUCTION_READINESS_MATRIX.md` §4 |
| N-13 | **بيئة Demo/Preview منفصلة ببيانات وهمية** | لا أثر — لكن أيضًا **لا `DEMO_MODE` في Production** ✅ (الخطر غير قائم) |
| N-14 | **QR يفتح صفحة عامة آمنة** | QR موجود (`custody_qr_events`, `lib/qr/*`) لكنه داخل البوابة؛ راجع `docs/QR_SECURITY_CONTRACT.md` قبل الحكم |
| N-15 | **صفحة 404 مخصصة** | **لا `not-found.tsx` في `app/`**. `app/error.tsx` موجود (500) + 7 حدود خطأ داخل البوابة |
| N-16 | **`lib/flags.ts`** (المصدر الذي يفترضه v2.0 §G6) | **غير موجود** — الأعلام في 18 جدول `*_settings` + ~20 متغير بيئة (§6) |
| N-17 | **`HSTS`** ضمن ترويسات الأمان | غير مدرج في `next.config.js` رغم شمول بقية الترويسات |
| N-18 | **حزم يفترضها v2.0 وغير مثبَّتة** | `next-intl` · `@vercel/og` · `suncalc` · `@sentry/nextjs` · `playwright` — لا واحدة منها في `package.json` |

---

## 10) حدود هذا الجرد (نزاهة)

1. **لم يُتصل بـProduction.** كل ما يخص التطبيق الفعلي مُصنَّف في الملف المرافق.
2. **لم يُشغَّل `npm test` ولا `npm run build`** — المهمة READ-ONLY. وجود 239 ملف اختبار
   ليس دليلًا على نجاحها اليوم.
3. **لم تُقرأ كل ملفات SQL الـ292 سطرًا سطرًا.** الجرد مبني على استخراج آلي لأسماء
   الجداول والدوال والسياسات + قراءة مركّزة للملفات الحاكمة. أي بند يحتاج يقينًا أعمق
   مُعلَّم صراحةً.
4. **بعض المستندات داخل `docs/` متعارضة أو قديمة** (مثال: ادّعاء «لا شيء مدفوع» بينما
   Git يقول العكس). عند التعارض: **Git والكود يفوزان على المستند.**
