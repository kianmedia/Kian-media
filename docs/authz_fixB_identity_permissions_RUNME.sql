-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — إصلاح أمني B · فصل «إدارة المشاريع» عن «إدارة الهويّة والصلاحيات»
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الثغرة (حيّة اليوم) ★
--   سبعُ دوالّ تكتب المهن والصلاحيات والتجاوزات مُبوَّبة على
--       if not (public.is_admin() or public.can_manage_projects()) then ...
--   و`can_manage_projects()` تشمل `staff_role = 'manager'`
--   (project_platform_authz_hardening_RUNME.sql:51) ⇒ **أيّ مدير مشروع يستطيع
--   إعادة كتابة صلاحيات أيّ موظف، وأن يُسند لنفسه أيّ مهنة** — وهذا تصعيد ذاتي
--   دائم لا علاقة له بإدارة المشاريع.
--
-- ★ تصحيح للتدقيق — تحقّقتُ منه قبل الكتابة ★
--   رأس `authz_identity_hardening_s4pre_RUNME.sql` يشير إلى
--   `permission_catalog_RUNME.sql:219` و`:258` بوصفهما موضعَي «إعادة كتابة الصلاحيات».
--   **غير دقيق:** السطران داخل `emp_has_permission` و`emp_can` وهما **قراءة/استقصاء**
--   لا كتابة. مواضع الكتابة الحقيقية هي :392 و:417 و:434 و:450 من الملفّ نفسه،
--   مضافًا إليها `employee_professions_RUNME.sql:290`
--   و`professions_grants_and_hardening_RUNME.sql:41` و`profession_delete_RUNME.sql:31`.
--   هذا الملفّ يعالج مواضع الكتابة السبعة — لا القراءة.
--
-- ★ التغيير ★  سطر التفويض **فقط**. كل سطر آخر منسوخ حرفيًا من التعريف الفائز
--   (بايت ببايت، مُستخرَج آليًا بمدى أسطر ثم استُبدل شرط التفويض وحده):
--     - قبل:  if not (public.is_admin() or public.can_manage_projects()) then
--                raise exception 'not authorized';
--     - بعد:  if not coalesce(public.can_manage_identity(), false) then
--                raise exception 'authorization_denied' using errcode = 'P0003', hint = '…';
--   لم يسقط أيّ حارس: فحوص `sensitivity='sensitive' ⇒ is_owner()` باقية كما هي،
--   ومرشّحات `p.sensitivity = 'normal' or public.is_owner()` باقية كما هي.
--
-- ★ ما لا يفعله ★
--   • لا يغيّر أيّ صيغة (signature) — `create or replace` يحافظ على الصلاحيات
--     الممنوحة، فلا يوجد أيّ `grant`/`revoke` في هذا الملفّ.
--   • لا يمسّ `is_owner()` ولا `is_admin()` ولا `can_manage_projects()` ولا
--     `can_manage_staff()` ولا أيّ سياسة SELECT · لا DROP · لا DELETE · idempotent.
--   • لا يمسّ `admin_bulk_set_profession_permissions` — لا يوجد فيها شرط تفويض
--     إطلاقًا (permission_catalog_RUNME.sql:406-412)؛ جسمها كله
--     `perform public.admin_set_profession_permission(...)` داخل حلقة، فهي ترث
--     البوّابة الجديدة تلقائيًا. تعديلها = تغيير بلا داعٍ.
--   • لا يمسّ دوالّ القراءة (`admin_list_employees_professions`, `emp_effective_access`,
--     `emp_has_permission`, `emp_can`, `emp_profession_ids`) — قرار سياسة منفصل.
--
-- ★ الاعتماد ★  يجب تشغيل `docs/authz_identity_hardening_s4pre_RUNME.sql` أولًا
--   (يُنشئ `public.can_manage_identity()` = `coalesce(public.is_owner(), false)`).
--   الفحص القبْليّ أدناه يمنع التشغيل قبله — وهو ضروري: أجسام plpgsql لا تُتحقَّق
--   وقت الإنشاء، فلو غابت الدالّة لفشلت كل استدعاءات الإدارة وقت التنفيذ.
--
-- ★ أثر تشغيلي يجب أن تقرّه ★  إحصاء الإنتاج: owner_count = 2 و super_admin_count = 0
--   ⇒ بعد التطبيق يقتصر إسناد المهن وتحرير الصلاحيات على حسابَي المالك.
--   تبويب «المهن والصلاحيات» ما يزال ظاهرًا للمدير في الواجهة
--   (app/client-portal/employee/page.tsx:22 يفتحه لـ caps.view === "manager")
--   وسيفشل كل حفظ برسالة authorization_denied حتى تُضيّق الواجهة أيضًا.
--
-- ★ التراجع ★  docs/authz_fixB_identity_permissions_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'can_manage_identity() غير موجودة — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.admin_upsert_profession(jsonb)')                       is null then miss := miss || ' admin_upsert_profession(jsonb)'; end if;
  if to_regprocedure('public.admin_set_employee_professions(uuid,uuid[])')          is null then miss := miss || ' admin_set_employee_professions(uuid,uuid[])'; end if;
  if to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)')   is null then miss := miss || ' admin_set_profession_permission(uuid,text,boolean)'; end if;
  if to_regprocedure('public.admin_copy_profession_permissions(uuid,uuid)')         is null then miss := miss || ' admin_copy_profession_permissions(uuid,uuid)'; end if;
  if to_regprocedure('public.admin_apply_profession_template(uuid,text)')           is null then miss := miss || ' admin_apply_profession_template(uuid,text)'; end if;
  if to_regprocedure('public.admin_set_employee_override(uuid,text,text,text)')     is null then miss := miss || ' admin_set_employee_override(uuid,text,text,text)'; end if;
  if to_regprocedure('public.admin_delete_profession(uuid,boolean)')                is null then miss := miss || ' admin_delete_profession(uuid,boolean)'; end if;
  if miss <> '' then
    raise exception 'دوالّ مفقودة — لا تُشغّل هذا الملفّ على قاعدة غير مُهيّأة:%', miss;
  end if;
