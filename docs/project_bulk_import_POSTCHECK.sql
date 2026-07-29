-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — الاستيراد الجماعي · فحص بعْديّ **للقراءة فقط**
-- docs/project_bulk_import_POSTCHECK.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **بعد** docs/project_bulk_import_RUNME.sql.
--   لا begin/commit · لا create/alter · لا insert/update/delete · لا grant/revoke.
--   كل استعلام يطبع «المتوقّع» بجانب «الفعليّ». الكتلة الأخيرة ترفع استثناءً عند FAIL.
--
--   ★ الجزء (و) هو الأهمّ: يُثبت idempotency من البيانات نفسها — لا من الوعود.
--     يبقى فارغًا حتى تُنفّذ أوّل دفعة حقيقية، وهذا هو المتوقّع بعد الترحيل مباشرة.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) الجداول والأعمدة والفهارس — المتوقّع: كلّها PASS
-- ─────────────────────────────────────────────────────────────────────────────
select 'public.import_batches'                     as "الكائن", 'موجود' as "المتوقّع",
       case when to_regclass('public.import_batches') is null then 'FAIL' else 'PASS' end as "النتيجة"
union all select 'public.import_rows', 'موجود',
       case when to_regclass('public.import_rows') is null then 'FAIL' else 'PASS' end
union all select 'public.import_batch_events', 'موجود',
       case when to_regclass('public.import_batch_events') is null then 'FAIL' else 'PASS' end
union all select 'projects.external_key', 'موجود',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='projects' and column_name='external_key')
            then 'PASS' else 'FAIL' end
union all select 'projects.import_batch_id', 'موجود',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='projects' and column_name='import_batch_id')
            then 'PASS' else 'FAIL' end
union all select '★ ux_projects_external_key (فريد جزئيّ)', 'موجود',
       case when exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_projects_external_key')
            then 'PASS' else 'FAIL' end
union all select '★ ux_deliverable_internal_external_key (من الحزمة الأولى §1b)', 'موجود',
       case when exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_deliverable_internal_external_key')
            then 'PASS' else 'FAIL — بدونه لا يوجد idempotency إطلاقًا' end
union all select 'unique (batch_id, row_number) على import_rows', 'موجود',
       case when exists (select 1 from pg_constraint c
                          where c.conrelid = to_regclass('public.import_rows') and c.contype='u')
            then 'PASS' else 'FAIL' end;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) الدوالّ — المتوقّع: 14 صفًّا كلّها PASS
-- ─────────────────────────────────────────────────────────────────────────────
with want(ord, sig, exposure) as (values
  ( 1,'public.import_can_manage()',                            'authenticated'),
  ( 2,'public.import_can_create_stages()',                     'authenticated'),
  ( 3,'public.import_text_array(jsonb)',                       'authenticated'),
  ( 4,'public.import_batch_create(text,text,uuid,text)',        'authenticated'),
  ( 5,'public.import_batch_load_rows(uuid,jsonb)',              'authenticated'),
  ( 6,'public.import_batch_preview(uuid)',                      'authenticated'),
  ( 7,'public.import_batch_dry_run(uuid,boolean)',              'authenticated'),
  ( 8,'public.import_batch_execute(uuid,boolean)',              'authenticated'),
  ( 9,'public.import_batch_report(uuid,int)',                   'authenticated'),
  (10,'public.import_batch_list(int,int)',                      'authenticated'),
  (11,'public.import_batch_cancel(uuid,text)',                  'authenticated'),
  (12,'public.import_batch_execute_core(uuid,boolean)',         'internal'),
  (13,'public.import_batch_guard(uuid,text[])',                 'internal'),
  (14,'public.import_audit(uuid,text,jsonb)',                   'internal')
)
select w.ord as "#", w.sig as "الدالّة", w.exposure as "الانكشاف المتوقّع",
       case when p.oid is null then 'FAIL — غير موجودة'
            when not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
                              where x like 'search_path=%') then 'FAIL — بلا search_path'
            when not p.prosecdef and w.ord <> 3 then 'FAIL — ليست SECURITY DEFINER'
            else 'PASS' end as "النتيجة"
from want w left join pg_proc p on p.oid = to_regprocedure(w.sig)
order by w.ord;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ج) ★ الأمان ★ — المتوقّع: صفر في كل صفّ
-- ─────────────────────────────────────────────────────────────────────────────
select 'منح anon على جداول الاستيراد'              as "المحور", '0' as "المتوقّع",
       count(*)::text                                as "الفعليّ",
       case when count(*)=0 then 'PASS' else 'FAIL حرج' end as "النتيجة"
  from information_schema.role_table_grants
 where table_schema='public' and grantee='anon'
   and table_name in ('import_batches','import_rows','import_batch_events')
union all
select '★ دوالّ داخلية ممنوحة لـ anon/authenticated', '0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL حرج — التنفيذ بلا معاينة صار ممكنًا' end
  from information_schema.role_routine_grants
 where routine_schema='public' and grantee in ('anon','authenticated')
   and routine_name in ('import_batch_execute_core','import_batch_guard','import_audit')
