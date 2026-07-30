-- ════════════════════════════════════════════════════════════════════════════
-- crm_sales_FOUNDATION_POSTCHECK.sql                  (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد crm_sales_FOUNDATION_RUNME.sql. كلّ استعلام SELECT صِرف.
-- كلّ قسم مكتوب بحيث تكون النتيجة المتوقّعة صريحة: لا «يبدو أنّه نجح».
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجداول التسعة عشر موجودة وRLS مفعّلة ────────────────────────────
-- متوقّع: 19 صفًّا، present = true وrls = true في كلّها.
select t.name,
       (to_regclass('public.' || t.name) is not null) as present,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.name), false) as rls
from (values ('crm_settings'),('crm_teams'),('crm_team_members'),('crm_companies'),('crm_contacts'),
             ('crm_competitors'),('crm_lead_score_rules'),('crm_leads'),('crm_pipelines'),('crm_stages'),
             ('crm_opportunities'),('crm_stage_history'),('crm_activities'),('crm_targets'),
             ('crm_commission_plans'),('crm_commission_assignments'),('crm_commission_records'),
             ('crm_import_batches'),('crm_audit')) t(name);

-- ─── 2) لا سياسة كتابة مباشرة على أيّ جدول ────────────────────────────────
-- متوقّع: صفر صفّ. أيّ صفّ هنا يعني أنّ الكتابة تتجاوز الـRPC.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename like 'crm\_%' and cmd <> 'SELECT';

-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ────────────────────────
-- متوقّع: صفر صفّ في كليهما.
select table_name, privilege_type, grantee from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'crm\_%' and grantee = 'anon';

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%'
  and exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ─── 4) الجداول: SELECT فقط لـauthenticated ──────────────────────────────
-- متوقّع: صفر صفّ (لا INSERT/UPDATE/DELETE ممنوحة).
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'crm\_%' and grantee = 'authenticated'
  and privilege_type <> 'SELECT';

-- ─── 5) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت ─────────────
-- متوقّع: كلّ الصفوف security_definer = true وpinned_search_path = true.
select p.proname,
       p.prosecdef as security_definer,
       (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%'
order by p.proname;

-- ─── 6) الدوالّ الداخلية لا تُنفَّذ من الواجهة ────────────────────────────
-- متوقّع: false في كلّ صفّ.
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_exec
from (values ('public.crm_log(text,text,uuid,jsonb)'),
             ('public.crm_visible_leads()'),
             ('public.crm_visible_opportunities()'),
             ('public.crm_score_core(uuid)'),
             ('public.crm_readiness_core(uuid)'),
             ('public.crm_duplicate_core(text,text,text,text,uuid)'),
             ('public.crm_commission_recalc_core(uuid)'),
             ('public.crm_next_code(text)'),
             ('public.crm_project_label(uuid)'),
             ('public.crm_quote_ref(uuid)')) f(sig)
where to_regprocedure(f.sig) is not null
  and exists (select 1 from pg_roles where rolname = 'authenticated');

-- ─── 7) المُسنَدات لا تعيد NULL (تشغيل بدور postgres ⇒ auth.uid() = NULL) ─
-- متوقّع: صفّ واحد، كلّ الأعمدة = false ولا واحد NULL.
select public.crm_can_view()                 as can_view,
       public.crm_can_manage()               as can_manage,
       public.crm_can_view_team()            as can_view_team,
       public.crm_can_see_owner(null)        as see_owner_null,
       public.crm_can_read_lead(null)        as read_lead_null,
       public.crm_can_view_commission(null)  as view_commission,
       public.crm_can_manage_targets()       as manage_targets,
       public.crm_can_manage_commission()    as manage_commission,
       public.crm_can_import()               as can_import,
       public.crm_perm('crm.manage')         as perm_manage,
       public.crm_is_client()                as is_client;

-- ─── 8) مِجَسّ الكشف يعمل بلا جلسة ولا يمنح شيئًا ────────────────────────
-- متوقّع: ok = true · authenticated = false · can_view = false.
select public.crm_access() as access_probe;

-- ─── 9) البذور ───────────────────────────────────────────────────────────
-- متوقّع: pipelines = 1 · stages = 7 (منها won = 1 وlost = 1) · rules ≥ 12
--         settings ≥ 6 · permissions = 11.
select (select count(*) from public.crm_pipelines where key = 'default')                    as default_pipeline,
       (select count(*) from public.crm_stages s join public.crm_pipelines p on p.id = s.pipeline_id
         where p.key = 'default')                                                            as stages,
       (select count(*) from public.crm_stages where is_won)                                 as won_stages,
       (select count(*) from public.crm_stages where is_lost)                                as lost_stages,
       (select count(*) from public.crm_lead_score_rules)                                    as score_rules,
       (select count(*) from public.crm_settings)                                            as settings,
       (select count(*) from public.permissions where key like 'crm.%')                      as permission_keys;

