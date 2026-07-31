-- ════════════════════════════════════════════════════════════════════════════
-- asset_intelligence_RUNME.sql — ذكاء الأصول: QR، حالة، حجوزات، صيانة، استخدام،
-- تكلفة.  ✱ توسعة إضافية فوق نظام العهدة القائم — لا نظام أصول ثانٍ ✱
--
-- ─── الحكم الحاكم (اقرأه قبل أيّ سطر) ──────────────────────────────────────
-- يوجد بالفعل نظام أصول كامل: custody_inventory_* (57+ جدولًا، ~120 RPC، لوحة
-- بأربعة عشر تبويبًا). إنشاء عائلة asset_* بجانبه يمنح الكاميرا الواحدة مصدرَي
-- حقيقة — وهذا أسوأ من ميزة ناقصة، لأنّ أحدًا بعده لا يعرف أيّ رقم هو الصحيح.
-- لذلك هذا الملفّ **يُعيد الاستخدام** ولا يُنشئ إلّا حيث لا يوجد وعاء للمفهوم.
--
-- ما أُعيد استخدامه (لم يُلمس، يُشار إليه فقط):
--   custody_inventory_assets            سيّد الأصول (كود/باركود/QR/كمّيات/حالة)
--   custody_inventory_movements         دفتر الحركة الملحق — عمود التدقيق كلّه
--   custody_inventory_assignments/_items دورة الصرف→التأكيد→الإرجاع→الفحص
--   custody_inventory_evidence          أدلّة الصور بمراحلها الستّ
--   custody_inventory_reservations      جدول الحجز (قائم — يُحرَس هنا، لا يُستبدَل)
--   custody_inventory_maintenance       حدث الصيانة الواحد (يُربَط بالخطط هنا)
--   custody_condition_reports           أغنى سجلّ حالة (٩ درجات) — يُوفَّق لا يُستنسخ
--   custody_qr_events                   سجلّ QR (طباعة/إعادة إصدار/إلغاء/مسح)
--   custody_inventory_kits/_components   الأطقم والملحقات
--   civ_can_manage/_admin/_finance/_delete_asset/_is_employee   البوّابات القائمة
--   civ_set_avail · civ_gen_no · civ_notify_managers · custody_audit · civ_flag
--   prodops_asset_clash                 عقد التعارض القائم (23P01) — يُستهلَك لا يُنافَس
--
-- ما أُنشئ جديدًا، ولماذا (لا شيء غيره):
--   custody_inventory_maintenance_plans  لا شيء في القاعدة يحمل «جدول صيانة»:
--       custody_inventory_maintenance صفٌّ لكلّ حدث، لا لكلّ سياسة تكرار.
--   custody_inventory_meter_readings     لا شيء في القاعدة يحمل «قراءة عدّاد»:
--       custody_finance_asset_usage تعدّ مرّات الصرف لا ساعات التشغيل.
--   أعمدة إضافية على جداول قائمة (لا جداول موازية): درجة الحالة، قيمة الخردة،
--   بيانات التخريد والسرقة والوسوم على الأصل؛ إتمام الحجز ومهلته على الحجز.
--
-- ─── قواعد لم تُخرَق ───────────────────────────────────────────────────────
--   • civ_can_manage()/civ_can_finance()/civ_can_delete_asset() **لا تُعاد كتابتها**
--     هنا إطلاقًا. النسخة المحصّنة تعيش في authz_fixC؛ إعادة تعريفها بلا coalesce
--     تعيد فتح انهيار NULL في ~120 موضع.
--   • كلّ مُسنَد جديد يعيد boolean صريحًا على كلّ مسار (coalesce(...,false)).
--   • لا كتابة في quantity_available خارج قفل for update يكتب معه صفّ حركة.
--   • لا سياسة كتابة مباشرة: RLS = SELECT فقط، والكتابة عبر RPC.
--   • لا anon، لا service_role، SECURITY DEFINER بمسار بحث مثبَّت.
--   • منصّة المشاريع مجمَّدة: project_id مرجع قراءة اختياريّ لا أكثر.
--   • لا استنتاج ربح: ملخّص التكلفة لا يلمس فواتير/عروض/fin_* إطلاقًا.
--
-- التشغيل: بعد asset_intelligence_PREFLIGHT.sql (وهو يوقفك إن نقص الأساس).
-- idempotent · معاملات · لا CONCURRENTLY.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) بوّابة صلبة قبل المعاملة — لا نصف ترحيلة على عهد حيّة ─────────────
do $pre$
declare t text; missing text := '';
begin
  foreach t in array array[
    'public.custody_inventory_assets','public.custody_inventory_movements',
    'public.custody_inventory_assignments','public.custody_inventory_assignment_items',
    'public.custody_inventory_reservations','public.custody_inventory_maintenance'
  ] loop
    if to_regclass(t) is null then missing := missing || ' ' || t; end if;
  end loop;
  -- ★ custody_audit وciv_notify_managers **إلزاميّتان** لا اختياريّتان: كلّ كتابة
  --   حسّاسة هنا تناديهما بلا حارس، وplpgsql متأخّرة الربط — فغيابهما لا يُفشل
  --   الترحيلة بل يُفشل أوّل حجز حقيقيّ بـ42883 بعد أسابيع. يُكتشف الآن.
  foreach t in array array['public.civ_can_manage()','public.civ_set_avail(uuid)',
                           'public.civ_gen_no(text)','public.is_owner()','public.is_staff()',
                           'public.custody_audit(text,text,uuid,jsonb)',
                           'public.civ_notify_managers(text,uuid,text,text)'] loop
    if to_regprocedure(t) is null then missing := missing || ' ' || t; end if;
  end loop;
  if missing <> '' then
    raise exception 'ASSET PREFLIGHT: الأساس ناقص (%) — شغّل portal_custody_inventory_system_v1_RUNME.sql أوّلًا. هذه الحزمة توسّع نظام العهدة القائم ولا تُنشئ بديلًا عنه.', missing;
  end if;
  if not coalesce(pg_get_functiondef(to_regprocedure('public.civ_can_manage()')) ilike '%coalesce%', false) then
    raise exception 'ASSET PREFLIGHT: civ_can_manage() بلا coalesce ⇒ fail-open. شغّل authz_fixC_null_failopen_gates_RUNME.sql أوّلًا.';
  end if;
  if (to_regclass('public.ops_job_equipment') is not null)
     <> (to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null) then
    raise exception 'ASSET PREFLIGHT: prodops نصف مطبَّق — محرّك الحجز هنا يستهلك عقده؛ نصف تطبيق = تقويم ثالث أعمى يبدو مغطّى.';
  end if;
  if exists (select 1 from public.custody_inventory_assets
              where quantity_available < 0 or quantity_available > quantity_total) then
    raise exception 'ASSET PREFLIGHT: صفوف تخالف ثابت المخزون — صحّحها بحركة stock_adjustment قبل شدّ الثوابت.';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) المُسنَدات الستّة — ضيّقة، لا توسّع البوّابة العريضة القائمة
--
-- civ_can_manage() بوّابة واحدة عريضة جدًّا (كتالوج + صرف + تعديل مخزون + رفع).
-- كلّ قدرة جديدة تُعلَن **مُسنَدًا جديدًا** يُشتقّ منها، لا توسيعًا لها. النتيجة:
-- من يملك manage اليوم لا يفقد شيئًا، ومن يُمنَح مفتاحًا دقيقًا لا يرث الباقي.
-- كلّ مُسنَد يعيد boolean صريحًا: coalesce(...) على كلّ مسار.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر إلى كتالوج الصلاحيات الدقيق — يسقط إلى false إن كان الكتالوج غائبًا
-- (fail-closed: غياب المُحلِّل لا يمنح أحدًا شيئًا).
create or replace function public.civ_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if to_regprocedure('public.emp_has_permission(text)') is null then return false; end if;
  execute 'select public.emp_has_permission($1)' into v using p_key;
  return coalesce(v, false);
exception when others then return false;
end $fn$;
revoke execute on function public.civ_perm(text) from public, anon, authenticated;

-- قراءة الأصول تشغيليًّا: التوافر، الحالة، الصيانة، القيود، موعد العودة — بلا مال.
create or replace function public.civ_can_view_assets() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.civ_can_manage(), false) or coalesce(public.civ_perm('assets.view'), false);
$fn$;

-- تعديل الكتالوج (بيانات الأصل، الوسوم، التخريد، الملحقات).
create or replace function public.civ_can_manage_assets() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.civ_can_manage(), false) or coalesce(public.civ_perm('assets.manage'), false);
$fn$;

-- صرف عهدة / إنشاء حجز.
create or replace function public.civ_can_issue_custody() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.civ_can_manage(), false) or coalesce(public.civ_perm('custody.issue'), false);
$fn$;

-- إغلاق عهدة بعد فحص الإرجاع.
create or replace function public.civ_can_close_custody() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.civ_can_manage(), false) or coalesce(public.civ_perm('custody.close'), false);
$fn$;

-- خطط الصيانة وأوامرها.
create or replace function public.civ_can_manage_maintenance() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce(public.civ_can_manage(), false) or coalesce(public.civ_perm('maintenance.manage'), false);
$fn$;

-- ★ التكلفة الحسّاسة: المالك، ومَن يملك civ_can_finance() القائمة (وهي تريه سعر
--   الشراء اليوم أصلًا، فلا توسيع هنا). **لا مفتاح صلاحية دقيق يُمنَح لمهنة** —
--   عمدًا: هذا السطح لا يُفتح بترقية مهنة، بل بدور مالك/مالية معلن.
--   civ_can_finance() قد تعيد NULL (لم تُلفّ بـcoalesce في مصدرها) — نلفّها هنا،
--   ولا نعيد تعريفها هناك.
create or replace function public.civ_can_view_asset_sensitive_costs() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if coalesce(public.is_owner(), false) then return true; end if;
  if to_regprocedure('public.civ_can_finance()') is null then return false; end if;
  execute 'select public.civ_can_finance()' into v;
  return coalesce(v, false);
exception when others then return false;
end $fn$;

revoke execute on function public.civ_can_view_assets(), public.civ_can_manage_assets(),
  public.civ_can_issue_custody(), public.civ_can_close_custody(),
  public.civ_can_manage_maintenance(), public.civ_can_view_asset_sensitive_costs()
  from public, anon;
grant execute on function public.civ_can_view_assets(), public.civ_can_manage_assets(),
  public.civ_can_issue_custody(), public.civ_can_close_custody(),
  public.civ_can_manage_maintenance(), public.civ_can_view_asset_sensitive_costs()
  to authenticated;

comment on function public.civ_can_view_asset_sensitive_costs() is
  'التكلفة الحسّاسة للأصل: مالك أو civ_can_finance(). لا يُمنَح عبر كتالوج الصلاحيات عمدًا، ولا يلمس أيّ جدول مالي/فواتير (لا استنتاج ربح).';

-- ════════════════════════════════════════════════════════════════════════════
-- §2) أعمدة إضافية على جداول قائمة — لا جدول موازٍ لأيّ منها
-- ════════════════════════════════════════════════════════════════════════════

-- (أ) الأصل: درجة حالة موحّدة، قيمة خردة، وسوم، سرقة، تخريد.
alter table public.custody_inventory_assets add column if not exists condition_grade text;
alter table public.custody_inventory_assets add column if not exists condition_grade_at timestamptz;
alter table public.custody_inventory_assets add column if not exists salvage_value numeric;
alter table public.custody_inventory_assets add column if not exists tags text[];
alter table public.custody_inventory_assets add column if not exists stolen_reported_at timestamptz;
alter table public.custody_inventory_assets add column if not exists stolen_report_ref text;
alter table public.custody_inventory_assets add column if not exists disposal_date date;
alter table public.custody_inventory_assets add column if not exists disposal_method text;
alter table public.custody_inventory_assets add column if not exists disposal_reason text;
alter table public.custody_inventory_assets add column if not exists disposal_proceeds numeric;
alter table public.custody_inventory_assets add column if not exists disposal_approved_by uuid references auth.users(id);
alter table public.custody_inventory_assets add column if not exists disposal_approved_at timestamptz;

-- (ب) الحجز: إتمام قابل للتسجيل + مهلة الحجز المؤقّت.
alter table public.custody_inventory_reservations add column if not exists fulfilled_by_assignment_id uuid;
alter table public.custody_inventory_reservations add column if not exists fulfilled_at timestamptz;
alter table public.custody_inventory_reservations add column if not exists hold_expires_at timestamptz;
alter table public.custody_inventory_reservations add column if not exists updated_by uuid references auth.users(id);

-- (ج) التصنيف: مخطّط ترقيم اختياريّ (من توصية التدقيق §12).
alter table public.custody_inventory_categories add column if not exists code_scheme text;

