# DATABASE_APPLICATION_STATUS — حالة تطبيق SQL على Production

> **الحالة:** مُنتَج ضمن مهمة `MASTER_ORDER_FINAL.md` (READ-ONLY audit).
> **الفرع:** `docs/v2_1-audit` · **HEAD:** `7b92391` (2026-08-02)
>
> ## ⛔ القاعدة الحاكمة لهذا الملف
> **وجود الملف في المستودع ليس دليلًا على تطبيقه على Production.**
> لم يُتصل بقاعدة Production أثناء إنتاج هذا المستند، ولم يُنفَّذ أي SQL، ولم يُشغَّل
> أي فحص حيّ. كل ما دون ذلك هو **استدلال من المستندات فقط**.

---

## 0) الحقيقة البنيوية: لا يوجد سجل تطبيق

| الحقيقة | الدليل |
|---|---|
| `supabase/migrations/` **فارغ** (0 ملف) | `ls supabase/migrations` |
| لا `schema_migrations` ولا جدول تتبّع تطبيق | لا إشارة في أي RUNME |
| كل تغيير قاعدة بيانات = ملف `*_RUNME.sql` يدوي في `docs/` | 292 ملف SQL |
| لا CI يطبّق SQL | `vercel.json` يبني Next فقط؛ لا خطوة SQL |

**النتيجة:** لا توجد أي وسيلة داخل المستودع لمعرفة ما طُبِّق. الحالة الافتراضية الصادقة
لكل ملف هي `APPLICATION STATUS REQUIRES KHALED CONFIRMATION`.

**التخفيف الوحيد المتاح لخالد:** كل حزمة كبيرة تملك ملف `*_POSTCHECK.sql`
**للقراءة فقط** يعيد مجموعة نتائج واحدة. تشغيل الـPOSTCHECK وحده — بلا RUNME —
هو الطريقة الآمنة لإثبات الحالة الفعلية. **لم أشغّل أيًّا منها (READ-ONLY).**

---

## 1) طريقة الإثبات الصحيحة (تجنّب خطأ تشخيصي مكلف)

مأخوذة حرفيًا من `lib/portal/pgerror.ts` — وهو ملف كُتب بعد ضياع دورة تصحيح إنتاج كاملة:

| الرمز | معناه الحقيقي | ما **لا** يعنيه |
|---|---|---|
| `42501` | الكائن **موجود** والصلاحية مرفوضة | ليس «غير مطبّق» — بل **دليل وجود** |
| `PGRST202` / `42883` | الدالّة **غائبة** فعلًا | — |
| `42P01` | الجدول **غائب** فعلًا | — |
| `42703` | عمود في **طلبنا نحن** غير موجود | ❌ **ليس** «الترحيلة غير مطبّقة» — هذا الخلط بالذات كلّف دورة إنتاج |
| `PGRST204/205` | ذاكرة مخطط PostgREST قديمة | ليس نقص ترحيل — الحل «Reload schema» |
| `23P01` | تعارض حجز | ليس نقصًا ولا عطلًا |
| 0 صفوف | **ليس خطأ** — غالبًا RLS تجيب صحيحًا | — |

> ⚠️ **تحذير من ملاحظة سابقة موثّقة:** استدعاء دالّة **بلا معاملات** وتلقّي `PGRST202`
> **لا يثبت شيئًا** — قد تكون الدالّة موجودة بتوقيع مختلف. الإثبات الصحيح يكون
> بالتوقيع الكامل عبر `to_regprocedure(...)` داخل POSTCHECK.

---

## 2) الأدلة الوحيدة المؤرَّخة على تطبيق فعلي

المصدر: `docs/MANUAL_ACTIONS_QUEUE.md` (آخر تحديث 2026-07-27).

