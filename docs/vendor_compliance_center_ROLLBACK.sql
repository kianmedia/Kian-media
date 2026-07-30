-- ════════════════════════════════════════════════════════════════════════════
-- vendor_compliance_center_ROLLBACK.sql                        🚨 طوارئ فقط 🚨
--
-- ██ اقرأ هذا كاملًا قبل أن تنسخ سطرًا واحدًا ████████████████████████████████
--
-- هذه الحزمة **لم تُنشئ نظامًا جانبيًّا يمكن رميه**. هي:
--   (أ) وسّعت سجلّ الوثائق القائم tvn_documents بأعمدة وقيود ومُشغِّل،
--   (ب) وأنشأت جداول جديدة تحمل **تاريخًا حقيقيًّا**: من وثّق ماذا ومتى، ومن
--       أُعطي وصولًا إلى أيّ وثيقة ومتى فتحها، وأيّ جهة طلبت تسجيلنا مورّدًا.
--
-- ─── ما يستعيده هذا الملفّ بلا خسارة صفّ واحد ──────────────────────────────
--   القسم ١: المُشغِّلات والحرّاس  → يعود السلوك إلى ما قبل الحزمة.
--   القسم ٢: الدوالّ الجديدة       → تختفي الواجهة. الجداول تبقى سجلًّا خاملًا.
--   القسم ٣: القيود الجديدة        → تُرخى الثوابت. لا فقدان صفوف.
--   القسم ٤: سياسات التخزين        → يُقفَل الـbucket في وجه الجميع (fail-closed).
--
-- ─── ⚠️ ما يُتلف بيانات حقيقية ولا يُسترجَع (معطَّل بالتعليق) ───────────────
--   القسم ٥:
--     • drop table vcc_grant_access_log
--       ⇒ ✂️ **يُمحى دليل من فتح أيّ وثيقة ومتى**. هذا سجلّ وصول طرف خارجيّ
--         إلى وثائق الشركة: خطاب مصرف، عقد، تفويض توقيع. لا نسخة منه في أيّ
--         مكان آخر، ولا يمكن إعادة بنائه. بعد حذفه يصير سؤال «هل رأى ذلك
--         المورّد خطابنا المصرفيّ؟» بلا جواب إلى الأبد.
--     • drop table vcc_document_grants / vcc_grant_documents
--       ⇒ ✂️ يُمحى من أذن ومن أصدر ولمن وإلى متى. أثر تدقيق قانونيّ.
--     • drop table vcc_registration_requests وتوابعها
--       ⇒ ✂️ **يُمحى دليل التسليم اليدويّ**: من سلّم، ومتى، وبأيّ مرجع لدى
--         بوّابة المشتريات. عند أيّ نزاع مع جهة حكومية أو عميل، هذا الصفّ هو
--         الإثبات الوحيد بأنّ الملفّ سُلّم أصلًا.
--     • drop table vcc_company_profile / _contacts / _certifications /
--       _references / _industry_experience / _drone_capability
--       ⇒ ✂️ ملفّ الشركة كاملًا وأذون الاستشهاد بالعملاء. يُعاد كتابته يدويًّا،
--         لكنّ «إذن العميل بالاستشهاد به» قد لا يُعاد الحصول عليه.
--
--   القسم ٦ (**الأخطر على الإطلاق** · معطَّل):
--     • حذف صفوف الوثائق (owner_kind = 'company') من tvn_documents
--       ⇒ ✂️ يمحو **سجلّ التوثيق نفسه**: من وثّق السجلّ التجاريّ ومتى وبأيّ
--         ملاحظة. الملفّات في الـbucket تبقى يتيمة، ولن تُقرأ بعدها إطلاقًا
--         لأنّ vcc_storage_readable ترفض كلّ ملفّ بلا صفّ في السجلّ.
--     • drop column على tvn_documents
--       ⇒ ✂️ يمحو verified/verified_by/verified_at لكلّ وثائق **الشبكة** أيضًا
--         إن أخطأت العمود، ويمحو checksum ورقم الوثيقة المُقنَّع.
--       ⚠️ الأعمدة القديمة (verified · verified_by · verified_at · restricted ·
--          doc_number · storage_bucket · storage_path) **ليست من هذه الحزمة**.
--          لا تحذفها. القسم ٦ يستثنيها صراحةً.
--
--   القسم ٧ (معطَّل · تخزين):
--     • حذف الـbucket compliance-documents
--       ⇒ ✂️ **يمحو كلّ الملفّات فيه**: السجلّ التجاريّ، الشهادات، التأمين،
--         خطاب المصرف. لا تفعل هذا قبل تنزيل نسخة والتحقّق منها.
--
-- ─── الطريق الصحيح في ٩٩٪ من الحالات ──────────────────────────────────────
-- لا تحذف شيئًا. شغّل الأقسام ١ و٢ و٤ فقط: تختفي الواجهة والسلوك الجديد،
-- ويُقفَل الـbucket، وتبقى كلّ صفّ وكلّ عمود. جدول بلا دوالّه سجلّ خامل لا يضرّ.
-- الحذف يكون فقط حين يقرّر المالك صراحةً وكتابةً أنّ هذه البيانات بلا قيمة.
--
-- ⚠️ قبل أيّ قسم اختياريّ: خُذ نسخة احتياطية **وتحقّق منها بالاستعادة**. لا
--    يوجد «تراجع عن التراجع» في هذا الملفّ.
-- ⚠️ ولا تنسَ: القسم ٣ يُرخي القيد الذي يمنع الإشارة إلى bucket آخر. بإرخائه
--    تعود الثغرة الأصلية (أوراكل قراءة عابر للـbuckets) قابلةً للاستغلال لحظة
--    وجود أيّ مسار يوقّع تلك الأعمدة بمفتاح الخدمة.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ١ — المُشغِّلات والحرّاس  (آمن · بلا فقدان صفوف)
--
-- ⚠️ ما تعنيه إزالة كلّ حارس، فهي ليست محايدة:
--   • trg_vcc_document_normalize → تعود الحالة والحساسية غير متّسقتين، ويصير
--     ممكنًا تعليم وثيقة هوية أو خطاب مصرف على أنّها 'public'. وأخطر من ذلك:
--     القيود في القسم ٣ ستبقى قائمة بلا المُشغِّل الذي يجعل الدوالّ القديمة
--     (tvn_document_upsert) تمرّ ⇒ كلّ رفع قديم سيفشل بـ23514. **احذف القسم ١
--     والقسم ٣ معًا أو لا تحذف أيًّا منهما.**
--   • trg_vcc_grant_document_guard → تعود إمكانية وضع خطاب المصرف في منحة بلا
--     طلب وبلا اعتماد المالك، ومشاركة وثيقة **غير موثَّقة** أو منتهية.
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop trigger if exists trg_vcc_grant_document_guard on public.vcc_grant_documents;
drop trigger if exists trg_vcc_document_normalize   on public.tvn_documents;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٢ — الدوالّ  (آمن · بلا فقدان صفوف)
--
-- ⚠️ tvn_doc_valid **ليست في هذه القائمة**. هي دالّة حزمة الشبكة، ووسّعناها
--    بفرع 'company'. حذفها هنا يكسر شبكة المواهب كلّها. إن أردت إلغاء التوسعة
--    فأعِد تشغيل talent_vendor_network_RUNME.sql (idempotent) لتستعيد نسختها
--    الأصلية — لكن انتبه: بعدها تعود كلّ وثيقة شركة تُقرأ «غير صالحة».
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop function if exists public.vcc_grant_open(text,text,uuid,text);
drop function if exists public.vcc_grant_audit(uuid);
drop function if exists public.vcc_grant_list(jsonb);
drop function if exists public.vcc_grant_revoke(uuid,text);
drop function if exists public.vcc_grant_issue(uuid);
drop function if exists public.vcc_grant_approve(uuid,text);
drop function if exists public.vcc_grant_remove_document(uuid,uuid);
drop function if exists public.vcc_grant_add_document(uuid,uuid,boolean);
drop function if exists public.vcc_grant_create(jsonb);
drop function if exists public.vcc_grant_document_guard();

