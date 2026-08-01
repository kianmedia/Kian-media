-- ════════════════════════════════════════════════════════════════════════════
-- docs/case_studies_platform_POSTCHECK.sql — للقراءة فقط · مجموعة نتائج واحدة.
-- يُشغَّل بعد docs/case_studies_platform_RUNME.sql.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة. المحرّر يعمل بدور postgres
--   و auth.uid() = NULL؛ استدعاء بوّابة حيّة هنا يُرجع false فيُقرأ خطأً على
--   أنّها مكسورة، أو يرفع «not authorized» فيبدو الملفّ عاطلًا. كلّ صفّ يقرأ
--   **تعريف** الكائن من كتالوج النظام: pg_get_functiondef · pg_policies ·
--   pg_constraint · pg_trigger · information_schema.
--   (الـdeparser يرفع حالة الكلمات المفتاحية، فالمطابقة على مُعرِّفات صغيرة.)
--
-- ★ ولا مصيدة catch-all ★ كلّ صفّ قادر فعلًا على أن يُرجع FAIL.
-- ════════════════════════════════════════════════════════════════════════════

with

tables_expected(t) as (values
  ('cs_settings'),('cs_sectors'),('cs_services'),('cs_case_studies'),('cs_permissions'),
  ('cs_media'),('cs_metrics'),('cs_credits'),('cs_case_study_sectors'),
  ('cs_case_study_services'),('cs_versions'),('cs_audit')),

predicates(f) as (values
  ('can_view_case_studies_internal()'),('can_edit_case_studies()'),
  ('can_review_case_studies()'),('can_publish_case_studies()'),
  ('cs_perm(text)'),('cs_is_staff()'),('cs_is_owner()'),('cs_is_admin()'),
  ('cs_is_public(uuid)')),

api_fns(f) as (values
  ('cs_access()'),('cs_lookups()'),('cs_list(jsonb)'),('cs_get(uuid)'),('cs_upsert(jsonb)'),
  ('cs_set_taxonomy(uuid,text[],text[])'),('cs_media_upsert(jsonb)'),('cs_media_delete(uuid,text)'),
  ('cs_metric_upsert(jsonb)'),('cs_metric_delete(uuid,text)'),('cs_credit_upsert(jsonb)'),
  ('cs_credit_delete(uuid,text)'),('cs_permission_set(uuid,jsonb)'),('cs_versions_list(uuid)'),
  ('cs_rollback(uuid,int,text)'),('cs_submit(uuid,text)'),('cs_review_decide(uuid,text,text)'),
  ('cs_legal_decide(uuid,text,text)'),('cs_permission_confirm(uuid,text)'),('cs_approve(uuid,text)'),
  ('cs_publish(uuid,text)'),('cs_schedule(uuid,timestamptz,text)'),('cs_unpublish(uuid,text)'),
  ('cs_archive(uuid,text)'),('cs_restore(uuid,text)'),('cs_publish_due()'),('cs_checklist(uuid)'),
  ('cs_preview(uuid)'),('cs_audit_list(jsonb)'),('cs_export_csv(jsonb)'),('cs_settings_set(jsonb)'),
  ('cs_taxonomy_upsert(text,jsonb)')),

public_fns(f) as (values
  ('cs_public_index(jsonb)'),('cs_public_study(text)'),('cs_public_slugs()')),

internal_fns(f) as (values
  ('cs_txt(jsonb,text)'),('cs_bool(jsonb,text,boolean)'),('cs_int(jsonb,text)'),
  ('cs_ts(jsonb,text)'),('cs_date(jsonb,text)'),('cs_sanitize(text)'),('cs_sanitize_block(text)'),
  ('cs_csv_cell(text)'),('cs_slugify(text)'),('cs_log(text,uuid,boolean,jsonb)'),('cs_touch(uuid)'),
  ('cs_snapshot_build(uuid)'),('cs_mask(uuid,jsonb,boolean)'),('cs_public_row(uuid,boolean)'),
  ('cs_publish_blockers(uuid)'),('cs_version_new(uuid,text,int)'),('cs_mark_approved(uuid)')),

