# GATE_A_VERIFICATION_PACK — حزمة إثبات آمنة لأسئلة البوابة الأربعة

> **الحالة:** مُنتَج ضمن مهمة `MASTER_ORDER_FINAL.md` (READ-ONLY audit).
> **الفرع:** `docs/v2_1-audit` · **شجرة الكود:** `7b92391`
> **GATE A غير معتمد. Wave 0 لم تبدأ.**
>
> ## ⛔ ما لم يحدث في إنتاج هذا المستند
> ❌ لم يُنفَّذ أي SQL · ❌ لم يُتصل بقاعدة Production · ❌ لم يُشغَّل أي استعلام ·
> ❌ لم تُفتح أي لوحة تحكم · ❌ لا قيمة سر أو Token أو DSN أو متغير بيئة في أي سطر أدناه.
>
> ## ⚠️ كيف تُستخدم
> كل ما يلي **مقترح للتشغيل من قِبلك**. كل استعلام هنا هو `SELECT` **قراءة فقط** —
> لا `INSERT` ولا `UPDATE` ولا `DELETE` ولا `DROP` ولا `ALTER` ولا `CREATE`.
> **لا تشغّل أي ملف `*_RUNME.sql` أثناء التحقق.**

---

## قاعدة قراءة النتائج (تمنع خطأ تشخيصي مكلّف)

مأخوذة من `lib/portal/pgerror.ts` — كُتب بعد ضياع دورة تصحيح إنتاج كاملة:

| الرمز | معناه | ما **لا** يعنيه |
|---|---|---|
| `42501` | الكائن **موجود** والصلاحية مرفوضة | **دليل وجود** لا غياب |
| `PGRST202` / `42883` | الدالّة غائبة فعلًا | — |
| `42P01` | الجدول/العلاقة غائبة فعلًا | — |
| `42703` | عمود في **طلبنا نحن** غير موجود | ❌ **ليس** «ترحيلة ناقصة» |
| `PGRST204/205` | ذاكرة مخطط PostgREST قديمة | الحل «Reload schema» |
| ٠ صفوف | **ليس خطأ** — غالبًا RLS تجيب صحيحًا | — |

> ⚠️ **استدعاء دالّة بلا معاملات وتلقّي `PGRST202` لا يثبت شيئًا** — قد تكون موجودة
> بتوقيع مختلف. الإثبات الصحيح بالتوقيع الكامل عبر `to_regprocedure(...)`.

> 🔑 **المبدأ الحاكم لكل الأسئلة الثلاثة الأولى:** الملفات الأربعة `authz_fix*` وPhase B
> تستخدم `create or replace function` و`grant`/`revoke`. أي **وجود الكائن ليس دليلًا
> على تطبيق الإصلاح** — الكائن موجود قبل الإصلاح وبعده. الإثبات الوحيد الصحيح هو
> **فحص جسم الدالّة أو حالة الصلاحية بحثًا عن أثر لا يوجد إلا في النسخة المُصلَحة.**

---

# السؤال ١ — هل «الملفات الأربعة» المطبَّقة 2026-07-26 هي `authz_fixA..D`؟

## ١.١ مصدر الالتباس

`docs/MANUAL_ACTIONS_QUEUE.md` (جدول «منجَز») يسجّل:

> ✅ تشغيل SQL تقوية صلاحيات منصة المشاريع **(4 ملفات)** — 2026-07-26 — «التسريب مُغلق؛
> مسح 372 دالة نظيف»

**الملفات الأربعة غير مُسمّاة.** والمرشحون في المستودع:

| المجموعة | الملفات | ملاحظة |
|---|---|---|
| **أ** | `authz_fixA_super_admin_grant` · `authz_fixB_identity_permissions` · `authz_fixC_null_failopen_gates` · `authz_fixD_profiles_direct_write` | أربعة بالضبط — أقوى مرشح |
| **ب** | `project_platform_authz_hardening` · `project_platform_authz_hardening2` · `authz_identity_hardening_s4pre` · واحد آخر | ثلاثة فقط + مجهول |

**لماذا يهمّ:** الحادثة الموثَّقة — **مفتاح anon قرأ بيانات شركة حقيقية** عبر انهيار
NULL في بوّابات `SECURITY DEFINER` — يغلقها **Fix C تحديدًا**. إن لم تكن المجموعة «أ»
هي المطبَّقة، فالثغرة **مفتوحة اليوم**.

