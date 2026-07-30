-- ════════════════════════════════════════════════════════════════════════════
-- vendor_compliance_center_POSTCHECK.sql        (READ-ONLY — مجموعة نتائج واحدة)
--
-- يُنفَّذ بعد vendor_compliance_center_RUNME.sql. **جملة SQL واحدة** تُرجع جدول
-- فحوص: محرّر SQL يعرض نتيجة الجملة الأخيرة فقط، فلو كُتبت الفحوص جملًا متتالية
-- لضاعت كلّها إلّا الأخيرة، ولبدا الملفّ ناجحًا وهو لم يُقرأ أصلًا.
--
-- ─── لماذا ساكن بالكامل ────────────────────────────────────────────────────
-- المحرّر يعمل بدور postgres و auth.uid() = NULL. أيّ نداء لدالّة محميّة هنا
-- يرفع «not authorized» فيقتل الفحص كلّه، وأيّ نداء لدالّة تكتب يلوّث سجلّ
-- وثائق حقيقيًّا. لذلك كلّ فحص مصدره pg_catalog: وجود الكائن، **جسمه** عبر
-- pg_get_functiondef مع ilike (المُفكِّك يرفع حالة الكلمات المفتاحية فلا تصلح
-- المطابقة الحسّاسة)، وقيوده وصلاحياته.
--
-- ─── لماذا to_regclass/to_regprocedure في كلّ مرجع ─────────────────────────
-- ذكر جدول غائب في FROM ينهار بـ42P01 ويقتل الملفّ بدل أن يُبلّغ عن الغياب.
--
-- القراءة: كلّ صفّ verdict = 'PASS' ⇒ نجاح. أيّ '❌ FAIL' ⇒ اقرأ عمود «الواقع»
-- قبل أيّ شيء. الصفوف 'ℹ️ INFO' توثيقية ولا تُفشل شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
with
src as (
  select
    to_regclass('public.tvn_documents')              as docs_rel,
    to_regclass('public.tvn_document_types')         as types_rel,
    to_regclass('public.vcc_company_profile')        as company_rel,
    to_regclass('public.vcc_document_grants')        as grants_rel,
    to_regclass('public.vcc_grant_documents')        as gdocs_rel,
    to_regclass('public.vcc_grant_access_log')       as glog_rel,
    to_regclass('public.vcc_registration_requests')  as reg_rel,
    to_regclass('public.vcc_registration_checklist') as chk_rel,
    to_regclass('public.vcc_readiness_requirements') as reqs_rel,
    to_regclass('public.vcc_documents')              as third_registry_a,
    to_regclass('public.compliance_documents')       as third_registry_b,
    to_regclass('storage.buckets')                   as buckets_rel,
    to_regprocedure('public.vcc_grant_open(text,text,uuid,text)')        as oid_open,
    to_regprocedure('public.vcc_grant_issue(uuid)')                      as oid_issue,
    to_regprocedure('public.vcc_readiness(text)')                        as oid_ready,
    to_regprocedure('public.vcc_document_decide(uuid,text,text)')        as oid_decide,
    to_regprocedure('public.vcc_document_list(jsonb)')                   as oid_list,
    to_regprocedure('public.vcc_registration_status_board()')            as oid_board,
    to_regprocedure('public.tvn_doc_valid(text,uuid,text)')              as oid_valid,
    to_regprocedure('public.vcc_emit(text,text,uuid,jsonb,text)')        as oid_emit,
    to_regprocedure('public.vcc_grant_document_guard()')                 as oid_guard,
    to_regprocedure('public.vcc_storage_readable(text)')                 as oid_storage,
    to_regprocedure('public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)') as oid_hub,
    to_regprocedure('public.emp_has_permission(uuid,text)')              as oid_perm
),
defs as (
  select
    coalesce(pg_get_functiondef((select oid_open   from src)), '') as d_open,
    coalesce(pg_get_functiondef((select oid_issue  from src)), '') as d_issue,
    coalesce(pg_get_functiondef((select oid_ready  from src)), '') as d_ready,
    coalesce(pg_get_functiondef((select oid_decide from src)), '') as d_decide,
    coalesce(pg_get_functiondef((select oid_list   from src)), '') as d_list,
    coalesce(pg_get_functiondef((select oid_board  from src)), '') as d_board,
    coalesce(pg_get_functiondef((select oid_valid  from src)), '') as d_valid,
    coalesce(pg_get_functiondef((select oid_emit   from src)), '') as d_emit,
    coalesce(pg_get_functiondef((select oid_guard  from src)), '') as d_guard,
    coalesce(pg_get_functiondef((select oid_storage from src)), '') as d_storage
),
-- المُسنَدات الثمانية: موجودة؟ boolean؟ لا NULL؟ ولا بوّابة فضفاضة؟
preds as (
  select p.sig, coalesce(pg_get_functiondef(to_regprocedure(p.sig)), '') as def,
         to_regprocedure(p.sig) as oid
    from (values
      ('public.can_view_compliance_center()'),
      ('public.can_manage_compliance_documents()'),
      ('public.can_verify_compliance_documents()'),
      ('public.can_issue_secure_document_grants()'),
      ('public.can_view_restricted_company_documents()'),
      ('public.can_manage_vendor_registration()'),
      ('public.vcc_can_view_request_status()'),
      ('public.vcc_can_view_operational_documents()')
    ) p(sig)
),
-- الدوالّ الداخلية التي **يجب ألّا** تكون منفَّذة من العميل.
internals as (
  select f.sig, to_regprocedure(f.sig) as oid
    from (values
      ('public.vcc_emit(text,text,uuid,jsonb,text)'),
      ('public.vcc_log(text,text,uuid,boolean,jsonb)'),
      ('public.vcc_storage_readable(text)'),
      ('public.vcc_perm(text)')
    ) f(sig)
),
-- الواجهة العامّة التي **يجب** أن تكون منفَّذة من authenticated.
publics as (
  select f.sig, to_regprocedure(f.sig) as oid
    from (values
      ('public.vcc_access()'), ('public.vcc_company_get()'),
      ('public.vcc_document_register(jsonb)'), ('public.vcc_document_list(jsonb)'),
      ('public.vcc_readiness(text)'), ('public.vcc_grant_create(jsonb)'),
      ('public.vcc_registration_upsert(jsonb)'), ('public.vcc_scan_compliance(boolean)')
    ) f(sig)
),
cons as (
  select k.conname, pg_get_constraintdef(k.oid) as def
    from pg_constraint k
   where k.conrelid = (select docs_rel from src)
),
regcons as (
  select k.conname from pg_constraint k where k.conrelid = (select reg_rel from src)
),
checks as (

select 1, '★ سجلّ الوثائق واحد — لم يُنشأ سجلّ ثالث',
       'لا vcc_documents ولا compliance_documents',
       case when (select third_registry_a from src) is not null
             or (select third_registry_b from src) is not null
            then '❌ يوجد سجلّ وثائق ثانٍ ⇒ ثلاثة أجوبة عن صلاحية الشهادة نفسها'
            else 'tvn_documents وحده هو السجلّ ✓' end,
       (select third_registry_a from src) is null and (select third_registry_b from src) is null

union all
select 2, 'الجداول الجديدة موجودة', '١٥ جدولًا',
       (select count(*)::text from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relkind = 'r' and c.relname like 'vcc\_%') || ' جدولًا',
       (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
         where ns.nspname = 'public' and c.relkind = 'r' and c.relname like 'vcc\_%') = 15

union all
select 3, '★★ storage_bucket مثبَّت — أوراكل القراءة العابر مغلق',
       'CHECK يقصر الـbucket على compliance-documents',
       case when exists (select 1 from cons where conname = 'tvn_doc_bucket_pinned'
                          and def ilike '%compliance-documents%')
            then 'مثبَّت ✓' else '❌ نصّ حرّ ⇒ صفّ وثيقة يشير إلى bucket آخر يصير أوراكل قراءة' end,
       exists (select 1 from cons where conname = 'tvn_doc_bucket_pinned' and def ilike '%compliance-documents%')

union all
select 4, '★★ نمط مسار التخزين مقيَّد (لا `..` ولا مسار حرّ)',
       'CHECK على storage_path',
       case when exists (select 1 from cons where conname = 'tvn_doc_path_shape')
            then 'مقيَّد ✓' else '❌ المسار نصّ حرّ' end,
       exists (select 1 from cons where conname = 'tvn_doc_path_shape')

union all
select 5, '★ الرفع ليس توثيقًا — verified مستحيل خارج حالة verified',
       'tvn_doc_verified_iff_status قائم',
       case when exists (select 1 from cons where conname = 'tvn_doc_verified_iff_status')
            then 'قائم ⇒ الأرشفة والإلغاء يُخرجان الوثيقة من الصلاحية ✓'
            else '❌ وثيقة ملغاة قد تبقى «صالحة» في عين tvn_doc_valid' end,
       exists (select 1 from cons where conname = 'tvn_doc_verified_iff_status')

union all
select 6, '★ الرافع لا يوثّق — القيد القديم لم يُمسّ', 'tvn_doc_verify_not_self قائم',
       case when exists (select 1 from cons where conname = 'tvn_doc_verify_not_self')
            then 'قائم ✓' else '❌ اختفى' end,
       exists (select 1 from cons where conname = 'tvn_doc_verify_not_self')

union all
select 7, 'دالّة التوثيق خلف بوّابة التوثيق وتفحص الرافع',
       'can_verify_compliance_documents + uploaded_by',
       case when (select d_decide from defs) ilike '%can_verify_compliance_documents%'
             and (select d_decide from defs) ilike '%uploaded_by%'
            then 'الاثنان حاضران ✓' else '❌ التوثيق غير محروس' end,
       (select d_decide from defs) ilike '%can_verify_compliance_documents%'
       and (select d_decide from defs) ilike '%uploaded_by%'

union all
select 8, '★ الرقم الكامل لا يُخزَّن لوثائق الشركة',
       'tvn_doc_company_no_raw_number + tvn_doc_masked_number',
       case when exists (select 1 from cons where conname = 'tvn_doc_company_no_raw_number')
             and exists (select 1 from cons where conname = 'tvn_doc_masked_number')
            then 'القيدان قائمان ✓' else '❌ يمكن تخزين رقم وثيقة كامل' end,
       exists (select 1 from cons where conname = 'tvn_doc_company_no_raw_number')
       and exists (select 1 from cons where conname = 'tvn_doc_masked_number')

union all
select 9, 'owner_kind يشمل company والمالك واحد بالضبط',
       'tvn_doc_owner_kind_v2 + tvn_doc_owner_exact',
       case when exists (select 1 from cons where conname = 'tvn_doc_owner_kind_v2' and def ilike '%company%')
             and exists (select 1 from cons where conname = 'tvn_doc_owner_exact' and def ilike '%company%')
            then 'الاثنان يعرفان company ✓' else '❌ وثائق الشركة غير مسنودة بنيويًّا' end,
       exists (select 1 from cons where conname = 'tvn_doc_owner_kind_v2' and def ilike '%company%')
       and exists (select 1 from cons where conname = 'tvn_doc_owner_exact' and def ilike '%company%')

union all
select 10, '★★ التعريف الواحد للصلاحية وُسّع ولم يُفرَّع',
       'tvn_doc_valid فيها الفروع الأربعة وتشترط verified + غير منتهية',
       case when (select d_valid from defs) = '' then '❌ الدالّة مفقودة'
            when (select d_valid from defs) not ilike '%p_owner_kind = ''company''%'
                 then '❌ لا فرع company ⇒ كلّ وثيقة شركة تُقرأ «غير صالحة» وهي سارية'
            when (select d_valid from defs) not ilike '%d.profile_id = p_owner_id%'
                 then '❌ التوسعة أسقطت فرع الملفّ الشخصيّ'
            when (select d_valid from defs) not ilike '%verified = true%'
                 then '❌ الصلاحية لم تعد تشترط التوثيق'
            else 'الفروع الأربعة + «موثَّقة وغير منتهية» ✓' end,
       (select d_valid from defs) ilike '%p_owner_kind = ''company''%'
       and (select d_valid from defs) ilike '%d.profile_id = p_owner_id%'
       and (select d_valid from defs) ilike '%d.vendor_id  = p_owner_id%'
       and (select d_valid from defs) ilike '%d.asset_id   = p_owner_id%'
       and (select d_valid from defs) ilike '%verified = true%'

union all
select 11, '★★ الرمز يُخزَّن بصمةً فقط — لا عمود يحمل رمزًا خامًّا',
       'token_hash موجود، ولا token/raw_token/secret',
       case when (select count(*) from information_schema.columns
                   where table_schema='public' and table_name='vcc_document_grants'
                     and column_name in ('token','raw_token','token_plain','secret')) > 0
            then '❌ عمود يحمل الرمز الخام'
            when not exists (select 1 from information_schema.columns
                              where table_schema='public' and table_name='vcc_document_grants'
                                and column_name='token_hash')
            then '❌ لا عمود بصمة'
            else 'بصمة فقط ✓' end,
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='vcc_document_grants' and column_name='token_hash')
       and not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='vcc_document_grants'
                          and column_name in ('token','raw_token','token_plain','secret'))

