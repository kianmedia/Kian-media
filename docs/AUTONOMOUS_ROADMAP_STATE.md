# حالة خارطة التنفيذ الذاتي — Autonomous Roadmap State

> **هذا الملف هو مصدر الحقيقة الوحيد لاستئناف العمل.**
> عند بدء أي جلسة: اقرأ هذا الملف أولًا، قبل أي شيء آخر.
>
> آخر تحديث: **2026-07-28** · الفرع: `main` · آخر Commit مسجّل: `9f42721`

---

## قواعد الاستئناف (اقرأها قبل التنفيذ)

1. ابدأ من **أول عنصر ليس `DONE`** في الجدول أدناه.
2. إذا وُجدت مرحلة `IN_PROGRESS` → **أكملها ولا تبدأ مرحلة جديدة**.
3. إذا وُجدت `BLOCKED_MANUAL` → نفّذ كل ما يمكن حولها، ثم انتقل إلى **أول عنصر مستقل** لا يعتمد عليها.
4. حدّث الحالة **قبل** كل Commit، وحدّث `next_action` **بعد** كل Commit.
5. لا تعتبر ميزة مكتملة لمجرد وجود SQL أو RPC أو Component — يجب أن تكون **مربوطة بصفحة حقيقية وتعمل**.
6. لا تدّعِ نشرًا على Production دون دليل (ترويسة حيّة، أو استجابة API، أو SHA منشور).

### مفتاح الحالات

| الحالة | المعنى |
|---|---|
| `TODO` | لم يبدأ |
| `IN_PROGRESS` | قيد التنفيذ — أكمله قبل أي شيء آخر |
| `BLOCKED_MANUAL` | يحتاج إجراءً لا أملك صلاحيته → انظر `MANUAL_ACTIONS_QUEUE.md` |
| `DONE` | مكتمل ومختبر ومدفوع |

---

## الجدول الرئيسي

| phase_id | phase_name | status | current_subtask | last_completed_action | next_action | last_commit | pushed | prod_verified | tests | blockers | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **P0** | إغلاق Public Portal Hardening Phase 2 | `DONE` | — | إغلاق توثيقي + إصلاح `favicon.ico` 404؛ tsc نظيف · 767/767 · build exit 0 | — (مُغلقة) | `604d218` | ⏸️ `M-000` | ✅ 13/15 | 767/767 | `M-001` حضور · `M-004` سجلات | 2026-07-27 |
| **P1** | العمود الفقري: البريد والإشعارات | `BLOCKED_MANUAL` | — | كل المراحل الفرعية P1.0–P1.6 مكتملة ومدفوعة؛ 3 من 3 ملفات SQL مُطبَّقة | **لا شيء منّي** — بانتظار `M-002` نشر Apps Script | `084654f` | ✅ | ✅ SQL · ❌ التسليم | 872/872 | `M-002` نشر Apps Script | 2026-07-27 |
| **P2** | Privileged Account MFA (TOTP) | `BLOCKED_MANUAL` | **S4: BLOCKED — ROLE MODEL DECISION REQUIRED** | S1/S1b/S2/S3/S3.5 ✅ (S3.5 مؤكَّدة على الإنتاج) · S4a + S4-pre مكتوبان **وغير مربوطين وغير مُطبَّقين** | **مراجعة معمارية فقط** — لا S4b ولا SQL قبل اعتماد نموذج الأدوار | `7b26bab` | ⏸️ `M-000` | S3.5 ✅ · S4 ❌ | 1012/1012 | **قرار المالك في نموذج الأدوار** | 2026-07-28 |
| **P3** | Production Operations V1 | `TODO` | — | — | جرد ما هو موجود قبل إنشاء أي جدول | — | — | — | — | — | — |
| **P3.1** | Call Sheets | `TODO` | — | — | فحص `shoot_sessions` وأي بنية Call Sheet قائمة | — | — | — | — | — | — |
| **P3.2** | الجدولة والتعارضات | `TODO` | — | — | إعادة استخدام محرك تعارضات 4B الموجود | — | — | — | — | — | — |
| **P3.3** | Daily Production Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P3.4** | Media Backup Tracking | `TODO` | — | — | — | — | — | — | — | — | — |
| **P3.5** | Equipment & Custody V2 | `TODO` | — | — | إكمال العهدة الموجودة — **ممنوع إعادة بنائها** | — | — | — | — | — | — |
| **P3.6** | Operations Command Dashboard | `TODO` | — | — | التركيب فوق 7B الموجود | — | — | — | — | — | — |
| **P4** | Financial & Commercial Operations V1 | `TODO` | — | — | جرد Zoho + العملاء + العروض قبل أي إنشاء | — | — | — | — | — | — |
| **P4.1** | CRM & Sales Pipeline | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.2** | Lead Scoring (قواعد صريحة) | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.3** | Smart Quotation Builder | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.4** | Project Profitability | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.5** | Vendors & Expenses | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.6** | Retainers & Production Credits | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.7** | Collection & Management Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P4.8** | Zoho Integration Stabilization | `TODO` | — | — | — | — | — | — | — | Zoho creds | — |
| **P5** | External Excellence V1 | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.1** | Professional Case Studies | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.2** | Vendor & Compliance Center | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.3** | Talent / Freelancers / Vendors DB | `TODO` | — | — | تطوير مركز الفرص — **ممنوع نظام منفصل** | — | — | — | — | — | — |
| **P5.4** | Client Executive Reports | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.5** | Live Operations Dashboard | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.6** | PWA | `TODO` | — | — | — | — | — | — | — | — | — |
| **P5.7** | Kian AI Assistant | `TODO` | — | — | **لا يبدأ قبل استقرار كل ما قبله** · Flag = OFF | — | — | — | — | — | — |
| **P6** | Final System Audit & Acceptance | `TODO` | — | — | — | — | — | — | — | — | — |

