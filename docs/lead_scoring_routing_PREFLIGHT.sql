-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_PREFLIGHT.sql — للقراءة فقط. لا يكتب حرفًا.
--
-- المراحل ٦+٧+٨+٩+١٠ (تقييم · توزيع · لوحات · عقود · أحداث).
--
-- ★ هذا الملفّ **يُثبت ترتيب الاعتماديات ولا يفترضه** ★
--   الفرق ليس شكليًّا. مثالان حقيقيّان من هذه الحزمة:
--     • `lsr_can_view()` مكتوبة بلغة SQL، وPostgreSQL يتحقّق من جسمها **لحظة
--       الإنشاء**. غياب `public.is_staff()` لا يُنتج ميزة ناقصة، بل يُسقط
--       الترحيلة كلّها عند أوّل CREATE FUNCTION.
--     • `lsr_lead_profile.lead_id` مفتاح أجنبيّ إلى `public.crm_leads`. غياب
--       جدول العملاء المحتملين يعني أنّ الحزمة كلّها بلا مرساة.
--   وأسوأ من الفشل الصريح سيناريو صامت: بوّابة تُرجع NULL بدل false تنهار كلّ
--   سياسة RLS مبنيّة عليها إلى «غير محدَّد» — وهو ما ليس منعًا.
--
--   لذلك كلّ اعتماديّة تُفحَص بثلاثة أسئلة لا سؤال واحد:
--     ١) هل الكائن موجود؟             (to_regclass / to_regprocedure)
--     ٢) هل نوعه هو المتوقَّع؟         (prorettype = boolean وليس أيّ شيء)
--     ٣) هل ترتيبه صحيح بالنسبة لنا؟  (يجب أن يسبق ما سيُبنى فوقه)
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يستدعي دالّة محميّة. محرّر SQL يعمل بدور postgres و auth.uid() = NULL،
--   فاستدعاء بوّابة حيّة إمّا يرفع «not authorized» أو — الأسوأ — يُرجع false
--   ويُقرأ كأنّ الكائن مكسور. الفحص بنيويّ (كتالوج النظام) لا سلوكيّ.
--
-- النتيجة: مجموعة نتائج واحدة. اقرأ عمود `verdict`:
--   BLOCKER  → لا تُشغّل RUNME. ستفشل، أو ستبني حارسًا أعمى.
--   WARN     → تعارض محتمل يستحقّ قرارًا واعيًا قبل التشغيل.
--   OPTIONAL → ميزة اختيارية ستُتخطّى بلطف (مكتشَفة وقت التشغيل).
--   INFO     → معلومة حالة.
--   PASS     → مستوفى.
-- ════════════════════════════════════════════════════════════════════════════

with