## ١.٢ الدليل المطلوب

أثر داخل جسم الدالّة لا يوجد إلا في النسخة المُصلَحة:

| الملف | الأثر الفريد | لماذا فريد |
|---|---|---|
| **Fix A** | السلسلة `role_change_denied` داخل `admin_set_staff_role(uuid,text)` | لم تكن موجودة قبل الإصلاح |
| **Fix B** | السلسلة `can_manage_identity` داخل الدوال السبع للهوية · و**غياب** `can_manage_projects` منها | الإصلاح استبدل البوابة |
| **Fix C** | `coalesce` داخل البوّابات الستّ | الإصلاح غلّف التعبير الأصلي حرفيًا بـ`coalesce(…, false)` |
| **Fix D** | ⚠️ **غير مُغطّى في ملف التحقق القائم** — انظر §١.٥ | — |

## ١.٣ مكان التحقق

**Supabase Dashboard → SQL Editor** (بحساب المالك).

## ١.٤ الاستعلامات المقترحة — لا تُشغَّل من طرفي

> ✅ **يوجد ملف تحقق جاهز وقراءة-فقط في المستودع:**
> **`docs/SECURITY_POST_APPLY_VERIFICATION.sql`** (١٧٦ سطرًا).
> رأسه ينصّ حرفيًا: «لا يوجد في هذا الملفّ أيّ INSERT / UPDATE / DELETE / DROP /
> ALTER / CREATE». **شغّله كاملًا** — كل استعلام يحمل نتيجته المتوقَّعة في اسم العمود.
> ❌ **لا تُنشئ استعلامات موازية** ما دام هذا موجودًا.

الأقسام ذات الصلة بهذا السؤال: **§1 (Fix A)** · **§2 (Fix C)** · **§3 (s4pre)** ·
**§4 (Fix B)** · **§7 (سلامة عامّة)**.

**استعلام تلخيصي واحد** إن أردت جوابًا سريعًا قبل تشغيل الملف كاملًا — **قراءة فقط**:

```sql
-- ملخّص «هل A و B و C مطبَّقة؟» — SELECT فقط، لا يعدّل شيئًا
select 'FIX A' as fix,
       pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
         like '%role_change_denied%' as applied_expect_true
union all
select 'FIX B',
       bool_and(pg_get_functiondef(p.oid) like '%can_manage_identity%'
                and pg_get_functiondef(p.oid) not like '%can_manage_projects%')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('admin_set_employee_professions','admin_set_employee_override',
                     'admin_set_profession_permission','admin_copy_profession_permissions',
                     'admin_apply_profession_template','admin_upsert_profession',
                     'admin_delete_profession')
union all
select 'FIX C',
       bool_and(pg_get_functiondef(p.oid) like '%coalesce%')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_manage_hr','can_see_invoices','can_see_opportunities',
                     'can_manage_quotes','can_manage_custody','civ_can_manage');
```

**ولأن Fix D غير مُغطّى** — استعلام مقترح، **قراءة فقط**:

```sql
-- FIX D — إغلاق الكتابة المباشرة على public.profiles
select 'FIXD-1 table write revoked' as check,
       has_table_privilege('authenticated','public.profiles','UPDATE') as auth_update_expect_FALSE,
       has_table_privilege('authenticated','public.profiles','INSERT') as auth_insert_expect_FALSE,
       has_table_privilege('authenticated','public.profiles','DELETE') as auth_delete_expect_FALSE,
       has_table_privilege('anon','public.profiles','UPDATE')          as anon_update_expect_FALSE
union all
select 'FIXD-2 safe columns still writable',
       has_column_privilege('authenticated','public.profiles','full_name','UPDATE'),
       has_column_privilege('authenticated','public.profiles','company','UPDATE'),
       has_column_privilege('authenticated','public.profiles','mobile','UPDATE'),
       has_column_privilege('authenticated','public.profiles','marketing_opt_in','UPDATE');

-- FIXD-3 المُشغِّل صار يرى staff_role.   المتوقَّع: t
select 'FIXD-3 audit trigger sees staff_role' as check,
       pg_get_functiondef(to_regprocedure('public.trg_profile_audit()'))
         like '%staff_role%' as expect_true;

-- FIXD-4 ★ الأهمّ ★ الأعمدة الحسّاسة غير قابلة للكتابة.   المتوقَّع: كلّها f
select 'FIXD-4 privileged columns locked' as check,
       has_column_privilege('authenticated','public.profiles','staff_role','UPDATE')    as staff_role_expect_FALSE,
       has_column_privilege('authenticated','public.profiles','account_type','UPDATE')  as account_type_expect_FALSE;
```

