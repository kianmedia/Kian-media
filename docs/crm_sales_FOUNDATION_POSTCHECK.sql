-- ════════════════════════════════════════════════════════════════════════════
-- crm_sales_FOUNDATION_POSTCHECK.sql                  (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد crm_sales_FOUNDATION_RUNME.sql. كلّ استعلام SELECT صِرف.
-- كلّ قسم مكتوب بحيث تكون النتيجة المتوقّعة صريحة: لا «يبدو أنّه نجح».
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجداول العشرون موجودة وRLS مفعّلة ───────────────────────────────
-- متوقّع: 20 صفًّا، present = true وrls = true في كلّها.
select t.name,
       (to_regclass('public.' || t.name) is not null) as present,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.name), false) as rls
from (values ('crm_settings'),('crm_teams'),('crm_team_members'),('crm_companies'),('crm_contacts'),
             ('crm_competitors'),('crm_lead_score_rules'),('crm_leads'),('crm_pipelines'),('crm_stages'),
             ('crm_opportunities'),('crm_stage_history'),('crm_activities'),('crm_targets'),
             ('crm_commission_plans'),('crm_commission_assignments'),('crm_commission_records'),
             ('crm_import_batches'),('crm_audit'),('crm_approval_requests')) t(name);

-- ─── 2) لا سياسة كتابة مباشرة على أيّ جدول ────────────────────────────────
-- متوقّع: صفر صفّ. أيّ صفّ هنا يعني أنّ الكتابة تتجاوز الـRPC.
-- ⚠️ النطاق: كائنات Foundation وحدها. ومسحُ فضاء crm_% يلتقط دوالّ
--    Wave 4 (8 منها) فيُدين حزمةً بجارٍ لها في الاسم.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and cmd <> 'SELECT'
  and tablename::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests');

