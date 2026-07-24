-- ════════════════════════════════════════════════════════════════════════════
-- global_notifications_core_batch10_RUNME.sql   (BATCH 10 · PHASE 2 — CORE)
-- محرّك الإدراج المركزيّ الموحّد: notify_emit_event
--
-- الغاية: مسار بريد واحد لكلّ الوحدات. يستدعي المُحلِّل المركزيّ (9D)
-- notification_resolve_recipients لاستخراج المستلِمين الفعليّين، ثمّ يُدرِج صفوف
-- البريد في الطابور الوحيد email_deliveries (idempotency_key = dedupe_key من المُحلِّل،
-- correlation_id للتتبّع)، ويُعيد delivery_ids ليعالجها العامل فورًا بنمط المعرّفات
-- الدقيقة (event-bound) — لا مسح زمنيّ، لا اعتماد على cron اليوميّ.
--
-- لا جدول جديد · لا طابور ثانٍ · لا مزوّد ثانٍ · لا cron لكلّ وحدة · لا إرسال أثناء التطبيق.
-- Additive · Idempotent · Transactional · SECURITY DEFINER + search_path ثابت ·
-- خدمة-داخليّ (يستدعيه مسار الخادم بمفتاح الخدمة) · Self-test داخل Rollback.
-- تشغيل: psql "$DATABASE_URL" -f docs/global_notifications_core_batch10_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.email_deliveries') is null then raise exception '10.CORE PREFLIGHT: email_deliveries missing'; end if;
  if to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is null then
    raise exception '10.CORE PREFLIGHT: notification_resolve_recipients missing — run notifications_e2e_repair_batch9d_RUNME.sql first';
  end if;
end $pre$;

begin;

-- ─── أعمدة الربط بالحدث (idempotent — قد تكون مضافة في 9G/Phase0) ───
alter table public.email_deliveries add column if not exists correlation_id uuid;
alter table public.email_deliveries add column if not exists idempotency_key text;
create unique index if not exists uq_edel_idem on public.email_deliveries(idempotency_key) where idempotency_key is not null;
create index if not exists ix_edel_correlation on public.email_deliveries(correlation_id) where correlation_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- notify_emit_event — الإدراج المركزيّ الموحّد (بلا mutation؛ يُستدعى بعد حفظ الإجراء).
--   • يحلّ المستلِمين عبر المُحلِّل المركزيّ (9D) — مصدر واحد للحقيقة.
--   • يحترم email_allowed (يتركه المُحلِّل true للإلزاميّ؛ التفضيلات تُطبَّق في Phase 8).
--   • idempotency_key = dedupe_key من المُحلِّل (event:entity:user) ⇒ تكرار نفس
--     الحدث/الكيان/المستلِم لا يُضاعِف. مهمّ: مرِّر p_entity_id مميِّزًا لكلّ حدث؛ حدثٌ
--     بلا entity متكرِّر لنفس المستلِم سيُكبَح بعد المرّة الأولى (مفتاح واحد).
--   • يُعيد expected_recipients + new_ids (المُدرَج فعليًّا) + delivery_ids (كلّ صفوف الحدث).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.notify_emit_event(
  p_event text, p_entity_type text, p_entity_id uuid, p_project uuid,
  p_actor uuid, p_subject text, p_body text,
  p_payload jsonb default '{}'::jsonb, p_correlation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corr uuid := coalesce(p_correlation, gen_random_uuid());
  v_prefix text := 'evt:' || p_event || ':' || coalesce(p_entity_id::text, '-');
  rec record; v_key text; v_id uuid;
  v_new uuid[] := '{}'; v_all uuid[] := '{}'; v_keys text[] := '{}'; v_expected int := 0;
begin
  if p_subject is null or btrim(p_subject) = '' then
    return jsonb_build_object('ok', false, 'error', 'subject_required', 'correlation_id', v_corr,
      'expected_recipients', 0, 'new_ids', '[]'::jsonb, 'delivery_ids', '[]'::jsonb);
  end if;

  for rec in
    -- مستلِم واحد لكلّ user (قد يظهر بأكثر من دور)؛ بريد صالح فقط؛ email_allowed فقط.
    select distinct on (r.user_id)
           r.user_id as uid, lower(r.email) as email, r.action_url as url,
           coalesce(nullif(r.dedupe_key, ''), v_prefix || ':' || r.user_id::text) as dkey
    from public.notification_resolve_recipients(p_event, p_entity_type, p_entity_id, p_project, p_actor, coalesce(p_payload,'{}'::jsonb)) r
    where r.email_allowed is true
      and r.user_id is not null
      and r.email is not null and position('@' in r.email) > 0
    order by r.user_id, r.recipient_reason
  loop
    v_expected := v_expected + 1;
    v_key := rec.dkey;
    v_keys := v_keys || v_key;
    v_id := null;
    insert into public.email_deliveries(recipient_id, recipient_email, subject, body_text, direct_url, status, correlation_id, idempotency_key)
    values (rec.uid, rec.email, p_subject, p_body, rec.url, 'pending', v_corr, v_key)
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning id into v_id;
    if v_id is not null then v_new := v_new || v_id; end if;
  end loop;

  -- كلّ صفوف هذا الحدث (الجديدة + السابقة المطابقة للمفاتيح) لمعالجة دقيقة بالمعرّفات.
  if array_length(v_keys, 1) is not null then
    select coalesce(array_agg(id), '{}') into v_all from public.email_deliveries
      where correlation_id = v_corr or idempotency_key = any(v_keys);
  end if;

  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'event', p_event,
    'entity_id', p_entity_id, 'project_id', p_project,
    'expected_recipients', v_expected, 'new_ids', to_jsonb(v_new), 'delivery_ids', to_jsonb(v_all));
