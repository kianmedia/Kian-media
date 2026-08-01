-- ════════════════════════════════════════════════════════════════════════════
-- docs/kian_ai_assistant_RUNME.sql
-- المرحلة C — أساس «مساعد كيان»: سجلّ معرفة معتمَد · استرجاع مقيَّد بالصلاحية ·
-- إجابات مُسنَدة بمراجع · تسليم بشريّ · تدقيق كامل — **ولا ينفّذ شيئًا**.
--
-- معاملة واحدة · idempotent · لا CONCURRENTLY · لا صلاحية anon على أيّ كائن ·
-- كلّ دالّة SECURITY DEFINER بـsearch_path مثبَّت · كلّ مُسنَد يعيد boolean
-- صريحًا ولا يعيد NULL أبدًا.
--
-- ═══ ★ ما هذه الحزمة، وما ليست ★ ═════════════════════════════════════════
--   هي: سجلّ مصادر معرفة يمرّ باعتماد بشريّ · محرّك استرجاع نصّيّ داخل
--   PostgreSQL · بوّابة صلاحيات لكلّ نتيجة · مُسنَدات (citations) إجبارية ·
--   محادثات مُدقَّقة بسياسة احتفاظ وحذف · مسوّدة عميل محتمَل من السطح العامّ ·
--   **واجهة** مزوّد نموذج لا أكثر.
--   ليست: نموذجًا لغويًّا · ولا نداءً خارجيًّا · ولا تنفيذًا لأدوات · ولا
--   توليدًا لـSQL يُنفَّذ · ولا مرسِلًا لبريد أو واتساب · ولا مُنشئًا لمشروع أو
--   عرض سعر أو التزام بسعر.
--
-- ⛔ المزوّد **غير مضبوط** في هذه الحزمة: ai_settings.provider_enabled = false
--    وprovider_name = 'mock'، وردّ المزوّد الوحيد الممكن هو النصّ الصريح
--    «مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط». لا يوجد في هذا الملفّ
--    ولا في طبقة الخادم أيّ اعتماد ولا مفتاح ولا عنوان مزوّد.
--
-- ═══ ★ قرار «أعِد الاستخدام» مقابل «أنشئ» ★ ═══════════════════════════════
-- ▸ أُعيد استخدامه ولم يُكرَّر:
--   • public.is_staff() / is_owner() — تعريف الهوية الوحيد.
--   • public.permissions + emp_has_permission(text) — كتالوج الصلاحيات
--     المشترك. مفاتيح المساعد **صفوف بيانات** فيه، لا محرّك صلاحيات ثانٍ.
--   • بوّابات الموديولات القائمة (can_see_opportunities / can_manage_quotes /
--     can_manage_projects / can_manage_custody / can_see_invoices /
--     can_view_case_studies_internal …) — تُقرأ عبر خريطة صريحة قابلة للتدقيق
--     (ai_role_gate_map) وتُنادى بأمان: البوّابة الغائبة **لا تمنح** أبدًا.
--   • sha256 من نواة PostgreSQL — البصمة، لا مكتبة تجزئة جديدة.
-- ▸ أُنشئ لأنّه بلا مقابل في المستودع:
--   • ai_knowledge_sources / ai_source_chunks — لا يوجد سجلّ معرفة ولا فهرس
--     نصّيّ في النظام كلّه.
--   • ai_conversations / ai_messages / ai_message_citations — لا يوجد نموذج
--     محادثة مُسنَدة بمراجع.
--   • ai_lead_drafts — **مسوّدة** فقط. طلبات الموقع العامّة تبقى في
--     opportunity_requests / public_intake ولم تُلمَس: هذا سطح ثالث مصدره
--     محادثة عامّة، وحالته «بانتظار مراجعة بشرية» ولا يتحوّل إلى شيء تلقائيًّا.
--   • ai_provider_log — إثبات قابل للقراءة أنّ عدد النداءات الخارجية = صفر.
-- ⛔ ما لم يُنشأ عمدًا: لا كتالوج صلاحيات ثانٍ · لا جدول هوية ثانٍ · لا طابور
--    بريد · لا جدول عملاء ثانٍ · ولا أيّ منح لدور anon.
--
-- ═══ ★ القاعدة التي يقوم عليها أمن هذا الملفّ ★ ═══════════════════════════
--   **المحتوى المسترجَع بيانات، لا تعليمات.** لا يوجد في هذه الحزمة موضع
--   واحد يُدمَج فيه نصّ مصدر أو سؤال مستخدم داخل سياق تنفيذيّ:
--     • لا EXECUTE يستقبل نصًّا من المستخدم أو من مصدر معرفة إطلاقًا. الموضع
--       الوحيد الذي يستعمل EXECUTE (ai_gate) يبني النداء من **كتالوج
--       PostgreSQL** عبر format('%I.%I()') بعد التحقّق من to_regprocedure ومن
--       أنّ نوع الإرجاع boolean وعدد الوسائط صفر.
--     • النصّ المسترجَع يُعاد في حقل `evidence` مع العلم الصريح
--       is_data_not_instructions=true، ويمرّ أوّلًا بـai_neutralize التي تُبطل
--       الوسوم والروابط الموقَّعة وعلامات التعليمات.
--     • السؤال يمرّ بـai_guard_question قبل أيّ استرجاع، والمنع **يسبق**
--       الاسترجاع بنيويًّا: عند المنع تعود الدالّة قبل الوصول إلى
--       ai_search_sources، فيكون retrieved_count = 0 ولا يُقرأ مصدر واحد.
--     • ترشيح الصلاحية مطبَّق **مرّتين**: في سياسة RLS للقراءة، ومرّة ثانية
--       داخل شرط WHERE في محرّك الاسترجاع نفسه.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT صلب: يوقف التشغيل قبل كتابة حرف واحد ─────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('auth.users') is null then miss := miss || ' auth.users'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' public.is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' public.is_owner()'; end if;

  -- نوع الإرجاع يُفحَص أيضًا: بوّابة تعيد غير boolean تُنتج سياسات معناها
  -- «غير محدَّد»، وغير المحدَّد ليس منعًا.
  if to_regprocedure('public.is_staff()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.is_staff()'))
  then miss := miss || ' is_staff()=غير-boolean'; end if;
  if to_regprocedure('public.is_owner()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.is_owner()'))
  then miss := miss || ' is_owner()=غير-boolean'; end if;

  -- البصمة تُخزَّن لكلّ مصدر معتمَد. غيابها يعني اعتمادًا بلا دليل على المحتوى.
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then miss := miss || ' sha256(bytea)'; end if;
  -- websearch_to_tsquery لا يرمي استثناءً على مدخل غريب — وهذا مقصود: سؤال
  -- المستخدم يصل إليه كما هو، فلو كان يرمي لصار المدخل الغريب طريق تعطيل.
  if to_regprocedure('pg_catalog.websearch_to_tsquery(regconfig,text)') is null
    then miss := miss || ' websearch_to_tsquery(regconfig,text)'; end if;
  if to_regprocedure('pg_catalog.gen_random_uuid()') is null then miss := miss || ' gen_random_uuid()'; end if;

  if miss <> '' then
    raise exception 'PREFLIGHT فشل — متطلّبات غائبة:%. لا تُشغّل هذه الحزمة قبل توفّرها.', miss;
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) الإعدادات — صفّ واحد، والمزوّد مطفأ
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_settings (
  id boolean primary key default true,
  assistant_enabled boolean not null default true,
  provider_name text not null default 'mock',
  provider_enabled boolean not null default false,
  provider_timeout_ms int not null default 15000,
  public_assistant_enabled boolean not null default true,
  public_lead_enabled boolean not null default true,
  captcha_required boolean not null default false,
  captcha_provider text,
  public_ip_hourly_limit int not null default 10,
  public_ip_daily_limit int not null default 30,
  public_global_daily_limit int not null default 500,
  max_question_chars int not null default 1000,
  max_excerpt_chars int not null default 700,
  max_results int not null default 5,
  retention_days_internal int not null default 365,
  retention_days_public int not null default 90,
  privacy_notice_version text not null default 'v1',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_settings_single_row') then
    alter table public.ai_settings add constraint ai_settings_single_row check (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_settings_limits_positive') then
    alter table public.ai_settings add constraint ai_settings_limits_positive check (
      public_ip_hourly_limit between 0 and 1000
      and public_ip_daily_limit between 0 and 5000
      and public_global_daily_limit between 0 and 100000
      and max_question_chars between 20 and 4000
      and max_excerpt_chars between 100 and 4000
      and max_results between 1 and 20
      and retention_days_internal between 7 and 3650
      and retention_days_public between 1 and 3650
      and provider_timeout_ms between 1000 and 120000
    );
  end if;
end $c$;

insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) خريطة الأدوار — **بيانات صريحة قابلة للقراءة والتدقيق**، لا شيفرة مخفيّة
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_role_gate_map (
  assistant_role text not null,
  gate_signature text not null,
  requires_staff boolean not null default true,
  note text,
  primary key (assistant_role, gate_signature)
);

create table if not exists public.ai_role_source_access (
  assistant_role text not null,
  source_type text not null,
  max_sensitivity text not null default 'public',
  note text,
  primary key (assistant_role, source_type)
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_role_gate_map_role_known') then
    alter table public.ai_role_gate_map add constraint ai_role_gate_map_role_known check (
      assistant_role in ('owner','sales','operations','collections','marketing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_role_gate_map_signature_shape') then
    -- توقيع دالّة بلا وسائط فقط. أيّ شكل آخر يُرفض عند الكتابة لا عند النداء.
    alter table public.ai_role_gate_map add constraint ai_role_gate_map_signature_shape check (
      gate_signature ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\(\)$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_role_source_access_role_known') then
    alter table public.ai_role_source_access add constraint ai_role_source_access_role_known check (
      assistant_role in ('owner','sales','operations','collections','marketing','client','anonymous'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_role_source_access_sensitivity') then
    alter table public.ai_role_source_access add constraint ai_role_source_access_sensitivity check (
      max_sensitivity in ('public','internal','restricted'));
  end if;
  -- ★ العميل والزائر لا يبلغان الداخليّ أبدًا — قيد جدوليّ لا عُرف.
  if not exists (select 1 from pg_constraint where conname = 'ai_role_source_access_external_public_only') then
    alter table public.ai_role_source_access add constraint ai_role_source_access_external_public_only check (
      assistant_role not in ('client','anonymous') or max_sensitivity = 'public');
  end if;
end $c$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) سجلّ المعرفة
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  title_ar text not null,
  title_en text not null default '',
  language text not null default 'ar',
  status text not null default 'draft',
  sensitivity text not null default 'internal',
  allowed_roles text[] not null default array['owner']::text[],
  content_kind text not null default 'inline',
  content_text text,
  storage_bucket text,
  storage_path text,
  source_url text,
  version int not null default 1,
  checksum text,
  effective_from date,
  expires_at date,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_type_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_type_known check (source_type in (
      'public_website','service_catalog','faq','company_policy','operations_procedure',
      'sales_guide','pricing_guidance','compliance_guide','equipment_procedure','hr_policy',
      'approved_case_study','approved_template','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_status_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_status_known check (
      status in ('draft','in_review','approved','rejected','expired','archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_sensitivity_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_sensitivity_known check (
      sensitivity in ('public','internal','restricted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_language_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_language_known check (
      language in ('ar','en','both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_content_kind_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_content_kind_known check (
      content_kind in ('inline','storage','url'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_roles_known') then
    alter table public.ai_knowledge_sources add constraint ai_sources_roles_known check (
      allowed_roles <@ array['owner','sales','operations','collections','marketing','client','anonymous']::text[]
      and coalesce(array_length(allowed_roles, 1), 0) >= 1);
  end if;
  -- ★ سطح خارجيّ ⇒ حسّاسية عامّة فقط. قيد جدوليّ يجعل تسريب الداخليّ إلى
  --   الزائر أو العميل مستحيلًا حتى بـINSERT مباشر بمفتاح الخدمة.
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_external_public_only') then
    alter table public.ai_knowledge_sources add constraint ai_sources_external_public_only check (
      not (allowed_roles && array['client','anonymous']::text[]) or sensitivity = 'public');
  end if;
  -- ★ المقيَّد للمالك وحده.
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_restricted_owner_only') then
    alter table public.ai_knowledge_sources add constraint ai_sources_restricted_owner_only check (
      sensitivity <> 'restricted' or allowed_roles <@ array['owner']::text[]);
  end if;
  -- ★ الاعتماد ليس تبديل حالة: نصّ + بصمة + معتمِد + وقت، وإلّا لا يمرّ.
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_approved_is_complete') then
    alter table public.ai_knowledge_sources add constraint ai_sources_approved_is_complete check (
      status <> 'approved'
      or (approved_by is not null and approved_at is not null
          and checksum is not null and length(coalesce(content_text, '')) >= 20));
  end if;
  -- ★ المعتمِد ≠ المُقدِّم. مبدأ مأخوذ حرفيًّا من قيد توثيق الوثائق القائم.
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_approver_not_submitter') then
    alter table public.ai_knowledge_sources add constraint ai_sources_approver_not_submitter check (
      approved_by is null or submitted_by is null or approved_by <> submitted_by);
  end if;
  -- ★ التخزين مقيَّد بسلّة واحدة وبنمط مسار — درس مركز الامتثال حرفيًّا: مسار
  --   حرّ في صفّ «معرفة» يصير أوراكل قراءة عابرًا لكلّ السلال.
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_storage_is_pinned') then
    alter table public.ai_knowledge_sources add constraint ai_sources_storage_is_pinned check (
      (storage_bucket is null and storage_path is null)
      or (storage_bucket = 'ai-knowledge'
          and storage_path ~ '^sources/[0-9a-fA-F-]{36}/[^/].*$'
          and storage_path !~ '\.\.'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_url_is_https') then
    alter table public.ai_knowledge_sources add constraint ai_sources_url_is_https check (
      source_url is null or source_url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_dates_sane') then
    alter table public.ai_knowledge_sources add constraint ai_sources_dates_sane check (
      effective_from is null or expires_at is null or expires_at >= effective_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_sources_version_positive') then
    alter table public.ai_knowledge_sources add constraint ai_sources_version_positive check (version >= 1);
  end if;
end $c$;

create index if not exists ai_sources_status_idx on public.ai_knowledge_sources (status);
create index if not exists ai_sources_type_idx on public.ai_knowledge_sources (source_type);
create index if not exists ai_sources_sensitivity_idx on public.ai_knowledge_sources (sensitivity);

-- تاريخ النسخ: الاعتماد السابق يبقى مقروءًا بعد التعديل.
create table if not exists public.ai_source_revisions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.ai_knowledge_sources(id) on delete cascade,
  version int not null,
  status text not null,
  checksum text,
  content_length int not null default 0,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  change_note text
);
create index if not exists ai_source_revisions_source_idx on public.ai_source_revisions (source_id, version desc);

-- الفهرس النصّيّ. لا مزوّد تضمين خارجيّ ولا واجهة متجهات وهمية: بحث
-- PostgreSQL النصّيّ الكامل بضبط 'simple' (يعمل على العربية والإنجليزية معًا).
create table if not exists public.ai_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.ai_knowledge_sources(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  source_version int not null default 1,
  created_at timestamptz not null default now(),
  search_vec tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  unique (source_id, chunk_index)
);
create index if not exists ai_source_chunks_vec_idx on public.ai_source_chunks using gin (search_vec);
create index if not exists ai_source_chunks_source_idx on public.ai_source_chunks (source_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) المحادثات والرسائل والمُسنَدات
--    ⛔ لا عمود لسلسلة التفكير ولا للسياق الداخليّ ولا لنصّ النظام. الأعمدة
--       المسموح بها هنا هي كلّ ما يُخزَّن، وPOSTCHECK يفحص ذلك بنيويًّا.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_kind text not null default 'internal',
  actor_roles text[] not null default '{}'::text[],
  role_snapshot jsonb not null default '{}'::jsonb,
  channel text not null default 'internal',
  title text,
  retention_class text not null default 'standard',
  redaction_status text not null default 'none',
  escalation_status text not null default 'none',
  escalated_to uuid,
  escalated_at timestamptz,
  escalation_note text,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  expires_at timestamptz,
  purged_at timestamptz
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  seq int not null,
  role text not null,
  content text not null,
  refusal_code text,
  retrieved_count int not null default 0,
  guard_verdict jsonb not null default '{}'::jsonb,
  provider_status text not null default 'not_configured',
  confidence text,
  redaction_status text not null default 'none',
  redacted_at timestamptz,
  redacted_by uuid,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create table if not exists public.ai_message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  source_id uuid not null references public.ai_knowledge_sources(id) on delete restrict,
  source_version int not null,
  source_title text not null,
  source_type text not null,
  chunk_index int,
  freshness_days int,
  rank real,
  created_at timestamptz not null default now()
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_actor_kind_known') then
    alter table public.ai_conversations add constraint ai_conversations_actor_kind_known check (
      actor_kind in ('internal','public'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_channel_known') then
    alter table public.ai_conversations add constraint ai_conversations_channel_known check (
      channel in ('internal','public'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_retention_known') then
    alter table public.ai_conversations add constraint ai_conversations_retention_known check (
      retention_class in ('minimal','standard','extended'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_redaction_known') then
    alter table public.ai_conversations add constraint ai_conversations_redaction_known check (
      redaction_status in ('none','partial','redacted','purged'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_escalation_known') then
    alter table public.ai_conversations add constraint ai_conversations_escalation_known check (
      escalation_status in ('none','requested','assigned','resolved'));
  end if;
  -- ★ المحادثة العامّة بلا هوية مستخدم — بيانات شخصية أقلّ بحكم القيد.
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_public_has_no_user') then
    alter table public.ai_conversations add constraint ai_conversations_public_has_no_user check (
      actor_kind <> 'public' or actor_user_id is null);
  end if;
  -- ★ الأدوار المخزَّنة لقطة، والمجموعة معروفة.
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_roles_known') then
    alter table public.ai_conversations add constraint ai_conversations_roles_known check (
      actor_roles <@ array['owner','sales','operations','collections','marketing','client','anonymous']::text[]);
  end if;
  -- ★ الأدوار الثلاثة وحدها. 'thought' و'reasoning' و'system_prompt' ليست
  --   قيمًا ممكنة، فلا يمكن تخزين سلسلة تفكير حتى بكتابة مباشرة.
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_role_known') then
    alter table public.ai_messages add constraint ai_messages_role_known check (
      role in ('user','assistant','system_notice'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_provider_status_known') then
    alter table public.ai_messages add constraint ai_messages_provider_status_known check (
      provider_status in ('not_configured','disabled','mock','error','timeout','invalid_response'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_confidence_known') then
    alter table public.ai_messages add constraint ai_messages_confidence_known check (
      confidence is null or confidence in ('none','low','medium','high'));
  end if;
  -- ★ إجابة مساعد بلا مصادر يجب أن تكون رفضًا مُعلَّلًا برمز — لا نصّ حرّ.
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_grounded_or_refusal') then
    alter table public.ai_messages add constraint ai_messages_grounded_or_refusal check (
      role <> 'assistant' or retrieved_count > 0 or refusal_code is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_retrieved_count_sane') then
    alter table public.ai_messages add constraint ai_messages_retrieved_count_sane check (retrieved_count >= 0);
  end if;
end $c$;

create index if not exists ai_conversations_actor_idx on public.ai_conversations (actor_user_id, created_at desc);
create index if not exists ai_conversations_expiry_idx on public.ai_conversations (expires_at) where purged_at is null;
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, seq);
create index if not exists ai_message_citations_message_idx on public.ai_message_citations (message_id);
create index if not exists ai_message_citations_source_idx on public.ai_message_citations (source_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) السطح العامّ — مسوّدة عميل محتمَل · حدود · إساءة · بصمة تحقّق
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_lead_drafts (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text,
  phone text,
  company text,
  service_interest text,
  message text not null default '',
  locale text not null default 'ar',
  status text not null default 'pending_human_review',
  handoff_status text not null default 'awaiting_human',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  idempotency_key text unique,
  ip_hash text,
  user_agent_hash text,
  captcha_status text not null default 'not_configured',
  source text not null default 'public_assistant',
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  privacy_notice_version text not null default 'v1',
  created_at timestamptz not null default now()
);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_status_known') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_status_known check (
      status in ('pending_human_review','accepted','rejected','spam'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_handoff_known') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_handoff_known check (
      handoff_status in ('awaiting_human','in_progress','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_captcha_known') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_captcha_known check (
      captcha_status in ('not_configured','not_required','verified','failed'));
  end if;
  -- ★ حدود حجم صريحة: سطح عامّ لا يقبل نصًّا غير محدود.
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_field_caps') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_field_caps check (
      length(coalesce(full_name, '')) <= 120
      and length(coalesce(email, '')) <= 160
      and length(coalesce(phone, '')) <= 40
      and length(coalesce(company, '')) <= 160
      and length(coalesce(service_interest, '')) <= 120
      and length(coalesce(message, '')) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_has_a_contact') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_has_a_contact check (
      coalesce(email, '') <> '' or coalesce(phone, '') <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_lead_drafts_email_shape') then
    alter table public.ai_lead_drafts add constraint ai_lead_drafts_email_shape check (
      email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$');
  end if;
end $c$;

create index if not exists ai_lead_drafts_status_idx on public.ai_lead_drafts (status, created_at desc);

create table if not exists public.ai_public_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket_key, window_start)
);
create index if not exists ai_public_rate_limits_window_idx on public.ai_public_rate_limits (window_start);

create table if not exists public.ai_abuse_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  surface text not null,
  reason text not null,
  ip_hash text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists ai_abuse_log_time_idx on public.ai_abuse_log (occurred_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) سجلّ المزوّد والتدقيق
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ai_provider_log (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  provider text not null default 'mock',
  status text not null default 'not_configured',
  -- ⛔ لا نصّ سؤال ولا نصّ إجابة ولا سياق هنا: **الشكل فقط** (أطوال وأعداد).
  request_shape jsonb not null default '{}'::jsonb,
  response_shape jsonb not null default '{}'::jsonb,
  latency_ms int,
  cost_metadata jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists ai_provider_log_time_idx on public.ai_provider_log (requested_at desc);

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_provider_log_status_known') then
    alter table public.ai_provider_log add constraint ai_provider_log_status_known check (
      status in ('not_configured','disabled','mock','timeout','invalid_response','error'));
  end if;
end $c$;

create table if not exists public.ai_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  entity text,
  entity_id uuid,
  success boolean not null default true,
  details jsonb not null default '{}'::jsonb
);
create index if not exists ai_audit_time_idx on public.ai_audit (at desc);
create index if not exists ai_audit_entity_idx on public.ai_audit (entity, entity_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) البوّابات — كلّ واحدة تعيد boolean صريحًا ولا تعيد NULL أبدًا
-- ════════════════════════════════════════════════════════════════════════════

-- ★ الموضع الوحيد في الحزمة الذي يستعمل EXECUTE. لا يستقبل نصًّا من مستخدم
--   ولا من مصدر معرفة: التوقيع يأتي من جدول لا يكتب فيه غير المالك، ويُتحقّق
--   منه عبر to_regprocedure، ثمّ **يُعاد بناء النداء من كتالوج PostgreSQL**
--   بـformat('%I.%I()')، فلا يمرّ حرف واحد من نصّ الجدول إلى المُنفَّذ.
create or replace function public.ai_gate(p_signature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_oid oid; v_nsp text; v_name text; v_ok boolean;
begin
  if p_signature is null or p_signature = '' then return false; end if;
  begin
    v_oid := to_regprocedure(p_signature);
  exception when others then return false; end;
  if v_oid is null then return false; end if;
  select n.nspname, p.proname into v_nsp, v_name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.oid = v_oid and p.prorettype = 'boolean'::regtype and p.pronargs = 0;
  if v_nsp is null or v_name is null then return false; end if;
  begin
    execute format('select %I.%I()', v_nsp, v_name) into v_ok;
  exception when others then return false; end;
  return coalesce(v_ok, false);
end $$;

-- مفتاح صلاحية من الكتالوج المشترك. غياب المُحلِّل **لا يمنح**.
create or replace function public.ai_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_key is null or p_key = '' then return false; end if;
  if to_regprocedure('public.emp_has_permission(text)') is null then return false; end if;
  begin
    execute 'select public.emp_has_permission($1)' into v using p_key;
  exception when others then return false; end;
  return coalesce(v, false);
end $$;

create or replace function public.ai_is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_gate('public.is_owner()'), false);
$$;

create or replace function public.ai_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_gate('public.is_staff()'), false);
$$;

-- ★ أدوار المتصل. لا عضوية مشروع في أيّ موضع — لا هنا ولا في الاسترجاع.
create or replace function public.ai_actor_roles()
returns text[] language plpgsql stable security definer set search_path = public as $$
declare v_roles text[] := '{}'::text[]; v_staff boolean; r record;
begin
  if auth.uid() is null then return array['anonymous']::text[]; end if;
  v_staff := coalesce(public.ai_is_staff(), false);
  for r in select assistant_role, gate_signature, requires_staff from public.ai_role_gate_map loop
    if r.requires_staff and not v_staff then continue; end if;
    if coalesce(public.ai_gate(r.gate_signature), false) and not (r.assistant_role = any(v_roles)) then
      v_roles := v_roles || r.assistant_role;
    end if;
  end loop;
  -- غير الموظّف = عميل مهما منحت البوّابات. الداخليّ لا يُشتقّ لغير الطاقم.
  if not v_staff and not ('owner' = any(v_roles)) then return array['client']::text[]; end if;
  return coalesce(v_roles, '{}'::text[]);
end $$;

create or replace function public.ai_settings_row()
returns public.ai_settings language sql stable security definer set search_path = public as $$
  select * from public.ai_settings where id limit 1;
$$;

create or replace function public.ai_can_use_internal()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_roles text[]; v_enabled boolean;
begin
  if auth.uid() is null then return false; end if;
  if not coalesce(public.ai_is_staff(), false) then return false; end if;
  select coalesce(assistant_enabled, false) into v_enabled from public.ai_settings where id;
  if not coalesce(v_enabled, false) then return false; end if;
  v_roles := coalesce(public.ai_actor_roles(), '{}'::text[]);
  return v_roles && array['owner','sales','operations','collections','marketing']::text[];
end $$;

create or replace function public.ai_can_view_knowledge()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.knowledge.view'), false));
$$;

create or replace function public.ai_can_manage_knowledge()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.knowledge.manage'), false));
$$;

create or replace function public.ai_can_approve_knowledge()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.knowledge.approve'), false));
$$;

create or replace function public.ai_can_view_all_conversations()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.conversation.view_all'), false));
$$;

create or replace function public.ai_can_redact()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.conversation.redact'), false));
$$;

create or replace function public.ai_can_review_leads()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false)
      or (coalesce(public.ai_is_staff(), false) and coalesce(public.ai_perm('ai.lead.review'), false));
$$;

-- الإعدادات للمالك وحده: تفعيل مزوّد نموذج قرار لا يُفوَّض بمفتاح.
create or replace function public.ai_can_manage_settings()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_is_owner(), false);
$$;

create or replace function public.ai_log(
  p_action text, p_entity text, p_entity_id uuid, p_success boolean, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_audit (action, entity, entity_id, success, details)
  values (p_action, p_entity, p_entity_id, coalesce(p_success, false), coalesce(p_details, '{}'::jsonb));
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٨) أمن المحتوى — تحييد · كشف حقن · حارس السؤال · ماسح الأسرار
-- ════════════════════════════════════════════════════════════════════════════

-- يبطل المحتوى المسترجَع كتعليمات: وسوم · محارف صفرية العرض · روابط موقَّعة ·
-- علامات أوامر. الأصل أنّ المحتوى بيانات؛ هذه طبقة دفاع ثانية لا أولى.
-- ملاحظة على التعبيرات النمطية: PostgreSQL لا يقبل الراية المضمَّنة (?i)، فكلّ
-- عدم-حساسية-الحالة هنا تُمرَّر عبر راية 'i' في regexp_replace أو المعامل ~*.
create or replace function public.ai_neutralize(p_text text)
returns text language sql immutable set search_path = public as $$
  select case when p_text is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(p_text, ''), '<[^>]*>', ' ', 'g'),
              E'[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', '', 'g'),
            '\((https?://[^)\s]*(token=|X-Amz-|/object/sign/|signature=)[^)\s]*)\)',
            '(رابط-موقَّع-محذوف)', 'gi'),
          'https?://[^\s]*(token=|X-Amz-|/object/sign/|signature=)[^\s]*', '[رابط-موقَّع-محذوف]', 'gi'),
        '(ignore[[:space:]]+(all[[:space:]]+|any[[:space:]]+)?((previous|prior|above|the)[[:space:]]+)?(instructions|rules|prompt)|disregard[[:space:]]+(the[[:space:]]+)?(system|previous)|you[[:space:]]+are[[:space:]]+now|developer[[:space:]]+mode|jailbreak|reveal[[:space:]]+(the[[:space:]]+)?(system[[:space:]]+)?prompt|begin[[:space:]]+system|</?(system|assistant|tool)>|^[[:space:]]*(system|assistant)[[:space:]]*:)',
        '[محتوى-محايَد]', 'gi'),
      '(تجاهل[[:space:]]+(كل[[:space:]]+|كلّ[[:space:]]+)?(التعليمات|ما[[:space:]]+سبق)|اكشف[[:space:]]+(عن[[:space:]]+)?(التعليمات|النظام)|أنت[[:space:]]+الآن)',
      '[محتوى-محايَد]', 'g')
  end;
$$;

create or replace function public.ai_detect_injection(p_text text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare t text := lower(coalesce(p_text, '')); hits text[] := '{}'::text[];
begin
  -- ‏t مُصغَّر الحالة أصلًا، فلا حاجة لأيّ راية عدم-حساسية (وهي غير مدعومة مضمَّنة).
  -- ★ المُحدِّد (previous/prior/…) **اختياريّ**: «ignore all instructions» بلا
  --   كلمة the كان يفلت من النمط الأوّل، وهو أشهر صيغة حقن على الإطلاق.
  if t ~ '(ignore|disregard|forget)[[:space:]]+(all[[:space:]]+|any[[:space:]]+)?((previous|prior|earlier|above|the)[[:space:]]+)?(instructions|rules|prompt|policy|what[[:space:]]+i[[:space:]]+said)'
     or t ~ 'تجاهل[[:space:]]+(كل|كلّ|جميع)?[[:space:]]*(التعليمات|الأوامر|القواعد|ما[[:space:]]+سبق)'
  then hits := hits || 'override_instructions'; end if;

  if t ~ '(system[[:space:]]*prompt|reveal[[:space:]]+(your|the)[[:space:]]+(prompt|instructions)|what[[:space:]]+are[[:space:]]+your[[:space:]]+instructions|repeat[[:space:]]+(the[[:space:]]+)?(system|initial)[[:space:]]+(prompt|message))'
     or t ~ '(اكشف|أظهر|اطبع)[[:space:]]*(لي)?[[:space:]]*(تعليمات|توجيهات)[[:space:]]*(النظام|نظامك)'
  then hits := hits || 'prompt_disclosure'; end if;

  if t ~ '(</?(system|assistant|tool|instructions)>|\[\[?system\]?\]|###[[:space:]]*system|begin[[:space:]]+system)'
  then hits := hits || 'role_marker'; end if;

  if t ~ '(you[[:space:]]+are[[:space:]]+now|act[[:space:]]+as[[:space:]]+(the[[:space:]]+)?(owner|admin|root|system)|pretend[[:space:]]+(to[[:space:]]+be|you)|developer[[:space:]]+mode|jailbreak|dan[[:space:]]+mode)'
     or t ~ '(تصرّف|تصرف)[[:space:]]+(ك|بصفتك)[[:space:]]*(المالك|المدير|النظام)'
  then hits := hits || 'impersonation'; end if;

  if t ~ '(bypass|override|disable|turn[[:space:]]+off)[[:space:]]+(the[[:space:]]+)?(permission|permissions|rls|security|policy|restrictions|guard)'
     or t ~ '(تجاوز|عطّل|ألغِ)[[:space:]]+(الصلاحيات|الصلاحية|الحماية|القيود)'
  then hits := hits || 'guard_bypass'; end if;

  return jsonb_build_object('flagged', coalesce(array_length(hits, 1), 0) > 0,
                            'patterns', to_jsonb(hits));
end $$;

-- ★ حارس السؤال. يُنادى **قبل** أيّ استرجاع، ونتيجته تحسم ما إذا كان
--   الاسترجاع سيقع أصلًا.
create or replace function public.ai_guard_question(p_question text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t text := lower(coalesce(p_question, ''));
  cats text[] := '{}'::text[];
  inj jsonb;
begin
  inj := public.ai_detect_injection(p_question);
  if coalesce((inj->>'flagged')::boolean, false) then cats := cats || 'prompt_injection'; end if;

  -- استخراج بيانات: رواتب · حسابات بنكية · هويات · تصدير جماعيّ · إرسال لجهة.
  if t ~ '(payroll|salaries|salary[[:space:]]+of|bank[[:space:]]+account|iban|swift|credit[[:space:]]+card|passport[[:space:]]+number|national[[:space:]]+id|id[[:space:]]+number[[:space:]]+of)'
     or t ~ '(الرواتب|رواتب|كشف[[:space:]]+الرواتب|راتب[[:space:]]+(الموظف|الموظّف)|الحساب[[:space:]]+البنكي|آيبان|رقم[[:space:]]+الهوية|جواز[[:space:]]+السفر)'
  then cats := cats || 'sensitive_personal_finance'; end if;

  if t ~ '(dump[[:space:]]+(all|the)|export[[:space:]]+(all|every)|list[[:space:]]+all[[:space:]]+(users|employees|clients|records|rows)|show[[:space:]]+me[[:space:]]+(everything|all[[:space:]]+data)|select[[:space:]]+\*)'
     or t ~ '(صدّر|صدر|أخرج)[[:space:]]+(كل|كلّ|جميع)[[:space:]]*(البيانات|السجلات|السجلّات)|(اعرض|أعطني)[[:space:]]+(كل|كلّ|جميع)[[:space:]]+(المستخدمين|الموظفين|الموظّفين|العملاء)'
  then cats := cats || 'bulk_exfiltration'; end if;

  if t ~ '(api[[:space:]]*key|service[[:space:]]*role|secret[[:space:]]*key|access[[:space:]]*token|password|\.env|private[[:space:]]+key|connection[[:space:]]+string)'
     or t ~ '(كلمة[[:space:]]+المرور|كلمة[[:space:]]+السر|مفتاح[[:space:]]+(الـ)?(api|الخدمة|السرّي)|رمز[[:space:]]+الوصول)'
  then cats := cats || 'secret_request'; end if;

  if t ~ '(drop[[:space:]]+table|delete[[:space:]]+from|insert[[:space:]]+into|update[[:space:]]+[a-z_]+[[:space:]]+set|alter[[:space:]]+table|grant[[:space:]]+|truncate[[:space:]]|pg_catalog|information_schema|union[[:space:]]+select|;--)'
     or t ~ '(اكتب|ولّد|أعطني)[[:space:]]*(لي)?[[:space:]]*(استعلام|كويري|sql|سكربت)'
  then cats := cats || 'sql_execution'; end if;

  if t ~ '(call[[:space:]]+the[[:space:]]+(tool|function|api)|invoke[[:space:]]+|run[[:space:]]+(this[[:space:]]+)?(command|script)|curl[[:space:]]+http|fetch\(|http[[:space:]]*request|send[[:space:]]+(an[[:space:]]+)?(email|message|whatsapp)[[:space:]]+to)'
     or t ~ '(نفّذ|شغّل)[[:space:]]+(الأمر|السكربت|الأداة)|(أرسل|ابعث)[[:space:]]+(بريد|رسالة|واتساب)'
  then cats := cats || 'tool_invocation'; end if;

  return jsonb_build_object(
    'blocked', coalesce(array_length(cats, 1), 0) > 0,
    'categories', to_jsonb(cats),
    'injection', inj,
    'checked_at', now()
  );
end $$;

-- ماسح ما لا يُبتلَع: يُنادى عند الإدخال والاعتماد، ويمنع دخول الأسرار
-- والهويات إلى سجلّ المعرفة أصلًا.
create or replace function public.ai_forbidden_content(p_text text)
returns text[] language plpgsql immutable set search_path = public as $$
declare t text := coalesce(p_text, ''); hits text[] := '{}'::text[];
begin
  if t ~* '-----BEGIN[[:space:]]+[A-Z ]*PRIVATE KEY-----' then hits := hits || 'private_key'; end if;
  if t ~* '(service_role|supabase_service_role|sk_live_|sk_test_|xoxb-|ghp_[A-Za-z0-9]{20,})'
     or t ~ 'AKIA[0-9A-Z]{16}'
    then hits := hits || 'credential'; end if;
  if t ~* '(password[[:space:]]*[:=][[:space:]]*[^[:space:]]{4,}|api[_[:space:]]?key[[:space:]]*[:=][[:space:]]*[^[:space:]]{8,})'
    then hits := hits || 'secret_assignment'; end if;
  if t ~ '\y[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\y' then hits := hits || 'possible_iban'; end if;
  if t ~ '\y[0-9]{10}\y' and t ~* '(هوية|إقامة|national[[:space:]]+id|iqama)' then hits := hits || 'possible_national_id'; end if;
  if t ~* '(كشف[[:space:]]+راتب|payslip|payroll[[:space:]]+register)' then hits := hits || 'payroll_document'; end if;
  return hits;
end $$;

create or replace function public.ai_checksum(p_text text)
returns text language sql immutable set search_path = public as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex');
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٩) رؤية المصدر — التعريف الوحيد لكلمة «مسموح لي بقراءته»
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_sensitivity_rank(p_sensitivity text)
returns int language sql immutable set search_path = public as $$
  select case coalesce(p_sensitivity, 'restricted')
           when 'public' then 0 when 'internal' then 1 else 2 end;
$$;

-- مُسنَد نقيّ يعمل على قيم الصفّ، فيمكن استعماله في RLS وفي WHERE معًا بلا
-- ازدواج تعريف. يعيد boolean صريحًا دائمًا.
-- ‏STABLE لا IMMUTABLE: تقرأ جدول مصفوفة الوصول وتستعمل current_date، ووصفها
-- بـIMMUTABLE كان سيجعل المخطّط يحتفظ بنتيجة قديمة بعد تضييق الصلاحيات.
create or replace function public.ai_source_permitted_for(
  p_status text, p_sensitivity text, p_allowed_roles text[], p_source_type text,
  p_effective_from date, p_expires_at date, p_archived_at timestamptz, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    p_status = 'approved'
    and p_archived_at is null
    and (p_effective_from is null or p_effective_from <= current_date)
    and (p_expires_at is null or p_expires_at >= current_date)
    and coalesce(p_roles, '{}'::text[]) && coalesce(p_allowed_roles, '{}'::text[])
    and exists (
      select 1 from public.ai_role_source_access a
       where a.assistant_role = any (coalesce(p_roles, '{}'::text[]))
         and a.source_type = p_source_type
         and public.ai_sensitivity_rank(a.max_sensitivity) >= public.ai_sensitivity_rank(p_sensitivity)
    ),
    false);
$$;

create or replace function public.ai_source_is_permitted(p_source_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s public.ai_knowledge_sources; v_roles text[];
begin
  if p_source_id is null then return false; end if;
  select * into s from public.ai_knowledge_sources where id = p_source_id;
  if not found then return false; end if;
  v_roles := coalesce(public.ai_actor_roles(), '{}'::text[]);
  return coalesce(public.ai_source_permitted_for(
    s.status, s.sensitivity, s.allowed_roles, s.source_type,
    s.effective_from, s.expires_at, s.archived_at, v_roles), false);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٠) الاسترجاع — ترشيح الصلاحية مطبَّق هنا **مرّة ثانية** بعد RLS
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_search_sources(p_query text, p_roles text[], p_limit int)
returns table (
  source_id uuid, chunk_index int, excerpt text, rank real,
  title_ar text, title_en text, source_type text, sensitivity text,
  source_version int, effective_from date, expires_at date,
  approved_at timestamptz, updated_at timestamptz, freshness_days int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_excerpt int;
  v_q tsquery;
  v_like text;
begin
  select coalesce(max_excerpt_chars, 700) into v_excerpt from public.ai_settings where id;
  v_excerpt := coalesce(v_excerpt, 700);
  begin
    v_q := websearch_to_tsquery('simple', coalesce(p_query, ''));
  exception when others then v_q := null; end;
  -- ILIKE احتياطيّ للعربية القصيرة. الهروب صريح كي لا يصير '%' من المستخدم
  -- استعلامًا يطابق كلّ شيء.
  v_like := '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select c.source_id,
         c.chunk_index,
         public.ai_neutralize(left(c.content, v_excerpt)) as excerpt,
         coalesce(case when v_q is null then 0::real else ts_rank(c.search_vec, v_q) end, 0::real) as rank,
         s.title_ar, s.title_en, s.source_type, s.sensitivity,
         s.version as source_version, s.effective_from, s.expires_at,
         s.approved_at, s.updated_at,
         greatest(0, (current_date - coalesce(s.approved_at, s.updated_at, s.created_at)::date))::int as freshness_days
    from public.ai_source_chunks c
    join public.ai_knowledge_sources s on s.id = c.source_id
   where public.ai_source_permitted_for(
           s.status, s.sensitivity, s.allowed_roles, s.source_type,
           s.effective_from, s.expires_at, s.archived_at, coalesce(p_roles, '{}'::text[]))
     and c.source_version = s.version
     and (
       (v_q is not null and c.search_vec @@ v_q)
       or (length(coalesce(p_query, '')) >= 2 and c.content ilike v_like)
     )
   order by rank desc, s.approved_at desc nulls last, c.chunk_index asc
   limit v_limit;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١١) واجهة المزوّد — **واجهة فقط**. لا نداء خارجيّ ممكن من داخل PostgreSQL،
--     والردّ الوحيد هو الإفصاح الصريح بأنّ المساعد غير مفعّل.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_provider_notice()
returns text language sql immutable set search_path = public as $$
  select 'مساعد كيان غير مفعّل بعد — تم تجهيز البنية فقط';
$$;

create or replace function public.ai_provider_describe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.ai_settings;
begin
  select * into st from public.ai_settings where id;
  return jsonb_build_object(
    'contract_version', 1,
    'provider', coalesce(st.provider_name, 'mock'),
    'enabled', coalesce(st.provider_enabled, false),
    'status', case when coalesce(st.provider_enabled, false) then 'disabled_by_design' else 'not_configured' end,
    'timeout_ms', coalesce(st.provider_timeout_ms, 15000),
    'credentials_in_repo', false,
    'browser_calls_allowed', false,
    'autonomous_actions', false,
    'tool_execution', false,
    'notice', public.ai_provider_notice(),
    'cost_metadata', jsonb_build_object('currency', 'SAR', 'input_tokens', null,
                                        'output_tokens', null, 'estimated_cost', null)
  );
end $$;

-- تُسجِّل «محاولة» بلا أيّ اتّصال. request_shape أطوال وأعداد لا نصوص.
create or replace function public.ai_provider_probe(p_question_length int, p_evidence_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st public.ai_settings; v_status text;
begin
  select * into st from public.ai_settings where id;
  v_status := case when coalesce(st.provider_enabled, false) then 'disabled' else 'not_configured' end;
  insert into public.ai_provider_log (provider, status, request_shape, response_shape, latency_ms, cost_metadata, error)
  values (coalesce(st.provider_name, 'mock'), v_status,
          jsonb_build_object('question_chars', greatest(coalesce(p_question_length, 0), 0),
                             'evidence_items', greatest(coalesce(p_evidence_count, 0), 0)),
          jsonb_build_object('text', null, 'notice', public.ai_provider_notice()),
          0, jsonb_build_object('estimated_cost', null), null);
  return jsonb_build_object('status', v_status, 'provider', coalesce(st.provider_name, 'mock'),
                            'notice', public.ai_provider_notice(), 'generated_text', null);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٢) المحادثة والإجابة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_conversation_start(p_channel text, p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_roles text[]; st public.ai_settings; v_days int;
begin
  if not coalesce(public.ai_can_use_internal(), false) then
    raise exception 'المساعد الداخليّ مخصّص لفريق العمل المخوَّل.' using errcode = '42501';
  end if;
  select * into st from public.ai_settings where id;
  v_days := coalesce(st.retention_days_internal, 365);
  v_roles := coalesce(public.ai_actor_roles(), '{}'::text[]);
  insert into public.ai_conversations (actor_user_id, actor_kind, actor_roles, role_snapshot, channel,
                                       title, retention_class, expires_at)
  values (auth.uid(), 'internal', v_roles,
          jsonb_build_object('roles', to_jsonb(v_roles), 'captured_at', now()),
          case when coalesce(p_channel, 'internal') = 'public' then 'internal' else 'internal' end,
          nullif(left(coalesce(p_title, ''), 160), ''), 'standard', now() + make_interval(days => v_days))
  returning id into v_id;
  perform public.ai_log('conversation_start', 'ai_conversations', v_id, true, jsonb_build_object('roles', to_jsonb(v_roles)));
  return v_id;
end $$;

create or replace function public.ai_message_add(
  p_conversation uuid, p_role text, p_content text, p_refusal text,
  p_retrieved int, p_guard jsonb, p_provider_status text, p_confidence text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_seq int; v_id uuid;
begin
  perform 1 from public.ai_conversations where id = p_conversation for update;
  select coalesce(max(seq), 0) + 1 into v_seq from public.ai_messages where conversation_id = p_conversation;
  insert into public.ai_messages (conversation_id, seq, role, content, refusal_code, retrieved_count,
                                  guard_verdict, provider_status, confidence)
  values (p_conversation, v_seq, p_role, coalesce(p_content, ''), p_refusal,
          greatest(coalesce(p_retrieved, 0), 0), coalesce(p_guard, '{}'::jsonb),
          coalesce(p_provider_status, 'not_configured'), p_confidence)
  returning id into v_id;
  update public.ai_conversations
     set message_count = message_count + 1, last_message_at = now()
   where id = p_conversation;
  return v_id;
end $$;

-- ★ الدالّة المركزية. ترتيب الخطوات هو الأمن نفسه:
--   بوّابة ⇒ حارس ⇒ (منع ⇒ **عودة قبل أيّ استرجاع**) ⇒ استرجاع مرشَّح ⇒
--   لا مصدر ⇒ رفض صريح ⇒ مُسنَدات إجبارية ⇒ إفصاح عن حالة المزوّد.
create or replace function public.ai_ask(p_question text, p_conversation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.ai_settings;
  v_roles text[];
  v_conv uuid := p_conversation;
  v_guard jsonb;
  v_q text;
  v_msg_user uuid;
  v_msg_ans uuid;
  v_rows int := 0;
  v_evidence jsonb := '[]'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_conf text := 'none';
  v_top real := 0;
  v_fresh int := 99999;
  v_provider jsonb;
  r record;
begin
  if not coalesce(public.ai_can_use_internal(), false) then
    raise exception 'المساعد الداخليّ مخصّص لفريق العمل المخوَّل.' using errcode = '42501';
  end if;
  select * into st from public.ai_settings where id;
  v_roles := coalesce(public.ai_actor_roles(), '{}'::text[]);
  v_q := left(coalesce(p_question, ''), coalesce(st.max_question_chars, 1000));

  if length(btrim(v_q)) < 2 then
    -- ★ كلّ مسار عودة يصرّح بالحقائق نفسها. مسار واحد يسقط منه
    --   tool_execution يجعل المتصل يقرأ الغياب على أنّه «ربّما نُفِّذت أداة».
    return jsonb_build_object('ok', false, 'refusal_code', 'question_too_short',
      'answer', 'اكتب سؤالًا أوضح من فضلك.', 'retrieved_count', 0,
      'citations', '[]'::jsonb, 'evidence', '[]'::jsonb,
      'is_data_not_instructions', true, 'tool_execution', false, 'tools', '[]'::jsonb);
  end if;

  if v_conv is null then v_conv := public.ai_conversation_start('internal', left(v_q, 80)); end if;
  if not exists (select 1 from public.ai_conversations c
                  where c.id = v_conv and c.actor_user_id = auth.uid() and c.purged_at is null) then
    raise exception 'المحادثة غير متاحة لك.' using errcode = '42501';
  end if;

  v_guard := public.ai_guard_question(v_q);
  v_msg_user := public.ai_message_add(v_conv, 'user', v_q, null, 0, v_guard, 'not_configured', null);

  -- ★★ المنع يسبق الاسترجاع. لا نداء لـai_search_sources في هذا الفرع إطلاقًا،
  --    فلا يُقرأ صفّ معرفة واحد ولا تُنشأ مُسنَدات: retrieved_count = 0.
  if coalesce((v_guard->>'blocked')::boolean, false) then
    v_msg_ans := public.ai_message_add(v_conv, 'assistant',
      'لا يمكنني تنفيذ هذا الطلب. المحتوى المسترجَع لديّ **بيانات لا تعليمات**، ولا أُخرج أسرارًا '
      || 'ولا بيانات حسّاسة ولا أنفّذ أوامر أو استعلامات. اطرح سؤالًا معرفيًّا وسأجيب من مصدر معتمَد.',
      'blocked_by_guard', 0, v_guard, 'not_configured', 'none');
    perform public.ai_log('ask_blocked', 'ai_messages', v_msg_ans, true,
                          jsonb_build_object('categories', v_guard->'categories'));
    return jsonb_build_object(
      'ok', false, 'conversation_id', v_conv, 'message_id', v_msg_ans,
      'refusal_code', 'blocked_by_guard', 'guard', v_guard,
      'answer', (select content from public.ai_messages where id = v_msg_ans),
      'retrieved_count', 0, 'citations', '[]'::jsonb, 'evidence', '[]'::jsonb,
      'is_data_not_instructions', true, 'tool_execution', false, 'tools', '[]'::jsonb);
  end if;

  for r in select * from public.ai_search_sources(v_q, v_roles, coalesce(st.max_results, 5)) loop
    v_rows := v_rows + 1;
    if r.rank > v_top then v_top := r.rank; end if;
    if r.freshness_days < v_fresh then v_fresh := r.freshness_days; end if;
    v_evidence := v_evidence || jsonb_build_object(
      'source_id', r.source_id, 'chunk_index', r.chunk_index, 'excerpt', r.excerpt,
      'title_ar', r.title_ar, 'source_type', r.source_type, 'sensitivity', r.sensitivity,
      'source_version', r.source_version, 'freshness_days', r.freshness_days);
    v_sources := v_sources || jsonb_build_object(
      'source_id', r.source_id, 'title_ar', r.title_ar, 'title_en', r.title_en,
      'source_type', r.source_type, 'source_version', r.source_version,
      'effective_from', r.effective_from, 'expires_at', r.expires_at,
      'approved_at', r.approved_at, 'freshness_days', r.freshness_days, 'rank', r.rank);
  end loop;

  if v_rows = 0 then
    v_msg_ans := public.ai_message_add(v_conv, 'assistant',
      'لا توجد لدي معلومة معتمدة كافية للإجابة', 'no_approved_source', 0, v_guard, 'not_configured', 'none');
    perform public.ai_log('ask_no_source', 'ai_messages', v_msg_ans, true, jsonb_build_object('roles', to_jsonb(v_roles)));
    return jsonb_build_object(
      'ok', true, 'conversation_id', v_conv, 'message_id', v_msg_ans,
      'refusal_code', 'no_approved_source',
      'answer', 'لا توجد لدي معلومة معتمدة كافية للإجابة',
      'retrieved_count', 0, 'confidence', 'none',
      'citations', '[]'::jsonb, 'evidence', '[]'::jsonb,
      'is_data_not_instructions', true, 'tool_execution', false, 'tools', '[]'::jsonb,
      'provider', public.ai_provider_describe());
  end if;

  v_conf := case
    when v_rows >= 2 and v_top >= 0.05 and v_fresh <= 180 then 'high'
    when v_rows >= 1 and (v_top >= 0.01 or v_fresh <= 365) then 'medium'
    else 'low' end;

  -- لا نصّ مولَّد: نُسجِّل «محاولة» عند المزوّد ونُفصح أنّه غير مفعّل.
  v_provider := public.ai_provider_probe(length(v_q), v_rows);

  v_msg_ans := public.ai_message_add(v_conv, 'assistant',
    public.ai_provider_notice() || ' — أدناه مقتطفات من مصادر معتمَدة مطابقة لسؤالك، بمراجعها.',
    null, v_rows, v_guard, coalesce(v_provider->>'status', 'not_configured'), v_conf);

  insert into public.ai_message_citations (message_id, source_id, source_version, source_title,
                                           source_type, chunk_index, freshness_days, rank)
  select v_msg_ans, (e->>'source_id')::uuid, (e->>'source_version')::int, e->>'title_ar',
         e->>'source_type', (e->>'chunk_index')::int, (e->>'freshness_days')::int, null
    from jsonb_array_elements(v_evidence) e;

  perform public.ai_log('ask_answered', 'ai_messages', v_msg_ans, true,
    jsonb_build_object('retrieved', v_rows, 'confidence', v_conf, 'roles', to_jsonb(v_roles)));

  return jsonb_build_object(
    'ok', true, 'conversation_id', v_conv, 'message_id', v_msg_ans,
    'answer', (select content from public.ai_messages where id = v_msg_ans),
    'generated_text', null,
    'retrieved_count', v_rows, 'confidence', v_conf,
    'evidence', v_evidence, 'citations', v_sources,
    'is_data_not_instructions', true, 'tool_execution', false, 'tools', '[]'::jsonb,
    'guard', v_guard, 'provider', v_provider, 'roles', to_jsonb(v_roles));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٣) السطح العامّ — قراءة عامّة · حدود · تحقّق بشريّ · بلا بريد
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_rate_take(p_bucket text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_hits int;
begin
  if coalesce(p_limit, 0) <= 0 then return false; end if;
  v_start := date_trunc('hour', now())
             - make_interval(secs => (extract(epoch from date_trunc('hour', now())) )::int % greatest(extract(epoch from p_window)::int, 1));
  v_start := to_timestamp(floor(extract(epoch from now()) / greatest(extract(epoch from p_window)::int, 1))
                          * greatest(extract(epoch from p_window)::int, 1));
  insert into public.ai_public_rate_limits (bucket_key, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket_key, window_start) do update set hits = public.ai_public_rate_limits.hits + 1
  returning hits into v_hits;
  delete from public.ai_public_rate_limits where window_start < now() - interval '3 days';
  return coalesce(v_hits, p_limit + 1) <= p_limit;
end $$;

-- واجهة CAPTCHA — **مكان محجوز**. لا نداء شبكيّ، ولا ادّعاء نجاح.
create or replace function public.ai_captcha_verify(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.ai_settings;
begin
  select * into st from public.ai_settings where id;
  if not coalesce(st.captcha_required, false) then
    return jsonb_build_object('required', false, 'configured', false, 'verdict', 'not_required');
  end if;
  if coalesce(st.captcha_provider, '') = '' then
    -- مطلوب وغير مضبوط ⇒ **الفشل مغلق**: لا نمرّر ولا ندّعي تحقّقًا.
    return jsonb_build_object('required', true, 'configured', false, 'verdict', 'not_configured');
  end if;
  return jsonb_build_object('required', true, 'configured', false, 'verdict', 'adapter_only',
                            'provider', st.captcha_provider);
end $$;

create or replace function public.ai_public_ask(p_question text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.ai_settings; v_guard jsonb; v_q text; v_rows int := 0;
  v_evidence jsonb := '[]'::jsonb; v_sources jsonb := '[]'::jsonb; r record;
begin
  select * into st from public.ai_settings where id;
  if not coalesce(st.public_assistant_enabled, false) then
    return jsonb_build_object('ok', false, 'refusal_code', 'public_assistant_disabled',
      'answer', 'المساعد العامّ غير مفعّل حاليًّا.', 'retrieved_count', 0, 'citations', '[]'::jsonb);
  end if;
  if not coalesce(public.ai_rate_take('pub_ask:' || coalesce(p_ip_hash, 'unknown'),
                                      coalesce(st.public_ip_hourly_limit, 10), interval '1 hour'), false) then
    insert into public.ai_abuse_log (surface, reason, ip_hash) values ('public_ask', 'rate_limited', p_ip_hash);
    return jsonb_build_object('ok', false, 'refusal_code', 'rate_limited',
      'answer', 'عدد المحاولات تجاوز الحدّ. حاول بعد قليل.', 'retrieved_count', 0, 'citations', '[]'::jsonb);
  end if;

  v_q := left(coalesce(p_question, ''), coalesce(st.max_question_chars, 1000));
  v_guard := public.ai_guard_question(v_q);
  if coalesce((v_guard->>'blocked')::boolean, false) then
    insert into public.ai_abuse_log (surface, reason, ip_hash, details)
    values ('public_ask', 'blocked_by_guard', p_ip_hash, jsonb_build_object('categories', v_guard->'categories'));
    return jsonb_build_object('ok', false, 'refusal_code', 'blocked_by_guard', 'guard', v_guard,
      'answer', 'لا يمكنني تنفيذ هذا الطلب.', 'retrieved_count', 0, 'citations', '[]'::jsonb,
      'evidence', '[]'::jsonb, 'is_data_not_instructions', true, 'tool_execution', false);
  end if;

  -- ★ الأدوار مثبَّتة على 'anonymous' — لا تُشتقّ من مُدخَل المتصل إطلاقًا.
  for r in select * from public.ai_search_sources(v_q, array['anonymous']::text[], coalesce(st.max_results, 5)) loop
    v_rows := v_rows + 1;
    v_evidence := v_evidence || jsonb_build_object('source_id', r.source_id, 'excerpt', r.excerpt,
      'title_ar', r.title_ar, 'source_type', r.source_type, 'source_version', r.source_version);
    v_sources := v_sources || jsonb_build_object('source_id', r.source_id, 'title_ar', r.title_ar,
      'source_version', r.source_version, 'freshness_days', r.freshness_days);
  end loop;

  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'refusal_code', 'no_approved_source',
      'answer', 'لا توجد لدي معلومة معتمدة كافية للإجابة', 'retrieved_count', 0,
      'citations', '[]'::jsonb, 'evidence', '[]'::jsonb, 'is_data_not_instructions', true,
      'tool_execution', false, 'provider', public.ai_provider_describe());
  end if;

  perform public.ai_provider_probe(length(v_q), v_rows);
  return jsonb_build_object('ok', true,
    'answer', public.ai_provider_notice() || ' — أدناه مقتطفات من مصادر عامّة معتمَدة.',
    'generated_text', null, 'retrieved_count', v_rows, 'evidence', v_evidence, 'citations', v_sources,
    'is_data_not_instructions', true, 'tool_execution', false, 'tools', '[]'::jsonb,
    'binding_price', false, 'provider', public.ai_provider_describe(),
    'privacy_notice_version', coalesce(st.privacy_notice_version, 'v1'));
end $$;

-- ★ المسوّدة فقط. لا بريد · لا مستقبِل يختاره المتصل · لا مشروع · لا عرض سعر ·
--   ولا سعر مُلزِم. الحقول مقصورة على أقلّ بيانات شخصية تكفي للتواصل.
create or replace function public.ai_public_lead_draft(
  p_payload jsonb, p_ip_hash text, p_user_agent_hash text,
  p_idempotency_key text, p_captcha_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st public.ai_settings; v_id uuid; v_cap jsonb; v_status text;
  v_name text; v_email text; v_phone text; v_company text; v_service text; v_message text; v_locale text;
  v_extra text[];
begin
  select * into st from public.ai_settings where id;
  if not coalesce(st.public_lead_enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'public_lead_disabled');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  -- ★ حمولة مغلقة: مفتاح غير معروف ⇒ رفض. لا نبتلع حقولًا لا نعرفها.
  select coalesce(array_agg(k), '{}'::text[]) into v_extra
    from jsonb_object_keys(p_payload) k
   where k not in ('full_name','email','phone','company','service_interest','message','locale');
  if coalesce(array_length(v_extra, 1), 0) > 0 then
    insert into public.ai_abuse_log (surface, reason, ip_hash, details)
    values ('public_lead', 'unknown_fields', p_ip_hash, jsonb_build_object('fields', to_jsonb(v_extra)));
    return jsonb_build_object('ok', false, 'error', 'unknown_fields', 'fields', to_jsonb(v_extra));
  end if;

  -- التكرار: المفتاح نفسه ⇒ الصفّ نفسه، بلا صفّ ثانٍ وبلا خطأ.
  if coalesce(p_idempotency_key, '') <> '' then
    select id into v_id from public.ai_lead_drafts where idempotency_key = p_idempotency_key;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'draft_id', v_id, 'duplicate', true,
        'status', 'pending_human_review', 'handoff_status', 'awaiting_human');
    end if;
  end if;

  if not coalesce(public.ai_rate_take('pub_lead_h:' || coalesce(p_ip_hash, 'unknown'),
                                      coalesce(st.public_ip_hourly_limit, 10), interval '1 hour'), false)
     or not coalesce(public.ai_rate_take('pub_lead_d:' || coalesce(p_ip_hash, 'unknown'),
                                      coalesce(st.public_ip_daily_limit, 30), interval '1 day'), false)
     or not coalesce(public.ai_rate_take('pub_lead_g', coalesce(st.public_global_daily_limit, 500), interval '1 day'), false)
  then
    insert into public.ai_abuse_log (surface, reason, ip_hash) values ('public_lead', 'rate_limited', p_ip_hash);
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- ★ CAPTCHA: **الفشل مغلق بلا استثناء**. إن كان مطلوبًا فلا يمرّ إلّا الحكم
  --   'verified'. الواجهة هنا مكان محجوز لا مُتحقِّق: 'adapter_only' يعني
  --   «المزوّد مذكور في الإعدادات ولا مُتحقِّق منفَّذ»، وقبول الطلب عندها كان
  --   سيكتب صفًّا بحالة captcha_status='not_configured' يبدو كأنّه مرّ بتحقّق
  --   — أي **قبول صامت لطلب غير مُتحقَّق منه**. الرفض هنا مُصنَّف بوضوح.
  v_cap := public.ai_captcha_verify(p_captcha_token);
  if coalesce((v_cap->>'required')::boolean, false)
     and coalesce(v_cap->>'verdict', '') <> 'verified' then
    insert into public.ai_abuse_log (surface, reason, ip_hash, details)
    values ('public_lead', 'captcha_not_verified', p_ip_hash, v_cap);
    return jsonb_build_object('ok', false, 'error', 'captcha_not_verified', 'captcha', v_cap,
      'message', 'التحقّق من أنّك لست آليًّا مطلوب وغير منفَّذ بعد — الطلب لم يُحفَظ.');
  end if;
  v_status := case coalesce(v_cap->>'verdict', 'not_required')
                when 'not_required' then 'not_required'
                when 'verified' then 'verified' else 'not_configured' end;

  v_name    := nullif(btrim(left(coalesce(p_payload->>'full_name', ''), 120)), '');
  v_email   := nullif(lower(btrim(left(coalesce(p_payload->>'email', ''), 160))), '');
  v_phone   := nullif(btrim(left(coalesce(p_payload->>'phone', ''), 40)), '');
  v_company := nullif(btrim(left(coalesce(p_payload->>'company', ''), 160)), '');
  v_service := nullif(btrim(left(coalesce(p_payload->>'service_interest', ''), 120)), '');
  v_message := left(coalesce(p_payload->>'message', ''), 2000);
  v_locale  := case when coalesce(p_payload->>'locale', 'ar') in ('ar','en') then p_payload->>'locale' else 'ar' end;

  if coalesce(v_email, '') = '' and coalesce(v_phone, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'contact_required');
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- محتوى الرسالة يُحيَّد قبل التخزين: مسوّدة يقرأها موظّف لاحقًا يجب ألّا
  -- تحمل وسمًا ولا رابطًا موقَّعًا ولا سطر تعليمات.
  v_message := public.ai_neutralize(v_message);

  insert into public.ai_lead_drafts (full_name, email, phone, company, service_interest, message, locale,
                                     status, handoff_status, idempotency_key, ip_hash, user_agent_hash,
                                     captcha_status, source, privacy_notice_version)
  values (v_name, v_email, v_phone, v_company, v_service, v_message, v_locale,
          'pending_human_review', 'awaiting_human', nullif(p_idempotency_key, ''), p_ip_hash, p_user_agent_hash,
          v_status, 'public_assistant', coalesce(st.privacy_notice_version, 'v1'))
  returning id into v_id;

  perform public.ai_log('lead_draft_created', 'ai_lead_drafts', v_id, true,
                        jsonb_build_object('source', 'public_assistant'));

  -- ⛔ لا إشعار ولا بريد ولا واتساب هنا. المسوّدة تنتظر إنسانًا في الشاشة.
  return jsonb_build_object('ok', true, 'draft_id', v_id, 'duplicate', false,
    'status', 'pending_human_review', 'handoff_status', 'awaiting_human',
    'email_sent', false, 'privacy_notice_version', coalesce(st.privacy_notice_version, 'v1'),
    'notice', 'تم حفظ طلبك كمسوّدة وسيتواصل معك فريقنا. لا يُصدَر أيّ سعر أو التزام آليًّا.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٤) إدارة السجلّ — إدخال · تقديم · اعتماد · رفض · أرشفة · فهرسة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_source_reindex(p_source_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s public.ai_knowledge_sources; v_text text; v_i int := 0; v_pos int := 1; v_len int; v_chunk text;
begin
  select * into s from public.ai_knowledge_sources where id = p_source_id;
  if not found then return 0; end if;
  delete from public.ai_source_chunks where source_id = p_source_id;
  if s.status <> 'approved' then return 0; end if;      -- ★ غير المعتمَد لا يُفهرَس، فلا يُسترجَع أبدًا
  v_text := coalesce(s.content_text, '');
  v_len := length(v_text);
  while v_pos <= v_len loop
    v_chunk := substr(v_text, v_pos, 1200);
    insert into public.ai_source_chunks (source_id, chunk_index, content, source_version)
    values (p_source_id, v_i, v_chunk, s.version);
    v_i := v_i + 1;
    v_pos := v_pos + 1200;
  end loop;
  return v_i;
end $$;

create or replace function public.ai_source_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; s public.ai_knowledge_sources; v_bad text[]; v_text text; v_status text;
begin
  if not coalesce(public.ai_can_manage_knowledge(), false) then
    raise exception 'لا تملك صلاحية إدارة سجلّ المعرفة.' using errcode = '42501';
  end if;
  v_id := nullif(p_input->>'id', '')::uuid;
  v_text := coalesce(p_input->>'content_text', '');

  v_bad := public.ai_forbidden_content(v_text);
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.ai_log('source_rejected_content', 'ai_knowledge_sources', v_id, false,
                          jsonb_build_object('findings', to_jsonb(v_bad)));
    return jsonb_build_object('ok', false, 'error', 'forbidden_content', 'findings', to_jsonb(v_bad));
  end if;

  if v_id is null then
    insert into public.ai_knowledge_sources (
      source_type, title_ar, title_en, language, sensitivity, allowed_roles, content_kind,
      content_text, storage_bucket, storage_path, source_url, effective_from, expires_at,
      notes, created_by, checksum, status)
    values (
      coalesce(p_input->>'source_type', 'other'),
      left(coalesce(p_input->>'title_ar', ''), 300),
      left(coalesce(p_input->>'title_en', ''), 300),
      coalesce(p_input->>'language', 'ar'),
      coalesce(p_input->>'sensitivity', 'internal'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_input->'allowed_roles', '[]'::jsonb)) x),
               array['owner']::text[]),
      coalesce(p_input->>'content_kind', 'inline'),
      nullif(v_text, ''), nullif(p_input->>'storage_bucket', ''), nullif(p_input->>'storage_path', ''),
      nullif(p_input->>'source_url', ''),
      nullif(p_input->>'effective_from', '')::date, nullif(p_input->>'expires_at', '')::date,
      nullif(p_input->>'notes', ''), auth.uid(), public.ai_checksum(v_text), 'draft')
    returning id into v_id;
  else
    select * into s from public.ai_knowledge_sources where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if s.status = 'approved' then
      -- ★ تعديل مصدر معتمَد يُنزله إلى مسودّة ويرفع النسخة: لا يبقى محتوى جديد
      --   يحمل ختم اعتماد قديم، ولا يبقى فهرس نسخة سابقة قابلًا للاسترجاع.
      insert into public.ai_source_revisions (source_id, version, status, checksum, content_length, changed_by, change_note)
      values (s.id, s.version, s.status, s.checksum, length(coalesce(s.content_text, '')), auth.uid(), 'edited_after_approval');
    end if;
    v_status := case when s.status = 'approved' then 'draft' else s.status end;
    update public.ai_knowledge_sources set
      source_type = coalesce(p_input->>'source_type', source_type),
      title_ar = coalesce(left(nullif(p_input->>'title_ar', ''), 300), title_ar),
      title_en = coalesce(left(p_input->>'title_en', 300), title_en),
      language = coalesce(p_input->>'language', language),
      sensitivity = coalesce(p_input->>'sensitivity', sensitivity),
      allowed_roles = coalesce(
        (select array_agg(x) from jsonb_array_elements_text(coalesce(p_input->'allowed_roles', '[]'::jsonb)) x),
        allowed_roles),
      content_kind = coalesce(p_input->>'content_kind', content_kind),
      content_text = coalesce(nullif(v_text, ''), content_text),
      storage_bucket = coalesce(nullif(p_input->>'storage_bucket', ''), storage_bucket),
      storage_path = coalesce(nullif(p_input->>'storage_path', ''), storage_path),
      source_url = coalesce(nullif(p_input->>'source_url', ''), source_url),
      effective_from = coalesce(nullif(p_input->>'effective_from', '')::date, effective_from),
      expires_at = coalesce(nullif(p_input->>'expires_at', '')::date, expires_at),
      notes = coalesce(nullif(p_input->>'notes', ''), notes),
      checksum = public.ai_checksum(coalesce(nullif(v_text, ''), content_text)),
      version = case when s.status = 'approved' then version + 1 else version end,
      status = v_status,
      approved_by = case when s.status = 'approved' then null else approved_by end,
      approved_at = case when s.status = 'approved' then null else approved_at end,
      updated_at = now()
    where id = v_id;
    perform public.ai_source_reindex(v_id);   -- ينظّف فهرس النسخة القديمة فورًا
  end if;

  perform public.ai_log('source_upsert', 'ai_knowledge_sources', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'source_id', v_id,
    'status', (select status from public.ai_knowledge_sources where id = v_id),
    'searchable', false,
    'notice', 'المصدر لا يصبح قابلًا للاسترجاع قبل اعتماده من مخوَّل غيرك.');
end $$;

create or replace function public.ai_source_submit(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.ai_can_manage_knowledge(), false) then
    raise exception 'لا تملك صلاحية إدارة سجلّ المعرفة.' using errcode = '42501';
  end if;
  update public.ai_knowledge_sources
     set status = 'in_review', submitted_by = auth.uid(), submitted_at = now(), updated_at = now()
   where id = p_source_id and status in ('draft','rejected');
  if not found then return jsonb_build_object('ok', false, 'error', 'not_in_submittable_state'); end if;
  perform public.ai_log('source_submit', 'ai_knowledge_sources', p_source_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'in_review');
end $$;

create or replace function public.ai_source_approve(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ai_knowledge_sources; v_bad text[]; v_chunks int;
begin
  if not coalesce(public.ai_can_approve_knowledge(), false) then
    raise exception 'لا تملك صلاحية اعتماد مصادر المعرفة.' using errcode = '42501';
  end if;
  select * into s from public.ai_knowledge_sources where id = p_source_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if s.status <> 'in_review' then return jsonb_build_object('ok', false, 'error', 'not_in_review'); end if;
  if s.submitted_by is not null and s.submitted_by = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'approver_is_submitter',
      'message', 'المعتمِد لا يكون هو المُقدِّم — هذا قيد جدوليّ لا إعداد.');
  end if;
  if length(coalesce(s.content_text, '')) < 20 then
    return jsonb_build_object('ok', false, 'error', 'content_too_short');
  end if;
  v_bad := public.ai_forbidden_content(s.content_text);
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.ai_log('source_approve_blocked', 'ai_knowledge_sources', p_source_id, false,
                          jsonb_build_object('findings', to_jsonb(v_bad)));
    return jsonb_build_object('ok', false, 'error', 'forbidden_content', 'findings', to_jsonb(v_bad));
  end if;

  update public.ai_knowledge_sources
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         checksum = public.ai_checksum(content_text), updated_at = now()
   where id = p_source_id;

  insert into public.ai_source_revisions (source_id, version, status, checksum, content_length, changed_by, change_note)
  select id, version, status, checksum, length(coalesce(content_text, '')), auth.uid(), 'approved'
    from public.ai_knowledge_sources where id = p_source_id;

  v_chunks := public.ai_source_reindex(p_source_id);
  perform public.ai_log('source_approve', 'ai_knowledge_sources', p_source_id, true,
                        jsonb_build_object('chunks', v_chunks));
  return jsonb_build_object('ok', true, 'status', 'approved', 'chunks', v_chunks, 'searchable', v_chunks > 0);
end $$;

create or replace function public.ai_source_reject(p_source_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.ai_can_approve_knowledge(), false) then
    raise exception 'لا تملك صلاحية اعتماد مصادر المعرفة.' using errcode = '42501';
  end if;
  update public.ai_knowledge_sources
     set status = 'rejected', rejected_reason = left(coalesce(p_reason, ''), 500), updated_at = now()
   where id = p_source_id and status = 'in_review';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_in_review'); end if;
  perform public.ai_source_reindex(p_source_id);
  perform public.ai_log('source_reject', 'ai_knowledge_sources', p_source_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'rejected');
end $$;

create or replace function public.ai_source_archive(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.ai_can_manage_knowledge(), false) then
    raise exception 'لا تملك صلاحية إدارة سجلّ المعرفة.' using errcode = '42501';
  end if;
  update public.ai_knowledge_sources
     set status = 'archived', archived_at = now(), updated_at = now()
   where id = p_source_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.ai_source_reindex(p_source_id);   -- ★ الأرشفة تحذف الفهرس فورًا
  perform public.ai_log('source_archive', 'ai_knowledge_sources', p_source_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'archived', 'searchable', false);
end $$;

-- كنس المنتهي: يُنادى من مهمّة دورية قائمة، ولا يرسل شيئًا.
create or replace function public.ai_sources_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  for r in select id from public.ai_knowledge_sources
            where status = 'approved' and expires_at is not null and expires_at < current_date loop
    update public.ai_knowledge_sources set status = 'expired', updated_at = now() where id = r.id;
    perform public.ai_source_reindex(r.id);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform public.ai_log('sources_expired', 'ai_knowledge_sources', null, true,
                                        jsonb_build_object('count', v_n)); end if;
  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٥) الاحتفاظ · التنقيح · التصعيد · مراجعة المسوّدات · الإعدادات
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_conversation_redact(p_conversation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not coalesce(public.ai_can_redact(), false) then
    raise exception 'لا تملك صلاحية تنقيح المحادثات.' using errcode = '42501';
  end if;
  update public.ai_messages
     set content = '[محتوى مُنقَّح]', redaction_status = 'redacted', redacted_at = now(), redacted_by = auth.uid()
   where conversation_id = p_conversation and redaction_status <> 'redacted';
  get diagnostics v_n = row_count;
  update public.ai_conversations set redaction_status = 'redacted' where id = p_conversation;
  perform public.ai_log('conversation_redact', 'ai_conversations', p_conversation, true,
                        jsonb_build_object('messages', v_n, 'reason', left(coalesce(p_reason, ''), 300)));
  return jsonb_build_object('ok', true, 'redacted_messages', v_n);
end $$;

create or replace function public.ai_conversation_delete(p_conversation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.ai_can_redact(), false) then
    raise exception 'لا تملك صلاحية حذف المحادثات.' using errcode = '42501';
  end if;
  delete from public.ai_conversations where id = p_conversation;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.ai_log('conversation_delete', 'ai_conversations', p_conversation, true,
                        jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_retention_purge_due()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  with doomed as (
    select id from public.ai_conversations
     where expires_at is not null and expires_at < now() and purged_at is null
     limit 500)
  update public.ai_conversations c set purged_at = now(), redaction_status = 'purged'
    from doomed d where c.id = d.id;
  get diagnostics v_n = row_count;
  delete from public.ai_messages m
   using public.ai_conversations c
   where m.conversation_id = c.id and c.purged_at is not null;
  if v_n > 0 then perform public.ai_log('retention_purge', 'ai_conversations', null, true,
                                        jsonb_build_object('conversations', v_n)); end if;
  return v_n;
end $$;

create or replace function public.ai_conversation_escalate(p_conversation uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ai_conversations
                  where id = p_conversation
                    and (actor_user_id = auth.uid() or coalesce(public.ai_can_view_all_conversations(), false))) then
    raise exception 'المحادثة غير متاحة لك.' using errcode = '42501';
  end if;
  update public.ai_conversations
     set escalation_status = 'requested', escalated_at = now(),
         escalation_note = left(coalesce(p_note, ''), 500)
   where id = p_conversation;
  perform public.ai_log('conversation_escalate', 'ai_conversations', p_conversation, true, '{}'::jsonb);
  -- ⛔ لا بريد ولا إشعار خارجيّ: الحالة تظهر في شاشة المراجعة البشرية.
  return jsonb_build_object('ok', true, 'escalation_status', 'requested', 'email_sent', false);
end $$;

create or replace function public.ai_lead_review(p_draft_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.ai_can_review_leads(), false) then
    raise exception 'لا تملك صلاحية مراجعة مسوّدات العملاء المحتملين.' using errcode = '42501';
  end if;
  if coalesce(p_status, '') not in ('accepted','rejected','spam','pending_human_review') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;
  update public.ai_lead_drafts
     set status = p_status,
         handoff_status = case when p_status = 'pending_human_review' then 'awaiting_human' else 'closed' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(coalesce(p_note, ''), 500)
   where id = p_draft_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.ai_log('lead_review', 'ai_lead_drafts', p_draft_id, true, jsonb_build_object('status', p_status));
  -- ⛔ المراجعة لا تُنشئ عميلًا ولا فرصة ولا عرض سعر: التحويل قرار بشريّ في
  --    وحدة المبيعات القائمة، بأدواتها ومسار تدقيقها.
  return jsonb_build_object('ok', true, 'status', p_status, 'converted', false, 'email_sent', false);
end $$;

create or replace function public.ai_settings_update(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  if not coalesce(public.ai_can_manage_settings(), false) then
    raise exception 'إعدادات المساعد للمالك وحده.' using errcode = '42501';
  end if;
  select to_jsonb(s) into v_before from public.ai_settings s where id;
  update public.ai_settings set
    assistant_enabled = coalesce((p_input->>'assistant_enabled')::boolean, assistant_enabled),
    provider_name = coalesce(nullif(p_input->>'provider_name', ''), provider_name),
    provider_enabled = coalesce((p_input->>'provider_enabled')::boolean, provider_enabled),
    public_assistant_enabled = coalesce((p_input->>'public_assistant_enabled')::boolean, public_assistant_enabled),
    public_lead_enabled = coalesce((p_input->>'public_lead_enabled')::boolean, public_lead_enabled),
    captcha_required = coalesce((p_input->>'captcha_required')::boolean, captcha_required),
    captcha_provider = coalesce(nullif(p_input->>'captcha_provider', ''), captcha_provider),
    public_ip_hourly_limit = coalesce((p_input->>'public_ip_hourly_limit')::int, public_ip_hourly_limit),
    public_ip_daily_limit = coalesce((p_input->>'public_ip_daily_limit')::int, public_ip_daily_limit),
    public_global_daily_limit = coalesce((p_input->>'public_global_daily_limit')::int, public_global_daily_limit),
    max_question_chars = coalesce((p_input->>'max_question_chars')::int, max_question_chars),
    max_excerpt_chars = coalesce((p_input->>'max_excerpt_chars')::int, max_excerpt_chars),
    max_results = coalesce((p_input->>'max_results')::int, max_results),
    retention_days_internal = coalesce((p_input->>'retention_days_internal')::int, retention_days_internal),
    retention_days_public = coalesce((p_input->>'retention_days_public')::int, retention_days_public),
    updated_by = auth.uid(), updated_at = now()
  where id;
  select to_jsonb(s) into v_after from public.ai_settings s where id;
  perform public.ai_log('settings_update', 'ai_settings', null, true,
                        jsonb_build_object('before', v_before, 'after', v_after));
  return jsonb_build_object('ok', true, 'settings', v_after);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٦) نداءات القراءة للواجهة — كلّها تُفصح عن الحالة ولا تُرجع صفرًا مضلِّلًا
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_assistant_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.ai_settings; v_roles text[]; v_sources int; v_approved int;
begin
  select * into st from public.ai_settings where id;
  v_roles := coalesce(public.ai_actor_roles(), '{}'::text[]);
  select count(*)::int, count(*) filter (where status = 'approved')::int
    into v_sources, v_approved from public.ai_knowledge_sources;
  return jsonb_build_object(
    'migration', 'applied',
    'assistant_enabled', coalesce(st.assistant_enabled, false),
    'can_use_internal', coalesce(public.ai_can_use_internal(), false),
    'roles', to_jsonb(v_roles),
    'is_staff', coalesce(public.ai_is_staff(), false),
    'can_view_knowledge', coalesce(public.ai_can_view_knowledge(), false),
    'can_manage_knowledge', coalesce(public.ai_can_manage_knowledge(), false),
    'can_approve_knowledge', coalesce(public.ai_can_approve_knowledge(), false),
    'can_review_leads', coalesce(public.ai_can_review_leads(), false),
    'can_redact', coalesce(public.ai_can_redact(), false),
    'can_manage_settings', coalesce(public.ai_can_manage_settings(), false),
    'sources_total', v_sources,
    'sources_approved', v_approved,
    'knowledge_state', case when not coalesce(public.ai_can_view_knowledge(), false) then 'not_permitted'
                            when v_approved = 0 then 'empty_registry' else 'ready' end,
    'provider', public.ai_provider_describe(),
    'autonomous_actions', false,
    'tool_execution', false,
    'read_only', true
  );
end $$;

create or replace function public.ai_knowledge_list(p_status text default null, p_search text default null)
returns setof public.ai_knowledge_sources language sql stable security definer set search_path = public as $$
  select s.* from public.ai_knowledge_sources s
   where coalesce(public.ai_can_view_knowledge(), false)
     and (p_status is null or s.status = p_status)
     and (p_search is null or p_search = ''
          or s.title_ar ilike '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'
          or s.title_en ilike '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%')
   order by s.updated_at desc
   limit 200;
$$;

create or replace function public.ai_conversation_list(p_limit int default 50)
returns setof public.ai_conversations language sql stable security definer set search_path = public as $$
  select c.* from public.ai_conversations c
   where c.actor_user_id = auth.uid() or coalesce(public.ai_can_view_all_conversations(), false)
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

create or replace function public.ai_conversation_messages(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ok boolean;
begin
  select (c.actor_user_id = auth.uid() or coalesce(public.ai_can_view_all_conversations(), false))
    into v_ok from public.ai_conversations c where c.id = p_conversation;
  if not coalesce(v_ok, false) then
    raise exception 'المحادثة غير متاحة لك.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'seq', m.seq, 'role', m.role, 'content', m.content,
      'refusal_code', m.refusal_code, 'retrieved_count', m.retrieved_count,
      'confidence', m.confidence, 'provider_status', m.provider_status,
      'redaction_status', m.redaction_status, 'created_at', m.created_at,
      'citations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'source_id', ct.source_id, 'source_title', ct.source_title, 'source_type', ct.source_type,
          'source_version', ct.source_version, 'freshness_days', ct.freshness_days))
        from public.ai_message_citations ct where ct.message_id = m.id), '[]'::jsonb))
      order by m.seq)
    from public.ai_messages m where m.conversation_id = p_conversation), '[]'::jsonb);
end $$;

create or replace function public.ai_lead_list(p_status text default null, p_limit int default 100)
returns setof public.ai_lead_drafts language sql stable security definer set search_path = public as $$
  select d.* from public.ai_lead_drafts d
   where coalesce(public.ai_can_review_leads(), false)
     and (p_status is null or d.status = p_status)
   order by d.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

create or replace function public.ai_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_can boolean; v_lead boolean;
begin
  v_can := coalesce(public.ai_can_view_knowledge(), false);
  v_lead := coalesce(public.ai_can_review_leads(), false);
  return jsonb_build_object(
    'knowledge', case when not v_can then jsonb_build_object('state', 'not_permitted')
      else jsonb_build_object('state', 'ok',
        'total', (select count(*) from public.ai_knowledge_sources),
        'approved', (select count(*) from public.ai_knowledge_sources where status = 'approved'),
        'in_review', (select count(*) from public.ai_knowledge_sources where status = 'in_review'),
        'expiring_30d', (select count(*) from public.ai_knowledge_sources
                          where status = 'approved' and expires_at is not null
                            and expires_at between current_date and current_date + 30),
        'indexed_chunks', (select count(*) from public.ai_source_chunks)) end,
    'leads', case when not v_lead then jsonb_build_object('state', 'not_permitted')
      else jsonb_build_object('state', 'ok',
        'pending', (select count(*) from public.ai_lead_drafts where status = 'pending_human_review'),
        'total', (select count(*) from public.ai_lead_drafts)) end,
    'provider', public.ai_provider_describe(),
    'provider_calls', jsonb_build_object(
      'logged_attempts', (select count(*) from public.ai_provider_log),
      'external_calls', 0,
      'note', 'كلّ المحاولات مسجَّلة بحالة not_configured/disabled — لا نداء خارجيّ واحد.')
  );
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٧) RLS — الكتابة كلّها عبر الدوالّ. لا سياسة كتابة مباشرة على أيّ جدول.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.ai_settings enable row level security;
alter table public.ai_role_gate_map enable row level security;
alter table public.ai_role_source_access enable row level security;
alter table public.ai_knowledge_sources enable row level security;
alter table public.ai_source_revisions enable row level security;
alter table public.ai_source_chunks enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_message_citations enable row level security;
alter table public.ai_lead_drafts enable row level security;
alter table public.ai_public_rate_limits enable row level security;
alter table public.ai_abuse_log enable row level security;
alter table public.ai_provider_log enable row level security;
alter table public.ai_audit enable row level security;

drop policy if exists ai_settings_read on public.ai_settings;
create policy ai_settings_read on public.ai_settings for select to authenticated
  using (coalesce(public.ai_is_staff(), false));

drop policy if exists ai_role_gate_map_read on public.ai_role_gate_map;
create policy ai_role_gate_map_read on public.ai_role_gate_map for select to authenticated
  using (coalesce(public.ai_can_view_knowledge(), false));

drop policy if exists ai_role_source_access_read on public.ai_role_source_access;
create policy ai_role_source_access_read on public.ai_role_source_access for select to authenticated
  using (coalesce(public.ai_can_view_knowledge(), false));

-- ★ الترشيح الأوّل من اثنين. الثاني في شرط WHERE داخل ai_search_sources.
drop policy if exists ai_sources_read on public.ai_knowledge_sources;
create policy ai_sources_read on public.ai_knowledge_sources for select to authenticated
  using (coalesce(public.ai_can_view_knowledge(), false)
         or coalesce(public.ai_source_is_permitted(id), false));

drop policy if exists ai_source_revisions_read on public.ai_source_revisions;
create policy ai_source_revisions_read on public.ai_source_revisions for select to authenticated
  using (coalesce(public.ai_can_view_knowledge(), false));

drop policy if exists ai_source_chunks_read on public.ai_source_chunks;
create policy ai_source_chunks_read on public.ai_source_chunks for select to authenticated
  using (coalesce(public.ai_source_is_permitted(source_id), false));

drop policy if exists ai_conversations_read on public.ai_conversations;
create policy ai_conversations_read on public.ai_conversations for select to authenticated
  using (actor_user_id = auth.uid() or coalesce(public.ai_can_view_all_conversations(), false));

drop policy if exists ai_messages_read on public.ai_messages;
create policy ai_messages_read on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c
                  where c.id = conversation_id
                    and (c.actor_user_id = auth.uid()
                         or coalesce(public.ai_can_view_all_conversations(), false))));

drop policy if exists ai_message_citations_read on public.ai_message_citations;
create policy ai_message_citations_read on public.ai_message_citations for select to authenticated
  using (exists (select 1 from public.ai_messages m join public.ai_conversations c on c.id = m.conversation_id
                  where m.id = message_id
                    and (c.actor_user_id = auth.uid()
                         or coalesce(public.ai_can_view_all_conversations(), false))));

drop policy if exists ai_lead_drafts_read on public.ai_lead_drafts;
create policy ai_lead_drafts_read on public.ai_lead_drafts for select to authenticated
  using (coalesce(public.ai_can_review_leads(), false));

drop policy if exists ai_abuse_log_read on public.ai_abuse_log;
create policy ai_abuse_log_read on public.ai_abuse_log for select to authenticated
  using (coalesce(public.ai_can_review_leads(), false));

drop policy if exists ai_provider_log_read on public.ai_provider_log;
create policy ai_provider_log_read on public.ai_provider_log for select to authenticated
  using (coalesce(public.ai_is_staff(), false));

drop policy if exists ai_audit_read on public.ai_audit;
create policy ai_audit_read on public.ai_audit for select to authenticated
  using (coalesce(public.ai_can_view_all_conversations(), false));

-- ai_public_rate_limits: بلا أيّ سياسة — لا يقرؤه أحد عبر REST إطلاقًا.

-- ════════════════════════════════════════════════════════════════════════════
-- ١٨) المنح — لا anon على أيّ كائن، ولا كتابة مباشرة لأيّ دور
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare t text;
begin
  foreach t in array array[
    'ai_settings','ai_role_gate_map','ai_role_source_access','ai_knowledge_sources',
    'ai_source_revisions','ai_source_chunks','ai_conversations','ai_messages',
    'ai_message_citations','ai_lead_drafts','ai_public_rate_limits','ai_abuse_log',
    'ai_provider_log','ai_audit']
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('revoke all on public.%I from public', t);
  end loop;
  -- قراءة فقط، ومرشَّحة بـRLS. ولا جدول واحد يُمنح لـanon.
  foreach t in array array[
    'ai_settings','ai_role_gate_map','ai_role_source_access','ai_knowledge_sources',
    'ai_source_revisions','ai_source_chunks','ai_conversations','ai_messages',
    'ai_message_citations','ai_lead_drafts','ai_abuse_log','ai_provider_log','ai_audit']
  loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $g$;

do $g$
declare f text;
begin
  -- كلّ الدوالّ: تُسحب من public/anon أوّلًا، ثمّ تُمنح لمن يستحقّ فقط.
  foreach f in array array[
    'public.ai_gate(text)','public.ai_perm(text)','public.ai_is_owner()','public.ai_is_staff()',
    'public.ai_actor_roles()','public.ai_settings_row()','public.ai_can_use_internal()',
    'public.ai_can_view_knowledge()','public.ai_can_manage_knowledge()','public.ai_can_approve_knowledge()',
    'public.ai_can_view_all_conversations()','public.ai_can_redact()','public.ai_can_review_leads()',
    'public.ai_can_manage_settings()','public.ai_log(text,text,uuid,boolean,jsonb)',
    'public.ai_neutralize(text)','public.ai_detect_injection(text)','public.ai_guard_question(text)',
    'public.ai_forbidden_content(text)','public.ai_checksum(text)','public.ai_sensitivity_rank(text)',
    'public.ai_source_permitted_for(text,text,text[],text,date,date,timestamptz,text[])',
    'public.ai_source_is_permitted(uuid)','public.ai_search_sources(text,text[],int)',
    'public.ai_provider_notice()','public.ai_provider_describe()','public.ai_provider_probe(int,int)',
    'public.ai_conversation_start(text,text)',
    'public.ai_message_add(uuid,text,text,text,int,jsonb,text,text)','public.ai_ask(text,uuid)',
    'public.ai_rate_take(text,int,interval)','public.ai_captcha_verify(text)',
    'public.ai_public_ask(text,text)','public.ai_public_lead_draft(jsonb,text,text,text,text)',
    'public.ai_source_reindex(uuid)','public.ai_source_upsert(jsonb)','public.ai_source_submit(uuid)',
    'public.ai_source_approve(uuid)','public.ai_source_reject(uuid,text)','public.ai_source_archive(uuid)',
    'public.ai_sources_expire_due()','public.ai_conversation_redact(uuid,text)',
    'public.ai_conversation_delete(uuid,text)','public.ai_retention_purge_due()',
    'public.ai_conversation_escalate(uuid,text)','public.ai_lead_review(uuid,text,text)',
    'public.ai_settings_update(jsonb)','public.ai_assistant_state()',
    'public.ai_knowledge_list(text,text)','public.ai_conversation_list(int)',
    'public.ai_conversation_messages(uuid)','public.ai_lead_list(text,int)','public.ai_admin_overview()']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
  end loop;

  -- الداخليّ: للمستخدم المصادَق عليه (والبوّابات ترفض غير المخوَّل بـ42501).
  foreach f in array array[
    'public.ai_actor_roles()','public.ai_can_use_internal()','public.ai_can_view_knowledge()',
    'public.ai_can_manage_knowledge()','public.ai_can_approve_knowledge()','public.ai_can_redact()',
    'public.ai_can_review_leads()','public.ai_can_manage_settings()','public.ai_can_view_all_conversations()',
    'public.ai_assistant_state()','public.ai_ask(text,uuid)','public.ai_conversation_start(text,text)',
    'public.ai_conversation_list(int)','public.ai_conversation_messages(uuid)',
    'public.ai_conversation_escalate(uuid,text)','public.ai_conversation_redact(uuid,text)',
    'public.ai_conversation_delete(uuid,text)','public.ai_knowledge_list(text,text)',
    'public.ai_source_upsert(jsonb)','public.ai_source_submit(uuid)','public.ai_source_approve(uuid)',
    'public.ai_source_reject(uuid,text)','public.ai_source_archive(uuid)','public.ai_lead_list(text,int)',
    'public.ai_lead_review(uuid,text,text)','public.ai_settings_update(jsonb)','public.ai_admin_overview()',
    'public.ai_provider_describe()','public.ai_guard_question(text)']
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- ★ السطح العامّ يمرّ عبر الخادم وحده. لا anon، ولا authenticated: مفتاح
  --   الخدمة في مسار خادميّ هو الوحيد الذي يبلغ هاتين الدالّتين.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array[
      'public.ai_public_ask(text,text)','public.ai_public_lead_draft(jsonb,text,text,text,text)',
      'public.ai_sources_expire_due()','public.ai_retention_purge_due()']
    loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٩) البذور — أدوار · مصفوفة وصول · مفاتيح صلاحيات في الكتالوج المشترك
-- ════════════════════════════════════════════════════════════════════════════
insert into public.ai_role_gate_map (assistant_role, gate_signature, requires_staff, note) values
  ('owner',       'public.is_owner()',                      false, 'المالك'),
  ('sales',       'public.can_see_opportunities()',          true, 'المبيعات — الفرص'),
  ('sales',       'public.can_manage_quotes()',              true, 'المبيعات — عروض السعر'),
  ('operations',  'public.can_manage_projects()',            true, 'التشغيل — المشاريع'),
  ('operations',  'public.can_manage_custody()',             true, 'التشغيل — العهدة والمعدات'),
  ('collections', 'public.can_see_invoices()',               true, 'التحصيل — الفواتير'),
  ('marketing',   'public.can_view_case_studies_internal()', true, 'التسويق — دراسات الحالة'),
  ('marketing',   'public.can_edit_case_studies()',          true, 'التسويق — تحرير دراسات الحالة')
on conflict (assistant_role, gate_signature) do nothing;

-- ★ مصفوفة «من يقرأ ماذا» — صريحة، قابلة للمراجعة، وقابلة للتغيير بيانيًّا.
--   المالك وحده يبلغ 'restricted' (وفيه إرشاد التسعير)؛ المبيعات لا تبلغه؛
--   التحصيل يرى مسار التحصيل ولا يرى تكلفة ولا ربحًا؛ التشغيل بلا هامش؛
--   التسويق بلا أدلّة امتثال مقيَّدة؛ العميل والزائر: العامّ فقط.
insert into public.ai_role_source_access (assistant_role, source_type, max_sensitivity, note) values
  ('owner','public_website','internal',null), ('owner','service_catalog','internal',null),
  ('owner','faq','internal',null), ('owner','company_policy','internal',null),
  ('owner','operations_procedure','internal',null), ('owner','sales_guide','internal',null),
  ('owner','pricing_guidance','restricted','إرشاد التسعير مصدر مقيَّد ومرشَّح'),
  ('owner','compliance_guide','restricted',null), ('owner','equipment_procedure','internal',null),
  ('owner','hr_policy','restricted',null), ('owner','approved_case_study','internal',null),
  ('owner','approved_template','internal',null), ('owner','other','internal',null),

  ('sales','public_website','public',null), ('sales','service_catalog','internal',null),
  ('sales','faq','internal',null), ('sales','sales_guide','internal',null),
  ('sales','approved_case_study','internal',null), ('sales','approved_template','internal',null),
  ('sales','company_policy','internal',null),

  ('operations','public_website','public',null), ('operations','service_catalog','internal',null),
  ('operations','faq','internal',null), ('operations','operations_procedure','internal',null),
  ('operations','equipment_procedure','internal',null), ('operations','company_policy','internal',null),
  ('operations','approved_template','internal',null),

  ('collections','public_website','public',null), ('collections','faq','internal',null),
  ('collections','company_policy','internal',null), ('collections','approved_template','internal',null),

  ('marketing','public_website','public',null), ('marketing','service_catalog','internal',null),
  ('marketing','faq','internal',null), ('marketing','approved_case_study','internal',null),
  ('marketing','approved_template','internal',null),

  ('client','public_website','public',null), ('client','service_catalog','public',null),
  ('client','faq','public',null), ('client','approved_case_study','public',null),

  ('anonymous','public_website','public',null), ('anonymous','service_catalog','public',null),
  ('anonymous','faq','public',null), ('anonymous','approved_case_study','public',null)
on conflict (assistant_role, source_type) do nothing;

do $seed$
begin
  if to_regclass('public.permissions') is not null then
    insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
      ('ai.knowledge.view',          'ai_assistant', 'normal',    910, 'عرض سجلّ معرفة المساعد', 'View assistant knowledge registry'),
      ('ai.knowledge.manage',        'ai_assistant', 'sensitive', 911, 'إدارة مصادر المعرفة', 'Manage knowledge sources'),
      ('ai.knowledge.approve',       'ai_assistant', 'sensitive', 912, 'اعتماد مصادر المعرفة', 'Approve knowledge sources'),
      ('ai.conversation.view_all',   'ai_assistant', 'sensitive', 913, 'عرض كلّ محادثات المساعد', 'View all assistant conversations'),
      ('ai.conversation.redact',     'ai_assistant', 'sensitive', 914, 'تنقيح وحذف المحادثات', 'Redact and delete conversations'),
      ('ai.lead.review',             'ai_assistant', 'sensitive', 915, 'مراجعة مسوّدات العملاء المحتملين', 'Review lead drafts')
    on conflict (key) do nothing;
  end if;
end $seed$;

-- سلّة تخزين خاصّة للمرفق المرجعيّ (النصّ نفسه في content_text وهو ما يُفهرَس).
do $st$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('ai-knowledge', 'ai-knowledge', false)
    on conflict (id) do nothing;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists ai_knowledge_objects_read on storage.objects';
    execute 'create policy ai_knowledge_objects_read on storage.objects for select to authenticated
             using (bucket_id = ''ai-knowledge'' and coalesce(public.ai_can_view_knowledge(), false))';
    execute 'drop policy if exists ai_knowledge_objects_write on storage.objects';
    execute 'create policy ai_knowledge_objects_write on storage.objects for insert to authenticated
             with check (bucket_id = ''ai-knowledge'' and coalesce(public.ai_can_manage_knowledge(), false))';
    execute 'drop policy if exists ai_knowledge_objects_delete on storage.objects';
    execute 'create policy ai_knowledge_objects_delete on storage.objects for delete to authenticated
             using (bucket_id = ''ai-knowledge'' and coalesce(public.ai_can_manage_knowledge(), false))';
  end if;
end $st$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢٠) SELF-TEST — **ساكن بالكامل**. لا نداء لدالّة محميّة: تحت postgres تكون
--     auth.uid() فارغة، فالبوّابة تعيد false ويُقرأ ذلك خطأً على أنّه عطل. هذا
--     بالضبط ما كسر ترحيلتين في هذا المستودع. نقرأ الكتالوج بدل أن ننفّذ.
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- ai_exec_code — الشيفرة التنفيذية وحدها: التعليقات تُحذف ومحتوى السلاسل
--   يُفرَّغ. ذكرُ اسم دالّة في شرحٍ أو رسالةٍ ليس نداءً لها، وترتيبُ الكلمات
--   في النصّ ليس ترتيب التنفيذ.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.ai_exec_code(p_src text)
returns text language plpgsql immutable set search_path = public as $aix$
declare i int := 1; n int := length(coalesce(p_src,'')); ch text; nx text;
        q boolean := false; c boolean := false; out text := '';
begin
  while i <= n loop
    ch := substr(p_src, i, 1); nx := substr(p_src, i+1, 1);
    if c then
      if ch = chr(10) then c := false; out := out || chr(10); end if;
      i := i + 1; continue;
    end if;
    if q then
      if ch = '''' and nx = '''' then i := i + 2; continue; end if;
      if ch = '''' then q := false; out := out || ''''''; end if;
      i := i + 1; continue;
    end if;
    if ch = '-' and nx = '-' then c := true; i := i + 2; continue; end if;
    if ch = '''' then q := true; i := i + 1; continue; end if;
    out := out || ch; i := i + 1;
  end loop;
  return out;
end $aix$;

revoke all on function public.ai_exec_code(text) from public;
revoke all on function public.ai_exec_code(text) from anon;
revoke all on function public.ai_exec_code(text) from authenticated;

do $selftest$
declare v_missing text := ''; v_n int; f text;
begin
  -- (١) الجداول الأربعة عشر موجودة
  foreach f in array array[
    'ai_settings','ai_role_gate_map','ai_role_source_access','ai_knowledge_sources',
    'ai_source_revisions','ai_source_chunks','ai_conversations','ai_messages',
    'ai_message_citations','ai_lead_drafts','ai_public_rate_limits','ai_abuse_log',
    'ai_provider_log','ai_audit']
  loop
    if to_regclass('public.' || f) is null then v_missing := v_missing || ' جدول:' || f; end if;
  end loop;

  -- (٢) لا عمود يخزّن سلسلة تفكير أو نصّ نظام
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name in ('ai_messages','ai_conversations')
     and (column_name ~* '(thought|reason|chain|scratch|system_prompt|internal_prompt|raw_context)');
  if v_n > 0 then v_missing := v_missing || ' عمود-سلسلة-تفكير'; end if;

  -- (٣) كلّ دوالّ الحزمة SECURITY DEFINER بـsearch_path مثبَّت (عدا النقيّة IMMUTABLE)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and p.provolatile <> 'i'
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%');
  if v_n > 0 then v_missing := v_missing || ' دالّة-بلا-definer-أو-search_path(' || v_n || ')'; end if;

  -- (٤) لا صلاحية تنفيذ لدور anon على أيّ دالّة ai_
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_n > 0 then v_missing := v_missing || ' anon-ينفّذ(' || v_n || ')'; end if;

  -- (٥) لا صلاحية جدولية لدور anon على أيّ جدول ai_
  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'ai\_%' and grantee = 'anon';
  if v_n > 0 then v_missing := v_missing || ' anon-على-جدول(' || v_n || ')'; end if;

  -- (٦) RLS مفعَّل على الجداول الأربعة عشر
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'ai\_%' and c.relkind = 'r' and not c.relrowsecurity;
  if v_n > 0 then v_missing := v_missing || ' جدول-بلا-RLS(' || v_n || ')'; end if;

  -- (٧) لا سياسة كتابة مباشرة: الكتابة كلّها عبر دوالّ definer
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename like 'ai\_%' and cmd in ('INSERT','UPDATE','DELETE','ALL');
  if v_n > 0 then v_missing := v_missing || ' سياسة-كتابة-مباشرة(' || v_n || ')'; end if;

  -- (٨) الحارس والاسترجاع والمُسنَدات موجودة بتوقيعاتها
  foreach f in array array[
    'public.ai_guard_question(text)','public.ai_search_sources(text,text[],int)',
    'public.ai_ask(text,uuid)','public.ai_public_lead_draft(jsonb,text,text,text,text)',
    'public.ai_provider_probe(int,int)','public.ai_neutralize(text)']
  loop
    if to_regprocedure(f) is null then v_missing := v_missing || ' دالّة:' || f; end if;
  end loop;

  -- (٩) ai_ask يمنع **قبل** الاسترجاع: نصّ المصدر يُقرأ من الكتالوج ويُتحقّق
  --     أنّ العودة عند المنع تسبق أوّل ذكر لـai_search_sources.
  --  ⚠️ كان هذا الفحص يقارن **مواضع نصّية** في pg_get_functiondef الخام:
  --       position('blocked_by_guard') > position('ai_search_sources')
  --     فأسقط الترحيلة. والسبب أنّ **التعليق** الذي يوثّق أنّه «لا نداء
  --     لـai_search_sources في فرع المنع» يذكر الاسم قبل الرمز، فبدا الاسترجاع
  --     سابقًا للحارس. أي أنّ الشرحَ الذي ينفي الاسترجاع أُدين به.
  --     وترتيبُ ظهور الكلمات ليس ترتيب التنفيذ أصلًا؛ فالقياس الآن على
  --     **الشيفرة التنفيذية**: نداء الحارس، ثمّ عودةٌ مغلقة في فرع المنع،
  --     ثمّ أوّل نداء استرجاع — بهذا الترتيب، وإلّا فشل.
  if to_regprocedure('public.ai_ask(text,uuid)') is not null then
    declare
      src  text := public.ai_exec_code(pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)')));
      p_g  int; p_ret int; p_ret2 int; p_ret_stmt int;
    begin
      p_g   := coalesce(position('ai_guard_question(' in src), 0);
      p_ret := coalesce(position('ai_search_sources(' in src), 0);
      -- أوّل `return` بعد الحارس: فرع المنع يجب أن يخرج قبل أيّ استرجاع.
      p_ret_stmt := case when p_g = 0 then 0
                    else coalesce(nullif(position('return ' in substr(src, p_g)), 0), 0) + p_g - 1 end;
      if p_g = 0 then
        v_missing := v_missing || ' لا-نداء-للحارس-في-ai_ask';
      elsif p_ret = 0 then
        v_missing := v_missing || ' لا-استرجاع-في-ai_ask';   -- تغيّر العقد: يُراجَع
      elsif p_g > p_ret then
        v_missing := v_missing || ' ترتيب-الحارس-قبل-الاسترجاع';
      elsif p_ret_stmt = 0 or p_ret_stmt > p_ret then
        v_missing := v_missing || ' فرع-المنع-لا-يعود-قبل-الاسترجاع';
      end if;
      -- ولا مسار ثانٍ للاسترجاع يلتفّ على الحارس.
      p_ret2 := case when p_ret = 0 then 0
                else coalesce(nullif(position('ai_search_sources(' in substr(src, p_ret + 1)), 0), 0) end;
      if p_ret2 > 0 and p_g > p_ret then
        v_missing := v_missing || ' مسار-استرجاع-ثانٍ-بلا-حارس';
      end if;
    end;
  end if;
  if false then
    declare src text := '';
    begin
      null;
    end;
  end if;
  -- ولا SQL ديناميكيّ في مسار السؤال: EXECUTE يفتح بابًا لا يقفله الحارس.
  if to_regprocedure('public.ai_ask(text,uuid)') is not null
     and position('execute ' in lower(public.ai_exec_code(
           pg_get_functiondef(to_regprocedure('public.ai_ask(text,uuid)'))))) > 0 then
    v_missing := v_missing || ' ai_ask-يستعمل-EXECUTE';
  end if;

  -- (١٠) القيود الحرجة قائمة بالاسم
  foreach f in array array[
    'ai_sources_external_public_only','ai_sources_restricted_owner_only',
    'ai_sources_approved_is_complete','ai_sources_approver_not_submitter',
    'ai_sources_storage_is_pinned','ai_messages_role_known','ai_messages_grounded_or_refusal',
    'ai_role_source_access_external_public_only','ai_conversations_public_has_no_user']
  loop
    if not exists (select 1 from pg_constraint where conname = f) then
      v_missing := v_missing || ' قيد:' || f;
    end if;
  end loop;

  -- (١١) المزوّد مطفأ عند التثبيت
  if exists (select 1 from public.ai_settings where id and provider_enabled) then
    v_missing := v_missing || ' المزوّد-مفعّل-عند-التثبيت';
  end if;

  -- (١٢) مصفوفة الوصول لا تمنح الخارجيّ شيئًا غير العامّ
  select count(*) into v_n from public.ai_role_source_access
   where assistant_role in ('client','anonymous') and max_sensitivity <> 'public';
  if v_n > 0 then v_missing := v_missing || ' خارجيّ-يبلغ-الداخليّ(' || v_n || ')'; end if;

  -- (١٣) السطح العامّ يفشل مغلقًا عند طلب CAPTCHA غير منفَّذ. فحص ساكن على
  --      نصّ الدالّة: لو عاد يومًا يقبل بحالة 'not_configured' لصار سطحًا
  --      عامًّا يكتب صفوفًا بلا تحقّق وهو يزعم أنّه محميّ.
  if to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)') is not null then
    declare srcl text := pg_get_functiondef(to_regprocedure('public.ai_public_lead_draft(jsonb,text,text,text,text)'));
    begin
      if position('captcha_not_verified' in srcl) = 0 then
        v_missing := v_missing || ' CAPTCHA-بلا-فشل-مغلق';
      end if;
      -- لا إرسال من السطح العامّ بأيّ شكل.
      if lower(srcl) ~ '(notify_|email_outbox|send_email|comms_send|whatsapp)' then
        v_missing := v_missing || ' السطح-العامّ-يرسل';
      end if;
    end;
  end if;

  -- (١٤) لا دالّة في الحزمة تُنشئ عميلًا أو فرصة أو عرض سعر أو مشروعًا.
  --      المساعد يقرأ ويصنع مسوّدة تنتظر إنسانًا — لا أكثر.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ai\_%'
     and lower(pg_get_functiondef(p.oid)) ~
         'insert[[:space:]]+into[[:space:]]+(public\.)?(projects|project_core|deliverables|crm_leads|crm_opportunities|opportunity_requests|sq_quotes|invoices|clients)\y';
  if v_n > 0 then v_missing := v_missing || ' دالّة-تُنشئ-كيانًا-تشغيليًّا(' || v_n || ')'; end if;

  if v_missing <> '' then
    raise exception 'SELF-TEST فشل:%', v_missing;
  end if;
  raise notice 'SELF-TEST نجح — مساعد كيان: البنية قائمة، المزوّد مطفأ، ولا صلاحية anon.';
end $selftest$;

commit;
