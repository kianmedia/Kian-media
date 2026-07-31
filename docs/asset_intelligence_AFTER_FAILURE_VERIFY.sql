-- ════════════════════════════════════════════════════════════════════════════
-- docs/asset_intelligence_AFTER_FAILURE_VERIFY.sql   (READ-ONLY · نتيجة واحدة)
--   آمن في محرّر Supabase مع auth.uid() = NULL · بلا نداء محميّ · بلا كتابة.
--
-- ★★ اقرأ هذا أوّلًا: خلافًا لكلّ سقطة سابقة في هذا البرنامج، هذه المرّة
--    **تُركت حالة جزئية على الإنتاج**. ★★
--
--   asset_intelligence_RUNME.sql ليس معاملة واحدة. فيه **عشر** معاملات
--   (عشرة begin;/commit;). وقع الفشل في السطر 1944 — داخل المعاملة العاشرة،
--   وهي كتلة الفحص الذاتيّ وحدها. فتراجعت العاشرة **وثبتت التسع قبلها**:
--
--     §١  begin   84 → commit  364   ✔ ثبتت — جدولان + ٨ دوالّ
--     §٢  begin  374 → commit  440   ✔ ثبتت — ٣ دوالّ (تحويل الحالة/الدرجة)
--     §٣  begin  450 → commit  656   ✔ ثبتت — ٧ دوالّ + حرّاس الإسناد
--     §٤  begin  671 → commit  891   ✔ ثبتت — ٦ دوالّ (الحجز والتعارض)
--     §٥  begin  902 → commit 1055   ✔ ثبتت — ٥ دوالّ (QR)
--     §٦  begin 1060 → commit 1236   ✔ ثبتت — ٦ دوالّ (العدّادات + حرّاس المنع)
--     §٧  begin 1244 → commit 1543   ✔ ثبتت — ٥ دوالّ (خطط الصيانة)
--     §٨  begin 1557 → commit 1690   ✔ ثبتت — دالّتا الاستغلال والتكلفة
--     §٩  begin 1695 → commit 1784   ✔ ثبتت — سياستان + منح/سحب
--     §١٠ begin 1792 → commit 2061   ✘ تراجعت — كتلة الفحص الذاتيّ فقط
--
--   أي أنّ **جدولين و٤٢ دالّة وسياستين ومنحًا حيّة الآن** على الإنتاج، بينما
--   لم يُنفَّذ الفحص الذاتيّ الذي يُصادق عليها. هذا ليس عطبًا في البيانات —
--   لا كتابة على بيانات العهدة في أيّ من التسع — لكنّه ليس «لا شيء» أيضًا،
--   ولا يجوز أن يُقرأ كذلك. الملفّ أدناه يقيس الحالة الفعلية بدل افتراضها.
--
--   ★ العلاج: أعد تشغيل RUNME بعد الإصلاح. ★ ليس Rollback.
--     تحقّقتُ من قابلية إعادة التشغيل بندًا بندًا: ٤٢ دالّة بـcreate or
--     replace · جدولان وستّة فهارس بـif not exists · وكلّ الزنادات الثمانية
--     والسياستين مسبوقة بـdrop … if exists مطابق (١٠/١٠). فإعادة التشغيل
--     تمرّ فوق ما ثبت وتُكمل العاشرة.
--
-- ★ سبب السقوط نفسه، بلا تلطيف ★
--   الفحص كان:  v_def ilike '%' || f || '%'   مع f = 'ai_'
--   والشرطة السفلية في LIKE/ILIKE **محرف بدل** يطابق أيّ محرف واحد. فالنمط
--   '%ai_%' معناه «ai يتبعها أيّ محرف» لا «يبدأ بـai_». طابق ٢٨ موضعًا،
--   أوّلها اسم الدالّة نفسها: custody_inv_m·ai·ntenance_signals، ثمّ
--   days_rem·ai·ning و r·ai·se. ولا معرّف واحد في الحزمة يبدأ فعلًا بـai_ ،
--   و predict و machine_learning و forecast_model صفر مطابقة. إنذار كاذب.
-- ════════════════════════════════════════════════════════════════════════════

with

-- ما تُنشئه المعاملات التسع الثابتة — يُقاس لا يُفترض.
sec19_tables(t) as (values
  ('custody_inventory_maintenance_plans'), ('custody_inventory_meter_readings')),

sec19_fns(f) as (values
  ('civ_grade_to_condition'), ('civ_condition_to_grade'), ('civ_sync_condition_grade'),
  ('civ_asset_state'), ('civ_allowed_transitions'), ('civ_guard_assignment_closure'),
  ('civ_reservation_conflict'), ('civ_guard_reservation'),
  ('custody_inv_admin_create_reservation_v2'), ('custody_inv_fulfil_reservation'),
  ('custody_inv_qr_public_payload'), ('civ_qr_rate_ok'), ('custody_inv_qr_scan'),
  ('civ_meter_block_write'), ('civ_meter_total'), ('civ_meter_usage_between'),
  ('custody_inv_maint_plan_upsert'), ('custody_inv_maint_plan_archive'),
  ('custody_inv_maint_plan_due'), ('custody_inv_maintenance_signals'),
  ('custody_inv_asset_utilization'), ('custody_inv_asset_cost_summary')),

