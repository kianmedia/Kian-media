-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_POST_APPLY_SUMMARY.sql
--   ★ هذا هو الملفّ الذي يُشغَّل في محرّر Supabase SQL بعد الترحيلة ★
--   للقراءة فقط · مجموعة نتائج واحدة · بلا BEGIN/COMMIT · بلا auth.uid().
--
-- ★ لماذا وُجد ★
--   docs/lead_scoring_routing_POSTCHECK.sql هو الفحص العميق (نحو خمسين صفًّا)،
--   ومكانه اتّصال psql مباشر. شُغّل مرّتين في المحرّر فانقطع الطلب في الطبقة
--   الأعلى («SQL query ran into an upstream timeout») — بلا خطأ SQL وبلا صفّ
--   FAIL. القطع ليس حكمًا على الحزمة: الحزمة مطبَّقة، والملفّ للقراءة فقط.
--   هذا الملخّص يحمل **الفحوص الستّة عشر** كاملة بكلفة خفيفة تسع المحرّر.
--
-- ★ ما يجعله خفيفًا ★
--   لا رسمَ نداءات هنا: لا ضمّ لدوالّ الموديول ضدّ كلّ دوالّ public، ولا بناء
--   تعبير نمطيّ لكلّ زوج. الكلفة كلّها تمريرتان خطّيّتان على مصدر دوالّ lsr_*
--   (فحص العقد مرّة، وتقسيم المصدر مرّة)، وكلتاهما مثبَّتة بـMATERIALIZED فلا
--   يُعاد حسابها مهما تكرّرت الإشارة.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة. المحرّر يعمل بدور postgres
--   و auth.uid() = NULL؛ نداء بوّابة حيّة هنا يُرجع false ويُقرأ خطأً على أنّه
--   «كسر». كلّ صفّ يقرأ **تعريف** الكائن من كتالوج النظام. والدوالّ الثلاث
--   المُستدعاة (lsr_sql_partition · lsr_contract_scan · lsr_client_scan) أدوات
--   نصّية immutable بلا بوّابة ولا قراءة بيانات.
--
-- ★ ولا مصيدة catch-all ★ كلّ صفّ قادر فعلًا على أن يُرجع FAIL، والغياب
--   البنيويّ يُقرأ FAIL لا PASS. وكلّ قراءة لصفوف جداولنا تمرّ عبر query_to_xml
--   بعد حارس to_regclass، كي يُبلّغ الملفّ عن نقص بدل أن ينهار بـ42P01.
--
-- ★ ماذا لا يحمل ★ الفحص العميق يزيد على هذه الستّة عشر بفحص الالتفاف غير
--   المباشر (رسم النداءات)، وبتفصيل كلّ صفّ على حدة. الملخّص لا يُخفي إخفاقًا:
--   كلّ ما هنا يحكم فعلًا، وما ليس هنا مذكور صراحةً في هذا السطر.
-- ════════════════════════════════════════════════════════════════════════════

with

-- ─── القوائم المتوقَّعة بالعقد ───────────────────────────────────────────────

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

factors_expected(k) as (values
  ('budget_range'),('organization_type'),('company_size'),('service_type'),
  ('locations_count'),('cities_count'),('urgency'),('desired_delivery_days'),
  ('data_completeness'),('lead_source'),('existing_client'),('retainer_potential'),
  ('annual_value_potential'),('production_complexity'),('territory'),
  ('strategic_sector'),('previous_lost_reason'),('response_behaviour')),

-- ★★ القائمة المغلقة لمفاتيح لوحة العميل ★★ نسخة طبق الأصل عن قائمة POSTCHECK
--   وعن الفحص الذاتيّ داخل RUNME (يُثبت تطابقها اختبارٌ ساكن في المستودع).
--   كلّ مبلغ هنا **سعر بيع** يُفوتَر على هذا العميل نفسه. لا تكلفة ولا هامش
--   ولا أرضية سعر ولا سعر مورّد — ولا رقمٌ يُطرح من آخر فيبلغ اقتصادًا داخليًّا.
client_keys(k) as (values
  ('ok'),('available'),('reason'),('message'),('client_id'),('subscriptions'),
  ('balances'),('requests'),('usage_ledger'),('excluded_by_design'),('note'),
  ('subscription_id'),('code'),('status'),('start_date'),('end_date'),('renewal_date'),
  ('package'),('terms'),('limitations'),('price_net'),('vat_rate'),('vat_amount'),
  ('price_gross'),('currency'),('allow_overage'),('overage_requires_approval'),
  ('unit_type'),('allocated'),('reserved'),('used'),('expired'),
  ('occurred_at'),('entry_type'),('quantity'),('usage_date'),('description'),
  ('overage_units'),('overage_amount_net'),('overage_vat_amount'),('overage_amount_gross'),
  ('id'),('units'),('credits_required'),('overage_estimate_units'),('city'),
  ('preferred_date'),('scheduled_date'),('decision_note')),

