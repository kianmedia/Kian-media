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

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception '🔴 projects مفقود';
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
create index if not exists projects_fts_idx
  on public.projects using gin (public.search_vector(coalesce(name,'')));

do $$
begin
  if to_regclass('public.clients') is not null then
    execute 'create index if not exists clients_fts_idx
             on public.clients using gin (public.search_vector(coalesce(company_name,'''''''')))';
  end if;
  if to_regclass('public.deliverables') is not null then
    execute 'create index if not exists deliverables_fts_idx
             on public.deliverables using gin (public.search_vector(coalesce(title,'''''''')))';
  end if;
  if to_regclass('public.custody_inventory_assets') is not null then
    execute 'create index if not exists assets_fts_idx
             on public.custody_inventory_assets using gin (
               public.search_vector(coalesce(asset_name,'''''''') || '''' '''' || coalesce(asset_code,'''''''')))';
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
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
             'kind','project','id',p.id,'title',p.name,
             'href','/client-portal/project-core/'||p.id::text,
             'rank', ts_rank(public.search_vector(coalesce(p.name,'')), v_q)) as x
      from public.projects p
     where public.search_vector(coalesce(p.name,'')) @@ v_q
       and (to_regproc('public.can_access_project(uuid)') is null
            or public.can_access_project(p.id))
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
       where public.search_vector(coalesce(d.title,'')) @@ v_q
         and (to_regproc('public.can_access_project(uuid)') is null
              or public.can_access_project(d.project_id))
       order by 1 limit v_lim) s;
    v_rows := v_rows || v_part;
  end if;

  -- ★ المعدّات — بوّابة الأصول القائمة. ⛔ ولا سعر ولا قيمة في النتيجة.
  if to_regclass('public.custody_inventory_assets') is not null
     and to_regproc('public.civ_can_view_assets()') is not null then
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
     and to_regproc('public.can_manage_projects()') is not null then
    if public.can_manage_projects() then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_part from (
        select jsonb_build_object(
                 'kind','client','id',c.id,'title',c.company_name,
                 'href','/client-portal/accounts',
                 'rank', ts_rank(public.search_vector(coalesce(c.company_name,'')), v_q)) as x
          from public.clients c
         where public.search_vector(coalesce(c.company_name,'')) @@ v_q
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
