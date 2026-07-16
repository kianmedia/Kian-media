-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — FINAL COMPLETION HOTFIX
-- يُشغَّل مرة واحدة فوق project_core_FINAL_RUNME.sql + project_core_UI_COMPLETION_RUNME.sql
-- المطبَّقَين. Idempotent · Production-safe · لا حذف بيانات · لا Foundation · لا Fixtures
-- · لا تعديل هدّام للتأجير/العهدة (قراءة آمنة فقط لحارس الحذف).
--
-- يضيف: تعديل المشروع الكامل (Optimistic Lock + عزل حقول حسب الدور) · حذف/أرشفة/
-- استعادة ناعمة بحرّاس (عهدة نشطة) + Audit + إشعارات · متطلبات انتقال المرحلة
-- (Checklist) · قائمة المحذوفة/المؤرشفة.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ═══ 0) أعمدة الحذف/الأرشفة (idempotent) — projects لديه is_deleted/deleted_at/deleted_by مسبقًا ═══
alter table public.projects add column if not exists delete_reason  text;
alter table public.projects add column if not exists archived_at    timestamptz;
alter table public.projects add column if not exists archived_by    uuid references auth.users(id);
alter table public.projects add column if not exists archive_reason text;

-- ═══ 1) تعديل المشروع الكامل — Optimistic Lock + عزل الحقول حسب الدور ═══
create or replace function public.project_core_update_project(
  p_project_id uuid, p_expected_updated_at timestamptz, p_patch jsonb, p_reason text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_upd timestamptz; v_fin boolean; v_own boolean;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project_id) then raise exception 'not authorized'; end if;
  if exists (select 1 from public.projects where id = p_project_id and is_deleted = true) then raise exception 'not_found'; end if; -- لا تعديل لمحذوف/مؤرشف
  v_fin := public.can_manage_projects() or public.can_see_financials();
  v_own := public.is_owner();
  -- قفل صفّ الملخّص + فحص التزامن (منع الكتابة فوق تعديل مستخدم آخر).
  select updated_at into v_upd from public.project_core where project_id = p_project_id for update;
  if v_upd is null then
    insert into public.project_core(project_id, updated_by) values (p_project_id, auth.uid()) on conflict do nothing;
  elsif p_expected_updated_at is not null and v_upd <> p_expected_updated_at then
    raise exception 'stale_update';   -- تغيّر السجل منذ آخر تحميل
  end if;

  -- حقول جدول المشاريع (اسم/وصف/ملاحظة داخلية؛ العميل للمالك فقط).
  update public.projects set
    project_name        = coalesce(nullif(btrim(p_patch->>'project_name'),''), project_name),
    notes               = case when p_patch ? 'description' then nullif(btrim(p_patch->>'description'),'') else notes end,
    admin_note_internal = case when public.can_manage_projects() and p_patch ? 'admin_note_internal' then nullif(btrim(p_patch->>'admin_note_internal'),'') else admin_note_internal end,
    client_id           = case when v_own and nullif(p_patch->>'client_id','') is not null
                               and exists (select 1 from public.clients c where c.id = (p_patch->>'client_id')::uuid and c.is_deleted = false)
                               then (p_patch->>'client_id')::uuid else client_id end
    where id = p_project_id and is_deleted = false;

  -- حقول الملخّص التشغيلي/المالي.
  update public.project_core set
    priority       = coalesce(nullif(p_patch->>'priority','')::text, priority),
    health         = coalesce(nullif(p_patch->>'health','')::text, health),
    start_date     = case when p_patch ? 'start_date'    then nullif(p_patch->>'start_date','')::date    else start_date end,
    due_date       = case when p_patch ? 'due_date'      then nullif(p_patch->>'due_date','')::date      else due_date end,
    delivery_date  = case when p_patch ? 'delivery_date' then nullif(p_patch->>'delivery_date','')::date else delivery_date end,
    project_type   = case when p_patch ? 'project_type'  then nullif(btrim(p_patch->>'project_type'),'')  else project_type end,
    currency       = coalesce(nullif(p_patch->>'currency','')::text, currency),
    budget_amount  = case when v_fin and p_patch ? 'budget_amount'  then nullif(p_patch->>'budget_amount','')::numeric  else budget_amount end,
    estimated_cost = case when v_fin and p_patch ? 'estimated_cost' then nullif(p_patch->>'estimated_cost','')::numeric else estimated_cost end,
    updated_at = now(), updated_by = auth.uid()
    where project_id = p_project_id returning * into r;

  perform public.pc_log(p_project_id, 'project_edited', 'project', p_project_id,
    (p_patch - 'budget_amount' - 'estimated_cost' - 'actual_cost') || jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),'')));
  return r;
end $$;

