-- ════════════════════════════════════════════════════════════════════════════
-- project_phase4_final_closure_RUNME.sql
-- PHASE 4 · BATCH 4D — FINAL UI, REPORTING, ALERTS & PHASE 4 CLOSURE (backend)
-- ────────────────────────────────────────────────────────────────────────────
-- المحتوى:
--   §1 صلاحيات جديدة (تقارير/مسار حرج/تنبيهات).
--   §2 project_planning_health — بطاقة صحّة موحّدة (تنفيذ + جدول + موارد) مفسّرة، بلا Black Box.
--   §3 resource_conflict_resolutions — اقتراحات حلّ تعارض قابلة للتفسير (لا تنفيذ تلقائي).
--   §4 resource_alerts_scan — تنبيهات موارد/تخطيط Idempotent عبر pc_event_emit + reminder_tracking
--      (يُعاد استخدام Cron الحالي؛ لا Cron جديد؛ العميل لا يُستلِم).
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا DROP FUNCTION/TABLE · بلا حذف بيانات ·
--   بلا Temp Tables في دوال القراءة · لا يمسّ core_stage/progress/المالية/Zoho/العهدة (قراءة) ·
--   Preflight للأعمدة/الدوال · self-test يُلغي المعاملة عند الفشل · notify pgrst.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
begin
  if to_regprocedure('public.project_schedule_health(uuid)') is null
     or to_regprocedure('public.project_execution_health(uuid)') is null
     or to_regprocedure('public.resource_booking_conflicts(uuid,timestamptz,timestamptz,uuid,numeric)') is null
     or to_regprocedure('public.pc_can_read_project(uuid)') is null
     or to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null
     or to_regclass('public.reminder_tracking') is null then
    raise exception '4D preflight: نقص الأساس (project_schedule_health/project_execution_health/resource_booking_conflicts/pc_event_emit/reminder_tracking) — شغّل 4B+4C وPhase 3 أولًا.';
  end if;
end $pf$;

begin;

