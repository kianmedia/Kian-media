# مصفوفة صلاحيات وحدة المبيعات · CRM role matrix

**النطاق:** `docs/crm_sales_FOUNDATION_RUNME.sql` · **الفرض:** في قاعدة البيانات
حصرًا. كلّ ما في الواجهة تجميل، وكلّ استدعاء يمرّ بمُسنَد `SECURITY DEFINER`.

> **القاعدة الحاكمة:** إخفاء الزرّ ليس تصريحًا. لا يوجد على أيّ جدول `crm_*`
> سياسة `INSERT/UPDATE/DELETE` إطلاقًا — الكتابة كلّها عبر RPC مُدقَّقة.

---

## ١) المفاتيح الأحد عشر

| المفتاح | الحسّاسية | ماذا يمنح |
|---|---|---|
| `crm.view` | عاديّ | فتح الوحدة ورؤية **سجلّاتك أنت** |
| `crm.manage` | حسّاس | رؤية وتحرير **كلّ** سجلّات المبيعات، إسناد المالك، الحذف |
| `crm.view_team` | حسّاس | رؤية سجلّات **أعضاء فرقك التي تديرها** (اطّلاع لا تحرير) |
| `crm.manage_pipeline` | حسّاس | تحرير خطوط الأنابيب والمراحل |
| `crm.import` | حسّاس | استيراد CSV |
| `crm.export` | عاديّ | تصدير CSV لما تراه أنت |
| `crm.view_commission` | حسّاس | رؤية عمولات **الآخرين** ونِسَب الخطط |
| `crm.manage_commission` | حسّاس | إنشاء الخطط وإسنادها واعتماد السجلّات |
| `crm.manage_targets` | حسّاس | تعيين أهداف **الآخرين** |
| `crm.manage_scoring` | حسّاس | تحرير قواعد درجة العميل وتجاوز الدرجة |
| `crm.handoff` | عاديّ | تسجيل أنّ مشروع فرصة مربوحة أُنشئ يدويًّا |

**قرار تصميم مقصود ومُختبَر:** `crm.manage` **لا** يمنح `crm.view_commission`.
مدير المبيعات ليس بالضرورة مخوّلًا بالرواتب. الفصل يُفحص في §13 من الترحيلة
وفي `tests/crm_commission_isolation.test.js`.

### ★ ما ليس مفتاحًا: اعتماد المالك

`crm_can_approve_changes()` **ليست** صلاحية في الكتالوج ولا تُمنح لأحد. هي
`is_owner() OR is_admin()` فقط، وهي البوّابة الوحيدة التي **يقع عندها** تغيير هدف
مبيعات أو قاعدة عمولة.

> لو كان الاعتماد مفتاحًا لأمكن منحه، ولانتهت «موافقة المالك» إلى منحة إداريّة
> تُعطى مرّة وتُنسى. لذلك لا يوجد `crm.approve` في الكتالوج، والترحيلة تفشل إن
> ظهر `crm_perm` داخل تعريف المُسنَد.

مَن يحمل `crm.manage_targets` أو `crm.manage_commission` **يقترح** فقط: الاستدعاء
يعود بـ`pending_approval: true` ولا يتغيّر صفّ واحد. راجع
`docs/CRM_MANUAL_ACCEPTANCE.md` §٣ للاختبار اليدويّ.

---

## ٢) من يرى ماذا

| الدور | العملاء المحتملون / الفرص | العمولات | الأهداف | التدقيق |
|---|---|---|---|---|
| **المالك / الأدمن** | الكلّ | الكلّ | الكلّ (ويحرّر هدفه هو) | الكلّ |
| **مدير مبيعات** (`crm.manage`) | الكلّ | **عمولته هو فقط** ما لم يُمنح `crm.view_commission` | يرى ما يراه من سجلّات؛ يعيّن أهداف غيره بـ`crm.manage_targets` ولا يعيّن هدفه هو | نعم |
| **مدير فريق** (`crm.view` + `crm.view_team` + مدير فريق فعليّ) | سجلّاته + سجلّات أعضاء فرقه — **اطّلاع فقط** | عمولته هو فقط | هدفه وأهداف فريقه (اطّلاع) | لا |
| **موظّف مبيعات** (`crm.view`) | سجلّاته هو فقط | عمولته هو فقط | هدفه (اطّلاع، بلا تحرير) | لا |
| **موظّف بلا مفاتيح** | لا شيء | لا شيء | لا شيء | لا |
| **عميل / زائر** | **لا شيء إطلاقًا** | — | — | — |