-- قيود مُحكَمة تُضاف مرّة واحدة (لا add constraint if not exists في PostgreSQL).
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'civ_asset_condition_grade_chk') then
    alter table public.custody_inventory_assets add constraint civ_asset_condition_grade_chk
      check (condition_grade is null or condition_grade in
        ('excellent','good','used','has_notes','partially_damaged','damaged','unusable','incomplete','missing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'civ_asset_salvage_chk') then
    alter table public.custody_inventory_assets add constraint civ_asset_salvage_chk
      check (salvage_value is null or salvage_value >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'civ_asset_disposal_method_chk') then
    alter table public.custody_inventory_assets add constraint civ_asset_disposal_method_chk
      check (disposal_method is null or disposal_method in ('sold','scrapped','donated','traded_in','written_off','other'));
  end if;
  -- ★ NOT VALID مقصود: الجدول حيّ. حجز ملغى قديم بنافذة مقلوبة كان سيُفشل الترحيلة
  --   كلّها عند التحقّق الرجعيّ. الـPREFLIGHT يوقف على المقلوب **النشط** فقط (وهو
  --   ما يضرّ فعلًا)، والقيد هنا يحرس كلّ إدراج وتحديث من الآن فصاعدًا. التاريخ
  --   الملغى يبقى كما هو بدل أن يُعاد كتابته سرًّا لإرضاء قيد جديد.
  if not exists (select 1 from pg_constraint where conname = 'civ_resv_window_chk') then
    alter table public.custody_inventory_reservations add constraint civ_resv_window_chk
      check (reserved_from is null or reserved_to is null or reserved_to > reserved_from) not valid;
  end if;
end $c$;

-- (د) QR: نفس أعمدة الترقيع المؤسّسي 01 حرفيًّا (add column if not exists ⇒ لا شيء
--     يحدث إن كان مطبَّقًا). تُضاف هنا كي لا تُشحن وحدة QR كاملة فوق عمود غائب
--     فتنهار بـ42703 عند أوّل مسح ميدانيّ بدل أن تعمل.
alter table public.custody_inventory_assets add column if not exists qr_token uuid;
alter table public.custody_inventory_assets add column if not exists barcode_value text;
alter table public.custody_inventory_assets add column if not exists qr_status text not null default 'active'
  check (qr_status in ('active','reissued','revoked'));
alter table public.custody_inventory_assets add column if not exists label_version int not null default 1;
-- رمز غير قابل للتخمين: gen_random_uuid لكلّ أصل بلا رمز، وفريد على مستوى الجدول.
update public.custody_inventory_assets set qr_token = gen_random_uuid() where qr_token is null;
create unique index if not exists uq_civ_asset_qr_token
  on public.custody_inventory_assets(qr_token) where qr_token is not null;

create index if not exists idx_civ_resv_window
  on public.custody_inventory_reservations(asset_id, reserved_from, reserved_to) where status = 'active';
create index if not exists idx_civ_assets_tags on public.custody_inventory_assets using gin (tags);

-- ─── (هـ) بانية نافذة آمنة — لأنّ tstzrange تنفجر على الحدّ المقلوب ─────────
-- ★ الخطر الحقيقي: tstzrange(lo, hi) ترفع 22000 «range lower bound must be less
--   than or equal to range upper bound» حين hi < lo. وهذه الحزمة **تتعمّد** إبقاء
--   الصفوف المقلوبة القديمة: القيد civ_resv_window_chk أُضيف NOT VALID، وPREFLIGHT
--   يوقف على الحجز **النشط** المقلوب فقط. أي أنّنا وعدنا صراحةً بأنّ حجزًا ملغى
--   بنافذة مقلوبة يبقى في الجدول — ثمّ نقرؤه في التقويم عبر tstzrange فينفجر.
--   الأسوأ أنّ صفّ عهدة بـexpected_return_at أقدم من issued_at (ترحيل سجلّ ورقيّ
--   قديم، أو تاريخ عودة بسنة مطبوعة خطأً) يجعل **كلّ** محاولة حجز على ذلك الأصل
--   ترفع 22000 من داخل الحارس: فشلٌ مغلق برمز لا تصنّفه lib/portal/pgerror.ts،
--   فيظهر للمستخدم كخطأ مجهول بدل «تعارض» أو «بيانات تالفة».
-- المعالجة: نافذة مقلوبة تُطبَّع بتبديل الحدّين، فتبقى محجوزةً لمدّتها بدل أن
-- تُسقَط بصمت — وهو الخيار المحافظ: التعارض يستمرّ في المنع، ولا يُفتح شيء.
-- لا SECURITY DEFINER: دالّة حسابية بحتة لا تلمس جدولًا.
create or replace function public.civ_window(p_lo timestamptz, p_hi timestamptz)
returns tstzrange language sql immutable parallel safe as $fn$
  select case
    when p_lo is not null and p_hi is not null and p_hi < p_lo
      then tstzrange(p_hi, p_lo)
    else tstzrange(p_lo, p_hi)
  end;
$fn$;
revoke execute on function public.civ_window(timestamptz,timestamptz) from public, anon;
grant  execute on function public.civ_window(timestamptz,timestamptz) to authenticated;
comment on function public.civ_window(timestamptz,timestamptz) is
  'بانية نافذة زمنيّة لا ترفع 22000: الحدّ المقلوب يُطبَّع بالتبديل لا يُسقَط. تُستعمل في كلّ مقارنة نوافذ هنا لأنّ الجداول حيّة وتحوي صفوفًا تاريخيّة مقلوبة تعمّدنا عدم إعادة كتابتها.';

comment on column public.custody_inventory_assets.condition_grade is
  'درجة الحالة بمفردات custody_condition_reports.grade التسعة — تُشتقّ من آخر تقرير inspector_final، ولا تُنشئ مفردات جديدة.';
comment on column public.custody_inventory_reservations.hold_expires_at is
  'مهلة الحجز المؤقّت. انقضاؤها لا يحذف الصفّ — custody_inv_expire_reservations يحوّله إلى expired فيبقى الأثر.';

-- ════════════════════════════════════════════════════════════════════════════
-- §3) جدولان جديدان — فقط لأنّ لا وعاء لهذين المفهومين في القاعدة
-- ════════════════════════════════════════════════════════════════════════════

-- (أ) خطط الصيانة: «كلّ ٦ أشهر» / «كلّ ٥٠٠ ساعة» / «كلّ ١٠٠ استخدام» / عتبة يدوية.
--     custody_inventory_maintenance يسجّل الحدث؛ لا شيء يسجّل السياسة.
create table if not exists public.custody_inventory_maintenance_plans (
  id                    uuid primary key default gen_random_uuid(),
  plan_code             text not null unique,
  plan_name             text not null,
  asset_id              uuid references public.custody_inventory_assets(id),
  category_id           uuid references public.custody_inventory_categories(id),
  maintenance_type      text not null default 'preventive'
                        check (maintenance_type in ('preventive','inspection','calibration','other')),
  interval_days         int    check (interval_days is null or interval_days > 0),
  interval_meter_type   text   check (interval_meter_type is null or interval_meter_type in
                          ('usage_hours','sessions','shutter_count','battery_cycles','flight_hours','recording_hours','distance_km','custom')),
  interval_meter_value  numeric check (interval_meter_value is null or interval_meter_value > 0),
  interval_usage_count  int    check (interval_usage_count is null or interval_usage_count > 0),
  manual_threshold_note text,
  lead_time_days        int not null default 7 check (lead_time_days >= 0),
  last_done_at          timestamptz,
  last_done_meter       numeric,
  last_done_usage_count int,
  blocks_availability   boolean not null default false,
  is_active             boolean not null default true,
  notes                 text,
  created_by            uuid references auth.users(id),
  updated_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  is_deleted            boolean not null default false,
  deleted_at            timestamptz,
  deleted_by            uuid references auth.users(id),
  delete_reason         text,
  -- الخطّة تخصّ أصلًا بعينه أو تصنيفًا كاملًا — لا خطّة معلّقة في الفراغ.
  constraint civ_plan_target_chk check (asset_id is not null or category_id is not null),
  -- خطّة بلا أيّ فاصل ليست خطّة، بل نيّة.
  constraint civ_plan_interval_chk check (
    interval_days is not null or interval_usage_count is not null
    or (interval_meter_type is not null and interval_meter_value is not null)
    or nullif(btrim(coalesce(manual_threshold_note,'')),'') is not null),
  -- فاصل العدّاد يحتاج نوعًا وقيمة معًا، وإلّا فهو رقم بلا وحدة.
  constraint civ_plan_meter_pair_chk check (
    (interval_meter_type is null) = (interval_meter_value is null))
);
create index if not exists idx_civ_plans_asset on public.custody_inventory_maintenance_plans(asset_id) where is_deleted = false;
create index if not exists idx_civ_plans_cat   on public.custody_inventory_maintenance_plans(category_id) where is_deleted = false;
comment on table public.custody_inventory_maintenance_plans is
  'سياسة تكرار الصيانة. تُغذّي custody_inventory_maintenance ولا تحلّ محلّه: الخطّة تقول متى، والحدث يقول ماذا جرى.';

-- (ب) دفتر الاستخدام — ملحق كدفتر الحركة تمامًا: لا UPDATE، لا DELETE، لا TRUNCATE.
--     التصحيح بعكس القيد فقط، والتكرار يُبتلَع بمفتاح تعطيل التكرار.
create table if not exists public.custody_inventory_meter_readings (
  id                   uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references public.custody_inventory_assets(id),
  meter_type           text not null check (meter_type in
                         ('usage_hours','sessions','shutter_count','battery_cycles','flight_hours','recording_hours','distance_km','custom')),
  custom_meter_label   text,
  entry_type           text not null default 'reading' check (entry_type in ('reading','reversal')),
  reading_mode         text not null default 'increment' check (reading_mode in ('increment','absolute')),
  value                numeric not null,
  unit                 text,
  source               text not null default 'manual'
                       check (source in ('manual','device','import','custody_return','maintenance','rental','other')),
  recorded_at          timestamptz not null default now(),
  recorded_by          uuid references auth.users(id),
  assignment_id        uuid references public.custody_inventory_assignments(id),
  maintenance_id       uuid references public.custody_inventory_maintenance(id),
  job_reference        text,
  project_id           uuid,                                   -- مرجع قراءة اختياريّ فقط (المنصّة مجمَّدة)
  reverses_reading_id  uuid references public.custody_inventory_meter_readings(id),
  reversal_reason      text,
  idempotency_key      text,
  note                 text,
  created_at           timestamptz not null default now(),
  -- عكسٌ بلا مرجع ليس تصحيحًا، وقراءةٌ تحمل مرجع عكس تناقض.
  constraint civ_meter_reversal_chk check (
    (entry_type = 'reversal' and reverses_reading_id is not null)
    or (entry_type = 'reading' and reverses_reading_id is null)),
  constraint civ_meter_custom_chk check (
    meter_type <> 'custom' or nullif(btrim(coalesce(custom_meter_label,'')),'') is not null),
  constraint civ_meter_value_chk check (
    entry_type = 'reversal' or reading_mode = 'absolute' or value >= 0)
);
create index if not exists idx_civ_meter_asset on public.custody_inventory_meter_readings(asset_id, meter_type, recorded_at desc);
create index if not exists idx_civ_meter_reverses on public.custody_inventory_meter_readings(reverses_reading_id) where reverses_reading_id is not null;
-- ★ حماية عبر-الأصول: المفتاح فريد عالميًّا. إعادة إرسال بالمفتاح نفسه لأصل آخر
--   تُرفض بدل أن تُقيَّد على الأصل الخطأ بصمت.
create unique index if not exists uq_civ_meter_idem
  on public.custody_inventory_meter_readings(idempotency_key) where idempotency_key is not null;
-- عكس واحد لكلّ قراءة — لا عكس العكس.
create unique index if not exists uq_civ_meter_one_reversal
  on public.custody_inventory_meter_readings(reverses_reading_id) where reverses_reading_id is not null;
comment on table public.custody_inventory_meter_readings is
  'دفتر استخدام ملحق (ساعات/جلسات/عدّاد غالق/دورات بطارية/ساعات طيران/تسجيل/مسافة). ملحق لا يُعدَّل: UPDATE وDELETE وTRUNCATE ممنوعة بمُشغِّلات، والتصحيح بعكس القيد.';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) توفيق مفردات الحالة — دالّة اشتقاق، لا جدول درجات ثالث
--
-- في القاعدة ثلاث مفردات حالة: assets.condition_status (٨)،
-- custody_condition_reports.grade (٩ — الأغنى، بصور وفيديو)، وحقل نصّ حرّ على
-- بند العهدة. الحلّ ليس مفردة رابعة، بل جسر: الدرجة التسعية تبقى مصدر الوصف،
-- وتُترجَم إلى condition_status الثمانية القائمة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.civ_grade_to_condition(p_grade text) returns text
language sql immutable set search_path = public as $fn$
  select case lower(coalesce(p_grade,''))
    when 'excellent'         then 'excellent'
    when 'good'              then 'good'
    when 'used'              then 'good'
    when 'has_notes'         then 'fair'
    when 'partially_damaged' then 'fair'
    when 'damaged'           then 'damaged'
    when 'unusable'          then 'damaged'
    when 'incomplete'        then 'fair'
    when 'missing'           then 'lost'
    else null end;
$fn$;

create or replace function public.civ_condition_to_grade(p_condition text) returns text
language sql immutable set search_path = public as $fn$
  select case lower(coalesce(p_condition,''))
    when 'new'               then 'excellent'
    when 'excellent'         then 'excellent'
    when 'good'              then 'good'
    when 'fair'              then 'has_notes'
    when 'damaged'           then 'damaged'
    when 'under_maintenance' then 'partially_damaged'
    when 'lost'              then 'missing'
    when 'retired'           then 'unusable'
    else null end;
$fn$;

-- مزامنة الدرجة على الأصل عند تسجيل تقرير حالة نهائيّ من المفتّش.
-- لا يكتب condition_status: ذلك يبقى بيد دورة الفحص القائمة (لا مصدر حقيقة ثانٍ
-- للتوافر)، وإنّما يحفظ الدرجة الوصفية وتاريخها.
create or replace function public.civ_sync_condition_grade() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.stage = 'inspector_final' and new.asset_id is not null and coalesce(new.is_deleted, false) = false then
    update public.custody_inventory_assets
       set condition_grade = new.grade, condition_grade_at = coalesce(new.recorded_at, now())
     where id = new.asset_id
       and (condition_grade_at is null or condition_grade_at <= coalesce(new.recorded_at, now()));
  end if;
  return new;
end $fn$;

do $t$
begin
  if to_regclass('public.custody_condition_reports') is not null then
    execute 'drop trigger if exists trg_civ_sync_condition_grade on public.custody_condition_reports';
    execute 'create trigger trg_civ_sync_condition_grade after insert on public.custody_condition_reports
             for each row execute function public.civ_sync_condition_grade()';
    -- تعبئة أوّلية من آخر تقرير نهائيّ لكلّ أصل (لا يخترع درجة لأصل بلا تقرير).
    execute $q$
      update public.custody_inventory_assets a
         set condition_grade = s.grade, condition_grade_at = s.recorded_at
        from (select distinct on (r.asset_id) r.asset_id, r.grade, r.recorded_at
                from public.custody_condition_reports r
               where r.stage = 'inspector_final' and r.asset_id is not null
                 and coalesce(r.is_deleted, false) = false
               order by r.asset_id, r.recorded_at desc) s
       where a.id = s.asset_id and a.condition_grade is null
    $q$;
  end if;
end $t$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) آلة الحالة — مُشتقّة ومُعلَنة ومحروسة
--
-- المفردات العشر المطلوبة (available · reserved · checked_out · in_use ·
-- returned_pending_inspection · maintenance · damaged · missing · retired ·
-- disposed) **تُشتقّ** من الأعمدة القائمة ولا تُضاف إلى أيّ CHECK. اختراع مفردة
-- قاعدة بيانات جديدة لوصف حالة قائمة هو بالضبط كيف يولد مصدر الحقيقة الثاني.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.civ_asset_state(p_asset uuid) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare a record; v_live int; v_confirmed int; v_inspect int; v_resv int;
begin
  select id, is_deleted, availability_status, condition_status, quantity_available,
         quantity_total, quantity_in_maintenance, disposal_date
    into a from public.custody_inventory_assets where id = p_asset;
  if a.id is null then return null; end if;

  -- التخريد أوّلًا: صفّ محذوف منطقيًّا بتاريخ تخريد = disposed، وإلّا retired.
  if coalesce(a.is_deleted, false) then
    return case when a.disposal_date is not null then 'disposed' else 'retired' end;
  end if;
  if a.disposal_date is not null then return 'disposed'; end if;
  if a.condition_status = 'retired' or a.availability_status = 'retired' then return 'retired'; end if;
  if a.condition_status = 'lost' or a.availability_status = 'lost' then return 'missing'; end if;

  select count(*) filter (where i.status in ('pending','active','return_requested','disputed')),
         count(*) filter (where i.status = 'active'),
         count(*) filter (where i.status = 'return_requested' or asg.status in ('under_inspection','return_requested'))
    into v_live, v_confirmed, v_inspect
    from public.custody_inventory_assignment_items i
    join public.custody_inventory_assignments asg on asg.id = i.assignment_id and asg.is_deleted = false
   where i.asset_id = p_asset;

  if coalesce(v_inspect, 0) > 0 then return 'returned_pending_inspection'; end if;
  if a.availability_status = 'maintenance' or coalesce(a.quantity_in_maintenance,0) >= coalesce(a.quantity_total,0)
     then return 'maintenance'; end if;
  if a.condition_status = 'damaged' and coalesce(v_live,0) = 0 then return 'damaged'; end if;
  if coalesce(v_confirmed, 0) > 0 then return 'in_use'; end if;
  if coalesce(v_live, 0) > 0 then return 'checked_out'; end if;

  select count(*) into v_resv from public.custody_inventory_reservations
   where asset_id = p_asset and status = 'active'
     and public.civ_window(reserved_from, reserved_to) @> now();
  if coalesce(v_resv, 0) > 0 then return 'reserved'; end if;

  if coalesce(a.quantity_available, 0) > 0 then return 'available'; end if;
  return 'checked_out';
end $fn$;

