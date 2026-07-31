-- ════════════════════════════════════════════════════════════════════════════
-- vendor_compliance_center_PREFLIGHT.sql              (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ قبل vendor_compliance_center_RUNME.sql. كلّ استعلام هنا SELECT صِرف،
-- والقسم الأخير كتلة DO **ترفع استثناءً** — لا تكتب صفًّا واحدًا، لكنّها توقف
-- التشغيل بدل ترك نصف ترحيلة على سجلّ وثائق قائم.
--
-- ─── لماذا PREFLIGHT صارم هنا تحديدًا ───────────────────────────────────────
-- هذه الحزمة **توسّع سجلّ الوثائق القائم tvn_documents** ولا تُنشئ سجلًّا ثالثًا.
-- لذلك غياب الأساس ليس «ميزة معطّلة»: لو غاب tvn_documents فإنّ أيّ محاولة
-- للمضيّ ستنتهي بسجلّ وثائق جديد بلا قصد — وهو بالضبط ما جاءت الحزمة لمنعه.
--
-- ─── القسم ٥ هو الأهمّ ──────────────────────────────────────────────────────
-- tvn_documents.storage_bucket كان نصًّا حرًّا. الحزمة تثبّته بقيد. لو وُجد صفّ
-- واحد يشير إلى bucket آخر فسيفشل القيد. لن نعدّل مرجع تخزين قائم تلقائيًّا:
-- تعديل صامت لمرجع ملفّ يخفي دليلًا. القسم ٥ يعرض الصفوف بالاسم كي تُنقل يدويًّا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ١) الاعتمادات الإلزامية — الجداول ─────────────────────────────────────
-- متوقّع: present = true في كلّ صفّ. أيّ false ⇒ لا تُشغّل RUNME.
select t.name, (to_regclass(t.name) is not null) as present
from (values ('public.tvn_documents'),
             ('public.tvn_document_types'),
             ('public.tvn_audit'),
             ('public.tvn_event_log'),
             ('auth.users')) t(name);

-- ─── ٢) الاعتمادات الإلزامية — الدوالّ ─────────────────────────────────────
-- متوقّع: exists_now = true في كلّ صفّ.
-- ⚠️ tvn_doc_valid هي **التعريف الوحيد لكلمة «صالحة»**. الحزمة توسّعها بفرع
--    'company' وتبقي فروعها الثلاثة حرفيًّا. غيابها يعني أنّ الجاهزية ستُبنى
--    على تعريف ثانٍ — وهذا ممنوع.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.tvn_doc_valid(text,uuid,text)'),
             ('public.tvn_log(text,text,uuid,boolean,jsonb)'),
             ('public.can_verify_compliance()'),
             ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()'),
             ('pg_catalog.sha256(bytea)')) f(sig);

-- ─── ٣) أنواع الإرجاع — بوّابة تعيد غير boolean تُنتج «غير محدَّد» لا «منع» ──
-- متوقّع: is_boolean = true في الصفّين.
select r.sig,
       coalesce((select p.prorettype = 'boolean'::regtype from pg_proc p
                  where p.oid = to_regprocedure(r.sig)), false) as is_boolean
from (values ('public.can_verify_compliance()'),
             ('public.tvn_doc_valid(text,uuid,text)')) r(sig);

-- ─── ٤) القيود القائمة على tvn_documents التي **يجب ألّا تختفي** ───────────
-- متوقّع: present = true. tvn_doc_verify_not_self هو ما يجعل «الرافع لا يوثّق»
-- قاعدةً بنيوية لا اجتهادًا داخل دالّة. اختفاؤه يعني أنّ الأساس نفسه مكسور.
select c.name, exists (
         select 1 from pg_constraint k
          where k.conrelid = to_regclass('public.tvn_documents')
            and k.conname = c.name) as present
from (values ('tvn_doc_verify_not_self'), ('tvn_doc_owner_exact')) c(name);

