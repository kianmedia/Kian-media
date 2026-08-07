-- WAVE 7 · V2-7.1 · POSTCHECK — قراءة فقط.
select 'دوالّ التطبيع والبحث' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('search_norm','search_vector','search_query','global_search');

select 'الفهارس التعبيرية' as check,
       case when count(*) >= 1 then '✅ '||count(*)::text else '🔴 لا فهارس' end as result
from pg_indexes where schemaname='public' and indexname like '%_fts_idx';

-- 🔴 لا شيء لـanon: البحث يكشف وجود سجلّات.
select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(routine_name,', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC')
  and routine_name in ('global_search','search_norm','search_vector','search_query');

-- ⛔ ولا جدول بحث مكرَّر للبيانات.
select '⛔ لا فهرس بيانات موازٍ' as check,
       case when to_regclass('public.search_index') is null then '✅ فهارس تعبيرية فقط'
            else '🔴 نسخة ثانية من البيانات' end as result;

-- التطبيع يعمل فعليًّا (قراءة بحتة).
select 'التطبيع العربيّ' as check,
       case when public.search_norm('إنتاج') = public.search_norm('انتاج')
            then '✅ الألف موحَّدة' else '🔴 التطبيع لا يعمل' end as result;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 عقد عمود اسم المشروع — يُقرأ من الكتالوج لا من الملفّ
--
-- التطبيق على Preview انفجر بـ`column "name" does not exist`. فلا يكفي أن
-- يوجد الفهرس: يجب أن يكون **على العمود الصحيح**. وتعريفُ الفهرس محفوظ في
-- `pg_indexes.indexdef`، وجسمُ الدالّة في `pg_proc.prosrc` — كلاهما مصدر
-- مستقلّ عن ملفّ الـRUNME.
-- ════════════════════════════════════════════════════════════════════════════
select 'فهرس المشاريع على project_name' as check,
       case
         when i.indexdef is null then '🔴 projects_fts_idx مفقود'
         when i.indexdef ~* 'project_name' then '✅ project_name'
         else '🔴 على عمود آخر: '||i.indexdef end as result
from (select 1) x
left join pg_indexes i on i.schemaname='public' and i.indexname='projects_fts_idx';

select 'global_search تقرأ project_name' as check,
       case
         when p.prosrc is null then '🔴 global_search مفقودة'
         when p.prosrc ~ 'p\.name\M' then '🔴 ما زالت تقرأ p.name — العمود غير موجود'
         when (length(p.prosrc) - length(replace(p.prosrc, 'p.project_name', ''))) / length('p.project_name') >= 3
              then '✅ العنوان والترتيب والشرط — ثلاثتها'
         else '🔴 عدد مواضع p.project_name أقلّ من ثلاثة — راجع العنوان/الترتيب/الشرط' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='global_search';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 البوّابة fail-closed: ⛔ ولا مسار `is null or` يمرّر كلّ المشاريع.
--
-- ⚠️ ولاحِظ صياغة النمط: `[^)]*` **لا تصلح** هنا — تتوقّف عند القوس المغلق في
--    `can_access_project(uuid)` نفسه فلا تبلغ `is null` أبدًا، فيبدو الحارس
--    قائمًا وهو لا يُطابق شيئًا. المدى محدود بـ`[^;]` بدلًا منها.
-- ════════════════════════════════════════════════════════════════════════════
select 'بوّابة المشروع fail-closed' as check,
       case
         when p.prosrc is null then '🔴 global_search مفقودة'
         when p.prosrc ~* 'to_regprocedure[^;]{0,80}can_access_project[^;]{0,80}is[[:space:]]+null[[:space:]]+or'
              then '🔴 fail-open: غياب البوّابة يُظهر كلّ المشاريع'
         when p.prosrc !~ 'can_access_project\(p\.id\)' then '🔴 بوّابة المشاريع غائبة'
         else '✅ can_access_project(p.id) بلا مسار بديل' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='global_search';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 أعمدة المصادر الأخرى — والفحص الذي طبع أحمر ثمّ PASS على Preview
