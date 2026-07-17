-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §5 PROFESSION-BASED EMPLOYEE VISIBILITY, PERMISSIONS & RLS
-- (RUN ONCE — idempotent, additive; no destructive drops of data)
--
-- Adds a real profession model on top of the coarse profiles.staff_role:
--   • professions            — catalog + per-profession capability flags
--   • employee_professions   — many-to-many (an employee may hold several)
--   • project_tasks.visibility / .profession_id — per-task visibility override
--
-- Security model (enforced in RLS + SECURITY DEFINER RPCs, NOT UI hiding):
--   • Task read is profession-scoped. A regular employee sees a task only when
--     they are the assignee/creator, OR it is a 'profession'-visible task whose
--     profession they hold (a task with no profession stays team-wide, so the
--     migration is non-breaking for existing tasks). 'assigned'-visibility tasks
--     are assignee-only; 'admin'-visibility tasks are manager/admin-only.
--   • Owner / manager / staff-reads-all / a profession carrying 'view_all_tasks'
--     see everything (unchanged from today).
--   • The financial surface is untouched — this migration never grants an
--     employee any path to budgets, costs, invoices or payment data.
--
-- Backfill: seed one profession per distinct crew staff_role, then map every
-- existing employee to the profession matching their role. Names default to the
-- role slug; admins rename / split them from the profession-admin UI.
--
-- Depends on: profiles, project_tasks, project_shoot_sessions, task_files,
--   task_comments, projects, activity_log, log_activity(...), is_admin(),
--   is_owner(), is_staff(), can_manage_projects(), staff_reads_all_projects(),
--   pc_can_read_project(uuid). custody_inventory_assignments is optional (the
--   dashboard guards for it at runtime).
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.profiles')               is null then miss := miss || ' profiles'; end if;
  if to_regclass('public.project_tasks')          is null then miss := miss || ' project_tasks'; end if;
  if to_regclass('public.project_shoot_sessions') is null then miss := miss || ' project_shoot_sessions'; end if;
  if to_regclass('public.task_files')             is null then miss := miss || ' task_files'; end if;
  if to_regclass('public.task_comments')          is null then miss := miss || ' task_comments'; end if;
  if to_regclass('public.task_followers')         is null then miss := miss || ' task_followers'; end if;
  if to_regclass('public.task_dependencies')      is null then miss := miss || ' task_dependencies'; end if;
  if to_regclass('public.project_task_checklists') is null then miss := miss || ' project_task_checklists'; end if;
  if to_regclass('public.projects')               is null then miss := miss || ' projects'; end if;
  if to_regclass('public.activity_log')           is null then miss := miss || ' activity_log'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity()'; end if;
  if to_regprocedure('public.is_admin()')                    is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.is_owner()')                    is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_staff()')                    is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.can_manage_projects()')         is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.staff_reads_all_projects()')    is null then miss := miss || ' staff_reads_all_projects()'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')     is null then miss := miss || ' pc_can_read_project(uuid)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (شغّل project_core_FINAL_RUNME.sql أولاً):%', miss; end if;
end $pf$;

begin;

-- ── 1. Catalog + join ──────────────────────────────────────────────────────
create table if not exists public.professions (
  id                        uuid primary key default gen_random_uuid(),
  key                       text not null unique,
  name_ar                   text not null default '',
  name_en                   text not null default '',
  description               text,
  is_active                 boolean not null default true,
  sort_order                int not null default 0,
  -- capability flags (the "permission matrix" — toggled from the admin UI):
  perm_view_all_tasks       boolean not null default false,
  perm_manage_preproduction boolean not null default false,
  perm_manage_shoots        boolean not null default false,
  perm_manage_custody       boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.employee_professions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  profession_id uuid not null references public.professions(id) on delete cascade,
  is_primary    boolean not null default false,
  assigned_by   uuid references auth.users(id),
  assigned_at   timestamptz not null default now(),
  unique (profile_id, profession_id)
);
create index if not exists idx_emp_prof_profile    on public.employee_professions(profile_id);
create index if not exists idx_emp_prof_profession on public.employee_professions(profession_id);

-- ── 2. Per-task visibility override ────────────────────────────────────────
alter table public.project_tasks add column if not exists visibility    text not null default 'profession';
alter table public.project_tasks add column if not exists profession_id uuid references public.professions(id) on delete set null;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_tasks_visibility_chk') then
    alter table public.project_tasks
      add constraint project_tasks_visibility_chk check (visibility in ('profession','assigned','admin'));
  end if;