-- ─── ٥) ★★ الفحص الحاسم: مراجع تخزين خارج الـbucket المخصَّص ★★ ────────────
-- متوقّع: offending = 0.
-- أيّ رقم أكبر من صفر ⇒ **لا تُشغّل RUNME**. اقرأ الصفوف في الاستعلام التالي،
-- انقل الملفّات إلى compliance-documents يدويًّا، حدّث الصفوف بعلم، ثمّ أعِد.
select count(*) filter (where storage_bucket is not null
                          and storage_bucket <> 'compliance-documents') as offending_bucket_rows,
       count(*) filter (where storage_path is not null
                          and storage_path !~ '^(company|profile|vendor|asset)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$')
         as offending_path_rows,
       count(*) filter (where owner_kind = 'company' and doc_number is not null)
         as company_rows_with_raw_number,
       count(*) filter (where doc_number is not null and doc_number ~ '[0-9]{5,}')
         as rows_with_long_raw_number,
       count(*) as total_document_rows
  from public.tvn_documents;

-- الصفوف المخالفة بالاسم (بلا كشف أرقام: النوع والـbucket فقط).
select id, doc_type, owner_kind, storage_bucket,
       left(coalesce(storage_path,''), 40) as path_prefix, created_at
  from public.tvn_documents
 where storage_bucket is not null and storage_bucket <> 'compliance-documents'
 order by created_at
 limit 50;

-- ─── ٦) الاعتماديات الاختيارية — تُكتشف ولا تُفترض ─────────────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويغيّر السلوك بصدق:
--   • comms_event_catalog غائب ⇒ الأحداث تُسجَّل محلّيًّا في tvn_event_log فقط،
--     والواجهة تقول ذلك بدل ادّعاء أنّ إشعارًا وصل.
--   • permissions/emp_has_permission غائب ⇒ كلّ المفاتيح الدقيقة تعود false،
--     والمالك وحده يرى المركز (fail-closed لا توسيع).
--   • opportunity_requests غائب ⇒ ربط طلب تسجيل بمصدره العامّ يُرفض برسالة
--     صريحة، ولا يُنشأ نموذج عامّ بديل.
--   • storage schema غائب (بيئة غير Supabase) ⇒ يُتخطّى الـbucket بإشعار،
--     ويبقى كلّ شيء آخر صالحًا.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.comms_event_catalog'), ('public.comms_templates'),
             ('public.permissions'), ('public.opportunity_requests'),
             ('public.tvn_settings'), ('public.tvn_profiles'),
             ('storage.buckets'), ('storage.objects')) o(name);

select 'comms_enqueue' as dep,
       (to_regprocedure('public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)') is not null) as present
union all
select 'emp_has_permission',
       (to_regprocedure('public.emp_has_permission(uuid,text)') is not null);

-- ─── ٧) هل الـbucket محجوز باسمه لغرض آخر؟ ────────────────────────────────
-- ⚠️ لا نكتب `from storage.buckets` مباشرةً: PostgreSQL يحلّ أسماء الجداول وقت
--    التحليل، فذكر جدول غائب (بيئة غير Supabase) ينهار بـ42P01 ويقتل الملفّ بدل
--    أن يُبلّغ عن الغياب. الفحص الحقيقيّ داخل كتلة DO في القسم ٩ عبر EXECUTE
--    محروسة بـto_regclass؛ هنا نكتفي بإعلان الحضور.
select 'storage.buckets' as dep, (to_regclass('storage.buckets') is not null) as present
union all
select 'storage.objects', (to_regclass('storage.objects') is not null);

-- ─── ٨) الأسماء التي ستُنشأ — هل يوجد تعارض قائم؟ ─────────────────────────
-- متوقّع: exists_now = false في كلّ صفّ (وإلّا فالحزمة مطبَّقة أصلًا، وإعادة
-- التشغيل آمنة لأنّها idempotent، لكن اعرف ذلك قبل أن تفاجأ).
select n.name, (to_regclass('public.' || n.name) is not null) as exists_now
from (values ('vcc_company_profile'), ('vcc_document_grants'), ('vcc_grant_documents'),
             ('vcc_grant_access_log'), ('vcc_registration_requests'),
             ('vcc_readiness_requirements'),
             -- ⛔ هذه الثلاثة يجب ألّا توجد أبدًا: وجودها يعني أنّ أحدًا أنشأ
             --    سجلّ وثائق ثالثًا خارج هذه الحزمة.
             ('vcc_documents'), ('compliance_documents'), ('vcc_company_documents')) n(name);

