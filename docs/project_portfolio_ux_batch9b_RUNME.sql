-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 9 · Part 2 — نظرة المحفظة الهرمية (Portfolio Overview)
--
-- نداء واحد يعيد تنظيم قائمة المشاريع المسطَّحة إلى محفظة هرمية:
--   · البرامج والمشاريع الرئيسية (master) مع تجميع فروعها.
--   · المشاريع المستقلة القياسية (standalone + غير simple).
--   · المشاريع السريعة (standalone + simple).
--   · عدّادات مجموعات علوية + «تحتاج تدخلًا» على **نفس المجموعة المرئية** للمستخدم.
--
-- يعيد استخدام الأنظمة القائمة ولا ينشئ نظام محفظة موازيًا:
--   · نفس رؤية project_core_dashboard: staff_reads_all_projects() OR member.
--   · project_scope (6A) + operating_experience المشتقّة (8C) لتصنيف النوع.
--   · لا يعيد تعريف أيّ بوّابة وصول. لا مالية. الفرع لا يُحسب مرّتين.
--
-- قيود: Additive · Idempotent · Transaction · Preflight · لا DROP · **بلا Temp
--   Tables في القراءة** · فلاتر ومجموعات وترقيم على الخادم · isolation لكل صفّ ·
--   self-test بلا آثار · notify pgrst · لا مالية/Zoho/عهدة.
-- ترتيب التشغيل: بعد 8C (يحتاج project_scope + operating_experience).
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.staff_reads_all_projects()') is null
    then raise exception '9B PREFLIGHT: staff_reads_all_projects مفقودة'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='project_scope')
    then raise exception '9B PREFLIGHT: هرمية 6A غير مطبّقة (project_scope)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='operating_experience')
    then raise exception '9B PREFLIGHT: 8C غير مطبّقة (operating_experience)'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='projects' and column_name='unit_number')
    then raise exception '9B PREFLIGHT: بيانات الوحدة (8A) مفقودة'; end if;
  if to_regprocedure('public.pc_project_closure_status(uuid)') is null
    then raise exception '9B PREFLIGHT: 5C غير مطبّقة (pc_project_closure_status)'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- دالّة داخلية: مجموعة المشاريع المرئية للمستخدم بحقولها المشتقّة — نداء واحد،
