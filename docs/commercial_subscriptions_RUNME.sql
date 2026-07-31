-- ════════════════════════════════════════════════════════════════════════════
-- commercial_subscriptions_RUNME.sql
-- المرحلة ١+٢ من النمو التجاريّ: خطط الاشتراك ودفتر أرصدة الإنتاج.
--
-- ─── ما هذه الحزمة ─────────────────────────────────────────────────────────
--   خطط اشتراك ذات إصدارات، واشتراكات عملاء بدورة حياة محكومة، ودفتر أرصدة
--   **محاسبيّ** لوحدات الإنتاج (يوم تصوير، ريل، ساعة مونتاج …).
--
-- ─── عقود لا تُلطَّف ───────────────────────────────────────────────────────
--   ١) الدفتر ليس رقمًا قابلًا للتعديل. `csub_ledger` **غير قابل للتحديث ولا
--      الحذف ولا التفريغ** — مُشغِّل يرفع 0A000 على UPDATE/DELETE/TRUNCATE.
--      التصحيح يقع بقيد عكسيّ مستقلّ (csub_reverse) يُبقي الخطأ وتصحيحه معًا
--      في السجلّ. هذا هو الفرق بين دفتر وحقل.
--   ٢) الرصيد **مشتقّ** من مجموع القيود، لا عمود محفوظ. لا يوجد عمود
--      `balance` في أيّ جدول — والـSELF-TEST يفشل إن ظهر.
--   ٣) **لا عميل ولا موظّف مبيعات يُفعّل اشتراكًا.** التفعيل والتجديد وزيادة
--      الرصيد اليدوية: `csub_can_approve()` = المالك/الأدمن حصرًا، وهي **ليست**
--      مفتاح صلاحية فلا تُمنح لأحد. الفرض في الـRPC لا في الواجهة.
--   ٤) `auto_renew` **معلومة لا آلية**. لا دالّة تجديد أو تفعيل أو تخصيص تقرأ
--      هذا العمود إطلاقًا — والـSELF-TEST يفشل إن قرأته. لا شحن، ولا نداء خارجيّ.
--   ٥) الضريبة حقل مستقلّ دائمًا (`vat_rate` + `vat_amount`)، والإجمالي عمود
--      **مولَّد** = الصافي + الضريبة فلا يُكتب يدويًّا ولا تُطوى الضريبة في مجموع.
--      العملة SAR وحدها، بقيد CHECK.
--   ٦) **لا عمود تكلفة ولا هامش ولا ربح في هذا الموديول إطلاقًا** — والـSELF-TEST
--      يفشل إن ظهر. استنتاج الربحية يبقى مستحيلًا بنيويًّا لا بالوعد.
--
-- ─── ستّة استحالات — على الخادم وداخل معاملة واحدة ────────────────────────
--   • رصيد متاح سالب بلا `allow_overage`            → insufficient_balance
--   • استهلاك مزدوج                                  → مفتاح تكرار فريد + صافي
--                                                      الاستهلاك لكلّ طلب خدمة
--   • إعادة استعمال مفتاح تكرار                      → فهرس فريد + بصمة الحمولة
--   • استهلاك من اشتراك منتهٍ                        → حالة + تواريخ + مهلة سماح
--   • استهلاك رصيد عميل لحساب عميل آخر               → مُشغِّل يشتقّ client_id من
--                                                      الاشتراك ويرفض أيّ خلاف
--   • تجاوز المتاح بلا اعتماد تجاوز                   → طلب اعتماد مالك، ولا يُكتب
--                                                      قيد واحد قبل الاعتماد
--   • سباق بين استهلاكين متزامنين                    → `select … for update` على
--     صفّ الاشتراك ثمّ صفّ الوحدة بترتيب ثابت (لا جمود)، والرصيد يُحسب **بعد**
--     القفل. يعمل تحت read committed ولا يعتمد على serializable.
--
-- ─── الحدّ مع منصّة المشاريع المجمَّدة ─────────────────────────────────────
--   `project_id` مرجع **اختياريّ للقراءة فقط**: بلا مفتاح خارجيّ، ولا دالّة هنا
--   تُنشئ مشروعًا ولا تعدّله ولا تغيّر مرحلته ولا تُنشئ تسليمًا. الـSELF-TEST
--   يفحص كلّ تعريف دالّة csub_* ويفشل عند أيّ كتابة في المنصّة.
--
-- ─── ملاحظة تشغيلية: الـSELF-TEST ثابت ─────────────────────────────────────
--   محرّر SQL يعمل بدور postgres وauth.uid() = NULL، فاستدعاء دالّة محميّة يرفع
--   «not authorized» ويُسقط ترحيلة ناجحة. لذلك كلّ فحص هنا بنيويّ:
--   pg_get_functiondef + ilike، وpg_catalog، ومُسنَدات تُستدعى بلا جلسة وتعيد
--   false بلا استثناء. ولا مصيدة تجعل فحصًا يمرّ عند غياب هدفه.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) PREFLIGHT صلب — الاعتمادات التي لا تُحاكى ─────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('public.clients')  is null then miss := miss || ' clients';  end if;
  if to_regclass('public.profiles') is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.is_staff()')     is null then miss := miss || ' is_staff()';     end if;
  if to_regprocedure('public.is_owner()')     is null then miss := miss || ' is_owner()';     end if;
  if to_regprocedure('public.is_admin()')     is null then miss := miss || ' is_admin()';     end if;
  if to_regprocedure('public.my_client_id()') is null then miss := miss || ' my_client_id()'; end if;
  if miss <> '' then
    raise exception 'COMMERCIAL SUBSCRIPTIONS PREFLIGHT: اعتمادات ناقصة —%. شغّل phase0_migration.sql أوّلًا. لم يُكتب شيء.', miss;
  end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then
    raise notice 'CSUB: محرّك الصلاحيات غير مطبَّق — سيعمل المالك/الأدمن فقط حتى تُشغّل permission_catalog_RUNME.sql (fail-closed).';
  end if;
  if to_regclass('public.notifications') is null then
    raise notice 'CSUB: جدول الإشعارات غير موجود — لا إشعار داخل التطبيق، ولا يسقط قيد واحد بسبب ذلك.';
  end if;
  if to_regclass('public.projects') is null then
    raise notice 'CSUB: جدول projects غير موجود — مرجع المشروع الاختياريّ يبقى بلا ربط (وهو مرجع قراءة أصلًا).';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--     ★ ما ليس مفتاحًا: اعتماد المالك. لا يوجد `csub.approve` ولن يوجد.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'CSUB §1: جدول permissions غير موجود — تخطّي بذر المفاتيح.';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'commercial', v.sens, v.ord, v.ar, v.en
  from (values
    (1410,'csub.view',         'normal',   'عرض الاشتراكات والأرصدة',      'View subscriptions & credits'),
    (1420,'csub.manage',       'sensitive','إدارة الخطط والاشتراكات',      'Manage plans & subscriptions'),
    (1430,'csub.consume',      'sensitive','حجز واستهلاك رصيد الإنتاج',    'Reserve & consume credits'),
    (1440,'csub.adjust',       'sensitive','تسوية يدوية على الدفتر',       'Manual ledger adjustment'),
    (1450,'csub.view_pricing', 'sensitive','رؤية أسعار الاشتراكات والضريبة','View subscription pricing & VAT'),
    (1460,'csub.export',       'normal',   'تصدير كشوف الأرصدة',           'Export credit statements')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) مُسنَدات الجلسة — خاصّة بالموديول. لا واحد منها يعيد NULL.
--     ⚠️ لا can_manage_projects ولا is_kian_member كبوّابة هنا: هذا موديول
--        تجاريّ لا موديول مشاريع، وربط البوّابتين يوسّع دائرة الانفجار.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (fail-closed) لا استثناء.
-- المصيدة هنا تُفشِل ولا تُنجِح.
create or replace function public.csub_perm(p_key text) returns boolean
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

create or replace function public.csub_perm_key_exists(p_key text) returns boolean
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

create or replace function public.csub_is_owner_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null)
    and (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)), false);
$$;

-- ★★ البوّابة الوحيدة التي يقع عندها منح رصيد أو تفعيل اشتراك ★★
--    عمدًا بلا مفتاح صلاحية: لو كانت مفتاحًا لأمكن منحها، ولانتهت «موافقة
--    المالك» إلى منحة إداريّة تُعطى مرّة وتُنسى. الـSELF-TEST يفشل إن ظهر
--    csub_perm داخل هذا التعريف.
create or replace function public.csub_can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and coalesce(public.csub_is_owner_role(), false),
  false);
$$;

create or replace function public.csub_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.manage'), false)),
  false);
$$;

create or replace function public.csub_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.manage'), false)
      or coalesce(public.csub_perm('csub.view'), false)),
  false);
$$;

create or replace function public.csub_can_consume() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.consume'), false)),
  false);
$$;

create or replace function public.csub_can_adjust() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.adjust'), false)),
  false);
$$;

-- المال يُقنَّع ولا يُصفَّر: من لا يملك هذا المفتاح يتلقّى NULL مع
-- pricing_visible = false، لا صفرًا يوهم بأنّ السعر صفر.
create or replace function public.csub_can_view_pricing() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.view_pricing'), false)),
  false);
$$;

create or replace function public.csub_can_export() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.csub_is_owner_role(), false)
      or coalesce(public.csub_perm('csub.export'), false)),
  false);
$$;

create or replace function public.csub_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — أحد عشر جدولًا، كلّها csub_*.
--     المُسنَدات التي تقرأ جداول تأتي بعدها (§4): PostgreSQL يتحقّق من أجسام
--     دوالّ SQL عند الإنشاء، فتعريفها قبل الجداول يُسقط الترحيلة.
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.csub_plan_code_seq;
create sequence if not exists public.csub_subscription_code_seq;

-- 3.1 إعدادات الموديول
create table if not exists public.csub_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  label_ar    text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- 3.2 كتالوج أنواع الوحدات — جدول مبذور لا تعداد CHECK.
--     الفرق عمليّ: إضافة نوع لاحقًا صفّ، لا ترحيلة تعيد كتابة قيد على جدول
--     يحمل قيودًا حيّة. و`custom_unit` نوع أوّل الدرجة يلزمه تسمية صريحة.
create table if not exists public.csub_unit_types (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{2,40}$'),
  label_ar    text not null,
  label_en    text not null,
  uom_ar      text not null default 'وحدة',
  is_custom   boolean not null default false,
  is_active   boolean not null default true,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now()
);

-- 3.3 الخطط (كتالوج)
create table if not exists public.csub_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name_ar       text not null,
  name_en       text,
  billing_cycle text not null default 'monthly'
                check (billing_cycle in ('monthly','quarterly','annual','custom')),
  cycle_months  int check (cycle_months is null or (cycle_months >= 1 and cycle_months <= 120)),
  is_active     boolean not null default false,
  status        text not null default 'draft' check (status in ('draft','active','inactive','archived')),
  current_version int not null default 0 check (current_version >= 0),
  -- المال: الضريبة حقل مستقلّ، والإجمالي مولَّد.
  price_net     numeric(14,2) not null default 0 check (price_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  price_gross   numeric(14,2) generated always as (price_net + vat_amount) stored,
  currency      text not null default 'SAR' check (currency = 'SAR'),
  -- قواعد
  allow_overage             boolean not null default false,
  overage_requires_approval boolean not null default true,
  rollover_enabled          boolean not null default false,
  rollover_limit_units      numeric(14,3) check (rollover_limit_units is null or rollover_limit_units >= 0),
  rollover_max_periods      int check (rollover_max_periods is null or rollover_max_periods >= 0),
  expiry_policy   text not null default 'period_end'
                  check (expiry_policy in ('period_end','fixed_days','never')),
  expiry_days     int check (expiry_days is null or expiry_days >= 0),
  grace_period_days int not null default 0 check (grace_period_days >= 0 and grace_period_days <= 365),
  -- نصوص
  client_description text,                       -- ★ يراه العميل
  terms              text,                       -- ★ يراه العميل
  limitations        text,                       -- ★ يراه العميل
  internal_notes     text,                       -- ⛔ لا يصل العميل أبدًا
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create index if not exists ix_csub_plans_active on public.csub_plans(is_active, status) where is_deleted = false;

-- 3.4 وحدات الخطّة — الخطّة قد تحمل عدّة أنواع
create table if not exists public.csub_plan_units (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.csub_plans(id) on delete cascade,
  unit_type     text not null references public.csub_unit_types(key) on delete restrict,
  custom_unit_label text,
  quantity_per_period numeric(14,3) not null default 0 check (quantity_per_period >= 0),
  overage_unit_price_net numeric(14,2) not null default 0 check (overage_unit_price_net >= 0),
  overage_vat_rate       numeric(6,3)  not null default 15 check (overage_vat_rate >= 0 and overage_vat_rate <= 100),
  rollover_enabled       boolean,
  rollover_limit_units   numeric(14,3) check (rollover_limit_units is null or rollover_limit_units >= 0),
  expiry_policy          text check (expiry_policy in ('period_end','fixed_days','never')),
  expiry_days            int check (expiry_days is null or expiry_days >= 0),
  notes         text,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_csub_plan_unit unique (plan_id, unit_type),
  constraint csub_plan_unit_custom_label check
    (unit_type <> 'custom_unit' or coalesce(btrim(custom_unit_label), '') <> '')
);

-- 3.5 إصدارات الخطّة — لقطة **غير قابلة للتعديل** تُنشر عند كلّ تغيير معتمد.
--     الاشتراك يشير إلى إصدار محدّد، فتعديل الخطّة لاحقًا لا يغيّر عقدًا قائمًا.
create table if not exists public.csub_plan_versions (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.csub_plans(id) on delete cascade,
  version      int not null check (version >= 1),
  definition   jsonb not null,
  note         text,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default now(),
  constraint uq_csub_plan_version unique (plan_id, version)
);

-- 3.6 الاشتراكات
create table if not exists public.csub_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  client_id     uuid not null references public.clients(id) on delete restrict,
  plan_id       uuid references public.csub_plans(id) on delete restrict,
  plan_version  int check (plan_version is null or plan_version >= 1),
  plan_snapshot jsonb not null default '{}'::jsonb,
  status        text not null default 'draft'
                check (status in ('draft','pending_approval','active','suspended','expired','cancelled','completed')),
  -- التواريخ
  start_date    date,
  end_date      date,
  renewal_date  date,
  grace_period_days int not null default 0 check (grace_period_days >= 0 and grace_period_days <= 365),
  -- ★ معلومة لا آلية ★ لا شحن ولا تجديد خارجيّ ولا نداء حيّ يقرأ هذا العمود.
  auto_renew    boolean not null default false,
  -- التسعير الخاصّ بالعميل — الضريبة حقل مستقلّ، والإجمالي مولَّد.
  price_net     numeric(14,2) not null default 0 check (price_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  price_gross   numeric(14,2) generated always as (price_net + vat_amount) stored,
  currency      text not null default 'SAR' check (currency = 'SAR'),
  price_is_custom boolean not null default false,
  -- القواعد الفعلية للاشتراك (تُنسخ من الخطّة عند التفعيل وقد تُخصَّص)
  allow_overage             boolean not null default false,
  overage_requires_approval boolean not null default true,
  rollover_enabled          boolean not null default false,
  rollover_limit_units      numeric(14,3) check (rollover_limit_units is null or rollover_limit_units >= 0),
  rollover_max_periods      int check (rollover_max_periods is null or rollover_max_periods >= 0),
  expiry_policy   text not null default 'period_end'
                  check (expiry_policy in ('period_end','fixed_days','never')),
  expiry_days     int check (expiry_days is null or expiry_days >= 0),
  -- مراجع
  contract_reference text,
  project_id    uuid,                     -- ⚠️ مرجع اختياريّ للقراءة فقط. بلا FK.
  -- نصوص
  client_description text,                -- ★ يراه العميل
  terms              text,                -- ★ يراه العميل
  limitations        text,                -- ★ يراه العميل
  internal_notes     text,                -- ⛔ لا يصل العميل أبدًا
  -- دورة الحياة
  submitted_by  uuid references auth.users(id), submitted_at timestamptz,
  approved_by   uuid references auth.users(id), approved_at  timestamptz,
  activated_at  timestamptz,
  suspended_at  timestamptz, suspend_reason text,
  cancelled_at  timestamptz, cancelled_by uuid references auth.users(id), cancel_reason text,
  expired_at    timestamptz,
  completed_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint csub_sub_dates check (start_date is null or end_date is null or end_date >= start_date)
);
create index if not exists ix_csub_sub_client on public.csub_subscriptions(client_id, status);
create index if not exists ix_csub_sub_status on public.csub_subscriptions(status, end_date);
comment on column public.csub_subscriptions.auto_renew is
  'معلومة تعاقدية فقط. لا يقرأها أيّ مسار تفعيل أو تجديد أو تخصيص رصيد — التجديد قرار مالك صريح.';
comment on column public.csub_subscriptions.project_id is
  'مرجع اختياريّ للقراءة فقط إلى منصّة المشاريع المجمَّدة. لا مفتاح خارجيّ ولا كتابة.';

-- 3.7 وحدات الاشتراك — مرساة الرصيد. كلّ قيد في الدفتر يجب أن يطابق صفًّا هنا،
--     وهذا الصفّ هو ما يُقفَل (for update) لتسلسل الاستهلاكات المتزامنة.
create table if not exists public.csub_subscription_units (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.csub_subscriptions(id) on delete restrict,
  unit_type       text not null references public.csub_unit_types(key) on delete restrict,
  custom_unit_label text,
  quantity_per_period numeric(14,3) not null default 0 check (quantity_per_period >= 0),
  overage_unit_price_net numeric(14,2) not null default 0 check (overage_unit_price_net >= 0),
  overage_vat_rate       numeric(6,3)  not null default 15 check (overage_vat_rate >= 0 and overage_vat_rate <= 100),
  rollover_enabled       boolean,
  rollover_limit_units   numeric(14,3) check (rollover_limit_units is null or rollover_limit_units >= 0),
  expiry_policy          text check (expiry_policy in ('period_end','fixed_days','never')),
  expiry_days            int check (expiry_days is null or expiry_days >= 0),
  notes           text,
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_csub_sub_unit unique (subscription_id, unit_type),
  constraint csub_sub_unit_custom_label check
    (unit_type <> 'custom_unit' or coalesce(btrim(custom_unit_label), '') <> '')
);

-- 3.8 الفترات — بلا فترات لا معنى لـ«ترحيل رصيد» ولا لـ«انتهاء عند نهاية الفترة».
create table if not exists public.csub_periods (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.csub_subscriptions(id) on delete restrict,
  period_no       int not null check (period_no >= 1),
  starts_on       date not null,
  ends_on         date not null,
  status          text not null default 'open' check (status in ('open','closed')),
  rolled_over_units numeric(14,3) not null default 0 check (rolled_over_units >= 0),
  expired_units     numeric(14,3) not null default 0 check (expired_units >= 0),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint uq_csub_period unique (subscription_id, period_no),
  constraint csub_period_dates check (ends_on >= starts_on)
);
create index if not exists ix_csub_periods_open on public.csub_periods(subscription_id, status);

-- 3.9 طلبات اعتماد المالك — تُنشأ قبل الدفتر لأنّ القيد قد يشير إلى الطلب الذي
--     أباحه. الصفّ المعلَّق **ليس** رصيدًا: لا يُقرأ في أيّ حساب رصيد إطلاقًا.
create table if not exists public.csub_approval_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('activation','renewal','adjustment','overage','reversal')),
  subscription_id uuid references public.csub_subscriptions(id) on delete cascade,
  unit_type       text references public.csub_unit_types(key) on delete restrict,
  quantity        numeric(14,3),
  payload         jsonb not null default '{}'::jsonb,
  reason          text,
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','withdrawn')),
  requested_by    uuid not null references auth.users(id) on delete cascade,
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  applied_entry_id uuid,
  consumed_entry_id uuid,               -- اعتماد التجاوز يُستهلك مرّة واحدة فقط
  apply_error     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ix_csub_appr_status on public.csub_approval_requests(status, requested_at desc);
create index if not exists ix_csub_appr_sub on public.csub_approval_requests(subscription_id, kind, status);
comment on table public.csub_approval_requests is
  'اعتماد المالك على التفعيل والتجديد وزيادة الرصيد والتجاوز والعكس المُعجِّز. الطلب المعلَّق لا يغيّر رصيدًا.';

-- 3.10 ★★ الدفتر ★★ محاسبة لا رقم قابل للتعديل.
--      كلّ صفّ يحمل **ترحيله بنفسه** في أربعة أعمدة d_* يحسبها مُشغِّل قبل
--      الإدراج. الرصيد بعدها جمع صِرف، والقيد العكسيّ نفيٌ دقيق لصفّ واحد.
create table if not exists public.csub_ledger (
  id              uuid primary key default gen_random_uuid(),
  entry_no        bigint generated always as identity,
  subscription_id uuid not null references public.csub_subscriptions(id) on delete restrict,
  client_id       uuid not null references public.clients(id) on delete restrict,
  period_id       uuid references public.csub_periods(id) on delete restrict,
  unit_type       text not null references public.csub_unit_types(key) on delete restrict,
  entry_type      text not null check (entry_type in
                    ('allocation','reservation','consumption','release','reversal','expiry','adjustment')),
  quantity        numeric(14,3) not null,
  -- الترحيل المحاسبيّ (يُحسب بمُشغِّل، ولا يُقبل من المُدرِج)
  d_allocated     numeric(14,3) not null default 0,
  d_reserved      numeric(14,3) not null default 0,
  d_used          numeric(14,3) not null default 0,
  d_expired       numeric(14,3) not null default 0,
  -- الروابط
  reverses_entry_id    uuid references public.csub_ledger(id) on delete restrict,
  reservation_entry_id uuid references public.csub_ledger(id) on delete restrict,
  approval_request_id  uuid references public.csub_approval_requests(id) on delete restrict,
  -- التجاوز وسعره — الضريبة حقل مستقلّ، والإجمالي مولَّد
  overage_units        numeric(14,3) not null default 0,
  overage_unit_price_net numeric(14,2) not null default 0,
  overage_vat_rate     numeric(6,3)  not null default 15 check (overage_vat_rate >= 0 and overage_vat_rate <= 100),
  overage_amount_net   numeric(14,2) not null default 0,
  overage_vat_amount   numeric(14,2) not null default 0,
  overage_amount_gross numeric(14,2) generated always as (overage_amount_net + overage_vat_amount) stored,
  currency        text not null default 'SAR' check (currency = 'SAR'),
  -- السياق
  usage_date      date,
  occurred_at     timestamptz not null default now(),
  service_request_id  uuid,
  service_request_ref text,
  project_id      uuid,                  -- ⚠️ مرجع اختياريّ للقراءة فقط. بلا FK.
  source          text not null default 'manual' check (source in
                    ('manual','plan_allocation','renewal','rollover','expiry_sweep',
                     'service_request','correction','import')),
  reason          text,
  client_description text,               -- ★ يراه العميل
  internal_metadata  jsonb not null default '{}'::jsonb,   -- ⛔ لا يصل العميل أبدًا
  idempotency_key         text,
  idempotency_fingerprint text,
  actor_id        uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint csub_ledger_quantity_sign check
    (quantity <> 0 and (entry_type in ('reversal','adjustment') or quantity > 0)),
  constraint csub_ledger_overage_sign check (
    (entry_type = 'reversal'
       and overage_units <= 0 and overage_amount_net <= 0 and overage_vat_amount <= 0)
    or (entry_type <> 'reversal'
       and overage_units >= 0 and overage_amount_net >= 0 and overage_vat_amount >= 0)),
  constraint csub_ledger_reversal_link check
    ((entry_type = 'reversal') = (reverses_entry_id is not null)),
  constraint csub_ledger_price_nonneg check (overage_unit_price_net >= 0)
);
-- ★ مفتاح التكرار فريد عالميًّا: إعادة استعماله مستحيلة لا مستبعَدة.
create unique index if not exists uq_csub_ledger_idem
  on public.csub_ledger(idempotency_key) where idempotency_key is not null;
-- ★ لا يُعكَس قيد مرّتين.
create unique index if not exists uq_csub_ledger_reversal
  on public.csub_ledger(reverses_entry_id) where reverses_entry_id is not null;
create index if not exists ix_csub_ledger_bal on public.csub_ledger(subscription_id, unit_type, entry_no);
create index if not exists ix_csub_ledger_client on public.csub_ledger(client_id, occurred_at desc);
create index if not exists ix_csub_ledger_sr on public.csub_ledger(service_request_id, unit_type)
  where service_request_id is not null;
create index if not exists ix_csub_ledger_resv on public.csub_ledger(reservation_entry_id)
  where reservation_entry_id is not null;
comment on table public.csub_ledger is
  'دفتر أرصدة الإنتاج. قيوده غير قابلة للتعديل ولا الحذف ولا التفريغ — التصحيح بقيد عكسيّ فقط. الرصيد مشتقّ من مجموع d_* ولا يُحفَظ في أيّ عمود.';

-- 3.11 التدقيق
create table if not exists public.csub_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ix_csub_audit_at on public.csub_audit(created_at desc);
create index if not exists ix_csub_audit_entity on public.csub_audit(entity_type, entity_id);

-- ════════════════════════════════════════════════════════════════════════════
-- §4) البذور — أنواع الوحدات الثلاثة عشر وإعدادات الموديول.
--     on conflict do update: إعادة التشغيل تُحدِّث التسمية ولا تُكرّر صفًّا.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.csub_unit_types (key, label_ar, label_en, uom_ar, is_custom, sort_order)
values
  ('filming_day',           'يوم تصوير',            'Filming day',            'يوم',   false, 10),
  ('filming_hour',          'ساعة تصوير',           'Filming hour',           'ساعة',  false, 20),
  ('photography_session',   'جلسة تصوير فوتوغرافي', 'Photography session',    'جلسة',  false, 30),
  ('edited_reel',           'ريل مونتاج',           'Edited reel',            'ريل',   false, 40),
  ('editing_hour',          'ساعة مونتاج',          'Editing hour',           'ساعة',  false, 50),
  ('motion_graphics_hour',  'ساعة موشن جرافيك',     'Motion graphics hour',   'ساعة',  false, 60),
  ('drone_session',         'جلسة درون',            'Drone session',          'جلسة',  false, 70),
  ('drone_hour',            'ساعة درون',            'Drone hour',             'ساعة',  false, 80),
  ('event_coverage',        'تغطية فعالية',         'Event coverage',         'تغطية', false, 90),
  ('podcast_episode',       'حلقة بودكاست',         'Podcast episode',        'حلقة',  false, 100),
  ('design_item',           'عمل تصميم',            'Design item',            'عمل',   false, 110),
  ('live_stream_day',       'يوم بثّ مباشر',         'Live stream day',        'يوم',   false, 120),
  ('custom_unit',           'وحدة مخصّصة',           'Custom unit',            'وحدة',  true,  900)
