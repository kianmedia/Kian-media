-- ════════════════════════════════════════════════════════════════════════════
-- docs/talent_vendor_network_POSTCHECK.sql — للقراءة فقط · مجموعة نتائج واحدة.
-- يُشغَّل بعد docs/talent_vendor_network_RUNME.sql.
--
-- ★ ساكن بالكامل ★ لا يستدعي دالّة محميّة واحدة. المحرّر يعمل بدور postgres
--   و auth.uid() = NULL؛ استدعاء بوّابة حيّة هنا يُرجع false فيُقرأ خطأً على
--   أنّها مكسورة، أو يرفع «not authorized» فيبدو الملفّ عاطلًا. كلّ صفّ يقرأ
--   **تعريف** الكائن من كتالوج النظام: pg_get_functiondef · pg_policies ·
--   pg_constraint · pg_trigger · information_schema.
--   (الـdeparser يرفع حالة الكلمات المفتاحية مثل COALESCE، فالمطابقة هنا على
--    مُعرِّفات صغيرة الحروف لا على كلمات مفتاحية.)
--
-- ★ ولا مصيدة catch-all ★ كلّ صفّ قادر فعلًا على أن يُرجع FAIL.
-- ════════════════════════════════════════════════════════════════════════════

with

tables_expected(t) as (values
  ('tvn_settings'),('tvn_profiles'),('tvn_profile_rates'),('tvn_profile_bank'),
  ('tvn_profile_restricted'),('tvn_availability'),('tvn_document_types'),('tvn_documents'),
  ('tvn_assignments'),('tvn_assignment_candidates'),('tvn_reviews'),('tvn_review_corrections'),
  ('tvn_incident_flags'),('tvn_audit'),('tvn_event_log')),

predicates(f) as (values
  ('can_view_talent_network()'),('can_manage_talent_profiles()'),('can_view_vendor_rates()'),
  ('can_verify_compliance()'),('can_assign_external_resources()'),('can_review_resource_performance()'),
  ('tvn_can_view_bank()'),('tvn_can_approve_cost()'),('tvn_perm(text)')),

api_fns(f) as (values
  ('tvn_access()'),('tvn_profile_get(uuid)'),('tvn_profile_list(jsonb)'),('tvn_profile_upsert(jsonb)'),
  ('tvn_profile_set_status(uuid,text,text)'),('tvn_rates_set(uuid,jsonb)'),('tvn_bank_set(uuid,jsonb)'),
  ('tvn_restricted_set(uuid,text,text)'),('tvn_availability_set(jsonb)'),('tvn_availability_confirm(uuid,text)'),
  ('tvn_document_upsert(jsonb)'),('tvn_document_verify(uuid,text)'),('tvn_document_alerts(boolean)'),
  ('tvn_suggest(jsonb)'),('tvn_assignment_propose(jsonb)'),('tvn_assignment_approve(uuid,text,text)'),
  ('tvn_assignment_confirm(uuid)'),('tvn_assignment_cancel(uuid,text)'),('tvn_assignment_complete(uuid)'),
  ('tvn_review_submit(jsonb)'),('tvn_review_close(uuid)'),('tvn_review_correct(uuid,text,text,text)'),
  ('tvn_reviews_for_profile(uuid)'),('tvn_promote_opportunity(uuid,text,jsonb)'),
  ('tvn_vendor_link(uuid,uuid)'),('tvn_scan_alerts()')),

internal_fns(f) as (values
  ('tvn_rating(uuid)'),('tvn_doc_valid(text,uuid,text)'),('tvn_missing_required_docs(uuid)'),
  ('tvn_has_conflict(uuid,timestamptz,timestamptz,uuid)'),
  ('tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)'),
  ('tvn_emit(text,text,uuid,jsonb,text)'),('tvn_log(text,text,uuid,boolean,jsonb)'),
  ('tvn_event_keys()'),('tvn_asset_event_keys()')),

