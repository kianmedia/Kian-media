-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_POSTCHECK.sql        (READ-ONLY · ONE RESULT SET · آمن)
--
-- يُنفَّذ بعد finance_profitability_RUNME.sql. يكتب لا شيء ويقفل لا شيء.
--
-- قواعد هذا الملفّ — ولماذا هي هكذا
-- ──────────────────────────────────
--   • **نتيجة واحدة**: استعلام واحد يعيد صفوفًا (تقرير الفحوص)، يليه كتلة حكم
--     ترفع ERROR **عند فشل حقيقيّ فقط**. لا صفوف متناثرة يقرؤها الإنسان بعينه
--     ويحكم بـ«يبدو أنّه نجح».
--   • **آمن من محرّر SQL** حيث auth.uid() = NULL: لا يُستدعى أيّ RPC محميّ.
--     ما يُستدعى حيًّا هو المُسنَدات وحدها — وهي بتصميمها لا ترفع منعًا، بل
--     تعيد false بلا جلسة. استدعاؤها هنا هو **الدليل** على أنّها لا تعيد NULL.
--   • **allowlist حقيقيّ لا denylist**: قوائم الأسماء أدناه تقول «هذا هو
--     المسموح»، فأيّ اسم لم يخطر ببال أحد يظهر فشلًا. القوائم التي تعدّ
--     الممنوعات تمرّ على أوّل شيء لم يُدرَج فيها — وقد حدث ذلك في هذا المستودع.
--   • **لا catch-all**: لا exception when others، ولا فحص يمرّ لمجرّد أنّ نمطًا
--     طابق. كلّ فحص له اسم ونتيجة متوقّعة مكتوبة.
--   • **الانحدار يُفحص بالمشي على رسم النداء** لا بمطابقة نصّية. المطابقة
--     النصّية هي ما أسقط التشغيل السابق على finops_can_manage()، وهي تفوّض
--     بقفزة واحدة إلى finops_can_manage_finance ثم إلى البوّابة الحسّاسة.
--     التعليقات تُنزَع قبل أيّ مطابقة، والحالة تُخفَّض، والنمط لا يستعمل [^)]*.
--
-- القراءة: كلّ صفّ verdict = 'PASS'. أيّ 'FAIL' يوقف الإطلاق. الصفوف 'INFO'
-- توثيقية ولا تدخل الحكم.
-- ════════════════════════════════════════════════════════════════════════════

with recursive

-- ─── الأسماء: allowlists صريحة ──────────────────────────────────────────────
fin_table(t) as (values
  ('fin_cost_centers'),('fin_expense_categories'),('fin_suppliers'),('fin_budgets'),
  ('fin_budget_lines'),('fin_contracts'),('fin_revenue'),('fin_retainers'),('fin_receivables'),
  ('fin_collections'),('fin_payment_milestones'),('fin_approval_thresholds'),
  ('fin_expense_requests'),('fin_expense_approvals'),('fin_purchase_requests'),
  ('fin_purchase_request_items'),('fin_purchase_orders'),('fin_purchase_order_items'),
  ('fin_costs'),('fin_attachments'),('fin_audit'),('fin_zoho_outbox')),

-- ★ ALLOWLIST ★ — دوالّ الموديول التي يجوز لـauthenticated تنفيذها. ثلاث
-- وستّون اسمًا مكتوبة. أيّ دالّة finops_* أخرى تُنفَّذ من الواجهة = فشل، حتى لو
-- أُضيفت غدًا ولم يخطر ببال أحد إدراجها في قائمة ممنوعات.
authed_fn(name) as (values
  ('finops_access'),('finops_lookups'),('finops_request_lookups'),('finops_budgets_list'),
  ('finops_budget_variance'),('finops_costs_list'),('finops_suppliers_list'),
  ('finops_expense_requests_list'),('finops_my_requests'),('finops_purchase_list'),
  ('finops_receivables'),('finops_collections_list'),('finops_collections_summary'),
  ('finops_profitability'),('finops_dashboard'),('finops_audit_list'),('finops_export'),
  ('finops_zoho_diagnostic'),
  ('finops_cost_center_upsert'),('finops_category_upsert'),('finops_supplier_upsert'),
  ('finops_threshold_upsert'),('finops_budget_upsert'),('finops_budget_line_upsert'),
  ('finops_contract_upsert'),('finops_revenue_upsert'),('finops_retainer_upsert'),
  ('finops_receivable_upsert'),('finops_collection_record'),('finops_milestone_upsert'),
  ('finops_cost_upsert'),('finops_expense_request_submit'),('finops_expense_decide'),
  ('finops_expense_mark_paid'),('finops_expense_second_approve'),
  ('finops_purchase_request_submit'),('finops_purchase_item_upsert'),('finops_purchase_decide'),
  ('finops_po_upsert'),('finops_po_item_upsert'),('finops_po_set_status'),
  ('finops_attachment_add'),('finops_row_delete'),('finops_zoho_outbox_enqueue'),
  ('finops_zoho_outbox_replay'),
  ('finops_can_view_finance_sensitive'),('finops_can_manage_finance'),
  ('finops_can_manage_suppliers'),('finops_can_view_collections'),
  ('finops_can_record_collection'),('finops_can_approve_expense'),
  ('finops_can_export_sensitive'),('finops_can_export_collections'),('finops_can_view'),
  ('finops_can_manage'),('finops_can_approve'),('finops_can_view_profit'),
  ('finops_can_manage_receivables'),('finops_can_export'),('finops_can_request'),
  ('finops_is_client'),('finops_is_finance_role'),('finops_perm')),

-- الدوالّ الداخلية: لا تُمنح لأحد. أخطرها finops_profit_core — منحُها يسرّب
-- الهامش مهما كانت الأغلفة مُحكَمة.
internal_fn(name) as (values
  ('finops_log'),('finops_project_label'),('finops_next_code'),('finops_money'),
  ('finops_threshold_for'),('finops_receivable_state'),('finops_contract_state'),
  ('finops_variance_core'),('finops_profit_core')),

-- ★ ALLOWLIST ★ — ما يجوز لـanon/PUBLIC امتلاكه على سطح هذه الحزمة: لا شيء.
-- فارغة عمدًا: لا مسار مجهول يلمس المالية، لا قراءةً ولا تنفيذًا.
anon_allowed(kind, name, priv) as (select null::text, null::text, null::text where false),

