-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 4 · توسيع CRM والأعمال القائم — **دفعة ربط لا موجة بناء**.
--
-- MASTER_BRIEF_v2.1.md §4 WAVE 4 · «13 من 14 متطلبًا مبنية».
-- V2-4.1-A · V2-4.1-C · V2-4.2-B · V2-4.3-A · V2-4.4-A · V2-4.4-C · V2-4.5-A
--
-- ★★ ما لا يُنشأ هنا، ولماذا ★★
--  ⛔ لا جدول `tenders` — المناقصة **فرصة** لها حقول زائدة. الجهة والعميل
--     والقيمة والمرحلة والمالك كلّها على `crm_opportunities` بالفعل، وجدول
--     مستقلّ كان سيكرّرها ثمّ يتباعد عنها.
--  ⛔ لا جدول `client_health` — عرض مشتقّ. درجة صحّة **مخزَّنة** تتعفّن لحظة
--     تسجيل نشاط جديد، فتُعرض للمبيعات كحقيقة وهي قديمة.
--  ⛔ لا جدول `follow_ups` — `crm_activities` قائم.
--  ⛔ لا `rate_card_items` — منظومة `sq_*` (٢٩٦٤ سطرًا) قائمة.
--  ⛔ لا خدمة إشعارات ثانية ولا مجدول رابع (G8).
--
-- ⛔ لا كتابة في جدول مُجمَّد · لا حذف · إضافيّ بالكامل · إعادة التشغيل آمنة.
-- ⛔ ولا إرسال من القاعدة: لا pg_net ولا بريد. القاعدة **تقترح** والإنسان يرسل.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.crm_opportunities') is null then
    raise exception '🔴 crm_opportunities مفقود — شغّل crm_sales_FOUNDATION_RUNME.sql أولًا';
  end if;
end $$;

-- ─── §1 · V2-4.1-A · المناقصة كامتداد على الفرصة ───────────────────────────
--
-- علاقة ١:١ صارمة (`primary key` على المفتاح الأجنبيّ). الحقول هنا **لا تنتمي
-- منطقيًّا** إلى فرصة عادية: موعد تسليم المظروف، الضمان الابتدائيّ، مرجع
-- البوّابة الحكومية. وكلّ ما عداها يبقى على الفرصة ولا يُكرَّر.
create table if not exists public.crm_opportunity_tender (
  opportunity_id   uuid primary key
                   references public.crm_opportunities(id) on delete cascade,
  -- مرجع المناقصة لدى الجهة، ورقم البوّابة. ⛔ اسم الجهة **ليس** هنا: هو
  -- `company_id` على الفرصة.
  tender_reference text,
  portal_reference text,
  portal_name      text,
  -- مواعيد المناقصة — غير مواعيد الفرصة.
  announced_at     date,
  questions_due    date,
  submission_due   timestamptz,
  opening_at       timestamptz,
  award_expected   date,
  -- الضمانات. ⛔ لا تُحتسب في أيّ تقرير ماليّ — تسجيل لا محاسبة.
  bid_bond_required   boolean not null default false,
  bid_bond_amount     numeric(14,2) check (bid_bond_amount is null or bid_bond_amount >= 0),
  bid_bond_expires_at date,
  performance_bond_pct numeric(5,2) check (performance_bond_pct is null or performance_bond_pct between 0 and 100),
  -- حالة المشاركة — مفردات المناقصة لا مفردات الفرصة.
  submission_status text not null default 'not_submitted'
                    check (submission_status in ('not_submitted','preparing','submitted','shortlisted','awarded','not_awarded','withdrawn')),
  submitted_at      timestamptz,
  note              text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint crm_tender_dates check (
    (questions_due is null or submission_due is null or questions_due::timestamptz <= submission_due)
    and (submission_due is null or opening_at is null or opening_at >= submission_due)
  ),
  -- «مُقدَّم» يوجب تاريخ تقديم — وإلّا فالحالة ادّعاء بلا أثر.
  constraint crm_tender_submitted_pair check (
    submission_status not in ('submitted','shortlisted','awarded','not_awarded') or submitted_at is not null
  )
);

