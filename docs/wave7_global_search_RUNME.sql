-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 7 · V2-7.1-A — بحث شامل عبر Postgres FTS. **بلا خدمة خارجية.**
--
-- ★ لماذا فهارس تعبيرية لا أعمدة tsvector ★
-- عمود `tsvector` مولَّد على كلّ جدول يعني تغييرًا في شكل أربعة جداول حيّة،
-- وإعادة كتابة كاملة لها عند التطبيق. الفهرس التعبيريّ (GIN على
-- `to_tsvector(...)`) يعطي الأداء نفسه **بلا تغيير شكل** — وهو أخفّ وأكثر
-- قابلية للتراجع.
--
-- ★★ الأهمّ: البحث لا يُسرّب ما لا يراه المستخدم ★★
-- كلّ مصدر يمرّ ببوّابته القائمة، **داخل الاستعلام نفسه** لا بعده. بحثٌ يجمع
-- ثمّ يُصفّي يُسرّب عبر عدّاد النتائج ولو لم يعرض صفًّا.
--
-- ⛔ لا جدول بحث · لا فهرس مكرَّر للبيانات · لا خدمة خارجية · لا AI.
-- ⛔ ولا يُعاد من هذه الدالّة مبلغ ولا هاتف ولا مسار تخزين.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0 · حارس اعتمادات صلب — **داخل** المعاملة
--
-- ★ ما أفشل التطبيق على Preview ★
--     ERROR: column "name" does not exist
--   الحزمة كانت تقرأ اسم المشروع من `projects.name`، ⛔ **ولا وجود له**:
--   العمود اسمه `project_name`. والدليل ليس رسالة الخطأ وحدها — **٤٤ موضعًا**
--   في `docs/*.sql` تقرأ `p.project_name`، ⛔ **ولا ملفّ واحد** غير هذا يذكر
--   `projects.name`. فالحزمة اخترعت اسم عمود، والقاعدة كانت على حقّ.
--
-- ⚠️ والحارس القديم فحص **وجود الجدول** ولم يفحص العمود، فمرّ التطبيق حتّى
--    اصطدم بـ§2. فحصُ الجدول بلا فحص عموده يُؤخّر الفشل ولا يمنعه.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_missing text[] := '{}'; v_c text;
begin
  if to_regclass('public.projects') is null then
    v_missing := array_append(v_missing, 'TABLE public.projects');
  elsif not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name::text='projects'
                       and column_name::text='project_name') then
    v_missing := array_append(v_missing, 'COLUMN projects.project_name');
  end if;
  -- 🔴 أعمدة المصادر الاختيارية — تُفحص **إن وُجد جدولها**. وفحصُ الجدول بلا
  --    عموده هو ما سمح بالوصول إلى §2 مرّتين متتاليتين.
  if to_regclass('public.clients') is not null then
    foreach v_c in array array['company','full_name'] loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name::text='clients'
                        and column_name::text=v_c)
      then v_missing := array_append(v_missing, 'COLUMN clients.'||v_c); end if;
    end loop;
  end if;
  if to_regclass('public.deliverables') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name::text='deliverables'
                        and column_name::text='title') then
    v_missing := array_append(v_missing, 'COLUMN deliverables.title');
  end if;
  if to_regclass('public.custody_inventory_assets') is not null then
    foreach v_c in array array['asset_name','asset_code'] loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name::text='custody_inventory_assets'
                        and column_name::text=v_c)
      then v_missing := array_append(v_missing, 'COLUMN custody_inventory_assets.'||v_c); end if;
    end loop;
  end if;

  -- 🔴 البوّابة **إلزامية**: لم يعد في الدالّة مسار يمرّ عند غيابها.
  if to_regprocedure('public.can_access_project(uuid)') is null then
    v_missing := array_append(v_missing, 'GATE public.can_access_project(uuid)');
  end if;
  if array_length(v_missing,1) > 0 then
    raise exception E'🔴 WAVE 7 GLOBAL SEARCH: اعتمادات مفقودة:\n  %', array_to_string(v_missing, E'\n  ');
  end if;
end $$;

-- ─── §1 · التطبيع العربيّ ──────────────────────────────────────────────────
--
-- 🔴 العربية بلا تطبيع تُفشل البحث صامتًا: «إنتاج» و«انتاج» و«إنتاج» (بألف
--    مختلفة) ثلاث كلمات مختلفة عند Postgres. والتشكيل والتطويل يزيدان الطين.
--    فالتطبيع شرط عمل لا تحسين.
create or replace function public.search_norm(p text)
returns text language sql immutable strict set search_path = public as $$
  select lower(
    regexp_replace(
      translate(
        p,
        -- الألف بأشكالها · الياء/الألف المقصورة · التاء المربوطة · الهمزات
        'أإآٱىئؤةـ',
        'اااايياه '
      ),
      -- التشكيل يُزال بالكامل
      '[ً-ْٰـ]', '', 'g'));
$$;

