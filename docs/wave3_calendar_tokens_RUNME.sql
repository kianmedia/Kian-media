-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · V2-3.6-A/B — روابط تقويم قابلة للإلغاء (ICS) لأيام التصوير.
--
-- MASTER_BRIEF_v2.1.md §4 WAVE 3:
--   «calendar_tokens + /api/calendar/[token].ics (أيام التصوير، رموز طويلة قابلة
--    للإلغاء). نمط الرمز الملغى قائم في liveops_client_links — يُحتذى.»
--
-- ★ النمط المُحتذى، لا نظام جديد ★
-- `liveops_client_links` يخزّن **بصمة** الرمز لا الرمز، بحالة
-- draft/active/revoked/expired/exhausted وسقف فتحات وعدّاد. نفس العقد هنا.
--
-- ★★ 🔴 هذا الملفّ يمنح `anon` تنفيذ دالّة واحدة — وهذا أخطر ما في Wave 3 ★★
-- سبق أن قرأت قاعدةُ هذا المشروع بيانات شركة حقيقية عبر مفتاح anon، بسبب
-- NULL-collapse داخل بوّابة SECURITY DEFINER مع غياب REVOKE. فكلّ سطر في §4
-- مكتوب ضدّ ذلك تحديدًا:
--   • رفض صريح لـNULL وللفراغ وللطول المخالف **قبل** أيّ SELECT.
--   • مطابقة على بصمة ٦٤ محرفًا ست عشريًّا فقط — لا LIKE ولا تطبيع.
--   • لا صفّ يُقرأ إلّا بعد إثبات أنّ الرمز نشط وغير منتهٍ وغير مستنفد.
--   • REVOKE ALL أوّلًا ثمّ GRANT محدَّد — لا وراثة صامتة.
--   • المخرجات مُصفّاة: لا هواتف، لا أجور، لا ملاحظات داخلية.
--
-- ⛔ لا pg_net · لا بريد · لا مجدول (G8) · إضافي بالكامل · إعادة التشغيل آمنة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.ops_jobs') is null then
    raise exception '🔴 ops_jobs مفقود — شغّل operations_center_RUNME.sql أولًا';
  end if;
end $$;

-- ─── §1 · الجدول ───────────────────────────────────────────────────────────
create table if not exists public.ops_calendar_tokens (
  id              uuid primary key default gen_random_uuid(),
  label           text,
  -- 🔴 صاحب الرمز. النطاق 'mine' يُقيَّم **بهذا العمود** لا بالمستدعي: قارئ
  -- الرابط مجهول تمامًا، فلا هوية تُستخرج منه وقت القراءة.
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  -- أقلّ امتياز: 'mine' هو الافتراض؛ 'all' يحتاج صلاحية إدارة عند الإصدار.
  scope           text not null default 'mine' check (scope in ('mine','all')),
  status          text not null default 'active'
                  check (status in ('active','revoked','expired','exhausted')),
  -- ⛔ الرمز الخامّ لا يُخزَّن أبدًا. البصمة sha256 ست عشرية ٦٤ محرفًا.
  token_hash      text not null unique
                  check (token_hash ~ '^[0-9a-f]{64}$'),
  -- آخر ٦ محارف للتعرّف البشريّ على الرابط دون كشفه.
  token_hint      text check (token_hint is null or length(token_hint) <= 8),
  issued_at       timestamptz not null default now(),
  issued_by       uuid references auth.users(id),
  expires_at      timestamptz not null,
  max_opens       integer check (max_opens is null or max_opens between 1 and 100000),
  opens_used      integer not null default 0 check (opens_used >= 0),
  last_opened_at  timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id),
  revoke_reason   text,
  created_at      timestamptz not null default now(),
  constraint ops_cal_token_window check (expires_at > issued_at),
  -- إلغاء بلا سبب مكتوب ليس إلغاءً قابلًا للتدقيق.
  constraint ops_cal_token_revoked_pair check (
    status <> 'revoked' or (revoked_at is not null and length(btrim(coalesce(revoke_reason,''))) >= 3))
);

create index if not exists ops_calendar_tokens_owner_idx
  on public.ops_calendar_tokens (owner_user_id, status);

-- ─── §2 · RLS — deny by default ────────────────────────────────────────────
alter table public.ops_calendar_tokens enable row level security;

-- ⛔ لا سياسة SELECT لـanon إطلاقًا. القراءة العامّة تمرّ حصرًا عبر دالّة §4.
drop policy if exists ops_cal_tokens_self_read on public.ops_calendar_tokens;
create policy ops_cal_tokens_self_read on public.ops_calendar_tokens
  for select to authenticated
  using (owner_user_id = auth.uid() or public.prodops_can_manage());

-- ⛔ لا سياسة INSERT/UPDATE/DELETE: الكتابة عبر الدوالّ المحروسة وحدها.

