-- ════════════════════════════════════════════════════════════════════════════
-- docs/case_studies_platform_PREFLIGHT.sql — للقراءة فقط. لا يكتب حرفًا.
--
-- المراحل ٦–١٠ — منصّة دراسات الحالة.
--
-- ★ يُثبت الاعتماديات ولا يفترضها ★
--   المُسنَدات الأربعة مبنيّة فوق is_staff()/is_owner()/is_admin()، ويُتحقَّق من
--   وجودها **ومن نوع إرجاعها** لحظة الإنشاء: غياب أيّها يُسقط الترحيلة عند أوّل
--   CREATE FUNCTION، وأسوأ منه سيناريو صامت — بوّابة تعيد NULL بدل false تحوّل
--   كلّ سياسة فوقها إلى «غير محدَّد»، وغير المحدَّد ليس منعًا.
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يستدعي دالّة محميّة واحدة. المحرّر يعمل بدور postgres و auth.uid()=NULL،
--   فاستدعاء بوّابة حيّة يرفع «not authorized» أو يعيد false فيُقرأ خطأً على
--   أنّه عطل. الفحص بنيويّ من كتالوج النظام لا سلوكيّ.
--
-- ★ الاعتماديات الاختيارية ليست تهاونًا ★
--   permissions / emp_has_permission اختياريّ **بنيويًّا**: بدونه لا يُحَلّ أيّ
--   مفتاح case_study.* فلا يمرّ أحد غير المالك. ★ هذا منع لا منح ★ لكنّه يعني
--   عمليًّا أنّ الوحدة بلا مستخدمين غير المالك حتّى تُشغَّل حزمة الصلاحيات.
--
-- النتيجة: مجموعة نتائج واحدة. اقرأ عمود verdict:
--   BLOCKER  → لا تُشغّل RUNME.
--   WARN     → تعارض محتمل يستحقّ قرارًا واعيًا.
--   OPTIONAL → ميزة ستُتخطّى بلطف (مكتشَفة وقت التشغيل).
--   INFO     → معلومة حالة.
--   PASS     → مستوفى.
-- ════════════════════════════════════════════════════════════════════════════

with

hard as (
  select * from (values
    ('relation', 'auth.users',
     '★ كلّ عمود فاعل (created_by / approved_by / published_by / consent_recorded_by) مفتاح أجنبيّ إليه'),
    ('function', 'public.is_staff()',
     '★ أساس كلّ بوّابة داخلية: موظّف مقابل عميل'),
    ('function', 'public.is_owner()',
     '★ can_publish_case_studies() = is_owner() وحدها — بلا مفتاح وبلا بديل'),
    ('function', 'public.is_admin()',
     'يدخل في cs_is_admin() المساعد')
  ) as t(kind, obj, why)
),
hard_eval as (
  select h.kind, h.obj, h.why,
         case h.kind
           when 'relation' then (to_regclass(h.obj) is not null)
           when 'function' then (to_regprocedure(h.obj) is not null)
         end as present
    from hard h
),
hard_typed as (
  select e.*,
         case when e.kind <> 'function' or not e.present then null
              else (select p.prorettype = 'boolean'::regtype
                      from pg_proc p where p.oid = to_regprocedure(e.obj)) end as rettype_ok
    from hard_eval e
),
hard_rows as (
  select
    case when not present then 'BLOCKER'
         when rettype_ok is false then 'BLOCKER'
         else 'PASS' end as verdict,
    'اعتماديّة صلبة' as area,
    obj as object,
    case when not present then 'مفقود — RUNME سيفشل عند أوّل استعمال'
         when rettype_ok is false then 'موجود لكنّه لا يعيد boolean — كلّ سياسة فوقه تصير «غير محدَّد» وهو ليس منعًا'
         else 'موجود وبالنوع الصحيح' end as detail,
    why
  from hard_typed
),

-- ─── امتداد pgcrypto/gen_random_uuid ───────────────────────────────────────
uuid_row as (
  select case when to_regprocedure('public.gen_random_uuid()') is not null
                or to_regprocedure('pg_catalog.gen_random_uuid()') is not null
              then 'PASS' else 'BLOCKER' end as verdict,
         'اعتماديّة صلبة' as area, 'gen_random_uuid()' as object,
         case when to_regprocedure('public.gen_random_uuid()') is not null
                or to_regprocedure('pg_catalog.gen_random_uuid()') is not null
              then 'متاحة — المفاتيح الأساسية ستُولَّد'
              else 'غير متاحة — فعّل pgcrypto أو رقّ إلى PostgreSQL 13+' end as detail,
         'كلّ جدول في الوحدة يستعملها كقيمة افتراضية للمفتاح' as why
),

