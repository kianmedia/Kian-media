# Custody Inventory — Asset Details & Secure Editing

تفاصيل الأصل + التعديل الآمن للمالك/الأدمن. يعالج: زر «تفاصيل» لا يفتح، وغياب تعديل الأصل بعد تسجيله.

## ما الذي أُضيف

- **نافذة تفاصيل حقيقية (Modal)** بدل اللوحة المطويّة أسفل الجدول (كانت تُعرض بعد الجدول ويُظنّ أنها لا تفتح).
  المكوّن: `components/portal/custody-inventory/AssetDetailModal.tsx`. تبويبات: التفاصيل / تعديل الأصل / تصحيح المخزون / الصور / سجل التغييرات.
- **تعديل آمن** لكل البيانات المسجلة (اسم/تصنيف/موقع/حالة/وصف/تسلسلي/باركود/ملاحظات + الحقول المالية لأصحاب الصلاحية).
- **تصحيح مخزون آمن** (لا تعديل مباشر عشوائي للكميات) بوضعين: `delta (±)` و `set_total`.
- **إدارة صور** (إضافة/أرشفة/تعيين أساسية) عبر bucket خاص + Signed URLs.
- **سجل تغييرات** لكل حقل (قبل/بعد + الفاعل + السبب + الوقت).

## التشغيل (SQL)

شغّل **بعد** ملفات النظام الأساسية:

```
1) docs/portal_custody_inventory_system_v1_RUNME.sql
2) docs/portal_custody_inventory_employee_self_service_PATCH.sql
3) docs/custody_enterprise_00_feature_flags_PATCH.sql   (لأجل civ_can_finance؛ والملف يعرّفها احتياطيًا)
4) docs/custody_inventory_asset_editing_PATCH.sql        ← هذا الملف (idempotent، آمن للتكرار)
```

قسم التحقق في نهاية الـ patch (SELECT فقط) يؤكّد وجود الجدول/العمود/الدوال. قبل تشغيله تُظهر نافذة التفاصيل رسالة «غير مُجهّزة» مع اسم الملف (لا تعطّل الزر).

## الصلاحيات (مُنفَّذة داخل الـ RPC — لا إخفاء واجهة فقط)

| العملية | RPC | الصلاحية |
|---|---|---|
| عرض التفاصيل | `custody_inv_get_asset_details` | `civ_can_manage()` (مالك/سوبر/أدمن/مدير/أمين عهدة) |
| تعديل البيانات | `custody_inv_admin_update_asset` | `civ_can_admin()` (مالك/سوبر أدمن/أدمن) |
| الحقول المالية (قراءة+كتابة) | ضمن الدالتين | `civ_can_finance()` (مالك/مالية) — تُجرَّد وإلا |
| تصحيح المخزون | `custody_inv_admin_correct_stock` / `custody_inv_admin_adjust_stock` | `civ_can_admin()` |
| أرشفة/تعيين صورة أساسية | `custody_inv_admin_archive_asset_file` / `custody_inv_admin_set_primary_photo` | `civ_can_admin()` |
| سجل التغييرات | `custody_inv_get_asset_changes` | `civ_can_manage()` |

أمين العهدة والمدير: عرض فقط (لا يظهر لهما تبويبا التعديل/التصحيح، والـ RPC ترفض الاستدعاء المباشر). الموظف/العميل: ممنوعان.

## قواعد أمان الكميات (خادمية)

- الأصل المتسلسل: الكمية دائمًا 1 — تصحيح المخزون مرفوض له.
- «المصروف الملتزم» = `quantity_total − quantity_available` (يشمل الصيانة والمحجوز).
- `delta`: يعدّل المتاح والإجمالي معًا (يمسّ المخزون الحر فقط).
- `set_total`: إجمالي جديد، ويُشتقّ `available = new_total − committed` (يحافظ على المصروف/المحجوز/الصيانة).
- يُرفض: المتاح السالب، الإجمالي السالب، النزول تحت المصروف، تضخيم المتاح فوق ما أُضيف، `available > total`.
- كل تصحيح: `SELECT … FOR UPDATE` + سبب إلزامي + حركة `manual_correction` + قيد في سجل التغييرات + إشعار المدراء.
- `update_asset` لا يمسّ `asset_code` ولا `asset_type` ولا أي كمية؛ ويمنع تكرار الرقم التسلسلي؛ ويرفض تكرار الباركود/QR برسالة ودّية.
- لا حذف نهائي — الأرشفة soft-delete، وتُمنع إن كان الأصل على عهدة نشطة.

## لم يُمَس

العهدة اليدوية القديمة، التأجير القديم، Zoho، الفواتير، عروض الأسعار، `notifications_type_check` (النوعان المستخدمان `civ_asset_updated`/`civ_stock_correction` موجودان مسبقًا).
