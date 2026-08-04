# RELEASE READINESS — **BLOCKED**

> 🔴 **غير جاهز للإصدار.**
> ⛔ **ولا يُسمّى «مرشَّح إصدار نهائيّ»** — Wave 5 جزئية وغير مدمجة.
> ✅ **Waves 0–8: DEVELOPMENT COMPLETE** — التفصيل في
> `FINAL_DEVELOPMENT_COMPLETION_REPORT.md`.
> ✅ **W5-2 معتمَد من المالك** (٥ أغسطس ٢٠٢٦) · 🔵 **وبيانات الإنتاج لم تُتحقَّق.**

**التاريخ:** ٤ أغسطس ٢٠٢٦ · **الفرع النهائيّ:** `integration/v2-1-overnight`
@ `929626a` · **آخر وسم:** `overnight-wave-8-complete`
⛔ **كل شيء محلّيّ:** لا Push · لا Deploy · لا SQL · ولا دمج في `main`.

---

## ١. حالة الموجات ٠–٨

| Wave | الحالة | مدمجة في `integration`؟ | الوسم |
|---|---|---|---|
| 0 | ✅ COMPLETE | نعم | `overnight-wave-0-complete` |
| 1 | ✅ COMPLETE | نعم | `overnight-wave-1-complete` |
| 2 | ✅ COMPLETE | نعم | `overnight-wave-2-complete` |
| 3 | ✅ COMPLETE | نعم | `overnight-wave-3-complete` |
| 4 | ✅ COMPLETE | نعم | `overnight-wave-4-complete` |
| **5** | ✅ **DEVELOPMENT COMPLETE** · 🔵 بيانات الإنتاج معلَّقة | **نعم** | `overnight-wave-5-complete` |
| 6 | ✅ COMPLETE | نعم | `overnight-wave-6-complete` |
| 7 | ✅ COMPLETE | نعم | `overnight-wave-7-complete` |
| **8** | ✅ **DEVELOPMENT COMPLETE** | **نعم** (محلّيًّا) | `overnight-wave-8-complete` |

**الفروع:** `integration/v2-1-overnight` (النهائيّ) ·
`feat/wave-8-mobile-readiness` (مدمج) ·
`feat/wave-5-delivery-rights-finance` (⛔ **غير مدمج**).

---

## ٢. أسباب الحجب

| # | الحاجب | الطبيعة | مَن يفكّه |
|---|---|---|---|
| ~~ح-١~~ | ~~W5-2 غير محسوم~~ ⇒ ✅ **معتمَد**؛ ويبقى **تشغيل حزمة التحقّق القرائية** | 🔵 تحقّق بيانات | خالد |
| **ح-٢** | **٩ حزم SQL مطلوبة لم تُطبَّق** | 🔴 تنفيذ يدويّ | خالد |
| **ح-٣** | **لا Push ولا Merge ولا Deploy** | 🔴 إجرائيّ | خالد |
| **ح-٤** | **لا اختبار جهاز حقيقيّ** | 🟡 تحقّق | خالد |
| **ح-٥** | **Lighthouse لم يُشغَّل** | 🟡 تحقّق | جلسة تالية |
| **ح-٦** | **موافقات محتوى وحقوق شعارات** | 🟠 قرار | خالد |
| **ح-٧** | **سياسة الاحتفاظ بالبيانات** | 🟠 قرار قانونيّ | خالد + مراجعة قانونية |
| **ح-٨** | **`RESTORE DRILL REQUIRED — NOT EXECUTED`** | 🔴 تنفيذ يدويّ | خالد |
| **ح-٩** | **٢٤٣ ملفّ SQL لم تُقرأ بعد** — `NEEDS MANUAL REVIEW` | 🟡 مراجعة | جلسة تالية |

---

## ٣. نتائج الفحوصات — **مُنفَّذة بعد الدمج**

| الفحص | النتيجة |
|---|---|
| `npm test` | **4108 / 4108** ✅ |
| `npx tsc --noEmit` | **exit 0** ✅ |
| `npm run lint` | **42 تحذيرًا / 0 خطأ** ✅ مطابق لخطّ الأساس |
| `npm run build` | **exit 0** ✅ |
| Playwright **desktop** (Chromium) | **24 · 0 فشل** ✅ |
| Playwright **phone** (Chromium) | **27 · 0 فشل** ✅ |
| Playwright **tablet** (**WebKit**) | **27 · 0 فشل** ✅ |
| `npm run release:doctor` | **PASS 17 · WARN 0 · BLOCK 0** ✅ |

