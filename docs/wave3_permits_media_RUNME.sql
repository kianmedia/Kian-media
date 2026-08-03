-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · إغلاق — سجلّ التصاريح · وسائط المواقع · تنبيهات الانتهاء.
--
-- V2-3.2-A · V2-3.2-C · V2-3.4-B  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
--
-- ★★ ما الذي يبرّر جدولًا جديدًا هنا، والموجة كلّها ضدّ الأنظمة الموازية ★★
--
-- ١) `ops_permits` — الفجوة ليست في الحقول بل في **العلاقة**.
--    `ops_job_permits` يغطّي ٨٠٪ من حقول الـBrief (النوع · الجهة · الرقم ·
--    الإصدار · الانتهاء · الحالة · مستند · ملاحظة). لكنّه `job_id not null` مع
--    `on delete cascade` — فهو **تصريحٌ لمهمّة**. رخصة طيران درون سنوية على
--    مستوى الشركة لا مكان لها فيه، وحذف المهمّة يحذف الرخصة.
--    والـBrief يقول ذلك حرفيًّا: «`ops_job_permits` قائم **كابن لوظيفة**. سجل
--    تصاريح عام = **Extension Table** مرتبط».
--    ⛔ ولذلك لا يُلمس `ops_job_permits` ولا تُرخّى قيوده — يبقى كما هو، ويُربط.
--
-- ٢) `ops_media` — جدول **واحد** لوسائط التشغيل، يخدم المواقع (V2-3.4-B)
--    وإثباتات التصاريح (V2-3.2-A) معًا. جدولان منفصلان كانا سينتجان مسارَي
--    تخزين متوازيين — وهو ما تمنعه الموجة.
--    ⚠️ و`ops_media_cards` ليس نظير هذا: تلك **بطاقات ذاكرة الكاميرا** (مادّة
--    مصوّرة)، لا مرفقات ملفّات. اسمان متشابهان ومجالان مختلفان.
--
-- ٣) التنبيهات — **لا خدمة إشعارات ثانية ولا مجدول رابع (G8)**.
--    تُستعمل `civ_alert_once` (منع تكرار) و`civ_notify_managers` القائمتان،
--    ويُطوى النداء داخل `/api/cron/custody-alerts` القائم.
--
-- ⛔ لا بيانات مخترعة: لا تصريح ولا رقم ولا جهة. الجداول تُنشأ **فارغة**.
-- ⛔ لا pg_net · لا بريد من القاعدة · إضافيّ بالكامل · إعادة التشغيل آمنة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.ops_jobs') is null then
    raise exception '🔴 ops_jobs مفقود — شغّل operations_center_RUNME.sql أولًا';
  end if;
  if to_regclass('public.ops_job_permits') is null then
    raise exception '🔴 ops_job_permits مفقود — هذه الحزمة تمتدّ عليه ولا تستبدله';
  end if;
  -- التنبيهات تعتمد مساعدات العهدة القائمة. غيابها يُعطّل §4 وحدها لا الحزمة.
  if to_regproc('public.civ_alert_once(text,text,text,uuid)') is null then
    raise notice '⚠️ civ_alert_once مفقود — §4 ستُنشأ لكنّها سترجع disabled حتى تُطبَّق حزمة العهدة';
  end if;
end $$;

