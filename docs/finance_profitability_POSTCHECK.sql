-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_POSTCHECK.sql                 (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد finance_profitability_RUNME.sql. كلّ استعلام SELECT صِرف.
-- كلّ قسم مكتوب بحيث تكون النتيجة المتوقّعة صريحة: لا «يبدو أنّه نجح».
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجداول الاثنان والعشرون موجودة وRLS مفعّلة ───────────────────────
-- متوقّع: 22 صفًّا، present = true وrls = true وhas_policy = true في كلّها.
select t.name,
       (to_regclass('public.' || t.name) is not null) as present,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.name), false) as rls,
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.name) as has_policy
from (values ('fin_cost_centers'),('fin_expense_categories'),('fin_suppliers'),('fin_budgets'),
             ('fin_budget_lines'),('fin_contracts'),('fin_revenue'),('fin_retainers'),
             ('fin_receivables'),('fin_collections'),('fin_payment_milestones'),
             ('fin_approval_thresholds'),('fin_expense_requests'),('fin_expense_approvals'),
             ('fin_purchase_requests'),('fin_purchase_request_items'),('fin_purchase_orders'),
             ('fin_purchase_order_items'),('fin_costs'),('fin_attachments'),('fin_audit'),
             ('fin_zoho_outbox')) t(name);

-- ─── 2) لا سياسة كتابة مباشرة على أيّ جدول ────────────────────────────────
-- متوقّع: صفر صفّ. أيّ صفّ هنا يعني أنّ الكتابة تتجاوز الـRPC.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename like 'fin\_%' and cmd <> 'SELECT';

-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ────────────────────────
-- متوقّع: صفر صفّ في كليهما.
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'fin\_%' and grantee = 'anon';

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'finops%'
  and exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ─── 4) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت ─────────────
-- متوقّع: كلّ الصفوف security_definer = true وpinned_search_path = true.
select p.proname, p.prosecdef as security_definer,
       (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'finops%'
order by p.proname;

-- ─── 5) الدوالّ الداخلية لا تُنفَّذ من الواجهة ────────────────────────────
-- متوقّع: false في كلّ صفّ. finops_profit_core خصوصًا: منحها = تسريب الهامش.
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_exec
from (values ('public.finops_profit_core(uuid,date,date)'),
             ('public.finops_variance_core(uuid)'),
             ('public.finops_receivable_state(uuid)'),
             ('public.finops_contract_state(uuid)'),
             ('public.finops_money(jsonb,numeric)'),
             ('public.finops_threshold_for(text,numeric,uuid,uuid)'),
             ('public.finops_log(text,text,uuid,jsonb)'),
             ('public.finops_project_label(uuid)'),
             ('public.finops_next_code(text)')) f(sig)
where to_regprocedure(f.sig) is not null;

-- ─── 6) المُسنَدات لا تعيد NULL (تشغيل بدور postgres ⇒ auth.uid() = NULL) ─
-- متوقّع: صفّ واحد، كلّ الأعمدة = false (ولا واحد NULL).
select public.finops_can_view()               as can_view,
       public.finops_can_manage()             as can_manage,
       public.finops_can_approve()            as can_approve,
       public.finops_can_view_profit()        as can_view_profit,
       public.finops_can_manage_receivables() as can_manage_receivables,
       public.finops_can_export()             as can_export,
       public.finops_can_request()            as can_request,
       public.finops_is_client()              as is_client,
       public.finops_is_finance_role()        as is_finance_role,
       public.finops_perm('finance_ops.view') as perm;

-- ─── 7) مِجَسّ الكشف يعمل ويُعلن انعدام القدرة بدل التظاهر ────────────────
-- متوقّع: ok = true وauthenticated = false وكلّ القدرات false.
select public.finops_access() as access_probe;

-- ─── 8) ★ عقد الضريبة ★ — حقل مستقلّ وإجمالي مولَّد في كلّ جدول ماليّ ────
-- متوقّع: 11 صفًّا، has_vat_column = true وgross_is_generated = true وfolded_total = false.
select t.name,
  exists (select 1 from information_schema.columns c
           where c.table_schema='public' and c.table_name=t.name and c.column_name='vat_amount') as has_vat_column,
  exists (select 1 from information_schema.columns c
           where c.table_schema='public' and c.table_name=t.name
             and c.column_name='amount_gross' and c.is_generated='ALWAYS') as gross_is_generated,
  exists (select 1 from information_schema.columns c
           where c.table_schema='public' and c.table_name=t.name
             and c.column_name in ('total','amount_total','grand_total')) as folded_total
