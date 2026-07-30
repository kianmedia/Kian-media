-- ════════════════════════════════════════════════════════════════════════════
-- operations_center_RUNME.sql                    — RUN ONCE (ويُعاد تشغيله بأمان)
-- مركز التشغيل والإنتاج · Production Operations Centre — Phase 2
--
-- ─── ما هذه الحزمة ──────────────────────────────────────────────────────────
-- موديول تشغيل **مستقلّ** لأوامر العمل الميدانية: مهمّة إنتاج واحدة تجمع الطاقم
-- والمعدّات والموقع والتصاريح والسفر والسكن والمركبات وسلامة الموقع وبطاقات
-- الذاكرة والنسخ الاحتياطي والتسليم لما بعد الإنتاج والتقارير اليومية والحوادث
-- وأسباب التأخير. يُستعمل على الموقع من الجوّال.
--
-- ─── علاقته بمنصّة المشاريع: قراءة فقط، واختيارية ─────────────────────────
-- ops_jobs.project_id مفتاح **اختياريّ** (on delete set null) يُستعمل لعرض اسم
-- المشروع فقط. لا هذه الحزمة ولا أيّ دالّة فيها تكتب في projects أو project_core
-- أو deliverables أو أيّ كائن project_* / large_project_*. المنصّة مجمَّدة.
--
-- ─── ما أُعيد استعماله بدل تكراره (تركيب لا نظام موازٍ) ────────────────────
--   • public.is_staff() / is_owner() / is_admin()      — هويّة الموظّف القائمة.
--   • public.emp_has_permission(uuid,text)             — محرّك الصلاحيات الدقيق
--     (permission_catalog_RUNME.sql). تُضاف مفاتيح operations.* إلى نفس الكتالوج
--     ولا يُبنى محرّك صلاحيات ثانٍ. الاستدعاء **مكتشَف ديناميكيًّا**: لو لم يكن
--     الكتالوج مطبَّقًا يبقى المالك/الأدمن يعملان والباقي يُمنع (fail-closed).
--   • public.custody_inventory_reservations / _assignments — حجز المخزون وتسليم
--     العهدة يبقيان مصدر الحقيقة في موديول العهدة. هنا **مرجع** فقط
--     (custody_reservation_id / custody_assignment_id) + محرّك التعارضات يقرأهما.
--   • public.resource_bookings / planning_resources (4B) — طبقة حجز التخطيط
--     تُقرأ في كشف التعارضات ولا تُكرَّر ولا تُعدَّل.
--   • public.notify(...) — الإشعار القائم، معزول باستثناء (قيد type منجرف).
--   • public.professions — تُقرأ لتصنيف الطاقم بالمهنة (مرجع رخو بلا FK كي تبقى
--     الحزمة إضافية لو لم يكن موديول المهن مطبَّقًا).
-- لم يُنشأ: جدول موارد ثانٍ، ولا جدول إشعارات، ولا محرّك صلاحيات، ولا نسخة من
-- مخزون الأصول، ولا أيّ لمسة على preproduction_items (تخطيط ما قبل الإنتاج يبقى
-- هناك؛ هنا **تنفيذ** ميدانيّ).
--
-- ─── بادئة الأسماء ─────────────────────────────────────────────────────────
-- الدوالّ كلّها prodops_* لأنّ ops_can_view()/ops_visible_ids() محجوزتان لـ7B
-- (مركز العمليات الإداريّ فوق المشاريع). الجداول كلّها ops_*.
--
-- ─── الصلاحيات (مُسنَدات خاصّة بالموديول — لا can_manage_projects) ─────────
--   المالك/الأدمن           → كلّ شيء.
--   مدير التشغيل            → operations.manage (مفتاح صريح في الكتالوج).
--   فرد الطاقم              → مهامّه هو فقط: يرى، يؤكّد حضوره، يحرّر تقريره هو.
--   المونتير                → أعمال ما بعد الإنتاج المُسندة إليه هو فقط.
--   العميل / الزائر         → لا شيء إطلاقًا. لا قراءة ولا كتابة ولا وجود.
--
-- ─── قواعد ملزمة ──────────────────────────────────────────────────────────
--   • كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا (fail-closed).
--   • لا سياسة كتابة مباشرة على أيّ جدول: كلّ كتابة عبر SECURITY DEFINER RPC.
--   • لا صلاحية anon على أيّ دالّة أو جدول.
--   • كلّ كتابة حسّاسة مُدقَّقة في ops_audit.
--   • الطقس **Placeholder يدويّ**: لا اتصال خارجيّ، ولا مفتاح API، ولا cron.
--   • Additive · Idempotent · Transaction · بلا DROP لبيانات.
--
-- ─── ملاحظة تشغيلية: الـSELF-TEST ثابت ─────────────────────────────────────
-- محرّر SQL في Supabase يعمل بدور postgres وauth.uid() = NULL. أيّ استدعاء حيّ
-- لدالّة محميّة هنا يرفع "not authorized" ويُسقط الترحيلة كلّها. لذلك الفحص
-- بـpg_get_functiondef + ilike (المُفكِّك يرفع حالة COALESCE) ولا شيء ملفوف
-- بمصيدة تجعله ينجح مهما حدث.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) PREFLIGHT صلب — الاعتمادات التي لا تُحاكى ─────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('public.profiles')  is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.is_staff()')  is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()')  is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()')  is null then miss := miss || ' is_admin()'; end if;
  if miss <> '' then
    raise exception 'OPS PREFLIGHT: اعتمادات ناقصة —%. شغّل phase0_migration.sql وstaff_roles_task_assignment_RUNME.sql أوّلًا.', miss;
  end if;
  -- اختياريّ (يُكتشف ديناميكيًّا لاحقًا): permissions · custody_inventory_* · resource_bookings · projects
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then
    raise notice 'OPS: محرّك الصلاحيات غير مطبَّق — سيعمل المالك/الأدمن فقط حتى تُشغّل permission_catalog_RUNME.sql.';
  end if;
  if to_regclass('public.projects') is null then
    raise notice 'OPS: جدول projects غير موجود — الربط بالمشروع سيبقى معطّلًا (اختياريّ أصلًا).';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--     تُنفَّذ فقط إن كان جدول permissions موجودًا (إضافيّة ومكتشَفة).
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'OPS §1: جدول permissions غير موجود — تخطّي بذر المفاتيح.';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'operations', v.sens, v.ord, v.ar, v.en
  from (values
    (1210,'operations.view',              'normal',   'عرض مركز التشغيل',            'View operations centre'),
    (1220,'operations.manage',            'sensitive','إدارة مركز التشغيل',          'Manage operations centre'),
    (1230,'operations.assign_crew',       'normal',   'إسناد الطاقم',                'Assign crew'),
    (1240,'operations.manage_equipment',  'normal',   'إدارة معدّات المهمّة',          'Manage job equipment'),
    (1250,'operations.manage_permits',    'normal',   'إدارة التصاريح والموافقات',    'Manage permits'),
    (1260,'operations.confirm_attendance','normal',   'تأكيد الحضور',                'Confirm attendance'),
    (1270,'operations.submit_report',     'normal',   'رفع التقرير اليوميّ',          'Submit daily report'),
    (1280,'operations.manage_post',       'normal',   'تسليم ما بعد الإنتاج',         'Post-production handoff')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) المُسنَدات — خاصّة بالموديول. لا واحد منها يعيد NULL.
--     ⚠️ لا تُبنى على can_manage_projects: هذا موديول تشغيل لا موديول مشاريع.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (fail-closed) لا استثناء.
-- المصيدة هنا تُفشِل ولا تُنجِح — وهذا هو الفرق بينها وبين المصيدة الكاذبة.
create or replace function public.prodops_perm(p_key text) returns boolean
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

-- مدير التشغيل: المالك/الأدمن أو حامل المفتاح الصريح.
create or replace function public.prodops_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (coalesce(public.is_owner(), false)
      or coalesce(public.is_admin(), false)
      or coalesce(public.prodops_perm('operations.manage'), false)),
  false);
$$;

-- من يفتح المركز أصلًا: موظّف فقط. العميل والزائر خارج البوّابة نهائيًّا.
create or replace function public.prodops_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (coalesce(public.prodops_can_manage(), false) or coalesce(public.is_staff(), false)),
  false);
$$;

-- تصريح صريح بأنّ صاحب الجلسة عميل/زائر — يُستعمل في الرسائل والاختبارات.
create or replace function public.prodops_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — 20 جدولًا، كلّها ops_*.
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 المواقع + أشخاص التواصل
create table if not exists public.ops_locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 200),
  kind          text not null default 'other'
                check (kind in ('studio','outdoor','client_site','office','venue','other')),
  address       text, city text, map_url text,
  lat           double precision, lng double precision,
  contact_name  text, contact_phone text, contact_role text, contact_note text,
  access_notes  text, parking_notes text,
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);
comment on table public.ops_locations is 'مواقع التصوير/التنفيذ وأشخاص التواصل فيها. مستقلّة عن project_locations (تخطيط المشروع) ولا تعدّلها.';
create index if not exists ix_ops_loc_live on public.ops_locations(is_active) where is_deleted = false;

-- 3.2 المركبات
create table if not exists public.ops_vehicles (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (length(btrim(label)) between 2 and 120),
  plate_no     text, vehicle_type text not null default 'car'
               check (vehicle_type in ('car','van','truck','bus','motorcycle','other')),
  seats        int check (seats is null or seats >= 0),
  notes        text,
  is_active    boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_ops_veh_live on public.ops_vehicles(is_active) where is_deleted = false;

-- 3.3 أمر العمل / مهمّة الإنتاج
create sequence if not exists public.ops_job_code_seq;
create table if not exists public.ops_jobs (
  id               uuid primary key default gen_random_uuid(),
  job_code         text not null unique,
  title            text not null check (length(btrim(title)) between 2 and 300),
  job_type         text not null default 'other'
                   check (job_type in ('filming','photography','drone','live_stream','podcast',
                                       'editing','design','field_execution','event','other')),
  -- ★ رابط اختياريّ للعرض فقط. لا تُعدَّل projects ولا تُقرأ إلّا الاسم. ★
  project_id       uuid,
  client_label     text,                      -- نصّ حرّ؛ لا حساب عميل يُكشف هنا
  status           text not null default 'draft'
                   check (status in ('draft','scheduled','confirmed','in_progress','on_hold','completed','cancelled')),
  priority         text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  scheduled_start  timestamptz, scheduled_end timestamptz,
  actual_start     timestamptz, actual_end   timestamptz,
  timezone         text not null default 'Asia/Riyadh',
  location_id      uuid references public.ops_locations(id) on delete set null,
  location_note    text,
  permit_required  boolean not null default false,
  travel_required  boolean not null default false,
  description      text, internal_notes text,
  owner_user_id    uuid references auth.users(id) on delete set null,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  is_deleted       boolean not null default false,
  deleted_at       timestamptz, deleted_by uuid, delete_reason text,
  constraint ops_jobs_window   check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start),
  constraint ops_jobs_actual   check (actual_end    is null or actual_start    is null or actual_end    > actual_start)
);
comment on column public.ops_jobs.project_id is
  'رابط اختياريّ بمشروع للعرض فقط. المنصّة مجمَّدة: لا كتابة ولا تعديل ولا اعتماد عليها في أيّ حارس.';
create index if not exists ix_ops_jobs_time    on public.ops_jobs(scheduled_start, scheduled_end) where is_deleted = false;
create index if not exists ix_ops_jobs_status  on public.ops_jobs(status)      where is_deleted = false;
create index if not exists ix_ops_jobs_project on public.ops_jobs(project_id)  where project_id is not null and is_deleted = false;
create index if not exists ix_ops_jobs_loc     on public.ops_jobs(location_id) where location_id is not null and is_deleted = false;

-- المفتاح الخارجيّ إلى projects يُضاف **فقط** إن كان الجدول موجودًا، وبـset null
-- كي لا يمنع الموديول حذف مشروع ولا يفرض ترتيب تشغيل على المنصّة المجمَّدة.
do $fk$
begin
  if to_regclass('public.projects') is not null
     and not exists (select 1 from pg_constraint where conname = 'ops_jobs_project_fk') then
    alter table public.ops_jobs
      add constraint ops_jobs_project_fk foreign key (project_id)
      references public.projects(id) on delete set null;
  end if;
end $fk$;

