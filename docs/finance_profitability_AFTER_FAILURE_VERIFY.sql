-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_AFTER_FAILURE_VERIFY.sql
--                                    (READ-ONLY · ONE RESULT SET · لا يكتب شيئًا)
--
-- لماذا هذا الملفّ موجود
-- ──────────────────────
-- تشغيلٌ سابق لـ finance_profitability_RUNME.sql سقط **قبل COMMIT** على
-- تأكيد داخليّ في §9:
--     FIN SELF-TEST: public.finops_can_manage() لا تنحدر من البوّابة الحسّاسة
-- الحزمة معاملة واحدة (begin … commit) وليس فيها CONCURRENTLY، فالمفترض أنّ
-- كلّ شيء تراجع. «المفترض» ليست دليلًا. هذا الملفّ يقرأ الحالة الحيّة ويقول
-- بالأرقام: هل بقي أثر؟ وهل الحزم الثلاث المطبَّقة سليمة؟
--
-- قواعد هذا الملفّ
-- ────────────────
--   • SELECT صِرف. لا CREATE ولا INSERT ولا UPDATE ولا DELETE ولا حتى TEMP.
--   • **نتيجة واحدة**: استعلام واحد يعيد صفوفًا، ولا شيء غيره.
--   • آمن من محرّر SQL حيث auth.uid() = NULL: **لا يُستدعى أيّ RPC محميّ**،
--     ولا حتى مُسنَد — كلّ ما هنا قراءة كتالوج. فلا يموت فحصٌ على بوّابته.
--   • كلّ صفّ يحمل observed وexpected وverdict، فلا «يبدو أنّه نجح».
--
-- القراءة: كلّ صفّ verdict = 'OK'. أيّ 'CHECK' واحد ⇒ لا تُعِد تشغيل RUNME
-- قبل معرفة سببه. الصفّ الأخير (Z · overall) هو الحكم المجمَّع.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── أسماء الحزم الثلاث المطبَّقة — قائمة صريحة لا نمط ───────────────────
-- allowlist حقيقيّ: لو حُذف جدول من هذه القائمة ظهر بـ verdict = 'CHECK'.
-- لا نعدّ «كم جدولًا يبدأ بـ comms_» — عدٌّ كهذا يمرّ بعد حذف جدول وإضافة آخر.
comms_expected(t) as (values
  ('comms_audit'),('comms_channels'),('comms_event_catalog'),('comms_outbox'),
  ('comms_preferences'),('comms_rate_counters'),('comms_templates')),
ops_expected(t) as (values
  ('ops_audit'),('ops_call_sheets'),('ops_daily_reports'),('ops_delays'),('ops_incidents'),
  ('ops_ingest_jobs'),('ops_job_accommodation'),('ops_job_crew'),('ops_job_equipment'),
  ('ops_job_hse'),('ops_job_permits'),('ops_job_travel'),('ops_job_vehicles'),
  ('ops_job_weather'),('ops_jobs'),('ops_locations'),('ops_media_backups'),
  ('ops_media_cards'),('ops_post_handoff'),('ops_vehicles')),
crm_expected(t) as (values
  ('crm_settings'),('crm_teams'),('crm_team_members'),('crm_companies'),('crm_contacts'),
  ('crm_competitors'),('crm_lead_score_rules'),('crm_leads'),('crm_pipelines'),('crm_stages'),
  ('crm_opportunities'),('crm_stage_history'),('crm_activities'),('crm_targets'),
  ('crm_commission_plans'),('crm_commission_assignments'),('crm_commission_records'),
  ('crm_import_batches'),('crm_audit'),('crm_approval_requests')),
applied(pkg, t) as (
  select 'communications_hub', t from comms_expected
  union all select 'operations_center', t from ops_expected
  union all select 'crm_sales_foundation', t from crm_expected),

-- ─── ما كانت الحزمة المالية ستُنشئه — القائمة الكاملة، مكتوبة لا مُخمَّنة ─
fin_expected_table(t) as (values
  ('fin_cost_centers'),('fin_expense_categories'),('fin_suppliers'),('fin_budgets'),
  ('fin_budget_lines'),('fin_contracts'),('fin_revenue'),('fin_retainers'),('fin_receivables'),
  ('fin_collections'),('fin_payment_milestones'),('fin_approval_thresholds'),
  ('fin_expense_requests'),('fin_expense_approvals'),('fin_purchase_requests'),
  ('fin_purchase_request_items'),('fin_purchase_orders'),('fin_purchase_order_items'),
  ('fin_costs'),('fin_attachments'),('fin_audit'),('fin_zoho_outbox')),

