-- ════════════════════════════════════════════════════════════════════════════
-- docs/vendor_compliance_center_RUNME.sql
-- المراحل ٢–٥ — مركز المورّد والامتثال (وثائق الشركة · المنح الآمنة · طلبات
-- التسجيل كمورّد · جاهزية الامتثال).
--
-- معاملة واحدة · idempotent · لا CONCURRENTLY · لا anon · SECURITY DEFINER مع
-- search_path مثبَّت · كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا.
--
-- ═══ ★ قرار «أعِد الاستخدام» مقابل «أنشئ» — يُقرأ قبل أيّ شيء ★ ═════════════
--
-- ▸ أُعيد استخدامه ولم يُكرَّر (سجلّ وثائق واحد لا ثلاثة):
--   • public.tvn_documents — **سجلّ الوثائق الوحيد**. هذه الحزمة **توسّعه**
--     ولا تُنشئ سجلًّا ثالثًا. الوثيقة المملوكة للشركة صفّ فيه بـowner_kind
--     = 'company'. لو أنشأنا vcc_documents لصار سؤال «هل هذه الشهادة سارية؟»
--     ثلاثة أجوبة (tvn_documents · hr_employee_documents · الجديد)، والثالث
--     يكفي ليجعل الاثنين الأوّلين غير جديرين بالثقة.
--   • public.tvn_document_types — كتالوج الأنواع. الأنواع الجديدة (GOSI،
--     زكاة/ZATCA، نطاقات، العنوان الوطنيّ، الغرفة، HSE، الخصوصية، ملفّ الشركة
--     عربيّ/إنجليزيّ…) **صفوف بيانات** لا جداول.
--   • public.tvn_doc_valid(text,uuid,text) — **التعريف الوحيد لكلمة «صالحة»**
--     (موثَّقة **و** غير منتهية). محرّك الجاهزية هنا ينادِيها ولا يعيد كتابتها؛
--     تعريف ثانٍ للصلاحية يعني تقريرين متناقضين عن الشركة نفسها.
--   • public.tvn_document_alerts(boolean) و tvn_missing_required_docs(uuid) —
--     تبقى كما هي لملفّات الشبكة. الشركة لها متطلّباتها الصريحة في
--     vcc_readiness_requirements، ومع ذلك تُقاس بنفس tvn_doc_valid.
--   • public.tvn_audit + tvn_log(...) — **مسار تدقيق واحد**. لم يُنشأ جدول
--     تدقيق ثانٍ: كلّ كتابة حسّاسة هنا تُسجَّل هناك.
--   • public.tvn_event_log + مركز الاتصالات comms_* — طابور أحداث واحد. لا
--     طابور بريد جديد، ولا لمس لـcomms_channels، ولا تمرير dry_run.
--   • public.can_verify_compliance() — **تُركَّب** داخل
--     can_verify_compliance_documents() ولا تُستبدل: من يوثّق وثائق الشبكة
--     اليوم يبقى قادرًا، ومفتاح الشركة يُضاف فوقه.
--   • public.permissions / emp_has_permission — كتالوج الصلاحيات المشترك.
--   • public.opportunity_requests — يُشار إليه كمصدر اختياريّ **للقراءة فقط**
--     لطلب تسجيل نشأ من النموذج العامّ. لا مُشغِّل عليه، ولا نسخ تلقائيّ، ولا
--     نموذج عامّ ثانٍ، ولا بريد.
--
-- ▸ أُنشئ لأنّه بلا مكان في المستودع كلّه (٣١٩ جدولًا، لا مقابل لأيّ منها):
--   • vcc_company_profile / _contacts / _certifications / _references /
--     _industry_experience / _drone_capability — ملفّ الشركة نفسه. لا
--     company_profile ولا site_settings موجود.
--   • vcc_document_grants / _grant_documents / _grant_access_log — **لا يوجد
--     في النظام كلّه أيّ جدول رموز أو روابط مشاركة**. النموذج منسوخ عن
--     client_project_access (starts_at/expires_at/revoked_at/granted_by).
--   • vcc_registration_requests / _checklist / _comments / _attachments —
--     ⚠️ هذا **صادر** لا وارد: كيان يطلب تسجيل «كيان ميديا» مورّدًا لديه،
--     فنُعدّ الوثائق ونُسلّمها يدويًّا. سطح /opportunities **وارد**: أفراد
--     ومورّدون يتقدّمون إلينا. الاثنان ليسا الشيء نفسه، ولذلك لم يُبنَ نموذج
--     عامّ ثانٍ: مصدر الطلب قد يكون صفًّا في opportunity_requests ويُشار إليه.
--   • vcc_readiness_requirements — قواعد الجاهزية **بيانات صريحة قابلة
--     للقراءة**، لا شيفرة مخفيّة ولا نموذج.
--   • bucket واحد جديد: compliance-documents (خاصّ).
--
-- ⛔ ما لم يُنشأ عمدًا: لا سجلّ وثائق ثالث · لا جدول تدقيق ثانٍ · لا طابور
--    إشعارات ثانٍ · لا نموذج تسجيل عامّ ثانٍ · لا bucket عامّ · ولا صلاحية anon.
--
-- ═══ ★ الثغرة التي أغلقتها هذه الحزمة بنيويًّا ★ ════════════════════════════
--   tvn_documents.storage_bucket/storage_path كانا نصًّا حرًّا غير مقيَّد،
--   وtvn_document_upsert ينسخهما من p_input كما هما. أيّ حامل
--   can_manage_talent_profiles() كان يستطيع كتابة «وثيقة امتثال» تشير إلى
--   rental-private-documents/… أو project-deliverables/…، ولحظةَ توقّع أيّ
--   شاشة امتثال ذلك المسار بمفتاح الخدمة يصير الصفّ **أوراكل قراءة عابرًا
--   لكلّ الـbuckets**. هنا:
--     (أ) storage_bucket مقيَّد بـCHECK إلى compliance-documents وحده،
--     (ب) storage_path مقيَّد بنمط `{owner_kind}/{uuid}/{ملفّ}` ويمنع `..`،
--     (ج) القراءة الداخلية تُوقَّع **بهوية المستخدم** تحت سياسة تخزين، لا
--         بمفتاح الخدمة،
--     (د) المسار الوحيد الذي يستعمل مفتاح الخدمة (استرداد منحة خارجية) يوثّق
--         **أوّلًا** عبر vcc_grant_open ثمّ يوقّع ما أعادته الدالّة — لا ما
--         أرسله المتصل. هذا شكل deliverable-download حرفيًّا.
--
-- ═══ ★ الرفع ليس توثيقًا ★ ═════════════════════════════════════════════════
--   القيد الجدوليّ tvn_doc_verify_not_self قائم منذ حزمة الشبكة: الموثِّق ≠
--   الرافع. أضفنا فوقه ثمانِ حالات صريحة، وقيدًا يجعل verified = true مستحيلًا
--   إلّا مع doc_status = 'verified'. الأرشفة والإلغاء **تُنزل verified إلى
--   false**، فلا تبقى وثيقة ملغاة «صالحة» في عين tvn_doc_valid.
--
-- ═══ ★ لا شيء يُرسَل ★ ════════════════════════════════════════════════════
--   الأحداث تُدرَج في مركز الاتصالات وحده، وقنواته كلّها dry_run = true. هذا
--   الملفّ لا يذكر comms_channel_set ولا يمرّر dry_run في أيّ موضع. رابط المنحة
--   **لا يُرسَل بالبريد**: حالته «جاهز للمشاركة اليدوية» ويُنسخ بيد موظّف مخوّل.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT صلب: يوقف التشغيل قبل كتابة حرف واحد ────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('auth.users') is null then miss := miss || ' auth.users'; end if;

  -- سجلّ الوثائق القائم هو الأساس كلّه. غيابه ليس «ميزة معطّلة» بل يعني أنّ
  -- التوسعة ستُنشئ سجلًّا ثانيًا بلا قصد — وهذا بالضبط ما نمنعه.
  if to_regclass('public.tvn_documents')      is null then miss := miss || ' public.tvn_documents'; end if;
  if to_regclass('public.tvn_document_types') is null then miss := miss || ' public.tvn_document_types'; end if;
  if to_regclass('public.tvn_audit')          is null then miss := miss || ' public.tvn_audit'; end if;
  if to_regclass('public.tvn_event_log')      is null then miss := miss || ' public.tvn_event_log'; end if;

  if to_regprocedure('public.tvn_doc_valid(text,uuid,text)') is null
    then miss := miss || ' public.tvn_doc_valid(text,uuid,text)'; end if;
  if to_regprocedure('public.tvn_log(text,text,uuid,boolean,jsonb)') is null
    then miss := miss || ' public.tvn_log(...)'; end if;
  if to_regprocedure('public.can_verify_compliance()') is null
    then miss := miss || ' public.can_verify_compliance()'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' public.is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' public.is_owner()'; end if;

  -- نوع الإرجاع يُفحَص أيضًا: بوّابة تعيد غير boolean تُنتج سياسات معناها
  -- «غير محدَّد»، وغير المحدَّد ليس منعًا.
  if to_regprocedure('public.can_verify_compliance()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.can_verify_compliance()'))
  then miss := miss || ' can_verify_compliance()=غير-boolean'; end if;
  if to_regprocedure('public.tvn_doc_valid(text,uuid,text)') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.tvn_doc_valid(text,uuid,text)'))
  then miss := miss || ' tvn_doc_valid()=غير-boolean'; end if;

  -- sha256(bytea) نواةُ PostgreSQL منذ ١١، ورمز المنحة يُخزَّن **بصمةً فقط**.
  -- غيابها يعني أنّنا سنضطرّ لتخزين رمز خام، وهذا لا يحدث.
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then miss := miss || ' sha256(bytea)'; end if;

  if miss <> '' then
    raise exception 'VENDOR COMPLIANCE PREFLIGHT FAILED — اعتماديات مفقودة أو بنوع خاطئ:%. شغّل docs/vendor_compliance_center_PREFLIGHT.sql واقرأ عمود verdict قبل المحاولة ثانيةً. لا تُشغّل هذا الملفّ جزئيًّا.', miss;
  end if;
end $pre$;

-- ⚠️ فحص ما قبل التقييد: لو وُجد صفّ وثيقة يشير إلى bucket آخر، فتثبيت القيد
--    سيفشل. نفشل **بوضوح وباسم الصفوف** بدل أن نُسقط الترحيلة برسالة غامضة،
--    وبدل أن «نصلح» البيانات صامتين (تعديل صامت لمرجع تخزين = إخفاء دليل).
do $pin$
declare n int;
begin
  select count(*) into n from public.tvn_documents
   where storage_bucket is not null and storage_bucket <> 'compliance-documents';
  if n > 0 then
    raise exception 'VENDOR COMPLIANCE PREFLIGHT FAILED — % صفًّا في tvn_documents يشير إلى bucket غير compliance-documents. هذه هي الثغرة التي جاءت الحزمة لإغلاقها، ولن نعدّل مرجع تخزين قائم تلقائيًّا. راجع القسم ٥ من PREFLIGHT، وانقل الملفّات يدويًّا، ثمّ أعِد التشغيل.', n;
  end if;
end $pin$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) الإعدادات والمساعدات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.vcc_settings (
  id                          boolean primary key default true check (id),
  -- ★ نوافذ التنبيه ليست رقمًا ثانيًا ★ تُقرأ من tvn_settings.doc_reminder_days
  --   إن وُجد، وهذا الحقل احتياط صريح لا مصدر منافس.
  fallback_reminder_days      int[]   not null default '{90,60,30,7}',
  grant_default_ttl_days      int     not null default 7  check (grant_default_ttl_days between 1 and 90),
  grant_max_ttl_days          int     not null default 30 check (grant_max_ttl_days between 1 and 180),
  grant_default_max_opens     int     not null default 10 check (grant_default_max_opens between 1 and 500),
  grant_default_max_downloads int     not null default 3  check (grant_default_max_downloads between 0 and 100),
  -- ★ لا يُخفَّض إلى false من الواجهة ★ الدالّة لا تقبل تعديله إلّا من المالك.
  require_request_for_sensitive boolean not null default true,
  readiness_warning_days      int     not null default 30 check (readiness_warning_days between 1 and 180),
  updated_by                  uuid references auth.users(id),
  updated_at                  timestamptz not null default now()
);
insert into public.vcc_settings(id) values (true) on conflict (id) do nothing;

-- قارئ نوافذ التنبيه — مصدر واحد مع احتياط صريح.
create or replace function public.vcc_reminder_days() returns int[]
language plpgsql stable security definer set search_path = public as $fn$
declare v int[];
begin
  if to_regclass('public.tvn_settings') is not null then
    begin
      execute 'select doc_reminder_days from public.tvn_settings where id' into v;
    exception when others then v := null; end;
  end if;
  if v is null or cardinality(v) = 0 then
    select fallback_reminder_days into v from public.vcc_settings where id;
  end if;
  return coalesce(v, '{90,60,30,7}');
exception when others then return '{90,60,30,7}';
end $fn$;

-- مساعدات jsonb محلّية (نظيرة tvn_txt وأخواتها، ولا تُنادى من خارج الحزمة).
create or replace function public.vcc_txt(p jsonb, k text) returns text
language sql immutable set search_path = public as $fn$
  select nullif(btrim(coalesce(p ->> k, '')), '')
$fn$;

create or replace function public.vcc_int(p jsonb, k text) returns int
language plpgsql immutable set search_path = public as $fn$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::int;
exception when others then return null;
end $fn$;

create or replace function public.vcc_bool(p jsonb, k text, p_default boolean default false)
returns boolean language plpgsql immutable set search_path = public as $fn$
declare v text;
begin
  v := lower(nullif(btrim(coalesce(p ->> k, '')), ''));
  if v is null then return coalesce(p_default, false); end if;
  return coalesce(v in ('true','t','1','yes','y'), false);
end $fn$;

create or replace function public.vcc_arr(p jsonb, k text) returns text[]
language plpgsql immutable set search_path = public as $fn$
declare out_a text[] := '{}'; e text;
begin
  if p is null or p -> k is null or jsonb_typeof(p -> k) <> 'array' then return '{}'; end if;
  for e in select jsonb_array_elements_text(p -> k) loop
    e := btrim(coalesce(e, ''));
    if e <> '' and not (out_a @> array[e]) then out_a := out_a || e; end if;
  end loop;
  return out_a;
end $fn$;

-- ★ التدقيق ★ لا جدول ثانٍ: كلّ شيء إلى tvn_audit عبر tvn_log.
-- ⚠️ tvn_log يبتلع استثناءه بنفسه؛ نلفّه هنا كي لا يُسقط غيابُه عمليةً شرعية،
--    لكنّنا **لا نستبدله بلا شيء**: البديل هو أنّ الفعل الحسّاس يمرّ بلا أثر.
create or replace function public.vcc_log(
  p_action text, p_entity_type text, p_entity_id uuid,
  p_allowed boolean default true, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if to_regprocedure('public.tvn_log(text,text,uuid,boolean,jsonb)') is null then return; end if;
  execute 'select public.tvn_log($1,$2,$3,$4,$5)'
    using 'compliance.' || coalesce(p_action, 'unknown'), p_entity_type, p_entity_id,
          coalesce(p_allowed, true), coalesce(p_detail, '{}'::jsonb);
exception when others then null;
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) المُسنَدات — بالأسماء المتّفق عليها حرفيًّا. كلّها fail-closed.
-- ⛔ لا يُبنى أيّ منها على can_manage_projects() ولا على is_kian_member().
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then return false;
end $fn$;

create or replace function public.vcc_is_staff() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_staff(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $fn$;

create or replace function public.vcc_is_owner() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $fn$;

-- (١) رؤية المركز — موظّف + مفتاح صريح. العميل خارج المركز كلّه.
create or replace function public.can_view_compliance_center() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(
    public.vcc_is_owner()
    or (public.vcc_is_staff()
        and (public.vcc_perm('compliance.view')
             or public.vcc_perm('compliance.manage_documents')
             or public.vcc_perm('compliance.verify_documents')
             or public.vcc_perm('compliance.issue_grants')
             or public.vcc_perm('compliance.manage_registration'))),
    false);
exception when others then return false;
end $fn$;

-- (٢) إدارة وثائق الامتثال — الرفع والتحرير. ⛔ لا توثيق من هنا.
create or replace function public.can_manage_compliance_documents() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.vcc_is_owner()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.manage_documents')), false);
exception when others then return false;
end $fn$;

-- (٣) التوثيق — ★ فعل منفصل بفاعل آخر ★ ويُركَّب فوق بوّابة الشبكة القائمة
--     بدل أن يستبدلها: من يوثّق وثائق المورّدين اليوم يبقى قادرًا.
create or replace function public.can_verify_compliance_documents() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v_legacy boolean := false;
begin
  begin
    execute 'select coalesce(public.can_verify_compliance(), false)' into v_legacy;
  exception when others then v_legacy := false; end;
  return coalesce(
    public.vcc_is_owner()
    or (public.vcc_is_staff()
        and (public.vcc_perm('compliance.verify_documents') or coalesce(v_legacy, false))),
    false);
exception when others then return false;
end $fn$;

-- (٤) إصدار المنح الآمنة — أضيق من إدارة الوثائق، ومفتاح مستقلّ.
create or replace function public.can_issue_secure_document_grants() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.vcc_is_owner()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.issue_grants')), false);
exception when others then return false;
end $fn$;

-- (٥) رؤية الوثائق المقيَّدة (البنك · الهوية · العقود) — أضيق مُسنَد في الحزمة.
--     ⛔ لا يفتحه دور عامّ، ولا يُشتقّ من «رؤية المركز».
create or replace function public.can_view_restricted_company_documents() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.vcc_is_owner()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.view_restricted')), false);
exception when others then return false;
end $fn$;

-- (٦) إدارة طلبات التسجيل كمورّد.
create or replace function public.can_manage_vendor_registration() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.vcc_is_owner()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.manage_registration')), false);
exception when others then return false;
end $fn$;

-- ── مُسنَدان أضيق، مضافان فوق الستّة المطلوبة (وليسا بديلًا عنها) ──────────
-- ★ المبيعات ترى **حالة الطلب فقط** ★ لا وثيقة ولا بنك ولا مرفق. التضييق
--   بنيويّ: هذا المُسنَد لا يفتح RLS على أيّ جدول، بل يُقرأ داخل دالّة قراءة
--   واحدة تعيد خمسة حقول محدَّدة. سياسة صفّية «عمياء عن الأعمدة» كانت ستُسرّب
--   المرجع والملاحظات الداخلية.
create or replace function public.vcc_can_view_request_status() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.can_manage_vendor_registration()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.view_request_status')), false);
exception when others then return false;
end $fn$;

-- ★ العمليات ترى وثائق السلامة والتصاريح المصرّح بها فقط ★ لا بنك ولا عقود.
--   البوّابة وحدها لا تكفي: دالّة القراءة تُصفّي بالنوع أيضًا (القسم ٨).
create or replace function public.vcc_can_view_operational_documents() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  return coalesce(public.can_view_compliance_center()
                  or (public.vcc_is_staff() and public.vcc_perm('compliance.view_operational_documents')), false);
exception when others then return false;
end $fn$;

-- مفاتيح الصلاحيات في الكتالوج المشترك — إن وُجد. ⛔ لا منح ضمنيّ من هنا:
-- التسجيل يُعرّف المفتاح ولا يمنحه لأحد.
do $perm$
begin
  if to_regclass('public.permissions') is null then return; end if;
  execute $ins$
    insert into public.permissions(key, label_ar, label_en, category, sensitivity, enabled) values
      ('compliance.view','عرض مركز الامتثال','View compliance center','compliance','normal',true),
      ('compliance.manage_documents','إدارة وثائق الامتثال','Manage compliance documents','compliance','normal',true),
      ('compliance.verify_documents','توثيق وثائق الامتثال','Verify compliance documents','compliance','sensitive',true),
      ('compliance.issue_grants','إصدار منح وصول آمنة','Issue secure document grants','compliance','sensitive',true),
      ('compliance.view_restricted','عرض الوثائق المقيَّدة','View restricted company documents','compliance','sensitive',true),
      ('compliance.manage_registration','إدارة طلبات التسجيل كمورّد','Manage vendor registration','compliance','normal',true),
      ('compliance.view_request_status','عرض حالة طلبات التسجيل فقط','View registration status only','compliance','normal',true),
      ('compliance.view_operational_documents','عرض وثائق السلامة والتصاريح','View HSE and permit documents','compliance','normal',true)
    on conflict (key) do nothing
  $ins$;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) توسعة سجلّ الوثائق القائم — ★ إضافيّة بالكامل، ولا سجلّ ثالث ★
-- ════════════════════════════════════════════════════════════════════════════

-- ٣.١ الكتالوج: عمود واحد إضافيّ يقول «هذا النوع لا يُنشر علنًا أبدًا».
alter table public.tvn_document_types
  add column if not exists never_public boolean not null default false;
comment on column public.tvn_document_types.never_public is
  'خطاب المصرف · بيانات الحساب · وثائق الهوية · العقود · التواقيع = لا تُنشر علنًا أبدًا. القيد يمنع رفع الحساسية إلى public بنيويًّا.';

update public.tvn_document_types
   set never_public = true
 where key in ('national_id','iqama','passport','driving_license','bank_letter',
               'contract','nda','commercial_registration','authorized_signatory')
   and never_public = false;

-- الأنواع الجديدة **صفوف بيانات** لا جداول. applies_to = '{company}' كي لا
-- تتسرّب إلى tvn_missing_required_docs (تلك تقرأ tvn_profiles وحدها).
insert into public.tvn_document_types
  (key, label_ar, label_en, applies_to, is_required, requires_expiry, is_identity, is_financial, never_public) values
  ('company_profile_ar','ملفّ الشركة (عربيّ)','Company profile (Arabic)','{company}', true,  false, false, false, false),
  ('company_profile_en','ملفّ الشركة (إنجليزيّ)','Company profile (English)','{company}', true, false, false, false, false),
  ('national_address','العنوان الوطنيّ','National address','{company}',            true,  true,  false, false, false),
  ('chamber_of_commerce','شهادة الغرفة التجارية','Chamber of commerce','{company}', true,  true,  false, false, false),
  ('gosi_certificate','شهادة التأمينات الاجتماعية','GOSI certificate','{company}',  true,  true,  false, true,  false),
  ('zakat_certificate','شهادة الزكاة','Zakat certificate','{company}',              true,  true,  false, true,  false),
  ('zatca_compliance','شهادة الامتثال الضريبيّ (ZATCA)','ZATCA compliance','{company}', true, true, false, true, false),
  ('saudization_certificate','شهادة السعودة (نطاقات)','Saudization (Nitaqat)','{company}', true, true, false, false, false),
  ('municipality_license','رخصة البلدية','Municipality license','{company}',        false, true,  false, false, false),
  ('articles_of_association','عقد التأسيس','Articles of association','{company}',   false, false, false, false, true),
  ('authorized_signatory','تفويض التوقيع','Authorized signatory','{company}',       false, true,  true,  false, true),
  ('hse_policy','سياسة الصحّة والسلامة','HSE policy','{company}',                   true,  false, false, false, false),
  ('hse_certificate','شهادة الصحّة والسلامة','HSE certificate','{company}',         false, true,  false, false, false),
  ('privacy_policy_doc','سياسة الخصوصية وحماية البيانات','Privacy policy','{company}', true, false, false, false, false),
  ('drone_operator_license','رخصة مشغّل درون','Drone operator license','{company}', false, true,  false, false, false),
  ('iso_certificate','شهادة أيزو','ISO certificate','{company}',                    false, true,  false, false, false)
