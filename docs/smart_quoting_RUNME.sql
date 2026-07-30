-- ════════════════════════════════════════════════════════════════════════════
-- docs/smart_quoting_RUNME.sql
-- المرحلة ٤+٥ — باني عروض الأسعار الذكيّ وحُرّاس الربحية.
--
-- معاملة واحدة · قابل لإعادة التشغيل · بلا CONCURRENTLY · SELF-TEST ساكن.
-- شغّل docs/smart_quoting_PREFLIGHT.sql أوّلًا، وPOSTCHECK بعده.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★★ الفكرة الحاكمة: حارس الربحية هو الميزة، لا مُلحق بها ★★★
--
-- المركز المالي علّمنا الدرس بثمن حقيقيّ: دورٌ واحد نال طرفَي المعادلة
-- (إيراد مفوتَر) و(تكلفة)، فاستنتج الهامش بطرحٍ بسيط بلا أن يملك مفتاح
-- الربحية إطلاقًا. البوّابة كانت سليمة؛ الالتفاف حولها كان جمعًا ابتدائيًّا.
--
-- التسعير أخطر: العرض بطبيعته يحمل الطرفين في مستند واحد. لذلك لم نكتفِ
-- بإخفاء أعمدة، بل بنينا **فصلًا بنيويًّا**:
--
--   ١) طرف التكلفة يسكن جداول منفصلة لا يلمسها سطح المبيعات إطلاقًا:
--      sq_cost_rates · sq_pricing_rules · sq_quote_internal · sq_audit ·
--      sq_approval_requests. لا عمود تكلفة واحد في sq_quotes.
--      لو ارتخت سياسة RLS يومًا على sq_quotes، لا تكلفة هناك لتتسرّب.
--
--   ٢) دوالّ سطح المبيعات **لا تذكر** جدول تكلفة ولا عمود تكلفة ولو مرّة.
--      ليست «تُقنّع الأعمدة» — لا تقرؤها أصلًا. لا يمكن تسريب ما لا يُقرأ.
--      الـSELF-TEST يفشل إن ظهر رمز تكلفة واحد في تعريف أيّ منها.
--
--   ٣) لا جدول من جداول الموديول ممنوح لـauthenticated. كلّ قراءة تمرّ بدالّة
--      SECURITY DEFINER بقائمة أعمدة صريحة. PostgREST لا يستطيع أن يطلب
--      عمودًا لم نكتبه بأيدينا. (لا `select *` في أيّ دالّة قراءة.)
--
--   ٤) بوّابة التكلفة **بلا مفتاح صلاحية**. لو كانت مفتاحًا لأمكن منحها،
--      ولانتهت «للمالك وحده» إلى منحة إداريّة تُعطى مرّة وتُنسى.
--      sq_can_view_cost() = is_staff() AND is_owner(). حرفيًّا. نقطة.
--
--   ٥) ★ لا عرّاف (oracle) ★ — أخطر ثغرة أغلقناها، واستحقّت قرار تصميم:
--      لو كان «هل يحتاج اعتماد المالك؟» دالّةً في الأرضية min_price، لأمكن
--      لموظّف المبيعات أن يُدخل سعرًا بعد سعر ويراقب انقلاب الجواب، فيبحث
--      ثنائيًّا عن الأرضية بلا أن يراها قطّ. أرقام مخفيّة تتسرّب بالسلوك.
--      لذلك: **كلّ عرض يمرّ باعتماد المالك، بلا استثناء ولا شرط.**
--      القيد sq_quotes_approval_always يفرض ذلك في القاعدة نفسها، فلا يستطيع
--      كودٌ لاحق أن يجعله شرطيًّا. المسار ثابت ⇒ لا يحمل معلومة ⇒ لا عرّاف.
--      التفاصيل ولماذا رُفض البديل: docs/SMART_QUOTING_PRICING_MODEL.md §7.
--
--   ٦) ★ التكميم ضدّ العكس ★ — السعر المقترَح يُدوَّر لأعلى إلى مضاعف
--      sell_quantum. حتى لو عُرفت نسبة الهامش المستهدفة يومًا، فإنّ التكلفة
--      لا تُستخرج من السعر إلا كمجال، لا كرقم. العكس الحسابيّ مكسور بالبناء.
--
--   ٧) ★ المدى العلنيّ لا يلمس الأرضية ★ — sq_publish_range تُحسب من السعر
--      المعتمَد وحده (سطح بيع)، ولا تقرأ min_price ولا تكلفة. ويُرفض نشر مدًى
--      أضيق من خطوة التكميم: مدًى ضيّق سعرٌ نهائيّ متنكّر.
--
--   ٨) ★ الرفض لا يشرح نفسه للمبيعات ★ — سبب الرفض البنيويّ
--      (internal_reason_code · floor_at_request) للمالك وحده. ولو حاول أحد
--      التحسّس بتقديم أسعار متدرّجة فإنّ floor_probe_count يعدّها ويظهرها
--      للمالك: ما لا نمنعه بنيويًّا (قناة بشرية) نكشفه صراحةً.
--
-- ★ ما هذا الموديول ليس عليه أن يفعله ★
--   لا يُنشئ مشروعًا ولا يعدّله ولا يغيّر مرحلته ولا يُنشئ تسليمًا. مرجع
--   project_id **اختياريّ وللقراءة فقط**، ومفتاحه الأجنبيّ لا يُنشأ إلا إن
--   وُجد جدول المشاريع. منصّة المشاريع مجمَّدة.
--
--   ولا يُرسل بريدًا. الحالة sent_placeholder تعني «معتمد وجاهز للإرسال
--   اليدوي» ولا تعني أنّ رسالة غادرت. delivery_proven مقيَّد بـfalse بقيد
--   CHECK: لا يجوز لأحد أن يدّعي تسليمًا لم يُثبته مزوّد.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0) فحص صلب + إعادة تهيئة نظيفة.
--
--   الفحص الصلب أوّلًا: PREFLIGHT ينصح، وهذا يمنع. من يشغّل RUNME بلا
--   PREFLIGHT يجب أن يُوقَف هنا برسالة تقول ما الناقص بالضبط، لا أن يحصل على
--   نصف موديول.
--
--   ثمّ الإسقاط: نُسقط سياسات sq_* ودوالّ sq_* قبل إعادة بنائها. السبب عمليّ
--   لا تجميليّ — تغيير نوع إرجاع دالّة قائمة يرفع 42P13 ويُسقط الترحيلة
--   كلّها. الإسقاط داخل المعاملة نفسها التي تعيد البناء، فلا لحظة يكون فيها
--   الموديول ناقصًا. **الجداول والبيانات لا تُمسّ.**
-- ════════════════════════════════════════════════════════════════════════════
do $pre$
declare missing text[] := '{}';
begin
  if to_regclass('public.clients')  is null then missing := missing || 'جدول public.clients'; end if;
  if to_regclass('auth.users')      is null then missing := missing || 'جدول auth.users'; end if;
  if to_regprocedure('public.is_staff()') is null then missing := missing || 'الدالّة public.is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then missing := missing || 'الدالّة public.is_owner() ★ بوّابة التكلفة تُبنى فوقها'; end if;
  if to_regprocedure('public.is_admin()') is null then missing := missing || 'الدالّة public.is_admin()'; end if;

  if array_length(missing, 1) is not null then
    raise exception E'SMART QUOTING §0 — اعتماديّات ناقصة، لم يُكتب شيء:\n  · %\nشغّل docs/smart_quoting_PREFLIGHT.sql لتفصيل الحالة.',
      array_to_string(missing, E'\n  · ');
  end if;

  -- نوع الإرجاع: بوّابة لا تُرجع boolean تُنتج سياسات بمعنى غير محدَّد، وهو ليس منعًا.
  if (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.is_owner()')) then
    raise exception 'SMART QUOTING §0 — public.is_owner() لا تُرجع boolean؛ بوّابة التكلفة ستكون بمعنى غير محدَّد. أوقفنا الترحيلة.';
  end if;
end $pre$;

do $reset$
declare r record;
begin
  -- سياسات جداولنا (تعتمد على دوالّنا، فتُسقط قبلها)
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename like 'sq\_%'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  -- مُشغّلاتنا
  for r in
    select t.tgname, c.relname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'sq\_%' and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
  end loop;

  -- دوالّنا بتوقيعها الكامل
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'sq\_%'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $reset$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--
--   ★ ما ليس مفتاحًا هنا هو جوهر المرحلة ★
--   لا `quote.view_cost` ولا `quote.view_margin` ولا `quote.approve`.
--   التكلفة والهامش والأرضية والاعتماد ليست صلاحيات تُمنح: هي **موقع** في
--   الشركة. مفتاحٌ لها يعني أنّها ستُمنح يومًا لتسهيل عمل، ثمّ تُنسى ممنوحة.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'SQ §1: جدول permissions غير موجود — تخطّي بذر المفاتيح (fail-closed: sq_perm ستُرجع false).';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'commercial', v.sens, v.ord, v.ar, v.en
  from (values
    (1510,'quote.view',           'normal',   'عرض عروض الأسعار',            'View quotes'),
    (1520,'quote.build',          'sensitive','بناء وتحرير عروض الأسعار',    'Build & edit quotes'),
    (1530,'quote.catalog_manage', 'sensitive','إدارة الكتالوج ودفتر الأسعار','Manage catalog & price book'),
    (1540,'quote.export',         'normal',   'تصدير عرض السعر',             'Export a quote'),
    -- سُلّم الخصم: درجات سياسة معلنة، **لا** تُشتقّ من الأرضية ولا تكشفها.
    (1550,'quote.discount_l1',    'normal',   'صلاحية خصم حتى الدرجة الأولى','Discount allowance — tier 1'),
    (1560,'quote.discount_l2',    'sensitive','صلاحية خصم حتى الدرجة الثانية','Discount allowance — tier 2')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) مُسنَدات الجلسة. لا واحد منها يُرجع NULL — كلّها ملفوفة بـcoalesce،
--     لأنّ NULL في سياسة RLS ليس منعًا بل «غير محدَّد».
--
--     ⚠️ لا can_manage_projects ولا is_kian_member كبوّابة: هذا موديول تجاريّ،
--        وربط بوّابة المشاريع به يوسّع دائرة الانفجار بلا سبب.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false، لا استثناء. المصيدة تُفشِل.
create or replace function public.sq_perm(p_key text) returns boolean
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

create or replace function public.sq_perm_key_exists(p_key text) returns boolean
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

create or replace function public.sq_is_owner_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null)
    and (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ البوّابتان اللتان تقوم عليهما المرحلة كلّها ★★
--
-- كلتاهما: is_staff() AND is_owner(). حرفيًّا، وبلا مفتاح، وبلا is_admin.
--
-- لماذا لا is_admin؟ لأنّ «المدير» دور تشغيليّ يُسنَد لتسهيل الإدارة اليومية،
-- والتكلفة والهامش ليسا إدارة يومية. توسيعها إلى المدير يعني أنّ كلّ من
-- يُرقّى إداريًّا يرث الربحية صامتًا. المتطلّب قال OWNER ONLY، وهذا هو.
--
-- ولماذا لا مفتاح؟ لأنّ المفتاح يُمنح. راجع §1.
--
-- الاعتماد أيضًا للمالك: تحديد سعر البيع قرار ربحية لا قرار إداريّ. ولو كان
-- الاعتماد أوسع من رؤية التكلفة لصار المعتمِد يقرّر في أرقام لا يراها.
-- الـSELF-TEST يفشل إن ظهرت sq_perm أو is_admin في أيّ من التعريفين.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sq_can_view_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.is_owner(), false),
  false);
$$;

create or replace function public.sq_can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.is_owner(), false),
  false);
$$;

-- ─── بوّابات سطح البيع — قابلة للمنح، ولا تلمس تكلفة ────────────────────────
create or replace function public.sq_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.sq_is_owner_role(), false)
      or coalesce(public.sq_perm('quote.view'), false)
      or coalesce(public.sq_perm('quote.build'), false)
      or coalesce(public.sq_perm('quote.catalog_manage'), false)),
  false);
$$;

create or replace function public.sq_can_build() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.sq_is_owner_role(), false)
      or coalesce(public.sq_perm('quote.build'), false)),
  false);
$$;

create or replace function public.sq_can_manage_catalog() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.sq_is_owner_role(), false)
      or coalesce(public.sq_perm('quote.catalog_manage'), false)),
  false);
$$;

create or replace function public.sq_can_export() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null) and coalesce(public.is_staff(), false)
    and (coalesce(public.sq_is_owner_role(), false)
      or coalesce(public.sq_perm('quote.export'), false)),
  false);
$$;

create or replace function public.sq_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — أربعة عشر، كلّها sq_*.
--
--     ★ الفصل البنيويّ ★ خمسة منها تحمل طرف التكلفة وتُوسم هنا بـ«★ تكلفة»:
--       sq_cost_rates · sq_pricing_rules · sq_quote_internal ·
--       sq_approval_requests · sq_audit
--     التسعة الباقية سطح بيع خالص: لا عمود تكلفة ولا هامش ولا أرضية فيها.
--     هذا التقسيم هو ما يجعل «لا يمكن الطرح» صحيحًا بنيويًّا لا بالتقنيع.
--
--     المُسنَدات التي تقرأ جداول تأتي في §4: PostgreSQL يتحقّق من أجسام دوالّ
--     SQL عند الإنشاء، فتعريفها قبل جداولها يُسقط الترحيلة.
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.sq_quote_code_seq;
create sequence if not exists public.sq_price_book_code_seq;