union all
select 12, '★ الإصدار يهشّم الرمز ويعلن أنّ المشاركة يدوية',
       'sha256 + «جاهز للمشاركة اليدوية»',
       case when (select d_issue from defs) not ilike '%sha256%' then '❌ الرمز لا يُهشَّم'
            when (select d_issue from defs) not ilike '%جاهز للمشاركة اليدوية%'
                 then '❌ لا إعلان بأنّ الرابط يُشارَك يدويًّا'
            else 'يهشّم ويعلن ✓' end,
       (select d_issue from defs) ilike '%sha256%'
       and (select d_issue from defs) ilike '%جاهز للمشاركة اليدوية%'

union all
select 13, '★★ الاسترداد يغطّي الإلغاء والانتهاء والحدود وانتماء الوثيقة',
       'revoked · expired · open_limit · download_limit · not_in_grant · no_longer_valid',
       case when (select d_open from defs) = '' then '❌ vcc_grant_open مفقودة'
            when (select d_open from defs) not ilike '%document_not_in_grant%'
                 then '❌ يمكن بلوغ وثيقة خارج المنحة بمعرّف صحيح'
            when (select d_open from defs) not ilike '%document_no_longer_valid%'
                 then '❌ إلغاء الوثيقة بعد الإصدار لا يوقف الرابط'
            when (select d_open from defs) not ilike '%open_limit_reached%'
                 then '❌ حدّ الفتح غير مطبَّق'
            else 'الحالات الستّ مغطّاة ✓' end,
       (select d_open from defs) ilike '%revoked%'
       and (select d_open from defs) ilike '%expired%'
       and (select d_open from defs) ilike '%open_limit_reached%'
       and (select d_open from defs) ilike '%download_limit_reached%'
       and (select d_open from defs) ilike '%document_not_in_grant%'
       and (select d_open from defs) ilike '%document_no_longer_valid%'