-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ────────────────────────
-- متوقّع: صفر صفّ في كليهما.
-- ⛔ والنطاق هنا أيضًا **جداول Foundation العشرون** لا فضاء crm_%:
--    `crm_opportunity_tender` و`crm_testimonial_invites`
--    و`crm_client_health_v` من إنتاج Wave 4، وACL كلٍّ منها مسؤولية حزمته.
select table_name, privilege_type, grantee from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and table_name::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests');

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 النطاق: دوالّ **Foundation** وحدها — لا مسحُ فضاء الأسماء crm_%
--
-- ★ الإنذار الكاذب الذي أعطاه هذا الفحص على Preview ★
--   `proname like 'crm\_%'` يمسح **كلّ** ما يبدأ بـcrm، فالتقط
--   `crm_testimonial_invite_check(text)` — وهي دالّة **Wave 4**، وanon يملك
--   تنفيذها **عمدًا**: فحص رمز دعوة الشهادة قبل تسجيل الدخول
--   (`wave4_crm_business_RUNME.sql:528`). ⇒ حزمةٌ سليمة تُبلَّغ مخالِفة
--   بسبب جارٍ لها في فضاء الأسماء.
--
-- ⛔ ولا يُعالَج باستثناء اسمٍ بعينه: ذلك يُخفي أيّ دالّة Wave 4 لاحقة تُمنح
--    لـanon بالخطأ. العلاج **حصر النطاق**: قائمة Foundation مستخرَجة من
--    `crm_sales_FOUNDATION_RUNME.sql` بالاسم **والتوقيع** (93 دالّة).
-- ⚠️ والمقارنة بـ`oidvectortypes` لا `pg_get_function_identity_arguments`:
--    الأخيرة تُعيد أسماء الوسائط مع أنواعها، فلا تُطابِق توقيعًا مكتوبًا.
-- ════════════════════════════════════════════════════════════════════════════
with foundation_fn(fname, fargs) as (values
  ('crm_perm','text'),
  ('crm_perm_key_exists','text'),
  ('crm_is_owner_role',''),
  ('crm_can_manage',''),
  ('crm_can_view',''),
  ('crm_is_client',''),
  ('crm_can_view_commission','uuid'),
  ('crm_can_manage_commission',''),
  ('crm_can_manage_targets',''),
  ('crm_can_approve_changes',''),
  ('crm_can_manage_pipeline',''),
  ('crm_can_manage_scoring',''),
  ('crm_can_import',''),
  ('crm_can_view_team',''),
  ('crm_can_see_owner','uuid'),
  ('crm_can_read_lead','uuid'),
  ('crm_can_edit_lead','uuid'),
  ('crm_can_read_opportunity','uuid'),
  ('crm_can_edit_opportunity','uuid'),
  ('crm_can_read_activity','uuid'),
  ('crm_log','text, text, uuid, jsonb'),
  ('crm_notify','uuid, text, uuid, text, text'),
  ('crm_norm_text','text'),
  ('crm_norm_email','text'),
  ('crm_norm_phone','text'),
  ('crm_normalize_lead',''),
  ('crm_normalize_contact',''),
  ('crm_normalize_company',''),
  ('crm_normalize_competitor',''),
  ('crm_touch',''),
  ('crm_setting_int','text, integer'),
  ('crm_setting_text','text, text'),
  ('crm_project_label','uuid'),
  ('crm_quote_ref','uuid'),
  ('crm_next_code','text'),
  ('crm_score_core','uuid'),
  ('crm_duplicate_core','text, text, text, text, uuid'),
  ('crm_readiness_core','uuid'),
  ('crm_visible_leads',''),
  ('crm_visible_opportunities',''),
  ('crm_access',''),
  ('crm_lookups',''),
  ('crm_leads_list','jsonb'),
  ('crm_lead_detail','uuid'),
  ('crm_duplicates','jsonb'),
  ('crm_opportunities_list','jsonb'),
  ('crm_opportunity_detail','uuid'),
  ('crm_pipeline_board','jsonb'),
  ('crm_forecast','jsonb'),
  ('crm_stale_alerts','jsonb'),
  ('crm_activities_list','jsonb'),
  ('crm_targets_list','jsonb'),
  ('crm_commission_list','jsonb'),
  ('crm_dashboard','jsonb'),
  ('crm_export','text, jsonb'),
  ('crm_audit_list','jsonb'),
  ('crm_approvals_list','jsonb'),
  ('crm_import_preview','jsonb, text'),
  ('crm_company_upsert','jsonb'),
  ('crm_contact_upsert','jsonb'),
  ('crm_competitor_upsert','jsonb'),
  ('crm_lead_upsert','jsonb'),
  ('crm_lead_set_status','uuid, text, text'),
  ('crm_lead_score_adjust','jsonb'),
  ('crm_lead_convert','uuid, jsonb'),
  ('crm_lead_delete','uuid, text'),
  ('crm_opportunity_upsert','jsonb'),
  ('crm_opportunity_link_quote','uuid, uuid'),
  ('crm_opportunity_set_stage','uuid, uuid, text'),
  ('crm_opportunity_close','uuid, text, jsonb'),
  ('crm_opportunity_reopen','uuid, text'),
  ('crm_opportunity_delete','uuid, text'),
  ('crm_handoff_confirm','uuid, jsonb'),
  ('crm_activity_log','jsonb'),
  ('crm_activity_delete','uuid, text'),
  ('crm_score_rule_upsert','jsonb'),
  ('crm_settings_set','text, jsonb'),
  ('crm_team_upsert','jsonb'),
  ('crm_team_member_set','jsonb'),
  ('crm_approval_submit_core','text, uuid, uuid, jsonb, text'),
  ('crm_target_apply_core','jsonb, uuid'),
  ('crm_target_upsert','jsonb'),
  ('crm_target_delete','uuid, text'),
  ('crm_commission_recalc_core','uuid'),
  ('crm_commission_recalc','uuid'),
  ('crm_commission_plan_apply_core','jsonb, uuid'),
  ('crm_commission_plan_upsert','jsonb'),
  ('crm_commission_assign_core','jsonb, uuid'),
  ('crm_commission_assign','jsonb'),
  ('crm_approval_decide','uuid, text, text'),
  ('crm_approval_withdraw','uuid, text'),
  ('crm_commission_set_status','uuid, text, text'),
  ('crm_import_leads','jsonb, text')
)
select p.proname, pg_catalog.oidvectortypes(p.proargtypes) as args
from foundation_fn k
join pg_proc p on p.proname = k.fname
             and p.pronamespace = 'public'::regnamespace
             and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs
where exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ─── 4) الجداول: SELECT فقط لـauthenticated ──────────────────────────────
-- متوقّع: صفر صفّ (لا INSERT/UPDATE/DELETE ممنوحة).
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
  and privilege_type <> 'SELECT'
  and table_name::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests');

