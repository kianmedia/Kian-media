-- ════════════════════════════════════════════════════════════════════════════
-- public_portal_rate_limit_RUNME.sql            (المرحلة الثانية — تقوية البوابة العامة)
--
-- ★ الثغرة المُثبَتة حيًّا ★
--   submit_opportunity_request ممنوحة لـanon (وهذا **مطلوب** — النموذج العام يستدعيها
--   مباشرةً من المتصفّح بالمفتاح العامّ). إثبات حيّ: استدعاء مباشر بالمفتاح العامّ يُعيد
--       {"code":"P0001","message":"invalid opportunity type"}
--   وهو خطأ يُرفع من **داخل جسم الدالّة** ⇒ PostgREST وجدها وanon نفّذها. بينما الضابط
--   capture_public_intake يُعيد PGRST202 (غير مرئية لـanon).
--   النتيجة: أي شخص يرسل POST مباشرًا يتجاوز الـhoneypot وكل تحقّق الواجهة، ويُدرج صفوفًا
--   ويُطلق إشعارات بلا حدّ.
--
-- ★ لماذا لا نسحب الصلاحية ★ سحب EXECUTE من anon **يقتل نموذج الفرص العام**. الحماية يجب
--   أن تكون **داخل الدالّة** — وهذا ما يفعله هذا الملفّ.
--
-- ★ لماذا في قاعدة البيانات ★ المكبح الذي أضفتُه في TS يعيش في ذاكرة نسخة serverless
--   واحدة: لا ينجو من cold start ولا يُوقف هجومًا موزّعًا. الجدول أدناه **دائم ومشترك بين
--   كل النسخ** — وهو الحلّ الملائم للبنية الحالية (Postgres + SECURITY DEFINER RPC)
--   بلا أي خدمة خارجية ولا Redis ولا captcha.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات · Self-test.
-- لا يمسّ منصّة المشاريع ولا نظام الإشعارات (منطق notify داخل الدالّة مُبقًى حرفيًّا).
-- التشغيل: psql "$DATABASE_URL" -f docs/public_portal_rate_limit_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)') is null then
    raise exception 'PREFLIGHT: submit_opportunity_request missing — run docs/opportunities_center_RUNME.sql then the notifications addendum first';
  end if;
  if to_regclass('public.opportunity_requests') is null then raise exception 'PREFLIGHT: opportunity_requests missing'; end if;
end $pre$;

begin;

-- ─── §1 عدّاد نافذة ثابتة، دائم ومشترك ───────────────────────────────────────
create table if not exists public.public_rate_limits (
  bucket      text        primary key,
  hits        int         not null default 0,
  window_end  timestamptz not null,
  updated_at  timestamptz not null default now()
);
comment on table public.public_rate_limits is
  'Durable fixed-window counters for PUBLIC anon-callable RPCs. Shared across all serverless instances (unlike an in-memory limiter). Not user data — safe to prune.';

create index if not exists ix_public_rate_limits_window on public.public_rate_limits(window_end);

-- لا وصول مباشر لأحد: الجدول يُقرأ ويُكتب حصريًّا عبر الدالّة SECURITY DEFINER أدناه.
alter table public.public_rate_limits enable row level security;
do $g$
begin
  execute 'revoke all on table public.public_rate_limits from public';
  begin execute 'revoke all on table public.public_rate_limits from anon, authenticated'; exception when undefined_object then null; end;
end $g$;