| الملف | التاريخ | الدليل المُسجَّل | تقييمي |
|---|---|---|---|
| `docs/public_portal_rate_limit_RUNME.sql` | 2026-07-27 | `public_rate_limits` و`rl_consume` يردّان `42501` | **مقبول** — 42501 = دليل وجود |
| 4 ملفات تقوية صلاحيات منصة المشاريع | 2026-07-26 | «التسريب مُغلق؛ مسح 372 دالة نظيف» | **مقبول** لكن الملفات الأربعة **غير مُسمّاة** ⇒ يحتاج تأكيد أسماء |
| `docs/email_backbone_phase1_enqueue_RUNME.sql` | 2026-07-27 | `nt_enqueue_email_idem` موجودة ⇒ المعاملة التزمت | **مقبول** |
| `docs/email_backbone_phase1_monitor_RUNME.sql` | 2026-07-27 | ⚠️ **«لم أستطع التحقّق — لا كائن جديد يمكن قياسه»** | **غير مُثبَت** — طُبِّق بلا دليل |
| `docs/email_backbone_phase1_rental_RUNME.sql` | 2026-07-27 | الدوال الثلاث تردّ `42501` + الراية OFF | **مقبول** |
| Push + Deploy لـPhase 2 | 2026-07-27 | ترويسات HTTP جديدة حيّة على Production | **مقبول** (كود لا SQL) |

**هذه هي كل الأدلة المؤرَّخة الموجودة. 6 بنود من أصل 292 ملف SQL.**

---

## 3) التعارض المركزي الذي يجب أن يحسمه خالد

| المصدر | ما يقوله | التاريخ |
|---|---|---|
| `docs/FINAL_PRODUCTION_READINESS_MATRIX.md` §3 | **«P0 — No SQL has been applied»** لكل الحزم الـ15 الكبيرة · «**No SQL was executed. Nothing was committed, pushed or deployed.**» | نهاية برنامج سابق |
| Git الفعلي اليوم | `main` **متطابق مع `origin/main`**، وكل ملفات تلك الحزم **مُلتزَمة ومدفوعة** | 2026-08-02 |
| ملاحظات تشغيلية سابقة | «كل جداول المشاريع الـ76 وRPCs الرئيسية **موجودة** على Production» | غير مؤرَّخة في المستودع |

**التحليل:** الجملة «nothing was committed or pushed» **مُفنَّدة قطعًا** بحالة Git الحالية
⇒ المستند **لقطة نهاية جلسة تجاوزها الزمن**. لكن **تفنيد جزء من المستند لا يفنّد
الجزء الآخر**: كون الكود دُفِع لا يثبت أن SQL شُغِّل، لأنهما مساران يدويان منفصلان
تمامًا في هذا المشروع.

⇒ **`BLOCKED BY PRODUCTION CONFIRMATION`** — لا أخمّن. سؤال Gate A إلزامي.

---

## 4) جدول الحالة — الحزم الكبيرة (15 وحدة)

**مفتاح الأعمدة:** *In repo* = الملف موجود · *Committed* = داخل `main` ·
*Merged* = مدموج في `main` · *Prod* = تطبيق مؤكَّد على Production ·
*Reapply risk* = خطر إعادة التشغيل.

> **ملاحظة عامة موثَّقة في `FINAL_PRODUCTION_READINESS_MATRIX.md`:** كل `RUNME`
> **transactional وidempotent، بلا `CONCURRENTLY`، ويحمل فحصًا ذاتيًا ساكنًا**، وكل
> `POSTCHECK` **للقراءة فقط**. لهذا خطر إعادة التشغيل **منخفض بنيويًا** — لكنه
> **غير مُختبَر حيًا** من طرفي.

