-- WAVE 6 · V2-6.8 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('cs_case_studies'),('cs_versions'),('cs_audit'),('cs_permissions')) v(n);

-- ⚠️ `to_regproc` هنا **صحيحة**: القيم أسماء مجرَّدة بلا أقواس ولا توقيع.
--    ⛔ ولا تُحوَّل إلى `to_regprocedure` — تلك تتطلّب توقيعًا وتُعيد NULL للاسم
--    المجرَّد، فينقلب الفحص السليم إلى بلاغ «مفقود» كاذب. (والعكس — تمرير توقيع
--    إلى `to_regproc` — هو العطب الذي أُصلح في ١٤ موضعًا في Wave 4/6.)
select 'WORKFLOW_FN' as kind, v.n as name,
       case when to_regproc('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('cs_is_staff'),('cs_is_admin'),('cs_slugify'),('cs_submit'),('cs_approve')) v(n);

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 حالات المنصّة القائمة — المولّد يستعملها ولا يُنشئ محرّك حالات ثانيًا.
--
-- ★ العطب الذي أوقف PREFLIGHT على Preview ★
--     ERROR: column reference "oid" is ambiguous
--   السطر كان `pg_get_constraintdef(oid)` في قائمة SELECT، و`from` يضمّ
--   **جدولَي كتالوج**: `pg_constraint con` و`pg_class r` — وكلاهما يملك عمودًا
--   اسمه `oid`. فلا يستطيع المُحلِّل اختيار أحدهما ⇒ يفشل الاستعلام كلّه.
--   ⚠️ ولاحظ التناقض داخل الجملة نفسها: شرط `where` كان **مؤهَّلًا** بـ
--   `con.oid` بينما قائمة SELECT لم تكن — التأهيل كان معروفًا وسقط في موضع.
--   ⛔ ولا التباس في استعلام بجدول واحد: `oid` المجرَّد صحيح تمامًا هناك،
--   ولذلك يُفحص هذا الصنف **بالنطاق** لا بالبحث النصّيّ.
-- ════════════════════════════════════════════════════════════════════════════
select 'STATUS_VOCAB' as kind, con.conname as name, pg_get_constraintdef(con.oid) as status
from pg_constraint con join pg_class r on r.oid=con.conrelid
where r.relname='cs_case_studies' and pg_get_constraintdef(con.oid) like '%draft%';

-- الأعمدة المضافة — يجب أن تكون غائبة.
select 'COLUMN' as kind, 'cs_case_studies.'||v.c as name,
       case when count(col.column_name)=0 then '✅ غائب (سيُضاف)' else '🟡 موجود مسبقًا' end as status
from (values ('generated_from_project'),('generation_method'),('source_provenance'),('exported_at')) v(c)
left join information_schema.columns col
  on col.table_schema='public' and col.table_name='cs_case_studies' and col.column_name=v.c
group by v.c;

-- ⛔ لا منصّة دراسات حالة ثانية ولا طابور منفصل.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام موازٍ — توقّف' end as status
from (values ('portfolio_drafts'),('case_studies'),('case_study_drafts')) v(n);