on conflict (key) do update set
  label_ar = excluded.label_ar, label_en = excluded.label_en,
  uom_ar = excluded.uom_ar, is_custom = excluded.is_custom, sort_order = excluded.sort_order;

insert into public.csub_settings (key, value, label_ar) values
  ('currency',            '"SAR"'::jsonb,   'العملة — ريال سعوديّ حصرًا'),
  ('default_vat_rate',    '15'::jsonb,      'نسبة ضريبة القيمة المضافة الافتراضية (٪)'),
  ('default_grace_days',  '0'::jsonb,       'مهلة السماح الافتراضية بعد نهاية الاشتراك (يوم)'),
  ('default_expiry_policy','"period_end"'::jsonb, 'سياسة انتهاء الرصيد الافتراضية'),
  ('statement_page_size', '100'::jsonb,     'عدد قيود كشف الحساب في الصفحة'),
  ('renewal_is_manual',   'true'::jsonb,    'التجديد قرار مالك صريح — auto_renew معلومة لا آلية')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) RLS — تفعيل على كلّ جدول، وسياسات **قراءة فقط**.
--     لا سياسة INSERT/UPDATE/DELETE على أيّ جدول: كلّ كتابة عبر RPC مُدقَّقة.
--
--     ★ لماذا لا يقرأ العميل جدولًا واحدًا هنا ★
--     RLS تُصفّي صفوفًا لا أعمدة، وهذه الجداول تحمل internal_notes و
--     internal_metadata وأسعارًا داخلية. لذلك العميل **لا يملك أيّ سياسة**،
--     ويصل إلى بياناته حصرًا عبر csub_my_* التي تُسقِط الأعمدة الداخلية بالاسم.
--     وللسبب نفسه: الجداول الحاملة للمال تُقرأ بمفتاح csub.view_pricing فقط،
--     ومن دونه يُقرأ كلّ شيء عبر RPC تُقنِّع المال ولا تُصفّره.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['csub_settings','csub_unit_types','csub_plans','csub_plan_units',
    'csub_plan_versions','csub_subscriptions','csub_subscription_units','csub_periods',
    'csub_approval_requests','csub_ledger','csub_audit'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- المراجع غير المالية: لأيّ موظّف مصرَّح بدخول الموديول.
  foreach t in array array['csub_unit_types','csub_settings','csub_periods'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.csub_can_view())',
                   t || '_read', t);
  end loop;

  -- الجداول الحاملة للمال: مفتاح الأسعار الحسّاس.
  foreach t in array array['csub_plans','csub_plan_units','csub_plan_versions',
                           'csub_subscriptions','csub_subscription_units','csub_ledger'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.csub_can_view_pricing())',
                   t || '_read', t);
  end loop;

  -- طلبات الاعتماد: المالك يرى الكلّ، ومقدّم الطلب يرى طلبه هو. لا أحد غيرهما.
  drop policy if exists csub_approval_requests_read on public.csub_approval_requests;
  create policy csub_approval_requests_read on public.csub_approval_requests for select to authenticated
    using (public.csub_can_approve() or (public.csub_can_view() and requested_by = auth.uid()));

  -- سجلّ التدقيق: للإدارة فقط.
  drop policy if exists csub_audit_read on public.csub_audit;
  create policy csub_audit_read on public.csub_audit for select to authenticated
    using (public.csub_can_manage());
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) التدقيق والإشعار والمساعدات الداخلية (REVOKE في §12).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_log(
  p_action text, p_etype text, p_eid uuid, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.csub_audit(actor_id, action, entity_type, entity_id, detail)
  values (auth.uid(), p_action, p_etype, p_eid, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ─── قيد entity_type على الإشعارات: شكل لا تعداد ──────────────────────────
-- الكتلة نفسها حرفيًّا في crm_sales_FOUNDATION_RUNME.sql وoperations_center_RUNME.sql،
-- ومتساوية القوّة الذاتية، فلا يهمّ أيّ الحزم شُغّلت أوّلًا ولا تتنازع قيدًا واحدًا.
do $notif_shape$
declare v_bad bigint := 0; c record;
begin
  if to_regclass('public.notifications') is null then
    raise notice 'CSUB: جدول الإشعارات غير موجود — لا إشعارات داخل التطبيق لهذا الموديول.';
    return;
  end if;
  select count(*) into v_bad from public.notifications
   where entity_type is null or entity_type !~ '^[a-z][a-z0-9_]{2,40}$';
  if v_bad > 0 then
    raise notice 'CSUB: % صفّ إشعار قائم لا يحترم شكل entity_type — القيد تُرك كما هو.', v_bad;
    return;
  end if;
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = to_regclass('public.notifications')
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%entity_type%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
    raise notice 'CSUB: أُزيل قيد entity_type القديم (%).', c.conname;
  end loop;
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type is not null and entity_type ~ '^[a-z][a-z0-9_]{2,40}$');
end $notif_shape$;

-- إشعار معزول: فشله لا يُسقط قيدًا محاسبيًّا صحيحًا، ولا يُبتلَع بصمت.
create or replace function public.csub_notify(p_user uuid, p_type text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ss text; v_msg text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then
    perform public.csub_log('notify_unavailable', 'csub_subscription', p_eid,
      jsonb_build_object('type', p_type, 'reason', 'notify_function_missing'));
    return;
  end if;
  begin
    execute 'select public.notify($1,$2,$3,$4,$5,$6,$7)'
      using p_user, 'user', p_type, 'csub_subscription', p_eid, p_ar, p_en;
  exception when others then
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    begin
      perform public.csub_log('notify_failed', 'csub_subscription', p_eid,
        jsonb_build_object('type', p_type, 'sqlstate', v_ss, 'detail', left(coalesce(v_msg, ''), 200)));
    exception when others then null;
    end;
  end;
end $$;

create or replace function public.csub_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $tt$
declare t text;
begin
  foreach t in array array['csub_plans','csub_plan_units','csub_subscriptions',
                           'csub_subscription_units','csub_approval_requests'] loop
    execute format('drop trigger if exists t_%s_touch on public.%I', t, t);
    execute format('create trigger t_%s_touch before update on public.%I
                    for each row execute function public.csub_touch()', t, t);
  end loop;
end $tt$;

-- مساعدات قراءة الحمولة — تُبقي دوالّ الكتابة مقروءة ولا تُخمِّن نوعًا.
create or replace function public.csub_txt(p jsonb, k text) returns text
language sql immutable security definer set search_path = public as $$
  select nullif(btrim(coalesce(p->>k, '')), '');
$$;

create or replace function public.csub_uuid(p jsonb, k text) returns uuid
language plpgsql immutable security definer set search_path = public as $$
begin
  return nullif(btrim(coalesce(p->>k, '')), '')::uuid;
exception when others then return null;
end $$;

create or replace function public.csub_num(p jsonb, k text) returns numeric
language plpgsql immutable security definer set search_path = public as $$
begin
  return nullif(btrim(coalesce(p->>k, '')), '')::numeric;
exception when others then return null;
end $$;

create or replace function public.csub_next_code(p_prefix text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v bigint;
begin
  if p_prefix = 'PLAN' then v := nextval('public.csub_plan_code_seq');
  else v := nextval('public.csub_subscription_code_seq'); end if;
  return coalesce(nullif(p_prefix, ''), 'SUB') || '-' || to_char(now(), 'YYMM') || '-' || lpad(v::text, 4, '0');
end $$;

-- ★ الضريبة تُحسب ولا تُطوى: حقل مستقلّ في كلّ مسار.
create or replace function public.csub_vat(p_net numeric, p_rate numeric) returns numeric
language sql immutable security definer set search_path = public as $$
  select round(coalesce(p_net, 0) * coalesce(p_rate, 0) / 100.0, 2);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) ★★ حرّاس الدفتر ★★ — الاستحالات مفروضة هنا، قبل أيّ RPC.
--     لو نودي INSERT من أيّ مسار مستقبليّ فالضمانات نفسها تنطبق.
-- ════════════════════════════════════════════════════════════════════════════

-- (أ) عدم القابلية للتعديل — بمُشغِّل لا بعُرف.
create or replace function public.csub_ledger_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'csub_ledger_immutable: دفتر الأرصدة غير قابل للتعديل ولا الحذف ولا التفريغ. التصحيح يكون بقيد عكسيّ (csub_reverse) لا بتعديل صفّ.'
    using errcode = '0A000';
  return null;
end $$;

drop trigger if exists t_csub_ledger_no_update on public.csub_ledger;
create trigger t_csub_ledger_no_update before update on public.csub_ledger
  for each row execute function public.csub_ledger_immutable();

drop trigger if exists t_csub_ledger_no_delete on public.csub_ledger;
create trigger t_csub_ledger_no_delete before delete on public.csub_ledger
  for each row execute function public.csub_ledger_immutable();

drop trigger if exists t_csub_ledger_no_truncate on public.csub_ledger;
create trigger t_csub_ledger_no_truncate before truncate on public.csub_ledger
  for each statement execute function public.csub_ledger_immutable();

-- (ب) الترحيل — كلّ صفّ يحمل أثره بنفسه، والعميل يُشتقّ من الاشتراك لا يُصدَّق
--     من المُدرِج. هنا تُغلق «استهلاك رصيد عميل لحساب آخر» بنيويًّا.
create or replace function public.csub_ledger_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.csub_ledger%rowtype; v_client uuid; v_rem numeric;
begin
  select s.client_id into v_client from public.csub_subscriptions s where s.id = new.subscription_id;
  if v_client is null then
    raise exception 'csub_ledger: subscription_not_found (%)', new.subscription_id using errcode = '23503';
  end if;
  if new.client_id is null then
    new.client_id := v_client;
  elsif new.client_id <> v_client then
    raise exception 'csub_ledger: ledger_client_mismatch — قيد بعميل (%) غير صاحب الاشتراك (%)',
      new.client_id, v_client using errcode = '23514';
  end if;

  if not exists (select 1 from public.csub_subscription_units u
                  where u.subscription_id = new.subscription_id and u.unit_type = new.unit_type) then
    raise exception 'csub_ledger: unit_not_in_subscription (%)', new.unit_type using errcode = '23514';
  end if;

  if new.period_id is not null and not exists (
      select 1 from public.csub_periods pr
       where pr.id = new.period_id and pr.subscription_id = new.subscription_id) then
    raise exception 'csub_ledger: period_scope_mismatch' using errcode = '23514';
  end if;

  -- العملة: قيد CHECK على الجدول يمنعها أصلًا، وهذا الحارس يُفشل **مبكرًا**
  -- برسالة مقروءة بدل 23514 عامّ من قيد لا يذكر السبب.
  if new.currency is distinct from 'SAR' then
    raise exception 'csub_ledger: currency_must_be_sar — العملة في هذا الموديول ريال سعوديّ حصرًا'
      using errcode = '23514';
  end if;

  new.d_allocated := 0; new.d_reserved := 0; new.d_used := 0; new.d_expired := 0;

  if new.entry_type = 'reversal' then
    select * into r from public.csub_ledger where id = new.reverses_entry_id for update;
    if not found then
      raise exception 'csub_ledger: reversed_entry_not_found' using errcode = '23503';
    end if;
    if r.entry_type = 'reversal' then
      raise exception 'csub_ledger: cannot_reverse_a_reversal — اعكس القيد الأصليّ لا عكسه' using errcode = '23514';
    end if;
    if r.subscription_id <> new.subscription_id or r.unit_type <> new.unit_type
       or r.client_id <> new.client_id then
      raise exception 'csub_ledger: reversal_scope_mismatch' using errcode = '23514';
    end if;
    -- النفي الدقيق: أربعة أعمدة وكميّة وتجاوز.
    new.quantity   := -r.quantity;
    new.d_allocated := -r.d_allocated;
    new.d_reserved  := -r.d_reserved;
    new.d_used      := -r.d_used;
    new.d_expired   := -r.d_expired;
    new.overage_units      := -r.overage_units;
    new.overage_unit_price_net := r.overage_unit_price_net;
    new.overage_vat_rate   := r.overage_vat_rate;
    new.overage_amount_net := -r.overage_amount_net;
    new.overage_vat_amount := -r.overage_vat_amount;
    new.period_id := coalesce(new.period_id, r.period_id);
    -- يُنسَب العكس إلى الحجز نفسه كي يبقى «المتبقّي من الحجز» صحيحًا.
    new.reservation_entry_id := coalesce(
      r.reservation_entry_id,
      case when r.entry_type = 'reservation' then r.id else null end);
    return new;
  end if;

  if new.reverses_entry_id is not null then
    raise exception 'csub_ledger: only_reversal_may_reference_reversed_entry' using errcode = '23514';
  end if;

  case new.entry_type
    when 'allocation' then
      if new.quantity <= 0 then raise exception 'csub_ledger: allocation_must_be_positive' using errcode = '23514'; end if;
      new.d_allocated := new.quantity;
    when 'adjustment' then
      if new.quantity = 0 then raise exception 'csub_ledger: adjustment_must_be_nonzero' using errcode = '23514'; end if;
      new.d_allocated := new.quantity;
    when 'reservation' then
      if new.quantity <= 0 then raise exception 'csub_ledger: reservation_must_be_positive' using errcode = '23514'; end if;
      if new.reservation_entry_id is not null then
        raise exception 'csub_ledger: reservation_cannot_reference_reservation' using errcode = '23514'; end if;
      new.d_reserved := new.quantity;
    when 'release' then
      if new.quantity <= 0 then raise exception 'csub_ledger: release_must_be_positive' using errcode = '23514'; end if;
      if new.reservation_entry_id is null then
        raise exception 'csub_ledger: release_without_reservation' using errcode = '23514'; end if;
      new.d_reserved := -new.quantity;
    when 'consumption' then
      if new.quantity <= 0 then raise exception 'csub_ledger: consumption_must_be_positive' using errcode = '23514'; end if;
      new.d_used := new.quantity;
      if new.reservation_entry_id is not null then new.d_reserved := -new.quantity; end if;
    when 'expiry' then
      if new.quantity <= 0 then raise exception 'csub_ledger: expiry_must_be_positive' using errcode = '23514'; end if;
      new.d_expired := new.quantity;
    else
      raise exception 'csub_ledger: unknown_entry_type (%)', new.entry_type using errcode = '23514';
  end case;

  if new.reservation_entry_id is not null then
    select * into r from public.csub_ledger where id = new.reservation_entry_id for update;
    if not found or r.entry_type <> 'reservation' then
      raise exception 'csub_ledger: reservation_entry_invalid' using errcode = '23503';
    end if;
    if r.subscription_id <> new.subscription_id or r.unit_type <> new.unit_type
       or r.client_id <> new.client_id then
      raise exception 'csub_ledger: reservation_scope_mismatch' using errcode = '23514';
    end if;
    -- المتبقّي من الحجز = مجموع أثره على «المحجوز» هو وكلّ ما نُسب إليه.
    select coalesce(sum(l.d_reserved), 0) into v_rem
      from public.csub_ledger l
     where l.id = r.id or l.reservation_entry_id = r.id;
    if v_rem < new.quantity then
      raise exception 'csub_ledger: reservation_exhausted — المتبقّي % والمطلوب %', v_rem, new.quantity
        using errcode = '23514';
    end if;
  end if;

  new.overage_amount_net := round(coalesce(new.overage_units, 0) * coalesce(new.overage_unit_price_net, 0), 2);
  new.overage_vat_amount := public.csub_vat(new.overage_amount_net, new.overage_vat_rate);
  return new;
end $$;

drop trigger if exists t_csub_ledger_post on public.csub_ledger;
create trigger t_csub_ledger_post before insert on public.csub_ledger
  for each row execute function public.csub_ledger_post();

-- ════════════════════════════════════════════════════════════════════════════
-- §8) الرصيد — مشتقّ لا محفوظ. جمعٌ صِرف فوق أعمدة الترحيل.
--     available = allocated − reserved − used − expired
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_balance_core(p_subscription uuid, p_unit text default null)
returns table (
  unit_type text, allocated numeric, reserved numeric, used numeric,
  expired numeric, available numeric, overage_units numeric, entries bigint)
language sql stable security definer set search_path = public as $$
  select u.unit_type,
         coalesce(sum(l.d_allocated), 0)::numeric,
         coalesce(sum(l.d_reserved), 0)::numeric,
         coalesce(sum(l.d_used), 0)::numeric,
         coalesce(sum(l.d_expired), 0)::numeric,
         (coalesce(sum(l.d_allocated), 0) - coalesce(sum(l.d_reserved), 0)
          - coalesce(sum(l.d_used), 0) - coalesce(sum(l.d_expired), 0))::numeric,
         coalesce(sum(l.overage_units), 0)::numeric,
         count(l.id)::bigint
    from public.csub_subscription_units u
    left join public.csub_ledger l
      on l.subscription_id = u.subscription_id and l.unit_type = u.unit_type
   where u.subscription_id = p_subscription
     and (p_unit is null or u.unit_type = p_unit)
   group by u.unit_type;
$$;

-- المتاح لوحدة واحدة — يُنادى **بعد** القفل داخل دوالّ الكتابة.
create or replace function public.csub_available_core(p_subscription uuid, p_unit text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select available from public.csub_balance_core(p_subscription, p_unit) limit 1), 0);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) نواتان مشتركتان: مفتاح التكرار، وطلب اعتماد المالك.
-- ════════════════════════════════════════════════════════════════════════════

-- ★ مفتاح التكرار ★ فريد عالميًّا. إعادة استعماله بحمولة مطابقة تُعيد نتيجة
--   المرّة الأولى ولا تُنشئ قيدًا ثانيًا. إعادة استعماله بحمولة مختلفة — أو
--   لعميل آخر — تُرفض بـidempotency_conflict، ولا يُكشف معرّف القيد الآخر.
create or replace function public.csub_idem_lookup(p_key text, p_fp text, p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if p_key is null then return null; end if;
  select id, client_id, idempotency_fingerprint, entry_type, subscription_id, unit_type, quantity
    into r from public.csub_ledger where idempotency_key = p_key;
  if not found then return null; end if;
  if r.client_id is distinct from p_client or r.idempotency_fingerprint is distinct from p_fp then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict',
      'message', 'مفتاح التكرار مستعمل من قبل بحمولة مختلفة. اختر مفتاحًا جديدًا — لا يُعاد استعمال مفتاح.');
  end if;
  return jsonb_build_object('ok', true, 'idempotent', true, 'entry_id', r.id,
    'entry_type', r.entry_type, 'subscription_id', r.subscription_id,
    'unit_type', r.unit_type, 'quantity', r.quantity);
end $$;

create or replace function public.csub_fingerprint(p_kind text, p_sub uuid, p_unit text,
  p_qty numeric, p_extra text default '')
returns text language sql immutable security definer set search_path = public as $$
  select md5(coalesce(p_kind,'') || '|' || coalesce(p_sub::text,'') || '|' || coalesce(p_unit,'')
             || '|' || coalesce(p_qty::text,'') || '|' || coalesce(p_extra,''));
$$;

-- طلب اعتماد المالك. يُعاد استعمال الطلب المعلَّق المطابق بدل إغراق المالك.
create or replace function public.csub_approval_submit_core(
  p_kind text, p_sub uuid, p_unit text, p_qty numeric, p_payload jsonb, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_client uuid; v_owner uuid;
begin
  select id into v_id from public.csub_approval_requests
   where kind = p_kind and subscription_id is not distinct from p_sub
     and unit_type is not distinct from p_unit and quantity is not distinct from p_qty
     and requested_by = auth.uid() and status = 'pending'
   order by requested_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.csub_approval_requests(kind, subscription_id, unit_type, quantity, payload, reason, requested_by)
  values (p_kind, p_sub, p_unit, p_qty, coalesce(p_payload, '{}'::jsonb), p_reason, auth.uid())
  returning id into v_id;

  perform public.csub_log('approval_requested', 'csub_approval', v_id,
    jsonb_build_object('kind', p_kind, 'subscription_id', p_sub, 'unit_type', p_unit, 'quantity', p_qty));

  -- إشعار المالك: من هو المالك؟ يُقرأ من profiles ولا يُخمَّن.
  begin
    select c.user_id into v_client from public.clients c
      join public.csub_subscriptions s on s.client_id = c.id where s.id = p_sub;
    for v_owner in
      select p.id from public.profiles p
       where coalesce(p.account_type, '') = 'admin' and coalesce(p.account_status, '') <> 'blocked'
       limit 20
    loop
      perform public.csub_notify(v_owner, 'csub_approval_pending', v_id,
        'طلب اعتماد اشتراك بانتظار قرارك.', 'A subscription approval is awaiting your decision.');
    end loop;
  exception when others then null;   -- الإشعار لا يُسقط طلب اعتماد صحيحًا
  end;
  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) ★★★ دوالّ الدفتر ★★★
--      كلّها: بوّابة جلسة → مفتاح تكرار → قفل الاشتراك ثمّ الوحدة (ترتيب ثابت
--      لا جمود فيه) → حساب الرصيد **بعد** القفل → إدراج قيد واحد → تدقيق.
--      لا واحدة منها تكتب في projects أو project_core أو deliverables.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── حجز رصيد ─────────────────────────────────────────────────────────────
create or replace function public.csub_reserve(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_sub public.csub_subscriptions%rowtype; v_u public.csub_subscription_units%rowtype;
  v_unit text; v_qty numeric; v_key text; v_fp text; v_prev jsonb; v_avail numeric;
  v_entry uuid; v_date date; v_period uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_consume(), false) then raise exception 'not authorized'; end if;

  v_unit := public.csub_txt(p, 'unit_type');
  v_qty  := public.csub_num(p, 'quantity');
  v_key  := public.csub_txt(p, 'idempotency_key');
  v_date := coalesce(public.csub_txt(p, 'usage_date')::date, current_date);
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required',
      'message', 'مفتاح التكرار إلزاميّ في كلّ قيد — بلا مفتاح لا ضمانة ضدّ الحجز المزدوج.');
  end if;
  if v_unit is null or v_qty is null or v_qty <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload',
      'message', 'نوع الوحدة والكميّة الموجبة إلزاميّان.');
  end if;

  select * into v_sub from public.csub_subscriptions
   where id = public.csub_uuid(p, 'subscription_id') and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;

  v_fp := public.csub_fingerprint('reservation', v_sub.id, v_unit, v_qty, coalesce(public.csub_txt(p,'service_request_id'), ''));
  v_prev := public.csub_idem_lookup(v_key, v_fp, v_sub.client_id);
  if v_prev is not null then return v_prev; end if;

  if v_sub.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_active', 'status', v_sub.status);
  end if;
  if v_sub.end_date is not null and v_date > (v_sub.end_date + v_sub.grace_period_days) then
    return jsonb_build_object('ok', false, 'reason', 'subscription_expired',
      'end_date', v_sub.end_date, 'grace_period_days', v_sub.grace_period_days);
  end if;
  if v_sub.start_date is not null and v_date < v_sub.start_date then
    return jsonb_build_object('ok', false, 'reason', 'usage_before_start', 'start_date', v_sub.start_date);
  end if;

  select * into v_u from public.csub_subscription_units
   where subscription_id = v_sub.id and unit_type = v_unit for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unit_not_in_subscription', 'unit_type', v_unit); end if;

  v_avail := public.csub_available_core(v_sub.id, v_unit);
  if v_avail - v_qty < 0 then
    -- الحجز لا يُفتح له باب تجاوز: التجاوز قرار يقع عند الاستهلاك الفعليّ.
    return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
      'available', v_avail, 'requested', v_qty, 'unit_type', v_unit,
      'message', 'الرصيد المتاح لا يكفي للحجز. التجاوز يُقرَّر عند الاستهلاك باعتماد المالك.');
  end if;

  select id into v_period from public.csub_periods
   where subscription_id = v_sub.id and status = 'open' order by period_no desc limit 1;

  insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type, quantity,
    usage_date, service_request_id, service_request_ref, project_id, source, reason, client_description,
    internal_metadata, idempotency_key, idempotency_fingerprint, actor_id)
  values (v_sub.id, v_sub.client_id, v_period, v_unit, 'reservation', v_qty,
    v_date, public.csub_uuid(p, 'service_request_id'), public.csub_txt(p, 'service_request_ref'),
    public.csub_uuid(p, 'project_id'),
    coalesce(public.csub_txt(p, 'source'), 'service_request'), public.csub_txt(p, 'reason'),
    public.csub_txt(p, 'client_description'),
    coalesce(p->'internal_metadata', '{}'::jsonb), v_key, v_fp, auth.uid())
  returning id into v_entry;

  perform public.csub_log('ledger_reserve', 'csub_ledger', v_entry,
    jsonb_build_object('subscription_id', v_sub.id, 'unit_type', v_unit, 'quantity', v_qty));
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'idempotent', false,
    'available_after', public.csub_available_core(v_sub.id, v_unit));
end $$;

-- ─── فكّ حجز ───────────────────────────────────────────────────────────────
create or replace function public.csub_release(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_sub public.csub_subscriptions%rowtype; v_res public.csub_ledger%rowtype;
  v_qty numeric; v_key text; v_fp text; v_prev jsonb; v_rem numeric; v_entry uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_consume(), false) then raise exception 'not authorized'; end if;

  v_key := public.csub_txt(p, 'idempotency_key');
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required');
  end if;

  select * into v_res from public.csub_ledger where id = public.csub_uuid(p, 'reservation_entry_id');
  if not found or v_res.entry_type <> 'reservation' then
    return jsonb_build_object('ok', false, 'reason', 'reservation_not_found');
  end if;

  select * into v_sub from public.csub_subscriptions where id = v_res.subscription_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  perform 1 from public.csub_subscription_units
   where subscription_id = v_sub.id and unit_type = v_res.unit_type for update;

  select coalesce(sum(l.d_reserved), 0) into v_rem from public.csub_ledger l
   where l.id = v_res.id or l.reservation_entry_id = v_res.id;
  v_qty := coalesce(public.csub_num(p, 'quantity'), v_rem);

  v_fp := public.csub_fingerprint('release', v_sub.id, v_res.unit_type, v_qty, v_res.id::text);
  v_prev := public.csub_idem_lookup(v_key, v_fp, v_sub.client_id);
  if v_prev is not null then return v_prev; end if;

  if v_qty <= 0 or v_qty > v_rem then
    return jsonb_build_object('ok', false, 'reason', 'reservation_exhausted', 'remaining', v_rem, 'requested', v_qty);
  end if;

  insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type, quantity,
    reservation_entry_id, usage_date, source, reason, client_description,
    idempotency_key, idempotency_fingerprint, actor_id)
  values (v_sub.id, v_sub.client_id, v_res.period_id, v_res.unit_type, 'release', v_qty,
    v_res.id, coalesce(public.csub_txt(p, 'usage_date')::date, current_date), 'service_request',
    public.csub_txt(p, 'reason'), public.csub_txt(p, 'client_description'),
    v_key, v_fp, auth.uid())
  returning id into v_entry;

  perform public.csub_log('ledger_release', 'csub_ledger', v_entry,
    jsonb_build_object('reservation_entry_id', v_res.id, 'quantity', v_qty));
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'idempotent', false,
    'available_after', public.csub_available_core(v_sub.id, v_res.unit_type));