from (values ('fin_budget_lines'),('fin_contracts'),('fin_revenue'),('fin_retainers'),
             ('fin_receivables'),('fin_collections'),('fin_payment_milestones'),
             ('fin_expense_requests'),('fin_purchase_requests'),('fin_purchase_orders'),
             ('fin_costs')) t(name);

-- متوقّع: صفّ واحد، vat_amount = 15 وamount_gross = 115.
select public.finops_money('{"amount_net":"100","vat_rate":"15"}'::jsonb, 15) as vat_math;

-- ─── 9) ★ ما هو مشتقّ لم يُخزَّن ★ ───────────────────────────────────────
-- متوقّع: صفر صفّ. أيّ عمود هنا يعني رقمًا يستطيع أن ينحرف عن الواقع.
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'fin_receivables'
        and column_name in ('collection_status','collected_amount','outstanding','days_overdue','is_overdue'))
    or (table_name = 'fin_contracts'
        and column_name in ('remaining_balance','invoiced_amount','collected_amount')));

-- متوقّع: reason = row_not_found (صدق في الإبلاغ لا صفر صامت).
select public.finops_receivable_state('00000000-0000-0000-0000-000000000000') as recv_state_probe;

-- متوقّع: basis = net_of_vat وis_estimate = true.
select public.finops_profit_core(null, null, null) as profit_probe;

-- ─── 10) ★ بوّابة الهامش أضيق من بوّابة المركز ★ ─────────────────────────
-- متوقّع: 3 صفوف، uses_profit_gate = true (fin_revenue · fin_contracts · fin_retainers).
select tablename, policyname, (qual ilike '%finops_can_view_profit%') as uses_profit_gate
from pg_policies
where schemaname = 'public' and tablename in ('fin_revenue','fin_contracts','fin_retainers');

-- متوقّع: صفّان، allows_own_row = true (الموظّف يرى طلبه هو فقط).
select tablename, policyname, (qual ilike '%requested_by = auth.uid()%') as allows_own_row
from pg_policies
where schemaname = 'public' and tablename in ('fin_expense_requests','fin_purchase_requests');

-- ─── 11) حدود الاعتماد وفصل المهامّ ──────────────────────────────────────
-- متوقّع: required_role = owner (لا سياسة مضبوطة بعد ⇒ الافتراض الأشدّ).
select public.finops_threshold_for('expense', 999999, null, null) as unmatched_threshold;

-- متوقّع: true في العمودين.
select
  (pg_get_functiondef(to_regprocedure('public.finops_expense_decide(uuid,text,text)'))
     ilike '%self_approval_forbidden%') as blocks_self_approval,
  (pg_get_functiondef(to_regprocedure('public.finops_threshold_upsert(jsonb)'))
     ilike '%is_owner()%') as thresholds_owner_only;

-- ─── 12) مفاتيح الصلاحيات دخلت الكتالوج القائم (إن كان مطبَّقًا) ──────────
-- متوقّع: 7 صفوف finance_ops.* إن كان جدول permissions موجودًا، وإلّا صفر.
select key, category, sensitivity from public.permissions
where key like 'finance_ops.%' order by sort_order;

-- متوقّع: مطابق تمامًا لما سجّلته في PREFLIGHT §5 — الحزمة لم تعدّل مفتاحًا قائمًا.
select key, category, sensitivity, sort_order from public.permissions
where key like 'finance.%' order by sort_order;

-- ─── 13) ★ صدق Zoho Books ★ ──────────────────────────────────────────────
-- متوقّع: صفر صفّ — لا حالة إرسال في قيد صندوق الصادر.
select conname, pg_get_constraintdef(oid) as def from pg_constraint
where conrelid = 'public.fin_zoho_outbox'::regclass and contype = 'c'
  and (pg_get_constraintdef(oid) ilike '%''sent''%'
    or pg_get_constraintdef(oid) ilike '%''synced''%'
    or pg_get_constraintdef(oid) ilike '%''delivered''%');