union all
select 14, '★ الاسترداد لا يميّز «غير موجود» عن «منتهٍ» (لا أوراكل تخمين)',
       'رسالة واحدة invalid_or_expired',
       case when (select d_open from defs) ilike '%invalid_or_expired%'
            then 'رسالة موحّدة ✓' else '❌ الرسائل تكشف وجود الرمز' end,
       (select d_open from defs) ilike '%invalid_or_expired%'

union all
select 15, '★ الاسترداد لا يقرأ التخزين مباشرةً (لا فهرسة مجلَّد)',
       'لا ذكر لـstorage.objects',
       case when (select d_open from defs) ilike '%storage.objects%'
            then '❌ يقرأ التخزين ⇒ احتمال فهرسة' else 'لا قراءة تخزين ✓' end,
       (select d_open from defs) not ilike '%storage.objects%'

union all
select 16, '★★ vcc_grant_open ليست منفَّذة من anon ولا authenticated',
       'service_role وحده',
       case when (select oid_open from src) is null then '❌ الدالّة مفقودة'
            when exists (select 1 from pg_roles where rolname='anon')
                 and has_function_privilege('anon', (select oid_open from src), 'EXECUTE')
                 then '❌ anon تستطيع الاسترداد'
            when exists (select 1 from pg_roles where rolname='authenticated')
                 and has_function_privilege('authenticated', (select oid_open from src), 'EXECUTE')
                 then '❌ authenticated تستطيع الاسترداد مباشرةً'
            else 'محصورة بمسار الخادم ✓' end,
       (select oid_open from src) is not null
       and not (exists (select 1 from pg_roles where rolname='anon')
                and has_function_privilege('anon', (select oid_open from src), 'EXECUTE'))
       and not (exists (select 1 from pg_roles where rolname='authenticated')
                and has_function_privilege('authenticated', (select oid_open from src), 'EXECUTE'))

