-- ════════════════════════════════════════════════════════════════════════════
-- LIVE OPERATIONS DASHBOARD — RUNME  (idempotent · transactional · additive)
--   لوحة العمليات المباشرة: البثّ والفعاليات والمؤتمرات والعمل الميدانيّ
--   متعدّد الكاميرات.
--
-- WHAT THIS IS
--   جلسة تشغيل مباشر واحدة تجمع: الحالة، الجرد الفنّيّ، صحّة الشبكة والبثّ،
--   الرَّنداون، الحوادث، السطح الآمن للعميل، وتقرير ما بعد الفعالية.
--   وحدة **قائمة بذاتها**: لا تعدّل منصّة المشاريع ولا مركز التشغيل ولا أيّ
--   وحدة من الوحدات الاثنتي عشرة المكتملة.
--
-- ─── ما لا تفعله هذه الحزمة (عمدًا وبنيويًّا) ──────────────────────────────
--   ⛔ لا اتصال بجهاز. لا تُقرأ كاميرا ولا مُرمِّز ولا مُوجِّه في V1 إطلاقًا.
--      كلّ رقم يُدخله إنسان. لذلك لا يوجد في هذا الملفّ أيّ مسار يُنتج قيمة
--      «حيّة»، و`liveops_stream_health.source` مقيَّد بقيم تقول ذلك صراحةً.
--   ⛔ لا مفتاح خدمة في المتصفّح. `liveops_client_view` — الدالّة الوحيدة التي
--      يلمسها طرف خارجيّ — لا تُمنَح لـanon ولا لـauthenticated، بل لـ
--      service_role وحده، وتُنادى من مسار خادم واحد.
--   ⛔ لا مفتاح بثّ ولا عنوان IP ولا مسار تخزين ولا رقم تسلسليّ ولا تكلفة ولا
--      ملاحظة داخلية تغادر القاعدة نحو العميل. المنع ليس «إخفاءً في الواجهة»:
--      حمولة العميل تُبنى من قائمة أعمدة بيضاء صريحة، **وفوقها** ماسح أنماط
--      يرفض الحفظ أصلًا (§7) قبل أن يصل النصّ إلى أيّ سطح.
--   ⛔ العميل لا يغيّر الحالة أبدًا. ثلاث طبقات: لا سياسة UPDATE له إطلاقًا،
--      والدالّة تشترط طاقمًا، ومُشغِّل BEFORE UPDATE يعيد الحساب من القاعدة
--      ويرفض — ويصمد حتّى لو أضاف أحدهم سياسة خاطئة لاحقًا.
--
-- ─── الصدق في الحالات (القاعدة التي تكسر أغلب لوحات البثّ) ────────────────
--   «غير متّصل» و«لا يوجد مُحوِّل» و«لم تُوصَل القياسات» ثلاثة أشياء مختلفة.
--   نفصلها: source ∈ {manual_status, adapter_unavailable, telemetry_not_connected,
--   telemetry_verified}، والأخيرة **مستحيلة بنيويًّا** بلا adapter_id (قيد
--   liveops_health_source_honest). و`uptime_basis` في التقرير لا يمكن أن يصير
--   telemetry_verified ما لم توجد قراءة موثَّقة فعلًا (مُشغِّل §12).
--
-- ⚠️ SELF-TESTS ثابتة بالكامل (§20). محرّر SQL يعمل بدور postgres وauth.uid()
--    = NULL، فنداء دالّة محميّة هنا يرفع «not authorized» ويقتل الترحيلة —
--    وقد كسر هذا ترحيلتين في هذا المستودع من قبل. كلّ فحص من pg_catalog.
--    ولا catch-all يجعل فحصًا ينجح مهما كان الواقع.
--
-- ⚠️ لا مفتاح أجنبيّ نحو public.projects ولا نحو public.ops_jobs. المرجعان
--    **قراءة فقط ونصّيًّا معرّف فقط**: مفتاح أجنبيّ كان سيمنع حذف مشروع أو
--    أمر عمل من وحدة أخرى، وهذا تعديل في سلوك وحدة مجمَّدة/مكتملة. التحقّق من
--    الوجود يجري في الدالّة (§10) باكتشاف ميزة، لا بقيد.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0  42P13 GUARD — دالّة liveops_* قائمة بنوع إرجاع مختلف لا يمكن استبدالها.
--     نفشل **مبكّرًا وبصوت عالٍ** بدل ترك نصف ترحيلة.
-- ════════════════════════════════════════════════════════════════════════════
do $g0$
declare r record; v_expected text;
begin
  for r in
    select p.proname as fname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as ret
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'liveops\_%'
  loop
    v_expected := case
      when r.fname in ('liveops_perm','liveops_is_client','liveops_can_view',
                       'liveops_can_manage','liveops_can_operate','liveops_can_operate_session',
                       'liveops_can_read_session','liveops_can_issue_client_link',
                       'liveops_can_reveal_root_cause','liveops_can_approve_report',
                       'liveops_status_allowed','liveops_has_secret','liveops_bool')
        then 'boolean'
      when r.fname in ('liveops_txt','liveops_secret_reason','liveops_default_client_status',
                       'liveops_status_label_ar','liveops_client_status_label_ar')
        then 'text'
      when r.fname in ('liveops_int') then 'integer'
      when r.fname in ('liveops_num') then 'numeric'
      when r.fname in ('liveops_ts') then 'timestamp with time zone'
      when r.fname in ('liveops_uuid') then 'uuid'
      when r.fname in ('liveops_log','liveops_notify') then 'void'
      when r.fname in ('liveops_session_guard','liveops_client_text_guard',
                       'liveops_report_uptime_guard','liveops_touch')
        then 'trigger'
      else 'jsonb'
    end;
    if r.ret <> v_expected then
      raise exception 'LIVEOPS 42P13: public.%(%) موجودة بنوع إرجاع % والمتوقّع % — احذفها قبل تشغيل هذا الملفّ',
        r.fname, r.args, r.ret, v_expected;
    end if;
  end loop;
end $g0$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1  المُسنَدات — كلّها boolean صريح ولا تعيد NULL أبدًا.
--     نبني على is_owner/is_admin/is_staff القائمة، وعلى محرّك الصلاحيات
--     الدقيقة حين يكون مطبَّقًا (اكتشاف ميزة، لا اعتماد صلب).
-- ════════════════════════════════════════════════════════════════════════════

-- مفتاح صلاحية دقيق. غياب المحرّك ⇒ false (fail closed)، لا استثناء.
create or replace function public.liveops_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then
  return false;                       -- محرّك معطوب ⇒ منع، لا فتح
end $$;

-- هل صاحب الجلسة **عميل/زائر**؟ سؤال حسّاس: الاتجاه الخطر هو معاملة عميل
-- كموظّف، فنُجيب بـtrue عند أيّ شكّ في هويّة موجودة. جلسة غير موجودة أصلًا
-- (auth.uid() = NULL) ليست عميلًا: هي «لا أحد»، وتُمنع بالمنح لا بهذا المسند.
create or replace function public.liveops_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    else coalesce(
      (select (p.account_type is distinct from 'admin') and p.staff_role is null
         from public.profiles p where p.id = auth.uid()),
      true)                            -- مستخدم بلا ملفّ ⇒ يُعامل كعميل
  end;
$$;

-- من يملك الوحدة كاملة: المالك أو الأدمن أو حامل المفتاح الصريح.
create or replace function public.liveops_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (coalesce(public.is_owner(), false)
      or coalesce(public.is_admin(), false)
      or coalesce(public.liveops_perm('live_ops.manage'), false)),
  false);
$$;

-- من يشغّل جلسة مباشرة (يبدّل حالة، يحدّث جردًا، يفتح حادثة).
create or replace function public.liveops_can_operate() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    coalesce(public.liveops_can_manage(), false)
    or (coalesce(public.is_staff(), false)
        and coalesce(public.liveops_perm('live_ops.operate'), false)),
  false);
$$;

-- من يفتح اللوحة أصلًا: **موظّف فقط**. العميل والزائر خارج البوّابة نهائيًّا،
-- وسطحهما الوحيد هو liveops_client_view برمز.
create or replace function public.liveops_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and (not coalesce(public.liveops_is_client(), true))
    and (coalesce(public.liveops_can_manage(), false)
      or coalesce(public.liveops_can_operate(), false)
      or (coalesce(public.is_staff(), false)
          and coalesce(public.liveops_perm('live_ops.view'), false))
      or coalesce(public.is_staff(), false)),
  false);
$$;

-- القراءة على مستوى الجلسة. اليوم = can_view، لكنّ وجودها كدالّة مستقلّة يترك
-- تضييق النطاق لاحقًا في مكان واحد بدل ٢٠ سياسة.
create or replace function public.liveops_can_read_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.liveops_can_view(), false)
     and coalesce(p_session is not null, false);
$$;

-- ⚠️ liveops_can_operate_session تعتمد على جدول الجلسات، ودالّة SQL يُفحَص جسمها
--    عند الإنشاء — فتعريفها هنا كان سيفشل بـ42P01. مكانها §3.1 بعد الجدول.

-- إصدار رابط عميل — أخطر فعل في الوحدة: يفتح سطحًا خارج الشركة.
create or replace function public.liveops_can_issue_client_link() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    coalesce(public.liveops_can_manage(), false)
    or (coalesce(public.is_staff(), false)
        and coalesce(public.liveops_perm('live_ops.client_link'), false)),
  false);
$$;

-- الإفراج عن السبب الجذريّ الداخليّ نحو العميل — قرار إداريّ لا تشغيليّ.
create or replace function public.liveops_can_reveal_root_cause() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.liveops_can_manage(), false);
$$;

-- اعتماد التقرير النهائيّ.
create or replace function public.liveops_can_approve_report() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    coalesce(public.liveops_can_manage(), false)
    or (coalesce(public.is_staff(), false)
        and coalesce(public.liveops_perm('live_ops.report_approve'), false)),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2  قارئات jsonb — تحويل صريح، ولا استثناء يقتل معاملة بسبب حقل نصّيّ سيّئ.
--
-- ⚠️ تسمية: مفتاح الإدخال هو **live_session_id** لا session_id. ثلاثة أشياء
--    مختلفة تمامًا تحمل الاسم الثاني في هذا المستودع: مطالبة المصادقة
--    (session_id في التوكن)، وجلسة التصوير (shoot_session_id)، وجلسة البثّ
--    هنا. حارس أمنيّ قائم (tests/mfa_client_s2.test.js) يمنع ظهور session_id
--    مجرّدًا في أيّ ملفّ واجهة، وهو حارس محقّ لا يُضعَّف من أجل وحدة جديدة.
--    عمود الجدول يبقى session_id — الحارس يخصّ الواجهة لا القاعدة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_txt(p jsonb, k text) returns text
language sql immutable as $$ select nullif(btrim(coalesce(p ->> k, '')), '') $$;

create or replace function public.liveops_bool(p jsonb, k text, d boolean default false) returns boolean
language sql immutable as $$
  select case when p ? k and jsonb_typeof(p -> k) = 'boolean' then (p ->> k)::boolean
              when p ->> k in ('true','t','1')  then true
              when p ->> k in ('false','f','0') then false
              else coalesce(d, false) end;
$$;

create or replace function public.liveops_int(p jsonb, k text) returns integer
language plpgsql immutable as $$
begin return nullif(btrim(coalesce(p ->> k,'')),'')::integer; exception when others then return null; end $$;

create or replace function public.liveops_num(p jsonb, k text) returns numeric
language plpgsql immutable as $$
begin return nullif(btrim(coalesce(p ->> k,'')),'')::numeric; exception when others then return null; end $$;

create or replace function public.liveops_ts(p jsonb, k text) returns timestamptz
language plpgsql immutable as $$
begin return nullif(btrim(coalesce(p ->> k,'')),'')::timestamptz; exception when others then return null; end $$;

create or replace function public.liveops_uuid(p jsonb, k text) returns uuid
language plpgsql immutable as $$
begin return nullif(btrim(coalesce(p ->> k,'')),'')::uuid; exception when others then return null; end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3  الجلسة — الكيان الجذر.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_sessions (
  id                     uuid primary key default gen_random_uuid(),
  session_code           text unique,
  title                  text not null check (length(btrim(title)) between 2 and 200),
  internal_ref           text,
  -- ⚠️ مرجعان **بلا مفتاح أجنبيّ** عمدًا (اقرأ ترويسة الملفّ).
  prodops_job_id         uuid,
  project_id             uuid,
  event_date             date,
  starts_at              timestamptz,
  expected_end_at        timestamptz,
  actual_start_at        timestamptz,
  actual_end_at          timestamptz,
  venue                  text,
  control_room           text,
  status                 text not null default 'draft'
    check (status in ('draft','readiness_review','ready','rehearsal','live','paused',
                      'degraded','interrupted','completed','post_event_review','archived')),
  -- مفردات العميل **أخشن عمدًا**: ليست ترجمة للحالة الداخلية بل طبقة منفصلة.
  -- «degraded» الداخلية لا تُسرّب تفصيل العطل؛ يقابلها on_air_with_issues فقط.
  client_status          text not null default 'scheduled'
    check (client_status in ('scheduled','preparing','on_air','paused',
                             'on_air_with_issues','interrupted','completed')),
  operations_manager_id  uuid references auth.users(id),
  broadcast_director_id  uuid references auth.users(id),
  technical_director_id  uuid references auth.users(id),
  primary_contact_name   text,
  primary_contact_phone  text,
  emergency_contact_name text,
  emergency_contact_phone text,
  internal_notes         text,
  client_notes           text,
  created_by             uuid references auth.users(id),
  updated_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint liveops_session_window check (
    expected_end_at is null or starts_at is null or expected_end_at > starts_at),
  constraint liveops_session_actual_window check (
    actual_end_at is null or actual_start_at is null or actual_end_at >= actual_start_at)
);
create index if not exists liveops_sessions_status_idx  on public.liveops_sessions(status, starts_at desc);
create index if not exists liveops_sessions_date_idx    on public.liveops_sessions(event_date desc);
create index if not exists liveops_sessions_project_idx on public.liveops_sessions(project_id) where project_id is not null;

-- ─── §3.1 المُسنَد الوحيد الذي يحتاج الجدول ───────────────────────────────
-- ★ التشغيل على مستوى الجلسة: مدير/مالك، أو مشغّل مُسنَد إلى هذه الجلسة بعينها،
--   أو حامل live_ops.operate. **العميل مستبعَد صراحةً في السطر الثاني** حتّى لو
--   مُنح مفتاحًا بالخطأ يومًا. لا يعيد NULL أبدًا.
create or replace function public.liveops_can_operate_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_session is null then false
    when coalesce(public.liveops_is_client(), true) then false
    when coalesce(public.liveops_can_manage(), false) then true
    when not coalesce(public.is_staff(), false) then false
    else coalesce(
      coalesce(public.liveops_perm('live_ops.operate'), false)
      or exists (select 1 from public.liveops_sessions s
                  where s.id = p_session
                    and auth.uid() in (s.operations_manager_id, s.broadcast_director_id,
                                       s.technical_director_id, s.created_by)),
      false)
  end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4  الجرد الفنّيّ — بند واحد لكلّ عنصر، بحالته وصحّته ومسؤوله.