-- بوّابات المالك. كلّ واحدة يجب أن تصل الجذر الحسّاس — بقفزة أو بقفزتين.
owner_gate(name) as (values
  ('finops_can_manage_finance'),('finops_can_manage_suppliers'),('finops_can_export_sensitive'),
  ('finops_can_view_profit'),('finops_can_view'),('finops_can_manage'),
  ('finops_can_manage_receivables'),('finops_can_export')),

-- ضابطا لا-فراغ: مُسنَدان يجب أن يقول المحلّل عنهما «لا ينحدران». لو صار
-- المحلّل يقول «وصل» لكلّ شيء لصار كلّ ما فوقه بلا معنى.
no_descent(name) as (values ('finops_can_request'),('finops_is_finance_role')),

-- مُسنَدات واسعة: ظهور أيّ منها على طريق بوّابة مالك = توسيع صامت.
broad_fn(x) as (values
  ('finops_perm'),('emp_has_permission'),('emp_can'),('has_permission'),('staff_role'),
  ('finops_is_finance_role'),('can_manage_projects'),('can_final_deliver'),('can_manage_staff'),
  ('is_kian_member'),('civ_can_finance'),('civ_can_manage'),('can_see_invoices'),
  ('is_hr_admin'),('can_manage_hr'),('pc_can_read_project'),('crm_perm'),('ops_perm'),
  ('comms_perm'),('finops_can_view_collections'),('finops_can_record_collection'),
  ('finops_can_approve_expense'),('finops_can_export_collections'),('finops_can_request'),
  ('finops_is_client')),

-- ★ ALLOWLIST ★ — الجداول التي يجوز لسطح التحصيل أن يلمسها، هي ومن تنادي.
-- مرجع الفاتورة · العميل · الاستحقاق · المستحقّ · المحصَّل · المتبقّي · الحالة
-- · الملاحظات. لا تكلفة ولا ميزانية ولا عقد ولا إيراد ولا مورّد.
coll_allowed_table(t) as (values ('fin_receivables'),('fin_collections')),

-- كلّ بوّابة قابلة للمنح ومفتاحها وحده.
grantable(name, key) as (values
  ('finops_can_view_collections','finance_ops.collections_view'),
  ('finops_can_record_collection','finance_ops.collections_record'),
  ('finops_can_approve_expense','finance_ops.approve'),
  ('finops_can_export_collections','finance_ops.export_collections')),

-- جداول الحزم الثلاث المطبَّقة — قائمة صريحة لا نمط.
applied(pkg, t) as (values
  ('communications_hub','comms_audit'),('communications_hub','comms_channels'),
  ('communications_hub','comms_event_catalog'),('communications_hub','comms_outbox'),
  ('communications_hub','comms_preferences'),('communications_hub','comms_rate_counters'),
  ('communications_hub','comms_templates'),
  ('operations_center','ops_audit'),('operations_center','ops_call_sheets'),
  ('operations_center','ops_daily_reports'),('operations_center','ops_delays'),
  ('operations_center','ops_incidents'),('operations_center','ops_ingest_jobs'),
  ('operations_center','ops_job_accommodation'),('operations_center','ops_job_crew'),
  ('operations_center','ops_job_equipment'),('operations_center','ops_job_hse'),
  ('operations_center','ops_job_permits'),('operations_center','ops_job_travel'),
  ('operations_center','ops_job_vehicles'),('operations_center','ops_job_weather'),
  ('operations_center','ops_jobs'),('operations_center','ops_locations'),
  ('operations_center','ops_media_backups'),('operations_center','ops_media_cards'),
  ('operations_center','ops_post_handoff'),('operations_center','ops_vehicles'),
  ('crm_sales_foundation','crm_settings'),('crm_sales_foundation','crm_teams'),
  ('crm_sales_foundation','crm_team_members'),('crm_sales_foundation','crm_companies'),
  ('crm_sales_foundation','crm_contacts'),('crm_sales_foundation','crm_competitors'),
  ('crm_sales_foundation','crm_lead_score_rules'),('crm_sales_foundation','crm_leads'),
  ('crm_sales_foundation','crm_pipelines'),('crm_sales_foundation','crm_stages'),
  ('crm_sales_foundation','crm_opportunities'),('crm_sales_foundation','crm_stage_history'),
  ('crm_sales_foundation','crm_activities'),('crm_sales_foundation','crm_targets'),
  ('crm_sales_foundation','crm_commission_plans'),
  ('crm_sales_foundation','crm_commission_assignments'),
  ('crm_sales_foundation','crm_commission_records'),('crm_sales_foundation','crm_import_batches'),
  ('crm_sales_foundation','crm_audit'),('crm_sales_foundation','crm_approval_requests')),

-- ─── القراءة من الكتالوج ────────────────────────────────────────────────────
anon_role(r) as (select to_regrole('anon')),

fin_proc(name, oid, secdef, pinned, acl, acl_null, src) as (
  select p.proname::text, p.oid, p.prosecdef,
         (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%'),
         p.proacl, (p.proacl is null), p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'finops\_%'),

-- جسم الدالّة وحده (prosrc) — لا تعريفٌ يحمل اسمها في ترويسته، فالنطاق محصور
-- بالدالّة المفحوصة. التعليقات تُنزَع أوّلًا والحالة تُخفَّض.
fin_body(name, body) as (
  select fp.name,
         lower(regexp_replace(regexp_replace(string_agg(fp.src, E'\n'), '/\*.*?\*/', ' ', 'g'),
                              '--[^\n]*', ' ', 'g'))
    from fin_proc fp group by fp.name),

-- أضلاع رسم النداء: «مُعرِّف يليه قوس». ليس [^)]* — ذلك النمط يقف عند أوّل
-- قوس وقد سبّب حادثة في هذا المستودع.
fin_edge(caller, callee) as (
  select b.name, rx.m[1]
    from fin_body b, lateral regexp_matches(b.body, '([a-z_][a-z0-9_]*)\s*\(', 'g') as rx(m)
   where rx.m[1] like 'finops\_%' and rx.m[1] <> b.name),

