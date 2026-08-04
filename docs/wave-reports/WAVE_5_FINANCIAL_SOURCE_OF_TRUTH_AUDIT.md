# WAVE 5 · W5-2 — تدقيق مصدر الحقيقة المالي

> **الحالة: UNVERIFIED · MANUAL PRODUCTION VERIFICATION REQUIRED.**
>
> ⛔ **لا نتيجة Production في هذا الملفّ.** كلّ ما فيه مقروء من **المستودع**:
> تعريفات جداول ودوالّ. ولم يُشغَّل استعلام واحد على قاعدة حيّة.
>
> الغرض: أن يعرف خالد **ما الذي يجب التحقّق منه** قبل بناء أيّ بند ماليّ، لا أن
> يُستنتَج الجواب هنا.

---

## ١. الخلاصة قبل التفصيل

| السؤال | الجواب من المستودع |
|---|---|
| هل يوجد مصدر ماليّ واحد؟ | ❌ **لا.** يوجد **نطاقان** يحملان أرقامًا: `fin_*` و`project_*` |
| هل يتداخلان؟ | 🔴 **نعم، في التكلفة تحديدًا** — `fin_costs` مقابل `project_expenses` (وهو D-5) |
| هل Zoho مصدر مخزَّن؟ | ❌ **لا.** لا جدول فواتير Zoho في المستودع — الموجود **مزامنة** لا تخزين |
| ما الذي يحسب مقابل ما يخزّن؟ | `pc_project_financials()` تحسب؛ وجداول `fin_*` تخزّن |
| هل يُحسم من هنا؟ | ❌ **لا.** الحسم يحتاج قراءة Production — §٥ |

---

## ٢. من يملك أيّ رقم

### أ) نطاق `fin_*` — دورة تحصيل كاملة

| الجدول | يملك | الحقول النقدية |
|---|---|---|
| `fin_payment_milestones` | **الدفعة المتّفق عليها** (خطّة السداد) | `amount_net` · `vat_rate` · `vat_amount` · `amount_gross` · `status` · `due_on` |
| `fin_receivables` | **المستحقّ** (مستند مطالبة) | `doc_no` · `amount_net` … · `issue_date` · `due_date` · `client_id` |
| `fin_collections` | **المحصَّل فعلًا** | `receivable_id` · `collected_on` · `amount_*` · `method` · `reference` |
| `fin_revenue` | **الإيراد المعترَف به** | `revenue_no` · `revenue_type` · `recognized_on` · `amount_*` |
| `fin_costs` | **التكلفة** | `cost_no` · `cost_type` · `commitment` · `budget_line_id` · `supplier_id` |

🔴 **ملاحظة بنيوية مهمّة:** كلّ جدول يحمل **ثلاثيّة** `net`/`vat`/`gross` مخزَّنة
معًا. أي أنّ `gross` **قيمة مخزَّنة لا محسوبة** — فإن اختلفت عن
`net + vat` في صفّ ما، فالصفّ نفسه متناقض داخليًّا. هذا أوّل ما يجب فحصه (§٥).

### ب) نطاق `project_*`

| الجدول | يملك | التداخل |
|---|---|---|
| `project_expenses` | **مصروف مشروع** بحقول `amount_excl_vat` · `vat_amount` · `unit_cost` · `quantity` | 🔴 **يتداخل مع `fin_costs`** — كلاهما «تكلفة على مشروع» |
| `project_core` | حالة المشروع ومرحلته | لا أرقام نقدية |

### ج) Zoho — تكامل لا مصدر

| الموجود | ما هو |
|---|---|
| `fin_zoho_outbox` · `zoho_sync_jobs` · `zoho_webhook_events` | **طوابير ومزامنة** |
| `zoho_entity_mappings` · `zoho_account_mappings` | **خرائط هويّة** بين النظامين |
| ❌ لا جدول فواتير Zoho | ⇒ Zoho **ليس** مصدرًا مخزَّنًا في هذه القاعدة |

⇒ **أيّ رقم «من Zoho» يعني نداءً خارجيًّا وقت العرض، لا صفًّا مقروءًا.** وهذا
قرار معماريّ بذاته: هل الفاتورة الرسمية مرجعها Zoho أم `fin_receivables`؟

---

## ٣. 🔴 مواضع الاختلاف المحتملة — ما يجب فحصه لا ما يُفترض

| # | الاختلاف | لماذا يهمّ |
|---|---|---|
| **١** | `fin_costs` مقابل `project_expenses` | مصروف مسجَّل في الاثنين يُحتسب **مرّتين** في أيّ هامش. ومسجَّل في واحد فقط يجعل الرقمين مختلفين دائمًا |
| **٢** | `amount_gross` المخزَّن مقابل `net + vat` | ثلاثيّة مخزَّنة يمكن أن تتناقض داخل الصفّ الواحد |
| **٣** | `fin_payment_milestones` مقابل `fin_receivables` | الدفعة المتّفق عليها ليست بالضرورة مطالبة صادرة. جمعهما يضاعف المستحقّ |
| **٤** | `fin_collections` مقابل حالة Zoho | التحصيل المسجَّل داخليًّا قد يسبق أو يخالف ما في Zoho |
| **٥** | `fin_revenue` مقابل `fin_collections` | الاعتراف بالإيراد ≠ التحصيل. خلطهما يُنتج تدفّقًا نقديًّا خاطئًا |
| **٦** | العملات | كلّ جدول يحمل `currency` خاصًّا به. صفوف بعملات مختلفة تُجمع بلا تحويل = رقم بلا معنى |