-- 3.1 إعدادات الموديول
create table if not exists public.sq_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  label_ar    text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- 3.2 كتالوج الخدمات
create table if not exists public.sq_service_catalog (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  name_en     text not null,
  category    text not null default 'production',
  uom_ar      text not null default 'وحدة',
  uom_en      text not null default 'unit',
  is_active   boolean not null default true,
  sort_order  int not null default 100,
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3.3 دفاتر الأسعار
create table if not exists public.sq_price_books (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  name_en     text not null,
  status      text not null default 'draft'
                check (status in ('draft','active','archived')),
  currency    text not null default 'SAR' check (currency = 'SAR'),
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3.4 نُسخ دفتر الأسعار — ★ الإصدارات هنا ★
--     نسخة منشورة لا تُعدَّل أبدًا (مُشغّل §5 يمنع). العرض يتجمّد على
--     price_book_version_id، فسعرُ عرضٍ قديم يبقى مفسَّرًا بأسعار وقته.
create table if not exists public.sq_price_book_versions (
  id            uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.sq_price_books(id) on delete cascade,
  version_no    int  not null,
  status        text not null default 'draft'
                  check (status in ('draft','published','superseded')),
  effective_from date,
  effective_to   date,
  published_at  timestamptz,
  published_by  uuid references auth.users(id),
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (price_book_id, version_no),
  constraint sq_pbv_dates check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

-- 3.5 بنود دفتر الأسعار — ★ سطح بيع فقط ★
--     لا عمود تكلفة هنا ولو واحدًا. مبنيّ البيع منفصل عن مبنى التكلفة (3.6)
--     كي لا يوجد صفّ واحد يجمع الرقمين.
create table if not exists public.sq_price_book_entries (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.sq_price_book_versions(id) on delete cascade,
  catalog_id  uuid not null references public.sq_service_catalog(id) on delete restrict,
  tier        text not null
                check (tier in ('basic','professional','cinematic','enterprise_custom')),
  sell_rate   numeric(14,2) not null check (sell_rate >= 0),
  min_qty     numeric(12,3) not null default 0 check (min_qty >= 0),
  uom         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (version_id, catalog_id, tier)
);

-- 3.6 ★ تكلفة ★ أسعار التكلفة وأجور المورّدين والطاقم — للمالك وحده.
--     جدول منفصل عمدًا: لو كان عمودًا في 3.5 لكفى منحُ قراءة البنود لكشف
--     التكلفة، ولصار كلّ بانِ عرضٍ قادرًا على استخراج نسبة الربح بقسمة واحدة.
create table if not exists public.sq_cost_rates (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.sq_price_book_versions(id) on delete cascade,
  catalog_id    uuid not null references public.sq_service_catalog(id) on delete restrict,
  tier          text not null
                  check (tier in ('basic','professional','cinematic','enterprise_custom')),
  cost_rate     numeric(14,2) not null default 0 check (cost_rate >= 0),
  supplier_rate numeric(14,2) check (supplier_rate >= 0),
  crew_rate     numeric(14,2) check (crew_rate >= 0),
  supplier_name text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (version_id, catalog_id, tier)
);

-- 3.7 ★ تكلفة ★ قواعد التسعير — **المعادلة الداخلية نفسها**.
--     خطرة بقدر التكلفة: من يعرف نسبة الهامش المستهدفة ويرى السعر المقترَح
--     يقلب المعادلة ويستخرج التكلفة. لذلك للمالك وحده، بلا استثناء.
create table if not exists public.sq_pricing_rules (
  id            uuid primary key default gen_random_uuid(),
  rule_code     text not null unique,
  kind          text not null check (kind in (
                  'target_margin_pct','min_margin_pct','contingency_pct',
                  'cost_surcharge_pct','overhead_alloc_pct','sell_uplift_pct')),
  tier          text check (tier in ('basic','professional','cinematic','enterprise_custom')),
  condition_key text,
  value         numeric(10,4) not null,
  is_active     boolean not null default true,
  sort_order    int not null default 100,
  label_ar      text,
  notes         text,
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 3.8 العروض — ★ سطح بيع خالص ★
--     ابحث في هذا التعريف عن كلمة «cost» أو «margin» أو «min_price»: لا وجود
--     لها. هذا مقصود ومُختبَر. طرف التكلفة كلّه في 3.9.
create table if not exists public.sq_quotes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  client_id     uuid not null references public.clients(id) on delete restrict,
  -- ★ مرجع اختياريّ للقراءة فقط. لا FK هنا: يُضاف في §3.15 فقط إن وُجد جدول
  --   المشاريع. الموديول لا يكتب في المشاريع ولا يغيّر مرحلة ولا يُنشئ تسليمًا.
  project_id    uuid,
  title         text not null,
  tier          text not null default 'professional'
                  check (tier in ('basic','professional','cinematic','enterprise_custom')),
  status        text not null default 'draft' check (status in (
                  'draft','internal_review','pending_owner_approval','approved',
                  'sent_placeholder','accepted','rejected','expired','superseded')),
  version_no    int not null default 1 check (version_no >= 1),
  supersedes_id uuid references public.sq_quotes(id) on delete set null,
  price_book_version_id uuid references public.sq_price_book_versions(id) on delete restrict,
  currency      text not null default 'SAR' check (currency = 'SAR'),

  -- ── أرقام البيع (يراها موظّف المبيعات) ──────────────────────────────────
  -- ★ قراءة حرفيّة للمتطلّب ★ المسموح لموظّف المبيعات: «سعر البيع المعتمَد،
  --   المدى المسموح، صلاحية خصمه هو، إجمالي العرض، الضريبة، حالة الاعتماد.
  --   لا شيء غير ذلك.» و«السعر المقترَح» ليس في القائمة — وهو فعلًا رقم
  --   مشتقّ من التكلفة، فمكانه sq_quote_internal لا هنا.
  --
  --   list_price      = مجموع بنود العرض بأسعار البيع المنشورة. ليس مشتقًّا من
  --                     تكلفة: الموظّف يستطيع جمعه بنفسه من بنوده، فإخفاؤه
  --                     مسرحيّة لا أمان.
  --   proposed_price  = ما يقترحه الموظّف ضمن صلاحية خصمه.
  --   authorized_price= ما يعتمده المالك. يبقى NULL حتى الاعتماد — ولا يُملأ
  --                     بـlist_price تجميلًا: «لم يُعتمد بعد» ليس «معتمد».
  list_price        numeric(14,2) check (list_price >= 0),
  proposed_price    numeric(14,2) check (proposed_price >= 0),
  authorized_price  numeric(14,2) check (authorized_price  >= 0),
  discount_pct      numeric(6,4) not null default 0 check (discount_pct >= 0 and discount_pct <= 1),
  discount_amount   numeric(14,2) not null default 0 check (discount_amount >= 0),
  gross_before_vat  numeric(14,2) check (gross_before_vat >= 0),

  -- ★ الضريبة حقل مستقلّ دائمًا، لا مطويّة في الإجمالي ★
  -- NULL يبقى NULL: عرضٌ لم يُسعَّر بعدُ لا يُعرض بضريبة صفر.
  vat_rate     numeric(6,4) not null default 0.15 check (vat_rate >= 0 and vat_rate <= 1),
  vat_amount   numeric(14,2) generated always as (
                 case when gross_before_vat is null then null
                      else round(gross_before_vat * vat_rate, 2) end) stored,
  total_after_vat numeric(14,2) generated always as (
                 case when gross_before_vat is null then null
                      else gross_before_vat + round(gross_before_vat * vat_rate, 2) end) stored,

  -- ── المدى الإرشاديّ العلنيّ (اختياريّ) ───────────────────────────────────
  range_low        numeric(14,2) check (range_low  >= 0),
  range_high       numeric(14,2) check (range_high >= 0),
  range_published  boolean not null default false,
  range_published_at timestamptz,
  -- ★ لا يصير سعرًا نهائيًّا أبدًا. القيد يمنع، لا التعليق. ★
  range_is_binding boolean not null default false
                     constraint sq_range_never_binding check (range_is_binding = false),
  constraint sq_range_ordered check (range_low is null or range_high is null or range_high > range_low),

  -- ── الشروط ───────────────────────────────────────────────────────────────
  validity_days int not null default 30 check (validity_days > 0 and validity_days <= 365),
  valid_until   date,
  assumptions   text,
  exclusions    text,

  -- ★ لا عرّاف: القيد يفرض أنّ كلّ عرض يمرّ بالمالك، فالمسار ثابت ولا يحمل
  --   معلومة عن الأرضية. راجع §5 من رأس الملفّ.
  requires_owner_approval boolean not null default true
    constraint sq_quotes_approval_always check (requires_owner_approval),
  -- سبب معروض للمبيعات — سياسة فقط (خصم/فئة مخصّصة)، لا أرضية ولا تكلفة.
  approval_reason_public text,
  approved_at  timestamptz,
  approved_by  uuid references auth.users(id),

  -- ── أمانة التسليم ────────────────────────────────────────────────────────
  -- «معتمد وجاهز للإرسال اليدوي». لا بريد يغادر من هنا.
  ready_for_manual_send_at timestamptz,
  delivery_proven boolean not null default false
    constraint sq_delivery_never_claimed check (delivery_proven = false),

  client_decision    text check (client_decision in ('accepted','rejected')),
  client_decision_at timestamptz,
  client_decision_note text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3.9 ★ تكلفة ★ الوجه الداخليّ للعرض — للمالك وحده.
--     كلّ رقم يمكن أن يكشف الربحية يسكن هنا وحده: التكلفة، الأرضية، الهامش،
--     الربح، والمعادلة التي أنتجتها. جدول منفصل عن sq_quotes بقصد الدفاع في
--     العمق: لو ارتخت سياسة على العروض يومًا، لا يوجد فيها ما يتسرّب.
create table if not exists public.sq_quote_internal (
  quote_id      uuid primary key references public.sq_quotes(id) on delete cascade,
  base_cost              numeric(14,2),
  surcharge_cost         numeric(14,2),
  contingency_pct        numeric(6,4) not null default 0 check (contingency_pct >= 0 and contingency_pct <= 1),
  contingency_amount     numeric(14,2),
  external_supplier_cost numeric(14,2) not null default 0 check (external_supplier_cost >= 0),
  internal_cost_estimate numeric(14,2),
  target_margin_pct      numeric(6,4),
  min_margin_pct         numeric(6,4),
  -- ★ السعر المقترَح داخليّ ★ مشتقّ مباشرةً من التكلفة (cost ÷ (1 − هامش)).
  --   لو عُرضت هذه القيمة لموظّف المبيعات مع أيّ تسريب لاحق لنسبة الهامش
  --   لانكشفت التكلفة بقسمة واحدة. مكمَّم لأعلى إلى sell_quantum: حتى مع معرفة
  --   النسبة لا تُستخرج التكلفة إلا كمجال، لا كرقم.
  recommended_price      numeric(14,2),
  min_price              numeric(14,2),   -- ★ الأرضية. لا تغادر هذا الجدول إلا للمالك.
  gross_profit           numeric(14,2),
  margin_pct             numeric(6,4),
  overhead_alloc_pct     numeric(6,4),
  est_net_profit         numeric(14,2),
  below_floor            boolean not null default false,
  -- ★ كشف التحسّس: عدّاد محاولات التسعير تحت الأرضية. ما لا نمنعه بنيويًّا
  --   (القناة البشرية: تقديم أسعار متدرّجة ومراقبة قرار المالك) نكشفه.
  floor_probe_count      int not null default 0,
  cost_breakdown   jsonb not null default '{}'::jsonb,
  formula_snapshot jsonb not null default '{}'::jsonb,
  computed_at timestamptz,
  computed_by uuid references auth.users(id)
);

-- 3.10 مدخلات النطاق — ★ سطح بيع: نطاق العمل لا تكلفته ★
--      «تكلفة المورّد الخارجيّ» ليست هنا: هنا **الحاجة** إلى مورّد ونطاقه،
--      أمّا رقمها فيكتبه المالك في 3.9. لو كتب موظّف المبيعات رقم التكلفة
--      بنفسه لعرف أحد طرفَي المعادلة، ولاستخرج نسبة الهامش من السعر المقترَح،
--      ثمّ عكسها على كلّ عرض آخر في النظام. ثغرة بمدخَل واحد.
create table if not exists public.sq_quote_inputs (
  quote_id uuid primary key references public.sq_quotes(id) on delete cascade,
  shooting_days        int     not null default 0 check (shooting_days >= 0),
  shooting_hours       numeric(8,2) not null default 0 check (shooting_hours >= 0),
  locations_count      int     not null default 0 check (locations_count >= 0),
  cities               text[]  not null default '{}',
  travel_required      boolean not null default false,
  travel_km            numeric(10,2) not null default 0 check (travel_km >= 0),
  accommodation_nights int     not null default 0 check (accommodation_nights >= 0),
  crew_size            int     not null default 0 check (crew_size >= 0),
  cameras_count        int     not null default 0 check (cameras_count >= 0),
  lighting_setup       text    not null default 'none',
  audio_setup          text    not null default 'none',
  drone                boolean not null default false,
  drone_hours          numeric(8,2) not null default 0 check (drone_hours >= 0),
  fpv_drone            boolean not null default false,
  fpv_drone_hours      numeric(8,2) not null default 0 check (fpv_drone_hours >= 0),
  live_streaming       boolean not null default false,
  live_stream_days     int     not null default 0 check (live_stream_days >= 0),
  editing_hours        numeric(8,2) not null default 0 check (editing_hours >= 0),
  motion_graphics_secs numeric(8,2) not null default 0 check (motion_graphics_secs >= 0),
  voice_over           boolean not null default false,
  voice_over_langs     int     not null default 0 check (voice_over_langs >= 0),
  scriptwriting        boolean not null default false,
  storyboard           boolean not null default false,
  versions_count       int     not null default 1 check (versions_count >= 1),
  formats              text[]  not null default '{}',
  delivery_speed       text    not null default 'standard'
                         check (delivery_speed in ('standard','express','rush')),
  weekend_work         boolean not null default false,
  night_work           boolean not null default false,
  permits_required     boolean not null default false,
  permits_count        int     not null default 0 check (permits_count >= 0),
  equipment_rental_required boolean not null default false,
  equipment_rental_notes    text,
  -- الحاجة ونطاقها — لا رقمها.
  external_supplier_required boolean not null default false,
  external_supplier_scope    text,
  notes       text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- 3.11 بنود العرض — ★ سطح بيع فقط: سعر بيع الوحدة لا تكلفتها ★
create table if not exists public.sq_quote_lines (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.sq_quotes(id) on delete cascade,
  catalog_id uuid references public.sq_service_catalog(id) on delete set null,
  kind       text not null default 'service'
               check (kind in ('service','surcharge','rental','logistics','other')),
  label      text not null,
  qty        numeric(12,3) not null default 1 check (qty >= 0),
  uom        text,
  unit_sell_rate numeric(14,2) not null default 0 check (unit_sell_rate >= 0),
  line_total numeric(14,2) generated always as (round(qty * unit_sell_rate, 2)) stored,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3.12 دفعات السداد — سطح بيع. الضريبة حقل مستقلّ هنا أيضًا.
create table if not exists public.sq_quote_milestones (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.sq_quotes(id) on delete cascade,
  seq        int  not null check (seq >= 1),
  label      text not null,
  pct        numeric(6,4) check (pct >= 0 and pct <= 1),
  amount_net numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate   numeric(6,4) not null default 0.15 check (vat_rate >= 0 and vat_rate <= 1),
  vat_amount numeric(14,2) generated always as (round(amount_net * vat_rate, 2)) stored,
  amount_gross numeric(14,2) generated always as (amount_net + round(amount_net * vat_rate, 2)) stored,
  due_rule   text not null default 'on_signature',
  created_at timestamptz not null default now(),
  unique (quote_id, seq)
);

-- 3.13 ★ تكلفة ★ طلبات الاعتماد.
--      تحمل floor_at_request و internal_reason_code، فهي جدول تكلفة بالتعريف.
--      موظّف المبيعات يقرأ **طلباته هو** عبر sq_my_approvals، وهي دالّة
--      بقائمة أعمدة صريحة لا تذكر أيًّا من العمودين.
create table if not exists public.sq_approval_requests (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.sq_quotes(id) on delete cascade,
  kind         text not null check (kind in ('price','discount','custom_tier','validity','revision')),
  requested_price        numeric(14,2) check (requested_price >= 0),
  requested_discount_pct numeric(6,4) check (requested_discount_pct >= 0 and requested_discount_pct <= 1),
  reason       text,
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected','withdrawn')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  decided_by   uuid references auth.users(id),
  decided_at   timestamptz,
  -- ملاحظة القرار: نصّ يكتبه المالك ويراه مقدّم الطلب. اختيار بشريّ واعٍ.
  decision_note text,
  -- ★ تكلفة — للمالك وحده ولا تخرج في أيّ دالّة سطح بيع ★
  floor_at_request     numeric(14,2),
  internal_reason_code text
);

-- 3.14 ★ تكلفة ★ سجلّ التدقيق — الحمولة قد تحوي أرقام تكلفة، فالقراءة للمالك.
--      سطح المبيعات يرى «نشاطًا» بلا حمولة عبر sq_quote_activity.
create table if not exists public.sq_audit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor     uuid references auth.users(id),
  action    text not null,
  entity    text not null,
  entity_id uuid,
  quote_id  uuid,
  payload   jsonb not null default '{}'::jsonb
);

-- 3.15 المفتاح الأجنبيّ الاختياريّ إلى المشاريع — يُنشأ فقط إن وُجد الجدول.
--      ON DELETE SET NULL: حذف مشروع لا يجوز أن يحذف عرضًا تجاريًّا.
do $fk$
begin
  if to_regclass('public.projects') is null then
    raise notice 'SQ §3.15: جدول المشاريع غير موجود — project_id يبقى مرجعًا حرًّا بلا FK.';
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'sq_quotes_project_fk' and conrelid = 'public.sq_quotes'::regclass
  ) then
    alter table public.sq_quotes
      add constraint sq_quotes_project_fk
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end $fk$;

-- ─── فهارس ──────────────────────────────────────────────────────────────────
create index if not exists sq_quotes_client_idx        on public.sq_quotes (client_id);
create index if not exists sq_quotes_status_idx        on public.sq_quotes (status);
create index if not exists sq_quotes_created_by_idx    on public.sq_quotes (created_by);
create index if not exists sq_quotes_project_idx       on public.sq_quotes (project_id);
create index if not exists sq_quote_lines_quote_idx    on public.sq_quote_lines (quote_id, sort_order);
create index if not exists sq_quote_ms_quote_idx       on public.sq_quote_milestones (quote_id, seq);
create index if not exists sq_pbe_version_idx          on public.sq_price_book_entries (version_id);
create index if not exists sq_cost_rates_version_idx   on public.sq_cost_rates (version_id);
create index if not exists sq_appr_quote_idx           on public.sq_approval_requests (quote_id, status);
create index if not exists sq_appr_requester_idx       on public.sq_approval_requests (requested_by, status);
create index if not exists sq_audit_quote_idx          on public.sq_audit (quote_id, at desc);
create index if not exists sq_pbv_book_idx             on public.sq_price_book_versions (price_book_id, version_no desc);

-- ─── بذر الإعدادات ──────────────────────────────────────────────────────────
-- ★ سُلّم الخصم قيمةُ سياسة معلنة، لا مشتقّة من الأرضية ★
--   لو اشتُقّ السقف من min_price لكان `السعر المقترَح × (١ − السقف)` مساويًا
--   للأرضية بالضبط، ولكشفها لكلّ موظّف يعرف سقفه. لذلك القيم ثابتة ومعلنة.
insert into public.sq_settings (key, value, label_ar) values
  ('vat_rate',              '0.15',  'نسبة ضريبة القيمة المضافة'),
  ('default_validity_days', '30',    'صلاحية العرض الافتراضية (يومًا)'),
  ('sell_quantum',          '500',   'تكميم السعر المقترَح (ريال) — كاسر العكس الحسابيّ'),
  ('public_range_step',     '5000',  'خطوة تدوير المدى العلنيّ (ريال)'),
  ('public_range_band_pct', '0.15',  'عرض المدى العلنيّ حول السعر المعتمَد'),
  ('discount_allowance',
   '{"default":0.0,"quote.discount_l1":0.05,"quote.discount_l2":0.10}',
   'سُلّم صلاحية الخصم — سياسة معلنة لا تُشتقّ من الأرضية'),
  ('default_contingency_pct', '0.07', 'نسبة الطوارئ الافتراضية (داخليّ)'),
  ('default_overhead_pct',    '0.12', 'نسبة تحميل المصاريف العامّة (داخليّ)')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) مساعدات تقرأ جداول — بعد §3 لأنّ PostgreSQL يتحقّق من أجسام دوالّ SQL
--     لحظة الإنشاء.
--
--     ⚠️ كلّ ما في هذا القسم **داخليّ**: §13 يمنع تنفيذه عن authenticated.
--     السبب مباشر: sq_setting_num('default_contingency_pct') تُرجع معامل
--     المعادلة الداخلية. لو كانت الدالّة ممنوحة لأمكن لأيّ موظّف أن يقرأ
--     نسب الطوارئ والمصاريف العامّة باستدعاء واحد، ثمّ يقلب المعادلة.
--     الدوالّ الآمنة (§7 وما بعده) تستدعيها من داخل SECURITY DEFINER، فلا
--     تحتاج إلى منح للمستدعي.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.sq_settings where key = p_key), p_default);
$$;

create or replace function public.sq_setting_json(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.sq_settings where key = p_key), '{}'::jsonb);
$$;

