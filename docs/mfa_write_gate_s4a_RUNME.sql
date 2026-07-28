-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S4a · مُسنِد بوّابة الكتابة الحسّاسة — **لا يُطبَّق على أيّ دالّة بعد**
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ هذا الملفّ خامل تمامًا. ★
--   يُنشئ `mfa_write_ok()` و`mfa_require_aal2()` فقط. **لا شيء يستدعيهما**، فلا سلوك
--   يتغيّر بتشغيله. ربطهما بالدوال الحسّاسة هو S4b، بعد مراجعة قائمة البوّابات معك.
--   السبب: كل دالّة هدف تحتاج `create or replace` بجسمها الكامل، وأيّ خطأ نسخ هناك
--   يكسر إدارة المستخدمين. الفصل يجعل هذا الملفّ آمنًا للتشغيل الآن ومفيدًا للاختبار.
--
-- ★ اكتشافان من التدقيق يغيّران التنفيذ — اقرأهما قبل S4b ★
--
--   (1) **`admin_set_staff_role` لها أربعة تعريفات متنافسة.**
--       الفائز: `portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39`
--       وليس الملفّ المسمّى باسم الميزة (`staff_roles_task_assignment_RUNME.sql:172`)
--       وهو أقدم بأربعة أشهر. الدليل الحيّ: التعريف الفائز وحده يقبل مجموعة الـ12 دورًا
--       التي يشحنها `lib/portal/roles.ts:100-102` فعلًا مقابل قاعدة البيانات المنشورة.
--       ⇒ **بوّابة على التعريف المهجور = لا شيء، لكنها تبدو مُنجزة.** أخطر أنواع الفشل.
--
--   (2) **`mfa_admin_set_mode` يجب ألّا تُبوَّب إطلاقًا.**
--       اشتراط aal2 لتغيير وضع MFA يعني أن مالكًا فقد جهاز المصادقة **لا يستطيع
--       إطفاء الوضع أبدًا** — يصير زرّ الطوارئ نفسه خلف البوّابة التي يُفترض أن يفتحها.
--       تبقى على `is_owner()` فقط. وبما أن `'enforced'` ليست قيمة مشروعة أصلًا،
--       فالكلفة الأمنية لهذا الاستثناء ضئيلة، والكلفة البديلة كارثية.
--
-- ★ ترتيب الشروط ليس تجميليًا — كل سطر يمنع إقفالًا ★
--   `service_role` أوّلًا · ثم الوضع · ثم الدور · ثم امتلاك عامل · ثم aal2.
--
-- ★ السلامة ★  إضافي · idempotent · لا DROP · لا حذف · لا مساس بسياسات القراءة
--   ولا بـ`is_admin()`/`is_owner()`/`can_manage_projects()`.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regclass('public.mfa_settings') is null then
    raise exception 'mfa_settings غير موجود — شغّل mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · المُسنِد — يُعيد true (اسمح) في كل حالة غامضة
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mfa_write_ok()
returns boolean language plpgsql stable security definer set search_path = public, auth as $$
declare v_raw text; v_j jsonb; v_role text; v_mode text; v_has boolean; v_acct text; v_staff text;
begin
  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j := v_raw::jsonb; exception when others then v_j := null; end;

  -- (1) ★ service_role أوّلًا ودائمًا. ★
  --     مفاتيح الخدمة لا تحمل ادّعاء aal إطلاقًا. لو دُقّق الدور بعد أيّ شرط آخر لتوقّفت
  --     وظائف الكرون الثلاث صامتة عند 03:00، ولانكسرت مسارات الخادم كلّها.
  if coalesce(v_j ->> 'role', '') = 'service_role' then return true; end if;

  -- (2) زرّ الطوارئ. أيّ وضع غير 'enrollment' ⇒ لا بوّابة. أمر واحد يُطفئ كل شيء:
  --     update public.mfa_settings set enforcement_mode = 'off' where id = 1;
  begin
    select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  exception when others then v_mode := 'off';
  end;
  if coalesce(v_mode, 'off') <> 'enrollment' then return true; end if;

  -- (3) غير مُصادَق ⇒ اسمح. هذه ليست بوّابة مصادقة؛ الدوال المستهدفة تفرض
  --     is_admin()/is_owner() بنفسها. مهمّتنا مستوى التوثيق فقط، لا الهوية.
  if auth.uid() is null then return true; end if;

  -- (4) النطاق: owner / super_admin / admin فقط. الموظف والعميل لا يُبوَّبان.
  begin
    select account_type, staff_role into v_acct, v_staff
      from public.profiles where id = auth.uid();
  exception when others then return true;   -- تعذّر تحديد الدور ⇒ اسمح، لا تُخمّن
  end;
  if not (coalesce(v_acct, '') = 'admin' or coalesce(v_staff, '') = 'super_admin') then
    return true;
  end if;

  -- (5) ★ الثابت المانع للإقفال. ★
  --     لا يُمنع أحد إلّا إن كان **هو نفسه** يملك عاملًا مُفعَّلًا. فمن لم يسجّل بعد
  --     يمرّ دائمًا، ورفع الوضع إلى enrollment لا يمكن أن يقفل أحدًا. خاصية بنيوية لا سياسة.
  begin
    select exists (
      select 1 from auth.mfa_factors f
       where f.user_id = auth.uid() and f.status = 'verified' and f.factor_type = 'totp'
    ) into v_has;
  exception when others then return true;   -- تعذّرت القراءة ⇒ اسمح
  end;
  if not coalesce(v_has, false) then return true; end if;

  -- (6) وصلنا هنا ⇒ إداريّ، في وضع enrollment، ويملك عاملًا. الآن فقط نطلب aal2.
  return coalesce(v_j ->> 'aal', '') = 'aal2';

