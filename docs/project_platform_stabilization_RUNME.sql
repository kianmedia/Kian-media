-- ============================================================================
-- PROJECT PLATFORM -- Additive Stabilization Repair (RUN AFTER 8D)
--
-- ملف واحد اضافي يشغل بعد كل دفعات الطور 3->8D. لا يحذف بيانات ولا يسقط جدولا/
-- دالة؛ يعيد تعريف اربع دوال قائمة (CREATE OR REPLACE بنفس التوقيع ونوع الارجاع)
-- لاغلاق عيوب كشفها تدقيق التثبيت عبر الدفعات:
--   (1) [امني -- عزل عميل] exec_gov_counts (5B) كانت SECURITY DEFINER ممنوحة
--       ل authenticated بلا اي بوابة، فيقرا اي حساب (عميل او طاقم بلا وصول) عدادات
--       مخاطر/مشكلات/اعتمادات/تغييرات اي مشروع بالـUUID. اضيفت بوابة is_staff() +
--       pc_can_read_project (نفس حارس شقيقتها project_governance_health في 5A).
--   (2) [صحة بيانات] فلاتر 5B للمشكلات كانت تسقط 'rejected' فتعد مشكلة مرفوضة
--       مفتوحة بينما 7B/8A/5A تستبعدها. صححت الى قانون 5A:
--       open issues = status not in ('resolved','closed','rejected').
--   (3) [صحة بيانات] exec_gov_counts.pending_changes كانت كل ما ليس نهائيا. صححت
--       الى قانون 5A: status in ('submitted','impact_analysis','pending_approval').
--   (4) [تزامن] pc_governance_approval_request (5A) كانت exists()-ثم-insert بلا قفل
--       ولا فهرس فريد، فطلبان متزامنان ينشئان اعتمادين معلقين مكررين. اضيف قفل صف
--       الاب (نفس نمط 8B/6A).
--
-- الدوال تستخرج حرفيا من ملفي 5A/5B مع تعديل موجه فقط (بلا نقل يدوي).
-- Additive . Idempotent . Transaction . لا حذف . لا DROP . بلا Temp . لا اعادة
-- تعريف بوابات الوصول الاساسية . لا مالية/Zoho/عهدة/progress/core_stage.
-- ============================================================================

do $pre$
begin
  if to_regprocedure('public.exec_gov_counts(uuid)') is null
    then raise exception '8-STAB PREFLIGHT: 5B missing (exec_gov_counts)'; end if;
  if to_regprocedure('public.executive_portfolio_dashboard(jsonb)') is null
    then raise exception '8-STAB PREFLIGHT: executive_portfolio_dashboard missing'; end if;
  if to_regprocedure('public.executive_portfolio_risks_issues(jsonb)') is null
    then raise exception '8-STAB PREFLIGHT: executive_portfolio_risks_issues missing'; end if;
  if to_regprocedure('public.pc_governance_approval_request(uuid,jsonb)') is null
    then raise exception '8-STAB PREFLIGHT: 5A missing (pc_governance_approval_request)'; end if;
  if to_regprocedure('public.project_governance_dashboard(uuid)') is null
    then raise exception '8-STAB PREFLIGHT: 5A missing (project_governance_dashboard)'; end if;
  if to_regprocedure('public.project_closure_readiness(uuid)') is null
    then raise exception '8-STAB PREFLIGHT: 5C missing (project_closure_readiness)'; end if;
  if to_regprocedure('public.is_staff()') is null or to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '8-STAB PREFLIGHT: base isolation gates missing'; end if;
end $pre$;

begin;

