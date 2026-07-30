-- ════════════════════════════════════════════════════════════════════════════
-- docs/smart_quoting_PREFLIGHT.sql — للقراءة فقط. لا يكتب حرفًا.
--
-- المرحلة ٤+٥: باني عروض الأسعار الذكيّ وحُرّاس الربحية.
--
-- ★ هذا الملفّ **يُثبت ترتيب الاعتماديات، ولا يفترضه**. ★
--   الفرق ليس شكليًّا: `smart_quoting_RUNME.sql` يُنشئ دوالًّا بلغة SQL
--   (لا plpgsql)، وPostgreSQL يتحقّق من أجسامها **لحظة الإنشاء**. فإن كانت
--   `public.is_owner()` غائبة، فإنّ `sq_can_view_cost()` — بوّابة التكلفة —
--   لا تفشل بهدوء بل تُسقط الترحيلة كلّها. وأسوأ من ذلك سيناريو صامت: لو
--   أُنشئت البوّابة بتعبير يُرجع NULL بدل false، لانهارت كلّ سياسة RLS تعتمد
--   عليها إلى «غير محدَّد» — وهو ما ليس منعًا.
--
--   لذلك كلّ اعتماديّة هنا تُفحَص بثلاثة أسئلة لا سؤال واحد:
--     ١) هل الكائن موجود؟            (to_regprocedure / to_regclass)
--     ٢) هل نوعه هو المتوقَّع؟        (prorettype = boolean، وليس أيّ شيء)
--     ٣) هل ترتيبه صحيح بالنسبة لنا؟ (يجب أن يسبق ما سيُبنى فوقه)
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يستدعي دالّة محميّة. محرّر SQL يعمل بدور postgres و auth.uid() = NULL،
--   فاستدعاء بوّابة حيّة هنا إمّا يرفع «not authorized» أو — الأسوأ — يُرجع
--   false ويُقرأ كأنّه «الكائن مكسور». الفحص بنيويّ (كتالوج النظام) لا سلوكيّ.
--
-- النتيجة: مجموعة نتائج واحدة. اقرأ عمود `verdict`:
--   BLOCKER  → لا تُشغّل RUNME. ستفشل أو ستبني حارسًا أعمى.
--   OPTIONAL → ميزة اختيارية ستُتخطّى بلطف (feature-detected).
--   INFO     → معلومة حالة.
--   PASS     → مستوفى.
-- ════════════════════════════════════════════════════════════════════════════

with

-- ─── (١) الاعتماديات الصلبة ────────────────────────────────────────────────
-- كلّ صفّ هنا شرط لا تقوم الترحيلة بدونه.
hard as (
  select * from (values
    -- الهُويّة: جدول العملاء. sq_quotes.client_id مفتاح أجنبيّ إليه.
    ('relation', 'public.clients',
     'جدول العملاء — sq_quotes.client_id يشير إليه بمفتاح أجنبيّ'),
    -- مستخدمو المصادقة: كلّ عمود فاعل (created_by/decided_by) يشير إليهم.
    ('relation', 'auth.users',
     'مستخدمو المصادقة — أعمدة الفاعل تشير إليهم'),
    ('function', 'public.is_staff()',
     'تمييز الموظّف عن العميل — أساس كلّ بوّابة في الموديول'),
    -- ★ الأهمّ على الإطلاق ★
    ('function', 'public.is_owner()',
     '★ بوّابة التكلفة sq_can_view_cost() تُبنى حرفيًّا فوقها — بلا مفتاح وبلا بديل'),
    ('function', 'public.is_admin()',
     'يُستعمل لإدارة الكتالوج فقط — ولا يمنح تكلفة ولا هامشًا')
  ) as t(kind, obj, why)
),
hard_eval as (
  select
    h.kind, h.obj, h.why,
    case h.kind
      when 'relation' then (to_regclass(h.obj) is not null)
      when 'function' then (to_regprocedure(h.obj) is not null)
    end as present
  from hard h
),
-- نوع الإرجاع: بوّابة تُرجع غير boolean تُنتج سياسات RLS بمعنى غير محدَّد.
hard_typed as (
  select
    e.*,
    case
      when e.kind <> 'function' or not e.present then null
      else (select p.prorettype = 'boolean'::regtype
              from pg_proc p where p.oid = to_regprocedure(e.obj))
    end as rettype_ok
  from hard_eval e
),

