-- ════════════════════════════════════════════════════════════════════════════
-- docs/kian_ai_assistant_ROLLBACK.sql                           🚨 طوارئ فقط 🚨
--
-- ██ اقرأ هذا كاملًا قبل أن تنسخ سطرًا واحدًا ████████████████████████████████
--
-- حزمة «مساعد كيان» **وحدة قائمة بذاتها**: كلّ جداولها جديدة (ai_*)، ولم تعدّل
-- عمودًا ولا قيدًا ولا سياسة في أيّ وحدة أخرى، ولم تنشئ مفتاحًا أجنبيًّا نحو
-- المشاريع ولا العملاء ولا الفرص. لذلك التراجع هنا **لا يمسّ شيئًا خارجها**.
--
-- ─── ما يستعيده هذا الملفّ بلا خسارة صفّ واحد ──────────────────────────────
--   القسم ١: الدوالّ  → تختفي الواجهة كاملًا: لا سؤال، ولا استرجاع، ولا سطح
--                        عامّ، ولا اعتماد مصدر. الجداول تبقى سجلًّا خاملًا.
--   القسم ٢: السياسات → تُحذَف سياسات القراءة (وسياسات سلّة ai-knowledge).
--   القسم ٣: المنح    → تُسحَب القراءة من authenticated. لا أحد يرى شيئًا.
--   ⚠️ ترتيب ١ ← ٢ ← ٣ مقصود: سياسات القراءة مكتوبة فوق دوالّ البوّابة، وحذف
--      الدالّة قبل السياسة يجعل كلّ SELECT على الجدول يرمي «الدالّة غير
--      موجودة» بدل أن يمنع بهدوء. ومع ذلك **شغّل الثلاثة معًا**: القسم ٣ هو
--      الذي يغلق الباب فعلًا، والقسمان ١ و٢ وحدهما يتركان جدولًا ممنوحًا بلا
--      سياسة — وهذا أسوأ من البداية.
--
-- ─── ⚠️ ما يُتلف بيانات حقيقية ولا يُسترجَع (معطَّل بالتعليق) ───────────────
--   القسم ٤:
--     • drop table ai_knowledge_sources
--       ⇒ ✂️ يُمحى **سجلّ المعرفة المعتمَد كلّه**: نصّ كلّ سياسة وإجراء
--         وكتالوج خدمات كُتب ورُوجع واعتُمد بشريًّا، ومعه بصمة المحتوى وتاريخ
--         الاعتماد ومن اعتمده. هذا عمل تحريريّ بشريّ لا نسخة منه في مكان آخر،
--         وإعادة بنائه تعني إعادة كتابته من الصفر.
--     • drop table ai_source_revisions
--       ⇒ ✂️ يُمحى **تاريخ الاعتمادات**: أيّ نسخة كانت معتمَدة ومتى وبأيّ
--         بصمة. هذا هو الجواب الوحيد على سؤال «ما الذي كان معتمَدًا يوم قال
--         المساعد كذا؟».
--     • drop table ai_conversations / ai_messages / ai_message_citations
--       ⇒ ✂️ يُمحى **ما سُئل وما أُجيب وبأيّ مرجع**. عند أيّ نزاع أو مراجعة
--         حوكمة، هذه السلسلة هي الرواية الوحيدة الموثَّقة زمنيًّا. وحذفها
--         ليس «حذف بيانات شخصية» — لذلك مسار موجود بالفعل: ai_conversation_redact
--         و ai_conversation_delete و ai_retention_purge_due. استعملها بدل هذا.
--     • drop table ai_lead_drafts
--       ⇒ ✂️ تُمحى **طلبات عملاء محتملين لم يراجعها إنسان بعد**. كلّ صفّ فيه
--         شخص ينتظر ردًّا. الحذف هنا خسارة تجارية مباشرة لا مجرّد خسارة سجلّ.
--     • drop table ai_abuse_log
--       ⇒ ✂️ يُمحى **الدليل الوحيد على محاولات الحقن وتخمين الحدود والإساءة**
--         من السطح العامّ. بعده يصير سؤال «هل هوجمنا؟» بلا جواب إلى الأبد.
--     • drop table ai_provider_log
--       ⇒ ✂️ يُمحى **إثبات أنّ عدد النداءات الخارجية = صفر**. هذا السجلّ هو
--         الدليل القابل للتدقيق على أنّ المساعد لم يتّصل بمزوّد قطّ. حذفه
--         يُسقط قدرتك على إثبات ذلك لاحقًا.
--     • drop table ai_audit
--       ⇒ ✂️ يُمحى **من اعتمد أيّ مصدر، ومن نقّح أيّ محادثة، ومن غيّر
--         الإعدادات**. سجلّ مسؤولية لا سجلّ تشخيص.
--     • drop table ai_role_gate_map / ai_role_source_access
--       ⇒ ✂️ تُمحى **مصفوفة «من يقرأ ماذا»** بعد ضبطها يدويًّا. إعادة
--         التشغيل تعيد البذور الافتراضية لا تخصيصك.
--
--   القسم ٥ (معطَّل · الكتالوج المشترك):
--     • حذف مفاتيح ai.* من public.permissions
--       ⇒ ✂️ يُسقط الإسنادات المبنية عليها في **جداول الصلاحيات المشتركة**
--         المشتركة مع وحدات أخرى. لا تفعل هذا إلّا بقرار صريح مكتوب.
--
--   القسم ٦ (معطَّل · التخزين):
--     • حذف سلّة ai-knowledge
--       ⇒ ✂️ تُمحى المرفقات المرجعية. النصّ المفهرَس في content_text يُمحى
--         بالقسم ٤ لا هنا، لكنّ حذف السلّة يمنع الرجوع إلى الأصل الموقَّع.
--
-- ─── الطريق الصحيح في ٩٩٪ من الحالات ──────────────────────────────────────
-- لا تحذف شيئًا. شغّل الأقسام ١ و٢ و٣ فقط: تختفي الوحدة من الوجود عمليًّا،
-- ويبقى كلّ صفّ. وإن كان المطلوب «إطفاء المساعد» لا إزالته، فلا تشغّل هذا
-- الملفّ أصلًا:
--     select public.ai_settings_update('{"assistant_enabled":false,
--            "public_assistant_enabled":false,"public_lead_enabled":false}'::jsonb);
-- إطفاء بصفّ واحد، قابل للعكس، ولا يفقد شيئًا. هذا هو التراجع المطلوب عادةً.
--
-- ⚠️ قبل أيّ قسم اختياريّ: خُذ نسخة احتياطية **وتحقّق منها بالاستعادة**. لا
--    يوجد «تراجع عن التراجع» في هذا الملفّ.
-- ⚠️ لا يوجد في هذا الملفّ أيّ سطر يمسّ public.projects أو project_core أو
--    deliverables أو clients أو opportunity_requests أو أيّ جدول من الوحدات
--    الاثنتي عشرة المكتملة. لو رأيت اسم أحدها هنا فالملفّ عُدِّل — توقّف.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ١ — الدوالّ (آمن · بلا فقدان صفوف)
--   الترتيب من الأعلى إلى الأدنى: المستهلِك قبل المُستهلَك، كي لا يبقى نداء
--   معلَّق في منتصف الحذف.
-- ════════════════════════════════════════════════════════════════════════════

