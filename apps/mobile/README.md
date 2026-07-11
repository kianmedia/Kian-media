# Kian Custody — Mobile App (Expo / React Native)

تطبيق الموظف لنظام العهدة. **مستقل** عن تطبيق الويب (لا monorepo) — يعيد استخدام نفس
Supabase والمصادقة والصلاحيات ودوال القاعدة الآمنة (RLS + SECURITY DEFINER RPCs).

> ⚠️ **حالة السكافولد:** بُنيت البنية والشاشات الأساسية (دخول/رئيسية/مسح QR) وطبقة الـ
> API المشتركة. **لم يُنفَّذ** `npm install` ولا `expo` ولا بناء EAS ولا نشر — لعدم توفّر
> Node/Expo/حساب Apple/Google في بيئة التوليد. الشاشات المتبقية (صرف/إرجاع/توقيع/بلاغ/
> GPS/إشعارات/جرد/فحص/Offline) تُستكمل باستدعاء نفس الـ RPCs الموجودة في `src/lib/api.ts`.

## الإعداد
```bash
cd apps/mobile
npm install
# متغيرات البيئة (ملف .env أو EAS secrets):
export EXPO_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
npm run typecheck   # tsc --noEmit
npm start           # Expo Dev
```

## البناء والنشر (يتطلب حسابات خارجية)
```bash
npm i -g eas-cli && eas login
eas build --profile preview --platform android   # يتطلب حساب Expo
eas build --profile production --platform ios     # يتطلب Apple Developer + شهادات
eas submit                                        # للنشر على المتاجر
```
- **متطلبات خارجية غير متوفرة في بيئة التوليد:** حساب Expo، حساب/شهادات Apple Developer،
  حساب Google Play، `EAS_PROJECT_ID`. لا يُدَّعى أي نشر على المتاجر.

## البنية
- `src/lib/supabase.ts` — عميل Supabase (جلسة في SecureStore).
- `src/lib/api.ts` — أغلفة RPC المشتركة (نفس دوال الويب).
- `src/screens/` — Login / Home / Scan (QR عبر expo-camera).
- `app.config.ts` — أذونات الكاميرا/الموقع + deep link `kiancustody://scan?t=<token>`.

## Offline (مخطط)
Outbox محلي (SecureStore/SQLite) بـ `client_operation_id`، يُطبَّق عبر `custody_offline_claim`
(idempotency في القاعدة) ثم `custody_offline_finalize`. راجع `docs/CUSTODY_ENTERPRISE_OFFLINE_SYNC.md`.
