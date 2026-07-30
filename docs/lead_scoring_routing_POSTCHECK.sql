-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_POSTCHECK.sql — للقراءة فقط · مجموعة نتائج واحدة.
--
-- يُشغَّل بعد docs/lead_scoring_routing_RUNME.sql.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة. محرّر SQL يعمل بدور postgres
--   و auth.uid() = NULL؛ استدعاء بوّابة حيّة هنا يُرجع false ويُقرأ خطأً على
--   أنّها «مكسورة»، أو يرفع «not authorized» فيبدو الملفّ عاطلًا. كلّ صفّ أدناه
--   يقرأ **تعريف** الكائن من كتالوج النظام: pg_get_functiondef · pg_policies ·
--   pg_constraint · pg_class · information_schema.
--   (الـdeparser يرفع حالة الكلمات المفتاحية مثل COALESCE، ولذلك كلّ مطابقة
--    هنا على **مُعرِّفات** صغيرة الحروف لا على كلمات مفتاحية.)
--
-- ★ ولا مصيدة catch-all ★ كلّ صفّ قادر فعلًا على أن يُرجع FAIL.
--   وكلّ قراءة لصفوف جداولنا تمرّ عبر query_to_xml كي يُبلّغ الملفّ عن ترحيلة
--   فاشلة بدل أن ينهار معها بـ42P01.
-- ════════════════════════════════════════════════════════════════════════════

with

tables_expected(t) as (values
  ('lsr_settings'),('lsr_factors'),('lsr_rulesets'),('lsr_rules'),('lsr_lead_profile'),
  ('lsr_territories'),('lsr_score_manual'),('lsr_agents'),('lsr_routing_rules'),
  ('lsr_assignments'),('lsr_review_queue'),('lsr_audit'),('lsr_event_log')),

api_fns(f) as (values
  ('lsr_access'),('lsr_score'),('lsr_score_scan'),('lsr_score_manual_set'),('lsr_profile_set'),
  ('lsr_rule_upsert'),('lsr_ruleset_clone'),('lsr_ruleset_publish'),('lsr_route_preview'),
  ('lsr_assign'),('lsr_review_list'),('lsr_review_dismiss'),('lsr_agent_set'),
  ('lsr_routing_rule_upsert'),('lsr_events_list'),('lsr_finance_reference'),
  ('lsr_dashboard_owner'),('lsr_dashboard_sales'),('lsr_dashboard_client'),
  ('lsr_dashboard_operations')),

internal_fns(f) as (values
  ('lsr_score_core'),('lsr_route_core'),('lsr_context'),('lsr_rule_matches'),
  ('lsr_event_emit'),('lsr_log'),('lsr_agent_workload'),('lsr_setting_int'),
  ('lsr_setting_bool'),('lsr_event_keys'),('lsr_txt'),('lsr_num'),('lsr_bool'),
  ('lsr_norm_city')),

predicates(f) as (values
  ('lsr_can_view'),('lsr_can_route'),('lsr_can_reassign'),('lsr_can_manage_scoring'),
  ('lsr_can_override_score'),('lsr_can_view_owner_dashboard'),('lsr_can_view_ops_queue'),
  ('lsr_is_sales_manager'),('lsr_is_owner_role'),('lsr_is_client'),('lsr_perm')),

-- العوامل الثمانية عشر المطلوبة بالعقد، بأسمائها.
factors_expected(k) as (values
  ('budget_range'),('organization_type'),('company_size'),('service_type'),
  ('locations_count'),('cities_count'),('urgency'),('desired_delivery_days'),
  ('data_completeness'),('lead_source'),('existing_client'),('retainer_potential'),
  ('annual_value_potential'),('production_complexity'),('territory'),
  ('strategic_sector'),('previous_lost_reason'),('response_behaviour')),

events_expected(k) as (values
  ('subscription_activated'),('subscription_expiring'),('credits_expiring'),('credits_low'),
  ('production_request_submitted'),('production_request_approved'),('production_request_rejected'),
  ('overage_approval_required'),('quote_ready_for_review'),('quote_owner_approval_required'),
  ('quote_accepted'),('lead_assigned'),('lead_followup_due')),