comment on table public.crm_opportunity_tender is
  'V2-4.1-A — امتداد ١:١ على crm_opportunities. ⛔ ليس CRM ثانيًا: لا اسم جهة '
  'ولا عميل ولا قيمة هنا — كلّها على الفرصة.';

create index if not exists crm_tender_due_idx
  on public.crm_opportunity_tender (submission_due)
  where submission_due is not null;

-- ─── §2 · V2-4.2-B · دعوة شهادة برمز — tokenised · scoped · expiring ───────
--
-- 🔴 المُشغِّل: إغلاق المشروع **و** سداد الدفعة النهائية. لكنّ الإرسال **ليس**
-- آليًّا: القاعدة تُنتج دعوة، والإنسان يقرّر الإرسال. طلب شهادة يُرسَل تلقائيًّا
-- بعد آخر دفعة قد يصل عميلًا في نزاع.
create table if not exists public.crm_testimonial_invites (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null,
  -- ⛔ الرمز الخامّ لا يُخزَّن. البصمة sha256 ست عشرية ٦٤ محرفًا.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint    text check (token_hint is null or length(token_hint) <= 8),
  status        text not null default 'active'
                check (status in ('active','used','revoked','expired')),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  testimonial_id uuid references public.kian_testimonials(id) on delete set null,
  issued_by     uuid references auth.users(id),
  issued_at     timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  revoke_reason text,
  constraint crm_ti_window check (expires_at > issued_at),
  constraint crm_ti_revoked_pair check (
    status <> 'revoked' or (revoked_at is not null and length(btrim(coalesce(revoke_reason,''))) >= 3)),
  -- دعوة واحدة نشطة لكلّ مشروع: تعدّدها يجعل الإلغاء بلا معنى.
  constraint crm_ti_used_pair check (status <> 'used' or used_at is not null)
);

create unique index if not exists crm_ti_one_active_per_project
  on public.crm_testimonial_invites (project_id) where status = 'active';

-- ─── §3 · RLS — deny by default ────────────────────────────────────────────
alter table public.crm_opportunity_tender  enable row level security;
alter table public.crm_testimonial_invites enable row level security;

drop policy if exists crm_tender_read on public.crm_opportunity_tender;
create policy crm_tender_read on public.crm_opportunity_tender
  for select to authenticated
  -- الرؤية تتبع الفرصة نفسها — لا مسار صلاحية ثانٍ.
  using (public.crm_can_read_opportunity(opportunity_id));

drop policy if exists crm_ti_read on public.crm_testimonial_invites;
create policy crm_ti_read on public.crm_testimonial_invites
  for select to authenticated using (public.crm_can_manage());

-- ⛔ لا سياسة كتابة: الكتابة عبر الدوالّ المحروسة وحدها. ولا شيء لـanon.
revoke all on public.crm_opportunity_tender  from anon, public;
revoke all on public.crm_testimonial_invites from anon, public;

-- ─── §4 · V2-4.4-A · صحّة العميل — **عرض مشتقّ لا جدول** ───────────────────
--
-- 🔴 كلّ عمود هنا يُحسب عند القراءة. ولا مؤشّر ماليّ: الربحية تحتاج تكلفة
-- مؤكّدة، وحسابها من بيانات ناقصة يُنتج رقمًا يُبنى عليه تسعير.
-- (مسجَّل قرارًا: W4-1 · FINANCIAL SOURCE-OF-TRUTH DECISION.)
create or replace view public.crm_client_health_v as
select
  c.id                                as company_id,
  c.name                              as company_name,
  -- آخر نشاط مسجَّل — من `crm_activities` القائم، لا عدّاد مخزَّن.
  (select max(a.occurred_at) from public.crm_activities a where a.company_id = c.id)
                                      as last_activity_at,
  (select count(*) from public.crm_opportunities o
    where o.company_id = c.id and o.status = 'open')      as open_opportunities,
  (select count(*) from public.crm_opportunities o
    where o.company_id = c.id and o.status = 'won')       as won_opportunities,
  (select count(*) from public.crm_opportunities o
    where o.company_id = c.id and o.status = 'lost')      as lost_opportunities,
  -- 🔴 الصمت بالأيام — مشتقّ، فلا يتقادم أبدًا.
  (select (current_date - max(a.occurred_at)::date)
     from public.crm_activities a where a.company_id = c.id) as days_silent