-- الحزم الستّ المطبَّقة على الإنتاج — يجب أن تبقى سليمة وغير ممسوسة.
-- ⚠️ عائلة الجداول ليست عائلة الدوالّ. الصيغة القديمة استعملت نمطًا واحدًا
--    للاثنين، فأعطت «22 جدولًا / 0 دالّة» للمالية: جداولها fin_* لكنّ دوالّها
--    الـ72 كلّها finops_* — و`finops_` لا يطابق `fin\_%` لأنّ بعد fin يأتي حرف
--    o لا شرطة سفلية. والعطل نفسه كان في مركز العمليات: جداوله ops_* ودوالّه
--    الـ46 prodops_*. أي أنّ الحزمتين كانتا تُقرآن «بلا دوالّ» وهما سليمتان.
--    ولذلك لا يُكتفى بعدٍّ إجماليّ هشّ: تُضاف دوالّ جوهرية **بالاسم والتوقيع**.
six(o, pkg, tbl_prefix, fn_prefix) as (values
  (1,'communications_hub',      'comms\_%', 'comms\_%'),
  (2,'operations_center',       'ops\_%',   'prodops\_%'),
  (3,'crm_sales_FOUNDATION',    'crm\_%',   'crm\_%'),
  (4,'finance_profitability',   'fin\_%',   'finops\_%'),
  (5,'commercial_subscriptions','csub\_%',  'csub\_%'),
  (6,'smart_quoting',           'sq\_%',    'sq\_%')),

-- دوالّ جوهرية تُفحص بالتوقيع الكامل: غيابُ واحدة إخفاق مهما بلغ العدّ الإجماليّ.
pkg_core(o, sig) as (values
  (1,'public.comms_health()'),   (1,'public.comms_can_view()'),
  (2,'public.prodops_access()'), (2,'public.prodops_lookups()'),
  (3,'public.crm_access()'),     (3,'public.crm_lookups()'),
  (4,'public.finops_access()'),  (4,'public.finops_lookups()'), (4,'public.finops_perm(text)'),
  (5,'public.csub_access()'),    (5,'public.csub_can_view()'),
  (6,'public.sq_tiers()'),       (6,'public.sq_perm(text)')),

-- ★ مجسّات التسريب ★ الحكم على **شكل القراءة** لا على الكلمة المجرّدة: الكلمة
--   المجرّدة أسقطت الترحيلة مرّة حين طابقت جملةَ عقدٍ تنفي الفعل. لكلّ سطح
--   مجسّاته التي كانت له في الفحص العميق، بلا توسيع يخلق إنذارًا كاذبًا.
--   kind='re' تعبير نمطيّ · kind='lit' نصّ حرفيّ داخل ilike.
leak_probes(fn, kind, pat) as (values
  ('lsr_dashboard_client','re','\m[a-z_][a-z_0-9]{0,62}\.internal_notes\M'),
  ('lsr_dashboard_client','re','\m[a-z_][a-z_0-9]{0,62}\.internal_metadata\M'),
  ('lsr_dashboard_client','re','\m[a-z_][a-z_0-9]{0,62}\.decision_reason\M'),
  ('lsr_dashboard_client','re',
     '\m[a-z_][a-z_0-9]{0,62}\.(base_cost|cost_rate|margin_pct|gross_profit|floor_price|supplier_rate)\M'),
  ('lsr_dashboard_client','re',
     '\m(from|join|into|update|table)\s+(only\s+)?(public\.)?(fin_costs|sq_quote_internal)\M'),
  -- ★ المِجَسّات المؤهَّلة (`r.` و`q.`) شكلٌ أصلًا فتبقى نصًّا حرفيًّا ★
  ('lsr_dashboard_operations','lit','r.price_net'),
  ('lsr_dashboard_operations','lit','r.vat_amount'),
  ('lsr_dashboard_operations','lit','r.overage_amount_net'),
  ('lsr_dashboard_operations','lit','r.price_gross'),
  ('lsr_dashboard_sales','lit','q.base_cost'),
  ('lsr_dashboard_sales','lit','q.margin_pct'),
  -- ★★ وهذه كانت **كلمات مجرّدة** وهي التي أنتجت الإخفاقين ★★
  --   'margin' طابقت عنصرًا في مصفوفة excluded_by_design — أي المصفوفة التي
  --   تُعلن أنّ الحقل **غير معروض**. و'sq_quote_internal' طابقت تعليقًا نصّه
  --   «تسكن sq_quote_internal ولا تُقرأ هنا إطلاقًا». إعلانُ الغياب قُرئ حضورًا.
  --   وهذه رابع مرّة يتكرّر فيها الصنف نفسه في هذا البرنامج: reser·VAT·ion ثمّ
  --   Zoho ثمّ floor_price داخل قائمة الاستبعاد ثمّ هذان. فالقاعدة نهائيًّا:
  --   **شكل قراءة أو شكل نداء، لا كلمة**. عنصرُ مصفوفةٍ وتعليقٌ لا يتّخذان
  --   أيًّا من الشكلين أبدًا؛ والقراءة الحقيقية والنداء الحقيقيّ يتّخذانهما دومًا.
  ('lsr_dashboard_operations','re','\m[a-z_][a-z_0-9]{0,62}\.(margin|margin_pct|gross_margin)\M'),
  ('lsr_dashboard_operations','re','\m[a-z_][a-z_0-9]{0,62}\.(cost_rate|base_cost|gross_profit|floor_price|supplier_rate)\M'),
  ('lsr_dashboard_sales','re','\msq_quote_internal\s*\('),
  ('lsr_dashboard_sales','re','\m(from|join|into|update|table)\s+(only\s+)?(public\.)?sq_quote_internal\M'),
  ('lsr_dashboard_sales','re','\m[a-z_][a-z_0-9]{0,62}\.(floor_at_request|internal_cost_estimate|margin|gross_margin)\M'),
  ('lsr_finance_reference','re',
     '\m[a-z]\.(price_net|price_gross|vat_rate|vat_amount|amount_net|amount_gross|renewal_amount_net|total_amount)\M')),