exception when others then
  -- ⚠️ **`true` عمدًا، وهذا عكس الغريزة المعتادة — لا "تُصلحه".**
  -- الحادثة الحاكمة في هذا المستودع كانت انهيارًا صفريًّا في بوّابة SECURITY DEFINER
  -- (`false OR NULL = NULL` فلم يُرفع الاستثناء قطّ). وهنا الخطر معكوس: هذه أداة
  -- **قادرة على الإقفال**، فالمجهول يجب أن يعني «اسمح» لا «امنع». عطل في قراءة
  -- الادّعاءات يجب أن يُنتج «MFA غير مفروضة»، لا «الجميع ممنوع».
  return true;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · الرافع — يُطلَق سطرًا واحدًا في أعلى كل دالّة حسّاسة (في S4b)
-- ─────────────────────────────────────────────────────────────────────────────
-- SQLSTATE مخصّص `P0002` لا نصّ رسالة: مطابقة النصوص هشّة وتنكسر مع الترجمة،
-- والـTypeScript سيميّز `mfa_required` من الكود لا من الجملة.
create or replace function public.mfa_require_aal2(p_action text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mfa_write_ok() then return; end if;
  begin
    perform public.mfa_audit('sensitive_write_denied', auth.uid(),
                             jsonb_build_object('action', coalesce(p_action, 'unknown')));
  exception when others then null;   -- تعذّر التدقيق لا يجوز أن يُبدّل قرار المنع
  end;
  raise exception 'mfa_required' using errcode = 'P0002',
    hint = 'أكمل التحقّق بخطوتين ثم أعد المحاولة / Complete two-step verification and retry';
end $$;

revoke all    on function public.mfa_write_ok()          from public, anon;
grant  execute on function public.mfa_write_ok()          to authenticated, service_role;
revoke all    on function public.mfa_require_aal2(text)   from public, anon;
grant  execute on function public.mfa_require_aal2(text)  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v boolean;
begin
  -- بلا جلسة يجب أن يسمح، لا أن يرفع.
  select public.mfa_write_ok() into v;
  if v is not true then
    raise exception 'فشل: المُسنِد منع متصلًا بلا جلسة — يجب أن يسمح ولا يمنع أبدًا في الغموض';
  end if;
  if v is null then raise exception 'فشل: المُسنِد أعاد NULL — انهيار صفري'; end if;

  -- لا شيء مبوَّب بعد: هذا الملفّ لا يعدّل أيّ دالّة أعمال.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'admin_set_staff_role'
                and pg_get_functiondef(p.oid) ilike '%mfa_require_aal2%') then
    raise exception 'فشل: هذا الملفّ لا يجوز أن يربط أيّ بوّابة — ذلك عمل S4b';
  end if;

  raise notice '✓ S4a: المُسنِد جاهز · لا دالّة مبوَّبة بعد · لا سلوك تغيّر';
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- زرّ الطوارئ (يعمل حتى بعد ربط البوّابات في S4b):
--   update public.mfa_settings set enforcement_mode = 'off' where id = 1;
-- ════════════════════════════════════════════════════════════════════════════
