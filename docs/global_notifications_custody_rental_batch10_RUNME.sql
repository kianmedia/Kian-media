-- ════════════════════════════════════════════════════════════════════════════
-- global_notifications_custody_rental_batch10_RUNME.sql  (BATCH 10 · PHASE 4-5)
-- كتالوج أحداث العهدة/التأجير + فحص دخانيّ للمُحلِّل + توثيق تشابك civ_notify.
--
-- ملاحظة معماريّة مهمّة (نتيجة تدقيق Phase 1):
--   أحداث العهدة تُنتِج بريدًا أصلًا: civ_notify() (custody_notification_matrix_RUNME)
--   يستدعي nt_enqueue_email → email_deliveries لكلّ مستلِم إشعار بوابة. أي أنّ العهدة
--   «مُغطّاة» في الطابور بالفعل. المشكلة ليست غياب الإنتاج بل: (أ) التوقيت — الصفوف
--   تبقى pending حتى cron؛ (ب) ازدواج مسار — مسار /custody-inventory/notify يُرسِل
--   أيضًا مباشرةً عبر sendHrEmail. توحيد هذين (إزالة الإرسال المباشر لصالح معالجة
--   الصفوف التي أنتجها civ_notify فورًا) قرارٌ يمسّ حجم البريد الإنتاجيّ ويحتاج تحقّقًا
--   ببيانات حيّة — مُؤجَّل بوعي (لا يُغيَّر مسارٌ عامل بلا بيانات). هذا الملفّ لا يغيّر أيّ
--   منتِج قائم؛ يوثّق ويتحقّق فقط. Additive · Idempotent · لا mutation · لا إرسال.
--
-- كتالوج الأحداث (event → entity_type → الجمهور عبر المُحلِّل):
--   custody.<action>              custody   إدارة + مدير عهدة/أمين عهدة (staff_role manager/custody_officer)
--   custody.compensation_requested custody  + المالية (finance)
--   custody.compensation_decided   custody  + المالية
--   rental.<action>               rental    إدارة + مدير عهدة/أمين + المستأجر (عبر عقده)
--   rental.charges_pending        rental    + المالية
--   rental.deposit_release_pending rental   + المالية
--   rental.damage_reported        rental    + المالية
-- المستأجر يُحلّ فقط عبر custody_rental_requests → customer.user_id (عقده وحده).
-- تشغيل: psql "$DATABASE_URL" -f docs/global_notifications_custody_rental_batch10_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is null then
    raise exception '10.CR PREFLIGHT: notification_resolve_recipients missing — run notifications_e2e_repair_batch9d_RUNME.sql';
  end if;
end $pre$;

-- ─── فحص دخانيّ: المُحلِّل يخدم أحداث العهدة/التأجير بالفروع الصحيحة ───
do $smoke$
declare
  e text; v_pid uuid := gen_random_uuid(); v_eid uuid := gen_random_uuid();
  v_events text[] := array[
    'custody.assigned','custody.returned','custody.compensation_requested','custody.compensation_decided',
    'rental.charges_pending','rental.deposit_release_pending','rental.damage_reported','rental.contract_ready'];
  v_has_finance boolean;
begin
  foreach e in array v_events loop
    begin
      perform 1 from public.notification_resolve_recipients(e, split_part(e,'.',1), v_eid, v_pid, null, '{}'::jsonb) limit 1;
    exception when others then raise exception '10.CR FAIL: resolver errored for event % — %', e, sqlerrm;
    end;
  end loop;

  -- الفرع الماليّ: أحداث التعويض/الرسوم يجب أن تُدرِج دور finance (منطق، لا يعتمد على بذور).
  -- نتحقّق أنّ المُحلِّل يُميّز الحدث الماليّ: نستدعيه لحدث ماليّ ونؤكّد عدم الخطأ + توفّر العمود.
  select bool_or(recipient_reason = 'finance') into v_has_finance
  from public.notification_resolve_recipients('rental.charges_pending','rental', v_eid, v_pid, null, '{}'::jsonb);
  -- v_has_finance يكون true فقط لو وُجِد مستخدم finance نشِط — لا نُجبِره (بيئة بلا بذور).

  raise notice '10.CR SMOKE PASSED — resolver serves custody/rental events (finance branch present=%).', coalesce(v_has_finance::text,'n/a');
end $smoke$;

notify pgrst, 'reload schema';