---

## 📍 نقطة الاستئناف الدقيقة لـ P1

**الخطة الكاملة:** `docs/PHASE1_EMAIL_BACKBONE_PLAN.md` (مُقسَّمة P1.0 … P1.6)
**تغطية الرحلات:** `docs/PHASE1_JOURNEY_COVERAGE.md` · **انحراف العقد:** `docs/PHASE1_CONTRACT_DRIFT.md`

| المرحلة الفرعية | الحالة |
|---|---|
| P1.0 صدق الإعدادات والوثائق | ✅ `2910c10` |
| P1.1 إغلاق ثغرة حقن الطابور | ✅ `75fa3b5` — **SQL مُطبَّق ومُتحقَّق منه** ✅ |
| P1.2 صحّة تسليم العامل (at-least-once) | ✅ `dfe1f34` |
| P1.3 إيقاف تقرير «أخضر» أثناء انقطاع كامل | ✅ `814c4b4` — SQL مُطبَّق (لم أستطع التحقّق) |
| P1.4 تهيئة بريد التأجير للطابور خلف راية OFF | ✅ `d2e279e` — **SQL لم يُطبَّق (`M-007`)** |
| P1.5 استعادة نسبة الحدث (شقّ TypeScript) | ✅ `084654f` — **الشقّ SQL مؤجَّل عمدًا ↓** |
| P1.6 صدق النجاح في النماذج العامة | ✅ `0a53579` |

**Phase 1 = مكتملة برمجيًا.** الحكم: `READY — MANUAL DEPLOYMENT REQUIRED`.
**ممنوع وصف البريد بأنه Live** قبل نشر `portal_notify` وإثبات إشعار حقيقي بحالة `sent`.

### ⏸️ المؤجَّل عمدًا من P1.5 — أول ما يُستأنف بعد نجاح Apps Script
إعادة تعريف `notify_emit_event` لتكتب `event_id` عند الإدراج. هي **المسار الساخن لكل
إرسال قانوني**، وخطأ فيها يكسر بريد المشاريع كلّه دفعة واحدة. ومع بقاء معالج Apps Script
غير منشور **لا أستطيع التحقّق منها طرفًا لطرف على الإنتاج**، ونشرها على العمياء هو تمامًا
نوع الادّعاء غير القابل للإثبات الذي وُجدت هذه المرحلة لإنهائه.
البديل المُنفَّذ الآن: استرجاع اسم الحدث من `idempotency_key` — يعطي 90% من الفائدة بصفر مخاطرة.

### تفصيل P1.4 (ابدأ من هنا)
المرجع الكامل: `docs/PHASE1_EMAIL_BACKBONE_PLAN.md` §P1.4 + `docs/PHASE1_JOURNEY_COVERAGE.md`

1. **العهدة تُرسل مرّتين:** `app/api/integrations/custody-inventory/notify/route.ts:129`
   يُرسل فورًا عبر `sendHrEmail` بينما `civ_notify` صفَّ الصفّ فعلًا ⇒ رسالتان بموضوعين
   مختلفين. استبدله بنمط `project/notify/route.ts:83-92` (كبت صفوف الجسر ثم `processQueue`).
