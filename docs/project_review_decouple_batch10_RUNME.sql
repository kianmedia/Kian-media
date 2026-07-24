-- ════════════════════════════════════════════════════════════════════════════
-- project_review_decouple_batch10_RUNME.sql   (BATCH 10 · PHASE 0)
-- فصل قرار العميل عن الإشعارات — استعادة الاعتماد/طلب التعديل فورًا.
--
-- Regression بعد 9G: مسار /project/review يستدعي RPC واحدة (قرار + إدراج بريد) في
-- عملية واحدة؛ أيّ فشل في جزء الإدراج (RPC غير مطبّقة/صلاحية/عمود) يُلغي القرار كلّه
-- → «تعذر تسجيل قرارك». الحلّ: القرار يُحفظ عبر client_review_version القديمة (خطوة
-- مستقلّة committed)، ثم الإشعارات best-effort عبر RPC إدراج-فقط (بلا mutation).
--
-- هذا الملفّ يضيف مسار الإدراج-فقط review_enqueue_notifications (بلا تسجيل قرار)،
-- ذاتيّ الاكتفاء (يُنشئ الأعمدة + المُدرِج الداخليّ إن غابا) — لا يعتمد على تطبيق 9G.
-- الأهمّ: المسار (TS) يُصلح الـRegression حتى بدون تطبيق هذا الـSQL (القرار يُحفظ أوّلًا).
--
-- Additive · Idempotent · Transactional · لا DROP · لا جدول/طابور جديد · لا إرسال
-- أثناء التطبيق · SECURITY DEFINER + search_path ثابت · Self-test داخل Rollback.
-- تشغيل: psql "$DATABASE_URL" -f docs/project_review_decouple_batch10_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.email_deliveries') is null then raise exception '10.0 PREFLIGHT: email_deliveries missing'; end if;
  if to_regprocedure('public.client_review_version(uuid,text,text)') is null then raise exception '10.0 PREFLIGHT: client_review_version missing'; end if;
  if to_regclass('public.deliverable_versions') is null then raise exception '10.0 PREFLIGHT: deliverable_versions missing'; end if;
  if to_regprocedure('public.project_client_user_ids(uuid)') is null then raise exception '10.0 PREFLIGHT: project_client_user_ids missing'; end if;
end $pre$;

begin;

-- ─── أعمدة الربط بالحدث (idempotent — قد تكون مضافة في 9G) ───
alter table public.email_deliveries add column if not exists correlation_id uuid;
alter table public.email_deliveries add column if not exists idempotency_key text;
create unique index if not exists uq_edel_idem on public.email_deliveries(idempotency_key) where idempotency_key is not null;
create index if not exists ix_edel_correlation on public.email_deliveries(correlation_id) where correlation_id is not null;

-- ─── المُدرِج الداخليّ (CREATE OR REPLACE — يضمن نسخة صحيحة ON CONFLICT حتى لو 9G أقدم) ───
-- يحلّ (إدارة + مدير مشروع + مكلَّف [+ عميل]) ويُدرِج صفوف البريد مع idempotency+correlation.
create or replace function public.nt_event_enqueue_internal(
  p_correlation uuid, p_idem_prefix text, p_entity_id uuid, p_project uuid,
  p_assignee uuid, p_include_client boolean, p_subject text, p_body text, p_url text, p_client_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_new uuid[] := '{}'; v_all uuid[] := '{}'; v_expected int := 0; v_key text; v_id uuid; v_is_client boolean;
begin
  for rec in
    with recips as (
      select p.id as uid, coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),'')) as email, false as is_client
      from public.profiles p left join auth.users au on au.id = p.id
      where p.account_status = 'active' and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager'))
      union
      select pm.user_id, coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),'')), false
      from public.project_members pm
      left join auth.users au on au.id = pm.user_id left join public.profiles pr on pr.id = pm.user_id
      where pm.project_id = p_project and pm.is_deleted = false and pm.role = 'kian_manager' and pm.user_id is not null
      union
      select p_assignee, coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),'')), false
      from (select 1) x left join auth.users au on au.id = p_assignee left join public.profiles pr on pr.id = p_assignee
      where p_assignee is not null
      union
      select cu.user_id, coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),'')), true
      from public.project_client_user_ids(p_project) cu
      left join auth.users au on au.id = cu.user_id left join public.profiles pr on pr.id = cu.user_id
      where p_include_client = true
    )
    select distinct on (uid) uid, lower(email) as email, is_client from recips
    where uid is not null and email is not null and position('@' in email) > 0
    order by uid, is_client
  loop
    v_expected := v_expected + 1;
    v_is_client := rec.is_client;
    v_key := p_idem_prefix || ':' || rec.uid::text || ':email';
    v_id := null;
    insert into public.email_deliveries(recipient_id, recipient_email, subject, body_text, direct_url, status, correlation_id, idempotency_key)
    values (rec.uid, rec.email, p_subject, p_body,
            case when v_is_client then coalesce(p_client_url, p_url) else p_url end,
            'pending', p_correlation, v_key)
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning id into v_id;
    if v_id is not null then v_new := v_new || v_id; end if;
  end loop;

  select coalesce(array_agg(id), '{}') into v_all from public.email_deliveries
    where correlation_id = p_correlation
       or left(idempotency_key, length(p_idem_prefix) + 1) = p_idem_prefix || ':';

  return jsonb_build_object('expected_recipients', v_expected, 'new_ids', to_jsonb(v_new), 'delivery_ids', to_jsonb(v_all));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- إدراج إشعار قرار العميل — بلا mutation (القرار محفوظ سابقًا بخطوة مستقلّة).
