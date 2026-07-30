# عقود البيانات العابرة للموديولات

> **الغرض:** توثيق كلّ نقطة يقرأ فيها موديول من موديول آخر — التوقيع، والمفاتيح
> المقروءة، والحدود، وما يحدث عند الغياب أو المنع. تغييرُ أيّ صفّ هنا في الموديول
> المصدر **يكسر** قارئه بصمت ما لم يُعدَّل معه.
>
> ⚠️ كلّ ما يلي مستخرَج من نصّ الملفّات، لا من قاعدة حيّة. لم يُشغَّل شيء.

---

## 1. الخريطة في سطر واحد

```
comms_*   ──┐
prodops_* ──┤
crm_*     ──┼──► mgmt_read_jsonb ──► mgmt_compute ──► mgmt_dashboard ──► ExecDashboard
finops_*  ──┘        (قراءة فقط، ببوّابة الموديول المصدر)

public.notify()      ◄── prodops_notify · crm_notify        (إشعار داخل التطبيق)
public.permissions   ◄── ops · crm · fin · mgmt             (بذر مفاتيح بـon conflict)
public.notifications ◄── ops · crm                          (قيد شكل entity_type)
public.projects      ◄── ops · crm · fin                    (قراءة الاسم + FK فقط)
```

**اتّجاه واحد فقط.** لا موديول مصدر يعرف بوجود لوحة التقارير، ولا يستدعيها، ولا
يتغيّر سلوكه بحضورها. حذف الحزمة الخامسة كلّها لا يمسّ الأربع الأولى.

---

## 2. القاعدة الحاكمة للقراءة العابرة

`mgmt_read_jsonb(p_sig, p_call, p_args, p_module, p_runme)` —
`executive_reporting_RUNME.sql:294`

1. **اكتشاف قبل القراءة:** `to_regprocedure(p_sig)`. الغياب ⇒
   `state='unavailable'`, `reason='module_not_installed'`، ومعه **اسم ملفّ الـRUNME
   المطلوب**. ليس صفرًا، وليس خطأً.
2. **الاستدعاء ديناميكيّ باسم الدالّة**، فتُقيَّم بوّابة الموديول المصدر على
   `auth.uid()` الحقيقيّ. `SECURITY DEFINER` يغيّر مالك التنفيذ لا هويّة الجلسة.
   **هذه اللوحة لا تمنح رؤية جديدة لأحد.**
3. **تصنيف أمين للفشل** عبر `mgmt_classify` (`:273`):
   `42501` أو نصّ فيه `not authorized`/`لا تملك صلاحية` ⇒ `restricted` ·
   `42883`/`42P01` ⇒ `unavailable` · ما عداه ⇒ `error` برمز الحالة وحده
   (**لا نصّ الخطأ**، فلا يتسرّب اسم جدول أو قيمة).
4. **لا قيمة إلّا في الحالة `ok`.** نقطة الاختناق `mgmt_kpi` (`:254`) تُصفّر
   `value` و`count` و`detail` في كلّ حالة أخرى. لا مسار ثانٍ لبناء مؤشّر.

---

## 3. العقود الأربعة بالتفصيل

### 3.1 الاتّصالات → `public.comms_health()`

*المصدر:* `communications_hub_RUNME.sql:934` · *القارئ:* `mgmt_compute` قسم
الاتّصالات.

| المفتاح المقروء | المؤشّر | ملاحظة |
|---|---|---|
| `ok` | — | ★ **خاصّية فريدة:** هذه الدالّة **لا ترفع استثناءً** عند المنع، بل تعيد `{ok:false, error:'not_authorized'}`. لو قُرئت كنجاح لأنتجت أصفارًا. لذلك يترجمها القارئ يدويًّا إلى `restricted` — `executive_reporting_RUNME.sql:458`. **أيّ تغيير يجعلها ترفع استثناءً يجب أن يُزيل تلك الترجمة.** |
| `counts.queued` + `counts.retrying` + `counts.processing` | `notifications_pending` | مجموع الثلاثة |
| `counts.failed` + `counts.dead_letter` | `notifications_failed` | مجموع الاثنين |
| `oldest_runnable_at` | `detail` | للعرض |

*ما لا يُقرأ عمدًا:* `sent_live` و`mirrored_legacy` و`legacy_email_deliveries` —
اللوحة لا تدّعي تسليمًا.

### 3.2 التشغيل → `prodops_dashboard(jsonb)` · `prodops_conflicts(jsonb)` · `prodops_calendar(date,date,jsonb)`