-- ١-أ) نداءات القراءة للواجهة
drop function if exists public.ai_admin_overview();
drop function if exists public.ai_lead_list(text,int);
drop function if exists public.ai_conversation_messages(uuid);
drop function if exists public.ai_conversation_list(int);
drop function if exists public.ai_knowledge_list(text,text);
drop function if exists public.ai_assistant_state();

-- ١-ب) الإعدادات والمراجعة والاحتفاظ
drop function if exists public.ai_settings_update(jsonb);
drop function if exists public.ai_lead_review(uuid,text,text);
drop function if exists public.ai_conversation_escalate(uuid,text);
drop function if exists public.ai_retention_purge_due();
drop function if exists public.ai_conversation_delete(uuid,text);
drop function if exists public.ai_conversation_redact(uuid,text);

-- ١-ج) إدارة سجلّ المعرفة
drop function if exists public.ai_sources_expire_due();
drop function if exists public.ai_source_archive(uuid);
drop function if exists public.ai_source_reject(uuid,text);
drop function if exists public.ai_source_approve(uuid);
drop function if exists public.ai_source_submit(uuid);
drop function if exists public.ai_source_upsert(jsonb);
drop function if exists public.ai_source_reindex(uuid);

-- ١-د) السطح العامّ — يُحذف مبكّرًا: أوّل ما يجب أن يختفي هو ما يصله مجهول.
drop function if exists public.ai_public_lead_draft(jsonb,text,text,text,text);
drop function if exists public.ai_public_ask(text,text);
drop function if exists public.ai_captcha_verify(text);
drop function if exists public.ai_rate_take(text,int,interval);

-- ١-هـ) المحادثة والإجابة
drop function if exists public.ai_ask(text,uuid);
drop function if exists public.ai_message_add(uuid,text,text,text,int,jsonb,text,text);
drop function if exists public.ai_conversation_start(text,text);

-- ١-و) واجهة المزوّد
drop function if exists public.ai_provider_probe(int,int);
drop function if exists public.ai_provider_describe();
drop function if exists public.ai_provider_notice();

-- ١-ز) الاسترجاع والرؤية — بعد كلّ مستهلكيها
drop function if exists public.ai_search_sources(text,text[],int);
drop function if exists public.ai_source_is_permitted(uuid);
drop function if exists public.ai_source_permitted_for(text,text,text[],text,date,date,timestamptz,text[]);
drop function if exists public.ai_sensitivity_rank(text);

-- ١-ح) أمن المحتوى
drop function if exists public.ai_checksum(text);
drop function if exists public.ai_forbidden_content(text);
drop function if exists public.ai_guard_question(text);
drop function if exists public.ai_detect_injection(text);
drop function if exists public.ai_neutralize(text);

