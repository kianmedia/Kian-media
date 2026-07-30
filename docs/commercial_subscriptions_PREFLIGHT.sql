-- ════════════════════════════════════════════════════════════════════════════
-- commercial_subscriptions_PREFLIGHT.sql              (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ قبل commercial_subscriptions_RUNME.sql. كلّ استعلام هنا SELECT صِرف.
--
-- منهج المطابقة: information_schema/pg_catalog بدل تخمين الأسماء، وilike مع
-- pg_get_functiondef (المُفكِّك يرفع حالة الكلمات المفتاحية).
--
-- ★ ترتيب الاعتماد يُثبَت هنا ولا يُفترَض ★
--   هذه الحزمة تبني دفتر أرصدة محاسبيًّا فوق `public.clients`. غياب هذا الجدول
--   ليس «ميزة معطّلة» بل خطأ ترتيب: RUNME سيرفع استثناءً ويتوقّف قبل كتابة حرف.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية ───────────────────────────────────────────────
-- متوقّع: 4 صفوف، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_staff()'), ('public.is_owner()'),
             ('public.is_admin()'), ('public.my_client_id()')) f(sig);

-- متوقّع: صفّان، present = true في كليهما. `clients` هو مرجع العميل الوحيد،
-- و`profiles` هو مصدر الدور. بلا أوّلهما لا معنى لعزل رصيد عميل عن آخر.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.clients'), ('public.profiles')) o(name);

-- ─── 2) أعمدة clients التي سنعتمد عليها — تُقرأ ولا تُخمَّن ───────────────
-- متوقّع: id · user_id · is_deleted موجودة. غياب is_deleted يعني أنّ
-- my_client_id() في هذا المستودع يقرأ عمودًا غير موجود ⇒ أوقف كلّ شيء.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'clients'
  and column_name in ('id', 'user_id', 'is_deleted', 'company', 'full_name', 'email')
order by column_name;

-- ─── 3) الاعتمادات الاختيارية — الحزمة تكتشفها ولا تفترضها ────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويُغيّر السلوك **بصدق**:
--   • permissions/emp_has_permission غائب ⇒ المالك/الأدمن فقط (fail-closed).
--   • notifications غائب ⇒ لا إشعار داخل التطبيق، ولا يسقط قيد واحد بسببه.
--   • projects غائب ⇒ مرجع المشروع الاختياريّ يبقى نصًّا بلا ربط.
--     ⚠️ حتّى مع وجوده: هذه الحزمة **لا تكتب** في منصّة المشاريع إطلاقًا.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.permissions'), ('public.professions'), ('public.employee_professions'),
             ('public.notifications'), ('public.projects'), ('public.quote_requests')) o(name);

select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(uuid,text)'),
             ('public.notify(uuid,text,text,text,uuid,text,text)')) f(sig);

-- ─── 4) لا تصادم أسماء ────────────────────────────────────────────────────
-- متوقّع: صفر صفّ في الاستعلامين — لا دالّة csub_* ولا جدول csub_* قبل التشغيل.
-- وجود صفوف هنا ليس بالضرورة عطلًا (إعادة تشغيل الحزمة مسموحة وidempotent)،
-- لكنّه يعني أنّك تُعيد التشغيل لا تُنشئ، فاقرأ POSTCHECK بعدها لا قبلها.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'csub\_%'
order by p.proname;

select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','S') and c.relname like 'csub\_%'
order by c.relname;

-- ─── 5) مفاتيح الصلاحيات — أيّها موجود قبل التشغيل؟ ──────────────────────
-- متوقّع: صفر أو أقلّ من ستّة. الترحيلة تبذر الستّة بـon conflict do update.
select key, category, sensitivity from public.permissions
where key like 'csub.%' order by key;

-- ─── 6) قيد notifications.entity_type — تعداد أم شكل؟ ────────────────────
-- متوقّع: إمّا صفر صفّ (لا قيد) أو قيد **شكل** يحتوي '~'. أيّ قيد تعداديّ لا
-- يذكر csub_subscription سيجعل كلّ إشعار اشتراك يُرفض بصمت — والترحيلة تصلحه
-- بالكتلة نفسها المستعملة في CRM وOperations Center (متساوية القوّة الذاتية).
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con
where con.conrelid = to_regclass('public.notifications')
  and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%entity_type%';

-- متوقّع: صفر. أيّ صفّ قائم لا يحترم الشكل يمنع تشديد القيد، والترحيلة
-- ستُبلّغ notice وتترك القيد كما هو بدل أن تكسر بيانات قائمة.
select count(*) as rows_violating_entity_type_shape
from public.notifications
where to_regclass('public.notifications') is not null
  and (entity_type is null or entity_type !~ '^[a-z][a-z0-9_]{2,40}$');

-- ─── 7) تجميد منصّة المشاريع — لقطة قبل/بعد ──────────────────────────────
-- متوقّع: احتفظ بهذه الأعداد وقارنها في POSTCHECK. أيّ تغيّر ⇒ خرق التجميد.
-- هذه الحزمة تقرأ project_id كمرجع اختياريّ فقط ولا تكتب في المنصّة أبدًا.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'projects') as projects_columns,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'clients') as clients_columns;

-- ─── 8) لا صلاحية anon على ما سنبني فوقه ─────────────────────────────────
-- متوقّع: false في كلّ صفّ موجود.
select f.sig, has_function_privilege('anon', f.sig, 'EXECUTE') as anon_exec
from (values ('public.is_staff()'), ('public.my_client_id()'),
             ('public.emp_has_permission(uuid,text)')) f(sig)
where to_regprocedure(f.sig) is not null
  and exists (select 1 from pg_roles where rolname = 'anon');

-- ─── 9) قدرات الخادم المستعملة في الحزمة ────────────────────────────────
-- متوقّع: true في الأربعة.
--   gen_random_uuid  → المفاتيح الأوّلية.
--   identity columns → ترقيم القيود المتسلسل (أساس الرصيد الجاري).
--   generated stored → الإجمالي = الصافي + الضريبة، فلا يُكتب يدويًّا.
--   md5              → بصمة مفتاح التكرار (idempotency fingerprint).
select
  (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
     or to_regprocedure('public.gen_random_uuid()') is not null) as gen_random_uuid_available,
  (current_setting('server_version_num')::int >= 120000)          as identity_and_generated_ok,
  (to_regprocedure('pg_catalog.md5(text)') is not null)           as md5_available,
  (current_setting('standard_conforming_strings') = 'on')         as standard_strings_on;

-- ─── 10) عزل المعاملات — أساس ضمان «لا استهلاك متزامن مزدوج» ────────────
-- متوقّع: read committed (الافتراضيّ). الحزمة **لا** تعتمد على serializable:
-- التسلسل يقع بقفل صفّ صريح (select … for update) على صفّ وحدة الاشتراك، وهو
-- يعمل تحت read committed. لو كان الإعداد أعلى فلا ضرر.
select current_setting('default_transaction_isolation') as isolation;

-- ─── 11) هل توجد بيانات اشتراكات سابقة بأيّ اسم آخر؟ ────────────────────
-- متوقّع: توثيقيّ. الغرض ألّا نبني نظامًا موازيًا فوق نظام قائم دون أن ندري.
-- أيّ صفّ هنا يستحقّ قراءة قبل التشغيل.
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and (table_name ilike '%subscription%' or table_name ilike '%credit%' or table_name ilike '%ledger%')
order by table_name, ordinal_position;
