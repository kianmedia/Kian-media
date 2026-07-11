# Custody Enterprise — Zoho Asset Integration

## مبدأ
محوّل **مستقل** عن تكامل Zoho الحالي (العروض/الفواتير) — **لا يكسره**. لا إرسال تلقائي:
كل شيء عبر `custody_zoho_sync_outbox` بعد اعتماد مخوّل (مالي/أدمن)، ثم مسار adapter يرسل.

## المتغيرات (Vercel) — mock إن غابت
- `ZOHO_ASSET_ORG_ID`, `ZOHO_ASSET_CLIENT_ID`, `ZOHO_ASSET_CLIENT_SECRET`, `ZOHO_ASSET_REFRESH_TOKEN`
- لا تضع أي منها في الكود. token refresh آمن. إن غابت ⇒ المحوّل يعمل mock (يسجّل بلا إرسال).

## التدفق
1. المخوّل ينشئ عنصر outbox: `custody_zoho_enqueue(entity_type, entity_id, operation, payload)`.
2. مسار adapter (يُستكمل: `app/api/integrations/custody-zoho/sync/route.ts`) يقرأ `pending`، يرسل، يحدّث
   `status/external_id/attempts/last_error` ويسجّل في `custody_zoho_sync_log`. idempotency + retry.
3. خلف علم `zoho_asset_sync_enabled` (معطّل حتى اكتمال الإعداد).

## المدعوم (حسب خدمات Zoho المتاحة)
مورد صيانة كعميل مورد · فاتورة صيانة كمرجع · مستأجر كعميل · Estimate/Invoice تأجير **بعد اعتماد صريح**
· حفظ `zoho_*_id` + رابط فتح السجل. **لا قيود محاسبية/فواتير تلقائية.**

## ملاحظة
لم تُتَح بيانات اعتماد Zoho في بيئة التوليد ⇒ المحوّل جاهز بـ mock mode؛ الاختبار الحقيقي يتطلب sandbox/credentials.