end $c$;
create index if not exists idx_ptasks_profession on public.project_tasks(profession_id);

-- ── 3. Backfill: professions from crew roles, then map employees ────────────
insert into public.professions (key, name_ar, name_en, sort_order)
select distinct p.staff_role, p.staff_role, p.staff_role, 100
from public.profiles p
where p.staff_role is not null and btrim(p.staff_role) <> ''
  and not exists (select 1 from public.professions x where x.key = p.staff_role)
on conflict (key) do nothing;

insert into public.employee_professions (profile_id, profession_id, is_primary)
select p.id, pr.id, true
from public.profiles p
join public.professions pr on pr.key = p.staff_role
where p.staff_role is not null and btrim(p.staff_role) <> ''
on conflict (profile_id, profession_id) do nothing;

-- ── 4. Profession-scoped helper functions (SECURITY DEFINER) ───────────────
create or replace function public.emp_profession_ids(p_user uuid default auth.uid())
returns uuid[] language sql stable security definer set search_path = public as $$
  -- Reading another user's professions requires manager/admin; otherwise scope
  -- to the caller so a direct RPC call cannot enumerate someone else's roles.
  select case
    when coalesce(p_user, auth.uid()) is distinct from auth.uid()
         and not (public.is_admin() or public.can_manage_projects())
      then '{}'::uuid[]
    else coalesce((
      select array_agg(ep.profession_id)
      from public.employee_professions ep
      join public.professions pr on pr.id = ep.profession_id and pr.is_active
      where ep.profile_id = coalesce(p_user, auth.uid())
    ), '{}'::uuid[])
  end;
$$;

