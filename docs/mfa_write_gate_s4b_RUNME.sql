-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S4b · ربط بوّابة الكتابة الحسّاسة بسبع دوالّ — ولا شيء غيرها
-- docs/mfa_write_gate_s4b_bind_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★★ الترتيب إلزاميّ — وهو أخطر ما في هذا الملفّ ★★★
--   يجب تشغيله **بعد** الملفّات التالية، وبهذا الترتيب:
--       1. docs/authz_identity_hardening_s4pre_RUNME.sql   (can_manage_identity)
--       2. docs/authz_fixA_super_admin_grant_RUNME.sql     (فحص الدور المُمنَح)
--       3. docs/authz_fixB_identity_permissions_RUNME.sql  (بوّابة can_manage_identity)
--       4. docs/mfa_write_gate_s4a_RUNME.sql               (mfa_write_ok/mfa_require_aal2)
--       5. **هذا الملفّ**
--   السبب: الربط يتطلّب `create or replace` بالجسم الكامل لكل دالّة. لو بُنيت الأجسام
--   من التعاريف **الأصلية** بدل أجسام ما بعد الإصلاحين، لكان تشغيل هذا الملفّ
--   **يُلغي إصلاح A وإصلاح B صامتًا** — يعيد فتح ثغرتَي تصعيد الصلاحيات بينما يبدو
--   أنه يضيف حماية. هذا أسوأ فشل ممكن هنا.
--   ⇒ الأجسام أدناه منسوخة من **ملفَّي الإصلاح**، لا من التعاريف الأصلية،
--     والفحص القبْليّ (§0/ج و §0/د) **يرفض التشغيل** إن لم يكن الإصلاحان حيَّين.
--
-- ★ التعريف الفائز لكل دالّة — والدليل ★
--   (183 ملفّ SQL في docs/؛ الدوالّ يُعاد تعريفها مرارًا. هذه نتيجة مسح كامل.)
--
--   1) admin_set_staff_role(uuid,text)
--      ستّة تعاريف. الفائز **قبل** الإصلاح:
--        docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39 (2026-07-04، 3def9d6)
--      يهزم staff_roles_task_assignment_RUNME.sql:172 و…_PROPOSAL.sql:178 (2026-06-16، 7 أدوار)
--      و staff_assignment_notifications_finance_ADDENDUM.sql:25 (2026-06-16، 8 أدوار، ورأسه
--      نفسه يقول PROPOSAL — NOT RUN). الدليل الحيّ: الفائز وحده يقبل الأدوار الـ12 التي
--      يشحنها lib/portal/roles.ts:83-97 فعلًا. الملفّ المسمّى باسم الميزة **مهجور**.
--      ★ الجسم المُستخدَم هنا هو جسم **ما بعد إصلاح A**:
--        docs/authz_fixA_super_admin_grant_RUNME.sql:48-77 (يضيف فحص الدور المُمنَح).
--
--   2) admin_set_account(uuid,text,text,text,uuid)
--      **تعريف واحد وحيد** في المستودع: docs/phase1_addendum_s1.sql:136 (2026-06-14).
--      لا إصلاح A ولا B يمسّانها ⇒ جسم «ما بعد الإصلاحين» = الجسم الأصلي حرفيًا.
--
--   3) admin_upsert_profession(jsonb)
--      تعريفان. الفائز قبل الإصلاح: docs/professions_grants_and_hardening_RUNME.sql:37
--      (2026-07-18، 58c6750) يهزم docs/employee_professions_RUNME.sql:241 (2026-07-17).
--      الفارق ليس تجميليًّا: الأقدم بلا فحص مفتاح مكرّر ولا فحص اسم فارغ.
--      ★ الجسم المُستخدَم: ما بعد إصلاح B — authz_fixB_identity_permissions_RUNME.sql:85.
--      (التدقيق أثبت أنها تكتب أعلام perm_* ⇒ كتابة صلاحيات.)
--
--   4) admin_set_employee_professions(uuid,uuid[])
--      تعريف واحد وحيد: docs/employee_professions_RUNME.sql:286.
--      ★ الجسم المُستخدَم: ما بعد إصلاح B — authz_fixB…RUNME.sql:145.
--
--   5) admin_set_profession_permission(uuid,text,boolean)
--      تعريف واحد وحيد: docs/permission_catalog_RUNME.sql:388.
--      ★ الجسم المُستخدَم: ما بعد إصلاح B — authz_fixB…RUNME.sql:184.
--
--   6) admin_set_employee_override(uuid,text,text,text)
--      تعريف واحد وحيد: docs/permission_catalog_RUNME.sql:446.
--      ★ الجسم المُستخدَم: ما بعد إصلاح B — authz_fixB…RUNME.sql:257.
--
--   7) admin_delete_profession(uuid,boolean)
--      تعريف واحد وحيد: docs/profession_delete_RUNME.sql:27.
--      ★ الجسم المُستخدَم: ما بعد إصلاح B — authz_fixB…RUNME.sql:288.
--      (الأرشفة تسحب صلاحيات المهنة من **كل** حامليها ⇒ كتابة صلاحيات جماعية.)
--
-- ★ ما أُضيف — سطر واحد لا غير ★
--       perform public.mfa_require_aal2('<اسم العملية>');
--   بلا تعليق داخل الجسم وبلا أيّ بايت آخر. موضعه في كل دالّة **بعد فحوص التفويض
--   كلّها** حتى يظل غير المُفوَّض يتلقّى خطأ التفويض لا مطالبة MFA:
--       admin_set_staff_role            → بعد «protected owner account»، قبل update
--       admin_set_account               → بعد فحص الشركة، قبل update
--       admin_upsert_profession         → مباشرة بعد بوّابة can_manage_identity
--       admin_set_employee_professions  → بعد فحصَي p_user/وجود الموظف
--       admin_set_profession_permission → بعد فحص 'sensitive ⇒ is_owner'، قبل insert
--       admin_set_employee_override     → بعد فحص system_only، قبل فرعَي الكتابة
--       admin_delete_profession         → بعد الإرجاع التقريري requires_confirm،
--                                          فتبقى **المعاينة** بلا مطالبة، والكتابة مبوَّبة
--
-- ★★ mfa_admin_set_mode **غير مبوَّبة عمدًا — ولا تُبوَّب أبدًا** ★★
--   اشتراط aal2 لتغيير وضع MFA يضع زرّ الطوارئ نفسه خلف القفل الذي يُفترض أن يفتحه:
--   مالكٌ فقد جهاز المصادقة لن يستطيع إطفاء الوضع أبدًا ⇒ إقفال دائم لا مخرج منه.
--   تبقى على is_owner() وحدها (mfa_foundation_batch_s1_RUNME.sql:143). والكلفة الأمنية
--   ضئيلة: 'enforced' ليست قيمة مشروعة في القيد أصلًا (…:63)، فأقصى ما يفعله المهاجم
--   المالك أصلًا هو الرجوع إلى 'off'. الفحص الذاتي في §8 **يفشل** إن وُجدت مبوَّبة.
--   زرّ الطوارئ اليدويّ يبقى كذلك:
--       update public.mfa_settings set enforcement_mode = 'off' where id = 1;
--
-- ★ ما لا يفعله هذا الملفّ ★
--   لا يغيّر أيّ صيغة · لا يُصدر أيّ grant/revoke (create or replace يحافظ عليها)
--   · لا يمسّ is_owner()/is_admin()/can_manage_projects()/can_manage_staff()/
--     mfa_admin_set_mode · لا سياسة SELECT · لا DROP · لا DELETE/TRUNCATE على المستوى
--     الأعلى · idempotent · لا يمسّ admin_copy_profession_permissions ولا
--     admin_apply_profession_template ولا admin_bulk_set_profession_permissions
--     (خارج القائمة السبعة عمدًا).
--
-- ★ أثر تشغيلي ★  enforcement_mode = 'enrollment' اليوم. البوّابة لا تمنع إلّا
--   إداريًّا **يملك عاملًا مُفعَّلًا بنفسه** وجلسته aal1 (mfa_write_ok الخطوة 5).
--   من لم يسجّل عاملًا يمرّ دائمًا ⇒ التطبيق لا يمكن أن يقفل أحدًا اليوم.
--
-- ★ ملاحظة معروفة ★  بعد تطبيق هذا الملفّ يصير docs/mfa_write_gate_s4a_RUNME.sql
--   غير قابل لإعادة التشغيل: فحصه الذاتي (:140-144) يرفع استثناءً إن وجد
--   admin_set_staff_role مبوَّبة — وهو يبلّغ عن **نجاح S4b** بوصفه فشلًا. متوقَّع.
--
-- ★ التراجع ★  docs/mfa_write_gate_s4b_bind_ROLLBACK.sql
-- ★ الفحص القبْليّ ★  docs/mfa_write_gate_s4b_bind_PREFLIGHT.sql (للقراءة فقط)
-- ★ الفحص البعْديّ ★  docs/mfa_write_gate_s4b_bind_POSTCHECK.sql (للقراءة فقط)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · الفحص القبْليّ — يرفض التشغيل إن اختلّ الترتيب أو غابت اعتمادية
-- ─────────────────────────────────────────────────────────────────────────────
do $pf$
declare
  miss text := '';
  d    text;
  s    text;
  fixb text[] := array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ];