end $$;

-- ─── ★★ الاستهلاك ★★ نقطة تقاطع الاستحالات الستّ ─────────────────────────
create or replace function public.csub_consume(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_sub public.csub_subscriptions%rowtype; v_u public.csub_subscription_units%rowtype;
  v_res public.csub_ledger%rowtype; v_ap public.csub_approval_requests%rowtype;
  v_unit text; v_qty numeric; v_key text; v_fp text; v_prev jsonb;
  v_avail numeric; v_over numeric := 0; v_entry uuid; v_date date; v_period uuid;
  v_sr uuid; v_net numeric; v_appr uuid; v_res_id uuid; v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_consume(), false) then raise exception 'not authorized'; end if;

  v_unit := public.csub_txt(p, 'unit_type');
  v_qty  := public.csub_num(p, 'quantity');
  v_key  := public.csub_txt(p, 'idempotency_key');
  v_sr   := public.csub_uuid(p, 'service_request_id');
  v_date := coalesce(public.csub_txt(p, 'usage_date')::date, current_date);
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required',
      'message', 'مفتاح التكرار إلزاميّ — هو الضمانة ضدّ الاستهلاك المزدوج.');
  end if;
  if v_unit is null or v_qty is null or v_qty <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  -- (١) قفل الاشتراك أوّلًا — ترتيب ثابت في كلّ دوالّ الدفتر ⇒ لا جمود.
  select * into v_sub from public.csub_subscriptions
   where id = public.csub_uuid(p, 'subscription_id') and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;

  -- (٢) مفتاح التكرار — بعد معرفة العميل كي تُقارَن الملكية أيضًا.
  v_fp := public.csub_fingerprint('consumption', v_sub.id, v_unit, v_qty, coalesce(v_sr::text, ''));
  v_prev := public.csub_idem_lookup(v_key, v_fp, v_sub.client_id);
  if v_prev is not null then return v_prev; end if;

  -- (٣) اشتراك منتهٍ/معلّق/ملغى لا يُستهلَك منه.
  if v_sub.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_active', 'status', v_sub.status,
      'message', 'الاشتراك ليس مفعّلًا. الاستهلاك من اشتراك غير مفعّل مستحيل على الخادم.');
  end if;
  if v_sub.end_date is not null and v_date > (v_sub.end_date + v_sub.grace_period_days) then
    return jsonb_build_object('ok', false, 'reason', 'subscription_expired',
      'end_date', v_sub.end_date, 'grace_period_days', v_sub.grace_period_days);
  end if;
  if v_sub.start_date is not null and v_date < v_sub.start_date then
    return jsonb_build_object('ok', false, 'reason', 'usage_before_start', 'start_date', v_sub.start_date);
  end if;

  -- (٤) قفل مرساة الرصيد. من هنا فصاعدًا لا استهلاك متزامن آخر على الوحدة نفسها.
  select * into v_u from public.csub_subscription_units
   where subscription_id = v_sub.id and unit_type = v_unit for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unit_not_in_subscription', 'unit_type', v_unit);
  end if;

  -- (٥) استهلاك مزدوج لطلب الخدمة نفسه: يُقاس بالصافي كي يبقى الاستهلاك
  --     الممكن بعد قيد عكسيّ ممكنًا، ويبقى المزدوج ممنوعًا.
  if v_sr is not null and not coalesce((p->>'allow_repeat')::boolean, false) then
    select coalesce(sum(l.d_used), 0) into v_net from public.csub_ledger l
     where l.service_request_id = v_sr and l.unit_type = v_unit and l.subscription_id = v_sub.id;
    if v_net > 0 then
      return jsonb_build_object('ok', false, 'reason', 'service_request_already_consumed',
        'already_used', v_net, 'service_request_id', v_sr,
        'message', 'طلب الخدمة هذا استُهلك من قبل لهذه الوحدة. التصحيح بقيد عكسيّ لا باستهلاك ثانٍ.');
    end if;
  end if;

  -- (٦) الحجز السابق إن وُجد.
  v_res_id := public.csub_uuid(p, 'reservation_entry_id');
  if v_res_id is not null then
    select * into v_res from public.csub_ledger where id = v_res_id;
    if not found or v_res.entry_type <> 'reservation'
       or v_res.subscription_id <> v_sub.id or v_res.unit_type <> v_unit then
      return jsonb_build_object('ok', false, 'reason', 'reservation_entry_invalid');
    end if;
  end if;

  -- (٧) الرصيد يُحسب **بعد** القفل — هنا يموت السباق.
  v_avail := public.csub_available_core(v_sub.id, v_unit);
  if v_res_id is not null then v_avail := v_avail + v_qty; end if;   -- المحجوز يعود متاحًا لصاحبه

  if v_avail - v_qty < 0 then
    v_over := v_qty - v_avail;
    if not v_sub.allow_overage then
      return jsonb_build_object('ok', false, 'reason', 'insufficient_balance',
        'available', v_avail, 'requested', v_qty, 'shortfall', v_over, 'unit_type', v_unit,
        'message', 'الرصيد المتاح لا يكفي، والخطّة لا تسمح بالتجاوز. لم يُكتب أيّ قيد.');
    end if;
    if v_sub.overage_requires_approval then
      v_appr := public.csub_uuid(p, 'approval_request_id');
      if v_appr is not null then
        select * into v_ap from public.csub_approval_requests where id = v_appr for update;
        v_ok := found and v_ap.kind = 'overage' and v_ap.status = 'approved'
                and v_ap.subscription_id = v_sub.id and v_ap.unit_type = v_unit
                and coalesce(v_ap.quantity, 0) >= v_over and v_ap.consumed_entry_id is null;
      end if;
      if not v_ok then
        v_appr := public.csub_approval_submit_core('overage', v_sub.id, v_unit, v_over,
          jsonb_build_object('quantity_requested', v_qty, 'available', v_avail,
                             'service_request_id', v_sr, 'usage_date', v_date),
          public.csub_txt(p, 'reason'));
        return jsonb_build_object('ok', false, 'reason', 'pending_approval',
          'approval_request_id', v_appr, 'shortfall', v_over, 'available', v_avail,
          'message', 'التجاوز يحتاج اعتماد المالك. لم يُكتب أيّ قيد — الطلب مسجَّل بانتظار القرار.');
      end if;
    end if;
  end if;

  insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type, quantity,
    reservation_entry_id, approval_request_id, overage_units, overage_unit_price_net, overage_vat_rate,
    usage_date, service_request_id, service_request_ref, project_id, source, reason, client_description,
    internal_metadata, idempotency_key, idempotency_fingerprint, actor_id)
  values (v_sub.id, v_sub.client_id, coalesce(v_res.period_id,
            (select id from public.csub_periods where subscription_id = v_sub.id and status = 'open'
              order by period_no desc limit 1)),
    v_unit, 'consumption', v_qty, v_res_id, case when v_over > 0 then v_appr else null end,
    v_over, v_u.overage_unit_price_net, v_u.overage_vat_rate,
    v_date, v_sr, public.csub_txt(p, 'service_request_ref'), public.csub_uuid(p, 'project_id'),
    coalesce(public.csub_txt(p, 'source'), 'service_request'), public.csub_txt(p, 'reason'),
    public.csub_txt(p, 'client_description'), coalesce(p->'internal_metadata', '{}'::jsonb),
    v_key, v_fp, auth.uid())
  returning id into v_entry;

  if v_over > 0 and v_appr is not null and v_sub.overage_requires_approval then
    update public.csub_approval_requests set consumed_entry_id = v_entry, updated_at = now()
     where id = v_appr and consumed_entry_id is null;
    if not found then raise exception 'csub_consume: overage_approval_already_used' using errcode = '23505'; end if;
  end if;

  perform public.csub_log('ledger_consume', 'csub_ledger', v_entry,
    jsonb_build_object('subscription_id', v_sub.id, 'unit_type', v_unit, 'quantity', v_qty,
                       'overage_units', v_over, 'service_request_id', v_sr));
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'idempotent', false,
    'overage_units', v_over, 'available_after', public.csub_available_core(v_sub.id, v_unit));
end $$;

-- ─── قيد عكسيّ — الطريق **الوحيد** لتصحيح الدفتر ─────────────────────────
create or replace function public.csub_reverse(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_src public.csub_ledger%rowtype; v_sub public.csub_subscriptions%rowtype;
  v_key text; v_fp text; v_prev jsonb; v_reason text; v_after numeric; v_entry uuid; v_appr uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_adjust(), false) then raise exception 'not authorized'; end if;

  v_key := public.csub_txt(p, 'idempotency_key');
  v_reason := public.csub_txt(p, 'reason');
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required'); end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'message', 'القيد العكسيّ بلا سبب مكتوب يُفقِد الدفتر معناه.');
  end if;

  select * into v_src from public.csub_ledger where id = public.csub_uuid(p, 'entry_id');
  if not found then return jsonb_build_object('ok', false, 'reason', 'entry_not_found'); end if;
  if v_src.entry_type = 'reversal' then
    return jsonb_build_object('ok', false, 'reason', 'cannot_reverse_a_reversal');
  end if;
  if exists (select 1 from public.csub_ledger where reverses_entry_id = v_src.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_reversed');
  end if;

  select * into v_sub from public.csub_subscriptions where id = v_src.subscription_id for update;
  perform 1 from public.csub_subscription_units
   where subscription_id = v_src.subscription_id and unit_type = v_src.unit_type for update;

  v_fp := public.csub_fingerprint('reversal', v_src.subscription_id, v_src.unit_type, v_src.quantity, v_src.id::text);
  v_prev := public.csub_idem_lookup(v_key, v_fp, v_src.client_id);
  if v_prev is not null then return v_prev; end if;

  -- عكسٌ يُعجِّز الرصيد (كعكس تخصيص استُهلك) لا يُمنَع فيكذب الدفتر، ولا يُمرَّر
  -- بصمت فيخرق قاعدة «لا رصيد سالب»: يُرفع إلى المالك.
  v_after := public.csub_available_core(v_src.subscription_id, v_src.unit_type) - v_src.d_allocated
             + v_src.d_used + v_src.d_reserved + v_src.d_expired;
  if v_after < 0 and not coalesce(v_sub.allow_overage, false)
     and not coalesce(public.csub_can_approve(), false) then
    v_appr := public.csub_approval_submit_core('reversal', v_src.subscription_id, v_src.unit_type,
      v_src.quantity, jsonb_build_object('entry_id', v_src.id, 'available_after', v_after), v_reason);
    return jsonb_build_object('ok', false, 'reason', 'pending_approval', 'approval_request_id', v_appr,
      'available_after', v_after,
      'message', 'هذا العكس يجعل الرصيد سالبًا والخطّة لا تسمح بالتجاوز — يحتاج اعتماد المالك.');
  end if;

  insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type, quantity,
    reverses_entry_id, usage_date, service_request_id, service_request_ref, project_id,
    source, reason, client_description, idempotency_key, idempotency_fingerprint, actor_id)
  values (v_src.subscription_id, v_src.client_id, v_src.period_id, v_src.unit_type, 'reversal', 1,
    v_src.id, v_src.usage_date, v_src.service_request_id, v_src.service_request_ref, v_src.project_id,
    'correction', v_reason, public.csub_txt(p, 'client_description'), v_key, v_fp, auth.uid())
  returning id into v_entry;

  perform public.csub_log('ledger_reverse', 'csub_ledger', v_entry,
    jsonb_build_object('reverses_entry_id', v_src.id, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'entry_id', v_entry, 'reversed_entry_id', v_src.id,
    'available_after', public.csub_available_core(v_src.subscription_id, v_src.unit_type));
end $$;

-- ─── تسوية يدوية — الزيادة باعتماد المالك حصرًا ──────────────────────────
create or replace function public.csub_adjust(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_sub public.csub_subscriptions%rowtype; v_unit text; v_qty numeric;
  v_key text; v_fp text; v_prev jsonb; v_reason text; v_avail numeric; v_entry uuid; v_appr uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_adjust(), false) then raise exception 'not authorized'; end if;

  v_unit   := public.csub_txt(p, 'unit_type');
  v_qty    := public.csub_num(p, 'quantity');
  v_key    := public.csub_txt(p, 'idempotency_key');
  v_reason := public.csub_txt(p, 'reason');
  if v_key is null then return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required'); end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required',
      'message', 'التسوية اليدوية بلا سبب مكتوب ممنوعة.');
  end if;
  if v_unit is null or v_qty is null or v_qty = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select * into v_sub from public.csub_subscriptions
   where id = public.csub_uuid(p, 'subscription_id') and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  perform 1 from public.csub_subscription_units
   where subscription_id = v_sub.id and unit_type = v_unit for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unit_not_in_subscription', 'unit_type', v_unit);
  end if;

  v_fp := public.csub_fingerprint('adjustment', v_sub.id, v_unit, v_qty, v_reason);
  v_prev := public.csub_idem_lookup(v_key, v_fp, v_sub.client_id);
  if v_prev is not null then return v_prev; end if;

  v_avail := public.csub_available_core(v_sub.id, v_unit);

  -- ★ الزيادة = منح رصيد = قرار مالك. لا مفتاح صلاحية يشتريه.
  -- ★ والنقص الذي يُعجِّز الرصيد يمرّ بالبوّابة نفسها.
  if not coalesce(public.csub_can_approve(), false)
     and (v_qty > 0 or (v_avail + v_qty < 0 and not v_sub.allow_overage)) then
    v_appr := public.csub_approval_submit_core('adjustment', v_sub.id, v_unit, v_qty,
      jsonb_build_object('available_before', v_avail), v_reason);
    return jsonb_build_object('ok', false, 'reason', 'pending_approval', 'approval_request_id', v_appr,
      'message', case when v_qty > 0
        then 'زيادة الرصيد تحتاج اعتماد المالك. لم يُكتب أيّ قيد.'
        else 'هذا الخصم يجعل الرصيد سالبًا — يحتاج اعتماد المالك. لم يُكتب أيّ قيد.' end);
  end if;

  insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type, quantity,
    usage_date, source, reason, client_description, internal_metadata,
    idempotency_key, idempotency_fingerprint, actor_id)
  values (v_sub.id, v_sub.client_id,
    (select id from public.csub_periods where subscription_id = v_sub.id and status = 'open'
      order by period_no desc limit 1),
    v_unit, 'adjustment', v_qty, coalesce(public.csub_txt(p, 'usage_date')::date, current_date),
    'correction', v_reason, public.csub_txt(p, 'client_description'),
    coalesce(p->'internal_metadata', '{}'::jsonb), v_key, v_fp, auth.uid())
  returning id into v_entry;

  perform public.csub_log('ledger_adjust', 'csub_ledger', v_entry,
    jsonb_build_object('subscription_id', v_sub.id, 'unit_type', v_unit, 'quantity', v_qty, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'entry_id', v_entry,
    'available_after', public.csub_available_core(v_sub.id, v_unit));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) الخطط وإصداراتها.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_cycle_months(p_cycle text, p_months int)
returns int language sql immutable security definer set search_path = public as $$
  select case p_cycle when 'monthly' then 1 when 'quarterly' then 3 when 'annual' then 12
                      else greatest(coalesce(p_months, 1), 1) end;
$$;

