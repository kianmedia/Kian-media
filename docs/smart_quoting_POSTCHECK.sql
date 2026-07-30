-- ════════════════════════════════════════════════════════════════════════════
-- docs/smart_quoting_POSTCHECK.sql — للقراءة فقط · مجموعة نتائج واحدة.
--
-- يُشغَّل بعد docs/smart_quoting_RUNME.sql.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة. محرّر SQL يعمل بدور postgres
--   و auth.uid() = NULL؛ استدعاء بوّابة حيّة هنا يُرجع false ويُقرأ خطأً على
--   أنّها «مكسورة». كلّ صفّ أدناه يقرأ **تعريف** الكائن من كتالوج النظام:
--   pg_get_functiondef · pg_policies · pg_constraint · information_schema.
--   (الـdeparser يرفع حالة الكلمات المفتاحية مثل COALESCE، ولذلك كلّ مطابقة
--    هنا على **مُعرِّفات** صغيرة الحروف لا على كلمات مفتاحية.)
--
-- ولا مصيدة catch-all: كلّ صفّ قادر على أن يُرجع FAIL.
-- ════════════════════════════════════════════════════════════════════════════

with
tables_expected(t) as (values
  ('sq_settings'),('sq_service_catalog'),('sq_price_books'),('sq_price_book_versions'),
  ('sq_price_book_entries'),('sq_cost_rates'),('sq_pricing_rules'),('sq_quotes'),
  ('sq_quote_internal'),('sq_quote_inputs'),('sq_quote_lines'),('sq_quote_milestones'),
  ('sq_approval_requests'),('sq_audit')),

cost_tables(t) as (values
  ('sq_settings'),('sq_cost_rates'),('sq_pricing_rules'),('sq_quote_internal'),
  ('sq_approval_requests'),('sq_audit')),

sell_tables(t) as (values
  ('sq_service_catalog'),('sq_price_books'),('sq_price_book_versions'),
  ('sq_price_book_entries'),('sq_quotes'),('sq_quote_inputs'),
  ('sq_quote_lines'),('sq_quote_milestones')),

sales_fns(f) as (values
  ('sq_quotes_list'),('sq_quote_detail'),('sq_quote_lines_list'),('sq_quote_milestones_list'),
  ('sq_quote_inputs_get'),('sq_quote_inputs_set'),('sq_my_approvals'),('sq_approval_withdraw'),
  ('sq_quote_activity'),('sq_dashboard'),('sq_export_quote'),('sq_ui_settings'),
  ('sq_my_discount_allowance'),('sq_my_discount_allowance_info'),
  ('sq_quote_price_set'),('sq_quote_submit'),('sq_quote_create'),('sq_quote_terms_set'),
  ('sq_quote_line_set'),('sq_quote_line_delete'),('sq_quote_milestones_set'),
  ('sq_quote_new_version'),('sq_quote_record_client_decision'),('sq_expiry_scan'),
  ('sq_quote_mark_ready_for_manual_send'),('sq_quote_status_label'),('sq_quote_visible'),
  ('sq_catalog_list'),('sq_catalog_item_upsert'),('sq_catalog_item_set_active'),
  ('sq_price_books_list'),('sq_price_book_upsert'),('sq_price_book_versions_list'),
  ('sq_price_book_version_open'),('sq_price_book_entry_set'),('sq_price_book_entries_list'),
  ('sq_price_book_version_publish'),('sq_tiers'),
  ('sq_public_range'),('sq_publish_range'),('sq_unpublish_range')),

cost_tokens(tok) as (values
  ('sq_quote_internal'),('sq_cost_rates'),('sq_pricing_rules'),('min_price'),('cost_rate'),
  ('supplier_rate'),('crew_rate'),('internal_cost_estimate'),('base_cost'),('surcharge_cost'),
  ('contingency'),('overhead'),('gross_profit'),('margin_pct'),('est_net_profit'),
  ('below_floor'),('floor_at_request'),('internal_reason_code'),('external_supplier_cost'),
  ('cost_breakdown'),('formula_snapshot'),('recommended_price'),('target_margin'),('min_margin')),

