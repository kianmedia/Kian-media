-- WAVE 3 · إغلاق · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('ops_jobs'),('ops_locations'),('ops_job_permits'),
             ('ops_permits'),('ops_media')) v(n);

-- بوّابات الصلاحية المُستعمَلة كما هي.
select 'FUNCTION' as kind, p.proname as name, '✅ موجود' as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('prodops_can_view','prodops_can_manage');

-- 🔴 مساعدات الإشعار القائمة. غيابها ⇒ §7 ترجع disabled (ولا تخترع مسارًا ثانيًا).
select 'NOTIFY_HELPER' as kind, v.n as name,
       case when to_regproc(v.sig) is null then '⚠️ مفقود — التنبيهات ستُعلن disabled' else '✅ موجود' end as status
from (values ('civ_alert_once','public.civ_alert_once(text,text,text,uuid)'),
             ('civ_notify_managers','public.civ_notify_managers(text,uuid,text,uuid)')) v(n,sig);

-- العمود المضاف على الجدول القائم — يجب أن يكون غائبًا.
select 'COLUMN' as kind, 'ops_job_permits.registry_permit_id' as name,
       case when count(*)=0 then '✅ غائب (سيُضاف)' else '🟡 موجود مسبقًا' end as status
from information_schema.columns
where table_schema='public' and table_name='ops_job_permits' and column_name='registry_permit_id';

-- ⛔ لا جدول موازٍ يُنشأ. إن وُجد أحدها فهناك نظام ثانٍ يجب حسمه أوّلًا.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام موازٍ قائم — توقّف' end as status
from (values ('permits'),('permit_registry'),('location_media'),('location_photos')) v(n);
