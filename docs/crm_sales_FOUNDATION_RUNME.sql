-- ════════════════════════════════════════════════════════════════════════════
-- crm_sales_FOUNDATION_RUNME.sql                 — RUN ONCE (ويُعاد تشغيله بأمان)
-- أساس إدارة علاقات العملاء والمبيعات · CRM & Sales Foundation — Phase 3
--
-- ─── ما هذه الحزمة ──────────────────────────────────────────────────────────
-- موديول مبيعات **مستقلّ**: عميل محتمل بمصدره · شركة وشخص تواصل · تأهيل · فرصة
-- بيعية · مراحل خطّ الأنابيب · أنشطة (اتصال · بريد · اجتماع · ملاحظة واتساب ·
-- متابعة) · الإجراء التالي وتاريخ استحقاقه · سبب الخسارة والمنافس · القيمة
-- المتوقّعة والاحتمال وخطّ الأنابيب المرجَّح · مالك البيع ورؤية الفريق · درجة
-- عميل **صريحة وقابلة للتحرير** · كشف التكرار · مرجع عرض سعر **للقراءة فقط** ·
-- جاهزية التحويل · أهداف المبيعات · أساس العمولات · تنبّؤ · تنبيهات الفرص
-- الراكدة · لوحة · استيراد/تصدير CSV · تدقيق.
--
-- ─── عقدان لا يُلطَّفان ────────────────────────────────────────────────────
--   ★ موافقة المالك: الهدف وقاعدة العمولة **لا يتغيّران** بمفتاح صلاحية. حامل
--     crm.manage_targets / crm.manage_commission يقترح، والمالك وحده يعتمد،
--     والاعتماد هو اللحظة الوحيدة التي يقع فيها التغيير. البوّابة
--     crm_can_approve_changes() لا تمرّ عبر crm_perm إطلاقًا — لو مرّت لأمكن
--     منحها ولانتهت «موافقة المالك» إلى منحة إداريّة.
--   ★ معاينة الاستيراد: crm_import_preview دالّة **STABLE**، فالمنع من كتابة
--     شيء يأتي من PostgreSQL نفسه لا من حسن النيّة. تعرض قرار كلّ صفّ
--     (إدراج/تكرار/تخطٍّ) والتكرار داخل الملفّ نفسه قبل أن يُكتب حرف واحد.
--
-- ─── الحدّ الفاصل مع منصّة المشاريع: عقد لا أتمتة ─────────────────────────
-- عند ربح الفرصة **يُسجَّل** أنّها جاهزة لإنشاء عميل/مشروع **يدويًّا**. هذه
-- الحزمة لا تُنشئ مشروعًا، ولا تكتب في public.projects ولا project_core ولا
-- deliverables ولا أيّ كائن project_* / large_project_*. المنصّة مجمَّدة.
-- التلامس الوحيد المسموح: crm_opportunities.handoff_project_id (مفتاح اختياريّ
-- on delete set null) وقراءة اسم المشروع للعرض. راجع
-- docs/CRM_PROJECT_HANDOFF_CONTRACT.md.
--
-- ─── ما أُعيد استعماله بدل تكراره (تركيب لا نظام موازٍ) ────────────────────
--   • public.is_staff() / is_owner() / is_admin()  — هويّة الموظّف القائمة.
--   • public.emp_has_permission(uuid,text)         — كتالوج الصلاحيات القائم.
--     تُضاف مفاتيح crm.* إلى **نفس** الكتالوج ولا يُبنى محرّك ثانٍ. الاستدعاء
--     مكتشَف ديناميكيًّا: بلا كتالوج يعمل المالك/الأدمن فقط (fail-closed).
--   • public.quote_requests — طلبات عروض السعر تبقى مصدر الحقيقة في طبقة
--     العميل. هنا **مرجع للقراءة فقط**: quote_request_id + قراءة المرجع والحالة.
--     لا هذه الحزمة ولا أيّ دالّة فيها تكتب في quote_requests.
--   • public.notify(...) — الإشعار القائم، معزول باستثناء (قيد type منجرف).
--   • public.hr_employee_profiles / public.profiles — تُقرأ لعرض أسماء الملّاك.
-- لم يُنشأ: محرّك صلاحيات ثانٍ، ولا جدول إشعارات، ولا نسخة من طلبات الأسعار،
-- ولا أيّ جدول مشاريع.
--
-- ─── الصلاحيات (مُسنَدات خاصّة بالموديول — لا can_manage_projects) ─────────
--   المالك/الأدمن            → كلّ شيء.
--   مدير المبيعات            → crm.manage، ويرى فريقه **فقط إن وُجد** مفتاح
--                              crm.view_team ومُنح له وكان مديرًا لفريق فعليّ.
--   موظّف المبيعات           → فرصه هو وعملاؤه هو فقط.
--   العمولات والنِّسَب        → لا يرى الموظّف عمولة غيره ولا نسبته أبدًا؛
--                              crm.view_commission مفتاح حسّاس منفصل عن crm.manage.
--   الأهداف                  → لا يحرّر الموظّف هدفه هو، ولا مدير يحرّر هدف نفسه
--                              (المالك وحده يملك ذلك).
--   العميل / الزائر          → لا شيء إطلاقًا. لا قراءة ولا كتابة ولا وجود.
--
-- ─── قواعد ملزمة ──────────────────────────────────────────────────────────
--   • كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا (fail-closed).
--   • لا سياسة كتابة مباشرة على أيّ جدول: كلّ كتابة عبر SECURITY DEFINER RPC.
--   • لا صلاحية anon على أيّ دالّة أو جدول.
--   • كلّ كتابة حسّاسة مُدقَّقة في crm_audit.
--   • الدرجة والجاهزية والتنبّؤ **مشتقّة**: لا عمود محفوظ ينحرف.
--   • Additive · Idempotent · Transaction · بلا DROP لبيانات.
--
-- ─── ملاحظة تشغيلية: الـSELF-TEST ثابت ─────────────────────────────────────
-- محرّر SQL في Supabase يعمل بدور postgres وauth.uid() = NULL. أيّ استدعاء حيّ
-- لدالّة محميّة هنا يرفع "not authorized" ويُسقط الترحيلة كلّها. لذلك الفحص
-- بـpg_get_functiondef + ilike (المُفكِّك يرفع حالة COALESCE)، والمُسنَدات وحدها
-- تُستدعى حيًّا لأنّها لا ترفع استثناءً بل تعيد false.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) PREFLIGHT صلب — الاعتمادات التي لا تُحاكى ─────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('public.profiles') is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if miss <> '' then
    raise exception 'CRM PREFLIGHT: اعتمادات ناقصة —%. شغّل phase0_migration.sql وstaff_roles_task_assignment_RUNME.sql أوّلًا.', miss;
  end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then
    raise notice 'CRM: محرّك الصلاحيات غير مطبَّق — سيعمل المالك/الأدمن فقط حتى تُشغّل permission_catalog_RUNME.sql.';
  end if;
  if to_regclass('public.quote_requests') is null then
    raise notice 'CRM: جدول quote_requests غير موجود — مرجع عرض السعر سيبقى معطّلًا (اختياريّ أصلًا).';
  end if;
  if to_regclass('public.projects') is null then
    raise notice 'CRM: جدول projects غير موجود — تسجيل التسليم اليدويّ سيبقى بلا ربط (اختياريّ أصلًا).';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--     ملاحظة تصميم مقصودة: crm.manage **لا** يمنح رؤية العمولات. رؤية عمولة
--     غيرك مفتاح حسّاس مستقلّ، لأنّ «مدير المبيعات» ليس بالضرورة مخوّلًا بالرواتب.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'CRM §1: جدول permissions غير موجود — تخطّي بذر المفاتيح.';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'crm', v.sens, v.ord, v.ar, v.en
  from (values
    (1310,'crm.view',              'normal',   'عرض المبيعات',                 'View CRM'),
    (1320,'crm.manage',            'sensitive','إدارة المبيعات',               'Manage CRM'),
    (1330,'crm.view_team',         'sensitive','رؤية فريق المبيعات',           'View sales team'),
    (1340,'crm.manage_pipeline',   'sensitive','إدارة خطّ الأنابيب والمراحل',   'Manage pipeline & stages'),
    (1350,'crm.import',            'sensitive','استيراد بيانات المبيعات',      'Import CRM data'),
    (1355,'crm.export',            'normal',   'تصدير بيانات المبيعات',        'Export CRM data'),
    (1360,'crm.view_commission',   'sensitive','رؤية عمولات الآخرين',          'View others commission'),
    (1370,'crm.manage_commission', 'sensitive','إدارة خطط العمولات',           'Manage commission plans'),
    (1380,'crm.manage_targets',    'sensitive','إدارة أهداف المبيعات',         'Manage sales targets'),
    (1390,'crm.manage_scoring',    'sensitive','إدارة قواعد درجة العميل',      'Manage lead scoring rules'),
    (1395,'crm.handoff',           'normal',   'تسجيل تسليم الفرصة المربوحة',  'Record won-deal handoff')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) مُسنَدات الجلسة — خاصّة بالموديول. لا واحد منها يعيد NULL.
--     ⚠️ لا تُبنى على can_manage_projects: هذا موديول مبيعات لا موديول مشاريع.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (fail-closed) لا استثناء.
-- المصيدة هنا تُفشِل ولا تُنجِح — وهذا هو الفرق بينها وبين المصيدة الكاذبة.
create or replace function public.crm_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then
  return false;                                        -- fail-closed، لا fail-open
end $$;

-- «إن كانت تلك الصلاحية موجودة» في نصّ المتطلّب تعني حرفيًّا: المفتاح مُعرَّف
-- ومفعَّل في الكتالوج. غيابه لا يُترجَم إلى منح ضمنيّ.
create or replace function public.crm_perm_key_exists(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_key is null or to_regclass('public.permissions') is null then return false; end if;
  execute 'select exists (select 1 from public.permissions where key = $1 and coalesce(enabled, true))'
    into v using p_key;
  return coalesce(v, false);
exception when others then
  return false;
end $$;

-- المالك/الأدمن — الطبقة التي لا تُشترى بمفتاح.
create or replace function public.crm_is_owner_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null)
    and (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)), false);
$$;

-- مدير المبيعات: المالك/الأدمن أو حامل المفتاح الصريح.
create or replace function public.crm_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (coalesce(public.crm_is_owner_role(), false)
      or (coalesce(public.is_staff(), false) and coalesce(public.crm_perm('crm.manage'), false))),
  false);
$$;

-- من يفتح الموديول أصلًا: موظّف فقط. العميل والزائر خارج البوّابة نهائيًّا.
create or replace function public.crm_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (coalesce(public.crm_can_manage(), false)
      or (coalesce(public.is_staff(), false) and coalesce(public.crm_perm('crm.view'), false))),
  false);
$$;

-- تصريح صريح بأنّ صاحب الجلسة عميل/زائر — يُستعمل في الرسائل والاختبارات.
create or replace function public.crm_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- العمولات: الموظّف يرى **عمولته هو** ولا يرى عمولة غيره ولا نسبته إلّا بمفتاح
-- حسّاس مستقلّ. crm.manage لا يكفي — وهذا مقصود ومُختبَر.
create or replace function public.crm_can_view_commission(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when not coalesce(public.is_staff(), false) then false
      when p_user is not null and p_user = auth.uid() then true
      when coalesce(public.crm_is_owner_role(), false) then true
      else coalesce(public.crm_perm('crm.view_commission'), false)
    end, false);
$$;

create or replace function public.crm_can_manage_commission() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.crm_is_owner_role(), false)
      or coalesce(public.crm_perm('crm.manage_commission'), false)),
  false);
$$;

create or replace function public.crm_can_manage_targets() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.crm_is_owner_role(), false)
      or coalesce(public.crm_perm('crm.manage_targets'), false)),
  false);
$$;

-- ★ اعتماد التغييرات الحسّاسة (هدف · قاعدة عمولة): **المالك وحده**. عمدًا بلا
--   مفتاح صلاحية — لو كان مفتاحًا لأمكن منحه، ولانتهت «موافقة المالك» إلى منحة
--   إداريّة. من يحمل crm.manage_targets يقترح فقط؛ الاعتماد لا يُشترى بمفتاح.
create or replace function public.crm_can_approve_changes() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and coalesce(public.crm_is_owner_role(), false),
  false);
$$;

create or replace function public.crm_can_manage_pipeline() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.crm_is_owner_role(), false)
      or coalesce(public.crm_perm('crm.manage_pipeline'), false)),
  false);
$$;

create or replace function public.crm_can_manage_scoring() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.crm_is_owner_role(), false)
      or coalesce(public.crm_perm('crm.manage_scoring'), false)),
  false);
$$;

create or replace function public.crm_can_import() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.crm_is_owner_role(), false)
      or coalesce(public.crm_perm('crm.import'), false)),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — 20 جدولًا، كلّها crm_*.
--     ملاحظة: المُسنَدات التي تقرأ جداول تأتي بعدها (§4) لأنّ PostgreSQL يتحقّق
--     من أجسام دوالّ SQL عند الإنشاء؛ تعريفها قبل الجداول يُسقط الترحيلة.
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 إعدادات الموديول (عتبة الركود · العملة · طريقة التنبّؤ)
create table if not exists public.crm_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  label_ar    text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
comment on table public.crm_settings is 'إعدادات موديول المبيعات. مفاتيح صريحة لا أرقام سحرية داخل الدوالّ.';

insert into public.crm_settings (key, value, label_ar) values
  ('stale_days',            '21'::jsonb,     'أيام بلا نشاط قبل اعتبار الفرصة راكدة'),
  ('stale_stage_days',      '30'::jsonb,     'أيام بلا تغيير مرحلة قبل التنبيه'),
  ('default_currency',      '"SAR"'::jsonb,  'العملة الافتراضية'),
  ('duplicate_window_days', '365'::jsonb,    'مدى البحث عن التكرار بالأيام'),
  ('score_hot_threshold',   '70'::jsonb,     'درجة العميل الساخن'),
  ('score_warm_threshold',  '40'::jsonb,     'درجة العميل الدافئ')
on conflict (key) do nothing;

-- 3.2 فرق المبيعات — أساس «رؤية الفريق». مدير الفريق مُعرَّف صراحةً.
create table if not exists public.crm_teams (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(btrim(name)) between 2 and 120),
  manager_user_id  uuid references auth.users(id),
  notes            text,
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false
);
create index if not exists ix_crm_team_mgr on public.crm_teams(manager_user_id) where is_deleted = false;

create table if not exists public.crm_team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.crm_teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role_label  text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create unique index if not exists uq_crm_team_member on public.crm_team_members(team_id, user_id)
  where is_deleted = false;
create index if not exists ix_crm_team_member_user on public.crm_team_members(user_id) where is_deleted = false;

-- 3.3 الشركات وأشخاص التواصل
create table if not exists public.crm_companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 2 and 250),
  name_norm      text,
  industry       text,
  size_band      text check (size_band is null or size_band in ('micro','small','medium','large','enterprise')),
  website        text, city text, country text,
  tax_no         text, notes text,
  owner_user_id  uuid references auth.users(id),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_crm_company_norm on public.crm_companies(name_norm) where is_deleted = false;
create index if not exists ix_crm_company_owner on public.crm_companies(owner_user_id) where is_deleted = false;

create table if not exists public.crm_contacts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.crm_companies(id) on delete set null,
  full_name      text not null check (length(btrim(full_name)) between 2 and 200),
  name_norm      text,
  job_title      text,
  email          text, email_norm text,
  phone          text, phone_norm text,
  whatsapp       text,
  preferred_channel text not null default 'unknown'
                 check (preferred_channel in ('unknown','phone','email','whatsapp','meeting')),
  is_primary     boolean not null default false,
  notes          text,
  owner_user_id  uuid references auth.users(id),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_crm_contact_email on public.crm_contacts(email_norm) where is_deleted = false;
create index if not exists ix_crm_contact_phone on public.crm_contacts(phone_norm) where is_deleted = false;
create index if not exists ix_crm_contact_company on public.crm_contacts(company_id) where is_deleted = false;

-- 3.4 المنافسون
create table if not exists public.crm_competitors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 150),
  name_norm   text,
  notes       text,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create unique index if not exists uq_crm_competitor_norm on public.crm_competitors(name_norm) where is_deleted = false;

-- 3.5 قواعد درجة العميل — **صريحة وقابلة للتحرير**. لا معادلة مخفيّة في الكود.
--     الحقل والمشغِّل من قائمة بيضاء ثابتة؛ لا SQL ديناميكيّ من مدخلات المستخدم.
create table if not exists public.crm_lead_score_rules (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]{2,60}$'),
  label_ar    text not null default '', label_en text not null default '',
  field       text not null check (field in (
                'source','budget_band','authority','need_level','timeline','company_size',
                'has_email','has_phone','has_company','activity_count','estimated_value')),
  operator    text not null check (operator in ('equals','in','gte','not_empty','is_true')),
  value_text  text,
  value_num   numeric,
  value_list  text[],
  points      int not null default 0 check (points between -50 and 50),
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.crm_lead_score_rules is
  'قواعد درجة العميل. الدرجة مشتقّة من هذه الصفوف ومن التعديل اليدويّ المعلَن — لا صندوق أسود.';

insert into public.crm_lead_score_rules (key, label_ar, label_en, field, operator, value_list, value_text, value_num, points, sort_order) values
  ('src_referral',   'مصدر: ترشيح أو عميل حاليّ', 'Source: referral/existing client', 'source', 'in',
     array['referral','existing_client','partner'], null, null, 15, 10),
  ('src_inbound',    'مصدر: وارد (موقع/واتساب/سوشال)', 'Source: inbound', 'source', 'in',
     array['website','whatsapp','instagram','linkedin','x','tiktok','email','phone'], null, null, 10, 20),
  ('src_cold',       'مصدر: تواصل بارد', 'Source: cold outreach', 'source', 'equals', null, 'cold_outreach', null, -5, 30),
  ('budget_large',   'ميزانية 50 ألف فأكثر', 'Budget 50k+', 'budget_band', 'in',
     array['50k_200k','over_200k'], null, null, 20, 40),
  ('budget_mid',     'ميزانية 10–50 ألف', 'Budget 10k-50k', 'budget_band', 'equals', null, '10k_50k', null, 12, 50),
  ('authority_dm',   'التواصل مع صاحب القرار', 'Decision maker', 'authority', 'equals', null, 'decision_maker', null, 15, 60),
  ('need_high',      'حاجة واضحة وعالية', 'High need', 'need_level', 'equals', null, 'high', null, 15, 70),
  ('timeline_soon',  'إطار زمنيّ قريب', 'Near-term timeline', 'timeline', 'in',
     array['immediate','this_quarter'], null, null, 12, 80),
  ('has_email',      'بريد إلكترونيّ متاح', 'Has email', 'has_email', 'is_true', null, null, null, 5, 90),
  ('has_phone',      'رقم هاتف متاح', 'Has phone', 'has_phone', 'is_true', null, null, null, 5, 100),
  ('has_company',    'اسم شركة معروف', 'Has company', 'has_company', 'is_true', null, null, null, 3, 110),
  ('engaged',        'ثلاثة أنشطة تواصل فأكثر', 'Engaged (3+ activities)', 'activity_count', 'gte', null, null, 3, 10, 120)
on conflict (key) do nothing;

-- 3.6 العملاء المحتملون
create sequence if not exists public.crm_lead_code_seq;
create table if not exists public.crm_leads (
  id                 uuid primary key default gen_random_uuid(),
  lead_code          text not null unique,
  company_id         uuid references public.crm_companies(id) on delete set null,
  contact_id         uuid references public.crm_contacts(id) on delete set null,
  company_name       text,
  contact_name       text not null check (length(btrim(contact_name)) between 2 and 200),
  email              text, email_norm text,
  phone              text, phone_norm text,
  whatsapp           text,
  company_name_norm  text,
  city               text, country text, industry text,
  company_size       text check (company_size is null or company_size in ('micro','small','medium','large','enterprise')),
  source             text not null default 'other' check (source in (
                       'website','referral','whatsapp','instagram','x','linkedin','tiktok','email','phone',
                       'walk_in','event','campaign','partner','existing_client','cold_outreach','import','other')),
  source_detail      text, campaign text,
  status             text not null default 'new' check (status in (
                       'new','contacted','working','qualified','unqualified','converted','dropped')),
  budget_band        text not null default 'unknown' check (budget_band in (
                       'unknown','under_10k','10k_50k','50k_200k','over_200k')),
  authority          text not null default 'unknown' check (authority in ('unknown','gatekeeper','influencer','decision_maker')),
  need_level         text not null default 'unknown' check (need_level in ('unknown','low','medium','high')),
  timeline           text not null default 'unknown' check (timeline in (
                       'unknown','immediate','this_quarter','this_year','no_timeline')),
  qualification_note text,
  estimated_value    numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  currency           text not null default 'SAR',
  notes              text,
  -- الدرجة **لا تُخزَّن**: يُخزَّن فقط ما هو معلَن ومحرَّر بيد إنسان.
  score_manual_adjust int not null default 0 check (score_manual_adjust between -50 and 50),
  score_adjust_reason text,
  score_override      int check (score_override is null or score_override between 0 and 100),
  score_override_reason text,
  owner_user_id      uuid references auth.users(id),
  assigned_at        timestamptz,
  first_contact_at   timestamptz,
  last_activity_at   timestamptz,
  next_action        text,
  next_action_due    date,
  unqualified_reason text,
  dropped_reason     text,
  duplicate_of_id    uuid references public.crm_leads(id) on delete set null,
  converted_opportunity_id uuid,
  converted_at       timestamptz,
  import_batch_id    uuid,
  -- مرجع خارجيّ اختياريّ (استيراد/نموذج): يجعل إعادة الإنشاء تُعيد نفس الصفّ
  -- بدل أن تُنتج توأمًا. الفريدية جزئية كي لا تمنع NULL المتكرّر.
  external_ref       text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  is_deleted         boolean not null default false,
  deleted_at         timestamptz, deleted_by uuid references auth.users(id), delete_reason text
);
create index if not exists ix_crm_lead_owner  on public.crm_leads(owner_user_id) where is_deleted = false;
create index if not exists ix_crm_lead_status on public.crm_leads(status) where is_deleted = false;
create index if not exists ix_crm_lead_email  on public.crm_leads(email_norm) where is_deleted = false;
create index if not exists ix_crm_lead_phone  on public.crm_leads(phone_norm) where is_deleted = false;
create index if not exists ix_crm_lead_cnorm  on public.crm_leads(company_name_norm) where is_deleted = false;
create index if not exists ix_crm_lead_due    on public.crm_leads(next_action_due) where is_deleted = false;
create unique index if not exists uq_crm_lead_external on public.crm_leads(external_ref)
  where external_ref is not null and is_deleted = false;

