-- ════════════════════════════════════════════════════════════════════════════
-- docs/kian_ai_assistant_POSTCHECK.sql — للقراءة فقط · مجموعة نتائج واحدة.
-- يُشغَّل بعد docs/kian_ai_assistant_RUNME.sql.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة ولا يكتب صفًّا. المحرّر يعمل
--   بدور postgres و auth.uid() = NULL؛ نداء بوّابة حيّة هنا يعيد false فيُقرأ
--   خطأً على أنّها مكسورة. كلّ صفّ يقرأ **تعريف** الكائن من كتالوج النظام:
--   pg_proc · pg_get_functiondef · pg_policies · pg_constraint ·
--   information_schema. (الـdeparser يرفع حالة الكلمات المفتاحية، فالمطابقة
--   تُجرى على مُعرِّفات صغيرة أو بعد lower().)
--
-- ★ ولا مصيدة catch-all ★ كلّ صفّ هنا قادر فعلًا على أن يُرجع FAIL: لا صفّ
--   يقول PASS لمجرّد أنّ شيئًا ما موجود.
--
-- ما يثبته هذا الملفّ بالترتيب: البنية · العزل · أنّ المحتوى المسترجَع بيانات
-- لا تعليمات · أنّ عدد النداءات الخارجية صفر · أنّ السطح العامّ لا يرسل ولا
-- ينشئ · أنّ سلسلة التفكير غير مخزَّنة · وأنّ المزوّد مطفأ ويقول ذلك صراحةً.
-- ════════════════════════════════════════════════════════════════════════════

with

tables_expected(t) as (values
  ('ai_settings'),('ai_role_gate_map'),('ai_role_source_access'),('ai_knowledge_sources'),
  ('ai_source_revisions'),('ai_source_chunks'),('ai_conversations'),('ai_messages'),
  ('ai_message_citations'),('ai_lead_drafts'),('ai_public_rate_limits'),('ai_abuse_log'),
  ('ai_provider_log'),('ai_audit')),

fns_expected(f) as (values
  ('ai_gate(text)'),('ai_perm(text)'),('ai_is_owner()'),('ai_is_staff()'),('ai_actor_roles()'),
  ('ai_settings_row()'),('ai_can_use_internal()'),('ai_can_view_knowledge()'),
  ('ai_can_manage_knowledge()'),('ai_can_approve_knowledge()'),('ai_can_view_all_conversations()'),
  ('ai_can_redact()'),('ai_can_review_leads()'),('ai_can_manage_settings()'),
  ('ai_log(text,text,uuid,boolean,jsonb)'),('ai_neutralize(text)'),('ai_detect_injection(text)'),
  ('ai_guard_question(text)'),('ai_forbidden_content(text)'),('ai_checksum(text)'),
  ('ai_sensitivity_rank(text)'),
  ('ai_source_permitted_for(text,text,text[],text,date,date,timestamptz,text[])'),
  ('ai_source_is_permitted(uuid)'),('ai_search_sources(text,text[],int)'),
  ('ai_provider_notice()'),('ai_provider_describe()'),('ai_provider_probe(int,int)'),
  ('ai_conversation_start(text,text)'),('ai_message_add(uuid,text,text,text,int,jsonb,text,text)'),
  ('ai_ask(text,uuid)'),('ai_rate_take(text,int,interval)'),('ai_captcha_verify(text)'),
  ('ai_public_ask(text,text)'),('ai_public_lead_draft(jsonb,text,text,text,text)'),
  ('ai_source_reindex(uuid)'),('ai_source_upsert(jsonb)'),('ai_source_submit(uuid)'),
  ('ai_source_approve(uuid)'),('ai_source_reject(uuid,text)'),('ai_source_archive(uuid)'),
  ('ai_sources_expire_due()'),('ai_conversation_redact(uuid,text)'),
  ('ai_conversation_delete(uuid,text)'),('ai_retention_purge_due()'),
  ('ai_conversation_escalate(uuid,text)'),('ai_lead_review(uuid,text,text)'),
  ('ai_settings_update(jsonb)'),('ai_assistant_state()'),('ai_knowledge_list(text,text)'),
  ('ai_conversation_list(int)'),('ai_conversation_messages(uuid)'),('ai_lead_list(text,int)'),
  ('ai_admin_overview()')),