--
-- ★ السبب ★ كان يشترط `c.company_name`. وهو **العمود الذي حذفناه عمدًا** بعد
--   أن أثبتت Preview أنّه لا وجود له في `public.clients` (اسمٌ يخصّ
--   `crm_leads`). فالفحص بقي على العقد القديم بعد تغيّر العقد ⇒ **إنذار كاذب**
--   يشترط عودة العطب.
-- ⛔ ولم يُخفَ بتغيير لون ولا نصّ: صار يشترط **العقد المعتمد** حرفيًّا، ودخل
--   بلوك الحسم فيُفشل التشغيل بدل أن يُطبع ويُتجاوز.
--
-- العقد المعتمد لكل مصدر:
--   projects   → p.project_name
--   clients    → coalesce(nullif(btrim(c.company),''), c.full_name, '')
--   deliverables → d.title
--   assets     → a.asset_name + a.asset_code
-- ════════════════════════════════════════════════════════════════════════════
select 'أعمدة المصادر — العقد المعتمد' as check,
       case
         when p.prosrc is null then '🔴 global_search مفقودة'
         when p.prosrc ~ 'c\.company_name' then '🔴 عاد عمود clients.company_name غير الموجود'
         when p.prosrc !~ 'nullif\(btrim\(c\.company\)' then '🔴 عقد اسم العميل ليس company ثمّ full_name'
         when p.prosrc !~ 'c\.full_name' then '🔴 لا احتياط full_name'
         when p.prosrc !~ 'd\.title' then '🔴 عمود المخرَجات تغيّر'
         when p.prosrc !~ 'a\.asset_name' or p.prosrc !~ 'a\.asset_code' then '🔴 عمود المعدّات تغيّر'
         else '✅ الأربعة على العقد المعتمد' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='global_search';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً. ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_fail text[] := '{}'; v_src text; v_def text; v_n int;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='global_search';
  if v_src is null then v_fail := array_append(v_fail, 'global_search مفقودة');
  else
    if v_src ~ 'p\.name\M' then
      v_fail := array_append(v_fail, 'global_search ما زالت تقرأ p.name — العمود غير موجود');
    end if;
    v_n := (length(v_src) - length(replace(v_src, 'p.project_name', ''))) / length('p.project_name');
    if v_n < 3 then
      v_fail := array_append(v_fail,
        format('p.project_name في %s موضعًا — المطلوب ثلاثة: العنوان والترتيب والشرط', v_n));
    end if;
    if v_src ~* 'to_regprocedure[^;]{0,80}can_access_project[^;]{0,80}is[[:space:]]+null[[:space:]]+or' then
      v_fail := array_append(v_fail, 'بوّابة المشروع fail-open — غيابها يُظهر كلّ المشاريع');
    end if;
    if v_src !~ 'can_access_project\(p\.id\)' then
      v_fail := array_append(v_fail, 'بوّابة المشاريع غائبة من WHERE');
    end if;

    -- 🔴 عقد أعمدة المصادر — محسوب في الحسم لا مطبوع فقط.
    if v_src ~ 'c\.company_name' then
      v_fail := array_append(v_fail, 'clients.company_name عاد — عمود لا وجود له');
    end if;
    if v_src !~ 'nullif\(btrim\(c\.company\)' or v_src !~ 'c\.full_name' then
      v_fail := array_append(v_fail, 'عقد اسم العميل ليس company ثمّ full_name');
    end if;
    if v_src !~ 'd\.title' then v_fail := array_append(v_fail, 'deliverables.title تغيّر'); end if;
    if v_src !~ 'a\.asset_name' or v_src !~ 'a\.asset_code' then
      v_fail := array_append(v_fail, 'أعمدة المعدّات تغيّرت');
    end if;
  end if;

  select i.indexdef into v_def from pg_indexes i
   where i.schemaname='public' and i.indexname='projects_fts_idx';
  if v_def is null then v_fail := array_append(v_fail, 'projects_fts_idx مفقود');
  elsif v_def !~* 'project_name' then
    v_fail := array_append(v_fail, 'projects_fts_idx على عمود غير project_name');
  end if;

  if (select count(*) from information_schema.role_routine_grants
       where routine_schema='public' and grantee::text in ('anon','PUBLIC')
         and routine_name::text in ('global_search','search_norm','search_vector','search_query')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية تنفيذ لـanon/PUBLIC');
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 7 GLOBAL SEARCH POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 7 GLOBAL SEARCH POSTCHECK PASSED.';
end $$;