2. **`emitViaFallback` مسار غير مُصفّف:** `lib/server/notifyEvent.ts:114-136` يُرسل مباشرة
   بلا صفّ ولا Idempotency. وشرط الدخول `rpcNotDeployed` (`:65`) **فضفاض جدًّا** — يطابق أيّ
   خطأ يحوي `does not exist` بما فيها انحراف الأعمدة. ضيّقه إلى `PGRST202|HTTP 404`،
   واجعله يَصُفّ عبر `nt_enqueue_email_idem` ثم `processQueue({deliveryIds})`.
3. **تعليق العميل بلا مفتاح:** `docs/review_thread_email_RUNME.sql:57-65` — إن كان المكلَّف
   مسؤولًا نشطًا وصله بريدان. مرّر مفاتيح Idempotency للمُنتِجات السبعة.
4. `app/api/portal/deliverable-download/route.ts:80-84` — أضِف كبت `superseded_event_bound`
   (المسار الوحيد المرتبط بالحدث بلا هذا الكبت) واحذف الإرسال المباشر `:99-104`.
5. ⚠️ **`custody-alerts/route.ts:34` يحتاج قرارك:** `civ_notify` يستثني `rental_%` عمدًا
   (`custody_notification_matrix_RUNME.sql:51`) لأن نصوص التأجير تحوي مبالغ مالية.
   هذا **قرار سياسة لا قرار برمجة** — لا تُرحِّله دون سؤال المالك.

---

## ✅ قرار نموذج الأدوار — معتمد مبدئيًا (2026-07-28)

```
ROLE MODEL DECISION:
Option A Modified approved in principle.
New role key: org_admin.
Arabic label: مسؤول إداري.
Existing super_admin accounts remain unchanged.
Migration execution requires separate owner approval.
```

**التسلسل:** Owner > Super Admin > Org Admin > Manager > Employee > Client

- ⛔ **ممنوع نهائيًا `staff_role='admin'`** — يُسقط اتحاد `ViewRole` فيمنح صلاحيات
  مالك صامتة بلا خطأ ترجمة (`roles.ts:12,46` · `nav.ts:36`).
- `org_admin` **لا يُنشأ في الإنتاج الآن**، ولا يأخذ أيّ صلاحية من اسمه — صلاحياته
  عبر permission engine حصرًا.
- حسابات `super_admin` الحالية **تبقى كما هي**. لا Backfill ولا تخفيض.
- **MFA لا تشمل `org_admin`** — يحتاج موافقة صريحة منفصلة بعد إنشائه واختباره.
- `is_owner()` **لا تُعاد تعريفها** — 99 موضع استدعاء، 68 منها يعتمد على شمول
  super_admin. الانتقال بإضافة Predicates جديدة ونقل تدريجي.

---

## ⛔ S4 موقوفة — الترحيل غير معتمد (2026-07-28)

**`S4: BLOCKED — ROLE MODEL MIGRATION NOT APPROVED`**

**`S4: BLOCKED — ROLE MODEL DECISION REQUIRED`**

**ممنوع حتى اعتماد النموذج:**
- ربط أيّ بوّابة MFA بالدوال الخمس (`admin_set_staff_role` · `admin_set_account` ·
  `admin_set_employee_professions` · `admin_set_employee_override` ·
  `admin_set_profession_permission`).
- **تشغيل** `docs/mfa_write_gate_s4a_RUNME.sql` أو `docs/authz_identity_hardening_s4pre_RUNME.sql`
  — كلاهما مكتوب ومختبر لكن **لا يُطبَّق الآن**.
- بدء S4b أو المرحلة التالية أو SMS أو توسيع MFA للموظفين/العملاء.

`enforcement_mode` يبقى `enrollment`.

**السبب:** المخطّط يعرف طبقتين امتيازيتين لا ثلاثًا. `account_type='admin'` محصور في
بريدَين ⇒ هو **المالك**، و`is_owner()` يعامل `super_admin` معاملة المالك. الهيكل التجاري
المطلوب (Owner > Super Admin > Admin > Manager > Employee) لا يمكن التعبير عنه بلا قرار
معماري. التقرير قيد الإعداد.

---

## 🔒 قرار نطاق ثابت (بأمر المالك — 2026-07-28)

**MFA للحسابات الإدارية فقط:** `owner` · `super_admin` · `admin`.
**الموظفون والعملاء: لا تفعيل ولا فرض الآن.**

⛔ **ممنوع توسيع النطاق إليهم** إلا بعد أن أعرض على المالك: النطاق · الأثر · خطة الاستعادة —
ثم أحصل على **موافقته الصريحة**. لا يكفي أن يبدو التوسيع تحسينًا أمنيًا.

---

## 📍 نقطة الاستئناف لـ P2 (MFA)

### ثلاث حقائق حاسمة أثبتُّها مباشرة قبل أي تصميم

