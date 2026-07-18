-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PROFESSIONS: MISSING GRANT + RPC HARDENING (RUN ONCE)  [P0-1]
--
-- PROVEN ROOT CAUSE of "profession saved (success) but the list stays empty":
-- employee_professions_RUNME.sql enabled RLS and created read policies on
-- public.professions / public.employee_professions but NEVER granted table-level
-- SELECT to the `authenticated` role. In PostgREST a read needs BOTH a GRANT and a
-- passing RLS policy. Missing the grant → every authenticated read of professions
-- fails with "permission denied for table professions" → the list is empty. But
-- admin_upsert_profession is SECURITY DEFINER, so its INSERT bypasses the grant and
-- COMMITS → the UI shows success while nothing can be read back. This grant is the
-- fix. (Compare: deliverable_versions_RUNME.sql correctly grants select.)
--
-- Also hardens admin_upsert_profession: rejects empty names, rejects a duplicate
-- slug with a clear error, and audits in a non-aborting block so logging can never
-- roll back the insert (defence in depth alongside activity_log_role_hardening).
-- Idempotent & additive.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.professions')          is null then miss := miss || ' professions (شغّل employee_professions_RUNME.sql)'; end if;
  if to_regclass('public.employee_professions') is null then miss := miss || ' employee_professions'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- ── THE FIX: table-level SELECT so the read policies actually take effect ──
grant select on public.professions          to authenticated;
grant select on public.employee_professions to authenticated;

-- ── Harden the write RPC ──
create or replace function public.admin_upsert_profession(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ar text; v_en text;
begin
  if not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  v_id  := nullif(p_data->>'id','')::uuid;
  v_key := btrim(coalesce(p_data->>'key',''));
  v_ar  := btrim(coalesce(p_data->>'name_ar',''));
  v_en  := btrim(coalesce(p_data->>'name_en',''));

  if v_id is null then
    if v_key = '' then raise exception 'مفتاح المهنة مطلوب (slug)'; end if;
    if v_ar = '' and v_en = '' then raise exception 'اسم المهنة مطلوب (عربي أو إنجليزي)'; end if;
    if exists (select 1 from public.professions where key = v_key) then
      raise exception 'المفتاح مستخدم بالفعل: %', v_key;
    end if;
    insert into public.professions (key, name_ar, name_en, description, is_active, sort_order,
        perm_view_all_tasks, perm_manage_preproduction, perm_manage_shoots, perm_manage_custody)
    values (v_key, coalesce(nullif(v_ar,''), v_en), coalesce(nullif(v_en,''), v_ar),
        p_data->>'description', coalesce((p_data->>'is_active')::boolean, true),
        coalesce((p_data->>'sort_order')::int, 100),
        coalesce((p_data->>'perm_view_all_tasks')::boolean, false),
        coalesce((p_data->>'perm_manage_preproduction')::boolean, false),
        coalesce((p_data->>'perm_manage_shoots')::boolean, false),
        coalesce((p_data->>'perm_manage_custody')::boolean, false))
    returning id into v_id;
  else
    update public.professions set
      name_ar     = coalesce(nullif(v_ar,''), name_ar),
      name_en     = coalesce(nullif(v_en,''), name_en),
      description  = coalesce(p_data->>'description', description),
      is_active    = coalesce((p_data->>'is_active')::boolean, is_active),
      sort_order   = coalesce((p_data->>'sort_order')::int, sort_order),
      perm_view_all_tasks       = coalesce((p_data->>'perm_view_all_tasks')::boolean, perm_view_all_tasks),
      perm_manage_preproduction = coalesce((p_data->>'perm_manage_preproduction')::boolean, perm_manage_preproduction),
      perm_manage_shoots        = coalesce((p_data->>'perm_manage_shoots')::boolean, perm_manage_shoots),
      perm_manage_custody       = coalesce((p_data->>'perm_manage_custody')::boolean, perm_manage_custody),
      updated_at   = now()
    where id = v_id;
    if not found then raise exception 'المهنة غير موجودة'; end if;
  end if;

  -- Audit must never roll back the write.
  begin
    perform public.log_activity(auth.uid(), public.staff_role(), 'profession.upserted',
      'profession', v_id, jsonb_build_object('key', v_key));
  exception when others then null; end;
  return v_id;
end $$;

revoke all on function public.admin_upsert_profession(jsonb) from public, anon;
grant execute on function public.admin_upsert_profession(jsonb) to authenticated;

-- ── Ensure the profession backfill from crew staff_role is complete (idempotent) ──
insert into public.professions (key, name_ar, name_en, sort_order)
select distinct p.staff_role, p.staff_role, p.staff_role, 100
from public.profiles p
where p.staff_role is not null and btrim(p.staff_role) <> ''
  and not exists (select 1 from public.professions x where x.key = p.staff_role)
on conflict (key) do nothing;

insert into public.employee_professions (profile_id, profession_id, is_primary)
select p.id, pr.id, true
from public.profiles p
join public.professions pr on pr.key = p.staff_role
where p.staff_role is not null and btrim(p.staff_role) <> ''
on conflict (profile_id, profession_id) do nothing;

do $v$
begin
  if not has_table_privilege('authenticated', 'public.professions', 'SELECT') then
    raise exception 'فشل: ما زال authenticated لا يملك SELECT على professions'; end if;
  if not has_table_privilege('authenticated', 'public.employee_professions', 'SELECT') then
    raise exception 'فشل: employee_professions SELECT'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