internal_fns(f) as (values
  ('sq_setting_num'),('sq_setting_json'),('sq_perm'),('sq_perm_key_exists'),('sq_log'),
  ('sq_notify'),('sq_can_view_cost'),('sq_can_approve'),('sq_quote_visible'),
  ('sq_my_discount_allowance'),('sq_next_quote_code'),('sq_next_price_book_code')),

api_fns(f) as (values
  ('sq_quotes_list'),('sq_quote_detail'),('sq_quote_create'),('sq_quote_price_set'),
  ('sq_quote_submit'),('sq_approval_decide'),('sq_quote_recompute'),
  ('sq_quote_internal_detail'),('sq_publish_range'),('sq_public_range')),

triggers_expected(g) as (values
  ('sq_floor_probe_trg'),('sq_approval_stamp_floor_trg'),('sq_pbv_seed_trg'),
  ('sq_pbv_immutable_trg'),('sq_pbe_frozen_trg'),('sq_cost_rates_frozen_trg')),

-- تعريف كلّ دالّة مرّة واحدة
defs as (
  select p.proname, pg_get_functiondef(p.oid) as d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'sq\_%'),

results as (

-- ─── (١) البنية ─────────────────────────────────────────────────────────────
select 10 as ord, 'البنية' as area, 'الجداول الأربعة عشر' as check_name,
  case when count(*) filter (where to_regclass('public.' || t) is not null) = 14
       then 'PASS' else 'FAIL' end as verdict,
  count(*) filter (where to_regclass('public.' || t) is not null) || '/14 موجودة' ||
  coalesce(' — الناقص: ' || nullif(string_agg(t, '، ') filter (where to_regclass('public.' || t) is null), ''), '') as detail
from tables_expected

union all
select 11, 'البنية', 'RLS مفعّل على كلّ جدول',
  case when count(*) filter (where c.relrowsecurity) = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where c.relrowsecurity) || '/' || count(*) || ' مفعّل'
from tables_expected te join pg_class c on c.oid = to_regclass('public.' || te.t)

union all
select 12, 'البنية', 'عدد دوالّ الموديول',
  case when count(*) >= 75 then 'PASS' else 'FAIL' end,
  count(*) || ' دالّة public.sq_*'
from defs

-- ─── (٢) ★ حارس الربحية ★ ────────────────────────────────────────────────────
union all
select 20, '★ حارس الربحية', 'بوّابة التكلفة للمالك حرفيًّا',
  case when d ilike '%is_owner%' and d ilike '%is_staff%'
        and d not ilike '%sq_perm%' and d not ilike '%is_admin%' and d not ilike '%staff_role%'
       then 'PASS' else 'FAIL' end,
  case when d not ilike '%is_owner%'  then 'لا تشترط is_owner'
       when d not ilike '%is_staff%'  then 'لا تستبعد العميل'
       when d ilike '%sq_perm%'       then '★ تُفتح بمفتاح صلاحية — صارت منحة تُعطى وتُنسى'
       when d ilike '%is_admin%'      then '★ توسّعت إلى الدور الإداريّ'
       when d ilike '%staff_role%'    then '★ تُفتح بدور وظيفيّ'
       else 'is_staff() AND is_owner() — بلا مفتاح وبلا استثناء' end
from defs where proname = 'sq_can_view_cost'

union all
select 21, '★ حارس الربحية', 'بوّابة الاعتماد للمالك حرفيًّا',
  case when d ilike '%is_owner%' and d not ilike '%sq_perm%' and d not ilike '%is_admin%'
       then 'PASS' else 'FAIL' end,
  case when d ilike '%sq_perm%' then '★ الاعتماد صار مفتاحًا يُمنح'
       when d ilike '%is_admin%' then '★ الاعتماد توسّع إلى الدور الإداريّ'
       when d not ilike '%is_owner%' then '★ الاعتماد لا يشترط المالك'
       else 'تحديد سعر البيع قرار ربحية — للمالك وحده' end
