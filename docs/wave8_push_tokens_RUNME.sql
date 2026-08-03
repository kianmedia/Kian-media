-- ════════════════════════════════════════════════════════════════════════════
-- wave8_push_tokens_RUNME.sql — تسجيل أجهزة الدفع. ⛔ **لم يُشغَّل بعد.**
--
-- Wave 8 · V2-8.3-A · إضافيّ · idempotent · deny-by-default
--
-- ★ ما هذه الحزمة، وما ليست ★
--  • **توسعة** لنطاق الإشعارات القائم: نفس المستلمين، نفس التفضيلات، نفس سجلّ
--    التسليم. ⛔ **ليست خدمة إشعارات ثانية** ولا طابورًا موازيًا.
--  • تُسجّل **أجهزة**؛ ولا تُرسل شيئًا. الإرسال محكوم بعلم مطفأ في الشيفرة.
--
-- ★★ 🔴 قرار مُعلَّق يجب أن يقرأه المشغِّل قبل التشغيل ★★
--     **MOBILE PUSH TOKEN ENCRYPTION DECISION**
--     رمز Expo يُخزَّن هنا **نصًّا صريحًا** (`token`). ولا يُدَّعى أنّه مشفَّر،
--     لأنّه لا توجد استراتيجية إدارة مفاتيح في هذه المنصّة: تشفيرٌ بمفتاح مخزَّن
--     في القاعدة نفسها **ليس تشفيرًا**، بل تعقيدٌ يُوهم الأمان.
--     والبصمة `token_fingerprint` **لا تُغني**: لا يمكن الإرسال ببصمة — الإرسال
--     يتطلّب الرمز الأصليّ، فلا مهرب من حفظه أو حفظ ما يفكّه.
--     الحماية الفعليّة هنا: RLS يمنع كلّ قراءة للعمود من أيّ عميل (§٦)، والقراءة
--     الوحيدة تمرّ بمفتاح الخدمة خادميًّا. راجع docs/mobile/MOBILE_SECURITY.md.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── ١ · حارس مسبق: لا نبني موازيًا ─────────────────────────────────────────
do $$
begin
  if to_regclass('public.notification_preferences') is null
     or to_regclass('public.notification_delivery_log') is null then
    raise exception 'WAVE8_PUSH_PREREQ_MISSING: نطاق الإشعارات القائم غير مطبَّق. '
      'شغّل حزم الإشعارات أوّلًا — هذه الحزمة توسّعه ولا تستبدله.';
  end if;
end $$;

-- ─── ٢ · الجدول ─────────────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  id                 uuid primary key default gen_random_uuid(),

  -- المالك. الحذف المتتالي مقصود: لا يبقى جهاز مسجَّل لحساب محذوف.
  user_id            uuid not null references auth.users(id) on delete cascade,

  platform           text not null check (platform in ('ios','android','web')),

  -- مُعرِّف الجهاز من التطبيق (مستقرّ عبر إعادة التثبيت حيث تسمح المنصّة).
  device_id          text not null check (length(device_id) between 1 and 200),
  device_name        text check (device_name is null or length(device_name) <= 120),

  -- 🔴 الرمز نفسه. انظر قرار التشفير في الرأس.
  token              text not null check (length(token) between 8 and 400),

  -- بصمة للاكتشاف ومنع التكرار **دون قراءة الرمز**. sha256 مُملَّح بثابت النطاق
  -- كي لا تُقارن ببصمات مُسرَّبة من نظام آخر.
  token_fingerprint  text generated always as (
                       encode(digest('kian-push-v1:' || token, 'sha256'), 'hex')
                     ) stored,

  app_version        text check (app_version is null or length(app_version) <= 40),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),

  -- إبطال بفعل المستخدم (خروج/إزالة جهاز).
  revoked_at         timestamptz,
  revocation_reason  text check (revocation_reason in
                       ('logout','user_removed','device_replaced','admin_revoked','stale')),

  -- إبطال بقرار المزوِّد (Expo أعادت DeviceNotRegistered).
  invalidated_at     timestamptz,
  invalidation_reason text check (invalidation_reason in
                       ('device_not_registered','invalid_credentials','message_too_big','provider_other')),

  -- 🔴 حالة مشتقّة لا مُدخَلة: مصدر واحد للحقيقة، فلا ينحرف عمود `is_active`
  --    عن الطوابع الزمنية كما يحدث حين يُحدَّث أحدهما دون الآخر.
  is_active          boolean generated always as
                       (revoked_at is null and invalidated_at is null) stored
);

