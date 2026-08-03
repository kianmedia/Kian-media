-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · V2-6.8-A/B/C — مولّد دراسات الحالة **داخل منصّة cs_* القائمة**.
--
-- ★★ لا منصّة ثانية ولا محرّك حالات ثانٍ ★★
-- `cs_case_studies` تحمل بالفعل دورة كاملة:
--   draft → internal_review → legal_review → client_permission_* → approved
--   → scheduled → published → unpublished → archived
-- ومعها `cs_submit` · `cs_review_decide` · `cs_legal_decide` · `cs_approve`
-- · `cs_guard_publish` · `cs_versions` (نسخ غير قابلة للتعديل) · `cs_audit`
-- · `cs_permissions`. فالتغطية تفوق ٦٠٪ بكثير، والمطلوب **توسعة لا بديل**.
--
-- ⇒ الجديد هنا ثلاثة أشياء فقط:
--   ١) مصدر المسوّدة (provenance) — من أين جاءت، وبأيّ طريقة.
--   ٢) مولّد يُنشئ **مسوّدة** بحقول مسموح بها صراحةً.
--   ٣) أثر التصدير — **حالة على الدراسة**، ⛔ لا جدول `portfolio_drafts`.
--
-- ★★ 🔴 القيد الصلب V2-6.8-C ★★
-- ❌ **ممنوع تعديل ملفّ المحتوى وقت التشغيل على Vercel.** نظام الملفّات هناك
-- للقراءة، والكتابة تُفقد عند أوّل نشر — فتبدو ناجحة ثمّ تختفي. ولذلك:
--   • لا شيء في هذه الحزمة يكتب ملفًّا.
--   • التصدير **سكربت تطوير/CI** (`scripts/export-case-studies.mjs`).
--   • والقاعدة تسجّل أنّ التصدير حدث، ولا تنفّذه.
--
-- ⛔ ولا نشر تلقائيّ: `approved` ≠ `published`، والتصدير يشترط `approved`.
-- ⛔ ولا AI: التوليد **بقالب** من حقول موجودة، ولا نصّ مخترَع.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.cs_case_studies') is null then
    raise exception '🔴 cs_case_studies مفقود — المولّد يمتدّ على المنصّة القائمة ولا يستبدلها';
  end if;
end $$;

-- ─── §1 · المصدر وأثر التصدير — أعمدة على الدراسة، لا جدول ثانٍ ────────────
alter table public.cs_case_studies
  -- من أين جاءت المسوّدة. ⛔ مرجع للقراءة، بلا مفتاح أجنبيّ (منصّة المشاريع مجمَّدة).
  add column if not exists generated_from_project uuid,
  add column if not exists generation_method text
    check (generation_method is null or generation_method in ('manual','template_v1')),
  add column if not exists generated_at   timestamptz,
  add column if not exists generated_by   uuid references auth.users(id),
  -- 🔴 provenance: أيّ حقول مصدر قُرئت فعلًا. يُدقَّق لاحقًا بلا تخمين.
  add column if not exists source_provenance jsonb not null default '{}'::jsonb,
  -- أثر التصدير — حالة على الدراسة (V2-6.8-B) لا طابور منفصل.
  add column if not exists exported_at    timestamptz,
  add column if not exists exported_by    uuid references auth.users(id),
  add column if not exists export_target  text;

comment on column public.cs_case_studies.source_provenance is
  'V2-6.8-B — أسماء حقول المصدر التي قُرئت. ⛔ لا يحتوي قيمًا حسّاسة ولا أسماء '
  'أشخاص: مفاتيح فقط، ليُعرف من أين جاء النصّ عند المراجعة.';

-- ─── §2 · قائمة الحقول المسموح قراءتها — التصفية في مكان واحد ──────────────
--
-- 🔴 قائمة **بيضاء**، لا قائمة ممنوعات. الممنوعات تنمو والقائمة البيضاء لا
--    تنمو إلّا بقرار. وما ليس فيها لا يصل مسوّدةً عامّة أبدًا:
--    ملاحظات داخلية · أرقام مالية · جهات اتصال · أسماء موظّفين · مخرَجات غير
--    منشورة · روابط موقَّعة · مسارات تخزين.
create or replace function public.cs_source_allowed_fields()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'project_title','project_type','city','sector',
    'start_date','end_date','crew_size','locations_count','deliverables_count'
  ]::text[];
$$;