create or replace function public.sq_round2(p numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p is null then null else round(p, 2) end;
$$;

-- ★ كاسر العكس الحسابيّ ★ التدوير لأعلى إلى مضاعف الخطوة. من يعرف السعر
--   ونسبة الهامش لا يستخرج التكلفة بل مجالًا بعرض الخطوة كاملة.
create or replace function public.sq_quantize_up(p numeric, p_step numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p is null then null
    when p_step is null or p_step <= 0 then round(p, 2)
    else round(ceil(p / p_step) * p_step, 2)
  end;
$$;

create or replace function public.sq_quantize_down(p numeric, p_step numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p is null then null
    when p_step is null or p_step <= 0 then round(p, 2)
    else round(floor(p / p_step) * p_step, 2)
  end;
$$;

-- الضريبة تُحسب ولا تُطوى: حقلها مستقلّ في كلّ جدول وفي كلّ دالّة.
create or replace function public.sq_vat(p_net numeric, p_rate numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_net is null then null else round(p_net * coalesce(p_rate, 0), 2) end;
$$;

create or replace function public.sq_next_quote_code()
returns text language sql volatile security definer set search_path = public as $$
  select 'Q-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.sq_quote_code_seq')::text, 5, '0');
$$;

create or replace function public.sq_next_price_book_code()
returns text language sql volatile security definer set search_path = public as $$
  select 'PB-' || lpad(nextval('public.sq_price_book_code_seq')::text, 4, '0');
$$;

-- التدقيق لا يُسقط عمليّة: فشل الكتابة في السجلّ لا يجوز أن يُلغي قرارًا صحيحًا.
create or replace function public.sq_log(
  p_action text, p_entity text, p_entity_id uuid, p_quote uuid, p_payload jsonb
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.sq_audit (actor, action, entity, entity_id, quote_id, payload)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_quote, coalesce(p_payload, '{}'::jsonb));
exception when others then
  return;
end $$;

-- إشعار مكتشَف. غياب جدول الإشعارات لا يُسقط شيئًا، ولا يُدّعى إرسال بريد.
create or replace function public.sq_notify(p_user uuid, p_type text, p_title text, p_body text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_user is null or to_regclass('public.notifications') is null then return; end if;
  execute 'insert into public.notifications (user_id, type, title, body) values ($1,$2,$3,$4)'
    using p_user, p_type, p_title, p_body;
exception when others then
  return;
end $$;

create or replace function public.sq_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- من يرى هذا العرض؟ **سطح بيع فقط** — لا علاقة لهذه الدالّة بالتكلفة.
--   المالك: الكلّ · حامل quote.view: الكلّ (لا تكلفة في السطح فلا خطر)
--   بانِ العروض بلا quote.view: عروضه هو فقط.
create or replace function public.sq_quote_visible(p_quote uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_creator uuid;
begin
  if p_quote is null or auth.uid() is null then return false; end if;
  if not coalesce(public.is_staff(), false) then return false; end if;
  if coalesce(public.sq_is_owner_role(), false) then return true; end if;
  if coalesce(public.sq_perm('quote.view'), false) then return true; end if;
  select created_by into v_creator from public.sq_quotes where id = p_quote;
  return coalesce(v_creator = auth.uid(), false);
end $$;

-- ★ صلاحية خصم الموظّف — سياسة معلنة، لا مشتقّة من الأرضية ★
--   لو حُسبت من min_price لكان `السعر × (١ − الصلاحية)` = الأرضية بالضبط،
--   ولكشفتها لكلّ من يعرف صلاحيته. القيم من سُلّم ثابت في sq_settings.
--   لا يظهر في جسم هذه الدالّة أيّ رمز تكلفة — والـSELF-TEST يتحقّق.
create or replace function public.sq_my_discount_allowance() returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_ladder jsonb; v_out numeric := 0;
begin
  if not coalesce(public.sq_can_view(), false) then return 0; end if;
  v_ladder := public.sq_setting_json('discount_allowance');
  v_out := coalesce((v_ladder ->> 'default')::numeric, 0);
  if coalesce(public.sq_perm('quote.discount_l1'), false) then
    v_out := greatest(v_out, coalesce((v_ladder ->> 'quote.discount_l1')::numeric, 0));
  end if;
  if coalesce(public.sq_perm('quote.discount_l2'), false) then
    v_out := greatest(v_out, coalesce((v_ladder ->> 'quote.discount_l2')::numeric, 0));
  end if;
  -- المالك يقترح ما يشاء: هو المعتمِد أصلًا، فحدّ الاقتراح بلا معنى له.
  if coalesce(public.sq_is_owner_role(), false) then v_out := 1; end if;
  return coalesce(v_out, 0);
exception when others then
  return 0;
end $$;

-- ★ أمانة الحالة ★ sent_placeholder لا تعني أنّ رسالة غادرت.
create or replace function public.sq_quote_status_label(p_status text) returns text
language sql immutable set search_path = public as $$
  select case p_status
    when 'draft'                  then 'مسودّة'
    when 'internal_review'        then 'مراجعة داخلية'
    when 'pending_owner_approval' then 'بانتظار اعتماد المالك'
    when 'approved'               then 'معتمد'
    -- ★ لا كلمة «أُرسل» ★ لم يُثبت مزوّدٌ تسليمًا، فلا يُقال إنّه أُرسل.
    when 'sent_placeholder'       then 'معتمد وجاهز للإرسال اليدوي'
    when 'accepted'               then 'مقبول من العميل'
    when 'rejected'               then 'مرفوض من العميل'
    when 'expired'                then 'منتهي الصلاحية'
    when 'superseded'             then 'مُستبدَل بنسخة أحدث'
    else coalesce(p_status, 'غير معروف')
  end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) المُشغّلات.
--
--     ★ حارس التحسّس ★ (sq_floor_probe_guard) هو أدقّ ما في هذا القسم.
--     المشكلة: الموظّف لا يرى الأرضية، لكنّه يستطيع أن يقترح سعرًا بعد سعر
--     ويقرأ قرار المالك، فيبحث ثنائيًّا عن الأرضية عبر قناة بشرية لا نملك
--     إغلاقها بنيويًّا. ما نملكه: **الكشف**.
--
--     ولذلك هذا المُشغّل:
--       · يعدّ المحاولات تحت الأرضية في جدول لا يراه إلا المالك،
--       · ★ ولا يرفع استثناءً أبدًا ★. لو رفع لصار هو نفسه العرّاف المطلوب
--         إغلاقه: «رُفض» عند سعر و«قُبل» عند آخر = الأرضية في محاولتين.
--       · ولا يعيد شيئًا إلى المستدعي. المعلومة تسير في اتجاه واحد: إلى المالك.
-- ════════════════════════════════════════════════════════════════════════════

do $trg$
declare t text;
begin
  foreach t in array array[
    'sq_settings','sq_service_catalog','sq_price_books','sq_price_book_versions',
    'sq_price_book_entries','sq_cost_rates','sq_pricing_rules','sq_quotes',
    'sq_quote_inputs','sq_quote_lines'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.sq_touch()',
      t || '_touch', t);
  end loop;
end $trg$;

-- نسخة منشورة من دفتر الأسعار لا تُعدَّل. هذا **جوهر الإصدارات**: عرضٌ صدر
-- في مارس يجب أن يظلّ مفسَّرًا بأسعار مارس، وإلّا صار تدقيق الربحية بلا معنى.
create or replace function public.sq_pbv_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'published' then
    -- الانتقال الوحيد المسموح: published → superseded (وتوقيت الاستبدال).
    if new.status = 'superseded' then return new; end if;
    if new.status is distinct from old.status
       or new.price_book_id is distinct from old.price_book_id
       or new.version_no    is distinct from old.version_no
       or new.effective_from is distinct from old.effective_from
       or new.effective_to   is distinct from old.effective_to then
      raise exception 'نسخة دفتر أسعار منشورة لا تُعدَّل — افتح نسخة جديدة (sq_price_book_version_open)';
    end if;
  end if;
  return new;
end $$;

create trigger sq_pbv_immutable_trg
  before update on public.sq_price_book_versions
  for each row execute function public.sq_pbv_immutable();

-- بنود نسخة منشورة (بيعًا وتكلفةً) مجمّدة كذلك — وإلّا لصار التجميد شكليًّا.
create or replace function public.sq_pb_entry_frozen() returns trigger
language plpgsql set search_path = public as $$
declare v_status text; v_version uuid;
begin
  v_version := coalesce(new.version_id, old.version_id);
  select status into v_status from public.sq_price_book_versions where id = v_version;
  if v_status = 'published' then
    raise exception 'بنود نسخة منشورة مجمّدة — افتح نسخة جديدة قبل التعديل';
  end if;
  return coalesce(new, old);
end $$;

create trigger sq_pbe_frozen_trg
  before insert or update or delete on public.sq_price_book_entries
  for each row execute function public.sq_pb_entry_frozen();

create trigger sq_cost_rates_frozen_trg
  before insert or update or delete on public.sq_cost_rates
  for each row execute function public.sq_pb_entry_frozen();

-- ★ حارس التحسّس — يعدّ ولا ينطق ★
create or replace function public.sq_floor_probe_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_floor numeric; v_probe numeric;
begin
  select min_price into v_floor from public.sq_quote_internal where quote_id = new.id;
  if v_floor is null then return null; end if;
  v_probe := coalesce(new.gross_before_vat, new.authorized_price, new.proposed_price);
  if v_probe is null then return null; end if;

  update public.sq_quote_internal
     set below_floor = (v_probe < v_floor),
         floor_probe_count = floor_probe_count
           + case when v_probe < v_floor and not coalesce(public.sq_can_view_cost(), false)
                  then 1 else 0 end
   where quote_id = new.id;
  return null;
exception when others then
  -- الصمت مقصود: أيّ خطأ هنا لا يجوز أن يصل إلى المستدعي، وإلّا صار وجود
  -- الأرضية نفسه قابلًا للاستنتاج من فشل عمليّة.
  return null;
end $$;

create trigger sq_floor_probe_trg
  after update on public.sq_quotes
  for each row
  when (new.proposed_price is distinct from old.proposed_price
     or new.authorized_price is distinct from old.authorized_price
     or new.gross_before_vat is distinct from old.gross_before_vat)
  execute function public.sq_floor_probe_guard();

-- ★ ختم الأرضية على طلب الاعتماد ★
--   المالك يجب أن يقرّر وهو يرى الأرضية وقت الطلب. لكنّ قراءتها من داخل
--   sq_quote_submit — وهي دالّة يستدعيها موظّف المبيعات — تُدخل رمز تكلفة في
--   سطح البيع. المُشغّل يفصل الأمرين: يكتب للمالك، ولا يعيد شيئًا للمستدعي،
--   ولا يرفع استثناءً (استثناءٌ هنا يكشف وجود الأرضية بفشل العمليّة).
create or replace function public.sq_approval_stamp_floor() returns trigger
language plpgsql set search_path = public as $$
declare v_floor numeric;
begin
  select min_price into v_floor from public.sq_quote_internal where quote_id = new.quote_id;
  update public.sq_approval_requests
     set floor_at_request = v_floor,
         internal_reason_code = case
           when v_floor is null then 'not_costed'
           when coalesce(new.requested_price, 0) < v_floor then 'below_floor'
           else 'within_floor' end
   where id = new.id;
  return null;
exception when others then
  return null;
end $$;

create trigger sq_approval_stamp_floor_trg
  after insert on public.sq_approval_requests
  for each row execute function public.sq_approval_stamp_floor();

-- ★ بذر نسخة دفتر الأسعار الجديدة من آخر نسخة منشورة ★
--   ينسخ بنود البيع **وأسعار التكلفة** معًا كي تبقى النسخة قابلة للتسعير.
--   في مُشغّل لا في دالّة: مدير الكتالوج يتسبّب في النسخ ولا يرى قيمة تكلفة،
--   ودالّته تبقى خالية من رموز التكلفة.
create or replace function public.sq_pbv_seed() returns trigger
language plpgsql set search_path = public as $$
declare v_prev uuid;
begin
  select id into v_prev from public.sq_price_book_versions
   where price_book_id = new.price_book_id and status = 'published' and id <> new.id
   order by version_no desc limit 1;
  if v_prev is null then return null; end if;

  insert into public.sq_price_book_entries (version_id, catalog_id, tier, sell_rate, min_qty, uom)
  select new.id, e.catalog_id, e.tier, e.sell_rate, e.min_qty, e.uom
    from public.sq_price_book_entries e where e.version_id = v_prev;

  insert into public.sq_cost_rates (version_id, catalog_id, tier, cost_rate, supplier_rate, crew_rate, supplier_name, notes)
  select new.id, c.catalog_id, c.tier, c.cost_rate, c.supplier_rate, c.crew_rate, c.supplier_name, c.notes
    from public.sq_cost_rates c where c.version_id = v_prev;

  return null;
end $$;

create trigger sq_pbv_seed_trg
  after insert on public.sq_price_book_versions
  for each row execute function public.sq_pbv_seed();

-- ════════════════════════════════════════════════════════════════════════════
-- §6) RLS — دفاع في العمق، لا خطّ الدفاع الأوّل.
--
--     خطّ الدفاع الأوّل أنّ **لا جدول من هذه الجداول ممنوح لـauthenticated**
--     إطلاقًا (§13). كلّ قراءة تمرّ بدالّة SECURITY DEFINER بقائمة أعمدة
--     مكتوبة بأيدينا، فلا يستطيع PostgREST أن يطلب عمودًا لم نكتبه.
--
--     ومع ذلك نُفعّل RLS ونكتب السياسات: لو مُنح جدولٌ يومًا سهوًا، تبقى
--     الطبقة الثانية قائمة. سياسات القراءة فقط — لا سياسة إدراج ولا تعديل ولا
--     حذف، فالكتابة المباشرة ممنوعة بالتصميم (RLS بلا سياسة = منع).
--
--     ★ التقسيم الحاسم ★
--       جداول التكلفة الستّة  → sq_can_view_cost()  (المالك حرفيًّا، بلا مفتاح)
--       جداول البيع الثمانية → sq_can_view()        (موظّف + مفتاح)
--     لا جدول يقبل الشرطين معًا، ولا سياسة تفتح بشرط ملكية auth.uid()
--     على جدول تكلفة — شرط الملكية يعني أنّ مُنشئ الصفّ يقرأ تكلفته.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array[
    'sq_settings','sq_service_catalog','sq_price_books','sq_price_book_versions',
    'sq_price_book_entries','sq_cost_rates','sq_pricing_rules','sq_quotes',
    'sq_quote_internal','sq_quote_inputs','sq_quote_lines','sq_quote_milestones',
    'sq_approval_requests','sq_audit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- ★ جداول التكلفة — المالك وحده ★
  foreach t in array array[
    'sq_settings','sq_cost_rates','sq_pricing_rules','sq_quote_internal',
    'sq_approval_requests','sq_audit'
  ] loop
    execute format(
      'create policy %I on public.%I for select using (public.sq_can_view_cost())',
      t || '_read', t);
  end loop;

  -- جداول سطح البيع — موظّف مُخوَّل
  foreach t in array array[
    'sq_service_catalog','sq_price_books','sq_price_book_versions',
    'sq_price_book_entries','sq_quotes','sq_quote_inputs','sq_quote_lines',
    'sq_quote_milestones'
  ] loop
    execute format(
      'create policy %I on public.%I for select using (public.sq_can_view())',
      t || '_read', t);
  end loop;
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) محرّك التسعير — ★ المالك وحده ★
--
--     كلّ دالّة هنا تبدأ بـ sq_can_view_cost() وترفع 'not authorized' صراحةً.
--     ليست «تُخفي أعمدة»: من ليس مالكًا لا يصل إلى السطر الأوّل منها.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_pricing_rule_upsert(
  p_rule_code text, p_kind text, p_value numeric,
  p_tier text default null, p_condition_key text default null,
  p_label_ar text default null, p_sort int default 100, p_notes text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  if p_rule_code is null or p_kind is null or p_value is null then
    raise exception 'rule_code و kind و value مطلوبة';
  end if;

  insert into public.sq_pricing_rules (rule_code, kind, tier, condition_key, value, label_ar, sort_order, notes, updated_by)
  values (p_rule_code, p_kind, p_tier, p_condition_key, p_value, p_label_ar, coalesce(p_sort,100), p_notes, auth.uid())
  on conflict (rule_code) do update set
    kind = excluded.kind, tier = excluded.tier, condition_key = excluded.condition_key,
    value = excluded.value, label_ar = excluded.label_ar, sort_order = excluded.sort_order,
    notes = excluded.notes, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;

  perform public.sq_log('pricing_rule_upsert', 'sq_pricing_rules', v_id, null,
    jsonb_build_object('rule_code', p_rule_code, 'kind', p_kind, 'value', p_value, 'tier', p_tier));
  return v_id;
end $$;

create or replace function public.sq_pricing_rule_set_active(p_id uuid, p_active boolean)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  update public.sq_pricing_rules set is_active = coalesce(p_active, false), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  if not found then raise exception 'rule not found'; end if;
  perform public.sq_log('pricing_rule_active', 'sq_pricing_rules', p_id, null,
    jsonb_build_object('is_active', p_active));
  return true;
end $$;

create or replace function public.sq_pricing_rules_list()
returns table (
  id uuid, rule_code text, kind text, tier text, condition_key text,
  value numeric, is_active boolean, sort_order int, label_ar text, notes text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  return query
    select r.id, r.rule_code, r.kind, r.tier, r.condition_key,
           r.value, r.is_active, r.sort_order, r.label_ar, r.notes
      from public.sq_pricing_rules r
     order by r.kind, r.sort_order, r.rule_code;
end $$;

create or replace function public.sq_cost_rate_set(
  p_version uuid, p_catalog uuid, p_tier text,
  p_cost_rate numeric, p_supplier_rate numeric default null,
  p_crew_rate numeric default null, p_supplier_name text default null, p_notes text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;

  insert into public.sq_cost_rates (version_id, catalog_id, tier, cost_rate, supplier_rate, crew_rate, supplier_name, notes)
  values (p_version, p_catalog, p_tier, coalesce(p_cost_rate,0), p_supplier_rate, p_crew_rate, p_supplier_name, p_notes)
  on conflict (version_id, catalog_id, tier) do update set
    cost_rate = excluded.cost_rate, supplier_rate = excluded.supplier_rate,
    crew_rate = excluded.crew_rate, supplier_name = excluded.supplier_name,
    notes = excluded.notes, updated_at = now()
  returning id into v_id;

  perform public.sq_log('cost_rate_set', 'sq_cost_rates', v_id, null,
    jsonb_build_object('version_id', p_version, 'catalog_id', p_catalog, 'tier', p_tier));
  return v_id;
end $$;

create or replace function public.sq_cost_rates_list(p_version uuid)
returns table (
  id uuid, catalog_id uuid, code text, name_ar text, tier text,
  cost_rate numeric, supplier_rate numeric, crew_rate numeric, supplier_name text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  return query
    select cr.id, cr.catalog_id, c.code, c.name_ar, cr.tier,
           cr.cost_rate, cr.supplier_rate, cr.crew_rate, cr.supplier_name
      from public.sq_cost_rates cr
      join public.sq_service_catalog c on c.id = cr.catalog_id
     where cr.version_id = p_version
     order by c.sort_order, c.code, cr.tier;
end $$;

create or replace function public.sq_quote_supplier_cost_set(
  p_quote uuid, p_amount numeric, p_contingency_pct numeric default null
) returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;

  insert into public.sq_quote_internal (quote_id, external_supplier_cost, contingency_pct)
  values (p_quote, coalesce(p_amount,0), coalesce(p_contingency_pct, 0))
  on conflict (quote_id) do update set
    external_supplier_cost = coalesce(p_amount, 0),
    contingency_pct = coalesce(p_contingency_pct, public.sq_quote_internal.contingency_pct);

  perform public.sq_log('supplier_cost_set', 'sq_quote_internal', null, p_quote,
    jsonb_build_object('amount', p_amount));
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ المعادلة الداخلية — قلب الموديول، وللمالك وحده ★★
--
--   التكلفة الأساسية = Σ (كمّية البند × تكلفة وحدته في النسخة المجمَّدة)
--                     + تكلفة المورّد الخارجيّ
--   رسوم الظروف     = التكلفة الأساسية × Σ (قواعد cost_surcharge_pct المطابقة)
--   الطوارئ         = (الأساسية + الظروف) × نسبة الطوارئ
--   التقدير الداخليّ = الأساسية + الظروف + الطوارئ
--
--   السعر المقترَح  = تكميم↑( التقدير ÷ (١ − الهامش المستهدف) )
--   الأرضية         = تكميم↑( التقدير ÷ (١ − أدنى هامش مقبول) )
--
--   ★ الأمانة قبل الاكتمال ★ بندٌ بلا سعر تكلفة في النسخة المجمَّدة **لا
--     يُحتسب صفرًا بصمت**. يُعدّ في uncosted_lines ويظهر للمالك، لأنّ تكلفة
--     ناقصة تُقرأ كهامش عالٍ — وهي كذبة يتصرّف المالك بناءً عليها.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.sq_quote_recompute(p_quote uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_tier text; v_pbv uuid; v_status text;
  v_base numeric := 0; v_uncosted int := 0; v_lines int := 0;
  v_ext numeric := 0; v_cont_pct numeric; v_over_pct numeric;
  v_sur_pct numeric := 0; v_sur numeric := 0;
  v_cont numeric := 0; v_cost numeric := 0;
  v_target numeric; v_min numeric; v_quantum numeric;
  v_rec numeric; v_floor numeric; v_list numeric := 0;
  v_gross numeric; v_auth numeric; v_prop numeric;
  v_gp numeric; v_mpct numeric; v_net numeric;
  v_conds text[] := '{}';
  i record;
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;

  select q.tier, q.price_book_version_id, q.status
    into v_tier, v_pbv, v_status
    from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_pbv is null then
    raise exception 'لا يمكن التسعير قبل تثبيت نسخة دفتر أسعار على العرض';
  end if;
  if v_status in ('superseded','expired') then
    raise exception 'عرض % لا يُعاد تسعيره', public.sq_quote_status_label(v_status);
  end if;

  select qi.shooting_days, qi.weekend_work, qi.night_work, qi.delivery_speed,
         qi.travel_required, qi.permits_required, qi.fpv_drone, qi.drone,
         qi.live_streaming, qi.equipment_rental_required
    into i
    from public.sq_quote_inputs qi where qi.quote_id = p_quote;

  if found then
    if i.weekend_work              then v_conds := v_conds || 'weekend'; end if;
    if i.night_work                then v_conds := v_conds || 'night'; end if;
    if i.delivery_speed = 'rush'   then v_conds := v_conds || 'rush'; end if;
    if i.delivery_speed = 'express' then v_conds := v_conds || 'express'; end if;
    if i.travel_required           then v_conds := v_conds || 'travel'; end if;
    if i.permits_required          then v_conds := v_conds || 'permits'; end if;
    if i.fpv_drone                 then v_conds := v_conds || 'fpv'; end if;
    if i.drone                     then v_conds := v_conds || 'drone'; end if;
    if i.live_streaming            then v_conds := v_conds || 'live_stream'; end if;
    if i.equipment_rental_required then v_conds := v_conds || 'equipment_rental'; end if;
  end if;

  -- التكلفة من النسخة **المجمَّدة على العرض**، لا من أحدث نسخة: عرضٌ قديم
  -- يبقى مفسَّرًا بأسعار وقته.
  select coalesce(sum(round(l.qty * cr.cost_rate, 2)), 0),
         count(*) filter (where cr.cost_rate is null),
         count(*),
         coalesce(sum(l.line_total), 0)
    into v_base, v_uncosted, v_lines, v_list
    from public.sq_quote_lines l
    left join public.sq_cost_rates cr
      on cr.version_id = v_pbv and cr.catalog_id = l.catalog_id and cr.tier = v_tier
   where l.quote_id = p_quote;

  select coalesce(qint.external_supplier_cost, 0), qint.contingency_pct
    into v_ext, v_cont_pct
    from public.sq_quote_internal qint where qint.quote_id = p_quote;
  v_ext := coalesce(v_ext, 0);
  v_base := coalesce(v_base, 0) + v_ext;

  select coalesce(sum(r.value), 0) into v_sur_pct
    from public.sq_pricing_rules r
   where r.is_active and r.kind = 'cost_surcharge_pct'
     and (r.tier is null or r.tier = v_tier)
     and r.condition_key = any(v_conds);
  v_sur := round(v_base * coalesce(v_sur_pct, 0), 2);

  if coalesce(v_cont_pct, 0) = 0 then
    select r.value into v_cont_pct from public.sq_pricing_rules r
     where r.is_active and r.kind = 'contingency_pct' and (r.tier is null or r.tier = v_tier)
     order by (r.tier is null), r.sort_order limit 1;
    v_cont_pct := coalesce(v_cont_pct, public.sq_setting_num('default_contingency_pct', 0.07));
  end if;
  v_cont := round((v_base + v_sur) * v_cont_pct, 2);
  v_cost := round(v_base + v_sur + v_cont, 2);

  select r.value into v_target from public.sq_pricing_rules r
   where r.is_active and r.kind = 'target_margin_pct' and (r.tier is null or r.tier = v_tier)
   order by (r.tier is null), r.sort_order limit 1;
  v_target := coalesce(v_target, 0.35);

  select r.value into v_min from public.sq_pricing_rules r
   where r.is_active and r.kind = 'min_margin_pct' and (r.tier is null or r.tier = v_tier)
   order by (r.tier is null), r.sort_order limit 1;
  v_min := coalesce(v_min, 0.15);

  if v_target >= 1 or v_target < 0 then raise exception 'الهامش المستهدف خارج المجال [0,1)'; end if;
  if v_min    >= 1 or v_min    < 0 then raise exception 'أدنى هامش خارج المجال [0,1)'; end if;
  if v_min > v_target then
    raise exception 'أدنى هامش (%) أعلى من الهامش المستهدف (%) — الأرضية ستتجاوز المقترَح', v_min, v_target;
  end if;

  v_quantum := public.sq_setting_num('sell_quantum', 500);
  v_rec   := public.sq_quantize_up(v_cost / (1 - v_target), v_quantum);
  v_floor := public.sq_quantize_up(v_cost / (1 - v_min),    v_quantum);

  -- الأساس الذي يُقاس عليه الهامش: المعتمَد إن وُجد، وإلّا المقترَح، وإلّا
  -- مجموع البنود. لا يُخترع صفر: عرضٌ بلا رقم بيع واحد يُنتج هوامش NULL.
  select q.gross_before_vat, q.authorized_price, q.proposed_price
    into v_gross, v_auth, v_prop from public.sq_quotes q where q.id = p_quote;
  v_gross := coalesce(v_gross, v_auth, v_prop, nullif(v_list, 0));

  v_gp   := case when v_gross is null then null else round(v_gross - v_cost, 2) end;
  v_mpct := case when coalesce(v_gross,0) > 0 then round(v_gp / v_gross, 4) else null end;

  select r.value into v_over_pct from public.sq_pricing_rules r
   where r.is_active and r.kind = 'overhead_alloc_pct' and (r.tier is null or r.tier = v_tier)
   order by (r.tier is null), r.sort_order limit 1;
  v_over_pct := coalesce(v_over_pct, public.sq_setting_num('default_overhead_pct', 0.12));
  v_net := case when v_gp is null then null else round(v_gp - coalesce(v_gross,0) * v_over_pct, 2) end;

  insert into public.sq_quote_internal (
    quote_id, base_cost, surcharge_cost, contingency_pct, contingency_amount,
    external_supplier_cost, internal_cost_estimate, target_margin_pct, min_margin_pct,
    recommended_price, min_price, gross_profit, margin_pct, overhead_alloc_pct,
    est_net_profit, below_floor, cost_breakdown, formula_snapshot, computed_at, computed_by
  ) values (
    p_quote, round(v_base - v_ext, 2), v_sur, v_cont_pct, v_cont,
    v_ext, v_cost, v_target, v_min,
    v_rec, v_floor, v_gp, v_mpct, v_over_pct,
    v_net, coalesce(v_gross < v_floor, false),
    jsonb_build_object(
      'base_from_lines', round(v_base - v_ext, 2), 'external_supplier', v_ext,
      'surcharge_pct', v_sur_pct, 'surcharge', v_sur,
      'contingency_pct', v_cont_pct, 'contingency', v_cont,
      'conditions', to_jsonb(v_conds),
      'total_lines', v_lines, 'uncosted_lines', v_uncosted,
      'cost_complete', (v_uncosted = 0)),
    jsonb_build_object(
      'formula', 'cost = (Σ qty×cost_rate + external) × (1+surcharge) × (1+contingency); '
              || 'recommended = ceil(cost/(1−target)/quantum)×quantum; '
              || 'floor = ceil(cost/(1−min)/quantum)×quantum',
      'target_margin_pct', v_target, 'min_margin_pct', v_min,
      'sell_quantum', v_quantum, 'price_book_version', v_pbv, 'tier', v_tier),
    now(), auth.uid()
  )
  on conflict (quote_id) do update set
    base_cost = excluded.base_cost, surcharge_cost = excluded.surcharge_cost,
    contingency_pct = excluded.contingency_pct, contingency_amount = excluded.contingency_amount,
    internal_cost_estimate = excluded.internal_cost_estimate,
    target_margin_pct = excluded.target_margin_pct, min_margin_pct = excluded.min_margin_pct,
    recommended_price = excluded.recommended_price, min_price = excluded.min_price,
    gross_profit = excluded.gross_profit, margin_pct = excluded.margin_pct,
    overhead_alloc_pct = excluded.overhead_alloc_pct, est_net_profit = excluded.est_net_profit,
    below_floor = excluded.below_floor, cost_breakdown = excluded.cost_breakdown,
    formula_snapshot = excluded.formula_snapshot, computed_at = now(), computed_by = auth.uid();

  -- سطح البيع لا يتلقّى من هذا كلّه إلا مجموع بنوده — وهو رقم يجمعه بنفسه.
  update public.sq_quotes set list_price = v_list, updated_at = now() where id = p_quote;

  perform public.sq_log('recompute', 'sq_quote_internal', null, p_quote,
    jsonb_build_object('cost', v_cost, 'recommended', v_rec, 'uncosted_lines', v_uncosted));

  return jsonb_build_object(
    'quote_id', p_quote, 'internal_cost_estimate', v_cost,
    'recommended_price', v_rec, 'min_price', v_floor,
    'target_margin_pct', v_target, 'min_margin_pct', v_min,
    'gross_profit', v_gp, 'margin_pct', v_mpct, 'est_net_profit', v_net,
    'list_price', v_list, 'uncosted_lines', v_uncosted,
    'cost_complete', (v_uncosted = 0));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) الكتالوج ودفتر الأسعار — سطح بيع.
--
--     ★ الإصدارات ليست ترفًا ★ العرض يتجمّد على price_book_version_id، فيبقى
--     مفسَّرًا بأسعار وقته مهما تغيّرت الأسعار لاحقًا. بلا ذلك يصبح تدقيق
--     ربحية عرضٍ قديم مستحيلًا: تقرأ تكلفة اليوم مقابل سعر الأمس.
--
--     ⚠️ فتح نسخة جديدة ينسخ بنود البيع **وأسعار التكلفة** معًا كي تبقى
--     النسخة قابلة للتسعير. النسخ يجري داخل SECURITY DEFINER ولا يعيد قيمة
--     تكلفة واحدة إلى المستدعي: مدير الكتالوج يتسبّب في نسخها ولا يراها.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_tiers()
returns table (code text, label_ar text, label_en text, sort_order int)
language sql stable security definer set search_path = public as $$
  select t.code, t.label_ar, t.label_en, t.sort_order from (values
    ('basic',            'أساسي',   'Basic',            1),
    ('professional',     'احترافي', 'Professional',     2),
    ('cinematic',        'سينمائي', 'Cinematic',        3),
    ('enterprise_custom','مؤسّسي مخصّص','Enterprise (custom)', 4)
  ) as t(code, label_ar, label_en, sort_order);
$$;

create or replace function public.sq_catalog_item_upsert(
  p_code text, p_name_ar text, p_name_en text,
  p_category text default 'production', p_uom_ar text default 'وحدة',
  p_uom_en text default 'unit', p_sort int default 100, p_notes text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  if p_code is null or p_name_ar is null then raise exception 'الرمز والاسم العربي مطلوبان'; end if;

  insert into public.sq_service_catalog (code, name_ar, name_en, category, uom_ar, uom_en, sort_order, notes, created_by)
  values (p_code, p_name_ar, coalesce(p_name_en, p_name_ar), coalesce(p_category,'production'),
          coalesce(p_uom_ar,'وحدة'), coalesce(p_uom_en,'unit'), coalesce(p_sort,100), p_notes, auth.uid())
  on conflict (code) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en, category = excluded.category,
    uom_ar = excluded.uom_ar, uom_en = excluded.uom_en, sort_order = excluded.sort_order,
    notes = excluded.notes, updated_at = now()
  returning id into v_id;

  perform public.sq_log('catalog_upsert', 'sq_service_catalog', v_id, null,
    jsonb_build_object('code', p_code));
  return v_id;
end $$;

create or replace function public.sq_catalog_item_set_active(p_id uuid, p_active boolean)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  update public.sq_service_catalog set is_active = coalesce(p_active, false), updated_at = now() where id = p_id;
  if not found then raise exception 'catalog item not found'; end if;
  perform public.sq_log('catalog_active', 'sq_service_catalog', p_id, null, jsonb_build_object('is_active', p_active));
  return true;
end $$;

create or replace function public.sq_catalog_list(p_include_inactive boolean default false)
returns table (
  id uuid, code text, name_ar text, name_en text, category text,
  uom_ar text, uom_en text, is_active boolean, sort_order int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select c.id, c.code, c.name_ar, c.name_en, c.category,
           c.uom_ar, c.uom_en, c.is_active, c.sort_order
      from public.sq_service_catalog c
     where coalesce(p_include_inactive, false) or c.is_active
     order by c.sort_order, c.code;
end $$;

create or replace function public.sq_price_book_upsert(
  p_id uuid, p_name_ar text, p_name_en text, p_notes text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  if p_name_ar is null then raise exception 'الاسم العربي مطلوب'; end if;

  if p_id is null then
    insert into public.sq_price_books (code, name_ar, name_en, notes, created_by)
    values (public.sq_next_price_book_code(), p_name_ar, coalesce(p_name_en, p_name_ar), p_notes, auth.uid())
    returning id into v_id;
  else
    update public.sq_price_books
       set name_ar = p_name_ar, name_en = coalesce(p_name_en, p_name_ar), notes = p_notes, updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'price book not found'; end if;
  end if;

  perform public.sq_log('price_book_upsert', 'sq_price_books', v_id, null, jsonb_build_object('name', p_name_ar));
  return v_id;
end $$;

create or replace function public.sq_price_books_list()
returns table (
  id uuid, code text, name_ar text, name_en text, status text,
  currency text, versions int, published_versions int, latest_version int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select b.id, b.code, b.name_ar, b.name_en, b.status, b.currency,
           count(v.id)::int,
           count(v.id) filter (where v.status = 'published')::int,
           coalesce(max(v.version_no), 0)::int
      from public.sq_price_books b
      left join public.sq_price_book_versions v on v.price_book_id = b.id
     group by b.id, b.code, b.name_ar, b.name_en, b.status, b.currency
     order by b.code;
end $$;

create or replace function public.sq_price_book_versions_list(p_book uuid)
returns table (
  id uuid, version_no int, status text, effective_from date, effective_to date,
  published_at timestamptz, entries int, notes text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select v.id, v.version_no, v.status, v.effective_from, v.effective_to,
           v.published_at, count(e.id)::int, v.notes
      from public.sq_price_book_versions v
      left join public.sq_price_book_entries e on e.version_id = v.id
     where v.price_book_id = p_book
     group by v.id, v.version_no, v.status, v.effective_from, v.effective_to, v.published_at, v.notes
     order by v.version_no desc;
end $$;

create or replace function public.sq_price_book_version_open(
  p_book uuid, p_effective_from date default null, p_notes text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_new uuid; v_prev uuid; v_no int;
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  if to_regclass('public.sq_price_books') is null then raise exception 'price book table missing'; end if;
  if not exists (select 1 from public.sq_price_books where id = p_book) then
    raise exception 'price book not found';
  end if;
  if exists (select 1 from public.sq_price_book_versions where price_book_id = p_book and status = 'draft') then
    raise exception 'يوجد نسخة مسودّة مفتوحة لهذا الدفتر — انشرها أو احذفها قبل فتح نسخة جديدة';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no
    from public.sq_price_book_versions where price_book_id = p_book;

  select id into v_prev from public.sq_price_book_versions
   where price_book_id = p_book and status = 'published'
   order by version_no desc limit 1;

  -- ★ النسخ من النسخة المنشورة السابقة يجري في مُشغّل (sq_pbv_seed) لا هنا ★
  --   لأنّ النسخ يشمل أسعار التكلفة، وقراءتها من داخل دالّة يستدعيها مدير
  --   الكتالوج تكسر قاعدة «لا دالّة سطح بيع تذكر رمز تكلفة». المُشغّل ينسخ
  --   بعد الإدراج ولا يعيد قيمة واحدة إلى المستدعي.
  insert into public.sq_price_book_versions (price_book_id, version_no, status, effective_from, notes, created_by)
  values (p_book, v_no, 'draft', p_effective_from, p_notes, auth.uid())
  returning id into v_new;

  perform public.sq_log('price_book_version_open', 'sq_price_book_versions', v_new, null,
    jsonb_build_object('book', p_book, 'version_no', v_no, 'copied_from', v_prev));
  return v_new;
end $$;

create or replace function public.sq_price_book_entry_set(
  p_version uuid, p_catalog uuid, p_tier text,
  p_sell_rate numeric, p_min_qty numeric default 0, p_uom text default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  if coalesce(p_sell_rate, -1) < 0 then raise exception 'سعر البيع لا يكون سالبًا'; end if;

  insert into public.sq_price_book_entries (version_id, catalog_id, tier, sell_rate, min_qty, uom)
  values (p_version, p_catalog, p_tier, p_sell_rate, coalesce(p_min_qty,0), p_uom)
  on conflict (version_id, catalog_id, tier) do update set
    sell_rate = excluded.sell_rate, min_qty = excluded.min_qty,
    uom = excluded.uom, updated_at = now()
  returning id into v_id;

  perform public.sq_log('price_book_entry_set', 'sq_price_book_entries', v_id, null,
    jsonb_build_object('version', p_version, 'tier', p_tier, 'sell_rate', p_sell_rate));
  return v_id;
end $$;

create or replace function public.sq_price_book_entries_list(p_version uuid)
returns table (
  id uuid, catalog_id uuid, code text, name_ar text, tier text,
  sell_rate numeric, min_qty numeric, uom text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select e.id, e.catalog_id, c.code, c.name_ar, e.tier,
           e.sell_rate, e.min_qty, coalesce(e.uom, c.uom_ar)
      from public.sq_price_book_entries e
      join public.sq_service_catalog c on c.id = e.catalog_id
     where e.version_id = p_version
     order by c.sort_order, c.code, e.tier;
end $$;

create or replace function public.sq_price_book_version_publish(p_version uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_book uuid; v_status text; v_entries int;
begin
  if not coalesce(public.sq_can_manage_catalog(), false) then raise exception 'not authorized'; end if;
  select price_book_id, status into v_book, v_status
    from public.sq_price_book_versions where id = p_version;
  if not found then raise exception 'version not found'; end if;
  if v_status <> 'draft' then raise exception 'النسخة ليست مسودّة — لا تُنشر مرّتين'; end if;

  select count(*) into v_entries from public.sq_price_book_entries where version_id = p_version;
  if v_entries = 0 then raise exception 'لا تُنشر نسخة بلا بنود'; end if;

  update public.sq_price_book_versions
     set status = 'superseded'
   where price_book_id = v_book and status = 'published' and id <> p_version;

  update public.sq_price_book_versions
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_version;

  update public.sq_price_books set status = 'active', updated_at = now()
   where id = v_book and status = 'draft';

  perform public.sq_log('price_book_version_publish', 'sq_price_book_versions', p_version, null,
    jsonb_build_object('book', v_book, 'entries', v_entries));
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) دورة حياة العرض — سطح بيع.
--
--   ★ لا دالّة في هذا القسم تقرأ جدول تكلفة ولا عمود تكلفة ★
--   وتحديدًا sq_quote_price_set: لا تعرف الأرضية، ولا تسأل عنها، ولا ترفض
--   بسببها. رفضها الوحيد سياسيّ — «تجاوزتَ صلاحية خصمك» — وهو رقم يعرفه
--   الموظّف سلفًا، فلا يحمل معلومة جديدة. راجع §5 من رأس الملفّ.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_quote_create(
  p_client uuid, p_title text, p_tier text default 'professional',
  p_price_book_version uuid default null, p_project uuid default null,
  p_validity_days int default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_pbv uuid; v_days int; v_st text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if p_client is null or p_title is null then raise exception 'العميل والعنوان مطلوبان'; end if;
  if not exists (select 1 from public.clients where id = p_client) then
    raise exception 'client not found';
  end if;

  v_pbv := p_price_book_version;
  if v_pbv is null then
    select v.id into v_pbv from public.sq_price_book_versions v
     where v.status = 'published'
     order by coalesce(v.published_at, v.created_at) desc limit 1;
  end if;
  if v_pbv is null then
    raise exception 'لا توجد نسخة دفتر أسعار منشورة — انشر نسخة قبل بناء عرض';
  end if;
  select status into v_st from public.sq_price_book_versions where id = v_pbv;
  if v_st is distinct from 'published' then
    raise exception 'العرض يُبنى على نسخة منشورة فقط (الحالة الحالية: %)', coalesce(v_st, 'غير موجودة');
  end if;

  v_days := coalesce(p_validity_days, public.sq_setting_num('default_validity_days', 30)::int);

  insert into public.sq_quotes (code, client_id, project_id, title, tier, price_book_version_id,
                                validity_days, vat_rate, created_by)
  values (public.sq_next_quote_code(), p_client, p_project, p_title,
          coalesce(p_tier, 'professional'), v_pbv, v_days,
          public.sq_setting_num('vat_rate', 0.15), auth.uid())
  returning id into v_id;

  insert into public.sq_quote_inputs (quote_id, updated_by) values (v_id, auth.uid());

  perform public.sq_log('quote_create', 'sq_quotes', v_id, v_id,
    jsonb_build_object('client', p_client, 'tier', p_tier, 'price_book_version', v_pbv));
  return v_id;
end $$;

-- المدخلات كـjsonb: ثلاثون عمودًا كثلاثين مُعامِلًا وصفةٌ لأخطاء ترتيب صامتة.
-- المفاتيح غير المعروفة تُتجاهل بصمت — ولا يُكتب مفتاح تكلفة هنا إطلاقًا.
create or replace function public.sq_quote_inputs_set(p_quote uuid, p_inputs jsonb)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_status text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select status into v_status from public.sq_quotes where id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'المدخلات تُعدَّل في المسودّة أو المراجعة الداخلية فقط (الحالة: %)',
      public.sq_quote_status_label(v_status);
  end if;

  insert into public.sq_quote_inputs (quote_id) values (p_quote) on conflict (quote_id) do nothing;

  update public.sq_quote_inputs set
    shooting_days        = coalesce((p_inputs->>'shooting_days')::int, shooting_days),
    shooting_hours       = coalesce((p_inputs->>'shooting_hours')::numeric, shooting_hours),
    locations_count      = coalesce((p_inputs->>'locations_count')::int, locations_count),
    cities               = coalesce((select array_agg(x) from jsonb_array_elements_text(
                             case when jsonb_typeof(p_inputs->'cities') = 'array' then p_inputs->'cities' else '[]'::jsonb end) x), cities),
    travel_required      = coalesce((p_inputs->>'travel_required')::boolean, travel_required),
    travel_km            = coalesce((p_inputs->>'travel_km')::numeric, travel_km),
    accommodation_nights = coalesce((p_inputs->>'accommodation_nights')::int, accommodation_nights),
    crew_size            = coalesce((p_inputs->>'crew_size')::int, crew_size),
    cameras_count        = coalesce((p_inputs->>'cameras_count')::int, cameras_count),
    lighting_setup       = coalesce(p_inputs->>'lighting_setup', lighting_setup),
    audio_setup          = coalesce(p_inputs->>'audio_setup', audio_setup),
    drone                = coalesce((p_inputs->>'drone')::boolean, drone),
    drone_hours          = coalesce((p_inputs->>'drone_hours')::numeric, drone_hours),
    fpv_drone            = coalesce((p_inputs->>'fpv_drone')::boolean, fpv_drone),
    fpv_drone_hours      = coalesce((p_inputs->>'fpv_drone_hours')::numeric, fpv_drone_hours),
    live_streaming       = coalesce((p_inputs->>'live_streaming')::boolean, live_streaming),
    live_stream_days     = coalesce((p_inputs->>'live_stream_days')::int, live_stream_days),
    editing_hours        = coalesce((p_inputs->>'editing_hours')::numeric, editing_hours),
    motion_graphics_secs = coalesce((p_inputs->>'motion_graphics_secs')::numeric, motion_graphics_secs),
    voice_over           = coalesce((p_inputs->>'voice_over')::boolean, voice_over),
    voice_over_langs     = coalesce((p_inputs->>'voice_over_langs')::int, voice_over_langs),
    scriptwriting        = coalesce((p_inputs->>'scriptwriting')::boolean, scriptwriting),
    storyboard           = coalesce((p_inputs->>'storyboard')::boolean, storyboard),
    versions_count       = coalesce((p_inputs->>'versions_count')::int, versions_count),
    formats              = coalesce((select array_agg(x) from jsonb_array_elements_text(
                             case when jsonb_typeof(p_inputs->'formats') = 'array' then p_inputs->'formats' else '[]'::jsonb end) x), formats),
    delivery_speed       = coalesce(p_inputs->>'delivery_speed', delivery_speed),
    weekend_work         = coalesce((p_inputs->>'weekend_work')::boolean, weekend_work),
    night_work           = coalesce((p_inputs->>'night_work')::boolean, night_work),
    permits_required     = coalesce((p_inputs->>'permits_required')::boolean, permits_required),
    permits_count        = coalesce((p_inputs->>'permits_count')::int, permits_count),
    equipment_rental_required = coalesce((p_inputs->>'equipment_rental_required')::boolean, equipment_rental_required),
    equipment_rental_notes    = coalesce(p_inputs->>'equipment_rental_notes', equipment_rental_notes),
    external_supplier_required = coalesce((p_inputs->>'external_supplier_required')::boolean, external_supplier_required),
    external_supplier_scope    = coalesce(p_inputs->>'external_supplier_scope', external_supplier_scope),
    notes       = coalesce(p_inputs->>'notes', notes),
    updated_by  = auth.uid(),
    updated_at  = now()
  where quote_id = p_quote;

  perform public.sq_log('inputs_set', 'sq_quote_inputs', null, p_quote,
    jsonb_build_object('keys', (select count(*) from jsonb_object_keys(coalesce(p_inputs,'{}'::jsonb)))));
  return true;
end $$;

-- سعر البيع يأتي من النسخة المنشورة، لا من لوحة المفاتيح: بندٌ مرتبط بالكتالوج
-- يُسعَّر من الدفتر. البند المخصّص (بلا catalog_id) وحده يقبل سعرًا يدويًّا.
create or replace function public.sq_quote_line_set(
  p_quote uuid, p_line uuid, p_catalog uuid, p_label text,
  p_qty numeric, p_kind text default 'service',
  p_unit_sell_rate numeric default null, p_uom text default null, p_sort int default 100
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_rate numeric; v_uom text; v_tier text; v_pbv uuid; v_status text; v_label text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select q.status, q.tier, q.price_book_version_id into v_status, v_tier, v_pbv
    from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'البنود تُعدَّل في المسودّة أو المراجعة الداخلية فقط (الحالة: %)',
      public.sq_quote_status_label(v_status);
  end if;
  if coalesce(p_qty, -1) < 0 then raise exception 'الكمّية لا تكون سالبة'; end if;

  if p_catalog is not null then
    select e.sell_rate, coalesce(e.uom, c.uom_ar), c.name_ar
      into v_rate, v_uom, v_label
      from public.sq_price_book_entries e
      join public.sq_service_catalog c on c.id = e.catalog_id
     where e.version_id = v_pbv and e.catalog_id = p_catalog and e.tier = v_tier;
    if v_rate is null then
      raise exception 'لا يوجد سعر بيع لهذه الخدمة في هذه الفئة ضمن النسخة المثبَّتة — أضِفه إلى دفتر الأسعار أوّلًا';
    end if;
  else
    if p_unit_sell_rate is null then raise exception 'البند المخصّص يحتاج سعر وحدة'; end if;
    if p_unit_sell_rate < 0 then raise exception 'سعر الوحدة لا يكون سالبًا'; end if;
    v_rate := p_unit_sell_rate; v_uom := p_uom; v_label := p_label;
  end if;

  if p_line is null then
    insert into public.sq_quote_lines (quote_id, catalog_id, kind, label, qty, uom, unit_sell_rate, sort_order)
    values (p_quote, p_catalog, coalesce(p_kind,'service'), coalesce(p_label, v_label, 'بند'),
            coalesce(p_qty,1), coalesce(p_uom, v_uom), v_rate, coalesce(p_sort,100))
    returning id into v_id;
  else
    update public.sq_quote_lines
       set catalog_id = p_catalog, kind = coalesce(p_kind, kind),
           label = coalesce(p_label, v_label, label), qty = coalesce(p_qty, qty),
           uom = coalesce(p_uom, v_uom, uom), unit_sell_rate = v_rate,
           sort_order = coalesce(p_sort, sort_order), updated_at = now()
     where id = p_line and quote_id = p_quote
    returning id into v_id;
    if v_id is null then raise exception 'line not found'; end if;
  end if;

  update public.sq_quotes
     set list_price = (select coalesce(sum(line_total), 0) from public.sq_quote_lines where quote_id = p_quote),
         updated_at = now()
   where id = p_quote;

  perform public.sq_log('line_set', 'sq_quote_lines', v_id, p_quote,
    jsonb_build_object('qty', p_qty, 'unit_sell_rate', v_rate));
  return v_id;
end $$;

create or replace function public.sq_quote_line_delete(p_line uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_quote uuid; v_status text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  select quote_id into v_quote from public.sq_quote_lines where id = p_line;
  if v_quote is null then raise exception 'line not found'; end if;
  if not coalesce(public.sq_quote_visible(v_quote), false) then raise exception 'not authorized'; end if;
  select status into v_status from public.sq_quotes where id = v_quote;
  if v_status not in ('draft','internal_review') then
    raise exception 'البنود تُحذف في المسودّة أو المراجعة الداخلية فقط';
  end if;

  delete from public.sq_quote_lines where id = p_line;
  update public.sq_quotes
     set list_price = (select coalesce(sum(line_total), 0) from public.sq_quote_lines where quote_id = v_quote),
         updated_at = now()
   where id = v_quote;

  perform public.sq_log('line_delete', 'sq_quote_lines', p_line, v_quote, '{}'::jsonb);
  return true;
end $$;

create or replace function public.sq_quote_terms_set(
  p_quote uuid, p_assumptions text default null, p_exclusions text default null,
  p_validity_days int default null
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_status text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select status into v_status from public.sq_quotes where id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'الشروط تُعدَّل قبل الرفع للاعتماد فقط (الحالة: %)', public.sq_quote_status_label(v_status);
  end if;
  if p_validity_days is not null and (p_validity_days <= 0 or p_validity_days > 365) then
    raise exception 'مدّة الصلاحية بين ١ و٣٦٥ يومًا';
  end if;

  update public.sq_quotes
     set assumptions = coalesce(p_assumptions, assumptions),
         exclusions  = coalesce(p_exclusions, exclusions),
         validity_days = coalesce(p_validity_days, validity_days),
         updated_at = now()
   where id = p_quote;

  perform public.sq_log('terms_set', 'sq_quotes', p_quote, p_quote, '{}'::jsonb);
  return true;
end $$;

-- ★★ الدالّة التي كان يمكن أن تكون العرّاف ★★
--   لا تقرأ min_price. لا تقرأ تكلفة. لا ترفض بسبب أرضية. حدُّها الوحيد
--   صلاحية الخصم — رقم يعرفه الموظّف عن نفسه، فرفضٌ بسببه لا يضيف معلومة.
create or replace function public.sq_quote_price_set(p_quote uuid, p_proposed_price numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_status text; v_list numeric; v_allow numeric; v_disc_pct numeric; v_disc_amt numeric; v_vat numeric;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select q.status, q.list_price, q.vat_rate into v_status, v_list, v_vat
    from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'السعر يُعدَّل قبل الرفع للاعتماد فقط (الحالة: %)', public.sq_quote_status_label(v_status);
  end if;
  if coalesce(p_proposed_price, -1) < 0 then raise exception 'السعر لا يكون سالبًا'; end if;
  if coalesce(v_list, 0) <= 0 then raise exception 'أضِف بنودًا إلى العرض قبل تسعيره'; end if;
  if p_proposed_price > v_list then
    raise exception 'السعر المقترَح أعلى من مجموع البنود — عدّل البنود بدل رفع السعر';
  end if;

  v_allow := public.sq_my_discount_allowance();
  v_disc_amt := round(v_list - p_proposed_price, 2);
  v_disc_pct := round(v_disc_amt / v_list, 4);
  if v_disc_pct > v_allow + 0.00005 then
    -- علامة النسبة داخل الوسيط لا في نصّ التنسيق: «%%%» في plpgsql تُخرج
    -- العلامة **قبل** الرقم لا بعده.
    raise exception 'الخصم المطلوب (%) يتجاوز صلاحيتك (%) — ارفع طلب اعتماد بدل تجاوزها',
      round(v_disc_pct * 100, 2)::text || '٪', round(v_allow * 100, 2)::text || '٪';
  end if;

  update public.sq_quotes
     set proposed_price = p_proposed_price,
         discount_amount = v_disc_amt,
         discount_pct = v_disc_pct,
         gross_before_vat = p_proposed_price,
         updated_at = now()
   where id = p_quote;

  perform public.sq_log('price_set', 'sq_quotes', p_quote, p_quote,
    jsonb_build_object('proposed', p_proposed_price, 'discount_pct', v_disc_pct));

  return jsonb_build_object(
    'quote_id', p_quote, 'proposed_price', p_proposed_price,
    'list_price', v_list, 'discount_pct', v_disc_pct, 'discount_amount', v_disc_amt,
    'my_allowance_pct', v_allow,
    'vat_rate', v_vat, 'vat_amount', public.sq_vat(p_proposed_price, v_vat),
    'total_after_vat', round(p_proposed_price + public.sq_vat(p_proposed_price, v_vat), 2));
end $$;

create or replace function public.sq_quote_milestones_set(p_quote uuid, p_milestones jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_status text; v_gross numeric; v_vat numeric; v_n int := 0; v_sum numeric := 0; m jsonb; v_seq int := 0;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select q.status, coalesce(q.gross_before_vat, q.proposed_price, q.list_price), q.vat_rate
    into v_status, v_gross, v_vat from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'الدفعات تُعدَّل قبل الرفع للاعتماد فقط';
  end if;
  if jsonb_typeof(p_milestones) <> 'array' then raise exception 'الدفعات تُرسَل كمصفوفة'; end if;

  delete from public.sq_quote_milestones where quote_id = p_quote;

  for m in select e.value from jsonb_array_elements(p_milestones) e loop
    v_seq := v_seq + 1;
    insert into public.sq_quote_milestones (quote_id, seq, label, pct, amount_net, vat_rate, due_rule)
    values (
      p_quote, v_seq,
      coalesce(m->>'label', 'دفعة ' || v_seq),
      (m->>'pct')::numeric,
      case
        when (m->>'amount_net') is not null then round((m->>'amount_net')::numeric, 2)
        when (m->>'pct') is not null and v_gross is not null then round(v_gross * (m->>'pct')::numeric, 2)
        else 0
      end,
      coalesce(v_vat, 0.15),
      coalesce(m->>'due_rule', 'on_signature'));
    v_n := v_n + 1;
  end loop;

  -- الفرق يُعلَن ولا يُخفى: دفعات لا تساوي الإجمالي خطأٌ يجب أن يُرى الآن.
  select coalesce(sum(amount_net), 0) into v_sum from public.sq_quote_milestones where quote_id = p_quote;
  if v_gross is not null and v_n > 0 and abs(v_sum - v_gross) > 0.05 then
    raise exception 'مجموع الدفعات (%) لا يساوي إجمالي العرض قبل الضريبة (%)', v_sum, v_gross;
  end if;

  perform public.sq_log('milestones_set', 'sq_quote_milestones', null, p_quote,
    jsonb_build_object('count', v_n, 'sum', v_sum));
  return v_n;
end $$;

-- ★ الرفع للاعتماد ★ المسار ثابت: كلّ عرض يمرّ بالمالك. لا فرع ولا شرط،
--   فلا يحمل الانتقال معلومة عن الأرضية. (القيد sq_quotes_approval_always
--   يمنع أيّ كود لاحق من جعله شرطيًّا.)
create or replace function public.sq_quote_submit(p_quote uuid, p_note text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_status text; v_price numeric; v_disc numeric; v_tier text; v_lines int; v_appr uuid; v_reason text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select q.status, q.proposed_price, q.discount_pct, q.tier
    into v_status, v_price, v_disc, v_tier from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('draft','internal_review') then
    raise exception 'العرض في حالة % — لا يُرفع مرّتين', public.sq_quote_status_label(v_status);
  end if;
  if v_price is null then raise exception 'حدّد السعر المقترَح قبل الرفع للاعتماد'; end if;
  select count(*) into v_lines from public.sq_quote_lines where quote_id = p_quote;
  if v_lines = 0 then raise exception 'لا يُرفع عرض بلا بنود'; end if;

  -- السبب المعروض للمبيعات: سياسة فقط. لا أرضية ولا تكلفة ولا هامش.
  v_reason := case
    when v_tier = 'enterprise_custom' then 'فئة مؤسّسية مخصّصة'
    when coalesce(v_disc, 0) > 0 then 'خصم على سعر القائمة'
    else 'اعتماد قياسي — كلّ عرض يمرّ بالمالك'
  end;

  update public.sq_quotes
     set status = 'pending_owner_approval', approval_reason_public = v_reason, updated_at = now()
   where id = p_quote;

  insert into public.sq_approval_requests (quote_id, kind, requested_price, requested_discount_pct, reason, requested_by)
  values (p_quote,
          case when v_tier = 'enterprise_custom' then 'custom_tier'
               when coalesce(v_disc,0) > 0 then 'discount' else 'price' end,
          v_price, v_disc, p_note, auth.uid())
  returning id into v_appr;

  -- ★ الأرضية وقت الطلب تُختم بمُشغّل، لا هنا ★
  --   الختم ضروريّ (المالك يقرّر وهو يرى)، لكنّ قراءته من داخل دالّة يستدعيها
  --   موظّف المبيعات تكسر القاعدة التي تحمي المرحلة كلّها: «لا دالّة سطح بيع
  --   تذكر رمز تكلفة». المُشغّل sq_approval_stamp_floor يفعلها بعد الإدراج،
  --   ولا يعيد شيئًا إلى المستدعي. راجع §5.

  perform public.sq_log('quote_submit', 'sq_quotes', p_quote, p_quote,
    jsonb_build_object('approval_id', v_appr, 'reason', v_reason));
  return v_appr;
end $$;

create or replace function public.sq_quote_new_version(p_quote uuid, p_note text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_new uuid; v_old record;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;

  select q.client_id, q.project_id, q.title, q.tier, q.price_book_version_id,
         q.validity_days, q.vat_rate, q.assumptions, q.exclusions, q.version_no, q.status
    into v_old from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_old.status = 'superseded' then raise exception 'هذا العرض مُستبدَل أصلًا'; end if;

  insert into public.sq_quotes (code, client_id, project_id, title, tier, price_book_version_id,
                                validity_days, vat_rate, assumptions, exclusions,
                                version_no, supersedes_id, created_by)
  values (public.sq_next_quote_code(), v_old.client_id, v_old.project_id, v_old.title, v_old.tier,
          v_old.price_book_version_id, v_old.validity_days, v_old.vat_rate,
          v_old.assumptions, v_old.exclusions, v_old.version_no + 1, p_quote, auth.uid())
  returning id into v_new;

  insert into public.sq_quote_inputs (
    quote_id, shooting_days, shooting_hours, locations_count, cities, travel_required, travel_km,
    accommodation_nights, crew_size, cameras_count, lighting_setup, audio_setup, drone, drone_hours,
    fpv_drone, fpv_drone_hours, live_streaming, live_stream_days, editing_hours, motion_graphics_secs,
    voice_over, voice_over_langs, scriptwriting, storyboard, versions_count, formats, delivery_speed,
    weekend_work, night_work, permits_required, permits_count, equipment_rental_required,
    equipment_rental_notes, external_supplier_required, external_supplier_scope, notes, updated_by)
  select v_new, shooting_days, shooting_hours, locations_count, cities, travel_required, travel_km,
    accommodation_nights, crew_size, cameras_count, lighting_setup, audio_setup, drone, drone_hours,
    fpv_drone, fpv_drone_hours, live_streaming, live_stream_days, editing_hours, motion_graphics_secs,
    voice_over, voice_over_langs, scriptwriting, storyboard, versions_count, formats, delivery_speed,
    weekend_work, night_work, permits_required, permits_count, equipment_rental_required,
    equipment_rental_notes, external_supplier_required, external_supplier_scope, notes, auth.uid()
  from public.sq_quote_inputs where quote_id = p_quote;

  insert into public.sq_quote_lines (quote_id, catalog_id, kind, label, qty, uom, unit_sell_rate, sort_order)
  select v_new, catalog_id, kind, label, qty, uom, unit_sell_rate, sort_order
    from public.sq_quote_lines where quote_id = p_quote;

  update public.sq_quotes
     set list_price = (select coalesce(sum(line_total), 0) from public.sq_quote_lines where quote_id = v_new)
   where id = v_new;

  update public.sq_quotes set status = 'superseded', updated_at = now() where id = p_quote;

  perform public.sq_log('quote_new_version', 'sq_quotes', v_new, v_new,
    jsonb_build_object('supersedes', p_quote, 'note', p_note));
  return v_new;
end $$;

-- ★★ أمانة الإرسال ★★
--   الاسم sent_placeholder، والعرض «معتمد وجاهز للإرسال اليدوي». لا مزوّد
--   أُخطر، ولا رسالة غادرت، ولا يُكتب delivery_proven (قيد CHECK يمنعه).
--   الفرق ليس لغويًّا: «أُرسل» تجعل الفريق يتوقّف عن المتابعة.
create or replace function public.sq_quote_mark_ready_for_manual_send(p_quote uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_status text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select status into v_status from public.sq_quotes where id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status <> 'approved' then
    raise exception 'العرض غير معتمد بعد (الحالة: %)', public.sq_quote_status_label(v_status);
  end if;

  update public.sq_quotes
     set status = 'sent_placeholder', ready_for_manual_send_at = now(), updated_at = now()
   where id = p_quote;

  perform public.sq_log('ready_for_manual_send', 'sq_quotes', p_quote, p_quote,
    jsonb_build_object('delivery_proven', false));

  return jsonb_build_object(
    'quote_id', p_quote, 'status', 'sent_placeholder',
    'status_label_ar', public.sq_quote_status_label('sent_placeholder'),
    'delivery_proven', false,
    'honest_note_ar', 'لم تُرسَل رسالة من النظام. الحالة تعني أنّ العرض معتمد وجاهز لترسله يدويًّا.');
end $$;

create or replace function public.sq_quote_record_client_decision(
  p_quote uuid, p_decision text, p_note text default null
) returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_status text;
begin
  if not coalesce(public.sq_can_build(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  if p_decision not in ('accepted','rejected') then raise exception 'القرار: accepted أو rejected'; end if;
  select status into v_status from public.sq_quotes where id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if v_status not in ('approved','sent_placeholder') then
    raise exception 'قرار العميل يُسجَّل بعد الاعتماد فقط (الحالة: %)', public.sq_quote_status_label(v_status);
  end if;

  update public.sq_quotes
     set status = p_decision, client_decision = p_decision,
         client_decision_at = now(), client_decision_note = p_note, updated_at = now()
   where id = p_quote;

  perform public.sq_log('client_decision', 'sq_quotes', p_quote, p_quote,
    jsonb_build_object('decision', p_decision));
  return true;
end $$;

-- انتهاء الصلاحية — يُشغَّل من مهمّة دورية. لا يلمس عرضًا قبله العميل.
create or replace function public.sq_expiry_scan()
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0;
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  update public.sq_quotes
     set valid_until = (coalesce(approved_at, created_at) + (validity_days || ' days')::interval)::date
   where valid_until is null;

  with expired as (
    update public.sq_quotes
       set status = 'expired', updated_at = now()
     where status in ('approved','sent_placeholder')
       and valid_until is not null and valid_until < current_date
    returning id)
  select count(*) into v_n from expired;

  if v_n > 0 then
    perform public.sq_log('expiry_scan', 'sq_quotes', null, null, jsonb_build_object('expired', v_n));
  end if;
  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) أسطح القراءة لسطح البيع.
--
--   ★ القاعدة المُختبَرة: لا واحدة من دوالّ هذا القسم تذكر جدول تكلفة ولا
--     عمود تكلفة ولو مرّة. ليست «تُقنّع» — لا تقرأ. ما لا يُقرأ لا يتسرّب. ★
--
--   ولا `select *` في أيّ منها: أوّل عمود يُضاف إلى جدول غدًا يتسرّب تلقائيًّا
--   لو استُعمل النجم. قوائم الأعمدة مكتوبة بأيدينا عمدًا.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_ui_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  -- ★ مفاتيح البيع فقط ★ نسب الطوارئ والمصاريف العامّة معاملات المعادلة
  --   الداخلية، ولا تخرج من هنا ولو كقيمة افتراضية.
  return jsonb_build_object(
    'vat_rate', public.sq_setting_num('vat_rate', 0.15),
    'default_validity_days', public.sq_setting_num('default_validity_days', 30),
    'my_discount_allowance', public.sq_my_discount_allowance(),
    'can_build', public.sq_can_build(),
    'can_manage_catalog', public.sq_can_manage_catalog(),
    'can_export', public.sq_can_export(),
    'internal_visible', public.sq_can_view_cost());
end $$;

create or replace function public.sq_my_discount_allowance_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'allowance_pct', public.sq_my_discount_allowance(),
    'basis_ar', 'سُلّم سياسة معلَن — لا يُشتقّ من أيّ رقم داخليّ ولا يدلّ عليه',
    'note_ar', 'تجاوز صلاحيتك يعني طلب اعتماد، لا رفضًا نهائيًّا');
end $$;

create or replace function public.sq_quotes_list(
  p_status text default null, p_client uuid default null,
  p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, code text, client_id uuid, title text, tier text,
  status text, status_label_ar text, version_no int,
  list_price numeric, proposed_price numeric, authorized_price numeric,
  discount_pct numeric, gross_before_vat numeric,
  vat_rate numeric, vat_amount numeric, total_after_vat numeric,
  valid_until date, requires_owner_approval boolean, approval_reason_public text,
  created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select q.id, q.code, q.client_id, q.title, q.tier,
           q.status, public.sq_quote_status_label(q.status), q.version_no,
           q.list_price, q.proposed_price, q.authorized_price,
           q.discount_pct, q.gross_before_vat,
           q.vat_rate, q.vat_amount, q.total_after_vat,
           q.valid_until, q.requires_owner_approval, q.approval_reason_public,
           q.created_at
      from public.sq_quotes q
     where (p_status is null or q.status = p_status)
       and (p_client is null or q.client_id = p_client)
       and (coalesce(public.sq_is_owner_role(), false)
            or coalesce(public.sq_perm('quote.view'), false)
            or q.created_by = auth.uid())
     order by q.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0));
end $$;

-- ★ تفصيل العرض لسطح البيع ★
--   «المدى المسموح» هنا هو مدى البيع المسموح للموظّف: سقفه سعر القائمة أو
--   المعتمَد، وقاعه ذلك السقف ناقص صلاحية خصمه هو. **ليس** الأرضية، ولا
--   مشتقًّا منها، ولا محدودًا بها.
create or replace function public.sq_quote_detail(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q record; v_allow numeric; v_max numeric; v_appr record;
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;

  select x.id, x.code, x.client_id, x.project_id, x.title, x.tier, x.status, x.version_no,
         x.supersedes_id, x.price_book_version_id, x.currency,
         x.list_price, x.proposed_price, x.authorized_price, x.discount_pct, x.discount_amount,
         x.gross_before_vat, x.vat_rate, x.vat_amount, x.total_after_vat,
         x.range_low, x.range_high, x.range_published, x.range_is_binding,
         x.validity_days, x.valid_until, x.assumptions, x.exclusions,
         x.requires_owner_approval, x.approval_reason_public, x.approved_at,
         x.ready_for_manual_send_at, x.delivery_proven,
         x.client_decision, x.client_decision_at, x.created_at
    into q from public.sq_quotes x where x.id = p_quote;
  if not found then raise exception 'quote not found'; end if;

  v_allow := public.sq_my_discount_allowance();
  v_max := coalesce(q.authorized_price, q.list_price);

  select a.status, a.kind, a.requested_at, a.decided_at, a.decision_note
    into v_appr from public.sq_approval_requests a
   where a.quote_id = p_quote order by a.requested_at desc limit 1;

  return jsonb_build_object(
    'id', q.id, 'code', q.code, 'client_id', q.client_id, 'project_id', q.project_id,
    'title', q.title, 'tier', q.tier, 'version_no', q.version_no,
    'supersedes_id', q.supersedes_id, 'price_book_version_id', q.price_book_version_id,
    'currency', q.currency,
    'status', q.status, 'status_label_ar', public.sq_quote_status_label(q.status),
    -- أرقام البيع
    'list_price', q.list_price, 'proposed_price', q.proposed_price,
    'authorized_price', q.authorized_price,
    'discount_pct', q.discount_pct, 'discount_amount', q.discount_amount,
    'gross_before_vat', q.gross_before_vat,
    -- ★ الضريبة حقل مستقلّ دائمًا ★
    'vat_rate', q.vat_rate, 'vat_amount', q.vat_amount, 'total_after_vat', q.total_after_vat,
    -- المدى المسموح لي (بيع فقط)
    'permitted_max', v_max,
    'permitted_min', case when v_max is null then null else round(v_max * (1 - v_allow), 2) end,
    'my_discount_allowance', v_allow,
    -- المدى الإرشاديّ العلنيّ
    'range_low', q.range_low, 'range_high', q.range_high,
    'range_published', q.range_published, 'range_is_binding', q.range_is_binding,
    -- الشروط
    'validity_days', q.validity_days, 'valid_until', q.valid_until,
    'assumptions', q.assumptions, 'exclusions', q.exclusions,
    -- الاعتماد
    'requires_owner_approval', q.requires_owner_approval,
    'approval_reason_public', q.approval_reason_public,
    'approved_at', q.approved_at,
    'approval_status', v_appr.status, 'approval_kind', v_appr.kind,
    'approval_requested_at', v_appr.requested_at, 'approval_decided_at', v_appr.decided_at,
    'approval_note', v_appr.decision_note,
    -- أمانة التسليم
    'ready_for_manual_send_at', q.ready_for_manual_send_at,
    'delivery_proven', q.delivery_proven,
    'client_decision', q.client_decision, 'client_decision_at', q.client_decision_at,
    'created_at', q.created_at,
    -- ثابتة لكلّ عرض بالنسبة للمستخدم نفسه ⇒ لا تحمل معلومة عن أيّ عرض
    'internal_visible', public.sq_can_view_cost());
end $$;

create or replace function public.sq_quote_lines_list(p_quote uuid)
returns table (
  id uuid, catalog_id uuid, kind text, label text,
  qty numeric, uom text, unit_sell_rate numeric, line_total numeric, sort_order int
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  return query
    select l.id, l.catalog_id, l.kind, l.label,
           l.qty, l.uom, l.unit_sell_rate, l.line_total, l.sort_order
      from public.sq_quote_lines l
     where l.quote_id = p_quote
     order by l.sort_order, l.label;
end $$;

create or replace function public.sq_quote_milestones_list(p_quote uuid)
returns table (
  id uuid, seq int, label text, pct numeric,
  amount_net numeric, vat_rate numeric, vat_amount numeric, amount_gross numeric, due_rule text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  return query
    select m.id, m.seq, m.label, m.pct,
           m.amount_net, m.vat_rate, m.vat_amount, m.amount_gross, m.due_rule
      from public.sq_quote_milestones m
     where m.quote_id = p_quote
     order by m.seq;
end $$;

create or replace function public.sq_quote_inputs_get(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'shooting_days', i.shooting_days, 'shooting_hours', i.shooting_hours,
    'locations_count', i.locations_count, 'cities', to_jsonb(i.cities),
    'travel_required', i.travel_required, 'travel_km', i.travel_km,
    'accommodation_nights', i.accommodation_nights, 'crew_size', i.crew_size,
    'cameras_count', i.cameras_count, 'lighting_setup', i.lighting_setup,
    'audio_setup', i.audio_setup, 'drone', i.drone, 'drone_hours', i.drone_hours,
    'fpv_drone', i.fpv_drone, 'fpv_drone_hours', i.fpv_drone_hours,
    'live_streaming', i.live_streaming, 'live_stream_days', i.live_stream_days,
    'editing_hours', i.editing_hours, 'motion_graphics_secs', i.motion_graphics_secs,
    'voice_over', i.voice_over, 'voice_over_langs', i.voice_over_langs,
    'scriptwriting', i.scriptwriting, 'storyboard', i.storyboard,
    'versions_count', i.versions_count, 'formats', to_jsonb(i.formats),
    'delivery_speed', i.delivery_speed, 'weekend_work', i.weekend_work,
    'night_work', i.night_work, 'permits_required', i.permits_required,
    'permits_count', i.permits_count,
    'equipment_rental_required', i.equipment_rental_required,
    'equipment_rental_notes', i.equipment_rental_notes,
    'external_supplier_required', i.external_supplier_required,
    'external_supplier_scope', i.external_supplier_scope,
    'notes', i.notes)
  into v from public.sq_quote_inputs i where i.quote_id = p_quote;
  return coalesce(v, '{}'::jsonb);
end $$;

-- طلبات اعتمادي — بقائمة أعمدة صريحة. floor_at_request و internal_reason_code
-- غائبان عمدًا: هما الطرف الداخليّ من القرار.
create or replace function public.sq_my_approvals(p_status text default null)
returns table (
  id uuid, quote_id uuid, quote_code text, kind text,
  requested_price numeric, requested_discount_pct numeric,
  status text, requested_at timestamptz, decided_at timestamptz, decision_note text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  return query
    select a.id, a.quote_id, q.code, a.kind,
           a.requested_price, a.requested_discount_pct,
           a.status, a.requested_at, a.decided_at, a.decision_note
      from public.sq_approval_requests a
      join public.sq_quotes q on q.id = a.quote_id
     where a.requested_by = auth.uid()
       and (p_status is null or a.status = p_status)
     order by a.requested_at desc
     limit 200;
end $$;

-- النشاط بلا حمولة: الحمولة في sq_audit قد تحمل أرقام تكلفة، فلا تخرج هنا.
create or replace function public.sq_quote_activity(p_quote uuid, p_limit int default 50)
returns table (at timestamptz, action text, entity text, actor uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;
  return query
    select a.at, a.action, a.entity, a.actor
      from public.sq_audit a
     where a.quote_id = p_quote
       -- ★ قائمة بيضاء حقيقية، لا سوداء ★ القائمة السوداء تتعفّن: أوّل حدث
       --   داخليّ يُضاف غدًا يظهر هنا تلقائيًّا لأنّ أحدًا لن يتذكّر تحديثها.
       --   وهي أيضًا تُجبرنا على كتابة أسماء أحداث التكلفة داخل دالّة سطح بيع.
       and a.action in (
         'quote_create','inputs_set','line_set','line_delete','terms_set','price_set',
         'milestones_set','quote_submit','quote_new_version','ready_for_manual_send',
         'client_decision','export','approval_decided','approval_withdrawn')
     order by a.at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

create or replace function public.sq_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_mine boolean;
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  v_mine := not (coalesce(public.sq_is_owner_role(), false) or coalesce(public.sq_perm('quote.view'), false));

  select jsonb_build_object(
    'total',            count(*),
    'draft',            count(*) filter (where q.status = 'draft'),
    'internal_review',  count(*) filter (where q.status = 'internal_review'),
    'pending_approval', count(*) filter (where q.status = 'pending_owner_approval'),
    'approved',         count(*) filter (where q.status = 'approved'),
    'ready_manual_send',count(*) filter (where q.status = 'sent_placeholder'),
    'accepted',         count(*) filter (where q.status = 'accepted'),
    'rejected',         count(*) filter (where q.status = 'rejected'),
    'expired',          count(*) filter (where q.status = 'expired'),
    -- ★ لا مؤشّر ربحية هنا ولا حتى كإشارة لونية: ترتيب العروض بالهامش
    --   يكشف ترتيب التكاليف، والترتيب معلومة.
    'scope', case when v_mine then 'mine' else 'all' end)
  into v
  from public.sq_quotes q
  where not v_mine or q.created_by = auth.uid();

  return coalesce(v, '{}'::jsonb);
end $$;

create or replace function public.sq_export_quote(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_detail jsonb; v_lines jsonb; v_ms jsonb;
begin
  if not coalesce(public.sq_can_export(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.sq_quote_visible(p_quote), false) then raise exception 'not authorized'; end if;

  -- ★ التصدير يعيد استعمال سطح البيع نفسه ★ مسار تصدير يبني استعلامه بنفسه
  --   هو الثقب الكلاسيكيّ: يُنسى عند تشديد الأصل. هنا لا يوجد استعلام ثانٍ.
  v_detail := public.sq_quote_detail(p_quote);
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order), '[]'::jsonb) into v_lines
    from public.sq_quote_lines_list(p_quote) l;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.seq), '[]'::jsonb) into v_ms
    from public.sq_quote_milestones_list(p_quote) m;

  perform public.sq_log('export', 'sq_quotes', p_quote, p_quote, '{}'::jsonb);
  return jsonb_build_object('quote', v_detail, 'lines', v_lines, 'milestones', v_ms,
    'exported_at', now(), 'note_ar', 'تصدير سطح البيع — لا يحوي تكلفة ولا هامشًا ولا حدًّا أدنى');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) الاعتماد — ★ المالك وحده ★
--
--   ملاحظة القرار (decision_note) نصٌّ يكتبه المالك بيده ويراه مقدّم الطلب.
--   هذه **قناة بشرية واعية**: لو كتب المالك «أقلّ من الحدّ الأدنى» فقد أفصح
--   باختياره. أمّا الطرف البنيويّ — floor_at_request و internal_reason_code —
--   فلا يخرج من القاعدة إلى سطح البيع أبدًا. التمييز مقصود وموثَّق في
--   docs/SMART_QUOTING_ROLE_MATRIX.md.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_approvals_list_internal(p_status text default 'pending')
returns table (
  id uuid, quote_id uuid, quote_code text, client_id uuid, kind text,
  requested_price numeric, requested_discount_pct numeric, reason text,
  status text, requested_by uuid, requested_at timestamptz,
  floor_at_request numeric, internal_reason_code text,
  below_floor boolean, margin_pct numeric, internal_cost_estimate numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  return query
    select a.id, a.quote_id, q.code, q.client_id, a.kind,
           a.requested_price, a.requested_discount_pct, a.reason,
           a.status, a.requested_by, a.requested_at,
           a.floor_at_request, a.internal_reason_code,
           i.below_floor, i.margin_pct, i.internal_cost_estimate
      from public.sq_approval_requests a
      join public.sq_quotes q on q.id = a.quote_id
      left join public.sq_quote_internal i on i.quote_id = a.quote_id
     where (p_status is null or a.status = p_status)
     order by a.requested_at desc
     limit 200;
end $$;

create or replace function public.sq_approval_decide(
  p_id uuid, p_decision text, p_authorized_price numeric default null, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_quote uuid; v_req numeric; v_status text; v_requester uuid;
        v_price numeric; v_list numeric; v_days int; v_vat numeric; v_code text;
begin
  if not coalesce(public.sq_can_approve(), false) then raise exception 'not authorized'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'القرار: approved أو rejected'; end if;

  select a.quote_id, a.requested_price, a.status, a.requested_by
    into v_quote, v_req, v_status, v_requester
    from public.sq_approval_requests a where a.id = p_id;
  if not found then raise exception 'approval request not found'; end if;
  if v_status <> 'pending' then raise exception 'الطلب محسوم أصلًا (%)', v_status; end if;

  update public.sq_approval_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;

  if p_decision = 'rejected' then
    -- يعود إلى المراجعة الداخلية لا إلى المسودّة: العمل المنجز لا يُهدر.
    update public.sq_quotes set status = 'internal_review', updated_at = now() where id = v_quote;
    perform public.sq_notify(v_requester, 'quote_approval',
      'قرار على طلب اعتماد عرض سعر', coalesce(p_note, 'لم يُعتمد الطلب.'));
    perform public.sq_log('approval_decided', 'sq_approval_requests', p_id, v_quote,
      jsonb_build_object('decision', p_decision));
    return jsonb_build_object('decision', 'rejected', 'quote_id', v_quote);
  end if;

  select q.list_price, q.validity_days, q.vat_rate, q.code
    into v_list, v_days, v_vat, v_code from public.sq_quotes q where q.id = v_quote;
  v_price := coalesce(p_authorized_price, v_req);
  if v_price is null or v_price < 0 then raise exception 'سعر الاعتماد مطلوب'; end if;

  update public.sq_quotes
     set status = 'approved',
         authorized_price = v_price,
         gross_before_vat = v_price,
         discount_amount = case when v_list is null then discount_amount else greatest(round(v_list - v_price, 2), 0) end,
         discount_pct = case when coalesce(v_list, 0) > 0 then greatest(round((v_list - v_price) / v_list, 4), 0) else discount_pct end,
         approved_at = now(), approved_by = auth.uid(),
         valid_until = (current_date + (coalesce(v_days, 30) || ' days')::interval)::date,
         updated_at = now()
   where id = v_quote;

  -- إعادة الحساب بعد الاعتماد كي يعكس الهامش السعر المعتمَد فعلًا لا المقترَح.
  begin perform public.sq_quote_recompute(v_quote); exception when others then null; end;

  perform public.sq_notify(v_requester, 'quote_approval',
    'اعتُمد عرض السعر ' || coalesce(v_code, ''),
    coalesce(p_note, 'العرض معتمد وجاهز للإرسال اليدوي.'));
  perform public.sq_log('approval_decided', 'sq_approval_requests', p_id, v_quote,
    jsonb_build_object('decision', p_decision, 'authorized_price', v_price));

  return jsonb_build_object(
    'decision', 'approved', 'quote_id', v_quote, 'authorized_price', v_price,
    'vat_rate', v_vat, 'vat_amount', public.sq_vat(v_price, v_vat),
    'total_after_vat', round(v_price + public.sq_vat(v_price, v_vat), 2));
end $$;

create or replace function public.sq_approval_withdraw(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_quote uuid; v_by uuid; v_status text;
begin
  if not coalesce(public.sq_can_view(), false) then raise exception 'not authorized'; end if;
  select quote_id, requested_by, status into v_quote, v_by, v_status
    from public.sq_approval_requests where id = p_id;
  if not found then raise exception 'approval request not found'; end if;
  if v_status <> 'pending' then raise exception 'الطلب محسوم أصلًا'; end if;
  if v_by <> auth.uid() and not coalesce(public.sq_can_approve(), false) then
    raise exception 'not authorized';
  end if;

  update public.sq_approval_requests set status = 'withdrawn', decided_at = now() where id = p_id;
  update public.sq_quotes set status = 'internal_review', updated_at = now()
   where id = v_quote and status = 'pending_owner_approval';

  perform public.sq_log('approval_withdrawn', 'sq_approval_requests', p_id, v_quote, '{}'::jsonb);
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) المدى الإرشاديّ العلنيّ.
--
--   ★★ الشرط الذي كُتب هذا القسم من أجله ★★
--   «لو كان طرف المدى يكشف سعر الأرضية، فلا تعرضه.»
--
--   ولذلك sq_publish_range:
--     · تُحسب من **السعر المعتمَد أو سعر القائمة** — كلاهما سطح بيع،
--     · ولا تقرأ min_price ولا أيّ عمود تكلفة (الـSELF-TEST يفشل إن ذكرت
--       رمز تكلفة واحدًا — نعم، حتى وهي دالّة للمالك: الخطر هنا في **مخرَجها
--       العلنيّ** لا في مستدعيها)،
--     · وتُدوّر الطرفين إلى مضاعفات خطوة خشنة، فلا يقع طرف على رقم دقيق،
--     · وترفض مدًى أضيق من خطوة واحدة: مدًى بهذا الضيق سعرٌ نهائيّ متنكّر،
--       وهو ما نهى عنه المتطلّب صراحةً («لا سعر نهائيّ ملزِم للعلن»).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_client_owns_quote(p_quote uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_mine uuid; v_client uuid;
begin
  if p_quote is null or auth.uid() is null then return false; end if;
  if to_regprocedure('public.my_client_id()') is null then return false; end if;
  execute 'select public.my_client_id()' into v_mine;
  if v_mine is null then return false; end if;
  select client_id into v_client from public.sq_quotes where id = p_quote;
  return coalesce(v_client = v_mine, false);
exception when others then
  return false;
end $$;

create or replace function public.sq_publish_range(p_quote uuid, p_band_pct numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_base numeric; v_band numeric; v_step numeric; v_low numeric; v_high numeric; v_status text;
begin
  if not coalesce(public.sq_can_approve(), false) then raise exception 'not authorized'; end if;

  select coalesce(q.authorized_price, q.list_price), q.status
    into v_base, v_status from public.sq_quotes q where q.id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_base, 0) <= 0 then
    raise exception 'لا مدى قبل وجود سعر بيع — أضِف بنودًا أو اعتمِد سعرًا أوّلًا';
  end if;

  v_band := coalesce(p_band_pct, public.sq_setting_num('public_range_band_pct', 0.15));
  if v_band < 0.05 or v_band > 0.40 then
    raise exception 'عرض المدى بين ٥٪ و٤٠٪ — الأضيق يقترب من سعر نهائيّ والأوسع بلا معنى';
  end if;
  v_step := public.sq_setting_num('public_range_step', 5000);

  v_low  := public.sq_quantize_down(v_base * (1 - v_band), v_step);
  v_high := public.sq_quantize_up  (v_base * (1 + v_band), v_step);

  if coalesce(v_low, 0) <= 0 then
    v_low := v_step;   -- لا يُنشر طرفٌ سالب أو صفريّ
  end if;
  if v_high - v_low < v_step then
    raise exception 'المدى أضيق من خطوة التدوير — هذا سعر نهائيّ متنكّر، والمدى العلنيّ إرشاديّ لا ملزِم';
  end if;

  update public.sq_quotes
     set range_low = v_low, range_high = v_high,
         range_published = true, range_published_at = now(), updated_at = now()
   where id = p_quote;

  perform public.sq_log('range_publish', 'sq_quotes', p_quote, p_quote,
    jsonb_build_object('low', v_low, 'high', v_high, 'band', v_band));

  return jsonb_build_object('quote_id', p_quote, 'range_low', v_low, 'range_high', v_high,
    'step', v_step, 'band_pct', v_band, 'is_binding', false,
    'note_ar', 'مدى إرشاديّ غير ملزِم — مُدوّر إلى مضاعفات خشنة ولا يُشتقّ من أيّ رقم داخليّ');
end $$;

create or replace function public.sq_unpublish_range(p_quote uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_approve(), false) then raise exception 'not authorized'; end if;
  update public.sq_quotes
     set range_published = false, range_published_at = null, updated_at = now()
   where id = p_quote;
  if not found then raise exception 'quote not found'; end if;
  perform public.sq_log('range_unpublish', 'sq_quotes', p_quote, p_quote, '{}'::jsonb);
  return true;
end $$;

-- المدى للعميل صاحب العرض أو للموظّف المُخوَّل. لا خصم، ولا إجماليّ، ولا حالة
-- داخلية، ولا رقم قاطع. وإن لم يُنشر فالجواب «غير منشور» لا صفر.
create or replace function public.sq_public_range(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q record;
begin
  if not (coalesce(public.sq_can_view(), false) or coalesce(public.sq_client_owns_quote(p_quote), false)) then
    raise exception 'not authorized';
  end if;

  select x.code, x.title, x.tier, x.currency, x.range_low, x.range_high,
         x.range_published, x.range_is_binding, x.valid_until, x.vat_rate
    into q from public.sq_quotes x where x.id = p_quote;
  if not found then raise exception 'quote not found'; end if;

  if not q.range_published then
    return jsonb_build_object('published', false, 'range_low', null, 'range_high', null,
      'note_ar', 'لا يوجد مدى إرشاديّ منشور لهذا العرض. هذا ليس سعرًا صفريًّا.');
  end if;

  return jsonb_build_object(
    'published', true, 'code', q.code, 'title', q.title, 'tier', q.tier,
    'currency', q.currency, 'range_low', q.range_low, 'range_high', q.range_high,
    'vat_rate', q.vat_rate, 'vat_note_ar', 'المدى قبل ضريبة القيمة المضافة — تُحتسب منفصلة',
    'valid_until', q.valid_until,
    'is_binding', q.range_is_binding,
    'note_ar', 'مدى إرشاديّ للتخطيط فقط وغير ملزِم. السعر النهائيّ يصدر في عرض سعر معتمد.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) أسطح المالك — التكلفة والهامش والأرضية والمعادلة.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sq_quote_internal_detail(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i record; q record;
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;

  select x.code, x.title, x.tier, x.status, x.list_price, x.proposed_price,
         x.authorized_price, x.gross_before_vat, x.vat_rate, x.vat_amount, x.total_after_vat
    into q from public.sq_quotes x where x.id = p_quote;
  if not found then raise exception 'quote not found'; end if;

  select y.base_cost, y.surcharge_cost, y.contingency_pct, y.contingency_amount,
         y.external_supplier_cost, y.internal_cost_estimate, y.target_margin_pct,
         y.min_margin_pct, y.recommended_price, y.min_price, y.gross_profit, y.margin_pct,
         y.overhead_alloc_pct, y.est_net_profit, y.below_floor, y.floor_probe_count,
         y.cost_breakdown, y.formula_snapshot, y.computed_at
    into i from public.sq_quote_internal y where y.quote_id = p_quote;

  if i is null then
    return jsonb_build_object('quote_id', p_quote, 'costed', false,
      'note_ar', 'لم يُحسب هذا العرض داخليًّا بعد — شغّل sq_quote_recompute. القيم غائبة، وليست أصفارًا.');
  end if;

  return jsonb_build_object(
    'quote_id', p_quote, 'costed', true, 'code', q.code, 'title', q.title,
    'tier', q.tier, 'status', q.status,
    'list_price', q.list_price, 'proposed_price', q.proposed_price,
    'authorized_price', q.authorized_price, 'gross_before_vat', q.gross_before_vat,
    'vat_rate', q.vat_rate, 'vat_amount', q.vat_amount, 'total_after_vat', q.total_after_vat,
    'base_cost', i.base_cost, 'surcharge_cost', i.surcharge_cost,
    'contingency_pct', i.contingency_pct, 'contingency_amount', i.contingency_amount,
    'external_supplier_cost', i.external_supplier_cost,
    'internal_cost_estimate', i.internal_cost_estimate,
    'target_margin_pct', i.target_margin_pct, 'min_margin_pct', i.min_margin_pct,
    'recommended_price', i.recommended_price, 'min_price', i.min_price,
    'gross_profit', i.gross_profit, 'margin_pct', i.margin_pct,
    'overhead_alloc_pct', i.overhead_alloc_pct, 'est_net_profit', i.est_net_profit,
    'below_floor', i.below_floor,
    -- ★ عدّاد التحسّس — الكشف الذي يعوّض ما لا يُمنع بنيويًّا ★
    'floor_probe_count', i.floor_probe_count,
    'cost_breakdown', i.cost_breakdown, 'formula_snapshot', i.formula_snapshot,
    'computed_at', i.computed_at);
end $$;

create or replace function public.sq_quotes_list_internal(p_status text default null, p_limit int default 100)
returns table (
  id uuid, code text, client_id uuid, title text, tier text, status text,
  gross_before_vat numeric, internal_cost_estimate numeric, min_price numeric,
  recommended_price numeric, gross_profit numeric, margin_pct numeric,
  est_net_profit numeric, below_floor boolean, floor_probe_count int, cost_complete boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  return query
    select q.id, q.code, q.client_id, q.title, q.tier, q.status,
           q.gross_before_vat, i.internal_cost_estimate, i.min_price,
           i.recommended_price, i.gross_profit, i.margin_pct,
           i.est_net_profit, i.below_floor, i.floor_probe_count,
           coalesce((i.cost_breakdown ->> 'cost_complete')::boolean, false)
      from public.sq_quotes q
      left join public.sq_quote_internal i on i.quote_id = q.id
     where (p_status is null or q.status = p_status)
     order by q.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

create or replace function public.sq_owner_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'quotes_total',       count(*),
    'pending_approval',   count(*) filter (where q.status = 'pending_owner_approval'),
    'below_floor',        count(*) filter (where i.below_floor),
    'uncosted',           count(*) filter (where i.quote_id is null),
    'incomplete_costing', count(*) filter (where coalesce((i.cost_breakdown ->> 'cost_complete')::boolean, false) = false and i.quote_id is not null),
    'probe_alerts',       count(*) filter (where coalesce(i.floor_probe_count, 0) > 0),
    'accepted_value',     coalesce(sum(q.gross_before_vat) filter (where q.status = 'accepted'), 0),
    'accepted_profit',    coalesce(sum(i.gross_profit)     filter (where q.status = 'accepted'), 0),
    'avg_margin_pct',     round(avg(i.margin_pct) filter (where q.status = 'accepted'), 4))
  into v
  from public.sq_quotes q
  left join public.sq_quote_internal i on i.quote_id = q.id;
  return coalesce(v, '{}'::jsonb);
end $$;

create or replace function public.sq_audit_list(p_quote uuid default null, p_limit int default 100)
returns table (id bigint, at timestamptz, actor uuid, action text, entity text, quote_id uuid, payload jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  return query
    select a.id, a.at, a.actor, a.action, a.entity, a.quote_id, a.payload
      from public.sq_audit a
     where (p_quote is null or a.quote_id = p_quote)
     order by a.at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

create or replace function public.sq_settings_set(p_key text, p_value jsonb)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(public.sq_can_view_cost(), false) then raise exception 'not authorized'; end if;
  if p_key is null then raise exception 'المفتاح مطلوب'; end if;
  insert into public.sq_settings (key, value, updated_by, updated_at)
  values (p_key, coalesce(p_value, '{}'::jsonb), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.sq_log('settings_set', 'sq_settings', null, null, jsonb_build_object('key', p_key));
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §14) المنح — منعٌ افتراضيّ، ثمّ قائمة بيضاء صريحة.
--
--   ★ لا جدول ولا تسلسل ممنوح لأحد ★ كلّ قراءة تمرّ بدالّة بقائمة أعمدة
--   مكتوبة بأيدينا. هذا ما يجعل «PostgREST يطلب أيّ عمود» هجومًا مستحيلًا
--   لا هجومًا مُخفَّفًا.
--
--   ★ لا anon في أيّ سطر ★ المدى «العلنيّ» يُقرأ بحساب مسجَّل فقط. نشره إلى
--   زائر مجهول يحتاج قناة أخرى بقرار صريح، ولن يُفتح هنا بالصمت.
--
--   والمساعدات الداخلية غير ممنوحة: sq_setting_num مثلًا تُرجع معاملات
--   المعادلة، ومنحُها يفتح بابًا خلفيًّا كاملًا على التسعير الداخليّ.
-- ════════════════════════════════════════════════════════════════════════════
do $grant$
declare
  f record; t text;
  v_api text[] := array[
    -- سطح البيع
    'sq_tiers','sq_catalog_list','sq_catalog_item_upsert','sq_catalog_item_set_active',
    'sq_price_books_list','sq_price_book_upsert','sq_price_book_versions_list',
    'sq_price_book_version_open','sq_price_book_entry_set','sq_price_book_entries_list',
    'sq_price_book_version_publish',
    'sq_quote_create','sq_quote_inputs_set','sq_quote_inputs_get','sq_quote_line_set',
    'sq_quote_line_delete','sq_quote_terms_set','sq_quote_price_set','sq_quote_milestones_set',
    'sq_quote_submit','sq_quote_new_version','sq_quote_mark_ready_for_manual_send',
    'sq_quote_record_client_decision','sq_expiry_scan',
    'sq_quotes_list','sq_quote_detail','sq_quote_lines_list','sq_quote_milestones_list',
    'sq_my_approvals','sq_approval_withdraw','sq_quote_activity','sq_dashboard',
    'sq_export_quote','sq_ui_settings','sq_my_discount_allowance_info','sq_quote_status_label',
    'sq_public_range',
    -- سطح المالك
    'sq_pricing_rule_upsert','sq_pricing_rule_set_active','sq_pricing_rules_list',
    'sq_cost_rate_set','sq_cost_rates_list','sq_quote_supplier_cost_set','sq_quote_recompute',
    'sq_quote_internal_detail','sq_quotes_list_internal','sq_approvals_list_internal',
    'sq_approval_decide','sq_publish_range','sq_unpublish_range','sq_audit_list',
    'sq_owner_dashboard','sq_settings_set'
  ];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'sq\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    begin execute format('revoke all on function %s from anon', f.sig); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f.sig); exception when undefined_object then null; end;
    if f.proname = any(v_api) then
      begin execute format('grant execute on function %s to authenticated', f.sig); exception when undefined_object then null; end;
    end if;
  end loop;

  foreach t in array array[
    'sq_settings','sq_service_catalog','sq_price_books','sq_price_book_versions',
    'sq_price_book_entries','sq_cost_rates','sq_pricing_rules','sq_quotes',
    'sq_quote_internal','sq_quote_inputs','sq_quote_lines','sq_quote_milestones',
    'sq_approval_requests','sq_audit'
  ] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
  end loop;

  foreach t in array array['sq_quote_code_seq','sq_price_book_code_seq','sq_audit_id_seq'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on sequence public.%I from public', t);
      begin execute format('revoke all on sequence public.%I from anon', t); exception when undefined_object then null; end;
      begin execute format('revoke all on sequence public.%I from authenticated', t); exception when undefined_object then null; end;
    end if;
  end loop;
end $grant$;

-- ════════════════════════════════════════════════════════════════════════════
-- §15) SELF-TEST — ★ ساكن بالكامل ★
--
--   لا يستدعي دالّة محميّة واحدة. محرّر SQL يعمل بدور postgres و auth.uid()
--   = NULL، فاستدعاء بوّابة حيّة إمّا يرفع «not authorized» فيُسقط الترحيلة،
--   وإمّا يُرجع false فيُقرأ كأنّ الحارس مكسور. كلّ فحص هنا يقرأ **تعريف**
--   الكائن من كتالوج النظام (pg_get_functiondef / pg_policies / pg_constraint).
--
--   ولا مصيدة catch-all: كلّ فحص قادر على الفشل، وأيّ نقص يُجمَّع ثمّ يُرفع
--   باستثناء واحد يسمّي كلّ خرق بالاسم.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare
  v_bad text[] := '{}';
  v_tables text[] := array[
    'sq_settings','sq_service_catalog','sq_price_books','sq_price_book_versions',
    'sq_price_book_entries','sq_cost_rates','sq_pricing_rules','sq_quotes',
    'sq_quote_internal','sq_quote_inputs','sq_quote_lines','sq_quote_milestones',
    'sq_approval_requests','sq_audit'];
  v_cost_tables text[] := array[
    'sq_settings','sq_cost_rates','sq_pricing_rules','sq_quote_internal',
    'sq_approval_requests','sq_audit'];
  -- ★ سطح البيع + دالّة نشر المدى ★ نشرُ المدى للمالك، ومع ذلك يخضع لفحص
  --   الرموز نفسه: خطره في **مخرَجه العلنيّ** لا في مستدعيه.
  v_sales_fns text[] := array[
    'sq_quotes_list','sq_quote_detail','sq_quote_lines_list','sq_quote_milestones_list',
    'sq_quote_inputs_get','sq_quote_inputs_set','sq_my_approvals','sq_approval_withdraw',
    'sq_quote_activity','sq_dashboard','sq_export_quote','sq_ui_settings',
    'sq_my_discount_allowance','sq_my_discount_allowance_info',
    'sq_quote_price_set','sq_quote_submit','sq_quote_create','sq_quote_terms_set',
    'sq_quote_line_set','sq_quote_line_delete','sq_quote_milestones_set',
    'sq_quote_new_version','sq_quote_record_client_decision','sq_expiry_scan',
    'sq_quote_mark_ready_for_manual_send','sq_quote_status_label','sq_quote_visible',
    'sq_catalog_list','sq_catalog_item_upsert','sq_catalog_item_set_active',
    'sq_price_books_list','sq_price_book_upsert','sq_price_book_versions_list',
    'sq_price_book_version_open','sq_price_book_entry_set','sq_price_book_entries_list',
    'sq_price_book_version_publish','sq_tiers',
    'sq_public_range','sq_publish_range','sq_unpublish_range'];
  v_cost_tokens text[] := array[
    'sq_quote_internal','sq_cost_rates','sq_pricing_rules','min_price','cost_rate',
    'supplier_rate','crew_rate','internal_cost_estimate','base_cost','surcharge_cost',
    'contingency','overhead','gross_profit','margin_pct','est_net_profit','below_floor',
    'floor_at_request','internal_reason_code','external_supplier_cost','cost_breakdown',
    'formula_snapshot','recommended_price','target_margin','min_margin'];
  v_internal_fns text[] := array[
    'sq_setting_num','sq_setting_json','sq_perm','sq_perm_key_exists','sq_log','sq_notify',
    'sq_can_view_cost','sq_can_approve','sq_quote_visible','sq_my_discount_allowance',
    'sq_next_quote_code','sq_next_price_book_code'];
  t text; f text; tok text; d text; n int;
begin
  -- (١) الجداول موجودة وRLS مفعّل عليها
  foreach t in array v_tables loop
    if to_regclass('public.' || t) is null then
      v_bad := v_bad || ('جدول مفقود: ' || t);
    elsif not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      v_bad := v_bad || ('RLS غير مفعّل: ' || t);
    end if;
  end loop;

  -- (٢) ★ جداول التكلفة تُحرَس ببوّابة المالك، وبها وحدها ★
  foreach t in array v_cost_tables loop
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t
                      and p.qual ilike '%sq_can_view_cost%') then
      v_bad := v_bad || ('جدول تكلفة بلا بوّابة المالك في RLS: ' || t);
    end if;
    if exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = t
                  and (p.qual ilike '%sq_can_view()%' or p.qual ilike '%sq_perm%'
                       or p.qual ilike '%auth.uid()%')) then
      v_bad := v_bad || ('★ باب جانبيّ على جدول تكلفة: ' || t ||
                         ' — مفتاح أو شرط ملكية في سياسته');
    end if;
  end loop;

  -- (٣) ★ البوّابتان للمالك حرفيًّا: لا مفتاح ولا دور إداريّ ★
  foreach f in array array['sq_can_view_cost','sq_can_approve'] loop
    if to_regprocedure('public.' || f || '()') is null then
      v_bad := v_bad || ('بوّابة مفقودة: ' || f);
    else
      d := pg_get_functiondef(to_regprocedure('public.' || f || '()')::oid);
      if d not ilike '%is_owner%' then v_bad := v_bad || (f || ' لا تشترط is_owner'); end if;
      if d not ilike '%is_staff%' then v_bad := v_bad || (f || ' لا تستبعد العميل بـis_staff'); end if;
      if d ilike '%sq_perm%'   then v_bad := v_bad || ('★ ' || f || ' تُفتح بمفتاح صلاحية — صارت منحة'); end if;
      if d ilike '%is_admin%'  then v_bad := v_bad || ('★ ' || f || ' توسّعت إلى الدور الإداريّ'); end if;
      if d ilike '%staff_role%' then v_bad := v_bad || ('★ ' || f || ' تُفتح بدور وظيفيّ'); end if;
    end if;
  end loop;

  -- (٤) ★★ القاعدة الكبرى: لا رمز تكلفة في أيّ دالّة سطح بيع ★★
  foreach f in array v_sales_fns loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f limit 1;
    if d is null then
      v_bad := v_bad || ('دالّة سطح بيع مفقودة: ' || f);
    else
      foreach tok in array v_cost_tokens loop
        if d ilike ('%' || tok || '%') then
          v_bad := v_bad || ('★ رمز تكلفة داخل سطح بيع: ' || f || ' ← ' || tok);
        end if;
      end loop;
      if d ilike '%select *%' then
        v_bad := v_bad || (f || ' تستعمل select * — أوّل عمود يُضاف غدًا يتسرّب');
      end if;
    end if;
  end loop;

  -- (٥) قيود الأمانة الثلاثة — مكتوبة في القاعدة لا في التعليقات
  foreach t in array array['sq_quotes_approval_always','sq_delivery_never_claimed','sq_range_never_binding'] loop
    if not exists (select 1 from pg_constraint c
                    where c.conname = t and c.conrelid = 'public.sq_quotes'::regclass) then
      v_bad := v_bad || ('قيد أمانة مفقود: ' || t);
    end if;
  end loop;

  -- (٦) ★ لا جدول ممنوح لأيّ دور ★
  select count(*) into n
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name like 'sq\_%'
     and g.grantee in ('anon','authenticated','PUBLIC');
  if n > 0 then
    v_bad := v_bad || ('★ ' || n || ' منح مباشر على جداول الموديول — PostgREST يقرأ أعمدة لم نكتبها');
  end if;

  -- (٧) المساعدات الداخلية غير قابلة للتنفيذ من الواجهة
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach f in array v_internal_fns loop
      for n in
        select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = f
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      loop
        v_bad := v_bad || ('★ مساعد داخليّ ممنوح لـauthenticated: ' || f);
      end loop;
    end loop;
  end if;

  -- (٨) المُشغّلات التي تحمل ما لا يجوز أن تحمله الدوالّ
  foreach t in array array['sq_floor_probe_trg','sq_approval_stamp_floor_trg','sq_pbv_seed_trg',
                           'sq_pbv_immutable_trg','sq_pbe_frozen_trg','sq_cost_rates_frozen_trg'] loop
    if not exists (select 1 from pg_trigger g where g.tgname = t and not g.tgisinternal) then
      v_bad := v_bad || ('مُشغّل مفقود: ' || t);
    end if;
  end loop;

  if array_length(v_bad, 1) is not null then
    raise exception E'SMART QUOTING SELF-TEST فشل — لم يُثبَّت شيء:\n  · %',
      array_to_string(v_bad, E'\n  · ');
  end if;

  raise notice 'SMART QUOTING SELF-TEST: كلّ الفحوص مرّت (% جدولًا · حارس التكلفة للمالك حرفيًّا · لا رمز تكلفة في سطح البيع).',
    array_length(v_tables, 1);
end $st$;

notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل
--   ١) شغّل docs/smart_quoting_POSTCHECK.sql — مجموعة نتائج واحدة PASS/FAIL.
--   ٢) امنح مفاتيح quote.* لمن يبنون العروض. **لا تمنح أحدًا تكلفةً**: لا
--      مفتاح لها، وهذا مقصود.
--   ٣) أنشئ دفتر أسعار، افتح نسخة، أدخِل أسعار البيع، وأسعار التكلفة
--      (بحساب المالك)، ثمّ انشر النسخة. لا يُبنى عرض قبل نسخة منشورة.
--   ٤) اضبط قواعد التسعير (target_margin_pct / min_margin_pct لكلّ فئة).
--      بلا قواعد يعمل النظام بـ٣٥٪ مستهدف و١٥٪ حدًّا أدنى افتراضيًّا.
-- ════════════════════════════════════════════════════════════════════════════