from defs where proname = 'sq_can_approve'

union all
select 22, '★ حارس الربحية', 'جداول التكلفة تحت بوّابة المالك',
  case when count(*) filter (where has_gate) = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where has_gate) || '/' || count(*) || ' محروسة' ||
  coalesce(' — بلا حراسة: ' || nullif(string_agg(t, '، ') filter (where not has_gate), ''), '')
from (
  select ct.t, exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = ct.t and p.qual ilike '%sq_can_view_cost%'
  ) as has_gate from cost_tables ct) x

union all
select 23, '★ حارس الربحية', 'لا باب جانبيّ على جدول تكلفة',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا مفتاح ولا شرط ملكية auth.uid() في أيّ سياسة تكلفة'
       else '★ ' || string_agg(t, '، ') || ' — شرط ملكية أو مفتاح يفتح التكلفة لغير المالك' end
from (
  select ct.t from cost_tables ct
   where exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = ct.t
                    and (p.qual ilike '%sq_can_view()%' or p.qual ilike '%sq_perm%'
                         or p.qual ilike '%auth.uid()%'))) y

union all
select 24, '★ حارس الربحية', 'جداول البيع لا تُحرَس ببوّابة التكلفة',
  case when count(*) filter (where has_sell_gate) = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where has_sell_gate) || '/' || count(*) || ' تحت sq_can_view()'
from (
  select st.t, exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = st.t and p.qual ilike '%sq_can_view()%'
  ) as has_sell_gate from sell_tables st) z

-- ★★ الفحص الأهمّ في الملفّ ★★
union all
select 25, '★ حارس الربحية', '★ لا رمز تكلفة في أيّ دالّة سطح بيع',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0
       then 'صفر تسريب عبر ' || (select count(*) from sales_fns) || ' دالّة × ' ||
            (select count(*) from cost_tokens) || ' رمزًا'
       else '★ ' || count(*) || ' تسريب: ' || string_agg(f || '←' || tok, '، ') end
from (
  select s.f, c.tok from sales_fns s join defs d on d.proname = s.f cross join cost_tokens c
   where d.d ilike ('%' || c.tok || '%')) leaks

union all
select 26, '★ حارس الربحية', 'كلّ دالّة سطح بيع موجودة فعلًا',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا دالّة مفقودة — الفحص أعلاه فحص شيئًا حقيقيًّا'
       else '★ مفقودة (فالفحص السابق لم يفحصها): ' || string_agg(f, '، ') end
from (select s.f from sales_fns s where not exists (select 1 from defs d where d.proname = s.f)) miss

union all
select 27, '★ حارس الربحية', 'لا select * في سطح البيع',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'قوائم أعمدة صريحة — عمود يُضاف غدًا لا يتسرّب تلقائيًّا'
       else '★ ' || string_agg(proname, '، ') end
from (select d.proname from sales_fns s join defs d on d.proname = s.f where d.d ilike '%select *%') st2

union all
select 28, '★ حارس الربحية', 'المدى العلنيّ لا يُشتقّ من الأرضية',
  case when d not ilike '%min_price%' and d not ilike '%internal_cost%'
        and d not ilike '%margin%' and d ilike '%authorized_price%'
       then 'PASS' else 'FAIL' end,
  case when d ilike '%min_price%' then '★ نشر المدى يقرأ الأرضية — الطرف يكشفها'
       when d ilike '%internal_cost%' or d ilike '%margin%' then '★ نشر المدى يقرأ رقمًا داخليًّا'
       when d not ilike '%authorized_price%' then 'لا يُحسب من سعر البيع المعتمَد'
       else 'يُحسب من سعر البيع وحده، ويُدوَّر إلى مضاعفات خشنة' end
from defs where proname = 'sq_publish_range'

union all
select 29, '★ حارس الربحية', 'صلاحية الخصم لا تُشتقّ من الأرضية',
  case when d not ilike '%min_price%' and d ilike '%discount_allowance%' then 'PASS' else 'FAIL' end,
  case when d ilike '%min_price%'
       then '★ السقف مشتقّ من الأرضية ⇒ السعر × (١ − السقف) = الأرضية بالضبط'
       else 'سُلّم سياسة معلَن من sq_settings — لا يدلّ على أيّ رقم داخليّ' end