-- ─── التمريرات المثبَّتة ─────────────────────────────────────────────────────
--
-- ★ MATERIALIZED صريح ★ كلّ ما تحته يُشار إليه مرّات كثيرة أدناه، وكلفته
--   تمريرة على مصدر دالّة. PostgreSQL 12+ يُثبّت عادةً CTE متعدّد الإشارات،
--   لكنّ «عادةً» رهانٌ على المخطّط في ملفٍّ انقطع مرّتين. التثبيت اختيار صريح.

defs as materialized (
  select p.proname, pg_get_functiondef(p.oid) as d, p.prorettype
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%'),

-- الحكم البنيويّ على العقد: كتابة ماليّة · كتابة مشاريع · نداء خارجيّ ·
-- قراءة ماليّة ممنوعة. يقسم المصدر (كود / سلاسل) ثمّ يطابق **شكل الجملة**.
-- تمريرة واحدة لكلّ دالّة.
scan as materialized (
  select d.proname, public.lsr_contract_scan(d.d) as s
    from defs d
   where d.proname not in ('lsr_sql_partition','lsr_contract_scan',
                     'lsr_key_of','lsr_sql_literals','lsr_json_keys','lsr_client_scan')),

-- ★ تقسيمٌ واحد لكلّ دالّة ★ lsr_sql_partition حلقة تمشي المصدر حرفًا بحرف؛
--   استدعاؤها مرّتين على التعبير نفسه (مرّة لـcode ومرّة لـstrings) يضاعف
--   الكلفة بلا سبب. هنا تُستدعى مرّة، ويُقرأ المفتاحان من النتيجة نفسها.
bodies as materialized (
  select d.proname,
         coalesce(z.pp ->> 'code', '') as code,
         coalesce(z.pp ->> 'code', '') || chr(10) || coalesce(z.pp ->> 'strings', '') as body
    from defs d
    cross join lateral (select public.lsr_sql_partition(d.d) as pp) z),

-- لوحة العميل: ماذا تُصدِر من مفاتيح · هل تسكب صفًّا كاملًا · هل تقرأ بلا حصر.
client_scan(c) as materialized (
  select public.lsr_client_scan(d.d) from defs d where d.proname = 'lsr_dashboard_client'),
client_emitted(k) as materialized (
  select x.value #>> '{}' from client_scan
   cross join lateral jsonb_array_elements(c -> 'keys') as x(value)),

-- عدّ كائنات الحزم الستّ مرّة واحدة (مسحٌ على مستوى المخطّط بحكم السؤال نفسه:
-- الحزم المعنيّة ليست lsr_*؛ لكنّه مسح واحد لا أربعة وعشرون مسحًا مكرّرًا).
pkg_objects as materialized (
  select s.o, s.pkg,
         (select count(*) from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p')
             and c.relname like s.tbl_prefix) as tbls,
         (select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like s.fn_prefix) as fns,
         -- الدوالّ الجوهرية الغائبة بالاسم والتوقيع — لا يُغطّيها أيّ عدّ إجماليّ.
         (select coalesce(string_agg(pc.sig, ', ' order by pc.sig), '')
            from pkg_core pc
           where pc.o = s.o and to_regprocedure(pc.sig) is null) as missing_core
    from six s),

-- ⚠️ المطابقة على **الجسم المُقسَّم** لا على pg_get_functiondef الخام.
--    الخام يحوي التعليقات، وlsr_sql_partition يحذفها ويُبقي الشيفرة وحمولات
--    SQL الديناميكيّ — فيبقى النداء الحقيقيّ داخل execute مرئيًّا، ويسقط
--    التعليقُ من الحساب. وهذا وحده يُغلق إخفاق sq_quote_internal؛ أمّا
--    إخفاق margin فيُغلقه شكلُ المِجَسّ أعلاه لأنّ عنصر المصفوفة يبقى في
--    `strings` ولا يتّخذ شكل `alias.margin` أبدًا.
leaks as materialized (
  select lp.fn, lp.pat
    from leak_probes lp
    join bodies b on b.proname = lp.fn
   where (lp.kind = 're' and b.body ~* lp.pat)
      or (lp.kind = 'lit' and b.body ilike '%' || lp.pat || '%')),

results as (

-- ─── (١) اكتمال كائنات lsr_* ────────────────────────────────────────────────
select 1 as ord, 'البنية' as area, '(١) كائنات lsr_* كاملة' as check_name,
  case when (select count(*) from tables_expected te
              where to_regclass('public.' || te.t) is not null) = 13
        and (select count(*) from api_fns a
              where exists (select 1 from defs d where d.proname = a.f)) = 20
        and (select count(*) from internal_fns i
              where exists (select 1 from defs d where d.proname = i.f)) = 14
        and (select count(distinct pr.f) from predicates pr
               join defs d on d.proname = pr.f
              where d.prorettype = 'boolean'::regtype) = 11
       then 'PASS' else 'FAIL' end as verdict,
  (select count(*) from tables_expected te
    where to_regclass('public.' || te.t) is not null)::text || '/13 جدولًا · '
  || (select count(*) from api_fns a
       where exists (select 1 from defs d where d.proname = a.f))::text || '/20 دالّة سطح · '
  || (select count(*) from internal_fns i
       where exists (select 1 from defs d where d.proname = i.f))::text || '/14 نواة · '
  || (select count(distinct pr.f) from predicates pr
        join defs d on d.proname = pr.f
       where d.prorettype = 'boolean'::regtype)::text
  || '/11 مُسنَدًا يُرجع boolean. مُسنَد غير boolean يجعل RLS «غير محدَّد» لا «ممنوع».' as detail

-- ─── (٢) RLS والسياسات ──────────────────────────────────────────────────────
union all
select 2, 'البنية', '(٢) RLS مفعّل وسياساته صحيحة',
  case when (select count(*) from tables_expected te
               join pg_class c on c.relname = te.t
               join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
              where c.relrowsecurity) = 13
        and (select count(distinct p.tablename) from pg_policies p
               join tables_expected te on te.t = p.tablename
              where p.schemaname = 'public' and p.cmd in ('SELECT','ALL')) = 13
        and (select count(*) from pg_policies p
               join tables_expected te on te.t = p.tablename
              where p.schemaname = 'public' and p.cmd in ('INSERT','UPDATE','DELETE')) = 0
       then 'PASS' else 'FAIL' end,
  (select count(*) from tables_expected te
     join pg_class c on c.relname = te.t
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relrowsecurity)::text || '/13 جدولًا بـRLS · '
  || (select count(distinct p.tablename) from pg_policies p
        join tables_expected te on te.t = p.tablename
       where p.schemaname = 'public' and p.cmd in ('SELECT','ALL'))::text
  || '/13 له سياسة قراءة · '
  || (select count(*) from pg_policies p
        join tables_expected te on te.t = p.tablename
       where p.schemaname = 'public' and p.cmd in ('INSERT','UPDATE','DELETE'))::text
  || ' سياسة كتابة (المتوقَّع صفر: الكتابة عبر الدوالّ وحدها)'

-- ─── (٣) الصلاحيات ──────────────────────────────────────────────────────────
-- تُقرأ الـACL من الكتالوج (aclexplode / role_table_grants) ولا نستعمل
-- has_*_privilege باسم دور نصّيّ: تلك ترفع استثناءً إن غاب الدور فتُسقط الملفّ
-- كلّه بدل أن تُبلّغ. أداة الفحص لا يجوز أن تكون هشّة.
union all
select 3, 'الصلاحيات', '(٣) المنح صحيحة',
  case when (select count(*) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'lsr\_%'
                and p.proacl is null) = 0
        and (select count(*) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               cross join lateral aclexplode(p.proacl) a
               left join pg_roles r on r.oid = a.grantee
              where n.nspname = 'public' and p.proname like 'lsr\_%'
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or r.rolname = 'anon')) = 0
        and (select count(*) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
               join internal_fns i on i.f = p.proname
               cross join lateral aclexplode(p.proacl) a
               join pg_roles r on r.oid = a.grantee
              where n.nspname = 'public' and p.proname like 'lsr\_%'
                and a.privilege_type = 'EXECUTE' and r.rolname = 'authenticated') = 0
        and (select count(*) from information_schema.role_table_grants g
               join tables_expected te on te.t = g.table_name
              where g.table_schema = 'public' and g.grantee = 'authenticated'
                and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')) = 0
       then 'PASS' else 'FAIL' end,
  'لا EXECUTE لـanon ولا منحة افتراضية (proacl فارغ) · النوى الداخلية غير '
  || 'مكشوفة لـauthenticated · لا كتابة جدول مباشرة لـauthenticated. '
  || 'مكشوف افتراضيًّا: '
  || (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'lsr\_%' and p.proacl is null)::text
  || ' · نواة مكشوفة: '
  || (select count(distinct p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join internal_fns i on i.f = p.proname
        cross join lateral aclexplode(p.proacl) a
        join pg_roles r on r.oid = a.grantee
       where n.nspname = 'public' and p.proname like 'lsr\_%'
         and a.privilege_type = 'EXECUTE' and r.rolname = 'authenticated')::text
  || ' · منحة كتابة جدول: '
  || (select count(*) from information_schema.role_table_grants g
        join tables_expected te on te.t = g.table_name
       where g.table_schema = 'public' and g.grantee = 'authenticated'
         and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))::text

-- ─── (٤) لا كتابة ماليّة ────────────────────────────────────────────────────
union all
select 4, 'العقود', '(٤) لا كتابة ماليّة في أيّ دالّة',
  case when (select count(*) from scan where (s ->> 'finance_write')::boolean) = 0
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from scan where (s ->> 'finance_write')::boolean) = 0
       then 'قراءة فقط: لا فاتورة، ولا إنشاء ذمّة، ولا تعديل مبلغ، ولا تسجيل تحصيل'
       else '★ خرق ★ ' || (select string_agg(proname, ', ') from scan
                            where (s ->> 'finance_write')::boolean) end

-- ─── (٥) قراءات ماليّة مسموحة فقط ───────────────────────────────────────────
union all
select 5, 'العقود', '(٥) قراءات ماليّة مسموحة فقط',
  case when (select count(*) from scan where (s ->> 'forbidden_finance_read')::boolean) = 0
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from scan where (s ->> 'forbidden_finance_read')::boolean) = 0
       then 'المسموح: وجود الذمّة ومرجعها وحالتها واستحقاقها وحالة تحصيل عامّة، ووجود العميل، ووجود رصيد اشتراك، ووجود عرض معتمد، وقيم تصنيف غير ماليّة. ولا شيء غير ذلك.'
       else '★ قراءة ممنوعة (تكلفة/هامش/ربح/أرضية/سعر مورّد) ★ '
            || (select string_agg(proname, ', ') from scan
                 where (s ->> 'forbidden_finance_read')::boolean) end