-- ⛔ الرموز الممنوعة كمدخلات تقييم — صفة شخصية لا صفة فرصة.
forbidden_inputs(tok) as (values
  ('gender'),('nationality'),('ethnic'),('religio'),('marital'),
  ('date_of_birth'),('birth_date'),('age_group'),('age_band')),

-- تعريف كلّ دالّة مرّة واحدة.
defs as (
  select p.proname, pg_get_functiondef(p.oid) as d, p.prorettype
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%'),

results as (

-- ─── (١) البنية ─────────────────────────────────────────────────────────────
select 10 as ord, 'البنية' as area, 'الجداول الثلاثة عشر' as check_name,
  case when count(*) filter (where to_regclass('public.' || t) is not null) = 13
       then 'PASS' else 'FAIL' end as verdict,
  count(*) filter (where to_regclass('public.' || t) is not null) || '/13 موجودة'
  || case when count(*) filter (where to_regclass('public.' || t) is null) = 0 then ''
          else ' · الناقص: ' || string_agg(t, ', ') filter (where to_regclass('public.' || t) is null) end
    as detail
from tables_expected

union all
select 11, 'البنية', 'RLS مفعّل على كلّ جدول',
  case when count(*) filter (where c.relrowsecurity) = count(*) and count(*) = 13
       then 'PASS' else 'FAIL' end,
  count(*) filter (where c.relrowsecurity) || '/' || count(*) || ' مفعّل'
  || coalesce(' · بلا RLS: ' || string_agg(c.relname, ', ') filter (where not c.relrowsecurity), '')
from tables_expected te
join pg_class c on c.relname = te.t
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'

union all
select 12, 'البنية', 'سياسة قراءة واحدة على الأقلّ لكلّ جدول',
  case when count(*) = 13 then 'PASS' else 'FAIL' end,
  count(*) || '/13 جدولًا له سياسة SELECT'
from (select distinct p.tablename from pg_policies p
       join tables_expected te on te.t = p.tablename
      where p.schemaname = 'public' and p.cmd in ('SELECT','ALL')) x

union all
-- ★ الكتابة عبر الدوالّ وحدها: أيّ سياسة كتابة لدور تطبيقيّ خرق للتصميم.
select 13, 'البنية', 'لا سياسة كتابة لأيّ دور تطبيقيّ',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا سياسات INSERT/UPDATE/DELETE — الكتابة عبر الدوالّ فقط'
       else 'سياسات كتابة غير متوقَّعة: ' || string_agg(policyname || '/' || cmd, ', ') end
from pg_policies p join tables_expected te on te.t = p.tablename
where p.schemaname = 'public' and p.cmd in ('INSERT','UPDATE','DELETE')

-- ─── (٢) الدوالّ ────────────────────────────────────────────────────────────
union all
select 20, 'الدوالّ', 'دوالّ السطح العشرون',
  case when count(*) filter (where exists (select 1 from defs d where d.proname = f)) = 20
       then 'PASS' else 'FAIL' end,
  count(*) filter (where exists (select 1 from defs d where d.proname = f)) || '/20 موجودة'
  || coalesce(' · الناقص: ' || string_agg(f, ', ')
       filter (where not exists (select 1 from defs d where d.proname = f)), '')
from api_fns

union all
select 21, 'الدوالّ', 'النوى الداخلية',
  case when count(*) filter (where exists (select 1 from defs d where d.proname = f)) = 14
       then 'PASS' else 'FAIL' end,
  count(*) filter (where exists (select 1 from defs d where d.proname = f)) || '/14 موجودة'
from internal_fns

union all
select 22, 'الدوالّ', 'كلّ مُسنَد يُرجع boolean',
  case when count(*) = 11 and count(*) filter (where prorettype = 'boolean'::regtype) = 11
       then 'PASS' else 'FAIL' end,
  count(*) filter (where prorettype = 'boolean'::regtype) || '/' || count(*)
  || ' مُسنَدًا يُرجع boolean (المتوقَّع ١١). مُسنَد غير boolean يجعل RLS «غير محدَّد» لا «ممنوع».'
from defs d join predicates pr on pr.f = d.proname

union all
select 23, 'الدوالّ', 'كلّ دالّة SECURITY DEFINER بمسار بحث مثبَّت',
  case when count(*) filter (where d.d ilike '%search_path%') = count(*) then 'PASS' else 'FAIL' end,
  count(*) filter (where d.d ilike '%search_path%') || '/' || count(*)
  || ' دالّة تثبّت search_path'
from defs d where d.d ilike '%security definer%'

union all
-- كلّ سطح محميّ يفحص صلاحيته فعلًا. الفحص هنا على وجود بوّابة في **الجسم**.
select 24, 'الصلاحيات', 'كلّ سطح محميّ يفحص صلاحية',
  case when count(*) filter (where not gated) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) filter (where not gated) = 0
       then 'كلّ دوالّ السطح مبوَّبة'
       else 'بلا بوّابة: ' || string_agg(f, ', ') filter (where not gated) end
from (
  select a.f,
         coalesce((select d.d ilike '%lsr_can_%' or d.d ilike '%lsr_is_sales_manager%'
                        or d.d ilike '%my_client_id%'
                     from defs d where d.proname = a.f), false) as gated
    from api_fns a) g

-- ─── (٣) ⛔ الحارس الأهمّ: لا صفة شخصية حسّاسة ─────────────────────────────
union all
select 30, '⛔ المدخلات الممنوعة', 'لا صفة شخصية في أيّ دالّة تقييم',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0
       then 'محرّك التقييم لا يذكر جنسًا ولا عمرًا ولا جنسية — الدرجة عن فرصة لا عن إنسان'
       else '★ خرق ★ ' || string_agg(distinct proname || ':' || tok, ', ') end
from defs d cross join forbidden_inputs fi
where d.proname in ('lsr_context','lsr_score_core','lsr_rule_matches','lsr_score_scan')
  and d.d ~* fi.tok

union all
select 31, '⛔ المدخلات الممنوعة', 'كتالوج العوامل نظيف',
  case when to_regclass('public.lsr_factors') is null then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_factors
                where key ~* ''(gender|nationality|ethnic|religio|marital|birth|age_group|age_band)''',
              false, true, '')))[1]::text::int, 1) = 0
       then 'PASS' else 'FAIL' end,
  'قيد lsr_factor_no_sensitive_attribute يمنع بنيويًّا، وهذا الصفّ يتحقّق من المحتوى الفعليّ'

union all
select 32, '⛔ المدخلات الممنوعة', 'القيد البنيويّ قائم على lsr_factors',
  case when exists (select 1 from pg_constraint
                     where conname = 'lsr_factor_no_sensitive_attribute'
                       and conrelid = to_regclass('public.lsr_factors'))
       then 'PASS' else 'FAIL' end,
  'بلا القيد يصير المنع نيّة: أيّ إدراج لاحق يستطيع إدخال عامل شخصيّ'

-- ─── (٤) التقييم مُفسَّر ────────────────────────────────────────────────────
union all
select 40, 'التقييم', 'مخرجات التفسير كاملة',
  case when count(*) filter (where present) = 9 then 'PASS' else 'FAIL' end,
  count(*) filter (where present) || '/9 مخرَجًا موجودًا'
  || coalesce(' · الناقص: ' || string_agg(k, ', ') filter (where not present), '')
from (
  select k, coalesce((select d.d ilike '%' || k || '%' from defs d
                       where d.proname = 'lsr_score_core'), false) as present
    from (values ('components'),('positive_factors'),('negative_factors'),
                 ('missing_information'),('recommended_next_action'),('review_required'),
                 ('ruleset_version'),('grade_thresholds'),('explain')) v(k)) x

union all
select 41, 'التقييم', 'لا نداء خارجيّ ولا نموذج',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'محرّك قواعد صِرف: لا http ولا pg_net ولا مزوّد خارجيّ'
       else 'نداء خارجيّ في: ' || string_agg(proname, ', ') end
from defs where d ~* '(net\.http|pg_net|https?://|openai|anthropic)'

union all
select 42, 'التقييم', 'مجموعة قواعد منشورة واحدة',
  case when to_regclass('public.lsr_rulesets') is null then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_rulesets where status = ''published''',
              false, true, '')))[1]::text::int, 0) = 1
       then 'PASS' else 'FAIL' end,
  'المنشور واحد بالضبط: صفر يعني لا تقييم، وأكثر من واحد يعني درجتين لعميل واحد'