-- الانتقالات المسموحة — مُعلَنة كي تكفّ الشاشة عن التخمين. قراءة فقط.
create or replace function public.civ_allowed_transitions(p_entity text, p_from text) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    case lower(coalesce(p_entity,''))
      when 'asset' then
        case lower(coalesce(p_from,''))
          when 'available'                   then '["reserved","checked_out","maintenance","damaged","missing","retired"]'
          when 'reserved'                    then '["available","checked_out","maintenance","missing"]'
          when 'checked_out'                 then '["in_use","returned_pending_inspection","missing","damaged"]'
          when 'in_use'                      then '["returned_pending_inspection","missing","damaged"]'
          when 'returned_pending_inspection' then '["available","damaged","maintenance","missing"]'
          when 'maintenance'                 then '["available","damaged","retired"]'
          when 'damaged'                     then '["maintenance","retired","available"]'
          when 'missing'                     then '["available","retired"]'
          when 'retired'                     then '["disposed"]'
          when 'disposed'                    then '[]'
          else null end
      when 'assignment' then
        case lower(coalesce(p_from,''))
          when 'draft'                         then '["pending_employee_confirmation","cancelled"]'
          when 'pending_employee_confirmation' then '["active","rejected","cancelled"]'
          when 'active'                        then '["return_requested","disputed","partially_returned"]'
          when 'return_requested'              then '["under_inspection","disputed"]'
          when 'under_inspection'              then '["returned","partially_returned","disputed"]'
          when 'partially_returned'            then '["return_requested","under_inspection","returned","disputed"]'
          when 'returned'                      then '[]'
          when 'rejected'                      then '[]'
          when 'cancelled'                     then '[]'
          when 'disputed'                      then '["under_inspection","returned"]'
          else null end
      when 'reservation' then
        case lower(coalesce(p_from,''))
          when 'active'    then '["fulfilled","cancelled","expired"]'
          when 'fulfilled' then '[]'
          when 'cancelled' then '[]'
          when 'expired'   then '[]'
          else null end
      else null end::jsonb,
    '[]'::jsonb);
$fn$;

-- ─── حارس (١): لا أحد يعتمد إغلاق عهدته بنفسه ─────────────────────────────
-- على الجدول لا داخل RPC واحدة: لـcustody_inv_admin_inspect_return أربعة تعاريف
-- في المستودع وآخر ملفّ يُشغَّل يفوز. المُشغِّل يمسك المسارات الأربعة معًا.
create or replace function public.civ_guard_assignment_closure() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'returned' and old.status is distinct from 'returned'
     and coalesce(auth.uid() = new.employee_user_id, false) then
    raise exception 'civ_self_closure_denied: لا يجوز اعتماد إغلاق عهدتك بنفسك — يعتمدها مسؤول آخر بعد فحص الإرجاع.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;
drop trigger if exists trg_civ_guard_assignment_closure on public.custody_inventory_assignments;
create trigger trg_civ_guard_assignment_closure
  before update on public.custody_inventory_assignments
  for each row execute function public.civ_guard_assignment_closure();

-- ─── حارس (٢): تاريخ العهدة المغلقة لا يُحرَّر بصمت ────────────────────────
-- بعد الإغلاق يكون التصحيح **حدثًا** (custody_inv_post_closure_correction) يكتب
-- حركة manual_correction وتدقيقًا — لا تعديلًا صامتًا لحقول الإقرار الأصلية.
create or replace function public.civ_guard_assignment_history() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if old.status in ('returned','cancelled','rejected') then
    if new.ack_snapshot     is distinct from old.ack_snapshot
    or new.ack_name         is distinct from old.ack_name
    or new.ack_ip           is distinct from old.ack_ip
    or new.issued_at        is distinct from old.issued_at
    or new.assignment_number is distinct from old.assignment_number
    or new.employee_user_id is distinct from old.employee_user_id then
      raise exception 'civ_history_immutable: حقول إقرار العهدة المغلقة لا تُعدَّل — سجّل تصحيحًا عبر custody_inv_post_closure_correction.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists trg_civ_guard_assignment_history on public.custody_inventory_assignments;
create trigger trg_civ_guard_assignment_history
  before update on public.custody_inventory_assignments
  for each row execute function public.civ_guard_assignment_history();

-- ─── حارس (٣): مسار الدليل الأصليّ لا يُعاد كتابته ────────────────────────
-- استبدال صورة = صفّ جديد بمرحلته وتوقيته وفاعله. إعادة كتابة file_path تُبدّل
-- الصورة تحت السجلّ نفسه فتضيع «قبل/بعد».
create or replace function public.civ_guard_evidence_path() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.file_path is distinct from old.file_path then
    raise exception 'civ_evidence_path_immutable: مسار الدليل ثابت — أضِف دليلًا جديدًا بدل تبديل الصورة تحت السجلّ نفسه.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;
drop trigger if exists trg_civ_guard_evidence_path on public.custody_inventory_evidence;
create trigger trg_civ_guard_evidence_path
  before update on public.custody_inventory_evidence
  for each row execute function public.civ_guard_evidence_path();

-- ─── حارس (٤): لا تخريد ولا تقاعد لأصل على عهدة حيّة ──────────────────────
-- ⚠️ مضبوط بدقّة عمدًا. الأصل الكمّيّ يجوز تقاعد بعض وحداته بينما وحدات أخرى على
--    عهدة (وهذا ما يفعله إغلاق الصيانة القائم بحالة retired/lost على جزء الكمّية)،
--    فالحظر الأعمى هنا كان سيكسر مسارًا سليمًا. المحظور فعلًا:
--      (أ) تخريد أيّ أصل عليه عهدة حيّة — التخريد نهائيّ ولا يُرجَّع،
--      (ب) تقاعد أصل **متسلسل** عليه عهدة حيّة — القطعة نفسها لا تكون متقاعدة
--          ومصروفة في آن واحد.
create or replace function public.civ_guard_asset_disposal() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_live int; v_disposing boolean; v_retiring boolean;
begin
  -- coalesce على كلّ طرف: asset_type أو availability_status بقيمة NULL كان سيجعل
  -- v_retiring = NULL، و«if NULL» ليس true، فيُتخطّى الحارس بصمت — وهو بالضبط
  -- انهيار NULL نفسه الذي أُصلح في البوّابات.
  v_disposing := coalesce(new.disposal_date is not null and old.disposal_date is null, false);
  v_retiring  := coalesce(new.asset_type = 'serialized', false)
                 and coalesce(
                   (coalesce(new.availability_status = 'retired', false) and new.availability_status is distinct from old.availability_status)
                or (coalesce(new.condition_status    = 'retired', false) and new.condition_status    is distinct from old.condition_status), false);
  if v_disposing or v_retiring then
    select count(*) into v_live
      from public.custody_inventory_assignment_items i
      join public.custody_inventory_assignments a on a.id = i.assignment_id and a.is_deleted = false
     where i.asset_id = new.id and i.status in ('pending','active','return_requested','disputed');
    if coalesce(v_live, 0) > 0 then
      raise exception 'civ_disposal_blocked: الأصل على عهدة حيّة (% بندًا) — أغلِق العهدة بفحص إرجاع قبل التقاعد أو التخريد.', v_live
        using errcode = '42501';
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists trg_civ_guard_asset_disposal on public.custody_inventory_assets;
create trigger trg_civ_guard_asset_disposal
  before update on public.custody_inventory_assets
  for each row execute function public.civ_guard_asset_disposal();

-- تصحيح ما بعد الإغلاق — الحدث الذي يجعل الحارس (٢) قابلًا للعيش معه.
create or replace function public.custody_inv_post_closure_correction(
  p_assignment uuid, p_reason text, p_detail jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare a record; v_id uuid; r record;
begin
  if not public.civ_can_close_custody() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'reason_required_min_10'; end if;
  select * into a from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  if a.status not in ('returned','cancelled','rejected') then raise exception 'assignment_not_closed'; end if;
  if coalesce(auth.uid() = a.employee_user_id, false) then
    raise exception 'civ_self_correction_denied: لا تسجّل تصحيحًا على عهدتك أنت.' using errcode = '42501';
  end if;
  for r in select distinct asset_id from public.custody_inventory_assignment_items where assignment_id = p_assignment loop
    insert into public.custody_inventory_movements(
      asset_id, assignment_id, movement_type, quantity_change, reason, created_by, reference_type, reference_id)
    values (r.asset_id, p_assignment, 'manual_correction', 0,
      'تصحيح بعد الإغلاق: ' || btrim(p_reason), auth.uid(), 'assignment_correction', p_assignment)
    returning id into v_id;
  end loop;
  perform public.custody_audit('assignment_post_closure_correction', 'custody_inventory_assignments', p_assignment,
    jsonb_build_object('reason', btrim(p_reason), 'detail', coalesce(p_detail, '{}'::jsonb)));
  return v_id;
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) الحجوزات — أضعف منطقة في التدقيق، تُقوّى بحارس على الجدول لا بـRPC ثانية
--
-- لماذا مُشغِّل وليس RPC v2 وحدها: custody_inv_admin_create_reservation (v1)
-- مُصرّحة لـauthenticated ولا تفحص أيّ حجز آخر. أيّ ضمان يُكتب داخل v2 وحدها
-- يبقى قابلًا للتجاوز بنداء v1. الحارس على الجدول يغطّي المسارين معًا، ولا
-- يُعيد تعريف v1 (تحذير التدقيق: لا تُعِد تعريف v1 في مكانها).
--
-- عقد التعارض: **نفس عقد prodops** — رمز 23P01 وhint بالشكل 'equipment:<code>'
-- لا قاعدة ثانية متناقضة. حين تكون prodops حاضرة تُستشار فعلًا؛ وحين تغيب يُعلَن
-- ذلك في الشاشة بدل ادّعاء تغطية.
-- ⚠️ 23P01 تعارضٌ لا ترحيلة ناقصة — طبقة العرض تصنّفها CONFLICT (lib/portal/pgerror.ts).
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.civ_reservation_conflict(
  p_asset uuid, p_qty numeric, p_from timestamptz, p_to timestamptz,
  p_exclude uuid default null, p_employee uuid default null) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare ast record; v_resv numeric; v_custody numeric; v_code text; v_no text; v_zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  select * into ast from public.custody_inventory_assets where id = p_asset;
  if ast.id is null then return 'state:asset_not_found'; end if;
  if coalesce(ast.is_deleted, false) or ast.disposal_date is not null then return 'state:disposed'; end if;
  if ast.condition_status = 'retired' or ast.availability_status = 'retired' then return 'state:retired'; end if;
  if ast.condition_status = 'lost'    or ast.availability_status = 'lost'    then return 'state:missing'; end if;
  if ast.availability_status = 'maintenance' then return 'state:maintenance'; end if;
  if coalesce(p_qty, 0) <= 0 then return 'state:bad_quantity'; end if;
  if coalesce(p_qty, 0) > coalesce(ast.quantity_total, 0) then return 'state:exceeds_total'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then return 'state:inverted_window'; end if;

  -- (أ) حجوزات أخرى نشطة تتقاطع مع النافذة. ★ reserved_from يُحترَم فعلًا هنا:
  --     حجز الشهر القادم لا يزاحم حجز اليوم، بعكس فحص الصرف القائم.
  select coalesce(sum(r.quantity), 0) into v_resv
    from public.custody_inventory_reservations r
   where r.asset_id = p_asset and r.status = 'active'
     and (p_exclude is null or r.id <> p_exclude)
     and public.civ_window(r.reserved_from, r.reserved_to) && public.civ_window(p_from, p_to);

  -- (ب) عهدة حيّة تتقاطع مع النافذة. نافذة العهدة = [issued_at, expected_return_at)
  --     و«بلا تاريخ عودة» = مفتوحة إلى ما لا نهاية — وهي تزاحم فعلًا، فالكاميرا
  --     المصروفة بلا موعد عودة لا يصحّ حجزها لأحد.
  select coalesce(sum(i.quantity - i.quantity_returned), 0), max(a.assignment_number)
    into v_custody, v_no
    from public.custody_inventory_assignment_items i
    join public.custody_inventory_assignments a on a.id = i.assignment_id and a.is_deleted = false
   where i.asset_id = p_asset
     and i.status in ('pending','active','return_requested','disputed')
     and (p_employee is null or a.employee_user_id is distinct from p_employee)
     and public.civ_window(a.issued_at, a.expected_return_at) && public.civ_window(p_from, p_to);

  if coalesce(p_qty,0) + coalesce(v_resv,0) + coalesce(v_custody,0) > coalesce(ast.quantity_total,0) then
    if coalesce(v_custody, 0) > 0 and coalesce(p_qty,0) + coalesce(v_resv,0) <= coalesce(ast.quantity_total,0) then
      return 'custody:' || coalesce(v_no, '—');
    end if;
    return 'reservation:' || coalesce(ast.asset_code, '—');
  end if;

  -- (ج) عقد prodops القائم — يُستشار حين يكون حاضرًا، ولا يُعاد اختراعه.
  --     لا مصيدة تبتلع الخطأ: prodops نصف مطبَّق أُوقِف في PREFLIGHT، وأيّ فشل
  --     هنا يجب أن يُسمَع لا أن يتحوّل إلى «لا تعارض».
  if to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null
     and p_from is not null and p_to is not null then
    execute 'select public.prodops_asset_clash($1,$2,$3,$4)' into v_code
      using p_asset, v_zero, p_from, p_to;
    if v_code is not null then return 'equipment:' || v_code; end if;
  end if;

  return null;
end $fn$;
revoke execute on function public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid) from public, anon;
grant execute on function public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid) to authenticated;

create or replace function public.civ_guard_reservation() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_code text; v_kind text;
begin
  -- الإلغاء/الانتهاء/الإتمام لا يُحرَس: إغلاق صفّ متعارض قائم يجب أن يبقى ممكنًا.
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active'
     and new.asset_id is not distinct from old.asset_id
     and new.quantity is not distinct from old.quantity
     and new.reserved_from is not distinct from old.reserved_from
     and new.reserved_to is not distinct from old.reserved_to then
    return new;   -- تعديل ملاحظة/مهلة فقط — لا يُعاد فحص التقاطع
  end if;

  v_code := public.civ_reservation_conflict(
    new.asset_id, new.quantity, new.reserved_from, new.reserved_to,
    case when tg_op = 'UPDATE' then new.id else null end, new.employee_id);

  if v_code is null then return new; end if;
  v_kind := split_part(v_code, ':', 1);

  if v_kind = 'state' then
    raise exception 'civ_reservation_rejected (%): لا يمكن حجز هذا الأصل بحالته الراهنة.', v_code
      using errcode = '23514', hint = v_code;
  end if;
  -- ★ تعارض حجز — رمز مميّز 23P01 كعقد prodops، كي تميّزه الواجهة عن «ممنوع»
  --   وعن «ترحيلة ناقصة».
  raise exception 'civ_double_booking (%): الأصل محجوز أو مصروف في نافذة متقاطعة.', v_code
    using errcode = '23P01', hint = v_code;
end $fn$;
drop trigger if exists trg_civ_guard_reservation on public.custody_inventory_reservations;
create trigger trg_civ_guard_reservation
  before insert or update on public.custody_inventory_reservations
  for each row execute function public.civ_guard_reservation();

