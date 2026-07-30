-- ════════════════════════════════════════════════════════════════════════════
-- docs/talent_vendor_network_RUNME.sql
-- المراحل ٩–١٢ — شبكة المواهب والمستقلّين والمورّدين.
--
-- معاملة واحدة · idempotent · لا CONCURRENTLY · لا anon · SECURITY DEFINER مع
-- search_path مثبَّت · كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا.
--
-- ─── ★ قرار إعادة الاستخدام مقابل الإنشاء — يُقرأ قبل أيّ شيء ★ ────────────
--  ما أُعيد استخدامه ولم يُكرَّر:
--   • public.custody_vendors — دفتر المورّدين الشرائيّ القائم (اسم/تواصل/zoho).
--     لم يُنشأ جدول مورّدين ثانٍ. أضفنا عمودًا واحدًا اختياريًّا
--     custody_vendors.tvn_profile_id يربط صفّ الشراء بملفّ الشبكة، فيبقى
--     المورّد كيانًا واحدًا. لو غاب الجدول (ترقيع custody_enterprise_07 غير
--     مطبَّق) نتخطّى الجسر بلطف ولا نفشل.
--   • public.opportunity_requests — سطح الفرص العامّ. **لم يُمسّ حرفًا**، ولا
--     مُشغِّل عليه، ولا قراءة تلقائية منه. الترقية إلى الشبكة يدويّة بالكامل
--     عبر tvn_promote_opportunity، ولا ترسل بريدًا: ثغرة مرحّل البريد
--     المجهول أُغلقت وتبقى مغلقة.
--   • public.custody_inventory_assets — مالك محتمل لوثيقة (ضمان/تأمين/رخصة).
--     سجلّ الوثائق يشير إليه ولا ينسخ أصلًا واحدًا.
--   • مركز الاتصالات comms_* — قناة الأحداث الوحيدة. لا طابور بريد جديد.
--   • permissions / emp_has_permission — كتالوج الصلاحيات المشترك.
--
--  ما أُنشئ، ولماذا لم يكن هناك مكان يحمله:
--   • tvn_profiles وتوابعها — لا شيء في المستودع يحمل مهنة/مهارة/لغة/تغطية
--     مدن/معدّات مملوكة/سيرة/سياسة سفر لشخص خارجيّ. custody_vendors يحمل
--     اسمًا وهاتفًا فقط؛ توسيعه ليحمل ثلاثة عشر نوعًا من الملفّات كان سيحوّل
--     دفتر شراء إلى سجلّ أفراد.
--   • tvn_profile_rates / _bank / _restricted — **جداول منفصلة عمدًا**. لو
--     كانت أعمدةً في الملفّ لكانت أيّ SELECT على الملفّ تسريبًا للأجر أو
--     للبيانات البنكية. الفصل يجعل المنع بنيويًّا لا اجتهاديًّا.
--   • tvn_availability / _documents / _assignments / _reviews — لا مقابل لها.
--     (custody_inventory_reservations تحجز **أصلًا**، لا إنسانًا.)
--
--  ⛔ ما لم يُنشأ عمدًا: لا جدول أصول جديد، ولا جدول مورّدين ثانٍ، ولا نسخة
--     ثانية من الفرص. مصدر الحقيقة واحد لكلّ مفهوم.
--
-- ─── ★ الأجر والبيانات البنكية ★ ────────────────────────────────────────────
--   الأجر يُقرأ فقط عبر can_view_vendor_rates(). طاقم العمل والعميل لا يريان
--   رقمًا أبدًا — ولا حتّى صفرًا بدل الرقم: الحقل يعود null مع rates_visible=false
--   كي لا يُقرأ «غير مصرّح» على أنّه «مجّانًا».
--   البيانات البنكية **بيانات وصفية فقط**: اسم المصرف وآخر أربعة أرقام. لا
--   IBAN كامل في قاعدة البيانات، بقيد يمنع أكثر من أربعة محارف.
--
-- ─── ★ الجندر ★ ─────────────────────────────────────────────────────────────
--   يُخزَّن في tvn_profile_restricted وحده، ومعه gender_purpose إلزاميّ (٢٠
--   حرفًا فأكثر) يوثّق الحاجة التشغيلية (مثال: أطقم فعاليات منفصلة). لا يدخل
--   أيّ مسار ترشيح أو تقييم أو ترتيب، ولا يظهر في tvn_profile_get العامّ.
--   اختبار tests/talent_gender_safety.test.js يفشل إن ظهر في أيّ مسار تقييم.
--
-- ─── ★ الإشعارات ★ ─────────────────────────────────────────────────────────
--   أحداث فقط. تُسجَّل في الكتالوج بقناة portal وحدها، ولا يلمس هذا الملفّ
--   comms_channels ولا يمرّر dry_run=false في أيّ موضع. لا شيء يُرسَل.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT صلب: يوقف التشغيل قبل كتابة حرف واحد ────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('auth.users') is null then miss := miss || ' auth.users'; end if;
  if to_regprocedure('public.is_staff()')  is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()')  is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()')  is null then miss := miss || ' is_admin()'; end if;
  -- نوع الإرجاع يُفحَص أيضًا: بوّابة تعيد غير boolean تُنتج سياسات معناها
  -- «غير محدَّد»، وغير المحدَّد ليس منعًا.
  if to_regprocedure('public.is_staff()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.is_staff()'))
  then miss := miss || ' is_staff()=غير-boolean'; end if;
  if to_regprocedure('public.is_owner()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.is_owner()'))
  then miss := miss || ' is_owner()=غير-boolean'; end if;

  if miss <> '' then
    raise exception 'TALENT PREFLIGHT FAILED — اعتماديات مفقودة أو بنوع خاطئ:%. شغّل docs/talent_vendor_network_PREFLIGHT.sql واقرأ عمود verdict قبل المحاولة ثانيةً.', miss;
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) الإعدادات والمساعدات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.tvn_settings (
  id                          boolean primary key default true check (id),
  cost_approval_threshold     numeric not null default 5000,
  cost_currency               text    not null default 'SAR',
  rating_min_sample           int     not null default 3 check (rating_min_sample >= 1),
  doc_reminder_days           int[]   not null default '{90,60,30,7}',
  availability_confirm_days   int     not null default 7,
  review_due_days             int     not null default 3,
  suggest_max_candidates      int     not null default 25 check (suggest_max_candidates between 1 and 200),
  updated_by                  uuid references auth.users(id),
  updated_at                  timestamptz not null default now()
);
insert into public.tvn_settings(id) values (true) on conflict (id) do nothing;

create or replace function public.tvn_txt(p jsonb, k text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(coalesce(p ->> k, '')), '')
$$;

create or replace function public.tvn_num(p jsonb, k text) returns numeric
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::numeric;
exception when others then return null;
end $$;

create or replace function public.tvn_bool(p jsonb, k text, p_default boolean default false)
returns boolean language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := lower(nullif(btrim(coalesce(p ->> k, '')), ''));
  if v is null then return coalesce(p_default, false); end if;
  return coalesce(v in ('true','t','1','yes','y'), false);
end $$;

-- مصفوفة نصّية مطبَّعة (تشذيب، حذف الفراغ، توحيد الحالة).
create or replace function public.tvn_arr(p jsonb, k text) returns text[]
language plpgsql immutable set search_path = public as $$
declare out_a text[] := '{}'; e text;
begin
  if p is null or p -> k is null or jsonb_typeof(p -> k) <> 'array' then return '{}'; end if;
  for e in select jsonb_array_elements_text(p -> k) loop
    e := lower(btrim(coalesce(e, '')));
    if e <> '' and not (out_a @> array[e]) then out_a := out_a || e; end if;
  end loop;
  return out_a;
end $$;

create table if not exists public.tvn_audit (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       uuid,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  allowed     boolean not null default true,   -- المحاولات المرفوضة تُسجَّل أيضًا
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists idx_tvn_audit_at on public.tvn_audit(at desc);
create index if not exists idx_tvn_audit_entity on public.tvn_audit(entity_type, entity_id);

create or replace function public.tvn_log(
  p_action text, p_entity_type text, p_entity_id uuid,
  p_allowed boolean default true, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tvn_audit(actor, action, entity_type, entity_id, allowed, detail)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_allowed, true),
          coalesce(p_detail, '{}'::jsonb));
exception when others then
  null;  -- التدقيق لا يُسقِط عملية شرعية، لكنّه لا يُستبدل بصمت في المسارات الحسّاسة
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) المُسنَدات — بالأسماء المتّفق عليها حرفيًّا. كلّها fail-closed.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_perm(p_key text) returns boolean
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

create or replace function public.tvn_is_staff() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_staff(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

create or replace function public.tvn_is_owner() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

-- (١) رؤية الشبكة — موظّف + صلاحية صريحة. العميل خارج الشبكة كلّها.
create or replace function public.can_view_talent_network() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(
    public.tvn_is_owner()
    or (public.tvn_is_staff()
        and (public.tvn_perm('talent.view')
             or public.tvn_perm('talent.manage_profiles')
             or public.tvn_perm('talent.assign_external')
             or public.tvn_perm('talent.verify_compliance')
             or public.tvn_perm('talent.review_performance'))),
    false);
exception when others then return false;
end $$;

-- (٢) إدارة الملفّات
create or replace function public.can_manage_talent_profiles() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.manage_profiles')), false);
exception when others then return false;
end $$;

-- (٣) رؤية الأجر — «المالك والمشتريات المخوَّلة» حرفيًّا. لا دور عامّ يفتحها.
create or replace function public.can_view_vendor_rates() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.view_rates')), false);
exception when others then return false;
end $$;

-- (٤) توثيق الامتثال
create or replace function public.can_verify_compliance() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.verify_compliance')), false);
exception when others then return false;
end $$;

-- (٥) إسناد موارد خارجية
create or replace function public.can_assign_external_resources() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.assign_external')), false);
exception when others then return false;
end $$;

-- (٦) تقييم الأداء
create or replace function public.can_review_resource_performance() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.review_performance')), false);
exception when others then return false;
end $$;

-- بوّابة البيانات البنكية — أضيق من الأجر، ومفتاح مستقلّ عنه.
create or replace function public.tvn_can_view_bank() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.view_bank')), false);
exception when others then return false;
end $$;

-- اعتماد التكلفة فوق الحدّ.
create or replace function public.tvn_can_approve_cost() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(public.tvn_is_owner()
                  or (public.tvn_is_staff() and public.tvn_perm('talent.approve_cost')), false);
exception when others then return false;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) الجداول
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ٣.١ الملفّ ───
create table if not exists public.tvn_profiles (
  id                 uuid primary key default gen_random_uuid(),
  profile_code       text unique,
  profile_type       text not null check (profile_type in (
                       'employee_candidate','freelancer','crew_member','production_company',
                       'equipment_vendor','service_vendor','studio','location_provider',
                       'transport_provider','accommodation_provider','voice_talent',
                       'creative_talent','other')),
  legal_name         text,
  display_name       text not null check (btrim(display_name) <> ''),
  status             text not null default 'draft' check (status in
                       ('draft','active','inactive','suspended','blocked')),
  status_reason      text,
  status_changed_by  uuid references auth.users(id),
  status_changed_at  timestamptz,

  -- تواصل
  primary_phone      text, alt_phone text, primary_email text, website text,
  contact_person     text,

  -- تغطية وقدرات
  city               text,
  coverage_cities    text[] not null default '{}',
  specializations    text[] not null default '{}',
  professions        text[] not null default '{}',
  skills             text[] not null default '{}',
  languages          text[] not null default '{}',
  equipment_owned    jsonb  not null default '[]'::jsonb,   -- [{item,qty,note}]
  portfolio_links    jsonb  not null default '[]'::jsonb,   -- بيانات وصفية فقط: [{label,url,platform}]
  experience_years   int check (experience_years is null or experience_years between 0 and 80),
  experience_notes   text,

  -- سفر وإقامة
  travel_willing        boolean not null default false,
  travel_policy         text,
  accommodation_needed  boolean not null default false,
  accommodation_notes   text,
  remote_available      boolean not null default false,

  -- تسجيل تجاريّ وضريبيّ
  vat_registered     boolean not null default false,
  vat_number         text,
  cr_number          text,
  cr_expiry_date     date,
  cr_metadata        jsonb not null default '{}'::jsonb,

  -- ★ إقرارات معلنة — ادّعاء لا إثبات ★
  -- بوّابة الإسناد لا تقرأ أيًّا منها؛ تقرأ سجلّ الوثائق الموثَّق وحده.
  nda_declared            boolean not null default false,
  nda_date                date,
  insurance_declared      boolean not null default false,
  safety_certs_declared   boolean not null default false,
  drone_permit_declared   boolean not null default false,
  contract_status         text not null default 'none'
                          check (contract_status in ('none','draft','sent','signed','expired')),
  contract_expiry_date    date,

  internal_notes     text,
  linked_user_id     uuid references auth.users(id),          -- إن كان له حساب في البوّابة
  -- مرجع للقراءة فقط إلى طلب الفرص الذي رُقِّي يدويًّا. لا مُشغِّل ولا استيراد تلقائيّ.
  source_opportunity_request_id uuid,
  source_note        text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz, deleted_by uuid references auth.users(id), delete_reason text
);
create index if not exists idx_tvn_profiles_type   on public.tvn_profiles(profile_type) where is_deleted = false;
create index if not exists idx_tvn_profiles_status on public.tvn_profiles(status) where is_deleted = false;
create index if not exists idx_tvn_profiles_city   on public.tvn_profiles(lower(coalesce(city,''))) where is_deleted = false;
create index if not exists idx_tvn_profiles_prof   on public.tvn_profiles using gin(professions);
create index if not exists idx_tvn_profiles_cov    on public.tvn_profiles using gin(coverage_cities);
create index if not exists idx_tvn_profiles_skills on public.tvn_profiles using gin(skills);
create unique index if not exists uq_tvn_profiles_src_opp
  on public.tvn_profiles(source_opportunity_request_id)
  where source_opportunity_request_id is not null and is_deleted = false;

