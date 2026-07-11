# Custody Enterprise Suite — Implementation Plan

> نطاق ضخم (≈ منصّة مؤسسية كاملة). يُنفَّذ على مراحل مستقلة، كل مرحلة: SQL patch مستقل
> idempotent + RPCs + RLS + lib + UI خلف feature flag + مراجعة عدائية + commit مستقل.
> الفرع: `feature/custody-enterprise-suite` (من main بعد Custody v1 + Self-Service).

## قيود بيئة التنفيذ (حقيقية — تُذكر في كل تقرير، لا تُخفى)
- **لا يوجد `node`/`npm`** في هذه البيئة → **لا يمكن تشغيل** `lint`/`typecheck`/`build`/web tests/mobile/Expo/`expo doctor`. تُبنى الملفات وتُفحَص ساكنًا (توازن lexer، مطابقة وسائط RPC، مراجعة عدائية) فقط. لا يُدّعى نجاح أي منها.
- **لا مفتاح service-role ولا `psql`/`supabase` CLI** → لا يُشغَّل SQL ولا Validation فعليًا هنا؛ تُجهَّز الملفات بترتيب دقيق.
- **`git push` محظور** (لا مصادقة GitHub غير تفاعلية) → الدفع يدويًا من المستخدم.
- بلا `npm install`: **لا حزم جديدة**. QR/Barcode = مولّد pure-TS مضمّن (vendored). PWA offline = service worker + IndexedDB يدوي. Mobile = سكافولد Expo (لا يُبنى هنا).
- **Monorepo:** لا تحويل (خطر على الإنتاج بلا build). الويب يبقى في الجذر؛ الجوال مستقل في `apps/mobile/`.

## المبادئ الملزمة (كل مرحلة)
soft delete فقط · audit log · SECURITY DEFINER RPCs · RLS على كل جدول · private buckets + signed URLs · Transaction + `SELECT FOR UPDATE` بترتيب asset_id · idempotent patches · feature flags · لا service_role في الواجهة · عدم الوثوق بأي id/كمية من العميل. **لا يُعدَّل** أي SQL مطبّق، ولا نظام العهدة اليدوية/التأجير القديم/Zoho/الفوترة/العروض/الفرص/HR/الحضور/المشاريع/Apps Script/WhatsApp/n8n/بوابة العميل.

## Feature Flags (§2) — جدول `custody_enterprise_settings` (سطر واحد id=1)
كل وحدة كبيرة خلف علم. الافتراضات: التشغيلية الآمنة = مفعّلة؛ GPS/التكاملات/التأجير العام/Zoho = **معطّلة** حتى اكتمال الإعداد.
`qr_scanning_enabled, barcode_enabled, custody_kits_enabled, asset_components_enabled, project_linking_enabled, employee_signature_enabled, detailed_conditions_enabled, overdue_alerts_enabled, incident_reporting_enabled, gps_sessions_enabled, external_trackers_enabled, client_rental_portal_enabled, depreciation_enabled, zoho_asset_sync_enabled, purchase_requests_enabled, insurance_claims_enabled, maintenance_vendor_billing_enabled, custody_offline_enabled, custody_mobile_app_enabled`.
الصلاحية: المالك يعدّل التكاملات/الخصوصية؛ الأدمن يعدّل التشغيلية؛ الموظف لا شيء (RPC `civ_can_admin`/`is_owner`).

## المراحل (SQL patch لكل مرحلة — ترتيب التشغيل في CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md)
| # | Patch file | الوحدات | الحالة المستهدفة هذا التنفيذ |
|---|---|---|---|
| 00 | `custody_enterprise_00_feature_flags_PATCH.sql` | إعدادات + أعلام + audit helper + توسيع notifications CHECK | **مبني كامل + مُراجَع** |
| 01 | `custody_enterprise_01_qr_kits_PATCH.sql` | QR/Barcode آمن + Kits + مكوّنات Parent/Child | **مبني كامل + مُراجَع** |
| 02 | `custody_enterprise_02_projects_conditions_PATCH.sql` | ربط المشروع + التوقيع الإلكتروني + الحالات الثلاث | **مبني: schema+RPC+RLS** |
| 03 | `custody_enterprise_03_incidents_alerts_PATCH.sql` | الحوادث + Hold + محرك التنبيهات/التصعيد + جدولة | **مبني: schema+RPC+RLS** |
| 04 | `custody_enterprise_04_gps_offline_PATCH.sql` | جلسات GPS + trackers خارجية + Outbox/Offline idempotency | schema + adapter (mock) |
| 05 | `custody_enterprise_05_rental_insurance_PATCH.sql` | بوابة التأجير الجديدة + التأمين/المطالبات | schema + flag (معطّل) |
| 06 | `custody_enterprise_06_finance_zoho_PATCH.sql` | الإهلاك/التكلفة + Zoho asset adapter (mock/outbox) | schema + adapter (mock) |
| 07 | `custody_enterprise_07_procurement_maintenance_PATCH.sql` | طلبات الشراء + توسيع الصيانة/المورد/الفواتير | schema + RPC |