-- ─── (١) الاعتماديات الصلبة ────────────────────────────────────────────────
hard as (
  select * from (values
    ('relation', 'public.crm_leads',
     '★ المرساة ★ lsr_lead_profile و lsr_score_manual و lsr_assignments كلّها مفاتيح أجنبية إليه'),
    ('relation', 'public.crm_activities',
     'سلوك الاستجابة مشتقّ منه — بدونه العامل الثامن عشر بلا مصدر'),
    ('relation', 'public.crm_companies',
     'ملكية الحساب القائم في التوزيع تُقرأ من crm_companies.owner_user_id'),
    ('relation', 'public.clients',
     'lsr_lead_profile.existing_client_id مفتاح أجنبيّ إليه'),
    ('relation', 'auth.users',
     'كلّ عمود فاعل (assigned_by / overridden_by / set_by) يشير إليهم'),
    ('function', 'public.is_staff()',
     '★ أساس كلّ بوّابة: الموظّف مقابل العميل. غيابه يُسقط أوّل CREATE FUNCTION'),
    ('function', 'public.is_owner()',
     '★ لوحة المالك التجارية تُبنى فوقها حرفيًّا — بلا مفتاح وبلا بديل'),
    ('function', 'public.is_admin()',
     'الطبقة الإدارية في lsr_is_owner_role()')
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
-- نوع الإرجاع: بوّابة تُرجع غير boolean تُنتج سياسات بمعنى «غير محدَّد».
hard_typed as (
  select e.*,
         case when e.kind <> 'function' or not e.present then null
              else (select p.prorettype = 'boolean'::regtype
                      from pg_proc p where p.oid = to_regprocedure(e.obj)) end as rettype_ok
    from hard_eval e
),
hard_rows as (
  select 10 as ord, 'الاعتماديات الصلبة' as area,
         t.obj as check_name,
         case when not t.present then 'BLOCKER'
              when t.rettype_ok is false then 'BLOCKER'
              else 'PASS' end as verdict,
         case when not t.present then 'غير موجود — ' || t.why
              when t.rettype_ok is false then 'موجود لكنّه لا يُرجع boolean — ' || t.why
              else 'موجود وبالنوع الصحيح' end as detail
    from hard_typed t
),

-- ─── (٢) أعمدة بعينها نعتمد عليها بالاسم ───────────────────────────────────
-- «الجدول موجود» لا يكفي: نقرأ أعمدة محدّدة، وغيابها خطأ 42703 وقت التشغيل
-- لا وقت الإنشاء — أي عطل صامت بعد النشر.
cols as (
  select * from (values
    ('crm_leads',      'owner_user_id',   'عمود الملكية الذي يكتبه lsr_assign — لا مصدر ثانٍ للملكية'),
    ('crm_leads',      'assigned_at',     'ختم وقت الإسناد'),
    ('crm_leads',      'status',          'حالة العميل — تُستعمل في حساب الحِمل'),
    ('crm_leads',      'budget_band',     'العامل الأوّل: مدى الميزانية'),
    ('crm_leads',      'company_size',    'العامل الثالث: حجم الشركة'),
    ('crm_leads',      'source',          'العامل العاشر: المصدر'),
    ('crm_leads',      'email_norm',      'اكتمال البيانات + كشف «مجهول بلا قناة تواصل»'),
    ('crm_leads',      'phone_norm',      'اكتمال البيانات + كشف «مجهول بلا قناة تواصل»'),
    ('crm_leads',      'company_id',      'الربط بالشركة لملكية الحساب القائم'),
    ('crm_leads',      'next_action_due', 'لوحة المبيعات: المتابعات المستحقّة'),
    ('crm_activities', 'direction',       'تصنيف سلوك الاستجابة (وارد/صادر)'),
    ('crm_activities', 'occurred_at',     'نافذة «سريع الاستجابة»'),
    ('crm_companies',  'owner_user_id',   '★ ملكية الحساب القائم في التوزيع')
  ) as t(tbl, col, why)
),
cols_rows as (
  select 20 as ord, 'الأعمدة المطلوبة بالاسم' as area,
         c.tbl || '.' || c.col as check_name,
         case when to_regclass('public.' || c.tbl) is null then 'BLOCKER'
              when exists (select 1 from information_schema.columns ic
                            where ic.table_schema = 'public' and ic.table_name = c.tbl
                              and ic.column_name = c.col) then 'PASS'
              else 'BLOCKER' end as verdict,
         case when to_regclass('public.' || c.tbl) is null then 'الجدول نفسه غائب'
              when exists (select 1 from information_schema.columns ic
                            where ic.table_schema = 'public' and ic.table_name = c.tbl
                              and ic.column_name = c.col) then 'موجود — ' || c.why
              else '★ العمود غائب ★ ' || c.why || ' — سيفشل وقت التشغيل بـ42703 لا وقت الإنشاء'
         end as detail
    from cols c
),

-- ─── (٣) الاعتماديات الاختيارية — الغياب يُعلَن ولا يُقرأ صفرًا ────────────
soft as (
  select * from (values
    ('relation', 'public.csub_subscriptions',
     'لوحة المالك والعميل: الاشتراكات. غيابها ⇒ available=false لا صفر'),
    ('relation', 'public.csub_ledger',
     'الأرصدة والاستهلاك. غيابه ⇒ لا يُعرض رصيد إطلاقًا'),
    ('relation', 'public.csub_service_requests',
     'طابور العمليات وطلبات العميل'),
    ('relation', 'public.csub_approval_requests',
     'طلبات التجاوز المعلّقة في لوحة المالك'),
    ('relation', 'public.sq_quotes',
     'تحويل العروض والعروض الراكدة'),
    ('relation', 'public.sq_approval_requests',
     'اعتمادات الخصم في لوحة المالك'),
    ('relation', 'public.fin_receivables',
     'مرجع الذمم — للقراءة فقط، وبلا كتابة إطلاقًا'),
    ('relation', 'public.comms_event_catalog',
     'كتالوج الأحداث. غيابه ⇒ الحدث يُسجَّل محليًّا ويُعلن «المركز غير مثبَّت»'),
    ('relation', 'public.comms_outbox',
     'الطابور الذي نُجبر صفوفه على dry_run'),
    ('function', 'public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)',
     '★ التوقيع بالضبط ★ اختلافه يعني أنّ الإدراج لن يجد الدالّة'),
    ('function', 'public.emp_has_permission(uuid,text)',
     'محرّك الصلاحيات. غيابه ⇒ lsr_perm ترجع false (fail-closed) والمالك وحده يعمل'),
    ('function', 'public.my_client_id()',
     '★ لوحة العميل ★ غيابها ⇒ اللوحة تعلن identity_not_enabled ولا تعرض رصيدًا'),
    ('function', 'public.crm_can_read_lead(uuid)',
     'رؤية العميل المحتمل في سياسات RLS. غيابها ⇒ سياسة أوسع قليلًا داخل الموظّفين')
  ) as t(kind, obj, why)
),
soft_rows as (
  select 30 as ord, 'الاعتماديات الاختيارية' as area,
         s.obj as check_name,
         case when (case s.kind when 'relation' then to_regclass(s.obj) is not null
                                else to_regprocedure(s.obj) is not null end)
              then 'PASS' else 'OPTIONAL' end as verdict,
         case when (case s.kind when 'relation' then to_regclass(s.obj) is not null
                                else to_regprocedure(s.obj) is not null end)
              then 'موجود — ' || s.why
              else 'غائب. الحزمة تُركَّب وتعمل، والقسم المعتمد عليه يُعلن «غير مفعّل» صراحةً. ' || s.why
         end as detail
    from soft s
),

-- ─── (٤) ترتيب البناء — البرهان لا الافتراض ────────────────────────────────
-- ما يهمّ ليس «هل هي موجودة» بل «هل هي موجودة **قبلنا**». الطريقة الوحيدة
-- الصادقة: أن نتحقّق أنّ ما سنبني فوقه موجود الآن، وأنّ ما سننشئه ليس موجودًا
-- بتعريف مخالف يُسبّب 42P13 (تغيير نوع الإرجاع بـCREATE OR REPLACE).
order_rows as (
  select 40 as ord, 'ترتيب البناء' as area,
         'الأساس قبل البوّابات' as check_name,
         case when to_regprocedure('public.is_staff()') is not null
               and to_regprocedure('public.is_owner()') is not null
               and to_regclass('public.crm_leads') is not null
              then 'PASS' else 'BLOCKER' end as verdict,
         'دوالّ lsr_can_* بلغة SQL تُتحقَّق أجسامها لحظة الإنشاء: is_staff/is_owner يجب أن تسبقها، '
         || 'و crm_leads يجب أن يسبق كلّ مفتاح أجنبيّ.' as detail
  union all
  select 41, 'ترتيب البناء',
         'تعارض توقيع مع دوالّ قائمة (42P13)',
         case when exists (
                select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'lsr\_%'
                   and p.prorettype <> 'jsonb'::regtype
                   and p.prorettype <> 'boolean'::regtype
                   and p.prorettype <> 'void'::regtype
                   and p.prorettype <> 'int4'::regtype
                   and p.prorettype <> 'text'::regtype
                   and p.prorettype <> 'numeric'::regtype
                   and p.prorettype <> 'trigger'::regtype
                   and p.prorettype <> ('text[]')::regtype)
              then 'WARN' else 'PASS' end,
         'CREATE OR REPLACE لا يغيّر نوع الإرجاع: دالّة lsr_* قائمة بنوع مخالف تُسقط الترحيلة بـ42P13. '
         || 'حالة نظيفة = لا دوالّ lsr_* سابقة، أو أنواعها مطابقة.'
  union all
  select 42, 'ترتيب البناء',
         'أسماء lsr_* مشغولة مسبقًا',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'lsr\_%') = 0
              then 'INFO' else 'INFO' end,
         'دوالّ lsr_* الموجودة الآن: '
         || (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'lsr\_%')
         || ' (صفر = تركيب أوّل · أكثر = إعادة تشغيل، وهي مدعومة).'
),

-- ─── (٥) حراسة العقود — ما يجب أن يبقى صحيحًا بعد التشغيل ──────────────────
contract_rows as (
  select 50 as ord, 'العقود' as area, 'منصّة المشاريع مجمَّدة' as check_name,
         'INFO' as verdict,
         'هذه الحزمة لا تُنشئ مشروعًا ولا تعدّل projects/project_core/deliverables. '
         || 'إن وُجدت projects فهي مرجع للقراءة فقط.' as detail
  union all
  -- ⚠️ ملاحظة تقنية مقصودة: الجداول الاختيارية **لا تُذكر مباشرةً** في أيّ
  --    استعلام هنا. PostgreSQL يحلّ أسماء الجداول وقت التحليل لا وقت التنفيذ،
  --    فـ CASE لا يحمي من جدول غير موجود: الملفّ كلّه كان سيفشل بـ42P01 على
  --    قاعدة نظيفة — أي أنّ أداة الفحص تنهار بدل أن تُبلّغ. لذلك القراءة
  --    الديناميكية عبر query_to_xml، وهي تُقيَّم عند التنفيذ وداخل الفرع فقط.
  select 51, 'العقود', 'حالة قنوات الإرسال',
         case when to_regclass('public.comms_channels') is null then 'INFO'
              when coalesce((xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.comms_channels
                       where enabled and not dry_run and channel in (''email'',''whatsapp'')',
                     false, true, '')))[1]::text::int, 0) > 0
              then 'WARN' else 'PASS' end,
         case when to_regclass('public.comms_channels') is null
              then 'مركز الاتصالات غير مثبَّت — لا قناة أصلًا.'
              else 'قنوات مفعّلة بلا dry_run: '
                   || coalesce((xpath('/row/c/text()', query_to_xml(
                        'select coalesce(string_agg(channel, '', ''), ''لا شيء'') as c
                           from public.comms_channels where enabled and not dry_run',
                        false, true, '')))[1]::text, 'لا شيء')
                   || '. ملاحظة: أحداث هذه الحزمة تُجبَر على dry_run بعد الإدراج بصرف النظر عن ذلك.'
         end
  union all
  select 52, 'العقود', 'مفتاح تكرار الطابور قائم',
         case when to_regclass('public.comms_outbox') is null then 'OPTIONAL'
              when exists (select 1 from pg_indexes i
                            where i.schemaname = 'public' and i.tablename = 'comms_outbox'
                              and i.indexdef ilike '%unique%' and i.indexdef ilike '%idempotency_key%')
              then 'PASS' else 'WARN' end,
         'الحماية من الإرسال المزدوج تحتاج فهرسًا فريدًا على idempotency_key في الطابور، '
         || 'إضافةً إلى فهرس هذه الحزمة على lsr_event_log.'
),