-- ─── ٣.٢ الأجر — جدول منفصل عمدًا ───
create table if not exists public.tvn_profile_rates (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.tvn_profiles(id) on delete cascade,
  currency     text not null default 'SAR',
  day_rate     numeric check (day_rate is null or day_rate >= 0),
  half_day_rate numeric check (half_day_rate is null or half_day_rate >= 0),
  hourly_rate  numeric check (hourly_rate is null or hourly_rate >= 0),
  overtime_rate numeric check (overtime_rate is null or overtime_rate >= 0),
  min_hours    numeric check (min_hours is null or min_hours >= 0),
  rate_notes   text,
  valid_from   date not null default current_date,
  valid_to     date,
  set_by       uuid references auth.users(id),
  set_at       timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists idx_tvn_rates_profile on public.tvn_profile_rates(profile_id, valid_from desc);

-- ─── ٣.٣ البيانات البنكية — بيانات وصفية فقط ───
-- ★ لا IBAN كامل ولا رقم حساب كامل في قاعدة البيانات ★ القيد يمنعه بنيويًّا،
--   فلا يكفي أن نَعِد بذلك في التوثيق.
create table if not exists public.tvn_profile_bank (
  profile_id     uuid primary key references public.tvn_profiles(id) on delete cascade,
  bank_name      text,
  account_holder text,
  iban_last4     text check (iban_last4 is null or iban_last4 ~ '^[0-9]{1,4}$'),
  has_swift      boolean not null default false,
  doc_id         uuid,                                   -- خطاب المصرف في سجلّ الوثائق
  verified       boolean not null default false,
  verified_by    uuid references auth.users(id),
  verified_at    timestamptz,
  note           text,
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  check (verified = false or (verified_by is not null and verified_at is not null))
);

-- ─── ٣.٤ الحقل المقيَّد (الجندر) ───
-- الغرض إلزاميّ ومكتوب، لأنّ حقلًا حسّاسًا بلا غرض موثَّق يتحوّل مع الوقت إلى
-- مدخل ترشيح لا أحد يتذكّر لماذا وُضع.
create table if not exists public.tvn_profile_restricted (
  profile_id     uuid primary key references public.tvn_profiles(id) on delete cascade,
  gender         text check (gender in ('male','female')),
  gender_purpose text not null check (length(btrim(gender_purpose)) >= 20),
  recorded_by    uuid references auth.users(id),
  recorded_at    timestamptz not null default now()
);
comment on table public.tvn_profile_restricted is
  'حقل مقيَّد. الغرض التشغيليّ الموثَّق فقط (مثال: أطقم فعاليات منفصلة). ممنوع في أيّ مسار ترشيح أو تقييم أو ترتيب تجاريّ.';

-- ─── ٣.٥ التوافر ───
create table if not exists public.tvn_availability (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.tvn_profiles(id) on delete cascade,
  state         text not null check (state in
                  ('available','unavailable','tentative','booked','blocked','pending_confirmation')),
  starts_on     date not null,
  ends_on       date not null,
  cities        text[] not null default '{}',
  travel_willing boolean not null default false,
  remote_ok     boolean not null default false,
  is_blackout   boolean not null default false,
  source        text not null default 'ops_entered'
                check (source in ('self_declared','ops_entered','system_derived','imported')),
  confirmation_status text not null default 'unconfirmed'
                check (confirmation_status in ('unconfirmed','pending','confirmed','declined')),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz,
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists idx_tvn_avail_profile on public.tvn_availability(profile_id, starts_on, ends_on);

-- ─── ٣.٦ أنواع الوثائق + سجلّ الوثائق ───
create table if not exists public.tvn_document_types (
  key            text primary key,
  label_ar       text not null default '',
  label_en       text not null default '',
  applies_to     text[] not null default '{}',     -- فارغ = كلّ الأنواع
  is_required    boolean not null default false,
  requires_expiry boolean not null default true,
  is_identity    boolean not null default false,
  is_financial   boolean not null default false,
  reminder_days  int[] not null default '{90,60,30,7}',
  active         boolean not null default true
);

create table if not exists public.tvn_documents (
  id            uuid primary key default gen_random_uuid(),
  doc_type      text not null references public.tvn_document_types(key),
  owner_kind    text not null check (owner_kind in ('profile','vendor','asset')),
  profile_id    uuid references public.tvn_profiles(id) on delete cascade,
  vendor_id     uuid,                       -- custody_vendors.id — مفتاح أجنبيّ مشروط أدناه
  asset_id      uuid,                       -- custody_inventory_assets.id — مشروط أدناه
  doc_number    text,
  issued_on     date,
  expires_on    date,
  storage_bucket text,
  storage_path   text,                      -- مرجع تخزين فقط. لا ملفّ داخل قاعدة البيانات.
  -- ★ الرفع ليس توثيقًا ★
  verified      boolean not null default false,
  verified_by   uuid references auth.users(id),
  verified_at   timestamptz,
  verification_note text,
  uploaded_by   uuid references auth.users(id),
  restricted    boolean not null default false,   -- هوية أو بيانات مالية
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  deleted_at timestamptz, deleted_by uuid references auth.users(id), delete_reason text,
  -- مالك واحد بالضبط، ومطابق لنوعه.
  constraint tvn_doc_owner_exact check (
    (owner_kind = 'profile' and profile_id is not null and vendor_id is null and asset_id is null) or
    (owner_kind = 'vendor'  and vendor_id  is not null and profile_id is null and asset_id is null) or
    (owner_kind = 'asset'   and asset_id   is not null and profile_id is null and vendor_id is null)),
  -- ★ صاحب الملفّ لا يوثّق ملفّه ★ قيد بنيويّ، لا مجرّد فحص داخل دالّة.
  constraint tvn_doc_verify_not_self check (
    verified = false or (verified_by is not null and verified_at is not null
                         and (uploaded_by is null or verified_by <> uploaded_by))),
  constraint tvn_doc_dates check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists idx_tvn_docs_profile on public.tvn_documents(profile_id) where is_deleted = false;
create index if not exists idx_tvn_docs_expiry  on public.tvn_documents(expires_on) where is_deleted = false;
create index if not exists idx_tvn_docs_type    on public.tvn_documents(doc_type) where is_deleted = false;

-- ─── ٣.٧ الإسناد + المرشّحون ───
create table if not exists public.tvn_assignments (
  id               uuid primary key default gen_random_uuid(),
  assignment_number text unique,
  profile_id       uuid not null references public.tvn_profiles(id),
  -- منصّة المشاريع مجمَّدة: نخزّن المعرّف كمرجع اختياريّ للقراءة فقط، بلا مفتاح
  -- أجنبيّ وبلا أيّ كتابة في جداولها.
  project_id       uuid,
  job_title        text,
  role_profession  text,
  city             text,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  requires_drone   boolean not null default false,
  required_doc_types text[] not null default '{}',
  status           text not null default 'proposed' check (status in
                     ('proposed','pending_approval','approved','confirmed','rejected','cancelled','completed','closed')),
  cost_estimate    numeric check (cost_estimate is null or cost_estimate >= 0),
  cost_basis       text check (cost_basis is null or cost_basis in ('day','hour','fixed')),
  currency         text not null default 'SAR',
  approval_required boolean not null default false,
  approved_by      uuid references auth.users(id), approved_at timestamptz, approval_note text,
  rejected_by      uuid references auth.users(id), rejected_at timestamptz, reject_reason text,
  proposed_by      uuid references auth.users(id), proposed_at timestamptz not null default now(),
  confirmed_by     uuid references auth.users(id), confirmed_at timestamptz,
  cancelled_by     uuid references auth.users(id), cancelled_at timestamptz, cancel_reason text,
  completed_at     timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_tvn_asg_profile on public.tvn_assignments(profile_id, starts_at, ends_at);
create index if not exists idx_tvn_asg_status  on public.tvn_assignments(status);
create index if not exists idx_tvn_asg_project on public.tvn_assignments(project_id) where project_id is not null;

-- لقطة الاقتراح: قابلة للتفسير، ولا تُسند شيئًا بذاتها.
create table if not exists public.tvn_assignment_candidates (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.tvn_assignments(id) on delete cascade,
  request_key   text,                       -- لطلبات اقتراح بلا إسناد بعد
  profile_id    uuid not null references public.tvn_profiles(id) on delete cascade,
  rank          int not null default 0,
  score         numeric not null default 0,
  reasons       jsonb not null default '[]'::jsonb,   -- [{rule,weight,detail}]
  blockers      jsonb not null default '[]'::jsonb,   -- [{rule,detail}]
  generated_by  uuid references auth.users(id),
  generated_at  timestamptz not null default now()
);
create index if not exists idx_tvn_cand_asg on public.tvn_assignment_candidates(assignment_id);

-- ─── ٣.٨ التقييمات ───
create table if not exists public.tvn_reviews (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.tvn_assignments(id),
  profile_id     uuid not null references public.tvn_profiles(id),
  reviewer_id    uuid not null references auth.users(id),
  quality            int check (quality is null or quality between 1 and 5),
  attendance         int check (attendance is null or attendance between 1 and 5),
  timeliness         int check (timeliness is null or timeliness between 1 and 5),
  safety             int check (safety is null or safety between 1 and 5),
  communication      int check (communication is null or communication between 1 and 5),
  equipment_handling int check (equipment_handling is null or equipment_handling between 1 and 5),
  client_conduct     int check (client_conduct is null or client_conduct between 1 and 5),
  notes          text,
  incident_reported boolean not null default false,
  incident_severity text check (incident_severity is null or incident_severity in ('low','medium','high')),
  would_rehire   boolean,
  review_date    date not null default current_date,
  status         text not null default 'draft' check (status in ('draft','submitted','closed')),
  closed_by      uuid references auth.users(id),
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (assignment_id, reviewer_id)
);
create index if not exists idx_tvn_reviews_profile on public.tvn_reviews(profile_id, status);

-- التصحيح لا يُعدّل الصفّ المقفل؛ يُلحق به. القراءة الفعّالة تطبّق التصحيحات.
create table if not exists public.tvn_review_corrections (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null references public.tvn_reviews(id),
  field_key    text not null,
  old_value    text,
  new_value    text,
  reason       text not null check (length(btrim(reason)) >= 20),
  corrected_by uuid not null references auth.users(id),
  corrected_at timestamptz not null default now()
);
create index if not exists idx_tvn_corr_review on public.tvn_review_corrections(review_id);

create table if not exists public.tvn_incident_flags (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.tvn_profiles(id) on delete cascade,
  source      text not null check (source in ('review','ops','client_report','safety')),
  review_id   uuid references public.tvn_reviews(id),
  severity    text not null check (severity in ('low','medium','high')),
  summary     text not null,
  raised_by   uuid references auth.users(id),
  raised_at   timestamptz not null default now(),
  resolved    boolean not null default false,
  resolved_by uuid references auth.users(id), resolved_at timestamptz, resolution_note text
);
create index if not exists idx_tvn_flags_profile on public.tvn_incident_flags(profile_id) where resolved = false;

-- ─── ٣.٩ سجلّ الأحداث (منع التكرار) ───
create table if not exists public.tvn_event_log (
  id              uuid primary key default gen_random_uuid(),
  event_key       text not null,
  entity_type     text,
  entity_id       uuid,
  idempotency_key text not null unique,
  enqueued        boolean not null default false,
  hub_result      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_tvn_evt_key on public.tvn_event_log(event_key, created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) الجسور المشروطة — تُضاف إن وُجد الطرف الآخر، وتُتخطّى بلطف إن غاب.
-- ════════════════════════════════════════════════════════════════════════════
do $bridge$
begin
  -- (أ) custody_vendors ← نفس المورّد، لا مورّد ثانٍ.
  if to_regclass('public.custody_vendors') is not null then
    execute 'alter table public.custody_vendors add column if not exists tvn_profile_id uuid';
    if not exists (select 1 from pg_constraint where conname = 'custody_vendors_tvn_profile_fk') then
      execute 'alter table public.custody_vendors
               add constraint custody_vendors_tvn_profile_fk
               foreign key (tvn_profile_id) references public.tvn_profiles(id) on delete set null';
    end if;
    execute 'create unique index if not exists uq_custody_vendors_tvn_profile
             on public.custody_vendors(tvn_profile_id) where tvn_profile_id is not null';
    if not exists (select 1 from pg_constraint where conname = 'tvn_documents_vendor_fk') then
      execute 'alter table public.tvn_documents
               add constraint tvn_documents_vendor_fk
               foreign key (vendor_id) references public.custody_vendors(id) on delete cascade';
    end if;
  end if;

  -- (ب) الأصول — الوثيقة تشير إلى الأصل القائم ولا تنسخه.
  if to_regclass('public.custody_inventory_assets') is not null
     and not exists (select 1 from pg_constraint where conname = 'tvn_documents_asset_fk') then
    execute 'alter table public.tvn_documents
             add constraint tvn_documents_asset_fk
             foreign key (asset_id) references public.custody_inventory_assets(id) on delete cascade';
  end if;

  -- (ج) سطح الفرص — مرجع للقراءة فقط. لا مُشغِّل، ولا تعديل على الجدول.
  if to_regclass('public.opportunity_requests') is not null
     and not exists (select 1 from pg_constraint where conname = 'tvn_profiles_src_opp_fk') then
    execute 'alter table public.tvn_profiles
             add constraint tvn_profiles_src_opp_fk
             foreign key (source_opportunity_request_id)
             references public.opportunity_requests(id) on delete set null';
  end if;
end $bridge$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) بذور أنواع الوثائق
-- ════════════════════════════════════════════════════════════════════════════
insert into public.tvn_document_types(key, label_ar, label_en, applies_to, is_required, requires_expiry, is_identity, is_financial) values
  ('national_id','الهوية الوطنية','National ID','{}', false, true,  true,  false),
  ('iqama','الإقامة','Residency permit','{}', false, true,  true,  false),
  ('passport','جواز السفر','Passport','{}', false, true,  true,  false),
  ('commercial_registration','السجلّ التجاريّ','Commercial registration',
     '{production_company,equipment_vendor,service_vendor,studio,transport_provider,accommodation_provider,location_provider}', true, true, false, false),
  ('vat_certificate','شهادة ضريبة القيمة المضافة','VAT certificate',
     '{production_company,equipment_vendor,service_vendor,studio}', false, false, false, true),
  ('bank_letter','خطاب المصرف','Bank letter','{}', false, false, false, true),
  ('insurance_policy','وثيقة تأمين','Insurance policy',
     '{production_company,equipment_vendor,transport_provider,studio}', false, true, false, false),
  ('public_liability','تأمين المسؤولية العامّة','Public liability','{}', false, true, false, false),
  ('safety_certificate','شهادة سلامة','Safety certificate','{}', false, true, false, false),
  ('drone_permit','تصريح تشغيل درون','Drone permit','{}', false, true, false, false),
  ('driving_license','رخصة قيادة','Driving license','{transport_provider}', false, true, true, false),
  ('nda','اتفاقية عدم إفصاح','NDA','{}', false, false, false, false),
  ('contract','عقد','Contract','{}', false, true, false, false)
on conflict (key) do nothing;

-- مفاتيح الصلاحيات في الكتالوج المشترك — إن وُجد. لا منح ضمنيّ من هنا.
do $perm$
begin
  if to_regclass('public.permissions') is null then return; end if;
  execute $ins$
    insert into public.permissions(key, label_ar, label_en, category, sensitivity, enabled) values
      ('talent.view','عرض شبكة المواهب والمورّدين','View talent network','talent','normal',true),
      ('talent.manage_profiles','إدارة ملفّات الشبكة','Manage network profiles','talent','normal',true),
      ('talent.view_rates','عرض أسعار المورّدين','View vendor rates','talent','sensitive',true),
      ('talent.view_bank','عرض البيانات البنكية الوصفية','View bank metadata','talent','sensitive',true),
      ('talent.verify_compliance','توثيق الامتثال والوثائق','Verify compliance','talent','sensitive',true),
      ('talent.assign_external','إسناد موارد خارجية','Assign external resources','talent','normal',true),
      ('talent.review_performance','تقييم أداء الموارد','Review resource performance','talent','normal',true),
      ('talent.approve_cost','اعتماد تكلفة الإسناد','Approve assignment cost','talent','sensitive',true)
    on conflict (key) do nothing
  $ins$;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) الدوالّ الداخلية — صلاحية الوثائق، التعارض، التقييم المجمَّع
-- ════════════════════════════════════════════════════════════════════════════

-- وثيقة صالحة = موثَّقة **و** غير منتهية. الرفع وحده لا يكفي أبدًا.
create or replace function public.tvn_doc_valid(
  p_owner_kind text, p_owner_id uuid, p_doc_type text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_owner_id is null or p_doc_type is null then return false; end if;
  select exists (
    select 1 from public.tvn_documents d
     where d.is_deleted = false
       and d.doc_type = p_doc_type
       and d.verified = true
       and (d.expires_on is null or d.expires_on >= current_date)
       and ((p_owner_kind = 'profile' and d.profile_id = p_owner_id)
         or (p_owner_kind = 'vendor'  and d.vendor_id  = p_owner_id)
         or (p_owner_kind = 'asset'   and d.asset_id   = p_owner_id))
  ) into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

-- الوثائق الإلزامية الناقصة أو المنتهية لملفّ ما، بأسمائها.
create or replace function public.tvn_missing_required_docs(p_profile uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare out_a text[] := '{}'; t record; v_type text;
begin
  if p_profile is null then return '{}'; end if;
  select profile_type into v_type from public.tvn_profiles where id = p_profile;
  if v_type is null then return '{}'; end if;
  for t in select key from public.tvn_document_types
            where active and is_required
              and (cardinality(applies_to) = 0 or applies_to @> array[v_type])
  loop
    if not public.tvn_doc_valid('profile', p_profile, t.key) then
      out_a := out_a || t.key;
    end if;
  end loop;
  return out_a;
exception when others then return '{}';
end $$;

-- تعارض زمنيّ: إسناد قائم متداخل، أو نافذة توافر مانعة.
create or replace function public.tvn_has_conflict(
  p_profile uuid, p_starts timestamptz, p_ends timestamptz, p_exclude uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if p_profile is null or p_starts is null or p_ends is null then return true; end if;  -- fail-closed
  select exists (
    select 1 from public.tvn_assignments a
     where a.profile_id = p_profile
       and a.status in ('approved','confirmed')
       and (p_exclude is null or a.id <> p_exclude)
       and a.starts_at < p_ends and a.ends_at > p_starts
  ) into v;
  if coalesce(v, true) then return true; end if;

  select exists (
    select 1 from public.tvn_availability av
     where av.profile_id = p_profile
       and (av.is_blackout or av.state in ('unavailable','blocked','booked'))
       and av.starts_on <= (p_ends)::date
       and av.ends_on   >= (p_starts)::date
  ) into v;
  return coalesce(v, true);
exception when others then return true;
end $$;

-- التقييم المجمَّع — لا ترتيب قبل عيّنة كافية.
-- ★ لا يقرأ tvn_profile_restricted ولا أيّ حقل شخصيّ ★
create or replace function public.tvn_rating(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_min int; v_n int; r record;
begin
  if p_profile is null then
    return jsonb_build_object('ranked', false, 'reason', 'no_profile');
  end if;
  select rating_min_sample into v_min from public.tvn_settings where id;
  v_min := coalesce(v_min, 3);

  select count(*) into v_n from public.tvn_reviews
   where profile_id = p_profile and status = 'closed';
  v_n := coalesce(v_n, 0);

  if v_n < v_min then
    return jsonb_build_object('ranked', false, 'reason', 'insufficient_sample',
                              'sample', v_n, 'min_sample', v_min);
  end if;

  select
    round(avg(quality)::numeric, 2)            as quality,
    round(avg(attendance)::numeric, 2)         as attendance,
    round(avg(timeliness)::numeric, 2)         as timeliness,
    round(avg(safety)::numeric, 2)             as safety,
    round(avg(communication)::numeric, 2)      as communication,
    round(avg(equipment_handling)::numeric, 2) as equipment_handling,
    round(avg(client_conduct)::numeric, 2)     as client_conduct,
    count(*) filter (where would_rehire is true)  as rehire_yes,
    count(*) filter (where incident_reported)     as incidents
    into r
    from public.tvn_reviews
   where profile_id = p_profile and status = 'closed';

  return jsonb_build_object(
    'ranked', true, 'sample', v_n, 'min_sample', v_min,
    'reliability', r.attendance, 'quality', r.quality, 'timeliness', r.timeliness,
    'communication', r.communication, 'safety', r.safety,
    'equipment_handling', r.equipment_handling, 'client_conduct', r.client_conduct,
    'would_rehire_count', r.rehire_yes, 'incidents', r.incidents,
    'overall', round(((coalesce(r.quality,0) + coalesce(r.attendance,0) + coalesce(r.timeliness,0)
                     + coalesce(r.communication,0)) / 4.0)::numeric, 2));
exception when others then
  return jsonb_build_object('ranked', false, 'reason', 'unavailable');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) الأحداث — تعريف وإدراج فقط. لا إرسال.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_event_keys() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'availability_confirmation_required','assignment_proposed','assignment_confirmed',
    'document_expiring','document_expired','vendor_suspended','performance_review_due']::text[]
$$;

-- الأحداث المملوكة لوحدة الأصول. تُعرَّف هنا بـon conflict do nothing كي
-- تلتقي الحزمتان على نفس المفاتيح أيًّا كان ترتيب التشغيل، ولا تُنشئ أيّ
-- منهما مفردات موازية.
create or replace function public.tvn_asset_event_keys() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'custody_due','custody_overdue','asset_returned_pending_inspection',
    'asset_damage_reported','asset_missing','maintenance_due','maintenance_overdue',
    'warranty_expiring','reservation_conflict','asset_available_again']::text[]
$$;

-- الإدراج: يمرّ عبر مركز الاتصالات إن وُجد، ويُسجَّل دائمًا محلّيًّا بمفتاح
-- تفرُّد. ⛔ لا يمرّر dry_run ولا يلمس القنوات: القرار قرار المركز والمالك.
create or replace function public.tvn_emit(
  p_event text, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_res jsonb := '{}'::jsonb; v_full text; v_ok boolean := false;
begin
  if p_event is null then return jsonb_build_object('emitted', false, 'reason', 'no_event'); end if;
  v_full := 'talent.' || p_event;
  v_key  := coalesce(p_idem, v_full || ':' || coalesce(p_entity_id::text, 'none') || ':' || to_char(now(), 'YYYY-MM-DD'));

  begin
    insert into public.tvn_event_log(event_key, entity_type, entity_id, idempotency_key)
    values (v_full, p_entity_type, p_entity_id, v_key);
  exception when unique_violation then
    return jsonb_build_object('emitted', false, 'reason', 'duplicate', 'idempotency_key', v_key);
  end;

  if to_regprocedure('public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)') is not null then
    begin
      -- ★ NULL مُصرَّح النوع ★ تمرير null عاريًا يجعل تحليل الحِمل الزائد
      --   غامضًا، فيُرفَع خطأ يبتلعه معالج الاستثناء أدناه ويُقرأ «المركز
      --   عاطل» بينما التوقيع وحده هو المشكلة.
      execute 'select public.comms_enqueue($1,$2,$3,null::uuid,$4,$5,null::uuid)'
        into v_res using v_full, p_entity_type, p_entity_id, auth.uid(),
                         coalesce(p_payload, '{}'::jsonb);
      v_ok := true;
    exception when others then
      v_res := jsonb_build_object('error', 'hub_enqueue_failed');
      v_ok := false;
    end;
  else
    v_res := jsonb_build_object('note', 'comms hub not installed — event recorded locally only');
  end if;

  update public.tvn_event_log
     set enqueued = v_ok, hub_result = coalesce(v_res, '{}'::jsonb)
   where idempotency_key = v_key;

  return jsonb_build_object('emitted', true, 'event_key', v_full,
                            'idempotency_key', v_key, 'hub', coalesce(v_res, '{}'::jsonb));
end $$;

-- تسجيل الكتالوج — قناة portal وحدها. لا email ولا whatsapp ولا sms.
do $ev$
declare k text; v_ar text;
begin
  if to_regclass('public.comms_event_catalog') is null then return; end if;

  foreach k in array (public.tvn_event_keys() || public.tvn_asset_event_keys()) loop
    v_ar := case k
      when 'availability_confirmation_required' then 'تأكيد توافر مطلوب'
      when 'assignment_proposed'                then 'اقتراح إسناد'
      when 'assignment_confirmed'               then 'تأكيد إسناد'
      when 'document_expiring'                  then 'اقتراب انتهاء وثيقة'
      when 'document_expired'                   then 'وثيقة منتهية'
      when 'vendor_suspended'                   then 'إيقاف مورّد'
      when 'performance_review_due'             then 'تقييم أداء مستحقّ'
      when 'custody_due'                        then 'عهدة مستحقّة الإرجاع'
      when 'custody_overdue'                    then 'تأخّر إرجاع عهدة'
      when 'asset_returned_pending_inspection'  then 'أصل مُعاد بانتظار الفحص'
      when 'asset_damage_reported'              then 'بلاغ تلف أصل'
      when 'asset_missing'                      then 'أصل مفقود'
      when 'maintenance_due'                    then 'صيانة مستحقّة'
      when 'maintenance_overdue'                then 'صيانة متأخّرة'
      when 'warranty_expiring'                  then 'اقتراب انتهاء ضمان'
      when 'reservation_conflict'               then 'تعارض حجز'
      when 'asset_available_again'              then 'عودة أصل للتوافر'
      else k end;

    execute format(
      'insert into public.comms_event_catalog(event_key, category, audience, is_financial,
         mandatory, channels, rate_limit_hour, label_ar, label_en, active)
       values (%L, %L, %L, false, false, array[%L]::text[], 200, %L, %L, true)
       on conflict (event_key) do nothing',
      case when k = any (public.tvn_asset_event_keys()) then 'asset.' || k else 'talent.' || k end,
      case when k = any (public.tvn_asset_event_keys()) then 'asset' else 'talent' end,
      'internal', 'portal', v_ar, replace(k, '_', ' '));

    if to_regclass('public.comms_templates') is not null then
      execute format(
        'insert into public.comms_templates(event_key, locale, audience_scope, version,
           subject_tpl, body_tpl, is_active)
         values (%L, %L, %L, 1, %L, %L, true)
         on conflict (event_key, locale, audience_scope, version) do nothing',
        case when k = any (public.tvn_asset_event_keys()) then 'asset.' || k else 'talent.' || k end,
        'ar', 'internal', v_ar, v_ar || ' — التفاصيل في البوّابة: {{action_url}}');
    end if;
  end loop;
end $ev$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٨) واجهة القراءة
-- ════════════════════════════════════════════════════════════════════════════

-- خريطة القدرات — كي تعرض الواجهة الحقيقة بدل التخمين.
create or replace function public.tvn_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'installed', true,
    'can_view',            public.can_view_talent_network(),
    'can_manage_profiles', public.can_manage_talent_profiles(),
    'can_view_rates',      public.can_view_vendor_rates(),
    'can_view_bank',       public.tvn_can_view_bank(),
    'can_verify',          public.can_verify_compliance(),
    'can_assign',          public.can_assign_external_resources(),
    'can_review',          public.can_review_resource_performance(),
    'can_approve_cost',    public.tvn_can_approve_cost(),
    'hub_installed',       to_regclass('public.comms_event_catalog') is not null,
    'vendor_bridge',       to_regclass('public.custody_vendors') is not null,
    'opportunity_surface', to_regclass('public.opportunity_requests') is not null);
end $$;

-- ⚠️ ليست stable عمدًا: تكتب صفّ تدقيق عند الرفض. دالّة غير متغيّرة تُنفَّذ
--    بسياق للقراءة فقط، فأيّ INSERT داخلها يرفع «not allowed in a non-volatile
--    function» — أي أنّ تعليمها stable كان سيحوّل *الرفض* نفسه إلى عطل.
create or replace function public.tvn_profile_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; v_rates jsonb := null; v_bank jsonb := null;
begin
  if not public.can_view_talent_network() then
    perform public.tvn_log('profile_get', 'profile', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into p from public.tvn_profiles where id = p_id and is_deleted = false;
  if not found then return jsonb_build_object('found', false); end if;

  -- ★ الأجر: لا رقم لغير المخوَّل، ولا صفر بدل الرقم ★
  if public.can_view_vendor_rates() then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.valid_from desc), '[]'::jsonb) into v_rates
      from public.tvn_profile_rates r where r.profile_id = p.id;
  end if;
  if public.tvn_can_view_bank() then
    select to_jsonb(b) into v_bank from public.tvn_profile_bank b where b.profile_id = p.id;
  end if;

  return jsonb_build_object(
    'found', true,
    'profile', (to_jsonb(p) - 'internal_notes'::text)
               || jsonb_build_object('internal_notes',
                    case when public.can_manage_talent_profiles() then p.internal_notes else null end),
    'rates', v_rates, 'rates_visible', public.can_view_vendor_rates(),
    'bank',  v_bank,  'bank_visible',  public.tvn_can_view_bank(),
    'rating', public.tvn_rating(p.id),
    'missing_required_docs', public.tvn_missing_required_docs(p.id),
    'open_incidents', (select count(*) from public.tvn_incident_flags f
                        where f.profile_id = p.id and f.resolved = false));
