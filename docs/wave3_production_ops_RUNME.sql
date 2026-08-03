-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · RUNME — توسعة تشغيل الإنتاج القائم. **إضافية بالكامل.**
--
-- MASTER_BRIEF_v2.1.md §4 WAVE 3 · V2-3.1-E · V2-3.1-F · V2-3.1-H
--
-- ★ لماذا `ops_*` وليس `project_*` ★
-- شرط الدخول محسوم في docs/wave-reports/WAVE_3_ENTRY_DUPLICATION_RESOLUTION.md:
-- المصدر المعتمد لأوراق النداء هو `ops_call_sheets`، وللمواقع `ops_locations`.
-- ⛔ لا جدول أوراق نداء ثالث · لا جدول مواقع رابع · لا عائلة دوال ثالثة.
--
-- ★ ما لا تفعله هذه الحزمة ★
-- • لا تُنشئ جدول طقس — `ops_job_weather` قائم، **يُعبَّأ لا يُنشأ**.
-- • لا تلمس `project_call_sheets` ولا `project_locations` (مُجمَّدان، قرار W3-1).
-- • لا تُنشئ مجدولًا (G8) ولا تكاملًا جديدًا (G7).
-- • لا تخزّن الساعة الذهبية: مشتقّة من (خط العرض/الطول + التاريخ) وتُحسب عند
--   العرض في lib/production/solar.ts. تخزين المشتقّ يخلق مصدر حقيقة ثانيًا
--   يتعفّن حين يتغيّر الموقع.
--
-- إعادة التشغيل آمنة (idempotent).
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── §0 · حرس مسبق: لا تعمل على قاعدة ناقصة ────────────────────────────────
do $$
begin
  if to_regclass('public.ops_call_sheets') is null then
    raise exception '🔴 ops_call_sheets مفقود — شغّل operations_center_RUNME.sql أولًا';
  end if;
  if to_regclass('public.ops_job_weather') is null then
    raise exception '🔴 ops_job_weather مفقود — شغّل operations_center_RUNME.sql أولًا';
  end if;
end $$;

-- ─── §1 · V2-3.1-H · التاريخ البديل ────────────────────────────────────────
-- يوم تصوير خارجيّ يحتاج بديلًا معلنًا قبل أن يُلغى، لا بعده.
alter table public.ops_call_sheets
  add column if not exists backup_date date;

-- ─── §2 · V2-3.1-F · هل اليوم يوم تصوير جوّي؟ ──────────────────────────────
-- 🔴 صريح لا مُستنتَج. لافتة رياح على يوم بلا درون ضجيج، والضجيج على سطر سلامة
-- يُعلّم الطاقم تخطّيه — فيُفقد أثره يوم يهمّ فعلًا.
alter table public.ops_call_sheets
  add column if not exists is_drone_day boolean not null default false;

comment on column public.ops_call_sheets.is_drone_day is
  'يفعّل لافتة تحذير الرياح (V2-3.1-F). لا تُستنتَج من المعدّات: وجود درون في '
  'القائمة لا يعني طيرانًا في هذا اليوم.';

-- التاريخ البديل يجب أن يكون بعد تاريخ الورقة، لا قبله.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ops_call_sheets_backup_after_sheet'
  ) then
    alter table public.ops_call_sheets
      add constraint ops_call_sheets_backup_after_sheet
      check (backup_date is null or backup_date > sheet_date) not valid;
    -- `not valid`: يُطبَّق على الجديد فورًا ولا يُسقط صفًّا قائمًا مخالفًا.
  end if;
end $$;

-- ─── §3 · V2-3.1-E · تعبئة الطقس من Open-Meteo ─────────────────────────────
alter table public.ops_job_weather
  add column if not exists wind_gust_kph numeric,
  add column if not exists fetched_at    timestamptz,
  add column if not exists for_lat       double precision,
  add column if not exists for_lng       double precision;

