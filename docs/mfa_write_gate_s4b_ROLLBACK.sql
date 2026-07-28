-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع S4b · فكّ بوّابة MFA عن الدوالّ السبع — **مع إبقاء إصلاحَي A و B**
-- docs/mfa_write_gate_s4b_bind_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ ما يستعيده هذا الملفّ بالضبط ★
--   أجسام **ما بعد إصلاح A وإصلاح B** بلا سطر البوّابة — لا التعاريف الأصلية.
--     1. admin_set_staff_role            ← docs/authz_fixA_super_admin_grant_RUNME.sql:48-77
--                                           (= الفائز portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39
--                                              + فحص الدور المُمنَح)
--     2. admin_set_account               ← docs/phase1_addendum_s1.sql:136-170 (التعريف الوحيد؛
--                                           لا يمسّه أيّ إصلاح، فهو حاله قبل S4b وبعده)
--     3. admin_upsert_profession         ← docs/authz_fixB_identity_permissions_RUNME.sql:85
--     4. admin_set_employee_professions  ← docs/authz_fixB_identity_permissions_RUNME.sql:145
--     5. admin_set_profession_permission ← docs/authz_fixB_identity_permissions_RUNME.sql:184
--     6. admin_set_employee_override     ← docs/authz_fixB_identity_permissions_RUNME.sql:257
--     7. admin_delete_profession         ← docs/authz_fixB_identity_permissions_RUNME.sql:288
--
-- ★★ هذا الملفّ **لا يُلغي** إصلاح A ولا إصلاح B ★★
--   فحص الدور المُمنَح (role_change_denied) باقٍ · بوّابة can_manage_identity باقية
--   على الخمس · can_manage_projects تبقى **غير** مقبولة. والفحص الذاتي في §8
--   يُجهض التراجع كلّه إن سقط أيّ منهما.
--
-- ★ ما يُفقد بتشغيله — بصراحة ★
--   يزول اشتراط aal2 عن سبع عمليات كتابة حسّاسة: إسناد الأدوار الوظيفية، تغيير
--   نوع/حالة الحساب، تعريف المهن وأعلامها، إسناد المهن، منح صلاحيات المهن، تجاوزات
--   صلاحيات الموظف، وحذف/أرشفة المهن. عمليًّا: **جلسة إداريّ مسروقة عند aal1
--   (كوكي/توكن) تستطيع مجدّدًا تعديل الأدوار والصلاحيات بلا إثبات حيازة الجهاز.**
--   ما يبقى هو التفويض وحده (المالك فقط) — وهو ما كان قائمًا قبل S4b.
--
-- ★ هل يجب التراجع عن S4a أيضًا؟ ★  **لا.**
--   بعد تشغيل هذا الملفّ لا يبقى أيّ مستدعٍ لـ mfa_require_aal2، و mfa_write_ok
--   مُسنِد خامل لا يُغيّر شيئًا بمفرده. إبقاؤهما يجعل إعادة الربط لاحقًا خطوة واحدة.
--   ولا تتراجع عن s4pre: can_manage_identity() اعتمادية حيّة لإصلاح B و
--   assert_can_grant_role — إزالتها تكسر الخمس وقت التنفيذ.
--
-- ★ الترتيب الصحيح للتراجع ★
--   1. **هذا الملفّ وحده** — وهو كافٍ في كل الحالات تقريبًا.
--   2. إن كان الهدف مجرّد إيقاف الفرض فورًا بلا نشر SQL، فالأسرع والأسلم:
--          update public.mfa_settings set enforcement_mode = 'off' where id = 1;
--      (mfa_write_ok الخطوة 2 ⇒ البوّابة تسمح للجميع فورًا، بلا تعديل أيّ دالّة.)
--      ★ جرّب هذا أولًا. ★ لا تُشغّل هذا الملفّ إلّا إن أردت نزع الربط نهائيًّا.
--   3. لا تُشغّل authz_fixA/authz_fixB ROLLBACK إلّا بقرار منفصل ومُبرَّر — فهما
--      يُعيدان فتح ثغرتَي تصعيد الصلاحيات، وهذا أخطر بكثير من فقدان MFA.
--
-- ★ السلامة ★  create or replace فقط · لا DROP · لا حذف · لا grant/revoke
--   · لا مساس بسياسات SELECT · idempotent · معاملة واحدة.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $pf$
begin
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'رفض: can_manage_identity() غير موجودة — التراجع سيكسر الدوالّ الخمس وقت التنفيذ. لا تُزل s4pre';
  end if;
  raise warning '⚠️ تراجع S4b: سيزول اشتراط aal2 عن سبع عمليات كتابة حسّاسة. إصلاحا A و B يبقيان.';
