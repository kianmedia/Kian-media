# سجل التشغيل الذاتي — Autonomous Run Log

> سجل زمني مُلحَق فقط (append-only) لكل إجراء تنفيذي.
> القاعدة: **كل سطر يذكر نجاحًا يجب أن يحمل دليلًا** (Commit، أو استجابة API، أو ترويسة حيّة، أو نتيجة اختبار).
> ما لا دليل عليه يُكتب صراحةً «غير مُتحقَّق منه».

---

## 2026-07-27 — بدء التشغيل الذاتي

### 00 · تثبيت الحالة الأولية

| # | الإجراء | النتيجة | الدليل |
|---|---|---|---|
| 1 | `git fetch --all --prune` + `status` + `log -10` | شجرة نظيفة، متزامنة | `## main...origin/main` بلا ahead/behind |
| 2 | التحقق أن `HEAD == origin/main` | ✅ | كلاهما `e592406` |
| 3 | جرد الوسوم | وسم واحد | `project-platform-v1.0.0` @ `75d16cd` |
| 4 | جرد التوثيق | 42 ملف `.md` · 166 ملف `.sql` | `ls docs/` |
| 5 | لا وجود لملفات الحالة الأربعة | مؤكَّد | فقط `PORTAL_ROADMAP.md` موجود سابقًا |

### 01 · تحقّق Phase 0 على الإنتاج الحيّ

| # | الفحص | النتيجة | الدليل |
|---|---|---|---|
| 1 | `robots.txt` | ✅ 200 · `text/plain` · 180 بايت | `curl -o /dev/null -w` |
| 2 | `sitemap.xml` | ✅ 200 · `application/xml` · 1215 بايت | نفس الطريقة |
| 3 | `icon.png` | ✅ 200 · `image/png` · 24298 بايت | نفس الطريقة |
| 4 | `favicon.ico` | ❌ **404** (صفحة خطأ HTML بـ18KB) | **ثغرة حقيقية — أُصلحت أدناه** |
| 5 | وسوم `<link rel=icon>` في HTML | ✅ موجودة | `/icon.png` و `/apple-icon.png` مُصدَّران فعلًا |
| 6 | `permissions-policy` | ✅ `geolocation=(self)` | ترويسة حيّة على الإنتاج |
| 7 | ترويستا CSP | ✅ المُنفَّذة + Report-Only | ترويسات حيّة |
| 8 | `public_rate_limits` | ✅ موجود ومحجوب عن anon | PostgREST يردّ `42501` |
| 9 | `rl_consume` | ✅ موجود ومحجوب عن anon | `42501` |
| 10 | `submit_opportunity_request` محمية | ✅ | تردّ `full name too long` — حارس أُضيف في Phase 2 ⇒ الجسم الجديد منشور |
| 11 | قوائم `/quote-request` | ✅ مُصلَحة | فحص DOM حيّ: `appearance:"auto"` + `"— اختر / Select —"` ×3 |
| 12 | زر واتساب على الجوال | ✅ غير محجوب | `elementFromPoint` → `hitIsWhatsApp: true` |
| 13 | زرّ القائمة على الجوال | ✅ 44×44 | كان 32×14.5 |
| 14 | تسجيل حضور موظف | ⏸️ **غير مُتحقَّق منه** | لا بيانات دخول → `M-001` |
| 15 | سجلات Vercel/Supabase | ⏸️ **غير مُتحقَّق منها** | لا صلاحية → `M-004` |

### 02 · إصلاحات Phase 0

| # | الإصلاح | التفصيل |
|---|---|---|
| 1 | `app/favicon.ico` | أُنشئ ICO حقيقي 32×32 (حاوية ICONDIR + حمولة PNG، 706 بايت). المتصفحات كانت تجد الأيقونة عبر وسم `<link>`، لكن الزواحف والعملاء القدامى يطلبون `/favicon.ico` مباشرة وكانوا يتلقّون 404. |

### 03 · إطلاق استطلاع Phase 1

- أُطلق استطلاع للقراءة فقط عبر 8 محاور متوازية للعمود الفقري للبريد/الإشعارات،
  كل ثغرة يدّعيها محور يتحقّق منها وكيل مستقل مهمته **دحضها**، ثم توليف خطة تنفيذ.
- المحاور: طابور/آلة الحالات · Idempotency · Retry/Backoff/Recovery · مُرحِّل Apps Script ·
  تغطية المُنتِجات (8 رحلات) · النجاح الزائف في `no-cors` · Cron والإعدادات · صحة/مراقبة الإدارة.

### 04 · نتائج فحصي المستقلّ للعمود الفقري (قبل وصول الاستطلاع)

| السؤال | الجواب | الدليل |
|---|---|---|
| هل الدفع متاح لي؟ | ❌ **لا** | `git push --dry-run origin main` → `could not read Username` ⇒ `M-000` |
| طابور واحد أم عدة؟ | **واحد** — `email_deliveries` | فحص الإنتاج: `notification_queue` و `email_outbox` كلاهما `PGRST205` (غير موجودَين) |
| هل Idempotency موجود؟ | ✅ **مبنيّ فعلًا** | `idempotency_key` + فهرس فريد جزئي `uq_edel_idem`؛ و`on conflict` يُعيد ذكر الشرط الجزئي (تفادي 42P10) |
| هل يُزيَّف `sent`؟ | ❌ **لا** | `projectNotify.ts:137` يرفض `sent` ما لم يؤكّد جسمُ الرد وجود المعالج |
| الحالات الست موجودة؟ | ⚠️ **أربع مخزَّنة** | المخزَّن: `pending/processing/sent/failed/skipped/bounced` · `retrying` و `dead_letter` **مُشتقّتان** لا مخزَّنتان (`notifications_recovery_batch9c_RUNME.sql:151-152`) |

**ادّعاء فحصتُه ثم أسقطتُه:** ظننتُ أن نافذة `DEFAULT_MAX_AGE_HOURS = 24` مع Cron يوميّ تُيتّم كل صف
أُعيدت جدولته. **غير صحيح** — `app/api/cron/notify-email/route.ts:110` يمرّر `RECOVERY_WINDOW_HOURS = 168`.
سُجِّل هنا لأن الإبلاغ عنه كان سيكون اختلاقًا.

**خيط مفتوح للمتابعة في P1:** `app/api/integrations/project/notify/route.ts:84` يشير إلى «صفوف جسر»
(bridge rows) بلا `idempotency_key`. الفهرس الفريد **جزئي** (`where idempotency_key is not null`)،
فهذه الصفوف خارج حماية منع الإرسال المزدوج. يحتاج تأكيدًا.

### 05 · إغلاق P0

| البند | النتيجة |
|---|---|
| `app/favicon.ico` | ✅ ICO حقيقي 32×32 (706 بايت)؛ Next ولّد `.next/server/app/favicon.ico/route.js` |
| `tsc --noEmit` | ✅ نظيف |
| الاختبارات | ✅ **767/767** |
| `next build` | ✅ **exit 0** |
| الحكم | `Public Portal Hardening Phase 2: CLOSED` |