-- إنشاء حجز v2 — يفحص قبل الإدراج فيعطي رسالة مفهومة، والحارس يبقى الحدّ الأخير.
create or replace function public.custody_inv_admin_create_reservation_v2(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_asset uuid; v_qty numeric; v_from timestamptz; v_to timestamptz;
        v_code text; v_id uuid; ast record;
begin
  if not public.civ_can_issue_custody() then raise exception 'not authorized'; end if;
  v_asset := nullif(p_data->>'asset_id','')::uuid;
  if v_asset is null then raise exception 'asset_required'; end if;
  select * into ast from public.custody_inventory_assets where id = v_asset and is_deleted = false;
  if ast.id is null then raise exception 'not_found'; end if;
  v_qty  := coalesce(nullif(p_data->>'quantity','')::numeric, 1);
  if ast.asset_type = 'serialized' then v_qty := 1; end if;
  v_from := nullif(p_data->>'reserved_from','')::timestamptz;
  v_to   := nullif(p_data->>'reserved_to','')::timestamptz;

  v_code := public.civ_reservation_conflict(v_asset, v_qty, v_from, v_to, null,
                                            nullif(p_data->>'employee_id','')::uuid);
  if v_code is not null then
    if split_part(v_code, ':', 1) = 'state' then
      raise exception 'civ_reservation_rejected (%)', v_code using errcode = '23514', hint = v_code;
    end if;
    raise exception 'civ_double_booking (%)', v_code using errcode = '23P01', hint = v_code;
  end if;

  insert into public.custody_inventory_reservations(
    asset_id, quantity, employee_id, project_id, field_task_id,
    reserved_from, reserved_to, hold_expires_at, note, created_by)
  values (v_asset, v_qty, nullif(p_data->>'employee_id','')::uuid,
    nullif(p_data->>'project_id','')::uuid, nullif(p_data->>'field_task_id','')::uuid,
    v_from, v_to, nullif(p_data->>'hold_expires_at','')::timestamptz,
    nullif(btrim(p_data->>'note'),''), auth.uid())
  returning id into v_id;

  perform public.custody_audit('reservation_created', 'custody_inventory_reservations', v_id,
    jsonb_build_object('asset_id', v_asset, 'quantity', v_qty, 'from', v_from, 'to', v_to));
  perform public.civ_notify_managers('civ_reservation_created', v_asset,
    'حجز أصل ' || coalesce(ast.asset_code,''), 'Asset reserved: ' || coalesce(ast.asset_code,''));
  return jsonb_build_object('ok', true, 'id', v_id, 'asset_code', ast.asset_code);
end $fn$;

-- تسجيل الإتمام: الحالة 'fulfilled' كانت في الـCHECK بلا أيّ RPC يكتبها.
create or replace function public.custody_inv_fulfil_reservation(p_id uuid, p_assignment uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if not public.civ_can_issue_custody() then raise exception 'not authorized'; end if;
  select * into r from public.custody_inventory_reservations where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'active' then raise exception 'reservation_not_active'; end if;
  if p_assignment is not null and not exists (
       select 1 from public.custody_inventory_assignments a
        where a.id = p_assignment and a.is_deleted = false
          and exists (select 1 from public.custody_inventory_assignment_items i
                       where i.assignment_id = a.id and i.asset_id = r.asset_id)) then
    raise exception 'assignment_does_not_cover_asset';
  end if;
  update public.custody_inventory_reservations
     set status = 'fulfilled', fulfilled_by_assignment_id = p_assignment,
         fulfilled_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.custody_audit('reservation_fulfilled', 'custody_inventory_reservations', p_id,
    jsonb_build_object('assignment_id', p_assignment));
  return true;
end $fn$;

-- انقضاء المهل — يحوّل ولا يحذف، فيبقى الأثر قابلًا للمراجعة.
create or replace function public.custody_inv_expire_reservations() returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not public.civ_can_issue_custody() then raise exception 'not authorized'; end if;
  with x as (
    update public.custody_inventory_reservations
       set status = 'expired', updated_by = auth.uid(), updated_at = now()
     where status = 'active'
       and ((hold_expires_at is not null and hold_expires_at < now())
         or (reserved_to    is not null and reserved_to    < now()))
    returning id)
  select count(*) into v_n from x;
  if coalesce(v_n,0) > 0 then
    perform public.custody_audit('reservations_expired', 'custody_inventory_reservations', null,
      jsonb_build_object('count', v_n));
  end if;
  return coalesce(v_n, 0);
end $fn$;

-- تقويم الحجز — الشاشة الغائبة تمامًا في التدقيق (§7-٥): RPC ونوع بلا واجهة.
create or replace function public.custody_inv_reservation_calendar(
  p_from timestamptz default null, p_to timestamptz default null, p_asset uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb; v_from timestamptz; v_to timestamptz;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  v_from := coalesce(p_from, now() - interval '7 days');
  v_to   := coalesce(p_to,   now() + interval '60 days');
  select coalesce(jsonb_agg(x order by x->>'reserved_from'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', r.id, 'asset_id', r.asset_id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
      'quantity', r.quantity, 'status', r.status,
      'reserved_from', r.reserved_from, 'reserved_to', r.reserved_to,
      'hold_expires_at', r.hold_expires_at, 'note', r.note,
      'project_id', r.project_id,
      'fulfilled_by_assignment_id', r.fulfilled_by_assignment_id,
      'is_overdue_hold', (r.status = 'active' and r.hold_expires_at is not null and r.hold_expires_at < now())
    ) as x
    from public.custody_inventory_reservations r
    join public.custody_inventory_assets a on a.id = r.asset_id
   where (p_asset is null or r.asset_id = p_asset)
     and public.civ_window(r.reserved_from, r.reserved_to) && public.civ_window(v_from, v_to)
   limit 1000) s;
  return jsonb_build_object(
    'ok', true, 'rows', v,
    -- صدق التغطية: الشاشة تقول ما يراه المحرّك وما لا يراه، ولا تدّعي شمولًا.
    'coverage', jsonb_build_object(
      'reservations', true,
      'live_custody', true,
      'production_jobs', (to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null),
      'planning_bookings', false),
    'note_ar', 'المحرّك يرى الحجوزات والعهد الحيّة'
      || case when to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null
              then ' وأوامر التشغيل' else '' end
      || '. حجوزات طبقة التخطيط (planning_bookings) خارج تغطيته.');
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) QR — رمز غير قابل للتخمين، حمولة عامّة فقيرة عمدًا، مسح مُقيَّد ومُدقَّق
--
-- الرمز نفسه قائم (assets.qr_token uuid فريد + custody_qr_events + إعادة إصدار
-- تُبطل القديم). ما يُضاف هنا: حمولة عامّة **لا تحمل تكلفة ولا بيانات موظّف ولا
-- مسار تخزين ولا معرّفًا قابلًا للاستغلال**، وتحديد معدّل، وإلغاء صريح، وتدقيق
-- على المسح الحسّاس، وبديل بحث حين يتلف الرمز.
-- سياسة V1: تسجيل الدخول مطلوب — لا بحث مجهول الهوية.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- الحمولة العامّة: كلّ ما فيها آمن على ملصق قد يراه غريب.
-- لا purchase_price، لا current_value، لا اسم موظّف، لا file_path، لا uuid.
create or replace function public.custody_inv_qr_public_payload(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare a record;
begin
  select a0.asset_code, a0.asset_name, a0.brand, a0.model, a0.asset_type, a0.unit,
         a0.availability_status, a0.condition_status, a0.condition_grade, a0.qr_status,
         (select c.name from public.custody_inventory_categories c where c.id = a0.category_id) as category,
         (select l.name from public.custody_inventory_locations  l where l.id = a0.warehouse_location_id) as location
    into a from public.custody_inventory_assets a0
   where a0.qr_token = p_token and a0.is_deleted = false;
  if a.asset_code is null then return null; end if;
  return jsonb_build_object(
    'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'brand', a.brand, 'model', a.model, 'asset_type', a.asset_type, 'unit', a.unit,
    'category', a.category, 'location', a.location,
    'availability_status', a.availability_status,
    'condition_status', a.condition_status, 'condition_grade', a.condition_grade,
    'owner_org', 'Kian Media');
end $fn$;
revoke execute on function public.custody_inv_qr_public_payload(uuid) from public, anon, authenticated;

-- تحديد المعدّل: ٦٠ مسحًا في الدقيقة لكلّ مستخدم. يُقاس من custody_qr_events
-- القائم — لا جدول عدّادات جديد.
create or replace function public.civ_qr_rate_ok(p_limit int default 60) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v int;
begin
  if auth.uid() is null then return false; end if;
  if to_regclass('public.custody_qr_events') is null then return true; end if;
  select count(*) into v from public.custody_qr_events
   where created_by = auth.uid() and event_type = 'scanned' and created_at > now() - interval '1 minute';
  return coalesce(v, 0) < coalesce(p_limit, 60);
exception when others then return false;   -- fail-closed: غموض العدّاد لا يفتح الباب
end $fn$;
revoke execute on function public.civ_qr_rate_ok(int) from public, anon, authenticated;

-- المسح: يتطلّب جلسة موظّف، يفرض المعدّل، يحترم الإلغاء، يسجّل الحدث، ويعيد
-- تفصيلًا **حسب الدور** فوق الحمولة العامّة.
create or replace function public.custody_inv_qr_scan(p_token uuid, p_context text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare a record; v_pub jsonb; v_detail jsonb := null; v_level text := 'public';
begin
  if not coalesce(public.is_staff(), false) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if not public.civ_qr_rate_ok() then
    raise exception 'civ_qr_rate_limited: تجاوزت حدّ المسح المسموح — انتظر دقيقة.' using errcode = '54000';
  end if;
  if p_token is null then raise exception 'qr_not_found'; end if;

  select id, qr_status, asset_code into a
    from public.custody_inventory_assets where qr_token = p_token and is_deleted = false;
  if a.id is null then
    if to_regclass('public.custody_qr_events') is not null then
      perform public.custody_audit('qr_scan_unknown_token', 'custody_inventory_assets', null,
        jsonb_build_object('context', p_context));
    end if;
    raise exception 'qr_not_found';
  end if;
  if a.qr_status = 'revoked' then
    perform public.custody_audit('qr_scan_revoked', 'custody_inventory_assets', a.id,
      jsonb_build_object('context', p_context));
    raise exception 'qr_revoked';
  end if;

  v_pub := public.custody_inv_qr_public_payload(p_token);

  if public.civ_can_view_assets() then
    v_level := 'operations';
    select jsonb_build_object(
      'asset_id', ast.id,
      'state', public.civ_asset_state(ast.id),
      'quantity_available', ast.quantity_available,
      'quantity_total', ast.quantity_total,
      'quantity_in_maintenance', ast.quantity_in_maintenance,
      'serial_number', ast.serial_number,
      'warranty_expiry_date', ast.warranty_expiry_date,
      'expected_return_at', (select min(asg.expected_return_at)
                               from public.custody_inventory_assignment_items i
                               join public.custody_inventory_assignments asg on asg.id = i.assignment_id
                              where i.asset_id = ast.id and asg.is_deleted = false
                                and i.status in ('pending','active','return_requested','disputed')),
      'open_maintenance', (select count(*) from public.custody_inventory_maintenance m
                            where m.asset_id = ast.id and m.status in ('opened','sent','in_progress')),
      'active_reservations', (select count(*) from public.custody_inventory_reservations r
                               where r.asset_id = ast.id and r.status = 'active')
    ) into v_detail from public.custody_inventory_assets ast where ast.id = a.id;
    if public.civ_can_manage_assets() then v_level := 'manage'; end if;
  end if;

  if to_regclass('public.custody_qr_events') is not null then
    insert into public.custody_qr_events(asset_id, event_type, context, created_by)
      values (a.id, 'scanned', coalesce(nullif(btrim(p_context),''), 'manual'), auth.uid());
  end if;
  -- تدقيق على المسح الحسّاس فقط (مستوى إدارة) — لا ضجيج على كلّ مسح تشغيليّ.
  if v_level = 'manage' then
    perform public.custody_audit('qr_scan_privileged', 'custody_inventory_assets', a.id,
      jsonb_build_object('context', p_context));
  end if;

  return jsonb_build_object('ok', true, 'level', v_level, 'payload', v_pub, 'detail', v_detail);
end $fn$;

-- إلغاء صريح: الرمز المطبوع على ملصق ضائع يُبطَل بلا إعادة إصدار.
create or replace function public.custody_inv_admin_revoke_qr(p_asset uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_old uuid;
begin
  if not public.civ_can_manage_assets() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'reason_required_min_5'; end if;
  select qr_token into v_old from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  update public.custody_inventory_assets set qr_status = 'revoked', updated_at = now() where id = p_asset;
  if to_regclass('public.custody_qr_events') is not null then
    insert into public.custody_qr_events(asset_id, event_type, old_token, context, created_by)
      values (p_asset, 'revoked', v_old, btrim(p_reason), auth.uid());
  end if;
  perform public.custody_audit('qr_revoked', 'custody_inventory_assets', p_asset,
    jsonb_build_object('reason', btrim(p_reason)));
  return true;
end $fn$;

-- بديل البحث حين يتلف الرمز — نفس الحمولة، مصدرها الكود/الباركود/السيريال.
create or replace function public.custody_inv_lookup_asset(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb; q text;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  q := btrim(coalesce(p_query,''));
  if length(q) < 3 then raise exception 'query_too_short'; end if;
  select coalesce(jsonb_agg(x order by x->>'asset_code'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
      'brand', a.brand, 'model', a.model, 'serial_number', a.serial_number,
      'state', public.civ_asset_state(a.id),
      'availability_status', a.availability_status, 'condition_status', a.condition_status,
      'qr_status', a.qr_status,
      'location', (select l.name from public.custody_inventory_locations l where l.id = a.warehouse_location_id)) as x
      from public.custody_inventory_assets a
     where a.is_deleted = false
       and (a.asset_code ilike '%'||q||'%' or a.serial_number ilike '%'||q||'%'
         or a.barcode ilike '%'||q||'%' or a.asset_name ilike '%'||q||'%'
         or (to_jsonb(a) ? 'barcode_value' and (to_jsonb(a)->>'barcode_value') ilike '%'||q||'%'))
     limit 50) s;
  perform public.custody_audit('asset_lookup_fallback', 'custody_inventory_assets', null,
    jsonb_build_object('q_len', length(q)));
  return jsonb_build_object('ok', true, 'rows', v);
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) دفتر الاستخدام — ملحق كدفتر الائتمان: التصحيح بعكس القيد لا بتعديله
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.civ_meter_block_write() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  raise exception 'civ_meter_immutable: دفتر الاستخدام ملحق — لا تعديل ولا حذف. صحّح بعكس القيد عبر custody_inv_reverse_meter.'
    using errcode = '42501';
end $fn$;
drop trigger if exists trg_civ_meter_no_update   on public.custody_inventory_meter_readings;
drop trigger if exists trg_civ_meter_no_delete   on public.custody_inventory_meter_readings;
drop trigger if exists trg_civ_meter_no_truncate on public.custody_inventory_meter_readings;
create trigger trg_civ_meter_no_update   before update   on public.custody_inventory_meter_readings for each row       execute function public.civ_meter_block_write();
create trigger trg_civ_meter_no_delete   before delete   on public.custody_inventory_meter_readings for each row       execute function public.civ_meter_block_write();
create trigger trg_civ_meter_no_truncate before truncate on public.custody_inventory_meter_readings for each statement execute function public.civ_meter_block_write();

-- ★ توفيق النمطين — بدونه يصفّر العدّاد المطلق كلّ شيء بصمت.
-- العدّاد يُسجَّل بنمطين: increment (زيادة لكلّ جلسة) وabsolute (قراءة تراكمية من
-- الجهاز نفسه: عدّاد غالق ٤٥٠٠٠). جمع القيم صالح للأوّل فقط؛ جمع الثاني يضاعف،
-- وتجاهله يجعل المجموع صفرًا — فلا تستحقّ صيانة بالاستخدام أبدًا، وهو أخطر من
-- غيابها لأنّ الشاشة تقول «٠ ساعة» بثقة.
-- المجموع مدى الحياة = آخر قراءة مطلقة + الزيادات المسجّلة بعدها.
create or replace function public.civ_meter_total(p_asset uuid, p_type text)
returns numeric language sql stable security definer set search_path = public as $fn$
  with live as (
    select m.value, m.reading_mode, m.recorded_at
      from public.custody_inventory_meter_readings m
     where m.asset_id = p_asset and m.meter_type = p_type and m.entry_type = 'reading'
       and not exists (select 1 from public.custody_inventory_meter_readings x
                        where x.reverses_reading_id = m.id)
  ), anchor as (
    select l.value, l.recorded_at from live l where l.reading_mode = 'absolute'
     order by l.recorded_at desc, l.value desc limit 1
  )
  select coalesce((select a.value from anchor a), 0)
       + coalesce((select sum(l.value) from live l
                    where l.reading_mode = 'increment'
                      and (not exists (select 1 from anchor)
                           or l.recorded_at > (select a.recorded_at from anchor a))), 0);
$fn$;

-- الاستخدام داخل نافذة. المرجع للنمط المطلق = آخر قراءة قبل النافذة، وإن لم توجد
-- فأوّل قراءة داخلها (لا تُحتسَب القراءة الأولى كلّها استهلاكًا في النافذة — وإلّا
-- أطلق أوّل ربط لجهاز إشارةَ «استخدام مرتفع» كاذبة).
create or replace function public.civ_meter_usage_between(
  p_asset uuid, p_type text, p_from timestamptz, p_to timestamptz default now())
returns numeric language sql stable security definer set search_path = public as $fn$
  with live as (
    select m.value, m.reading_mode, m.recorded_at
      from public.custody_inventory_meter_readings m
     where m.asset_id = p_asset and m.meter_type = p_type and m.entry_type = 'reading'
       and not exists (select 1 from public.custody_inventory_meter_readings x
                        where x.reverses_reading_id = m.id)
  ), base as (
    select coalesce(
      (select l.value from live l where l.reading_mode = 'absolute'
        and (p_from is null or l.recorded_at <= p_from)
        order by l.recorded_at desc, l.value desc limit 1),
      (select l.value from live l where l.reading_mode = 'absolute'
        and (p_from is null or l.recorded_at > p_from)
        and l.recorded_at <= coalesce(p_to, now())
        order by l.recorded_at asc, l.value asc limit 1)) as v
  ), fin as (
    select (select l.value from live l where l.reading_mode = 'absolute'
             and l.recorded_at <= coalesce(p_to, now())
             order by l.recorded_at desc, l.value desc limit 1) as v
  )
  select greatest(0, coalesce((select f.v from fin f), 0) - coalesce((select b.v from base b), 0))
       + coalesce((select sum(l.value) from live l
                    where l.reading_mode = 'increment'
                      and (p_from is null or l.recorded_at > p_from)
                      and l.recorded_at <= coalesce(p_to, now())), 0);
$fn$;

-- مساعدتان داخليتان: تُستدعيان من دوالّ محميّة تفحص البوّابة بنفسها. لا تُمنَحان
-- لأحد مباشرةً كي لا يصير الاستخدام سطحًا مقروءًا بلا بوّابة.
revoke execute on function public.civ_meter_total(uuid,text),
  public.civ_meter_usage_between(uuid,text,timestamptz,timestamptz)
  from public, anon, authenticated;

create or replace function public.custody_inv_record_meter(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_asset uuid; v_type text; v_val numeric; v_key text; v_id uuid; ex record; ast record;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  v_asset := nullif(p_data->>'asset_id','')::uuid;
  v_type  := nullif(btrim(p_data->>'meter_type'),'');
  v_val   := nullif(p_data->>'value','')::numeric;
  v_key   := nullif(btrim(p_data->>'idempotency_key'),'');
  if v_asset is null then raise exception 'asset_required'; end if;
  if v_type  is null then raise exception 'meter_type_required'; end if;
  if v_val   is null then raise exception 'value_required'; end if;

  select id, asset_code, is_deleted into ast from public.custody_inventory_assets where id = v_asset;
  if ast.id is null or coalesce(ast.is_deleted,false) then raise exception 'not_found'; end if;

  -- ★ تعطيل التكرار + حماية عبر-الأصول: المفتاح فريد عالميًّا. إعادة الإرسال
  --   نفسها تعيد الصفّ نفسه؛ المفتاح نفسه بأصل أو قيمة مختلفة يُرفض بوضوح
  --   بدل أن يُقيَّد على الأصل الخطأ.
  if v_key is not null then
    select * into ex from public.custody_inventory_meter_readings where idempotency_key = v_key;
    if ex.id is not null then
      if ex.asset_id = v_asset and ex.meter_type = v_type and ex.value = v_val then
        return jsonb_build_object('ok', true, 'id', ex.id, 'duplicate', true);
      end if;
      raise exception 'civ_meter_idempotency_conflict: المفتاح مستعمل لأصل أو قيمة مختلفة — لا يُعاد استعماله.'
        using errcode = '23505';
    end if;
  end if;

  insert into public.custody_inventory_meter_readings(
    asset_id, meter_type, custom_meter_label, entry_type, reading_mode, value, unit, source,
    recorded_at, recorded_by, assignment_id, maintenance_id, job_reference, project_id,
    idempotency_key, note)
  values (v_asset, v_type, nullif(btrim(p_data->>'custom_meter_label'),''), 'reading',
    coalesce(nullif(p_data->>'reading_mode',''), 'increment'), v_val,
    nullif(btrim(p_data->>'unit'),''), coalesce(nullif(p_data->>'source',''), 'manual'),
    coalesce(nullif(p_data->>'recorded_at','')::timestamptz, now()), auth.uid(),
    nullif(p_data->>'assignment_id','')::uuid, nullif(p_data->>'maintenance_id','')::uuid,
    nullif(btrim(p_data->>'job_reference'),''), nullif(p_data->>'project_id','')::uuid,
    v_key, nullif(btrim(p_data->>'note'),''))
  returning id into v_id;

  perform public.custody_audit('meter_recorded', 'custody_inventory_meter_readings', v_id,
    jsonb_build_object('asset_id', v_asset, 'meter_type', v_type, 'value', v_val));
  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
end $fn$;

create or replace function public.custody_inv_reverse_meter(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare r record; v_id uuid;
begin
  if not public.civ_can_manage_assets() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'reason_required_min_5'; end if;
  select * into r from public.custody_inventory_meter_readings where id = p_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.entry_type <> 'reading' then raise exception 'only_readings_are_reversible'; end if;
  if exists (select 1 from public.custody_inventory_meter_readings where reverses_reading_id = p_id) then
    raise exception 'already_reversed'; end if;
  insert into public.custody_inventory_meter_readings(
    asset_id, meter_type, custom_meter_label, entry_type, reading_mode, value, unit, source,
    recorded_by, reverses_reading_id, reversal_reason, note)
  values (r.asset_id, r.meter_type, r.custom_meter_label, 'reversal', r.reading_mode,
    -1 * r.value, r.unit, r.source, auth.uid(), p_id, btrim(p_reason),
    'عكس قيد قراءة عدّاد')
  returning id into v_id;
  perform public.custody_audit('meter_reversed', 'custody_inventory_meter_readings', v_id,
    jsonb_build_object('reverses', p_id, 'reason', btrim(p_reason)));
  return v_id;
end $fn$;

-- المجاميع: القيد المعكوس وعَكسُه يسقطان معًا من الحساب.
create or replace function public.custody_inv_asset_meter_totals(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  -- المجموع يُشتقّ من civ_meter_total فيحترم النمطين. reading_mode مُعلَن في
  -- الحمولة كي تعرف الشاشة أنّ الرقم قراءة جهاز تراكمية لا حاصل جمع جلسات.
  select coalesce(jsonb_agg(jsonb_build_object(
           'meter_type', t.meter_type,
           'total', public.civ_meter_total(p_asset, t.meter_type),
           'reading_mode', t.mode,
           'last_reading_at', t.last_at,
           'entries', t.n) order by t.meter_type), '[]'::jsonb) into v
    from (select m.meter_type,
                 case when bool_or(m.reading_mode = 'absolute') then 'absolute' else 'increment' end as mode,
                 max(m.recorded_at) as last_at, count(*) as n
            from public.custody_inventory_meter_readings m
           where m.asset_id = p_asset
             and m.entry_type = 'reading'
             and not exists (select 1 from public.custody_inventory_meter_readings x
                              where x.reverses_reading_id = m.id)
           group by m.meter_type) t;
  return jsonb_build_object('ok', true, 'asset_id', p_asset, 'meters', v);
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) الصيانة — خطط، استحقاق مُشتقّ، إشارات بقواعد صريحة، إغلاق يعيد التقييم
--
-- ★ الإشارات **قواعد** لا ذكاء اصطناعيّ ولا تنبّؤ. كلّ إشارة تحمل أساسها الرقميّ
--   (basis) كي يستطيع المستخدم مراجعتها ورفضها. لا تُسمّى تنبّؤية في أيّ مكان.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.custody_inv_maint_plan_upsert(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_code text;
begin
  if not public.civ_can_manage_maintenance() then raise exception 'not authorized'; end if;
  v_id := nullif(p_data->>'id','')::uuid;
  if nullif(btrim(p_data->>'plan_name'),'') is null then raise exception 'plan_name_required'; end if;
  if nullif(p_data->>'asset_id','') is null and nullif(p_data->>'category_id','') is null then
    raise exception 'target_required: الخطّة تخصّ أصلًا أو تصنيفًا'; end if;

  if v_id is null then
    v_code := public.civ_gen_no('MPL');
    insert into public.custody_inventory_maintenance_plans(
      plan_code, plan_name, asset_id, category_id, maintenance_type,
      interval_days, interval_meter_type, interval_meter_value, interval_usage_count,
      manual_threshold_note, lead_time_days, last_done_at, last_done_meter, last_done_usage_count,
      blocks_availability, is_active, notes, created_by, updated_by)
    values (v_code, btrim(p_data->>'plan_name'),
      nullif(p_data->>'asset_id','')::uuid, nullif(p_data->>'category_id','')::uuid,
      coalesce(nullif(p_data->>'maintenance_type',''), 'preventive'),
      nullif(p_data->>'interval_days','')::int,
      nullif(btrim(p_data->>'interval_meter_type'),''),
      nullif(p_data->>'interval_meter_value','')::numeric,
      nullif(p_data->>'interval_usage_count','')::int,
      nullif(btrim(p_data->>'manual_threshold_note'),''),
      coalesce(nullif(p_data->>'lead_time_days','')::int, 7),
      nullif(p_data->>'last_done_at','')::timestamptz,
      nullif(p_data->>'last_done_meter','')::numeric,
      nullif(p_data->>'last_done_usage_count','')::int,
      coalesce(nullif(p_data->>'blocks_availability','')::boolean, false),
      coalesce(nullif(p_data->>'is_active','')::boolean, true),
      nullif(btrim(p_data->>'notes'),''), auth.uid(), auth.uid())
    returning id into v_id;
    perform public.custody_audit('maint_plan_created', 'custody_inventory_maintenance_plans', v_id, p_data);
  else
    update public.custody_inventory_maintenance_plans set
      plan_name             = coalesce(nullif(btrim(p_data->>'plan_name'),''), plan_name),
      maintenance_type      = coalesce(nullif(p_data->>'maintenance_type',''), maintenance_type),
      interval_days         = case when p_data ? 'interval_days'         then nullif(p_data->>'interval_days','')::int         else interval_days end,
      interval_meter_type   = case when p_data ? 'interval_meter_type'   then nullif(btrim(p_data->>'interval_meter_type'),'') else interval_meter_type end,
      interval_meter_value  = case when p_data ? 'interval_meter_value'  then nullif(p_data->>'interval_meter_value','')::numeric else interval_meter_value end,
      interval_usage_count  = case when p_data ? 'interval_usage_count'  then nullif(p_data->>'interval_usage_count','')::int  else interval_usage_count end,
      manual_threshold_note = case when p_data ? 'manual_threshold_note' then nullif(btrim(p_data->>'manual_threshold_note'),'') else manual_threshold_note end,
      lead_time_days        = coalesce(nullif(p_data->>'lead_time_days','')::int, lead_time_days),
      last_done_at          = case when p_data ? 'last_done_at'          then nullif(p_data->>'last_done_at','')::timestamptz  else last_done_at end,
      last_done_meter       = case when p_data ? 'last_done_meter'       then nullif(p_data->>'last_done_meter','')::numeric   else last_done_meter end,
      last_done_usage_count = case when p_data ? 'last_done_usage_count' then nullif(p_data->>'last_done_usage_count','')::int else last_done_usage_count end,
      blocks_availability   = coalesce(nullif(p_data->>'blocks_availability','')::boolean, blocks_availability),
      is_active             = coalesce(nullif(p_data->>'is_active','')::boolean, is_active),
      notes                 = case when p_data ? 'notes' then nullif(btrim(p_data->>'notes'),'') else notes end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'not_found'; end if;
    perform public.custody_audit('maint_plan_updated', 'custody_inventory_maintenance_plans', v_id, p_data);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.custody_inv_maint_plan_archive(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.civ_can_manage_maintenance() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'reason_required_min_5'; end if;
  update public.custody_inventory_maintenance_plans
     set is_deleted = true, is_active = false, deleted_at = now(), deleted_by = auth.uid(),
         delete_reason = btrim(p_reason), updated_at = now()
   where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  perform public.custody_audit('maint_plan_archived', 'custody_inventory_maintenance_plans', p_id,
    jsonb_build_object('reason', btrim(p_reason)));
  return true;
end $fn$;

-- استحقاق مُشتقّ: لا عمود next_due_at محفوظ يمكن أن ينحرف عن الواقع.
create or replace function public.custody_inv_maint_plan_due(p_asset uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by (x->>'days_remaining')::numeric nulls last), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'plan_id', p.id, 'plan_code', p.plan_code, 'plan_name', p.plan_name,
      'asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
      'maintenance_type', p.maintenance_type,
      'interval_days', p.interval_days,
      'interval_meter_type', p.interval_meter_type, 'interval_meter_value', p.interval_meter_value,
      'interval_usage_count', p.interval_usage_count,
      'manual_threshold_note', p.manual_threshold_note,
      'last_done_at', p.last_done_at,
      'next_due_at', case when p.interval_days is not null
                          then coalesce(p.last_done_at, a.purchase_date::timestamptz, a.created_at)
                               + make_interval(days => p.interval_days) end,
      'days_remaining', case when p.interval_days is not null
                          then extract(epoch from (coalesce(p.last_done_at, a.purchase_date::timestamptz, a.created_at)
                               + make_interval(days => p.interval_days) - now())) / 86400.0 end,
      -- ★ يحترم النمطين: قبل الخدمة الأولى المجموع مدى الحياة، وبعدها الفرق منذ
      --   آخر خدمة. النمط المطلق كان يعطي صفرًا دائمًا فلا يحين الاستحقاق أبدًا.
      'meter_since_last', case when p.interval_meter_type is not null then
          case when p.last_done_at is null
               then public.civ_meter_total(a.id, p.interval_meter_type)
               else public.civ_meter_usage_between(a.id, p.interval_meter_type, p.last_done_at, now()) end end,
      'meter_remaining', case when p.interval_meter_type is not null then
          p.interval_meter_value -
          (case when p.last_done_at is null
                then public.civ_meter_total(a.id, p.interval_meter_type)
                else public.civ_meter_usage_between(a.id, p.interval_meter_type, p.last_done_at, now()) end) end,
      'issues_since_last', (select count(*) from public.custody_inventory_assignment_items i
                              join public.custody_inventory_assignments g on g.id = i.assignment_id
                             where i.asset_id = a.id and g.is_deleted = false
                               and (p.last_done_at is null or i.issued_at > p.last_done_at)),
      'lead_time_days', p.lead_time_days,
      'blocks_availability', p.blocks_availability) as x
      from public.custody_inventory_maintenance_plans p
      join public.custody_inventory_assets a
        on (p.asset_id is not null and a.id = p.asset_id)
        or (p.asset_id is null and p.category_id is not null and a.category_id = p.category_id)
     where p.is_deleted = false and p.is_active and a.is_deleted = false
       and (p_asset is null or a.id = p_asset)
     limit 2000) s;
  return jsonb_build_object('ok', true, 'rows', v);
end $fn$;

-- ★ إشارات الصيانة — **قواعد صريحة**، لا نموذج ولا تنبّؤ. كلّ صفّ يحمل أساسه.
create or replace function public.custody_inv_maintenance_signals(p_asset uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v jsonb; d jsonb;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  d := public.custody_inv_maint_plan_due(p_asset);

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
    -- (١) صيانة مستحقّة قريبًا / (٢) متأخّرة — من الخطط
    select jsonb_build_object(
      'asset_id', r->>'asset_id', 'asset_code', r->>'asset_code',
      'signal', case when (r->>'days_remaining')::numeric < 0 then 'service_overdue' else 'service_due_soon' end,
      'severity', case when (r->>'days_remaining')::numeric < 0 then 'high' else 'medium' end,
      'rule', 'plan.interval_days',
      'basis', jsonb_build_object('plan_code', r->>'plan_code', 'days_remaining', r->>'days_remaining')) as x
      from jsonb_array_elements(d->'rows') r
     where (r->>'days_remaining') is not null
       and (r->>'days_remaining')::numeric <= coalesce((r->>'lead_time_days')::numeric, 7)

    union all
    -- (٣) عدّاد الخطّة استُنفد
    select jsonb_build_object(
      'asset_id', r->>'asset_id', 'asset_code', r->>'asset_code',
      'signal', 'service_meter_reached', 'severity', 'high', 'rule', 'plan.interval_meter',
      'basis', jsonb_build_object('plan_code', r->>'plan_code',
        'meter_type', r->>'interval_meter_type', 'meter_remaining', r->>'meter_remaining'))
      from jsonb_array_elements(d->'rows') r
     where (r->>'meter_remaining') is not null and (r->>'meter_remaining')::numeric <= 0

    union all
    -- (٤) تكرار الأعطال: ٣ أوامر إصلاح أو أكثر خلال ١٨٠ يومًا
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'high_fault_frequency',
      'severity', 'high', 'rule', 'repairs>=3 in 180d',
      'basis', jsonb_build_object('repairs_180d', c.n))
      from public.custody_inventory_assets a
      join (select m.asset_id, count(*) n from public.custody_inventory_maintenance m
             where m.maintenance_type = 'repair' and m.created_at > now() - interval '180 days'
             group by m.asset_id) c on c.asset_id = a.id and c.n >= 3
     where a.is_deleted = false and (p_asset is null or a.id = p_asset)

    union all
    -- (٥) تعطّل مفرط: ٣٠ يومًا أو أكثر داخل الصيانة خلال سنة
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'excessive_downtime',
      'severity', 'medium', 'rule', 'downtime_days>=30 in 365d',
      'basis', jsonb_build_object('downtime_days', round(c.days::numeric, 1)))
      from public.custody_inventory_assets a
      join (select m.asset_id,
                   sum(extract(epoch from (coalesce(m.returned_at, now()) - coalesce(m.sent_at, m.created_at)))/86400.0) days
              from public.custody_inventory_maintenance m
             where m.created_at > now() - interval '365 days' group by m.asset_id) c
        on c.asset_id = a.id and c.days >= 30
     where a.is_deleted = false and (p_asset is null or a.id = p_asset)

    union all
    -- (٦) تلف متكرّر: بندان مقبولان تالفَين أو أكثر خلال سنة
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'repeated_damage',
      'severity', 'high', 'rule', 'damaged_returns>=2 in 365d',
      'basis', jsonb_build_object('damaged_returns', c.n))
      from public.custody_inventory_assets a
      join (select i.asset_id, count(*) n from public.custody_inventory_assignment_items i
             where i.status = 'damaged' and i.updated_at > now() - interval '365 days'
             group by i.asset_id) c on c.asset_id = a.id and c.n >= 2
     where a.is_deleted = false and (p_asset is null or a.id = p_asset)

    union all
    -- (٧) الضمان يقارب الانتهاء (٦٠ يومًا)
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'warranty_expiring',
      'severity', 'medium', 'rule', 'warranty within 60d',
      'basis', jsonb_build_object('warranty_expiry_date', a.warranty_expiry_date))
      from public.custody_inventory_assets a
     where a.is_deleted = false and a.warranty_expiry_date is not null
       and a.warranty_expiry_date between current_date and current_date + 60
       and (p_asset is null or a.id = p_asset)

    union all
    -- (٨) فحص متأخّر: لم يُجرَد ولم يُفحَص منذ ٣٦٥ يومًا
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'inspection_overdue',
      'severity', 'medium', 'rule', 'no inspection in 365d',
      'basis', jsonb_build_object('last_inspection_at', c.last_at))
      from public.custody_inventory_assets a
      left join (select m.asset_id, max(m.created_at) last_at from public.custody_inventory_maintenance m
                  where m.maintenance_type = 'inspection' group by m.asset_id) c on c.asset_id = a.id
     where a.is_deleted = false and coalesce(c.last_at, a.created_at) < now() - interval '365 days'
       and (p_asset is null or a.id = p_asset)

    union all
    -- (٩) استخدام مرتفع: ٥٠٠ ساعة أو أكثر خلال ٩٠ يومًا
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'high_usage',
      'severity', 'medium', 'rule', 'usage_hours>=500 in 90d',
      'basis', jsonb_build_object('usage_hours_90d', round(c.h::numeric, 1)))
      from public.custody_inventory_assets a
      cross join lateral (select public.civ_meter_usage_between(
                            a.id, 'usage_hours', now() - interval '90 days', now()) as h) c
     where a.is_deleted = false and (p_asset is null or a.id = p_asset)
       -- مرشّح مسبق: لا نستدعي الدالّة لكلّ أصل في الكتالوج
       and exists (select 1 from public.custody_inventory_meter_readings m
                    where m.asset_id = a.id and m.meter_type = 'usage_hours'
                      and m.entry_type = 'reading'
                      and m.recorded_at > now() - interval '90 days')
       and c.h >= 500

    union all
    -- (١٠) استخدام منخفض: لم يُصرَف مرّة خلال ١٨٠ يومًا رغم توافره
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'low_utilization',
      'severity', 'low', 'rule', 'no issue in 180d',
      'basis', jsonb_build_object('last_issued_at', c.last_at))
      from public.custody_inventory_assets a
      left join (select i.asset_id, max(i.issued_at) last_at
                   from public.custody_inventory_assignment_items i group by i.asset_id) c on c.asset_id = a.id
     where a.is_deleted = false and a.availability_status in ('available','partially_assigned')
       and coalesce(c.last_at, a.created_at) < now() - interval '180 days'
       and (p_asset is null or a.id = p_asset)

    union all
    -- (١١) مراجعة الاستبدال: عمر افتراضيّ منقضٍ + عطل متكرّر
    select jsonb_build_object(
      'asset_id', a.id, 'asset_code', a.asset_code, 'signal', 'replacement_review',
      'severity', 'medium', 'rule', 'useful_life elapsed + repairs>=2',
      'basis', jsonb_build_object('purchase_date', a.purchase_date, 'repairs_all_time', c.n))
      from public.custody_inventory_assets a
      join (select m.asset_id, count(*) n from public.custody_inventory_maintenance m
             where m.maintenance_type = 'repair' group by m.asset_id) c on c.asset_id = a.id and c.n >= 2
     where a.is_deleted = false and a.purchase_date is not null
       and (to_jsonb(a) ? 'useful_life_months')
       and (to_jsonb(a)->>'useful_life_months') is not null
       and a.purchase_date + make_interval(months => (to_jsonb(a)->>'useful_life_months')::int) < current_date
       and (p_asset is null or a.id = p_asset)
  ) sig;

  return jsonb_build_object('ok', true, 'engine', 'rules', 'signals', v,
    'note_ar', 'قواعد صريحة لا تنبّؤ ولا ذكاء اصطناعيّ — كلّ إشارة تحمل أساسها الرقميّ للمراجعة والرفض.');