-- 3.4 الطاقم — إسناد بالدور والمهنة
create table if not exists public.ops_job_crew (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.ops_jobs(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  profession_id  uuid,                       -- مرجع رخو إلى professions (بلا FK: إضافيّة)
  crew_role      text not null default 'crew'
                 check (crew_role in ('director','producer','dop','camera','camera_assistant','gaffer',
                                      'sound','drone_pilot','stylist','talent','editor','designer',
                                      'coordinator','driver','crew','other')),
  external_name  text, external_phone text,
  call_time      timestamptz, wrap_time timestamptz,
  status         text not null default 'assigned'
                 check (status in ('invited','assigned','confirmed','declined','no_show','attended')),
  attendance_confirmed_at timestamptz, attendance_note text,
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  constraint ops_crew_identity check (user_id is not null or length(btrim(coalesce(external_name,''))) > 0)
);
create index if not exists ix_ops_crew_job  on public.ops_job_crew(job_id)  where is_deleted = false;
create index if not exists ix_ops_crew_user on public.ops_job_crew(user_id) where user_id is not null and is_deleted = false;
create unique index if not exists uq_ops_crew_job_user on public.ops_job_crew(job_id, user_id)
  where user_id is not null and is_deleted = false;

-- 3.5 معدّات المهمّة — حجز تشغيليّ + **مرجع** لحجز المخزون وتسليم العهدة
create table if not exists public.ops_job_equipment (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null references public.ops_jobs(id) on delete cascade,
  asset_id               uuid,               -- مرجع رخو إلى custody_inventory_assets
  asset_label            text,
  quantity               numeric not null default 1 check (quantity > 0),
  custody_reservation_id uuid,               -- مرجع custody_inventory_reservations (لا نسخة)
  custody_assignment_id  uuid,               -- مرجع تسليم العهدة custody_inventory_assignments
  needed_from            timestamptz, needed_to timestamptz,
  status                 text not null default 'requested'
                         check (status in ('requested','reserved','handed_over','returned','cancelled')),
  note                   text,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  is_deleted             boolean not null default false,
  constraint ops_equip_identity check (asset_id is not null or length(btrim(coalesce(asset_label,''))) > 0),
  constraint ops_equip_window   check (needed_to is null or needed_from is null or needed_to > needed_from)
);
comment on table public.ops_job_equipment is
  'حجز المعدّات على مستوى التشغيل. مصدر الحقيقة للمخزون والعهدة يبقى custody_inventory_* — هنا مرجع فقط ولا خصم مخزون.';
create index if not exists ix_ops_equip_job   on public.ops_job_equipment(job_id)   where is_deleted = false;
create index if not exists ix_ops_equip_asset on public.ops_job_equipment(asset_id) where asset_id is not null and is_deleted = false;

-- 3.6 التصاريح والموافقات
create table if not exists public.ops_job_permits (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.ops_jobs(id) on delete cascade,
  permit_type    text not null default 'other'
                 check (permit_type in ('municipality','police','property_owner','airspace_drone',
                                        'client_site','venue','other')),
  authority_name text, reference_no text,
  status         text not null default 'pending'
                 check (status in ('not_required','pending','submitted','approved','rejected','expired')),
  requested_at   date, issued_at date, expires_at date,
  document_url   text, note text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_ops_permit_job on public.ops_job_permits(job_id) where is_deleted = false;

-- 3.7 السفر
create table if not exists public.ops_job_travel (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.ops_jobs(id) on delete cascade,
  mode             text not null default 'car' check (mode in ('car','plane','bus','train','boat','other')),
  from_place       text, to_place text,
  depart_at        timestamptz, arrive_at timestamptz,
  booking_ref      text,
  traveller_user_id uuid references auth.users(id) on delete set null,
  traveller_name   text,
  status           text not null default 'planned' check (status in ('planned','booked','completed','cancelled')),
  note             text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false
);
create index if not exists ix_ops_travel_job on public.ops_job_travel(job_id) where is_deleted = false;

-- 3.8 السكن
create table if not exists public.ops_job_accommodation (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.ops_jobs(id) on delete cascade,
  hotel_name  text, city text,
  check_in    date, check_out date,
  rooms       int check (rooms is null or rooms > 0),
  booking_ref text, guest_note text,
  status      text not null default 'planned' check (status in ('planned','booked','completed','cancelled')),
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  constraint ops_acc_window check (check_out is null or check_in is null or check_out >= check_in)
);
create index if not exists ix_ops_acc_job on public.ops_job_accommodation(job_id) where is_deleted = false;

-- 3.9 إسناد المركبات للمهمّة
create table if not exists public.ops_job_vehicles (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.ops_jobs(id) on delete cascade,
  vehicle_id     uuid references public.ops_vehicles(id) on delete set null,
  vehicle_label  text,
  driver_user_id uuid references auth.users(id) on delete set null,
  driver_name    text,
  depart_at      timestamptz, return_at timestamptz,
  status         text not null default 'planned' check (status in ('planned','assigned','completed','cancelled')),
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_ops_jveh_job on public.ops_job_vehicles(job_id) where is_deleted = false;

-- 3.10 قائمة السلامة (HSE)
create table if not exists public.ops_job_hse (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.ops_jobs(id) on delete cascade,
  item_key    text not null,
  item_ar     text not null, item_en text,
  is_required boolean not null default true,
  status      text not null default 'pending' check (status in ('pending','ok','na','issue')),
  checked_by  uuid references auth.users(id) on delete set null,
  checked_at  timestamptz, note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create unique index if not exists uq_ops_hse_item on public.ops_job_hse(job_id, item_key) where is_deleted = false;

-- 3.11 الطقس — PLACEHOLDER يدويّ. لا اتصال خارجيّ إطلاقًا.
create table if not exists public.ops_job_weather (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.ops_jobs(id) on delete cascade,
  for_date   date not null,
  source     text not null default 'manual' check (source in ('manual','placeholder')),
  condition  text, temp_c numeric, wind_kph numeric,
  precip_pct numeric check (precip_pct is null or (precip_pct >= 0 and precip_pct <= 100)),
  note       text,
  entered_by uuid references auth.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  is_deleted boolean not null default false
);
comment on table public.ops_job_weather is
  'Placeholder الطقس: إدخال يدويّ فقط. لا استدعاء خدمة خارجية ولا مفتاح API ولا cron — القيد على source يمنع ادّعاء مصدر آليّ.';
create unique index if not exists uq_ops_weather_day on public.ops_job_weather(job_id, for_date) where is_deleted = false;

-- 3.12 بطاقات الذاكرة
create table if not exists public.ops_media_cards (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.ops_jobs(id) on delete cascade,
  card_label     text not null check (length(btrim(card_label)) between 1 and 80),
  card_type      text not null default 'sd' check (card_type in ('sd','microsd','cfexpress','cfast','ssd','other')),
  capacity_gb    numeric check (capacity_gb is null or capacity_gb > 0),
  holder_user_id uuid references auth.users(id) on delete set null,
  holder_name    text,
  status         text not null default 'assigned'
                 check (status in ('assigned','recording','full','offloaded','verified','formatted','lost')),
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create unique index if not exists uq_ops_card_label on public.ops_media_cards(job_id, card_label) where is_deleted = false;
create index if not exists ix_ops_card_job on public.ops_media_cards(job_id) where is_deleted = false;

-- 3.13 قائمة النسخ الاحتياطي: نسخة أولى · نسخة ثانية · نسخة NAS · تحقُّق
create table if not exists public.ops_media_backups (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.ops_jobs(id) on delete cascade,
  card_id      uuid references public.ops_media_cards(id) on delete cascade,
  primary_done boolean not null default false, primary_at timestamptz, primary_path text,
  second_done  boolean not null default false, second_at  timestamptz, second_path  text,
  nas_done     boolean not null default false, nas_at     timestamptz, nas_path     text,
  verified     boolean not null default false, verified_at timestamptz,
  verified_by  uuid references auth.users(id) on delete set null,
  verify_note  text,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- التحقّق ليس زرًّا: لا يُعلَّم قبل وجود نسختين فعليًّا.
  constraint ops_backup_verify_needs_two check (verified = false or (primary_done and second_done))
);
create unique index if not exists uq_ops_backup_card on public.ops_media_backups(card_id) where card_id is not null;
create unique index if not exists uq_ops_backup_job  on public.ops_media_backups(job_id)  where card_id is null;

-- 3.14 حالة الرفع/الاستيعاب
create table if not exists public.ops_ingest_jobs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.ops_jobs(id) on delete cascade,
  card_id     uuid references public.ops_media_cards(id) on delete set null,
  target      text not null default 'nas'
              check (target in ('nas','cloud','drive','editing_station','other')),
  status      text not null default 'not_started'
              check (status in ('not_started','uploading','uploaded','failed','verified')),
  started_at  timestamptz, finished_at timestamptz,
  total_gb    numeric check (total_gb is null or total_gb >= 0),
  note        text,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create index if not exists ix_ops_ingest_job on public.ops_ingest_jobs(job_id) where is_deleted = false;

-- 3.15 تسليم ما بعد الإنتاج
create table if not exists public.ops_post_handoff (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ops_jobs(id) on delete cascade,
  handed_to_user_id uuid references auth.users(id) on delete set null,
  handed_to_name    text,
  handed_by         uuid references auth.users(id) on delete set null,
  handed_at         timestamptz not null default now(),
  brief             text, brief_url text,
  expected_delivery date,
  status            text not null default 'pending'
                    check (status in ('pending','accepted','in_progress','returned','done')),
  accepted_at       timestamptz, done_at timestamptz,
  editor_note       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  is_deleted        boolean not null default false,
  constraint ops_handoff_target check (handed_to_user_id is not null or length(btrim(coalesce(handed_to_name,''))) > 0)
);
create index if not exists ix_ops_handoff_job  on public.ops_post_handoff(job_id) where is_deleted = false;
create index if not exists ix_ops_handoff_user on public.ops_post_handoff(handed_to_user_id)
  where handed_to_user_id is not null and is_deleted = false;

-- 3.16 التقرير اليوميّ
create table if not exists public.ops_daily_reports (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ops_jobs(id) on delete cascade,
  report_date       date not null,
  prepared_by       uuid not null references auth.users(id),
  call_time_actual  timestamptz, wrap_time_actual timestamptz,
  weather_note      text,
  shots_planned     int check (shots_planned is null or shots_planned >= 0),
  shots_done        int check (shots_done    is null or shots_done    >= 0),
  crew_present      int check (crew_present  is null or crew_present  >= 0),
  summary           text, issues text, next_day_plan text,
  status            text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  is_deleted        boolean not null default false
);
create unique index if not exists uq_ops_report_day
  on public.ops_daily_reports(job_id, report_date, prepared_by) where is_deleted = false;
create index if not exists ix_ops_report_job on public.ops_daily_reports(job_id) where is_deleted = false;

-- 3.17 الحوادث
create table if not exists public.ops_incidents (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.ops_jobs(id) on delete cascade,
  incident_type    text not null default 'other'
                   check (incident_type in ('injury','equipment_damage','equipment_loss','access_denied',
                                            'public_complaint','vehicle','weather','security','other')),
  severity         text not null default 'low' check (severity in ('low','medium','high','critical')),
  occurred_at      timestamptz not null default now(),
  description      text not null check (length(btrim(description)) between 3 and 4000),
  immediate_action text,
  reported_by      uuid references auth.users(id) on delete set null,
  status           text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  resolved_at      timestamptz, resolution text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false
);
create index if not exists ix_ops_inc_job on public.ops_incidents(job_id, status) where is_deleted = false;

-- 3.18 أسباب التأخير
create table if not exists public.ops_delays (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.ops_jobs(id) on delete cascade,
  delay_reason text not null default 'other'
               check (delay_reason in ('weather','permit','crew_late','equipment_failure','client',
                                       'location_access','traffic','technical','talent','other')),
  minutes_lost int not null default 0 check (minutes_lost >= 0),
  occurred_at  timestamptz not null default now(),
  note         text,
  recorded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists ix_ops_delay_job on public.ops_delays(job_id) where is_deleted = false;

-- 3.19 Call Sheet
create table if not exists public.ops_call_sheets (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.ops_jobs(id) on delete cascade,
  sheet_date              date not null,
  version                 int not null default 1 check (version > 0),
  general_call_time       timestamptz,
  location_id             uuid references public.ops_locations(id) on delete set null,
  weather_note            text,
  hospital_name           text, hospital_address text,
  emergency_contact_name  text, emergency_contact_phone text,
  parking_note            text, notes text,
  status                  text not null default 'draft' check (status in ('draft','published')),
  published_at            timestamptz, published_by uuid references auth.users(id) on delete set null,
  created_by              uuid references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  is_deleted              boolean not null default false
);
create unique index if not exists uq_ops_sheet_ver
  on public.ops_call_sheets(job_id, sheet_date, version) where is_deleted = false;

-- 3.20 التدقيق — سجلّ الموديول نفسه (لا يكتب في project_activity)
create table if not exists public.ops_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  job_id      uuid,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists ix_ops_audit_job   on public.ops_audit(job_id, at desc);
create index if not exists ix_ops_audit_actor on public.ops_audit(actor_id, at desc);

-- updated_at موحّد
create or replace function public.prodops_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

do $trg$
declare t text;
begin
  foreach t in array array['ops_locations','ops_vehicles','ops_jobs','ops_job_crew','ops_job_equipment',
    'ops_job_permits','ops_job_travel','ops_job_accommodation','ops_job_vehicles','ops_job_hse',
    'ops_media_cards','ops_media_backups','ops_ingest_jobs','ops_post_handoff','ops_daily_reports',
    'ops_incidents','ops_delays','ops_call_sheets'] loop
    execute format('drop trigger if exists trg_%s_touch on public.%I', t, t);
    execute format('create trigger trg_%s_touch before update on public.%I for each row execute function public.prodops_touch()', t, t);
  end loop;
end $trg$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) مُسنَدات الصفّ — رؤية المهمّة. لا واحد منها يعيد NULL.
--
--     ملاحظة: هذه دوالّ SECURITY DEFINER يملكها منفّذ الترحيلة، فهي تقرأ
--     الجداول بتجاوز RLS ولا تُحدث ارتدادًا (recursion) داخل سياسات نفس الجداول.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_is_crew(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (select 1 from public.ops_job_crew c
                    where c.job_id = p_job and c.user_id = auth.uid() and c.is_deleted = false)
  ), false);
$$;

create or replace function public.prodops_is_post_assignee(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (select 1 from public.ops_post_handoff h
                    where h.job_id = p_job and h.handed_to_user_id = auth.uid() and h.is_deleted = false)
  ), false);
$$;

-- من يقرأ المهمّة: المدير كلّ شيء؛ الموظّف مهامّه هو فقط. العميل أبدًا.
create or replace function public.prodops_can_read_job(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when auth.uid() is null or p_job is null then false
      when coalesce(public.prodops_can_manage(), false) then true
      when not coalesce(public.is_staff(), false) then false
      else coalesce(public.prodops_is_crew(p_job), false)
        or coalesce(public.prodops_is_post_assignee(p_job), false)
    end, false);
$$;

-- من يعدّل المهمّة نفسها: المدير وحده. إخفاء الزرّ ليس تصريحًا.
create or replace function public.prodops_can_edit_job(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (p_job is not null) and coalesce(public.prodops_can_manage(), false)
    and exists (select 1 from public.ops_jobs j where j.id = p_job and j.is_deleted = false),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) RLS — تفعيل على كلّ جدول، وسياسات **قراءة فقط**.
--     لا سياسة INSERT/UPDATE/DELETE على أيّ جدول: كلّ كتابة عبر RPC.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['ops_locations','ops_vehicles','ops_jobs','ops_job_crew','ops_job_equipment',
    'ops_job_permits','ops_job_travel','ops_job_accommodation','ops_job_vehicles','ops_job_hse',
    'ops_job_weather','ops_media_cards','ops_media_backups','ops_ingest_jobs','ops_post_handoff',
    'ops_daily_reports','ops_incidents','ops_delays','ops_call_sheets','ops_audit'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- سجلّات ومراجع عامّة داخل المركز: للموظّف المصرَّح بدخول المركز.
  foreach t in array array['ops_locations','ops_vehicles'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.prodops_can_view())',
                   t || '_read', t);
  end loop;

  -- المهمّة نفسها.
  drop policy if exists ops_jobs_read on public.ops_jobs;
  create policy ops_jobs_read on public.ops_jobs for select to authenticated
    using (public.prodops_can_read_job(id));

  -- الأبناء: نفس مُسنَد المهمّة الأمّ.
  foreach t in array array['ops_job_crew','ops_job_equipment','ops_job_permits','ops_job_travel',
    'ops_job_accommodation','ops_job_vehicles','ops_job_hse','ops_job_weather','ops_media_cards',
    'ops_media_backups','ops_ingest_jobs','ops_incidents','ops_delays','ops_call_sheets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.prodops_can_read_job(job_id))',
                   t || '_read', t);
  end loop;

  -- التقرير اليوميّ: المدير، أو كاتبه هو.
  drop policy if exists ops_daily_reports_read on public.ops_daily_reports;
  create policy ops_daily_reports_read on public.ops_daily_reports for select to authenticated
    using (public.prodops_can_manage() or prepared_by = auth.uid());

  -- تسليم ما بعد الإنتاج: المدير، أو المونتير المُسنَد إليه هو.
  drop policy if exists ops_post_handoff_read on public.ops_post_handoff;
  create policy ops_post_handoff_read on public.ops_post_handoff for select to authenticated
    using (public.prodops_can_manage() or handed_to_user_id = auth.uid());

  -- سجلّ التدقيق: الإدارة فقط.
  drop policy if exists ops_audit_read on public.ops_audit;
  create policy ops_audit_read on public.ops_audit for select to authenticated
    using (public.prodops_can_manage());
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) التدقيق + مساعدات داخلية (REVOKE في §9 — لا تُستدعى من الواجهة)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_log(
  p_action text, p_etype text, p_eid uuid, p_job uuid, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.ops_audit(actor_id, action, entity_type, entity_id, job_id, detail)
  values (auth.uid(), p_action, p_etype, p_eid, p_job, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ─── قيد entity_type على الإشعارات: شكل لا تعداد ──────────────────────────
-- ★ عيب مثبَت، لا احتياط ★ phase0_migration.sql:285 يحصر
--   notifications.entity_type في خمس قيم من عهد المشاريع
--   ('profile','company','quote_request','project','deliverable')، ولا ترحيلة
--   في المستودع توسّعه بعدها. وهذا الموديول يكتب 'ops_job' ⇒ القيد يرفع 23514
--   ⇒ المصيدة داخل prodops_notify تبتلعه ⇒ **الإشعار يُفقد بصمت** بينما تُكمل
--   العملية بنجاح ظاهريّ. هذا هو «النجاح المزوَّر» بعينه.
--   العلاج هو نفسه المعتمَد لـnotifications_type_check في 9C: قيد **شكل** لا
--   تعداد، فيكتب كلّ موديول مفرداته بلا تنسيق مع غيره ولا سباق على قيد واحد.
--   ⚠️ لا يُطبَّق إلّا إذا كانت كلّ الصفوف القائمة تحترم الشكل الجديد. غير ذلك:
--      إشعار صريح، والقيد يُترك كما هو — لا إسقاط ترحيلة ولا حذف بيانات.
do $notif_shape$
declare v_bad bigint := 0; c record;
begin
  if to_regclass('public.notifications') is null then
    raise notice 'OPS: جدول الإشعارات غير موجود — لا إشعارات داخل التطبيق لهذا الموديول.';
    return;
  end if;
  select count(*) into v_bad from public.notifications
   where entity_type is null or entity_type !~ '^[a-z][a-z0-9_]{2,40}$';
  if v_bad > 0 then
    raise notice 'OPS: % صفّ إشعار قائم لا يحترم شكل entity_type — القيد تُرك كما هو، وإشعارات التشغيل قد تُرفض بصمت. عالِج الصفوف ثمّ أعد التشغيل.', v_bad;
    return;
  end if;
  -- ⚠️ يُزال **كلّ** قيد CHECK يقيّد entity_type مهما كان اسمه، لا الاسم
  --    القانونيّ وحده. قيدٌ ثانٍ باسم منجرف (…_check1 مثلًا) كان سيبقى يرفض
  --    بصمت بينما يبدو القيد القانونيّ سليمًا — وهذا الاختباء بالضبط هو العطب.
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = to_regclass('public.notifications')
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%entity_type%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
    raise notice 'OPS: أُزيل قيد entity_type القديم (%).', c.conname;
  end loop;
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type is not null and entity_type ~ '^[a-z][a-z0-9_]{2,40}$');
end $notif_shape$;

-- إشعار معزول: قيد notifications.type منجرف تاريخيًّا، وفشل الإشعار
-- لا يجوز أن يُسقط عملية تشغيلية صحيحة.
-- ★ لكنّه لا يُبتلَع بصمت ★: الفشل يُكتب في سجلّ الموديول برمز الحالة، فلا
--   يعود «لم يصل الإشعار» سؤالًا بلا جواب.
create or replace function public.prodops_notify(p_user uuid, p_type text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ss text; v_msg text;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then
    perform public.prodops_log('notify_unavailable', 'ops_job', p_eid, p_eid,
      jsonb_build_object('type', p_type, 'reason', 'notify_function_missing'));
    return;
  end if;
  begin
    execute 'select public.notify($1,$2,$3,$4,$5,$6,$7)'
      using p_user, 'user', p_type, 'ops_job', p_eid, p_ar, p_en;
  exception when others then                            -- لا يُسقط المعاملة
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    begin
      perform public.prodops_log('notify_failed', 'ops_job', p_eid, p_eid,
        jsonb_build_object('type', p_type, 'sqlstate', v_ss, 'detail', left(coalesce(v_msg, ''), 200)));
    exception when others then null;                    -- التدقيق لا يُسقط شيئًا أيضًا
    end;
  end;
end $$;

-- اسم المشروع للعرض فقط — قراءة واحدة، مكتشَفة، ولا تلمس المنصّة.
-- اسم المشروع للعرض فقط — قراءة واحدة، مكتشَفة، ولا تلمس المنصّة.
-- ⚠️ اسم العمود يُكتشف من الكتالوج ولا يُخمَّن: تخمين اسم عمود في هذا المستودع
--    سبق أن أنتج 42703 وأسقط عملية كاملة. الترتيب: project_name ثمّ title ثمّ name.
create or replace function public.prodops_project_label(p_project uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text; v_col text;
begin
  if p_project is null or to_regclass('public.projects') is null then return null; end if;
  select c.column_name into v_col
    from information_schema.columns c
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

-- ════════════════════════════════════════════════════════════════════════════
-- §7) محرّك التعارضات
--     ثلاثة تعارضات داخلية: شخص محجوز مرّتين · جهاز محجوز مرّتين · تضارب
--     موقع/استوديو. ورابعٌ **خارجيّ مكتشَف**: حجوزات مخزون العهدة وحجوزات
--     طبقة التخطيط 4B — تُقرأ ولا تُكرَّر. غياب المصدر يُعلَن لا يُبتلع.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_conflicts_core(
  p_from timestamptz, p_to timestamptz, p_job uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'::jsonb; v_x jsonb;
        v_from timestamptz := coalesce(p_from, now() - interval '1 day');
        v_to   timestamptz := coalesce(p_to,   now() + interval '30 days');
begin
  if v_to <= v_from then v_to := v_from + interval '1 day'; end if;

  -- (1) شخص مُسنَد لمهمّتين متداخلتين زمنيًّا
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_x from (
    select jsonb_build_object(
      'kind','person_double_booked','severity','high',
      'ar','الشخص نفسه مُسنَد لمهمّتين متداخلتين',
      'subject_id', a.user_id,
      'job_a', ja.id, 'job_a_title', ja.title, 'job_a_code', ja.job_code,
      'job_b', jb.id, 'job_b_title', jb.title, 'job_b_code', jb.job_code,
      'overlap_from', greatest(ja.scheduled_start, jb.scheduled_start),
      'overlap_to',   least(ja.scheduled_end,   jb.scheduled_end)) as x
    from public.ops_job_crew a
    join public.ops_job_crew b
      on b.user_id = a.user_id and b.job_id <> a.job_id and b.is_deleted = false
    join public.ops_jobs ja on ja.id = a.job_id and ja.is_deleted = false
    join public.ops_jobs jb on jb.id = b.job_id and jb.is_deleted = false
    where a.is_deleted = false and a.user_id is not null
      and a.status not in ('declined','no_show') and b.status not in ('declined','no_show')
      and ja.status in ('scheduled','confirmed','in_progress')
      and jb.status in ('scheduled','confirmed','in_progress')
      and ja.id < jb.id
      and ja.scheduled_start is not null and ja.scheduled_end is not null
      and jb.scheduled_start is not null and jb.scheduled_end is not null
      and tstzrange(ja.scheduled_start, ja.scheduled_end) && tstzrange(jb.scheduled_start, jb.scheduled_end)
      and tstzrange(ja.scheduled_start, ja.scheduled_end) && tstzrange(v_from, v_to)
      and (p_job is null or ja.id = p_job or jb.id = p_job)
  ) s;
  v_out := v_out || v_x;

  -- (2) جهاز محجوز في مهمّتين متداخلتين (نافذة الحجز أو نافذة المهمّة)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_x from (
    select jsonb_build_object(
      'kind','equipment_double_reserved','severity','high',
      'ar','الجهاز نفسه محجوز في مهمّتين متداخلتين',
      'subject_id', e1.asset_id,
      'asset_label', coalesce(e1.asset_label, e2.asset_label),
      'job_a', j1.id, 'job_a_title', j1.title, 'job_a_code', j1.job_code,
      'job_b', j2.id, 'job_b_title', j2.title, 'job_b_code', j2.job_code,
      'overlap_from', greatest(coalesce(e1.needed_from, j1.scheduled_start), coalesce(e2.needed_from, j2.scheduled_start)),
      'overlap_to',   least(coalesce(e1.needed_to,   j1.scheduled_end),   coalesce(e2.needed_to,   j2.scheduled_end))) as x
    from public.ops_job_equipment e1
    join public.ops_job_equipment e2
      on e2.asset_id = e1.asset_id and e2.job_id <> e1.job_id and e2.is_deleted = false
    join public.ops_jobs j1 on j1.id = e1.job_id and j1.is_deleted = false
    join public.ops_jobs j2 on j2.id = e2.job_id and j2.is_deleted = false
    where e1.is_deleted = false and e1.asset_id is not null
      and e1.status in ('requested','reserved','handed_over')
      and e2.status in ('requested','reserved','handed_over')
      and j1.status in ('scheduled','confirmed','in_progress')
      and j2.status in ('scheduled','confirmed','in_progress')
      and j1.id < j2.id
      and coalesce(e1.needed_from, j1.scheduled_start) is not null
      and coalesce(e1.needed_to,   j1.scheduled_end)   is not null
      and coalesce(e2.needed_from, j2.scheduled_start) is not null
      and coalesce(e2.needed_to,   j2.scheduled_end)   is not null
      and tstzrange(coalesce(e1.needed_from, j1.scheduled_start), coalesce(e1.needed_to, j1.scheduled_end))
       && tstzrange(coalesce(e2.needed_from, j2.scheduled_start), coalesce(e2.needed_to, j2.scheduled_end))
      and tstzrange(coalesce(e1.needed_from, j1.scheduled_start), coalesce(e1.needed_to, j1.scheduled_end))
       && tstzrange(v_from, v_to)
      and (p_job is null or j1.id = p_job or j2.id = p_job)
  ) s;
  v_out := v_out || v_x;

  -- (3) تضارب موقع/استوديو
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_x from (
    select jsonb_build_object(
      'kind', case when coalesce(l.kind,'') = 'studio' then 'studio_clash' else 'location_clash' end,
      'severity','medium',
      'ar', case when coalesce(l.kind,'') = 'studio'
                 then 'الاستوديو نفسه محجوز لمهمّتين متداخلتين'
                 else 'الموقع نفسه محجوز لمهمّتين متداخلتين' end,
      'subject_id', ja.location_id, 'location_name', l.name,
      'job_a', ja.id, 'job_a_title', ja.title, 'job_a_code', ja.job_code,
      'job_b', jb.id, 'job_b_title', jb.title, 'job_b_code', jb.job_code,
      'overlap_from', greatest(ja.scheduled_start, jb.scheduled_start),
      'overlap_to',   least(ja.scheduled_end,   jb.scheduled_end)) as x
    from public.ops_jobs ja
    join public.ops_jobs jb
      on jb.location_id = ja.location_id and jb.id <> ja.id and jb.is_deleted = false
    left join public.ops_locations l on l.id = ja.location_id
    where ja.is_deleted = false and ja.location_id is not null
      and ja.status in ('scheduled','confirmed','in_progress')
      and jb.status in ('scheduled','confirmed','in_progress')
      and ja.id < jb.id
      and ja.scheduled_start is not null and ja.scheduled_end is not null
      and jb.scheduled_start is not null and jb.scheduled_end is not null
      and tstzrange(ja.scheduled_start, ja.scheduled_end) && tstzrange(jb.scheduled_start, jb.scheduled_end)
      and tstzrange(ja.scheduled_start, ja.scheduled_end) && tstzrange(v_from, v_to)
      and (p_job is null or ja.id = p_job or jb.id = p_job)
  ) s;
  v_out := v_out || v_x;

  return v_out;
end $$;

-- المسح الخارجيّ: يقرأ مصادر الحجز القائمة ولا ينشئ نسخة منها.
-- الإرجاع يفصل «غير متاح» عن «صفر تعارض» — لا يُقال «سليم» عن مصدر لم يُقرأ.
create or replace function public.prodops_external_conflicts(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_items jsonb := '[]'::jsonb; v_x jsonb;
        v_custody text := 'unavailable'; v_planning text := 'unavailable';
        v_from timestamptz := coalesce(p_from, now() - interval '1 day');
        v_to   timestamptz := coalesce(p_to,   now() + interval '30 days');
begin
  -- (أ) حجوزات مخزون العهدة (custody_inventory_reservations) — مصدر الحقيقة للمخزون
  if to_regclass('public.custody_inventory_reservations') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind','equipment_reserved_elsewhere','severity','medium',
          'ar','الجهاز محجوز في نظام مخزون الأصول ضمن نفس الفترة',
          'subject_id', e.asset_id, 'asset_label', e.asset_label,
          'job_a', j.id, 'job_a_title', j.title, 'job_a_code', j.job_code,
          'external_ref', r.id, 'external_source','custody_inventory_reservations',
          'overlap_from', greatest(coalesce(e.needed_from, j.scheduled_start), r.reserved_from),
          'overlap_to',   least(coalesce(e.needed_to,   j.scheduled_end),   r.reserved_to))), '[]'::jsonb)
        from public.ops_job_equipment e
        join public.ops_jobs j on j.id = e.job_id and j.is_deleted = false
        join public.custody_inventory_reservations r
          on r.asset_id = e.asset_id and r.status = 'active'
         and (e.custody_reservation_id is null or e.custody_reservation_id <> r.id)
        where e.is_deleted = false and e.asset_id is not null
          and e.status in ('requested','reserved','handed_over')
          and j.status in ('scheduled','confirmed','in_progress')
          and r.reserved_from is not null and r.reserved_to is not null
          and coalesce(e.needed_from, j.scheduled_start) is not null
          and coalesce(e.needed_to,   j.scheduled_end)   is not null
          and tstzrange(coalesce(e.needed_from, j.scheduled_start), coalesce(e.needed_to, j.scheduled_end))
           && tstzrange(r.reserved_from, r.reserved_to)
          and tstzrange(r.reserved_from, r.reserved_to) && tstzrange($1, $2)
      $q$ into v_x using v_from, v_to;
      v_items := v_items || coalesce(v_x, '[]'::jsonb);
      v_custody := 'ok';
    exception when others then v_custody := 'error';
    end;
  end if;

  -- (ب) حجوزات طبقة التخطيط 4B (resource_bookings عبر planning_resources)
  if to_regclass('public.resource_bookings') is not null
     and to_regclass('public.planning_resources') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
          'kind','planning_booking_overlap','severity','low',
          'ar','المورد محجوز في طبقة تخطيط المشاريع ضمن نفس الفترة',
          'subject_id', coalesce(pr.employee_user_id, pr.source_id),
          'asset_label', pr.display_name,
          'job_a', j.id, 'job_a_title', j.title, 'job_a_code', j.job_code,
          'external_ref', rb.id, 'external_source','resource_bookings',
          'overlap_from', greatest(j.scheduled_start, rb.starts_at),
          'overlap_to',   least(j.scheduled_end,   rb.ends_at))), '[]'::jsonb)
        from public.ops_jobs j
        join public.ops_job_crew c on c.job_id = j.id and c.is_deleted = false and c.user_id is not null
                                  and c.status not in ('declined','no_show')
        join public.planning_resources pr on pr.employee_user_id = c.user_id and pr.is_deleted = false
        join public.resource_bookings rb on rb.resource_id = pr.id and rb.is_deleted = false
                                        and rb.status in ('hold','pending_approval','confirmed','in_use')
        where j.is_deleted = false and j.status in ('scheduled','confirmed','in_progress')
          and j.scheduled_start is not null and j.scheduled_end is not null
          and tstzrange(j.scheduled_start, j.scheduled_end) && tstzrange(rb.starts_at, rb.ends_at)
          and tstzrange(rb.starts_at, rb.ends_at) && tstzrange($1, $2)
      $q$ into v_x using v_from, v_to;
      v_items := v_items || coalesce(v_x, '[]'::jsonb);
      v_planning := 'ok';
    exception when others then v_planning := 'error';
    end;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'sources', jsonb_build_object('custody_reservations', v_custody, 'planning_bookings', v_planning));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7B) منع الحجز المزدوج — **في القاعدة، لا في الواجهة**.