| # | الحزمة | الملفات | In repo | Committed | Merged | **Prod** | Reapply risk | كود يعتمد عليها |
|---|---|---|---|---|---|---|---|---|
| 1 | Communications hub | RUNME(2539) · PREFLIGHT · POSTCHECK · ROLLBACK · AFTER_FAILURE_VERIFY | ✅ | ✅ | ✅ | ❓ **REQUIRES KHALED CONFIRMATION** | منخفض (idempotent) | `lib/server/commsHub.ts` · `/api/comms/*` |
| 2 | Operations center (prodops) | RUNME(2912) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/operations.ts` |
| 3 | CRM / sales foundation | RUNME(3977) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/crm.ts` |
| 4 | Lead scoring & routing | RUNME(3267) + security patch(4) | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/leads.ts` |
| 5 | Smart quoting | RUNME(2964) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/quoting.ts` |
| 6 | Commercial subscriptions | RUNME(4078) · PRE · POST · ROLL · AFV | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/commercial.ts` |
| 7 | Finance & profitability | RUNME(3805) · PRE · POST · ROLL · AFV | ✅ | ✅ | ✅ | ❓ | **متوسط** — يمسّ المال | `lib/portal/finance.ts` |
| 8 | Asset intelligence (custody) | RUNME(2143) · PRE · POST · ROLL + security patch(4) | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/assetIntelligence.ts` |
| 9 | Talent & vendor network | RUNME(2358) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/talentNetwork.ts` |
| 10 | Vendor compliance center | RUNME(3325) · PRE · POST · ROLL · AFV | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/compliance.ts` |
| 11 | Case studies platform | RUNME(3054) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/server/publicCaseStudies.ts` — **يخدم الموقع العام** |
| 12 | Live operations dashboard | RUNME(2314) · PRE · POST · ROLL + acl_repair(3) | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/liveOps.ts` |
| 13 | Kian AI assistant | RUNME(2214) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/aiAssistant.ts` |
| 14 | PWA V1 | **لا SQL إطلاقًا** | — | ✅ | ✅ | لا ينطبق | — | `lib/pwa/*` |
| 15 | Executive reporting ★ **آخر واحدة** | RUNME(1674) · PRE · POST · ROLL | ✅ | ✅ | ✅ | ❓ | منخفض | `lib/portal/executive.ts` |

**ترتيب التطبيق الملزم** (من `FINAL_PRODUCTION_READINESS_MATRIX.md` §2 — لا يُغيَّر):

```
1 communications_hub → 2 operations_center → 3 crm_sales_FOUNDATION →
4 lead_scoring_routing → 5 smart_quoting → 6 commercial_subscriptions →
7 finance_profitability → 8 asset_intelligence → 9 talent_vendor_network →
10 vendor_compliance_center → 11 case_studies_platform →
12 live_operations_dashboard (اختياري لـ15) → 13 kian_ai_assistant (اختياري لـ15) →
14 (PWA — لا SQL) → 15 executive_reporting ★ آخر واحدة إلزاميًا ★
```

⚠️ **تحذير موثَّق قبل التشغيل:** `communications_hub` PREFLIGHT §8 يطبع إشعار
`AUTHENTICATED DEPENDENCY`. الحالة `held ONLY VIA PUBLIC` تسمّي جدولًا — الـRUNME
يعالجها، **لكن يجب على المشغّل أن يقرأ الإشعار قبل التشغيل**.

---

## 5) حزم منصة المشاريع (Project Platform) — حالة مختلفة

هذه الحزم أقدم وسبق أن صدر لها قبول رسمي (وسم `project-platform-v1.0.0`)، والملاحظات
السابقة تشير إلى أن جداولها **موجودة فعلًا** على Production. لكن **لا يوجد داخل
المستودع دليل مؤرَّخ يثبت ذلك لكل ملف على حدة.**

| المجموعة | الملفات (عيّنة) | Prod |
|---|---|---|
| Project Core الأساسي | `project_core_FINAL_RUNME` · `_ABSOLUTE_FINAL_RUNME` · `_UI_COMPLETION_RUNME` · `_FINAL_COMPLETION_RUNME` · `_REMAINING_MODULES_FINAL_RUNME` · `_OPERATIONAL_CLOSURE_FINAL_RUNME` · `_FINANCE_RUNME` | ❓ مُرجَّح مطبَّق — **يحتاج تأكيد لكل ملف** |
| Snapshot & Progress | `project_operational_snapshot_RUNME` · `project_progress_RUNME` · `project_core_progress_engine_FIX_RUNME` · `project_stage_sync_RUNME` | ❓ مُرجَّح مطبَّق (الواجهة تستدعيه فعليًا) |
| Tasks 3A/3B/3C | 3 ملفات | ❓ |
| Planning 4A | `RUNME` + `hotfix` + `runtime_hotfix` + **`final_fix`** | ❓ ⚠️ **حساس: 4 ملفات متتابعة — الترتيب حرج** |
| Resources 4B/4C | 2 ملف | ❓ |
| Governance 5A/5B/5C | 3 ملفات كبيرة | ❓ **ترتيب ملزم 5A→5B→5C** |
| Hierarchy | `schema` · `security` · `batch6a` · `batch6b` | ❓ ⚠️ **تعارض موثَّق: هل `schema` مطبَّق؟ الملاحظات السابقة تناقض نفسها** |
| Closure 6C | `project_closure_batch6c` | ❓ |
| Templates 7A · Operations 7B | 2 | ❓ |
| Programs 8A/8B · Fastlane 8C · SLA 8D | 4 | ❓ |
| UX 9A/9B · Notifications 9C/9D · Batch 10 | 6 | ❓ |
| Stabilization + Acceptance | `project_platform_stabilization_RUNME` · `final_platform_acceptance_{RUNME,PRE,POST}` | ❓ |
| **الأمن (authz)** | `authz_fix{A,B,C,D}_*_RUNME` + ROLLBACKs · `authz_identity_hardening_s4pre_RUNME` · `project_platform_authz_hardening{,2}_RUNME` | ❓ ⚠️ **الأخطر — انظر §7** |

---

## 6) حزم مطبَّقة بدليل ذاتي داخل الملف (self-refusing)

نمط معماري ممتاز في هذا المستودع: بعض الملفات **ترفض الالتزام إن لم يتحقق شرطها**.
هذا يجعل «نجح التشغيل» دليلًا على الحالة النهائية:

| الملف | الشرط الذاتي |
|---|---|
| `email_backbone_phase1_enqueue_RUNME.sql` | يرفض الالتزام إن لم تُغلق ثغرة `nt_enqueue_email` فعلًا |
| `email_backbone_phase1_monitor_RUNME.sql` | يرفض الالتزام إن وُجدت صيغة ثانية للدالّة |
| `email_backbone_phase1_rental_RUNME.sql` | **يرفض الالتزام إن لم تكن الراية OFF** |
| `project_core_financials_phaseB_lockdown_RUNME.sql` | يرفض التشغيل إن لم تكن Phase A موجودة (`pc_project_financials`) |
| `asset_intelligence_PREFLIGHT.sql` | يرفض إن كان `prodops` **نصف مطبَّق** (`ops_job_equipment` موجود و`prodops_asset_clash` غائب أو العكس) |
| `asset_intelligence_RUNME.sql` | يتحقق أن حارس الحجز يرفع `23P01` وإلا يفشل (`:1984`) |

---

## 7) 🔴 البنود الأمنية — أعلى أولوية للتأكيد

| البند | الملف | لماذا حرج | الحالة |
|---|---|---|---|
| **NULL-collapse في بوابات SECURITY DEFINER** — مفتاح anon قرأ بيانات شركة حقيقية | `authz_fixC_null_failopen_gates_RUNME.sql` | تسريب بيانات فعلي موثَّق | ❓ **يجب تأكيده أولًا قبل أي شيء آخر** |
| كتابة مباشرة على `profiles` | `authz_fixD_profiles_direct_write_RUNME.sql` | تصعيد صلاحيات | ❓ |
| هوية/صلاحيات | `authz_fixB_identity_permissions_RUNME.sql` | — | ❓ |
| منح super_admin | `authz_fixA_super_admin_grant_RUNME.sql` | — | ❓ |
| `nt_enqueue_email` مفتوحة لـ`authenticated` | `email_backbone_phase1_enqueue_RUNME.sql` | أي مسجَّل يرسل بريدًا **من هوية كيان** | ✅ **مطبَّق 2026-07-27 بدليل** |
| Rate limiting للمسارات العامة | `public_portal_rate_limit_RUNME.sql` | — | ✅ **مطبَّق 2026-07-27 بدليل** |
| تقوية صلاحيات منصة المشاريع | **4 ملفات غير مُسمّاة** | التسريب مُغلق حسب المستند | ✅ مطبَّق 2026-07-26 — ⚠️ **الأسماء مفقودة** |
| بوابة تنفيذ عامة | `authz_public_execute_guard` (اختبار موجود) | `can_manage_quotes` / `can_see_invoices` / `can_see_opportunities` **يملك `anon` تنفيذها عمدًا** لعدم كسر المسار العام | ⚠️ **`M-012` لم يُختبر حيًا بعد** — مسجَّل `MANUAL TEST PENDING` |

> **ملاحظة تعارض تحتاج حسمًا:** ملاحظة سابقة تقول إن إصلاح حادثة NULL-collapse
> **لم يُطبَّق على Production**. `MANUAL_ACTIONS_QUEUE.md` يقول إن «تقوية صلاحيات منصة
> المشاريع (4 ملفات)» طُبِّقت 2026-07-26 و«التسريب مُغلق». **هل الأربعة هي
> `authz_fixA..D`؟** إن كانت نعم فالحادثة مغلقة؛ إن لا فهي مفتوحة. — **سؤال Gate A
> رقم واحد بالأولوية.**

---

## 8) المالية Phase A / Phase B — ترتيب نشر ملزم

| | Phase A | Phase B |
|---|---|---|
| الملف | `project_core_financials_phaseA_RUNME.sql` (66 سطرًا) | `project_core_financials_phaseB_lockdown_RUNME.sql` (62 سطرًا) |
| ما يفعله | **يضيف فقط** الدالّة `pc_project_financials()` — لا يغيّر أي grant | **يسحب** `SELECT` على `project_core` ويعيد منحه للأعمدة غير المالية فقط |
| متوافق مع الواجهة القديمة؟ | ✅ نعم (`select=*` يظل يعمل) | ❌ **لا** |
| الخطر إن شُغِّل مبكرًا | لا خطر | 🔴 **`select=*` يتوسع لأعمدة غير ممنوحة ⇒ `permission denied for column` ⇒ صفحات project-core تنكسر للجميع بمن فيهم المدير والمالية** |
| الشرط الذاتي | — | يرفض التشغيل إن غابت `pc_project_financials` |
| **الحالة** | ❓ ملاحظات سابقة تقول «مطبَّقة» — **يحتاج تحقّقًا** | ❓ **غير مؤكَّدة — سؤال Gate A صريح** |

**الأثر على v2.1:** ما دامت Phase B غير مؤكدة، فإن أعمدة `budget_amount` /
`estimated_cost` / `actual_cost` **قد تكون مقروءة مباشرة عبر PostgREST** لأي
`authenticated`. أي بند مالي في v2.1 يجب أن يفترض هذا الاحتمال حتى يُنفى.

---

## 9) ملفات تحتاج انتباهًا خاصًا

### 9.1 سلاسل الإصلاحات المتتابعة (الترتيب حرج)
| السلسلة | الملفات بالترتيب | ملاحظة |
|---|---|---|
| Planning 4A | `RUNME` → `hotfix` → `runtime_hotfix` → **`final_fix`** | الملاحظات السابقة تقول إن الـhotfix **لم يكفِ** وإن `final_fix` (محرك V2 بمصفوفات في الذاكرة بلا جداول مؤقتة) هو الإصلاح الحقيقي. **تشغيل الأول بلا الأخير يترك محركًا معطوبًا.** |
| Rental | `rental_v1_final_production` → `rental_insurance_production` → 10 hotfixes → `rental_closeout_FINAL` | ترتيب طويل وهش |
| Custody enterprise | `custody_enterprise_00..07_PATCH` | ترقيم صريح — يُتبع حرفيًا (انظر `docs/CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md`) |
| Custody inventory | `portal_custody_inventory_system_v1` → 5 PATCHes | انظر `docs/CUSTODY_ASSET_PHOTOS_AND_DELETE_SQL_RUN_ORDER.md` |
| Notifications | `batch9c` → `batch9d` → `batch10 core` → `batch10 projects` → `batch10 custody_rental` | |
| Governance | `5a` → `5b` → `5c` | ملزم |

### 9.2 ملفات **ليست** للتشغيل
| الملف | النوع |
|---|---|
| `docs/MANUAL_ACTIONS_QUEUE.md` | 📄 **Markdown** — يحمل تحذيرًا صريحًا في رأسه: نسخه لمحرر SQL يرفع `42601` |
| `*_PROPOSAL.sql` (7 ملفات) | مقترحات لم تُعتمد: `client_project_linking` · `phase1_admin_controls_addendum` · `phase1_consent_addendum` · `phase1_project_stages` · `phase1_s4_db_addendum` · `staff_roles_task_assignment` · `zoho_books_portal_integration` |
| `*_DIAGNOSTIC*.sql` (6) | تشخيص — بعضها له ملف `CLEANUP` مرافق |
| `*_PREVIEW.sql` | `rental_insurance_fixtures_PREVIEW.sql` — **بيانات وهمية، ممنوع على Production** |
| `*_ROLLBACK.sql` (24) | للتراجع فقط |
| `*_POSTCHECK.sql` (25) | **قراءة فقط — آمنة، وهي أداة الإثبات الموصى بها** |
| `*_AFTER_FAILURE_VERIFY.sql` (8) | بعد فشل تشغيل |

### 9.3 جداول نسخ احتياطي داخل SQL (أثر تشغيل سابق)
وجود هذه الجداول في ملفات RUNME يعني أن الحزم صُمِّمت لأخذ نسخة قبل التعديل. أسماؤها
تحمل تواريخ: `fin_backup_*_20260730` (8 جداول) · `ops_backup_*_20260730` (4) ·
`cs_backup_yyyymmdd` · `_bak_lsr_*` (6) · `_bak_tvn_*` (7) · `_bak_custody_vendor_link` ·
`project_authz_fn_backup` · `project_transition_requests_archive`.

> 🔎 **دليل غير مباشر قوي:** وجود `fin_backup_*_20260730` و`ops_backup_*_20260730`
> **داخل نص RUNME** يعني أن الملف *يُنشئها عند التشغيل*. **إن وُجدت هذه الجداول فعلًا
> على Production فذلك دليل مباشر على أن الحزمتين المالية والتشغيلية شُغِّلتا.**
> **هذا أسرع فحص إثبات ممكن** — استعلام واحد للقراءة:
> ```sql
> select table_name from information_schema.tables
> where table_schema='public' and table_name like '%backup%' or table_name like '\_bak\_%';
> ```
> (لم أشغّله — READ-ONLY.)

---

## 10) خلاصة الجدول العام

| التصنيف | العدد | النسبة |
|---|---|---|
| ملفات SQL في `docs/` | **292** | 100% |
| منها `*_RUNME.sql` (قابلة للتشغيل) | **~166** | 57% |
| منها `POSTCHECK` / `PREFLIGHT` / `ROLLBACK` / `VERIFY` / `DIAGNOSTIC` (غير تعديلية أو مساندة) | **~119** | 41% |
| منها `PROPOSAL` / `PREVIEW` (ممنوعة على Production) | **8** | 3% |
| **مطبَّقة على Production بدليل مؤرَّخ صريح** | **5** | **1.7%** |
| مطبَّقة بادّعاء بلا أسماء ملفات | 4 | 1.4% |
| **`APPLICATION STATUS REQUIRES KHALED CONFIRMATION`** | **~157** | **~95% من ملفات RUNME** |

---

## 11) الإجراء الموصى به لخالد (لا يُنفَّذ في هذه المهمة)

**لا تشغّل أي `RUNME`.** الخطوة الأولى الصحيحة هي **إثبات الحالة بالقراءة فقط**:

1. شغّل استعلام جداول النسخ الاحتياطي في §9.3 — أسرع دليل قاطع.
2. شغّل `*_POSTCHECK.sql` للحزم الـ15 بالترتيب. كلها للقراءة فقط وتعيد مجموعة نتائج واحدة.
3. أرسل النتائج. عندها فقط تتحول ~157 خانة `❓` إلى `✅` أو `❌` حقيقية.
4. أجب على أسئلة Gate A الثلاثة في §7 و§8:
   - هل «الملفات الأربعة» المطبَّقة 2026-07-26 هي `authz_fixA..D`؟
   - هل Phase B المالية مطبَّقة؟
   - نتيجة الاختبار اليدوي `M-012` (المسار العام بعد Fix C)؟

**قبل هذه الخطوات، أي تخطيط لـWave تنفيذية يُبنى على أرض مجهولة.**