union all
select 43, 'التقييم', 'العوامل الثمانية عشر موجودة',
  case when to_regclass('public.lsr_factors') is null then 'FAIL'
       when (select count(*) from factors_expected fe
              where coalesce((xpath('/row/c/text()', query_to_xml(
                'select count(*) as c from public.lsr_factors where is_active and key = '
                || quote_literal(fe.k), false, true, '')))[1]::text::int, 0) = 1) = 18
       then 'PASS' else 'FAIL' end,
  'كلّ عامل في العقد له صفّ فعّال في الكتالوج — لا عامل «مذكور في التعليق فقط»'

union all
select 44, 'التقييم', 'القواعد مُصدَّرة وغير قابلة للتعديل بعد النشر',
  case when exists (select 1 from pg_trigger where tgname = 'lsr_rules_frozen_trg'
                      and tgrelid = to_regclass('public.lsr_rules'))
       then 'PASS' else 'FAIL' end,
  'بلا هذا المُشغِّل يمكن تعديل قواعد منشورة، فتصير كلّ درجة محفوظة في التاريخ بلا معنى'

union all
select 45, 'التقييم', 'التعديل اليدويّ يشترط سببًا',
  case when (select count(*) from pg_constraint
              where conrelid = to_regclass('public.lsr_score_manual')
                and conname in ('lsr_manual_adjust_reason','lsr_manual_override_reason')) = 2
       then 'PASS' else 'FAIL' end,
  'قيدان يمنعان تعديلًا أو تجاوزًا بلا سبب مكتوب — الواجهة وحدها لا تكفي'

