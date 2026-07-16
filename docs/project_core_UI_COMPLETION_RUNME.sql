-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — UI COMPLETION HOTFIX (يُشغَّل فوق project_core_FINAL_RUNME.sql)
-- Idempotent · Production-safe · لا حذف بيانات · لا يمسّ التأجير/العهدة · لا Overload.
--
-- يضيف: Backfill لكل مشروع بلا project_core + Trigger تهيئة تلقائية · لوحة قيادة
-- موحّدة (counters + total_count + rows في نداء واحد بنفس شروط الفلترة + بحث +
-- Pagination) · إنشاء مشروع (project+core+members+history+activity) · آلة حالات
-- بحرّاس انتقال · إدارة الفريق · التكاليف/المخاطر/الاجتماعات/جلسات التصوير.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ═══ 0) Backfill — كل مشروع قديم بلا طبقة تشغيل يحصل على project_core بمرحلة مشتقّة ═══
insert into public.project_core(project_id, core_stage)
select p.id,
  case p.status
    when 'request_received'   then 'project_created'
    when 'pre_production'     then 'planning'
    when 'shooting_scheduled' then 'scheduled'
    when 'shooting_completed' then 'post_production'
    when 'editing'            then 'post_production'
    when 'ready_for_review'   then 'internal_review'
    when 'delivered'          then 'delivered'
    else 'planning'
  end
from public.projects p
where p.is_deleted = false
  and not exists (select 1 from public.project_core pc where pc.project_id = p.id)
on conflict (project_id) do nothing;

-- نشاط تهيئة (بلا إشعارات) — مرة واحدة لكل مشروع مُهيّأ حديثًا.
insert into public.project_activity(project_id, actor_id, action, entity_type, entity_id, detail)
select pc.project_id, null, 'core_initialized', 'project', pc.project_id, '{}'::jsonb
from public.project_core pc
where not exists (select 1 from public.project_activity a
                 where a.project_id = pc.project_id and a.action = 'core_initialized');

