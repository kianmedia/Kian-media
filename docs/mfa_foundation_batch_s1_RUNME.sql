-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S1 · أساس MFA: جدول الإعدادات + مِسبار الادّعاء + كاتب التدقيق
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ هذا الملفّ لا يفرض شيئًا ولا يمنع أحدًا. خامل تمامًا. ★
--   لا توجد دالّة `mfa_ok()` بعد، ولا شيء يستدعي أيّ تحقّق. الغرض ثلاثة أشياء:
--     (1) حامل الوضع (off / enrollment) — والقيمة الافتراضية `off`.
--     (2) **إثبات** ما إذا كان PostgreSQL يرى ادّعاء `aal` في هذا المشروع أصلًا،
--         **قبل** كتابة أيّ سطر إلزام.
--     (3) كاتب تدقيق آمن لأحداث MFA.
--
-- ★ لماذا المِسبار أوّلًا — ولا نفترض ★
--   الآلية سليمة نظريًّا: PostgREST يتحقّق من توقيع الـJWT ويضع حمولته في
--   `request.jwt.claims`، و`auth.uid()` (المستخدمة آلاف المرّات هنا) تقرأ نفس المصدر.
--   **لكن** `grep "auth\.jwt" docs/` يُعيد **صفر** نتيجة عبر 169 ملفّ SQL — أي أن قراءة
--   الادّعاءات **غير مُثبَتة في هذا المشروع قط**. بناء إلزام على افتراض غير مُختبَر هو
--   بالضبط ما يصنع إقفالًا صامتًا. لذلك: نُثبت أوّلًا، ثم نبني.
--
-- ★ فخّ حقيقي تفاديناه هنا — اقرأه قبل تعديل `mfa_audit` ★
--   العمود `public.activity_log.actor_role` يحمل **قيدًا مغلقًا**
--   (`phase0_migration.sql:48-50`): user | lead | client | client_owner | client_member |
--   kian_admin | kian_manager | kian_editor | kian_photographer | kian_viewer | admin | system
--   وقيم `profiles.staff_role` الحقيقية — `super_admin` و`manager` و`custody_officer`
--   و`finance` — **ليست ضمنه**. تمرير الدور الحقيقي يرفع 23514 ويُجهض المعاملة كاملة،
--   وهو تحديدًا العطل الذي أصاب هذا المستودع سابقًا مع `log_activity`.
--   ⇒ لذلك `mfa_audit` تُمرّر دائمًا `'system'` (قيمة مشروعة قطعًا)، وتضع الدور الحقيقي
--     داخل `metadata`. **لا تُغيّر هذا** دون توسيع القيد أوّلًا.
--   (العمود `action` نصّ حرّ بلا قيد، فمفردات مثل `mfa.enrolled` لا تحتاج ترحيلًا.)
--
-- ★ السلامة ★
--   • إضافي و idempotent · لا `DROP` · لا حذف بيانات.
--   • **لا يُفعّل شيئًا**: لا يوجد في نهايته أيّ `update ... set enforcement_mode`.
--   • القيمة `'enforced'` **ليست قيمة مشروعة** في القيد — أمر المالك «لا تشحن enforced»
--     صار قيدًا في قاعدة البيانات، لا وعدًا في مراجعة كود.
--   • بوّابة الكتابة `is_owner()` **فقط** — وليس `can_manage_projects()` التي تشمل
--     `staff_role='manager'` (project_platform_authz_hardening_RUNME.sql:51-53)،
--     وإلّا استطاع أيّ مدير تعطيل MFA.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · متطلّبات
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.activity_log') is null then
    raise exception 'activity_log غير موجود — شغّل phase0_migration.sql أولًا';
  end if;
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'is_owner() غير موجودة — شغّل staff_roles_task_assignment_RUNME.sql أولًا';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · حامل الوضع — صفّ واحد، والقيمة الافتراضية «مُطفأ»
-- ─────────────────────────────────────────────────────────────────────────────
-- نفس نمط البيت: custody_enterprise_settings / hr_settings / zoho_books_settings.
create table if not exists public.mfa_settings (
  id               int primary key default 1 check (id = 1),
  -- ⚠️ 'enforced' غائبة عمدًا. إضافتها لاحقًا ترحيل واعٍ منفصل، لا سهو.
  enforcement_mode text not null default 'off'
                   check (enforcement_mode in ('off','enrollment')),
  applies_to       text not null default 'privileged'
                   check (applies_to in ('privileged','owner_only')),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);