### «رؤية الفريق» ثلاثة شروط مجتمعة

`crm_can_view_team()` تُرجع `true` فقط حين تتحقّق الثلاثة معًا:

1. المفتاح `crm.view_team` **موجود ومفعَّل** في `public.permissions`،
2. و**مُنح** للجلسة عبر `emp_has_permission`،
3. والجلسة **مديرة فريق فعليّ** (`crm_teams.manager_user_id`).

سقوط أيّ شرط ⇒ «نفسي فقط». الصياغة في المتطلّب — «يرى فريقه **إن وُجدت تلك
الصلاحية**» — مُنفَّذة حرفيًّا: غياب المفتاح لا يُترجَم إلى منح ضمنيّ، ولا إلى
توسيع الرؤية.

---

## ٣) الحدود الأربعة الصلبة

### أ) الموظّف لا يرى عمولة غيره ولا نسبته

* `crm_can_view_commission(p_user)` = `p_user = auth.uid()` **أو** المالك/الأدمن
  **أو** `crm.view_commission`. لا شيء آخر، وتحديدًا **ليس** `crm.manage`.
* سياسات RLS على `crm_commission_records` و`crm_commission_assignments` تستعمل
  المُسنَد نفسه.
* `crm_commission_list` تُصفّي بالمُسنَد لا بالمعامل: تمرير `user_id` لزميلك
  يعيد صفرًا، لا خطأً مُضلِّلًا ولا بيانات.
* `crm_opportunity_detail` تُعيد `commission: null` مع `commission_visible:false`
  لمن لا يملك الرؤية — والواجهة تشرح السبب بدل عرض شاشة فارغة.
* نِسَب **الخطط** (`crm_commission_plans.rate_pct`) لا يراها الموظّف إطلاقًا؛
  نسبته هو تصله داخل سجلّه هو.
* `crm_export` لا يُخرج أعمدة عمولة أو نِسَب في أيّ كيان — التصدير ليس بابًا خلفيًّا.

### ب) الموظّف لا يحرّر هدفه ولا عمولته، وحاملُ المفتاح لا يعتمد

* `crm_target_upsert` و`crm_target_delete`: إن كان `owner_user_id = auth.uid()`
  ولم تكن الجلسة للمالك/الأدمن ⇒ `self_target_denied`.
* `crm_commission_assign`: إسناد خطّة لنفسك ⇒ `self_commission_denied`.
* `crm_commission_set_status`: اعتماد عمولتك أنت ⇒ `self_commission_denied`.
* الأربعة مفحوصة في §13 من الترحيلة وفي POSTCHECK §14.

**والطبقة الثانية (اعتماد المالك):** المسارات الأربعة أدناه تمرّ كلّها على
`crm_can_approve_changes()`، وغير المالك يخرج منها بطلب معلَّق لا بتغيير:

| المسار | نوع الطلب | ماذا يعود لغير المالك |
|---|---|---|
| `crm_target_upsert` | `target` | `pending_approval: true` + `request_id` |
| `crm_target_delete` | `target_delete` | `pending_approval: true` + الهدف باقٍ |
| `crm_commission_plan_upsert` | `commission_plan` | `pending_approval: true` + لا نسبة تغيّرت |
| `crm_commission_assign` | `commission_assign` | `pending_approval: true` + لا إسناد وقع |

* **الطلب المعلَّق ليس تغييرًا:** لا يُقرأ في `crm_targets_list` ولا في
  `crm_forecast` ولا في أيّ حساب عمولة. هو نيّة موثَّقة فقط.
* `crm_approval_decide(id, 'approved'|'rejected', note)` للمالك وحده، بقفل صفّ،
  ولا يُتّخذ مرّتين (`already_decided`)، ويُطبَّق **باسم المعتمِد**.