begin
  -- (أ) اعتماديات البوّابة — الرفض هنا مقصود وصريح
  if to_regprocedure('public.mfa_require_aal2(text)') is null then
    raise exception 'رفض: mfa_require_aal2(text) غير موجودة — شغّل docs/mfa_write_gate_s4a_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.mfa_write_ok()') is null then
    raise exception 'رفض: mfa_write_ok() غير موجودة — شغّل docs/mfa_write_gate_s4a_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'رفض: can_manage_identity() غير موجودة — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql أولًا';
  end if;
  if to_regclass('public.mfa_settings') is null then
    raise exception 'رفض: mfa_settings غير موجود — شغّل docs/mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;

  -- (ب) الدوالّ السبع موجودة بصِيَغها الدقيقة (اختلاف صيغة = دالّة أخرى)
  if to_regprocedure('public.admin_set_staff_role(uuid,text)')                   is null then miss := miss || ' admin_set_staff_role(uuid,text)'; end if;
  if to_regprocedure('public.admin_set_account(uuid,text,text,text,uuid)')       is null then miss := miss || ' admin_set_account(uuid,text,text,text,uuid)'; end if;
  if to_regprocedure('public.admin_upsert_profession(jsonb)')                    is null then miss := miss || ' admin_upsert_profession(jsonb)'; end if;
  if to_regprocedure('public.admin_set_employee_professions(uuid,uuid[])')       is null then miss := miss || ' admin_set_employee_professions(uuid,uuid[])'; end if;
  if to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)') is null then miss := miss || ' admin_set_profession_permission(uuid,text,boolean)'; end if;
  if to_regprocedure('public.admin_set_employee_override(uuid,text,text,text)')  is null then miss := miss || ' admin_set_employee_override(uuid,text,text,text)'; end if;
  if to_regprocedure('public.admin_delete_profession(uuid,boolean)')             is null then miss := miss || ' admin_delete_profession(uuid,boolean)'; end if;
  if miss <> '' then
    raise exception 'رفض: دوالّ مفقودة — لا تُشغّل هذا الملفّ على قاعدة غير مُهيّأة:%', miss;
  end if;

  -- (ج) ★ الترتيب: إصلاح A مُطبَّق ★  بصمته 'role_change_denied'.
  d := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if d not like '%role_change_denied%' then
    raise exception 'رفض — الترتيب مخالف: إصلاح A غير مُطبَّق على admin_set_staff_role. شغّل docs/authz_fixA_super_admin_grant_RUNME.sql أولًا، وإلّا فإنّ هذا الملفّ سيُلغي الإصلاح صامتًا';
  end if;
  if d not like '%custody_officer%' then
    raise exception 'رفض: admin_set_staff_role الحيّة ليست التعريف الفائز (قائمة الأدوار الـ12 غائبة) — راجع الحالة يدويًّا قبل الربط';
  end if;

  -- (د) ★ الترتيب: إصلاح B مُطبَّق على الخمس ★  بصمته can_manage_identity وغياب can_manage_projects.
  foreach s in array fixb loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d not like '%can_manage_identity%' then
      raise exception 'رفض — الترتيب مخالف: إصلاح B غير مُطبَّق على % . شغّل docs/authz_fixB_identity_permissions_RUNME.sql أولًا، وإلّا فإنّ هذا الملفّ سيُلغي الإصلاح صامتًا', s;
    end if;
    if d ilike '%can_manage_projects%' then
      raise exception 'رفض — الترتيب مخالف: % ما زالت تقبل can_manage_projects (إصلاح B غير مُطبَّق)', s;
    end if;
  end loop;

  -- (هـ) لا يجوز أن تكون mfa_admin_set_mode مبوَّبة قبل التشغيل ولا بعده
  if to_regprocedure('public.mfa_admin_set_mode(text)') is not null
     and pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%' then
    raise exception 'رفض: mfa_admin_set_mode مبوَّبة — زرّ الطوارئ خلف القفل الذي يفتحه. أزل البوّابة عنها قبل المتابعة';
  end if;

  raise notice '✓ §0: الاعتماديات حاضرة · إصلاح A حيّ · إصلاح B حيّ على الخمس · الترتيب صحيح';
