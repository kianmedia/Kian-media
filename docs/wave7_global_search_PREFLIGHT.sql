-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 7 · V2-7.1 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
--
-- ★★ 🔴 ما أفشل التطبيق على Preview ★★
--     ERROR: column "name" does not exist
--   الحزمة قرأت اسم المشروع من `projects.name` — ⛔ **ولا وجود له**؛ العمود
--   اسمه `project_name`. وهذا الفحص كان يتحقّق من **وجود الجدول** ولا يتحقّق
--   من عموده، فأعطى ✅ وسمح بتطبيق انفجر في §2. ⇒ صار العمود شرطًا صريحًا.
--
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1` ليعود رمز الخروج غير صفريّ عند النقص.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §1 · الجداول ──────────────────────────────────────────────────────────
-- `projects` **إلزاميّ**؛ والثلاثة الباقية اختيارية والدالّة تتخطّاها بحارس وجود.
select 'REQUIRED_TABLE' as kind, 'projects' as name,
       case when to_regclass('public.projects') is null then '🔴 مفقود' else '✅ موجود' end as status;

select 'OPTIONAL_TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🟡 غائب — المصدر يُتخطّى' else '✅ موجود' end as status
from (values ('clients'),('deliverables'),('custody_inventory_assets')) v(n);

-- ════════════════════════════════════════════════════════════════════════════
-- §2 · 🔴 عقد عمود اسم المشروع — لبّ العطب
--
-- ⛔ ولا يُخمَّن الاسم: ٤٤ موضعًا في `docs/*.sql` تقرأ `p.project_name`،
--    ⛔ ولا ملفّ واحد غير هذه الحزمة كان يذكر `projects.name`.
-- ════════════════════════════════════════════════════════════════════════════
select 'REQUIRED_COLUMN' as kind, 'projects.project_name' as name,
       case
         when to_regclass('public.projects') is null then '🔴 الجدول مفقود'
         when not exists (select 1 from information_schema.columns
                           where table_schema='public' and table_name::text='projects'
                             and column_name::text='project_name')
              then '🔴 مفقود — ⛔ لا تُشغّل RUNME'
         when exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name::text='projects'
                         and column_name::text='project_name' and data_type='text')
              then '✅ موجود · text'
         else '🔴 موجود بنوع غير text — راجع المخطّط' end as status;

-- ⚠️ تشخيصيّ لا شرط: وجود `projects.name` أو غيابه **لا يغيّر** العقد —
--    الحزمة تقرأ `project_name` وحده. يُطبع لأنّ رسالة الخطأ الأصلية تُوهم
--    بأنّ العمود «ضاع»، والحقيقة أنّه لم يوجد قطّ.
select 'INFO_LEGACY_COLUMN' as kind, 'projects.name' as name,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name::text='projects'
                            and column_name::text='name')
            then '🟡 موجود — ⛔ ومع ذلك لا تستعمله الحزمة'
            else '✅ غير موجود — وهو ما تقوله رسالة الخطأ' end as status;

-- ─── §3 · البوّابات ────────────────────────────────────────────────────────
-- 🔴 `can_access_project(uuid)` صارت **إلزامية**: حُذف من `global_search`
--    مسارُ `to_regprocedure(…) is null or …` الذي كان يمرّر كلّ المشاريع عند
--    غيابها. ⇒ غيابها الآن يوقف التطبيق، ⛔ ولا يفتح البيانات.
select 'REQUIRED_GATE' as kind, 'public.can_access_project(uuid)' as name,
       case when to_regprocedure('public.can_access_project(uuid)') is null
            then '🔴 مفقود — ⛔ لا تُشغّل RUNME' else '✅ موجود' end as status;

-- هاتان اختياريتان **بحقّ**: مصدرهما محروس بـ`if … is not null then` فيُتخطّى.
select 'OPTIONAL_GATE' as kind, v.sig as name,
       case when to_regprocedure(v.sig) is null then '🟡 غائب — المصدر يُتخطّى' else '✅ موجود' end as status
from (values ('public.civ_can_view_assets()'),('public.can_manage_projects()')) v(sig);

-- ════════════════════════════════════════════════════════════════════════════
-- §4 · APPLY_STATE — وإثبات أنّ التشغيل الفاشل لم يترك شيئًا
--
-- 🔴 المحاولة الفاشلة كانت داخل `begin` ولم تبلغ `commit`، فالمفترض تراجعُ
--    كلّ شيء. ⛔ **ولا يُفترض**: هذا القسم يعدّه من الكتالوج.
--    (وكلّ ما تُنشئه الحزمة معامليّ: `create index` عاديّ لا CONCURRENTLY —
--     ولو كان CONCURRENTLY لبقي فهرس `INVALID` بعد الفشل، وهو ما يُفحص أدناه.)
--
--   صفر من الخمسة  ⇒ FRESH_APPLY
--   خمسة من الخمسة ⇒ MATCHING_REAPPLY (الحزمة idempotent بالكامل)
--   ما بينهما      ⇒ 🔴 PARTIAL — توقّف واحسم الحالة يدويًّا
-- ════════════════════════════════════════════════════════════════════════════
select 'APPLY_STATE' as kind, v.n as name,
       case when v.present then '🟢 موجود' else '⚪️ غائب' end as status
from (values
  ('search_norm()',      to_regprocedure('public.search_norm(text)')   is not null),
  ('search_vector()',    to_regprocedure('public.search_vector(text)') is not null),
  ('search_query()',     to_regprocedure('public.search_query(text)')  is not null),
  ('global_search()',    to_regprocedure('public.global_search(text,int)') is not null),
  ('projects_fts_idx',   to_regclass('public.projects_fts_idx') is not null)
) v(n, present);

select 'APPLY_STATE' as kind, 'CLASSIFICATION' as name,
       case count(*) filter (where v.present)
         when 0 then '✅ FRESH_APPLY — لا أثر للتشغيل الفاشل'
         when 5 then '✅ MATCHING_REAPPLY — إعادة تطبيق آمنة (idempotent)'
         else '🔴 PARTIAL — حالة هجينة · توقّف' end as status
from (values
  (to_regprocedure('public.search_norm(text)')   is not null),
  (to_regprocedure('public.search_vector(text)') is not null),
  (to_regprocedure('public.search_query(text)')  is not null),
  (to_regprocedure('public.global_search(text,int)') is not null),
  (to_regclass('public.projects_fts_idx') is not null)
) v(present);

-- الفهارس الاختيارية — تابعة لوجود جداولها، فتُعرض ولا تدخل التصنيف.
select 'OPTIONAL_INDEX' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '⚪️ غائب' else '🟢 موجود' end as status
from (values ('clients_fts_idx'),('deliverables_fts_idx'),('assets_fts_idx')) v(n);

-- 🔴 فهرس غير صالح: بقايا محتملة من بناء فاشل. لا يُستعمل ولا يُعاد بناؤه تلقائيًّا.
select 'INVALID_INDEX' as kind, c.relname::text as name, '🔴 indisvalid=false — أسقطه يدويًّا' as status
from pg_class c join pg_index i on i.indexrelid = c.oid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname like '%\_fts\_idx' and not i.indisvalid;

-- ⚠️ حجم الجدول: الفهرس التعبيريّ يُبنى على كامله. اعرف الكلفة قبل التطبيق.
select 'ROW_COUNT' as kind, 'projects' as name, count(*)::text as status from public.projects;

-- ─── §5 · ⛔ لا نظام بحث موازٍ ولا عمود tsvector مكرَّر ────────────────────
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام بحث موازٍ' end as status
from (values ('search_index'),('search_documents'),('global_search_index')) v(n);

select 'EXISTING_TSVECTOR_COLUMNS' as kind, c.table_name::text||'.'||c.column_name::text as name,
       '🟡 موجود' as status
from information_schema.columns c
where c.table_schema='public' and c.data_type='tsvector'
order by 2;

-- ════════════════════════════════════════════════════════════════════════════
-- §6 · 🔴 الحسم — يفشل فعليًّا لا طباعةً
-- ⛔ ولا يُحتسب OPTIONAL_*: غيابها يُتخطّى بحارس داخل الدالّة.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_missing text[] := '{}'; v_present int; v_t text;
begin
  if to_regclass('public.projects') is null then
    v_missing := array_append(v_missing, 'TABLE public.projects');
  elsif not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name::text='projects'
                       and column_name::text='project_name') then
    v_missing := array_append(v_missing,
      'COLUMN projects.project_name — وهو مصدر عنوان المشروع الوحيد في هذه الحزمة');
  elsif not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name::text='projects'
                       and column_name::text='project_name' and data_type='text') then
    v_missing := array_append(v_missing, 'COLUMN projects.project_name ليس text');
  end if;

  if to_regprocedure('public.can_access_project(uuid)') is null then
    v_missing := array_append(v_missing,
      'GATE public.can_access_project(uuid) — إلزامية: لا مسار يمرّ عند غيابها');
  end if;

  -- 🔴 حالة هجينة: صفر أو خمسة، وما بينهما توقّف.
  select count(*) filter (where v.present) into v_present from (values
    (to_regprocedure('public.search_norm(text)')   is not null),
    (to_regprocedure('public.search_vector(text)') is not null),
    (to_regprocedure('public.search_query(text)')  is not null),
    (to_regprocedure('public.global_search(text,int)') is not null),
    (to_regclass('public.projects_fts_idx') is not null)
  ) v(present);
  if v_present not in (0, 5) then
    v_missing := array_append(v_missing,
      format('PARTIAL %s/5 من كائنات الحزمة موجودة — احسم الحالة قبل إعادة التشغيل', v_present));
  end if;

  if exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname='public' and c.relname like '%\_fts\_idx' and not i.indisvalid) then
    v_missing := array_append(v_missing, 'INVALID INDEX — فهرس FTS غير صالح من بناء فاشل');
  end if;

  foreach v_t in array array['search_index','search_documents','global_search_index'] loop
    if to_regclass('public.'||v_t) is not null then
      v_missing := array_append(v_missing, 'PARALLEL '||v_t);
    end if;
  end loop;

  if array_length(v_missing,1) > 0 then
    raise exception E'🔴 WAVE 7 GLOBAL SEARCH PREFLIGHT FAILED:\n  %\n'
      '⛔ لا تُشغّل wave7_global_search_RUNME.sql.',
      array_to_string(v_missing, E'\n  ');
  end if;
  raise notice '✅ WAVE 7 GLOBAL SEARCH PREFLIGHT PASSED.';
end $$;