end $$;

create or replace function public.tvn_profile_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_type text; v_city text; v_status text; v_q text; v_prof text[];
begin
  if not public.can_view_talent_network() then
    raise exception 'not authorized';
  end if;
  v_type   := public.tvn_txt(p_filters, 'profile_type');
  v_city   := lower(coalesce(public.tvn_txt(p_filters, 'city'), ''));
  v_status := public.tvn_txt(p_filters, 'status');
  v_q      := lower(coalesce(public.tvn_txt(p_filters, 'q'), ''));
  v_prof   := public.tvn_arr(p_filters, 'professions');

  select coalesce(jsonb_agg(x order by x ->> 'display_name'), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'id', p.id, 'profile_code', p.profile_code, 'display_name', p.display_name,
               'profile_type', p.profile_type, 'status', p.status, 'city', p.city,
               'coverage_cities', p.coverage_cities, 'professions', p.professions,
               'skills', p.skills, 'languages', p.languages,
               'travel_willing', p.travel_willing, 'remote_available', p.remote_available,
               'rating', public.tvn_rating(p.id),
               'missing_required_docs', public.tvn_missing_required_docs(p.id)) as x
        from public.tvn_profiles p
       where p.is_deleted = false
         and (v_type is null or p.profile_type = v_type)
         and (v_status is null or p.status = v_status)
         and (v_city = '' or lower(coalesce(p.city, '')) = v_city or p.coverage_cities @> array[v_city])
         and (cardinality(v_prof) = 0 or p.professions && v_prof)
         and (v_q = '' or lower(coalesce(p.display_name, '')) like '%' || v_q || '%'
                       or lower(coalesce(p.legal_name, ''))  like '%' || v_q || '%')
       limit 500) s;
  return jsonb_build_object('rows', v_rows);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٩) الكتابة — كلّها عبر RPC، وكلّها مُدقَّقة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_profile_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text; v_name text; v_code text; v_new boolean := false;
