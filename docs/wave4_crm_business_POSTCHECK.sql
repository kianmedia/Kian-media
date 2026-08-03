-- WAVE 4 · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدولان + RLS' as check,
       case when count(*) filter (where c.relrowsecurity)=2 then '✅ 2/2' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('crm_opportunity_tender','crm_testimonial_invites');

-- 🔴 صحّة العميل **عرض** لا جدول. وجودها كجدول يعني درجة مخزَّنة تتقادم.
select 'صحّة العميل عرض لا جدول' as check,
       case when (select count(*) from pg_views where schemaname='public' and viewname='crm_client_health_v')=1
             and (select count(*) from pg_tables where schemaname='public' and tablename like 'crm_client_health%')=0
            then '✅ عرض مشتقّ' else '🔴 مخزَّن — يتقادم' end as result;

select 'الدوالّ الثماني' as check,
       case when count(*)=8 then '✅ 8/8' else '🔴 '||count(*)::text||'/8' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('crm_tender_upsert','crm_win_rate_report','crm_seasonality_report','crm_silent_clients',
   'crm_weekly_digest','crm_testimonial_invite_issue','crm_testimonial_invite_revoke',
   'crm_testimonial_invite_check');

-- 🔴 anon يملك التحقّق من الرمز **وحده**.
select 'anon يملك crm_testimonial_invite_check فقط' as check,
       case when array_agg(routine_name order by routine_name) = array['crm_testimonial_invite_check']
            then '✅' else '🔴 '||array_to_string(array_agg(routine_name order by routine_name),', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee='anon' and routine_name like 'crm_%';

select 'لا صلاحية جدول لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('crm_opportunity_tender','crm_testimonial_invites','crm_client_health_v')
  and grantee in ('anon','PUBLIC');

select 'دعوة نشطة واحدة لكل مشروع' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — الإلغاء بلا معنى' end as result
from pg_indexes where schemaname='public' and indexname='crm_ti_one_active_per_project';

-- ⛔ والجدولان يُنشآن فارغين: لا بيانات أعمال مخترعة.
select 'الجدولان فارغان' as check,
       case when (select count(*) from public.crm_opportunity_tender)=0
             and (select count(*) from public.crm_testimonial_invites)=0
            then '✅' else '🟡 فيهما صفوف — تحقّق من مصدرها' end as result;