-- ─── 5) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت ─────────────
-- متوقّع: كلّ الصفوف security_definer = true وpinned_search_path = true.
select p.proname,
       p.prosecdef as security_definer,
       (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned_search_path
-- ⚠️ النطاق: كائنات Foundation وحدها. ومسحُ فضاء crm_% يلتقط دوالّ
--    Wave 4 (8 منها) فيُدين حزمةً بجارٍ لها في الاسم.
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('crm_access','crm_activities_list','crm_activity_delete','crm_activity_log','crm_approval_decide','crm_approval_submit_core','crm_approval_withdraw','crm_approvals_list','crm_audit_list','crm_can_approve_changes','crm_can_edit_lead','crm_can_edit_opportunity','crm_can_import','crm_can_manage','crm_can_manage_commission','crm_can_manage_pipeline','crm_can_manage_scoring','crm_can_manage_targets','crm_can_read_activity','crm_can_read_lead','crm_can_read_opportunity','crm_can_see_owner','crm_can_view','crm_can_view_commission','crm_can_view_team','crm_commission_assign','crm_commission_assign_core','crm_commission_list','crm_commission_plan_apply_core','crm_commission_plan_upsert','crm_commission_recalc','crm_commission_recalc_core','crm_commission_set_status','crm_company_upsert','crm_competitor_upsert','crm_contact_upsert','crm_dashboard','crm_duplicate_core','crm_duplicates','crm_export','crm_forecast','crm_handoff_confirm','crm_import_leads','crm_import_preview','crm_is_client','crm_is_owner_role','crm_lead_convert','crm_lead_delete','crm_lead_detail','crm_lead_score_adjust','crm_lead_set_status','crm_lead_upsert','crm_leads_list','crm_log','crm_lookups','crm_next_code','crm_norm_email','crm_norm_phone','crm_norm_text','crm_normalize_company','crm_normalize_competitor','crm_normalize_contact','crm_normalize_lead','crm_notify','crm_opportunities_list','crm_opportunity_close','crm_opportunity_delete','crm_opportunity_detail','crm_opportunity_link_quote','crm_opportunity_reopen','crm_opportunity_set_stage','crm_opportunity_upsert','crm_perm','crm_perm_key_exists','crm_pipeline_board','crm_project_label','crm_quote_ref','crm_readiness_core','crm_score_core','crm_score_rule_upsert','crm_setting_int','crm_setting_text','crm_settings_set','crm_stale_alerts','crm_target_apply_core','crm_target_delete','crm_target_upsert','crm_targets_list','crm_team_member_set','crm_team_upsert','crm_touch','crm_visible_leads','crm_visible_opportunities')
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
where n.nspname = 'public' and p.proname in ('crm_access','crm_activities_list','crm_activity_delete','crm_activity_log','crm_approval_decide','crm_approval_submit_core','crm_approval_withdraw','crm_approvals_list','crm_audit_list','crm_can_approve_changes','crm_can_edit_lead','crm_can_edit_opportunity','crm_can_import','crm_can_manage','crm_can_manage_commission','crm_can_manage_pipeline','crm_can_manage_scoring','crm_can_manage_targets','crm_can_read_activity','crm_can_read_lead','crm_can_read_opportunity','crm_can_see_owner','crm_can_view','crm_can_view_commission','crm_can_view_team','crm_commission_assign','crm_commission_assign_core','crm_commission_list','crm_commission_plan_apply_core','crm_commission_plan_upsert','crm_commission_recalc','crm_commission_recalc_core','crm_commission_set_status','crm_company_upsert','crm_competitor_upsert','crm_contact_upsert','crm_dashboard','crm_duplicate_core','crm_duplicates','crm_export','crm_forecast','crm_handoff_confirm','crm_import_leads','crm_import_preview','crm_is_client','crm_is_owner_role','crm_lead_convert','crm_lead_delete','crm_lead_detail','crm_lead_score_adjust','crm_lead_set_status','crm_lead_upsert','crm_leads_list','crm_log','crm_lookups','crm_next_code','crm_norm_email','crm_norm_phone','crm_norm_text','crm_normalize_company','crm_normalize_competitor','crm_normalize_contact','crm_normalize_lead','crm_notify','crm_opportunities_list','crm_opportunity_close','crm_opportunity_delete','crm_opportunity_detail','crm_opportunity_link_quote','crm_opportunity_reopen','crm_opportunity_set_stage','crm_opportunity_upsert','crm_perm','crm_perm_key_exists','crm_pipeline_board','crm_project_label','crm_quote_ref','crm_readiness_core','crm_score_core','crm_score_rule_upsert','crm_setting_int','crm_setting_text','crm_settings_set','crm_stale_alerts','crm_target_apply_core','crm_target_delete','crm_target_upsert','crm_targets_list','crm_team_member_set','crm_team_upsert','crm_touch','crm_visible_leads','crm_visible_opportunities')
  and (pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\b'
    or pg_get_functiondef(p.oid) ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?quote_requests\b');

-- متوقّع: صفر صفّ — لا دالّة crm_* تتّكئ على can_manage_projects.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('crm_access','crm_activities_list','crm_activity_delete','crm_activity_log','crm_approval_decide','crm_approval_submit_core','crm_approval_withdraw','crm_approvals_list','crm_audit_list','crm_can_approve_changes','crm_can_edit_lead','crm_can_edit_opportunity','crm_can_import','crm_can_manage','crm_can_manage_commission','crm_can_manage_pipeline','crm_can_manage_scoring','crm_can_manage_targets','crm_can_read_activity','crm_can_read_lead','crm_can_read_opportunity','crm_can_see_owner','crm_can_view','crm_can_view_commission','crm_can_view_team','crm_commission_assign','crm_commission_assign_core','crm_commission_list','crm_commission_plan_apply_core','crm_commission_plan_upsert','crm_commission_recalc','crm_commission_recalc_core','crm_commission_set_status','crm_company_upsert','crm_competitor_upsert','crm_contact_upsert','crm_dashboard','crm_duplicate_core','crm_duplicates','crm_export','crm_forecast','crm_handoff_confirm','crm_import_leads','crm_import_preview','crm_is_client','crm_is_owner_role','crm_lead_convert','crm_lead_delete','crm_lead_detail','crm_lead_score_adjust','crm_lead_set_status','crm_lead_upsert','crm_leads_list','crm_log','crm_lookups','crm_next_code','crm_norm_email','crm_norm_phone','crm_norm_text','crm_normalize_company','crm_normalize_competitor','crm_normalize_contact','crm_normalize_lead','crm_notify','crm_opportunities_list','crm_opportunity_close','crm_opportunity_delete','crm_opportunity_detail','crm_opportunity_link_quote','crm_opportunity_reopen','crm_opportunity_set_stage','crm_opportunity_upsert','crm_perm','crm_perm_key_exists','crm_pipeline_board','crm_project_label','crm_quote_ref','crm_readiness_core','crm_score_core','crm_score_rule_upsert','crm_setting_int','crm_setting_text','crm_settings_set','crm_stale_alerts','crm_target_apply_core','crm_target_delete','crm_target_upsert','crm_targets_list','crm_team_member_set','crm_team_upsert','crm_touch','crm_visible_leads','crm_visible_opportunities')
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

-- ─── 18) ★★ موافقة المالك على الهدف وقاعدة العمولة ──────────────────────
-- متوقّع: owner_only = true (المُسنَد يشترط دور المالك)
--         buyable_with_key = false (لا يمرّ عبر crm_perm — لا يُمنح بمفتاح).
select (pg_get_functiondef(to_regprocedure('public.crm_can_approve_changes()')) ilike '%crm_is_owner_role%') as owner_only,
       (pg_get_functiondef(to_regprocedure('public.crm_can_approve_changes()')) ilike '%crm_perm%')          as buyable_with_key,
       public.crm_can_approve_changes() as approve_without_session;   -- متوقّع: false لا NULL

-- متوقّع: 4 صفوف، gated = true وannounces_pending = true في كلّها.
select f.sig,
       (pg_get_functiondef(to_regprocedure(f.sig)) ilike '%crm_can_approve_changes()%') as gated,
       (pg_get_functiondef(to_regprocedure(f.sig)) ilike '%pending_approval%')          as announces_pending
from (values ('public.crm_target_upsert(jsonb)'),
             ('public.crm_target_delete(uuid,text)'),
             ('public.crm_commission_plan_upsert(jsonb)'),
             ('public.crm_commission_assign(jsonb)')) f(sig);

-- متوقّع: صفر صفّ — لا طلب معلَّق أنشأته الترحيلة.
select count(*) as pending_requests from public.crm_approval_requests where status = 'pending';

-- ─── 19) ★★ معاينة الاستيراد تشغيل جافّ ─────────────────────────────────
-- متوقّع: volatility = 's' (STABLE — PostgreSQL يمنعها من الكتابة)
--         writes_anything = false · declares_dry_run = true.
select p.provolatile as volatility,
       (pg_get_functiondef(p.oid) ~* '(insert\s+into|update\s+public|delete\s+from)') as writes_anything,
       (pg_get_functiondef(p.oid) ilike '%wrote_nothing%')                            as declares_dry_run
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'crm_import_preview';

