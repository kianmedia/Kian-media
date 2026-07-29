-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — إصلاح D · إغلاق الكتابة المباشرة على public.profiles
--         Fix D — close the direct-PATCH escalation on public.profiles
--
--   يُشغَّل بعد: Fix A · s4pre · Fix B · Fix C   (لا يمسّ أيًّا منها)
--   يُشغَّل قبل: S4a / S4b                        (وإلّا فبوّابة MFA تحرس بابًا مفتوحًا)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الثغرة العاشرة — ليست دالّة، بل غياب دالّة ★
--
--   لا تمرّ هذه الثغرة بأيّ RPC، فلا تُغلقها بوّابة على الدوالّ التسع. المهاجم
--   لا يستدعي شيئًا؛ يكتب على الجدول مباشرة عبر PostgREST:
--
--       PATCH /rest/v1/profiles?id=eq.<معرّفه هو>
--       Authorization: Bearer <أيّ حساب مسجَّل عاديّ>
--       {"staff_role":"super_admin"}
--
--   سلسلة السبب، كل حلقة موجودة اليوم في المستودع:
--
--   (1) phase0_migration.sql:795 — سياسة التحديث الذاتي:
--         create policy "own profile update" on public.profiles for update
--           to authenticated using (id = auth.uid() and public.is_active())
--                              with check (id = auth.uid());
--       ⇒ السياسة تسمح بالصفّ. و**RLS لا تعرف الأعمدة إطلاقًا** — لا تستطيع
--         منع عمود دون آخر. هذه ليست ثغرة في السياسة؛ هذا حدّ بنيويّ فيها.
--
--   (2) phase0_migration.sql:778 — القيد الوحيد على الأعمدة منحةٌ ضيّقة:
--         grant update (full_name, company, mobile, preferred_lang, marketing_opt_in)
--           on public.profiles to authenticated;
--
--   (3) **ولا ملفّ واحد من 188 ملفّ SQL يسحب UPDATE على مستوى الجدول.**
--       والمنح تراكميّة: منحةٌ ضيّقة على أعمدة **لا تُلغي** منحةً واسعة على الجدول.
--       ومشاريع Supabase تُنشأ أصلًا بـ
--         grant all on all tables in schema public to anon, authenticated;
--         alter default privileges in schema public grant all on tables to ...;
--       فالمنحة الواسعة موجودة تحت الضيّقة، والضيّقة تبدو حارسًا وهي ليست شيئًا.
--
--       الدليل من داخل المستودع لا من الافتراض: project_platform_authz_hardening2_RUNME.sql:66-78
--       يسحب insert/update/delete عن جداول (project_locations, project_templates,
--       project_shoot_sessions …) **لم تُمنح صراحةً في أيّ ملفّ** — وفحصه الذاتي في
--       :174-176 يشترط بقاء INSERT على project_locations «لأن الواجهة تحتاجه».
--       امتيازٌ قائم بلا منحة صريحة لا مصدر له إلّا منح Supabase الافتراضية.
--
--   (4) الأثر ليس تصعيدًا جزئيًّا بل استيلاء كامل:
--         staff_roles_task_assignment_RUNME.sql:39 — القيد يسمح بـ 'super_admin'
--         phase1_addendum_s1.sql:158 — is_owner() = is_admin() or staff_role()='super_admin'
--         authz_identity_hardening_s4pre — can_manage_identity() = coalesce(is_owner(), false)
--       ⇒ من كتب لنفسه super_admin صار is_owner()، فاجتاز حارس Fix B على الدوالّ
--         السبع، وحارس Fix A على admin_set_staff_role، وشروط `is_owner()` داخل
--         منح الصلاحيات الحسّاسة. من حساب زائر إلى مالك المنصّة بطلب HTTP واحد.
--
--   (5) ويتجاوز S4b أيضًا لو طُبّقت: mfa_write_ok() الفقرة (5) تُمرّر كل من لا
--       يملك عاملًا مُفعَّلًا — والمهاجم لا يملك عاملًا. البوّابة تحرس الدوالّ،
--       والطريق هنا لا يمرّ بدالّة.
--
--   (6) وصامتة: trg_profile_audit (phase0_migration.sql:700-714) يسجّل
--       account_type/account_status/client_level/company_id — و**لا يسجّل staff_role**.
--       التصعيد لا يترك سطرًا واحدًا في activity_log.
--
-- ★ لماذا الجداول الأربعة الأخرى سليمة — ولماذا هذا بالضبط هو الفرق ★
--   professions · employee_professions · profession_permissions ·
--   employee_permission_overrides · permissions:
--   RLS مُفعَّلة عليها (employee_professions_RUNME.sql:167-168 ·
--   permission_catalog_RUNME.sql:376-377) وسياساتها **قراءة فقط**
--   (…:173,178 · …:379,381,383). ومع RLS مُفعَّلة وبلا سياسة كتابة مُجيزة،
--   تُرفض كل INSERT/UPDATE/DELETE مهما كانت المنح. فهي محميّة **بالسياسات**.
--   أمّا profiles فوحدها تملك سياسة UPDATE، فهي محميّة **بالمنح وحدها** — والمنح
--   هي ما لم يُسحب قطّ. هذا التباين هو كامل الثغرة.
--
-- ★ لماذا السحب آمن على الواجهة — تُحقّق منه لا تُصدّقه ★
--   الواجهة **لا تُعدّل أيّ جدول مباشرة**: ppatch() معرّفة في
--   lib/portal/client.ts:130 و**بلا أيّ موضع استدعاء في المستودع كلّه**،
--   ولا توجد RPC لتحديث الملفّ الشخصيّ الذاتيّ. كل كتابة تمرّ بدالّة
--   SECURITY DEFINER، وهذه تعمل بصلاحيات مالك الدالّة لا بصلاحيات المتصل،
--   فلا يمسّها السحب إطلاقًا. ورغم ذلك نُعيد منح الأعمدة الخمسة الأصلية في §2
--   حتى لا يتغيّر أيّ عقد قائم.
--
-- ★ السلامة ★
--   إضافي · idempotent · لا DROP · لا حذف صفّ · لا مساس بـ Fix A/B/C ولا s4pre
--   ولا بأيّ سياسة SELECT · ولا يقترب من auth.mfa_factors لا قراءةً ولا منحًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · تقرير ما قبل التغيير — شغّل هذا وحده أوّلًا واقرأ الناتج
--      (خارج المعاملة عمدًا: تقرير محض، لا يغيّر شيئًا)
-- ─────────────────────────────────────────────────────────────────────────────
select 'BEFORE' as phase,
       has_table_privilege ('authenticated','public.profiles','UPDATE')                   as tbl_update,
       has_column_privilege('authenticated','public.profiles','staff_role','UPDATE')      as col_staff_role,
       has_column_privilege('authenticated','public.profiles','account_type','UPDATE')    as col_account_type,
       has_column_privilege('authenticated','public.profiles','account_status','UPDATE')  as col_account_status,
       has_column_privilege('authenticated','public.profiles','full_name','UPDATE')       as col_full_name_keep;
