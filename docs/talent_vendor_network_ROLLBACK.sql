-- ════════════════════════════════════════════════════════════════════════════
-- docs/talent_vendor_network_ROLLBACK.sql — ★ للطوارئ وحدها ★
--
-- ثلاثة مستويات. **المستوى ١ وحده حيّ**؛ المستويان ٢ و٣ معلَّقان سطرًا سطرًا
-- ويحتاجان إزالة التعليق بيد إنسان. التراجع قرار لا حادث، والملفّ الذي يهدم
-- بمجرّد لصقه في المحرّر فخّ لا أداة.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ تحذير خاصّ بهذه الحزمة — اقرأه قبل أيّ شيء ⚠️⚠️
--
--   هذه الحزمة **توسّع جداول حيّة**. المستوى ٢ يحذف عمودًا من
--   public.custody_vendors — جدول مورّدين يحمل بيانات شراء حقيقية:
--
--     custody_vendors.tvn_profile_id
--
--   ★ حذف هذا العمود يمحو الربط بين كلّ صفّ شراء وملفّ الشبكة المقابل ★
--   الصفوف نفسها تبقى، لكنّ الجواب عن «مَن هذا المورّد في الشبكة؟» يضيع نهائيًّا
--   ولا يمكن استنتاجه من الاسم: أسماء المورّدين متكرّرة ومكتوبة يدويًّا. إعادة
--   بناء الربط بعد الحذف عمل يدويّ من الصفر.
--
--   لذلك: انسخ الربط قبل أيّ شيء، وهذا الملفّ **لا ينسخ عنك**:
--     create table public._bak_custody_vendor_link as
--       select id, name, tvn_profile_id from public.custody_vendors
--        where tvn_profile_id is not null;
--
--   وبالمقابل: هذا الملفّ **لا يحذف صفًّا واحدًا** من custody_vendors نفسه،
--   ولا من custody_inventory_assets، ولا من opportunity_requests، ولا من
--   مركز الاتصالات، ولا من منصّة المشاريع.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ─── ما الذي يُفقَد فعلًا في المستوى ٣، بلا تجميل ──────────────────────────
--  ★ يُفقَد نهائيًّا ولا يوجد له مصدر آخر في النظام:
--    • tvn_profiles          — كلّ ملفّات الشبكة: الأسماء القانونية، المهن،
--      المهارات، اللغات، تغطية المدن، المعدّات المملوكة، الخبرة، سياسة السفر،
--      السجلّ التجاريّ والضريبيّ. ★ بيانات أدخلها بشر يدويًّا ★
--    • tvn_profile_rates     — تاريخ الأسعار كلّه: اليوميّ والساعيّ والإضافيّ
--      وفتراته. لا يوجد مكان آخر يحفظ السعر المتّفق عليه.
--    • tvn_profile_bank      — البيانات البنكية الوصفية وحالة توثيقها.
--    • tvn_profile_restricted— الحقل المقيَّد **وغرضه الموثَّق**. فقد الغرض
--      أخطر من فقد القيمة: من يعيد إدخاله لاحقًا لن يعرف لماذا كان مقيَّدًا.
--    • tvn_availability      — نوافذ التوافر والحجب والتأكيدات.
--    • tvn_documents         — سجلّ الوثائق: أرقامها، تواريخ الإصدار والانتهاء،
--      ★ ومن وثّقها ومتى ★. مسارات التخزين تبقى في الحاوية لكنّ معناها يضيع:
--      ملفّ بلا سجلّ ليس وثيقة موثَّقة، بل ملفّ مرفوع فحسب — وهذا بالضبط الفرق
--      الذي بُنيت الوحدة لحفظه.
--    • tvn_assignments       — تاريخ الإسناد كلّه: مَن أُسند ولمن ومتى وبكم،
--      ومن اعتمد التكلفة. هذا سجلّ مساءلة؛ فقده يجعل سؤال «لماذا عمل هذا
--      المصوّر في ذلك اليوم؟» بلا جواب إلى الأبد.
--    • tvn_reviews + tvn_review_corrections — ★ الأخطر ★ تقييمات الأداء
--      وتصحيحاتها المُدقَّقة. الوحدة صُمِّمت خصّيصًا كي يستحيل حذف تقييم
--      لإخفاء حادثة؛ **المستوى ٣ يفعل بالجملة ما مُنع بالمفرد**. لا تُشغّله
--      لأنّ تقييمًا مزعج، وهذا ليس تحذيرًا بلاغيًّا: هو الاستعمال الخاطئ الوحيد
--      المتوقَّع لهذا الملفّ.
--    • tvn_incident_flags    — أعلام الحوادث المفتوحة.
--    • tvn_audit             — أثر التدقيق كلّه، بما فيه المحاولات المرفوضة.
--    • tvn_event_log         — ★ سجلّ منع التكرار ★ فقده يعني أنّ أحداثًا سبق
--      إدراجها يمكن أن تُدرَج ثانيةً بعد إعادة التركيب.
--    • tvn_document_types / tvn_settings — البذور تعود بإعادة تشغيل RUNME؛
--      وما عُدِّل بعدها لا يعود.
--
--  ★ لا يُفقَد في أيّ مستوى: custody_* كلّها · الأصول · الفرص · مركز الاتصالات
--    · منصّة المشاريع · كتالوج الصلاحيات.
--
--  ⚠️ أثر جانبيّ مقصود ومذكور: صفوف comms_outbox التي أُدرجت لأحداث talent.*
--     و asset.* **تبقى كما هي**. حذفها يعني تزوير تاريخ الطابور. النتيجة:
--     تبقى الصفوف، ويضيع الكيان الذي تشير إليه.
--
-- ─── قبل المستوى ٣ — خُذ نسخة احتياطية بنفسك ───────────────────────────────
--   ★ هذا الملفّ لا يصنع نسخًا ★
--   create table public._bak_tvn_profiles     as select * from public.tvn_profiles;
--   create table public._bak_tvn_rates        as select * from public.tvn_profile_rates;
--   create table public._bak_tvn_documents    as select * from public.tvn_documents;
--   create table public._bak_tvn_assignments  as select * from public.tvn_assignments;
--   create table public._bak_tvn_reviews      as select * from public.tvn_reviews;
--   create table public._bak_tvn_corrections  as select * from public.tvn_review_corrections;
--   create table public._bak_tvn_audit        as select * from public.tvn_audit;
--   create table public._bak_tvn_event_log    as select * from public.tvn_event_log;
--
-- ─── مفاتيح الصلاحيات ───────────────────────────────────────────────────────
--   مفاتيح talent.* في الكتالوج المشترك **لا تُحذف في أيّ مستوى**: حذف صفّ من
--   public.permissions يلمس موديولات أخرى عبر profession_permissions. عطّلها
--   يدويًّا إن أردت:  update public.permissions set enabled = false where key like 'talent.%';
--
-- ─── أحداث الأصول ───────────────────────────────────────────────────────────
--   مفاتيح asset.* في comms_event_catalog **مشتركة مع حزمة الأصول**. لا تحذفها
--   من هنا: قد تكون حزمة الأصول قد سجّلتها أو تعتمد عليها الآن.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ١ — تعطيل بلا فقدان بيانات. ★ حيّ ★
-- يُوقف الوحدة عمليًّا ويُبقي كلّ صفّ في مكانه. هذا هو ما تريده في ٩٥٪ من
-- حالات الطوارئ: الوحدة تتصرّف بشكل خاطئ، لا أنّ بياناتها خاطئة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- سحب التنفيذ من كلّ دوالّ الواجهة. النتيجة: الواجهة تقرأ «permission denied»
-- وتعرض «الميزة غير مفعّلة» بدل أن تنهار أو تعرض بيانات ناقصة.
do $lvl1$
declare f text;
begin
  foreach f in array array[
    'tvn_profile_upsert(jsonb)','tvn_profile_set_status(uuid,text,text)',
    'tvn_rates_set(uuid,jsonb)','tvn_bank_set(uuid,jsonb)','tvn_restricted_set(uuid,text,text)',
    'tvn_availability_set(jsonb)','tvn_availability_confirm(uuid,text)',
    'tvn_document_upsert(jsonb)','tvn_document_verify(uuid,text)',
    'tvn_suggest(jsonb)','tvn_assignment_propose(jsonb)','tvn_assignment_approve(uuid,text,text)',
    'tvn_assignment_confirm(uuid)','tvn_assignment_cancel(uuid,text)','tvn_assignment_complete(uuid)',
    'tvn_review_submit(jsonb)','tvn_review_close(uuid)','tvn_review_correct(uuid,text,text,text)',
    'tvn_promote_opportunity(uuid,text,jsonb)','tvn_vendor_link(uuid,uuid)','tvn_scan_alerts()']
  loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke execute on function public.%s from authenticated', f);
    end if;
  end loop;