--     ⛔ لا اتصال بجهاز: كلّ تحديث هنا يدويّ (أو عبر مُحوِّل مستقبليّ).
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_inventory (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.liveops_sessions(id) on delete cascade,
  category       text not null check (category in (
                   'camera','operator','audio_source','switcher','encoder','stream_destination',
                   'recorder','graphics','playback','intercom','internet_primary','internet_backup',
                   'power','ups_generator','recording_media','backup_recording','monitoring')),
  label          text not null check (length(btrim(label)) between 1 and 120),
  item_role      text,
  assigned_user_id uuid references auth.users(id),
  assigned_name  text,
  tech_status    text not null default 'unknown'
    check (tech_status in ('unknown','ready','active','standby','warning','degraded','offline','failed','recovered')),
  health         text not null default 'unknown'
    check (health in ('unknown','ok','warning','critical')),
  last_checked_at timestamptz,
  last_checked_by uuid references auth.users(id),
  issue          text,
  -- الافتراض false: عنصر لا يُرى إلّا بقرار صريح. الافتراض المعاكس يُسرّب
  -- بالنسيان، وهو ما يجعل «الإخفاء» ضعيفًا بينما «عدم الإظهار» قويّ.
  client_visible boolean not null default false,
  internal_notes text,
  sort_order     int not null default 0,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists liveops_inventory_session_idx on public.liveops_inventory(session_id, category, sort_order);

-- ════════════════════════════════════════════════════════════════════════════
-- §5  صحّة الشبكة والبثّ — قراءات، لا قياسات حيّة.
--
--   ★ القيد liveops_health_source_honest هو جوهر الوحدة: لا يمكن لصفّ أن يدّعي
--     telemetry_verified بلا مُحوِّل مسمّى. في V1 لا مُحوِّل، فالادّعاء مستحيل
--     بنيويًّا — لا بالاتفاق ولا بحسن النيّة.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_stream_health (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.liveops_sessions(id) on delete cascade,
  at                 timestamptz not null default now(),
  connection         text not null default 'primary' check (connection in ('primary','backup')),
  upload_kbps        integer check (upload_kbps is null or upload_kbps >= 0),
  latency_ms         integer check (latency_ms is null or latency_ms >= 0),
  packet_loss_pct    numeric(5,2) check (packet_loss_pct is null or (packet_loss_pct >= 0 and packet_loss_pct <= 100)),
  current_bitrate_kbps integer check (current_bitrate_kbps is null or current_bitrate_kbps >= 0),
  target_bitrate_kbps  integer check (target_bitrate_kbps is null or target_bitrate_kbps >= 0),
  encoder_state      text not null default 'unknown'
    check (encoder_state in ('unknown','ready','active','standby','warning','degraded','offline','failed','recovered')),
  destination_state  text not null default 'unknown'
    check (destination_state in ('unknown','ready','active','standby','warning','degraded','offline','failed','recovered')),
  recording_state    text not null default 'unknown'
    check (recording_state in ('unknown','ready','active','standby','warning','degraded','offline','failed','recovered')),
  failover_active    boolean not null default false,
  source             text not null default 'manual_status'
    check (source in ('manual_status','adapter_unavailable','telemetry_not_connected','telemetry_verified')),
  adapter_id         text,
  last_verified_at   timestamptz,
  recorded_by        uuid references auth.users(id),
  note               text,
  created_at         timestamptz not null default now(),
  constraint liveops_health_source_honest check (source <> 'telemetry_verified' or adapter_id is not null),
  -- قراءة يدوية لا يجوز أن تحمل معرّف مُحوِّل: ذلك يخلط اليد بالآلة.
  constraint liveops_health_manual_no_adapter check (source <> 'manual_status' or adapter_id is null)
);
create index if not exists liveops_health_session_idx on public.liveops_stream_health(session_id, at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- §6  الرَّنداون + سجلّ الإشارات اليدويّ.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_rundown (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.liveops_sessions(id) on delete cascade,
  item_no        integer not null check (item_no > 0),
  scheduled_at   timestamptz,
  actual_at      timestamptz,
  title          text not null check (length(btrim(title)) between 1 and 200),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  speaker        text,
  media          text,
  camera_plan    text,
  graphics_cue   text,
  audio_cue      text,
  notes          text,
  status         text not null default 'planned'
    check (status in ('planned','ready','on_air','completed','delayed','skipped','changed')),
  delay_seconds  integer not null default 0,
  client_visible boolean not null default false,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, item_no)
);
create index if not exists liveops_rundown_session_idx on public.liveops_rundown(session_id, item_no);

create table if not exists public.liveops_cues (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.liveops_sessions(id) on delete cascade,
  at             timestamptz not null default now(),
  cue_type       text not null default 'note'
    check (cue_type in ('note','take','standby','roll','graphics','audio','break','recover','handover')),
  rundown_item_id uuid references public.liveops_rundown(id) on delete set null,
  note           text,
  logged_by      uuid references auth.users(id)
);
create index if not exists liveops_cues_session_idx on public.liveops_cues(session_id, at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- §7  الحوادث.
--
--   ★ التقسيم هنا ليس تجميليًّا:
--       description / root_cause / mitigation  →  **داخليّ دائمًا**
--       client_summary                          →  لا يُرى إلّا بعد اعتماد صريح
--       root_cause_released                     →  لا يُفتح إلّا بقرار إداريّ
--     السبب الجذريّ لا يُعرَض لعميل إطلاقًا ما لم يُفرَج عنه صراحةً، وحتّى حينها
--     يمرّ بماسح الأسرار مثله مثل أيّ نصّ عميل.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_incidents (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.liveops_sessions(id) on delete cascade,
  incident_no       integer,
  category          text not null default 'other' check (category in (
                      'network','encoder','camera','audio','power','recording','graphics',
                      'intercom','venue','human','weather','security','other')),
  severity          text not null default 'low' check (severity in ('low','medium','high','critical')),
  opened_at         timestamptz not null default now(),
  detected_by       uuid references auth.users(id),
  detected_by_label text,
  description       text not null check (length(btrim(description)) >= 3),   -- داخليّ
  affected_systems  text[] not null default '{}',
  client_summary    text,                                                    -- عميل (باعتماد)
  client_summary_approved boolean not null default false,
  client_summary_approved_by uuid references auth.users(id),
  client_summary_approved_at timestamptz,
  root_cause        text,                                                    -- داخليّ دائمًا
  root_cause_released boolean not null default false,
  root_cause_released_by uuid references auth.users(id),
  root_cause_released_at timestamptz,
  mitigation        text,
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users(id),
  post_event_action text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint liveops_incident_resolution_pair check (
    (resolved_at is null) = (resolved_by is null)),
  constraint liveops_incident_client_summary_pair check (
    client_summary_approved = false
    or (client_summary is not null and length(btrim(client_summary)) >= 3
        and client_summary_approved_by is not null and client_summary_approved_at is not null)),
  -- لا إفراج عن سبب جذريّ غير مكتوب، ولا إفراج بلا ملخّص عميل معتمَد يحمله.
  constraint liveops_incident_root_cause_release_pair check (
    root_cause_released = false
    or (root_cause is not null and length(btrim(root_cause)) >= 3
        and root_cause_released_by is not null and root_cause_released_at is not null
        and client_summary_approved = true))
);
create index if not exists liveops_incidents_session_idx on public.liveops_incidents(session_id, opened_at desc);

-- ─── نشرات معلنة للعميل (تنبيهات منشورة) ──────────────────────────────────
create table if not exists public.liveops_bulletins (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.liveops_sessions(id) on delete cascade,
  level         text not null default 'info' check (level in ('info','notice','warning')),
  title         text not null check (length(btrim(title)) between 2 and 160),
  body          text not null check (length(btrim(body)) between 2 and 1200),
  is_published  boolean not null default false,
  published_at  timestamptz,
  published_by  uuid references auth.users(id),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint liveops_bulletin_publish_pair check (
    is_published = false or (published_at is not null and published_by is not null))
);
create index if not exists liveops_bulletins_session_idx on public.liveops_bulletins(session_id, published_at desc);

-- ─── الأسماء المعتمَدة للعرض على العميل ───────────────────────────────────
-- ليست قائمة الطاقم. الطاقم كلّه داخليّ؛ هذه قائمة **موافق عليها فردًا فردًا**.
create table if not exists public.liveops_client_people (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.liveops_sessions(id) on delete cascade,
  display_name  text not null check (length(btrim(display_name)) between 2 and 120),
  role_label    text not null check (length(btrim(role_label)) between 2 and 120),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz not null default now(),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (session_id, display_name, role_label)
);

-- ════════════════════════════════════════════════════════════════════════════
-- §8  ★★ ماسح الأسرار ★★ — الطبقة الثانية تحت القائمة البيضاء.
--
--   القائمة البيضاء تمنع تسريب **عمود**. هذا يمنع تسريب **محتوى**: موظّف
--   يلصق عنوان IP أو مفتاح بثّ داخل «ملخّص العميل» بحسن نيّة. الرفض يقع عند
--   الحفظ لا عند العرض، لأنّ نصًّا محفوظًا يخرج يومًا من سطح لم يُتوقَّع.
--
--   يعيد سبب المطابقة بالاسم — رسالة «ممنوع» بلا سبب تُعلّم الناس الالتفاف.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_secret_reason(p_text text) returns text
language sql immutable as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when p_text ~ '(?<![0-9])([0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])'            then 'ip_address'
    when p_text ~* '\y([0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\y'                    then 'ip_address'
    when p_text ~* '\y(rtmps?|srt|rist|udp|rtsp|ndi|sftp|ftp)://'             then 'stream_endpoint'
    when p_text ~* '(stream[ _-]?key|streamkey|مفتاح[ ]?البث|ingest[ _-]?key)' then 'stream_key'
    when p_text ~* '(api[ _-]?key|secret|passwor?d|passwd|كلمة[ ]?(المرور|السر)|bearer[ ]|ssh-rsa|private[ _-]?key|token[ _-]?[:=])' then 'credential'
    when p_text ~* '(supabase\.co|/storage/v1/|/rest/v1/|[a-z]:\\|/var/|/mnt/|/volumes?/)' then 'storage_path'
    when p_text ~* '(\yserial\y|\ys/n\y|\ysn[ :#-]|الرقم[ ]?التسلسلي)'        then 'serial_number'
    when p_text ~ '\y[A-Z0-9]{2,}-?[A-Z0-9]{8,}\y'                            then 'serial_number'
    when p_text ~* '(\ycosts?\y|\yprice\y|\yinvoice\y|تكلفة|التكلفة|سعر|السعر|فاتورة|ريال|\ySAR\y|\yUSD\y)' then 'financial'
    when p_text ~* '(\$|€|£)[ ]?[0-9]'                                        then 'financial'
    when p_text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'            then 'contact_identifier'
    when p_text ~ '(?<![0-9])[0-9]{7,}(?![0-9])'                              then 'contact_identifier'
    when p_text ~* '(\ybackup[ _-]?(path|route|topology)|طوبولوج)'            then 'backup_topology'
    else null
  end;
$$;

create or replace function public.liveops_has_secret(p_text text) returns boolean
language sql immutable as $$ select public.liveops_secret_reason(p_text) is not null $$;

-- المُشغِّل يُركَّب على كلّ عمود يمكن أن يقرأه عميل. الرسالة تسمّي العمود والسبب.
create or replace function public.liveops_client_text_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_reason text; v_col text; v_val text; v_pairs text[]; v_row jsonb;
begin
  -- to_jsonb(new) بدل EXECUTE ... USING new: تمرير RECORD كمعامل استعلام غير
  -- مدعوم ويفشل بـ«could not determine data type».
  v_row := to_jsonb(new);
  v_pairs := case tg_table_name
    when 'liveops_sessions'      then array['title','client_notes']
    when 'liveops_incidents'     then array['client_summary']
    when 'liveops_bulletins'     then array['title','body']
    when 'liveops_client_people' then array['display_name','role_label']
    when 'liveops_reports'       then array['client_summary','incident_summary_client','destinations_client','delivered_files_client']
    when 'liveops_rundown'       then array['title']
    when 'liveops_inventory'     then array['label','item_role']
    else array[]::text[] end;

  foreach v_col in array v_pairs loop
    -- الرَّنداون والجرد يُفحصان فقط حين يكون البند مرئيًّا للعميل فعلًا.
    if tg_table_name in ('liveops_rundown','liveops_inventory')
       and coalesce((v_row ->> 'client_visible')::boolean, false) = false then
      continue;
    end if;
    v_val := v_row ->> v_col;
    v_reason := public.liveops_secret_reason(v_val);
    if v_reason is not null then
      raise exception 'liveops_client_text: %.% يحتوي على نمط ممنوع في نصّ يراه العميل (%). أعد صياغته بلا عناوين ولا مفاتيح ولا أرقام تسلسلية ولا مبالغ ولا معرّفات اتصال.',
        tg_table_name, v_col, v_reason;
    end if;
  end loop;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9  روابط العميل — **بصمة الرمز فقط**. لا يُخزَّن الرمز ولا يُعاد إظهاره.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_client_links (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.liveops_sessions(id) on delete cascade,
  label         text,
  recipient_org text,
  status        text not null default 'draft'
    check (status in ('draft','active','revoked','expired','exhausted')),
  token_hash    text unique,
  token_hint    text,
  token_issued_at timestamptz,
  token_issued_by uuid references auth.users(id),
  starts_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  max_opens     integer check (max_opens is null or max_opens between 1 and 10000),
  opens_used    integer not null default 0 check (opens_used >= 0),
  last_opened_at timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  revoked_by    uuid references auth.users(id),
  revoked_at    timestamptz,
  revoke_reason text,
  constraint liveops_link_window check (expires_at > starts_at),
  constraint liveops_link_revoked_pair check (
    status <> 'revoked' or (revoked_at is not null and length(btrim(coalesce(revoke_reason,''))) >= 3)),
  -- ⛔ رمز خامّ لا يُخزَّن أبدًا: البصمة ٦٤ محرفًا ستّ عشريًّا، والتلميح ٦ محارف.
  constraint liveops_link_hash_shape check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint liveops_link_hint_shape check (token_hint is null or length(token_hint) <= 6)
);
create index if not exists liveops_links_session_idx on public.liveops_client_links(session_id, created_at desc);

-- سجلّ الوصول — يحفظ **المرفوض** كما يحفظ المقبول. سجلّ ينجح فقط عند النجاح
-- يجعل تخمين الرموز غير مرئيّ. link_id يقبل NULL لرمز مجهول تمامًا.
create table if not exists public.liveops_link_access_log (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid references public.liveops_client_links(id) on delete set null,
  session_id    uuid references public.liveops_sessions(id) on delete set null,
  at            timestamptz not null default now(),
  allowed       boolean not null,
  denied_reason text,
  fingerprint   text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$')
);
create index if not exists liveops_link_log_idx on public.liveops_link_access_log(link_id, at desc);
create index if not exists liveops_link_log_fp_idx on public.liveops_link_access_log(fingerprint, at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- §10  تقرير ما بعد الفعالية.
--   ⚠️ uptime_basis: لا يصير telemetry_verified إلّا إن وُجدت قراءة موثَّقة
--      فعلًا لهذه الجلسة (مُشغِّل §12). في V1 لا قراءة كهذه ⇒ manual_estimate
--      دائمًا، وتُعرَض بهذا الاسم في كلّ سطح.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_reports (
  session_id        uuid primary key references public.liveops_sessions(id) on delete cascade,
  planned_start_at  timestamptz,
  planned_end_at    timestamptz,
  actual_start_at   timestamptz,
  actual_end_at     timestamptz,
  uptime_pct        numeric(5,2) check (uptime_pct is null or (uptime_pct >= 0 and uptime_pct <= 100)),
  uptime_basis      text not null default 'manual_estimate'
    check (uptime_basis in ('manual_estimate','telemetry_verified')),
  interruptions_count integer not null default 0 check (interruptions_count >= 0),
  interruption_minutes integer not null default 0 check (interruption_minutes >= 0),
  incident_summary_internal text,
  incident_summary_client   text,
  recording_confirmed boolean not null default false,
  recording_confirmed_by uuid references auth.users(id),
  backup_confirmed  boolean not null default false,
  backup_confirmed_by uuid references auth.users(id),
  destinations_client   text,
  delivered_files_client text,
  delivered_files_internal text,
  recommendations   text,
  client_summary    text,
  internal_summary  text,
  status            text not null default 'draft' check (status in ('draft','pending_approval','approved')),
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint liveops_report_approval_pair check (
    status <> 'approved' or (approved_by is not null and approved_at is not null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- §11  التدقيق.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.liveops_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  session_id  uuid,
  allowed     boolean not null default true,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists liveops_audit_session_idx on public.liveops_audit(session_id, at desc);

create or replace function public.liveops_log(
  p_action text, p_etype text, p_eid uuid, p_session uuid,
  p_allowed boolean default true, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.liveops_audit(actor_id, action, entity_type, entity_id, session_id, allowed, detail)
  values (auth.uid(), p_action, p_etype, p_eid, p_session, coalesce(p_allowed, true), coalesce(p_detail, '{}'::jsonb));
exception when others then
  return;             -- تدقيق معطوب لا يُسقط عملية تشغيل مباشر
end $$;

-- إشعار — اكتشاف ميزة كامل، ومعزول بالاستثناء: وحدة البثّ لا تسقط لأنّ
-- مسار الإشعارات غائب أو مقيَّد بـCHECK مختلف.
create or replace function public.liveops_notify(
  p_user uuid, p_type text, p_session uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_type !~ '^[a-z][a-z0-9_]{2,60}$' then return; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then
    perform public.liveops_log('notify_unavailable','liveops_session',p_session,p_session,false,
      jsonb_build_object('type', p_type, 'reason','notify_function_missing'));
    return;
  end if;
  execute 'select public.notify($1,$2,$3,$4,$5,$6,$7)'
    using p_user, 'user', p_type, 'liveops_session', p_session, p_ar, p_en;
exception when others then
  perform public.liveops_log('notify_failed','liveops_session',p_session,p_session,false,
    jsonb_build_object('type', p_type));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §12  المُشغِّلات — بما فيها الحارس الذي يمنع العميل من تغيير الحالة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

-- آلة الحالات. same → same مسموح (لا عملية).
create or replace function public.liveops_status_allowed(p_from text, p_to text) returns boolean
language sql immutable as $$
  select case
    when p_from is null or p_to is null then false
    when p_from = p_to then true
    else (p_from || '>' || p_to) in (
      'draft>readiness_review','draft>archived',
      'readiness_review>ready','readiness_review>draft','readiness_review>archived',
      'ready>rehearsal','ready>live','ready>readiness_review','ready>archived',
      'rehearsal>ready','rehearsal>live','rehearsal>archived',
      'live>paused','live>degraded','live>interrupted','live>completed',
      'paused>live','paused>degraded','paused>interrupted','paused>completed',
      'degraded>live','degraded>paused','degraded>interrupted','degraded>completed',
      'interrupted>live','interrupted>paused','interrupted>degraded','interrupted>completed',
      'completed>post_event_review','completed>archived',
      'post_event_review>completed','post_event_review>archived')
  end;
$$;

create or replace function public.liveops_default_client_status(p_status text) returns text
language sql immutable as $$
  select case p_status
    when 'draft' then 'scheduled'
    when 'readiness_review' then 'preparing'
    when 'ready' then 'preparing'
    when 'rehearsal' then 'preparing'
    when 'live' then 'on_air'
    when 'paused' then 'paused'
    when 'degraded' then 'on_air_with_issues'
    when 'interrupted' then 'interrupted'
    when 'completed' then 'completed'
    when 'post_event_review' then 'completed'
    when 'archived' then 'completed'
    else 'scheduled' end;
$$;

-- ★★ الحارس ★★
--   يعيد حساب السلطة من القاعدة بدل الوثوق بالمتصل. يصمد أمام سياسة UPDATE
--   خاطئة تُضاف لاحقًا، وأمام كتابة مباشرة عبر PostgREST.
--   auth.uid() = NULL ⇒ محرّر SQL بدور المالك: يُسمح ويُسجَّل، لأنّ منعه يجعل
--   أيّ ترحيلة مستقبلية تنهار. أمّا العميل فـauth.uid() لديه **ليست** NULL،
--   فيسقط في الفرع الأوّل دائمًا.
create or replace function public.liveops_session_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.status is distinct from old.status
          or new.client_status is distinct from old.client_status) then

    if coalesce(public.liveops_is_client(), true) then
      perform public.liveops_log('status_change_denied_client','liveops_session', old.id, old.id, false,
        jsonb_build_object('from', old.status, 'to', new.status));
      raise exception 'not authorized: تغيير حالة جلسة مباشرة ليس متاحًا لحساب عميل.';
    end if;

    if auth.uid() is not null and not coalesce(public.liveops_can_operate_session(old.id), false) then
      perform public.liveops_log('status_change_denied','liveops_session', old.id, old.id, false,
        jsonb_build_object('from', old.status, 'to', new.status));
      raise exception 'not authorized: لا تملك صلاحية تشغيل هذه الجلسة.';
    end if;

    if not coalesce(public.liveops_status_allowed(old.status, new.status), false) then
      raise exception 'conflict: انتقال غير مسموح من % إلى %', old.status, new.status;
    end if;

    if auth.uid() is null then
      perform public.liveops_log('status_change_no_session_context','liveops_session', old.id, old.id, true,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- uptime لا يترقّى إلى «موثَّق بالقياس» بلا قراءة موثَّقة فعليّة.
create or replace function public.liveops_report_uptime_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.uptime_basis = 'telemetry_verified'
     and not exists (select 1 from public.liveops_stream_health h
                      where h.session_id = new.session_id
                        and h.source = 'telemetry_verified'
                        and h.adapter_id is not null) then
    new.uptime_basis := 'manual_estimate';
  end if;
  new.updated_at := now();
  return new;
end $$;

do $trg$
declare t text;
begin
  drop trigger if exists liveops_sessions_guard on public.liveops_sessions;
  create trigger liveops_sessions_guard before update on public.liveops_sessions
    for each row execute function public.liveops_session_guard();

  drop trigger if exists liveops_reports_uptime on public.liveops_reports;
  create trigger liveops_reports_uptime before insert or update on public.liveops_reports
    for each row execute function public.liveops_report_uptime_guard();

  foreach t in array array['liveops_inventory','liveops_rundown','liveops_incidents','liveops_bulletins'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.liveops_touch()',
                   t || '_touch', t);
  end loop;

  -- ماسح الأسرار على كلّ جدول يحمل نصًّا قد يقرأه عميل.
  foreach t in array array['liveops_sessions','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_rundown','liveops_inventory'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_secret_scan', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.liveops_client_text_guard()',
                   t || '_secret_scan', t);
  end loop;
end $trg$;

-- ════════════════════════════════════════════════════════════════════════════
-- §13  RLS — القراءة للموظّف المخوَّل فقط، و**لا سياسة كتابة إطلاقًا**:
--      كلّ كتابة تمرّ بدالّة SECURITY DEFINER تفحص وتُدقّق. جدول الروابط
--      وسجلّ وصوله لا يُقرآن مباشرة أصلًا (لا منح SELECT) كي لا تخرج بصمة رمز.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_client_links',
                           'liveops_link_access_log','liveops_audit'] loop
    -- ⚠️ ENABLE فقط، **بلا FORCE** عن قصد. FORCE يُخضع مالك الجدول للسياسات،
    --    ودوالّ SECURITY DEFINER هنا تعمل بدور المالك بينما كلّ سياسة موجَّهة
    --    إلى authenticated ⇒ لا سياسة تنطبق ⇒ صفر صفوف، فتتعطّل الوحدة كاملة
    --    (وتتعطّل معها كتابة سجلّ وصول الرابط). هذا هو عُرف بقيّة الوحدات هنا.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
  end loop;

  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.liveops_can_view())',
                   t || '_read', t);
  end loop;

  -- التدقيق: للإدارة فقط.
  execute 'create policy liveops_audit_read on public.liveops_audit for select to authenticated using (public.liveops_can_manage())';
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §14  دوالّ الكتابة الداخلية.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.liveops_session_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_new boolean := false; v_code text; v_job uuid; v_project uuid;
begin
  v_id := public.liveops_uuid(p_input, 'id');
  if v_id is null then
    if not coalesce(public.liveops_can_operate(), false) then
      perform public.liveops_log('session_create','liveops_session',null,null,false,'{}'::jsonb);
      raise exception 'not authorized: إنشاء جلسة مباشرة يتطلّب صلاحية تشغيل.';
    end if;
  else
    if not coalesce(public.liveops_can_operate_session(v_id), false) then
      perform public.liveops_log('session_update','liveops_session',v_id,v_id,false,'{}'::jsonb);
      raise exception 'not authorized: لا تملك صلاحية تعديل هذه الجلسة.';
    end if;
  end if;

  if public.liveops_txt(p_input,'title') is null and v_id is null then
    raise exception 'validation: العنوان إلزاميّ.';
  end if;

  -- المرجعان الاختياريّان: نتحقّق من **الوجود** باكتشاف ميزة، لا بمفتاح أجنبيّ.
  v_job := public.liveops_uuid(p_input,'prodops_job_id');
  if v_job is not null and to_regclass('public.ops_jobs') is not null then
    if not exists (select 1 from public.ops_jobs j where j.id = v_job) then
      raise exception 'validation: أمر العمل المشار إليه غير موجود.';
    end if;
  end if;
  v_project := public.liveops_uuid(p_input,'project_id');
  if v_project is not null and to_regclass('public.projects') is not null then
    if not exists (select 1 from public.projects pr where pr.id = v_project) then
      raise exception 'validation: المشروع المشار إليه غير موجود.';
    end if;
  end if;

  if v_id is null then
    v_new := true;
    v_code := 'LIVE-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
    insert into public.liveops_sessions(
      session_code, title, internal_ref, prodops_job_id, project_id, event_date,
      starts_at, expected_end_at, venue, control_room,
      operations_manager_id, broadcast_director_id, technical_director_id,
      primary_contact_name, primary_contact_phone, emergency_contact_name, emergency_contact_phone,
      internal_notes, client_notes, created_by, updated_by)
    values (
      v_code, public.liveops_txt(p_input,'title'), public.liveops_txt(p_input,'internal_ref'),
      v_job, v_project, (public.liveops_txt(p_input,'event_date'))::date,
      public.liveops_ts(p_input,'starts_at'), public.liveops_ts(p_input,'expected_end_at'),
      public.liveops_txt(p_input,'venue'), public.liveops_txt(p_input,'control_room'),
      public.liveops_uuid(p_input,'operations_manager_id'), public.liveops_uuid(p_input,'broadcast_director_id'),
      public.liveops_uuid(p_input,'technical_director_id'),
      public.liveops_txt(p_input,'primary_contact_name'), public.liveops_txt(p_input,'primary_contact_phone'),
      public.liveops_txt(p_input,'emergency_contact_name'), public.liveops_txt(p_input,'emergency_contact_phone'),
      public.liveops_txt(p_input,'internal_notes'), public.liveops_txt(p_input,'client_notes'),
      auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.liveops_sessions s set
      title = coalesce(public.liveops_txt(p_input,'title'), s.title),
      internal_ref = coalesce(public.liveops_txt(p_input,'internal_ref'), s.internal_ref),
      prodops_job_id = coalesce(v_job, s.prodops_job_id),
      project_id = coalesce(v_project, s.project_id),
      event_date = coalesce((public.liveops_txt(p_input,'event_date'))::date, s.event_date),
      starts_at = coalesce(public.liveops_ts(p_input,'starts_at'), s.starts_at),
      expected_end_at = coalesce(public.liveops_ts(p_input,'expected_end_at'), s.expected_end_at),
      venue = coalesce(public.liveops_txt(p_input,'venue'), s.venue),
      control_room = coalesce(public.liveops_txt(p_input,'control_room'), s.control_room),
      operations_manager_id = coalesce(public.liveops_uuid(p_input,'operations_manager_id'), s.operations_manager_id),
      broadcast_director_id = coalesce(public.liveops_uuid(p_input,'broadcast_director_id'), s.broadcast_director_id),
      technical_director_id = coalesce(public.liveops_uuid(p_input,'technical_director_id'), s.technical_director_id),
      primary_contact_name = coalesce(public.liveops_txt(p_input,'primary_contact_name'), s.primary_contact_name),
      primary_contact_phone = coalesce(public.liveops_txt(p_input,'primary_contact_phone'), s.primary_contact_phone),
      emergency_contact_name = coalesce(public.liveops_txt(p_input,'emergency_contact_name'), s.emergency_contact_name),
      emergency_contact_phone = coalesce(public.liveops_txt(p_input,'emergency_contact_phone'), s.emergency_contact_phone),
      internal_notes = coalesce(public.liveops_txt(p_input,'internal_notes'), s.internal_notes),
      client_notes = coalesce(public.liveops_txt(p_input,'client_notes'), s.client_notes),
      updated_by = auth.uid()
    where s.id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;

  perform public.liveops_log(case when v_new then 'session_create' else 'session_update' end,
    'liveops_session', v_id, v_id, true, jsonb_build_object('title', public.liveops_txt(p_input,'title')));
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $fn$;

-- ★ الحالة. العميل لا يصل إلى هنا بحال: البوّابة الأولى تشترط تشغيل الجلسة،
--   والمُشغِّل يعيد الفحص بعدها.
create or replace function public.liveops_session_set_status(
  p_session uuid, p_status text, p_client_status text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare s record; v_client text;
begin
  if not coalesce(public.liveops_can_operate_session(p_session), false) then
    perform public.liveops_log('session_set_status','liveops_session',p_session,p_session,false,
      jsonb_build_object('to', p_status));
    raise exception 'not authorized: تغيير الحالة يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  select * into s from public.liveops_sessions where id = p_session for update;
  if not found then raise exception 'not found'; end if;

  if not coalesce(public.liveops_status_allowed(s.status, p_status), false) then
    raise exception 'conflict: انتقال غير مسموح من % إلى %', s.status, p_status;
  end if;

  v_client := coalesce(p_client_status, public.liveops_default_client_status(p_status));
  if v_client not in ('scheduled','preparing','on_air','paused','on_air_with_issues','interrupted','completed') then
    raise exception 'validation: حالة العميل غير معروفة.';
  end if;

  update public.liveops_sessions set
    status = p_status,
    client_status = v_client,
    actual_start_at = case when p_status in ('live','rehearsal') and actual_start_at is null then now() else actual_start_at end,
    actual_end_at   = case when p_status = 'completed' and actual_end_at is null then now() else actual_end_at end,
    updated_by = auth.uid()
  where id = p_session;

  perform public.liveops_log('session_set_status','liveops_session',p_session,p_session,true,
    jsonb_build_object('from', s.status, 'to', p_status, 'client_status', v_client, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_session, 'status', p_status, 'client_status', v_client);
end $fn$;

create or replace function public.liveops_inventory_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_session uuid;
begin
  v_id := public.liveops_uuid(p_input,'id');
  if v_id is not null then
    select session_id into v_session from public.liveops_inventory where id = v_id;
    if v_session is null then raise exception 'not found'; end if;
  else
    v_session := public.liveops_uuid(p_input,'live_session_id');
  end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تعديل الجرد الفنّيّ يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;

  if v_id is null then
    insert into public.liveops_inventory(
      session_id, category, label, item_role, assigned_user_id, assigned_name,
      tech_status, health, last_checked_at, last_checked_by, issue, client_visible,
      internal_notes, sort_order, created_by)
    values (v_session, public.liveops_txt(p_input,'category'), public.liveops_txt(p_input,'label'),
      public.liveops_txt(p_input,'item_role'), public.liveops_uuid(p_input,'assigned_user_id'),
      public.liveops_txt(p_input,'assigned_name'),
      coalesce(public.liveops_txt(p_input,'tech_status'),'unknown'),
      coalesce(public.liveops_txt(p_input,'health'),'unknown'),
      public.liveops_ts(p_input,'last_checked_at'), auth.uid(),
      public.liveops_txt(p_input,'issue'), public.liveops_bool(p_input,'client_visible', false),
      public.liveops_txt(p_input,'internal_notes'), coalesce(public.liveops_int(p_input,'sort_order'),0),
      auth.uid())
    returning id into v_id;
  else
    update public.liveops_inventory i set
      category = coalesce(public.liveops_txt(p_input,'category'), i.category),
      label = coalesce(public.liveops_txt(p_input,'label'), i.label),
      item_role = coalesce(public.liveops_txt(p_input,'item_role'), i.item_role),
      assigned_user_id = coalesce(public.liveops_uuid(p_input,'assigned_user_id'), i.assigned_user_id),
      assigned_name = coalesce(public.liveops_txt(p_input,'assigned_name'), i.assigned_name),
      tech_status = coalesce(public.liveops_txt(p_input,'tech_status'), i.tech_status),
      health = coalesce(public.liveops_txt(p_input,'health'), i.health),
      last_checked_at = coalesce(public.liveops_ts(p_input,'last_checked_at'), i.last_checked_at),
      issue = coalesce(public.liveops_txt(p_input,'issue'), i.issue),
      client_visible = case when p_input ? 'client_visible'
                            then public.liveops_bool(p_input,'client_visible', i.client_visible)
                            else i.client_visible end,
      internal_notes = coalesce(public.liveops_txt(p_input,'internal_notes'), i.internal_notes),
      sort_order = coalesce(public.liveops_int(p_input,'sort_order'), i.sort_order)
    where i.id = v_id;
  end if;

  perform public.liveops_log('inventory_upsert','liveops_inventory',v_id,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.liveops_inventory_set_state(
  p_item uuid, p_tech_status text, p_health text default null, p_issue text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid;
begin
  select session_id into v_session from public.liveops_inventory where id = p_item;
  if v_session is null then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تحديث حالة عنصر فنّيّ يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  update public.liveops_inventory set
    tech_status = coalesce(p_tech_status, tech_status),
    health = coalesce(p_health, health),
    issue = coalesce(p_issue, issue),
    last_checked_at = now(), last_checked_by = auth.uid()
  where id = p_item;
  perform public.liveops_log('inventory_state','liveops_inventory',p_item,v_session,true,
    jsonb_build_object('tech_status', p_tech_status, 'health', p_health));
  -- ⛔ «آخر فحص» = آخر مرّة أدخلها إنسان. لا تُعرَض أبدًا كقياس حيّ.
  return jsonb_build_object('ok', true, 'id', p_item, 'update_kind', 'manual_status',
    'note_ar','هذه قيمة أدخلها إنسان الآن، وليست قراءة من الجهاز.');
end $fn$;

create or replace function public.liveops_inventory_delete(p_item uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid;
begin
  select session_id into v_session from public.liveops_inventory where id = p_item;
  if v_session is null then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'validation: السبب إلزاميّ.'; end if;
  delete from public.liveops_inventory where id = p_item;
  perform public.liveops_log('inventory_delete','liveops_inventory',p_item,v_session,true,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_item);
end $fn$;

-- قراءة صحّة الشبكة. المصدر يُفرَض هنا: لا يستطيع المتصل أن يعلن نفسه قياسًا.
create or replace function public.liveops_health_record(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid; v_id uuid; v_src text;
begin
  v_session := public.liveops_uuid(p_input,'live_session_id');
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تسجيل حالة الشبكة يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  v_src := coalesce(public.liveops_txt(p_input,'source'), 'manual_status');
  -- ★ لا سبيل إلى «موثَّق بالقياس» من هذه الدالّة إطلاقًا في V1.
  if v_src not in ('manual_status','adapter_unavailable','telemetry_not_connected') then
    raise exception 'validation: المصدر المسموح يدويّ أو غياب مُحوِّل أو عدم توصيل القياسات. لا يوجد مسار يدويّ يُنتج قراءة موثَّقة.';
  end if;

  insert into public.liveops_stream_health(
    session_id, connection, upload_kbps, latency_ms, packet_loss_pct,
    current_bitrate_kbps, target_bitrate_kbps, encoder_state, destination_state,
    recording_state, failover_active, source, adapter_id, last_verified_at, recorded_by, note)
  values (v_session, coalesce(public.liveops_txt(p_input,'connection'),'primary'),
    public.liveops_int(p_input,'upload_kbps'), public.liveops_int(p_input,'latency_ms'),
    public.liveops_num(p_input,'packet_loss_pct'), public.liveops_int(p_input,'current_bitrate_kbps'),
    public.liveops_int(p_input,'target_bitrate_kbps'),
    coalesce(public.liveops_txt(p_input,'encoder_state'),'unknown'),
    coalesce(public.liveops_txt(p_input,'destination_state'),'unknown'),
    coalesce(public.liveops_txt(p_input,'recording_state'),'unknown'),
    public.liveops_bool(p_input,'failover_active', false),
    v_src, null, case when v_src = 'manual_status' then now() else null end,
    auth.uid(), public.liveops_txt(p_input,'note'))
  returning id into v_id;

  perform public.liveops_log('health_record','liveops_stream_health',v_id,v_session,true,
    jsonb_build_object('source', v_src));
  return jsonb_build_object('ok', true, 'id', v_id, 'source', v_src,
    'telemetry_connected', false,
    'note_ar','القيم المسجَّلة إدخال بشريّ. لا يوجد اتصال بالأجهزة في هذه النسخة.');
end $fn$;

create or replace function public.liveops_rundown_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_session uuid; v_no int;
begin
  v_id := public.liveops_uuid(p_input,'id');
  if v_id is not null then
    select session_id into v_session from public.liveops_rundown where id = v_id;
    if v_session is null then raise exception 'not found'; end if;
  else
    v_session := public.liveops_uuid(p_input,'live_session_id');
  end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تعديل الرَّنداون يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;

  if v_id is null then
    v_no := coalesce(public.liveops_int(p_input,'item_no'),
                     (select coalesce(max(item_no),0)+1 from public.liveops_rundown where session_id = v_session));
    insert into public.liveops_rundown(
      session_id, item_no, scheduled_at, title, duration_seconds, speaker, media,
      camera_plan, graphics_cue, audio_cue, notes, status, client_visible, created_by)
    values (v_session, v_no, public.liveops_ts(p_input,'scheduled_at'), public.liveops_txt(p_input,'title'),
      public.liveops_int(p_input,'duration_seconds'), public.liveops_txt(p_input,'speaker'),
      public.liveops_txt(p_input,'media'), public.liveops_txt(p_input,'camera_plan'),
      public.liveops_txt(p_input,'graphics_cue'), public.liveops_txt(p_input,'audio_cue'),
      public.liveops_txt(p_input,'notes'), coalesce(public.liveops_txt(p_input,'status'),'planned'),
      public.liveops_bool(p_input,'client_visible', false), auth.uid())
    returning id into v_id;
  else
    update public.liveops_rundown r set
      item_no = coalesce(public.liveops_int(p_input,'item_no'), r.item_no),
      scheduled_at = coalesce(public.liveops_ts(p_input,'scheduled_at'), r.scheduled_at),
      title = coalesce(public.liveops_txt(p_input,'title'), r.title),
      duration_seconds = coalesce(public.liveops_int(p_input,'duration_seconds'), r.duration_seconds),
      speaker = coalesce(public.liveops_txt(p_input,'speaker'), r.speaker),
      media = coalesce(public.liveops_txt(p_input,'media'), r.media),
      camera_plan = coalesce(public.liveops_txt(p_input,'camera_plan'), r.camera_plan),
      graphics_cue = coalesce(public.liveops_txt(p_input,'graphics_cue'), r.graphics_cue),
      audio_cue = coalesce(public.liveops_txt(p_input,'audio_cue'), r.audio_cue),
      notes = coalesce(public.liveops_txt(p_input,'notes'), r.notes),
      client_visible = case when p_input ? 'client_visible'
                            then public.liveops_bool(p_input,'client_visible', r.client_visible)
                            else r.client_visible end
    where r.id = v_id;
  end if;
  perform public.liveops_log('rundown_upsert','liveops_rundown',v_id,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.liveops_rundown_set_status(
  p_item uuid, p_status text, p_actual_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r record; v_actual timestamptz; v_delay int;
begin
  select * into r from public.liveops_rundown where id = p_item;
  if not found then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_operate_session(r.session_id), false) then
    raise exception 'not authorized: تحديث بند الرَّنداون يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  if p_status not in ('planned','ready','on_air','completed','delayed','skipped','changed') then
    raise exception 'validation: حالة بند غير معروفة.';
  end if;
  v_actual := coalesce(p_actual_at, case when p_status = 'on_air' then now() else r.actual_at end);
  v_delay := case when v_actual is not null and r.scheduled_at is not null
                  then greatest(0, (extract(epoch from (v_actual - r.scheduled_at)))::int)
                  else r.delay_seconds end;

  -- بند واحد فقط على الهواء في الجلسة.
  if p_status = 'on_air' then
    update public.liveops_rundown set status = 'completed'
     where session_id = r.session_id and status = 'on_air' and id <> p_item;
  end if;

  update public.liveops_rundown set status = p_status, actual_at = v_actual, delay_seconds = v_delay
   where id = p_item;
  perform public.liveops_log('rundown_status','liveops_rundown',p_item,r.session_id,true,
    jsonb_build_object('status', p_status, 'delay_seconds', v_delay));
  return jsonb_build_object('ok', true, 'id', p_item, 'status', p_status, 'delay_seconds', v_delay);
end $fn$;

create or replace function public.liveops_rundown_delete(p_item uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid;
begin
  select session_id into v_session from public.liveops_rundown where id = p_item;
  if v_session is null then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'validation: السبب إلزاميّ.'; end if;
  delete from public.liveops_rundown where id = p_item;
  perform public.liveops_log('rundown_delete','liveops_rundown',p_item,v_session,true,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_item);
end $fn$;

create or replace function public.liveops_cue_log(
  p_session uuid, p_cue_type text, p_item uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not coalesce(public.liveops_can_operate_session(p_session), false) then
    raise exception 'not authorized: تسجيل إشارة يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  insert into public.liveops_cues(session_id, cue_type, rundown_item_id, note, logged_by)
  values (p_session, coalesce(p_cue_type,'note'), p_item, p_note, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ─── الحوادث ───────────────────────────────────────────────────────────────
create or replace function public.liveops_incident_open(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid; v_id uuid; v_no int;
begin
  v_session := public.liveops_uuid(p_input,'live_session_id');
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: فتح حادثة يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  if public.liveops_txt(p_input,'description') is null then
    raise exception 'validation: وصف الحادثة الداخليّ إلزاميّ.';
  end if;
  select coalesce(max(incident_no),0)+1 into v_no from public.liveops_incidents where session_id = v_session;

  insert into public.liveops_incidents(
    session_id, incident_no, category, severity, opened_at, detected_by, detected_by_label,
    description, affected_systems, client_summary, root_cause, mitigation)
  values (v_session, v_no, coalesce(public.liveops_txt(p_input,'category'),'other'),
    coalesce(public.liveops_txt(p_input,'severity'),'low'),
    coalesce(public.liveops_ts(p_input,'opened_at'), now()), auth.uid(),
    public.liveops_txt(p_input,'detected_by_label'), public.liveops_txt(p_input,'description'),
    coalesce((select array_agg(el) from jsonb_array_elements_text(
              case when jsonb_typeof(p_input->'affected_systems') = 'array'
                   then p_input->'affected_systems' else '[]'::jsonb end) as el), '{}'::text[]),
    public.liveops_txt(p_input,'client_summary'), public.liveops_txt(p_input,'root_cause'),
    public.liveops_txt(p_input,'mitigation'))
  returning id into v_id;

  perform public.liveops_log('incident_open','liveops_incident',v_id,v_session,true,
    jsonb_build_object('severity', public.liveops_txt(p_input,'severity')));
  return jsonb_build_object('ok', true, 'id', v_id, 'incident_no', v_no,
    'client_visible', false,
    'note_ar','الحادثة داخلية. لا يراها العميل إلّا بعد اعتماد ملخّص مخصَّص له.');
end $fn$;

create or replace function public.liveops_incident_update(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_session uuid; v_approve boolean; i record;
begin
  v_id := public.liveops_uuid(p_input,'id');
  select * into i from public.liveops_incidents where id = v_id;
  if not found then raise exception 'not found'; end if;
  v_session := i.session_id;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تعديل الحادثة يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;

  -- ★ اعتماد ملخّص العميل قرار إداريّ، لا تشغيليّ.
  v_approve := case when p_input ? 'client_summary_approved'
                    then public.liveops_bool(p_input,'client_summary_approved', false) else null end;
  if v_approve is true and not coalesce(public.liveops_can_manage(), false) then
    perform public.liveops_log('incident_client_approve','liveops_incident',v_id,v_session,false,'{}'::jsonb);
    raise exception 'not authorized: اعتماد ملخّص يراه العميل يتطلّب صلاحية إدارة.';
  end if;

  update public.liveops_incidents x set
    category = coalesce(public.liveops_txt(p_input,'category'), x.category),
    severity = coalesce(public.liveops_txt(p_input,'severity'), x.severity),
    description = coalesce(public.liveops_txt(p_input,'description'), x.description),
    affected_systems = case when jsonb_typeof(p_input->'affected_systems') = 'array'
      then coalesce((select array_agg(el) from jsonb_array_elements_text(p_input->'affected_systems') as el), '{}'::text[])
      else x.affected_systems end,
    client_summary = coalesce(public.liveops_txt(p_input,'client_summary'), x.client_summary),
    client_summary_approved = case when v_approve is null then x.client_summary_approved else v_approve end,
    client_summary_approved_by = case when v_approve is true then auth.uid()
                                      when v_approve is false then null else x.client_summary_approved_by end,
    client_summary_approved_at = case when v_approve is true then now()
                                      when v_approve is false then null else x.client_summary_approved_at end,
    -- إلغاء اعتماد الملخّص يسحب الإفراج عن السبب الجذريّ معه. لا يبقى الأخطر
    -- مفتوحًا بعد إغلاق الأدنى.
    root_cause_released = case when v_approve is false then false else x.root_cause_released end,
    root_cause_released_by = case when v_approve is false then null else x.root_cause_released_by end,
    root_cause_released_at = case when v_approve is false then null else x.root_cause_released_at end,
    root_cause = coalesce(public.liveops_txt(p_input,'root_cause'), x.root_cause),
    mitigation = coalesce(public.liveops_txt(p_input,'mitigation'), x.mitigation),
    post_event_action = coalesce(public.liveops_txt(p_input,'post_event_action'), x.post_event_action)
  where x.id = v_id;

  perform public.liveops_log('incident_update','liveops_incident',v_id,v_session,true,
    jsonb_build_object('client_summary_approved', v_approve));
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.liveops_incident_resolve(
  p_incident uuid, p_mitigation text default null, p_post_event_action text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid;
begin
  select session_id into v_session from public.liveops_incidents where id = p_incident;
  if v_session is null then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then raise exception 'not authorized'; end if;
  update public.liveops_incidents set
    resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()),
    mitigation = coalesce(p_mitigation, mitigation),
    post_event_action = coalesce(p_post_event_action, post_event_action)
  where id = p_incident;
  perform public.liveops_log('incident_resolve','liveops_incident',p_incident,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_incident);
end $fn$;

-- ★★ الإفراج عن السبب الجذريّ نحو العميل ★★ — إدارة فقط، وبسبب مكتوب، ومدقَّق.
create or replace function public.liveops_incident_release_root_cause(
  p_incident uuid, p_release boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare i record;
begin
  select * into i from public.liveops_incidents where id = p_incident;
  if not found then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_reveal_root_cause(), false) then
    perform public.liveops_log('incident_root_cause_release','liveops_incident',p_incident,i.session_id,false,
      jsonb_build_object('requested', p_release));
    raise exception 'not authorized: الإفراج عن السبب الجذريّ الداخليّ قرار إداريّ.';
  end if;
  if p_release and length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'validation: سبب الإفراج إلزاميّ ويُحفَظ في التدقيق.';
  end if;
  if p_release and not i.client_summary_approved then
    raise exception 'conflict: لا يُفرَج عن سبب جذريّ قبل اعتماد ملخّص العميل لهذه الحادثة.';
  end if;
  -- ★ السبب الجذريّ نصّ داخليّ حرّ لا يمرّ بماسح الأسرار عند الكتابة (وهذا
  --   صحيح: الداخل يجب أن يكون صريحًا). لكنّه عند الإفراج يصير نصّ عميل، فيُمسَح
  --   هنا بالضبط. بلا هذا الفحص كان الإفراج ثغرة تلتفّ على §8 كاملًا.
  if p_release and public.liveops_has_secret(i.root_cause) then
    raise exception 'liveops_client_text: السبب الجذريّ يحتوي على نمط ممنوع في نصّ يراه العميل (%). أعد صياغة نسخة عميل خالية من العناوين والمفاتيح والأرقام التسلسلية والمبالغ ومعرّفات الاتصال.',
      public.liveops_secret_reason(i.root_cause);
  end if;

  update public.liveops_incidents set
    root_cause_released = coalesce(p_release, false),
    root_cause_released_by = case when p_release then auth.uid() else null end,
    root_cause_released_at = case when p_release then now() else null end
  where id = p_incident;

  perform public.liveops_log('incident_root_cause_release','liveops_incident',p_incident,i.session_id,true,
    jsonb_build_object('released', p_release, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_incident, 'released', coalesce(p_release,false));
end $fn$;

-- ─── النشرات والأسماء المعتمَدة ────────────────────────────────────────────
create or replace function public.liveops_bulletin_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_session uuid; v_publish boolean;
begin
  v_id := public.liveops_uuid(p_input,'id');
  if v_id is not null then
    select session_id into v_session from public.liveops_bulletins where id = v_id;
    if v_session is null then raise exception 'not found'; end if;
  else
    v_session := public.liveops_uuid(p_input,'live_session_id');
  end if;
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تحرير النشرات يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  v_publish := case when p_input ? 'is_published' then public.liveops_bool(p_input,'is_published', false) else null end;
  -- النشر إعلان للعميل: إدارة فقط.
  if v_publish is true and not coalesce(public.liveops_can_manage(), false) then
    raise exception 'not authorized: نشر تنبيه يراه العميل يتطلّب صلاحية إدارة.';
  end if;

  if v_id is null then
    insert into public.liveops_bulletins(session_id, level, title, body, is_published, published_at, published_by, created_by)
    values (v_session, coalesce(public.liveops_txt(p_input,'level'),'info'),
      public.liveops_txt(p_input,'title'), public.liveops_txt(p_input,'body'),
      coalesce(v_publish,false), case when v_publish then now() end,
      case when v_publish then auth.uid() end, auth.uid())
    returning id into v_id;
  else
    update public.liveops_bulletins b set
      level = coalesce(public.liveops_txt(p_input,'level'), b.level),
      title = coalesce(public.liveops_txt(p_input,'title'), b.title),
      body  = coalesce(public.liveops_txt(p_input,'body'),  b.body),
      is_published = case when v_publish is null then b.is_published else v_publish end,
      published_at = case when v_publish is true then coalesce(b.published_at, now())
                          when v_publish is false then null else b.published_at end,
      published_by = case when v_publish is true then coalesce(b.published_by, auth.uid())
                          when v_publish is false then null else b.published_by end
    where b.id = v_id;
  end if;
  perform public.liveops_log('bulletin_upsert','liveops_bulletin',v_id,v_session,true,
    jsonb_build_object('published', v_publish));
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.liveops_client_person_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid; v_id uuid;
begin
  v_session := public.liveops_uuid(p_input,'live_session_id');
  if not coalesce(public.liveops_can_manage(), false) then
    raise exception 'not authorized: اعتماد اسم يظهر للعميل يتطلّب صلاحية إدارة.';
  end if;
  if v_session is null then raise exception 'validation: الجلسة إلزامية.'; end if;
  insert into public.liveops_client_people(session_id, display_name, role_label, approved_by, sort_order)
  values (v_session, public.liveops_txt(p_input,'display_name'), public.liveops_txt(p_input,'role_label'),
          auth.uid(), coalesce(public.liveops_int(p_input,'sort_order'),0))
  on conflict (session_id, display_name, role_label)
    do update set approved_by = auth.uid(), approved_at = now(),
                  sort_order = coalesce(public.liveops_int(p_input,'sort_order'), liveops_client_people.sort_order)
  returning id into v_id;
  perform public.liveops_log('client_person_upsert','liveops_client_person',v_id,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.liveops_client_person_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid;
begin
  select session_id into v_session from public.liveops_client_people where id = p_id;
  if v_session is null then raise exception 'not found'; end if;
  if not coalesce(public.liveops_can_manage(), false) then raise exception 'not authorized'; end if;
  delete from public.liveops_client_people where id = p_id;
  perform public.liveops_log('client_person_delete','liveops_client_person',p_id,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §15  تقرير ما بعد الفعالية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_report_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid; s record; v_status text;
begin
  v_session := public.liveops_uuid(p_input,'live_session_id');
  if not coalesce(public.liveops_can_operate_session(v_session), false) then
    raise exception 'not authorized: تحرير التقرير يتطلّب صلاحية تشغيل هذه الجلسة.';
  end if;
  select * into s from public.liveops_sessions where id = v_session;
  if not found then raise exception 'not found'; end if;

  v_status := coalesce(public.liveops_txt(p_input,'status'),'draft');
  if v_status not in ('draft','pending_approval') then
    raise exception 'validation: الاعتماد يتمّ عبر liveops_report_approve فقط.';
  end if;

  insert into public.liveops_reports as r (
    session_id, planned_start_at, planned_end_at, actual_start_at, actual_end_at,
    uptime_pct, uptime_basis, interruptions_count, interruption_minutes,
    incident_summary_internal, incident_summary_client, recording_confirmed, recording_confirmed_by,
    backup_confirmed, backup_confirmed_by, destinations_client, delivered_files_client,
    delivered_files_internal, recommendations, client_summary, internal_summary, status, created_by)
  values (v_session, s.starts_at, s.expected_end_at, s.actual_start_at, s.actual_end_at,
    public.liveops_num(p_input,'uptime_pct'), 'manual_estimate',
    coalesce(public.liveops_int(p_input,'interruptions_count'),
             (select count(*) from public.liveops_incidents i
               where i.session_id = v_session and i.severity in ('high','critical'))),
    coalesce(public.liveops_int(p_input,'interruption_minutes'),0),
    public.liveops_txt(p_input,'incident_summary_internal'), public.liveops_txt(p_input,'incident_summary_client'),
    public.liveops_bool(p_input,'recording_confirmed', false),
    case when public.liveops_bool(p_input,'recording_confirmed', false) then auth.uid() end,
    public.liveops_bool(p_input,'backup_confirmed', false),
    case when public.liveops_bool(p_input,'backup_confirmed', false) then auth.uid() end,
    public.liveops_txt(p_input,'destinations_client'), public.liveops_txt(p_input,'delivered_files_client'),
    public.liveops_txt(p_input,'delivered_files_internal'), public.liveops_txt(p_input,'recommendations'),
    public.liveops_txt(p_input,'client_summary'), public.liveops_txt(p_input,'internal_summary'),
    v_status, auth.uid())
  on conflict (session_id) do update set
    planned_start_at = s.starts_at, planned_end_at = s.expected_end_at,
    actual_start_at = s.actual_start_at, actual_end_at = s.actual_end_at,
    uptime_pct = coalesce(public.liveops_num(p_input,'uptime_pct'), r.uptime_pct),
    interruptions_count = coalesce(public.liveops_int(p_input,'interruptions_count'), r.interruptions_count),
    interruption_minutes = coalesce(public.liveops_int(p_input,'interruption_minutes'), r.interruption_minutes),
    incident_summary_internal = coalesce(public.liveops_txt(p_input,'incident_summary_internal'), r.incident_summary_internal),
    incident_summary_client = coalesce(public.liveops_txt(p_input,'incident_summary_client'), r.incident_summary_client),
    recording_confirmed = case when p_input ? 'recording_confirmed'
      then public.liveops_bool(p_input,'recording_confirmed', r.recording_confirmed) else r.recording_confirmed end,
    recording_confirmed_by = case when public.liveops_bool(p_input,'recording_confirmed', r.recording_confirmed)
      then coalesce(r.recording_confirmed_by, auth.uid()) else null end,
    backup_confirmed = case when p_input ? 'backup_confirmed'
      then public.liveops_bool(p_input,'backup_confirmed', r.backup_confirmed) else r.backup_confirmed end,
    backup_confirmed_by = case when public.liveops_bool(p_input,'backup_confirmed', r.backup_confirmed)
      then coalesce(r.backup_confirmed_by, auth.uid()) else null end,
    destinations_client = coalesce(public.liveops_txt(p_input,'destinations_client'), r.destinations_client),
    delivered_files_client = coalesce(public.liveops_txt(p_input,'delivered_files_client'), r.delivered_files_client),
    delivered_files_internal = coalesce(public.liveops_txt(p_input,'delivered_files_internal'), r.delivered_files_internal),
    recommendations = coalesce(public.liveops_txt(p_input,'recommendations'), r.recommendations),
    client_summary = coalesce(public.liveops_txt(p_input,'client_summary'), r.client_summary),
    internal_summary = coalesce(public.liveops_txt(p_input,'internal_summary'), r.internal_summary),
    -- تعديل تقرير معتمَد يعيده إلى المراجعة: لا يتغيّر مستند معتمَد بصمت.
    status = case when r.status = 'approved' then 'pending_approval' else v_status end,
    approved_by = case when r.status = 'approved' then null else r.approved_by end,
    approved_at = case when r.status = 'approved' then null else r.approved_at end;

  perform public.liveops_log('report_upsert','liveops_report',v_session,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'session_id', v_session,
    'uptime_basis','manual_estimate',
    'note_ar','نسبة التشغيل تقدير بشريّ ما دامت القياسات غير موصولة. لا تُعرَض كرقم مقيس.');
end $fn$;

create or replace function public.liveops_report_approve(p_session uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  if not coalesce(public.liveops_can_approve_report(), false) then
    perform public.liveops_log('report_approve','liveops_report',p_session,p_session,false,'{}'::jsonb);
    raise exception 'not authorized: اعتماد التقرير يتطلّب صلاحية اعتماد.';
  end if;
  select * into r from public.liveops_reports where session_id = p_session for update;
  if not found then raise exception 'not found'; end if;
  if r.client_summary is null or length(btrim(r.client_summary)) < 10 then
    raise exception 'validation: الملخّص المخصَّص للعميل إلزاميّ قبل الاعتماد.';
  end if;
  update public.liveops_reports set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where session_id = p_session;
  perform public.liveops_log('report_approve','liveops_report',p_session,p_session,true,
    jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'session_id', p_session, 'status','approved',
    'uptime_basis', r.uptime_basis);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §16  روابط العميل — إنشاء/إصدار/إلغاء/سرد/تدقيق.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_link_create(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_session uuid; v_id uuid; v_exp timestamptz;
begin
  if not coalesce(public.liveops_can_issue_client_link(), false) then
    raise exception 'not authorized: إنشاء رابط عميل يتطلّب صلاحية صريحة.';
  end if;
  v_session := public.liveops_uuid(p_input,'live_session_id');
  if v_session is null or not exists (select 1 from public.liveops_sessions where id = v_session) then
    raise exception 'not found';
  end if;
  v_exp := coalesce(public.liveops_ts(p_input,'expires_at'), now() + interval '24 hours');
  if v_exp <= now() then raise exception 'validation: تاريخ الانتهاء يجب أن يكون في المستقبل.'; end if;
  if v_exp > now() + interval '30 days' then
    raise exception 'validation: أقصى مدّة لرابط عميل ٣٠ يومًا.';
  end if;

  insert into public.liveops_client_links(session_id, label, recipient_org, starts_at, expires_at, max_opens, created_by)
  values (v_session, public.liveops_txt(p_input,'label'), public.liveops_txt(p_input,'recipient_org'),
    coalesce(public.liveops_ts(p_input,'starts_at'), now()), v_exp,
    public.liveops_int(p_input,'max_opens'), auth.uid())
  returning id into v_id;

  perform public.liveops_log('link_create','liveops_client_link',v_id,v_session,true,'{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id, 'status','draft',
    'note_ar','أُنشئ الرابط بلا رمز. الرمز يُصدَر بخطوة منفصلة ويظهر مرّة واحدة.');
end $fn$;

create or replace function public.liveops_link_issue(p_link uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record; v_token text; v_hash text;
begin
  if not coalesce(public.liveops_can_issue_client_link(), false) then
    raise exception 'not authorized: إصدار رمز عميل يتطلّب صلاحية صريحة.';
  end if;
  select * into g from public.liveops_client_links where id = p_link for update;
  if not found then raise exception 'not found'; end if;
  if g.token_hash is not null then
    raise exception 'conflict: صدر رمز لهذا الرابط ولا يُعاد إظهاره. ألغِه وأنشئ غيره.';
  end if;
  if g.expires_at <= now() then raise exception 'conflict: انتهت نافذة الرابط.'; end if;

  -- ٢٥٦ بت عشوائية. ولا يُخزَّن الرمز: البصمة فقط.
  v_token := 'klv_' || replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_hash  := encode(sha256(convert_to(v_token,'utf8')),'hex');

  update public.liveops_client_links
     set token_hash = v_hash, token_hint = right(v_token,6),
         token_issued_at = now(), token_issued_by = auth.uid(), status = 'active'
   where id = p_link;

  perform public.liveops_log('link_issue','liveops_client_link',p_link,g.session_id,true,
    jsonb_build_object('expires_at', g.expires_at));
  return jsonb_build_object('ok', true, 'id', p_link, 'status','active',
    'token', v_token, 'token_hint', right(v_token,6), 'expires_at', g.expires_at,
    'delivery_enabled', false,
    'note_ar','يظهر هذا الرمز مرّة واحدة ولا يُخزَّن. انسخه الآن وسلّمه بنفسك — النظام لا يرسل بريدًا ولا رسالة.');
end $fn$;

create or replace function public.liveops_link_revoke(p_link uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record;
begin
  if not coalesce(public.liveops_can_issue_client_link(), false) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'validation: سبب الإلغاء إلزاميّ.'; end if;
  select * into g from public.liveops_client_links where id = p_link for update;
  if not found then raise exception 'not found'; end if;
  if g.status = 'revoked' then
    return jsonb_build_object('ok', true, 'id', p_link, 'status','revoked','already', true);
  end if;
  update public.liveops_client_links
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = p_reason
   where id = p_link;
  perform public.liveops_log('link_revoke','liveops_client_link',p_link,g.session_id,true,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'id', p_link, 'status','revoked',
    'note_ar','توقّف الرابط فورًا. أيّ نسخة لدى المتلقّي لم تعد تفتح شيئًا.');
end $fn$;

create or replace function public.liveops_link_list(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb;
begin
  if not coalesce(public.liveops_can_issue_client_link(), false) then
    raise exception 'not authorized: سرد روابط العملاء يتطلّب صلاحية صريحة.';
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', l.id, 'label', l.label, 'recipient_org', l.recipient_org,
      'status', case when l.status = 'active' and l.expires_at <= now() then 'expired'
                     when l.status = 'active' and l.max_opens is not null and l.opens_used >= l.max_opens then 'exhausted'
                     else l.status end,
      'starts_at', l.starts_at, 'expires_at', l.expires_at,
      'max_opens', l.max_opens, 'opens_used', l.opens_used, 'last_opened_at', l.last_opened_at,
      -- ⛔ token_hash لا يخرج أبدًا. التلميح ٦ محارف للتمييز البصريّ فقط.
      'token_hint', l.token_hint, 'token_issued_at', l.token_issued_at,
      'revoked_at', l.revoked_at, 'revoke_reason', l.revoke_reason,
      'created_at', l.created_at) as x
      from public.liveops_client_links l where l.session_id = p_session) t;
  return jsonb_build_object('rows', v_rows, 'delivery_enabled', false);
end $fn$;

create or replace function public.liveops_link_audit(p_link uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb;
begin
  if not coalesce(public.liveops_can_issue_client_link(), false) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', a.at, 'allowed', a.allowed, 'denied_reason', a.denied_reason,
           'fingerprint', left(coalesce(a.fingerprint,''),12)) order by a.at desc), '[]'::jsonb)
    into v_rows from public.liveops_link_access_log a where a.link_id = p_link;
  return jsonb_build_object('rows', v_rows,
    'note_ar','يشمل المحاولات المرفوضة عمدًا: سجلّ يحفظ النجاح وحده يجعل تخمين الرموز غير مرئيّ.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §17  ★★ باني حمولة العميل — مصدر واحد لا مصدران ★★
--
--   يُستعمَل من مكانين: liveops_client_view (الرمز) و liveops_client_preview
--   (معاينة الطاقم). باني واحد يعني أنّ ما يراه الموظّف في المعاينة **هو**
--   ما يراه العميل حرفيًّا؛ بانيان يعني انحرافًا صامتًا يومًا ما.
--
--   ⛔ لا `select *` في أيّ سطر. كلّ حقل مذكور بالاسم.
--   ⛔ لا يخرج من هنا: IP، مفتاح بثّ، اعتماد، حادثة داخلية، سبب عطل، اسم
--      مستخدم داخليّ، مسار تخزين، رقم تسلسليّ، تكلفة، ملاحظة داخلية، طوبولوجيا
--      نسخ احتياطي، هاتف، بريد، اسم موظّف غير معتمَد، ولا معرّف جلسة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_client_payload(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  -- ⚠️ متغيّرات قياسية لا record: قراءة حقل من record لم تُسنَد إليه صفوف ترفع
  --    «record is not assigned yet»، وهي حالة طبيعية هنا (جلسة بلا رَنداون).
  v_title text; v_client_status text; v_starts timestamptz; v_expected timestamptz;
  v_astart timestamptz; v_aend timestamptz; v_client_notes text;
  v_cur_no int; v_cur_title text; v_cur_sched timestamptz; v_cur_status text; v_cur_delay int;
  v_nxt_title text; v_nxt_sched timestamptz; v_nxt_status text;
  v_h_dest text; v_h_rec text; v_h_enc text; v_h_source text; v_h_at timestamptz; v_h_verified timestamptz;
  v_rep_status text; v_rep_client_summary text; v_rep_inc text;
  v_rep_ps timestamptz; v_rep_pe timestamptz; v_rep_as timestamptz; v_rep_ae timestamptz;
  v_rep_uptime numeric; v_rep_basis text; v_rep_int_count int; v_rep_int_min int;
  v_rep_recording boolean; v_rep_backup boolean; v_rep_dest text; v_rep_files text; v_rep_approved timestamptz;
  v_cams int; v_cams_total int; v_elapsed int; v_remaining int; v_delay int;
  v_stream text; v_recording text; v_connection text; v_basis text; v_verified timestamptz;
begin
  select s.title, s.client_status, s.starts_at, s.expected_end_at,
         s.actual_start_at, s.actual_end_at, s.client_notes
    into v_title, v_client_status, v_starts, v_expected, v_astart, v_aend, v_client_notes
    from public.liveops_sessions s where s.id = p_session;
  if not found then return jsonb_build_object('ok', false, 'reason','invalid_or_expired'); end if;

  -- الفقرة الحالية: ما هو على الهواء، وإلّا أوّل بند جاهز/مخطَّط مرئيّ للعميل.
  select r.item_no, r.title, r.scheduled_at, r.status, r.delay_seconds
    into v_cur_no, v_cur_title, v_cur_sched, v_cur_status, v_cur_delay
    from public.liveops_rundown r
   where r.session_id = p_session and r.client_visible = true and r.status = 'on_air'
   order by r.item_no limit 1;
  if v_cur_no is null then
    select r.item_no, r.title, r.scheduled_at, r.status, r.delay_seconds
      into v_cur_no, v_cur_title, v_cur_sched, v_cur_status, v_cur_delay
      from public.liveops_rundown r
     where r.session_id = p_session and r.client_visible = true and r.status in ('ready','planned','delayed')
     order by r.item_no limit 1;
  end if;
  select r.title, r.scheduled_at, r.status
    into v_nxt_title, v_nxt_sched, v_nxt_status
    from public.liveops_rundown r
   where r.session_id = p_session and r.client_visible = true
     and (v_cur_no is null or r.item_no > v_cur_no)
     and r.status in ('planned','ready','delayed')
   order by r.item_no limit 1;

  -- عدّ آمن للكاميرات: رقم فقط. لا تسميات ولا أرقام تسلسلية ولا مواقع.
  select count(*) filter (where i.tech_status in ('ready','active','recovered')),
         count(*)
    into v_cams, v_cams_total
    from public.liveops_inventory i
   where i.session_id = p_session and i.category = 'camera';

  -- آخر قراءة شبكة. تُترجَم إلى **كلمة عامّة** لا إلى أرقام: معدّل الإرسال
  -- والزمن والفقد تفاصيل تشغيل داخليّة لا يحتاجها العميل وتُقرأ كدليل عطل.
  select h2.encoder_state, h2.destination_state, h2.recording_state, h2.source, h2.last_verified_at, h2.at
    into v_h_enc, v_h_dest, v_h_rec, v_h_source, v_h_verified, v_h_at
    from public.liveops_stream_health h2
   where h2.session_id = p_session order by h2.at desc limit 1;

  if v_h_source is null then
    -- لا قراءة أصلًا. «غير معروف» + «القياسات غير موصولة» — لا «سليم».
    v_stream := 'unknown'; v_recording := 'unknown'; v_connection := 'unknown';
    v_basis := 'telemetry_not_connected'; v_verified := null;
  else
    v_stream := case when v_h_dest in ('active','ready','recovered') then 'nominal'
                     when v_h_dest in ('warning','degraded','standby') then 'degraded'
                     when v_h_dest in ('offline','failed') then 'interrupted'
                     else 'unknown' end;
    v_recording := case when v_h_rec in ('active','ready','recovered') then 'recording'
                        when v_h_rec in ('warning','degraded','standby') then 'degraded'
                        when v_h_rec in ('offline','failed') then 'stopped'
                        else 'unknown' end;
    v_connection := case when v_h_enc in ('active','ready','recovered') then 'nominal'
                         when v_h_enc in ('warning','degraded','standby') then 'degraded'
                         when v_h_enc in ('offline','failed') then 'interrupted'
                         else 'unknown' end;
    v_basis := v_h_source; v_verified := coalesce(v_h_verified, v_h_at);
  end if;

  v_elapsed := case when v_astart is not null
                    then greatest(0, (extract(epoch from (coalesce(v_aend, now()) - v_astart)))::int)
                    else null end;
  v_remaining := case when v_expected is not null and v_aend is null
                      then greatest(0, (extract(epoch from (v_expected - now())))::int)
                      else null end;
  v_delay := coalesce(v_cur_delay, 0);

  select rp.status, rp.client_summary, rp.incident_summary_client, rp.planned_start_at, rp.planned_end_at,
         rp.actual_start_at, rp.actual_end_at, rp.uptime_pct, rp.uptime_basis, rp.interruptions_count,
         rp.interruption_minutes, rp.recording_confirmed, rp.backup_confirmed, rp.destinations_client,
         rp.delivered_files_client, rp.approved_at
    into v_rep_status, v_rep_client_summary, v_rep_inc, v_rep_ps, v_rep_pe,
         v_rep_as, v_rep_ae, v_rep_uptime, v_rep_basis, v_rep_int_count,
         v_rep_int_min, v_rep_recording, v_rep_backup, v_rep_dest,
         v_rep_files, v_rep_approved
    from public.liveops_reports rp where rp.session_id = p_session;

  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'title', v_title,
      'status', v_client_status,
      'starts_at', v_starts,
      'expected_end_at', v_expected,
      'elapsed_seconds', v_elapsed,
      'remaining_seconds', v_remaining,
      'schedule_delay_seconds', v_delay,
      'notes', v_client_notes),
    'segments', jsonb_build_object(
      'current', case when v_cur_title is null then null else
        jsonb_build_object('title', v_cur_title, 'scheduled_at', v_cur_sched, 'status', v_cur_status) end,
      'next', case when v_nxt_title is null then null else
        jsonb_build_object('title', v_nxt_title, 'scheduled_at', v_nxt_sched, 'status', v_nxt_status) end),
    'cameras', jsonb_build_object('active', coalesce(v_cams,0), 'planned', coalesce(v_cams_total,0)),
    'technical', jsonb_build_object(
      'stream', v_stream, 'recording', v_recording, 'connection', v_connection,
      -- ★ الصدق: هذه ليست قياسات. الحقل يقول ذلك بنفسه في كلّ استجابة.
      'basis', v_basis, 'telemetry_connected', false, 'last_verified_at', v_verified),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'role', p.role_label)
                                order by p.sort_order, p.display_name)
                          from public.liveops_client_people p where p.session_id = p_session), '[]'::jsonb),
    'bulletins', coalesce((select jsonb_agg(jsonb_build_object(
                            'level', b.level, 'title', b.title, 'body', b.body, 'at', b.published_at)
                            order by b.published_at desc)
                            from public.liveops_bulletins b
                           where b.session_id = p_session and b.is_published = true), '[]'::jsonb),
    -- الحوادث: الملخّص المعتمَد فقط، والسبب الجذريّ فقط عند إفراج صريح.
    'incidents', coalesce((select jsonb_agg(jsonb_build_object(
                            'at', i.opened_at, 'summary', i.client_summary,
                            'resolved', (i.resolved_at is not null),
                            'root_cause', case when i.root_cause_released then i.root_cause else null end)
                            order by i.opened_at desc)
                            from public.liveops_incidents i
                           where i.session_id = p_session and i.client_summary_approved = true), '[]'::jsonb),
    -- التقرير لا يخرج إلّا معتمَدًا. مسوّدة أو «بانتظار الاعتماد» = لا شيء.
    'report', case when v_rep_status is distinct from 'approved' then null else
      jsonb_build_object(
        'approved_at', v_rep_approved,
        'summary', v_rep_client_summary,
        'incident_summary', v_rep_inc,
        'planned_start_at', v_rep_ps, 'planned_end_at', v_rep_pe,
        'actual_start_at', v_rep_as, 'actual_end_at', v_rep_ae,
        'uptime_pct', v_rep_uptime,
        -- ⚠️ لا يُعرَض رقم التشغيل بلا هذه الكلمة إلى جانبه.
        'uptime_basis', v_rep_basis,
        'interruptions_count', v_rep_int_count,
        'interruption_minutes', v_rep_int_min,
        'recording_confirmed', v_rep_recording,
        'backup_confirmed', v_rep_backup,
        'destinations', v_rep_dest,
        'delivered_files', v_rep_files) end,
    'note_ar','كلّ الحالات الفنّية هنا إدخال بشريّ. لا يوجد اتصال مباشر بأجهزة البثّ في هذه النسخة.');
end $fn$;

-- ★★ السطح الخارجيّ الوحيد ★★
--   • استجابة **متطابقة حرفيًّا** لرمز مجهول ومنتهٍ وملغى ومستنفَد وخارج
--     النافذة: لا يصلح الرابط أوراكلًا يخبر المهاجم أنّه اقترب.
--   • لا فهرسة: لا سبيل من هنا إلى جلسة أخرى ولا إلى قائمة جلسات.
--   • كلّ محاولة تُسجَّل، والمرفوضة قبل المقبولة.
create or replace function public.liveops_client_view(p_token text, p_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  g record; v_hash text; v_fp text; v_deny text;
  DENY constant jsonb := jsonb_build_object('ok', false, 'reason','invalid_or_expired');
begin
  v_fp := case when p_fingerprint ~ '^[0-9a-f]{64}$' then p_fingerprint else null end;

  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then
    insert into public.liveops_link_access_log(link_id, session_id, allowed, denied_reason, fingerprint)
    values (null, null, false, 'malformed_token', v_fp);
    return DENY;
  end if;

  v_hash := encode(sha256(convert_to(p_token,'utf8')),'hex');
  select * into g from public.liveops_client_links where token_hash = v_hash for update;

  if not found then
    insert into public.liveops_link_access_log(link_id, session_id, allowed, denied_reason, fingerprint)
    values (null, null, false, 'unknown_token', v_fp);
    return DENY;                                   -- ★ نفس الاستجابة تمامًا
  end if;

  v_deny := case
    when g.status = 'revoked' then 'revoked'
    when g.status <> 'active' then 'not_active'
    when g.starts_at > now() then 'not_started'
    when g.expires_at <= now() then 'expired'
    when g.max_opens is not null and g.opens_used >= g.max_opens then 'exhausted'
    else null end;

  if v_deny is not null then
    insert into public.liveops_link_access_log(link_id, session_id, allowed, denied_reason, fingerprint)
    values (g.id, g.session_id, false, v_deny, v_fp);
    -- الحالة تُصحَّح في الجدول للتقارير، والاستجابة تبقى واحدة.
    if v_deny in ('expired','exhausted') then
      update public.liveops_client_links set status = v_deny where id = g.id and status = 'active';
    end if;
    return DENY;                                   -- ★ نفس الاستجابة تمامًا
  end if;

  update public.liveops_client_links
     set opens_used = opens_used + 1, last_opened_at = now()
   where id = g.id;

  insert into public.liveops_link_access_log(link_id, session_id, allowed, denied_reason, fingerprint)
  values (g.id, g.session_id, true, null, v_fp);

  return public.liveops_client_payload(g.session_id)
         || jsonb_build_object('opens_left',
              case when g.max_opens is null then null else greatest(0, g.max_opens - g.opens_used - 1) end,
              'expires_at', g.expires_at);
end $fn$;

-- معاينة الطاقم — **نفس** الباني، بلا رمز، للموظّف المخوَّل فقط.
create or replace function public.liveops_client_preview(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not coalesce(public.liveops_can_read_session(p_session), false) then
    raise exception 'not authorized';
  end if;
  return public.liveops_client_payload(p_session)
         || jsonb_build_object('preview', true,
              'note_preview_ar','هذه بالضبط الحمولة التي يستلمها حامل الرابط — الباني واحد لا اثنان.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §18  القراءات الداخلية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.liveops_session_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb; v_status text; v_q text;
begin
  if not coalesce(public.liveops_can_view(), false) then
    raise exception 'not authorized: لوحة العمليات المباشرة داخلية.';
  end if;
  v_status := public.liveops_txt(p_filters,'status');
  v_q := public.liveops_txt(p_filters,'q');
  select coalesce(jsonb_agg(x order by x ->> 'starts_at' desc nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', s.id, 'session_code', s.session_code, 'title', s.title, 'internal_ref', s.internal_ref,
      'status', s.status, 'client_status', s.client_status, 'event_date', s.event_date,
      'starts_at', s.starts_at, 'expected_end_at', s.expected_end_at,
      'actual_start_at', s.actual_start_at, 'actual_end_at', s.actual_end_at,
      'venue', s.venue, 'control_room', s.control_room,
      'project_id', s.project_id, 'prodops_job_id', s.prodops_job_id,
      'open_incidents', (select count(*) from public.liveops_incidents i
                          where i.session_id = s.id and i.resolved_at is null),
      'active_links', (select count(*) from public.liveops_client_links l
                        where l.session_id = s.id and l.status = 'active' and l.expires_at > now()),
      'can_operate', public.liveops_can_operate_session(s.id)) as x
      from public.liveops_sessions s
     where (v_status is null or s.status = v_status)
       and (v_q is null or s.title ilike '%' || replace(v_q, '_', '\_') || '%' escape '\' or coalesce(s.session_code,'') ilike '%' || replace(v_q, '_', '\_') || '%' escape '\'
            or coalesce(s.internal_ref,'') ilike '%' || replace(v_q, '_', '\_') || '%' escape '\')) t;
  return jsonb_build_object('rows', v_rows, 'can_manage', coalesce(public.liveops_can_manage(), false));
end $fn$;

create or replace function public.liveops_session_detail(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare s record; v_can_operate boolean;
begin
  if not coalesce(public.liveops_can_read_session(p_session), false) then
    raise exception 'not authorized: لوحة العمليات المباشرة داخلية.';
  end if;
  select * into s from public.liveops_sessions where id = p_session;
  if not found then raise exception 'not found'; end if;
  v_can_operate := coalesce(public.liveops_can_operate_session(p_session), false);

  return jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', s.id, 'session_code', s.session_code, 'title', s.title, 'internal_ref', s.internal_ref,
      'prodops_job_id', s.prodops_job_id, 'project_id', s.project_id, 'event_date', s.event_date,
      'starts_at', s.starts_at, 'expected_end_at', s.expected_end_at,
      'actual_start_at', s.actual_start_at, 'actual_end_at', s.actual_end_at,
      'venue', s.venue, 'control_room', s.control_room, 'status', s.status,
      'client_status', s.client_status,
      'operations_manager_id', s.operations_manager_id, 'broadcast_director_id', s.broadcast_director_id,
      'technical_director_id', s.technical_director_id,
      'primary_contact_name', s.primary_contact_name, 'primary_contact_phone', s.primary_contact_phone,
      'emergency_contact_name', s.emergency_contact_name, 'emergency_contact_phone', s.emergency_contact_phone,
      'internal_notes', s.internal_notes, 'client_notes', s.client_notes),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category', i.category, 'label', i.label, 'item_role', i.item_role,
        'assigned_user_id', i.assigned_user_id, 'assigned_name', i.assigned_name,
        'tech_status', i.tech_status, 'health', i.health, 'last_checked_at', i.last_checked_at,
        'issue', i.issue, 'client_visible', i.client_visible, 'internal_notes', i.internal_notes,
        'sort_order', i.sort_order) order by i.category, i.sort_order, i.label)
        from public.liveops_inventory i where i.session_id = p_session), '[]'::jsonb),
    'health', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'at', h.at, 'connection', h.connection, 'upload_kbps', h.upload_kbps,
        'latency_ms', h.latency_ms, 'packet_loss_pct', h.packet_loss_pct,
        'current_bitrate_kbps', h.current_bitrate_kbps, 'target_bitrate_kbps', h.target_bitrate_kbps,
        'encoder_state', h.encoder_state, 'destination_state', h.destination_state,
        'recording_state', h.recording_state, 'failover_active', h.failover_active,
        'source', h.source, 'last_verified_at', h.last_verified_at, 'note', h.note)
        order by h.at desc)
        from (select * from public.liveops_stream_health where session_id = p_session
               order by at desc limit 50) h), '[]'::jsonb),
    'rundown', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'item_no', r.item_no, 'scheduled_at', r.scheduled_at, 'actual_at', r.actual_at,
        'title', r.title, 'duration_seconds', r.duration_seconds, 'speaker', r.speaker,
        'media', r.media, 'camera_plan', r.camera_plan, 'graphics_cue', r.graphics_cue,
        'audio_cue', r.audio_cue, 'notes', r.notes, 'status', r.status,
        'delay_seconds', r.delay_seconds, 'client_visible', r.client_visible) order by r.item_no)
        from public.liveops_rundown r where r.session_id = p_session), '[]'::jsonb),
    'cues', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'at', c.at, 'cue_type', c.cue_type, 'rundown_item_id', c.rundown_item_id,
        'note', c.note) order by c.at desc)
        from (select * from public.liveops_cues where session_id = p_session order by at desc limit 100) c), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'incident_no', x.incident_no, 'category', x.category, 'severity', x.severity,
        'opened_at', x.opened_at, 'detected_by_label', x.detected_by_label,
        'description', x.description, 'affected_systems', to_jsonb(x.affected_systems),
        'client_summary', x.client_summary, 'client_summary_approved', x.client_summary_approved,
        'root_cause', x.root_cause, 'root_cause_released', x.root_cause_released,
        'mitigation', x.mitigation, 'resolved_at', x.resolved_at,
        'post_event_action', x.post_event_action) order by x.opened_at desc)
        from public.liveops_incidents x where x.session_id = p_session), '[]'::jsonb),
    'bulletins', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'level', b.level, 'title', b.title, 'body', b.body,
        'is_published', b.is_published, 'published_at', b.published_at) order by b.created_at desc)
        from public.liveops_bulletins b where b.session_id = p_session), '[]'::jsonb),
    'client_people', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'role_label', p.role_label,
        'approved_at', p.approved_at) order by p.sort_order)
        from public.liveops_client_people p where p.session_id = p_session), '[]'::jsonb),
    'report', (select jsonb_build_object(
        'status', rp.status, 'uptime_pct', rp.uptime_pct, 'uptime_basis', rp.uptime_basis,
        'interruptions_count', rp.interruptions_count, 'interruption_minutes', rp.interruption_minutes,
        'incident_summary_internal', rp.incident_summary_internal,
        'incident_summary_client', rp.incident_summary_client,
        'recording_confirmed', rp.recording_confirmed, 'backup_confirmed', rp.backup_confirmed,
        'destinations_client', rp.destinations_client,
        'delivered_files_client', rp.delivered_files_client,
        'delivered_files_internal', rp.delivered_files_internal,
        'recommendations', rp.recommendations, 'client_summary', rp.client_summary,
        'internal_summary', rp.internal_summary, 'approved_at', rp.approved_at)
        from public.liveops_reports rp where rp.session_id = p_session),
    'permissions', jsonb_build_object(
      'can_operate', v_can_operate,
      'can_manage', coalesce(public.liveops_can_manage(), false),
      'can_issue_link', coalesce(public.liveops_can_issue_client_link(), false),
      'can_reveal_root_cause', coalesce(public.liveops_can_reveal_root_cause(), false),
      'can_approve_report', coalesce(public.liveops_can_approve_report(), false)),
    'telemetry', jsonb_build_object(
      'connected', false, 'adapter', null, 'state','telemetry_not_connected',
      'note_ar','لا يوجد اتصال بأجهزة البثّ في هذه النسخة. كلّ الحالات الفنّية إدخال بشريّ.'));
