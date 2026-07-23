-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 6C — دمج الإغلاق في المسارات التنفيذية (Closure ↔ Executive)
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط):
--   • طبقة الإغلاق 5C كاملة على مستوى SQL (32 دالة/6 جداول) وأغلفتها في TS موجودة،
--     لكنّ 16 غلافًا **بلا أيّ مستهلك في الواجهة** (صندوق الإغلاق، لوحة المحفظة،
--     سجلّ الدروس، سجلّ الأرشيف، الاعتماد/الرفض، القبول النهائي…).
--   • طبقة 5B التنفيذية **لا تحمل أيّ إشارة إغلاق** (كل مطابقات 'closed' فيها
--     حالات مخاطر/مشكلات/تغييرات، لا دورة إغلاق المشروع).
--   • project_lessons_register(project, filters) لكل مشروع على حدة — لا سجلّ
--     معرفة مؤسسيّ عبر المشاريع.
--   • portfolio_closure_dashboard تستدعي pc_project_closure_status ثلاث مرّات
--     لكل مشروع، وتُصفّي على 'awaiting_client_acceptance' وهي قيمة لا يعيدها
--     محرّك الحالة أصلًا ⇒ «بانتظار قبول العميل» لا تظهر تنفيذيًّا أبدًا.
--
-- ما تفعله هذه الدفعة: إضافات فقط فوق ما هو قائم — لا نظام موازٍ، ولا إعادة
-- تعريف لـ can_access_project/is_client_owner/is_client_side، ولا مساس بـcore_stage
-- (project_core_set_stage يبقى الكاتب الوحيد)، ولا كتابة مالية أو Zoho.
--
-- ترتيب التشغيل: 5A → 5B → 5C → (6A → 6B) → 6C.
-- ملاحظة صيانة: §4 يعيد تعريف executive_snapshot_capture(text) بنفس التوقيع
-- (لا 42P13) ليضيف مؤشّرات الإغلاق؛ إعادة تشغيل 5B بعد 6C تُرجع النسخة بلا إغلاق
-- ⇒ أعِد تشغيل هذا الملف بعدها (idempotent).
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  -- 6C PREFLIGHT — يعتمد على 5C (الإغلاق) و5B (التنفيذي)؛ يتوقّف بوضوح بدل الفشل الغامض.
  if to_regclass('public.project_closure_requests') is null
     or to_regclass('public.project_lessons_learned') is null
     or to_regclass('public.project_archives') is null
     or to_regclass('public.project_final_acceptances') is null
    then raise exception '6C PREFLIGHT: طبقة الإغلاق 5C غير مطبّقة — شغّل docs/project_governance_batch5c_RUNME.sql أولًا'; end if;
  if to_regprocedure('public.pc_project_closure_status(uuid)') is null
     or to_regprocedure('public.closure_can(uuid,text)') is null
     or to_regprocedure('public.portfolio_closure_dashboard(jsonb)') is null
    then raise exception '6C PREFLIGHT: دوال 5C ناقصة'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '6C PREFLIGHT: pc_can_read_project مفقودة (Project Core غير مطبّق)'; end if;
  -- 5B اختيارية-التحسين لا إلزامية: تُلتقط بـto_regprocedure داخل الدوال.
  if to_regclass('public.executive_kpi_catalog') is null then
    raise notice '6C: 5B غير مطبّقة — مؤشّرات الإغلاق التنفيذية لن تُسجَّل في الكتالوج';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) صلاحيات السجلّات المؤسسية (تُضاف إلى كتالوج الصلاحيات القائم — لا كتالوج جديد)
-- ════════════════════════════════════════════════════════════════════════════
-- تسمية صادقة: هذه الصلاحية لا «تفتح السجلّ» (كل موظّف يراه) بل تكشف الدروس المصنّفة
-- «إدارة» تحديدًا ⇒ حسّاسة، ووصفها يقول ما تفعله فعلًا.
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('closure.view_knowledge', 'closure','sensitive', 880,'عرض الدروس المصنّفة «إدارة»','View management-confidential lessons'),
  ('closure.view_portfolio', 'closure','normal', 885,'عرض إغلاق المحفظة','View portfolio closure')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §1ب) إنفاذ السرّية على مستوى الصفّ — لا على مستوى الدالة فقط