**حاجب مفتوح:** `docs/incidents/WORKING_TREE_UNKNOWN_FILES.md` — ٨٦ ملفًّا غير
متعقَّب تكسر البناء في الشجرة الرئيسية. ⛔ لم تُمسّ.

**تدقيق SQL:** ٥٦ ملفًّا **مقروءًا يدويًّا** · ٢٤٣ **لم تُقرأ** ·
**٩ RUNME REQUIRED** · **٠ DO NOT RUN** (⛔ ولا واحد بلا دليل) ·
**٢٤٣ NEEDS MANUAL REVIEW**. التفاصيل في `SQL_MANUAL_AUDIT_PROGRESS.md`.

**لم يُنفَّذ — ولا يُدَّعى:**
`LIGHTHOUSE VERIFICATION PENDING` · `DEVICE VERIFICATION PENDING` ·
`SAFE-AREA VISUAL VERIFICATION PENDING` · Firefox لم يُشغَّل ·
**صفر حزم SQL مطبَّقة** · **`RESTORE DRILL REQUIRED — NOT EXECUTED`** ·
⛔ **ولا استعلام إنتاج واحد.**

---

## ٤. الأعلام — كلّها **OFF**

| العلم | يتطلّب SQL | يتطلّب موافقة محتوى |
|---|---|---|
| `NEXT_PUBLIC_SHOW_TESTIMONIALS` | اختياريّ | 🔴 نعم |
| `NEXT_PUBLIC_SHOW_SEO_PAGES` | لا | 🔴 نعم |
| `NEXT_PUBLIC_SHOW_CLIENT_LOGOS` | لا | 🔴 **حقوق استخدام** |
| `NEXT_PUBLIC_SHOW_TRUST_PAGE` | لا | 🔴 نعم |
| `NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER` | 🔴 نعم | لا |
| `NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED` | 🔴 نعم | لا — ⛔ **مراجعة أمنية أوّلًا** |
| `NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY` | 🔴 نعم | لا |
| `NEXT_PUBLIC_SHOW_CRM_WAVE` | 🔴 نعم | لا |
| `NEXT_PUBLIC_SHOW_CASE_STUDY_DRAFTS` | 🔴 نعم | لا |
| `NEXT_PUBLIC_SHOW_GLOBAL_SEARCH` | 🔴 نعم | لا |
| `NEXT_PUBLIC_SHOW_AUDIT_VIEWER` | 🔴 نعم | لا |
| `PUSH_EXPO_ENABLED` | 🔴 نعم | لا — ⛔ **ولا معنى له بلا تطبيق** |

🔴 **ما يجب أن يبقى OFF بعد الإصدار:**
`NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED` (سطح `anon` عامّ) و`PUSH_EXPO_ENABLED`.

---

## ٥. SQL — التصنيف والترتيب

**التفصيل الكامل:** `docs/release/SQL_RELEASE_SELECTION_MATRIX.md`

- **إجمالي ملفّات SQL:** ٣٤١ · **بلاحقة RUNME:** ١٨٥
- ⚠️ **ولا يعني ذلك ١٨٥ ملفًّا معلَّقًا** — أغلبها مطبَّق من مراحل سابقة.
- **RUNME REQUIRED (v2.1):** **٩**
- **RUNME OPTIONAL:** ٢ (`wave8_push_tokens` · `kian_testimonials_v1`)
- **DEVELOPMENT SEED:** ٢ — ⛔ لا تُشغَّل على الإنتاج
- **READ-ONLY AUDIT:** ١٥ · **PREFLIGHT/POSTCHECK/ROLLBACK:** ٧٦
- **NEEDS MANUAL REVIEW:** الأغلبية — ⛔ **لم أقرأها ولم أصنّفها `DO NOT RUN` بلا دليل**

**ترتيب التشغيل المقترَح (RUNME REQUIRED فقط):**
`wave3_production_ops` → `wave3_permits_media` → `wave3_calendar_tokens` →
`wave4_crm_business` → `wave6_assets_archive` → `wave6_compliance_knowledge` →
`wave6_case_study_generator` → `wave7_global_search` → `wave7_audit_viewer`