-- ─── ٣ · منع التسجيل النشط المكرَّر ─────────────────────────────────────────
-- 🔴 جزئيّ على `is_active`: الجهاز الواحد لا يملك إلّا رمزًا نشطًا واحدًا، بينما
--    تبقى السجلّات المُبطَلة للتاريخ. وبدون هذا يتراكم لجهاز واحد عشرات الرموز
--    فيصل الإشعار مكرَّرًا — وهو أسرع طريق لإطفاء المستخدم للإشعارات كلّها.
create unique index if not exists ux_push_tokens_active_device
  on public.push_tokens (user_id, platform, device_id)
  where is_active;

-- ونفس الرمز لا يُسجَّل نشطًا لمستخدمَين — أحدهما مسروق أو جهاز أُعيد بيعه.
create unique index if not exists ux_push_tokens_active_fingerprint
  on public.push_tokens (token_fingerprint)
  where is_active;

create index if not exists ix_push_tokens_user_active
  on public.push_tokens (user_id) where is_active;

comment on table public.push_tokens is
  'Wave 8 V2-8.3-A — تسجيل أجهزة الدفع. توسعة لنطاق الإشعارات القائم لا بديل عنه. '
  'الرمز نصّ صريح: MOBILE PUSH TOKEN ENCRYPTION DECISION معلَّق (انظر رأس الحزمة).';
comment on column public.push_tokens.token is
  '🔴 حسّاس. ⛔ لا يُقرأ من عميل، ولا يُسجَّل، ولا يظهر في تدقيق أو خطأ.';

-- ─── ٤ · توسعة التفضيلات القائمة — لا جدول تفضيلات ثانٍ ────────────────────
alter table public.notification_preferences
  add column if not exists push_enabled boolean not null default false;
-- 🔴 الافتراض `false`: الدفع مُستقبِل خلفيّ دائم على جهاز قد لا يكون بيد صاحبه،
--    فتفعيله اختيارٌ صريح لا إرث.

-- ─── ٥ · توسعة قيد القناة في سجلّ التسليم القائم ────────────────────────────
-- 🔴 بدون هذا يفشل كلّ إدراج قناته 'push' بـ23514 **داخل مُحفِّز**، فيسقط التسليم
--    بصمت. القيد يُعاد بناؤه بأمان: القيم القديمة كلّها ما تزال مسموحة.
do $$
declare c_name text;
begin
  select con.conname into c_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'notification_delivery_log'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%channel%'
  limit 1;

  if c_name is not null then
    execute format('alter table public.notification_delivery_log drop constraint %I', c_name);
  end if;

  alter table public.notification_delivery_log
    add constraint notification_delivery_log_channel_check
    check (channel in ('portal','email','both','none','push'));
end $$;

-- والنتائج المسموحة تشمل نتائج الدفع.
do $$
declare c_name text;
begin
  select con.conname into c_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'notification_delivery_log'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%outcome%'
  limit 1;
  if c_name is not null then
    execute format('alter table public.notification_delivery_log drop constraint %I', c_name);
  end if;
  alter table public.notification_delivery_log
    add constraint notification_delivery_log_outcome_check
    check (outcome in ('portal_created','email_sent','email_failed','email_skipped',
                       'excluded','resolved',
                       'push_sent','push_failed','push_skipped','push_token_invalid'));
end $$;

-- ─── ٦ · RLS — رفض افتراضيّ، ولا قراءة للرمز من أيّ عميل ───────────────────
alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

-- ⛔ لا سياسة SELECT للمستخدم على الجدول إطلاقًا. القراءة تمرّ بدالّة (§٧) تُعيد
--    البيانات الوصفية دون الرمز. ولو مُنحت SELECT لصار `select token from
--    push_tokens` مشروعًا لصاحب الحساب — ورمز الدفع يُقرأ من متصفّح مخترَق.
drop policy if exists pt_owner_insert on public.push_tokens;
create policy pt_owner_insert on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists pt_owner_update on public.push_tokens;
create policy pt_owner_update on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ⛔ ولا DELETE لأحد: الإبطال يُسجَّل ولا يُمحى، وإلّا ضاع أثر «جهاز فُقد».

revoke all on public.push_tokens from public, anon, authenticated;
grant insert, update on public.push_tokens to authenticated;

-- ─── ٧ · الواجهة — دوالّ بمسار بحث مثبَّت ──────────────────────────────────