end $fn$;

-- إغلاق الصيانة بإعادة تقييم إلزاميّة: لا رجوع تلقائيّ إلى «متاح» بلا فحص.
-- يستدعي الإغلاق القائم (custody_inv_admin_close_maintenance) ولا يستبدله.
create or replace function public.custody_inv_maint_close_with_inspection(
  p_maintenance uuid, p_grade text, p_note text, p_final_cost numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare m record; v_cond text;
begin
  if not public.civ_can_manage_maintenance() then raise exception 'not authorized'; end if;
  if p_grade is null or p_grade not in
     ('excellent','good','used','has_notes','partially_damaged','damaged','unusable','incomplete','missing')
    then raise exception 'grade_required: أغلِق الصيانة بدرجة حالة صريحة — لا رجوع تلقائيّ إلى «جيّد».'; end if;
  select * into m from public.custody_inventory_maintenance where id = p_maintenance;
  if m.id is null then raise exception 'not_found'; end if;
  if m.status in ('completed','cancelled') then raise exception 'maintenance_already_closed'; end if;

  v_cond := public.civ_grade_to_condition(p_grade);
  if v_cond is null then raise exception 'grade_unmapped'; end if;

  -- الدرجة الوصفية تُحفظ على الأصل؛ حساب المخزون يبقى بيد الإغلاق القائم.
  update public.custody_inventory_assets
     set condition_grade = p_grade, condition_grade_at = now()
   where id = m.asset_id;

  -- التوقيع القائم: (p_id, p_result, p_return_condition, p_cost, p_note).
  -- p_result حالةُ أمر الصيانة، وp_return_condition حالةُ الأصل بعد الفحص —
  -- خلطهما كان سيكتب 'good' في عمود الحالة ويترك القطعة التالفة «سليمة».
  execute 'select public.custody_inv_admin_close_maintenance($1,$2,$3,$4,$5)'
    using p_maintenance, 'completed', v_cond, p_final_cost, nullif(btrim(p_note),'');

  perform public.custody_audit('maintenance_closed_with_inspection', 'custody_inventory_maintenance', p_maintenance,
    jsonb_build_object('grade', p_grade, 'condition', v_cond));
  return jsonb_build_object('ok', true, 'grade', p_grade, 'condition_status', v_cond);
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) الاستغلال والتكلفة — سطحان منفصلان عمدًا
--
--   custody_inv_asset_utilization        تشغيليّ: أيّام خارج المخزون، مرّات الصرف،
--                                        التعطّل. **بلا أيّ رقم مالي إطلاقًا.**
--   custody_inv_asset_cost_summary       مالكيّ: اقتناء، إهلاك، صيانة، تكلفة
--                                        الجلسة/الساعة، توصية الاستبدال.
--
-- ⚠️ لا انفتاح على استنتاج الربح: هذه الدوالّ لا تلمس أيّ جدول فواتير/عروض/
--    fin_* / zoho. المصادر هي أعمدة الأصل، وتكلفة الصيانة، ودفتر الاستخدام،
--    وشحنات الإيجار إن كانت مطبَّقة — ولا شيء غير ذلك.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.custody_inv_asset_utilization(
  p_asset uuid, p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_from timestamptz; v_to timestamptz; v_days numeric;
        v_out numeric; v_issues int; v_down numeric; a record;
begin
  if not public.civ_can_view_assets() then raise exception 'not authorized'; end if;
  select id, asset_code, asset_name, availability_status, condition_status
    into a from public.custody_inventory_assets where id = p_asset;
  if a.id is null then raise exception 'not_found'; end if;

  v_from := coalesce(p_from, now() - interval '365 days');
  v_to   := coalesce(p_to, now());
  if v_to <= v_from then raise exception 'inverted_window'; end if;
  v_days := extract(epoch from (v_to - v_from)) / 86400.0;

  -- أيّام خارج المخزون: تقاطع نافذة كلّ بند عهدة مع نافذة القياس.
  select coalesce(sum(extract(epoch from (
           least(coalesce(i.returned_at, coalesce(g.expected_return_at, v_to)), v_to)
         - greatest(i.issued_at, v_from))) / 86400.0), 0), count(*)
    into v_out, v_issues
    from public.custody_inventory_assignment_items i
    join public.custody_inventory_assignments g on g.id = i.assignment_id and g.is_deleted = false
   where i.asset_id = p_asset
     and public.civ_window(i.issued_at, coalesce(i.returned_at, g.expected_return_at)) && public.civ_window(v_from, v_to);

  select coalesce(sum(extract(epoch from (
           least(coalesce(m.returned_at, v_to), v_to)
         - greatest(coalesce(m.sent_at, m.created_at), v_from))) / 86400.0), 0)
    into v_down
    from public.custody_inventory_maintenance m
   where m.asset_id = p_asset
     and public.civ_window(coalesce(m.sent_at, m.created_at), m.returned_at) && public.civ_window(v_from, v_to);

  v_out  := greatest(0, coalesce(v_out, 0));
  v_down := greatest(0, coalesce(v_down, 0));

  return jsonb_build_object(
    'ok', true, 'asset_id', p_asset, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'state', public.civ_asset_state(p_asset),
    'from', v_from, 'to', v_to,
    'days_in_period', round(v_days, 2),
    'days_out', round(v_out, 2),
    'days_idle', round(greatest(0, v_days - v_out - v_down), 2),
    'downtime_days', round(v_down, 2),
    'times_issued', coalesce(v_issues, 0),
    'utilization_pct', case when v_days > 0 then round(100.0 * v_out / v_days, 1) else null end,
    'availability_pct', case when v_days > 0 then round(100.0 * (v_days - v_down) / v_days, 1) else null end,
    'contains_financials', false);
end $fn$;

-- ★ مالكيّ حصرًا. لا يلمس فواتير ولا عروضًا ولا fin_* — لا استنتاج ربح.
create or replace function public.custody_inv_asset_cost_summary(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare a record; v_maint numeric; v_repair numeric; v_rental numeric := null;
        v_util jsonb; v_meters jsonb; v_hours numeric; v_sessions numeric;
        v_life int; v_dep numeric; v_total numeric; v_rental_src boolean := false;
begin
  if not public.civ_can_view_asset_sensitive_costs() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into a from public.custody_inventory_assets where id = p_asset;
  if a.id is null then raise exception 'not_found'; end if;

  select coalesce(sum(coalesce(
           case when to_jsonb(m) ? 'final_cost'    then (to_jsonb(m)->>'final_cost')::numeric    end,
           case when to_jsonb(m) ? 'approved_cost' then (to_jsonb(m)->>'approved_cost')::numeric end,
           m.cost, 0)), 0),
         coalesce(sum(case when m.maintenance_type = 'repair' then coalesce(m.cost, 0) else 0 end), 0)
    into v_maint, v_repair
    from public.custody_inventory_maintenance m where m.asset_id = p_asset;

  -- تكلفة الاستبدال بالإيجار: مصدر اختياريّ. غيابه يُعلَن null لا صفرًا —
  -- الصفر يكذب بقول «لا تكلفة»، وnull يقول بصدق «المصدر غير مطبَّق».
  if to_regclass('public.custody_rental_items') is not null then
    begin
      execute 'select coalesce(sum(coalesce(total_price,0)),0) from public.custody_rental_items where asset_id = $1'
        into v_rental using p_asset;
      v_rental_src := true;
    exception when others then v_rental := null; v_rental_src := false;
    end;
  end if;

  v_util   := public.custody_inv_asset_utilization(p_asset, now() - interval '365 days', now());
  v_meters := public.custody_inv_asset_meter_totals(p_asset);
  select coalesce(max((m->>'total')::numeric) filter (where m->>'meter_type' = 'usage_hours'), 0),
         coalesce(max((m->>'total')::numeric) filter (where m->>'meter_type' = 'sessions'), 0)
    into v_hours, v_sessions from jsonb_array_elements(v_meters->'meters') m;

  v_life := case when to_jsonb(a) ? 'useful_life_months'
                 then nullif(to_jsonb(a)->>'useful_life_months','')::int end;
  v_dep := case
    when a.purchase_price is not null and v_life is not null and v_life > 0 and a.purchase_date is not null
    then least(a.purchase_price - coalesce(a.salvage_value, 0),
               (a.purchase_price - coalesce(a.salvage_value, 0)) / v_life
               * greatest(0, extract(epoch from (now() - a.purchase_date::timestamptz)) / 2629800.0))
    end;
  v_total := coalesce(a.purchase_price, 0) + coalesce(v_maint, 0);

  return jsonb_build_object(
    'ok', true, 'asset_id', p_asset, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'owner_only', true,
    'acquisition', jsonb_build_object(
      'purchase_price', a.purchase_price, 'purchase_date', a.purchase_date,
      'supplier_name', a.supplier_name, 'current_value', a.current_value,
      'book_value', case when to_jsonb(a) ? 'book_value' then (to_jsonb(a)->>'book_value')::numeric end,
      'salvage_value', a.salvage_value, 'useful_life_months', v_life,
      'accumulated_depreciation', case when v_dep is not null then round(v_dep, 2) end),
    'maintenance', jsonb_build_object(
      'maintenance_total', round(coalesce(v_maint,0), 2),
      'repair_total', round(coalesce(v_repair,0), 2)),
    'rental_replacement', jsonb_build_object(
      'total', case when v_rental_src then round(coalesce(v_rental,0), 2) else null end,
      'source_available', v_rental_src),
    'total_cost_of_ownership', round(coalesce(v_total,0), 2),
    'usage', jsonb_build_object('usage_hours', v_hours, 'sessions', v_sessions),
    'cost_per_hour',    case when coalesce(v_hours,0)    > 0 then round(v_total / v_hours, 2) end,
    'cost_per_session', case when coalesce(v_sessions,0) > 0 then round(v_total / v_sessions, 2) end,
    'utilization', v_util,
    'replacement_recommendation', case
      when a.purchase_price is not null and a.purchase_price > 0
           and coalesce(v_maint,0) >= 0.5 * a.purchase_price then 'replace_review'
      when (v_util->>'utilization_pct') is not null and (v_util->>'utilization_pct')::numeric < 10 then 'underused'
      when (v_util->>'utilization_pct') is not null and (v_util->>'utilization_pct')::numeric > 80 then 'overused_consider_second_unit'
      else 'keep' end,
    'sources', jsonb_build_object(
      'assets', true, 'maintenance', true, 'meter_readings', true,
      'rental', v_rental_src, 'finance_tables', false),
    'note_ar', 'لا يُشتقّ أيّ ربح هنا: لا فواتير ولا عروض ولا جداول مالية. تكلفة الملكية فقط.');
end $fn$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) RLS والصلاحيات — قراءة فقط بالسياسات، وكلّ كتابة عبر RPC، ولا anon
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.custody_inventory_maintenance_plans enable row level security;
alter table public.custody_inventory_meter_readings    enable row level security;

drop policy if exists civ_maint_plans_read on public.custody_inventory_maintenance_plans;
create policy civ_maint_plans_read on public.custody_inventory_maintenance_plans
  for select to authenticated using (public.civ_can_view_assets());

drop policy if exists civ_meter_read on public.custody_inventory_meter_readings;
create policy civ_meter_read on public.custody_inventory_meter_readings
  for select to authenticated using (public.civ_can_view_assets());

grant select on public.custody_inventory_maintenance_plans,
                public.custody_inventory_meter_readings to authenticated;
revoke all on public.custody_inventory_maintenance_plans from anon;
revoke all on public.custody_inventory_meter_readings    from anon;

revoke execute on function
  public.civ_asset_state(uuid),
  public.civ_allowed_transitions(text,text),
  public.civ_grade_to_condition(text),
  public.civ_condition_to_grade(text),
  public.custody_inv_post_closure_correction(uuid,text,jsonb),
  public.custody_inv_admin_create_reservation_v2(jsonb),
  public.custody_inv_fulfil_reservation(uuid,uuid),
  public.custody_inv_expire_reservations(),
  public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid),
  public.custody_inv_qr_scan(uuid,text),
  public.custody_inv_admin_revoke_qr(uuid,text),
  public.custody_inv_lookup_asset(text),
  public.custody_inv_record_meter(jsonb),
  public.custody_inv_reverse_meter(uuid,text),
  public.custody_inv_asset_meter_totals(uuid),
  public.custody_inv_maint_plan_upsert(jsonb),
  public.custody_inv_maint_plan_archive(uuid,text),
  public.custody_inv_maint_plan_due(uuid),
  public.custody_inv_maintenance_signals(uuid),
  public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric),
  public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz),
  public.custody_inv_asset_cost_summary(uuid)
  from public, anon;