-- ─── القياسات ────────────────────────────────────────────────────────────
m_fin_tables as (
  select count(*)::bigint n from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind in ('r','p')
     and c.relname in (select t from fin_expected_table)),
m_fin_any_table as (
  select count(*)::bigint n from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'fin\_%'),
m_finops_fns as (
  select count(*)::bigint n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname like 'finops\_%'),
m_fin_seq as (
  select count(*)::bigint n from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind = 'S' and c.relname = 'fin_doc_seq'),
m_fin_policies as (
  select count(*)::bigint n from pg_policies
   where schemaname = 'public' and tablename like 'fin\_%'),
m_fin_indexes as (
  select count(*)::bigint n from pg_indexes
   where schemaname = 'public' and (indexname like 'ix\_fin\_%' or indexname like 'uq\_fin\_%')),
m_fin_views as (
  select count(*)::bigint n from pg_views where schemaname = 'public' and viewname like 'fin\_%'),
m_fin_fk as (
  select count(*)::bigint n from pg_constraint where conname like 'fin\_%\_project\_fk'),
-- كتالوج الصلاحيات موجود على الإنتاج (PREFLIGHT §5 يقرؤه)؛ يُقرأ مباشرةً
-- بلا CASE، لأنّ فرعًا غير منفَّذ في CASE يُحلَّل مع ذلك ولن يحمي من غياب جدول.
m_perm_keys as (
  select count(*)::bigint as n from public.permissions where key like 'finance\_ops.%'),
m_perm_legacy as (
  select count(*)::bigint as n from public.permissions where key like 'finance.%'),

-- الحزم المطبَّقة: الجدول موجود **و**RLS مفعّلة. الوجود وحده ليس سلامة.
-- LEFT JOIN لا استعلام فرعيّ داخل FILTER — أنظف وأوسع توافقًا.
live_tables as (
  select c.relname::text as relname, c.relrowsecurity
    from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'public' and c.relkind in ('r','p')),
m_applied as (
  select a.pkg,
         count(lt.relname)::bigint as present,
         count(*)::bigint          as expected,
         count(*) filter (where coalesce(lt.relrowsecurity, false))::bigint as with_rls
    from applied a left join live_tables lt on lt.relname = a.t
   group by a.pkg),
m_applied_fns as (
  select 'communications_hub' as pkg, count(*)::bigint n from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname like 'comms\_%'
  union all
  select 'operations_center', count(*)::bigint from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname like 'ops\_%'
  union all
  select 'crm_sales_foundation', count(*)::bigint from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname like 'crm\_%'),