-- ─── §1 · سجلّ التصاريح العامّ ─────────────────────────────────────────────
create table if not exists public.ops_permits (
  id             uuid primary key default gen_random_uuid(),
  -- نفس مفردات ops_job_permits حرفيًّا — لا مفردات ثانية للشيء نفسه.
  permit_type    text not null default 'other'
                 check (permit_type in ('municipality','police','property_owner','airspace_drone',
                                        'client_site','venue','other')),
  title          text not null check (length(btrim(title)) between 2 and 200),
  authority_name text,
  reference_no   text,
  issued_at      date,
  expires_at     date,
  status         text not null default 'pending'
                 check (status in ('not_required','pending','submitted','approved','rejected','expired','revoked')),
  -- 🔴 النطاق: هذا ما يميّزه عن تصريح المهمّة. تصريح الشركة لا يرتبط بشيء.
  scope          text not null default 'company'
                 check (scope in ('company','project','asset','activity')),
  project_id     uuid,
  asset_id       uuid,
  activity_note  text,
  -- المسؤول — الحقل الذي يطلبه الـBrief ولا يوجد في ops_job_permits.
  owner_user_id  uuid references auth.users(id) on delete set null,
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz,
  deleted_by     uuid references auth.users(id),
  delete_reason  text,
  -- الانتهاء لا يسبق الإصدار.
  constraint ops_permits_dates check (expires_at is null or issued_at is null or expires_at >= issued_at),
  -- نطاق يدّعي ارتباطًا يجب أن يحمله.
  constraint ops_permits_scope_target check (
    (scope = 'company')
    or (scope = 'project'  and project_id is not null)
    or (scope = 'asset'    and asset_id   is not null)
    or (scope = 'activity' and length(btrim(coalesce(activity_note,''))) >= 3)
  )
);

comment on table public.ops_permits is
  'سجلّ التصاريح العامّ (V2-3.2-A). امتداد على ops_job_permits لا بديل عنه: '
  'ذاك تصريحٌ لمهمّة (job_id not null)، وهذا تصريح له عمر مستقلّ.';

create index if not exists ops_permits_expiry_idx
  on public.ops_permits (expires_at)
  where is_deleted = false and expires_at is not null;
create index if not exists ops_permits_scope_idx
  on public.ops_permits (scope, status) where is_deleted = false;

-- ─── §2 · الربط — تصريح مهمّة قد يستند إلى سجلّ ────────────────────────────
-- ⚠️ اختياريّ و`on delete set null`: حذف سجلّ لا يُفقد أثر استعماله في مهمّة.
alter table public.ops_job_permits
  add column if not exists registry_permit_id uuid
    references public.ops_permits(id) on delete set null;

create index if not exists ops_job_permits_registry_idx
  on public.ops_job_permits (registry_permit_id) where registry_permit_id is not null;

-- ─── §3 · وسائط التشغيل — جدول واحد للمواقع والتصاريح ──────────────────────
create table if not exists public.ops_media (
  id            uuid primary key default gen_random_uuid(),
  -- 🔴 مالكان اثنان فقط، مُقيَّدان بقائمة بيضاء. لا polymorphism مفتوح.
  owner_kind    text not null check (owner_kind in ('location','permit')),
  owner_id      uuid not null,
  media_type    text not null default 'image'
                check (media_type in ('image','video','document','other')),
  -- ⛔ لا URL عامّ يُخزَّن. المرجع bucket+path، والرابط يُوقَّع عند الطلب وينتهي.
  storage_bucket text not null,
  storage_path   text not null,
  caption       text,
  sort_order    integer not null default 0,
  added_by      uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id),
  delete_reason text,
  constraint ops_media_path_shape check (
    length(btrim(storage_bucket)) > 0 and length(btrim(storage_path)) > 0
    -- ⛔ لا رابط كامل في حقل مسار: يُغري بعرضه مباشرة بلا توقيع.
    and storage_path !~* '^https?://'
  ),
  unique (owner_kind, owner_id, storage_bucket, storage_path)
);

comment on column public.ops_media.storage_path is
  '⛔ مسار داخل الدلو، لا رابط. الروابط تُوقَّع عند الطلب وتنتهي — ولا يُخزَّن رابط دائم.';

create index if not exists ops_media_owner_idx
  on public.ops_media (owner_kind, owner_id, sort_order)
  where is_deleted = false;

-- ─── §4 · RLS — deny by default على الجدولين ───────────────────────────────
alter table public.ops_permits enable row level security;
alter table public.ops_media   enable row level security;

drop policy if exists ops_permits_read on public.ops_permits;
create policy ops_permits_read on public.ops_permits
  for select to authenticated
  using (is_deleted = false and public.prodops_can_view());

drop policy if exists ops_media_read on public.ops_media;
create policy ops_media_read on public.ops_media
  for select to authenticated
  using (is_deleted = false and public.prodops_can_view());