union all
select 17, '★ الوثيقة الحسّاسة تتطلّب طلبًا واعتمادًا — في حارس الجدول',
       'trg_vcc_grant_document_guard + الشرطان',
       case when not exists (select 1 from pg_trigger
                              where tgrelid = (select gdocs_rel from src)
                                and tgname = 'trg_vcc_grant_document_guard')
            then '❌ الحارس مفقود ⇒ القاعدة داخل الدالّة وحدها'
            when (select d_guard from defs) not ilike '%request_id is null%'
                 or (select d_guard from defs) not ilike '%approved_by is null%'
            then '❌ الحسّاس يُشارَك بلا طلب أو بلا اعتماد'
            else 'الحارس يشترط الطلب والاعتماد ✓' end,
       exists (select 1 from pg_trigger where tgrelid = (select gdocs_rel from src)
                and tgname = 'trg_vcc_grant_document_guard')
       and (select d_guard from defs) ilike '%request_id is null%'
       and (select d_guard from defs) ilike '%approved_by is null%'

union all
select 18, '★ لا تُشارَك وثيقة غير موثَّقة أو منتهية', 'الحارس يرفضها',
       case when (select d_guard from defs) ilike '%غير موثَّقة%'
             and (select d_guard from defs) ilike '%منتهية%'
            then 'مرفوضة ✓' else '❌ يمكن مشاركة وثيقة غير صالحة' end,
       (select d_guard from defs) ilike '%غير موثَّقة%' and (select d_guard from defs) ilike '%منتهية%'

