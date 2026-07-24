-- ════════════════════════════════════════════════════════════════════════════
-- notifications_recovery_batch9c_RUNME.sql
-- BATCH 9 · Part 3 — استعادة تسليم الإشعارات (منصة + بريد) بوعي الأدوار.
--
-- تركيبيّ فوق النظام القائم — لا جدول إشعارات ثالث، ولا نظام موازٍ:
--   • صندوق البوابة        public.notifications  + public.notify()
--   • صندوق الأحداث/الطابور public.notification_events + public.email_deliveries
--   • البثّ الموحّد         public.pc_event_emit()  (منصة + بريد + Idempotency)
--   • عامل البريد           /api/cron/notify-email  (Backoff/Retry/Reaper/Max-5)
--
-- يعالج نقاط الانقطاع المُثبَتة بالتدقيق (read-only audit):
--   §0  انجراف قيد notifications.type (تعريفات متعارضة) يُسقِط إشعارات صحيحة
--       بصمت عبر مصيدة civ_notify — نستبدله بحارس صيغة متساهل (لا حذف بيانات).
--   §1  Observability: نبضة كرون + مراقب v2 يغطّي الرحلة كاملة (لا الطابور فقط):
--       queued-nowhere / dead-letter / صندوق البوابة / حالة القناة / آخر تشغيل.
--   §2  منتِجون مبنيّون لكنهم لا يُستدعَون/لا يُصدرون:
--       resource_alerts_scan (مبنيّ ولا يُستدعى) → يوصَل في الكرون؛
--       pc_governance_alerts_scan (مخاطرة/مشكلة حرجة) + pc_program_sla_scan (8D).
--   §3  ردّ العميل (اعتماد/تعديل/تنزيل) كان يبثّ admin فقط (recipient_id=null ⇒
--       لا بريد ولا إشعار للمكلَّف) — Trigger تكميليّ يُشعِر مكلَّف المخرَج.
--   §4  فجوات رحلة المستأجر (جاهز للتوقيع/مفعّل/متأخّر/مغلق) — Trigger تكميليّ واحد.
--   §5  مرجع سياسة المستلِمين بوعي الأدوار (توثيق-كبيانات، للاختبار والمراقبة).
--
-- Idempotent · Additive · بلا DROP لجداول/دوال الوصول · بلا temp tables في القراءة.
-- الإصلاحات لا تُفشل أبدًا العملية الأساسية (كل Trigger محاط بـexception guard).
-- تشغيل: psql "$DATABASE_URL" -f docs/notifications_recovery_batch9c_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Preflight: تأكيد أساسات النظام القائم (لا نبني بديلًا) ───
do $pre$
begin
  if to_regclass('public.notifications')        is null then raise exception '9C PREFLIGHT: public.notifications missing'; end if;
  if to_regclass('public.notification_events')  is null then raise exception '9C PREFLIGHT: public.notification_events missing'; end if;
  if to_regclass('public.email_deliveries')     is null then raise exception '9C PREFLIGHT: public.email_deliveries missing'; end if;
  if to_regclass('public.reminder_tracking')    is null then raise exception '9C PREFLIGHT: public.reminder_tracking missing'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null
    then raise exception '9C PREFLIGHT: pc_event_emit missing'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null
    then raise exception '9C PREFLIGHT: notify() missing'; end if;
  if to_regprocedure('public.can_manage_projects()') is null
    then raise exception '9C PREFLIGHT: can_manage_projects() missing'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0) إنهاء انجراف قيد notifications.type
-- عدّة هجرات تُعيد تعريف notifications_type_check بمجموعات متعارضة (custody يوسّع
-- إلى ~90 نوعًا؛ opportunity يُضيّق إلى 10) — الأخيرة تطبيقًا تفوز، فتُرفض أنواع
-- صحيحة (custody/rental/hr) وتُبتلع الاستثناء في civ_notify ⇒ إسقاط صامت للإشعار.
-- الحلّ: حارس صيغة متساهل (اسم حدث بصيغة snake_case) بدل قائمة enum هشّة.
-- توسيع لا تضييق — لا يرفض أيّ صفّ قائم؛ ينهي حرب التعريفات نهائيًا.
-- ════════════════════════════════════════════════════════════════════════════
do $type_guard$
begin
  -- لا نفشل إن وُجدت صفوف قديمة شاذّة: نتحقق أولًا من التوافق مع الصيغة.
  if exists (select 1 from public.notifications where type !~ '^[a-z][a-z0-9_]{2,60}$') then
    raise notice '9C §0: بعض صفوف notifications.type لا تطابق الصيغة — أُبقي القيد القديم كما هو.';
  else
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications
      add constraint notifications_type_check check (type is not null and type ~ '^[a-z][a-z0-9_]{2,60}$');
  end if;