fin_tbl_ref(fn, tbl) as (
  select distinct b.name, rx.m[1]
    from fin_body b, lateral regexp_matches(b.body, '(fin_[a-z0-9_]+)', 'g') as rx(m)),

-- ★ المشي ★ — من كلّ بوّابة، عبر الأضلاع، ويتوقّف عند الجذر (طرفيّ).
gate_seed(gate, node, hops) as (
  select name, name, 0 from owner_gate
  union all select name, name, 0 from no_descent),
gwalk(gate, node, hops) as (
  select gate, node, hops from gate_seed
  union
  select w.gate, e.callee, w.hops + 1
    from gwalk w join fin_edge e on e.caller = w.node
   where w.hops < 8 and w.node <> 'finops_can_view_finance_sensitive'),

-- ★ المشي من سطح التحصيل ★ — الإغلاق الكامل، لا الجسم الأوّل فقط.
coll_seed(fn) as (values ('finops_collections_list'),('finops_collections_summary')),
coll_walk(fn, hops) as (
  select cs.fn, 0 from coll_seed cs
  union
  select e.callee, w.hops + 1 from coll_walk w join fin_edge e on e.caller = w.fn
   where w.hops < 8),
coll_tables(tbl) as (
  select distinct r.tbl from coll_walk w join fin_tbl_ref r on r.fn = w.fn),

root_body(body) as (select body from fin_body where name = 'finops_can_view_finance_sensitive'),