-- ═══ 2) حذف/أرشفة/استعادة ناعمة ═══
-- حارس مشترك: هل للمشروع عهدة نشطة (قراءة آمنة للنظام الحالي إن وُجد)؟
create or replace function public.pc_has_active_custody(p_project uuid)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare v boolean := false;
begin
  if to_regclass('public.custody_inventory_assignments') is not null then
    execute 'select exists (select 1 from public.custody_inventory_assignments
      where project_id = $1 and is_deleted = false
        and status in (''pending_employee_confirmation'',''active'',''return_requested'',''under_inspection'',''partially_returned''))'
      into v using p_project;
  end if;
  return coalesce(v,false);
end $$;

create or replace function public.project_core_soft_delete_project(p_project_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;   -- owner/super_admin/admin فقط
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.projects where id = p_project_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.is_deleted and r.archived_at is null then return jsonb_build_object('ok', true, 'noop', true); end if;   -- محذوف مسبقًا (المؤرشف يُحوَّل)
  if public.pc_has_active_custody(p_project_id) then raise exception 'active_custody'; end if;
  update public.projects set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = left(p_reason,500), archived_at = null, archived_by = null, archive_reason = null
    where id = p_project_id;
  perform public.pc_log(p_project_id, 'project_deleted', 'project', p_project_id, jsonb_build_object('reason', left(p_reason,500)));
  perform public.pc_notify_team(p_project_id, 'project_status_changed', 'project', p_project_id,
    'حُذف المشروع '||coalesce(r.project_name,''), 'Project deleted', auth.uid());
  return jsonb_build_object('ok', true, 'status', 'deleted');
end $$;

create or replace function public.project_core_archive_project(p_project_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;   -- الأرشفة للإدارة
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.projects where id = p_project_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.is_deleted and r.archived_at is not null then return jsonb_build_object('ok', true, 'noop', true); end if;   -- مؤرشف مسبقًا (المحذوف يُحوَّل)
  update public.projects set is_deleted = true, archived_at = now(), archived_by = auth.uid(),
    archive_reason = left(p_reason,500), deleted_at = null, deleted_by = null, delete_reason = null
    where id = p_project_id;
  perform public.pc_log(p_project_id, 'project_archived', 'project', p_project_id, jsonb_build_object('reason', left(p_reason,500)));
  perform public.pc_notify_team(p_project_id, 'project_status_changed', 'project', p_project_id,
    'أُرشِف المشروع '||coalesce(r.project_name,''), 'Project archived', auth.uid());
  return jsonb_build_object('ok', true, 'status', 'archived');
end $$;

create or replace function public.project_core_restore_project(p_project_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  select * into r from public.projects where id = p_project_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not r.is_deleted then return jsonb_build_object('ok', true, 'noop', true); end if;   -- Idempotent
  update public.projects set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null,
    archived_at = null, archived_by = null, archive_reason = null where id = p_project_id;
  perform public.pc_log(p_project_id, 'project_restored', 'project', p_project_id, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason,'')),'')));
  perform public.pc_notify_team(p_project_id, 'project_status_changed', 'project', p_project_id,
    'اُستعيد المشروع '||coalesce(r.project_name,''), 'Project restored', auth.uid());
  return jsonb_build_object('ok', true, 'status', 'restored');
end $$;

-- ═══ 3) قائمة المحذوفة/المؤرشفة ═══
create or replace function public.project_core_deleted_list()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'project_name', p.project_name,
    'client_name', nullif(btrim(coalesce(cl.full_name, cl.company)),''),
    'kind', case when p.archived_at is not null then 'archived' else 'deleted' end,
    'reason', coalesce(p.delete_reason, p.archive_reason),
    'at', coalesce(p.deleted_at, p.archived_at)
  ) order by coalesce(p.deleted_at, p.archived_at) desc), '[]'::jsonb) into v
  from public.projects p left join public.clients cl on cl.id = p.client_id
  where p.is_deleted = true
    and (public.staff_reads_all_projects() or exists (
      select 1 from public.project_members m where m.project_id = p.id and m.user_id = auth.uid() and m.is_deleted = false));
  return v;
end $$;

