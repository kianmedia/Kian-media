-- ════════════════════════════════════════════════════════════════════════════
-- notifications_e2e_repair_batch9d_RUNME.sql
-- BATCH 9D — إصلاح تسليم الإشعارات من الطرف إلى الطرف (منصة + بريد) بوعي الأدوار.
--
-- مثبت من الإنتاج: (أ) إرسال رابط معاينة لا يصل بريدًا لأحد ولا يُشعِر الفريق الداخلي؛
-- (ب) صرف عهدة ذاتي يصل للموظف فقط لا للإدارة/أمين العهدة؛ (ج) فجوات في التأجير.
--
-- الجذور المُثبَتة (بالكود):
--   • المعاينة: المنتِج الوحيد هو Trigger قديم t_deliverable_change يكتب صفّ بوابة
--     للعميل فقط، ولا يصفّ بريدًا إطلاقًا؛ البريد الوحيد POST متصفّح no-cors (لا-op).
--   • الإدارة: مسار البريد يقرأ profiles.email فقط، بينما مسار الموظف يرجع إلى
--     auth.users — فإن كان بريد الإدارة في profiles فارغًا، لا يصلها شيء.
--   • القناة: بريد المشاريع opt-in معطّل افتراضيًا، بينما العهدة/HR opt-out مفعّل
--     على نفس النقطة — لذا بريد المشاريع مُظلم (يُصلَح في TS بجعله opt-out).
--   • قيد notifications.type مُنجرِف يُسقِط أنواعًا صحيحة بصمت ويُجهِض RPC استلام العميل.
--
-- هذا الملف (SQL) يضيف الأساس المشترك (لا نظام إشعارات ثالث، لا موازٍ):
--   §0 حارس صيغة متساهل لقيد النوع (يُنهي الانجراف — يُصلح liability/receipt).
--   §1 سِجلّ تتبّع التسليم notification_delivery_log (تِلِمِتري) + مُسجّل + قارئ إداريّ.
--   §2 محلِّل المستلِمين المركزيّ notification_resolve_recipients — الإدارة/أمين العهدة/
--      المالية/مدير المشروع/العميل/المستأجر + مستلِمون مباشرون (assignee/actor) من payload.
--      يقرأ البريد من auth.users أوّلًا (يُصلح فجوة بريد الإدارة الفارغ في profiles).
--   §3 موزِّع البوابة notification_dispatch_portal — يكتب صفوف البوابة + يسجّل التتبّع.
--   §4 منتِج المعاينة (Trigger تكميليّ) — يُشعِر الفريق الداخليّ عند إرسال المعاينة.
--   §5 منتِج رحلة المستأجر (Trigger) — بوابة المستأجر عند جاهزية العقد/التفعيل/التأخّر/الإغلاق.
--
-- الإرسال الفوريّ للبريد يتمّ من مسارات الخادم (TS) عبر المحلِّل — الكرون احتياط.
-- Additive · Idempotent · Transactional · SECURITY DEFINER + search_path آمن · Self-test
-- بلا إرسال بريد وبلا تعديل أعمال. تشغيل: psql "$DATABASE_URL" -f docs/notifications_e2e_repair_batch9d_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.notifications')  is null then raise exception '9D PREFLIGHT: public.notifications missing'; end if;
  if to_regclass('public.profiles')       is null then raise exception '9D PREFLIGHT: public.profiles missing'; end if;
  if to_regclass('public.project_members') is null then raise exception '9D PREFLIGHT: public.project_members missing'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then raise exception '9D PREFLIGHT: notify() missing'; end if;
  if to_regprocedure('public.project_client_user_ids(uuid)') is null then raise exception '9D PREFLIGHT: project_client_user_ids() missing'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0) حارس صيغة متساهل لقيد notifications.type (يُنهي الانجراف نهائيًا)
-- عدّة هجرات تُعيد تعريف القيد بمجموعات enum متعارضة؛ الأخيرة تفوز فتُرفض أنواع صحيحة
-- (custody_liability_*, deliverable_receipt_confirmed) — الأخيرة تُجهِض RPC استلام العميل.
-- نستبدله بحارس صيغة snake_case (توسيع لا تضييق، محميّ ضد صفوف شاذّة، بلا حذف).
-- ════════════════════════════════════════════════════════════════════════════
do $type_guard$
begin
  if exists (select 1 from public.notifications where type !~ '^[a-z][a-z0-9_]{2,60}$') then
    raise notice '9D §0: صفوف notifications.type شاذّة — أُبقي القيد كما هو.';
  else
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications
      add constraint notifications_type_check check (type is not null and type ~ '^[a-z][a-z0-9_]{2,60}$');
  end if;
