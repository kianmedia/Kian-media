-- ════════════════════════════════════════════════════════════════════════════
-- docs/vendor_compliance_center_AFTER_FAILURE_VERIFY.sql (READ-ONLY · نتيجة واحدة)
--   آمن في محرّر Supabase مع auth.uid() = NULL · بلا كتابة · بلا نداء محميّ.
--
-- ★ الحالة ★ vendor_compliance_center_RUNME.sql **معاملة واحدة**
--   (begin عند 139 · commit عند 3269)، وسقط الإدراج داخلها عند السطر ~850 بـ
--   23503. فالتراجع كامل و**لا حالة جزئية**: لا جدول vcc_* ولا صفّ ولا سياسة.
--   وهذا يخالف asset_intelligence التي كانت عشر معاملات — فلا يُقاس عليها.
--
-- ★ السبب ★ اختلاف مفتاح لا نقص زرع: VCC استعملت 'commercial_register' و
--   'tax_certificate'، وسجلّ الأنواع القائم يحمل 'commercial_registration' و
--   'vat_certificate' لنفس الوثيقتين — التسمية العربية للسجلّ التجاريّ واحدة
--   في الحزمتين حرفيًّا. ولم يكن الأثر في الإدراج وحده: جملتا UPDATE سابقتان
--   (never_public و applies_to) كانتا تمرّان **بصمت** بلا مطابقة.
-- ════════════════════════════════════════════════════════════════════════════
with
vcc_objects as (
  select coalesce(string_agg(c.relname, ' · ' order by c.relname), '') as s,
         count(*) as n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and c.relname like 'vcc\_%' escape '\'),
vcc_fns as (
  select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'vcc\_%' escape '\'),
-- سجلّ أنواع المستندات: واحد لا اثنان.
registries as (
  select coalesce(string_agg(c.relname, ' · ' order by c.relname), '') as s
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and (c.relname like '%document\_type%' escape '\' or c.relname like '%doc\_type%' escape '\')),
tvn_types as (
  select count(*) as n,
         count(*) filter (where key = 'commercial_registration') as has_cr,
         count(*) filter (where key = 'vat_certificate')         as has_vat,
         count(*) filter (where key = 'commercial_register')     as has_variant_cr,
         count(*) filter (where key = 'tax_certificate')         as has_variant_tax
    from public.tvn_document_types),
-- مرادف دلاليّ: مفتاحان بالتسمية العربية نفسها.
dupes as (
  select coalesce(string_agg(a.label_ar || ': ' || a.key || ' / ' || b.key, ' · '), '') as s
    from public.tvn_document_types a
    join public.tvn_document_types b on b.label_ar = a.label_ar and b.key > a.key
   where btrim(coalesce(a.label_ar, '')) <> ''),
prev(o, pkg, tbl_prefix, fn_prefix) as (values
  (1,'communications_hub','comms\_%','comms\_%'), (2,'operations_center','ops\_%','prodops\_%'),
  (3,'crm_sales_FOUNDATION','crm\_%','crm\_%'),   (4,'finance_profitability','fin\_%','finops\_%'),
  (5,'commercial_subscriptions','csub\_%','csub\_%'), (6,'smart_quoting','sq\_%','sq\_%'),
  (7,'lead_scoring_routing','lsr\_%','lsr\_%'),   (8,'talent_vendor_network','tvn\_%','tvn\_%')),
pkgs as (
  select p.o, p.pkg,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname='public' and c.relkind in ('r','p') and c.relname like p.tbl_prefix escape '\') as tbls,
         (select count(*) from pg_proc f join pg_namespace n on n.oid = f.pronamespace
           where n.nspname='public' and f.proname like p.fn_prefix escape '\') as fns
    from prev p),
results as (
select 1 as ord, 'الحالة' as area, '(١) لا حالة جزئية — معاملة واحدة' as check_name,
  case when (select n from vcc_objects) = 0 and (select n from vcc_fns) = 0 then 'PASS' else 'FAIL' end as verdict,
  case when (select n from vcc_objects) = 0 and (select n from vcc_fns) = 0
       then 'صفر كائن vcc_* — التراجع كامل كما يقتضي begin/commit واحد'
       else '★ بقايا ★ جداول: ' || (select s from vcc_objects) || ' · دوالّ: ' || (select n from vcc_fns)::text end as detail
union all
select 2, 'العقد', '(٢) سجلّ أنواع المستندات واحد',
  case when (select s from registries) = 'tvn_document_types' then 'PASS' else 'FAIL' end,
  'سجلّات موجودة: ' || coalesce(nullif((select s from registries), ''), 'لا شيء')
  || ' — يجب أن يكون tvn_document_types وحده'
union all
select 3, 'العقد', '(٣) المفاتيح القانونية موجودة والمرادفات غائبة',
  case when (select has_cr from tvn_types) = 1 and (select has_vat from tvn_types) = 1
        and (select has_variant_cr from tvn_types) = 0 and (select has_variant_tax from tvn_types) = 0
       then 'PASS' else 'FAIL' end,
  'commercial_registration=' || (select has_cr from tvn_types)::text
  || ' · vat_certificate=' || (select has_vat from tvn_types)::text
  || ' · commercial_register(مرادف)=' || (select has_variant_cr from tvn_types)::text
  || ' · tax_certificate(مرادف)=' || (select has_variant_tax from tvn_types)::text
  || ' · إجمالي الأنواع=' || (select n from tvn_types)::text
union all
select 4, 'العقد', '(٤) لا مرادف دلاليّ لوثيقة واحدة',
  case when (select s from dupes) = '' then 'PASS' else 'FAIL' end,
  case when (select s from dupes) = '' then 'كلّ تسمية عربية تخصّ مفتاحًا واحدًا'
       else '★ سجلّ مشقوق ★ ' || (select s from dupes) end
union all
select 5, 'الحزم القائمة', '(٥) الحزم الثماني السابقة سليمة',
  case when (select count(*) from pkgs where tbls > 0 and fns > 0) = 8 then 'PASS' else 'FAIL' end,
  (select string_agg(p.pkg || ': ' || p.tbls || '/' || p.fns, ' · ' order by p.o) from pkgs p)
union all
select 6, 'الحالة', '(٦) وثائق الموردين لم تُمسّ',
  case when to_regclass('public.tvn_documents') is null then 'FAIL' else 'PASS' end,
  'tvn_documents قائم — والحزمة الساقطة لم تُدرج وثيقة واحدة، إنّما أنواعًا وقواعد جاهزية'
)
select verdict, area, check_name, detail
  from (select 0 as ord, 'الخلاصة' as area, 'نتيجة الفحص' as check_name,
               case when exists (select 1 from results where verdict='FAIL') then 'FAIL' else 'PASS' end as verdict,
               'تراجع كامل بلا حالة جزئية. العلاج: أعد تشغيل RUNME بعد الإصلاح — لا ROLLBACK.' as detail
        union all select * from results) z
 order by z.ord;