union all
select 46, 'التقييم', 'التعديل اليدويّ يكتب قيد تدقيق',
  case when coalesce((select d.d ilike '%lsr_log%' from defs d
                       where d.proname = 'lsr_score_manual_set'), false)
       then 'PASS' else 'FAIL' end,
  'كلّ تغيير يدويّ للدرجة يترك أثرًا باسم فاعله وسببه والدرجة قبله وبعده'

-- ─── (٥) التوزيع ────────────────────────────────────────────────────────────
union all
select 50, 'التوزيع', 'حُرّاس الإسناد مذكورون بالاسم',
  case when count(*) filter (where present) = 5 then 'PASS' else 'FAIL' end,
  count(*) filter (where present) || '/5 حارسًا'
  || coalesce(' · الناقص: ' || string_agg(k, ', ') filter (where not present), '')
from (
  select k, coalesce((select d.d ilike '%' || k || '%' from defs d
                       where d.proname = 'lsr_assign'), false) as present
    from (values ('cannot_take_others_lead'),('override_reason_required'),
                 ('reassign_not_permitted'),('routing_not_permitted'),
                 ('lsr_review_queue')) v(k)) x

union all
select 51, 'التوزيع', 'حقول عقد الإسناد مكتوبة',
  case when count(*) filter (where present) = 5 then 'PASS' else 'FAIL' end,
  -- assigned_to و assigned_at لهما قيمة افتراضية؛ هذه الخمسة تُكتب صراحةً.
  count(*) filter (where present) || '/5 حقلًا يُكتب فعلًا في lsr_assignments'
from (
  select k, coalesce((select d.d ilike '%' || k || '%' from defs d
                       where d.proname = 'lsr_assign'), false) as present
    from (values ('previous_owner'),('routing_rule'),('routing_reason'),
                 ('overridden_by'),('override_reason')) v(k)) x

union all
select 52, 'التوزيع', 'لا عشوائية في القرار',
  case when coalesce((select d.d ~* '(random|tablesample)' from defs d
                       where d.proname = 'lsr_route_core'), true)
       then 'FAIL' else 'PASS' end,
  'التوزيع يجب أن يكون قابلًا لإعادة الإنتاج والتفسير: التخصّص فالحِمل فالأولوية فالمعرّف'

union all
select 53, 'التوزيع', 'التجاوز بلا سبب ممنوع بنيويًّا',
  case when exists (select 1 from pg_constraint
                     where conname = 'lsr_assign_override_reason'
                       and conrelid = to_regclass('public.lsr_assignments'))
       then 'PASS' else 'FAIL' end,
  'قيد على مستوى الجدول: لا يكفي أن ترفض الدالّة، فالجدول نفسه يرفض'