--
--   §7 يكشف ويُبلّغ. §7B يمنع. الفرق ليس تجميليًّا: تحذيرٌ في الشاشة يسقط
--   بأوّل استدعاء REST مباشر أو بأوّل ضغطة على «حفظ» رغم التحذير، فيخرج طاقمٌ
--   واحد إلى موقعين في الساعة نفسها. لذلك الفاصل هنا مُشغِّل (trigger) على
--   الجدول نفسه: يعمل مهما كان الطريق — RPC أو PostgREST أو psql.
--
--   ثلاثة تعارضات مانعة: الشخص · الجهاز · الموقع/الاستوديو.
--   نطاق المنع = نافذة مُلتزَمة فقط: مهمّة حالتها scheduled/confirmed/in_progress
--   ولها بداية ونهاية. المسوّدة (draft) لا تحجز أحدًا ولا تمنع أحدًا — وهذا
--   مقصود كي يبقى التخطيط المبدئيّ ممكنًا؛ الالتزام هو ما يُقفل.
--   رمز الخطأ 23P01 (exclusion_violation) كي تميّزه الطبقة الأعلى عن «ممنوع».
-- ════════════════════════════════════════════════════════════════════════════

-- الشخص: هل هو مُسنَد لمهمّة أخرى مُلتزَمة تتقاطع مع النافذة؟ يعيد رمزها أو NULL.
create or replace function public.prodops_person_clash(
  p_user uuid, p_job uuid, p_from timestamptz, p_to timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select j.job_code
    from public.ops_job_crew c
    join public.ops_jobs j on j.id = c.job_id and j.is_deleted = false
   where p_user is not null and p_job is not null and p_from is not null and p_to is not null
     and c.user_id = p_user and c.job_id <> p_job and c.is_deleted = false
     and c.status not in ('declined','no_show')
     and j.status in ('scheduled','confirmed','in_progress')
     and j.scheduled_start is not null and j.scheduled_end is not null
     and tstzrange(j.scheduled_start, j.scheduled_end) && tstzrange(p_from, p_to)
   order by j.scheduled_start
   limit 1;
$$;

-- الجهاز: نفس المنطق، ونافذة البند تسبق نافذة المهمّة إن وُجدت.
create or replace function public.prodops_asset_clash(
  p_asset uuid, p_job uuid, p_from timestamptz, p_to timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select j.job_code
    from public.ops_job_equipment e
    join public.ops_jobs j on j.id = e.job_id and j.is_deleted = false
   where p_asset is not null and p_job is not null and p_from is not null and p_to is not null
     and e.asset_id = p_asset and e.job_id <> p_job and e.is_deleted = false
     and e.status in ('requested','reserved','handed_over')
     and j.status in ('scheduled','confirmed','in_progress')
     and coalesce(e.needed_from, j.scheduled_start) is not null
     and coalesce(e.needed_to,   j.scheduled_end)   is not null
     and tstzrange(coalesce(e.needed_from, j.scheduled_start), coalesce(e.needed_to, j.scheduled_end))
      && tstzrange(p_from, p_to)
   order by j.scheduled_start
   limit 1;
$$;

-- الموقع/الاستوديو: مساحة واحدة لا تتحمّل تصويرين في اللحظة نفسها.
create or replace function public.prodops_location_clash(
  p_loc uuid, p_job uuid, p_from timestamptz, p_to timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select j.job_code
    from public.ops_jobs j
   where p_loc is not null and p_job is not null and p_from is not null and p_to is not null
     and j.location_id = p_loc and j.id <> p_job and j.is_deleted = false
     and j.status in ('scheduled','confirmed','in_progress')
     and j.scheduled_start is not null and j.scheduled_end is not null
     and tstzrange(j.scheduled_start, j.scheduled_end) && tstzrange(p_from, p_to)
   order by j.scheduled_start
   limit 1;
$$;

-- حارس الطاقم: يمنع إسناد شخص محجوز. النافذة تُقرأ من المهمّة الأمّ (لم تتغيّر هنا).
create or replace function public.prodops_guard_crew() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz; v_st text; v_code text;
begin
  if new.is_deleted then return new; end if;
  if new.user_id is null then return new; end if;
  -- ⚠️ OLD غير مُسنَد في مُشغِّل INSERT، ولمسه هناك يرفع خطأً يُسقط كلّ إدراج.
  --    لذلك الشرط **متداخل**: فحص نوع العملية أوّلًا في IF مستقلّة، ثمّ لمس OLD
  --    داخلها. دمجهما في تعبير AND واحد غير آمن لأنّ SQL لا يضمن ترتيب التقييم.
  if tg_op = 'UPDATE' then
    -- تعديل لا يمسّ الحجز (تغيير ملاحظة مثلًا) لا يُعاد فحصه.
    if old.is_deleted = false
       and new.user_id is not distinct from old.user_id
       and new.job_id  is not distinct from old.job_id
       and new.status  is not distinct from old.status then
      return new;
    end if;
  end if;
  if new.status in ('declined','no_show') then return new; end if;

  select j.scheduled_start, j.scheduled_end, j.status into v_from, v_to, v_st
    from public.ops_jobs j where j.id = new.job_id and j.is_deleted = false;
  if v_st is null or v_st not in ('scheduled','confirmed','in_progress') then return new; end if;
  if v_from is null or v_to is null then return new; end if;

  v_code := public.prodops_person_clash(new.user_id, new.job_id, v_from, v_to);
  if v_code is not null then
    raise exception 'ops_double_booking: الشخص نفسه محجوز في المهمّة % خلال نفس الفترة. الحجز المزدوج ممنوع.', v_code
      using errcode = '23P01', hint = 'person:' || v_code;
  end if;
  return new;
end $$;

-- حارس المعدّات: يمنع حجز جهاز محجوز.
create or replace function public.prodops_guard_equipment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz; v_st text; v_code text;
begin
  if new.is_deleted then return new; end if;
  if new.asset_id is null then return new; end if;
  -- ⚠️ نفس السبب: OLD لا يُلمَس إلّا داخل فرع UPDATE (انظر prodops_guard_crew).
  if tg_op = 'UPDATE' then
    if old.is_deleted = false
       and new.asset_id    is not distinct from old.asset_id
       and new.job_id      is not distinct from old.job_id
       and new.status      is not distinct from old.status
       and new.needed_from is not distinct from old.needed_from
       and new.needed_to   is not distinct from old.needed_to then
      return new;
    end if;
  end if;
  if new.status not in ('requested','reserved','handed_over') then return new; end if;

  select j.scheduled_start, j.scheduled_end, j.status into v_from, v_to, v_st
    from public.ops_jobs j where j.id = new.job_id and j.is_deleted = false;
  if v_st is null or v_st not in ('scheduled','confirmed','in_progress') then return new; end if;
  v_from := coalesce(new.needed_from, v_from);
  v_to   := coalesce(new.needed_to,   v_to);
  if v_from is null or v_to is null then return new; end if;

  v_code := public.prodops_asset_clash(new.asset_id, new.job_id, v_from, v_to);
  if v_code is not null then
    raise exception 'ops_double_booking: الجهاز نفسه محجوز في المهمّة % خلال نفس الفترة. الحجز المزدوج ممنوع.', v_code
      using errcode = '23P01', hint = 'equipment:' || v_code;
  end if;
  return new;
end $$;

-- حارس المهمّة: نقل الوقت أو الموقع أو الالتزام بالحالة يُعيد فحص **كلّ** ما حُجز
-- تحتها. بدون هذا يُلتفّ على الحارسَين أعلاه: تُنشأ مهمّتان بأوقات متباعدة ثمّ
-- تُسحب إحداهما فوق الأخرى فيقع الازدواج بلا أيّ فحص.
create or replace function public.prodops_guard_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; r record;
begin
  if new.is_deleted then return new; end if;
  -- ⚠️ نفس السبب: OLD لا يُلمَس إلّا داخل فرع UPDATE (انظر prodops_guard_crew).
  if tg_op = 'UPDATE' then
    if new.scheduled_start is not distinct from old.scheduled_start
       and new.scheduled_end   is not distinct from old.scheduled_end
       and new.location_id     is not distinct from old.location_id
       and new.status          is not distinct from old.status
       and new.is_deleted      is not distinct from old.is_deleted then
      return new;
    end if;
  end if;
  if new.status not in ('scheduled','confirmed','in_progress') then return new; end if;
  if new.scheduled_start is null or new.scheduled_end is null then return new; end if;

  if new.location_id is not null then
    v_code := public.prodops_location_clash(new.location_id, new.id, new.scheduled_start, new.scheduled_end);
    if v_code is not null then
      raise exception 'ops_double_booking: الموقع/الاستوديو محجوز للمهمّة % خلال نفس الفترة. الحجز المزدوج ممنوع.', v_code
        using errcode = '23P01', hint = 'location:' || v_code;
    end if;
  end if;

  for r in select c.user_id from public.ops_job_crew c
            where c.job_id = new.id and c.is_deleted = false and c.user_id is not null
              and c.status not in ('declined','no_show') loop
    v_code := public.prodops_person_clash(r.user_id, new.id, new.scheduled_start, new.scheduled_end);
    if v_code is not null then
      raise exception 'ops_double_booking: أحد أفراد الطاقم محجوز في المهمّة % خلال الفترة الجديدة. الحجز المزدوج ممنوع.', v_code
        using errcode = '23P01', hint = 'person:' || v_code;
    end if;
  end loop;

  for r in select e.asset_id, e.needed_from, e.needed_to from public.ops_job_equipment e
            where e.job_id = new.id and e.is_deleted = false and e.asset_id is not null
              and e.status in ('requested','reserved','handed_over') loop
    v_code := public.prodops_asset_clash(r.asset_id, new.id,
                coalesce(r.needed_from, new.scheduled_start), coalesce(r.needed_to, new.scheduled_end));
    if v_code is not null then
      raise exception 'ops_double_booking: أحد الأجهزة محجوز في المهمّة % خلال الفترة الجديدة. الحجز المزدوج ممنوع.', v_code
        using errcode = '23P01', hint = 'equipment:' || v_code;
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_ops_crew_no_double_booking  on public.ops_job_crew;
create trigger trg_ops_crew_no_double_booking  before insert or update on public.ops_job_crew
  for each row execute function public.prodops_guard_crew();

drop trigger if exists trg_ops_equip_no_double_booking on public.ops_job_equipment;
create trigger trg_ops_equip_no_double_booking before insert or update on public.ops_job_equipment
  for each row execute function public.prodops_guard_equipment();

drop trigger if exists trg_ops_job_no_double_booking   on public.ops_jobs;
create trigger trg_ops_job_no_double_booking   before insert or update on public.ops_jobs
  for each row execute function public.prodops_guard_job();

-- ════════════════════════════════════════════════════════════════════════════
-- §8) درجة الجاهزية — **مشتقّة بالكامل**. لا عمود محفوظ يمكن أن ينحرف.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_readiness_core(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j record; v jsonb := '[]'::jsonb; v_req int := 0; v_ok int := 0;
        n_crew int; n_crew_unconf int; n_equip int; n_equip_open int;
        n_permit_bad int; n_permit int; n_hse_req int; n_hse_bad int;
        n_sheet int; n_inc int; n_travel int;
begin
  select * into j from public.ops_jobs where id = p_job and is_deleted = false;
  if j.id is null then
    return jsonb_build_object('ok', false, 'score', 0, 'checks', '[]'::jsonb, 'reason','job_not_found');
  end if;

  select count(*) filter (where true),
         count(*) filter (where status not in ('confirmed','attended'))
    into n_crew, n_crew_unconf
    from public.ops_job_crew where job_id = p_job and is_deleted = false and status <> 'declined';

  select count(*) filter (where true),
         count(*) filter (where status in ('requested','cancelled'))
    into n_equip, n_equip_open
    from public.ops_job_equipment where job_id = p_job and is_deleted = false;

  select count(*), count(*) filter (where status in ('pending','submitted','rejected','expired'))
    into n_permit, n_permit_bad
    from public.ops_job_permits where job_id = p_job and is_deleted = false;

  select count(*) filter (where is_required),
         count(*) filter (where is_required and status not in ('ok','na'))
    into n_hse_req, n_hse_bad
    from public.ops_job_hse where job_id = p_job and is_deleted = false;

  select count(*) into n_sheet from public.ops_call_sheets
   where job_id = p_job and is_deleted = false and status = 'published';

  select count(*) into n_inc from public.ops_incidents
   where job_id = p_job and is_deleted = false and severity in ('high','critical')
     and status in ('open','investigating');

  select count(*) into n_travel from public.ops_job_travel
   where job_id = p_job and is_deleted = false and status <> 'cancelled';

  -- كلّ فحص: (مفتاح، نصّ عربيّ، مطلوب؟، ناجح؟)
  v := v || jsonb_build_array(
    jsonb_build_object('key','schedule',  'ar','وقت التنفيذ محدَّد',        'required', true,
      'ok', (j.scheduled_start is not null and j.scheduled_end is not null)),
    jsonb_build_object('key','location',  'ar','الموقع محدَّد',             'required', true,
      'ok', (j.location_id is not null or length(btrim(coalesce(j.location_note,''))) > 0)),
    jsonb_build_object('key','crew',      'ar','الطاقم مُسنَد',             'required', true, 'ok', (n_crew > 0)),
    jsonb_build_object('key','crew_conf', 'ar','الطاقم أكّد الحضور',        'required', true,
      'ok', (n_crew > 0 and n_crew_unconf = 0)),
    jsonb_build_object('key','equipment', 'ar','المعدّات مخطَّطة',           'required', true, 'ok', (n_equip > 0)),
    jsonb_build_object('key','equip_res', 'ar','المعدّات محجوزة أو مُسلَّمة', 'required', true,
      'ok', (n_equip > 0 and n_equip_open = 0)),
    jsonb_build_object('key','permits',   'ar','التصاريح مكتملة',           'required', j.permit_required,
      'ok', (case when j.permit_required then (n_permit > 0 and n_permit_bad = 0) else (n_permit_bad = 0) end)),
    jsonb_build_object('key','hse',       'ar','قائمة السلامة مغلقة',        'required', true,
      'ok', (n_hse_req > 0 and n_hse_bad = 0)),
    jsonb_build_object('key','call_sheet','ar','Call Sheet منشور',          'required', false, 'ok', (n_sheet > 0)),
    jsonb_build_object('key','incidents', 'ar','لا حادث حرج مفتوح',          'required', true, 'ok', (n_inc = 0)),
    jsonb_build_object('key','travel',    'ar','السفر مرتَّب',               'required', j.travel_required,
      'ok', (case when j.travel_required then (n_travel > 0) else true end))
  );

  select count(*) filter (where (e->>'required')::boolean),
         count(*) filter (where (e->>'required')::boolean and (e->>'ok')::boolean)
    into v_req, v_ok
    from jsonb_array_elements(v) e;

  return jsonb_build_object(
    'ok', true,
    'job_id', p_job,
    'score', case when v_req = 0 then 0 else floor((v_ok::numeric * 100) / v_req)::int end,
    'passed', v_ok, 'required', v_req,
    'checks', v);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) دوالّ القراءة
--     ★ prodops_access() هي **مِجَسّ الكشف**: تنجح لأيّ جلسة (بما فيها العميل)
--       وتعيد قدرات كلّها false. بهذا تفرّق الواجهة بين «الترحيلة غير مطبَّقة»
--       (PGRST202) و«ممنوع» — ولا تقول لمستخدمٍ ممنوعٍ إنّ القاعدة ناقصة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'authenticated', false, 'can_view', false, 'can_manage', false,
      'is_crew', false, 'is_post', false, 'is_client', false, 'user_id', null,
      'message','سجّل الدخول للوصول إلى مركز التشغيل.');
  end if;
  return jsonb_build_object(
    'ok', true, 'authenticated', true,
    'can_view',   coalesce(public.prodops_can_view(), false),
    'can_manage', coalesce(public.prodops_can_manage(), false),
    'is_client',  coalesce(public.prodops_is_client(), false),
    'is_crew',    coalesce((select exists (select 1 from public.ops_job_crew c
                             where c.user_id = v_uid and c.is_deleted = false)), false),
    'is_post',    coalesce((select exists (select 1 from public.ops_post_handoff h
                             where h.handed_to_user_id = v_uid and h.is_deleted = false)), false),
    'user_id', v_uid,
    'message', case when coalesce(public.prodops_can_view(), false)
                    then null else 'مركز التشغيل مخصّص لفريق العمل الداخليّ.' end);
end $$;

-- مجموعة المهامّ المرئية للجلسة (المدير: الكلّ · الموظّف: مهامّه هو).
create or replace function public.prodops_visible_jobs()
returns table (job_id uuid) language sql stable security definer set search_path = public as $$
  select j.id from public.ops_jobs j
   where j.is_deleted = false
     and (coalesce(public.prodops_can_manage(), false)
       or (coalesce(public.is_staff(), false) and (
            exists (select 1 from public.ops_job_crew c
                     where c.job_id = j.id and c.user_id = auth.uid() and c.is_deleted = false)
         or exists (select 1 from public.ops_post_handoff h
                     where h.job_id = j.id and h.handed_to_user_id = auth.uid() and h.is_deleted = false))));
$$;

create or replace function public.prodops_jobs_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_limit int; v_status text; v_type text; v_q text;
        v_from date; v_to date;
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;
  v_limit  := least(greatest(coalesce((p_filters->>'limit')::int, 100), 1), 500);
  v_status := nullif(btrim(coalesce(p_filters->>'status','')), '');
  v_type   := nullif(btrim(coalesce(p_filters->>'job_type','')), '');
  v_q      := nullif(btrim(coalesce(p_filters->>'q','')), '');
  v_from   := nullif(btrim(coalesce(p_filters->>'from','')), '')::date;
  v_to     := nullif(btrim(coalesce(p_filters->>'to','')), '')::date;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', j.id, 'job_code', j.job_code, 'title', j.title, 'job_type', j.job_type,
      'status', j.status, 'priority', j.priority,
      'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'location_id', j.location_id, 'location_name', l.name, 'location_note', j.location_note,
      'project_id', j.project_id, 'project_name', public.prodops_project_label(j.project_id),
      'client_label', j.client_label,
      'crew_count',  (select count(*) from public.ops_job_crew  c where c.job_id = j.id and c.is_deleted = false),
      'equip_count', (select count(*) from public.ops_job_equipment e where e.job_id = j.id and e.is_deleted = false),
      'sort_key', coalesce(to_char(j.scheduled_start, 'YYYY-MM-DD HH24:MI'), '9999') || j.job_code) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    left join public.ops_locations l on l.id = j.location_id
    where (v_status is null or j.status = v_status)
      and (v_type   is null or j.job_type = v_type)
      and (v_q      is null or j.title ilike '%' || v_q || '%' or j.job_code ilike '%' || v_q || '%')
      and (v_from   is null or j.scheduled_start is null or j.scheduled_start >= v_from::timestamptz)
      and (v_to     is null or j.scheduled_start is null or j.scheduled_start <  (v_to + 1)::timestamptz)
    -- الترتيب قبل القصّ: LIMIT بلا ORDER BY يقتطع صفوفًا عشوائية، فتختفي مهامّ
    -- قريبة ويظهر بدلها ما لا معنى لترتيبه.
    order by j.scheduled_start nulls last, j.job_code
    limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'can_manage', coalesce(public.prodops_can_manage(), false));