-- ─── (٢) الاعتماديات الاختيارية — تُكتشف ولا تُشترط ─────────────────────────
soft as (
  select * from (values
    ('relation', 'public.permissions',
     'كتالوج الصلاحيات — بذر مفاتيح quote.* يُتخطّى إن غاب (§1)'),
    ('function', 'public.emp_has_permission(uuid,text)',
     'محرّك الصلاحيات — غيابه يجعل sq_perm() ترجع false دائمًا (fail-closed)'),
    ('relation', 'public.projects',
     'مرجع المشروع الاختياريّ للقراءة فقط — المفتاح الأجنبيّ يُنشأ فقط إن وُجد'),
    ('relation', 'public.notifications',
     'الإشعارات — sq_notify() تُتخطّى بصمت إن غاب'),
    ('function', 'public.my_client_id()',
     'هُويّة العميل — تُستعمل لمنع العميل من كلّ سطح داخليّ'),
    ('relation', 'public.csub_plans',
     'خطط الاشتراك (المرحلة ١+٢) — لا اعتماديّة: التسعير لا يقرأ منها')
  ) as t(kind, obj, why)
),
soft_eval as (
  select
    s.kind, s.obj, s.why,
    case s.kind
      when 'relation' then (to_regclass(s.obj) is not null)
      when 'function' then (to_regprocedure(s.obj) is not null)
    end as present
  from soft s
),

-- ─── (٣) إثبات الترتيب ─────────────────────────────────────────────────────
-- ليس تكرارًا لِما سبق: يسأل «هل ما سيُبنى فوقه موجود **قبله**؟» صراحةً،
-- ويسمّي الدالّة التي ستسقط بالاسم لو لم يكن كذلك.
order_proof as (
  select * from (values
    ('public.is_owner()',   'public.sq_can_view_cost()',
     'بوّابة التكلفة — للمالك حرفيًّا، بلا مفتاح'),
    ('public.is_owner()',   'public.sq_can_approve()',
     'بوّابة اعتماد السعر — قرار تسعير، فللمالك وحده'),
    ('public.is_staff()',   'public.sq_can_view()',
     'كلّ بوّابة موظّف تستبعد العميل بـis_staff أوّلًا'),
    ('public.clients',      'public.sq_quotes',
     'مفتاح أجنبيّ client_id'),
    ('auth.users',          'public.sq_audit',
     'عمود actor')
  ) as t(dep, dependent, why)
),
order_eval as (
  select
    o.dep, o.dependent, o.why,
    case
      when o.dep like '%()' then (to_regprocedure(o.dep) is not null)
      else (to_regclass(o.dep) is not null)
    end as dep_present
  from order_proof o
),

-- ─── (٤) تصادم الأسماء ─────────────────────────────────────────────────────
-- الموديول يحجز البادئة sq_. أيّ كائن sq_* سابق **لا يخصّنا** يعني أنّ اسمًا
-- سيُعاد تعريفه فوق شيء آخر. RUNME §0 يُسقط دوالّ sq_* وسياساتها عمدًا كي
-- تبقى الترحيلة قابلة لإعادة التشغيل — فوجود كائناتنا نحن ليس مشكلة.
collide as (
  select
    count(*) filter (where c.relkind = 'r') as sq_tables,
    count(*) filter (where c.relkind = 'S') as sq_sequences
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'sq\_%'
),
collide_fn as (
  select count(*) as sq_functions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'sq\_%'
),

-- ─── (٥) الجوار الحسّاس — الثغرة التي لا يجوز أن تعود ──────────────────────
-- المركز المالي أثبت الدرس: دورٌ واحد نال طرفَي (إيراد − تكلفة) فاستنتج
-- الهامش بطرحٍ بسيط. التسعير يحمل الطرفين معًا بطبيعته، فوجود المركز المالي
-- يعني أنّ الجمع بين الموديولين ممكن نظريًّا. نُثبت هنا أنّ بوّابته الحسّاسة
-- ما زالت للمالك حرفيًّا؛ لأنّ حارسنا يساويها ولا يقلّ عنها.
fin_guard as (
  select
    to_regprocedure('public.finops_can_view_finance_sensitive()') is not null as fin_present,
    coalesce(
      (select pg_get_functiondef(to_regprocedure('public.finops_can_view_finance_sensitive()')::oid)
         ilike '%is_owner%'), false) as fin_owner_only
),