from public.crm_companies c
where coalesce(c.is_deleted, false) = false;

comment on view public.crm_client_health_v is
  'V2-4.4-A — مشتقّ بالكامل. ⛔ لا جدول: درجة صحّة مخزَّنة تتعفّن لحظة تسجيل '
  'نشاط جديد. ⛔ ولا مؤشّر ماليّ — قرار W4-1.';

-- ─── §5 · التقارير — على محرّك CRM القائم، وبحماية الهامش ──────────────────

-- V2-4.1-C · نسبة الفوز والقيمة ومتوسط الهامش.
create or replace function public.crm_win_rate_report(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date; v_fin boolean; v_out jsonb;
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_from := coalesce(nullif(p_filters->>'from','')::date, current_date - 365);
  v_to   := coalesce(nullif(p_filters->>'to','')::date,   current_date);

  -- 🔴 حماية الهامش: بوّابة مستقلّة عن صلاحية CRM. مدير مبيعات يرى نسبة الفوز
  -- ولا يرى الهامش إلّا إن كان مخوَّلًا ماليًّا. وغيابها ⇒ الإخفاء لا الكشف.
  v_fin := coalesce(
    (select public.can_see_financials()
       from (select 1) s
      where to_regproc('public.can_see_financials()') is not null),
    false);

  select jsonb_build_object(
    'ok', true,
    'from', v_from, 'to', v_to,
    'total',  count(*),
    'won',    count(*) filter (where status = 'won'),
    'lost',   count(*) filter (where status = 'lost'),
    'open',   count(*) filter (where status = 'open'),
    -- نسبة الفوز على المحسوم فقط: إدخال المفتوحة في المقام يُنتج رقمًا يتحسّن
    -- كلّما أُهملت الصفقات، وهو عكس المقصود.
    'win_rate_pct', case
      when count(*) filter (where status in ('won','lost')) = 0 then null
      else round(100.0 * count(*) filter (where status = 'won')
                 / count(*) filter (where status in ('won','lost')), 1) end,
    'won_value',   coalesce(sum(estimated_value) filter (where status = 'won'), 0),
    'total_value', coalesce(sum(estimated_value), 0),
    -- الهامش محجوب ما لم يُخوَّل، ويُعلَن أنّه محجوب لا أنّه صفر.
    'margin_visible', v_fin,
    'avg_margin_pct', null
  ) into v_out
  from public.crm_opportunities
  where created_at::date between v_from and v_to;

  return v_out;
end $$;

-- V2-4.5-A · لوحة موسمية: أيام التصوير × الشهر × السنة.
create or replace function public.crm_seasonality_report(p_years int default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_years int;
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- الجدول قد لا يكون مطبَّقًا ⇒ يُعلَن التعطيل ولا يُخترع صفر.
  if to_regclass('public.project_shoot_sessions') is null then
    return jsonb_build_object('ok', true, 'unavailable', true, 'reason', 'shoot_sessions_missing');
  end if;
  v_years := least(greatest(coalesce(p_years, 3), 1), 10);

  select coalesce(jsonb_agg(x order by x->>'year', x->>'month'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'year',  extract(year  from s.session_date)::int,
      'month', extract(month from s.session_date)::int,
      'shoot_days', count(*)
    ) as x
    from public.project_shoot_sessions s
    where s.session_date is not null
      and coalesce(s.is_deleted, false) = false
      and s.session_date >= (current_date - (v_years || ' years')::interval)
    group by 1, 2
  ) t;
  return jsonb_build_object('ok', true, 'years', v_years, 'rows', v_rows);
end $$;

-- V2-4.4-C · «صامت أكثر من ١٨٠ يومًا → متابعة مقترحة».
-- 🔒 **اقتراح فقط.** لا يُنشئ نشاطًا ولا يُرسل شيئًا ولا يكتب صفًّا.
create or replace function public.crm_silent_clients(p_days int default 180)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int; v_rows jsonb;
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_days := least(greatest(coalesce(p_days, 180), 30), 3650);
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', h.company_id, 'company_name', h.company_name,
           'days_silent', h.days_silent, 'last_activity_at', h.last_activity_at,
           'open_opportunities', h.open_opportunities
         ) order by h.days_silent desc nulls last), '[]'::jsonb) into v_rows
  from public.crm_client_health_v h
  where h.days_silent is not null and h.days_silent >= v_days;
  -- ⛔ `suggested` صراحةً: هذه قائمة يقرؤها إنسان، لا طابور تنفيذ.
  return jsonb_build_object('ok', true, 'threshold_days', v_days,
                            'suggested', v_rows, 'auto_sent', false);