-- ═══ 1) تهيئة تلقائية لأي مشروع جديد (Trigger على projects) ═══
create or replace function public.pc_autoinit_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_core(project_id, core_stage)
    values (new.id, 'project_created') on conflict (project_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_pc_autoinit on public.projects;
create trigger trg_pc_autoinit after insert on public.projects
  for each row execute function public.pc_autoinit_project();

-- ═══ 2) لوحة القيادة الموحّدة — counters + total_count + rows (نفس شروط الفلترة) ═══
drop function if exists public.project_core_dashboard();
create or replace function public.project_core_dashboard(
  p_filter text default 'all', p_search text default null,
  p_manager uuid default null, p_client uuid default null,
  p_from date default null, p_to date default null,
  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fin boolean; v_today date := (now() at time zone 'utc')::date; v_counters jsonb; v_total int; v_rows jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  v_fin := public.can_manage_projects() or public.can_see_financials();

  create temporary table _vis on commit drop as
  select p.id, p.project_name, p.status, p.client_id, p.created_at,
    coalesce(pc.core_stage,'project_created') as stage,
    coalesce(pc.priority,'normal') as priority, coalesce(pc.health,'on_track') as health,
    coalesce(pc.progress_pct,0) as progress_pct, pc.due_date, pc.delivery_date, pc.project_type,
    case when v_fin then pc.budget_amount end  as budget_amount,
    case when v_fin then pc.estimated_cost end as estimated_cost,
    case when v_fin then pc.actual_cost end    as actual_cost,
    nullif(btrim(coalesce(cl.full_name, cl.company)),'') as client_name,
    (select prof.full_name from public.project_members m join public.profiles prof on prof.id = m.user_id
       where m.project_id = p.id and m.role = 'kian_manager' and m.is_deleted = false order by m.created_at limit 1) as manager_name,
    (select m.user_id from public.project_members m where m.project_id = p.id and m.role = 'kian_manager' and m.is_deleted = false order by m.created_at limit 1) as manager_id,
    (select count(*) from public.project_members m where m.project_id = p.id and m.role like 'kian_%' and m.is_deleted = false) as team_count,
    (select count(*) from public.project_tasks t where t.project_id = p.id and t.is_deleted = false and t.status not in ('done','cancelled')) as open_tasks,
    (select count(*) from public.project_tasks t where t.project_id = p.id and t.is_deleted = false and t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today) as overdue_tasks,
    (select count(*) from public.project_approvals a where a.project_id = p.id and a.status = 'pending') as pending_approvals,
    (select max(a.created_at) from public.project_activity a where a.project_id = p.id) as last_activity_at
  from public.projects p
  left join public.project_core pc on pc.project_id = p.id
  left join public.clients cl on cl.id = p.client_id
  where p.is_deleted = false
    and (public.staff_reads_all_projects()
         or exists (select 1 from public.project_members m2 where m2.project_id = p.id and m2.user_id = auth.uid() and m2.is_deleted = false));

  -- العدّادات على كامل المجموعة المرئية (تطابق نتيجة كل فلتر).
  select jsonb_build_object(
    'total',           count(*),
    'active',          count(*) filter (where stage not in ('closed','delivered')),
    'planning',        count(*) filter (where stage = 'planning'),
    'ready',           count(*) filter (where stage = 'ready'),
    'scheduled',       count(*) filter (where stage = 'scheduled'),
    'in_production',   count(*) filter (where stage = 'in_production'),
    'post_production', count(*) filter (where stage = 'post_production'),
    'internal_review', count(*) filter (where stage = 'internal_review'),
    'awaiting_client', count(*) filter (where stage = 'client_review'),
    'revision',        count(*) filter (where stage = 'revision'),
    'near_delivery',   count(*) filter (where stage in ('approved','post_production')),
    'overdue',         count(*) filter (where due_date is not null and due_date < v_today and stage not in ('closed','delivered')),
    'at_risk',         count(*) filter (where health in ('at_risk','off_track')),
    'closed',          count(*) filter (where stage in ('closed','delivered')),
    'no_manager',      count(*) filter (where manager_id is null),
    'no_due',          count(*) filter (where due_date is null and stage not in ('closed','delivered')),
    'overdue_tasks',   coalesce(sum(overdue_tasks),0),
    'pending_approvals', coalesce(sum(pending_approvals),0),
    'hours_month',     coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs
                        where created_at >= date_trunc('month', now()) and project_id in (select id from _vis)),0),
    'total_budget',    case when v_fin then coalesce(sum(budget_amount),0) else null end,
    'actual_cost',     case when v_fin then coalesce(sum(actual_cost),0) else null end,
    'expected_profit', case when v_fin then coalesce(sum(coalesce(budget_amount,0) - coalesce(estimated_cost,0)),0) else null end,
    'actual_profit',   case when v_fin then coalesce(sum(coalesce(budget_amount,0) - coalesce(actual_cost,0)),0) else null end,
    'negative_profit', case when v_fin then count(*) filter (where (coalesce(budget_amount,0) - coalesce(actual_cost,0)) < 0) else null end
  ) into v_counters from _vis;

  -- المجموعة المُفلترة (نفس تعريفات العدّادات) + بحث + مدى + مدير/عميل.
  create temporary table _flt on commit drop as
  select * from _vis v where
    (p_search is null or v.project_name ilike '%'||p_search||'%' or v.client_name ilike '%'||p_search||'%' or v.manager_name ilike '%'||p_search||'%')
    and (p_manager is null or v.manager_id = p_manager)
    and (p_client is null or v.client_id = p_client)
    and (p_from is null or v.due_date >= p_from)
    and (p_to   is null or v.due_date <= p_to)
    and case p_filter
      when 'all'             then true
      when 'active'          then v.stage not in ('closed','delivered')
      when 'planning'        then v.stage = 'planning'
      when 'ready'           then v.stage = 'ready'
      when 'scheduled'       then v.stage = 'scheduled'
      when 'in_production'   then v.stage = 'in_production'
      when 'post_production' then v.stage = 'post_production'
      when 'internal_review' then v.stage = 'internal_review'
      when 'awaiting_client' then v.stage = 'client_review'
      when 'revision'        then v.stage = 'revision'
      when 'near_delivery'   then v.stage in ('approved','post_production')
      when 'overdue'         then v.due_date is not null and v.due_date < v_today and v.stage not in ('closed','delivered')
      when 'at_risk'         then v.health in ('at_risk','off_track')
      when 'closed'          then v.stage in ('closed','delivered')
      when 'no_manager'      then v.manager_id is null
      when 'no_due'          then v.due_date is null and v.stage not in ('closed','delivered')
      when 'negative_profit' then v_fin and (coalesce(v.budget_amount,0) - coalesce(v.actual_cost,0)) < 0
      else true end;

  select count(*) into v_total from _flt;
  select coalesce(jsonb_agg(r order by r_created desc), '[]'::jsonb) into v_rows from (
    select to_jsonb(f) - 'created_at' || jsonb_build_object(
      'days_remaining', case when f.due_date is not null then (f.due_date - v_today) end,
      'profit', case when v_fin then (coalesce(f.budget_amount,0) - coalesce(f.actual_cost,0)) end
    ) as r, f.created_at as r_created
    from _flt f order by f.created_at desc, f.id limit greatest(p_limit,1) offset greatest(p_offset,0)
  ) s;

  return jsonb_build_object('counters', v_counters, 'total_count', v_total, 'rows', v_rows);