create or replace function public.csub_plan_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
  v_net numeric; v_rate numeric;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;

  v_id   := public.csub_uuid(p, 'id');
  v_net  := coalesce(public.csub_num(p, 'price_net'), 0);
  v_rate := coalesce(public.csub_num(p, 'vat_rate'), 15);

  if v_id is null then
    v_new := true;
    insert into public.csub_plans(code, name_ar, name_en, billing_cycle, cycle_months,
      price_net, vat_rate, vat_amount, allow_overage, overage_requires_approval,
      rollover_enabled, rollover_limit_units, rollover_max_periods,
      expiry_policy, expiry_days, grace_period_days,
      client_description, terms, limitations, internal_notes, created_by)
    values (public.csub_next_code('PLAN'),
      coalesce(public.csub_txt(p, 'name_ar'), 'خطّة بلا اسم'), public.csub_txt(p, 'name_en'),
      coalesce(public.csub_txt(p, 'billing_cycle'), 'monthly'),
      public.csub_num(p, 'cycle_months')::int,
      v_net, v_rate, public.csub_vat(v_net, v_rate),
      coalesce((p->>'allow_overage')::boolean, false),
      coalesce((p->>'overage_requires_approval')::boolean, true),
      coalesce((p->>'rollover_enabled')::boolean, false),
      public.csub_num(p, 'rollover_limit_units'), public.csub_num(p, 'rollover_max_periods')::int,
      coalesce(public.csub_txt(p, 'expiry_policy'), 'period_end'),
      public.csub_num(p, 'expiry_days')::int,
      coalesce(public.csub_num(p, 'grace_period_days')::int, 0),
      public.csub_txt(p, 'client_description'), public.csub_txt(p, 'terms'),
      public.csub_txt(p, 'limitations'), public.csub_txt(p, 'internal_notes'), auth.uid())
    returning id into v_id;
  else
    update public.csub_plans set
      name_ar = coalesce(public.csub_txt(p, 'name_ar'), name_ar),
      name_en = case when p ? 'name_en' then public.csub_txt(p, 'name_en') else name_en end,
      billing_cycle = coalesce(public.csub_txt(p, 'billing_cycle'), billing_cycle),
      cycle_months  = case when p ? 'cycle_months' then public.csub_num(p, 'cycle_months')::int else cycle_months end,
      price_net  = case when p ? 'price_net' then v_net else price_net end,
      vat_rate   = case when p ? 'vat_rate'  then v_rate else vat_rate end,
      vat_amount = case when (p ? 'price_net') or (p ? 'vat_rate')
                        then public.csub_vat(case when p ? 'price_net' then v_net else price_net end,
                                             case when p ? 'vat_rate'  then v_rate else vat_rate end)
                        else vat_amount end,
      allow_overage = coalesce((p->>'allow_overage')::boolean, allow_overage),
      overage_requires_approval = coalesce((p->>'overage_requires_approval')::boolean, overage_requires_approval),
      rollover_enabled = coalesce((p->>'rollover_enabled')::boolean, rollover_enabled),
      rollover_limit_units = case when p ? 'rollover_limit_units' then public.csub_num(p, 'rollover_limit_units') else rollover_limit_units end,
      rollover_max_periods = case when p ? 'rollover_max_periods' then public.csub_num(p, 'rollover_max_periods')::int else rollover_max_periods end,
      expiry_policy = coalesce(public.csub_txt(p, 'expiry_policy'), expiry_policy),
      expiry_days   = case when p ? 'expiry_days' then public.csub_num(p, 'expiry_days')::int else expiry_days end,
      grace_period_days = coalesce(public.csub_num(p, 'grace_period_days')::int, grace_period_days),
      client_description = case when p ? 'client_description' then public.csub_txt(p, 'client_description') else client_description end,
      terms       = case when p ? 'terms'       then public.csub_txt(p, 'terms')       else terms end,
      limitations = case when p ? 'limitations' then public.csub_txt(p, 'limitations') else limitations end,
      internal_notes = case when p ? 'internal_notes' then public.csub_txt(p, 'internal_notes') else internal_notes end
    where id = v_id and is_deleted = false;
    if not found then return jsonb_build_object('ok', false, 'reason', 'plan_not_found'); end if;
  end if;

  perform public.csub_log(case when v_new then 'plan_create' else 'plan_update' end, 'csub_plan', v_id,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

create or replace function public.csub_plan_unit_set(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_plan uuid; v_unit text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  v_plan := public.csub_uuid(p, 'plan_id'); v_unit := public.csub_txt(p, 'unit_type');
  if v_plan is null or v_unit is null then return jsonb_build_object('ok', false, 'reason', 'invalid_payload'); end if;
  if not exists (select 1 from public.csub_unit_types where key = v_unit and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_unit_type', 'unit_type', v_unit);
  end if;
  if coalesce((p->>'remove')::boolean, false) then
    delete from public.csub_plan_units where plan_id = v_plan and unit_type = v_unit;
    perform public.csub_log('plan_unit_remove', 'csub_plan', v_plan, jsonb_build_object('unit_type', v_unit));
    return jsonb_build_object('ok', true, 'removed', true);
  end if;
  insert into public.csub_plan_units(plan_id, unit_type, custom_unit_label, quantity_per_period,
    overage_unit_price_net, overage_vat_rate, rollover_enabled, rollover_limit_units,
    expiry_policy, expiry_days, notes, sort_order)
  values (v_plan, v_unit, public.csub_txt(p, 'custom_unit_label'),
    coalesce(public.csub_num(p, 'quantity_per_period'), 0),
    coalesce(public.csub_num(p, 'overage_unit_price_net'), 0),
    coalesce(public.csub_num(p, 'overage_vat_rate'), 15),
    (p->>'rollover_enabled')::boolean, public.csub_num(p, 'rollover_limit_units'),
    public.csub_txt(p, 'expiry_policy'), public.csub_num(p, 'expiry_days')::int,
    public.csub_txt(p, 'notes'), coalesce(public.csub_num(p, 'sort_order')::int, 100))
  on conflict (plan_id, unit_type) do update set
    custom_unit_label = excluded.custom_unit_label,
    quantity_per_period = excluded.quantity_per_period,
    overage_unit_price_net = excluded.overage_unit_price_net,
    overage_vat_rate = excluded.overage_vat_rate,
    rollover_enabled = excluded.rollover_enabled,
    rollover_limit_units = excluded.rollover_limit_units,
    expiry_policy = excluded.expiry_policy, expiry_days = excluded.expiry_days,
    notes = excluded.notes, sort_order = excluded.sort_order
  returning id into v_id;
  perform public.csub_log('plan_unit_set', 'csub_plan', v_plan,
    jsonb_build_object('unit_type', v_unit, 'quantity_per_period', public.csub_num(p, 'quantity_per_period')));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- نشر إصدار: لقطة كاملة تُحفظ ولا تُعدَّل. الاشتراك القائم يبقى على إصداره.
create or replace function public.csub_plan_publish_version(p_plan uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_ver int; v_def jsonb; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.csub_plans where id = p_plan and is_deleted = false) then
    return jsonb_build_object('ok', false, 'reason', 'plan_not_found');
  end if;
  select to_jsonb(pl) - 'internal_notes' into v_def from public.csub_plans pl where pl.id = p_plan;
  v_def := v_def || jsonb_build_object('units',
    (select coalesce(jsonb_agg(to_jsonb(u) order by u.sort_order), '[]'::jsonb)
       from public.csub_plan_units u where u.plan_id = p_plan));
  select coalesce(max(version), 0) + 1 into v_ver from public.csub_plan_versions where plan_id = p_plan;
  insert into public.csub_plan_versions(plan_id, version, definition, note, published_by)
  values (p_plan, v_ver, v_def, p_note, auth.uid()) returning id into v_id;
  update public.csub_plans set current_version = v_ver where id = p_plan;
  perform public.csub_log('plan_version_publish', 'csub_plan', p_plan, jsonb_build_object('version', v_ver));
  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_ver);
end $$;

create or replace function public.csub_plan_set_active(p_plan uuid, p_active boolean, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_units int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  select count(*) into v_units from public.csub_plan_units where plan_id = p_plan;
  if coalesce(p_active, false) and v_units = 0 then
    return jsonb_build_object('ok', false, 'reason', 'plan_has_no_units',
      'message', 'خطّة بلا وحدة إنتاج واحدة ليست خطّة — أضف الوحدات قبل التفعيل.');
  end if;
  update public.csub_plans
     set is_active = coalesce(p_active, false),
         status = case when coalesce(p_active, false) then 'active' else 'inactive' end
   where id = p_plan and is_deleted = false;
  if not found then return jsonb_build_object('ok', false, 'reason', 'plan_not_found'); end if;
  perform public.csub_log('plan_set_active', 'csub_plan', p_plan,
    jsonb_build_object('is_active', p_active, 'note', p_note));
  return jsonb_build_object('ok', true, 'is_active', coalesce(p_active, false));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) دورة حياة الاشتراك.
--      draft → pending_approval → active → (suspended ⇄ active) → expired /
--      cancelled / completed. لا انتقال إلى active إلّا عبر csub_can_approve().
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_subscription_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false;
  v_net numeric; v_rate numeric; v_status text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  v_net  := coalesce(public.csub_num(p, 'price_net'), 0);
  v_rate := coalesce(public.csub_num(p, 'vat_rate'), 15);
  v_id   := public.csub_uuid(p, 'id');

  if v_id is null then
    if public.csub_uuid(p, 'client_id') is null then
      return jsonb_build_object('ok', false, 'reason', 'client_required');
    end if;
    v_new := true;
    insert into public.csub_subscriptions(code, client_id, plan_id, status, start_date, end_date,
      renewal_date, grace_period_days, auto_renew, price_net, vat_rate, vat_amount, price_is_custom,
      allow_overage, overage_requires_approval, rollover_enabled, rollover_limit_units,
      rollover_max_periods, expiry_policy, expiry_days, contract_reference, project_id,
      client_description, terms, limitations, internal_notes, created_by)
    values (public.csub_next_code('SUB'), public.csub_uuid(p, 'client_id'), public.csub_uuid(p, 'plan_id'),
      'draft', public.csub_txt(p, 'start_date')::date, public.csub_txt(p, 'end_date')::date,
      public.csub_txt(p, 'renewal_date')::date,
      coalesce(public.csub_num(p, 'grace_period_days')::int, 0),
      coalesce((p->>'auto_renew')::boolean, false),
      v_net, v_rate, public.csub_vat(v_net, v_rate),
      coalesce((p->>'price_is_custom')::boolean, false),
      coalesce((p->>'allow_overage')::boolean, false),
      coalesce((p->>'overage_requires_approval')::boolean, true),
      coalesce((p->>'rollover_enabled')::boolean, false),
      public.csub_num(p, 'rollover_limit_units'), public.csub_num(p, 'rollover_max_periods')::int,
      coalesce(public.csub_txt(p, 'expiry_policy'), 'period_end'),
      public.csub_num(p, 'expiry_days')::int, public.csub_txt(p, 'contract_reference'),
      public.csub_uuid(p, 'project_id'), public.csub_txt(p, 'client_description'),
      public.csub_txt(p, 'terms'), public.csub_txt(p, 'limitations'),
      public.csub_txt(p, 'internal_notes'), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.csub_subscriptions where id = v_id and is_deleted = false;
    if v_status is null then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
    -- ★ العميل لا يتغيّر بعد الإنشاء: تغييره ينقل رصيدًا من عميل إلى آخر.
    if p ? 'client_id' and public.csub_uuid(p, 'client_id') is distinct from
       (select client_id from public.csub_subscriptions where id = v_id) then
      return jsonb_build_object('ok', false, 'reason', 'client_is_immutable',
        'message', 'لا يُنقَل اشتراك من عميل إلى آخر — ذلك نقل رصيد. ألغِ الاشتراك وأنشئ آخر.');
    end if;
    if v_status not in ('draft', 'pending_approval') then
      -- بعد التفعيل تُعدَّل النصوص والمراجع فقط، لا القواعد المالية ولا التواريخ.
      update public.csub_subscriptions set
        contract_reference = case when p ? 'contract_reference' then public.csub_txt(p, 'contract_reference') else contract_reference end,
        client_description = case when p ? 'client_description' then public.csub_txt(p, 'client_description') else client_description end,
        internal_notes     = case when p ? 'internal_notes' then public.csub_txt(p, 'internal_notes') else internal_notes end,
        auto_renew         = coalesce((p->>'auto_renew')::boolean, auto_renew),
        project_id         = case when p ? 'project_id' then public.csub_uuid(p, 'project_id') else project_id end
      where id = v_id;
      perform public.csub_log('subscription_update_limited', 'csub_subscription', v_id,
        jsonb_build_object('status', v_status));
      return jsonb_build_object('ok', true, 'id', v_id, 'limited', true, 'status', v_status);
    end if;
    update public.csub_subscriptions set
      plan_id = case when p ? 'plan_id' then public.csub_uuid(p, 'plan_id') else plan_id end,
      start_date = case when p ? 'start_date' then public.csub_txt(p, 'start_date')::date else start_date end,
      end_date   = case when p ? 'end_date'   then public.csub_txt(p, 'end_date')::date   else end_date end,
      renewal_date = case when p ? 'renewal_date' then public.csub_txt(p, 'renewal_date')::date else renewal_date end,
      grace_period_days = coalesce(public.csub_num(p, 'grace_period_days')::int, grace_period_days),
      auto_renew = coalesce((p->>'auto_renew')::boolean, auto_renew),
      price_net  = case when p ? 'price_net' then v_net else price_net end,
      vat_rate   = case when p ? 'vat_rate'  then v_rate else vat_rate end,
      vat_amount = case when (p ? 'price_net') or (p ? 'vat_rate')
                        then public.csub_vat(case when p ? 'price_net' then v_net else price_net end,
                                             case when p ? 'vat_rate'  then v_rate else vat_rate end)
                        else vat_amount end,
      price_is_custom = coalesce((p->>'price_is_custom')::boolean, price_is_custom),
      allow_overage = coalesce((p->>'allow_overage')::boolean, allow_overage),
      overage_requires_approval = coalesce((p->>'overage_requires_approval')::boolean, overage_requires_approval),
      rollover_enabled = coalesce((p->>'rollover_enabled')::boolean, rollover_enabled),
      rollover_limit_units = case when p ? 'rollover_limit_units' then public.csub_num(p, 'rollover_limit_units') else rollover_limit_units end,
      rollover_max_periods = case when p ? 'rollover_max_periods' then public.csub_num(p, 'rollover_max_periods')::int else rollover_max_periods end,
      expiry_policy = coalesce(public.csub_txt(p, 'expiry_policy'), expiry_policy),
      expiry_days = case when p ? 'expiry_days' then public.csub_num(p, 'expiry_days')::int else expiry_days end,
      contract_reference = case when p ? 'contract_reference' then public.csub_txt(p, 'contract_reference') else contract_reference end,
      project_id = case when p ? 'project_id' then public.csub_uuid(p, 'project_id') else project_id end,
      client_description = case when p ? 'client_description' then public.csub_txt(p, 'client_description') else client_description end,
      terms = case when p ? 'terms' then public.csub_txt(p, 'terms') else terms end,
      limitations = case when p ? 'limitations' then public.csub_txt(p, 'limitations') else limitations end,
      internal_notes = case when p ? 'internal_notes' then public.csub_txt(p, 'internal_notes') else internal_notes end
    where id = v_id;
  end if;

  perform public.csub_log(case when v_new then 'subscription_create' else 'subscription_update' end,
    'csub_subscription', v_id,
    jsonb_build_object('keys', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new, 'status', 'draft');
end $$;

create or replace function public.csub_subscription_submit(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_appr uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  select status into v_status from public.csub_subscriptions where id = p_id and is_deleted = false;
  if v_status is null then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  if v_status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', v_status);
  end if;
  update public.csub_subscriptions
     set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now()
   where id = p_id;
  v_appr := public.csub_approval_submit_core('activation', p_id, null, null,
    jsonb_build_object('note', p_note), p_note);
  perform public.csub_log('subscription_submit', 'csub_subscription', p_id,
    jsonb_build_object('approval_request_id', v_appr));
  return jsonb_build_object('ok', true, 'status', 'pending_approval', 'approval_request_id', v_appr,
    'message', 'أُرسل للاعتماد. التفعيل قرار المالك وحده — لا يفعّله موظّف مبيعات ولا عميل.');
end $$;

-- ★★ نواة التفعيل ★★ لا تُنادى إلّا من csub_subscription_activate أو من
--    csub_approval_decide بعد اعتماد المالك. ولا تُمنح لأحد (REVOKE في §15).
create or replace function public.csub_activate_core(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.csub_subscriptions%rowtype; u record; v_period uuid; v_months int;
  v_start date; v_end date; v_alloc int := 0; v_ver int; v_snap jsonb;
begin
  select * into s from public.csub_subscriptions where id = p_id and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  if s.status not in ('draft', 'pending_approval') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', s.status);
  end if;

  -- (١) نسخ وحدات الخطّة وقواعدها — الاشتراك يصير مستقلًّا عن تعديلات الخطّة.
  if s.plan_id is not null then
    insert into public.csub_subscription_units(subscription_id, unit_type, custom_unit_label,
      quantity_per_period, overage_unit_price_net, overage_vat_rate, rollover_enabled,
      rollover_limit_units, expiry_policy, expiry_days, notes, sort_order)
    select s.id, pu.unit_type, pu.custom_unit_label, pu.quantity_per_period,
           pu.overage_unit_price_net, pu.overage_vat_rate, pu.rollover_enabled,
           pu.rollover_limit_units, pu.expiry_policy, pu.expiry_days, pu.notes, pu.sort_order
      from public.csub_plan_units pu where pu.plan_id = s.plan_id
    on conflict (subscription_id, unit_type) do nothing;

    select current_version into v_ver from public.csub_plans where id = s.plan_id;
    select definition into v_snap from public.csub_plan_versions
     where plan_id = s.plan_id and version = v_ver;
  end if;

  if not exists (select 1 from public.csub_subscription_units where subscription_id = s.id) then
    return jsonb_build_object('ok', false, 'reason', 'no_units',
      'message', 'اشتراك بلا وحدة إنتاج واحدة لا يُفعَّل — لا رصيد لتخصيصه.');
  end if;

  -- (٢) الفترة الأولى.
  v_start := coalesce(s.start_date, current_date);
  select public.csub_cycle_months(pl.billing_cycle, pl.cycle_months) into v_months
    from public.csub_plans pl where pl.id = s.plan_id;
  v_months := coalesce(v_months, 1);
  v_end := coalesce(s.end_date, (v_start + (v_months || ' months')::interval)::date - 1);

  insert into public.csub_periods(subscription_id, period_no, starts_on, ends_on, status)
  values (s.id, 1, v_start, v_end, 'open')
  on conflict (subscription_id, period_no) do nothing;
  select id into v_period from public.csub_periods where subscription_id = s.id and period_no = 1;

  -- (٣) تخصيص الرصيد — idempotent بمفتاح مشتقّ، فإعادة التفعيل لا تمنح مرّتين.
  for u in select * from public.csub_subscription_units where subscription_id = s.id and quantity_per_period > 0 loop
    begin
      insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type,
        quantity, usage_date, source, reason, client_description,
        idempotency_key, idempotency_fingerprint, actor_id)
      values (s.id, s.client_id, v_period, u.unit_type, 'allocation', u.quantity_per_period,
        v_start, 'plan_allocation', coalesce(p_note, 'تخصيص الفترة الأولى'),
        'رصيد الفترة الأولى', 'csub:alloc:' || s.id::text || ':1:' || u.unit_type,
        public.csub_fingerprint('allocation', s.id, u.unit_type, u.quantity_per_period, '1'), auth.uid());
      v_alloc := v_alloc + 1;
    exception when unique_violation then null;    -- خُصِّص من قبل: لا يُمنح ثانيةً
    end;
  end loop;

  update public.csub_subscriptions set
    status = 'active', start_date = v_start, end_date = coalesce(end_date, v_end),
    renewal_date = coalesce(renewal_date, coalesce(end_date, v_end)),
    approved_by = auth.uid(), approved_at = now(), activated_at = now(),
    plan_version = coalesce(v_ver, plan_version), plan_snapshot = coalesce(v_snap, plan_snapshot)
  where id = s.id;

  perform public.csub_log('subscription_activate', 'csub_subscription', s.id,
    jsonb_build_object('allocated_units', v_alloc, 'period_id', v_period, 'plan_version', v_ver));
  perform public.csub_notify((select user_id from public.clients where id = s.client_id),
    'csub_subscription_activated', s.id,
    'تم تفعيل اشتراكك ورصيد الإنتاج متاح الآن.', 'Your subscription is active and credits are available.');
  return jsonb_build_object('ok', true, 'id', s.id, 'status', 'active',
    'period_id', v_period, 'allocated_units', v_alloc);
end $$;

-- ★★ التفعيل: المالك وحده. لا مفتاح صلاحية يفتح هذا الباب. ★★
create or replace function public.csub_subscription_activate(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_approve(), false) then
    raise exception 'not authorized: activation_requires_owner — لا يفعّل الاشتراك عميل ولا موظّف مبيعات';
  end if;
  return public.csub_activate_core(p_id, p_note);
end $$;

-- ─── التعليق / الاستئناف / الإلغاء / الإكمال ─────────────────────────────
create or replace function public.csub_subscription_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.csub_subscriptions%rowtype; v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_status not in ('suspended','active','cancelled','completed','expired') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status_target');
  end if;
  -- ★ العودة إلى active منح رصيد ضمنيّ (يفتح الاستهلاك) ⇒ المالك وحده.
  if p_status = 'active' then
    if not coalesce(public.csub_can_approve(), false) then
      raise exception 'not authorized: resume_requires_owner';
    end if;
  elsif not coalesce(public.csub_can_manage(), false) then
    raise exception 'not authorized';
  end if;

  select * into s from public.csub_subscriptions where id = p_id and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;

  v_ok := case
    when p_status = 'suspended' then s.status = 'active'
    when p_status = 'active'    then s.status = 'suspended'
    when p_status = 'cancelled' then s.status in ('draft','pending_approval','active','suspended')
    when p_status = 'completed' then s.status in ('active','expired')
    when p_status = 'expired'   then s.status in ('active','suspended')
    else false end;
  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition',
      'from', s.status, 'to', p_status);
  end if;
  if p_status in ('cancelled','suspended') and coalesce(btrim(coalesce(p_reason,'')), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  update public.csub_subscriptions set
    status = p_status,
    suspended_at = case when p_status = 'suspended' then now() else suspended_at end,
    suspend_reason = case when p_status = 'suspended' then p_reason else suspend_reason end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end,
    expired_at   = case when p_status = 'expired'   then now() else expired_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_id;

  perform public.csub_log('subscription_' || p_status, 'csub_subscription', p_id,
    jsonb_build_object('from', s.status, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'status', p_status, 'from', s.status,
    'note', 'الرصيد لا يُحذف عند تغيير الحالة — الدفتر يبقى كاملًا، والاستهلاك وحده يتوقّف.');
end $$;

-- ─── إغلاق الفترة: الترحيل والانتهاء يقعان هنا، وبقيود لا بتعديل رقم ────
create or replace function public.csub_period_close(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  s public.csub_subscriptions%rowtype; pr public.csub_periods%rowtype; u record;
  v_avail numeric; v_roll numeric; v_exp numeric; v_policy text; v_rolled int;
  v_tot_roll numeric := 0; v_tot_exp numeric := 0; v_lines jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;

  select * into s from public.csub_subscriptions
   where id = public.csub_uuid(p, 'subscription_id') and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;

  select * into pr from public.csub_periods
   where subscription_id = s.id and (id = public.csub_uuid(p, 'period_id') or public.csub_uuid(p, 'period_id') is null)
   order by period_no desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'period_not_found'); end if;
  if pr.status = 'closed' then
    return jsonb_build_object('ok', true, 'already_closed', true, 'period_no', pr.period_no);
  end if;

  select count(*) into v_rolled from public.csub_periods
   where subscription_id = s.id and status = 'closed' and rolled_over_units > 0;

  for u in select * from public.csub_subscription_units where subscription_id = s.id loop
    perform 1 from public.csub_subscription_units
     where subscription_id = s.id and unit_type = u.unit_type for update;
    v_avail := public.csub_available_core(s.id, u.unit_type);
    if v_avail <= 0 then continue; end if;
    v_policy := coalesce(u.expiry_policy, s.expiry_policy);

    if v_policy <> 'period_end' then
      -- 'never' لا ينتهي، و'fixed_days' يُعالَج في المسح الزمنيّ لا عند الإغلاق.
      v_roll := v_avail; v_exp := 0;
    else
      if coalesce(u.rollover_enabled, s.rollover_enabled)
         and (s.rollover_max_periods is null or v_rolled < s.rollover_max_periods) then
        v_roll := least(v_avail, coalesce(u.rollover_limit_units, s.rollover_limit_units, v_avail));
      else
        v_roll := 0;
      end if;
      v_exp := v_avail - v_roll;
    end if;

    if v_exp > 0 then
      begin
        insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type,
          quantity, usage_date, source, reason, client_description,
          idempotency_key, idempotency_fingerprint, actor_id)
        values (s.id, s.client_id, pr.id, u.unit_type, 'expiry', v_exp, pr.ends_on, 'expiry_sweep',
          'انتهاء رصيد غير مستعمل عند إغلاق الفترة ' || pr.period_no,
          'رصيد لم يُستعمل حتى نهاية الفترة',
          'csub:expire:' || pr.id::text || ':' || u.unit_type,
          public.csub_fingerprint('expiry', s.id, u.unit_type, v_exp, pr.id::text), auth.uid());
      exception when unique_violation then null;
      end;
      v_tot_exp := v_tot_exp + v_exp;
    end if;
    v_tot_roll := v_tot_roll + v_roll;
    v_lines := v_lines || jsonb_build_object('unit_type', u.unit_type, 'available', v_avail,
      'rolled_over', v_roll, 'expired', v_exp, 'policy', v_policy);
  end loop;

  update public.csub_periods set status = 'closed', closed_at = now(), closed_by = auth.uid(),
    rolled_over_units = v_tot_roll, expired_units = v_tot_exp
   where id = pr.id;

  perform public.csub_log('period_close', 'csub_period', pr.id,
    jsonb_build_object('subscription_id', s.id, 'period_no', pr.period_no,
                       'rolled_over', v_tot_roll, 'expired', v_tot_exp));
  return jsonb_build_object('ok', true, 'period_no', pr.period_no, 'rolled_over_units', v_tot_roll,
    'expired_units', v_tot_exp, 'lines', v_lines,
    'note', 'الترحيل ليس قيدًا جديدًا: الرصيد المرحَّل هو ما لم يُكتب له قيد انتهاء.');
end $$;

-- ─── التجديد: قرار مالك صريح. auto_renew **لا يُقرأ هنا إطلاقًا**. ───────
create or replace function public.csub_renew_core(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  s public.csub_subscriptions%rowtype; u record; v_no int; v_period uuid;
  v_start date; v_end date; v_months int; v_alloc int := 0;
begin
  select * into s from public.csub_subscriptions where id = p_id and is_deleted = false for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  if s.status not in ('active', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status', 'status', s.status);
  end if;

  select coalesce(max(period_no), 0) into v_no from public.csub_periods where subscription_id = s.id;
  if v_no = 0 then return jsonb_build_object('ok', false, 'reason', 'no_period_to_renew'); end if;
  if exists (select 1 from public.csub_periods where subscription_id = s.id and period_no = v_no and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'close_current_period_first',
      'message', 'أغلق الفترة الحالية أوّلًا كي يُحسم الترحيل والانتهاء قبل تخصيص فترة جديدة.');
  end if;

  select public.csub_cycle_months(pl.billing_cycle, pl.cycle_months) into v_months
    from public.csub_plans pl where pl.id = s.plan_id;
  v_months := coalesce(v_months, 1);
  v_start := coalesce(public.csub_txt(p, 'starts_on')::date,
                      (select ends_on + 1 from public.csub_periods where subscription_id = s.id and period_no = v_no));
  v_end := coalesce(public.csub_txt(p, 'ends_on')::date,
                    (v_start + (v_months || ' months')::interval)::date - 1);

  insert into public.csub_periods(subscription_id, period_no, starts_on, ends_on, status)
  values (s.id, v_no + 1, v_start, v_end, 'open')
  on conflict (subscription_id, period_no) do nothing;
  select id into v_period from public.csub_periods where subscription_id = s.id and period_no = v_no + 1;

  for u in select * from public.csub_subscription_units where subscription_id = s.id and quantity_per_period > 0 loop
    begin
      insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type,
        quantity, usage_date, source, reason, client_description,
        idempotency_key, idempotency_fingerprint, actor_id)
      values (s.id, s.client_id, v_period, u.unit_type, 'allocation', u.quantity_per_period,
        v_start, 'renewal', 'تخصيص فترة التجديد ' || (v_no + 1), 'رصيد الفترة الجديدة',
        'csub:alloc:' || s.id::text || ':' || (v_no + 1) || ':' || u.unit_type,
        public.csub_fingerprint('allocation', s.id, u.unit_type, u.quantity_per_period, (v_no + 1)::text),
        auth.uid());
      v_alloc := v_alloc + 1;
    exception when unique_violation then null;
    end;
  end loop;

  update public.csub_subscriptions set status = 'active', end_date = v_end,
    renewal_date = v_end, expired_at = null where id = s.id;

  perform public.csub_log('subscription_renew', 'csub_subscription', s.id,
    jsonb_build_object('period_no', v_no + 1, 'allocated_units', v_alloc, 'ends_on', v_end));
  return jsonb_build_object('ok', true, 'period_no', v_no + 1, 'period_id', v_period,
    'allocated_units', v_alloc, 'ends_on', v_end);
end $$;

create or replace function public.csub_subscription_renew(p_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_approve(), false) then
    raise exception 'not authorized: renewal_requires_owner — التجديد منح رصيد، وقراره للمالك وحده';
  end if;
  return public.csub_renew_core(p_id, p_payload);
end $$;

-- ─── المسح الزمنيّ: انتهاء الاشتراك وانتهاء الرصيد ذي المدّة الثابتة ─────
-- ★ صدق القياس ★ الانتهاء هنا يقع على مستوى **الوحدة** لا على مستوى دفعات
--   FIFO: الرصيد ينتهي فقط حين يكون كلّ تخصيص قائم في الدفتر أقدم من نافذة
--   السياسة. هذا تحفّظيّ عمدًا — لا يُنهي رصيدًا قد يكون ما يزال صالحًا،
--   ولا يدّعي دقّة دفعات لا يملكها.
create or replace function public.csub_expiry_scan(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  s record; u record; v_avail numeric; v_last date; v_days int; v_policy text;
  v_expired int := 0; v_flipped int := 0; v_units numeric := 0;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;

  for s in select * from public.csub_subscriptions where is_deleted = false and status = 'active' loop
    -- (أ) انتهاء الاشتراك نفسه بعد نهاية المدّة ومهلة السماح.
    if s.end_date is not null and current_date > (s.end_date + s.grace_period_days) then
      update public.csub_subscriptions set status = 'expired', expired_at = now() where id = s.id;
      v_flipped := v_flipped + 1;
      perform public.csub_log('subscription_expired_scan', 'csub_subscription', s.id,
        jsonb_build_object('end_date', s.end_date, 'grace_period_days', s.grace_period_days));
      continue;
    end if;
    -- (ب) رصيد بسياسة fixed_days.
    for u in select * from public.csub_subscription_units where subscription_id = s.id loop
      v_policy := coalesce(u.expiry_policy, s.expiry_policy);
      v_days   := coalesce(u.expiry_days, s.expiry_days);
      if v_policy <> 'fixed_days' or v_days is null then continue; end if;
      perform 1 from public.csub_subscription_units
       where subscription_id = s.id and unit_type = u.unit_type for update;
      v_avail := public.csub_available_core(s.id, u.unit_type);
      if v_avail <= 0 then continue; end if;
      select max(coalesce(l.usage_date, l.occurred_at::date)) into v_last from public.csub_ledger l
       where l.subscription_id = s.id and l.unit_type = u.unit_type and l.d_allocated > 0;
      if v_last is null or current_date <= (v_last + v_days) then continue; end if;
      begin
        insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type,
          quantity, usage_date, source, reason, client_description,
          idempotency_key, idempotency_fingerprint, actor_id)
        values (s.id, s.client_id,
          (select id from public.csub_periods where subscription_id = s.id and status = 'open'
            order by period_no desc limit 1),
          u.unit_type, 'expiry', v_avail, current_date, 'expiry_sweep',
          'انتهاء رصيد بسياسة مدّة ثابتة (' || v_days || ' يومًا بعد آخر تخصيص)',
          'انتهت صلاحية الرصيد غير المستعمل',
          'csub:expfix:' || s.id::text || ':' || u.unit_type || ':' || to_char(current_date, 'YYYYMMDD'),
          public.csub_fingerprint('expiry', s.id, u.unit_type, v_avail, to_char(current_date, 'YYYYMMDD')),
          auth.uid());
        v_expired := v_expired + 1; v_units := v_units + v_avail;
      exception when unique_violation then null;
      end;
    end loop;
  end loop;

  perform public.csub_log('expiry_scan', 'csub_subscription', null,
    jsonb_build_object('subscriptions_expired', v_flipped, 'unit_expiry_entries', v_expired, 'units', v_units));
  return jsonb_build_object('ok', true, 'subscriptions_expired', v_flipped,
    'unit_expiry_entries', v_expired, 'expired_units', v_units);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) قرار المالك — نقطة وقوع كلّ تغيير معلَّق.
--      الاعتماد يُطبَّق **عبر النوى المشتركة** لا بنسخة ثانية من المنطق.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_approval_decide(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.csub_approval_requests%rowtype; v_res jsonb; v_entry uuid; v_err text; v_sub uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_approve(), false) then
    raise exception 'not authorized: decision_requires_owner';
  end if;
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  end if;

  select * into a from public.csub_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'approval_not_found'); end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', a.status);
  end if;

  update public.csub_approval_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;

  if p_decision = 'rejected' then
    if a.kind = 'activation' and a.subscription_id is not null then
      update public.csub_subscriptions set status = 'draft'
       where id = a.subscription_id and status = 'pending_approval';
    end if;
    perform public.csub_log('approval_rejected', 'csub_approval', p_id, jsonb_build_object('kind', a.kind));
    return jsonb_build_object('ok', true, 'status', 'rejected', 'kind', a.kind);
  end if;

  begin
    if a.kind = 'activation' then
      v_res := public.csub_activate_core(a.subscription_id, p_note);
    elsif a.kind = 'renewal' then
      v_res := public.csub_renew_core(a.subscription_id, coalesce(a.payload, '{}'::jsonb));
    elsif a.kind = 'adjustment' then
      select client_id into v_sub from public.csub_subscriptions where id = a.subscription_id;
      insert into public.csub_ledger(subscription_id, client_id, period_id, unit_type, entry_type,
        quantity, usage_date, source, reason, approval_request_id,
        idempotency_key, idempotency_fingerprint, actor_id)
      values (a.subscription_id, v_sub,
        (select id from public.csub_periods where subscription_id = a.subscription_id and status = 'open'
          order by period_no desc limit 1),
        a.unit_type, 'adjustment', a.quantity, current_date, 'correction',
        coalesce(a.reason, 'تسوية معتمَدة من المالك'), a.id,
        'csub:appr:' || a.id::text,
        public.csub_fingerprint('adjustment', a.subscription_id, a.unit_type, a.quantity, a.id::text),
        auth.uid())
      returning id into v_entry;
      v_res := jsonb_build_object('ok', true, 'entry_id', v_entry);
    elsif a.kind = 'reversal' then
      select client_id into v_sub from public.csub_subscriptions where id = a.subscription_id;
      insert into public.csub_ledger(subscription_id, client_id, unit_type, entry_type, quantity,
        reverses_entry_id, usage_date, source, reason, approval_request_id,
        idempotency_key, idempotency_fingerprint, actor_id)
      values (a.subscription_id, v_sub, a.unit_type, 'reversal', 1,
        (a.payload->>'entry_id')::uuid, current_date, 'correction',
        coalesce(a.reason, 'عكس معتمَد من المالك'), a.id,
        'csub:apprrev:' || a.id::text,
        public.csub_fingerprint('reversal', a.subscription_id, a.unit_type, a.quantity, a.id::text),
        auth.uid())
      returning id into v_entry;
      v_res := jsonb_build_object('ok', true, 'entry_id', v_entry);
    elsif a.kind = 'overage' then
      -- ★ الاعتماد هنا **إذن** لا قيد: الاستهلاك يقع لاحقًا بمرجع هذا الطلب،
      --   ويُستهلك الإذن مرّة واحدة (consumed_entry_id).
      v_res := jsonb_build_object('ok', true, 'authorized', true, 'applies_nothing', true);
    else
      v_res := jsonb_build_object('ok', false, 'reason', 'unknown_kind');
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text;
    update public.csub_approval_requests set apply_error = left(coalesce(v_err, ''), 300) where id = p_id;
    return jsonb_build_object('ok', false, 'reason', 'apply_failed', 'detail', left(coalesce(v_err, ''), 300));
  end;

  update public.csub_approval_requests
     set applied_entry_id = coalesce(v_entry, applied_entry_id),
         apply_error = case when coalesce((v_res->>'ok')::boolean, false) then null
                            else coalesce(v_res->>'reason', 'apply_returned_not_ok') end
   where id = p_id;

  perform public.csub_log('approval_approved', 'csub_approval', p_id,
    jsonb_build_object('kind', a.kind, 'result', v_res));
  return jsonb_build_object('ok', true, 'status', 'approved', 'kind', a.kind, 'result', v_res);
end $$;

create or replace function public.csub_approval_withdraw(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.csub_approval_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into a from public.csub_approval_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'approval_not_found'); end if;
  if a.requested_by <> auth.uid() and not coalesce(public.csub_can_approve(), false) then
    raise exception 'not authorized';
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', a.status);
  end if;
  update public.csub_approval_requests
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;
  if a.kind = 'activation' and a.subscription_id is not null then
    update public.csub_subscriptions set status = 'draft'
     where id = a.subscription_id and status = 'pending_approval';
  end if;
  perform public.csub_log('approval_withdrawn', 'csub_approval', p_id, jsonb_build_object('kind', a.kind));
  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §14) القراءة — كلّها RPC. المال يُقنَّع بـNULL مع pricing_visible = false،
--      ولا يُصفَّر أبدًا: صفر كاذب رقم يتصرّف العميل بناءً عليه.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.csub_client_owns(p_subscription uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and exists (
    select 1 from public.csub_subscriptions s
     where s.id = p_subscription and s.is_deleted = false
       and s.client_id = public.my_client_id()), false);
$$;

create or replace function public.csub_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'authenticated',   auth.uid() is not null,
    'is_staff',        coalesce(public.is_staff(), false),
    'is_client',       coalesce(public.csub_is_client(), false),
    'can_view',        coalesce(public.csub_can_view(), false),
    'can_manage',      coalesce(public.csub_can_manage(), false),
    'can_consume',     coalesce(public.csub_can_consume(), false),
    'can_adjust',      coalesce(public.csub_can_adjust(), false),
    'can_view_pricing',coalesce(public.csub_can_view_pricing(), false),
    'can_export',      coalesce(public.csub_can_export(), false),
    'can_approve',     coalesce(public.csub_can_approve(), false),
    'my_client_id',    public.my_client_id(),
    'notes', jsonb_build_object(
      'activation', 'التفعيل والتجديد وزيادة الرصيد: المالك وحده. ليست مفتاح صلاحية.',
      'auto_renew', 'auto_renew معلومة تعاقدية — لا شحن ولا تجديد آليّ.',
      'ledger',     'قيود الدفتر غير قابلة للتعديل أو الحذف؛ التصحيح بقيد عكسيّ.'));
$$;

create or replace function public.csub_unit_catalog() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not (coalesce(public.csub_can_view(), false) or coalesce(public.csub_is_client(), false)) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object('ok', true, 'units',
    (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label_ar', label_ar, 'label_en', label_en,
       'uom_ar', uom_ar, 'is_custom', is_custom) order by sort_order), '[]'::jsonb)
       from public.csub_unit_types where is_active));
