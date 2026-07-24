# مصفوفة الأدوار — Project Platform Role Matrix

> مصدر الأدوار: `lib/portal/roles.ts` (`caps()` / `viewRole()`) على الواجهة،
> ومجموعة دوال SECURITY DEFINER على القاعدة. **الوصول الفعليّ تفرضه القاعدة** (RLS +
> بوّابات الدوال)؛ الواجهة تعكسها فقط. اختبار الوصول الحقيقيّ = استدعاء الـRPC
> مباشرةً لا فحص الواجهة.

---

## 1) الأدوار

| الدور (`view`) | المصدر | ملاحظة |
|---|---|---|
| **Owner** (`admin`/`super_admin`) | `account_type='admin'` أو staff_role عليا | كل الصلاحيات؛ `is_owner()`. |
| **Management** (`manager`) | `staff_role='manager'` | إدارة المشاريع والتسليم النهائيّ. |
| **Project Manager / Editor** (`editor`) | `staff_role='editor'` | تحرير المشاريع المكلَّف بها. |
| **Employee** (`support`/`sales`/`hr`/`readonly`/…) | staff_role مختلف | طاقم بصلاحيات محدودة + النظام الحبيبيّ (117 صلاحية). |
| **Sponsor** | عضو حوكمة (5A `project_member_roles`) | حسب دور الحوكمة، لا staff_role. |
| **Client** (`client`/`lead`) | `account_type` غير admin ولا staff | جهة عميل؛ `is_staff()=false`. |

**حقيقة محوريّة**: `pc_can_read_project = staff_reads_all_projects() OR (is_staff()
AND can_access_project())`. العميل `is_staff()=false` ⇒ **لا يجتاز أيّ سطح طاقميّ
أبدًا**. سطحه الوحيد يمرّ بـ`is_client_owner`. مالكٌ `account_type='admin'` له
`caps.isStaff=false` على الواجهة لكن `is_staff()=true` على القاعدة (يغطّيه
`caps.isAdminArea` في الفحوص).

---

## 2) المصفوفة (قراءة R / كتابة W / — لا وصول)

| القدرة | Owner | Management | Editor/PM | Employee | Sponsor | Client |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| قائمة المشاريع (لوحة القيادة) | R | R | R (المكلَّف/عام) | R (المكلَّف) | R (المسنَد) | — |
| قراءة المشروع (project_core) | R | R | R | R (إن `is_staff`) | R (عضو) | — |
| كتابة المشروع/المرحلة | W | W | W (المكلَّف) | حسب الصلاحية | — | — |
| المهام (project_tasks) | RW | RW | RW | RW (المكلَّف) | R | — |
| الملفّات/المخرجات (طاقم) | RW | RW | RW | R حسب الصلاحية | R | — |
| مراجعة العميل للمخرجات | — | — | — | — | — | **RW** (client_review) |
| المخاطر/المشكلات (5A) | RW | RW | RW | R حسب الصلاحية | R | — (إلّا `client_visible`) |
| الاعتمادات (approvals) | RW | RW | RW | R | حسب الدور | — |
| الهرمية (ترقية/خفض/نقل) | W | W | W (can_edit) | — | — | — |
| البرامج (8A/8B/8D) | RW | RW | RW (can_edit) | R حسب `programs.*` | — | — (إلّا ملخّص client_visible) |
| القوالب (7A) | RW | RW | R/تطبيق | R | — | — |
| مركز العمليات (7B) | R | R | R (`is_staff`) | R (`is_staff`) | — | — |
| الإدارة التنفيذية (5B) | R | R | R (exec_visible) | — | — | — |
| الإغلاق/الأرشفة (5C/6C) | W | W | W (طاقم) | R | حسب الدور | — |
| مصفوفة تسليم SLA (8D) | R | R | R (programs.view) | R حسب الصلاحية | — | — |
| ملخّص برنامج العميل (8D) | — | — | — | — | — | **R** (is_client_owner + العلم) |
| المالية/التكاليف | RW (`can_see_financials`) | RW | R | حسب الصلاحية | — | — |
| التصدير (CSV/تقارير) | R | R | R | حسب الصلاحية | — | — |

**قواعد ثابتة تفرضها القاعدة:**
- **المالية معزولة**: بوّابة `can_see_financials()` / `caps.canSeeFinancials` (owner/manager/sales)؛ تبويب «الحسابات» يمرّ بـ`isFinance`.
- **التسليم النهائيّ**: `can_final_deliver()` = owner/manager فقط.
- **رؤية الأب لا تمنح رؤية الفرع تلقائيًّا في شيفرة المنصّة**: كل صفّ يُفحَص بذاته
  بـ`pc_can_read_project`/`is_client_owner` (تنبيه معماريّ قائم: العميل المالك للأب
  يرث `client_id` الفرع بحكم `project_core_create_project` — سلوك سابق موثَّق لا
  تُنشئه دفعات الطور 8).
- **العميل لا يرى**: مخاطر/مشكلات/حوكمة داخلية · موارد · تعارضات فريق · تقييمات ·
  مالية · قوائم إغلاق داخلية · التزامات غير `client_visible` · وحدات لا يملكها.

---

## 3) اختبار الوصول المباشر (لا الواجهة وحدها)

لكل دور، سجّل دخوله واستدعِ الـRPC مباشرةً عبر PostgREST:

- **عميل يستدعي سطحًا طاقميًّا** (`project_program_commitment_results`,
  `operations_command_center`, `executive_program_sla`) ⇒ يجب أن يعود
  `not authorized` (فشل `pc_can_read_project`/`is_staff`).
- **عميل يستدعي `project_program_client_summary`** على برنامجه المُفعَّل ⇒ ملخّص
  بلا أيّ حقل داخليّ؛ وعلى مشروع غيره ⇒ `not authorized`.
- **موظّف بلا `programs.commitments.manage`** يستدعي
  `project_program_commitment_upsert` ⇒ `not authorized`.
- **طاقم غير ماليّ** يقرأ `project_core_dashboard` ⇒ الحقول المالية محجوبة (null).
