# دليل الإنتاج النهائيّ — منصّة كيان
### Final Platform Production Runbook

> # ⛔ DOCUMENTATION — DO NOT PASTE INTO THE SQL EDITOR
> # ⛔ ملفّ توثيقيّ — لا يُنسخ إلى محرّر SQL
>
> **EN —** Markdown, not SQL. Pasting it into the Supabase SQL Editor raises
> `ERROR: 42601 syntax error at or near "#"`. Only files ending in `.sql` are executed.
>
> **ع —** توثيق لا SQL. نسخُه إلى محرّر SQL يرفع `42601` عند «#».
> لا يُنفَّذ إلّا ما ينتهي بـ`.sql`.

---

## ١. الدفع

```bash
git push origin main
```

**FINAL_HEAD المتوقَّع:** `(يُملأ بعد آخر التزام — انظر التقرير)`

تحقّق بعد الدفع: `git rev-parse origin/main` يساوي القيمة أعلاه.

## ٢. انتظار Vercel

هذه الجولة **تحتوي تغييرات تطبيق** (لوحة أسس المبالغ + تسجيل ثلاثة تبويبات).
انتظر **Ready** في Vercel قبل الخطوة ٣.

## ٣. ملفّات SQL — بالترتيب، وهي كلّ ما يُنفَّذ

| # | الملفّ | الهدف | النوع | النهاية | المتوقَّع | التوقّف |
|---|---|---|---|---|---|---|
| 1 | `docs/liveops_acl_repair_PREFLIGHT.sql` | قياس انكشاف PUBLIC/anon على liveops | قراءة فقط | بلا معاملة | `READY` (أو `NOT_NEEDED`) | `STOP` ⇒ لا تُكمل |
| 2 | `docs/liveops_acl_repair_RUNME.sql` | **إغلاق ثغرة**: سحب EXECUTE من PUBLIC/anon عن 56 دالّة، وإعادة منح سطح التطبيق | معاملة واحدة | **COMMIT** | لا خطأ + `ACL REPAIR OK` | أيّ `ACL SELF-TEST` ⇒ تراجُع تلقائيّ كامل، أرسل النصّ |
| 3 | `docs/liveops_acl_repair_POSTCHECK.sql` | إثبات صفر PUBLIC وصفر anon وسلامة السطح | قراءة فقط | بلا معاملة | ٤ PASS + ١ INFO | أيّ FAIL ⇒ أرسله |
| 4 | `docs/final_platform_acceptance_PREFLIGHT.sql` | جاهزيّة القبول: الحسابات والكائنات والحزم | قراءة فقط | بلا معاملة | `READY` | `STOP` ⇒ لا تُكمل |
| 5 | `docs/final_platform_acceptance_RUNME.sql` | مِشْحَن القبول: أدوار ومال وحزم | معاملة واحدة **بلا كتابة** | **COMMIT** (لم يكتب شيئًا) | `READY_WITH_MANUAL_STEPS` | `STOP` ⇒ أرسل الجدول |
| 6 | `docs/final_platform_acceptance_POSTCHECK.sql` | إثبات أنّ القبول لم يترك أثرًا | قراءة فقط | بلا معاملة | لا FAIL؛ `MANUAL_REQUIRED` واحد متوقَّع | أيّ FAIL ⇒ أرسله |

**لا شيء غير هذه الستّة.** والملفّ ٢ هو **الرقعة الوحيدة الجديدة** في هذه الجولة.

## ٤. ممنوع تشغيله

- ❌ كلّ `*_ROLLBACK.sql` — بلا استثناء.
- ❌ كلّ `*_RUNME.sql` للحزم الأربع عشرة المطبَّقة (منها
  `executive_reporting_RUNME.sql` و`kian_ai_assistant_RUNME.sql` و
  `case_studies_platform_RUNME.sql` و`live_operations_dashboard_RUNME.sql`).
- ❌ **كلّ ملفّ `.md`** — توثيق يُقرأ في المتصفّح. ومنها:
  `EXECUTIVE_REPORTING_ACCEPTANCE.md` · `FINAL_PLATFORM_ACCEPTANCE_MANUAL.md` ·
  هذا الملفّ · كلّ `*_ACCEPTANCE.md` و`*_MANUAL_*.md` و`*_RUNBOOK.md`.
  نسخُ أيٍّ منها إلى محرّر SQL يرفع `42601` — وليس في القاعدة عطل.

## ٥. POSTCHECK اختياريّ لإعادة التأكيد

`executive_reporting_POSTCHECK.sql` (قراءة فقط) — أُصلح فيه هذه الجولة عمودُ
حكمٍ ساقط، فإعادةُ تشغيله تُظهر ٢٦ صفًّا سليمة. ليس مطلوبًا.

## ٦. القبول اليدويّ المتبقّي

`docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md` — ستّ رحلات في المتصفّح بثلاثة
حسابات. لا يستطيع أيّ SQL إثباتها، وتبقى `MANUAL_REQUIRED` حتّى تُنفَّذ.

## ٧. الحالة عند نهاية هذه الجولة

```
LOCAL DEVELOPMENT COMPLETE
PRODUCTION ACCEPTANCE SQL PENDING   ← الملفّات الستّة أعلاه
MANUAL ACCEPTANCE REQUIRED          ← الرحلات الستّ في المتصفّح
```

بعد تشغيل الستّة بلا FAIL تصير الحالة **SQL COMPLETE / MANUAL ACCEPTANCE
REQUIRED**؛ وبعد الرحلات الستّ ✅ تصير **PLATFORM ACCEPTED**.