-- true if the caller (or p_user) is granted a capability, either by being an
-- owner/manager/admin or by holding a profession whose flag is set.
create or replace function public.emp_can(p_cap text, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if coalesce(p_user, auth.uid()) is null then return false; end if;
  -- Probing another user's capability requires manager/admin.
  if coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not (public.is_owner() or public.is_admin() or public.can_manage_projects()) then
    return false;
  end if;
  -- A caller checking THEIR OWN capability: owner/manager/admin implicitly hold all.
  -- (Not applied when evaluating a different user, so the answer reflects THAT
  --  user's professions rather than the caller's privilege.)
  if coalesce(p_user, auth.uid()) = auth.uid()
     and (public.is_owner() or public.is_admin() or public.can_manage_projects()) then
    return true;
  end if;
  select exists (
    select 1 from public.employee_professions ep
    join public.professions pr on pr.id = ep.profession_id and pr.is_active
    where ep.profile_id = coalesce(p_user, auth.uid())
      and case p_cap
        when 'view_all_tasks'       then pr.perm_view_all_tasks
        when 'manage_preproduction' then pr.perm_manage_preproduction
        when 'manage_shoots'        then pr.perm_manage_shoots
        when 'manage_custody'       then pr.perm_manage_custody
        else false end
  ) into v;
  return coalesce(v, false);
end $$;

-- ── 5. RLS ─────────────────────────────────────────────────────────────────
alter table public.professions          enable row level security;
alter table public.employee_professions enable row level security;

-- professions: any authenticated user may read the catalog (names for the UI);
-- writes go only through the SECURITY DEFINER admin RPCs (no write policy = deny).
drop policy if exists professions_read on public.professions;
create policy professions_read on public.professions
  for select to authenticated using (true);

-- employee_professions: a user reads their own rows; managers/admin read all.
drop policy if exists emp_prof_read on public.employee_professions;
create policy emp_prof_read on public.employee_professions
  for select to authenticated
  using (profile_id = auth.uid() or public.can_manage_projects() or public.is_admin());

-- project_tasks read — profession-scoped (replaces the team-wide ptasks_read).
drop policy if exists ptasks_read on public.project_tasks;
create policy ptasks_read on public.project_tasks for select to authenticated
using (
  public.pc_can_read_project(project_id)
  and (
        public.can_manage_projects()
     or public.is_admin()
     or public.staff_reads_all_projects()
     or public.emp_can('view_all_tasks')
     or assignee_id = auth.uid()
     or created_by  = auth.uid()
     or (visibility = 'profession'
         and (profession_id is null or profession_id = any (public.emp_profession_ids())))
  )
);

-- Same predicate as a function, so a task's CHILD rows inherit its scoping.
-- (SECURITY DEFINER → its inner select bypasses RLS, so there is no recursion
--  when this is used from project_tasks' own children.)
create or replace function public.pc_can_read_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_tasks t
    where t.id = p_task
      and public.pc_can_read_project(t.project_id)
      and (
            public.can_manage_projects()
         or public.is_admin()
         or public.staff_reads_all_projects()
         or public.emp_can('view_all_tasks')
         or t.assignee_id = auth.uid()
         or t.created_by  = auth.uid()
         or (t.visibility = 'profession'
             and (t.profession_id is null or t.profession_id = any (public.emp_profession_ids())))
      )
  );
$$;

-- Re-scope the task child rows (were project-level → now task-level), so an
-- editor cannot read comments / files / checklists / followers / dependencies
-- of a task the tightened ptasks_read now hides from them.
drop policy if exists pchk_read on public.project_task_checklists;
create policy pchk_read on public.project_task_checklists for select to authenticated
  using (public.pc_can_read_task(task_id));
drop policy if exists tcom_read on public.task_comments;
create policy tcom_read on public.task_comments for select to authenticated
  using (public.pc_can_read_task(task_id));
drop policy if exists tfol_read on public.task_followers;
create policy tfol_read on public.task_followers for select to authenticated
  using (public.pc_can_read_task(task_id));
drop policy if exists tdep_read on public.task_dependencies;
create policy tdep_read on public.task_dependencies for select to authenticated
  using (public.pc_can_read_task(task_id));
drop policy if exists tfiles_read on public.task_files;
create policy tfiles_read on public.task_files for select to authenticated
  using (public.pc_can_read_task(task_id));

-- ── 6. Admin RPCs: manage catalog + assignments (audited) ──────────────────
create or replace function public.admin_upsert_profession(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text;
begin
  if not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  v_id  := nullif(p_data->>'id','')::uuid;
  v_key := btrim(coalesce(p_data->>'key',''));
  if v_id is null and v_key = '' then raise exception 'key مطلوب'; end if;

  if v_id is null then
    insert into public.professions (key, name_ar, name_en, description, is_active, sort_order,
        perm_view_all_tasks, perm_manage_preproduction, perm_manage_shoots, perm_manage_custody)
    values (v_key,
        coalesce(p_data->>'name_ar', v_key), coalesce(p_data->>'name_en', v_key),
        p_data->>'description', coalesce((p_data->>'is_active')::boolean, true),
        coalesce((p_data->>'sort_order')::int, 0),
        coalesce((p_data->>'perm_view_all_tasks')::boolean, false),
        coalesce((p_data->>'perm_manage_preproduction')::boolean, false),
        coalesce((p_data->>'perm_manage_shoots')::boolean, false),
        coalesce((p_data->>'perm_manage_custody')::boolean, false))
    on conflict (key) do update set name_ar = excluded.name_ar
    returning id into v_id;
  else
    update public.professions set
      name_ar     = coalesce(p_data->>'name_ar', name_ar),
      name_en     = coalesce(p_data->>'name_en', name_en),
      description  = coalesce(p_data->>'description', description),
      is_active    = coalesce((p_data->>'is_active')::boolean, is_active),
      sort_order   = coalesce((p_data->>'sort_order')::int, sort_order),
      perm_view_all_tasks       = coalesce((p_data->>'perm_view_all_tasks')::boolean, perm_view_all_tasks),
      perm_manage_preproduction = coalesce((p_data->>'perm_manage_preproduction')::boolean, perm_manage_preproduction),
      perm_manage_shoots        = coalesce((p_data->>'perm_manage_shoots')::boolean, perm_manage_shoots),
      perm_manage_custody       = coalesce((p_data->>'perm_manage_custody')::boolean, perm_manage_custody),
      updated_at   = now()
    where id = v_id;
  end if;

  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.upserted',
    'profession', v_id, jsonb_build_object('key', coalesce(v_key, ''), 'data', p_data));
  return v_id;
end $$;

-- replace an employee's profession set; logs before/after (permission-change audit)
create or replace function public.admin_set_employee_professions(p_user uuid, p_profession_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid[]; v_first uuid;
begin
  if not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  if p_user is null then raise exception 'p_user مطلوب'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'الموظف غير موجود';
  end if;

  select coalesce(array_agg(profession_id order by profession_id), '{}'::uuid[])
    into v_old from public.employee_professions where profile_id = p_user;

  delete from public.employee_professions
   where profile_id = p_user
     and (p_profession_ids is null or profession_id <> all (p_profession_ids));

  v_first := (p_profession_ids)[1];
  if p_profession_ids is not null then
    insert into public.employee_professions (profile_id, profession_id, is_primary, assigned_by)
    select p_user, pid, (pid = v_first), auth.uid()
    from unnest(p_profession_ids) as pid
    where exists (select 1 from public.professions pr where pr.id = pid)
    on conflict (profile_id, profession_id)
      do update set is_primary = excluded.is_primary, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;

  perform public.log_activity(auth.uid(), public.staff_role(), 'employee.professions_changed',
    'profile', p_user, jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(coalesce(p_profession_ids,'{}'::uuid[]))));
end $$;

-- employees + their professions, for the admin matrix (managers/admin only; no financial fields)
create or replace function public.admin_list_employees_professions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_agg(row order by (row->>'full_name')), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'staff_role', p.staff_role,
      'account_status', p.account_status,
      'profession_ids', coalesce((select jsonb_agg(ep.profession_id) from public.employee_professions ep where ep.profile_id = p.id), '[]'::jsonb)
    ) as row
    from public.profiles p
    where p.staff_role is not null and btrim(p.staff_role) <> ''
  ) x;
  return v;