--   سياسة 5C (pll_read) تسمح لأيّ موظّف يقرأ المشروع بقراءة **كل** دروسه عبر
--   PostgREST مباشرة، فيصبح ضبط السرّية في سجلّ المعرفة تجميليًّا لا حاجزًا.
--   نشدّها هنا بنفس شرط الدالة. دوال 5C كلّها SECURITY DEFINER ⇒ لا تتأثّر،
--   ولا يقرأ أيّ مسار في التطبيق هذا الجدول مباشرةً (تحقّق: لا مطابقة في lib/ ولا components/).
--   تنبيه صيانة: إعادة تشغيل 5C بعد 6C تُرجع السياسة المتساهلة ⇒ أعِد تشغيل هذا الملف.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
begin
  if to_regclass('public.project_lessons_learned') is null then return; end if;
  execute 'drop policy if exists pll_read on public.project_lessons_learned';
  execute $p$
    create policy pll_read on public.project_lessons_learned for select to authenticated using (
      (public.is_staff() and public.pc_can_read_project(project_id)
        and (confidentiality <> 'management'
             or coalesce(public.can_manage_projects(), false)
             or coalesce(public.emp_has_permission('closure.view_knowledge'), false)))
      or (client_visible and to_regprocedure('public.is_client_owner(uuid)') is not null
          and public.is_client_owner(project_id)))
  $p$;
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) سجلّ المعرفة المؤسسي — دروس مستفادة عبر المشاريع (لم يكن موجودًا؛ 5C لكل مشروع)
--     العزل: صفّ-بصفّ عبر pc_can_read_project + احترام السرّية والاعتماد المعرفي.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.closure_knowledge_register(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_has_more boolean := false; v_stats jsonb;
  v_cat text := nullif(p_filters->>'category','');
  v_impact text := nullif(p_filters->>'impact_level','');
  v_project uuid := nullif(p_filters->>'project_id','')::uuid;
  v_search text := nullif(btrim(p_filters->>'search'),'');
  v_kb_only boolean := coalesce((p_filters->>'approved_only')::boolean, false);
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,50),1),200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_mgmt boolean;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  -- «إدارة» تفتح دروس السرّية management؛ غيرها يرى internal/client_shareable فقط.
  v_mgmt := coalesce(public.can_manage_projects(), false) or coalesce(public.emp_has_permission('closure.view_knowledge'), false);

  with base as (
    select l.id, l.project_id, p.project_name, l.category, l.title, l.description, l.recommendation,
           l.reusable_practice, l.what_worked, l.what_did_not_work, l.root_cause,
           l.impact_level, l.confidentiality, l.approved_for_knowledge_base, l.approved_at, l.created_at
    from public.project_lessons_learned l
      join public.projects p on p.id = l.project_id
    where coalesce(l.is_deleted,false) = false
      and coalesce(p.is_deleted,false) = false
      and public.pc_can_read_project(l.project_id)                       -- العزل الحاسم لكل صف
      and (v_mgmt or l.confidentiality <> 'management')                  -- السرّية تُحترم دائمًا
      and (not v_kb_only or l.approved_for_knowledge_base = true)
      and (v_cat is null or l.category = v_cat)
      and (v_impact is null or l.impact_level = v_impact)
      and (v_project is null or l.project_id = v_project)
      and (v_search is null or l.title ilike '%'||v_search||'%' or coalesce(l.recommendation,'') ilike '%'||v_search||'%'
           or coalesce(l.reusable_practice,'') ilike '%'||v_search||'%')
  ), paged as (
    -- صفّ إضافي واحد لتحديد has_more بصدق (لا returned>=limit).
    select q.*, row_number() over (order by q.created_at desc, q.id) as rn from (
      select * from base order by created_at desc, id limit v_limit + 1 offset v_offset
    ) q
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',f.id,'project_id',f.project_id,'project_name',f.project_name,'category',f.category,'title',f.title,
      'description',f.description,'recommendation',f.recommendation,'reusable_practice',f.reusable_practice,
      'what_worked',f.what_worked,'what_did_not_work',f.what_did_not_work,'root_cause',f.root_cause,
      'impact_level',f.impact_level,'confidentiality',f.confidentiality,
      'approved_for_knowledge_base',f.approved_for_knowledge_base,'approved_at',f.approved_at,'created_at',f.created_at)
      order by f.created_at desc) filter (where f.rn <= v_limit), '[]'::jsonb),
    (count(*) > v_limit)
    into v_rows, v_has_more
  from paged f;

  -- إحصاءات على **نفس المجموعة المصفّاة** كاملةً (لا الصفحة). لو تجاهلت الفلاتر لعُرضت
  -- أرقام عامّة فوق قائمة مصفّاة تناقضها (٣ نتائج تحت عنوان «الإجمالي: ٤٠»).
  select jsonb_build_object(
      'total', count(*),
      'approved', count(*) filter (where l.approved_for_knowledge_base),
      'critical', count(*) filter (where l.impact_level = 'critical'),
      'projects', count(distinct l.project_id))
    into v_stats
  from public.project_lessons_learned l
    join public.projects p on p.id = l.project_id
  where coalesce(l.is_deleted,false)=false and coalesce(p.is_deleted,false)=false
    and public.pc_can_read_project(l.project_id)
    and (v_mgmt or l.confidentiality <> 'management')
    and (not v_kb_only or l.approved_for_knowledge_base = true)
    and (v_cat is null or l.category = v_cat)
    and (v_impact is null or l.impact_level = v_impact)
    and (v_project is null or l.project_id = v_project)
    and (v_search is null or l.title ilike '%'||v_search||'%' or coalesce(l.recommendation,'') ilike '%'||v_search||'%'
         or coalesce(l.reusable_practice,'') ilike '%'||v_search||'%');

  return jsonb_build_object('lessons', v_rows, 'stats', v_stats, 'limit', v_limit, 'offset', v_offset,
    'returned', jsonb_array_length(v_rows), 'has_more', v_has_more,
    'can_see_management', v_mgmt, 'generated_at', now());