## ١.٥ ⚠️ فجوة توثيقية مكتشَفة أثناء إعداد هذه الحزمة

`docs/SECURITY_POST_APPLY_VERIFICATION.sql` يغطي **Fix A · Fix C · s4pre · Fix B ·
S4a · S4b + سلامة عامّة** — **ولا يحوي قسمًا لـFix D إطلاقًا**
(`grep -ci 'fixd\|trg_profile_audit\|column_privilege'` → **0**).

⇒ حتى لو مرّت كل أقسام الملف بنجاح، **Fix D يبقى غير مُثبَت**. لذلك أُضيفت استعلاماته
أعلاه. **وهذا سبب كافٍ وحده لعدم اعتبار «الملفات الأربعة» محسومة بالملف القائم فقط.**

## ١.٦ ✅ PASS

**جميع** ما يلي معًا:
- `FIX A` = `true` · `FIX B` = `true` · `FIX C` = `true` في الاستعلام التلخيصي
- `FIXD-1` = كل الأعمدة `false` · `FIXD-3` = `true` · `FIXD-4` = **كلاهما `false`**
- §2.2 من الملف القائم: `can_manage_quotes` / `can_see_invoices` /
  `can_see_opportunities` لـ`anon` = `true` (**مكشوفة عمدًا** لعدم كسر المسار العام)،
  والثلاث الأخرى = `false`
- §2.3: البوّابات الستّ تعيد `f` **ولا واحدة تعيد `NULL`**
- §7.5: `owners = 2` · `super_admins = 0`

⇒ **المجموعة «أ» هي المطبَّقة، وحادثة انهيار NULL مُغلقة.**

## ١.٧ ❌ FAIL

أيٌّ مما يلي:
- `FIX C` = `false` أو أي بوّابة بلا `coalesce`
  🔴 **الحادثة الأمنية مفتوحة اليوم** — anon قد يقرأ بيانات شركة حقيقية
- §2.3 يُرجع `NULL` بدل `f` لأي بوّابة → نفس الحكم
- `FIX A` = `false` → أي `super_admin` يصنع مالكًا جديدًا بنقرة، بلا حدّ للعدد
- `FIX B` = `false` → أي مدير مشروع يعيد كتابة صلاحيات أي موظف ويُسند لنفسه أي مهنة
- `FIXD-4` يُرجع `true` لأي عمود → تصعيد صلاحيات عبر `PATCH` مباشر على `profiles`
- §7.5 يُرجع `super_admins > 0` أو `owners <> 2` 🔴 **مؤشر استغلال فعلي، لا مجرد ثغرة**

## ١.٨ 🔴 المخاطر إن بقي غير محسوم

| # | الخطر |
|---|---|
| ١ | **تسريب بيانات عملاء حقيقية عبر مفتاح anon** — الحادثة موثَّقة كواقعة حدثت، لا كاحتمال |
| ٢ | **توسيع دائرة المُلّاك بلا حدّ** — ترقية موظف عادي إلى `super_admin` |
| ٣ | **تصعيد ذاتي للصلاحيات** من أي مدير مشروع |
| ٤ | **`PATCH` مباشر على `profiles`** لا يمرّ بأي RPC فلا تحرسه أي بوّابة دوال |
| ٥ | **صفحة `/trust` (بند `V2-2.3-A`) تصبح ادّعاءً كاذبًا** — تَعِد بـRLS وسجل تدقيق في وثيقة مشتريات |
| ٦ | **كل تخطيط أمني في v2.1 مبني على أرض مجهولة** |

---

# السؤال ٢ — هل Phase B المالية مطبَّقة على Production؟

## ٢.١ ما تفعله كل مرحلة