end $$;

create or replace function public.csub_plans_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_price boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  return jsonb_build_object('ok', true, 'pricing_visible', v_price, 'rows',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'code', pl.code, 'name_ar', pl.name_ar, 'name_en', pl.name_en,
      'billing_cycle', pl.billing_cycle, 'is_active', pl.is_active, 'status', pl.status,
      'current_version', pl.current_version, 'currency', pl.currency,
      'price_net',   case when v_price then pl.price_net   else null end,
      'vat_rate',    case when v_price then pl.vat_rate    else null end,
      'vat_amount',  case when v_price then pl.vat_amount  else null end,
      'price_gross', case when v_price then pl.price_gross else null end,
      'allow_overage', pl.allow_overage, 'expiry_policy', pl.expiry_policy,
      'rollover_enabled', pl.rollover_enabled, 'grace_period_days', pl.grace_period_days,
      'client_description', pl.client_description,
      'units', (select coalesce(jsonb_agg(jsonb_build_object('unit_type', pu.unit_type,
                  'custom_unit_label', pu.custom_unit_label,
                  'quantity_per_period', pu.quantity_per_period,
                  'overage_unit_price_net', case when v_price then pu.overage_unit_price_net else null end,
                  'overage_vat_rate', case when v_price then pu.overage_vat_rate else null end)
                  order by pu.sort_order), '[]'::jsonb)
                  from public.csub_plan_units pu where pu.plan_id = pl.id)
      ) order by pl.created_at desc), '[]'::jsonb)
     from public.csub_plans pl
    where pl.is_deleted = false
      and (public.csub_txt(f, 'status') is null or pl.status = public.csub_txt(f, 'status'))
      and ((f->>'active_only')::boolean is not true or pl.is_active)));
end $$;

create or replace function public.csub_plan_detail(p_plan uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_price boolean; v jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  select to_jsonb(pl) into v from public.csub_plans pl where pl.id = p_plan and pl.is_deleted = false;
  if v is null then return jsonb_build_object('ok', false, 'reason', 'plan_not_found'); end if;
  if not coalesce(public.csub_can_manage(), false) then v := v - 'internal_notes'; end if;
  if not v_price then
    v := v - 'price_net' - 'vat_rate' - 'vat_amount' - 'price_gross';
  end if;
  -- ★ وحدات الخطّة: إسقاط صريح بالاسم، لا to_jsonb خام ★
  --   to_jsonb(pu) كان يُخرج overage_unit_price_net وoverage_vat_rate كاملَين
  --   لكلّ من يملك csub.view — أي أنّ السعر كان يتسرّب من داخل مصفوفة الوحدات
  --   بينما العمود المماثل في csub_plans_list مُقنَّع. الإسقاط الصريح يُنهي
  --   الاختلاف: ما لا يُذكر هنا لا يخرج، والمال يُقنَّع بـNULL لا يُصفَّر.
  return jsonb_build_object('ok', true, 'pricing_visible', v_price, 'plan', v,
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', pu.id, 'unit_type', pu.unit_type, 'custom_unit_label', pu.custom_unit_label,
                'quantity_per_period', pu.quantity_per_period,
                'rollover_enabled', pu.rollover_enabled, 'rollover_limit_units', pu.rollover_limit_units,
                'expiry_policy', pu.expiry_policy, 'expiry_days', pu.expiry_days,
                'notes', pu.notes, 'sort_order', pu.sort_order,
                'overage_unit_price_net', case when v_price then pu.overage_unit_price_net else null end,
                'overage_vat_rate',       case when v_price then pu.overage_vat_rate       else null end)
                order by pu.sort_order), '[]'::jsonb)
                from public.csub_plan_units pu where pu.plan_id = p_plan),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', pv.version,
                   'published_at', pv.published_at, 'note', pv.note) order by pv.version desc), '[]'::jsonb)
                   from public.csub_plan_versions pv where pv.plan_id = p_plan));
end $$;

create or replace function public.csub_subscriptions_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_price boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  return jsonb_build_object('ok', true, 'pricing_visible', v_price, 'rows',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'client_id', s.client_id,
      'client_label', coalesce(c.company, c.full_name, '—'),
      'plan_id', s.plan_id, 'plan_name', pl.name_ar, 'plan_version', s.plan_version,
      'status', s.status, 'start_date', s.start_date, 'end_date', s.end_date,
      'renewal_date', s.renewal_date, 'grace_period_days', s.grace_period_days,
      'auto_renew', s.auto_renew, 'auto_renew_is_informational', true,
      'currency', s.currency,
      'price_net',   case when v_price then s.price_net   else null end,
      'vat_rate',    case when v_price then s.vat_rate    else null end,
      'vat_amount',  case when v_price then s.vat_amount  else null end,
      'price_gross', case when v_price then s.price_gross else null end,
      'allow_overage', s.allow_overage, 'contract_reference', s.contract_reference,
      'project_id', s.project_id
      ) order by s.created_at desc), '[]'::jsonb)
     from public.csub_subscriptions s
     left join public.clients c on c.id = s.client_id
     left join public.csub_plans pl on pl.id = s.plan_id
    where s.is_deleted = false
      and (public.csub_txt(f, 'status') is null or s.status = public.csub_txt(f, 'status'))
      and (public.csub_uuid(f, 'client_id') is null or s.client_id = public.csub_uuid(f, 'client_id'))));
end $$;

create or replace function public.csub_balances(p_subscription uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_price boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  if not exists (select 1 from public.csub_subscriptions where id = p_subscription and is_deleted = false) then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_found');
  end if;
  return jsonb_build_object('ok', true, 'subscription_id', p_subscription, 'pricing_visible', v_price,
    'balances', (select coalesce(jsonb_agg(jsonb_build_object(
      'unit_type', b.unit_type, 'label_ar', ut.label_ar, 'uom_ar', ut.uom_ar,
      'allocated', b.allocated, 'reserved', b.reserved, 'used', b.used,
      'expired', b.expired, 'available', b.available,
      'overage_units', b.overage_units, 'entries', b.entries,
      'quantity_per_period', u.quantity_per_period,
      'overage_unit_price_net', case when v_price then u.overage_unit_price_net else null end,
      'overage_vat_rate', case when v_price then u.overage_vat_rate else null end)
      order by ut.sort_order), '[]'::jsonb)
      from public.csub_balance_core(p_subscription, null) b
      join public.csub_unit_types ut on ut.key = b.unit_type
      join public.csub_subscription_units u
        on u.subscription_id = p_subscription and u.unit_type = b.unit_type),
    'note', 'الرصيد مشتقّ من مجموع القيود ولا يُحفَظ في أيّ عمود.');
end $$;

-- كشف الحساب — برصيد **جارٍ** محسوب بنافذة فوق ترتيب القيود.
create or replace function public.csub_statement(p_subscription uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_price boolean; v_lim int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  v_lim := least(greatest(coalesce(public.csub_num(f, 'limit')::int, 200), 1), 1000);
  return jsonb_build_object('ok', true, 'pricing_visible', v_price, 'rows',
    (select coalesce(jsonb_agg(x order by x_no desc), '[]'::jsonb) from (
      select l.entry_no as x_no, jsonb_build_object(
        'id', l.id, 'entry_no', l.entry_no, 'entry_type', l.entry_type, 'unit_type', l.unit_type,
        'quantity', l.quantity, 'd_allocated', l.d_allocated, 'd_reserved', l.d_reserved,
        'd_used', l.d_used, 'd_expired', l.d_expired,
        'running_available', sum(l.d_allocated - l.d_reserved - l.d_used - l.d_expired)
          over (partition by l.unit_type order by l.entry_no
                rows between unbounded preceding and current row),
        'usage_date', l.usage_date, 'occurred_at', l.occurred_at, 'source', l.source,
        'reason', l.reason, 'client_description', l.client_description,
        'service_request_id', l.service_request_id, 'service_request_ref', l.service_request_ref,
        'project_id', l.project_id, 'reverses_entry_id', l.reverses_entry_id,
        'reservation_entry_id', l.reservation_entry_id,
        'overage_units', l.overage_units,
        'overage_amount_net',   case when v_price then l.overage_amount_net   else null end,
        'overage_vat_amount',   case when v_price then l.overage_vat_amount   else null end,
        'overage_amount_gross', case when v_price then l.overage_amount_gross else null end,
        'currency', l.currency, 'actor_id', l.actor_id,
        'internal_metadata', case when coalesce(public.csub_can_manage(), false) then l.internal_metadata else null end
        ) as x
        from public.csub_ledger l
       where l.subscription_id = p_subscription
         and (public.csub_txt(f, 'unit_type') is null or l.unit_type = public.csub_txt(f, 'unit_type'))
       order by l.entry_no desc limit v_lim) q));
end $$;

create or replace function public.csub_subscription_detail(p_subscription uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_price boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  select to_jsonb(s) into v from public.csub_subscriptions s
   where s.id = p_subscription and s.is_deleted = false;
  if v is null then return jsonb_build_object('ok', false, 'reason', 'subscription_not_found'); end if;
  if not coalesce(public.csub_can_manage(), false) then v := v - 'internal_notes'; end if;
  -- ★★ إسقاط المال من صفّ الاشتراك ★★
  --   'plan_snapshot' هو لقطة الخطّة كاملةً (to_jsonb(pl) في
  --   csub_plan_publish_version) وتحمل price_net وvat_rate وvat_amount و
  --   price_gross ومصفوفة units بأسعار التجاوز. إسقاط الأعمدة الأربعة العليا
  --   وحده كان يترك السعر كلّه داخل اللقطة لمن يملك csub.view فقط —
  --   تسريب فعليّ لا نظريّ. و'price_is_custom' وحده يكشف أنّ لهذا العميل سعرًا
  --   خاصًّا، وهي معلومة تجارية لا تشغيلية.
  if not v_price then
    v := v - 'price_net' - 'vat_rate' - 'vat_amount' - 'price_gross'
           - 'plan_snapshot' - 'price_is_custom';
  end if;
  -- ★ وحدات الاشتراك: إسقاط صريح بالاسم لا to_jsonb خام ★ (كما في تفصيل الخطّة)
  return jsonb_build_object('ok', true, 'pricing_visible', v_price, 'subscription', v,
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', u.id, 'unit_type', u.unit_type, 'custom_unit_label', u.custom_unit_label,
                'quantity_per_period', u.quantity_per_period,
                'rollover_enabled', u.rollover_enabled, 'rollover_limit_units', u.rollover_limit_units,
                'expiry_policy', u.expiry_policy, 'expiry_days', u.expiry_days,
                'notes', u.notes, 'sort_order', u.sort_order,
                'overage_unit_price_net', case when v_price then u.overage_unit_price_net else null end,
                'overage_vat_rate',       case when v_price then u.overage_vat_rate       else null end)
                order by u.sort_order), '[]'::jsonb)
                from public.csub_subscription_units u where u.subscription_id = p_subscription),
    'periods', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', pr.id, 'period_no', pr.period_no, 'starts_on', pr.starts_on,
                  'ends_on', pr.ends_on, 'status', pr.status,
                  'rolled_over_units', pr.rolled_over_units, 'expired_units', pr.expired_units,
                  'closed_at', pr.closed_at) order by pr.period_no desc), '[]'::jsonb)
                  from public.csub_periods pr where pr.subscription_id = p_subscription),
    'balances', public.csub_balances(p_subscription) -> 'balances');
end $$;

create or replace function public.csub_approvals_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_all boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_all := coalesce(public.csub_can_approve(), false);
  return jsonb_build_object('ok', true, 'can_decide', v_all, 'rows',
    (select coalesce(jsonb_agg(to_jsonb(a) order by a.requested_at desc), '[]'::jsonb)
       from public.csub_approval_requests a
      where (v_all or a.requested_by = auth.uid())
        and (public.csub_txt(f, 'status') is null or a.status = public.csub_txt(f, 'status'))));
end $$;

create or replace function public.csub_audit_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  return jsonb_build_object('ok', true, 'rows',
    (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
       from (select * from public.csub_audit
              where (public.csub_uuid(f, 'entity_id') is null or entity_id = public.csub_uuid(f, 'entity_id'))
              order by created_at desc
              limit least(greatest(coalesce(public.csub_num(f, 'limit')::int, 200), 1), 1000)) a));
end $$;

create or replace function public.csub_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_price boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_price := coalesce(public.csub_can_view_pricing(), false);
  return jsonb_build_object('ok', true, 'pricing_visible', v_price,
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select status, count(*) as n from public.csub_subscriptions
                           where is_deleted = false group by status) q),
    'expiring_30d', (select count(*) from public.csub_subscriptions
                      where is_deleted = false and status = 'active' and end_date is not null
                        and end_date <= current_date + 30),
    'pending_approvals', (select count(*) from public.csub_approval_requests where status = 'pending'),
    'open_reservations', (select count(*) from public.csub_ledger where entry_type = 'reservation'),
    'overage_units_total', (select coalesce(sum(overage_units), 0) from public.csub_ledger),
    'contracted_net', case when v_price then
      (select coalesce(sum(price_net), 0) from public.csub_subscriptions
        where is_deleted = false and status = 'active') else null end,
    'contracted_vat', case when v_price then
      (select coalesce(sum(vat_amount), 0) from public.csub_subscriptions
        where is_deleted = false and status = 'active') else null end,
    'currency', 'SAR');
end $$;

-- ─── واجهة العميل — أعمدة مسموحة بالاسم لا استثناءات بالاسم ─────────────
--     ⛔ لا internal_notes ولا internal_metadata ولا actor_id ولا سجلّ تدقيق.
create or replace function public.csub_my_subscriptions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_client uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_client := public.my_client_id();
  if v_client is null then
    return jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'reason', 'no_client_profile');
  end if;
  return jsonb_build_object('ok', true, 'rows',
    (select coalesce(jsonb_agg(jsonb_build_object(
       'id', s.id, 'code', s.code, 'plan_name', pl.name_ar, 'status', s.status,
       'start_date', s.start_date, 'end_date', s.end_date, 'renewal_date', s.renewal_date,
       'auto_renew', s.auto_renew, 'auto_renew_note', 'معلومة تعاقدية — لا تجديد ولا خصم آليّ.',
       'grace_period_days', s.grace_period_days, 'currency', s.currency,
       'price_net', s.price_net, 'vat_rate', s.vat_rate, 'vat_amount', s.vat_amount,
       'price_gross', s.price_gross, 'contract_reference', s.contract_reference,
       'description', s.client_description, 'terms', s.terms, 'limitations', s.limitations)
       order by s.created_at desc), '[]'::jsonb)
     from public.csub_subscriptions s left join public.csub_plans pl on pl.id = s.plan_id
    where s.client_id = v_client and s.is_deleted = false));
end $$;

create or replace function public.csub_my_balances(p_subscription uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_client_owns(p_subscription), false) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object('ok', true, 'subscription_id', p_subscription, 'balances',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'unit_type', b.unit_type, 'label_ar', ut.label_ar, 'uom_ar', ut.uom_ar,
      'allocated', b.allocated, 'reserved', b.reserved, 'used', b.used,
      'expired', b.expired, 'available', b.available, 'overage_units', b.overage_units)
      order by ut.sort_order), '[]'::jsonb)
      from public.csub_balance_core(p_subscription, null) b
      join public.csub_unit_types ut on ut.key = b.unit_type));
end $$;

create or replace function public.csub_my_statement(p_subscription uuid, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_lim int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_client_owns(p_subscription), false) then
    raise exception 'not authorized';
  end if;
  v_lim := least(greatest(coalesce(public.csub_num(f, 'limit')::int, 200), 1), 500);
  return jsonb_build_object('ok', true, 'rows',
    (select coalesce(jsonb_agg(x order by x_no desc), '[]'::jsonb) from (
      select l.entry_no as x_no, jsonb_build_object(
        'entry_no', l.entry_no, 'entry_type', l.entry_type, 'unit_type', l.unit_type,
        'quantity', l.quantity,
        'running_available', sum(l.d_allocated - l.d_reserved - l.d_used - l.d_expired)
          over (partition by l.unit_type order by l.entry_no
                rows between unbounded preceding and current row),
        'usage_date', l.usage_date, 'description', l.client_description,
        'service_request_ref', l.service_request_ref,
        'overage_units', l.overage_units, 'overage_amount_net', l.overage_amount_net,
        'overage_vat_amount', l.overage_vat_amount, 'overage_amount_gross', l.overage_amount_gross,
        'currency', l.currency) as x
        from public.csub_ledger l
       where l.subscription_id = p_subscription
       order by l.entry_no desc limit v_lim) q));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §15) الصلاحيات — لا شيء لـanon، أبدًا. الجداول قراءة فقط عبر RLS،
