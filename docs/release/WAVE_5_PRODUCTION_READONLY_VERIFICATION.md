# WAVE 5 — حزمة تحقّق **للقراءة فقط** على الإنتاج

> ✅ **القرارات السبعة: `OWNER APPROVED`** (٥ أغسطس ٢٠٢٦) — القرار البرمجيّ محسوم.
> 🔴 **وحالة البيانات: `PRODUCTION READ-ONLY VERIFICATION PENDING`.**
> ⛔ ولم يُشغَّل استعلام واحد ممّا يلي، وكل خانة نتيجة **فارغة عمدًا**.

> 🔴 **كل استعلام هنا `SELECT` خالص.** ⛔ ولا `UPDATE` ولا `INSERT` ولا `DELETE`
> ولا `ALTER` ولا `CREATE` — ولا حتّى داخل CTE.
> 🔴 **ولم يُشغَّل أيّ منها.** لا أملك وصولًا للإنتاج، ولا يُطلَب.
> ⛔ **ولا نتيجة مُختلَقة في هذه الوثيقة**: كل خانة نتيجة فارغة عمدًا حتّى تُملأ
> من تشغيل حقيقيّ.

**السياق:** `docs/wave-reports/WAVE_5_FINANCIAL_SOURCE_OF_TRUTH_AUDIT.md` (على
فرع `feat/wave-5-delivery-rights-finance`) أثبت أنّ **لا مصدر ماليًّا واحدًا**:
نطاقان يحملان أرقامًا (`fin_*` و`project_*`)، وZoho **تكامل لا مصدر مخزَّن**.
هذه الحزمة تُحوّل ذلك إلى **قياس** بدل الاستنتاج.

⚠️ الأعمدة أدناه مأخوذة من DDL في المستودع (`amount_net` · `vat_amount` ·
`amount_gross` · `currency` · `incurred_on` · `zoho_reference` …). ولو اختلف
الإنتاج فالاستعلام يفشل صراحةً — وهذا **مطلوب**، لا يُصحَّح بالتخمين.

---

## ١. تداخل مصدرَي التكلفة (W5-2·أ)

```sql
-- ١-أ · حجم كل مصدر
select 'fin_costs' as src, count(*) as rows,
       count(distinct project_id) as projects,
       min(incurred_on) as first_date, max(incurred_on) as last_date
from public.fin_costs where coalesce(is_deleted, false) = false
union all
select 'project_expenses', count(*), count(distinct project_id), null, null
from public.project_expenses;
```

```sql
-- ١-ب · 🔴 المشاريع التي لها تكاليف في **النطاقين** — هذه هي منطقة الخطر
select p.project_id,
       f.n_fin, f.sum_fin, e.n_exp, e.sum_exp,
       round(f.sum_fin - e.sum_exp, 2) as delta
from (select distinct project_id from public.fin_costs
      where project_id is not null and coalesce(is_deleted,false)=false) p
join (select project_id, count(*) n_fin, sum(amount_net) sum_fin
      from public.fin_costs where coalesce(is_deleted,false)=false
      group by project_id) f on f.project_id = p.project_id
join (select project_id, count(*) n_exp, sum(amount_excl_vat) sum_exp
      from public.project_expenses group by project_id) e on e.project_id = p.project_id
order by abs(f.sum_fin - e.sum_exp) desc nulls last
limit 100;
```

> **كيف يُقرأ:** صفر صفوف ⇒ النطاقان منفصلان عمليًّا، والقرار أسهل.
> أيّ صفوف ⇒ **ازدواج فعليّ**، و`delta ≠ 0` يعني أنّ الرقمين **لا يتطابقان**،
> فاختيار المصدر يغيّر الأرقام المعروضة فعلًا.

| النتيجة | تُملأ بعد التشغيل |
|---|---|
| عدد المشاريع المزدوجة | ⬜ |
| أكبر `delta` | ⬜ |

---

## ٢. اتّساق `gross = net + vat` المخزَّن (W5-2·ج)

```sql
-- 🔴 الحقول الثلاثة مخزَّنة، فلا شيء يمنع تناقضها داخل الصفّ الواحد.
select 'fin_costs' as tbl, count(*) as inconsistent_rows
from public.fin_costs
where coalesce(is_deleted,false)=false
  and amount_gross is not null and amount_net is not null
  and abs(amount_gross - (amount_net + coalesce(vat_amount,0))) > 0.01
union all
select 'fin_revenue', count(*) from public.fin_revenue
where coalesce(is_deleted,false)=false
  and amount_gross is not null and amount_net is not null
  and abs(amount_gross - (amount_net + coalesce(vat_amount,0))) > 0.01
union all
select 'fin_receivables', count(*) from public.fin_receivables
where coalesce(is_deleted,false)=false
  and amount_gross is not null and amount_net is not null
  and abs(amount_gross - (amount_net + coalesce(vat_amount,0))) > 0.01
union all
select 'project_expenses', count(*) from public.project_expenses
where amount_incl_vat is not null and amount_excl_vat is not null
  and abs(amount_incl_vat - (amount_excl_vat + coalesce(vat_amount,0))) > 0.01;
```

