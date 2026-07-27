-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P1.3 · إيقاف تقرير «القناة تعمل» أثناء انقطاع كامل
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ العيب الذي أخفى الانقطاع الأصلي، وسيُخفي التالي ★
--
--   في الحالة الحيّة الراهنة (معالج Apps Script غير منشور) يُصنّف العامل كلّ صفّ
--   `relay_handler_missing`، فيُبقيه `pending` **دون احتساب محاولة** ويعدّه `skipped`.
--   والنتيجة أن كلّ مؤشّرات الصحّة تقرأ صفرًا في آن واحد:
--
--     v_disabled_pending → يفلتر ('disabled','no_endpoint') فقط ................ 0
--     v_dead             → يشترط attempts >= 5 ................................. 0
--     v_retrying         → يشترط attempts > 0 .................................. 0
--     v_last_failed      → العامل يعدّها skipped لا failed ....................... 0
--
--   فيسقط الـCASE إلى `else 'active'` وتعرض الواجهة الشريط الأخضر «قناة البريد تعمل»
--   **بينما لا يُسلَّم أيّ بريد إطلاقًا**. أربعة مؤشّرات صفرية = «كل شيء بخير».
--
--   وأسوأ: لا يوجد فرع «قِدَم» — فكرون توقّف نهائيًا يُبقي آخر نبضة خضراء **إلى الأبد**.
--
-- ★ ما يغيّره هذا الملفّ ★
--   1) عدّاد جديد `relay_pending` يفصل قصّة «القناة مُطفأة عمدًا» عن «المُرحِّل مكسور».
--   2) ثلاثة فروع جديدة في CASE قبل `active`: relay_missing · failing · stale.
--   3) إسقاط الشرط الزائد `attempts >= 5` من `v_dead`.
--
-- ★ لماذا لا نضيف معامل `p_status` ★
--   الصيغة الحالية `pc_notify_monitor_v2(p_limit int default 150)`. إضافة معامل ثانٍ
--   بقيمة افتراضية تُنشئ صيغة **ثانية** (لأن `create or replace` لا يغيّر الصيغة، بل
--   يُنشئ دالّة جديدة)، فيصير النداء بمعامل واحد قابلًا للمطابقة مع كلتيهما ⇒ **42725**.
--   و`DROP` ممنوع. لذلك الصيغة **مُجمَّدة حرفيًا**، والتصفية تبقى في الواجهة كما هي.
--
-- ★ السلامة ★
--   • `create or replace` لدالّة قراءة فقط (`stable`) — لا DDL، لا تغيير بيانات.
--   • **مفاتيح الخرج القائمة كلّها محفوظة حرفيًا** فلا يحتاج أيّ كود TS/UI تعديلًا؛
--     `relay_pending` مفتاح **مُضاف** فقط.
--   • الجسم منسوخ من notifications_recovery_batch9c_RUNME.sql:101-187 دون تغيير
--     سوى ما ذُكر أعلاه.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regclass('public.email_deliveries') is null then
    raise exception 'email_deliveries غير موجود';
  end if;
  if to_regprocedure('public.pc_notify_monitor_v2(int)') is null then
    raise exception 'pc_notify_monitor_v2 غير مُثبَّتة — شغّل notifications_recovery_batch9c_RUNME.sql أولًا';
  end if;
end $$;