-- ─── الاعتماديات الاختيارية ────────────────────────────────────────────────
soft as (
  select * from (values
    ('relation', 'public.permissions',
     'كتالوج الصلاحيات — مفاتيح case_study.view/edit/review تُزرَع فيه. ⛔ ولا يُزرَع مفتاح نشر إطلاقًا'),
    ('function', 'public.emp_has_permission(uuid,text)',
     '★ محلّل الصلاحيات ★ بدونه لا يمرّ أحد غير المالك — منع لا منح')
  ) as t(kind, obj, why)
),
soft_rows as (
  select
    case when (case s.kind when 'relation' then to_regclass(s.obj) is not null
                           else to_regprocedure(s.obj) is not null end)
         then 'PASS' else 'OPTIONAL' end as verdict,
    'اعتماديّة اختيارية' as area,
    s.obj as object,
    case when (case s.kind when 'relation' then to_regclass(s.obj) is not null
                           else to_regprocedure(s.obj) is not null end)
         then 'موجود — مفاتيح case_study.* ستُحَلّ'
         else 'غائب — الوحدة تعمل لكن لا يدخلها إلّا المالك حتّى تُشغَّل حزمة الصلاحيات' end as detail,
    s.why
  from soft s
),

-- ─── ★ لا مفتاح نشر ★ ──────────────────────────────────────────────────────
publish_key as (
  select case when to_regclass('public.permissions') is null then 'OPTIONAL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.permissions where key = ''case_study.publish''',
                     false, true, '')))[1]::text::int > 0
              then 'BLOCKER' else 'PASS' end as verdict,
         'حوكمة النشر' as area, 'permissions.case_study.publish' as object,
         case when to_regclass('public.permissions') is null then 'كتالوج الصلاحيات غائب — لا شيء يُفحَص'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.permissions where key = ''case_study.publish''',
                     false, true, '')))[1]::text::int > 0
              then '★ وُجد مفتاح نشر ★ احذفه قبل التشغيل: النشر النهائيّ ملكيّ بنيويًّا، والمفتاح الموجود يُمنَح يومًا ثمّ يُنسى'
              else 'غير موجود — كما يجب' end as detail,
         'النشر النهائيّ للمالك وحده، بلا مفتاح صلاحية إطلاقًا' as why
),

-- ─── تعارض الأسماء ─────────────────────────────────────────────────────────
name_clash as (
  select * from (values
    ('public.can_view_case_studies_internal()'),('public.can_edit_case_studies()'),
    ('public.can_review_case_studies()'),('public.can_publish_case_studies()')
  ) as t(obj)
),
clash_rows as (
  select
    case when to_regprocedure(c.obj) is null then 'PASS' else 'WARN' end as verdict,
    'تعارض أسماء' as area,
    c.obj as object,
    case when to_regprocedure(c.obj) is null
         then 'الاسم حرّ — سيُنشأ هنا'
         else '★ الاسم مستعمل مسبقًا ★ سيُستبدل تعريفه بـcreate or replace. تحقّق من مالكه قبل التشغيل' end as detail,
    'المُسنَدات الأربعة بأسمائها المتّفق عليها في العقد' as why
  from name_clash c
),

-- ─── جداول الوحدة: تشغيل أوّل أم إعادة تشغيل ───────────────────────────────
own as (
  select * from (values
    ('public.cs_settings'),('public.cs_sectors'),('public.cs_services'),
    ('public.cs_case_studies'),('public.cs_permissions'),('public.cs_media'),
    ('public.cs_metrics'),('public.cs_credits'),('public.cs_case_study_sectors'),
    ('public.cs_case_study_services'),('public.cs_versions'),('public.cs_audit')
  ) as t(obj)
),
own_rows as (
  select 'INFO' as verdict, 'حالة الوحدة' as area, o.obj as object,
         case when to_regclass(o.obj) is null then 'غير موجود — تشغيل أوّل'
              else 'موجود — إعادة تشغيل فوق بيانات قائمة (RUNME idempotent)' end as detail,
         'إعادة التشغيل لا تحذف صفًّا ولا تُعيد بذر ما عُدِّل' as why
  from own o
),

-- ─── ★ لا سجلّ وثائق ثالث ★ ────────────────────────────────────────────────
docs_row as (
  select 'INFO' as verdict, 'إعادة الاستخدام' as area,
         'tvn_documents / hr_employee_documents' as object,
         'هذه الحزمة **لا تلمس أيًّا منهما ولا تقرأ منهما**، ولا تنشئ سجلّ وثائق ثالثًا. '
         || case when to_regclass('public.tvn_documents') is null
                 then 'وسجلّ المواهب غير مثبَّت أصلًا هنا.'
                 else 'سجلّ المواهب مثبَّت ويبقى المصدر الوحيد لصلاحية الوثيقة.' end as detail,
         'ثلاثة سجلّات وثائق = ثلاث إجابات عن صلاحية الشهادة الواحدة' as why
),

-- ─── حراسة التجميد ─────────────────────────────────────────────────────────
freeze_rows as (
  select 'INFO' as verdict, 'تجميد المنصّة' as area,
         'public.projects / project_core / deliverables' as object,
         'لا مفتاح أجنبيّ إلى أيّ منها. cs_case_studies.project_id مرجع اختياريّ للقراءة الداخلية فقط، ولا يظهر في أيّ مخرَج عامّ، ولا نسخ تلقائيّ منه' as detail,
         'تعديل جداول المنصّة ممنوع طوال التجميد' as why
),

-- ─── ازدواج سطح المحتوى العامّ ─────────────────────────────────────────────
dup_rows as (
  select
    case when count(*) = 0 then 'PASS' else 'WARN' end as verdict,
    'ازدواج مصدر الحقيقة' as area,
    'جداول case_stud* / portfolio* / publication* خارج cs_' as object,
    case when count(*) = 0
         then 'لا سطح محتوى عامّ مواز في قاعدة البيانات — دراسات الحالة ستكون المصدر الوحيد المؤلَّف'
         else '★ وُجد ' || count(*)::text || ' جدولًا قد يحمل نفس المفهوم ★ راجعها قبل التشغيل' end as detail,
    'شبكة الأعمال في components/Portfolio.tsx ثابتة في الكود وتبقى كما هي — سطح ثانٍ مؤلَّف يدويًّا لا بديل' as why
  from information_schema.tables
  where table_schema = 'public'
    and (table_name like 'case\_stud%' or table_name like 'portfolio\_%' or table_name like 'publication%')
    and table_name not like 'cs\_%'
),

-- ─── الدلاء: هل يوجد دلو عامّ؟ يجب ألّا يوجد ─────────────────────────────
bucket_rows as (
  select
    case when to_regclass('storage.buckets') is null then 'INFO'
         when (xpath('/row/c/text()', query_to_xml(
                'select count(*) as c from storage.buckets where public = true', false, true, '')))[1]::text::int > 0
         then 'WARN' else 'PASS' end as verdict,
    'التخزين' as area, 'storage.buckets(public=true)' as object,
    case when to_regclass('storage.buckets') is null then 'مخطّط التخزين غير متاح من هنا — تحقّق يدويًّا'
         when (xpath('/row/c/text()', query_to_xml(
                'select count(*) as c from storage.buckets where public = true', false, true, '')))[1]::text::int > 0
         then '★ يوجد دلو عامّ ★ هذه الحزمة لا تنشئ دلوًا ولا تحتاجه؛ راجع من أنشأه ولماذا'
         else 'كلّ الدلاء خاصّة — وهذه الحزمة لا تغيّر ذلك: الوسائط العامّة ملفّات مستودع' end as detail,
    'دلو عامّ واحد يحوّل المسار القابل للتخمين إلى تعداد فوريّ' as why
),

storage_touch as (
  select 'INFO' as verdict, 'التخزين' as area, 'ما لا تفعله هذه الحزمة' as object,
         'لا insert into storage.buckets، ولا سياسة storage.objects، ولا توقيع بمفتاح الخدمة، ولا عمود مسار تخزين في أيّ جدول cs_' as detail,
         'أخطر ثلاث حالات في التدقيق §٣.٢ تبقى كلّها غير محقَّقة' as why
),

all_rows as (
  select * from hard_rows
  union all select * from uuid_row
  union all select * from soft_rows
  union all select * from publish_key
  union all select * from clash_rows
  union all select * from own_rows
  union all select * from docs_row
  union all select * from freeze_rows
  union all select * from dup_rows
  union all select * from bucket_rows
  union all select * from storage_touch
)

select
  case verdict when 'BLOCKER' then 1 when 'WARN' then 2 when 'OPTIONAL' then 3
               when 'INFO' then 4 else 5 end as sort_key,
  verdict, area, object, detail, why
from all_rows
order by sort_key, area, object;