end $$;

-- ── 7. Employee self-service: update own assigned task status ──────────────
create or replace function public.emp_update_task_status(p_task uuid, p_status text, p_progress int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_assignee uuid; v_project uuid;
begin
  select assignee_id, project_id into v_assignee, v_project
  from public.project_tasks where id = p_task and coalesce(is_deleted,false) = false;
  if v_project is null then raise exception 'المهمة غير موجودة'; end if;
  -- only the assignee (or a manager/admin) may move their own task. `is distinct
  -- from` is NULL-safe: an unassigned task (v_assignee IS NULL) is never a match,
  -- so a non-manager can't mutate a task that isn't theirs.
  if v_assignee is distinct from auth.uid()
     and not public.can_manage_projects() and not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_status not in ('todo','in_progress','blocked','in_review','done','cancelled') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.project_tasks set
    status       = p_status,
    progress_pct = coalesce(least(greatest(p_progress,0),100), progress_pct),
    completed_at = case when p_status = 'done' then now() else null end,
    updated_at   = now()
  where id = p_task;
  perform public.log_activity(auth.uid(), public.staff_role(), 'task.status_changed',
    'project_task', p_task, jsonb_build_object('status', p_status));
end $$;

-- ── 8. Scoped employee dashboard — read-only, non-financial ────────────────
create or replace function public.employee_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); profs uuid[]; has_custody boolean; v jsonb;
begin
  if uid is null or not (public.is_staff() or public.is_admin()) then
    raise exception 'not authorized';
  end if;
  profs := public.emp_profession_ids(uid);
  has_custody := to_regclass('public.custody_inventory_assignments') is not null;

  v := jsonb_build_object(
    'my_tasks', (
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'project_id',t.project_id,
        'project_name',pj.project_name,'status',t.status,'priority',t.priority,'due_date',t.due_date)
        order by t.due_date asc nulls last, t.priority desc), '[]'::jsonb)
      from public.project_tasks t join public.projects pj on pj.id = t.project_id
      where t.assignee_id = uid and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
      limit 100),
    'profession_tasks', (
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'project_id',t.project_id,
        'project_name',pj.project_name,'status',t.status,'priority',t.priority,'due_date',t.due_date,
        'profession', pr.name_ar) order by t.due_date asc nulls last), '[]'::jsonb)
      from public.project_tasks t
      join public.projects pj on pj.id = t.project_id
      left join public.professions pr on pr.id = t.profession_id
      where t.visibility='profession' and t.profession_id = any(profs)
        and public.pc_can_read_project(t.project_id)   -- only projects the caller is on
        and (t.assignee_id is null or t.assignee_id <> uid)
        and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
      limit 100),
    'due_today', (
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'project_id',t.project_id,
        'project_name',pj.project_name,'status',t.status) order by t.priority desc), '[]'::jsonb)
      from public.project_tasks t join public.projects pj on pj.id = t.project_id
      where t.assignee_id=uid and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
        and t.due_date = current_date),
    'overdue', (
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'project_id',t.project_id,
        'project_name',pj.project_name,'status',t.status,'due_date',t.due_date) order by t.due_date asc), '[]'::jsonb)
      from public.project_tasks t join public.projects pj on pj.id = t.project_id
      where t.assignee_id=uid and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
        and t.due_date < current_date),
    'upcoming_shoots', (
      select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'project_id',s.project_id,
        'project_name',pj.project_name,'session_date',s.session_date,'call_time',s.call_time,
        'location',s.location,'status',s.status) order by s.session_date asc), '[]'::jsonb)
      from public.project_shoot_sessions s join public.projects pj on pj.id = s.project_id
      where coalesce(s.is_deleted,false)=false
        and s.status in ('planned','confirmed','in_progress')
        and s.session_date >= current_date and s.session_date <= current_date + 30
        and ( s.created_by = uid
           or s.crew::text ilike '%'||uid::text||'%'
           or exists (select 1 from public.project_tasks t2 where t2.project_id=s.project_id and t2.assignee_id=uid and coalesce(t2.is_deleted,false)=false))),
    'files_i_need', (
      select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'task_id',f.task_id,'task_title',t.title,
        'file_name',f.file_name,'file_url',f.file_url,'created_at',f.created_at) order by f.created_at desc), '[]'::jsonb)
      from public.task_files f join public.project_tasks t on t.id = f.task_id
      where coalesce(f.is_deleted,false)=false and coalesce(t.is_deleted,false)=false
        and t.assignee_id = uid and t.status not in ('done','cancelled')
      limit 50),
    'comments_requiring_action', (
      select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'task_title',t.title,
        'project_id',t.project_id,'body',left(c.body,240),
        'author_name',(select full_name from public.profiles ap where ap.id=c.author_id),
        'created_at',c.created_at) order by c.created_at desc), '[]'::jsonb)
      from public.task_comments c join public.project_tasks t on t.id = c.task_id
      where coalesce(c.is_deleted,false)=false and coalesce(t.is_deleted,false)=false
        and t.assignee_id = uid and c.author_id is distinct from uid
        and c.created_at >= now() - interval '60 days'
      limit 50),
    'custody_actions', case when has_custody then (
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'assignment_number',a.assignment_number,
        'status',a.status,'expected_return_at',a.expected_return_at) order by a.expected_return_at asc nulls last), '[]'::jsonb)
      from public.custody_inventory_assignments a
      where a.employee_user_id = uid and coalesce(a.is_deleted,false)=false
        and a.status in ('pending_employee_confirmation','return_requested','under_inspection','disputed')
    ) else '[]'::jsonb end
  );
  return v;