-- تسجيل/تجديد. تُعيد المعرِّف فقط؛ ⛔ ولا تُعيد الرمز ولا البصمة.
create or replace function public.push_register_token(
  p_platform text, p_device_id text, p_token text,
  p_device_name text default null, p_app_version text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_platform not in ('ios','android','web') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  -- الجهاز نفسه بمالك مختلف ⇒ يُبطَل القديم. جهاز أُعيد بيعه أو تسليمه لموظّف آخر
  -- يجب ألّا يستمرّ باستقبال إشعارات المالك السابق.
  update public.push_tokens
     set revoked_at = now(), revocation_reason = 'device_replaced', updated_at = now()
   where device_id = p_device_id and platform = p_platform
     and user_id <> v_uid and is_active;

  -- تجديد رمز نفس الجهاز: يُبطَل السابق ثمّ يُدرَج الجديد، فيبقى الفهرس الجزئيّ
  -- سليمًا ويبقى التاريخ.
  update public.push_tokens
     set revoked_at = now(), revocation_reason = 'stale', updated_at = now()
   where user_id = v_uid and device_id = p_device_id and platform = p_platform
     and is_active
     and token_fingerprint is distinct from
         encode(digest('kian-push-v1:' || p_token, 'sha256'), 'hex');

  -- نفس الرمز مرّة أخرى ⇒ نبضة حياة فقط.
  update public.push_tokens
     set last_seen_at = now(), updated_at = now(),
         app_version = coalesce(p_app_version, app_version)
   where user_id = v_uid and device_id = p_device_id and platform = p_platform
     and is_active
   returning id into v_id;
  if v_id is not null then return v_id; end if;

  insert into public.push_tokens (user_id, platform, device_id, device_name, token, app_version)
  values (v_uid, p_platform, p_device_id, p_device_name, p_token, p_app_version)
  returning id into v_id;
  return v_id;
end $$;

-- إبطال عند الخروج — الأثر الأهمّ أمنيًّا في الحزمة كلّها.
create or replace function public.push_revoke_my_tokens(
  p_device_id text default null, p_reason text default 'logout')
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_reason not in ('logout','user_removed','device_replaced','stale') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  update public.push_tokens
     set revoked_at = now(), revocation_reason = p_reason, updated_at = now()
   where user_id = v_uid and is_active
     and (p_device_id is null or device_id = p_device_id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- قائمة أجهزتي — ⛔ **بلا رمز وبلا بصمة**. وهذا سبب عدم منح SELECT في §٦.
create or replace function public.push_my_devices()
returns table (id uuid, platform text, device_name text, app_version text,
               last_seen_at timestamptz, created_at timestamptz, is_active boolean)
language sql security definer set search_path = public, pg_temp
as $$
  select t.id, t.platform, t.device_name, t.app_version,
         t.last_seen_at, t.created_at, t.is_active
  from public.push_tokens t
  where t.user_id = auth.uid()
  order by t.is_active desc, t.last_seen_at desc
$$;

-- إبطال بقرار المزوِّد. ⛔ خادميّة بحتة: لا تُمنح لأيّ دور عميل (§٨).
create or replace function public.push_mark_invalid(
  p_fingerprint text, p_reason text)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_reason not in ('device_not_registered','invalid_credentials',
                      'message_too_big','provider_other') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  -- 🔴 بالبصمة لا بالرمز: فلا يمرّ رمز دفع في وسيط دالّة قد يُسجَّل.
  update public.push_tokens
     set invalidated_at = now(), invalidation_reason = p_reason, updated_at = now()
   where token_fingerprint = p_fingerprint and is_active;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─── ٨ · صلاحيات التنفيذ — سحبٌ ثمّ منح ────────────────────────────────────
revoke all on function public.push_register_token(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.push_revoke_my_tokens(text,text)              from public, anon, authenticated;
revoke all on function public.push_my_devices()                            from public, anon, authenticated;
revoke all on function public.push_mark_invalid(text,text)                 from public, anon, authenticated;

grant execute on function public.push_register_token(text,text,text,text,text) to authenticated;
grant execute on function public.push_revoke_my_tokens(text,text)              to authenticated;
grant execute on function public.push_my_devices()                             to authenticated;
-- ⛔ push_mark_invalid تبقى بلا مِنَح: مفتاح الخدمة وحده يستدعيها. ومنحُها
--    لـauthenticated يتيح لأيّ مستخدم إبطال جهاز غيره لو خمّن بصمته.

commit;

\echo '=== WAVE 8 PUSH TOKENS مطبَّقة. ⚠️ MOBILE PUSH TOKEN ENCRYPTION DECISION ما تزال معلَّقة. ==='