end $pf$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · admin_upsert_profession — تعريف المهن وأعلامها
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/professions_grants_and_hardening_RUNME.sql:37 (2026-07-18)
--   يهزم docs/employee_professions_RUNME.sql:241 (2026-07-17) — تعريفان فقط، والأحدث يفوز.
--   إصلاح الأقدم كان سيبدو مُنجَزًا وهو لا شيء.
--   لماذا هي ثغرة: تكتب الأعلام perm_manage_custody / perm_manage_shoots /
--   perm_manage_preproduction / perm_view_all_tasks على أيّ مهنة.
create or replace function public.admin_upsert_profession(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ar text; v_en text;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'تعريف المهن وأعلام صلاحياتها من صلاحيات الهويّة — للمالك فقط / defining professions and their permission flags is owner-only';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · admin_set_employee_professions — إسناد المهن للموظف
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/employee_professions_RUNME.sql:286 — تعريف واحد وحيد في المستودع.
--   لماذا هي ثغرة: لا فحص ذاتيّ فيها إطلاقًا — يستطيع مدير أن يُسند لنفسه أيّ مهنة
--   قائمة، بما فيها مهنة أسندَ لها المالكُ صلاحيات حسّاسة ⇒ تصعيد ذاتي.
--   ★ راجع ملاحظة سير العمل في الرأس — هذه الدالّة هي الوحيدة ذات كلفة تشغيلية.
create or replace function public.admin_set_employee_professions(p_user uuid, p_profession_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid[]; v_first uuid;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'إسناد المهن يمنح حِزَم صلاحيات — للمالك فقط / assigning professions grants permission bundles; owner-only';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · admin_set_profession_permission — منح/سحب صلاحية لمهنة
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/permission_catalog_RUNME.sql:388 — تعريف واحد وحيد.
--   حارس 'sensitive ⇒ is_owner' يبقى حرفيًا (دفاع بالعمق، صار زائدًا لا بديلًا).
create or replace function public.admin_set_profession_permission(p_profession uuid, p_key text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'تعديل صلاحيات المهنة للمالك فقط / changing profession permissions is owner-only';
  end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · admin_copy_profession_permissions — نسخ صلاحيات مهنة
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/permission_catalog_RUNME.sql:414 — تعريف واحد وحيد.
--   مرشّح الحساسية (p.sensitivity = 'normal' or public.is_owner()) يبقى حرفيًا.
create or replace function public.admin_copy_profession_permissions(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'نسخ صلاحيات المهن للمالك فقط / copying profession permissions is owner-only';
  end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 · admin_apply_profession_template — تطبيق قالب صلاحيات
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/permission_catalog_RUNME.sql:430 — تعريف واحد وحيد.
create or replace function public.admin_apply_profession_template(p_profession uuid, p_template text)
returns void language plpgsql security definer set search_path = public as $$
declare keys text[];
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'تطبيق قوالب الصلاحيات للمالك فقط / applying permission templates is owner-only';
  end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §6 · admin_set_employee_override — تجاوز صلاحية لموظف بعينه
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/permission_catalog_RUNME.sql:446 — تعريف واحد وحيد.
--   أخطر الدوالّ: تكتب allow/deny مباشرة على مستخدم بعينه، وتتجاوز المهن كلها.
create or replace function public.admin_set_employee_override(p_user uuid, p_key text, p_effect text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'تجاوزات صلاحيات الموظف للمالك فقط / employee permission overrides are owner-only';
  end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §7 · admin_delete_profession — حذف/أرشفة مهنة
-- ─────────────────────────────────────────────────────────────────────────────
--   التعريف الفائز: docs/profession_delete_RUNME.sql:27 — تعريف واحد وحيد.
--   لم تكن في قائمة المهمّة — وجدها المسح الواسع للكتابات على جداول المهن.
--   حذف/أرشفة مهنة يسحب صلاحياتها من كل حامليها ⇒ تلاعب بالصلاحيات (وحرمان خدمة).
create or replace function public.admin_delete_profession(p_id uuid, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp int := 0; v_task int := 0; v_key text;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'حذف أو أرشفة مهنة يغيّر صلاحيات كل من يحملها — للمالك فقط / deleting or archiving a profession changes permissions for all holders; owner-only';
  end if;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- §8 · فحص ذاتي داخل المعاملة — الفصل تحقّق، ولم يسقط أيّ حارس
-- ─────────────────────────────────────────────────────────────────────────────
do $verify$
declare
  sigs text[] := array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_copy_profession_permissions(uuid,uuid)',
    'public.admin_apply_profession_template(uuid,text)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ];
  s text; d text;
begin
  foreach s in array sigs loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d ilike '%can_manage_projects%' then
      raise exception 'فشل: % ما زالت تقبل can_manage_projects — الفصل لم يتحقّق', s;
    end if;
    if d not ilike '%can_manage_identity%' then
      raise exception 'فشل: % لا تستدعي can_manage_identity', s;
    end if;
    if d not like '%authorization_denied%' then
      raise exception 'فشل: % بلا رسالة authorization_denied', s;
    end if;
    if has_function_privilege('anon', s, 'execute') then
      raise warning '⚠️ أمني: anon يملك EXECUTE على % — خارج نطاق هذا الإصلاح، عالِجه بملفّ منح مستقل', s;
    end if;
  end loop;

  -- كل حارس أصليّ يجب أن يبقى — إسقاط أحدها بالخطأ أسوأ من الثغرة نفسها.
  d := pg_get_functiondef(to_regprocedure('public.admin_upsert_profession(jsonb)'));
  if d not like '%المفتاح مستخدم بالفعل%'   then raise exception 'فشل: سقط فحص تكرار المفتاح'; end if;
  if d not like '%perm_manage_custody%'      then raise exception 'فشل: سقطت أعلام الصلاحيات'; end if;
  if d not like '%exception when others then null%' then raise exception 'فشل: سقط تأمين التدقيق'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_employee_professions(uuid,uuid[])'));
  if d not like '%الموظف غير موجود%'          then raise exception 'فشل: سقط فحص وجود الموظف'; end if;
  if d not like '%employee.professions_changed%' then raise exception 'فشل: سقط سجل التدقيق'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'));
  if d not like '%system_only%'  then raise exception 'فشل: سقط منع الصلاحيات النظامية'; end if;
  if d not like '%is_owner%'     then raise exception 'فشل: سقط حارس الصلاحيات الحسّاسة'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_copy_profession_permissions(uuid,uuid)'));
  if d not like '%is_owner%'     then raise exception 'فشل: سقط مرشّح الحساسية في النسخ'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_apply_profession_template(uuid,text)'));
  if d not like '%permission_template_keys%' then raise exception 'فشل: سقط مصدر القالب'; end if;
  if d not like '%is_owner%'     then raise exception 'فشل: سقط مرشّح الحساسية في القالب'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_employee_override(uuid,text,text,text)'));
  if d not like '%system_only%'  then raise exception 'فشل: سقط منع تجاوز الصلاحيات النظامية'; end if;
  if d not like '%is_owner%'     then raise exception 'فشل: سقط حارس منح الحسّاس لموظف'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_delete_profession(uuid,boolean)'));
  if d not like '%requires_confirm%' then raise exception 'فشل: سقط طلب التأكيد'; end if;
  if d not like '%is_active = false%' then raise exception 'فشل: سقطت الأرشفة بدل الحذف'; end if;

  -- الدالّة المُهملة عمدًا: ترث البوّابة عبر الاستدعاء، ولا يجوز أن تكتب مباشرة.
  d := pg_get_functiondef(to_regprocedure('public.admin_bulk_set_profession_permissions(uuid,text[],boolean)'));
  if d ilike '%insert into%' then
    raise exception 'فشل: admin_bulk_set_profession_permissions صارت تكتب مباشرة — لم تعد ترث البوّابة';
  end if;

  raise notice '✓ إصلاح B: سبع دوالّ هويّة/صلاحيات صارت للمالك فقط · لا حارس ساقط';
  raise notice '  ⚠️ ضيّق الواجهة أيضًا (app/client-portal/employee/page.tsx:22) وإلا رأى المدير تبويبًا يفشل عند الحفظ';
end $verify$;

notify pgrst, 'reload schema';
commit;