-- بلا جداول مؤقّتة. تُستدعى من الواجهة العامّة المحروسة أدناه فقط.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pgf_portfolio_rows()
returns table (
  id uuid, project_name text, client_id uuid, client_name text,
  manager_id uuid, manager_name text,
  project_scope text, parent_project_id uuid, operating_experience text,
  unit_number int, unit_code text, unit_type text, sequence_number int,
  core_stage text, health text, progress_pct int, priority text,
  start_date date, due_date date, created_at timestamptz,
  open_tasks int, overdue_tasks int, pending_approvals int,
  awaiting_client boolean, delivered boolean, closure_status text,
  next_shoot jsonb, next_action text
) language sql stable security definer set search_path = public as $$
  with v_today as (select (now() at time zone 'Asia/Riyadh')::date d)
  select p.id, p.project_name, p.client_id,
    nullif(btrim(coalesce(cl.full_name, cl.company)),'') as client_name,
    (select m.user_id from public.project_members m where m.project_id = p.id
       and m.role = 'kian_manager' and m.is_deleted = false order by m.created_at limit 1) as manager_id,
    (select pr.full_name from public.project_members m join public.profiles pr on pr.id = m.user_id
       where m.project_id = p.id and m.role = 'kian_manager' and m.is_deleted = false order by m.created_at limit 1) as manager_name,
    coalesce(p.project_scope,'standalone') as project_scope, p.parent_project_id,
    -- تجربة التشغيل المشتقّة (8C): master⇒program، subproject⇒standard، standalone⇒المخزَّن.
    case when coalesce(p.project_scope,'standalone') = 'master' then 'program'
         when coalesce(p.project_scope,'standalone') = 'subproject' then 'standard'
         else coalesce(p.operating_experience,'standard') end as operating_experience,
    p.unit_number, p.unit_code, p.unit_type, p.sequence_number,
    coalesce(pc.core_stage,'project_created') as core_stage,
    coalesce(pc.health,'on_track') as health, coalesce(pc.progress_pct,0) as progress_pct,
    coalesce(pc.priority,'normal') as priority, pc.start_date, pc.due_date, p.created_at,
    (select count(*)::int from public.project_tasks t where t.project_id = p.id and t.is_deleted = false
       and t.status not in ('done','cancelled')) as open_tasks,
    (select count(*)::int from public.project_tasks t, v_today where t.project_id = p.id and t.is_deleted = false
       and t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today.d) as overdue_tasks,
    (select count(*)::int from public.project_approvals a where a.project_id = p.id and a.status = 'pending') as pending_approvals,
    exists (select 1 from public.deliverables d where d.project_id = p.id and coalesce(d.is_deleted,false)=false
              and d.status = 'client_review') or coalesce(pc.core_stage,'') = 'client_review' as awaiting_client,
    coalesce(pc.core_stage,'') in ('delivered','closed') as delivered,
    public.pc_project_closure_status(p.id) as closure_status,
    (select jsonb_build_object('id', s.id, 'title', s.title, 'session_date', s.session_date)
       from public.project_shoot_sessions s where s.project_id = p.id and coalesce(s.is_deleted,false)=false
         and s.status not in ('cancelled','completed') and s.session_date is not null
       order by s.session_date limit 1) as next_shoot,
    -- إجراء تالٍ خفيف للمحفظة (تلميح لا يُخزَّن) — الترتيب معلن.
    case
      when coalesce(pc.core_stage,'') = 'closed' then 'none'
      when (select m.user_id from public.project_members m where m.project_id = p.id
              and m.role = 'kian_manager' and m.is_deleted = false limit 1) is null then 'assign_manager'
      when (select count(*) from public.project_tasks t, v_today where t.project_id = p.id and t.is_deleted = false
              and t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today.d) > 0 then 'clear_overdue'
      when coalesce(pc.core_stage,'') = 'client_review' or exists (select 1 from public.deliverables d
              where d.project_id = p.id and coalesce(d.is_deleted,false)=false and d.status = 'client_review')
        then 'awaiting_client'
      when coalesce(pc.core_stage,'') = 'delivered'
           and coalesce(public.pc_project_closure_status(p.id),'closure_not_started') = 'closure_not_started' then 'start_closure'
      when (select count(*) from public.project_tasks t where t.project_id = p.id and t.is_deleted = false
              and t.status not in ('done','cancelled')) > 0 then 'work_tasks'
      else 'none' end as next_action
  from public.projects p
  left join public.project_core pc on pc.project_id = p.id
  left join public.clients cl on cl.id = p.client_id
  where p.is_deleted = false
    -- نفس رؤية اللوحة، وبفحص العزل لكل صفّ (لا تسريب أسماء/مدراء خارج الصلاحية).
    and public.pc_can_read_project(p.id);
$$;
revoke execute on function public.pgf_portfolio_rows() from public, anon, authenticated;
comment on function public.pgf_portfolio_rows() is
  '9B: مجموعة المشاريع المرئية بحقولها المشتقّة (نداء واحد، بلا Temp) — داخلية، بوّابتها من مُستدعيها.';

-- ════════════════════════════════════════════════════════════════════════════
-- الواجهة العامّة: المحفظة المنظَّمة (عدّادات + أقسام + ترقيم على الخادم).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_portfolio_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_section text := nullif(p_filters->>'section','');       -- programs | standalone | quick | null(=summary+heads)
  v_search text := nullif(btrim(p_filters->>'search'),'');
  v_status text := nullif(p_filters->>'status','');          -- late|critical|awaiting_client|near_delivery|no_manager|needs_action
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int, 0), 0);
  -- ترقيم مستقلّ لكل قسم (تصفّح الرئيسية لا يُخفي المستقلة/السريعة). الافتراض offset الموحّد.
  v_moff int := greatest(coalesce((p_filters->>'master_offset')::int, (p_filters->>'offset')::int, 0), 0);
  v_soff int := greatest(coalesce((p_filters->>'standalone_offset')::int, (p_filters->>'offset')::int, 0), 0);
  v_qoff int := greatest(coalesce((p_filters->>'quick_offset')::int, (p_filters->>'offset')::int, 0), 0);
  v_me uuid := auth.uid();
  v_result jsonb;
