-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 04: GPS sessions + External trackers + Offline sync
-- يُشغَّل بعد patch 03. idempotent. GPS خلف flag gps_sessions_enabled (معطّل افتراضيًا).
-- تتبّع مسؤول: جلسة مهمة فقط (لا 24 ساعة)، بموافقة، ضمن retention.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) جلسات GPS للمهمة (جوال الموظف) ───
create table if not exists public.custody_gps_sessions (
  id                uuid primary key default gen_random_uuid(),
  assignment_id     uuid references public.custody_inventory_assignments(id),
  employee_user_id  uuid not null references auth.users(id),
  project_number    text,
  status            text not null default 'active' check (status in ('active','paused','ended')),
  consent_at        timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  sample_interval_sec int not null default 120,
  point_count       int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_civ_gps_emp on public.custody_gps_sessions(employee_user_id, started_at desc);
create table if not exists public.custody_gps_points (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.custody_gps_sessions(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_civ_gps_points on public.custody_gps_points(session_id, recorded_at);

create or replace function public.custody_gps_start(p_assignment uuid, p_project text, p_interval int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if not public.civ_flag('gps_sessions_enabled') then raise exception 'gps_disabled'; end if;
  -- إنهاء أي جلسة نشطة سابقة لنفس الموظف (لا تتراكم).
  update public.custody_gps_sessions set status='ended', ended_at=now() where employee_user_id=auth.uid() and status<>'ended';
  insert into public.custody_gps_sessions(assignment_id, employee_user_id, project_number, sample_interval_sec)
    values (p_assignment, auth.uid(), nullif(trim(p_project),''), greatest(30, coalesce(p_interval,120))) returning id into v_id;
  perform public.civ_notify_managers('custody_location_started', v_id, 'بدء جلسة تتبع موقع لمهمة', 'GPS session started');
  return v_id;
end; $$;

create or replace function public.custody_gps_append(p_session uuid, p_points jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare elem jsonb; v_n int := 0; v_owner uuid; v_status text;
begin
  select employee_user_id, status into v_owner, v_status from public.custody_gps_sessions where id = p_session;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner then raise exception 'not authorized'; end if;
  if v_status = 'ended' then raise exception 'session_ended'; end if;
  if not public.civ_flag('gps_sessions_enabled') then raise exception 'gps_disabled'; end if;   -- إيقاف العلم يوقف الجمع الجاري فورًا
  for elem in select value from jsonb_array_elements(coalesce(p_points,'[]'::jsonb)) loop
    insert into public.custody_gps_points(session_id, lat, lng, accuracy, recorded_at)
      values (p_session, (elem->>'lat')::double precision, (elem->>'lng')::double precision,
        nullif(elem->>'accuracy','')::double precision, coalesce(nullif(elem->>'recorded_at','')::timestamptz, now()));
    v_n := v_n + 1;
  end loop;
  update public.custody_gps_sessions set point_count = point_count + v_n where id = p_session;
  return v_n;
end; $$;

create or replace function public.custody_gps_stop(p_session uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select employee_user_id into v_owner from public.custody_gps_sessions where id = p_session;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_gps_sessions set status='ended', ended_at=now() where id = p_session and status <> 'ended';
  perform public.civ_notify_managers('custody_location_stopped', p_session, 'انتهاء جلسة تتبع الموقع', 'GPS session ended');
  return true;
end; $$;

-- تطبيق retention (يُستدعى من cron): يحذف نقاط الجلسات الأقدم من gps_retention_days.
create or replace function public.custody_gps_apply_retention() returns int
language plpgsql security definer set search_path = public as $$
declare v_days int; v_n int;
begin
  select gps_retention_days into v_days from public.custody_enterprise_settings where id = 1;
  v_days := coalesce(v_days, 30);
  delete from public.custody_gps_points p using public.custody_gps_sessions s
    where p.session_id = s.id and s.started_at < now() - (v_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- ─── 2) أجهزة تتبع خارجية (Adapter — mock حتى مزوّد حقيقي) ───
create table if not exists public.custody_external_trackers (
  id                uuid primary key default gen_random_uuid(),
  asset_id          uuid references public.custody_inventory_assets(id),
  provider          text,
  external_device_id text unique,
  last_seen_at      timestamptz,
  battery_level     int,
  lat               double precision,
  lng               double precision,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- استيعاب تحديث من webhook خارجي (يُستدعى بجلسة service من مسار محمي بسر).
create or replace function public.custody_tracker_ingest(p_device text, p_lat double precision, p_lng double precision, p_battery int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.custody_external_trackers set lat=p_lat, lng=p_lng, battery_level=p_battery, last_seen_at=now(), updated_at=now()
    where external_device_id = p_device;
  return found;
end; $$;

-- ─── 3) Offline idempotency — يمنع تكرار نفس العملية عند المزامنة ───
create table if not exists public.custody_offline_operations (
  id                 uuid primary key default gen_random_uuid(),
  client_operation_id uuid not null unique,     -- مفتاح idempotency من الجهاز
  employee_user_id   uuid not null references auth.users(id),
  operation_type     text not null,
  payload_hash       text,
  device_id          text,
  status             text not null default 'pending' check (status in ('pending','applied','conflict','failed')),
  result_ref         uuid,
  retry_count        int not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  applied_at         timestamptz
);
create index if not exists idx_civ_offline_emp on public.custody_offline_operations(employee_user_id, status);

-- يحجز مفتاح العملية (idempotent): يعيد true إن كانت جديدة (نفّذها)، false إن سبق تطبيقها.
create or replace function public.custody_offline_claim(p_client_op uuid, p_type text, p_hash text, p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_existing record;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select status, result_ref into v_existing from public.custody_offline_operations where client_operation_id = p_client_op;
  if found then return jsonb_build_object('new', false, 'status', v_existing.status, 'result_ref', v_existing.result_ref); end if;
  insert into public.custody_offline_operations(client_operation_id, employee_user_id, operation_type, payload_hash, device_id)
    values (p_client_op, auth.uid(), p_type, p_hash, nullif(trim(p_device),''));
  return jsonb_build_object('new', true);
exception when unique_violation then
  select status, result_ref into v_existing from public.custody_offline_operations where client_operation_id = p_client_op;
  return jsonb_build_object('new', false, 'status', v_existing.status, 'result_ref', v_existing.result_ref);
end; $$;

-- تحديث نتيجة العملية بعد تنفيذها بنجاح/تعارض.
create or replace function public.custody_offline_finalize(p_client_op uuid, p_status text, p_result uuid, p_error text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  update public.custody_offline_operations set status = p_status, result_ref = p_result, last_error = nullif(p_error,''),
    applied_at = case when p_status='applied' then now() else applied_at end
    where client_operation_id = p_client_op and employee_user_id = auth.uid();
  return found;
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RLS + GRANTS
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_gps_sessions       enable row level security;
alter table public.custody_gps_points         enable row level security;
alter table public.custody_external_trackers  enable row level security;
alter table public.custody_offline_operations enable row level security;
-- الموظف يرى جلساته فقط؛ الإدارة ترى الكل.
drop policy if exists civ_gps_sessions_read on public.custody_gps_sessions;
create policy civ_gps_sessions_read on public.custody_gps_sessions for select to authenticated
  using (public.civ_can_manage() or employee_user_id = auth.uid());
drop policy if exists civ_gps_points_read on public.custody_gps_points;
create policy civ_gps_points_read on public.custody_gps_points for select to authenticated
  using (public.civ_can_manage() or exists (select 1 from public.custody_gps_sessions s where s.id = session_id and s.employee_user_id = auth.uid()));
drop policy if exists civ_trackers_read on public.custody_external_trackers;
create policy civ_trackers_read on public.custody_external_trackers for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_offline_read on public.custody_offline_operations;
create policy civ_offline_read on public.custody_offline_operations for select to authenticated
  using (public.civ_can_manage() or employee_user_id = auth.uid());

grant select on public.custody_gps_sessions, public.custody_gps_points, public.custody_external_trackers, public.custody_offline_operations to authenticated;
grant execute on function public.custody_gps_start(uuid,text,int) to authenticated;
grant execute on function public.custody_gps_append(uuid,jsonb) to authenticated;
grant execute on function public.custody_gps_stop(uuid) to authenticated;
grant execute on function public.custody_offline_claim(uuid,text,text,text) to authenticated;
grant execute on function public.custody_offline_finalize(uuid,text,uuid,text) to authenticated;
-- retention + tracker ingest: خدمة/كرون فقط.
revoke execute on function public.custody_gps_apply_retention() from public, anon, authenticated;
revoke execute on function public.custody_tracker_ingest(text,double precision,double precision,int) from public, anon, authenticated;
grant  execute on function public.custody_gps_apply_retention() to service_role;
grant  execute on function public.custody_tracker_ingest(text,double precision,double precision,int) to service_role;
commit;

notify pgrst, 'reload schema';

-- VALIDATION
select 'gps_tables' as k, count(*) from information_schema.tables where table_name in ('custody_gps_sessions','custody_gps_points');
select 'offline' as k, count(*) from information_schema.tables where table_name='custody_offline_operations';
select 'gps_rpcs' as k, count(*) from pg_proc where proname in ('custody_gps_start','custody_gps_append','custody_gps_stop','custody_offline_claim');