on conflict (key) do nothing;

-- الأنواع القائمة المشتركة تُوسَّع لتشمل الشركة بلا مساس بسلوكها للملفّات:
-- applies_to الفارغ يعني «كلّ الأنواع» أصلًا، فلا نلمسه.
update public.tvn_document_types
   set applies_to = applies_to || array['company']
 where key in ('commercial_registration','vat_certificate','bank_letter','insurance_policy',
               'public_liability','safety_certificate','drone_permit','nda','contract')
   and cardinality(applies_to) > 0
   and not (applies_to @> array['company']);

-- ٣.٢ owner_kind يكتسب 'company'. القيد الأصليّ اسمه مولَّد، فنحذفه ديناميكيًّا
--     بدل تخمين اسم: تخمين خاطئ يترك القيد القديم قائمًا فيفشل كلّ إدراج شركة.
do $ok$
declare c record;
begin
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'public.tvn_documents'::regclass
              and con.contype = 'c'
              and con.conname <> 'tvn_doc_owner_exact'
              and pg_get_constraintdef(con.oid) ilike '%owner_kind%'
              and pg_get_constraintdef(con.oid) not ilike '%company%'
  loop
    execute format('alter table public.tvn_documents drop constraint %I', c.conname);
  end loop;
end $ok$;

alter table public.tvn_documents drop constraint if exists tvn_doc_owner_kind_v2;
alter table public.tvn_documents add constraint tvn_doc_owner_kind_v2
  check (owner_kind in ('profile','vendor','asset','company'));

-- المالك واحد بالضبط. 'company' لا يحمل معرّف مالك: ملفّ الشركة صفّ واحد.
alter table public.tvn_documents drop constraint if exists tvn_doc_owner_exact;
alter table public.tvn_documents add constraint tvn_doc_owner_exact check (
  (owner_kind = 'profile' and profile_id is not null and vendor_id is null and asset_id is null) or
  (owner_kind = 'vendor'  and vendor_id  is not null and profile_id is null and asset_id is null) or
  (owner_kind = 'asset'   and asset_id   is not null and profile_id is null and vendor_id is null) or
  (owner_kind = 'company' and profile_id is null and vendor_id is null and asset_id is null));

-- ٣.٣ الأعمدة الإضافية المطلوبة في العقد.
alter table public.tvn_documents
  add column if not exists title              text,
  add column if not exists doc_language       text,
  add column if not exists issuer             text,
  -- ★ الرقم مُقنَّع ★ الرقم الكامل لا يدخل قاعدة البيانات (سابقة iban_last4).
  add column if not exists doc_number_masked  text,
  add column if not exists doc_version        int  not null default 1,
  add column if not exists supersedes_id      uuid references public.tvn_documents(id),
  add column if not exists doc_status         text not null default 'draft',
  add column if not exists sensitivity        text not null default 'internal',
  add column if not exists is_downloadable    boolean not null default false,
  add column if not exists watermark_required boolean not null default true,
  add column if not exists internal_notes     text,
  add column if not exists checksum_sha256    text,
  add column if not exists file_name          text,
  add column if not exists file_mime          text,
  add column if not exists file_bytes         bigint,
  add column if not exists rejected_by  uuid references auth.users(id),
  add column if not exists rejected_at  timestamptz,
  add column if not exists reject_reason text,
  add column if not exists revoked_by   uuid references auth.users(id),
  add column if not exists revoked_at   timestamptz,
  add column if not exists revoke_reason text,
  add column if not exists archived_by  uuid references auth.users(id),
  add column if not exists archived_at  timestamptz,
  add column if not exists status_changed_by uuid references auth.users(id),
  add column if not exists status_changed_at timestamptz;

-- ٣.٤ ردم البيانات **قبل** القيود، وإلّا فشلت الترحيلة على صفوف قائمة.
update public.tvn_documents
   set doc_status = case when verified then 'verified'
                         when storage_path is not null then 'uploaded'
                         else 'draft' end
 where doc_status = 'draft'
   and (verified or storage_path is not null);

update public.tvn_documents
   set sensitivity = 'restricted'
 where restricted = true and sensitivity not in ('confidential','restricted');

-- ٣.٥ القيود البنيوية.
alter table public.tvn_documents drop constraint if exists tvn_doc_status_chk;
alter table public.tvn_documents add constraint tvn_doc_status_chk check (
  doc_status in ('draft','uploaded','pending_verification','verified',
                 'rejected','expired','archived','revoked'));

-- ★ الرفع ليس توثيقًا ★ verified = true مستحيل خارج حالة 'verified'، فالأرشفة
--   والإلغاء والانتهاء تُخرج الوثيقة من دائرة tvn_doc_valid تلقائيًّا.
alter table public.tvn_documents drop constraint if exists tvn_doc_verified_iff_status;
alter table public.tvn_documents add constraint tvn_doc_verified_iff_status
  check (verified = false or doc_status = 'verified');

alter table public.tvn_documents drop constraint if exists tvn_doc_sensitivity_chk;
alter table public.tvn_documents add constraint tvn_doc_sensitivity_chk check (
  sensitivity in ('public','internal','confidential','restricted'));

-- restricted هو ما تقرأه سياسة tvn_docs_read الحيّة. **يبقى**، ولا يُستبدل:
-- المستوى الجديد يُشدّد ولا يُرخي.
alter table public.tvn_documents drop constraint if exists tvn_doc_restricted_alignment;
alter table public.tvn_documents add constraint tvn_doc_restricted_alignment
  check (restricted = false or sensitivity in ('confidential','restricted'));

-- ★ الرقم الكامل ★ لوثائق الشركة لا يُخزَّن إطلاقًا، والمُقنَّع لا يحمل أكثر
--   من أربعة أرقام متتالية. وعدٌ في التوثيق لا يكفي — هذا قيد.
alter table public.tvn_documents drop constraint if exists tvn_doc_company_no_raw_number;
alter table public.tvn_documents add constraint tvn_doc_company_no_raw_number
  check (owner_kind <> 'company' or doc_number is null);

alter table public.tvn_documents drop constraint if exists tvn_doc_masked_number;
alter table public.tvn_documents add constraint tvn_doc_masked_number
  check (doc_number_masked is null or doc_number_masked !~ '[0-9]{5,}');

alter table public.tvn_documents drop constraint if exists tvn_doc_language_chk;
alter table public.tvn_documents add constraint tvn_doc_language_chk
  check (doc_language is null or doc_language in ('ar','en','ar_en','other'));

alter table public.tvn_documents drop constraint if exists tvn_doc_version_chk;
alter table public.tvn_documents add constraint tvn_doc_version_chk check (doc_version >= 1);

alter table public.tvn_documents drop constraint if exists tvn_doc_checksum_chk;
alter table public.tvn_documents add constraint tvn_doc_checksum_chk
  check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$');

-- ★★ إغلاق أوراكل القراءة العابر للـbuckets ★★
--    (أ) الـbucket مثبَّت باسم واحد، (ب) المسار بنمط صارم يمنع `..` والمسار
--    المطلق والامتداد الفارغ. tvn_document_upsert ينسخ الحقلين من p_input بلا
--    فحص — بعد هذين القيدين لم يعد لذلك أثر.
alter table public.tvn_documents drop constraint if exists tvn_doc_bucket_pinned;
alter table public.tvn_documents add constraint tvn_doc_bucket_pinned
  check (storage_bucket is null or storage_bucket = 'compliance-documents');

alter table public.tvn_documents drop constraint if exists tvn_doc_path_shape;
alter table public.tvn_documents add constraint tvn_doc_path_shape check (
  storage_path is null
  or (storage_path ~ '^(company|profile|vendor|asset)/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$'
      and position('..' in storage_path) = 0));

-- مرجع تخزين بلا bucket (أو العكس) = نصف مرجع، ولا يُوقَّع أبدًا.
alter table public.tvn_documents drop constraint if exists tvn_doc_ref_paired;
alter table public.tvn_documents add constraint tvn_doc_ref_paired
  check ((storage_bucket is null) = (storage_path is null));

create index if not exists idx_tvn_docs_company
  on public.tvn_documents(doc_type) where owner_kind = 'company' and is_deleted = false;
create index if not exists idx_tvn_docs_status
  on public.tvn_documents(doc_status) where is_deleted = false;

-- ٣.٦ المُشغِّل الموحِّد — ★ يجعل الدوالّ القائمة تستمرّ بالعمل ★
--     tvn_document_upsert و tvn_document_verify كُتبتا قبل هذه الأعمدة. لو
--     تركنا القيود وحدها لأصبح كلّ نداء قديم يفشل بـ23514 يُقرأ خطأً على أنّه
--     «ترحيلة ناقصة». المُشغِّل يشتقّ الحالة والحساسية من القيم القديمة، فتبقى
--     الدالّتان صحيحتين وتكتسبان السلوك الجديد مجّانًا.
create or replace function public.vcc_document_normalize() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_never boolean := false; v_ident boolean := false; v_fin boolean := false;
begin
  select coalesce(t.never_public,false), coalesce(t.is_identity,false), coalesce(t.is_financial,false)
    into v_never, v_ident, v_fin
    from public.tvn_document_types t where t.key = new.doc_type;

  -- (١) الحساسية تُشدَّد ولا تُرخى.
  if coalesce(v_ident,false) or coalesce(v_fin,false) then
    new.restricted := true;
  end if;
  if new.restricted then
    if new.sensitivity not in ('confidential','restricted') then new.sensitivity := 'restricted'; end if;
  elsif new.sensitivity in ('confidential','restricted') then
    new.restricted := true;
  end if;

  -- (٢) ⛔ ما لا يُنشر علنًا أبدًا: خطاب المصرف · الهوية · العقود · التواقيع.
  if new.sensitivity = 'public' and coalesce(v_never,false) then
    raise exception 'validation: نوع الوثيقة % لا يجوز أن يكون عامًّا إطلاقًا', new.doc_type;
  end if;
  if new.sensitivity = 'public' and (coalesce(v_ident,false) or coalesce(v_fin,false)) then
    raise exception 'validation: وثيقة هوية أو مالية لا تكون عامّة';
  end if;

  -- (٣) الحالة والتوثيق متّسقان دائمًا — بلا اعتماد على المتصل.
  if new.verified then
    new.doc_status := 'verified';
  elsif new.doc_status = 'verified' then
    -- تغيّر المسار أو أُبطل التوثيق ⇒ الملفّ يعود لانتظار التوثيق، لا «موثَّق».
    new.doc_status := 'pending_verification';
  elsif tg_op = 'INSERT' and new.doc_status = 'draft' and new.storage_path is not null then
    new.doc_status := 'uploaded';
  end if;

  -- (٤) المسار يطابق نوع المالك — لا وثيقة شركة تحت مسار ملفّ شخصيّ.
  if new.storage_path is not null and new.storage_path not like new.owner_kind || '/%' then
    raise exception 'validation: مسار التخزين لا يطابق نوع المالك (%)', new.owner_kind;
  end if;

  -- (٥) العلامة المائية إلزامية لكلّ ما هو مقيَّد أو سرّيّ.
  if new.sensitivity in ('confidential','restricted') then
    new.watermark_required := true;
  end if;

  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists trg_vcc_document_normalize on public.tvn_documents;
create trigger trg_vcc_document_normalize
  before insert or update on public.tvn_documents
  for each row execute function public.vcc_document_normalize();

-- ٣.٧ ★★ توسعة التعريف الواحد للصلاحية ★★
--
-- ⚠️ اقرأ هذا قبل أيّ شيء: tvn_doc_valid(p_owner_kind, p_owner_id, p_doc_type)
--    تبدأ بـ`if p_owner_id is null then return false`. ووثيقة الشركة **بلا
--    معرّف مالك** (ملفّ الشركة صفّ واحد). لولا هذه التوسعة لأعادت الدالّة
--    false لكلّ وثيقة شركة مهما كانت موثَّقة وسارية، ولظهر مركز امتثال كامل
--    وهو يقول «لا شيء صالح» — عطل صامت يبدو كنتيجة.
--
-- ★ لماذا نوسّع الدالّة القائمة بدل كتابة vcc_doc_valid ★ لأنّ دالّة صلاحية
--   ثانية = جوابان لسؤال «هل هذه الشهادة سارية؟»، وهو بالضبط ما جاءت الحزمة
--   لتفاديه. الفروع الثلاثة القديمة (profile/vendor/asset) **تبقى حرفيًّا كما
--   هي**، بما فيها الحارس `p_owner_id is null` الذي صار مشروطًا بألّا يكون
--   المالك شركة. لا سلوك قائم يتغيّر: 'company' لم يكن مقبولًا أصلًا.
create or replace function public.tvn_doc_valid(
  p_owner_kind text, p_owner_id uuid, p_doc_type text)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare v boolean;
begin
  if p_doc_type is null then return false; end if;
  -- الفرع الجديد وحده يُعفى من اشتراط المعرّف؛ ما عداه بلا تغيير.
  if p_owner_id is null and coalesce(p_owner_kind,'') <> 'company' then return false; end if;
  select exists (
    select 1 from public.tvn_documents d
     where d.is_deleted = false
       and d.doc_type = p_doc_type
       and d.verified = true
       and (d.expires_on is null or d.expires_on >= current_date)
       and ((p_owner_kind = 'profile' and d.profile_id = p_owner_id)
         or (p_owner_kind = 'vendor'  and d.vendor_id  = p_owner_id)
         or (p_owner_kind = 'asset'   and d.asset_id   = p_owner_id)
         or (p_owner_kind = 'company' and d.owner_kind = 'company'))
  ) into v;
  return coalesce(v, false);
exception when others then return false;
end $fn$;

-- ٣.٨ الحالة الفعّالة — الانتهاء **مشتقّ** ولا يُخزَّن بائتًا.
-- ⚠️ ليست بديلًا عن tvn_doc_valid: تلك تبقى التعريف الوحيد لكلمة «صالحة»،
--    وهذه تعرض السبب للإنسان.
create or replace function public.vcc_doc_effective_status(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare d record;
begin
  select doc_status, verified, expires_on, is_deleted into d
    from public.tvn_documents where id = p_id;
  if not found then return 'not_found'; end if;
  if d.is_deleted then return 'archived'; end if;
  if d.doc_status = 'verified' and d.expires_on is not null and d.expires_on < current_date then
    return 'expired';
  end if;
  return d.doc_status;
exception when others then return 'unknown';
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) ملفّ الشركة وتوابعه — ★ جديد، لا مقابل له في المستودع ★
-- ════════════════════════════════════════════════════════════════════════════

-- ⛔ لا عمود لرقم حساب ولا IBAN هنا **إطلاقًا**. اسم المصرف وصفيّ فقط، وخطاب
--    المصرف وثيقة مقيَّدة في السجلّ. سابقة tvn_profile_bank تُحترم: ما لا يجب
--    أن يُخزَّن لا يُعطى عمودًا يغري بتخزينه.
create table if not exists public.vcc_company_profile (
  id                  boolean primary key default true check (id),
  legal_name_ar       text,
  legal_name_en       text,
  brand_name          text,
  entity_type         text check (entity_type is null or entity_type in
                        ('establishment','llc','closed_joint_stock','joint_stock','branch','other')),
  cr_number_masked    text check (cr_number_masked is null or cr_number_masked !~ '[0-9]{5,}'),
  vat_number_masked   text check (vat_number_masked is null or vat_number_masked !~ '[0-9]{5,}'),
  established_year    int  check (established_year is null or established_year between 1900 and 2100),
  employees_count     int  check (employees_count is null or employees_count >= 0),
  hq_city             text,
  hq_address_ar       text,
  hq_address_en       text,
  national_address_short text,
  website             text,
  general_email       text,
  general_phone       text,
  -- ★ ملفّا الشركة العربيّ والإنجليزيّ ★ النصّ هنا، والـPDF وثيقة في السجلّ.
  about_ar            text,
  about_en            text,
  mission_ar          text,
  mission_en          text,
  sectors             text[] not null default '{}',
  nitaqat_band        text check (nitaqat_band is null or nitaqat_band in
                        ('platinum','high_green','medium_green','low_green','yellow','red','not_applicable')),
  gosi_registered     boolean not null default false,
  zatca_status        text check (zatca_status is null or zatca_status in
                        ('registered','phase1_compliant','phase2_compliant','not_registered','unknown')),
  bank_name           text,   -- وصفيّ فقط. لا رقم حساب.
  profile_completed_at timestamptz,
  updated_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);
insert into public.vcc_company_profile(id) values (true) on conflict (id) do nothing;
comment on table public.vcc_company_profile is
  'ملفّ الشركة — صفّ واحد. ⛔ لا رقم حساب ولا IBAN ولا رقم سجلّ كامل: الأرقام مُقنَّعة بقيد، والوثائق في tvn_documents.';

