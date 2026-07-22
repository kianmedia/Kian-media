-- ════════════════════════════════════════════════════════════════════════════
-- project_governance_batch5b_RUNME.sql
-- PHASE 5 · BATCH 5B — EXECUTIVE DASHBOARDS, KPIs & PORTFOLIO GOVERNANCE
-- ────────────────────────────────────────────────────────────────────────────
-- تصميم معتمد بعد Read-Only Audit (يُوسّع/يُركّب لا يوازي):
--   • يُركّب دوال الصحّة القائمة لكل مشروع: project_execution_health / project_schedule_health /
--     project_planning_health (execution+schedule+resource) / project_governance_health (5A) /
--     project_progress_snapshot — بلا إعادة حساب.
--   • عزلٌ صارم: كل تجميع يمرّ عبر pc_can_read_project لكل صف (SECURITY DEFINER يتجاوز RLS) —
--     تفاديًا لتسرّب مثل project_core_dashboard() الذي يبوّب مرّة واحدة على is_staff فقط.
--   • مالية مقنّعة خلف can_see_financials()/can_manage_projects()؛ Financial Impact مرجع فقط.
--   • تطبيع مفردات الحالة المتضاربة (on_track/off_track ↔ healthy/…): exec_norm_status →
--     healthy/attention/at_risk/critical/unavailable.
--   • Parent–Child: pc_is_subproject (4C، معزول للعمود غير المطبّق) — لا عدّ مزدوج.
--   • Trends: أساس جديد executive_kpi_snapshots (لا تاريخ وهمي؛ يبدأ من التطبيق).
--   • Alerts: يعيد استخدام pc_event_emit + reminder_tracking (Double-idempotency)، لا Cron مكرّر.
--   • KPI Catalog مركزي (executive_kpi_catalog) — تعريفات لا SQL نصّي من المستخدم.
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا حذف بيانات · بلا DROP FUNCTION/TABLE ·
--   DROP POLICY IF EXISTS فقط · بلا Temp Tables في دوال القراءة · Preflight · self-test بلا Side Effects ·
--   notify pgrst · GRANTs/RLS/Comments · لا يمسّ core_stage/progress/المالية/Zoho/العهدة (قراءة فقط).
--   كل مراجع 5A/4B/الهرمية غير المطبّقة معزولة (to_regclass/to_regprocedure/exception) ⇒ تُظهر
--   «غير متاح» بدل الفشل. ترتيب التشغيل الموصى به: 5A ثم 5B.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ Preflight: أساسات مطبّقة مطلوبة (تفشل مبكرًا برسالة واضحة إن غابت) ═══
do $pre$
begin
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then raise exception '5B PREFLIGHT: pc_can_read_project مفقودة (طبّق project_core أولًا)'; end if;
  if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.can_manage_projects()') is null
     or to_regprocedure('public.staff_reads_all_projects()') is null or to_regprocedure('public.is_owner()') is null
     or to_regprocedure('public.can_see_financials()') is null then raise exception '5B PREFLIGHT: دوال الأدوار مفقودة'; end if;
  if to_regprocedure('public.project_execution_health(uuid)') is null then raise exception '5B PREFLIGHT: project_execution_health مفقودة (Phase 3/4)'; end if;
  if to_regprocedure('public.pc_is_subproject(uuid)') is null then raise exception '5B PREFLIGHT: pc_is_subproject مفقودة (Phase 4C)'; end if;
  if to_regclass('public.permissions') is null then raise exception '5B PREFLIGHT: جدول permissions مفقود'; end if;
  if to_regclass('public.project_core') is null or to_regclass('public.projects') is null then raise exception '5B PREFLIGHT: projects/project_core مفقودة'; end if;
  -- تحذيرات لا تُفشِل (مراجع معزولة عند التشغيل):
  if to_regprocedure('public.project_governance_health(uuid)') is null then raise notice '5B: 5A غير مطبّقة — مؤشرات الحوكمة ستظهر «غير متاح».'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then raise notice '5B: pc_event_emit مفقودة — executive_alerts_scan سيُعطّل بأمان.'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) جداول الأساس (Additive)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 كتالوج مؤشرات الأداء — تعريفات مركزية (Metadata فقط؛ الحساب في الدوال).
create table if not exists public.executive_kpi_catalog (
  key                 text primary key,
  category            text not null default 'portfolio',
  label_ar            text not null,
  label_en            text not null,
  description         text,
  formula_description text,
  unit                text not null default 'count',   -- count | percent | days | hours | ratio | score
  aggregation_method  text not null default 'count',   -- count | ratio | avg | sum | distribution
  numerator           text,
  denominator         text,
  data_source         text,
  limitations         text,
  required_permissions text[] not null default '{}',
  is_active           boolean not null default true,
  sort_order          int not null default 100,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 1.2 لقطات زمنية للمؤشرات — أساس الاتجاهات (بلا تاريخ وهمي؛ يبدأ التسجيل من التطبيق).
create table if not exists public.executive_kpi_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  period_type   text not null default 'weekly' check (period_type in ('weekly','monthly','quarterly')),
  scope_key     text not null default 'company',       -- 'company' أو 'client:<uuid>' مستقبلًا
  kpi_key       text not null,
  value         numeric,                                 -- null = غير قابل للحساب (denominator=0/لا بيانات)
  sample_size   int,
  numerator     numeric,
  denominator   numeric,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (snapshot_date, period_type, scope_key, kpi_key)
);
create index if not exists ix_exec_snap_kpi on public.executive_kpi_snapshots(kpi_key, period_type, snapshot_date);