-- منصّة المشاريع: لقطة تُقارَن بما سجّلته PREFLIGHT §6.
m_frozen as (
  select (select count(*)::bigint from pg_policies where schemaname = 'public'
           and tablename in ('projects','project_core','deliverables','deliverable_internal',
                             'project_transition_requests')) as policies,
         (select count(*)::bigint from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
           where n2.nspname = 'public'
             and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as fns,
         (select count(*)::bigint from information_schema.columns
           where table_schema = 'public' and table_name = 'projects') as project_cols),

-- ─── الصفوف ──────────────────────────────────────────────────────────────
rows_out(sort_order, section, item, observed, expected, verdict) as (

  -- A) لا أثر جزئيّ من المحاولة الساقطة
  select 10, 'A · لا أثر جزئيّ', 'fin_* tables (القائمة المتوقّعة)',
         (select n::text from m_fin_tables), '0',
         case when (select n from m_fin_tables) = 0 then 'OK' else 'CHECK' end
  union all
  select 11, 'A · لا أثر جزئيّ', 'أيّ جدول باسم fin_* (نمط أوسع)',
         (select n::text from m_fin_any_table), '0',
         case when (select n from m_fin_any_table) = 0 then 'OK' else 'CHECK' end
  union all
  select 12, 'A · لا أثر جزئيّ', 'دوالّ finops_*',
         (select n::text from m_finops_fns), '0',
         case when (select n from m_finops_fns) = 0 then 'OK' else 'CHECK' end
  union all
  select 13, 'A · لا أثر جزئيّ', 'المتسلسلة fin_doc_seq',
         (select n::text from m_fin_seq), '0',
         case when (select n from m_fin_seq) = 0 then 'OK' else 'CHECK' end
  union all
  select 14, 'A · لا أثر جزئيّ', 'سياسات RLS على fin_*',
         (select n::text from m_fin_policies), '0',
         case when (select n from m_fin_policies) = 0 then 'OK' else 'CHECK' end
  union all
  select 15, 'A · لا أثر جزئيّ', 'فهارس ix_fin_* / uq_fin_*',
         (select n::text from m_fin_indexes), '0',
         case when (select n from m_fin_indexes) = 0 then 'OK' else 'CHECK' end
  union all
  select 16, 'A · لا أثر جزئيّ', 'عروض fin_*',
         (select n::text from m_fin_views), '0',
         case when (select n from m_fin_views) = 0 then 'OK' else 'CHECK' end
  union all
  select 17, 'A · لا أثر جزئيّ', 'مفاتيح خارجية fin_*_project_fk',
         (select n::text from m_fin_fk), '0',
         case when (select n from m_fin_fk) = 0 then 'OK' else 'CHECK' end
  union all
  select 18, 'A · لا أثر جزئيّ', 'مفاتيح صلاحيات finance_ops.* في الكتالوج',
         (select n::text from m_perm_keys), '0',
         case when (select n from m_perm_keys) = 0 then 'OK' else 'CHECK' end

  -- B) «نصف مطبَّقة» مستحيلة: إمّا صفر وإمّا الاثنان والعشرون كاملة
  union all
  select 20, 'B · لا تطبيق نصفيّ', 'كلّ-أو-لا-شيء (جداول + دوالّ + متسلسلة)',
         (select n from m_fin_tables)::text || ' جدول · '
           || (select n from m_finops_fns)::text || ' دالّة · '
           || (select n from m_fin_seq)::text || ' متسلسلة',
         '0 · 0 · 0  (أو 22 · 44+ · 1 بعد تشغيل ناجح)',
         case when (select n from m_fin_tables) = 0
               and (select n from m_finops_fns) = 0
               and (select n from m_fin_seq) = 0 then 'OK'
              when (select n from m_fin_tables) = (select count(*) from fin_expected_table)
               and (select n from m_finops_fns) > 40
               and (select n from m_fin_seq) = 1 then 'APPLIED'
              else 'CHECK' end
  union all
  select 21, 'B · لا تطبيق نصفيّ', 'مفاتيح finance.* القائمة (لم تُلمَس)',
         (select n::text from m_perm_legacy),
         'قارنه بيدك بما سجّلته PREFLIGHT §5 — لا رقم ثابت يصحّ هنا',
         'INFO'

  -- C) الحزم الثلاث المطبَّقة سليمة
  union all
  select 30, 'C · الحزم المطبَّقة', 'communications_hub — جداول موجودة',
         (select present::text from m_applied where pkg = 'communications_hub'),
         (select expected::text from m_applied where pkg = 'communications_hub'),
         case when (select present from m_applied where pkg = 'communications_hub')
                 = (select expected from m_applied where pkg = 'communications_hub')
              then 'OK' else 'CHECK' end
  union all
  select 31, 'C · الحزم المطبَّقة', 'communications_hub — RLS مفعّلة على كلّها',
         (select with_rls::text from m_applied where pkg = 'communications_hub'),
         (select expected::text from m_applied where pkg = 'communications_hub'),
         case when (select with_rls from m_applied where pkg = 'communications_hub')
                 = (select expected from m_applied where pkg = 'communications_hub')
              then 'OK' else 'CHECK' end
  union all
  select 32, 'C · الحزم المطبَّقة', 'communications_hub — دوالّ comms_*',
         (select n::text from m_applied_fns where pkg = 'communications_hub'), '> 0',
         case when (select n from m_applied_fns where pkg = 'communications_hub') > 0
              then 'OK' else 'CHECK' end
  union all
  select 33, 'C · الحزم المطبَّقة', 'operations_center — جداول موجودة',
         (select present::text from m_applied where pkg = 'operations_center'),
         (select expected::text from m_applied where pkg = 'operations_center'),
         case when (select present from m_applied where pkg = 'operations_center')
                 = (select expected from m_applied where pkg = 'operations_center')
              then 'OK' else 'CHECK' end
  union all
  select 34, 'C · الحزم المطبَّقة', 'operations_center — RLS مفعّلة على كلّها',
         (select with_rls::text from m_applied where pkg = 'operations_center'),
         (select expected::text from m_applied where pkg = 'operations_center'),
         case when (select with_rls from m_applied where pkg = 'operations_center')
                 = (select expected from m_applied where pkg = 'operations_center')
              then 'OK' else 'CHECK' end
  union all
  select 35, 'C · الحزم المطبَّقة', 'operations_center — دوالّ ops_*',
         (select n::text from m_applied_fns where pkg = 'operations_center'), '> 0',
         case when (select n from m_applied_fns where pkg = 'operations_center') > 0
              then 'OK' else 'CHECK' end
  union all
  select 36, 'C · الحزم المطبَّقة', 'crm_sales_foundation — جداول موجودة',
         (select present::text from m_applied where pkg = 'crm_sales_foundation'),
         (select expected::text from m_applied where pkg = 'crm_sales_foundation'),
         case when (select present from m_applied where pkg = 'crm_sales_foundation')
                 = (select expected from m_applied where pkg = 'crm_sales_foundation')
              then 'OK' else 'CHECK' end
  union all
  select 37, 'C · الحزم المطبَّقة', 'crm_sales_foundation — RLS مفعّلة على كلّها',
         (select with_rls::text from m_applied where pkg = 'crm_sales_foundation'),
         (select expected::text from m_applied where pkg = 'crm_sales_foundation'),
         case when (select with_rls from m_applied where pkg = 'crm_sales_foundation')
                 = (select expected from m_applied where pkg = 'crm_sales_foundation')
              then 'OK' else 'CHECK' end
  union all
  select 38, 'C · الحزم المطبَّقة', 'crm_sales_foundation — دوالّ crm_*',
         (select n::text from m_applied_fns where pkg = 'crm_sales_foundation'), '> 0',
         case when (select n from m_applied_fns where pkg = 'crm_sales_foundation') > 0
              then 'OK' else 'CHECK' end

  -- D) منصّة المشاريع المجمَّدة — قارن بـ PREFLIGHT §6
  union all
  select 40, 'D · التجميد', 'سياسات · دوالّ · أعمدة projects',
         (select policies from m_frozen)::text || ' · '
           || (select fns from m_frozen)::text || ' · '
           || (select project_cols from m_frozen)::text,
         'مطابق تمامًا لما سجّلته PREFLIGHT §6',
         case when (select project_cols from m_frozen) > 0 then 'OK' else 'CHECK' end

  -- E) المِجَسّ ليس أجوف: لو لم يرَ الاستعلام أيّ جدول في public لكان
  --    كلّ صفر أعلاه بلا معنى.
  union all
  select 50, 'E · لا-فراغ', 'جداول public المرئية للمِجَسّ',
         (select count(*)::text from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
           where n2.nspname = 'public' and c.relkind in ('r','p')),
         '> 50 — لو كانت صفرًا فالمِجَسّ مكسور لا القاعدة نظيفة',
         case when (select count(*) from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
                     where n2.nspname = 'public' and c.relkind in ('r','p')) > 50
              then 'OK' else 'CHECK' end
)

select r.sort_order, r.section, r.item, r.observed, r.expected, r.verdict
from rows_out r
union all
select 999, 'Z · الحكم', 'إجمالي الصفوف التي تحتاج نظرًا',
       (select count(*)::text from rows_out where verdict = 'CHECK'), '0',
       case when (select count(*) from rows_out where verdict = 'CHECK') = 0
            then 'OK — لا أثر جزئيّ، والحزم الثلاث سليمة. أعِد تشغيل RUNME بعد الإصلاح.'
            else 'CHECK — اقرأ كلّ صفّ verdict = CHECK قبل أيّ إعادة تشغيل' end
order by 1;