end $lvl1$;

-- تعطيل أحداث الوحدة في الكتالوج — دون حذفها ودون لمس أحداث asset.* المشتركة.
do $lvl1b$
begin
  if to_regclass('public.comms_event_catalog') is not null then
    execute 'update public.comms_event_catalog set active = false where event_key like ''talent.%''';
  end if;
end $lvl1b$;

commit;

notify pgrst, 'reload schema';

-- بعد المستوى ١: القراءة ما زالت تعمل لمن يملك الصلاحية، وكلّ صفّ باقٍ.
-- للتراجع عن المستوى ١: أعد تشغيل RUNME (idempotent) فيستعيد المنح والتفعيل.


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ٢ — فكّ الجسور والتوسيعات على الجداول الحيّة. ★ معلَّق ★
-- ⚠️ يحذف عمودًا من جدول مورّدين حيّ. اقرأ التحذير في رأس الملفّ أوّلًا،
--    وخُذ نسخة _bak_custody_vendor_link قبل إزالة التعليق.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- -- (أ) فكّ المفتاح الأجنبيّ أوّلًا كي لا يمنع حذف الجداول لاحقًا.
-- alter table public.custody_vendors drop constraint if exists custody_vendors_tvn_profile_fk;
-- drop index if exists public.uq_custody_vendors_tvn_profile;
--
-- -- (ب) ★ هنا يضيع الربط ★ لا تنفّذ هذا السطر قبل النسخة الاحتياطية.
-- alter table public.custody_vendors drop column if exists tvn_profile_id;
--
-- -- (ج) مفاتيح الوثائق إلى الأصول والفرص — لا تُحذف بيانات الطرف الآخر.
-- alter table public.tvn_documents drop constraint if exists tvn_documents_vendor_fk;
-- alter table public.tvn_documents drop constraint if exists tvn_documents_asset_fk;
-- alter table public.tvn_profiles  drop constraint if exists tvn_profiles_src_opp_fk;
--
-- commit;
-- notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ٣ — إزالة الوحدة كلّها. ★ معلَّق سطرًا سطرًا · فقدان دائم ★
-- ⚠️ يحذف تقييمات أداء وسجلّ وثائق وتاريخ إسناد. راجع قائمة الفقدان في الرأس.
-- ⚠️ ما لم تكن قد أخذت النسخ الاحتياطية أعلاه، لا يوجد تراجع عن هذا المستوى.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- -- الحارس أوّلًا، وإلّا منع المُشغِّل حذف صفوف التقييمات.
-- drop trigger if exists trg_tvn_review_immutable on public.tvn_reviews;
-- drop function if exists public.tvn_review_immutable();
--
-- -- دوالّ الواجهة
-- drop function if exists public.tvn_access();
-- drop function if exists public.tvn_profile_get(uuid);
-- drop function if exists public.tvn_profile_list(jsonb);
-- drop function if exists public.tvn_profile_upsert(jsonb);
-- drop function if exists public.tvn_profile_set_status(uuid,text,text);
-- drop function if exists public.tvn_rates_set(uuid,jsonb);
-- drop function if exists public.tvn_bank_set(uuid,jsonb);
-- drop function if exists public.tvn_restricted_set(uuid,text,text);
-- drop function if exists public.tvn_availability_set(jsonb);
-- drop function if exists public.tvn_availability_confirm(uuid,text);
-- drop function if exists public.tvn_document_upsert(jsonb);
-- drop function if exists public.tvn_document_verify(uuid,text);
-- drop function if exists public.tvn_document_alerts(boolean);
-- drop function if exists public.tvn_suggest(jsonb);
-- drop function if exists public.tvn_assignment_propose(jsonb);
-- drop function if exists public.tvn_assignment_approve(uuid,text,text);
-- drop function if exists public.tvn_assignment_confirm(uuid);
-- drop function if exists public.tvn_assignment_cancel(uuid,text);
-- drop function if exists public.tvn_assignment_complete(uuid);
-- drop function if exists public.tvn_review_submit(jsonb);
-- drop function if exists public.tvn_review_close(uuid);
-- drop function if exists public.tvn_review_correct(uuid,text,text,text);
-- drop function if exists public.tvn_reviews_for_profile(uuid);
-- drop function if exists public.tvn_promote_opportunity(uuid,text,jsonb);
-- drop function if exists public.tvn_vendor_link(uuid,uuid);
-- drop function if exists public.tvn_scan_alerts();
--
-- -- دوالّ داخلية
-- drop function if exists public.tvn_assignment_guard(uuid,timestamptz,timestamptz,boolean,text[],uuid);
-- drop function if exists public.tvn_has_conflict(uuid,timestamptz,timestamptz,uuid);
-- drop function if exists public.tvn_missing_required_docs(uuid);
-- drop function if exists public.tvn_doc_valid(text,uuid,text);
-- drop function if exists public.tvn_rating(uuid);
-- drop function if exists public.tvn_emit(text,text,uuid,jsonb,text);
-- drop function if exists public.tvn_log(text,text,uuid,boolean,jsonb);
-- drop function if exists public.tvn_event_keys();
-- drop function if exists public.tvn_asset_event_keys();
-- drop function if exists public.tvn_txt(jsonb,text);
-- drop function if exists public.tvn_num(jsonb,text);
-- drop function if exists public.tvn_bool(jsonb,text,boolean);
-- drop function if exists public.tvn_arr(jsonb,text);
--
-- -- ⚠️ المُسنَدات الستّة بأسمائها العامّة. تحقّق أوّلًا من أنّ لا موديول آخر
-- --    صار يعتمد عليها بعد تشغيل هذه الحزمة (PREFLIGHT كان يحذّر من التعارض).
-- drop function if exists public.can_view_talent_network();
-- drop function if exists public.can_manage_talent_profiles();
-- drop function if exists public.can_view_vendor_rates();
-- drop function if exists public.can_verify_compliance();
-- drop function if exists public.can_assign_external_resources();
-- drop function if exists public.can_review_resource_performance();
-- drop function if exists public.tvn_can_view_bank();
-- drop function if exists public.tvn_can_approve_cost();
-- drop function if exists public.tvn_perm(text);
-- drop function if exists public.tvn_is_staff();
-- drop function if exists public.tvn_is_owner();
--
-- -- ★ الجداول ★ الترتيب يحترم المفاتيح الأجنبية.
-- drop table if exists public.tvn_review_corrections;
-- drop table if exists public.tvn_incident_flags;
-- drop table if exists public.tvn_reviews;
-- drop table if exists public.tvn_assignment_candidates;
-- drop table if exists public.tvn_assignments;
-- drop table if exists public.tvn_documents;
-- drop table if exists public.tvn_document_types;
-- drop table if exists public.tvn_availability;
-- drop table if exists public.tvn_profile_restricted;
-- drop table if exists public.tvn_profile_bank;
-- drop table if exists public.tvn_profile_rates;
-- drop table if exists public.tvn_profiles;
-- drop table if exists public.tvn_event_log;
-- drop table if exists public.tvn_audit;
-- drop table if exists public.tvn_settings;
--
-- commit;
-- notify pgrst, 'reload schema';