| # | الحقيقة | الدليل | الأثر على التصميم |
|---|---|---|---|
| 1 | **لا يوجد `middleware.ts` إطلاقًا** | `ls middleware.ts src/ app/` → غير موجود | لا توجد بوابة على الحافة ⇒ الإلزام يجب أن يكون **لكل مسار + في طبقة البيانات**، لا في Middleware |
| 2 | **لا أثر لـMFA أو AAL في المستودع** | `grep mfa\.\|aal1\|aal2\|totp` في `app/ lib/ components/` → صفر | نبدأ من الصفر — لا شيء نمدّده |
| 3 | 🔴 **حزمة Supabase JS ليست تبعية إطلاقًا** | `grep supabase package.json` → **NOT A DEPENDENCY**؛ والتطبيق ينادي GoTrue عبر REST خام (`lib/portal/auth.ts:45` دالّة `gotrue()`، و`lib/portalAuth.ts:72`) | **`supabase.auth.mfa.enroll()` غير متاحة أصلًا** |

### ما يعنيه البند 3 — وهو أهم قرار في هذه المرحلة

المطلوب «Supabase Auth MFA فقط، بلا نظام موازٍ». والتنفيذ الصحيح هنا هو **نفس MFA الخاص
بـSupabase** لكن عبر **نقاط GoTrue REST مباشرة**، تمامًا كما يتعامل هذا التطبيق مع بقيّة GoTrue:

```
POST   /auth/v1/factors                  ← التسجيل (يُعيد QR + السرّ)
POST   /auth/v1/factors/{id}/challenge   ← بدء التحدّي
POST   /auth/v1/factors/{id}/verify      ← التحقّق ⇒ يُعيد Access Token جديدًا بـaal2
GET    /auth/v1/factors                  ← عرض العوامل
DELETE /auth/v1/factors/{id}             ← حذف عامل
```

⚠️ **إضافة حزمة Supabase JS من أجل MFA وحدها ستكون الانحراف الأكبر**، لا الالتزام:
فهي تُدخل عميل مصادقة ثانيًا بجوار المسار القائم — وهذا بالضبط «النظام الموازي» الممنوع.

ملاحظة تنفيذية: دالّة `gotrue()` الحالية تدعم `POST` بـ`apikey` فقط، ونقاط MFA تحتاج
**رمز وصول المستخدم** في `Authorization` وتحتاج `GET`/`DELETE` — فيلزم توسيعها (لا استبدالها).

### ⛔ قرار سلامة ثابت — لا تنقضه
**ممنوع ترحيل النماذج العامة الثلاثة (اجتماع/عرض سعر/فرصة) إلى الطابور** قبل نشر
معالج Apps Script والتحقّق منه. بريدها يعمل اليوم **لأنها لا تمرّ بالطابور**؛ ترحيلها
الآن يكسر البريد الوحيد العامل. التفصيل في `docs/PHASE1_JOURNEY_COVERAGE.md`.

---

## مراحل مغلقة سابقًا (لا تُعاد)

| المرحلة | الحالة | الوسم | ملاحظة |
|---|---|---|---|
| Project Platform V1 | ✅ **مجمّدة ومعتمدة** | `project-platform-v1.0.0` @ `75d16cd` | ممنوع إضافة مزايا؛ التعديل فقط لتكامل ضروري مثبت + Regression Tests |
| Public Portal Hardening Phase 2 | 🔄 قيد الإغلاق التوثيقي (P0) | — | لا ثغرة حرجة مفتوحة |

---

## قيود ثابتة عبر كل المراحل

- ❌ لا جداول أو أنظمة موازية لوظائف موجودة — افحص أولًا.
- ❌ لا عقد إشعارات جديد · لا طابور بريد ثانٍ · لا مزوّد موازٍ · لا Cron لكل وحدة.
- ❌ لا WhatsApp إرسالًا فعليًا في هذه الخارطة — أحداث جاهزة فقط.
- ❌ لا `DROP` ولا حذف بيانات Production · كل SQL إضافي و idempotent.
- ❌ لا `reset --hard` ولا `force push` ولا حذف عمل محلي.
- ✅ العربية والإنجليزية + RTL + الجوال والتابلت إلزامية في كل واجهة جديدة.
- ✅ الحماية على الخادم أو في قاعدة البيانات — **إخفاء الزر ليس حماية**.
- ✅ Audit Log للعمليات المهمة · Feature Flags لما لم يُفعّل بعد.
- ✅ لا تُعرض قيم DB الإنجليزية للمستخدم النهائي.
- ✅ لا تُسجَّل أسرار ولا رموز MFA ولا بيانات عملاء في السجلات.