-- ⛔ لا سياسة INSERT/UPDATE/DELETE على أيّهما: الكتابة عبر الدوالّ المحروسة.
-- ⛔ ولا شيء لـanon بأيّ حال.
revoke all on public.ops_permits from anon, public;
revoke all on public.ops_media   from anon, public;

-- ─── §5 · دوالّ الكتابة — بالبادئة المعتمدة prodops_ (قرار D-2) ────────────
create or replace function public.prodops_permit_upsert(p_payload jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p_payload->>'id','')::uuid;
begin
  if not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_payload->>'title',''))) < 2 then
    raise exception 'title_required';
  end if;

  if v_id is null then
    insert into public.ops_permits
      (permit_type, title, authority_name, reference_no, issued_at, expires_at, status,
       scope, project_id, asset_id, activity_note, owner_user_id, note, created_by)
    values
      (coalesce(nullif(p_payload->>'permit_type',''),'other'),
       btrim(p_payload->>'title'),
       nullif(p_payload->>'authority_name',''), nullif(p_payload->>'reference_no',''),
       nullif(p_payload->>'issued_at','')::date, nullif(p_payload->>'expires_at','')::date,
       coalesce(nullif(p_payload->>'status',''),'pending'),
       coalesce(nullif(p_payload->>'scope',''),'company'),
       nullif(p_payload->>'project_id','')::uuid, nullif(p_payload->>'asset_id','')::uuid,
       nullif(p_payload->>'activity_note',''),
       nullif(p_payload->>'owner_user_id','')::uuid, nullif(p_payload->>'note',''),
       auth.uid())
    returning id into v_id;
  else
    update public.ops_permits set
      permit_type    = coalesce(nullif(p_payload->>'permit_type',''), permit_type),
      title          = coalesce(nullif(btrim(p_payload->>'title'),''), title),
      authority_name = case when p_payload ? 'authority_name' then nullif(p_payload->>'authority_name','') else authority_name end,
      reference_no   = case when p_payload ? 'reference_no'   then nullif(p_payload->>'reference_no','')   else reference_no end,
      issued_at      = case when p_payload ? 'issued_at'      then nullif(p_payload->>'issued_at','')::date  else issued_at end,
      expires_at     = case when p_payload ? 'expires_at'     then nullif(p_payload->>'expires_at','')::date else expires_at end,
      status         = coalesce(nullif(p_payload->>'status',''), status),
      scope          = coalesce(nullif(p_payload->>'scope',''), scope),
      project_id     = case when p_payload ? 'project_id'     then nullif(p_payload->>'project_id','')::uuid else project_id end,
      asset_id       = case when p_payload ? 'asset_id'       then nullif(p_payload->>'asset_id','')::uuid   else asset_id end,
      activity_note  = case when p_payload ? 'activity_note'  then nullif(p_payload->>'activity_note','')    else activity_note end,
      owner_user_id  = case when p_payload ? 'owner_user_id'  then nullif(p_payload->>'owner_user_id','')::uuid else owner_user_id end,
      note           = case when p_payload ? 'note'           then nullif(p_payload->>'note','')             else note end,
      updated_at     = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'not_found'; end if;
  end if;
  return v_id;
end $$;

-- الحذف إخفاء بسبب مكتوب — لا إزالة نهائية (النمط القائم في المنصّة).
create or replace function public.prodops_permit_delete(p_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;
  update public.ops_permits
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), delete_reason = btrim(p_reason)
   where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  return true;
end $$;