drop function if exists public.vcc_registration_attach(jsonb);
drop function if exists public.vcc_registration_comment(uuid,text);
drop function if exists public.vcc_checklist_upsert(jsonb);
drop function if exists public.vcc_registration_status_board();
drop function if exists public.vcc_registration_list(jsonb);
drop function if exists public.vcc_registration_get(uuid);
drop function if exists public.vcc_registration_transition(uuid,text,jsonb);
drop function if exists public.vcc_registration_upsert(jsonb);

drop function if exists public.vcc_scan_compliance(boolean);
drop function if exists public.vcc_readiness(text);
drop function if exists public.vcc_document_storage_ref(uuid);
drop function if exists public.vcc_document_list(jsonb);
drop function if exists public.vcc_document_set_status(uuid,text,text);
drop function if exists public.vcc_document_decide(uuid,text,text);
drop function if exists public.vcc_document_register(jsonb);
drop function if exists public.vcc_doc_effective_status(uuid);
drop function if exists public.vcc_document_normalize();

drop function if exists public.vcc_drone_upsert(jsonb);
drop function if exists public.vcc_experience_upsert(jsonb);
drop function if exists public.vcc_reference_upsert(jsonb);
drop function if exists public.vcc_certification_upsert(jsonb);
drop function if exists public.vcc_contact_upsert(jsonb);
drop function if exists public.vcc_company_set(jsonb);
drop function if exists public.vcc_company_get();
drop function if exists public.vcc_access();