comment on column public.ops_job_weather.wind_gust_kph is
  'الهبّات — وهي أساس تقييم الرياح لا المتوسّط (lib/production/weather.ts).';
comment on column public.ops_job_weather.fetched_at is
  'متى جُلب هذا التوقّع. توقّع عمره ثلاثة أيام ليس توقّعًا — الواجهة تُخفيه.';

-- 🔴 توسيع `source` ليقبل 'open_meteo'. القيد يُستبدَل لا يُسقط بلا بديل:
-- بين DROP وADD في معاملة واحدة، فلا نافذة يُقبَل فيها أيّ نصّ.
do $$
declare v_con text;
begin
  select con.conname into v_con
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'ops_job_weather'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%source%';

  if v_con is not null then
    execute format('alter table public.ops_job_weather drop constraint %I', v_con);
  end if;

  alter table public.ops_job_weather
    add constraint ops_job_weather_source_check
    check (source in ('manual','placeholder','open_meteo'));
end $$;

-- فهرس للبحث عن آخر توقّع لكل مهمّة/تاريخ — الاستعلام الوحيد الذي ستفعله الواجهة.
create index if not exists ops_job_weather_job_date_idx
  on public.ops_job_weather (job_id, for_date desc)
  where is_deleted = false;

-- ─── §4 · دالّة التسجيل — RPC واحدة، بالبادئة المعتمدة `prodops_` ──────────
-- ⛔ لا عائلة دوال ثالثة (D-2). ولا `pg_net`: الجلب يتمّ في Next خادميًّا ثم
--    يُمرَّر هنا، فالقاعدة لا تخرج إلى الشبكة إطلاقًا.
create or replace function public.prodops_weather_record(
  p_job_id     uuid,
  p_for_date   date,
  p_condition  text,
  p_temp_c     numeric,
  p_wind_kph   numeric,
  p_gust_kph   numeric,
  p_precip_pct numeric,
  p_lat        double precision default null,
  p_lng        double precision default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.prodops_can_manage() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_for_date is null or p_job_id is null then
    raise exception 'job_and_date_required';
  end if;
  -- 🔴 الأفق ٤٨ ساعة مفروض هنا أيضًا، لا في الواجهة وحدها. حدٌّ يعيش في مكان
  -- واحد يُلتفّ عليه بأوّل مستدعٍ جديد.
  if p_for_date > (current_date + 2) then
    raise exception 'beyond_forecast_horizon';
  end if;

  update public.ops_job_weather
     set condition = p_condition, temp_c = p_temp_c, wind_kph = p_wind_kph,
         wind_gust_kph = p_gust_kph, precip_pct = p_precip_pct,
         source = 'open_meteo', fetched_at = now(),
         for_lat = coalesce(p_lat, for_lat), for_lng = coalesce(p_lng, for_lng),
         entered_by = auth.uid(), entered_at = now()
   where job_id = p_job_id and for_date = p_for_date and is_deleted = false
   returning id into v_id;

  if v_id is null then
    insert into public.ops_job_weather
      (job_id, for_date, source, condition, temp_c, wind_kph, wind_gust_kph,
       precip_pct, for_lat, for_lng, entered_by, fetched_at)
    values
      (p_job_id, p_for_date, 'open_meteo', p_condition, p_temp_c, p_wind_kph,
       p_gust_kph, p_precip_pct, p_lat, p_lng, auth.uid(), now())
    returning id into v_id;
  end if;

  return v_id;
end $$;

-- ⛔ الصلاحية للمستخدم المُصادَق فقط — والدالّة نفسها تفرض prodops_can_manage.
revoke all on function public.prodops_weather_record(uuid,date,text,numeric,numeric,numeric,numeric,double precision,double precision) from public, anon;
grant execute on function public.prodops_weather_record(uuid,date,text,numeric,numeric,numeric,numeric,double precision,double precision) to authenticated;

commit;