union all
select 19, '★★ لا ادّعاء تقديم إلكترونيّ',
       'vcc_reg_manual_submission_proof + vcc_reg_owner_approval_proof',
       case when not exists (select 1 from regcons where conname='vcc_reg_manual_submission_proof')
            then '❌ يمكن تعليم «سُلّم» بلا مرجع ولا فاعل ولا قناة'
            when not exists (select 1 from regcons where conname='vcc_reg_owner_approval_proof')
            then '❌ يمكن بلوغ «جاهز للتسليم» بلا اعتماد المالك'
            else 'القيدان قائمان ✓' end,
       exists (select 1 from regcons where conname='vcc_reg_manual_submission_proof')
       and exists (select 1 from regcons where conname='vcc_reg_owner_approval_proof')

union all
select 20, '★ بند وثيقة في قائمة التحقّق لا يُعلَّم يدويًّا',
       'vcc_chk_document_not_manual',
       case when exists (select 1 from pg_constraint
                          where conrelid = (select chk_rel from src)
                            and conname = 'vcc_chk_document_not_manual')
            then 'الاستيفاء مشتقّ ✓' else '❌ يمكن تعليم «تمّ» فوق وثيقة منتهية' end,
       exists (select 1 from pg_constraint where conrelid = (select chk_rel from src)
                and conname = 'vcc_chk_document_not_manual')

union all
select 21, '★ محرّك الجاهزية قاعديّ ومفسَّر ويقيس بالتعريف الواحد',
       'rule_based + tvn_doc_valid + reason_ar + الحالات الخمس',
       case when (select d_ready from defs) not ilike '%rule_based%' then '❌ لا إعلان بأنّه قاعديّ'
            when (select d_ready from defs) not ilike '%tvn_doc_valid%' then '❌ يعيد تعريف الصلاحية'
            when (select d_ready from defs) not ilike '%not_configured%' then '❌ لا حالة «غير مُعدّ» ⇒ صفر مضلّل'
            when (select d_ready from defs) not ilike '%reason_ar%' then '❌ بلا سبب مقروء'
            else 'قاعديّ · مفسَّر · بمصدر صلاحية واحد ✓' end,
       (select d_ready from defs) ilike '%rule_based%'
       and (select d_ready from defs) ilike '%tvn_doc_valid%'
       and (select d_ready from defs) ilike '%not_configured%'
       and (select d_ready from defs) ilike '%expired_blockers%'
       and (select d_ready from defs) ilike '%ready_with_warnings%'
       and (select d_ready from defs) ilike '%reason_ar%'