end $type_guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) سِجلّ تتبّع التسليم (تِلِمِتري — ليس جدول إشعارات)
-- رحلة واحدة لكل مستلِم: من المنتِج إلى المزوّد، بسبب الاستبعاد إن وُجد.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.notification_delivery_log (
  id              bigint generated always as identity primary key,
  correlation_id  uuid not null,
  event_type      text not null,
  entity_type     text,
  entity_id       uuid,
  project_id      uuid,
  actor_user_id   uuid,
  recipient_id    uuid,
  recipient_role  text,
  recipient_reason text,
  channel         text not null default 'portal' check (channel in ('portal','email','both','none')),
  outcome         text not null check (outcome in ('portal_created','email_sent','email_failed','email_skipped','excluded','resolved')),
  exclusion_reason text,
  error_class     text,
  meta            jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists ix_ndl_correlation on public.notification_delivery_log(correlation_id);
create index if not exists ix_ndl_event_time  on public.notification_delivery_log(event_type, created_at desc);
create index if not exists ix_ndl_entity      on public.notification_delivery_log(entity_type, entity_id);

alter table public.notification_delivery_log enable row level security;
drop policy if exists ndl_admin_read on public.notification_delivery_log;
create policy ndl_admin_read on public.notification_delivery_log
  for select to authenticated using (public.can_manage_projects());
grant select on public.notification_delivery_log to authenticated;

-- مُسجّل التتبّع (خدمة/داخليّ) — يقبل مصفوفة صفوف؛ لا يُفشل أبدًا العملية الأساسية.
create or replace function public.notification_trace(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return; end if;
  for r in select jsonb_array_elements(p_rows) loop
    begin
      insert into public.notification_delivery_log(
        correlation_id, event_type, entity_type, entity_id, project_id, actor_user_id,
        recipient_id, recipient_role, recipient_reason, channel, outcome, exclusion_reason, error_class, meta)
      values (
        coalesce((r->>'correlation_id')::uuid, gen_random_uuid()),
        coalesce(r->>'event_type','unknown'),
        r->>'entity_type', (r->>'entity_id')::uuid, (r->>'project_id')::uuid, (r->>'actor_user_id')::uuid,
        (r->>'recipient_id')::uuid, r->>'recipient_role', r->>'recipient_reason',
        coalesce(r->>'channel','portal'), coalesce(r->>'outcome','resolved'),
        r->>'exclusion_reason', r->>'error_class', coalesce(r->'meta','{}'::jsonb));
    exception when others then
      -- التتبّع لا يُفشل الإشعار؛ صفّ واحد فاسد لا يُسقِط الباقي.
      null;
    end;
  end loop;
  -- تقليم: آخر 20000 صفّ (تِلِمِتري متجدّد).
  delete from public.notification_delivery_log
    where id in (select id from public.notification_delivery_log order by id desc offset 20000);
end $$;

-- قارئ التتبّع (إداريّ) — رحلة حدث واحد أو بحث حسب النوع/الكيان.
create or replace function public.notification_delivery_trace_list(
  p_event text default null, p_entity_id uuid default null, p_correlation uuid default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v from (
    select correlation_id, event_type, entity_type, entity_id, project_id, actor_user_id,
           recipient_id, recipient_role, recipient_reason, channel, outcome, exclusion_reason,
           error_class, created_at
    from public.notification_delivery_log d
    where (p_event is null or d.event_type = p_event)
      and (p_entity_id is null or d.entity_id = p_entity_id)
      and (p_correlation is null or d.correlation_id = p_correlation)
    order by d.created_at desc
    limit least(coalesce(p_limit,200), 1000)) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) المحلِّل المركزيّ للمستلِمين — مصدر الحقيقة الوحيد لكل القنوات
-- يُرجِع: الإدارة (Owner/Super Admin/Admin) + أمين العهدة + المالية + مدير المشروع +
-- العميل (للأحداث المواجِهة للعميل) + المستأجر (لأحداث التأجير) + مستلِمون مباشرون
-- من payload (assignee/actor/employee). البريد من auth.users أوّلًا ثم profiles.
-- الإدارة: بريد إلزاميّ لا يُكبَح بتفضيل قديم (email_enabled=false).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.notification_resolve_recipients(
  p_event text, p_entity_type text, p_entity_id uuid, p_project uuid,
  p_actor uuid, p_payload jsonb default '{}')
returns table (user_id uuid, email text, role text, recipient_reason text,
               portal_allowed boolean, email_allowed boolean, action_url text, locale text, dedupe_key text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_client_facing boolean := p_event in (
    'deliverable.preview_sent','deliverable.final_ready','project.delivery_recorded');
  v_rental  boolean := left(p_event, 7) = 'rental.';
  v_finance boolean := p_event in (
    'rental.charges_pending','rental.deposit_release_pending','rental.damage_reported',
    'custody.compensation_requested','custody.compensation_decided');
  v_url        text := coalesce(nullif(p_payload->>'action_url',''), '/client-portal');
  v_client_url text := coalesce(nullif(p_payload->>'client_action_url',''), v_url);
  v_key text := p_event || ':' || coalesce(p_entity_id::text, '');
  d jsonb;
begin
  -- (1) الإدارة: Owner/Super Admin/Admin — كل حدث تشغيليّ (بوابة + بريد إلزاميّ).
  return query
    select p.id,
           lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),''))),
           'management',
           case when p.staff_role = 'super_admin' then 'super_admin'
                when p.account_type = 'admin'     then 'admin'
                else 'management' end,
           true, true, v_url, 'ar', v_key || ':' || p.id::text
    from public.profiles p
    left join auth.users au on au.id = p.id
    where p.account_status = 'active'
      and (p.account_type = 'admin' or p.staff_role = 'super_admin');

  -- (2) مدير العهدة/التأجير + أمين العهدة — أحداث العهدة/التأجير.
  -- يطابق تمامًا civ_notify_managers (بوابة): staff_role in ('manager','custody_officer')
  -- فلا ينحدر بريد الإدارة عن البوابة. لا نُدرِج 'manager' عالميًا كي لا نُوسِّع أحداث
  -- المشاريع (مدير المشروع فيها = عضو kian_manager، لا مدير staff عالميّ).
  if left(p_event,8) = 'custody.' or v_rental then
    return query
      select p.id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),''))),
             'custody_officer',
             case when p.staff_role = 'manager' then 'custody_manager' else 'custody_officer' end,
             true, true, v_url, 'ar', v_key || ':' || p.id::text
      from public.profiles p left join auth.users au on au.id = p.id
      where p.account_status = 'active' and p.staff_role in ('manager', 'custody_officer');
  end if;

  -- (3) المالية — أحداث المالية فقط.
  if v_finance then
    return query
      select p.id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(p.email),''))),
             'finance', 'finance', true, true, v_url, 'ar', v_key || ':' || p.id::text
      from public.profiles p left join auth.users au on au.id = p.id
      where p.account_status = 'active' and p.staff_role = 'finance';
  end if;

  -- (4) مدير المشروع + كوادر كيان المسؤولون — لأحداث المشاريع.
  if p_project is not null then
    return query
      select pm.user_id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
             'project_manager', 'project_manager', true, true, v_url, 'ar', v_key || ':' || pm.user_id::text
      from public.project_members pm
      left join auth.users au on au.id = pm.user_id
      left join public.profiles pr on pr.id = pm.user_id
      where pm.project_id = p_project and pm.is_deleted = false and pm.role = 'kian_manager'
        and pm.user_id is not null;
  end if;

  -- (5) العميل — فقط للأحداث المواجِهة للعميل وعبر قائمة السماح الصريحة.
  if v_client_facing and p_project is not null then
    return query
      select cu.user_id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
             'client', 'client', true, true, v_client_url, 'ar', v_key || ':' || cu.user_id::text
      from public.project_client_user_ids(p_project) cu
      left join auth.users au on au.id = cu.user_id
      left join public.profiles pr on pr.id = cu.user_id;
  end if;

  -- (6) المستأجر — لأحداث التأجير، عبر عقده فقط (entity = custody_rental_requests.id).
  if v_rental and p_entity_id is not null and to_regclass('public.custody_rental_requests') is not null then
    return query
      execute $q$
        select c.user_id, lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
               'renter', 'renter', true, true, $1, 'ar', $2 || ':' || c.user_id::text
        from public.custody_rental_requests r
        join public.custody_rental_customers c on c.id = r.customer_id
        left join auth.users au on au.id = c.user_id
        left join public.profiles pr on pr.id = c.user_id
        where r.id = $3 and c.user_id is not null $q$
      using v_client_url, v_key, p_entity_id;
  end if;

  -- (7) مستلِمون مباشرون من payload: [{user_id, reason}] — assignee/actor/employee (تأكيد).
  --     لا يُطبَّق كبح الذات على التأكيدات؛ الإدارة/المسؤول يستلمون دائمًا.
  if jsonb_typeof(p_payload->'direct') = 'array' then
    for d in select jsonb_array_elements(p_payload->'direct') loop
      -- تجاهُل معرّف غير صالح (لا يُجهِض التحليل كلّه بسبب عنصر واحد فاسد).
      if (d->>'user_id') is null or (d->>'user_id') !~ '^[0-9a-fA-F-]{36}$' then continue; end if;
      return query
        select (d->>'user_id')::uuid,
               lower(coalesce(nullif(btrim(au.email),''), nullif(btrim(pr.email),''))),
               'direct', coalesce(d->>'reason','direct'),
               true, true,
               case when coalesce(d->>'reason','') = 'client' then v_client_url else v_url end,
               'ar', v_key || ':' || (d->>'user_id')
        from (select (d->>'user_id')::uuid as uid) x
        left join auth.users au on au.id = x.uid
        left join public.profiles pr on pr.id = x.uid;
    end loop;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) موزِّع البوابة — يكتب صفوف البوابة للمستلِمين المطابقين للجمهور + يسجّل التتبّع
