-- ════════════════════════════════════════════════════════════════════════════
-- docs/kian_ai_assistant_PREFLIGHT.sql — للقراءة فقط. لا يكتب حرفًا واحدًا.
--
-- المرحلة C — أساس «مساعد كيان». يُشغَّل **قبل** docs/kian_ai_assistant_RUNME.sql.
--
-- ★ يُثبت الاعتماديات ولا يفترضها ★
--   الحزمة لا تُنشئ محرّك هوية ولا كتالوج صلاحيات ثانيًا: هي تقرأ ما هو قائم.
--   فإن غاب ما تقرأ منه فالنتيجة ليست عطلًا صاخبًا بل **صمتًا**: مساعد بلا
--   أدوار، وسجلّ معرفة لا يفتحه أحد. لذلك تُفحص كلّ اعتمادية هنا بالاسم
--   وبالتوقيع وبنوع الإرجاع.
--
-- ★ نوع الإرجاع ليس تفصيلًا ★
--   ai_gate() لا ينادي إلّا دالّة **بلا وسائط تعيد boolean**. بوّابة بتوقيع
--   آخر — ولو كانت موجودة وتعمل — لن تُنادى أبدًا، فالدور المرتبط بها لن يُشتقّ
--   لأحد. هذا منع لا منح، لكنّه يعني عمليًّا وحدة بلا مستخدمين. تُقرأ هنا
--   صراحةً بدل أن تُكتشف بعد أسبوع من «المساعد لا يرى شيئًا».
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يستدعي بوّابة حيّة واحدة. المحرّر يعمل بدور postgres و auth.uid() = NULL،
--   فنداء بوّابة هنا يعيد false أو يرفع خطأً، ويُقرأ كلاهما خطأً على أنّه عطل.
--   هذا بالضبط ما كسر ترحيلتين في هذا المستودع. الفحص **بنيويّ** من كتالوج
--   النظام: pg_proc · pg_class · information_schema · to_regprocedure.
--
-- النتيجة: مجموعة نتائج واحدة. اقرأ عمود verdict:
--   BLOCKER  → لا تُشغّل RUNME قبل معالجته.
--   WARN     → تعارض محتمل يستحقّ قرارًا واعيًا قبل التشغيل.
--   OPTIONAL → اعتمادية غائبة ستُتخطّى بلطف، وأثرها **تضييق** لا توسيع.
--   INFO     → معلومة حالة.
--   PASS     → مستوفى.
-- ════════════════════════════════════════════════════════════════════════════

with

-- ─── (١) الاعتماديات الصلبة ────────────────────────────────────────────────
hard(kind, obj, why) as (values
  ('relation',  'auth.users',
   '★ كلّ عمود فاعل (created_by / approved_by / reviewed_by / actor_user_id) يشير إلى هوية حقيقية'),
  ('function',  'public.is_staff()',
   '★ الفاصل بين موظّف وعميل. بدونه لا يوجد «داخليّ» أصلًا، وai_actor_roles تعيد client دائمًا'),
  ('function',  'public.is_owner()',
   '★ المالك: الدور الوحيد الذي يبلغ المصادر المقيَّدة، والوحيد الذي يضبط الإعدادات'),
  ('function',  'pg_catalog.sha256(bytea)',
   '★ بصمة المحتوى المعتمَد. اعتماد بلا بصمة = ختمٌ على نصّ قد يتغيّر بعده بلا أثر'),
  ('function',  'pg_catalog.websearch_to_tsquery(regconfig,text)',
   '★ محرّك الاسترجاع كلّه. لا مزوّد تضمين خارجيّ في هذه الحزمة'),
  ('function',  'pg_catalog.gen_random_uuid()',
   'مفاتيح أوّلية لأربعة عشر جدولًا')),

hard_eval as (
  select h.kind, h.obj, h.why,
         case h.kind
           when 'relation' then (to_regclass(h.obj) is not null)
           when 'function' then (to_regprocedure(h.obj) is not null)
         end as present
    from hard h),

hard_typed as (
  select e.*,
         case when e.kind <> 'function' or not e.present then null
              when e.obj in ('public.is_staff()','public.is_owner()')
                then (select p.prorettype = 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure(e.obj))
              else true end as rettype_ok
    from hard_eval e),

r_hard as (
  select case when not present then 'BLOCKER'
              when rettype_ok is false then 'BLOCKER'
              else 'PASS' end as verdict,
         'اعتمادية صلبة' as area, obj as object,
         case when not present then 'غير موجود — ' || why
              when rettype_ok is false then '★ موجود لكنّه لا يعيد boolean. مُسنَد غير محدَّد ليس منعًا — ' || why
              else why end as detail
    from hard_typed),