begin
  if not public.can_manage_talent_profiles() then
    perform public.tvn_log('profile_upsert', 'profile', null, false,
      jsonb_build_object('input_keys',
        (select coalesce(jsonb_agg(kk), '[]'::jsonb)
           from jsonb_object_keys(coalesce(p_input, '{}'::jsonb)) as t(kk))));
    raise exception 'not authorized';
  end if;
  v_id   := nullif(public.tvn_txt(p_input, 'id'), '')::uuid;
  v_type := public.tvn_txt(p_input, 'profile_type');
  v_name := public.tvn_txt(p_input, 'display_name');

  if v_id is null then
    if v_type is null or v_name is null then
      raise exception 'validation: profile_type و display_name إلزاميّان';
    end if;
    v_new := true;
    v_code := 'TVN-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    insert into public.tvn_profiles(profile_code, profile_type, display_name, created_by, updated_by)
    values (v_code, v_type, v_name, auth.uid(), auth.uid())
    returning id into v_id;
  end if;

  update public.tvn_profiles p set
    legal_name       = coalesce(public.tvn_txt(p_input, 'legal_name'), p.legal_name),
    display_name     = coalesce(v_name, p.display_name),
    profile_type     = coalesce(v_type, p.profile_type),
    primary_phone    = coalesce(public.tvn_txt(p_input, 'primary_phone'), p.primary_phone),
    alt_phone        = coalesce(public.tvn_txt(p_input, 'alt_phone'), p.alt_phone),
    primary_email    = coalesce(public.tvn_txt(p_input, 'primary_email'), p.primary_email),
    website          = coalesce(public.tvn_txt(p_input, 'website'), p.website),
    contact_person   = coalesce(public.tvn_txt(p_input, 'contact_person'), p.contact_person),
    city             = coalesce(public.tvn_txt(p_input, 'city'), p.city),
    coverage_cities  = case when p_input ? 'coverage_cities' then public.tvn_arr(p_input, 'coverage_cities') else p.coverage_cities end,
    specializations  = case when p_input ? 'specializations' then public.tvn_arr(p_input, 'specializations') else p.specializations end,
    professions      = case when p_input ? 'professions' then public.tvn_arr(p_input, 'professions') else p.professions end,
    skills           = case when p_input ? 'skills' then public.tvn_arr(p_input, 'skills') else p.skills end,
    languages        = case when p_input ? 'languages' then public.tvn_arr(p_input, 'languages') else p.languages end,
    equipment_owned  = case when p_input ? 'equipment_owned' then coalesce(p_input -> 'equipment_owned', '[]'::jsonb) else p.equipment_owned end,
    portfolio_links  = case when p_input ? 'portfolio_links' then coalesce(p_input -> 'portfolio_links', '[]'::jsonb) else p.portfolio_links end,
    experience_years = coalesce(public.tvn_num(p_input, 'experience_years')::int, p.experience_years),
    experience_notes = coalesce(public.tvn_txt(p_input, 'experience_notes'), p.experience_notes),
    travel_willing   = case when p_input ? 'travel_willing' then public.tvn_bool(p_input, 'travel_willing') else p.travel_willing end,
    travel_policy    = coalesce(public.tvn_txt(p_input, 'travel_policy'), p.travel_policy),
    accommodation_needed = case when p_input ? 'accommodation_needed' then public.tvn_bool(p_input, 'accommodation_needed') else p.accommodation_needed end,
    accommodation_notes  = coalesce(public.tvn_txt(p_input, 'accommodation_notes'), p.accommodation_notes),
    remote_available = case when p_input ? 'remote_available' then public.tvn_bool(p_input, 'remote_available') else p.remote_available end,
    vat_registered   = case when p_input ? 'vat_registered' then public.tvn_bool(p_input, 'vat_registered') else p.vat_registered end,
    vat_number       = coalesce(public.tvn_txt(p_input, 'vat_number'), p.vat_number),
    cr_number        = coalesce(public.tvn_txt(p_input, 'cr_number'), p.cr_number),
    cr_expiry_date   = coalesce(nullif(public.tvn_txt(p_input, 'cr_expiry_date'), '')::date, p.cr_expiry_date),
    cr_metadata      = case when p_input ? 'cr_metadata' then coalesce(p_input -> 'cr_metadata', '{}'::jsonb) else p.cr_metadata end,
    nda_declared     = case when p_input ? 'nda_declared' then public.tvn_bool(p_input, 'nda_declared') else p.nda_declared end,
    nda_date         = coalesce(nullif(public.tvn_txt(p_input, 'nda_date'), '')::date, p.nda_date),
    insurance_declared    = case when p_input ? 'insurance_declared' then public.tvn_bool(p_input, 'insurance_declared') else p.insurance_declared end,
    safety_certs_declared = case when p_input ? 'safety_certs_declared' then public.tvn_bool(p_input, 'safety_certs_declared') else p.safety_certs_declared end,
    drone_permit_declared = case when p_input ? 'drone_permit_declared' then public.tvn_bool(p_input, 'drone_permit_declared') else p.drone_permit_declared end,
    contract_status  = coalesce(public.tvn_txt(p_input, 'contract_status'), p.contract_status),
    contract_expiry_date = coalesce(nullif(public.tvn_txt(p_input, 'contract_expiry_date'), '')::date, p.contract_expiry_date),
    internal_notes   = coalesce(public.tvn_txt(p_input, 'internal_notes'), p.internal_notes),
    updated_by = auth.uid(), updated_at = now()
  where p.id = v_id and p.is_deleted = false;

  if not found then raise exception 'not found'; end if;

  perform public.tvn_log(case when v_new then 'profile_create' else 'profile_update' end,
                         'profile', v_id, true, jsonb_build_object('new', v_new));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

-- الحالة (تعليق/حظر) قرار بشريّ بسبب مكتوب. لا مُشغِّل يحظر أحدًا تلقائيًّا.
create or replace function public.tvn_profile_set_status(
  p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.can_manage_talent_profiles() then
    perform public.tvn_log('profile_set_status', 'profile', p_id, false,
                           jsonb_build_object('to', p_status));
    raise exception 'not authorized';
  end if;
  if p_status not in ('draft','active','inactive','suspended','blocked') then
    raise exception 'validation: حالة غير معروفة';
  end if;
  if p_status in ('suspended','blocked') and length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'validation: التعليق أو الحظر يحتاج سببًا مكتوبًا (١٠ محارف فأكثر)';
  end if;

  select status into v_old from public.tvn_profiles where id = p_id and is_deleted = false;
  if v_old is null then raise exception 'not found'; end if;

  update public.tvn_profiles
     set status = p_status, status_reason = p_reason,
         status_changed_by = auth.uid(), status_changed_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;

  perform public.tvn_log('profile_set_status', 'profile', p_id, true,
                         jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));

  if p_status in ('suspended','blocked') then
    perform public.tvn_emit('vendor_suspended', 'profile', p_id,
                            jsonb_build_object('status', p_status, 'reason', p_reason),
                            'talent.vendor_suspended:' || p_id::text || ':' || p_status);
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;