end $$;

-- ═══ 3) إنشاء مشروع (project + core + members + history + activity) في معاملة ═══
create or replace function public.project_core_create_project(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_project uuid; v_stage text; v_mgr uuid; v_name text;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  v_name := btrim(coalesce(p_data->>'project_name',''));
  if v_name = '' then raise exception 'name_required'; end if;
  v_stage := coalesce(nullif(p_data->>'core_stage',''),'planning');
  if v_stage not in ('lead_approved','project_created','planning','ready','scheduled','in_production',
                     'post_production','internal_review','client_review','revision','approved','delivered','closed')
    then raise exception 'bad_stage'; end if;

  -- العميل: موجود (client_id) أو إنشاء عميل خفيف باسم خارجي.
  v_client := nullif(p_data->>'client_id','')::uuid;
  if v_client is not null then
    if not exists (select 1 from public.clients where id = v_client and is_deleted = false) then raise exception 'bad_client'; end if;
  elsif coalesce(btrim(p_data->>'client_name'),'') <> '' then
    insert into public.clients(user_id, full_name, company, email, email_is_placeholder)
      values (null, btrim(p_data->>'client_name'), nullif(btrim(p_data->>'client_company'),''), public.gen_pending_email(), true)
      returning id into v_client;
  else
    raise exception 'client_required';
  end if;

  insert into public.projects(project_name, client_id, status, notes)
    values (v_name, v_client, 'request_received', nullif(btrim(p_data->>'description'),''))
    returning id into v_project;   -- Trigger trg_pc_autoinit ينشئ project_core بمرحلة project_created

  update public.project_core set
    core_stage    = v_stage,
    priority      = coalesce(nullif(p_data->>'priority',''),'normal'),
    start_date    = nullif(p_data->>'start_date','')::date,
    due_date      = nullif(p_data->>'due_date','')::date,
    budget_amount = case when (public.can_manage_projects() or public.can_see_financials())
                          then nullif(p_data->>'budget_amount','')::numeric else null end,
    project_type  = nullif(p_data->>'project_type',''),
    currency      = coalesce(nullif(p_data->>'currency',''),'SAR'),
    updated_at = now(), updated_by = auth.uid()
    where project_id = v_project;

  -- المنشئ (كوادر) كمدير مشروع؛ ومدير محدَّد إن وُجد.
  insert into public.project_members(project_id, user_id, role, added_by)
    values (v_project, auth.uid(), 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  v_mgr := nullif(p_data->>'manager_id','')::uuid;
  if v_mgr is not null and v_mgr <> auth.uid() then
    insert into public.project_members(project_id, user_id, role, added_by)
      values (v_project, v_mgr, 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  end if;

  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (v_project, null, v_stage, 'project created', auth.uid());
  perform public.pc_log(v_project, 'project_created', 'project', v_project, jsonb_build_object('name', v_name));
  perform public.pc_notify_team(v_project, 'project_status_changed', 'project', v_project,
    'أُنشئ مشروع جديد: '||v_name, 'New project created: '||v_name, auth.uid());

  return jsonb_build_object('ok', true, 'project_id', v_project, 'stage', v_stage);
end $$;

-- ═══ 4) آلة الحالات — set_stage بحرّاس انتقال (تستبدل النسخة السابقة، نفس التوقيع) ═══
create or replace function public.project_core_set_stage(p_project uuid, p_stage text, p_note text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_from text; v_fi int; v_ti int; v_reason text := nullif(btrim(p_note),'');
  v_order text[] := array['lead_approved','project_created','planning','ready','scheduled','in_production',
                          'post_production','internal_review','client_review','revision','approved','delivered','closed'];
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if not (p_stage = any(v_order)) then raise exception 'bad_stage'; end if;
  select core_stage into v_from from public.project_core where project_id = p_project;
  v_from := coalesce(v_from, 'project_created');
  if v_from = p_stage then
    select * into r from public.project_core where project_id = p_project; return r;
  end if;
  v_fi := array_position(v_order, v_from); v_ti := array_position(v_order, p_stage);

  -- حرّاس الانتقال:
  --  • للخلف أو الإغلاق: السبب إلزامي + إدارة مشاريع (لا محرّر).
  --  • القفز أكثر من مرحلة للأمام: للمالك/السوبر-أدمن فقط (باقي الكوادر خطوة بخطوة).
  --  • شروط جوهرية: → ready يتطلب مدير مشروع + موعد نهائي.
  if v_ti < v_fi or p_stage = 'closed' then
    if v_reason is null then raise exception 'reason_required'; end if;
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  if p_stage = 'delivered' and not public.can_manage_projects() then raise exception 'not authorized'; end if; -- التسليم للإدارة فقط
  if v_ti > v_fi + 1 and not public.is_owner() then raise exception 'no_stage_skip'; end if;
  if p_stage = 'ready' then
    if not exists (select 1 from public.project_members m where m.project_id = p_project and m.role='kian_manager' and m.is_deleted=false)
      then raise exception 'need_manager'; end if;
    if not exists (select 1 from public.project_core pc where pc.project_id = p_project and pc.due_date is not null)
      then raise exception 'need_due_date'; end if;
  end if;

  insert into public.project_core(project_id, core_stage, updated_by)
    values (p_project, p_stage, auth.uid())
    on conflict (project_id) do update set core_stage = p_stage, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (p_project, v_from, p_stage, v_reason, auth.uid());
  perform public.pc_log(p_project, 'stage_changed', 'project', p_project, jsonb_build_object('from', v_from, 'to', p_stage));
  perform public.pc_notify_team(p_project, 'project_status_changed', 'project', p_project,
    'تغيّرت مرحلة المشروع إلى '||p_stage, 'Project stage changed to '||p_stage, auth.uid());
  return r;
end $$;

-- ═══ 5) إدارة الفريق ═══
create or replace function public.pc_member_add(p_project uuid, p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if p_role not in ('kian_manager','kian_editor','kian_photographer','kian_viewer') then raise exception 'bad_role'; end if;
  insert into public.project_members(project_id, user_id, role, added_by)
    values (p_project, p_user, p_role, auth.uid())
    on conflict (project_id, user_id) do update set role = excluded.role, is_deleted = false;
  perform public.pc_log(p_project, 'member_added', 'member', p_user, jsonb_build_object('role', p_role));
  perform public.pc_notify_user(p_user, 'project_note_new', 'project', p_project,
    'أُضِفت إلى فريق مشروع', 'You were added to a project team');
  return true;
end $$;

create or replace function public.pc_member_remove(p_project uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  update public.project_members set is_deleted = true where project_id = p_project and user_id = p_user and role like 'kian_%';
  perform public.pc_log(p_project, 'member_removed', 'member', p_user, '{}');
  return true;
end $$;

-- ═══ 6) التكاليف (مالية) ═══
create or replace function public.pc_cost_add(p_project uuid, p_data jsonb)
returns public.project_costs language plpgsql security definer set search_path = public as $$
declare r public.project_costs;
begin
  if not public.can_manage_projects() and not public.can_see_financials() then raise exception 'not authorized'; end if;
  insert into public.project_costs(project_id, category, description, amount, currency, cost_date, created_by)
    values (p_project, coalesce(nullif(p_data->>'category',''),'general'), nullif(btrim(p_data->>'description'),''),
      coalesce(nullif(p_data->>'amount','')::numeric,0), coalesce(nullif(p_data->>'currency',''),'SAR'),
      coalesce(nullif(p_data->>'cost_date','')::date, (now() at time zone 'utc')::date), auth.uid())
    returning * into r;
  -- تحديث التكلفة الفعلية الإجمالية على الملخّص.
  update public.project_core set actual_cost = coalesce((select sum(amount) from public.project_costs
    where project_id = p_project and is_deleted = false),0), updated_at = now() where project_id = p_project;
  perform public.pc_log(p_project, 'cost_added', 'cost', r.id, jsonb_build_object('amount', r.amount, 'category', r.category));
  return r;
end $$;

create or replace function public.pc_cost_delete(p_cost uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.project_costs where id = p_cost and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_see_financials() then raise exception 'not authorized'; end if;
  update public.project_costs set is_deleted = true where id = p_cost;
  update public.project_core set actual_cost = coalesce((select sum(amount) from public.project_costs
    where project_id = v_proj and is_deleted = false),0), updated_at = now() where project_id = v_proj;
  perform public.pc_log(v_proj, 'cost_deleted', 'cost', p_cost, '{}');
  return true;
end $$;

-- ═══ 7) المخاطر ═══
create or replace function public.pc_risk_upsert(p_project uuid, p_data jsonb)
returns public.project_risks language plpgsql security definer set search_path = public as $$
declare r public.project_risks; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_risks(project_id, title, description, severity, likelihood, status, mitigation, created_by)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(btrim(p_data->>'description'),''),
        coalesce(nullif(p_data->>'severity',''),'medium'), coalesce(nullif(p_data->>'likelihood',''),'possible'),
        coalesce(nullif(p_data->>'status',''),'open'), nullif(btrim(p_data->>'mitigation'),''), auth.uid())
      returning * into r;
    perform public.pc_log(p_project, 'risk_added', 'risk', r.id, jsonb_build_object('severity', r.severity));
  else
    update public.project_risks set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      description = coalesce(nullif(btrim(p_data->>'description'),''), description),
      severity = coalesce(nullif(p_data->>'severity',''), severity), likelihood = coalesce(nullif(p_data->>'likelihood',''), likelihood),
      status = coalesce(nullif(p_data->>'status',''), status), mitigation = coalesce(nullif(btrim(p_data->>'mitigation'),''), mitigation)
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.pc_log(p_project, 'risk_updated', 'risk', v_id, '{}');
  end if;
  return r;
end $$;

-- ═══ 8) الاجتماعات ═══
create or replace function public.pc_meeting_upsert(p_project uuid, p_data jsonb)
returns public.project_meetings language plpgsql security definer set search_path = public as $$
declare r public.project_meetings; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_meetings(project_id, title, scheduled_at, duration_minutes, location, meeting_url, notes, created_by)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(p_data->>'scheduled_at','')::timestamptz,
        nullif(p_data->>'duration_minutes','')::int, nullif(btrim(p_data->>'location'),''),
        nullif(btrim(p_data->>'meeting_url'),''), nullif(btrim(p_data->>'notes'),''), auth.uid())
      returning * into r;
    perform public.pc_log(p_project, 'meeting_added', 'meeting', r.id, '{}');
  else
    update public.project_meetings set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      scheduled_at = coalesce(nullif(p_data->>'scheduled_at','')::timestamptz, scheduled_at),
      duration_minutes = coalesce(nullif(p_data->>'duration_minutes','')::int, duration_minutes),
      location = coalesce(nullif(btrim(p_data->>'location'),''), location),
      meeting_url = coalesce(nullif(btrim(p_data->>'meeting_url'),''), meeting_url),
      notes = coalesce(nullif(btrim(p_data->>'notes'),''), notes)
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  return r;
end $$;