union all
select 54, 'التوزيع', 'طابور المراجعة يمنع تكرار الفتح',
  case when exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'lsr_review_queue'
                       and indexdef ilike '%unique%' and indexdef ilike '%pending%')
       then 'PASS' else 'FAIL' end,
  'فهرس فريد جزئيّ: عميل واحد لا يفتح صفّي مراجعة متزامنين'

-- ─── (٦) اللوحات — ما يجب ألّا يظهر ────────────────────────────────────────
union all
select 60, 'اللوحات', 'لوحة العميل بلا رقم داخليّ',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0
       then 'لا تكلفة ولا هامش ولا ملاحظة داخلية في مسار العميل'
       else '★ تسريب ★ ' || string_agg(tok, ', ') end
from (select tok from (values ('l.internal_metadata'),('s.internal_notes'),('r.internal_notes'),
                             ('r.decision_reason'),('sq_quote_internal'),('base_cost'),
                             ('margin_pct'),('gross_profit'),('cost_rate')) v(tok)) t
where coalesce((select d.d ilike '%' || t.tok || '%' from defs d
                 where d.proname = 'lsr_dashboard_client'), false)

union all
select 61, 'اللوحات', 'لوحة العميل محصورة بهُويّة العميل',
  case when coalesce((select d.d ilike '%my_client_id%' from defs d
                       where d.proname = 'lsr_dashboard_client'), false)
       then 'PASS' else 'FAIL' end,
  'بلا الحصر تصير اللوحة قراءة لبيانات عملاء آخرين'

union all
select 62, 'اللوحات', 'طابور العمليات بلا ماليّة حسّاسة',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'خدمة وتواريخ ومدينة ووحدات محجوزة — بلا مبلغ ولا ضريبة'
       else '★ تسريب ★ ' || string_agg(tok, ', ') end
from (select tok from (values ('r.price_net'),('r.vat_amount'),('r.overage_amount_net'),
                             ('r.price_gross'),('margin'),('cost_rate')) v(tok)) t
where coalesce((select d.d ilike '%' || t.tok || '%' from defs d
                 where d.proname = 'lsr_dashboard_operations'), false)

union all
select 63, 'اللوحات', 'لوحة المبيعات بلا تكلفة ولا هامش',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'أرقام البيع فقط — الأرضية والتكلفة تبقيان للمالك'
       else '★ تسريب ★ ' || string_agg(tok, ', ') end
from (select tok from (values ('sq_quote_internal'),('q.base_cost'),('q.margin_pct'),
                             ('floor_at_request'),('internal_cost_estimate')) v(tok)) t
where coalesce((select d.d ilike '%' || t.tok || '%' from defs d
                 where d.proname = 'lsr_dashboard_sales'), false)

union all
select 64, 'اللوحات', 'لوحة المالك للمالك وحده',
  case when coalesce((select d.d ilike '%lsr_can_view_owner_dashboard%' from defs d
                       where d.proname = 'lsr_dashboard_owner'), false)
        and coalesce((select d.d ilike '%is_owner%' or d.d ilike '%is_admin%' from defs d
                       where d.proname = 'lsr_can_view_owner_dashboard'), false)
        and not coalesce((select d.d ilike '%lsr_perm%' from defs d
                       where d.proname = 'lsr_can_view_owner_dashboard'), true)
       then 'PASS' else 'FAIL' end,
  '★ بلا مفتاح صلاحية ★ لو كانت مفتاحًا لأمكن منحها، ولانتهت القيمة التعاقدية إلى منحة إدارية'

union all
select 65, 'اللوحات', 'الغياب يُعلَن ولا يُقرأ صفرًا',
  case when count(*) filter (where honest) = 4 then 'PASS' else 'FAIL' end,
  count(*) filter (where honest) || '/4 لوحات تعلن available/module_not_enabled صراحةً'
from (
  select f, coalesce((select d.d ilike '%module_not_enabled%' or d.d ilike '%available%'
                        from defs d where d.proname = f), false) as honest
    from (values ('lsr_dashboard_owner'),('lsr_dashboard_sales'),
                 ('lsr_dashboard_client'),('lsr_dashboard_operations')) v(f)) x

