-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 7B — مركز العمليات اليومية (Operations Command Center)
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط):
--   • لا لوحة تشغيل يومية موحّدة — البيانات موزّعة على ProjectCoreDashboard /
--     ExecutiveDashboard / ClosureCenter / ConflictCenter / Approvals / Tasks.
--   • المصادر كلّها موجودة ومعزولة: exec_visible_projects (5B، setof uuid مصفّى
--     per-row بـpc_can_read_project)، my_approval_inbox (5A)، my_closure_inbox (5C)،
--     resource_conflict_center / resource_timeline_snapshot (4B، بوابة res_can)،
--     project_tasks + project_task_assignees (3A)، project_shoot_sessions،
--     resource_bookings، deliverables، project_risks/issues/change_requests (5A)،
--     public.notifications (phase0 — المركز الحيّ الذي تقرؤه lib/portal/notifications.ts).
--
-- ما تفعله هذه الدفعة: **تركيب** لا بناء موازٍ. أربع دوال قراءة تجمع المصادر أعلاه
-- في نداءات محدودة، فلترة Server-side، وعزل per-row عبر pc_can_read_project.
--
-- قيود ملتزَم بها: قراءة فقط · لا تعريف جديد لبوّابات الوصول · core_stage/progress
-- لا يُكتبان هنا · لا كتابة مالية · لا Zoho · لا تعديل عهدة · لا نظام مهام/إشعارات/
-- اعتمادات موازٍ · لا جداول مؤقتة داخل دوال القراءة · العميل مستبعد كليًّا.
--
-- ترتيب التشغيل: Project Core → (3A tasks) → (4B resources) → (5A/5B/5C) →
--   (6A/6B/6C) → 7A → 7B.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  -- 7B PREFLIGHT — يتوقّف بوضوح إن كانت المصادر الأساسية غائبة.
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '7B PREFLIGHT: pc_can_read_project مفقودة (Project Core غير مطبّق)'; end if;
  if to_regprocedure('public.exec_visible_projects(jsonb)') is null
    then raise exception '7B PREFLIGHT: exec_visible_projects مفقودة (شغّل 5B أولًا)'; end if;
  if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.staff_reads_all_projects()') is null
    then raise exception '7B PREFLIGHT: بوّابات الأدوار مفقودة'; end if;
  if to_regclass('public.project_tasks') is null or to_regclass('public.project_core') is null
    then raise exception '7B PREFLIGHT: جداول المشاريع/المهام مفقودة'; end if;
  -- المصادر الاختيارية (my_approval_inbox / my_closure_inbox / resource_* / notifications)
  -- تُلتقط بـto_regprocedure/to_regclass داخل الدوال وتعيد "unavailable" بدل الفشل.
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) صلاحية دخول المركز (تُضاف إلى الكتالوج القائم — لا كتالوج موازٍ).
--     الأقسام الفرعية تُحكم ببوّاباتها الحقيقية القائمة (res_can / gov_can /
--     closure_can / pc_can_read_project) لا بمفاتيح جوفاء.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice '7B: كتالوج الصلاحيات غير موجود — operations.view تُتخطّى'; return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
    ('operations.view','projects_tasks','normal', 940,'عرض مركز العمليات','View operations center')
  on conflict (key) do nothing;
end $perm$;

-- بوابة المركز: staff فقط (العميل مستبعد). أيّ موظّف يرى مركزه الشخصي (أعماله فقط)؛
-- النطاق (أيّ مشاريع/مهام) يضبطه pc_can_read_project لا هذه البوابة.
create or replace function public.ops_can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff();
$$;
revoke execute on function public.ops_can_view() from public, anon;
grant execute on function public.ops_can_view() to authenticated;

-- المجموعة المرئية للمستخدم (per-row pc_can_read_project داخل exec_visible_projects).
-- يُعاد استخدامها في كل الدوال بلا تكرار منطق العزل.
create or replace function public.ops_visible_ids(p_filters jsonb)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[];
begin
  begin
    select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  exception when others then v_ids := null; end;
  return coalesce(v_ids, '{}'::uuid[]);