profile_types(k) as (values
  ('employee_candidate'),('freelancer'),('crew_member'),('production_company'),
  ('equipment_vendor'),('service_vendor'),('studio'),('location_provider'),
  ('transport_provider'),('accommodation_provider'),('voice_talent'),('creative_talent'),('other')),

availability_states(k) as (values
  ('available'),('unavailable'),('tentative'),('booked'),('blocked'),('pending_confirmation')),

talent_events(k) as (values
  ('availability_confirmation_required'),('assignment_proposed'),('assignment_confirmed'),
  ('document_expiring'),('document_expired'),('vendor_suspended'),('performance_review_due')),

asset_events(k) as (values
  ('custody_due'),('custody_overdue'),('asset_returned_pending_inspection'),
  ('asset_damage_reported'),('asset_missing'),('maintenance_due'),('maintenance_overdue'),
  ('warranty_expiring'),('reservation_conflict'),('asset_available_again')),

-- ─── (١) الجداول ───────────────────────────────────────────────────────────
r_tables as (
  select case when to_regclass('public.' || t) is null then 'FAIL' else 'PASS' end as verdict,
         'جداول' as area, t as object,
         case when to_regclass('public.' || t) is null then 'مفقود — الترحيلة لم تكتمل' else 'موجود' end as detail
    from tables_expected),

-- ─── (٢) المُسنَدات: موجودة · تعيد boolean · definer · search_path مثبَّت ──
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
              when (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'لا يعيد boolean — السياسات فوقه تصير «غير محدَّد»'
              when (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.' || f)) then 'ليس security definer'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%search_path%' then 'search_path غير مثبَّت'
              when pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%coalesce%'
               and pg_get_functiondef(to_regprocedure('public.' || f)) not ilike '%return false%' then 'قد يعيد NULL'
              else 'boolean · definer · search_path مثبَّت · لا NULL' end as detail
    from predicates),

-- ─── (٣) دوالّ الواجهة ─────────────────────────────────────────────────────
r_api as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              else 'PASS' end as verdict,
         'واجهة' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'مفقودة'
              when not has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'غير منفَّذة من authenticated — الواجهة ستقرأ PGRST202 كاذبًا'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then '★ منفَّذة من anon ★'
              else 'موجودة · authenticated فقط' end as detail
    from api_fns),

-- ─── (٤) الدوالّ الداخلية لا تُنفَّذ من العميل ─────────────────────────────
r_internal as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then 'FAIL'
              else 'PASS' end as verdict,
         'دوالّ داخلية' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'مفقودة'
              when has_function_privilege('authenticated', to_regprocedure('public.' || f), 'EXECUTE')
                then '★ منفَّذة من authenticated ★ عميل يستطيع استخراج الشبكة صفًّا صفًّا'
              when has_function_privilege('anon', to_regprocedure('public.' || f), 'EXECUTE') then '★ منفَّذة من anon ★'
              else 'محجوبة عن anon و authenticated' end as detail
    from internal_fns),

-- ─── (٥) أنواع الملفّات الثلاثة عشر في قيد CHECK ───────────────────────────
r_types as (
  select case when to_regclass('public.tvn_profiles') is null then 'FAIL'
              when (select count(*) from pg_constraint c, profile_types pt
                     where c.conrelid = to_regclass('public.tvn_profiles') and c.contype = 'c'
                       and pg_get_constraintdef(c.oid) ilike '%profile_type%'
                       and pg_get_constraintdef(c.oid) ilike '%' || pt.k || '%') = 13
              then 'PASS' else 'FAIL' end as verdict,
         'مفردات' as area, 'tvn_profiles.profile_type' as object,
         'الأنواع الثلاثة عشر المتّفق عليها يجب أن تكون كلّها في قيد CHECK' as detail),