-- ─── (٧) العقود ────────────────────────────────────────────────────────────
union all
select 70, 'العقود', 'لا كتابة في منصّة المشاريع',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا إنشاء مشروع ولا تعديل مرحلة ولا تسليم — المنصّة مجمَّدة'
       else '★ خرق التجميد ★ ' || string_agg(proname, ', ') end
from defs
where d ~* '(insert\s+into\s+public\.projects|update\s+public\.projects|insert\s+into\s+public\.project_core|update\s+public\.project_core|insert\s+into\s+public\.deliverable)'

union all
select 71, 'العقود', 'لا بوّابة ممنوعة',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا can_manage_projects ولا is_kian_member في أيّ دالّة'
       else '★ خرق ★ ' || string_agg(proname, ', ') end
from defs where d ilike '%can_manage_projects%' or d ilike '%is_kian_member%'

union all
select 72, 'العقود', 'المالية مرجع للقراءة فقط',
  case when coalesce((select d.d ~* '(insert\s+into\s+public\.fin_|update\s+public\.fin_|delete\s+from\s+public\.fin_|zoho)'
                        from defs d where d.proname = 'lsr_finance_reference'), true)
       then 'FAIL' else 'PASS' end,
  'لا فاتورة ولا Zoho ولا ادّعاء تحصيل ولا اعتراف بإيراد'

union all
select 73, 'العقود', 'حالة السداد معلَنة كقراءة فقط',
  case when coalesce((select d.d ilike '%payment_status_is_read_only%' from defs d
                       where d.proname = 'lsr_finance_reference'), false)
       then 'PASS' else 'FAIL' end,
  'الإعلان جزء من العقد: من يقرأ المخرَج يعرف أنّه لا يملك تغيير حالة السداد من هنا'

-- ─── (٨) الأحداث ───────────────────────────────────────────────────────────
union all
select 80, 'الأحداث', 'الأحداث الثلاثة عشر معرَّفة',
  case when coalesce((select count(*) from events_expected ee
                       where (select d.d ilike '%' || ee.k || '%' from defs d
                               where d.proname = 'lsr_event_keys')), 0) = 13
       then 'PASS' else 'FAIL' end,
  'قائمة مغلقة داخل lsr_event_keys() — لا حدث بنصّ حرّ'

union all
select 81, 'الأحداث', 'مفتاح تكرار فريد',
  case when exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'lsr_event_log'
                       and indexdef ilike '%unique%' and indexdef ilike '%idempotency_key%')
       then 'PASS' else 'FAIL' end,
  'الحارس صفّ فريد لا نيّة حسنة: حدث واحد لا يُدرَج مرّتين ولو أُعيدت المحاولة'

union all
select 82, 'الأحداث', 'الإدراج يُجبر dry_run',
  case when coalesce((select d.d ilike '%dry_run = true%' from defs d
                       where d.proname = 'lsr_event_emit'), false)
       then 'PASS' else 'FAIL' end,
  'حتّى لو فُعِّلت قناة يومًا، صفوف هذه الحزمة لا تغادر الطابور في V1'

union all
select 83, 'الأحداث', 'الموديول لا يفعّل قناة',
  case when coalesce((select d.d ilike '%comms_channels%' from defs d
                       where d.proname = 'lsr_event_emit'), true)
       then 'FAIL' else 'PASS' end,
  'تفعيل قناة قرار مالك في مركز الاتصالات، لا أثر جانبيّ لموديول تجاريّ'

union all
select 84, 'الأحداث', 'قيد dry_run على سجلّ الأحداث',
  case when exists (select 1 from pg_constraint
                     where conname = 'lsr_event_dry_run_only'
                       and conrelid = to_regclass('public.lsr_event_log'))
       then 'PASS' else 'FAIL' end,
  'لا يمكن تسجيل «إرسال حقيقيّ» من هذا الموديول — القيد يمنع الكذب لا التوثيق فقط'