-- ─── (٢) كتالوج الصلاحيات المشترك ──────────────────────────────────────────
--   اختياريّ **بنيويًّا**: بدونه لا يُحَلّ مفتاح ai.* واحد، فلا يفتح السجلّ ولا
--   المسوّدات ولا التنقيح أحدٌ غير المالك. تضييق لا توسيع — لكنّه تضييق شديد.
perm_dep(obj, kind, why) as (values
  ('public.permissions', 'relation',
   'جدول مفاتيح الصلاحيات. البذور تضيف ٦ مفاتيح ai.* إليه؛ غيابه يعني تخطّي البذور بلطف'),
  ('public.emp_has_permission(text)', 'function',
   '★ مُحلِّل المفاتيح. غيابه ⇒ ai_perm() تعيد false دائمًا ⇒ المالك وحده يدير السجلّ')),

perm_eval as (
  select d.obj, d.why,
         case d.kind when 'relation' then to_regclass(d.obj) is not null
                     else to_regprocedure(d.obj) is not null end as present
    from perm_dep d),

r_perm as (
  select case when present then 'PASS' else 'OPTIONAL' end as verdict,
         'كتالوج الصلاحيات' as area, obj as object,
         case when present then why
              else 'غائب — الوحدة تعمل، لكنّ ' || why end as detail
    from perm_eval),

-- ─── (٣) بوّابات الأدوار المُشار إليها في البذور ───────────────────────────
--   كلّ صفّ هنا يصير لاحقًا صفًّا في ai_role_gate_map. البوّابة الغائبة لا
--   تمنح شيئًا (ai_gate تعيد false)، فالنتيجة: دور لا يُشتقّ لأحد.
gates(assistant_role, sig, why) as (values
  ('sales',       'public.can_see_opportunities()',          'المبيعات — الفرص'),
  ('sales',       'public.can_manage_quotes()',              'المبيعات — عروض السعر'),
  ('operations',  'public.can_manage_projects()',            'التشغيل — المشاريع'),
  ('operations',  'public.can_manage_custody()',             'التشغيل — العهدة والمعدات'),
  ('collections', 'public.can_see_invoices()',               'التحصيل — الفواتير'),
  ('marketing',   'public.can_view_case_studies_internal()', 'التسويق — دراسات الحالة'),
  ('marketing',   'public.can_edit_case_studies()',          'التسويق — تحرير دراسات الحالة')),

gates_eval as (
  select g.assistant_role, g.sig, g.why,
         to_regprocedure(g.sig) as oid_,
         (to_regprocedure(g.sig) is not null) as present
    from gates g),

gates_typed as (
  select e.*,
         case when not e.present then null
              else (select p.prorettype = 'boolean'::regtype and p.pronargs = 0
                      from pg_proc p where p.oid = e.oid_) end as callable
    from gates_eval e),

r_gates as (
  select case when not present then 'OPTIONAL'
              when callable is false then 'WARN'
              else 'PASS' end as verdict,
         'بوّابة دور: ' || assistant_role as area, sig as object,
         case when not present
                then 'غير موجودة — لن يُشتقّ الدور «' || assistant_role || '» من هذا الطريق (منع لا منح). ' || why
              when callable is false
                then '★ موجودة لكن توقيعها ليس «بلا وسائط ⇒ boolean»، فai_gate لن ينادِيها أبدًا وسيبدو الدور معطّلًا بلا سبب ظاهر. ' || why
              else why end as detail
    from gates_typed),

r_gates_summary as (
  select case when count(*) filter (where present and callable) = 0 then 'WARN' else 'INFO' end as verdict,
         'بوّابات الأدوار' as area, 'الحصيلة' as object,
         'قابلة للنداء: ' || count(*) filter (where present and callable)
         || ' من ' || count(*) ||
         case when count(*) filter (where present and callable) = 0
              then ' — ★ لن يملك أحد غير المالك دورًا في المساعد، فai_can_use_internal() ترفض الجميع'
              else '' end as detail
    from gates_typed),