union all
select 'سياسات كتابة مباشرة على جداول الاستيراد', '0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL — الكتابة يجب أن تمرّ بالدوالّ فقط' end
  from pg_policies
 where schemaname='public' and tablename in ('import_batches','import_rows','import_batch_events')
   and cmd <> 'SELECT'
union all
select 'RLS مفعّل على الجداول الثلاثة', '3',
       count(*) filter (where relrowsecurity)::text,
       case when count(*) filter (where relrowsecurity) = 3 then 'PASS' else 'FAIL' end
  from pg_class
 where oid in (to_regclass('public.import_batches'), to_regclass('public.import_rows'),
               to_regclass('public.import_batch_events'))
union all
select 'سياسات قراءة (واحدة لكل جدول)', '3', count(*)::text,
       case when count(*)=3 then 'PASS' else 'FAIL' end
  from pg_policies
 where schemaname='public' and tablename in ('import_batches','import_rows','import_batch_events')
   and cmd = 'SELECT';


-- ─────────────────────────────────────────────────────────────────────────────
-- (د) ★ الترحيل لم يُنشئ بيانات ★ — المتوقّع بعد التطبيق مباشرة: 0 دفعات
-- ─────────────────────────────────────────────────────────────────────────────
select 'دفعات استيراد'                            as "المؤشّر",
       '0 بعد التطبيق مباشرة'                      as "المتوقّع",
       count(*)::text                              as "الفعليّ",
       case when count(*)=0 then 'PASS — الترحيل لم يُنشئ دفعة'
            else 'ℹ️ توجد دفعات (شُغّل الاستيراد فعلًا بعد الترحيل)' end as "النتيجة"
  from public.import_batches
union all
select 'صفوف staging', '0 بعد التطبيق مباشرة', count(*)::text,
       case when count(*)=0 then 'PASS' else 'ℹ️ موجودة — راجع (و)' end
  from public.import_rows
union all
select 'مشاريع أنشأها الاستيراد', '0 بعد التطبيق مباشرة', count(*)::text,
       case when count(*)=0 then 'PASS' else 'ℹ️ أُنشئت عبر دفعة — راجع import_batch_events' end
  from public.projects where import_batch_id is not null
union all
select 'مخرجات أنشأها الاستيراد', '0 بعد التطبيق مباشرة', count(*)::text,
       case when count(*)=0 then 'PASS' else 'ℹ️ أُنشئت عبر دفعة' end
  from public.deliverable_internal where import_batch_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- (هـ) سلامة المفاتيح — المتوقّع: 0 في كل صفّ، دائمًا
-- ─────────────────────────────────────────────────────────────────────────────
select 'مفاتيح external_key مكرّرة على المخرجات (deliverable_internal)' as "المحور", '0' as "المتوقّع",
       coalesce(sum(n)::text,'0')                   as "الفعليّ",
       case when coalesce(sum(n),0)=0 then 'PASS' else 'FAIL — الفهرس الفريد مُعطَّل' end as "النتيجة"
  from (select count(*)-1 as n from public.deliverable_internal
         where external_key is not null group by external_key having count(*)>1) s
union all
select 'مفاتيح external_key مكرّرة على المشاريع', '0',
       coalesce((select sum(n)::text from (select count(*)-1 as n from public.projects
                  where external_key is not null group by external_key having count(*)>1) t), '0'),
       case when coalesce((select sum(n) from (select count(*)-1 as n from public.projects
              where external_key is not null group by external_key having count(*)>1) t),0)=0
            then 'PASS' else 'FAIL' end
union all
select 'صفوف staging بلا external_key وحالتها valid', '0',
       (select count(*)::text from public.import_rows where status='valid' and external_key is null),
       case when (select count(*) from public.import_rows where status='valid' and external_key is null)=0
            then 'PASS' else 'FAIL — المعاينة كان يجب أن ترفضها' end
union all
select 'مخرجات مستورَدة بحالة تُطلق إشعارًا للعميل', '0',
       (select count(*)::text from public.deliverables d
         join public.deliverable_internal i on i.deliverable_id = d.id
        where i.import_batch_id is not null and d.status not in ('draft','internal_review')),
       case when (select count(*) from public.deliverables d
                   join public.deliverable_internal i on i.deliverable_id = d.id
                  where i.import_batch_id is not null
                    and d.status not in ('draft','internal_review')) = 0
            then 'PASS' else 'ℹ️ غُيّرت الحالات بعد الاستيراد (طبيعي في التشغيل)' end;