union all
select 85, 'الأحداث', 'التسجيل في كتالوج المركز (إن وُجد)',
  case when to_regclass('public.comms_event_catalog') is null then 'INFO'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.comms_event_catalog where event_key like ''commercial.%''',
              false, true, '')))[1]::text::int, 0) >= 13
       then 'PASS' else 'FAIL' end,
  'مركز الاتصالات اختياريّ. حين يوجد، يجب أن تكون الأحداث الثلاثة عشر مسجَّلة ببادئة commercial.'

-- ─── (٩) الصلاحيات التنفيذية ───────────────────────────────────────────────
-- ملاحظة: نقرأ الـACL من الكتالوج (aclexplode / role_table_grants) ولا نستعمل
-- has_*_privilege باسم دور نصّيّ — تلك ترفع استثناءً إن غاب الدور، فتُسقط
-- ملفّ الفحص كلّه بدل أن تُبلّغ. أداة الفحص لا يجوز أن تكون هشّة.
union all
select 90, 'الصلاحيات', 'لا EXECUTE لـanon ولا PUBLIC على أيّ دالّة',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'لا منحة anon ولا منحة افتراضية — لا مسار مجهول إلى بيانات تجارية'
       else '★ خرق ★ ' || string_agg(distinct proname, ', ') end
from (
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%' and p.proacl is null
  union all
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public' and p.proname like 'lsr\_%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or r.rolname = 'anon')) bad

union all
select 91, 'الصلاحيات', 'النوى الداخلية غير مكشوفة لـauthenticated',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'lsr_score_core و lsr_route_core و lsr_event_emit داخلية فعلًا'
       else '★ مكشوف ★ ' || string_agg(distinct proname, ', ') end
from (
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid = a.grantee
    join internal_fns i on i.f = p.proname
   where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
     and r.rolname = 'authenticated') x

union all
select 92, 'الصلاحيات', 'لا كتابة جدول مباشرة لـauthenticated',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  case when count(*) = 0 then 'قراءة فقط عبر RLS — وكلّ كتابة عبر دالّة مدقَّقة'
       else '★ خرق ★ ' || string_agg(distinct table_name || '/' || privilege_type, ', ') end
from information_schema.role_table_grants g
join tables_expected te on te.t = g.table_name
where g.table_schema = 'public' and g.grantee = 'authenticated'
  and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')

-- ─── (١٠) البذور ───────────────────────────────────────────────────────────
union all
select 100, 'البذور', 'قواعد التقييم مزروعة',
  case when to_regclass('public.lsr_rules') is null then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_rules ru
                 join public.lsr_rulesets rs on rs.version = ru.ruleset_version
                where rs.status = ''published'' and ru.is_active', false, true, '')))[1]::text::int, 0) >= 20
       then 'PASS' else 'FAIL' end,
  'مجموعة بلا قواعد فعّالة تُنتج صفرًا لكلّ عميل — وهذا كذب لا تقييم'

union all
select 101, 'البذور', 'قواعد التوزيع مزروعة',
  case when to_regclass('public.lsr_routing_rules') is null then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_routing_rules where is_active',
              false, true, '')))[1]::text::int, 0) >= 3
       then 'PASS' else 'FAIL' end,
  'ثلاث قواعد على الأقلّ: الفئة A، ثمّ الإقليم، ثمّ احتياطيّ أقلّ حِملًا'

union all
select 102, 'البذور', 'سجلّ المندوبين',
  'INFO',
  case when to_regclass('public.lsr_agents') is null then 'الجدول غائب'
       else coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_agents where is_active and is_available',
              false, true, '')))[1]::text, '?')
            || ' مندوبًا فعّالًا ومتاحًا. ★ صفر يعني أنّ كلّ توزيع تلقائيّ سيذهب إلى المراجعة — '
            || 'وهذا سلوك صحيح لا عطل: أضِف المندوبين عبر lsr_agent_set.' end
)

select verdict, area, check_name, detail
  from (
    select 0 as ord, 'الخلاصة' as area, 'نتيجة الفحص' as check_name,
           case when exists (select 1 from results where verdict = 'FAIL') then 'FAIL' else 'PASS' end as verdict,
           case when exists (select 1 from results where verdict = 'FAIL')
                then '★ عدد الإخفاقات: ' || (select count(*)::text from results where verdict = 'FAIL')
                     || ' ★ اقرأ صفوف FAIL أدناه قبل أيّ استعمال.'
                else 'كلّ الفحوص البنيوية مرّت. الحدود المعروفة في docs/COMMERCIAL_GROWTH_V1_LIMITATIONS.md'
           end as detail
    union all select ord, area, check_name, verdict, detail from results) x
 order by (case verdict when 'FAIL' then 0 when 'PASS' then 1 else 2 end), ord, check_name;
