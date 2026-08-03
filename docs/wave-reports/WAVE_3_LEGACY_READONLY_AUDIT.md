# WAVE 3 · تدقيق الأنظمة المُجمَّدة — إثبات أنّها لم تُمَسّ

> القرار المعتمد: `project_call_sheets` و`project_locations` **Legacy / Frozen**.
> «لا حذف ولا Migration ولا كتابة جديدة للأنظمة Legacy. لا إنشاء نظام ثالث.»
>
> هذه الوثيقة هي **الدليل** على ذلك، لا الإعلان عنه.

---

## ١. ما يعنيه «مُجمَّد» هنا بالضبط

| | `project_call_sheets` · `project_locations` |
|---|---|
| يعمل؟ | ✅ **نعم، بلا تغيير.** واجهة `projectcore/CallSheet.tsx` تعمل كما كانت |
| يُقرأ؟ | ✅ نعم — `project_core_call_sheet_*` باقية وتُستدعى |
| يُكتب إليه من Wave 3؟ | ❌ **لا** |
| عمود جديد؟ | ❌ لا |
| صفّ محذوف؟ | ❌ لا |
| مُرحَّل؟ | ❌ لا — قرار W3-1 معلَّق |

**التجميد قرار توسعة لا قرار تشغيل.** لا شيء توقّف عن العمل، ولا مستخدم يرى
فرقًا. ما تغيّر: كلّ بناء جديد يذهب إلى `ops_*`.

---

## ٢. الدليل — ما يفحصه الاختبار آليًّا

`tests/wave3_sql_contract.test.js` · **(Q-2)** يفشل إن:

```
alter|drop|delete from|update  …  project_call_sheets
alter|drop|delete from|update  …  project_locations
```

ظهرت في أيّ `RUNME` من Wave 3. وكذلك يفشل إن أُنشئ أيّ من:
`call_sheets` · `locations` · `crew_members` · `crew_assignments` ·
`crew_documents` · `project_templates`.

وهذا حارس دائم: أيّ حزمة مستقبلية تخالف القرار تسقط في CI، لا في مراجعة بشرية.

---

## ٣. جرد ما لمسته Wave 3 فعلًا

### كُتب إليه (جداول `ops_*` وحدها)
| الجدول | التغيير |
|---|---|
| `ops_call_sheets` | `+ backup_date` · `+ is_drone_day` · قيد `backup_date > sheet_date` |
| `ops_job_weather` | `+ wind_gust_kph` · `+ fetched_at` · `+ for_lat` · `+ for_lng` · توسيع قيد `source` |
| `ops_calendar_tokens` | 🆕 جدول جديد (لا نظير له — ليس ازدواجًا) |

### قُرئ فقط
`ops_jobs` · `ops_job_crew` · `ops_locations` — قراءة داخل `prodops_calendar_feed`.

### لم يُمَسّ إطلاقًا
`project_call_sheets` · `project_locations` · `project_shoot_sessions` ·
`projects` · `custody_inventory_locations` · وكلّ ما عداها.

---

## ٤. لماذا `ops_calendar_tokens` ليس «نظامًا ثالثًا»

الاعتراض المشروع: Wave 3 تمنع الأنظمة الموازية، ثمّ تُنشئ جدولًا.

الفرق أنّ **لا نظير له**. لا يوجد في المستودع جدول رموز تقويم. النمط المُحتذى
(`liveops_client_links`) يخصّ روابط **جلسات البثّ للعملاء** — مجال مختلف، وعمر
مختلف، وجمهور مختلف. توسيعه ليحمل تقويم طاقم داخليّ كان سيُنتج جدولًا ذا معنيين،
وهو أسوأ من جدولين لكلٍّ معنى واحد.

ما احتُذي هو **العقد** لا الجدول: بصمة بدل الرمز · حالات
`active/revoked/expired/exhausted` · سقف فتحات وعدّاد · إلغاء بسبب مكتوب.

---

## ٥. القرار الوحيد المعلَّق — W3-1

**مصير الصفوف القائمة في الجدولين المُجمَّدين.**

لا يمكن قراءة Production من هنا ⇒ عدد الصفوف **غير معلوم**. الاستعلام موجود في
`wave3_production_ops_PREFLIGHT.sql` §5 (قراءة فقط):

```sql
select count(*) from public.project_call_sheets where is_deleted = false;
select count(*) from public.project_locations   where is_deleted = false;
```

| النتيجة | ما يترتّب |
|---|---|
| **صفر في الاثنين** | الازدواج ورقيّ فقط. يكفي التجميد، ولا عمل إضافيّ |
| **صفوف موجودة** | ترحيل مقصود بحزمة مستقلّة وبقرار خالد. ⛔ **لا حذف قبل ذلك** |

**التصنيف: PENDING ROW COUNT + OWNER DECISION.**
