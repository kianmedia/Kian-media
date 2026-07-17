-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — employee_professions: expose primary_profession_id (RUN ONCE)
--
-- Defect-3 fix support: the admin profession-assignment UI shows each employee's
-- professions as badges and lets an admin pick ONE optional primary. The base
-- admin_list_employees_professions() returned only the profession_ids array, so
-- the UI could not indicate which one is primary. This idempotent patch redefines
-- the function to ALSO return primary_profession_id (the row where is_primary).
--
-- Additive, forward/backward compatible: the old frontend ignores the extra key;
-- the new frontend uses it when present. No grant/RLS change. Safe to run anytime,
-- independent of the financials Phase B lockdown.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.employee_professions') is null then miss := miss || ' employee_professions'; end if;
  if to_regclass('public.professions')          is null then miss := miss || ' professions'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (شغّل employee_professions_RUNME.sql أولاً):%', miss; end if;
end $pf$;

begin;

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
      'profession_ids', coalesce((select jsonb_agg(ep.profession_id) from public.employee_professions ep where ep.profile_id = p.id), '[]'::jsonb),
      'primary_profession_id', (select ep2.profession_id from public.employee_professions ep2 where ep2.profile_id = p.id and ep2.is_primary limit 1)
    ) as row
    from public.profiles p
    where p.staff_role is not null and btrim(p.staff_role) <> ''
  ) x;
  return v;
end $$;

revoke all on function public.admin_list_employees_professions() from public, anon;
grant execute on function public.admin_list_employees_professions() to authenticated;

do $v$
begin
  if to_regprocedure('public.admin_list_employees_professions()') is null then
    raise exception 'فشل: admin_list_employees_professions'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
