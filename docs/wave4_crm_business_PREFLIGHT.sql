-- WAVE 4 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('crm_opportunities'),('crm_companies'),('crm_activities'),
             ('kian_testimonials'),('project_shoot_sessions'),
             ('project_closure_requests'),('fin_payment_milestones'),('fin_collections'),
             ('crm_opportunity_tender'),('crm_testimonial_invites')) v(n);

select 'GATE' as kind, v.n as name,
       case when to_regproc(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('crm_can_manage','public.crm_can_manage()'),
             ('crm_can_read_opportunity','public.crm_can_read_opportunity(uuid)'),
             ('crm_can_edit_opportunity','public.crm_can_edit_opportunity(uuid)'),
             -- غيابها لا يُفشل التطبيق: الهامش يبقى محجوبًا (الإخفاء هو الافتراض).
             ('can_see_financials','public.can_see_financials()')) v(n,sig);

select 'EXTENSION' as kind, 'pgcrypto' as name,
       case when count(*)=0 then '🔴 مفقود — إصدار الدعوات سيفشل' else '✅ موجود' end as status
from pg_extension where extname='pgcrypto';

-- ⛔ لا نظام موازٍ. وجود أيّ منها يعني CRM ثانيًا يجب حسمه قبل التطبيق.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام موازٍ — توقّف' end as status
from (values ('tenders'),('client_health'),('follow_ups'),('rate_card_items')) v(n);

-- خطّ أساس صلاحيات anon قبل أن نمنحه دالّة واحدة.
select 'ANON_GRANTS' as kind, routine_name as name, privilege_type as status
from information_schema.role_routine_grants
where routine_schema='public' and grantee='anon' and routine_name like 'crm_%';