begin
  if not coalesce(public.is_staff(), false) then raise exception 'not authorized'; end if;

  -- كل الاشتقاق داخل **بيان واحد** (بلا Temp): pgf_portfolio_rows تُستدعى مرّة واحدة،
  -- ثمّ CTEs مشتركة للعدّادات والأقسام الثلاثة معًا.
  with rows as (select * from public.pgf_portfolio_rows()),
  flags as (
    select r.*,
      (r.overdue_tasks > 0) as f_overdue,
      (r.health = 'off_track') as f_critical,
      (r.due_date is not null and r.due_date < v_today and r.core_stage not in ('closed','delivered')) as f_late,
      (r.core_stage in ('approved','post_production') and r.core_stage not in ('closed','delivered')) as f_near,
      (r.manager_id is null and r.core_stage <> 'closed') as f_no_mgr,
      (r.delivered and coalesce(r.closure_status,'closure_not_started') = 'closure_not_started') as f_deliv_no_close,
      (r.next_action <> 'none' and r.manager_id = v_me) as f_mine
    from rows r
  ),
  -- تصنيف: master / orphan-subproject (رئيسيّه غير مرئيّ) / standalone-standard / quick
  vis_ids as (select id from flags),
  classified as (
    select f.*,
      case
        when f.project_scope = 'master' then 'master'
        when f.project_scope = 'subproject' then
          case when f.parent_project_id in (select id from flags where project_scope='master') then 'child' else 'orphan' end
        when f.operating_experience = 'simple' then 'quick'
        else 'standard' end as bucket
    from flags f
  ),
  -- تجميع الفروع لكل رئيسيّ (من الفروع المرئية فقط)
  rollup as (
    select c.parent_project_id as master_id,
      count(*)::int as child_count,
      count(*) filter (where c.f_late)::int as late_children,
      count(*) filter (where c.f_critical)::int as critical_children,
      count(*) filter (where c.awaiting_client)::int as awaiting_client_children,
      round(avg(c.progress_pct))::int as children_progress,
      min(c.due_date) filter (where c.due_date is not null) as nearest_due,
      max(case c.health when 'off_track' then 3 when 'at_risk' then 2 else 1 end) as worst_health_rank
    from classified c where c.bucket = 'child' group by c.parent_project_id
  ),
  child_json as (
    select c.parent_project_id as master_id,
      jsonb_agg(jsonb_build_object(
        'id', c.id, 'project_name', c.project_name, 'unit_number', c.unit_number, 'unit_code', c.unit_code,
        'unit_type', c.unit_type, 'core_stage', c.core_stage, 'progress_pct', c.progress_pct, 'health', c.health,
        'manager_name', c.manager_name, 'due_date', c.due_date, 'next_action', c.next_action, 'late', c.f_late
      ) order by c.unit_number nulls last, c.sequence_number nulls last, c.project_name) as children
    from classified c where c.bucket = 'child' group by c.parent_project_id
  ),
  -- صفوف الأقسام مرقَّمة بعد البحث/الفلتر (الترقيم على الخادم)
  master_rows as (
    select row_number() over (order by m.project_name, m.id) as rn,
      jsonb_build_object(
        'id', m.id, 'project_name', m.project_name, 'client_name', m.client_name, 'manager_name', m.manager_name,
        'operating_experience', m.operating_experience, 'health', m.health, 'own_progress', m.progress_pct,
        'core_stage', m.core_stage, 'due_date', m.due_date, 'start_date', m.start_date, 'next_action', m.next_action,
        'child_count', coalesce(ru.child_count,0), 'late_children', coalesce(ru.late_children,0),
        'critical_children', coalesce(ru.critical_children,0), 'awaiting_client_children', coalesce(ru.awaiting_client_children,0),
        'children_progress', ru.children_progress,
        'children_health', case coalesce(ru.worst_health_rank,1) when 3 then 'off_track' when 2 then 'at_risk' else 'on_track' end,
        'nearest_due', ru.nearest_due,
        'children', coalesce(cj.children, '[]'::jsonb)
      ) as x
    from classified m
    left join rollup ru on ru.master_id = m.id
    left join child_json cj on cj.master_id = m.id
    where m.bucket = 'master'
      and (v_search is null or m.project_name ilike '%'||v_search||'%' or coalesce(m.client_name,'') ilike '%'||v_search||'%'
           or coalesce(m.manager_name,'') ilike '%'||v_search||'%'
           or exists (select 1 from classified c where c.parent_project_id = m.id and c.bucket='child'
                        and (c.project_name ilike '%'||v_search||'%' or coalesce(c.unit_code,'') ilike '%'||v_search||'%')))
      and (v_status is null
           or (v_status='late' and (m.f_late or coalesce(ru.late_children,0) > 0))
           or (v_status='critical' and (m.f_critical or coalesce(ru.critical_children,0) > 0))
           or (v_status='awaiting_client' and (m.awaiting_client or coalesce(ru.awaiting_client_children,0) > 0))
           or (v_status='no_manager' and m.f_no_mgr) or (v_status='needs_action' and m.f_mine))
  ),
  standalone_rows as (
    select row_number() over (order by s.project_name, s.id) as rn,
      jsonb_build_object(
        'id', s.id, 'project_name', s.project_name, 'client_name', s.client_name, 'manager_name', s.manager_name,
        'core_stage', s.core_stage, 'progress_pct', s.progress_pct, 'health', s.health, 'due_date', s.due_date,
        'next_action', s.next_action, 'is_orphan_child', s.bucket = 'orphan', 'unit_number', s.unit_number) as x
    from classified s
    where s.bucket in ('standard','orphan')
      and (v_search is null or s.project_name ilike '%'||v_search||'%' or coalesce(s.client_name,'') ilike '%'||v_search||'%'
           or coalesce(s.manager_name,'') ilike '%'||v_search||'%')
      and (v_status is null or (v_status='late' and s.f_late) or (v_status='critical' and s.f_critical)
           or (v_status='awaiting_client' and s.awaiting_client) or (v_status='near_delivery' and s.f_near)
           or (v_status='no_manager' and s.f_no_mgr) or (v_status='needs_action' and s.f_mine))
  ),
  quick_rows as (
    select row_number() over (order by q.project_name, q.id) as rn,
      jsonb_build_object(
        'id', q.id, 'project_name', q.project_name, 'client_name', q.client_name, 'project_type', q.unit_type,
        'core_stage', q.core_stage, 'progress_pct', q.progress_pct, 'start_date', q.start_date, 'due_date', q.due_date,
        'awaiting_client', q.awaiting_client, 'next_action', q.next_action, 'next_shoot', q.next_shoot) as x
    from classified q
    where q.bucket = 'quick'
      and (v_search is null or q.project_name ilike '%'||v_search||'%' or coalesce(q.client_name,'') ilike '%'||v_search||'%'
           or coalesce(q.manager_name,'') ilike '%'||v_search||'%')
      and (v_status is null or (v_status='late' and q.f_late) or (v_status='awaiting_client' and q.awaiting_client)
           or (v_status='near_delivery' and q.f_near) or (v_status='needs_action' and q.f_mine))
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'programs', jsonb_build_object(
        'programs', (select count(*) from classified where bucket='master' and operating_experience='program'),
        'masters', (select count(*) from classified where bucket='master'),
        'units', (select count(*) from classified where bucket='child'),
        'late', (select count(*) from classified m left join rollup ru on ru.master_id=m.id
                   where m.bucket='master' and (m.f_late or coalesce(ru.late_children,0) > 0)),
        'critical', (select count(*) from classified m left join rollup ru on ru.master_id=m.id
                   where m.bucket='master' and (m.f_critical or coalesce(ru.critical_children,0) > 0)),
        'awaiting_client', (select count(*) from classified m left join rollup ru on ru.master_id=m.id
                   where m.bucket='master' and (m.awaiting_client or coalesce(ru.awaiting_client_children,0) > 0))),
      'standalone', jsonb_build_object(
        'active', (select count(*) from classified where bucket in ('standard','orphan') and core_stage not in ('closed','delivered')),
        'late', (select count(*) from classified where bucket in ('standard','orphan') and f_late),
        'awaiting_client', (select count(*) from classified where bucket in ('standard','orphan') and awaiting_client),
        'near_delivery', (select count(*) from classified where bucket in ('standard','orphan') and f_near),
        'no_manager', (select count(*) from classified where bucket in ('standard','orphan') and f_no_mgr)),
      'quick', jsonb_build_object(
        'open', (select count(*) from classified where bucket='quick' and core_stage <> 'closed'),
        'today_tasks', (select coalesce(sum(open_tasks),0) from classified where bucket='quick'),
        'late', (select count(*) from classified where bucket='quick' and f_late),
        'near_delivery', (select count(*) from classified where bucket='quick' and f_near),
        'ready', (select count(*) from classified where bucket='quick' and (delivered
                   or core_stage in ('approved','post_production')))),
      'needs_intervention', jsonb_build_object(
        'no_manager', (select count(*) from classified where f_no_mgr),
        'overdue_tasks', (select count(*) from classified where f_overdue),
        'critical_health', (select count(*) from classified where f_critical),
        'awaiting_client', (select count(*) from classified where awaiting_client),
        'overdue_approvals', (select count(*) from classified cc where cc.pending_approvals > 0
                   and exists (select 1 from public.project_approvals a where a.project_id = cc.id
                                and a.status='pending' and a.due_at is not null and a.due_at < now())),
        'delivered_not_closed', (select count(*) from classified where f_deliv_no_close),
        'needs_my_action', (select count(*) from classified where f_mine))),
    'masters', jsonb_build_object(
      'total', (select count(*) from master_rows),
      'rows', coalesce((select jsonb_agg(x order by rn) from master_rows where rn > v_moff and rn <= v_moff + v_limit), '[]'::jsonb)),
    'standalone', jsonb_build_object(
      'total', (select count(*) from standalone_rows),
      'rows', coalesce((select jsonb_agg(x order by rn) from standalone_rows where rn > v_soff and rn <= v_soff + v_limit), '[]'::jsonb)),
    'quick', jsonb_build_object(
      'total', (select count(*) from quick_rows),
      'rows', coalesce((select jsonb_agg(x order by rn) from quick_rows where rn > v_qoff and rn <= v_qoff + v_limit), '[]'::jsonb)),
    'section', v_section, 'limit', v_limit,
    'offset', jsonb_build_object('masters', v_moff, 'standalone', v_soff, 'quick', v_qoff),
    'today', v_today, 'generated_at', now())
  into v_result;

  return v_result;
