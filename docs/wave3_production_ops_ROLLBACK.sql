-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · ROLLBACK — يعيد الحالة إلى ما قبل RUNME.
--
-- ⚠️ إسقاط الأعمدة يُفقد ما كُتب فيها. القيمة الوحيدة القابلة للفقد هنا هي
-- توقّعات طقس مجلوبة وتواريخ بديلة — كلاهما قابل لإعادة الجلب/الإدخال. ومع ذلك
-- §1 يُعطّل بدل أن يحذف، وهو الافتراض الآمن؛ §2 للإزالة الكاملة عن قصد.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── §1 · التراجع المتحفّظ (المُوصى به) ────────────────────────────────────
-- تُزال الدالّة والقيد الموسَّع ويعود القيد الأصلي. الأعمدة تبقى ببياناتها.
drop function if exists public.prodops_weather_record(uuid,date,text,numeric,numeric,numeric,numeric,double precision,double precision);

do $$
begin
  -- إعادة القيد الأصلي تتطلّب ألّا يوجد صفّ بـ'open_meteo'، وإلّا فُقد الاتساق.
  if exists (select 1 from public.ops_job_weather where source = 'open_meteo') then
    raise notice '⚠️ توجد صفوف source=open_meteo — القيد يبقى موسَّعًا. احذفها أوّلًا إن أردت العودة التامّة.';
  else
    alter table public.ops_job_weather drop constraint if exists ops_job_weather_source_check;
    alter table public.ops_job_weather
      add constraint ops_job_weather_source_check
      check (source in ('manual','placeholder'));
  end if;
end $$;

drop index if exists public.ops_job_weather_job_date_idx;
alter table public.ops_call_sheets drop constraint if exists ops_call_sheets_backup_after_sheet;

commit;

-- ─── §2 · الإزالة التامّة — 🔴 تُفقد البيانات. أزل التعليق عن قصد فقط ──────
-- begin;
-- alter table public.ops_call_sheets drop column if exists backup_date;
-- alter table public.ops_call_sheets drop column if exists is_drone_day;
-- alter table public.ops_job_weather drop column if exists wind_gust_kph;
-- alter table public.ops_job_weather drop column if exists fetched_at;
-- alter table public.ops_job_weather drop column if exists for_lat;
-- alter table public.ops_job_weather drop column if exists for_lng;
-- commit;