-- ─── §2 استهلاك حصّة — يُعيد true إذا سُمح ────────────────────────────────────
-- SECURITY DEFINER كي تعمل رغم RLS/غياب المنح. **لا تُمنح لـanon**: تُستدعى فقط من داخل
-- دوالّ أخرى (نفس المعاملة)، فلا يستطيع مهاجم استنزاف حصّة غيره أو استعلام العدّادات.
create or replace function public.rl_consume(p_bucket text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now(); v_hits int;
begin
  if coalesce(btrim(p_bucket),'') = '' or p_limit is null or p_limit <= 0 then return true; end if;

  -- upsert ذرّي: إمّا نافذة جديدة أو زيادة داخل النافذة القائمة.
  insert into public.public_rate_limits(bucket, hits, window_end, updated_at)
  values (p_bucket, 1, v_now + make_interval(secs => greatest(p_window_seconds, 1)), v_now)
  on conflict (bucket) do update
    set hits = case when public.public_rate_limits.window_end <= v_now then 1
                    else public.public_rate_limits.hits + 1 end,
        window_end = case when public.public_rate_limits.window_end <= v_now
                          then v_now + make_interval(secs => greatest(p_window_seconds, 1))
                          else public.public_rate_limits.window_end end,
        updated_at = v_now
  returning hits into v_hits;

  return v_hits <= p_limit;
end $$;

do $g2$
begin
  execute 'revoke all on function public.rl_consume(text,int,int) from public';
  begin execute 'revoke all on function public.rl_consume(text,int,int) from anon, authenticated'; exception when undefined_object then null; end;
  begin execute 'grant execute on function public.rl_consume(text,int,int) to service_role'; exception when undefined_object then null; end;
end $g2$;

-- ─── §3 تنظيف النوافذ المنتهية (يُستدعى من داخل الدالّة، بلا cron جديد) ───────
create or replace function public.rl_prune()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  delete from public.public_rate_limits where window_end < now() - interval '1 day';
  get diagnostics v = row_count; return v;
end $$;
do $g3$
begin
  execute 'revoke all on function public.rl_prune() from public';
  begin execute 'revoke all on function public.rl_prune() from anon, authenticated'; exception when undefined_object then null; end;
end $g3$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4 إعادة تعريف submit_opportunity_request مع الحماية **داخلها**
--     المنطق الأصليّ (التحقّق + الإدراج + الإشعارات) مُبقًى **حرفيًّا** كما هو.
--     المضاف فقط: سقف معدّل + كبح تكرار + تقليم الحقول.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.submit_opportunity_request(
  p_type text, p_full_name text, p_email text default null, p_phone text default null,
  p_city text default null, p_message text default null,
  p_details jsonb default '{}'::jsonb, p_consent boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_num text; v_ar text; v_en text; r record;
  v_email text := lower(nullif(trim(coalesce(p_email,'')),''));
  v_name  text := trim(coalesce(p_full_name,''));
  v_dupe  text;
begin
  -- ── التحقّق الأصليّ (بلا تغيير) ──
  if p_type <> all (array['job_application','training','collaboration','co_production',
                          'freelancer','supplier','media_partnership','talent',
                          'sponsorship','volunteer']) then
    raise exception 'invalid opportunity type';
  end if;
  if coalesce(v_name,'') = '' then raise exception 'full name required'; end if;
  if p_consent is not true then raise exception 'consent required'; end if;

  -- ── جديد: حدود الحجم. الواجهة تفرض maxLength لكنّ الاستدعاء المباشر يتجاوزها. ──
  if length(v_name) > 200 then raise exception 'full name too long'; end if;
  if length(coalesce(p_message,'')) > 5000 then raise exception 'message too long'; end if;
  if length(coalesce(p_email,'')) > 200 or length(coalesce(p_phone,'')) > 60
     or length(coalesce(p_city,'')) > 120 then raise exception 'field too long'; end if;
  if p_details is not null and length(p_details::text) > 20000 then raise exception 'details too large'; end if;

  -- ── جديد: كبح التكرار. الضغط المزدوج أو إعادة الإرسال خلال 10 دقائق بنفس
  --     (البريد + نوع الفرصة) يُعيد **رقم الطلب نفسه** بدل إنشاء صفّ ثانٍ.
  --     لا يُطبَّق بلا بريد (لا مفتاح يُعتمد عليه) — يكفيه سقف المعدّل أدناه. ──
  if v_email is not null then
    select o.request_number into v_dupe
      from public.opportunity_requests o
     where lower(o.email) = v_email
       and o.opportunity_type = p_type
       and o.is_deleted = false
       and o.created_at > now() - interval '10 minutes'
     order by o.created_at desc
     limit 1;
    if v_dupe is not null then return v_dupe; end if;
  end if;

  -- ── جديد: سقف المعدّل، دائم ومشترك بين النسخ. سخيّ جدًّا مقارنةً بسلوك بشريّ. ──
  if v_email is not null then
    if not public.rl_consume('opp:email:' || v_email, 5, 3600) then
      raise exception 'rate limited: too many submissions, please try again later'
        using errcode = 'P0001';
    end if;
  else
    -- بلا بريد ⇒ لا مفتاح مميِّز: حصّة مشتركة أوسع، تمنع الإغراق دون حجب فرد.
    if not public.rl_consume('opp:anon:' || p_type, 30, 3600) then
      raise exception 'rate limited: too many submissions, please try again later'
        using errcode = 'P0001';
    end if;
  end if;

  -- تنظيف كسول للنوافذ القديمة (بلا cron جديد؛ فشله لا يُفشل الطلب).
  begin perform public.rl_prune(); exception when others then null; end;

  -- ── الأصل: الإدراج (بلا تغيير) ──
  v_num := 'OPP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.opportunity_seq')::text, 5, '0');
  insert into public.opportunity_requests
    (request_number, opportunity_type, full_name, email, phone, city, message, details, consent, source)
  values
    (v_num, p_type, v_name, v_email,
     nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_city,'')),''),
     nullif(trim(coalesce(p_message,'')),''), coalesce(p_details,'{}'::jsonb), true, 'public')
  returning id into v_id;

  -- ── الأصل: الإشعارات (بلا تغيير — نظام الإشعارات مُجمَّد) ──
  v_ar := 'طلب فرصة جديد — ' || v_name || ' (' || v_num || ')';
  v_en := 'New opportunity request — ' || v_name || ' (' || v_num || ')';
  perform public.notify(null, 'admin', 'opportunity_new', 'opportunity', v_id, v_ar, v_en);
  for r in
    select id from public.profiles
    where account_status = 'active' and (
      staff_role = 'super_admin'
      or (staff_role = 'hr'      and p_type in ('job_application','training','freelancer','talent','volunteer'))
      or (staff_role = 'manager' and p_type in ('collaboration','co_production','media_partnership','sponsorship','supplier'))
    )
  loop
    perform public.notify(r.id, 'user', 'opportunity_new', 'opportunity', v_id, v_ar, v_en);
  end loop;

  return v_num;