-- الإعداد اللغويّ: `simple` عمدًا — لا جذوع عربية في Postgres الافتراضيّ،
-- ومحاولة استعمال إعداد إنجليزيّ على نصّ عربيّ تُنتج نتائج عشوائية.
create or replace function public.search_vector(p text)
returns tsvector language sql immutable strict set search_path = public as $$
  select to_tsvector('simple', public.search_norm(p));
$$;

create or replace function public.search_query(p text)
returns tsquery language sql immutable strict set search_path = public as $$
  select websearch_to_tsquery('simple', public.search_norm(p));
$$;

-- ─── §2 · الفهارس التعبيرية — بلا تغيير شكل أيّ جدول ───────────────────────
-- 🔴 `project_name` لا `name`. وهذا السطر بعينه هو ما رمى
--    `ERROR: column "name" does not exist` وأجهض المعاملة كلّها.
create index if not exists projects_fts_idx
  on public.projects using gin (public.search_vector(coalesce(project_name,'')));

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 عيبان في هذه الكتلة، كلاهما صامت لولا Preview
--
-- ★١★ `clients.company_name` **لا وجود له**. أعمدة `public.clients` هي
--     `full_name` و`company` (ومعها user_id/mobile/email…). والاسم المستعمل
--     هنا هو عمود **`crm_leads.company_name`** — جدولٌ آخر تمامًا. نُقل الاسم
--     من حزمة إلى حزمة بلا مراجعة مخطّط.
--
-- ★٢★ **تهريبٌ مزدوج**: النصّ كان يحوي ثماني علامات اقتباس حيث تلزم أربع.
--     داخل `$$…$$` مستوى تهريب **واحد** لا اثنان، فكان `execute` يُنتج:
--         coalesce(company_name,'''')      ⇒ الافتراض حرف `'` لا نصّ فارغ
--         coalesce(asset_name,'''') || '' '' || …   ⇒ **خطأ نحويّ**
--     وأثرهما مختلف وكلاهما سيّئ:
--       • فهرس على `coalesce(col,'''')` **لا يطابق** تعبير البحث
--         `coalesce(col,'')` ⇒ الفهرس يُبنى ثمّ **لا يُستعمل أبدًا**: مسحٌ
--         تسلسليّ كامل مع كلّ بحث، ونتائج صحيحة تُخفي ضياع الغرض كلّه.
--       • و`'' ''` سلسلتان فارغتان متجاورتان على سطر واحد ⇒ فهرس المعدّات
--         كان **سيفشل نحويًّا** — وهو الخطأ الثالث في السلسلة، لولا هذا التدقيق.
--
-- ⚠️ والأعمدة الأخرى فُحصت ولم تتغيّر: `deliverables.title` (المصدر الموثوق
--    `phase0_migration.sql:218`) و`custody_inventory_assets.asset_name`
--    و`asset_code` (`portal_custody_inventory_system_v1_RUNME.sql`). صحيحة.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  -- 🔴 عقد عنوان العميل: `company` وإن خلا فـ`full_name`. والتعبير هنا يجب أن
  --    يُطابق **حرفيًّا** تعبير البحث في §3، وإلّا لم يُستعمل الفهرس.
  if to_regclass('public.clients') is not null then
    execute 'create index if not exists clients_fts_idx
             on public.clients using gin (
               public.search_vector(coalesce(nullif(btrim(company),''''), full_name, '''')))';
  end if;
  if to_regclass('public.deliverables') is not null then
    execute 'create index if not exists deliverables_fts_idx
             on public.deliverables using gin (public.search_vector(coalesce(title,'''')))';
  end if;
  if to_regclass('public.custody_inventory_assets') is not null then
    execute 'create index if not exists assets_fts_idx
             on public.custody_inventory_assets using gin (
               public.search_vector(coalesce(asset_name,'''') || '' '' || coalesce(asset_code,'''')))';
  end if;
end $$;

-- ─── §3 · البحث — كلّ مصدر ببوّابته، داخل الاستعلام ────────────────────────
create or replace function public.global_search(p_q text, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q tsquery; v_lim int; v_rows jsonb := '[]'::jsonb; v_part jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- استعلام فارغ أو بلا كلمات ⇒ لا نتائج. ⛔ ولا يُرجَع «كلّ شيء».
  if length(btrim(coalesce(p_q,''))) < 2 then
    return jsonb_build_object('ok', true, 'q', p_q, 'rows', '[]'::jsonb, 'reason', 'query_too_short');
  end if;
  v_q := public.search_query(p_q);
  if v_q is null or v_q::text = '' then
    return jsonb_build_object('ok', true, 'q', p_q, 'rows', '[]'::jsonb, 'reason', 'no_searchable_terms');
  end if;
  v_lim := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- ★ المشاريع — بوّابة الرؤية القائمة، داخل WHERE.
  --
  -- 🔴 اسم العمود `project_name` (العنوان والترتيب والشرط — ثلاثتها).
  --
  -- 🔴 والبوّابة **fail-closed**: حُذف `to_regprocedure(…) is null or`.
  --    ذلك الطرف يجعل الشرط صحيحًا **دائمًا** عند غياب البوّابة، فيُعيد البحث
  --    كلّ مشروع في القاعدة لأيّ مستخدم مُصادَق — تسريبٌ كامل بحجّة التدرّج
  --    اللطيف. و§0 يشترط وجود البوّابة، فالمسار البديل لم يكن يحمي من شيء:
  --    غيابها الآن يوقف **التطبيق**، لا يفتح **البيانات**.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
             'kind','project','id',p.id,'title',p.project_name,
             'href','/client-portal/project-core/'||p.id::text,
             'rank', ts_rank(public.search_vector(coalesce(p.project_name,'')), v_q)) as x
      from public.projects p
     where public.search_vector(coalesce(p.project_name,'')) @@ v_q
       and public.can_access_project(p.id)
     order by 1 limit v_lim) s;
  v_rows := v_rows || v_part;

  -- ★ المخرَجات — تتبع رؤية مشروعها، لا بوّابة ثانية.
  if to_regclass('public.deliverables') is not null then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
      select jsonb_build_object(
               'kind','deliverable','id',d.id,'title',d.title,
               'href','/client-portal/project-core/'||d.project_id::text||'?tab=deliverables',
               'rank', ts_rank(public.search_vector(coalesce(d.title,'')), v_q)) as x
        from public.deliverables d
       -- ⚠️ نفس البوّابة ونفس العلاج: ⛔ ولا مسار يمرّ عند غيابها.
       where public.search_vector(coalesce(d.title,'')) @@ v_q
         and public.can_access_project(d.project_id)
       order by 1 limit v_lim) s;
    v_rows := v_rows || v_part;
  end if;

  -- ★ المعدّات — بوّابة الأصول القائمة. ⛔ ولا سعر ولا قيمة في النتيجة.
  if to_regclass('public.custody_inventory_assets') is not null
     and to_regprocedure('public.civ_can_view_assets()') is not null then
    if public.civ_can_view_assets() then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
        select jsonb_build_object(
                 'kind','asset','id',a.id,'title',a.asset_name,'code',a.asset_code,
                 'href','/client-portal/asset-custody',
                 'rank', ts_rank(public.search_vector(coalesce(a.asset_name,'')||' '||coalesce(a.asset_code,'')), v_q)) as x
          from public.custody_inventory_assets a
         where public.search_vector(coalesce(a.asset_name,'')||' '||coalesce(a.asset_code,'')) @@ v_q
           and coalesce(a.is_deleted,false) = false
         order by 1 limit v_lim) s;
      v_rows := v_rows || v_part;
    end if;
  end if;

  -- ★ العملاء — للمخوَّلين وحدهم. ⛔ ولا هاتف ولا بريد في النتيجة.
  if to_regclass('public.clients') is not null
     and to_regprocedure('public.can_manage_projects()') is not null then
    if public.can_manage_projects() then
      -- 🔴 عقد عنوان العميل — مُستخرَج من المستهلكين لا من التخمين:
      --   `large-projects.ts:1172`  → `c.company || c.full_name || null`
      --   `commercial_subscriptions_RUNME.sql:2252` → `coalesce(c.company, c.full_name, '—')`
      --   `deliverable_delivery_audit_RUNME.sql:85` → `coalesce(c.company, c.full_name, …)`
      -- ⚠️ و`nullif(btrim(...),'')` لا `coalesce` وحدها: حزم التأجير تفحص
      --    `coalesce(pr.company,'') <> ''` — أي أنّ الشركة الفارغة **حالة
      --    قائمة**، و`coalesce` وحدها تُعيد نصًّا فارغًا فيختفي العميل من البحث.
      -- ⛔ ولا بريد ولا هاتف في النتيجة.
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
        select jsonb_build_object(
                 'kind','client','id',c.id,
                 'title', coalesce(nullif(btrim(c.company),''), c.full_name, ''),
                 'href','/client-portal/accounts',
                 'rank', ts_rank(public.search_vector(coalesce(nullif(btrim(c.company),''), c.full_name, '')), v_q)) as x
          from public.clients c
         where public.search_vector(coalesce(nullif(btrim(c.company),''), c.full_name, '')) @@ v_q
         order by 1 limit v_lim) s;
      v_rows := v_rows || v_part;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'q', p_q, 'rows', v_rows);
end $$;

-- ─── §4 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.search_norm(text)   from public, anon;
revoke all on function public.search_vector(text) from public, anon;
revoke all on function public.search_query(text)  from public, anon;
grant execute on function public.search_norm(text)   to authenticated;
grant execute on function public.search_vector(text) to authenticated;
grant execute on function public.search_query(text)  to authenticated;

revoke all on function public.global_search(text,int) from public, anon;
grant execute on function public.global_search(text,int) to authenticated;

commit;

notify pgrst, 'reload schema';