end $$;
revoke execute on function public.closure_knowledge_register(jsonb) from public, anon;
grant execute on function public.closure_knowledge_register(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) العدسة التنفيذية للإغلاق — مقاييس مشتقّة لا يوفّرها 5B ولا 5C
--     تحسب pc_project_closure_status **مرّة واحدة** لكل مشروع (5C تستدعيها ثلاثًا)
--     وتُضيف: زمن دورة الإغلاق، الإغلاقات المتأخّرة، تقادُم «مُسلَّم بلا إغلاق»،
--     وبانتظار قبول العميل (حالة لا يعبّر عنها محرّك الحالة).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.executive_closure_metrics(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_used_5b boolean := false; v_st jsonb; v_dist jsonb; v_rows jsonb; v_cycle numeric; v_cycle_n int := 0;
  v_overdue jsonb; v_aging jsonb; v_pending_accept jsonb; v_lessons jsonb; v_archived int := 0;
  v_today date := (now() at time zone 'utc')::date;
begin
  if not (public.is_staff() and (coalesce(public.can_manage_projects(),false)
          or coalesce(public.emp_has_permission('executive.view_dashboard'),false)
          or coalesce(public.emp_has_permission('closure.view_portfolio'),false)
          or coalesce(public.emp_has_permission('closure.view'),false)))
    then raise exception 'not authorized'; end if;

  -- المجموعة المرئية: تُركّب exec_visible_projects (5B) إن وُجدت، وإلّا المرئي per-row.
  -- تنبيه: array_agg على صفر صفوف تُعيد NULL، فلا يجوز استخدام «v_ids is null» كإشارة
  -- «5B غير متاحة» — وإلّا صار الفلتر الذي لا يطابق شيئًا يعرض المحفظة كاملة.
  if to_regprocedure('public.exec_visible_projects(jsonb)') is not null then
    begin
      select array_agg(id) into v_ids from public.exec_visible_projects(p_filters) g(id);
      v_used_5b := true;
    exception when others then v_used_5b := false; v_ids := null; end;
  end if;
  if not v_used_5b then
    select array_agg(p.id) into v_ids from public.projects p
      where coalesce(p.is_deleted,false)=false and public.pc_can_read_project(p.id);
  end if;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- الحالة تُشتقّ **مرّة واحدة** لكل مشروع (المحرّك الوحيد pc_project_closure_status؛
  -- 5C تستدعيها ثلاثًا). الفلترة بـpc_can_read_project تمنع رفع الدالة للاستثناء
  -- لو أعادت exec_visible_projects مشروعًا خارج نطاق القراءة الحاليّ.
  select coalesce(jsonb_agg(jsonb_build_object('project_id', x, 'status', public.pc_project_closure_status(x))), '[]'::jsonb)
    into v_st from unnest(v_ids) x where public.pc_can_read_project(x);

  select coalesce(jsonb_object_agg(s, c), '{}'::jsonb) into v_dist
    from (select e->>'status' s, count(*) c from jsonb_array_elements(v_st) e group by 1) d;

  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', e->>'project_id',
      'project_name', (select project_name from public.projects where id = (e->>'project_id')::uuid),
      'closure_status', e->>'status') order by e->>'status'), '[]'::jsonb)
    into v_rows
  from jsonb_array_elements(v_st) e
  where e->>'status' in ('closure_in_progress','closure_blocked','awaiting_internal_approval','closure_approved','reopened');

  -- زمن دورة الإغلاق (أيام): من تقديم الطلب إلى الإغلاق الفعلي — المكتملة فقط.
  begin
    select round(avg(extract(epoch from (c.actual_closure_date - c.requested_at))/86400.0)::numeric, 1), count(*)
      into v_cycle, v_cycle_n
    from public.project_closure_requests c
    -- لا تُقيَّد بـv_ids: الإغلاق المكتمل يُتبَع غالبًا بالأرشفة التي تضع is_deleted=true،
    -- فتسقط من مجموعة الرؤية تحديدًا الطلباتُ التي يقيس هذا المؤشّر زمنها. العزل per-row.
    where coalesce(c.is_deleted,false)=false
      and c.actual_closure_date is not null and c.actual_closure_date > c.requested_at
      and public.pc_can_read_project(c.project_id);
  exception when others then v_cycle := null; v_cycle_n := 0; end;

  -- إغلاقات تجاوزت تاريخها المخطّط ولمّا تُغلق.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('project_id',c.project_id,
        'project_name',(select project_name from public.projects where id=c.project_id),
        'request_id',c.id,'planned_closure_date',c.planned_closure_date,
        'days_overdue', (v_today - c.planned_closure_date), 'status', c.status)
        order by c.planned_closure_date), '[]'::jsonb)
      into v_overdue
    from public.project_closure_requests c
    where c.project_id = any(v_ids) and coalesce(c.is_deleted,false)=false
      and c.planned_closure_date is not null and c.planned_closure_date < v_today
      -- 'reopened' حالة نهائية لهذا الطلب (أُغلق ثم أُعيد فتح المشروع) ⇒ ليست تأخّرًا مفتوحًا.
      and c.status not in ('closed','cancelled','rejected','reopened');
  exception when others then v_overdue := '[]'::jsonb; end;

  -- تقادُم «مُسلَّم ولم يُغلق»: مشاريع في delivered بلا طلب إغلاق فعّال.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('project_id',pc.project_id,
        'project_name',(select project_name from public.projects where id=pc.project_id),
        'due_date',pc.due_date,
        'days_since_due', case when pc.due_date is not null then (v_today - pc.due_date) else null end)
        order by pc.due_date nulls last), '[]'::jsonb)
      into v_aging
    from public.project_core pc
    where pc.project_id = any(v_ids) and pc.core_stage = 'delivered'
      and not exists (select 1 from public.project_closure_requests c
                      where c.project_id = pc.project_id and coalesce(c.is_deleted,false)=false
                        and c.status in ('draft','submitted','under_review','changes_requested','approved'));
  exception when others then v_aging := '[]'::jsonb; end;

  -- بانتظار قبول العميل — الحالة التي لا يعيدها محرّك الحالة، فتغيب تنفيذيًّا.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('project_id',a.project_id,
        'project_name',(select project_name from public.projects where id=a.project_id),
        'acceptance_id',a.id,'acceptance_type',a.acceptance_type,'requested_at',a.requested_at,'due_at',a.due_at,
        'overdue', (a.due_at is not null and a.due_at < now()))
        order by a.requested_at), '[]'::jsonb)
      into v_pending_accept
    from public.project_final_acceptances a
    -- نفس تعريف «معلّق» في my_closure_inbox (5C): القبول المرتجع للتعديل ما زال مطلوبًا.
    where a.project_id = any(v_ids) and coalesce(a.is_deleted,false)=false and a.status in ('pending','changes_requested');
  exception when others then v_pending_accept := '[]'::jsonb; end;

  -- التقاط الدروس والأرشفة: **لا تُقيَّد بـv_ids**. الأرشفة تضع projects.is_deleted=true
  -- (project_archive_create → project_core_archive_project)، وv_ids تستثني المحذوف ⇒ لو قيّدناها
  -- لكان archived_count صفرًا دائمًا بحكم البناء، ولسقطت من مقام «التقاط الدروس» المشاريعُ التي
  -- أكملت دورة الإغلاق فعلًا. العزل هنا per-row عبر pc_can_read_project بدل مجموعة الرؤية.
  begin
    select jsonb_build_object(
        'closed_projects', count(*),
        'with_lessons', count(*) filter (where exists (
           select 1 from public.project_lessons_learned l
           where l.project_id = pc.project_id and coalesce(l.is_deleted,false)=false)),
        'capture_rate', case when count(*) > 0 then round(
           count(*) filter (where exists (select 1 from public.project_lessons_learned l
             where l.project_id = pc.project_id and coalesce(l.is_deleted,false)=false))::numeric
           / count(*) * 100, 1) else null end)                       -- المقام صفر ⇒ null لا 0/100
      into v_lessons
    from public.project_core pc
    where pc.core_stage = 'closed' and public.pc_can_read_project(pc.project_id);
  exception when others then v_lessons := jsonb_build_object('closed_projects',0,'with_lessons',0,'capture_rate',null); end;

  begin
    select count(*) into v_archived from public.project_archives a
      where coalesce(a.is_deleted,false)=false and a.status <> 'restored'
        and public.pc_can_read_project(a.project_id);
  exception when others then v_archived := 0; end;

  return jsonb_build_object(
    'total', coalesce(array_length(v_ids,1),0),
    'distribution', coalesce(v_dist,'{}'::jsonb),
    'in_progress_rows', coalesce(v_rows,'[]'::jsonb),
    'avg_closure_cycle_days', v_cycle,
    'closure_cycle_sample', v_cycle_n,
    'overdue_closures', coalesce(v_overdue,'[]'::jsonb),
    'delivered_not_closed', coalesce(v_aging,'[]'::jsonb),
    'pending_client_acceptance', coalesce(v_pending_accept,'[]'::jsonb),
    'lessons', coalesce(v_lessons,'{}'::jsonb),
    'archived_count', v_archived,
    'generated_at', now());