-- التوقّع بعد الإصلاح: أوّل أربعة false · الأخير true.
-- إن كان col_staff_role = true الآن فالثغرة **حيّة على الإنتاج** لا نظريّة.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · السحب — يُزيل منحة الجدول الواسعة (وهي وحدها ما يُبطل قيد الأعمدة)
-- ─────────────────────────────────────────────────────────────────────────────
-- ملاحظة: `revoke update on <table>` يُزيل منحة الجدول فقط ولا يمسّ منح الأعمدة،
-- ولذلك نُعيد المنح في §2 صراحةً بدل الاعتماد على بقائها.
revoke update, insert, delete on public.profiles from authenticated;
revoke update, insert, delete on public.profiles from anon;

-- الجداول الأربعة محميّة بالسياسات أصلًا؛ هذا حزام ثانٍ لا بديل عنها.
do $r$
declare t text;
begin
  foreach t in array array[
    'professions','profession_permissions','employee_professions',
    'employee_permission_overrides','permissions']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
      execute format('revoke insert, update, delete on public.%I from anon', t);
    end if;
  end loop;
end $r$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · إعادة المنح الأصلية — نفس الأعمدة الخمسة، لا عمودًا أقلّ ولا أكثر
--      المصدر: phase0_migration.sql:778-779
-- ─────────────────────────────────────────────────────────────────────────────
grant update (full_name, company, mobile, preferred_lang, marketing_opt_in)
  on public.profiles to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · جعل تغيير staff_role مسموعًا — التصعيد الصامت نصف الخطر
--      إعادة تعريف كاملة لـ trg_profile_audit مع إضافة staff_role فقط.
--      ⚠️ **لا مفردات جديدة**: نبقى على 'account.updated' الموجودة أصلًا
--         (phase0_migration.sql:708) ولا نخترع اسم فعل جديدًا.
--      التعريف الوحيد في المستودع هو phase0_migration.sql:700 — لا تعريف منافس.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_profile_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare changed jsonb := '{}';
begin
  if old.account_type   is distinct from new.account_type
     or old.account_status is distinct from new.account_status
     or old.client_level   is distinct from new.client_level
     or old.company_id     is distinct from new.company_id
     or old.staff_role     is distinct from new.staff_role then       -- ★ المضاف
    perform public.log_activity(auth.uid(), 'admin', 'account.updated', 'profile', new.id,
      jsonb_build_object(
        'type',    jsonb_build_object('from', old.account_type,   'to', new.account_type),
        'status',  jsonb_build_object('from', old.account_status, 'to', new.account_status),
        'level',   jsonb_build_object('from', old.client_level,   'to', new.client_level),
        'company', jsonb_build_object('from', old.company_id,     'to', new.company_id),
        'staff_role', jsonb_build_object('from', old.staff_role,  'to', new.staff_role)));  -- ★
  end if;

  if old.full_name is distinct from new.full_name then
    changed := changed || jsonb_build_object('full_name', jsonb_build_object('from', old.full_name, 'to', new.full_name));
  end if;
  if old.company is distinct from new.company then
    changed := changed || jsonb_build_object('company', jsonb_build_object('from', old.company, 'to', new.company));
  end if;
  if old.mobile is distinct from new.mobile then
    changed := changed || jsonb_build_object('mobile', jsonb_build_object('from', old.mobile, 'to', new.mobile));
  end if;
  if old.preferred_lang is distinct from new.preferred_lang then
    changed := changed || jsonb_build_object('preferred_lang', jsonb_build_object('from', old.preferred_lang, 'to', new.preferred_lang));
  end if;
  if old.marketing_opt_in is distinct from new.marketing_opt_in then
    changed := changed || jsonb_build_object('marketing_opt_in', jsonb_build_object('from', old.marketing_opt_in, 'to', new.marketing_opt_in));
  end if;
  if changed <> '{}'::jsonb then
    perform public.log_activity(auth.uid(),
            case when public.is_admin() then 'admin' else 'user' end,
            'profile.updated', 'profile', new.id, changed);
  end if;

  new.updated_at = now();
  return new;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · فحص ذاتي داخل المعاملة — يُفشل التشغيل بدل أن يُبلّغ نجاحًا كاذبًا