end $$;

create or replace function public.prodops_job_detail(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j record; v_manage boolean := coalesce(public.prodops_can_manage(), false);
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_read_job(p_job), false) then raise exception 'not authorized'; end if;
  select * into j from public.ops_jobs where id = p_job and is_deleted = false;
  if j.id is null then return jsonb_build_object('ok', false, 'reason','job_not_found'); end if;

  return jsonb_build_object(
    'ok', true, 'can_manage', v_manage, 'user_id', auth.uid(),
    'job', jsonb_build_object(
      'id', j.id, 'job_code', j.job_code, 'title', j.title, 'job_type', j.job_type,
      'status', j.status, 'priority', j.priority, 'timezone', j.timezone,
      'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'actual_start', j.actual_start, 'actual_end', j.actual_end,
      'location_id', j.location_id, 'location_note', j.location_note,
      'permit_required', j.permit_required, 'travel_required', j.travel_required,
      'description', j.description,
      -- الملاحظة الداخلية للإدارة وحدها؛ الطاقم لا يقرؤها.
      'internal_notes', case when v_manage then j.internal_notes else null end,
      'project_id', j.project_id, 'project_name', public.prodops_project_label(j.project_id),
      'client_label', j.client_label, 'owner_user_id', j.owner_user_id, 'version', j.version),
    'location', (select to_jsonb(l) - 'created_by' from public.ops_locations l where l.id = j.location_id),
    -- ملاحظات الإدارة عن الفرد لا تُعرض للطاقم.
    'crew', (select coalesce(jsonb_agg(
                 (to_jsonb(c) - (case when v_manage then array[]::text[] else array['notes'] end))
                 order by c.created_at), '[]'::jsonb)
               from public.ops_job_crew c where c.job_id = p_job and c.is_deleted = false),
    'equipment', (select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
               from public.ops_job_equipment e where e.job_id = p_job and e.is_deleted = false),
    'permits', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
               from public.ops_job_permits p where p.job_id = p_job and p.is_deleted = false),
    'travel', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
               from public.ops_job_travel t where t.job_id = p_job and t.is_deleted = false),
    'accommodation', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
               from public.ops_job_accommodation a where a.job_id = p_job and a.is_deleted = false),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at), '[]'::jsonb)
               from public.ops_job_vehicles v where v.job_id = p_job and v.is_deleted = false),
    'hse', (select coalesce(jsonb_agg(to_jsonb(h) order by h.item_key), '[]'::jsonb)
               from public.ops_job_hse h where h.job_id = p_job and h.is_deleted = false),
    'weather', (select coalesce(jsonb_agg(to_jsonb(w) order by w.for_date), '[]'::jsonb)
               from public.ops_job_weather w where w.job_id = p_job and w.is_deleted = false),
    'media_cards', (select coalesce(jsonb_agg(to_jsonb(m) order by m.card_label), '[]'::jsonb)
               from public.ops_media_cards m where m.job_id = p_job and m.is_deleted = false),
    'backups', (select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]'::jsonb)
               from public.ops_media_backups b where b.job_id = p_job),
    'ingest', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
               from public.ops_ingest_jobs i where i.job_id = p_job and i.is_deleted = false),
    -- المونتير يرى تسليمه هو فقط؛ المدير يرى الكلّ.
    'post_handoff', (select coalesce(jsonb_agg(to_jsonb(h) order by h.handed_at desc), '[]'::jsonb)
               from public.ops_post_handoff h where h.job_id = p_job and h.is_deleted = false
                and (v_manage or h.handed_to_user_id = auth.uid())),
    -- التقرير اليوميّ: المدير يرى الكلّ، والفرد تقريره هو.
    'daily_reports', (select coalesce(jsonb_agg(to_jsonb(r) order by r.report_date desc), '[]'::jsonb)
               from public.ops_daily_reports r where r.job_id = p_job and r.is_deleted = false
                and (v_manage or r.prepared_by = auth.uid())),
    'incidents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc), '[]'::jsonb)
               from public.ops_incidents x where x.job_id = p_job and x.is_deleted = false),
    'delays', (select coalesce(jsonb_agg(to_jsonb(d) order by d.occurred_at desc), '[]'::jsonb)
               from public.ops_delays d where d.job_id = p_job and d.is_deleted = false),
    'call_sheets', (select coalesce(jsonb_agg(to_jsonb(cs) order by cs.sheet_date desc, cs.version desc), '[]'::jsonb)
               from public.ops_call_sheets cs where cs.job_id = p_job and cs.is_deleted = false),
    'readiness', public.prodops_readiness_core(p_job),
    'conflicts', public.prodops_conflicts_core(
                   coalesce(j.scheduled_start, now()) - interval '1 day',
                   coalesce(j.scheduled_end,   now()) + interval '1 day', p_job));
end $$;

create or replace function public.prodops_readiness(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.prodops_can_read_job(p_job), false) then raise exception 'not authorized'; end if;
  return public.prodops_readiness_core(p_job);
end $$;

-- مهامّي — العرض الميدانيّ للجوّال. مقيّد بـauth.uid() لا بالفلاتر.
create or replace function public.prodops_my_assignments(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_days int; v_rows jsonb; v_post jsonb;
begin
  if v_uid is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;
  v_days := least(greatest(coalesce((p_filters->>'days')::int, 14), 1), 120);

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'job_id', j.id, 'job_code', j.job_code, 'title', j.title, 'job_type', j.job_type,
      'status', j.status, 'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'location_name', l.name, 'location_note', j.location_note,
      'address', l.address, 'map_url', l.map_url,
      'contact_name', l.contact_name, 'contact_phone', l.contact_phone,
      'crew_id', c.id, 'crew_role', c.crew_role, 'call_time', c.call_time, 'wrap_time', c.wrap_time,
      'attendance_status', c.status, 'attendance_confirmed_at', c.attendance_confirmed_at,
      'my_report_id', (select r.id from public.ops_daily_reports r
                        where r.job_id = j.id and r.prepared_by = v_uid and r.is_deleted = false
                        order by r.report_date desc limit 1),
      'sort_key', coalesce(to_char(coalesce(c.call_time, j.scheduled_start), 'YYYY-MM-DD HH24:MI'), '9999')) as x
    from public.ops_job_crew c
    join public.ops_jobs j on j.id = c.job_id and j.is_deleted = false
    left join public.ops_locations l on l.id = j.location_id
    where c.user_id = v_uid and c.is_deleted = false
      and j.status <> 'cancelled'
      and (j.scheduled_start is null
        or j.scheduled_start between (now() - interval '2 days') and (now() + (v_days || ' days')::interval))
  ) s;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_post from (
    select jsonb_build_object(
      'handoff_id', h.id, 'job_id', j.id, 'job_code', j.job_code, 'title', j.title,
      'status', h.status, 'brief', h.brief, 'brief_url', h.brief_url,
      'expected_delivery', h.expected_delivery, 'handed_at', h.handed_at,
      'editor_note', h.editor_note,
      'sort_key', coalesce(to_char(h.expected_delivery, 'YYYY-MM-DD'), '9999')) as x
    from public.ops_post_handoff h
    join public.ops_jobs j on j.id = h.job_id and j.is_deleted = false
    where h.handed_to_user_id = v_uid and h.is_deleted = false
  ) s;

  return jsonb_build_object('ok', true, 'user_id', v_uid, 'assignments', v_rows, 'post_work', v_post);
end $$;

create or replace function public.prodops_calendar(
  p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, current_date); v_to date; v_rows jsonb;
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;
  v_to := coalesce(p_to, v_from + 30);
  if v_to < v_from then v_to := v_from; end if;
  if v_to > v_from + 366 then v_to := v_from + 366; end if;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', j.id, 'job_code', j.job_code, 'title', j.title, 'job_type', j.job_type,
      'status', j.status, 'priority', j.priority,
      'day', to_char(j.scheduled_start, 'YYYY-MM-DD'),
      'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'location_name', l.name,
      'sort_key', to_char(j.scheduled_start, 'YYYY-MM-DD HH24:MI')) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    left join public.ops_locations l on l.id = j.location_id
    where j.scheduled_start is not null
      and j.scheduled_start >= v_from::timestamptz
      and j.scheduled_start <  (v_to + 1)::timestamptz
      and (coalesce(nullif(p_filters->>'include_cancelled',''),'false') = 'true' or j.status <> 'cancelled')
  ) s;
  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to, 'days', v_rows);
end $$;

create or replace function public.prodops_conflicts(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz; v_int jsonb; v_ext jsonb;
        v_ext_items jsonb; v_ext_src jsonb;
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;
  v_from := coalesce(nullif(btrim(coalesce(p_filters->>'from','')),'')::timestamptz, now() - interval '1 day');
  v_to   := coalesce(nullif(btrim(coalesce(p_filters->>'to','')),  '')::timestamptz, now() + interval '30 days');
  v_int  := public.prodops_conflicts_core(v_from, v_to, nullif(btrim(coalesce(p_filters->>'job_id','')),'')::uuid);
  v_ext  := public.prodops_external_conflicts(v_from, v_to);

  -- غير المدير لا يرى تعارضات مهامّ ليست له.
  if not coalesce(public.prodops_can_manage(), false) then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_int
      from jsonb_array_elements(v_int) e
     where coalesce(public.prodops_can_read_job(nullif(e->>'job_a','')::uuid), false)
        or coalesce(public.prodops_can_read_job(nullif(e->>'job_b','')::uuid), false);
    -- حالة المصادر تُحفظ كما هي: تضييق النطاق لا يجعل مصدرًا لم يُقرأ «سليمًا».
    v_ext_src := coalesce(v_ext->'sources', '{}'::jsonb);
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_ext_items
      from jsonb_array_elements(coalesce(v_ext->'items','[]'::jsonb)) e
     where coalesce(public.prodops_can_read_job(nullif(e->>'job_a','')::uuid), false);
    v_ext := jsonb_build_object('items', v_ext_items, 'sources', v_ext_src);
  end if;

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to,
    'internal', v_int, 'external', v_ext,
    'total', jsonb_array_length(v_int) + jsonb_array_length(coalesce(v_ext->'items','[]'::jsonb)));
end $$;

