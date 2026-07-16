-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — OPERATIONAL CLOSURE HOTFIX
-- يُشغَّل مرة واحدة فوق الملفات الأربعة السابقة (FINAL, UI_COMPLETION, FINAL_COMPLETION,
-- REMAINING_MODULES). Idempotent · Production-safe · لا حذف · لا Foundation · لا Fixtures
-- · لا تعديل هدّام للعهدة/التأجير/HR (قراءة آمنة فقط).
--
-- يضيف: Call Sheet كاملة (جدول + إصدارات + حفظ/إرسال مع حرّاس ومنع تكرار/إرسال مزدوج)
-- + حقول رؤية/اعتماد إصدارات المخرجات. الروابط المباشرة تُعالَج في الواجهة (query tab).
-- ملاحظة صريحة: التكامل الحيّ لحجز المعدات مع نظام العهدة، ومحرّر القوالب الكامل،
-- ومسار البريد الخادمي — لم تُضمَّن في هذا الملف (تُنفَّذ لاحقًا).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ═══ 0) حقول إضافية على إصدارات المخرجات (رؤية العميل + اعتماد + supersede) ═══
alter table public.project_deliverable_versions add column if not exists client_visible boolean not null default false;
alter table public.project_deliverable_versions add column if not exists is_approved    boolean not null default false;
alter table public.project_deliverable_versions add column if not exists is_final       boolean not null default false;
alter table public.project_deliverable_versions add column if not exists supersedes     int;

-- ═══ 1) جدول Call Sheets ═══
create table if not exists public.project_call_sheets (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  shoot_session_id uuid not null references public.project_shoot_sessions(id) on delete cascade,
  version_number   int not null,
  title            text,
  shoot_date       date,
  call_time        timestamptz,
  wrap_time        timestamptz,
  location_name    text,
  address          text,
  map_url          text,
  client_contact   text,
  client_mobile    text,
  crew             jsonb not null default '[]',
  equipment        jsonb not null default '[]',
  vehicles         jsonb not null default '[]',
  permits          text,
  safety_notes     text,
  weather_notes    text,
  schedule         jsonb not null default '[]',
  shot_list        jsonb not null default '[]',
  contacts         jsonb not null default '[]',
  general_notes    text,
  status           text not null default 'draft' check (status in ('draft','sent')),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz,
  sent_by          uuid references auth.users(id),
  is_deleted       boolean not null default false,
  unique (shoot_session_id, version_number)
);
create index if not exists idx_pcs_shoot   on public.project_call_sheets(shoot_session_id, version_number desc);
create index if not exists idx_pcs_project on public.project_call_sheets(project_id) where is_deleted = false;

alter table public.project_call_sheets enable row level security;
drop policy if exists pcs_read on public.project_call_sheets;
create policy pcs_read on public.project_call_sheets for select to authenticated
  using (public.pc_can_read_project(project_id));   -- منصّة داخلية للفريق فقط (لا يراها العميل)
grant select on public.project_call_sheets to authenticated;   -- الكتابة عبر RPCs فقط

drop trigger if exists trg_pcs_touch on public.project_call_sheets;
create trigger trg_pcs_touch before update on public.project_call_sheets for each row execute function public.pc_touch_updated_at();