create or replace function public.prodops_media_attach(
  p_owner_kind text, p_owner_id uuid, p_bucket text, p_path text,
  p_media_type text default 'image', p_caption text default null, p_sort integer default 0
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_owner_kind not in ('location','permit') then raise exception 'invalid_owner_kind'; end if;
  -- 🔴 المالك يجب أن يوجد فعلًا: مرفق يتيم لا يُرى ولا يُحذف.
  if p_owner_kind = 'location'
     and not exists (select 1 from public.ops_locations where id = p_owner_id and is_deleted = false) then
    raise exception 'owner_not_found';
  end if;
  if p_owner_kind = 'permit'
     and not exists (select 1 from public.ops_permits where id = p_owner_id and is_deleted = false) then
    raise exception 'owner_not_found';
  end if;

  insert into public.ops_media (owner_kind, owner_id, media_type, storage_bucket, storage_path, caption, sort_order, added_by)
  values (p_owner_kind, p_owner_id, coalesce(p_media_type,'image'), btrim(p_bucket), btrim(p_path),
          nullif(btrim(coalesce(p_caption,'')),''), coalesce(p_sort,0), auth.uid())
  on conflict (owner_kind, owner_id, storage_bucket, storage_path)
    do update set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null,
                  caption = excluded.caption, sort_order = excluded.sort_order
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.prodops_media_delete(p_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;
  update public.ops_media
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), delete_reason = btrim(p_reason)
   where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  return true;
end $$;

-- ─── §6 · القراءة — سجلّ + وسائطه، ومهلة الانتهاء محسوبة لا مخزَّنة ────────
create or replace function public.prodops_permits_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.prodops_can_view() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'expires_at' nulls last), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', p.id, 'permit_type', p.permit_type, 'title', p.title,
      'authority_name', p.authority_name, 'reference_no', p.reference_no,
      'issued_at', p.issued_at, 'expires_at', p.expires_at, 'status', p.status,
      'scope', p.scope, 'project_id', p.project_id, 'asset_id', p.asset_id,
      'activity_note', p.activity_note, 'owner_user_id', p.owner_user_id, 'note', p.note,
      -- 🔴 مشتقّ لا مخزَّن: عمود days_left كان سيتعفّن كلّ منتصف ليل.
      'days_left', case when p.expires_at is null then null
                        else (p.expires_at - current_date) end,
      'media_count', (select count(*) from public.ops_media m
                       where m.owner_kind = 'permit' and m.owner_id = p.id and m.is_deleted = false)
    ) as x
    from public.ops_permits p
    where p.is_deleted = false
      and (p_filters->>'scope'  is null or p.scope  = p_filters->>'scope')
      and (p_filters->>'status' is null or p.status = p_filters->>'status')
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'can_manage', public.prodops_can_manage());
end $$;

create or replace function public.prodops_media_list(p_owner_kind text, p_owner_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.prodops_can_view() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_owner_kind not in ('location','permit') then raise exception 'invalid_owner_kind'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'media_type', m.media_type, 'bucket', m.storage_bucket,
           'path', m.storage_path, 'caption', m.caption, 'sort_order', m.sort_order,
           'added_by', m.added_by, 'created_at', m.created_at
         ) order by m.sort_order, m.created_at), '[]'::jsonb) into v_rows
  from public.ops_media m
  where m.owner_kind = p_owner_kind and m.owner_id = p_owner_id and m.is_deleted = false;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'can_manage', public.prodops_can_manage());
end $$;

-- ─── §7 · V2-3.2-C · تنبيهات ٣٠ و٧ أيام ───────────────────────────────────
--
-- 🔴 على النظام القائم بالكامل: civ_alert_once لمنع التكرار، وciv_notify_managers
--    للتسليم. ⛔ لا خدمة ثانية ولا مجدول رابع — يُطوى النداء في cron العهدة.
create or replace function public.prodops_permit_alerts_run()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_30 int := 0; v_7 int := 0; v_exp int := 0;
        v_today date; v_days int;
