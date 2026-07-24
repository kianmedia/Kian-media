-- ════════════════════════════════════════════════════════════════════════════
-- event_bound_email_dispatch_batch9g_RUNME.sql
-- BATCH 9G — إرسال البريد مرتبطًا بالحدث (Event-bound), لا بمسح زمنيّ عام.
--
-- الدليل من الإنتاج: POST /project/review → 200 مع claimed=0/sent=0. السبب المثبَت:
-- اعتماد العميل يُدرج deliverable_reviews؛ محفّزاته إمّا بثّ admin (recipient_id=null →
-- الجسر يتخطّاه، لا صفّ بريد) أو تُشعِر المكلَّف فقط (وكثير من المخرجات بلا assignee)،
-- فلا تُنشأ صفوف email_deliveries للإدارة/المدير → processQueue لا يجد ما يلتقطه.
--
-- الحلّ: RPC واحدة Server-only تُنفّذ في عملية واحدة: (1) قرار العميل (Authz داخل DB)
-- (2) حلّ المستلِمين الدقيقين (إدارة + مدير مشروع + مكلَّف) (3) إدراج email_deliveries
-- لهم مع correlation_id + idempotency_key (4) إرجاع delivery_ids القطعيّة. ثم يعالج
-- الخادم هذه الـIDs بالضبط (لا نافذة زمنية، لا الطابور القديم).
--
-- Additive · Idempotent · Transactional · SECURITY DEFINER + search_path ثابت ·
-- Self-test بلا إرسال بريد وبلا معالجة Backlog. لا تعديل مالية/عهدة.
-- تشغيل: psql "$DATABASE_URL" -f docs/event_bound_email_dispatch_batch9g_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.email_deliveries') is null then raise exception '9G PREFLIGHT: email_deliveries missing'; end if;
  if to_regprocedure('public.client_review_version(uuid,text,text)') is null then raise exception '9G PREFLIGHT: client_review_version missing'; end if;
  if to_regprocedure('public.is_client_owner(uuid)') is null then raise exception '9G PREFLIGHT: is_client_owner missing'; end if;
  if to_regclass('public.deliverable_versions') is null then raise exception '9G PREFLIGHT: deliverable_versions missing'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0) أعمدة الربط بالحدث (Additive) — correlation_id + idempotency_key