--      والدفتر لا يُمنح عليه UPDATE ولا DELETE لأحد (والمُشغِّل يمنعهما أصلًا).
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  foreach f in array array[
    'public.csub_access()',
    'public.csub_unit_catalog()',
    'public.csub_plans_list(jsonb)',
    'public.csub_plan_detail(uuid)',
    'public.csub_subscriptions_list(jsonb)',
    'public.csub_subscription_detail(uuid)',
    'public.csub_balances(uuid)',
    'public.csub_statement(uuid,jsonb)',
    'public.csub_approvals_list(jsonb)',
    'public.csub_audit_list(jsonb)',
    'public.csub_dashboard(jsonb)',
    'public.csub_my_subscriptions()',
    'public.csub_my_balances(uuid)',
    'public.csub_my_statement(uuid,jsonb)',
    'public.csub_plan_upsert(jsonb)',
    'public.csub_plan_unit_set(jsonb)',
    'public.csub_plan_publish_version(uuid,text)',
    'public.csub_plan_set_active(uuid,boolean,text)',
    'public.csub_subscription_upsert(jsonb)',
    'public.csub_subscription_submit(uuid,text)',
    'public.csub_subscription_activate(uuid,text)',
    'public.csub_subscription_set_status(uuid,text,text)',
    'public.csub_subscription_renew(uuid,jsonb)',
    'public.csub_period_close(jsonb)',
    'public.csub_expiry_scan(jsonb)',
    'public.csub_reserve(jsonb)',
    'public.csub_release(jsonb)',
    'public.csub_consume(jsonb)',
    'public.csub_reverse(jsonb)',
    'public.csub_adjust(jsonb)',
    'public.csub_approval_decide(uuid,text,text)',
    'public.csub_approval_withdraw(uuid,text)',
    -- المُسنَدات: تُقيَّم داخل سياسات RLS بدور المُنادي، فلا بدّ من EXECUTE له.
    'public.csub_perm(text)',
    'public.csub_perm_key_exists(text)',
    'public.csub_is_owner_role()',
    'public.csub_can_approve()',
    'public.csub_can_manage()',
    'public.csub_can_view()',
    'public.csub_can_consume()',
    'public.csub_can_adjust()',
    'public.csub_can_view_pricing()',
    'public.csub_can_export()',
    'public.csub_is_client()',
    'public.csub_client_owns(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- الدوالّ الداخلية: لا تُمنح لأحد — تُنفَّذ ضمن سلسلة SECURITY DEFINER فقط.
  -- ★ csub_activate_core وcsub_renew_core هنا تحديدًا: لو مُنحتا لأمكن الالتفاف
  --   على بوّابة المالك بنداء مباشر من العميل. الغلاف وحده هو الباب.
  foreach f in array array[
    'public.csub_log(text,text,uuid,jsonb)',
    'public.csub_notify(uuid,text,uuid,text,text)',
    'public.csub_touch()',
    'public.csub_txt(jsonb,text)',
    'public.csub_uuid(jsonb,text)',
    'public.csub_num(jsonb,text)',
    'public.csub_next_code(text)',
    'public.csub_vat(numeric,numeric)',
    'public.csub_cycle_months(text,integer)',
    'public.csub_ledger_immutable()',
    'public.csub_ledger_post()',
    'public.csub_balance_core(uuid,text)',
    'public.csub_available_core(uuid,text)',
    'public.csub_idem_lookup(text,text,uuid)',
    'public.csub_fingerprint(text,uuid,text,numeric,text)',
    'public.csub_approval_submit_core(text,uuid,text,numeric,jsonb,text)',
    'public.csub_activate_core(uuid,text)',
    'public.csub_renew_core(uuid,jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  foreach t in array array['csub_settings','csub_unit_types','csub_plans','csub_plan_units',
    'csub_plan_versions','csub_subscriptions','csub_subscription_units','csub_periods',
    'csub_approval_requests','csub_ledger','csub_audit'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;

  foreach t in array array['csub_plan_code_seq','csub_subscription_code_seq'] loop
    execute format('revoke all on sequence public.%I from public', t);
    begin execute format('revoke all on sequence public.%I from anon', t); exception when undefined_object then null; end;
    begin execute format('revoke all on sequence public.%I from authenticated', t); exception when undefined_object then null; end;
  end loop;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §16) SELF-TEST — ثابت بالكامل. لا يستدعي دالّة محميّة، ولا مصيدة تجعل فحصًا
--      يمرّ عند غياب هدفه. أيّ فشل يُلغي المعاملة كلّها.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare t text; f text; v_def text; v_txt text; v_b boolean; v_n bigint; v_bad text;
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
  LEDGER_WRITERS constant text[] := array[
    'public.csub_reserve(jsonb)','public.csub_release(jsonb)','public.csub_consume(jsonb)',
    'public.csub_reverse(jsonb)','public.csub_adjust(jsonb)'];
  -- الأسطح الموظّفية التي تلمس جدولًا يحمل مالًا. كلّها تمرّ بفحص (15ب).
  PRICED_SURFACES constant text[] := array[
    'public.csub_plans_list(jsonb)','public.csub_plan_detail(uuid)',
    'public.csub_subscriptions_list(jsonb)','public.csub_subscription_detail(uuid)',
    'public.csub_balances(uuid)','public.csub_statement(uuid,jsonb)',
    'public.csub_dashboard(jsonb)'];
  -- مفردات المال بالاسم الكامل. ⛔ لا 'currency': العملة ثابت SAR مقيَّد وليست
  --   مبلغًا، وهي تُعرض بلا تقنيع في كلّ سطح عمدًا.
  PRICED_COLS constant text[] := array[
    'price_net','price_gross','vat_amount','vat_rate','price_is_custom','plan_snapshot',
    'overage_unit_price_net','overage_vat_rate','overage_amount_net',
    'overage_vat_amount','overage_amount_gross',
    'unit_price','unit_rate','contract_value','renewal_value','minimum_price',
    'floor_price','list_price','selling_price','sale_price',
    'cost','unit_cost','internal_cost','margin','margin_pct','profit','profitability',
    'discount','discount_amount','invoice_amount','receivable','receivable_amount',
    'overage_value','billing_amount'];
begin
  -- (1) الجداول الأحد عشر موجودة وRLS مفعّلة عليها كلّها.
  foreach t in array array['csub_settings','csub_unit_types','csub_plans','csub_plan_units',
    'csub_plan_versions','csub_subscriptions','csub_subscription_units','csub_periods',
    'csub_approval_requests','csub_ledger','csub_audit'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'CSUB SELF-TEST: الجدول % غير موجود', t; end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = t) then
      raise exception 'CSUB SELF-TEST: RLS غير مفعّلة على %', t; end if;
  end loop;

  -- (2) لا سياسة كتابة مباشرة على أيّ جدول — الكتابة كلّها عبر RPC.
  select string_agg(tablename || '.' || policyname, ', ') into v_bad from pg_policies
   where schemaname = 'public' and tablename like 'csub\_%' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: سياسة كتابة مباشرة موجودة (%) — إخفاء الزرّ ليس تصريحًا', v_bad;
  end if;

  -- (3) ★ الرصيد مشتقّ، ولا تكلفة ولا هامش ولا ربح في الموديول إطلاقًا ★
  select string_agg(table_name || '.' || column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'public' and table_name like 'csub\_%'
     and (column_name = 'balance' or column_name like '%_balance'
          or column_name like '%cost%' or column_name like '%margin%' or column_name like '%profit%');
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: عمود محظور (%) — الرصيد مشتقّ، واستنتاج الربحية ممنوع بنيويًّا', v_bad;
  end if;

  -- (4) ★★ عدم قابلية الدفتر للتعديل — بمُشغِّل لا بعُرف ★★
  foreach t in array array['t_csub_ledger_no_update','t_csub_ledger_no_delete','t_csub_ledger_no_truncate'] loop
    if not exists (select 1 from pg_trigger where tgname = t and not tgisinternal
                    and tgrelid = to_regclass('public.csub_ledger')) then
      raise exception 'CSUB SELF-TEST: مُشغِّل عدم القابلية للتعديل % غير موجود — الدفتر قابل للتزوير', t;
    end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_ledger_immutable()'));
  if v_def not ilike '%raise exception%' or v_def not ilike '%0A000%' then
    raise exception 'CSUB SELF-TEST: دالّة عدم القابلية للتعديل لا ترفع استثناءً';
  end if;
  if v_def ilike '%return new%' then
    raise exception 'CSUB SELF-TEST: مُشغِّل المنع يعيد NEW — قد يسمح بالتعديل';
  end if;

  -- (5) مُشغِّل الترحيل موجود ويفرض عزل العميل والوحدة والحجز.
  if not exists (select 1 from pg_trigger where tgname = 't_csub_ledger_post' and not tgisinternal) then
    raise exception 'CSUB SELF-TEST: مُشغِّل الترحيل غير موجود — أعمدة d_* ستُقبل من المُدرِج';
  end if;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_ledger_post()'));
  foreach t in array array['ledger_client_mismatch','unit_not_in_subscription','reservation_exhausted',
                           'cannot_reverse_a_reversal','reversal_scope_mismatch'] loop
    if v_def not ilike '%' || t || '%' then
      raise exception 'CSUB SELF-TEST: مُشغِّل الترحيل بلا حارس %', t;
    end if;
  end loop;
  if v_def not ilike '%select s.client_id into v_client%' then
    raise exception 'CSUB SELF-TEST: العميل لا يُشتقّ من الاشتراك — استهلاك رصيد عميل لآخر ممكن';
  end if;

  -- (6) الفهارس الفريدة: مفتاح التكرار، ولا عكس مزدوج.
  foreach t in array array['uq_csub_ledger_idem','uq_csub_ledger_reversal'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = t) then
      raise exception 'CSUB SELF-TEST: الفهرس الفريد % غير موجود', t;
    end if;
  end loop;

  -- (7) المُسنَدات لا تعيد NULL بلا جلسة (المحرّر يعمل بـauth.uid() = NULL).
  foreach f in array array['csub_can_view','csub_can_manage','csub_can_consume','csub_can_adjust',
                           'csub_can_view_pricing','csub_can_export','csub_can_approve',
                           'csub_is_owner_role','csub_is_client'] loop
    execute format('select public.%I()', f) into v_b;
    if v_b is null then raise exception 'CSUB SELF-TEST: % أعادت NULL', f; end if;
    if v_b then raise exception 'CSUB SELF-TEST: % = true بلا جلسة — fail-open', f; end if;
  end loop;
  if public.csub_perm('csub.manage') is not false then
    raise exception 'CSUB SELF-TEST: csub_perm لا تُغلق بلا جلسة'; end if;
  if public.csub_client_owns(ZERO) is not false then
    raise exception 'CSUB SELF-TEST: csub_client_owns لا تُغلق بلا جلسة'; end if;
  if public.csub_available_core(ZERO, 'filming_day') is distinct from 0 then
    raise exception 'CSUB SELF-TEST: المتاح لاشتراك غير موجود ليس صفرًا صريحًا';
  end if;

  -- (8) ★★ اعتماد المالك لا يُشترى بمفتاح ★★
  v_def := pg_get_functiondef(to_regprocedure('public.csub_can_approve()'));
  if v_def ilike '%csub_perm%' then
    raise exception 'CSUB SELF-TEST: اعتماد المالك يمرّ بمفتاح صلاحية — لم يعد اعتماد مالك';
  end if;
  if v_def not ilike '%csub_is_owner_role%' then
    raise exception 'CSUB SELF-TEST: اعتماد المالك لا يشترط دور المالك';
  end if;
  if public.csub_perm_key_exists('csub.approve') then
    raise exception 'CSUB SELF-TEST: مفتاح csub.approve موجود في الكتالوج — الاعتماد صار منحة إدارية';
  end if;

  -- (9) ★★ لا تفعيل ولا تجديد ولا منح رصيد إلّا عبر بوّابة المالك ★★
  foreach f in array array['public.csub_subscription_activate(uuid,text)',
                           'public.csub_subscription_renew(uuid,jsonb)',
                           'public.csub_approval_decide(uuid,text,text)'] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%csub_can_approve()%' then
      raise exception 'CSUB SELF-TEST: % تمنح رصيدًا بلا بوّابة المالك', f;
    end if;
    if v_def ilike '%csub_perm(%' then
      raise exception 'CSUB SELF-TEST: % تقبل مفتاح صلاحية بديلًا عن المالك', f;
    end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_subscription_set_status(uuid,text,text)'));
  if v_def not ilike '%resume_requires_owner%' then
    raise exception 'CSUB SELF-TEST: استئناف اشتراك معلَّق لا يمرّ ببوّابة المالك';
  end if;
  -- والنوى لا تُنادى من الواجهة إطلاقًا.
  foreach f in array array['public.csub_activate_core(uuid,text)','public.csub_renew_core(uuid,jsonb)'] loop
    if exists (select 1 from pg_roles where rolname = 'authenticated')
       and has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'CSUB SELF-TEST: % منحت لـauthenticated — التفاف على بوّابة المالك', f;
    end if;
  end loop;

  -- (10) ★★ auto_renew معلومة لا آلية ★★ لا مسار منح رصيد يقرأها.
  foreach f in array array['public.csub_activate_core(uuid,text)','public.csub_renew_core(uuid,jsonb)',
                           'public.csub_subscription_renew(uuid,jsonb)','public.csub_consume(jsonb)',
                           'public.csub_expiry_scan(jsonb)','public.csub_period_close(jsonb)'] loop
    if pg_get_functiondef(to_regprocedure(f)) ilike '%auto_renew%' then
      raise exception 'CSUB SELF-TEST: % تقرأ auto_renew — صار العَلَم آلية شحن لا معلومة', f;
    end if;
  end loop;

  -- (11) ★★ السباق ★★ كلّ كاتب في الدفتر يقفل صفًّا قبل حساب الرصيد.
  foreach f in array LEDGER_WRITERS loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def !~* 'for\s+update' then
      raise exception 'CSUB SELF-TEST: % تكتب في الدفتر بلا قفل صفّ — استهلاكان متزامنان قد ينجحان معًا', f;
    end if;
    if v_def not ilike '%idempotency_key%' then
      raise exception 'CSUB SELF-TEST: % بلا مفتاح تكرار', f;
    end if;
    if v_def not ilike '%csub_log%' then
      raise exception 'CSUB SELF-TEST: % تكتب بلا تدقيق', f;
    end if;
  end loop;

  -- (12) ★★ الاستهلاك: الاستحالات الستّ مذكورة صراحةً في الكود ★★
  v_def := pg_get_functiondef(to_regprocedure('public.csub_consume(jsonb)'));
  foreach t in array array['idempotency_key_required','insufficient_balance','subscription_not_active',
                           'subscription_expired','unit_not_in_subscription',
                           'service_request_already_consumed','pending_approval',
                           'csub_available_core','allow_overage','overage_requires_approval'] loop
    if v_def not ilike '%' || t || '%' then
      raise exception 'CSUB SELF-TEST: csub_consume بلا حارس %', t;
    end if;
  end loop;
  -- الرصيد يُحسب بعد القفل لا قبله.
  if position('for update' in lower(v_def)) > position('csub_available_core' in lower(v_def)) then
    raise exception 'CSUB SELF-TEST: csub_consume تحسب الرصيد قبل القفل — السباق ما يزال ممكنًا';
  end if;
  -- إذن التجاوز يُستهلك مرّة واحدة.
  if v_def not ilike '%consumed_entry_id%' then
    raise exception 'CSUB SELF-TEST: إذن التجاوز قابل لإعادة الاستعمال';
  end if;

  -- (13) التسوية والعكس: سبب إلزاميّ، والزيادة باعتماد المالك.
  v_def := pg_get_functiondef(to_regprocedure('public.csub_adjust(jsonb)'));
  if v_def not ilike '%reason_required%' or v_def not ilike '%csub_can_approve()%'
     or v_def not ilike '%pending_approval%' then
    raise exception 'CSUB SELF-TEST: التسوية اليدوية بلا سبب إلزاميّ أو بلا اعتماد مالك للزيادة';
  end if;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_reverse(jsonb)'));
  if v_def not ilike '%reason_required%' or v_def not ilike '%already_reversed%' then
    raise exception 'CSUB SELF-TEST: القيد العكسيّ بلا سبب أو قابل للتكرار';
  end if;

  -- (14) ★ التجميد ★ لا دالّة هنا تكتب في منصّة المشاريع، ولا تستعمل بوّاباتها.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'csub\_%'
     and pg_get_functiondef(p.oid) ~* '(insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)|update\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)|delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests))';
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: دالّة تكتب في منصّة المشاريع المجمَّدة (%)', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'csub\_%'
     and pg_get_functiondef(p.oid) ~* '(can_manage_projects|is_kian_member)';
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: دالّة تستعمل بوّابة منصّة المشاريع (%) — بوّابة خشنة في موديول تجاريّ', v_bad;
  end if;

  -- (15) واجهة العميل لا تحمل بيانات داخلية.
  foreach f in array array['public.csub_my_subscriptions()','public.csub_my_balances(uuid)',
                           'public.csub_my_statement(uuid,jsonb)'] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    foreach t in array array['internal_notes','internal_metadata','csub_audit','actor_id'] loop
      if v_def ilike '%' || t || '%' then
        raise exception 'CSUB SELF-TEST: % تعرض حقلًا داخليًّا (%) للعميل', f, t;
      end if;
    end loop;
    if v_def not ilike '%my_client_id()%' and v_def not ilike '%csub_client_owns%' then
      raise exception 'CSUB SELF-TEST: % لا تُقيّد النتيجة بعميل الجلسة', f;
    end if;
  end loop;

  -- ════════════════════════════════════════════════════════════════════════
  -- (15ب) ★★ فصل العقود: لا مبلغ يخرج من سطح موظّف بلا مفتاح الأسعار ★★
  --
  --   الفحص لا يسأل «هل توجد بوّابة؟» بل «هل بقي مبلغ خارجها؟». المنهج:
  --   احذف من نصّ التعريف كلّ ذكر **مُقنَّع** (case when v_price … else null end)
  --   وكلّ ذكر **مُسقَط** (- 'عمود')، ثمّ ابحث عمّا بقي. أيّ مفردة مال تنجو من
  --   الحذف هي مفردة تخرج بلا تقنيع.
  --
  --   ما أمسكه هذا الفحص فعليًّا عند كتابته — تسريبان حقيقيّان لا نظريّان:
  --     ★ csub_subscription_detail كانت تُعيد to_jsonb(s) وتُسقط أربعة أعمدة
  --       عليا فقط، بينما 'plan_snapshot' لقطةُ الخطّة كاملةً بأسعارها وبمصفوفة
  --       وحداتها — فكان السعر كلّه يخرج لمن يملك csub.view وحده.
  --     ★ الدالّتان التفصيليّتان كانتا تُعيدان to_jsonb للوحدات، وفيه
  --       overage_unit_price_net خامًا — بينما العمود نفسه مُقنَّع في
  --       csub_plans_list وcsub_balances. الإسقاط الصريح أنهى هذا التناقض.
  -- ════════════════════════════════════════════════════════════════════════
  foreach f in array PRICED_SURFACES loop
    if to_regprocedure(f) is null then
      raise exception 'CSUB SELF-TEST: السطح المُسعَّر % غير موجود', f; end if;
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%csub_can_view_pricing%' then
      raise exception 'CSUB SELF-TEST: % سطح موظّف يلمس المال بلا بوّابة أسعار', f;
    end if;
    if v_def not ilike '%''pricing_visible''%' then
      raise exception 'CSUB SELF-TEST: % لا تصرّح بحال رؤية المال — القارئ لا يميّز NULL المُقنَّع عن غياب القيمة', f;
    end if;
    -- (٠) احذف التعليقات: pg_get_functiondef يُعيدها ضمن الجسم، وشرحُ ثغرةٍ
    --     ليس ارتكابَها. بدون هذا يفشل الفحص على تعليق يذكر اسم عمود سعر.
    v_txt := regexp_replace(v_def, chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g');
    -- (١) احذف الذكر المُقنَّع، بمفتاحه إن سبقه.
    v_txt := regexp_replace(v_txt,
      '''[a-z_]+''\s*,\s*case\s+when\s+v_price\s+then[^;]{0,400}?else\s+null\s+end', ' ', 'gi');
    v_txt := regexp_replace(v_txt,
      'case\s+when\s+v_price\s+then[^;]{0,400}?else\s+null\s+end', ' ', 'gi');
    -- (٢) احذف الذكر المُسقَط بالاسم من كائن jsonb.
    v_txt := regexp_replace(v_txt, '-\s*''[a-z_]+''', ' ', 'gi');
    -- (٣) ما بقي من مفردات المال يخرج بلا تقنيع.
    foreach t in array PRICED_COLS loop
      if v_txt ~* ('\m' || t || '\M') then
        raise exception 'CSUB SELF-TEST: % تُخرج % بلا تقنيع ولا إسقاط — المال يبلغ دورًا بلا csub.view_pricing', f, t;
      end if;
    end loop;
  end loop;

  -- (15ج) ★ الوحدات تُسقَط بالاسم لا بـto_jsonb خام ★ — to_jsonb يُخرج كلّ عمود
  --   يُضاف لاحقًا إلى الجدول تلقائيًّا، فهو قائمة سماح مفتوحة، أي لا قائمة.
  foreach f in array array['public.csub_plan_detail(uuid)','public.csub_subscription_detail(uuid)'] loop
    -- التعليقات تُحذف أوّلًا: التعليق أسفلُه يشرح to_jsonb(pu) بالاسم، وشرحُ
    -- ثغرةٍ ليس ارتكابَها. بدونه يفشل هذا الفحص على تعليقه هو.
    v_def := regexp_replace(pg_get_functiondef(to_regprocedure(f)),
                            chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g');
    if v_def ~* 'to_jsonb\(\s*(pu|u)\s*\)' then
      raise exception 'CSUB SELF-TEST: % تُعيد وحدات الاشتراك/الخطّة بـto_jsonb خام — أيّ عمود سعر يُضاف لاحقًا يخرج بلا تقنيع', f;
    end if;
    if v_def not ilike '%overage_unit_price_net%' then
      raise exception 'CSUB SELF-TEST: % لا تذكر سعر وحدة التجاوز أصلًا — الإسقاط الصريح غائب', f;
    end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_subscription_detail(uuid)'));
  if v_def not ilike '%- ''plan_snapshot''%' then
    raise exception 'CSUB SELF-TEST: تفصيل الاشتراك لا يُسقط plan_snapshot — لقطة الخطّة تحمل السعر كاملًا لمن لا يملك مفتاحه';
  end if;

  -- (15د) ★ التشغيل لا يُمنح جدول الاشتراكات الماليّ أصلًا ★ — التقنيع في RPC
  --   ليس ضابطًا وحده: لو قرأ csub.view الجدول عبر PostgREST مباشرةً لقرأ
  --   price_net خامًا. سياسة القراءة على الجداول الحاملة للمال بمفتاح الأسعار.
  foreach t in array array['csub_plans','csub_plan_units','csub_plan_versions',
                           'csub_subscriptions','csub_subscription_units','csub_ledger'] loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t and cmd = 'SELECT'
                      and coalesce(qual, '') ilike '%csub_can_view_pricing%') then
      raise exception 'CSUB SELF-TEST: سياسة قراءة % لا تشترط مفتاح الأسعار — التشغيل يقرأ المال خامًا من الجدول', t;
    end if;
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = t and cmd = 'SELECT'
                  and coalesce(qual, '') ~* '\mcsub_can_view\(\)') then
      raise exception 'CSUB SELF-TEST: سياسة قراءة % تقبل csub_can_view() — بوّابة التشغيل على جدول ماليّ', t;
    end if;
  end loop;

  -- (15هـ) ★★ لا مِجَسّ سعر ولا مِجَسّ ربح ★★
  --   كلّ سبب يخرج من مسار الرصيد لا يحمل إلّا **وحدات**: لا مبلغ، ولا عتبة
  --   ماليّة، ولا رقم يُطرح من آخر ليُشتقّ منه سعر وحدة. وراية «يلزم اعتماد»
  --   لا تُقارن بمبلغ أصلًا — العتبة كلّها بالوحدات، فلا شيء يُبحَث ثنائيًّا.
  foreach f in array array['public.csub_reserve(jsonb)','public.csub_release(jsonb)',
                           'public.csub_consume(jsonb)','public.csub_reverse(jsonb)',
                           'public.csub_adjust(jsonb)'] loop
    v_def := regexp_replace(pg_get_functiondef(to_regprocedure(f)),
                            chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g');
    -- ما يُعاد للمنادي: لا مفردة مال في أيّ jsonb_build_object للإرجاع.
    for v_txt in select m[1] from regexp_matches(v_def,
        'return\s+jsonb_build_object\(([^;]{0,4000}?)\);', 'g') m loop
      foreach t in array PRICED_COLS loop
        if v_txt ~* ('\m' || t || '\M') then
          raise exception 'CSUB SELF-TEST: % تُعيد % في جواب المنادي — مبلغ بجوار عدد وحدات يُشتقّ منه سعر الوحدة بطرح واحد', f, t;
        end if;
      end loop;
    end loop;
  end loop;

  -- (16) البذور: ثلاثة عشر نوع وحدة بالضبط بالأسماء المطلوبة.
  select count(*) into v_n from public.csub_unit_types;
  if v_n < 13 then raise exception 'CSUB SELF-TEST: أنواع الوحدات المبذورة % أقلّ من ثلاثة عشر', v_n; end if;
  foreach t in array array['filming_day','filming_hour','photography_session','edited_reel','editing_hour',
    'motion_graphics_hour','drone_session','drone_hour','event_coverage','podcast_episode',
    'design_item','live_stream_day','custom_unit'] loop
    if not exists (select 1 from public.csub_unit_types where key = t) then
      raise exception 'CSUB SELF-TEST: نوع الوحدة % غير مبذور', t;
    end if;
  end loop;
  select count(*) into v_n from public.csub_settings;
  if v_n < 6 then raise exception 'CSUB SELF-TEST: إعدادات الموديول ناقصة'; end if;

  -- (17) ★ الضريبة حقل مستقلّ والإجمالي مولَّد، والعملة SAR بقيد ★
  foreach t in array array['csub_plans','csub_subscriptions'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'vat_amount') then
      raise exception 'CSUB SELF-TEST: % بلا عمود ضريبة مستقلّ', t; end if;
    if coalesce((select is_generated from information_schema.columns
                  where table_schema = 'public' and table_name = t and column_name = 'price_gross'), 'NEVER') = 'NEVER' then
      raise exception 'CSUB SELF-TEST: %.price_gross ليس عمودًا مولَّدًا — الإجمالي قد يُكتب بلا ضريبة', t; end if;
  end loop;
  if coalesce((select is_generated from information_schema.columns
                where table_schema = 'public' and table_name = 'csub_ledger'
                  and column_name = 'overage_amount_gross'), 'NEVER') = 'NEVER' then
    raise exception 'CSUB SELF-TEST: إجمالي التجاوز ليس عمودًا مولَّدًا'; end if;
  foreach t in array array['csub_plans','csub_subscriptions','csub_ledger'] loop
    if not exists (select 1 from pg_constraint con
                    where con.conrelid = to_regclass('public.' || t) and con.contype = 'c'
                      and pg_get_constraintdef(con.oid) ilike '%currency%' and pg_get_constraintdef(con.oid) ilike '%SAR%') then
      raise exception 'CSUB SELF-TEST: % بلا قيد عملة SAR', t; end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_vat(numeric,numeric)'));
  if v_def not ilike '%round%' then raise exception 'CSUB SELF-TEST: حساب الضريبة بلا تقريب صريح'; end if;

  -- (18) الترحيلة لم تُنشئ بيانات عمل. now() ثابت داخل المعاملة.
  select count(*) into v_n from public.csub_subscriptions where created_at = now();
  if v_n <> 0 then raise exception 'CSUB SELF-TEST: الترحيلة أنشأت % اشتراكًا', v_n; end if;
  select count(*) into v_n from public.csub_ledger where created_at = now();
  if v_n <> 0 then raise exception 'CSUB SELF-TEST: الترحيلة كتبت % قيدًا في الدفتر', v_n; end if;
  select count(*) into v_n from public.csub_audit where created_at = now();
  if v_n <> 0 then raise exception 'CSUB SELF-TEST: الترحيلة كتبت في سجلّ التدقيق'; end if;

  -- (19) لا anon على شيء.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    select string_agg(p.proname, ', ') into v_bad
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'csub\_%'
       and has_function_privilege('anon', p.oid, 'EXECUTE');
    if v_bad is not null then raise exception 'CSUB SELF-TEST: anon يملك EXECUTE على (%)', v_bad; end if;
    select string_agg(table_name || ':' || privilege_type, ', ') into v_bad
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name like 'csub\_%' and grantee = 'anon';
    if v_bad is not null then raise exception 'CSUB SELF-TEST: anon يملك صلاحية جدول (%)', v_bad; end if;
  end if;
  -- والجداول: SELECT فقط لـauthenticated.
  select string_agg(table_name || ':' || privilege_type, ', ') into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'csub\_%'
     and grantee = 'authenticated' and privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: صلاحية كتابة مباشرة لـauthenticated (%) — الدفتر يجب أن يبقى للقراءة', v_bad;
  end if;

  -- (20) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'csub\_%'
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') not ilike '%search_path%');
  if v_bad is not null then
    raise exception 'CSUB SELF-TEST: دالّة بلا SECURITY DEFINER أو بلا search_path مثبَّت (%)', v_bad;
  end if;

  -- (21) الإشعار لا يُفقد بصمت: القيد شكل لا تعداد، والمصيدة تكتب أثرًا.
  select coalesce(string_agg(pg_get_constraintdef(con.oid), ' | '), '') into v_def
    from pg_constraint con
   where con.conrelid = to_regclass('public.notifications') and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%entity_type%'
     and pg_get_constraintdef(con.oid) not ilike '%~%'
     and pg_get_constraintdef(con.oid) not ilike '%csub_subscription%';
  if v_def <> '' then
    raise exception 'CSUB SELF-TEST: قيد entity_type ما زال تعدادًا لا يقبل csub_subscription (%)', v_def;
  end if;
  if pg_get_functiondef(to_regprocedure('public.csub_notify(uuid,text,uuid,text,text)')) not ilike '%notify_failed%' then
    raise exception 'CSUB SELF-TEST: فشل الإشعار يُبتلَع بلا أثر';
  end if;

  raise notice 'CSUB SELF-TEST: نجح — ١١ جدولًا، دفتر غير قابل للتعديل، رصيد مشتقّ، عزل عميل بنيويّ، قفل صفّ قبل كلّ حساب، تفعيل وتجديد بيد المالك وحده، auto_renew معلومة لا آلية، ضريبة مستقلّة وSAR، ولا anon ولا مساس بمنصّة المشاريع.';
end $st$;

-- ════════════════════════════════════════════════════════════════════════════
-- §17) المرحلة ٣ — صفحة «رصيدي الإنتاجي» وطلبات الإنتاج للعميل.
--
--      تُضاف إلى **هذه** الحزمة ولا تُنشأ حزمة ثانية: طلب الإنتاج يحجز من
--      الدفتر ويستهلك منه، فلو عاش في ترحيلة مستقلّة لأصبح ترتيب التشغيل هو
--      ما يقرّر صحّة الرصيد.
--
-- ─── ما تضيفه ──────────────────────────────────────────────────────────────
--   • csub_service_requests — طلب إنتاج بعشر حالات، يملأ المرجع الذي كان
--     الدفتر يحمله سلفًا (service_request_id / service_request_ref).
--   • csub_service_request_attachments — ★ بيانات وصفية فقط ★: اسم ونوع وحجم
--     وملاحظة. لا بايت ولا رابط ولا مسار تخزين، ومنعُ الرابط قيدٌ في القاعدة.
--   • سطح عميل واحد: csub_my_credits_page يجمع الاشتراك والأرصدة والكشف
--     والطلبات في نداء واحد، ويقول أيّ حقيقة يعيشها الحساب بدل عرض صفر.
--
-- ─── ما لا تضيفه — ثلاثة عقود ──────────────────────────────────────────────
--   ★ (١) لا محرّك رصيد ثانٍ. كلّ حركة تمرّ بـcsub_reserve / csub_release /
--     csub_consume القائمة، بمفتاح تكرار حتميّ مشتقّ من الطلب. لا يوجد في §17
--     سطر insert واحد في csub_ledger، والـSELF-TEST يفشل إن ظهر.
--   ★ (٢) لا اعتماد تجاوز جديد. التجاوز يمرّ بطلب اعتماد المالك القائم
--     (csub_approval_submit_core + csub_approval_decide)، وحالة
--     needs_overage_approval ليست إلّا انعكاسًا لصفّ الاعتماد المعلَّق.
--   ★ (٣) ★★ لا إنشاء مشروع ★★ لا التقديم ولا الاعتماد يُنشئ مشروعًا ولا يكتب
--     حرفًا في منصّة المشاريع. الاعتماد يُظهر «جاهز لإنشاء مشروع يدويًّا»
--     (حالة **مشتقّة**: approved ولا مشروع مرتبط)، ثمّ يُدخَل معرّف المشروع
--     يدويًّا عبر csub_request_link_project — تحقّقٌ من الوجود وحفظُ مرجع، لا أكثر.
--
-- ─── الأدوار (بالمفاتيح القائمة — بلا مفتاح جديد) ─────────────────────────
--   العميل            → طلباته هو واشتراكه هو، عبر دالّة لا عبر جدول.
--   csub.view         → قراءة الطلبات تشغيليًّا. الجدول **بلا مال أصلًا**،
--                       فالتشغيل يرى ما يُنفّذه ولا يرى مالًا لأنّه غير موجود.
--   csub.manage       → المراجعة والرفض والإلغاء وتصحيح الرصيد والربط اليدويّ.
--   csub.consume      → الحجز والتنفيذ (وهما ما يكتب في الدفتر فعلًا).
--   المالك وحده       → اعتماد التجاوز، عبر قرار الاعتماد القائم لا عبر §17.
--   التحصيل           → لا شيء هنا. لا حقل تحصيل في هذه الجداول أصلًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §17.1) الجداول ────────────────────────────────────────────────────────
create table if not exists public.csub_service_requests (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  client_id       uuid not null references public.clients(id) on delete restrict,
  subscription_id uuid not null references public.csub_subscriptions(id) on delete restrict,
  -- نوع الخدمة = نوع الوحدة في الكتالوج القائم. لا مفردات موازية.
  unit_type       text not null references public.csub_unit_types(key) on delete restrict,
  status          text not null default 'draft' check (status in
                    ('draft','submitted','under_review','credit_reserved','needs_overage_approval',
                     'approved','rejected','scheduled','fulfilled','cancelled')),
  units               numeric(14,3) not null default 1 check (units > 0),
  credits_required    numeric(14,3) not null default 0 check (credits_required >= 0),
  -- تقدير التجاوز **بالوحدات لا بالمال**، ويُحسب على الخادم لا في المتصفّح.
  overage_estimate_units numeric(14,3) not null default 0 check (overage_estimate_units >= 0),
  city            text,
  location_text   text,
  preferred_date  date,
  alternative_date date,
  description     text,
  contact_person_name  text,
  contact_person_phone text,
  is_urgent       boolean not null default false,
  client_notes    text,                    -- ★ يكتبها العميل ويراها
  client_decision_note text,               -- ★ ما يُقال للعميل عن القرار
  internal_notes  text,                    -- ⛔ لا يصل العميل أبدًا
  decision_reason text,                    -- ⛔ داخليّ
  scheduled_date  date,
  -- روابط الدفتر والاعتماد — تُملأ من مخرجات الدوالّ القائمة لا بكتابة مباشرة.
  reservation_entry_id uuid references public.csub_ledger(id) on delete restrict,
  consumption_entry_id uuid references public.csub_ledger(id) on delete restrict,
  approval_request_id  uuid references public.csub_approval_requests(id) on delete restrict,
  -- ⚠️ مرجع اختياريّ للقراءة فقط، يُدخَل يدويًّا بعد الاعتماد. بلا FK، وبلا أيّ
  --    كتابة في منصّة المشاريع المجمّدة.
  project_id      uuid,
  project_linked_at timestamptz,
  project_linked_by uuid references auth.users(id),
  submitted_at    timestamptz,
  decided_at      timestamptz,
  decided_by      uuid references auth.users(id),
  fulfilled_at    timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_deleted      boolean not null default false,
  deleted_reason  text,
  constraint csub_sr_dates check
    (alternative_date is null or preferred_date is null or alternative_date >= preferred_date)
);
create index if not exists csub_sr_client_idx on public.csub_service_requests (client_id, status);
create index if not exists csub_sr_sub_idx    on public.csub_service_requests (subscription_id, status);

-- ★ المرفق بيانات لا ملفّ ★ — القيد يمنع تسريب رابط في مكان الاسم.
create table if not exists public.csub_service_request_attachments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.csub_service_requests(id) on delete cascade,
  file_name   text not null check (length(btrim(file_name)) between 1 and 260),
  mime_type   text check (mime_type is null or length(btrim(mime_type)) between 3 and 160),
  size_bytes  bigint check (size_bytes is null or (size_bytes >= 0 and size_bytes <= 10737418240)),
  note        text,
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  constraint csub_sr_attachment_not_a_link check (file_name !~* '^(https?|s3|gs|file)://')
);
create index if not exists csub_sr_attach_idx on public.csub_service_request_attachments (request_id);