statuses(k) as (values
  ('draft'),('internal_review'),('legal_review'),('client_permission_required'),
  ('client_permission_received'),('approved'),('scheduled'),('published'),
  ('unpublished'),('archived')),

blockers(k) as (values
  ('named_without_permission'),('logo_without_permission'),('metrics_without_permission'),
  ('testimonial_without_permission'),('anonymization_required'),('embargo_active'),
  ('media_infected'),('media_metadata_not_stripped'),('media_host_not_allowed'),
  ('no_hero_media'),('permission_refused_or_revoked'),('media_missing_alt')),

owner_only(f) as (values
  ('cs_publish(uuid,text)'),('cs_schedule(uuid,timestamptz,text)'),('cs_unpublish(uuid,text)'),
  ('cs_archive(uuid,text)'),('cs_restore(uuid,text)'),('cs_settings_set(jsonb)')),

private_buckets(b) as (values
  ('hr-files'),('hr-docs'),('custody-evidence'),('custody-inventory-assets'),
  ('custody-inventory-evidence'),('custody-inventory-signatures'),('rental-evidence'),
  ('rental-contracts'),('rental-private-documents'),('project-deliverables')),

-- ─── (١) الجداول وRLS ──────────────────────────────────────────────────────
r_tables as (
  select case when to_regclass('public.' || t) is null then 'FAIL' else 'PASS' end as verdict,
         'جداول' as area, t as object,
         case when to_regclass('public.' || t) is null then 'مفقود — الترحيلة لم تكتمل' else 'موجود' end as detail
    from tables_expected),

r_rls as (
  select case when to_regclass('public.' || t) is null then 'FAIL'
              when (select not c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then 'FAIL'
              else 'PASS' end as verdict,
         'RLS' as area, t as object, 'RLS مفعَّل على الجدول' as detail
    from tables_expected),

r_no_write_policy as (
  select case when (select count(*) from pg_policies
                     where schemaname = 'public' and tablename like 'cs\_%' and cmd <> 'SELECT') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'RLS' as area, 'لا سياسة كتابة مباشرة' as object,
         'كلّ كتابة تمرّ عبر RPC مُدقَّقة' as detail),

r_perm_policy_narrow as (
  select case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='cs_permissions'
                       and qual ilike '%can_review_case_studies%') = 1
              and (select count(*) from pg_policies
                     where schemaname='public' and tablename='cs_permissions'
                       and qual ilike '%can_view_case_studies_internal%') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'RLS' as area, 'سياسة بيانات الإذن أضيق' as object,
         'مرجع العقد واسم جهة الاتّصال وقيود السرّية لا يراها كلّ من يرى الوحدة' as detail),