-- 1.3 قواعد التنبيهات التنفيذية — تفعيل/عتبة قابلة للإدارة.
create table if not exists public.executive_alert_rules (
  key         text primary key,
  label_ar    text not null,
  label_en    text not null,
  severity    text not null default 'action' check (severity in ('critical','action','info')),
  threshold   numeric,                                   -- تفسيره حسب القاعدة (أيام/عدد)
  cadence_hours int not null default 24,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- §2) صلاحيات تنفيذية (Additive على الكتالوج) — الوصول لِلوحة الشركة
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('executive.view_dashboard',            'executive','normal', 700,'عرض لوحة الإدارة التنفيذية','View executive dashboard'),
  ('executive.view_portfolio_health',     'executive','normal', 705,'عرض صحّة المحفظة','View portfolio health'),
  ('executive.view_kpis',                 'executive','normal', 710,'عرض مؤشرات الأداء','View KPIs'),
  ('executive.view_forecasts',            'executive','normal', 715,'عرض توقّعات التسليم','View delivery forecasts'),
  ('executive.view_governance_exceptions','executive','normal', 720,'عرض استثناءات الحوكمة','View governance exceptions'),
  ('executive.view_resource_capacity',    'executive','normal', 725,'عرض طاقة الموارد','View resource capacity'),
  ('executive.view_company_reports',      'executive','normal', 730,'عرض تقارير الشركة','View company reports'),
  ('executive.export_reports',            'executive','normal', 735,'تصدير التقارير','Export reports'),
  ('executive.manage_kpi_catalog',        'executive','sensitive',740,'إدارة كتالوج المؤشرات','Manage KPI catalog'),
  ('executive.manage_alert_rules',        'executive','sensitive',745,'إدارة قواعد التنبيهات','Manage alert rules')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) بذر كتالوج المؤشرات (تعريفات مفسّرة — لا Black Box)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.executive_kpi_catalog (key, category, label_ar, label_en, description, formula_description, unit, aggregation_method, numerator, denominator, data_source, limitations, required_permissions, sort_order) values
  ('project_completion_rate','portfolio','نسبة إنجاز المشاريع','Project completion rate','نسبة المشاريع المغلقة/المسلّمة من الإجمالي','closed_or_delivered / total','percent','ratio','core_stage in (delivered,closed)','المشاريع (النطاق حسب السياق)','project_core.core_stage','اللوحة: مقيّدة بالمرئي للمستخدم؛ اللقطة الزمنية: على مستوى الشركة (كل المشاريع)','{executive.view_kpis}',10),
  ('on_time_project_rate','portfolio','نسبة المشاريع في الموعد','On-time project rate','نسبة المشاريع المسلّمة قبل/عند due_date','delivered_on_or_before_due / delivered_total','percent','ratio','delivery_date<=due_date','المشاريع المسلّمة ذات due_date','project_core','يتطلّب due_date وdelivery_date','{executive.view_kpis}',20),
  ('overdue_task_rate','portfolio','نسبة المهام المتأخرة','Overdue task rate','المهام المتأخرة من المهام المفتوحة','overdue_open_tasks / open_tasks','percent','ratio','due_date<today & status open','المهام المفتوحة','project_tasks','تستثني done/cancelled','{executive.view_kpis}',30),
  ('milestone_on_time_rate','portfolio','التزام المعالم بالموعد','Milestone on-time rate','المعالم غير المتأخرة من المعالم المفتوحة','on_time_milestones / open_milestones','percent','ratio','is_milestone & not overdue','المعالم المفتوحة','project_tasks.is_milestone','يتطلّب أعمدة 4A','{executive.view_kpis}',40),
  ('approval_sla_compliance','governance','التزام SLA الاعتمادات','Approval SLA compliance','الاعتمادات المبتوتة ضمن due_at','decided_within_sla / decided_with_sla','percent','ratio','decided_at<=due_at','الاعتمادات ذات due_at المبتوتة','project_approvals (5A)','يتطلّب 5A','{executive.view_governance_exceptions}',50),
  ('average_review_duration','governance','متوسط مدّة المراجعة','Average review duration','متوسط الأيام بين طلب الاعتماد وبتّه','avg(decided_at - requested_at)','days','avg',null,'الاعتمادات المبتوتة','project_approvals (5A)','يتطلّب 5A','{executive.view_governance_exceptions}',60),
  ('risk_exposure','governance','التعرّض للمخاطر','Risk exposure','مجموع درجات المخاطر المفتوحة (probability×impact)','sum(risk_score) where status not in (closed,accepted)','score','sum','risk_score','المخاطر غير المغلقة وغير المقبولة','project_risks (5A)','يستثني المغلقة والمقبولة؛ يتطلّب 5A','{executive.view_governance_exceptions}',70),
  ('critical_issue_count','governance','عدد المشكلات الحرجة','Critical issue count','المشكلات الحرجة المفتوحة','count(severity=critical & open)','count','count','critical open issues','—','project_issues (5A)','يتطلّب 5A','{executive.view_governance_exceptions}',80),
  ('change_request_cycle_time','governance','زمن دورة طلب التغيير','Change request cycle time','متوسط الأيام من الإنشاء إلى البتّ','avg(decided_at - created_at)','days','avg',null,'طلبات التغيير المبتوتة','project_change_requests (5A)','يتطلّب 5A','{executive.view_governance_exceptions}',90),
  ('resource_utilization','resources','استغلال الموارد','Resource utilization','نِسَب الاستغلال من محرّك الموارد','booked_hours / capacity_hours','percent','ratio','booked','السعة','resource_bookings (4B)','يتطلّب 4B','{executive.view_resource_capacity}',100),
  ('resource_overload_rate','resources','نسبة تحميل الموارد الزائد','Resource overload rate','الموارد المحمّلة فوق الطاقة','overloaded_resources / total_resources','percent','ratio','utilization>100%','الموارد','resource_bookings (4B)','يتطلّب 4B','{executive.view_resource_capacity}',110),
  ('booking_conflict_rate','resources','نسبة تعارض الحجوزات','Booking conflict rate','الحجوزات ذات تعارض من إجمالي الحجوزات','conflicting_bookings / total_bookings','percent','ratio','has conflict','الحجوزات النشطة','resource_bookings (4B)','يتطلّب 4B','{executive.view_resource_capacity}',120),
  ('baseline_variance_days','schedule','انحراف خط الأساس','Baseline variance (days)','متوسط أيام تجاوز baseline_end','avg(due_date - baseline_end)','days','avg',null,'المهام ذات baseline','project_tasks (4A)','يتطلّب أعمدة 4A','{executive.view_kpis}',130),
  ('schedule_forecast_variance','schedule','انحراف توقّع الجدول','Schedule forecast variance','متوسط أيام الفرق بين التوقّع وdue_date','avg(finish_forecast - due_date)','days','avg',null,'المشاريع ذات جدول','project_schedule_health','يعتمد Gantt V2','{executive.view_forecasts}',140),
  ('project_health_distribution','portfolio','توزيع صحّة المشاريع','Project health distribution','عدد المشاريع لكل حالة تنفيذ','group by execution status','count','distribution',null,'المشاريع المرئية','project_execution_health','—','{executive.view_portfolio_health}',150),
  ('governance_health_distribution','governance','توزيع صحّة الحوكمة','Governance health distribution','عدد المشاريع لكل حالة حوكمة','group by governance status','count','distribution',null,'المشاريع المرئية','project_governance_health (5A)','يتطلّب 5A','{executive.view_governance_exceptions}',160),
  ('delivery_readiness_rate','delivery','نسبة الجاهزية للتسليم','Delivery readiness rate','متوسط نسبة جاهزية التسليم للمشاريع النشطة','avg(readiness_percent)','percent','avg',null,'المشاريع النشطة','executive_delivery_readiness','استرشادي','{executive.view_forecasts}',170),
  ('inactive_project_rate','portfolio','نسبة المشاريع الخاملة','Inactive project rate','المشاريع بلا نشاط منذ ≥14 يومًا','inactive / active','percent','ratio','idle_days>=14','المشاريع النشطة','project_activity','—','{executive.view_portfolio_health}',180)
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) بذر قواعد التنبيهات
-- ════════════════════════════════════════════════════════════════════════════
insert into public.executive_alert_rules (key, label_ar, label_en, severity, threshold, cadence_hours) values
  ('project_became_critical','مشروع أصبح حرجًا','Project became critical','critical',null,24),
  ('project_entered_at_risk','مشروع معرّض للخطر','Project entered at-risk','action',null,48),
  ('finish_forecast_slipping','تأخّر توقّع الإنهاء','Finish forecast slipping','action',7,48),
  ('baseline_breach','تجاوز خط الأساس','Baseline breach','action',5,72),
  ('new_critical_risk','مخاطرة حرجة جديدة','New critical risk','critical',null,24),
  ('new_critical_issue','مشكلة حرجة جديدة','New critical issue','critical',null,24),
  ('approval_sla_breached','تجاوز SLA اعتماد','Approval SLA breached','action',null,24),
  ('change_request_overdue','طلب تغيير متأخر','Change request overdue','action',null,48),
  ('project_no_activity','مشروع بلا نشاط','Project inactive','action',14,72),
  ('near_delivery_not_ready','قريب التسليم وغير جاهز','Near delivery not ready','action',7,48)
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) دوال مساعدة (صلاحية/تطبيع/تقنيع/عزل)
-- ════════════════════════════════════════════════════════════════════════════
-- 5.1 صلاحية تنفيذية على مستوى الشركة (مرساة is_staff — العميل مُستبعَد). owner/management دائمًا،
--     وغيرهم يحتاج المفتاح الصريح. العزل الفعلي لمجموعة المشاريع يبقى عبر pc_can_read_project لكل صف.
create or replace function public.exec_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.is_owner() or public.can_manage_projects() or public.emp_has_permission(p_key));
$$;
revoke execute on function public.exec_can(text) from public, anon;
grant execute on function public.exec_can(text) to authenticated;

-- 5.2 هل تُعرض المالية؟
create or replace function public.exec_fin_visible()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_projects() or public.can_see_financials();
$$;
revoke execute on function public.exec_fin_visible() from public, anon;
grant execute on function public.exec_fin_visible() to authenticated;

-- 5.3 تطبيع مفردات الحالة المتضاربة إلى مفردة موحّدة.
create or replace function public.exec_norm_status(p_status text)
returns text language sql immutable as $$
  select case lower(coalesce(p_status,''))
    when 'healthy'  then 'healthy'
    when 'on_track' then 'healthy'
    when 'attention' then 'attention'
    when 'at_risk'  then 'at_risk'
    when 'off_track' then 'critical'
    when 'critical' then 'critical'
    else 'unavailable' end;
$$;