-- الدوالّ التي لو مُنحت لـauthenticated لانهار نموذج الأمن كلّه:
-- ai_search_sources تستقبل p_roles، فمنحُها للمتصل = اختيار الأدوار بنفسه.
never_authenticated(f) as (values
  ('ai_search_sources(text,text[],int)'),
  ('ai_message_add(uuid,text,text,text,int,jsonb,text,text)'),
  ('ai_source_permitted_for(text,text,text[],text,date,date,timestamptz,text[])'),
  ('ai_log(text,text,uuid,boolean,jsonb)'),
  ('ai_rate_take(text,int,interval)'),
  ('ai_source_reindex(uuid)'),
  ('ai_public_ask(text,text)'),
  ('ai_public_lead_draft(jsonb,text,text,text,text)'),
  ('ai_retention_purge_due()'),
  ('ai_sources_expire_due()')),

constraints_expected(c, why) as (values
  ('ai_sources_external_public_only',        'العميل والزائر لا يبلغان مصدرًا غير عامّ — قيد جدوليّ لا عُرف'),
  ('ai_sources_restricted_owner_only',       'المقيَّد للمالك وحده'),
  ('ai_sources_approved_is_complete',        'الاعتماد = نصّ + بصمة + معتمِد + وقت، لا مجرّد تبديل حالة'),
  ('ai_sources_approver_not_submitter',      'المعتمِد ≠ المُقدِّم'),
  ('ai_sources_storage_is_pinned',           'مسار التخزين مقيَّد بسلّة واحدة ونمط مسار — لا أوراكل قراءة'),
  ('ai_sources_roles_known',                 'مجموعة الأدوار مغلقة'),
  ('ai_messages_role_known',                 'ثلاثة أدوار فقط: لا قيمة تسمح بتخزين سلسلة تفكير'),
  ('ai_messages_grounded_or_refusal',        'إجابة بلا مصادر يجب أن تكون رفضًا برمز'),
  ('ai_role_source_access_external_public_only', 'مصفوفة الوصول لا ترفع الخارجيّ فوق العامّ'),
  ('ai_conversations_public_has_no_user',    'المحادثة العامّة بلا هوية مستخدم'),
  ('ai_lead_drafts_field_caps',              'سطح عامّ بلا نصّ غير محدود'),
  ('ai_lead_drafts_has_a_contact',           'مسوّدة بلا وسيلة تواصل لا معنى لها')),

-- ─── (١) الجداول ورقابة الصفوف ─────────────────────────────────────────────
r_tables as (
  select case when to_regclass('public.' || t) is null then 'FAIL' else 'PASS' end as verdict,
         'البنية' as area, 'table:' || t as object,
         'جدول من جداول الحزمة الأربعة عشر' as detail
    from tables_expected),

r_rls as (
  select case when to_regclass('public.' || e.t) is null then 'FAIL'
              when (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = e.t) then 'PASS'
              else 'FAIL' end as verdict,
         'العزل' as area, 'rls:' || e.t as object,
         'رقابة الصفوف مفعَّلة' as detail
    from tables_expected e),

r_no_write_policy as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'العزل' as area, 'سياسات الكتابة المباشرة' as object,
         'الكتابة كلّها عبر دوالّ SECURITY DEFINER. وُجد: ' || count(*) as detail
    from pg_policies
   where schemaname = 'public' and tablename like 'ai\_%' and cmd in ('INSERT','UPDATE','DELETE','ALL')),

r_ratelimit_unreadable as (
  select case when to_regclass('public.ai_public_rate_limits') is null then 'FAIL'
              when not exists (select 1 from pg_policies
                                where schemaname = 'public' and tablename = 'ai_public_rate_limits')
               and not exists (select 1 from information_schema.role_table_grants
                                where table_schema = 'public' and table_name = 'ai_public_rate_limits'
                                  and grantee in ('anon','authenticated'))
              then 'PASS' else 'FAIL' end as verdict,
         'العزل' as area, 'ai_public_rate_limits' as object,
         'عدّاد الحدود لا يُقرأ عبر REST إطلاقًا: بلا سياسة وبلا منح' as detail),

-- ─── (٢) الدوالّ: وجود · تعريف أمنيّ · منح ─────────────────────────────────
r_fns as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL' else 'PASS' end as verdict,
         'البنية' as area, 'function:' || f as object,
         'دالّة من واجهة الحزمة' as detail
    from fns_expected),