> «schema + RPC/adapter» يعني: الجداول والدوال والـRLS جاهزة وآمنة وقابلة للتشغيل، مع
> واجهات/محوّلات mock خلف flags؛ واجهة الويب الكاملة والجوال تُستكمَل تدريجيًا. لا يُدّعى
> اكتمال ما لم يُبنَ؛ التقرير النهائي يوضّح لكل وحدة: مبني كامل / schema+RPC / سكافولد / مؤجّل.

## QR الآمن (§3)
`asset_code` (قابل للقراءة) + `qr_token` (عشوائي `gen_random_uuid`, غير قابل للتخمين) + `barcode_value` + `qr_status` + `label_version/printed_at/printed_by`. الـ QR يحمل **token فقط** يُحَل عبر RPC آمنة `custody_inv_resolve_qr(p_token)` (is_staff، بلا بيانات مالية). مولّد QR/Code128 = SVG pure-TS مضمّن `lib/qr/*` (لا حزمة، لا خدمة خارجية). سجل طباعة/إعادة إصدار كامل (`custody_qr_events`).

## الإشعارات (§22) — توسيع CHECK مع حفظ كل الأنواع
تُضاف: `qr_reissued, kit_issued, kit_returned, custody_due_soon, custody_overdue, custody_escalated, custody_incident_reported, custody_incident_updated, custody_signature_completed, custody_location_started, custody_location_stopped, custody_offline_conflict, rental_request_created, rental_contract_signed, rental_overdue, maintenance_estimate_requested, maintenance_cost_approved, maintenance_completed, purchase_request_created, purchase_request_approved, insurance_expiring, insurance_claim_updated, zoho_sync_failed`. تُعاد القائمة كاملةً (base 40 + civ v1 + self-issue + هذه) دون حذف نوع.

## مصفوفة الأدوار (§24) — مفروضة في القاعدة (RPC/RLS) لا الواجهة
- Employee (`is_staff`): عهده/مشاريعه المصرّح بها؛ صرف ذاتي/إرجاع/بلاغ/جلسة GPS خاصته؛ **لا مالي/تأمين/GPS الغير**.
- Custody Officer (`staff_role='custody_officer'`) عبر `civ_can_manage`: تشغيل/فحص/مخزون/QR/kits/صيانة؛ لا مالي حسّاس بلا علم مالي.
- Admin / Owner (`civ_can_admin=is_owner`): كل الوحدات؛ الإعدادات الحسّاسة للمالك.
- Finance (`staff_role='finance'`) عبر `civ_can_finance`: التكاليف/الفواتير/Zoho/التأمين؛ **لا تعديل مخزون**.
- Maintenance: طلبات الصيانة المخوّلة فقط؛ لا صرف.
- Client/Renter: طلباته/عقوده/تأجيراته فقط (RLS).

## الجوال (§12) + Offline (§13)
`apps/mobile/` = Expo/RN/TS مستقل، نفس Supabase/المصادقة/الـRPCs، لا تحويل monorepo. شاشات: دخول/صرف/QR/Kit/تصوير/توقيع/عهدتي/إرجاع/بلاغ/GPS/إشعارات/جرد/فحص/Offline/خصوصية. Offline (ويب PWA + جوال): Outbox محلي بـ `client_operation_id` UUID + idempotency في القاعدة (`custody_offline_operations`) + شاشة تعارضات/معلّق/مزامنة. **يُبنى كسكافولد**؛ لا `npm install`/EAS/نشر هنا.

## الأمان (§25) والاختبارات (§26) والبناء (§27)
مراجعة أمان عدائية لكل patch (IDOR/رفع لمسار غيره/MIME/حجم/signed URL قصير/idempotency/حماية cron+webhook/عدم تسريب مالي أو GPS). الاختبارات (§26، 74 حالة) وأوامر البناء (§27): **لا تُشغَّل هنا (لا node/DB)** — تُذكر كـ«لم تُشغَّل: السبب» ويُجهَّز هيكل الاختبارات؛ تُشغَّل عند المستخدم.

## Deployment (§29) — fail-safe قبل SQL
كل وحدة خلف flag يقرأه الكود بأمان (افتراضات آمنة عند غياب الجدول/فشل القراءة) فلا تنهار البوابة قبل تشغيل الـ patches. النظام القديم يستمر. الترتيب الدقيق في `CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md`. Rollback في `CUSTODY_ENTERPRISE_ROLLBACK.md`.

## المتغيرات البيئية المطلوبة (تُذكر ولا تُعطّل البقية)
- `CRON_SECRET` — لحماية `/api/cron/custody-alerts`.
- Zoho asset adapter: `ZOHO_ASSET_ORG_ID`, `ZOHO_ASSET_CLIENT_ID/SECRET/REFRESH_TOKEN` (mock إن غابت).
- GPS provider (اختياري): `CUSTODY_TRACKER_WEBHOOK_SECRET` (mock إن غاب).
- Mobile: `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`, حساب/شهادات Apple/Google للبناء (خارجية).
- موجودة مسبقًا وتُعاد الاستفادة: `PORTAL_NOTIFY_ENDPOINT`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`.