-- p_audience: 'staff' (كل ما عدا العميل/المستأجر) | 'client' | 'all'
-- النوع في البوابة آمن-ضدّ-القيد: عميل⇒deliverable_new، غيره⇒project_note_new.
-- يُدمَج المستلِم لمرّة واحدة (distinct user). لا يُفشل أبدًا العملية الأساسية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.notification_dispatch_portal(
  p_event text, p_entity_type text, p_entity_id uuid, p_project uuid, p_actor uuid,
  p_title_ar text, p_title_en text, p_audience text default 'staff', p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_corr uuid := gen_random_uuid(); v_n int := 0; v_trace jsonb := '[]'::jsonb; v_type text;
begin
  for rec in
    select distinct on (r.user_id) r.user_id, r.role, r.recipient_reason, r.action_url
    from public.notification_resolve_recipients(p_event, p_entity_type, p_entity_id, p_project, p_actor, p_payload) r
    where r.user_id is not null
      and case p_audience
            when 'client' then r.recipient_reason in ('client','renter')
            when 'staff'  then r.recipient_reason not in ('client','renter')
            else true end
    order by r.user_id, (r.role = 'management') desc
  loop
    v_type := case when rec.recipient_reason in ('client','renter') then 'deliverable_new' else 'project_note_new' end;
    begin
      perform public.notify(rec.user_id, 'user', v_type, p_entity_type, p_entity_id, p_title_ar, p_title_en);
      v_n := v_n + 1;
      v_trace := v_trace || jsonb_build_object('correlation_id', v_corr, 'event_type', p_event,
        'entity_type', p_entity_type, 'entity_id', p_entity_id, 'project_id', p_project, 'actor_user_id', p_actor,
        'recipient_id', rec.user_id, 'recipient_role', rec.role, 'recipient_reason', rec.recipient_reason,
        'channel', 'portal', 'outcome', 'portal_created');
    exception when others then
      v_trace := v_trace || jsonb_build_object('correlation_id', v_corr, 'event_type', p_event,
        'entity_id', p_entity_id, 'recipient_id', rec.user_id, 'channel', 'portal', 'outcome', 'email_failed',
        'error_class', 'portal_insert_error');
    end;
  end loop;
  perform public.notification_trace(v_trace);
  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'portal_created', v_n);