from defs where proname = 'sq_my_discount_allowance'

-- ─── (٣) لا عرّاف ────────────────────────────────────────────────────────────
union all
select 30, 'لا عرّاف', 'كلّ عرض يمرّ بالمالك (قيد في القاعدة)',
  case when exists (select 1 from pg_constraint
                     where conname = 'sq_quotes_approval_always'
                       and conrelid = 'public.sq_quotes'::regclass) then 'PASS' else 'FAIL' end,
  'القيد يمنع أيّ كود لاحق من جعل مسار الاعتماد شرطيًّا — والمسار الثابت لا يحمل معلومة عن الأرضية'

union all
select 31, 'لا عرّاف', 'التسعير لا يعرف الأرضية ولا يرفض بسببها',
  case when d not ilike '%min_price%' and d ilike '%sq_my_discount_allowance%'
       then 'PASS' else 'FAIL' end,
  case when d ilike '%min_price%'
       then '★ sq_quote_price_set تقرأ الأرضية ⇒ رفضُها يصير عرّافًا يُبحث فيه ثنائيًّا'
       else 'حدُّها الوحيد صلاحية الخصم — رقم يعرفه الموظّف سلفًا فلا يضيف معلومة' end
from defs where proname = 'sq_quote_price_set'

union all
select 32, 'لا عرّاف', 'حارس التحسّس يعدّ ولا ينطق',
  case when d ilike '%floor_probe_count%' and d not ilike '%raise exception%'
       then 'PASS' else 'FAIL' end,
  case when d ilike '%raise exception%'
       then '★ المُشغّل يرفع استثناءً ⇒ صار هو نفسه العرّاف'
       when d not ilike '%floor_probe_count%' then 'لا يعدّ المحاولات'
       else 'يعدّ في جدول لا يراه إلا المالك، ولا يعيد شيئًا للمستدعي' end
from defs where proname = 'sq_floor_probe_guard'

-- ─── (٤) الأمانة ────────────────────────────────────────────────────────────
union all
select 40, 'الأمانة', 'sent_placeholder لا تعني أنّ رسالة غادرت',
  case when d ilike '%معتمد وجاهز للإرسال اليدوي%' then 'PASS' else 'FAIL' end,
  case when d ilike '%معتمد وجاهز للإرسال اليدوي%'
       then 'النصّ المعروض «معتمد وجاهز للإرسال اليدوي» — لا كلمة «أُرسل»'
       else '★ الحالة تُعرض بنصّ يوحي بإرسال لم يقع' end
from defs where proname = 'sq_quote_status_label'

union all
select 41, 'الأمانة', 'لا ادّعاء تسليم بلا إثبات مزوّد',
  case when exists (select 1 from pg_constraint
                     where conname = 'sq_delivery_never_claimed'
                       and conrelid = 'public.sq_quotes'::regclass) then 'PASS' else 'FAIL' end,
  'delivery_proven مقيَّد بـfalse — لا كود يستطيع ادّعاء تسليم'

union all
select 42, 'الأمانة', 'المدى العلنيّ لا يصير سعرًا ملزِمًا',
  case when exists (select 1 from pg_constraint
                     where conname = 'sq_range_never_binding'
                       and conrelid = 'public.sq_quotes'::regclass) then 'PASS' else 'FAIL' end,
  'range_is_binding مقيَّد بـfalse'

union all
select 43, 'الأمانة', 'الضريبة حقل مستقلّ لا مطويّ في الإجمالي',
  case when count(*) = 3 then 'PASS' else 'FAIL' end,
  count(*) || '/3 أعمدة ضريبة مستقلّة (sq_quotes.vat_rate/vat_amount · sq_quote_milestones.vat_amount)'
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'sq_quotes' and column_name in ('vat_rate','vat_amount'))
    or (table_name = 'sq_quote_milestones' and column_name = 'vat_amount'))