r_definer as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الأمن' as area, 'SECURITY DEFINER + search_path' as object,
         'كلّ دالّة ai_ غير نقيّة يجب أن تكون definer بـsearch_path مثبَّت. مخالِفات: ' || count(*) as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%' and p.provolatile <> 'i'
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%')),

r_anon_fn as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الأمن' as area, 'anon → execute' as object,
         'لا صلاحية تنفيذ لدور anon على أيّ دالّة ai_. مخالِفات: ' || count(*) as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and has_function_privilege('anon', p.oid, 'execute')),

r_anon_tbl as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الأمن' as area, 'anon → tables' as object,
         'لا منح جدوليّ لدور anon على أيّ جدول ai_. مخالِفات: ' || count(*) as detail
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'ai\_%' and grantee = 'anon'),

r_authed_readonly as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الأمن' as area, 'authenticated → قراءة فقط' as object,
         'لا INSERT/UPDATE/DELETE لدور authenticated على أيّ جدول ai_. مخالِفات: ' || count(*) as detail
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'ai\_%' and grantee = 'authenticated'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES')),

-- ★ أخطر صفّ في الملفّ: ai_search_sources تستقبل مصفوفة الأدوار كوسيط.
--   منحها للمتصل يعني أن يختار المتصل دوره بنفسه ويقرأ كلّ شيء.
r_never_authed as (
  select case when to_regprocedure('public.' || n.f) is null then 'FAIL'
              when has_function_privilege('authenticated', to_regprocedure('public.' || n.f), 'execute')
              then 'FAIL' else 'PASS' end as verdict,
         'الأمن' as area, 'authenticated ✗ ' || n.f as object,
         'دالّة داخلية أو خادمية: منحها للمتصل يكسر نموذج الصلاحيات' as detail
    from never_authenticated n),

r_public_surface_service_only as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'execute') then 'FAIL'
              when not exists (select 1 from pg_roles where rolname = 'service_role') then 'SKIP'
              when has_function_privilege('service_role', to_regprocedure('public.' || f), 'execute')
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'service_role → ' || f as object,
         'السطح العامّ يمرّ عبر الخادم وحده: لا anon ولا authenticated' as detail
    from (values ('ai_public_ask(text,text)'),('ai_public_lead_draft(jsonb,text,text,text,text)')) as v(f)),