end $$;

-- ── 9. Grants ──────────────────────────────────────────────────────────────
do $g$
declare f text;
begin
  foreach f in array array[
    'public.emp_profession_ids(uuid)',
    'public.emp_can(text,uuid)',
    'public.pc_can_read_task(uuid)',
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_list_employees_professions()',
    'public.emp_update_task_status(uuid,text,int)',
    'public.employee_dashboard()'
  ] loop
    execute format('revoke all on function %s from public, anon;', f);
    execute format('grant execute on function %s to authenticated;', f);
  end loop;
end $g$;

-- ── 10. In-transaction validation ──────────────────────────────────────────
do $v$
begin
  if to_regclass('public.professions')          is null then raise exception 'فشل: professions'; end if;
  if to_regclass('public.employee_professions') is null then raise exception 'فشل: employee_professions'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name='project_tasks' and column_name='visibility') then
    raise exception 'فشل: project_tasks.visibility'; end if;
  if to_regprocedure('public.emp_profession_ids(uuid)')                is null then raise exception 'فشل: emp_profession_ids'; end if;
  if to_regprocedure('public.emp_can(text,uuid)')                      is null then raise exception 'فشل: emp_can'; end if;
  if to_regprocedure('public.pc_can_read_task(uuid)')                  is null then raise exception 'فشل: pc_can_read_task'; end if;
  if to_regprocedure('public.admin_upsert_profession(jsonb)')          is null then raise exception 'فشل: admin_upsert_profession'; end if;
  if to_regprocedure('public.admin_set_employee_professions(uuid,uuid[])') is null then raise exception 'فشل: admin_set_employee_professions'; end if;
  if to_regprocedure('public.employee_dashboard()')                    is null then raise exception 'فشل: employee_dashboard'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