-- ═══ 9) جلسات التصوير ═══
create or replace function public.pc_shoot_upsert(p_project uuid, p_data jsonb)
returns public.project_shoot_sessions language plpgsql security definer set search_path = public as $$
declare r public.project_shoot_sessions; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_shoot_sessions(project_id, title, session_date, call_time, location, client_contact,
        permits, safety_notes, weather_note, status, created_by)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(p_data->>'session_date','')::date,
        nullif(p_data->>'call_time','')::timestamptz, nullif(btrim(p_data->>'location'),''), nullif(btrim(p_data->>'client_contact'),''),
        nullif(btrim(p_data->>'permits'),''), nullif(btrim(p_data->>'safety_notes'),''), nullif(btrim(p_data->>'weather_note'),''),
        coalesce(nullif(p_data->>'status',''),'planned'), auth.uid())
      returning * into r;
    perform public.pc_log(p_project, 'shoot_added', 'shoot', r.id, '{}');
    perform public.pc_notify_team(p_project, 'project_note_new', 'shoot', r.id,
      'جلسة تصوير جديدة: '||coalesce(r.title,''), 'New shoot session', auth.uid());
  else
    update public.project_shoot_sessions set title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      session_date = coalesce(nullif(p_data->>'session_date','')::date, session_date),
      call_time = coalesce(nullif(p_data->>'call_time','')::timestamptz, call_time),
      location = coalesce(nullif(btrim(p_data->>'location'),''), location),
      client_contact = coalesce(nullif(btrim(p_data->>'client_contact'),''), client_contact),
      permits = coalesce(nullif(btrim(p_data->>'permits'),''), permits),
      safety_notes = coalesce(nullif(btrim(p_data->>'safety_notes'),''), safety_notes),
      weather_note = coalesce(nullif(btrim(p_data->>'weather_note'),''), weather_note),
      status = coalesce(nullif(p_data->>'status',''), status),
      completion_report = coalesce(nullif(btrim(p_data->>'completion_report'),''), completion_report),
      updated_at = now()
      where id = v_id and project_id = p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.pc_log(p_project, 'shoot_updated', 'shoot', v_id, jsonb_build_object('status', r.status));
  end if;
  return r;