end $type_guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) OBSERVABILITY — نبضة كرون + مراقب v2 يغطّي الرحلة كاملة
-- notification_cron_runs جدول تِلِمِتري لتشغيل الكرون (ليس جدول إشعارات) — يميّز
-- «القناة معطّلة» عن «الطابور يُصرَّف»، ويكشف الكرون الميت عن الطابور الهادئ.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.notification_cron_runs (
  id      bigint generated always as identity primary key,
  job     text not null default 'notify-email',
  ok      boolean not null default true,
  stats   jsonb not null default '{}',
  error   text,
  ran_at  timestamptz not null default now()
);
create index if not exists ix_notif_cron_runs_ran on public.notification_cron_runs(job, ran_at desc);

alter table public.notification_cron_runs enable row level security;
drop policy if exists ncr_admin_read on public.notification_cron_runs;
create policy ncr_admin_read on public.notification_cron_runs
  for select to authenticated using (public.can_manage_projects());
grant select on public.notification_cron_runs to authenticated;

-- مُسجّل النبضة (يُستدعى من الكرون بمفتاح الخدمة) — يقلّم إلى آخر 300 تشغيل.
create or replace function public.pc_notify_cron_record(
  p_job text, p_ok boolean, p_stats jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_cron_runs(job, ok, stats, error)
    values (coalesce(nullif(btrim(p_job),''),'notify-email'), coalesce(p_ok,true),
            coalesce(p_stats,'{}'::jsonb), nullif(btrim(coalesce(p_error,'')),''));
  delete from public.notification_cron_runs
    where id in (select id from public.notification_cron_runs order by ran_at desc offset 300);
end $$;

-- مراقب v2 (للإدارة): الطابور + التصنيف حسب الشدّة/النوع/القناة/الحالة +
-- queued-nowhere (بُثّ ولم يُصفّ) + dead-letter + صندوق البوابة + آخر نبضة + حالة القناة.
create or replace function public.pc_notify_monitor_v2(p_limit int default 150)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_items jsonb; v_counts jsonb; v_sev jsonb; v_evt jsonb;
  v_email_total int; v_portal_7d int; v_portal_unread int;
  v_queued_nowhere int; v_dead int; v_retrying int; v_disabled_pending int;
  v_last jsonb; v_channel text; v_email_enabled boolean; v_last_sent int; v_last_failed int;
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

  select count(*) into v_dead     from public.email_deliveries where status = 'failed' and attempts >= 5;
  select count(*) into v_retrying from public.email_deliveries where status = 'pending' and attempts > 0;
  select count(*) into v_disabled_pending from public.email_deliveries
    where status = 'pending' and last_error in ('disabled','no_endpoint');

  select to_jsonb(r) into v_last from (
    select job, ok, stats, error, ran_at from public.notification_cron_runs
    order by ran_at desc limit 1) r;

  -- حالة القناة (صادقة لا خضراء زائفة):
  --   disabled = القناة مُطفأة (email_enabled=false) أو صفوف عالقة disabled/no_endpoint.
  --   failing  = الكرون يعمل لكن كل إرسالات آخر تشغيل فشلت (sent=0 و failed>0) — عطل مزوّد.
  --   active   = نبضة موجودة والإرسال يمرّ.  unknown = لا نبضة كرون بعد.
  v_email_enabled := (v_last -> 'stats' ->> 'email_enabled')::boolean;
  v_last_sent   := coalesce((v_last -> 'stats' ->> 'sent')::int, 0);
  v_last_failed := coalesce((v_last -> 'stats' ->> 'failed')::int, 0);
  v_channel := case
    when v_disabled_pending > 0 or v_email_enabled = false then 'disabled'
    when v_last is null then 'unknown'
    when v_last_failed > 0 and v_last_sent = 0 then 'failing'
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
    'channel_state', v_channel,
    'last_run', v_last,
    'generated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) منتِجون مفقودون — أحداث تُصدَر عبر pc_event_emit (منصة + بريد + Idempotency)
-- كلها service-only (تُستدعى من الكرون)؛ dedup عبر reminder_tracking؛ العميل لا يُستلِم.
-- ════════════════════════════════════════════════════════════════════════════

-- (أ) مخاطرة/مشكلة حرجة تُسجَّل ولا يُشعَر بها أحد → تنبيه المدير + الملّاك (أسبوعيًا).
create or replace function public.pc_governance_alerts_scan()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare rec record; v_n int := 0; v_key text; v_admins uuid[]; v_mgr uuid[]; v_recips uuid[];
begin
  if auth.uid() is not null and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  select coalesce(array_agg(id), '{}') into v_admins from public.profiles where account_type = 'admin';

  -- مخاطر حرجة مفتوحة (project_risks موجود دومًا في النواة)
  for rec in
    select r.id, r.project_id, r.title, r.owner_id
    from public.project_risks r
    where r.is_deleted = false and r.severity = 'critical' and r.status not in ('closed','accepted')
  loop
    v_key := 'risk_critical:' || rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id), '{}') into v_mgr from public.project_members pm
      where pm.project_id = rec.project_id and pm.is_deleted = false and pm.role = 'kian_manager';
    v_recips := (select coalesce(array_agg(distinct x), '{}') from unnest(v_admins || v_mgr || rec.owner_id) t(x) where x is not null);
    perform public.pc_event_emit(rec.project_id, 'risk_critical', 'risk', rec.id, 'critical',
      'مخاطرة حرجة: ' || rec.title, 'Critical risk: ' || rec.title, null, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=risks', v_recips,
      v_key || ':' || to_char(current_date, 'IYYY-IW'));
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'risk', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
    v_n := v_n + 1;
  end loop;

  -- مشكلات حرجة مفتوحة (project_issues من 5A — قد لا يكون مطبّقًا)
  if to_regclass('public.project_issues') is not null then
    for rec in
      execute $q$select i.id, i.project_id, i.title, i.owner_id from public.project_issues i
        where i.is_deleted = false and i.severity = 'critical'
          and i.status not in ('resolved','closed','rejected')$q$
    loop
      v_key := 'issue_critical:' || rec.id;
      if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
      select coalesce(array_agg(pm.user_id), '{}') into v_mgr from public.project_members pm
        where pm.project_id = rec.project_id and pm.is_deleted = false and pm.role = 'kian_manager';
      v_recips := (select coalesce(array_agg(distinct x), '{}') from unnest(v_admins || v_mgr || rec.owner_id) t(x) where x is not null);
      perform public.pc_event_emit(rec.project_id, 'issue_critical', 'issue', rec.id, 'critical',
        'مشكلة حرجة: ' || rec.title, 'Critical issue: ' || rec.title, null, null,
        '/client-portal/project-core/' || rec.project_id || '?tab=governance', v_recips,
        v_key || ':' || to_char(current_date, 'IYYY-IW'));
      insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
        values (v_key, rec.project_id, 'issue', rec.id)
        on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
      v_n := v_n + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'emitted', v_n, 'scanned_at', now());