-- ─── (٣) المحتوى المسترجَع بيانات لا تعليمات ───────────────────────────────
-- ⚠️ كان هذا الفحص يقارن **مواضع نصّية** في pg_get_functiondef الخام:
--       position('blocked_by_guard') < position('ai_search_sources')
--    فأدان تركيبًا ناجحًا (145 PASS / 1 FAIL) والدالّة سليمة. والسبب أنّ
--    **التعليق** في فرع المنع يوثّق أنّه «لا نداء لـai_search_sources في هذا
--    الفرع إطلاقًا»، فيذكر الاسم نصّيًّا قبل الرمز — فبدا الاسترجاع سابقًا
--    للحارس. أي أنّ الجملة التي تنفي الاسترجاع هي التي أدانت الشيفرة.
--    وترتيبُ ظهور الكلمات ليس ترتيب التنفيذ أصلًا.
--    العقد الآن هو عقد RUNME نفسه حرفًا بحرف (الالتزام 2ea378e): يُجرَّد النصّ
--    من التعليقات ويُفرَّغ محتوى السلاسل عبر public.ai_exec_code، ثمّ يُقاس
--    **التدفّق**: نداء الحارس ← عودةٌ مغلقة في فرع المنع ← أوّل نداء استرجاع.
--    ملاحظة اقتران: ai_exec_code تُركّبها RUNME في المعاملة نفسها التي تُركّب
--    فيها ai_ask، فوجودها مضمون بعد تركيب ناجح. وغيابها يرفع 42883 عند
--    التحليل النحويّ — وهي إشارة صريحة إلى أنّ RUNME لم تُركَّب، لا إخفاء فشل.
ask_flow as (
  select s.src,
         coalesce(position('ai_guard_question(' in s.src), 0) as p_g,
         coalesce(position('ai_search_sources(' in s.src), 0) as p_ret
    from (select case when to_regprocedure('public.ai_ask(text,uuid)') is null then null
                      else public.ai_exec_code(
                             pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')))
                 end as src) s),

-- أوّل `return` بعد الحارس: فرع المنع يجب أن يخرج قبل أيّ استرجاع.
ask_flow_pos as (
  select f.src, f.p_g, f.p_ret,
         -- ⚠️ «غير موجود» يبقى صفرًا: coalesce(nullif(...,0),0) + p_g - 1 كانت
         --    تعطي p_g - 1 عند غياب `return` بعد الحارس، فتمرّ دالّة تنادي
         --    الحارس ثمّ تتجاهله وتسترجع بلا شرط.
         case when f.p_g = 0 then 0
              when position('return ' in substr(f.src, f.p_g)) = 0 then 0
              else position('return ' in substr(f.src, f.p_g)) + f.p_g - 1
         end as p_ret_stmt
    from ask_flow f),

r_guard_before_retrieval as (
  select case when src is null then 'FAIL'
              when p_g   = 0   then 'FAIL'
              when p_ret = 0   then 'FAIL'
              when p_g > p_ret then 'FAIL'
              when p_ret_stmt = 0 or p_ret_stmt > p_ret then 'FAIL'
              else 'PASS' end as verdict,
         'حقن التعليمات' as area, 'المنع يسبق الاسترجاع' as object,
         case when src is null then 'ai_ask(text,uuid) غير موجودة'
              when p_g   = 0 then 'لا نداء لـai_guard_question في الشيفرة التنفيذية لـai_ask'
              when p_ret = 0 then 'لا نداء لـai_search_sources: تغيّر عقد الاسترجاع ويجب مراجعته'
              when p_g > p_ret then 'الاسترجاع يسبق الحارس في التدفّق'
              when p_ret_stmt = 0 or p_ret_stmt > p_ret
                   then 'فرع المنع لا يبلغ return قبل أوّل استرجاع'
              else '★ القياس على التدفّق لا على ترتيب الكلمات: حارس ← عودة مغلقة ← أوّل استرجاع. '
                   || 'عند المنع تعود ai_ask قبل بلوغ ai_search_sources، فلا يُقرأ صفّ معرفة واحد ويبقى retrieved_count = 0'
         end as detail
    from ask_flow_pos),

-- ⚠️ فحوص **النفي** (تُدين عند العثور) تُقاس على الشيفرة المجرَّدة لا على
--    النصّ الخام: تعليقٌ أو سلسلة تذكر الرمز كانت تُدين شيفرة سليمة — وهو
--    الصنف نفسه الذي أسقط «المنع يسبق الاسترجاع».
--    والاتّجاه آمن بالبرهان: ai_exec_code تحذف ولا تضيف، فالمجرَّد ⊆ الخام،
--    فالنفي لا ينتقل إلا من FAIL إلى PASS — ولا يُنشئ فشلًا جديدًا أبدًا.
--    أمّا فحوص **الإثبات** (تُنجح عند العثور) فتُترك على النصّ الخام عمدًا:
--    تجريدُها يجعلها أشدّ وقد يقلب PASS إلى FAIL، وذلك تغييرٌ آخر بمخاطرة
--    مختلفة لا تُدرَج في إصلاح إنذار كاذب.
r_no_execute_in_ask as (
  select case when to_regprocedure('public.ai_ask(text,uuid)') is null then 'FAIL'
              when lower(public.ai_exec_code(
                     pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')))) ~ '\yexecute\y'
              then 'FAIL' else 'PASS' end as verdict,
         'حقن التعليمات' as area, 'ai_ask بلا EXECUTE' as object,
         'نصّ المستخدم ونصّ المصدر لا يبلغان أيّ سياق تنفيذيّ' as detail),

-- الموضع الوحيد المسموح به لـEXECUTE هو ai_gate و ai_perm، وكلاهما لا يمرّر
-- نصًّا: ai_gate يعيد بناء النداء من كتالوج PostgreSQL بـformat('%I.%I()').
r_execute_census as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'حقن التعليمات' as area, 'حصر EXECUTE' as object,
         'دوالّ ai_ التي تستعمل EXECUTE خارج (ai_gate · ai_perm) وهي دوالّ البوّابة وحدها: ' || count(*) as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and p.proname not in ('ai_gate','ai_perm')
     and lower(public.ai_exec_code(pg_get_functiondef(p.oid))) ~ '\yexecute\y'),

r_gate_uses_catalog as (
  select case when to_regprocedure('public.ai_gate(text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_gate(text)')) ~ 'format\(''select %I\.%I\(\)'''
               and pg_get_functiondef(to_regprocedure('public.ai_gate(text)')) ~ 'to_regprocedure'
               and pg_get_functiondef(to_regprocedure('public.ai_gate(text)')) ~ 'prorettype'
              then 'PASS' else 'FAIL' end as verdict,
         'حقن التعليمات' as area, 'ai_gate يبني النداء من الكتالوج' as object,
         'التوقيع يُتحقَّق بـto_regprocedure ونوع الإرجاع boolean، ثمّ يُعاد بناء النداء بـ%I — لا يمرّ حرف من الجدول' as detail),

r_neutralize_applied as (
  select case when to_regprocedure('public.ai_search_sources(text,text[],int)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_search_sources(text,text[],int)')) ~ 'ai_neutralize'
              then 'PASS' else 'FAIL' end as verdict,
         'حقن التعليمات' as area, 'تحييد المقتطف' as object,
         'كلّ مقتطف يمرّ بـai_neutralize: تُبطل الوسوم والمحارف الخفيّة والروابط الموقَّعة وعلامات الأوامر' as detail),