-- (1)+(2)+(3) exec_gov_counts: isolation gate + canonical issue/change vocab
create or replace function public.exec_gov_counts(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_crit_risk int:=0; v_open_risk int:=0; v_exposure numeric:=0; v_crit_issue int:=0; v_open_issue int:=0;
  v_overdue_appr int:=0; v_pending_appr int:=0; v_pending_chg int:=0; v_avail boolean := true;
begin
  -- 8-STAB: بوّابة عزل مفقودة في 5B — كانت SECURITY DEFINER ممنوحة لـauthenticated
  -- بلا أيّ فحص، فيقرأ أيّ حساب (بما فيه العميل) عدّادات حوكمة أيّ مشروع بالـUUID.
  if not (public.is_staff() and public.pc_can_read_project(p_project)) then raise exception 'not authorized'; end if;
  begin
    select count(*) filter (where severity='critical' and status not in ('closed','accepted')),
           count(*) filter (where status not in ('closed','accepted')),
           coalesce(sum(risk_score) filter (where status not in ('closed','accepted')),0)
      into v_crit_risk, v_open_risk, v_exposure
    from public.project_risks where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_avail := false; end;
  begin
    select count(*) filter (where severity='critical' and status not in ('resolved','closed','rejected')),
           count(*) filter (where status not in ('resolved','closed','rejected'))
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
    select count(*) filter (where status in ('submitted','impact_analysis','pending_approval'))
      into v_pending_chg
    from public.project_change_requests where project_id=p_project and coalesce(is_deleted,false)=false;
  exception when undefined_table or undefined_column then null; end;
  return jsonb_build_object('available',v_avail,'critical_risks',v_crit_risk,'open_risks',v_open_risk,
    'risk_exposure',v_exposure,'critical_issues',v_crit_issue,'open_issues',v_open_issue,
    'overdue_approvals',v_overdue_appr,'pending_approvals',v_pending_appr,'pending_changes',v_pending_chg);
end $$;
revoke execute on function public.exec_gov_counts(uuid) from public, anon;
grant execute on function public.exec_gov_counts(uuid) to authenticated;

-- (2) executive_portfolio_dashboard: exclude 'rejected' from open issues
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
      'critical_issues', (select count(*) from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('resolved','closed','rejected')));
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
      'critical_issue_projects', (select count(distinct project_id) from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('resolved','closed','rejected')),
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

-- (2) executive_portfolio_risks_issues: exclude 'rejected' from open issues
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
        where i.project_id = any(v_ids) and coalesce(i.is_deleted,false)=false and i.status not in ('resolved','closed','rejected')
      ) q;
    end if;
    select count(*) into v_risk_crit from public.project_risks where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted');
    select count(*) into v_issue_crit from public.project_issues where project_id=any(v_ids) and coalesce(is_deleted,false)=false and severity='critical' and status not in ('resolved','closed','rejected');
  exception when undefined_table or undefined_column then v_avail := false; end;

  return jsonb_build_object('available', v_avail, 'rows', v_rows,
    'critical_risks', v_risk_crit, 'critical_issues', v_issue_crit, 'generated_at', now());
end $$;
revoke execute on function public.executive_portfolio_risks_issues(jsonb) from public, anon;
grant execute on function public.executive_portfolio_risks_issues(jsonb) to authenticated;

-- (4) pc_governance_approval_request: parent-row lock vs duplicate pending (TOCTOU)
create or replace function public.pc_governance_approval_request(p_project uuid, p_data jsonb)
returns public.project_approvals language plpgsql security definer set search_path = public as $$
declare r public.project_approvals; v_type text; v_entity text; v_eid uuid;
begin
  if not public.gov_can(p_project, 'approvals.request') then raise exception 'not authorized'; end if;
  -- 8-STAB: قفل صفّ الأب يسلسل الطلبات المتزامنة فيمنع Duplicate Pending (TOCTOU)
  -- الذي كان يمرّ بين exists() والإدراج (لا فهرس فريد يحرسه، خلافًا لـ5C).
  perform 1 from public.projects where id = p_project for update;
  v_type := coalesce(nullif(p_data->>'approval_type',''), 'internal_review');
  v_entity := nullif(p_data->>'entity_type',''); v_eid := nullif(p_data->>'entity_id','')::uuid;
  -- منع Duplicate Pending لنفس (type,entity)
  if exists (select 1 from public.project_approvals where project_id=p_project and approval_type=v_type
      and coalesce(entity_id,'00000000-0000-0000-0000-000000000000')=coalesce(v_eid,'00000000-0000-0000-0000-000000000000')
      and status in ('draft','pending') and coalesce(is_deleted,false)=false)
    then raise exception 'duplicate_pending'; end if;
  insert into public.project_approvals(project_id, approval_type, entity_type, entity_id, kind, status, title, note, requested_by,
      due_at, sequence_order, required_role, required_user_id)
    values (p_project, v_type, v_entity, v_eid,
      case when v_type in ('client_review','deliverable_approval') then 'client' else 'internal' end, 'pending',
      nullif(btrim(p_data->>'title'),''), nullif(btrim(p_data->>'note'),''), auth.uid(),
      coalesce(nullif(p_data->>'due_at','')::timestamptz, now() + (coalesce((select approval_sla_hours from public.project_governance_settings where project_id=p_project),48) || ' hours')::interval),
      coalesce(nullif(p_data->>'sequence_order','')::int, 0), nullif(p_data->>'required_role',''), nullif(p_data->>'required_user_id','')::uuid)
    returning * into r;
  perform public.pc_log(p_project, 'approval_requested', 'approval', r.id, jsonb_build_object('type', v_type));
  if r.required_user_id is not null then
    perform public.pc_event_emit(p_project, 'approval_requested', 'approval', r.id, 'action', 'طلب اعتماد يحتاج قرارك', 'Approval needs your decision', null, null,
      '/client-portal/project-core/'||p_project||'?tab=governance', array[r.required_user_id], 'appr_req:'||r.id);
  end if;
  return r;