⚠️ ولكلّ خطوة PREFLIGHT قبلها وPOSTCHECK بعدها، وROLLBACK جاهز.

---

## ٦. الترتيب الدقيق للتنفيذ

**النسخ الاحتياطي أوّلًا:**
1. نسخة كاملة من قاعدة الإنتاج.
2. 🔴 **تمرين استرجاع مُثبَت** — ⛔ ونسخةٌ لم تُختبر استعادتها ليست نسخة.

**ثمّ Push:**
3. `git push origin integration/v2-1-overnight` (⛔ لا `main`).
4. مراجعة الفرق ثمّ PR إلى `main` بقرارك.

**ثمّ SQL** — واحدًا واحدًا بالترتيب أعلاه: PREFLIGHT → قراءة المخرَج → RUNME
→ POSTCHECK. 🔴 **وأيّ توقُّف يعني التوقّف فعلًا، لا المتابعة.**

**ثمّ Deploy:** بعد نجاح SQL كاملًا، والأعلام **ما تزال OFF**.

**ثمّ الأعلام:** واحدًا واحدًا، وبين كلٍّ والذي يليه تحقّق على الإنتاج.

---

## ٧. شروط التوقّف والتراجع

| المرحلة | شرط التوقّف | التراجع |
|---|---|---|
| PREFLIGHT | أيّ صفّ `present=false` أو تحذير | ⛔ لا تُشغّل RUNME |
| RUNME | أيّ خطأ | `*_ROLLBACK.sql` المرافق |
| POSTCHECK | أيّ انحراف عن المتوقَّع | ROLLBACK ثمّ تحقيق |
| Deploy | فشل بناء أو خطأ وقت تشغيل | Rollback من Vercel |
| رفع علم | أيّ سلوك غير متوقَّع | أعد العلم OFF فورًا |

---

## ٨. فحص دخانيّ بعد النشر

1. الصفحة الرئيسية عربيًّا وإنجليزيًّا — بلا فيض أفقيّ.
2. ملصق الشوريل **مرئيّ** (كان عيبًا حقيقيًّا أُصلح في Wave 7).
3. عيّنة أعمال ظاهرة.
4. `/client-portal` يفتح ويقبل الدخول.
5. مسار خلف علم مطفأ ⇒ **404** ولا يتسرّب إلى sitemap.
6. استجابة QR لمجهول ⇒ **محايدة**.
7. عارض التدقيق ⇒ يبقى وسم **PARTIAL** ظاهرًا.
8. الشعار والخطوط تُحمَّل (⛔ ولا CSP تُسقط ورقة الأنماط).

---

## ٩. ما لا يُصدَر الآن

- ⛔ **Wave 5** — محجوبة على W5-2.
- ⛔ **أيّ بطاقة هامش أو رقم ربحيّ** — بناؤها يحسم W5-2 ضمنًا.
- ⛔ **تغذية التقويم** — حتّى مراجعة سطح `anon`.
- ⛔ **قناة الدفع** — لا تطبيق ولا اعتماد.
- ⛔ **Wave 9** — لم تبدأ.

---

## ١٠. خطوات حسم W5-2 بالضبط

1. شغّل `docs/release/WAVE_5_PRODUCTION_READONLY_VERIFICATION.md` — كلّه `SELECT`.
2. املأ خانات النتائج **من التشغيل**، ⛔ لا تقديرًا.
3. احسم السبعة: مصدر التكلفة · الفاتورة · `gross` · العملات · الإيراد · الهامش ·
   أسبقية Zoho.
4. سجّل القرار في `WAVE_5_FINANCIAL_SOURCE_OF_TRUTH_AUDIT.md`.
5. عندها فقط تُستأنف Wave 5 وتُبنى الأرقام الربحية.

---

## ١١. ما لا يُدَّعى هنا

- ⛔ **ليس تدقيقًا كاملًا للمنصّة.**
- ⛔ **صفر SQL مطبَّقة**، ولا وصول للإنتاج.
- ⛔ **لا اختبار جهاز، ولا Lighthouse، ولا Firefox.**
- ⛔ **PWA ليست تطبيقًا Native.**
- ⚠️ **الشجرة نظيفة، والعمل كلّه محلّيّ.**