| المصدر | السطر | المقروء | المؤشّر |
|---|---|---|---|
| `prodops_dashboard` | ops:1648 | `today[]` · `next_7_days[]` وحقل `readiness` في كلّ صفّ | `operational_readiness` |
| | | `counters.missing_crew/equipment/permits/media_not_backed_up` | `detail` فقط — **لا تدخل الحساب** |
| `prodops_conflicts` | ops:1484 | `total` · `internal[]` · `external.items[]` · `external.sources` | `resource_conflicts` |
| `prodops_calendar` | ops:1455 | `days[]` (صفوف مهامّ لا أيّامًا — الاسم مضلّل ومقصود توثيقه) | `upcoming_jobs` |

**عقدان دقيقان لا يُخالَفان:**

* **الجاهزية = متوسّط `readiness` لصفوف النافذة نفسها.** الدرجة تأتي من
  `prodops_readiness_core` (ops:1175) وهي ٠…١٠٠ على ثمانية فحوص مطلوبة على الأقلّ.
  ★ عدّادات النقص محسوبة على نوافذ **أخرى** — ١٤ يومًا للطاقم والمعدّات و٢١
  للتصاريح — ومهمّة ناقصة في ثلاثة أوجه تظهر في العدّادات الثلاثة. طرحها من مقام
  ٨ أيام كان يعطي ٠٪ لفريق جاهز تمامًا. `detail.counters_window_note_ar` تقول ذلك
  للقارئ.
* **`prodops_calendar` تصحّح المدى المقلوب بجعل `to = from`.** فتمرير نافذة
  ماضية بالكامل كان سيُعيد **مهامّ اليوم** إجابةً عن سؤال عن الماضي. القارئ يمنع
  ذلك قبل الاستدعاء ويعيد `no_basis / window_entirely_in_past`.

### 3.3 المبيعات → `crm_dashboard(jsonb)` · `crm_leads_list(jsonb)`

| المفتاح | السطر | المؤشّر | الحدّ |
|---|---|---|---|
| `counters.pipeline_value` | crm:1849 | `pipeline_value` **(حسّاس)** | — |
| `counters.weighted_value` | | `weighted_forecast` **(حسّاس)** | — |
| `counters.opps_open` · `awaiting_handoff` | | `detail` | — |
| `stale.rows[]` | ← `crm_stale_alerts` crm:1704 | `stalled_opportunities` | **سقف ٢٠٠ صفّ** |
| `forecast.rows[]` | ← `crm_forecast` | `detail` (٦ أشهر) | — |
| `currency` | | `detail` | افتراضًا `SAR` |
| `rows[].created_at` | ← `crm_leads_list` crm:1451 | `new_leads` | **سقف ٥٠٠ صفّ** |

★ **الحدود تُعلَن كحدود لا كأعداد نهائية.** إن بلغت قائمة العملاء المحتملين السقف
ولم تُغطَّ النافذة (أقدم صفّ أحدث من `from`) يُوسَم المؤشّر
`detail.is_lower_bound = true` وتُعرض القيمة **`≥ ن`** في الواجهة
(`lib/portal/execReport.ts:326-330`). المعالجة نفسها لقائمة المتعثّر عند ٢٠٠.

**تغيير هذين السقفين في الموديول المصدر يجب أن يُرافقه تغيير `source_row_cap`
في `mgmt_compute`** — وإلّا صار الوسم كاذبًا في أحد الاتّجاهين.

### 3.4 المالية → `finops_dashboard(jsonb)`

*المصدر:* `finance_profitability_RUNME.sql:1739`.
★ **لا تُستدعى أصلًا لغير المالك** — `executive_reporting_RUNME.sql:692`. ليس
«تُستدعى ثمّ يُحجَب الناتج»: لو استُدعيت لتسرّب عبر تنبيه أو تفصيل حتى **عدد**
الذمم المتأخّرة.

| المفتاح | المؤشّر | الأساس |
|---|---|---|
| `counters.actual_cost_gross` | `expenses` | **شامل الضريبة** |
| `counters.committed_cost_gross` | `commitments` | شامل الضريبة |
| `counters.overdue_gross` · `overdue_count` | `overdue_collections` | شامل الضريبة |
| `counters.outstanding_gross` · `aging` | `detail` | ← `finops_receivables` fin:1542 |
| `profit_visible` (boolean) | بوّابة | **يُحترَم حرفيًّا** ولو كانت بوّابة العرض أوسع |
| `profit.estimated_net_profit` | `estimated_profitability` | ← `finops_profit_core` fin:1199 |
| `profit.gross_profit_net` · `gross_margin_pct` · `estimated_net_margin_pct` | `detail` | **صافي قبل الضريبة** |

