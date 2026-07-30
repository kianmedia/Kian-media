-- ════════════════════════════════════════════════════════════════════════════
-- docs/talent_vendor_network_PREFLIGHT.sql — للقراءة فقط. لا يكتب حرفًا.
--
-- المراحل ٩–١٢ — شبكة المواهب والمستقلّين والمورّدين.
--
-- ★ يُثبت الاعتماديات ولا يفترضها ★
--   المُسنَدات مكتوبة فوق is_staff()/is_owner()/is_admin() ويُتحقَّق من أجسامها
--   لحظة الإنشاء؛ غياب أيّ منها لا يُنتج ميزة ناقصة بل يُسقط الترحيلة عند أوّل
--   CREATE FUNCTION. وأسوأ من ذلك سيناريو صامت: بوّابة تعيد NULL بدل false
--   تحوّل كلّ سياسة RLS فوقها إلى «غير محدَّد» — وغير المحدَّد ليس منعًا.
--   لذلك كلّ اعتماديّة تُفحَص بثلاثة أسئلة: موجودة؟ نوعها صحيح؟ ترتيبها سليم؟
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يستدعي دالّة محميّة واحدة. المحرّر يعمل بدور postgres و auth.uid()=NULL،
--   فاستدعاء بوّابة حيّة يرفع «not authorized» أو يُرجع false فيُقرأ خطأً على
--   أنّه عطل. الفحص بنيويّ من كتالوج النظام لا سلوكيّ.
--
-- ★ الاعتماديات الاختيارية ليست تهاونًا ★
--   custody_vendors و opportunity_requests و custody_inventory_assets و
--   comms_* و permissions اختيارية **بنيويًّا**: الوحدة تعمل بدونها وتصرّح
--   بذلك في tvn_access(). لكن غيابها يعني ميزة غائبة لا ميزة صامتة:
--     • بلا custody_vendors  → لا جسر مورّد. ⚠️ ولا يُنشئ RUNME جدول مورّدين
--       بديلًا. لو أردت الجسر شغّل custody_enterprise_07 أوّلًا.
--     • بلا opportunity_requests → tvn_promote_opportunity ترفع
--       «feature unavailable» بدل أن تخترع بيانات.
--     • بلا comms_*  → الأحداث تُسجَّل محلّيًّا فقط ولا تصل الكتالوج.
--     • بلا permissions/emp_has_permission → كلّ مفاتيح talent.* غير قابلة
--       للحلّ، فلا يمرّ إلّا المالك. ★ هذا منع لا منح ★ لكنّه يعني عمليًّا أنّ
--       الوحدة بلا مستخدمين غير المالك حتّى تُشغَّل حزمة الصلاحيات.
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
     '★ كلّ عمود فاعل (created_by / verified_by / reviewer_id / approved_by) مفتاح أجنبيّ إليه'),
    ('function', 'public.is_staff()',
     '★ أساس كلّ بوّابة: موظّف مقابل عميل. غيابه يُسقط أوّل CREATE FUNCTION'),
    ('function', 'public.is_owner()',
     '★ الطبقة العليا في كلّ مُسنَد — بلا مفتاح وبلا بديل'),
    ('function', 'public.is_admin()',
     'يدخل في tvn_is_owner() مع is_owner()')
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