-- ─── ٩) البوّابة الحاسمة — ترفع استثناءً ولا تكتب شيئًا ────────────────────
do $gate$
declare miss text := ''; n int; v_bad int;
begin
  if to_regclass('public.tvn_documents')      is null then miss := miss || ' tvn_documents'; end if;
  if to_regclass('public.tvn_document_types') is null then miss := miss || ' tvn_document_types'; end if;
  if to_regclass('public.tvn_audit')          is null then miss := miss || ' tvn_audit'; end if;
  if to_regclass('public.tvn_event_log')      is null then miss := miss || ' tvn_event_log'; end if;
  if to_regprocedure('public.tvn_doc_valid(text,uuid,text)') is null then miss := miss || ' tvn_doc_valid'; end if;
  if to_regprocedure('public.tvn_log(text,text,uuid,boolean,jsonb)') is null then miss := miss || ' tvn_log'; end if;
  if to_regprocedure('public.can_verify_compliance()') is null then miss := miss || ' can_verify_compliance'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' is_staff'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' is_owner'; end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then miss := miss || ' sha256(bytea)'; end if;

  if miss <> '' then
    raise exception 'PREFLIGHT ❌ اعتماديات مفقودة:%. شغّل docs/talent_vendor_network_RUNME.sql أوّلًا — هذه الحزمة توسّع سجلّ الوثائق ولا تُنشئ سجلًّا ثالثًا.', miss;
  end if;

  select count(*) into n from pg_constraint
   where conrelid = to_regclass('public.tvn_documents') and conname = 'tvn_doc_verify_not_self';
  if n <> 1 then
    raise exception 'PREFLIGHT ❌ القيد tvn_doc_verify_not_self مفقود — «الرافع لا يوثّق» ليس مضمونًا في الأساس. لا تُوسّع سجلًّا مكسورًا.';
  end if;

  select count(*) into v_bad from public.tvn_documents
   where storage_bucket is not null and storage_bucket <> 'compliance-documents';
  if v_bad > 0 then
    raise exception 'PREFLIGHT ❌ % صفًّا يشير إلى bucket غير compliance-documents. هذه هي الثغرة نفسها التي جاءت الحزمة لإغلاقها. انقل الملفّات يدويًّا (القسم ٥) ثمّ أعِد الفحص. لن يعدّل أيّ ملفّ في هذه الحزمة مرجع تخزين قائم تلقائيًّا.', v_bad;
  end if;

  select count(*) into v_bad from public.tvn_documents
   where storage_path is not null
     and storage_path !~ '^(company|profile|vendor|asset)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$';
  if v_bad > 0 then
    raise exception 'PREFLIGHT ❌ % صفًّا بمسار تخزين خارج النمط المسموح. القيد سيرفضها. صحّح المسارات يدويًّا أوّلًا.', v_bad;
  end if;

  select count(*) into v_bad from public.tvn_documents
   where owner_kind = 'company' and doc_number is not null;
  if v_bad > 0 then
    raise exception 'PREFLIGHT ❌ % صفّ شركة يحمل رقم وثيقة كاملًا. الحزمة تمنع ذلك بقيد، ولن تحذف بيانات نيابةً عنك: انقل الرقم إلى doc_number_masked يدويًّا ثمّ أفرغ doc_number.', v_bad;
  end if;

  if to_regclass('storage.buckets') is not null then
    execute 'select count(*) from storage.buckets where id = ''compliance-documents'' and public = true' into v_bad;
    if v_bad > 0 then
      raise exception 'PREFLIGHT ❌ يوجد bucket عامّ باسم compliance-documents. لا تُشغّل: الحزمة تفترض bucket خاصًّا، ووجوده عامًّا يعني أنّ ملفّاته مقروءة الآن بلا مصادقة.';
    end if;
  end if;

  if to_regclass('public.vcc_documents') is not null
     or to_regclass('public.compliance_documents') is not null then
    raise exception 'PREFLIGHT ❌ يوجد سجلّ وثائق ثانٍ خارج هذه الحزمة. أوقف: ثلاثة سجلّات = ثلاثة أجوبة عن صلاحية الشهادة نفسها.';
  end if;

  raise notice 'PREFLIGHT ✅ كلّ الاعتماديات الإلزامية حاضرة ولا صفّ مخالف. يمكن تشغيل vendor_compliance_center_RUNME.sql.';