* فشل التطبيق لا يُخفى: يُحفظ في `apply_error` ويبقى الطلب معلَّقًا.
* `crm_approval_withdraw` لصاحب الطلب أو للمالك — لا لطرف ثالث.
* رؤية الطلبات: المالك يرى الكلّ، وصاحب الطلب يرى طلبه هو. الطلب يحمل قيمة هدف
  أو نسبة عمولة، وهي بيانات حسّاسة قبل الاعتماد وبعده.

### ج) العميل لا يملك أيّ وصول

* `crm_can_view()` تشترط `is_staff()`. العميل يسقط في **كلّ** سياسة قراءة وفي
  **كلّ** دالّة كتابة.
* التبويب غائب عن مجموعتَي `client` و`lead` في `components/portal/nav.ts`، وهذا
  تجميل: الرابط المباشر `/client-portal/crm` يُظهر «لا تملك صلاحية» لأنّ القاعدة
  ترفض، لا لأنّ الواجهة أخفت.

### د) التحرير أضيق من القراءة

`crm_can_edit_lead` / `crm_can_edit_opportunity` = `crm.manage` **أو** ملكية
السجلّ. مديرُ فريقٍ يملك الاطّلاع فقط **يقرأ ولا يحرّر**.

---

## ٤) الرؤية حسب نوع السجلّ

| الجدول | سياسة القراءة |
|---|---|
| `crm_approval_requests` | `crm_can_approve_changes()` **أو** (`crm_can_view()` و`requested_by = auth.uid()`) |
| `crm_leads` · `crm_opportunities` | `crm_can_see_owner(owner_user_id)` |
| `crm_stage_history` | `crm_can_read_opportunity(opportunity_id)` |
| `crm_activities` | قراءة الأب (عميل محتمل أو فرصة) |
| `crm_companies` · `crm_contacts` | المملوكة: `crm_can_see_owner`؛ غير المملوكة (`owner_user_id is null`): مشتركة لكلّ من يملك `crm.view` |
| `crm_targets` | `crm_can_see_owner(owner_user_id)` |
| `crm_commission_records` · `crm_commission_assignments` | `crm_can_view_commission(user_id)` |
| `crm_commission_plans` | `crm_can_manage_commission()` أو `crm_can_view_commission(null)` |
| `crm_import_batches` | `crm.manage` أو دفعاتك أنت |
| `crm_audit` | `crm.manage` فقط |
| المراجع (`crm_settings` · `crm_teams` · `crm_stages` · `crm_pipelines` · `crm_competitors` · `crm_lead_score_rules`) | `crm_can_view()` |

**ملاحظة مقصودة:** الشركات وجهات الاتصال **غير المملوكة** مشتركة داخل فريق
المبيعات. البديل — عزلها بالكامل — يجعل كشف التكرار عديم الفائدة ويُنتج ثلاث
نسخ من الشركة نفسها. المملوكة تبقى مقيَّدة بمالكها.

---

## ٥) كشف التكرار لا يسرّب

`crm_duplicate_core` تُظهر **وجود** سجلّ مطابق لأنّ ذلك هو الغرض كلّه، لكنّها
تحذف كلّ حقل بيانات عن السجلّ الذي لا تملك رؤيته وتضع مكانه:

> «سجلّ مطابق مُسنَد إلى زميل آخر — التفاصيل خارج صلاحيتك. راجع مدير المبيعات.»

---

## ٦) ما لا تفعله الوحدة

* لا تعتمد على `can_manage_projects` (مفحوص آليًّا في §13).
* لا تكتب في `projects` / `project_core` / `deliverables` / `quote_requests`.
* لا تمنح `anon` أيّ صلاحية على أيّ جدول أو دالّة.
* لا تستعمل `service_role` في كود المتصفّح.
* لا تُنشئ محرّك صلاحيات ثانيًا: المفاتيح تُضاف إلى `public.permissions` القائم.

---

## ٧) الفحص السريع بعد التطبيق

```sql
-- كلّها يجب أن تعيد false بدور postgres (auth.uid() = NULL)
select public.crm_can_view(), public.crm_can_manage(),
       public.crm_can_view_team(), public.crm_can_view_commission(null),
       public.crm_can_manage_targets();

-- يجب أن يعيد صفر صفّ
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename like 'crm\_%' and cmd <> 'SELECT';
```

التفاصيل الكاملة في `docs/crm_sales_FOUNDATION_POSTCHECK.sql`.