r_states as (
  select case when to_regclass('public.tvn_availability') is null then 'FAIL'
              when (select count(*) from pg_constraint c, availability_states av
                     where c.conrelid = to_regclass('public.tvn_availability') and c.contype = 'c'
                       and pg_get_constraintdef(c.oid) ilike '%state%'
                       and pg_get_constraintdef(c.oid) ilike '%' || av.k || '%') = 6
              then 'PASS' else 'FAIL' end as verdict,
         'مفردات' as area, 'tvn_availability.state' as object,
         'حالات التوافر الستّ كلّها في قيد CHECK' as detail),

-- ─── (٦) ★ الجندر خارج مسارات التقييم والترشيح ★ ──────────────────────────
r_gender as (
  select case when to_regprocedure('public.' || f) is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%gender%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%tvn_profile_restricted%' then 'FAIL'
              else 'PASS' end as verdict,
         'حقل مقيَّد' as area, f as object,
         case when to_regprocedure('public.' || f) is null then 'الدالّة مفقودة'
              when pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%gender%'
                or pg_get_functiondef(to_regprocedure('public.' || f)) ilike '%tvn_profile_restricted%'
              then '★ خرق ★ الجندر داخل مسار تقييم أو ترشيح'
              else 'لا أثر للجندر ولا للجدول المقيَّد' end as detail
    from (values ('tvn_suggest(jsonb)'),('tvn_rating(uuid)'),
                 ('tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)'),
                 ('tvn_profile_list(jsonb)'),('tvn_profile_get(uuid)')) as t(f)),

r_gender_purpose as (
  select case when to_regclass('public.tvn_profile_restricted') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.tvn_profile_restricted')
                              and contype = 'c' and pg_get_constraintdef(oid) ilike '%gender_purpose%')
              then 'PASS' else 'FAIL' end as verdict,
         'حقل مقيَّد' as area, 'gender_purpose' as object,
         'الغرض التشغيليّ الموثَّق إلزاميّ بقيد — لا مجرّد عرف' as detail),

-- ─── (٧) الموانع الصلبة للإسناد ────────────────────────────────────────────
r_guard as (
  select case when to_regprocedure('public.tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid)')) not ilike '%' || rule || '%'
              then 'FAIL' else 'PASS' end as verdict,
         'موانع الإسناد' as area, rule as object,
         'مانع صلب مطلوب بالعقد داخل الحارس' as detail
    from (values ('profile_not_assignable'),('required_document_invalid'),
                 ('schedule_conflict'),('drone_permit_missing')) as t(rule)),

r_confirm_recheck as (
  select case when to_regprocedure('public.tvn_assignment_confirm(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_assignment_confirm(uuid)')) not ilike '%tvn_assignment_guard%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_assignment_confirm(uuid)')) not ilike '%for update%' then 'FAIL'
              else 'PASS' end as verdict,
         'موانع الإسناد' as area, 'إعادة الفحص عند التأكيد' as object,
         'الفحص عند الاقتراح وحده يترك نافذة: وثيقة تنتهي أو إسناد آخر يُؤكَّد بين اللحظتين' as detail),

r_no_autoassign as (
  select case when to_regprocedure('public.tvn_suggest(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_suggest(jsonb)')) ilike '%insert into public.tvn_assignments%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_suggest(jsonb)')) not ilike '%rule_based%' then 'FAIL'
              else 'PASS' end as verdict,
         'الاقتراح' as area, 'لا إسناد تلقائيّ' as object,
         'محرّك قاعديّ يقترح فقط؛ الكتابة في tvn_assignments من دالّة الاقتراح خرق' as detail),

-- ─── (٨) الوثائق ───────────────────────────────────────────────────────────
r_doc_valid as (
  select case when to_regprocedure('public.tvn_doc_valid(text,uuid,text)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_doc_valid(text,uuid,text)')) not ilike '%verified = true%' then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_doc_valid(text,uuid,text)')) not ilike '%expires_on%' then 'FAIL'
              else 'PASS' end as verdict,
         'الوثائق' as area, 'الرفع ليس توثيقًا' as object,
         'الصلاحية = موثَّقة **و** غير منتهية' as detail),