end $pf$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · admin_set_staff_role — إسناد الأدوار الوظيفية
--      المصدر: authz_fixA_super_admin_grant_RUNME.sql:48-77 (= الفائز
--      portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39 + فحص الدور المُمنَح).
--      الحرّاس المحفوظون: can_manage_staff() · منع التغيير الذاتي · الأدوار الـ12 ·
--      ★ فحص الدور المُمنَح (إصلاح A) ★ · حماية الحساب المالك · get diagnostics.
--      البوّابة بعد آخر فحص تفويض مباشرةً وقبل الكتابة.
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
  perform public.mfa_require_aal2('admin_set_staff_role');
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · admin_set_account — دورة حياة الحساب (نوع/حالة/مستوى/شركة)
--      المصدر: docs/phase1_addendum_s1.sql:136-170 — التعريف الوحيد في المستودع.
--      لا إصلاح A ولا B يمسّانها ⇒ الجسم الأصلي حرفيًا + سطر البوّابة.
--      الحرّاس المحفوظون: is_admin() · فحوص account_type/account_status/client_level ·
--      قصر 'admin' على البريدَين المُثبّتَين · وجود الشركة · get diagnostics.
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
  perform public.mfa_require_aal2('admin_set_account');
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
-- §3 · admin_upsert_profession — تعريف المهن وأعلام صلاحياتها
--      المصدر: authz_fixB_identity_permissions_RUNME.sql:85 (= الفائز
--      professions_grants_and_hardening_RUNME.sql:37 + بوّابة can_manage_identity).
--      الحرّاس المحفوظون: ★ can_manage_identity (إصلاح B) ★ · مفتاح مطلوب ·
--      اسم مطلوب · مفتاح مكرّر · «المهنة غير موجودة» · أعلام perm_* الأربعة ·
--      تدقيق غير مُجهِض (exception when others then null).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_upsert_profession(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ar text; v_en text;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'تعريف المهن وأعلام صلاحياتها من صلاحيات الهويّة — للمالك فقط / defining professions and their permission flags is owner-only';
  end if;
  perform public.mfa_require_aal2('admin_upsert_profession');
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
-- §4 · admin_set_employee_professions — إسناد المهن للموظف
--      المصدر: authz_fixB_identity_permissions_RUNME.sql:145 (= الفائز الوحيد
--      employee_professions_RUNME.sql:286 + بوّابة can_manage_identity).
--      الحرّاس المحفوظون: ★ can_manage_identity (إصلاح B) ★ · p_user مطلوب ·
--      «الموظف غير موجود» · التقاط before/after · مرشّح وجود المهنة ·
--      تدقيق employee.professions_changed.
--      البوّابة بعد فحصَي المدخلات كي لا يتحوّل خطأ إدخال إلى مطالبة MFA.
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
  perform public.mfa_require_aal2('admin_set_employee_professions');

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
-- §5 · admin_set_profession_permission — منح/سحب صلاحية لمهنة
--      المصدر: authz_fixB_identity_permissions_RUNME.sql:184 (= الفائز الوحيد
--      permission_catalog_RUNME.sql:388 + بوّابة can_manage_identity).
--      الحرّاس المحفوظون: ★ can_manage_identity (إصلاح B) ★ · `and enabled` ·
--      «صلاحية غير معروفة» · منع system_only · ★ sensitive ⇒ is_owner ★ ·
--      تدقيق profession.permission_changed.
--      البوّابة بعد آخر فحص تفويض (sensitive ⇒ is_owner) وقبل الكتابة.
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
  perform public.mfa_require_aal2('admin_set_profession_permission');
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  values (p_profession, v_perm.id, p_granted, auth.uid())
  on conflict (profession_id, permission_id) do update set granted = excluded.granted, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.permission_changed', 'profession', p_profession,
    jsonb_build_object('key', p_key, 'granted', p_granted));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6 · admin_set_employee_override — تجاوز صلاحية لموظف بعينه