live_table(relname, rls, relacl) as (
  select c.relname::text, c.relrowsecurity, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')),

-- ─── الحقائق ────────────────────────────────────────────────────────────────
facts as (select
  -- A) البوّابة الحسّاسة
  coalesce((select body ~ '\mis_owner\M' and body ~ '\mis_staff\M'
                 and body ~ '\mcoalesce\M' and body ~ '\mauth\M' from root_body), false) as a1,
  (not exists (select 1 from broad_fn bf
                where (select body from root_body) ~ ('\m' || bf.x || '\M'))
   and (select count(*) from root_body) = 1) as a2,

  -- B) الانحدار
  (not exists (select 1 from owner_gate g
                where not exists (select 1 from gwalk w
                                   where w.gate = g.name
                                     and w.node = 'finops_can_view_finance_sensitive'))) as b1,
  (not exists (select 1 from no_descent d join gwalk w on w.gate = d.name
                where w.node = 'finops_can_view_finance_sensitive')) as b2,
  (coalesce((select max(w.hops) from gwalk w join owner_gate g on g.name = w.gate
              where w.node = 'finops_can_view_finance_sensitive'), 0) >= 2) as b3,
  (not exists (select 1 from gwalk w
                 join owner_gate g on g.name = w.gate
                 join fin_body b on b.name = w.node
                 cross join broad_fn bf
                where w.node <> 'finops_can_view_finance_sensitive'
                  and b.body ~ ('\m' || bf.x || '\M'))) as b4,
  (not exists (select 1 from gwalk w
                 join owner_gate g on g.name = w.gate
                 join fin_body b on b.name = w.node
                where w.node <> 'finops_can_view_finance_sensitive'
                  and b.body !~ '\mcoalesce\M')) as b5,

  -- C) عزل التحصيل
  (exists (select 1 from coll_tables)
   and not exists (select 1 from coll_tables ct
                    where ct.tbl not in (select t from coll_allowed_table))) as c1,
  (not exists (select 1 from pg_policies p
                where p.schemaname = 'public'
                  and p.tablename in (select t from fin_table)
                  and (coalesce(p.qual, '') ilike '%can_view_collections%'
                    or coalesce(p.qual, '') ilike '%can_record_collection%'
                    or coalesce(p.qual, '') ilike '%finops_perm%'))) as c2,
  (not exists (select 1 from grantable g join fin_body b on b.name = g.name
                where position(lower(g.key) in b.body) = 0)
   and not exists (select 1 from grantable g join fin_body b on b.name = g.name
                    join grantable o on o.name <> g.name
                   where position(lower(o.key) in b.body) > 0)) as c3,
  (not exists (select 1 from coll_walk w join fin_body b on b.name = w.fn
                where b.body ~ '\mfinops_profit_core\M'
                   or b.body ~ '\mfinops_variance_core\M'
                   or b.body ~ '\mfinops_contract_state\M')) as c4,

  -- D) التصدير
  coalesce((select b.body ~ '\mfinops_can_export_sensitive\M'
                and b.body ~ '\mfinops_can_export_collections\M'
             from fin_body b where b.name = 'finops_export'), false) as d1,
  (exists (select 1 from gwalk w where w.gate = 'finops_can_export_sensitive'
             and w.node = 'finops_can_view_finance_sensitive')
   and not exists (select 1 from gwalk w where w.gate = 'finops_can_export_sensitive'
                     and w.node in ('finops_can_view_collections','finops_can_export_collections'))) as d2,

  -- E) أسعار المورّدين والميزانيات والتكاليف: البوّابة الحسّاسة وحدها
  (not exists (select 1 from (values ('fin_suppliers'),('fin_budgets'),('fin_budget_lines'),
                                     ('fin_costs'),('fin_contracts'),('fin_revenue'),
                                     ('fin_retainers'),('fin_purchase_orders'),
                                     ('fin_purchase_order_items'),('fin_cost_centers'),
                                     ('fin_payment_milestones'),('fin_approval_thresholds')) v(t)
                where not exists (select 1 from pg_policies p
                                   where p.schemaname = 'public' and p.tablename = v.t
                                     and coalesce(p.qual, '') ilike '%finops_can_view_finance_sensitive%'))) as e1,
  (not exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename in (select t from fin_table)
                  and p.cmd <> 'SELECT')) as e2,
  (not exists (select 1 from fin_table ft
                where not exists (select 1 from live_table lt
                                   where lt.relname = ft.t and lt.rls))) as e3,

  -- F) anon والعميل
  (not exists (select 1 from live_table lt cross join lateral aclexplode(lt.relacl) a
                where lt.relname in (select t from fin_table)
                  and (a.grantee = 0 or a.grantee = (select r from anon_role)::oid)
                  and not exists (select 1 from anon_allowed al
                                   where al.kind = 'table' and al.name = lt.relname
                                     and al.priv = a.privilege_type))
   and not exists (select 1 from fin_proc fp cross join lateral aclexplode(fp.acl) a
                    where (a.grantee = 0 or a.grantee = (select r from anon_role)::oid)
                      and not exists (select 1 from anon_allowed al
                                       where al.kind = 'function' and al.name = fp.name
                                         and al.priv = a.privilege_type))
   and not exists (select 1 from fin_proc fp where fp.acl_null)) as f1,
  ((select r from anon_role) is not null
   and (exists (select 1 from live_table lt cross join lateral aclexplode(lt.relacl) a
                 where a.grantee = (select r from anon_role)::oid)
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  cross join lateral aclexplode(p.proacl) a
                 where n.nspname = 'public' and a.grantee = (select r from anon_role)::oid))) as f2,
  (not exists (select 1 from (values ('finops_can_view_finance_sensitive'),
                                     ('finops_can_view_collections'),('finops_can_record_collection'),
                                     ('finops_can_approve_expense'),('finops_can_request')) v(n)
                join fin_body b on b.name = v.n
               where b.body !~ '\mis_staff\M')) as f3,

  -- G) لا مُسنَد يعيد NULL — استدعاء حيّ آمن (لا بوّابة فيه، ولا يرفع منعًا)
  (select bool_and(v is not null and v = false) from (values
     (public.finops_can_view_finance_sensitive()),(public.finops_can_manage_finance()),
     (public.finops_can_manage_suppliers()),(public.finops_can_view_collections()),
     (public.finops_can_record_collection()),(public.finops_can_approve_expense()),
     (public.finops_can_export_sensitive()),(public.finops_can_export_collections()),
     (public.finops_can_view()),(public.finops_can_manage()),(public.finops_can_approve()),
     (public.finops_can_view_profit()),(public.finops_can_manage_receivables()),
     (public.finops_can_export()),(public.finops_can_request()),
     (public.finops_perm('finance_ops.collections_view')),(public.finops_perm(null))
   ) s(v)) as g1,
  (public.finops_can_manage_receivables() is not null) as g2,

  -- H) REST/RPC مباشرة
  (not exists (select 1 from fin_proc fp
                where has_function_privilege('authenticated', fp.oid, 'EXECUTE')
                  and fp.name not in (select name from authed_fn))
   and not exists (select 1 from authed_fn af
                    where not exists (select 1 from fin_proc fp
                                       where fp.name = af.name
                                         and has_function_privilege('authenticated', fp.oid, 'EXECUTE')))) as h1,
  (not exists (select 1 from internal_fn i join fin_proc fp on fp.name = i.name
                where has_function_privilege('authenticated', fp.oid, 'EXECUTE'))) as h2,
  (not exists (select 1 from information_schema.role_table_grants g
                where g.table_schema = 'public' and g.table_name in (select t from fin_table)
                  and g.grantee = 'authenticated' and g.privilege_type <> 'SELECT')) as h3,
  (not exists (select 1 from fin_proc fp where not fp.secdef or not fp.pinned)) as h4,
  (not exists (select 1 from pg_views where schemaname = 'public' and viewname like 'fin\_%')) as h5,

  -- I) Zoho معطَّل بالتصميم
  coalesce((select b.body ilike '%''connected'', false%'
             from fin_body b where b.name = 'finops_zoho_diagnostic'), false) as i1,
  (not exists (select 1 from pg_constraint
                where conrelid = 'public.fin_zoho_outbox'::regclass and contype = 'c'
                  and (pg_get_constraintdef(oid) ilike '%''sent''%'
                    or pg_get_constraintdef(oid) ilike '%''synced''%'
                    or pg_get_constraintdef(oid) ilike '%''delivered''%'))) as i2,
  (not exists (select 1 from fin_body b
                where b.body ~ '\m(pg_net|dblink|http_post|http_get)\M'
                   or b.body ~ '(client_secret|refresh_token|access_token|api_key|service_role)')) as i3,

  -- J) منصّة المشاريع
  (not exists (select 1 from fin_body b
                where b.body ~ 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M'
                   or b.body ~ 'update\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M'
                   or b.body ~ 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M')) as j1,
  (not exists (select 1 from pg_constraint
                where conname like 'fin\_%\_project\_fk' and confdeltype <> 'n')) as j2,

  -- K) الحزم الثلاث المطبَّقة
  (not exists (select 1 from applied a
                where not exists (select 1 from live_table lt
                                   where lt.relname = a.t and lt.rls))) as k1,
  (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'comms\_%')
   and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'ops\_%')
   and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'crm\_%')) as k2,

  -- عدّادات للتقرير
  (select count(*) from fin_proc) as n_fn,
  (select count(*) from gwalk w join owner_gate g on g.name = w.gate
    where w.node = 'finops_can_view_finance_sensitive') as n_descend,
  coalesce((select max(w.hops) from gwalk w join owner_gate g on g.name = w.gate
             where w.node = 'finops_can_view_finance_sensitive'), 0) as n_deep,
  (select count(*) from coll_tables) as n_coll_tables,
  (select count(*) from fin_proc fp where has_function_privilege('authenticated', fp.oid, 'EXECUTE')) as n_authed
),