| | Phase A | Phase B |
|---|---|---|
| الملف | `docs/project_core_financials_phaseA_RUNME.sql` (٦٦ سطرًا) | `docs/project_core_financials_phaseB_lockdown_RUNME.sql` (٦٢ سطرًا) |
| الفعل | **يضيف فقط** `pc_project_financials(uuid)` — ❌ لا يغيّر أي `grant` | **يسحب** `select` على `project_core` من `authenticated` و`anon`، ويعيد منحه لـ**١٣ عمودًا غير مالي فقط** |
| الأعمدة المحجوبة بعده | — | `budget_amount` · `estimated_cost` · `actual_cost` |
| متوافق مع واجهة تستخدم `select=*` | ✅ | ❌ **يكسرها للجميع** بمن فيهم المدير والمالية |

## ٢.٢ الدليل المطلوب

**حالة الصلاحية على مستوى العمود** — لا وجود الدالّة. `has_column_privilege()` يحترم
الفحص الحقيقي وقت التشغيل (منحة الجدول **أو** منحة العمود).

## ٢.٣ مكان التحقق

**Supabase Dashboard → SQL Editor**.

## ٢.٤ الاستعلام المقترح — لا يُشغَّل من طرفي

```sql
-- Phase A / Phase B — حالة القفل المالي.  SELECT فقط.
select 'PHASE A — RPC exists' as check,
       to_regprocedure('public.pc_project_financials(uuid)') is not null as expect_true,
       has_function_privilege('authenticated','public.pc_project_financials(uuid)','execute') as auth_exec_expect_true,
       has_function_privilege('anon','public.pc_project_financials(uuid)','execute')          as anon_exec_expect_FALSE;

-- ★ الفاصل ★ Phase B مطبَّقة ⟺ الأعمدة المالية الثلاثة غير مقروءة
select 'PHASE B — money columns locked' as check,
       has_column_privilege('authenticated','public.project_core','budget_amount','SELECT')  as budget_expect_FALSE,
       has_column_privilege('authenticated','public.project_core','estimated_cost','SELECT') as est_expect_FALSE,
       has_column_privilege('authenticated','public.project_core','actual_cost','SELECT')    as actual_expect_FALSE,
       has_column_privilege('authenticated','public.project_core','core_stage','SELECT')     as stage_expect_TRUE,
       has_table_privilege ('authenticated','public.project_core','SELECT')                  as table_wide_expect_FALSE;

-- تشخيصي: أي أعمدة يملك authenticated قراءتها فعلًا (المتوقَّع بعد Phase B = ١٣)
select 'PHASE B — granted column count' as check, count(*) as expect_13
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'project_core'
   and grantee = 'authenticated' and privilege_type = 'SELECT';
```

## ٢.٥ ✅ PASS

- **Phase A مطبَّقة:** الدالّة موجودة · `authenticated` يملك التنفيذ · `anon` **لا** يملكه
- **Phase B مطبَّقة:** الأعمدة الثلاثة **كلها `false`** · `core_stage` = `true` ·
  `table_wide` = `false` · عدد الأعمدة الممنوحة = **١٣**

## ٢.٦ ❌ FAIL — وله معنيان مختلفان تمامًا

| النتيجة | المعنى | الحكم |
|---|---|---|
| الدالّة غائبة (`PGRST202`/`42883`) | **Phase A نفسها غير مطبَّقة** | 🔴 لا تُشغَّل Phase B إطلاقًا — ملفها يرفض التشغيل ذاتيًا وهذا صحيح |
| الأعمدة الثلاثة `true` **و**`table_wide` = `true` | **Phase B غير مطبَّقة** | 🟠 **الأعمدة المالية مقروءة مباشرة عبر PostgREST لأي `authenticated`** — أي عميل مسجَّل، لا موظف فقط |
| بعض الأعمدة `true` وبعضها `false` | **تطبيق جزئي** | 🔴 الأخطر — حالة غير متسقة تحتاج فحصًا يدويًا قبل أي إجراء |
| `core_stage` = `false` | **الواجهة مكسورة الآن** | 🔴 صفحات project-core لا تعمل لأحد — تراجع فوري |

## ٢.٧ ✅ ملاحظة مطمئنة مُتحقَّقة من الكود

الشرط الحاجب في رأس ملف Phase B هو: **«لا تشغّله قبل أن تكون الواجهة الجديدة حيّة»**
لأن الواجهة القديمة تقرأ `select=*`.