-- idempotency_key فريد جزئيًّا ⇒ منع تكرار الإدراج لنفس (الحدث/القرار/المستلِم/القناة).
-- ════════════════════════════════════════════════════════════════════════════
alter table public.email_deliveries add column if not exists correlation_id uuid;
alter table public.email_deliveries add column if not exists idempotency_key text;
create unique index if not exists uq_edel_idem on public.email_deliveries(idempotency_key) where idempotency_key is not null;
create index if not exists ix_edel_correlation on public.email_deliveries(correlation_id) where correlation_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مُدرِج داخليّ مشترك — يحلّ (إدارة + مدير مشروع + مكلَّف [+ عميل]) ويُدرِج صفوف
-- البريد مع idempotency + correlation، ويعيد delivery_ids المُدرَجة أو الموجودة مسبقًا.
-- جداول أساسية فقط (لا يعتمد على تطبيق دفعات أخرى). البريد من auth.users ثم profiles.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.nt_event_enqueue_internal(
  p_correlation uuid, p_idem_prefix text, p_entity_id uuid, p_project uuid,
  p_assignee uuid, p_include_client boolean, p_subject text, p_body text, p_url text, p_client_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_new uuid[] := '{}'; v_all uuid[] := '{}'; v_expected int := 0; v_key text; v_id uuid; v_is_client boolean;
begin
  for rec in
    with recips as (
      -- إدارة: Owner/Super Admin/Admin/Manager (تشغيليّ كامل)
      select p.id as uid, coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),'')) as email, false as is_client
      from public.profiles p left join auth.users au on au.id = p.id
      where p.account_status = 'active' and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager'))
      union
      -- مدير المشروع (kian_manager)
      select pm.user_id, coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),'')), false
      from public.project_members pm
      left join auth.users au on au.id = pm.user_id left join public.profiles pr on pr.id = pm.user_id
      where pm.project_id = p_project and pm.is_deleted = false and pm.role = 'kian_manager' and pm.user_id is not null
      union
      -- المكلَّف بالمخرَج (إن وُجد)
      select p_assignee, coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),'')), false
      from (select 1) x left join auth.users au on au.id = p_assignee left join public.profiles pr on pr.id = p_assignee
      where p_assignee is not null
      union
      -- العميل (لأحداث المعاينة فقط) — قائمة السماح الصريحة
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
    -- يجب إعادة شرط الفهرس الجزئيّ وإلّا 42P10 (لا يستنتج Postgres فهرسًا جزئيًّا كـarbiter).
    on conflict (idempotency_key) where idempotency_key is not null do nothing
    returning id into v_id;
    if v_id is not null then v_new := v_new || v_id; end if;
  end loop;

  -- كل الصفوف الخاصة بهذا الحدث (المُدرَجة الآن + الموجودة مسبقًا للحالة idempotent).
  -- مطابقة بادئة دقيقة (لا LIKE — قد تحوي البادئة '_' مثل revision_requested).
  select coalesce(array_agg(id), '{}') into v_all from public.email_deliveries
    where correlation_id = p_correlation
       or left(idempotency_key, length(p_idem_prefix) + 1) = p_idem_prefix || ':';

  return jsonb_build_object('expected_recipients', v_expected, 'new_ids', to_jsonb(v_new), 'delivery_ids', to_jsonb(v_all));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) قرار العميل + إدراج بريد الحدث — RPC واحدة (Server, للعميل صاحب المشروع)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.client_review_and_enqueue_notifications(
  p_version uuid, p_decision text, p_comments text default null, p_correlation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corr uuid := coalesce(p_correlation, gen_random_uuid());
  v_deliverable uuid; v_project uuid; v_title text; v_proj text; v_assignee uuid;
  v_subject text; v_body text; v_url text; v_enq jsonb;
begin
  -- (1) قرار العميل — Authz (is_client_owner + current + in-review) داخل RPC القائمة.
  perform public.client_review_version(p_version, p_decision, p_comments);

  -- (2) سياق المخرَج/المشروع.
  select dv.deliverable_id, d.project_id, d.title into v_deliverable, v_project, v_title
    from public.deliverable_versions dv join public.deliverables d on d.id = dv.deliverable_id
    where dv.id = p_version;
  begin select assignee_id into v_assignee from public.deliverables where id = v_deliverable; exception when others then v_assignee := null; end;
  -- BATCH 11 — كان `select name` وهو عمود غير موجود (42703): الصحيح project_name.
  select project_name into v_proj from public.projects where id = v_project;

  v_subject := case when p_decision = 'approved' then 'اعتمد العميل مخرجًا: ' else 'طلب العميل تعديلًا: ' end || coalesce(v_title, '');
  v_body := 'المشروع: ' || coalesce(v_proj, '') || E'\nالمخرَج: ' || coalesce(v_title, '') ||
            E'\nقرار العميل: ' || (case when p_decision = 'approved' then 'اعتماد' else 'طلب تعديل' end) ||
            coalesce(E'\nملاحظة: ' || nullif(btrim(coalesce(p_comments, '')), ''), '');
  v_url := '/client-portal/project-core/' || v_project || '?tab=deliverables';

  -- (3) داخل Savepoint واحد: منع ازدواج المكلَّف + إدراج بريد الحدث. أيّ فشل هنا لا يُلغي
  -- قرار العميل المُسجَّل (fail-safe)، ويُبقي الـdedup والإدراج متماثلَين (rollback معًا).
  begin
    -- منع ازدواج المكلَّف: صفّ بريد أنشأه محفّز 9C (pc_event_emit) لهذا القرار → نُلغيه
    -- لصالح صفوفنا المرتبطة بالحدث (idempotency_key غير فارغ). مقصور على أحداث القرار.
    if v_assignee is not null and to_regclass('public.notification_events') is not null then
      update public.email_deliveries set status = 'skipped', last_error = 'superseded_event_bound'
      where status = 'pending' and idempotency_key is null and recipient_id = v_assignee
        and event_id in (select id from public.notification_events
                         where entity_id = v_deliverable and event_type in ('client_deliverable_approved','client_revision_requested'));
    end if;
    v_enq := public.nt_event_enqueue_internal(
      v_corr, 'rev:' || p_version::text || ':' || p_decision, v_deliverable, v_project,
      v_assignee, false, v_subject, v_body, v_url, null);
  exception when others then
    v_enq := jsonb_build_object('expected_recipients', 0, 'new_ids', '[]'::jsonb, 'delivery_ids', '[]'::jsonb);
  end;

  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'decision', p_decision,
    'entity_id', v_deliverable, 'project_id', v_project,
    'expected_recipients', v_enq->'expected_recipients',
    'new_ids', v_enq->'new_ids', 'delivery_ids', v_enq->'delivery_ids');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) معاينة المخرَج — إدراج بريد الحدث (Server, لكادر kian). يشمل العميل المصرَّح.