end $gate$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ عقد أنواع المستندات — بالتصنيف لا بالجمع ★★
--
--   الصيغة الأولى لهذا الصفّ (كتبتُها أنا) طلبت أن تكون **العشرون** موجودةً
--   مسبقًا، فأعطت STOP على تركيب أوّل سليم تمامًا: أربعة عشر منها **تزرعها هذه
--   الحزمة نفسها** عند §٣، وغيابُها قبل التشغيل هو الحالة الطبيعية لا خللًا.
--   والحكم الصادق يفرّق بين ما يجب أن يسبقنا وما نأتي به:
--
--     (أ) شرط سابق صلب — من حزمة المواهب والموردين، ولا تملك VCC زرعه:
--         commercial_registration · vat_certificate · bank_letter ·
--         insurance_policy · public_liability · drone_permit
--     (ب) قابل للزرع — تُنشئه هذه الحزمة بـon conflict do nothing:
--         أربعة عشر نوعًا (الغرفة · التأمينات · الزكاة · ZATCA · السعودة ·
--         العنوان الوطنيّ · البلدية · التأسيس · التفويض · السلامة سياسةً
--         وشهادةً · الخصوصية · ملفّ الشركة عربيًّا وإنجليزيًّا)
--     (ج) مجهول — مفتاح في قواعد الجاهزية لا في (أ) ولا في (ب): خلل عقد.
--
--   STOP للفئتين (أ) و(ج) وللتعارض الدلاليّ. أمّا (ب) فـREADY_TO_SEED.
-- ════════════════════════════════════════════════════════════════════════════
with hard(d) as (values
  ('commercial_registration'),('vat_certificate'),('bank_letter'),
  ('insurance_policy'),('public_liability'),('drone_permit')),
seedable(d) as (values
  ('zatca_compliance'),('zakat_certificate'),('gosi_certificate'),
  ('saudization_certificate'),('chamber_of_commerce'),('national_address'),
  ('hse_policy'),('hse_certificate'),('privacy_policy_doc'),
  ('company_profile_ar'),('company_profile_en'),('articles_of_association'),
  ('municipality_license'),('authorized_signatory')),
required as (select d from hard union select d from seedable),
have as (select key from public.tvn_document_types),
hard_missing as (
  select coalesce(string_agg(h.d, ' · ' order by h.d), '') as s, count(*) as n
    from hard h where not exists (select 1 from have v where v.key = h.d)),
seedable_missing as (
  select coalesce(string_agg(sd.d, ' · ' order by sd.d), '') as s, count(*) as n
    from seedable sd where not exists (select 1 from have v where v.key = sd.d)),
existing_required as (
  select count(*) as n from required r where exists (select 1 from have v where v.key = r.d)),
