-- ════════════════════════════════════════════════════════════════════════════
-- crm_sales_FOUNDATION_PREFLIGHT.sql                  (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ قبل crm_sales_FOUNDATION_RUNME.sql. كلّ استعلام هنا SELECT صِرف.
--
-- منهج المطابقة: information_schema/pg_catalog بدل تخمين الأسماء، وilike مع
-- pg_get_functiondef (المُفكِّك قد يرفع حالة الكلمات المفتاحية).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية ───────────────────────────────────────────────
-- متوقّع: 3 صفوف، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()')) f(sig);

-- متوقّع: profiles موجود.
select 'public.profiles' as obj, (to_regclass('public.profiles') is not null) as present;

-- ─── 2) الاعتمادات الاختيارية — الحزمة تكتشفها ولا تفترضها ────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويُغيّر السلوك بصدق:
--   • permissions/emp_has_permission غائب ⇒ المالك/الأدمن فقط (fail-closed)،
--     وتحديدًا crm.view_team الغائب يعني «نفسي فقط» لا «الجميع».
--   • quote_requests غائب ⇒ مرجع عرض السعر معطّل ويُعلَن بصدق (لا 42P01 للمستخدم).
--   • projects غائب ⇒ تسجيل التسليم اليدويّ بلا ربط (اختياريّ أصلًا).
--   • notifications غائب ⇒ لا إشعار، ولا تسقط أيّ عملية بيعية بسببه.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.permissions'), ('public.professions'), ('public.employee_professions'),
             ('public.quote_requests'), ('public.projects'), ('public.hr_employee_profiles'),
             ('public.notifications')) o(name);

select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(uuid,text)'),
             ('public.notify(uuid,text,text,text,uuid,text,text)')) f(sig);

-- ─── 3) أعمدة quote_requests التي سنقرأها — تُقرأ ولا تُخمَّن ─────────────
-- متوقّع: reference · status · created_at. غياب أيّها يجعل crm_quote_ref يفشل
-- بصدق («quote_read_failed») بدل رفع 42703 في وجه المستخدم.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'quote_requests'
  and column_name in ('id','reference','status','created_at');

-- ─── 4) اسم عمود اسم المشروع — يُقرأ ولا يُخمَّن ──────────────────────────
-- متوقّع: صفّ واحد على الأقلّ (project_name في هذا المستودع).
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('project_name','title','name');

-- ─── 5) لا تصادم أسماء ────────────────────────────────────────────────────
-- متوقّع: صفر صفّ — لا دالّة crm_* قبل التشغيل.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%';

-- متوقّع: صفر صفّ — لا جدول crm_* قبل التشغيل.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\_%';

-- متوقّع: توثيقيّ. crm_lead_id عمود نصّيّ في جداول واتساب ولا علاقة له بهذه
-- الحزمة — لا يُلمس ولا يُعاد استعماله كمفتاح.
select table_name, column_name from information_schema.columns
where table_schema = 'public' and column_name = 'crm_lead_id';

-- ─── 6) مفاتيح الصلاحيات — أيّها موجود قبل التشغيل؟ ──────────────────────
-- متوقّع: صفر أو أقلّ من 11. الترحيلة تبذر الأحد عشر بـon conflict do update.
select key, category, sensitivity from public.permissions
where key like 'crm.%' order by key;

-- ─── 7) تجميد منصّة المشاريع — لقطة قبل/بعد ──────────────────────────────
-- متوقّع: احتفظ بهذه الأعداد وقارنها في POSTCHECK. أيّ تغيّر ⇒ خرق التجميد.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'projects') as projects_columns,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'quote_requests') as quote_columns;

-- ─── 8) لا صلاحية anon على ما سنبني فوقه ─────────────────────────────────
-- متوقّع: false في كلّ صفّ موجود.
select f.sig, has_function_privilege('anon', f.sig, 'EXECUTE') as anon_exec
from (values ('public.is_staff()'), ('public.emp_has_permission(uuid,text)')) f(sig)
where to_regprocedure(f.sig) is not null
  and exists (select 1 from pg_roles where rolname = 'anon');

-- ─── 9) قدرات الخادم المستعملة في الحزمة ────────────────────────────────
-- متوقّع: true في الأربعة. U&'' يحتاج standard_conforming_strings = on،
-- وتطبيع العربية يحتاج ترميز UTF8 وإلّا صار كشف التكرار كاذبًا.
select
  (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
     or to_regprocedure('public.gen_random_uuid()') is not null) as gen_random_uuid_available,
  (to_regprocedure('pg_catalog.make_interval(integer,integer,integer,integer,integer,integer,double precision)') is not null)
     as make_interval_available,
  (current_setting('standard_conforming_strings') = 'on') as standard_strings_on,
  (upper(current_setting('server_encoding')) = 'UTF8') as utf8_encoding;

-- ─── 10) ★ من يملك اعتماد الأهداف والعمولات؟ اعرفه قبل التشغيل ──────────
-- الاعتماد يمرّ بـcrm_is_owner_role() = is_owner() OR is_admin() — ولا يُمنح
-- بمفتاح صلاحية إطلاقًا. إن كان is_admin() واسعًا عندك (كلّ موظّفي الإدارة مثلًا)
-- فهؤلاء كلّهم معتمِدون فعليًّا، وهذا قرار تشغيليّ يجب أن تراه **قبل** التشغيل
-- لا بعد أوّل هدف يُعتمَد بلا علمك.
-- متوقّع: توثيقيّ — اقرأ الشرطين وقرّر.
select f.sig, pg_get_functiondef(to_regprocedure(f.sig)) as definition
from (values ('public.is_owner()'), ('public.is_admin()')) f(sig)
where to_regprocedure(f.sig) is not null;

-- ─── 11) قيد notifications.type — يفسّر لماذا الإشعار معزول باستثناء ─────
-- متوقّع: توثيقيّ. قيد قديم لن يقبل crm_opportunity_won، ولذلك crm_notify
-- تبتلع الفشل حتى لا تسقط صفقة صحيحة بسبب إشعار.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = to_regclass('public.notifications') and contype = 'c';