-- ─── 10) الترحيلة لم تُنشئ بيانات عمل ────────────────────────────────────
-- متوقّع: صفر في الثلاثة على قاعدة جديدة (وعلى قاعدة فيها بيانات، الأعداد هي
-- بياناتك أنت — الفحص الحاسم هو self-test داخل الترحيلة نفسها).
select (select count(*) from public.crm_leads)         as leads,
       (select count(*) from public.crm_opportunities) as opportunities,
       (select count(*) from public.crm_audit)         as audit_rows;

-- ─── 11) الدرجة مشتقّة لا محفوظة ─────────────────────────────────────────
-- متوقّع: صفر صفّ (لا عمود اسمه score على crm_leads).
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'crm_leads' and column_name = 'score';

-- متوقّع: الأعمدة الثلاثة المعلَنة للتعديل اليدويّ موجودة.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'crm_leads'
  and column_name in ('score_manual_adjust','score_override','score_override_reason');

-- ─── 12) تطبيع العربية والهاتف يعمل — أساس كشف التكرار ──────────────────
-- متوقّع: same_company = true · same_phone = true · short_phone_null = true.
select (public.crm_norm_text('شركة الكِيان') = public.crm_norm_text('شركه الكيان')) as same_company,
       (public.crm_norm_phone('+966551234567') = public.crm_norm_phone('0551234567')) as same_phone,
       (public.crm_norm_phone('12345') is null) as short_phone_null,
       (public.crm_norm_email(' A@B.CO ') = 'a@b.co') as email_normalized;

-- ─── 13) ★ عقد التسليم: لا كتابة في منصّة المشاريع ولا في quote_requests ─
-- متوقّع: صفر صفّ. أيّ صفّ = خرق العقد.
select p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%'
  and (pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\b'
    or pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?quote_requests\b');

-- متوقّع: صفر صفّ — لا دالّة crm_* تتّكئ على can_manage_projects.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%'
  and pg_get_functiondef(p.oid) ilike '%can_manage_projects%';

-- ─── 14) ★ فصل صلاحية العمولة عن إدارة المبيعات ─────────────────────────
-- متوقّع: uses_own_key = true · leaks_via_manage = false.
select (pg_get_functiondef(to_regprocedure('public.crm_can_view_commission(uuid)')) ilike '%crm.view_commission%') as uses_own_key,
       (pg_get_functiondef(to_regprocedure('public.crm_can_view_commission(uuid)')) ilike '%crm_can_manage()%')    as leaks_via_manage;

-- متوقّع: true في الأربعة (منع تحرير الهدف الذاتيّ والعمولة الذاتية).
select (pg_get_functiondef(to_regprocedure('public.crm_target_upsert(jsonb)')) ilike '%self_target_denied%')            as target_self_blocked,
       (pg_get_functiondef(to_regprocedure('public.crm_target_delete(uuid,text)')) ilike '%self_target_denied%')        as target_delete_self_blocked,
       (pg_get_functiondef(to_regprocedure('public.crm_commission_assign(jsonb)')) ilike '%self_commission_denied%')    as commission_self_blocked,
       (pg_get_functiondef(to_regprocedure('public.crm_commission_set_status(uuid,text,text)')) ilike '%self_commission_denied%') as approve_self_blocked;

-- ─── 15) المفاتيح الخارجية الاختيارية أُضيفت مرّة واحدة فقط ──────────────
-- متوقّع: صفّ واحد لكلّ قيد موجود، وdelete_action = 'n' (SET NULL).
select conname, confdeltype as delete_action
from pg_constraint where conname in ('crm_opp_quote_fk','crm_opp_project_fk');

-- ─── 16) المُشغِّلات موجودة — التطبيع لا يُترك لحسن نيّة المُدرِج ────────
-- متوقّع: 4 صفوف.
select tgname, tgrelid::regclass::text as on_table
from pg_trigger where not tgisinternal
  and tgname in ('t_crm_lead_norm','t_crm_contact_norm','t_crm_company_norm','t_crm_competitor_norm');

-- ─── 17) تجميد منصّة المشاريع — قارن بلقطة PREFLIGHT ────────────────────
-- متوقّع: أرقام مطابقة تمامًا لما خرج في PREFLIGHT §7.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'projects') as projects_columns,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'quote_requests') as quote_columns;

-- ─── 18) عدد الدوالّ المنشأة ─────────────────────────────────────────────
-- متوقّع: 84 دالّة crm_*.
select count(*) as crm_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'crm\_%';