create or replace function public.pc_notify_monitor_v2(p_limit int default 150)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_items jsonb; v_counts jsonb; v_sev jsonb; v_evt jsonb;
  v_email_total int; v_portal_7d int; v_portal_unread int;
  v_queued_nowhere int; v_dead int; v_retrying int; v_disabled_pending int;
  v_relay_pending int;                                   -- P1.3: جديد
  v_last jsonb; v_channel text; v_email_enabled boolean; v_last_sent int; v_last_failed int;
  v_last_skipped int; v_ran_at timestamptz;              -- P1.3: جديد
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;

  -- عناصر الطابور الأحدث (نفس عقد v1 لتوافق الواجهة)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'status', d.status, 'attempts', d.attempts, 'subject', d.subject,
      'recipient_email', d.recipient_email,
      'recipient_name', (select pr.full_name from public.profiles pr where pr.id = d.recipient_id),
      'event_type', e.event_type, 'severity', e.severity,
      'direct_url', coalesce(d.direct_url, e.direct_url),
      'last_error', d.last_error, 'next_attempt_at', d.next_attempt_at,
      'sent_at', d.sent_at, 'created_at', d.created_at
    ) order by d.created_at desc), '[]'::jsonb) into v_items
  from (select * from public.email_deliveries order by created_at desc limit least(coalesce(p_limit,150), 300)) d
  left join public.notification_events e on e.id = d.event_id;

  select jsonb_object_agg(status, n) into v_counts
    from (select status, count(*) n from public.email_deliveries group by status) c;

  -- التصنيف حسب الشدّة/النوع خلال 30 يومًا (أبعاد المراقبة المطلوبة)
  select jsonb_object_agg(coalesce(sev,'unknown'), n) into v_sev from (
    select e.severity sev, count(*) n from public.email_deliveries d
      left join public.notification_events e on e.id = d.event_id
      where d.created_at > now() - interval '30 days' group by e.severity) s;
  select jsonb_object_agg(coalesce(evt,'(none)'), n) into v_evt from (
    select e.event_type evt, count(*) n from public.email_deliveries d
      left join public.notification_events e on e.id = d.event_id
      where d.created_at > now() - interval '30 days'
      group by e.event_type order by count(*) desc limit 25) t;

  select count(*) into v_email_total from public.email_deliveries;
  select count(*) into v_portal_7d from public.notifications where created_at > now() - interval '7 days';
  select count(*) into v_portal_unread from public.notifications
    where read_at is null and created_at > now() - interval '30 days';

  -- «بُثّ بلا بريد» الحقيقيّ: حدث حرِج/إجراء (يُفترض أن يصفّ بريدًا دائمًا) خرج
  -- للـOutbox بلا صفّ بريد أصلًا — شذوذ فعليّ. لا نعدّ الأحداث المعلوماتية (portal-only
  -- بحكم التصميم؛ لا مشترِك email_enabled) كي لا يُضخَّم المؤشّر بضجيج طبيعيّ.
  select count(*) into v_queued_nowhere from public.notification_events e
    where e.created_at > now() - interval '30 days'
      and e.severity in ('critical','action')
      and not exists (select 1 from public.email_deliveries d where d.event_id = e.id);

  -- P1.3 — أُسقط الشرط `and attempts >= 5`. العامل هو **الكاتب الوحيد** لـ'failed'
  -- ولا يكتبها إلا عند الوصول للحدّ الأقصى (lib/server/notifyWorker.ts، ومعه reapStuck
  -- بعد P1.2)، فـ status='failed' وحدها **هي** مجموعة الـdead-letter. الشرط الزائد لم
  -- يكن يضيف شيئًا، لكنه كان يربط SQL برقم ثابت في TypeScript لا يستطيع رؤيته: خفض
  -- MAX_ATTEMPTS إلى 3 كان سيجعل هذا العدّاد يقرأ صفرًا بينما الطابور يُسقِط رسائل فعلًا.
  select count(*) into v_dead     from public.email_deliveries where status = 'failed';
  select count(*) into v_retrying from public.email_deliveries where status = 'pending' and attempts > 0;
  select count(*) into v_disabled_pending from public.email_deliveries
    where status = 'pending' and last_error in ('disabled','no_endpoint');

  -- P1.3 — العدّاد الحاسم: صفوف مؤجَّلة لأن معالج المُرحِّل غير منشور. يُفصل عن
  -- disabled_pending عمدًا: «مُطفأة بقرار» قصّة كهرمانية، و«المُرحِّل مكسور» قصّة حمراء.
  select count(*) into v_relay_pending from public.email_deliveries
    where status = 'pending' and last_error = 'relay_handler_missing';

  select to_jsonb(r) into v_last from (
    select job, ok, stats, error, ran_at from public.notification_cron_runs
    order by ran_at desc limit 1) r;

  -- حالة القناة (صادقة لا خضراء زائفة):
  --   disabled     = القناة مُطفأة (email_enabled=false) أو صفوف عالقة disabled/no_endpoint.
  --   relay_missing= معالج Apps Script غير منشور ⇒ لا يُسلَّم شيء. أخطر حالة وأكثرها صمتًا.
  --   failing      = آخر تشغيل لم يُرسل شيئًا مع وجود إخفاقات أو تخطّيات — عطل مزوّد/قناة.
  --   stale        = لا نبضة كرون منذ 36 ساعة ⇒ الكرون نفسه ميّت (الجدولة يومية).
  --   active       = نبضة حديثة والإرسال يمرّ.   unknown = لا نبضة كرون بعد.
  v_email_enabled := (v_last -> 'stats' ->> 'email_enabled')::boolean;
  v_last_sent    := coalesce((v_last -> 'stats' ->> 'sent')::int, 0);
  v_last_failed  := coalesce((v_last -> 'stats' ->> 'failed')::int, 0);
  v_last_skipped := coalesce((v_last -> 'stats' ->> 'skipped')::int, 0);
  v_ran_at       := (v_last ->> 'ran_at')::timestamptz;
  v_channel := case
    when v_relay_pending > 0 then 'relay_missing'
    when v_disabled_pending > 0 or v_email_enabled = false then 'disabled'
    when v_last is null then 'unknown'
    -- قِدَم النبضة يسبق أيّ حكم بالسلامة: كرون ميّت لا يُنتج إخفاقات، ينتج صمتًا.
    when v_ran_at is null or v_ran_at < now() - interval '36 hours' then 'stale'
    when v_last_sent = 0 and (v_last_failed > 0 or v_last_skipped > 0) then 'failing'
    else 'active' end;

  return jsonb_build_object(
    'items', v_items,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'by_severity', coalesce(v_sev, '{}'::jsonb),
    'by_event', coalesce(v_evt, '{}'::jsonb),
    'by_channel', jsonb_build_object('email', v_email_total, 'portal_7d', v_portal_7d),
    'portal_inbox', jsonb_build_object('last7d', v_portal_7d, 'unread_30d', v_portal_unread),
    'queued_nowhere', v_queued_nowhere,
    'dead_letter', v_dead,
    'retrying', v_retrying,
    'disabled_pending', v_disabled_pending,
    'relay_pending', v_relay_pending,          -- P1.3: مفتاح مُضاف (لا يكسر أيّ قارئ)
    'channel_state', v_channel,
    'last_run', v_last,
    'generated_at', now());
end $$;

-- الصلاحيات كما هي (الدالّة تفرض can_manage_projects داخليًا).
revoke all    on function public.pc_notify_monitor_v2(int) from public, anon;
grant  execute on function public.pc_notify_monitor_v2(int) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  if to_regprocedure('public.pc_notify_monitor_v2(int)') is null then
    raise exception 'فشل: pc_notify_monitor_v2 اختفت';
  end if;
  -- لا يجوز أن تكون هناك صيغة ثانية (فخّ 42725).
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pc_notify_monitor_v2';
  if v_n <> 1 then
    raise exception 'فشل: يوجد % صيغة من pc_notify_monitor_v2 — النداء بمعامل واحد سيصبح ملتبسًا (42725)', v_n;
  end if;
  raise notice '✓ P1.3 تمّ: relay_missing/stale/failing مُفعَّلة · dead_letter لم يعد مرتبطًا برقم ثابت في TS';
end $$;

commit;