-- ─── (٦) لا نداء خارجيّ ─────────────────────────────────────────────────────
union all
select 6, 'العقود', '(٦) لا نداء خارجيّ في أيّ دالّة',
  case when (select count(*) from scan where (s ->> 'external_call')::boolean) = 0
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from scan where (s ->> 'external_call')::boolean) = 0
       then 'لا Zoho، ولا HTTP، ولا pg_net، ولا dblink — بشكل النداء لا بالكلمة المجرّدة'
       else '★ خرق ★ ' || (select string_agg(proname, ', ') from scan
                            where (s ->> 'external_call')::boolean) end

-- ─── (٧) مركز الاتصالات: dry_run مثبَّت ─────────────────────────────────────
-- comms_enqueue **طابور داخليّ** لا نداء خارجيّ — وهذا التصنيف مشروط: dry_run
-- مثبَّت كتابةً، ولا مُستقبِل يحدّده المستدعي، ولا إرسال حيّ. إن سقط الشرط سقط
-- التصنيف، وصار الإدراج إرسالًا.
union all
select 7, 'الأحداث', '(٧) الاتّصالات مثبَّتة على dry_run',
  case when coalesce((select b.body
           ~* 'update\s+public\.comms_outbox\s+set\s+dry_run\s*=\s*true'
         from bodies b where b.proname = 'lsr_event_emit'), false)
        and coalesce((select b.body
           ~* 'comms_enqueue\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*null'
         from bodies b where b.proname = 'lsr_event_emit'), false)
        and coalesce((select d.d ilike '%dry_run = true%' from defs d
                       where d.proname = 'lsr_event_emit'), false)
        and exists (select 1 from pg_constraint
                     where conname = 'lsr_event_dry_run_only'
                       and conrelid = to_regclass('public.lsr_event_log'))
        and not coalesce((select d.d ilike '%comms_channels%' from defs d
                           where d.proname = 'lsr_event_emit'), true)
        and not exists (select 1 from bodies b
                         where b.code ~* '\m(comms_send|comms_relay|comms_dispatch|comms_process_outbox|notify_email_now)\s*\(')
       then 'PASS' else 'FAIL' end,
  'الإدراج يُتبَع بكتابة تُجبر dry_run · المُستقبِل يُمرَّر null (يحلّه المركز بقواعده) · '
  || 'قيد lsr_event_dry_run_only يمنع تسجيل «إرسال حقيقيّ» · لا تفعيل قناة · '
  || 'ولا نداء إرسال حيّ في أيّ دالّة من دوالّ الموديول'