-- ─── (٤) تصادم الأسماء: هل يوجد كائن ai_* سابق تكتب عليه الحزمة؟ ──────────
existing_tables as (
  select c.relname as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ai\_%'),

expected_tables(t) as (values
  ('ai_settings'),('ai_role_gate_map'),('ai_role_source_access'),('ai_knowledge_sources'),
  ('ai_source_revisions'),('ai_source_chunks'),('ai_conversations'),('ai_messages'),
  ('ai_message_citations'),('ai_lead_drafts'),('ai_public_rate_limits'),('ai_abuse_log'),
  ('ai_provider_log'),('ai_audit')),

r_collide_tables as (
  select 'WARN' as verdict, 'تصادم أسماء' as area, 'public.' || e.t as object,
         '★ جدول بهذا الاسم موجود مسبقًا ولم تنشئه هذه الحزمة. RUNME يستعمل create table if not exists، '
         || 'فلن يُعاد بناؤه ولن تُضاف أعمدته الناقصة — راجعه قبل التشغيل.' as detail
    from existing_tables e
   where exists (select 1 from expected_tables x where x.t = e.t)),

r_collide_foreign as (
  select 'WARN' as verdict, 'تصادم أسماء' as area, 'public.' || e.t as object,
         'جدول باسم يبدأ بـai_ لا تعرفه هذه الحزمة. فحوص RUNME الذاتية تمسح كلّ ai_* '
         || '(RLS · منح anon · سياسات كتابة)، وقد يفشل التشغيل بسببه لا بسبب الحزمة.' as detail
    from existing_tables e
   where not exists (select 1 from expected_tables x where x.t = e.t)),

existing_fns as (
  select p.proname as f, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'),

r_collide_fns as (
  select 'WARN' as verdict, 'تصادم أسماء' as area, 'public.' || f || '(' || args || ')' as object,
         'دالّة باسم ai_* موجودة مسبقًا. إن اختلف نوع إرجاعها عمّا تنشئه الحزمة فسيفشل '
         || 'create or replace بخطأ 42P13 — وهو خطأ تشغيل لا خطأ تصميم.' as detail
    from existing_fns),

-- ─── (٥) التخزين ───────────────────────────────────────────────────────────
r_storage as (
  select case when to_regclass('storage.buckets') is null then 'OPTIONAL' else 'PASS' end as verdict,
         'التخزين' as area, 'storage.buckets' as object,
         case when to_regclass('storage.buckets') is null
              then 'غائب — تُتخطّى سلّة ai-knowledge بلطف. المحتوى المفهرَس هو content_text لا الملفّ، فالوحدة تعمل بلا تخزين'
              else 'موجود — ستُنشأ سلّة خاصّة ai-knowledge (غير عامّة) بثلاث سياسات قراءة/كتابة/حذف' end as detail),

r_bucket_exists as (
  select case when to_regclass('storage.buckets') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from storage.buckets where id = ''ai-knowledge''',
                     false, true, '')))[1]::text::int > 0
              then 'WARN' else 'PASS' end as verdict,
         'التخزين' as area, 'bucket:ai-knowledge' as object,
         'سلّة بهذا الاسم موجودة مسبقًا ⇒ on conflict do nothing يبقيها كما هي بما فيها علم public. '
         || 'تحقّق أنّها غير عامّة قبل التشغيل.' as detail),

-- ─── (٦) صلاحيات anon القائمة على أيّ ai_* ────────────────────────────────
r_anon_now as (
  select case when count(*) = 0 then 'PASS' else 'WARN' end as verdict,
         'أمن' as area, 'anon → ai_*' as object,
         case when count(*) = 0 then 'لا منح anon على أيّ كائن ai_* اليوم — وRUNME يسحبها صراحةً على كلّ حال'
              else 'يوجد ' || count(*) || ' منحًا لدور anon على كائنات ai_* قائمة. RUNME سيسحبها، لكن اعرف مصدرها' end as detail
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'ai\_%' and grantee = 'anon'),

r_service_role as (
  select case when exists (select 1 from pg_roles where rolname = 'service_role') then 'PASS' else 'OPTIONAL' end as verdict,
         'أمن' as area, 'role:service_role' as object,
         case when exists (select 1 from pg_roles where rolname = 'service_role')
              then 'موجود — السطح العامّ (ai_public_ask / ai_public_lead_draft) يُمنح له وحده، ولا يُمنح لـanon ولا لـauthenticated'
              else '★ غائب — لن يُمنح السطح العامّ لأيّ دور، فمسار الموقع العامّ لن يعمل حتى يوجد الدور. الداخليّ يعمل' end as detail),

-- ─── (٧) حارس التجميد: الحزمة لا تلمس منصّة المشاريع ───────────────────────
r_freeze as (
  select 'INFO' as verdict, 'التجميد' as area, 'projects / project_core / deliverables' as object,
         'هذه الحزمة لا تُنشئ ولا تعدّل ولا تقرأ أيًّا منها: لا مفتاح أجنبيّ، ولا سياسة، ولا عضوية مشروع '
         || 'كبوّابة. سجلّ المعرفة مستقلّ تمامًا عن منصّة المشاريع المجمَّدة.' as detail),

-- ─── (٨) حالة قابلة للقراءة قبل التشغيل ────────────────────────────────────
r_info_pg as (
  select 'INFO' as verdict, 'البيئة' as area, 'إصدار PostgreSQL' as object,
         current_setting('server_version') as detail),

r_info_search as (
  select case when exists (select 1 from pg_ts_config where cfgname = 'simple') then 'PASS' else 'BLOCKER' end as verdict,
         'الاسترجاع' as area, 'tsearch config: simple' as object,
         'الفهرس النصّيّ يُبنى بضبط simple (يعمل على العربية والإنجليزية معًا بلا قاموس لغويّ). غيابه يُسقط الجدول عند الإنشاء.' as detail),

all_rows as (
  select * from r_hard
  union all select * from r_perm
  union all select * from r_gates
  union all select * from r_gates_summary
  union all select * from r_collide_tables
  union all select * from r_collide_foreign
  union all select * from r_collide_fns
  union all select * from r_storage
  union all select * from r_bucket_exists
  union all select * from r_anon_now
  union all select * from r_service_role
  union all select * from r_freeze
  union all select * from r_info_pg
  union all select * from r_info_search)

select
  case verdict when 'BLOCKER' then 1 when 'WARN' then 2 when 'OPTIONAL' then 3
               when 'SKIP' then 4 when 'INFO' then 5 else 6 end as sort_key,
  verdict, area, object, detail
from all_rows
order by sort_key, area, object;