> ★ **اختلاف أساس مقصود ومكتوب:** المصروفات والالتزامات والتحصيل **شاملة
> الضريبة** (`basis: gross_incl_vat`)، والربحية **صافية قبلها**
> (`basis: net_of_vat`). الضريبة تُحصَّل لصالح الدولة فلا تدخل ربحًا ولا تكلفةً،
> لكنّها جزء من الالتزام النقديّ الفعليّ. خلط الأساسين في شاشة واحدة بلا تصريح هو
> أشيع كذبة في اللوحات المالية — لذلك كلّ مؤشّر يحمل `detail.basis`.
> و`estimated_profitability` يحمل `is_estimate: true` ونصًّا يقول إنّه لا يقوم
> مقام الدفاتر المحاسبية.

---

## 4. الحالات الخمس — القاموس المشترك

| الحالة | متى | ماذا تعني للقارئ |
|---|---|---|
| `ok` | قراءة ناجحة | **رقم حقيقيّ.** الصفر هنا صفر. |
| `unavailable` | الموديول غير مطبَّق (`42883`/`42P01`) | «لا نعرف» + اسم ملفّ الـRUNME |
| `restricted` | المنع (`42501` / `not authorized` / `ok:false`) | «محجوب عنك» — منع مقصود |
| `no_basis` | لا أساس للحساب | لا مهامّ ⇒ لا نسبة · لا درجات ⇒ لا متوسّط · نافذة ماضية ⇒ لا «قادم» |
| `filtered_out` | القسم خارج مرشّح المستخدم | يُخفى القسم في الواجهة |
| `error` | ما عدا ذلك | رمز الحالة وحده، بلا أيّ نصّ داخليّ |

**العقد الحاسم:** `value` و`count` **`null`** في كلّ حالة غير `ok`، وطبقة الـTS
لا تُصلح ذلك ولا تستبدله بصفر — `lib/portal/execReport.ts:292-295` (لا `?? 0` في
الملفّ إطلاقًا)، و`execRowsToCsv` تُخرج خليّة **فارغة** لا صفرًا
(`:404-417`).

---

## 5. العقود مع البنية التحتية المشتركة

### 5.1 كتالوج الصلاحيات `public.permissions`

أربع حزم تبذر مفاتيحها بـ`insert … on conflict (key) do update`. كلّ حزمة تلمس
**بادئتها وحدها**: `operations.*` · `crm.*` · `finance_ops.*` · `exec_report.*`.
لا تقاطع، ولا حذف. غياب الجدول ⇒ إشعار وتخطٍّ، والموديول يعمل للمالك وحده
(fail-closed).

### 5.2 `public.notify()` — الإشعار داخل التطبيق

| البند | القيمة |
|---|---|
| التوقيع | `public.notify(uuid, text, text, text, uuid, text, text)` |
| المستدعون الجدد | `prodops_notify` (ops:738) · `crm_notify` (crm:979) |
| `entity_type` المكتوب | `'ops_job'` · `'crm_opportunity'` |
| `type` المكتوب | `ops_crew_assigned` · `ops_post_handoff` · `crm_opportunity_won` |
| بريد؟ | **لا.** جسر البريد `pc_notify_email_bridge` مقصور على سبعة أنواع مشاريع/مخرجات، وهذه الثلاثة ليست منها. |
| المالية | **لا تُشعر أحدًا** داخل التطبيق. |

> ★ **قيد `entity_type` عقدٌ ضمنيّ كان مكسورًا.** `phase0_migration.sql:285`
> يحصره في خمس قيم لا تشمل `ops_job` ولا `crm_opportunity`، فكان القيد يرفع
> `23514` وتبتلعه المصيدة ⇒ إشعار مفقود بصمت. الحزمتان الآن تستبدلان التعداد بقيد
> **شكل** `'^[a-z][a-z0-9_]{2,40}$'` — نفس العلاج المعتمَد لـ
> `notifications_type_check` في 9C — فيكتب كلّ موديول مفرداته بلا تنسيق مع غيره.
> الكتلة **نفسها حرفيًّا** في الحزمتين ومتساوية القوّة الذاتية، فترتيب التشغيل
> لا يهمّ. وإن خالف صفٌّ قائم الشكل الجديد: إشعار صريح، والقيد يبقى، ولا تسقط
> الترحيلة. التفصيل في `docs/CROSS_MODULE_SECURITY_AUDIT.md` §7-أ.