-- الحزم السبع المطبَّقة قبل هذه — عائلة الجداول وعائلة الدوالّ مستقلّتان:
-- استعمال نمط واحد للاثنين أعطى «0 دالّة» كذبًا في حزمة سابقة.
seven(o, pkg, tbl_prefix, fn_prefix) as (values
  (1,'communications_hub',      'comms\_%', 'comms\_%'),
  (2,'operations_center',       'ops\_%',   'prodops\_%'),
  (3,'crm_sales_FOUNDATION',    'crm\_%',   'crm\_%'),
  (4,'finance_profitability',   'fin\_%',   'finops\_%'),
  (5,'commercial_subscriptions','csub\_%',  'csub\_%'),
  (6,'smart_quoting',           'sq\_%',    'sq\_%'),
  (7,'lead_scoring_routing',    'lsr\_%',   'lsr\_%')),

applied_tables as materialized (
  select count(*) filter (where to_regclass('public.' || t) is not null) as present,
         count(*) as expected,
         coalesce(string_agg(t, ' · ') filter (where to_regclass('public.' || t) is null), '') as missing
    from sec19_tables),

applied_fns as materialized (
  select count(*) filter (where exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = f)) as present,
         count(*) as expected,
         coalesce(string_agg(f, ' · ') filter (where not exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = f)), '') as missing
    from sec19_fns),

-- ★★ لا مصدر حقيقة ثانٍ للأصول — بالبنية لا بالاسم ★★
--
--  ⚠️ الصيغة الأولى في هذا الملفّ كانت `relname like 'asset\_%'`، فأبلغت عن
--     asset_insurance_policies. وهي **بوليصة تأمين لا أصل**: لا asset_code ولا
--     barcode ولا serial_number ولا اسم ولا فئة ولا حالة ولا توفّر — بل
--     policy_number ومزوّد ومدّة وتغطية. وارتباطها بالأصول عبر جدول الوصل
--     policy_assets (policy_id و asset_id كلاهما not null)، لأنّ البوليصة
--     الواحدة تغطّي أصولًا كثيرة فلا يستقيم لها مفتاح أجنبيّ مفرد. وهي أصلًا
--     من حزمة التأجير/التأمين السابقة، وRUNME وPREFLIGHT وPOSTCHECK يستثنونها
--     صراحةً — والاستثناء هو ما سقط منّي هنا وحدي.
--
--  والعلاج ليس إضافة اسمها إلى قائمة استثناء: قائمة الاستثناءات تُصلح الحالة
--  التي عرفناها وتترك التي لم نعرفها. المصدر الموازي يُعرَّف **بصفتين معًا**:
--    (١) يحمل هويّة أصل: عمودان فأكثر من مجموعة الهويّة/الحالة أدناه.
--    (٢) ولا يملك رابطًا **إلزاميًّا** إلى المالك: لا مفتاح أجنبيّ not null
--        إلى custody_inventory_assets، ولا جدول وصل يربطه بمفاتيح not null.
--  فامتدادٌ بلا أعمدة هويّة يمرّ ولو بدأ اسمه بـasset_، وجدولٌ يخزّن barcode
--  وserial_number بلا رابط إلزاميّ يسقط ولو سُمّي inventory_widgets.
rival_master as (
  select coalesce(string_agg(x.relname || ' (أعمدة هويّة: ' || x.ident::text
                             || ' · رابط إلزاميّ: ' || case when x.linked then 'نعم' else 'لا' end || ')',
                             ' · ' order by x.relname), '') as s
    from (
      select c.relname,
             (select count(*) from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and a.attname in ('asset_code','barcode','qr_code_value','asset_name',
                                   'serial_number','category_id','condition_status',
                                   'availability_status')) as ident,
             (exists (select 1 from pg_constraint fk
                       join pg_attribute a on a.attrelid = c.oid and a.attnum = fk.conkey[1]
                      where fk.conrelid = c.oid and fk.contype = 'f'
                        and fk.confrelid = to_regclass('public.custody_inventory_assets')
                        and a.attnotnull)
              or exists (select 1 from pg_constraint j1
                          join pg_constraint j2 on j2.conrelid = j1.conrelid and j2.contype = 'f'
                                               and j2.confrelid = to_regclass('public.custody_inventory_assets')
                         where j1.contype = 'f' and j1.confrelid = c.oid)) as linked
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p')
         and c.oid is distinct from to_regclass('public.custody_inventory_assets')
    ) x
   where x.ident >= 2 and not x.linked),

-- ★ صدق التسمية على الأسماء الحيّة ★ لا على نصّ ملفّ ولا بـLIKE.
dishonest_names as (
  select coalesce(string_agg(distinct x.n, ' · ' order by x.n), '') as s
    from (
      select p.proname as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'custody\_inv\_%' escape '\'
      union all
      select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p','v','m')
         and c.relname like 'custody\_inv%' escape '\'
      union all
      select a.attname from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p')
         and c.relname like 'custody\_inventory\_%' escape '\'
         and a.attnum > 0 and not a.attisdropped
    ) x
   where x.n ~ '^(ai|ml)_|_(ai|ml)$|predict|forecast|machine_learning|neural|intelligen|confidence_score'),