end $$;
revoke execute on function public.project_portfolio_overview(jsonb) from public, anon;
grant execute on function public.project_portfolio_overview(jsonb) to authenticated;
comment on function public.project_portfolio_overview(jsonb) is
  '9B: المحفظة الهرمية — عدّادات + أقسام (رئيسية بفروع مجمَّعة/مستقلة/سريعة) بترقيم خادميّ وعزل لكل صفّ. لا مالية.';

-- ════════════════════════════════════════════════════════════════════════════
-- اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text;
begin
  if to_regprocedure('public.project_portfolio_overview(jsonb)') is null
    then raise exception '9B FAIL: project_portfolio_overview مفقودة'; end if;
  if to_regprocedure('public.pgf_portfolio_rows()') is null
    then raise exception '9B FAIL: pgf_portfolio_rows مفقودة'; end if;
  -- المُساعد الداخليّ غير ممنوح لأحد
  if exists (select 1 from information_schema.role_routine_grants
             where routine_name='pgf_portfolio_rows' and grantee in ('authenticated','PUBLIC'))
    then raise exception '9B FAIL: pgf_portfolio_rows ممنوح لمستخدم'; end if;
  -- الواجهة العامّة محروسة is_staff، وتعزل كل صفّ بـpc_can_read_project
  v_def := pg_get_functiondef('public.project_portfolio_overview(jsonb)'::regprocedure);
  if position('is_staff()' in v_def) = 0 then raise exception '9B FAIL: المحفظة بلا بوّابة طاقم'; end if;
  v_def := pg_get_functiondef('public.pgf_portfolio_rows()'::regprocedure);
  if position('pc_can_read_project(p.id)' in v_def) = 0 then raise exception '9B FAIL: بلا عزل لكل صفّ'; end if;
  -- لا مالية في المحفظة
  if pg_get_functiondef('public.project_portfolio_overview(jsonb)'::regprocedure) ~* 'budget|profit|actual_cost|estimated_cost'
    then raise exception '9B FAIL: المحفظة تكشف مالية'; end if;
  -- الفرع لا يُصنَّف مرّتين (bucket واحد لكل صفّ)
  v_def := pg_get_functiondef('public.project_portfolio_overview(jsonb)'::regprocedure);
  if position('as bucket' in v_def) = 0 then raise exception '9B FAIL: بلا تصنيف bucket أحاديّ'; end if;
  raise notice '9B ✅ نجح الاختبار الذاتي — محفظة هرمية، عزل لكل صفّ، بلا مالية، الفرع مرّة واحدة.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