-- 3.7 خطوط الأنابيب والمراحل
create table if not exists public.crm_pipelines (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_ar     text not null default '', name_en text not null default '',
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
insert into public.crm_pipelines (key, name_ar, name_en, is_default, sort_order)
values ('default', 'خطّ المبيعات الرئيسيّ', 'Main sales pipeline', true, 10)
on conflict (key) do nothing;

create table if not exists public.crm_stages (
  id            uuid primary key default gen_random_uuid(),
  pipeline_id   uuid not null references public.crm_pipelines(id) on delete cascade,
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name_ar       text not null default '', name_en text not null default '',
  sort_order    int not null default 0,
  default_probability int not null default 0 check (default_probability between 0 and 100),
  is_won        boolean not null default false,
  is_lost       boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint crm_stage_not_both check (not (is_won and is_lost))
);
create unique index if not exists uq_crm_stage_key on public.crm_stages(pipeline_id, key);
create index if not exists ix_crm_stage_pipe on public.crm_stages(pipeline_id, sort_order);

insert into public.crm_stages (pipeline_id, key, name_ar, name_en, sort_order, default_probability, is_won, is_lost)
select p.id, v.key, v.ar, v.en, v.ord, v.prob, v.won, v.lost
from public.crm_pipelines p
cross join (values
  ('qualification',  'تأهيل',              'Qualification',  10, 10, false, false),
  ('needs_analysis', 'تحليل الاحتياج',      'Needs analysis', 20, 25, false, false),
  ('proposal',       'عرض سعر',            'Proposal',       30, 50, false, false),
  ('negotiation',    'تفاوض',              'Negotiation',    40, 70, false, false),
  ('verbal_commit',  'موافقة مبدئية',       'Verbal commit',  50, 85, false, false),
  ('won',            'مربوحة',             'Won',            60, 100, true,  false),
  ('lost',           'مخسورة',             'Lost',           70,  0,  false, true)
) as v(key, ar, en, ord, prob, won, lost)
where p.key = 'default'
  and not exists (select 1 from public.crm_stages s where s.pipeline_id = p.id and s.key = v.key);

-- 3.8 الفرص البيعية
create sequence if not exists public.crm_opportunity_code_seq;
create table if not exists public.crm_opportunities (
  id               uuid primary key default gen_random_uuid(),
  opp_code         text not null unique,
  title            text not null check (length(btrim(title)) between 2 and 300),
  lead_id          uuid references public.crm_leads(id) on delete set null,
  company_id       uuid references public.crm_companies(id) on delete set null,
  contact_id       uuid references public.crm_contacts(id) on delete set null,
  pipeline_id      uuid not null references public.crm_pipelines(id),
  stage_id         uuid not null references public.crm_stages(id),
  status           text not null default 'open' check (status in ('open','won','lost','abandoned')),
  source           text,
  estimated_value  numeric(14,2) not null default 0 check (estimated_value >= 0),
  currency         text not null default 'SAR',
  -- الاحتمال صريح: يبدأ من المرحلة ويبقى قابلًا للتحرير، ويُسجَّل أنّه عُدِّل يدويًّا.
  probability      int not null default 0 check (probability between 0 and 100),
  probability_is_manual boolean not null default false,
  expected_close_date date,
  owner_user_id    uuid references auth.users(id),
  next_action      text,
  next_action_due  date,
  last_activity_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  lost_reason      text check (lost_reason is null or lost_reason in (
                     'price','timing','scope','competitor','no_budget','no_response','internal','other')),
  lost_reason_note text,
  competitor_id    uuid references public.crm_competitors(id) on delete set null,
  won_at           timestamptz, lost_at timestamptz,
  -- ★ مرجع عرض السعر — **للقراءة فقط**. لا كتابة في quote_requests أبدًا.
  quote_request_id uuid,
  -- ★ عقد التسليم — تسجيل لا أتمتة. لا إنشاء مشروع ولا كتابة في المنصّة.
  handoff_state    text not null default 'not_ready' check (handoff_state in (
                     'not_ready','ready_for_manual_creation','manually_created','not_applicable')),
  handoff_ready_at timestamptz,
  handoff_note     text,
  handoff_project_id uuid,
  handoff_recorded_by uuid references auth.users(id),
  handoff_recorded_at timestamptz,
  notes            text,
  version          int not null default 1,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false,
  deleted_at       timestamptz, deleted_by uuid references auth.users(id), delete_reason text
);
create index if not exists ix_crm_opp_owner  on public.crm_opportunities(owner_user_id) where is_deleted = false;
create index if not exists ix_crm_opp_stage  on public.crm_opportunities(stage_id) where is_deleted = false;
create index if not exists ix_crm_opp_status on public.crm_opportunities(status) where is_deleted = false;
create index if not exists ix_crm_opp_close  on public.crm_opportunities(expected_close_date) where is_deleted = false;
create index if not exists ix_crm_opp_lead   on public.crm_opportunities(lead_id) where is_deleted = false;

-- المفتاح الخارجيّ لعرض السعر: يُضاف مرّة واحدة وفقط إن كان الجدول موجودًا.
do $fk$
begin
  if to_regclass('public.quote_requests') is not null
     and not exists (select 1 from pg_constraint where conname = 'crm_opp_quote_fk') then
    alter table public.crm_opportunities
      add constraint crm_opp_quote_fk foreign key (quote_request_id)
      references public.quote_requests(id) on delete set null;
  end if;
end $fk$;

-- المفتاح الخارجيّ للمشروع: **اختياريّ بحت**، on delete set null، ولا يمنح أيّ
-- حقّ كتابة على المنصّة. وجوده يعني «سُجِّل أنّ مشروعًا أُنشئ يدويًّا» لا أكثر.
do $fk$
begin
  if to_regclass('public.projects') is not null
     and not exists (select 1 from pg_constraint where conname = 'crm_opp_project_fk') then
    alter table public.crm_opportunities
      add constraint crm_opp_project_fk foreign key (handoff_project_id)
      references public.projects(id) on delete set null;
  end if;
end $fk$;

-- 3.9 تاريخ المراحل — أساس التنبّؤ وكشف الركود والتدقيق.
create table if not exists public.crm_stage_history (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage_id  uuid references public.crm_stages(id),
  to_stage_id    uuid not null references public.crm_stages(id),
  from_status    text, to_status text,
  probability    int,
  note           text,
  changed_by     uuid references auth.users(id),
  changed_at     timestamptz not null default now()
);
create index if not exists ix_crm_hist_opp on public.crm_stage_history(opportunity_id, changed_at desc);

-- 3.10 الأنشطة
create table if not exists public.crm_activities (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('call','email','meeting','whatsapp_note','follow_up','note','demo','site_visit')),
  direction      text not null default 'outbound' check (direction in ('inbound','outbound','internal')),
  subject        text not null check (length(btrim(subject)) between 2 and 250),
  body           text,
  outcome        text check (outcome is null or outcome in (
                   'connected','no_answer','rescheduled','interested','not_interested','info_sent','completed','other')),
  occurred_at    timestamptz not null default now(),
  duration_min   int check (duration_min is null or duration_min between 0 and 1440),
  lead_id        uuid references public.crm_leads(id) on delete cascade,
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  contact_id     uuid references public.crm_contacts(id) on delete set null,
  follow_up_due  date,
  follow_up_note text,
  owner_user_id  uuid references auth.users(id),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  -- نشاط بلا أب لا معنى له، ويُصبح ثقبًا في الرؤية: يجب أن يتبع عميلًا أو فرصة.
  constraint crm_activity_parent check (lead_id is not null or opportunity_id is not null)
);
create index if not exists ix_crm_act_lead on public.crm_activities(lead_id, occurred_at desc) where is_deleted = false;
create index if not exists ix_crm_act_opp  on public.crm_activities(opportunity_id, occurred_at desc) where is_deleted = false;
create index if not exists ix_crm_act_due  on public.crm_activities(follow_up_due) where is_deleted = false;

-- 3.11 أهداف المبيعات
create table if not exists public.crm_targets (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users(id) on delete cascade,
  team_id        uuid references public.crm_teams(id) on delete set null,
  period_type    text not null default 'month' check (period_type in ('month','quarter','year')),
  period_start   date not null,
  period_end     date not null,
  target_value   numeric(14,2) not null default 0 check (target_value >= 0),
  target_count   int not null default 0 check (target_count >= 0),
  currency       text not null default 'SAR',
  notes          text,
  set_by         uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  constraint crm_target_period check (period_end >= period_start)
);
create unique index if not exists uq_crm_target_period
  on public.crm_targets(owner_user_id, period_type, period_start) where is_deleted = false;

-- 3.12 أساس العمولات — خطط · إسناد · سجلّات محسوبة (بلا صرف ولا رواتب).
create table if not exists public.crm_commission_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 2 and 120),
  -- ★ أساس واحد فقط، وهو المُنفَّذ فعلًا ★
  --   كان القيد يقبل 'collected_value' و'gross_margin' بينما
  --   crm_commission_recalc_core يحسب دائمًا من estimated_value. النتيجة كانت
  --   سجلّ عمولة **موسومًا** بأنّه على الهامش وقيمته في الحقيقة قيمة الفرصة:
  --   المالك يعتمد رقمًا يظنّه هامشًا وليس كذلك.
  --   ولا يجوز «إكمال» المفردتين هنا: gross_margin يستلزم قراءة التكلفة داخل
  --   موديول المبيعات، وهو بعينه ثقب استنتاج الربح الذي يمنعه جدار المالية،
  --   وcollected_value يستلزم قراءة التحصيل. تُحذف المفردة إذًا ولا تُنفَّذ.
  basis        text not null default 'won_value' check (basis = 'won_value'),
  rate_pct     numeric(6,3) not null default 0 check (rate_pct >= 0 and rate_pct <= 100),
  threshold_value numeric(14,2) not null default 0 check (threshold_value >= 0),
  cap_value    numeric(14,2) check (cap_value is null or cap_value >= 0),
  currency     text not null default 'SAR',
  notes        text,
  is_active    boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);

create table if not exists public.crm_commission_assignments (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.crm_commission_plans(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  effective_from date not null default current_date,
  effective_to   date,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  constraint crm_assign_period check (effective_to is null or effective_to >= effective_from)
);
create index if not exists ix_crm_assign_user on public.crm_commission_assignments(user_id) where is_deleted = false;

create table if not exists public.crm_commission_records (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  plan_id        uuid references public.crm_commission_plans(id) on delete set null,
  basis          text not null default 'won_value',
  basis_value    numeric(14,2) not null default 0,
  rate_pct       numeric(6,3) not null default 0,
  amount         numeric(14,2) not null default 0,
  currency       text not null default 'SAR',
  status         text not null default 'draft' check (status in ('draft','approved','void')),
  computed_at    timestamptz not null default now(),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  note           text,
  is_deleted     boolean not null default false
);
create unique index if not exists uq_crm_commission_row
  on public.crm_commission_records(opportunity_id, user_id) where is_deleted = false;
create index if not exists ix_crm_commission_user on public.crm_commission_records(user_id) where is_deleted = false;
comment on table public.crm_commission_records is
  'أساس عمولات محسوب فقط. لا صرف ولا رواتب ولا تكامل ماليّ — وذلك مقصود في هذه المرحلة.';

-- ★ مداواة انحراف القيد ★ — `create table if not exists` لا يغيّر جدولًا قائمًا،
--   فلو طُبّقت نسخة سابقة من هذه الحزمة لبقي القيد الواسع القديم ولبقيت المفردة
--   غير المنفَّذة مقبولة. هذه الكتلة تُطبّع الصفوف أوّلًا ثمّ تُضيّق القيد،
--   وهي عديمة الأثر عند إعادة التشغيل.
do $basis$
declare c text;
begin
  if to_regclass('public.crm_commission_plans') is null then return; end if;

  -- (١) تطبيع الصفوف: كلّ خطّة موسومة بأساس غير منفَّذ كانت تُحسب فعليًّا على
  --     قيمة الفرصة، فالتصحيح إعلانُ ذلك لا تغييرُ أيّ رقم عمولة.
  update public.crm_commission_plans
     set basis = 'won_value', updated_at = now()
   where basis is distinct from 'won_value';
  update public.crm_commission_records
     set basis = 'won_value'
   where basis is distinct from 'won_value';

  -- (٢) إسقاط أيّ قيد قديم على basis مهما كان اسمه المولَّد، ثمّ إضافة الضيّق.
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.crm_commission_plans'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%basis%'
  loop
    execute format('alter table public.crm_commission_plans drop constraint %I', c);
  end loop;

  alter table public.crm_commission_plans
    add constraint crm_commission_plans_basis_check check (basis = 'won_value');
end $basis$;

-- 3.13 دفعات الاستيراد — مفتاح تكرار فريد يجعل إعادة الرفع بلا ازدواج.
create table if not exists public.crm_import_batches (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  entity          text not null default 'lead' check (entity in ('lead')),
  source_label    text,
  row_count       int not null default 0,
  inserted_count  int not null default 0,
  duplicate_count int not null default 0,
  error_count     int not null default 0,
  result          jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

-- 3.14 التدقيق
create table if not exists public.crm_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ix_crm_audit_at on public.crm_audit(created_at desc);
create index if not exists ix_crm_audit_entity on public.crm_audit(entity_type, entity_id);

-- 3.15 ★ طلبات موافقة المالك — الهدف والعمولة لا يتغيّران بمفتاح صلاحية.
--      حامل crm.manage_targets يقترح، والمالك وحده يعتمد. الصفّ المعلَّق **ليس**
--      تغييرًا: لا يُقرأ في أيّ حساب ولا تنبّؤ ولا لوحة — هو نيّة موثَّقة فقط.
create table if not exists public.crm_approval_requests (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('target','target_delete','commission_plan','commission_assign')),
  entity_id         uuid,                    -- الكائن المعدَّل، وNULL عند الإنشاء
  subject_user_id   uuid references auth.users(id) on delete cascade, -- صاحب الهدف/العمولة
  payload           jsonb not null default '{}'::jsonb,
  reason            text,
  status            text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  requested_by      uuid not null references auth.users(id) on delete cascade,
  requested_at      timestamptz not null default now(),
  decided_by        uuid references auth.users(id),
  decided_at        timestamptz,
  decision_note     text,
  applied_entity_id uuid,
  apply_error       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ix_crm_appr_status on public.crm_approval_requests(status, requested_at desc);
create index if not exists ix_crm_appr_by     on public.crm_approval_requests(requested_by, requested_at desc);
comment on table public.crm_approval_requests is
  'موافقة المالك على الأهداف وقواعد العمولات. الصفّ المعلَّق لا يؤثّر في أيّ رقم — التغيير يقع لحظة الاعتماد فقط.';

-- ════════════════════════════════════════════════════════════════════════════
-- §4) مُسنَدات الصفّ. لا واحد منها يعيد NULL.
--     ملاحظة: SECURITY DEFINER يملكها منفّذ الترحيلة، فتقرأ الجداول متجاوزةً
--     RLS ولا تُحدث ارتدادًا داخل سياسات نفس الجداول.
-- ════════════════════════════════════════════════════════════════════════════

-- رؤية الفريق: **ثلاثة شروط مجتمعة** — المفتاح موجود في الكتالوج، ومُنح للجلسة،
-- والجلسة مديرة فريق فعليّ. سقوط أيّ شرط يعني «نفسي فقط»، لا «الجميع».
create or replace function public.crm_can_view_team() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.crm_perm_key_exists('crm.view_team'), false)
    and coalesce(public.crm_perm('crm.view_team'), false)
    and exists (select 1 from public.crm_teams t
                 where t.manager_user_id = auth.uid() and t.is_deleted = false),
  false);
$$;

-- المُسنَد المركزيّ للرؤية حسب المالك: نفسي · فريقي (بشرطه) · الكلّ (للإدارة).
create or replace function public.crm_can_see_owner(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when auth.uid() is null then false
      when not coalesce(public.crm_can_view(), false) then false
      when coalesce(public.crm_can_manage(), false) then true
      when p_owner is null then false                       -- صفّ بلا مالك = للإدارة
      when p_owner = auth.uid() then true
      else coalesce(public.crm_can_view_team(), false)
        and exists (select 1 from public.crm_team_members m
                     join public.crm_teams t on t.id = m.team_id
                    where m.user_id = p_owner and m.is_deleted = false
                      and t.manager_user_id = auth.uid() and t.is_deleted = false)
    end, false);
$$;

create or replace function public.crm_can_read_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(public.crm_can_see_owner(l.owner_user_id), false)
      from public.crm_leads l where l.id = p_lead and l.is_deleted = false
  ), false);
$$;

-- التحرير أضيق من القراءة: مدير المبيعات، أو المالك المباشر للسجلّ. مديرُ فريقٍ
-- يملك الاطّلاع فقط لا يحرّر — إخفاء الزرّ ليس تصريحًا، والمنع هنا.
create or replace function public.crm_can_edit_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(public.crm_can_manage(), false)
        or (coalesce(public.crm_can_view(), false) and l.owner_user_id = auth.uid())
      from public.crm_leads l where l.id = p_lead and l.is_deleted = false
  ), false);
$$;

create or replace function public.crm_can_read_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(public.crm_can_see_owner(o.owner_user_id), false)
      from public.crm_opportunities o where o.id = p_opp and o.is_deleted = false
  ), false);
$$;

create or replace function public.crm_can_edit_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(public.crm_can_manage(), false)
        or (coalesce(public.crm_can_view(), false) and o.owner_user_id = auth.uid())
      from public.crm_opportunities o where o.id = p_opp and o.is_deleted = false
  ), false);
$$;

create or replace function public.crm_can_read_activity(p_act uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(public.crm_can_read_lead(a.lead_id), false)
        or coalesce(public.crm_can_read_opportunity(a.opportunity_id), false)
      from public.crm_activities a where a.id = p_act and a.is_deleted = false
  ), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) RLS — تفعيل على كلّ جدول، وسياسات **قراءة فقط**.
--     لا سياسة INSERT/UPDATE/DELETE على أيّ جدول: كلّ كتابة عبر RPC.
--     العميل يسقط في كلّ سياسة لأنّ crm_can_view تشترط is_staff.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts',
    'crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities',
    'crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments',
    'crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- مراجع الموديول: لأيّ موظّف مصرَّح بدخول المبيعات.
  foreach t in array array['crm_settings','crm_teams','crm_team_members','crm_competitors',
                           'crm_lead_score_rules','crm_pipelines','crm_stages'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_can_view())',
                   t || '_read', t);
  end loop;

  -- الشركات وأشخاص التواصل: المملوكة تُقيَّد بالمالك/الفريق، وغير المملوكة مشتركة.
  foreach t in array array['crm_companies','crm_contacts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.crm_can_see_owner(owner_user_id)
          or (owner_user_id is null and public.crm_can_view()))$p$, t || '_read', t);
  end loop;

  drop policy if exists crm_leads_read on public.crm_leads;
  create policy crm_leads_read on public.crm_leads for select to authenticated
    using (public.crm_can_see_owner(owner_user_id));

  drop policy if exists crm_opportunities_read on public.crm_opportunities;
  create policy crm_opportunities_read on public.crm_opportunities for select to authenticated
    using (public.crm_can_see_owner(owner_user_id));

  drop policy if exists crm_stage_history_read on public.crm_stage_history;
  create policy crm_stage_history_read on public.crm_stage_history for select to authenticated
    using (public.crm_can_read_opportunity(opportunity_id));

  drop policy if exists crm_activities_read on public.crm_activities;
  create policy crm_activities_read on public.crm_activities for select to authenticated
    using (public.crm_can_read_lead(lead_id) or public.crm_can_read_opportunity(opportunity_id));

  -- الأهداف: الموظّف يرى هدفه (ولا يحرّره)، والمدير يرى فريقه، والإدارة الكلّ.
  drop policy if exists crm_targets_read on public.crm_targets;
  create policy crm_targets_read on public.crm_targets for select to authenticated
    using (public.crm_can_see_owner(owner_user_id));

  -- ★ العمولات والنِّسَب: مفتاح حسّاس مستقلّ. نسبة الخطّة نفسها لا يراها الموظّف
  --   إطلاقًا — نسبته هو تصله داخل سجلّه هو، لا من كتالوج الخطط.
  drop policy if exists crm_commission_plans_read on public.crm_commission_plans;
  create policy crm_commission_plans_read on public.crm_commission_plans for select to authenticated
    using (public.crm_can_manage_commission() or public.crm_can_view_commission(null::uuid));

  drop policy if exists crm_commission_assignments_read on public.crm_commission_assignments;
  create policy crm_commission_assignments_read on public.crm_commission_assignments for select to authenticated
    using (public.crm_can_view_commission(user_id));

  drop policy if exists crm_commission_records_read on public.crm_commission_records;
  create policy crm_commission_records_read on public.crm_commission_records for select to authenticated
    using (public.crm_can_view_commission(user_id));

  drop policy if exists crm_import_batches_read on public.crm_import_batches;
  create policy crm_import_batches_read on public.crm_import_batches for select to authenticated
    using (public.crm_can_manage() or (public.crm_can_view() and created_by = auth.uid()));

  drop policy if exists crm_audit_read on public.crm_audit;
  create policy crm_audit_read on public.crm_audit for select to authenticated
    using (public.crm_can_manage());

  -- ★ طلبات الاعتماد: المالك يرى الكلّ، ومقدّم الطلب يرى طلبه هو. لا أحد غيرهما
  --   — الطلب يحمل قيمة هدف أو نسبة عمولة، وهي بيانات حسّاسة قبل الاعتماد وبعده.
  drop policy if exists crm_approval_requests_read on public.crm_approval_requests;
  create policy crm_approval_requests_read on public.crm_approval_requests for select to authenticated
    using (public.crm_can_approve_changes() or (public.crm_can_view() and requested_by = auth.uid()));
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) التدقيق + التطبيع + مساعدات داخلية (REVOKE في §12 — لا تُنادى من الواجهة)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.crm_log(
  p_action text, p_etype text, p_eid uuid, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_audit(actor_id, action, entity_type, entity_id, detail)
  values (auth.uid(), p_action, p_etype, p_eid, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ─── قيد entity_type على الإشعارات: شكل لا تعداد ──────────────────────────
-- ★ عيب مثبَت، لا احتياط ★ phase0_migration.sql:285 يحصر
--   notifications.entity_type في خمس قيم من عهد المشاريع، ولا ترحيلة في
--   المستودع توسّعه بعدها. وهذا الموديول يكتب 'crm_opportunity' ⇒ القيد يرفع
--   23514 ⇒ المصيدة داخل crm_notify تبتلعه ⇒ **الإشعار يُفقد بصمت** بينما
--   تُغلق الفرصة بنجاح ظاهريّ ولا يعلم مالكها.
--   العلاج نفسه المعتمَد لـnotifications_type_check في 9C: قيد **شكل** لا تعداد.
--   ⚠️ لا يُطبَّق إلّا إذا كانت كلّ الصفوف القائمة تحترم الشكل الجديد؛ غير ذلك
--      إشعار صريح والقيد يبقى كما هو — لا إسقاط ترحيلة ولا حذف بيانات.
--   الكتلة نفسها حرفيًّا في operations_center_RUNME.sql، ومتساوية القوّة الذاتية،
--   فلا يهمّ أيّ الحزمتين شُغّلت أوّلًا ولا يتنازعان قيدًا واحدًا.
do $notif_shape$
declare v_bad bigint := 0; c record;
begin
  if to_regclass('public.notifications') is null then
    raise notice 'CRM: جدول الإشعارات غير موجود — لا إشعارات داخل التطبيق لهذا الموديول.';
    return;
  end if;
  select count(*) into v_bad from public.notifications
   where entity_type is null or entity_type !~ '^[a-z][a-z0-9_]{2,40}$';
  if v_bad > 0 then
    raise notice 'CRM: % صفّ إشعار قائم لا يحترم شكل entity_type — القيد تُرك كما هو، وإشعارات المبيعات قد تُرفض بصمت.', v_bad;
    return;
  end if;
  -- ⚠️ يُزال **كلّ** قيد CHECK يقيّد entity_type مهما كان اسمه، لا الاسم
  --    القانونيّ وحده. قيدٌ ثانٍ باسم منجرف كان سيبقى يرفض بصمت بينما يبدو
  --    القيد القانونيّ سليمًا.
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = to_regclass('public.notifications')
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%entity_type%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
    raise notice 'CRM: أُزيل قيد entity_type القديم (%).', c.conname;
  end loop;
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type is not null and entity_type ~ '^[a-z][a-z0-9_]{2,40}$');
end $notif_shape$;

-- إشعار معزول: قيد notifications.type منجرف تاريخيًّا، وفشل الإشعار لا يجوز أن
-- يُسقط عملية بيعية صحيحة.
-- ★ لكنّه لا يُبتلَع بصمت ★: الفشل يُكتب في سجلّ الموديول برمز الحالة.
create or replace function public.crm_notify(p_user uuid, p_type text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ss text; v_msg text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then
    perform public.crm_log('notify_unavailable', 'crm_opportunity', p_eid,
      jsonb_build_object('type', p_type, 'reason', 'notify_function_missing'));
    return;
  end if;
  begin
    execute 'select public.notify($1,$2,$3,$4,$5,$6,$7)'
      using p_user, 'user', p_type, 'crm_opportunity', p_eid, p_ar, p_en;
  exception when others then                           -- لا يُسقط المعاملة
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    begin
      perform public.crm_log('notify_failed', 'crm_opportunity', p_eid,
        jsonb_build_object('type', p_type, 'sqlstate', v_ss, 'detail', left(coalesce(v_msg, ''), 200)));
    exception when others then null;
    end;
  end;
end $$;

-- التطبيع: عربيّ ولاتينيّ. يوحّد الألف والياء والتاء المربوطة، ويحذف التشكيل
-- والتطويل، ويطوي المسافات. أساس كشف التكرار — بلا هذا يكون «شركة الكيان» و
-- «شركه الكيان» سجلَّين مختلفين.
create or replace function public.crm_norm_text(p_in text) returns text
language sql immutable security definer set search_path = public as $$
  -- U&'' يكتب الحرف برمزه لا بشكله، فيبقى الملفّ قابلًا للمراجعة ولا تضيع
  -- علامات التشكيل غير المرئية في نسخ/لصق.
  --   \0640 التطويل · \064B-\0652 التشكيل · \0670 الألف الخنجرية
  --   أ إ آ ى ة ؤ ئ  →  ا ا ا ي ه و ي
  select nullif(btrim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p_in, '')), U&'[\0640\064B-\0652\0670]', '', 'g'),
      U&'\0623\0625\0622\0649\0629\0624\0626',
      U&'\0627\0627\0627\064A\0647\0648\064A'),
    U&'[^a-z0-9\0600-\06FF]+', ' ', 'g')), '');
$$;

create or replace function public.crm_norm_email(p_in text) returns text
language sql immutable security definer set search_path = public as $$
  select nullif(lower(btrim(coalesce(p_in, ''))), '');
$$;

-- آخر تسع خانات: يجعل 0555… و+966555… و00966555… رقمًا واحدًا. أقلّ من سبع
-- خانات ليس رقمًا صالحًا للمطابقة ويُعاد NULL بدل مطابقة كاذبة.
create or replace function public.crm_norm_phone(p_in text) returns text
language sql immutable security definer set search_path = public as $$
  select case
    when length(regexp_replace(coalesce(p_in, ''), '[^0-9]', '', 'g')) < 7 then null
    else right(regexp_replace(coalesce(p_in, ''), '[^0-9]', '', 'g'), 9)
  end;
$$;

