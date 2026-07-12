# ترتيب تشغيل SQL — صور الأصول + الحذف الآمن

شغّل في Supabase SQL Editor **بالترتيب**. كل الملفات idempotent (آمنة لإعادة التشغيل).

## المتطلبات السابقة (يجب أن تكون شُغّلت من قبل)
1. `docs/portal_custody_inventory_system_v1_RUNME.sql`
2. `docs/portal_custody_inventory_employee_self_service_PATCH.sql`
3. `docs/custody_enterprise_00_feature_flags_PATCH.sql`
4. `docs/custody_enterprise_01_qr_kits_PATCH.sql` *(اختياري — لإبطال QR عند الحذف؛ الحذف يعمل بدونه)*
5. `docs/custody_inventory_asset_editing_PATCH.sql`

## هذه الدفعة (بالترتيب)
6. **`docs/custody_asset_photos_DIAGNOSTIC.sql`** — قراءة فقط. شغّله أولًا وافحص النتائج لتعرف أين الصور (سجلات؟ Storage فقط؟ غير قابلة للربط؟). لا يعدّل شيئًا.
7. **`docs/custody_inventory_asset_photos_backfill_PATCH.sql`** — يربط صور Storage اليتيمة بجدول `asset_files`، يُطبّع الصورة الأساسية، ويُحصّن RLS (المستندات المالية للمالية فقط). يطبع تقريرًا بعدد الصور المرتبطة/المتجاهلة/غير القابلة للربط.
8. **`docs/custody_inventory_asset_soft_delete_PATCH.sql`** — يضيف الحذف/الاستعادة الآمن + قائمة المحذوفات + قواعد المنع.
9. **`docs/custody_inventory_asset_delete_roles_PATCH.sql`** — يوسّع صلاحية الحذف/الاستعادة إلى **المالك + السوبر أدمن + الأدمن** (بدل الأدمن وحده). مضمَّن أصلًا في تعريف (8) للتنصيب الجديد؛ شغّل هذا المستقل إن كنت قد شغّلت (8) مسبقًا.

## بعد التشغيل
- أعد فتح نافذة تفاصيل أصل له صور قديمة ← يجب أن تظهر الصور (الأساسية أولًا).
- شغّل التشخيص (6) مجددًا للتأكد أن `still_orphan_after_backfill` = عدد الـunresolved فقط.
- الصور غير القابلة للربط (`unresolved`) تبقى في Storage — لم تُحذف — راجع تقرير الـbackfill.

## أمان
- لا hard delete في أي ملف.
- لا يُلمَس: العهدة اليدوية القديمة، التأجير القديم، Zoho، الفواتير، عروض الأسعار، بوابة العملاء، `notifications_type_check`.
- الحذف/الاستعادة/قائمة المحذوفات: **المالك + السوبر أدمن + الأدمن فقط** (`account_type='admin'` أو `staff_role='super_admin'`، نشط) — مُنفَّذ داخل الدوال، لا بإخفاء الواجهة. يُستبعَد custody_officer/manager/finance/employee/client/renter وغيرهم.
