# FEATURE_FLAG_REGISTRY — السجلّ الموحّد للأعلام

> **Wave 0 · V2-0.8-A** (`MASTER_BRIEF_v2.1.md` §2 G6)
> **المصدر الوحيد** لحالة كل علم في المنصة. لا يُنشأ سجلّ ثانٍ.

## لماذا هذا الملف

G6 في v2.0 يفترض `lib/flags.ts`. **الملف غير موجود**، والأعلام تعيش فعليًا في مكانين
مختلفين تمامًا: **18 جدول `*_settings`** في قاعدة البيانات، و**~20 متغيّر بيئة** في
Vercel. إنشاء `lib/flags.ts` كان سيصنع **مصدرًا ثالثًا** — وهو ما يمنعه G13-5 نصًّا.

لذلك v2.1 استبدلت «ملف الأعلام» بـ**سجلّ يوثّق الاثنين القائمين**. لكل علم خمسة حقول
إلزامية: **المالك · الحالة الافتراضية · خطوات التفعيل · خطوات التراجع · تاريخ الإزالة.**

## القواعد

1. الميزات الكبيرة وتغييرات الـworkflow **خلف أعلام**.
2. التغييرات الخطرة **تُفعَّل تدريجيًا**.
3. **إصلاحات الأمان الحرجة لا تبقى معطلة بعد اعتمادها** — تُزال رايتها.
4. Bug fixes المُعيدة للسلوك الصحيح **لا تحتاج دائمًا علمًا**.
5. **أعلام على مستوى الموجة** بدل عشرات الأعلام الصغيرة.
6. 🔒 **المبدأ الثابت: مع إطفاء أعلام الميزات الكبيرة، تجربة الموقع والبوابة الحالية لا تتغيّر.**

---

## أ) أعلام Wave 0 — الجديدة

| العلم | `NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED` |
|---|---|
| **المعرّف** | V2-0.1-A…G |
| **الموقع** | متغيّر بيئة Vercel (يُقرأ عبر `lib/consent.ts` → `consentEnabled()`) |
| **المالك** | خالد |
| **الافتراضي** | **OFF** (غير مضبوط) |
| **الأثر وهو OFF** | النماذج الأربعة **كما هي حرفيًا**: لا checkbox، لا حجب إرسال، لا شقّ موافقة، ونصّ الموافقة الضمنية باقٍ في `Contact.tsx` |
| **الأثر وهو ON** | checkbox إلزامي في النماذج الأربعة · الإرسال محجوب بدونه · تُسجَّل الموافقة ووقتها ونسخة نصّها · يُستبدل نصّ الموافقة الضمنية |
| **⛔ شرط التفعيل** | **تشغيل `docs/consent_capture_EXTENSION_RUNME.sql` أولًا.** بدونه يظهر الـcheckbox وتُلزَم به دون أن تُحفَظ الموافقة (يُسجَّل `PUBLIC_INTAKE_CONSENT_NOT_RECORDED`؛ **الطلب نفسه لا يُفقَد**) |
| **خطوات التفعيل** | ١. شغّل الـRUNME · ٢. شغّل `consent_capture_EXTENSION_POSTCHECK.sql` وتأكّد C-1…C-6 · ٣. Vercel → `NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED=true` · ٤. أعِد النشر · ٥. أرسل من نموذج واحد وتأكّد أن الردّ يحوي `consent_recorded: true` |
| **خطوات التراجع** | اضبطه `false` (أو احذفه) + أعِد النشر. **فوري وبلا SQL.** البيانات المُسجَّلة تبقى |
| **تاريخ الإزالة** | بعد شهر من التفعيل الناجح — يصبح السلوك الافتراضي ويُحذف العلم |

---

## ب) أعلام قائمة في متغيّرات البيئة (لم تُنشئها Wave 0)

> 🔒 **G7 مجمَّد:** لا تُضِف ولا تستبدل ولا تعطّل ولا تغيّر أعلام Zoho وWhatsApp
> والمساعد الذكي. أي توسعة تحتاج Brief منفصلًا معتمدًا. **Wave 0 لم تمسّ أيًّا منها.**