-- ─── (٨) لا كتابة في منصّة المشاريع ─────────────────────────────────────────
union all
select 8, 'العقود', '(٨) لا كتابة في منصّة المشاريع',
  case when (select count(*) from scan where (s ->> 'project_write')::boolean) = 0
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from scan where (s ->> 'project_write')::boolean) = 0
       then 'لا إنشاء مشروع ولا تعديل مرحلة ولا تسليم — المنصّة مجمَّدة، ومسار CRM ينتهي عند «جاهز للتسليم اليدويّ»'
       else '★ خرق التجميد ★ ' || (select string_agg(proname, ', ') from scan
                                    where (s ->> 'project_write')::boolean) end

-- ─── (٩) القائمة المغلقة لمفاتيح لوحة العميل ────────────────────────────────
-- الفحص ١٢ يمنع أسماءً **نعرفها**؛ هذا يمنع كلّ ما لا نعرفه. نعدّ مفاتيح JSON
-- الخارجة فعلًا (من كلّ مستوى بناء) ونرفض ما ليس في القائمة، ونرفض كذلك مدخلًا
-- في القائمة لا يُصدَر — فالتمهيد المسبق تسريبٌ مؤجَّل.
union all
select 9, 'اللوحات', '(٩) لوحة العميل: قائمة ٤٩ مفتاحًا مغلقة',
  case when (select count(*) from client_keys) <> 49 then 'FAIL'
       when (select count(*) from client_emitted) < 30 then 'FAIL'
       when exists (select 1 from client_emitted e
                     where e.k not in (select k from client_keys)) then 'FAIL'
       when exists (select 1 from client_keys k
                     where k.k not in (select k from client_emitted)) then 'FAIL'
       else 'PASS' end,
  case when (select count(*) from client_keys) <> 49
       then '★ القائمة انحرفت ★ فيها ' || (select count(*) from client_keys)::text
            || ' مدخلًا لا ٤٩'
       when (select count(*) from client_emitted) < 30
       then '★ الفحص أجوف ★ عدد المفاتيح المقروءة '
            || (select count(*) from client_emitted)::text || ' — القارئ أو الدالّة مفقود'
       when exists (select 1 from client_emitted e
                     where e.k not in (select k from client_keys))
       then '★ تسريب ★ مفاتيح خارج القائمة: '
            || (select string_agg(e.k, ', ') from client_emitted e
                 where e.k not in (select k from client_keys))
       when exists (select 1 from client_keys k
                     where k.k not in (select k from client_emitted))
       then '★ تمهيد مسبق ★ القائمة تُجيز ما لا يُصدَر: '
            || (select string_agg(k.k, ', ') from client_keys k
                 where k.k not in (select k from client_emitted))
       else (select count(*) from client_emitted)::text
            || ' مفتاحًا، كلّها أسعار بيع تخصّ هذا العميل — لا تكلفة ولا هامش ولا أرضية' end

