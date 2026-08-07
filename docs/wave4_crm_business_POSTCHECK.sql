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
-- ⚠️ ويبقى المسح على `crm_%` هنا **عن قصد**: الفحص يشترط أن تكون القائمة
--    الناتجة **مساوية تمامًا** لـ`['crm_testimonial_invite_check']` — أي أنّه
--    يُثبت المنحة المقصودة إيجابًا ويرفض أيّ منحة أخرى في آن. وحصرُ النطاق هنا
--    كان سيُفرغه من معناه: القائمة تصير فارغة فتخالف المتوقَّع دائمًا.
-- ⛔ والفرق عن فحص Foundation: ذاك يمسح فضاء أسماء **لا يملكه**، وهذا يفحص
--    عقد حزمته هو، ويسمّي الاستثناء المقصود صراحةً بدل أن يُخفيه.
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

-- ─── `crm_client_health_v` — الإسناد عبر الآباء لا عبر عمود غير موجود ──────
select 'الـview أُنشئت' as check,
       case when to_regclass('public.crm_client_health_v') is null
            then '🔴 مفقودة — تحقّق من تراجع المعاملة'
            else '✅ موجودة' end as result;

-- 🔴 لا مرجع لـ`crm_activities.company_id` في تعريف الـview.
select 'الـview لا تشير إلى crm_activities.company_id' as check,
       case when pg_get_viewdef('public.crm_client_health_v'::regclass, true)
                 ~* '\ma\.company_id\M'
            then '🔴 عاد الافتراض الخاطئ'
            else '✅ الإسناد عبر lead/opportunity/contact' end as result
where to_regclass('public.crm_client_health_v') is not null;

-- المسارات الثلاثة كلّها مذكورة في التعريف.
select 'مسارات الإسناد الثلاثة' as check,
       case when v.def ~* 'opportunity_id' and v.def ~* 'lead_id' and v.def ~* 'contact_id'
            then '✅ opportunity + lead + contact'
            else '🔴 مسار إسناد مفقود' end as result
from (select pg_get_viewdef('public.crm_client_health_v'::regclass, true) as def) v
where to_regclass('public.crm_client_health_v') is not null;

-- ⚠️ التمييز يمنع مضاعفة النشاط الواحد، والالتباس يُستبعد بطول المصفوفة.
select 'منع التكرار ورفض الالتباس' as check,
       case when v.def ~* 'array_agg\s*\(\s*distinct' and v.def ~* 'array_length'
            then '✅ تمييز + شرط مرشّح واحد'
            else '🔴 قد يُضاعَف النشاط أو يُنسَب الملتبس' end as result
from (select pg_get_viewdef('public.crm_client_health_v'::regclass, true) as def) v
where to_regclass('public.crm_client_health_v') is not null;

-- 🔴 والاختبار الحاسم: **تنفيذ** SELECT فعليًّا. تعريفٌ سليم لا يعني استعلامًا
--    ناجحًا (عمود مفقود يظهر وقت التنفيذ لا وقت الإنشاء في بعض الحالات).
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 ACL كائنات Wave 4 — **صلاحيات فعليّة** لا معلَنة
--
-- ★ ما كشفه تشخيص Preview ★
--     crm_opportunity_tender   authenticated = Dxtm
--     crm_testimonial_invites  authenticated = Dxtm
--     crm_client_health_v      authenticated = rDxtm
--   موروثة من ACL المشروع الافتراضيّ، ⛔ ولم تسحبها Wave 4 (سحبت من
--   `anon, public` فقط). و`information_schema.role_table_grants` وحده لا
--   يكفي: لا يرى الموروث عن PUBLIC ولا ACL الأعمدة.
--
-- ★ العقد ★ anon: لا شيء · PUBLIC: لا شيء ·
--   authenticated: SELECT على الجدولين، **ولا شيء** على العرض المشتقّ.
-- ⚠️ و`MAINTAIN` لم توجد قبل PostgreSQL 17: تُضاف بالإصدار لا بالتمنّي،
--    و`array_append` لا `|| 'MAINTAIN'` (الأخيرة تُفسَّر حرفيّة مصفوفة).
-- ════════════════════════════════════════════════════════════════════════════
do $acl$
declare
  v_rel text; v_p text; v_privs text[]; v_bad text[] := '{}';
  v_readable text[] := array['crm_opportunity_tender','crm_testimonial_invites'];