-- توحيد على الطابور: لا direct-send + queue معًا — مصدر واحد (email_deliveries).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.deliverable_preview_enqueue_notifications(
  p_deliverable uuid, p_event text default 'deliverable.preview_sent', p_correlation uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corr uuid := coalesce(p_correlation, gen_random_uuid());
  v_project uuid; v_title text; v_proj text; v_assignee uuid; v_stamp text; v_final boolean;
  v_subject text; v_body text; v_url text; v_client_url text; v_enq jsonb;
begin
  select project_id, title into v_project, v_title from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_project is null then raise exception 'not_found'; end if;
  -- Authz: كادر kian فقط (إرسال المعاينة/التسليم إجراء داخليّ).
  if not public.is_staff() then raise exception 'not authorized'; end if;
  begin select assignee_id into v_assignee from public.deliverables where id = p_deliverable; exception when others then v_assignee := null; end;
  -- BATCH 11 — كان `select name` وهو عمود غير موجود (42703): الصحيح project_name.
  select project_name into v_proj from public.projects where id = v_project;
  v_final := p_event in ('deliverable.final_ready', 'project.delivery_recorded');

  v_subject := case when v_final then 'تم تسليم الملفات النهائية للعميل: ' else 'معاينة مخرَج جاهزة: ' end || coalesce(v_title, '');
  v_body := 'المشروع: ' || coalesce(v_proj, '') || E'\nالمخرَج: ' || coalesce(v_title, '') || E'\n' ||
            case when v_final then 'تم تسليم الملفات النهائية للعميل.' else 'أصبحت المعاينة متاحة للعميل للمراجعة.' end;
  v_url := '/client-portal/project-core/' || v_project || '?tab=deliverables';
  v_client_url := '/client-portal/projects/' || v_project;
  -- مفتاح idempotency بالدقيقة ⇒ منع الازدواج عند ضغط مزدوج، ويسمح بإعادة الإرسال لاحقًا.
  v_stamp := to_char(now() at time zone 'utc', 'YYYYMMDDHH24MI');

  v_enq := public.nt_event_enqueue_internal(
    v_corr, (case when v_final then 'final:' else 'preview:' end) || p_deliverable::text || ':' || v_stamp,
    p_deliverable, v_project, v_assignee, true, v_subject, v_body, v_url, v_client_url);

  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'entity_id', p_deliverable, 'project_id', v_project,
    'expected_recipients', v_enq->'expected_recipients', 'new_ids', v_enq->'new_ids', 'delivery_ids', v_enq->'delivery_ids');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- الصلاحيات — RPCs للمصادَق عليهم (Authz داخل كلٍّ منها)؛ المُدرِج الداخليّ خدمة فقط.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