end $$;
revoke execute on function public.ops_visible_ids(jsonb) from public, anon;
grant execute on function public.ops_visible_ids(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) اللوحة المركزية — النظرة العامة + الملخّص (عدّادات رخيصة فقط، بلا تفاصيل ثقيلة).
--     أثقل الأقسام (Attention / My Work / Schedule) دوال مستقلّة تُحمَّل كسولًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.operations_command_center(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_reads_all boolean := coalesce(public.staff_reads_all_projects(), false);
  v_mgmt boolean := coalesce(public.can_manage_projects(), false);
  v_res_view boolean := false;
  v_summary jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_appr jsonb; v_appr_mine int := 0; v_appr_overdue int := 0;
  v_clos jsonb; v_clos_pending int := 0;
  -- عدّادات المهام على المجموعة المرئية
  v_t_today int := 0; v_t_overdue int := 0; v_t_blocked int := 0; v_t_unassigned int := 0; v_t_reviews int := 0;
  v_shoots_today int := 0; v_shoots_7 int := 0;
  v_book_today int := 0; v_conflicts int; v_deliv_review int := 0;
  v_risks_crit int := 0; v_issues_crit int := 0; v_changes_pending int := 0;
  v_attn int := 0; v_notif_unread int;
begin
  if not public.ops_can_view() then raise exception 'not authorized'; end if;
  v_ids := public.ops_visible_ids(p_filters);
  begin v_res_view := coalesce(public.res_can('resources.view'), false); exception when undefined_function then v_res_view := false; end;

  -- ─── مهام المجموعة المرئية (حيّة فقط) ───
  begin
    select
      count(*) filter (where t.due_date = v_today),
      count(*) filter (where t.due_date is not null and t.due_date < v_today),
      count(*) filter (where t.status = 'blocked'),
      -- «بلا مسؤول» = لا assignee_id ولا مسنَد owner/contributor؛ المراقب/المراجع لا يجعلها مُسنَدة.
      count(*) filter (where t.assignee_id is null
                        and not exists (select 1 from public.project_task_assignees a
                                        where a.task_id = t.id and a.assignment_role in ('owner','contributor'))),
      -- 3A رحّلت in_review → internal_review؛ حالتا المراجعة الحيّتان: internal_review/client_review.
      count(*) filter (where t.status in ('internal_review','client_review'))
      into v_t_today, v_t_overdue, v_t_blocked, v_t_unassigned, v_t_reviews
    from public.project_tasks t
    where t.project_id = any(v_ids) and coalesce(t.is_deleted,false) = false
      and t.status not in ('done','cancelled');
  exception when undefined_table or undefined_column then null; end;

  -- ─── جلسات التصوير ───
  begin
    select count(*) filter (where s.session_date = v_today),
           count(*) filter (where s.session_date >= v_today and s.session_date < v_today + 7)
      into v_shoots_today, v_shoots_7
    from public.project_shoot_sessions s
    where s.project_id = any(v_ids) and coalesce(s.is_deleted,false) = false and s.status <> 'cancelled';
  exception when undefined_table or undefined_column then null; end;

  -- ─── حجوزات الموارد اليوم (بحسب صلاحية الموارد فقط) ───
  if v_res_view then
    begin
      select count(*) into v_book_today
      from public.resource_bookings b
      where b.project_id = any(v_ids) and coalesce(b.is_deleted,false) = false
        and b.status not in ('cancelled','rejected')
        and (b.starts_at at time zone 'Asia/Riyadh')::date = v_today;
    exception when undefined_table or undefined_column then null; end;
  end if;

  -- ─── تعارضات الموارد (تركيب resource_conflict_center — لا إعادة حساب) ───
  v_conflicts := null;   -- null = غير متاح (لا صلاحية أو غير مطبّق)
  if v_res_view and to_regprocedure('public.resource_conflict_center(jsonb)') is not null then
    begin
      v_conflicts := coalesce(jsonb_array_length((public.resource_conflict_center('{}'::jsonb))->'conflicts'), 0);
    exception when others then v_conflicts := null; end;
  end if;

  -- ─── مخرجات بانتظار مراجعة العميل / تعديل ───
  begin
    select count(*) into v_deliv_review
    from public.deliverables d
    where d.project_id = any(v_ids) and d.status in ('client_review','revision_requested');
  exception when undefined_table or undefined_column then null; end;

  -- ─── المخاطر/المشكلات الحرجة المفتوحة + طلبات التغيير المعلّقة ───
  begin
    -- vocab المخاطر بعد 5A = (open,mitigating,closed,accepted,occurred)؛ المفتوح الحرج
    -- = severity=critical and status not in ('closed','accepted') (نفس فلتر 5A الرسمي).
    select count(*) into v_risks_crit from public.project_risks r
    where r.project_id = any(v_ids) and coalesce(r.is_deleted,false)=false
      and r.severity='critical' and r.status not in ('closed','accepted');
  exception when undefined_table or undefined_column then null; end;
  begin
    -- المشكلات المفتوحة = status not in ('resolved','closed','rejected') (فلتر 5A الرسمي).
    select count(*) into v_issues_crit from public.project_issues i
    where i.project_id = any(v_ids) and coalesce(i.is_deleted,false)=false
      and i.severity='critical' and i.status not in ('resolved','closed','rejected');
  exception when undefined_table or undefined_column then null; end;
  begin
    select count(*) into v_changes_pending from public.project_change_requests c
    where c.project_id = any(v_ids) and coalesce(c.is_deleted,false)=false
      and c.status in ('submitted','impact_analysis','pending_approval');
  exception when undefined_table or undefined_column then null; end;

  -- ─── الاعتمادات (تركيب my_approval_inbox — عدّ mine/overdue بلا تكرار منطق) ───
  v_appr_mine := 0; v_appr_overdue := 0;
  if to_regprocedure('public.my_approval_inbox(jsonb)') is not null then
    begin
      v_appr := public.my_approval_inbox('{}'::jsonb);
      -- المتأخّرة تُقيَّد بـmine أيضًا لتتّسق مع بطاقة «تنتظر قراري» وقائمة عملي (كلاهما mine).
      select count(*) filter (where (e->>'mine')::boolean and e->>'status'='pending'),
             count(*) filter (where (e->>'overdue')::boolean and (e->>'mine')::boolean)
        into v_appr_mine, v_appr_overdue
      from jsonb_array_elements(coalesce(v_appr->'approvals','[]'::jsonb)) e;
    exception when others then v_appr_mine := 0; v_appr_overdue := 0; end;
  end if;

  -- ─── طلبات الإغلاق المعلّقة (تركيب my_closure_inbox) ───
  v_clos_pending := 0;
  if to_regprocedure('public.my_closure_inbox(jsonb)') is not null then
    begin
      v_clos := public.my_closure_inbox('{}'::jsonb);
      v_clos_pending := coalesce(jsonb_array_length(v_clos->'closure_requests'),0)
                      + coalesce(jsonb_array_length(v_clos->'acceptances'),0)
                      + coalesce(jsonb_array_length(v_clos->'reopen_requests'),0);
    exception when others then v_clos_pending := 0; end;
  end if;

  -- ─── الإشعارات غير المقروءة (public.notifications الحيّ — الموجّهة لي فقط) ───
  v_notif_unread := null;
  begin
    select count(*) into v_notif_unread from public.notifications
    where recipient_id = v_uid and read_at is null;
  exception when undefined_table or undefined_column then v_notif_unread := null; end;

  -- ─── طابور الانتباه: العدّ فقط هنا (التفاصيل في operations_attention_queue) ───
  begin
    select count(*) into v_attn from public.project_core pc
    where pc.project_id = any(v_ids)
      and (pc.health = 'off_track'
           or (pc.due_date is not null and pc.due_date < v_today and pc.core_stage not in ('delivered','closed')));
  exception when undefined_table or undefined_column then v_attn := 0; end;

  v_summary := jsonb_build_object(
    'tasks_today', v_t_today, 'tasks_overdue', v_t_overdue, 'tasks_blocked', v_t_blocked,
    'tasks_unassigned', v_t_unassigned, 'reviews_pending', v_t_reviews,
    'approvals_mine', v_appr_mine, 'approvals_overdue', v_appr_overdue,
    'deliverables_client_review', v_deliv_review,
    'shoots_today', v_shoots_today, 'shoots_next7', v_shoots_7,
    'bookings_today', case when v_res_view then to_jsonb(v_book_today) else to_jsonb('unavailable'::text) end,
    'resource_conflicts', case when v_conflicts is null then to_jsonb('unavailable'::text) else to_jsonb(v_conflicts) end,
    'risks_critical', v_risks_crit, 'issues_critical', v_issues_crit,
    'change_requests_pending', v_changes_pending, 'closures_pending', v_clos_pending,
    'projects_attention', v_attn,
    'notifications_unread', case when v_notif_unread is null then to_jsonb('unavailable'::text) else to_jsonb(v_notif_unread) end);

  -- تحذيرات على مستوى المجموعة (مشتقّة، لا تُخزَّن)
  begin
    select coalesce(jsonb_agg(w),'[]'::jsonb) into v_warnings from (
      select jsonb_build_object('code','no_manager','ar','مشاريع بلا مدير','count',count(*)) w
        from public.projects p join public.project_core pc on pc.project_id=p.id
       where p.id=any(v_ids) and coalesce(p.is_deleted,false)=false
         and pc.core_stage not in ('delivered','closed')
         and not exists (select 1 from public.project_members m where m.project_id=p.id and m.role='kian_manager')
      having count(*) > 0
      union all
      select jsonb_build_object('code','delivered_not_closed','ar','مشاريع مُسلَّمة بلا إغلاق','count',count(*))
        from public.project_core pc
       where pc.project_id=any(v_ids) and pc.core_stage='delivered'
      having count(*) > 0
    ) z;
  exception when undefined_table or undefined_column then v_warnings := '[]'::jsonb; end;

  return jsonb_build_object(
    'viewer', jsonb_build_object('user_id', v_uid, 'is_management', v_mgmt, 'reads_all', v_reads_all,
                                 'resource_view', v_res_view, 'visible_project_count', coalesce(array_length(v_ids,1),0)),
    'summary', v_summary,
    'warnings', v_warnings,
    'today', v_today,
    'generated_at', now());
end $$;
revoke execute on function public.operations_command_center(jsonb) from public, anon;
grant execute on function public.operations_command_center(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) عملي اليوم — كل ما هو مسنَد للمستخدم أو مطلوب منه (مقيّد بـauth.uid()).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.operations_my_work(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,100),1),300);
  v_tasks jsonb := '[]'::jsonb; v_reviews jsonb := '[]'::jsonb; v_shoots jsonb := '[]'::jsonb;
  v_bookings jsonb := '[]'::jsonb; v_appr jsonb := '[]'::jsonb; v_clos jsonb := '{}'::jsonb;