end $$;

-- (ب) اختراق التزام برنامج (8D) لا يُصدر شيئًا → تنبيه المدير + الملّاك (محميّ إن غاب 8D).
create or replace function public.pc_program_sla_scan()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_pid uuid; v_res jsonb; r jsonb; v_key text; v_admins uuid[]; v_mgr uuid[]; v_recips uuid[]; v_n int := 0;
begin
  if auth.uid() is not null and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  if to_regclass('public.project_program_commitments') is null
     or to_regprocedure('public.pgm_commitment_results_core(uuid,date,date,boolean)') is null then
    return jsonb_build_object('ok', true, 'emitted', 0, 'skipped', 'sla_not_installed');
  end if;
  select coalesce(array_agg(id), '{}') into v_admins from public.profiles where account_type = 'admin';

  for v_pid in select distinct project_id from public.project_program_commitments where is_active = true loop
    begin v_res := public.pgm_commitment_results_core(v_pid, null, null, false);
    exception when others then continue; end;   -- برنامج بلا بيانات كافية لا يُوقِف الباقي
    for r in select jsonb_array_elements(coalesce(v_res -> 'results', '[]'::jsonb)) loop
      if (r ->> 'status') = 'breached' then
        v_key := 'sla_breach:' || (r ->> 'commitment_id');
        if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
        select coalesce(array_agg(pm.user_id), '{}') into v_mgr from public.project_members pm
          where pm.project_id = v_pid and pm.is_deleted = false and pm.role = 'kian_manager';
        v_recips := (select coalesce(array_agg(distinct x), '{}') from unnest(v_admins || v_mgr) t(x) where x is not null);
        perform public.pc_event_emit(v_pid, 'program_sla_breach', 'program_commitment',
          (r ->> 'commitment_id')::uuid, 'critical',
          'اختراق التزام برنامج: ' || coalesce(r ->> 'name_ar', r ->> 'commitment_key'),
          'Program SLA breached: ' || coalesce(r ->> 'name_en', r ->> 'commitment_key'), null, null,
          '/client-portal/project-core/' || v_pid || '?tab=program_sla', v_recips,
          v_key || ':' || to_char(current_date, 'IYYY-IW'));
        insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
          values (v_key, v_pid, 'program_commitment', (r ->> 'commitment_id')::uuid)
          on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'emitted', v_n, 'scanned_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) ردّ العميل → إشعار مكلَّف المخرَج (Trigger تكميليّ — بلا مساس بالمنتِج القائم)
