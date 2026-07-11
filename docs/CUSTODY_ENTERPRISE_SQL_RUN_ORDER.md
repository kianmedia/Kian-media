# Custody Enterprise — SQL Run Order

شغّل الملفات في **Supabase SQL Editor** بهذا الترتيب **الدقيق**. كلها idempotent قدر الإمكان.
لا تشغّل ملفًا قبل ما يعتمد عليه. **لا يوجد تشغيل تلقائي** — الأمر بيدك.

## الأساس (Custody Inventory v1 + Self-Service) — إن لم يكن مطبّقًا مسبقًا
1. `docs/portal_custody_inventory_system_v1_RUNME.sql`
2. `docs/portal_custody_inventory_employee_self_service_PATCH.sql`

## Enterprise Suite (بالترتيب)
3. `docs/custody_enterprise_00_feature_flags_PATCH.sql`  — إعدادات/أعلام/دور مالي/تدقيق/توسيع notifications CHECK
4. `docs/custody_enterprise_01_qr_kits_PATCH.sql`         — QR/Barcode + Kits + Components (يعتمد على 00 لدالة civ_flag)
5. `docs/custody_enterprise_02_projects_conditions_PATCH.sql`
6. `docs/custody_enterprise_03_incidents_alerts_PATCH.sql`
7. `docs/custody_enterprise_04_gps_offline_PATCH.sql`
8. `docs/custody_enterprise_05_rental_insurance_PATCH.sql`
9. `docs/custody_enterprise_06_finance_zoho_PATCH.sql`
10. `docs/custody_enterprise_07_procurement_maintenance_PATCH.sql`

بعد كل ملف: نفّذ قسم `-- VALIDATION` في آخره وتأكد من النتائج (عدد الجداول/الدوال/الأعمدة،
لا كمية سالبة، لا صرف مزدوج، الأعلام موجودة، notifications CHECK قائم).

## بعد التشغيل
- فعّل الأعلام المطلوبة من: بوابة الإدارة ← مخزون الأصول والعهد ← الإعدادات ← «مزايا المنصّة المؤسسية».
- الأعلام الافتراضية: التشغيلية مفعّلة؛ GPS/التأجير/Zoho/التأمين/Offline/الجوال **معطّلة** حتى اكتمال إعدادها.
- المتغيرات البيئية: أضِف `CRON_SECRET` (Vercel) لتفعيل مسار `/api/cron/custody-alerts` (مجدول كل ساعة في vercel.json).

## fail-safe قبل التشغيل
كل الكود يقرأ الأعلام/الجداول بأمان (افتراضات آمنة عند غيابها) فلا تنهار البوابة قبل تشغيل الـ patches.
النظام القديم (العهدة اليدوية/التأجير/Zoho/الفوترة/HR) لا يتأثر بأي من هذه الملفات.