end $$;

-- اختبار إداريّ آمن (9D §15): يكتب صفّ بوابة للمستخدم المُمرَّر فقط + يسجّل التتبّع.
-- لا يُفشِل، لا يُرسل بريدًا (البريد يُرسله المسار)، خدمة-داخليّ (يستدعيه المسار بعد التحقّق).
create or replace function public.notification_admin_self_test(p_user uuid, p_title_ar text, p_title_en text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_corr uuid := gen_random_uuid();
begin
  if p_user is null then raise exception 'no_user'; end if;
  perform public.notify(p_user, 'user', 'project_note_new', 'diagnostic', null,
    coalesce(nullif(btrim(p_title_ar),''), 'اختبار إشعار'), coalesce(nullif(btrim(p_title_en),''), 'Notification test'));
  perform public.notification_trace(jsonb_build_array(jsonb_build_object(
    'correlation_id', v_corr, 'event_type', 'diagnostic.self_test', 'entity_type', 'diagnostic',
    'actor_user_id', p_user, 'recipient_id', p_user, 'recipient_role', 'management',
    'recipient_reason', 'self_test', 'channel', 'portal', 'outcome', 'portal_created')));
  return jsonb_build_object('ok', true, 'correlation_id', v_corr, 'portal_created', 1);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) منتِج المعاينة — Trigger تكميليّ يُشعِر الفريق الداخليّ عند إرسال المعاينة