end $$;
revoke execute on function public.executive_closure_metrics(jsonb) from public, anon;
grant execute on function public.executive_closure_metrics(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) مؤشّرات الإغلاق في الكتالوج التنفيذي القائم (لا كتالوج موازٍ)
--     الدرس المستفاد من 23502: قائمة أعمدة صريحة وunit غير فارغة لكل صف.
-- ════════════════════════════════════════════════════════════════════════════
do $kpi$
begin
  if to_regclass('public.executive_kpi_catalog') is null then
    raise notice '6C: تخطّي مؤشّرات الإغلاق — executive_kpi_catalog غير موجود'; return;
  end if;
  insert into public.executive_kpi_catalog
    (key, category, label_ar, label_en, description, formula_description, unit, aggregation_method,
     numerator, denominator, data_source, limitations, required_permissions, sort_order) values
    ('closure_cycle_time','closure','زمن دورة الإغلاق','Closure cycle time',
     'متوسط الأيام بين تقديم طلب الإغلاق والإغلاق الفعلي','avg(actual_closure_date - requested_at)','days','avg',
     null,'طلبات الإغلاق المكتملة','project_closure_requests (5C)','يتطلّب 5C؛ يستثني الملغاة والمرفوضة','{closure.view_portfolio}',300),
    ('overdue_closure_count','closure','الإغلاقات المتأخّرة','Overdue closures',
     'طلبات إغلاق تجاوزت التاريخ المخطّط ولم تُغلق','count(planned_closure_date < today & not closed)','count','count',
     'طلبات متأخّرة','—','project_closure_requests (5C)','يتطلّب planned_closure_date','{closure.view_portfolio}',310),
    ('lessons_capture_rate','closure','نسبة التقاط الدروس','Lessons capture rate',
     'المشاريع المغلقة التي سجّلت درسًا واحدًا على الأقل','projects_with_lessons / closed_projects','percent','ratio',
     'مشاريع مغلقة ولها دروس','المشاريع المغلقة','project_lessons_learned (5C)','المقام صفر ⇒ null لا صفر','{closure.view_knowledge}',320),
    ('delivered_not_closed','closure','مُسلَّم بلا إغلاق','Delivered not closed',
     'مشاريع في مرحلة delivered بلا طلب إغلاق فعّال','count(core_stage=delivered & no active closure request)','count','count',
     'مشاريع مُسلَّمة بلا طلب','—','project_core + project_closure_requests','لا يشمل المغلقة','{closure.view_portfolio}',330)
  on conflict (key) do nothing;