| العلم | الافتراضي | المالك | ملاحظة |
|---|---|---|---|
| `WHATSAPP_SEND_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `WHATSAPP_TEMPLATE_SEND_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `WHATSAPP_START_CONVERSATION_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `WHATSAPP_INTERNAL_ALERTS_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `WHATSAPP_STAFF_ALERTS_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `WHATSAPP_AUTO_QUOTE_LINK_ENABLED` | `false` | خالد | 🔒 مجمَّد · dry-run افتراضيًا |
| `WHATSAPP_EMAIL_ALERTS_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `ZOHO_BOOKS_ESTIMATES_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `ZOHO_BOOKS_ESTIMATE_DRAFT_ONLY` | `true` | خالد | 🔒 مجمَّد — **لا تُطفئه** |
| `ZOHO_BOOKS_SYNC_MODE` | `disabled` | خالد | 🔒 مجمَّد |
| `AI_AGENT_ENABLED` | `false` | خالد | 🔒 مجمَّد |
| `AI_DRAFT_ONLY` | `true` | خالد | 🔒 مجمَّد — **لا تُطفئه** |
| `QUOTE_REQUEST_CUSTOMER_EMAIL_ENABLED` | `false` | خالد | — |
| `QUOTE_REQUEST_CUSTOMER_WHATSAPP_CONFIRM_ENABLED` | `false` | خالد | — |
| `NEXT_PUBLIC_ORG_ADMIN_ROLE_ENABLED` | `false` | خالد | ترحيل الأدوار خامل |
| `NEXT_PUBLIC_COMMS_LEGACY_NOTIFY_ENABLED` | غير مضبوط | خالد | قناة توافق |
| `COMMS_LEGACY_RELAY_ENABLED` / `COMMS_LEGACY_SENDERS_ENABLED` | غير مضبوط | خالد | قناة توافق |
| `NEXT_PUBLIC_WA_DEBUG` | غير مضبوط | مطوّر | تشخيص محلي |

### ⚠️ ثلاثة «أعلام» ليست أعلامًا — بل مفاتيح opt-out تُطفئ عند ضبطها

| المتغيّر | الفخّ |
|---|---|
| `PROJECT_EMAIL_ALERTS_ENABLED` | 🔴 **opt-out**: البريد يُعطَّل فقط حين تساوي القيمة النصّ الحرفي `"false"`. `.env.example` كان يشحن `=false` فأظلم قناة بريد المشاريع كاملة لمن نسخه حرفيًا — وهو عين عطل Batch 9D. **اتركه فارغًا.** (`lib/server/projectNotify.ts:24`) |
| `CUSTODY_EMAIL_ALERTS_ENABLED` | نفس الشكل |
| `HR_EMAIL_ALERTS_ENABLED` | نفس الشكل |

---

## ج) أعلام داخل قاعدة البيانات — 18 جدول إعدادات

> ❌ **لا تُنقل إلى متغيّرات بيئة.** بعضها لكل مستأجر أو لكل مشروع، ونقلها يفقد
> هذا التمييز. السجلّ يوثّقها فقط.

`custody_inventory_settings` · `custody_enterprise_settings` · `custody_rental_settings`
· `crm_settings` · `cs_settings` · `csub_settings` · `sq_settings` · `lsr_settings`
· `tvn_settings` · `vcc_settings` · `ai_settings` · `hr_settings` · `mfa_settings`
· `zoho_books_settings` · `project_finance_settings` · `project_governance_settings`
· `project_hierarchy_settings` · `project_program_settings` · `planning_calendar_settings`
· `whatsapp_staff_alert_settings`

**أمثلة موثَّقة الحالة:**

| العلم | الجدول | الحالة | ملاحظة |
|---|---|---|---|
| `rental_email_queue_enabled` | `custody_inventory_settings` | **OFF مُثبَتة** | الملف يرفض الالتزام إن لم تكن OFF |
| `testimonials_enabled` | (على فرع غير مدموج) | غير منشور | Wave 1 · V2-1.5 |
| `hierarchy_enabled` / `project_hierarchy_enabled` | `project_hierarchy_settings` | — | |
| `client_program_view_enabled` | `project_program_settings` | — | |
| `enforcement_mode` (MFA) | `mfa_settings` | `enrollment` | `enforced` **ليست قيمة مشروعة** في قيد القاعدة |

**نمط التفعيل والتراجع الموحّد:**
```sql
update public.<settings_table> set <flag> = true  where id = 1;   -- تفعيل
update public.<settings_table> set <flag> = false where id = 1;   -- تراجع فوري
```

---

## د) ما ليس علمًا

| البند | السبب |
|---|---|
| **HSTS** (`Strict-Transport-Security`) | إصلاح أمني — القاعدة (٣): لا يبقى خلف علم بعد اعتماده |
| **`lib/observability.ts`** | يعمل بلا ناقل تلقائيًا؛ وجود `SENTRY_DSN` هو المفتاح، لا علم منفصل |
| **`.github/workflows/db-backup.yml`** | تشغيل يدوي (`workflow_dispatch`) — لا يحتاج علمًا |