-- الفحص الذاتيّ لم يُنفَّذ: أثره الوحيد كان RAISE، فلا كائن ينقص بسببه.
selftest_effect(note) as (values
  ('المعاملة العاشرة كتلة فحص ذاتيّ فقط — تراجُعها لا يحذف كائنًا ولا بيانة')),

pkgs as materialized (
  select s.o, s.pkg,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like s.tbl_prefix escape '\') as tbls,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like s.fn_prefix escape '\') as fns
    from seven s),

results as (

select 1 as ord, 'الحالة' as area, '(١) الحالة الجزئية — ما ثبت فعلًا' as check_name,
  case when (select present from applied_tables) = (select expected from applied_tables)
        and (select present from applied_fns)    = (select expected from applied_fns)
       then 'PARTIAL_APPLIED'
       when (select present from applied_tables) = 0 and (select present from applied_fns) = 0
       then 'NOTHING_APPLIED'
       else 'PARTIAL_INCOMPLETE' end as verdict,
  'جداول ' || (select present from applied_tables)::text || '/' || (select expected from applied_tables)::text
  || ' · دوالّ ' || (select present from applied_fns)::text || '/' || (select expected from applied_fns)::text
  || case when (select missing from applied_tables) <> '' then ' · جداول ناقصة: ' || (select missing from applied_tables) else '' end
  || case when (select missing from applied_fns) <> ''    then ' · دوالّ ناقصة: '  || (select missing from applied_fns)  else '' end
  || ' — PARTIAL_APPLIED هو المتوقَّع: المعاملات ٩ ثبتت والعاشرة تراجعت. العلاج إعادة تشغيل RUNME بعد الإصلاح، لا Rollback.' as detail

union all
select 2, 'الحالة', '(٢) تراجُع المعاملة العاشرة لم يحذف شيئًا',
  'INFO', (select note from selftest_effect)

union all
select 3, 'المعمارية', '(٣) لا مصدر حقيقة ثانٍ للأصول',
  case when (select s from rival_master) = '' then 'PASS' else 'FAIL' end,
  case when (select s from rival_master) = ''
       then 'custody_inventory_assets وحده المالك — ولا عائلة asset_* ولا ai_* موازية'
       else '★ مصدر ثانٍ ★ ' || (select s from rival_master) end

union all
select 4, 'الصدق', '(٤) لا اسم حيّ يدّعي التنبّؤ أو الذكاء',
  case when (select s from dishonest_names) = '' then 'PASS' else 'FAIL' end,
  case when (select s from dishonest_names) = ''
       then 'كلّ الأسماء الحيّة تصف قاعدةً معلَنة: maintenance/priority/due/state — ولا معرّف يبدأ بـai_ ولا يذكر predict أو forecast'
       else '★ تسمية مضلّلة ★ ' || (select s from dishonest_names) end

union all
select 5, 'الحزم القائمة', '(٥) الحزم السبع السابقة سليمة',
  case when (select count(*) from pkgs where tbls > 0 and fns > 0) = 7 then 'PASS' else 'FAIL' end,
  case when (select count(*) from pkgs where tbls = 0 or fns = 0) > 0
       then '★ حزمة بلا كائنات ★ ' || (select string_agg(p.pkg || ' (' || p.tbls || '/' || p.fns || ')', ' · ' order by p.o)
                                         from pkgs p where p.tbls = 0 or p.fns = 0)
       else (select string_agg(p.pkg || ': ' || p.tbls || ' جدولًا/' || p.fns || ' دالّة', ' · ' order by p.o) from pkgs p) end

union all
select 6, 'الحالة', '(٦) بيانات العهدة لم تُمسّ',
  case when to_regclass('public.custody_inventory_assets') is null then 'ABSENT' else 'PASS' end,
  'المعاملات التسع تُنشئ كائنات ولا تكتب صفًّا في custody_inventory_assets — والجدولان الجديدان يبدآن فارغَين'
)

select verdict, area, check_name, detail
  from (
    select 0 as ord, 'الخلاصة' as area, 'نتيجة الفحص' as check_name,
           case when exists (select 1 from results where verdict = 'FAIL') then 'FAIL' else 'READ_ME' end as verdict,
           '★ حالة جزئية على الإنتاج ★ تسع معاملات ثبتت والعاشرة تراجعت. '
           || 'أعد تشغيل asset_intelligence_RUNME.sql بعد الإصلاح — إعادة التشغيل آمنة '
           || '(٤٢ دالّة create or replace · جدولان وفهارس if not exists · ١٠/١٠ زناد وسياسة مسبوقة بـdrop if exists). '
           || 'ولا تُشغّل ROLLBACK.' as detail
    union all select * from results) z
 order by z.ord;