end $pf$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · admin_set_staff_role — جسم ما بعد إصلاح A، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_staff() then raise exception 'owner only'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own staff role'; end if;
  if p_role is not null and p_role <> all (array[
       'super_admin','manager','support','editor','sales','hr','readonly','finance',
       'photographer','lighting_tech','camera_assistant','custody_officer']) then
    raise exception 'invalid staff role: %', p_role;
  end if;

  -- ★★ الإضافة الوحيدة — فحص الدور المُمنَح، لا حالة الهدف ★★
  -- منح `super_admin` = صناعة مالك جديد (is_owner() يشمله). لذلك يقتصر على المالك
  -- الحقيقي. بدونه يستطيع أيّ super_admin أن يصنع super_admin آخر بلا نهاية.
  if p_role = 'super_admin' and not exists (
       select 1 from public.profiles
        where id = auth.uid() and account_type = 'admin' and account_status = 'active') then
    raise exception 'role_change_denied' using errcode = 'P0003',
      hint = 'منح صلاحية المالك مقصور على حساب المالك / granting owner-level is owner-only';
  end if;

  if exists (select 1 from public.profiles where id = p_user
             and (account_type = 'admin' or staff_role = 'super_admin')) then
    raise exception 'protected owner account';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · admin_set_account — التعريف الوحيد (phase1_addendum_s1.sql:136)، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_account(
  p_user uuid, p_type text default null, p_status text default null,
  p_level text default null, p_company uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_type is not null and p_type <> all (array['lead','client','admin']) then
    raise exception 'invalid account_type: %', p_type;
  end if;
  if p_status is not null and p_status <> all (array['active','inactive','blocked']) then
    raise exception 'invalid account_status: %', p_status;
  end if;
  if p_level is not null and p_level <> all (array['prospect','active','vip']) then
    raise exception 'invalid client_level: %', p_level;
  end if;
  if p_type = 'admin' and not exists (
       select 1 from public.profiles
       where id = p_user
         and lower(email) in ('kianalebtikar@gmail.com','manager@kianmedia.com')) then
    raise exception 'admin role is restricted to the two approved emails (see PORTAL_ROADMAP §1)';
  end if;
  if p_company is not null and not exists (
       select 1 from public.companies where id = p_company and is_deleted = false) then
    raise exception 'company not found or deleted';
  end if;
  update public.profiles
     set account_type   = coalesce(p_type,   account_type),
         account_status = coalesce(p_status, account_status),
         client_level   = coalesce(p_level,  client_level),
         company_id     = coalesce(p_company, company_id)
   where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · admin_upsert_profession — جسم ما بعد إصلاح B، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
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
-- §4 · admin_set_employee_professions — جسم ما بعد إصلاح B، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
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
-- §5 · admin_set_profession_permission — جسم ما بعد إصلاح B، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
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
-- §6 · admin_set_employee_override — جسم ما بعد إصلاح B، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
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
-- §7 · admin_delete_profession — جسم ما بعد إصلاح B، بلا بوّابة
-- ─────────────────────────────────────────────────────────────────────────────
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
-- §8 · فحص ذاتي — البوّابة زالت، وإصلاحا A و B **لم** يُلغَيا
-- ─────────────────────────────────────────────────────────────────────────────
do $vfy$
declare
  sigs text[] := array[
    'public.admin_set_staff_role(uuid,text)',
    'public.admin_set_account(uuid,text,text,text,uuid)',
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ];
  s text; d text;
begin
  foreach s in array sigs loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d ilike '%mfa_require_aal2%' then
      raise exception 'فشل: البوّابة ما زالت في % — التراجع لم يكتمل', s;
    end if;
  end loop;

  -- إصلاح A حيّ
  d := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if d not like '%role_change_denied%'                then raise exception 'فشل: التراجع ألغى إصلاح A'; end if;
  if d not like '%can_manage_staff%'                  then raise exception 'فشل: سقطت بوّابة can_manage_staff'; end if;
  if d not like '%cannot change your own staff role%' then raise exception 'فشل: سقط منع التغيير الذاتي'; end if;
  if d not like '%protected owner account%'           then raise exception 'فشل: سقطت حماية الحساب المالك'; end if;
  if d not like '%custody_officer%'                   then raise exception 'فشل: سقطت قائمة الأدوار الـ12'; end if;

  -- admin_set_account كما كان
  d := pg_get_functiondef(to_regprocedure('public.admin_set_account(uuid,text,text,text,uuid)'));
  if d not like '%admin only%'                   then raise exception 'فشل: سقطت بوّابة is_admin'; end if;
  if d not like '%two approved emails%'          then raise exception 'فشل: سقط قصر admin على البريدَين'; end if;
  if d not like '%company not found or deleted%' then raise exception 'فشل: سقط فحص الشركة'; end if;

  -- إصلاح B حيّ على الخمس
  foreach s in array array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ] loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d not like '%can_manage_identity%' then raise exception 'فشل: التراجع ألغى إصلاح B على %', s; end if;
    if d ilike  '%can_manage_projects%'   then raise exception 'فشل: % عادت تقبل can_manage_projects', s; end if;
  end loop;

  -- المُسنِد باقٍ عمدًا وخامل
  if to_regprocedure('public.mfa_require_aal2(text)') is null then
    raise notice '⚠️ mfa_require_aal2 غير موجودة — إعادة الربط لاحقًا تحتاج تشغيل S4a من جديد';
  end if;

  raise warning '⚠️ تمّ التراجع: سبع عمليات كتابة حسّاسة لم تعد تشترط aal2. إصلاحا A و B سليمان.';
  raise notice  '✓ لم يُلغَ إصلاح A ولا إصلاح B · لا حاجة للتراجع عن S4a ولا عن s4pre';
end $vfy$;

commit;

notify pgrst, 'reload schema';