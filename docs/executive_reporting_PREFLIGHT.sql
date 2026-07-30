-- ════════════════════════════════════════════════════════════════════════════
-- executive_reporting_PREFLIGHT.sql                   (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ قبل executive_reporting_RUNME.sql. كلّ استعلام هنا SELECT صِرف.
--
-- هذه الحزمة **لا تُنشئ بيانات ولا مقاييس جديدة**: كلّ رقم فيها يُقرأ من موديول
-- قائم عبر دالّته المُصرَّح بها. لذلك ما يهمّ قبل التشغيل شيئان فقط:
--   ١) أنّ مُسنَدات الهويّة الأساسية موجودة (is_staff/is_owner/is_admin).
--   ٢) أن تعرف **أيّ الموديولات مطبَّق فعلًا**، لأنّ الغائب منها سيظهر في اللوحة
--      بحالة «غير متاح» مع السبب — ولن يظهر أبدًا كصفر.
--
-- منهج المطابقة: pg_catalog/information_schema بدل تخمين الأسماء.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية ───────────────────────────────────────────────
-- متوقّع: ٣ صفوف، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()')) f(sig);

-- متوقّع: present = true.
select 'public.profiles' as obj, (to_regclass('public.profiles') is not null) as present;

-- ─── 2) مصادر المؤشّرات — تُكتشف ولا تُفترض ───────────────────────────────
-- ★ هذا هو أهمّ قسم في الملفّ ★
-- كلّ سطر exists_now = false هنا يعني أنّ مؤشّراته ستُعرض في اللوحة بحالة
-- «غير متاح: الموديول غير مطبَّق» مع اسم ملفّ الـRUNME المطلوب. هذا سلوك مقصود
-- ومختبَر: صفرٌ معناه «لا مشاكل»، وعرض «غير مطبَّق» كصفر كذبة تُقرأ كطمأنينة.
select f.sig, f.module, f.runme, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.comms_health()',            'communications', 'docs/communications_hub_RUNME.sql'),
  ('public.comms_can_view()',          'communications', 'docs/communications_hub_RUNME.sql'),
  ('public.prodops_dashboard(jsonb)',  'production',     'docs/operations_center_RUNME.sql'),
  ('public.prodops_conflicts(jsonb)',  'production',     'docs/operations_center_RUNME.sql'),
  ('public.prodops_calendar(date,date,jsonb)', 'production', 'docs/operations_center_RUNME.sql'),
  ('public.prodops_can_view()',        'production',     'docs/operations_center_RUNME.sql'),
  ('public.crm_dashboard(jsonb)',      'sales',          'docs/crm_sales_FOUNDATION_RUNME.sql'),
  ('public.crm_leads_list(jsonb)',     'sales',          'docs/crm_sales_FOUNDATION_RUNME.sql'),
  ('public.crm_can_view()',            'sales',          'docs/crm_sales_FOUNDATION_RUNME.sql'),
  ('public.finops_dashboard(jsonb)',   'finance',        'docs/finance_profitability_RUNME.sql'),
  ('public.finops_can_view()',         'finance',        'docs/finance_profitability_RUNME.sql'),
  ('public.finops_can_view_profit()',  'finance',        'docs/finance_profitability_RUNME.sql')
) f(sig, module, runme)
order by f.module, f.sig;

-- ─── 3) محرّك الصلاحيات — اختياريّ، وغيابه يضيّق ولا يوسّع ────────────────
-- متوقّع: توثيقيّ. لو غاب emp_has_permission فسيقتصر الوصول على المالك وحده،
-- لأنّ الجسر يفشل مغلقًا (false) لا مفتوحًا.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(uuid,text)')) f(sig);

select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.permissions')) o(name);

-- ─── 4) لا تصادم أسماء: mgmt_* حرّة قبل التشغيل ──────────────────────────
-- ⚠️ البادئة mgmt_ اختيرت عمدًا بعد فحص التصادم: البادئتان exec_ وexecutive_
--    محجوزتان بالكامل لتقارير **منصّة المشاريع المجمَّدة** (exec_can، exec_gov_counts،
--    executive_portfolio_dashboard …). إعادة استعمالهما كانت ستلمس سطحًا مُقفَلًا.
-- متوقّع: صفر صفّ في الاستعلامين.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mgmt\_%';

select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'mgmt\_%';

-- متوقّع: قائمة دوالّ منصّة المشاريع التنفيذية — تُسجَّل هنا ولن تُلمَس إطلاقًا.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'exec\_%' or p.proname like 'executive\_%')
order by p.proname;

-- ─── 5) مفاتيح الصلاحيات القائمة تبقى كما هي ─────────────────────────────
-- متوقّع: صفر صفّ (لا مفتاح exec_report.* قبل التشغيل).
select key from public.permissions where key like 'exec\_report.%';

-- متوقّع: احتفظ بهذه القائمة وقارنها في POSTCHECK — الحزمة تضيف exec_report.*
-- فقط ولا تعدّل مفتاحًا قائمًا.
select key, category, sensitivity from public.permissions
where key like 'crm.%' or key like 'finance_ops.%' or key like 'ops.%'
order by key;

-- ─── 6) تنبيه صريح قبل التشغيل ────────────────────────────────────────────
-- هذه الحزمة لا تمنح أحدًا شيئًا تلقائيًّا. بعد تشغيلها لن يرى اللوحةَ إلّا
-- المالك (is_owner) حتى تُمنَح المفاتيح exec_report.* يدويًّا من شاشة الصلاحيات.
-- والمؤشّرات الحسّاسة (كلّ ما هو مال) **لا مفتاح لها إطلاقًا**: المالك وحده.
select 'no automatic grant' as note,
       'exec_report.view / exec_report.export are granted manually' as after_run,
       'sensitive KPIs are owner-only and deliberately NOT key-grantable' as sensitive_layer;
