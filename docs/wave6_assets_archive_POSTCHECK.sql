-- WAVE 6 · assets_archive · POSTCHECK — قراءة فقط. كل سطر يجب أن يقول ✅.
select 'الجداول الستّة + RLS' as check,
       case when count(*) filter (where c.relrowsecurity)=6 then '✅ 6/6' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('asset_insurance_coverage','archive_media','archive_project_links',
   'music_licenses','music_license_project_links','model_releases');

select 'لا صلاحية لـanon' as check,
       -- ⚠️ `table_name` نوعه `sql_identifier` لا `text`: تمريره إلى
       --    `string_agg` بلا `::text` يُفشل الاستعلام وقت التشغيل.
       case when count(*)=0 then '✅'
            else '🔴 مسرَّبة: '||string_agg(distinct table_name::text, ', ') end as result
from information_schema.role_table_grants
where table_schema='public' and grantee::text in ('anon','PUBLIC')
  and table_name::text in ('asset_insurance_coverage','archive_media','archive_project_links',
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

-- ─── تواقيع دوالّ الحزمة — الاسم + قائمة الأنواع ───────────────────────────
-- ⚠️ `oidvectortypes` لا `pg_get_function_identity_arguments`: الثانية تُعيد
--    أسماء الوسائط مع أنواعها فلا تطابق قائمة أنواع أبدًا.
with pkg(fname, fargs) as (
  values ('project_rights_summary','uuid'), ('archive_media_upsert','jsonb'),
         ('music_license_upsert','jsonb'),  ('model_release_upsert','jsonb'),
         ('model_release_withdraw','uuid, text')
)
select 'دوالّ الحزمة الخمس بتواقيعها' as check,
       case when count(*) filter (where p.oid is not null) = 5 then '✅ 5/5'
            else '🔴 مفقودة: ' || coalesce(string_agg(k.fname||'('||k.fargs||')', ', ')
                                            filter (where p.oid is null), '') end as result
from pkg k
left join pg_proc p on p.proname = k.fname
      and p.pronamespace = 'public'::regnamespace
      and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs;

-- ⛔ لا تنفيذ لـanon/PUBLIC على أيّ دالّة من الحزمة.
select 'لا EXECUTE لـanon/PUBLIC على دوالّ الحزمة' as check,
       case when count(*)=0 then '✅'
            else '🔴 '||string_agg(distinct routine_name::text, ', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text in ('anon','PUBLIC')
  and routine_name::text in ('project_rights_summary','archive_media_upsert',
                             'music_license_upsert','model_release_upsert',
                             'model_release_withdraw');

-- 🔴 والمصرَّح لهم: authenticated وحده — ⛔ ولا service_role على دوالّ المستخدم.
select 'authenticated يملك الدوالّ الخمس' as check,
       case when count(*)=5 then '✅ 5/5'
            else '🔴 '||count(*)::text||'/5' end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text='authenticated'
  and routine_name::text in ('project_rights_summary','archive_media_upsert',
                             'music_license_upsert','model_release_upsert',
                             'model_release_withdraw');

-- ─── 🔴 استقلال الحزمة: لا اعتماد عرضيّ على Compliance Knowledge ───────────
-- ⚠️ فحصٌ على **تعريفات** دوالّ الحزمة وحدها: أيّ إشارة إلى كيانات حزمة
--    الامتثال تعني تشابكًا يجعل ترتيب التطبيق حرجًا بلا داعٍ.
select 'لا اعتماد على Compliance Knowledge' as check,
       case when count(*)=0 then '✅ مستقلّة'
            else '🔴 '||string_agg(distinct p.proname, ', ') end as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('project_rights_summary','archive_media_upsert','music_license_upsert',
                    'model_release_upsert','model_release_withdraw')
  and p.prosrc ~* '(custody_incidents|ai_knowledge_sources|ai_source_revisions|ops_job_hse|ops_incidents|sop_items|hse_register)';

-- ⚠️ وبوّابة `prodops_can_view` ليست من عقد هذه الحزمة.
select 'لا استعمال لـprodops_can_view' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(distinct p.proname, ', ') end as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('project_rights_summary','archive_media_upsert','music_license_upsert',
                    'model_release_upsert','model_release_withdraw')
  and p.prosrc ~* 'prodops_can_view';

-- ─── عقد تفرّد تراخيص الموسيقى — الفهرس التعبيريّ الجزئيّ ─────────────────
-- 🔴 يُفحص **التعريف** لا الاسم: فهرس بالاسم الصحيح وتعريف مختلف يُمرّر
--    ازدواجًا كان العقد يمنعه.
select 'فهرس تفرّد التراخيص' as check,
       case when i.indexdef is null then '🔴 ml_title_license_uniq مفقود'
            when i.indexdef !~* 'unique' then '🔴 موجود لكنّه غير فريد'
            when i.indexdef !~* 'coalesce\s*\(\s*license_id' then '🔴 بلا coalesce — كل NULL يصير مميّزًا'
            when i.indexdef !~* 'track_title' then '🔴 لا يشمل track_title'
            when i.indexdef !~* 'where\s+\(?is_deleted\s*=\s*false' then '🔴 غير جزئيّ — الحذف الناعم يصير طريقًا مسدودًا'
            else '✅ فريد · تعبيريّ · جزئيّ على is_deleted=false' end as result
from (select indexdef from pg_indexes
       where schemaname='public' and tablename='music_licenses'
         and indexname='ml_title_license_uniq') i
right join (select 1) x on true;

-- ⚠️ التعريف الفعليّ — يُقرأ عند احمرار الفحص أعلاه.
select 'تشخيص تعريف الفهرس' as check, coalesce(indexdef, '(غير موجود)') as result
from pg_indexes
where schemaname='public' and tablename='music_licenses' and indexname='ml_title_license_uniq';

-- ⛔ ولا قيد تفرّد على الجدول: العقد يُفرض بالفهرس وحده.
select 'لا قيد تفرّد منافس' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(conname::text, ', ') end as result
from pg_constraint con join pg_class r on r.oid=con.conrelid
join pg_namespace n on n.oid=r.relnamespace
where n.nspname='public' and r.relname='music_licenses' and con.contype='u';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
-- نطاقه **هذه الحزمة وحدها**: لا يفحص كيانات حزم أخرى فلا يحمرّ بسببها.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_fail text[] := '{}'; v_n int;
begin
  -- ١ · الجداول الستّة موجودة وRLS مفعَّلة
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relrowsecurity
     and c.relname in ('asset_insurance_coverage','archive_media','archive_project_links',
                       'music_licenses','music_license_project_links','model_releases');
  if v_n <> 6 then v_fail := v_fail || (v_n::text || '/6 جدول بـRLS'); end if;

  -- ٢ · الدوالّ الخمس بتواقيعها
  select count(*) into v_n
  from (values ('project_rights_summary','uuid'),('archive_media_upsert','jsonb'),
               ('music_license_upsert','jsonb'),('model_release_upsert','jsonb'),
               ('model_release_withdraw','uuid, text')) k(fname,fargs)
  where not exists (select 1 from pg_proc p
                     where p.proname=k.fname and p.pronamespace='public'::regnamespace
                       and pg_catalog.oidvectortypes(p.proargtypes)=k.fargs);
  if v_n > 0 then v_fail := v_fail || (v_n::text || ' دالّة مفقودة أو بتوقيع مختلف'); end if;

  -- ٣ · ⛔ لا صلاحية لـanon/PUBLIC (جداول أو دوالّ)
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and grantee::text in ('anon','PUBLIC')
         and table_name::text in ('asset_insurance_coverage','archive_media','archive_project_links',
                                  'music_licenses','music_license_project_links','model_releases')) > 0
     or (select count(*) from information_schema.role_routine_grants
          where routine_schema='public' and grantee::text in ('anon','PUBLIC')
            and routine_name::text in ('project_rights_summary','archive_media_upsert',
                                       'music_license_upsert','model_release_upsert',
                                       'model_release_withdraw')) > 0 then
    v_fail := v_fail || 'صلاحية مسرَّبة لـanon/PUBLIC';
  end if;

  -- ٤ · 🔴 الحذف التلقائيّ مستحيل بنيويًّا · والحجز القانونيّ يمنع الإخفاء
  if not exists (select 1 from pg_constraint con join pg_class r on r.oid=con.conrelid
                  where r.relname='archive_media'
                    and pg_get_constraintdef(con.oid) like '%auto_delete_enabled = false%') then
    v_fail := v_fail || 'AUTO-DELETION غير مقيَّد بـfalse';
  end if;
  if not exists (select 1 from pg_constraint where conname='archive_media_hold_blocks_delete') then
    v_fail := v_fail || 'الحجز القانونيّ لا يمنع الإخفاء';
  end if;

  -- ٥ · 🔴 عقد تفرّد التراخيص: فهرس فريد تعبيريّ جزئيّ بالتعريف الصحيح
  declare v_def text;
  begin
    select indexdef into v_def from pg_indexes
     where schemaname='public' and tablename='music_licenses'
       and indexname='ml_title_license_uniq';
    if v_def is null then
      v_fail := v_fail || 'ml_title_license_uniq مفقود';
    else
      if v_def !~* 'unique' then v_fail := v_fail || 'فهرس التراخيص غير فريد'; end if;
      if v_def !~* 'coalesce\s*\(\s*license_id' then
        v_fail := v_fail || 'فهرس التراخيص بلا coalesce — كل NULL مميّز';
      end if;
      if v_def !~* 'track_title' then
        v_fail := v_fail || 'فهرس التراخيص لا يشمل track_title';
      end if;
      if v_def !~* 'where\s+\(?is_deleted\s*=\s*false' then
        v_fail := v_fail || 'فهرس التراخيص غير جزئيّ — الحذف الناعم يسدّ الاسترجاع';
      end if;
    end if;
  end;
  if exists (select 1 from pg_constraint con join pg_class r on r.oid=con.conrelid
              join pg_namespace n on n.oid=r.relnamespace
              where n.nspname='public' and r.relname='music_licenses' and con.contype='u') then
    v_fail := v_fail || 'قيد تفرّد منافس على music_licenses';
  end if;

  -- ٦ · ⛔ لا اعتماد عرضيّ على حزمة الامتثال
  if exists (select 1 from pg_proc p
              where p.pronamespace='public'::regnamespace
                and p.proname in ('project_rights_summary','archive_media_upsert','music_license_upsert',
                                  'model_release_upsert','model_release_withdraw')
                and p.prosrc ~* '(custody_incidents|ai_knowledge_sources|ops_job_hse|ops_incidents|sop_items|hse_register|prodops_can_view)') then
    v_fail := v_fail || 'اعتماد عرضيّ على Compliance Knowledge';
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 6 ASSETS ARCHIVE POSTCHECK FAILED:\n  %',
      array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 6 ASSETS ARCHIVE POSTCHECK PASSED — والعلم يبقى OFF.';
end $$;

-- ⚠️ **العلم يبقى OFF**: هذه الحزمة تُطبَّق مخطّطًا فقط. ولا يُرفع أيّ علم
--    واجهة قبل تحقّق الإنتاج — انظر FEATURE_FLAGS_RELEASE_MATRIX.md.