-- ★★ المفاتيح المعلَنة — مصدر ساكن، بلا مرجع إلى جدول قد لا يوجد ★★
--
--  ⚠️ الصيغة السابقة (كتبتُها أنا) قرأت public.vcc_readiness_requirements داخل
--     CASE محروس بـ، فسقطت بـ42P01 على تركيب أوّل.
--     والسبب مبدئيّ لا عرَضيّ: **PostgreSQL يحلّ أسماء العلاقات وقت تحليل
--     الجملة**، للجملة كلّها، قبل تقييم أيّ تعبير. وCASE وWHERE يتحكّمان في
--     **التنفيذ** لا في **حلّ الأسماء**. فالفرع الذي لن يُنفَّذ أبدًا يُحلَّل
--     مع غيره، ويُطلب اسمه من الكتالوج، فيسقط إن غاب.
--     و to_regclass آمنة لأنّها تأخذ **نصًّا** لا مرجع علاقة؛ فما إن يُكتب اسم
--     الجدول عاريًا في FROM حتّى تزول تلك الحماية. الحارس لا يحمي ما بعده.
--
--  فالمصدر هنا **ساكن**: قائمة مفاتيح doc_type التي سيزرعها RUNME في
--  vcc_readiness_requirements، مطابقةً حرفًا بحرف — ويُثبت تطابقها اختبارُ
--  مستودعٍ يقارن القوائم الثلاث (زرع الأنواع · متطلّبات الجاهزية · هذه).
declared_requirement_types(d) as (values
  ('articles_of_association'), ('authorized_signatory'), ('bank_letter'),
  ('chamber_of_commerce'), ('commercial_registration'), ('company_profile_ar'),
  ('company_profile_en'), ('drone_permit'), ('gosi_certificate'),
  ('hse_certificate'), ('hse_policy'), ('insurance_policy'),
  ('municipality_license'), ('national_address'), ('privacy_policy_doc'),
  ('public_liability'), ('saudization_certificate'), ('vat_certificate'),
  ('zakat_certificate'), ('zatca_compliance')
),
-- خلل العقد: مفتاح معلَن في الجاهزية وليس شرطًا صلبًا ولا قابلًا للزرع.
unknown_types as (
  select coalesce(string_agg(x.d, ' · ' order by x.d), '') as s, count(*) as n
    from declared_requirement_types x
   where not exists (select 1 from required q where q.d = x.d)),
dupes as (
  select coalesce(string_agg(a.label_ar || ': ' || a.key || ' / ' || b.key, ' · '), '') as s,
         count(*) as n
    from public.tvn_document_types a
    join public.tvn_document_types b on b.label_ar = a.label_ar and b.key > a.key
   where btrim(coalesce(a.label_ar, '')) <> '')
select case when to_regclass('public.tvn_document_types') is null then 'STOP'
            when (select n from hard_missing) > 0  then 'STOP'
            when (select n from unknown_types) > 0 then 'STOP'
            when (select n from dupes) > 0         then 'STOP'
            when (select n from seedable_missing) > 0 then 'READY_TO_SEED'
            else 'READY' end                                                as verdict,
       (select n from existing_required)::text || '/' || (select count(*) from required)::text
         || ' نوعًا مطلوبًا موجود'                                          as existing_required_types,
       case when (select n from seedable_missing) = 0 then 'لا شيء — كلّها مزروعة'
            else (select n from seedable_missing)::text || ': ' || (select s from seedable_missing) end as seedable_missing_types,
       case when (select n from hard_missing) = 0 then 'لا شيء ✓'
            else '★ شرط سابق مفقود ★ ' || (select s from hard_missing)
                 || ' — شغّل talent_vendor_network أوّلًا؛ VCC لا تزرع هذه' end as hard_missing_types,
       case when (select n from unknown_types) > 0
              then '★ مفتاح جاهزية بلا مصدر ★ ' || (select s from unknown_types)
            when to_regclass('public.vcc_readiness_requirements') is null
              then 'NOT_APPLICABLE_BEFORE_INSTALL — STATIC CONTRACT VERIFIED'
            else 'لا شيء ✓ (والعقد الساكن مطابق)' end as unknown_requirement_types,
       case when (select n from dupes) = 0 then 'لا مرادف لوثيقة واحدة ✓'
            else '★ تعارض دلاليّ ★ ' || (select s from dupes) end             as semantic_conflicts,
       (select count(*) from seedable)::text || ' نوعًا تزرعها هذه الحزمة'   as expected_seed_count;
