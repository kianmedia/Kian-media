-- WAVE 6 · assets_archive · POSTCHECK — قراءة فقط. كل سطر يجب أن يقول ✅.
select 'الجداول الستّة + RLS' as check,
       case when count(*) filter (where c.relrowsecurity)=6 then '✅ 6/6' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('asset_insurance_coverage','archive_media','archive_project_links',
   'music_licenses','music_license_project_links','model_releases');

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة: '||string_agg(distinct table_name,', ') end as result
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','PUBLIC')
  and table_name in ('asset_insurance_coverage','archive_media','archive_project_links',
                     'music_licenses','music_license_project_links','model_releases');

-- 🔴 لا رابط تخزين مخزَّن في أيّ من الجدولين الحسّاسين.
select 'لا عمود رابط في المستندات' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(table_name||'.'||column_name,', ') end as result
from information_schema.columns
where table_schema='public' and table_name in ('model_releases','music_licenses')
  and column_name ~* '(^|_)(url|href|signed)';

select 'قيود المستندات (bucket+path معًا، ولا http)' as check,
       case when count(*)=2 then '✅ 2/2' else '🔴 '||count(*)::text||'/2' end as result
from pg_constraint where conname in ('mr_doc_pair','ml_proof_pair');

select '🔴 حقّ السحب (PDPL)' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — سحب بلا وقت ممكن' end as result
from pg_constraint where conname='mr_withdrawn_pair';

-- ⛔ والحدّ الأدنى من البيانات الشخصية: لا رقم هويّة ولا عنوان.
select 'PDPL — أقلّ بيانات' as check,
       case when count(*)=0 then '✅ لا حقول هويّة/عنوان'
            else '🔴 '||string_agg(column_name,', ') end as result
from information_schema.columns
where table_schema='public' and table_name='model_releases'
  and column_name ~* '(national_id|iqama|passport|address|dob|birth)';

select 'الجداول تُنشأ فارغة' as check,
       case when (select count(*) from public.archive_media)=0
             and (select count(*) from public.music_licenses)=0
             and (select count(*) from public.model_releases)=0
            then '✅' else '🟡 فيها صفوف — تحقّق من مصدرها' end as result;

-- ─── W6-1 · الاحتفاظ ───────────────────────────────────────────────────────
select '🔴 لا مدّة احتفاظ مفترضة' as check,
       case when column_default is null then '✅ nullable بلا افتراض'
            else '🔴 قيمة افتراضية مخترعة: '||column_default end as result
from information_schema.columns
where table_schema='public' and table_name='archive_media' and column_name='retention_until';

select '🔴 AUTO-DELETION DISABLED' as check,
       case when count(*)=1 then '✅ مقيَّد بـfalse' else '🔴 يمكن تفعيل حذف تلقائيّ' end as result
from pg_constraint con join pg_class r on r.oid=con.conrelid
where r.relname='archive_media' and pg_get_constraintdef(con.oid) like '%auto_delete_enabled = false%';

select 'الحجز القانونيّ يمنع الإخفاء' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from pg_constraint where conname='archive_media_hold_blocks_delete';

-- ⛔ ولا مُشغِّل ولا دالّة حذف على الأرشيف في هذه الحزمة.
select '⛔ لا مُشغِّل حذف على الأرشيف' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(tgname,', ') end as result
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where c.relname in ('archive_media','archive_project_links') and not t.tgisinternal;