begin
  -- 🔴 المنطقة الزمنية **صريحة**. current_date يتبع منطقة الخادم، وتصريح ينتهي
  -- اليوم في الرياض قد يبدو منتهيًا أمس أو غدًا بحسبها — فيُطلق تنبيه في اليوم
  -- الخطأ أو لا يُطلق أصلًا.
  v_today := (now() at time zone 'Asia/Riyadh')::date;

  if to_regproc('public.civ_alert_once(text,text,text,uuid)') is null
     or to_regproc('public.civ_notify_managers(text,uuid,text,text)') is null then
    -- حزمة العهدة غير مطبَّقة ⇒ يُعلن التعطيل ولا يُخترع مسار تسليم ثانٍ.
    return jsonb_build_object('ok', true, 'disabled', true, 'reason', 'notification_helpers_missing');
  end if;

  for r in
    select id, title, expires_at, owner_user_id, (expires_at - v_today) as days_left
      from public.ops_permits
     -- ⛔ بلا تاريخ انتهاء لا تنبيه. و`revoked`/`expired`/`not_required`/`rejected`
     --    خارج النطاق: تصريح ملغى لا «يوشك أن ينتهي».
     where is_deleted = false
       and expires_at is not null
       and status in ('pending','submitted','approved')
  loop
    v_days := r.days_left;

    -- ٣٠ يومًا: مرّة واحدة لكلّ تصريح لهذه العتبة. المفتاح لا يحمل تاريخ اليوم،
    -- فلا يتكرّر يوميًّا طوال النافذة.
    if v_days <= 30 and v_days > 7 then
      if public.civ_alert_once('permit30:'||r.id||':'||to_char(r.expires_at,'YYYYMMDD'),
                               'permit_expiring', 'ops_permits', r.id) then
        perform public.civ_notify_managers('permit_expiring', r.id,
          'تصريح ينتهي خلال ' || v_days || ' يومًا: ' || r.title,
          'Permit expires in ' || v_days || ' days: ' || r.title);
        v_30 := v_30 + 1;
      end if;
    end if;

    -- ٧ أيام — عتبة مستقلّة بمفتاح مستقلّ، فلا يبتلع أحدهما الآخر.
    if v_days <= 7 and v_days >= 0 then
      if public.civ_alert_once('permit7:'||r.id||':'||to_char(r.expires_at,'YYYYMMDD'),
                               'permit_expiring', 'ops_permits', r.id) then
        perform public.civ_notify_managers('permit_expiring', r.id,
          'تصريح ينتهي خلال ' || v_days || ' يومًا: ' || r.title,
          'Permit expires in ' || v_days || ' days: ' || r.title);
        v_7 := v_7 + 1;
      end if;
    end if;

    -- انتهى فعلًا: يُعلَّم مرّة واحدة. التجديد يغيّر expires_at ⇒ مفتاح جديد
    -- ⇒ دورة تنبيهات جديدة تلقائيًّا بلا تدخّل.
    if v_days < 0 then
      if public.civ_alert_once('permitexp:'||r.id||':'||to_char(r.expires_at,'YYYYMMDD'),
                               'permit_expired', 'ops_permits', r.id) then
        update public.ops_permits set status = 'expired', updated_at = now()
         where id = r.id and status in ('pending','submitted','approved');
        perform public.civ_notify_managers('permit_expired', r.id,
          'انتهى تصريح: ' || r.title, 'Permit expired: ' || r.title);
        v_exp := v_exp + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'notified_30', v_30, 'notified_7', v_7, 'expired', v_exp);
end $$;

-- ─── §8 · الصلاحيات — REVOKE أوّلًا ثمّ منح محدَّد ─────────────────────────
revoke all on function public.prodops_permit_upsert(jsonb) from public, anon;
grant execute on function public.prodops_permit_upsert(jsonb) to authenticated;
revoke all on function public.prodops_permit_delete(uuid,text) from public, anon;
grant execute on function public.prodops_permit_delete(uuid,text) to authenticated;
revoke all on function public.prodops_permits_list(jsonb) from public, anon;
grant execute on function public.prodops_permits_list(jsonb) to authenticated;
revoke all on function public.prodops_media_attach(text,uuid,text,text,text,text,integer) from public, anon;
grant execute on function public.prodops_media_attach(text,uuid,text,text,text,text,integer) to authenticated;
revoke all on function public.prodops_media_delete(uuid,text) from public, anon;
grant execute on function public.prodops_media_delete(uuid,text) to authenticated;
revoke all on function public.prodops_media_list(text,uuid) from public, anon;
grant execute on function public.prodops_media_list(text,uuid) to authenticated;

-- 🔴 محرّك التنبيهات لمفتاح الخدمة وحده — يستدعيه cron، ولا مستخدم يُطلقه.
revoke all on function public.prodops_permit_alerts_run() from public, anon, authenticated;
grant execute on function public.prodops_permit_alerts_run() to service_role;

commit;

notify pgrst, 'reload schema';
