-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع إصلاح B · إعادة الدوالّ السبع إلى تعريفاتها الحيّة قبل الإصلاح
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ تشغيل هذا الملفّ **يُعيد فتح الثغرة**: يعود أيّ `staff_role = 'manager'`
--    قادرًا على إعادة كتابة صلاحيات أيّ موظف وعلى إسناد المهن لنفسه.
--    لا تُشغّله إلا لاستعادة الخدمة، ثم أعِد تطبيق RUNME فورًا.
--
-- الأجسام أدناه منسوخة بايت ببايت من التعريفات الفائزة (المصدر فوق كل قسم).
-- لا يغيّر أيّ صيغة ولا أيّ منح · idempotent · لا DROP.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── public.admin_upsert_profession(jsonb)  ←  docs/professions_grants_and_hardening_RUNME.sql:37 ──
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

-- ── public.admin_set_employee_professions(uuid,uuid[])  ←  docs/employee_professions_RUNME.sql:286 ──
create or replace function public.admin_set_employee_professions(p_user uuid, p_profession_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid[]; v_first uuid;
begin
  if not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  if p_user is null then raise exception 'p_user مطلوب'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'الموظف غير موجود';
  end if;

  select coalesce(array_agg(profession_id order by profession_id), '{}'::uuid[])
    into v_old from public.employee_professions where profile_id = p_user;

  delete from public.employee_professions
   where profile_id = p_user
     and (p_profession_ids is null or profession_id <> all (p_profession_ids));

  v_first := (p_profession_ids)[1];
  if p_profession_ids is not null then
    insert into public.employee_professions (profile_id, profession_id, is_primary, assigned_by)
    select p_user, pid, (pid = v_first), auth.uid()
    from unnest(p_profession_ids) as pid
    where exists (select 1 from public.professions pr where pr.id = pid)
    on conflict (profile_id, profession_id)
      do update set is_primary = excluded.is_primary, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;

  perform public.log_activity(auth.uid(), public.staff_role(), 'employee.professions_changed',
    'profile', p_user, jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(coalesce(p_profession_ids,'{}'::uuid[]))));
end $$;

-- ── public.admin_set_profession_permission(uuid,text,boolean)  ←  docs/permission_catalog_RUNME.sql:388 ──
create or replace function public.admin_set_profession_permission(p_profession uuid, p_key text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select id, sensitivity into v_perm from public.permissions where key = p_key and enabled;
  if v_perm.id is null then raise exception 'صلاحية غير معروفة: %', p_key; end if;
  if v_perm.sensitivity = 'system_only' then raise exception 'لا يمكن منح صلاحية نظامية عبر المهن'; end if;
  if v_perm.sensitivity = 'sensitive' and p_granted and not public.is_owner() then
    raise exception 'الصلاحيات الحساسة (المالية/الحساسة) يمنحها المالك/السوبر-أدمن فقط';
  end if;
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  values (p_profession, v_perm.id, p_granted, auth.uid())
  on conflict (profession_id, permission_id) do update set granted = excluded.granted, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.permission_changed', 'profession', p_profession,
    jsonb_build_object('key', p_key, 'granted', p_granted));
end $$;

-- ── public.admin_copy_profession_permissions(uuid,uuid)  ←  docs/permission_catalog_RUNME.sql:414 ──
create or replace function public.admin_copy_profession_permissions(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  -- copies non-sensitive grants always; sensitive only if the caller is owner.
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  select p_to, pp.permission_id, pp.granted, auth.uid()
  from public.profession_permissions pp
  join public.permissions p on p.id = pp.permission_id
  where pp.profession_id = p_from and pp.granted
    and (p.sensitivity = 'normal' or public.is_owner())
  on conflict (profession_id, permission_id) do update set granted = excluded.granted, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.permissions_copied', 'profession', p_to,
    jsonb_build_object('from', p_from));
end $$;

-- ── public.admin_apply_profession_template(uuid,text)  ←  docs/permission_catalog_RUNME.sql:430 ──
create or replace function public.admin_apply_profession_template(p_profession uuid, p_template text)
returns void language plpgsql security definer set search_path = public as $$
declare keys text[];
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  keys := public.permission_template_keys(p_template);
  if array_length(keys,1) is null then raise exception 'قالب غير معروف: %', p_template; end if;
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  select p_profession, p.id, true, auth.uid() from public.permissions p
  where p.key = any(keys) and p.sensitivity <> 'system_only'
    and (p.sensitivity = 'normal' or public.is_owner())
  on conflict (profession_id, permission_id) do update set granted = true, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.template_applied', 'profession', p_profession,
    jsonb_build_object('template', p_template));
end $$;

-- ── public.admin_set_employee_override(uuid,text,text,text)  ←  docs/permission_catalog_RUNME.sql:446 ──
create or replace function public.admin_set_employee_override(p_user uuid, p_key text, p_effect text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select id, sensitivity into v_perm from public.permissions where key = p_key;
  if v_perm.id is null then raise exception 'صلاحية غير معروفة: %', p_key; end if;
  if v_perm.sensitivity = 'system_only' then raise exception 'لا يمكن تجاوز صلاحية نظامية'; end if;
  if p_effect is null or p_effect not in ('allow','deny') then   -- clear the override
    delete from public.employee_permission_overrides where user_id = p_user and permission_id = v_perm.id;
  else
    if v_perm.sensitivity = 'sensitive' and p_effect = 'allow' and not public.is_owner() then
      raise exception 'منح صلاحية حساسة لموظف يقتصر على المالك/السوبر-أدمن';
    end if;
    insert into public.employee_permission_overrides (user_id, permission_id, effect, reason, created_by)
    values (p_user, v_perm.id, p_effect, p_reason, auth.uid())
    on conflict (user_id, permission_id) do update set effect = excluded.effect, reason = excluded.reason, created_by = auth.uid(), created_at = now();
  end if;
  perform public.log_activity(auth.uid(), public.staff_role(), 'employee.permission_override', 'profile', p_user,
    jsonb_build_object('key', p_key, 'effect', p_effect));
end $$;

-- ── public.admin_delete_profession(uuid,boolean)  ←  docs/profession_delete_RUNME.sql:27 ──
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

do $verify$
begin
  if pg_get_functiondef(to_regprocedure('public.admin_set_employee_override(uuid,text,text,text)')) ilike '%can_manage_identity%' then
    raise exception 'فشل التراجع: ما زال التعريف الجديد ساريًا';
  end if;
  raise warning '⚠️ التراجع طُبِّق — ثغرة تصعيد صلاحيات المدير مفتوحة مجددًا';
end $verify$;

notify pgrst, 'reload schema';
commit;