union all
select 44, 'الأمانة', 'لا عمود تكلفة في جدول العروض',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'sq_quotes سطح بيع خالص — لا يوجد فيه ما يتسرّب لو ارتخت سياسة يومًا'
       else '★ ' || string_agg(column_name, '، ') end
from information_schema.columns
where table_schema = 'public' and table_name = 'sq_quotes'
  and (column_name like '%cost%' or column_name like '%margin%'
       or column_name in ('min_price','gross_profit','est_net_profit','recommended_price'))

-- ─── (٥) المنح ──────────────────────────────────────────────────────────────
union all
select 50, 'المنح', 'لا جدول ممنوح لأيّ دور',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'كلّ قراءة تمرّ بدالّة بقائمة أعمدة صريحة'
       else '★ ' || count(*) || ' منح مباشر: ' || string_agg(distinct table_name || '→' || grantee, '، ') end
from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'sq\_%'
  and grantee in ('anon','authenticated','PUBLIC')

-- ⚠️ فحوص المنح تقرأ الـACL مباشرةً (aclexplode) ولا تستدعي
--    has_function_privilege باسم دور نصّيّ: الاستدعاء باسم دور غير موجود
--    **يرفع خطأً** فيُسقط مجموعة النتائج كلّها بدل أن يُبلغ عن حالتها.
union all
select 51, 'المنح', 'لا منح لـanon على أيّ دالّة',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'المدى «العلنيّ» يُقرأ بحساب مسجَّل فقط — لا سطر anon واحد'
       else '★ ' || count(*) || ' دالّة ممنوحة لـanon: ' || string_agg(proname, '، ') end
from (
  select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and p.proname like 'sq\_%'
     and r.rolname = 'anon' and a.privilege_type = 'EXECUTE') an

union all
select 52, 'المنح', 'المساعدات الداخلية غير قابلة للاستدعاء',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'sq_setting_num وأخواتها محجوبة — لا باب خلفيّ على معاملات المعادلة'
       else '★ ممنوحة: ' || string_agg(proname, '، ') end
from (
  select distinct p.proname
    from internal_fns i
    join pg_proc p on p.proname = i.f
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public'
     and r.rolname in ('authenticated','anon') and a.privilege_type = 'EXECUTE') ig

union all
select 53, 'المنح', 'دوالّ الواجهة قابلة للاستدعاء فعلًا',
  case when count(*) filter (where granted) = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where granted) || '/' || count(*) || ' ممنوحة لـauthenticated' ||
  coalesce(' — غير ممنوحة: ' || nullif(string_agg(f, '، ') filter (where not granted), ''), '') ||
  ' (منعٌ شامل بلا منح = موديول مثبَّت لا يعمل)'
from (
  select a.f, exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) ac
      join pg_roles r on r.oid = ac.grantee
     where n.nspname = 'public' and p.proname = a.f
       and r.rolname = 'authenticated' and ac.privilege_type = 'EXECUTE') as granted
  from api_fns a) ag

-- ─── (٦) الإصدارات والمُشغّلات ───────────────────────────────────────────────
union all
select 60, 'الإصدارات', 'المُشغّلات الستّة قائمة',
  case when count(*) filter (where present) = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where present) || '/' || count(*) ||
  coalesce(' — الناقص: ' || nullif(string_agg(g, '، ') filter (where not present), ''), '')
from (select te.g, exists (select 1 from pg_trigger t
                            where t.tgname = te.g and not t.tgisinternal) as present
        from triggers_expected te) tg

union all
select 61, 'الإصدارات', 'نسخة منشورة مجمّدة (بيعًا وتكلفةً)',
  case when (select count(*) from pg_trigger
              where tgname in ('sq_pbe_frozen_trg','sq_cost_rates_frozen_trg')
                and not tgisinternal) = 2 then 'PASS' else 'FAIL' end,
  'التجميد على طرفَي النسخة — وإلّا صار «إصدارًا» بالاسم فقط'