-- ─── 20) عدد الدوالّ المنشأة ─────────────────────────────────────────────
-- متوقّع: 93 دالّة **Foundation**.
-- 🔴 وكان العدّ على فضاء crm_% كلّه، فتطبيقُ Wave 4 يرفعه إلى 101 ويُظهر
--    Foundation ناقصةً أو زائدة — إنذار كاذب مؤجَّل. النطاق يحسمه.
select count(*) as crm_foundation_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('crm_access','crm_activities_list','crm_activity_delete','crm_activity_log','crm_approval_decide','crm_approval_submit_core','crm_approval_withdraw','crm_approvals_list','crm_audit_list','crm_can_approve_changes','crm_can_edit_lead','crm_can_edit_opportunity','crm_can_import','crm_can_manage','crm_can_manage_commission','crm_can_manage_pipeline','crm_can_manage_scoring','crm_can_manage_targets','crm_can_read_activity','crm_can_read_lead','crm_can_read_opportunity','crm_can_see_owner','crm_can_view','crm_can_view_commission','crm_can_view_team','crm_commission_assign','crm_commission_assign_core','crm_commission_list','crm_commission_plan_apply_core','crm_commission_plan_upsert','crm_commission_recalc','crm_commission_recalc_core','crm_commission_set_status','crm_company_upsert','crm_competitor_upsert','crm_contact_upsert','crm_dashboard','crm_duplicate_core','crm_duplicates','crm_export','crm_forecast','crm_handoff_confirm','crm_import_leads','crm_import_preview','crm_is_client','crm_is_owner_role','crm_lead_convert','crm_lead_delete','crm_lead_detail','crm_lead_score_adjust','crm_lead_set_status','crm_lead_upsert','crm_leads_list','crm_log','crm_lookups','crm_next_code','crm_norm_email','crm_norm_phone','crm_norm_text','crm_normalize_company','crm_normalize_competitor','crm_normalize_contact','crm_normalize_lead','crm_notify','crm_opportunities_list','crm_opportunity_close','crm_opportunity_delete','crm_opportunity_detail','crm_opportunity_link_quote','crm_opportunity_reopen','crm_opportunity_set_stage','crm_opportunity_upsert','crm_perm','crm_perm_key_exists','crm_pipeline_board','crm_project_label','crm_quote_ref','crm_readiness_core','crm_score_core','crm_score_rule_upsert','crm_setting_int','crm_setting_text','crm_settings_set','crm_stale_alerts','crm_target_apply_core','crm_target_delete','crm_target_upsert','crm_targets_list','crm_team_member_set','crm_team_upsert','crm_touch','crm_visible_leads','crm_visible_opportunities');