**فحصتُ المستودع: هذا الشرط مستوفى في الكود.**
- `lib/portal/projectCore.ts:132` يعرّف `PC_CORE_COLS` بـ**١٣ عمودًا غير مالي بالاسم**
  — **مطابقة تامّة** لقائمة المنح في Phase B.
- `pcGetProjectCore` يجلب الأعمدة المالية **حصرًا** عبر `pc_project_financials()`.
- **`grep` على `lib` و`components` و`app`: صفر استخدام لـ`select=*` أو `project_core(*)`.**

⇒ **ما لم يبقَ إثباته هو أمر واحد: هل هذا الكود مُنشَر فعلًا على Production؟**
إن كان منشورًا فـPhase B **آمنة للتشغيل الآن**. (لا أستطيع إثبات النشر — لا وصول لي
إلى Vercel.)

## ٢.٨ 🔴 المخاطر إن بقي غير محسوم

| # | الخطر |
|---|---|
| ١ | **أي حساب `authenticated` — بما فيه العميل — قد يقرأ الميزانية والتكلفة التقديرية والفعلية مباشرة** عبر PostgREST، متجاوزًا `can_see_financials()` بالكامل |
| ٢ | **حماية استنتاج الأرباح تسقط عمليًا** — الهامش يُحسب من عمودين مكشوفين |
| ٣ | **كل بند مالي في Wave 5** (`V2-5.5-B/D/E`) يُبنى على افتراض قفل غير مؤكَّد |
| ٤ | **تشغيل Phase B على أعمى** — إن كانت الواجهة القديمة منشورة، تنكسر صفحات project-core **للجميع** فورًا |
| ٥ | **`/trust` تَعِد بعزل مالي** غير مُثبَت |

---

# السؤال ٣ — اختبار `M-012`: المسار العام بعد Fix C

## ٣.١ لماذا هذا الاختبار موجود

Fix C غلّف ستّ بوّابات بـ`coalesce(…, false)`. **ثلاث منها يملك `anon` تنفيذها:**
`can_manage_quotes` · `can_see_invoices` · `can_see_opportunities`.

الملف **لم يسحب صلاحية `anon` عمدًا** تفاديًا لكسر المسار العام — وهو قرار صحيح، لكنه
**غيّر سلوك الدوال من `NULL` إلى `false` للزائر غير المصادَق**. أي مسار عام يعتمد على
`NULL` ضمنيًا **سينكسر**.

`docs/MANUAL_ACTIONS_QUEUE.md` يسجّل حالته: **`MANUAL TEST PENDING` — غير مُسجَّل PASS.**

**هذا اختبار واجهة صرف — لا SQL ولا قاعدة بيانات.**

## ٣.٢ الدليل المطلوب

إرسال حقيقي من متصفح **غير مسجَّل دخول**، ينتج **رقم مرجع ظاهر** ويُخلّف صفًّا
في `public_intake`.

## ٣.٣ مكان التحقق

**متصفح في وضع التصفح الخفي (Incognito/Private) — بلا أي جلسة.**
⚠️ نافذة عادية قد تحمل جلسة مالك، فتُخفي العطل تمامًا وتنتج **PASS كاذبًا**.

## ٣.٤ الخطوات المقترحة

| # | الخطوة | المسار |
|---|---|---|
| ١ | افتح نافذة خفية جديدة | — |
| ٢ | تأكّد أنك **غير مسجّل دخول** (لا تفتح `/client-portal`) | — |
| ٣ | افتح أدوات المطوّر → **Console** و**Network** قبل الإرسال | F12 |
| ٤ | أرسل طلب عرض سعر ببيانات اختبارية **وبريد حقيقي تملكه** | `/quote-request` |
| ٥ | سجّل: هل ظهر **رقم مرجع**؟ · هل ظهرت رسالة خطأ؟ | — |
| ٦ | في Network: حالة `POST /api/public/intake` وجسم ردّها | — |
| ٧ | أرسل طلبًا من صفحة الفرص | `/opportunities` |
| ٨ | كرّر ٥ و٦ | — |

> ⚠️ **قراءة ردّ `/api/public/intake` بدقّة:** المسار يردّ **`HTTP 200` في كل الحالات
> عمدًا** (نموذج عام يجب ألّا يعرض خطأً تقنيًا). ⇒ **رمز الحالة لا يعني شيئًا.**
> **الحكم من جسم الردّ فقط:** `{"ok":true}` مقابل `{"ok":false,"error":"…"}`.

