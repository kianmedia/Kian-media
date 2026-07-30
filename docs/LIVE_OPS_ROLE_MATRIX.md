# مصفوفة الصلاحيات — لوحة العمليات المباشرة

> الحزمة: `docs/live_operations_dashboard_{PREFLIGHT,RUNME,POSTCHECK,ROLLBACK}.sql`
> البادئة: `liveops_` · التبويب: `/client-portal/live-operations` · سطح العميل: `/live-status#<token>`

هذا المستند **وصف لما تفعله القاعدة**، لا نيّة. كلّ سطر هنا قابل للتحقّق من
`POSTCHECK` أو من `tests/liveops_*.test.js`. لو اختلف السلوك عن الجدول فالجدول
خاطئ ويُصحَّح، لا العكس.

---

## ١) المفاتيح الخمسة

| المفتاح | الحساسية | ما يفتحه |
|---|---|---|
| `live_ops.view` | عادية | فتح اللوحة وقراءة الجلسات |
| `live_ops.operate` | عادية | تشغيل جلسة: الحالة، الجرد، الشبكة، الرَّنداون، فتح الحوادث |
| `live_ops.manage` | حسّاسة | إدارة الوحدة كاملة، اعتماد ملخّص العميل، نشر التنبيهات، اعتماد الأسماء |
| `live_ops.client_link` | حسّاسة | إنشاء/إصدار/إلغاء روابط متابعة العميل |
| `live_ops.report_approve` | حسّاسة | اعتماد تقرير ما بعد الفعالية |

تُبذَر هذه المفاتيح في `public.permissions` **إن كان الكتالوج مطبَّقًا**. لو كان
غائبًا فالبوّابات تعتمد على المالك/الأدمن وحدهما — أي أضيق، لا أوسع.

---

## ٢) من يستطيع ماذا

| الفعل | الدالّة | البوّابة |
|---|---|---|
| فتح اللوحة | `liveops_session_list` / `_detail` | `liveops_can_view()` — موظّف فقط |
| إنشاء جلسة | `liveops_session_upsert` | `liveops_can_operate()` |
| **تغيير الحالة** | `liveops_session_set_status` | `liveops_can_operate_session()` + مُشغِّل BEFORE UPDATE |
| الجرد الفنّيّ | `liveops_inventory_*` | `liveops_can_operate_session()` |
| حالة الشبكة | `liveops_health_record` | `liveops_can_operate_session()` |
| الرَّنداون والإشارات | `liveops_rundown_*` / `_cue_log` | `liveops_can_operate_session()` |
| فتح/معالجة حادثة | `liveops_incident_open` / `_resolve` | `liveops_can_operate_session()` |
| **اعتماد ملخّص العميل** | `liveops_incident_update` | `liveops_can_manage()` |
| **الإفراج عن السبب الجذريّ** | `liveops_incident_release_root_cause` | `liveops_can_reveal_root_cause()` = إدارة |
| نشر تنبيه | `liveops_bulletin_upsert` (`is_published`) | `liveops_can_manage()` |
| اعتماد اسم يظهر للعميل | `liveops_client_person_upsert` | `liveops_can_manage()` |
| تحرير التقرير | `liveops_report_upsert` | `liveops_can_operate_session()` |
| **اعتماد التقرير** | `liveops_report_approve` | `liveops_can_approve_report()` |
| روابط العميل | `liveops_link_*` | `liveops_can_issue_client_link()` |
| **سطح العميل** | `liveops_client_view` | لا دور تطبيقيّ — `service_role` فقط |

`liveops_can_operate_session()` تعني: **مدير/مالك**، أو حامل `live_ops.operate`،
أو مُسنَد إلى هذه الجلسة بعينها (مدير عمليات / مخرج بثّ / مدير فنّيّ / منشئها).

---

## ٣) ⛔ العميل — ثلاث طبقات، لا واحدة

**العميل لا يغيّر الحالة أبدًا.** الطبقات الثلاث مستقلّة، وسقوط أيّ منها لا يفتح الباب:

1. **لا سياسة كتابة** على أيّ جدول في الوحدة. كلّ سياسة `for select` فقط، فلا
   يوجد مسار PostgREST للكتابة أصلًا.
2. **الدالّة** `liveops_session_set_status` تشترط `liveops_can_operate_session`،
   وهذه ترفض العميل في **سطرها الثاني** — قبل النظر في أيّ مفتاح صلاحية. فلو
   مُنح عميل مفتاح `live_ops.operate` بالخطأ يومًا، لا يزال مرفوضًا.
3. **مُشغِّل `BEFORE UPDATE`** يعيد حساب الجواب من القاعدة ويرفع استثناءً. يصمد
   أمام سياسة خاطئة تُضاف لاحقًا، وأمام كتابة مباشرة على الجدول.

كذلك: التبويب غائب عن مجموعتَي `client` و`lead` في `components/portal/nav.ts` —
وهذه **مجاملة تنقّل، لا ضابط**. الضابط في الطبقات الثلاث أعلاه.

---

## ٤) الحدود مع الوحدات الأخرى

* **لا مفتاح أجنبيّ** نحو `projects` ولا `ops_jobs` ولا `deliverables`. المرجعان
  `project_id` و`prodops_job_id` **قراءة فقط**، ووجودهما يُتحقَّق منه داخل
  الدالّة باكتشاف ميزة. مفتاح أجنبيّ كان سيمنع حذف مشروع من وحدة أخرى — وهذا
  تعديل في سلوك وحدة مجمَّدة.
* لا `insert`/`update`/`alter` على أيّ جدول من المنصّة المجمَّدة أو من الوحدات
  الاثنتي عشرة المكتملة. `tests/liveops_sql_package.test.js` يفشل لو تغيّر ذلك.
* `notify()` اختياريّ ومعزول بالاستثناء: مسار إشعارات معطوب لا يُسقط بثًّا مباشرًا.

---

## ٥) التدقيق

كلّ فعل حسّاس يكتب صفًّا في `liveops_audit`: إنشاء جلسة، تغيير حالة (**بما فيه
المرفوض**)، فتح حادثة، اعتماد ملخّص عميل، الإفراج عن سبب جذريّ (مع السبب
المكتوب)، إصدار رابط، إلغاؤه، اعتماد تقرير.

`liveops_link_access_log` يحفظ **المحاولات المرفوضة** كما يحفظ المقبولة، وبصمة
زائر مملَّحة ومُجزّأة (لا IP خامّ ولا user-agent). سجلّ يحفظ النجاح وحده يجعل
تخمين الرموز غير مرئيّ.

قراءة `liveops_audit` للإدارة وحدها.