drop trigger if exists t_csub_sr_touch on public.csub_service_requests;
create trigger t_csub_sr_touch before update on public.csub_service_requests
  for each row execute function public.csub_touch();

-- ─── §17.2) RLS — قراءة فقط، ولا سياسة للعميل (كما في §5) ─────────────────
--     العميل يقرأ عبر csub_my_credits_page وحدها، فلا تصله internal_notes ولا
--     decision_reason عبر PostgREST مهما فعل. RLS تُصفّي صفوفًا لا أعمدة.
--     ولا بوّابة أسعار هنا: الجدولان لا يحملان مالًا إطلاقًا.
do $rls17$
begin
  alter table public.csub_service_requests enable row level security;
  alter table public.csub_service_request_attachments enable row level security;

  drop policy if exists csub_service_requests_read on public.csub_service_requests;
  create policy csub_service_requests_read on public.csub_service_requests
    for select to authenticated using (public.csub_can_view());

  drop policy if exists csub_service_request_attachments_read on public.csub_service_request_attachments;
  create policy csub_service_request_attachments_read on public.csub_service_request_attachments
    for select to authenticated using (public.csub_can_view());
end $rls17$;

-- ─── §17.3) نواة مشتركة: مفتاح تكرار حتميّ لكلّ فعل على كلّ طلب ───────────
--     حتميّ لا عشوائيّ: نقرتان على «حجز» تنتجان المفتاح نفسه، فتُعيد الدالّة
--     القائمة نتيجة المرّة الأولى بدل قيد ثانٍ. داخليّة ولا تُمنح لأحد.
create or replace function public.csub_sr_idem(p_request uuid, p_action text) returns text
language sql immutable security definer set search_path = public as $$
  select 'sr:' || coalesce(p_request::text, 'null') || ':' || coalesce(p_action, 'x');
$$;

-- ─── §17.4) سطح العميل ─────────────────────────────────────────────────────

-- ★★ «رصيدي الإنتاجي» — نداء واحد، وأربع حقائق لا تُطوى في صفر ★★
--   has_client_profile = false → لا ملفّ عميل مرتبط بالحساب.
--   has_subscription   = false → لا اشتراك.
--   has_units          = false → اشتراك بلا وحدات مُسنَدة بعد.
--   balances[i].has_entries = false → وحدة بلا أيّ حركة في الدفتر.
--   في كلّ حالة من هذه، لا يوجد رقم يُعرض — والواجهة تعرض النصّ لا الصفر.
create or replace function public.csub_my_credits_page(p_subscription uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_client uuid; v_sub public.csub_subscriptions%rowtype; v_plan_name text; v_bal jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_is_client(), false) then
    raise exception 'not authorized: «رصيدي الإنتاجي» شاشة العميل. حساب الموظّف يتابع الاشتراكات من السطح الداخليّ.';
  end if;

  v_client := public.my_client_id();
  if v_client is null then
    return jsonb_build_object('ok', true, 'is_client', true, 'has_client_profile', false,
      'has_subscription', false, 'reason', 'no_client_profile',
      'balances', null, 'statement', '[]'::jsonb, 'requests', '[]'::jsonb);
  end if;

  if p_subscription is not null then
    select * into v_sub from public.csub_subscriptions
     where id = p_subscription and client_id = v_client and is_deleted = false;
  else
    select * into v_sub from public.csub_subscriptions
     where client_id = v_client and is_deleted = false
       and status in ('active','suspended','expired','completed')
     order by case status when 'active' then 0 when 'suspended' then 1 else 2 end,
              end_date desc nulls last limit 1;
  end if;

  if v_sub.id is null then
    return jsonb_build_object('ok', true, 'is_client', true, 'has_client_profile', true,
      'has_subscription', false, 'reason', 'no_active_subscription',
      'balances', null, 'statement', '[]'::jsonb,
      'requests', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'code', r.code, 'unit_type', r.unit_type, 'units', r.units,
          'status', r.status, 'city', r.city, 'preferred_date', r.preferred_date,
          'created_at', r.created_at) order by r.created_at desc)
        from public.csub_service_requests r
       where r.client_id = v_client and r.is_deleted = false), '[]'::jsonb));
  end if;

  select name_ar into v_plan_name from public.csub_plans where id = v_sub.plan_id;

  -- الأرصدة لكلّ وحدة، ومعها entries كي يُميَّز «لا حركة» عن «صفر متاح».
  select coalesce(jsonb_agg(jsonb_build_object(
           'unit_type', b.unit_type, 'label_ar', ut.label_ar, 'label_en', ut.label_en,
           'uom_ar', ut.uom_ar,
           'allocated', b.allocated, 'reserved', b.reserved, 'used', b.used,
           'expired', b.expired, 'available', b.available, 'overage_units', b.overage_units,
           'entries', b.entries, 'has_entries', (b.entries > 0),
           'entitlement_per_period', su.quantity_per_period,
           'is_overage', (b.available < 0)) order by ut.sort_order), '[]'::jsonb)
    into v_bal
    from public.csub_balance_core(v_sub.id, null) b
    join public.csub_unit_types ut on ut.key = b.unit_type
    left join public.csub_subscription_units su
      on su.subscription_id = v_sub.id and su.unit_type = b.unit_type;

  return jsonb_build_object(
    'ok', true, 'is_client', true, 'has_client_profile', true, 'has_subscription', true,
    'reason', null,
    'has_units', (jsonb_array_length(coalesce(v_bal, '[]'::jsonb)) > 0),
    -- ★ لا كائن أرصدة مُختلَق ★: بلا وحدات مُسنَدة لا يوجد ما يُعرض أصلًا.
    'balances', case when jsonb_array_length(coalesce(v_bal, '[]'::jsonb)) > 0 then v_bal else null end,
    'balances_reason', case when jsonb_array_length(coalesce(v_bal, '[]'::jsonb)) > 0
                            then null else 'no_units_on_subscription' end,
    'subscription', jsonb_build_object(
      'id', v_sub.id, 'code', v_sub.code, 'plan_name', v_plan_name, 'status', v_sub.status,
      'start_date', v_sub.start_date, 'end_date', v_sub.end_date, 'renewal_date', v_sub.renewal_date,
      'grace_period_days', v_sub.grace_period_days,
      'auto_renew', v_sub.auto_renew,
      'auto_renew_note', 'معلومة تعاقدية — لا تجديد ولا خصم آليّ.',
      'days_remaining', case when v_sub.end_date is null then null
                             else (v_sub.end_date - current_date) end,
      'is_expired', (v_sub.end_date is not null and v_sub.end_date < current_date),
      'description', v_sub.client_description, 'terms', v_sub.terms, 'limitations', v_sub.limitations,
      'contract_reference', v_sub.contract_reference,
      'allow_overage', v_sub.allow_overage,
      'overage_requires_approval', v_sub.overage_requires_approval),
    'statement', coalesce((public.csub_my_statement(v_sub.id, '{}'::jsonb)) -> 'rows', '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'unit_type', r.unit_type,
        'unit_label_ar', (select label_ar from public.csub_unit_types where key = r.unit_type),
        'units', r.units, 'credits_required', r.credits_required,
        'overage_estimate_units', r.overage_estimate_units,
        'status', r.status, 'city', r.city, 'location_text', r.location_text,
        'preferred_date', r.preferred_date, 'alternative_date', r.alternative_date,
        'scheduled_date', r.scheduled_date, 'description', r.description,
        'contact_person_name', r.contact_person_name, 'contact_person_phone', r.contact_person_phone,
        'is_urgent', r.is_urgent, 'client_notes', r.client_notes,
        'client_decision_note', r.client_decision_note,
        'submitted_at', r.submitted_at, 'created_at', r.created_at,
        'attachments', coalesce((select jsonb_agg(jsonb_build_object(
             'id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type,
             'size_bytes', a.size_bytes, 'note', a.note) order by a.created_at)
           from public.csub_service_request_attachments a
          where a.request_id = r.id and a.is_deleted = false), '[]'::jsonb))
        order by r.created_at desc)
      from public.csub_service_requests r
     where r.client_id = v_client and r.is_deleted = false), '[]'::jsonb));
end $$;

-- طلب إنتاج: إنشاء مسوّدة أو تعديلها ثمّ تقديمها. تقدير التجاوز يُحسب هنا،
-- على الخادم، من الرصيد المتاح — ولا يُقبل من المتصفّح إطلاقًا.
create or replace function public.csub_request_submit(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_client uuid; v_sub public.csub_subscriptions%rowtype; v_id uuid; v_status text;
  v_unit text; v_units numeric; v_credits numeric; v_avail numeric; v_over numeric;
  v_submit boolean := coalesce((p->>'submit')::boolean, false);
  v_pref date; v_alt date; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_is_client(), false) then
    raise exception 'not authorized: تقديم الطلب من حساب العميل نفسه.';
  end if;
  v_client := public.my_client_id();
  if v_client is null then return jsonb_build_object('ok', false, 'reason', 'no_client_profile'); end if;

  v_id     := public.csub_uuid(p, 'id');
  v_unit   := public.csub_txt(p, 'unit_type');
  v_units  := public.csub_num(p, 'units');
  v_credits := coalesce(public.csub_num(p, 'credits_required'), v_units);
  v_pref   := public.csub_txt(p, 'preferred_date')::date;
  v_alt    := public.csub_txt(p, 'alternative_date')::date;

  select * into v_sub from public.csub_subscriptions
   where id = public.csub_uuid(p, 'subscription_id') and client_id = v_client and is_deleted = false;
  if v_sub.id is null then
    select * into v_sub from public.csub_subscriptions
     where client_id = v_client and is_deleted = false and status = 'active'
     order by end_date desc nulls last limit 1;
  end if;
  if v_sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no_active_subscription'); end if;
  if v_sub.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'subscription_not_active', 'status', v_sub.status);
  end if;

  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'unit_type_required'); end if;
  if not exists (select 1 from public.csub_subscription_units
                  where subscription_id = v_sub.id and unit_type = v_unit) then
    return jsonb_build_object('ok', false, 'reason', 'unit_not_in_subscription', 'unit_type', v_unit);
  end if;
  if v_units is null or v_units <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_units'); end if;
  if v_credits < 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_credits'); end if;
  if v_pref is not null and v_pref < current_date then
    return jsonb_build_object('ok', false, 'reason', 'preferred_date_in_past');
  end if;
  if v_alt is not null and v_pref is not null and v_alt < v_pref then
    return jsonb_build_object('ok', false, 'reason', 'alternative_before_preferred');
  end if;

  if v_id is not null then
    select status into v_status from public.csub_service_requests
     where id = v_id and client_id = v_client and is_deleted = false;
    if v_status is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
    if v_status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'not_editable'); end if;
  end if;

  if v_submit then
    if public.csub_txt(p, 'contact_person_name') is null then
      return jsonb_build_object('ok', false, 'reason', 'contact_person_required'); end if;
    if public.csub_txt(p, 'city') is null then
      return jsonb_build_object('ok', false, 'reason', 'city_required'); end if;
    if v_pref is null then return jsonb_build_object('ok', false, 'reason', 'preferred_date_required'); end if;
  end if;

  -- ★ التقدير على الخادم ★ — من الرصيد المتاح لهذه الوحدة، لا من قيمة مُرسَلة.
  v_avail := public.csub_available_core(v_sub.id, v_unit);
  v_over  := greatest(0, v_credits - v_avail);

  if v_id is null then
    v_code := public.csub_next_code('SR');
    insert into public.csub_service_requests (code, client_id, subscription_id, unit_type, status,
      units, credits_required, overage_estimate_units, city, location_text, preferred_date,
      alternative_date, description, contact_person_name, contact_person_phone, is_urgent,
      client_notes, submitted_at, created_by)
    values (v_code, v_client, v_sub.id, v_unit,
      case when v_submit then 'submitted' else 'draft' end,
      v_units, v_credits, v_over,
      public.csub_txt(p, 'city'), public.csub_txt(p, 'location_text'), v_pref, v_alt,
      public.csub_txt(p, 'description'), public.csub_txt(p, 'contact_person_name'),
      public.csub_txt(p, 'contact_person_phone'), coalesce((p->>'is_urgent')::boolean, false),
      public.csub_txt(p, 'client_notes'),
      case when v_submit then now() else null end, auth.uid())
    returning id into v_id;
  else
    update public.csub_service_requests set
      unit_type = v_unit, units = v_units, credits_required = v_credits,
      overage_estimate_units = v_over,
      city = public.csub_txt(p, 'city'), location_text = public.csub_txt(p, 'location_text'),
      preferred_date = v_pref, alternative_date = v_alt,
      description = public.csub_txt(p, 'description'),
      contact_person_name = public.csub_txt(p, 'contact_person_name'),
      contact_person_phone = public.csub_txt(p, 'contact_person_phone'),
      is_urgent = coalesce((p->>'is_urgent')::boolean, false),
      client_notes = public.csub_txt(p, 'client_notes'),
      status = case when v_submit then 'submitted' else 'draft' end,
      submitted_at = case when v_submit then now() else submitted_at end
     where id = v_id and client_id = v_client;
  end if;

  perform public.csub_log(case when v_submit then 'service_request_submit' else 'service_request_draft' end,
    'csub_service_request', v_id,
    jsonb_build_object('unit_type', v_unit, 'units', v_units, 'credits_required', v_credits,
                       'overage_estimate_units', v_over));

  -- ★ يُقال صراحةً: لم يُنشأ مشروع، ولن يُنشأ بالاعتماد أيضًا. ★
  return jsonb_build_object('ok', true, 'id', v_id,
    'status', case when v_submit then 'submitted' else 'draft' end,
    'overage_estimate_units', v_over, 'available_now', v_avail,
    'project_created', false);
end $$;

-- إلغاء العميل لطلبه. الحجز — إن وُجد — يُفكّ عبر csub_release القائمة.
create or replace function public.csub_request_cancel(p_request uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_client uuid; r public.csub_service_requests%rowtype; v_rel jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_is_client(), false) then raise exception 'not authorized'; end if;
  v_client := public.my_client_id();
  if v_client is null then return jsonb_build_object('ok', false, 'reason', 'no_client_profile'); end if;

  select * into r from public.csub_service_requests
   where id = p_request and client_id = v_client and is_deleted = false;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
  if r.status in ('fulfilled','rejected','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'terminal_state');
  end if;

  if r.reservation_entry_id is not null then
    v_rel := public.csub_release(jsonb_build_object(
      'reservation_entry_id', r.reservation_entry_id,
      'idempotency_key', public.csub_sr_idem(r.id, 'release'),
      'reason', 'client_cancelled_request',
      'client_description', 'أُفرج عن الحجز بعد إلغائك الطلب ' || coalesce(r.code, '')));
    if coalesce((v_rel->>'ok')::boolean, false) is not true
       and coalesce(v_rel->>'reason', '') <> 'reservation_exhausted' then
      return jsonb_build_object('ok', false, 'reason', 'release_failed', 'detail', v_rel);
    end if;
  end if;

  update public.csub_service_requests
     set status = 'cancelled', decided_at = now(), decided_by = auth.uid(),
         decision_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'client_cancelled'),
         client_decision_note = 'أُلغي الطلب بطلب منك.'
   where id = r.id;
  perform public.csub_log('service_request_cancel_client', 'csub_service_request', r.id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

-- بيانات مرفق — ★ بيانات فقط ★. العميل لطلبه، والموظّف المدير لأيّ طلب.
create or replace function public.csub_request_attachment_add(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
  r public.csub_service_requests%rowtype; v_client uuid; v_id uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_name := public.csub_txt(p, 'file_name');
  if v_name is null then return jsonb_build_object('ok', false, 'reason', 'file_name_required'); end if;
  if v_name ~* '^(https?|s3|gs|file)://' then
    return jsonb_build_object('ok', false, 'reason', 'link_not_allowed',
      'message', 'يُسجَّل اسم الملفّ لا رابطه. الملفّ نفسه يُسلَّم بالقناة المتّفق عليها.');
  end if;

  select * into r from public.csub_service_requests
   where id = public.csub_uuid(p, 'request_id') and is_deleted = false;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;

  if coalesce(public.csub_is_client(), false) then
    v_client := public.my_client_id();
    -- ★ لا مِجَسّ وجود عبر الأخطاء ★ طلب عميل آخر يُجاب بنفس جواب الطلب غير
    --   الموجود حرفًا بحرف. لو تمايز الجوابان («غير مصرّح» مقابل «غير موجود»)
    --   لصار الفرق بينهما مؤشّرًا يعدّ به عميلٌ طلبات غيره بتخمين المعرّفات.
    if v_client is null or r.client_id <> v_client then
      return jsonb_build_object('ok', false, 'reason', 'request_not_found');
    end if;
    if r.status not in ('draft','submitted','under_review','needs_overage_approval') then
      return jsonb_build_object('ok', false, 'reason', 'not_editable');
    end if;
  elsif not coalesce(public.csub_can_manage(), false) then
    raise exception 'not authorized';
  end if;

  insert into public.csub_service_request_attachments (request_id, file_name, mime_type, size_bytes, note, uploaded_by)
  values (r.id, v_name, public.csub_txt(p, 'mime_type'),
          public.csub_num(p, 'size_bytes')::bigint, public.csub_txt(p, 'note'), auth.uid())
  returning id into v_id;
  perform public.csub_log('service_request_attachment_meta', 'csub_service_request', r.id,
    jsonb_build_object('attachment_id', v_id, 'metadata_only', true));
  return jsonb_build_object('ok', true, 'id', v_id, 'metadata_only', true);
end $$;

-- ─── §17.5) سطح الموظّف — آلة الحالات فوق دوالّ الدفتر القائمة ────────────

-- ★★ لا مَعلَم رقميّ في التوقيع ★★ مبلغ الحجز يُقرأ من الطلب، ومبلغ الاستهلاك
--    من الحجز القائم. لا يستطيع موظّف أن يحقن رقمًا في رصيد عميل من هنا.
create or replace function public.csub_request_transition(
  p_request uuid, p_action text, p_reason text default null,
  p_client_note text default null, p_scheduled date default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r public.csub_service_requests%rowtype; a text := lower(btrim(coalesce(p_action, '')));
  v_new text; v_res jsonb; v_ap public.csub_approval_requests%rowtype;
  v_avail numeric; v_over numeric; v_appr uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not (coalesce(public.csub_can_manage(), false) or coalesce(public.csub_can_consume(), false)) then
    raise exception 'not authorized';
  end if;
  select * into r from public.csub_service_requests where id = p_request and is_deleted = false;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;

  if a = 'review' then
    if r.status <> 'submitted' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
    v_new := 'under_review';

  elsif a = 'reserve' then
    if r.status <> 'under_review' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if r.credits_required <= 0 then return jsonb_build_object('ok', false, 'reason', 'credits_required_missing'); end if;
    -- الحجز عبر الدالّة القائمة: هي التي تقفل وتحسب وتكتب القيد. §17 لا تكتب.
    v_res := public.csub_reserve(jsonb_build_object(
      'subscription_id', r.subscription_id, 'unit_type', r.unit_type,
      'quantity', r.credits_required, 'idempotency_key', public.csub_sr_idem(r.id, 'reserve'),
      'service_request_id', r.id, 'service_request_ref', r.code, 'source', 'service_request',
      'reason', coalesce(p_reason, 'reserve_for_service_request'),
      'client_description', 'حُجز رصيد لطلبك ' || coalesce(r.code, '')));
    if coalesce((v_res->>'ok')::boolean, false) is not true then
      -- لا حالة تتغيّر ولا قيد يُكتب. والسبب يُنقل كما هو مع الخطوة التالية.
      return jsonb_build_object('ok', false, 'reason', coalesce(v_res->>'reason', 'reserve_failed'),
        'detail', v_res,
        'next_action', case when coalesce(v_res->>'reason','') = 'insufficient_balance'
                            then 'need_overage' else null end);
    end if;
    update public.csub_service_requests
       set reservation_entry_id = public.csub_uuid(v_res, 'entry_id') where id = r.id;
    v_new := 'credit_reserved';

  elsif a = 'need_overage' then
    if r.status not in ('under_review','credit_reserved') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
    v_avail := public.csub_available_core(r.subscription_id, r.unit_type);
    v_over  := greatest(0, r.credits_required - v_avail);
    if v_over <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'no_overage', 'available', v_avail,
        'message', 'الرصيد المتاح يكفي — لا حاجة لاعتماد تجاوز.');
    end if;
    -- ★ اعتماد المالك عبر آليّته القائمة، لا عبر بوّابة جديدة في §17. ★
    v_appr := public.csub_approval_submit_core('overage', r.subscription_id, r.unit_type, v_over,
      jsonb_build_object('service_request_id', r.id, 'service_request_ref', r.code,
                         'quantity_requested', r.credits_required, 'available', v_avail),
      coalesce(p_reason, 'تجاوز رصيد لطلب خدمة'));
    update public.csub_service_requests
       set approval_request_id = v_appr, overage_estimate_units = v_over where id = r.id;
    v_new := 'needs_overage_approval';

  elsif a = 'approve' then
    if r.status = 'credit_reserved' then
      if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
    elsif r.status = 'needs_overage_approval' then
      -- ★★ لا اعتماد تجاوز من غير المالك ★★ الحُكم صفُّ الاعتماد نفسه: من قرّره
      --    هو من يملك csub_can_approve، ولا يستطيع مدير الموديول تجاوزه هنا.
      if r.approval_request_id is null then
        return jsonb_build_object('ok', false, 'reason', 'overage_approval_missing'); end if;
      select * into v_ap from public.csub_approval_requests where id = r.approval_request_id;
      if v_ap.id is null or v_ap.status <> 'approved' then
        return jsonb_build_object('ok', false, 'reason', 'overage_not_approved',
          'approval_status', coalesce(v_ap.status, 'missing'),
          'message', 'اعتماد تجاوز الرصيد قرار المالك. الطلب لا يتقدّم قبل صدوره.');
      end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    end if;
    v_new := 'approved';

  elsif a = 'reject' then
    if r.status not in ('submitted','under_review','credit_reserved','needs_overage_approval') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    if r.reservation_entry_id is not null then
      v_res := public.csub_release(jsonb_build_object(
        'reservation_entry_id', r.reservation_entry_id,
        'idempotency_key', public.csub_sr_idem(r.id, 'release'),
        'reason', 'request_rejected',
        'client_description', 'أُفرج عن الحجز بعد رفض الطلب ' || coalesce(r.code, '')));
      if coalesce((v_res->>'ok')::boolean, false) is not true
         and coalesce(v_res->>'reason', '') <> 'reservation_exhausted' then
        return jsonb_build_object('ok', false, 'reason', 'release_failed', 'detail', v_res);
      end if;
    end if;
    v_new := 'rejected';

  elsif a = 'cancel' then
    if r.status in ('fulfilled','rejected','cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'terminal_state'); end if;
    if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
    if r.reservation_entry_id is not null then
      v_res := public.csub_release(jsonb_build_object(
        'reservation_entry_id', r.reservation_entry_id,
        'idempotency_key', public.csub_sr_idem(r.id, 'release'),
        'reason', coalesce(p_reason, 'request_cancelled'),
        'client_description', 'أُفرج عن الحجز بعد إلغاء الطلب ' || coalesce(r.code, '')));
      if coalesce((v_res->>'ok')::boolean, false) is not true
         and coalesce(v_res->>'reason', '') <> 'reservation_exhausted' then
        return jsonb_build_object('ok', false, 'reason', 'release_failed', 'detail', v_res);
      end if;
    end if;
    v_new := 'cancelled';

  elsif a = 'schedule' then
    if r.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    if p_scheduled is null then return jsonb_build_object('ok', false, 'reason', 'scheduled_date_required'); end if;
    update public.csub_service_requests set scheduled_date = p_scheduled where id = r.id;
    v_new := 'scheduled';

  elsif a = 'fulfil' then
    if r.status <> 'scheduled' then return jsonb_build_object('ok', false, 'reason', 'invalid_transition'); end if;
    v_res := public.csub_consume(jsonb_build_object(
      'subscription_id', r.subscription_id, 'unit_type', r.unit_type,
      'quantity', r.credits_required, 'idempotency_key', public.csub_sr_idem(r.id, 'consume'),
      'reservation_entry_id', r.reservation_entry_id,
      'approval_request_id', r.approval_request_id,
      'service_request_id', r.id, 'service_request_ref', r.code, 'source', 'service_request',
      'usage_date', coalesce(r.scheduled_date, current_date)::text,
      'reason', coalesce(p_reason, 'service_request_fulfilled'),
      'client_description', 'استُهلك رصيد الطلب ' || coalesce(r.code, '') || ' بعد تنفيذه'));
    if coalesce((v_res->>'ok')::boolean, false) is not true then
      -- ★ الاستهلاك الذي يحتاج اعتمادًا يُعيد الطلب إلى حالته الصادقة ★
      if coalesce(v_res->>'reason', '') = 'pending_approval' then
        update public.csub_service_requests
           set approval_request_id = public.csub_uuid(v_res, 'approval_request_id'),
               overage_estimate_units = coalesce(public.csub_num(v_res, 'shortfall'), overage_estimate_units),
               status = 'needs_overage_approval'
         where id = r.id;
        perform public.csub_log('service_request_overage_pending', 'csub_service_request', r.id, v_res);
        return jsonb_build_object('ok', false, 'reason', 'pending_approval', 'status', 'needs_overage_approval',
          'detail', v_res, 'project_created', false);
      end if;
      return jsonb_build_object('ok', false, 'reason', coalesce(v_res->>'reason', 'consume_failed'), 'detail', v_res);
    end if;
    update public.csub_service_requests
       set consumption_entry_id = public.csub_uuid(v_res, 'entry_id'), fulfilled_at = now()
     where id = r.id;
    v_new := 'fulfilled';

  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  update public.csub_service_requests
     set status = v_new, decided_at = now(), decided_by = auth.uid(),
         decision_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), decision_reason),
         client_decision_note = coalesce(nullif(btrim(coalesce(p_client_note, '')), ''), client_decision_note)
   where id = r.id;

  perform public.csub_log('service_request_' || a, 'csub_service_request', r.id,
    jsonb_build_object('from', r.status, 'to', v_new));

  -- ★★ لا مشروع ★★ الاعتماد يُظهر الجاهزية ولا يُنشئ شيئًا.
  return jsonb_build_object('ok', true, 'status', v_new, 'project_created', false,
    'ready_for_manual_project_creation', (v_new = 'approved' and r.project_id is null),
    'manual_step', case when v_new = 'approved'
      then 'اعتُمد الطلب. إنشاء المشروع خطوة يدويّة منفصلة على المنصّة، ثمّ يُدخَل معرّفه هنا.'
      else null end);