end $$;

-- ═══ 10) الصلاحيات ═══
do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'project_core_dashboard(text,text,uuid,uuid,date,date,integer,integer)',
    'project_core_create_project(jsonb)','project_core_set_stage(uuid,text,text)',
    'pc_member_add(uuid,uuid,text)','pc_member_remove(uuid,uuid)',
    'pc_cost_add(uuid,jsonb)','pc_cost_delete(uuid)','pc_risk_upsert(uuid,jsonb)',
    'pc_meeting_upsert(uuid,jsonb)','pc_shoot_upsert(uuid,jsonb)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $g$;
revoke all on function public.pc_autoinit_project() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- ════════════════════════════════════════════════════════════════════════════
-- (أ) كل مشروع غير محذوف له project_core (المتوقع 0 ناقص):
select count(*) as projects_missing_core from public.projects p
 where p.is_deleted = false and not exists (select 1 from public.project_core pc where pc.project_id = p.id);
-- (ب) الدوال الجديدة + صلاحية authenticated:
select proname, pg_get_function_identity_arguments(oid) as args,
       has_function_privilege('authenticated', oid, 'execute') auth_exec, has_function_privilege('anon', oid, 'execute') anon_exec
  from pg_proc where proname in ('project_core_dashboard','project_core_create_project','project_core_set_stage',
    'pc_member_add','pc_cost_add','pc_risk_upsert','pc_meeting_upsert','pc_shoot_upsert') order by proname;
-- (ج) نسخة واحدة فقط من project_core_dashboard (التوقيع الموحّد):
select count(*) as dashboard_overloads from pg_proc where proname = 'project_core_dashboard';