### 5.3 `public.projects` — قراءة وربط فقط

| ما يجري | الحزم | الشكل |
|---|---|---|
| اكتشاف الوجود | ops · crm · fin | `to_regclass('public.projects')` |
| مفتاح خارجيّ | ops:241 · crm:596 · fin:908 | `references public.projects(id) on delete set null` |
| قراءة الاسم | ops:769 · crm:1136 · fin:1023 | ★ اسم العمود **يُكتشف من الكتالوج** بالترتيب `project_name` → `title` → `name`، ولا يُخمَّن: تخمينه سبق أن أنتج `42703` وأسقط عملية كاملة |

**لا `insert`/`update`/`delete` على `projects` أو `project_core` أو `deliverables`
في أيّ حزمة.** ولوحة التقارير لا تذكر المنصّة إطلاقًا ولا بالقراءة، ويحرس ذلك
اختبارها الذاتيّ وPOSTCHECK §12.

**تحفّظ:** المفتاح الخارجيّ الوارد تبعيّة بنيويّة — حذف مشروع صار يكتب في صفوف
الموديولات (`set null`). لا يعدّل الجدول المجمَّد، لكنّه ليس «بلا أثر».

---

## 6. الاستقلال — ماذا يحدث حين يغيب موديول

**اعتماد صلب واحد مشترك:** `profiles` + `is_staff()` + `is_owner()` + `is_admin()`
(من `phase0_migration.sql` و`staff_roles_task_assignment_RUNME.sql`). ما عدا ذلك
اختياريّ ومكتشَف.

| الغائب | الأثر |
|---|---|
| `emp_has_permission` | كلّ `*_perm()` يعيد `false` ⇒ المالك وحده يعمل. **fail-closed** لا fail-open. |
| `public.projects` | الربط بالمشروع معطّل، والموديول يعمل. |
| `quote_requests` | مرجع عرض السعر معطّل في المبيعات. |
| `public.notify` | لا إشعار داخل التطبيق — والآن يُكتب سبب ذلك في سجلّ الموديول (`notify_unavailable`) بدل الصمت. |
| أيّ موديول مصدر | مؤشّراته في اللوحة `unavailable` باسم ملفّه، وبقيّة المؤشّرات **حيّة وصادقة** — كلّ مصدر معزول بمصيدته الخاصّة. |
| **كلّ** المصادر الأربعة | اللوحة تعمل وتقول ذلك صراحةً + تنبيه `blind_spots`. الترحيلة نفسها تُشعر بذلك (`executive_reporting_RUNME.sql:69-71`). |

★ **`blind_spots`:** أيّ مؤشّر `unavailable`/`error` يولّد تنبيهًا يقول «اللوحة
لا تعرف حالة ن مؤشّرًا — وهذا ليس ‹لا مشاكل›». الصمت عنه كان سيجعل لوحةً عمياء
تبدو نظيفة، وهو الفشل الذي بُنيت هذه الحزمة لمنعه.

---

## 7. ما يكسر هذه العقود — قائمة مراجعة قبل أيّ تعديل مستقبليّ

| التغيير في المصدر | يكسر | العلاج |
|---|---|---|
| `comms_health` تبدأ برفع استثناء عند المنع | ترجمة `ok:false` اليدوية | احذف الترجمة في `mgmt_compute:458` |
| إعادة تسمية `counters.*` في أيّ لوحة مصدر | المؤشّر يصير `error`/صفر | حدّث `mgmt_compute` |
| تغيير سقف ٥٠٠ / ٢٠٠ في المبيعات | وسم `is_lower_bound` يكذب | حدّث `source_row_cap` |
| إزالة `readiness` من صفوف `prodops_dashboard` | الجاهزية تصير `readiness_not_reported` (تتدهور بأمان) | أعد الحقل أو غيّر الأساس |
| تغيير أساس الضريبة في المالية | `detail.basis` يكذب | حدّث النصّ والمؤشّر معًا |
| تضييق `notifications_entity_type_check` مجدّدًا | إشعارات ops وcrm تُفقد | لا تفعل — انظر §5.2 وملفّي `*_ROLLBACK.sql` |

**كلّ بند في هذا الجدول له اختبار ذاتيّ ساكن يفشل عند خرقه، عدا الأوّل والأخير:
الأوّل سلوكيّ لا يُلتقَط نصًّا، والأخير يُلتقَط عند تشغيل حزمة ops أو crm فقط.**
