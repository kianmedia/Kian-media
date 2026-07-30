-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_RUNME.sql
--
-- المراحل ٦+٧+٨+٩+١٠ من برنامج النموّ التجاريّ:
--   ٦) تقييم العملاء المحتملين — محرّك قواعد **مُفسَّر** لا صندوق أسود.
--   ٧) التوزيع — مُفسَّر، حتميّ، ولا عشوائية فيه.
--   ٨) اللوحات الأربع (المالك · المبيعات · العميل · طابور العمليات).
--   ٩) عقود ما بين الموديولات (بيانات لا كتابة متبادلة).
--  ١٠) أحداث الإشعارات — تُعرَّف وتُدرَج في الطابور، ولا تُرسَل.
--
-- ★ ترحيلة واحدة، معاملة واحدة، قابلة لإعادة التشغيل (idempotent).
-- ★ لا CONCURRENTLY. لا استدعاء خارجيّ. لا ذكاء اصطناعيّ. لا شبكة.
--
-- ─── ما لا يفعله هذا الملفّ، بالنصّ لا بالنيّة ──────────────────────────────
--  ١) لا يُنشئ مشروعًا، ولا يعدّل منصّة المشاريع المجمَّدة، ولا يغيّر مرحلة،
--     ولا يُنشئ تسليمًا. مسار CRM ينتهي عند «جاهز للتسليم اليدويّ».
--  ٢) لا يُنشئ فاتورة حقيقية، ولا ينادي Zoho، ولا يدّعي تحصيلًا، ولا يعترف
--     بإيراد. المالية هنا **مرجع للقراءة فقط**.
--  ٣) لا يُرسل بريدًا ولا واتساب ولا SMS. الأحداث تُدرَج بـdry_run = true.
--  ٤) لا يستعمل can_manage_projects ولا is_kian_member كبوّابة.
--  ٥) ⛔ لا يقرأ ولا يخزّن أيّ صفة شخصية حسّاسة (الجنس · العمر · الجنسية).
--     الدرجة تجاريّة عن **فرصة**، لا حكم على **إنسان**. القيد يمنع، لا التعليق.
--
-- ─── الاعتماديات ────────────────────────────────────────────────────────────
--  صلبة   : crm_sales_FOUNDATION_RUNME.sql (crm_leads · crm_activities ·
--           crm_companies · مُسنَدات crm_*) · public.clients · auth.users ·
--           is_staff() · is_owner() · is_admin().
--  اختيارية (تُكتشَف وقت التشغيل، وغيابها يُعلَن بصدق لا يُقرأ صفرًا):
--           csub_* (الاشتراكات) · sq_* (عروض الأسعار) · fin_* (المالية) ·
--           comms_* (مركز الاتصالات) · emp_has_permission (محرّك الصلاحيات).
--
--  شغّل docs/lead_scoring_routing_PREFLIGHT.sql أوّلًا: يُثبت الترتيب ولا يفترضه.
-- ════════════════════════════════════════════════════════════════════════════

begin;

set local statement_timeout = '15min';
set local lock_timeout = '60s';
set local idle_in_transaction_session_timeout = '15min';

-- ════════════════════════════════════════════════════════════════════════════
-- §1) بوّابة الدخول — الاعتماديات الصلبة تُفحَص هنا كي تفشل الترحيلة برسالة
--     مفهومة بدل أن تفشل لاحقًا برسالة كتالوج غامضة.
-- ════════════════════════════════════════════════════════════════════════════
do $guard$
declare v_missing text := '';
begin
  if to_regclass('public.crm_leads') is null then
    v_missing := v_missing || ' public.crm_leads'; end if;
  if to_regclass('public.crm_activities') is null then
    v_missing := v_missing || ' public.crm_activities'; end if;
  if to_regclass('public.crm_companies') is null then
    v_missing := v_missing || ' public.crm_companies'; end if;
  if to_regclass('public.clients') is null then
    v_missing := v_missing || ' public.clients'; end if;
  if to_regprocedure('public.is_staff()') is null then
    v_missing := v_missing || ' public.is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then
    v_missing := v_missing || ' public.is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then
    v_missing := v_missing || ' public.is_admin()'; end if;

  if length(v_missing) > 0 then
    raise exception
      'LSR: اعتماديات صلبة غائبة:%. شغّل docs/crm_sales_FOUNDATION_RUNME.sql أوّلًا، ثم أعد المحاولة.',
      v_missing;
  end if;
end $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) مُسنَدات الجلسة — كلّها boolean صريح، ولا واحد منها يعيد NULL.
--     ⚠️ لا can_manage_projects ولا is_kian_member: هذا موديول تجاريّ.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (fail-closed) لا استثناء،
-- والمصيدة تُفشِل ولا تُنجِح.
create or replace function public.lsr_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then
  return false;
end $$;

-- المالك/الأدمن — الطبقة التي لا تُشترى بمفتاح.
create or replace function public.lsr_is_owner_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null)
    and (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)), false);
$$;

-- مدير المبيعات: المالك، أو حامل مفتاح إدارة المبيعات الصريح.
create or replace function public.lsr_is_sales_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_owner_role(), false)
      or coalesce(public.lsr_perm('crm.manage'), false)
      or coalesce(public.lsr_perm('lead.manage_routing'), false)),
  false);
$$;

-- من يفتح الموديول: موظّف فقط. العميل والزائر خارج بوّابة التقييم نهائيًّا.
create or replace function public.lsr_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_sales_manager(), false)
      or coalesce(public.lsr_perm('crm.view'), false)
      or coalesce(public.lsr_perm('lead.view'), false)),
  false);
$$;

-- تحرير قواعد التقييم ونشر إصدار جديد.
create or replace function public.lsr_can_manage_scoring() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_owner_role(), false)
      or coalesce(public.lsr_perm('crm.manage_scoring'), false)
      or coalesce(public.lsr_perm('lead.manage_scoring'), false)),
  false);
$$;

-- ★ التعديل اليدويّ للدرجة: مفتاح مستقلّ. من يرى الدرجة لا يعدّلها بالضرورة.
create or replace function public.lsr_can_override_score() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_owner_role(), false)
      or coalesce(public.lsr_perm('lead.override_score'), false)
      or coalesce(public.lsr_perm('crm.manage_scoring'), false)),
  false);
$$;

-- توزيع عميل محتمل **بلا مالك** أو تشغيل التوزيع التلقائيّ.
create or replace function public.lsr_can_route() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_sales_manager(), false)
      or coalesce(public.lsr_perm('lead.route'), false)),
  false);
$$;

-- ★★ تغيير مالك عميل **له مالك بالفعل**: صلاحية أعلى ومنفصلة عن التوزيع.
--    هذا هو الفرق بين «وزّع الجديد» و«انتزع من زميلك».
create or replace function public.lsr_can_reassign() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_owner_role(), false)
      or coalesce(public.lsr_perm('lead.reassign'), false)),
  false);
$$;

-- ★ لوحة المالك التجارية: **المالك وحده**، بلا مفتاح. لو كانت مفتاحًا لأمكن
--   منحها، ولانتهت «القيمة التعاقدية السنوية» إلى منحة إدارية.
create or replace function public.lsr_can_view_owner_dashboard() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and coalesce(public.is_staff(), false)
    and coalesce(public.lsr_is_owner_role(), false), false);
$$;

-- طابور العمليات: تشغيليّ بحت وبلا ماليّة حسّاسة، فبوّابته أوسع بقصد.
create or replace function public.lsr_can_view_ops_queue() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.lsr_is_sales_manager(), false)
      or coalesce(public.lsr_perm('commercial.operations_queue'), false)
      or coalesce(public.lsr_perm('crm.view'), false)),
  false);
$$;

