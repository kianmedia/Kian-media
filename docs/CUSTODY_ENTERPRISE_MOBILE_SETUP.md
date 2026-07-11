# Custody Enterprise — Mobile Setup

التطبيق في `apps/mobile/` (Expo/RN/TS)، **مستقل** (لا monorepo)، نفس Supabase والصلاحيات.

## تشغيل محلي
```bash
cd apps/mobile && npm install
export EXPO_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<anon>"
npm run typecheck && npm start
```

## بناء ونشر (متطلبات خارجية)
```bash
npm i -g eas-cli && eas login
eas build --profile preview --platform android
eas build --profile production --platform ios
```
يتطلب: حساب Expo، `EAS_PROJECT_ID`، **Apple Developer + شهادات** (iOS)، **Google Play** (Android).

## الحالة
سكافولد: Login/Home/Scan(QR) + طبقة API مشتركة. الشاشات المتبقية تُستكمل باستدعاء نفس الـ RPCs.
**لم يُنفَّذ** install/build/نشر في بيئة التوليد (لا Node/Expo/حسابات). لا يُدَّعى نشر على المتاجر.

## أذونات
كاميرا (مسح QR + تصوير) · موقع (جلسة المهمة فقط بموافقة). deep link: `kiancustody://scan?t=<token>`.