-- ─── الاعتماديات الاختيارية ────────────────────────────────────────────────
soft as (
  select * from (values
    ('relation', 'public.custody_vendors',
     'جسر المورّد. ★ لا يُنشئ RUNME جدول مورّدين بديلًا عند غيابه ★'),
    ('relation', 'public.custody_inventory_assets',
     'وثائق مملوكة لأصل (ضمان/تأمين). الوثيقة تشير إلى الأصل القائم ولا تنسخه'),
    ('relation', 'public.opportunity_requests',
     'سطح الفرص. الترقية يدوية فقط — ولا يُعدَّل هذا الجدول ولا يُوضع عليه مُشغِّل'),
    ('relation', 'public.comms_event_catalog',
     'كتالوج الأحداث. بدونه تُسجَّل الأحداث محلّيًّا فقط'),
    ('relation', 'public.comms_templates', 'قوالب الأحداث'),
    ('relation', 'public.permissions',
     'كتالوج الصلاحيات — مفاتيح talent.* تُزرَع فيه'),
    ('function', 'public.emp_has_permission(uuid,text)',
     '★ محلّل الصلاحيات ★ بدونه لا يمرّ أحد غير المالك'),
    ('function', 'public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)',
     'مدخل الإدراج في مركز الاتصالات. التوقيع يجب أن يطابق تمامًا')
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
         then 'موجود — الميزة المرتبطة ستعمل'
         else 'غائب — الميزة المرتبطة ستُتخطّى بلطف وتُعلَن غير مفعّلة في tvn_access()' end as detail,
    s.why
  from soft s
),

-- ─── تعارض الأسماء ─────────────────────────────────────────────────────────
name_clash as (
  select * from (values
    ('public.can_view_talent_network()'),('public.can_manage_talent_profiles()'),
    ('public.can_view_vendor_rates()'),('public.can_verify_compliance()'),
    ('public.can_assign_external_resources()'),('public.can_review_resource_performance()')
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
    'المُسنَدات الستّة بأسمائها المتّفق عليها في العقد' as why
  from name_clash c
),

-- ─── جداول الوحدة: تشغيل أوّل أم إعادة تشغيل ───────────────────────────────
own as (
  select * from (values
    ('public.tvn_profiles'),('public.tvn_profile_rates'),('public.tvn_profile_bank'),
    ('public.tvn_profile_restricted'),('public.tvn_availability'),('public.tvn_documents'),
    ('public.tvn_document_types'),('public.tvn_assignments'),('public.tvn_assignment_candidates'),
    ('public.tvn_reviews'),('public.tvn_review_corrections'),('public.tvn_incident_flags'),
    ('public.tvn_audit'),('public.tvn_event_log'),('public.tvn_settings')
  ) as t(obj)
),
own_rows as (
  select 'INFO' as verdict, 'حالة الوحدة' as area, o.obj as object,
         case when to_regclass(o.obj) is null then 'غير موجود — تشغيل أوّل'
              else 'موجود — إعادة تشغيل فوق بيانات قائمة (RUNME idempotent)' end as detail,
         'إعادة التشغيل لا تحذف صفًّا ولا تُعيد بذر ما عُدِّل' as why
  from own o
),

-- ─── حراسة التجميد: لا لمس لمنصّة المشاريع ─────────────────────────────────
freeze_rows as (
  select 'INFO' as verdict, 'تجميد المنصّة' as area,
         'public.projects / project_core / deliverables' as object,
         'هذه الحزمة لا تنشئ مفتاحًا أجنبيًّا إلى أيّ منها. tvn_assignments.project_id مرجع اختياريّ للقراءة فقط بلا FK' as detail,
         'تعديل جداول المنصّة ممنوع طوال التجميد' as why
),

-- ─── تحذير الازدواج: هل يوجد نظام مواهب آخر؟ ───────────────────────────────
dup_rows as (
  select
    case when count(*) = 0 then 'PASS' else 'WARN' end as verdict,
    'ازدواج مصدر الحقيقة' as area,
    'جداول talent_* / vendor_* / freelancer_* خارج tvn_' as object,
    case when count(*) = 0
         then 'لا يوجد نظام مواهب مواز — الشبكة ستكون المصدر الوحيد'
         else '★ وُجد ' || count(*)::text || ' جدولًا قد يحمل نفس المفهوم ★ راجعها قبل التشغيل: مصدران لنفس المورّد أسوأ من ميزة غائبة' end as detail,
    'قاعدة الحزمة: أعِد الاستخدام ولا تُنشئ نظامًا ثانيًا' as why
  from information_schema.tables
  where table_schema = 'public'
    and (table_name like 'talent\_%' or table_name like 'vendor\_%' or table_name like 'freelancer\_%')
    and table_name not like 'tvn\_%'
),

-- ─── امتداد جدول المورّدين القائم ──────────────────────────────────────────
vendor_col as (
  select
    case when to_regclass('public.custody_vendors') is null then 'OPTIONAL'
         when exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name='custody_vendors'
                         and column_name='tvn_profile_id') then 'INFO'
         else 'PASS' end as verdict,
    'توسيع إضافيّ' as area,
    'custody_vendors.tvn_profile_id' as object,
    case when to_regclass('public.custody_vendors') is null
         then 'جدول المورّدين غائب — لن يُضاف العمود ولن يُنشأ بديل'
         when exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name='custody_vendors'
                         and column_name='tvn_profile_id')
         then 'العمود موجود مسبقًا — إعادة تشغيل آمنة'
         else 'سيُضاف عمود واحد nullable. لا عمود يُحذف ولا نوع يتغيّر' end as detail,
    'الإضافة فقط: صفّ الشراء وملفّ الشبكة كيان واحد' as why
),

-- ─── القنوات: يجب أن تبقى كما هي ───────────────────────────────────────────
channel_rows as (
  select
    case when to_regclass('public.comms_channels') is null then 'OPTIONAL' else 'INFO' end as verdict,
    'الإشعارات' as area, 'comms_channels' as object,
    case when to_regclass('public.comms_channels') is null
         then 'مركز الاتصالات غير مثبَّت — لا كتالوج ولا إدراج'
         else 'RUNME لا يلمس هذا الجدول إطلاقًا: لا تفعيل قناة ولا تغيير dry_run. الأحداث تُسجَّل بقناة portal وحدها' end as detail,
    'أحداث فقط — لا شيء يُرسَل' as why
),

all_rows as (
  select * from hard_rows
  union all select * from soft_rows
  union all select * from clash_rows
  union all select * from own_rows
  union all select * from freeze_rows
  union all select * from dup_rows
  union all select * from vendor_col
  union all select * from channel_rows
)

select
  case verdict when 'BLOCKER' then 1 when 'WARN' then 2 when 'OPTIONAL' then 3
               when 'INFO' then 4 else 5 end as sort_key,
  verdict, area, object, detail, why
from all_rows
order by sort_key, area, object;
