# خطّة تنفيذ Wave 9 — تطبيق الجوال

> 🔴 **Wave 9 لم تبدأ، ولا تُبدأ.** هذه **خطّة** يقرأها من ينفّذ لاحقًا.
> ⛔ ولا يوجد تطبيق، ولا مُعرِّف تطبيق، ولا شهادة توقيع، ولا حساب متجر.

---

## ١. تصنيف الروابط العميقة — مصدره الشيفرة لا التخمين

الجدول مشتقّ من `DEEP_LINK_TARGETS` في `lib/mobile/deepLinks.ts`، واختبار
`tests/wave8_deep_links.test.js` يُلزم كل هدف بأحد التصنيفات الأربعة.

| المفتاح | المسار | التصنيف | جلسة؟ | رمز؟ |
|---|---|---|---|---|
| `client_portal` | `/client-portal` | 🟢 **WEB ROUTE READY** | لا | لا |
| `project` | `/portal/projects/:id` | 🟡 **NEEDS NATIVE MAPPING** | نعم | لا |
| `portal_home` | `/portal` | 🟡 **NEEDS NATIVE MAPPING** | نعم | لا |
| `call_sheet` | `/portal/ops/call-sheets/:id` | 🟡 **NEEDS NATIVE MAPPING** | نعم | لا |
| `notification` | `/portal/notifications` | 🟡 **NEEDS NATIVE MAPPING** | نعم | لا |
| `password_reset` | `/reset-password` | 🟠 **NEEDS HOSTED ASSOCIATION FILE** | لا | **نعم** |
| `email_confirm` | `/confirm-email` | 🟠 **NEEDS HOSTED ASSOCIATION FILE** | لا | **نعم** |
| `qr_scan` | `/qr/:code` | 🔴 **SECURITY REVIEW REQUIRED** | لا | لا |
| `calendar_feed` | `/api/calendar/:token` | 🔴 **SECURITY REVIEW REQUIRED** | لا | **نعم** |
| `shared_resource` | `/portal/shared/:id` | 🔴 **SECURITY REVIEW REQUIRED** | لا | **نعم** |

**معنى كل تصنيف:**

- 🟢 **WEB ROUTE READY** — المسار يعمل اليوم على الويب، ولا يحتاج شيئًا من المنصّة.
- 🟡 **NEEDS NATIVE MAPPING** — يحتاج شاشة مقابلة في التطبيق ومسار «افتح في
  التطبيق أو المتصفّح». ⛔ ولا يُفتح داخل التطبيق قبل وجود جلسة صالحة.
- 🟠 **NEEDS HOSTED ASSOCIATION FILE** — لا يعمل كرابط عالميّ قبل استضافة ملفّ
  ارتباط **حقيقيّ** (§٢). وحتّى ذلك الحين يبقى رابطًا ويبًّا عاديًّا.
- 🔴 **SECURITY REVIEW REQUIRED** — يحمل رمزًا أو يكشف موردًا دون جلسة. يحتاج
  مراجعة صلاحية مستقلّة قبل ربطه بالتطبيق.

---

## ٢. 🔴 لماذا لا يوجد Universal Links / App Links اليوم

معيار القبول V2-8.4-A يذكرهما. **ولم يُنفَّذا، ولا يُدَّعى تنفيذهما**، لأنّ كلًّا
منهما يتطلّب ما لا وجود له بعد:

| المطلوب | iOS | Android | الحالة |
|---|---|---|---|
| ملفّ ارتباط مستضاف | `/.well-known/apple-app-site-association` | `/.well-known/assetlinks.json` | ❌ غير موجود |
| مُعرِّف التطبيق | `TeamID.BundleID` | `applicationId` | ❌ غير مُنشأ |
| بصمة توقيع | — | SHA-256 لشهادة الإصدار | ❌ لا شهادة |
| حساب مطوِّر | Apple Developer | Google Play Console | ❌ غير مؤكَّد |

⛔ **ونشر ملفّ ارتباط بمُعرِّف مُختلَق أسوأ من عدمه:** النظام يجلبه ويخزّنه
مؤقّتًا، فيفشل الربط بصمت ويبقى فاشلًا حتّى بعد التصحيح.
واختبار في الحزمة **يمنع** وجود هذين الملفّين في المستودع اليوم.

---

## ٣. ترتيب التنفيذ المقترَح لـWave 9

| # | الخطوة | يعتمد على |
|---|---|---|
| ١ | إنشاء حساب مطوِّر ومُعرِّف تطبيق وشهادة | ⛔ قرار خالد — لا يُنفَّذ من هنا |
| ٢ | هيكل Expo وقراءة فقط عبر `prpc` القائم | `docs/mobile/MOBILE_API.md` |
| ٣ | الاعتماد وتخزين الرمز الآمن | `docs/mobile/MOBILE_SECURITY.md` |
| ٤ | تسجيل جهاز الدفع | `wave8_push_tokens_RUNME.sql` (غير مطبَّقة) |
| ٥ | تفعيل قناة Expo | `PUSH_EXPO_ENABLED=1` + اعتماد خادميّ |
| ٦ | ملفّا الارتباط ثمّ الروابط العميقة | خطوة ١ |
| ٧ | الكتابة دون اتصال | §٤ |

---

## ٤. الكتابة دون اتصال — `MOBILE OFFLINE MUTATIONS DEFERRED TO WAVE 9`

الوضع الحاليّ **قراءة فقط عمدًا**. والعقد والأنواع والاختبارات موجودة في
`lib/mobile/offlineQueue.ts`، **والمحرّك غير مُنفَّذ**.

⚠️ وهذا **قرار معماريّ لا إصلاح**: الكتابة دون اتصال تعني حسم التعارض، وحسم
التعارض على بيانات تشغيلية حقيقية قرار عمل لا قرار هندسة.

---

## ٥. ما لا تدّعيه هذه الخطّة

- ⛔ لم يُكتب سطر واحد من تطبيق Wave 9.
- ⛔ لا حساب متجر، ولا مراجعة متجر، ولا تقدير لمدّتها.
- ⛔ ولا يُوصف PWA القائم بأنّه تطبيق Native.