checks(id, area, item, observed, expected, verdict) as (
  select 'A1', 'البوّابة الحسّاسة', 'is_owner + is_staff + جلسة + coalesce داخل الجسم',
         f.a1::text, 'true', case when f.a1 then 'PASS' else 'FAIL' end from facts f
  union all select 'A2', 'البوّابة الحسّاسة', 'لا مفتاح ولا دور يفتحها (٢٥ مُسنَدًا واسعًا مُستبعَدًا)',
         f.a2::text, 'true', case when f.a2 then 'PASS' else 'FAIL' end from facts f
  union all select 'B1', 'الانحدار', 'كلّ بوّابات المالك الثماني تبلغ الجذر الحسّاس',
         f.n_descend::text || '/8', '8/8', case when f.b1 then 'PASS' else 'FAIL' end from facts f
  union all select 'B2', 'الانحدار · لا-فراغ', 'can_request وis_finance_role **لا** يبلغان الجذر',
         f.b2::text, 'true', case when f.b2 then 'PASS' else 'FAIL' end from facts f
  union all select 'B3', 'الانحدار · لا-فراغ', 'أقصى عمق وصول ≥ ٢ (التفويض غير المباشر فُحص فعلًا)',
         f.n_deep::text, '>= 2', case when f.b3 then 'PASS' else 'FAIL' end from facts f
  union all select 'B4', 'الانحدار', 'لا مُسنَد واسع على أيّ عقدة من طريق المالك',
         f.b4::text, 'true', case when f.b4 then 'PASS' else 'FAIL' end from facts f
  union all select 'B5', 'الانحدار', 'كلّ عقدة على الطريق تلفّ بـcoalesce (NULL ليس نجاحًا)',
         f.b5::text, 'true', case when f.b5 then 'PASS' else 'FAIL' end from facts f
  union all select 'C1', 'عزل التحصيل', 'إغلاق سطح التحصيل لا يلمس إلّا fin_receivables/fin_collections',
         f.n_coll_tables::text || ' جدول', '2 جدول (allowlist)',
         case when f.c1 then 'PASS' else 'FAIL' end from facts f
  union all select 'C2', 'عزل التحصيل', 'لا سياسة RLS على جدول ماليّ تعترف ببوّابة تحصيل أو بمفتاح',
         f.c2::text, 'true', case when f.c2 then 'PASS' else 'FAIL' end from facts f
  union all select 'C3', 'عزل التحصيل', 'لكلّ بوّابة قابلة للمنح مفتاحها وحده — لا مفتاح يفتح بوّابتين',
         f.c3::text, 'true', case when f.c3 then 'PASS' else 'FAIL' end from facts f
  union all select 'C4', 'لا استنتاج ربح', 'سطح التحصيل لا يبلغ محرّك ربح ولا انحراف ولا حالة عقد',
         f.c4::text, 'true', case when f.c4 then 'PASS' else 'FAIL' end from facts f
  union all select 'D1', 'التصدير', 'التصدير مقسوم ببوّابتين مستقلّتين',
         f.d1::text, 'true', case when f.d1 then 'PASS' else 'FAIL' end from facts f
  union all select 'D2', 'التصدير', 'التصدير الشامل للمالك — ولا يُفتح ببوّابة تحصيل',
         f.d2::text, 'true', case when f.d2 then 'PASS' else 'FAIL' end from facts f
  union all select 'E1', 'التكلفة والميزانية', 'كلّ جدول تكلفة/ميزانية/مورّد/إيراد محكوم بالبوّابة الحسّاسة',
         f.e1::text, 'true', case when f.e1 then 'PASS' else 'FAIL' end from facts f
  union all select 'E2', 'التكلفة والميزانية', 'لا سياسة كتابة مباشرة — الكتابة عبر RPC وحدها',
         f.e2::text, 'true', case when f.e2 then 'PASS' else 'FAIL' end from facts f
  union all select 'E3', 'التكلفة والميزانية', 'RLS مفعّلة على الجداول الاثنين والعشرين',
         f.e3::text, 'true', case when f.e3 then 'PASS' else 'FAIL' end from facts f
  union all select 'F1', 'anon', 'anon/PUBLIC لا يملكان شيئًا (allowlist فارغ · ACL غير NULL)',
         f.f1::text, 'true', case when f.f1 then 'PASS' else 'FAIL' end from facts f
  union all select 'F2', 'anon · لا-فراغ', 'مِجَسّ anon يرى صلاحيات في مكان آخر — فالصفر أعلاه حقيقيّ',
         f.f2::text, 'true', case when f.f2 then 'PASS' else 'FAIL' end from facts f
  union all select 'F3', 'العميل', 'كلّ بوّابة جلسة تشترط is_staff — العميل مستبعد بنيويًّا',
         f.f3::text, 'true', case when f.f3 then 'PASS' else 'FAIL' end from facts f
  union all select 'G1', 'لا NULL', 'المُسنَدات الخمسة عشر + الجسر تعيد false لا NULL بلا جلسة',
         f.g1::text, 'true', case when f.g1 then 'PASS' else 'FAIL' end from facts f
  union all select 'G2', 'لا NULL', 'can_manage_receivables ليست NULL (الاسم المتوارث لا يُستثنى)',
         f.g2::text, 'true', case when f.g2 then 'PASS' else 'FAIL' end from facts f
  union all select 'H1', 'REST/RPC', 'ما ينفّذه authenticated = الـallowlist بالضبط، لا زيادة ولا نقص',
         f.n_authed::text || '/' || (select count(*)::text from authed_fn), '63/63',
         case when f.h1 then 'PASS' else 'FAIL' end from facts f
  union all select 'H2', 'REST/RPC', 'الدوالّ الداخلية التسع غير قابلة للتنفيذ من الواجهة',
         f.h2::text, 'true', case when f.h2 then 'PASS' else 'FAIL' end from facts f
  union all select 'H3', 'REST/RPC', 'authenticated لا يملك على أيّ جدول ماليّ غير SELECT',
         f.h3::text, 'true', case when f.h3 then 'PASS' else 'FAIL' end from facts f
  union all select 'H4', 'REST/RPC', 'كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت',
         f.n_fn::text || ' دالّة', 'كلّها', case when f.h4 then 'PASS' else 'FAIL' end from facts f
  union all select 'H5', 'REST/RPC', 'لا VIEW باسم fin_* — العروض تتجاوز RLS',
         f.h5::text, 'true', case when f.h5 then 'PASS' else 'FAIL' end from facts f
  union all select 'I1', 'Zoho', 'التشخيص يثبّت connected = false في جسمه',
         f.i1::text, 'true', case when f.i1 then 'PASS' else 'FAIL' end from facts f
  union all select 'I2', 'Zoho', 'صندوق الصادر بلا حالة إرسال — لا صفّ يدّعي ما لم يحدث',
         f.i2::text, 'true', case when f.i2 then 'PASS' else 'FAIL' end from facts f
  union all select 'I3', 'Zoho', 'لا مكالمة شبكية ولا بيانات اعتماد في أيّ دالّة',
         f.i3::text, 'true', case when f.i3 then 'PASS' else 'FAIL' end from facts f
  union all select 'J1', 'التجميد', 'لا دالّة من الموديول تكتب في منصّة المشاريع',
         f.j1::text, 'true', case when f.j1 then 'PASS' else 'FAIL' end from facts f
  union all select 'J2', 'التجميد', 'كلّ fin_*_project_fk = SET NULL (لا CASCADE ولا RESTRICT)',
         f.j2::text, 'true', case when f.j2 then 'PASS' else 'FAIL' end from facts f
  union all select 'K1', 'الحزم المطبَّقة', 'جداول Communications/Operations/CRM موجودة وRLS مفعّلة',
         f.k1::text, 'true', case when f.k1 then 'PASS' else 'FAIL' end from facts f
  union all select 'K2', 'الحزم المطبَّقة', 'دوالّ comms_* وops_* وcrm_* ما زالت قائمة',
         f.k2::text, 'true', case when f.k2 then 'PASS' else 'FAIL' end from facts f
)
select c.id, c.area, c.item, c.observed, c.expected, c.verdict
from checks c order by c.id;