create table if not exists public.vcc_company_contacts (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (length(btrim(full_name)) > 0),
  role_title    text,
  purpose       text not null check (purpose in
                  ('procurement','finance','operations','legal','hse','general','technical')),
  email         text,
  phone         text,
  is_primary    boolean not null default false,
  language      text check (language is null or language in ('ar','en','ar_en')),
  note          text,
  active        boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_vcc_contacts_purpose on public.vcc_company_contacts(purpose) where active;

create table if not exists public.vcc_certifications (
  id             uuid primary key default gen_random_uuid(),
  cert_name_ar   text not null check (length(btrim(cert_name_ar)) > 0),
  cert_name_en   text,
  issuing_body   text,
  scope_note     text,
  issued_on      date,
  expires_on     date,
  -- الشهادة تُثبَت بوثيقة في السجلّ الواحد، لا بصورة مرفوعة في مكان آخر.
  document_id    uuid references public.tvn_documents(id),
  is_active      boolean not null default true,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists idx_vcc_cert_expiry on public.vcc_certifications(expires_on) where is_active;

-- ★ المرجع سُمعة طرف ثالث ★ لا يُنشر علنًا من هنا: هذه الحزمة داخلية بالكامل،
--   والنشر العامّ (لو حدث) قرار منفصل في حزمة دراسات الحالة بموافقة صريحة.
create table if not exists public.vcc_references (
  id                uuid primary key default gen_random_uuid(),
  client_name       text not null check (length(btrim(client_name)) > 0),
  sector            text,
  scope_ar          text,
  scope_en          text,
  year_from         int check (year_from is null or year_from between 1900 and 2100),
  year_to           int check (year_to is null or year_to between 1900 and 2100),
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  -- ⚠️ إذن الاستشهاد فعل مكتوب وليس افتراضًا.
  permission_to_cite boolean not null default false,
  permission_note   text,
  -- مرجع اختياريّ للقراءة فقط. منصّة المشاريع مجمَّدة: لا مفتاح أجنبيّ، ولا
  -- كتابة، ولا نسخ تلقائيّ لأيّ محتوى مشروع.
  project_id        uuid,
  is_active         boolean not null default true,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (year_to is null or year_from is null or year_to >= year_from),
  check (permission_to_cite = false or length(btrim(coalesce(permission_note,''))) >= 10)
);

create table if not exists public.vcc_industry_experience (
  id             uuid primary key default gen_random_uuid(),
  sector         text not null check (length(btrim(sector)) > 0),
  sector_ar      text,
  years          int check (years is null or years between 0 and 100),
  projects_count int check (projects_count is null or projects_count >= 0),
  highlights_ar  text,
  highlights_en  text,
  is_active      boolean not null default true,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sector)
);

-- ★ قدرة الدرون ★ الرخص والتصاريح **وثائق** في السجلّ الواحد؛ هنا البيانات
--   الوصفية للقدرة نفسها. لا يُعاد تعريف صلاحية التصريح هنا: من يسأل «هل
--   التصريح ساري؟» يسأل tvn_doc_valid.
create table if not exists public.vcc_drone_capability (
  id                    uuid primary key default gen_random_uuid(),
  capability_name       text not null check (length(btrim(capability_name)) > 0),
  operator_entity       text,
  drone_models          text[] not null default '{}',
  registered_units      int check (registered_units is null or registered_units >= 0),
  licensed_pilots       int check (licensed_pilots is null or licensed_pilots >= 0),
  max_altitude_m        int check (max_altitude_m is null or max_altitude_m between 0 and 5000),
  night_operations      boolean not null default false,
  bvlos_approved        boolean not null default false,
  coverage_regions      text[] not null default '{}',
  insurance_document_id uuid references public.tvn_documents(id),
  permit_document_id    uuid references public.tvn_documents(id),
  license_document_id   uuid references public.tvn_documents(id),
  restrictions_note     text,
  is_active             boolean not null default true,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) قواعد الجاهزية — ★ بيانات صريحة قابلة للقراءة، لا ذكاء اصطناعيّ ★
--    كلّ سطر هنا يُقرأ بالعين ويُفسَّر للمالك. لا نموذج، ولا وزن خفيّ، ولا
--    درجة مركّبة يستحيل تفسيرها.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.vcc_readiness_requirements (
  id                uuid primary key default gen_random_uuid(),
  requirement_key   text not null,
  context           text not null default 'general' check (context in
                      ('general','government','tender','client_vendor_registration','media_production')),
  kind              text not null check (kind in ('document','profile_field','capability')),
  doc_type          text references public.tvn_document_types(key),
  profile_field     text,
  label_ar          text not null default '',
  label_en          text not null default '',
  is_mandatory      boolean not null default true,
  required_language text check (required_language is null or required_language in ('ar','en','both')),
  min_version       int not null default 1 check (min_version >= 1),
  active            boolean not null default true,
  note_ar           text,
  created_at        timestamptz not null default now(),
  unique (requirement_key, context),
  -- كلّ نوع متطلَّب يحمل مرجعه الصحيح: متطلَّب وثيقة بلا نوع وثيقة قاعدة
  -- لا تُفحَص أبدًا فتُقرأ «مستوفاة» بالخطأ.
  check ((kind = 'document'      and doc_type is not null and profile_field is null)
      or (kind = 'profile_field' and profile_field is not null and doc_type is null)
      or (kind = 'capability'    and profile_field is not null and doc_type is null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ حارس عقد أنواع المستندات — قبل الإدراج لا بعده ★★
--
--   سقطت الترحيلة هنا بـ23503: doc_type = 'commercial_register' غير موجود في
--   tvn_document_types. والسبب ليس نقص زرع بل **اختلاف مفتاح**: حزمة المواهب
--   والموردين تزرع 'commercial_registration' لنفس الوثيقة حرفيًّا — التسمية
--   العربية في الحزمتين واحدة: «السجلّ التجاريّ». وكذلك 'tax_certificate'
--   مقابل 'vat_certificate' المزروع أصلًا.
--
--   ولم يكن المفتاحان في الإدراج وحده: كانا في جملتَي UPDATE أعلاه (never_public
--   و applies_to) حيث `where key in (…)` لا يطابق شيئًا فيمرّ **بصمت** — فلا
--   السجلّ التجاريّ يُمنع من النشر العامّ، ولا هو ولا الشهادة الضريبية
--   يكتسبان applies_to = company. عطلٌ وظيفيّ لا يُظهره خطأ.
--
--   والعلاج ليس زرع مرادف ثانٍ: سجلّ أنواع المستندات واحد
--   (tvn_document_types)، ومرادفان لوثيقة واحدة يعنيان أنّ نصف الوثائق تُرفع
--   تحت مفتاح ونصفها تحت الآخر، فلا فحص جاهزية يراها كاملة. لذلك تُستعمل
--   المفاتيح القانونية القائمة.
--
--   وهذا الحارس يطبع **كلّ** المفاتيح الناقصة دفعة واحدة، لا أوّلها فقط:
--   السقوط على أوّل مفتاح يُخفي البقية فيتكرّر الدوران.
-- ════════════════════════════════════════════════════════════════════════════
do $doctypes$
declare
  v_missing text := '';
  v_dupes   text := '';
begin
  -- (١) كلّ doc_type مطلوب موجود في السجلّ الواحد.
  select coalesce(string_agg(distinct t.d, ' · ' order by t.d), '') into v_missing
    from (values
      ('commercial_registration'),('vat_certificate'),('zatca_compliance'),('zakat_certificate'),
      ('gosi_certificate'),('saudization_certificate'),('chamber_of_commerce'),('national_address'),
      ('bank_letter'),('insurance_policy'),('hse_policy'),('privacy_policy_doc'),
      ('company_profile_ar'),('company_profile_en'),('drone_permit'),('public_liability'),
      ('hse_certificate'),('articles_of_association'),('municipality_license'),('authorized_signatory')
    ) t(d)
   where not exists (select 1 from public.tvn_document_types dt where dt.key = t.d);
  if v_missing <> '' then
    raise exception 'VCC: أنواع مستندات مطلوبة وغير مزروعة (كلّها دفعةً واحدة): % — أضِفها إلى tvn_document_types أو صحّح المفتاح إلى القائم', v_missing;
  end if;

  -- (٢) ولا مرادف دلاليّ لوثيقة واحدة: مفتاحان بالتسمية العربية نفسها يعنيان
  --     سجلًّا مشقوقًا — ترفع الشركة تحت أحدهما فتبقى «ناقصة» تحت الآخر.
  select coalesce(string_agg(x.pair, ' · '), '') into v_dupes
    from (select a.label_ar || ': ' || a.key || ' / ' || b.key as pair
            from public.tvn_document_types a
            join public.tvn_document_types b
              on b.label_ar = a.label_ar and b.key > a.key
           where btrim(coalesce(a.label_ar, '')) <> '') x;
  if v_dupes <> '' then
    raise exception 'VCC: مرادفان لوثيقة واحدة في سجلّ الأنواع: % — سجلّ الوثائق واحد، والمرادف يشقّ الجاهزية نصفين', v_dupes;
  end if;
end $doctypes$;

insert into public.vcc_readiness_requirements
  (requirement_key, context, kind, doc_type, profile_field, label_ar, label_en, is_mandatory, required_language, note_ar) values
  ('commercial_register','general','document','commercial_registration',null,'السجلّ التجاريّ','Commercial register',true,null,'أساس أيّ تسجيل مورّد.'),
  ('tax_certificate','general','document','vat_certificate',null,'الشهادة الضريبية','Tax certificate',true,null,null),
  ('zatca_compliance','general','document','zatca_compliance',null,'الامتثال الضريبيّ','ZATCA compliance',true,null,null),
  ('zakat_certificate','general','document','zakat_certificate',null,'شهادة الزكاة','Zakat certificate',true,null,null),
  ('gosi_certificate','general','document','gosi_certificate',null,'شهادة التأمينات','GOSI certificate',true,null,null),
  ('saudization','general','document','saudization_certificate',null,'شهادة السعودة','Saudization',true,null,'نطاقات.'),
  ('chamber','general','document','chamber_of_commerce',null,'شهادة الغرفة','Chamber of commerce',true,null,null),
  ('national_address','general','document','national_address',null,'العنوان الوطنيّ','National address',true,null,null),
  ('bank_letter','general','document','bank_letter',null,'خطاب المصرف','Bank letter',true,null,'⛔ مقيَّد. لا يُنشر ولا يُشارَك إلّا بمنحة معتمَدة.'),
  ('insurance','general','document','insurance_policy',null,'وثيقة التأمين','Insurance policy',true,null,null),
  ('hse_policy','general','document','hse_policy',null,'سياسة السلامة','HSE policy',true,null,null),
  ('privacy_policy','general','document','privacy_policy_doc',null,'سياسة الخصوصية','Privacy policy',true,null,null),
  ('company_profile_ar','general','document','company_profile_ar',null,'ملفّ الشركة عربيّ','Company profile AR',true,'ar',null),
  ('company_profile_en','general','document','company_profile_en',null,'ملفّ الشركة إنجليزيّ','Company profile EN',false,'en',null),
  ('legal_name','general','profile_field',null,'legal_name_ar','الاسم النظاميّ','Legal name',true,null,null),
  ('cr_number','general','profile_field',null,'cr_number_masked','رقم السجلّ (مُقنَّع)','CR number (masked)',true,null,null),
  ('vat_number','general','profile_field',null,'vat_number_masked','الرقم الضريبيّ (مُقنَّع)','VAT number (masked)',true,null,null),
  ('national_address_field','general','profile_field',null,'national_address_short','العنوان الوطنيّ المختصر','National address',true,null,null),
  ('hq_city','general','profile_field',null,'hq_city','مدينة المقرّ','HQ city',true,null,null),
  ('about_ar','general','profile_field',null,'about_ar','نبذة عربية','About (AR)',true,null,null),
  ('about_en','general','profile_field',null,'about_en','نبذة إنجليزية','About (EN)',false,null,null),
  ('procurement_contact','general','profile_field',null,'contact_procurement','مسؤول المشتريات','Procurement contact',true,null,'يُحتسب من vcc_company_contacts.'),
  ('drone_permit','media_production','document','drone_permit',null,'تصريح الدرون','Drone permit',false,null,'إلزاميّ فقط لمن يطلب أعمال تصوير جوّيّ.'),
  ('public_liability','media_production','document','public_liability',null,'تأمين المسؤولية العامّة','Public liability',true,null,null),
  ('hse_certificate','media_production','document','hse_certificate',null,'شهادة السلامة','HSE certificate',false,null,null),
  ('articles','government','document','articles_of_association',null,'عقد التأسيس','Articles of association',false,null,null),
  ('municipality','government','document','municipality_license',null,'رخصة البلدية','Municipality license',false,null,null),
  ('signatory','government','document','authorized_signatory',null,'تفويض التوقيع','Authorized signatory',false,null,'⛔ مقيَّد.')
on conflict (requirement_key, context) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) طلبات التسجيل كمورّد — ★ صادر لا وارد ★
--    كيان يطلب تسجيلنا مورّدًا لديه ⇒ نُعدّ الوثائق ونُسلّمها **يدويًّا**.
--    سطح /opportunities وارد (يتقدّمون إلينا) ولم يُمسّ ولم يُستنسخ.
-- ════════════════════════════════════════════════════════════════════════════
create sequence if not exists public.vcc_registration_seq;

create table if not exists public.vcc_registration_requests (
  id                 uuid primary key default gen_random_uuid(),
  request_number     text unique,
  organization_name  text not null check (length(btrim(organization_name)) > 0),
  organization_sector text,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  purpose            text not null check (length(btrim(purpose)) >= 10),
  required_doc_types text[] not null default '{}',
  deadline           date,
  -- مرجع بوّابة المشتريات: رقم/رابط لدى الطرف الآخر. ليس دليل تقديم.
  portal_reference   text,
  portal_name        text,
  notes              text,
  source             text not null default 'client_request' check (source in
                       ('client_request','tender_portal','email','phone','opportunity_form','referral','other')),
  -- مرجع اختياريّ **للقراءة فقط** إلى سطح الفرص العامّ. لا مفتاح أجنبيّ (قد
  -- يكون الجدول غير مثبَّت)، ولا قراءة تلقائية، ولا نسخ.
  source_opportunity_request_id uuid,
  assigned_to        uuid references auth.users(id),
  priority           text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  readiness_context  text not null default 'client_vendor_registration',
  status             text not null default 'received' check (status in
                       ('received','under_review','information_required','preparing_documents',
                        'pending_owner_approval','ready_for_manual_submission','submitted_manually',
                        'accepted','rejected','expired','closed')),
  info_required_note text,
  owner_approved_by  uuid references auth.users(id),
  owner_approved_at  timestamptz,
  owner_approval_note text,
  -- ★★ لا ادّعاء تقديم إلكترونيّ ★★ الحقول الثلاثة إلزامية معًا في حالة
  --    submitted_manually، ولا مسار في هذا الملفّ يملؤها تلقائيًّا.
  submitted_by       uuid references auth.users(id),
  submitted_at       timestamptz,
  submission_reference text,
  submission_channel text check (submission_channel is null or submission_channel in
                       ('supplier_portal','email','courier','in_person','other')),
  decision_note      text,
  closed_by          uuid references auth.users(id),
  closed_at          timestamptz,
  close_reason       text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  is_deleted         boolean not null default false,
  deleted_at timestamptz, deleted_by uuid references auth.users(id), delete_reason text,

  constraint vcc_reg_manual_submission_proof check (
    status <> 'submitted_manually'
    or (submitted_by is not null and submitted_at is not null
        and length(btrim(coalesce(submission_reference,''))) > 0
        and submission_channel is not null)),
  constraint vcc_reg_owner_approval_proof check (
    status not in ('ready_for_manual_submission','submitted_manually','accepted')
    or (owner_approved_by is not null and owner_approved_at is not null)),
  constraint vcc_reg_info_required_reason check (
    status <> 'information_required' or length(btrim(coalesce(info_required_note,''))) >= 5),
  constraint vcc_reg_closed_reason check (
    status not in ('closed','rejected') or length(btrim(coalesce(close_reason, decision_note, ''))) >= 3)
);
create index if not exists idx_vcc_reg_status   on public.vcc_registration_requests(status) where is_deleted = false;
create index if not exists idx_vcc_reg_deadline on public.vcc_registration_requests(deadline) where is_deleted = false;
create index if not exists idx_vcc_reg_assigned on public.vcc_registration_requests(assigned_to) where is_deleted = false;
comment on table public.vcc_registration_requests is
  '★ صادر ★ طلب تسجيل كيان ميديا مورّدًا لدى جهة. التقديم يدويّ دائمًا: submitted_manually يشترط فاعلًا ووقتًا ومرجعًا وقناة بقيد جدوليّ.';

create table if not exists public.vcc_registration_checklist (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.vcc_registration_requests(id) on delete cascade,
  item_kind     text not null check (item_kind in ('document','field','action')),
  doc_type      text references public.tvn_document_types(key),
  label         text not null check (length(btrim(label)) > 0),
  is_mandatory  boolean not null default true,
  -- ★ بند الوثيقة **لا يُعلَّم يدويًّا** ★ استيفاؤه مشتقّ من tvn_doc_valid وحده،
  --   وإلّا لصار بالإمكان تعليم «تمّ» على وثيقة منتهية.
  satisfied_manual boolean,
  satisfied_note   text,
  sort_order    int not null default 0,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  constraint vcc_chk_doc_type_present check (item_kind <> 'document' or doc_type is not null),
  constraint vcc_chk_document_not_manual check (item_kind <> 'document' or satisfied_manual is null)
);
create index if not exists idx_vcc_chk_request on public.vcc_registration_checklist(request_id, sort_order);

create table if not exists public.vcc_registration_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.vcc_registration_requests(id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  author_id   uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_vcc_comments_request on public.vcc_registration_comments(request_id, created_at desc);
comment on table public.vcc_registration_comments is
  'تعليقات داخلية. لا تُعرَض لأيّ طرف خارجيّ ولا تدخل أيّ منحة وصول.';

-- ⚠️ **بيانات وصفية لمرفق**، ومرجع تخزين مقيَّد بنفس الـbucket والنمط.
--    hr_employee_documents.file_url نصّ حرّ يعيش خارج RLS بالكامل — سابقة حيّة
--    لوثيقة تفلت من قاعدة البيانات. لم تُنسخ هنا.
create table if not exists public.vcc_registration_attachments (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.vcc_registration_requests(id) on delete cascade,
  file_name      text not null check (length(btrim(file_name)) > 0),
  file_mime      text,
  file_bytes     bigint check (file_bytes is null or file_bytes >= 0),
  storage_bucket text not null default 'compliance-documents'
                 check (storage_bucket = 'compliance-documents'),
  storage_path   text not null
                 check (storage_path ~ '^registration/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$'
                        and position('..' in storage_path) = 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  note           text,
  uploaded_by    uuid references auth.users(id),
  uploaded_at    timestamptz not null default now()
);
create index if not exists idx_vcc_attach_request on public.vcc_registration_attachments(request_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) المنح الآمنة — ★ أحدّ سطح أمنيّ في الحزمة كلّها ★
--
--   النموذج منسوخ عن client_project_access القائم:
--     starts_at · expires_at · revoked_at · granted_by · note.
--   وفوقه ما يلزم لطرف **خارج** قاعدة المستخدمين:
--     رمز عشوائيّ قويّ · **يُخزَّن بصمةً فقط** · منتهٍ · قابل للإلغاء ·
--     محدود الفتح والتنزيل · بهوية علامة مائية · ومربوط بوثائق بعينها.
--
--   ما لا يفعله الرمز، وقد رُوعي بنيويًّا:
--     ⛔ لا يكشف مسار تخزين — الدالّة تعيد المسار للخادم فقط، والخادم يعيد
--        رابطًا موقَّعًا قصير العمر ولا يُعيد المسار أبدًا.
--     ⛔ لا يصل إلى وثيقة خارج منحته — الربط صريح في vcc_grant_documents.
--     ⛔ لا يعطي فهرسة مجلَّد — لا استعلام يقرأ storage.objects، والـbucket خاصّ.
--     ⛔ يتوقّف فور إلغاء الوثيقة أو انتهائها — يُعاد فحص الوثيقة عند كلّ فتح.
--
--   ⛔ **ولا يُرسَل بالبريد**. الحالة بعد الإصدار «جاهز للمشاركة اليدوية».
-- ════════════════════════════════════════════════════════════════════════════
create sequence if not exists public.vcc_grant_seq;

create table if not exists public.vcc_document_grants (
  id                 uuid primary key default gen_random_uuid(),
  grant_code         text unique,
  request_id         uuid references public.vcc_registration_requests(id),
  recipient_org      text not null check (length(btrim(recipient_org)) > 0),
  recipient_name     text not null check (length(btrim(recipient_name)) > 0),
  -- ★ بيانات بريد وصفية فقط ★ لا شيء يُرسَل إليها من هذا النظام.
  recipient_email    text,
  recipient_email_note text,
  purpose            text not null check (length(btrim(purpose)) >= 20),
  status             text not null default 'draft' check (status in
                       ('draft','pending_approval','approved','active','expired','revoked','exhausted')),
  approved_by        uuid references auth.users(id),
  approved_at        timestamptz,
  approval_note      text,
  starts_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  max_opens          int not null default 10 check (max_opens between 1 and 500),
  max_downloads      int not null default 3  check (max_downloads between 0 and 100),
  opens_used         int not null default 0 check (opens_used >= 0),
  downloads_used     int not null default 0 check (downloads_used >= 0),
  -- ★ هوية العلامة المائية ★ إلزامية: رابط بلا هوية مطبوعة عليه لا يمكن تتبّعه
  --   بعد خروجه، فلا معنى لتحديد المتلقّي أصلًا.
  watermark_identity text not null check (length(btrim(watermark_identity)) >= 3),
  -- ★★ الرمز بصمةً فقط ★★ لا عمود يحمل الرمز الخام، فلا يمكن تسريبه من قاعدة
  --    البيانات ولا من نسخة احتياطية ولا من سجلّ استعلامات.
  token_hash         text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_hint         text check (token_hint is null or length(token_hint) <= 8),
  token_issued_at    timestamptz,
  token_issued_by    uuid references auth.users(id),
  revoked_by         uuid references auth.users(id),
  revoked_at         timestamptz,
  revoke_reason      text,
  note               text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint vcc_grant_window check (expires_at > starts_at),
  -- منحة «نشطة» بلا رمز أو بلا اعتماد = واجهة تقول «جاهز» ولا شيء خلفها.
  constraint vcc_grant_active_needs_token check (
    status <> 'active' or (token_hash is not null and approved_by is not null and approved_at is not null)),
  constraint vcc_grant_approved_pair check (
    (approved_by is null) = (approved_at is null)),
  constraint vcc_grant_revoked_pair check (
    status <> 'revoked' or (revoked_at is not null and length(btrim(coalesce(revoke_reason,''))) >= 3))
);
create index if not exists idx_vcc_grant_status on public.vcc_document_grants(status);
create index if not exists idx_vcc_grant_expiry on public.vcc_document_grants(expires_at);
create index if not exists idx_vcc_grant_request on public.vcc_document_grants(request_id) where request_id is not null;

create table if not exists public.vcc_grant_documents (
  id             uuid primary key default gen_random_uuid(),
  grant_id       uuid not null references public.vcc_document_grants(id) on delete cascade,
  document_id    uuid not null references public.tvn_documents(id),
  allow_download boolean not null default false,
  added_by       uuid references auth.users(id),
  added_at       timestamptz not null default now(),
  unique (grant_id, document_id)
);

-- سجلّ الوصول: كلّ فتح وكلّ تنزيل وكلّ **رفض**. الرفض المسجَّل هو ما يكشف
-- محاولة تخمين رمز؛ سجلّ يحفظ النجاح وحده يجعل الهجوم غير مرئيّ.
-- ⚠️ لا عنوان IP خام ولا user-agent خام: بصمة مُهشَّمة يرسلها الخادم.
create table if not exists public.vcc_grant_access_log (
  id             uuid primary key default gen_random_uuid(),
  grant_id       uuid references public.vcc_document_grants(id) on delete set null,
  document_id    uuid references public.tvn_documents(id),
  action         text not null check (action in ('open','download','denied')),
  denied_reason  text,
  client_fingerprint text check (client_fingerprint is null or client_fingerprint ~ '^[0-9a-f]{64}$'),
  at             timestamptz not null default now(),
  detail         jsonb not null default '{}'::jsonb
);
create index if not exists idx_vcc_access_grant on public.vcc_grant_access_log(grant_id, at desc);
create index if not exists idx_vcc_access_at    on public.vcc_grant_access_log(at desc);

-- ★★ الحارس البنيويّ للمنح الحسّاسة ★★
-- في V1 الرابط الحسّاس مربوط بطلب **و** باعتماد المالك. تنفيذ ذلك داخل دالّة
-- الإضافة وحدها كان سيترك بابًا مفتوحًا لأيّ كتابة مستقبلية؛ المُشغِّل يجعله
-- قاعدة الجدول لا قاعدة الدالّة.
create or replace function public.vcc_grant_document_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare d record; g record; v_never boolean := false; v_req boolean := true;
begin
  select * into g from public.vcc_document_grants where id = new.grant_id;
  if not found then raise exception 'not found: منحة غير موجودة'; end if;
  if g.status not in ('draft','pending_approval') then
    raise exception 'conflict: لا تُعدَّل قائمة وثائق منحة بعد اعتمادها أو إصدارها';
  end if;

  select * into d from public.tvn_documents where id = new.document_id and is_deleted = false;
  if not found then raise exception 'not found: وثيقة غير موجودة'; end if;

  -- ★ لا تُشارَك وثيقة غير موثَّقة أو منتهية ★ الرفع ليس توثيقًا، والمشاركة
  --   أخطر من العرض الداخليّ.
  if not d.verified or d.doc_status <> 'verified' then
    raise exception 'validation: لا تُشارَك وثيقة غير موثَّقة (الحالة: %)', d.doc_status;
  end if;
  if d.expires_on is not null and d.expires_on < current_date then
    raise exception 'validation: لا تُشارَك وثيقة منتهية (انتهت في %)', d.expires_on;
  end if;

  select coalesce(t.never_public,false) into v_never
    from public.tvn_document_types t where t.key = d.doc_type;
  select require_request_for_sensitive into v_req from public.vcc_settings where id;

  -- ⛔ خطاب المصرف · الهوية · العقود · التواقيع · الأرقام الحسّاسة الكاملة:
  --    لا تدخل منحة إلّا مربوطة بطلب معلوم وباعتماد صريح.
  if coalesce(v_req, true)
     and (d.sensitivity in ('confidential','restricted') or coalesce(v_never,false)) then
    if g.request_id is null then
      raise exception 'validation: وثيقة حسّاسة تتطلّب ربط المنحة بطلب تسجيل معلوم';
    end if;
    if g.approved_by is null then
      raise exception 'validation: وثيقة حسّاسة تتطلّب اعتماد المالك قبل إضافتها';
    end if;
  end if;

  -- تنزيل مسموح لوثيقة غير قابلة للتنزيل = تناقض صامت.
  if new.allow_download and not coalesce(d.is_downloadable, false) then
    raise exception 'validation: هذه الوثيقة غير قابلة للتنزيل';
  end if;

  return new;
end $fn$;

drop trigger if exists trg_vcc_grant_document_guard on public.vcc_grant_documents;
create trigger trg_vcc_grant_document_guard
  before insert or update on public.vcc_grant_documents
  for each row execute function public.vcc_grant_document_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- ٨) الأحداث — ★ تعريف وإدراج فقط. لا إرسال. ★
--    نُعيد استخدام tvn_event_log ومركز الاتصالات: لا طابور ثالث، ولا لمس
--    لـcomms_channels، ولا تمرير dry_run في أيّ موضع من هذا الملفّ.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_event_keys() returns text[]
language sql immutable set search_path = public as $fn$
  select array[
    'document_expiring','document_expired','verification_required',
    'grant_expiring','grant_revoked','grant_exhausted',
    'registration_deadline_near','registration_awaiting_owner_approval',
    'readiness_degraded']::text[]
$fn$;

create or replace function public.vcc_emit(
  p_event text, p_entity_type text, p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_key text; v_res jsonb := '{}'::jsonb; v_full text; v_ok boolean := false;
begin
  if p_event is null then return jsonb_build_object('emitted', false, 'reason', 'no_event'); end if;
  v_full := 'compliance.' || p_event;
  v_key  := coalesce(p_idem, v_full || ':' || coalesce(p_entity_id::text, 'none') || ':' || to_char(now(), 'YYYY-MM-DD'));

  begin
    insert into public.tvn_event_log(event_key, entity_type, entity_id, idempotency_key)
    values (v_full, p_entity_type, p_entity_id, v_key);
  exception when unique_violation then
    return jsonb_build_object('emitted', false, 'reason', 'duplicate', 'idempotency_key', v_key);
  end;

  if to_regprocedure('public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid)') is not null then
    begin
      -- ★ NULL مُصرَّح النوع ★ null عارٍ يجعل تحليل الحِمل الزائد غامضًا فيُرفَع
      --   خطأ يبتلعه المعالج أدناه ويُقرأ «المركز عاطل» بينما التوقيع وحده هو
      --   المشكلة.
      execute 'select public.comms_enqueue($1,$2,$3,null::uuid,$4,$5,null::uuid)'
        into v_res using v_full, p_entity_type, p_entity_id, auth.uid(),
                         coalesce(p_payload, '{}'::jsonb);
      v_ok := true;
    exception when others then
      v_res := jsonb_build_object('error', 'hub_enqueue_failed');
      v_ok := false;
    end;
  else
    v_res := jsonb_build_object('note', 'comms hub not installed — event recorded locally only');
  end if;

  update public.tvn_event_log
     set enqueued = v_ok, hub_result = coalesce(v_res, '{}'::jsonb)
   where idempotency_key = v_key;

  return jsonb_build_object('emitted', true, 'event_key', v_full,
                            'idempotency_key', v_key, 'hub', coalesce(v_res, '{}'::jsonb));
end $fn$;

-- تسجيل الكتالوج — قناة portal وحدها. لا email ولا whatsapp ولا sms.
do $ev$
declare k text; v_ar text;
begin
  if to_regclass('public.comms_event_catalog') is null then return; end if;
  foreach k in array public.vcc_event_keys() loop
    v_ar := case k
      when 'document_expiring'                   then 'اقتراب انتهاء وثيقة امتثال'
      when 'document_expired'                    then 'وثيقة امتثال منتهية'
      when 'verification_required'               then 'وثيقة بانتظار التوثيق'
      when 'grant_expiring'                      then 'اقتراب انتهاء منحة وصول'
      when 'grant_revoked'                       then 'إلغاء منحة وصول'
      when 'grant_exhausted'                     then 'استنفاد حدّ منحة وصول'
      when 'registration_deadline_near'          then 'اقتراب موعد تسليم تسجيل مورّد'
      when 'registration_awaiting_owner_approval' then 'طلب تسجيل بانتظار اعتماد المالك'
      when 'readiness_degraded'                  then 'تراجع جاهزية الامتثال'
      else k end;
    execute format(
      'insert into public.comms_event_catalog(event_key, category, audience, is_financial,
         mandatory, channels, rate_limit_hour, label_ar, label_en, active)
       values (%L, %L, %L, false, false, array[%L]::text[], 200, %L, %L, true)
       on conflict (event_key) do nothing',
      'compliance.' || k, 'compliance', 'internal', 'portal', v_ar, replace(k, '_', ' '));

    if to_regclass('public.comms_templates') is not null then
      execute format(
        'insert into public.comms_templates(event_key, locale, audience_scope, version,
           subject_tpl, body_tpl, is_active)
         values (%L, %L, %L, 1, %L, %L, true)
         on conflict (event_key, locale, audience_scope, version) do nothing',
        'compliance.' || k, 'ar', 'internal', v_ar,
        v_ar || ' — التفاصيل في البوّابة: {{action_url}}');
    end if;
  end loop;
end $ev$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٩) خريطة القدرات — كي تعرض الواجهة الحقيقة بدل التخمين.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_access() returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  return jsonb_build_object(
    'installed',              true,
    'can_view',               public.can_view_compliance_center(),
    'can_manage_documents',   public.can_manage_compliance_documents(),
    'can_verify_documents',   public.can_verify_compliance_documents(),
    'can_issue_grants',       public.can_issue_secure_document_grants(),
    'can_view_restricted',    public.can_view_restricted_company_documents(),
    'can_manage_registration',public.can_manage_vendor_registration(),
    'can_view_request_status',public.vcc_can_view_request_status(),
    'can_view_operational',   public.vcc_can_view_operational_documents(),
    'is_owner',               public.vcc_is_owner(),
    'hub_installed',          to_regclass('public.comms_event_catalog') is not null,
    'opportunity_surface',    to_regclass('public.opportunity_requests') is not null,
    'storage_bucket',         'compliance-documents',
    -- ⛔ تُقرأ في الواجهة كي لا تَعِد بما لا يحدث: لا إرسال، أبدًا.
    'delivery_enabled',       false,
    'note_ar',                'روابط المنح لا تُرسَل من النظام. تُنسخ يدويًّا بعد الإصدار.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٠) ملفّ الشركة وتوابعه
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_company_get() returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_p jsonb; v_c jsonb; v_cert jsonb; v_ref jsonb; v_exp jsonb; v_drone jsonb;
begin
  if not public.can_view_compliance_center() then raise exception 'not authorized'; end if;

  select to_jsonb(p) into v_p from public.vcc_company_profile p where p.id;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.is_primary desc, c.full_name), '[]'::jsonb)
    into v_c from public.vcc_company_contacts c where c.active;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.expires_on nulls last), '[]'::jsonb)
    into v_cert from public.vcc_certifications x where x.is_active;
  -- بيانات تواصل المرجع لا تُعرض إلّا لمن يملك رؤية المقيَّد: هي بيانات شخصية
  -- لطرف ثالث، وليست جزءًا من «عرض الملفّ».
  select coalesce(jsonb_agg(
           case when public.can_view_restricted_company_documents()
                then to_jsonb(r)
                else to_jsonb(r) - 'contact_email' - 'contact_phone' - 'contact_name' end
           order by r.year_to desc nulls last), '[]'::jsonb)
    into v_ref from public.vcc_references r where r.is_active;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.years desc nulls last), '[]'::jsonb)
    into v_exp from public.vcc_industry_experience e where e.is_active;
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
    into v_drone from public.vcc_drone_capability d where d.is_active;

  return jsonb_build_object(
    'profile', coalesce(v_p, '{}'::jsonb), 'contacts', v_c, 'certifications', v_cert,
    'references', v_ref, 'experience', v_exp, 'drone', v_drone);