-- ─── §3 · الإصدار والإلغاء — بصلاحية المستخدم ──────────────────────────────
-- الرمز الخامّ يُولَّد **في الخادم** ويُعاد **مرّة واحدة**. لا سبيل لاسترجاعه.
create or replace function public.prodops_calendar_token_issue(
  p_label text default null,
  p_scope text default 'mine',
  p_days  integer default 90,
  p_max_opens integer default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_raw text; v_hash text; v_id uuid; v_days int;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.prodops_can_view() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- 🔴 أقلّ امتياز: نطاق 'all' لمن يملك الإدارة فقط.
  if p_scope not in ('mine','all') then
    raise exception 'invalid_scope';
  end if;
  if p_scope = 'all' and not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_days := least(greatest(coalesce(p_days, 90), 1), 365);

  -- ٣٢ بايت عشوائية ⇒ ٦٤ محرفًا ست عشريًّا. gen_random_bytes من pgcrypto.
  v_raw  := encode(public.gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.ops_calendar_tokens
    (label, owner_user_id, scope, token_hash, token_hint, issued_by, expires_at, max_opens)
  values
    (nullif(btrim(coalesce(p_label,'')), ''), auth.uid(), p_scope, v_hash,
     right(v_raw, 6), auth.uid(), now() + make_interval(days => v_days), p_max_opens)
  returning id into v_id;

  -- ⚠️ `token` يظهر هنا مرّة واحدة ولا يُخزَّن. مَن فقده يُصدر غيره ويُلغي القديم.
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_raw,
                            'hint', right(v_raw, 6), 'scope', p_scope,
                            'expires_at', now() + make_interval(days => v_days));
end $$;

create or replace function public.prodops_calendar_token_revoke(
  p_id uuid, p_reason text
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;

  select * into r from public.ops_calendar_tokens where id = p_id for update;
  if r.id is null then raise exception 'not_found'; end if;
  -- صاحب الرمز أو مدير التشغيل — لا أحد غيرهما.
  if r.owner_user_id <> auth.uid() and not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.ops_calendar_tokens
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = btrim(p_reason)
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ─── §4 · 🔴 القراءة العامّة — الدالّة الوحيدة الممنوحة لـanon ──────────────
create or replace function public.prodops_calendar_feed(p_token_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r record; v_rows jsonb; v_now timestamptz := now();
begin
  -- 🔴 الحارس قبل أيّ قراءة. NULL أو فراغ أو شكل مخالف ⇒ رفض فوريّ.
  -- (هذا بالضبط ما انهار سابقًا: NULL مرّ فصار الشرط null وقُرئ الصفّ.)
  if p_token_hash is null
     or length(p_token_hash) <> 64
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select * into r from public.ops_calendar_tokens
   where token_hash = p_token_hash            -- مطابقة تامّة، لا LIKE ولا lower()
   for update;

  if r.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  if r.status = 'revoked' then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if r.expires_at <= v_now then
    update public.ops_calendar_tokens set status = 'expired' where id = r.id and status = 'active';
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if r.max_opens is not null and r.opens_used >= r.max_opens then
    update public.ops_calendar_tokens set status = 'exhausted' where id = r.id and status = 'active';
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;

  -- ⛔ المخرجات مُصفّاة عمدًا: لا هواتف ولا أجور ولا ملاحظات داخلية ولا عملاء.
  -- رابط تقويم قد يُشارَك بلا قصد؛ فما فيه هو ما لا يضرّ تسرّبه.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'code', j.job_code, 'title', j.title,
           'start', j.scheduled_start, 'end', j.scheduled_end,
           'status', j.status,
           'location', l.name, 'city', l.city
         ) order by j.scheduled_start), '[]'::jsonb)
    into v_rows
    from public.ops_jobs j
    left join public.ops_locations l on l.id = j.location_id
   where coalesce(j.is_deleted, false) = false
     and j.scheduled_start is not null
     -- نافذة معقولة: لا تاريخ كامل في تغذية تقويم.
     and j.scheduled_start >= (v_now - interval '30 days')
     and j.scheduled_start <= (v_now + interval '180 days')
     -- 🔴 النطاق يُقيَّم على **صاحب الرمز** لا على المستدعي المجهول.
     and (
       r.scope = 'all'
       or exists (
         select 1 from public.ops_job_crew c
          where c.job_id = j.id
            and c.user_id = r.owner_user_id
            and coalesce(c.is_deleted, false) = false
       )
     );

  update public.ops_calendar_tokens
     set opens_used = opens_used + 1, last_opened_at = v_now
   where id = r.id;

  return jsonb_build_object('ok', true, 'scope', r.scope, 'events', v_rows);
end $$;

-- ─── §5 · الصلاحيات — REVOKE أوّلًا، ثمّ منح محدَّد ─────────────────────────
revoke all on function public.prodops_calendar_token_issue(text,text,integer,integer) from public, anon;
grant execute on function public.prodops_calendar_token_issue(text,text,integer,integer) to authenticated;

revoke all on function public.prodops_calendar_token_revoke(uuid,text) from public, anon;
grant execute on function public.prodops_calendar_token_revoke(uuid,text) to authenticated;

-- 🔴 الوحيدة الممنوحة لـanon. الحارس داخلها (§4) هو خطّ الدفاع كلّه.
revoke all on function public.prodops_calendar_feed(text) from public;
grant execute on function public.prodops_calendar_feed(text) to anon, authenticated;

-- ⛔ ولا صلاحية جدول لـanon بأيّ حال.
revoke all on public.ops_calendar_tokens from anon, public;

commit;