end; $$;

-- الصلاحيات **كما كانت حرفيًّا**: سحبها من anon يقتل النموذج العام.
revoke execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) from public;
grant  execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «RL FAIL …». يستخدم دلاءً وهميّة ويُنظّفها.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_ok boolean; v_b text := 'selftest:' || md5(clock_timestamp()::text);
begin
  if to_regclass('public.public_rate_limits') is null then raise exception 'RL FAIL: table missing'; end if;
  if to_regprocedure('public.rl_consume(text,int,int)') is null then raise exception 'RL FAIL: rl_consume missing'; end if;

  -- يسمح بالحدّ ثمّ يرفض
  if not public.rl_consume(v_b, 2, 3600) then raise exception 'RL FAIL: 1st call must pass'; end if;
  if not public.rl_consume(v_b, 2, 3600) then raise exception 'RL FAIL: 2nd call must pass'; end if;
  if     public.rl_consume(v_b, 2, 3600) then raise exception 'RL FAIL: 3rd call must be refused'; end if;
  delete from public.public_rate_limits where bucket = v_b;

  -- الدالّة العامّة ما زالت ممنوحة لـanon (وإلّا مات النموذج)
  if not has_function_privilege('anon',
        'public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)', 'EXECUTE')
    then raise exception 'RL FAIL: the public opportunities form would be dead (anon lost EXECUTE)'; end if;
  -- لكن العدّاد نفسه غير مكشوف
  if has_function_privilege('anon', 'public.rl_consume(text,int,int)', 'EXECUTE')
    then raise exception 'RL FAIL: rl_consume must not be anon-callable'; end if;
  if has_table_privilege('anon', 'public.public_rate_limits', 'SELECT')
    then raise exception 'RL FAIL: counters must not be readable by anon'; end if;

  raise notice 'RL SELF-TEST PASSED — durable limiter live; public form still reachable.';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION (بالمفتاح العامّ — يجب أن يبقى النموذج حيًّا)
--   set -a; . ./.env.local; set +a
--   1) النموذج ما زال يعمل (خطأ تحقّق، لا 42501):
--      curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/submit_opportunity_request" \
--        -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
--        -d '{"p_type":"bogus","p_full_name":"x","p_consent":true}'
--      المتوقّع: P0001 "invalid opportunity type"  (وجود الرسالة = النموذج حيّ)
--   2) العدّاد غير مكشوف:
--      curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/public_rate_limits?select=bucket&limit=1" \
--        -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--      المتوقّع: 42501
--   3) كبح التكرار (من النموذج الحقيقيّ): أرسل مرّتين بنفس البريد والنوع خلال 10 دقائق
--      ⇒ يجب أن يعود **رقم الطلب نفسه**، ولا يظهر صفّ ثانٍ:
--      select request_number, created_at from public.opportunity_requests
--       where email = '<البريد>' order by created_at desc limit 5;
--   4) السقف: 6 محاولات متتالية بنفس البريد ⇒ السادسة تُعيد "rate limited".
--
-- ROLLBACK / RECOVERY
--   • إضافيّ بحت: لا حذف بيانات ولا DROP TABLE. إعادة التشغيل آمنة.
--   • للتراجع عن الحماية فقط (يُعيد فتح الثغرة): أعد تشغيل
--     docs/opportunities_notifications_addendum_RUNME.sql — يستعيد النسخة السابقة حرفيًّا.
--   • public_rate_limits جدول عدّادات لا بيانات مستخدمين؛ تفريغه آمن تمامًا:
--       delete from public.public_rate_limits;
-- ════════════════════════════════════════════════════════════════════════════