-- ─── (١٠) لا إسقاط JSON عريض ────────────────────────────────────────────────
union all
select 10, 'اللوحات', '(١٠) لوحة العميل بلا إسقاط عريض',
  case when coalesce((select (c ->> 'wide_projection')::boolean from client_scan), true)
       then 'FAIL' else 'PASS' end,
  case when coalesce((select (c ->> 'wide_projection')::boolean from client_scan), true)
       then '★ لقطة واسعة ★ to_jsonb/row_to_json/jsonb_agg لصفّ كامل — قائمة مفتوحة أي بلا قائمة'
       else 'كلّ حقل مسمّى صراحةً؛ والقراءة الفرعية المسمّى إسقاطها الخارجيّ مقبولة' end

-- ─── (١١) عزل العميل بهُويّته ───────────────────────────────────────────────
union all
select 11, 'اللوحات', '(١١) كلّ قراءة محصورة بهُويّة العميل',
  case when coalesce((select (c ->> 'unscoped_query')::boolean from client_scan), true)
       then 'FAIL'
       when not coalesce((select d.d ilike '%my_client_id%' from defs d
                           where d.proname = 'lsr_dashboard_client'), false)
       then 'FAIL' else 'PASS' end,
  case when coalesce((select (c ->> 'unscoped_query')::boolean from client_scan), true)
       then '★ قراءة عابرة للعملاء ★ '
            || coalesce((select c ->> 'unscoped_sample' from client_scan), 'الكاشف أو الدالّة مفقود')
       when not coalesce((select d.d ilike '%my_client_id%' from defs d
                           where d.proname = 'lsr_dashboard_client'), false)
       then '★ بلا حصر ★ لوحة العميل لا تذكر my_client_id — تصير قراءة لبيانات عملاء آخرين'
       else 'كلّ قراءة لجدول مملوك للعميل تحمل client_id = $1 من my_client_id() وحده' end