-- ═══ §1) الصلاحيات ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('projects.view_critical_path',       'projects',  'normal', 315, 'عرض المسار الحرج',        'View critical path'),
  ('projects.view_execution_reports',   'projects',  'normal', 320, 'عرض تقارير التنفيذ',      'View execution reports'),
  ('projects.export_execution_reports', 'projects',  'sensitive', 325, 'تصدير تقارير التنفيذ',  'Export execution reports'),
  ('alerts.manage_project_alerts',      'resources', 'normal', 460, 'إدارة تنبيهات التخطيط',   'Manage planning alerts')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) بطاقة الصحّة الموحّدة — تجمع المصادر الثلاثة دون خلطها في درجة واحدة غامضة
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_planning_health(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_exec jsonb; v_sched jsonb; v_res jsonb; v_res_status text; v_exec_status text; v_conflicts int; v_missing int; v_combined text;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin v_exec := public.project_execution_health(p_project); exception when others then v_exec := jsonb_build_object('status','unknown'); end;
  begin v_sched := public.project_schedule_health(p_project); exception when others then v_sched := jsonb_build_object('schedule_status','unknown'); end;

  -- توحيد مفردات صحّة التنفيذ (healthy/at_risk/critical) إلى مفردات on_track/at_risk/off_track
  v_exec_status := case coalesce(v_exec->>'status','')
    when 'healthy' then 'on_track' when 'critical' then 'off_track' when 'at_risk' then 'at_risk'
    when 'on_track' then 'on_track' when 'off_track' then 'off_track' else 'unknown' end;
  v_exec := v_exec || jsonb_build_object('status', v_exec_status);   -- تُقرأ من البطاقة والدمج بنفس المفردات

  -- صحّة الموارد: تعارضات حجز حاجبة + موظفون فوق الطاقة + موارد أساسية ناقصة (مهام بلا مسؤول)
  v_conflicts := 0;
  if to_regprocedure('public.resource_booking_conflicts(uuid,timestamptz,timestamptz,uuid,numeric)') is not null then
    select count(*) into v_conflicts from public.resource_bookings b
      where b.project_id = p_project and b.is_deleted=false and b.status in ('hold','pending_approval','confirmed','in_use')
        and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'));
  end if;
  select count(*) into v_missing from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
      and t.assignee_id is null and not exists (select 1 from public.project_task_assignees a where a.task_id=t.id);
  v_res_status := case when v_conflicts > 0 then 'off_track' when v_missing > 0 then 'at_risk' else 'on_track' end;
  v_res := jsonb_build_object('status', v_res_status, 'booking_conflicts', v_conflicts, 'unassigned_tasks', v_missing,
    'reasons', (select coalesce(jsonb_agg(r),'[]'::jsonb) from (
        select jsonb_build_object('type','booking_conflicts','ar', v_conflicts||' تعارض حجز موارد') r where v_conflicts>0
        union all select jsonb_build_object('type','unassigned','ar', v_missing||' مهمة بلا مسؤول') where v_missing>0) x));

  -- الحالة الإجمالية = أسوأ الحالات الثلاث (مفسّرة، لا جمع درجات؛ بمفردات موحّدة)
  v_combined := case
    when 'off_track' in (v_exec_status, coalesce(v_sched->>'schedule_status',''), v_res_status) then 'off_track'
    when 'at_risk'  in (v_exec_status, coalesce(v_sched->>'schedule_status',''), v_res_status) then 'at_risk'
    else 'on_track' end;

  return jsonb_build_object('project_id', p_project, 'combined_status', v_combined,
    'execution', v_exec, 'schedule', v_sched, 'resource', v_res, 'calculated_at', now());
end $$;
revoke execute on function public.project_planning_health(uuid) from public, anon;
grant  execute on function public.project_planning_health(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) اقتراحات حلّ تعارض حجز — قابلة للتفسير، لا تنفيذ تلقائي
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.resource_conflict_resolutions(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.resource_bookings; v_alts jsonb; v_conf jsonb; v_rtype text; v_prof text;
begin
  select * into b from public.resource_bookings where id = p_booking and is_deleted=false;
  if b.id is null then raise exception 'not_found'; end if;
  -- يُرجِع سِجِلّ الموارد الكامل للنوع + بيانات تعارض عبر المشاريع؛ يتطلب resources.view (مطابقة
  -- resource_conflict_center) — لا يكفي مجرّد قابلية قراءة المشروع (لئلا يراه staff بلا صلاحية الموارد).
  if not public.res_can('resources.view') then raise exception 'not authorized'; end if;

  v_conf := (select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c);
  select resource_type into v_rtype from public.planning_resources where id = b.resource_id;

  -- موارد بديلة من نفس النوع — نحسب التوفّر ثم نرتّب المتاح أولًا قبل LIMIT (كي لا تُسقَط بدائل متاحة)
  select coalesce(jsonb_agg(a order by (a->>'rank')::numeric desc), '[]'::jsonb) into v_alts from (
    select jsonb_build_object(
      'resource', public.res_card(pr.id), 'available', av.ok, 'kind', 'alternative_resource',
      'reason_ar', 'مورد بديل من نفس النوع '||pr.resource_type||(case when av.ok then ' متاح في نفس الموعد' else ' (مشغول)' end),
      'rank', case when av.ok then 100 else 0 end) as a
    from public.planning_resources pr
    cross join lateral (select (select count(*) from public.resource_booking_conflicts(pr.id, b.starts_at, b.ends_at, null, b.quantity) c
                                where c.severity in ('hard_conflict','capacity_conflict')) = 0 as ok) av
    where pr.is_deleted=false and pr.is_active and pr.resource_type = v_rtype and pr.id <> b.resource_id
    order by av.ok desc, pr.display_name
    limit 8
  ) q(a);

  return jsonb_build_object('booking_id', p_booking, 'conflicts', v_conf,
    'resolutions', jsonb_build_object(
      'alternative_resources', v_alts,
      'change_time', jsonb_build_object('kind','reschedule','reason_ar','غيّر موعد الحجز لتفادي التداخل (يُعاد فحص التعارض عند الحفظ)'),
      'override', jsonb_build_object('kind','override','reason_ar','تجاوز التعارض بصلاحية وسبب موثّق (يُسجَّل)','requires','resources.override_conflict'),
      'cancel', jsonb_build_object('kind','cancel','reason_ar','إلغاء هذا الحجز')),
    'note_ar', 'اقتراحات استرشادية — لا تُطبَّق تلقائيًا؛ يؤكّدها المستخدم.', 'calculated_at', now());
end $$;
revoke execute on function public.resource_conflict_resolutions(uuid) from public, anon;
grant  execute on function public.resource_conflict_resolutions(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) مسح تنبيهات الموارد/التخطيط — Idempotent، عبر pc_event_emit + reminder_tracking
--   يُستدعى من Cron الحالي (سياق service بلا auth.uid). العميل لا يُستلِم (فريق kian_ فقط).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.resource_alerts_scan()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare rec record; v_n int := 0; v_key text; v_team uuid[]; v_today date := (now() at time zone 'utc')::date;
begin
  -- بوابة: يسمح لسياق service (auth.uid null) أو لمن يملك إدارة التنبيهات (منع إساءة الاستدعاء)
  if auth.uid() is not null and not (public.can_manage_projects() or public.emp_has_permission('alerts.manage_project_alerts')) then
    raise exception 'not authorized';
  end if;

  -- (أ) تعارض حجز حاجب لحجز نشط مرتبط بمشروع
  for rec in
    select b.id, b.project_id, b.resource_id, b.starts_at, pr.employee_user_id
    from public.resource_bookings b join public.planning_resources pr on pr.id = b.resource_id
    where b.is_deleted=false and b.project_id is not null and b.status in ('hold','pending_approval','confirmed','in_use')
      and b.starts_at::date >= v_today
      and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'))
  loop
    v_key := 'res_conflict:'||rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id),'{}') into v_team from public.project_members pm
      where pm.project_id=rec.project_id and pm.is_deleted=false and pm.role like 'kian_%';
    if rec.employee_user_id is not null then v_team := v_team || rec.employee_user_id; end if;
    perform public.pc_event_emit(rec.project_id, 'resource_conflict', 'resource_booking', rec.id, 'action',
      'تعارض حجز مورد يحتاج معالجة', 'Resource booking conflict', null, null,
      '/client-portal/project-core/'||rec.project_id||'?tab=resources', v_team, v_key||':'||v_today);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'resource_booking', rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '48 hours';
    v_n := v_n + 1;
  end loop;

  -- (ب) حجز قريب خلال 24 ساعة (للموظف المحجوز)
  for rec in
    select b.id, b.project_id, b.starts_at, pr.employee_user_id
    from public.resource_bookings b join public.planning_resources pr on pr.id = b.resource_id
    where b.is_deleted=false and b.status in ('confirmed','in_use') and pr.employee_user_id is not null
      and b.starts_at > now() and b.starts_at <= now() + interval '24 hours'
  loop
    v_key := 'res_booking_soon24:'||rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'resource_booking_soon', 'resource_booking', rec.id, 'info',
      'حجز مورد خلال 24 ساعة', 'Resource booking within 24h', null, null,
      case when rec.project_id is not null then '/client-portal/project-core/'||rec.project_id||'?tab=resources' else null end,
      array[rec.employee_user_id], v_key);
    insert into public.reminder_tracking(reminder_key, user_id, project_id, entity_type, entity_id)
      values (v_key, rec.employee_user_id, rec.project_id, 'resource_booking', rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '24 hours';
    v_n := v_n + 1;
  end loop;

  -- (ج) معدة ستدخل الصيانة قريبًا (خلال 3 أيام) — لفريق المشاريع التي حجزتها
  for rec in
    select distinct b.project_id, m.asset_id, m.sent_at
    from public.custody_inventory_maintenance m
    join public.planning_resources pr on pr.source_type='custody_inventory_assets' and pr.source_id=m.asset_id
    join public.resource_bookings b on b.resource_id=pr.id and b.is_deleted=false and b.project_id is not null
      and b.status in ('hold','pending_approval','confirmed') and b.ends_at >= now()
    where m.status in ('opened','sent') and m.sent_at is not null and m.sent_at > now() and m.sent_at <= now() + interval '3 days'
  loop
    v_key := 'equip_maint_soon:'||rec.asset_id||':'||rec.project_id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id),'{}') into v_team from public.project_members pm
      where pm.project_id=rec.project_id and pm.is_deleted=false and pm.role like 'kian_%';
    perform public.pc_event_emit(rec.project_id, 'equipment_maintenance_soon', 'asset', rec.asset_id, 'action',
      'معدة محجوزة ستدخل الصيانة قريبًا', 'Booked equipment maintenance approaching', null, null,
      '/client-portal/project-core/'||rec.project_id||'?tab=resources', v_team, v_key||':'||v_today);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'asset', rec.asset_id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '72 hours';
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'alerts_emitted', v_n, 'scanned_at', now());
end $$;
revoke execute on function public.resource_alerts_scan() from public, anon;
grant  execute on function public.resource_alerts_scan() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) ملخّص المشاريع الفرعية (Aggregate Gantt) — بلا N+1، معزول ضد parent_project_id المفقود
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_subprojects_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', c.id, 'name', c.project_name, 'status', c.status,
      'start', (select min(start_date) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false),
      'end',   (select max(due_date)   from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false),
      'progress_pct', coalesce((select progress_pct from public.project_core pc where pc.project_id=c.id), 0),
      'milestones', (select count(*) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false and coalesce(t.is_milestone,false)),
      'open_tasks', (select count(*) from public.project_tasks t where t.project_id=c.id and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled'))
    ) order by c.project_name), '[]'::jsonb) into v
    from public.projects c
    where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when undefined_column then v := '[]'::jsonb;   -- هجرة hierarchy غير مطبّقة على prod
  end;
  return jsonb_build_object('project_id', p_project, 'subprojects', coalesce(v,'[]'::jsonb), 'generated_at', now());