-- ─── (٦) لقطة حالة تُقرأ قبل وبعد ──────────────────────────────────────────
-- كلّ عدّ هنا ديناميكيّ للسبب نفسه: أداة الفحص يجب أن تُبلّغ عن الغياب لا أن
-- تنهار بسببه.
state_rows as (
  select 60 as ord, 'الحالة' as area, 'عملاء محتملون مفتوحون' as check_name, 'INFO' as verdict,
         case when to_regclass('public.crm_leads') is null then 'الجدول غائب — لا لقطة حالة'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.crm_leads
                       where is_deleted = false
                         and status in (''new'',''contacted'',''working'',''qualified'')',
                     false, true, '')))[1]::text, '?')
                   || ' صفًّا سيصير قابلًا للتقييم والتوزيع' end as detail
  union all
  select 61, 'الحالة', 'عملاء محتملون بلا مالك', 'INFO',
         case when to_regclass('public.crm_leads') is null then 'الجدول غائب — لا لقطة حالة'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.crm_leads
                       where is_deleted = false and owner_user_id is null and status <> ''converted''',
                     false, true, '')))[1]::text, '?')
                   || ' صفًّا — هذا هو المدخل الطبيعيّ للتوزيع' end
  union all
  select 62, 'الحالة', 'عملاء محتملون بلا قناة تواصل', 'INFO',
         case when to_regclass('public.crm_leads') is null then 'الجدول غائب — لا لقطة حالة'
              else coalesce((xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.crm_leads
                       where is_deleted = false and email_norm is null and phone_norm is null
                         and status in (''new'',''contacted'',''working'',''qualified'')',
                     false, true, '')))[1]::text, '?')
                   || ' صفًّا — هؤلاء يذهبون إلى طابور المراجعة ولا يُوزَّعون تلقائيًّا' end
),

results as (
  select * from hard_rows
  union all select * from cols_rows
  union all select * from soft_rows
  union all select * from order_rows
  union all select * from contract_rows
  union all select * from state_rows
),

summary as (
  select 0 as ord, 'الخلاصة' as area,
         'هل يجوز تشغيل RUNME؟' as check_name,
         case when exists (select 1 from results where verdict = 'BLOCKER') then 'BLOCKER'
              when exists (select 1 from results where verdict = 'WARN') then 'WARN'
              else 'PASS' end as verdict,
         case when exists (select 1 from results where verdict = 'BLOCKER')
              then '★ لا تُشغّل ★ عدد الموانع: '
                   || (select count(*)::text from results where verdict = 'BLOCKER')
                   || '. عالجها أوّلًا — أغلبها يعني تشغيل crm_sales_FOUNDATION_RUNME.sql.'
              when exists (select 1 from results where verdict = 'WARN')
              then 'يجوز التشغيل بعد قراءة تحذيرات WARN واتّخاذ قرار واعٍ.'
              else 'لا موانع. شغّل docs/lead_scoring_routing_RUNME.sql ثمّ POSTCHECK.'
         end as detail
)

select verdict, area, check_name, detail
  from (select * from summary union all select * from results) x
 order by (case verdict when 'BLOCKER' then 0 when 'WARN' then 1
                        when 'OPTIONAL' then 2 when 'INFO' then 3 else 4 end), ord, check_name;