**استعلام تأكيد اختياري بعد الاختبار — قراءة فقط، بلا عرض أي بيانات شخصية:**

```sql
-- هل وصل الصفّ فعلًا؟  SELECT فقط — لا يعرض اسمًا ولا بريدًا ولا هاتفًا
select 'M-012 rows landed' as check, type, count(*) as n, max(created_at) as latest
  from public.public_intake
 where created_at > now() - interval '30 minutes'
 group by type;
```

## ٣.٥ ✅ PASS

- **كلا النموذجين** يُرسَلان ويظهر **رقم مرجع** للمستخدم
- Console **بلا أخطاء** · لا رسالة «لا تملك صلاحية» ولا `42501`
- جسم `/api/public/intake` = `{"ok":true, "id":"…"}`
- الاستعلام يُظهر صفًّا حديثًا لكل نموذج

⇒ Fix C لم يكسر المسار العام. **يُحدَّث `M-012` إلى ✅ PASS بتاريخه في
`MANUAL_ACTIONS_QUEUE.md`.**

## ٣.٦ ❌ FAIL

| العَرَض | القراءة |
|---|---|
| النموذج لا يُرسل / لا رقم مرجع | 🔴 **تحليل المسار العام كان ناقصًا — الأولوية للمسار العام فورًا** |
| `42501` أو «لا تملك صلاحية» | بوّابة صارت تُرجع `false` حيث كانت `NULL` وكان الكود يعتمد على ذلك |
| `{"ok":false,"error":"rate_limited"}` | ⚠️ **ليس فشلًا** — حدّ ١٢/ساعة/IP أو ٦/ساعة/بريد. غيّر الشبكة أو البريد وأعد |
| `{"ok":false,"error":"no_email"}` | ⚠️ **ليس فشلًا** — البريد إلزامي للمرآة الدائمة |
| `{"ok":false}` بسبب آخر | 🔴 فشل حقيقي — أبلغ فورًا |
| بطاقة نجاح تظهر **بلا** صفّ في القاعدة | 🔴 **الأخطر: نجاح كاذب** — العميل يظن أن طلبه وصل وهو ضائع |

## ٣.٧ 🔴 المخاطر إن بقي غير محسوم

| # | الخطر |
|---|---|
| ١ | **فقدان صامت لطلبات عملاء حقيقية** — والنموذج مصمَّم ألّا يعرض خطأً تقنيًا، فلن يشتكي أحد |
| ٢ | **كل بند Wave 1 لحفظ الـLeads (`V2-1.6-A/C`) يُبنى على مسار غير مُثبَت** |
| ٣ | **`V2-0.1-A…D` (checkbox الموافقة) يضيف حقلًا إلزاميًا** إلى نماذج قد تكون مكسورة أصلًا |
| ٤ | **لا يمكن قياس أثر أي تحسين تسويقي** بينما القناة نفسها غير مؤكَّدة |
| ٥ | **`M-012` مسجَّل P0** ومع ذلك بقي معلّقًا منذ 2026-07-27 |

---

# السؤال ٤ — هل Vercel Preview مرتبط بمشروع Supabase منفصل؟

> 🔒 **سياسة صارمة لهذا القسم:** كل ما يلي **مقارنة** تنتج «متطابق / مختلف».
> ❌ لا تنسخ أي قيمة · ❌ لا تلصق أي رابط أو مفتاح في أي مستند أو رسالة ·
> ❌ لا تلتقط صورة شاشة تُظهر قيمة. **الإجابة المطلوبة كلمة واحدة: مختلف أو متطابق.**

## ٤.١ الدليل المطلوب

**دليلان مستقلان** — أحدهما وحده لا يكفي:
- **(أ) إعدادي:** متغيرات بيئة Preview لها قيم خاصة بها، لا موروثة من Production.
- **(ب) سلوكي:** نشرة Preview حيّة تتحدث إلى مضيف Supabase **مختلف**، ولا تُظهر بيانات إنتاج.

**لماذا الاثنان معًا:** متغيّر مُعرَّف لـPreview قد يحمل **نفس قيمة Production** — عندها
(أ) تبدو صحيحة و(ب) تكشف الحقيقة.

## ٤.٢ مكان التحقق

