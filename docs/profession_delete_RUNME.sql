-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PROFESSION DELETE / ARCHIVE (RUN ONCE)  [P0-1]
--
-- admin_delete_profession(id, confirm) — safe removal of a CUSTOM profession:
--   • unassigned  → hard delete
--   • assigned to employees/tasks and NOT confirmed → returns the affected counts
--     (no change) so the UI can require explicit confirmation
--   • assigned and confirmed → ARCHIVE (is_active=false) — never silently orphans
--     tasks; employee_professions history and task links are preserved
-- Archive keeps a profession out of NEW assignment pickers (they filter is_active);
-- restoring is is_active=true via admin_upsert_profession. Every action is audited.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.professions')          is null then miss := miss || ' professions'; end if;
  if to_regclass('public.employee_professions') is null then miss := miss || ' employee_professions'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

create or replace function public.admin_delete_profession(p_id uuid, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp int := 0; v_task int := 0; v_key text;
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select key into v_key from public.professions where id = p_id;
  if v_key is null then raise exception 'المهنة غير موجودة'; end if;

  select count(*) into v_emp from public.employee_professions where profession_id = p_id;
  if to_regclass('public.project_tasks') is not null then
    select count(*) into v_task from public.project_tasks where profession_id = p_id and coalesce(is_deleted,false)=false;
  end if;

  -- Assigned + not confirmed → report the impact, change nothing.
  if (v_emp > 0 or v_task > 0) and not p_confirm then
    return jsonb_build_object('deleted', false, 'requires_confirm', true, 'employees', v_emp, 'tasks', v_task);
  end if;

  if v_emp = 0 and v_task = 0 then
    delete from public.professions where id = p_id;          -- safe hard delete (unassigned)
    perform public.log_activity(auth.uid(), public.staff_role(), 'profession.deleted', 'profession', p_id,
      jsonb_build_object('key', v_key));
    return jsonb_build_object('deleted', true, 'hard', true, 'employees', 0, 'tasks', 0);
  else
    update public.professions set is_active = false, updated_at = now() where id = p_id;  -- archive, keep history
    perform public.log_activity(auth.uid(), public.staff_role(), 'profession.archived', 'profession', p_id,
      jsonb_build_object('key', v_key, 'employees', v_emp, 'tasks', v_task));
    return jsonb_build_object('deleted', true, 'hard', false, 'archived', true, 'employees', v_emp, 'tasks', v_task);
  end if;
end $$;

revoke all on function public.admin_delete_profession(uuid,boolean) from public, anon;
grant execute on function public.admin_delete_profession(uuid,boolean) to authenticated;

do $v$
begin
  if to_regprocedure('public.admin_delete_profession(uuid,boolean)') is null then raise exception 'فشل: admin_delete_profession'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