end $$;
revoke execute on function public.pc_governance_approval_request(uuid,jsonb) from public, anon;
grant execute on function public.pc_governance_approval_request(uuid,jsonb) to authenticated;


-- (2b) project_governance_dashboard (5A): exclude 'rejected' from the open-issues list
create or replace function public.project_governance_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (public.pc_can_read_project(p_project) and public.gov_can(p_project,'governance.view')) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'project_id', p_project,
    'settings', coalesce((select to_jsonb(s) from public.project_governance_settings s where s.project_id=p_project), '{}'::jsonb),
    'health', public.project_governance_health(p_project),
    'stage_gate', public.project_stage_gate_check(p_project, null),
    'pending_approvals', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'approval_type',a.approval_type,'title',a.title,'status',a.status,'due_at',a.due_at,
        'required_user_id',a.required_user_id,'overdue',(a.due_at is not null and a.due_at<now())) order by a.due_at nulls last),'[]'::jsonb)
      from public.project_approvals a where a.project_id=p_project and coalesce(a.is_deleted,false)=false and a.status in ('pending','draft')),
    'risks', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'category',r.category,'probability',r.probability,'impact',r.impact,
        'risk_score',r.risk_score,'severity',r.severity,'status',r.status,'owner_id',r.owner_id,'client_visible',r.client_visible) order by r.risk_score desc),'[]'::jsonb)
      from public.project_risks r where r.project_id=p_project and r.is_deleted=false and r.status not in ('closed')),
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'severity',i.severity,'status',i.status,'due_date',i.due_date,'owner_id',i.owner_id) order by (case i.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end)),'[]'::jsonb)
      from public.project_issues i where i.project_id=p_project and i.is_deleted=false and i.status not in ('resolved','closed','rejected')),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'status',d.status,'review_date',d.review_date) order by d.created_at desc),'[]'::jsonb)
      from public.project_decisions d where d.project_id=p_project and d.is_deleted=false),
    'assumptions', (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'statement',a.statement,'status',a.status,'validation_date',a.validation_date) order by a.created_at desc),'[]'::jsonb)
      from public.project_assumptions a where a.project_id=p_project and a.is_deleted=false),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'request_no',c.request_no,'title',c.title,'change_type',c.change_type,'status',c.status,'priority',c.priority,'schedule_impact_days',c.schedule_impact_days) order by c.created_at desc),'[]'::jsonb)
      from public.project_change_requests c where c.project_id=p_project and c.is_deleted=false and c.status not in ('closed','cancelled')),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id',mr.id,'user_id',mr.user_id,'project_role',mr.project_role)),'[]'::jsonb)
      from public.project_member_roles mr where mr.project_id=p_project and mr.is_deleted=false),
    -- مطابِق تمامًا لمرشِّح مصفوفة 'risks' أدناه (يستثني 'closed' فقط) كي يطابق عدّاد الخلية عناصر القائمة عند النقر.
    'risk_matrix', (select coalesce(jsonb_object_agg(cell, cnt),'{}'::jsonb) from (
        select (probability||'x'||impact) as cell, count(*) as cnt from public.project_risks
        where project_id=p_project and is_deleted=false and status not in ('closed') group by probability, impact) m),
    'generated_at', now()) into v;
  return v;
end $$;
revoke execute on function public.project_governance_dashboard(uuid) from public, anon;
grant execute on function public.project_governance_dashboard(uuid) to authenticated;