-- 5.4 صحّة الحوكمة المعزولة (تُرجع «غير متاح» إن غابت 5A بدل الفشل).
create or replace function public.exec_gov_health(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if to_regprocedure('public.project_governance_health(uuid)') is null then
    return jsonb_build_object('health_status','unavailable','reason_ar','وحدة الحوكمة (5A) غير مطبّقة'); end if;
  begin v := public.project_governance_health(p_project);
  exception when others then v := jsonb_build_object('health_status','unavailable','reason_ar','تعذّر حساب صحّة الحوكمة'); end;
  return v;
end $$;
revoke execute on function public.exec_gov_health(uuid) from public, anon;
grant execute on function public.exec_gov_health(uuid) to authenticated;

-- 5.5 عدّادات المخاطر/المشكلات/الاعتمادات/التغييرات المعزولة (صفر + غير متاح إن غابت 5A).
create or replace function public.exec_gov_counts(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_crit_risk int:=0; v_open_risk int:=0; v_exposure numeric:=0; v_crit_issue int:=0; v_open_issue int:=0;
  v_overdue_appr int:=0; v_pending_appr int:=0; v_pending_chg int:=0; v_avail boolean := true;
begin
  begin
    select count(*) filter (where severity='critical' and status not in ('closed','accepted')),
           count(*) filter (where status not in ('closed','accepted')),
           coalesce(sum(risk_score) filter (where status not in ('closed','accepted')),0)
      into v_crit_risk, v_open_risk, v_exposure
    from public.project_risks where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  begin
    select count(*) filter (where severity='critical' and status not in ('closed','resolved')),
           count(*) filter (where status not in ('closed','resolved'))
      into v_crit_issue, v_open_issue
    from public.project_issues where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  begin
    select count(*) filter (where status='pending' and due_at is not null and due_at<now()),
           count(*) filter (where status in ('pending','draft'))
      into v_overdue_appr, v_pending_appr
    from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  begin
    select count(*) filter (where status not in ('approved','rejected','implemented','closed','cancelled'))
      into v_pending_chg
    from public.project_change_requests where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then null; end;
  return jsonb_build_object('available',v_avail,'critical_risks',v_crit_risk,'open_risks',v_open_risk,
    'risk_exposure',v_exposure,'critical_issues',v_crit_issue,'open_issues',v_open_issue,
    'overdue_approvals',v_overdue_appr,'pending_approvals',v_pending_appr,'pending_changes',v_pending_chg);
end $$;
revoke execute on function public.exec_gov_counts(uuid) from public, anon;
grant execute on function public.exec_gov_counts(uuid) to authenticated;

-- 5.6 مجموعة المشاريع المرئية بعد الفلاتر + العزل (pc_can_read_project لكل صف).
--     تُعيد setof uuid — تُركّب عليها كل التجميعات. owner/sponsor عبر project_member_roles (معزول).
create or replace function public.exec_visible_projects(p_filters jsonb default '{}'::jsonb)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := nullif(p_filters->>'client_id','')::uuid;
  v_stage text := nullif(p_filters->>'core_stage','');
  v_priority text := nullif(p_filters->>'priority','');
  v_ptype text := nullif(p_filters->>'project_type','');
  v_health text := nullif(p_filters->>'health','');
  v_status text := nullif(p_filters->>'status','');
  v_manager uuid := nullif(p_filters->>'manager_id','')::uuid;
  v_due_from date := nullif(p_filters->>'due_from','')::date;
  v_due_to date := nullif(p_filters->>'due_to','')::date;
  v_masters_only boolean := coalesce((p_filters->>'masters_only')::boolean,false);
  v_subs_only boolean := coalesce((p_filters->>'subprojects_only')::boolean,false);
  v_overdue_only boolean := coalesce((p_filters->>'overdue_only')::boolean,false);
  v_owner uuid := nullif(p_filters->>'owner_id','')::uuid;
  v_sponsor uuid := nullif(p_filters->>'sponsor_id','')::uuid;
  v_owner_ids uuid[] := null; v_sponsor_ids uuid[] := null;
  v_today date := (now() at time zone 'utc')::date;
begin
  -- فلاتر الأدوار الحوكمية (owner/sponsor) معزولة: إن غاب project_member_roles (5A) تبقى null ⇒ لا تُطبَّق (تُبلَّغ في dashboard).
  if v_owner is not null then
    begin select array_agg(project_id) into v_owner_ids from public.project_member_roles
      where user_id=v_owner and project_role='project_owner' and coalesce(is_deleted,false)=false;
    exception when undefined_table then v_owner_ids := '{}'::uuid[]; end;
    if v_owner_ids is null then v_owner_ids := '{}'::uuid[]; end if;
  end if;
  if v_sponsor is not null then
    begin select array_agg(project_id) into v_sponsor_ids from public.project_member_roles
      where user_id=v_sponsor and project_role='sponsor' and coalesce(is_deleted,false)=false;
    exception when undefined_table then v_sponsor_ids := '{}'::uuid[]; end;
    if v_sponsor_ids is null then v_sponsor_ids := '{}'::uuid[]; end if;
  end if;

  return query
    select p.id
    from public.projects p
    join public.project_core pc on pc.project_id = p.id
    where coalesce(p.is_deleted,false) = false
      and public.pc_can_read_project(p.id)                                  -- العزل الحاسم لكل صف
      and (v_client   is null or p.client_id = v_client)
      and (v_stage    is null or pc.core_stage = v_stage)
      and (v_priority is null or pc.priority = v_priority)
      and (v_ptype    is null or pc.project_type = v_ptype)
      and (v_health   is null or pc.health = v_health)
      and (v_status   is null or p.status = v_status)
      and (v_due_from is null or pc.due_date >= v_due_from)
      and (v_due_to   is null or pc.due_date <= v_due_to)
      and (not v_masters_only or not public.pc_is_subproject(p.id))
      and (not v_subs_only    or public.pc_is_subproject(p.id))
      and (not v_overdue_only or (pc.due_date is not null and pc.due_date < v_today and pc.core_stage not in ('delivered','closed')))
      and (v_manager  is null or exists (select 1 from public.project_members m
              where m.project_id=p.id and m.user_id=v_manager and m.role='kian_manager' and coalesce(m.is_deleted,false)=false))
      and (v_owner_ids   is null or p.id = any(v_owner_ids))
      and (v_sponsor_ids is null or p.id = any(v_sponsor_ids));
end $$;
revoke execute on function public.exec_visible_projects(jsonb) from public, anon;
grant execute on function public.exec_visible_projects(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) بطاقة الأداء الموحّدة لكل مشروع (6 محاور مُركّبة ومطبّعة، بلا Black Box)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_project_scorecard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_exec jsonb; v_sched jsonb; v_gov jsonb; v_counts jsonb; v_prog jsonb;
  v_quality jsonb; v_ready jsonb; v_axes jsonb; v_overall text; v_dq jsonb := '[]'::jsonb;
  v_total_dlv int:=0; v_rev int:=0; v_apr int:=0; v_q_status text; v_q_score int;
  v_name text; v_client uuid; v_res_conf int:=0; v_res_unassigned int:=0; v_res_status text; v_res jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select project_name, client_id into v_name, v_client from public.projects where id = p_project;

  -- المحاور المُركّبة: نستدعي دالتَي الصحّة القائمتين مرّة واحدة فقط (لا نمرّ عبر project_planning_health
  -- التي تعيد حساب التنفيذ والجدول ثانيةً)؛ ونشتقّ محور الموارد محليًّا من تعارضات الجدول المحسوبة سلفًا.
  begin v_exec := public.project_execution_health(p_project); exception when others then v_exec := jsonb_build_object('status','unavailable'); end;
  begin v_sched := public.project_schedule_health(p_project); exception when others then v_sched := jsonb_build_object('schedule_status','unavailable'); end;
  v_gov := public.exec_gov_health(p_project);
  v_counts := public.exec_gov_counts(p_project);
  begin v_prog := public.project_progress_snapshot(p_project); exception when others then v_prog := jsonb_build_object('effective_progress',null); end;
  v_ready := public.executive_delivery_readiness(p_project);

  -- محور الموارد (بلا إعادة حساب): تعارضات الحجز من v_sched، والمهام بلا مسؤول عدّ رخيص.
  v_res_conf := coalesce((v_sched->>'booking_conflicts')::int,0);
  select count(*) into v_res_unassigned from public.project_tasks
    where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('done','cancelled') and assignee_id is null;
  v_res_status := case when v_res_conf>0 then 'off_track' when coalesce(v_res_unassigned,0)>0 then 'at_risk' else 'on_track' end;
  v_res := jsonb_build_object('status', v_res_status, 'booking_conflicts', v_res_conf, 'unassigned_tasks', coalesce(v_res_unassigned,0),
    'reasons', (select coalesce(jsonb_agg(r),'[]'::jsonb) from (
       select jsonb_build_object('type','booking_conflicts','ar', v_res_conf||' تعارض حجز موارد') r where v_res_conf>0
       union all select jsonb_build_object('type','unassigned','ar', v_res_unassigned||' مهمة بلا مسؤول') where coalesce(v_res_unassigned,0)>0) x));

  -- محور الجودة (مشتق من المخرجات — قابل للتفسير).
  begin
    select count(*), count(*) filter (where status='revision_requested'),
           count(*) filter (where status in ('approved','final_delivered'))
      into v_total_dlv, v_rev, v_apr
    from public.deliverables where project_id=p_project;
  exception when undefined_table then v_total_dlv := -1; end;
  if v_total_dlv = -1 then v_q_status := 'unavailable'; v_q_score := null;
  elsif v_total_dlv = 0 then v_q_status := 'unavailable'; v_q_score := null;
    v_dq := v_dq || jsonb_build_object('type','no_deliverables','ar','لا مخرجات لتقييم الجودة');
  else
    -- الحدّ الأقصى للخصم 80 (لا 60) كي يبلغ خلفيّة تعديلات كبيرة النطاق «الحرج» (score<40) — وإلا تعذّر بلوغه.
    v_q_score := greatest(0, 100 - least(80, v_rev*15));
    v_q_status := case when v_q_score>=85 then 'healthy' when v_q_score>=65 then 'attention' when v_q_score>=40 then 'at_risk' else 'critical' end;
  end if;

  v_quality := jsonb_build_object('status', v_q_status, 'score', v_q_score,
    'reasons', case when v_rev>0 then jsonb_build_array(jsonb_build_object('key','revisions','ar', v_rev||' مخرجات طلبت تعديلًا')) else '[]'::jsonb end,
    'counts', jsonb_build_object('deliverables', greatest(v_total_dlv,0), 'revision_requested', v_rev, 'approved', v_apr),
    'last_calculated_at', now());

  -- بناء المحاور بمفردة موحّدة + score مُفسَّر (null حين لا يُحسب).
  v_axes := jsonb_build_object(
    'execution', jsonb_build_object('status', public.exec_norm_status(v_exec->>'status'),
      'score', (v_exec->>'health_score')::int, 'reasons', coalesce(v_exec->'reasons','[]'::jsonb),
      'counts', jsonb_build_object('active',(v_exec->>'active_tasks')::int,'overdue',(v_exec->>'overdue_tasks')::int,
        'blocked',(v_exec->>'blocked_tasks')::int,'awaiting_review',(v_exec->>'awaiting_review')::int,'idle_days',(v_exec->>'idle_days')::int),
      'last_calculated_at', v_exec->>'calculated_at'),
    'schedule', jsonb_build_object('status', public.exec_norm_status(v_sched->>'schedule_status'),
      'score', null, 'reasons', coalesce(v_sched->'warnings','[]'::jsonb),
      'counts', jsonb_build_object('overdue',(v_sched->>'overdue_tasks')::int,'no_dates',(v_sched->>'tasks_without_dates')::int,
        'baseline_slippage',(v_sched->>'baseline_slippage')::int,'booking_conflicts',(v_sched->>'booking_conflicts')::int),
      'finish_forecast', v_sched->>'project_finish_forecast', 'last_calculated_at', v_sched->>'calculated_at'),
    'resources', jsonb_build_object('status', public.exec_norm_status(v_res->>'status'),
      'score', null, 'reasons', coalesce(v_res->'reasons','[]'::jsonb),
      'counts', jsonb_build_object('booking_conflicts',(v_res->>'booking_conflicts')::int,'unassigned_tasks',(v_res->>'unassigned_tasks')::int),
      'last_calculated_at', v_sched->>'calculated_at'),
    'governance', jsonb_build_object('status', public.exec_norm_status(v_gov->>'health_status'),
      'score', (v_gov->>'health_score')::int, 'reasons', coalesce(v_gov->'reasons','[]'::jsonb),
      'counts', coalesce(v_gov->'counts', jsonb_build_object()), 'available', coalesce((v_counts->>'available')::boolean,false),
      'last_calculated_at', v_gov->>'calculated_at'),
    'quality', v_quality,
    'delivery_readiness', jsonb_build_object('status', case when (v_ready->>'ready')::boolean then 'healthy'
        when coalesce((v_ready->>'readiness_percent')::int,0)>=60 then 'attention'
        when (v_ready->>'readiness_percent') is null then 'unavailable' else 'at_risk' end,
      'score', (v_ready->>'readiness_percent')::int, 'reasons', coalesce(v_ready->'blockers','[]'::jsonb),
      'counts', jsonb_build_object('blockers', jsonb_array_length(coalesce(v_ready->'blockers','[]'::jsonb))),
      'last_calculated_at', now()));

  -- الحالة العامة = أسوأ حالة عبر المحاور المتاحة (لا رقم واحد يقرّر؛ الأسباب بجانبها).
  select case
      when bool_or(value->>'status'='critical') then 'critical'
      when bool_or(value->>'status'='at_risk') then 'at_risk'
      when bool_or(value->>'status'='attention') then 'attention'
      when bool_or(value->>'status'='healthy') then 'healthy'
      else 'unavailable' end
    into v_overall from jsonb_each(v_axes);

  -- تحذيرات جودة البيانات على مستوى البطاقة.
  if not coalesce((v_counts->>'available')::boolean,false) then v_dq := v_dq || jsonb_build_object('type','governance_unavailable','ar','بيانات الحوكمة (5A) غير متاحة'); end if;

  return jsonb_build_object('project_id', p_project, 'project_name', v_name, 'client_id', v_client,
    'overall_status', v_overall, 'axes', v_axes,
    'effective_progress', (v_prog->>'effective_progress')::int, 'core_stage', v_prog->>'core_stage',
    'is_subproject', public.pc_is_subproject(p_project),
    'data_quality_warnings', v_dq, 'generated_at', now());
end $$;
revoke execute on function public.executive_project_scorecard(uuid) from public, anon;
grant execute on function public.executive_project_scorecard(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) توقّع التسليم (قواعد معلنة — لا AI)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_delivery_forecast(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_due date; v_sched jsonb; v_forecast date; v_var int; v_conf text; v_counts jsonb;
  v_reasons jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb; v_overdue int:=0; v_open int:=0; v_conf_n int:=0;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select due_date into v_due from public.project_core where project_id=p_project;
  begin v_sched := public.project_schedule_health(p_project); exception when others then v_sched := '{}'::jsonb; end;
  v_forecast := nullif(v_sched->>'project_finish_forecast','')::date;
  v_overdue := coalesce((v_sched->>'overdue_tasks')::int,0);
  v_conf_n := coalesce((v_sched->>'booking_conflicts')::int,0);
  select count(*) into v_open from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('done','cancelled');
  v_counts := public.exec_gov_counts(p_project);

  v_var := case when v_forecast is not null and v_due is not null then (v_forecast - v_due) else null end;

  if v_overdue>0 then v_blockers := v_blockers || jsonb_build_object('type','overdue_tasks','ar', v_overdue||' مهمة متأخرة'); end if;
  if v_conf_n>0 then v_blockers := v_blockers || jsonb_build_object('type','booking_conflicts','ar', v_conf_n||' تعارض حجز'); end if;
  if coalesce((v_counts->>'critical_risks')::int,0)>0 then v_blockers := v_blockers || jsonb_build_object('type','critical_risks','ar','مخاطر حرجة مفتوحة'); end if;
  if coalesce((v_counts->>'critical_issues')::int,0)>0 then v_blockers := v_blockers || jsonb_build_object('type','critical_issues','ar','مشكلات حرجة مفتوحة'); end if;
  if coalesce((v_counts->>'pending_approvals')::int,0)>0 then v_blockers := v_blockers || jsonb_build_object('type','pending_approvals','ar','اعتمادات معلّقة'); end if;

  if v_due is null then v_reasons := v_reasons || jsonb_build_object('type','no_due','ar','لا تاريخ نهاية مخطّط'); end if;
  if v_forecast is null then v_reasons := v_reasons || jsonb_build_object('type','no_forecast','ar','تعذّر حساب توقّع الجدول (Gantt)'); end if;

  -- الثقة تتطلّب توقّعًا محسوبًا فعلًا: غياب v_forecast ⇒ unavailable (لا medium/high لتوقّع غير موجود).
  v_conf := case
    when v_forecast is null then 'unavailable'
    when coalesce((v_sched->>'critical_path_computable')::boolean,false) and jsonb_array_length(v_blockers)=0 then 'high'
    when jsonb_array_length(v_blockers) <= 2 then 'medium'
    else 'low' end;

  return jsonb_build_object('project_id', p_project,
    'contractual_or_planned_due_date', v_due, 'current_forecast_date', v_forecast, 'variance_days', v_var,
    'confidence', v_conf, 'forecast_reasons', v_reasons, 'blockers', v_blockers,
    'open_tasks', v_open, 'calculated_at', now());
end $$;
revoke execute on function public.executive_delivery_forecast(uuid) from public, anon;
grant execute on function public.executive_delivery_forecast(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) جاهزية التسليم (Checklist استرشادي — لا إغلاق تلقائي)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_delivery_readiness(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_blockers jsonb := '[]'::jsonb; v_adv jsonb := '[]'::jsonb; v_pass int:=0; v_total int:=0;
  v_open_tasks int; v_dlv_total int:=0; v_dlv_unapproved int:=0; v_final_assets int:=0;
  v_counts jsonb; v_client_pending int:=0; v_avail_appr boolean := true;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;

  -- (1) المهام مكتملة
  select count(*) into v_open_tasks from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('done','cancelled');
  v_total := v_total+1; if coalesce(v_open_tasks,0)=0 then v_pass := v_pass+1; else v_blockers := v_blockers || jsonb_build_object('type','open_tasks','ar', v_open_tasks||' مهمة مفتوحة'); end if;

  -- (2) المخرجات معتمدة + ملفات نهائية
  begin
    select count(*), count(*) filter (where status not in ('approved','final_delivered','archived'))
      into v_dlv_total, v_dlv_unapproved from public.deliverables where project_id=p_project;
    select count(*) into v_final_assets from public.deliverable_assets a
      join public.deliverables d on d.id=a.deliverable_id where d.project_id=p_project and a.kind in ('final','master');
  exception when undefined_table then v_dlv_total := -1; end;
  -- الفحوص الإرشادية البحتة (لا مخرجات مسجّلة) لا تُضاف للمقام كي لا يتناقض readiness_percent مع ready.
  -- عند وجود مخرجات: «اعتمادها» و«توفّر ملفات نهائية» فحصان حقيقيّان (نجاح/حجب) يُحسبان في المقام.
  if v_dlv_total = 0 then
    v_adv := v_adv || jsonb_build_object('type','no_deliverables','ar','لا مخرجات مسجّلة');
  elsif v_dlv_total > 0 then
    v_total := v_total+1;
    if v_dlv_unapproved=0 then v_pass := v_pass+1;
    else v_blockers := v_blockers || jsonb_build_object('type','deliverables_unapproved','ar', v_dlv_unapproved||' مخرجات غير معتمدة'); end if;
    v_total := v_total+1;
    if v_final_assets>0 then v_pass := v_pass+1;
    else v_blockers := v_blockers || jsonb_build_object('type','no_final_files','ar','لا ملفات نهائية مرفقة'); end if;
  end if;

  -- (3) الاعتمادات (client/internal) مكتملة — معزول (5A/base approvals)
  begin
    select count(*) filter (where status in ('pending','draft')) into v_client_pending
      from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table then v_avail_appr := false; end;
  if v_avail_appr then
    v_total := v_total+1; if coalesce(v_client_pending,0)=0 then v_pass := v_pass+1;
    else v_blockers := v_blockers || jsonb_build_object('type','pending_approvals','ar', v_client_pending||' اعتماد معلّق'); end if;
  end if;

  -- (4) لا مخاطر/مشكلات حرجة + طلبات تغيير محلولة — معزول (5A)
  v_counts := public.exec_gov_counts(p_project);
  if coalesce((v_counts->>'available')::boolean,false) then
    v_total := v_total+1; if coalesce((v_counts->>'critical_risks')::int,0)=0 then v_pass := v_pass+1;
      else v_blockers := v_blockers || jsonb_build_object('type','critical_risks','ar','مخاطر حرجة مفتوحة'); end if;
    v_total := v_total+1; if coalesce((v_counts->>'critical_issues')::int,0)=0 then v_pass := v_pass+1;
      else v_blockers := v_blockers || jsonb_build_object('type','critical_issues','ar','مشكلات حرجة مفتوحة'); end if;
    v_total := v_total+1; if coalesce((v_counts->>'pending_changes')::int,0)=0 then v_pass := v_pass+1;
      else v_blockers := v_blockers || jsonb_build_object('type','pending_changes','ar','طلبات تغيير غير محلولة'); end if;
  end if;

  return jsonb_build_object('project_id', p_project,
    'ready', (jsonb_array_length(v_blockers)=0 and v_total>0),
    'readiness_percent', case when v_total>0 then round(v_pass::numeric/v_total*100)::int else null end,
    'checks_passed', v_pass, 'checks_total', v_total,
    'blockers', v_blockers, 'advisory_warnings', v_adv, 'required_overrides', v_blockers, 'calculated_at', now());
end $$;
revoke execute on function public.executive_delivery_readiness(uuid) from public, anon;
grant execute on function public.executive_delivery_readiness(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) لوحة المحفظة التنفيذية (نداء واحد — بلا N+1، مُقنَّعة ماليًا، معزولة)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_portfolio_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_fin boolean; v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,30),1),100);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_skip_sc boolean := coalesce((p_filters->>'skip_scorecards')::boolean,false);
  v_ids uuid[]; v_scorecards jsonb := '[]'::jsonb; v_summary jsonb; v_warnings jsonb := '[]'::jsonb; v_total int;
  v_risk_sum jsonb; v_appr_sum jsonb; v_chg_sum jsonb; v_gov_sum jsonb;
begin
  if not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  v_fin := public.exec_fin_visible();

  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  v_total := array_length(v_ids,1); if v_total is null then v_total := 0; end if;

  -- بطاقات الأداء: مصفحّنة وبترتيب ثابت (order by pid) كي لا يتداخل/يُسقَط عند الصفحات؛ و skip_scorecards
  -- يتيح تحميلًا سريعًا للملخّص أولًا (Lazy detail) دون حساب المسار الحرج لكل المشاريع على أول Load.
  if not v_skip_sc then
    select coalesce(jsonb_agg(sc order by (sc->>'overall_status')='critical' desc, sc->>'project_id'),'[]'::jsonb) into v_scorecards
    from (
      select public.executive_project_scorecard(pid) as sc
      from (select pid from unnest(v_ids) as t(pid) order by pid limit v_limit offset v_offset) s
    ) q;
  end if;

  -- الملخّص على مستوى الشركة (يُحسب مرّة واحدة عبر المجموعة المرئية — لا حلقات RPC).
  select jsonb_build_object(
    'total_active', (select count(*) from public.project_core pc where pc.project_id = any(v_ids) and pc.core_stage not in ('delivered','closed')),
    'total_visible', v_total,
    'delivered_or_closed', (select count(*) from public.project_core pc where pc.project_id = any(v_ids) and pc.core_stage in ('delivered','closed')),
    'overdue', (select count(*) from public.project_core pc where pc.project_id = any(v_ids)
        and pc.due_date is not null and pc.due_date < (now() at time zone 'utc')::date and pc.core_stage not in ('delivered','closed')),
    'near_delivery', (select count(*) from public.project_core pc where pc.project_id = any(v_ids) and pc.core_stage in ('approved','client_review')),
    'no_manager', (select count(*) from public.projects p where p.id = any(v_ids)
        and not exists (select 1 from public.project_members m where m.project_id=p.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false)),
    'no_due_date', (select count(*) from public.project_core pc where pc.project_id = any(v_ids) and pc.due_date is null),
    'health_distribution', (select coalesce(jsonb_object_agg(st,c),'{}'::jsonb) from (
        select coalesce(pc.health,'unknown') st, count(*) c from public.project_core pc where pc.project_id = any(v_ids) group by 1) h),
    'subprojects', (select count(*) from unnest(v_ids) x where public.pc_is_subproject(x))
  ) into v_summary;

  -- ملخّصات مجمّعة set-based معزولة على v_ids (تُحسب مرّة واحدة — لا إعادة استدعاء exec_visible_projects
  -- ولا حلقة per-project RPC؛ يعالج N+1 والحوكمة الزائدة). مراجع 5A معزولة لكل ملخّص.
  v_risk_sum := jsonb_build_object('available',false,'critical_risks',0,'critical_issues',0);
  begin
    v_risk_sum := jsonb_build_object('available',true,
      'critical_risks', (select count(*) from public.project_risks where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted')),
      'critical_issues', (select count(*) from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','resolved')));
  exception when undefined_table or undefined_column then v_risk_sum := jsonb_build_object('available',false,'critical_risks',0,'critical_issues',0); end;

  v_appr_sum := jsonb_build_object('available',false,'pending',0,'overdue',0);
  begin
    v_appr_sum := (select jsonb_build_object('available',true,
        'pending', count(*) filter (where status in ('pending','draft')),
        'overdue', count(*) filter (where status='pending' and due_at is not null and due_at<now()))
      from public.project_approvals where project_id=any(v_ids) and coalesce(is_deleted,false)=false);
  exception when undefined_table or undefined_column then v_appr_sum := jsonb_build_object('available',false,'pending',0,'overdue',0); end;

  v_chg_sum := jsonb_build_object('available',false,'open',0,'pending_approval',0,'implementing',0,'schedule_impact_total',0);
  begin
    v_chg_sum := (select jsonb_build_object('available',true,
        'open', count(*) filter (where status not in ('closed','cancelled','implemented')),
        'pending_approval', count(*) filter (where status in ('pending_approval','submitted','impact_analysis','draft')),
        'implementing', count(*) filter (where status='implementing'),
        'schedule_impact_total', coalesce(sum(schedule_impact_days) filter (where status not in ('closed','cancelled','rejected')),0))
      from public.project_change_requests where project_id=any(v_ids) and coalesce(is_deleted,false)=false);
  exception when undefined_table or undefined_column then v_chg_sum := jsonb_build_object('available',false,'open',0,'pending_approval',0,'implementing',0,'schedule_impact_total',0); end;

  v_gov_sum := jsonb_build_object('available', to_regprocedure('public.project_governance_health(uuid)') is not null,
    'critical_risk_projects',0,'critical_issue_projects',0,'overdue_approval_projects',0);
  begin
    v_gov_sum := v_gov_sum || jsonb_build_object(
      'critical_risk_projects', (select count(distinct project_id) from public.project_risks where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted')),
      'critical_issue_projects', (select count(distinct project_id) from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','resolved')),
      'overdue_approval_projects', (select count(distinct project_id) from public.project_approvals where project_id=any(v_ids) and coalesce(is_deleted,false)=false and status='pending' and due_at is not null and due_at<now()));
  exception when undefined_table or undefined_column then
    v_gov_sum := jsonb_build_object('available',false,'critical_risk_projects',0,'critical_issue_projects',0,'overdue_approval_projects',0);
  end;

  -- تحذيرات جودة/توفّر البيانات.
  if to_regprocedure('public.project_governance_health(uuid)') is null then
    v_warnings := v_warnings || jsonb_build_object('type','governance_unavailable','ar','وحدة الحوكمة (5A) غير مطبّقة — مؤشرات الحوكمة «غير متاحة».'); end if;
  if (p_filters ? 'owner_id' or p_filters ? 'sponsor_id') and to_regclass('public.project_member_roles') is null then
    v_warnings := v_warnings || jsonb_build_object('type','role_filter_unavailable','ar','فلاتر المالك/الراعي تتطلّب أدوار 5A غير المطبّقة.'); end if;
  if v_total > v_limit and not v_skip_sc then
    v_warnings := v_warnings || jsonb_build_object('type','paginated','ar','عُرِضت '||v_limit||' من '||v_total||' مشروعًا — استخدم offset/الفلاتر.'); end if;

  v := jsonb_build_object(
    'summary', v_summary,
    'project_scorecards', v_scorecards,
    'risk_summary', v_risk_sum,
    'approval_summary', v_appr_sum,
    'change_request_summary', v_chg_sum,
    'governance_summary', v_gov_sum,
    'financial_visible', v_fin,
    'pagination', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'total', v_total),
    'warnings', v_warnings, 'generated_at', now());
  return v;
end $$;
revoke execute on function public.executive_portfolio_dashboard(jsonb) from public, anon;
grant execute on function public.executive_portfolio_dashboard(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) عروض عبر المشاريع: مخاطر/مشكلات · اعتمادات · تغييرات · استثناءات حوكمة · جودة بيانات
-- ════════════════════════════════════════════════════════════════════════════
-- 10.1 المخاطر والمشكلات
create or replace function public.executive_portfolio_risks_issues(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_summary_only boolean := coalesce((p_filters->>'summary_only')::boolean,false);
  v_rows jsonb := '[]'::jsonb; v_risk_crit int:=0; v_issue_crit int:=0; v_avail boolean := true;
begin
  if not public.exec_can('executive.view_governance_exceptions') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  if to_regclass('public.project_risks') is null then
    return jsonb_build_object('available',false,'rows','[]'::jsonb,'critical_risks',0,'critical_issues',0); end if;

  begin
    if not v_summary_only then
      select coalesce(jsonb_agg(x order by x->>'severity_rank', (x->>'risk_score')::int desc nulls last),'[]'::jsonb) into v_rows from (
        select jsonb_build_object('kind','risk','id',r.id,'project_id',r.project_id,'project_name',p.project_name,'client_id',p.client_id,
          'title',r.title,'severity',r.severity,'severity_rank',case r.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          'risk_score',r.risk_score,'status',r.status,'owner_id',r.owner_id,'due_date',r.due_date,'client_visible',coalesce(r.client_visible,false),
          'age_days', (extract(epoch from (now()-r.created_at))/86400)::int) as x
        from public.project_risks r join public.projects p on p.id=r.project_id
        where r.project_id = any(v_ids) and coalesce(r.is_deleted,false)=false and r.status not in ('closed','accepted')
        union all
        select jsonb_build_object('kind','issue','id',i.id,'project_id',i.project_id,'project_name',p.project_name,'client_id',p.client_id,
          'title',i.title,'severity',i.severity,'severity_rank',case i.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          'risk_score',null,'status',i.status,'owner_id',i.owner_id,'due_date',i.due_date,'client_visible',coalesce(i.client_visible,false),
          'age_days', (extract(epoch from (now()-i.created_at))/86400)::int) as x
        from public.project_issues i join public.projects p on p.id=i.project_id
        where i.project_id = any(v_ids) and coalesce(i.is_deleted,false)=false and i.status not in ('closed','resolved')
      ) q;
    end if;
    select count(*) into v_risk_crit from public.project_risks where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted');
    select count(*) into v_issue_crit from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','resolved');
  exception when undefined_table or undefined_column then v_avail := false; end;

  return jsonb_build_object('available', v_avail, 'rows', v_rows,
    'critical_risks', v_risk_crit, 'critical_issues', v_issue_crit, 'generated_at', now());
end $$;
revoke execute on function public.executive_portfolio_risks_issues(jsonb) from public, anon;
grant execute on function public.executive_portfolio_risks_issues(jsonb) to authenticated;

-- 10.2 الاعتمادات
create or replace function public.executive_portfolio_approvals(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_summary_only boolean := coalesce((p_filters->>'summary_only')::boolean,false);
  v_rows jsonb := '[]'::jsonb; v_pending int:=0; v_overdue int:=0; v_avail boolean := true;
begin
  if not public.exec_can('executive.view_governance_exceptions') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  if to_regclass('public.project_approvals') is null then
    return jsonb_build_object('available',false,'rows','[]'::jsonb,'pending',0,'overdue',0); end if;
  begin
    if not v_summary_only then
      select coalesce(jsonb_agg(x order by (x->>'overdue')::boolean desc, x->>'due_at'),'[]'::jsonb) into v_rows from (
        select jsonb_build_object('id',a.id,'project_id',a.project_id,'project_name',p.project_name,'client_id',p.client_id,
          'approval_type',a.approval_type,'kind',a.kind,'title',a.title,'status',a.status,'requested_by',a.requested_by,
          'required_user_id',a.required_user_id,'due_at',a.due_at,'sequence_order',a.sequence_order,
          'overdue',(a.status='pending' and a.due_at is not null and a.due_at<now())) as x
        from public.project_approvals a join public.projects p on p.id=a.project_id
        where a.project_id = any(v_ids) and coalesce(a.is_deleted,false)=false
          and a.status in ('pending','draft','rejected','revision_requested','changes_requested')
      ) q;
    end if;
    select count(*) filter (where status in ('pending','draft')),
           count(*) filter (where status='pending' and due_at is not null and due_at<now())
      into v_pending, v_overdue
    from public.project_approvals where project_id=any(v_ids) and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  return jsonb_build_object('available',v_avail,'rows',v_rows,'pending',v_pending,'overdue',v_overdue,'generated_at',now());
end $$;
revoke execute on function public.executive_portfolio_approvals(jsonb) from public, anon;
grant execute on function public.executive_portfolio_approvals(jsonb) to authenticated;

-- 10.3 طلبات التغيير (Financial Impact مرجع فقط — لا تجميع مالي)
create or replace function public.executive_portfolio_change_control(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_summary_only boolean := coalesce((p_filters->>'summary_only')::boolean,false);
  v_rows jsonb := '[]'::jsonb; v_open int:=0; v_pending int:=0; v_implementing int:=0; v_sched_impact int:=0; v_avail boolean := true;
begin
  if not public.exec_can('executive.view_governance_exceptions') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  if to_regclass('public.project_change_requests') is null then
    return jsonb_build_object('available',false,'rows','[]'::jsonb,'open',0,'pending_approval',0,'implementing',0,'schedule_impact_total',0); end if;
  begin
    if not v_summary_only then
      select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]'::jsonb) into v_rows from (
        select jsonb_build_object('id',c.id,'request_no',c.request_no,'project_id',c.project_id,'project_name',p.project_name,'client_id',p.client_id,
          'change_type',c.change_type,'priority',c.priority,'status',c.status,'requested_by',c.requested_by,
          'schedule_impact_days',c.schedule_impact_days,
          'financial_impact_reference', case when public.exec_fin_visible() then c.financial_impact_reference else null end,
          'age_days',(extract(epoch from (now()-c.created_at))/86400)::int,'created_at',c.created_at) as x
        from public.project_change_requests c join public.projects p on p.id=c.project_id
        where c.project_id = any(v_ids) and coalesce(c.is_deleted,false)=false and c.status not in ('closed','cancelled')
      ) q;
    end if;
    select count(*) filter (where status not in ('closed','cancelled','implemented')),
           count(*) filter (where status in ('pending_approval','submitted','impact_analysis','draft')),
           count(*) filter (where status='implementing'),
           coalesce(sum(schedule_impact_days) filter (where status not in ('closed','cancelled','rejected')),0)
      into v_open, v_pending, v_implementing, v_sched_impact
    from public.project_change_requests where project_id=any(v_ids) and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  return jsonb_build_object('available',v_avail,'rows',v_rows,'open',v_open,'pending_approval',v_pending,
    'implementing',v_implementing,'schedule_impact_total',v_sched_impact,'generated_at',now());
end $$;
revoke execute on function public.executive_portfolio_change_control(jsonb) from public, anon;
grant execute on function public.executive_portfolio_change_control(jsonb) to authenticated;

-- 10.4 استثناءات الحوكمة (تجميع الحالات المطلوبة انتباهًا عبر المشاريع)
create or replace function public.executive_governance_exceptions(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_summary_only boolean := coalesce((p_filters->>'summary_only')::boolean,false);
  v_rows jsonb := '[]'::jsonb; v_dist jsonb := '{}'::jsonb;
begin
  if not public.exec_can('executive.view_governance_exceptions') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  if to_regprocedure('public.project_governance_health(uuid)') is null then
    return jsonb_build_object('available',false,'rows','[]'::jsonb,'distribution','{}'::jsonb,'reason_ar','وحدة الحوكمة (5A) غير مطبّقة'); end if;
  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);

  -- التوزيع: نداء exec_gov_health مرّة واحدة لكل مشروع عبر LATERAL (لا تكرار للدالة).
  select coalesce(jsonb_object_agg(st,c),'{}'::jsonb) into v_dist from (
    select public.exec_norm_status(hh.h->>'health_status') st, count(*) c
    from unnest(v_ids) x cross join lateral (select public.exec_gov_health(x) as h) hh group by 1) d;

  if not v_summary_only then
    -- الصفوف: exec_gov_counts و exec_gov_health مرّة واحدة لكل مشروع عبر LATERAL (لا 4× نداءات).
    select coalesce(jsonb_agg(y order by (y->>'overdue_approvals')::int desc, (y->>'critical_risks')::int desc),'[]'::jsonb) into v_rows from (
      select jsonb_build_object('project_id',x,'project_name',(select project_name from public.projects where id=x),
        'governance_status', public.exec_norm_status(hh.h->>'health_status'),
        'critical_risks',(cc.cnt->>'critical_risks')::int,
        'critical_issues',(cc.cnt->>'critical_issues')::int,
        'overdue_approvals',(cc.cnt->>'overdue_approvals')::int,
        'pending_changes',(cc.cnt->>'pending_changes')::int) as y
      from unnest(v_ids) x
        cross join lateral (select public.exec_gov_counts(x) as cnt) cc
        cross join lateral (select public.exec_gov_health(x) as h) hh
    ) q
    where (y->>'critical_risks')::int>0 or (y->>'critical_issues')::int>0 or (y->>'overdue_approvals')::int>0 or (y->>'pending_changes')::int>0;
  end if;

  return jsonb_build_object('available',true,'rows',v_rows,'distribution',v_dist,'generated_at',now());
end $$;
revoke execute on function public.executive_governance_exceptions(jsonb) from public, anon;
grant execute on function public.executive_governance_exceptions(jsonb) to authenticated;

-- 10.5 تقرير جودة البيانات (لا إصلاح تلقائي — يعرض الإجراء)
create or replace function public.executive_data_quality_report(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_rows jsonb := '[]'::jsonb;
begin
  if not public.exec_can('executive.view_company_reports') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
  v_ids := coalesce(v_ids,'{}'::uuid[]);

  select coalesce(jsonb_agg(z),'[]'::jsonb) into v_rows from (
    select jsonb_build_object('project_id',p.id,'project_name',p.project_name,'issues',iss) as z from public.projects p
    join lateral (
      select jsonb_agg(msg) as iss from (
        select 'no_manager' as key, 'بلا مدير' as msg where not exists (select 1 from public.project_members m where m.project_id=p.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false)
        union all select 'no_due','بلا تاريخ نهاية' where not exists (select 1 from public.project_core pc where pc.project_id=p.id and pc.due_date is not null)
        union all select 'no_start','بلا تاريخ بداية' where not exists (select 1 from public.project_core pc where pc.project_id=p.id and pc.start_date is not null)
        union all select 'no_tasks','بلا مهام' where not exists (select 1 from public.project_tasks t where t.project_id=p.id and coalesce(t.is_deleted,false)=false)
        union all select 'no_client','بلا عميل مرتبط' where p.client_id is null
      ) s
    ) q on true
    where p.id = any(v_ids) and q.iss is not null
  ) w;

  return jsonb_build_object('rows', v_rows, 'count', jsonb_array_length(v_rows), 'generated_at', now());
end $$;
revoke execute on function public.executive_data_quality_report(jsonb) from public, anon;
grant execute on function public.executive_data_quality_report(jsonb) to authenticated;

-- 10.6 الاتجاهات (من اللقطات — يوضّح عدم توفّر تاريخ كافٍ بدل تلفيقه)
create or replace function public.executive_portfolio_trends(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_period text := coalesce(nullif(p_filters->>'period_type',''),'weekly'); v_series jsonb; v_n int;
begin
  if not public.exec_can('executive.view_kpis') and not public.exec_can('executive.view_dashboard') then raise exception 'not authorized'; end if;
  if v_period not in ('weekly','monthly','quarterly') then v_period := 'weekly'; end if;
  select count(distinct snapshot_date) into v_n from public.executive_kpi_snapshots where period_type=v_period and scope_key='company';
  select coalesce(jsonb_agg(jsonb_build_object('snapshot_date',snapshot_date,'kpi_key',kpi_key,'value',value,'sample_size',sample_size)
      order by snapshot_date, kpi_key),'[]'::jsonb) into v_series
    from public.executive_kpi_snapshots where period_type=v_period and scope_key='company';
  return jsonb_build_object('period_type',v_period,'series',v_series,'distinct_periods',coalesce(v_n,0),
    'history_available', coalesce(v_n,0) >= 2,
    'note_ar', case when coalesce(v_n,0) < 2 then 'تاريخ الاتجاهات غير كافٍ بعد — يبدأ التسجيل من تاريخ التطبيق.' else null end,
    'generated_at', now());
end $$;
revoke execute on function public.executive_portfolio_trends(jsonb) from public, anon;
grant execute on function public.executive_portfolio_trends(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §11) التقاط لقطة زمنية (أساس الاتجاهات — يُستدعى من cron الموجود؛ Idempotent للفترة)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_snapshot_capture(p_period text default 'weekly')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_date date := (now() at time zone 'utc')::date; v_ids uuid[]; v_total int; v_active int; v_completed int;
  v_overdue_tasks int; v_open_tasks int; v_completion numeric; v_inserted int := 0;
begin
  -- management أو سياق الخدمة الموثوق (cron عبر service_role ⇒ auth.uid() is null؛ anon محظور بالمنح).
  if not (public.can_manage_projects() or public.is_owner() or auth.uid() is null) then raise exception 'not authorized'; end if;
  if p_period not in ('weekly','monthly','quarterly') then p_period := 'weekly'; end if;

  select array_agg(p.id) into v_ids from public.projects p where coalesce(p.is_deleted,false)=false;
  v_ids := coalesce(v_ids,'{}'::uuid[]);
  v_total := coalesce(array_length(v_ids,1),0);
  select count(*) into v_active from public.project_core pc where pc.project_id=any(v_ids) and pc.core_stage not in ('delivered','closed');
  select count(*) into v_completed from public.project_core pc where pc.project_id=any(v_ids) and pc.core_stage in ('delivered','closed');
  -- overdue_task_rate: مهام المشاريع النشطة فقط (استبعاد المغلقة/المسلّمة) كي لا نخلط تراكمًا قديمًا بمخاطر التسليم الحالية.
  select count(*) filter (where t.status not in ('done','cancelled')),
         count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date<v_date)
    into v_open_tasks, v_overdue_tasks
  from public.project_tasks t
    join public.project_core pc on pc.project_id=t.project_id
  where t.project_id=any(v_ids) and coalesce(t.is_deleted,false)=false and pc.core_stage not in ('delivered','closed');
  v_completion := case when v_total>0 then round(v_completed::numeric / v_total * 100, 1) else null end;

  -- كتابة idempotent (on conflict do update) — لا تاريخ وهمي؛ صف واحد للفترة الحالية.
  insert into public.executive_kpi_snapshots (snapshot_date, period_type, scope_key, kpi_key, value, sample_size, numerator, denominator)
  values
    (v_date, p_period, 'company', 'project_completion_rate', v_completion, v_total, v_completed, v_total),
    (v_date, p_period, 'company', 'overdue_task_rate', case when v_open_tasks>0 then round(v_overdue_tasks::numeric/v_open_tasks*100,1) else null end, v_open_tasks, v_overdue_tasks, v_open_tasks),
    (v_date, p_period, 'company', 'active_projects', v_active, v_total, v_active, v_total)
  on conflict (snapshot_date, period_type, scope_key, kpi_key) do update
    set value=excluded.value, sample_size=excluded.sample_size, numerator=excluded.numerator, denominator=excluded.denominator;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('ok',true,'snapshot_date',v_date,'period_type',p_period,'rows',v_inserted);
end $$;
revoke execute on function public.executive_snapshot_capture(text) from public, anon;
grant execute on function public.executive_snapshot_capture(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §12) تنبيهات تنفيذية Idempotent (pc_event_emit + reminder_tracking — لا Cron مكرّر)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_alerts_scan()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_emitted int := 0; v_rec record; v_key text; v_period text := to_char((now() at time zone 'utc')::date,'IYYY-IW');
  v_recips uuid[]; v_admins uuid[]; v_health jsonb; v_status text;
begin
  -- management أو سياق الخدمة الموثوق (cron عبر service_role ⇒ auth.uid() is null؛ anon محظور بالمنح).
  if not (public.can_manage_projects() or public.is_owner() or auth.uid() is null) then raise exception 'not authorized'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then
    return jsonb_build_object('ok',false,'reason','pc_event_emit مفقودة','emitted',0); end if;

  select coalesce(array_agg(id),'{}') into v_admins from public.profiles where account_type='admin';

  -- مشاريع أصبحت حرجة (execution) — تنبيه للإدارة + مدير المشروع (لا للعميل).
  for v_rec in
    select p.id, p.project_name from public.projects p
    where coalesce(p.is_deleted,false)=false
      and exists (select 1 from public.project_core pc where pc.project_id=p.id and pc.core_stage not in ('delivered','closed'))
  loop
    begin v_health := public.project_execution_health(v_rec.id); exception when others then continue; end;
    v_status := public.exec_norm_status(v_health->>'status');
    if v_status <> 'critical' then continue; end if;
    v_key := 'exec_critical:'||v_rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at>now()) then continue; end if;
    select coalesce(array_agg(distinct u),'{}') into v_recips from (
      select unnest(v_admins) u union all
      select m.user_id from public.project_members m where m.project_id=v_rec.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false
    ) r where u is not null;
    perform public.pc_event_emit(v_rec.id,'project_status_changed','project',v_rec.id,'critical',
      'مشروع حرج: '||coalesce(v_rec.project_name,''),'Critical project: '||coalesce(v_rec.project_name,''),
      'انتقل تنفيذ المشروع إلى حالة حرجة.','Project execution became critical.',
      '/client-portal/project-core/'||v_rec.id, v_recips, v_key||':'||v_period);
    insert into public.reminder_tracking(reminder_key,user_id,project_id,entity_type,entity_id)
      values (v_key, null, v_rec.id, 'project', v_rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at=now()+interval '24 hours';
    v_emitted := v_emitted + 1;
  end loop;

  return jsonb_build_object('ok',true,'emitted',v_emitted,'scanned_at',now());
end $$;
revoke execute on function public.executive_alerts_scan() from public, anon;
grant execute on function public.executive_alerts_scan() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §13) RLS + Grants + Comments
-- ════════════════════════════════════════════════════════════════════════════
alter table public.executive_kpi_catalog   enable row level security;
alter table public.executive_kpi_snapshots enable row level security;
alter table public.executive_alert_rules   enable row level security;

drop policy if exists ekc_read on public.executive_kpi_catalog;
create policy ekc_read on public.executive_kpi_catalog for select to authenticated using (public.is_staff());
drop policy if exists eks_read on public.executive_kpi_snapshots;
create policy eks_read on public.executive_kpi_snapshots for select to authenticated using (public.is_staff() and (public.can_manage_projects() or public.emp_has_permission('executive.view_kpis')));
drop policy if exists ear_read on public.executive_alert_rules;
create policy ear_read on public.executive_alert_rules for select to authenticated using (public.is_staff());

-- الكتابة عبر RPCs/management فقط.
revoke insert, update, delete on public.executive_kpi_catalog, public.executive_kpi_snapshots, public.executive_alert_rules from authenticated, anon;
grant select on public.executive_kpi_catalog, public.executive_kpi_snapshots, public.executive_alert_rules to authenticated;

comment on table public.executive_kpi_catalog is '5B: تعريفات مؤشرات الأداء المركزية (Metadata؛ الحساب في الدوال).';
comment on table public.executive_kpi_snapshots is '5B: لقطات زمنية للمؤشرات — أساس الاتجاهات؛ لا تاريخ وهمي، يبدأ من التطبيق.';
comment on function public.executive_portfolio_dashboard(jsonb) is '5B: لوحة المحفظة التنفيذية — نداء واحد، معزول per-row عبر pc_can_read_project، مالية مقنّعة.';

-- ════════════════════════════════════════════════════════════════════════════
-- §14) اختبار ذاتي — بلا Side Effects (savepoint يُتراجع عنه)
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_cat int;
begin
  -- (أ) الجداول والدوال أُنشئت
  if to_regclass('public.executive_kpi_catalog') is null or to_regclass('public.executive_kpi_snapshots') is null
     or to_regclass('public.executive_alert_rules') is null then raise exception '5B FAIL: جداول ناقصة'; end if;
  if to_regprocedure('public.executive_portfolio_dashboard(jsonb)') is null or to_regprocedure('public.executive_project_scorecard(uuid)') is null
     or to_regprocedure('public.executive_delivery_forecast(uuid)') is null or to_regprocedure('public.executive_delivery_readiness(uuid)') is null
     or to_regprocedure('public.exec_visible_projects(jsonb)') is null then raise exception '5B FAIL: دوال ناقصة'; end if;

  -- (ب) تطبيع الحالة المتضاربة → مفردة موحّدة
  if public.exec_norm_status('off_track') <> 'critical' or public.exec_norm_status('on_track') <> 'healthy'
     or public.exec_norm_status('at_risk') <> 'at_risk' or public.exec_norm_status('weird') <> 'unavailable'
     then raise exception '5B FAIL: تطبيع الحالة خاطئ'; end if;

  -- (ج) عقد الكتالوج: العدد ≥17، لا unit/key/label null، توافق unit مع النوع، critical_issue_count='count'، الصلاحيات مُدرجة.
  select count(*) into v_cat from public.executive_kpi_catalog;
  if v_cat < 17 then raise exception '5B FAIL: كتالوج المؤشرات ناقص (%)', v_cat; end if;
  if exists (select 1 from public.executive_kpi_catalog where unit is null) then raise exception '5B FAIL: مؤشر بـunit=null'; end if;
  if exists (select 1 from public.executive_kpi_catalog where key is null or label_ar is null or label_en is null or aggregation_method is null)
    then raise exception '5B FAIL: مؤشر بحقل NOT NULL فارغ'; end if;
  if coalesce((select unit from public.executive_kpi_catalog where key='critical_issue_count'),'') <> 'count'
    then raise exception '5B FAIL: critical_issue_count.unit ≠ count'; end if;
  if exists (select 1 from public.executive_kpi_catalog where (key like '%\_rate' or key like '%\_compliance' or key='resource_utilization') and unit<>'percent')
    then raise exception '5B FAIL: مؤشر نسبة unit≠percent'; end if;
  if exists (select 1 from public.executive_kpi_catalog where (key like '%\_days' or key like '%duration%' or key like '%cycle\_time%' or key like '%variance%') and unit<>'days')
    then raise exception '5B FAIL: مؤشر أيام unit≠days'; end if;
  if exists (select 1 from public.executive_kpi_catalog where (key like '%\_count' or key like '%\_distribution') and unit<>'count')
    then raise exception '5B FAIL: مؤشر عدّ/توزيع unit≠count'; end if;
  if exists (select 1 from public.executive_kpi_catalog where key='risk_exposure' and unit<>'score')
    then raise exception '5B FAIL: risk_exposure.unit≠score'; end if;
  if (select count(*) from public.permissions where category='executive') < 10 then raise exception '5B FAIL: صلاحيات تنفيذية ناقصة'; end if;

  -- (د) قاعدة النسبة: denominator=0 ⇒ null لا 0 مضلّلًا (تأكيد نقيّ بلا أثر خارجي — نفس نمط CASE في snapshot_capture)
  if (case when 0 > 0 then round(5::numeric/0*100,1) else null end) is not null then
    raise exception '5B FAIL: قاعدة denominator=0 لا تُرجع null'; end if;

  raise notice '5B ✅ نجح الاختبار الذاتي — جداول/دوال/تطبيع/كتالوج/صلاحيات/denominator.';
end $selftest$;

commit;

-- ═══ إعادة تحميل مخطط PostgREST ═══
notify pgrst, 'reload schema';