- **Vercel Dashboard → Project → Settings → Environment Variables**
- **نشرة Preview حيّة** + أدوات مطوّر المتصفح

## ٤.٣ الخطوات المقترحة

### (أ) الفحص الإعدادي — بلا كشف قيم

| # | الخطوة | ما تنظر إليه |
|---|---|---|
| ١ | Settings → Environment Variables | عمود **Environments** لكل متغير |
| ٢ | لكل متغير أدناه: هل له صفّ **خاص بـPreview**، أم صفّ واحد مُعلَّم بالبيئات الثلاث؟ | `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` |
| ٣ | **صفّ واحد يشمل Production **و**Preview = المشروع نفسه** ⇒ سقوط فوري | — |
| ٤ | كرّر للمتغيرات الجانبية عالية الأثر | `CRON_SECRET` · `PORTAL_NOTIFY_ENDPOINT` · `N8N_NOTIFY_WEBHOOK_URL` · `ZOHO_BOOKS_*` · `WHATSAPP_ACCESS_TOKEN` |
| ٥ | **بلا كشف القيمة:** استخدم زرّ الإظهار لكلٍّ من Production وPreview **وقارن بصريًا فقط**، ثم أغلقه. سجّل «متطابق» أو «مختلف» — ❌ لا تنسخ | — |

### (ب) الفحص السلوكي — الأقوى

| # | الخطوة | ما تنظر إليه |
|---|---|---|
| ٦ | افتح آخر نشرة **Preview** (رابط `*-git-*.vercel.app`) في نافذة خفية | — |
| ٧ | أدوات المطوّر → **Network** → صفِّ بـ`supabase` | **اسم المضيف فقط** في عمود Domain |
| ٨ | افتح Production في نافذة خفية أخرى وكرّر | نفس العمود |
| ٩ | **قارن اسمَي المضيف** — سجّل «متطابق» أو «مختلف» فقط. ❌ لا تنسخ المضيف | — |
| ١٠ | 🔴 **الاختبار الحاسم:** سجّل الدخول إلى **Preview** بحساب حقيقي وافتح قائمة المشاريع أو العملاء | هل تظهر **بيانات عملاء حقيقية**؟ |

> ⚠️ **الخطوة ١٠ هي الدليل القاطع.** ظهور بيانات إنتاج حقيقية في Preview يعني أن
> البيئتين **قاعدة واحدة** — بصرف النظر عمّا يقوله جدول المتغيرات.

### (ج) فحص جانبي مساند

| # | الخطوة |
|---|---|
| ١١ | Supabase Dashboard → قائمة المشاريع: **كم مشروعًا يملكه الحساب؟** مشروع واحد ⇒ سقوط فوري بلا حاجة لبقية الفحص |
| ١٢ | `.env.example` في المستودع **غير مقسَّم** بين البيئات — دليل مساند على أن الفصل لم يُصمَّم بعد (`V2-0.3-B`) |

## ٤.٤ ✅ PASS

**كل** ما يلي:
- حساب Supabase يملك **مشروعين على الأقل**، أحدهما مخصّص للـPreview
- `NEXT_PUBLIC_SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` لهما **صفوف Preview مستقلة**
- المضيف في Network **مختلف** بين Preview وProduction
- 🔴 **تسجيل الدخول إلى Preview لا يُظهر أي بيانات عميل حقيقية** — فارغ أو بيانات بذور فقط
- الأسرار الجانبية (`CRON_SECRET` · Zoho · WhatsApp · n8n) **ليست قيم الإنتاج**

⇒ **يُرفع تجميد الدفع G3.** الدفع لفروع الميزات مسموح؛ الدمج والنشر يبقيان على «أعتمد».

## ٤.٥ ❌ FAIL

| العَرَض | الحكم |
|---|---|
| صفّ متغير واحد يشمل Production وPreview معًا | 🔴 **قاعدة واحدة** |
| المضيف **متطابق** | 🔴 **قاعدة واحدة** — مهما قال جدول المتغيرات |
| Preview يعرض بيانات عملاء حقيقية | 🔴🔴 **الأخطر — كل نشرة Preview تكتب على الإنتاج** |
| حساب Supabase فيه مشروع واحد | 🔴 البيئة المنفصلة غير موجودة أصلًا (وهو ما يرجّحه تدقيق المستودع) |
| البيئة منفصلة لكن **أسرار Zoho/WhatsApp/n8n هي أسرار الإنتاج** | 🟠 **فشل جزئي خطر** — القاعدة معزولة، لكن Preview قد يُصدر **فاتورة Zoho حقيقية** أو **يرسل واتساب لعميل حقيقي** |