grant execute on function
  public.civ_asset_state(uuid),
  public.civ_allowed_transitions(text,text),
  public.civ_grade_to_condition(text),
  public.civ_condition_to_grade(text),
  public.custody_inv_post_closure_correction(uuid,text,jsonb),
  public.custody_inv_admin_create_reservation_v2(jsonb),
  public.custody_inv_fulfil_reservation(uuid,uuid),
  public.custody_inv_expire_reservations(),
  public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid),
  public.custody_inv_qr_scan(uuid,text),
  public.custody_inv_admin_revoke_qr(uuid,text),
  public.custody_inv_lookup_asset(text),
  public.custody_inv_record_meter(jsonb),
  public.custody_inv_reverse_meter(uuid,text),
  public.custody_inv_asset_meter_totals(uuid),
  public.custody_inv_maint_plan_upsert(jsonb),
  public.custody_inv_maint_plan_archive(uuid,text),
  public.custody_inv_maint_plan_due(uuid),
  public.custody_inv_maintenance_signals(uuid),
  public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric),
  public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz),
  public.custody_inv_asset_cost_summary(uuid)
  to authenticated;

-- مفاتيح الصلاحيات الدقيقة — تدخل الكتالوج القائم إن كان مطبَّقًا، ولا تُنشئه.
-- ملاحظة: لا مفتاح للتكلفة الحسّاسة عمدًا (لا يُفتح هذا السطح بترقية مهنة).
do $p$
begin
  if to_regclass('public.permissions') is not null then
    execute $q$
      insert into public.permissions (key, category, sensitivity, label_ar, label_en, sort_order)
      select v.key, v.category, v.sensitivity, v.ar, v.en, v.ord
        from (values
          ('assets.view',       'custody', 'normal',    'عرض الأصول (تشغيليًّا)',   'View assets (operations)', 610),
          ('assets.manage',     'custody', 'normal',    'إدارة كتالوج الأصول',      'Manage asset catalogue',   611),
          ('custody.close',     'custody', 'sensitive', 'إغلاق العهدة بعد الفحص',   'Close custody after inspection', 612),
          ('maintenance.manage','custody', 'normal',    'إدارة الصيانة وخططها',     'Manage maintenance & plans', 613)
        ) as v(key, category, sensitivity, ar, en, ord)
      on conflict (key) do update set
        category = excluded.category, sensitivity = excluded.sensitivity,
        label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order
    $q$;
  end if;