end $kpi$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) لقطة المؤشّرات: إضافة مؤشّرات الإغلاق إلى نفس محرّك 5B (نفس التوقيع ⇒ لا 42P13)
--     كل كتلة إغلاق معزولة بـexception كي تعمل اللقطة حتى لو لم تُطبَّق 5C.
-- ════════════════════════════════════════════════════════════════════════════
-- §5 محاط بحارس: إعادة تعريف دالة تملكها 5B على قاعدة بلا 5B تُركّب دالة تشير إلى
-- executive_kpi_snapshots غير الموجود ⇒ تعطُّل عند أول تشغيل. لا نلمسها إلّا إن كانت 5B مطبّقة.
do $snap$
begin
  if to_regclass('public.executive_kpi_snapshots') is null then
    raise notice '6C: 5B غير مطبّقة — لن تُحدَّث لقطة المؤشّرات (executive_snapshot_capture تُترك كما هي)';
    return;
  end if;
  execute $f$
create or replace function public.executive_snapshot_capture(p_period text default 'weekly')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_date date := (now() at time zone 'utc')::date; v_ids uuid[]; v_total int; v_active int; v_completed int;
  v_overdue_tasks int; v_open_tasks int; v_completion numeric; v_inserted int := 0;
  v_cycle numeric; v_cycle_n int := 0; v_overdue_closures int := 0; v_closed int := 0; v_with_lessons int := 0;
  v_delivered_open int := 0; v_closure_rows int := 0;
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

  -- ── 6C: مؤشّرات الإغلاق (معزولة تمامًا — غياب 5C لا يُسقط اللقطة) ──────────
  begin
    -- مؤشّرات الإغلاق على مستوى الشركة لا تُقيَّد بـv_ids (كل المشاريع غير المحذوفة):
    -- الأرشفة حذف ناعم، فتقييدها بها يُسقط المشاريع التي أكملت دورة الإغلاق فعلًا.
    select round(avg(extract(epoch from (c.actual_closure_date - c.requested_at))/86400.0)::numeric, 1), count(*)
      into v_cycle, v_cycle_n
    from public.project_closure_requests c
    where coalesce(c.is_deleted,false)=false
      and c.actual_closure_date is not null and c.actual_closure_date > c.requested_at;

    select count(*) into v_overdue_closures from public.project_closure_requests c
    where c.project_id = any(v_ids) and coalesce(c.is_deleted,false)=false
      and c.planned_closure_date is not null and c.planned_closure_date < v_date
      and c.status not in ('closed','cancelled','rejected');

    select count(*) into v_closed from public.project_core pc
      where pc.core_stage = 'closed';
    select count(*) into v_with_lessons from public.project_core pc
      where pc.core_stage = 'closed'
        and exists (select 1 from public.project_lessons_learned l
                    where l.project_id = pc.project_id and coalesce(l.is_deleted,false)=false);

    select count(*) into v_delivered_open from public.project_core pc
      where pc.project_id = any(v_ids) and pc.core_stage = 'delivered'
        and not exists (select 1 from public.project_closure_requests c
                        where c.project_id = pc.project_id and coalesce(c.is_deleted,false)=false
                          and c.status in ('draft','submitted','under_review','changes_requested','approved'));

    insert into public.executive_kpi_snapshots (snapshot_date, period_type, scope_key, kpi_key, value, sample_size, numerator, denominator)
    values
      -- sample_size = عدد طلبات الإغلاق المُحتسَبة فعلًا، لا كل المشاريع (وإلّا كذب حجم العيّنة)
      (v_date, p_period, 'company', 'closure_cycle_time', v_cycle, v_cycle_n, null, null),
      (v_date, p_period, 'company', 'overdue_closure_count', v_overdue_closures, v_total, v_overdue_closures, v_total),
      -- المقام صفر ⇒ null (لا 0% مضلِّلة حين لا مشاريع مغلقة بعد)
      (v_date, p_period, 'company', 'lessons_capture_rate',
        case when v_closed>0 then round(v_with_lessons::numeric/v_closed*100,1) else null end, v_closed, v_with_lessons, v_closed),
      (v_date, p_period, 'company', 'delivered_not_closed', v_delivered_open, v_total, v_delivered_open, v_total)
    on conflict (snapshot_date, period_type, scope_key, kpi_key) do update
      set value=excluded.value, sample_size=excluded.sample_size, numerator=excluded.numerator, denominator=excluded.denominator;
    get diagnostics v_closure_rows = row_count;
  exception when others then
    -- أوسع من undefined_table/column عمدًا: أيّ فشل في كتلة الإغلاق يجب ألّا يُسقط لقطة 5B
    -- الأساسية التي كُتبت أعلاه في نفس المعاملة.
    v_closure_rows := 0;
  end;

  return jsonb_build_object('ok',true,'snapshot_date',v_date,'period_type',p_period,
    'rows',v_inserted + v_closure_rows,'closure_rows',v_closure_rows);
