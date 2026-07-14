# Kian Operations Platform V1 — Master Plan

> برنامج تحويل موقع كيان من موقع تعريفي إلى منصة تشغيل مؤسسية. هذا المستند هو مصدر
> الحقيقة لحالة كل مرحلة. يُحدَّث أثناء العمل. **الحالات:** `not_started` · `in_progress`
> · `code_complete` · `test_complete` · `preview_ready` · `blocked` · `complete`.

## 0) واقع التنفيذ (اقرأه أولًا)
- **البيئة الحالية لا تسمح بالبناء/الاختبار/النشر:** لا `node`/`npm`، لا مفاتيح Supabase،
  ولا مصادقة Git push. لذلك: كل الكود يُكتب ويُراجَع ساكنًا + عدائيًا، والتطبيق والدفع
  والتحقق **خطوات يدوية من صاحب الحساب**. لا يمكنني ادّعاء «مكتمل على Production».
- **القرار المعماري (ADR-0001):** المنصة برنامج متعدد الجلسات. تُبنى مرحلةً مرحلة، كل
  مرحلة: schema+RLS+RPC/API+واجهة فعلية+حالات Loading/Empty/Error+صلاحيات+Audit+
  إشعارات+اختبارات+Feature Flag+commit مستقل. **لا تُبنى 20 وحدة دفعة واحدة بلا تحقق**
  (يكسر build ويخالف شرط «بلا أخطاء»). الجودة قبل الكمّ.
- **الفرع:** `feature/kian-operations-platform-v1` (يُفرَّع من HEAD الحالي الذي يحوي عمل
  التأجير، لأن التأجير غير مدموج في main بعد — انظر BLOCKERS). لا يُدمج إلى main قبل
  المراجعة النهائية.

## 1) المراحل والاعتماديات والحالة
| # | المرحلة | يعتمد على | Flag | الحالة |
|---|---------|-----------|------|--------|
| 0 | إصلاحات التأجير الحية (رفع الأدلة signed-upload + توقيع العقد + دورة الإرجاع) | — | `rental_*` | **code_complete** (commits ddb4f78→beccc2a؛ غير مدفوع/مطبّق) |
| SS | الخدمات المركزية المشتركة (RBAC/Audit/Notifications/Events/Approvals/Files/Docs/Numbering/Scheduler/Outbox) | مراجعة الموجود | — | `not_started` (كثير منها موجود جزئيًا — يُوحَّد لا يُعاد بناؤه) |
| 1 | **Testimonials** (آراء العملاء في الرئيسية + SSR stats) — أول قيمة مرئية | SS(Audit/Files/Approvals جزئي) | `testimonials_enabled` | `in_progress` |
| 2A | Project Core (نواة المشاريع الموحدة) | SS | `project_operations_enabled` | `not_started` |
| 2B | غرفة المشروع للعميل | 2A | `client_project_room_enabled` | `not_started` |
| 2C | لوحة التشغيل الداخلية | 2A | — | `not_started` |
| 3 | ما قبل الإنتاج (Versioned approval) | 2A, Approvals | — | `not_started` |
| 4 | المراجعة والمعاينات (Media review) | Files, Media adapter | — | `not_started` |
| 5 | Change Requests | 2A, Approvals, Numbering | — | `not_started` |
| 6 | التشغيل الميداني (Call Sheets/Daily Reports/Backups) | 2A, Notifications | — | `not_started` |
| 7 | ربط المعدات بالمشاريع + الصيانة | Asset system (موجود), 2A | — | `not_started` |
| 8 | ربحية المشروع (Rate cards, Finance-only) | 2A, Finance RLS | — | `not_started` |
| 9 | الاشتراكات والرصيد الإنتاجي | 2A | — | `not_started` |
| 10 | أداة عرض السعر الذكية + Lead scoring | CRM/Zoho (موجود) | — | `not_started` |
| 11 | قاعدة المواهب والموردين | Opportunities (موجود) | — | `not_started` |
| 12 | دراسات الحالة | 2A, Files | — | `not_started` |
| 13 | Vendor & Compliance Center | Files, Docs, Approvals | — | `not_started` |
| 14 | Kian Live Operations Dashboard | 2A | — | `not_started` |
| 15 | مساعد كيان الذكي (governed) | كل ما سبق (RAG معتمد) | `kian_ai_assistant_enabled` | `not_started` |
| 16 | تحسينات الموقع العام (SEO/A11y/CWV/CSP) | — | — | `not_started` |
| 17 | PWA readiness للوحدات الميدانية | 6 | — | `not_started` |

## 2) الخدمات المركزية — جرد الموجود (لا يُعاد بناؤه)
- **RBAC:** `profiles.account_type` + `staff_role` + دوال `civ_can_manage/civ_can_finance/civ_can_admin/is_staff/is_admin`. **يُوسَّع** بأدوار المنصة (project_manager/production_manager/director/…) عبر جدول أدوار/صلاحيات، لا استبدال.
- **Audit:** `custody_audit` + جداول audit في HR/custody. **يُوحَّد** في سجل مركزي `platform_audit_log` يستدعيه الجميع.
- **Notifications:** جدول `notifications` + `civ_notify`/`civ_notify_managers` + `/api/integrations/*/notify` (بريد Apps Script + n8n). **يُوسَّع** (outbox/templates/prefs/delivery status)، لا نظام ثانٍ.
- **Files/Storage:** buckets متعددة + `custody_inventory_asset_files` + rental evidence. **يُوحَّد** في File Registry مركزي (owner/purpose/version/checksum/policy).
- **Numbering:** `civ_gen_no(prefix)`. يُعاد استخدامه للمشاريع/العقود/الفواتير/إلخ.
- **Scheduler:** Vercel Cron يومي `/api/cron/custody-alerts` + n8n. **لا** background jobs إضافية على Hobby — الجدولة عبر هذين فقط.
- **Integration Outbox:** أنماط `/api/integrations/*` (Zoho/Email/WhatsApp/n8n) موجودة — تُوحَّد في outbox لا يوقف العملية الأساسية.

## 3) المخاطر
- **R1 (حرج):** حلقة النشر معطّلة (لا push/SQL/env من بيئتي) → لا شيء يُتحقَّق منه حيًا. تُغلَق بخطوات صاحب الحساب.
- **R2:** بناء بلا CI يزيد خطر أخطاء build. تخفيف: مراجعة ساكنة + عدائية لكل مرحلة، وCI بعد الدفع بوابة إلزامية.
- **R3:** بناء 20 وحدة بلا تحقق = دين تقني هائل. تخفيف: مرحلة-مرحلة + flags + commits مستقلة.
- **R4:** تعارض الأصول بين مشاريع/تأجير/عهدة/صيانة. تخفيف: قفل مركزي عند مرحلة 7.

## 4) الخطوات اليدوية المطلوبة من صاحب الحساب (مجمّعة)
1. **Push** الفرع (GitHub Desktop) — لا مصادقة Git في بيئتي.
2. **env على Vercel:** `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL` (لمسارات الرفع الموقّع).
3. **SQL:** تشغيل RUNME على القاعدة (التأجير: `rental_insurance_production_RUNME.sql` ثم `rental_v1_final_production_RUNME.sql`؛ المنصة: ملفات `kian_*_RUNME.sql` عند جاهزيتها). **Backup/Snapshot أولًا.**
4. تفعيل flags على Preview فقط للاختبار.