end $fn$;

-- لوحة «الآن» — الفقرة الحالية والتالية والانقضاء والتأخّر.
create or replace function public.liveops_live_board(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_status text; v_client_status text; v_starts timestamptz; v_expected timestamptz;
  v_astart timestamptz; v_aend timestamptz;
  v_cur_id uuid; v_cur_no int; v_cur_title text; v_cur_sched timestamptz;
  v_cur_actual timestamptz; v_cur_delay int;
  v_nxt_id uuid; v_nxt_no int; v_nxt_title text; v_nxt_sched timestamptz;
  v_elapsed int; v_remaining int;
begin
  if not coalesce(public.liveops_can_read_session(p_session), false) then raise exception 'not authorized'; end if;
  select s.status, s.client_status, s.starts_at, s.expected_end_at, s.actual_start_at, s.actual_end_at
    into v_status, v_client_status, v_starts, v_expected, v_astart, v_aend
    from public.liveops_sessions s where s.id = p_session;
  if not found then raise exception 'not found'; end if;

  select r.id, r.item_no, r.title, r.scheduled_at, r.actual_at, r.delay_seconds
    into v_cur_id, v_cur_no, v_cur_title, v_cur_sched, v_cur_actual, v_cur_delay
    from public.liveops_rundown r
   where r.session_id = p_session and r.status = 'on_air' order by r.item_no limit 1;
  select r.id, r.item_no, r.title, r.scheduled_at
    into v_nxt_id, v_nxt_no, v_nxt_title, v_nxt_sched
    from public.liveops_rundown r
   where r.session_id = p_session and (v_cur_no is null or r.item_no > v_cur_no)
     and r.status in ('planned','ready','delayed') order by r.item_no limit 1;

  v_elapsed := case when v_astart is not null
                    then greatest(0,(extract(epoch from (coalesce(v_aend, now()) - v_astart)))::int) end;
  v_remaining := case when v_expected is not null and v_aend is null
                      then greatest(0,(extract(epoch from (v_expected - now())))::int) end;

  return jsonb_build_object('ok', true, 'status', v_status, 'client_status', v_client_status,
    'elapsed_seconds', v_elapsed, 'remaining_seconds', v_remaining,
    'schedule_delay_seconds', coalesce(v_cur_delay, 0),
    'current', case when v_cur_id is null then null else jsonb_build_object(
       'id', v_cur_id, 'item_no', v_cur_no, 'title', v_cur_title,
       'scheduled_at', v_cur_sched, 'actual_at', v_cur_actual) end,
    'next', case when v_nxt_id is null then null else jsonb_build_object(
       'id', v_nxt_id, 'item_no', v_nxt_no, 'title', v_nxt_title, 'scheduled_at', v_nxt_sched) end,
    'open_incidents', (select count(*) from public.liveops_incidents i
                        where i.session_id = p_session and i.resolved_at is null),
    'inventory_alarms', (select count(*) from public.liveops_inventory i
                          where i.session_id = p_session
                            and (i.tech_status in ('warning','degraded','offline','failed') or i.health = 'critical')),
    'telemetry_connected', false);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- §19  المنح.
--   ⛔ anon لا يحصل على شيء إطلاقًا.
--   ⛔ liveops_client_view و liveops_client_payload لـservice_role وحده: أوّلها
--      يُستدعى من مسار خادم يحمل المفتاح في الخادم، والثاني باني داخليّ.
-- ════════════════════════════════════════════════════════════════════════════
do $gr$
declare t text;
begin
  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_client_links',
                           'liveops_link_access_log','liveops_audit'] loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;

  -- قراءة فقط، وتحت RLS. الروابط وسجلّها **لا يُقرآن مباشرة أبدًا**.
  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_audit'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $gr$;