end $$;

-- تصحيح الرصيد المطلوب قبل الحجز — يمسّ تقدير الطلب لا رصيد العميل.
create or replace function public.csub_request_set_credits(p_request uuid, p_credits numeric, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.csub_service_requests%rowtype; v_avail numeric;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_manage(), false) then raise exception 'not authorized'; end if;
  if p_credits is null or p_credits < 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_credits'); end if;
  select * into r from public.csub_service_requests where id = p_request and is_deleted = false;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
  if r.status not in ('submitted','under_review','needs_overage_approval') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
  end if;
  v_avail := public.csub_available_core(r.subscription_id, r.unit_type);
  update public.csub_service_requests
     set credits_required = p_credits, overage_estimate_units = greatest(0, p_credits - v_avail)
   where id = r.id;
  perform public.csub_log('service_request_set_credits', 'csub_service_request', r.id,
    jsonb_build_object('from', r.credits_required, 'to', p_credits, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'credits_required', p_credits,
    'overage_estimate_units', greatest(0, p_credits - v_avail));
end $$;

-- ★ الربط اليدويّ بمشروع ★ تحقّق من الوجود، ثمّ حفظ مرجع. لا إنشاء ولا كتابة.
create or replace function public.csub_request_link_project(p_request uuid, p_project uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.csub_service_requests%rowtype; v_exists boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not (coalesce(public.csub_can_manage(), false) or coalesce(public.csub_can_consume(), false)) then
    raise exception 'not authorized';
  end if;
  select * into r from public.csub_service_requests where id = p_request and is_deleted = false;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'request_not_found'); end if;
  if r.status not in ('approved','scheduled','fulfilled') then
    return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  if p_project is null then return jsonb_build_object('ok', false, 'reason', 'project_required'); end if;
  if to_regclass('public.projects') is null then
    return jsonb_build_object('ok', false, 'reason', 'projects_table_missing'); end if;

  execute 'select exists (select 1 from public.projects where id = $1)' into v_exists using p_project;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'reason', 'project_not_found',
      'message', 'أنشئ المشروع يدويًّا على المنصّة أوّلًا، ثمّ أعد إدخال معرّفه هنا.');
  end if;

  update public.csub_service_requests
     set project_id = p_project, project_linked_at = now(), project_linked_by = auth.uid()
   where id = r.id;
  perform public.csub_log('service_request_link_project_manual', 'csub_service_request', r.id,
    jsonb_build_object('project_id', p_project, 'created_by_this_module', false, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'linked', true, 'project_created', false,
    'message', 'ربط مرجعيّ فقط. لم يُنشأ مشروع ولم تُمَسّ منصّة المشاريع.');
end $$;

-- قائمة الطلبات للموظّف. الجدول بلا مال، فلا شيء يُقنَّع — لكنّ الملاحظات
-- الداخلية وسبب القرار الداخليّ لا يخرجان إلّا لمن يدير الموديول.
create or replace function public.csub_service_requests_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_manage boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.csub_can_view(), false) then raise exception 'not authorized'; end if;
  v_manage := coalesce(public.csub_can_manage(), false);
  return jsonb_build_object('ok', true, 'manage_view', v_manage, 'finance_visible', false,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'status', r.status, 'client_id', r.client_id,
        'subscription_id', r.subscription_id, 'unit_type', r.unit_type, 'units', r.units,
        'credits_required', r.credits_required, 'overage_estimate_units', r.overage_estimate_units,
        'city', r.city, 'location_text', r.location_text, 'preferred_date', r.preferred_date,
        'alternative_date', r.alternative_date, 'scheduled_date', r.scheduled_date,
        'description', r.description, 'contact_person_name', r.contact_person_name,
        'contact_person_phone', r.contact_person_phone, 'is_urgent', r.is_urgent,
        'client_notes', r.client_notes,
        'internal_notes', case when v_manage then r.internal_notes else null end,
        'decision_reason', case when v_manage then r.decision_reason else null end,
        'reservation_entry_id', r.reservation_entry_id,
        'approval_request_id', r.approval_request_id,
        'project_id', r.project_id,
        'ready_for_manual_project_creation', (r.status = 'approved' and r.project_id is null),
        'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
      from public.csub_service_requests r
     where r.is_deleted = false
       and (public.csub_txt(f, 'status') is null or r.status = public.csub_txt(f, 'status'))
       and (public.csub_uuid(f, 'subscription_id') is null
            or r.subscription_id = public.csub_uuid(f, 'subscription_id'))));
end $$;

-- ─── §17.6) الصلاحيات ──────────────────────────────────────────────────────
do $g17$
declare f text; t text;
begin
  foreach f in array array[
    'public.csub_my_credits_page(uuid)',
    'public.csub_request_submit(jsonb)',
    'public.csub_request_cancel(uuid,text)',
    'public.csub_request_attachment_add(jsonb)',
    'public.csub_request_transition(uuid,text,text,text,date)',
    'public.csub_request_set_credits(uuid,numeric,text)',
    'public.csub_request_link_project(uuid,uuid,text)',
    'public.csub_service_requests_list(jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- داخليّة: لا تُمنح لأحد.
  execute 'revoke all on function public.csub_sr_idem(uuid,text) from public';
  begin execute 'revoke all on function public.csub_sr_idem(uuid,text) from anon'; exception when undefined_object then null; end;
  begin execute 'revoke all on function public.csub_sr_idem(uuid,text) from authenticated'; exception when undefined_object then null; end;

  foreach t in array array['csub_service_requests','csub_service_request_attachments'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $g17$;

-- ─── §17.7) SELF-TEST للمرحلة ٣ — ثابت، بلا استدعاء حيّ لدالّة محميّة ─────
do $st17$
declare
  v_def text; t text; v_n bigint; v_bad text;
  STATES text[] := array['draft','submitted','under_review','credit_reserved','needs_overage_approval',
                         'approved','rejected','scheduled','fulfilled','cancelled'];
  FNS text[] := array['public.csub_my_credits_page(uuid)','public.csub_request_submit(jsonb)',
    'public.csub_request_cancel(uuid,text)','public.csub_request_attachment_add(jsonb)',
    'public.csub_request_transition(uuid,text,text,text,date)',
    'public.csub_request_set_credits(uuid,numeric,text)',
    'public.csub_request_link_project(uuid,uuid,text)','public.csub_service_requests_list(jsonb)'];

  -- ★★★ قائمة السماح التشغيلية ★★★ — انظر الفحص (11). كلّ عمود يحمله جدول
  --   الطلبات مذكور هنا بالاسم الكامل، ولا شيء غيره. إضافة عمود جديد تُسقط
  --   الترحيلة حتّى يُذكر هنا صراحةً — وذكره قرارٌ يُتَّخذ لا سهوٌ يمرّ.
  SR_COLS constant text[] := array[
    'id','code','client_id','subscription_id','unit_type','status',
    'units','credits_required','overage_estimate_units',
    'city','location_text','preferred_date','alternative_date','scheduled_date',
    'description','contact_person_name','contact_person_phone','is_urgent',
    'client_notes','client_decision_note','internal_notes','decision_reason',
    -- مفاتيح أجنبية تشغيلية: ربطٌ بقيد الدفتر وبصفّ الاعتماد، بلا مبلغ.
    -- ⚠️ 'reservation_entry_id' هو بالضبط ما أسقط قائمة المنع القديمة: تطابق
    --    '%vat%' في «reser·VAT·ion». إنذار كاذب، والعمود uuid لا مال فيه.
    'reservation_entry_id','consumption_entry_id','approval_request_id',
    'project_id','project_linked_at','project_linked_by',
    'submitted_at','decided_at','decided_by','fulfilled_at',
    'created_by','created_at','updated_at','is_deleted','deleted_reason'];

  SRA_COLS constant text[] := array[
    'id','request_id','file_name','mime_type','size_bytes','note',
    'uploaded_by','created_at','is_deleted'];

  -- ★ العدّادات الرقمية المسموحة ★ — كلّ عمود رقميّ على السطح التشغيليّ يجب
  --   أن يكون هنا. مطابقة **بالنوع**: مفتاح uuid لا يمكن أن يقع في هذا الفحص
  --   مهما كان اسمه، وهو بالضبط ما عجزت عنه قائمة المنع القديمة. عمود رقميّ
  --   جديد يمرّ من هنا فقط، بعد أن يُسأل: أهذا عدد وحدات أم مبلغ؟
  UNIT_COLS constant text[] := array[
    'units','credits_required','overage_estimate_units'];

  -- الأعمدة التي يجوز لسطح التشغيل أن **يقرأها** من صفّ الطلب. أضيق من
  --   SR_COLS عمدًا: بوّابة ثانية مستقلّة، فلا يكفي أن يُضاف عمود إلى الجدول
  --   ليظهر في قائمة التشغيل.
  OPS_COLS constant text[] := array[
    'id','code','status','client_id','subscription_id','unit_type',
    'units','credits_required','overage_estimate_units',
    'city','location_text','preferred_date','alternative_date','scheduled_date',
    'description','contact_person_name','contact_person_phone','is_urgent',
    'client_notes','internal_notes','decision_reason',
    'reservation_entry_id','consumption_entry_id','approval_request_id',
    'project_id','submitted_at','decided_at','fulfilled_at','created_at','is_deleted'];

  -- مفردات المال في هذه الحزمة، بالاسم الكامل لا بالسلسلة الجزئية. لا يجوز
  --   لعمود في جدولَي المرحلة ٣ أن يحمل أحد هذه الأسماء ولو أُضيف إلى قائمة
  --   السماح: هذه شبكة ثانية تحرس القائمة نفسها من تعديل ساهٍ.
  MONEY_COLS constant text[] := array[
    'price_net','price_gross','price_is_custom','vat_rate','vat_amount','currency',
    'overage_unit_price_net','overage_vat_rate','overage_amount_net',
    'overage_vat_amount','overage_amount_gross',
    'unit_price','unit_rate','rate','amount','amount_net','amount_gross',
    'total','total_net','total_gross','subtotal','discount','discount_amount',
    'contract_value','renewal_value','minimum_price','floor_price','list_price',
    'selling_price','sale_price','cost','unit_cost','internal_cost',
    'margin','margin_pct','profit','profitability','invoice_amount',
    'receivable','receivable_amount','balance_due','overage_value','billing_amount'];
begin
  -- (1) الجدولان وRLS وسياسة قراءة لكلّ منهما، ولا سياسة كتابة.
  foreach t in array array['csub_service_requests','csub_service_request_attachments'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'CSUB §17 SELF-TEST: الجدول % غير موجود', t; end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'CSUB §17 SELF-TEST: RLS غير مفعّلة على %', t; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'CSUB §17 SELF-TEST: % بلا سياسة قراءة — محجوب صامتًا', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT') then
      raise exception 'CSUB §17 SELF-TEST: سياسة كتابة على % — كلّ كتابة عبر RPC', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and coalesce(qual, '') ilike '%my_client_id%') then
      raise exception 'CSUB §17 SELF-TEST: سياسة تمنح العميل وصولًا جدوليًّا إلى % — سيقرأ internal_notes مباشرةً', t;
    end if;
  end loop;

  -- (2) الدوالّ موجودة، SECURITY DEFINER، بمسار مثبَّت، وanon بلا EXECUTE.
  foreach t in array FNS loop
    if to_regprocedure(t) is null then
      raise exception 'CSUB §17 SELF-TEST: الدالّة % غير موجودة', t; end if;
    v_def := pg_get_functiondef(to_regprocedure(t));
    if v_def not ilike '%security definer%' or v_def not ilike '%search_path%' then
      raise exception 'CSUB §17 SELF-TEST: % ليست SECURITY DEFINER بمسار مثبَّت', t; end if;
    if exists (select 1 from pg_roles where rolname = 'anon')
       and has_function_privilege('anon', to_regprocedure(t), 'execute') then
      raise exception 'CSUB §17 SELF-TEST: anon يملك EXECUTE على %', t; end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and grantee = 'anon'
                and table_name in ('csub_service_requests','csub_service_request_attachments')) then
    raise exception 'CSUB §17 SELF-TEST: anon يملك صلاحية على جداول المرحلة ٣';
  end if;

  -- (3) ★ لا محرّك رصيد ثانٍ ★ — §17 لا تكتب في الدفتر ولا في جدول الاعتماد.
  foreach t in array FNS loop
    v_def := pg_get_functiondef(to_regprocedure(t));
    if v_def ~* '(insert\s+into|update|delete\s+from)\s+public\.csub_ledger\M' then
      raise exception 'CSUB §17 SELF-TEST: % تكتب في الدفتر مباشرةً — الحركة تمرّ بدوالّ §10 وحدها', t;
    end if;
    if v_def ~* 'insert\s+into\s+public\.csub_approval_requests\M' then
      raise exception 'CSUB §17 SELF-TEST: % تُنشئ طلب اعتماد مباشرةً بدل csub_approval_submit_core', t;
    end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_request_transition(uuid,text,text,text,date)'));
  foreach t in array array['csub_reserve','csub_release','csub_consume','csub_approval_submit_core'] loop
    if v_def not ilike '%' || t || '%' then
      raise exception 'CSUB §17 SELF-TEST: آلة الحالات لا تستعمل % القائمة', t; end if;
  end loop;

  -- (4) ★ لا مبلغ يُحقن في رصيد عميل ★ — التوقيع بلا numeric.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'csub_request_transition'
                and 'numeric'::regtype = any(p.proargtypes::oid[])) then
    raise exception 'CSUB §17 SELF-TEST: آلة الحالات تقبل مبلغًا — حقن رقم في رصيد عميل';
  end if;
  if v_def not ilike '%r.credits_required%' then
    raise exception 'CSUB §17 SELF-TEST: الحجز لا يقرأ المبلغ من الطلب'; end if;

  -- (5) ★ اعتماد التجاوز قرار المالك ★ — لا يتقدّم الطلب قبل صدوره.
  if v_def not ilike '%overage_not_approved%' then
    raise exception 'CSUB §17 SELF-TEST: الاعتماد يتقدّم بلا قرار مالك على التجاوز'; end if;
  if v_def not ilike '%v_ap.status <> ''approved''%' then
    raise exception 'CSUB §17 SELF-TEST: لا فحص لحالة صفّ الاعتماد'; end if;

  -- (6) مفتاح التكرار حتميّ في كلّ نداء دفتر — نقرتان لا تُنتجان قيدين.
  if v_def not ilike '%csub_sr_idem%' then
    raise exception 'CSUB §17 SELF-TEST: نداءات الدفتر بلا مفتاح تكرار حتميّ'; end if;

  -- (7) ★★ لا إنشاء مشروع ولا مساس بالمنصّة المجمّدة ★★
  foreach t in array FNS loop
    v_def := pg_get_functiondef(to_regprocedure(t));
    if v_def ~* '(insert\s+into|update|delete\s+from)\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\M' then
      raise exception 'CSUB §17 SELF-TEST: % تكتب في منصّة المشاريع المجمّدة', t;
    end if;
  end loop;
  if pg_get_functiondef(to_regprocedure('public.csub_request_submit(jsonb)')) not ilike '%project_created%' then
    raise exception 'CSUB §17 SELF-TEST: التقديم لا يصرّح بأنّه لم يُنشئ مشروعًا'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.csub_request_transition(uuid,text,text,text,date)'));
  if v_def not ilike '%ready_for_manual_project_creation%' then
    raise exception 'CSUB §17 SELF-TEST: الاعتماد لا يُظهر «جاهز لإنشاء مشروع يدويًّا»'; end if;
  if pg_get_functiondef(to_regprocedure('public.csub_request_link_project(uuid,uuid,text)')) not ilike '%project_created%' then
    raise exception 'CSUB §17 SELF-TEST: الربط اليدويّ لا يصرّح بأنّه لم يُنشئ مشروعًا'; end if;

  -- (8) الحالات العشر كلّها في القيد.
  select pg_get_constraintdef(con.oid) into v_def from pg_constraint con
   where con.conrelid = to_regclass('public.csub_service_requests') and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%status%' limit 1;
  if v_def is null then raise exception 'CSUB §17 SELF-TEST: لا قيد على حالات الطلب'; end if;
  foreach t in array STATES loop
    if v_def not like '%' || t || '%' then
      raise exception 'CSUB §17 SELF-TEST: الحالة % غير مسموح بها', t; end if;
  end loop;

  -- (9) ★ سطح العميل: لا حقل داخليّ، ولا صفر كاذب ★
  v_def := pg_get_functiondef(to_regprocedure('public.csub_my_credits_page(uuid)'));
  foreach t in array array['internal_notes','internal_metadata','decision_reason',
                           'price_net','vat_amount','price_gross','csub_audit'] loop
    if v_def ilike '%' || t || '%' then
      raise exception 'CSUB §17 SELF-TEST: سطح العميل يقرأ الحقل الداخليّ %', t; end if;
  end loop;
  foreach t in array array['no_client_profile','no_active_subscription','no_units_on_subscription','has_entries'] loop
    if v_def not ilike '%' || t || '%' then
      raise exception 'CSUB §17 SELF-TEST: سطح العميل لا يفرّق الحالة % عن رصيد صفر', t; end if;
  end loop;

  -- (10) المرفق بيانات لا رابط.
  if not exists (select 1 from pg_constraint
                  where conrelid = to_regclass('public.csub_service_request_attachments')
                    and contype = 'c' and pg_get_constraintdef(oid) ilike '%http%') then
    raise exception 'CSUB §17 SELF-TEST: لا قيد يمنع تسجيل رابط مكان اسم الملفّ';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'csub_service_request_attachments'
                and (column_name ilike '%url%' or column_name ilike '%path%' or column_name ilike '%bucket%')) then
    raise exception 'CSUB §17 SELF-TEST: جدول المرفقات يحمل رابطًا أو مسار تخزين';
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  -- (11) ★★ السطح التشغيليّ بلا مال — بقائمة **سماح** لا قائمة منع ★★
  --
  --   القائمة السابقة كانت منعًا بالسلاسل الجزئية على أسماء الأعمدة:
  --     '%price%' · '%amount%' · '%cost%' · '%vat%' · '%margin%' · '%profit%'
  --   وهي خاطئة مرّتين:
  --     ★ إنذار كاذب: 'reservation_entry_id' يطابق '%vat%' لأنّ الحروف
  --       «reser·VAT·ion» تحتويها. العمود uuid ومفتاح أجنبيّ إلى csub_ledger —
  --       أي الربط التشغيليّ الذي يقتضيه التصميم — ولا مال فيه بحال. هذا
  --       بالضبط ما أسقط الترحيلة قبل COMMIT.
  --     ★ ثغرة صامتة: عمود ماليّ حقيقيّ يتجنّب تلك السلاسل الستّ يمرّ بلا
  --       اعتراض — unit_rate، overage_value، billing_line، selling_figure.
  --   قائمة المنع تحرس الأسماء التي فكّرنا فيها. قائمة السماح تحرس ما لم
  --   نفكّر فيه، وهو ما يقع فعلًا. لذلك: **كلّ عمود غير مذكور يُسقط الترحيلة**.
  --
  --   وتُطبَّق على ثلاث طبقات لا على أسماء الجداول وحدها:
  --     (أ) أعمدة الجدولين.        (ب) ما يقرأه سطح التشغيل من صفّ الطلب.
  --     (ج) غياب أيّ عرض (view) يلتفّ على الطبقتين.
  -- ════════════════════════════════════════════════════════════════════════

  -- (11-أ) أعمدة csub_service_requests: قائمة سماح صريحة.
  select coalesce(string_agg(c.column_name, ' · ' order by c.column_name), '')
    into v_bad
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'csub_service_requests'
     and c.column_name <> all (SR_COLS);
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — عمود خارج قائمة السماح التشغيلية: % — السطح التشغيليّ يجب أن يبقى بلا مال، وكلّ عمود جديد يُبرَّر في SR_COLS قبل أن يمرّ', v_bad;
  end if;

  -- (11-ب) أعمدة جدول المرفقات: قائمة سماح صريحة.
  select coalesce(string_agg(c.column_name, ' · ' order by c.column_name), '')
    into v_bad
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'csub_service_request_attachments'
     and c.column_name <> all (SRA_COLS);
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — عمود خارج قائمة السماح في جدول المرفقات: %', v_bad;
  end if;

  -- (11-ج) ★ شبكة ثانية تحرس قائمة السماح نفسها ★ — لا يُنقَل اسم من مفردات
  --   المال إلى هذين الجدولين ولو أُضيف إلى SR_COLS سهوًا. مطابقة **بالاسم
  --   الكامل** لا بالسلسلة الجزئية، فلا تتكرّر كارثة «reser·VAT·ion».
  select coalesce(string_agg(c.table_name || '.' || c.column_name, ' · '
                             order by c.table_name, c.column_name), '')
    into v_bad
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('csub_service_requests','csub_service_request_attachments')
     and c.column_name = any (MONEY_COLS);
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — مفردة مال صريحة: %', v_bad;
  end if;

  -- (11-و) ★ كلّ عمود رقميّ عدّادُ وحدات — مطابقة بالنوع لا بالاسم ★
  --   الشبكة الثالثة، وأدقّها: المال رقم. عمود رقميّ خارج UNIT_COLS يُسقط
  --   الترحيلة أيًّا كان اسمه — فحتّى تسمية بريئة تمامًا لمبلغٍ تُمسَك هنا.
  --   وبالمقابل لا يمكن لمفتاح uuid أن يقع في هذا الفحص، فلا «reser·VAT·ion»
  --   ثانية.
  select coalesce(string_agg(c.table_name || '.' || c.column_name, ' · '
                             order by c.table_name, c.column_name), '')
    into v_bad
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name in ('csub_service_requests','csub_service_request_attachments')
     and c.data_type in ('numeric','double precision','real','money')
     and c.column_name <> all (UNIT_COLS);
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — عمود رقميّ ليس عدّاد وحدات: % — المال رقم، والعدّاد يُذكر في UNIT_COLS صراحةً', v_bad;
  end if;

  -- (11-د) ★ السطح التشغيليّ: ما يُقرأ من الصفّ، لا ما يحمله الجدول ★
  --   كلّ إشارة r.<عمود> في قائمة الطلبات يجب أن تكون في OPS_COLS. عمود يُضاف
  --   إلى الجدول ثمّ يُعرض هنا يفشل ولو ذُكر في SR_COLS: بوّابتان لا واحدة.
  -- التعليقات تُحذف أوّلًا: pg_get_functiondef يُعيدها ضمن الجسم، وذكرُ اسمٍ
  -- في شرحٍ ليس إخراجًا له.
  v_def := regexp_replace(
    pg_get_functiondef(to_regprocedure('public.csub_service_requests_list(jsonb)')),
    chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g');
  select coalesce(string_agg(distinct x.k, ' · '), '') into v_bad
    from regexp_matches(v_def, '\mr\.([a-z_][a-z0-9_]*)', 'g') m
    cross join lateral (select m[1]) x(k)
   where x.k <> all (OPS_COLS);
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — سطح التشغيل يقرأ عمودًا خارج قائمة السماح: %', v_bad;
  end if;

  -- ولا مفردة مال في نصّ السطح التشغيليّ إطلاقًا (مبلغ محسوب، أو منسوخ من
  -- جدول آخر، أو مُسمّى بريئًا ثمّ مملوءًا بمال — كلّها تسقط هنا).
  foreach t in array MONEY_COLS loop
    if v_def ~* ('\m' || t || '\M') then
      raise exception 'CSUB §17 SELF-TEST: عمود ماليّ في طلبات الخدمة — سطح التشغيل يذكر مفردة المال %', t;
    end if;
  end loop;
  if v_def not ilike '%''finance_visible'', false%' then
    raise exception 'CSUB §17 SELF-TEST: سطح التشغيل لا يصرّح بأنّه بلا مال';
  end if;

  -- (11-هـ) لا عرض (view/matview) يلتفّ على الجدولين ويعيد تركيب سطح ثالث
  --   خارج قائمة السماح. السطح التشغيليّ RPC واحدة، ولا ثانية لها.
  select coalesce(string_agg(c.relname, ' · ' order by c.relname), '') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')
     and pg_get_viewdef(c.oid, true) ilike '%csub_service_request%';
  if v_bad <> '' then
    raise exception 'CSUB §17 SELF-TEST: عرض يلتفّ على طلبات الخدمة خارج قائمة السماح: %', v_bad;
  end if;

  -- (12) الترحيلة لم تُنشئ طلبًا.
  select count(*) into v_n from public.csub_service_requests where created_at = now();
  if v_n <> 0 then raise exception 'CSUB §17 SELF-TEST: الترحيلة أنشأت طلب خدمة'; end if;

  raise notice 'CSUB §17 SELF-TEST: نجح — طلبات خدمة بعشر حالات فوق دوالّ الدفتر القائمة، مفتاح تكرار حتميّ، اعتماد التجاوز بيد المالك، عزل عميل بنيويّ، بلا مال وبلا مشروع.';
end $st17$;

commit;

-- PostgREST يخزّن المخطّط في ذاكرته: بلا هذا السطر ستقرأ الواجهة PGRST202
-- كاذبًا وتعرض «الترحيلة غير مطبّقة» بعد ترحيلة ناجحة.
notify pgrst, 'reload schema';