end $$;
revoke execute on function public.project_subprojects_summary(uuid) from public, anon;
grant  execute on function public.project_subprojects_summary(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — يُلغي المعاملة عند فشل العقد
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
begin
  -- (أ) الدوال أُنشئت (planning_health مبوّبة بـauth؛ نتحقق من الإنشاء لا الاستدعاء الحيّ)
  if to_regprocedure('public.project_planning_health(uuid)') is null then raise exception '4D FAIL: project_planning_health غير موجودة'; end if;
  if to_regprocedure('public.resource_conflict_resolutions(uuid)') is null then raise exception '4D FAIL: resource_conflict_resolutions غير موجودة'; end if;
  if to_regprocedure('public.resource_alerts_scan()') is null then raise exception '4D FAIL: resource_alerts_scan غير موجودة'; end if;
  if to_regprocedure('public.project_subprojects_summary(uuid)') is null then raise exception '4D FAIL: project_subprojects_summary غير موجودة'; end if;

  -- (ب) لا نستدعي resource_alerts_scan() هنا: فهي VOLATILE وتُطلق إشعارات/بريدًا فعليًا وتَبذر
  --     reminder_tracking (سياق النشر auth.uid=null يتجاوز البوابة). الاختبار قراءة-فقط.

  -- (ج) الصلاحيات الجديدة مُدرجة
  if (select count(*) from public.permissions where key in ('projects.view_critical_path','projects.view_execution_reports','projects.export_execution_reports','alerts.manage_project_alerts')) < 4
    then raise exception '4D FAIL: صلاحيات 4D غير مكتملة'; end if;

  raise notice '4D ✅ نجح الاختبار الذاتي — planning_health/conflict_resolutions/alerts_scan + الصلاحيات.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