-- ─── (٢) المُسنَدات: boolean · definer · search_path · لا NULL ─────────────
r_pred as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'FAIL'
              when (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%search_path%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%coalesce%'
               and pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%return false%' then 'FAIL'
              else 'PASS' end as verdict,
         'مُسنَدات' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'مفقود'
              when (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'لا يعيد boolean — السياسات فوقه تصير «غير محدَّد» وهو ليس منعًا'
              when (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'ليس security definer'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%search_path%' then 'search_path غير مثبَّت'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%coalesce%'
               and pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%return false%' then 'قد يعيد NULL'
              else 'boolean · definer · search_path مثبَّت · لا NULL' end as detail
    from predicates),

-- ─── (٣) ★ النشر ملكيّ بنيويًّا ★ ─────────────────────────────────────────
r_publish_owner as (
  select case when to_regprocedure('public.can_publish_case_studies()') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()')) ilike '%cs_perm%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()')) ilike '%emp_has_permission%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()')) ilike '%cs_is_admin%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()')) ilike '%cs_is_staff%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()')) not ilike '%cs_is_owner%' then 'FAIL'
              else 'PASS' end as verdict,
         'حوكمة النشر' as area, 'can_publish_case_studies()' as object,
         'المالك وحده: لا مفتاح صلاحية ولا is_admin ولا is_staff — المفتاح غير الموجود لا يُمنَح سهوًا' as detail),

r_no_publish_key as (
  select case when to_regclass('public.permissions') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.permissions where key = ''case_study.publish''',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'حوكمة النشر' as area, 'permissions.case_study.publish' as object,
         'لا مفتاح نشر في الكتالوج — النشر ليس صلاحية تُمنَح' as detail),

r_owner_only as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%can_publish_case_studies%' then 'FAIL'
              else 'PASS' end as verdict,
         'حوكمة النشر' as area, f as object,
         'الإجراء مقصور على المالك' as detail
    from owner_only),

r_publish_checks_blockers as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%cs_publish_blockers%' then 'FAIL'
              else 'PASS' end as verdict,
         'حوكمة النشر' as area, f || ' → محرّك الموانع' as object,
         'النشر والجدولة يفحصان الموانع قبل أن يكتبا شيئًا' as detail
    from (values ('cs_publish(uuid,text)'),('cs_schedule(uuid,timestamptz,text)')) as t(f)),

-- ─── (٤) ★ الطبقة الثانية: حارس على الجدول ★ ──────────────────────────────
r_guard_trigger as (
  select case when to_regclass('public.cs_case_studies') is null then 'FAIL'
              when (select count(*) from pg_trigger
                     where tgrelid = to_regclass('public.cs_case_studies')
                       and tgname = 'trg_cs_guard_publish' and not tgisinternal) = 1
              then 'PASS' else 'FAIL' end as verdict,
         'حوكمة النشر' as area, 'trg_cs_guard_publish' as object,
         'كتابة مباشرة تضع الحالة published/scheduled يجب أن تُرفَض إن وُجد مانع' as detail),

r_guard_body as (
  select case when to_regprocedure('public.cs_guard_publish()') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_guard_publish()')) not ilike '%cs_publish_blockers%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_guard_publish()')) not ilike '%published_version_id%' then 'FAIL'
              else 'PASS' end as verdict,
         'حوكمة النشر' as area, 'cs_guard_publish()' as object,
         'الحارس يفحص الموانع ويشترط نسخة منشورة مرتبطة' as detail),

-- ─── (٥) محرّك الموانع يغطّي المستحيلات ────────────────────────────────────
r_blockers as (
  select case when to_regprocedure('public.cs_publish_blockers(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_publish_blockers(uuid)')) not ilike '%' || replace(k, '_', '\_') || '%' escape '\' then 'FAIL'
              else 'PASS' end as verdict,
         'موانع النشر' as area, k as object,
         'مانع صلب مطلوب بالعقد داخل المحرّك' as detail
    from blockers),

r_blocker_failclosed as (
  select case when to_regprocedure('public.cs_publish_blockers(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_publish_blockers(uuid)')) not ilike '%blocker_engine_error%' then 'FAIL'
              else 'PASS' end as verdict,
         'موانع النشر' as area, 'الفشل يُقرأ منعًا' as object,
         'استثناء داخل المحرّك يجب أن يُنتج مانعًا لا قائمة فارغة' as detail),

-- ─── (٦) ★ لا تعديل صامت بعد النشر ★ ──────────────────────────────────────
r_public_reads_snapshot as (
  select case when to_regprocedure('public.cs_public_row(uuid,boolean)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_public_row(uuid,boolean)')) not ilike '%published_version_id%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_public_row(uuid,boolean)')) not ilike '%cs_versions%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_public_row(uuid,boolean)')) not ilike '%cs_is_public%' then 'FAIL'
              else 'PASS' end as verdict,
         'النشر والنسخ' as area, 'العامّ يقرأ اللقطة' as object,
         'الإسقاط العامّ من لقطة النسخة المنشورة خلف بوّابة — لا من الصفّ الحيّ' as detail),

r_versions_immutable as (
  select case when to_regclass('public.cs_versions') is null then 'FAIL'
              when (select count(*) from pg_trigger
                     where tgrelid = to_regclass('public.cs_versions')
                       and tgname = 'trg_cs_versions_immutable' and not tgisinternal) = 1
              then 'PASS' else 'FAIL' end as verdict,
         'النشر والنسخ' as area, 'trg_cs_versions_immutable' as object,
         'تعديل لقطة أو حذف نسخة يجب أن يُرفَض' as detail),

r_rollback_adds as (
  select case when to_regprocedure('public.cs_rollback(uuid,int,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_rollback(uuid,int,text)')) ilike '%delete from public.cs_versions%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_rollback(uuid,int,text)')) not ilike '%cs_version_new%' then 'FAIL'
              else 'PASS' end as verdict,
         'النشر والنسخ' as area, 'التراجع يُنشئ نسخة' as object,
         'التراجع لا يحذف تاريخًا — يُنشئ نسخة جديدة تشير إلى أصلها' as detail),

r_upsert_no_status as (
  select case when to_regprocedure('public.cs_upsert(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)')) ~* '\ystatus\y[[:space:]]*=' then 'FAIL'
              else 'PASS' end as verdict,
         'النشر والنسخ' as area, 'التحرير لا يضبط الحالة' as object,
         '«حرّر ثمّ انشر» في نداء واحد يتخطّى المراجعة والإذن' as detail),

-- ★ المحو الصريح: قائمة ساكنة، وهويّة الدراسة خارجها ★
-- بلا باب محو يبقى نصّ كُتب خطأً عالقًا للأبد (كلّ إسناد coalesce)، ومع باب
-- يبني اسم عمود في وقت التشغيل يصير المحو حقنًا. الصفّان أدناه يثبتان الاثنين.
r_clear_static as (
  select case when to_regprocedure('public.cs_upsert(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)'))
                   !~* '''testimonial_ar''[[:space:]]*=[[:space:]]*any\(v_clear\)' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)')) ilike '%execute format%' then 'FAIL'
              else 'PASS' end as verdict,
         'التحرير' as area, 'المحو الصريح ساكن' as object,
         'قائمة الحقول القابلة للمحو مكتوبة حرفيًّا، ولا اسم عمود يُركَّب في وقت التشغيل' as detail),