-- ─── §3 · المولّد — يُنشئ **مسوّدة** ولا شيء غيرها ─────────────────────────
create or replace function public.cs_generate_draft(
  p_project uuid,
  p_internal_title text,
  p_slug text default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_slug text; v_prov jsonb := '{}'::jsonb; v_title text;
begin
  -- الصلاحية عبر بوّابة المنصّة القائمة — ⛔ لا نموذج صلاحيات ثانٍ.
  if not public.cs_is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_internal_title,''))) < 3 then
    raise exception 'internal_title_required';
  end if;

  -- 🔴 لا يُقرأ من المشروع إلّا ما تسمح به القائمة البيضاء، ولا يُنسخ نصّ
  --    تسويقيّ منه: المولّد **هيكل** لا محتوى. كلّ حقل عامّ يبقى فارغًا
  --    ليكتبه إنسان — PENDING KHALED CONTENT REVIEW.
  if p_project is not null and to_regclass('public.projects') is not null then
    -- يُسجَّل أنّ المشروع كان المصدر، وأيّ مفاتيح اعتُمدت. ⛔ بلا قيم.
    v_prov := jsonb_build_object(
      'source', 'projects',
      'project_id', p_project,
      'allowed_fields', to_jsonb(public.cs_source_allowed_fields()),
      'note', 'structure only — no marketing copy copied');
  end if;

  v_title := btrim(p_internal_title);
  v_slug := coalesce(nullif(btrim(p_slug), ''), public.cs_slugify(v_title));
  -- تصادم الـslug يُرفَض برسالة مفهومة بدل خطأ فريدة غامض.
  if exists (select 1 from public.cs_case_studies where slug = v_slug) then
    return jsonb_build_object('ok', false, 'reason', 'slug_taken', 'slug', v_slug);
  end if;

  insert into public.cs_case_studies
    (internal_title, slug, status,
     generated_from_project, generation_method, generated_at, generated_by, source_provenance,
     internal_notes)
  values
    (v_title, v_slug,
     -- 🔴 مسوّدة دائمًا. ⛔ لا نشر تلقائيّ ولا تخطٍّ لأيّ مرحلة مراجعة.
     'draft',
     p_project, 'template_v1', now(), auth.uid(), v_prov,
     'أُنشئت بقالب. كلّ نصّ عامّ فارغ عمدًا — PENDING KHALED CONTENT REVIEW.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'slug', v_slug,
                            'status', 'draft', 'auto_published', false);
end $$;

-- ─── §4 · طابور المسوّدات — يقرأ حالات المنصّة القائمة ─────────────────────
create or replace function public.cs_draft_queue(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.cs_is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'slug', c.slug, 'internal_title', c.internal_title,
           'status', c.status,
           'generation_method', c.generation_method,
           'generated_at', c.generated_at,
           'source_provenance', c.source_provenance,
           'has_unapproved_changes', c.has_unapproved_changes,
           'exported_at', c.exported_at,
           -- 🔴 مشتقّ: معتمَدة ≠ منشورة، والتصدير يشترط الاعتماد.
           'exportable', (c.status = 'approved'),
           'is_published', (c.status = 'published')
         ) order by c.updated_at desc), '[]'::jsonb) into v_rows
  from public.cs_case_studies c
  where (p_status is null or c.status = p_status);
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- ─── §5 · تسجيل التصدير — القاعدة **تسجّل** ولا تُصدّر ─────────────────────
create or replace function public.cs_mark_exported(p_id uuid, p_target text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if not public.cs_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into r from public.cs_case_studies where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;

  -- 🔴 الاعتماد شرط التصدير. مسوّدة تُصدَّر تعني نصًّا غير مراجَع يصل الموقع.
  if r.status not in ('approved','scheduled','published') then
    return jsonb_build_object('ok', false, 'reason', 'not_approved', 'status', r.status);
  end if;

  update public.cs_case_studies
     set exported_at = now(), exported_by = auth.uid(),
         export_target = nullif(btrim(coalesce(p_target,'')),'')
   where id = p_id;

  -- التدقيق في سجلّ المنصّة القائم — ⛔ لا سجلّ ثانٍ.
  if to_regproc('public.log_activity(text,text,uuid,jsonb)') is not null then
    perform public.log_activity('cs_exported', 'case_study', p_id,
                                jsonb_build_object('target', p_target));
  end if;
  return jsonb_build_object('ok', true, 'exported_at', now());
end $$;

-- ─── §6 · الصلاحيات ────────────────────────────────────────────────────────
revoke all on function public.cs_source_allowed_fields() from public, anon;
grant execute on function public.cs_source_allowed_fields() to authenticated;
revoke all on function public.cs_generate_draft(uuid,text,text) from public, anon;
grant execute on function public.cs_generate_draft(uuid,text,text) to authenticated;
revoke all on function public.cs_draft_queue(text) from public, anon;
grant execute on function public.cs_draft_queue(text) to authenticated;
revoke all on function public.cs_mark_exported(uuid,text) from public, anon;
grant execute on function public.cs_mark_exported(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';