-- Call Sheet مركَّب: الورقة + الطاقم + الموقع + السلامة + الطقس. لا نسخ بيانات.
create or replace function public.prodops_call_sheet(p_job uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
-- ⚠️ cs مُصرَّحة %rowtype لا record: to_jsonb() على متغيّر record مجهول النوع
--    تفشل بـ"could not determine polymorphic type". النوع الصريح يحسمها.
declare j record; cs public.ops_call_sheets%rowtype;
begin
  if not coalesce(public.prodops_can_read_job(p_job), false) then raise exception 'not authorized'; end if;
  select * into j from public.ops_jobs where id = p_job and is_deleted = false;
  if j.id is null then return jsonb_build_object('ok', false, 'reason','job_not_found'); end if;

  select * into cs from public.ops_call_sheets
   where job_id = p_job and is_deleted = false
     and (p_date is null or sheet_date = p_date)
   order by sheet_date desc, version desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'sheet', case when cs.id is null then null else to_jsonb(cs) end,
    'job', jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'job_type', j.job_type, 'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'client_label', j.client_label, 'project_name', public.prodops_project_label(j.project_id)),
    'location', (select to_jsonb(l) - 'created_by'
                   from public.ops_locations l where l.id = coalesce(cs.location_id, j.location_id)),
    'crew', (select coalesce(jsonb_agg(jsonb_build_object(
                'crew_role', c.crew_role, 'user_id', c.user_id, 'name', c.external_name,
                'phone', c.external_phone, 'call_time', c.call_time, 'wrap_time', c.wrap_time,
                'status', c.status) order by c.call_time nulls last), '[]'::jsonb)
               from public.ops_job_crew c where c.job_id = p_job and c.is_deleted = false
                 and c.status <> 'declined'),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
               from public.ops_job_vehicles v where v.job_id = p_job and v.is_deleted = false),
    'hse', (select coalesce(jsonb_agg(jsonb_build_object('item_ar', h.item_ar, 'status', h.status,
                'is_required', h.is_required) order by h.item_key), '[]'::jsonb)
               from public.ops_job_hse h where h.job_id = p_job and h.is_deleted = false),
    'weather', (select to_jsonb(w) from public.ops_job_weather w
                 where w.job_id = p_job and w.is_deleted = false
                   and (p_date is null or w.for_date = p_date)
                 order by w.for_date desc limit 1),
    'weather_note','مصدر الطقس إدخال يدويّ داخل النظام — لا خدمة خارجية.');
end $$;

-- مراجع الواجهة: المواقع، المركبات، قالب السلامة، ومرشّحو الطاقم (للمدير فقط).
create or replace function public.prodops_lookups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_people jsonb := '[]'::jsonb; v_prof jsonb := '[]'::jsonb; v_assets jsonb := '[]'::jsonb;
        v_projects jsonb := '[]'::jsonb;
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;

  if coalesce(public.prodops_can_manage(), false) then
    -- مرشّحو الطاقم من ملفّ الموظّفين إن كان موجودًا، وإلّا من الملفّات الشخصية للموظّفين.
    if to_regclass('public.hr_employee_profiles') is not null then
      begin
        execute $q$select coalesce(jsonb_agg(jsonb_build_object(
                     'user_id', e.user_id, 'name', e.full_name, 'job_title', e.job_title)
                     order by e.full_name), '[]'::jsonb)
                   from public.hr_employee_profiles e
                  where e.is_deleted = false and e.employment_status = 'active' and e.user_id is not null$q$
          into v_people;
      exception when others then v_people := '[]'::jsonb; end;
    end if;
    if jsonb_array_length(v_people) = 0 then
      begin
        execute $q$select coalesce(jsonb_agg(jsonb_build_object(
                     'user_id', p.id, 'name', coalesce(p.full_name, p.email), 'job_title', p.staff_role)
                     order by coalesce(p.full_name, p.email)), '[]'::jsonb)
                   from public.profiles p
                  where p.account_status = 'active' and p.staff_role is not null$q$
          into v_people;
      exception when others then v_people := '[]'::jsonb; end;
    end if;
    if to_regclass('public.professions') is not null then
      begin
        execute $q$select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'key', pr.key,
                     'name_ar', pr.name_ar) order by pr.sort_order), '[]'::jsonb)
                   from public.professions pr where pr.is_active$q$ into v_prof;
      exception when others then v_prof := '[]'::jsonb; end;
    end if;
    if to_regclass('public.custody_inventory_assets') is not null then
      begin
        execute $q$select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.asset_code,
                     'name', a.asset_name, 'availability', a.availability_status)
                     order by a.asset_name), '[]'::jsonb)
                   from public.custody_inventory_assets a where a.is_deleted = false$q$ into v_assets;
      exception when others then v_assets := '[]'::jsonb; end;
    end if;
  end if;

  -- المشاريع للربط الاختياريّ — **قراءة معرّف واسم فقط**، وهو حدّ التماسّ
  -- المسموح به مع المنصّة المجمَّدة. اسم العمود يُكتشف ولا يُخمَّن (تخمينه سبق
  -- أن أنتج 42703)، والقراءة معزولة باستثناء فيبقى الربط اختياريًّا لا شرطًا.
  if coalesce(public.prodops_can_manage(), false) and to_regclass('public.projects') is not null then
    declare v_col text;
    begin
      select c.column_name into v_col from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'projects'
         and c.column_name in ('project_name','title','name')
       order by case c.column_name when 'project_name' then 1 when 'title' then 2 else 3 end
       limit 1;
      if v_col is not null then
        -- عمودان فقط: id والاسم المكتشَف. لا created_at ولا غيره — كلّ عمود
        -- إضافيّ هنا تخمينٌ يُنتج 42703 ويُسقط الشاشة كلّها.
        execute format($q$select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name',
                         coalesce(nullif(btrim(p.%I), ''), p.id::text)) order by p.%I), '[]'::jsonb)
                       from (select id, %I from public.projects order by %I limit 500) p$q$,
                       v_col, v_col, v_col, v_col)
          into v_projects;
      end if;
    exception when others then v_projects := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object('ok', true,
    'projects', v_projects,
    -- صدق: «غير متاح» ليست «لا مشاريع». الفرق يظهر في الشاشة كما هو.
    'projects_source', case when to_regclass('public.projects') is null
                            then 'unavailable' else 'projects' end,
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'kind', l.kind,
                     'city', l.city, 'contact_name', l.contact_name, 'contact_phone', l.contact_phone)
                     order by l.name), '[]'::jsonb)
                    from public.ops_locations l where l.is_deleted = false and l.is_active),
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'label', v.label,
                     'plate_no', v.plate_no, 'vehicle_type', v.vehicle_type) order by v.label), '[]'::jsonb)
                    from public.ops_vehicles v where v.is_deleted = false and v.is_active),
    'people', v_people, 'professions', v_prof, 'assets', v_assets,
    -- مصدر الأصول = مخزون العهدة. إن غاب فالحقل نصّ حرّ ولا يُدّعى تكامل.
    'assets_source', case when to_regclass('public.custody_inventory_assets') is null
                          then 'unavailable' else 'custody_inventory_assets' end);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) لوحة اليوم — اليوم · الأيام السبعة · التعارضات · النواقص · إعلام غير مُؤمَّن
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today jsonb; v_next jsonb; v_conf jsonb;
        v_no_crew jsonb; v_no_equip jsonb; v_no_permit jsonb; v_no_backup jsonb;
        v_manage boolean := coalesce(public.prodops_can_manage(), false);
begin
  if not coalesce(public.prodops_can_view(), false) then raise exception 'not authorized'; end if;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_today from (
    select jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'job_type', j.job_type, 'status', j.status, 'priority', j.priority,
      'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
      'location_name', l.name,
      'readiness', (public.prodops_readiness_core(j.id)->>'score')::int,
      'sort_key', to_char(j.scheduled_start, 'HH24:MI')) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    left join public.ops_locations l on l.id = j.location_id
    where j.status <> 'cancelled' and j.scheduled_start is not null
      and j.scheduled_start >= date_trunc('day', now())
      and j.scheduled_start <  date_trunc('day', now()) + interval '1 day'
  ) s;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_next from (
    select jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'job_type', j.job_type, 'status', j.status, 'priority', j.priority,
      'scheduled_start', j.scheduled_start, 'location_name', l.name,
      'readiness', (public.prodops_readiness_core(j.id)->>'score')::int,
      'sort_key', to_char(j.scheduled_start, 'YYYY-MM-DD HH24:MI')) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    left join public.ops_locations l on l.id = j.location_id
    where j.status <> 'cancelled' and j.scheduled_start is not null
      and j.scheduled_start >= date_trunc('day', now()) + interval '1 day'
      and j.scheduled_start <  date_trunc('day', now()) + interval '8 days'
  ) s;

  v_conf := public.prodops_conflicts(jsonb_build_object(
    'from', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'to',   to_char(now() + interval '14 days','YYYY-MM-DD"T"HH24:MI:SSOF')));

  -- طاقم ناقص: مهمّة قادمة بلا طاقم، أو بطاقم لم يؤكّد.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_no_crew from (
    select jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'scheduled_start', j.scheduled_start,
      'crew_count', (select count(*) from public.ops_job_crew c
                      where c.job_id = j.id and c.is_deleted = false and c.status <> 'declined'),
      'unconfirmed', (select count(*) from public.ops_job_crew c
                      where c.job_id = j.id and c.is_deleted = false
                        and c.status not in ('confirmed','attended','declined'))) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    where j.status in ('scheduled','confirmed','in_progress') and j.scheduled_start is not null
      and j.scheduled_start < now() + interval '14 days'
      and ((select count(*) from public.ops_job_crew c
             where c.job_id = j.id and c.is_deleted = false and c.status <> 'declined') = 0
        or (select count(*) from public.ops_job_crew c
             where c.job_id = j.id and c.is_deleted = false
               and c.status not in ('confirmed','attended','declined')) > 0)
  ) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_no_equip from (
    select jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'scheduled_start', j.scheduled_start) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    where j.status in ('scheduled','confirmed','in_progress') and j.scheduled_start is not null
      and j.scheduled_start < now() + interval '14 days'
      and j.job_type <> 'editing' and j.job_type <> 'design'
      and not exists (select 1 from public.ops_job_equipment e
                       where e.job_id = j.id and e.is_deleted = false and e.status <> 'cancelled')
  ) s;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_no_permit from (
    select jsonb_build_object('id', j.id, 'job_code', j.job_code, 'title', j.title,
      'scheduled_start', j.scheduled_start,
      'pending', (select count(*) from public.ops_job_permits p
                   where p.job_id = j.id and p.is_deleted = false
                     and p.status in ('pending','submitted','rejected','expired'))) as x
    from public.ops_jobs j
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    where j.status in ('scheduled','confirmed','in_progress') and j.scheduled_start is not null
      and j.scheduled_start < now() + interval '21 days'
      and ((j.permit_required and not exists (select 1 from public.ops_job_permits p
             where p.job_id = j.id and p.is_deleted = false and p.status = 'approved'))
        or exists (select 1 from public.ops_job_permits p
             where p.job_id = j.id and p.is_deleted = false
               and p.status in ('pending','submitted','rejected','expired')))
  ) s;

  -- مادّة غير مُؤمَّنة: بطاقة بلا نسختين + تحقّق.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_no_backup from (
    select jsonb_build_object('job_id', j.id, 'job_code', j.job_code, 'title', j.title,
      'card_id', m.id, 'card_label', m.card_label, 'card_status', m.status,
      'primary_done', coalesce(b.primary_done, false), 'second_done', coalesce(b.second_done, false),
      'nas_done', coalesce(b.nas_done, false), 'verified', coalesce(b.verified, false)) as x
    from public.ops_media_cards m
    join public.ops_jobs j on j.id = m.job_id and j.is_deleted = false
    join public.prodops_visible_jobs() vj on vj.job_id = j.id
    left join public.ops_media_backups b on b.card_id = m.id
    where m.is_deleted = false and m.status <> 'formatted'
      and j.status in ('in_progress','completed')
      and coalesce(b.verified, false) = false
  ) s;

  return jsonb_build_object('ok', true, 'can_manage', v_manage, 'generated_at', now(),
    'today', v_today, 'next_7_days', v_next,
    'conflicts', v_conf,
    'missing_crew', v_no_crew, 'missing_equipment', v_no_equip,
    'missing_permits', v_no_permit, 'media_not_backed_up', v_no_backup,
    'counters', jsonb_build_object(
      'today', jsonb_array_length(v_today), 'next_7_days', jsonb_array_length(v_next),
      'conflicts', coalesce((v_conf->>'total')::int, 0),
      'missing_crew', jsonb_array_length(v_no_crew),
      'missing_equipment', jsonb_array_length(v_no_equip),
      'missing_permits', jsonb_array_length(v_no_permit),
      'media_not_backed_up', jsonb_array_length(v_no_backup)));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) الكتابة — كلّها SECURITY DEFINER، وكلّها مُدقَّقة.
--      ★ لا سياسة كتابة على أيّ جدول، فإخفاء الزرّ ليس تصريحًا: المنع هنا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.prodops_next_job_code() returns text
language sql volatile security definer set search_path = public as $$
  select 'OPS-' || to_char(now(), 'YYMM') || '-' ||
         lpad(nextval('public.ops_job_code_seq')::text, 4, '0');
$$;

