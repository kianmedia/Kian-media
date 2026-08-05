-- WAVE 5 · delivery_rights · POSTCHECK — قراءة فقط. كل سطر يجب أن يقول ✅.
select 'أعمدة الحقوق' as check,
       case when count(*)=5 then '✅ 5/5' else '🔴 '||count(*)::text||'/5' end as result
from information_schema.columns where table_schema='public' and table_name='deliverables'
  and column_name in ('showreel_allowed','confidential','rights_note','rights_set_by','rights_set_at');

select 'الافتراض false للإذن التسويقي' as check,
       case when column_default like '%false%' then '✅' else '🔴 الإذن مفترض لا ممنوح' end as result
from information_schema.columns where table_schema='public' and table_name='deliverables'
  and column_name='showreel_allowed';

select '🔴 حارس تجميد الجدول القديم' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — الكتابة القديمة ما تزال ممكنة' end as result
from pg_trigger where tgname='trg_dv_block_legacy_writes' and not tgisinternal;

select '🔴 حارس نزاهة الإصدار' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from pg_trigger where tgname='trg_dv_integrity_guard' and not tgisinternal;

select '🔴 نسخة نهائية واحدة لكل مخرَج' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — نهائيّان ممكنان' end as result
from pg_indexes where schemaname='public' and indexname='deliverable_versions_one_final';

select 'عرض التصفية التسويقية' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from pg_views where schemaname='public' and viewname='deliverable_showreel_v';

select 'جدول روابط التسليم + RLS' as check,
       case when bool_and(c.relrowsecurity) then '✅' else '🔴 RLS مطفأ' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='delivery_share_links';

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name in ('delivery_share_links','deliverable_showreel_v')
  and grantee in ('anon','PUBLIC');

select 'قدرات العميل بلا أدوار جديدة' as check,
       case when count(*)=2 then '✅' else '🔴 '||count(*)::text||'/2' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('pc_client_can_approve','pc_client_can_view');

select 'دوالّ الروابط والحقوق' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('delivery_link_issue','delivery_link_revoke','delivery_link_check','deliverable_rights_set');

-- 🔴 anon يملك التحقّق من الرمز وحده.
select 'anon يملك delivery_link_check فقط' as check,
       -- 🔴 `routine_name` نوعه `information_schema.sql_identifier` لا `text`،
       --    ومقارنة `sql_identifier[]` بـ`text[]` بلا مُعامل ⇒ يفشل الاستعلام
       --    **وقت التشغيل** داخل POSTCHECK، أي بعد التطبيق على قاعدة حيّة.
       case when array_agg(routine_name::text order by routine_name::text)
                 = array['delivery_link_check']::text[]
            then '✅' else '🔴 '||array_to_string(
                 array_agg(routine_name::text order by routine_name::text), ', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text='anon'
  and routine_name in ('delivery_link_issue','delivery_link_revoke','delivery_link_check','deliverable_rights_set');