## ٤.٦ 🔴 المخاطر إن بقي غير محسوم

| # | الخطر |
|---|---|
| ١ | 🔴 **كل نشرة Preview تكتب على قاعدة الإنتاج** — أي اختبار Wave 0 يلمس بيانات عملاء حقيقية |
| ٢ | **يخالف نصّ الأمر مباشرة:** الاختبارات على Preview/Local حصرًا، **أبدًا على Production** — والشرط يصبح مستحيل التحقيق |
| ٣ | **تجميد الدفع G3 لا يُرفع** ⇒ كل موجة تبقى محلية غير قابلة للنشر |
| ٤ | **بذر بيانات وهمية للتجارب (`V2-7.7-A`) يصبح كارثيًا** — بيانات وهمية داخل الإنتاج، وهو الخطر المحذوف نفسه |
| ٥ | **آثار جانبية خارجية:** فواتير Zoho حقيقية · رسائل واتساب لعملاء حقيقيين · بريد من هوية كيان — كلها من نشرة تجريبية |
| ٦ | **تشغيل `db-backup` (`V2-0.4-A`) على القاعدة الخطأ** |

---

# ملخّص تنفيذي

| # | السؤال | الأداة | يستغرق | إن فشل |
|---|---|---|---|---|
| **١** | `authz_fixA..D` مطبَّقة؟ | `docs/SECURITY_POST_APPLY_VERIFICATION.sql` **+ استعلامات Fix D** في §١.٤ (الملف لا يغطيه) | ~٥ دقائق | 🔴 ثغرة تسريب بيانات مفتوحة |
| **٢** | Phase B مطبَّقة؟ | استعلام §٢.٤ | ~٢ دقيقة | 🟠 الأعمدة المالية مقروءة لأي `authenticated` |
| **٣** | المسار العام سليم؟ | متصفح خفي — §٣.٤ | ~٥ دقائق | 🔴 فقدان صامت لطلبات العملاء |
| **٤** | Preview منفصل؟ | لوحتا Vercel وSupabase + Network — §٤.٣ | ~١٠ دقائق | 🔴 Preview يكتب على الإنتاج |

**المجموع: ~٢٢ دقيقة تحسم أربعة أسئلة تحجب GATE A بأكمله.**

## ترتيب التنفيذ الموصى به

**١ → ٢ → ٤ → ٣**

**لماذا:** السؤالان ١ و٢ يكشفان **ثغرات أمنية مفتوحة** — وهما استعلامان للقراءة فقط
بلا أي أثر. السؤال ٤ يحدد إن كان بالإمكان اختبار أي شيء بأمان أصلًا. والسؤال ٣
**متروك للأخير عمدًا** لأنه الوحيد الذي **يكتب صفًّا حقيقيًا** — وإن ظهر من السؤال ٤
أن Preview يشير إلى الإنتاج، فأنت تعرف مسبقًا أن الاختبار سيكتب في قاعدة الإنتاج
وتقرّر ذلك بوعي.

## ما تحتاجه مني بعد التشغيل

أرسل **نتائج الاستعلامات كما هي** (لا تحوي بيانات شخصية — أعمدة منطقية وأعداد فقط) +
كلمة «متطابق/مختلف» للسؤال ٤ + PASS/FAIL للسؤال ٣. عندها:
- أُحدِّث [`DATABASE_APPLICATION_STATUS.md`](DATABASE_APPLICATION_STATUS.md) §٧ و§٨ بحقائق مُثبَتة بدل `❓`
- أُحدِّث `MANUAL_ACTIONS_QUEUE.md` لـ`M-012`
- أُغلق أسئلة GATE A أرقام ١ و٢ و٣ و٤ في
  [`V2_1_EXECUTIVE_SUMMARY_AR.md`](V2_1_EXECUTIVE_SUMMARY_AR.md)

---

⛔ **GATE A غير معتمد. Wave 0 لم تبدأ. لم يُنفَّذ أي شيء من هذا المستند.**