-- خدمة-داخليّ: يستدعيه المسار بعد نجاح client_review_version؛ لا يُنفّذ أيّ تغيير أعمال.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.review_enqueue_notifications(
  p_version uuid, p_decision text, p_correlation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corr uuid := coalesce(p_correlation, gen_random_uuid());
  v_deliverable uuid; v_project uuid; v_title text; v_proj text; v_assignee uuid;
  v_subject text; v_body text; v_url text; v_enq jsonb;
begin
  select dv.deliverable_id, d.project_id, d.title into v_deliverable, v_project, v_title
    from public.deliverable_versions dv join public.deliverables d on d.id = dv.deliverable_id
    where dv.id = p_version;
  if v_deliverable is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'correlation_id', v_corr,
      'expected_recipients', 0, 'new_ids', '[]'::jsonb, 'delivery_ids', '[]'::jsonb);
  end if;
  begin select assignee_id into v_assignee from public.deliverables where id = v_deliverable; exception when others then v_assignee := null; end;
  -- BATCH 11 — كان `select name` وهو عمود غير موجود: العمود الصحيح project_name.
  -- الخطأ 42703 كان يُجهض الدالّة كلّها ⇒ لا يُنشَأ أيّ صفّ بريد لاعتماد العميل إطلاقًا.
  select project_name into v_proj from public.projects where id = v_project;

  v_subject := case when p_decision = 'approved' then 'اعتمد العميل مخرجًا: ' else 'طلب العميل تعديلًا: ' end || coalesce(v_title, '');
  v_body := 'المشروع: ' || coalesce(v_proj, '') || E'\nالمخرَج: ' || coalesce(v_title, '') ||
            E'\nقرار العميل: ' || (case when p_decision = 'approved' then 'اعتماد' else 'طلب تعديل' end);
  v_url := '/client-portal/project-core/' || v_project || '?tab=deliverables';

  -- منع ازدواج المكلَّف من محفّز 9C (idempotency_key غير فارغ لصفوفنا).
  if v_assignee is not null and to_regclass('public.notification_events') is not null then
    update public.email_deliveries set status = 'skipped', last_error = 'superseded_event_bound'
    where status = 'pending' and idempotency_key is null and recipient_id = v_assignee
      and event_id in (select id from public.notification_events
                       where entity_id = v_deliverable and event_type in ('client_deliverable_approved','client_revision_requested'));
  end if;

  v_enq := public.nt_event_enqueue_internal(
    v_corr, 'rev:' || p_version::text || ':' || p_decision, v_deliverable, v_project,
    v_assignee, false, v_subject, v_body, v_url, null);

  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'decision', p_decision,
    'entity_id', v_deliverable, 'project_id', v_project,
    'expected_recipients', v_enq->'expected_recipients', 'new_ids', v_enq->'new_ids', 'delivery_ids', v_enq->'delivery_ids');
end $$;

-- ─── الصلاحيات: خدمة-داخليّ فقط. المسار يستدعي review_enqueue_notifications بمفتاح
--     الخدمة (service_role) بعد نجاح القرار؛ لذا يجب منح service_role صلاحية التنفيذ
--     صراحةً بعد السحب من public — وإلّا فشل STEP B بـ permission-denied والبريد لا يعمل
--     أبدًا (القرار يبقى محفوظًا لكن الإشعار معطّل). المُدرِج الداخليّ يُستدعى فقط من
--     داخل الدالّة المُعرِّفة (SECURITY DEFINER) فلا يحتاج منحًا لـ service_role. ───
do $g$
begin
  execute 'revoke all on function public.nt_event_enqueue_internal(uuid,text,uuid,uuid,uuid,boolean,text,text,text,text) from public, anon, authenticated';
  execute 'revoke all on function public.review_enqueue_notifications(uuid,text,uuid) from public, anon, authenticated';
  execute 'grant execute on function public.review_enqueue_notifications(uuid,text,uuid) to service_role';
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «10.0 FAIL …». Probe فعليّ لـON CONFLICT (يُلغى بـsavepoint).
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
begin
  if to_regprocedure('public.review_enqueue_notifications(uuid,text,uuid)') is null then raise exception '10.0 FAIL: review_enqueue_notifications missing'; end if;
  if to_regprocedure('public.nt_event_enqueue_internal(uuid,text,uuid,uuid,uuid,boolean,text,text,text,text)') is null then raise exception '10.0 FAIL: internal enqueue missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_deliveries' and column_name='idempotency_key') then raise exception '10.0 FAIL: idempotency_key column missing'; end if;
  if exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='review_enqueue_notifications' and grantee in ('authenticated','anon','PUBLIC')) then raise exception '10.0 FAIL: enqueue RPC must be service-only (still granted to a client role)'; end if;
  if not exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='review_enqueue_notifications' and grantee='service_role') then raise exception '10.0 FAIL: service_role must keep EXECUTE (the route calls it with the service key)'; end if;

  -- Probe: ON CONFLICT على الفهرس الجزئيّ يعمل (يُلغى — بلا صفوف باقية).
  begin
    insert into public.email_deliveries(recipient_email, subject, status, idempotency_key)
      values ('probe@10.test', '10 probe', 'pending', '10_selftest_probe')
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    insert into public.email_deliveries(recipient_email, subject, status, idempotency_key)
      values ('probe@10.test', '10 probe', 'pending', '10_selftest_probe')
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    raise exception 'ROLLBACK_10_PROBE';
  exception
    when sqlstate '42P10' then raise exception '10.0 FAIL: ON CONFLICT cannot infer the partial idempotency index';
    when others then if sqlerrm <> 'ROLLBACK_10_PROBE' then raise exception '10.0 FAIL: enqueue probe error — %', sqlerrm; end if;
  end;

  raise notice '10.0 SELF-TEST PASSED — decoupled review enqueue ready.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