-- المنتِج القائم يبثّ admin فقط (recipient_id=null ⇒ الجسر يتجاهله ⇒ لا بريد ولا
-- إشعار للمكلَّف). نُضيف Trigger يُشعِر المكلَّف عبر pc_event_emit (منصة + بريد).
-- مستلِم مختلف (المكلَّف لا الأدمن) ⇒ لا ازدواج. exception guard ⇒ لا يُفشل المراجعة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_review_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_assignee uuid; v_title text; v_ar text; v_en text; v_evt text;
begin
  select d.project_id, d.assignee_id, d.title into v_proj, v_assignee, v_title
    from public.deliverables d where d.id = new.deliverable_id and d.is_deleted = false;
  if v_assignee is null or v_proj is null then return new; end if;
  if new.decision = 'revision_requested' then
    v_evt := 'client_revision_requested';
    v_ar := 'العميل طلب تعديلًا على: ' || coalesce(v_title,''); v_en := 'Client requested a revision: ' || coalesce(v_title,'');
  else
    v_evt := 'client_deliverable_approved';
    v_ar := 'العميل اعتمد المخرَج: ' || coalesce(v_title,''); v_en := 'Client approved the deliverable: ' || coalesce(v_title,'');
  end if;
  perform public.pc_event_emit(v_proj, v_evt, 'deliverable', new.deliverable_id, 'action',
    v_ar, v_en, null, null, '/client-portal/project-core/' || v_proj || '?tab=deliverables',
    array[v_assignee], 'client_review:' || new.id::text);
  return new;
exception when others then return new;   -- الإشعار لا يُفشل قرار المراجعة أبدًا
end $$;

create or replace function public.pc_download_notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_assignee uuid; v_title text;
begin
  if coalesce(new.asset_kind,'') <> 'final' then return new; end if;
  select d.assignee_id, d.title into v_assignee, v_title
    from public.deliverables d where d.id = new.deliverable_id and d.is_deleted = false;
  if v_assignee is null then return new; end if;
  perform public.pc_event_emit(new.project_id, 'client_final_download', 'deliverable', new.deliverable_id, 'info',
    'بدأ العميل تنزيل الملف النهائي: ' || coalesce(v_title,''),
    'Client started the final download: ' || coalesce(v_title,''), null, null,
    '/client-portal/project-core/' || new.project_id || '?tab=deliverables', array[v_assignee],
    'client_dl:' || new.deliverable_id::text || ':' || to_char(current_date, 'YYYYMMDD'));
  return new;
exception when others then return new;
end $$;

-- ربط الـTriggers محميًّا بوجود الجدول (بيئات بلا مسار العميل تتخطّى بأمان).
do $tg3$
begin
  if to_regclass('public.deliverable_reviews') is not null then
    drop trigger if exists trg_review_notify_assignee on public.deliverable_reviews;
    create trigger trg_review_notify_assignee after insert on public.deliverable_reviews
      for each row execute function public.pc_review_notify_assignee();
  end if;
  if to_regclass('public.deliverable_downloads') is not null then
    drop trigger if exists trg_download_notify_assignee on public.deliverable_downloads;
    create trigger trg_download_notify_assignee after insert on public.deliverable_downloads
      for each row execute function public.pc_download_notify_assignee();
  end if;