create or replace function public.tvn_rates_set(p_profile uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- كتابة الأجر تحتاج البوّابتين معًا: من لا يرى الرقم لا يكتبه.
  if not (public.can_view_vendor_rates() and public.can_manage_talent_profiles()) then
    perform public.tvn_log('rates_set', 'profile', p_profile, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.tvn_profiles where id = p_profile and is_deleted = false) then
    raise exception 'not found';
  end if;

  insert into public.tvn_profile_rates(
    profile_id, currency, day_rate, half_day_rate, hourly_rate, overtime_rate,
    min_hours, rate_notes, valid_from, valid_to, set_by)
  values (p_profile,
          coalesce(public.tvn_txt(p_input, 'currency'), 'SAR'),
          public.tvn_num(p_input, 'day_rate'), public.tvn_num(p_input, 'half_day_rate'),
          public.tvn_num(p_input, 'hourly_rate'), public.tvn_num(p_input, 'overtime_rate'),
          public.tvn_num(p_input, 'min_hours'), public.tvn_txt(p_input, 'rate_notes'),
          coalesce(nullif(public.tvn_txt(p_input, 'valid_from'), '')::date, current_date),
          nullif(public.tvn_txt(p_input, 'valid_to'), '')::date,
          auth.uid())
  returning id into v_id;

  -- ★ التدقيق لا يحفظ الأرقام ★ من يقرأ سجلّ التدقيق ليس بالضرورة مخوَّلًا
  --   لرؤية الأجر، وتسريبه عبر سجلّ التدقيق تسريب كامل.
  perform public.tvn_log('rates_set', 'profile', p_profile, true,
                         jsonb_build_object('rate_row', v_id, 'fields_set',
                           (select coalesce(jsonb_agg(kk), '[]'::jsonb)
                              from jsonb_object_keys(coalesce(p_input, '{}'::jsonb)) as t(kk))));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.tvn_bank_set(p_profile uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last4 text;
begin
  if not public.tvn_can_view_bank() then
    perform public.tvn_log('bank_set', 'profile', p_profile, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  v_last4 := public.tvn_txt(p_input, 'iban_last4');
  if v_last4 is not null and v_last4 !~ '^[0-9]{1,4}$' then
    raise exception 'validation: تُخزَّن آخر أربعة أرقام فقط — لا IBAN كامل في قاعدة البيانات';
  end if;

  insert into public.tvn_profile_bank(profile_id, bank_name, account_holder, iban_last4,
                                      has_swift, note, updated_by, updated_at)
  values (p_profile, public.tvn_txt(p_input, 'bank_name'), public.tvn_txt(p_input, 'account_holder'),
          v_last4, public.tvn_bool(p_input, 'has_swift'), public.tvn_txt(p_input, 'note'),
          auth.uid(), now())
  on conflict (profile_id) do update set
    bank_name = coalesce(excluded.bank_name, public.tvn_profile_bank.bank_name),
    account_holder = coalesce(excluded.account_holder, public.tvn_profile_bank.account_holder),
    iban_last4 = coalesce(excluded.iban_last4, public.tvn_profile_bank.iban_last4),
    has_swift = excluded.has_swift, note = coalesce(excluded.note, public.tvn_profile_bank.note),
    updated_by = auth.uid(), updated_at = now();

  perform public.tvn_log('bank_set', 'profile', p_profile, true,
                         jsonb_build_object('bank_name_set', public.tvn_txt(p_input, 'bank_name') is not null));
  return jsonb_build_object('ok', true);
end $$;

-- الحقل المقيَّد: بوّابة الامتثال وحدها، وغرض مكتوب إلزاميّ.
create or replace function public.tvn_restricted_set(
  p_profile uuid, p_gender text, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_verify_compliance() then
    perform public.tvn_log('restricted_set', 'profile', p_profile, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if p_gender is not null and p_gender not in ('male','female') then
    raise exception 'validation: قيمة غير معروفة';
  end if;
  if length(btrim(coalesce(p_purpose, ''))) < 20 then
    raise exception 'validation: الغرض التشغيليّ الموثَّق إلزاميّ (٢٠ حرفًا فأكثر)';
  end if;

  insert into public.tvn_profile_restricted(profile_id, gender, gender_purpose, recorded_by)
  values (p_profile, p_gender, p_purpose, auth.uid())
  on conflict (profile_id) do update set
    gender = excluded.gender, gender_purpose = excluded.gender_purpose,
    recorded_by = auth.uid(), recorded_at = now();

  perform public.tvn_log('restricted_set', 'profile', p_profile, true,
                         jsonb_build_object('purpose_len', length(btrim(p_purpose))));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tvn_availability_set(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_profile uuid;
begin
  if not public.can_manage_talent_profiles() then
    raise exception 'not authorized';
  end if;
  v_profile := nullif(public.tvn_txt(p_input, 'profile_id'), '')::uuid;
  if v_profile is null then raise exception 'validation: profile_id إلزاميّ'; end if;

  insert into public.tvn_availability(profile_id, state, starts_on, ends_on, cities,
    travel_willing, remote_ok, is_blackout, source, confirmation_status, note, created_by)
  values (v_profile,
          coalesce(public.tvn_txt(p_input, 'state'), 'available'),
          nullif(public.tvn_txt(p_input, 'starts_on'), '')::date,
          nullif(public.tvn_txt(p_input, 'ends_on'), '')::date,
          public.tvn_arr(p_input, 'cities'),
          public.tvn_bool(p_input, 'travel_willing'),
          public.tvn_bool(p_input, 'remote_ok'),
          public.tvn_bool(p_input, 'is_blackout'),
          coalesce(public.tvn_txt(p_input, 'source'), 'ops_entered'),
          coalesce(public.tvn_txt(p_input, 'confirmation_status'), 'unconfirmed'),
          public.tvn_txt(p_input, 'note'), auth.uid())
  returning id into v_id;

  perform public.tvn_log('availability_set', 'availability', v_id, true,
                         jsonb_build_object('profile', v_profile));

  if coalesce(public.tvn_txt(p_input, 'confirmation_status'), 'unconfirmed') in ('unconfirmed','pending') then
    perform public.tvn_emit('availability_confirmation_required', 'availability', v_id,
                            jsonb_build_object('profile_id', v_profile),
                            'talent.availability_confirmation_required:' || v_id::text);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.tvn_availability_confirm(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_talent_profiles() then raise exception 'not authorized'; end if;
  if p_status not in ('confirmed','declined','pending','unconfirmed') then
    raise exception 'validation: حالة تأكيد غير معروفة';
  end if;
  update public.tvn_availability
     set confirmation_status = p_status,
         confirmed_by = case when p_status = 'confirmed' then auth.uid() else confirmed_by end,
         confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end
   where id = p_id;
  if not found then raise exception 'not found'; end if;
  perform public.tvn_log('availability_confirm', 'availability', p_id, true,
                         jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- ─── الوثائق ───
create or replace function public.tvn_document_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text; v_type text; v_restricted boolean;
begin
  if not public.can_manage_talent_profiles() then
    perform public.tvn_log('document_upsert', 'document', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  v_kind := coalesce(public.tvn_txt(p_input, 'owner_kind'), 'profile');
  v_type := public.tvn_txt(p_input, 'doc_type');
  if v_type is null then raise exception 'validation: doc_type إلزاميّ'; end if;
  if not exists (select 1 from public.tvn_document_types where key = v_type and active) then
    raise exception 'validation: نوع وثيقة غير معروف';
  end if;
  select (is_identity or is_financial) into v_restricted
    from public.tvn_document_types where key = v_type;

  v_id := nullif(public.tvn_txt(p_input, 'id'), '')::uuid;
  if v_id is null then
    -- ★ الإدراج لا يقبل verified مهما أرسل العميل ★ التوثيق فعل منفصل بفاعل آخر.
    insert into public.tvn_documents(doc_type, owner_kind, profile_id, vendor_id, asset_id,
      doc_number, issued_on, expires_on, storage_bucket, storage_path,
      uploaded_by, restricted, metadata)
    values (v_type, v_kind,
            case when v_kind = 'profile' then nullif(public.tvn_txt(p_input, 'profile_id'), '')::uuid end,
            case when v_kind = 'vendor'  then nullif(public.tvn_txt(p_input, 'vendor_id'), '')::uuid end,
            case when v_kind = 'asset'   then nullif(public.tvn_txt(p_input, 'asset_id'), '')::uuid end,
            public.tvn_txt(p_input, 'doc_number'),
            nullif(public.tvn_txt(p_input, 'issued_on'), '')::date,
            nullif(public.tvn_txt(p_input, 'expires_on'), '')::date,
            public.tvn_txt(p_input, 'storage_bucket'), public.tvn_txt(p_input, 'storage_path'),
            auth.uid(), coalesce(v_restricted, false),
            coalesce(p_input -> 'metadata', '{}'::jsonb))
    returning id into v_id;
  else
    -- التعديل لا يمسّ verified/verified_by إطلاقًا؛ وأيّ تغيير جوهريّ يُبطل التوثيق.
    update public.tvn_documents d set
      doc_number = coalesce(public.tvn_txt(p_input, 'doc_number'), d.doc_number),
      issued_on  = coalesce(nullif(public.tvn_txt(p_input, 'issued_on'), '')::date, d.issued_on),
      expires_on = coalesce(nullif(public.tvn_txt(p_input, 'expires_on'), '')::date, d.expires_on),
      storage_bucket = coalesce(public.tvn_txt(p_input, 'storage_bucket'), d.storage_bucket),
      storage_path   = coalesce(public.tvn_txt(p_input, 'storage_path'), d.storage_path),
      metadata   = case when p_input ? 'metadata' then coalesce(p_input -> 'metadata', '{}'::jsonb) else d.metadata end,
      verified   = case when p_input ? 'storage_path' and coalesce(public.tvn_txt(p_input, 'storage_path'), '') <> coalesce(d.storage_path, '')
                        then false else d.verified end,
      verified_by = case when p_input ? 'storage_path' and coalesce(public.tvn_txt(p_input, 'storage_path'), '') <> coalesce(d.storage_path, '')
                        then null else d.verified_by end,
      verified_at = case when p_input ? 'storage_path' and coalesce(public.tvn_txt(p_input, 'storage_path'), '') <> coalesce(d.storage_path, '')
                        then null else d.verified_at end,
      updated_at = now()
    where d.id = v_id and d.is_deleted = false;
    if not found then raise exception 'not found'; end if;
  end if;

  perform public.tvn_log('document_upsert', 'document', v_id, true,
                         jsonb_build_object('doc_type', v_type, 'owner_kind', v_kind));
  return jsonb_build_object('ok', true, 'id', v_id, 'verified', false);
end $$;

-- ★ التوثيق ★ بوّابة الامتثال + فاعل مختلف عن الرافع. القيد يحرس البابين معًا.
create or replace function public.tvn_document_verify(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if not public.can_verify_compliance() then
    perform public.tvn_log('document_verify', 'document', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into d from public.tvn_documents where id = p_id and is_deleted = false;
  if not found then raise exception 'not found'; end if;

  if d.uploaded_by is not null and d.uploaded_by = auth.uid() then
    perform public.tvn_log('document_verify', 'document', p_id, false,
                           jsonb_build_object('reason', 'self_verification_blocked'));
    raise exception 'not authorized: صاحب الملفّ لا يوثّق ملفّه';
  end if;

  update public.tvn_documents
     set verified = true, verified_by = auth.uid(), verified_at = now(),
         verification_note = p_note, updated_at = now()
   where id = p_id;

  perform public.tvn_log('document_verify', 'document', p_id, true,
                         jsonb_build_object('doc_type', d.doc_type));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.tvn_document_alerts(p_scan boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int[]; v_rows jsonb; v_missing jsonb; r record; v_emitted int := 0;
begin
  if not (public.can_view_talent_network() or public.can_verify_compliance()) then
    raise exception 'not authorized';
  end if;
  select doc_reminder_days into v_days from public.tvn_settings where id;
  v_days := coalesce(v_days, '{90,60,30,7}');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'doc_type', d.doc_type, 'owner_kind', d.owner_kind,
           'profile_id', d.profile_id, 'vendor_id', d.vendor_id, 'asset_id', d.asset_id,
           'expires_on', d.expires_on, 'verified', d.verified,
           'days_left', (d.expires_on - current_date),
           'bucket', case when d.expires_on < current_date then 'expired'
                          else (d.expires_on - current_date)::text end)
         order by d.expires_on), '[]'::jsonb) into v_rows
    from public.tvn_documents d
   where d.is_deleted = false and d.expires_on is not null
     and (d.expires_on < current_date
          or (d.expires_on - current_date) = any (v_days));

  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', p.id, 'display_name', p.display_name,
           'missing', public.tvn_missing_required_docs(p.id))), '[]'::jsonb) into v_missing
    from public.tvn_profiles p
   where p.is_deleted = false and p.status in ('active','draft')
     and cardinality(public.tvn_missing_required_docs(p.id)) > 0;

  if coalesce(p_scan, false) then
    if not public.can_verify_compliance() then raise exception 'not authorized'; end if;
    for r in select d.id, d.expires_on, d.profile_id from public.tvn_documents d
              where d.is_deleted = false and d.expires_on is not null
                and (d.expires_on < current_date or (d.expires_on - current_date) = any (v_days))
    loop
      perform public.tvn_emit(
        case when r.expires_on < current_date then 'document_expired' else 'document_expiring' end,
        'document', r.id, jsonb_build_object('expires_on', r.expires_on, 'profile_id', r.profile_id),
        'talent.doc:' || r.id::text || ':' || r.expires_on::text || ':' ||
          case when r.expires_on < current_date then 'expired' else (r.expires_on - current_date)::text end);
      v_emitted := v_emitted + 1;
    end loop;
    perform public.tvn_log('document_alerts_scan', 'document', null, true,
                           jsonb_build_object('candidates', v_emitted));
  end if;

  return jsonb_build_object('reminder_days', v_days, 'expiring', v_rows,
                            'missing_required', v_missing, 'scanned', coalesce(p_scan, false),
                            'events_considered', v_emitted);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٠) الاقتراح — قواعد صريحة، لا ذكاء اصطناعيّ، ولا إسناد تلقائيّ أبدًا.
-- ⛔ لا يقرأ tvn_profile_restricted، ولا الجندر، ولا أيّ صفة شخصية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_suggest(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_city text; v_prof text[]; v_skills text[]; v_start timestamptz; v_end timestamptz;
  v_drone boolean; v_required text[]; v_band_max numeric; v_travel boolean;
  v_limit int; v_rank int := 0; r record;
  v_rows jsonb := '[]'::jsonb; v_reasons jsonb; v_blockers jsonb; v_score numeric;
  v_rating jsonb; v_missing text[]; v_conflict boolean; v_day numeric; v_dt text;
begin
  if not (public.can_assign_external_resources() or public.can_view_talent_network()) then
    raise exception 'not authorized';
  end if;

  v_city     := lower(coalesce(public.tvn_txt(p_input, 'city'), ''));
  v_prof     := public.tvn_arr(p_input, 'professions');
  v_skills   := public.tvn_arr(p_input, 'skills');
  v_start    := nullif(public.tvn_txt(p_input, 'starts_at'), '')::timestamptz;
  v_end      := nullif(public.tvn_txt(p_input, 'ends_at'), '')::timestamptz;
  v_drone    := public.tvn_bool(p_input, 'requires_drone');
  v_travel   := public.tvn_bool(p_input, 'travel_needed');
  v_required := public.tvn_arr(p_input, 'required_doc_types');
  v_band_max := public.tvn_num(p_input, 'max_day_rate');
  select suggest_max_candidates into v_limit from public.tvn_settings where id;
  v_limit := coalesce(v_limit, 25);

  for r in
    select p.* from public.tvn_profiles p
     where p.is_deleted = false
       and p.status = 'active'                       -- المعلَّق والمحظور خارج القائمة أصلًا
       and (cardinality(v_prof) = 0 or p.professions && v_prof)
     limit 500
  loop
    v_reasons := '[]'::jsonb; v_blockers := '[]'::jsonb; v_score := 0;

    -- (١) المهنة
    if cardinality(v_prof) > 0 and r.professions && v_prof then
      v_score := v_score + 30;
      v_reasons := v_reasons || jsonb_build_object('rule', 'profession', 'weight', 30);
    end if;

    -- (٢) المدينة أو التغطية
    if v_city <> '' then
      if lower(coalesce(r.city, '')) = v_city then
        v_score := v_score + 20;
        v_reasons := v_reasons || jsonb_build_object('rule', 'city_exact', 'weight', 20);
      elsif r.coverage_cities @> array[v_city] then
        v_score := v_score + 12;
        v_reasons := v_reasons || jsonb_build_object('rule', 'coverage_city', 'weight', 12);
      elsif r.travel_willing then
        v_score := v_score + 5;
        v_reasons := v_reasons || jsonb_build_object('rule', 'travel_willing', 'weight', 5);
      else
        v_blockers := v_blockers || jsonb_build_object('rule', 'city_not_covered', 'detail', v_city);
      end if;
    end if;

    -- (٣) المهارات
    if cardinality(v_skills) > 0 and r.skills && v_skills then
      v_score := v_score + 10;
      v_reasons := v_reasons || jsonb_build_object('rule', 'skills', 'weight', 10);
    end if;

    -- (٤) احتياج السفر
    if v_travel then
      if r.travel_willing then
        v_score := v_score + 6;
        v_reasons := v_reasons || jsonb_build_object('rule', 'travel_ok', 'weight', 6);
      else
        v_blockers := v_blockers || jsonb_build_object('rule', 'travel_refused', 'detail', 'travel_needed');
      end if;
    end if;

    -- (٥) التوافر والتعارض الزمنيّ
    if v_start is not null and v_end is not null then
      v_conflict := public.tvn_has_conflict(r.id, v_start, v_end, null);
      if v_conflict then
        v_blockers := v_blockers || jsonb_build_object('rule', 'schedule_conflict', 'detail', 'overlapping_or_unavailable');
      else
        v_score := v_score + 20;
        v_reasons := v_reasons || jsonb_build_object('rule', 'available_window', 'weight', 20);
      end if;
    end if;

    -- (٦) المعدّات المملوكة
    if coalesce(public.tvn_bool(p_input, 'needs_equipment'), false)
       and jsonb_array_length(coalesce(r.equipment_owned, '[]'::jsonb)) > 0 then
      v_score := v_score + 8;
      v_reasons := v_reasons || jsonb_build_object('rule', 'equipment_owned', 'weight', 8);
    end if;

    -- (٧) التقييم — فقط إن بلغت العيّنة الحدّ الأدنى. لا ترتيب بعيّنة واحدة.
    v_rating := public.tvn_rating(r.id);
    if coalesce((v_rating ->> 'ranked')::boolean, false) then
      v_score := v_score + (coalesce((v_rating ->> 'overall')::numeric, 0) * 3);
      v_reasons := v_reasons || jsonb_build_object('rule', 'rating', 'weight',
                     round(coalesce((v_rating ->> 'overall')::numeric, 0) * 3, 2));
    else
      v_reasons := v_reasons || jsonb_build_object('rule', 'rating_not_ranked', 'weight', 0,
                     'detail', coalesce(v_rating ->> 'reason', 'insufficient_sample'));
    end if;

    -- (٨) الوثائق الإلزامية والمطلوبة للمهمّة
    v_missing := public.tvn_missing_required_docs(r.id);
    if cardinality(v_missing) > 0 then
      v_blockers := v_blockers || jsonb_build_object('rule', 'required_document_invalid', 'detail', to_jsonb(v_missing));
    end if;
    if cardinality(v_required) > 0 then
      foreach v_dt in array v_required loop
        if not public.tvn_doc_valid('profile', r.id, v_dt) then
          v_blockers := v_blockers || jsonb_build_object('rule', 'job_document_invalid', 'detail', v_dt);
        end if;
      end loop;
    end if;

    -- (٩) تصريح الدرون
    if v_drone and not public.tvn_doc_valid('profile', r.id, 'drone_permit') then
      v_blockers := v_blockers || jsonb_build_object('rule', 'drone_permit_missing', 'detail', 'drone_permit');
    end if;

    -- (١٠) نطاق السعر المصرَّح به — الترشيح يتمّ هنا داخل SECURITY DEFINER،
    --      والرقم نفسه لا يخرج إلّا لمن يملك can_view_vendor_rates().
    if v_band_max is not null then
      select r2.day_rate into v_day from public.tvn_profile_rates r2
       where r2.profile_id = r.id
         and (r2.valid_to is null or r2.valid_to >= current_date)
       order by r2.valid_from desc limit 1;
      if v_day is null then
        v_reasons := v_reasons || jsonb_build_object('rule', 'rate_unknown', 'weight', 0);
      elsif v_day <= v_band_max then
        v_score := v_score + 10;
        v_reasons := v_reasons || jsonb_build_object('rule', 'within_price_band', 'weight', 10);
      else
        v_blockers := v_blockers || jsonb_build_object('rule', 'above_price_band', 'detail', 'day_rate');
      end if;
    end if;

    v_rank := v_rank + 1;
    v_rows := v_rows || jsonb_build_object(
      'profile_id', r.id, 'display_name', r.display_name, 'profile_type', r.profile_type,
      'city', r.city, 'professions', r.professions,
      'score', round(v_score, 2), 'reasons', v_reasons, 'blockers', v_blockers,
      'assignable', (jsonb_array_length(v_blockers) = 0),
      'rating', v_rating,
      -- الرقم يظهر فقط للمخوَّل؛ وإلّا null صريح مع علم الرؤية، لا صفر.
      'day_rate', case when public.can_view_vendor_rates() then v_day else null end,
      'rate_visible', public.can_view_vendor_rates());
  end loop;

  -- الترتيب تنازليًّا حسب الدرجة، والمحجوبون في الذيل دائمًا، ثمّ القصّ على
  -- الحدّ الأقصى **بعد** الترتيب (القصّ قبله يُخفي الأفضل).
  select coalesce(jsonb_agg(el), '[]'::jsonb) into v_rows
    from (
      select el from jsonb_array_elements(v_rows) as t(el)
       order by (el ->> 'assignable')::boolean desc, (el ->> 'score')::numeric desc
       limit v_limit) s;

  return jsonb_build_object(
    'engine', 'rule_based',
    'auto_assign', false,
    'note_ar', 'اقتراح فقط. لا إسناد يحدث من هذه الدالّة — مدير العمليات يختار، ثمّ يُقترح الإسناد، ثمّ يُعتمد إن تجاوز الحدّ.',
    'candidates', v_rows);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١١) الإسناد — الموانع الصلبة تُفحَص عند الاقتراح **وعند التأكيد**.
--     الفحص مرّة واحدة عند الاقتراح لا يكفي: وثيقة تنتهي بين اللحظتين، أو
--     إسناد آخر يُؤكَّد قبلنا، فيصير الفحص القديم كذبًا موقَّعًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_assignment_guard(
  p_profile uuid, p_starts timestamptz, p_ends timestamptz,
  p_requires_drone boolean, p_required_docs text[], p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_status text; v_blk jsonb := '[]'::jsonb; v_missing text[]; t text;
begin
  select status into v_status from public.tvn_profiles where id = p_profile and is_deleted = false;
  if v_status is null then
    return jsonb_build_object('ok', false, 'blockers', jsonb_build_array(jsonb_build_object('rule', 'profile_not_found')));
  end if;

  if v_status in ('blocked','suspended','inactive','draft') then
    v_blk := v_blk || jsonb_build_object('rule', 'profile_not_assignable', 'detail', v_status);
  end if;

  v_missing := public.tvn_missing_required_docs(p_profile);
  if cardinality(v_missing) > 0 then
    v_blk := v_blk || jsonb_build_object('rule', 'required_document_invalid', 'detail', to_jsonb(v_missing));
  end if;

  if p_required_docs is not null then
    foreach t in array p_required_docs loop
      if not public.tvn_doc_valid('profile', p_profile, t) then
        v_blk := v_blk || jsonb_build_object('rule', 'job_document_invalid', 'detail', t);
      end if;
    end loop;
  end if;

  if coalesce(p_requires_drone, false) and not public.tvn_doc_valid('profile', p_profile, 'drone_permit') then
    v_blk := v_blk || jsonb_build_object('rule', 'drone_permit_missing', 'detail', 'drone_permit');
  end if;

  if public.tvn_has_conflict(p_profile, p_starts, p_ends, p_exclude) then
    v_blk := v_blk || jsonb_build_object('rule', 'schedule_conflict', 'detail', 'overlapping_or_unavailable');
  end if;

  return jsonb_build_object('ok', (jsonb_array_length(v_blk) = 0), 'blockers', v_blk);
end $$;

create or replace function public.tvn_assignment_propose(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid; v_start timestamptz; v_end timestamptz; v_drone boolean;
  v_docs text[]; v_cost numeric; v_thr numeric; v_guard jsonb; v_id uuid;
  v_status text; v_needs_approval boolean; v_num text;
begin
  if not public.can_assign_external_resources() then
    perform public.tvn_log('assignment_propose', 'assignment', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;

  v_profile := nullif(public.tvn_txt(p_input, 'profile_id'), '')::uuid;
  v_start   := nullif(public.tvn_txt(p_input, 'starts_at'), '')::timestamptz;
  v_end     := nullif(public.tvn_txt(p_input, 'ends_at'), '')::timestamptz;
  v_drone   := public.tvn_bool(p_input, 'requires_drone');
  v_docs    := public.tvn_arr(p_input, 'required_doc_types');
  v_cost    := public.tvn_num(p_input, 'cost_estimate');

  if v_profile is null or v_start is null or v_end is null then
    raise exception 'validation: profile_id و starts_at و ends_at إلزاميّة';
  end if;
  if v_end <= v_start then raise exception 'validation: نهاية المهمّة قبل بدايتها'; end if;

  -- قفل الصفّ: يمنع تأكيدين متزامنين من تجاوز فحص التعارض معًا.
  perform 1 from public.tvn_profiles where id = v_profile and is_deleted = false for update;

  v_guard := public.tvn_assignment_guard(v_profile, v_start, v_end, v_drone, v_docs, null);
  if not coalesce((v_guard ->> 'ok')::boolean, false) then
    perform public.tvn_log('assignment_propose', 'profile', v_profile, false, v_guard);
    raise exception 'assignment blocked: %', v_guard ->> 'blockers';
  end if;

  select cost_approval_threshold into v_thr from public.tvn_settings where id;
  v_thr := coalesce(v_thr, 5000);
  v_needs_approval := coalesce(v_cost, 0) > v_thr;
  v_status := case when v_needs_approval then 'pending_approval' else 'proposed' end;
  v_num := 'ASG-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into public.tvn_assignments(
    assignment_number, profile_id, project_id, job_title, role_profession, city,
    starts_at, ends_at, requires_drone, required_doc_types, status,
    cost_estimate, cost_basis, currency, approval_required, proposed_by, notes)
  values (v_num, v_profile, nullif(public.tvn_txt(p_input, 'project_id'), '')::uuid,
          public.tvn_txt(p_input, 'job_title'), public.tvn_txt(p_input, 'role_profession'),
          public.tvn_txt(p_input, 'city'), v_start, v_end, v_drone, v_docs, v_status,
          v_cost, public.tvn_txt(p_input, 'cost_basis'),
          coalesce(public.tvn_txt(p_input, 'currency'), 'SAR'),
          v_needs_approval, auth.uid(), public.tvn_txt(p_input, 'notes'))
  returning id into v_id;

  -- لقطة المرشّحين إن أُرسلت مع الطلب — لتفسير «لماذا هذا الاسم».
  if p_input ? 'candidates' and jsonb_typeof(p_input -> 'candidates') = 'array' then
    insert into public.tvn_assignment_candidates(assignment_id, profile_id, rank, score, reasons, blockers, generated_by)
    select v_id, (c ->> 'profile_id')::uuid, coalesce((c ->> 'rank')::int, 0),
           coalesce((c ->> 'score')::numeric, 0),
           coalesce(c -> 'reasons', '[]'::jsonb), coalesce(c -> 'blockers', '[]'::jsonb), auth.uid()
      from jsonb_array_elements(p_input -> 'candidates') c
     where (c ->> 'profile_id') is not null;
  end if;

  perform public.tvn_log('assignment_propose', 'assignment', v_id, true,
                         jsonb_build_object('profile', v_profile, 'status', v_status,
                                            'approval_required', v_needs_approval));
  perform public.tvn_emit('assignment_proposed', 'assignment', v_id,
                          jsonb_build_object('profile_id', v_profile, 'status', v_status),
                          'talent.assignment_proposed:' || v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id, 'assignment_number', v_num,
                            'status', v_status, 'approval_required', v_needs_approval);
end $$;

create or replace function public.tvn_assignment_approve(
  p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.tvn_can_approve_cost() then
    perform public.tvn_log('assignment_approve', 'assignment', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'validation: قرار غير معروف';
  end if;
  select * into a from public.tvn_assignments where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if a.status <> 'pending_approval' then
    raise exception 'conflict: هذا الإسناد ليس بانتظار اعتماد (%).', a.status;
  end if;
  -- من اقترح لا يعتمد اقتراحه.
  if a.proposed_by is not null and a.proposed_by = auth.uid() and not public.tvn_is_owner() then
    perform public.tvn_log('assignment_approve', 'assignment', p_id, false,
                           jsonb_build_object('reason', 'self_approval_blocked'));
    raise exception 'not authorized: مقترح الإسناد لا يعتمده';
  end if;

  update public.tvn_assignments
     set status = case when p_decision = 'approved' then 'approved' else 'rejected' end,
         approved_by = case when p_decision = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_decision = 'approved' then now() else approved_at end,
         approval_note = p_note,
         rejected_by = case when p_decision = 'rejected' then auth.uid() else rejected_by end,
         rejected_at = case when p_decision = 'rejected' then now() else rejected_at end,
         reject_reason = case when p_decision = 'rejected' then p_note else reject_reason end,
         updated_at = now()
   where id = p_id;

  perform public.tvn_log('assignment_approve', 'assignment', p_id, true,
                         jsonb_build_object('decision', p_decision));
  return jsonb_build_object('ok', true, 'id', p_id, 'decision', p_decision);
end $$;

create or replace function public.tvn_assignment_confirm(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_guard jsonb;
begin
  if not public.can_assign_external_resources() then
    perform public.tvn_log('assignment_confirm', 'assignment', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into a from public.tvn_assignments where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if a.status not in ('proposed','approved') then
    raise exception 'conflict: لا يمكن تأكيد إسناد حالته %.', a.status;
  end if;
  if a.approval_required and a.status <> 'approved' then
    raise exception 'conflict: التكلفة تتجاوز الحدّ وتحتاج اعتمادًا قبل التأكيد';
  end if;

  -- ★ إعادة الفحص عند التأكيد ★
  perform 1 from public.tvn_profiles where id = a.profile_id for update;
  v_guard := public.tvn_assignment_guard(a.profile_id, a.starts_at, a.ends_at,
                                         a.requires_drone, a.required_doc_types, a.id);
  if not coalesce((v_guard ->> 'ok')::boolean, false) then
    perform public.tvn_log('assignment_confirm', 'assignment', p_id, false, v_guard);
    raise exception 'assignment blocked: %', v_guard ->> 'blockers';
  end if;

  update public.tvn_assignments
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
   where id = p_id;

  perform public.tvn_log('assignment_confirm', 'assignment', p_id, true, '{}'::jsonb);
  perform public.tvn_emit('assignment_confirmed', 'assignment', p_id,
                          jsonb_build_object('profile_id', a.profile_id),
                          'talent.assignment_confirmed:' || p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'confirmed');
end $$;

create or replace function public.tvn_assignment_cancel(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_assign_external_resources() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'validation: سبب الإلغاء مطلوب';
  end if;
  update public.tvn_assignments
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = p_reason, updated_at = now()
   where id = p_id and status in ('proposed','pending_approval','approved','confirmed');
  if not found then raise exception 'conflict: لا يمكن إلغاء هذا الإسناد في حالته الحالية'; end if;
  perform public.tvn_log('assignment_cancel', 'assignment', p_id, true,
                         jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.tvn_assignment_complete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.can_assign_external_resources() then raise exception 'not authorized'; end if;
  select * into a from public.tvn_assignments where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if a.status <> 'confirmed' then
    raise exception 'conflict: يُغلَق الإسناد المؤكَّد فقط (الحالة %).', a.status;
  end if;

  update public.tvn_assignments
     set status = 'completed', completed_at = now(), updated_at = now() where id = p_id;

  perform public.tvn_log('assignment_complete', 'assignment', p_id, true, '{}'::jsonb);
  perform public.tvn_emit('performance_review_due', 'assignment', p_id,
                          jsonb_build_object('profile_id', a.profile_id),
                          'talent.performance_review_due:' || p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'completed');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٢) التقييمات — لا تقييم ذاتيّ، ولا تعديل بعد الإقفال، ولا حذف أبدًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tvn_review_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'التقييم لا يُحذَف. حذف تقييم لإخفاء حادثة ممنوع بنيويًّا — استخدم tvn_review_correct المُدقَّق.';
  end if;
  if old.status = 'closed' then
    raise exception 'التقييم مقفل ولا يُعدَّل. التصحيح يُلحَق عبر tvn_review_correct ويبقى الأصل كما هو.';
  end if;
  return new;
end $$;

drop trigger if exists trg_tvn_review_immutable on public.tvn_reviews;
create trigger trg_tvn_review_immutable
  before update or delete on public.tvn_reviews
  for each row execute function public.tvn_review_immutable();

create or replace function public.tvn_review_submit(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; v_id uuid; v_linked uuid;
begin
  if not public.can_review_resource_performance() then
    perform public.tvn_log('review_submit', 'review', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into a from public.tvn_assignments
   where id = nullif(public.tvn_txt(p_input, 'assignment_id'), '')::uuid;
  if not found then raise exception 'not found'; end if;
  if a.status not in ('completed','closed') then
    raise exception 'conflict: التقييم بعد إغلاق المهمّة فقط (الحالة %).', a.status;
  end if;

  -- ★ لا أحد يقيّم نفسه ★
  select linked_user_id into v_linked from public.tvn_profiles where id = a.profile_id;
  if v_linked is not null and v_linked = auth.uid() then
    perform public.tvn_log('review_submit', 'assignment', a.id, false,
                           jsonb_build_object('reason', 'self_review_blocked'));
    raise exception 'not authorized: لا أحد يقيّم نفسه';
  end if;

  insert into public.tvn_reviews(assignment_id, profile_id, reviewer_id,
    quality, attendance, timeliness, safety, communication, equipment_handling,
    client_conduct, notes, incident_reported, incident_severity, would_rehire, status)
  values (a.id, a.profile_id, auth.uid(),
    public.tvn_num(p_input, 'quality')::int, public.tvn_num(p_input, 'attendance')::int,
    public.tvn_num(p_input, 'timeliness')::int, public.tvn_num(p_input, 'safety')::int,
    public.tvn_num(p_input, 'communication')::int, public.tvn_num(p_input, 'equipment_handling')::int,
    public.tvn_num(p_input, 'client_conduct')::int, public.tvn_txt(p_input, 'notes'),
    public.tvn_bool(p_input, 'incident_reported'), public.tvn_txt(p_input, 'incident_severity'),
    case when p_input ? 'would_rehire' then public.tvn_bool(p_input, 'would_rehire') else null end,
    'submitted')
  on conflict (assignment_id, reviewer_id) do update set
    quality = excluded.quality, attendance = excluded.attendance,
    timeliness = excluded.timeliness, safety = excluded.safety,
    communication = excluded.communication, equipment_handling = excluded.equipment_handling,
    client_conduct = excluded.client_conduct, notes = excluded.notes,
    incident_reported = excluded.incident_reported, incident_severity = excluded.incident_severity,
    would_rehire = excluded.would_rehire, updated_at = now()
  returning id into v_id;

  -- حادثة مُبلَّغ عنها تُرفَع كعلَم للمراجعة البشرية. ★ ولا تحظر أحدًا تلقائيًّا ★
  if public.tvn_bool(p_input, 'incident_reported') then
    insert into public.tvn_incident_flags(profile_id, source, review_id, severity, summary, raised_by)
    values (a.profile_id, 'review', v_id,
            coalesce(public.tvn_txt(p_input, 'incident_severity'), 'low'),
            coalesce(public.tvn_txt(p_input, 'notes'), 'incident reported in review'), auth.uid());
  end if;

  perform public.tvn_log('review_submit', 'review', v_id, true,
                         jsonb_build_object('assignment', a.id));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'submitted');
end $$;

create or replace function public.tvn_review_close(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_review_resource_performance() then raise exception 'not authorized'; end if;
  select * into r from public.tvn_reviews where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if r.status = 'closed' then
    return jsonb_build_object('ok', true, 'id', p_id, 'status', 'closed', 'already', true);
  end if;
  update public.tvn_reviews
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), updated_at = now()
   where id = p_id;
  perform public.tvn_log('review_close', 'review', p_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'closed');
end $$;

-- التصحيح المُدقَّق: يُلحَق ولا يُعدِّل الصفّ المقفل. القراءة الفعّالة تطبّقه.
create or replace function public.tvn_review_correct(
  p_id uuid, p_field text, p_new_value text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_old text; v_id uuid;
begin
  if not (public.tvn_is_owner() or public.can_review_resource_performance()) then
    perform public.tvn_log('review_correct', 'review', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'validation: سبب التصحيح مكتوب وإلزاميّ (٢٠ حرفًا فأكثر)';
  end if;
  if p_field not in ('quality','attendance','timeliness','safety','communication',
                     'equipment_handling','client_conduct','would_rehire','notes',
                     'incident_reported','incident_severity') then
    raise exception 'validation: حقل غير قابل للتصحيح';
  end if;
  select * into r from public.tvn_reviews where id = p_id;
  if not found then raise exception 'not found'; end if;

  execute format('select (%I)::text from public.tvn_reviews where id = $1', p_field)
    into v_old using p_id;

  insert into public.tvn_review_corrections(review_id, field_key, old_value, new_value, reason, corrected_by)
  values (p_id, p_field, v_old, p_new_value, p_reason, auth.uid())
  returning id into v_id;

  perform public.tvn_log('review_correct', 'review', p_id, true,
                         jsonb_build_object('field', p_field, 'correction', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'note',
    'الصفّ الأصليّ لم يُمسّ. التصحيح مُلحَق ومُدقَّق.');
end $$;

-- قراءة التقييمات: داخلية بحتة في V1. لا يراها المُقيَّم ولا العميل.
-- ⚠️ ليست stable عمدًا: قراءة التقييمات الداخلية حدث يستحقّ التدقيق، ومحاولة
--    صاحب الملفّ قراءتها تُسجَّل. الكتابة تمنع تعليمها غير متغيّرة.
create or replace function public.tvn_reviews_for_profile(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_linked uuid; v_rows jsonb;
begin
  if not public.can_review_resource_performance() then
    perform public.tvn_log('reviews_read', 'profile', p_profile, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select linked_user_id into v_linked from public.tvn_profiles where id = p_profile;
  if v_linked is not null and v_linked = auth.uid() and not public.tvn_is_owner() then
    perform public.tvn_log('reviews_read', 'profile', p_profile, false,
                           jsonb_build_object('reason', 'subject_cannot_read_own_reviews'));
    raise exception 'not authorized: التقييم الداخليّ لا يراه صاحبه في الإصدار الأوّل';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'assignment_id', v.assignment_id, 'status', v.status,
           'review_date', v.review_date, 'quality', v.quality, 'attendance', v.attendance,
           'timeliness', v.timeliness, 'safety', v.safety, 'communication', v.communication,
           'equipment_handling', v.equipment_handling, 'client_conduct', v.client_conduct,
           'would_rehire', v.would_rehire, 'incident_reported', v.incident_reported,
           'notes', v.notes,
           'corrections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.corrected_at), '[]'::jsonb)
                             from public.tvn_review_corrections c where c.review_id = v.id))
         order by v.review_date desc), '[]'::jsonb) into v_rows
    from public.tvn_reviews v where v.profile_id = p_profile;

  return jsonb_build_object('rows', v_rows, 'rating', public.tvn_rating(p_profile));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٣) الترقية اليدوية من سطح الفرص + جسر المورّد
-- ════════════════════════════════════════════════════════════════════════════
-- ★ يدويّ بالكامل ★ لا مُشغِّل، ولا مهمّة مجدولة، ولا بريد. تُستدعى بيد إنسان
--   يملك can_manage_talent_profiles بعد قرار قبول مُتَّخَذ خارج النظام.
create or replace function public.tvn_promote_opportunity(
  p_request uuid, p_profile_type text, p_overrides jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_email text; v_phone text; v_city text; v_id uuid; v_code text;
begin
  if not public.can_manage_talent_profiles() then
    perform public.tvn_log('promote_opportunity', 'opportunity_request', p_request, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if to_regclass('public.opportunity_requests') is null then
    raise exception 'feature unavailable: سطح الفرص غير مثبَّت';
  end if;
  if p_profile_type is null then raise exception 'validation: profile_type إلزاميّ'; end if;

  execute 'select full_name, email, phone, city from public.opportunity_requests where id = $1 and is_deleted = false'
    into v_name, v_email, v_phone, v_city using p_request;
  if v_name is null then raise exception 'not found'; end if;

  if exists (select 1 from public.tvn_profiles
              where source_opportunity_request_id = p_request and is_deleted = false) then
    raise exception 'conflict: هذا الطلب مُرقّى مسبقًا إلى ملفّ في الشبكة';
  end if;

  v_code := 'TVN-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  insert into public.tvn_profiles(profile_code, profile_type, display_name, primary_email,
    primary_phone, city, status, source_opportunity_request_id, source_note, created_by, updated_by)
  values (v_code, p_profile_type,
          coalesce(public.tvn_txt(p_overrides, 'display_name'), v_name),
          coalesce(public.tvn_txt(p_overrides, 'primary_email'), v_email),
          coalesce(public.tvn_txt(p_overrides, 'primary_phone'), v_phone),
          coalesce(public.tvn_txt(p_overrides, 'city'), v_city),
          'draft', p_request, 'promoted manually from opportunity request',
          auth.uid(), auth.uid())
  returning id into v_id;

  perform public.tvn_log('promote_opportunity', 'profile', v_id, true,
                         jsonb_build_object('request', p_request, 'profile_type', p_profile_type));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'draft',
    'note', 'لم يُرسَل أيّ إشعار أو بريد. سطح الفرص لم يُعدَّل.');
end $$;

-- الجسر: صفّ الشراء وملفّ الشبكة كيان واحد.
create or replace function public.tvn_vendor_link(p_profile uuid, p_vendor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.can_manage_talent_profiles() then raise exception 'not authorized'; end if;
  if to_regclass('public.custody_vendors') is null then
    return jsonb_build_object('ok', false, 'reason', 'vendor_table_absent',
      'note', 'ترقيع custody_enterprise_07 غير مطبَّق — الجسر غير متاح، ولم يُنشأ جدول مورّدين بديل.');
  end if;
  if not exists (select 1 from public.tvn_profiles where id = p_profile and is_deleted = false) then
    raise exception 'not found';
  end if;
  execute 'update public.custody_vendors set tvn_profile_id = $1 where id = $2'
    using p_profile, p_vendor;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'not found: مورّد غير موجود'; end if;
  perform public.tvn_log('vendor_link', 'profile', p_profile, true,
                         jsonb_build_object('vendor', p_vendor));
  return jsonb_build_object('ok', true, 'profile_id', p_profile, 'vendor_id', p_vendor);
end $$;

-- مسح دوريّ للتوافر والتقييمات المستحقّة — إدراج أحداث فقط.
create or replace function public.tvn_scan_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_avail int := 0; v_rev int := 0; v_days int;
begin
  if not (public.tvn_is_owner() or public.can_manage_talent_profiles()) then
    raise exception 'not authorized';
  end if;
  select availability_confirm_days into v_days from public.tvn_settings where id;
  v_days := coalesce(v_days, 7);

  for r in select av.id, av.profile_id from public.tvn_availability av
            where av.confirmation_status in ('unconfirmed','pending')
              and av.starts_on between current_date and (current_date + v_days)
  loop
    perform public.tvn_emit('availability_confirmation_required', 'availability', r.id,
                            jsonb_build_object('profile_id', r.profile_id),
                            'talent.availability_confirmation_required:' || r.id::text || ':' || current_date::text);
    v_avail := v_avail + 1;
  end loop;

  for r in select a.id, a.profile_id from public.tvn_assignments a
            where a.status = 'completed'
              and not exists (select 1 from public.tvn_reviews v where v.assignment_id = a.id)
  loop
    perform public.tvn_emit('performance_review_due', 'assignment', r.id,
                            jsonb_build_object('profile_id', r.profile_id),
                            'talent.performance_review_due:' || r.id::text || ':' || to_char(now(), 'IYYY-IW'));
    v_rev := v_rev + 1;
  end loop;

  perform public.tvn_log('scan_alerts', null, null, true,
                         jsonb_build_object('availability', v_avail, 'reviews', v_rev));
  return jsonb_build_object('availability_considered', v_avail, 'reviews_considered', v_rev,
    'note_ar', 'أحداث مُدرَجة فقط. لا إرسال من هنا.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٤) RLS + الصلاحيات — قراءة عبر السياسات، وكتابة عبر RPC وحدها. لا anon.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['tvn_settings','tvn_profiles','tvn_profile_rates','tvn_profile_bank',
                           'tvn_profile_restricted','tvn_availability','tvn_document_types',
                           'tvn_documents','tvn_assignments','tvn_assignment_candidates',
                           'tvn_reviews','tvn_review_corrections','tvn_incident_flags',
                           'tvn_audit','tvn_event_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- الأدوار قد لا تكون موجودة خارج Supabase؛ غيابها ليس سببًا لإسقاط ترحيلة.
    begin execute format('revoke all on public.%I from anon', t);
    exception when undefined_object then null; end;
    begin execute format('revoke all on public.%I from authenticated', t);
    exception when undefined_object then null; end;
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;

drop policy if exists tvn_settings_read on public.tvn_settings;
create policy tvn_settings_read on public.tvn_settings for select to authenticated
  using (public.can_view_talent_network());

drop policy if exists tvn_profiles_read on public.tvn_profiles;
create policy tvn_profiles_read on public.tvn_profiles for select to authenticated
  using (public.can_view_talent_network());

-- ★ الأجر ★ سياسة مستقلّة وأضيق. طاقم العمل والعميل لا يمرّان من هنا.
drop policy if exists tvn_rates_read on public.tvn_profile_rates;
create policy tvn_rates_read on public.tvn_profile_rates for select to authenticated
  using (public.can_view_vendor_rates());

drop policy if exists tvn_bank_read on public.tvn_profile_bank;
create policy tvn_bank_read on public.tvn_profile_bank for select to authenticated
  using (public.tvn_can_view_bank());

drop policy if exists tvn_restricted_read on public.tvn_profile_restricted;
create policy tvn_restricted_read on public.tvn_profile_restricted for select to authenticated
  using (public.can_verify_compliance());

drop policy if exists tvn_avail_read on public.tvn_availability;
create policy tvn_avail_read on public.tvn_availability for select to authenticated
  using (public.can_view_talent_network());

drop policy if exists tvn_doctypes_read on public.tvn_document_types;
create policy tvn_doctypes_read on public.tvn_document_types for select to authenticated
  using (public.can_view_talent_network());

-- وثائق الهوية والبيانات المالية لا تظهر لغير المخوَّل، حتّى بيانَاتُها الوصفية.
drop policy if exists tvn_docs_read on public.tvn_documents;
create policy tvn_docs_read on public.tvn_documents for select to authenticated
  using (coalesce(
    case when restricted then (public.can_verify_compliance() or public.tvn_can_view_bank())
         else public.can_view_talent_network() end, false));

drop policy if exists tvn_asg_read on public.tvn_assignments;
create policy tvn_asg_read on public.tvn_assignments for select to authenticated
  using (public.can_view_talent_network());

drop policy if exists tvn_cand_read on public.tvn_assignment_candidates;
create policy tvn_cand_read on public.tvn_assignment_candidates for select to authenticated
  using (public.can_view_talent_network());

drop policy if exists tvn_reviews_read on public.tvn_reviews;
create policy tvn_reviews_read on public.tvn_reviews for select to authenticated
  using (public.can_review_resource_performance());

drop policy if exists tvn_corr_read on public.tvn_review_corrections;
create policy tvn_corr_read on public.tvn_review_corrections for select to authenticated
  using (public.can_review_resource_performance());

drop policy if exists tvn_flags_read on public.tvn_incident_flags;
create policy tvn_flags_read on public.tvn_incident_flags for select to authenticated
  using (public.can_view_talent_network());

drop policy if exists tvn_audit_read on public.tvn_audit;
create policy tvn_audit_read on public.tvn_audit for select to authenticated
  using (public.tvn_is_owner());

drop policy if exists tvn_evt_read on public.tvn_event_log;
create policy tvn_evt_read on public.tvn_event_log for select to authenticated
  using (public.tvn_is_owner() or public.can_view_talent_network());

-- صلاحيات التنفيذ. تقسيم مقصود:
--   • واجهة عامّة (authenticated) — كلّ دالّة فيها تفحص بوّابتها بنفسها.
--   • دوالّ داخلية — ★ لا تُمنَح لأحد ★ فهي SECURITY DEFINER بلا بوّابة داخلية،
--     ومنحها لـauthenticated يعني أنّ عميلًا يستطيع استدعاء tvn_rating أو
--     tvn_doc_valid على أيّ ملفّ ويستخرج الشبكة صفًّا صفًّا. استدعاؤها من داخل
--     دوالّ الواجهة يعمل لأنّ الدالّة المُعرِّفة تنفَّذ بصلاحية مالكها.
do $grants$
declare f text;
begin
  foreach f in array array[
    'tvn_access()','tvn_profile_get(uuid)','tvn_profile_list(jsonb)','tvn_profile_upsert(jsonb)',
    'tvn_profile_set_status(uuid,text,text)','tvn_rates_set(uuid,jsonb)','tvn_bank_set(uuid,jsonb)',
    'tvn_restricted_set(uuid,text,text)','tvn_availability_set(jsonb)','tvn_availability_confirm(uuid,text)',
    'tvn_document_upsert(jsonb)','tvn_document_verify(uuid,text)','tvn_document_alerts(boolean)',
    'tvn_suggest(jsonb)','tvn_assignment_propose(jsonb)','tvn_assignment_approve(uuid,text,text)',
    'tvn_assignment_confirm(uuid)','tvn_assignment_cancel(uuid,text)','tvn_assignment_complete(uuid)',
    'tvn_review_submit(jsonb)','tvn_review_close(uuid)','tvn_review_correct(uuid,text,text,text)',
    'tvn_reviews_for_profile(uuid)','tvn_promote_opportunity(uuid,text,jsonb)',
    'tvn_vendor_link(uuid,uuid)','tvn_scan_alerts()',
    'can_view_talent_network()','can_manage_talent_profiles()','can_view_vendor_rates()',
    'can_verify_compliance()','can_assign_external_resources()','can_review_resource_performance()',
    'tvn_can_view_bank()','tvn_can_approve_cost()']
  loop
    execute format('revoke all on function public.%s from public', f);
    begin execute format('revoke all on function public.%s from anon', f); exception when undefined_object then null; end;
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  foreach f in array array[
    'tvn_rating(uuid)','tvn_doc_valid(text,uuid,text)','tvn_missing_required_docs(uuid)',
    'tvn_has_conflict(uuid,timestamptz,timestamptz,uuid)',
    'tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)',
    'tvn_emit(text,text,uuid,jsonb,text)','tvn_log(text,text,uuid,boolean,jsonb)',
    'tvn_perm(text)','tvn_is_staff()','tvn_is_owner()',
    'tvn_txt(jsonb,text)','tvn_num(jsonb,text)','tvn_bool(jsonb,text,boolean)','tvn_arr(jsonb,text)',
    'tvn_event_keys()','tvn_asset_event_keys()','tvn_review_immutable()']
  loop
    execute format('revoke all on function public.%s from public', f);
    begin execute format('revoke all on function public.%s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function public.%s from authenticated', f); exception when undefined_object then null; end;
  end loop;
end $grants$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٥) SELF-TEST — ★ ساكن بالكامل ★
-- لا استدعاء لدالّة محميّة: المحرّر يعمل بدور postgres و auth.uid() = NULL،
-- فاستدعاء بوّابة حيّة يرفع «not authorized» ويُسقط الترحيلة. كلّ تأكيد أدناه
-- يقرأ **تعريف** الكائن. والـdeparser يرفع حالة الكلمات المفتاحية، فالمطابقة
-- على مُعرِّفات صغيرة الحروف. ولا مصيدة catch-all: كلّ سطر قادر على الفشل.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare d text; n int; t text;
begin
  -- (١) الجداول موجودة
  foreach t in array array['tvn_profiles','tvn_profile_rates','tvn_profile_bank',
                           'tvn_profile_restricted','tvn_availability','tvn_documents',
                           'tvn_document_types','tvn_assignments','tvn_assignment_candidates',
                           'tvn_reviews','tvn_review_corrections','tvn_incident_flags',
                           'tvn_audit','tvn_event_log','tvn_settings']
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'SELF-TEST: الجدول % مفقود', t;
    end if;
  end loop;

  -- (٢) ★ الجندر خارج كلّ مسار تقييم أو ترشيح ★
  foreach t in array array['tvn_suggest(jsonb)','tvn_rating(uuid)',
                           'tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)',
                           'tvn_profile_list(jsonb)']
  loop
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d ilike '%gender%' or d ilike '%tvn_profile_restricted%' then
      raise exception 'SELF-TEST: % تقرأ حقلًا مقيَّدًا — الجندر ممنوع في مسارات التقييم والترشيح', t;
    end if;
  end loop;

  -- (٣) موانع الإسناد الأربعة موجودة نصًّا في الحارس
  d := pg_get_functiondef(to_regprocedure('public.tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)'));
  if d not ilike '%profile_not_assignable%' then raise exception 'SELF-TEST: الحارس لا يمنع الملفّ المحظور'; end if;
  if d not ilike '%required_document_invalid%' then raise exception 'SELF-TEST: الحارس لا يمنع الوثيقة المنتهية'; end if;
  if d not ilike '%schedule_conflict%' then raise exception 'SELF-TEST: الحارس لا يمنع التعارض الزمنيّ'; end if;
  if d not ilike '%drone_permit_missing%' then raise exception 'SELF-TEST: الحارس لا يمنع غياب تصريح الدرون'; end if;

  -- (٤) التأكيد يعيد تشغيل الحارس (لا يكتفي بفحص الاقتراح)
  d := pg_get_functiondef(to_regprocedure('public.tvn_assignment_confirm(uuid)'));
  if d not ilike '%tvn_assignment_guard%' then
    raise exception 'SELF-TEST: التأكيد لا يعيد فحص الموانع — نافذة TOCTOU مفتوحة';
  end if;
  if d not ilike '%for update%' then
    raise exception 'SELF-TEST: التأكيد بلا قفل صفّ — تأكيدان متزامنان يتجاوزان فحص التعارض';
  end if;

  -- (٥) صلاحية الوثيقة = موثَّقة + غير منتهية
  d := pg_get_functiondef(to_regprocedure('public.tvn_doc_valid(text,uuid,text)'));
  if d not ilike '%verified = true%' or d not ilike '%expires_on%' then
    raise exception 'SELF-TEST: الرفع وحده يُعامَل كتوثيق';
  end if;

  -- (٦) لا حذف ولا تعديل بعد الإقفال
  select count(*) into n from pg_trigger
   where tgrelid = 'public.tvn_reviews'::regclass and tgname = 'trg_tvn_review_immutable';
  if n <> 1 then raise exception 'SELF-TEST: حارس عدم قابلية التقييم للتعديل مفقود'; end if;
  d := pg_get_functiondef(to_regprocedure('public.tvn_review_immutable()'));
  if d not ilike '%delete%' then raise exception 'SELF-TEST: حذف التقييم غير ممنوع'; end if;

  -- (٧) لا أحد يقيّم نفسه، ولا يوثّق ملفّه
  d := pg_get_functiondef(to_regprocedure('public.tvn_review_submit(jsonb)'));
  if d not ilike '%linked_user_id%' then raise exception 'SELF-TEST: التقييم الذاتيّ غير ممنوع'; end if;
  d := pg_get_functiondef(to_regprocedure('public.tvn_document_verify(uuid,text)'));
  if d not ilike '%uploaded_by%' then raise exception 'SELF-TEST: صاحب الملفّ يستطيع توثيقه'; end if;

  -- (٨) قيد البيانات البنكية الوصفية قائم
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_profile_bank'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%iban_last4%';
  if n < 1 then raise exception 'SELF-TEST: لا قيد يمنع تخزين IBAN كامل'; end if;

  -- (٩) قيد «صاحب الملفّ لا يوثّق ملفّه» قائم على مستوى الجدول
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_verify_not_self';
  if n <> 1 then raise exception 'SELF-TEST: قيد منع التوثيق الذاتيّ مفقود'; end if;

  -- (١٠) الحدّ الأدنى للعيّنة يحكم الترتيب
  d := pg_get_functiondef(to_regprocedure('public.tvn_rating(uuid)'));
  if d not ilike '%insufficient_sample%' then
    raise exception 'SELF-TEST: التقييم المجمَّع يُرتِّب بلا عيّنة كافية';
  end if;

  -- (١١) الاقتراح لا يُسند
  d := pg_get_functiondef(to_regprocedure('public.tvn_suggest(jsonb)'));
  if d ilike '%insert into public.tvn_assignments%' then
    raise exception 'SELF-TEST: محرّك الاقتراح يكتب إسنادًا — الإسناد التلقائيّ ممنوع';
  end if;
  if d not ilike '%rule_based%' then raise exception 'SELF-TEST: المحرّك لا يصرّح بأنّه قاعديّ'; end if;

  -- (١٢) لا تفعيل قنوات ولا إرسال من هذا الملفّ
  d := pg_get_functiondef(to_regprocedure('public.tvn_emit(text,text,uuid,jsonb,text)'));
  if d ilike '%comms_channel_set%' or d ilike '%dry_run%' then
    raise exception 'SELF-TEST: مسار الأحداث يلمس إعدادات القنوات';
  end if;
  if d not ilike '%idempotency_key%' then raise exception 'SELF-TEST: الأحداث بلا منع تكرار'; end if;

  -- (١٣) كلّ المُسنَدات تعيد boolean
  foreach t in array array['can_view_talent_network()','can_manage_talent_profiles()',
                           'can_view_vendor_rates()','can_verify_compliance()',
                           'can_assign_external_resources()','can_review_resource_performance()',
                           'tvn_can_view_bank()','tvn_can_approve_cost()','tvn_perm(text)',
                           'tvn_doc_valid(text,uuid,text)',
                           'tvn_has_conflict(uuid,timestamptz,timestamptz,uuid)']
  loop
    if (select p.prorettype <> 'boolean'::regtype from pg_proc p
         where p.oid = to_regprocedure('public.' || t)) then
      raise exception 'SELF-TEST: المُسنَد % لا يعيد boolean', t;
    end if;
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d not ilike '%coalesce%' and d not ilike '%return false%' then
      raise exception 'SELF-TEST: المُسنَد % قد يعيد NULL', t;
    end if;
  end loop;

  -- (١٤) لا صلاحية anon على أيّ جدول من الوحدة
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and table_name like 'tvn\_%';
  if n > 0 then raise exception 'SELF-TEST: توجد صلاحية anon على جداول الوحدة'; end if;

  -- (١٥) لا سياسة كتابة مباشرة على أيّ جدول
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename like 'tvn\_%' and cmd <> 'SELECT';
  if n > 0 then raise exception 'SELF-TEST: سياسة كتابة مباشرة موجودة — الكتابة عبر RPC وحدها'; end if;

  -- (١٦) الدوالّ الداخلية غير قابلة للتنفيذ من العميل
  -- (يُتخطّى الفحص إن لم يكن الدور موجودًا أصلًا — خارج Supabase مثلًا.)
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach t in array array['tvn_rating(uuid)','tvn_doc_valid(text,uuid,text)',
                             'tvn_emit(text,text,uuid,jsonb,text)','tvn_log(text,text,uuid,boolean,jsonb)']
    loop
      if has_function_privilege('authenticated', to_regprocedure('public.' || t), 'EXECUTE') then
        raise exception 'SELF-TEST: الدالّة الداخلية % منفَّذة من authenticated', t;
      end if;
    end loop;
  end if;

  -- (١٧) سياسة الأجر أضيق من سياسة الشبكة — لا تتّسع بالخطأ
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'tvn_profile_rates'
     and qual ilike '%can_view_vendor_rates%';
  if n <> 1 then raise exception 'SELF-TEST: سياسة الأجر لا تستند إلى can_view_vendor_rates'; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'tvn_profile_rates'
     and qual ilike '%can_view_talent_network%';
  if n > 0 then raise exception 'SELF-TEST: سياسة الأجر تتّسع لكلّ من يرى الشبكة'; end if;

  raise notice 'TALENT SELF-TEST: كلّ التأكيدات مرّت.';
end $st$;

commit;

notify pgrst, 'reload schema';