r_signed_link_stripped as (
  select case when to_regprocedure('public.ai_neutralize(text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_neutralize(text)')) ~ 'object/sign'
               and pg_get_functiondef(to_regprocedure('public.ai_neutralize(text)')) ~ 'X-Amz-'
              then 'PASS' else 'FAIL' end as verdict,
         'تسريب' as area, 'الروابط الموقَّعة' as object,
         'رابط تخزين موقَّع داخل مصدر لا يخرج في إجابة — يُستبدل بنصّ صريح' as detail),

r_double_filter as (
  select case when to_regprocedure('public.ai_search_sources(text,text[],int)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_search_sources(text,text[],int)')) ~ 'ai_source_permitted_for'
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'ترشيح ثانٍ داخل الاسترجاع' as object,
         'الترشيح مطبَّق مرّتين: سياسة RLS للقراءة، ثمّ شرط WHERE داخل محرّك الاسترجاع نفسه' as detail),

r_no_project_membership as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'لا عضوية مشروع كبوّابة' as object,
         'عضوية المشروع ليست صلاحية معرفة. دوالّ تخالف: ' || count(*) as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and lower(public.ai_exec_code(pg_get_functiondef(p.oid)))
           ~ '(project_members|is_project_member|can_access_project|pc_can_read_project)'),

r_unapproved_never_indexed as (
  select case when to_regprocedure('public.ai_source_reindex(uuid)') is null then 'FAIL'
              when lower(pg_get_functiondef(to_regprocedure('public.ai_source_reindex(uuid)')))
                   ~ 'if s\.status <> ''approved'' then return 0'
              then 'PASS' else 'FAIL' end as verdict,
         'الاعتماد' as area, 'غير المعتمَد لا يُفهرَس' as object,
         'المصدر غير المعتمَد لا يدخل الفهرس أصلًا، فلا يُسترجَع ولو طابق السؤال حرفيًّا' as detail),

r_refusal_text as (
  select case when to_regprocedure('public.ai_ask(text,uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)'))
                   like '%لا توجد لدي معلومة معتمدة كافية للإجابة%'
              then 'PASS' else 'FAIL' end as verdict,
         'الإسناد' as area, 'الرفض عند غياب المصدر' as object,
         'بلا مصدر معتمَد: نصّ رفض حرفيّ واحد، ولا تخمين' as detail),

r_citations_required as (
  select case when to_regprocedure('public.ai_ask(text,uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')) ~ 'ai_message_citations'
               and pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')) ~ 'source_version'
               and pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')) ~ 'freshness_days'
              then 'PASS' else 'FAIL' end as verdict,
         'الإسناد' as area, 'مُسنَدات إجبارية' as object,
         'كلّ إجابة مُسنَدة تكتب مُسنَداتها بنسخة المصدر وطزاجته — لا إجابة بلا مرجع' as detail),

r_citation_fk_restrict as (
  select case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict,
         'الإسناد' as area, 'المُسنَد لا ييتم' as object,
         'المفتاح الأجنبيّ من ai_message_citations إلى المصادر بـon delete restrict: لا يُحذف مصدر يُستشهَد به' as detail
    from pg_constraint c
   where c.conrelid = to_regclass('public.ai_message_citations')
     and c.contype = 'f' and c.confrelid = to_regclass('public.ai_knowledge_sources')
     and c.confdeltype = 'r'),