-- (2c) project_closure_readiness (5C): a 'rejected' critical issue must not block closure
create or replace function public.project_closure_readiness(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.project_governance_settings; v_stage text;
  v_req jsonb := '[]'::jsonb; v_pass jsonb := '[]'::jsonb; v_block jsonb := '[]'::jsonb; v_adv jsonb := '[]'::jsonb; v_dq jsonb := '[]'::jsonb;
  v_total int := 0; v_passed int := 0;
  v_open_tasks int; v_blocked_tasks int; v_review_tasks int; v_dlv_total int; v_dlv_unapproved int; v_dlv_revising int; v_final_assets int;
  v_open_book int; v_open_shoot int; v_open_custody int; v_crit_risk int; v_crit_issue int; v_pending_appr int; v_pending_chg int;
  v_open_time int; v_fin jsonb; v_pay boolean; v_child_open int;
  -- helper flags
  v_has_gov boolean := to_regclass('public.project_risks') is not null;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select * into s from public.project_governance_settings where project_id = p_project;
  if s.project_id is null then
    -- إعدادات افتراضية آمنة (لا تمنع فجأة): أنشئها ضمنيًّا للقراءة فقط عبر defaults.
    s.require_internal_approval := true; s.require_deliverables_approved_before_close := true;
    s.require_tasks_complete_before_close := true; s.require_final_files_available := true;
    s.require_change_requests_closed_before_close := true; s.allow_closure_with_advisory_warnings := true; s.allow_financial_override := true;
    v_dq := v_dq || jsonb_build_object('code','no_governance_settings','severity','warning','ar','لا إعدادات حوكمة — طُبِّقت افتراضات آمنة');
  end if;
  select core_stage into v_stage from public.project_core where project_id = p_project;

  -- (0) المرحلة يجب أن تكون delivered (شرط دائم غير قابل للتجاوز).
  v_total := v_total+1; v_req := v_req || jsonb_build_object('code','stage_delivered','ar','المرحلة = مُسلَّم');
  if coalesce(v_stage,'') = 'delivered' then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','stage_delivered');
  elsif coalesce(v_stage,'')='closed' then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','already_closed');
  else v_block := v_block || jsonb_build_object('code','stage_not_delivered','severity','critical','source','core_stage','entity_id',null,
      'overrideable',false,'ar','المرحلة ليست «مُسلَّم» (الحالية: '||coalesce(v_stage,'—')||')','en','Stage is not delivered'); end if;

  -- (1) المهام مكتملة + لا مهام معلّقة/مراجعة
  select count(*) filter (where status not in ('done','cancelled')),
         count(*) filter (where status='blocked'),
         count(*) filter (where status in ('internal_review','client_review'))
    into v_open_tasks, v_blocked_tasks, v_review_tasks
  from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false;
  if coalesce(s.require_tasks_complete_before_close,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','tasks_complete','ar','جميع المهام مكتملة');
    if coalesce(v_open_tasks,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','tasks_complete');
    else v_block := v_block || jsonb_build_object('code','open_tasks','severity','major','source','project_tasks','entity_id',null,
        'overrideable',true,'count',v_open_tasks,'ar', v_open_tasks||' مهمة غير مكتملة','en', v_open_tasks||' open tasks'); end if;
  end if;
  -- فحص محسوب (يدخل المقام) كي يتطابق readiness_percent مع ready: أي حاجز = فحص مطلوب فاشل.
  v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_tasks_in_review','ar','لا مهام قيد المراجعة');
  if coalesce(v_review_tasks,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_tasks_in_review');
  else v_block := v_block || jsonb_build_object('code','tasks_in_review','severity','major','source','project_tasks',
    'overrideable',true,'count',v_review_tasks,'ar', v_review_tasks||' مهمة قيد المراجعة','en', v_review_tasks||' tasks in review'); end if;
  if coalesce(v_blocked_tasks,0)>0 then v_adv := v_adv || jsonb_build_object('code','blocked_tasks','count',v_blocked_tasks,'ar', v_blocked_tasks||' مهمة متوقّفة'); end if;

  -- (2) المخرجات معتمدة + لا مراجعات مفتوحة + ملفات نهائية (قراءة deliverables؛ معزول إن غاب النظام)
  begin
    select count(*) filter (where status not in ('archived')),
           count(*) filter (where status not in ('approved','final_delivered','archived')),
           count(*) filter (where status in ('revision_requested','client_review'))
      into v_dlv_total, v_dlv_unapproved, v_dlv_revising
    from public.deliverables where project_id=p_project and coalesce(is_deleted,false)=false;
    select count(*) into v_final_assets from public.deliverable_assets a
      join public.deliverables d on d.id=a.deliverable_id where d.project_id=p_project and coalesce(d.is_deleted,false)=false and a.kind in ('final','master') and coalesce(a.is_deleted,false)=false;
  exception when undefined_table then v_dlv_total := -1; end;
  if v_dlv_total >= 0 and coalesce(s.require_deliverables_approved_before_close,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','deliverables_approved','ar','المخرجات معتمدة');
    if v_dlv_total=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','deliverables_approved'); v_adv := v_adv || jsonb_build_object('code','no_deliverables','ar','لا مخرجات مسجّلة');
    elsif coalesce(v_dlv_unapproved,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','deliverables_approved');
    else v_block := v_block || jsonb_build_object('code','deliverables_unapproved','severity','major','source','deliverables',
        'overrideable',true,'count',v_dlv_unapproved,'ar', v_dlv_unapproved||' مخرجات غير معتمدة','en', v_dlv_unapproved||' unapproved deliverables'); end if;
  end if;
  if v_dlv_total >= 0 then  -- محسوب فقط عند توفّر نظام المخرجات
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_deliverables_in_review','ar','لا مخرجات قيد المراجعة');
    if coalesce(v_dlv_revising,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_deliverables_in_review');
    else v_block := v_block || jsonb_build_object('code','deliverables_in_review','severity','major','source','deliverables',
      'overrideable',true,'count',v_dlv_revising,'ar', v_dlv_revising||' مخرج قيد المراجعة/التعديل','en', v_dlv_revising||' deliverables under review'); end if;
  end if;
  if v_dlv_total > 0 and coalesce(s.require_final_files_available,true) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','final_files','ar','ملفات نهائية متاحة');
    if coalesce(v_final_assets,0)>0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','final_files');
    else v_block := v_block || jsonb_build_object('code','no_final_files','severity','major','source','deliverable_assets','overrideable',true,'ar','لا ملفات نهائية مرفقة','en','No final files'); end if;
  end if;

  -- (3) موارد/جلسات (قراءة؛ معزول إن غاب 4B)
  begin
    select count(*) into v_open_book from public.resource_bookings
      where project_id=p_project and coalesce(is_deleted,false)=false and status in ('hold','pending_approval','confirmed','in_use');
  exception when undefined_table then v_open_book := -1; end;
  if v_open_book >= 0 and coalesce(s.require_resource_bookings_closed_before_close,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','bookings_closed','ar','حجوزات الموارد مغلقة');
    if v_open_book=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','bookings_closed');
    else v_block := v_block || jsonb_build_object('code','open_bookings','severity','major','source','resource_bookings','overrideable',true,'count',v_open_book,
        'ar', v_open_book||' حجز مورد مفتوح','en', v_open_book||' open resource bookings'); end if;
  elsif coalesce(v_open_book,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_bookings','count',v_open_book,'ar', v_open_book||' حجز مورد مفتوح');
  end if;
  begin select count(*) into v_open_shoot from public.project_shoot_sessions where project_id=p_project and coalesce(is_deleted,false)=false and status in ('planned','confirmed','in_progress');
  exception when undefined_table then v_open_shoot := 0; end;
  if coalesce(v_open_shoot,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_shoots','count',v_open_shoot,'ar', v_open_shoot||' جلسة تصوير مفتوحة'); end if;

  -- (4) العهدة — قراءة فقط: Warning دائمًا (لا نغلقها تلقائيًا)
  v_open_custody := public.pc_project_open_custody_count(p_project);
  if coalesce(v_open_custody,0)>0 then v_adv := v_adv || jsonb_build_object('code','open_custody','count',v_open_custody,'source','custody','ar', v_open_custody||' عهدة مفتوحة — تُدار من نظام العهدة','en', v_open_custody||' open custody (manage in custody system)'); end if;

  -- (5) حوكمة: مخاطر/مشكلات/تغييرات/اعتمادات (معزول إن غاب 5A)
  if v_has_gov then
    begin
      select count(*) into v_crit_risk from public.project_risks where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('closed','accepted');
      select count(*) into v_crit_issue from public.project_issues where project_id=p_project and coalesce(is_deleted,false)=false and severity='critical' and status not in ('resolved','closed','rejected');
      select count(*) into v_pending_appr from public.project_approvals where project_id=p_project and coalesce(is_deleted,false)=false and status in ('pending','draft') and approval_type<>'project_closure';
      select count(*) into v_pending_chg from public.project_change_requests where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('closed','cancelled','implemented','rejected');
    exception when undefined_table or undefined_column then v_has_gov := false; end;
  end if;
  if v_has_gov then
    if coalesce(s.require_risks_closed_before_close,false) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','risks_closed','ar','لا مخاطر حرجة مفتوحة');
      if coalesce(v_crit_risk,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','risks_closed');
      else v_block := v_block || jsonb_build_object('code','critical_risks','severity','critical','source','project_risks','overrideable',true,'count',v_crit_risk,'ar', v_crit_risk||' مخاطرة حرجة مفتوحة','en', v_crit_risk||' critical risks'); end if;
    elsif coalesce(v_crit_risk,0)>0 then v_adv := v_adv || jsonb_build_object('code','critical_risks','count',v_crit_risk,'ar', v_crit_risk||' مخاطرة حرجة'); end if;
    if coalesce(s.require_issues_closed_before_close,false) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','issues_closed','ar','لا مشكلات حرجة مفتوحة');
      if coalesce(v_crit_issue,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','issues_closed');
      else v_block := v_block || jsonb_build_object('code','critical_issues','severity','critical','source','project_issues','overrideable',true,'count',v_crit_issue,'ar', v_crit_issue||' مشكلة حرجة مفتوحة','en', v_crit_issue||' critical issues'); end if;
    elsif coalesce(v_crit_issue,0)>0 then v_adv := v_adv || jsonb_build_object('code','critical_issues','count',v_crit_issue,'ar', v_crit_issue||' مشكلة حرجة'); end if;
    if coalesce(s.require_change_requests_closed_before_close,true) then
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','changes_closed','ar','لا طلبات تغيير معلّقة');
      if coalesce(v_pending_chg,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','changes_closed');
      else v_block := v_block || jsonb_build_object('code','pending_changes','severity','major','source','project_change_requests','overrideable',true,'count',v_pending_chg,'ar', v_pending_chg||' طلب تغيير غير محلول','en', v_pending_chg||' open change requests'); end if;
    elsif coalesce(v_pending_chg,0)>0 then v_adv := v_adv || jsonb_build_object('code','pending_changes','count',v_pending_chg,'ar', v_pending_chg||' طلب تغيير معلّق'); end if;
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','no_pending_approvals','ar','لا اعتمادات معلّقة (غير الإغلاق)');
    if coalesce(v_pending_appr,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','no_pending_approvals');
    else v_block := v_block || jsonb_build_object('code','pending_approvals','severity','major','source','project_approvals','overrideable',true,'count',v_pending_appr,'ar', v_pending_appr||' اعتماد معلّق (غير الإغلاق)','en', v_pending_appr||' pending approvals'); end if;
  else
    v_dq := v_dq || jsonb_build_object('code','governance_unavailable','severity','warning','ar','بيانات الحوكمة (5A) غير متاحة — فحوص المخاطر/المشكلات/التغييرات معطّلة');
  end if;

  -- (6) الإخلاء المالي — قراءة فقط (غير متاح ⇒ Blocker قابل للتجاوز فقط إذا اشترطته السياسة)
  v_fin := public.pc_financial_clearance(p_project);
  v_pay := (v_fin->>'payment_cleared')::boolean;
  if coalesce(s.require_financial_clearance_before_close,false) or coalesce(s.require_final_payment_before_close,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','financial_clearance','ar','الإخلاء المالي');
    if coalesce(v_pay,false) or coalesce((v_fin->>'finance_can_close')::boolean,false) then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','financial_clearance');
    elsif not coalesce((v_fin->>'available')::boolean,true) and v_pay is null then
      v_block := v_block || jsonb_build_object('code','financial_unavailable','severity','major','source','finance','overrideable',true,'ar','تعذّر التحقق من الإخلاء المالي (لا صلاحية) — يتطلّب تجاوزًا رسميًّا','en','Financial clearance unavailable — official override required');
    else v_block := v_block || jsonb_build_object('code','financial_not_cleared','severity','major','source','finance','overrideable',true,'ar','لم يُؤكَّد الإخلاء المالي/السداد النهائي','en','Financial clearance not confirmed'); end if;
  end if;

  -- (7) الوقت/سجلات الدوام (اختياري)
  if coalesce(s.require_time_logs_submitted,false) then
    begin select count(*) into v_open_time from public.project_tasks t where t.project_id=p_project and coalesce(t.is_deleted,false)=false and t.status='in_progress';
    exception when others then v_open_time := 0; end;
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','time_logs','ar','سجلات الوقت مقدّمة');
    if coalesce(v_open_time,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','time_logs');
    else v_block := v_block || jsonb_build_object('code','open_time','severity','minor','source','project_tasks','overrideable',true,'count',v_open_time,'ar','مهام قيد التنفيذ قد تحمل وقتًا غير مقدّم','en','In-progress tasks may have unsubmitted time'); end if;
  end if;

  -- (8) دروس مستفادة + تقرير إغلاق (إن اشترطتهما السياسة)
  if coalesce(s.require_lessons_learned,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','lessons_learned','ar','دروس مستفادة مسجّلة');
    if exists (select 1 from public.project_lessons_learned where project_id=p_project and is_deleted=false) then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','lessons_learned');
    else v_block := v_block || jsonb_build_object('code','no_lessons','severity','minor','source','lessons','overrideable',true,'ar','لم تُسجَّل دروس مستفادة','en','No lessons learned recorded'); end if;
  end if;
  -- تقرير الإغلاق يُحسب حيًّا عند الطلب (project_closure_report دائمًا متاح) — تذكير إرشادي فقط لا فحص محسوب،
  -- كي لا يكسر ثبات ready⟺100% ولا يحجب لغياب لقطة مُثبَّتة (لا مسار يُثبّت closure_report_id).
  if coalesce(s.require_closure_report,false)
     and not exists (select 1 from public.project_closure_requests where project_id=p_project and is_deleted=false and closure_report_id is not null) then
    v_adv := v_adv || jsonb_build_object('code','closure_report_pending','ar','تقرير الإغلاق يُولَّد عند الطلب — راجِعه قبل الإغلاق');
  end if;

  -- (9) قبول العميل النهائي (إن اشترطته السياسة)
  if coalesce(s.require_client_approval,false) then
    v_total := v_total+1; v_req := v_req || jsonb_build_object('code','client_acceptance','ar','قبول العميل النهائي');
    if exists (select 1 from public.project_final_acceptances where project_id=p_project and is_deleted=false and acceptance_type='client_final' and status='accepted') then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','client_acceptance');
    else v_block := v_block || jsonb_build_object('code','no_client_acceptance','severity','major','source','final_acceptances','overrideable',true,'ar','لم يُسجَّل قبول العميل النهائي','en','No client final acceptance'); end if;
  end if;

  -- (10) بيانات أساسية: مدير المشروع موجود — تحذير جودة بيانات فقط (لا يدخل المقام ولا يحجب) كي لا يضخّم المقام دون حجب.
  if not exists (select 1 from public.project_members m where m.project_id=p_project and m.role='kian_manager' and coalesce(m.is_deleted,false)=false) then
    v_dq := v_dq || jsonb_build_object('code','no_manager','severity','warning','ar','لا مدير مشروع مُسنَد'); end if;

  -- (11) المشاريع الفرعية (إن اشترطت السياسة إغلاقها) — معزول للعمود غير المطبّق
  if coalesce(s.require_child_projects_closed,false) then
    begin
      select count(*) into v_child_open from public.projects c
        join public.project_core cc on cc.project_id=c.id
        where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and cc.core_stage <> 'closed';
      v_total := v_total+1; v_req := v_req || jsonb_build_object('code','children_closed','ar','المشاريع الفرعية مغلقة');
      if coalesce(v_child_open,0)=0 then v_passed := v_passed+1; v_pass := v_pass || jsonb_build_object('code','children_closed');
      else v_block := v_block || jsonb_build_object('code','open_children','severity','major','source','projects','overrideable',false,'count',v_child_open,'ar', v_child_open||' مشروع فرعي غير مغلق','en', v_child_open||' open subprojects'); end if;
    exception when undefined_column then v_dq := v_dq || jsonb_build_object('code','hierarchy_unavailable','severity','warning','ar','هرمية المشاريع غير مطبّقة — تخطّي فحص المشاريع الفرعية'); end;
  end if;

  return jsonb_build_object(
    'project_id', p_project,
    'ready', (jsonb_array_length(v_block)=0 and v_total>0),
    'readiness_percent', case when v_total>0 then round(v_passed::numeric/v_total*100)::int else null end,
    'required_checks', v_req, 'passed_checks', v_pass,
    'blockers', v_block,
    'advisory_warnings', v_adv,
    'overrideable_blockers', (select coalesce(jsonb_agg(b),'[]'::jsonb) from jsonb_array_elements(v_block) b where coalesce((b->>'overrideable')::boolean,false)),
    'non_overrideable_blockers', (select coalesce(jsonb_agg(b),'[]'::jsonb) from jsonb_array_elements(v_block) b where not coalesce((b->>'overrideable')::boolean,false)),
    'data_quality_warnings', v_dq,
    'financial', v_fin, 'open_custody', v_open_custody,
    'generated_at', now());
end $$;
revoke execute on function public.project_closure_readiness(uuid) from public, anon;
grant execute on function public.project_closure_readiness(uuid) to authenticated;


-- ============================================================================
-- (5) FINAL-REVIEW HARDENING (same bug classes as above, found by the final critic)
-- ============================================================================

-- (5a) project_client_user_ids: SECURITY DEFINER helper for notification triggers,
--      but its default ACL is EXECUTE-to-PUBLIC (no revoke anywhere) => any signed-in
--      user could call it over PostgREST and read a project's client user UUIDs by id.
--      Same class as the exec_gov_counts leak. Revoke the RPC surface; the definer
--      triggers keep working (they run as owner). Guarded so absence is a no-op.
do $h1$
begin
  if to_regprocedure('public.project_client_user_ids(uuid)') is not null then
    revoke all on function public.project_client_user_ids(uuid) from public, anon, authenticated;
  end if;
end $h1$;

-- (5b) preproduction_comments.ppc_read: the completion migration tightened the ITEM
--      policy pp_read to require is_active=true, but never re-created the COMMENTS
--      policy, so a client kept reading comments on an item staff had deactivated.
--      Mirror pp_read exactly (client branch adds is_active). Guarded on table+helper.
do $h2$
begin
  if to_regclass('public.preproduction_comments') is not null
     and to_regprocedure('public.pp_can_manage(uuid)') is not null then
    drop policy if exists ppc_read on public.preproduction_comments;
    create policy ppc_read on public.preproduction_comments for select to authenticated using (
      is_deleted = false and exists (
        select 1 from public.preproduction_items i where i.id = item_id and i.is_deleted = false and (
          public.pp_can_manage(i.project_id)
          or (public.is_client_side(i.project_id) and i.client_visible = true and i.is_active = true)
        )
      )
    );
  end if;
end $h2$;

-- ============================================================================
-- self-test -- no side effects
-- ============================================================================
do $selftest$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.exec_gov_counts(uuid)'::regprocedure);
  if position('is_staff()' in v_def) = 0 or position('pc_can_read_project(p_project)' in v_def) = 0
    then raise exception '8-STAB FAIL: exec_gov_counts has no isolation gate'; end if;
  foreach v_def in array array['public.exec_gov_counts(uuid)',
      'public.executive_portfolio_dashboard(jsonb)','public.executive_portfolio_risks_issues(jsonb)',
      'public.project_governance_dashboard(uuid)','public.project_closure_readiness(uuid)'] loop
    if pg_get_functiondef(v_def::regprocedure) ~ 'not in \(''closed'',''resolved''\)'
      then raise exception '8-STAB FAIL: issue filter still drops rejected in %', v_def; end if;
  end loop;
  if position('''submitted'',''impact_analysis'',''pending_approval''' in
       pg_get_functiondef('public.exec_gov_counts(uuid)'::regprocedure)) = 0
    then raise exception '8-STAB FAIL: pending_changes not canonical'; end if;
  if position('for update' in pg_get_functiondef('public.pc_governance_approval_request(uuid,jsonb)'::regprocedure)) = 0
    then raise exception '8-STAB FAIL: approval request has no lock'; end if;
  -- (5a) project_client_user_ids no longer executable by authenticated (if present)
  if to_regprocedure('public.project_client_user_ids(uuid)') is not null
     and exists (select 1 from information_schema.role_routine_grants
                 where routine_name='project_client_user_ids' and grantee in ('authenticated','PUBLIC'))
    then raise exception '8-STAB FAIL: project_client_user_ids still executable by authenticated/PUBLIC'; end if;
  -- (5b) ppc_read client branch mirrors pp_read (is_active) if the policy exists
  if to_regclass('public.preproduction_comments') is not null then
    if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='preproduction_comments' and policyname='ppc_read'
                   and qual ~ 'is_active')
      then raise exception '8-STAB FAIL: ppc_read missing is_active check'; end if;
  end if;
  raise notice '8-STAB OK -- exec_gov_counts isolation + issue/change vocab + approval lock.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