begin
  if not public.ops_can_view() then raise exception 'not authorized'; end if;
  if v_uid is null then raise exception 'not authorized'; end if;

  -- مهامي: مسنَدة إليّ (assignee_id أو project_task_assignees) + مرئية + حيّة.
  begin
    select coalesce(jsonb_agg(x order by (x->>'due_date') nulls last), '[]'::jsonb) into v_tasks from (
      select jsonb_build_object(
          'id', t.id, 'title', t.title, 'project_id', t.project_id,
          'project_name', (select project_name from public.projects p where p.id=t.project_id),
          'priority', t.priority, 'status', t.status, 'due_date', t.due_date, 'start_date', t.start_date,
          'overdue', (t.due_date is not null and t.due_date < v_today and t.status not in ('done','cancelled')),
          'bucket', case
             when t.status = 'blocked' then 'blocked'
             when t.due_date is not null and t.due_date < v_today then 'overdue'
             when t.due_date = v_today then 'today'
             when t.due_date is not null and t.due_date < v_today + 7 then 'upcoming'
             else 'later' end,
          'action_url', '/client-portal/project-core/'||t.project_id||'?tab=tasks') x
      -- UNION (لا OR + EXISTS): يتيح استعمال الفهارس على assignee_id وعلى المسنَدين بدل مسح كل المهام.
      from public.project_tasks t
      where t.id in (
              select t2.id from public.project_tasks t2 where t2.assignee_id = v_uid
              union
              select a.task_id from public.project_task_assignees a where a.user_id = v_uid)
        and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
        and public.pc_can_read_project(t.project_id)
      order by t.due_date nulls last limit v_limit
    ) q;
  exception when undefined_table or undefined_column then v_tasks := '[]'::jsonb; end;

  -- مراجعات مطلوبة منّي: مهام internal_review أنا reviewer عليها (3A: in_review→internal_review).
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'project_id', t.project_id,
        'project_name', (select project_name from public.projects p where p.id=t.project_id),
        'kind', 'task_review', 'due_date', t.due_date,
        'action_url', '/client-portal/project-core/'||t.project_id||'?tab=tasks') order by t.due_date nulls last), '[]'::jsonb)
      into v_reviews
    from public.project_tasks t
    where coalesce(t.is_deleted,false)=false and t.status in ('internal_review','client_review') and public.pc_can_read_project(t.project_id)
      and exists (select 1 from public.project_task_assignees a where a.task_id=t.id and a.user_id=v_uid and a.assignment_role='reviewer');
  exception when undefined_table or undefined_column then v_reviews := '[]'::jsonb; end;

  -- جلسات مشاريعي القادمة: crew مُخزَّن كأسطر نصّية (أسماء) لا كائنات user_id، فلا رابط
  -- موثوق للطاقم؛ نستعمل العضوية في المشروع (project_members) كإشارة شخصية دقيقة بدلًا منه.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'project_id', s.project_id,
        'project_name', (select project_name from public.projects p where p.id=s.project_id),
        'session_date', s.session_date, 'status', s.status,
        'action_url', '/client-portal/project-core/'||s.project_id||'?tab=shoots') order by s.session_date), '[]'::jsonb)
      into v_shoots
    from public.project_shoot_sessions s
    where coalesce(s.is_deleted,false)=false and s.status<>'cancelled' and s.session_date >= v_today
      and public.pc_can_read_project(s.project_id)
      and exists (select 1 from public.project_members m
                  where m.project_id = s.project_id and m.user_id = v_uid and coalesce(m.is_deleted,false)=false);
  exception when undefined_table or undefined_column then v_shoots := '[]'::jsonb; end;

  -- حجوزاتي: موارد أنا employee_user_id لها، عبر مشاريع مرئية (بحسب صلاحية الموارد).
  if to_regclass('public.resource_bookings') is not null and to_regclass('public.planning_resources') is not null then
    begin
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'project_id', b.project_id,
          'project_name', (select project_name from public.projects p where p.id=b.project_id),
          'resource', pr.display_name, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
          'action_url', case when b.project_id is not null then '/client-portal/project-core/'||b.project_id||'?tab=resources' else null end)
          order by b.starts_at), '[]'::jsonb)
        into v_bookings
      from public.resource_bookings b join public.planning_resources pr on pr.id=b.resource_id
      where coalesce(b.is_deleted,false)=false and b.status not in ('cancelled','rejected')
        and (b.ends_at at time zone 'Asia/Riyadh')::date >= v_today
        and pr.employee_user_id = v_uid
        and (b.project_id is null or public.pc_can_read_project(b.project_id));
    exception when undefined_table or undefined_column then v_bookings := '[]'::jsonb; end;
  end if;

  -- اعتماداتي (تركيب my_approval_inbox — الموجّهة إليّ فقط).
  if to_regprocedure('public.my_approval_inbox(jsonb)') is not null then
    begin
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_appr
      from jsonb_array_elements(coalesce((public.my_approval_inbox('{}'::jsonb))->'approvals','[]'::jsonb)) e
      where (e->>'mine')::boolean and e->>'status'='pending';
    exception when others then v_appr := '[]'::jsonb; end;
  end if;

  -- إغلاق/قبول/إعادة فتح مطلوبة منّي (تركيب my_closure_inbox كما هو).
  if to_regprocedure('public.my_closure_inbox(jsonb)') is not null then
    begin v_clos := public.my_closure_inbox('{}'::jsonb); exception when others then v_clos := '{}'::jsonb; end;
  end if;

  return jsonb_build_object(
    'tasks', v_tasks, 'task_reviews', v_reviews, 'shoot_sessions', v_shoots,
    'resource_bookings', v_bookings, 'approvals', v_appr, 'closure', v_clos,
    'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.operations_my_work(jsonb) from public, anon;
grant execute on function public.operations_my_work(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) طابور الانتباه — قواعد معلنة (لا AI)، urgency مشتقّة، Pagination.
--     كل سبب استعلام مجموعيّ واحد (لا استدعاء دالة لكل مشروع).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.operations_attention_queue(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,50),1),200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_rows jsonb; v_total int := 0;
begin
  if not public.ops_can_view() then raise exception 'not authorized'; end if;
  v_ids := public.ops_visible_ids(p_filters);

  with items as (
    -- مشروع off_track
    select 'critical'::text urgency, 'health_off_track' reason_code, 'صحّة المشروع حرجة' reason_ar,
           'project' entity_type, pc.project_id entity_id, pc.project_id project_id, null::timestamptz due_at,
           null::int age_days
      from public.project_core pc where pc.project_id=any(v_ids) and pc.health='off_track'
    union all
    -- مشروع at_risk
    select 'high','health_at_risk','صحّة المشروع معرّضة للخطر','project', pc.project_id, pc.project_id, null,null
      from public.project_core pc where pc.project_id=any(v_ids) and pc.health='at_risk'
    union all
    -- موعد تسليم متجاوز
    select 'critical','due_overdue','تجاوز موعد التسليم','project', pc.project_id, pc.project_id,
           pc.due_date::timestamptz, (v_today - pc.due_date)
      from public.project_core pc
     where pc.project_id=any(v_ids) and pc.due_date is not null and pc.due_date < v_today
       and pc.core_stage not in ('delivered','closed')
    union all
    -- مشروع بلا مدير
    select 'high','no_manager','مشروع بلا مدير','project', p.id, p.id, null, null
      from public.projects p join public.project_core pc on pc.project_id=p.id
     where p.id=any(v_ids) and coalesce(p.is_deleted,false)=false and pc.core_stage not in ('delivered','closed')
       and not exists (select 1 from public.project_members m where m.project_id=p.id and m.role='kian_manager')
    union all
    -- مُسلَّم ولم يبدأ الإغلاق
    select 'medium','delivered_not_closed','مُسلَّم ولم يبدأ الإغلاق','project', pc.project_id, pc.project_id, null, null
      from public.project_core pc where pc.project_id=any(v_ids) and pc.core_stage='delivered'
    union all
    -- مخاطرة حرجة مفتوحة
    select 'critical','risk_critical','مخاطرة حرجة مفتوحة','risk', r.id, r.project_id, null,
           (v_today - (r.created_at at time zone 'Asia/Riyadh')::date)
      from public.project_risks r
     where r.project_id=any(v_ids) and coalesce(r.is_deleted,false)=false and r.severity='critical'
       and r.status not in ('closed','accepted')
    union all
    -- مشكلة حرجة مفتوحة
    select 'critical','issue_critical','مشكلة حرجة مفتوحة','issue', i.id, i.project_id, null,
           (v_today - (i.created_at at time zone 'Asia/Riyadh')::date)
      from public.project_issues i
     where i.project_id=any(v_ids) and coalesce(i.is_deleted,false)=false and i.severity='critical'
       and i.status not in ('resolved','closed','rejected')
    union all
    -- طلب تغيير معلّق
    select 'high','change_pending','طلب تغيير بانتظار البتّ','change_request', c.id, c.project_id, null,
           (v_today - (c.created_at at time zone 'Asia/Riyadh')::date)
      from public.project_change_requests c
     where c.project_id=any(v_ids) and coalesce(c.is_deleted,false)=false
       and c.status in ('submitted','impact_analysis','pending_approval')
    union all
    -- مخرَج متأخّر لدى العميل (بانتظار مراجعته)
    select 'high','client_review_pending','مخرَج بانتظار مراجعة العميل','deliverable', d.id, d.project_id, null, null
      from public.deliverables d
     where d.project_id=any(v_ids) and d.status='client_review'
  ),
  filtered as (
    select * from items i
    where (nullif(p_filters->>'urgency','') is null or i.urgency = p_filters->>'urgency')
      and (nullif(p_filters->>'reason_code','') is null or i.reason_code = p_filters->>'reason_code')
  ),
  counted as (select count(*)::int c from filtered),
  paged as (
    select i.*, row_number() over (
        order by (case i.urgency when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end),
                 i.due_at nulls last, i.age_days desc nulls last, i.entity_id) rn
    from filtered i
  )
  select (select c from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'urgency', p.urgency, 'reason_code', p.reason_code, 'reason_ar', p.reason_ar,
           'entity_type', p.entity_type, 'entity_id', p.entity_id, 'project_id', p.project_id,
           'project_name', (select project_name from public.projects pj where pj.id=p.project_id),
           'due_at', p.due_at, 'age_days', p.age_days,
           'action_url', '/client-portal/project-core/'||p.project_id)
           order by p.rn) filter (where p.rn > v_offset and p.rn <= v_offset + v_limit), '[]'::jsonb)
    into v_total, v_rows
  from paged p;

  return jsonb_build_object('items', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'has_more', (v_offset + v_limit) < v_total, 'today', v_today, 'generated_at', now());