-- ═══ 4) متطلبات انتقال المرحلة (Checklist إرشادي — set_stage يفرض الأساسي) ═══
create or replace function public.project_core_stage_requirements(p_project_id uuid, p_target text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare miss jsonb := '[]'::jsonb;
  has_mgr boolean; has_due boolean; team_n int; dlv_n int; dlv_prev_n int; shoot_n int; shoot_done int; open_tasks int; pend_app int;
begin
  if not public.is_staff() or not public.can_access_project(p_project_id) then
    if not public.staff_reads_all_projects() then raise exception 'not authorized'; end if;
  end if;
  select exists (select 1 from public.project_members m where m.project_id=p_project_id and m.role='kian_manager' and m.is_deleted=false) into has_mgr;
  select exists (select 1 from public.project_core pc where pc.project_id=p_project_id and pc.due_date is not null) into has_due;
  select count(*) from public.project_members m where m.project_id=p_project_id and m.role like 'kian_%' and m.is_deleted=false into team_n;
  select count(*) from public.deliverables d where d.project_id=p_project_id and d.is_deleted=false into dlv_n;
  select count(*) from public.deliverables d where d.project_id=p_project_id and d.is_deleted=false and coalesce(d.preview_url,'')<>'' into dlv_prev_n;
  select count(*) from public.project_shoot_sessions s where s.project_id=p_project_id and s.is_deleted=false into shoot_n;
  select count(*) from public.project_shoot_sessions s where s.project_id=p_project_id and s.is_deleted=false and s.status='completed' into shoot_done;
  select count(*) from public.project_tasks t where t.project_id=p_project_id and t.is_deleted=false and t.status not in ('done','cancelled') into open_tasks;
  select count(*) from public.project_approvals a where a.project_id=p_project_id and a.status='pending' into pend_app;

  if p_target = 'ready' then
    if not has_mgr then miss := miss || jsonb_build_object('key','manager','ar','تعيين مدير مشروع','en','Assign a project manager'); end if;
    if not has_due then miss := miss || jsonb_build_object('key','due','ar','تحديد موعد نهائي','en','Set a due date'); end if;
    if team_n < 1 then miss := miss || jsonb_build_object('key','team','ar','إضافة عضو فريق واحد على الأقل','en','Add at least one team member'); end if;
    if dlv_n < 1 then miss := miss || jsonb_build_object('key','deliverables','ar','تحديد مخرج واحد على الأقل','en','Define at least one deliverable'); end if;
  elsif p_target = 'scheduled' then
    if shoot_n < 1 and not has_due then miss := miss || jsonb_build_object('key','schedule','ar','جلسة تصوير أو موعد تنفيذ','en','A shoot session or an execution date'); end if;
    if not has_mgr then miss := miss || jsonb_build_object('key','manager','ar','تعيين مسؤول (مدير مشروع)','en','Assign a responsible manager'); end if;
  elsif p_target = 'in_production' then
    if team_n < 1 then miss := miss || jsonb_build_object('key','team','ar','تحديد الفريق','en','Assign the crew'); end if;
  elsif p_target = 'post_production' then
    if shoot_n > 0 and shoot_done < 1 then miss := miss || jsonb_build_object('key','shoot_done','ar','إكمال جلسة تصوير واحدة على الأقل','en','Complete at least one shoot session'); end if;
  elsif p_target = 'internal_review' then
    if dlv_n < 1 then miss := miss || jsonb_build_object('key','deliverable','ar','نسخة مراجعة داخلية (مخرج)','en','An internal review deliverable'); end if;
  elsif p_target = 'client_review' then
    if dlv_prev_n < 1 then miss := miss || jsonb_build_object('key','preview','ar','مخرج مع رابط معاينة','en','A deliverable with a preview link'); end if;
  elsif p_target = 'closed' then
    if open_tasks > 0 then miss := miss || jsonb_build_object('key','tasks','ar','إغلاق المهام المفتوحة ('||open_tasks||')','en','Close open tasks ('||open_tasks||')'); end if;
    if pend_app > 0 then miss := miss || jsonb_build_object('key','approvals','ar','إنهاء الاعتمادات المعلّقة ('||pend_app||')','en','Resolve pending approvals ('||pend_app||')'); end if;
    if public.pc_has_active_custody(p_project_id) then miss := miss || jsonb_build_object('key','custody','ar','إغلاق العهدة/المعدات النشطة','en','Close active custody/equipment'); end if;
  end if;

  return jsonb_build_object('ok', jsonb_array_length(miss) = 0, 'missing', miss);
end $$;

-- ═══ 5) الصلاحيات ═══
do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'project_core_update_project(uuid,timestamptz,jsonb,text)',
    'project_core_soft_delete_project(uuid,text)','project_core_archive_project(uuid,text)',
    'project_core_restore_project(uuid,text)','project_core_deleted_list()',
    'project_core_stage_requirements(uuid,text)','pc_has_active_custody(uuid)'
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
-- (أ) الأعمدة الجديدة موجودة (المتوقع 4):
select column_name from information_schema.columns
 where table_name='projects' and column_name in ('delete_reason','archived_at','archived_by','archive_reason') order by 1;
-- (ب) الدوال + صلاحية authenticated + منع anon:
select proname, has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') an
  from pg_proc where proname in ('project_core_update_project','project_core_soft_delete_project',
    'project_core_archive_project','project_core_restore_project','project_core_deleted_list','project_core_stage_requirements')
  order by proname;
-- (ج) نسخة واحدة من كل دالة (لا Overload):
select proname, count(*) from pg_proc where proname in ('project_core_update_project','project_core_soft_delete_project',
  'project_core_archive_project','project_core_restore_project') group by proname;