--      المصدر: authz_fixB_identity_permissions_RUNME.sql:257 (= الفائز الوحيد
--      permission_catalog_RUNME.sql:446 + بوّابة can_manage_identity).
--      الحرّاس المحفوظون: ★ can_manage_identity (إصلاح B) ★ · «صلاحية غير معروفة» ·
--      منع system_only · فرع مسح التجاوز · ★ sensitive+allow ⇒ is_owner ★ ·
--      تدقيق employee.permission_override.
--      البوّابة قبل فرعَي الكتابة كليهما (المسح كتابة أيضًا). فحص
--      «sensitive ⇒ is_owner» الباقي داخل الفرع دفاعٌ بالعمق، وبعد إصلاح B لا
--      يبلغه غير المالك أصلًا لأن can_manage_identity() = is_owner().
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
  perform public.mfa_require_aal2('admin_set_employee_override');
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
--      المصدر: authz_fixB_identity_permissions_RUNME.sql:288 (= الفائز الوحيد
--      profession_delete_RUNME.sql:27 + بوّابة can_manage_identity).
--      الحرّاس المحفوظون: ★ can_manage_identity (إصلاح B) ★ · «المهنة غير موجودة» ·
--      عدّ الموظفين · عدّ المهام مع حارس to_regclass ومرشّح is_deleted ·
--      فرع requires_confirm التقريري · الحذف الصلب للمهنة غير المُسنَدة ·
--      الأرشفة مع حفظ التاريخ · تدقيقا profession.deleted و profession.archived.
--      البوّابة **بعد** الإرجاع التقريري: المعاينة تبقى بلا مطالبة MFA،
--      وكلا مسارَي الكتابة مبوَّبان.
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

  perform public.mfa_require_aal2('admin_delete_profession');
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
-- §8 · فحص ذاتي داخل المعاملة — يُجهض التطبيق كلّه عند أيّ سقوط
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
  ops text[] := array[
    'admin_set_staff_role','admin_set_account','admin_upsert_profession',
    'admin_set_employee_professions','admin_set_profession_permission',
    'admin_set_employee_override','admin_delete_profession'
  ];
  i int; s text; d text; n int;