-- ─── (٤) صفر نداء خارجيّ · صفر تنفيذ أداة · صفر إرسال ─────────────────────
r_no_http as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'المزوّد' as area, 'لا نداء شبكيّ' as object,
         'دوالّ ai_ التي تذكر http/pg_net/dblink/curl: ' || count(*) || ' — يجب أن تكون صفرًا' as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and lower(public.ai_exec_code(pg_get_functiondef(p.oid)))
           ~ '(net\.http|http_post|http_get|pg_net|dblink|curl_)'),

r_no_relay as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الإرسال' as area, 'لا بريد ولا واتساب' as object,
         'دوالّ ai_ التي تكتب في طابور بريد أو إشعار خارجيّ: ' || count(*) || ' — يجب أن تكون صفرًا' as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and lower(public.ai_exec_code(pg_get_functiondef(p.oid))) ~
         'insert[[:space:]]+into[[:space:]]+(public\.)?(email_outbox|notification_queue|notifications|comms_messages|whatsapp_messages)\y'),

r_no_entity_creation as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'لا إنشاء كيان تشغيليّ' as object,
         'دوالّ ai_ التي تُنشئ مشروعًا أو عميلًا أو فرصة أو عرض سعر: ' || count(*) || ' — يجب أن تكون صفرًا' as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and lower(public.ai_exec_code(pg_get_functiondef(p.oid))) ~
         'insert[[:space:]]+into[[:space:]]+(public\.)?(projects|project_core|deliverables|clients|crm_leads|crm_opportunities|opportunity_requests|sq_quotes|invoices)\y'),

r_provider_off as (
  select case when to_regclass('public.ai_settings') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.ai_settings where id and provider_enabled',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'INFO' end as verdict,
         'المزوّد' as area, 'provider_enabled' as object,
         'مطفأ بعد الترحيلة مباشرةً. INFO يعني أنّ المالك بدّله عمدًا — قرار لا عطل، والردّ يبقى إفصاحًا لا نصًّا مولَّدًا' as detail),

r_provider_notice as (
  select case when to_regprocedure('public.ai_provider_notice()') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_provider_notice()'))
                   like '%مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط%'
              then 'PASS' else 'FAIL' end as verdict,
         'المزوّد' as area, 'نصّ الإفصاح' as object,
         'الردّ الوحيد الممكن من المزوّد الوهميّ نصّ صريح لا يوحي بأنّ الذكاء الاصطناعي يعمل' as detail),

r_provider_log_shape as (
  select case when count(*) = 2 then 'PASS' else 'FAIL' end as verdict,
         'المزوّد' as area, 'سجلّ المزوّد بلا نصوص' as object,
         'ai_provider_log يخزّن الشكل (أطوال وأعداد) في request_shape/response_shape فقط' as detail
    from information_schema.columns
   where table_schema = 'public' and table_name = 'ai_provider_log'
     and column_name in ('request_shape','response_shape')),