end $$;
revoke execute on function public.operations_attention_queue(jsonb) from public, anon;
grant execute on function public.operations_attention_queue(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) الجدول القادم — أحداث مؤرَّخة موحّدة، مفتاح تمييز (entity_type,entity_id).
--     المصادر منفصلة الكيانات ⇒ لا تكرار؛ schedule_items المرتبطة بكيان مباشر
--     تُستبعد كي لا يظهر الحدث مرّتين.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.operations_schedule(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_win text := coalesce(nullif(p_filters->>'window',''),'7d');
  v_from date; v_to date;
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,100),1),300);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_type text := nullif(p_filters->>'entity_type','');
  v_res_view boolean := false; v_rows jsonb; v_total int := 0;
begin
  if not public.ops_can_view() then raise exception 'not authorized'; end if;
  v_ids := public.ops_visible_ids(p_filters);
  -- 'tomorrow' يبدأ من الغد وينتهي بالغد (لا يشمل اليوم)؛ البقية تبدأ من اليوم.
  v_from := case v_win when 'tomorrow' then v_today+1 else v_today end;
  v_to := case v_win when 'today' then v_today when 'tomorrow' then v_today+1
                     when '30d' then v_today+30 else v_today+7 end;
  begin v_res_view := coalesce(public.res_can('resources.view'), false); exception when undefined_function then v_res_view := false; end;

  with ev as (
    -- مهام بموعد
    select 'task'::text entity_type, t.id entity_id, t.project_id, t.title,
           t.due_date::timestamptz at_ts, t.priority, t.status
      from public.project_tasks t
     where t.project_id=any(v_ids) and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
       and t.due_date is not null and t.due_date between v_from and v_to
    union all
    -- جلسات تصوير
    select 'shoot_session', s.id, s.project_id, s.title, s.session_date::timestamptz, null, s.status
      from public.project_shoot_sessions s
     where s.project_id=any(v_ids) and coalesce(s.is_deleted,false)=false and s.status<>'cancelled'
       and s.session_date is not null and s.session_date between v_from and v_to
    union all
    -- أحداث الخطة الزمنية: نستبعد فقط ما نُصدره مباشرةً كمصدر آخر (المهام والجلسات) كي لا
    -- يُكرّر الحدث؛ أمّا المرتبطة بمخرَج/اجتماع فتبقى لأنّها **المصدر الوحيد** لتلك الأحداث
    -- (لا نُصدر المخرجات/الاجتماعات من جدول آخر) — استبعادها كان يُسقطها كليًّا.
    select 'schedule_item', si.id, si.project_id, si.title,
           si.start_at, si.priority, si.status
      from public.project_schedule_items si
     where si.project_id=any(v_ids) and coalesce(si.is_deleted,false)=false and si.status<>'cancelled'
       and si.task_id is null and si.shoot_session_id is null
       and (si.start_at at time zone 'Asia/Riyadh')::date between v_from and v_to
    union all
    -- حجوزات موارد (بحسب صلاحية الموارد فقط) — تقاطُع مع النافذة: حجز بدأ قبلها وما زال جاريًا
    -- خلالها يجب أن يظهر، لا فقط ما يبدأ داخلها.
    select 'resource_booking', b.id, b.project_id,
           (select display_name from public.planning_resources pr where pr.id=b.resource_id),
           b.starts_at, null, b.status
      from public.resource_bookings b
     where v_res_view and b.project_id=any(v_ids) and coalesce(b.is_deleted,false)=false
       and b.status not in ('cancelled','rejected')
       and (b.starts_at at time zone 'Asia/Riyadh')::date <= v_to
       and (b.ends_at   at time zone 'Asia/Riyadh')::date >= v_from
  ),
  filtered as (select * from ev where v_type is null or entity_type = v_type),
  counted as (select count(*)::int c from filtered),
  paged as (
    select f.*, row_number() over (order by f.at_ts, f.entity_type, f.entity_id) rn from filtered f
  )
  select (select c from counted),
    coalesce(jsonb_agg(jsonb_build_object(
      'entity_type', p.entity_type, 'entity_id', p.entity_id, 'project_id', p.project_id,
      'project_name', (select project_name from public.projects pj where pj.id=p.project_id),
      'title', p.title, 'at', p.at_ts, 'priority', p.priority, 'status', p.status,
      'action_url', '/client-portal/project-core/'||p.project_id)
      order by p.rn) filter (where p.rn > v_offset and p.rn <= v_offset + v_limit), '[]'::jsonb)
    into v_total, v_rows
  from paged p;

  return jsonb_build_object('events', v_rows, 'total', v_total, 'window', v_win,
    'from', v_from, 'to', v_to, 'limit', v_limit, 'offset', v_offset,
    'has_more', (v_offset + v_limit) < v_total, 'generated_at', now());