-- المنتِج القديم t_deliverable_change يُشعِر العميل فقط (بوابة). هذا يُضيف الفريق
-- الداخليّ (إدارة + مدير مشروع + المكلَّف + الفاعل تأكيدًا) بوابةً. البريد فوريّ من TS.
-- يعمل على كل مسارات الإرسال (محرّر/أدمن/نسخة جديدة) لأنّها جميعًا تضع client_review.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_preview_staff_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_assignee uuid; v_payload jsonb; v_title text;
begin
  if not ((tg_op = 'INSERT' and new.status = 'client_review')
       or (tg_op = 'UPDATE' and new.status = 'client_review' and old.status is distinct from new.status)) then
    return new;
  end if;
  -- المكلَّف اختياريّ (عمود مضاف في ABSOLUTE_FINAL) — معزول عن غياب العمود.
  begin select new.assignee_id into v_assignee; exception when others then v_assignee := null; end;
  v_title := coalesce(new.title, '');
  v_payload := jsonb_build_object('action_url',
    '/client-portal/project-core/' || new.project_id || '?tab=deliverables',
    'direct', (
      select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'reason', rn)), '[]'::jsonb)
      from (
        select auth.uid() as u, 'actor_confirmation' as rn where auth.uid() is not null
        union all
        select v_assignee, 'assignee' where v_assignee is not null and v_assignee is distinct from auth.uid()
      ) s));
  perform public.notification_dispatch_portal('deliverable.preview_sent', 'deliverable', new.id,
    new.project_id, auth.uid(),
    'تم إرسال معاينة للعميل: ' || v_title, 'Preview sent to client: ' || v_title, 'staff', v_payload);
  return new;
exception when others then return new;   -- الإشعار لا يُفشل تغيير حالة المخرَج أبدًا
end $$;

drop trigger if exists trg_preview_staff_notify on public.deliverables;
create trigger trg_preview_staff_notify after insert or update of status on public.deliverables
  for each row execute function public.pc_preview_staff_notify();

-- ════════════════════════════════════════════════════════════════════════════
-- §5) منتِج رحلة المستأجر (يطوي إصلاح 9C) — بوابة المستأجر عند التحوّلات المفقودة
-- جاهزية العقد (contract_pending_signature) / التفعيل (active) / التأخّر (overdue) /
-- الإغلاق (closed). civ_notify بريد portal-only لأنواع rental_ (لا مبالغ في البريد).
-- ════════════════════════════════════════════════════════════════════════════
do $rental$
begin
  if to_regclass('public.custody_rental_requests') is null
     or to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)') is null then
    raise notice '9D §5: نظام التأجير غير مطبّق — تخطّي منتِج المستأجر.';
    return;
  end if;

  create or replace function public.rental_notify_renter_transition()
  returns trigger language plpgsql security definer set search_path = public as $rn$
  declare v_user uuid; v_no text; v_type text; v_ar text; v_en text;
  begin
    if new.status is not distinct from old.status then return new; end if;
    if new.status not in ('contract_pending_signature','contracted','active','overdue','closed') then return new; end if;
    select c.user_id into v_user from public.custody_rental_customers c where c.id = new.customer_id;
    if v_user is null then return new; end if;
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
  exception when others then return new;
  end $rn$;

  drop trigger if exists trg_rental_notify_renter on public.custody_rental_requests;
  create trigger trg_rental_notify_renter after update of status on public.custody_rental_requests
    for each row execute function public.rental_notify_renter_transition();