-- ١-ط) البوّابات والتدقيق — آخر ما يُحذف
drop function if exists public.ai_log(text,text,uuid,boolean,jsonb);
drop function if exists public.ai_can_manage_settings();
drop function if exists public.ai_can_review_leads();
drop function if exists public.ai_can_redact();
drop function if exists public.ai_can_view_all_conversations();
drop function if exists public.ai_can_approve_knowledge();
drop function if exists public.ai_can_manage_knowledge();
drop function if exists public.ai_can_view_knowledge();
drop function if exists public.ai_can_use_internal();
drop function if exists public.ai_settings_row();
drop function if exists public.ai_actor_roles();
drop function if exists public.ai_is_staff();
drop function if exists public.ai_is_owner();
drop function if exists public.ai_perm(text);
drop function if exists public.ai_gate(text);

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٢ — السياسات (آمن · بلا فقدان صفوف)
--   ⚠️ تُحذَف **بعد** الدوالّ لأنّها مكتوبة فوقها. وRLS يبقى مفعّلًا على كلّ
--      جدول: جدول بـRLS مفعّل وبلا سياسة = لا أحد يقرأ. هذا هو السلوك المطلوب.
-- ════════════════════════════════════════════════════════════════════════════
do $r2$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public' and tablename like 'ai\_%'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $r2$;

-- سياسات سلّة المعرفة على storage.objects — باسمها وحدها، ولا تُلمس سياسة غيرها.
do $r2b$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists ai_knowledge_objects_read   on storage.objects';
    execute 'drop policy if exists ai_knowledge_objects_write  on storage.objects';
    execute 'drop policy if exists ai_knowledge_objects_delete on storage.objects';
  end if;
end $r2b$;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٣ — المنح (آمن · بلا فقدان صفوف)
--   يُسحب كلّ ما مُنح. ولا يُمنح anon شيء هنا ولا في أيّ موضع — ولم يُمنح قطّ.
-- ════════════════════════════════════════════════════════════════════════════
do $r3$
declare t text;
begin
  foreach t in array array[
    'ai_settings','ai_role_gate_map','ai_role_source_access','ai_knowledge_sources',
    'ai_source_revisions','ai_source_chunks','ai_conversations','ai_messages',
    'ai_message_citations','ai_lead_drafts','ai_public_rate_limits','ai_abuse_log',
    'ai_provider_log','ai_audit']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from authenticated', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('revoke all on public.%I from public', t);
    end if;
  end loop;
end $r3$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ انتهى التراجع الآمن. الوحدة صارت غير موجودة عمليًّا وكلّ صفّ في مكانه.
--    تحقّق: يجب أن تعود الاستعلامات التالية بصفر.
--      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname like 'ai\_%';
--      select count(*) from pg_policies where schemaname='public' and tablename like 'ai\_%';
--      select count(*) from information_schema.role_table_grants
--       where table_schema='public' and table_name like 'ai\_%';
-- ════════════════════════════════════════════════════════════════════════════


-- ████████████████████████████████████████████████████████████████████████████
-- ⛔ ما تحت هذا السطر **معطَّل بالتعليق عمدًا**. لا تفكّ التعليق إلّا بقرار
--    مكتوب من المالك بعد نسخة احتياطية مُختبَرة بالاستعادة. كلّ سطر هنا يمحو
--    بيانات لا نسخة منها في أيّ مكان آخر في النظام.
-- ████████████████████████████████████████████████████████████████████████████

-- ─── القسم ٤ — حذف الجداول (✂️ فقدان دائم) ─────────────────────────────────
-- begin;
-- -- الترتيب يحترم المفاتيح الأجنبية: الأبناء أوّلًا.
-- drop table if exists public.ai_message_citations;
-- drop table if exists public.ai_messages;
-- drop table if exists public.ai_conversations;      -- ai_lead_drafts يشير إليه بـon delete set null
-- drop table if exists public.ai_source_chunks;
-- drop table if exists public.ai_source_revisions;
-- drop table if exists public.ai_knowledge_sources;  -- ai_message_citations يشير إليه بـon delete restrict
-- drop table if exists public.ai_lead_drafts;
-- drop table if exists public.ai_public_rate_limits;
-- drop table if exists public.ai_abuse_log;
-- drop table if exists public.ai_provider_log;
-- drop table if exists public.ai_audit;
-- drop table if exists public.ai_role_source_access;
-- drop table if exists public.ai_role_gate_map;
-- drop table if exists public.ai_settings;
-- commit;

-- ─── القسم ٥ — مفاتيح الصلاحيات في الكتالوج المشترك (✂️ يمسّ وحدات أخرى) ───
-- begin;
-- delete from public.permissions where key in (
--   'ai.knowledge.view','ai.knowledge.manage','ai.knowledge.approve',
--   'ai.conversation.view_all','ai.conversation.redact','ai.lead.review');
-- commit;

-- ─── القسم ٦ — سلّة التخزين (✂️ فقدان المرفقات المرجعية) ────────────────────
-- begin;
-- delete from storage.objects where bucket_id = 'ai-knowledge';
-- delete from storage.buckets where id = 'ai-knowledge';
-- commit;