end $$;
  $f$;
  execute 'revoke execute on function public.executive_snapshot_capture(text) from public, anon';
  execute 'grant execute on function public.executive_snapshot_capture(text) to authenticated';
end $snap$;

comment on function public.closure_knowledge_register(jsonb) is '6C: سجلّ المعرفة المؤسسي عبر المشاريع (عزل per-row + احترام السرّية).';
comment on function public.executive_closure_metrics(jsonb) is '6C: العدسة التنفيذية للإغلاق (زمن الدورة/المتأخّر/مُسلَّم بلا إغلاق/بانتظار قبول العميل).';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_bad int;
begin
  if to_regprocedure('public.closure_knowledge_register(jsonb)') is null
     or to_regprocedure('public.executive_closure_metrics(jsonb)') is null
    then raise exception '6C FAIL: دوال ناقصة'; end if;
  -- لقطة المؤشّرات: تُفحَص فقط حين تكون 5B مطبّقة (وإلّا فهي خارج نطاق هذه الدفعة)
  if to_regclass('public.executive_kpi_snapshots') is not null then
    if to_regprocedure('public.executive_snapshot_capture(text)') is null
      then raise exception '6C FAIL: لقطة المؤشّرات مفقودة'; end if;
    if position('closure_cycle_time' in pg_get_functiondef('public.executive_snapshot_capture(text)'::regprocedure)) = 0
      then raise exception '6C FAIL: اللقطة بلا مؤشّرات إغلاق'; end if;
  end if;
  -- سجلّ المعرفة يعزل صفًّا بصف (لا بوابة واحدة ثم تجميع الكل)
  if position('pc_can_read_project' in pg_get_functiondef('public.closure_knowledge_register(jsonb)'::regprocedure)) = 0
    then raise exception '6C FAIL: سجلّ المعرفة بلا عزل per-row'; end if;
  if position('confidentiality' in pg_get_functiondef('public.closure_knowledge_register(jsonb)'::regprocedure)) = 0
    then raise exception '6C FAIL: سجلّ المعرفة لا يحترم السرّية'; end if;
  -- الكتالوج: لا صفّ بوحدة فارغة (تكرار حادثة 23502)
  if to_regclass('public.executive_kpi_catalog') is not null then
    select count(*) into v_bad from public.executive_kpi_catalog where unit is null or btrim(unit) = '';
    if v_bad > 0 then raise exception '6C FAIL: % صفًّا في كتالوج المؤشّرات بلا unit', v_bad; end if;
  end if;
  raise notice '6C ✅ نجح الاختبار الذاتي — سجلّ المعرفة/العدسة التنفيذية/مؤشّرات الإغلاق.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