union all
select 62, 'الإصدارات', 'العرض يتجمّد على نسخة دفتر أسعار',
  case when exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'sq_quotes'
                       and column_name = 'price_book_version_id') then 'PASS' else 'FAIL' end,
  'عرضٌ قديم يبقى مفسَّرًا بأسعار وقته — بلا ذلك يصير تدقيق ربحيته بلا معنى'

-- ─── (٧) المنصّة المجمَّدة ────────────────────────────────────────────────────
union all
select 70, 'التجميد', 'مرجع المشروع للقراءة فقط',
  case when (select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'sq_quotes'
                and column_name = 'project_id') = 1
        and not exists (
          select 1 from defs where d ilike '%insert into public.projects%'
             or d ilike '%update public.projects%' or d ilike '%delete from public.projects%')
       then 'PASS' else 'FAIL' end,
  case when exists (select 1 from defs where d ilike '%insert into public.projects%'
                      or d ilike '%update public.projects%' or d ilike '%delete from public.projects%')
       then '★ الموديول يكتب في منصّة المشاريع المجمَّدة'
       else 'project_id مرجع اختياريّ — لا إنشاء ولا تعديل ولا تغيير مرحلة' end

union all
select 71, 'التجميد', 'لا اعتماد على بوّابات المشاريع',
  case when not exists (select 1 from defs
                         where d ilike '%can_manage_projects%' or d ilike '%is_kian_member%')
       then 'PASS' else 'FAIL' end,
  'ربط بوّابة المشاريع بموديول تجاريّ يوسّع دائرة الانفجار بلا سبب'

-- ─── (٨) سلامة البذر ────────────────────────────────────────────────────────
union all
select 80, 'الإعدادات', 'مفاتيح الإعدادات الثمانية مبذورة',
  case when count(*) = 8 then 'PASS' else 'FAIL' end, count(*) || '/8'
from public.sq_settings
where key in ('vat_rate','default_validity_days','sell_quantum','public_range_step',
              'public_range_band_pct','discount_allowance','default_contingency_pct',
              'default_overhead_pct')

union all
select 81, 'الإعدادات', 'مفاتيح صلاحيات quote.* مبذورة',
  case when to_regclass('public.permissions') is null then 'SKIP'
       when (select count(*) from public.permissions where key like 'quote.%') >= 6
       then 'PASS' else 'FAIL' end,
  case when to_regclass('public.permissions') is null then 'كتالوج الصلاحيات غير موجود — تُخطّي البذر (fail-closed)'
       else (select count(*)::text from public.permissions where key like 'quote.%') || ' مفتاحًا' end

union all
select 82, 'الإعدادات', '★ لا مفتاح صلاحية للتكلفة أو الهامش أو الاعتماد',
  case when to_regclass('public.permissions') is null then 'SKIP'
       when (select count(*) from public.permissions
              where key in ('quote.view_cost','quote.view_margin','quote.approve',
                            'quote.view_internal','quote.cost')) = 0
       then 'PASS' else 'FAIL' end,
  'لو صارت مفتاحًا لمُنحت يومًا لتسهيل عمل، ثمّ نُسيت ممنوحة'
)

select
  case verdict when 'PASS' then '✔ PASS' when 'SKIP' then '○ SKIP' else '✘ FAIL' end as verdict,
  area, check_name, detail
from results
order by case verdict when 'FAIL' then 0 when 'SKIP' then 1 else 2 end, ord;

-- ════════════════════════════════════════════════════════════════════════════
-- القراءة
--   • أيّ ✘ FAIL في «★ حارس الربحية» أو «لا عرّاف» = **أوقف الاستخدام**.
--     هذه ليست ملاحظات تحسين: كلّ واحد منها طريقٌ مُثبَت إلى الهامش.
--   • ○ SKIP يعني ميزة اختيارية غائبة (كتالوج الصلاحيات) — لا خلل.
--   • كلّها ✔ = الموديول مثبَّت وحارس الربحية قائم بنيويًّا لا بالتقنيع.
-- ════════════════════════════════════════════════════════════════════════════