-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- ★ لماذا أُضيف ★ Final Preview Sweep أعطى «11/11 PASSED» بحالة خروج 0 بينما
--   كانت السجلّات تحمل صفوفًا حمراء. والسبب أنّ هذا الملفّ كان **SELECT صِرفًا**:
--   يطبع 🔴 ثمّ ينتهي بحالة 0، فالمِكنسة تقيس خروج psql لا نتيجة الفحص.
--   ⇒ فحصٌ بلا `raise exception` **لا يحرس شيئًا**، مهما كثرت صفوفه.
--
-- ⚠️ ولا يُحوَّل تشخيصيّ إلى حاجب بلا دليل: المحسوب هنا هو **REQUIRED BLOCKER**
--    فقط (وجود الكائنات · RLS · تسريب صلاحية · نظام موازٍ). وما يعتمد على
--    البيانات أو على حزمة اختيارية يبقى مطبوعًا خارج الحسم.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $verdict$
declare v_fail text[] := '{}'; v_o text;
begin
  -- 🔴 النطاق: جداول Foundation العشرون **حصرًا**. وكائنات Wave 4 يفحصها
  --    `wave4_crm_business_POSTCHECK.sql` — ⛔ ولا تتقاطع الحزمتان.
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and grantee::text in ('anon','PUBLIC')
         and table_name::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية جدول لـanon/PUBLIC على جدول Foundation');
  end if;
  -- 🔴 REQUIRED BLOCKER: تنفيذ دالّة من الموديول لـanon.
  -- 🔴 وبالتوقيع: 93 دالّة Foundation. ⛔ ولا استثناء بالاسم — النطاق هو العلاج.
  if exists (
    with foundation_fn(fname, fargs) as (values
      ('crm_perm','text'),
  ('crm_perm_key_exists','text'),
  ('crm_is_owner_role',''),
  ('crm_can_manage',''),
  ('crm_can_view',''),
  ('crm_is_client',''),
  ('crm_can_view_commission','uuid'),
  ('crm_can_manage_commission',''),
  ('crm_can_manage_targets',''),
  ('crm_can_approve_changes',''),
  ('crm_can_manage_pipeline',''),
  ('crm_can_manage_scoring',''),
  ('crm_can_import',''),
  ('crm_can_view_team',''),
  ('crm_can_see_owner','uuid'),
  ('crm_can_read_lead','uuid'),
  ('crm_can_edit_lead','uuid'),
  ('crm_can_read_opportunity','uuid'),
  ('crm_can_edit_opportunity','uuid'),
  ('crm_can_read_activity','uuid'),
  ('crm_log','text, text, uuid, jsonb'),
  ('crm_notify','uuid, text, uuid, text, text'),
  ('crm_norm_text','text'),
  ('crm_norm_email','text'),
  ('crm_norm_phone','text'),
  ('crm_normalize_lead',''),
  ('crm_normalize_contact',''),
  ('crm_normalize_company',''),
  ('crm_normalize_competitor',''),
  ('crm_touch',''),
  ('crm_setting_int','text, integer'),
  ('crm_setting_text','text, text'),
  ('crm_project_label','uuid'),
  ('crm_quote_ref','uuid'),
  ('crm_next_code','text'),
  ('crm_score_core','uuid'),
  ('crm_duplicate_core','text, text, text, text, uuid'),
  ('crm_readiness_core','uuid'),
  ('crm_visible_leads',''),
  ('crm_visible_opportunities',''),
  ('crm_access',''),
  ('crm_lookups',''),
  ('crm_leads_list','jsonb'),
  ('crm_lead_detail','uuid'),
  ('crm_duplicates','jsonb'),
  ('crm_opportunities_list','jsonb'),
  ('crm_opportunity_detail','uuid'),
  ('crm_pipeline_board','jsonb'),
  ('crm_forecast','jsonb'),
  ('crm_stale_alerts','jsonb'),
  ('crm_activities_list','jsonb'),
  ('crm_targets_list','jsonb'),
  ('crm_commission_list','jsonb'),
  ('crm_dashboard','jsonb'),
  ('crm_export','text, jsonb'),
  ('crm_audit_list','jsonb'),
  ('crm_approvals_list','jsonb'),
  ('crm_import_preview','jsonb, text'),
  ('crm_company_upsert','jsonb'),
  ('crm_contact_upsert','jsonb'),
  ('crm_competitor_upsert','jsonb'),
  ('crm_lead_upsert','jsonb'),
  ('crm_lead_set_status','uuid, text, text'),
  ('crm_lead_score_adjust','jsonb'),
  ('crm_lead_convert','uuid, jsonb'),
  ('crm_lead_delete','uuid, text'),
  ('crm_opportunity_upsert','jsonb'),
  ('crm_opportunity_link_quote','uuid, uuid'),
  ('crm_opportunity_set_stage','uuid, uuid, text'),
  ('crm_opportunity_close','uuid, text, jsonb'),
  ('crm_opportunity_reopen','uuid, text'),
  ('crm_opportunity_delete','uuid, text'),
  ('crm_handoff_confirm','uuid, jsonb'),
  ('crm_activity_log','jsonb'),
  ('crm_activity_delete','uuid, text'),
  ('crm_score_rule_upsert','jsonb'),
  ('crm_settings_set','text, jsonb'),
  ('crm_team_upsert','jsonb'),
  ('crm_team_member_set','jsonb'),
  ('crm_approval_submit_core','text, uuid, uuid, jsonb, text'),
  ('crm_target_apply_core','jsonb, uuid'),
  ('crm_target_upsert','jsonb'),
  ('crm_target_delete','uuid, text'),
  ('crm_commission_recalc_core','uuid'),
  ('crm_commission_recalc','uuid'),
  ('crm_commission_plan_apply_core','jsonb, uuid'),
  ('crm_commission_plan_upsert','jsonb'),
  ('crm_commission_assign_core','jsonb, uuid'),
  ('crm_commission_assign','jsonb'),
  ('crm_approval_decide','uuid, text, text'),
  ('crm_approval_withdraw','uuid, text'),
  ('crm_commission_set_status','uuid, text, text'),
  ('crm_import_leads','jsonb, text')
    )
    select 1 from foundation_fn k
    join pg_proc p on p.proname = k.fname
                 and p.pronamespace = 'public'::regnamespace
                 and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs
    where exists (select 1 from pg_roles where rolname='anon')
      and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    v_fail := array_append(v_fail, 'anon ينفّذ دالّة من Foundation');
  end if;

  -- 🔴 REQUIRED BLOCKER: authenticated بأكثر من SELECT (الكتابة عبر RPC حصرًا).
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and grantee::text='authenticated'
         and privilege_type::text <> 'SELECT'
         and table_name::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests')) > 0 then
    v_fail := array_append(v_fail, 'authenticated يملك أكثر من SELECT على جدول Foundation');
  end if;

  -- 🔴 REQUIRED BLOCKER: سياسة كتابة مباشرة تلتفّ على الـRPC.
  if exists (select 1 from pg_policies
              where schemaname='public' and cmd <> 'SELECT'
                and tablename::text in ('crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests')) then
    v_fail := array_append(v_fail, 'سياسة كتابة مباشرة على جدول CRM');
  end if;

  -- 🔴 REQUIRED BLOCKER: SECURITY DEFINER بلا مسار بحث مثبَّت.
  if exists (
    with foundation_fn(fname, fargs) as (values
      ('crm_perm','text'),
  ('crm_perm_key_exists','text'),
  ('crm_is_owner_role',''),
  ('crm_can_manage',''),
  ('crm_can_view',''),
  ('crm_is_client',''),
  ('crm_can_view_commission','uuid'),
  ('crm_can_manage_commission',''),
  ('crm_can_manage_targets',''),
  ('crm_can_approve_changes',''),
  ('crm_can_manage_pipeline',''),
  ('crm_can_manage_scoring',''),
  ('crm_can_import',''),
  ('crm_can_view_team',''),
  ('crm_can_see_owner','uuid'),
  ('crm_can_read_lead','uuid'),
  ('crm_can_edit_lead','uuid'),
  ('crm_can_read_opportunity','uuid'),
  ('crm_can_edit_opportunity','uuid'),
  ('crm_can_read_activity','uuid'),
  ('crm_log','text, text, uuid, jsonb'),
  ('crm_notify','uuid, text, uuid, text, text'),
  ('crm_norm_text','text'),
  ('crm_norm_email','text'),
  ('crm_norm_phone','text'),
  ('crm_normalize_lead',''),
  ('crm_normalize_contact',''),
  ('crm_normalize_company',''),
  ('crm_normalize_competitor',''),
  ('crm_touch',''),
  ('crm_setting_int','text, integer'),
  ('crm_setting_text','text, text'),
  ('crm_project_label','uuid'),
  ('crm_quote_ref','uuid'),
  ('crm_next_code','text'),
  ('crm_score_core','uuid'),
  ('crm_duplicate_core','text, text, text, text, uuid'),
  ('crm_readiness_core','uuid'),
  ('crm_visible_leads',''),
  ('crm_visible_opportunities',''),
  ('crm_access',''),
  ('crm_lookups',''),
  ('crm_leads_list','jsonb'),
  ('crm_lead_detail','uuid'),
  ('crm_duplicates','jsonb'),
  ('crm_opportunities_list','jsonb'),
  ('crm_opportunity_detail','uuid'),
  ('crm_pipeline_board','jsonb'),
  ('crm_forecast','jsonb'),
  ('crm_stale_alerts','jsonb'),
  ('crm_activities_list','jsonb'),
  ('crm_targets_list','jsonb'),
  ('crm_commission_list','jsonb'),
  ('crm_dashboard','jsonb'),
  ('crm_export','text, jsonb'),
  ('crm_audit_list','jsonb'),
  ('crm_approvals_list','jsonb'),
  ('crm_import_preview','jsonb, text'),
  ('crm_company_upsert','jsonb'),
  ('crm_contact_upsert','jsonb'),
  ('crm_competitor_upsert','jsonb'),
  ('crm_lead_upsert','jsonb'),
  ('crm_lead_set_status','uuid, text, text'),
  ('crm_lead_score_adjust','jsonb'),
  ('crm_lead_convert','uuid, jsonb'),
  ('crm_lead_delete','uuid, text'),
  ('crm_opportunity_upsert','jsonb'),
  ('crm_opportunity_link_quote','uuid, uuid'),
  ('crm_opportunity_set_stage','uuid, uuid, text'),
  ('crm_opportunity_close','uuid, text, jsonb'),
  ('crm_opportunity_reopen','uuid, text'),
  ('crm_opportunity_delete','uuid, text'),
  ('crm_handoff_confirm','uuid, jsonb'),
  ('crm_activity_log','jsonb'),
  ('crm_activity_delete','uuid, text'),
  ('crm_score_rule_upsert','jsonb'),
  ('crm_settings_set','text, jsonb'),
  ('crm_team_upsert','jsonb'),
  ('crm_team_member_set','jsonb'),
  ('crm_approval_submit_core','text, uuid, uuid, jsonb, text'),
  ('crm_target_apply_core','jsonb, uuid'),
  ('crm_target_upsert','jsonb'),
  ('crm_target_delete','uuid, text'),
  ('crm_commission_recalc_core','uuid'),
  ('crm_commission_recalc','uuid'),
  ('crm_commission_plan_apply_core','jsonb, uuid'),
  ('crm_commission_plan_upsert','jsonb'),
  ('crm_commission_assign_core','jsonb, uuid'),
  ('crm_commission_assign','jsonb'),
  ('crm_approval_decide','uuid, text, text'),
  ('crm_approval_withdraw','uuid, text'),
  ('crm_commission_set_status','uuid, text, text'),
  ('crm_import_leads','jsonb, text')
    )
    select 1 from foundation_fn k
    join pg_proc p on p.proname = k.fname
                 and p.pronamespace = 'public'::regnamespace
                 and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs
    where p.prosecdef
      and coalesce(array_to_string(p.proconfig,','),'') not ilike '%search_path%') then
    v_fail := array_append(v_fail, 'دالّة Foundation مرتفعة الصلاحية بلا search_path مثبَّت');
  end if;
  foreach v_o in array array['public.crm_settings','public.crm_teams','public.crm_team_members','public.crm_companies','public.crm_contacts','public.crm_competitors','public.crm_lead_score_rules','public.crm_leads','public.crm_pipelines','public.crm_stages','public.crm_opportunities','public.crm_stage_history','public.crm_activities','public.crm_targets','public.crm_commission_plans','public.crm_commission_assignments','public.crm_commission_records','public.crm_import_batches','public.crm_audit','public.crm_approval_requests'] loop
    if to_regclass(v_o) is null then v_fail := array_append(v_fail, 'جدول مفقود '||v_o); end if;
  end loop;
  foreach v_o in array array['crm_settings','crm_teams','crm_team_members','crm_companies','crm_contacts','crm_competitors','crm_lead_score_rules','crm_leads','crm_pipelines','crm_stages','crm_opportunities','crm_stage_history','crm_activities','crm_targets','crm_commission_plans','crm_commission_assignments','crm_commission_records','crm_import_batches','crm_audit','crm_approval_requests'] loop
    if not coalesce((select c.relrowsecurity from pg_class c
                       join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=v_o), false) then
      v_fail := array_append(v_fail, 'RLS مطفأ على '||v_o);
    end if;
  end loop;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 CRM SALES FOUNDATION POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ CRM SALES FOUNDATION POSTCHECK PASSED.';
end $verdict$;