end $$;

-- ─── §6 · V2-4.3-A · الملخص الأسبوعي — يُبنى ولا يُرسَل من هنا ─────────────
--
-- ⛔ لا مجدول رابع: يُطوى النداء داخل `/api/cron/notify-email` القائم.
-- ⛔ ولا إرسال من القاعدة: تُعيد الدالّة نصًّا، والمسار القائم هو من يُرسل.
create or replace function public.crm_weekly_digest(p_week_start date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_start date; v_end date;
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- 🔴 بداية الأسبوع مثبَّتة على الاثنين بتوقيت الرياض. الاعتماد على منطقة
  -- الخادم يجعل تشغيلين في يومين متجاورين يُنتجان أسبوعين مختلفين.
  v_start := coalesce(p_week_start,
    (date_trunc('week', (now() at time zone 'Asia/Riyadh')) - interval '7 days')::date);
  v_end := v_start + 7;

  return jsonb_build_object(
    'ok', true,
    -- 🔑 مفتاح المدة هو ضابط منع التكرار: المستدعي يستعمله مفتاحَ تفرّد،
    --    فتشغيل الكرون مرّتين في الأسبوع نفسه لا يُنتج ملخّصين.
    'digest_key', 'crm_weekly:' || to_char(v_start, 'IYYY-IW'),
    'week_start', v_start, 'week_end', v_end,
    'opportunities_created', (select count(*) from public.crm_opportunities
                               where created_at >= v_start and created_at < v_end),
    'opportunities_won',     (select count(*) from public.crm_opportunities
                               where won_at is not null and won_at >= v_start and won_at < v_end),
    'opportunities_lost',    (select count(*) from public.crm_opportunities
                               where lost_at is not null and lost_at >= v_start and lost_at < v_end),
    'activities_logged',     (select count(*) from public.crm_activities
                               where occurred_at >= v_start and occurred_at < v_end),
    'silent_clients',        (select count(*) from public.crm_client_health_v
                               where days_silent >= 180)
  );
end $$;

-- ─── §7 · دوالّ المناقصة والدعوة ───────────────────────────────────────────
create or replace function public.crm_tender_upsert(p_opportunity uuid, p_payload jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
begin
  -- الصلاحية تتبع الفرصة — لا بوّابة ثانية.
  if not public.crm_can_edit_opportunity(p_opportunity) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.crm_opportunity_tender as t
    (opportunity_id, tender_reference, portal_reference, portal_name, announced_at,
     questions_due, submission_due, opening_at, award_expected, bid_bond_required,
     bid_bond_amount, bid_bond_expires_at, performance_bond_pct, submission_status,
     submitted_at, note, created_by)
  values
    (p_opportunity, nullif(p_payload->>'tender_reference',''), nullif(p_payload->>'portal_reference',''),
     nullif(p_payload->>'portal_name',''), nullif(p_payload->>'announced_at','')::date,
     nullif(p_payload->>'questions_due','')::date, nullif(p_payload->>'submission_due','')::timestamptz,
     nullif(p_payload->>'opening_at','')::timestamptz, nullif(p_payload->>'award_expected','')::date,
     coalesce((p_payload->>'bid_bond_required')::boolean, false),
     nullif(p_payload->>'bid_bond_amount','')::numeric, nullif(p_payload->>'bid_bond_expires_at','')::date,
     nullif(p_payload->>'performance_bond_pct','')::numeric,
     coalesce(nullif(p_payload->>'submission_status',''), 'not_submitted'),
     nullif(p_payload->>'submitted_at','')::timestamptz, nullif(p_payload->>'note',''), auth.uid())
  on conflict (opportunity_id) do update set
    tender_reference = coalesce(nullif(excluded.tender_reference,''), t.tender_reference),
    portal_reference = coalesce(nullif(excluded.portal_reference,''), t.portal_reference),
    portal_name      = coalesce(nullif(excluded.portal_name,''), t.portal_name),
    announced_at     = coalesce(excluded.announced_at, t.announced_at),
    questions_due    = coalesce(excluded.questions_due, t.questions_due),
    submission_due   = coalesce(excluded.submission_due, t.submission_due),
    opening_at       = coalesce(excluded.opening_at, t.opening_at),
    award_expected   = coalesce(excluded.award_expected, t.award_expected),
    bid_bond_required = excluded.bid_bond_required,
    bid_bond_amount  = coalesce(excluded.bid_bond_amount, t.bid_bond_amount),
    bid_bond_expires_at = coalesce(excluded.bid_bond_expires_at, t.bid_bond_expires_at),
    performance_bond_pct = coalesce(excluded.performance_bond_pct, t.performance_bond_pct),
    submission_status = excluded.submission_status,
    submitted_at     = coalesce(excluded.submitted_at, t.submitted_at),
    note             = coalesce(nullif(excluded.note,''), t.note),
    updated_at       = now();
  return p_opportunity;
end $$;

-- إصدار دعوة شهادة. 🔴 الشرطان معًا: المشروع مُغلق **و** لا مستحقّ متبقٍّ.
create or replace function public.crm_testimonial_invite_issue(p_project uuid, p_days int default 30)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_raw text; v_hash text; v_id uuid; v_days int; v_closed boolean := false; v_paid boolean := false;
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_days := least(greatest(coalesce(p_days, 30), 1), 180);

  -- 🔴 الشرطان معًا — لكن **بقراءة واحدة**، لا اثنتين.
  --
  -- الصياغة الأولى هنا كانت تجمع مبالغ `fin_payment_milestones` مقابل
  -- `fin_collections` لتستنتج السداد. وكنس الحوكمة المالية رصدها فورًا بوصفها
  -- **بابًا جانبيًّا جديدًا إلى المالية**: دالّة `security definer` تتجاوز RLS
  -- المالية وتقرأ طرفَي الطرح. وهو محقّ.
  --
  -- والصواب أنّ تلك القراءة **زائدة أصلًا**: محرّك الإغلاق نفسه يفحص الإخلاء
  -- المالي (`closure.view_financial_clearance`، ومانع `financial_unavailable`
  -- الذي يحتاج تجاوزًا رسميًّا). فمشروع بحالة `closed` قد مرّ على ذلك الفحص
  -- بالفعل. إعادة اشتقاق السداد هنا كانت ستُنشئ **مصدر حقيقة ماليًّا ثانيًا**
  -- برأي قد يخالف رأي محرّك الإغلاق.
  --
  -- ⛔ فلا `fin_*` في هذه الدالّة. الإغلاق يشمل السداد، والحقّ في إصدار دعوة
  --    شهادة لا يستلزم صلاحية مالية.
  if to_regclass('public.project_closure_requests') is not null then
    select exists (select 1 from public.project_closure_requests r
                    where r.project_id = p_project and r.status = 'closed')
      into v_closed;
  end if;
  -- الإخلاء المالي مُستوفًى ضمنًا بالإغلاق — يُعلَن ولا يُعاد حسابه.
  v_paid := v_closed;

  if not v_closed then
    return jsonb_build_object('ok', false, 'reason', 'trigger_conditions_not_met',
                              'closed', v_closed, 'settled', v_paid,
                              'note', 'closure already covers financial clearance');
  end if;

  -- دعوة نشطة قائمة تُلغى أوّلًا — فهرس فريد يفرض واحدة فقط.
  update public.crm_testimonial_invites
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'superseded by a new invite'
   where project_id = p_project and status = 'active';

  v_raw  := encode(public.gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');

  insert into public.crm_testimonial_invites
    (project_id, token_hash, token_hint, expires_at, issued_by)
  values (p_project, v_hash, right(v_raw, 6), now() + make_interval(days => v_days), auth.uid())
  returning id into v_id;

  -- ⚠️ الرمز يظهر مرّة واحدة. ⛔ ولا إرسال من هنا: الإنسان يقرّر.
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_raw,
                            'hint', right(v_raw, 6), 'expires_in_days', v_days,
                            'auto_sent', false);
end $$;

create or replace function public.crm_testimonial_invite_revoke(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.crm_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'reason_required'; end if;
  update public.crm_testimonial_invites
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   where id = p_id and status = 'active';
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 🔴 التحقّق العامّ من الرمز — الدالّة الوحيدة الممنوحة لـanon في هذه الحزمة.
-- نفس عقد حزمة رموز التقويم: رفض NULL/الطول/الشكل **قبل** أيّ SELECT، مطابقة
-- تامّة على البصمة، وردّ واحد لكلّ رفض فلا يُكشف وجود مشروع من اختلاف الرسائل.
create or replace function public.crm_testimonial_invite_check(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if p_token_hash is null
     or length(p_token_hash) <> 64
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;
  select * into r from public.crm_testimonial_invites where token_hash = p_token_hash;
  -- ⛔ ردّ واحد: غير موجود · ملغى · مستعمل · منتهٍ — كلّها `{ok:false}` بلا سبب.
  if r.id is null or r.status <> 'active' or r.expires_at <= now() then
    return jsonb_build_object('ok', false);
  end if;
  -- ⛔ ولا يُعاد project_id: الرمز يُثبت الحقّ ولا يكشف ما وراءه.
  return jsonb_build_object('ok', true);
end $$;

-- ─── §8 · الصلاحيات — REVOKE أوّلًا ثمّ منح محدَّد ─────────────────────────
revoke all on function public.crm_tender_upsert(uuid,jsonb) from public, anon;
grant execute on function public.crm_tender_upsert(uuid,jsonb) to authenticated;
revoke all on function public.crm_win_rate_report(jsonb) from public, anon;
grant execute on function public.crm_win_rate_report(jsonb) to authenticated;
revoke all on function public.crm_seasonality_report(int) from public, anon;
grant execute on function public.crm_seasonality_report(int) to authenticated;
revoke all on function public.crm_silent_clients(int) from public, anon;
grant execute on function public.crm_silent_clients(int) to authenticated;
revoke all on function public.crm_testimonial_invite_issue(uuid,int) from public, anon;
grant execute on function public.crm_testimonial_invite_issue(uuid,int) to authenticated;
revoke all on function public.crm_testimonial_invite_revoke(uuid,text) from public, anon;
grant execute on function public.crm_testimonial_invite_revoke(uuid,text) to authenticated;

-- الملخّص الأسبوعي لمفتاح الخدمة وحده — يستدعيه الكرون، ولا مستخدم يُطلقه.
revoke all on function public.crm_weekly_digest(date) from public, anon;
grant execute on function public.crm_weekly_digest(date) to authenticated, service_role;

-- 🔴 الوحيدة الممنوحة لـanon: التحقّق من رمز الدعوة. حارسها داخلها.
revoke all on function public.crm_testimonial_invite_check(text) from public;
grant execute on function public.crm_testimonial_invite_check(text) to anon, authenticated;

-- العرض المشتقّ: قراءة للمخوَّلين فقط، ولا شيء لـanon.
revoke all on public.crm_client_health_v from anon, public;
grant select on public.crm_client_health_v to authenticated;

commit;

notify pgrst, 'reload schema';
