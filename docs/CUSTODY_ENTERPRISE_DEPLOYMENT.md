# Custody Enterprise — Deployment

## المتغيرات البيئية (Vercel)
| المتغير | الغرض | إلزامي |
|---|---|---|
| `CRON_SECRET` | حماية `/api/cron/custody-alerts` (Vercel يرسله كـ Bearer تلقائيًا للـ cron) | لتفعيل التنبيهات المجدولة |
| `SUPABASE_SERVICE_ROLE_KEY` | موجود مسبقًا — يستخدمه مسار cron والإشعارات | نعم |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | موجودة مسبقًا | نعم |
| `PORTAL_NOTIFY_ENDPOINT` | موجود — بريد الإشعارات | (موجود) |
| `ZOHO_ASSET_*` | محوّل Zoho للأصول (mock إن غابت) | اختياري |
| `CUSTODY_TRACKER_WEBHOOK_SECRET` | حماية webhook أجهزة التتبّع (mock إن غاب) | اختياري |
| Mobile: `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`, `EAS_PROJECT_ID` + حساب/شهادات Apple/Google | بناء الجوال | للجوال فقط |

## الخطوات
1. ادفع الكود: `git push origin main`.
2. شغّل ملفات SQL بالترتيب في `CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md`.
3. أضِف `CRON_SECRET` في Vercel → إعادة نشر (يُفعّل الـ cron في `vercel.json`).
4. Vercel `npm install` سيثبّت `qrcode` تلقائيًا (مطلوب لطباعة QR).
5. فعّل الأعلام من إعدادات النظام.
6. Smoke test (راجع `CUSTODY_ENTERPRISE_ADMIN_GUIDE_AR.md`).

## fail-safe
- الكود يقرأ الأعلام بأمان قبل تشغيل الـ patches (افتراضات آمنة). لا تنهار البوابة.
- الوحدات خلف أعلام مطفأة تبقى مخفية. النظام القديم يستمر بلا تأثّر.
- فشل البريد/Zoho/GPS/cron لا يفشّل أي حركة مخزون/عهدة.

## ملاحظات بناء (لم تُنفَّذ في بيئة التوليد)
`npm ci`, `npm run lint`, `tsc --noEmit`, `npm run build`, mobile `tsc` — **لم تُشغَّل** (لا Node محليًا).
شغّلها في CI/محليًا قبل الدمج للتأكد.