drop function if exists public.vcc_emit(text,text,uuid,jsonb,text);
drop function if exists public.vcc_event_keys();
drop function if exists public.vcc_log(text,text,uuid,boolean,jsonb);
drop function if exists public.vcc_reminder_days();
drop function if exists public.vcc_arr(jsonb,text);
drop function if exists public.vcc_bool(jsonb,text,boolean);
drop function if exists public.vcc_int(jsonb,text);
drop function if exists public.vcc_txt(jsonb,text);

-- ⚠️ vcc_storage_readable تُحذف **بعد** سياسات التخزين (القسم ٤)، وإلّا صارت
--    السياسة تشير إلى دالّة غائبة فتنهار كلّ قراءة من الـbucket بخطأ غامض.
--    لذلك هي ليست هنا — انظر القسم ٤.

drop function if exists public.can_manage_vendor_registration();
drop function if exists public.can_view_restricted_company_documents();
drop function if exists public.can_issue_secure_document_grants();
drop function if exists public.can_verify_compliance_documents();
drop function if exists public.can_manage_compliance_documents();
drop function if exists public.can_view_compliance_center();
drop function if exists public.vcc_can_view_operational_documents();
drop function if exists public.vcc_can_view_request_status();
drop function if exists public.vcc_is_owner();
drop function if exists public.vcc_is_staff();
drop function if exists public.vcc_perm(text);
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٣ — القيود الجديدة على tvn_documents  (آمن للصفوف · خطير للأمان)
--
-- ⛔ اقرأ: إرخاء tvn_doc_bucket_pinned يعيد فتح **الثغرة الأصلية**. لا تشغّل
--    هذا القسم إلّا إن كنت ستعيد الحزمة كاملة، أو إن كنت تنقل الملفّات إلى
--    bucket آخر بقرار موثَّق.
-- ⚠️ شغّله مع القسم ١ (المُشغِّل) وإلّا فشل كلّ رفع قديم بـ23514، أو مرّت
--    وثائق بحالة متناقضة.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_bucket_pinned;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_path_shape;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_ref_paired;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_verified_iff_status;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_status_chk;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_sensitivity_chk;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_restricted_alignment;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_company_no_raw_number;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_masked_number;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_language_chk;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_version_chk;
-- alter table public.tvn_documents drop constraint if exists tvn_doc_checksum_chk;
-- -- ⚠️ استعادة قيد owner_kind الأصليّ (بلا company). ★ سيفشل إن بقي صفّ شركة ★
-- --    وهذا مقصود: لا نحذف صفوفًا نيابةً عنك.
-- alter table public.tvn_documents drop constraint if exists tvn_doc_owner_kind_v2;
-- alter table public.tvn_documents add constraint tvn_documents_owner_kind_check
--   check (owner_kind in ('profile','vendor','asset'));
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٤ — سياسات التخزين  (آمن · fail-closed)
--
-- حذف السياستين يجعل الـbucket **غير مقروء لأحد** (لا سياسة = لا وصول تحت RLS).
-- الملفّات تبقى موجودة وسليمة. هذا هو السلوك المرغوب في حالة طوارئ: أوقف
-- الوصول أوّلًا، وقرّر لاحقًا.
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop policy if exists "compliance documents read"  on storage.objects;
drop policy if exists "compliance documents write" on storage.objects;
-- الآن فقط — بعد اختفاء السياستين اللتين تستدعيانها.
drop function if exists public.vcc_storage_readable(text);
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٥ — ✂️ حذف الجداول الجديدة  (**يُتلف تاريخًا حقيقيًّا** · معطَّل)
--
-- الترتيب يحترم المفاتيح الأجنبية. لا تشغّله إلّا بقرار مكتوب من المالك.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- drop table if exists public.vcc_grant_access_log;        -- ✂️ دليل من فتح أيّ وثيقة
-- drop table if exists public.vcc_grant_documents;
-- drop table if exists public.vcc_document_grants;         -- ✂️ من أذن ولمن وإلى متى
-- drop table if exists public.vcc_registration_attachments;
-- drop table if exists public.vcc_registration_comments;
-- drop table if exists public.vcc_registration_checklist;
-- drop table if exists public.vcc_registration_requests;   -- ✂️ دليل التسليم اليدويّ
-- drop table if exists public.vcc_readiness_requirements;
-- drop table if exists public.vcc_drone_capability;
-- drop table if exists public.vcc_industry_experience;
-- drop table if exists public.vcc_references;              -- ✂️ أذون الاستشهاد بالعملاء
-- drop table if exists public.vcc_certifications;
-- drop table if exists public.vcc_company_contacts;
-- drop table if exists public.vcc_company_profile;
-- drop table if exists public.vcc_settings;
-- drop sequence if exists public.vcc_registration_seq;
-- drop sequence if exists public.vcc_grant_seq;
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٦ — ✂️✂️ سجلّ الوثائق نفسه  (**الأخطر** · معطَّل)
--
-- ⛔ الأعمدة المستثناة صراحةً لأنّها **ليست من هذه الحزمة**:
--    verified · verified_by · verified_at · verification_note · restricted ·
--    doc_number · storage_bucket · storage_path · metadata · uploaded_by.
--    حذف أيّ منها يمحو تاريخ توثيق وثائق **الشبكة** أيضًا، لا الشركة فقط.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- -- ✂️ صفوف وثائق الشركة: يمحو من وثّق ماذا ومتى. الملفّات تبقى يتيمة في
-- --    الـbucket ولن تُقرأ بعدها إطلاقًا (السياسة ترفض الملفّ بلا صفّ).
-- -- delete from public.tvn_documents where owner_kind = 'company';
--
-- -- ✂️ الأعمدة التي أضافتها هذه الحزمة وحدها:
-- -- alter table public.tvn_documents
-- --   drop column if exists title, drop column if exists doc_language,
-- --   drop column if exists issuer, drop column if exists doc_number_masked,
-- --   drop column if exists doc_version, drop column if exists supersedes_id,
-- --   drop column if exists doc_status, drop column if exists sensitivity,
-- --   drop column if exists is_downloadable, drop column if exists watermark_required,
-- --   drop column if exists internal_notes, drop column if exists checksum_sha256,
-- --   drop column if exists file_name, drop column if exists file_mime,
-- --   drop column if exists file_bytes,
-- --   drop column if exists rejected_by, drop column if exists rejected_at,
-- --   drop column if exists reject_reason,
-- --   drop column if exists revoked_by, drop column if exists revoked_at,
-- --   drop column if exists revoke_reason,
-- --   drop column if exists archived_by, drop column if exists archived_at,
-- --   drop column if exists status_changed_by, drop column if exists status_changed_at;
-- -- alter table public.tvn_document_types drop column if exists never_public;
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- القسم ٧ — ✂️ الـbucket نفسه  (**يمحو الملفّات** · معطَّل)
--
-- ⚠️ حذف الـbucket يحذف كلّ كائناته: السجلّ التجاريّ، الشهادات، خطاب المصرف.
--    نزّل نسخة **وتحقّق من فتحها** قبل التفكير في هذا السطر.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
-- -- delete from storage.objects where bucket_id = 'compliance-documents';   -- ✂️
-- -- delete from storage.buckets where id = 'compliance-documents';          -- ✂️
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد أيّ قسم: أعِد تحميل مخطّط PostgREST وإلّا ظلّت الواجهة تنادي دوالّ محذوفة
-- وتقرأ الخطأ على أنّه «ترحيلة معلّقة» بينما السبب أنّك حذفتها للتوّ.
-- ════════════════════════════════════════════════════════════════════════════
notify pgrst, 'reload schema';