-- ─────────────────────────────────────────────────────────────────────────────
do $v$
begin
  if has_column_privilege('authenticated','public.profiles','staff_role','UPDATE') then
    raise exception 'فشل: authenticated ما زال يملك UPDATE على profiles.staff_role';
  end if;
  if has_column_privilege('authenticated','public.profiles','account_type','UPDATE') then
    raise exception 'فشل: authenticated ما زال يملك UPDATE على profiles.account_type';
  end if;
  if has_column_privilege('authenticated','public.profiles','account_status','UPDATE') then
    raise exception 'فشل: authenticated ما زال يملك UPDATE على profiles.account_status';
  end if;

  -- ★ انحدار: الأعمدة الخمسة المشروعة يجب أن تبقى ★
  if not has_column_privilege('authenticated','public.profiles','full_name','UPDATE') then
    raise exception 'انحدار: سقطت منحة full_name — أعد §2';
  end if;

  -- ★ انحدار: القراءة يجب ألّا تُمسّ ★
  if not has_table_privilege('authenticated','public.profiles','SELECT') then
    raise exception 'انحدار: سقط SELECT على profiles';
  end if;

  -- الجداول الأربعة: لا كتابة
  if has_table_privilege('authenticated','public.professions','UPDATE')
     or has_table_privilege('authenticated','public.profession_permissions','UPDATE')
     or has_table_privilege('authenticated','public.employee_professions','UPDATE')
     or has_table_privilege('authenticated','public.employee_permission_overrides','UPDATE') then
    raise exception 'فشل: ما زالت إحدى جداول المهن/الصلاحيات قابلة للكتابة المباشرة';
  end if;
  -- القراءة عليها يجب أن تبقى (الواجهة تعتمدها)
  if not has_table_privilege('authenticated','public.professions','SELECT') then
    raise exception 'انحدار: سقط SELECT على professions';
  end if;

  -- التدقيق صار يرى staff_role
  if pg_get_functiondef(to_regprocedure('public.trg_profile_audit()')) not like '%staff_role%' then
    raise exception 'فشل: trg_profile_audit ما زال أعمى عن staff_role';
  end if;

  -- ★ لم نمسّ Fix A/B/C ولا s4pre ★
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'فشل: can_manage_identity() اختفت — هذا الملفّ لا يجوز أن يمسّها';
  end if;

  raise notice '✓ إصلاح D: الكتابة المباشرة على profiles أُغلقت · القراءة والأعمدة الخمسة سليمة · التدقيق يرى staff_role';
end $v$;

commit;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 · تقرير ما بعد التغيير
-- ─────────────────────────────────────────────────────────────────────────────
select 'AFTER' as phase,
       has_table_privilege ('authenticated','public.profiles','UPDATE')                   as tbl_update_expect_false,
       has_column_privilege('authenticated','public.profiles','staff_role','UPDATE')      as staff_role_expect_false,
       has_column_privilege('authenticated','public.profiles','account_type','UPDATE')    as account_type_expect_false,
       has_column_privilege('authenticated','public.profiles','full_name','UPDATE')       as full_name_expect_true,
       has_table_privilege ('authenticated','public.profiles','SELECT')                   as select_expect_true;

-- ════════════════════════════════════════════════════════════════════════════
-- اختبار حيّ بعد التشغيل (بمفتاح anon وجلسة حساب عاديّ غير إداريّ):
--   curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.$MY_UID" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $MY_JWT" \
--        -H "Content-Type: application/json" \
--        -d '{"staff_role":"super_admin"}'
--   المتوقّع بعد الإصلاح: 401/403 مع "permission denied for table profiles".
--   ⚠️ إن عاد 200 أو [] فالإصلاح لم يُطبَّق — لا تُكمل إلى S4b.
-- التراجع: docs/authz_fixD_profiles_direct_write_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