end $rental$;

-- ════════════════════════════════════════════════════════════════════════════
-- الصلاحيات — المحلِّل/الموزِّع/المُسجّل خدمة-داخليّ (تُستدعى من مسارات الخادم بمفتاح
-- الخدمة أو من Triggers)؛ قارئ التتبّع للمصرّح (إدارة المشاريع).
-- ════════════════════════════════════════════════════════════════════════════
do $grants$
declare f text;
begin
  foreach f in array array[
    'public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)',
    'public.notification_dispatch_portal(text,text,uuid,uuid,uuid,text,text,text,jsonb)',
    'public.notification_trace(jsonb)',
    'public.notification_admin_self_test(uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'revoke all on function public.notification_delivery_trace_list(text,uuid,uuid,int) from public, anon';
  execute 'grant execute on function public.notification_delivery_trace_list(text,uuid,uuid,int) to authenticated';
end $grants$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «9D FAIL …» عند أيّ خلل (يُبطِل الـcommit). بلا بريد/تعديل أعمال.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_def text; v_cnt int;
begin
  -- (1) الدوال موجودة
  if to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is null then raise exception '9D FAIL: resolver missing'; end if;
  if to_regprocedure('public.notification_dispatch_portal(text,text,uuid,uuid,uuid,text,text,text,jsonb)') is null then raise exception '9D FAIL: dispatch missing'; end if;
  if to_regprocedure('public.notification_trace(jsonb)') is null then raise exception '9D FAIL: trace recorder missing'; end if;
  if to_regprocedure('public.notification_delivery_trace_list(text,uuid,uuid,int)') is null then raise exception '9D FAIL: trace reader missing'; end if;

  -- (2) جدول التتبّع + RLS + Trigger المعاينة
  if to_regclass('public.notification_delivery_log') is null then raise exception '9D FAIL: delivery log table missing'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_delivery_log' and policyname='ndl_admin_read') then raise exception '9D FAIL: delivery log RLS missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_preview_staff_notify' and not tgisinternal) then raise exception '9D FAIL: preview trigger missing'; end if;

  -- (3) المحلِّل خدمة-داخليّ (محروم من authenticated)
  if exists (select 1 from information_schema.routine_privileges
             where routine_schema='public' and routine_name='notification_resolve_recipients' and grantee='authenticated')
    then raise exception '9D FAIL: resolver must be service-only'; end if;

  -- (4) المحلِّل يقرأ auth.users للبريد (يُصلح فجوة بريد الإدارة)
  v_def := pg_get_functiondef('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  if position('auth.users' in v_def) = 0 then raise exception '9D FAIL: resolver must read auth.users for management email'; end if;
  if position('super_admin' in v_def) = 0 or position('custody_officer' in v_def) = 0 then raise exception '9D FAIL: resolver missing a management/officer role'; end if;

  -- (5) المحلِّل يُنفَّذ بلا خطأ ويُرجِع الإدارة كصفوف (سياق تعريف؛ لا بريد)
  select count(*) into v_cnt from public.notification_resolve_recipients(
    'deliverable.preview_sent','deliverable', gen_random_uuid(), null, null, '{}'::jsonb)
    where recipient_reason in ('management','super_admin','admin');
  -- v_cnt قد يكون 0 في قاعدة فارغة — نتحقق فقط أنّ الاستعلام نُفِّذ بلا استثناء.

  -- (6) قيد النوع (إن طُبّق §0) متساهل الصيغة
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname='notifications_type_check';
  if v_def is not null and position('~' in v_def) = 0 and position('rental_' in v_def) = 0 then
    raise notice '9D §0 note: قيد notifications.type ما زال enum قديمًا (صفوف شاذّة منعت §0).';
  end if;

  raise notice '9D SELF-TEST PASSED — canonical resolver + dispatch + trace ready.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