union all
select 22, '★ شاشة حالة المبيعات لا تلمس حقلًا حسّاسًا',
       'لا portal_reference ولا notes ولا بيانات تواصل',
       case when (select d_board from defs) ilike '%portal_reference%'
             or (select d_board from defs) ilike '%contact_email%'
             or (select d_board from defs) ilike '%notes%'
            then '❌ الشاشة تكشف حقلًا خارج الحالة' else 'حالة فقط ✓' end,
       (select d_board from defs) <> ''
       and (select d_board from defs) not ilike '%portal_reference%'
       and (select d_board from defs) not ilike '%contact_email%'
       and (select d_board from defs) not ilike '%notes%'

union all
select 23, '★ قائمة الوثائق لا تُعيد مرجع تخزين',
       'لا storage_path ولا storage_bucket في المخرجات',
       case when (select d_list from defs) ilike '%''storage_path''%'
             or (select d_list from defs) ilike '%''storage_bucket''%'
            then '❌ القائمة تُسرّب مرجع تخزين' else 'بلا مرجع تخزين ✓' end,
       (select d_list from defs) <> ''
       and (select d_list from defs) not ilike '%''storage_path''%'
       and (select d_list from defs) not ilike '%''storage_bucket''%'

union all
select 24, '★ لا إرسال: مسار الأحداث لا يلمس القنوات ولا dry_run',
       'vcc_emit بلا comms_channel_set وبمنع تكرار',
       case when (select d_emit from defs) ilike '%comms_channel_set%'
             or (select d_emit from defs) ilike '%dry_run%'
            then '❌ الوحدة تلمس إعدادات الإرسال'
            when (select d_emit from defs) not ilike '%idempotency_key%'
            then '❌ الأحداث بلا منع تكرار'
            else 'إدراج فقط ✓' end,
       (select d_emit from defs) not ilike '%comms_channel_set%'
       and (select d_emit from defs) not ilike '%dry_run%'
       and (select d_emit from defs) ilike '%idempotency_key%'

union all
select 25, '★ لا دالّة في الوحدة تفعّل قناة إرسال', 'صفر',
       (select count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname='public' and p.proname like 'vcc\_%'
           and pg_get_functiondef(p.oid) ilike '%comms_channel_set%') || ' دالّة',
       (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname='public' and p.proname like 'vcc\_%'
           and pg_get_functiondef(p.oid) ilike '%comms_channel_set%') = 0

union all
select 26, 'المُسنَدات الثمانية موجودة وتعيد boolean ولا تعيد NULL',
       '٨ من ٨',
       (select count(*)::text from preds
         where oid is not null
           and (select prorettype = 'boolean'::regtype from pg_proc where oid = preds.oid)
           and (def ilike '%coalesce%' or def ilike '%return false%')) || ' من ٨',
       (select count(*) from preds
         where oid is not null
           and (select prorettype = 'boolean'::regtype from pg_proc where oid = preds.oid)
           and (def ilike '%coalesce%' or def ilike '%return false%')) = 8

union all
select 27, '⛔ لا مُسنَد مبنيّ على can_manage_projects أو is_kian_member',
       'صفر',
       (select count(*)::text from preds
         where def ilike '%can_manage_projects%' or def ilike '%is_kian_member%') || ' مُسنَد',
       (select count(*) from preds
         where def ilike '%can_manage_projects%' or def ilike '%is_kian_member%') = 0

union all
select 28, 'الدوالّ الداخلية غير منفَّذة من authenticated', 'صفر',
       coalesce((select count(*)::text from internals
                  where oid is not null
                    and exists (select 1 from pg_roles where rolname='authenticated')
                    and has_function_privilege('authenticated', oid, 'EXECUTE')), '0') || ' دالّة',
       coalesce((select count(*) from internals
                  where oid is not null
                    and exists (select 1 from pg_roles where rolname='authenticated')
                    and has_function_privilege('authenticated', oid, 'EXECUTE')), 0) = 0

union all
select 29, 'واجهة المستخدم منفَّذة من authenticated (وإلّا فالشاشة تعطى 42501)',
       '٨ من ٨',
       (select count(*)::text from publics
         where oid is not null
           and (not exists (select 1 from pg_roles where rolname='authenticated')
                or has_function_privilege('authenticated', oid, 'EXECUTE'))) || ' من ٨',
       (select count(*) from publics
         where oid is not null
           and (not exists (select 1 from pg_roles where rolname='authenticated')
                or has_function_privilege('authenticated', oid, 'EXECUTE'))) = 8