revoke all on function
  public.liveops_client_view(text,text),
  public.liveops_client_payload(uuid)
  from public, anon, authenticated;
grant execute on function public.liveops_client_view(text,text) to service_role;

revoke all on function
  public.liveops_session_upsert(jsonb),
  public.liveops_session_set_status(uuid,text,text,text),
  public.liveops_session_list(jsonb),
  public.liveops_session_detail(uuid),
  public.liveops_live_board(uuid),
  public.liveops_client_preview(uuid),
  public.liveops_inventory_upsert(jsonb),
  public.liveops_inventory_set_state(uuid,text,text,text),
  public.liveops_inventory_delete(uuid,text),
  public.liveops_health_record(jsonb),
  public.liveops_rundown_upsert(jsonb),
  public.liveops_rundown_set_status(uuid,text,timestamptz),
  public.liveops_rundown_delete(uuid,text),
  public.liveops_cue_log(uuid,text,uuid,text),
  public.liveops_incident_open(jsonb),
  public.liveops_incident_update(jsonb),
  public.liveops_incident_resolve(uuid,text,text),
  public.liveops_incident_release_root_cause(uuid,boolean,text),
  public.liveops_bulletin_upsert(jsonb),
  public.liveops_client_person_upsert(jsonb),
  public.liveops_client_person_delete(uuid),
  public.liveops_report_upsert(jsonb),
  public.liveops_report_approve(uuid,text),
  public.liveops_link_create(jsonb),
  public.liveops_link_issue(uuid),
  public.liveops_link_revoke(uuid,text),
  public.liveops_link_list(uuid),
  public.liveops_link_audit(uuid)
  from public, anon;