create or replace function public.prodops_job_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_new boolean := false; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_manage(), false) then raise exception 'not authorized'; end if;
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;

  if v_id is null then
    v_new := true;
    v_code := public.prodops_next_job_code();
    insert into public.ops_jobs (
      job_code, title, job_type, project_id, client_label, status, priority,
      scheduled_start, scheduled_end, timezone, location_id, location_note,
      permit_required, travel_required, description, internal_notes, owner_user_id, created_by)
    values (
      v_code,
      coalesce(nullif(btrim(coalesce(p->>'title','')), ''), 'مهمّة إنتاج'),
      coalesce(nullif(btrim(coalesce(p->>'job_type','')), ''), 'other'),
      nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'client_label','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'draft'),
      coalesce(nullif(btrim(coalesce(p->>'priority','')), ''), 'normal'),
      nullif(btrim(coalesce(p->>'scheduled_start','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'scheduled_end','')), '')::timestamptz,
      coalesce(nullif(btrim(coalesce(p->>'timezone','')), ''), 'Asia/Riyadh'),
      nullif(btrim(coalesce(p->>'location_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'location_note','')), ''),
      coalesce((p->>'permit_required')::boolean, false),
      coalesce((p->>'travel_required')::boolean, false),
      nullif(btrim(coalesce(p->>'description','')), ''),
      nullif(btrim(coalesce(p->>'internal_notes','')), ''),
      nullif(btrim(coalesce(p->>'owner_user_id','')), '')::uuid,
      auth.uid())
    returning id into v_id;
  else
    update public.ops_jobs set
      title           = coalesce(nullif(btrim(coalesce(p->>'title','')), ''), title),
      job_type        = coalesce(nullif(btrim(coalesce(p->>'job_type','')), ''), job_type),
      project_id      = case when p ? 'project_id'  then nullif(btrim(coalesce(p->>'project_id','')), '')::uuid  else project_id  end,
      client_label    = case when p ? 'client_label' then nullif(btrim(coalesce(p->>'client_label','')), '')      else client_label end,
      priority        = coalesce(nullif(btrim(coalesce(p->>'priority','')), ''), priority),
      scheduled_start = case when p ? 'scheduled_start' then nullif(btrim(coalesce(p->>'scheduled_start','')), '')::timestamptz else scheduled_start end,
      scheduled_end   = case when p ? 'scheduled_end'   then nullif(btrim(coalesce(p->>'scheduled_end','')), '')::timestamptz   else scheduled_end   end,
      timezone        = coalesce(nullif(btrim(coalesce(p->>'timezone','')), ''), timezone),
      location_id     = case when p ? 'location_id'   then nullif(btrim(coalesce(p->>'location_id','')), '')::uuid else location_id end,
      location_note   = case when p ? 'location_note' then nullif(btrim(coalesce(p->>'location_note','')), '')     else location_note end,
      permit_required = coalesce((p->>'permit_required')::boolean, permit_required),
      travel_required = coalesce((p->>'travel_required')::boolean, travel_required),
      description     = case when p ? 'description'    then nullif(btrim(coalesce(p->>'description','')), '')    else description    end,
      internal_notes  = case when p ? 'internal_notes' then nullif(btrim(coalesce(p->>'internal_notes','')), '') else internal_notes end,
      owner_user_id   = case when p ? 'owner_user_id'  then nullif(btrim(coalesce(p->>'owner_user_id','')), '')::uuid else owner_user_id end,
      version         = version + 1
    where id = v_id and is_deleted = false;
    if not found then raise exception 'job_not_found'; end if;
  end if;

  perform public.prodops_log(case when v_new then 'job_create' else 'job_update' end,
    'ops_job', v_id, v_id, jsonb_build_object('payload_keys', (select coalesce(jsonb_agg(k),'[]'::jsonb)
      from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
-- ★ رفض الحجز المزدوج يصل من حارس §7B كـ23P01. يُترجَم إلى رفض مفهوم بدل خطأ
--   خام، ولا يُلتقط 'not authorized' (P0001) فيبقى المنع منعًا.
exception when sqlstate '23P01' then
  return jsonb_build_object('ok', false, 'reason','double_booked', 'message', sqlerrm);
end $$;

-- تغيير الحالة: انتقال مضبوط، لا قفزة عشوائية، ومُدقَّق.
create or replace function public.prodops_job_set_status(p_job uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_old text; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_edit_job(p_job), false) then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('draft','scheduled','confirmed','in_progress','on_hold','completed','cancelled') then
    raise exception 'invalid_status';
  end if;
  select status into v_old from public.ops_jobs where id = p_job and is_deleted = false for update;
  if v_old is null then raise exception 'job_not_found'; end if;

  v_ok := case
    when v_old = p_status then true
    when v_old = 'draft'       and p_status in ('scheduled','cancelled') then true
    when v_old = 'scheduled'   and p_status in ('confirmed','draft','on_hold','cancelled') then true
    when v_old = 'confirmed'   and p_status in ('in_progress','scheduled','on_hold','cancelled') then true
    when v_old = 'in_progress' and p_status in ('completed','on_hold','cancelled') then true
    when v_old = 'on_hold'     and p_status in ('scheduled','confirmed','in_progress','cancelled') then true
    when v_old = 'completed'   and p_status in ('in_progress') then true
    else false end;
  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'reason','invalid_transition', 'from', v_old, 'to', p_status,
      'message','انتقال غير مسموح من «' || v_old || '» إلى «' || p_status || '». لم يتغيّر شيء.');
  end if;

  update public.ops_jobs
     set status = p_status,
         actual_start = case when p_status = 'in_progress' and actual_start is null then now() else actual_start end,
         actual_end   = case when p_status = 'completed'   and actual_end   is null then now() else actual_end   end,
         version = version + 1
   where id = p_job and is_deleted = false;

  perform public.prodops_log('job_status', 'ops_job', p_job, p_job,
    jsonb_build_object('from', v_old, 'to', p_status, 'note', p_note));
  return jsonb_build_object('ok', true, 'id', p_job, 'from', v_old, 'to', p_status);
-- ★ الالتزام بالحالة (draft → scheduled) يُفعّل فحص §7B: مسوّدة تخفي ازدواجًا
--   لا تصير مهمّة مُلتزَمة بصمت.
exception when sqlstate '23P01' then
  return jsonb_build_object('ok', false, 'id', p_job, 'from', v_old, 'to', p_status,
    'reason','double_booked', 'message', sqlerrm);
end $$;

create or replace function public.prodops_job_delete(p_job uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_edit_job(p_job), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.ops_jobs
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
         delete_reason = btrim(p_reason), version = version + 1
   where id = p_job and is_deleted = false;
  if not found then raise exception 'job_not_found'; end if;
  perform public.prodops_log('job_delete', 'ops_job', p_job, p_job, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_job);
end $$;

-- ─── المُحرِّر العامّ للأبناء ────────────────────────────────────────────────
-- كتابة **صفّ كامل**: الواجهة ترسل الكائن كاملًا. الأنواع قائمة بيضاء ثابتة،
-- وتغيير المهمّة الأمّ لصفّ قائم ممنوع (لا نقل صامت بين المهامّ).
create or replace function public.prodops_child_upsert(p_kind text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
        v_id uuid; v_job uuid; v_tbl text; v_owner uuid; v_target uuid; v_title text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_job := nullif(btrim(coalesce(p->>'job_id','')), '')::uuid;
  if v_job is null then raise exception 'job_id_required'; end if;
  if not coalesce(public.prodops_can_edit_job(v_job), false) then raise exception 'not authorized'; end if;

  v_tbl := case p_kind
    when 'crew'               then 'ops_job_crew'
    when 'equipment'          then 'ops_job_equipment'
    when 'permit'             then 'ops_job_permits'
    when 'travel'             then 'ops_job_travel'
    when 'accommodation'      then 'ops_job_accommodation'
    when 'vehicle_assignment' then 'ops_job_vehicles'
    when 'hse'                then 'ops_job_hse'
    when 'weather'            then 'ops_job_weather'
    when 'media_card'         then 'ops_media_cards'
    when 'ingest'             then 'ops_ingest_jobs'
    when 'post_handoff'       then 'ops_post_handoff'
    when 'incident'           then 'ops_incidents'
    when 'delay'              then 'ops_delays'
    when 'call_sheet'         then 'ops_call_sheets'
    else null end;
  if v_tbl is null then raise exception 'unknown_kind'; end if;

  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  -- مفتاح طبيعيّ لنوعين لا يُكرَّران لليوم/البند نفسه.
  if v_id is null and p_kind = 'hse' then
    select id into v_id from public.ops_job_hse
     where job_id = v_job and item_key = nullif(btrim(coalesce(p->>'item_key','')), '') and is_deleted = false;
  end if;
  if v_id is null and p_kind = 'weather' then
    -- التاريخ الافتراضيّ نفسه المستعمل في الإدراج، وإلّا بحثنا عن NULL ثمّ أدرجنا
    -- على تاريخ اليوم فوقع 23505 بلا سبب مفهوم.
    select id into v_id from public.ops_job_weather
     where job_id = v_job
       and for_date = coalesce(nullif(btrim(coalesce(p->>'for_date','')), '')::date, current_date)
       and is_deleted = false;
  end if;

  if v_id is not null then
    execute format('select job_id from public.%I where id = $1', v_tbl) into v_owner using v_id;
    if v_owner is null then raise exception 'row_not_found'; end if;
    if v_owner <> v_job then raise exception 'job_mismatch'; end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());

  if p_kind = 'crew' then
    v_target := nullif(btrim(coalesce(p->>'user_id','')), '')::uuid;
    insert into public.ops_job_crew as t (id, job_id, user_id, profession_id, crew_role, external_name,
      external_phone, call_time, wrap_time, status, notes, created_by)
    values (v_id, v_job, v_target,
      nullif(btrim(coalesce(p->>'profession_id','')), '')::uuid,
      coalesce(nullif(btrim(coalesce(p->>'crew_role','')), ''), 'crew'),
      nullif(btrim(coalesce(p->>'external_name','')), ''),
      nullif(btrim(coalesce(p->>'external_phone','')), ''),
      nullif(btrim(coalesce(p->>'call_time','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'wrap_time','')), '')::timestamptz,
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'assigned'),
      nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
    on conflict (id) do update set
      user_id = excluded.user_id, profession_id = excluded.profession_id, crew_role = excluded.crew_role,
      external_name = excluded.external_name, external_phone = excluded.external_phone,
      call_time = excluded.call_time, wrap_time = excluded.wrap_time,
      status = excluded.status, notes = excluded.notes, is_deleted = false;
    select title into v_title from public.ops_jobs where id = v_job;
    perform public.prodops_notify(v_target, 'ops_crew_assigned', v_job,
      'أُسنِدت إليك مهمّة إنتاج: ' || coalesce(v_title, ''), 'You were assigned to a production job');

  elsif p_kind = 'equipment' then
    insert into public.ops_job_equipment as t (id, job_id, asset_id, asset_label, quantity,
      custody_reservation_id, custody_assignment_id, needed_from, needed_to, status, note, created_by)
    values (v_id, v_job,
      nullif(btrim(coalesce(p->>'asset_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'asset_label','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'quantity','')), '')::numeric, 1),
      nullif(btrim(coalesce(p->>'custody_reservation_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'custody_assignment_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'needed_from','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'needed_to','')), '')::timestamptz,
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'requested'),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      asset_id = excluded.asset_id, asset_label = excluded.asset_label, quantity = excluded.quantity,
      custody_reservation_id = excluded.custody_reservation_id,
      custody_assignment_id = excluded.custody_assignment_id,
      needed_from = excluded.needed_from, needed_to = excluded.needed_to,
      status = excluded.status, note = excluded.note, is_deleted = false;

  elsif p_kind = 'permit' then
    insert into public.ops_job_permits as t (id, job_id, permit_type, authority_name, reference_no,
      status, requested_at, issued_at, expires_at, document_url, note, created_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'permit_type','')), ''), 'other'),
      nullif(btrim(coalesce(p->>'authority_name','')), ''),
      nullif(btrim(coalesce(p->>'reference_no','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'pending'),
      nullif(btrim(coalesce(p->>'requested_at','')), '')::date,
      nullif(btrim(coalesce(p->>'issued_at','')), '')::date,
      nullif(btrim(coalesce(p->>'expires_at','')), '')::date,
      nullif(btrim(coalesce(p->>'document_url','')), ''),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      permit_type = excluded.permit_type, authority_name = excluded.authority_name,
      reference_no = excluded.reference_no, status = excluded.status,
      requested_at = excluded.requested_at, issued_at = excluded.issued_at,
      expires_at = excluded.expires_at, document_url = excluded.document_url,
      note = excluded.note, is_deleted = false;

  elsif p_kind = 'travel' then
    insert into public.ops_job_travel as t (id, job_id, mode, from_place, to_place, depart_at, arrive_at,
      booking_ref, traveller_user_id, traveller_name, status, note, created_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'mode','')), ''), 'car'),
      nullif(btrim(coalesce(p->>'from_place','')), ''), nullif(btrim(coalesce(p->>'to_place','')), ''),
      nullif(btrim(coalesce(p->>'depart_at','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'arrive_at','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'booking_ref','')), ''),
      nullif(btrim(coalesce(p->>'traveller_user_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'traveller_name','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'planned'),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      mode = excluded.mode, from_place = excluded.from_place, to_place = excluded.to_place,
      depart_at = excluded.depart_at, arrive_at = excluded.arrive_at, booking_ref = excluded.booking_ref,
      traveller_user_id = excluded.traveller_user_id, traveller_name = excluded.traveller_name,
      status = excluded.status, note = excluded.note, is_deleted = false;

  elsif p_kind = 'accommodation' then
    insert into public.ops_job_accommodation as t (id, job_id, hotel_name, city, check_in, check_out,
      rooms, booking_ref, guest_note, status, note, created_by)
    values (v_id, v_job,
      nullif(btrim(coalesce(p->>'hotel_name','')), ''), nullif(btrim(coalesce(p->>'city','')), ''),
      nullif(btrim(coalesce(p->>'check_in','')), '')::date,
      nullif(btrim(coalesce(p->>'check_out','')), '')::date,
      nullif(btrim(coalesce(p->>'rooms','')), '')::int,
      nullif(btrim(coalesce(p->>'booking_ref','')), ''), nullif(btrim(coalesce(p->>'guest_note','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'planned'),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      hotel_name = excluded.hotel_name, city = excluded.city, check_in = excluded.check_in,
      check_out = excluded.check_out, rooms = excluded.rooms, booking_ref = excluded.booking_ref,
      guest_note = excluded.guest_note, status = excluded.status, note = excluded.note, is_deleted = false;

  elsif p_kind = 'vehicle_assignment' then
    insert into public.ops_job_vehicles as t (id, job_id, vehicle_id, vehicle_label, driver_user_id,
      driver_name, depart_at, return_at, status, note, created_by)
    values (v_id, v_job,
      nullif(btrim(coalesce(p->>'vehicle_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'vehicle_label','')), ''),
      nullif(btrim(coalesce(p->>'driver_user_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'driver_name','')), ''),
      nullif(btrim(coalesce(p->>'depart_at','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'return_at','')), '')::timestamptz,
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'planned'),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      vehicle_id = excluded.vehicle_id, vehicle_label = excluded.vehicle_label,
      driver_user_id = excluded.driver_user_id, driver_name = excluded.driver_name,
      depart_at = excluded.depart_at, return_at = excluded.return_at,
      status = excluded.status, note = excluded.note, is_deleted = false;

  elsif p_kind = 'hse' then
    insert into public.ops_job_hse as t (id, job_id, item_key, item_ar, item_en, is_required, status,
      checked_by, checked_at, note)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'item_key','')), ''), 'item_' || left(v_id::text, 8)),
      coalesce(nullif(btrim(coalesce(p->>'item_ar','')), ''), 'بند سلامة'),
      nullif(btrim(coalesce(p->>'item_en','')), ''),
      coalesce((p->>'is_required')::boolean, true),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'pending'),
      case when coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'pending') = 'pending' then null else auth.uid() end,
      case when coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'pending') = 'pending' then null else now() end,
      nullif(btrim(coalesce(p->>'note','')), ''))
    on conflict (id) do update set
      item_ar = excluded.item_ar, item_en = excluded.item_en, is_required = excluded.is_required,
      status = excluded.status, checked_by = excluded.checked_by, checked_at = excluded.checked_at,
      note = excluded.note, is_deleted = false;

  elsif p_kind = 'weather' then
    -- Placeholder: المصدر يدويّ دائمًا. لا يمكن ادّعاء مصدر آليّ عبر الحمولة.
    insert into public.ops_job_weather as t (id, job_id, for_date, source, condition, temp_c, wind_kph,
      precip_pct, note, entered_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'for_date','')), '')::date, current_date),
      'manual',
      nullif(btrim(coalesce(p->>'condition','')), ''),
      nullif(btrim(coalesce(p->>'temp_c','')), '')::numeric,
      nullif(btrim(coalesce(p->>'wind_kph','')), '')::numeric,
      nullif(btrim(coalesce(p->>'precip_pct','')), '')::numeric,
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      condition = excluded.condition, temp_c = excluded.temp_c, wind_kph = excluded.wind_kph,
      precip_pct = excluded.precip_pct, note = excluded.note, source = 'manual',
      entered_by = auth.uid(), entered_at = now(), is_deleted = false;

  elsif p_kind = 'media_card' then
    insert into public.ops_media_cards as t (id, job_id, card_label, card_type, capacity_gb,
      holder_user_id, holder_name, status, note, created_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'card_label','')), ''), 'CARD-' || left(v_id::text, 4)),
      coalesce(nullif(btrim(coalesce(p->>'card_type','')), ''), 'sd'),
      nullif(btrim(coalesce(p->>'capacity_gb','')), '')::numeric,
      nullif(btrim(coalesce(p->>'holder_user_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'holder_name','')), ''),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'assigned'),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      card_label = excluded.card_label, card_type = excluded.card_type,
      capacity_gb = excluded.capacity_gb, holder_user_id = excluded.holder_user_id,
      holder_name = excluded.holder_name, status = excluded.status, note = excluded.note,
      is_deleted = false;
    -- صفّ نسخ احتياطي مصاحب: القائمة تبدأ فارغة لا مفقودة.
    insert into public.ops_media_backups (job_id, card_id, updated_by)
    values (v_job, v_id, auth.uid()) on conflict do nothing;

  elsif p_kind = 'ingest' then
    insert into public.ops_ingest_jobs as t (id, job_id, card_id, target, status, started_at,
      finished_at, total_gb, note, updated_by)
    values (v_id, v_job,
      nullif(btrim(coalesce(p->>'card_id','')), '')::uuid,
      coalesce(nullif(btrim(coalesce(p->>'target','')), ''), 'nas'),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'not_started'),
      nullif(btrim(coalesce(p->>'started_at','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'finished_at','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'total_gb','')), '')::numeric,
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      card_id = excluded.card_id, target = excluded.target, status = excluded.status,
      started_at = excluded.started_at, finished_at = excluded.finished_at,
      total_gb = excluded.total_gb, note = excluded.note, updated_by = auth.uid(), is_deleted = false;

  elsif p_kind = 'post_handoff' then
    v_target := nullif(btrim(coalesce(p->>'handed_to_user_id','')), '')::uuid;
    insert into public.ops_post_handoff as t (id, job_id, handed_to_user_id, handed_to_name, handed_by,
      brief, brief_url, expected_delivery, status)
    values (v_id, v_job, v_target,
      nullif(btrim(coalesce(p->>'handed_to_name','')), ''), auth.uid(),
      nullif(btrim(coalesce(p->>'brief','')), ''), nullif(btrim(coalesce(p->>'brief_url','')), ''),
      nullif(btrim(coalesce(p->>'expected_delivery','')), '')::date,
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'pending'))
    on conflict (id) do update set
      handed_to_user_id = excluded.handed_to_user_id, handed_to_name = excluded.handed_to_name,
      brief = excluded.brief, brief_url = excluded.brief_url,
      expected_delivery = excluded.expected_delivery, status = excluded.status, is_deleted = false;
    select title into v_title from public.ops_jobs where id = v_job;
    perform public.prodops_notify(v_target, 'ops_post_handoff', v_job,
      'تسليم لما بعد الإنتاج: ' || coalesce(v_title, ''), 'Post-production handoff assigned to you');

  elsif p_kind = 'incident' then
    insert into public.ops_incidents as t (id, job_id, incident_type, severity, occurred_at, description,
      immediate_action, reported_by, status, resolution)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'incident_type','')), ''), 'other'),
      coalesce(nullif(btrim(coalesce(p->>'severity','')), ''), 'low'),
      coalesce(nullif(btrim(coalesce(p->>'occurred_at','')), '')::timestamptz, now()),
      coalesce(nullif(btrim(coalesce(p->>'description','')), ''), 'بلا وصف'),
      nullif(btrim(coalesce(p->>'immediate_action','')), ''), auth.uid(),
      coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'open'),
      nullif(btrim(coalesce(p->>'resolution','')), ''))
    on conflict (id) do update set
      incident_type = excluded.incident_type, severity = excluded.severity,
      occurred_at = excluded.occurred_at, description = excluded.description,
      immediate_action = excluded.immediate_action, status = excluded.status,
      resolution = excluded.resolution,
      resolved_at = case when excluded.status in ('resolved','closed') then now() else t.resolved_at end,
      is_deleted = false;

  elsif p_kind = 'delay' then
    insert into public.ops_delays as t (id, job_id, delay_reason, minutes_lost, occurred_at, note, recorded_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'delay_reason','')), ''), 'other'),
      coalesce(nullif(btrim(coalesce(p->>'minutes_lost','')), '')::int, 0),
      coalesce(nullif(btrim(coalesce(p->>'occurred_at','')), '')::timestamptz, now()),
      nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
    on conflict (id) do update set
      delay_reason = excluded.delay_reason, minutes_lost = excluded.minutes_lost,
      occurred_at = excluded.occurred_at, note = excluded.note, is_deleted = false;

  elsif p_kind = 'call_sheet' then
    -- الورقة المنشورة لا تُعدَّل صامتًا: يُقال ذلك صراحةً بدل تجاهل الحفظ.
    if exists (select 1 from public.ops_call_sheets
                where id = v_id and status = 'published' and is_deleted = false) then
      return jsonb_build_object('ok', false, 'id', v_id, 'kind', p_kind, 'reason','already_published',
        'message','هذه الورقة منشورة ولا تُعدَّل. أنشئ نسخة (version) جديدة.');
    end if;
    insert into public.ops_call_sheets as t (id, job_id, sheet_date, version, general_call_time,
      location_id, weather_note, hospital_name, hospital_address, emergency_contact_name,
      emergency_contact_phone, parking_note, notes, created_by)
    values (v_id, v_job,
      coalesce(nullif(btrim(coalesce(p->>'sheet_date','')), '')::date, current_date),
      coalesce(nullif(btrim(coalesce(p->>'version','')), '')::int, 1),
      nullif(btrim(coalesce(p->>'general_call_time','')), '')::timestamptz,
      nullif(btrim(coalesce(p->>'location_id','')), '')::uuid,
      nullif(btrim(coalesce(p->>'weather_note','')), ''),
      nullif(btrim(coalesce(p->>'hospital_name','')), ''),
      nullif(btrim(coalesce(p->>'hospital_address','')), ''),
      nullif(btrim(coalesce(p->>'emergency_contact_name','')), ''),
      nullif(btrim(coalesce(p->>'emergency_contact_phone','')), ''),
      nullif(btrim(coalesce(p->>'parking_note','')), ''),
      nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
    on conflict (id) do update set
      sheet_date = excluded.sheet_date, version = excluded.version,
      general_call_time = excluded.general_call_time, location_id = excluded.location_id,
      weather_note = excluded.weather_note, hospital_name = excluded.hospital_name,
      hospital_address = excluded.hospital_address,
      emergency_contact_name = excluded.emergency_contact_name,
      emergency_contact_phone = excluded.emergency_contact_phone,
      parking_note = excluded.parking_note, notes = excluded.notes, is_deleted = false;
  end if;

  perform public.prodops_log('child_upsert', v_tbl, v_id, v_job, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', p_kind, 'job_id', v_job);
-- ★ الحجز المزدوج (طاقم أو معدّات) مرفوض في القاعدة — هنا تُقال العلّة بالعربية.
exception when sqlstate '23P01' then
  return jsonb_build_object('ok', false, 'kind', p_kind, 'job_id', v_job,
    'reason','double_booked', 'message', sqlerrm);
end $$;

create or replace function public.prodops_child_delete(p_kind text, p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_tbl text; v_job uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  v_tbl := case p_kind
    when 'crew'               then 'ops_job_crew'
    when 'equipment'          then 'ops_job_equipment'
    when 'permit'             then 'ops_job_permits'
    when 'travel'             then 'ops_job_travel'
    when 'accommodation'      then 'ops_job_accommodation'
    when 'vehicle_assignment' then 'ops_job_vehicles'
    when 'hse'                then 'ops_job_hse'
    when 'weather'            then 'ops_job_weather'
    when 'media_card'         then 'ops_media_cards'
    when 'ingest'             then 'ops_ingest_jobs'
    when 'post_handoff'       then 'ops_post_handoff'
    when 'incident'           then 'ops_incidents'
    when 'delay'              then 'ops_delays'
    when 'call_sheet'         then 'ops_call_sheets'
    when 'daily_report'       then 'ops_daily_reports'
    else null end;
  if v_tbl is null then raise exception 'unknown_kind'; end if;

  execute format('select job_id from public.%I where id = $1 and is_deleted = false', v_tbl)
    into v_job using p_id;
  if v_job is null then raise exception 'row_not_found'; end if;
  if not coalesce(public.prodops_can_edit_job(v_job), false) then raise exception 'not authorized'; end if;

  execute format('update public.%I set is_deleted = true where id = $1 and is_deleted = false', v_tbl)
    using p_id;
  perform public.prodops_log('child_delete', v_tbl, p_id, v_job,
    jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_id, 'kind', p_kind);
end $$;

-- بذر قائمة السلامة الافتراضية (لا يمسّ بندًا موجودًا).
create or replace function public.prodops_hse_seed(p_job uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_edit_job(p_job), false) then raise exception 'not authorized'; end if;
  insert into public.ops_job_hse (job_id, item_key, item_ar, item_en, is_required)
  select p_job, v.k, v.ar, v.en, v.req from (values
    ('risk_brief',   'إحاطة المخاطر قبل البدء',        'Pre-job risk briefing',      true),
    ('first_aid',    'حقيبة إسعافات أوّلية متوفّرة',    'First-aid kit available',    true),
    ('emergency',    'رقم طوارئ ومستشفى قريب مُدوَّن',  'Emergency contact & hospital', true),
    ('power_safety', 'سلامة الكهرباء والكابلات',        'Power and cable safety',     true),
    ('rigging',      'تثبيت المعدّات والحوامل',         'Rigging and stands secured', true),
    ('crowd',        'إدارة الجمهور والمارّة',           'Crowd and public control',   false),
    ('drone_safety', 'سلامة الطيران وتصريح المجال',     'Drone airspace safety',      false),
    ('heat',         'الحرارة والماء وفترات الراحة',     'Heat, water and breaks',     true),
    ('ppe',          'معدّات الوقاية الشخصية',           'Personal protective equipment', false),
    ('vehicle',      'سلامة المركبة والسائق',           'Vehicle and driver safety',  false)
  ) as v(k, ar, en, req)
  where not exists (select 1 from public.ops_job_hse h
                     where h.job_id = p_job and h.item_key = v.k and h.is_deleted = false);
  get diagnostics v_n = row_count;
  perform public.prodops_log('hse_seed', 'ops_job_hse', null, p_job, jsonb_build_object('added', v_n));
  return jsonb_build_object('ok', true, 'added', v_n);
end $$;

-- ─── الخدمة الذاتية للطاقم — نطاقها صاحب الجلسة نفسه، لا فلتر من الواجهة ───
create or replace function public.prodops_confirm_attendance(p_job uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('confirmed','declined','attended') then
    raise exception 'invalid_status';
  end if;
  -- الشرط الحاسم: user_id = auth.uid(). لا أحد يؤكّد نيابةً عن غيره من هنا.
  update public.ops_job_crew
     set status = p_status,
         attendance_confirmed_at = now(),
         attendance_note = nullif(btrim(coalesce(p_note, '')), '')
   where job_id = p_job and user_id = auth.uid() and is_deleted = false
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason','not_assigned',
      'message','لست ضمن طاقم هذه المهمّة، فلا حضور لتأكيده.');
  end if;
  perform public.prodops_log('attendance', 'ops_job_crew', v_id, p_job,
    jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true, 'crew_id', v_id, 'status', p_status);
end $$;

-- التقرير اليوميّ: كلٌّ يكتب تقريره هو. المدير يكتب ويقرأ الكلّ.
create or replace function public.prodops_daily_report_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb);
        v_job uuid; v_id uuid; v_date date; v_status text; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_job  := nullif(btrim(coalesce(p->>'job_id','')), '')::uuid;
  if v_job is null then raise exception 'job_id_required'; end if;
  -- فرد الطاقم يكتب لمهمّته هو؛ المدير لأيّ مهمّة.
  if not (coalesce(public.prodops_can_manage(), false) or coalesce(public.prodops_is_crew(v_job), false)) then
    raise exception 'not authorized';
  end if;
  v_date   := coalesce(nullif(btrim(coalesce(p->>'report_date','')), '')::date, current_date);
  v_status := coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'draft');
  if v_status not in ('draft','submitted') then raise exception 'invalid_status'; end if;

  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select prepared_by into v_owner from public.ops_daily_reports where id = v_id and is_deleted = false;
    if v_owner is null then raise exception 'row_not_found'; end if;
    -- ★ لا يحرّر أحدٌ تقرير غيره، ولا حتى المدير: التقرير شهادة كاتبه.
    if v_owner <> auth.uid() then raise exception 'not authorized'; end if;
  else
    select id into v_id from public.ops_daily_reports
     where job_id = v_job and report_date = v_date and prepared_by = auth.uid() and is_deleted = false;
  end if;
  -- التقرير المُرسَل شهادة مُوقَّعة: لا يُعاد كتابته، ويُقال ذلك بدل حفظٍ صامت لا يقع.
  if v_id is not null and exists (select 1 from public.ops_daily_reports
        where id = v_id and status = 'submitted' and is_deleted = false) then
    return jsonb_build_object('ok', false, 'id', v_id, 'reason','already_submitted',
      'message','التقرير مُرسَل ولا يُعدَّل. تواصل مع مدير التشغيل لفتحه.');
  end if;
  v_id := coalesce(v_id, gen_random_uuid());

  insert into public.ops_daily_reports as t (id, job_id, report_date, prepared_by, call_time_actual,
    wrap_time_actual, weather_note, shots_planned, shots_done, crew_present, summary, issues,
    next_day_plan, status, submitted_at)
  values (v_id, v_job, v_date, auth.uid(),
    nullif(btrim(coalesce(p->>'call_time_actual','')), '')::timestamptz,
    nullif(btrim(coalesce(p->>'wrap_time_actual','')), '')::timestamptz,
    nullif(btrim(coalesce(p->>'weather_note','')), ''),
    nullif(btrim(coalesce(p->>'shots_planned','')), '')::int,
    nullif(btrim(coalesce(p->>'shots_done','')), '')::int,
    nullif(btrim(coalesce(p->>'crew_present','')), '')::int,
    nullif(btrim(coalesce(p->>'summary','')), ''), nullif(btrim(coalesce(p->>'issues','')), ''),
    nullif(btrim(coalesce(p->>'next_day_plan','')), ''), v_status,
    case when v_status = 'submitted' then now() else null end)
  on conflict (id) do update set
    call_time_actual = excluded.call_time_actual, wrap_time_actual = excluded.wrap_time_actual,
    weather_note = excluded.weather_note, shots_planned = excluded.shots_planned,
    shots_done = excluded.shots_done, crew_present = excluded.crew_present,
    summary = excluded.summary, issues = excluded.issues, next_day_plan = excluded.next_day_plan,
    status = excluded.status,
    submitted_at = case when excluded.status = 'submitted' then coalesce(t.submitted_at, now()) else null end;

  perform public.prodops_log('daily_report', 'ops_daily_reports', v_id, v_job,
    jsonb_build_object('date', v_date, 'status', v_status));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;

-- المونتير يحرّك تسليمه هو فقط.
create or replace function public.prodops_post_handoff_progress(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_job uuid; v_to uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in ('accepted','in_progress','returned','done') then
    raise exception 'invalid_status';
  end if;
  select job_id, handed_to_user_id into v_job, v_to
    from public.ops_post_handoff where id = p_id and is_deleted = false;
  if v_job is null then raise exception 'row_not_found'; end if;
  if not (v_to = auth.uid() or coalesce(public.prodops_can_manage(), false)) then
    raise exception 'not authorized';
  end if;

  update public.ops_post_handoff
     set status = p_status,
         accepted_at = case when p_status = 'accepted' and accepted_at is null then now() else accepted_at end,
         done_at     = case when p_status = 'done'     and done_at     is null then now() else done_at     end,
         editor_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), editor_note)
   where id = p_id and is_deleted = false;
  perform public.prodops_log('post_handoff_progress', 'ops_post_handoff', p_id, v_job,
    jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;

-- خطوة النسخ الاحتياطي: أوّلية · ثانية · NAS · تحقُّق.
-- التحقّق لا يُعلَّم قبل وجود نسختين — القيد في الجدول يمنع الالتفاف.
create or replace function public.prodops_backup_step(
  p_card uuid, p_step text, p_done boolean default true, p_path text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_job uuid; v_holder uuid; v_manage boolean; v_row public.ops_media_backups%rowtype;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_step is null or p_step not in ('primary','second','nas','verified') then raise exception 'invalid_step'; end if;
  select job_id, holder_user_id into v_job, v_holder
    from public.ops_media_cards where id = p_card and is_deleted = false;
  if v_job is null then raise exception 'card_not_found'; end if;
  v_manage := coalesce(public.prodops_can_manage(), false);
  -- بوّابة الموديول: المدير أو أحد طاقم المهمّة. غيرهما لا يصل أصلًا.
  if not (v_manage or coalesce(public.prodops_is_crew(v_job), false)) then
    raise exception 'not authorized';
  end if;
  -- ★ التوقيع شخصيّ: زميلٌ في الطاقم لا يوقّع نسخ بطاقة غيره ولا يُعلّم تحقّقها.
  --   «كوني ضمن الطاقم» تُدخلني المهمّة، ولا تجعلني حاملَ كلّ بطاقة فيها.
  --   بطاقة بلا حامل مُسجَّل: المدير وحده — لأنّ المسؤولية عنها غير مُسنَدة.
  if not v_manage and (v_holder is null or v_holder <> auth.uid()) then
    return jsonb_build_object('ok', false, 'card_id', p_card, 'step', p_step,
      'reason','not_card_holder',
      'message','هذه البطاقة ليست بعهدتك. لا يُسجّل خطوات نسخها ولا يُعلّم تحقّقها إلّا حاملها أو مدير التشغيل.');
  end if;

  -- بلا هدف صريح: uq_ops_backup_card فهرس **جزئيّ**، واستنتاجه بـ(card_id) وحده يفشل.
  insert into public.ops_media_backups (job_id, card_id, updated_by)
  values (v_job, p_card, auth.uid()) on conflict do nothing;

  -- القيد ops_backup_verify_needs_two سيرفض التحقّق قبل نسختين، لكنّه سيخرج
  -- كـ23514 خامًا. نقولها بالعربية أوّلًا — الرفض نفسه يبقى في القاعدة لا هنا.
  if p_step = 'verified' and coalesce(p_done, true) then
    select * into v_row from public.ops_media_backups where card_id = p_card;
    if not (coalesce(v_row.primary_done, false) and coalesce(v_row.second_done, false)) then
      return jsonb_build_object('ok', false, 'card_id', p_card, 'reason','needs_two_copies',
        'message','لا يُعلَّم التحقّق قبل تسجيل نسختين فعليًّا (الأولى والثانية).');
    end if;
  end if;

  update public.ops_media_backups set
    primary_done = case when p_step = 'primary'  then coalesce(p_done, true) else primary_done end,
    primary_at   = case when p_step = 'primary'  then (case when coalesce(p_done, true) then now() else null end) else primary_at end,
    primary_path = case when p_step = 'primary'  then coalesce(nullif(btrim(coalesce(p_path,'')),''), primary_path) else primary_path end,
    second_done  = case when p_step = 'second'   then coalesce(p_done, true) else second_done end,
    second_at    = case when p_step = 'second'   then (case when coalesce(p_done, true) then now() else null end) else second_at end,
    second_path  = case when p_step = 'second'   then coalesce(nullif(btrim(coalesce(p_path,'')),''), second_path) else second_path end,
    nas_done     = case when p_step = 'nas'      then coalesce(p_done, true) else nas_done end,
    nas_at       = case when p_step = 'nas'      then (case when coalesce(p_done, true) then now() else null end) else nas_at end,
    nas_path     = case when p_step = 'nas'      then coalesce(nullif(btrim(coalesce(p_path,'')),''), nas_path) else nas_path end,
    verified     = case when p_step = 'verified' then coalesce(p_done, true) else verified end,
    verified_at  = case when p_step = 'verified' then (case when coalesce(p_done, true) then now() else null end) else verified_at end,
    verified_by  = case when p_step = 'verified' then (case when coalesce(p_done, true) then auth.uid() else null end) else verified_by end,
    verify_note  = case when p_step = 'verified' then coalesce(nullif(btrim(coalesce(p_path,'')),''), verify_note) else verify_note end,
    updated_by   = auth.uid()
  where card_id = p_card
  returning * into v_row;

  -- انعكاس حالة البطاقة على الواقع لا على النيّة.
  update public.ops_media_cards
     set status = case when v_row.verified then 'verified'
                       when v_row.primary_done then 'offloaded'
                       else status end
   where id = p_card and is_deleted = false and status not in ('formatted','lost');

  perform public.prodops_log('backup_step', 'ops_media_backups', v_row.id, v_job,
    jsonb_build_object('card_id', p_card, 'step', p_step, 'done', coalesce(p_done, true)));
  return jsonb_build_object('ok', true, 'card_id', p_card, 'step', p_step,
    'primary_done', v_row.primary_done, 'second_done', v_row.second_done,
    'nas_done', v_row.nas_done, 'verified', v_row.verified);
end $$;

create or replace function public.prodops_location_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_manage(), false) then raise exception 'not authorized'; end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.ops_locations as t (id, name, kind, address, city, map_url, lat, lng,
    contact_name, contact_phone, contact_role, contact_note, access_notes, parking_notes, is_active, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'name','')), ''), 'موقع'),
    coalesce(nullif(btrim(coalesce(p->>'kind','')), ''), 'other'),
    nullif(btrim(coalesce(p->>'address','')), ''), nullif(btrim(coalesce(p->>'city','')), ''),
    nullif(btrim(coalesce(p->>'map_url','')), ''),
    nullif(btrim(coalesce(p->>'lat','')), '')::double precision,
    nullif(btrim(coalesce(p->>'lng','')), '')::double precision,
    nullif(btrim(coalesce(p->>'contact_name','')), ''), nullif(btrim(coalesce(p->>'contact_phone','')), ''),
    nullif(btrim(coalesce(p->>'contact_role','')), ''), nullif(btrim(coalesce(p->>'contact_note','')), ''),
    nullif(btrim(coalesce(p->>'access_notes','')), ''), nullif(btrim(coalesce(p->>'parking_notes','')), ''),
    coalesce((p->>'is_active')::boolean, true), auth.uid())
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, address = excluded.address, city = excluded.city,
    map_url = excluded.map_url, lat = excluded.lat, lng = excluded.lng,
    contact_name = excluded.contact_name, contact_phone = excluded.contact_phone,
    contact_role = excluded.contact_role, contact_note = excluded.contact_note,
    access_notes = excluded.access_notes, parking_notes = excluded.parking_notes,
    is_active = excluded.is_active, is_deleted = false;
  perform public.prodops_log('location_upsert', 'ops_locations', v_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.prodops_vehicle_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.prodops_can_manage(), false) then raise exception 'not authorized'; end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.ops_vehicles as t (id, label, plate_no, vehicle_type, seats, notes, is_active, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'label','')), ''), 'مركبة'),
    nullif(btrim(coalesce(p->>'plate_no','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'vehicle_type','')), ''), 'car'),
    nullif(btrim(coalesce(p->>'seats','')), '')::int,
    nullif(btrim(coalesce(p->>'notes','')), ''),
    coalesce((p->>'is_active')::boolean, true), auth.uid())
  on conflict (id) do update set
    label = excluded.label, plate_no = excluded.plate_no, vehicle_type = excluded.vehicle_type,
    seats = excluded.seats, notes = excluded.notes, is_active = excluded.is_active, is_deleted = false;
  perform public.prodops_log('vehicle_upsert', 'ops_vehicles', v_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.prodops_call_sheet_publish(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_job uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select job_id into v_job from public.ops_call_sheets where id = p_id and is_deleted = false;
  if v_job is null then raise exception 'row_not_found'; end if;
  if not coalesce(public.prodops_can_edit_job(v_job), false) then raise exception 'not authorized'; end if;
  update public.ops_call_sheets
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_id and is_deleted = false and status = 'draft';
  if not found then
    return jsonb_build_object('ok', false, 'reason','already_published',
      'message','الورقة منشورة أصلًا. أنشئ نسخة جديدة بدل تعديل المنشورة.');
  end if;
  perform public.prodops_log('call_sheet_publish', 'ops_call_sheets', p_id, v_job, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) الصلاحيات — لا شيء لـanon، أبدًا. الجداول قراءة فقط عبر RLS.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  -- (أ) الدوالّ العامّة: authenticated فقط.
  foreach f in array array[
    'public.prodops_access()',
    'public.prodops_jobs_list(jsonb)',
    'public.prodops_job_detail(uuid)',
    'public.prodops_readiness(uuid)',
    'public.prodops_my_assignments(jsonb)',
    'public.prodops_calendar(date,date,jsonb)',
    'public.prodops_conflicts(jsonb)',
    'public.prodops_call_sheet(uuid,date)',
    'public.prodops_lookups()',
    'public.prodops_dashboard(jsonb)',
    'public.prodops_job_upsert(jsonb)',
    'public.prodops_job_set_status(uuid,text,text)',
    'public.prodops_job_delete(uuid,text)',
    'public.prodops_child_upsert(text,jsonb)',
    'public.prodops_child_delete(text,uuid,text)',
    'public.prodops_hse_seed(uuid)',
    'public.prodops_confirm_attendance(uuid,text,text)',
    'public.prodops_daily_report_upsert(jsonb)',
    'public.prodops_post_handoff_progress(uuid,text,text)',
    'public.prodops_backup_step(uuid,text,boolean,text)',
    'public.prodops_location_upsert(jsonb)',
    'public.prodops_vehicle_upsert(jsonb)',
    'public.prodops_call_sheet_publish(uuid)',
    -- المُسنَدات: تُقيَّم داخل سياسات RLS بدور المُنادي، فلا بدّ من EXECUTE له.
    'public.prodops_can_view()',
    'public.prodops_can_manage()',
    'public.prodops_is_client()',
    'public.prodops_can_read_job(uuid)',
    'public.prodops_can_edit_job(uuid)',
    'public.prodops_is_crew(uuid)',
    'public.prodops_is_post_assignee(uuid)',
    'public.prodops_perm(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ب) الدوالّ الداخلية: لا تُمنح لأحد — تُنفَّذ ضمن سلسلة SECURITY DEFINER فقط.
  foreach f in array array[
    'public.prodops_conflicts_core(timestamptz,timestamptz,uuid)',
    'public.prodops_external_conflicts(timestamptz,timestamptz)',
    -- حرّاس §7B: تُستدعى من المُشغِّلات فقط. لا يد للواجهة عليها، ولا التفاف حولها.
    'public.prodops_person_clash(uuid,uuid,timestamptz,timestamptz)',
    'public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)',
    'public.prodops_location_clash(uuid,uuid,timestamptz,timestamptz)',
    'public.prodops_guard_crew()',
    'public.prodops_guard_equipment()',
    'public.prodops_guard_job()',
    'public.prodops_readiness_core(uuid)',
    'public.prodops_visible_jobs()',
    'public.prodops_project_label(uuid)',
    'public.prodops_next_job_code()',
    'public.prodops_log(text,text,uuid,uuid,jsonb)',
    'public.prodops_notify(uuid,text,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ج) الجداول: قراءة فقط لـauthenticated (وRLS هي الفاصل)، ولا شيء لـanon.
  foreach t in array array['ops_locations','ops_vehicles','ops_jobs','ops_job_crew','ops_job_equipment',
    'ops_job_permits','ops_job_travel','ops_job_accommodation','ops_job_vehicles','ops_job_hse',
    'ops_job_weather','ops_media_cards','ops_media_backups','ops_ingest_jobs','ops_post_handoff',
    'ops_daily_reports','ops_incidents','ops_delays','ops_call_sheets','ops_audit'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;

  execute 'revoke all on sequence public.ops_job_code_seq from public';
  begin execute 'revoke all on sequence public.ops_job_code_seq from anon'; exception when undefined_object then null; end;
  begin execute 'revoke all on sequence public.ops_job_code_seq from authenticated'; exception when undefined_object then null; end;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) SELF-TEST — ثابت. لا يستدعي دالّة محميّة (auth.uid() = NULL في المحرّر)،
--      ولا يلتفّ حول فحص بمصيدة تجعله ينجح مهما حدث. الفشل يُلغي المعاملة.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare t text; f text; v_def text; v jsonb; v_b boolean; v_n bigint;
  v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- (1) الجداول العشرون
  foreach t in array array['ops_locations','ops_vehicles','ops_jobs','ops_job_crew','ops_job_equipment',
    'ops_job_permits','ops_job_travel','ops_job_accommodation','ops_job_vehicles','ops_job_hse',
    'ops_job_weather','ops_media_cards','ops_media_backups','ops_ingest_jobs','ops_post_handoff',
    'ops_daily_reports','ops_incidents','ops_delays','ops_call_sheets','ops_audit'] loop
    if to_regclass('public.' || t) is null then raise exception 'OPS SELF-TEST: الجدول % لم يُنشأ', t; end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'OPS SELF-TEST: RLS غير مفعّلة على %', t;
    end if;
    -- لا سياسة كتابة مباشرة على أيّ جدول
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT') then
      raise exception 'OPS SELF-TEST: توجد سياسة كتابة مباشرة على % — الكتابة يجب أن تمرّ بـRPC', t;
    end if;
    -- لا صلاحية anon على أيّ جدول
    if exists (select 1 from information_schema.role_table_grants
                where table_schema = 'public' and table_name = t and grantee = 'anon') then
      raise exception 'OPS SELF-TEST: anon يملك صلاحية على %', t;
    end if;
  end loop;

  -- (2) الدوالّ كلّها أُنشئت
  foreach f in array array[
    'public.prodops_access()','public.prodops_jobs_list(jsonb)','public.prodops_job_detail(uuid)',
    'public.prodops_readiness(uuid)','public.prodops_my_assignments(jsonb)',
    'public.prodops_calendar(date,date,jsonb)','public.prodops_conflicts(jsonb)',
    'public.prodops_call_sheet(uuid,date)','public.prodops_lookups()','public.prodops_dashboard(jsonb)',
    'public.prodops_job_upsert(jsonb)','public.prodops_job_set_status(uuid,text,text)',
    'public.prodops_job_delete(uuid,text)','public.prodops_child_upsert(text,jsonb)',
    'public.prodops_child_delete(text,uuid,text)','public.prodops_hse_seed(uuid)',
    'public.prodops_confirm_attendance(uuid,text,text)','public.prodops_daily_report_upsert(jsonb)',
    'public.prodops_post_handoff_progress(uuid,text,text)',
    'public.prodops_backup_step(uuid,text,boolean,text)','public.prodops_location_upsert(jsonb)',
    'public.prodops_vehicle_upsert(jsonb)','public.prodops_call_sheet_publish(uuid)',
    'public.prodops_can_view()','public.prodops_can_manage()','public.prodops_can_read_job(uuid)',
    'public.prodops_can_edit_job(uuid)','public.prodops_is_crew(uuid)','public.prodops_perm(text)',
    'public.prodops_readiness_core(uuid)','public.prodops_conflicts_core(timestamptz,timestamptz,uuid)',
    'public.prodops_external_conflicts(timestamptz,timestamptz)'
  ] loop
    if to_regprocedure(f) is null then raise exception 'OPS SELF-TEST: الدالّة % لم تُنشأ', f; end if;
    if v_anon and has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'OPS SELF-TEST: anon يملك EXECUTE على %', f;
    end if;
  end loop;

  -- (3) المُسنَدات لا تعيد NULL — **استدعاء حيّ آمن**: لا بوّابة فيها، وauth.uid()
  --     يساوي NULL هنا، فالنتيجة الصحيحة false. لو أعادت NULL انهار fail-closed.
  v_b := public.prodops_can_view();    if v_b is null then raise exception 'OPS SELF-TEST: can_view أعادت NULL'; end if;
  if v_b then raise exception 'OPS SELF-TEST: can_view = true بلا جلسة — fail-open'; end if;
  v_b := public.prodops_can_manage();  if v_b is null then raise exception 'OPS SELF-TEST: can_manage أعادت NULL'; end if;
  if v_b then raise exception 'OPS SELF-TEST: can_manage = true بلا جلسة — fail-open'; end if;
  v_b := public.prodops_can_read_job(ZERO); if v_b is null then raise exception 'OPS SELF-TEST: can_read_job أعادت NULL'; end if;
  if v_b then raise exception 'OPS SELF-TEST: can_read_job = true بلا جلسة'; end if;
  v_b := public.prodops_can_edit_job(ZERO); if v_b is null then raise exception 'OPS SELF-TEST: can_edit_job أعادت NULL'; end if;
  v_b := public.prodops_can_read_job(null); if v_b is null then raise exception 'OPS SELF-TEST: can_read_job(NULL) أعادت NULL'; end if;
  v_b := public.prodops_is_crew(ZERO);  if v_b is null then raise exception 'OPS SELF-TEST: is_crew أعادت NULL'; end if;
  v_b := public.prodops_perm('operations.manage'); if v_b is null then raise exception 'OPS SELF-TEST: perm أعادت NULL'; end if;
  if v_b then raise exception 'OPS SELF-TEST: perm = true بلا جلسة'; end if;
  v_b := public.prodops_is_client();   if v_b is null then raise exception 'OPS SELF-TEST: is_client أعادت NULL'; end if;

  -- (4) مِجَسّ الكشف يعمل بلا جلسة ويعلن انعدام القدرة (لا يتظاهر بالنجاح)
  v := public.prodops_access();
  if coalesce((v->>'ok')::boolean, false) is not true then raise exception 'OPS SELF-TEST: access لم تُرجع ok'; end if;
  if coalesce((v->>'can_view')::boolean, true) is not false then
    raise exception 'OPS SELF-TEST: access تمنح can_view بلا جلسة'; end if;

  -- (5) بوّابات مكتوبة فعلًا داخل كلّ دالّة كتابة (فحص نصّيّ لا استدعاء حيّ)
  foreach f in array array[
    'public.prodops_job_upsert(jsonb)','public.prodops_job_set_status(uuid,text,text)',
    'public.prodops_job_delete(uuid,text)','public.prodops_child_upsert(text,jsonb)',
    'public.prodops_child_delete(text,uuid,text)','public.prodops_hse_seed(uuid)',
    'public.prodops_confirm_attendance(uuid,text,text)','public.prodops_daily_report_upsert(jsonb)',
    'public.prodops_post_handoff_progress(uuid,text,text)',
    'public.prodops_backup_step(uuid,text,boolean,text)','public.prodops_location_upsert(jsonb)',
    'public.prodops_vehicle_upsert(jsonb)','public.prodops_call_sheet_publish(uuid)'
  ] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%auth.uid() is null%' then
      raise exception 'OPS SELF-TEST: % بلا بوّابة جلسة', f; end if;
    if v_def not ilike '%not authorized%' then
      raise exception 'OPS SELF-TEST: % لا ترفع منعًا صريحًا', f; end if;
    if v_def not ilike '%security definer%' then
      raise exception 'OPS SELF-TEST: % ليست SECURITY DEFINER', f; end if;
    if v_def not ilike '%search_path%' then
      raise exception 'OPS SELF-TEST: % بلا search_path مثبَّت', f; end if;
  end loop;

  -- (6) العميل ممنوع بنيويًّا: بوّابة العرض تشترط is_staff ولا تُبنى على المشاريع
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_can_view()'));
  if v_def not ilike '%is_staff%' then
    raise exception 'OPS SELF-TEST: بوّابة العرض لا تستبعد العميل'; end if;
  foreach f in array array['public.prodops_can_view()','public.prodops_can_manage()',
                           'public.prodops_can_read_job(uuid)','public.prodops_can_edit_job(uuid)'] loop
    if pg_get_functiondef(to_regprocedure(f)) ilike '%can_manage_projects%' then
      raise exception 'OPS SELF-TEST: % تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته', f;
    end if;
  end loop;

  -- (7) الخدمة الذاتية مقيّدة بصاحب الجلسة لا بفلتر من الواجهة
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_confirm_attendance(uuid,text,text)'));
  if v_def not ilike '%user_id = auth.uid()%' then
    raise exception 'OPS SELF-TEST: تأكيد الحضور غير مقيّد بصاحب الجلسة — تأكيد نيابةً ممكن'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_daily_report_upsert(jsonb)'));
  if v_def not ilike '%v_owner <> auth.uid()%' then
    raise exception 'OPS SELF-TEST: التقرير اليوميّ يسمح بتحرير تقرير غيرك'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_post_handoff_progress(uuid,text,text)'));
  if v_def not ilike '%v_to = auth.uid()%' then
    raise exception 'OPS SELF-TEST: تسليم ما بعد الإنتاج غير مقيّد بالمُسنَد إليه'; end if;

  -- (8) ★ حارس تجميد منصّة المشاريع ★ — لا دالّة من الموديول تكتب في المنصّة.
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'prodops%'
  loop
    if v_def ~* 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal)\b'
    or v_def ~* 'update\s+public\.(projects|project_core|deliverables|deliverable_internal)\b'
    or v_def ~* 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal)\b' then
      raise exception 'OPS SELF-TEST: دالّة تكتب في منصّة المشاريع المجمَّدة';
    end if;
  end loop;

  -- (9) الطقس Placeholder: القيد يمنع ادّعاء مصدر آليّ
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ops_job_weather'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) ilike '%manual%') then
    raise exception 'OPS SELF-TEST: قيد مصدر الطقس غائب'; end if;
  if pg_get_functiondef(to_regprocedure('public.prodops_child_upsert(text,jsonb)')) !~* $$'manual'$$ then
    raise exception 'OPS SELF-TEST: كتابة الطقس لا تُثبّت المصدر اليدويّ'; end if;

  -- (10) التحقّق من النسخ لا يُعلَّم قبل نسختين — قيد لا نيّة
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ops_media_backups'::regclass
                    and conname = 'ops_backup_verify_needs_two') then
    raise exception 'OPS SELF-TEST: قيد «التحقّق يتطلّب نسختين» غائب'; end if;
  -- والرسالة العربية قبل القيد الخام (القيد يبقى هو الفاصل، لا الرسالة)
  if pg_get_functiondef(to_regprocedure('public.prodops_backup_step(uuid,text,boolean,text)'))
       not ilike '%needs_two_copies%' then
    raise exception 'OPS SELF-TEST: خطوة التحقّق بلا رفض مفهوم قبل القيد الخام'; end if;

  -- (11) الترحيلة لا تُنشئ بيانات تشغيلية
  select count(*) into v_n from public.ops_jobs;
  if v_n <> 0 then raise exception 'OPS SELF-TEST: الترحيلة أنشأت % مهمّة — يجب ألّا تُنشئ شيئًا', v_n; end if;
  select count(*) into v_n from public.ops_audit;
  if v_n <> 0 then raise exception 'OPS SELF-TEST: الترحيلة كتبت في سجلّ التدقيق'; end if;

  -- (12) التدقيق مكتوب فعلًا في كلّ كتابة حسّاسة
  foreach f in array array[
    'public.prodops_job_upsert(jsonb)','public.prodops_job_set_status(uuid,text,text)',
    'public.prodops_job_delete(uuid,text)','public.prodops_child_upsert(text,jsonb)',
    'public.prodops_child_delete(text,uuid,text)','public.prodops_confirm_attendance(uuid,text,text)',
    'public.prodops_daily_report_upsert(jsonb)','public.prodops_post_handoff_progress(uuid,text,text)',
    'public.prodops_backup_step(uuid,text,boolean,text)','public.prodops_call_sheet_publish(uuid)'
  ] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%prodops_log%' then
      raise exception 'OPS SELF-TEST: % بلا تدقيق', f;
    end if;
  end loop;

  -- (13) الجاهزية مشتقّة: لا عمود score محفوظ يمكن أن ينحرف
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ops_jobs'
                and column_name in ('readiness_score','readiness')) then
    raise exception 'OPS SELF-TEST: درجة الجاهزية محفوظة كعمود — يجب أن تبقى مشتقّة'; end if;
  v := public.prodops_readiness_core(ZERO);
  if coalesce(v->>'reason','') <> 'job_not_found' then
    raise exception 'OPS SELF-TEST: الجاهزية لا تُبلّغ عن مهمّة غير موجودة بصدق'; end if;

  -- (14) محرّك التعارضات يعمل على قاعدة فارغة ويعيد مصفوفة لا NULL
  v := public.prodops_conflicts_core(now() - interval '1 day', now() + interval '1 day', null);
  if v is null or jsonb_typeof(v) <> 'array' then
    raise exception 'OPS SELF-TEST: محرّك التعارضات لا يعيد مصفوفة'; end if;
  v := public.prodops_external_conflicts(now() - interval '1 day', now() + interval '1 day');
  if v is null or (v->'sources') is null then
    raise exception 'OPS SELF-TEST: المسح الخارجيّ لا يُعلن حالة مصادره'; end if;

  -- (15) ★ منع الحجز المزدوج موجود كمُشغِّل على الجدول، لا كتحذير في الشاشة.
  foreach f in array array[
    'trg_ops_crew_no_double_booking:ops_job_crew',
    'trg_ops_equip_no_double_booking:ops_job_equipment',
    'trg_ops_job_no_double_booking:ops_jobs'
  ] loop
    if not exists (select 1 from pg_trigger g
                    where g.tgrelid = ('public.' || split_part(f, ':', 2))::regclass
                      and g.tgname = split_part(f, ':', 1) and not g.tgisinternal) then
      raise exception 'OPS SELF-TEST: مُشغِّل منع الحجز المزدوج % غائب — المنع صار تحذيرًا فقط', f;
    end if;
  end loop;
  foreach f in array array[
    'public.prodops_guard_crew()','public.prodops_guard_equipment()','public.prodops_guard_job()'
  ] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%23P01%' then
      raise exception 'OPS SELF-TEST: % لا يرفع رمز تعارض مميّزًا', f; end if;
    if v_def not ilike '%ops_double_booking%' then
      raise exception 'OPS SELF-TEST: % بلا رسالة رفض صريحة', f; end if;
  end loop;
  -- الحارس يعمل على قاعدة فارغة ويعيد NULL (لا تعارض) بدل أن ينفجر
  if public.prodops_person_clash(ZERO, ZERO, now(), now() + interval '1 hour') is not null
     or public.prodops_asset_clash(ZERO, ZERO, now(), now() + interval '1 hour') is not null
     or public.prodops_location_clash(ZERO, ZERO, now(), now() + interval '1 hour') is not null then
    raise exception 'OPS SELF-TEST: كاشف التعارض يدّعي تعارضًا على قاعدة فارغة';
  end if;
  -- الطبقة الأعلى تترجم 23P01 ولا تبتلعه، وفي الوقت نفسه لا تبتلع «ممنوع»
  foreach f in array array[
    'public.prodops_child_upsert(text,jsonb)','public.prodops_job_upsert(jsonb)',
    'public.prodops_job_set_status(uuid,text,text)'
  ] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%23P01%' or v_def not ilike '%double_booked%' then
      raise exception 'OPS SELF-TEST: % لا تُترجم رفض الحجز المزدوج', f; end if;
    -- النمط مكتوب متقطّعًا عمدًا كي لا يُطابق نفسه في فحوص المستودع النصّية.
    if v_def ilike '%exception when%others%then%return%' then
      raise exception 'OPS SELF-TEST: % تبتلع كلّ الأخطاء — «ممنوع» سيظهر كنجاح', f; end if;
  end loop;

  -- (16) ★ توقيع النسخ الاحتياطي شخصيّ: حاملُ البطاقة أو المدير، لا أيّ زميل
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_backup_step(uuid,text,boolean,text)'));
  if v_def not ilike '%holder_user_id%' or v_def not ilike '%not_card_holder%' then
    raise exception 'OPS SELF-TEST: خطوة النسخ لا تتحقّق من حامل البطاقة — زميل يوقّع نيابةً عن غيره';
  end if;
  if v_def not ilike '%verified_by%' or v_def not ilike '%auth.uid()%' then
    raise exception 'OPS SELF-TEST: مُوقِّع التحقّق لا يُؤخذ من الجلسة'; end if;

  -- (17) ★ الإشعار لا يُفقد بصمت ★
  --      (أ) القيد يقبل entity_type الخاصّ بهذا الموديول فعلًا.
  --      يُفحص **كلّ** قيد CHECK يقيّد entity_type مهما كان اسمه: قيدٌ منجرف
  --      الاسم يرفض بصمت بينما يبدو القيد القانونيّ سليمًا.
  select coalesce(string_agg(pg_get_constraintdef(con.oid), ' | '), '') into v_def
    from pg_constraint con
   where con.conrelid = to_regclass('public.notifications')
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%entity_type%'
     and pg_get_constraintdef(con.oid) not ilike '%~%'
     and pg_get_constraintdef(con.oid) not ilike '%ops_job%';
  if v_def <> '' then
    raise exception 'OPS SELF-TEST: قيد على notifications.entity_type ما زال تعدادًا لا يقبل ops_job (%). كلّ إشعار تشغيل سيُرفض ويُبتلَع. نظّف الصفوف المخالفة للشكل ثمّ أعد التشغيل.', v_def;
  end if;
  --      (ب) والمصيدة تكتب أثرًا بدل أن تبتلع.
  v_def := pg_get_functiondef(to_regprocedure('public.prodops_notify(uuid,text,uuid,text,text)'));
  if v_def not ilike '%notify_failed%' then
    raise exception 'OPS SELF-TEST: فشل الإشعار يُبتلَع بلا أثر — «لم يصل الإشعار» يبقى سؤالًا بلا جواب'; end if;

  raise notice 'OPS SELF-TEST: نجح — 20 جدولًا، RLS قراءة فقط، لا anon، مُسنَدات لا تعيد NULL، منع الحجز المزدوج بمُشغِّل، الإشعار لا يُفقد بصمت، والمنصّة لم تُمَسّ.';
end $st$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: operations_center_POSTCHECK.sql
-- منح مدير التشغيل: امنح المهنة (أو الموظّف) المفتاح operations.manage من شاشة
--   الصلاحيات — لا يُمنح تلقائيًّا هنا، ولا يُشتقّ من دور مشاريع.
-- ════════════════════════════════════════════════════════════════════════════