> **أيّ رقم > 0 يعني أنّ صفًّا واحدًا على الأقل يناقض نفسه.** والعلاج ليس تصحيح
> الصفوف يدويًّا، بل قرار W5-2·ج: هل يبقى `gross` مخزَّنًا (فيلزم `CHECK`)، أم
> يصير محسوبًا؟

---

## ٣. اتّساق نسبة الضريبة

```sql
select currency, vat_rate, count(*) as rows,
       count(*) filter (where abs(coalesce(vat_amount,0)
             - round(amount_net * coalesce(vat_rate,0) / 100.0, 2)) > 0.02) as vat_mismatch
from public.fin_revenue
where coalesce(is_deleted,false)=false
group by currency, vat_rate order by rows desc;
```

> ⚠️ يفترض أنّ `vat_rate` **نسبة مئوية** (15 لا 0.15). لو ظهرت قيم ≤ 1 فالوحدة
> مختلطة — وهذا بذاته نتيجة تستحقّ التسجيل، ⛔ ولا يُصحَّح بالتخمين.

---

## ٤. اتّساق العملة (W5-2·د)

```sql
-- ٤-أ · العملات المستعملة فعلًا في كل جدول
select 'fin_costs' t, currency, count(*) from public.fin_costs group by 2
union all select 'fin_revenue', currency, count(*) from public.fin_revenue group by 2
union all select 'fin_receivables', currency, count(*) from public.fin_receivables group by 2
order by 1, 3 desc;
```

```sql
-- ٤-ب · 🔴 مشاريع تخلط عملتين — الجمع عليها **بلا معنى** بلا سياسة تحويل
select project_id, count(distinct currency) as currencies,
       string_agg(distinct currency, ',') as list
from (select project_id, currency from public.fin_costs where project_id is not null
      union all
      select project_id, currency from public.fin_revenue where project_id is not null) x
group by project_id having count(distinct currency) > 1
order by 2 desc limit 50;
```

> **أيّ صفّ هنا يجعل «إجمالي التكلفة» رقمًا زائفًا** ما لم يُحسم W5-2·د.
> ⛔ ولا يوجد جدول أسعار صرف في المستودع — فالتحويل التلقائيّ **غير ممكن اليوم**.

---

## ٥. كشف التكرار

```sql
-- تكرار محتمل: نفس المشروع والمورّد والمبلغ والتاريخ
select project_id, supplier_id, incurred_on, amount_net, count(*) as copies,
       string_agg(cost_no, ' | ') as docs
from public.fin_costs
where coalesce(is_deleted,false)=false
group by 1,2,3,4 having count(*) > 1
order by copies desc, amount_net desc limit 100;
```

```sql
-- وتكرار عبر النطاقين: مبلغ وتاريخ متطابقان في fin_costs وproject_expenses
select f.project_id, f.incurred_on, f.amount_net, f.cost_no, e.description
from public.fin_costs f
join public.project_expenses e
  on e.project_id = f.project_id
 and abs(e.amount_excl_vat - f.amount_net) < 0.01
where coalesce(f.is_deleted,false)=false
limit 100;
```

> ⚠️ **مُرشَّحات لا أحكام:** تطابق المبلغ والتاريخ قد يكون مصادفة مشروعة
> (دفعتان متساويتان). كل صفّ ⇒ `ROW REQUIRES MANUAL REVIEW`.

---

## ٦. حالة ربط Zoho (W5-2·ب)

```sql
select count(*) as revenue_rows,
       count(*) filter (where zoho_reference is not null and zoho_reference <> '') as with_zoho_ref,
       count(*) filter (where zoho_reference is null or zoho_reference = '')      as without_zoho_ref
from public.fin_revenue where coalesce(is_deleted,false)=false;
```

```sql
-- طابور المزامنة: هل هناك متراكم أو فاشل؟
select status, count(*), min(created_at) as oldest
from public.fin_zoho_outbox group by status order by 2 desc;
```

> 🔴 **ولا يوجد جدول فواتير Zoho في هذه القاعدة.** فإن كانت الفاتورة الرسمية
> مرجعها Zoho، فالقاعدة **لا تملك** الرقم الرسميّ — وهذا جوهر W5-2·ب.