begin
  v_privs := array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := array_append(v_privs, 'MAINTAIN');
  end if;

  foreach v_rel in array array['crm_opportunity_tender','crm_testimonial_invites','crm_client_health_v']
  loop
    if to_regclass('public.'||v_rel) is null then
      v_bad := array_append(v_bad, v_rel||': الكائن مفقود'); continue;
    end if;
    foreach v_p in array v_privs loop
      -- anon: لا شيء إطلاقًا.
      if to_regrole('anon') is not null and has_table_privilege('anon','public.'||v_rel, v_p) then
        v_bad := array_append(v_bad, format('anon يملك %s على %s', v_p, v_rel));
      end if;
      -- authenticated: SELECT على الجدولين وحدهما، ولا شيء على العرض.
      if to_regrole('authenticated') is not null then
        if v_p = 'SELECT' and v_rel = any(v_readable) then
          if not has_table_privilege('authenticated','public.'||v_rel, v_p) then
            v_bad := array_append(v_bad,
              format('authenticated لا يقرأ %s — سياسة القراءة ميتة بلا منحة', v_rel));
          end if;
        elsif has_table_privilege('authenticated','public.'||v_rel, v_p) then
          v_bad := array_append(v_bad, format('authenticated يملك %s على %s', v_p, v_rel));
        end if;
      end if;
    end loop;

    -- PUBLIC من الكتالوج: ليس دورًا فلا تقبله دوالّ الصلاحيات.
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
                 lateral aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
                where n.nspname='public' and c.relname=v_rel and a.grantee = 0) then
      v_bad := array_append(v_bad, format('PUBLIC يملك صلاحية مباشرة على %s', v_rel));
    end if;

    -- ACL الأعمدة: غير مرئيّ لأيّ فحص جدوليّ.
    if to_regrole('anon') is not null
       and has_any_column_privilege('anon','public.'||v_rel,'SELECT,INSERT,UPDATE,REFERENCES') then
      v_bad := array_append(v_bad, format('anon يملك صلاحية على عمود في %s', v_rel));
    end if;
    if to_regrole('authenticated') is not null
       and has_any_column_privilege('authenticated','public.'||v_rel,'INSERT,UPDATE,REFERENCES') then
      v_bad := array_append(v_bad, format('authenticated يملك كتابة على عمود في %s', v_rel));
    end if;
  end loop;

  -- 🔴 والعقد المقصود لـanon: EXECUTE على فحص رمز الدعوة **وحده**، بلا وصول جدوليّ.
  if to_regrole('anon') is not null then
    if not has_function_privilege('anon','public.crm_testimonial_invite_check(text)','EXECUTE') then
      v_bad := array_append(v_bad, 'anon فقد EXECUTE على crm_testimonial_invite_check(text) — عقد مقصود');
    end if;
    foreach v_p in array array['crm_tender_upsert(uuid,jsonb)','crm_win_rate_report(jsonb)',
                               'crm_seasonality_report(integer)','crm_silent_clients(integer)',
                               'crm_weekly_digest(date)','crm_testimonial_invite_issue(uuid,integer)',
                               'crm_testimonial_invite_revoke(uuid,text)']
    loop
      if to_regprocedure('public.'||v_p) is not null
         and has_function_privilege('anon','public.'||v_p,'EXECUTE') then
        v_bad := array_append(v_bad, 'anon ينفّذ '||v_p);
      end if;
    end loop;
  end if;

  if array_length(v_bad,1) > 0 then
    raise exception E'🔴 ACL كائنات Wave 4 غير مطابق للعقد:\n  %', array_to_string(v_bad, E'\n  ');
  end if;
  raise notice '✅ ACL Wave 4: anon=لا شيء · PUBLIC=لا شيء · authenticated=SELECT على الجدولين فقط.';
end $acl$;

-- عرضٌ قرائيّ للـACL كما هو — بجانب النتيجة أعلاه.
select 'ACL كما هو' as check,
       c.relname::text||': '||coalesce(array_to_string(c.relacl,' · '),'(بلا ACL صريح)') as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('crm_opportunity_tender','crm_testimonial_invites','crm_client_health_v');

do $$
declare v_n bigint;
begin
  if to_regclass('public.crm_client_health_v') is null then
    raise exception '🔴 crm_client_health_v غير موجودة';
  end if;
  select count(*) into v_n from public.crm_client_health_v;
  raise notice '✅ SELECT من الـview نجح — % صفًّا.', v_n;
  -- ⚠️ صفر صفوف حالة صحيحة (لا شركات بعد)، والفشل يقع لو رمى الاستعلام.
end $$;

-- عدد الصفوف = عدد الشركات غير المحذوفة، ⛔ لا مضاعفة.
select 'صفّ واحد لكل شركة — لا مضاعفة' as check,
       case when (select count(*) from public.crm_client_health_v)
                 = (select count(*) from public.crm_companies where coalesce(is_deleted,false)=false)
            then '✅ مطابق'
            else '🔴 عدد الصفوف ≠ عدد الشركات — النشاط يُضاعف الصفوف' end as result
where to_regclass('public.crm_client_health_v') is not null;

-- ⚠️ `days_silent` تكون NULL حين لا نشاط منسوب — ⛔ لا صفرًا.
select 'الصمت NULL بلا نشاط لا صفر' as check,
       case when (select count(*) from public.crm_client_health_v
                   where last_activity_at is null and days_silent is not null) = 0
            then '✅' else '🔴 صمت رقميّ بلا نشاط — يجعل الخاملة تبدو نشطة' end as result
where to_regclass('public.crm_client_health_v') is not null;

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

  -- ٦ · الـview: موجودة · قابلة للتنفيذ · بلا افتراض crm_activities.company_id
  if to_regclass('public.crm_client_health_v') is null then
    v_fail := v_fail || 'crm_client_health_v مفقودة';
  else
    if pg_get_viewdef('public.crm_client_health_v'::regclass, true) ~* '\ma\.company_id\M' then
      v_fail := v_fail || 'الـview تشير إلى crm_activities.company_id (عمود غير موجود)';
    end if;
    declare v_probe bigint;
    begin
      select count(*) into v_probe from public.crm_client_health_v;
    exception when others then
      v_fail := v_fail || ('SELECT من crm_client_health_v فشل: ' || sqlerrm);
    end;
    if (select count(*) from public.crm_client_health_v)
       <> (select count(*) from public.crm_companies where coalesce(is_deleted,false)=false) then
      v_fail := v_fail || 'عدد صفوف الـview ≠ عدد الشركات — مضاعفة نشاط';
    end if;
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 4 POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 4 POSTCHECK PASSED.';
end $$;