end $tg3$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) رحلة المستأجر — إشعار المستأجر عند التحوّلات المفقودة (Trigger تكميليّ واحد)
-- الفجوات المُثبَتة: عقد جاهز/مفعّل/متأخّر/مغلق تُشعِر الإدارة فقط. كلها تحوّلات
-- status على custody_rental_requests ⇒ Trigger واحد يُغلقها بلا مساس بأيّ RPC.
-- civ_notify (بحكم تصميمه) بريد portal-only لأنواع rental_ (لا مبالغ في البريد).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.rental_notify_renter_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_no text; v_type text; v_ar text; v_en text;
begin
  if new.status is not distinct from old.status then return new; end if;
  -- الحالة الحيّة لجاهزية العقد في دورة V1 هي contract_pending_signature (RPC توليد العقد)؛
  -- 'contracted' قيمة enum قديمة (patch-05) لا يُسنِدها أيّ مسار حيّ — نُبقيها للصفوف القديمة فقط.
  if new.status not in ('contract_pending_signature','contracted','active','overdue','closed') then return new; end if;
  select c.user_id into v_user from public.custody_rental_customers c where c.id = new.customer_id;
  if v_user is null then return new; end if;   -- مستأجر بلا حساب بوابة (walk-in)
  v_no := coalesce(new.request_number, '');
  if new.status in ('contract_pending_signature','contracted') then
    v_type := 'rental_contract_ready'; v_ar := 'عقد الإيجار جاهز للمراجعة والتوقيع ' || v_no; v_en := 'Your rental contract is ready to sign ' || v_no;
  elsif new.status = 'active' then
    v_type := 'rental_activated';      v_ar := 'بدأ عقد الإيجار (تم التسليم) ' || v_no;      v_en := 'Your rental is now active ' || v_no;
  elsif new.status = 'overdue' then
    v_type := 'rental_overdue';        v_ar := 'تجاوز موعد إرجاع الإيجار — يُرجى الإرجاع ' || v_no; v_en := 'Your rental is overdue — please return ' || v_no;
  else
    v_type := 'rental_closed';         v_ar := 'تم إغلاق عقد الإيجار ' || v_no;               v_en := 'Your rental has been closed ' || v_no;
  end if;
  perform public.civ_notify(v_user, v_type, new.id, v_ar, v_en);
  return new;
exception when others then return new;   -- الإشعار لا يُفشل تحوّل الإيجار أبدًا
end $$;

do $tg4$
begin
  if to_regclass('public.custody_rental_requests') is not null
     and to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)') is not null then
    drop trigger if exists trg_rental_notify_renter on public.custody_rental_requests;
    create trigger trg_rental_notify_renter after update of status on public.custody_rental_requests
      for each row execute function public.rental_notify_renter_transition();
  end if;