-- ─── (١٢) لا تكلفة ولا هامش ولا ربح ولا أرضية سعر ──────────────────────────
union all
select 12, 'اللوحات', '(١٢) لا تكلفة ولا هامش ولا ربح ولا أرضية سعر',
  case when (select count(*) from leaks) = 0
        and not exists (select 1 from bodies b
                         where b.proname in ('lsr_context','lsr_score_core',
                                             'lsr_rule_matches','lsr_route_core')
                           and b.body ~* '\m(public\.)?(fin_|finops_|sq_quotes|sq_quote_internal|csub_subscriptions)')
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from leaks) > 0
       then '★ تسريب ★ ' || (select string_agg(distinct fn || ' ← ' || pat, ' · ') from leaks)
       when exists (select 1 from bodies b
                     where b.proname in ('lsr_context','lsr_score_core',
                                         'lsr_rule_matches','lsr_route_core')
                       and b.body ~* '\m(public\.)?(fin_|finops_|sq_quotes|sq_quote_internal|csub_subscriptions)')
       then '★ مدخل ماليّ في محرّك القرار ★ '
            || (select string_agg(b.proname, ', ') from bodies b
                 where b.proname in ('lsr_context','lsr_score_core',
                                     'lsr_rule_matches','lsr_route_core')
                   and b.body ~* '\m(public\.)?(fin_|finops_|sq_quotes|sq_quote_internal|csub_subscriptions)')
       else 'لا رقم داخليّ في أيّ سطح، ولا مبلغ في المرجع الماليّ، ولا مدخل ماليّ في محرّك القرار — فلا سعرٌ ولا هامشٌ يُستنتَج من الدرجة أو من رمز السبب' end