-- ═══════════════════════════════════════════════════════════════════════════
rows_out as (

  select 1 as grp, 10 as ord,
    case when not present then 'BLOCKER'
         when rettype_ok is false then 'BLOCKER'
         else 'PASS' end as verdict,
    'اعتماديّة صلبة' as area,
    obj as subject,
    case when not present then 'غير موجود — RUNME سيفشل'
         when rettype_ok is false then 'موجود لكنّه لا يُرجع boolean — سيبني حارسًا بمعنى غير محدَّد'
         else 'موجود وبالنوع الصحيح' end as detail,
    why as note
  from hard_typed

  union all
  select 2, 20,
    case when present then 'PASS' else 'OPTIONAL' end,
    'اعتماديّة اختيارية', obj,
    case when present then 'موجود — الميزة ستُفعَّل'
         else 'غائب — سيُتخطّى بلطف، ولا يمنع التشغيل' end,
    why
  from soft_eval

  union all
  select 3, 30,
    case when dep_present then 'PASS' else 'BLOCKER' end,
    'إثبات الترتيب', dependent,
    case when dep_present
         then 'الاعتماديّة ' || dep || ' موجودة قبله ✔'
         else 'الاعتماديّة ' || dep || ' غائبة ⇒ ' || dependent || ' لن تُنشأ' end,
    why
  from order_eval

  union all
  select 4, 40, 'INFO', 'تصادم الأسماء', 'public.sq_*',
    'جداول: ' || c.sq_tables || ' · تسلسلات: ' || c.sq_sequences ||
    ' · دوالّ: ' || f.sq_functions,
    case when c.sq_tables = 0 and f.sq_functions = 0
         then 'تثبيت أوّل — لا شيء سابق'
         else 'إعادة تشغيل — §0 في RUNME يُسقط السياسات والدوالّ ثمّ يعيد بناءها؛ الجداول والبيانات تبقى' end
  from collide c cross join collide_fn f

  union all
  select 5, 50,
    case when not fin_present then 'INFO'
         when fin_owner_only then 'PASS'
         else 'BLOCKER' end,
    'الجوار الحسّاس', 'finops_can_view_finance_sensitive()',
    case when not fin_present then 'المركز المالي غير مثبَّت — لا جوار يُفحص'
         when fin_owner_only then 'ما زالت للمالك حرفيًّا ✔'
         else '★ لم تعد تشترط is_owner ★ — الثغرة المالية عادت؛ لا تُضِف التسعير فوقها' end,
    'حارس التكلفة في التسعير يساوي هذه البوّابة صرامةً؛ لو ضعُفت هي لصار الجمع بين الموديولين يكشف الهامش'
  from fin_guard

  union all
  select 6, 60,
    case when to_regprocedure('public.is_owner()') is null then 'BLOCKER' else 'INFO' end,
    'قرار التصميم', 'حارس التكلفة بلا مفتاح',
    'sq_can_view_cost() = is_staff() AND is_owner() — لا sq_perm ولا staff_role',
    'لو كانت التكلفة مفتاحًا قابلًا للمنح لانتهت «للمالك وحده» إلى منحة تُعطى مرّة وتُنسى'
)

select
  case verdict when 'BLOCKER' then '⛔ BLOCKER'
               when 'OPTIONAL' then '○ OPTIONAL'
               when 'INFO' then 'ℹ INFO'
               else '✔ PASS' end as verdict,
  area, subject, detail, note
from rows_out
order by
  case verdict when 'BLOCKER' then 0 when 'OPTIONAL' then 1 when 'INFO' then 2 else 3 end,
  grp, ord, subject;

-- ════════════════════════════════════════════════════════════════════════════
-- كيف تقرأ النتيجة
-- ─────────────────
-- • أيّ صفّ ⛔ BLOCKER  → لا تُشغّل RUNME قبل معالجته. تحديدًا: غياب
--   public.is_owner() ليس «ميزة ناقصة» بل بوّابة تكلفة لا تُبنى، ومعها ينهار
--   كامل حارس الربحية.
-- • ○ OPTIONAL فقط     → التشغيل آمن؛ الميزة المذكورة تُتخطّى بلطف والسطح
--   يقول «بانتظار التفعيل» بدل أن ينهار.
-- • كلّها ✔/ℹ           → شغّل docs/smart_quoting_RUNME.sql ثمّ
--   docs/smart_quoting_POSTCHECK.sql.
-- ════════════════════════════════════════════════════════════════════════════