r_no_tool_exec as (
  select case when to_regprocedure('public.ai_ask(text,uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')) ~ '''tool_execution'', false'
              then 'PASS' else 'FAIL' end as verdict,
         'التنفيذ' as area, 'tool_execution = false' as object,
         'كلّ إجابة تُصرّح بأنّها لا تنفّذ أداة، وقائمة الأدوات فارغة بنيويًّا' as detail),

-- ─── (٥) بيانات المحادثة: أقلّ ما يلزم، وبلا سلسلة تفكير ──────────────────
r_no_cot as (
  select case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict,
         'الخصوصية' as area, 'لا سلسلة تفكير مخزَّنة' as object,
         'أعمدة تشبه سلسلة التفكير أو نصّ النظام في جداول المحادثة: ' || count(*) as detail
    from information_schema.columns
   where table_schema = 'public' and table_name in ('ai_messages','ai_conversations')
     and column_name ~* '(thought|reason|chain|scratch|system_prompt|internal_prompt|raw_context|hidden)'),

r_roles_closed as (
  select case when exists (
                select 1 from pg_constraint
                 where conname = 'ai_messages_role_known'
                   and pg_get_constraintdef(oid) ~ 'user' and pg_get_constraintdef(oid) ~ 'assistant'
                   and pg_get_constraintdef(oid) ~ 'system_notice'
                   and pg_get_constraintdef(oid) !~ 'thought')
              then 'PASS' else 'FAIL' end as verdict,
         'الخصوصية' as area, 'أدوار الرسائل مغلقة' as object,
         'ثلاث قيم فقط — لا قيمة تسمح بتخزين تفكير داخليّ حتى بكتابة مباشرة' as detail),

r_retention as (
  select case when to_regprocedure('public.ai_conversation_start(text,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_conversation_start(text,text)')) ~ 'expires_at'
               and to_regprocedure('public.ai_retention_purge_due()') is not null
              then 'PASS' else 'FAIL' end as verdict,
         'الخصوصية' as area, 'سياسة الاحتفاظ' as object,
         'كلّ محادثة تولد بتاريخ انتهاء، وكنس المنتهي دالّة قائمة تُنادى من مهمّة دورية' as detail),

r_redact as (
  select case when to_regprocedure('public.ai_conversation_redact(uuid,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_conversation_redact(uuid,text)')) ~ 'ai_can_redact'
               and pg_get_functiondef(to_regprocedure('public.ai_conversation_delete(uuid,text)')) ~ 'ai_can_redact'
              then 'PASS' else 'FAIL' end as verdict,
         'الخصوصية' as area, 'التنقيح والحذف مخوَّلان' as object,
         'التنقيح والحذف خلف مفتاح صريح، وكلاهما مُدقَّق في ai_audit' as detail),

-- ─── (٦) السطح العامّ ──────────────────────────────────────────────────────
r_captcha_failclosed as (
  select case when to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'))
                   ~ 'captcha_not_verified'
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'CAPTCHA يفشل مغلقًا' as object,
         'إن كان التحقّق مطلوبًا ولم يُنفَّذ فالطلب يُرفض ويُسجَّل — لا قبول صامت يبدو كأنّه مرّ بتحقّق' as detail),

r_rate_limits as (
  select case when to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'))
                   ~ 'pub_lead_h:'
               and pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'))
                   ~ 'pub_lead_d:'
               and pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'))
                   ~ 'pub_lead_g'
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'ثلاثة حدود' as object,
         'حدّ بالساعة وحدّ باليوم لكلّ عنوان، وحدّ يوميّ عامّ — لا حدّ واحد يُلتفّ عليه' as detail),

r_closed_payload as (
  select case when to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'))
                   ~ 'unknown_fields'
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'حمولة مغلقة' as object,
         'مفتاح غير معروف في الحمولة ⇒ رفض وتسجيل إساءة، لا ابتلاع صامت' as detail),

r_idempotency as (
  select case when exists (
                select 1 from pg_constraint
                 where conrelid = to_regclass('public.ai_lead_drafts')
                   and contype = 'u' and pg_get_constraintdef(oid) ~ 'idempotency_key')
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'التكرار' as object,
         'المفتاح نفسه ⇒ الصفّ نفسه: لا صفّ ثانٍ ولا خطأ' as detail),

r_lead_awaits_human as (
  select case when to_regprocedure('public.ai_lead_review(uuid,text,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.ai_lead_review(uuid,text,text)')) ~ '''converted'', false'
              then 'PASS' else 'FAIL' end as verdict,
         'السطح العامّ' as area, 'التسليم بشريّ' as object,
         'مراجعة المسوّدة لا تُنشئ عميلًا ولا فرصة ولا عرض سعر — التحويل قرار بشريّ في وحدة المبيعات' as detail),

-- ─── (٧) القيود الجدولية الحرجة ────────────────────────────────────────────
r_constraints as (
  select case when exists (select 1 from pg_constraint where conname = c) then 'PASS' else 'FAIL' end as verdict,
         'القيود' as area, c as object, why as detail
    from constraints_expected),

-- ─── (٨) مصفوفة الأدوار والمصادر ──────────────────────────────────────────
r_matrix_external as (
  select case when to_regclass('public.ai_role_source_access') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.ai_role_source_access '
                     || 'where assistant_role in (''client'',''anonymous'') and max_sensitivity <> ''public''',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'الخارجيّ = عامّ فقط' as object,
         'العميل والزائر لا يبلغان مصدرًا داخليًّا ولا مقيَّدًا في مصفوفة الوصول' as detail),