end $p$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) SELF-TEST — ثابت بالكامل. لا نداء RPC محميّة:
-- محرّر SQL يعمل بدور postgres وauth.uid() = NULL، فنداء دالّة محميّة يرفع
-- «not authorized» ويقتل الترحيلة. الفحص هنا على **أجسام** الدوالّ عبر
-- pg_get_functiondef + ilike (المُفكِّك يرفع حالة COALESCE)، وعلى الكتالوج.
-- ════════════════════════════════════════════════════════════════════════════
begin;
-- ════════════════════════════════════════════════════════════════════════════
-- §٩-ب) ★ قرار صلاحيات صريح لكلّ دالّة تُنشئها هذه الحزمة ★
--   PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًّا، وanon عضو في PUBLIC فيرث.
--   ترك الافتراضيّ ليس حيادًا بل قرار — وهو القرار الذي أوقف الفحص الذاتيّ.
--   هذه الدوالّ كلّها داخلية (مُسنَدات · حرّاس زناد · محوّلات · نوى حساب):
--   لا يناديها التطبيق مباشرةً، فلا EXECUTE لأيّ دور API.
--   وما يناديه التطبيق فعلًا يُمنح في رقعة الصلاحيات المستقلّة بالاسم.
-- ════════════════════════════════════════════════════════════════════════════
do $acl$
declare f text; r record;
begin
  foreach f in array array[
    'civ_allowed_transitions', 'civ_asset_state', 'civ_can_close_custody',
    'civ_can_issue_custody', 'civ_can_manage_assets', 'civ_can_manage_maintenance',
    'civ_can_view_asset_sensitive_costs', 'civ_condition_to_grade', 'civ_grade_to_condition',
    'civ_guard_asset_disposal', 'civ_guard_assignment_closure', 'civ_guard_assignment_history',
    'civ_guard_evidence_path', 'civ_guard_reservation', 'civ_meter_block_write',
    'civ_meter_usage_between', 'civ_sync_condition_grade', 'custody_inv_admin_create_reservation_v2',
    'custody_inv_admin_revoke_qr', 'custody_inv_asset_cost_summary', 'custody_inv_asset_meter_totals',
    'custody_inv_asset_utilization', 'custody_inv_expire_reservations', 'custody_inv_fulfil_reservation',
    'custody_inv_lookup_asset', 'custody_inv_maint_close_with_inspection', 'custody_inv_maint_plan_archive',
    'custody_inv_maint_plan_due', 'custody_inv_maint_plan_upsert', 'custody_inv_maintenance_signals',
    'custody_inv_post_closure_correction', 'custody_inv_qr_scan', 'custody_inv_record_meter',
    'custody_inv_reservation_calendar', 'custody_inv_reverse_meter'
  ] loop
    for r in select p.oid::regprocedure::text as sig
               from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = f
    loop
      execute format('revoke all on function %s from public', r.sig);
      begin execute format('revoke all on function %s from anon', r.sig);
        exception when undefined_object then null; end;
      begin execute format('revoke all on function %s from authenticated', r.sig);
        exception when undefined_object then null; end;
    end loop;
  end loop;
end $acl$;