end $$;
revoke execute on function public.operations_schedule(jsonb) from public, anon;
grant execute on function public.operations_schedule(jsonb) to authenticated;

comment on function public.operations_command_center(jsonb) is '7B: مركز العمليات — نظرة عامة + ملخّص عدّادات رخيصة، معزول per-row، العميل مستبعد.';
comment on function public.operations_my_work(jsonb) is '7B: عملي اليوم — مهام/مراجعات/جلسات/حجوزات/اعتمادات/إغلاق مقيّدة بـauth.uid().';
comment on function public.operations_attention_queue(jsonb) is '7B: طابور الانتباه — قواعد معلنة، urgency مشتقّة، Pagination.';
comment on function public.operations_schedule(jsonb) is '7B: الجدول القادم — أحداث موحّدة بمفتاح تمييز (entity_type,entity_id)، توقيت Asia/Riyadh.';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text;
begin
  foreach v_def in array array[
    'public.operations_command_center(jsonb)','public.operations_my_work(jsonb)',
    'public.operations_attention_queue(jsonb)','public.operations_schedule(jsonb)',
    'public.ops_can_view()','public.ops_visible_ids(jsonb)'] loop
    if to_regprocedure(v_def) is null then raise exception '7B FAIL: الدالة % مفقودة', v_def; end if;
  end loop;
  -- المركز يعزل per-row (يُركّب exec_visible_projects لا يجمع كل الجداول)
  v_def := pg_get_functiondef('public.operations_command_center(jsonb)'::regprocedure);
  if position('ops_visible_ids' in v_def) = 0 then raise exception '7B FAIL: المركز بلا مجموعة مرئية معزولة'; end if;
  if position('is_staff' in pg_get_functiondef('public.ops_can_view()'::regprocedure)) = 0
    then raise exception '7B FAIL: بوابة المركز لا تستبعد العميل'; end if;
  -- الجدول يستبعد schedule_items المرتبطة بكيان مباشر (منع التكرار)
  v_def := pg_get_functiondef('public.operations_schedule(jsonb)'::regprocedure);
  if position('si.task_id is null' in v_def) = 0 then raise exception '7B FAIL: الجدول قد يكرّر الأحداث'; end if;
  -- لا كتابة على core_stage/progress من أيّ دالة
  foreach v_def in array array['public.operations_command_center(jsonb)','public.operations_my_work(jsonb)',
      'public.operations_attention_queue(jsonb)','public.operations_schedule(jsonb)'] loop
    if pg_get_functiondef(v_def::regprocedure) ~* 'update\s+public\.project_core' then
      raise exception '7B FAIL: % تكتب على project_core', v_def; end if;
  end loop;
  raise notice '7B ✅ نجح الاختبار الذاتي — المركز/عملي/الانتباه/الجدول، عزل per-row وبلا كتابة.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