r_clear_identity_safe as (
  select case when to_regprocedure('public.cs_upsert(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)'))
                   ~* '''(slug|internal_title|status|client_identity_visibility)''[[:space:]]*=[[:space:]]*any\(v_clear\)' then 'FAIL'
              else 'PASS' end as verdict,
         'التحرير' as area, 'الهويّة غير قابلة للمحو' as object,
         'slug و internal_title و status و طريقة عرض الهوية خارج قائمة المحو عمدًا' as detail),

-- ─── (٧) ★ الأقنعة حيّة ★ ─────────────────────────────────────────────────
r_mask_live as (
  select case when to_regprocedure('public.cs_mask(uuid,jsonb,boolean)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_mask(uuid,jsonb,boolean)')) not ilike '%' || replace(k, '_', '\_') || '%' escape '\' then 'FAIL'
              else 'PASS' end as verdict,
         'التقنيع' as area, k as object,
         'القناع يُقرأ من الحالة الحيّة — سحب الإذن أو الموافقة يسري فورًا بلا انتظار نشر جديد' as detail
    from (values ('permitted_project_name'),('permitted_logo'),('permitted_metrics'),
                 ('permitted_testimonial'),('anonymization_required'),('consent_public'),
                 ('permission_expires_at')) as t(k)),

r_preview_same_path as (
  select case when to_regprocedure('public.cs_preview(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_preview(uuid)')) not ilike '%cs_mask%' then 'FAIL'
              else 'PASS' end as verdict,
         'التقنيع' as area, 'المعاينة = النشر' as object,
         'المعاينة تستعمل دالّة التقنيع نفسها، فلا تُظهر ما لن يُنشر' as detail),

-- ─── (٨) ⛔ لا تسريب داخليّ ولا نسخ من المنصّة ────────────────────────────
r_no_internal_leak as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%project_id%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%internal_notes%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%permission_reference%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%permission_contact_name%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%confidentiality_restrictions%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%source_note%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%employee_user_id%' then 'FAIL'
              else 'PASS' end as verdict,
         'تسريب' as area, f as object,
         'لا معرّف مشروع ولا ملاحظة داخلية ولا مرجع إذن ولا مصدر رقم ولا معرّف موظّف في مسار المخرَج العامّ' as detail
    from (values ('cs_mask(uuid,jsonb,boolean)'),('cs_snapshot_build(uuid)')) as t(f)),

-- ★★ العقد نفسه المكتوب في الفحص الذاتيّ داخل RUNME — حرفًا بحرف ★★
--
--  ⚠️ كانت هذه الكتلة تستعمل `ilike '%deliverables%'` على نصّ التعريف كاملًا،
--     بينما أُصلح حارس RUNME إلى تحليل شكليّ عبر cs_exec_code. فاختلف الحكمان
--     على الشيفرة نفسها: نجح الفحص الذاتيّ وأدان POSTCHECK — وهذا وحده عطب،
--     لأنّ أحد الحكمين كذبٌ حتمًا.
--     والملتقَط في الحالتين عمودٌ اسمه **deliverables_summary_ar** على
--     cs_case_studies: في cs_snapshot_build مفتاحُ إخراج، وفي cs_upsert طرفُ
--     تعيين في SET. ولا واحدة منهما تلمس جدولًا مجمَّدًا.
--
--  فالحكم الآن: الشيفرة التنفيذية وحدها (cs_exec_code تحذف التعليقات وتُفرّغ
--  السلاسل)، وشكلُ جملة قراءة أو كتابة على الاسم **كاملًا** بحدّ كلمة.
r_no_project_read as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when public.cs_exec_code(pg_get_functiondef(to_regprocedure('public.' || f)))
                   ~* '\m(from|join|update|into|delete\s+from)\s+(only\s+)?(public\.)?(projects|project_core|deliverables|deliverable_internal)\M' then 'FAIL'
              when public.cs_exec_code(pg_get_functiondef(to_regprocedure('public.' || f)))
                   ~* '\m(public\.)?(projects|project_core|deliverables|deliverable_internal)\s*\.\s*[a-z_]' then 'FAIL'
              when public.cs_exec_code(pg_get_functiondef(to_regprocedure('public.' || f)))
                   ~* '\mto_jsonb\s*\(\s*(p|proj|projects|d|deliverables)\s*\)' then 'FAIL'
              else 'PASS' end as verdict,
         'تجميد المنصّة' as area, f as object,
         '⛔ لا نسخ تلقائيّ من منصّة المشاريع — كلّ حقل عامّ مُدخَل أو معتمَد يدويًّا' as detail
    from (values ('cs_snapshot_build(uuid)'),('cs_mask(uuid,jsonb,boolean)'),
                 ('cs_public_row(uuid,boolean)'),('cs_upsert(jsonb)'),
                 ('cs_public_index(jsonb)'),('cs_public_study(text)')) as t(f)),

r_no_frozen_fk as (
  select case when (select count(*) from pg_constraint c
                      join pg_class ref on ref.oid = c.confrelid
                      join pg_class src on src.oid = c.conrelid
                     where src.relname like 'cs\_%' and c.contype = 'f'
                       and ref.relname in ('projects','project_core','deliverables',
                                           'deliverable_internal','project_transition_requests')) = 0
              then 'PASS' else 'FAIL' end as verdict,
         'تجميد المنصّة' as area, 'مفاتيح أجنبية إلى المنصّة' as object,
         'project_id مرجع للقراءة فقط بلا مفتاح أجنبيّ' as detail),

r_no_money_column as (
  select case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name like 'cs\_%'
                       and column_name ~* '(^|_)(cost|budget|margin|profit|price|revenue|invoice)($|_)') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'تسريب' as area, 'لا عمود ماليّ' as object,
         'التكلفة والهامش لا يُنشران — والغياب البنيويّ أقوى من الإخفاء' as detail),

-- ─── (٩) الوسائط ───────────────────────────────────────────────────────────
r_media_check as (
  select case when to_regclass('public.cs_media') is null then 'FAIL'
              when not exists (select 1 from pg_constraint
                                where conrelid = to_regclass('public.cs_media')
                                  and conname = 'cs_media_no_private_source') then 'FAIL'
              when pg_get_constraintdef((select oid from pg_constraint
                                          where conrelid = to_regclass('public.cs_media')
                                            and conname = 'cs_media_no_private_source')) not ilike '%' || replace(b, '_', '\_') || '%' escape '\' then 'FAIL'
              else 'PASS' end as verdict,
         'الوسائط' as area, 'منع الدلو ' || b as object,
         'رابط عامّ يشير إلى دلو خاصّ = مسار تخزين داخليّ على وشك أن يصير علنيًّا' as detail
    from private_buckets),

r_media_no_signed as (
  select case when to_regclass('public.cs_media') is null then 'FAIL'
              when pg_get_constraintdef((select oid from pg_constraint
                                          where conrelid = to_regclass('public.cs_media')
                                            and conname = 'cs_media_no_private_source')) not ilike '%token=%' then 'FAIL'
              when pg_get_constraintdef((select oid from pg_constraint
                                          where conrelid = to_regclass('public.cs_media')
                                            and conname = 'cs_media_no_private_source')) not ilike '%sign%' then 'FAIL'
              else 'PASS' end as verdict,
         'الوسائط' as area, 'منع الروابط الموقَّعة' as object,
         'الرابط الموقَّع رمز حامل — نشره يعني نشر الملفّ حتّى انتهاء صلاحيته' as detail),

r_media_source_exact as (
  select case when to_regclass('public.cs_media') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_media')
                              and conname = 'cs_media_source_exact') then 'PASS' else 'FAIL' end as verdict,
         'الوسائط' as area, 'مصدر واحد بالضبط' as object,
         'صورة عامّة أو فيديو معرَّف بمزوّد ومعرّف — لا iframe حرّ' as detail),

r_no_storage_touch as (
  select case when (select count(*) from information_schema.columns
                     where table_schema = 'public' and table_name like 'cs\_%'
                       and column_name in ('storage_bucket','storage_path','file_url','object_path')) = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الوسائط' as area, 'لا عمود مسار تخزين' as object,
         'الوحدة لا تحمل مسار تخزين إطلاقًا — لا شيء يمكن توقيعه بمفتاح الخدمة' as detail),

-- ─── (١٠) الموافقة والاعتماد فعلان موثَّقان ───────────────────────────────
r_consent as (
  select case when to_regclass('public.cs_credits') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_credits')
                              and conname = 'cs_credit_consent_audited') then 'PASS' else 'FAIL' end as verdict,
         'الموافقات' as area, 'موافقة نشر اسم الموظّف' as object,
         'الصندوق وحده ليس موافقة: مرجع + مُسجِّل + وقت بقيد على الجدول' as detail),

r_perm_ref as (
  select case when to_regclass('public.cs_permissions') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_permissions')
                              and conname = 'cs_perm_granted_needs_ref') then 'PASS' else 'FAIL' end as verdict,
         'الموافقات' as area, 'مرجع إذن العميل' as object,
         '«قال لي شفهيًّا» ليس إذنًا — الإذن الممنوح يشترط مرجعًا مكتوبًا' as detail),

r_perm_flags as (
  select case when to_regclass('public.cs_permissions') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_permissions')
                              and conname = 'cs_perm_flags_need_grant') then 'PASS' else 'FAIL' end as verdict,
         'الموافقات' as area, 'أعلام الاستعمال المأذون' as object,
         'لا شعار ولا اسم ولا أرقام ولا شهادة بلا حالة إذن ممنوحة' as detail),

r_perm_logo as (
  select case when to_regclass('public.cs_permissions') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_permissions')
                              and conname = 'cs_perm_logo_needs_name') then 'PASS' else 'FAIL' end as verdict,
         'الموافقات' as area, 'الشعار اسم' as object,
         'إذن الشعار بلا إذن الاسم تناقض — القيد يمنعه' as detail),

r_anon_label as (
  select case when to_regclass('public.cs_case_studies') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.cs_case_studies')
                              and conname = 'cs_anon_label_present') then 'PASS' else 'FAIL' end as verdict,
         'الموافقات' as area, 'الشكل المجهَّل المعتمَد' as object,
         '«جهة صناعية كبرى في المملكة» تسمية إلزامية بقيد لا عرف' as detail),

-- ─── (١١) المفردات ────────────────────────────────────────────────────────
r_statuses as (
  select case when to_regclass('public.cs_case_studies') is null then 'FAIL'
              when (select count(*) from pg_constraint c
                     where c.conrelid = to_regclass('public.cs_case_studies') and c.contype = 'c'
                       and pg_get_constraintdef(c.oid) ilike '%status%'
                       and pg_get_constraintdef(c.oid) ilike '%' || replace(k, '_', '\_') || '%' escape '\') >= 1
              then 'PASS' else 'FAIL' end as verdict,
         'مفردات' as area, 'status = ' || k as object,
         'الحالات العشر المتّفق عليها كلّها في قيد CHECK' as detail
    from statuses),

-- ─── (١٢) التعقيم وحقن الصيغ ──────────────────────────────────────────────
r_sanitize as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%cs_sanitize%' then 'FAIL'
              else 'PASS' end as verdict,
         'التعقيم' as area, f as object,
         'التعقيم عند الكتابة **وعند الإخراج** — مرّة واحدة لا تكفي لصفّ كُتب قبل الترحيلة' as detail
    from (values ('cs_upsert(jsonb)'),('cs_mask(uuid,jsonb,boolean)'),('cs_snapshot_build(uuid)')) as t(f)),

r_csv as (
  select case when to_regprocedure('public.cs_csv_cell(text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_csv_cell(text)')) not ilike '%=+%' then 'FAIL'
              when to_regprocedure('public.cs_export_csv(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_export_csv(jsonb)')) not ilike '%cs_csv_cell%' then 'FAIL'
              else 'PASS' end as verdict,
         'التعقيم' as area, 'حقن الصيغ في CSV' as object,
         'خليّة تبدأ بـ= أو + أو - أو @ تُنفَّذ كصيغة عند الفتح' as detail),

-- ─── (١٣) الصلاحيات ───────────────────────────────────────────────────────
r_api as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              else 'PASS' end as verdict,
         'صلاحيات' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'مفقودة'
              when not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'غير منفَّذة من authenticated — الواجهة ستقرأ PGRST202 كاذبًا'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then '★ منفَّذة من anon ★ دالّة داخلية مفتوحة للزائر'
              else 'موجودة · authenticated فقط' end as detail
    from api_fns),

r_public_fns as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when not has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%search_path%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%public_enabled%' then 'FAIL'
              else 'PASS' end as verdict,
         'السطح العامّ' as area, f as object,
         'قراءة فقط · definer · search_path مثبَّت · تحترم مفتاح التفعيل · منفَّذة من anon' as detail
    from public_fns),

r_public_gate as (
  select case when to_regprocedure('public.cs_is_public(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_is_public(uuid)')) not ilike '%publish_at%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_is_public(uuid)')) not ilike '%archived%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_is_public(uuid)')) not ilike '%embargo_until%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_is_public(uuid)')) not ilike '%revoked%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.cs_is_public(uuid)')) not ilike '%published_version_id%' then 'FAIL'
              else 'PASS' end as verdict,
         'السطح العامّ' as area, 'بوّابة الظهور' as object,
         'منشورة · مضى موعدها · غير مؤرشفة · لا حظر نشر · الإذن غير مسحوب · ولها نسخة منشورة' as detail),

r_internal as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              else 'PASS' end as verdict,
         'دوالّ داخلية' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'مفقودة'
              when has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE')
                then '★ منفَّذة من authenticated ★ عميل يستطيع بناء لقطة أو تجاوز الإسقاط'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then '★ منفَّذة من anon ★'
              else 'محجوبة عن anon و authenticated' end as detail
    from internal_fns),

r_no_anon_tables as (
  select case when (select count(*) from information_schema.role_table_grants
                     where grantee = 'anon' and table_schema = 'public' and table_name like 'cs\_%') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'صلاحيات' as area, 'لا جدول لـanon' as object,
         'أيّ منح جدول لـanon على وحدة دراسات الحالة خرق' as detail),

r_no_authed_tables as (
  select case when (select count(*) from information_schema.role_table_grants
                     where grantee = 'authenticated' and table_schema = 'public' and table_name like 'cs\_%') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'صلاحيات' as area, 'لا جدول لـauthenticated' as object,
         'كلّ قراءة عبر RPC بإسقاط صريح — لا select * من PostgREST' as detail),

-- ─── (١٤) الافتراض الآمن ──────────────────────────────────────────────────
r_default_off as (
  select case when to_regclass('public.cs_settings') is null then 'FAIL'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.cs_settings where id = true and public_enabled = true',
                     false, true, '')))[1]::text::int = 0
              then 'PASS' else 'INFO' end as verdict,
         'السطح العامّ' as area, 'public_enabled' as object,
         'مطفأ بعد الترحيلة مباشرةً. إن ظهر INFO فقد فعّله المالك عمدًا — وهذا قرار لا عطل' as detail),

all_rows as (
  select * from r_tables union all select * from r_rls union all select * from r_no_write_policy
  union all select * from r_perm_policy_narrow
  union all select * from r_pred
  union all select * from r_publish_owner union all select * from r_no_publish_key
  union all select * from r_owner_only union all select * from r_publish_checks_blockers
  union all select * from r_guard_trigger union all select * from r_guard_body
  union all select * from r_blockers union all select * from r_blocker_failclosed
  union all select * from r_public_reads_snapshot union all select * from r_versions_immutable
  union all select * from r_rollback_adds union all select * from r_upsert_no_status
  union all select * from r_clear_static union all select * from r_clear_identity_safe
  union all select * from r_mask_live union all select * from r_preview_same_path
  union all select * from r_no_internal_leak union all select * from r_no_project_read
  union all select * from r_no_frozen_fk union all select * from r_no_money_column
  union all select * from r_media_check union all select * from r_media_no_signed
  union all select * from r_media_source_exact union all select * from r_no_storage_touch
  union all select * from r_consent union all select * from r_perm_ref
  union all select * from r_perm_flags union all select * from r_perm_logo
  union all select * from r_anon_label
  union all select * from r_statuses
  union all select * from r_sanitize union all select * from r_csv
  union all select * from r_api union all select * from r_public_fns
  union all select * from r_public_gate union all select * from r_internal
  union all select * from r_no_anon_tables union all select * from r_no_authed_tables
  union all select * from r_default_off
)

select
  case verdict when 'FAIL' then 1 when 'SKIP' then 2 when 'INFO' then 3 else 4 end as sort_key,
  verdict, area, object, detail
from all_rows
order by sort_key, area, object;
