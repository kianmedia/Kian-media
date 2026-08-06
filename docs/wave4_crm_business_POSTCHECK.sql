-- WAVE 4 · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدولان + RLS' as check,
       case when count(*) filter (where c.relrowsecurity)=2 then '✅ 2/2' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('crm_opportunity_tender','crm_testimonial_invites');

-- 🔴 صحّة العميل **عرض** لا جدول. وجودها كجدول يعني درجة مخزَّنة تتقادم.
select 'صحّة العميل عرض لا جدول' as check,
       case when (select count(*) from pg_views where schemaname='public' and viewname='crm_client_health_v')=1
             and (select count(*) from pg_tables where schemaname='public' and tablename like 'crm_client_health%')=0
            then '✅ عرض مشتقّ' else '🔴 مخزَّن — يتقادم' end as result;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 مطابقة **الاسم + قائمة الأنواع** — لا الاسم وحده
--
-- عدّ الأسماء يقبل أيّ overload بأيّ توقيع، فيُبلّغ 8/8 ودالّة الحزمة غائبة
-- وأخرى بنفس الاسم من حزمة ثانية حاضرة.
-- ⚠️ ويُستعمل `oidvectortypes(proargtypes)` لا `pg_get_function_identity_arguments`:
--    الثانية تُعيد **أسماء الوسائط مع أنواعها** (`p_filters jsonb`)، فلا تطابق
--    قائمة أنواع أبدًا — وهو العيب نفسه الذي صنّف دوالّ permits_media «مفقودة».
-- ⚠️ ودالّة بلا وسائط توقيعها **سلسلة فارغة** لا NULL.
-- ════════════════════════════════════════════════════════════════════════════
with pkg(fname, fargs) as (
  values
    ('crm_tender_upsert',              'uuid, jsonb'),
    ('crm_win_rate_report',            'jsonb'),
    ('crm_seasonality_report',         'integer'),
    ('crm_silent_clients',             'integer'),
    ('crm_weekly_digest',              'date'),
    ('crm_testimonial_invite_issue',   'uuid, integer'),
    ('crm_testimonial_invite_revoke',  'uuid, text'),
    ('crm_testimonial_invite_check',   'text')
)
select 'الدوالّ الثماني بتواقيعها' as check,
       case when count(*) filter (where p.oid is not null) = 8 then '✅ 8/8'
            else '🔴 ' || count(*) filter (where p.oid is not null)::text || '/8 — مفقودة: '
                 || coalesce(string_agg(k.fname||'('||k.fargs||')', ', ')
                             filter (where p.oid is null), '') end as result
from pkg k
left join pg_proc p
       on p.proname = k.fname
      and p.pronamespace = 'public'::regnamespace
      and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs;

-- ⚠️ تشخيص التواقيع الفعلية — يُقرأ عند احمرار الفحص أعلاه.
select 'تشخيص التواقيع الفعلية' as check,
       p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('crm_tender_upsert','crm_win_rate_report','crm_seasonality_report',
                    'crm_silent_clients','crm_weekly_digest','crm_testimonial_invite_issue',
                    'crm_testimonial_invite_revoke','crm_testimonial_invite_check')
order by p.proname;