insert into public.mfa_settings (id) values (1) on conflict (id) do nothing;

alter table public.mfa_settings enable row level security;
-- لا سياسات قراءة إطلاقًا — القراءة عبر RPC فقط (نفس نمط custody_inventory_settings).
revoke all on table public.mfa_settings from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · ★ المِسبار ★ — للقراءة فقط، ولا يرفع استثناءً أبدًا
-- ─────────────────────────────────────────────────────────────────────────────
-- يقرأ `request.jwt.claims` مباشرة بدل `auth.jwt()`: نفس البيانات، وبلا اعتماد على
-- وجود غلاف مخطّط `auth`. كل قراءة معزولة باستثناء فلا يمكن أن تُفشل أيّ شيء.
--
-- التشغيل المتوقَّع (يُنفَّذه المالك وهو مُسجَّل دخول):  select public.mfa_claim_probe();
--   قبل التسجيل:  {"uid_present":true,"claims_present":true,"aal":"aal1", ...}
--   بعد التسجيل والتحقّق:  "aal":"aal2"
-- إن كانت `aal` = null فالإلزام في S4 يتغيّر شكله بالكامل (يعتمد على طبقة TS وحدها).
create or replace function public.mfa_claim_probe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_raw text; v_j jsonb;
begin
  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j := v_raw::jsonb; exception when others then v_j := null; end;
  return jsonb_build_object(
    'uid_present',    (auth.uid() is not null),
    'claims_present', (v_j is not null),
    'aal',            v_j ->> 'aal',
    'amr_present',    (v_j ? 'amr'),
    'role',           v_j ->> 'role',
    'checked_at',     now()
  );
