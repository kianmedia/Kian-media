-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S3 · قراءة مستوى التوثيق (assurance) للمتصل — بلا أيّ إلزام
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ لماذا في SQL وليس في TypeScript ★
--   الواجهة تحتاج أن تعرف: هل المستخدم عند `aal1` أم `aal2`؟ وهل لديه عامل مُفعَّل؟
--   الطريق المُغري هو فكّ ترميز الـJWT في المتصفّح أو على الخادم وقراءة `aal` منه.
--   **هذا خاطئ ومرفوض:** يوجد في هذا المستودع مساران يفكّان حمولة JWT بـbase64
--   **دون التحقّق من التوقيع** (`zoho/accept-with-billing/route.ts:36-42` و
--   `whatsapp/books-estimate/route.ts:25-33`). هما آمنان فقط لأن ناتجهما يُعاد التحقّق
--   منه لاحقًا. أمّا مستوى التوثيق فهو **قرار أمني**، وبناؤه على حمولة غير مُتحقَّق منها
--   يجعله قابلًا للتزوير بتعديل مقطع base64 واحد.
--
--   المصدر الوحيد المقبول: `request.jwt.claims` داخل PostgreSQL — بعد أن يكون PostgREST
--   قد تحقّق من التوقيع. وقد أثبت الفحص (M-009) أن الادّعاءات تصل فعلًا:
--   `aal=aal1` و`sub` و`session_id` و`amr` كلها حاضرة من جلسة مالك حقيقية.
--
-- ★ ما يُعيده — والحد الأدنى عمدًا ★
--   `aal` · `is_aal2` · `has_verified_factor` فقط.
--   **لا `sub` ولا `session_id` ولا قائمة Claims** — أُزيلت أداة التشخيص بعد أن أدّت غرضها،
--   ولا يجوز أن تعود من الباب الخلفي عبر هذه الدالّة.
--
-- ★ `has_verified_factor` هو حجر الزاوية في منع الإقفال ★
--   الثابت الحاكم في S4: **لا يُمنع أحد إلّا إن كان يملك هو نفسه عاملًا مُفعَّلًا.**
--   من لا عامل له يمرّ دائمًا. لذلك رفع الوضع إلى `enrollment` قبل أن يسجّل المالك
--   **لا يمكن أن يُقفل أحدًا** — وهذه ليست سياسة بل خاصية بنيوية.
--
-- ★ لا إلزام هنا ★  هذه دالّة قراءة. لا `mfa_ok()`، ولا تعديل على أيّ سياسة RLS،
--   ولا مساس بأيّ بوّابة دور مشتركة. الوضع يبقى `off`.
--
-- ★ السلامة ★  إضافي · idempotent · `stable` · لا DROP · لا تغيير بيانات.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regclass('public.mfa_settings') is null then
    raise exception 'mfa_settings غير موجود — شغّل mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;
end $$;

create or replace function public.mfa_my_assurance()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_raw text; v_j jsonb; v_aal text; v_has boolean := false; v_mode text;
begin
  -- بلا بوّابة دور: كل مستخدم يقرأ حالة **نفسه فقط**. لا تسريب متقاطع ممكن أصلًا
  -- لأن كل ما يُقرأ مشتقّ من ادّعاءات المتصل و auth.uid().
  if auth.uid() is null then
    return jsonb_build_object('aal', null, 'is_aal2', false, 'has_verified_factor', false,
                              'enforcement_mode', 'off', 'authenticated', false);
  end if;

  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j := v_raw::jsonb; exception when others then v_j := null; end;
  v_aal := v_j ->> 'aal';

  -- هل للمستخدم عامل TOTP مُفعَّل؟ يُقرأ من جدول GoTrue نفسه — لا نسخة لدينا،
  -- ولا نخزّن أيّ سرّ. معزول باستثناء: تغيّر مخطّط auth لا يجوز أن يُفشل الواجهة.
  begin
    select exists (
      select 1 from auth.mfa_factors f
       where f.user_id = auth.uid()
         and f.status = 'verified'
         and f.factor_type = 'totp'
    ) into v_has;
  exception when others then v_has := false;
  end;

  begin
    select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  exception when others then v_mode := 'off';
  end;

  return jsonb_build_object(
    'authenticated',       true,
    'aal',                 v_aal,
    'is_aal2',             (v_aal = 'aal2'),
    'has_verified_factor', coalesce(v_has, false),
    'enforcement_mode',    coalesce(v_mode, 'off')
  );
exception when others then
  -- الفشل يُقرأ كـ«لا نعرف»، لا كـ«ممنوع»: هذه دالّة عرض، ولا يجوز أن تُظلم واجهة.
  return jsonb_build_object('authenticated', true, 'aal', null, 'is_aal2', false,
                            'has_verified_factor', false, 'enforcement_mode', 'off',
                            'read_error', sqlstate);
end $$;

revoke all    on function public.mfa_my_assurance() from public, anon;
grant  execute on function public.mfa_my_assurance() to authenticated, service_role;

do $$
declare v jsonb;
begin
  if to_regprocedure('public.mfa_my_assurance()') is null then
    raise exception 'فشل: mfa_my_assurance لم تُنشأ';
  end if;
  if has_function_privilege('anon', 'public.mfa_my_assurance()', 'execute') then
    raise exception 'فشل أمني: anon يملك EXECUTE على mfa_my_assurance';
  end if;

  -- يجب أن تعمل دون جلسة ودون رفع استثناء.
  select public.mfa_my_assurance() into v;
  if v is null then raise exception 'فشل: أعادت NULL'; end if;

  -- ولا تُسرّب أيّ معرّف جلسة أو ادّعاء خام.
  if (v ? 'sub') or (v ? 'session_id') or (v ? 'claim_keys') then
    raise exception 'فشل خصوصية: الدالّة تُعيد ادّعاءات خام — يجب أن تقتصر على مستوى التوثيق';
  end if;

  raise notice '✓ S3 تمّ: قراءة مستوى التوثيق جاهزة · لا إلزام · الوضع لم يتغيّر';
end $$;

commit;