---

## ٧. صفوف بلا ربط مصدر

```sql
select 'fin_costs no project'   as gap, count(*) from public.fin_costs
  where project_id is null and coalesce(is_deleted,false)=false
union all
select 'fin_revenue no project', count(*) from public.fin_revenue
  where project_id is null and coalesce(is_deleted,false)=false
union all
select 'fin_costs no source_id', count(*) from public.fin_costs
  where source_id is null and coalesce(is_deleted,false)=false
union all
select 'project_expenses no project', count(*) from public.project_expenses
  where project_id is null;
```

---

## ٨. توافر مدخلات الهامش

```sql
-- 🔴 الهامش يحتاج **إيرادًا وتكلفة لنفس المشروع بنفس العملة**.
select count(*) as projects_with_both
from (select project_id from public.fin_revenue
      where project_id is not null and coalesce(is_deleted,false)=false
      intersect
      select project_id from public.fin_costs
      where project_id is not null and coalesce(is_deleted,false)=false) x;
```

> **صفر ⇒ لا يمكن حساب هامش لأيّ مشروع**، وتبقى `avg_margin_pct` تُعيد `null`
> بحقّ — ⛔ ولا تُملأ برقم مُقدَّر.

---

## ٩. القرارات التي تنتظر خالد — مصنَّفة

| # | القرار | التصنيف | يعتمد على |
|---|---|---|---|
| **W5-2·أ** | **مصدر التكلفة**: `fin_costs` أم `project_expenses` | 🔴 FINANCIAL SOURCE-OF-TRUTH | §١ |
| **W5-2·ب** | **مصدر الفاتورة الرسمية**: Zoho أم `fin_receivables` | 🔴 FINANCIAL SOURCE-OF-TRUTH | §٦ |
| **W5-2·ج** | `gross` **مخزَّن أم محسوب** | 🔴 FINANCIAL SOURCE-OF-TRUTH | §٢ |
| **W5-2·د** | **سياسة العملات**: عملة أساس وتحويل، أم منع الجمع عبر العملات | 🔴 FINANCIAL SOURCE-OF-TRUTH | §٤ |
| **W5-2·هـ** | **مصدر الإيراد**: `fin_revenue` أم `fin_receivables` | 🔴 FINANCIAL SOURCE-OF-TRUTH | §١ · §٦ |
| **W5-2·و** | **سياسة الهامش**: أيّ تكلفة تدخل، ومتى يُعترف بالإيراد | 🔴 FINANCIAL SOURCE-OF-TRUTH | §٨ |
| **W5-2·ز** | **أسبقية Zoho**: يفوز على القاعدة أم العكس عند التعارض | 🔴 FINANCIAL SOURCE-OF-TRUTH | §٦ |
| **W5-2·ح** | تشغيل تدقيق Phase A/B وقراءة مخرجاته | 🟡 MANUAL PRODUCTION VERIFICATION | — |

---

## ١٠. ما أُنجز من Wave 5 بلا قرار ماليّ — وما لم يُنجَز

| البند | الحالة |
|---|---|
| حزم `wave5_delivery_rights_*` | ✅ مكتوبة على فرعها · ⛔ **غير مطبَّقة** |
| حزم `wave5_deemed_approval_*` | ✅ مكتوبة (هيكل محافظ) · ⛔ **غير مطبَّقة** |
| تدقيقان `*_AUDIT_READONLY.sql` | ✅ مكتوبان · ⛔ **لم يُشغَّلا** |
| **بطاقة الهامش / الأرقام الربحية** | ⛔ **لم تُبنَ عمدًا** — تبنيها يعني حسم W5-2 ضمنًا |

🔴 **ولماذا لا تُبنى «مؤقّتًا»:** بطاقة تختار `fin_costs` ضمنًا **تصير** القرار.
يقرؤها الفريق ويسعّر عليها، ثمّ يصير تغييرها لاحقًا تغييرَ أرقامٍ اعتمد عليها
الناس — لا تعديلَ شيفرة.

---

## ١١. ما لا تدّعيه هذه الحزمة

- ⛔ **لم يُشغَّل استعلام واحد.** كل خانة نتيجة فارغة.
- ⛔ **ولم يُحسم أيّ قرار ماليّ** — ولا يُحسم من هنا.
- ⛔ **ولم تُدمج Wave 5**، ولا وسم `overnight-wave-5-complete`.
- ⚠️ أسماء الأعمدة من DDL المستودع؛ وأيّ انحراف على الإنتاج يجب أن **يُفشل**
  الاستعلام لا أن يُلتفّ عليه.