end $tg4$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) مرجع سياسة المستلِمين بوعي الأدوار (توثيق-كبيانات — للاختبار والمراقبة)
-- لا موجِّه موازٍ: المنتِجون يقرّرون المستلِمين؛ هذا يوثّق السياسة المقصودة نصًّا
-- ويؤكّد أنّ التنفيذ الحيّ يطابقها. Owner/Admin=كلّ ما يخصّهم · Client=قائمة صريحة ·
-- Employee=عمله فقط · Renter=عقده فقط.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_notification_policy()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'version', '9c',
    'roles', jsonb_build_object(
      'owner_admin', 'كل الأحداث الداخلية/التشغيلية المؤهَّلة (مالية/مخاطر/مشكلات/تكلفة/تنفيذي/إغلاق/SLA).',
      'employee',    'عمله فقط — مهام/مخرجات/جلسات/حجوزات مُسنَدة إليه + عهدته الخاصة.',
      'client',      'قائمة صريحة — مخرَج جاهز/معتمد/طلب تعديل، تسليم نهائي، تغيّر حالة؛ لا مخاطر/مشكلات/تكلفة/موارد/تقييم فريق/SLA داخليّة.',
      'renter',      'عقده فقط — طلب/موافقة/رفض/تعديل/عقد جاهز/تفعيل/تأخّر/إغلاق.'),
    'enforced_by', jsonb_build_object(
      'internal_events', 'pc_notify_team يُرشّح role like kian_% (العميل مُستبعَد)',
      'client_events',   'project_client_user_ids() قائمة سماح صريحة',
      'employee_events', 'assignee_id / employee_user_id مستلِم محدّد',
      'renter_events',   'custody_rental_customers.user_id لكل عقد؛ civ_notify بريد portal-only لأنواع rental_'),
    'generated_at', now());
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- الصلاحيات — الماسحات/المُسجّل داخليّة (خدمة فقط)؛ المراقب/السياسة للمصرّح؛
-- دوال الـTriggers لا تُستدعى مباشرة.
-- ════════════════════════════════════════════════════════════════════════════
do $grants$
declare f text;
begin
  -- داخليّة (service-only عبر الكرون): كـpc_reminders_scan تمامًا.
  foreach f in array array[
    'public.pc_notify_cron_record(text,boolean,jsonb,text)',
    'public.pc_governance_alerts_scan()',
    'public.pc_program_sla_scan()',
    'public.pc_review_notify_assignee()',
    'public.pc_download_notify_assignee()',
    'public.rental_notify_renter_transition()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- للمصرّح (الواجهة): المراقب + مرجع السياسة.
  foreach f in array array[
    'public.pc_notify_monitor_v2(int)',
    'public.pc_notification_policy()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $grants$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «9C FAIL …» عند أيّ خلل (يُبطِل الـcommit)
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_cnt int;
begin
  -- (1) الدوال الجديدة موجودة
  if to_regprocedure('public.pc_notify_monitor_v2(int)') is null then raise exception '9C FAIL: pc_notify_monitor_v2 missing'; end if;
  if to_regprocedure('public.pc_notify_cron_record(text,boolean,jsonb,text)') is null then raise exception '9C FAIL: pc_notify_cron_record missing'; end if;
  if to_regprocedure('public.pc_governance_alerts_scan()') is null then raise exception '9C FAIL: pc_governance_alerts_scan missing'; end if;
  if to_regprocedure('public.pc_program_sla_scan()') is null then raise exception '9C FAIL: pc_program_sla_scan missing'; end if;
  if to_regprocedure('public.pc_notification_policy()') is null then raise exception '9C FAIL: pc_notification_policy missing'; end if;

  -- (2) جدول النبضة + RLS
  if to_regclass('public.notification_cron_runs') is null then raise exception '9C FAIL: notification_cron_runs missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_cron_runs' and policyname='ncr_admin_read')
    then raise exception '9C FAIL: notification_cron_runs RLS policy missing'; end if;

  -- (3) المراقب مُقيَّد بالإدارة
  v_def := pg_get_functiondef('public.pc_notify_monitor_v2(int)'::regprocedure);
  if position('can_manage_projects' in v_def) = 0 then raise exception '9C FAIL: monitor v2 not admin-gated'; end if;
  if position('queued_nowhere' in v_def) = 0 or position('channel_state' in v_def) = 0
    then raise exception '9C FAIL: monitor v2 missing full-journey fields'; end if;

  -- (4) الماسحات الداخلية محرومة من authenticated (لا سطح إساءة)
  if exists (select 1 from information_schema.routine_privileges
             where routine_schema='public' and routine_name='pc_governance_alerts_scan' and grantee='authenticated')
    then raise exception '9C FAIL: pc_governance_alerts_scan must be service-only'; end if;
  if exists (select 1 from information_schema.routine_privileges
             where routine_schema='public' and routine_name='pc_program_sla_scan' and grantee='authenticated')
    then raise exception '9C FAIL: pc_program_sla_scan must be service-only'; end if;

  -- (5) قيد النوع (إن طُبّق §0) متساهل الصيغة لا enum ثابت
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname='notifications_type_check';
  if v_def is not null and position('~' in v_def) = 0 and position('rental_' in v_def) = 0 then
    -- قيد قديم enum ما زال ساريًا (صفوف شاذّة منعت §0) — تحذير لا فشل.
    raise notice '9C §0 note: قيد notifications.type ما زال enum قديمًا — راجع صفوفًا شاذّة.';
  end if;

  -- (6) الماسحات تُنفَّذ بلا خطأ — داخل Savepoint يُلغى (بلا انبعاث فعليّ أثناء الهجرة).
  --     أيّ خطأ حقيقيّ في متن الماسح ⇒ 9C FAIL؛ الحارس ROLLBACK_PROBE يُلغي أيّ صفوف انبعثت.
  begin
    perform public.pc_governance_alerts_scan();
    perform public.pc_program_sla_scan();
    raise exception 'ROLLBACK_PROBE';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROBE' then raise exception '9C FAIL: scan body raised %', sqlerrm; end if;
  end;

  -- (7) مرجع السياسة يذكر الأدوار الأربعة
  v_def := public.pc_notification_policy()::text;
  if position('owner_admin' in v_def)=0 or position('employee' in v_def)=0
     or position('client' in v_def)=0 or position('renter' in v_def)=0
    then raise exception '9C FAIL: policy reference missing a role'; end if;

  raise notice '9C SELF-TEST PASSED — notifications recovery ready.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