-- متوقّع: connected = false وintegration_state = not_built (بدور postgres سيرفع
-- منعًا لأنّ finops_can_manage = false — وهذا بحدّ ذاته نتيجة صحيحة. شغّله
-- بحساب المالك من التطبيق للتحقّق من النصّ).
select pg_get_functiondef(to_regprocedure('public.finops_zoho_diagnostic()')) ilike '%''connected'', false%'
  as diagnostic_pins_disconnected;

-- متوقّع: صفر صفّ — لا مكالمة شبكية ولا بيانات اعتماد في أيّ دالّة.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'finops%'
  and (pg_get_functiondef(p.oid) ~* '\b(pg_net|net\.http_post|net\.http_get|dblink)\b'
    or pg_get_functiondef(p.oid) ~* '(client_secret|refresh_token|access_token|api_key|service_role)');

-- ─── 14) ★ تجميد منصّة المشاريع لم يُخرَق ★ ──────────────────────────────
-- متوقّع: صفر صفّ — لا دالّة من الموديول تكتب في المنصّة.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'finops%'
  and (pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b'
    or pg_get_functiondef(p.oid) ~* 'update\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b'
    or pg_get_functiondef(p.oid) ~* 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b');

-- متوقّع: قارن هذه الأعداد بما سجّلته في PREFLIGHT §6 — يجب أن تتطابق تمامًا.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal',
                       'project_transition_requests')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects') as projects_columns;

-- متوقّع: 10 صفوف، confdeltype = 'n' (SET NULL) في كلّها — لا CASCADE ولا RESTRICT،
-- فحذف مشروع لا يمسّ صفًّا ماليًّا ولا يمنعه الموديول.
select conname, confdeltype from pg_constraint where conname like 'fin\_%\_project\_fk';

-- ─── 15) الترحيلة لم تُنشئ بيانات ────────────────────────────────────────
-- متوقّع: أصفار (ما لم تكن قد أدخلت بيانات بنفسك بعد التشغيل).
select (select count(*) from public.fin_costs)        as costs,
       (select count(*) from public.fin_receivables)  as receivables,
       (select count(*) from public.fin_audit)        as audit_rows,
       (select count(*) from public.fin_zoho_outbox)  as outbox_rows,
       (select count(*) from public.fin_expense_requests) as expense_requests;

-- ─── 16) الفهارس الحارسة قائمة ───────────────────────────────────────────
-- متوقّع: صفّان present = true.
select i.name, exists (select 1 from pg_indexes where schemaname='public' and indexname = i.name) as present
from (values ('uq_fin_bline'),('uq_fin_threshold')) i(name);

-- ─── 17) ★ حمولة جزئية لا تمحو عمودًا ★ ──────────────────────────────────
-- شاشة التعديل تُغذَّى من صفّ قائمة لا يحمل كلّ الأعمدة. بلا coalesce كان تعديل
-- مبلغ تكلفة يمسح مركزها وميزانيتها ومورّدها **بصمت وبلا رسالة**.
-- متوقّع: أربعة صفوف preserves_absent_columns = true.
select f.sig,
       (pg_get_functiondef(to_regprocedure(f.sig)) ilike '%coalesce(excluded.cost_center_id%'
        or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%coalesce(excluded.contact_name%')
         as preserves_absent_columns
from (values ('public.finops_cost_upsert(jsonb)'),
             ('public.finops_budget_upsert(jsonb)'),
             ('public.finops_receivable_upsert(jsonb)'),
             ('public.finops_supplier_upsert(jsonb)')) f(sig);

-- ─── 18) فحص تجاوز المتبقّي يشمل التعديل لا الإنشاء وحده ─────────────────
-- متوقّع: checks_on_update = true وexcludes_own_row = true وscoped_to_receivable = true.
select
  (pg_get_functiondef(to_regprocedure('public.finops_collection_record(jsonb)'))
     not ilike '%v_id is null and (m->>''amount_gross'')%')          as checks_on_update,
  (pg_get_functiondef(to_regprocedure('public.finops_collection_record(jsonb)'))
     ilike '%v_outstanding := v_outstanding + v_self%')              as excludes_own_row,
  (pg_get_functiondef(to_regprocedure('public.finops_collection_record(jsonb)'))
     ilike '%v_owner is not null and v_owner <> v_recv%')            as scoped_to_receivable;