⛔ **ولا واحد من هذه الستّة يُحسم بالقراءة من المستودع** — كلّها تحتاج بيانات.

---

## ٤. محسوب مقابل مخزَّن

| القيمة | الطبيعة |
|---|---|
| `pc_project_financials()` | **محسوبة** عند الطلب |
| `amount_net` · `vat_amount` · `amount_gross` | **مخزَّنة** في كلّ جدول |
| الهامش | ❌ **غير موجود** — لا عمود ولا دالّة تحسبه اليوم |

🔴 **ولهذا بقيت `avg_margin_pct` في تقرير Wave 4 تُعاد `null`:** لا مصدر تكلفة
محسوم مرتبطًا بالفرصة، وحسابها كان سيعني اختيار أحد النطاقين ضمنًا.

---

## ٥. ما يحتاج تحقّقًا على Production — **استعلامات قراءة فقط**

⛔ **لا تُشغَّل من هنا.** يشغّلها إنسان ويقرأ مخرجاتها.

```sql
-- ١) هل يوجد تداخل فعليّ بين مصدرَي التكلفة؟ (D-5)
select 'fin_costs' as src, count(*) as rows, count(distinct project_id) as projects
  from public.fin_costs
union all
select 'project_expenses', count(*), count(distinct project_id)
  from public.project_expenses;

-- ٢) مشاريع تحمل تكلفة في **الاثنين** — مرشّحة لازدواج احتساب.
select c.project_id, count(distinct c.id) as fin_rows, count(distinct e.id) as project_rows
  from public.fin_costs c
  join public.project_expenses e on e.project_id = c.project_id
 group by c.project_id
 order by 2 desc, 3 desc
 limit 50;

-- ٣) صفوف متناقضة داخليًّا: gross ≠ net + vat.
select 'fin_receivables' as t, count(*) from public.fin_receivables
 where amount_gross is not null and abs(amount_gross - (coalesce(amount_net,0)+coalesce(vat_amount,0))) > 0.01
union all
select 'fin_collections', count(*) from public.fin_collections
 where amount_gross is not null and abs(amount_gross - (coalesce(amount_net,0)+coalesce(vat_amount,0))) > 0.01
union all
select 'fin_revenue', count(*) from public.fin_revenue
 where amount_gross is not null and abs(amount_gross - (coalesce(amount_net,0)+coalesce(vat_amount,0))) > 0.01;

-- ٤) تعدّد العملات داخل المشروع الواحد.
select project_id, count(distinct currency) as currencies
  from (select project_id, currency from public.fin_receivables
        union all select project_id, currency from public.fin_revenue
        union all select project_id, currency from public.fin_costs) u
 where project_id is not null
 group by project_id having count(distinct currency) > 1;

-- ٥) هل الدفعات والمطالبات مرتبطة أم متوازية؟
select count(*) as milestones,
       count(*) filter (where exists (
         select 1 from public.fin_receivables r where r.project_id = m.project_id)) as with_receivable
  from public.fin_payment_milestones m;

-- ٦) حالة Phase A/B نفسها — التدقيق الكامل في:
--    docs/sql/wave5_financial_phase_ab_AUDIT_READONLY.sql
```

---

## ٦. القرارات التي تنتظر خالد

| # | القرار | التصنيف |
|---|---|---|
| **W5-2·أ** | **مصدر التكلفة المعتمد:** `fin_costs` أم `project_expenses`؟ (D-5). ⛔ لا يُبنى هامش قبله | **FINANCIAL SOURCE-OF-TRUTH DECISION** |
| **W5-2·ب** | **الفاتورة الرسمية:** مرجعها Zoho أم `fin_receivables`؟ (لا جدول Zoho في القاعدة) | **FINANCIAL SOURCE-OF-TRUTH DECISION** |
| **W5-2·ج** | **`gross` مخزَّن أم محسوب؟** إن بقي مخزَّنًا فيلزم قيد يمنع التناقض داخل الصفّ | **FINANCIAL SOURCE-OF-TRUTH DECISION** |
| **W5-2·د** | **سياسة العملات:** عملة أساس وتحويل، أم منع الجمع عبر العملات؟ | **FINANCIAL SOURCE-OF-TRUTH DECISION** |
| **W5-2·هـ** | تشغيل تدقيق Phase A/B وقراءة مخرجاته | **MANUAL PRODUCTION VERIFICATION** |

---

## ٧. الأثر على Wave 5

**ما يبقى محجوبًا حتى تُحسم الخمسة أعلاه:**
V2-5.5-B (بطاقة الهامش) · V2-5.5-D (تقويم التدفّق النقديّ) · V2-5.5-E (عدّاد
التأخّر) · V2-5.5-F (مسوّدة الإشعار الرسميّ).

**ولماذا لا تُبنى «مؤقّتًا» بأحد المصدرين:** بطاقة هامش تختار `fin_costs` ضمنًا
تُصبح **هي** القرار — يقرؤها الفريق ويسعّر عليها، ثمّ يصير تغييرها لاحقًا تغييرًا
في أرقام مُعتمَدة لا في كود.

⇒ **Wave 5 تبقى PARTIAL**، ولا تُدمج، ولا يُنشأ `overnight-wave-5-complete`.
⛔ وRelease Candidate الكامل **محجوب** بهذا البند.