grant execute on function
  public.liveops_session_upsert(jsonb),
  public.liveops_session_set_status(uuid,text,text,text),
  public.liveops_session_list(jsonb),
  public.liveops_session_detail(uuid),
  public.liveops_live_board(uuid),
  public.liveops_client_preview(uuid),
  public.liveops_inventory_upsert(jsonb),
  public.liveops_inventory_set_state(uuid,text,text,text),
  public.liveops_inventory_delete(uuid,text),
  public.liveops_health_record(jsonb),
  public.liveops_rundown_upsert(jsonb),
  public.liveops_rundown_set_status(uuid,text,timestamptz),
  public.liveops_rundown_delete(uuid,text),
  public.liveops_cue_log(uuid,text,uuid,text),
  public.liveops_incident_open(jsonb),
  public.liveops_incident_update(jsonb),
  public.liveops_incident_resolve(uuid,text,text),
  public.liveops_incident_release_root_cause(uuid,boolean,text),
  public.liveops_bulletin_upsert(jsonb),
  public.liveops_client_person_upsert(jsonb),
  public.liveops_client_person_delete(uuid),
  public.liveops_report_upsert(jsonb),
  public.liveops_report_approve(uuid,text),
  public.liveops_link_create(jsonb),
  public.liveops_link_issue(uuid),
  public.liveops_link_revoke(uuid,text),
  public.liveops_link_list(uuid),
  public.liveops_link_audit(uuid)
  to authenticated;