end $$;

-- ─── الصلاحيات: خدمة-داخليّ. المسار يستدعيها بمفتاح الخدمة بعد حفظ الإجراء؛ منح
--     service_role صراحةً بعد السحب من public (وإلّا permission-denied → البريد معطّل). ───
do $g$
begin
  execute 'revoke all on function public.notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid) from public, anon, authenticated';
  execute 'grant execute on function public.notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid) to service_role';
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «10.CORE FAIL …». Probe فعليّ لـnotify_emit_event (يُلغى بـsavepoint).
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_res jsonb;
begin
  if to_regprocedure('public.notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid)') is null then raise exception '10.CORE FAIL: notify_emit_event missing'; end if;
  if exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='notify_emit_event' and grantee in ('authenticated','anon','PUBLIC')) then raise exception '10.CORE FAIL: notify_emit_event must be service-only'; end if;
  if not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='notify_emit_event' and grantee='service_role') then raise exception '10.CORE FAIL: service_role must keep EXECUTE'; end if;

  -- (1) الموضوع الفارغ يُرفض بلا إدراج.
  v_res := public.notify_emit_event('custody.test_probe','custody', null, null, null, '', 'b', '{}'::jsonb, null);
  if coalesce((v_res->>'ok')::boolean, true) then raise exception '10.CORE FAIL: empty subject must return ok=false'; end if;

  -- (2) Probe كامل داخل savepoint — يستدعي المُحلِّل + يُدرِج ثمّ يُلغى (بلا صفوف باقية).
  begin
    v_res := public.notify_emit_event('custody.selftest_probe','custody',
             '00000000-0000-0000-0000-000000000010'::uuid, null, null,
             '10 core probe', 'body', '{}'::jsonb, null);
    if (v_res->>'ok')::boolean is not true then raise exception '10.CORE FAIL: emit returned ok=false — %', v_res; end if;
    -- delivery_ids يجب أن يكون مصفوفة (قد تكون فارغة إن لا مستلِمين في هذه البيئة).
    if jsonb_typeof(v_res->'delivery_ids') <> 'array' then raise exception '10.CORE FAIL: delivery_ids not an array'; end if;
    raise exception 'ROLLBACK_10_CORE_PROBE';
  exception
    when sqlstate '42P10' then raise exception '10.CORE FAIL: ON CONFLICT cannot infer the partial idempotency index';
    when others then if sqlerrm <> 'ROLLBACK_10_CORE_PROBE' then raise exception '10.CORE FAIL: emit probe error — %', sqlerrm; end if;
  end;

  raise notice '10.CORE SELF-TEST PASSED — unified notify_emit_event ready.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