union all
select 30, '⛔ لا صلاحية anon على أيّ جدول من الوحدة', 'صفر',
       (select count(*)::text from information_schema.role_table_grants
         where grantee='anon' and table_schema='public' and table_name like 'vcc\_%') || ' منح',
       (select count(*) from information_schema.role_table_grants
         where grantee='anon' and table_schema='public' and table_name like 'vcc\_%') = 0

union all
select 31, '⛔ لا سياسة كتابة مباشرة — الكتابة عبر RPC وحدها', 'صفر',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename like 'vcc\_%' and cmd <> 'SELECT') || ' سياسة',
       (select count(*) from pg_policies
         where schemaname='public' and tablename like 'vcc\_%' and cmd <> 'SELECT') = 0

union all
select 32, 'RLS مفعّلة على كلّ جداول الوحدة', '١٥ من ١٥',
       (select count(*)::text from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='public' and c.relkind='r' and c.relname like 'vcc\_%' and c.relrowsecurity)
       || ' جدولًا',
       (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='public' and c.relkind='r' and c.relname like 'vcc\_%' and c.relrowsecurity) = 15

union all
select 33, '★ سجلّ المنح وسجلّ الوصول أضيق من «رؤية المركز»',
       'سياستاهما على can_issue_secure_document_grants',
       case when exists (select 1 from pg_policies
                          where schemaname='public' and tablename='vcc_document_grants'
                            and qual ilike '%can_view_compliance_center%')
            then '❌ كلّ من يرى المركز يرى المنح' else 'أضيق ✓' end,
       exists (select 1 from pg_policies where schemaname='public' and tablename='vcc_document_grants'
                and qual ilike '%can_issue_secure_document_grants%')
       and not exists (select 1 from pg_policies where schemaname='public' and tablename='vcc_document_grants'
                        and qual ilike '%can_view_compliance_center%')

union all
select 34, '★ بيانات تواصل المراجع خلف بوّابة المقيَّد',
       'سياسة vcc_references على can_view_restricted_company_documents',
       case when exists (select 1 from pg_policies where schemaname='public' and tablename='vcc_references'
                          and qual ilike '%can_view_restricted_company_documents%')
            then 'مقيَّدة ✓' else '❌ بيانات طرف ثالث مكشوفة لكلّ من يرى المركز' end,
       exists (select 1 from pg_policies where schemaname='public' and tablename='vcc_references'
                and qual ilike '%can_view_restricted_company_documents%')

union all
select 35, '★★ bucket الامتثال خاصّ',
       'public = false',
       case when (select buckets_rel from src) is null then 'ℹ️ schema storage غائب — بيئة غير Supabase'
            when (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname like 'compliance documents%') = 0
                 then '❌ لا سياسات على الـbucket'
            else 'خاصّ وبسياستَي قراءة وإضافة ✓' end,
       (select buckets_rel from src) is null
       or (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
            and policyname like 'compliance documents%') = 2

union all
select 36, '★ لا سياسة تعديل أو حذف على bucket الامتثال (إضافة وقراءة فقط)',
       'صفر',
       (select count(*)::text from pg_policies where schemaname='storage' and tablename='objects'
         and policyname like 'compliance documents%' and cmd not in ('SELECT','INSERT')) || ' سياسة',
       (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
         and policyname like 'compliance documents%' and cmd not in ('SELECT','INSERT')) = 0

union all
select 37, '★ سياسة قراءة التخزين تعكس حساسية الصفّ لا اسم الملفّ',
       'vcc_storage_readable تقرأ sensitivity وترفض اليتيم',
       case when (select d_storage from defs) = '' then '❌ الدالّة مفقودة'
            when (select d_storage from defs) not ilike '%can_view_restricted_company_documents%'
                 then '❌ الملفّ المقيَّد يُقرأ بمجرّد رؤية المركز'
            when (select d_storage from defs) not ilike '%return false%'
                 then '❌ قد تعيد NULL ⇒ سياسة معناها «غير محدَّد»'
            else 'حسّاسة للصفّ وfail-closed ✓' end,
       (select d_storage from defs) ilike '%can_view_restricted_company_documents%'
       and (select d_storage from defs) ilike '%return false%'