-- ═══ 2) حفظ Call Sheet — إنشاء إصدار جديد (بلا id) أو تعديل مسودّة (بـ id) ═══
create or replace function public.project_core_call_sheet_save(p_shoot uuid, p_data jsonb)
returns public.project_call_sheets language plpgsql security definer set search_path = public as $$
declare r public.project_call_sheets; v_proj uuid; v_id uuid := nullif(p_data->>'id','')::uuid; v_ver int; s record;
begin
  select project_id into v_proj from public.project_shoot_sessions where id = p_shoot and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;

  if v_id is not null then
    -- تعديل مسودّة فقط (لا يُعدَّل المُرسَل — أنشئ إصدارًا جديدًا).
    select * into s from public.project_call_sheets where id = v_id and shoot_session_id = p_shoot;
    if s.id is null then raise exception 'not_found'; end if;
    if s.status <> 'draft' then raise exception 'not_draft'; end if;
  else
    v_ver := coalesce((select max(version_number)+1 from public.project_call_sheets where shoot_session_id = p_shoot), 1);
  end if;

  if v_id is not null then
    update public.project_call_sheets set
      title=nullif(btrim(p_data->>'title'),''), shoot_date=nullif(p_data->>'shoot_date','')::date,
      call_time=nullif(p_data->>'call_time','')::timestamptz, wrap_time=nullif(p_data->>'wrap_time','')::timestamptz,
      location_name=nullif(btrim(p_data->>'location_name'),''), address=nullif(btrim(p_data->>'address'),''),
      map_url=nullif(btrim(p_data->>'map_url'),''), client_contact=nullif(btrim(p_data->>'client_contact'),''),
      client_mobile=nullif(btrim(p_data->>'client_mobile'),''), permits=nullif(btrim(p_data->>'permits'),''),
      safety_notes=nullif(btrim(p_data->>'safety_notes'),''), weather_notes=nullif(btrim(p_data->>'weather_notes'),''),
      general_notes=nullif(btrim(p_data->>'general_notes'),''),
      crew=coalesce(case when jsonb_typeof(p_data->'crew')='array' then p_data->'crew' end, crew),
      equipment=coalesce(case when jsonb_typeof(p_data->'equipment')='array' then p_data->'equipment' end, equipment),
      vehicles=coalesce(case when jsonb_typeof(p_data->'vehicles')='array' then p_data->'vehicles' end, vehicles),
      schedule=coalesce(case when jsonb_typeof(p_data->'schedule')='array' then p_data->'schedule' end, schedule),
      shot_list=coalesce(case when jsonb_typeof(p_data->'shot_list')='array' then p_data->'shot_list' end, shot_list),
      contacts=coalesce(case when jsonb_typeof(p_data->'contacts')='array' then p_data->'contacts' end, contacts)
      where id = v_id and status = 'draft' returning * into r;   -- re-guard: لا تعديل بعد الإرسال (TOCTOU)
    if r.id is null then raise exception 'not_draft'; end if;
  else
    insert into public.project_call_sheets(project_id, shoot_session_id, version_number, title, shoot_date,
        call_time, wrap_time, location_name, address, map_url, client_contact, client_mobile,
        crew, equipment, vehicles, permits, safety_notes, weather_notes, schedule, shot_list, contacts, general_notes, created_by)
      values (v_proj, p_shoot, v_ver, nullif(btrim(p_data->>'title'),''), nullif(p_data->>'shoot_date','')::date,
        nullif(p_data->>'call_time','')::timestamptz, nullif(p_data->>'wrap_time','')::timestamptz,
        nullif(btrim(p_data->>'location_name'),''), nullif(btrim(p_data->>'address'),''), nullif(btrim(p_data->>'map_url'),''),
        nullif(btrim(p_data->>'client_contact'),''), nullif(btrim(p_data->>'client_mobile'),''),
        coalesce(case when jsonb_typeof(p_data->'crew')='array' then p_data->'crew' end,'[]'::jsonb),
        coalesce(case when jsonb_typeof(p_data->'equipment')='array' then p_data->'equipment' end,'[]'::jsonb),
        coalesce(case when jsonb_typeof(p_data->'vehicles')='array' then p_data->'vehicles' end,'[]'::jsonb),
        nullif(btrim(p_data->>'permits'),''), nullif(btrim(p_data->>'safety_notes'),''), nullif(btrim(p_data->>'weather_notes'),''),
        coalesce(case when jsonb_typeof(p_data->'schedule')='array' then p_data->'schedule' end,'[]'::jsonb),
        coalesce(case when jsonb_typeof(p_data->'shot_list')='array' then p_data->'shot_list' end,'[]'::jsonb),
        coalesce(case when jsonb_typeof(p_data->'contacts')='array' then p_data->'contacts' end,'[]'::jsonb),
        nullif(btrim(p_data->>'general_notes'),''), auth.uid())
      returning * into r;
    perform public.pc_log(v_proj, 'callsheet_created', 'shoot', p_shoot, jsonb_build_object('version', v_ver, 'call_sheet', r.id));
  end if;
  return r;
end $$;

-- ═══ 3) إرسال Call Sheet — حرّاس (تاريخ/موقع) + منع إرسال مزدوج + إشعار الفريق ═══
create or replace function public.project_core_call_sheet_send(p_call_sheet uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.project_call_sheets where id = p_call_sheet and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(r.project_id) then raise exception 'not authorized'; end if;
  if r.status = 'sent' then raise exception 'already_sent'; end if;   -- منع Double Send
  if r.shoot_date is null or coalesce(btrim(r.location_name),'') = '' then raise exception 'incomplete_call_sheet'; end if;
  update public.project_call_sheets set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_call_sheet;
  perform public.pc_log(r.project_id, 'callsheet_sent', 'shoot', r.shoot_session_id, jsonb_build_object('call_sheet', p_call_sheet, 'version', r.version_number));
  perform public.pc_notify_team(r.project_id, 'project_note_new', 'shoot', r.shoot_session_id,
    'صدرت Call Sheet (v'||r.version_number||') لجلسة تصوير', 'Call Sheet issued (v'||r.version_number||')', auth.uid());
  return jsonb_build_object('ok', true, 'status', 'sent', 'version', r.version_number);
end $$;

-- ═══ 4) الصلاحيات ═══
do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'project_core_call_sheet_save(uuid,jsonb)','project_core_call_sheet_send(uuid)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $g$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- ════════════════════════════════════════════════════════════════════════════
-- (أ) الجدول + RLS:
select relname, relrowsecurity from pg_class where relname = 'project_call_sheets';
-- (ب) الأعمدة الجديدة على الإصدارات:
select column_name from information_schema.columns where table_name='project_deliverable_versions'
  and column_name in ('client_visible','is_approved','is_final','supersedes') order by 1;
-- (ج) الدوال + صلاحيات:
select proname, has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') an
  from pg_proc where proname in ('project_core_call_sheet_save','project_core_call_sheet_send') order by proname;