-- ════════════════════════════════════════════════════════════════════════════
-- كتلة الحكم — ترفع ERROR **عند فشل حقيقيّ فقط**، ولا تعيد صفوفًا، فالتقرير
-- أعلاه يبقى النتيجة الوحيدة.
--
-- الشروط أدناه هي **نفس** شروط التقرير: SQL لا يسمح بمشاركة CTE عبر عبارتين،
-- فأُعيدت كتابتها هنا مرّة واحدة في رأس عبارة واحدة (with recursive) بدل
-- تكرارها داخل كلّ فرع — كي لا ينحرف الحكم عن التقرير بصمت.
--
-- تجميع: كلّ سطر أدناه مجموعةُ فشلٍ واحدة باسم صريح. لا فرع catch-all، ولا
-- exception when others، ولا شرط يمرّ لمجرّد أنّ نمطًا طابق.
-- ════════════════════════════════════════════════════════════════════════════
do $verdict$
declare v_fail int; v_names text;
begin
  with recursive
  fb(name, body) as (
    select p.proname::text,
           lower(regexp_replace(regexp_replace(string_agg(p.prosrc, E'\n'),
                 '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'finops\_%'
     group by p.proname),
  fe(caller, callee) as (
    select b.name, rx.m[1] from fb b,
           lateral regexp_matches(b.body, '([a-z_][a-z0-9_]*)\s*\(', 'g') as rx(m)
     where rx.m[1] like 'finops\_%' and rx.m[1] <> b.name),
  tr(fn, tbl) as (
    select distinct b.name, rx.m[1] from fb b,
           lateral regexp_matches(b.body, '(fin_[a-z0-9_]+)', 'g') as rx(m)),
  og(name) as (values ('finops_can_manage_finance'),('finops_can_manage_suppliers'),
    ('finops_can_export_sensitive'),('finops_can_view_profit'),('finops_can_view'),
    ('finops_can_manage'),('finops_can_manage_receivables'),('finops_can_export')),
  nd(name) as (values ('finops_can_request'),('finops_is_finance_role')),
  bf(x) as (values ('finops_perm'),('emp_has_permission'),('emp_can'),('has_permission'),
    ('staff_role'),('finops_is_finance_role'),('can_manage_projects'),('can_final_deliver'),
    ('can_manage_staff'),('is_kian_member'),('civ_can_finance'),('civ_can_manage'),
    ('can_see_invoices'),('is_hr_admin'),('can_manage_hr'),('pc_can_read_project'),
    ('crm_perm'),('ops_perm'),('comms_perm'),('finops_can_view_collections'),
    ('finops_can_record_collection'),('finops_can_approve_expense'),
    ('finops_can_export_collections'),('finops_can_request'),('finops_is_client')),
  seed(gate, node, hops) as (
    select name, name, 0 from og union all select name, name, 0 from nd),
  w(gate, node, hops) as (
    select gate, node, hops from seed
    union
    select w.gate, e.callee, w.hops + 1 from w join fe e on e.caller = w.node
     where w.hops < 8 and w.node <> 'finops_can_view_finance_sensitive'),
  cs(fn) as (values ('finops_collections_list'),('finops_collections_summary')),
  cw(fn, hops) as (
    select cs.fn, 0 from cs
    union
    select e.callee, cw.hops + 1 from cw join fe e on e.caller = cw.fn where cw.hops < 8),
  ct(tbl) as (select distinct tr.tbl from cw join tr on tr.fn = cw.fn),
  internal(name) as (values
    ('finops_log'),('finops_project_label'),('finops_next_code'),('finops_money'),
    ('finops_threshold_for'),('finops_receivable_state'),('finops_contract_state'),
    ('finops_variance_core'),('finops_profit_core')),
  sensitive_tbl(t) as (values ('fin_suppliers'),('fin_budgets'),('fin_budget_lines'),
    ('fin_costs'),('fin_contracts'),('fin_revenue'),('fin_retainers'),('fin_purchase_orders'),
    ('fin_purchase_order_items'),('fin_cost_centers'),('fin_payment_milestones'),
    ('fin_approval_thresholds')),
  ap(t) as (values
    ('comms_audit'),('comms_channels'),('comms_event_catalog'),('comms_outbox'),
    ('comms_preferences'),('comms_rate_counters'),('comms_templates'),
    ('ops_audit'),('ops_call_sheets'),('ops_daily_reports'),('ops_delays'),('ops_incidents'),
    ('ops_ingest_jobs'),('ops_job_accommodation'),('ops_job_crew'),('ops_job_equipment'),
    ('ops_job_hse'),('ops_job_permits'),('ops_job_travel'),('ops_job_vehicles'),
    ('ops_job_weather'),('ops_jobs'),('ops_locations'),('ops_media_backups'),
    ('ops_media_cards'),('ops_post_handoff'),('ops_vehicles'),
    ('crm_settings'),('crm_teams'),('crm_team_members'),('crm_companies'),('crm_contacts'),
    ('crm_competitors'),('crm_lead_score_rules'),('crm_leads'),('crm_pipelines'),
    ('crm_stages'),('crm_opportunities'),('crm_stage_history'),('crm_activities'),
    ('crm_targets'),('crm_commission_plans'),('crm_commission_assignments'),
    ('crm_commission_records'),('crm_import_batches'),('crm_audit'),('crm_approval_requests')),
  failures(id) as (
    -- A · البوّابة الحسّاسة نفسها
    select 'A.sensitive_gate' where not coalesce((
      select b.body ~ '\mis_owner\M' and b.body ~ '\mis_staff\M'
         and b.body ~ '\mcoalesce\M' and b.body ~ '\mauth\M'
         and not exists (select 1 from bf where b.body ~ ('\m' || bf.x || '\M'))
        from fb b where b.name = 'finops_can_view_finance_sensitive'), false)
    union all
    -- B · الانحدار على رسم النداء + ضابطا لا-فراغ
    select 'B.descent' where
      exists (select 1 from og g where not exists (
               select 1 from w where w.gate = g.name
                 and w.node = 'finops_can_view_finance_sensitive'))
      or exists (select 1 from nd d join w on w.gate = d.name
                  where w.node = 'finops_can_view_finance_sensitive')
      or coalesce((select max(w.hops) from w join og g on g.name = w.gate
                    where w.node = 'finops_can_view_finance_sensitive'), 0) < 2
      or exists (select 1 from w join og g on g.name = w.gate join fb b on b.name = w.node
                   cross join bf
                  where w.node <> 'finops_can_view_finance_sensitive'
                    and b.body ~ ('\m' || bf.x || '\M'))
      or exists (select 1 from w join og g on g.name = w.gate join fb b on b.name = w.node
                  where w.node <> 'finops_can_view_finance_sensitive'
                    and b.body !~ '\mcoalesce\M')
    union all
    -- C · عزل التحصيل (allowlist جداول حقيقيّ) + لا محرّك ربح على طريقه
    select 'C.collections_isolation' where
      not exists (select 1 from ct)
      or exists (select 1 from ct where ct.tbl not in ('fin_receivables','fin_collections'))
      or exists (select 1 from cw join fb b on b.name = cw.fn
                  where b.body ~ '\mfinops_profit_core\M'
                     or b.body ~ '\mfinops_variance_core\M'
                     or b.body ~ '\mfinops_contract_state\M')
    union all
    -- C2 · لكلّ بوّابة قابلة للمنح مفتاحها وحده
    select 'C.grantable_keys' where exists (
      select 1 from (values
        ('finops_can_view_collections','finance_ops.collections_view'),
        ('finops_can_record_collection','finance_ops.collections_record'),
        ('finops_can_approve_expense','finance_ops.approve'),
        ('finops_can_export_collections','finance_ops.export_collections')) g(n, k)
       where not exists (select 1 from fb b where b.name = g.n and position(g.k in b.body) > 0)
          or exists (select 1 from (values
               ('finops_can_view_collections','finance_ops.collections_view'),
               ('finops_can_record_collection','finance_ops.collections_record'),
               ('finops_can_approve_expense','finance_ops.approve'),
               ('finops_can_export_collections','finance_ops.export_collections')) o(n2, k2)
               join fb b on b.name = g.n
              where o.n2 <> g.n and position(o.k2 in b.body) > 0))
    union all
    -- D · التصدير مقسوم، والشامل لا يُفتح ببوّابة تحصيل
    select 'D.export_split' where
      not coalesce((select b.body ~ '\mfinops_can_export_sensitive\M'
                       and b.body ~ '\mfinops_can_export_collections\M'
                      from fb b where b.name = 'finops_export'), false)
      or exists (select 1 from w where w.gate = 'finops_can_export_sensitive'
                   and w.node in ('finops_can_view_collections','finops_can_export_collections'))
    union all
    -- E · RLS: قراءة فقط · البوّابة الحسّاسة على كلّ طرف تكلفة/إيراد · لا VIEW
    select 'E.rls' where
      exists (select 1 from pg_policies p where p.schemaname = 'public'
               and p.tablename like 'fin\_%' and p.cmd <> 'SELECT')
      or exists (select 1 from pg_policies p where p.schemaname = 'public'
                  and p.tablename like 'fin\_%'
                  and (coalesce(p.qual,'') ilike '%can_view_collections%'
                    or coalesce(p.qual,'') ilike '%can_record_collection%'
                    or coalesce(p.qual,'') ilike '%finops_perm%'))
      or exists (select 1 from sensitive_tbl v
                  where not exists (select 1 from pg_policies p
                                     where p.schemaname = 'public' and p.tablename = v.t
                                       and coalesce(p.qual,'') ilike '%finops_can_view_finance_sensitive%'))
      or exists (select 1 from pg_views where schemaname = 'public' and viewname like 'fin\_%')
    union all
    -- F · anon/PUBLIC بلا شيء — وACL غير NULL (NULL على دالّة = EXECUTE لـPUBLIC)
    select 'F.anon_zero' where
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'finops\_%' and p.proacl is null)
      or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   cross join lateral aclexplode(p.proacl) a
                  where n.nspname = 'public' and p.proname like 'finops\_%'
                    and (a.grantee = 0 or a.grantee = to_regrole('anon')::oid))
      or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   cross join lateral aclexplode(c.relacl) a
                  where n.nspname = 'public' and c.relname like 'fin\_%'
                    and (a.grantee = 0 or a.grantee = to_regrole('anon')::oid))
    union all
    -- F2 · المِجَسّ ليس أجوف: anon يملك صلاحيات في مكان آخر من public
    select 'F.anon_probe_vacuous' where not (
      to_regrole('anon') is not null
      and (exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     cross join lateral aclexplode(c.relacl) a
                    where n.nspname = 'public' and a.grantee = to_regrole('anon')::oid)
        or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     cross join lateral aclexplode(p.proacl) a
                    where n.nspname = 'public' and a.grantee = to_regrole('anon')::oid)))
    union all
    -- G · authenticated: allowlist دقيق · لا داخليّة · لا كتابة جدولية
    select 'G.authenticated_surface' where
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'finops\_%'
                 and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 and p.proname not in (
                   'finops_access','finops_lookups','finops_request_lookups','finops_budgets_list',
                   'finops_budget_variance','finops_costs_list','finops_suppliers_list',
                   'finops_expense_requests_list','finops_my_requests','finops_purchase_list',
                   'finops_receivables','finops_collections_list','finops_collections_summary',
                   'finops_profitability','finops_dashboard','finops_audit_list','finops_export',
                   'finops_zoho_diagnostic','finops_cost_center_upsert','finops_category_upsert',
                   'finops_supplier_upsert','finops_threshold_upsert','finops_budget_upsert',
                   'finops_budget_line_upsert','finops_contract_upsert','finops_revenue_upsert',
                   'finops_retainer_upsert','finops_receivable_upsert','finops_collection_record',
                   'finops_milestone_upsert','finops_cost_upsert','finops_expense_request_submit',
                   'finops_expense_decide','finops_expense_mark_paid','finops_expense_second_approve',
                   'finops_purchase_request_submit','finops_purchase_item_upsert',
                   'finops_purchase_decide','finops_po_upsert','finops_po_item_upsert',
                   'finops_po_set_status','finops_attachment_add','finops_row_delete',
                   'finops_zoho_outbox_enqueue','finops_zoho_outbox_replay',
                   'finops_can_view_finance_sensitive','finops_can_manage_finance',
                   'finops_can_manage_suppliers','finops_can_view_collections',
                   'finops_can_record_collection','finops_can_approve_expense',
                   'finops_can_export_sensitive','finops_can_export_collections','finops_can_view',
                   'finops_can_manage','finops_can_approve','finops_can_view_profit',
                   'finops_can_manage_receivables','finops_can_export','finops_can_request',
                   'finops_is_client','finops_is_finance_role','finops_perm'))
      or exists (select 1 from internal i
                  join pg_proc p on p.proname = i.name
                  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
                 where has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      or exists (select 1 from information_schema.role_table_grants g
                  where g.table_schema = 'public' and g.table_name like 'fin\_%'
                    and g.grantee = 'authenticated' and g.privilege_type <> 'SELECT')
      or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname like 'finops\_%'
                    and (not p.prosecdef
                      or coalesce(array_to_string(p.proconfig, ','), '') not ilike '%search_path%'))
    union all
    -- H · لا مُسنَد يعيد NULL (استدعاء حيّ آمن — لا بوّابة في أيّ منها)
    select 'H.predicates_null' where not coalesce((
      select bool_and(v is not null and v = false) from (values
        (public.finops_can_view_finance_sensitive()),(public.finops_can_manage_finance()),
        (public.finops_can_manage_suppliers()),(public.finops_can_view_collections()),
        (public.finops_can_record_collection()),(public.finops_can_approve_expense()),
        (public.finops_can_export_sensitive()),(public.finops_can_export_collections()),
        (public.finops_can_view()),(public.finops_can_manage()),(public.finops_can_approve()),
        (public.finops_can_view_profit()),(public.finops_can_manage_receivables()),
        (public.finops_can_export()),(public.finops_can_request()),
        (public.finops_perm('finance_ops.collections_view')),(public.finops_perm(null))) s(v)), false)
    union all
    -- I · العميل مستبعد بنيويًّا من كلّ بوّابة جلسة
    select 'I.client_excluded' where exists (
      select 1 from (values ('finops_can_view_finance_sensitive'),('finops_can_view_collections'),
                            ('finops_can_record_collection'),('finops_can_approve_expense'),
                            ('finops_can_request')) v(n)
        join fb b on b.name = v.n where b.body !~ '\mis_staff\M')
    union all
    -- J · Zoho: لا حالة إرسال، لا مكالمة، لا بيانات اعتماد
    select 'J.zoho' where
      not coalesce((select b.body ilike '%''connected'', false%'
                     from fb b where b.name = 'finops_zoho_diagnostic'), false)
      or exists (select 1 from pg_constraint
                  where conrelid = 'public.fin_zoho_outbox'::regclass and contype = 'c'
                    and (pg_get_constraintdef(oid) ilike '%''sent''%'
                      or pg_get_constraintdef(oid) ilike '%''synced''%'
                      or pg_get_constraintdef(oid) ilike '%''delivered''%'))
      or exists (select 1 from fb b
                  where b.body ~ '\m(pg_net|dblink|http_post|http_get)\M'
                     or b.body ~ '(client_secret|refresh_token|access_token|api_key|service_role)')
    union all
    -- K · تجميد منصّة المشاريع
    select 'K.project_freeze' where
      exists (select 1 from fb b
               where b.body ~ 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M'
                  or b.body ~ 'update\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M'
                  or b.body ~ 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\M')
      or exists (select 1 from pg_constraint
                  where conname like 'fin\_%\_project\_fk' and confdeltype <> 'n')
    union all
    -- L · الحزم الثلاث المطبَّقة سليمة (وجود + RLS، بقائمة صريحة)
    select 'L.applied_packages' where
      exists (select 1 from ap where not exists (
               select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r','p')
                  and c.relname = ap.t and c.relrowsecurity))
      or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'comms\_%')
      or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'ops\_%')
      or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like 'crm\_%')
    union all
    -- M · RLS مفعّلة على الجداول الاثنين والعشرين (قائمة صريحة لا نمط)
    select 'M.rls_enabled' where exists (
      select 1 from (values
        ('fin_cost_centers'),('fin_expense_categories'),('fin_suppliers'),('fin_budgets'),
        ('fin_budget_lines'),('fin_contracts'),('fin_revenue'),('fin_retainers'),
        ('fin_receivables'),('fin_collections'),('fin_payment_milestones'),
        ('fin_approval_thresholds'),('fin_expense_requests'),('fin_expense_approvals'),
        ('fin_purchase_requests'),('fin_purchase_request_items'),('fin_purchase_orders'),
        ('fin_purchase_order_items'),('fin_costs'),('fin_attachments'),('fin_audit'),
        ('fin_zoho_outbox')) t(n)
       where not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                          where ns.nspname = 'public' and c.relname = t.n and c.relrowsecurity)))
  select count(*), string_agg(id, ', ' order by id) into v_fail, v_names from failures;

  if v_fail > 0 then
    raise exception 'FINANCE POSTCHECK FAILED — % مجموعة فحص ساقطة: %. لا تفتح docs/FINANCE_GO_LIVE_GUIDE.md قبل أن تخضرّ كلّها.', v_fail, v_names;
  end if;
  raise notice 'FINANCE POSTCHECK COMPLETE — قراءة فقط، لا فشل. المالية الحسّاسة للمالك وحده بانحدارٍ مُثبَت على رسم النداء (أقصى عمق ≥ ٢)، والتحصيل معزول عن طرف التكلفة بـallowlist جداول، وanon بلا شيء، والحزم الثلاث المطبَّقة سليمة.';
end $verdict$;