begin
  -- (أ) البوّابة حاضرة مرّة واحدة بالضبط في كل دالّة، وباسم العملية الصحيح
  for i in 1 .. array_length(sigs,1) loop
    s := sigs[i];
    d := pg_get_functiondef(to_regprocedure(s));
    if d is null then raise exception 'فشل: تعذّرت قراءة تعريف %', s; end if;
    n := (length(d) - length(replace(d, 'mfa_require_aal2', ''))) / length('mfa_require_aal2');
    if n <> 1 then
      raise exception 'فشل: % تحوي % استدعاءً لـ mfa_require_aal2 — المطلوب واحد بالضبط', s, n;
    end if;
    if d not like ('%mfa_require_aal2(''' || ops[i] || ''')%') then
      raise exception 'فشل: اسم العملية في بوّابة % ليس %', s, ops[i];
    end if;
  end loop;

  -- (ب) admin_set_staff_role — كل حارس أصلي + حارس إصلاح A
  d := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if d not like '%can_manage_staff%'                     then raise exception 'فشل: سقطت بوّابة can_manage_staff'; end if;
  if d not like '%cannot change your own staff role%'    then raise exception 'فشل: سقط منع التغيير الذاتي'; end if;
  if d not like '%custody_officer%'                      then raise exception 'فشل: سقطت قائمة الأدوار الـ12'; end if;
  if d not like '%role_change_denied%'                   then raise exception 'فشل: سقط فحص الدور المُمنَح (إصلاح A) — الملفّ ألغى الإصلاح'; end if;
  if d not like '%protected owner account%'              then raise exception 'فشل: سقطت حماية الحساب المالك'; end if;
  -- الترتيب: البوّابة بعد حماية الحساب المالك
  if position('protected owner account' in d) > position('mfa_require_aal2' in d) then
    raise exception 'فشل: البوّابة سبقت فحص التفويض في admin_set_staff_role';
  end if;

  -- (ج) admin_set_account — كل حارس أصلي
  d := pg_get_functiondef(to_regprocedure('public.admin_set_account(uuid,text,text,text,uuid)'));
  if d not like '%admin only%'                     then raise exception 'فشل: سقطت بوّابة is_admin في admin_set_account'; end if;
  if d not like '%invalid account_type%'           then raise exception 'فشل: سقط فحص account_type'; end if;
  if d not like '%invalid account_status%'         then raise exception 'فشل: سقط فحص account_status'; end if;
  if d not like '%invalid client_level%'           then raise exception 'فشل: سقط فحص client_level'; end if;
  if d not like '%two approved emails%'            then raise exception 'فشل: سقط قصر admin على البريدَين'; end if;
  if d not like '%company not found or deleted%'   then raise exception 'فشل: سقط فحص الشركة'; end if;
  if position('two approved emails' in d) > position('mfa_require_aal2' in d) then
    raise exception 'فشل: البوّابة سبقت فحص التفويض في admin_set_account';
  end if;

  -- (د) الخمس — حارس إصلاح B حيّ، و can_manage_projects لم تعد مقبولة
  foreach s in array array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ] loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d not like '%can_manage_identity%' then
      raise exception 'فشل: سقطت بوّابة can_manage_identity من % — الملفّ ألغى إصلاح B', s;
    end if;
    if d ilike '%can_manage_projects%' then
      raise exception 'فشل: % عادت تقبل can_manage_projects — الملفّ ألغى إصلاح B', s;
    end if;
    if position('can_manage_identity' in d) > position('mfa_require_aal2' in d) then
      raise exception 'فشل: البوّابة سبقت فحص التفويض في %', s;
    end if;
  end loop;

  -- (هـ) الحرّاس الخاصّة بكل دالّة من الخمس
  d := pg_get_functiondef(to_regprocedure('public.admin_upsert_profession(jsonb)'));
  if d not like '%المفتاح مستخدم بالفعل%'   then raise exception 'فشل: سقط فحص المفتاح المكرّر'; end if;
  if d not like '%المهنة غير موجودة%'        then raise exception 'فشل: سقط فحص وجود المهنة (upsert)'; end if;
  if d not like '%perm_manage_custody%'      then raise exception 'فشل: سقطت أعلام perm_*'; end if;
  if d not like '%profession.upserted%'      then raise exception 'فشل: سقط تدقيق profession.upserted'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_employee_professions(uuid,uuid[])'));
  if d not like '%الموظف غير موجود%'              then raise exception 'فشل: سقط فحص وجود الموظف'; end if;
  if d not like '%employee.professions_changed%'  then raise exception 'فشل: سقط تدقيق employee.professions_changed'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'));
  if d not like '%system_only%'                     then raise exception 'فشل: سقط منع system_only (مهنة)'; end if;
  if d not like '%is_owner%'                        then raise exception 'فشل: سقط حارس sensitive ⇒ is_owner (مهنة)'; end if;
  if d not like '%profession.permission_changed%'   then raise exception 'فشل: سقط تدقيق profession.permission_changed'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_employee_override(uuid,text,text,text)'));
  if d not like '%system_only%'                     then raise exception 'فشل: سقط منع system_only (تجاوز)'; end if;
  if d not like '%is_owner%'                        then raise exception 'فشل: سقط حارس sensitive ⇒ is_owner (تجاوز)'; end if;
  if d not like '%employee.permission_override%'    then raise exception 'فشل: سقط تدقيق employee.permission_override'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_delete_profession(uuid,boolean)'));
  if d not like '%requires_confirm%'        then raise exception 'فشل: سقط الفرع التقريري requires_confirm'; end if;
  if d not like '%profession.deleted%'      then raise exception 'فشل: سقط تدقيق profession.deleted'; end if;
  if d not like '%profession.archived%'     then raise exception 'فشل: سقط تدقيق profession.archived'; end if;
  if position('requires_confirm' in d) > position('mfa_require_aal2' in d) then
    raise exception 'فشل: البوّابة سبقت الإرجاع التقريري في admin_delete_profession';
  end if;

  -- (و) ★ زرّ الطوارئ يبقى بلا بوّابة ★
  if to_regprocedure('public.mfa_admin_set_mode(text)') is not null
     and pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%' then
    raise exception 'فشل حرج: mfa_admin_set_mode صارت مبوَّبة — زرّ الطوارئ خلف القفل الذي يفتحه';
  end if;

  -- (ز) نطاق الربط — تحذير لا استثناء.
  --     لو بوّبت دفعة لاحقة (S4c) دوالّ أخرى بحقّ، فرفع استثناء هنا يجعل هذا الملفّ
  --     غير قابل لإعادة التشغيل ويُبلّغ عن نجاح لاحق بوصفه فشلًا. نُبلّغ ونمضي.
  declare v_extra text;
  begin
    select string_agg(p.proname, ', ') into v_extra
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'                     -- pg_get_functiondef يرفع خطأً على المُجمِّعات
       and pg_get_functiondef(p.oid) ilike '%mfa_require_aal2%'
       and p.proname not in ('mfa_require_aal2',
             'admin_set_staff_role','admin_set_account','admin_upsert_profession',
             'admin_set_employee_professions','admin_set_profession_permission',
             'admin_set_employee_override','admin_delete_profession');
    if v_extra is not null then
      raise warning '⚠️ دوالّ خارج القائمة السبعة تستدعي mfa_require_aal2: % — إن لم تكن من دفعة لاحقة مقصودة فراجعها', v_extra;
    end if;
  end;

  raise notice '✓ S4b: البوّابة مربوطة بسبع دوالّ بالضبط · إصلاح A حيّ · إصلاح B حيّ · mfa_admin_set_mode بلا بوّابة';
  raise notice '  الوضع الحالي enforcement_mode = enrollment ⇒ لا يُمنع إلّا إداريّ يملك عاملًا مُفعَّلًا وجلسته aal1';
end $vfy$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- زرّ الطوارئ (غير مبوَّب عمدًا — يعمل حتى لو فَقَد المالك جهاز المصادقة):
--   update public.mfa_settings set enforcement_mode = 'off' where id = 1;
-- التراجع الكامل: docs/mfa_write_gate_s4b_bind_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════