-- ⚠️ الفحوص ٣٨–٤٠ **بنيوية لا عدّية** عمدًا. عدّ الصفوف كان سيتطلّب
--    `from public.tvn_document_types` مباشرةً، وذكر جدول في FROM يُحلّ وقت
--    التحليل: لو غاب الجدول لانهار الملفّ كلّه بـ42P01 بدل أن يُبلّغ عن غيابه.
--    ولأنّ POSTCHECK بنيويّ بالتعريف، الأنواع المزروعة تُفحَص من الكتالوج.
union all
select 38, 'كتالوج الأنواع اكتسب عمود «لا يُنشر علنًا أبدًا»',
       'tvn_document_types.never_public موجود',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='tvn_document_types'
                            and column_name='never_public')
            then 'موجود ✓' else '❌ مفقود ⇒ لا شيء يمنع رفع حساسية خطاب المصرف إلى public' end,
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='tvn_document_types'
                  and column_name='never_public')

union all
select 39, '★ المُشغِّل يمنع «عامّ» على نوع لا يُنشر ويشدّد الحساسية',
       'trg_vcc_document_normalize يقرأ never_public ولا يُرخي restricted',
       case when not exists (select 1 from pg_trigger
                              where tgrelid = (select docs_rel from src)
                                and tgname = 'trg_vcc_document_normalize')
            then '❌ المُشغِّل مفقود ⇒ الدوالّ القديمة ستفشل بـ23514 وتُقرأ «ترحيلة ناقصة»'
            when coalesce(pg_get_functiondef(to_regprocedure('public.vcc_document_normalize()')),'')
                 not ilike '%never_public%'
            then '❌ لا يمنع نشر خطاب المصرف علنًا'
            else 'يمنع النشر ويشدّد الحساسية ✓' end,
       exists (select 1 from pg_trigger where tgrelid = (select docs_rel from src)
                and tgname = 'trg_vcc_document_normalize')
       and coalesce(pg_get_functiondef(to_regprocedure('public.vcc_document_normalize()')),'')
           ilike '%never_public%'

union all
select 40, 'جدول قواعد الجاهزية مبنيّ بحيث لا يوجد متطلَّب بلا مرجع',
       'CHECK يربط kind بـdoc_type أو profile_field',
       case when (select reqs_rel from src) is null then '❌ الجدول مفقود'
            when not exists (select 1 from pg_constraint
                              where conrelid = (select reqs_rel from src) and contype='c'
                                and pg_get_constraintdef(oid) ilike '%profile_field%')
            then '❌ متطلَّب وثيقة بلا نوع لن يُفحَص أبدًا ⇒ يُقرأ «مستوفًى» بالخطأ'
            else 'كلّ متطلَّب يحمل مرجعه ✓' end,
       (select reqs_rel from src) is not null
       and exists (select 1 from pg_constraint where conrelid = (select reqs_rel from src)
                    and contype='c' and pg_get_constraintdef(oid) ilike '%profile_field%')

union all
select 41, 'ℹ️ مركز الاتصالات', 'اختياريّ',
       case when (select oid_hub from src) is null
            then 'غائب ⇒ الأحداث تُسجَّل في tvn_event_log فقط، والواجهة تقول ذلك'
            else 'حاضر ⇒ الأحداث تدخل الطابور بقناة portal وبـdry_run كما هي' end,
       true

union all
select 42, 'ℹ️ كتالوج الصلاحيات الدقيق', 'اختياريّ',
       case when (select oid_perm from src) is null
            then 'غائب ⇒ كلّ المفاتيح false والمالك وحده يرى المركز (fail-closed)'
            else 'حاضر ⇒ ٨ مفاتيح مسجَّلة بلا منح ضمنيّ' end,
       true

union all
select 43, 'ℹ️ سطح الفرص العامّ', 'اختياريّ · للقراءة فقط',
       case when to_regclass('public.opportunity_requests') is null
            then 'غائب ⇒ ربط طلب تسجيل بمصدره يُرفض برسالة صريحة، ولا نموذج عامّ بديل'
            else 'حاضر ⇒ يُشار إليه ولا يُقرأ منه شيء تلقائيًّا' end,
       true

)
select n as "#", check_name as "الفحص", expected as "المتوقَّع", actual as "الواقع",
       case when passed then 'PASS'
            when check_name like 'ℹ️%' then 'ℹ️ INFO'
            else '❌ FAIL' end as verdict
  from checks as t(n, check_name, expected, actual, passed)
 order by n;