do $st$
declare f text; v_def text; n int;
begin
  -- (١) الجدولان الجديدان فقط — ولا عائلة asset_* إطلاقًا
  foreach f in array array['custody_inventory_maintenance_plans','custody_inventory_meter_readings'] loop
    if to_regclass('public.' || f) is null then
      raise exception 'ASSET SELF-TEST: الجدول % غائب', f; end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
             where ns.nspname='public' and c.relname = f) then
      raise exception 'ASSET SELF-TEST: RLS غير مفعّلة على %', f; end if;
  end loop;
  -- ★★ لا مصدر حقيقة ثانٍ للأصول — بالبنية لا بالاسم ★★
  --   الصيغة السابقة كانت `relname like 'asset\_%'` مع استثناء مكتوب باليد
  --   لـasset_insurance_policies. وهي تعمل، لكنّها تحرس ما عرفناه: جدولٌ
  --   جديد يخزّن barcode وserial_number باسم لا يبدأ بـasset_ يمرّ بلا اعتراض،
  --   وامتدادٌ بريء يبدأ بـasset_ يسقط ويحتاج استثناءً جديدًا كلّ مرّة.
  --   والتعريف الصحيح صفتان معًا: يحمل **هويّة أصل** (عمودان فأكثر من مجموعة
  --   الهويّة/الحالة)، **ولا** يملك رابطًا إلزاميًّا إلى المالك — لا مفتاح
  --   أجنبيّ not null إلى custody_inventory_assets ولا جدول وصل بمفاتيح
  --   not null. فبوليصة التأمين تمرّ لأنّها بلا أعمدة هويّة أصلًا، ولا
  --   تحتاج أن تُذكر باسمها.
  select coalesce(string_agg(x.relname, ', ' order by x.relname), '') into v_def
    from (
      select c.relname,
             (select count(*) from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and a.attname in ('asset_code','barcode','qr_code_value','asset_name',
                                   'serial_number','category_id','condition_status',
                                   'availability_status')) as ident,
             (exists (select 1 from pg_constraint fk
                       join pg_attribute a on a.attrelid = c.oid and a.attnum = fk.conkey[1]
                      where fk.conrelid = c.oid and fk.contype = 'f'
                        and fk.confrelid = to_regclass('public.custody_inventory_assets')
                        and a.attnotnull)
              or exists (select 1 from pg_constraint j1
                          join pg_constraint j2 on j2.conrelid = j1.conrelid and j2.contype = 'f'
                                               and j2.confrelid = to_regclass('public.custody_inventory_assets')
                         where j1.contype = 'f' and j1.confrelid = c.oid)) as linked
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p')
         and c.oid is distinct from to_regclass('public.custody_inventory_assets')
    ) x
   where x.ident >= 2 and not x.linked;
  if v_def <> '' then
    raise exception 'ASSET SELF-TEST: مصدر حقيقة ثانٍ للأصول (%) — يحمل أعمدة هويّة أصل بلا رابط إلزاميّ إلى custody_inventory_assets. المالك واحد، والامتداد يرتبط به لا يستنسخه', v_def; end if;

  -- (٢) البوّابات القائمة لم تُعَد كتابتها في هذه الحزمة
  --     (لو أُعيدت بلا coalesce لانهار «if not gate» إلى NULL في ~120 موضع)
  foreach f in array array['public.civ_can_manage()','public.civ_can_finance()'] loop
    if to_regprocedure(f) is not null
       and not coalesce(pg_get_functiondef(to_regprocedure(f)) ilike '%coalesce%', false)
       and f = 'public.civ_can_manage()' then
      raise exception 'ASSET SELF-TEST: civ_can_manage() فقدت coalesce — الحزمة أعادت تعريفها خطأً'; end if;
  end loop;

  -- (٣) المُسنَدات الستّة موجودة وكلّها تعيد boolean صريحًا (coalesce على كلّ مسار)
  foreach f in array array[
    'public.civ_can_view_assets()','public.civ_can_manage_assets()',
    'public.civ_can_issue_custody()','public.civ_can_close_custody()',
    'public.civ_can_manage_maintenance()','public.civ_can_view_asset_sensitive_costs()'
  ] loop
    if to_regprocedure(f) is null then raise exception 'ASSET SELF-TEST: المُسنَد % غائب', f; end if;
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%coalesce%' then
      raise exception 'ASSET SELF-TEST: % قد يعيد NULL — «if not %» ستُتخطّى بصمت', f, f; end if;
    if v_def not ilike '%security definer%' or coalesce(v_def not ilike '%search_path%', true) then
      raise exception 'ASSET SELF-TEST: % بلا SECURITY DEFINER أو بلا مسار بحث مثبَّت', f; end if;
  end loop;

  -- (٤) التكلفة الحسّاسة مالكيّة ولا تلمس أيّ جدول مالي (لا استنتاج ربح)
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_asset_cost_summary(uuid)'));
  if v_def not ilike '%civ_can_view_asset_sensitive_costs%' then
    raise exception 'ASSET SELF-TEST: ملخّص التكلفة بلا بوّابة حسّاسة'; end if;
  foreach f in array array['fin_','invoices','quotes','opportunities','zoho','profit'] loop
    if v_def ilike '%public.' || f || '%' then
      raise exception 'ASSET SELF-TEST: ملخّص التكلفة يلمس % — هذا يعيد فتح استنتاج الربح', f; end if;
  end loop;

  -- (٥) سطح التشغيل خالٍ من المال فعلًا
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz)'));
  foreach f in array array['purchase_price','current_value','book_value','salvage_value','cost'] loop
    -- ⚠️ الشرطة السفلية تُهرَّب: في LIKE/ILIKE هي محرف بدل، فـ'purchase_price'
    --    كان يطابق أيضًا purchaseXprice. هذا اتّجاه إنذارٍ كاذب لا ثغرة،
    --    لكنّه الفخّ نفسه الذي أسقط الترحيلة عند 'ai_'. يُغلق حيث وُجد.
    if v_def ilike '%' || replace(f, '_', '\_') || '%' escape '\' then
      raise exception 'ASSET SELF-TEST: دالّة الاستغلال التشغيلية تكشف % — العمليات لا ترى مالًا', f; end if;
  end loop;
  if v_def not ilike '%contains_financials%' then
    raise exception 'ASSET SELF-TEST: دالّة الاستغلال لا تُعلن خلوّها من المال'; end if;

  -- (٦) الحمولة العامّة للـQR فقيرة عمدًا
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_qr_public_payload(uuid)'));
  foreach f in array array['purchase_price','current_value','book_value','file_path','employee_user_id','auth.users'] loop
    -- ⚠️ الشرطة السفلية تُهرَّب: في LIKE/ILIKE هي محرف بدل، فـ'purchase_price'
    --    كان يطابق أيضًا purchaseXprice. هذا اتّجاه إنذارٍ كاذب لا ثغرة،
    --    لكنّه الفخّ نفسه الذي أسقط الترحيلة عند 'ai_'. يُغلق حيث وُجد.
    if v_def ilike '%' || replace(f, '_', '\_') || '%' escape '\' then
      raise exception 'ASSET SELF-TEST: حمولة QR العامّة تحمل % — يجب أن تخلو من التكلفة وبيانات الموظّف ومسارات التخزين', f; end if;
  end loop;
  if v_def ilike '%''asset_id''%' or v_def ilike '%''id'', a%' then
    raise exception 'ASSET SELF-TEST: حمولة QR العامّة تحمل معرّفًا — تُستَغَلّ للتعداد'; end if;
  if has_function_privilege('authenticated', 'public.custody_inv_qr_public_payload(uuid)', 'EXECUTE') then
    raise exception 'ASSET SELF-TEST: حمولة QR العامّة قابلة للنداء مباشرةً — يجب أن تمرّ عبر custody_inv_qr_scan (تحديد معدّل + تدقيق)'; end if;

  -- (٧) المسح يفرض جلسة وتحديد معدّل ويسجّل
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_qr_scan(uuid,text)'));
  if v_def not ilike '%is_staff%'      then raise exception 'ASSET SELF-TEST: المسح لا يشترط جلسة موظّف (V1 لا يسمح ببحث مجهول)'; end if;
  if v_def not ilike '%civ_qr_rate_ok%' then raise exception 'ASSET SELF-TEST: المسح بلا تحديد معدّل'; end if;
  if v_def not ilike '%qr_revoked%'     then raise exception 'ASSET SELF-TEST: المسح لا يحترم الإلغاء'; end if;
  if v_def not ilike '%custody_qr_events%' then raise exception 'ASSET SELF-TEST: المسح لا يُسجَّل'; end if;
  -- إعادة الإصدار تُبطل القديم فعلًا (الدالّة القائمة — نتحقّق ولا نعيد كتابتها)
  if to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)') is not null then
    v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)'));
    if v_def not ilike '%qr_token = v_new%' or v_def not ilike '%old_token%' then
      raise exception 'ASSET SELF-TEST: إعادة إصدار QR لا تُبطل الرمز السابق أو لا تسجّله'; end if;
  end if;

  -- (٨) دفتر الاستخدام ملحق: ثلاثة مُشغِّلات مانعة + مفتاح تعطيل تكرار فريد
  foreach f in array array['trg_civ_meter_no_update','trg_civ_meter_no_delete','trg_civ_meter_no_truncate'] loop
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = 'public.custody_inventory_meter_readings'::regclass
                      and g.tgname = f and not g.tgisinternal) then
      raise exception 'ASSET SELF-TEST: مُشغِّل الحماية % غائب — الدفتر صار قابلًا للتعديل', f; end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_civ_meter_idem') then
    raise exception 'ASSET SELF-TEST: مفتاح تعطيل التكرار غير فريد — إعادة الإرسال ستضاعف الساعات'; end if;

  -- (٨-ب) ★ النمط المطلق محسوب فعلًا. الخطأ الذي يُحرَس هنا: تصفية
  -- reading_mode = 'increment' داخل المستهلكين تجعل عدّاد الغالق يقرأ صفرًا،
  -- فلا يحين استحقاق الصيانة بالاستخدام أبدًا بينما تعرض الشاشة رقمًا واثقًا.
  foreach f in array array['public.civ_meter_total(uuid,text)',
                           'public.civ_meter_usage_between(uuid,text,timestamptz,timestamptz)'] loop
    if to_regprocedure(f) is null then
      raise exception 'ASSET SELF-TEST: مساعد العدّاد % غائب — المجاميع ستتجاهل النمط المطلق', f; end if;
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%absolute%' then
      raise exception 'ASSET SELF-TEST: % لا يعالج النمط المطلق', f; end if;
  end loop;
  foreach f in array array['public.custody_inv_asset_meter_totals(uuid)',
                           'public.custody_inv_maint_plan_due(uuid)',
                           'public.custody_inv_maintenance_signals(uuid)'] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def ilike '%reading_mode = ''increment''%' or v_def ilike '%reading_mode=''increment''%' then
      raise exception 'ASSET SELF-TEST: % ما زالت تصفّي النمط increment — الأصل المقروء بعدّاد مطلق سيُبلّغ عن استخدام صفر بصمت', f; end if;
    if v_def not ilike '%civ_meter_total%' and v_def not ilike '%civ_meter_usage_between%' then
      raise exception 'ASSET SELF-TEST: % لا تشتقّ العدّاد من المساعد الموحّد', f; end if;
  end loop;

  -- (٩) حارس الحجز على **الجدول** لا داخل RPC واحدة، ويرفع 23P01 مميّزًا
  if not exists (select 1 from pg_trigger g
                  where g.tgrelid = 'public.custody_inventory_reservations'::regclass
                    and g.tgname = 'trg_civ_guard_reservation' and not g.tgisinternal) then
    raise exception 'ASSET SELF-TEST: حارس الحجز غائب — v1 المُصرَّحة تتجاوز أيّ ضمان مكتوب داخل v2'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.civ_guard_reservation()'));
  if v_def not ilike '%23P01%' then
    raise exception 'ASSET SELF-TEST: حارس الحجز لا يرفع رمز تعارض مميّزًا — ستُقرأ كـ«ترحيلة ناقصة»'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid)'));
  if v_def not ilike '%reserved_from%' then
    raise exception 'ASSET SELF-TEST: محرّك التعارض يتجاهل reserved_from — حجز الشهر القادم سيمنع اليوم'; end if;
  if v_def not ilike '%prodops_asset_clash%' then
    raise exception 'ASSET SELF-TEST: محرّك التعارض لا يستهلك عقد prodops — قاعدة تعارض ثانية متناقضة'; end if;
  -- المصيدة الشاملة ممنوعة هنا: ابتلاع الخطأ يحوّل «تعارض» إلى «لا تعارض»
  if v_def ilike '%when others then return null%' then
    raise exception 'ASSET SELF-TEST: محرّك التعارض يبتلع الأخطاء فيدّعي خلوّ الأصل'; end if;

  -- (١٠) حرّاس النزاهة الأربعة قائمون
  foreach f in array array[
    'trg_civ_guard_assignment_closure:custody_inventory_assignments',
    'trg_civ_guard_assignment_history:custody_inventory_assignments',
    'trg_civ_guard_evidence_path:custody_inventory_evidence',
    'trg_civ_guard_asset_disposal:custody_inventory_assets'
  ] loop
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = ('public.' || split_part(f, ':', 2))::regclass
                      and g.tgname = split_part(f, ':', 1) and not g.tgisinternal) then
      raise exception 'ASSET SELF-TEST: حارس النزاهة % غائب', f; end if;
  end loop;
  v_def := pg_get_functiondef(to_regprocedure('public.civ_guard_assignment_closure()'));
  if v_def not ilike '%employee_user_id%' or v_def not ilike '%civ_self_closure_denied%' then
    raise exception 'ASSET SELF-TEST: حارس الإغلاق لا يمنع اعتماد الموظّف إغلاق عهدته'; end if;

  -- (١١) إشارات الصيانة قواعد لا ذكاء اصطناعيّ، وكلّ إشارة تحمل أساسها
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_maintenance_signals(uuid)'));
  if v_def not ilike '%''basis''%' or v_def not ilike '%''rule''%' then
    raise exception 'ASSET SELF-TEST: إشارة بلا قاعدة أو بلا أساس رقميّ — لا تُراجَع ولا تُرفَض'; end if;
  -- ★★ صدق التسمية: يُحكَم على **الأسماء الحيّة** لا على نصّ الملفّ ★★
  --
  --  ⚠️ الصيغة السابقة كانت:  v_def ilike '%' || f || '%'   مع f = 'ai_'
  --     وهي أسقطت الترحيلة هنا. والسبب ليس أنّ الحزمة تدّعي ذكاءً — بل أنّ
  --     الشرطة السفلية في LIKE/ILIKE **محرف بدل** يطابق أيّ محرف واحد. فالنمط
  --     '%ai_%' لا يعني «يبدأ بـai_» بل «ai يتبعها أيّ محرف»، فطابق 28 موضعًا
  --     أوّلها اسم الدالّة نفسها: custody_inv_m·ai·ntenance_signals، ثمّ
  --     days_rem·ai·ning و r·ai·se. كلمات إنجليزية عادية، لا ادّعاء فيها.
  --     ولا معرّف واحد في الحزمة يبدأ فعلًا بـai_ ، و'predict' و'forecast_model'
  --     و'machine_learning' صفر مطابقة.
  --
  --  والدرس أعمّ من الهروب: الحكم على **نصّ التعريف** يخلط الواجهة الحيّة
  --  بالتعليق الذي ينفي الادّعاء. فالمصدر هنا كتالوج النظام: أسماء الدوالّ
  --  والجداول والأعمدة كما هي فعلًا. والمطابقة بتعبير نمطيّ مرسّى لا بـLIKE،
  --  فلا محرف بدل يتسلّل. وأمّا وسم الحزمة أنّها «ليست ذكاءً اصطناعيًّا» فيُقال
  --  في التعليقات بحرّية: التعليق شرحٌ لا واجهة.
  select coalesce(string_agg(distinct x.n, ' · ' order by x.n), '') into v_def
    from (
      select p.proname as n
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'custody\_inv\_%' escape '\'
      union all
      select c.relname
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p','v','m')
         and c.relname like 'custody\_inv\_%' escape '\'
      union all
      select a.attname
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p')
         and c.relname like 'custody\_inv\_%' escape '\'
         and a.attnum > 0 and not a.attisdropped
    ) x
   where x.n ~ '^(ai|ml)_|_(ai|ml)$|predict|forecast|machine_learning|neural|deep_learning|intelligen|confidence_score';
  if v_def <> '' then
    raise exception 'ASSET SELF-TEST: اسم حيّ يدّعي التنبّؤ أو الذكاء (%) — الإشارات قواعد صريحة، فليُسمَّ ما هو عليه: maintenance_priority · due_soon · risk_indicator · rule_based', v_def;
  end if;

  -- والمفاتيح التي تخرج فعلًا من دالّة الإشارات: نفس الحكم، على المفاتيح
  -- الحرفية في jsonb_build_object لا على كلّ نصّ الجسم.
  select coalesce(string_agg(distinct m[1], ' · '), '') into v_def
    from regexp_matches(
           regexp_replace(pg_get_functiondef(to_regprocedure('public.custody_inv_maintenance_signals(uuid)')),
                          chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g'),
           '''([a-z_][a-z0-9_]*)''\s*,', 'g') m
   where m[1] ~ '^(ai|ml)_|_(ai|ml)$|predict|forecast|machine_learning|neural|intelligen|confidence_score';
  if v_def <> '' then
    raise exception 'ASSET SELF-TEST: مفتاح خارج من الإشارات يدّعي التنبّؤ (%) — القاعدة تُعلَن باسمها لا باسم نموذج', v_def;
  end if;

  -- (١٢) التدقيق مكتوب في كلّ كتابة حسّاسة
  foreach f in array array[
    'public.custody_inv_admin_create_reservation_v2(jsonb)',
    'public.custody_inv_fulfil_reservation(uuid,uuid)',
    'public.custody_inv_admin_revoke_qr(uuid,text)',
    'public.custody_inv_record_meter(jsonb)',
    'public.custody_inv_reverse_meter(uuid,text)',
    'public.custody_inv_maint_plan_upsert(jsonb)',
    'public.custody_inv_maint_plan_archive(uuid,text)',
    'public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric)',
    'public.custody_inv_post_closure_correction(uuid,text,jsonb)'
  ] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%custody_audit%' then
      raise exception 'ASSET SELF-TEST: % بلا تدقيق', f; end if;
  end loop;

  -- (١٣) لا anon على أيّ كائن جديد
  if exists (select 1 from information_schema.role_table_grants
              where table_schema='public' and grantee='anon'
                and table_name in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings')) then
    raise exception 'ASSET SELF-TEST: anon يملك صلاحية على جدول جديد'; end if;
  -- ⚠️ هذا الفحص أوقف الترحيلة على الإنتاج، وهو **محقّ**. المشكلة أوسع من
  --    دالّة: PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًّا عند الإنشاء، و
  --    `grant … to authenticated` لا يُلغي ذلك بل يضيف فوقه، وanon عضو في
  --    PUBLIC فيرث. من 135 دالّة عهدة كانت 78 بلا revoke — منها 35 تُنشئها هذه
  --    الحزمة نفسها. ولا منحة مباشرة واحدة لـanon: الوراثة هي المسار كلّه.
  --    ⚠️ الإنتاج يُغلَق بـdocs/asset_intelligence_security_patch_RUNME.sql —
  --       فهذه الحزمة مطبَّقة جزئيًّا ولا تُعاد لإغلاق ACL وحدها.
  if exists (select 1 from pg_roles where rolname='anon') then
    for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
              where ns.nspname='public'
                and (p.proname like 'custody\_inv\_%' or p.proname like 'civ\_%')
                and has_function_privilege('anon', p.oid, 'EXECUTE') loop
      raise exception 'ASSET SELF-TEST: anon يملك تنفيذ %', f;
    end loop;
  end if;

  -- (١٤) لا سياسة كتابة مباشرة على الجدولين الجديدين
  if exists (select 1 from pg_policies where schemaname='public'
              and tablename in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings')
              and cmd <> 'SELECT') then
    raise exception 'ASSET SELF-TEST: سياسة كتابة مباشرة تتجاوز الـRPC'; end if;

  -- (١٥) لا قيمة صفر تقف مقام «غير مفعّل» في ملخّص التكلفة
  v_def := pg_get_functiondef(to_regprocedure('public.custody_inv_asset_cost_summary(uuid)'));
  if v_def not ilike '%source_available%' then
    raise exception 'ASSET SELF-TEST: ملخّص التكلفة لا يُعلن توفّر مصادره — الصفر سيُقرأ «لا تكلفة»'; end if;

  -- (١٦) آلة الحالة مُشتقّة: لا عمود state محفوظ يمكن أن ينحرف
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='custody_inventory_assets'
                and column_name in ('asset_state','lifecycle_state','state')) then
    raise exception 'ASSET SELF-TEST: حالة الأصل محفوظة كعمود — يجب أن تبقى مُشتقّة من الأعمدة القائمة'; end if;

  -- (١٧) ★ كلّ مقارنة نوافذ تمرّ ببانية آمنة — لا tstzrange خام على عمود حيّ.
  --      السبب: الحزمة تُبقي عمدًا صفوفًا بنافذة مقلوبة (القيد NOT VALID، والبوّاب
  --      يوقف على الحجز النشط فقط)، وtstzrange ترفع 22000 على المقلوب. لو عاد
  --      مستهلك إلى الشكل الخام لسقط تقويم الحجز أو محرّك التعارض على صفّ تاريخيّ
  --      برمز لا تصنّفه pgerror.ts — وهو بالضبط العطل الذي أُغلق هنا.
  if to_regprocedure('public.civ_window(timestamptz,timestamptz)') is null then
    raise exception 'ASSET SELF-TEST: civ_window مفقودة — النوافذ الزمنيّة بلا بانية آمنة'; end if;
  foreach f in array array[
    'public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid)',
    'public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid)',
    'public.civ_asset_state(uuid)',
    'public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz)'
  ] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%civ_window%' then
      raise exception 'ASSET SELF-TEST: % ما زالت على tstzrange الخام — صفّ بنافذة مقلوبة سيرفع 22000', f; end if;
  end loop;

  raise notice 'ASSET SELF-TEST: نجح — جدولان جديدان فقط، لا عائلة asset_*، ستّة مُسنَدات لا تعيد NULL، حارس حجز على الجدول برمز 23P01، دفتر استخدام ملحق بثلاثة مُشغِّلات، QR بحمولة فقيرة ومعدّل ومُدقَّق، تكلفة مالكيّة لا تلمس أيّ جدول مالي، نوافذ زمنيّة آمنة من 22000، والبوّابات القائمة لم تُمَسّ.';
end $st$;
commit;

notify pgrst, 'reload schema';