begin
  execute 'revoke all on function public.nt_event_enqueue_internal(uuid,text,uuid,uuid,uuid,boolean,text,text,text,text) from public, anon, authenticated';
  execute 'revoke all on function public.client_review_and_enqueue_notifications(uuid,text,text,uuid) from public, anon';
  execute 'grant execute on function public.client_review_and_enqueue_notifications(uuid,text,text,uuid) to authenticated';
  execute 'revoke all on function public.deliverable_preview_enqueue_notifications(uuid,text,uuid) from public, anon';
  execute 'grant execute on function public.deliverable_preview_enqueue_notifications(uuid,text,uuid) to authenticated';
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «9G FAIL …» عند أيّ خلل. لا إرسال بريد، لا Backlog، لا أعمال.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text;
begin
  if to_regprocedure('public.client_review_and_enqueue_notifications(uuid,text,text,uuid)') is null then raise exception '9G FAIL: review RPC missing'; end if;
  if to_regprocedure('public.deliverable_preview_enqueue_notifications(uuid,text,uuid)') is null then raise exception '9G FAIL: preview RPC missing'; end if;
  if to_regprocedure('public.nt_event_enqueue_internal(uuid,text,uuid,uuid,uuid,boolean,text,text,text,text)') is null then raise exception '9G FAIL: internal enqueue missing'; end if;

  -- الأعمدة + الفهرس الفريد
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_deliveries' and column_name='correlation_id') then raise exception '9G FAIL: correlation_id column missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='email_deliveries' and column_name='idempotency_key') then raise exception '9G FAIL: idempotency_key column missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_edel_idem') then raise exception '9G FAIL: idempotency unique index missing'; end if;

  -- المُدرِج الداخليّ خدمة فقط
  if exists (select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='nt_event_enqueue_internal' and grantee='authenticated') then raise exception '9G FAIL: internal enqueue must be service-only'; end if;

  -- عقد الإرجاع يحوي delivery_ids + expected_recipients + correlation
  v_def := pg_get_functiondef('public.client_review_and_enqueue_notifications(uuid,text,text,uuid)'::regprocedure);
  if position('delivery_ids' in v_def) = 0 or position('expected_recipients' in v_def) = 0 or position('correlation_id' in v_def) = 0
    then raise exception '9G FAIL: review RPC contract incomplete'; end if;
  -- يمرّ عبر Authz القائمة (client_review_version)
  if position('client_review_version' in v_def) = 0 then raise exception '9G FAIL: review RPC must reuse client_review_version authz'; end if;

  -- Probe فعليّ لـON CONFLICT على الفهرس الجزئيّ (يُلغى بـsavepoint — بلا صفوف باقية).
  -- يمنع تكرار خطأ 42P10 (عدم استنتاج الفهرس الجزئيّ كـarbiter) الذي يجعل الإدراج يرمي.
  begin
    insert into public.email_deliveries(recipient_email, subject, status, idempotency_key)
      values ('probe@9g.test', '9g probe', 'pending', '9g_selftest_probe')
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    insert into public.email_deliveries(recipient_email, subject, status, idempotency_key)
      values ('probe@9g.test', '9g probe', 'pending', '9g_selftest_probe')
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    raise exception 'ROLLBACK_9G_PROBE';
  exception
    when sqlstate '42P10' then raise exception '9G FAIL: ON CONFLICT cannot infer the partial idempotency index — restate the predicate';
    when others then
      if sqlerrm <> 'ROLLBACK_9G_PROBE' then raise exception '9G FAIL: enqueue on-conflict probe error — %', sqlerrm; end if;
  end;

  raise notice '9G SELF-TEST PASSED — event-bound enqueue + delivery IDs ready.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