-- المُشغِّل يُعيد الحساب دائمًا: حتى إدراج بـservice_role لا يستطيع أن يكذب على
-- أعمدة التطبيع، فيبقى كشف التكرار صادقًا.
create or replace function public.crm_normalize_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email_norm := public.crm_norm_email(new.email);
  new.phone_norm := public.crm_norm_phone(new.phone);
  new.company_name_norm := public.crm_norm_text(new.company_name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_normalize_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email_norm := public.crm_norm_email(new.email);
  new.phone_norm := public.crm_norm_phone(new.phone);
  new.name_norm  := public.crm_norm_text(new.full_name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_normalize_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name_norm := public.crm_norm_text(new.name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_normalize_competitor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name_norm := public.crm_norm_text(new.name);
  new.updated_at := now();
  return new;
end $$;

create or replace function public.crm_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $trg$
declare t text;
begin
  drop trigger if exists t_crm_lead_norm on public.crm_leads;
  create trigger t_crm_lead_norm before insert or update on public.crm_leads
    for each row execute function public.crm_normalize_lead();
  drop trigger if exists t_crm_contact_norm on public.crm_contacts;
  create trigger t_crm_contact_norm before insert or update on public.crm_contacts
    for each row execute function public.crm_normalize_contact();
  drop trigger if exists t_crm_company_norm on public.crm_companies;
  create trigger t_crm_company_norm before insert or update on public.crm_companies
    for each row execute function public.crm_normalize_company();
  drop trigger if exists t_crm_competitor_norm on public.crm_competitors;
  create trigger t_crm_competitor_norm before insert or update on public.crm_competitors
    for each row execute function public.crm_normalize_competitor();
  foreach t in array array['crm_opportunities','crm_activities','crm_targets','crm_commission_plans',
                           'crm_commission_assignments','crm_lead_score_rules','crm_pipelines','crm_stages'] loop
    execute format('drop trigger if exists %I on public.%I', 't_' || t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_touch()',
                   't_' || t || '_touch', t);
  end loop;
end $trg$;

-- إعادة تطبيع الصفوف القائمة (تشغيل ثانٍ بعد ترقية دوالّ التطبيع لا يضرّ).
update public.crm_leads set updated_at = updated_at
  where email_norm is distinct from public.crm_norm_email(email)
     or phone_norm is distinct from public.crm_norm_phone(phone)
     or company_name_norm is distinct from public.crm_norm_text(company_name);

-- إعداد رقميّ بقيمة افتراضية صريحة — لا أرقام سحرية داخل منطق العمل.
create or replace function public.crm_setting_int(p_key text, p_default int) returns int
language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  select nullif(value #>> '{}', '')::int into v from public.crm_settings where key = p_key;
  return coalesce(v, p_default);
exception when others then
  return p_default;
end $$;

create or replace function public.crm_setting_text(p_key text, p_default text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select nullif(value #>> '{}', '') into v from public.crm_settings where key = p_key;
  return coalesce(v, p_default);
exception when others then
  return p_default;
end $$;

-- اسم المشروع للعرض فقط — قراءة واحدة، مكتشَفة، ولا تلمس المنصّة.
-- ⚠️ اسم العمود يُقرأ من الكتالوج ولا يُخمَّن: تخمين اسم عمود في هذا المستودع
--    سبق أن أنتج 42703 وأسقط عملية كاملة.
create or replace function public.crm_project_label(p_project uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text; v_col text;
begin
  if p_project is null or to_regclass('public.projects') is null then return null; end if;
  select c.column_name into v_col from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'projects'
     and c.column_name in ('project_name','title','name')
   order by case c.column_name when 'project_name' then 1 when 'title' then 2 else 3 end
   limit 1;
  if v_col is null then return null; end if;
  begin
    execute format('select coalesce(nullif(btrim(p.%I), ''''), p.id::text) from public.projects p where p.id = $1', v_col)
      into v using p_project;
  exception when others then v := null;
  end;
  return v;
end $$;

-- ★ مرجع عرض السعر — **قراءة فقط**. لا هذه الدالّة ولا غيرها في الحزمة تكتب في
--   quote_requests. تُعيد المرجع والحالة والتاريخ فقط، وتقول بصدق إن كان
--   الجدول غائبًا بدل رفع 42P01 في وجه المستخدم.
create or replace function public.crm_quote_ref(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_quote is null then return null; end if;
  if to_regclass('public.quote_requests') is null then
    return jsonb_build_object('available', false, 'reason', 'quote_requests_absent');
  end if;
  begin
    execute 'select jsonb_build_object(''available'', true, ''id'', q.id, ''reference'', q.reference,
                    ''status'', q.status, ''created_at'', q.created_at, ''read_only'', true)
             from public.quote_requests q where q.id = $1'
      into v using p_quote;
  exception when others then
    return jsonb_build_object('available', false, 'reason', 'quote_read_failed');
  end;
  return coalesce(v, jsonb_build_object('available', false, 'reason', 'quote_not_found'));
end $$;

create or replace function public.crm_next_code(p_prefix text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v bigint;
begin
  if p_prefix = 'OPP' then v := nextval('public.crm_opportunity_code_seq');
  else v := nextval('public.crm_lead_code_seq'); end if;
  return coalesce(nullif(p_prefix, ''), 'LEAD') || '-' || to_char(now(), 'YYMM') || '-' || lpad(v::text, 4, '0');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) درجة العميل — **مشتقّة ومعلَّلة**. لا عمود score محفوظ يمكن أن ينحرف،
--     ولا معادلة مخفيّة: كلّ نقطة تعود إلى صفّ في crm_lead_score_rules، وكلّ
--     تعديل يدويّ يظهر ببنده وسببه.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.crm_score_core(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l record; r record; v_items jsonb := '[]'::jsonb; v_base int := 0;
        v_acts int := 0; v_match boolean; v_txt text; v_num numeric; v_bool boolean;
        v_total int; v_hot int; v_warm int; v_grade text;
begin
  select * into l from public.crm_leads where id = p_lead and is_deleted = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lead_not_found'); end if;
  select count(*) into v_acts from public.crm_activities a where a.lead_id = p_lead and a.is_deleted = false;

  for r in select * from public.crm_lead_score_rules where is_active order by sort_order, key loop
    v_txt := null; v_num := null; v_bool := null;
    case r.field
      when 'source'          then v_txt := l.source;
      when 'budget_band'     then v_txt := l.budget_band;
      when 'authority'       then v_txt := l.authority;
      when 'need_level'      then v_txt := l.need_level;
      when 'timeline'        then v_txt := l.timeline;
      when 'company_size'    then v_txt := l.company_size;
      when 'has_email'       then v_bool := (l.email_norm is not null);
      when 'has_phone'       then v_bool := (l.phone_norm is not null);
      when 'has_company'     then v_bool := (l.company_id is not null
                                             or nullif(btrim(coalesce(l.company_name, '')), '') is not null);
      when 'activity_count'  then v_num := v_acts;
      when 'estimated_value' then v_num := coalesce(l.estimated_value, 0);
      else v_txt := null;
    end case;

    v_match := case r.operator
      when 'equals'    then (v_txt is not null and v_txt = r.value_text)
                         or (v_num is not null and r.value_num is not null and v_num = r.value_num)
      when 'in'        then (v_txt is not null and r.value_list is not null and v_txt = any(r.value_list))
      when 'gte'       then (v_num is not null and r.value_num is not null and v_num >= r.value_num)
      when 'not_empty' then (nullif(btrim(coalesce(v_txt, '')), '') is not null) or coalesce(v_num, 0) > 0
      when 'is_true'   then coalesce(v_bool, false)
      else false end;
    v_match := coalesce(v_match, false);

    if v_match then v_base := v_base + r.points; end if;
    v_items := v_items || jsonb_build_object(
      'key', r.key, 'label_ar', r.label_ar, 'label_en', r.label_en,
      'field', r.field, 'operator', r.operator, 'points', r.points, 'matched', v_match);
  end loop;

  v_total := greatest(0, least(100, v_base + coalesce(l.score_manual_adjust, 0)));
  if l.score_override is not null then v_total := l.score_override; end if;

  v_hot  := public.crm_setting_int('score_hot_threshold', 70);
  v_warm := public.crm_setting_int('score_warm_threshold', 40);
  v_grade := case when v_total >= v_hot then 'hot' when v_total >= v_warm then 'warm' else 'cold' end;

  return jsonb_build_object(
    'ok', true, 'lead_id', p_lead,
    'score', v_total, 'rules_total', v_base,
    'manual_adjust', coalesce(l.score_manual_adjust, 0),
    'manual_reason', l.score_adjust_reason,
    'override', l.score_override, 'override_reason', l.score_override_reason,
    'grade', v_grade, 'activity_count', v_acts,
    'components', v_items,
    'explain', 'الدرجة = مجموع القواعد المطابقة + التعديل اليدويّ، محصورة بين 0 و100. التجاوز اليدويّ إن وُجد يحلّ محلّها ويُعرض بسببه.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) كشف التكرار — بريد أو هاتف مطبَّعان أو (شركة + اسم). السجلّ الذي لا تملك
--     رؤيته يظهر **بوجوده فقط** بلا بيانات: كشف تكرار لا يجوز أن يتحوّل إلى
--     تسريب قائمة عملاء زميلك.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.crm_duplicate_core(
  p_email text, p_phone text, p_company text, p_name text, p_exclude uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_e text; v_p text; v_c text; v_n text; v_days int; v_rows jsonb;
begin
  v_e := public.crm_norm_email(p_email);
  v_p := public.crm_norm_phone(p_phone);
  v_c := public.crm_norm_text(p_company);
  v_n := public.crm_norm_text(p_name);
  v_days := public.crm_setting_int('duplicate_window_days', 365);
  if v_e is null and v_p is null and v_c is null then
    return jsonb_build_object('ok', true, 'candidates', '[]'::jsonb, 'checked', false,
      'message', 'لا بريد ولا هاتف ولا شركة — لا يمكن كشف التكرار بلا مُعرِّف واحد على الأقلّ.');
  end if;

  select coalesce(jsonb_agg(x order by x->>'match_rank'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'lead_id', l.id,
      'match_on', case when v_e is not null and l.email_norm = v_e then 'email'
                       when v_p is not null and l.phone_norm = v_p then 'phone'
                       else 'company_name' end,
      'match_rank', case when v_e is not null and l.email_norm = v_e then '1'
                         when v_p is not null and l.phone_norm = v_p then '2' else '3' end,
      'visible', coalesce(public.crm_can_read_lead(l.id), false),
      'lead_code',    case when coalesce(public.crm_can_read_lead(l.id), false) then l.lead_code    else null end,
      'contact_name', case when coalesce(public.crm_can_read_lead(l.id), false) then l.contact_name else null end,
      'company_name', case when coalesce(public.crm_can_read_lead(l.id), false) then l.company_name else null end,
      'status',       case when coalesce(public.crm_can_read_lead(l.id), false) then l.status       else null end,
      'created_at',   case when coalesce(public.crm_can_read_lead(l.id), false) then l.created_at   else null end,
      'note', case when coalesce(public.crm_can_read_lead(l.id), false) then null
                   else 'سجلّ مطابق مُسنَد إلى زميل آخر — التفاصيل خارج صلاحيتك. راجع مدير المبيعات.' end
    ) as x
    from public.crm_leads l
    where l.is_deleted = false
      and (p_exclude is null or l.id <> p_exclude)
      and l.created_at >= now() - make_interval(days => v_days)
      and ((v_e is not null and l.email_norm = v_e)
        or (v_p is not null and l.phone_norm = v_p)
        or (v_c is not null and v_n is not null and l.company_name_norm = v_c
            and public.crm_norm_text(l.contact_name) = v_n))
    order by l.created_at desc
    limit 20
  ) s;

  return jsonb_build_object('ok', true, 'checked', true, 'candidates', v_rows,
    'count', jsonb_array_length(v_rows), 'window_days', v_days);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) جاهزية التحويل — **مشتقّة**. تقول ما ينقص بالضبط، ولا تُنشئ شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.crm_readiness_core(p_opp uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o record; v jsonb := '[]'::jsonb; v_req int := 0; v_ok int := 0; v_acts int := 0;
        v_contact_ok boolean := false; v_quote_ok boolean := false;
begin
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'opportunity_not_found', 'score', 0, 'checks', '[]'::jsonb); end if;
  select count(*) into v_acts from public.crm_activities a where a.opportunity_id = p_opp and a.is_deleted = false;
  select exists (select 1 from public.crm_contacts c
                  where c.id = o.contact_id and c.is_deleted = false
                    and (c.email_norm is not null or c.phone_norm is not null)) into v_contact_ok;
  v_quote_ok := o.quote_request_id is not null;

  -- كلّ بند: مفتاح · نصّ عربيّ · إلزاميّ؟ · محقَّق؟
  v := v
    || jsonb_build_object('key','won',        'ar','الفرصة مربوحة رسميًّا',           'required', true,  'ok', (o.status = 'won'))
    || jsonb_build_object('key','company',    'ar','الشركة/الجهة محدّدة',             'required', true,  'ok', (o.company_id is not null))
    || jsonb_build_object('key','contact',    'ar','شخص تواصل ببريد أو هاتف',         'required', true,  'ok', v_contact_ok)
    || jsonb_build_object('key','value',      'ar','قيمة متّفق عليها أكبر من صفر',     'required', true,  'ok', (coalesce(o.estimated_value,0) > 0))
    || jsonb_build_object('key','owner',      'ar','مالك بيع مُسنَد',                  'required', true,  'ok', (o.owner_user_id is not null))
    || jsonb_build_object('key','activity',   'ar','نشاط تواصل واحد على الأقلّ',       'required', true,  'ok', (v_acts > 0))
    || jsonb_build_object('key','close_date', 'ar','تاريخ إغلاق متوقّع',               'required', false, 'ok', (o.expected_close_date is not null))
    || jsonb_build_object('key','quote',      'ar','مرجع عرض سعر مرتبط (اختياريّ)',    'required', false, 'ok', v_quote_ok)
    || jsonb_build_object('key','handoff_note','ar','ملاحظة تسليم للفريق التنفيذيّ',   'required', false, 'ok', (nullif(btrim(coalesce(o.handoff_note,'')), '') is not null));

  select count(*) filter (where (e->>'required')::boolean),
         count(*) filter (where (e->>'required')::boolean and (e->>'ok')::boolean)
    into v_req, v_ok
    from jsonb_array_elements(v) e;

  return jsonb_build_object(
    'ok', true, 'opportunity_id', p_opp,
    'score', case when v_req = 0 then 0 else round(100.0 * v_ok / v_req)::int end,
    'passed', v_ok, 'required', v_req,
    'ready', (v_req > 0 and v_ok = v_req),
    'handoff_state', o.handoff_state,
    'checks', v,
    'contract', 'الجاهزية تعني أنّ الفرصة صالحة لإنشاء عميل/مشروع **يدويًّا**. هذه الحزمة لا تُنشئ مشروعًا ولا تكتب في منصّة المشاريع.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) دوالّ القراءة
--      ★ crm_access() هي **مِجَسّ الكشف**: تنجح لأيّ جلسة (بما فيها العميل)
--        وتعيد قدرات كلّها false. بهذا تفرّق الواجهة بين «الترحيلة غير مطبَّقة»
--        (PGRST202) و«ممنوع» — ولا تقول لمستخدمٍ ممنوعٍ إنّ القاعدة ناقصة.
--      ★ كلّ دالّة هنا SECURITY DEFINER فتتجاوز RLS، ولذلك تُطبَّق مجموعة
--        الرؤية **صراحةً** في كلّ استعلام. لا اعتماد ضمنيّ على السياسات.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.crm_visible_leads()
returns table (lead_id uuid) language sql stable security definer set search_path = public as $$
  select l.id from public.crm_leads l
   where l.is_deleted = false and coalesce(public.crm_can_see_owner(l.owner_user_id), false);
$$;

create or replace function public.crm_visible_opportunities()
returns table (opp_id uuid) language sql stable security definer set search_path = public as $$
  select o.id from public.crm_opportunities o
   where o.is_deleted = false and coalesce(public.crm_can_see_owner(o.owner_user_id), false);
$$;

create or replace function public.crm_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'authenticated', false, 'can_view', false, 'can_manage', false,
      'is_client', false, 'user_id', null,
      'message', 'سجّل الدخول للوصول إلى المبيعات.');
  end if;
  return jsonb_build_object(
    'ok', true, 'authenticated', true, 'user_id', v_uid,
    'can_view',              coalesce(public.crm_can_view(), false),
    'can_manage',            coalesce(public.crm_can_manage(), false),
    'can_view_team',         coalesce(public.crm_can_view_team(), false),
    'team_key_exists',       coalesce(public.crm_perm_key_exists('crm.view_team'), false),
    'can_manage_pipeline',   coalesce(public.crm_can_manage_pipeline(), false),
    'can_manage_scoring',    coalesce(public.crm_can_manage_scoring(), false),
    'can_manage_targets',    coalesce(public.crm_can_manage_targets(), false),
    'can_manage_commission', coalesce(public.crm_can_manage_commission(), false),
    'can_view_others_commission', coalesce(public.crm_can_view_commission(null::uuid), false),
    'can_import',            coalesce(public.crm_can_import(), false),
    -- ★ اعتماد التغييرات الحسّاسة: راية مستقلّة عن can_manage_* عمدًا. الواجهة
    --   تُظهر بها «سيُرسَل للاعتماد» بدل «سيُحفَظ» قبل أن يضغط المستخدم.
    'can_approve_changes',   coalesce(public.crm_can_approve_changes(), false),
    'approvals_pending',     coalesce((select count(*) from public.crm_approval_requests a
                                        where a.status = 'pending'
                                          and (coalesce(public.crm_can_approve_changes(), false)
                                               or a.requested_by = v_uid)), 0),
    'is_owner_role',         coalesce(public.crm_is_owner_role(), false),
    'is_client',             coalesce(public.crm_is_client(), false),
    'quotes_available',      (to_regclass('public.quote_requests') is not null),
    'projects_available',    (to_regclass('public.projects') is not null),
    'message', case when coalesce(public.crm_can_view(), false) then null
                    else 'وحدة المبيعات مخصّصة لفريق العمل الداخليّ.' end);
end $$;

create or replace function public.crm_lookups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v := jsonb_build_object(
    'ok', true,
    'currency', public.crm_setting_text('default_currency', 'SAR'),
    'stale_days', public.crm_setting_int('stale_days', 21),
    'pipelines', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'key', p.key, 'name_ar', p.name_ar, 'name_en', p.name_en,
        'is_default', p.is_default) order by p.sort_order), '[]'::jsonb)
      from public.crm_pipelines p where p.is_active),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'pipeline_id', s.pipeline_id, 'key', s.key, 'name_ar', s.name_ar,
        'name_en', s.name_en, 'sort_order', s.sort_order,
        'default_probability', s.default_probability, 'is_won', s.is_won, 'is_lost', s.is_lost)
        order by s.sort_order), '[]'::jsonb)
      from public.crm_stages s where s.is_active),
    'competitors', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
        order by c.name), '[]'::jsonb)
      from public.crm_competitors c where c.is_deleted = false and c.is_active),
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city)
        order by c.name), '[]'::jsonb)
      from public.crm_companies c where c.is_deleted = false
        and (coalesce(public.crm_can_see_owner(c.owner_user_id), false)
          or (c.owner_user_id is null and coalesce(public.crm_can_view(), false)))),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'full_name', c.full_name, 'company_id', c.company_id,
        'email', c.email, 'phone', c.phone) order by c.full_name), '[]'::jsonb)
      from public.crm_contacts c where c.is_deleted = false
        and (coalesce(public.crm_can_see_owner(c.owner_user_id), false)
          or (c.owner_user_id is null and coalesce(public.crm_can_view(), false)))),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'manager_user_id', t.manager_user_id) order by t.name), '[]'::jsonb)
      from public.crm_teams t where t.is_deleted = false and t.is_active),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email))
        order by coalesce(nullif(btrim(p.full_name), ''), p.email)), '[]'::jsonb)
      from public.profiles p
      where coalesce(public.crm_can_manage(), false) and p.account_type = 'admin'),
    'score_rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'key', r.key, 'label_ar', r.label_ar, 'label_en', r.label_en,
        'field', r.field, 'operator', r.operator, 'value_text', r.value_text,
        'value_num', r.value_num, 'value_list', r.value_list, 'points', r.points,
        'is_active', r.is_active, 'sort_order', r.sort_order) order by r.sort_order), '[]'::jsonb)
      from public.crm_lead_score_rules r));
  return v;
end $$;

create or replace function public.crm_leads_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int; v_status text; v_source text; v_q text; v_owner uuid; v_due boolean;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_limit  := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  v_status := nullif(btrim(coalesce(p_filters->>'status', '')), '');
  v_source := nullif(btrim(coalesce(p_filters->>'source', '')), '');
  v_q      := nullif(btrim(coalesce(p_filters->>'q', '')), '');
  v_owner  := nullif(btrim(coalesce(p_filters->>'owner_user_id', '')), '')::uuid;
  v_due    := coalesce((p_filters->>'due_only')::boolean, false);

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', l.id, 'lead_code', l.lead_code, 'contact_name', l.contact_name,
      'company_name', l.company_name, 'company_id', l.company_id,
      'email', l.email, 'phone', l.phone, 'source', l.source, 'status', l.status,
      'budget_band', l.budget_band, 'authority', l.authority, 'need_level', l.need_level,
      'timeline', l.timeline, 'estimated_value', l.estimated_value, 'currency', l.currency,
      'owner_user_id', l.owner_user_id, 'next_action', l.next_action, 'next_action_due', l.next_action_due,
      'last_activity_at', l.last_activity_at, 'created_at', l.created_at,
      'duplicate_of_id', l.duplicate_of_id,
      'score', coalesce((public.crm_score_core(l.id)->>'score')::int, 0),
      'grade', coalesce(public.crm_score_core(l.id)->>'grade', 'cold'),
      'sort_key', lpad((1000 - coalesce((public.crm_score_core(l.id)->>'score')::int, 0))::text, 5, '0')
                  || to_char(l.created_at, 'YYYYMMDDHH24MISS')) as x
    from public.crm_leads l
    join public.crm_visible_leads() vl on vl.lead_id = l.id
    where (v_status is null or l.status = v_status)
      and (v_source is null or l.source = v_source)
      and (v_owner  is null or l.owner_user_id = v_owner)
      and (not v_due or (l.next_action_due is not null and l.next_action_due <= current_date))
      and (v_q is null or l.contact_name ilike '%' || v_q || '%'
        or coalesce(l.company_name, '') ilike '%' || v_q || '%'
        or l.lead_code ilike '%' || v_q || '%'
        or coalesce(l.email, '') ilike '%' || v_q || '%'
        or coalesce(l.phone, '') ilike '%' || v_q || '%')
    -- الترتيب قبل القصّ: LIMIT بلا ORDER BY يقتطع صفوفًا عشوائية.
    order by l.created_at desc
    limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'can_manage', coalesce(public.crm_can_manage(), false));
end $$;

create or replace function public.crm_lead_detail(p_lead uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.crm_can_read_lead(p_lead), false) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'ok', true,
    'can_edit', coalesce(public.crm_can_edit_lead(p_lead), false),
    'lead', to_jsonb(l) - 'email_norm' - 'phone_norm' - 'company_name_norm',
    'score', public.crm_score_core(l.id),
    'company', (select to_jsonb(c) - 'name_norm' from public.crm_companies c where c.id = l.company_id),
    'contact', (select to_jsonb(c) - 'email_norm' - 'phone_norm' - 'name_norm'
                  from public.crm_contacts c where c.id = l.contact_id),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb)
                     from public.crm_activities a where a.lead_id = l.id and a.is_deleted = false),
    'opportunities', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', o.id, 'opp_code', o.opp_code, 'title', o.title, 'status', o.status,
                        'estimated_value', o.estimated_value, 'probability', o.probability)), '[]'::jsonb)
                     from public.crm_opportunities o
                     join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                     where o.lead_id = l.id),
    'duplicates', public.crm_duplicate_core(l.email, l.phone, l.company_name, l.contact_name, l.id)
  ) into v
  from public.crm_leads l where l.id = p_lead and l.is_deleted = false;
  return coalesce(v, jsonb_build_object('ok', false, 'reason', 'lead_not_found'));
end $$;

create or replace function public.crm_duplicates(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  return public.crm_duplicate_core(
    p->>'email', p->>'phone', p->>'company_name', p->>'contact_name',
    nullif(btrim(coalesce(p->>'exclude_id', '')), '')::uuid);
end $$;

create or replace function public.crm_opportunities_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int; v_status text; v_stage uuid; v_owner uuid; v_q text; v_weighted numeric;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_limit  := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  v_status := nullif(btrim(coalesce(p_filters->>'status', '')), '');
  v_stage  := nullif(btrim(coalesce(p_filters->>'stage_id', '')), '')::uuid;
  v_owner  := nullif(btrim(coalesce(p_filters->>'owner_user_id', '')), '')::uuid;
  v_q      := nullif(btrim(coalesce(p_filters->>'q', '')), '');

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb),
         coalesce(sum((x->>'weighted_value')::numeric), 0)
    into v_rows, v_weighted from (
    select jsonb_build_object(
      'id', o.id, 'opp_code', o.opp_code, 'title', o.title, 'status', o.status,
      'stage_id', o.stage_id, 'stage_key', st.key, 'stage_name_ar', st.name_ar,
      'stage_order', st.sort_order,
      'company_id', o.company_id, 'company_name', co.name,
      'contact_id', o.contact_id, 'contact_name', ct.full_name,
      'estimated_value', o.estimated_value, 'currency', o.currency,
      'probability', o.probability, 'probability_is_manual', o.probability_is_manual,
      'weighted_value', round(o.estimated_value * o.probability / 100.0, 2),
      'expected_close_date', o.expected_close_date,
      'owner_user_id', o.owner_user_id,
      'next_action', o.next_action, 'next_action_due', o.next_action_due,
      'last_activity_at', o.last_activity_at, 'stage_changed_at', o.stage_changed_at,
      'lost_reason', o.lost_reason, 'competitor_id', o.competitor_id,
      'handoff_state', o.handoff_state,
      'quote_request_id', o.quote_request_id,
      'created_at', o.created_at,
      'sort_key', lpad(st.sort_order::text, 4, '0') || to_char(o.created_at, 'YYYYMMDDHH24MISS')) as x
    from public.crm_opportunities o
    join public.crm_visible_opportunities() vo on vo.opp_id = o.id
    join public.crm_stages st on st.id = o.stage_id
    left join public.crm_companies co on co.id = o.company_id
    left join public.crm_contacts ct on ct.id = o.contact_id
    where (v_status is null or o.status = v_status)
      and (v_stage  is null or o.stage_id = v_stage)
      and (v_owner  is null or o.owner_user_id = v_owner)
      and (v_q is null or o.title ilike '%' || v_q || '%' or o.opp_code ilike '%' || v_q || '%')
    order by st.sort_order, o.expected_close_date nulls last, o.created_at desc
    limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'weighted_total', v_weighted,
    'can_manage', coalesce(public.crm_can_manage(), false));
end $$;

create or replace function public.crm_opportunity_detail(p_opp uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.crm_can_read_opportunity(p_opp), false) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'ok', true,
    'can_edit', coalesce(public.crm_can_edit_opportunity(p_opp), false),
    'opportunity', to_jsonb(o),
    'stage', (select to_jsonb(s) from public.crm_stages s where s.id = o.stage_id),
    'company', (select to_jsonb(c) - 'name_norm' from public.crm_companies c where c.id = o.company_id),
    'contact', (select to_jsonb(c) - 'email_norm' - 'phone_norm' - 'name_norm'
                  from public.crm_contacts c where c.id = o.contact_id),
    'competitor', (select to_jsonb(c) - 'name_norm' from public.crm_competitors c where c.id = o.competitor_id),
    'quote', public.crm_quote_ref(o.quote_request_id),
    'handoff_project_name', public.crm_project_label(o.handoff_project_id),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb)
                     from public.crm_activities a where a.opportunity_id = o.id and a.is_deleted = false),
    'stage_history', (select coalesce(jsonb_agg(jsonb_build_object(
                        'at', h.changed_at, 'from', fs.name_ar, 'to', ts.name_ar,
                        'from_status', h.from_status, 'to_status', h.to_status,
                        'probability', h.probability, 'note', h.note, 'by', h.changed_by)
                        order by h.changed_at desc), '[]'::jsonb)
                     from public.crm_stage_history h
                     left join public.crm_stages fs on fs.id = h.from_stage_id
                     join public.crm_stages ts on ts.id = h.to_stage_id
                     where h.opportunity_id = o.id),
    'readiness', public.crm_readiness_core(o.id),
    -- العمولة تظهر هنا فقط لمن يملك رؤيتها؛ غيره يرى العقد لا الرقم.
    'commission', case when coalesce(public.crm_can_view_commission(o.owner_user_id), false)
      then (select coalesce(jsonb_agg(jsonb_build_object(
              'user_id', r.user_id, 'basis_value', r.basis_value, 'rate_pct', r.rate_pct,
              'amount', r.amount, 'currency', r.currency, 'status', r.status)), '[]'::jsonb)
            from public.crm_commission_records r where r.opportunity_id = o.id and r.is_deleted = false)
      else null end,
    'commission_visible', coalesce(public.crm_can_view_commission(o.owner_user_id), false)
  ) into v
  from public.crm_opportunities o where o.id = p_opp and o.is_deleted = false;
  return coalesce(v, jsonb_build_object('ok', false, 'reason', 'opportunity_not_found'));
end $$;

-- لوحة خطّ الأنابيب: أعمدة المراحل + المجموع المرجَّح لكلّ عمود.
create or replace function public.crm_pipeline_board(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_owner uuid; v_pipe uuid;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_owner := nullif(btrim(coalesce(p_filters->>'owner_user_id', '')), '')::uuid;
  v_pipe  := nullif(btrim(coalesce(p_filters->>'pipeline_id', '')), '')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'stage_id', s.id, 'key', s.key, 'name_ar', s.name_ar, 'name_en', s.name_en,
      'sort_order', s.sort_order, 'default_probability', s.default_probability,
      'is_won', s.is_won, 'is_lost', s.is_lost,
      'count', coalesce(agg.cnt, 0),
      'value', coalesce(agg.val, 0),
      'weighted', coalesce(agg.wgt, 0)) order by s.sort_order), '[]'::jsonb)
    into v
  from public.crm_stages s
  left join lateral (
    select count(*) as cnt, sum(o.estimated_value) as val,
           sum(round(o.estimated_value * o.probability / 100.0, 2)) as wgt
      from public.crm_opportunities o
      join public.crm_visible_opportunities() vo on vo.opp_id = o.id
     where o.stage_id = s.id and o.status = 'open'
       and (v_owner is null or o.owner_user_id = v_owner)
  ) agg on true
  where s.is_active and (v_pipe is null or s.pipeline_id = v_pipe);

  return jsonb_build_object('ok', true, 'columns', v,
    'currency', public.crm_setting_text('default_currency', 'SAR'),
    'can_manage', coalesce(public.crm_can_manage(), false));
end $$;

-- التنبّؤ: مرجَّح · ملتزم (مرحلة ≥ الاحتمال الملتزم) · الأفضل. شهريًّا حسب
-- تاريخ الإغلاق المتوقّع، والفرص بلا تاريخ تُجمَع في دلو معلَن بدل إخفائها.
create or replace function public.crm_forecast(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_months int; v_owner uuid; v_rows jsonb; v_nodate jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_months := least(greatest(coalesce((p_filters->>'months')::int, 6), 1), 24);
  v_owner  := nullif(btrim(coalesce(p_filters->>'owner_user_id', '')), '')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(m.mon, 'YYYY-MM'),
      'count', coalesce(a.cnt, 0),
      'pipeline_value', coalesce(a.val, 0),
      'weighted_value', coalesce(a.wgt, 0),
      'committed_value', coalesce(a.com, 0),
      'won_value', coalesce(a.won, 0)) order by m.mon), '[]'::jsonb)
    into v_rows
  from (select date_trunc('month', current_date)::date + (n || ' months')::interval as mon
          from generate_series(0, v_months - 1) n) m
  left join lateral (
    select count(*) filter (where o.status = 'open') as cnt,
           sum(o.estimated_value) filter (where o.status = 'open') as val,
           sum(round(o.estimated_value * o.probability / 100.0, 2)) filter (where o.status = 'open') as wgt,
           sum(o.estimated_value) filter (where o.status = 'open' and o.probability >= 70) as com,
           sum(o.estimated_value) filter (where o.status = 'won') as won
      from public.crm_opportunities o
      join public.crm_visible_opportunities() vo on vo.opp_id = o.id
     where o.expected_close_date >= m.mon::date
       and o.expected_close_date < (m.mon + interval '1 month')::date
       and (v_owner is null or o.owner_user_id = v_owner)
  ) a on true;

  select jsonb_build_object(
      'count', count(*), 'pipeline_value', coalesce(sum(o.estimated_value), 0),
      'weighted_value', coalesce(sum(round(o.estimated_value * o.probability / 100.0, 2)), 0))
    into v_nodate
  from public.crm_opportunities o
  join public.crm_visible_opportunities() vo on vo.opp_id = o.id
  where o.status = 'open' and o.expected_close_date is null
    and (v_owner is null or o.owner_user_id = v_owner);

  return jsonb_build_object('ok', true, 'months', v_rows, 'no_close_date', v_nodate,
    'currency', public.crm_setting_text('default_currency', 'SAR'),
    'method', 'مرجَّح = القيمة × الاحتمال. ملتزم = فرص احتمالها 70% فأكثر. الفرص بلا تاريخ إغلاق معروضة على حدة ولا تُحتسب في الأشهر.');
end $$;

-- تنبيهات الركود: بلا نشاط · بلا تغيير مرحلة · إجراء تالٍ فات · بلا إجراء تالٍ.
create or replace function public.crm_stale_alerts(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_stale int; v_stage int; v_rows jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_stale := coalesce((p_filters->>'stale_days')::int, public.crm_setting_int('stale_days', 21));
  v_stage := coalesce((p_filters->>'stage_days')::int, public.crm_setting_int('stale_stage_days', 30));

  select coalesce(jsonb_agg(x order by x->>'severity_rank', x->>'opp_code'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'opportunity_id', o.id, 'opp_code', o.opp_code, 'title', o.title,
      'owner_user_id', o.owner_user_id, 'stage_name_ar', st.name_ar,
      'estimated_value', o.estimated_value, 'probability', o.probability,
      'expected_close_date', o.expected_close_date,
      'last_activity_at', o.last_activity_at, 'stage_changed_at', o.stage_changed_at,
      'days_since_activity', case when o.last_activity_at is null then null
                                  else extract(day from now() - o.last_activity_at)::int end,
      'days_in_stage', extract(day from now() - o.stage_changed_at)::int,
      'reasons', (
        (case when o.last_activity_at is null or o.last_activity_at < now() - make_interval(days => v_stale)
              then jsonb_build_array('no_activity') else '[]'::jsonb end)
        || (case when o.stage_changed_at < now() - make_interval(days => v_stage)
              then jsonb_build_array('stage_stuck') else '[]'::jsonb end)
        || (case when o.next_action_due is not null and o.next_action_due < current_date
              then jsonb_build_array('next_action_overdue') else '[]'::jsonb end)
        || (case when nullif(btrim(coalesce(o.next_action, '')), '') is null
              then jsonb_build_array('no_next_action') else '[]'::jsonb end)
        || (case when o.expected_close_date is not null and o.expected_close_date < current_date
              then jsonb_build_array('close_date_passed') else '[]'::jsonb end)),
      'severity_rank', case when o.expected_close_date is not null and o.expected_close_date < current_date
                            then '1' else '2' end) as x
    from public.crm_opportunities o
    join public.crm_visible_opportunities() vo on vo.opp_id = o.id
    join public.crm_stages st on st.id = o.stage_id
    where o.status = 'open'
      and (o.last_activity_at is null or o.last_activity_at < now() - make_interval(days => v_stale)
        or o.stage_changed_at < now() - make_interval(days => v_stage)
        or (o.next_action_due is not null and o.next_action_due < current_date)
        or nullif(btrim(coalesce(o.next_action, '')), '') is null
        or (o.expected_close_date is not null and o.expected_close_date < current_date))
    order by o.expected_close_date nulls last, o.stage_changed_at
    limit 200
  ) s;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'count', jsonb_array_length(v_rows),
    'stale_days', v_stale, 'stage_days', v_stage);
end $$;

create or replace function public.crm_activities_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int; v_kind text; v_lead uuid; v_opp uuid; v_due boolean;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_limit := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  v_kind  := nullif(btrim(coalesce(p_filters->>'kind', '')), '');
  v_lead  := nullif(btrim(coalesce(p_filters->>'lead_id', '')), '')::uuid;
  v_opp   := nullif(btrim(coalesce(p_filters->>'opportunity_id', '')), '')::uuid;
  v_due   := coalesce((p_filters->>'follow_up_due_only')::boolean, false);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb) into v_rows
  from (
    select a.* from public.crm_activities a
    where a.is_deleted = false
      and (coalesce(public.crm_can_read_lead(a.lead_id), false)
        or coalesce(public.crm_can_read_opportunity(a.opportunity_id), false))
      and (v_kind is null or a.kind = v_kind)
      and (v_lead is null or a.lead_id = v_lead)
      and (v_opp  is null or a.opportunity_id = v_opp)
      and (not v_due or (a.follow_up_due is not null and a.follow_up_due <= current_date))
    order by a.occurred_at desc
    limit v_limit
  ) a;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

create or replace function public.crm_targets_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x->>'period_start' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', t.id, 'owner_user_id', t.owner_user_id, 'team_id', t.team_id,
      'period_type', t.period_type, 'period_start', t.period_start, 'period_end', t.period_end,
      'target_value', t.target_value, 'target_count', t.target_count, 'currency', t.currency,
      'notes', t.notes,
      'achieved_value', coalesce((select sum(o.estimated_value) from public.crm_opportunities o
                                   where o.owner_user_id = t.owner_user_id and o.status = 'won'
                                     and o.is_deleted = false
                                     and o.won_at >= t.period_start::timestamptz
                                     and o.won_at < (t.period_end + 1)::timestamptz), 0),
      'achieved_count', coalesce((select count(*) from public.crm_opportunities o
                                   where o.owner_user_id = t.owner_user_id and o.status = 'won'
                                     and o.is_deleted = false
                                     and o.won_at >= t.period_start::timestamptz
                                     and o.won_at < (t.period_end + 1)::timestamptz), 0),
      -- ★ تحرير الهدف ليس من حقّ صاحبه: يُعرض له ولا يُفتح له.
      'can_edit', (coalesce(public.crm_can_manage_targets(), false)
                   and (t.owner_user_id <> auth.uid() or coalesce(public.crm_is_owner_role(), false)))) as x
    from public.crm_targets t
    where t.is_deleted = false and coalesce(public.crm_can_see_owner(t.owner_user_id), false)
    order by t.period_start desc
    limit 200
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows,
    'can_manage_targets', coalesce(public.crm_can_manage_targets(), false));
end $$;

-- ★ العمولات: الفلترة هنا **بالمُسنَد لا بالواجهة**. موظّف بلا مفتاح
--   crm.view_commission لا يستطيع بأيّ فلتر أن يقرأ صفّ زميله.
create or replace function public.crm_commission_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_user uuid; v_plans jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_user := nullif(btrim(coalesce(p_filters->>'user_id', '')), '')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'opportunity_id', r.opportunity_id, 'opp_code', o.opp_code, 'title', o.title,
      'user_id', r.user_id, 'basis', r.basis, 'basis_value', r.basis_value,
      'rate_pct', r.rate_pct, 'amount', r.amount, 'currency', r.currency,
      'status', r.status, 'computed_at', r.computed_at) order by r.computed_at desc), '[]'::jsonb)
    into v_rows
  from public.crm_commission_records r
  join public.crm_opportunities o on o.id = r.opportunity_id
  where r.is_deleted = false
    and coalesce(public.crm_can_view_commission(r.user_id), false)
    and (v_user is null or r.user_id = v_user);

  v_plans := case when coalesce(public.crm_can_manage_commission(), false)
                    or coalesce(public.crm_can_view_commission(null::uuid), false)
    then (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'basis', p.basis, 'rate_pct', p.rate_pct,
            'threshold_value', p.threshold_value, 'cap_value', p.cap_value,
            'currency', p.currency, 'is_active', p.is_active)), '[]'::jsonb)
          from public.crm_commission_plans p where p.is_deleted = false)
    else null end;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'plans', v_plans,
    'sees_others', coalesce(public.crm_can_view_commission(null::uuid), false),
    'can_manage_commission', coalesce(public.crm_can_manage_commission(), false),
    'note', case when coalesce(public.crm_can_view_commission(null::uuid), false) then null
                 else 'تعرض هذه الشاشة عمولتك أنت فقط. عمولات الزملاء ونِسَبهم خارج صلاحيتك.' end);
end $$;

create or replace function public.crm_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb; v_counters jsonb; v_sources jsonb; v_funnel jsonb; v_target jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'leads_total',      (select count(*) from public.crm_visible_leads()),
    'leads_new',        (select count(*) from public.crm_leads l join public.crm_visible_leads() vl on vl.lead_id = l.id
                          where l.status in ('new','contacted')),
    'leads_qualified',  (select count(*) from public.crm_leads l join public.crm_visible_leads() vl on vl.lead_id = l.id
                          where l.status = 'qualified'),
    'opps_open',        (select count(*) from public.crm_opportunities o join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'open'),
    'opps_won',         (select count(*) from public.crm_opportunities o join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'won'),
    'opps_lost',        (select count(*) from public.crm_opportunities o join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'lost'),
    'pipeline_value',   (select coalesce(sum(o.estimated_value), 0) from public.crm_opportunities o
                          join public.crm_visible_opportunities() vo on vo.opp_id = o.id where o.status = 'open'),
    'weighted_value',   (select coalesce(sum(round(o.estimated_value * o.probability / 100.0, 2)), 0)
                          from public.crm_opportunities o
                          join public.crm_visible_opportunities() vo on vo.opp_id = o.id where o.status = 'open'),
    'won_value_90d',    (select coalesce(sum(o.estimated_value), 0) from public.crm_opportunities o
                          join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'won' and o.won_at >= now() - interval '90 days'),
    'awaiting_handoff', (select count(*) from public.crm_opportunities o
                          join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'won' and o.handoff_state = 'ready_for_manual_creation'),
    'my_due_actions',   (select count(*) from public.crm_opportunities o
                          join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                          where o.status = 'open' and o.owner_user_id = v_uid
                            and o.next_action_due is not null and o.next_action_due <= current_date)
  ) into v_counters;

  select coalesce(jsonb_agg(jsonb_build_object('source', c.source, 'count', c.n) order by c.n desc), '[]'::jsonb)
    into v_sources
  from (select l.source, count(*) as n from public.crm_leads l
         join public.crm_visible_leads() vl on vl.lead_id = l.id
         group by l.source) c;

  select jsonb_build_object(
    'leads',      (select count(*) from public.crm_visible_leads()),
    'qualified',  (select count(*) from public.crm_leads l join public.crm_visible_leads() vl on vl.lead_id = l.id
                    where l.status in ('qualified','converted')),
    'converted',  (select count(*) from public.crm_leads l join public.crm_visible_leads() vl on vl.lead_id = l.id
                    where l.status = 'converted'),
    'won',        (select count(*) from public.crm_opportunities o join public.crm_visible_opportunities() vo on vo.opp_id = o.id
                    where o.status = 'won')) into v_funnel;

  select coalesce(jsonb_agg(jsonb_build_object(
      'period_start', t.period_start, 'period_end', t.period_end, 'period_type', t.period_type,
      'target_value', t.target_value,
      'achieved_value', coalesce((select sum(o.estimated_value) from public.crm_opportunities o
                                   where o.owner_user_id = t.owner_user_id and o.status = 'won'
                                     and o.is_deleted = false
                                     and o.won_at >= t.period_start::timestamptz
                                     and o.won_at < (t.period_end + 1)::timestamptz), 0))), '[]'::jsonb)
    into v_target
  from public.crm_targets t
  where t.is_deleted = false and t.owner_user_id = v_uid
    and current_date between t.period_start and t.period_end;

  v := jsonb_build_object(
    'ok', true, 'generated_at', now(),
    'can_manage', coalesce(public.crm_can_manage(), false),
    'counters', v_counters,
    'pipeline', public.crm_pipeline_board(p_filters),
    'forecast', public.crm_forecast(jsonb_build_object('months', 6)),
    'stale', public.crm_stale_alerts('{}'::jsonb),
    'funnel', v_funnel,
    'sources', coalesce(v_sources, '[]'::jsonb),
    'my_targets', v_target,
    'currency', public.crm_setting_text('default_currency', 'SAR'));
  return v;
end $$;

-- التصدير: صفوف مُصفّاة بالمُسنَدات نفسها. أعمدة العمولة **لا تخرج** لمن لا
-- يملك رؤيتها — التصدير ليس بابًا خلفيًّا.
-- volatile عمدًا: التصدير يُدقَّق، والتدقيق كتابة. دالّة stable لا تستطيع
-- الكتابة، وتصديرٌ بلا أثر في السجلّ ليس مقبولًا.
create or replace function public.crm_export(p_entity text, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_rows jsonb; v_cols jsonb;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  if not (coalesce(public.crm_is_owner_role(), false)
       or coalesce(public.crm_perm('crm.export'), false)
       or coalesce(public.crm_can_manage(), false)) then
    raise exception 'not authorized';
  end if;
  if p_entity is null or p_entity not in ('leads','opportunities','activities') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_entity');
  end if;

  if p_entity = 'leads' then
    v_cols := jsonb_build_array('lead_code','contact_name','company_name','email','phone','source',
      'status','budget_band','authority','need_level','timeline','estimated_value','currency',
      'score','next_action','next_action_due','created_at');
    select coalesce(jsonb_agg(jsonb_build_array(
        l.lead_code, l.contact_name, l.company_name, l.email, l.phone, l.source, l.status,
        l.budget_band, l.authority, l.need_level, l.timeline, l.estimated_value, l.currency,
        coalesce((public.crm_score_core(l.id)->>'score')::int, 0),
        l.next_action, l.next_action_due, l.created_at) order by l.created_at desc), '[]'::jsonb)
      into v_rows
    from public.crm_leads l join public.crm_visible_leads() vl on vl.lead_id = l.id;
  elsif p_entity = 'opportunities' then
    v_cols := jsonb_build_array('opp_code','title','company','stage','status','estimated_value',
      'currency','probability','weighted_value','expected_close_date','next_action','next_action_due',
      'lost_reason','handoff_state','created_at');
    select coalesce(jsonb_agg(jsonb_build_array(
        o.opp_code, o.title, co.name, st.name_ar, o.status, o.estimated_value, o.currency,
        o.probability, round(o.estimated_value * o.probability / 100.0, 2), o.expected_close_date,
        o.next_action, o.next_action_due, o.lost_reason, o.handoff_state, o.created_at)
        order by o.created_at desc), '[]'::jsonb)
      into v_rows
    from public.crm_opportunities o
    join public.crm_visible_opportunities() vo on vo.opp_id = o.id
    join public.crm_stages st on st.id = o.stage_id
    left join public.crm_companies co on co.id = o.company_id;
  else
    v_cols := jsonb_build_array('kind','direction','subject','outcome','occurred_at',
      'duration_min','follow_up_due','lead_id','opportunity_id');
    select coalesce(jsonb_agg(jsonb_build_array(
        a.kind, a.direction, a.subject, a.outcome, a.occurred_at, a.duration_min,
        a.follow_up_due, a.lead_id, a.opportunity_id) order by a.occurred_at desc), '[]'::jsonb)
      into v_rows
    from public.crm_activities a
    where a.is_deleted = false
      and (coalesce(public.crm_can_read_lead(a.lead_id), false)
        or coalesce(public.crm_can_read_opportunity(a.opportunity_id), false));
  end if;

  perform public.crm_log('export', p_entity, null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return jsonb_build_object('ok', true, 'entity', p_entity, 'columns', v_cols, 'rows', v_rows,
    'commission_included', false,
    'note', 'التصدير لا يحتوي أعمدة عمولة أو نِسَب إطلاقًا.');
end $$;

create or replace function public.crm_audit_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int;
begin
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  v_limit := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_rows
  from (select * from public.crm_audit order by created_at desc limit v_limit) a;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- ★ صندوق اعتماد المالك. SECURITY DEFINER يتجاوز RLS، فالتصفية مكرّرة هنا
--   صراحةً بنفس قاعدة السياسة — لا يُترك الفرز لسياسة لن تُقيَّم أصلًا.
create or replace function public.crm_approvals_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int; v_status text; v_mine boolean; v_pending int;
begin
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_mine   := not coalesce(public.crm_can_approve_changes(), false);
  v_limit  := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 300);
  v_status := nullif(btrim(coalesce(p_filters->>'status', '')), '');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at desc), '[]'::jsonb) into v_rows
  from (
    select a.id, a.kind, a.entity_id, a.subject_user_id, a.payload, a.reason, a.status,
           a.requested_by, a.requested_at, a.decided_by, a.decided_at, a.decision_note,
           a.applied_entity_id, a.apply_error
      from public.crm_approval_requests a
     where (not v_mine or a.requested_by = auth.uid())
       and (v_status is null or a.status = v_status)
     order by a.requested_at desc
     limit v_limit) r;

  select count(*) into v_pending from public.crm_approval_requests a
   where a.status = 'pending' and (not v_mine or a.requested_by = auth.uid());

  return jsonb_build_object('ok', true, 'rows', v_rows, 'pending', v_pending,
    'can_approve', coalesce(public.crm_can_approve_changes(), false), 'mine_only', v_mine,
    'note', case when v_mine
      then 'ترى طلباتك أنت فقط. الاعتماد للمالك وحده ولا يُمنح بمفتاح صلاحية.'
      else 'اعتمادك هنا هو لحظة وقوع التغيير — قبله لم يتغيّر أيّ رقم.' end);
end $$;

-- ★★ معاينة الاستيراد — تشغيل جافّ. الدالّة **stable**: PostgreSQL نفسه يمنعها
--    من الكتابة، فالضمانة بنيوية لا وعدًا في تعليق. تُعيد قرار كلّ صفّ قبل أن
--    يُكتب حرف واحد، وتقول صراحةً إن كان مفتاح الدفعة مستهلَكًا سابقًا.
create or replace function public.crm_import_preview(p_rows jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_res jsonb := '[]'::jsonb; v_n int; v_i int := 0;
        v_new int := 0; v_dup int := 0; v_bad int := 0; v_dupc jsonb;
        v_prev jsonb := null; v_seen_email text[] := '{}'; v_seen_phone text[] := '{}';
        v_name text; v_email text; v_phone text; v_ne text; v_np text;
        v_intra int := 0; v_issues text[];
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_import(), false) then raise exception 'not authorized'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows_must_be_array');
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 1000 then return jsonb_build_object('ok', false, 'reason', 'too_many_rows', 'max', 1000); end if;

  -- ملاحظة: متغيّر jsonb لا record — record لم يُسنَد إليه صفّ يرفع
  -- "record is not assigned yet" لحظة قراءة حقل منه، وهو خطأ صامت في الاختبار.
  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) >= 8 then
    select jsonb_build_object('batch_id', b.id, 'inserted', b.inserted_count,
             'duplicates', b.duplicate_count, 'errors', b.error_count, 'created_at', b.created_at)
      into v_prev
      from public.crm_import_batches b where b.idempotency_key = btrim(p_idempotency_key);
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_issues := '{}';
    v_name  := nullif(btrim(coalesce(r->>'contact_name', '')), '');
    v_email := nullif(btrim(coalesce(r->>'email', '')), '');
    v_phone := nullif(btrim(coalesce(r->>'phone', '')), '');
    v_ne := public.crm_norm_email(v_email);
    v_np := public.crm_norm_phone(v_phone);

    if v_name is null then v_issues := v_issues || 'missing_contact_name'; end if;
    if v_email is not null and v_ne is null then v_issues := v_issues || 'invalid_email'; end if;
    if v_phone is not null and v_np is null then v_issues := v_issues || 'unusable_phone'; end if;
    if v_name is null and v_email is null and v_phone is null then v_issues := v_issues || 'empty_row'; end if;

    v_dupc := public.crm_duplicate_core(v_email, v_phone, r->>'company_name', r->>'contact_name', null);

    if 'empty_row' = any(v_issues) then
      v_bad := v_bad + 1;
      v_res := v_res || jsonb_build_object('line', v_i, 'contact_name', v_name, 'company_name', r->>'company_name',
        'email', v_email, 'phone', v_phone, 'decision', 'skip', 'issues', to_jsonb(v_issues), 'matches', 0);
    elsif coalesce((v_dupc->>'count')::int, 0) > 0 then
      v_dup := v_dup + 1;
      v_res := v_res || jsonb_build_object('line', v_i, 'contact_name', v_name, 'company_name', r->>'company_name',
        'email', v_email, 'phone', v_phone, 'decision', 'duplicate', 'issues', to_jsonb(v_issues),
        'matches', coalesce((v_dupc->>'count')::int, 0), 'candidates', v_dupc->'candidates');
    else
      -- تكرار داخل الملفّ نفسه: لا يراه كشف القاعدة لأنّ الصفّ لم يُدرج بعد،
      -- لكنّه سيُنتج نسختين عند التنفيذ. يُعلَن هنا لا بعد فوات الأوان.
      if (v_ne is not null and v_ne = any(v_seen_email)) or (v_np is not null and v_np = any(v_seen_phone)) then
        v_intra := v_intra + 1;
        v_issues := v_issues || 'duplicate_within_file';
      end if;
      if v_ne is not null then v_seen_email := v_seen_email || v_ne; end if;
      if v_np is not null then v_seen_phone := v_seen_phone || v_np; end if;
      v_new := v_new + 1;
      v_res := v_res || jsonb_build_object('line', v_i, 'contact_name', coalesce(v_name, 'عميل مستورد'),
        'company_name', r->>'company_name', 'email', v_email, 'phone', v_phone,
        'decision', 'insert', 'issues', to_jsonb(v_issues), 'matches', 0);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', true, 'wrote_nothing', true,
    'rows', v_n, 'will_insert', v_new, 'will_skip_duplicate', v_dup, 'will_skip_invalid', v_bad,
    'duplicate_within_file', v_intra,
    'already_imported', (v_prev is not null),
    'previous_batch', v_prev,
    'result', jsonb_build_object('rows', v_res),
    'note', case when v_prev is not null
      then 'هذه الدفعة مستوردة سابقًا بنفس المفتاح — التنفيذ سيعيد نتيجتها ولن يُدرج شيئًا.'
      else 'معاينة فقط: لم يُكتب أيّ صفّ. التنفيذ خطوة منفصلة وصريحة.' end);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) الكتابة — كلّها SECURITY DEFINER، وكلّها مُدقَّقة.
--      ★ لا سياسة كتابة على أيّ جدول، فإخفاء الزرّ ليس تصريحًا: المنع هنا.
--      ★ لا دالّة واحدة هنا تكتب في projects أو project_core أو deliverables.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_company_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is null then
    v_owner := case when coalesce(public.crm_can_manage(), false)
                    then nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid else auth.uid() end;
    v_new := true;
    insert into public.crm_companies (name, industry, size_band, website, city, country, tax_no, notes,
      owner_user_id, created_by)
    values (coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), 'شركة بلا اسم'),
      nullif(btrim(coalesce(p->>'industry', '')), ''),
      nullif(btrim(coalesce(p->>'size_band', '')), ''),
      nullif(btrim(coalesce(p->>'website', '')), ''),
      nullif(btrim(coalesce(p->>'city', '')), ''),
      nullif(btrim(coalesce(p->>'country', '')), ''),
      nullif(btrim(coalesce(p->>'tax_no', '')), ''),
      nullif(btrim(coalesce(p->>'notes', '')), ''),
      coalesce(v_owner, auth.uid()), auth.uid())
    returning id into v_id;
  else
    if not exists (select 1 from public.crm_companies c where c.id = v_id and c.is_deleted = false
                    and (coalesce(public.crm_can_manage(), false) or c.owner_user_id = auth.uid())) then
      raise exception 'not authorized';
    end if;
    update public.crm_companies set
      name      = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), name),
      industry  = case when p ? 'industry'  then nullif(btrim(coalesce(p->>'industry', '')), '')  else industry  end,
      size_band = case when p ? 'size_band' then nullif(btrim(coalesce(p->>'size_band', '')), '') else size_band end,
      website   = case when p ? 'website'   then nullif(btrim(coalesce(p->>'website', '')), '')   else website   end,
      city      = case when p ? 'city'      then nullif(btrim(coalesce(p->>'city', '')), '')      else city      end,
      country   = case when p ? 'country'   then nullif(btrim(coalesce(p->>'country', '')), '')   else country   end,
      tax_no    = case when p ? 'tax_no'    then nullif(btrim(coalesce(p->>'tax_no', '')), '')    else tax_no    end,
      notes     = case when p ? 'notes'     then nullif(btrim(coalesce(p->>'notes', '')), '')     else notes     end,
      owner_user_id = case when p ? 'owner_user_id' and coalesce(public.crm_can_manage(), false)
                           then nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid else owner_user_id end
    where id = v_id and is_deleted = false;
    if not found then raise exception 'company_not_found'; end if;
  end if;
  perform public.crm_log(case when v_new then 'company_create' else 'company_update' end, 'crm_company', v_id,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

create or replace function public.crm_contact_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is null then
    v_new := true;
    insert into public.crm_contacts (company_id, full_name, job_title, email, phone, whatsapp,
      preferred_channel, is_primary, notes, owner_user_id, created_by)
    values (nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid,
      coalesce(nullif(btrim(coalesce(p->>'full_name', '')), ''), 'جهة اتصال'),
      nullif(btrim(coalesce(p->>'job_title', '')), ''),
      nullif(btrim(coalesce(p->>'email', '')), ''),
      nullif(btrim(coalesce(p->>'phone', '')), ''),
      nullif(btrim(coalesce(p->>'whatsapp', '')), ''),
      coalesce(nullif(btrim(coalesce(p->>'preferred_channel', '')), ''), 'unknown'),
      coalesce((p->>'is_primary')::boolean, false),
      nullif(btrim(coalesce(p->>'notes', '')), ''),
      case when coalesce(public.crm_can_manage(), false)
           then coalesce(nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid, auth.uid())
           else auth.uid() end,
      auth.uid())
    returning id into v_id;
  else
    if not exists (select 1 from public.crm_contacts c where c.id = v_id and c.is_deleted = false
                    and (coalesce(public.crm_can_manage(), false) or c.owner_user_id = auth.uid())) then
      raise exception 'not authorized';
    end if;
    update public.crm_contacts set
      company_id = case when p ? 'company_id' then nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid else company_id end,
      full_name  = coalesce(nullif(btrim(coalesce(p->>'full_name', '')), ''), full_name),
      job_title  = case when p ? 'job_title' then nullif(btrim(coalesce(p->>'job_title', '')), '') else job_title end,
      email      = case when p ? 'email'     then nullif(btrim(coalesce(p->>'email', '')), '')     else email     end,
      phone      = case when p ? 'phone'     then nullif(btrim(coalesce(p->>'phone', '')), '')     else phone     end,
      whatsapp   = case when p ? 'whatsapp'  then nullif(btrim(coalesce(p->>'whatsapp', '')), '')  else whatsapp  end,
      preferred_channel = coalesce(nullif(btrim(coalesce(p->>'preferred_channel', '')), ''), preferred_channel),
      is_primary = coalesce((p->>'is_primary')::boolean, is_primary),
      notes      = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end
    where id = v_id and is_deleted = false;
    if not found then raise exception 'contact_not_found'; end if;
  end if;
  perform public.crm_log(case when v_new then 'contact_create' else 'contact_update' end, 'crm_contact', v_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

create or replace function public.crm_competitor_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is null then
    v_new := true;
    insert into public.crm_competitors (name, notes, created_by)
    values (coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), 'منافس'),
            nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.crm_competitors set
      name = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), name),
      notes = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id and is_deleted = false;
    if not found then raise exception 'competitor_not_found'; end if;
  end if;
  perform public.crm_log(case when v_new then 'competitor_create' else 'competitor_update' end,
    'crm_competitor', v_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

-- ★ إنشاء عميل محتمل: كشف التكرار **قبل** الإدراج، ومرجع خارجيّ يجعل إعادة
--   الإرسال تُعيد الصفّ نفسه بدل أن تُنتج توأمًا.
create or replace function public.crm_lead_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
        v_dup jsonb; v_ext text; v_owner uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_id  := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  v_ext := nullif(btrim(coalesce(p->>'external_ref', '')), '');

  if v_id is null then
    -- Idempotency: نفس المرجع الخارجيّ ⇒ نفس الصفّ، لا نسخة ثانية.
    if v_ext is not null then
      select l.id into v_id from public.crm_leads l
       where l.external_ref = v_ext and l.is_deleted = false limit 1;
      if v_id is not null then
        return jsonb_build_object('ok', true, 'id', v_id, 'created', false, 'idempotent', true);
      end if;
    end if;

    if not coalesce((p->>'confirm_duplicate')::boolean, false) then
      v_dup := public.crm_duplicate_core(p->>'email', p->>'phone', p->>'company_name', p->>'contact_name', null);
      if coalesce((v_dup->>'count')::int, 0) > 0 then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_suspected', 'duplicates', v_dup,
          'message', 'يوجد سجلّ مطابق. راجعه ثمّ أعد الإرسال مع confirm_duplicate إن كان مختلفًا فعلًا.');
      end if;
    end if;

    v_owner := case when coalesce(public.crm_can_manage(), false)
                    then coalesce(nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid, auth.uid())
                    else auth.uid() end;
    v_code := public.crm_next_code('LEAD');
    v_new := true;
    insert into public.crm_leads (lead_code, company_id, contact_id, company_name, contact_name,
      email, phone, whatsapp, city, country, industry, company_size, source, source_detail, campaign,
      status, budget_band, authority, need_level, timeline, qualification_note, estimated_value,
      currency, notes, owner_user_id, assigned_at, next_action, next_action_due, external_ref, created_by)
    values (v_code,
      nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid,
      nullif(btrim(coalesce(p->>'contact_id', '')), '')::uuid,
      nullif(btrim(coalesce(p->>'company_name', '')), ''),
      coalesce(nullif(btrim(coalesce(p->>'contact_name', '')), ''), 'عميل محتمل'),
      nullif(btrim(coalesce(p->>'email', '')), ''),
      nullif(btrim(coalesce(p->>'phone', '')), ''),
      nullif(btrim(coalesce(p->>'whatsapp', '')), ''),
      nullif(btrim(coalesce(p->>'city', '')), ''),
      nullif(btrim(coalesce(p->>'country', '')), ''),
      nullif(btrim(coalesce(p->>'industry', '')), ''),
      nullif(btrim(coalesce(p->>'company_size', '')), ''),
      coalesce(nullif(btrim(coalesce(p->>'source', '')), ''), 'other'),
      nullif(btrim(coalesce(p->>'source_detail', '')), ''),
      nullif(btrim(coalesce(p->>'campaign', '')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status', '')), ''), 'new'),
      coalesce(nullif(btrim(coalesce(p->>'budget_band', '')), ''), 'unknown'),
      coalesce(nullif(btrim(coalesce(p->>'authority', '')), ''), 'unknown'),
      coalesce(nullif(btrim(coalesce(p->>'need_level', '')), ''), 'unknown'),
      coalesce(nullif(btrim(coalesce(p->>'timeline', '')), ''), 'unknown'),
      nullif(btrim(coalesce(p->>'qualification_note', '')), ''),
      nullif(btrim(coalesce(p->>'estimated_value', '')), '')::numeric,
      coalesce(nullif(btrim(coalesce(p->>'currency', '')), ''), public.crm_setting_text('default_currency', 'SAR')),
      nullif(btrim(coalesce(p->>'notes', '')), ''),
      v_owner, now(),
      nullif(btrim(coalesce(p->>'next_action', '')), ''),
      nullif(btrim(coalesce(p->>'next_action_due', '')), '')::date,
      v_ext, auth.uid())
    returning id into v_id;
  else
    if not coalesce(public.crm_can_edit_lead(v_id), false) then raise exception 'not authorized'; end if;
    update public.crm_leads set
      company_id    = case when p ? 'company_id'   then nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid else company_id end,
      contact_id    = case when p ? 'contact_id'   then nullif(btrim(coalesce(p->>'contact_id', '')), '')::uuid else contact_id end,
      company_name  = case when p ? 'company_name' then nullif(btrim(coalesce(p->>'company_name', '')), '') else company_name end,
      contact_name  = coalesce(nullif(btrim(coalesce(p->>'contact_name', '')), ''), contact_name),
      email         = case when p ? 'email'    then nullif(btrim(coalesce(p->>'email', '')), '')    else email    end,
      phone         = case when p ? 'phone'    then nullif(btrim(coalesce(p->>'phone', '')), '')    else phone    end,
      whatsapp      = case when p ? 'whatsapp' then nullif(btrim(coalesce(p->>'whatsapp', '')), '') else whatsapp end,
      city          = case when p ? 'city'     then nullif(btrim(coalesce(p->>'city', '')), '')     else city     end,
      country       = case when p ? 'country'  then nullif(btrim(coalesce(p->>'country', '')), '')  else country  end,
      industry      = case when p ? 'industry' then nullif(btrim(coalesce(p->>'industry', '')), '') else industry end,
      company_size  = case when p ? 'company_size' then nullif(btrim(coalesce(p->>'company_size', '')), '') else company_size end,
      source        = coalesce(nullif(btrim(coalesce(p->>'source', '')), ''), source),
      source_detail = case when p ? 'source_detail' then nullif(btrim(coalesce(p->>'source_detail', '')), '') else source_detail end,
      campaign      = case when p ? 'campaign' then nullif(btrim(coalesce(p->>'campaign', '')), '') else campaign end,
      budget_band   = coalesce(nullif(btrim(coalesce(p->>'budget_band', '')), ''), budget_band),
      authority     = coalesce(nullif(btrim(coalesce(p->>'authority', '')), ''), authority),
      need_level    = coalesce(nullif(btrim(coalesce(p->>'need_level', '')), ''), need_level),
      timeline      = coalesce(nullif(btrim(coalesce(p->>'timeline', '')), ''), timeline),
      qualification_note = case when p ? 'qualification_note' then nullif(btrim(coalesce(p->>'qualification_note', '')), '') else qualification_note end,
      estimated_value = case when p ? 'estimated_value' then nullif(btrim(coalesce(p->>'estimated_value', '')), '')::numeric else estimated_value end,
      notes         = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
      next_action   = case when p ? 'next_action' then nullif(btrim(coalesce(p->>'next_action', '')), '') else next_action end,
      next_action_due = case when p ? 'next_action_due' then nullif(btrim(coalesce(p->>'next_action_due', '')), '')::date else next_action_due end,
      -- إسناد المالك حقّ إداريّ: الموظّف لا يُهدي سجلّه لغيره ولا يسحب سجلّ غيره.
      owner_user_id = case when p ? 'owner_user_id' and coalesce(public.crm_can_manage(), false)
                           then nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid else owner_user_id end
    where id = v_id and is_deleted = false;
    if not found then raise exception 'lead_not_found'; end if;
  end if;

  perform public.crm_log(case when v_new then 'lead_create' else 'lead_update' end, 'crm_lead', v_id,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new,
    'score', public.crm_score_core(v_id));
end $$;

create or replace function public.crm_lead_set_status(p_lead uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_old text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_edit_lead(p_lead), false) then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('new','contacted','working','qualified','unqualified','dropped') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status',
      'message', 'حالة غير معروفة. التحويل إلى «converted» يتمّ عبر crm_lead_convert وحدها.');
  end if;
  if p_status in ('unqualified','dropped') and length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'message', 'اذكر سببًا صريحًا (٣ أحرف على الأقلّ) لعدم التأهيل أو الإسقاط.');
  end if;
  select status into v_old from public.crm_leads where id = p_lead and is_deleted = false for update;
  if v_old is null then raise exception 'lead_not_found'; end if;
  if v_old = 'converted' then
    return jsonb_build_object('ok', false, 'reason', 'already_converted',
      'message', 'العميل محوَّل إلى فرصة — لا تُعاد حالته.');
  end if;
  update public.crm_leads set status = p_status,
    unqualified_reason = case when p_status = 'unqualified' then btrim(p_reason) else unqualified_reason end,
    dropped_reason     = case when p_status = 'dropped'     then btrim(p_reason) else dropped_reason end,
    first_contact_at   = case when p_status = 'contacted' and first_contact_at is null then now() else first_contact_at end
  where id = p_lead and is_deleted = false;
  perform public.crm_log('lead_status', 'crm_lead', p_lead,
    jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_lead, 'from', v_old, 'to', p_status);
end $$;

-- تعديل الدرجة: **معلَن**. التعديل اليدويّ يتطلّب سببًا، والتجاوز الكامل مفتاح
-- مستقلّ — لأنّ درجة بلا تفسير تُعيد الصندوق الأسود من الباب الخلفيّ.
create or replace function public.crm_lead_score_adjust(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_lead uuid; v_adj int; v_ovr int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_lead := nullif(btrim(coalesce(p->>'lead_id', '')), '')::uuid;
  if v_lead is null then return jsonb_build_object('ok', false, 'reason', 'lead_id_required'); end if;
  if not coalesce(public.crm_can_edit_lead(v_lead), false) then raise exception 'not authorized'; end if;

  if p ? 'score_manual_adjust' then
    v_adj := nullif(btrim(coalesce(p->>'score_manual_adjust', '')), '')::int;
    if v_adj is not null and (v_adj < -50 or v_adj > 50) then
      return jsonb_build_object('ok', false, 'reason', 'adjust_out_of_range');
    end if;
    if coalesce(v_adj, 0) <> 0 and length(btrim(coalesce(p->>'reason', ''))) < 3 then
      return jsonb_build_object('ok', false, 'reason', 'reason_required',
        'message', 'التعديل اليدويّ للدرجة يتطلّب سببًا مكتوبًا.');
    end if;
    update public.crm_leads set score_manual_adjust = coalesce(v_adj, 0),
      score_adjust_reason = nullif(btrim(coalesce(p->>'reason', '')), '')
    where id = v_lead and is_deleted = false;
  end if;

  if p ? 'score_override' then
    if not coalesce(public.crm_can_manage_scoring(), false) then raise exception 'not authorized'; end if;
    v_ovr := nullif(btrim(coalesce(p->>'score_override', '')), '')::int;
    if v_ovr is not null and (v_ovr < 0 or v_ovr > 100) then
      return jsonb_build_object('ok', false, 'reason', 'override_out_of_range');
    end if;
    if v_ovr is not null and length(btrim(coalesce(p->>'override_reason', ''))) < 3 then
      return jsonb_build_object('ok', false, 'reason', 'reason_required',
        'message', 'تجاوز الدرجة يتطلّب سببًا مكتوبًا يظهر لكلّ من يقرأ السجلّ.');
    end if;
    update public.crm_leads set score_override = v_ovr,
      score_override_reason = nullif(btrim(coalesce(p->>'override_reason', '')), '')
    where id = v_lead and is_deleted = false;
  end if;

  perform public.crm_log('lead_score_adjust', 'crm_lead', v_lead, p - 'reason' - 'override_reason');
  return jsonb_build_object('ok', true, 'id', v_lead, 'score', public.crm_score_core(v_lead));
end $$;

-- ★ التحويل يبقى **داخل المبيعات**: عميل محتمل ← فرصة بيعية. لا مشروع، ولا
--   عميل في طبقة المنصّة، ولا أيّ كتابة خارج جداول crm_*.
create or replace function public.crm_lead_convert(p_lead uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); l record; v_stage uuid; v_pipe uuid; v_prob int;
        v_opp uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_edit_lead(p_lead), false) then raise exception 'not authorized'; end if;
  select * into l from public.crm_leads where id = p_lead and is_deleted = false for update;
  if not found then raise exception 'lead_not_found'; end if;
  if l.status = 'converted' then
    return jsonb_build_object('ok', false, 'reason', 'already_converted',
      'opportunity_id', l.converted_opportunity_id,
      'message', 'هذا العميل محوَّل بالفعل — الفرصة القائمة هي المرجع.');
  end if;

  v_pipe := nullif(btrim(coalesce(p->>'pipeline_id', '')), '')::uuid;
  if v_pipe is null then select id into v_pipe from public.crm_pipelines where is_default and is_active limit 1; end if;
  if v_pipe is null then select id into v_pipe from public.crm_pipelines where is_active order by sort_order limit 1; end if;
  if v_pipe is null then return jsonb_build_object('ok', false, 'reason', 'no_pipeline'); end if;

  v_stage := nullif(btrim(coalesce(p->>'stage_id', '')), '')::uuid;
  if v_stage is null then
    select id into v_stage from public.crm_stages
     where pipeline_id = v_pipe and is_active and not is_won and not is_lost
     order by sort_order limit 1;
  end if;
  if v_stage is null then return jsonb_build_object('ok', false, 'reason', 'no_stage'); end if;
  select default_probability into v_prob from public.crm_stages where id = v_stage;

  v_code := public.crm_next_code('OPP');
  insert into public.crm_opportunities (opp_code, title, lead_id, company_id, contact_id, pipeline_id,
    stage_id, status, source, estimated_value, currency, probability, expected_close_date,
    owner_user_id, next_action, next_action_due, quote_request_id, notes, created_by)
  values (v_code,
    coalesce(nullif(btrim(coalesce(p->>'title', '')), ''),
             coalesce(l.company_name, l.contact_name) || ' — فرصة بيعية'),
    l.id, l.company_id, l.contact_id, v_pipe, v_stage, 'open', l.source,
    coalesce(nullif(btrim(coalesce(p->>'estimated_value', '')), '')::numeric, coalesce(l.estimated_value, 0)),
    coalesce(l.currency, public.crm_setting_text('default_currency', 'SAR')),
    coalesce(v_prob, 0),
    nullif(btrim(coalesce(p->>'expected_close_date', '')), '')::date,
    coalesce(l.owner_user_id, auth.uid()),
    nullif(btrim(coalesce(p->>'next_action', '')), ''),
    nullif(btrim(coalesce(p->>'next_action_due', '')), '')::date,
    nullif(btrim(coalesce(p->>'quote_request_id', '')), '')::uuid,
    nullif(btrim(coalesce(p->>'notes', '')), ''),
    auth.uid())
  returning id into v_opp;

  insert into public.crm_stage_history (opportunity_id, from_stage_id, to_stage_id, from_status, to_status,
    probability, note, changed_by)
  values (v_opp, null, v_stage, null, 'open', coalesce(v_prob, 0), 'إنشاء من تحويل عميل محتمل', auth.uid());

  update public.crm_leads set status = 'converted', converted_opportunity_id = v_opp, converted_at = now()
   where id = p_lead;

  perform public.crm_log('lead_convert', 'crm_lead', p_lead,
    jsonb_build_object('opportunity_id', v_opp, 'creates_project', false));
  return jsonb_build_object('ok', true, 'lead_id', p_lead, 'opportunity_id', v_opp, 'opp_code', v_code,
    'note', 'أُنشئت فرصة بيعية داخل المبيعات فقط. لم يُنشأ مشروع ولم تُمَسّ منصّة المشاريع.');
end $$;

create or replace function public.crm_lead_delete(p_lead uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.crm_leads set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = btrim(p_reason)
  where id = p_lead and is_deleted = false;
  if not found then raise exception 'lead_not_found'; end if;
  perform public.crm_log('lead_delete', 'crm_lead', p_lead, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_lead);
end $$;

create or replace function public.crm_opportunity_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
        v_stage uuid; v_pipe uuid; v_prob int; v_code text; v_manual boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;

  if v_id is null then
    v_pipe := nullif(btrim(coalesce(p->>'pipeline_id', '')), '')::uuid;
    if v_pipe is null then select id into v_pipe from public.crm_pipelines where is_default and is_active limit 1; end if;
    if v_pipe is null then return jsonb_build_object('ok', false, 'reason', 'no_pipeline'); end if;
    v_stage := nullif(btrim(coalesce(p->>'stage_id', '')), '')::uuid;
    if v_stage is null then
      select id into v_stage from public.crm_stages where pipeline_id = v_pipe and is_active
        and not is_won and not is_lost order by sort_order limit 1;
    end if;
    if v_stage is null then return jsonb_build_object('ok', false, 'reason', 'no_stage'); end if;
    select default_probability into v_prob from public.crm_stages where id = v_stage;
    v_manual := p ? 'probability';
    v_code := public.crm_next_code('OPP');
    v_new := true;
    insert into public.crm_opportunities (opp_code, title, lead_id, company_id, contact_id, pipeline_id,
      stage_id, status, source, estimated_value, currency, probability, probability_is_manual,
      expected_close_date, owner_user_id, next_action, next_action_due, quote_request_id, notes, created_by)
    values (v_code,
      coalesce(nullif(btrim(coalesce(p->>'title', '')), ''), 'فرصة بيعية'),
      nullif(btrim(coalesce(p->>'lead_id', '')), '')::uuid,
      nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid,
      nullif(btrim(coalesce(p->>'contact_id', '')), '')::uuid,
      v_pipe, v_stage, 'open',
      nullif(btrim(coalesce(p->>'source', '')), ''),
      coalesce(nullif(btrim(coalesce(p->>'estimated_value', '')), '')::numeric, 0),
      coalesce(nullif(btrim(coalesce(p->>'currency', '')), ''), public.crm_setting_text('default_currency', 'SAR')),
      coalesce(nullif(btrim(coalesce(p->>'probability', '')), '')::int, coalesce(v_prob, 0)),
      coalesce(v_manual, false),
      nullif(btrim(coalesce(p->>'expected_close_date', '')), '')::date,
      case when coalesce(public.crm_can_manage(), false)
           then coalesce(nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid, auth.uid())
           else auth.uid() end,
      nullif(btrim(coalesce(p->>'next_action', '')), ''),
      nullif(btrim(coalesce(p->>'next_action_due', '')), '')::date,
      nullif(btrim(coalesce(p->>'quote_request_id', '')), '')::uuid,
      nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
    returning id into v_id;
    insert into public.crm_stage_history (opportunity_id, to_stage_id, to_status, probability, note, changed_by)
    values (v_id, v_stage, 'open', coalesce(v_prob, 0), 'إنشاء فرصة', auth.uid());
  else
    if not coalesce(public.crm_can_edit_opportunity(v_id), false) then raise exception 'not authorized'; end if;
    update public.crm_opportunities set
      title        = coalesce(nullif(btrim(coalesce(p->>'title', '')), ''), title),
      company_id   = case when p ? 'company_id' then nullif(btrim(coalesce(p->>'company_id', '')), '')::uuid else company_id end,
      contact_id   = case when p ? 'contact_id' then nullif(btrim(coalesce(p->>'contact_id', '')), '')::uuid else contact_id end,
      source       = case when p ? 'source' then nullif(btrim(coalesce(p->>'source', '')), '') else source end,
      estimated_value = coalesce(nullif(btrim(coalesce(p->>'estimated_value', '')), '')::numeric, estimated_value),
      currency     = coalesce(nullif(btrim(coalesce(p->>'currency', '')), ''), currency),
      probability  = coalesce(nullif(btrim(coalesce(p->>'probability', '')), '')::int, probability),
      probability_is_manual = case when p ? 'probability' then true else probability_is_manual end,
      expected_close_date = case when p ? 'expected_close_date'
                                 then nullif(btrim(coalesce(p->>'expected_close_date', '')), '')::date
                                 else expected_close_date end,
      next_action  = case when p ? 'next_action' then nullif(btrim(coalesce(p->>'next_action', '')), '') else next_action end,
      next_action_due = case when p ? 'next_action_due' then nullif(btrim(coalesce(p->>'next_action_due', '')), '')::date else next_action_due end,
      notes        = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
      owner_user_id = case when p ? 'owner_user_id' and coalesce(public.crm_can_manage(), false)
                           then nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid else owner_user_id end,
      version = version + 1
    where id = v_id and is_deleted = false;
    if not found then raise exception 'opportunity_not_found'; end if;
  end if;

  perform public.crm_log(case when v_new then 'opportunity_create' else 'opportunity_update' end,
    'crm_opportunity', v_id,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

-- ربط عرض السعر: **مرجع للقراءة فقط**. لا تُعدَّل quote_requests هنا ولا في أيّ
-- مكان آخر من هذه الحزمة.
create or replace function public.crm_opportunity_link_quote(p_opp uuid, p_quote uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_edit_opportunity(p_opp), false) then raise exception 'not authorized'; end if;
  if p_quote is not null then
    v := public.crm_quote_ref(p_quote);
    if not coalesce((v->>'available')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', coalesce(v->>'reason', 'quote_unavailable'),
        'message', 'تعذّر قراءة طلب عرض السعر المطلوب. لم يُربط شيء.');
    end if;
  end if;
  update public.crm_opportunities set quote_request_id = p_quote, version = version + 1
   where id = p_opp and is_deleted = false;
  if not found then raise exception 'opportunity_not_found'; end if;
  perform public.crm_log('opportunity_link_quote', 'crm_opportunity', p_opp,
    jsonb_build_object('quote_request_id', p_quote, 'read_only', true));
  return jsonb_build_object('ok', true, 'id', p_opp, 'quote', v, 'read_only', true);
end $$;

create or replace function public.crm_opportunity_set_stage(p_opp uuid, p_stage uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o record; s record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_edit_opportunity(p_opp), false) then raise exception 'not authorized'; end if;
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false for update;
  if not found then raise exception 'opportunity_not_found'; end if;
  select * into s from public.crm_stages where id = p_stage and is_active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'stage_not_found'); end if;
  if s.pipeline_id <> o.pipeline_id then
    return jsonb_build_object('ok', false, 'reason', 'stage_pipeline_mismatch',
      'message', 'هذه المرحلة تتبع خطّ أنابيب آخر. لم يتغيّر شيء.');
  end if;
  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open',
      'message', 'الفرصة مغلقة — أعد فتحها قبل تغيير المرحلة.');
  end if;
  if s.is_won or s.is_lost then
    return jsonb_build_object('ok', false, 'reason', 'use_close',
      'message', 'مرحلتا الربح والخسارة تُضبطان عبر إغلاق الفرصة (crm_opportunity_close) لا بتحريك المرحلة.');
  end if;

  update public.crm_opportunities set stage_id = s.id, stage_changed_at = now(),
    probability = case when o.probability_is_manual then o.probability else s.default_probability end,
    version = version + 1
  where id = p_opp;

  insert into public.crm_stage_history (opportunity_id, from_stage_id, to_stage_id, from_status, to_status,
    probability, note, changed_by)
  values (p_opp, o.stage_id, s.id, o.status, o.status,
          case when o.probability_is_manual then o.probability else s.default_probability end,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  perform public.crm_log('opportunity_stage', 'crm_opportunity', p_opp,
    jsonb_build_object('from_stage', o.stage_id, 'to_stage', s.id, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', p_opp, 'stage_id', s.id, 'stage_key', s.key);
end $$;

-- ★★ إغلاق الفرصة. الربح يُنتج **تسجيلًا** لا أتمتة: handoff_state تصبح
--     ready_for_manual_creation، ولا يُنشأ مشروع ولا يُكتب حرف واحد في المنصّة.
create or replace function public.crm_opportunity_close(p_opp uuid, p_result text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); o record; v_stage uuid; v_mgr uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_edit_opportunity(p_opp), false) then raise exception 'not authorized'; end if;
  if p_result is null or p_result not in ('won','lost','abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_result');
  end if;
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false for update;
  if not found then raise exception 'opportunity_not_found'; end if;
  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'already_closed', 'status', o.status);
  end if;

  if p_result = 'lost' then
    if nullif(btrim(coalesce(p->>'lost_reason', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'lost_reason_required',
        'message', 'سبب الخسارة إلزاميّ — بلا سبب لا يتعلّم أحد شيئًا.');
    end if;
    select id into v_stage from public.crm_stages where pipeline_id = o.pipeline_id and is_lost limit 1;
    update public.crm_opportunities set
      status = 'lost', probability = 0, lost_at = now(),
      stage_id = coalesce(v_stage, stage_id), stage_changed_at = now(),
      lost_reason = nullif(btrim(coalesce(p->>'lost_reason', '')), ''),
      lost_reason_note = nullif(btrim(coalesce(p->>'lost_reason_note', '')), ''),
      competitor_id = nullif(btrim(coalesce(p->>'competitor_id', '')), '')::uuid,
      handoff_state = 'not_applicable', version = version + 1
    where id = p_opp;
  elsif p_result = 'abandoned' then
    update public.crm_opportunities set status = 'abandoned', probability = 0, lost_at = now(),
      lost_reason = coalesce(nullif(btrim(coalesce(p->>'lost_reason', '')), ''), 'internal'),
      lost_reason_note = nullif(btrim(coalesce(p->>'lost_reason_note', '')), ''),
      handoff_state = 'not_applicable', version = version + 1
    where id = p_opp;
  else
    select id into v_stage from public.crm_stages where pipeline_id = o.pipeline_id and is_won limit 1;
    update public.crm_opportunities set
      status = 'won', probability = 100, won_at = now(),
      stage_id = coalesce(v_stage, stage_id), stage_changed_at = now(),
      estimated_value = coalesce(nullif(btrim(coalesce(p->>'final_value', '')), '')::numeric, estimated_value),
      -- ★ العقد: «جاهزة لإنشاء يدويّ» لا «أُنشئ مشروع».
      handoff_state = 'ready_for_manual_creation', handoff_ready_at = now(),
      handoff_note = nullif(btrim(coalesce(p->>'handoff_note', '')), ''),
      version = version + 1
    where id = p_opp;
    perform public.crm_commission_recalc_core(p_opp);
  end if;

  insert into public.crm_stage_history (opportunity_id, from_stage_id, to_stage_id, from_status, to_status,
    probability, note, changed_by)
  select p_opp, o.stage_id, coalesce(v_stage, o.stage_id), o.status, p_result,
         case when p_result = 'won' then 100 else 0 end,
         nullif(btrim(coalesce(p->>'note', '')), ''), auth.uid();

  select t.manager_user_id into v_mgr from public.crm_team_members m
    join public.crm_teams t on t.id = m.team_id
   where m.user_id = o.owner_user_id and m.is_deleted = false and t.is_deleted = false limit 1;
  if p_result = 'won' then
    perform public.crm_notify(v_mgr, 'crm_opportunity_won', p_opp,
      'فرصة مربوحة بانتظار إنشاء المشروع يدويًّا: ' || o.title,
      'Won opportunity awaiting MANUAL project creation: ' || o.title);
  end if;

  perform public.crm_log('opportunity_close', 'crm_opportunity', p_opp,
    jsonb_build_object('result', p_result, 'lost_reason', p->>'lost_reason',
                       'competitor_id', p->>'competitor_id', 'creates_project', false));
  return jsonb_build_object('ok', true, 'id', p_opp, 'status', p_result,
    'handoff_state', case when p_result = 'won' then 'ready_for_manual_creation' else 'not_applicable' end,
    'readiness', public.crm_readiness_core(p_opp),
    'contract', case when p_result = 'won'
      then 'سُجِّل أنّ الفرصة جاهزة لإنشاء عميل/مشروع **يدويًّا**. لم يُنشأ مشروع ولم تُمَسّ منصّة المشاريع.'
      else null end);
end $$;

create or replace function public.crm_opportunity_reopen(p_opp uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false for update;
  if not found then raise exception 'opportunity_not_found'; end if;
  if o.status = 'open' then return jsonb_build_object('ok', false, 'reason', 'already_open'); end if;
  if o.handoff_state = 'manually_created' then
    return jsonb_build_object('ok', false, 'reason', 'handoff_recorded',
      'message', 'سُجِّل إنشاء مشروع لهذه الفرصة — إعادة فتحها تُفسد سجلّ التسليم.');
  end if;
  update public.crm_opportunities set status = 'open', won_at = null, lost_at = null,
    handoff_state = 'not_ready', handoff_ready_at = null, version = version + 1
  where id = p_opp;
  update public.crm_commission_records set status = 'void', note = 'أُعيد فتح الفرصة'
   where opportunity_id = p_opp and is_deleted = false and status = 'draft';
  perform public.crm_log('opportunity_reopen', 'crm_opportunity', p_opp, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_opp);
end $$;

create or replace function public.crm_opportunity_delete(p_opp uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.crm_opportunities set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = btrim(p_reason), version = version + 1
  where id = p_opp and is_deleted = false;
  if not found then raise exception 'opportunity_not_found'; end if;
  perform public.crm_log('opportunity_delete', 'crm_opportunity', p_opp, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_opp);
end $$;

-- ★★ عقد التسليم: **تسجيل** أنّ مشروعًا أُنشئ يدويًّا. لا إنشاء ولا كتابة في
--     المنصّة. أقصى ما يحدث هنا: حفظ معرّف مشروع اختياريّ وملاحظة.
create or replace function public.crm_handoff_confirm(p_opp uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); o record; v_proj uuid; v_exists boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  -- ★ الرؤية شرط أوّل لا يُتجاوَز: مفتاح crm.handoff يسمح بتسجيل التسليم على
  --   فرصة **تراها**، لا على أيّ فرصة في النظام. بلا هذا الشرط يصبح المفتاح
  --   بابًا جانبيًّا للكتابة على سجلّات زملاء لا تملك حتى قراءتها.
  if not coalesce(public.crm_can_read_opportunity(p_opp), false) then raise exception 'not authorized'; end if;
  if not (coalesce(public.crm_can_edit_opportunity(p_opp), false)
       or coalesce(public.crm_perm('crm.handoff'), false)) then raise exception 'not authorized'; end if;
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false for update;
  if not found then raise exception 'opportunity_not_found'; end if;
  if o.status <> 'won' then
    return jsonb_build_object('ok', false, 'reason', 'not_won',
      'message', 'لا يُسجَّل تسليم لفرصة غير مربوحة.');
  end if;

  v_proj := nullif(btrim(coalesce(p->>'handoff_project_id', '')), '')::uuid;
  if v_proj is not null then
    if to_regclass('public.projects') is null then
      return jsonb_build_object('ok', false, 'reason', 'projects_absent',
        'message', 'جدول المشاريع غير موجود — سجّل التسليم بلا ربط.');
    end if;
    begin
      execute 'select exists (select 1 from public.projects p where p.id = $1)' into v_exists using v_proj;
    exception when others then v_exists := false;
    end;
    if not coalesce(v_exists, false) then
      return jsonb_build_object('ok', false, 'reason', 'project_not_found',
        'message', 'لم يُعثر على مشروع بهذا المعرّف. أنشئه يدويًّا أوّلًا ثمّ سجّل رقمه هنا.');
    end if;
  end if;

  update public.crm_opportunities set
    handoff_state = 'manually_created',
    handoff_project_id = v_proj,
    handoff_note = coalesce(nullif(btrim(coalesce(p->>'handoff_note', '')), ''), handoff_note),
    handoff_recorded_by = auth.uid(), handoff_recorded_at = now(), version = version + 1
  where id = p_opp;

  perform public.crm_log('handoff_confirm', 'crm_opportunity', p_opp,
    jsonb_build_object('handoff_project_id', v_proj, 'created_by_module', false,
                       'contract', 'record_only_no_platform_write'));
  return jsonb_build_object('ok', true, 'id', p_opp, 'handoff_state', 'manually_created',
    'handoff_project_id', v_proj, 'project_name', public.crm_project_label(v_proj),
    'contract', 'سُجِّل أنّ الإنشاء تمّ يدويًّا خارج هذه الوحدة. الوحدة لم تُنشئ شيئًا ولم تكتب في منصّة المشاريع.');
end $$;

create or replace function public.crm_activity_log(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_lead uuid; v_opp uuid; v_when timestamptz;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_lead := nullif(btrim(coalesce(p->>'lead_id', '')), '')::uuid;
  v_opp  := nullif(btrim(coalesce(p->>'opportunity_id', '')), '')::uuid;
  if v_lead is null and v_opp is null then
    return jsonb_build_object('ok', false, 'reason', 'parent_required',
      'message', 'النشاط يجب أن يتبع عميلًا محتملًا أو فرصة.');
  end if;
  -- الكتابة تتطلّب حقّ التحرير على الأب، لا مجرّد الاطّلاع عليه.
  if v_opp is not null and not coalesce(public.crm_can_edit_opportunity(v_opp), false) then
    raise exception 'not authorized';
  end if;
  if v_opp is null and not coalesce(public.crm_can_edit_lead(v_lead), false) then
    raise exception 'not authorized';
  end if;
  if coalesce(p->>'kind', '') not in ('call','email','meeting','whatsapp_note','follow_up','note','demo','site_visit') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  end if;

  v_when := coalesce(nullif(btrim(coalesce(p->>'occurred_at', '')), '')::timestamptz, now());
  insert into public.crm_activities (kind, direction, subject, body, outcome, occurred_at, duration_min,
    lead_id, opportunity_id, contact_id, follow_up_due, follow_up_note, owner_user_id, created_by)
  values (p->>'kind',
    coalesce(nullif(btrim(coalesce(p->>'direction', '')), ''), 'outbound'),
    coalesce(nullif(btrim(coalesce(p->>'subject', '')), ''), 'نشاط'),
    nullif(btrim(coalesce(p->>'body', '')), ''),
    nullif(btrim(coalesce(p->>'outcome', '')), ''),
    v_when,
    nullif(btrim(coalesce(p->>'duration_min', '')), '')::int,
    v_lead, v_opp,
    nullif(btrim(coalesce(p->>'contact_id', '')), '')::uuid,
    nullif(btrim(coalesce(p->>'follow_up_due', '')), '')::date,
    nullif(btrim(coalesce(p->>'follow_up_note', '')), ''),
    auth.uid(), auth.uid())
  returning id into v_id;

  -- «آخر نشاط» و«الإجراء التالي» يُحدَّثان معًا: تنبيه الركود يعتمد عليهما.
  if v_opp is not null then
    update public.crm_opportunities set last_activity_at = greatest(coalesce(last_activity_at, v_when), v_when),
      next_action = coalesce(nullif(btrim(coalesce(p->>'next_action', '')), ''), next_action),
      next_action_due = coalesce(nullif(btrim(coalesce(p->>'follow_up_due', '')), '')::date, next_action_due)
    where id = v_opp and is_deleted = false;
  end if;
  if v_lead is not null then
    update public.crm_leads set last_activity_at = greatest(coalesce(last_activity_at, v_when), v_when),
      next_action = coalesce(nullif(btrim(coalesce(p->>'next_action', '')), ''), next_action),
      next_action_due = coalesce(nullif(btrim(coalesce(p->>'follow_up_due', '')), '')::date, next_action_due)
    where id = v_lead and is_deleted = false;
  end if;

  perform public.crm_log('activity_log', 'crm_activity', v_id,
    jsonb_build_object('kind', p->>'kind', 'lead_id', v_lead, 'opportunity_id', v_opp));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.crm_activity_delete(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into a from public.crm_activities where id = p_id and is_deleted = false;
  if not found then raise exception 'activity_not_found'; end if;
  if not (coalesce(public.crm_can_manage(), false) or a.created_by = auth.uid()) then
    raise exception 'not authorized';
  end if;
  update public.crm_activities set is_deleted = true where id = p_id;
  perform public.crm_log('activity_delete', 'crm_activity', p_id, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.crm_score_rule_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_key text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_scoring(), false) then raise exception 'not authorized'; end if;
  v_id  := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  v_key := nullif(btrim(coalesce(p->>'key', '')), '');
  if v_id is null and v_key is null then return jsonb_build_object('ok', false, 'reason', 'key_required'); end if;
  if v_id is null then
    insert into public.crm_lead_score_rules (key, label_ar, label_en, field, operator, value_text,
      value_num, value_list, points, is_active, sort_order, updated_by)
    values (v_key, coalesce(p->>'label_ar', ''), coalesce(p->>'label_en', ''),
      coalesce(p->>'field', 'source'), coalesce(p->>'operator', 'equals'),
      nullif(btrim(coalesce(p->>'value_text', '')), ''),
      nullif(btrim(coalesce(p->>'value_num', '')), '')::numeric,
      case when p ? 'value_list' then (select array_agg(x #>> '{}') from jsonb_array_elements(p->'value_list') x) else null end,
      coalesce(nullif(btrim(coalesce(p->>'points', '')), '')::int, 0),
      coalesce((p->>'is_active')::boolean, true),
      coalesce(nullif(btrim(coalesce(p->>'sort_order', '')), '')::int, 500), auth.uid())
    returning id into v_id;
  else
    update public.crm_lead_score_rules set
      label_ar = coalesce(p->>'label_ar', label_ar), label_en = coalesce(p->>'label_en', label_en),
      field = coalesce(nullif(btrim(coalesce(p->>'field', '')), ''), field),
      operator = coalesce(nullif(btrim(coalesce(p->>'operator', '')), ''), operator),
      value_text = case when p ? 'value_text' then nullif(btrim(coalesce(p->>'value_text', '')), '') else value_text end,
      value_num  = case when p ? 'value_num' then nullif(btrim(coalesce(p->>'value_num', '')), '')::numeric else value_num end,
      value_list = case when p ? 'value_list'
                        then (select array_agg(x #>> '{}') from jsonb_array_elements(p->'value_list') x)
                        else value_list end,
      points = coalesce(nullif(btrim(coalesce(p->>'points', '')), '')::int, points),
      is_active = coalesce((p->>'is_active')::boolean, is_active),
      sort_order = coalesce(nullif(btrim(coalesce(p->>'sort_order', '')), '')::int, sort_order),
      updated_by = auth.uid()
    where id = v_id;
    if not found then raise exception 'rule_not_found'; end if;
  end if;
  perform public.crm_log('score_rule_upsert', 'crm_score_rule', v_id, p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.crm_settings_set(p_key text, p_value jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  if p_key is null or p_key not in ('stale_days','stale_stage_days','default_currency',
      'duplicate_window_days','score_hot_threshold','score_warm_threshold') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_setting');
  end if;
  insert into public.crm_settings (key, value, updated_by, updated_at)
  values (p_key, coalesce(p_value, '{}'::jsonb), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.crm_log('settings_set', 'crm_setting', null, jsonb_build_object('key', p_key, 'value', p_value));
  return jsonb_build_object('ok', true, 'key', p_key);
end $$;

create or replace function public.crm_team_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is null then
    insert into public.crm_teams (name, manager_user_id, notes, created_by)
    values (coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), 'فريق مبيعات'),
            nullif(btrim(coalesce(p->>'manager_user_id', '')), '')::uuid,
            nullif(btrim(coalesce(p->>'notes', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.crm_teams set
      name = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), name),
      manager_user_id = case when p ? 'manager_user_id' then nullif(btrim(coalesce(p->>'manager_user_id', '')), '')::uuid else manager_user_id end,
      notes = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
      is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'team_not_found'; end if;
  end if;
  perform public.crm_log('team_upsert', 'crm_team', v_id, p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.crm_team_member_set(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_team uuid; v_user uuid; v_remove boolean; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage(), false) then raise exception 'not authorized'; end if;
  v_team := nullif(btrim(coalesce(p->>'team_id', '')), '')::uuid;
  v_user := nullif(btrim(coalesce(p->>'user_id', '')), '')::uuid;
  v_remove := coalesce((p->>'remove')::boolean, false);
  if v_team is null or v_user is null then return jsonb_build_object('ok', false, 'reason', 'team_and_user_required'); end if;
  if v_remove then
    update public.crm_team_members set is_deleted = true where team_id = v_team and user_id = v_user and is_deleted = false;
  else
    insert into public.crm_team_members (team_id, user_id, role_label, created_by)
    select v_team, v_user, nullif(btrim(coalesce(p->>'role_label', '')), ''), auth.uid()
    where not exists (select 1 from public.crm_team_members m
                       where m.team_id = v_team and m.user_id = v_user and m.is_deleted = false)
    returning id into v_id;
  end if;
  perform public.crm_log(case when v_remove then 'team_member_remove' else 'team_member_add' end,
    'crm_team', v_team, jsonb_build_object('user_id', v_user));
  return jsonb_build_object('ok', true, 'team_id', v_team, 'user_id', v_user, 'removed', v_remove);
end $$;

-- ★★ الأهداف: الموظّف لا يحرّر هدفه، ولا مديرُ مبيعاتٍ يحرّر هدف نفسه. المالك
--     وحده يملك ذلك. المنع هنا — لا في الواجهة.
-- ★★ موافقة المالك — الأساس المشترك.
--    الطلب المعلَّق **ليس** تغييرًا: لا يُقرأ في هدف ولا تنبّؤ ولا عمولة. لذلك
--    نواة التطبيق منفصلة عن بوّابة الصلاحية: تُنادى إمّا من المالك مباشرةً، وإمّا
--    من crm_approval_decide بعد اعتماده. ولا تُمنح لأحد (REVOKE في §12).
create or replace function public.crm_approval_submit_core(
  p_kind text, p_entity uuid, p_subject uuid, p_payload jsonb, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.crm_approval_requests (kind, entity_id, subject_user_id, payload, reason, requested_by)
  values (p_kind, p_entity, p_subject, coalesce(p_payload, '{}'::jsonb),
          nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- نواة تطبيق الهدف. بلا بوّابة صلاحية عمدًا — المنع في المُنادي، وهي داخلية.
create or replace function public.crm_target_apply_core(p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_owner uuid; v_start date; v_end date;
begin
  v_owner := nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid;
  v_id    := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is not null and v_owner is null then
    select owner_user_id into v_owner from public.crm_targets where id = v_id and is_deleted = false;
  end if;
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'owner_required'); end if;

  v_start := nullif(btrim(coalesce(p->>'period_start', '')), '')::date;
  v_end   := nullif(btrim(coalesce(p->>'period_end', '')), '')::date;
  if v_id is null then
    if v_start is null or v_end is null then return jsonb_build_object('ok', false, 'reason', 'period_required'); end if;
    insert into public.crm_targets (owner_user_id, team_id, period_type, period_start, period_end,
      target_value, target_count, currency, notes, set_by)
    values (v_owner, nullif(btrim(coalesce(p->>'team_id', '')), '')::uuid,
      coalesce(nullif(btrim(coalesce(p->>'period_type', '')), ''), 'month'), v_start, v_end,
      coalesce(nullif(btrim(coalesce(p->>'target_value', '')), '')::numeric, 0),
      coalesce(nullif(btrim(coalesce(p->>'target_count', '')), '')::int, 0),
      coalesce(nullif(btrim(coalesce(p->>'currency', '')), ''), public.crm_setting_text('default_currency', 'SAR')),
      nullif(btrim(coalesce(p->>'notes', '')), ''), p_actor)
    on conflict (owner_user_id, period_type, period_start) where is_deleted = false
    do update set period_end = excluded.period_end, target_value = excluded.target_value,
      target_count = excluded.target_count, currency = excluded.currency, notes = excluded.notes,
      set_by = excluded.set_by, updated_at = now()
    returning id into v_id;
  else
    update public.crm_targets set
      target_value = coalesce(nullif(btrim(coalesce(p->>'target_value', '')), '')::numeric, target_value),
      target_count = coalesce(nullif(btrim(coalesce(p->>'target_count', '')), '')::int, target_count),
      period_end   = coalesce(v_end, period_end),
      notes        = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes', '')), '') else notes end,
      set_by = p_actor, updated_at = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'target_not_found'; end if;
  end if;
  perform public.crm_log('target_upsert', 'crm_target', v_id,
    jsonb_build_object('owner_user_id', v_owner, 'target_value', p->>'target_value', 'applied_by', p_actor));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ★ الهدف: من يحمل المفتاح **يقترح**، والمالك وحده **يغيّر**.
--   الفرق ملموس في الناتج: pending_approval = true ولا صفّ واحد تغيّر.
create or replace function public.crm_target_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_owner uuid; v_req uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_targets(), false) then raise exception 'not authorized'; end if;
  v_owner := nullif(btrim(coalesce(p->>'owner_user_id', '')), '')::uuid;
  v_id    := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is not null and v_owner is null then
    select owner_user_id into v_owner from public.crm_targets where id = v_id and is_deleted = false;
  end if;
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'owner_required'); end if;
  if v_owner = auth.uid() and not coalesce(public.crm_is_owner_role(), false) then
    return jsonb_build_object('ok', false, 'reason', 'self_target_denied',
      'message', 'لا تُحرَّر أهدافك بنفسك. هدفك يضعه المالك أو من يملك صلاحية الأهداف من فوقك.');
  end if;

  if not coalesce(public.crm_can_approve_changes(), false) then
    if v_id is null and (nullif(btrim(coalesce(p->>'period_start', '')), '') is null
                      or nullif(btrim(coalesce(p->>'period_end', '')), '') is null) then
      return jsonb_build_object('ok', false, 'reason', 'period_required');
    end if;
    v_req := public.crm_approval_submit_core('target', v_id, v_owner, p, p->>'request_reason');
    perform public.crm_log('target_change_requested', 'crm_approval_request', v_req,
      jsonb_build_object('target_id', v_id, 'owner_user_id', v_owner, 'target_value', p->>'target_value'));
    return jsonb_build_object('ok', true, 'pending_approval', true, 'request_id', v_req,
      'message', 'أُرسل الطلب لاعتماد المالك. لم يتغيّر أيّ هدف بعد — التغيير يقع لحظة الاعتماد.');
  end if;

  return public.crm_target_apply_core(p, auth.uid());
end $$;

create or replace function public.crm_target_delete(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_owner uuid; v_req uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_targets(), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select owner_user_id into v_owner from public.crm_targets where id = p_id and is_deleted = false;
  if v_owner is null then raise exception 'target_not_found'; end if;
  if v_owner = auth.uid() and not coalesce(public.crm_is_owner_role(), false) then
    return jsonb_build_object('ok', false, 'reason', 'self_target_denied',
      'message', 'لا تحذف هدفك بنفسك.');
  end if;
  if not coalesce(public.crm_can_approve_changes(), false) then
    v_req := public.crm_approval_submit_core('target_delete', p_id, v_owner,
      jsonb_build_object('id', p_id), p_reason);
    perform public.crm_log('target_delete_requested', 'crm_approval_request', v_req,
      jsonb_build_object('target_id', p_id, 'owner_user_id', v_owner, 'reason', btrim(p_reason)));
    return jsonb_build_object('ok', true, 'pending_approval', true, 'request_id', v_req,
      'message', 'أُرسل طلب حذف الهدف لاعتماد المالك. الهدف ما زال قائمًا.');
  end if;
  update public.crm_targets set is_deleted = true, updated_at = now() where id = p_id;
  perform public.crm_log('target_delete', 'crm_target', p_id, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- أساس العمولة: حساب صريح (قيمة − عتبة) × نسبة، بسقف اختياريّ. لا صرف ولا
-- تكامل ماليّ — وهذا معلَن في الاسم والوثيقة.
create or replace function public.crm_commission_recalc_core(p_opp uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o record; pl record; v_base numeric; v_amt numeric;
begin
  select * into o from public.crm_opportunities where id = p_opp and is_deleted = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'opportunity_not_found'); end if;
  if o.status <> 'won' or o.owner_user_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_won_or_unowned');
  end if;
  select p.* into pl from public.crm_commission_assignments a
    join public.crm_commission_plans p on p.id = a.plan_id
   where a.user_id = o.owner_user_id and a.is_deleted = false and p.is_deleted = false and p.is_active
     and a.effective_from <= coalesce(o.won_at::date, current_date)
     and (a.effective_to is null or a.effective_to >= coalesce(o.won_at::date, current_date))
   order by a.effective_from desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_active_plan'); end if;

  v_base := greatest(coalesce(o.estimated_value, 0) - coalesce(pl.threshold_value, 0), 0);
  v_amt  := round(v_base * coalesce(pl.rate_pct, 0) / 100.0, 2);
  if pl.cap_value is not null then v_amt := least(v_amt, pl.cap_value); end if;

  insert into public.crm_commission_records (opportunity_id, user_id, plan_id, basis, basis_value,
    rate_pct, amount, currency, status, computed_at)
  values (p_opp, o.owner_user_id, pl.id, pl.basis, v_base, pl.rate_pct, v_amt,
          coalesce(o.currency, pl.currency), 'draft', now())
  on conflict (opportunity_id, user_id) where is_deleted = false
  do update set plan_id = excluded.plan_id, basis = excluded.basis, basis_value = excluded.basis_value,
    rate_pct = excluded.rate_pct, amount = excluded.amount, currency = excluded.currency,
    computed_at = now(), status = case when crm_commission_records.status = 'approved'
                                       then crm_commission_records.status else 'draft' end;
  return jsonb_build_object('ok', true, 'opportunity_id', p_opp, 'amount', v_amt, 'rate_pct', pl.rate_pct);
end $$;

create or replace function public.crm_commission_recalc(p_opp uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_commission(), false) then raise exception 'not authorized'; end if;
  v := public.crm_commission_recalc_core(p_opp);
  perform public.crm_log('commission_recalc', 'crm_opportunity', p_opp, v);
  return v;
end $$;

-- نواة تطبيق قاعدة العمولة — داخلية، بلا بوّابة، لا تُمنح لأحد.
create or replace function public.crm_commission_plan_apply_core(p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_basis text;
begin
  -- ★ لا أساس إلّا المُنفَّذ ★ — الرفض هنا صريح ومفهوم بدل انتهاك قيد خام،
  --   ولأنّ حاسبة العمولة تقرأ estimated_value وحدها فأيّ أساس آخر وسمٌ كاذب.
  v_basis := nullif(btrim(coalesce(p->>'basis', '')), '');
  if v_basis is not null and v_basis <> 'won_value' then
    return jsonb_build_object('ok', false, 'reason', 'basis_not_implemented',
      'requested_basis', v_basis,
      'message', 'الأساس الوحيد المنفَّذ هو قيمة الفرصة المكسوبة (won_value). '
              || 'العمولة على الهامش تستلزم قراءة التكلفة داخل المبيعات، وهذا ممنوع بجدار المالية.');
  end if;
  v_id := nullif(btrim(coalesce(p->>'id', '')), '')::uuid;
  if v_id is null then
    insert into public.crm_commission_plans (name, basis, rate_pct, threshold_value, cap_value, currency, notes, created_by)
    values (coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), 'خطّة عمولة'),
      coalesce(nullif(btrim(coalesce(p->>'basis', '')), ''), 'won_value'),
      coalesce(nullif(btrim(coalesce(p->>'rate_pct', '')), '')::numeric, 0),
      coalesce(nullif(btrim(coalesce(p->>'threshold_value', '')), '')::numeric, 0),
      nullif(btrim(coalesce(p->>'cap_value', '')), '')::numeric,
      coalesce(nullif(btrim(coalesce(p->>'currency', '')), ''), public.crm_setting_text('default_currency', 'SAR')),
      nullif(btrim(coalesce(p->>'notes', '')), ''), p_actor)
    returning id into v_id;
  else
    update public.crm_commission_plans set
      name = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), name),
      basis = coalesce(nullif(btrim(coalesce(p->>'basis', '')), ''), basis),
      rate_pct = coalesce(nullif(btrim(coalesce(p->>'rate_pct', '')), '')::numeric, rate_pct),
      threshold_value = coalesce(nullif(btrim(coalesce(p->>'threshold_value', '')), '')::numeric, threshold_value),
      cap_value = case when p ? 'cap_value' then nullif(btrim(coalesce(p->>'cap_value', '')), '')::numeric else cap_value end,
      is_active = coalesce((p->>'is_active')::boolean, is_active), updated_at = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'plan_not_found'; end if;
  end if;
  perform public.crm_log('commission_plan_upsert', 'crm_commission_plan', v_id,
    p || jsonb_build_object('applied_by', p_actor));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ★ قاعدة العمولة تتبع القاعدة نفسها: اقتراح من حامل المفتاح، تغيير من المالك.
create or replace function public.crm_commission_plan_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_req uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_commission(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_approve_changes(), false) then
    v_req := public.crm_approval_submit_core('commission_plan',
      nullif(btrim(coalesce(p->>'id', '')), '')::uuid, null, p, p->>'request_reason');
    perform public.crm_log('commission_plan_change_requested', 'crm_approval_request', v_req,
      jsonb_build_object('plan_id', p->>'id', 'rate_pct', p->>'rate_pct'));
    return jsonb_build_object('ok', true, 'pending_approval', true, 'request_id', v_req,
      'message', 'أُرسلت قاعدة العمولة لاعتماد المالك. لم تتغيّر أيّ نسبة بعد.');
  end if;
  return public.crm_commission_plan_apply_core(p, auth.uid());
end $$;

-- نواة إسناد خطّة عمولة — داخلية.
create or replace function public.crm_commission_assign_core(p_payload jsonb, p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_user uuid; v_plan uuid;
begin
  v_user := nullif(btrim(coalesce(p->>'user_id', '')), '')::uuid;
  v_plan := nullif(btrim(coalesce(p->>'plan_id', '')), '')::uuid;
  if v_user is null or v_plan is null then return jsonb_build_object('ok', false, 'reason', 'user_and_plan_required'); end if;
  if not exists (select 1 from public.crm_commission_plans where id = v_plan and is_deleted = false) then
    return jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  end if;
  insert into public.crm_commission_assignments (plan_id, user_id, effective_from, effective_to, created_by)
  values (v_plan, v_user,
    coalesce(nullif(btrim(coalesce(p->>'effective_from', '')), '')::date, current_date),
    nullif(btrim(coalesce(p->>'effective_to', '')), '')::date, p_actor)
  returning id into v_id;
  perform public.crm_log('commission_assign', 'crm_commission_assignment', v_id,
    jsonb_build_object('user_id', v_user, 'plan_id', v_plan, 'applied_by', p_actor));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- إسناد خطّة عمولة لنفسك ممنوع على غير المالك: من يضع نسبته بنفسه لا يحتاج
-- إلى نظام عمولات أصلًا. وإسنادها لغيرك يظلّ اقتراحًا حتى يعتمده المالك.
create or replace function public.crm_commission_assign(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_user uuid; v_plan uuid; v_req uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_commission(), false) then raise exception 'not authorized'; end if;
  v_user := nullif(btrim(coalesce(p->>'user_id', '')), '')::uuid;
  v_plan := nullif(btrim(coalesce(p->>'plan_id', '')), '')::uuid;
  if v_user is null or v_plan is null then return jsonb_build_object('ok', false, 'reason', 'user_and_plan_required'); end if;
  if v_user = auth.uid() and not coalesce(public.crm_is_owner_role(), false) then
    return jsonb_build_object('ok', false, 'reason', 'self_commission_denied',
      'message', 'لا تُسنِد لنفسك خطّة عمولة. هذا قرار المالك.');
  end if;
  if not coalesce(public.crm_can_approve_changes(), false) then
    v_req := public.crm_approval_submit_core('commission_assign', v_plan, v_user, p, p->>'request_reason');
    perform public.crm_log('commission_assign_requested', 'crm_approval_request', v_req,
      jsonb_build_object('user_id', v_user, 'plan_id', v_plan));
    return jsonb_build_object('ok', true, 'pending_approval', true, 'request_id', v_req,
      'message', 'أُرسل إسناد خطّة العمولة لاعتماد المالك. لم يُسنَد شيء بعد.');
  end if;
  return public.crm_commission_assign_core(p, auth.uid());
end $$;

-- ★★ قرار المالك. الاعتماد هو **اللحظة الوحيدة** التي يقع فيها التغيير.
--    فشل التطبيق لا يُخفى: يُحفظ نصّه في apply_error ويبقى الطلب معلَّقًا.
create or replace function public.crm_approval_decide(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_res jsonb; v_applied uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_approve_changes(), false) then raise exception 'not authorized'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  end if;
  select * into r from public.crm_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', r.status);
  end if;

  if p_decision = 'rejected' then
    update public.crm_approval_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p_id;
    perform public.crm_log('approval_rejected', 'crm_approval_request', p_id,
      jsonb_build_object('kind', r.kind, 'note', p_note));
    return jsonb_build_object('ok', true, 'id', p_id, 'status', 'rejected');
  end if;

  -- الاعتماد: يُطبَّق باسم المالك المعتمِد، لا باسم مقدّم الطلب.
  begin
    if r.kind = 'target' then
      v_res := public.crm_target_apply_core(r.payload, auth.uid());
    elsif r.kind = 'target_delete' then
      update public.crm_targets set is_deleted = true, updated_at = now()
       where id = r.entity_id and is_deleted = false;
      v_res := case when found then jsonb_build_object('ok', true, 'id', r.entity_id)
                    else jsonb_build_object('ok', false, 'reason', 'target_not_found') end;
    elsif r.kind = 'commission_plan' then
      v_res := public.crm_commission_plan_apply_core(r.payload, auth.uid());
    elsif r.kind = 'commission_assign' then
      v_res := public.crm_commission_assign_core(r.payload, auth.uid());
    else
      v_res := jsonb_build_object('ok', false, 'reason', 'unknown_kind');
    end if;
  exception when others then
    update public.crm_approval_requests set apply_error = sqlerrm, updated_at = now() where id = p_id;
    perform public.crm_log('approval_apply_failed', 'crm_approval_request', p_id,
      jsonb_build_object('kind', r.kind, 'error', sqlerrm));
    return jsonb_build_object('ok', false, 'reason', 'apply_failed', 'detail', sqlerrm,
      'message', 'تعذّر تطبيق التغيير — بقي الطلب معلَّقًا ولم يتغيّر شيء.');
  end;

  if coalesce((v_res->>'ok')::boolean, false) is not true then
    update public.crm_approval_requests set apply_error = coalesce(v_res->>'reason', 'unknown'), updated_at = now()
     where id = p_id;
    return jsonb_build_object('ok', false, 'reason', coalesce(v_res->>'reason', 'apply_failed'),
      'message', 'رُفض التطبيق لسبب في محتوى الطلب — بقي معلَّقًا ولم يتغيّر شيء.');
  end if;

  v_applied := nullif(btrim(coalesce(v_res->>'id', '')), '')::uuid;
  update public.crm_approval_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         applied_entity_id = v_applied, apply_error = null, updated_at = now()
   where id = p_id;
  perform public.crm_log('approval_approved', 'crm_approval_request', p_id,
    jsonb_build_object('kind', r.kind, 'applied_entity_id', v_applied));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'approved', 'applied_entity_id', v_applied);
end $$;

-- سحب الطلب: صاحبه يسحبه، والمالك يسحب أيّ طلب. لا أحد غيرهما.
create or replace function public.crm_approval_withdraw(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_view(), false) then raise exception 'not authorized'; end if;
  select * into r from public.crm_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
  if r.requested_by <> auth.uid() and not coalesce(public.crm_can_approve_changes(), false) then
    raise exception 'not authorized';
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', r.status);
  end if;
  update public.crm_approval_requests
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_id;
  perform public.crm_log('approval_withdrawn', 'crm_approval_request', p_id,
    jsonb_build_object('kind', r.kind, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'withdrawn');
end $$;

create or replace function public.crm_commission_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_manage_commission(), false) then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('draft','approved','void') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;
  select * into r from public.crm_commission_records where id = p_id and is_deleted = false;
  if not found then raise exception 'record_not_found'; end if;
  if r.user_id = auth.uid() and not coalesce(public.crm_is_owner_role(), false) then
    return jsonb_build_object('ok', false, 'reason', 'self_commission_denied',
      'message', 'لا تعتمد عمولتك بنفسك.');
  end if;
  update public.crm_commission_records set status = p_status, note = nullif(btrim(coalesce(p_note, '')), ''),
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end
  where id = p_id;
  perform public.crm_log('commission_status', 'crm_commission_record', p_id,
    jsonb_build_object('to', p_status, 'user_id', r.user_id));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;

-- ★ الاستيراد: مفتاح تكرار إلزاميّ. إعادة رفع نفس الملفّ بنفس المفتاح تُعيد
--   نتيجة الدفعة الأولى ولا تُدرج صفًّا واحدًا إضافيًّا.
create or replace function public.crm_import_leads(p_rows jsonb, p_idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_batch uuid; v_prev record; r jsonb; v_res jsonb := '[]'::jsonb;
        v_ins int := 0; v_dup int := 0; v_err int := 0; v_id uuid; v_dupc jsonb; v_code text; v_n int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.crm_can_import(), false) then raise exception 'not authorized'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required',
      'message', 'مفتاح تكرار من ٨ محارف فأكثر مطلوب — بدونه يُنتج الرفع المكرّر نسخًا.');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'rows_must_be_array');
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 1000 then return jsonb_build_object('ok', false, 'reason', 'too_many_rows', 'max', 1000); end if;

  select * into v_prev from public.crm_import_batches where idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'batch_id', v_prev.id,
      'inserted', v_prev.inserted_count, 'duplicates', v_prev.duplicate_count,
      'errors', v_prev.error_count, 'result', v_prev.result,
      'message', 'هذه الدفعة مُستوردة سابقًا — أُعيدت نتيجتها كما هي بلا إدراج جديد.');
  end if;

  insert into public.crm_import_batches (idempotency_key, entity, source_label, row_count, created_by)
  values (btrim(p_idempotency_key), 'lead', null, v_n, auth.uid())
  returning id into v_batch;

  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      v_dupc := public.crm_duplicate_core(r->>'email', r->>'phone', r->>'company_name', r->>'contact_name', null);
      if coalesce((v_dupc->>'count')::int, 0) > 0 then
        v_dup := v_dup + 1;
        v_res := v_res || jsonb_build_object('row', r->>'contact_name', 'status', 'duplicate',
          'matches', coalesce((v_dupc->>'count')::int, 0));
      else
        v_code := public.crm_next_code('LEAD');
        insert into public.crm_leads (lead_code, company_name, contact_name, email, phone, city,
          industry, source, source_detail, status, notes, owner_user_id, import_batch_id,
          external_ref, created_by)
        values (v_code,
          nullif(btrim(coalesce(r->>'company_name', '')), ''),
          coalesce(nullif(btrim(coalesce(r->>'contact_name', '')), ''), 'عميل مستورد'),
          nullif(btrim(coalesce(r->>'email', '')), ''),
          nullif(btrim(coalesce(r->>'phone', '')), ''),
          nullif(btrim(coalesce(r->>'city', '')), ''),
          nullif(btrim(coalesce(r->>'industry', '')), ''),
          'import', nullif(btrim(coalesce(r->>'source_detail', '')), ''),
          'new', nullif(btrim(coalesce(r->>'notes', '')), ''),
          auth.uid(), v_batch,
          nullif(btrim(coalesce(r->>'external_ref', '')), ''), auth.uid())
        returning id into v_id;
        v_ins := v_ins + 1;
        v_res := v_res || jsonb_build_object('row', r->>'contact_name', 'status', 'inserted', 'id', v_id);
      end if;
    exception when others then
      v_err := v_err + 1;
      v_res := v_res || jsonb_build_object('row', r->>'contact_name', 'status', 'error', 'detail', sqlerrm);
    end;
  end loop;

  update public.crm_import_batches set inserted_count = v_ins, duplicate_count = v_dup,
    error_count = v_err, result = jsonb_build_object('rows', v_res)
  where id = v_batch;

  perform public.crm_log('import_leads', 'crm_import_batch', v_batch,
    jsonb_build_object('rows', v_n, 'inserted', v_ins, 'duplicates', v_dup, 'errors', v_err));
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'rows', v_n, 'inserted', v_ins,
    'duplicates', v_dup, 'errors', v_err, 'result', jsonb_build_object('rows', v_res));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) الصلاحيات — لا شيء لـanon، أبدًا. الجداول قراءة فقط عبر RLS.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  -- (أ) الدوالّ العامّة: authenticated فقط.
  foreach f in array array[
    'public.crm_access()',
    'public.crm_lookups()',
    'public.crm_leads_list(jsonb)',
    'public.crm_lead_detail(uuid)',
    'public.crm_duplicates(jsonb)',
    'public.crm_opportunities_list(jsonb)',
    'public.crm_opportunity_detail(uuid)',
    'public.crm_pipeline_board(jsonb)',
    'public.crm_forecast(jsonb)',
    'public.crm_stale_alerts(jsonb)',
    'public.crm_activities_list(jsonb)',
    'public.crm_targets_list(jsonb)',
    'public.crm_commission_list(jsonb)',
    'public.crm_dashboard(jsonb)',
    'public.crm_export(text,jsonb)',
    'public.crm_audit_list(jsonb)',
    'public.crm_approvals_list(jsonb)',
    'public.crm_import_preview(jsonb,text)',
    'public.crm_approval_decide(uuid,text,text)',
    'public.crm_approval_withdraw(uuid,text)',
    'public.crm_company_upsert(jsonb)',
    'public.crm_contact_upsert(jsonb)',
    'public.crm_competitor_upsert(jsonb)',
    'public.crm_lead_upsert(jsonb)',
    'public.crm_lead_set_status(uuid,text,text)',
    'public.crm_lead_score_adjust(jsonb)',
    'public.crm_lead_convert(uuid,jsonb)',
    'public.crm_lead_delete(uuid,text)',
    'public.crm_opportunity_upsert(jsonb)',
    'public.crm_opportunity_link_quote(uuid,uuid)',
    'public.crm_opportunity_set_stage(uuid,uuid,text)',
    'public.crm_opportunity_close(uuid,text,jsonb)',
    'public.crm_opportunity_reopen(uuid,text)',
    'public.crm_opportunity_delete(uuid,text)',
    'public.crm_handoff_confirm(uuid,jsonb)',
    'public.crm_activity_log(jsonb)',
    'public.crm_activity_delete(uuid,text)',
    'public.crm_score_rule_upsert(jsonb)',
    'public.crm_settings_set(text,jsonb)',
    'public.crm_team_upsert(jsonb)',
    'public.crm_team_member_set(jsonb)',
    'public.crm_target_upsert(jsonb)',
    'public.crm_target_delete(uuid,text)',
    'public.crm_commission_recalc(uuid)',
    'public.crm_commission_plan_upsert(jsonb)',
    'public.crm_commission_assign(jsonb)',
    'public.crm_commission_set_status(uuid,text,text)',
    'public.crm_import_leads(jsonb,text)',
    -- المُسنَدات: تُقيَّم داخل سياسات RLS بدور المُنادي، فلا بدّ من EXECUTE له.
    'public.crm_can_view()',
    'public.crm_can_manage()',
    'public.crm_is_client()',
    'public.crm_is_owner_role()',
    'public.crm_can_view_team()',
    'public.crm_can_see_owner(uuid)',
    'public.crm_can_read_lead(uuid)',
    'public.crm_can_edit_lead(uuid)',
    'public.crm_can_read_opportunity(uuid)',
    'public.crm_can_edit_opportunity(uuid)',
    'public.crm_can_read_activity(uuid)',
    'public.crm_can_view_commission(uuid)',
    'public.crm_can_manage_commission()',
    'public.crm_can_manage_targets()',
    'public.crm_can_approve_changes()',
    'public.crm_can_manage_pipeline()',
    'public.crm_can_manage_scoring()',
    'public.crm_can_import()',
    'public.crm_perm(text)',
    'public.crm_perm_key_exists(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ب) الدوالّ الداخلية: لا تُمنح لأحد — تُنفَّذ ضمن سلسلة SECURITY DEFINER فقط.
  foreach f in array array[
    'public.crm_log(text,text,uuid,jsonb)',
    'public.crm_notify(uuid,text,uuid,text,text)',
    'public.crm_norm_text(text)',
    'public.crm_norm_email(text)',
    'public.crm_norm_phone(text)',
    'public.crm_setting_int(text,integer)',
    'public.crm_setting_text(text,text)',
    'public.crm_project_label(uuid)',
    'public.crm_quote_ref(uuid)',
    'public.crm_next_code(text)',
    'public.crm_score_core(uuid)',
    'public.crm_duplicate_core(text,text,text,text,uuid)',
    'public.crm_readiness_core(uuid)',
    'public.crm_visible_leads()',
    'public.crm_visible_opportunities()',
    'public.crm_commission_recalc_core(uuid)',
    'public.crm_approval_submit_core(text,uuid,uuid,jsonb,text)',
    'public.crm_target_apply_core(jsonb,uuid)',
    'public.crm_commission_plan_apply_core(jsonb,uuid)',
    'public.crm_commission_assign_core(jsonb,uuid)',
    'public.crm_normalize_lead()',
    'public.crm_normalize_contact()',
    'public.crm_normalize_company()',
    'public.crm_normalize_competitor()',
    'public.crm_touch()'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ج) الجداول: قراءة فقط لـauthenticated (وRLS هي الفاصل)، ولا شيء لـanon.
  foreach t in array array['crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts',
    'crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities',
    'crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments',
    'crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;

  foreach t in array array['crm_lead_code_seq','crm_opportunity_code_seq'] loop
    execute format('revoke all on sequence public.%I from public', t);
    begin execute format('revoke all on sequence public.%I from anon', t); exception when undefined_object then null; end;
    begin execute format('revoke all on sequence public.%I from authenticated', t); exception when undefined_object then null; end;
  end loop;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) SELF-TEST — ثابت. لا يستدعي دالّة محميّة (auth.uid() = NULL في المحرّر)،
--      ولا يلتفّ حول فحص بمصيدة تجعله ينجح مهما حدث. الفشل يُلغي المعاملة.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare t text; f text; v_def text; v jsonb; v_b boolean; v_n bigint;
  v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  v_authr boolean := exists (select 1 from pg_roles where rolname = 'authenticated');
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
  TABLES constant text[] := array['crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts',
    'crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities',
    'crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments',
    'crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests'];
  WRITE_FNS constant text[] := array[
    'public.crm_company_upsert(jsonb)','public.crm_contact_upsert(jsonb)','public.crm_competitor_upsert(jsonb)',
    'public.crm_lead_upsert(jsonb)','public.crm_lead_set_status(uuid,text,text)','public.crm_lead_score_adjust(jsonb)',
    'public.crm_lead_convert(uuid,jsonb)','public.crm_lead_delete(uuid,text)','public.crm_opportunity_upsert(jsonb)',
    'public.crm_opportunity_link_quote(uuid,uuid)','public.crm_opportunity_set_stage(uuid,uuid,text)',
    'public.crm_opportunity_close(uuid,text,jsonb)','public.crm_opportunity_reopen(uuid,text)',
    'public.crm_opportunity_delete(uuid,text)','public.crm_handoff_confirm(uuid,jsonb)',
    'public.crm_activity_log(jsonb)','public.crm_activity_delete(uuid,text)','public.crm_score_rule_upsert(jsonb)',
    'public.crm_settings_set(text,jsonb)','public.crm_team_upsert(jsonb)','public.crm_team_member_set(jsonb)',
    'public.crm_target_upsert(jsonb)','public.crm_target_delete(uuid,text)','public.crm_commission_recalc(uuid)',
    'public.crm_commission_plan_upsert(jsonb)','public.crm_commission_assign(jsonb)',
    'public.crm_commission_set_status(uuid,text,text)','public.crm_import_leads(jsonb,text)',
    'public.crm_approval_decide(uuid,text,text)','public.crm_approval_withdraw(uuid,text)'];
begin
  -- (1) الجداول · RLS · لا سياسة كتابة · لا anon
  foreach t in array TABLES loop
    if to_regclass('public.' || t) is null then raise exception 'CRM SELF-TEST: الجدول % لم يُنشأ', t; end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = t) then
      raise exception 'CRM SELF-TEST: RLS غير مفعّلة على %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT') then
      raise exception 'CRM SELF-TEST: توجد سياسة كتابة مباشرة على % — الكتابة يجب أن تمرّ بـRPC', t;
    end if;
    if v_anon and exists (select 1 from information_schema.role_table_grants
                           where table_schema = 'public' and table_name = t and grantee = 'anon') then
      raise exception 'CRM SELF-TEST: anon يملك صلاحية على %', t;
    end if;
  end loop;

  -- (2) الدوالّ موجودة ولا anon عليها
  foreach f in array WRITE_FNS || array[
    'public.crm_access()','public.crm_lookups()','public.crm_leads_list(jsonb)','public.crm_lead_detail(uuid)',
    'public.crm_duplicates(jsonb)','public.crm_opportunities_list(jsonb)','public.crm_opportunity_detail(uuid)',
    'public.crm_pipeline_board(jsonb)','public.crm_forecast(jsonb)','public.crm_stale_alerts(jsonb)',
    'public.crm_activities_list(jsonb)','public.crm_targets_list(jsonb)','public.crm_commission_list(jsonb)',
    'public.crm_dashboard(jsonb)','public.crm_export(text,jsonb)','public.crm_audit_list(jsonb)',
    'public.crm_approvals_list(jsonb)','public.crm_import_preview(jsonb,text)'] loop
    if to_regprocedure(f) is null then raise exception 'CRM SELF-TEST: الدالّة % لم تُنشأ', f; end if;
    if v_anon and has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'CRM SELF-TEST: anon يملك EXECUTE على %', f;
    end if;
  end loop;

  -- (3) الدوالّ الداخلية ممنوعة على authenticated
  foreach f in array array['public.crm_log(text,text,uuid,jsonb)','public.crm_visible_leads()',
    'public.crm_visible_opportunities()','public.crm_score_core(uuid)','public.crm_readiness_core(uuid)',
    'public.crm_duplicate_core(text,text,text,text,uuid)','public.crm_commission_recalc_core(uuid)',
    'public.crm_next_code(text)',
    'public.crm_approval_submit_core(text,uuid,uuid,jsonb,text)','public.crm_target_apply_core(jsonb,uuid)',
    'public.crm_commission_plan_apply_core(jsonb,uuid)','public.crm_commission_assign_core(jsonb,uuid)'] loop
    if v_authr and has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'CRM SELF-TEST: authenticated يملك EXECUTE على دالّة داخلية %', f;
    end if;
  end loop;

  -- (4) المُسنَدات: تُستدعى حيًّا لأنّها لا ترفع استثناءً. بلا جلسة يجب أن تعيد
  --     false — لا NULL ولا true. NULL هنا هو بالضبط ما سبّب حادثة fail-open.
  v_b := public.crm_can_view();        if v_b is null then raise exception 'CRM SELF-TEST: can_view أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_view = true بلا جلسة — fail-open'; end if;
  v_b := public.crm_can_manage();      if v_b is null then raise exception 'CRM SELF-TEST: can_manage أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_manage = true بلا جلسة — fail-open'; end if;
  v_b := public.crm_is_client();       if v_b is null then raise exception 'CRM SELF-TEST: is_client أعادت NULL'; end if;
  v_b := public.crm_is_owner_role();   if v_b is null then raise exception 'CRM SELF-TEST: is_owner_role أعادت NULL'; end if;
  v_b := public.crm_can_view_team();   if v_b is null then raise exception 'CRM SELF-TEST: can_view_team أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_view_team = true بلا جلسة'; end if;
  v_b := public.crm_can_see_owner(ZERO);          if v_b is null then raise exception 'CRM SELF-TEST: can_see_owner أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_see_owner = true بلا جلسة'; end if;
  v_b := public.crm_can_see_owner(null);          if v_b is null then raise exception 'CRM SELF-TEST: can_see_owner(NULL) أعادت NULL'; end if;
  v_b := public.crm_can_read_lead(ZERO);          if v_b is null then raise exception 'CRM SELF-TEST: can_read_lead أعادت NULL'; end if;
  v_b := public.crm_can_read_lead(null);          if v_b is null then raise exception 'CRM SELF-TEST: can_read_lead(NULL) أعادت NULL'; end if;
  v_b := public.crm_can_edit_lead(ZERO);          if v_b is null then raise exception 'CRM SELF-TEST: can_edit_lead أعادت NULL'; end if;
  v_b := public.crm_can_read_opportunity(ZERO);   if v_b is null then raise exception 'CRM SELF-TEST: can_read_opportunity أعادت NULL'; end if;
  v_b := public.crm_can_edit_opportunity(ZERO);   if v_b is null then raise exception 'CRM SELF-TEST: can_edit_opportunity أعادت NULL'; end if;
  v_b := public.crm_can_read_activity(ZERO);      if v_b is null then raise exception 'CRM SELF-TEST: can_read_activity أعادت NULL'; end if;
  v_b := public.crm_can_view_commission(null);    if v_b is null then raise exception 'CRM SELF-TEST: can_view_commission أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_view_commission = true بلا جلسة'; end if;
  v_b := public.crm_can_view_commission(ZERO);    if v_b is null then raise exception 'CRM SELF-TEST: can_view_commission(uuid) أعادت NULL'; end if;
  v_b := public.crm_can_manage_commission();      if v_b is null then raise exception 'CRM SELF-TEST: can_manage_commission أعادت NULL'; end if;
  v_b := public.crm_can_manage_targets();         if v_b is null then raise exception 'CRM SELF-TEST: can_manage_targets أعادت NULL'; end if;
  v_b := public.crm_can_manage_pipeline();        if v_b is null then raise exception 'CRM SELF-TEST: can_manage_pipeline أعادت NULL'; end if;
  v_b := public.crm_can_manage_scoring();         if v_b is null then raise exception 'CRM SELF-TEST: can_manage_scoring أعادت NULL'; end if;
  v_b := public.crm_can_import();                 if v_b is null then raise exception 'CRM SELF-TEST: can_import أعادت NULL'; end if;
  v_b := public.crm_perm('crm.manage');           if v_b is null then raise exception 'CRM SELF-TEST: perm أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: perm = true بلا جلسة'; end if;
  v_b := public.crm_perm_key_exists('crm.view_team');
  if v_b is null then raise exception 'CRM SELF-TEST: perm_key_exists أعادت NULL'; end if;

  -- (5) مِجَسّ الكشف ينجح لأيّ جلسة ولا يمنح شيئًا بلا جلسة
  v := public.crm_access();
  if coalesce((v->>'ok')::boolean, false) is not true then raise exception 'CRM SELF-TEST: access لم تُرجع ok'; end if;
  if coalesce((v->>'can_view')::boolean, false) then raise exception 'CRM SELF-TEST: access تمنح can_view بلا جلسة'; end if;

  -- (6) كلّ دالّة كتابة: بوّابة جلسة · منع صريح · SECURITY DEFINER · search_path
  foreach f in array WRITE_FNS loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%auth.uid() is null%' then raise exception 'CRM SELF-TEST: % بلا بوّابة جلسة', f; end if;
    if v_def not ilike '%not authorized%' then raise exception 'CRM SELF-TEST: % لا ترفع منعًا صريحًا', f; end if;
    if v_def not ilike '%security definer%' then raise exception 'CRM SELF-TEST: % ليست SECURITY DEFINER', f; end if;
    if v_def not ilike '%search_path%' then raise exception 'CRM SELF-TEST: % بلا search_path مثبَّت', f; end if;
    if v_def not ilike '%crm_log(%' then raise exception 'CRM SELF-TEST: % بلا تدقيق', f; end if;
  end loop;

  -- (7) بوّابة العرض تستبعد العميل، والموديول لا يتّكئ على can_manage_projects
  v_def := pg_get_functiondef(to_regprocedure('public.crm_can_view()'));
  if v_def not ilike '%is_staff%' then raise exception 'CRM SELF-TEST: بوّابة العرض لا تستبعد العميل'; end if;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'crm\_%' loop
    if pg_get_functiondef(to_regprocedure(f)) ilike '%can_manage_projects%' then
      raise exception 'CRM SELF-TEST: % تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته', f;
    end if;
  end loop;

  -- (8) ★★ تجميد منصّة المشاريع: لا دالّة واحدة تكتب فيها. ولا في quote_requests.
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'crm\_%' loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(projects|project_core|deliverables|deliverable_internal|project_transition_requests|project_members)\b' then
      raise exception 'CRM SELF-TEST: % تكتب في منصّة المشاريع المجمَّدة', f;
    end if;
    if v_def ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?quote_requests\b' then
      raise exception 'CRM SELF-TEST: % تكتب في quote_requests — المرجع للقراءة فقط', f;
    end if;
  end loop;

  -- (9) ★ عقد التسليم: تسجيل لا إنشاء
  v_def := pg_get_functiondef(to_regprocedure('public.crm_handoff_confirm(uuid,jsonb)'));
  if v_def not ilike '%manually_created%' then raise exception 'CRM SELF-TEST: التسليم لا يسجّل الإنشاء اليدويّ'; end if;
  if v_def not ilike '%crm_can_read_opportunity(p_opp)%' then
    raise exception 'CRM SELF-TEST: مفتاح crm.handoff يكتب على فرصة لا يراها صاحبه'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.crm_opportunity_close(uuid,text,jsonb)'));
  if v_def not ilike '%ready_for_manual_creation%' then
    raise exception 'CRM SELF-TEST: الربح لا يسجّل الجاهزية للإنشاء اليدويّ'; end if;
  if v_def not ilike '%lost_reason_required%' then
    raise exception 'CRM SELF-TEST: الخسارة تُقبل بلا سبب'; end if;

  -- (10) ★ العمولة: crm.manage لا يمنحها. مفتاح مستقلّ، ومنع تعيين الذات.
  v_def := pg_get_functiondef(to_regprocedure('public.crm_can_view_commission(uuid)'));
  if v_def not ilike '%crm.view_commission%' then
    raise exception 'CRM SELF-TEST: رؤية العمولة بلا مفتاحها الخاصّ'; end if;
  if v_def ilike '%crm_can_manage()%' then
    raise exception 'CRM SELF-TEST: crm.manage يمنح رؤية عمولات الآخرين — فصل الصلاحيات منتهك'; end if;
  if pg_get_functiondef(to_regprocedure('public.crm_commission_assign(jsonb)')) not ilike '%self_commission_denied%' then
    raise exception 'CRM SELF-TEST: يمكن إسناد خطّة عمولة للنفس'; end if;
  if pg_get_functiondef(to_regprocedure('public.crm_commission_set_status(uuid,text,text)')) not ilike '%self_commission_denied%' then
    raise exception 'CRM SELF-TEST: يمكن اعتماد عمولة النفس'; end if;

  -- (10-ب) ★ مفردة الأساس = المُنفَّذ، لا أكثر ★
  --   ثلاثة فحوص متعاضدة: القيد ضيّق، والكتابة ترفض صراحةً، والحاسبة لا تلمس
  --   المالية. لو نُفِّذ gross_margin يومًا داخل المبيعات لسقط الفحص الثالث —
  --   وهذا هو المقصود: العمولة على الهامش تعني تكلفةً داخل موديول المبيعات.
  if not exists (
    select 1 from pg_constraint con
     where con.conrelid = 'public.crm_commission_plans'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%basis%'
       and pg_get_constraintdef(con.oid) ilike '%won_value%'
       and pg_get_constraintdef(con.oid) not ilike '%gross_margin%'
       and pg_get_constraintdef(con.oid) not ilike '%collected_value%') then
    raise exception 'CRM SELF-TEST: قيد أساس العمولة ما زال يقبل مفردة غير منفَّذة — سجلّ عمولة يُوسَم بالهامش وقيمته قيمة الفرصة';
  end if;
  if pg_get_functiondef(to_regprocedure('public.crm_commission_plan_apply_core(jsonb,uuid)'))
     not ilike '%basis_not_implemented%' then
    raise exception 'CRM SELF-TEST: كتابة خطّة العمولة لا ترفض الأساس غير المنفَّذ صراحةً'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.crm_commission_recalc_core(uuid)'));
  if v_def ilike '%fin\_%' or v_def ilike '%finops\_%' then
    raise exception 'CRM SELF-TEST: حاسبة العمولة تقرأ المالية — التكلفة دخلت المبيعات وانفتح استنتاج الربح'; end if;
  if v_def not ilike '%estimated_value%' then
    raise exception 'CRM SELF-TEST: حاسبة العمولة لا تحسب من قيمة الفرصة كما تُعلن'; end if;

  -- (11) ★ الأهداف: لا تحرير للهدف الذاتيّ
  if pg_get_functiondef(to_regprocedure('public.crm_target_upsert(jsonb)')) not ilike '%self_target_denied%' then
    raise exception 'CRM SELF-TEST: الموظّف يستطيع تحرير هدفه'; end if;
  if pg_get_functiondef(to_regprocedure('public.crm_target_delete(uuid,text)')) not ilike '%self_target_denied%' then
    raise exception 'CRM SELF-TEST: الموظّف يستطيع حذف هدفه'; end if;

  -- (12) ★ الدرجة مشتقّة لا محفوظة، ومعلَّلة ببنودها
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'crm_leads' and column_name = 'score') then
    raise exception 'CRM SELF-TEST: درجة العميل محفوظة كعمود — يجب أن تبقى مشتقّة'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.crm_score_core(uuid)'));
  if v_def not ilike '%components%' then raise exception 'CRM SELF-TEST: الدرجة بلا تفصيل بنودها — صندوق أسود'; end if;
  if v_def not ilike '%crm_lead_score_rules%' then
    raise exception 'CRM SELF-TEST: الدرجة لا تقرأ جدول القواعد القابل للتحرير'; end if;

  -- (13) ★ كشف التكرار والـidempotency
  if pg_get_functiondef(to_regprocedure('public.crm_lead_upsert(jsonb)')) not ilike '%duplicate_suspected%' then
    raise exception 'CRM SELF-TEST: إنشاء العميل بلا كشف تكرار'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.crm_import_leads(jsonb,text)'));
  if v_def not ilike '%idempotency_key%' then raise exception 'CRM SELF-TEST: الاستيراد بلا مفتاح تكرار'; end if;
  if v_def not ilike '%idempotent%' then raise exception 'CRM SELF-TEST: الاستيراد لا يعيد نتيجة الدفعة السابقة'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_crm_lead_external') then
    raise exception 'CRM SELF-TEST: لا فهرس فريد على المرجع الخارجيّ'; end if;

  -- (14) البذور موجودة ومعقولة
  select count(*) into v_n from public.crm_pipelines where key = 'default';
  if v_n <> 1 then raise exception 'CRM SELF-TEST: خطّ الأنابيب الافتراضيّ غير مبذور'; end if;
  select count(*) into v_n from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id
   where p.key = 'default';
  if v_n < 7 then raise exception 'CRM SELF-TEST: المراحل المبذورة % أقلّ من سبع', v_n; end if;
  select count(*) into v_n from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id
   where p.key = 'default' and s.is_won;
  if v_n <> 1 then raise exception 'CRM SELF-TEST: يجب أن تكون مرحلة ربح واحدة بالضبط'; end if;
  select count(*) into v_n from public.crm_lead_score_rules;
  if v_n < 12 then raise exception 'CRM SELF-TEST: قواعد الدرجة المبذورة % أقلّ من اثنتي عشرة', v_n; end if;
  select count(*) into v_n from public.crm_settings;
  if v_n < 6 then raise exception 'CRM SELF-TEST: إعدادات الموديول ناقصة'; end if;

  -- (15) الترحيلة لم تُنشئ بيانات عمل. now() ثابت داخل المعاملة، فأيّ صفّ
  --      created_at = now() هو صفّ أنشأته هذه الترحيلة تحديدًا — والفحص يبقى
  --      صحيحًا عند إعادة التشغيل فوق بيانات حقيقية.
  select count(*) into v_n from public.crm_leads where created_at = now();
  if v_n <> 0 then raise exception 'CRM SELF-TEST: الترحيلة أنشأت % عميلًا — يجب ألّا تُنشئ شيئًا', v_n; end if;
  select count(*) into v_n from public.crm_opportunities where created_at = now();
  if v_n <> 0 then raise exception 'CRM SELF-TEST: الترحيلة أنشأت % فرصة', v_n; end if;
  select count(*) into v_n from public.crm_audit where created_at = now();
  if v_n <> 0 then raise exception 'CRM SELF-TEST: الترحيلة كتبت في سجلّ التدقيق'; end if;

  -- (16) التطبيع يعمل فعلًا على العربية (وهو أساس كشف التكرار)
  if public.crm_norm_text('شركة  الكِيان') is distinct from public.crm_norm_text('شركه الكيان') then
    raise exception 'CRM SELF-TEST: التطبيع العربيّ لا يوحّد التاء المربوطة/التشكيل';
  end if;
  if public.crm_norm_phone('+966 55 123 4567') is distinct from public.crm_norm_phone('0551234567') then
    raise exception 'CRM SELF-TEST: تطبيع الهاتف لا يوحّد الصيغة الدولية والمحلّية';
  end if;
  if public.crm_norm_phone('12345') is not null then
    raise exception 'CRM SELF-TEST: تطبيع الهاتف يقبل رقمًا قصيرًا فيُنتج مطابقات كاذبة';
  end if;
  if public.crm_norm_email('  Sales@Kian.SA ') is distinct from 'sales@kian.sa' then
    raise exception 'CRM SELF-TEST: تطبيع البريد لا يوحّد الحالة/المسافات';
  end if;

  -- (17) الجاهزية والتنبّؤ يبلّغان بصدق عن غير الموجود
  v := public.crm_readiness_core(ZERO);
  if coalesce(v->>'reason', '') <> 'opportunity_not_found' then
    raise exception 'CRM SELF-TEST: الجاهزية لا تُبلّغ عن فرصة غير موجودة بصدق'; end if;
  v := public.crm_score_core(ZERO);
  if coalesce(v->>'reason', '') <> 'lead_not_found' then
    raise exception 'CRM SELF-TEST: الدرجة لا تُبلّغ عن عميل غير موجود بصدق'; end if;

  -- (18) المُشغِّلات موجودة — التطبيع لا يُترك لحسن نيّة المُدرِج
  foreach t in array array['t_crm_lead_norm','t_crm_contact_norm','t_crm_company_norm','t_crm_competitor_norm'] loop
    if not exists (select 1 from pg_trigger where tgname = t and not tgisinternal) then
      raise exception 'CRM SELF-TEST: المُشغِّل % غير موجود', t;
    end if;
  end loop;

  -- (19) ★★ موافقة المالك على الهدف وقاعدة العمولة — بنيويّة لا وعدًا في وثيقة.
  v_b := public.crm_can_approve_changes();
  if v_b is null then raise exception 'CRM SELF-TEST: can_approve_changes أعادت NULL'; end if;
  if v_b then raise exception 'CRM SELF-TEST: can_approve_changes = true بلا جلسة — fail-open'; end if;
  -- الاعتماد لا يُشترى بمفتاح: المُسنَد لا يمرّ عبر crm_perm إطلاقًا.
  v_def := pg_get_functiondef(to_regprocedure('public.crm_can_approve_changes()'));
  if v_def ilike '%crm_perm%' then
    raise exception 'CRM SELF-TEST: اعتماد المالك يُمنح بمفتاح صلاحية — لم تعد موافقة مالك';
  end if;
  if v_def not ilike '%crm_is_owner_role%' then
    raise exception 'CRM SELF-TEST: اعتماد التغييرات لا يشترط دور المالك';
  end if;
  -- كلّ مسار يغيّر هدفًا أو قاعدة عمولة يمرّ على البوّابة نفسها.
  foreach f in array array['public.crm_target_upsert(jsonb)','public.crm_target_delete(uuid,text)',
                           'public.crm_commission_plan_upsert(jsonb)','public.crm_commission_assign(jsonb)'] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%crm_can_approve_changes()%' then
      raise exception 'CRM SELF-TEST: % تغيّر هدفًا/عمولة بلا بوّابة اعتماد المالك', f;
    end if;
    if v_def not ilike '%pending_approval%' then
      raise exception 'CRM SELF-TEST: % لا تُبلّغ بصدق أنّ التغيير معلَّق', f;
    end if;
  end loop;
  -- القرار يُطبَّق باسم المعتمِد، ولا يُطبَّق مرّتين.
  v_def := pg_get_functiondef(to_regprocedure('public.crm_approval_decide(uuid,text,text)'));
  if v_def not ilike '%already_decided%' then
    raise exception 'CRM SELF-TEST: قرار الاعتماد يمكن تكراره على الطلب نفسه'; end if;
  if v_def not ilike '%crm_target_apply_core%' or v_def not ilike '%crm_commission_plan_apply_core%' then
    raise exception 'CRM SELF-TEST: الاعتماد لا يُطبّق عبر النوى المشتركة'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename = 'crm_approval_requests' and cmd = 'SELECT'
              and coalesce(qual, '') not ilike '%crm_can_approve_changes%') then
    raise exception 'CRM SELF-TEST: سياسة قراءة طلبات الاعتماد لا تفرّق المالك عن غيره';
  end if;

  -- (20) ★★ معاينة الاستيراد تشغيل جافّ فعليّ — الضمانة من PostgreSQL نفسه.
  -- coalesce إلى قيمة مستحيلة عمدًا: دالّة غائبة يجب أن **تُفشِل** الفحص لا أن
  -- تجعله يمرّ بـNULL. الفحص الذي ينجح عند غياب هدفه ليس فحصًا.
  if coalesce((select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'crm_import_preview'), 'x') <> 's' then
    raise exception 'CRM SELF-TEST: crm_import_preview غائبة أو ليست STABLE — لا شيء يمنعها من الكتابة';
  end if;
  v_def := pg_get_functiondef(to_regprocedure('public.crm_import_preview(jsonb,text)'));
  if v_def ~* '(insert\s+into|update\s+public|delete\s+from)' then
    raise exception 'CRM SELF-TEST: معاينة الاستيراد تكتب — لم تعد معاينة';
  end if;
  if v_def not ilike '%wrote_nothing%' then
    raise exception 'CRM SELF-TEST: المعاينة لا تُصرّح بأنّها لم تكتب شيئًا';
  end if;
  if v_def not ilike '%duplicate_within_file%' then
    raise exception 'CRM SELF-TEST: المعاينة لا تكشف التكرار داخل الملفّ نفسه';
  end if;
  -- ⚠️ عمدًا بلا استدعاء حيّ للمعاينة: هي محميّة بـauth.uid()، ومحرّر SQL يعمل
  --    بـauth.uid() = NULL، فاستدعاؤها هنا يرفع "not authorized" ويُسقط الترحيلة.
  --    الفحص أعلاه بنيويّ (provolatile + نصّ التعريف) وهو أقوى من نداء واحد.

  -- ★ الإشعار لا يُفقد بصمت ★
  --   (أ) القيد يقبل entity_type الخاصّ بهذا الموديول فعلًا.
  --   يُفحص **كلّ** قيد CHECK يقيّد entity_type مهما كان اسمه.
  select coalesce(string_agg(pg_get_constraintdef(con.oid), ' | '), '') into v_def
    from pg_constraint con
   where con.conrelid = to_regclass('public.notifications')
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%entity_type%'
     and pg_get_constraintdef(con.oid) not ilike '%~%'
     and pg_get_constraintdef(con.oid) not ilike '%crm_opportunity%';
  if v_def <> '' then
    raise exception 'CRM SELF-TEST: قيد على notifications.entity_type ما زال تعدادًا لا يقبل crm_opportunity (%). كلّ إشعار مبيعات سيُرفض ويُبتلَع.', v_def;
  end if;
  --   (ب) والمصيدة تكتب أثرًا بدل أن تبتلع.
  v_def := pg_get_functiondef(to_regprocedure('public.crm_notify(uuid,text,uuid,text,text)'));
  if v_def not ilike '%notify_failed%' then
    raise exception 'CRM SELF-TEST: فشل الإشعار يُبتلَع بلا أثر'; end if;

  raise notice 'CRM SELF-TEST: نجح — 20 جدولًا، RLS قراءة فقط، لا anon، مُسنَدات لا تعيد NULL، عمولات معزولة، أهداف بموافقة المالك، استيراد بمعاينة جافّة، الإشعار لا يُفقد بصمت، والمنصّة لم تُمَسّ.';
end $st$;

commit;

-- PostgREST يخزّن المخطّط في ذاكرته: بلا هذا السطر ستقرأ الواجهة PGRST202
-- كاذبًا وتعرض «الترحيلة غير مطبّقة» بعد ترحيلة ناجحة.
notify pgrst, 'reload schema';