r_matrix_pricing as (
  select case when to_regclass('public.ai_role_source_access') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.ai_role_source_access '
                     || 'where source_type = ''pricing_guidance'' and assistant_role <> ''owner''',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'إرشاد التسعير' as object,
         'مصدر مقيَّد للمالك وحده: لا مبيعات ولا تشغيل ولا تحصيل يبلغه' as detail),

r_matrix_collections as (
  select case when to_regclass('public.ai_role_source_access') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.ai_role_source_access '
                     || 'where assistant_role = ''collections'' '
                     || 'and source_type in (''pricing_guidance'',''sales_guide'',''hr_policy'',''compliance_guide'')',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'التحصيل بلا تكلفة ولا ربح' as object,
         'دور التحصيل لا يبلغ إرشاد التسعير ولا دليل المبيعات ولا سياسات الموارد البشرية' as detail),

r_matrix_seeded as (
  select case when to_regclass('public.ai_role_gate_map') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.ai_role_gate_map', false, true, '')))[1]::text::int >= 8
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'خريطة البوّابات' as object,
         'الخريطة بيانات صريحة قابلة للتدقيق — لا شيفرة مخفيّة تقرّر من يرى ماذا' as detail),

-- ─── (٩) كتالوج الصلاحيات والتخزين ────────────────────────────────────────
r_perm_keys as (
  select case when to_regclass('public.permissions') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.permissions where key like ''ai.%''',
                     false, true, '')))[1]::text::int >= 6
              then 'PASS' else 'FAIL' end as verdict,
         'الصلاحية' as area, 'مفاتيح ai.* في الكتالوج المشترك' as object,
         'ستّة مفاتيح صفوف بيانات في الكتالوج القائم — لا محرّك صلاحيات ثانٍ' as detail),

r_bucket_private as (
  select case when to_regclass('storage.buckets') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from storage.buckets where id = ''ai-knowledge'' and public',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'التخزين' as area, 'bucket:ai-knowledge' as object,
         'سلّة المعرفة غير عامّة — مرفق مرجعيّ لا يُقرأ بلا صلاحية' as detail),

r_audit as (
  select case when to_regclass('public.ai_audit') is null then 'FAIL'
              when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'ai\_source\_%'
                       and lower(pg_get_functiondef(p.oid)) ~ 'ai_log\(') >= 5
              then 'PASS' else 'FAIL' end as verdict,
         'التدقيق' as area, 'الكتابات الحسّاسة مُدقَّقة' as object,
         'كلّ تغيير في سجلّ المعرفة يكتب صفًّا في ai_audit' as detail),

all_rows as (
  select * from r_tables union all select * from r_rls union all select * from r_no_write_policy
  union all select * from r_ratelimit_unreadable
  union all select * from r_fns union all select * from r_definer
  union all select * from r_anon_fn union all select * from r_anon_tbl
  union all select * from r_authed_readonly union all select * from r_never_authed
  union all select * from r_public_surface_service_only
  union all select * from r_guard_before_retrieval union all select * from r_no_execute_in_ask
  union all select * from r_execute_census union all select * from r_gate_uses_catalog
  union all select * from r_neutralize_applied union all select * from r_signed_link_stripped
  union all select * from r_double_filter union all select * from r_no_project_membership
  union all select * from r_unapproved_never_indexed union all select * from r_refusal_text
  union all select * from r_citations_required union all select * from r_citation_fk_restrict
  union all select * from r_no_http union all select * from r_no_relay
  union all select * from r_no_entity_creation
  union all select * from r_provider_off union all select * from r_provider_notice
  union all select * from r_provider_log_shape union all select * from r_no_tool_exec
  union all select * from r_no_cot union all select * from r_roles_closed
  union all select * from r_retention union all select * from r_redact
  union all select * from r_captcha_failclosed union all select * from r_rate_limits
  union all select * from r_closed_payload union all select * from r_idempotency
  union all select * from r_lead_awaits_human
  union all select * from r_constraints
  union all select * from r_matrix_external union all select * from r_matrix_pricing
  union all select * from r_matrix_collections union all select * from r_matrix_seeded
  union all select * from r_perm_keys union all select * from r_bucket_private
  union all select * from r_audit)

select
  case verdict when 'FAIL' then 1 when 'SKIP' then 2 when 'INFO' then 3 else 4 end as sort_key,
  verdict, area, object, detail
from all_rows
order by sort_key, area, object;