-- ─── (١٣) التقييم مُفسَّر ───────────────────────────────────────────────────
union all
select 13, 'التقييم', '(١٣) التقييم مُفسَّر وقابل لإعادة الإنتاج',
  case when to_regclass('public.lsr_rulesets') is null
         or to_regclass('public.lsr_rules') is null
         or to_regclass('public.lsr_factors') is null then 'FAIL'
       when (select count(*) from (values ('components'),('positive_factors'),('negative_factors'),
                    ('missing_information'),('recommended_next_action'),('review_required'),
                    ('ruleset_version'),('grade_thresholds'),('explain')) v(k)
               join defs d on d.proname = 'lsr_score_core'
              where d.d ilike '%' || v.k || '%') <> 9 then 'FAIL'
       when not exists (select 1 from pg_trigger where tgname = 'lsr_rules_frozen_trg'
                          and tgrelid = to_regclass('public.lsr_rules')) then 'FAIL'
       when coalesce((select d.d ~* '(random|tablesample)' from defs d
                       where d.proname = 'lsr_route_core'), true) then 'FAIL'
       when (select count(*) from pg_constraint
              where conrelid = to_regclass('public.lsr_score_manual')
                and conname in ('lsr_manual_adjust_reason',
                                'lsr_manual_override_reason')) <> 2 then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_rulesets where status = ''published''',
              false, true, '')))[1]::text::int, 0) <> 1 then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_factors where is_active and key in ('
              || (select string_agg(quote_literal(fe.k), ',') from factors_expected fe) || ')',
              false, true, '')))[1]::text::int, 0) <> 18 then 'FAIL'
       when coalesce((xpath('/row/c/text()', query_to_xml(
              'select count(*) as c from public.lsr_rules ru
                 join public.lsr_rulesets rs on rs.version = ru.ruleset_version
                where rs.status = ''published'' and ru.is_active',
              false, true, '')))[1]::text::int, 0) < 20 then 'FAIL'
       else 'PASS' end,
  'تسعة مخرَجات تفسير في lsr_score_core · مُشغِّل تجميد القواعد المنشورة · '
  || 'لا random ولا tablesample في التوزيع · قيدان يشترطان سببًا لكلّ تعديل يدويّ · '
  || 'مجموعة قواعد منشورة واحدة بالضبط · العوامل الثمانية عشر فعّالة في الكتالوج · '
  || 'وعشرون قاعدة فعّالة على الأقلّ. مجموعة بلا قواعد تُنتج صفرًا لكلّ عميل، وهذا كذب لا تقييم.'

-- ─── (١٤) العميل غير القابل للتواصل يُحتجَز ────────────────────────────────
union all
select 14, 'التوزيع', '(١٤) العميل المجهول يُحتجَز لا يُوزَّع',
  case when coalesce((select d.d ilike '%anonymous_no_contact_channel%' from defs d
                       where d.proname = 'lsr_score_core'), false)
        and coalesce((select d.d ilike '%lsr_review_queue%' from defs d
                       where d.proname = 'lsr_assign'), false)
        and exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'lsr_review_queue'
                       and indexdef ilike '%unique%' and indexdef ilike '%lead_id%')
       then 'PASS' else 'FAIL' end,
  'بلا قناة تواصل: سبب مراجعة معلن، ثمّ احتجاز في طابور المراجعة بصفّ واحد لا يتكرّر — لا إسناد إلى مندوب لعميل لا يمكن التواصل معه'

-- ─── (١٥) عدم التكرار ───────────────────────────────────────────────────────
union all
select 15, 'الأحداث', '(١٥) عدم التكرار مضمون بصفّ فريد',
  case when exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'lsr_event_log'
                       and indexdef ilike '%unique%' and indexdef ilike '%idempotency_key%')
        and exists (select 1 from pg_indexes
                     where schemaname = 'public' and tablename = 'lsr_review_queue'
                       and indexdef ilike '%unique%' and indexdef ilike '%pending%')
        and coalesce((select d.d ilike '%idempotency%' from defs d
                       where d.proname = 'lsr_event_emit'), false)
       then 'PASS' else 'FAIL' end,
  'الحارس صفّ فريد لا نيّة حسنة: حدث واحد لا يُدرَج مرّتين ولو أُعيدت المحاولة، وعميل واحد لا يفتح صفّي مراجعة متزامنين'

-- ─── (١٦) الحزم الستّ السابقة سليمة ────────────────────────────────────────
union all
select 16, 'الحزم القائمة', '(١٦) الحزم الستّ المطبَّقة سليمة',
  case when (select count(*) from pkg_objects where tbls > 0 and fns > 0) = 6
        and (select count(*) from pkg_objects where missing_core <> '') = 0
       then 'PASS' else 'FAIL' end,
  case when (select count(*) from pkg_objects where tbls = 0 or fns = 0) > 0
       then '★ حزمة بلا كائنات ★ '
            || (select string_agg(po.pkg || ' (' || po.tbls::text || ' جدولًا/' || po.fns::text || ' دالّة)',
                                  ' · ' order by po.o)
                  from pkg_objects po where po.tbls = 0 or po.fns = 0)
       when (select count(*) from pkg_objects where missing_core <> '') > 0
       then '★ دالّة جوهرية غائبة ★ '
            || (select string_agg(po.pkg || ' ← ' || po.missing_core, ' · ' order by po.o)
                  from pkg_objects po where po.missing_core <> '')
       else (select string_agg(po.pkg || ': ' || po.tbls::text || ' جدولًا/' || po.fns::text || ' دالّة',
                               ' · ' order by po.o) from pkg_objects po)
            || ' — وكلّ دالّة جوهرية حاضرة بتوقيعها. حزمة التقييم لا تُنشئ ولا تُعدّل ولا تُسقط شيئًا خارج lsr_*'
       end
)

select verdict, area, check_name, detail
  from (
    select 0 as ord, 'الخلاصة' as area, 'نتيجة الفحص' as check_name,
           case when exists (select 1 from results where verdict = 'FAIL') then 'FAIL' else 'PASS' end as verdict,
           case when exists (select 1 from results where verdict = 'FAIL')
                then '★ عدد الإخفاقات: ' || (select count(*)::text from results where verdict = 'FAIL')
                     || ' من ١٦ ★ اقرأ صفوف FAIL أدناه قبل أيّ استعمال. '
                     || 'الفحص العميق docs/lead_scoring_routing_POSTCHECK.sql يفصّل السبب عبر اتّصال psql مباشر.'
                else 'الفحوص الستّة عشر مرّت. الحدود المعروفة في docs/COMMERCIAL_GROWTH_V1_LIMITATIONS.md'
           end as detail
    union all select ord, area, check_name, verdict, detail from results) x
 order by (case verdict when 'FAIL' then 0 when 'PASS' then 1 else 2 end), ord;