exception when others then
  return jsonb_build_object('uid_present', null, 'claims_present', false, 'aal', null, 'probe_error', sqlstate);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · كاتب التدقيق
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ `actor_role` يجب أن يكون قيمة ضمن القيد المغلق. نمرّر 'system' دائمًا، والدور
--    الحقيقي يذهب إلى metadata. راجع رأس الملفّ قبل تغيير هذا السطر.
-- ⚠️ ولا نُسجّل إطلاقًا: سرّ TOTP، رمز تحقّق، رمز وصول، أو أيّ محتوى حسّاس.
create or replace function public.mfa_audit(p_action text, p_user uuid, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (
    coalesce(p_user, auth.uid()),
    'system',                                  -- ← القيمة الوحيدة الآمنة قطعًا
    'mfa.' || coalesce(nullif(btrim(p_action), ''), 'unknown'),
    'mfa_factor',
    null,
    coalesce(p_meta, '{}'::jsonb)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · قراءة الإعدادات (طاقم) وكتابتها (المالك فقط)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mfa_settings_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  -- coalesce على البوّابة: is_staff() تُبنى على OR وقد تُعيد NULL، وهو نمط الانهيار
  -- الصفري الذي سبق أن أحدث تسريبًا في هذا المستودع.
  if not coalesce(public.is_staff(), false) then raise exception 'not authorized'; end if;
  select enforcement_mode, applies_to, updated_at into r from public.mfa_settings where id = 1;
  return jsonb_build_object(
    'enforcement_mode', coalesce(r.enforcement_mode, 'off'),
    'applies_to',       coalesce(r.applies_to, 'privileged'),
    'updated_at',       r.updated_at,
    -- ثابت مُعلن: هذه المرحلة لا تشحن 'enforced' إطلاقًا.
    'enforced_available', false
  );
end $$;

create or replace function public.mfa_admin_set_mode(p_mode text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_mode text;
begin
  -- ★ المالك فقط ★ — لا can_manage_projects (تشمل manager) ولا is_staff.
  if not coalesce(public.is_owner(), false) then raise exception 'not authorized'; end if;
  v_mode := lower(btrim(coalesce(p_mode, '')));
  if v_mode not in ('off','enrollment') then
    raise exception 'وضع غير مشروع: %. المسموح: off | enrollment. (enforced غير مدعوم في هذه المرحلة)', p_mode;
  end if;
  update public.mfa_settings
     set enforcement_mode = v_mode, updated_by = auth.uid(), updated_at = now()
   where id = 1;
  -- بلا `exception when others then null` هنا عمدًا: تغيير وضع لا يُسجَّل هو تغيير
  -- لا نعرف عنه شيئًا، ويجب أن يفشل بصوت مسموع.
  perform public.mfa_audit('mode_changed', auth.uid(), jsonb_build_object('mode', v_mode));
  return true;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §5 · الصلاحيات
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.mfa_claim_probe()              from public, anon;
grant  execute on function public.mfa_claim_probe()           to authenticated, service_role;

revoke all on function public.mfa_settings_get()              from public, anon;
grant  execute on function public.mfa_settings_get()          to authenticated, service_role;

revoke all on function public.mfa_admin_set_mode(text)        from public, anon;
grant  execute on function public.mfa_admin_set_mode(text)    to authenticated, service_role;

-- كاتب التدقيق ليس واجهة عامة: لا يُنادى من متصفّح إطلاقًا.
revoke all on function public.mfa_audit(text,uuid,jsonb)      from public, anon, authenticated;
grant  execute on function public.mfa_audit(text,uuid,jsonb)  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6 · فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_mode text; v_ok boolean;
begin
  if to_regclass('public.mfa_settings') is null then raise exception 'فشل: mfa_settings لم يُنشأ'; end if;

  -- الوضع الافتراضي يجب أن يكون مُطفأً — هذا الملفّ لا يُفعّل شيئًا.
  select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  if v_mode is distinct from 'off' then
    raise exception 'فشل: الوضع الابتدائي % وليس off — هذا الملفّ يجب ألّا يُفعّل شيئًا', v_mode;
  end if;

  -- 'enforced' يجب أن يكون مرفوضًا على مستوى القيد لا على مستوى النيّة.
  begin
    update public.mfa_settings set enforcement_mode = 'enforced' where id = 1;
    raise exception 'فشل أمني: القيد قَبِل enforced — أمر المالك غير مُنفَّذ في قاعدة البيانات';
  exception
    when check_violation then null;   -- ✓ المتوقَّع
    when others then
      if sqlstate = 'P0001' then raise; end if;   -- أعِد رفع فشلنا نحن
  end;
  -- تأكيد أن المحاولة أعلاه لم تُغيّر شيئًا.
  select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  if v_mode is distinct from 'off' then raise exception 'فشل: تسرّب تغيير الوضع'; end if;

  -- المِسبار يجب أن يعمل دون رفع استثناء حتى بلا جلسة مستخدم.
  begin
    perform public.mfa_claim_probe();
  exception when others then
    raise exception 'فشل: mfa_claim_probe رفعت استثناءً — يجب أن تكون معزولة تمامًا';
  end;

  -- anon لا يملك تنفيذ أيّ من دوال MFA.
  for v_ok in
    select has_function_privilege('anon', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'mfa\_%'
  loop
    if v_ok then raise exception 'فشل أمني: anon يملك EXECUTE على إحدى دوال MFA'; end if;
  end loop;

  -- كاتب التدقيق محجوب عن الحسابات المُسجَّلة.
  if has_function_privilege('authenticated', 'public.mfa_audit(text,uuid,jsonb)', 'execute') then
    raise exception 'فشل أمني: authenticated يملك EXECUTE على mfa_audit';
  end if;

  raise notice '✓ S1 تمّ: الجدول قائم · الوضع off · enforced مرفوض بالقيد · المِسبار جاهز';
  raise notice '→ الخطوة التالية للمالك: select public.mfa_claim_probe();  وهو مُسجَّل دخول';
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ بطاقة كسر الزجاج — احفظها خارج البوابة قبل أيّ تسجيل MFA ★
--   كلاهما يُنفَّذ من محرّر SQL في Supabase — مسار اعتماد **مستقلّ تمامًا** عن
--   تسجيل الدخول للبوابة وعن Vercel، فلا يمنعه إقفالٌ في البوابة.
--
--   -- (1) إيقاف الإلزام فورًا:
--   update public.mfa_settings set enforcement_mode = 'off' where id = 1;
--
--   -- (2) إزالة عامل مفقود لمستخدم محبوس خارج حسابه:
--   delete from auth.mfa_factors where user_id = '<owner-uuid>';
-- ════════════════════════════════════════════════════════════════════════════