-- 🔴 anon يملك التحقّق من الرمز **وحده**.
select 'anon يملك crm_testimonial_invite_check فقط' as check,
       -- 🔴 `routine_name` نوعه `information_schema.sql_identifier` لا `text`،
       --    ومقارنة `sql_identifier[]` بـ`text[]` بلا مُعامل ⇒ يفشل الاستعلام
       --    **وقت التشغيل** داخل POSTCHECK، أي بعد التطبيق على قاعدة حيّة.
       case when array_agg(routine_name::text order by routine_name::text)
                 = array['crm_testimonial_invite_check']::text[]
            then '✅' else '🔴 '||array_to_string(
                 array_agg(routine_name::text order by routine_name::text), ', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text='anon' and routine_name like 'crm_%';

select 'لا صلاحية جدول لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public'
  and table_name::text in ('crm_opportunity_tender','crm_testimonial_invites','crm_client_health_v')
  and grantee::text in ('anon','PUBLIC');

select 'دعوة نشطة واحدة لكل مشروع' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — الإلغاء بلا معنى' end as result
from pg_indexes where schemaname='public' and indexname='crm_ti_one_active_per_project';

-- ⛔ والجدولان يُنشآن فارغين: لا بيانات أعمال مخترعة.
select 'الجدولان فارغان' as check,
       case when (select count(*) from public.crm_opportunity_tender)=0
             and (select count(*) from public.crm_testimonial_invites)=0
            then '✅' else '🟡 فيهما صفوف — تحقّق من مصدرها' end as result;

-- ─── قيد الشهادات الشرطيّ — الحالتان صحيحتان ───────────────────────────────
select 'قيد الشهادات متّسق مع وجود جدولها' as check,
       case
         when to_regclass('public.kian_testimonials') is null
              and not exists (select 1 from pg_constraint
                               where conrelid='public.crm_testimonial_invites'::regclass
                                 and conname='crm_ti_testimonial_fk')
           then '✅ الشهادات غير مطبَّقة ولا قيد — متّسق'
         when to_regclass('public.kian_testimonials') is not null
              and exists (select 1 from pg_constraint
                           where conrelid='public.crm_testimonial_invites'::regclass
                             and conname='crm_ti_testimonial_fk')
           then '✅ الشهادات مطبَّقة والقيد مضاف — متّسق'
         else '🔴 غير متّسق — أعد تشغيل RUNME (idempotent)' end as result;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- طباعة 🔴 مع خروج بحالة 0 تجعل خطّ الإصدار يمضي فوق فشل دلاليّ **بعد** أن
-- طُبِّق التغيير على قاعدة حيّة. هذا البلوك يرمي استثناءً.
-- ⚠️ ونطاقه **حزمة Wave 4 وحدها**: لا يُفحص `prodops_%` ولا أيّ حزمة أخرى،
--    فلا يحمرّ بسبب دالّة لا يملكها (كما وقع في permits_media مع
--    `prodops_calendar_feed`).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_fail text[] := '{}';
  v_missing int;
  v_anon text[];
begin
  -- ١ · الجدولان + RLS
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname in ('crm_opportunity_tender','crm_testimonial_invites')
         and c.relrowsecurity) <> 2 then
    v_fail := v_fail || 'RLS غير مفعَّلة على جدولَي الحزمة';
  end if;

  -- ٢ · الدوالّ الثماني بتواقيعها الدقيقة
  select count(*) into v_missing
  from (values
    ('crm_tender_upsert','uuid, jsonb'),('crm_win_rate_report','jsonb'),
    ('crm_seasonality_report','integer'),('crm_silent_clients','integer'),
    ('crm_weekly_digest','date'),('crm_testimonial_invite_issue','uuid, integer'),
    ('crm_testimonial_invite_revoke','uuid, text'),('crm_testimonial_invite_check','text')
  ) k(fname,fargs)
  where not exists (
    select 1 from pg_proc p
     where p.proname = k.fname
       and p.pronamespace = 'public'::regnamespace
       and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs);
  if v_missing > 0 then
    v_fail := v_fail || (v_missing::text || ' دالّة مفقودة أو بتوقيع مختلف');
  end if;

  -- ٣ · 🔴 anon: دالّة التحقّق وحدها — والنطاق `crm_%` يخصّ هذه الحزمة
  select coalesce(array_agg(distinct routine_name::text order by routine_name::text), '{}')
    into v_anon
  from information_schema.role_routine_grants
  where routine_schema='public' and grantee::text='anon' and routine_name like 'crm\_%';
  if v_anon <> array['crm_testimonial_invite_check']::text[] then
    v_fail := v_fail || ('صلاحيات anon غير متوقَّعة: ' || array_to_string(v_anon, ', '));
  end if;

  -- ٤ · ⛔ لا صلاحية جدول لـanon/PUBLIC
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public'
         and table_name::text in ('crm_opportunity_tender','crm_testimonial_invites','crm_client_health_v')
         and grantee::text in ('anon','PUBLIC')) > 0 then
    v_fail := v_fail || 'صلاحية جدول مسرَّبة لـanon/PUBLIC';
  end if;

  -- ٥ · قيد الشهادات متّسق مع وجود جدولها
  if (to_regclass('public.kian_testimonials') is not null)
     <> exists (select 1 from pg_constraint
                 where conrelid='public.crm_testimonial_invites'::regclass
                   and conname='crm_ti_testimonial_fk') then
    v_fail := v_fail || 'قيد الشهادات غير متّسق مع وجود جدولها';
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 4 POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 4 POSTCHECK PASSED.';
end $$;
