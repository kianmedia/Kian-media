-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع إصلاح D
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ **اقرأ قبل التشغيل.** هذا التراجع يُعيد فتح تصعيدٍ كامل للامتيازات:
--    أيّ حساب مسجَّل يستطيع بعده أن يكتب لنفسه staff_role = 'super_admin'
--    عبر PATCH /rest/v1/profiles، فيصير is_owner() ويتجاوز Fix A و Fix B معًا.
--    لا تُشغّله إلّا إن أثبتت الواجهة انحدارًا حقيقيًّا يستحيل إصلاحه بغيره،
--    وأعد تشغيل RUNME فور انتهاء التشخيص.
--
--    الانحدار المتوقَّع الوحيد هو فشل تعديل ملفّ شخصيّ من الواجهة. وقبل التراجع
--    تحقّق: هل النداء الفاشل PATCH على الجدول أم RPC؟ إن كان RPC فالسبب ليس هنا
--    إطلاقًا — دوالّ SECURITY DEFINER لا تتأثّر بمنح المتصل.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- §1 · إعادة المنحة الواسعة (وهي بالضبط ما يُعيد فتح الثغرة)
grant update on public.profiles to authenticated;

-- §2 · إعادة التدقيق إلى نصّه الأصليّ (phase0_migration.sql:700) — بلا staff_role
create or replace function public.trg_profile_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare changed jsonb := '{}';
begin
  if old.account_type   is distinct from new.account_type
     or old.account_status is distinct from new.account_status
     or old.client_level   is distinct from new.client_level
     or old.company_id     is distinct from new.company_id then
    perform public.log_activity(auth.uid(), 'admin', 'account.updated', 'profile', new.id,
      jsonb_build_object(
        'type',    jsonb_build_object('from', old.account_type,   'to', new.account_type),
        'status',  jsonb_build_object('from', old.account_status, 'to', new.account_status),
        'level',   jsonb_build_object('from', old.client_level,   'to', new.client_level),
        'company', jsonb_build_object('from', old.company_id,     'to', new.company_id)));
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

commit;

notify pgrst, 'reload schema';

-- ملاحظة: لا نُعيد منح INSERT/UPDATE/DELETE على جداول المهن والصلاحيات.
-- تلك محميّة بسياسات RLS للقراءة فقط أصلًا، ولم تكن الواجهة تكتب عليها مباشرةً
-- قطّ، فإعادتها تُوسّع السطح بلا أيّ مكسب تشغيليّ.