-- ─────────────────────────────────────────────────────────────────────────────
-- (و) ★ برهان idempotency من البيانات ★
--     المتوقّع بعد أوّل تنفيذ:  created > 0 · skipped = 0
--     المتوقّع بعد تنفيذ نفس الملفّ في دفعة ثانية:  created = **0** · skipped = الكلّ
--     (فارغ تمامًا بعد الترحيل مباشرة — وهذا صحيح.)
-- ─────────────────────────────────────────────────────────────────────────────
select b.created_at::date                                   as "التاريخ",
       b.profile                                            as "ملفّ التعيين",
       coalesce(b.source_file_name,'—')                     as "الملفّ",
       b.status                                             as "الحالة",
       count(*) filter (where r.status='applied')::text     as "أُنشئ",
       count(*) filter (where r.status='skipped')::text     as "تُخطّي",
       count(*) filter (where r.status='failed')::text      as "فشل",
       count(*) filter (where r.status='invalid')::text     as "غير صالح",
       case
         when count(*) filter (where r.status='failed')  > 0 then '⚠️ راجع import_rows.error'
         when count(*) filter (where r.status='applied') = 0
          and count(*) filter (where r.status='skipped') > 0 then '✅ برهان idempotency — لم يُنشأ شيء'
         when count(*) filter (where r.status='applied') > 0 then 'ℹ️ تنفيذ أوّل'
         else '—'
       end                                                  as "الحكم"
from public.import_batches b left join public.import_rows r on r.batch_id = b.id
group by b.id, b.created_at, b.profile, b.source_file_name, b.status
order by b.created_at desc
limit 20;

-- كل مفتاح مستورَد يُنشئ صفًّا واحدًا فقط في الواقع، مهما تكرّرت الدفعات:
select 'مفاتيح ظهرت في أكثر من دفعة'                        as "المحور",
       'أيّ قيمة — تكرار الملفّ أمر طبيعي'                   as "المتوقّع",
       (select count(*)::text from (
          select external_key from public.import_rows
           where external_key is not null
           group by external_key having count(distinct batch_id) > 1) s)   as "الفعليّ",
       '—'                                                  as "النتيجة"
union all
select '★ مفاتيح أُنشئت (applied) أكثر من مرّة', '0',
       (select count(*)::text from (
          select external_key from public.import_rows
           where status='applied' and external_key is not null
           group by external_key having count(*) > 1) d),
       case when (select count(*) from (
                    select external_key from public.import_rows
                     where status='applied' and external_key is not null
                     group by external_key having count(*) > 1) d2) = 0
            then 'PASS — idempotency سليم' else 'FAIL حرج — idempotency منكسر' end;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ز) بوّابة الفشل الصاخب — قراءة محضة
-- ─────────────────────────────────────────────────────────────────────────────
do $post$
declare v text := ''; f text; n int;
begin
  if to_regclass('public.import_batches')      is null then v := v || ' import_batches'; end if;
  if to_regclass('public.import_rows')         is null then v := v || ' import_rows'; end if;
  if to_regclass('public.import_batch_events') is null then v := v || ' import_batch_events'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='ux_projects_external_key')
    then v := v || ' ux_projects_external_key'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then v := v || ' ★ux_deliverable_internal_external_key★'; end if;
  if to_regclass('public.deliverable_internal') is null
    then v := v || ' public.deliverable_internal'; end if;

  foreach f in array array[
    'public.import_batch_create(text,text,uuid,text)','public.import_batch_load_rows(uuid,jsonb)',
    'public.import_batch_preview(uuid)','public.import_batch_dry_run(uuid,boolean)',
    'public.import_batch_execute(uuid,boolean)','public.import_batch_report(uuid,int)']
  loop
    if to_regprocedure(f) is null then v := v || ' fn:' || f; end if;
  end loop;

  select count(*) into n from information_schema.role_routine_grants
   where routine_schema='public' and grantee in ('anon','authenticated')
     and routine_name in ('import_batch_execute_core','import_batch_guard','import_audit');
  if n > 0 then v := v || ' ★دالّة-داخلية-ممنوحة★'; end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and grantee='anon'
     and table_name in ('import_batches','import_rows','import_batch_events');
  if n > 0 then v := v || ' ★anon-يملك-صلاحية★'; end if;

  select count(*) into n from pg_policies
   where schemaname='public' and tablename in ('import_batches','import_rows','import_batch_events')
     and cmd <> 'SELECT';
  if n > 0 then v := v || ' ★سياسة-كتابة-مباشرة★'; end if;

  -- ★ الأخطر: مفتاح واحد أُنشئ مرّتين = انكسار idempotency
  select count(*) into n from (
    select external_key from public.import_rows
     where status = 'applied' and external_key is not null
     group by external_key having count(*) > 1) d;
  if n > 0 then v := v || ' ★' || n || '-مفتاحًا-أُنشئ-أكثر-من-مرّة★'; end if;

  if v <> '' then raise exception 'POSTCHECK FAIL —%', v; end if;
  raise notice 'BULK_IMPORT POSTCHECK: PASS — الجداول والدوالّ حاضرة، الداخليّة مقفلة، ولا مفتاح أُنشئ مرّتين.';
end $post$;
