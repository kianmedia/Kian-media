-- ════════════════════════════════════════════════════════════════════════════
-- wave8_push_tokens_ROLLBACK.sql — تراجع Wave 8 · V2-8.3-A
--
-- ⚠️ اقرأ قبل التشغيل: هذا التراجع **يحذف تسجيلات الأجهزة**. وهي ليست بيانات
--    عمل يمكن استرجاعها من مكان آخر — الجهاز يجب أن يُعيد التسجيل بنفسه.
--    ⛔ ولا يُشغَّل إلّا بقرار صريح، وبعد نسخة احتياطية.
--
-- 🔴 والأهمّ: التراجع **لا يُعيد قيد القناة إلى صورته القديمة افتراضيًّا**، لأنّ
--    صفوفًا بقناة 'push' قد تكون كُتبت في سجلّ التسليم. وتضييق القيد فوقها يُفشل
--    كلّ كتابة لاحقة على الجدول. §٣ يفحص ذلك ويرفض التضييق إن وُجدت.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ١ · الدوالّ
drop function if exists public.push_register_token(text,text,text,text,text);
drop function if exists public.push_revoke_my_tokens(text,text);
drop function if exists public.push_my_devices();
drop function if exists public.push_mark_invalid(text,text);

-- ٢ · الجدول (ومعه سياساته وفهارسه)
drop table if exists public.push_tokens;

-- ٣ · قيد القناة — يُضيَّق فقط إن لم توجد صفوف 'push'
do $$
declare v_push_rows bigint; c_name text;
begin
  select count(*) into v_push_rows
  from public.notification_delivery_log where channel = 'push';

  if v_push_rows > 0 then
    raise notice 'ROLLBACK: تُركت قيمة channel=push في القيد — يوجد % صفًّا يستعملها. '
                 'تضييق القيد فوقها يُفشل كتابات لاحقة.', v_push_rows;
  else
    select con.conname into c_name
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname='public' and rel.relname='notification_delivery_log'
      and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%channel%'
    limit 1;
    if c_name is not null then
      execute format('alter table public.notification_delivery_log drop constraint %I', c_name);
    end if;
    alter table public.notification_delivery_log
      add constraint notification_delivery_log_channel_check
      check (channel in ('portal','email','both','none'));
  end if;
end $$;

-- ٤ · عمود التفضيل — ⛔ **لا يُحذف**
-- حذف عمود تفضيل يمحو اختيار المستخدم نهائيًّا، وإعادة التشغيل لاحقًا تُعيده
-- إلى false فيظنّ من فعّله أنّ النظام «نسي» قراره. تركه false لا يُفعّل شيئًا.
-- alter table public.notification_preferences drop column push_enabled;  -- متعمَّد التعطيل

commit;
\echo '=== ROLLBACK منتهٍ. push_enabled بقي عمدًا. ==='