-- تصريح صريح بأنّ صاحب الجلسة عميل/زائر.
create or replace function public.lsr_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول.
--     ملاحظة ترتيب: المُسنَدات التي تقرأ جداول تأتي **بعد** الجداول، لأنّ
--     PostgreSQL يتحقّق من أجسام دوالّ SQL لحظة الإنشاء.
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 إعدادات الموديول — العتبات معلَنة وقابلة للتحرير، لا مدفونة في الكود.
create table if not exists public.lsr_settings (
  key        text primary key,
  value      jsonb not null,
  label_ar   text not null default '',
  label_en   text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.lsr_settings (key, value, label_ar, label_en) values
  ('grade_a_min',            '75'::jsonb,   'الحدّ الأدنى للتصنيف A', 'Grade A minimum'),
  ('grade_b_min',            '55'::jsonb,   'الحدّ الأدنى للتصنيف B', 'Grade B minimum'),
  ('grade_c_min',            '35'::jsonb,   'الحدّ الأدنى للتصنيف C', 'Grade C minimum'),
  ('review_min_completeness','50'::jsonb,   'أدنى اكتمال بيانات بلا مراجعة', 'Min completeness without review'),
  ('responsive_days',        '7'::jsonb,    'مدى «سريع الاستجابة» بالأيّام', 'Responsive window (days)'),
  ('unresponsive_attempts',  '3'::jsonb,    'محاولات بلا ردّ تُعدّ عدم استجابة', 'Attempts before unresponsive'),
  ('agent_default_capacity', '25'::jsonb,   'سعة المندوب الافتراضية', 'Default agent capacity'),
  ('allow_self_claim',       'false'::jsonb,'السماح للمندوب بأخذ عميل بلا مالك', 'Allow rep self-claim'),
  ('stale_quote_days',       '14'::jsonb,   'عمر عرض السعر الراكد', 'Stale quote age (days)'),
  ('followup_overdue_days',  '3'::jsonb,    'تأخّر المتابعة بالأيّام', 'Follow-up overdue (days)'),
  ('high_value_min_score',   '75'::jsonb,   'أدنى درجة لعميل عالي القيمة', 'High-value lead min score'),
  ('score_scan_limit',       '300'::jsonb,  'سقف الصفوف في المسح الجماعيّ', 'Bulk scan row cap')
on conflict (key) do nothing;

-- 3.2 ★★ كتالوج العوامل ★★ القائمة البيضاء الوحيدة لمدخلات التقييم.
--     قاعدة لا تشير إلى عامل هنا لا تُحفظ أصلًا (مفتاح أجنبيّ).
--     ⛔ والقيد أدناه يمنع — نصًّا لا تعليقًا — أيّ صفة شخصية حسّاسة.
create table if not exists public.lsr_factors (
  key          text primary key,
  label_ar     text not null default '',
  label_en     text not null default '',
  value_kind   text not null check (value_kind in ('text','num','bool')),
  origin       text not null check (origin in ('crm_lead','profile','derived')),
  -- عامل «مطلوب»: غيابه يظهر في missing_information ويخفض اكتمال البيانات.
  required_for_score boolean not null default false,
  note_ar      text not null default '',
  is_active    boolean not null default true,
  sort_order   int not null default 100,
  created_at   timestamptz not null default now(),
  -- ★ الحارس ★ الدرجة تجاريّة عن فرصة. أيّ مفتاح يلمّح إلى صفة شخصية حسّاسة
  --   يُرفَض عند الإدراج. لا يمكن «تفعيل» عامل ممنوع لاحقًا لأنّه لا يُخزَّن.
  constraint lsr_factor_no_sensitive_attribute check (
    key !~* '(gender|sex_|nationality|national_origin|ethnic|race|religio|marital|birth|disab|^age$|^age_|_age$|age_group|age_band)'
    and label_en !~* '(gender|nationality|ethnic|religion|marital status|date of birth)'
  )
);
comment on table public.lsr_factors is
  'القائمة البيضاء لمدخلات التقييم. تجارية بحتة عن الفرصة. القيد يمنع أيّ صفة شخصية حسّاسة (الجنس/العمر/الجنسية) بنيويًّا لا بالنيّة.';

insert into public.lsr_factors (key, label_ar, label_en, value_kind, origin, required_for_score, note_ar, sort_order) values
  ('budget_range',           'مدى الميزانية',          'Budget range',            'text','crm_lead', true,  'من crm_leads.budget_band', 10),
  ('organization_type',      'نوع الجهة',              'Organization type',       'text','profile',  true,  'حكوميّ/شبه حكوميّ/شركة/منشأة صغيرة/وكالة/جمعية/فرد', 20),
  ('company_size',           'حجم الشركة',             'Company size',            'text','crm_lead', false, 'من crm_leads.company_size', 30),
  ('service_type',           'نوع الخدمة',             'Service type',            'text','profile',  true,  'نوع الإنتاج المطلوب', 40),
  ('locations_count',        'عدد المواقع',            'Number of locations',     'num', 'profile',  false, 'عدد مواقع التصوير', 50),
  ('cities_count',           'عدد المدن',              'Number of cities',        'num', 'profile',  false, 'انتشار جغرافيّ يرفع التعقيد والقيمة', 60),
  ('urgency',                'درجة الاستعجال',         'Urgency',                 'text','profile',  false, 'استعجال معلَن من العميل', 70),
  ('desired_delivery_days',  'مدّة التسليم المطلوبة',  'Desired delivery (days)', 'num', 'profile',  false, 'أيّام حتى التسليم المرغوب', 80),
  ('data_completeness',      'اكتمال البيانات',        'Data completeness',       'num', 'derived',  false, 'نسبة مئوية مشتقّة — لا تُدخَل يدويًّا', 90),
  ('lead_source',            'مصدر العميل',            'Lead source',             'text','crm_lead', false, 'من crm_leads.source', 100),
  ('existing_client',        'عميل حاليّ',             'Existing client',         'bool','derived',  false, 'مرجع صريح إلى clients، لا تخمين بالاسم', 110),
  ('retainer_potential',     'احتمال عقد مستمرّ',      'Retainer potential',      'text','profile',  false, 'none/possible/likely/confirmed_interest', 120),
  ('annual_value_potential', 'القيمة السنوية المحتملة','Annual value potential',  'num', 'profile',  false, 'تقدير تجاريّ بالريال', 130),
  ('production_complexity',  'تعقيد الإنتاج',          'Production complexity',   'text','profile',  false, 'simple/standard/complex/very_complex', 140),
  ('territory',              'الإقليم',                'Territory',               'text','derived',  false, 'من الملفّ، أو من خريطة المدن عند غيابه', 150),
  ('strategic_sector',       'قطاع استراتيجيّ',        'Strategic sector',        'bool','profile',  false, 'قطاع تستهدفه الشركة هذا العام', 160),
  ('previous_lost_reason',   'سبب الخسارة السابقة',    'Previous lost reason',    'text','profile',  false, 'إن سبق التعامل وخُسر', 170),
  ('response_behaviour',     'سلوك الاستجابة',         'Response behaviour',      'text','derived',  false, 'مشتقّ من crm_activities — لا يُدخَل يدويًّا', 180)
on conflict (key) do update set
  label_ar = excluded.label_ar, label_en = excluded.label_en,
  value_kind = excluded.value_kind, origin = excluded.origin,
  required_for_score = excluded.required_for_score,
  note_ar = excluded.note_ar, sort_order = excluded.sort_order;

-- 3.3 إصدارات مجموعة القواعد — ★ كلّ قاعدة مُصدَّرة ★
--     المنشور لا يُعدَّل: التعديل يستنسخ مسوّدة جديدة. وإلّا صارت الدرجة
--     المحفوظة في التاريخ بلا معنى لأنّ قواعدها تغيّرت تحتها.
create table if not exists public.lsr_rulesets (
  version      int primary key check (version >= 1),
  status       text not null default 'draft' check (status in ('draft','published','retired')),
  note_ar      text not null default '',
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  retired_at   timestamptz,
  constraint lsr_ruleset_published_stamp check
    (status <> 'published' or published_at is not null)
);

-- 3.4 القواعد — الحقل والمشغِّل من قائمة بيضاء ثابتة. لا SQL ديناميكيّ من
--     مدخلات المستخدم، ولا معادلة مخفيّة.
create table if not exists public.lsr_rules (
  id             uuid primary key default gen_random_uuid(),
  ruleset_version int not null references public.lsr_rulesets(version) on delete cascade,
  key            text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  factor_key     text not null references public.lsr_factors(key) on delete restrict,
  operator       text not null check (operator in
                   ('equals','not_equals','in','not_in','gte','lte','gt','lt','between','not_empty','is_true','is_false')),
  value_text     text,
  value_num      numeric,
  value_num2     numeric,
  value_list     text[],
  points         int not null default 0 check (points between -40 and 40),
  label_ar       text not null default '',
  label_en       text not null default '',
  is_active      boolean not null default true,
  sort_order     int not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_lsr_rule_key unique (ruleset_version, key),
  -- قاعدة «بين» بلا حدّين ليست قاعدة، بل صمت يُقرأ صفرًا.
  constraint lsr_rule_between_bounds check
    (operator <> 'between' or (value_num is not null and value_num2 is not null and value_num2 >= value_num)),
  constraint lsr_rule_list_present check
    (operator not in ('in','not_in') or (value_list is not null and array_length(value_list, 1) >= 1)),
  constraint lsr_rule_num_present check
    (operator not in ('gte','lte','gt','lt') or value_num is not null),
  constraint lsr_rule_text_present check
    (operator not in ('equals','not_equals') or value_text is not null)
);
create index if not exists ix_lsr_rules_ver on public.lsr_rules(ruleset_version, sort_order, key);

-- 3.5 الملفّ التجاريّ للعميل المحتمل — ★ جدول جانبيّ ★
--     لا نلمس crm_leads بنيويًّا: موديول المبيعات منتهٍ، والإضافة الآمنة
--     إضافة جدول لا تعديل جدول. المفتاح الأساسيّ هو معرّف العميل نفسه.
create table if not exists public.lsr_lead_profile (
  lead_id              uuid primary key references public.crm_leads(id) on delete cascade,
  organization_type    text check (organization_type is null or organization_type in
                         ('government','semi_government','corporate','sme','startup','agency','ngo','individual','other')),
  service_type         text check (service_type is null or service_type in
                         ('corporate_film','commercial_ad','documentary','event_coverage','social_content',
                          'live_stream','photography','animation_motion','training_content','podcast','other')),
  locations_count      int check (locations_count is null or locations_count between 0 and 500),
  cities_count         int check (cities_count is null or cities_count between 0 and 200),
  urgency              text check (urgency is null or urgency in ('low','normal','high','immediate')),
  desired_delivery_days int check (desired_delivery_days is null or desired_delivery_days between 0 and 3650),
  retainer_potential   text check (retainer_potential is null or retainer_potential in
                         ('none','possible','likely','confirmed_interest')),
  annual_value_potential numeric(14,2) check (annual_value_potential is null or annual_value_potential >= 0),
  currency             text not null default 'SAR' check (currency = 'SAR'),
  production_complexity text check (production_complexity is null or production_complexity in
                         ('simple','standard','complex','very_complex')),
  territory            text,
  strategic_sector     boolean,
  previous_lost_reason text check (previous_lost_reason is null or previous_lost_reason in
                         ('price','timeline','scope','competitor','no_budget','no_decision','quality_concern','other')),
  -- ★ «عميل حاليّ» مرجع صريح لا تخمين بالاسم: التطابق النصيّ ينتج ادّعاءً.
  existing_client_id   uuid references public.clients(id) on delete set null,
  notes                text,
  updated_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.lsr_lead_profile is
  'السمات التجارية الإضافية للعميل المحتمل. جدول جانبيّ عمدًا: crm_leads لا يُعدَّل بنيويًّا. ولا عمود هنا يحمل صفة شخصية حسّاسة.';

-- 3.6 خريطة المدن إلى الأقاليم — بيانات لا كود.
create table if not exists public.lsr_territories (
  city_norm  text primary key,
  territory  text not null,
  label_ar   text not null default '',
  is_active  boolean not null default true
);
insert into public.lsr_territories (city_norm, territory, label_ar) values
  ('الرياض','central','الرياض'), ('riyadh','central','الرياض'),
  ('الخرج','central','الخرج'),   ('القصيم','central','القصيم'), ('بريدة','central','بريدة'),
  ('جدة','western','جدة'),       ('jeddah','western','جدة'),
  ('مكة','western','مكة'),       ('makkah','western','مكة'),
  ('المدينة','western','المدينة'),('medina','western','المدينة'),
  ('الطائف','western','الطائف'), ('ينبع','western','ينبع'),
  ('الدمام','eastern','الدمام'), ('dammam','eastern','الدمام'),
  ('الخبر','eastern','الخبر'),   ('khobar','eastern','الخبر'),
  ('الظهران','eastern','الظهران'),('الجبيل','eastern','الجبيل'), ('الأحساء','eastern','الأحساء'),
  ('أبها','southern','أبها'),    ('abha','southern','أبها'),
  ('خميس مشيط','southern','خميس مشيط'), ('جازان','southern','جازان'), ('نجران','southern','نجران'),
  ('تبوك','northern','تبوك'),    ('tabuk','northern','تبوك'),
  ('حائل','northern','حائل'),    ('عرعر','northern','عرعر'), ('سكاكا','northern','سكاكا'),
  ('نيوم','northern','نيوم'),    ('neom','northern','نيوم')
on conflict (city_norm) do nothing;

-- 3.7 التعديل اليدويّ للدرجة — ★ بسبب مكتوب وقيد تدقيق ★
--     صفّ واحد لكلّ عميل محتمل: الحالة الحاليّة. والتاريخ كلّه في lsr_audit.
create table if not exists public.lsr_score_manual (
  lead_id         uuid primary key references public.crm_leads(id) on delete cascade,
  adjust_points   int not null default 0 check (adjust_points between -40 and 40),
  adjust_reason   text,
  override_score  int check (override_score is null or override_score between 0 and 100),
  override_reason text,
  set_by          uuid references auth.users(id),
  set_at          timestamptz not null default now(),
  -- ★ لا تعديل بلا سبب. القيد يفرضه، فلا تكفي «نيّة» الواجهة.
  constraint lsr_manual_adjust_reason check
    (adjust_points = 0 or coalesce(btrim(adjust_reason), '') <> ''),
  constraint lsr_manual_override_reason check
    (override_score is null or coalesce(btrim(override_reason), '') <> '')
);

-- 3.8 سجلّ المندوبين — التخصّص والسعة والإتاحة. بلا هذا لا معنى لـ«حِمل».
create table if not exists public.lsr_agents (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null default '',
  is_active      boolean not null default true,
  is_available   boolean not null default true,
  unavailable_reason text,
  unavailable_until  date,
  territories    text[] not null default '{}',
  cities         text[] not null default '{}',
  services       text[] not null default '{}',
  max_open_leads int not null default 25 check (max_open_leads between 0 and 500),
  priority       int not null default 100 check (priority between 1 and 999),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.lsr_agents is
  'سجلّ مندوبي المبيعات للتوزيع. عضويّته لا تمنح صلاحية: الصلاحيات في محرّك الصلاحيات وحده.';

-- 3.9 قواعد التوزيع — مرتّبة، مُفسَّرة، ولا عشوائية.
create table if not exists public.lsr_routing_rules (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique check (key ~ '^[a-z0-9_]{2,60}$'),
  label_ar      text not null default '',
  label_en      text not null default '',
  rule_order    int not null default 100,
  -- شروط المطابقة: NULL = «لا يهمّ». ولا تُقرأ NULL أبدًا كـ«لا يطابق».
  match_territory text,
  match_city      text,
  match_service   text,
  match_source    text,
  match_min_score int check (match_min_score is null or match_min_score between 0 and 100),
  match_grades    text[],
  -- الهدف: تخصّص، أو أقلّ حِملًا، أو شخص بعينه.
  target_mode   text not null default 'specialist_least_loaded' check (target_mode in
                  ('specialist_least_loaded','least_loaded','fixed_user','review_only')),
  target_user_id uuid references auth.users(id) on delete set null,
  is_active     boolean not null default true,
  version       int not null default 1 check (version >= 1),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint lsr_routing_fixed_target check
    (target_mode <> 'fixed_user' or target_user_id is not null)
);
create index if not exists ix_lsr_routing_order on public.lsr_routing_rules(rule_order, key) where is_active;

-- 3.10 تاريخ الإسناد — ★ كلّ حقل طلبه العقد موجود هنا صراحةً ★
create table if not exists public.lsr_assignments (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.crm_leads(id) on delete cascade,
  assigned_to     uuid references auth.users(id) on delete set null,
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid references auth.users(id) on delete set null,
  previous_owner  uuid references auth.users(id) on delete set null,
  routing_rule    text,
  routing_reason  text not null default '',
  routing_mode    text not null default 'auto' check (routing_mode in ('auto','manual','override','self_claim','review')),
  overridden_by   uuid references auth.users(id) on delete set null,
  override_reason text,
  score_at_assign int check (score_at_assign is null or score_at_assign between 0 and 100),
  grade_at_assign text check (grade_at_assign is null or grade_at_assign in ('A','B','C','D')),
  candidates      jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  -- ★ التجاوز بلا سبب ليس تجاوزًا بل انتزاعًا صامتًا.
  constraint lsr_assign_override_reason check
    (overridden_by is null or coalesce(btrim(override_reason), '') <> '')
);
create index if not exists ix_lsr_assign_lead on public.lsr_assignments(lead_id, assigned_at desc);
create index if not exists ix_lsr_assign_to   on public.lsr_assignments(assigned_to, assigned_at desc);

-- 3.11 طابور المراجعة — العميل المجهول أو الناقص لا يُوزَّع، بل يُوقَف هنا.
create table if not exists public.lsr_review_queue (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.crm_leads(id) on delete cascade,
  state        text not null default 'pending' check (state in ('pending','resolved','dismissed')),
  reasons      text[] not null default '{}',
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  resolved_by  uuid references auth.users(id),
  resolved_at  timestamptz,
  resolution_note text
);
create unique index if not exists uq_lsr_review_open
  on public.lsr_review_queue(lead_id) where state = 'pending';
create index if not exists ix_lsr_review_state on public.lsr_review_queue(state, created_at desc);

-- 3.12 التدقيق — كلّ كتابة حسّاسة تترك أثرًا.
create table if not exists public.lsr_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  reason      text,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists ix_lsr_audit_at on public.lsr_audit(at desc);
create index if not exists ix_lsr_audit_entity on public.lsr_audit(entity_type, entity_id, at desc);

-- 3.13 سجلّ أحداث الإشعارات — ★ مفتاح التكرار هنا هو الحارس الحقيقيّ ★
--      حتّى لو تغيّر مفتاح الطابور، حدث واحد لا يُدرَج مرّتين.
create table if not exists public.lsr_event_log (
  id              uuid primary key default gen_random_uuid(),
  event_key       text not null,
  idempotency_key text not null,
  entity_type     text,
  entity_id       uuid,
  actor_id        uuid references auth.users(id),
  payload         jsonb not null default '{}'::jsonb,
  hub_available   boolean not null default false,
  hub_result      jsonb not null default '{}'::jsonb,
  queued_count    int not null default 0,
  dry_run         boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint lsr_event_dry_run_only check (dry_run)
);
create unique index if not exists uq_lsr_event_idem on public.lsr_event_log(idempotency_key);
create index if not exists ix_lsr_event_key on public.lsr_event_log(event_key, created_at desc);
comment on table public.lsr_event_log is
  'كلّ حدث تجاريّ يُدرَج مرّة واحدة. القيد dry_run يمنع بنيويًّا تسجيل إرسال حقيقيّ من هذا الموديول في V1.';

-- ════════════════════════════════════════════════════════════════════════════
-- §4) أدوات صغيرة — إعدادات، تدقيق، تطبيع، قراءة jsonb الآمنة.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.lsr_setting_int(p_key text, p_default int) returns int
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select value into v from public.lsr_settings where key = p_key;
  if v is null or jsonb_typeof(v) <> 'number' then return p_default; end if;
  return (v #>> '{}')::int;
exception when others then return p_default;
end $$;

create or replace function public.lsr_setting_bool(p_key text, p_default boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select value into v from public.lsr_settings where key = p_key;
  if v is null or jsonb_typeof(v) <> 'boolean' then return coalesce(p_default, false); end if;
  return coalesce((v #>> '{}')::boolean, coalesce(p_default, false));
exception when others then return coalesce(p_default, false);
end $$;

create or replace function public.lsr_log(
  p_action text, p_entity_type text, p_entity_id uuid, p_reason text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.lsr_audit(actor_id, action, entity_type, entity_id, reason, payload)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, nullif(btrim(coalesce(p_reason, '')), ''),
          coalesce(p_payload, '{}'::jsonb));
end $$;

create or replace function public.lsr_txt(p jsonb, k text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(coalesce(p ->> k, '')), '');
$$;

create or replace function public.lsr_num(p jsonb, k text) returns numeric
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::numeric;
exception when others then return null;
end $$;

create or replace function public.lsr_bool(p jsonb, k text) returns boolean
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(lower(coalesce(p ->> k, ''))), '');
  if v is null then return null; end if;
  if v in ('true','t','yes','1')  then return true;  end if;
  if v in ('false','f','no','0') then return false; end if;
  return null;
end $$;

create or replace function public.lsr_norm_city(p_in text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(lower(regexp_replace(coalesce(p_in, ''), '\s+', ' ', 'g'))), '');
$$;

create or replace function public.lsr_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $t$
declare t text;
begin
  foreach t in array array['lsr_lead_profile','lsr_agents','lsr_routing_rules','lsr_rules'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.lsr_touch()', t, t);
  end loop;
end $t$;

-- ★ حارس عدم قابلية التعديل: مجموعة قواعد منشورة لا تُمسّ.
create or replace function public.lsr_rules_frozen() returns trigger
language plpgsql set search_path = public as $$
declare v_ver int; v_status text;
begin
  v_ver := coalesce(new.ruleset_version, old.ruleset_version);
  select status into v_status from public.lsr_rulesets where version = v_ver;
  if coalesce(v_status, 'draft') <> 'draft' then
    raise exception 'LSR: مجموعة القواعد % غير مسوّدة (%) — التعديل يستنسخ إصدارًا جديدًا ولا يعيد كتابة التاريخ.',
      v_ver, v_status;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists lsr_rules_frozen_trg on public.lsr_rules;
create trigger lsr_rules_frozen_trg before insert or update or delete on public.lsr_rules
  for each row execute function public.lsr_rules_frozen();

-- ════════════════════════════════════════════════════════════════════════════
-- §5) ★★ محرّك التقييم ★★ — مُفسَّر بالكامل.
--     لا نموذج، لا وزن مخفيّ، لا نداء خارجيّ. الدرجة = مجموع قواعد مطابقة
--     يمكن لأيّ إنسان أن يقرأها ويعيد حسابها بيده.
-- ════════════════════════════════════════════════════════════════════════════

-- 5.1 سياق العوامل — القيم المرصودة لعميل محتمل واحد.
--     ★ لا صفة شخصية هنا: لا جنس، ولا عمر، ولا جنسية. الأعمدة المقروءة
--       تجارية فقط، ويثبتها اختبار يفشل إن ظهر رمز ممنوع.
create or replace function public.lsr_context(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  -- ★ rowtype لا record ★ لو لم يوجد ملفّ تجاريّ للعميل، فمتغيّر rowtype يبقى
  --   بحقول NULL آمنة القراءة، بينما record غير المُسنَد يرفع خطأً.
  l record; p public.lsr_lead_profile%rowtype;
  v_acts int := 0; v_in int := 0; v_out int := 0; v_last_in timestamptz;
  v_filled int := 0; v_total int := 0; v_completeness int;
  v_existing boolean; v_territory text; v_behaviour text;
  v_resp_days int; v_unresp int;
begin
  select * into l from public.crm_leads where id = p_lead and is_deleted = false;
  if not found then return null; end if;
  select * into p from public.lsr_lead_profile where lead_id = p_lead;

  -- سلوك الاستجابة — مشتقّ من الأنشطة، لا يُدخَل يدويًّا.
  select count(*),
         count(*) filter (where a.direction = 'inbound'),
         count(*) filter (where a.direction = 'outbound'),
         max(a.occurred_at) filter (where a.direction = 'inbound')
    into v_acts, v_in, v_out, v_last_in
    from public.crm_activities a
   where a.lead_id = p_lead and a.is_deleted = false;

  v_resp_days := public.lsr_setting_int('responsive_days', 7);
  v_unresp    := public.lsr_setting_int('unresponsive_attempts', 3);
  v_behaviour := case
    when coalesce(v_acts, 0) = 0 then 'no_contact'
    when v_in > 0 and v_last_in >= now() - make_interval(days => v_resp_days) then 'responsive'
    when v_in > 0 then 'slow'
    when v_out >= v_unresp then 'unresponsive'
    else 'awaiting_first_reply' end;

  -- الإقليم: من الملفّ، وإلّا من خريطة المدن، وإلّا «غير معروف» بصراحة.
  v_territory := nullif(btrim(coalesce(p.territory, '')), '');
  if v_territory is null then
    select t.territory into v_territory
      from public.lsr_territories t
     where t.is_active and t.city_norm = public.lsr_norm_city(l.city)
     limit 1;
  end if;

  -- عميل حاليّ: مرجع صريح، أو تصريح المصدر. لا مطابقة أسماء.
  v_existing := coalesce(p.existing_client_id is not null, false) or (l.source = 'existing_client');

  -- اكتمال البيانات — نسبة صريحة من أربعة عشر بندًا تجاريًّا.
  v_total := 14;
  v_filled :=
      (case when l.email_norm is not null then 1 else 0 end)
    + (case when l.phone_norm is not null then 1 else 0 end)
    + (case when l.company_id is not null
              or nullif(btrim(coalesce(l.company_name, '')), '') is not null then 1 else 0 end)
    + (case when nullif(btrim(coalesce(l.city, '')), '') is not null then 1 else 0 end)
    + (case when l.budget_band <> 'unknown' then 1 else 0 end)
    + (case when l.authority   <> 'unknown' then 1 else 0 end)
    + (case when l.need_level  <> 'unknown' then 1 else 0 end)
    + (case when l.timeline    <> 'unknown' then 1 else 0 end)
    + (case when p.organization_type is not null then 1 else 0 end)
    + (case when p.service_type is not null then 1 else 0 end)
    + (case when p.urgency is not null then 1 else 0 end)
    + (case when p.desired_delivery_days is not null then 1 else 0 end)
    + (case when p.annual_value_potential is not null then 1 else 0 end)
    + (case when p.production_complexity is not null then 1 else 0 end);
  v_completeness := round((v_filled::numeric / v_total::numeric) * 100)::int;

  return jsonb_build_object(
    'budget_range',            l.budget_band,
    'organization_type',       p.organization_type,
    'company_size',            l.company_size,
    'service_type',            p.service_type,
    'locations_count',         p.locations_count,
    'cities_count',            p.cities_count,
    'urgency',                 p.urgency,
    'desired_delivery_days',   p.desired_delivery_days,
    'data_completeness',       v_completeness,
    'lead_source',             l.source,
    'existing_client',         v_existing,
    'retainer_potential',      p.retainer_potential,
    'annual_value_potential',  p.annual_value_potential,
    'production_complexity',   p.production_complexity,
    'territory',               v_territory,
    'strategic_sector',        p.strategic_sector,
    'previous_lost_reason',    p.previous_lost_reason,
    'response_behaviour',      v_behaviour,
    -- سياق غير مُقيَّم يُعرض للإنسان فقط (لا قاعدة تشير إليه)
    '_meta', jsonb_build_object(
      'activities', coalesce(v_acts, 0), 'inbound', coalesce(v_in, 0), 'outbound', coalesce(v_out, 0),
      'last_inbound_at', v_last_in, 'has_owner', l.owner_user_id is not null,
      'status', l.status, 'city', l.city, 'contactable', (l.email_norm is not null or l.phone_norm is not null),
      'completeness_filled', v_filled, 'completeness_total', v_total));
end $$;

-- 5.2 تقييم قاعدة واحدة — دالّة صافية، بلا وصول إلى الجداول.
create or replace function public.lsr_rule_matches(
  p_kind text, p_operator text, p_observed jsonb, p_key text,
  p_value_text text, p_value_num numeric, p_value_num2 numeric, p_value_list text[])
returns boolean language plpgsql immutable set search_path = public as $$
declare v_txt text; v_num numeric; v_bool boolean;
begin
  if p_kind = 'text' then v_txt := public.lsr_txt(p_observed, p_key); end if;
  if p_kind = 'num'  then v_num := public.lsr_num(p_observed, p_key); end if;
  if p_kind = 'bool' then v_bool := public.lsr_bool(p_observed, p_key); end if;

  return coalesce(case p_operator
    when 'equals'     then (v_txt is not null and v_txt = p_value_text)
    when 'not_equals' then (v_txt is not null and v_txt <> p_value_text)
    when 'in'         then (v_txt is not null and p_value_list is not null and v_txt = any(p_value_list))
    when 'not_in'     then (v_txt is not null and p_value_list is not null and not (v_txt = any(p_value_list)))
    when 'gte'        then (v_num is not null and p_value_num is not null and v_num >= p_value_num)
    when 'lte'        then (v_num is not null and p_value_num is not null and v_num <= p_value_num)
    when 'gt'         then (v_num is not null and p_value_num is not null and v_num >  p_value_num)
    when 'lt'         then (v_num is not null and p_value_num is not null and v_num <  p_value_num)
    when 'between'    then (v_num is not null and p_value_num is not null and p_value_num2 is not null
                            and v_num >= p_value_num and v_num <= p_value_num2)
    when 'not_empty'  then (v_txt is not null) or (v_num is not null) or (v_bool is not null)
    when 'is_true'    then coalesce(v_bool, false)
    when 'is_false'   then (v_bool is not null and v_bool = false)
    else false end, false);
end $$;

-- 5.3 ★★ النواة ★★ الدرجة، والتصنيف، والشرح، والعوامل الإيجابية والسلبية،
--     والمعلومات الناقصة، والإجراء التالي، وعلم المراجعة.
create or replace function public.lsr_score_core(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ctx jsonb; m record; r record; f record;
  v_ver int; v_base int := 0; v_total int;
  v_items jsonb := '[]'::jsonb; v_pos jsonb := '[]'::jsonb; v_neg jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb; v_reviews text[] := '{}';
  v_match boolean; v_kind text; v_grade text;
  v_a int; v_b int; v_c int; v_min_complete int;
  v_completeness int; v_contactable boolean; v_has_owner boolean;
  v_action text; v_action_ar text; v_manual int := 0; v_override int;
begin
  v_ctx := public.lsr_context(p_lead);
  if v_ctx is null then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  end if;

  select version into v_ver from public.lsr_rulesets
   where status = 'published' order by version desc limit 1;
  if v_ver is null then
    return jsonb_build_object('ok', false, 'reason', 'no_published_ruleset',
      'message', 'لا توجد مجموعة قواعد منشورة. الدرجة لا تُخترع بلا قواعد.');
  end if;

  -- (أ) القواعد
  for r in
    select ru.*, fa.value_kind, fa.label_ar as factor_label_ar
      from public.lsr_rules ru
      join public.lsr_factors fa on fa.key = ru.factor_key
     where ru.ruleset_version = v_ver and ru.is_active and fa.is_active
     order by ru.sort_order, ru.key
  loop
    v_match := public.lsr_rule_matches(r.value_kind, r.operator, v_ctx, r.factor_key,
                 r.value_text, r.value_num, r.value_num2, r.value_list);
    if v_match then v_base := v_base + r.points; end if;
    v_items := v_items || jsonb_build_object(
      'key', r.key, 'factor', r.factor_key, 'factor_label_ar', r.factor_label_ar,
      'label_ar', r.label_ar, 'label_en', r.label_en,
      'operator', r.operator, 'points', r.points, 'matched', v_match,
      'observed', v_ctx -> r.factor_key);
    if v_match and r.points > 0 then
      v_pos := v_pos || jsonb_build_object('key', r.key, 'label_ar', r.label_ar, 'points', r.points);
    elsif v_match and r.points < 0 then
      v_neg := v_neg || jsonb_build_object('key', r.key, 'label_ar', r.label_ar, 'points', r.points);
    end if;
  end loop;

  -- (ب) التعديل اليدويّ المعلَن
  select coalesce(adjust_points, 0), override_score into v_manual, v_override
    from public.lsr_score_manual where lead_id = p_lead;
  v_manual := coalesce(v_manual, 0);

  v_total := greatest(0, least(100, v_base + v_manual));
  if v_override is not null then v_total := v_override; end if;

  -- (ج) التصنيف — عتبات معلَنة تُعاد في المخرجات كي يُراجَع الحكم لا يُصدَّق.
  v_a := public.lsr_setting_int('grade_a_min', 75);
  v_b := public.lsr_setting_int('grade_b_min', 55);
  v_c := public.lsr_setting_int('grade_c_min', 35);
  v_grade := case when v_total >= v_a then 'A'
                  when v_total >= v_b then 'B'
                  when v_total >= v_c then 'C'
                  else 'D' end;

  -- (د) المعلومات الناقصة — العوامل المطلوبة الغائبة، بأسمائها لا بعددها.
  for f in select * from public.lsr_factors
            where is_active and required_for_score order by sort_order, key
  loop
    if coalesce((v_ctx -> f.key) is null or jsonb_typeof(v_ctx -> f.key) = 'null'
       or (f.value_kind = 'text' and coalesce(public.lsr_txt(v_ctx, f.key) in ('unknown','other'), true)),
       true) then
      v_missing := v_missing || jsonb_build_object('key', f.key, 'label_ar', f.label_ar);
    end if;
  end loop;

  -- (هـ) علم المراجعة — صريح ومُعلَّل.
  v_completeness := coalesce(public.lsr_num(v_ctx, 'data_completeness'), 0)::int;
  v_min_complete := public.lsr_setting_int('review_min_completeness', 50);
  v_contactable  := coalesce((v_ctx #>> '{_meta,contactable}')::boolean, false);
  v_has_owner    := coalesce((v_ctx #>> '{_meta,has_owner}')::boolean, false);

  if not v_contactable then
    v_reviews := v_reviews || 'anonymous_no_contact_channel'; end if;
  if v_completeness < v_min_complete then
    v_reviews := v_reviews || 'incomplete_data'; end if;
  if jsonb_array_length(v_missing) > 0 then
    v_reviews := v_reviews || 'missing_required_factors'; end if;
  if v_override is not null then
    v_reviews := v_reviews || 'manual_override_active'; end if;

  -- (و) الإجراء التالي — قاعدة معلنة، لا اجتهاد.
  if array_length(v_reviews, 1) is not null and not v_contactable then
    v_action := 'collect_contact_channel'; v_action_ar := 'احصل على قناة تواصل قبل أيّ توزيع.';
  elsif jsonb_array_length(v_missing) > 0 then
    v_action := 'complete_qualification'; v_action_ar := 'أكمل بيانات التأهيل الناقصة المذكورة أعلاه.';
  elsif v_grade = 'A' and not v_has_owner then
    v_action := 'assign_now'; v_action_ar := 'أسنِد الآن — فرصة من الفئة A بلا مالك.';
  elsif v_grade = 'A' then
    v_action := 'contact_within_24h'; v_action_ar := 'تواصل خلال ٢٤ ساعة وجهّز عرضًا.';
  elsif v_grade = 'B' then
    v_action := 'schedule_discovery'; v_action_ar := 'رتّب اجتماع استكشاف لتأكيد النطاق والميزانية.';
  elsif v_grade = 'C' then
    v_action := 'nurture'; v_action_ar := 'ضعه في متابعة دورية بلا استعجال.';
  else
    v_action := 'low_priority'; v_action_ar := 'أولوية منخفضة — لا تستهلك وقت مندوب الآن.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'lead_id', p_lead,
    'engine', 'rules_v1',
    'ruleset_version', v_ver,
    'score', v_total,
    'grade', v_grade,
    'grade_thresholds', jsonb_build_object('A', v_a, 'B', v_b, 'C', v_c),
    'rules_total', v_base,
    'manual_adjust', v_manual,
    'override', v_override,
    'components', v_items,
    'positive_factors', v_pos,
    'negative_factors', v_neg,
    'missing_information', v_missing,
    'recommended_next_action', jsonb_build_object('key', v_action, 'label_ar', v_action_ar),
    'review_required', (array_length(v_reviews, 1) is not null),
    'review_reasons', to_jsonb(v_reviews),
    'factors_observed', v_ctx - '_meta',
    'context_meta', v_ctx -> '_meta',
    'explain',
      'الدرجة = مجموع نقاط القواعد المطابقة (' || v_base || ') + التعديل اليدويّ المعلَن (' || v_manual ||
      ')، محصورة بين ٠ و١٠٠، ثمّ التصنيف بعتبات معلَنة. لا نموذج ولا ذكاء اصطناعيّ ولا وزن مخفيّ: ' ||
      'كلّ قاعدة معروضة بمفتاحها ونقاطها وقيمتها المرصودة، ويمكن إعادة الحساب يدويًّا.');
end $$;

-- 5.4 السطح المحميّ.
create or replace function public.lsr_score(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.lsr_score_core(p_lead);
end $$;

-- 5.5 التقييم الجماعيّ — بسقف صريح، ويعلن أنّه مقصوص بدل أن يوهم بالشمول.
create or replace function public.lsr_score_scan(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int; v_cap int; v_rows jsonb := '[]'::jsonb; r record; s jsonb;
  v_grade text; v_counted int := 0; v_considered int := 0;
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_cap := public.lsr_setting_int('score_scan_limit', 300);
  v_limit := greatest(1, least(coalesce((public.lsr_num(p_filters, 'limit'))::int, 100), v_cap));
  v_grade := public.lsr_txt(p_filters, 'grade');

  for r in
    select l.id from public.crm_leads l
     where l.is_deleted = false
       and l.status in ('new','contacted','working','qualified')
       and (public.lsr_txt(p_filters, 'owner') is null
            or l.owner_user_id = (public.lsr_txt(p_filters, 'owner'))::uuid)
       and (coalesce(public.lsr_bool(p_filters, 'unowned_only'), false) = false
            or l.owner_user_id is null)
     order by l.updated_at desc
     limit v_cap
  loop
    v_considered := v_considered + 1;
    s := public.lsr_score_core(r.id);
    if coalesce((s ->> 'ok')::boolean, false)
       and (v_grade is null or (s ->> 'grade') = v_grade) then
      v_counted := v_counted + 1;
      if v_counted <= v_limit then
        v_rows := v_rows || jsonb_build_object(
          'lead_id', r.id, 'score', s -> 'score', 'grade', s -> 'grade',
          'review_required', s -> 'review_required',
          'recommended_next_action', s -> 'recommended_next_action');
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_rows,
    'returned', least(v_counted, v_limit), 'matched', v_counted,
    'considered', v_considered, 'scan_cap', v_cap,
    'truncated', (v_counted > v_limit) or (v_considered >= v_cap),
    'note', 'مسح مقصوص بسقف معلن. «truncated=true» تعني أنّ خارج القائمة صفوفًا لم تُقيَّم — لا أنّها غير مؤهّلة.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) الكتابة على التقييم — الملفّ التجاريّ، والتعديل اليدويّ، وإدارة القواعد.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.lsr_profile_set(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_exists boolean;
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_lead := (public.lsr_txt(p_payload, 'lead_id'))::uuid;
  if v_lead is null then
    return jsonb_build_object('ok', false, 'reason', 'lead_id_required'); end if;
  select true into v_exists from public.crm_leads where id = v_lead and is_deleted = false;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found'); end if;

  insert into public.lsr_lead_profile as t (
    lead_id, organization_type, service_type, locations_count, cities_count, urgency,
    desired_delivery_days, retainer_potential, annual_value_potential, production_complexity,
    territory, strategic_sector, previous_lost_reason, existing_client_id, notes, updated_by)
  values (
    v_lead,
    public.lsr_txt(p_payload, 'organization_type'),
    public.lsr_txt(p_payload, 'service_type'),
    (public.lsr_num(p_payload, 'locations_count'))::int,
    (public.lsr_num(p_payload, 'cities_count'))::int,
    public.lsr_txt(p_payload, 'urgency'),
    (public.lsr_num(p_payload, 'desired_delivery_days'))::int,
    public.lsr_txt(p_payload, 'retainer_potential'),
    public.lsr_num(p_payload, 'annual_value_potential'),
    public.lsr_txt(p_payload, 'production_complexity'),
    public.lsr_txt(p_payload, 'territory'),
    public.lsr_bool(p_payload, 'strategic_sector'),
    public.lsr_txt(p_payload, 'previous_lost_reason'),
    (public.lsr_txt(p_payload, 'existing_client_id'))::uuid,
    public.lsr_txt(p_payload, 'notes'),
    auth.uid())
  on conflict (lead_id) do update set
    organization_type      = coalesce(excluded.organization_type,      t.organization_type),
    service_type           = coalesce(excluded.service_type,           t.service_type),
    locations_count        = coalesce(excluded.locations_count,        t.locations_count),
    cities_count           = coalesce(excluded.cities_count,           t.cities_count),
    urgency                = coalesce(excluded.urgency,                t.urgency),
    desired_delivery_days  = coalesce(excluded.desired_delivery_days,  t.desired_delivery_days),
    retainer_potential     = coalesce(excluded.retainer_potential,     t.retainer_potential),
    annual_value_potential = coalesce(excluded.annual_value_potential, t.annual_value_potential),
    production_complexity  = coalesce(excluded.production_complexity,  t.production_complexity),
    territory              = coalesce(excluded.territory,              t.territory),
    strategic_sector       = coalesce(excluded.strategic_sector,       t.strategic_sector),
    previous_lost_reason   = coalesce(excluded.previous_lost_reason,   t.previous_lost_reason),
    existing_client_id     = coalesce(excluded.existing_client_id,     t.existing_client_id),
    notes                  = coalesce(excluded.notes,                  t.notes),
    updated_by             = auth.uid();

  perform public.lsr_log('profile_set', 'lead', v_lead, null, p_payload);
  return jsonb_build_object('ok', true, 'lead_id', v_lead, 'score', public.lsr_score_core(v_lead));
end $$;

-- ★ التعديل اليدويّ: سبب إلزاميّ + قيد تدقيق. لا استثناء ولا «تعديل إداريّ صامت».
create or replace function public.lsr_score_manual_set(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid; v_adjust int; v_override int; v_reason text; v_o_reason text;
  v_before jsonb; v_after jsonb;
begin
  if not coalesce(public.lsr_can_override_score(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_lead     := (public.lsr_txt(p_payload, 'lead_id'))::uuid;
  v_adjust   := coalesce((public.lsr_num(p_payload, 'adjust_points'))::int, 0);
  v_override := (public.lsr_num(p_payload, 'override_score'))::int;
  v_reason   := public.lsr_txt(p_payload, 'adjust_reason');
  v_o_reason := public.lsr_txt(p_payload, 'override_reason');

  if v_lead is null then
    return jsonb_build_object('ok', false, 'reason', 'lead_id_required'); end if;
  if not exists (select 1 from public.crm_leads where id = v_lead and is_deleted = false) then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found'); end if;
  if v_adjust <> 0 and v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'adjust_reason_required',
      'message', 'التعديل اليدويّ بلا سبب مكتوب مرفوض — الدرجة يجب أن تبقى قابلة للتفسير.'); end if;
  if v_override is not null and v_o_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'override_reason_required',
      'message', 'التجاوز اليدويّ بلا سبب مكتوب مرفوض.'); end if;

  v_before := public.lsr_score_core(v_lead);

  insert into public.lsr_score_manual as m (
    lead_id, adjust_points, adjust_reason, override_score, override_reason, set_by, set_at)
  values (v_lead, v_adjust, v_reason, v_override, v_o_reason, auth.uid(), now())
  on conflict (lead_id) do update set
    adjust_points = excluded.adjust_points, adjust_reason = excluded.adjust_reason,
    override_score = excluded.override_score, override_reason = excluded.override_reason,
    set_by = auth.uid(), set_at = now();

  v_after := public.lsr_score_core(v_lead);

  perform public.lsr_log('score_manual_set', 'lead', v_lead,
    coalesce(v_o_reason, v_reason),
    jsonb_build_object('adjust_points', v_adjust, 'override_score', v_override,
                       'score_before', v_before -> 'score', 'score_after', v_after -> 'score',
                       'grade_before', v_before -> 'grade', 'grade_after', v_after -> 'grade'));

  return jsonb_build_object('ok', true, 'lead_id', v_lead,
    'score_before', v_before -> 'score', 'score_after', v_after -> 'score', 'score', v_after);
end $$;

-- إدارة القواعد: التعديل على المسوّدة وحدها، والنشر قرار صريح.
create or replace function public.lsr_ruleset_clone(p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_src int; v_new int;
begin
  if not coalesce(public.lsr_can_manage_scoring(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select version into v_src from public.lsr_rulesets where status = 'published'
   order by version desc limit 1;
  if exists (select 1 from public.lsr_rulesets where status = 'draft') then
    select version into v_new from public.lsr_rulesets where status = 'draft' order by version desc limit 1;
    return jsonb_build_object('ok', true, 'version', v_new, 'created', false,
      'message', 'توجد مسوّدة مفتوحة بالفعل — حرّرها أو انشرها بدل فتح ثانية.');
  end if;
  select coalesce(max(version), 0) + 1 into v_new from public.lsr_rulesets;

  insert into public.lsr_rulesets(version, status, note_ar, created_by)
  values (v_new, 'draft', coalesce(nullif(btrim(p_note), ''), ''), auth.uid());

  if v_src is not null then
    insert into public.lsr_rules(ruleset_version, key, factor_key, operator, value_text,
                                 value_num, value_num2, value_list, points, label_ar, label_en,
                                 is_active, sort_order)
    select v_new, key, factor_key, operator, value_text, value_num, value_num2, value_list,
           points, label_ar, label_en, is_active, sort_order
      from public.lsr_rules where ruleset_version = v_src;
  end if;

  perform public.lsr_log('ruleset_clone', 'ruleset', null, p_note,
    jsonb_build_object('from', v_src, 'to', v_new));
  return jsonb_build_object('ok', true, 'version', v_new, 'created', true, 'cloned_from', v_src);
end $$;

create or replace function public.lsr_rule_upsert(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ver int; v_key text;
begin
  if not coalesce(public.lsr_can_manage_scoring(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select version into v_ver from public.lsr_rulesets where status = 'draft' order by version desc limit 1;
  if v_ver is null then
    return jsonb_build_object('ok', false, 'reason', 'no_draft_ruleset',
      'message', 'لا مسوّدة مفتوحة. استعمل lsr_ruleset_clone أوّلًا — المنشور لا يُعدَّل.'); end if;
  v_key := public.lsr_txt(p_payload, 'key');
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'key_required'); end if;
  if public.lsr_txt(p_payload, 'factor_key') is null then
    return jsonb_build_object('ok', false, 'reason', 'factor_key_required'); end if;

  insert into public.lsr_rules as r (
    ruleset_version, key, factor_key, operator, value_text, value_num, value_num2,
    value_list, points, label_ar, label_en, is_active, sort_order)
  values (
    v_ver, v_key, public.lsr_txt(p_payload, 'factor_key'),
    coalesce(public.lsr_txt(p_payload, 'operator'), 'equals'),
    public.lsr_txt(p_payload, 'value_text'),
    public.lsr_num(p_payload, 'value_num'), public.lsr_num(p_payload, 'value_num2'),
    case when jsonb_typeof(p_payload -> 'value_list') = 'array'
         then (select array_agg(x) from jsonb_array_elements_text(p_payload -> 'value_list') x)
         else null end,
    coalesce((public.lsr_num(p_payload, 'points'))::int, 0),
    coalesce(public.lsr_txt(p_payload, 'label_ar'), ''),
    coalesce(public.lsr_txt(p_payload, 'label_en'), ''),
    coalesce(public.lsr_bool(p_payload, 'is_active'), true),
    coalesce((public.lsr_num(p_payload, 'sort_order'))::int, 100))
  on conflict (ruleset_version, key) do update set
    factor_key = excluded.factor_key, operator = excluded.operator,
    value_text = excluded.value_text, value_num = excluded.value_num,
    value_num2 = excluded.value_num2, value_list = excluded.value_list,
    points = excluded.points, label_ar = excluded.label_ar, label_en = excluded.label_en,
    is_active = excluded.is_active, sort_order = excluded.sort_order;

  perform public.lsr_log('rule_upsert', 'rule', null, null, p_payload || jsonb_build_object('version', v_ver));
  return jsonb_build_object('ok', true, 'version', v_ver, 'key', v_key);
end $$;

create or replace function public.lsr_ruleset_publish(p_version int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_rules int;
begin
  if not coalesce(public.lsr_can_manage_scoring(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select status into v_status from public.lsr_rulesets where version = p_version;
  if v_status is null then return jsonb_build_object('ok', false, 'reason', 'ruleset_not_found'); end if;
  if v_status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_draft', 'status', v_status); end if;
  select count(*) into v_rules from public.lsr_rules where ruleset_version = p_version and is_active;
  if coalesce(v_rules, 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_ruleset',
      'message', 'مجموعة بلا قواعد فعّالة تُنتج صفرًا لكلّ عميل — وهذا كذب لا تقييم.'); end if;

  update public.lsr_rulesets set status = 'retired', retired_at = now()
   where status = 'published' and version <> p_version;
  update public.lsr_rulesets
     set status = 'published', published_at = now(), published_by = auth.uid(),
         note_ar = coalesce(nullif(btrim(p_note), ''), note_ar)
   where version = p_version;

  perform public.lsr_log('ruleset_publish', 'ruleset', null, p_note,
    jsonb_build_object('version', p_version, 'active_rules', v_rules));
  return jsonb_build_object('ok', true, 'version', p_version, 'active_rules', v_rules);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) ★★ محرّك التوزيع ★★ — مُفسَّر وحتميّ. لا عشوائية، ولا «round robin»
--     يعتمد على ترتيب غير مستقرّ: الترتيب النهائيّ يُحسَم بمعرّف المستخدم.
-- ════════════════════════════════════════════════════════════════════════════

-- 7.1 الحِمل الحاليّ لمندوب — عدد العملاء المفتوحين الذين يملكهم.
create or replace function public.lsr_agent_workload(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(count(*), 0)::int from public.crm_leads l
   where l.is_deleted = false and l.owner_user_id = p_user
     and l.status in ('new','contacted','working','qualified');
$$;

-- 7.2 النواة — تُرجع المرشّحين وأسبابهم، والمختار، والقاعدة، وعلم المراجعة.
create or replace function public.lsr_route_core(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l record; s jsonb; v_ctx jsonb;
  v_territory text; v_service text; v_city text; v_source text;
  v_score int; v_grade text; v_review boolean; v_reasons text[] := '{}';
  r record; a record;
  v_cands jsonb := '[]'::jsonb; v_chosen uuid; v_rule text; v_reason text;
  v_existing_owner uuid; v_load int; v_cap int; v_spec boolean; v_best_rank text;
  v_rank text; v_best uuid; v_best_reason text; v_any boolean := false;
begin
  select * into l from public.crm_leads where id = p_lead and is_deleted = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lead_not_found'); end if;

  s := public.lsr_score_core(p_lead);
  -- ★ بلا درجة لا توزيع ★ لو تعذّر التقييم (لا مجموعة قواعد منشورة مثلًا) فإنّ
  --   المضيّ يعني توزيعًا مبنيًّا على صفر مُختلَق. نتوقّف ونقول السبب.
  if not coalesce((s ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', coalesce(s ->> 'reason', 'scoring_unavailable'),
      'message', coalesce(s ->> 'message',
        'تعذّر تقييم العميل، والتوزيع بلا تقييم يُنتج قرارًا بلا أساس.'),
      'review_required', true);
  end if;
  v_ctx := s -> 'factors_observed';
  v_score := coalesce((s ->> 'score')::int, 0);
  v_grade := coalesce(s ->> 'grade', 'D');
  v_review := coalesce((s ->> 'review_required')::boolean, false);
  if v_review then
    v_reasons := v_reasons || (select coalesce(array_agg(x), '{}'::text[])
                                 from jsonb_array_elements_text(s -> 'review_reasons') x);
  end if;

  v_territory := public.lsr_txt(v_ctx, 'territory');
  v_service   := public.lsr_txt(v_ctx, 'service_type');
  v_city      := public.lsr_norm_city(l.city);
  v_source    := l.source;

  -- (أ) ★ ملكية الحساب القائم تسبق كلّ قاعدة ★ من يخدم الشركة يبقى صاحبها.
  --     المصدر هو crm_companies.owner_user_id — مفردة قائمة فعلًا في قاعدة
  --     البيانات، لا عمود مُفترَض. ولا نستنتج المالك بمطابقة أسماء.
  if l.company_id is not null then
    select co.owner_user_id into v_existing_owner
      from public.crm_companies co
     where co.id = l.company_id and co.is_deleted = false;
  end if;
  if v_existing_owner is not null then
    select ag.user_id into v_chosen
      from public.lsr_agents ag
     where ag.user_id = v_existing_owner and ag.is_active and ag.is_available
     limit 1;
    if v_chosen is null then
      v_reasons := v_reasons || 'existing_account_owner_unavailable';
    end if;
  end if;

  -- (ب) القاعدة الأولى المطابقة، بالترتيب المعلن.
  if v_chosen is null then
    for r in select * from public.lsr_routing_rules
              where is_active order by rule_order, key
    loop
      if (r.match_territory is null or r.match_territory = coalesce(v_territory, '~none~'))
         and (r.match_city is null or public.lsr_norm_city(r.match_city) = coalesce(v_city, '~none~'))
         and (r.match_service is null or r.match_service = coalesce(v_service, '~none~'))
         and (r.match_source is null or r.match_source = coalesce(v_source, '~none~'))
         and (r.match_min_score is null or v_score >= r.match_min_score)
         and (r.match_grades is null or v_grade = any(r.match_grades))
      then
        v_rule := r.key;
        if r.target_mode = 'review_only' then
          v_reasons := v_reasons || 'rule_requires_review';
          exit;
        elsif r.target_mode = 'fixed_user' then
          if exists (select 1 from public.lsr_agents ag
                      where ag.user_id = r.target_user_id and ag.is_active and ag.is_available) then
            v_chosen := r.target_user_id;
            v_reason := 'قاعدة «' || coalesce(r.label_ar, r.key) || '»: مندوب محدَّد صراحةً.';
          else
            v_reasons := v_reasons || 'fixed_target_unavailable';
          end if;
          exit;
        else
          -- ترتيب حتميّ: تخصّص أوّلًا، ثمّ أقلّ حِملًا، ثمّ الأولوية، ثمّ المعرّف.
          v_best := null; v_best_rank := null; v_best_reason := null;
          for a in select * from public.lsr_agents where is_active and is_available order by user_id
          loop
            v_load := public.lsr_agent_workload(a.user_id);
            v_cap  := coalesce(nullif(a.max_open_leads, 0), public.lsr_setting_int('agent_default_capacity', 25));
            v_spec := coalesce(
                 (v_territory is not null and v_territory = any(a.territories))
              or (v_city is not null and v_city = any(select public.lsr_norm_city(c) from unnest(a.cities) c))
              or (v_service is not null and v_service = any(a.services)), false);

            if r.target_mode = 'specialist_least_loaded' and not v_spec
               and (array_length(a.territories, 1) is not null
                    or array_length(a.cities, 1) is not null
                    or array_length(a.services, 1) is not null) then
              v_cands := v_cands || jsonb_build_object('user_id', a.user_id, 'eligible', false,
                'reason', 'خارج التخصّص المطلوب', 'workload', v_load, 'capacity', v_cap);
              continue;
            end if;
            if v_load >= v_cap then
              v_cands := v_cands || jsonb_build_object('user_id', a.user_id, 'eligible', false,
                'reason', 'بلغ سعته (' || v_load || '/' || v_cap || ')', 'workload', v_load, 'capacity', v_cap);
              continue;
            end if;

            v_any := true;
            v_rank := (case when v_spec then '0' else '1' end)
                      || lpad(v_load::text, 6, '0')
                      || lpad(a.priority::text, 4, '0')
                      || a.user_id::text;
            v_cands := v_cands || jsonb_build_object('user_id', a.user_id, 'eligible', true,
              'specialist', v_spec, 'workload', v_load, 'capacity', v_cap,
              'priority', a.priority, 'rank', v_rank);
            if v_best_rank is null or v_rank < v_best_rank then
              v_best := a.user_id; v_best_rank := v_rank;
              v_best_reason := 'قاعدة «' || coalesce(r.label_ar, r.key) || '»: '
                || (case when v_spec then 'مطابقة تخصّص' else 'بلا تخصّص مطابق' end)
                || ' · الحِمل ' || v_load || '/' || v_cap || ' · الأولوية ' || a.priority || '.';
            end if;
          end loop;
          v_chosen := v_best; v_reason := v_best_reason;
          if v_chosen is null then v_reasons := v_reasons || 'no_eligible_agent'; end if;
          exit;
        end if;
      end if;
    end loop;
  else
    v_rule := 'existing_account_ownership';
    v_reason := 'الشركة لها مالك حساب في CRM — ملكية الحساب تسبق قواعد التوزيع.';
  end if;

  if v_rule is null then
    v_reasons := v_reasons || 'no_matching_rule';
  end if;

  return jsonb_build_object(
    'ok', true, 'lead_id', p_lead,
    'score', v_score, 'grade', v_grade,
    'suggested_user_id', v_chosen,
    'routing_rule', v_rule,
    'routing_reason', coalesce(v_reason, 'لا قاعدة مطابقة ولا مرشّح مؤهّل.'),
    'candidates', v_cands,
    'review_required', (v_review or v_chosen is null),
    'review_reasons', to_jsonb(v_reasons),
    'current_owner', l.owner_user_id,
    'explain',
      'التوزيع حتميّ: ملكية حساب قائم أوّلًا، ثمّ أوّل قاعدة مطابقة بالترتيب المعلن، ثمّ ترتيب المرشّحين '
      || 'بالتخصّص فالحِمل فالأولوية فالمعرّف. لا عشوائية، وكلّ مرشّح مستبعَد يظهر بسبب استبعاده.');
end $$;

create or replace function public.lsr_route_preview(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return public.lsr_route_core(p_lead);
end $$;

-- 7.3 ★★ الإسناد ★★ كلّ منع مطلوب في العقد مفروض هنا بالاسم.
create or replace function public.lsr_assign(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record; v_lead uuid; v_mode text; v_target uuid; v_override_reason text;
  v_route jsonb; v_score jsonb; v_prev uuid; v_rule text; v_reason text;
  v_review boolean; v_reasons jsonb; v_self_claim boolean; v_is_override boolean := false;
  v_assignment uuid;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_lead   := (public.lsr_txt(p_payload, 'lead_id'))::uuid;
  v_mode   := coalesce(public.lsr_txt(p_payload, 'mode'), 'auto');
  v_target := (public.lsr_txt(p_payload, 'target_user_id'))::uuid;
  v_override_reason := public.lsr_txt(p_payload, 'override_reason');

  if v_lead is null then return jsonb_build_object('ok', false, 'reason', 'lead_id_required'); end if;
  -- ★ for update ★ يُسلسل الإسنادات المتزامنة على العميل نفسه. بدونه يقرأ
  --   طلبان «بلا مالك» في اللحظة ذاتها فيُسندانه لمندوبين مختلفين، ويفوز
  --   آخر من كتب — بينما يحمل التاريخ صفّي إسناد متناقضين بلا تفسير.
  select * into l from public.crm_leads where id = v_lead and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lead_not_found'); end if;
  if v_mode not in ('auto','manual') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_mode'); end if;

  v_prev  := l.owner_user_id;
  v_route := public.lsr_route_core(v_lead);
  v_score := public.lsr_score_core(v_lead);
  if not coalesce((v_route ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', coalesce(v_route ->> 'reason', 'routing_unavailable'),
      'message', v_route ->> 'message');
  end if;
  v_review  := coalesce((v_route ->> 'review_required')::boolean, true);
  v_reasons := v_route -> 'review_reasons';

  -- ── (١) ★ لا انتزاع من زميل ★ ────────────────────────────────────────────
  -- موظّف بلا صلاحية إعادة الإسناد لا يلمس عميلًا يملكه غيره — لا بوضع يدويّ
  -- ولا بتشغيل التوزيع التلقائيّ «صدفةً».
  if v_prev is not null and v_prev <> auth.uid()
     and not coalesce(public.lsr_can_reassign(), false) then
    perform public.lsr_log('assign_denied', 'lead', v_lead, 'cannot_take_others_lead',
      jsonb_build_object('previous_owner', v_prev, 'mode', v_mode));
    return jsonb_build_object('ok', false, 'reason', 'cannot_take_others_lead',
      'message', 'هذا العميل يملكه زميل. تغيير المالك يحتاج صلاحية إعادة الإسناد وسببًا مكتوبًا.');
  end if;

  -- ── (٢) الوضع اليدويّ ─────────────────────────────────────────────────────
  if v_mode = 'manual' then
    if v_target is null then
      return jsonb_build_object('ok', false, 'reason', 'target_user_id_required'); end if;
    if not exists (select 1 from public.lsr_agents ag where ag.user_id = v_target and ag.is_active) then
      return jsonb_build_object('ok', false, 'reason', 'target_not_an_active_agent',
        'message', 'الهدف ليس مندوبًا فعّالًا في سجلّ التوزيع.'); end if;

    v_self_claim := (v_prev is null and v_target = auth.uid());
    if not coalesce(public.lsr_can_route(), false) then
      -- الاستثناء الوحيد: أخذ عميل **بلا مالك** لنفسه، وبإذن إعداد صريح.
      if not (v_self_claim and public.lsr_setting_bool('allow_self_claim', false)) then
        return jsonb_build_object('ok', false, 'reason', 'routing_not_permitted',
          'message', 'التوزيع يحتاج صلاحية lead.route أو إدارة المبيعات.');
      end if;
    end if;
    v_rule   := case when v_self_claim then 'self_claim' else 'manual_assignment' end;
    v_reason := case when v_self_claim
                     then 'أخذ ذاتيّ لعميل بلا مالك، بإذن إعداد معلن.'
                     else 'إسناد يدويّ من مخوَّل.' end;

  -- ── (٣) الوضع التلقائيّ ───────────────────────────────────────────────────
  else
    if not coalesce(public.lsr_can_route(), false) then
      return jsonb_build_object('ok', false, 'reason', 'routing_not_permitted',
        'message', 'التوزيع التلقائيّ يحتاج صلاحية lead.route أو إدارة المبيعات.'); end if;

    -- ★ العميل المجهول أو الناقص لا يُوزَّع تلقائيًّا — بل يُوقَف للمراجعة ★
    if v_review then
      insert into public.lsr_review_queue(lead_id, reasons, detail)
      select v_lead,
             coalesce((select array_agg(x) from jsonb_array_elements_text(v_reasons) x), '{}'::text[]),
             jsonb_build_object('score', v_route -> 'score', 'grade', v_route -> 'grade',
                                'routing_rule', v_route -> 'routing_rule')
      on conflict (lead_id) where state = 'pending' do nothing;

      insert into public.lsr_assignments(lead_id, assigned_to, assigned_by, previous_owner,
        routing_rule, routing_reason, routing_mode, score_at_assign, grade_at_assign, candidates)
      values (v_lead, null, auth.uid(), v_prev,
        v_route ->> 'routing_rule',
        'أُوقف للمراجعة: ' || coalesce(v_reasons #>> '{}', '[]'),
        'review', (v_score ->> 'score')::int, v_score ->> 'grade', v_route -> 'candidates');

      perform public.lsr_log('assign_review', 'lead', v_lead, 'review_required',
        jsonb_build_object('reasons', v_reasons));
      return jsonb_build_object('ok', true, 'assigned', false, 'review_required', true,
        'review_reasons', v_reasons, 'route', v_route,
        'message', 'لم يُوزَّع: العميل ناقص أو مجهول أو بلا مرشّح مؤهّل، وهو الآن في طابور المراجعة.');
    end if;

    v_target := (v_route ->> 'suggested_user_id')::uuid;
    if v_target is null then
      return jsonb_build_object('ok', false, 'reason', 'no_eligible_agent', 'route', v_route); end if;
    v_rule   := v_route ->> 'routing_rule';
    v_reason := v_route ->> 'routing_reason';
  end if;

  -- ── (٤) تغيير مالك قائم = تجاوز، والتجاوز بلا سبب مرفوض ──────────────────
  -- ★ موضع هذا الحارس مقصود ★ يأتي **بعد** تحديد الهدف الفعليّ لا قبله:
  --   ١) في الوضع التلقائيّ لا يكون الهدف معروفًا قبل تشغيل المحرّك، فوضعُ
  --      الحارس قبله كان يطالب بسبب تجاوز حتّى حين يكون الهدف **هو المالك
  --      نفسه** (مثلًا حين تُرجِع قاعدة «ملكية الحساب القائم» صاحبه) — منعٌ
  --      لعملية لا تغيّر شيئًا.
  --   ٢) وكان يسبق فرع المراجعة، فيردّ «سبب التجاوز مطلوب» على عميل ناقص
  --      كان يجب أن يذهب إلى طابور المراجعة — رسالة خاطئة تُخفي السبب الحقيقيّ.
  if v_prev is not null and v_target is distinct from v_prev then
    v_is_override := true;
    if not coalesce(public.lsr_can_reassign(), false) then
      return jsonb_build_object('ok', false, 'reason', 'reassign_not_permitted',
        'message', 'تغيير مالك عميل قائم يحتاج صلاحية lead.reassign أو دور المالك.'); end if;
    if v_override_reason is null then
      return jsonb_build_object('ok', false, 'reason', 'override_reason_required',
        'message', 'إعادة الإسناد بلا سبب مكتوب مرفوضة — الانتزاع الصامت هو ما يمنعه هذا العقد.'); end if;
  end if;

  -- ── (٥) الكتابة ───────────────────────────────────────────────────────────
  -- ⚠️ نكتب عمود المالك في crm_leads فقط. لا مصدر ثانٍ للملكية: مصدران
  --    يتباعدان بصمت، وسياسات CRM كلّها تقرأ owner_user_id.
  update public.crm_leads
     set owner_user_id = v_target,
         assigned_at   = now(),
         updated_at    = now()
   where id = v_lead and is_deleted = false;

  insert into public.lsr_assignments(lead_id, assigned_to, assigned_by, previous_owner,
    routing_rule, routing_reason, routing_mode,
    overridden_by, override_reason, score_at_assign, grade_at_assign, candidates)
  values (v_lead, v_target, auth.uid(), v_prev,
    v_rule, coalesce(v_reason, ''),
    case when v_is_override then 'override'
         when v_mode = 'manual' and v_rule = 'self_claim' then 'self_claim'
         when v_mode = 'manual' then 'manual' else 'auto' end,
    case when v_is_override then auth.uid() else null end,
    case when v_is_override then v_override_reason else null end,
    (v_score ->> 'score')::int, v_score ->> 'grade', v_route -> 'candidates')
  returning id into v_assignment;

  update public.lsr_review_queue
     set state = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'أُسند بعد المراجعة'
   where lead_id = v_lead and state = 'pending';

  perform public.lsr_log('assign', 'lead', v_lead, v_override_reason,
    jsonb_build_object('assigned_to', v_target, 'previous_owner', v_prev,
      'routing_rule', v_rule, 'mode', v_mode, 'override', v_is_override));

  -- حدث إشعار — يُدرَج في الطابور بـdry_run ولا يُرسَل.
  perform public.lsr_event_emit('lead_assigned', 'lead', v_lead,
    jsonb_build_object('assignment_id', v_assignment, 'assigned_to', v_target,
                       'grade', v_score ->> 'grade'),
    'lead_assigned:' || v_lead::text || ':' || v_assignment::text);

  return jsonb_build_object('ok', true, 'assigned', true, 'lead_id', v_lead,
    'assigned_to', v_target, 'previous_owner', v_prev, 'routing_rule', v_rule,
    'routing_reason', v_reason, 'override', v_is_override,
    'assignment_id', v_assignment, 'route', v_route);
end $$;

create or replace function public.lsr_review_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', q.id, 'lead_id', q.lead_id, 'state', q.state, 'reasons', to_jsonb(q.reasons),
      'detail', q.detail, 'created_at', q.created_at,
      'lead_code', l.lead_code, 'contact_name', l.contact_name,
      'company_name', l.company_name, 'city', l.city, 'source', l.source) as x
      from public.lsr_review_queue q
      join public.crm_leads l on l.id = q.lead_id and l.is_deleted = false
     where q.state = coalesce(public.lsr_txt(p_filters, 'state'), 'pending')
     order by q.created_at desc
     limit greatest(1, least(coalesce((public.lsr_num(p_filters, 'limit'))::int, 100), 500))) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

create or replace function public.lsr_review_dismiss(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.lsr_can_route(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(btrim(coalesce(p_note, '')), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'note_required'); end if;
  update public.lsr_review_queue
     set state = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_id and state = 'pending';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  perform public.lsr_log('review_dismiss', 'review', p_id, p_note, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lsr_agent_set(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not coalesce(public.lsr_is_sales_manager(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_user := (public.lsr_txt(p_payload, 'user_id'))::uuid;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'user_id_required'); end if;

  insert into public.lsr_agents as g (
    user_id, display_name, is_active, is_available, unavailable_reason, unavailable_until,
    territories, cities, services, max_open_leads, priority, notes)
  values (
    v_user, coalesce(public.lsr_txt(p_payload, 'display_name'), ''),
    coalesce(public.lsr_bool(p_payload, 'is_active'), true),
    coalesce(public.lsr_bool(p_payload, 'is_available'), true),
    public.lsr_txt(p_payload, 'unavailable_reason'),
    (public.lsr_txt(p_payload, 'unavailable_until'))::date,
    -- حارس النوع: حمولة تُرسل نصًّا بدل مصفوفة كانت سترفع خطأ استخراج غامضًا.
    case when jsonb_typeof(p_payload -> 'territories') = 'array'
         then coalesce((select array_agg(x) from jsonb_array_elements_text(p_payload -> 'territories') x), '{}'::text[])
         else '{}'::text[] end,
    case when jsonb_typeof(p_payload -> 'cities') = 'array'
         then coalesce((select array_agg(x) from jsonb_array_elements_text(p_payload -> 'cities') x), '{}'::text[])
         else '{}'::text[] end,
    case when jsonb_typeof(p_payload -> 'services') = 'array'
         then coalesce((select array_agg(x) from jsonb_array_elements_text(p_payload -> 'services') x), '{}'::text[])
         else '{}'::text[] end,
    coalesce((public.lsr_num(p_payload, 'max_open_leads'))::int, public.lsr_setting_int('agent_default_capacity', 25)),
    coalesce((public.lsr_num(p_payload, 'priority'))::int, 100),
    public.lsr_txt(p_payload, 'notes'))
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, g.display_name),
    is_active = excluded.is_active, is_available = excluded.is_available,
    unavailable_reason = excluded.unavailable_reason, unavailable_until = excluded.unavailable_until,
    territories = excluded.territories, cities = excluded.cities, services = excluded.services,
    max_open_leads = excluded.max_open_leads, priority = excluded.priority,
    notes = coalesce(excluded.notes, g.notes);

  perform public.lsr_log('agent_set', 'agent', v_user, null, p_payload);
  return jsonb_build_object('ok', true, 'user_id', v_user);
end $$;

create or replace function public.lsr_routing_rule_upsert(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if not coalesce(public.lsr_is_sales_manager(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_key := public.lsr_txt(p_payload, 'key');
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'key_required'); end if;

  insert into public.lsr_routing_rules as r (
    key, label_ar, label_en, rule_order, match_territory, match_city, match_service,
    match_source, match_min_score, match_grades, target_mode, target_user_id, is_active,
    version, created_by)
  values (
    v_key, coalesce(public.lsr_txt(p_payload, 'label_ar'), ''),
    coalesce(public.lsr_txt(p_payload, 'label_en'), ''),
    coalesce((public.lsr_num(p_payload, 'rule_order'))::int, 100),
    public.lsr_txt(p_payload, 'match_territory'), public.lsr_txt(p_payload, 'match_city'),
    public.lsr_txt(p_payload, 'match_service'), public.lsr_txt(p_payload, 'match_source'),
    (public.lsr_num(p_payload, 'match_min_score'))::int,
    case when jsonb_typeof(p_payload -> 'match_grades') = 'array'
         then (select array_agg(x) from jsonb_array_elements_text(p_payload -> 'match_grades') x)
         else null end,
    coalesce(public.lsr_txt(p_payload, 'target_mode'), 'specialist_least_loaded'),
    (public.lsr_txt(p_payload, 'target_user_id'))::uuid,
    coalesce(public.lsr_bool(p_payload, 'is_active'), true),
    1, auth.uid())
  on conflict (key) do update set
    label_ar = excluded.label_ar, label_en = excluded.label_en, rule_order = excluded.rule_order,
    match_territory = excluded.match_territory, match_city = excluded.match_city,
    match_service = excluded.match_service, match_source = excluded.match_source,
    match_min_score = excluded.match_min_score, match_grades = excluded.match_grades,
    target_mode = excluded.target_mode, target_user_id = excluded.target_user_id,
    is_active = excluded.is_active, version = r.version + 1;

  perform public.lsr_log('routing_rule_upsert', 'routing_rule', null, null, p_payload);
  return jsonb_build_object('ok', true, 'key', v_key);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) ★★ أحداث الإشعارات ★★ — تُعرَّف وتُدرَج، ولا تُرسَل.
--     المسار: هذا الموديول → comms_enqueue → طابور المركز، وكلّ صفوفنا
--     تُجبَر على dry_run = true بعد الإدراج. لا بريد ولا واتساب ولا SMS.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.lsr_event_keys() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'subscription_activated','subscription_expiring','credits_expiring','credits_low',
    'production_request_submitted','production_request_approved','production_request_rejected',
    'overage_approval_required','quote_ready_for_review','quote_owner_approval_required',
    'quote_accepted','lead_assigned','lead_followup_due'];
$$;

-- ★ الإدراج ★ مفتاح التكرار إلزاميّ: بدونه لا يوجد ما يمنع حدثًا واحدًا من
--   الإدراج مرّتين عند إعادة المحاولة. الحارس صفّ فريد لا نيّة حسنة.
create or replace function public.lsr_event_emit(
  p_event text, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text; v_id uuid; v_hub jsonb := '{}'::jsonb; v_available boolean := false;
  v_queued int := 0; v_corr uuid;
begin
  if p_event is null or not (p_event = any(public.lsr_event_keys())) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_event', 'event', p_event);
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''),
                    p_event || ':' || coalesce(p_entity_id::text, '-') || ':' ||
                    to_char(date_trunc('day', now()), 'YYYYMMDD'));

  -- ★ الحارس أوّلًا ★ لو أُدرج الحدث سابقًا لا نلمس الطابور إطلاقًا.
  insert into public.lsr_event_log(event_key, idempotency_key, entity_type, entity_id,
                                   actor_id, payload, hub_available, dry_run)
  values (p_event, v_key, p_entity_type, p_entity_id, auth.uid(),
          coalesce(p_payload, '{}'::jsonb), false, true)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'queued', 0,
      'event', p_event, 'idempotency_key', v_key,
      'message', 'الحدث مُدرَج سابقًا بالمفتاح نفسه — لا إدراج ثانٍ.');
  end if;

  -- مركز الاتصالات اختياريّ: غيابه يُعلَن، ولا يُقرأ «أُرسل».
  if to_regprocedure('public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)') is not null
     and to_regclass('public.comms_event_catalog') is not null then
    v_available := true;
    v_corr := gen_random_uuid();
    begin
      execute 'select public.comms_enqueue($1,$2,$3,null,$4,$5,$6)'
        into v_hub
        using 'commercial.' || p_event, p_entity_type, p_entity_id, auth.uid(),
              coalesce(p_payload, '{}'::jsonb), v_corr;
      v_queued := coalesce((v_hub ->> 'queued')::int, 0);

      -- ★★ الإجبار على dry_run ★★ حتّى لو فُعِّلت قناة يومًا، صفوف هذا
      --    الموديول في V1 لا تغادر الطابور. الحارس كتابة لا وعد.
      if to_regclass('public.comms_outbox') is not null then
        execute 'update public.comms_outbox set dry_run = true where correlation_id = $1' using v_corr;
      end if;
    exception when others then
      v_hub := jsonb_build_object('ok', false, 'error', 'hub_enqueue_failed', 'detail', sqlerrm);
      v_queued := 0;
    end;
  else
    v_hub := jsonb_build_object('ok', false, 'error', 'comms_hub_not_installed');
  end if;

  update public.lsr_event_log
     set hub_available = v_available, hub_result = v_hub, queued_count = v_queued
   where id = v_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'event', p_event,
    'idempotency_key', v_key, 'hub_available', v_available, 'queued', v_queued,
    'dry_run', true, 'hub_result', v_hub,
    'message', case when v_available
                    then 'أُدرج في الطابور بـdry_run — لم يُرسَل شيء.'
                    else 'سُجّل الحدث محليًّا؛ مركز الاتصالات غير مثبَّت. لا إرسال ولا ادّعاء إرسال.' end);
end $$;

create or replace function public.lsr_events_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_rows
    from (select id, event_key, idempotency_key, entity_type, entity_id, hub_available,
                 queued_count, dry_run, created_at
            from public.lsr_event_log
           where (public.lsr_txt(p_filters, 'event') is null
                  or event_key = public.lsr_txt(p_filters, 'event'))
           order by created_at desc
           limit greatest(1, least(coalesce((public.lsr_num(p_filters, 'limit'))::int, 100), 500))) e;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'delivery', jsonb_build_object('email', 'disabled', 'whatsapp', 'disabled', 'sms', 'disabled',
                                   'mode', 'dry_run_only'));
end $$;

-- تسجيل الأحداث في كتالوج مركز الاتصالات — إن وُجد. بادئة commercial. كي لا
-- تتصادم مع مفردات المركز القائمة، والقنوات تبقى كما هي (لا تفعيل من هنا).
do $ev$
declare k text; v_aud text; v_fin boolean; v_ar text;
begin
  if to_regclass('public.comms_event_catalog') is null then return; end if;

  foreach k in array public.lsr_event_keys() loop
    v_aud := case k
      when 'subscription_activated'        then 'both'
      when 'subscription_expiring'         then 'both'
      when 'credits_expiring'              then 'both'
      when 'credits_low'                   then 'both'
      when 'production_request_approved'   then 'both'
      when 'production_request_rejected'   then 'both'
      when 'quote_accepted'                then 'both'
      else 'internal' end;
    v_fin := (k = 'overage_approval_required');
    v_ar := case k
      when 'subscription_activated'         then 'تفعيل اشتراك'
      when 'subscription_expiring'          then 'اقتراب انتهاء اشتراك'
      when 'credits_expiring'               then 'اقتراب انتهاء رصيد'
      when 'credits_low'                    then 'انخفاض الرصيد'
      when 'production_request_submitted'   then 'طلب إنتاج جديد'
      when 'production_request_approved'    then 'اعتماد طلب إنتاج'
      when 'production_request_rejected'    then 'رفض طلب إنتاج'
      when 'overage_approval_required'      then 'تجاوز يحتاج اعتماد المالك'
      when 'quote_ready_for_review'         then 'عرض سعر جاهز للمراجعة'
      when 'quote_owner_approval_required'  then 'عرض سعر ينتظر اعتماد المالك'
      when 'quote_accepted'                 then 'قبول عرض سعر'
      when 'lead_assigned'                  then 'إسناد عميل محتمل'
      when 'lead_followup_due'              then 'متابعة مستحقّة'
      else k end;

    execute format(
      'insert into public.comms_event_catalog(event_key, category, audience, is_financial,
         mandatory, channels, rate_limit_hour, label_ar, label_en, active)
       values (%L, %L, %L, %L, false, array[%L,%L]::text[], 200, %L, %L, true)
       on conflict (event_key) do nothing',
      'commercial.' || k, 'commercial', v_aud, v_fin, 'portal', 'email', v_ar, replace(k, '_', ' '));

    if to_regclass('public.comms_templates') is not null then
      -- قالبان لكلّ حدث: داخليّ وعميل. نصوص بلا أرقام مالية في نطاق العميل،
      -- كي لا يصطدم بحارس المحتوى المقيَّد في المركز ولا يتسرّب رقم داخليّ.
      execute format(
        'insert into public.comms_templates(event_key, locale, audience_scope, version,
           subject_tpl, body_tpl, is_active)
         values (%L, %L, %L, 1, %L, %L, true)
         on conflict (event_key, locale, audience_scope, version) do nothing',
        'commercial.' || k, 'ar', 'internal', v_ar,
        v_ar || ' — تفاصيل الحدث في البوّابة: {{action_url}}');
      if v_aud in ('both','client') then
        execute format(
          'insert into public.comms_templates(event_key, locale, audience_scope, version,
             subject_tpl, body_tpl, is_active)
           values (%L, %L, %L, 1, %L, %L, true)
           on conflict (event_key, locale, audience_scope, version) do nothing',
          'commercial.' || k, 'ar', 'client', v_ar,
          'تحديث على حسابك: ' || v_ar || '. التفاصيل في بوّابتك: {{action_url}}');
      end if;
    end if;
  end loop;
end $ev$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) عقد المالية — ★ مرجع للقراءة فقط ★
--     لا فاتورة، ولا Zoho، ولا ادّعاء تحصيل، ولا اعتراف بإيراد. مراجع فقط.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.lsr_finance_reference(p_subscription uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_sub jsonb; v_recv jsonb; v_over jsonb; v_ok boolean;
begin
  if not coalesce(public.lsr_is_sales_manager(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if to_regclass('public.csub_subscriptions') is null then
    return jsonb_build_object('ok', true, 'available', false, 'module', 'subscriptions',
      'reason', 'module_not_enabled',
      'message', 'وحدة الاشتراكات غير مفعّلة على هذه القاعدة. لا رصيد ولا مبلغ يُعرض — الغياب يُعلَن ولا يُقرأ صفرًا.');
  end if;

  execute '
    select jsonb_build_object(
      ''subscription_id'', s.id, ''code'', s.code, ''status'', s.status,
      ''contract_reference'', s.contract_reference,
      ''start_date'', s.start_date, ''end_date'', s.end_date, ''renewal_date'', s.renewal_date,
      ''price_net'', s.price_net, ''vat_rate'', s.vat_rate, ''vat_amount'', s.vat_amount,
      ''price_gross'', s.price_gross, ''currency'', s.currency,
      ''renewal_amount_net'', s.price_net,
      ''renewal_amount_note'', ''مبلغ التجديد = السعر التعاقديّ الحاليّ ما لم يُعتمد تغيير. لا فوترة ولا تحصيل من هنا.'')
      from public.csub_subscriptions s where s.id = $1 and s.is_deleted = false'
    into v_sub using p_subscription;

  if v_sub is null then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;

  -- تقدير التجاوز بالوحدات (لا بالمال) من طلبات الخدمة المعلّقة.
  if to_regclass('public.csub_service_requests') is not null then
    execute '
      select jsonb_build_object(
        ''pending_requests'', count(*) filter (where r.status in (''submitted'',''under_review'',''needs_overage_approval'')),
        ''overage_estimate_units'', coalesce(sum(r.overage_estimate_units), 0))
        from public.csub_service_requests r
       where r.subscription_id = $1 and r.is_deleted = false'
      into v_over using p_subscription;
  end if;

  -- مرجع الذمم: **مرجع وحالة سداد للقراءة فقط**. لا تحصيل ولا إثبات دفع.
  v_ok := to_regclass('public.fin_receivables') is not null;
  if v_ok then
    begin
      execute '
        select coalesce(jsonb_agg(jsonb_build_object(
                 ''receivable_reference'', r.code, ''status'', r.status,
                 ''due_date'', r.due_date, ''amount_net'', r.amount_net,
                 ''vat_amount'', r.vat_amount)), ''[]''::jsonb)
          from public.fin_receivables r
         where r.contract_reference = $1'
        into v_recv using (v_sub ->> 'contract_reference');
    exception when others then
      v_recv := null; v_ok := false;
    end;
  end if;

  return jsonb_build_object('ok', true, 'available', true,
    'subscription', v_sub,
    'overage', coalesce(v_over, jsonb_build_object('pending_requests', 0, 'overage_estimate_units', 0)),
    'receivables', case when v_ok then coalesce(v_recv, '[]'::jsonb) else null end,
    'receivables_available', v_ok,
    'invoice_reference', jsonb_build_object(
      'source', 'external', 'created_by_this_module', false,
      'note', 'الفاتورة تُصدَر خارج المنصّة. هذا الحقل مرجع نصيّ فقط.'),
    'payment_status_is_read_only', true,
    'revenue_recognized', false,
    'contract_note',
      'عقد بيانات لا كتابة متبادلة: هذه الوحدة تقرأ مراجع المالية ولا تكتب فيها، ولا تنشئ فاتورة، ولا تنادي Zoho، ولا تدّعي تحصيلًا.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) ★★ اللوحات الأربع ★★
--      كلّ قسم يعلن توفّره: الغياب «غير مفعّل» لا «صفر». هذا الفرق هو الفرق
--      بين معلومة وكذبة يتصرّف العميل بناءً عليها.
-- ════════════════════════════════════════════════════════════════════════════

-- 10.1 لوحة المالك التجارية — ★ المالك وحده ★
create or replace function public.lsr_dashboard_owner(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_subs jsonb; v_ren jsonb; v_credit jsonb; v_over jsonb; v_util jsonb;
  v_quotes jsonb; v_disc jsonb; v_stale jsonb; v_cancel jsonb; v_leads jsonb;
  v_has_csub boolean; v_has_sq boolean; v_stale_days int; v_min_score int;
begin
  if not coalesce(public.lsr_can_view_owner_dashboard(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_has_csub := to_regclass('public.csub_subscriptions') is not null;
  v_has_sq   := to_regclass('public.sq_quotes') is not null;
  v_stale_days := public.lsr_setting_int('stale_quote_days', 14);
  v_min_score  := public.lsr_setting_int('high_value_min_score', 75);

  if v_has_csub then
    execute '
      select jsonb_build_object(
        ''active_count'', count(*) filter (where s.status = ''active''),
        ''monthly_contracted_net'', coalesce(sum(s.price_net) filter (where s.status = ''active''), 0),
        ''annual_contracted_net'', coalesce(sum(s.price_net) filter (where s.status = ''active''), 0) * 12,
        ''vat_total'', coalesce(sum(s.vat_amount) filter (where s.status = ''active''), 0),
        ''currency'', ''SAR'')
        from public.csub_subscriptions s where s.is_deleted = false'
      into v_subs;

    execute '
      select jsonb_build_object(
        ''in_30'', count(*) filter (where s.status = ''active'' and s.end_date is not null
                                     and s.end_date between current_date and current_date + 30),
        ''in_60'', count(*) filter (where s.status = ''active'' and s.end_date is not null
                                     and s.end_date > current_date + 30 and s.end_date <= current_date + 60),
        ''in_90'', count(*) filter (where s.status = ''active'' and s.end_date is not null
                                     and s.end_date > current_date + 60 and s.end_date <= current_date + 90),
        ''amount_30_net'', coalesce(sum(s.price_net) filter (where s.status = ''active''
                                     and s.end_date between current_date and current_date + 30), 0))
        from public.csub_subscriptions s where s.is_deleted = false'
      into v_ren;

    execute '
      select jsonb_build_object(
        ''cancelled_90d'', count(*) filter (where s.status = ''cancelled''
                             and s.cancelled_at >= now() - interval ''90 days''),
        ''suspended'', count(*) filter (where s.status = ''suspended''))
        from public.csub_subscriptions s where s.is_deleted = false'
      into v_cancel;

    if to_regclass('public.csub_ledger') is not null then
      execute '
        with bal as (
          select l.subscription_id, l.unit_type,
                 sum(l.d_allocated) as allocated, sum(l.d_reserved) as reserved,
                 sum(l.d_used) as used, sum(l.d_expired) as expired
            from public.csub_ledger l group by 1, 2)
        select jsonb_build_object(
          ''units_available'', coalesce(sum(allocated - reserved - used - expired), 0),
          ''units_allocated'', coalesce(sum(allocated), 0),
          ''units_used'', coalesce(sum(used), 0),
          ''utilization_pct'', case when coalesce(sum(allocated), 0) = 0 then null
                                    else round((sum(used) / sum(allocated)) * 100, 1) end)
          from bal'
        into v_util;

      execute '
        with bal as (
          select l.subscription_id, l.unit_type,
                 sum(l.d_allocated) - sum(l.d_reserved) - sum(l.d_used) - sum(l.d_expired) as available
            from public.csub_ledger l group by 1, 2)
        select jsonb_build_object(
          ''subscriptions_with_credit_expiring_30d'', count(distinct b.subscription_id),
          ''units_at_risk'', coalesce(sum(b.available), 0))
          from bal b
          join public.csub_subscriptions s on s.id = b.subscription_id
         where b.available > 0 and s.status = ''active'' and s.is_deleted = false
           and s.end_date is not null and s.end_date between current_date and current_date + 30'
        into v_credit;
    end if;

    if to_regclass('public.csub_approval_requests') is not null then
      execute '
        select jsonb_build_object(
          ''overage_pending'', count(*) filter (where a.kind = ''overage'' and a.status = ''pending''),
          ''all_pending'', count(*) filter (where a.status = ''pending''))
          from public.csub_approval_requests a'
        into v_over;
    end if;
  end if;

  if v_has_sq then
    execute format('
      select jsonb_build_object(
        ''total_90d'', count(*) filter (where q.created_at >= now() - interval ''90 days''),
        ''accepted_90d'', count(*) filter (where q.status = ''accepted''
                            and q.created_at >= now() - interval ''90 days''),
        ''conversion_pct'', case when count(*) filter (where q.created_at >= now() - interval ''90 days''
                                    and q.status in (''accepted'',''rejected'',''expired'')) = 0
                                 then null
                                 else round(100.0 * count(*) filter (where q.status = ''accepted''
                                        and q.created_at >= now() - interval ''90 days'')
                                      / count(*) filter (where q.created_at >= now() - interval ''90 days''
                                        and q.status in (''accepted'',''rejected'',''expired'')), 1) end,
        ''awaiting_owner_approval'', count(*) filter (where q.status = ''pending_owner_approval''),
        ''stale'', count(*) filter (where q.status in (''draft'',''internal_review'',''sent_placeholder'')
                       and q.updated_at < now() - interval ''%s days''))
        from public.sq_quotes q', v_stale_days)
      into v_quotes;

    if to_regclass('public.sq_approval_requests') is not null then
      execute '
        select jsonb_build_object(
          ''pending'', count(*) filter (where a.status = ''pending''),
          ''discount_pending'', count(*) filter (where a.status = ''pending'' and a.kind = ''discount''))
          from public.sq_approval_requests a'
        into v_disc;
    end if;
  end if;

  -- عملاء محتملون عاليو القيمة — من محرّك التقييم نفسه لا من تقدير موازٍ.
  select jsonb_build_object('rows', coalesce(jsonb_agg(x), '[]'::jsonb), 'count', count(*))
    into v_leads
    from (
      select jsonb_build_object('lead_id', l.id, 'lead_code', l.lead_code,
               'company_name', l.company_name, 'owner_user_id', l.owner_user_id,
               'score', (public.lsr_score_core(l.id) ->> 'score')::int,
               'grade', public.lsr_score_core(l.id) ->> 'grade') as x
        from public.crm_leads l
       where l.is_deleted = false and l.status in ('new','contacted','working','qualified')
       order by l.updated_at desc
       limit 60) t
   where (x ->> 'score')::int >= v_min_score;

  return jsonb_build_object(
    'ok', true, 'as_of', now(),
    'subscriptions', jsonb_build_object('available', v_has_csub,
      'reason', case when v_has_csub then null else 'module_not_enabled' end, 'data', v_subs),
    'renewals', jsonb_build_object('available', v_has_csub,
      'reason', case when v_has_csub then null else 'module_not_enabled' end, 'data', v_ren),
    'expiring_credit', jsonb_build_object('available', v_credit is not null,
      'reason', case when v_credit is not null then null else 'module_not_enabled' end, 'data', v_credit),
    'credit_utilization', jsonb_build_object('available', v_util is not null,
      'reason', case when v_util is not null then null else 'module_not_enabled' end, 'data', v_util),
    'overage_requests', jsonb_build_object('available', v_over is not null,
      'reason', case when v_over is not null then null else 'module_not_enabled' end, 'data', v_over),
    'quotes', jsonb_build_object('available', v_has_sq,
      'reason', case when v_has_sq then null else 'module_not_enabled' end, 'data', v_quotes),
    'discount_approvals', jsonb_build_object('available', v_disc is not null,
      'reason', case when v_disc is not null then null else 'module_not_enabled' end, 'data', v_disc),
    'cancellations', jsonb_build_object('available', v_has_csub,
      'reason', case when v_has_csub then null else 'module_not_enabled' end, 'data', v_cancel),
    'high_value_leads', jsonb_build_object('available', true, 'min_score', v_min_score, 'data', v_leads),
    'honesty_note',
      'كلّ قسم يحمل available صراحةً. «غير مفعّل» ليس صفرًا، ولا يجوز عرضه رصيدًا أو قيمة تعاقدية.');
end $$;

-- 10.2 لوحة المبيعات — نطاقها المستخدِم نفسه، والمدير يرى فريقه.
create or replace function public.lsr_dashboard_sales(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid; v_mgr boolean; v_leads jsonb; v_follow jsonb; v_quotes jsonb;
  v_ren jsonb; v_scope text; v_stale_days int; v_over_days int;
begin
  if not coalesce(public.lsr_can_view(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_me  := auth.uid();
  v_mgr := coalesce(public.lsr_is_sales_manager(), false);
  v_scope := case when v_mgr then 'team' else 'self' end;
  v_stale_days := public.lsr_setting_int('stale_quote_days', 14);
  v_over_days  := public.lsr_setting_int('followup_overdue_days', 3);

  select jsonb_build_object(
      'open', count(*) filter (where l.status in ('new','contacted','working','qualified')),
      'new', count(*) filter (where l.status = 'new'),
      'qualified', count(*) filter (where l.status = 'qualified'),
      'unowned_visible', count(*) filter (where l.owner_user_id is null))
    into v_leads
    from public.crm_leads l
   where l.is_deleted = false
     and (v_mgr or l.owner_user_id = v_me);

  select jsonb_build_object(
      'due_today', count(*) filter (where l.next_action_due = current_date),
      'overdue', count(*) filter (where l.next_action_due < current_date),
      'overdue_beyond_threshold', count(*) filter
        (where l.next_action_due < current_date - v_over_days))
    into v_follow
    from public.crm_leads l
   where l.is_deleted = false and l.next_action_due is not null
     and l.status in ('new','contacted','working','qualified')
     and (v_mgr or l.owner_user_id = v_me);

  -- ★ عروض الأسعار: أرقام البيع فقط. لا تكلفة ولا هامش ولا أرضية — تلك
  --   تسكن sq_quote_internal ولا تُقرأ هنا إطلاقًا.
  if to_regclass('public.sq_quotes') is not null then
    execute format('
      select jsonb_build_object(
        ''mine_open'', count(*) filter (where q.status in (''draft'',''internal_review'')),
        ''awaiting_owner_approval'', count(*) filter (where q.status = ''pending_owner_approval''),
        ''approved_not_sent'', count(*) filter (where q.status = ''approved''),
        ''accepted_90d'', count(*) filter (where q.status = ''accepted''
                            and q.updated_at >= now() - interval ''90 days''),
        ''stale'', count(*) filter (where q.status in (''draft'',''internal_review'',''sent_placeholder'')
                       and q.updated_at < now() - interval ''%s days''))
        from public.sq_quotes q
       where ($1 or q.created_by = $2)', v_stale_days)
      into v_quotes using v_mgr, v_me;
  end if;

  if to_regclass('public.csub_subscriptions') is not null then
    execute '
      select jsonb_build_object(
        ''renewals_60d'', count(*) filter (where s.status = ''active'' and s.end_date is not null
                             and s.end_date between current_date and current_date + 60),
        ''upsell_candidates'', count(*) filter (where s.status = ''active'' and s.allow_overage))
        from public.csub_subscriptions s where s.is_deleted = false'
      into v_ren;
  end if;

  return jsonb_build_object('ok', true, 'as_of', now(), 'scope', v_scope,
    'my_leads', v_leads,
    'followups', v_follow,
    'lead_scoring', jsonb_build_object('available', true,
      'note', 'استعمل lsr_score_scan لقائمة مرتّبة بالدرجة، مع الشرح لكلّ صفّ.'),
    'quotes', jsonb_build_object('available', v_quotes is not null,
      'reason', case when v_quotes is not null then null else 'module_not_enabled' end, 'data', v_quotes),
    'renewals', jsonb_build_object('available', v_ren is not null,
      'reason', case when v_ren is not null then null else 'module_not_enabled' end, 'data', v_ren),
    'excluded_by_design', jsonb_build_array('cost','margin','floor_price','profit'),
    'honesty_note', 'هذه اللوحة لا تحمل تكلفة ولا هامشًا ولا أرضية سعر — لا إخفاءً في الواجهة بل غيابًا في المصدر.');
end $$;

-- 10.3 لوحة العميل — ★ لا سعر داخليّ ولا هامش ولا ملاحظة داخلية ★
create or replace function public.lsr_dashboard_client(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_client uuid; v_subs jsonb; v_bal jsonb; v_req jsonb; v_ledger jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if to_regprocedure('public.my_client_id()') is null then
    return jsonb_build_object('ok', true, 'available', false, 'reason', 'identity_not_enabled',
      'message', 'ربط الحساب بالعميل غير مفعّل على هذه القاعدة.');
  end if;
  execute 'select public.my_client_id()' into v_client;
  if v_client is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_client_account'); end if;
  if to_regclass('public.csub_subscriptions') is null then
    return jsonb_build_object('ok', true, 'available', false, 'reason', 'module_not_enabled',
      'message', 'خدمة الرصيد الإنتاجيّ غير مفعّلة بعد. لا رصيد يُعرض — ولا يُقرأ الغياب صفرًا.');
  end if;

  -- الأعمدة المختارة هنا هي ما يخصّ العميل وحده: باقته وشروطه ومبالغه هو.
  execute '
    select coalesce(jsonb_agg(jsonb_build_object(
             ''subscription_id'', s.id, ''code'', s.code, ''status'', s.status,
             ''start_date'', s.start_date, ''end_date'', s.end_date, ''renewal_date'', s.renewal_date,
             ''package'', s.client_description, ''terms'', s.terms, ''limitations'', s.limitations,
             ''price_net'', s.price_net, ''vat_rate'', s.vat_rate, ''vat_amount'', s.vat_amount,
             ''price_gross'', s.price_gross, ''currency'', s.currency,
             ''allow_overage'', s.allow_overage,
             ''overage_requires_approval'', s.overage_requires_approval)), ''[]''::jsonb)
      from public.csub_subscriptions s
     where s.client_id = $1 and s.is_deleted = false and s.status <> ''draft'''
    into v_subs using v_client;

  if to_regclass('public.csub_ledger') is not null then
    execute '
      with bal as (
        select l.subscription_id, l.unit_type,
               sum(l.d_allocated) as allocated, sum(l.d_reserved) as reserved,
               sum(l.d_used) as used, sum(l.d_expired) as expired
          from public.csub_ledger l where l.client_id = $1 group by 1, 2)
      select coalesce(jsonb_agg(jsonb_build_object(
               ''subscription_id'', b.subscription_id, ''unit_type'', b.unit_type,
               ''allocated'', b.allocated, ''reserved'', b.reserved, ''used'', b.used,
               ''expired'', b.expired,
               ''available'', b.allocated - b.reserved - b.used - b.expired)), ''[]''::jsonb)
        from bal b'
      into v_bal using v_client;

    execute '
      select coalesce(jsonb_agg(jsonb_build_object(
               ''occurred_at'', l.occurred_at, ''unit_type'', l.unit_type,
               ''entry_type'', l.entry_type, ''quantity'', l.quantity,
               ''usage_date'', l.usage_date, ''description'', l.client_description,
               ''overage_units'', l.overage_units,
               ''overage_amount_net'', l.overage_amount_net,
               ''overage_vat_amount'', l.overage_vat_amount,
               ''overage_amount_gross'', l.overage_amount_gross)
             order by l.occurred_at desc), ''[]''::jsonb)
        from (select * from public.csub_ledger l2
               where l2.client_id = $1 order by l2.occurred_at desc limit 100) l'
      into v_ledger using v_client;
  end if;

  if to_regclass('public.csub_service_requests') is not null then
    execute '
      select coalesce(jsonb_agg(jsonb_build_object(
               ''id'', r.id, ''code'', r.code, ''status'', r.status, ''unit_type'', r.unit_type,
               ''units'', r.units, ''credits_required'', r.credits_required,
               ''overage_estimate_units'', r.overage_estimate_units,
               ''city'', r.city, ''preferred_date'', r.preferred_date,
               ''scheduled_date'', r.scheduled_date, ''decision_note'', r.client_decision_note)
             order by r.created_at desc), ''[]''::jsonb)
        from public.csub_service_requests r
       where r.client_id = $1 and r.is_deleted = false'
      into v_req using v_client;
  end if;

  return jsonb_build_object('ok', true, 'available', true,
    'client_id', v_client,
    'subscriptions', v_subs,
    'balances', coalesce(v_bal, '[]'::jsonb),
    'requests', coalesce(v_req, '[]'::jsonb),
    'usage_ledger', coalesce(v_ledger, '[]'::jsonb),
    'excluded_by_design',
      jsonb_build_array('internal_notes','internal_metadata','decision_reason',
                        'cost','margin','floor_price','profit','supplier_rate'),
    'note', 'أرقامك أنت: سعر باقتك وضريبتها ورصيدك واستهلاكك. لا تكلفة ولا هامش ولا ملاحظة داخلية.');
end $$;

-- 10.4 طابور العمليات — ★ بلا ماليّة حسّاسة ★ الرصيد المحجوز بالوحدات لا بالمال.
create or replace function public.lsr_dashboard_operations(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_counts jsonb;
begin
  if not coalesce(public.lsr_can_view_ops_queue(), false) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if to_regclass('public.csub_service_requests') is null then
    return jsonb_build_object('ok', true, 'available', false, 'reason', 'module_not_enabled',
      'message', 'وحدة طلبات الإنتاج غير مفعّلة. لا طابور يُعرض — ولا يُقرأ الغياب «لا طلبات».');
  end if;

  execute '
    select coalesce(jsonb_agg(jsonb_build_object(
             ''request_id'', r.id, ''code'', r.code, ''status'', r.status,
             ''service'', r.unit_type, ''units'', r.units,
             ''credits_reserved_units'', r.credits_required,
             ''overage_estimate_units'', r.overage_estimate_units,
             ''city'', r.city, ''location'', r.location_text,
             ''preferred_date'', r.preferred_date, ''alternative_date'', r.alternative_date,
             ''scheduled_date'', r.scheduled_date,
             ''scheduling_status'', case when r.scheduled_date is not null then ''scheduled''
                                         when r.status = ''approved'' then ''awaiting_scheduling''
                                         else r.status end,
             ''is_urgent'', r.is_urgent, ''decided_at'', r.decided_at)
           order by coalesce(r.scheduled_date, r.preferred_date) nulls last), ''[]''::jsonb)
      from public.csub_service_requests r
     where r.is_deleted = false
       and r.status in (''approved'',''credit_reserved'',''scheduled'')'
    into v_rows;

  execute '
    select jsonb_build_object(
      ''approved_unscheduled'', count(*) filter (where r.status = ''approved'' and r.scheduled_date is null),
      ''scheduled'', count(*) filter (where r.status = ''scheduled''),
      ''urgent_open'', count(*) filter (where r.is_urgent and r.status in (''approved'',''credit_reserved'')))
      from public.csub_service_requests r
     where r.is_deleted = false'
    into v_counts;

  return jsonb_build_object('ok', true, 'available', true,
    'rows', v_rows, 'counts', v_counts,
    'excluded_by_design',
      jsonb_build_array('price_net','vat_amount','overage_amount_net','cost','margin','profit','client_pricing'),
    'note', 'طابور تشغيليّ: خدمة وتواريخ ومدينة ورصيد محجوز بالوحدات وحالة الجدولة. لا مبلغ ولا ضريبة ولا هامش.');
end $$;

-- سطح موحّد صغير للواجهة: ماذا أملك، وما المفعّل فعلًا.
create or replace function public.lsr_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'authenticated', auth.uid() is not null,
    'is_staff', coalesce(public.is_staff(), false),
    'can_view', coalesce(public.lsr_can_view(), false),
    'can_manage_scoring', coalesce(public.lsr_can_manage_scoring(), false),
    'can_override_score', coalesce(public.lsr_can_override_score(), false),
    'can_route', coalesce(public.lsr_can_route(), false),
    'can_reassign', coalesce(public.lsr_can_reassign(), false),
    'can_view_owner_dashboard', coalesce(public.lsr_can_view_owner_dashboard(), false),
    'can_view_ops_queue', coalesce(public.lsr_can_view_ops_queue(), false),
    'modules', jsonb_build_object(
      'subscriptions', to_regclass('public.csub_subscriptions') is not null,
      'quotes',        to_regclass('public.sq_quotes') is not null,
      'finance',       to_regclass('public.fin_receivables') is not null,
      'comms_hub',     to_regclass('public.comms_event_catalog') is not null),
    'delivery', jsonb_build_object('email', 'disabled', 'whatsapp', 'disabled',
                                   'sms', 'disabled', 'mode', 'dry_run_only'));
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) البذور — مجموعة قواعد التقييم الأولى، وقواعد التوزيع الأولى.
--      تُزرع مرّة واحدة: إعادة التشغيل لا تعيد كتابة قواعد نُشرت.
-- ════════════════════════════════════════════════════════════════════════════
do $seed$
begin
  if exists (select 1 from public.lsr_rulesets) then return; end if;

  insert into public.lsr_rulesets(version, status, note_ar) values (1, 'draft', 'المجموعة الأولى');

  insert into public.lsr_rules(ruleset_version, key, factor_key, operator, value_text, value_num,
                               value_num2, value_list, points, label_ar, label_en, sort_order) values
  -- الميزانية
  (1,'budget_large','budget_range','in',null,null,null,array['50k_200k','over_200k'],18,
     'ميزانية ٥٠ ألفًا فأكثر','Budget 50k+',10),
  (1,'budget_mid','budget_range','equals','10k_50k',null,null,null,10,
     'ميزانية ١٠–٥٠ ألفًا','Budget 10k-50k',20),
  (1,'budget_small','budget_range','equals','under_10k',null,null,null,-6,
     'ميزانية دون ١٠ آلاف','Budget under 10k',30),
  -- نوع الجهة
  (1,'org_government','organization_type','in',null,null,null,array['government','semi_government'],12,
     'جهة حكومية أو شبه حكومية','Government / semi-government',40),
  (1,'org_corporate','organization_type','in',null,null,null,array['corporate','agency'],8,
     'شركة كبيرة أو وكالة','Corporate or agency',50),
  (1,'org_individual','organization_type','equals','individual',null,null,null,-8,
     'فرد','Individual',60),
  -- حجم الشركة
  (1,'size_large','company_size','in',null,null,null,array['large','enterprise'],8,
     'شركة كبيرة','Large company',70),
  (1,'size_micro','company_size','equals','micro',null,null,null,-4,
     'منشأة متناهية الصغر','Micro business',80),
  -- نوع الخدمة
  (1,'service_high_value','service_type','in',null,null,null,
     array['corporate_film','commercial_ad','documentary','animation_motion'],10,
     'خدمة عالية القيمة','High-value service',90),
  (1,'service_recurring','service_type','in',null,null,null,
     array['social_content','training_content','podcast'],6,
     'خدمة قابلة للتكرار الشهريّ','Recurring-friendly service',100),
  -- الانتشار
  (1,'many_locations','locations_count','gte',null,3,null,null,6,
     'ثلاثة مواقع فأكثر','3+ locations',110),
  (1,'many_cities','cities_count','gte',null,2,null,null,6,
     'مدينتان فأكثر','2+ cities',120),
  -- الاستعجال والتسليم
  (1,'urgency_high','urgency','in',null,null,null,array['high','immediate'],6,
     'استعجال مرتفع','High urgency',130),
  (1,'delivery_tight','desired_delivery_days','lt',null,7,null,null,-5,
     'تسليم أقلّ من أسبوع — ضغط تشغيليّ','Delivery under 7 days',140),
  (1,'delivery_comfortable','desired_delivery_days','between',null,14,90,null,5,
     'مهلة تسليم مريحة','Comfortable delivery window',150),
  -- اكتمال البيانات
  (1,'data_complete','data_completeness','gte',null,80,null,null,8,
     'بيانات شبه مكتملة','Data mostly complete',160),
  (1,'data_poor','data_completeness','lt',null,40,null,null,-10,
     'بيانات ناقصة بشدّة','Data severely incomplete',170),
  -- المصدر
  (1,'src_referral','lead_source','in',null,null,null,array['referral','existing_client','partner'],14,
     'ترشيح أو شريك أو عميل حاليّ','Referral / partner / existing client',180),
  (1,'src_inbound','lead_source','in',null,null,null,
     array['website','whatsapp','instagram','linkedin','x','tiktok','email','phone','event'],8,
     'مصدر وارد','Inbound source',190),
  (1,'src_cold','lead_source','equals','cold_outreach',null,null,null,-6,
     'تواصل بارد','Cold outreach',200),
  -- عميل حاليّ واستمرارية
  (1,'existing_client','existing_client','is_true',null,null,null,null,12,
     'عميل حاليّ','Existing client',210),
  (1,'retainer_likely','retainer_potential','in',null,null,null,array['likely','confirmed_interest'],12,
     'احتمال عقد مستمرّ','Retainer likely',220),
  (1,'annual_value_high','annual_value_potential','gte',null,300000,null,null,14,
     'قيمة سنوية ٣٠٠ ألف فأكثر','Annual value 300k+',230),
  (1,'annual_value_mid','annual_value_potential','between',null,100000,299999,null,8,
     'قيمة سنوية ١٠٠–٣٠٠ ألف','Annual value 100k-300k',240),
  -- التعقيد
  (1,'complexity_high','production_complexity','in',null,null,null,array['complex','very_complex'],6,
     'إنتاج معقّد — قيمة أعلى','Complex production',250),
  (1,'complexity_simple','production_complexity','equals','simple',null,null,null,-3,
     'إنتاج بسيط','Simple production',260),
  -- الجغرافيا والقطاع
  (1,'territory_core','territory','in',null,null,null,array['central','western','eastern'],5,
     'إقليم رئيسيّ للتغطية','Core coverage territory',270),
  (1,'territory_unknown','territory','not_empty',null,null,null,null,2,
     'الإقليم معروف','Territory known',280),
  (1,'strategic_sector','strategic_sector','is_true',null,null,null,null,8,
     'قطاع استراتيجيّ','Strategic sector',290),
  -- الخسارة السابقة
  (1,'lost_on_price','previous_lost_reason','equals','price',null,null,null,-8,
     'خسارة سابقة بسبب السعر','Previously lost on price',300),
  (1,'lost_on_timeline','previous_lost_reason','in',null,null,null,array['timeline','scope'],-4,
     'خسارة سابقة بسبب المدّة أو النطاق','Previously lost on timeline/scope',310),
  -- سلوك الاستجابة
  (1,'responsive','response_behaviour','equals','responsive',null,null,null,10,
     'سريع الاستجابة','Responsive',320),
  (1,'slow_response','response_behaviour','equals','slow',null,null,null,-3,
     'استجابة بطيئة','Slow response',330),
  (1,'unresponsive','response_behaviour','equals','unresponsive',null,null,null,-12,
     'لا يستجيب بعد محاولات','Unresponsive after attempts',340);

  update public.lsr_rulesets set status = 'published', published_at = now() where version = 1;

  insert into public.lsr_routing_rules(key, label_ar, label_en, rule_order, match_territory,
    match_service, match_grades, target_mode) values
    ('grade_a_specialist', 'الفئة A إلى متخصّص متاح', 'Grade A to available specialist', 10,
      null, null, array['A'], 'specialist_least_loaded'),
    ('by_territory',       'حسب الإقليم ثمّ أقلّ حِملًا', 'By territory then least loaded', 50,
      null, null, null, 'specialist_least_loaded'),
    ('fallback_least_loaded', 'احتياطيّ: أقلّ حِملًا', 'Fallback: least loaded', 900,
      null, null, null, 'least_loaded')
  on conflict (key) do nothing;
end $seed$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) RLS — كلّ جدول مُقفَل. القراءة للموظّف المخوَّل، والكتابة عبر الدوالّ
--      وحدها (لا سياسة insert/update/delete لأيّ دور تطبيقيّ).
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array[
    'lsr_settings','lsr_factors','lsr_rulesets','lsr_rules','lsr_lead_profile',
    'lsr_territories','lsr_score_manual','lsr_agents','lsr_routing_rules',
    'lsr_assignments','lsr_review_queue','lsr_audit','lsr_event_log']
  loop
    -- ملاحظة مقصودة: **بلا** FORCE. مالك الجدول (postgres) هو من تعمل تحته
    -- دوالّ SECURITY DEFINER؛ وبما أنّنا لا نضع أيّ سياسة كتابة، فإنّ FORCE
    -- كان سيمنع دوالّنا نفسها من الكتابة ويكسر الموديول بصمت. المنع للأدوار
    -- التطبيقية قائم أصلًا: لا سياسة insert/update/delete ولا منحة جدول.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
  end loop;

  -- قراءة عامّة داخل الموديول (موظّف مخوَّل فقط).
  foreach t in array array[
    'lsr_settings','lsr_factors','lsr_rulesets','lsr_rules','lsr_territories',
    'lsr_agents','lsr_routing_rules','lsr_review_queue','lsr_event_log']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (coalesce(public.lsr_can_view(), false))', t || '_read', t);
  end loop;

  -- بيانات مرتبطة بعميل محتمل: تخضع لرؤية العميل في CRM إن توفّرت الدالّة.
  foreach t in array array['lsr_lead_profile','lsr_score_manual','lsr_assignments']
  loop
    if to_regprocedure('public.crm_can_read_lead(uuid)') is not null then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (coalesce(public.lsr_can_view(), false)
                  and coalesce(public.crm_can_read_lead(lead_id), false))', t || '_read', t);
    else
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (coalesce(public.lsr_can_view(), false))', t || '_read', t);
    end if;
  end loop;

  -- التدقيق: إدارة المبيعات والمالك فقط.
  execute 'create policy lsr_audit_read on public.lsr_audit for select to authenticated
             using (coalesce(public.lsr_is_sales_manager(), false))';
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) الصلاحيات التنفيذية — لا anon في أيّ مسار، ولا service_role في متصفّح.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  foreach f in array array[
    'public.lsr_access()',
    'public.lsr_score(uuid)',
    'public.lsr_score_scan(jsonb)',
    'public.lsr_score_manual_set(jsonb)',
    'public.lsr_profile_set(jsonb)',
    'public.lsr_rule_upsert(jsonb)',
    'public.lsr_ruleset_clone(text)',
    'public.lsr_ruleset_publish(int,text)',
    'public.lsr_route_preview(uuid)',
    'public.lsr_assign(jsonb)',
    'public.lsr_review_list(jsonb)',
    'public.lsr_review_dismiss(uuid,text)',
    'public.lsr_agent_set(jsonb)',
    'public.lsr_routing_rule_upsert(jsonb)',
    'public.lsr_events_list(jsonb)',
    'public.lsr_finance_reference(uuid)',
    'public.lsr_dashboard_owner(jsonb)',
    'public.lsr_dashboard_sales(jsonb)',
    'public.lsr_dashboard_client(jsonb)',
    'public.lsr_dashboard_operations(jsonb)',
    -- المُسنَدات تُقيَّم داخل سياسات RLS بدور المُنادي فتحتاج EXECUTE له.
    'public.lsr_can_view()','public.lsr_is_sales_manager()','public.lsr_is_owner_role()',
    'public.lsr_can_manage_scoring()','public.lsr_can_override_score()','public.lsr_can_route()',
    'public.lsr_can_reassign()','public.lsr_can_view_owner_dashboard()',
    'public.lsr_can_view_ops_queue()','public.lsr_is_client()','public.lsr_perm(text)']
  loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- النوى الداخلية: لا تُنادى من العميل إطلاقًا.
  foreach f in array array[
    'public.lsr_score_core(uuid)','public.lsr_route_core(uuid)','public.lsr_context(uuid)',
    'public.lsr_event_emit(text,text,uuid,jsonb,text)','public.lsr_log(text,text,uuid,text,jsonb)',
    'public.lsr_agent_workload(uuid)','public.lsr_setting_int(text,int)','public.lsr_setting_bool(text,boolean)',
    'public.lsr_rule_matches(text,text,jsonb,text,text,numeric,numeric,text[])',
    'public.lsr_event_keys()','public.lsr_txt(jsonb,text)','public.lsr_num(jsonb,text)',
    'public.lsr_bool(jsonb,text)','public.lsr_norm_city(text)']
  loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  foreach t in array array[
    'lsr_settings','lsr_factors','lsr_rulesets','lsr_rules','lsr_lead_profile',
    'lsr_territories','lsr_score_manual','lsr_agents','lsr_routing_rules',
    'lsr_assignments','lsr_review_queue','lsr_audit','lsr_event_log']
  loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §14) ★ الفحص الذاتيّ — ساكن بالكامل ★
--     محرّر SQL يعمل بدور postgres و auth.uid() = NULL. استدعاء دالّة محميّة
--     هنا يرفع «not authorized» ويُسقط الترحيلة — كلفنا ذلك دورتين. لذلك كلّ
--     تأكيد أدناه يقرأ **تعريف** الكائن من الكتالوج، أو ينادي مُسنَدًا يُرجع
--     false بلا جلسة (وهو ما يجب أن يفعله أصلًا). ولا مصيدة تُنجِح بلا سبب.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_n int; t text; f text; v_bad text;
begin
  -- (١) البنية موجودة كاملة.
  foreach t in array array[
    'lsr_settings','lsr_factors','lsr_rulesets','lsr_rules','lsr_lead_profile',
    'lsr_territories','lsr_score_manual','lsr_agents','lsr_routing_rules',
    'lsr_assignments','lsr_review_queue','lsr_audit','lsr_event_log']
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'LSR SELF-TEST: الجدول % غير موجود', t; end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'LSR SELF-TEST: RLS غير مفعّل على %', t; end if;
  end loop;

  -- (٢) ⛔ لا صفة شخصية حسّاسة في أيّ دالّة تقييم أو في كتالوج العوامل.
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('lsr_context','lsr_score_core','lsr_rule_matches')
  loop
    if v_def ~* '(gender|nationality|ethnic|religio|marital|date_of_birth|birth_date|age_group|age_band)' then
      raise exception 'LSR SELF-TEST: مدخل شخصيّ حسّاس ظهر في محرّك التقييم — هذا خرق للعقد لا خطأ تنسيق';
    end if;
  end loop;
  select count(*) into v_n from public.lsr_factors
   where key ~* '(gender|nationality|ethnic|religio|marital|birth|age_group)';
  if v_n <> 0 then
    raise exception 'LSR SELF-TEST: عامل شخصيّ حسّاس في الكتالوج (% صفًّا)', v_n; end if;

  -- (٣) لا بوّابة ممنوعة في أيّ دالّة للموديول.
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'lsr\_%'
  loop
    if v_def ilike '%can_manage_projects%' or v_def ilike '%is_kian_member%' then
      raise exception 'LSR SELF-TEST: بوّابة ممنوعة (can_manage_projects / is_kian_member) داخل الموديول';
    end if;
  end loop;

  -- (٤) ★ لا كتابة في منصّة المشاريع المجمَّدة ★ ولا إنشاء مشروع.
  --     ⚠️ بلا \m…\M هنا: الحدّ بعد سابقة مثل «fin_» أو «project_» لا يتحقّق،
  --     فيصير الفحص عاجزًا عن الإطلاق أصلًا — وهو أسوأ من غيابه.
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'lsr\_%'
  loop
    if v_def ~* '(insert\s+into\s+public\.projects|update\s+public\.projects|insert\s+into\s+public\.project_core|update\s+public\.project_core|insert\s+into\s+public\.deliverable)' then
      raise exception 'LSR SELF-TEST: كتابة في منصّة المشاريع المجمَّدة داخل الموديول';
    end if;
  end loop;

  -- (٥) محرّك التقييم مُفسَّر: يعيد المكوّنات والشرح والإجراء وعلم المراجعة.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_score_core(uuid)'));
  foreach f in array array['components','positive_factors','negative_factors',
                           'missing_information','recommended_next_action','review_required',
                           'ruleset_version','grade_thresholds','explain']
  loop
    if v_def not ilike '%' || f || '%' then
      raise exception 'LSR SELF-TEST: مخرَج التفسير «%» غائب عن lsr_score_core', f; end if;
  end loop;
  -- ولا نداء خارجيّ ولا نموذج.
  if v_def ~* '(net\.http|pg_net|https?://|openai|anthropic|\mmodel_endpoint\M)' then
    raise exception 'LSR SELF-TEST: نداء خارجيّ داخل محرّك التقييم — العقد يمنع الصندوق الأسود'; end if;

  -- (٦) التوزيع: كلّ منع مطلوب مذكور بالاسم في lsr_assign.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_assign(jsonb)'));
  foreach f in array array['cannot_take_others_lead','override_reason_required',
                           'reassign_not_permitted','routing_not_permitted','lsr_review_queue']
  loop
    if v_def not ilike '%' || f || '%' then
      raise exception 'LSR SELF-TEST: حارس التوزيع «%» غائب عن lsr_assign', f; end if;
  end loop;
  if v_def not ilike '%previous_owner%' or v_def not ilike '%routing_rule%'
     or v_def not ilike '%overridden_by%' then
    raise exception 'LSR SELF-TEST: حقول عقد الإسناد غير مكتوبة في lsr_assign'; end if;

  -- (٧) التوزيع حتميّ: لا عشوائية.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_route_core(uuid)'));
  if v_def ~* '\m(random|tablesample)\M' then
    raise exception 'LSR SELF-TEST: عشوائية في محرّك التوزيع — العقد يشترط الحتمية'; end if;

  -- (٨) الأحداث: مفتاح تكرار + إجبار dry_run + لا تفعيل قناة.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_event_emit(text,text,uuid,jsonb,text)'));
  if v_def not ilike '%idempotency_key%' then
    raise exception 'LSR SELF-TEST: lsr_event_emit بلا مفتاح تكرار'; end if;
  if v_def not ilike '%dry_run = true%' then
    raise exception 'LSR SELF-TEST: lsr_event_emit لا يُجبر dry_run على صفوف الطابور'; end if;
  if v_def ilike '%comms_channels%' then
    raise exception 'LSR SELF-TEST: الموديول يلمس comms_channels — تفعيل قناة ليس من صلاحيته'; end if;

  -- (٩) لوحة العميل: لا رمز داخليّ ولا تكلفة ولا هامش.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_dashboard_client(jsonb)'));
  foreach f in array array['internal_notes','internal_metadata','decision_reason',
                           'sq_quote_internal','base_cost','margin_pct','gross_profit','cost_rate']
  loop
    -- excluded_by_design يذكر الأسماء في مصفوفة نصّية؛ نمنع القراءة الفعلية:
    if v_def ~* ('\ml\.' || f || '\M') or v_def ~* ('\ms\.' || f || '\M')
       or v_def ~* ('\mr\.' || f || '\M') then
      raise exception 'LSR SELF-TEST: لوحة العميل تقرأ عمودًا داخليًّا (%)', f; end if;
  end loop;
  if v_def not ilike '%my_client_id%' then
    raise exception 'LSR SELF-TEST: لوحة العميل بلا حصر بهُويّة العميل'; end if;

  -- (١٠) طابور العمليات: بلا ماليّة حسّاسة.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_dashboard_operations(jsonb)'));
  foreach f in array array['price_net','vat_amount','overage_amount_net','price_gross']
  loop
    if v_def ~* ('\mr\.' || f || '\M') then
      raise exception 'LSR SELF-TEST: طابور العمليات يقرأ حقلًا ماليًّا (%)', f; end if;
  end loop;

  -- (١١) المالية مرجع للقراءة فقط: لا كتابة ولا Zoho ولا اعتراف بإيراد.
  v_def := pg_get_functiondef(to_regprocedure('public.lsr_finance_reference(uuid)'));
  if v_def ~* '(insert\s+into\s+public\.fin_|update\s+public\.fin_|delete\s+from\s+public\.fin_|zoho)' then
    raise exception 'LSR SELF-TEST: عقد المالية مكسور — كتابة أو نداء خارجيّ'; end if;
  if v_def not ilike '%payment_status_is_read_only%' then
    raise exception 'LSR SELF-TEST: عقد المالية لا يعلن أنّ حالة السداد للقراءة فقط'; end if;

  -- (١٢) المُسنَدات تُرجع boolean، ولا واحد منها يعيد NULL بلا جلسة.
  foreach f in array array['lsr_can_view','lsr_can_route','lsr_can_reassign',
                           'lsr_can_manage_scoring','lsr_can_override_score',
                           'lsr_can_view_owner_dashboard','lsr_can_view_ops_queue',
                           'lsr_is_sales_manager','lsr_is_owner_role','lsr_is_client']
  loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f and p.prorettype = 'boolean'::regtype) then
      raise exception 'LSR SELF-TEST: المُسنَد % ليس boolean', f; end if;
  end loop;
  -- بلا جلسة: false صريح لا NULL. (مُسنَد، لا دالّة محميّة — لا يرفع استثناء.)
  if public.lsr_can_view()   is not false then raise exception 'LSR SELF-TEST: lsr_can_view لا تُغلق بلا جلسة'; end if;
  if public.lsr_can_route()  is not false then raise exception 'LSR SELF-TEST: lsr_can_route لا تُغلق بلا جلسة'; end if;
  if public.lsr_can_reassign() is not false then raise exception 'LSR SELF-TEST: lsr_can_reassign لا تُغلق بلا جلسة'; end if;
  if public.lsr_can_view_owner_dashboard() is not false then
    raise exception 'LSR SELF-TEST: لوحة المالك لا تُغلق بلا جلسة'; end if;
  if public.lsr_perm('anything') is not false then
    raise exception 'LSR SELF-TEST: جسر الصلاحيات لا يُغلق بلا جلسة'; end if;

  -- (١٣) كلّ سطح محميّ يفحص صلاحيته فعلًا (لا دالّة مكشوفة بالخطأ).
  foreach f in array array['lsr_score','lsr_score_scan','lsr_score_manual_set','lsr_profile_set',
                           'lsr_rule_upsert','lsr_ruleset_clone','lsr_ruleset_publish',
                           'lsr_route_preview','lsr_assign','lsr_review_list','lsr_review_dismiss',
                           'lsr_agent_set','lsr_routing_rule_upsert','lsr_events_list',
                           'lsr_finance_reference','lsr_dashboard_owner','lsr_dashboard_sales',
                           'lsr_dashboard_operations','lsr_dashboard_client']
  loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f limit 1;
    if v_def is null then raise exception 'LSR SELF-TEST: الدالّة % غير موجودة', f; end if;
    if v_def not ilike '%not authorized%' and v_def not ilike '%lsr_can_%'
       and v_def not ilike '%lsr_is_sales_manager%' then
      raise exception 'LSR SELF-TEST: السطح % بلا فحص صلاحية', f; end if;
  end loop;

  -- (١٤) البذور: مجموعة منشورة واحدة وقواعد فعّالة.
  select count(*) into v_n from public.lsr_rulesets where status = 'published';
  if v_n <> 1 then raise exception 'LSR SELF-TEST: عدد المجموعات المنشورة % (المتوقَّع ١)', v_n; end if;
  select count(*) into v_n from public.lsr_rules ru
    join public.lsr_rulesets rs on rs.version = ru.ruleset_version
   where rs.status = 'published' and ru.is_active;
  if v_n < 20 then raise exception 'LSR SELF-TEST: قواعد التقييم الفعّالة قليلة على نحو مريب (%)', v_n; end if;
  select count(distinct factor_key) into v_n from public.lsr_rules ru
    join public.lsr_rulesets rs on rs.version = ru.ruleset_version where rs.status = 'published';
  if v_n < 16 then
    raise exception 'LSR SELF-TEST: العوامل المغطّاة % — العقد يطلب ثمانية عشر عاملًا', v_n; end if;
  select count(*) into v_n from public.lsr_factors where is_active;
  if v_n <> 18 then raise exception 'LSR SELF-TEST: عدد العوامل % (المتوقَّع ١٨)', v_n; end if;

  -- (١٥) كتالوج الأحداث الثلاثة عشر.
  if array_length(public.lsr_event_keys(), 1) <> 13 then
    raise exception 'LSR SELF-TEST: عدد أحداث الإشعارات ليس ١٣'; end if;
  if to_regclass('public.comms_event_catalog') is not null then
    select count(*) into v_n from public.comms_event_catalog where event_key like 'commercial.%';
    if v_n < 13 then
      raise exception 'LSR SELF-TEST: أحداث تجارية ناقصة في كتالوج المركز (%)', v_n; end if;
  end if;

  raise notice 'LSR SELF-TEST: كلّ الفحوص الساكنة مرّت.';
end $selftest$;

commit;

-- PostgREST يخزّن المخطّط في ذاكرته: بلا هذا السطر ستقرأ الواجهة PGRST202
-- كاذبًا وتعرض «الميزة بانتظار تفعيل قاعدة البيانات» بعد ترحيلة ناجحة —
-- وهو أسوأ أنواع الخطأ: رسالة صادقة في مكانها الخطأ.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التطبيق: شغّل docs/lead_scoring_routing_POSTCHECK.sql (للقراءة فقط).
-- الحدود المعروفة والقرارات المؤجَّلة: docs/COMMERCIAL_GROWTH_V1_LIMITATIONS.md
-- ════════════════════════════════════════════════════════════════════════════