r_doc_self as (
  select case when to_regclass('public.tvn_documents') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.tvn_documents')
                              and conname = 'tvn_doc_verify_not_self')
              then 'PASS' else 'FAIL' end as verdict,
         'الوثائق' as area, 'صاحب الملفّ لا يوثّق ملفّه' as object,
         'قيد على مستوى الجدول لا فحص داخل دالّة وحده' as detail),

r_doc_owner as (
  select case when to_regclass('public.tvn_documents') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid = to_regclass('public.tvn_documents')
                              and conname = 'tvn_doc_owner_exact')
              then 'PASS' else 'FAIL' end as verdict,
         'الوثائق' as area, 'مالك واحد بالضبط' as object,
         'ملفّ · مورّد · أصل — واحد فقط ومطابق لنوعه' as detail),

r_doc_restricted_policy as (
  select case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='tvn_documents'
                       and qual ilike '%restricted%'
                       and qual ilike '%can_verify_compliance%') >= 1
              then 'PASS' else 'FAIL' end as verdict,
         'الوثائق' as area, 'وثائق الهوية والمال' as object,
         'الوثيقة المقيَّدة لا تظهر لكلّ من يرى الشبكة' as detail),

-- ─── (٩) التقييمات ─────────────────────────────────────────────────────────
r_review_trigger as (
  select case when to_regclass('public.tvn_reviews') is null then 'FAIL'
              when (select count(*) from pg_trigger
                     where tgrelid = to_regclass('public.tvn_reviews')
                       and tgname = 'trg_tvn_review_immutable') = 1
              then 'PASS' else 'FAIL' end as verdict,
         'التقييمات' as area, 'حارس عدم التعديل بعد الإقفال' as object,
         'update أو delete على صفّ مقفل يجب أن يُرفَض' as detail),

r_review_nodelete as (
  select case when to_regprocedure('public.tvn_review_immutable()') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_review_immutable()')) not ilike '%delete%' then 'FAIL'
              else 'PASS' end as verdict,
         'التقييمات' as area, 'لا حذف' as object,
         'حذف تقييم لإخفاء حادثة يجب أن يكون مستحيلًا' as detail),

r_review_self as (
  select case when to_regprocedure('public.tvn_review_submit(jsonb)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_review_submit(jsonb)')) not ilike '%linked_user_id%' then 'FAIL'
              else 'PASS' end as verdict,
         'التقييمات' as area, 'لا تقييم ذاتيّ' as object,
         'المُقيَّم لا يقيّم نفسه' as detail),

r_review_sample as (
  select case when to_regprocedure('public.tvn_rating(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_rating(uuid)')) not ilike '%insufficient_sample%' then 'FAIL'
              else 'PASS' end as verdict,
         'التقييمات' as area, 'حدّ أدنى للعيّنة' as object,
         'لا ترتيب يُعرَض قبل بلوغ العيّنة' as detail),

r_review_correction as (
  select case when to_regclass('public.tvn_review_corrections') is null then 'FAIL'
              when exists (select 1 from pg_constraint
                            where conrelid=to_regclass('public.tvn_review_corrections')
                              and contype='c' and pg_get_constraintdef(oid) ilike '%reason%')
              then 'PASS' else 'FAIL' end as verdict,
         'التقييمات' as area, 'التصحيح مُدقَّق' as object,
         'التصحيح يُلحَق بسبب مكتوب ولا يعدّل الأصل' as detail),

-- ─── (١٠) الأجر والبيانات البنكية ──────────────────────────────────────────
r_rate_policy as (
  select case when (select count(*) from pg_policies
                     where schemaname='public' and tablename='tvn_profile_rates'
                       and qual ilike '%can_view_vendor_rates%') = 1
              and (select count(*) from pg_policies
                     where schemaname='public' and tablename='tvn_profile_rates'
                       and qual ilike '%can_view_talent_network%') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الأجر' as area, 'سياسة قراءة الأجر' as object,
         'الأجر لا يُرى بمجرّد رؤية الشبكة — طاقم العمل والعميل خارجها' as detail),