end $fn$;

create or replace function public.vcc_company_set(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_sectors text[];
begin
  if not public.can_manage_compliance_documents() then
    perform public.vcc_log('company_set', 'company', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  v_sectors := public.vcc_arr(p_input, 'sectors');

  update public.vcc_company_profile set
    legal_name_ar     = coalesce(public.vcc_txt(p_input,'legal_name_ar'), legal_name_ar),
    legal_name_en     = coalesce(public.vcc_txt(p_input,'legal_name_en'), legal_name_en),
    brand_name        = coalesce(public.vcc_txt(p_input,'brand_name'), brand_name),
    entity_type       = coalesce(public.vcc_txt(p_input,'entity_type'), entity_type),
    cr_number_masked  = coalesce(public.vcc_txt(p_input,'cr_number_masked'), cr_number_masked),
    vat_number_masked = coalesce(public.vcc_txt(p_input,'vat_number_masked'), vat_number_masked),
    established_year  = coalesce(public.vcc_int(p_input,'established_year'), established_year),
    employees_count   = coalesce(public.vcc_int(p_input,'employees_count'), employees_count),
    hq_city           = coalesce(public.vcc_txt(p_input,'hq_city'), hq_city),
    hq_address_ar     = coalesce(public.vcc_txt(p_input,'hq_address_ar'), hq_address_ar),
    hq_address_en     = coalesce(public.vcc_txt(p_input,'hq_address_en'), hq_address_en),
    national_address_short = coalesce(public.vcc_txt(p_input,'national_address_short'), national_address_short),
    website           = coalesce(public.vcc_txt(p_input,'website'), website),
    general_email     = coalesce(public.vcc_txt(p_input,'general_email'), general_email),
    general_phone     = coalesce(public.vcc_txt(p_input,'general_phone'), general_phone),
    about_ar          = coalesce(public.vcc_txt(p_input,'about_ar'), about_ar),
    about_en          = coalesce(public.vcc_txt(p_input,'about_en'), about_en),
    mission_ar        = coalesce(public.vcc_txt(p_input,'mission_ar'), mission_ar),
    mission_en        = coalesce(public.vcc_txt(p_input,'mission_en'), mission_en),
    sectors           = case when cardinality(v_sectors) > 0 then v_sectors else sectors end,
    nitaqat_band      = coalesce(public.vcc_txt(p_input,'nitaqat_band'), nitaqat_band),
    gosi_registered   = case when p_input ? 'gosi_registered'
                             then public.vcc_bool(p_input,'gosi_registered', gosi_registered)
                             else gosi_registered end,
    zatca_status      = coalesce(public.vcc_txt(p_input,'zatca_status'), zatca_status),
    bank_name         = coalesce(public.vcc_txt(p_input,'bank_name'), bank_name),
    updated_by = auth.uid(), updated_at = now()
  where id;

  perform public.vcc_log('company_set', 'company', null, true,
                         jsonb_build_object('fields', (select count(*) from jsonb_object_keys(p_input))));
  return jsonb_build_object('ok', true);
end $fn$;

-- توابع الملفّ: عقد واحد متكرّر (upsert بالمعرّف، وأرشفة بعلم نشِط).
create or replace function public.vcc_contact_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  if v_id is null then
    insert into public.vcc_company_contacts(full_name, role_title, purpose, email, phone,
      is_primary, language, note, created_by)
    values (public.vcc_txt(p_input,'full_name'), public.vcc_txt(p_input,'role_title'),
            coalesce(public.vcc_txt(p_input,'purpose'),'general'),
            public.vcc_txt(p_input,'email'), public.vcc_txt(p_input,'phone'),
            public.vcc_bool(p_input,'is_primary'), public.vcc_txt(p_input,'language'),
            public.vcc_txt(p_input,'note'), auth.uid())
    returning id into v_id;
  else
    update public.vcc_company_contacts set
      full_name = coalesce(public.vcc_txt(p_input,'full_name'), full_name),
      role_title = coalesce(public.vcc_txt(p_input,'role_title'), role_title),
      purpose   = coalesce(public.vcc_txt(p_input,'purpose'), purpose),
      email     = coalesce(public.vcc_txt(p_input,'email'), email),
      phone     = coalesce(public.vcc_txt(p_input,'phone'), phone),
      is_primary = case when p_input ? 'is_primary' then public.vcc_bool(p_input,'is_primary', is_primary) else is_primary end,
      language  = coalesce(public.vcc_txt(p_input,'language'), language),
      note      = coalesce(public.vcc_txt(p_input,'note'), note),
      active    = case when p_input ? 'active' then public.vcc_bool(p_input,'active', active) else active end,
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;
  perform public.vcc_log('contact_upsert', 'contact', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_certification_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  if v_id is null then
    insert into public.vcc_certifications(cert_name_ar, cert_name_en, issuing_body, scope_note,
      issued_on, expires_on, document_id, created_by)
    values (public.vcc_txt(p_input,'cert_name_ar'), public.vcc_txt(p_input,'cert_name_en'),
            public.vcc_txt(p_input,'issuing_body'), public.vcc_txt(p_input,'scope_note'),
            nullif(public.vcc_txt(p_input,'issued_on'),'')::date,
            nullif(public.vcc_txt(p_input,'expires_on'),'')::date,
            nullif(public.vcc_txt(p_input,'document_id'),'')::uuid, auth.uid())
    returning id into v_id;
  else
    update public.vcc_certifications set
      cert_name_ar = coalesce(public.vcc_txt(p_input,'cert_name_ar'), cert_name_ar),
      cert_name_en = coalesce(public.vcc_txt(p_input,'cert_name_en'), cert_name_en),
      issuing_body = coalesce(public.vcc_txt(p_input,'issuing_body'), issuing_body),
      scope_note   = coalesce(public.vcc_txt(p_input,'scope_note'), scope_note),
      issued_on    = coalesce(nullif(public.vcc_txt(p_input,'issued_on'),'')::date, issued_on),
      expires_on   = coalesce(nullif(public.vcc_txt(p_input,'expires_on'),'')::date, expires_on),
      document_id  = coalesce(nullif(public.vcc_txt(p_input,'document_id'),'')::uuid, document_id),
      is_active    = case when p_input ? 'is_active' then public.vcc_bool(p_input,'is_active', is_active) else is_active end,
      updated_at   = now()
    where id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;
  perform public.vcc_log('certification_upsert', 'certification', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_reference_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  if v_id is null then
    insert into public.vcc_references(client_name, sector, scope_ar, scope_en, year_from, year_to,
      contact_name, contact_email, contact_phone, permission_to_cite, permission_note, project_id, created_by)
    values (public.vcc_txt(p_input,'client_name'), public.vcc_txt(p_input,'sector'),
            public.vcc_txt(p_input,'scope_ar'), public.vcc_txt(p_input,'scope_en'),
            public.vcc_int(p_input,'year_from'), public.vcc_int(p_input,'year_to'),
            public.vcc_txt(p_input,'contact_name'), public.vcc_txt(p_input,'contact_email'),
            public.vcc_txt(p_input,'contact_phone'), public.vcc_bool(p_input,'permission_to_cite'),
            public.vcc_txt(p_input,'permission_note'),
            nullif(public.vcc_txt(p_input,'project_id'),'')::uuid, auth.uid())
    returning id into v_id;
  else
    update public.vcc_references set
      client_name = coalesce(public.vcc_txt(p_input,'client_name'), client_name),
      sector      = coalesce(public.vcc_txt(p_input,'sector'), sector),
      scope_ar    = coalesce(public.vcc_txt(p_input,'scope_ar'), scope_ar),
      scope_en    = coalesce(public.vcc_txt(p_input,'scope_en'), scope_en),
      year_from   = coalesce(public.vcc_int(p_input,'year_from'), year_from),
      year_to     = coalesce(public.vcc_int(p_input,'year_to'), year_to),
      contact_name  = coalesce(public.vcc_txt(p_input,'contact_name'), contact_name),
      contact_email = coalesce(public.vcc_txt(p_input,'contact_email'), contact_email),
      contact_phone = coalesce(public.vcc_txt(p_input,'contact_phone'), contact_phone),
      permission_to_cite = case when p_input ? 'permission_to_cite'
                                then public.vcc_bool(p_input,'permission_to_cite', permission_to_cite)
                                else permission_to_cite end,
      permission_note = coalesce(public.vcc_txt(p_input,'permission_note'), permission_note),
      is_active   = case when p_input ? 'is_active' then public.vcc_bool(p_input,'is_active', is_active) else is_active end,
      updated_at  = now()
    where id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;
  perform public.vcc_log('reference_upsert', 'reference', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_experience_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_sector text;
begin
  if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  v_sector := public.vcc_txt(p_input,'sector');
  if v_sector is null then raise exception 'validation: القطاع إلزاميّ'; end if;
  insert into public.vcc_industry_experience(sector, sector_ar, years, projects_count,
    highlights_ar, highlights_en, created_by)
  values (v_sector, public.vcc_txt(p_input,'sector_ar'), public.vcc_int(p_input,'years'),
          public.vcc_int(p_input,'projects_count'), public.vcc_txt(p_input,'highlights_ar'),
          public.vcc_txt(p_input,'highlights_en'), auth.uid())
  on conflict (sector) do update set
    sector_ar = coalesce(excluded.sector_ar, public.vcc_industry_experience.sector_ar),
    years = coalesce(excluded.years, public.vcc_industry_experience.years),
    projects_count = coalesce(excluded.projects_count, public.vcc_industry_experience.projects_count),
    highlights_ar = coalesce(excluded.highlights_ar, public.vcc_industry_experience.highlights_ar),
    highlights_en = coalesce(excluded.highlights_en, public.vcc_industry_experience.highlights_en),
    is_active = true, updated_at = now()
  returning id into v_id;
  perform public.vcc_log('experience_upsert', 'experience', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_drone_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  if v_id is null then
    insert into public.vcc_drone_capability(capability_name, operator_entity, drone_models,
      registered_units, licensed_pilots, max_altitude_m, night_operations, bvlos_approved,
      coverage_regions, insurance_document_id, permit_document_id, license_document_id,
      restrictions_note, created_by)
    values (public.vcc_txt(p_input,'capability_name'), public.vcc_txt(p_input,'operator_entity'),
            public.vcc_arr(p_input,'drone_models'), public.vcc_int(p_input,'registered_units'),
            public.vcc_int(p_input,'licensed_pilots'), public.vcc_int(p_input,'max_altitude_m'),
            public.vcc_bool(p_input,'night_operations'), public.vcc_bool(p_input,'bvlos_approved'),
            public.vcc_arr(p_input,'coverage_regions'),
            nullif(public.vcc_txt(p_input,'insurance_document_id'),'')::uuid,
            nullif(public.vcc_txt(p_input,'permit_document_id'),'')::uuid,
            nullif(public.vcc_txt(p_input,'license_document_id'),'')::uuid,
            public.vcc_txt(p_input,'restrictions_note'), auth.uid())
    returning id into v_id;
  else
    update public.vcc_drone_capability set
      capability_name = coalesce(public.vcc_txt(p_input,'capability_name'), capability_name),
      operator_entity = coalesce(public.vcc_txt(p_input,'operator_entity'), operator_entity),
      drone_models = case when p_input ? 'drone_models' then public.vcc_arr(p_input,'drone_models') else drone_models end,
      registered_units = coalesce(public.vcc_int(p_input,'registered_units'), registered_units),
      licensed_pilots  = coalesce(public.vcc_int(p_input,'licensed_pilots'), licensed_pilots),
      max_altitude_m   = coalesce(public.vcc_int(p_input,'max_altitude_m'), max_altitude_m),
      night_operations = case when p_input ? 'night_operations' then public.vcc_bool(p_input,'night_operations', night_operations) else night_operations end,
      bvlos_approved   = case when p_input ? 'bvlos_approved' then public.vcc_bool(p_input,'bvlos_approved', bvlos_approved) else bvlos_approved end,
      coverage_regions = case when p_input ? 'coverage_regions' then public.vcc_arr(p_input,'coverage_regions') else coverage_regions end,
      insurance_document_id = coalesce(nullif(public.vcc_txt(p_input,'insurance_document_id'),'')::uuid, insurance_document_id),
      permit_document_id    = coalesce(nullif(public.vcc_txt(p_input,'permit_document_id'),'')::uuid, permit_document_id),
      license_document_id   = coalesce(nullif(public.vcc_txt(p_input,'license_document_id'),'')::uuid, license_document_id),
      restrictions_note = coalesce(public.vcc_txt(p_input,'restrictions_note'), restrictions_note),
      is_active = case when p_input ? 'is_active' then public.vcc_bool(p_input,'is_active', is_active) else is_active end,
      updated_at = now()
    where id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;
  perform public.vcc_log('drone_upsert', 'drone_capability', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١١) وثائق الشركة — تُكتب في tvn_documents نفسه.
--
-- ⚠️ لماذا لا نُنادي tvn_document_upsert مباشرةً؟ لأنّها تُبوَّب على
--    can_manage_talent_profiles() — دور شبكة المواهب. من يدير وثائق الشركة
--    ليس بالضرورة من يدير ملفّات المستقلّين، والعكس. الجدول واحد والقاعدة
--    واحدة (tvn_doc_valid) والقيود واحدة والتدقيق واحد؛ **البوّابة** وحدها
--    مختلفة، وذلك هو الفرق الصحيح. لم يُنشأ جدول ولا مفهوم صلاحية ثانٍ.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_document_register(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_type text; v_path text; v_bucket text; v_sens text; v_prev record;
begin
  if not public.can_manage_compliance_documents() then
    perform public.vcc_log('document_register', 'document', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;

  v_type := public.vcc_txt(p_input, 'doc_type');
  if v_type is null then raise exception 'validation: doc_type إلزاميّ'; end if;
  if not exists (select 1 from public.tvn_document_types where key = v_type and active) then
    raise exception 'validation: نوع وثيقة غير معروف';
  end if;

  v_path   := public.vcc_txt(p_input, 'storage_path');
  v_bucket := case when v_path is null then null else 'compliance-documents' end;
  v_sens   := coalesce(public.vcc_txt(p_input, 'sensitivity'), 'internal');

  v_id := nullif(public.vcc_txt(p_input, 'id'), '')::uuid;

  if v_id is null then
    -- ★ الإدراج لا يقبل verified مهما أرسل العميل ★ ولا doc_status = 'verified'.
    insert into public.tvn_documents(
      doc_type, owner_kind, title, doc_language, issuer, doc_number_masked,
      issued_on, expires_on, storage_bucket, storage_path, file_name, file_mime, file_bytes,
      checksum_sha256, sensitivity, is_downloadable, watermark_required, internal_notes,
      doc_version, supersedes_id, uploaded_by, doc_status, metadata)
    values (
      v_type, 'company', public.vcc_txt(p_input,'title'),
      public.vcc_txt(p_input,'doc_language'), public.vcc_txt(p_input,'issuer'),
      public.vcc_txt(p_input,'doc_number_masked'),
      nullif(public.vcc_txt(p_input,'issued_on'),'')::date,
      nullif(public.vcc_txt(p_input,'expires_on'),'')::date,
      v_bucket, v_path,
      public.vcc_txt(p_input,'file_name'), public.vcc_txt(p_input,'file_mime'),
      nullif(public.vcc_txt(p_input,'file_bytes'),'')::bigint,
      lower(public.vcc_txt(p_input,'checksum_sha256')),
      v_sens, public.vcc_bool(p_input,'is_downloadable'),
      public.vcc_bool(p_input,'watermark_required', true),
      public.vcc_txt(p_input,'internal_notes'),
      coalesce(public.vcc_int(p_input,'doc_version'), 1),
      nullif(public.vcc_txt(p_input,'supersedes_id'),'')::uuid,
      auth.uid(),
      case when v_path is null then 'draft' else 'uploaded' end,
      coalesce(p_input -> 'metadata', '{}'::jsonb))
    returning id into v_id;

    -- إصدار جديد يُؤرشف سابقه صراحةً (ولا يحذفه): الإصدار القديم دليل تاريخيّ.
    if (select supersedes_id from public.tvn_documents where id = v_id) is not null then
      update public.tvn_documents
         set verified = false, doc_status = 'archived', archived_by = auth.uid(),
             archived_at = now(), status_changed_by = auth.uid(), status_changed_at = now()
       where id = (select supersedes_id from public.tvn_documents where id = v_id)
         and doc_status <> 'archived';
    end if;
  else
    select * into v_prev from public.tvn_documents
     where id = v_id and owner_kind = 'company' and is_deleted = false;
    if not found then raise exception 'not found'; end if;
    if v_prev.doc_status in ('revoked','archived') then
      raise exception 'conflict: لا تُعدَّل وثيقة ملغاة أو مؤرشفة — سجّل إصدارًا جديدًا';
    end if;

    -- ★ تغيير الملفّ يُبطل التوثيق ★ (المُشغِّل ينقل الحالة إلى pending_verification).
    update public.tvn_documents d set
      title        = coalesce(public.vcc_txt(p_input,'title'), d.title),
      doc_language = coalesce(public.vcc_txt(p_input,'doc_language'), d.doc_language),
      issuer       = coalesce(public.vcc_txt(p_input,'issuer'), d.issuer),
      doc_number_masked = coalesce(public.vcc_txt(p_input,'doc_number_masked'), d.doc_number_masked),
      issued_on    = coalesce(nullif(public.vcc_txt(p_input,'issued_on'),'')::date, d.issued_on),
      expires_on   = coalesce(nullif(public.vcc_txt(p_input,'expires_on'),'')::date, d.expires_on),
      storage_bucket = case when v_path is null then d.storage_bucket else 'compliance-documents' end,
      storage_path   = coalesce(v_path, d.storage_path),
      file_name    = coalesce(public.vcc_txt(p_input,'file_name'), d.file_name),
      file_mime    = coalesce(public.vcc_txt(p_input,'file_mime'), d.file_mime),
      file_bytes   = coalesce(nullif(public.vcc_txt(p_input,'file_bytes'),'')::bigint, d.file_bytes),
      checksum_sha256 = coalesce(lower(public.vcc_txt(p_input,'checksum_sha256')), d.checksum_sha256),
      sensitivity  = coalesce(public.vcc_txt(p_input,'sensitivity'), d.sensitivity),
      is_downloadable = case when p_input ? 'is_downloadable'
                             then public.vcc_bool(p_input,'is_downloadable', d.is_downloadable)
                             else d.is_downloadable end,
      watermark_required = case when p_input ? 'watermark_required'
                                then public.vcc_bool(p_input,'watermark_required', d.watermark_required)
                                else d.watermark_required end,
      internal_notes = coalesce(public.vcc_txt(p_input,'internal_notes'), d.internal_notes),
      metadata     = case when p_input ? 'metadata' then coalesce(p_input -> 'metadata','{}'::jsonb) else d.metadata end,
      verified     = case when v_path is not null and coalesce(v_path,'') <> coalesce(d.storage_path,'')
                          then false else d.verified end,
      verified_by  = case when v_path is not null and coalesce(v_path,'') <> coalesce(d.storage_path,'')
                          then null else d.verified_by end,
      verified_at  = case when v_path is not null and coalesce(v_path,'') <> coalesce(d.storage_path,'')
                          then null else d.verified_at end,
      updated_at   = now()
    where d.id = v_id;
  end if;

  perform public.vcc_log('document_register', 'document', v_id, true,
    jsonb_build_object('doc_type', v_type, 'sensitivity', v_sens, 'has_file', v_path is not null));

  -- وثيقة برفعٍ مكتمل تنتظر توثيقًا — حدث داخليّ، لا إرسال.
  if v_path is not null then
    perform public.vcc_emit('verification_required', 'document', v_id,
      jsonb_build_object('doc_type', v_type),
      'compliance.verification_required:' || v_id::text || ':' || to_char(now(),'YYYY-MM-DD'));
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'verified', false,
    'status', (select doc_status from public.tvn_documents where id = v_id),
    'note_ar', 'الرفع لا يجعل الوثيقة صالحة. التوثيق فعل منفصل بفاعل آخر.');
end $fn$;

-- ★ التوثيق أو الرفض ★ بوّابة الامتثال + فاعل مختلف عن الرافع.
-- القيد الجدوليّ tvn_doc_verify_not_self يحرس الباب حتّى لو أُعيدت كتابة الدالّة.
create or replace function public.vcc_document_decide(
  p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare d record;
begin
  if not public.can_verify_compliance_documents() then
    perform public.vcc_log('document_decide', 'document', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  if p_decision is null or p_decision not in ('verified','rejected') then
    raise exception 'validation: القرار إمّا verified أو rejected';
  end if;

  select * into d from public.tvn_documents
   where id = p_id and is_deleted = false for update;
  if not found then raise exception 'not found'; end if;
  if d.doc_status in ('revoked','archived') then
    raise exception 'conflict: الوثيقة ملغاة أو مؤرشفة';
  end if;
  if d.storage_path is null then
    raise exception 'validation: لا تُوثَّق وثيقة بلا ملفّ مرفوع';
  end if;

  -- ★★ الرافع لا يوثّق ★★ فحص صريح + قيد جدوليّ خلفه.
  if d.uploaded_by is not null and d.uploaded_by = auth.uid() then
    perform public.vcc_log('document_decide', 'document', p_id, false,
                           jsonb_build_object('reason','self_verification_blocked'));
    raise exception 'not authorized: من رفع الوثيقة لا يوثّقها';
  end if;

  if p_decision = 'verified' then
    if d.expires_on is not null and d.expires_on < current_date then
      raise exception 'validation: لا تُوثَّق وثيقة منتهية (انتهت في %)', d.expires_on;
    end if;
    if length(btrim(coalesce(p_note,''))) < 3 then
      raise exception 'validation: ملاحظة التوثيق إلزامية (٣ محارف فأكثر)';
    end if;
    update public.tvn_documents
       set verified = true, verified_by = auth.uid(), verified_at = now(),
           verification_note = p_note, doc_status = 'verified',
           rejected_by = null, rejected_at = null, reject_reason = null,
           status_changed_by = auth.uid(), status_changed_at = now(), updated_at = now()
     where id = p_id;
  else
    if length(btrim(coalesce(p_note,''))) < 5 then
      raise exception 'validation: سبب الرفض إلزاميّ (٥ محارف فأكثر)';
    end if;
    update public.tvn_documents
       set verified = false, verified_by = null, verified_at = null,
           doc_status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
           reject_reason = p_note, status_changed_by = auth.uid(),
           status_changed_at = now(), updated_at = now()
     where id = p_id;
  end if;

  perform public.vcc_log('document_decide', 'document', p_id, true,
    jsonb_build_object('decision', p_decision, 'doc_type', d.doc_type));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_decision);
end $fn$;

-- الأرشفة والإلغاء — ★ كلاهما يُنزل verified إلى false ★ فتخرج الوثيقة فورًا
-- من tvn_doc_valid ومن كلّ منحة، بلا حاجة لتعديل التعريف الواحد للصلاحية.
create or replace function public.vcc_document_set_status(
  p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare d record; v_grants int := 0;
begin
  if p_status is null or p_status not in ('archived','revoked','expired') then
    raise exception 'validation: الحالة المسموحة هنا: archived أو revoked أو expired';
  end if;
  -- الإلغاء أشدّ من الأرشفة: يحتاج بوّابة التوثيق أو المالك.
  if p_status = 'revoked' then
    if not public.can_verify_compliance_documents() then raise exception 'not authorized'; end if;
  else
    if not public.can_manage_compliance_documents() then raise exception 'not authorized'; end if;
  end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'validation: السبب إلزاميّ (٥ محارف فأكثر)';
  end if;

  select * into d from public.tvn_documents where id = p_id and is_deleted = false for update;
  if not found then raise exception 'not found'; end if;

  update public.tvn_documents
     set verified = false, verified_by = null, verified_at = null,
         doc_status = p_status,
         archived_by = case when p_status = 'archived' then auth.uid() else archived_by end,
         archived_at = case when p_status = 'archived' then now() else archived_at end,
         revoked_by  = case when p_status = 'revoked'  then auth.uid() else revoked_by end,
         revoked_at  = case when p_status = 'revoked'  then now() else revoked_at end,
         revoke_reason = case when p_status = 'revoked' then p_reason else revoke_reason end,
         status_changed_by = auth.uid(), status_changed_at = now(), updated_at = now()
   where id = p_id;

  -- المنح النشطة التي تحمل هذه الوثيقة تتوقّف عنها فورًا: vcc_grant_open يعيد
  -- فحص الوثيقة في كلّ فتح، فلا حاجة لتعديل صفوف المنح — نكتفي بعدّها وإبلاغ
  -- المُصدِر بصدق بدل الادّعاء بأنّ شيئًا «سُحب».
  select count(*) into v_grants
    from public.vcc_grant_documents gd
    join public.vcc_document_grants g on g.id = gd.grant_id
   where gd.document_id = p_id and g.status = 'active';

  perform public.vcc_log('document_set_status', 'document', p_id, true,
    jsonb_build_object('status', p_status, 'affected_active_grants', v_grants));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status,
    'active_grants_now_blocked', v_grants,
    'note_ar', 'كلّ منحة تحمل هذه الوثيقة ستتوقّف عنها عند أوّل فتح — التحقّق يتمّ لحظة الفتح لا لحظة الإصدار.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٢) قراءة الوثائق — ★ الحساسية تُصفّي، وlist لا تُعيد مسار تخزين أبدًا ★
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_document_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb; v_restricted boolean; v_ops_only boolean; v_type text; v_status text;
begin
  if not (public.can_view_compliance_center() or public.vcc_can_view_operational_documents()) then
    raise exception 'not authorized';
  end if;
  v_restricted := public.can_view_restricted_company_documents();
  -- من لا يملك سوى بوّابة العمليات يرى وثائق السلامة والتصاريح **فقط**.
  v_ops_only   := not public.can_view_compliance_center();
  v_type       := public.vcc_txt(p_filters, 'doc_type');
  v_status     := public.vcc_txt(p_filters, 'status');

  select coalesce(jsonb_agg(x order by x ->> 'doc_type'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'doc_type', d.doc_type,
      'label_ar', t.label_ar, 'label_en', t.label_en,
      'title', d.title, 'doc_language', d.doc_language, 'issuer', d.issuer,
      -- ⛔ الرقم المُقنَّع لا يظهر لغير المخوَّل بالمقيَّد.
      'doc_number_masked', case when v_restricted then d.doc_number_masked else null end,
      'doc_version', d.doc_version,
      'issued_on', d.issued_on, 'expires_on', d.expires_on,
      'days_left', case when d.expires_on is null then null else (d.expires_on - current_date) end,
      'status', public.vcc_doc_effective_status(d.id),
      'stored_status', d.doc_status,
      'verified', d.verified, 'verified_by', d.verified_by, 'verified_at', d.verified_at,
      'verification_note', d.verification_note,
      'sensitivity', d.sensitivity, 'restricted', d.restricted,
      'is_downloadable', d.is_downloadable, 'watermark_required', d.watermark_required,
      'never_public', coalesce(t.never_public, false),
      'file_name', d.file_name, 'file_mime', d.file_mime, 'file_bytes', d.file_bytes,
      'checksum_sha256', case when v_restricted then d.checksum_sha256 else null end,
      'has_file', d.storage_path is not null,
      -- ★★ لا مسار تخزين في أيّ قائمة ★★ يُطلب صراحةً لوثيقة واحدة عبر
      --    vcc_document_storage_ref، ويُوقَّع بهوية المستخدم لا بمفتاح الخدمة.
      'internal_notes', case when v_restricted then d.internal_notes else null end,
      'uploaded_by', d.uploaded_by, 'created_at', d.created_at, 'updated_at', d.updated_at) as x
      from public.tvn_documents d
      join public.tvn_document_types t on t.key = d.doc_type
     where d.owner_kind = 'company' and d.is_deleted = false
       and (v_type is null or d.doc_type = v_type)
       and (v_status is null or public.vcc_doc_effective_status(d.id) = v_status)
       -- ★ الحساسية تُصفّي الصفوف نفسها، لا الأعمدة فقط ★
       and (v_restricted or d.sensitivity not in ('confidential','restricted'))
       and (not v_ops_only
            or d.doc_type in ('hse_policy','hse_certificate','safety_certificate',
                              'drone_permit','drone_operator_license','public_liability',
                              'insurance_policy','municipality_license'))
  ) s;

  return jsonb_build_object(
    'rows', v_rows,
    'can_view_restricted', v_restricted,
    'scope', case when v_ops_only then 'operational_only' else 'full' end,
    'note_ar', case when v_restricted then null
                    else 'الوثائق المقيَّدة (المصرفية والهوية والعقود) غير معروضة لك — هذا منع صلاحية لا نقص بيانات.' end);
end $fn$;

-- مرجع التخزين لوثيقة **واحدة** — يُعاد فقط لمن يراها، وبعد فحص الحساسية.
-- الواجهة توقّع بهوية المستخدم تحت سياسة التخزين؛ لا مفتاح خدمة في المتصفّح.
create or replace function public.vcc_document_storage_ref(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare d record;
begin
  if not public.can_view_compliance_center() then raise exception 'not authorized'; end if;
  select * into d from public.tvn_documents
   where id = p_id and owner_kind = 'company' and is_deleted = false;
  if not found then raise exception 'not found'; end if;
  if d.sensitivity in ('confidential','restricted')
     and not public.can_view_restricted_company_documents() then
    perform public.vcc_log('document_storage_ref', 'document', p_id, false,
                           jsonb_build_object('reason','restricted'));
    raise exception 'not authorized: وثيقة مقيَّدة';
  end if;
  if d.storage_path is null then raise exception 'validation: لا ملفّ مرفوع'; end if;

  perform public.vcc_log('document_storage_ref', 'document', p_id, true,
                         jsonb_build_object('doc_type', d.doc_type));
  return jsonb_build_object('ok', true, 'bucket', d.storage_bucket, 'path', d.storage_path,
    'watermark_required', d.watermark_required, 'file_name', d.file_name);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٣) جاهزية الامتثال — ★ محرّك قواعد صريح، لا ذكاء اصطناعيّ ★
--
--   كلّ سطر في النتيجة يحمل: المتطلَّب · الحكم · **السبب بالعربية** · الوثيقة
--   المعنيّة. لا درجة مركّبة، ولا وزن خفيّ، ولا تنبّؤ.
--   الصلاحية تُقاس بـtvn_doc_valid وحدها — لا تعريف ثانٍ.
--
--   الحالات الخمس:
--     not_configured    لا قواعد فعّالة أصلًا  ⇒ لا نعرض صفرًا مضلّلًا.
--     expired_blockers  متطلَّب إلزاميّ وثيقتُه **منتهية**.
--     incomplete        متطلَّب إلزاميّ ناقص أو غير موثَّق.
--     ready_with_warnings كلّ الإلزاميّ مستوفًى، ومع ذلك هناك اختياريّ ناقص
--                       أو انتهاء وشيك داخل نافذة التحذير.
--     ready             كلّ الإلزاميّ مستوفًى ولا تحذير.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_readiness(p_context text default 'general')
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r record; v_rows jsonb := '[]'::jsonb; v_ctx text;
  v_total int := 0; v_mand int := 0; v_mand_met int := 0;
  v_missing int := 0; v_expired int := 0; v_warn int := 0;
  v_state text; v_days int; v_profj jsonb; v_val text;
  v_doc record; v_verdict text; v_reason text; v_docid uuid;
begin
  if not public.can_view_compliance_center() then raise exception 'not authorized'; end if;
  v_ctx := coalesce(nullif(btrim(coalesce(p_context,'')),''), 'general');
  select readiness_warning_days into v_days from public.vcc_settings where id;
  v_days := coalesce(v_days, 30);
  -- jsonb لا record: قراءة حقل باسمه المخزَّن في صفّ قواعد تحتاج وصولًا
  -- ديناميكيًّا، وSQL ديناميكيّ داخل حلقة قراءة تكلفة بلا مقابل.
  select to_jsonb(p) into v_profj from public.vcc_company_profile p where p.id;
  v_profj := coalesce(v_profj, '{}'::jsonb);

  for r in select * from public.vcc_readiness_requirements
            where active and context in ('general', v_ctx)
            order by is_mandatory desc, requirement_key
  loop
    v_total := v_total + 1;
    if r.is_mandatory then v_mand := v_mand + 1; end if;
    v_verdict := 'missing'; v_reason := 'غير مسجَّل بعد.'; v_docid := null;

    if r.kind = 'document' then
      -- ★ «الأفضل» لا «الأحدث» ★ tvn_doc_valid وجوديّة (هل توجد واحدة صالحة؟)،
      --   فلو اخترنا الأحدث إصدارًا لتناقض السبب المعروض مع الحكم: إصدار ٢ غير
      --   موثَّق مع إصدار ١ ساري كان سيُقرأ «غير موثَّق» والنظام يعتبره صالحًا.
      select d.* into v_doc from public.tvn_documents d
       where d.owner_kind = 'company' and d.doc_type = r.doc_type and d.is_deleted = false
         and d.doc_status not in ('archived','revoked','rejected')
       order by d.verified desc,
                (d.expires_on is null or d.expires_on >= current_date) desc,
                d.doc_version desc, d.created_at desc
       limit 1;

      if v_doc.id is null then
        v_verdict := 'missing'; v_reason := 'لا توجد وثيقة من هذا النوع.';
      else
        v_docid := v_doc.id;
        -- ★ الحكم من tvn_doc_valid وحدها ★ والأعمدة أدناه **تشرح** ولا تحكم.
        if not public.tvn_doc_valid('company', null, r.doc_type) then
          if not v_doc.verified then
            v_verdict := 'unverified';
            v_reason  := 'الوثيقة مرفوعة لكنّها غير موثَّقة — الرفع ليس توثيقًا.';
          elsif v_doc.expires_on is not null and v_doc.expires_on < current_date then
            v_verdict := 'expired';
            v_reason  := 'انتهت في ' || v_doc.expires_on::text || '.';
          else
            v_verdict := 'unverified';
            v_reason  := 'لا تُعدّ صالحة حسب التعريف الواحد للصلاحية.';
          end if;
        elsif r.required_language is not null
              and coalesce(v_doc.doc_language,'') not in (r.required_language, 'ar_en')
              and r.required_language <> 'both' then
          v_verdict := 'wrong_language';
          v_reason  := 'اللغة المطلوبة ' || r.required_language || ' والمسجَّل ' ||
                       coalesce(v_doc.doc_language, 'غير محدَّد') || '.';
        elsif v_doc.doc_version < r.min_version then
          v_verdict := 'wrong_version';
          v_reason  := 'الإصدار المطلوب ' || r.min_version::text || ' والمسجَّل ' || v_doc.doc_version::text || '.';
        else
          v_verdict := 'met';
          v_reason  := case when v_doc.expires_on is null then 'موثَّقة وسارية بلا تاريخ انتهاء.'
                            else 'موثَّقة وسارية حتّى ' || v_doc.expires_on::text || '.' end;
          if v_doc.expires_on is not null and (v_doc.expires_on - current_date) <= v_days then
            v_warn := v_warn + 1;
            v_reason := v_reason || ' ⚠️ يتبقّى ' || (v_doc.expires_on - current_date)::text || ' يومًا.';
          end if;
        end if;
      end if;

    elsif r.kind = 'profile_field' then
      if r.profile_field = 'contact_procurement' then
        if exists (select 1 from public.vcc_company_contacts
                    where purpose = 'procurement' and active
                      and coalesce(btrim(email),'') <> '') then
          v_verdict := 'met'; v_reason := 'مسجَّل في جهات الاتصال.';
        else
          v_verdict := 'missing'; v_reason := 'لا يوجد مسؤول مشتريات ببريد مسجَّل.';
        end if;
      else
        v_val := nullif(btrim(coalesce(v_profj ->> r.profile_field, '')), '');
        if v_val is null then
          v_verdict := 'missing'; v_reason := 'حقل إلزاميّ في ملفّ الشركة غير معبّأ.';
        else
          v_verdict := 'met'; v_reason := 'معبّأ.';
        end if;
      end if;

    else  -- capability
      if r.profile_field = 'drone' then
        if exists (select 1 from public.vcc_drone_capability where is_active) then
          v_verdict := 'met'; v_reason := 'قدرة مسجَّلة.';
        else
          v_verdict := 'missing'; v_reason := 'لا قدرة درون مسجَّلة.';
        end if;
      else
        v_verdict := 'missing'; v_reason := 'قدرة غير معرَّفة في النظام.';
      end if;
    end if;

    if v_verdict = 'met' then
      if r.is_mandatory then v_mand_met := v_mand_met + 1; end if;
    elsif v_verdict = 'expired' then
      if r.is_mandatory then v_expired := v_expired + 1; else v_warn := v_warn + 1; end if;
    else
      if r.is_mandatory then v_missing := v_missing + 1; else v_warn := v_warn + 1; end if;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'requirement_key', r.requirement_key, 'context', r.context, 'kind', r.kind,
      'doc_type', r.doc_type, 'profile_field', r.profile_field,
      'label_ar', r.label_ar, 'label_en', r.label_en,
      'is_mandatory', r.is_mandatory, 'verdict', v_verdict, 'reason_ar', v_reason,
      'document_id', v_docid, 'note_ar', r.note_ar);
  end loop;

  -- ★ لا صفر مضلّل ★ غياب القواعد ليس «غير جاهز»، بل «غير مُعدّ».
  if v_total = 0 then
    v_state := 'not_configured';
  elsif v_expired > 0 then
    v_state := 'expired_blockers';
  elsif v_missing > 0 then
    v_state := 'incomplete';
  elsif v_warn > 0 then
    v_state := 'ready_with_warnings';
  else
    v_state := 'ready';
  end if;

  return jsonb_build_object(
    'engine', 'rule_based', 'ai_used', false,
    'context', v_ctx, 'state', v_state,
    'requirements_total', v_total, 'mandatory_total', v_mand, 'mandatory_met', v_mand_met,
    'mandatory_missing', v_missing, 'mandatory_expired', v_expired, 'warnings', v_warn,
    'warning_window_days', v_days,
    'rows', v_rows,
    'note_ar', case
      when v_state = 'not_configured' then 'لا قواعد جاهزية فعّالة — هذه ليست «غير جاهز»، بل «لم تُعدّ القواعد بعد».'
      when v_state = 'expired_blockers' then 'هناك وثائق إلزامية منتهية. لا يُقدَّم ملفّ بهذه الحالة.'
      when v_state = 'incomplete' then 'هناك متطلّبات إلزامية ناقصة أو غير موثَّقة.'
      when v_state = 'ready_with_warnings' then 'الإلزاميّ مكتمل، مع تحذيرات (انتهاء وشيك أو اختياريّ ناقص).'
      else 'كلّ المتطلّبات مستوفاة.' end);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٤) المنح الآمنة — الإنشاء · الاعتماد · الإصدار · الإلغاء · الاسترداد
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_grant_create(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_ttl int; v_max int; v_exp timestamptz; v_code text; s record;
begin
  if not public.can_issue_secure_document_grants() then
    perform public.vcc_log('grant_create', 'grant', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into s from public.vcc_settings where id;
  v_ttl := coalesce(public.vcc_int(p_input,'ttl_days'), s.grant_default_ttl_days);
  v_max := coalesce(s.grant_max_ttl_days, 30);
  if v_ttl < 1 or v_ttl > v_max then
    raise exception 'validation: مدّة المنحة يجب أن تكون بين يوم و% يومًا', v_max;
  end if;
  v_exp := now() + make_interval(days => v_ttl);
  v_code := 'GR-' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.vcc_grant_seq')::text, 4, '0');

  insert into public.vcc_document_grants(
    grant_code, request_id, recipient_org, recipient_name, recipient_email, recipient_email_note,
    purpose, starts_at, expires_at, max_opens, max_downloads, watermark_identity, note, created_by)
  values (v_code,
    nullif(public.vcc_txt(p_input,'request_id'),'')::uuid,
    public.vcc_txt(p_input,'recipient_org'), public.vcc_txt(p_input,'recipient_name'),
    public.vcc_txt(p_input,'recipient_email'),
    'بيانات وصفية فقط — لا يُرسَل من النظام أيّ بريد إلى هذا العنوان.',
    public.vcc_txt(p_input,'purpose'),
    coalesce(nullif(public.vcc_txt(p_input,'starts_at'),'')::timestamptz, now()),
    v_exp,
    coalesce(public.vcc_int(p_input,'max_opens'), s.grant_default_max_opens),
    coalesce(public.vcc_int(p_input,'max_downloads'), s.grant_default_max_downloads),
    coalesce(public.vcc_txt(p_input,'watermark_identity'),
             coalesce(public.vcc_txt(p_input,'recipient_org'),'') || ' · ' ||
             coalesce(public.vcc_txt(p_input,'recipient_name'),'')),
    public.vcc_txt(p_input,'note'), auth.uid())
  returning id into v_id;

  perform public.vcc_log('grant_create', 'grant', v_id, true,
    jsonb_build_object('recipient_org', public.vcc_txt(p_input,'recipient_org'), 'ttl_days', v_ttl));
  return jsonb_build_object('ok', true, 'id', v_id, 'grant_code', v_code, 'status', 'draft',
    'expires_at', v_exp,
    'note_ar', 'لم يُصدر رمز بعد. أضف الوثائق ثمّ اعتمِد ثمّ أصدِر.');
end $fn$;

create or replace function public.vcc_grant_add_document(
  p_grant uuid, p_document uuid, p_allow_download boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_issue_secure_document_grants() then raise exception 'not authorized'; end if;
  -- المُشغِّل vcc_grant_document_guard هو الحارس الفعليّ (موثَّقة · غير منتهية ·
  -- الحسّاسة تتطلّب طلبًا واعتمادًا). لا نكرّر منطقه هنا كي لا يتباعد التنفيذان.
  insert into public.vcc_grant_documents(grant_id, document_id, allow_download, added_by)
  values (p_grant, p_document, coalesce(p_allow_download,false), auth.uid())
  on conflict (grant_id, document_id) do update
    set allow_download = excluded.allow_download
  returning id into v_id;
  perform public.vcc_log('grant_add_document', 'grant', p_grant, true,
    jsonb_build_object('document', p_document, 'allow_download', coalesce(p_allow_download,false)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_grant_remove_document(p_grant uuid, p_document uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record;
begin
  if not public.can_issue_secure_document_grants() then raise exception 'not authorized'; end if;
  select * into g from public.vcc_document_grants where id = p_grant;
  if not found then raise exception 'not found'; end if;
  if g.status not in ('draft','pending_approval') then
    raise exception 'conflict: لا تُعدَّل قائمة وثائق منحة بعد اعتمادها';
  end if;
  delete from public.vcc_grant_documents where grant_id = p_grant and document_id = p_document;
  perform public.vcc_log('grant_remove_document', 'grant', p_grant, true,
    jsonb_build_object('document', p_document));
  return jsonb_build_object('ok', true);
end $fn$;

-- ★ الاعتماد فعل المالك ★ لا يُشتقّ من صلاحية الإصدار: من يُعدّ الرابط ليس من
--   يأذن به. (فصل الإعداد عن الإذن هو نفس مبدأ «الرافع لا يوثّق».)
create or replace function public.vcc_grant_approve(p_grant uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record; n int;
begin
  if not public.vcc_is_owner() then
    perform public.vcc_log('grant_approve', 'grant', p_grant, false, '{}'::jsonb);
    raise exception 'not authorized: اعتماد المنح للمالك أو المدير العامّ وحده';
  end if;
  select * into g from public.vcc_document_grants where id = p_grant for update;
  if not found then raise exception 'not found'; end if;
  if g.status not in ('draft','pending_approval') then
    raise exception 'conflict: حالة المنحة % لا تقبل الاعتماد', g.status;
  end if;
  select count(*) into n from public.vcc_grant_documents where grant_id = p_grant;
  if n = 0 then raise exception 'validation: لا تُعتمَد منحة بلا وثائق'; end if;
  if g.expires_at <= now() then raise exception 'conflict: انتهت نافذة المنحة قبل اعتمادها'; end if;

  update public.vcc_document_grants
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         approval_note = p_note, updated_at = now()
   where id = p_grant;

  perform public.vcc_log('grant_approve', 'grant', p_grant, true, jsonb_build_object('documents', n));
  return jsonb_build_object('ok', true, 'id', p_grant, 'status', 'approved', 'documents', n);
end $fn$;

-- ★★ الإصدار — المرّة **الوحيدة** التي يظهر فيها الرمز الخام ★★
--    يُعاد للمتصل مرّة واحدة ولا يُخزَّن. لا سطر في هذا الملفّ يكتب الرمز الخام
--    في أيّ جدول ولا يمرّره إلى أيّ قناة إرسال.
create or replace function public.vcc_grant_issue(p_grant uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record; v_token text; v_hash text;
begin
  if not public.can_issue_secure_document_grants() then
    perform public.vcc_log('grant_issue', 'grant', p_grant, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into g from public.vcc_document_grants where id = p_grant for update;
  if not found then raise exception 'not found'; end if;
  if g.status <> 'approved' then
    raise exception 'conflict: تُصدَر المنحة بعد الاعتماد فقط (الحالة الآن %)', g.status;
  end if;
  if g.token_hash is not null then
    raise exception 'conflict: صدر رمز لهذه المنحة سابقًا ولا يُعاد إظهاره. ألغِ المنحة وأنشئ غيرها.';
  end if;
  if g.expires_at <= now() then raise exception 'conflict: انتهت نافذة المنحة'; end if;

  -- ٢٥٦ بت عشوائية من مصدر النظام. gen_random_uuid() v4 ⇒ ١٢٢ بت لكلّ نصف.
  v_token := 'kvc_' || replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_hash  := encode(sha256(convert_to(v_token, 'utf8')), 'hex');

  update public.vcc_document_grants
     set token_hash = v_hash, token_hint = right(v_token, 6),
         token_issued_at = now(), token_issued_by = auth.uid(),
         status = 'active', updated_at = now()
   where id = p_grant;

  perform public.vcc_log('grant_issue', 'grant', p_grant, true,
    jsonb_build_object('recipient_org', g.recipient_org, 'expires_at', g.expires_at));

  return jsonb_build_object('ok', true, 'id', p_grant, 'status', 'active',
    'token', v_token, 'token_hint', right(v_token, 6), 'expires_at', g.expires_at,
    'share_state', 'ready_for_manual_sharing',
    'share_state_ar', 'جاهز للمشاركة اليدوية',
    -- ⛔ ولا سطر واحد في هذا النظام يرسل هذا الرابط.
    'note_ar', 'هذا الرمز يظهر مرّة واحدة فقط ولا يُخزَّن. انسخه الآن وسلّمه بنفسك. النظام لا يرسل بريدًا ولا رسالة.');
end $fn$;

create or replace function public.vcc_grant_revoke(p_grant uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare g record;
begin
  if not public.can_issue_secure_document_grants() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'validation: سبب الإلغاء إلزاميّ';
  end if;
  select * into g from public.vcc_document_grants where id = p_grant for update;
  if not found then raise exception 'not found'; end if;
  if g.status = 'revoked' then
    return jsonb_build_object('ok', true, 'id', p_grant, 'status', 'revoked', 'already', true);
  end if;

  update public.vcc_document_grants
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(),
         revoke_reason = p_reason, updated_at = now()
   where id = p_grant;

  perform public.vcc_log('grant_revoke', 'grant', p_grant, true, jsonb_build_object('reason', p_reason));
  perform public.vcc_emit('grant_revoked', 'grant', p_grant,
    jsonb_build_object('recipient_org', g.recipient_org),
    'compliance.grant_revoked:' || p_grant::text);
  return jsonb_build_object('ok', true, 'id', p_grant, 'status', 'revoked',
    'note_ar', 'الرمز توقّف فورًا. أيّ رابط منسوخ لدى المتلقّي لم يعد يفتح شيئًا.');
end $fn$;

create or replace function public.vcc_grant_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb; v_status text;
begin
  if not public.can_issue_secure_document_grants() then raise exception 'not authorized'; end if;
  v_status := public.vcc_txt(p_filters, 'status');
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', g.id, 'grant_code', g.grant_code, 'request_id', g.request_id,
      'recipient_org', g.recipient_org, 'recipient_name', g.recipient_name,
      'recipient_email', g.recipient_email, 'purpose', g.purpose,
      'status', case when g.status = 'active' and g.expires_at <= now() then 'expired' else g.status end,
      'starts_at', g.starts_at, 'expires_at', g.expires_at,
      'max_opens', g.max_opens, 'opens_used', g.opens_used,
      'max_downloads', g.max_downloads, 'downloads_used', g.downloads_used,
      'watermark_identity', g.watermark_identity,
      -- ⛔ token_hash لا يخرج أبدًا. التلميح آخر ٦ محارف للتمييز البصريّ فقط.
      'token_hint', g.token_hint, 'token_issued_at', g.token_issued_at,
      'approved_by', g.approved_by, 'approved_at', g.approved_at,
      'revoked_at', g.revoked_at, 'revoke_reason', g.revoke_reason,
      'documents', (select count(*) from public.vcc_grant_documents gd where gd.grant_id = g.id),
      'created_at', g.created_at) as x
      from public.vcc_document_grants g
     where (v_status is null or g.status = v_status)
  ) s;
  return jsonb_build_object('rows', v_rows, 'delivery_enabled', false,
    'note_ar', 'الروابط تُشارَك يدويًّا. لا إرسال من النظام.');
end $fn$;

create or replace function public.vcc_grant_audit(p_grant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb;
begin
  if not public.can_issue_secure_document_grants() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', l.at, 'action', l.action, 'document_id', l.document_id,
           'denied_reason', l.denied_reason, 'detail', l.detail) order by l.at desc), '[]'::jsonb)
    into v_rows from public.vcc_grant_access_log l where l.grant_id = p_grant;
  return jsonb_build_object('rows', v_rows,
    'note_ar', 'يشمل المحاولات المرفوضة عمدًا: سجلّ يحفظ النجاح وحده يجعل تخمين الرموز غير مرئيّ.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٥) ★★ استرداد المنحة — الدالّة الوحيدة التي يلمسها طرف خارجيّ ★★
--
--   ⚠️ **لا تُمنَح لـanon ولا لـauthenticated**. تُمنَح لـservice_role وحده،
--      وتُنادى من مسار خادم واحد يحمل المفتاح في الخادم لا في المتصفّح.
--      التسلسل هو شكل deliverable-download حرفيًّا:
--        (١) نوثّق أوّلًا هنا (بصمة الرمز → منحة → وثيقة بعينها)،
--        (٢) ثمّ يوقّع الخادم **ما أعادته هذه الدالّة** — لا ما أرسله المتصل،
--        (٣) بمهلة قصيرة، ولا يُعيد المسار إلى المتصفّح أبدًا.
--
--   ما تمنعه بنيويًّا:
--     • رمز غير موجود/خاطئ ⇒ نفس الرسالة العامّة لكلّ الحالات (لا نكشف إن كان
--       الرمز موجودًا وانتهى أم غير موجود أصلًا).
--     • وثيقة خارج المنحة ⇒ ترفض حتّى لو كان المعرّف صحيحًا.
--     • ⛔ لا فهرسة: لا استعلام يقرأ storage.objects، والوثائق تُعدّ من جدول
--       الربط وحده.
--     • حدود الفتح والتنزيل تُحتسب **قبل** إعادة أيّ مرجع.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_grant_open(
  p_token text, p_action text default 'open', p_document uuid default null,
  p_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  g record; d record; gd record; v_hash text; v_action text;
  v_deny text; v_docs jsonb; v_fp text;
begin
  v_action := lower(coalesce(nullif(btrim(coalesce(p_action,'')),''), 'open'));
  if v_action not in ('open','download') then v_action := 'open'; end if;
  v_fp := case when p_fingerprint ~ '^[0-9a-f]{64}$' then p_fingerprint else null end;

  if p_token is null or length(btrim(p_token)) < 32 then
    insert into public.vcc_grant_access_log(grant_id, action, denied_reason, client_fingerprint)
    values (null, 'denied', 'malformed_token', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  v_hash := encode(sha256(convert_to(btrim(p_token), 'utf8')), 'hex');
  select * into g from public.vcc_document_grants where token_hash = v_hash for update;

  if not found then
    -- ★ رسالة واحدة لكلّ فشل ★ التمييز بين «غير موجود» و«منتهٍ» يمنح المخمّن
    --   أوراكل يقلّص مساحة البحث.
    insert into public.vcc_grant_access_log(grant_id, action, denied_reason, client_fingerprint)
    values (null, 'denied', 'unknown_token', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  v_deny := null;
  if g.status = 'revoked' then v_deny := 'revoked';
  elsif g.status <> 'active' then v_deny := 'not_active';
  elsif now() < g.starts_at then v_deny := 'not_started';
  elsif now() >= g.expires_at then v_deny := 'expired';
  elsif g.opens_used >= g.max_opens then v_deny := 'open_limit_reached';
  elsif v_action = 'download' and g.max_downloads = 0 then v_deny := 'download_not_allowed';
  elsif v_action = 'download' and g.downloads_used >= g.max_downloads then v_deny := 'download_limit_reached';
  end if;

  if v_deny is not null then
    insert into public.vcc_grant_access_log(grant_id, action, denied_reason, client_fingerprint)
    values (g.id, 'denied', v_deny, v_fp);
    -- انتهاء النافذة يُثبَّت في الحالة كي لا تبقى المنحة تبدو «نشطة» في الشاشة.
    if v_deny = 'expired' and g.status = 'active' then
      update public.vcc_document_grants set status = 'expired', updated_at = now() where id = g.id;
    elsif v_deny in ('open_limit_reached','download_limit_reached') and g.status = 'active' then
      update public.vcc_document_grants set status = 'exhausted', updated_at = now() where id = g.id;
      perform public.vcc_emit('grant_exhausted', 'grant', g.id, '{}'::jsonb,
        'compliance.grant_exhausted:' || g.id::text);
    end if;
    return jsonb_build_object('ok', false,
      'reason', case when v_deny in ('download_limit_reached','download_not_allowed')
                     then v_deny else 'invalid_or_expired' end);
  end if;

  -- ─── فتح على مستوى المنحة: قائمة الوثائق المسموحة، بلا مسار تخزين ────────
  if v_action = 'open' and p_document is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'document_id', x.id, 'doc_type', x.doc_type,
             'label_ar', x.label_ar, 'title', x.title,
             'doc_language', x.doc_language, 'issued_on', x.issued_on, 'expires_on', x.expires_on,
             'allow_download', x.allow_download,
             -- ⛔ ولا مسار ولا bucket ولا اسم ملفّ داخليّ في هذه الاستجابة.
             'file_name', x.file_name) order by x.doc_type), '[]'::jsonb)
      into v_docs
      from (select d2.id, d2.doc_type, t.label_ar, d2.title, d2.doc_language,
                   d2.issued_on, d2.expires_on, gd2.allow_download, d2.file_name
              from public.vcc_grant_documents gd2
              join public.tvn_documents d2 on d2.id = gd2.document_id
              join public.tvn_document_types t on t.key = d2.doc_type
             where gd2.grant_id = g.id
               and d2.is_deleted = false and d2.verified = true and d2.doc_status = 'verified'
               and (d2.expires_on is null or d2.expires_on >= current_date)) x;

    update public.vcc_document_grants
       set opens_used = opens_used + 1, updated_at = now() where id = g.id;
    insert into public.vcc_grant_access_log(grant_id, action, client_fingerprint, detail)
    values (g.id, 'open', v_fp, jsonb_build_object('documents', jsonb_array_length(v_docs)));

    return jsonb_build_object('ok', true, 'action', 'open',
      'recipient_org', g.recipient_org, 'recipient_name', g.recipient_name,
      'purpose', g.purpose, 'expires_at', g.expires_at,
      'watermark_identity', g.watermark_identity,
      'opens_left', greatest(g.max_opens - (g.opens_used + 1), 0),
      'downloads_left', greatest(g.max_downloads - g.downloads_used, 0),
      'documents', v_docs);
  end if;

  -- ─── فتح/تنزيل وثيقة بعينها ──────────────────────────────────────────────
  if p_document is null then
    insert into public.vcc_grant_access_log(grant_id, action, denied_reason, client_fingerprint)
    values (g.id, 'denied', 'document_required', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'document_required');
  end if;

  -- ★ الوثيقة يجب أن تكون **داخل هذه المنحة** ★ لا وصول عرضيّ بمعرّف صحيح.
  select * into gd from public.vcc_grant_documents
   where grant_id = g.id and document_id = p_document;
  if not found then
    insert into public.vcc_grant_access_log(grant_id, document_id, action, denied_reason, client_fingerprint)
    values (g.id, p_document, 'denied', 'document_not_in_grant', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'not_in_grant');
  end if;

  -- ★ يُعاد فحص الوثيقة عند كلّ فتح ★ إلغاؤها أو انتهاؤها بعد الإصدار يوقفها
  --   فورًا، بلا حاجة لتعديل المنحة.
  select * into d from public.tvn_documents where id = p_document and is_deleted = false;
  if not found or not d.verified or d.doc_status <> 'verified'
     or (d.expires_on is not null and d.expires_on < current_date) then
    insert into public.vcc_grant_access_log(grant_id, document_id, action, denied_reason, client_fingerprint)
    values (g.id, p_document, 'denied', 'document_no_longer_valid', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'document_no_longer_valid');
  end if;
  if v_action = 'download' and not (gd.allow_download and d.is_downloadable) then
    insert into public.vcc_grant_access_log(grant_id, document_id, action, denied_reason, client_fingerprint)
    values (g.id, p_document, 'denied', 'download_not_allowed', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'download_not_allowed');
  end if;
  if d.storage_path is null then
    insert into public.vcc_grant_access_log(grant_id, document_id, action, denied_reason, client_fingerprint)
    values (g.id, p_document, 'denied', 'no_file', v_fp);
    return jsonb_build_object('ok', false, 'reason', 'no_file');
  end if;

  if v_action = 'download' then
    update public.vcc_document_grants
       set downloads_used = downloads_used + 1, updated_at = now() where id = g.id;
  else
    update public.vcc_document_grants
       set opens_used = opens_used + 1, updated_at = now() where id = g.id;
  end if;
  insert into public.vcc_grant_access_log(grant_id, document_id, action, client_fingerprint, detail)
  values (g.id, p_document, v_action, v_fp, jsonb_build_object('doc_type', d.doc_type));

  -- ★ المرجع يعود إلى **الخادم** فقط ★ الخادم يوقّعه بمهلة قصيرة ولا يعيده.
  return jsonb_build_object('ok', true, 'action', v_action,
    'document_id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name,
    'file_mime', d.file_mime,
    'watermark_required', d.watermark_required, 'watermark_identity', g.watermark_identity,
    'storage_bucket', d.storage_bucket, 'storage_path', d.storage_path,
    'server_only_note', 'storage_bucket/storage_path مخصّصان للخادم: لا يُعادان إلى المتصفّح ولا يُسجَّلان.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٦) طلبات التسجيل كمورّد — دورة حياة صريحة، والتقديم يدويّ دائمًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_registration_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_no text; v_src uuid;
begin
  if not public.can_manage_vendor_registration() then
    perform public.vcc_log('registration_upsert', 'registration', null, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  v_src := nullif(public.vcc_txt(p_input,'source_opportunity_request_id'),'')::uuid;

  -- المرجع إلى سطح الفرص **يُتحقّق منه ولا يُقرأ منه شيء**: لا نسخ تلقائيّ.
  if v_src is not null and to_regclass('public.opportunity_requests') is null then
    raise exception 'feature unavailable: سطح الفرص غير مثبَّت — لا يمكن ربط الطلب بمصدره';
  end if;

  if v_id is null then
    v_no := 'VR-' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.vcc_registration_seq')::text, 4, '0');
    insert into public.vcc_registration_requests(
      request_number, organization_name, organization_sector, contact_name, contact_email,
      contact_phone, purpose, required_doc_types, deadline, portal_reference, portal_name,
      notes, source, source_opportunity_request_id, assigned_to, priority, readiness_context, created_by, updated_by)
    values (v_no, public.vcc_txt(p_input,'organization_name'), public.vcc_txt(p_input,'organization_sector'),
      public.vcc_txt(p_input,'contact_name'), public.vcc_txt(p_input,'contact_email'),
      public.vcc_txt(p_input,'contact_phone'), public.vcc_txt(p_input,'purpose'),
      public.vcc_arr(p_input,'required_doc_types'),
      nullif(public.vcc_txt(p_input,'deadline'),'')::date,
      public.vcc_txt(p_input,'portal_reference'), public.vcc_txt(p_input,'portal_name'),
      public.vcc_txt(p_input,'notes'), coalesce(public.vcc_txt(p_input,'source'),'client_request'),
      v_src, nullif(public.vcc_txt(p_input,'assigned_to'),'')::uuid,
      coalesce(public.vcc_txt(p_input,'priority'),'normal'),
      coalesce(public.vcc_txt(p_input,'readiness_context'),'client_vendor_registration'),
      auth.uid(), auth.uid())
    returning id into v_id;

    -- قائمة تحقّق أوّلية من الأنواع المطلوبة — بنود وثائق **لا تُعلَّم يدويًّا**.
    insert into public.vcc_registration_checklist(request_id, item_kind, doc_type, label, is_mandatory, sort_order, created_by)
    select v_id, 'document', t.key, coalesce(nullif(t.label_ar,''), t.key), true,
           row_number() over (order by t.key), auth.uid()
      from public.tvn_document_types t
     where t.key = any (public.vcc_arr(p_input,'required_doc_types'));
  else
    update public.vcc_registration_requests set
      organization_name = coalesce(public.vcc_txt(p_input,'organization_name'), organization_name),
      organization_sector = coalesce(public.vcc_txt(p_input,'organization_sector'), organization_sector),
      contact_name  = coalesce(public.vcc_txt(p_input,'contact_name'), contact_name),
      contact_email = coalesce(public.vcc_txt(p_input,'contact_email'), contact_email),
      contact_phone = coalesce(public.vcc_txt(p_input,'contact_phone'), contact_phone),
      purpose       = coalesce(public.vcc_txt(p_input,'purpose'), purpose),
      required_doc_types = case when p_input ? 'required_doc_types'
                                then public.vcc_arr(p_input,'required_doc_types') else required_doc_types end,
      deadline      = coalesce(nullif(public.vcc_txt(p_input,'deadline'),'')::date, deadline),
      portal_reference = coalesce(public.vcc_txt(p_input,'portal_reference'), portal_reference),
      portal_name   = coalesce(public.vcc_txt(p_input,'portal_name'), portal_name),
      notes         = coalesce(public.vcc_txt(p_input,'notes'), notes),
      assigned_to   = coalesce(nullif(public.vcc_txt(p_input,'assigned_to'),'')::uuid, assigned_to),
      priority      = coalesce(public.vcc_txt(p_input,'priority'), priority),
      readiness_context = coalesce(public.vcc_txt(p_input,'readiness_context'), readiness_context),
      updated_by = auth.uid(), updated_at = now()
    where id = v_id and is_deleted = false;
    if not found then raise exception 'not found'; end if;
  end if;

  perform public.vcc_log('registration_upsert', 'registration', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ★ آلة الحالة ★ الانتقالات المسموحة صريحة، ولا قفزة إلى submitted_manually
--   بلا مرجع وقناة وفاعل — والقيد الجدوليّ يحرسها حتّى لو أُعيدت كتابة الدالّة.
create or replace function public.vcc_registration_transition(
  p_id uuid, p_status text, p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r record; v_ok boolean := false; v_allowed text[];
begin
  if not public.can_manage_vendor_registration() then
    perform public.vcc_log('registration_transition', 'registration', p_id, false, '{}'::jsonb);
    raise exception 'not authorized';
  end if;
  select * into r from public.vcc_registration_requests
   where id = p_id and is_deleted = false for update;
  if not found then raise exception 'not found'; end if;

  v_allowed := case r.status
    when 'received'                    then array['under_review','information_required','closed','expired']
    when 'under_review'                then array['information_required','preparing_documents','rejected','closed','expired']
    when 'information_required'        then array['under_review','preparing_documents','closed','expired']
    when 'preparing_documents'         then array['pending_owner_approval','information_required','closed','expired']
    when 'pending_owner_approval'      then array['ready_for_manual_submission','preparing_documents','closed','expired']
    when 'ready_for_manual_submission' then array['submitted_manually','preparing_documents','closed','expired']
    when 'submitted_manually'          then array['accepted','rejected','expired','closed']
    when 'accepted'                    then array['closed']
    when 'rejected'                    then array['closed']
    when 'expired'                     then array['closed']
    else array[]::text[] end;

  if not (v_allowed @> array[p_status]) then
    raise exception 'conflict: انتقال غير مسموح من % إلى %', r.status, p_status;
  end if;

  -- ★★ اعتماد المالك شرط للخروج من pending_owner_approval ★★
  if p_status = 'ready_for_manual_submission' then
    if not public.vcc_is_owner() then
      raise exception 'not authorized: اعتماد الجاهزية للتسليم للمالك وحده';
    end if;
  end if;

  update public.vcc_registration_requests set
    status = p_status,
    info_required_note = case when p_status = 'information_required'
                              then public.vcc_txt(p_input,'note') else info_required_note end,
    owner_approved_by = case when p_status = 'ready_for_manual_submission' then auth.uid() else owner_approved_by end,
    owner_approved_at = case when p_status = 'ready_for_manual_submission' then now() else owner_approved_at end,
    owner_approval_note = case when p_status = 'ready_for_manual_submission'
                               then public.vcc_txt(p_input,'note') else owner_approval_note end,
    -- ⛔ لا يملأ النظام هذه الحقول من تلقاء نفسه أبدًا.
    submitted_by = case when p_status = 'submitted_manually' then auth.uid() else submitted_by end,
    submitted_at = case when p_status = 'submitted_manually'
                        then coalesce(nullif(public.vcc_txt(p_input,'submitted_at'),'')::timestamptz, now())
                        else submitted_at end,
    submission_reference = case when p_status = 'submitted_manually'
                                then public.vcc_txt(p_input,'submission_reference') else submission_reference end,
    submission_channel = case when p_status = 'submitted_manually'
                              then public.vcc_txt(p_input,'submission_channel') else submission_channel end,
    decision_note = case when p_status in ('accepted','rejected')
                         then public.vcc_txt(p_input,'note') else decision_note end,
    close_reason = case when p_status in ('closed','rejected','expired')
                        then coalesce(public.vcc_txt(p_input,'note'), close_reason) else close_reason end,
    closed_by = case when p_status in ('closed','expired') then auth.uid() else closed_by end,
    closed_at = case when p_status in ('closed','expired') then now() else closed_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_id;

  perform public.vcc_log('registration_transition', 'registration', p_id, true,
    jsonb_build_object('from', r.status, 'to', p_status));

  if p_status = 'pending_owner_approval' then
    perform public.vcc_emit('registration_awaiting_owner_approval', 'registration', p_id,
      jsonb_build_object('organization', r.organization_name),
      'compliance.registration_awaiting_owner_approval:' || p_id::text || ':' || to_char(now(),'YYYY-MM-DD'));
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status,
    'note_ar', case when p_status = 'submitted_manually'
                    then 'سُجّل تسليم يدويّ بمرجع وقناة وفاعل. النظام لم يُقدّم شيئًا إلكترونيًّا.'
                    when p_status = 'ready_for_manual_submission'
                    then 'جاهز للتسليم اليدويّ. لا شيء يُرسَل تلقائيًّا.'
                    else null end);
end $fn$;

create or replace function public.vcc_registration_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare r record; v_chk jsonb; v_com jsonb; v_att jsonb; v_missing jsonb;
begin
  if not public.can_manage_vendor_registration() then raise exception 'not authorized'; end if;
  select * into r from public.vcc_registration_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'not found'; end if;

  -- ★ استيفاء بند الوثيقة مشتقّ من tvn_doc_valid ★ لا تعليم يدويّ، فلا يمكن
  --   أن يُعلَّم «تمّ» على وثيقة منتهية أو غير موثَّقة.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'item_kind', c.item_kind, 'doc_type', c.doc_type, 'label', c.label,
           'is_mandatory', c.is_mandatory,
           'satisfied', case when c.item_kind = 'document'
                             then public.tvn_doc_valid('company', null, c.doc_type)
                             else coalesce(c.satisfied_manual, false) end,
           'derived', c.item_kind = 'document',
           'satisfied_note', c.satisfied_note, 'sort_order', c.sort_order)
         order by c.sort_order, c.label), '[]'::jsonb)
    into v_chk from public.vcc_registration_checklist c where c.request_id = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'author_id', m.author_id, 'created_at', m.created_at)
         order by m.created_at desc), '[]'::jsonb)
    into v_com from public.vcc_registration_comments m where m.request_id = p_id;

  -- ⛔ بيانات المرفق الوصفية فقط. لا مسار تخزين في القراءة العامّة.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'file_name', a.file_name, 'file_mime', a.file_mime,
           'file_bytes', a.file_bytes, 'note', a.note,
           'uploaded_by', a.uploaded_by, 'uploaded_at', a.uploaded_at)
         order by a.uploaded_at desc), '[]'::jsonb)
    into v_att from public.vcc_registration_attachments a where a.request_id = p_id;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_missing
    from unnest(r.required_doc_types) t
   where not public.tvn_doc_valid('company', null, t);

  return jsonb_build_object(
    'request', to_jsonb(r), 'checklist', v_chk, 'comments', v_com, 'attachments', v_att,
    'missing_or_expired_doc_types', v_missing,
    'readiness', public.vcc_readiness(r.readiness_context),
    'note_ar', 'التقديم الإلكترونيّ لا يحدث من هنا. «سُلّم يدويًّا» يعني أنّ موظّفًا مخوّلًا سجّله بمرجع.');
end $fn$;

create or replace function public.vcc_registration_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb; v_status text;
begin
  if not public.can_manage_vendor_registration() then raise exception 'not authorized'; end if;
  v_status := public.vcc_txt(p_filters,'status');
  select coalesce(jsonb_agg(x order by x ->> 'deadline' nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', r.id, 'request_number', r.request_number, 'organization_name', r.organization_name,
      'organization_sector', r.organization_sector, 'status', r.status, 'priority', r.priority,
      'deadline', r.deadline,
      'days_to_deadline', case when r.deadline is null then null else (r.deadline - current_date) end,
      'assigned_to', r.assigned_to, 'source', r.source, 'portal_name', r.portal_name,
      'required_doc_types', r.required_doc_types,
      'missing_count', (select count(*) from unnest(r.required_doc_types) t
                         where not public.tvn_doc_valid('company', null, t)),
      'owner_approved_at', r.owner_approved_at, 'submitted_at', r.submitted_at,
      'created_at', r.created_at, 'updated_at', r.updated_at) as x
      from public.vcc_registration_requests r
     where r.is_deleted = false and (v_status is null or r.status = v_status)
  ) s;
  return jsonb_build_object('rows', v_rows);
end $fn$;

-- ★★ نافذة المبيعات ★★ خمسة حقول ولا شيء غيرها: لا وثيقة، ولا بنك، ولا مرجع
--    بوّابة، ولا ملاحظات داخلية، ولا بيانات تواصل. التضييق **بنيويّ** — لا
--    عمود حسّاس يمرّ من هنا أصلًا، فلا يعتمد المنع على تذكّر أحد.
create or replace function public.vcc_registration_status_board()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_rows jsonb;
begin
  if not public.vcc_can_view_request_status() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'request_number', r.request_number,
           'organization_name', r.organization_name,
           'status', r.status,
           'priority', r.priority,
           'deadline', r.deadline) order by r.deadline nulls last), '[]'::jsonb)
    into v_rows from public.vcc_registration_requests r where r.is_deleted = false;
  return jsonb_build_object('rows', v_rows, 'scope', 'status_only',
    'note_ar', 'حالة الطلبات فقط. الوثائق والبيانات المصرفية والمرفقات خارج هذه الشاشة تمامًا.');
end $fn$;

create or replace function public.vcc_checklist_upsert(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_kind text;
begin
  if not public.can_manage_vendor_registration() then raise exception 'not authorized'; end if;
  v_id := nullif(public.vcc_txt(p_input,'id'), '')::uuid;
  v_kind := coalesce(public.vcc_txt(p_input,'item_kind'), 'action');
  if v_id is null then
    insert into public.vcc_registration_checklist(request_id, item_kind, doc_type, label,
      is_mandatory, satisfied_manual, satisfied_note, sort_order, created_by)
    values (nullif(public.vcc_txt(p_input,'request_id'),'')::uuid, v_kind,
            public.vcc_txt(p_input,'doc_type'), public.vcc_txt(p_input,'label'),
            public.vcc_bool(p_input,'is_mandatory', true),
            -- ⛔ بند الوثيقة لا يقبل تعليمًا يدويًّا — القيد الجدوليّ يرفضه أيضًا.
            case when v_kind = 'document' then null else public.vcc_bool(p_input,'satisfied_manual') end,
            public.vcc_txt(p_input,'satisfied_note'),
            coalesce(public.vcc_int(p_input,'sort_order'), 0), auth.uid())
    returning id into v_id;
  else
    update public.vcc_registration_checklist set
      label = coalesce(public.vcc_txt(p_input,'label'), label),
      is_mandatory = case when p_input ? 'is_mandatory' then public.vcc_bool(p_input,'is_mandatory', is_mandatory) else is_mandatory end,
      satisfied_manual = case when item_kind = 'document' then null
                              when p_input ? 'satisfied_manual' then public.vcc_bool(p_input,'satisfied_manual')
                              else satisfied_manual end,
      satisfied_note = coalesce(public.vcc_txt(p_input,'satisfied_note'), satisfied_note),
      sort_order = coalesce(public.vcc_int(p_input,'sort_order'), sort_order)
    where id = v_id;
    if not found then raise exception 'not found'; end if;
  end if;
  perform public.vcc_log('checklist_upsert', 'registration', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_registration_comment(p_request uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_vendor_registration() then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_body,''))) = 0 then raise exception 'validation: التعليق فارغ'; end if;
  insert into public.vcc_registration_comments(request_id, body, author_id)
  values (p_request, p_body, auth.uid()) returning id into v_id;
  perform public.vcc_log('registration_comment', 'registration', p_request, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vcc_registration_attach(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if not public.can_manage_vendor_registration() then raise exception 'not authorized'; end if;
  insert into public.vcc_registration_attachments(request_id, file_name, file_mime, file_bytes,
    storage_path, checksum_sha256, note, uploaded_by)
  values (nullif(public.vcc_txt(p_input,'request_id'),'')::uuid,
          public.vcc_txt(p_input,'file_name'), public.vcc_txt(p_input,'file_mime'),
          nullif(public.vcc_txt(p_input,'file_bytes'),'')::bigint,
          public.vcc_txt(p_input,'storage_path'),
          lower(public.vcc_txt(p_input,'checksum_sha256')),
          public.vcc_txt(p_input,'note'), auth.uid())
  returning id into v_id;
  perform public.vcc_log('registration_attach', 'registration', v_id, true, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٧) المسح الدوريّ — ★ إدراج أحداث فقط. لا إرسال، ولا تفعيل قناة. ★
--    نوافذ ٩٠/٦٠/٣٠/٧ تُقرأ من مصدر واحد (tvn_settings.doc_reminder_days).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.vcc_scan_compliance(p_emit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_days int[]; r record; v_doc int := 0; v_reg int := 0; v_grant int := 0;
  v_expired_flipped int := 0; v_rows jsonb; v_ready jsonb;
begin
  if not (public.can_view_compliance_center() or public.can_verify_compliance_documents()) then
    raise exception 'not authorized';
  end if;
  v_days := public.vcc_reminder_days();

  -- (١) الوثائق المنتهية تُثبَّت في الحالة — ★ فعل مخوَّل ومُدقَّق ★ لا مشتقّ
  --     صامت: بقاء verified=true على وثيقة منتهية يجعل tvn_doc_valid تقول
  --     «سارية» في كلّ تقرير.
  if coalesce(p_emit, false) then
    if not public.can_verify_compliance_documents() then raise exception 'not authorized'; end if;
    update public.tvn_documents
       set verified = false, doc_status = 'expired',
           status_changed_by = auth.uid(), status_changed_at = now(), updated_at = now()
     where owner_kind = 'company' and is_deleted = false and doc_status = 'verified'
       and expires_on is not null and expires_on < current_date;
    get diagnostics v_expired_flipped = row_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'doc_type', d.doc_type, 'title', d.title, 'expires_on', d.expires_on,
           'days_left', (d.expires_on - current_date),
           'status', public.vcc_doc_effective_status(d.id),
           'bucket', case when d.expires_on < current_date then 'expired'
                          else (d.expires_on - current_date)::text end)
         order by d.expires_on), '[]'::jsonb) into v_rows
    from public.tvn_documents d
   where d.owner_kind = 'company' and d.is_deleted = false
     and d.doc_status not in ('archived','revoked','rejected')
     and d.expires_on is not null
     and (d.expires_on < current_date or (d.expires_on - current_date) = any (v_days));

  v_ready := public.vcc_readiness('general');

  if coalesce(p_emit, false) then
    for r in select d.id, d.expires_on, d.doc_type from public.tvn_documents d
              where d.owner_kind = 'company' and d.is_deleted = false
                and d.doc_status not in ('archived','revoked','rejected')
                and d.expires_on is not null
                and (d.expires_on < current_date or (d.expires_on - current_date) = any (v_days))
    loop
      perform public.vcc_emit(
        case when r.expires_on < current_date then 'document_expired' else 'document_expiring' end,
        'document', r.id, jsonb_build_object('doc_type', r.doc_type, 'expires_on', r.expires_on),
        'compliance.doc:' || r.id::text || ':' || r.expires_on::text || ':' ||
          case when r.expires_on < current_date then 'expired' else (r.expires_on - current_date)::text end);
      v_doc := v_doc + 1;
    end loop;

    for r in select g.id, g.expires_at from public.vcc_document_grants g
              where g.status = 'active' and g.expires_at > now()
                and g.expires_at <= now() + interval '2 days'
    loop
      perform public.vcc_emit('grant_expiring', 'grant', r.id,
        jsonb_build_object('expires_at', r.expires_at),
        'compliance.grant_expiring:' || r.id::text || ':' || to_char(now(),'YYYY-MM-DD'));
      v_grant := v_grant + 1;
    end loop;

    for r in select q.id, q.deadline, q.organization_name from public.vcc_registration_requests q
              where q.is_deleted = false and q.deadline is not null
                and q.status not in ('submitted_manually','accepted','rejected','expired','closed')
                and (q.deadline - current_date) = any (array[14,7,3,1,0])
    loop
      perform public.vcc_emit('registration_deadline_near', 'registration', r.id,
        jsonb_build_object('deadline', r.deadline, 'organization', r.organization_name),
        'compliance.registration_deadline_near:' || r.id::text || ':' || r.deadline::text);
      v_reg := v_reg + 1;
    end loop;

    if (v_ready ->> 'state') in ('incomplete','expired_blockers') then
      perform public.vcc_emit('readiness_degraded', 'company', null,
        jsonb_build_object('state', v_ready ->> 'state'),
        'compliance.readiness_degraded:' || (v_ready ->> 'state') || ':' || to_char(now(),'IYYY-IW'));
    end if;

    perform public.vcc_log('scan_compliance', null, null, true,
      jsonb_build_object('documents', v_doc, 'grants', v_grant, 'registrations', v_reg,
                         'expired_flipped', v_expired_flipped));
  end if;

  return jsonb_build_object(
    'reminder_days', v_days, 'expiring', v_rows, 'readiness', v_ready,
    'emitted', coalesce(p_emit,false),
    'documents_considered', v_doc, 'grants_considered', v_grant,
    'registrations_considered', v_reg, 'expired_documents_flipped', v_expired_flipped,
    'note_ar', 'أحداث مُدرَجة في مركز الاتصالات فقط. كلّ القنوات dry_run، ولا شيء يُرسَل من هنا.');
end $fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٨) التخزين — bucket واحد **خاصّ**، وسياساته تعكس حساسية الصفّ لا الاسم.
--
-- ⚠️ لماذا bucket جديد ولا نُعيد استخدام rental-private-documents؟ لأنّه مبوَّب
--    على civ_can_finance() OR civ_can_admin(). وضع الملفّ القانونيّ للشركة فيه
--    كان سيسلّم السجلّ القانونيّ كاملًا لكلّ من يحمل دور المالية.
-- ⚠️ ولا سياسة UPDATE ولا DELETE: الـbucket **إضافيّ فقط**. تبديل ملفّ تحت
--    مسار وثيقة موثَّقة كان سيُبقي «موثَّقة» على محتوى لم يره الموثِّق.
-- ════════════════════════════════════════════════════════════════════════════
do $bucket$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'VCC: schema storage غير موجود — تُخطّى إعدادات الـbucket (بيئة غير Supabase).';
    return;
  end if;
  execute $b$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('compliance-documents','compliance-documents', false, 20971520,
            array['application/pdf','image/jpeg','image/png','image/webp'])
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
  $b$;
end $bucket$;

-- المُساعد الذي يجعل سياسة التخزين تقرأ **حساسية الصفّ**: مسار وثيقة مقيَّدة
-- لا يُقرأ إلّا بمن يملك رؤية المقيَّد، ولو كان في الـbucket نفسه.
-- (نفس سابقة rental_evidence_is_owner: SECURITY DEFINER كي لا تدور RLS داخل RLS.)
create or replace function public.vcc_storage_readable(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare v_sens text; v_kind text;
begin
  if p_name is null then return false; end if;
  v_kind := split_part(p_name, '/', 1);

  -- مرفقات طلبات التسجيل: بوّابة التسجيل وحدها.
  if v_kind = 'registration' then
    return coalesce(public.can_manage_vendor_registration(), false);
  end if;

  select d.sensitivity into v_sens
    from public.tvn_documents d
   where d.storage_bucket = 'compliance-documents' and d.storage_path = p_name
     and d.is_deleted = false
   limit 1;

  -- ★ ملفّ بلا صفّ في السجلّ لا يُقرأ ★ لا فهرسة، ولا يتيم مقروء.
  if v_sens is null then return false; end if;

  if v_sens in ('confidential','restricted') then
    return coalesce(public.can_view_restricted_company_documents(), false);
  end if;
  return coalesce(public.can_view_compliance_center(), false);
exception when others then return false;
end $fn$;

do $sp$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "compliance documents read"  on storage.objects';
  execute 'drop policy if exists "compliance documents write" on storage.objects';
  execute $p$
    create policy "compliance documents read" on storage.objects for select to authenticated
      using (bucket_id = 'compliance-documents' and public.vcc_storage_readable(name))
  $p$;
  execute $p$
    create policy "compliance documents write" on storage.objects for insert to authenticated
      with check (bucket_id = 'compliance-documents'
                  and position('..' in name) = 0
                  and ((name like 'company/%' and public.can_manage_compliance_documents())
                    or (name like 'registration/%' and public.can_manage_vendor_registration())))
  $p$;
end $sp$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٩) RLS + الصلاحيات — قراءة عبر السياسات، وكتابة عبر RPC وحدها. لا anon.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['vcc_settings','vcc_company_profile','vcc_company_contacts',
                           'vcc_certifications','vcc_references','vcc_industry_experience',
                           'vcc_drone_capability','vcc_readiness_requirements',
                           'vcc_registration_requests','vcc_registration_checklist',
                           'vcc_registration_comments','vcc_registration_attachments',
                           'vcc_document_grants','vcc_grant_documents','vcc_grant_access_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    begin execute format('revoke all on public.%I from anon', t);
    exception when undefined_object then null; end;
    begin execute format('revoke all on public.%I from authenticated', t);
    exception when undefined_object then null; end;
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;

drop policy if exists vcc_settings_read on public.vcc_settings;
create policy vcc_settings_read on public.vcc_settings for select to authenticated
  using (public.can_view_compliance_center());

drop policy if exists vcc_company_read on public.vcc_company_profile;
create policy vcc_company_read on public.vcc_company_profile for select to authenticated
  using (public.can_view_compliance_center());

drop policy if exists vcc_contacts_read on public.vcc_company_contacts;
create policy vcc_contacts_read on public.vcc_company_contacts for select to authenticated
  using (public.can_view_compliance_center());

drop policy if exists vcc_cert_read on public.vcc_certifications;
create policy vcc_cert_read on public.vcc_certifications for select to authenticated
  using (public.can_view_compliance_center());

-- بيانات تواصل المراجع بيانات شخصية لطرف ثالث ⇒ أضيق من «رؤية المركز».
drop policy if exists vcc_refs_read on public.vcc_references;
create policy vcc_refs_read on public.vcc_references for select to authenticated
  using (coalesce(public.can_view_restricted_company_documents(), false));

drop policy if exists vcc_exp_read on public.vcc_industry_experience;
create policy vcc_exp_read on public.vcc_industry_experience for select to authenticated
  using (public.can_view_compliance_center());

drop policy if exists vcc_drone_read on public.vcc_drone_capability;
create policy vcc_drone_read on public.vcc_drone_capability for select to authenticated
  using (public.can_view_compliance_center());

drop policy if exists vcc_reqs_read on public.vcc_readiness_requirements;
create policy vcc_reqs_read on public.vcc_readiness_requirements for select to authenticated
  using (public.can_view_compliance_center());

-- ★ المبيعات لا تمرّ من هنا ★ سياسة الجدول تعطي الصفّ كاملًا، فهي محصورة في
--   إدارة التسجيل. شاشة الحالة للمبيعات تمرّ عبر RPC خمسة حقول (القسم ١٦).
drop policy if exists vcc_reg_read on public.vcc_registration_requests;
create policy vcc_reg_read on public.vcc_registration_requests for select to authenticated
  using (public.can_manage_vendor_registration());

drop policy if exists vcc_chk_read on public.vcc_registration_checklist;
create policy vcc_chk_read on public.vcc_registration_checklist for select to authenticated
  using (public.can_manage_vendor_registration());

drop policy if exists vcc_com_read on public.vcc_registration_comments;
create policy vcc_com_read on public.vcc_registration_comments for select to authenticated
  using (public.can_manage_vendor_registration());

drop policy if exists vcc_att_read on public.vcc_registration_attachments;
create policy vcc_att_read on public.vcc_registration_attachments for select to authenticated
  using (public.can_manage_vendor_registration());

drop policy if exists vcc_grants_read on public.vcc_document_grants;
create policy vcc_grants_read on public.vcc_document_grants for select to authenticated
  using (public.can_issue_secure_document_grants());

drop policy if exists vcc_grantdocs_read on public.vcc_grant_documents;
create policy vcc_grantdocs_read on public.vcc_grant_documents for select to authenticated
  using (public.can_issue_secure_document_grants());

drop policy if exists vcc_access_read on public.vcc_grant_access_log;
create policy vcc_access_read on public.vcc_grant_access_log for select to authenticated
  using (public.vcc_is_owner() or public.can_issue_secure_document_grants());

-- صلاحيات التنفيذ. تقسيم ثلاثيّ مقصود:
--   • واجهة authenticated — كلّ دالّة فيها تفحص بوّابتها بنفسها.
--   • دوالّ داخلية — ★ لا تُمنَح لأحد ★ SECURITY DEFINER بلا بوّابة داخلية.
--   • vcc_grant_open — ★ service_role وحده ★ ولا تُمنَح لـanon ولا authenticated.
do $grants$
declare f text;
begin
  foreach f in array array[
    'vcc_access()','vcc_company_get()','vcc_company_set(jsonb)','vcc_contact_upsert(jsonb)',
    'vcc_certification_upsert(jsonb)','vcc_reference_upsert(jsonb)','vcc_experience_upsert(jsonb)',
    'vcc_drone_upsert(jsonb)','vcc_document_register(jsonb)','vcc_document_decide(uuid,text,text)',
    'vcc_document_set_status(uuid,text,text)','vcc_document_list(jsonb)',
    'vcc_document_storage_ref(uuid)','vcc_readiness(text)',
    'vcc_grant_create(jsonb)','vcc_grant_add_document(uuid,uuid,boolean)',
    'vcc_grant_remove_document(uuid,uuid)','vcc_grant_approve(uuid,text)','vcc_grant_issue(uuid)',
    'vcc_grant_revoke(uuid,text)','vcc_grant_list(jsonb)','vcc_grant_audit(uuid)',
    'vcc_registration_upsert(jsonb)','vcc_registration_transition(uuid,text,jsonb)',
    'vcc_registration_get(uuid)','vcc_registration_list(jsonb)','vcc_registration_status_board()',
    'vcc_checklist_upsert(jsonb)','vcc_registration_comment(uuid,text)',
    'vcc_registration_attach(jsonb)','vcc_scan_compliance(boolean)',
    'vcc_doc_effective_status(uuid)',
    'can_view_compliance_center()','can_manage_compliance_documents()',
    'can_verify_compliance_documents()','can_issue_secure_document_grants()',
    'can_view_restricted_company_documents()','can_manage_vendor_registration()',
    'vcc_can_view_request_status()','vcc_can_view_operational_documents()']
  loop
    execute format('revoke all on function public.%s from public', f);
    begin execute format('revoke all on function public.%s from anon', f); exception when undefined_object then null; end;
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  foreach f in array array[
    'vcc_perm(text)','vcc_is_staff()','vcc_is_owner()','vcc_log(text,text,uuid,boolean,jsonb)',
    'vcc_emit(text,text,uuid,jsonb,text)','vcc_event_keys()','vcc_reminder_days()',
    'vcc_txt(jsonb,text)','vcc_int(jsonb,text)','vcc_bool(jsonb,text,boolean)','vcc_arr(jsonb,text)',
    'vcc_document_normalize()','vcc_grant_document_guard()','vcc_storage_readable(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    begin execute format('revoke all on function public.%s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function public.%s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- ★★ الاسترداد الخارجيّ ★★ لا anon ولا authenticated. مسار خادم واحد فقط.
  execute 'revoke all on function public.vcc_grant_open(text,text,uuid,text) from public';
  begin execute 'revoke all on function public.vcc_grant_open(text,text,uuid,text) from anon';
  exception when undefined_object then null; end;
  begin execute 'revoke all on function public.vcc_grant_open(text,text,uuid,text) from authenticated';
  exception when undefined_object then null; end;
  begin execute 'grant execute on function public.vcc_grant_open(text,text,uuid,text) to service_role';
  exception when undefined_object then
    raise notice 'VCC: الدور service_role غير موجود — vcc_grant_open تبقى بلا صلاحية تنفيذ لأحد (fail-closed).';
  end;
end $grants$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢٠) SELF-TEST — ★ ساكن بالكامل ★
-- لا استدعاء لدالّة محميّة: المحرّر يعمل بدور postgres و auth.uid() = NULL،
-- فاستدعاء بوّابة حيّة يرفع «not authorized» ويُسقط الترحيلة. كلّ تأكيد يقرأ
-- **تعريف** الكائن أو الكتالوج. ولا مصيدة catch-all: كلّ سطر قادر على الفشل.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare d text; n int; t text;
begin
  -- (١) الجداول الجديدة موجودة، والسجلّ القديم لم يُستنسخ.
  foreach t in array array['vcc_settings','vcc_company_profile','vcc_company_contacts',
                           'vcc_certifications','vcc_references','vcc_industry_experience',
                           'vcc_drone_capability','vcc_readiness_requirements',
                           'vcc_registration_requests','vcc_registration_checklist',
                           'vcc_registration_comments','vcc_registration_attachments',
                           'vcc_document_grants','vcc_grant_documents','vcc_grant_access_log']
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'SELF-TEST: الجدول % مفقود', t;
    end if;
  end loop;

  -- (٢) ★ سجلّ وثائق واحد ★ لا جدول وثائق ثالث بأيّ اسم.
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('vcc_documents','vcc_company_documents','compliance_documents');
  if n > 0 then raise exception 'SELF-TEST: أُنشئ سجلّ وثائق ثانٍ — الوحدة تُوسّع tvn_documents ولا تستنسخه'; end if;

  -- (٣) owner_kind يشمل company، والمالك الواحد ما زال مضمونًا.
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_owner_kind_v2'
     and pg_get_constraintdef(oid) ilike '%company%';
  if n <> 1 then raise exception 'SELF-TEST: owner_kind لا يقبل company'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_owner_exact';
  if n <> 1 then raise exception 'SELF-TEST: قيد المالك الواحد مفقود'; end if;

  -- (٤) ★★ الـbucket مثبَّت والمسار مقيَّد — أوراكل القراءة العابر مغلق ★★
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_bucket_pinned'
     and pg_get_constraintdef(oid) ilike '%compliance-documents%';
  if n <> 1 then raise exception 'SELF-TEST: storage_bucket غير مثبَّت — تعود ثغرة الإشارة إلى bucket آخر'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_path_shape';
  if n <> 1 then raise exception 'SELF-TEST: نمط مسار التخزين غير مقيَّد'; end if;

  -- (٥) ★ الرفع ليس توثيقًا ★ verified مستحيل خارج حالة verified، والقيد
  --     القديم «الرافع لا يوثّق» ما زال قائمًا.
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_verified_iff_status';
  if n <> 1 then raise exception 'SELF-TEST: يمكن أن تبقى وثيقة موثَّقة وهي مؤرشفة أو ملغاة'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_verify_not_self';
  if n <> 1 then raise exception 'SELF-TEST: قيد منع التوثيق الذاتيّ اختفى'; end if;
  d := pg_get_functiondef(to_regprocedure('public.vcc_document_decide(uuid,text,text)'));
  if d not ilike '%uploaded_by%' then raise exception 'SELF-TEST: دالّة التوثيق لا تفحص الرافع'; end if;
  if d not ilike '%can_verify_compliance_documents%' then
    raise exception 'SELF-TEST: التوثيق ليس خلف بوّابة التوثيق';
  end if;

  -- (٦) ★ الرقم الكامل لا يُخزَّن ★ لوثائق الشركة، والمُقنَّع بلا خمسة أرقام.
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_company_no_raw_number';
  if n <> 1 then raise exception 'SELF-TEST: لا قيد يمنع تخزين رقم الوثيقة الكامل للشركة'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.tvn_documents'::regclass and conname = 'tvn_doc_masked_number';
  if n <> 1 then raise exception 'SELF-TEST: التقنيع غير مضمون بقيد'; end if;

  -- (٧) ★★ الرمز بصمةً فقط ★★ لا عمود يحمل رمزًا خامًّا.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'vcc_document_grants'
     and column_name in ('token','raw_token','token_plain','secret');
  if n > 0 then raise exception 'SELF-TEST: عمود يحمل الرمز الخام في جدول المنح'; end if;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'vcc_document_grants' and column_name = 'token_hash';
  if n <> 1 then raise exception 'SELF-TEST: لا عمود بصمة للرمز'; end if;
  d := pg_get_functiondef(to_regprocedure('public.vcc_grant_issue(uuid)'));
  if d not ilike '%sha256%' then raise exception 'SELF-TEST: الرمز لا يُهشَّم'; end if;
  if d ilike '%insert into public.vcc_document_grants%' or d ilike '%set token = %' then
    raise exception 'SELF-TEST: مسار الإصدار قد يكتب الرمز الخام';
  end if;
  if d not ilike '%جاهز للمشاركة اليدوية%' then
    raise exception 'SELF-TEST: الإصدار لا يعلن أنّ المشاركة يدوية';
  end if;

  -- (٨) ★ الاسترداد يفحص النافذة والحدود والإلغاء وانتماء الوثيقة ★
  d := pg_get_functiondef(to_regprocedure('public.vcc_grant_open(text,text,uuid,text)'));
  foreach t in array array['revoked','expired','open_limit_reached','download_limit_reached',
                           'document_not_in_grant','document_no_longer_valid']
  loop
    if d not ilike '%' || t || '%' then
      raise exception 'SELF-TEST: الاسترداد لا يغطّي الحالة %', t;
    end if;
  end loop;
  if d not ilike '%invalid_or_expired%' then
    raise exception 'SELF-TEST: الاسترداد يميّز بين «غير موجود» و«منتهٍ» — أوراكل تخمين';
  end if;
  if d ilike '%storage.objects%' then
    raise exception 'SELF-TEST: الاسترداد يقرأ التخزين مباشرةً — احتمال فهرسة مجلَّد';
  end if;

  -- (٩) ★★ vcc_grant_open ليست منفَّذة من anon ولا authenticated ★★
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', to_regprocedure('public.vcc_grant_open(text,text,uuid,text)'), 'EXECUTE') then
      raise exception 'SELF-TEST: anon تستطيع استرداد المنح';
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_function_privilege('authenticated', to_regprocedure('public.vcc_grant_open(text,text,uuid,text)'), 'EXECUTE') then
      raise exception 'SELF-TEST: authenticated تستطيع استرداد المنح مباشرةً — يجب أن تمرّ بمسار الخادم';
    end if;
  end if;

  -- (١٠) ★ الحسّاس مربوط بطلب واعتماد ★ في حارس الجدول لا في الدالّة وحدها.
  select count(*) into n from pg_trigger
   where tgrelid = 'public.vcc_grant_documents'::regclass and tgname = 'trg_vcc_grant_document_guard';
  if n <> 1 then raise exception 'SELF-TEST: حارس وثائق المنحة مفقود'; end if;
  d := pg_get_functiondef(to_regprocedure('public.vcc_grant_document_guard()'));
  if d not ilike '%request_id is null%' or d not ilike '%approved_by is null%' then
    raise exception 'SELF-TEST: المنحة الحسّاسة لا تشترط طلبًا واعتمادًا';
  end if;
  if d not ilike '%غير موثَّقة%' then
    raise exception 'SELF-TEST: يمكن مشاركة وثيقة غير موثَّقة';
  end if;

  -- (١١) ★ لا ادّعاء تقديم إلكترونيّ ★
  select count(*) into n from pg_constraint
   where conrelid = 'public.vcc_registration_requests'::regclass
     and conname = 'vcc_reg_manual_submission_proof';
  if n <> 1 then raise exception 'SELF-TEST: يمكن ادّعاء تقديم يدويّ بلا مرجع ولا فاعل'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.vcc_registration_requests'::regclass
     and conname = 'vcc_reg_owner_approval_proof';
  if n <> 1 then raise exception 'SELF-TEST: يمكن بلوغ «جاهز للتسليم» بلا اعتماد المالك'; end if;

  -- (١٢) ★ بند الوثيقة لا يُعلَّم يدويًّا ★
  select count(*) into n from pg_constraint
   where conrelid = 'public.vcc_registration_checklist'::regclass
     and conname = 'vcc_chk_document_not_manual';
  if n <> 1 then raise exception 'SELF-TEST: يمكن تعليم بند وثيقة يدويًّا فوق وثيقة منتهية'; end if;
  d := pg_get_functiondef(to_regprocedure('public.vcc_registration_get(uuid)'));
  if d not ilike '%tvn_doc_valid%' then
    raise exception 'SELF-TEST: قائمة التحقّق لا تشتقّ الاستيفاء من التعريف الواحد للصلاحية';
  end if;

  -- (١٣) ★ الجاهزية قواعديّة ومفسَّرة، وتقيس بـtvn_doc_valid لا بتعريف ثانٍ ★
  d := pg_get_functiondef(to_regprocedure('public.vcc_readiness(text)'));
  if d not ilike '%rule_based%' then raise exception 'SELF-TEST: محرّك الجاهزية لا يصرّح بأنّه قاعديّ'; end if;
  if d not ilike '%tvn_doc_valid%' then raise exception 'SELF-TEST: الجاهزية تعيد تعريف الصلاحية بدل استعمال tvn_doc_valid'; end if;
  foreach t in array array['not_configured','expired_blockers','incomplete','ready_with_warnings','ready']
  loop
    if d not ilike '%' || t || '%' then raise exception 'SELF-TEST: حالة الجاهزية % مفقودة', t; end if;
  end loop;
  if d not ilike '%reason_ar%' then raise exception 'SELF-TEST: الجاهزية بلا سبب مقروء لكلّ متطلَّب'; end if;

  -- (١٣ب) ★★ التعريف الواحد للصلاحية وُسّع ولم يُفرَّع ★★
  --   الفروع الثلاثة القديمة موجودة حرفيًّا، وفرع الشركة أُضيف، والحارس القديم
  --   ما زال يمنع المعرّف الفارغ لغير الشركة.
  d := pg_get_functiondef(to_regprocedure('public.tvn_doc_valid(text,uuid,text)'));
  foreach t in array array['d.profile_id = p_owner_id','d.vendor_id  = p_owner_id',
                           'd.asset_id   = p_owner_id']
  loop
    if d not ilike '%' || t || '%' then
      raise exception 'SELF-TEST: توسعة tvn_doc_valid أسقطت الفرع %', t;
    end if;
  end loop;
  if d not ilike '%p_owner_kind = ''company''%' then
    raise exception 'SELF-TEST: tvn_doc_valid بلا فرع company ⇒ كلّ وثيقة شركة تُقرأ غير صالحة';
  end if;
  if d not ilike '%p_owner_id is null and coalesce(p_owner_kind%' then
    raise exception 'SELF-TEST: الحارس القديم (معرّف فارغ ⇒ false) لم يُحفَظ لغير الشركة';
  end if;
  if d not ilike '%verified = true%' or d not ilike '%expires_on%' then
    raise exception 'SELF-TEST: الصلاحية لم تعد «موثَّقة وغير منتهية»';
  end if;

  -- (١٤) ★ المبيعات: حالة فقط ★ الدالّة لا تلمس عمودًا حسّاسًا.
  d := pg_get_functiondef(to_regprocedure('public.vcc_registration_status_board()'));
  foreach t in array array['portal_reference','notes','contact_email','contact_phone',
                           'submission_reference','info_required_note']
  loop
    if d ilike '%' || t || '%' then
      raise exception 'SELF-TEST: شاشة حالة المبيعات تكشف الحقل %', t;
    end if;
  end loop;

  -- (١٥) ★ لا إرسال ★ ولا لمس لإعدادات القنوات من هذا الملفّ.
  d := pg_get_functiondef(to_regprocedure('public.vcc_emit(text,text,uuid,jsonb,text)'));
  if d ilike '%comms_channel_set%' or d ilike '%dry_run%' then
    raise exception 'SELF-TEST: مسار الأحداث يلمس إعدادات القنوات';
  end if;
  if d not ilike '%idempotency_key%' then raise exception 'SELF-TEST: الأحداث بلا منع تكرار'; end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'vcc\_%'
     and pg_get_functiondef(p.oid) ilike '%comms_channel_set%';
  if n > 0 then raise exception 'SELF-TEST: دالّة في الوحدة تفعّل قناة إرسال'; end if;

  -- (١٦) كلّ المُسنَدات الثمانية تعيد boolean ولا تعيد NULL.
  foreach t in array array['can_view_compliance_center()','can_manage_compliance_documents()',
                           'can_verify_compliance_documents()','can_issue_secure_document_grants()',
                           'can_view_restricted_company_documents()','can_manage_vendor_registration()',
                           'vcc_can_view_request_status()','vcc_can_view_operational_documents()',
                           'vcc_perm(text)','vcc_storage_readable(text)']
  loop
    if (select p.prorettype <> 'boolean'::regtype from pg_proc p
         where p.oid = to_regprocedure('public.' || t)) then
      raise exception 'SELF-TEST: المُسنَد % لا يعيد boolean', t;
    end if;
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d not ilike '%coalesce%' and d not ilike '%return false%' then
      raise exception 'SELF-TEST: المُسنَد % قد يعيد NULL', t;
    end if;
    -- ⛔ لا يُبنى مُسنَد على البوّابات الفضفاضة الممنوعة.
    if d ilike '%can_manage_projects%' or d ilike '%is_kian_member%' then
      raise exception 'SELF-TEST: المُسنَد % مبنيّ على بوّابة فضفاضة ممنوعة', t;
    end if;
  end loop;

  -- (١٧) لا صلاحية anon على أيّ جدول من الوحدة، ولا سياسة كتابة مباشرة.
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and table_name like 'vcc\_%';
  if n > 0 then raise exception 'SELF-TEST: توجد صلاحية anon على جداول الوحدة'; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename like 'vcc\_%' and cmd <> 'SELECT';
  if n > 0 then raise exception 'SELF-TEST: سياسة كتابة مباشرة موجودة — الكتابة عبر RPC وحدها'; end if;

  -- (١٨) الـbucket خاصّ، ولا سياسة تعديل أو حذف عليه.
  if to_regclass('storage.buckets') is not null then
    execute 'select count(*) from storage.buckets where id = ''compliance-documents'' and public = true' into n;
    if n > 0 then raise exception 'SELF-TEST: bucket الامتثال عامّ — لا يجوز'; end if;
    execute 'select count(*) from pg_policies where schemaname = ''storage'' and tablename = ''objects'''
         || ' and policyname like ''compliance documents%'' and cmd not in (''SELECT'',''INSERT'')' into n;
    if n > 0 then raise exception 'SELF-TEST: سياسة تعديل أو حذف على bucket الامتثال — يجوز الإضافة والقراءة فقط'; end if;
  end if;

  -- (١٩) الدوالّ الداخلية غير قابلة للتنفيذ من العميل.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach t in array array['vcc_emit(text,text,uuid,jsonb,text)','vcc_log(text,text,uuid,boolean,jsonb)',
                             'vcc_storage_readable(text)','vcc_perm(text)']
    loop
      if has_function_privilege('authenticated', to_regprocedure('public.' || t), 'EXECUTE') then
        raise exception 'SELF-TEST: الدالّة الداخلية % منفَّذة من authenticated', t;
      end if;
    end loop;
  end if;

  -- (٢٠) ★ لا عمود يغري بتخزين رقم حساب ★ في ملفّ الشركة.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'vcc_company_profile'
     and column_name in ('iban','account_number','bank_account','swift');
  if n > 0 then raise exception 'SELF-TEST: عمود بيانات مصرفية كاملة في ملفّ الشركة'; end if;

  -- (٢١) القائمة لا تُعيد مسار تخزين أبدًا.
  d := pg_get_functiondef(to_regprocedure('public.vcc_document_list(jsonb)'));
  if d ilike '%''storage_path''%' or d ilike '%''storage_bucket''%' then
    raise exception 'SELF-TEST: قائمة الوثائق تُعيد مرجع تخزين';
  end if;

  raise notice 'VENDOR COMPLIANCE SELF-TEST: كلّ التأكيدات مرّت.';
end $st$;

commit;

notify pgrst, 'reload schema';
