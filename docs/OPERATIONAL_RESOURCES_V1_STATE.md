# الموارد التشغيلية V1 — حالة التنفيذ

## نقطة البداية (مُتحقَّقة)

| البند | القيمة |
|---|---|
| `START_HEAD` | `2a53ddb` |
| `origin/main` | `cc3c596` |
| Commits غير مرفوعة | **8** |
| Working Tree | **نظيف** |
| التجميد | حارس **3/3** · diff = **صفر** |

## 🚨 الاكتشاف الحاكم — نظام العهدة والأصول **موجود بالفعل**

مسح المستودع أظهر **57 جدولًا** للأصول والعهدة، منها:

```
custody_inventory_assets · custody_inventory_categories · custody_inventory_kits
custody_inventory_maintenance · custody_inventory_reservations · custody_inventory_movements
custody_inventory_assignments · custody_inventory_audits · custody_inventory_evidence
custody_qr_events · custody_vendors · custody_purchase_requests · custody_incidents
custody_liabilities · custody_rental_* (11 جدولًا) · asset_insurance_policies
```

⇒ **معظم الأطوار 2–8 له بيت قائم بالفعل**، وفيه بالفعل: أصول، فئات، أطقم، صيانة،
حجوزات، حركات، تسليمات، جرد، أدلّة، وأحداث QR.

### القرار المعماريّ الملزم لهذه الجلسة

**لا يُبنى نظام أصول ثانٍ موازٍ.** بناء `asset_*` جديد بجوار `custody_inventory_*`
يُنتج **مصدرَي حقيقة** لنفس المعدّة — وهو أسوأ من أيّ ميزة ناقصة: بعده لا أحد يعرف
أيّ رقم هو الصحيح.

**المسار الصحيح:** التوسعة الإضافية فوق `custody_inventory_*` القائم، وإنشاء
جداول جديدة **فقط** لما لا بيت له (مثل شبكة المواهب والموردين، ودفتر الاستخدام،
وسجلّ الوثائق) — مع توثيق كل قرار «أعدتُ استخدامه» مقابل «أنشأتُه».

## الموديولات الثمانية غير المطبَّقة

Communications · Operations · CRM · Finance · Commercial Subscriptions ·
Smart Quoting · Lead Scoring & Routing · Executive Reporting
⇒ **32 ملفّ SQL، لا شيء منها مطبَّق.**

## التكاملات — كلّها معطّلة

Apps Script غير منشور · البريد لم يصل قطّ · Zoho `connected=false` ·
WhatsApp/SMS Placeholder.

## تقدّم الدفعات

| الدفعة | الحالة |
|---|---|
| 0 — تثبيت الحالة + اكتشاف النظام القائم | ✅ |
| 1 — تدقيق الأصول والعهدة | ⏳ |
| 2 — توسعة الأصول وQR والصيانة | ⏳ |
| 3 — شبكة المواهب والموردين | ⏳ |
| 4 — التحقّق والحزمة النهائية | ⏳ |