r_rate_null as (
  select case when to_regprocedure('public.tvn_profile_get(uuid)') is null then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_profile_get(uuid)')) not ilike '%rates_visible%' then 'FAIL'
              else 'PASS' end as verdict,
         'الأجر' as area, 'null لا صفر' as object,
         'غير المصرّح له يرى null مع علم رؤية صريح — لا صفر يُقرأ كأنّه مجّانًا' as detail),

r_bank as (
  select case when to_regclass('public.tvn_profile_bank') is null then 'FAIL'
              when not exists (select 1 from pg_constraint
                                where conrelid=to_regclass('public.tvn_profile_bank') and contype='c'
                                  and pg_get_constraintdef(oid) ilike '%iban_last4%') then 'FAIL'
              when (select count(*) from pg_policies
                     where schemaname='public' and tablename='tvn_profile_bank'
                       and qual ilike '%tvn_can_view_bank%') <> 1 then 'FAIL'
              else 'PASS' end as verdict,
         'البنك' as area, 'بيانات وصفية فقط' as object,
         'قيد يمنع تخزين IBAN كامل + سياسة قراءة أضيق من الأجر' as detail),

-- ─── (١١) RLS والصلاحيات ───────────────────────────────────────────────────
r_rls as (
  select case when to_regclass('public.' || t) is null then 'FAIL'
              when (select not c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then 'FAIL'
              else 'PASS' end as verdict,
         'RLS' as area, t as object, 'RLS مفعَّل على الجدول' as detail
    from tables_expected),

r_no_write_policy as (
  select case when (select count(*) from pg_policies
                     where schemaname='public' and tablename like 'tvn\_%' and cmd <> 'SELECT') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'RLS' as area, 'لا سياسة كتابة مباشرة' as object,
         'كلّ كتابة تمرّ عبر RPC مُدقَّقة' as detail),

r_no_anon as (
  select case when (select count(*) from information_schema.role_table_grants
                     where grantee='anon' and table_schema='public' and table_name like 'tvn\_%') = 0
              then 'PASS' else 'FAIL' end as verdict,
         'صلاحيات' as area, 'لا anon' as object,
         'أيّ منح لـanon على جداول الوحدة خرق' as detail),

-- ─── (١٢) الأحداث ──────────────────────────────────────────────────────────
-- كلّ قراءة لصفوف جدول قد لا يكون موجودًا تمرّ عبر query_to_xml + xpath، كي
-- يُبلّغ الملفّ عن الغياب بدل أن ينهار معه بـ42P01. xpath هي ما يستخرج العدد؛
-- count(*) على query_to_xml وحدها تعيد ١ دائمًا ولا تفحص شيئًا.
r_events_talent as (
  select case when to_regclass('public.comms_event_catalog') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.comms_event_catalog
                       where event_key = ''talent.' || k || '''', false, true, '')))[1]::text::int >= 1
              then 'PASS' else 'FAIL' end as verdict,
         'الأحداث' as area, 'talent.' || k as object,
         'حدث مطلوب بالعقد — مُعرَّف في الكتالوج' as detail
    from talent_events),

r_events_asset as (
  select case when to_regclass('public.comms_event_catalog') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.comms_event_catalog
                       where event_key = ''asset.' || k || '''', false, true, '')))[1]::text::int >= 1
              then 'PASS' else 'FAIL' end as verdict,
         'الأحداث' as area, 'asset.' || k as object,
         'حدث أصول — مملوك لحزمة الأصول ومُعرَّف هنا بـon conflict do nothing كي تلتقي الحزمتان' as detail
    from asset_events),

r_events_channels as (
  select case when to_regclass('public.comms_event_catalog') is null then 'SKIP'
              when (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.comms_event_catalog
                       where (event_key like ''talent.%'' or event_key like ''asset.%'')
                         and (''email'' = any(channels) or ''whatsapp'' = any(channels)
                              or ''sms'' = any(channels))', false, true, '')))[1]::text::int = 0
              then 'PASS' else 'FAIL' end as verdict,
         'الأحداث' as area, '★ لا قناة إرسال ★' as object,
         'أحداث الوحدة بقناة portal وحدها. أيّ email/whatsapp/sms هنا خرق للعقد' as detail),

r_idem as (
  select case when to_regclass('public.tvn_event_log') is null then 'FAIL'
              when to_regprocedure('public.tvn_emit(text,text,uuid,jsonb,text)') is null then 'FAIL'
              when not exists (select 1 from pg_indexes
                                where schemaname='public' and tablename='tvn_event_log'
                                  and indexdef ilike '%unique%' and indexdef ilike '%idempotency_key%') then 'FAIL'
              when pg_get_functiondef(to_regprocedure('public.tvn_emit(text,text,uuid,jsonb,text)')) ilike '%dry_run%' then 'FAIL'
              else 'PASS' end as verdict,
         'الأحداث' as area, 'منع التكرار ولا لمس للقنوات' as object,
         'مفتاح تفرُّد فريد + مسار الإدراج لا يمرّر dry_run ولا يستدعي comms_channel_set' as detail),

-- ─── (١٣) إعادة الاستخدام: لا ازدواج ───────────────────────────────────────
r_vendor_bridge as (
  select case when to_regclass('public.custody_vendors') is null then 'SKIP'
              when exists (select 1 from information_schema.columns
                            where table_schema='public' and table_name='custody_vendors'
                              and column_name='tvn_profile_id')
              then 'PASS' else 'FAIL' end as verdict,
         'إعادة الاستخدام' as area, 'custody_vendors.tvn_profile_id' as object,
         'الجسر موجود — مورّد واحد لا مورّدان' as detail),

r_no_dup_vendor as (
  select case when (select count(*) from information_schema.tables
                     where table_schema='public'
                       and table_name in ('tvn_vendors','talent_vendors','vendors')) = 0
              then 'PASS' else 'FAIL' end as verdict,
         'إعادة الاستخدام' as area, 'لا جدول مورّدين ثانٍ' as object,
         'مصدران لنفس المورّد أسوأ من ميزة غائبة' as detail),

r_freeze as (
  select case when (select count(*) from pg_constraint c
                      join pg_class ref on ref.oid = c.confrelid
                      join pg_class src on src.oid = c.conrelid
                     where src.relname = 'tvn_assignments'
                       and c.contype = 'f'
                       and ref.relname in ('projects','project_core','deliverables')) = 0
              then 'PASS' else 'FAIL' end as verdict,
         'تجميد المنصّة' as area, 'tvn_assignments.project_id' as object,
         'مرجع للقراءة فقط بلا مفتاح أجنبيّ إلى جداول المنصّة المجمَّدة' as detail),

all_rows as (
  select * from r_tables union all select * from r_pred union all select * from r_api
  union all select * from r_internal union all select * from r_types union all select * from r_states
  union all select * from r_gender union all select * from r_gender_purpose
  union all select * from r_guard union all select * from r_confirm_recheck
  union all select * from r_no_autoassign
  union all select * from r_doc_valid union all select * from r_doc_self
  union all select * from r_doc_owner union all select * from r_doc_restricted_policy
  union all select * from r_review_trigger union all select * from r_review_nodelete
  union all select * from r_review_self union all select * from r_review_sample
  union all select * from r_review_correction
  union all select * from r_rate_policy union all select * from r_rate_null union all select * from r_bank
  union all select * from r_rls union all select * from r_no_write_policy union all select * from r_no_anon
  union all select * from r_events_talent union all select * from r_events_asset
  union all select * from r_events_channels union all select * from r_idem
  union all select * from r_vendor_bridge union all select * from r_no_dup_vendor
  union all select * from r_freeze
)

select
  case verdict when 'FAIL' then 1 when 'SKIP' then 2 else 3 end as sort_key,
  verdict, area, object, detail
from all_rows
order by sort_key, area, object;