-- مفاتيح الصلاحيات الدقيقة — تدخل الكتالوج القائم إن كان مطبَّقًا، ولا تُنشئه.
do $p$
begin
  if to_regclass('public.permissions') is not null then
    execute $q$
      insert into public.permissions (key, category, sensitivity, label_ar, label_en, sort_order)
      select v.key, v.category, v.sensitivity, v.ar, v.en, v.ord
        from (values
          ('live_ops.view',           'operations','normal',   'عرض لوحة العمليات المباشرة','View live operations',      720),
          ('live_ops.operate',        'operations','normal',   'تشغيل جلسة مباشرة',          'Operate a live session',    721),
          ('live_ops.manage',         'operations','sensitive','إدارة العمليات المباشرة',     'Manage live operations',    722),
          ('live_ops.client_link',    'operations','sensitive','إصدار رابط متابعة للعميل',    'Issue client status link',  723),
          ('live_ops.report_approve', 'operations','sensitive','اعتماد تقرير ما بعد الفعالية','Approve post-event report', 724)
        ) as v(key, category, sensitivity, ar, en, ord)
      on conflict (key) do update set
        category = excluded.category, sensitivity = excluded.sensitivity,
        label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order
    $q$;
  end if;
end $p$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §20  SELF-TEST — ثابت بالكامل. لا نداء لدالّة محميّة (يعمل المحرّر بدور
--      postgres وauth.uid() = NULL، فالنداء يرفع «not authorized» ويقتل
--      الترحيلة). كلّ فحص من pg_catalog، ولا catch-all.
-- ════════════════════════════════════════════════════════════════════════════
begin;
do $st$
declare t text; f text; v_def text; n int;
begin
  -- (١) الجداول موجودة وRLS مفعّلة ومفروضة
  foreach t in array array['liveops_sessions','liveops_inventory','liveops_stream_health',
                           'liveops_rundown','liveops_cues','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_client_links',
                           'liveops_link_access_log','liveops_audit'] loop
    if to_regclass('public.'||t) is null then
      raise exception 'LIVEOPS SELF-TEST: الجدول % غائب', t; end if;
    if not (select c.relrowsecurity from pg_class c
             join pg_namespace ns on ns.oid = c.relnamespace
            where ns.nspname='public' and c.relname = t) then
      raise exception 'LIVEOPS SELF-TEST: RLS غير مفعّلة على %', t; end if;
    -- FORCE ممنوع هنا: يكسر دوالّ SECURITY DEFINER (اقرأ §13).
    if (select c.relforcerowsecurity from pg_class c
         join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname='public' and c.relname = t) then
      raise exception 'LIVEOPS SELF-TEST: FORCE RLS مفعّلة على % — ستُصفّر قراءات الدوالّ', t; end if;
  end loop;

  -- (٢) لا سياسة كتابة على أيّ جدول: كلّ كتابة عبر دالّة مدقَّقة
  select count(*) into n from pg_policies
   where schemaname='public' and tablename like 'liveops\_%' and cmd <> 'SELECT';
  if n > 0 then raise exception 'LIVEOPS SELF-TEST: وُجدت % سياسة كتابة — الكتابة يجب أن تمرّ بالدوالّ', n; end if;

  -- (٣) ⛔ لا منح لـanon على أيّ كائن من الوحدة
  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and table_name like 'liveops\_%' and grantee in ('anon','PUBLIC');
  if n > 0 then raise exception 'LIVEOPS SELF-TEST: anon يملك % منحًا على جداول الوحدة', n; end if;

  -- (٤) ★ روابط العميل وسجلّها لا يُقرآن مباشرة (لئلّا تخرج بصمة رمز)
  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and table_name in ('liveops_client_links','liveops_link_access_log')
     and grantee in ('authenticated','anon','PUBLIC');
  if n > 0 then raise exception 'LIVEOPS SELF-TEST: جدول الروابط مقروء مباشرة (% منح) — يجب أن يمرّ بدالّة', n; end if;

  -- (٥) ★ الدالّة الخارجية لا تُمنَح لـanon ولا لـauthenticated
  select count(*) into n from information_schema.role_routine_grants
   where routine_schema='public' and routine_name = 'liveops_client_view'
     and grantee in ('anon','authenticated','PUBLIC');
  if n > 0 then raise exception 'LIVEOPS SELF-TEST: liveops_client_view ممنوحة لدور عامّ (%)', n; end if;

  -- (٦) المُسنَدات كلّها boolean وبها coalesce صريح (لا NULL)
  foreach f in array array['liveops_is_client','liveops_can_view','liveops_can_manage',
                           'liveops_can_operate','liveops_can_operate_session','liveops_can_read_session',
                           'liveops_can_issue_client_link','liveops_can_reveal_root_cause',
                           'liveops_can_approve_report','liveops_perm'] loop
    if (select p.prorettype from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
         where ns.nspname='public' and p.proname=f limit 1) <> 'boolean'::regtype then
      raise exception 'LIVEOPS SELF-TEST: المُسنَد % لا يعيد boolean', f; end if;
    v_def := coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                        join pg_namespace ns on ns.oid=p.pronamespace
                       where ns.nspname='public' and p.proname=f limit 1),'');
    if v_def !~* '(coalesce|case)' then
      raise exception 'LIVEOPS SELF-TEST: % بلا coalesce/case — قد يعيد NULL', f; end if;
    if v_def !~* 'search_path' then
      raise exception 'LIVEOPS SELF-TEST: % بلا search_path مثبَّت', f; end if;
  end loop;

  -- (٧) ★★ الحمولة الخارجية لا تذكر عمودًا حسّاسًا إطلاقًا ★★
  v_def := coalesce(pg_get_functiondef(to_regprocedure('public.liveops_client_payload(uuid)')),'');
  if v_def = '' then raise exception 'LIVEOPS SELF-TEST: باني حمولة العميل غائب'; end if;
  foreach f in array array['internal_notes','primary_contact_phone','emergency_contact_phone',
                           'primary_contact_name','emergency_contact_name','token_hash','adapter_id',
                           'delivered_files_internal','internal_summary','incident_summary_internal',
                           'upload_kbps','latency_ms','packet_loss_pct','current_bitrate_kbps',
                           'target_bitrate_kbps','venue','control_room','session_code','internal_ref',
                           'mitigation','issue','operations_manager_id','broadcast_director_id',
                           'technical_director_id','assigned_name','prodops_job_id','project_id'] loop
    if v_def ilike '%' || replace(f, '_', '\_') || '%' escape '\' then
      raise exception 'LIVEOPS SELF-TEST: حمولة العميل تذكر العمود الحسّاس %', f; end if;
  end loop;
  if v_def ilike '%select *%' then
    raise exception 'LIVEOPS SELF-TEST: حمولة العميل تستعمل select * — القائمة البيضاء تنهار'; end if;
  -- description الداخليّ للحادثة ممنوع؛ client_summary هو المسموح
  if v_def ~* '\yi\.description\y' then
    raise exception 'LIVEOPS SELF-TEST: حمولة العميل تقرأ وصف الحادثة الداخليّ'; end if;
  if v_def !~* 'root_cause_released' then
    raise exception 'LIVEOPS SELF-TEST: السبب الجذريّ يخرج بلا شرط إفراج'; end if;
  if v_def !~* 'telemetry_connected' then
    raise exception 'LIVEOPS SELF-TEST: الحمولة لا تصرّح بحالة القياسات'; end if;

  -- (٨) ★ الاستجابة المرفوضة واحدة: DENY ثابت، ولا فرع يعيد سببًا مختلفًا
  v_def := coalesce(pg_get_functiondef(to_regprocedure('public.liveops_client_view(text,text)')),'');
  if v_def = '' then raise exception 'LIVEOPS SELF-TEST: liveops_client_view غائبة'; end if;
  select count(*) into n from regexp_matches(v_def, 'return DENY;', 'g');
  if n < 3 then raise exception 'LIVEOPS SELF-TEST: مسارات الرفض لا تعيد كلّها الاستجابة نفسها (%)', n; end if;
  if v_def !~* 'sha256' then raise exception 'LIVEOPS SELF-TEST: الرمز لا يُبصَم قبل البحث'; end if;
  -- لا مسار رفض يبني استجابته بنفسه: الرفض الوحيد هو الثابت DENY. أيّ
  -- jsonb_build_object('ok', false ... داخل هذه الدالّة يعني سببًا يتسرّب.
  if v_def ~ 'return jsonb_build_object\(''ok'', *false' then
    raise exception 'LIVEOPS SELF-TEST: مسار رفض يبني استجابته بنفسه — سبب الرفض يتسرّب إلى المتلقّي'; end if;
  if (select count(*) from regexp_matches(v_def, 'invalid_or_expired', 'g')) <> 1 then
    raise exception 'LIVEOPS SELF-TEST: أكثر من صياغة رفض واحدة في السطح الخارجيّ'; end if;

  -- (٩) ★ العميل لا يغيّر الحالة: الحارس موجود ويفحص is_client
  if not exists (select 1 from pg_trigger where tgname='liveops_sessions_guard' and not tgisinternal) then
    raise exception 'LIVEOPS SELF-TEST: حارس الحالة غير مركَّب'; end if;
  v_def := coalesce(pg_get_functiondef(to_regprocedure('public.liveops_session_guard()')),'');
  if v_def !~* 'liveops_is_client' or v_def !~* 'liveops_can_operate_session' or v_def !~* 'liveops_status_allowed' then
    raise exception 'LIVEOPS SELF-TEST: حارس الحالة لا يفحص العميل/السلطة/الانتقال'; end if;

  -- (١٠) ★ لا مسار يُنتج قياسًا حيًّا: القيد قائم، والدالّة ترفض telemetry_verified
  if not exists (select 1 from pg_constraint where conname='liveops_health_source_honest') then
    raise exception 'LIVEOPS SELF-TEST: قيد صدق مصدر القياس غائب'; end if;
  v_def := coalesce(pg_get_functiondef(to_regprocedure('public.liveops_health_record(jsonb)')),'');
  if v_def !~* 'telemetry_not_connected' or v_def ~* 'values[^;]*''telemetry_verified''' then
    raise exception 'LIVEOPS SELF-TEST: مسار يدويّ قد يُنتج قراءة موثَّقة'; end if;
  if not exists (select 1 from pg_trigger where tgname='liveops_reports_uptime' and not tgisinternal) then
    raise exception 'LIVEOPS SELF-TEST: حارس أساس نسبة التشغيل غير مركَّب'; end if;

  -- (١١) ماسح الأسرار مركَّب على كلّ جدول يحمل نصّ عميل
  foreach t in array array['liveops_sessions','liveops_incidents','liveops_bulletins',
                           'liveops_client_people','liveops_reports','liveops_rundown','liveops_inventory'] loop
    if not exists (select 1 from pg_trigger where tgname = t||'_secret_scan' and not tgisinternal) then
      raise exception 'LIVEOPS SELF-TEST: ماسح الأسرار غير مركَّب على %', t; end if;
  end loop;
  -- فحص وظيفيّ ثابت (دالّة immutable خالصة، لا سياق جلسة، آمن هنا)
  if public.liveops_secret_reason('the encoder is at 10.0.0.7') is distinct from 'ip_address' then
    raise exception 'LIVEOPS SELF-TEST: الماسح لا يلتقط عنوان IP'; end if;
  if public.liveops_secret_reason('rtmp://a.example/live') is distinct from 'stream_endpoint' then
    raise exception 'LIVEOPS SELF-TEST: الماسح لا يلتقط نقطة بثّ'; end if;
  if public.liveops_secret_reason('البثّ مستقرّ والتسجيل يعمل') is not null then
    raise exception 'LIVEOPS SELF-TEST: الماسح يرفض نصًّا سليمًا (إيجابية كاذبة)'; end if;

  -- (١٢) ⛔ لا مفتاح أجنبيّ نحو جداول الوحدات الأخرى
  select count(*) into n from pg_constraint c
    join pg_class ch on ch.oid = c.conrelid
    join pg_class pr on pr.oid = c.confrelid
   where c.contype='f' and ch.relname like 'liveops\_%'
     and pr.relname in ('projects','project_core','deliverables','ops_jobs');
  if n > 0 then raise exception 'LIVEOPS SELF-TEST: % مفتاح أجنبيّ نحو وحدة مجمَّدة/مكتملة', n; end if;

  raise notice 'LIVEOPS SELF-TEST: كلّ الفحوص نجحت.';
end $st$;
commit;
