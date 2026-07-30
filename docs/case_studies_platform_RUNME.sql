-- ════════════════════════════════════════════════════════════════════════════
-- docs/case_studies_platform_RUNME.sql
-- المراحل ٦–١٠ — منصّة دراسات الحالة (المحتوى العامّ المعتمَد).
--
-- معاملة واحدة · idempotent · لا CONCURRENTLY · SECURITY DEFINER مع search_path
-- مثبَّت · كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا.
--
-- ─── ★ ما أُعيد استخدامه وما أُنشئ — يُقرأ قبل أيّ شيء ★ ────────────────────
--  أُعيد استخدامه (ولم يُكرَّر):
--   • is_staff() / is_owner() / is_admin() — بوّابات الهوية القائمة.
--   • permissions + emp_has_permission(uuid,text) — كتالوج الصلاحيات المشترك.
--     ثلاثة مفاتيح فقط تُزرَع: case_study.view / .edit / .review.
--     ⛔ **لا مفتاح للنشر إطلاقًا.** النشر النهائيّ ملكيّ بنيويًّا: لو وُجد
--     مفتاح لمُنح يومًا ثمّ نُسي. can_publish_case_studies() = is_owner() فقط.
--   • lib/clients.ts — أسماء العملاء وشعاراتهم على القرص. دراسة الحالة تحمل
--     client_slug يشير إليها، فلا يصير اسم العميل مصدرًا رابعًا للحقيقة.
--   • components/Portfolio.tsx — شبكة الأعمال القائمة **تبقى كما هي**. هذه
--     المنصّة سطح **ثانٍ مؤلَّف يدويًّا**، لا بديل عنها ولا نسخة منها.
--
--  أُنشئ، ولماذا لم يكن هناك مكان يحمله:
--   • cs_* بالكامل. تدقيق docs/EXTERNAL_CONTENT_CURRENT_STATE_AUDIT.md §1.3
--     عدّ ٣١٩ جدولًا ولم يجد case_stud/portfolio_item/publication/testimonial.
--     لا يوجد بيت لدراسة حالة، فإنشاؤها صحيح ولا يُزاحم أحدًا.
--   • ⛔ **لم يُنشأ سجلّ وثائق ثالث.** tvn_documents و hr_employee_documents
--     يكفيان. هذه الحزمة لا تلمس أيًّا منهما ولا تقرأ منهما حرفًا.
--
-- ─── ★ التجميد ★ ────────────────────────────────────────────────────────────
--   منصّة المشاريع مجمَّدة. cs_case_studies.project_id مرجع **اختياريّ
--   للقراءة الداخلية فقط، بلا مفتاح أجنبيّ**، ولا يظهر في أيّ مخرَج عامّ.
--   ⛔ ولا نسخ تلقائيّ: لا مُشغِّل ولا دالّة تقرأ projects/project_core/
--   deliverables. كلّ حقل عامّ يُكتب أو يُعتمد يدويًّا. اختبار
--   tests/case_study_no_project_copy.test.js يفشل إن ظهر أيّ منها في أيّ دالّة.
--
-- ─── ★ ما يجعله الخادم مستحيلًا (لا مجرّد مخفيّ في الواجهة) ★ ───────────────
--   ثلاث طبقات مستقلّة، كلّ واحدة كافية وحدها:
--     ط١ — cs_publish_blockers(): دوالّ النشر ترفض عند وجود أيّ مانع.
--     ط٢ — مُشغِّل cs_guard_publish على الجدول: أيّ UPDATE يضع الحالة
--          published/scheduled يُعيد فحص الموانع ويرفع استثناء. حتّى كتابة
--          مباشرة لا تمرّ.
--     ط٣ — cs_public_row(): الإسقاط العامّ يُعيد تطبيق الأقنعة **من الحالة
--          الحيّة** لا من اللقطة. سحب إذن بعد النشر يُخفي الاسم فورًا.
--   المستحيلات المنصوص عليها:
--     • اسم عميل بلا إذن — قناع حيّ + مانع + مُشغِّل.
--     • شعار بلا إذن — قناع حيّ (والشعار اسم، فيُشترط إذن الاسم أيضًا).
--     • تكلفة أو هامش — **لا عمود بهذا المعنى موجود أصلًا** في أيّ جدول cs_،
--       والإسقاط العامّ قائمة أعمدة صريحة لا select *. POSTCHECK يثبت الغياب.
--     • اسم موظّف بلا موافقة — cs_credits.consent_public، والموافقة نفسها
--       تشترط مرجعًا موثَّقًا بقيد، والإسقاط يقرأ الموافقة الحيّة بالمعرّف.
--     • وثيقة داخلية أو مسار تخزين أو رابط معاينة — قيد يمنع أسماء الدلاء
--       العشرة الخاصّة وروابط sign/token في cs_media.public_url، والإسقاط لا
--       يعيد أيّ عمود مسار.
--     • تسليمات المشروع الداخلية — لا قراءة من deliverables إطلاقًا.
--
-- ─── ★ لا تعديل صامت بعد النشر ★ ────────────────────────────────────────────
--   العامّ يُقرأ من **لقطة النسخة المنشورة** (cs_versions.snapshot) لا من الصفّ
--   الحيّ. تحرير دراسة منشورة يفتح نسخة جديدة ويرفع has_unapproved_changes،
--   ولا يظهر شيء للعامّة حتّى يعتمدها المالك وينشرها. والتراجع يُنشئ **نسخة
--   جديدة** ولا يحذف تاريخًا: cs_versions غير قابلة للتعديل ولا للحذف بمُشغِّل.
--
-- ─── ★ الوسائط ★ ────────────────────────────────────────────────────────────
--   مشتقّات عامّة فقط. لا دلو عامّ جديد في هذه الحزمة: القيمة الافتراضية أن
--   تكون الأصول ملفّات مستودع تحت /public. أنظر
--   docs/PUBLIC_MEDIA_SECURITY_CONTRACT.md.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT صلب: يوقف التشغيل قبل كتابة حرف واحد ────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('auth.users') is null then miss := miss || ' auth.users'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;

  -- نوع الإرجاع يُفحَص أيضًا: بوّابة تعيد غير boolean تُنتج سياسات معناها
  -- «غير محدَّد»، وغير المحدَّد ليس منعًا.
  if to_regprocedure('public.is_staff()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.is_staff()'))
  then miss := miss || ' is_staff()=غير-boolean'; end if;
  if to_regprocedure('public.is_owner()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.is_owner()'))
  then miss := miss || ' is_owner()=غير-boolean'; end if;
  if to_regprocedure('public.is_admin()') is not null
     and (select p.prorettype <> 'boolean'::regtype from pg_proc p
           where p.oid = to_regprocedure('public.is_admin()'))
  then miss := miss || ' is_admin()=غير-boolean'; end if;

  if miss <> '' then
    raise exception 'CASE STUDIES PREFLIGHT FAILED — اعتماديات مفقودة أو بنوع خاطئ:%. شغّل docs/case_studies_platform_PREFLIGHT.sql واقرأ عمود verdict قبل المحاولة ثانيةً.', miss;
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- ١) الإعدادات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_settings (
  id                              boolean primary key default true check (id),
  -- ★ المفتاح الرئيسيّ للسطح العامّ. false افتراضًا: الكود يسبق الـSQL،
  --   والـSQL يسبق النشر. الصفحة العامّة تُخفي القسم حتّى يقلبه المالك.
  public_enabled                  boolean not null default false,
  require_permission_for_publish  boolean not null default true,
  require_metadata_stripped       boolean not null default true,
  -- ★ صدق: لا خدمة فحص فيروسات في هذا النظام. الافتراضيّ false ومعه
  --   virus_scan_provider = null. عقد العنصر النائب في
  --   docs/PUBLIC_MEDIA_SECURITY_CONTRACT.md. قلبه إلى true بلا مزوّد
  --   يمنع النشر — وهذا مقصود: منع صادق خير من ادّعاء فحص.
  require_virus_scan              boolean not null default false,
  virus_scan_provider             text,
  -- قائمة مضيفين مسموح بها للوسائط الخارجية. فارغة = مسارات المستودع فقط.
  media_allowed_hosts             text[] not null default '{}',
  max_media_bytes                 int not null default 8000000 check (max_media_bytes between 1 and 52428800),
  default_anonymized_label_ar     text not null default 'جهة كبرى في المملكة',
  default_anonymized_label_en     text not null default 'A major organisation in the Kingdom',
  public_page_size                int not null default 12 check (public_page_size between 1 and 48),
  related_count                   int not null default 3 check (related_count between 0 and 12),
  updated_by                      uuid references auth.users(id),
  updated_at                      timestamptz not null default now()
);
insert into public.cs_settings(id) values (true) on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢) مساعدات نصّية — كلّها داخلية، بلا منح لأيّ دور عميل
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_txt(p jsonb, k text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(coalesce(p ->> k, '')), '')
$$;

create or replace function public.cs_bool(p jsonb, k text, p_default boolean default false)
returns boolean language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := lower(nullif(btrim(coalesce(p ->> k, '')), ''));
  if v is null then return coalesce(p_default, false); end if;
  return coalesce(v in ('true','t','1','yes','y'), false);
exception when others then return coalesce(p_default, false);
end $$;

create or replace function public.cs_int(p jsonb, k text) returns int
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::int;
exception when others then return null;
end $$;

create or replace function public.cs_ts(p jsonb, k text) returns timestamptz
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::timestamptz;
exception when others then return null;
end $$;

create or replace function public.cs_date(p jsonb, k text) returns date
language plpgsql immutable set search_path = public as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p ->> k, '')), '');
  if v is null then return null; end if;
  return v::date;
exception when others then return null;
end $$;

/**
 * ★ التعقيم ★ كلّ نصّ عامّ يمرّ من هنا مرّتين: عند الكتابة وعند الإخراج.
 * مرّة واحدة لا تكفي — صفّ كُتب قبل هذه الترحيلة، أو عبر مسار آخر، يصل
 * المتصفّح دون أن يُنظَّف. المحتوى العامّ نصّ عاديّ لا HTML، فنُزيل كلّ وسم
 * بدل محاولة تصفيته: قائمة السماح الوحيدة الآمنة هي القائمة الفارغة.
 */
create or replace function public.cs_sanitize(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '<[^>]*>', ' ', 'g'),
            '(?i)(javascript:|vbscript:|data:text/html|data:application|on[a-z]{2,20}[[:space:]]*=)', ' ', 'g'),
          '[<>]', ' ', 'g'),
        '(?i)(&lt;|&gt;|&#x?[0-9a-f]{1,6};?)', ' ', 'g'),
      '[[:space:]]+', ' ', 'g')
  ), '')
$$;

/** التعقيم مع الحفاظ على فواصل الفقرات (للنصوص الطويلة). */
create or replace function public.cs_sanitize_block(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '<[^>]*>', ' ', 'g'),
            '(?i)(javascript:|vbscript:|data:text/html|data:application|on[a-z]{2,20}[[:space:]]*=)', ' ', 'g'),
          '[<>]', ' ', 'g'),
        '(?i)(&lt;|&gt;|&#x?[0-9a-f]{1,6};?)', ' ', 'g'),
      '[ \t]+', ' ', 'g')
  ), '')
$$;

/**
 * ★ حقن الصيغ في CSV ★ خليّة تبدأ بـ= + - @ أو محرف تحكّم تُنفَّذ كصيغة في
 * Excel/Sheets. نسبقها بفاصلة عليا ونُضاعف علامات الاقتباس ونلفّ الخليّة.
 * التصدير هنا داخليّ فقط، لكن قاعدة العقد لا تعرف استثناءً.
 */
create or replace function public.cs_csv_cell(p text) returns text
language sql immutable set search_path = public as $$
  select '"' || replace(
    case when coalesce(p, '') ~ '^[=+\-@\t\r]' then '''' || coalesce(p, '') else coalesce(p, '') end,
    '"', '""') || '"'
$$;

/** توليد slug آمن — أحرف لاتينية صغيرة وأرقام وشرطات فقط. */
create or replace function public.cs_slugify(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'),
      '-'),
    '')
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٣) المُسنَدات — أربعة بالأسماء المتّفق عليها + مساعدان
-- كلّ واحد: security definer · search_path مثبَّت · boolean صريح · لا NULL.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then return false;
end $$;

create or replace function public.cs_is_staff() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_staff(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

create or replace function public.cs_is_owner() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_owner(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

create or replace function public.cs_is_admin() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  execute 'select coalesce(public.is_admin(), false)' into v;
  return coalesce(v, false);
exception when others then return false;
end $$;

/** رؤية السطح الداخليّ لدراسات الحالة. موظّف + مفتاح صريح، أو ملكيّة. */
create or replace function public.can_view_case_studies_internal() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if coalesce(public.cs_is_owner(), false) then return true; end if;
  if not coalesce(public.cs_is_staff(), false) then return false; end if;
  return coalesce(public.cs_perm('case_study.view'), false)
      or coalesce(public.cs_perm('case_study.edit'), false)
      or coalesce(public.cs_perm('case_study.review'), false);
exception when others then return false;
end $$;

/** التحرير: كتابة المسودّات والمحتوى. لا يمنح مراجعةً ولا نشرًا. */
create or replace function public.can_edit_case_studies() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if coalesce(public.cs_is_owner(), false) then return true; end if;
  if not coalesce(public.cs_is_staff(), false) then return false; end if;
  return coalesce(public.cs_perm('case_study.edit'), false);
exception when others then return false;
end $$;

/**
 * المراجعة الداخلية والقانونية وتسجيل إذن العميل.
 * ★ التسويق لا يتجاوز البوّابة القانونية ★ مفتاح case_study.edit **لا** يمنح
 * هذا؛ المفتاحان منفصلان عمدًا، والانتقال من legal_review لا يقبل إلّا هذا.
 */
create or replace function public.can_review_case_studies() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if coalesce(public.cs_is_owner(), false) then return true; end if;
  if not coalesce(public.cs_is_staff(), false) then return false; end if;
  return coalesce(public.cs_perm('case_study.review'), false);
exception when others then return false;
end $$;

/**
 * ★ النشر النهائيّ ملكيّ — بلا مفتاح وبلا استثناء ★
 * لا is_admin ولا is_staff ولا مفتاح صلاحية. المفتاح الذي لا يوجد لا يُمنَح
 * سهوًا. الموظّف العاديّ لا ينشر، والعميل لا ينشر، والتسويق لا ينشر.
 */
create or replace function public.can_publish_case_studies() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  return coalesce(public.cs_is_owner(), false);
exception when others then return false;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٤) الكتالوجات: القطاعات والخدمات
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_sectors (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 60),
  name_ar     text not null,
  name_en     text not null,
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.cs_services (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 60),
  name_ar     text not null,
  name_en     text not null,
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٥) الجدول الرئيسيّ
--
-- ⛔ لاحظ ما **ليس** هنا: لا cost ولا budget ولا margin ولا profit ولا rate.
--    الغياب البنيويّ أقوى من أيّ إخفاء في الواجهة، وPOSTCHECK يثبته بالفحص.
-- ════════════════════════════════════════════════════════════════════════════
create sequence if not exists public.cs_code_seq;

create table if not exists public.cs_case_studies (
  id                        uuid primary key default gen_random_uuid(),
  code                      text unique,

  -- ─── داخليّ بحت ─────────────────────────────────────────────────────────
  internal_title            text not null check (length(btrim(internal_title)) >= 3),
  internal_notes            text,
  -- ★ مرجع اختياريّ للقراءة فقط. لا مفتاح أجنبيّ (المنصّة مجمَّدة)، ولا نسخ
  --   تلقائيّ، ولا ظهور في أيّ مخرَج عامّ. POSTCHECK يثبت غيابه من الإسقاط.
  project_id                uuid,
  project_reference_note    text,
  editorial_owner           uuid references auth.users(id),

  -- ─── الهوية العامّة ────────────────────────────────────────────────────
  slug                      text not null unique
                              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 90),
  public_title_ar           text,
  public_title_en           text,
  summary_ar                text,
  summary_en                text,

  -- ─── هوية العميل ───────────────────────────────────────────────────────
  client_display_name       text,
  client_slug               text,   -- يشير إلى lib/clients.ts — لا نسخة رابعة للاسم
  client_identity_visibility text not null default 'hidden'
                              check (client_identity_visibility in ('named','anonymized','hidden')),
  anonymized_label_ar       text,
  anonymized_label_en       text,

  -- ─── المحتوى ثنائيّ اللغة ──────────────────────────────────────────────
  challenge_ar              text, challenge_en              text,
  objectives_ar             text, objectives_en             text,
  creative_approach_ar      text, creative_approach_en      text,
  production_approach_ar    text, production_approach_en    text,
  operational_complexity_ar text, operational_complexity_en text,
  equipment_summary_ar      text, equipment_summary_en      text,
  safety_compliance_ar      text, safety_compliance_en      text,
  timeline_summary_ar       text, timeline_summary_en       text,
  deliverables_summary_ar   text, deliverables_summary_en   text,
  challenges_faced_ar       text, challenges_faced_en       text,
  solution_ar               text, solution_en               text,
  results_ar                text, results_en                text,

  crew_size_min             int check (crew_size_min is null or crew_size_min >= 0),
  crew_size_max             int check (crew_size_max is null or crew_size_max >= 0),
  locations                 text[] not null default '{}',
  project_start             date,
  project_end               date,

  -- ─── شهادة العميل ──────────────────────────────────────────────────────
  testimonial_ar            text,
  testimonial_en            text,
  testimonial_author        text,
  testimonial_author_title  text,

  -- ─── SEO / Open Graph ──────────────────────────────────────────────────
  seo_title_ar              text, seo_title_en              text,
  seo_description_ar        text, seo_description_en        text,
  og_title_ar               text, og_title_en               text,
  og_description_ar         text, og_description_en         text,
  canonical_path            text check (canonical_path is null or canonical_path ~ '^/case-studies/[a-z0-9]+(-[a-z0-9]+)*$'),

  -- ─── النشر ─────────────────────────────────────────────────────────────
  status                    text not null default 'draft' check (status in (
                              'draft','internal_review','legal_review',
                              'client_permission_required','client_permission_received',
                              'approved','scheduled','published','unpublished','archived')),
  featured                  boolean not null default false,
  sort_order                int not null default 100,
  publish_at                timestamptz,
  first_published_at        timestamptz,
  unpublished_at            timestamptz,
  unpublish_reason          text,
  archived                  boolean not null default false,
  archived_at               timestamptz,
  archive_reason            text,

  -- ─── النسخ ─────────────────────────────────────────────────────────────
  current_version           int not null default 0,
  approved_version_id       uuid,
  published_version_id      uuid,
  has_unapproved_changes    boolean not null default false,

  -- ─── تدقيق ─────────────────────────────────────────────────────────────
  created_by                uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id),
  updated_at                timestamptz not null default now(),
  submitted_by              uuid references auth.users(id), submitted_at timestamptz,
  reviewed_by               uuid references auth.users(id), reviewed_at  timestamptz,
  legal_by                  uuid references auth.users(id), legal_at     timestamptz,
  approved_by               uuid references auth.users(id), approved_at  timestamptz,
  published_by              uuid references auth.users(id), published_at timestamptz,

  constraint cs_crew_range     check (crew_size_min is null or crew_size_max is null or crew_size_max >= crew_size_min),
  constraint cs_project_range  check (project_start is null or project_end is null or project_end >= project_start),
  -- ★ الشكل المجهَّل المعتمَد ★ «جهة صناعية كبرى في المملكة» ليست عرفًا: إن
  --   اختير التجهيل وجب وجود التسمية بلغة واحدة على الأقلّ.
  constraint cs_anon_label_present check (
    client_identity_visibility <> 'anonymized'
    or coalesce(btrim(anonymized_label_ar), '') <> ''
    or coalesce(btrim(anonymized_label_en), '') <> ''),
  constraint cs_client_slug_shape check (client_slug is null or client_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists cs_case_studies_status_idx on public.cs_case_studies(status);
create index if not exists cs_case_studies_publish_idx on public.cs_case_studies(publish_at);
create index if not exists cs_case_studies_featured_idx on public.cs_case_studies(featured, sort_order);

-- ════════════════════════════════════════════════════════════════════════════
-- ٦) إذن العميل — جدول منفصل عمدًا
--
-- ★ لماذا جدول لا أعمدة ★ مرجع الإذن واسم جهة الاتّصال وقيود السرّية بيانات
--   قانونية داخلية. لو كانت أعمدةً في دراسة الحالة لصارت أيّ SELECT على
--   الدراسة تسريبًا لها. الفصل يجعل ضيق الرؤية بنيويًّا لا اجتهاديًّا.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_permissions (
  case_study_id            uuid primary key references public.cs_case_studies(id) on delete cascade,
  permission_status        text not null default 'not_requested'
                             check (permission_status in ('not_requested','requested','granted','refused','revoked','expired')),
  permission_reference     text,
  permission_document_note text,
  permission_contact_name  text,
  permission_granted_at    timestamptz,
  permission_expires_at    timestamptz,
  permitted_logo           boolean not null default false,
  permitted_project_name   boolean not null default false,
  permitted_metrics        boolean not null default false,
  permitted_testimonial    boolean not null default false,
  confidentiality_restrictions text,
  anonymization_required   boolean not null default false,
  embargo_until            timestamptz,
  recorded_by              uuid references auth.users(id),
  recorded_at              timestamptz not null default now(),
  -- ★ الإذن الممنوح يشترط مرجعًا مكتوبًا ★ «قال لي شفهيًّا» ليس إذنًا.
  constraint cs_perm_granted_needs_ref check (
    permission_status <> 'granted'
    or coalesce(btrim(permission_reference), '') <> ''),
  -- ولا يُسمح بأيّ استعمال مأذون بلا حالة ممنوحة.
  constraint cs_perm_flags_need_grant check (
    permission_status = 'granted'
    or (permitted_logo = false and permitted_project_name = false
        and permitted_metrics = false and permitted_testimonial = false)),
  -- والشعار اسم: لا شعار بلا إذن الاسم.
  constraint cs_perm_logo_needs_name check (permitted_logo = false or permitted_project_name = true)
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٧) الوسائط — مشتقّات عامّة فقط
--
-- ★ القيد يمنع بنيويًّا ★ أسماء الدلاء الخاصّة العشرة، وروابط التوقيع
--   (/storage/v1/object/sign) ورموزها (token=)، وdata:/javascript:. أيّ منها
--   يعني أنّ رابط معاينة داخليّ أو مسار تخزين خاصّ على وشك أن يصير عامًّا.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_media (
  id                 uuid primary key default gen_random_uuid(),
  case_study_id      uuid not null references public.cs_case_studies(id) on delete cascade,
  asset_kind         text not null check (asset_kind in ('hero','gallery','before','after','logo','og_image','video','video_poster')),
  public_url         text,
  video_provider     text check (video_provider is null or video_provider in ('youtube','vimeo')),
  video_id           text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{5,64}$'),
  video_title_ar     text,
  video_title_en     text,
  alt_ar             text,
  alt_en             text,
  caption_ar         text,
  caption_en         text,
  width              int check (width is null or width between 1 and 20000),
  height             int check (height is null or height between 1 and 20000),
  bytes              int check (bytes is null or bytes between 1 and 52428800),
  content_type       text check (content_type is null or content_type in ('image/jpeg','image/png','image/webp','image/avif')),
  safe_filename      text check (safe_filename is null or safe_filename ~ '^[a-z0-9][a-z0-9._-]{0,120}$'),
  metadata_stripped  boolean not null default false,
  virus_scan_status  text not null default 'not_scanned'
                       check (virus_scan_status in ('not_scanned','pending','clean','infected','unavailable')),
  virus_scan_provider text,
  virus_scan_at      timestamptz,
  pair_key           text check (pair_key is null or pair_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order         int not null default 100,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),

  -- مصدر واحد بالضبط: إمّا رابط صورة عامّ وإمّا فيديو مضمَّن معرَّف بمزوّد ومعرّف.
  constraint cs_media_source_exact check (
    (asset_kind = 'video'  and video_provider is not null and video_id is not null and public_url is null)
    or (asset_kind <> 'video' and public_url is not null and video_provider is null and video_id is null)),

  -- ★ لا مسار خاصّ ولا رابط موقَّع ولا مخطّط خطر ★
  constraint cs_media_no_private_source check (
    public_url is null or (
      public_url !~* '(hr-files|hr-docs|custody-evidence|custody-inventory-assets|custody-inventory-evidence|custody-inventory-signatures|rental-evidence|rental-contracts|rental-private-documents|project-deliverables)'
      and public_url !~* '/storage/v1/object/(sign|authenticated)'
      and public_url !~* '[?&]token='
      and public_url !~* '^(data:|javascript:|vbscript:|file:)'
      and public_url !~* '/client-portal/'
      and public_url !~* '/api/portal/'
    )),

  -- الشكل: مسار مستودع مطلق، أو https فقط.
  constraint cs_media_url_shape check (
    public_url is null
    or public_url ~ '^/[A-Za-z0-9._~%!$&*+,;=:@/-]{1,300}$'
    or public_url ~ '^https://[A-Za-z0-9.-]{3,120}/[A-Za-z0-9._~%!$&*+,;=:@/-]{0,300}$')
);

create index if not exists cs_media_study_idx on public.cs_media(case_study_id, asset_kind, sort_order);

-- ════════════════════════════════════════════════════════════════════════════
-- ٨) النتائج المُقاسة — تُنشر فقط إن اعتُمدت **و** أذِن العميل بالأرقام
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_metrics (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null references public.cs_case_studies(id) on delete cascade,
  label_ar       text,
  label_en       text,
  value_text     text not null check (length(btrim(value_text)) between 1 and 60),
  unit_ar        text,
  unit_en        text,
  source_note    text,             -- داخليّ: من أين جاء الرقم. لا يظهر عامًّا.
  approved       boolean not null default false,
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  sort_order     int not null default 100,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint cs_metric_label_present check (
    coalesce(btrim(label_ar), '') <> '' or coalesce(btrim(label_en), '') <> ''),
  -- الاعتماد فعل موثَّق: لا اعتماد بلا معتمِد ولا وقت.
  constraint cs_metric_approval_audited check (
    approved = false or (approved_by is not null and approved_at is not null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- ٩) الاعتمادات (الطاقم) — اسم الموظّف لا يُنشر بلا موافقة موثَّقة
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_credits (
  id                  uuid primary key default gen_random_uuid(),
  case_study_id       uuid not null references public.cs_case_studies(id) on delete cascade,
  role_ar             text,
  role_en             text,
  person_display_name text not null check (length(btrim(person_display_name)) between 2 and 120),
  is_employee         boolean not null default false,
  employee_user_id    uuid references auth.users(id),   -- داخليّ فقط
  consent_public      boolean not null default false,
  consent_reference   text,
  consent_recorded_by uuid references auth.users(id),
  consent_recorded_at timestamptz,
  sort_order          int not null default 100,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint cs_credit_role_present check (
    coalesce(btrim(role_ar), '') <> '' or coalesce(btrim(role_en), '') <> ''),
  -- ★ الموافقة تُسجَّل ولا تُؤشَّر ★ صندوق اختيار بلا مرجع ليس موافقة.
  constraint cs_credit_consent_audited check (
    consent_public = false
    or (coalesce(btrim(consent_reference), '') <> ''
        and consent_recorded_by is not null and consent_recorded_at is not null))
);

-- ════════════════════════════════════════════════════════════════════════════
-- ١٠) التصنيف — جداول ربط، كي يصير الفرز استعلامًا لا نصًّا حرًّا
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_case_study_sectors (
  case_study_id uuid not null references public.cs_case_studies(id) on delete cascade,
  sector_id     uuid not null references public.cs_sectors(id) on delete cascade,
  primary key (case_study_id, sector_id)
);

create table if not exists public.cs_case_study_services (
  case_study_id uuid not null references public.cs_case_studies(id) on delete cascade,
  service_id    uuid not null references public.cs_services(id) on delete cascade,
  primary key (case_study_id, service_id)
);

-- ════════════════════════════════════════════════════════════════════════════
-- ١١) النسخ — التاريخ لا يُحذف
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_versions (
  id                uuid primary key default gen_random_uuid(),
  case_study_id     uuid not null references public.cs_case_studies(id) on delete cascade,
  version_number    int  not null check (version_number >= 1),
  change_summary    text not null check (length(btrim(change_summary)) >= 8),
  snapshot          jsonb not null,
  is_approved       boolean not null default false,
  approved_by       uuid references auth.users(id), approved_at timestamptz,
  is_published      boolean not null default false,
  published_by      uuid references auth.users(id), published_at timestamptz,
  rolled_back_from  int,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (case_study_id, version_number)
);

create index if not exists cs_versions_study_idx on public.cs_versions(case_study_id, version_number desc);

-- ════════════════════════════════════════════════════════════════════════════
-- ١٢) التدقيق — كلّ كتابة حسّاسة
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cs_audit (
  id             bigserial primary key,
  case_study_id  uuid,
  action         text not null,
  actor          uuid references auth.users(id),
  ok             boolean not null default true,
  details        jsonb not null default '{}'::jsonb,
  at             timestamptz not null default now()
);
create index if not exists cs_audit_study_idx on public.cs_audit(case_study_id, at desc);
create index if not exists cs_audit_at_idx on public.cs_audit(at desc);

-- المفاتيح الأجنبية للنسخ تُضاف بحارس (التشغيل الثاني يجب ألّا يفشل).
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'cs_approved_version_fk') then
    alter table public.cs_case_studies
      add constraint cs_approved_version_fk
      foreign key (approved_version_id) references public.cs_versions(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cs_published_version_fk') then
    alter table public.cs_case_studies
      add constraint cs_published_version_fk
      foreign key (published_version_id) references public.cs_versions(id) on delete set null;
  end if;
end $fk$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٣) التدقيق وحارس عدم قابلية النسخ للتغيير
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_log(
  p_action text, p_study uuid, p_ok boolean default true, p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.cs_audit(case_study_id, action, actor, ok, details)
  values (p_study, coalesce(p_action, 'unknown'), auth.uid(), coalesce(p_ok, true), coalesce(p_details, '{}'::jsonb));
exception when others then
  null;  -- التدقيق لا يُسقط عمليّة صحيحة، لكنّه لا يُخفي فشلها أيضًا
end $$;

/**
 * ★ التراجع يُنشئ نسخة جديدة ولا يحذف تاريخًا ★
 * تعديل لقطة نسخة أو حذف صفّ نسخة يُرفَض. الجدول سجلّ لا مسودّة.
 */
create or replace function public.cs_versions_immutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'cs_versions: حذف نسخة ممنوع — التراجع يُنشئ نسخة جديدة ولا يمحو تاريخًا';
  end if;
  if tg_op = 'UPDATE' then
    if new.snapshot is distinct from old.snapshot
       or new.version_number is distinct from old.version_number
       or new.case_study_id is distinct from old.case_study_id
       or new.change_summary is distinct from old.change_summary
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.rolled_back_from is distinct from old.rolled_back_from then
      raise exception 'cs_versions: محتوى النسخة غير قابل للتعديل — علامات الاعتماد والنشر فقط تتغيّر';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_cs_versions_immutable on public.cs_versions;
create trigger trg_cs_versions_immutable
  before update or delete on public.cs_versions
  for each row execute function public.cs_versions_immutable();

-- ════════════════════════════════════════════════════════════════════════════
-- ١٤) محرّك الموانع — مصدر الحقيقة الوحيد لسؤال «هل يجوز نشرها؟»
--
-- تُستدعى من: دوالّ النشر (ط١)، والمُشغِّل على الجدول (ط٢)، وقائمة التحقّق في
-- الواجهة. مصدر واحد يعني أنّ ما تراه الشاشة هو بالضبط ما سيرفضه الخادم.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_publish_blockers(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c        record;
  p        record;
  s        record;
  out_arr  jsonb := '[]'::jsonb;
  needs_perm boolean := false;
  perm_ok  boolean := false;
  n        int;
  host_bad int;
begin
  if p_id is null then
    return jsonb_build_array(jsonb_build_object('code','not_found','severity','blocker','detail_ar','دراسة الحالة غير موجودة.'));
  end if;
  select * into c from public.cs_case_studies where id = p_id;
  if not found then
    return jsonb_build_array(jsonb_build_object('code','not_found','severity','blocker','detail_ar','دراسة الحالة غير موجودة.'));
  end if;
  select * into p from public.cs_permissions where case_study_id = p_id;
  select * into s from public.cs_settings where id = true;

  perm_ok := coalesce(p.permission_status, 'not_requested') = 'granted'
             and coalesce(p.permission_expires_at, now() + interval '100 years') >= now();

  -- هل تحتاج هذه الدراسة إذنًا أصلًا؟ الدراسة المجهَّلة تمامًا بلا أرقام ولا
  -- شهادة ولا شعار لا تنشر عن العميل شيئًا، فلا يُشترط لها إذن.
  needs_perm := (c.client_identity_visibility = 'named')
    or coalesce(btrim(c.testimonial_ar), '') <> '' or coalesce(btrim(c.testimonial_en), '') <> ''
    or exists (select 1 from public.cs_metrics m where m.case_study_id = p_id and m.approved)
    or exists (select 1 from public.cs_media  d where d.case_study_id = p_id and d.asset_kind = 'logo');

  -- ── المحتوى الأدنى (ثنائيّ اللغة إلزاميّ للعنوان والملخّص) ──────────────
  if coalesce(btrim(c.public_title_ar), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','missing_title_ar','severity','blocker','detail_ar','العنوان العامّ بالعربية مطلوب.');
  end if;
  if coalesce(btrim(c.public_title_en), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','missing_title_en','severity','blocker','detail_ar','العنوان العامّ بالإنجليزية مطلوب — الصفحة ثنائية اللغة.');
  end if;
  if coalesce(btrim(c.summary_ar), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','missing_summary_ar','severity','blocker','detail_ar','الملخّص بالعربية مطلوب.');
  end if;
  if coalesce(btrim(c.summary_en), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','missing_summary_en','severity','blocker','detail_ar','الملخّص بالإنجليزية مطلوب.');
  end if;
  if c.archived then
    out_arr := out_arr || jsonb_build_object('code','archived','severity','blocker','detail_ar','الدراسة مؤرشفة — استعِدها قبل النشر.');
  end if;
  if c.canonical_path is not null and c.canonical_path <> ('/case-studies/' || c.slug) then
    out_arr := out_arr || jsonb_build_object('code','canonical_mismatch','severity','blocker','detail_ar','المسار الكنسيّ لا يطابق الـslug.');
  end if;

  -- ── الوسائط ────────────────────────────────────────────────────────────
  select count(*) into n from public.cs_media where case_study_id = p_id and asset_kind = 'hero';
  if n = 0 then
    out_arr := out_arr || jsonb_build_object('code','no_hero_media','severity','blocker','detail_ar','لا توجد صورة رئيسية معتمدة.');
  end if;

  select count(*) into n from public.cs_media
   where case_study_id = p_id and asset_kind in ('hero','gallery','before','after','og_image','logo')
     and (coalesce(btrim(alt_ar), '') = '' or coalesce(btrim(alt_en), '') = '');
  if n > 0 then
    out_arr := out_arr || jsonb_build_object('code','media_missing_alt','severity','blocker','count',n,'detail_ar','وسائط بلا نصّ بديل بالعربية والإنجليزية.');
  end if;

  select count(*) into n from public.cs_media where case_study_id = p_id and virus_scan_status = 'infected';
  if n > 0 then
    out_arr := out_arr || jsonb_build_object('code','media_infected','severity','blocker','count',n,'detail_ar','ملفّ وسائط موسوم بأنّه مصاب — النشر ممنوع مهما كانت الإعدادات.');
  end if;

  if coalesce(s.require_metadata_stripped, true) then
    select count(*) into n from public.cs_media
     where case_study_id = p_id and asset_kind <> 'video' and metadata_stripped = false;
    if n > 0 then
      out_arr := out_arr || jsonb_build_object('code','media_metadata_not_stripped','severity','blocker','count',n,'detail_ar','وسائط لم تُجرَّد من بياناتها الوصفية (موقع/جهاز/تاريخ).');
    end if;
  end if;

  if coalesce(s.require_virus_scan, false) then
    if coalesce(btrim(s.virus_scan_provider), '') = '' then
      out_arr := out_arr || jsonb_build_object('code','virus_scan_required_without_provider','severity','blocker','detail_ar','الفحص مطلوب في الإعدادات ولا مزوّد مضبوط — منع صادق بدل ادّعاء فحص.');
    end if;
    select count(*) into n from public.cs_media
     where case_study_id = p_id and asset_kind <> 'video' and virus_scan_status <> 'clean';
    if n > 0 then
      out_arr := out_arr || jsonb_build_object('code','media_not_scanned','severity','blocker','count',n,'detail_ar','وسائط لم تُفحَص أو نتيجتها غير نظيفة.');
    end if;
  end if;

  -- مضيف خارجيّ غير مُدرَج في قائمة السماح
  select count(*) into host_bad from public.cs_media d
   where d.case_study_id = p_id and d.public_url is not null and d.public_url like 'https://%'
     and not exists (
       select 1 from unnest(coalesce(s.media_allowed_hosts, '{}'::text[])) h
        where h <> '' and d.public_url like 'https://' || h || '/%');
  if host_bad > 0 then
    out_arr := out_arr || jsonb_build_object('code','media_host_not_allowed','severity','blocker','count',host_bad,'detail_ar','وسائط على مضيف خارجيّ غير مُدرَج في قائمة السماح.');
  end if;

  select count(*) into n from public.cs_media
   where case_study_id = p_id and bytes is not null and bytes > coalesce(s.max_media_bytes, 8000000);
  if n > 0 then
    out_arr := out_arr || jsonb_build_object('code','media_too_large','severity','blocker','count',n,'detail_ar','وسائط تتجاوز الحدّ الأقصى للحجم.');
  end if;

  -- ── الإذن والسرّية ─────────────────────────────────────────────────────
  if coalesce(p.permission_status, 'not_requested') in ('refused','revoked') then
    out_arr := out_arr || jsonb_build_object('code','permission_refused_or_revoked','severity','blocker','detail_ar','إذن العميل مرفوض أو مسحوب.');
  end if;
  if needs_perm and coalesce(s.require_permission_for_publish, true) and not perm_ok then
    out_arr := out_arr || jsonb_build_object('code','permission_missing','severity','blocker','detail_ar','الدراسة تنشر معلومات عن العميل ولا إذن ساري مسجَّل.');
  end if;
  if c.client_identity_visibility = 'named' and not (perm_ok and coalesce(p.permitted_project_name, false)) then
    out_arr := out_arr || jsonb_build_object('code','named_without_permission','severity','blocker','detail_ar','اختير عرض اسم العميل بلا إذن صريح باستعمال الاسم.');
  end if;
  if c.client_identity_visibility = 'named' and coalesce(btrim(c.client_display_name), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','named_without_name','severity','blocker','detail_ar','اختير عرض الاسم ولا اسم مكتوب.');
  end if;
  if coalesce(p.anonymization_required, false) and c.client_identity_visibility = 'named' then
    out_arr := out_arr || jsonb_build_object('code','anonymization_required','severity','blocker','detail_ar','الإذن يشترط التجهيل والدراسة تعرض الاسم.');
  end if;
  if exists (select 1 from public.cs_media where case_study_id = p_id and asset_kind = 'logo')
     and not (perm_ok and coalesce(p.permitted_logo, false)) then
    out_arr := out_arr || jsonb_build_object('code','logo_without_permission','severity','blocker','detail_ar','شعار العميل مرفق بلا إذن باستعمال الشعار.');
  end if;
  if exists (select 1 from public.cs_metrics where case_study_id = p_id and approved)
     and not (perm_ok and coalesce(p.permitted_metrics, false)) then
    out_arr := out_arr || jsonb_build_object('code','metrics_without_permission','severity','blocker','detail_ar','نتائج مُقاسة معتمدة بلا إذن بنشر الأرقام.');
  end if;
  if (coalesce(btrim(c.testimonial_ar), '') <> '' or coalesce(btrim(c.testimonial_en), '') <> '')
     and not (perm_ok and coalesce(p.permitted_testimonial, false)) then
    out_arr := out_arr || jsonb_build_object('code','testimonial_without_permission','severity','blocker','detail_ar','شهادة عميل مكتوبة بلا إذن بنشرها.');
  end if;
  if p.embargo_until is not null and coalesce(c.publish_at, now()) < p.embargo_until then
    out_arr := out_arr || jsonb_build_object('code','embargo_active','severity','blocker',
      'detail_ar','حظر النشر ساري حتّى ' || to_char(p.embargo_until, 'YYYY-MM-DD') || ' وتاريخ النشر أبكر منه.');
  end if;

  -- ── تحذيرات (لا تمنع، لكنّها تُعرَض قبل النشر) ──────────────────────────
  select count(*) into n from public.cs_credits
   where case_study_id = p_id and is_employee and not consent_public;
  if n > 0 then
    out_arr := out_arr || jsonb_build_object('code','credits_suppressed','severity','warning','count',n,
      'detail_ar','أسماء موظّفين بلا موافقة موثَّقة — لن تُنشر، وهذا سلوك مقصود لا عطل.');
  end if;
  if coalesce(btrim(c.seo_title_ar), '') = '' or coalesce(btrim(c.seo_title_en), '') = ''
     or coalesce(btrim(c.seo_description_ar), '') = '' or coalesce(btrim(c.seo_description_en), '') = '' then
    out_arr := out_arr || jsonb_build_object('code','seo_incomplete','severity','warning',
      'detail_ar','حقول SEO ناقصة — سيُشتقّ البديل من العنوان والملخّص.');
  end if;
  -- ★ إشارة بشرية لا ادّعاء آليّ ★ لا يوجد عمود تكلفة أصلًا في أيّ جدول هنا،
  --   لكنّ رقمًا ماليًّا قد يُكتب داخل نصّ حرّ. نرفع تحذيرًا ليقرّر إنسان،
  --   ولا نزعم أنّنا نمنع ما لا نستطيع منعه بيقين.
  if (coalesce(c.results_ar, '') || ' ' || coalesce(c.results_en, '') || ' ' ||
      coalesce(c.summary_ar, '') || ' ' || coalesce(c.summary_en, '') || ' ' ||
      coalesce(c.deliverables_summary_ar, '') || ' ' || coalesce(c.deliverables_summary_en, ''))
     ~* '(ريال|﷼|SAR|USD|\$[[:space:]]*[0-9]|هامش|تكلفة المشروع|ميزانية)' then
    out_arr := out_arr || jsonb_build_object('code','possible_financial_figure','severity','warning',
      'detail_ar','نصّ عامّ يحتوي ما يشبه رقمًا ماليًّا — راجعه يدويًّا. تكلفة المشروع وهامشه لا يُنشران.');
  end if;

  return out_arr;
exception when others then
  -- الفشل يُقرأ منعًا لا سماحًا.
  return jsonb_build_array(jsonb_build_object('code','blocker_engine_error','severity','blocker','detail_ar','تعذّر فحص موانع النشر — النشر ممنوع حتّى يُحلّ السبب.'));
end $$;

/**
 * ★ الطبقة الثانية ★ مُشغِّل على الجدول نفسه. حتّى لو كُتبت الحالة مباشرةً
 * (خارج دوالّ النشر) يُعاد فحص الموانع ويُرفَض التغيير. AFTER عمدًا: الصفّ
 * النهائيّ مرئيّ داخل المعاملة، فالفحص يقرأ ما سيُثبَّت فعلًا لا ما كان قبله.
 */
create or replace function public.cs_guard_publish() returns trigger
language plpgsql security definer set search_path = public as $$
declare b jsonb; hard int;
begin
  b := public.cs_publish_blockers(new.id);
  select count(*) into hard from jsonb_array_elements(b) e where e ->> 'severity' = 'blocker';
  if hard > 0 then
    raise exception 'cs_guard_publish: النشر ممنوع — % مانعًا قائمًا: %', hard, b::text;
  end if;
  if new.published_version_id is null then
    raise exception 'cs_guard_publish: لا نسخة منشورة مرتبطة — العامّ يُقرأ من لقطة النسخة لا من الصفّ الحيّ';
  end if;
  return null;
end $$;

drop trigger if exists trg_cs_guard_publish on public.cs_case_studies;
create trigger trg_cs_guard_publish
  after insert or update on public.cs_case_studies
  for each row when (new.status in ('published','scheduled'))
  execute function public.cs_guard_publish();

-- ════════════════════════════════════════════════════════════════════════════
-- ١٥) بناء اللقطة — ما يراه العامّ يُجمَّد هنا، وما يُسحَب يُطبَّق حيًّا
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_snapshot_build(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; j jsonb;
begin
  select * into c from public.cs_case_studies where id = p_id;
  if not found then return '{}'::jsonb; end if;

  j := jsonb_build_object(
    'slug', c.slug,
    'title_ar', public.cs_sanitize(c.public_title_ar),
    'title_en', public.cs_sanitize(c.public_title_en),
    'summary_ar', public.cs_sanitize_block(c.summary_ar),
    'summary_en', public.cs_sanitize_block(c.summary_en),
    'client_display_name', public.cs_sanitize(c.client_display_name),
    'client_identity_visibility', c.client_identity_visibility,
    'anonymized_label_ar', public.cs_sanitize(c.anonymized_label_ar),
    'anonymized_label_en', public.cs_sanitize(c.anonymized_label_en),
    'body', jsonb_build_object(
      'challenge_ar', public.cs_sanitize_block(c.challenge_ar),               'challenge_en', public.cs_sanitize_block(c.challenge_en),
      'objectives_ar', public.cs_sanitize_block(c.objectives_ar),             'objectives_en', public.cs_sanitize_block(c.objectives_en),
      'creative_approach_ar', public.cs_sanitize_block(c.creative_approach_ar),'creative_approach_en', public.cs_sanitize_block(c.creative_approach_en),
      'production_approach_ar', public.cs_sanitize_block(c.production_approach_ar),'production_approach_en', public.cs_sanitize_block(c.production_approach_en),
      'operational_complexity_ar', public.cs_sanitize_block(c.operational_complexity_ar),'operational_complexity_en', public.cs_sanitize_block(c.operational_complexity_en),
      'equipment_summary_ar', public.cs_sanitize_block(c.equipment_summary_ar),'equipment_summary_en', public.cs_sanitize_block(c.equipment_summary_en),
      'safety_compliance_ar', public.cs_sanitize_block(c.safety_compliance_ar),'safety_compliance_en', public.cs_sanitize_block(c.safety_compliance_en),
      'timeline_summary_ar', public.cs_sanitize_block(c.timeline_summary_ar), 'timeline_summary_en', public.cs_sanitize_block(c.timeline_summary_en),
      'deliverables_summary_ar', public.cs_sanitize_block(c.deliverables_summary_ar),'deliverables_summary_en', public.cs_sanitize_block(c.deliverables_summary_en),
      'challenges_faced_ar', public.cs_sanitize_block(c.challenges_faced_ar), 'challenges_faced_en', public.cs_sanitize_block(c.challenges_faced_en),
      'solution_ar', public.cs_sanitize_block(c.solution_ar),                 'solution_en', public.cs_sanitize_block(c.solution_en),
      'results_ar', public.cs_sanitize_block(c.results_ar),                   'results_en', public.cs_sanitize_block(c.results_en)),
    'crew_size_min', c.crew_size_min,
    'crew_size_max', c.crew_size_max,
    'locations', (select coalesce(jsonb_agg(public.cs_sanitize(x)), '[]'::jsonb) from unnest(c.locations) x where public.cs_sanitize(x) is not null),
    'project_start', c.project_start,
    'project_end', c.project_end,
    'testimonial', jsonb_build_object(
      'ar', public.cs_sanitize_block(c.testimonial_ar), 'en', public.cs_sanitize_block(c.testimonial_en),
      'author', public.cs_sanitize(c.testimonial_author), 'author_title', public.cs_sanitize(c.testimonial_author_title)),
    'seo', jsonb_build_object(
      'title_ar', public.cs_sanitize(c.seo_title_ar), 'title_en', public.cs_sanitize(c.seo_title_en),
      'description_ar', public.cs_sanitize(c.seo_description_ar), 'description_en', public.cs_sanitize(c.seo_description_en),
      'og_title_ar', public.cs_sanitize(c.og_title_ar), 'og_title_en', public.cs_sanitize(c.og_title_en),
      'og_description_ar', public.cs_sanitize(c.og_description_ar), 'og_description_en', public.cs_sanitize(c.og_description_en),
      'canonical_path', coalesce(c.canonical_path, '/case-studies/' || c.slug)),
    'media', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.asset_kind, 'url', m.public_url,
        'video_provider', m.video_provider, 'video_id', m.video_id,
        'video_title_ar', public.cs_sanitize(m.video_title_ar), 'video_title_en', public.cs_sanitize(m.video_title_en),
        'alt_ar', public.cs_sanitize(m.alt_ar), 'alt_en', public.cs_sanitize(m.alt_en),
        'caption_ar', public.cs_sanitize(m.caption_ar), 'caption_en', public.cs_sanitize(m.caption_en),
        'width', m.width, 'height', m.height, 'pair_key', m.pair_key, 'sort_order', m.sort_order)
        order by m.sort_order, m.created_at), '[]'::jsonb)
      from public.cs_media m where m.case_study_id = c.id),
    'metrics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'label_ar', public.cs_sanitize(x.label_ar), 'label_en', public.cs_sanitize(x.label_en),
        'value_text', public.cs_sanitize(x.value_text),
        'unit_ar', public.cs_sanitize(x.unit_ar), 'unit_en', public.cs_sanitize(x.unit_en))
        order by x.sort_order), '[]'::jsonb)
      from public.cs_metrics x where x.case_study_id = c.id and x.approved),
    'credits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', k.id, 'role_ar', public.cs_sanitize(k.role_ar), 'role_en', public.cs_sanitize(k.role_en),
        'name', public.cs_sanitize(k.person_display_name))
        order by k.sort_order), '[]'::jsonb)
      from public.cs_credits k where k.case_study_id = c.id and k.consent_public),
    'sectors', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en) order by s.sort_order), '[]'::jsonb)
      from public.cs_case_study_sectors j2 join public.cs_sectors s on s.id = j2.sector_id where j2.case_study_id = c.id),
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en) order by s.sort_order), '[]'::jsonb)
      from public.cs_case_study_services j3 join public.cs_services s on s.id = j3.service_id where j3.case_study_id = c.id)
  );
  return j;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٦) بوّابة الظهور العامّ + الإسقاط العامّ
--
-- ★ الإسقاط قائمة أعمدة صريحة ★ لا select *، ولا project_id، ولا internal_*،
--   ولا مرجع إذن، ولا اسم جهة اتّصال، ولا مصدر رقم، ولا معرّف موظّف، ولا
--   أيّ مسار تخزين. ما لا يُذكر هنا لا يخرج.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_is_public(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c record; p record; en boolean;
begin
  if p_id is null then return false; end if;
  select coalesce(public_enabled, false) into en from public.cs_settings where id = true;
  if not coalesce(en, false) then return false; end if;

  select status, publish_at, archived, published_version_id
    into c from public.cs_case_studies where id = p_id;
  if not found then return false; end if;
  if coalesce(c.archived, true) then return false; end if;
  if c.status not in ('published','scheduled') then return false; end if;
  if c.publish_at is null or c.publish_at > now() then return false; end if;
  if c.published_version_id is null then return false; end if;

  select permission_status, embargo_until into p from public.cs_permissions where case_study_id = p_id;
  -- سحب الإذن أو رفضه يُخرج الدراسة من العلن فورًا، لا يُقنّع بعضها فقط.
  if coalesce(p.permission_status, 'not_requested') in ('revoked','refused') then return false; end if;
  if p.embargo_until is not null and p.embargo_until > now() then return false; end if;
  return true;
exception when others then return false;
end $$;

/**
 * ★ دالّة التقنيع الواحدة ★
 * تأخذ لقطةً وتُعيد الإسقاط العامّ. تستدعيها **الصفحة العامّة** (بلقطة النسخة
 * المنشورة) و**المعاينة الداخلية** (بلقطة المحتوى الحيّ) على السواء، فيصير
 * تطابقهما مسار كود واحد لا وعدًا في التوثيق.
 *
 * المحتوى من اللقطة (فلا تعديل صامت بعد النشر)، والأقنعة من **الحالة الحيّة**
 * (فسحب إذن أو موافقة يسري فورًا). عدم التناظر مقصود: الإضافة تحتاج نشرًا
 * جديدًا، والسحب لا ينتظر شيئًا.
 */
create or replace function public.cs_mask(p_id uuid, snap jsonb, p_full boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.cs_case_studies%rowtype; p public.cs_permissions%rowtype; s public.cs_settings%rowtype;
  perm_ok boolean; name_ok boolean; logo_ok boolean; metrics_ok boolean; testi_ok boolean;
  label_ar text; label_en text;
  media jsonb; metrics jsonb; credits jsonb; hero jsonb;
begin
  if snap is null or snap = '{}'::jsonb then return null; end if;
  select * into c from public.cs_case_studies where id = p_id;
  if not found then return null; end if;
  select * into p from public.cs_permissions where case_study_id = p_id;
  select * into s from public.cs_settings where id = true;

  perm_ok := coalesce(p.permission_status, 'not_requested') = 'granted'
             and coalesce(p.permission_expires_at, now() + interval '100 years') >= now();
  name_ok := perm_ok and coalesce(p.permitted_project_name, false)
             and not coalesce(p.anonymization_required, false)
             and c.client_identity_visibility = 'named';
  logo_ok      := name_ok and coalesce(p.permitted_logo, false);
  metrics_ok   := perm_ok and coalesce(p.permitted_metrics, false);
  testi_ok     := perm_ok and coalesce(p.permitted_testimonial, false);

  label_ar := case
    when name_ok then snap ->> 'client_display_name'
    when c.client_identity_visibility = 'anonymized'
      then coalesce(nullif(snap ->> 'anonymized_label_ar', ''), s.default_anonymized_label_ar)
    else null end;
  label_en := case
    when name_ok then snap ->> 'client_display_name'
    when c.client_identity_visibility = 'anonymized'
      then coalesce(nullif(snap ->> 'anonymized_label_en', ''), s.default_anonymized_label_en)
    else null end;

  -- الوسائط: من اللقطة، والشعار يسقط حيًّا إن سقط الإذن.
  media := (
    select coalesce(jsonb_agg(e order by (e ->> 'sort_order')::int), '[]'::jsonb)
      from jsonb_array_elements(coalesce(snap -> 'media', '[]'::jsonb)) e
     where (e ->> 'kind') <> 'logo' or logo_ok);
  hero := (select e from jsonb_array_elements(coalesce(media, '[]'::jsonb)) e where e ->> 'kind' = 'hero' limit 1);

  -- الأرقام: من اللقطة، ويُعاد التحقّق من الاعتماد الحيّ بالمعرّف.
  metrics := case when not metrics_ok then '[]'::jsonb else (
    select coalesce(jsonb_agg(e), '[]'::jsonb)
      from jsonb_array_elements(coalesce(snap -> 'metrics', '[]'::jsonb)) e
     where exists (select 1 from public.cs_metrics m
                    where m.id = ((e ->> 'id')::uuid) and m.case_study_id = p_id and m.approved)) end;

  -- الاعتمادات: الموافقة الحيّة شرط. سحبها يُخفي الاسم دون انتظار نشر جديد.
  credits := (
    select coalesce(jsonb_agg(e), '[]'::jsonb)
      from jsonb_array_elements(coalesce(snap -> 'credits', '[]'::jsonb)) e
     where exists (select 1 from public.cs_credits k
                    where k.id = ((e ->> 'id')::uuid) and k.case_study_id = p_id and k.consent_public));

  return jsonb_strip_nulls(jsonb_build_object(
    'slug', c.slug,
    'title_ar', public.cs_sanitize(snap ->> 'title_ar'),
    'title_en', public.cs_sanitize(snap ->> 'title_en'),
    'summary_ar', public.cs_sanitize_block(snap ->> 'summary_ar'),
    'summary_en', public.cs_sanitize_block(snap ->> 'summary_en'),
    'client_label_ar', public.cs_sanitize(label_ar),
    'client_label_en', public.cs_sanitize(label_en),
    'client_named', name_ok,
    'featured', c.featured,
    'sort_order', c.sort_order,
    'published_at', coalesce(c.first_published_at, c.publish_at),
    'updated_at', c.publish_at,
    'sectors', coalesce(snap -> 'sectors', '[]'::jsonb),
    'services', coalesce(snap -> 'services', '[]'::jsonb),
    'hero', hero,
    'locations', coalesce(snap -> 'locations', '[]'::jsonb),
    'crew_size_min', snap -> 'crew_size_min',
    'crew_size_max', snap -> 'crew_size_max',
    'project_start', snap ->> 'project_start',
    'project_end', snap ->> 'project_end',
    'seo', case when not p_full then null else coalesce(snap -> 'seo', '{}'::jsonb) end,
    'body', case when not p_full then null else coalesce(snap -> 'body', '{}'::jsonb) end,
    'media', case when not p_full then null else coalesce(media, '[]'::jsonb) end,
    'metrics', case when not p_full then null else coalesce(metrics, '[]'::jsonb) end,
    'credits', case when not p_full then null else coalesce(credits, '[]'::jsonb) end,
    'testimonial', case when not p_full or not testi_ok then null else coalesce(snap -> 'testimonial', '{}'::jsonb) end
  ));
exception when others then return null;
end $$;

/**
 * الإسقاط العامّ لدراسة واحدة: البوّابة أوّلًا، ثمّ لقطة النسخة **المنشورة**
 * وحدها. لا قراءة من الصفّ الحيّ للمحتوى.
 */
create or replace function public.cs_public_row(p_id uuid, p_full boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare snap jsonb; vid uuid;
begin
  if not public.cs_is_public(p_id) then return null; end if;
  select published_version_id into vid from public.cs_case_studies where id = p_id;
  if vid is null then return null; end if;
  select v.snapshot into snap from public.cs_versions v where v.id = vid;
  if snap is null then return null; end if;
  return public.cs_mask(p_id, snap, p_full);
exception when others then return null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٧) الدوالّ العامّة — anon يقرأ المنشور فقط، ولا يكتب شيئًا أبدًا
--
-- ★ لا دالّة تحرير واحدة ممنوحة لـanon ★ وثلاث دوالّ قراءة فقط، كلّها
--   SECURITY DEFINER بقائمة أعمدة صريحة، وكلّها تمرّ من cs_is_public().
-- ★ لا حدّ معدّل داخل القاعدة للقراءة ★ rl_consume عدّاد **كتابة** دائم بلا
--   معرفة بعنوان الطالب؛ استعماله في كلّ عرض صفحة يعني كتابة صفّ لكلّ زائر
--   ومفتاحًا عامًّا واحدًا يُسقط الموقع كلّه عند أوّل ذروة. الكبح للقراءة
--   مكانه الحافّة (lib/server/rateLimit.ts بمفتاح لكلّ IP)، ولا يُخترع هنا
--   محدّد ثانٍ. وهذه الحزمة لا تضيف أيّ مسار كتابة لـanon إطلاقًا.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_public_index(p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s record; en boolean; sector_slug text; service_slug text; only_featured boolean;
  page int; size int; total int; items jsonb; ids uuid[];
begin
  select * into s from public.cs_settings where id = true;
  en := coalesce(s.public_enabled, false);
  if not en then
    -- ★ صدق ★ «غير مفعّلة» ليست «صفر دراسات». الواجهة تُخفي القسم.
    return jsonb_build_object('enabled', false, 'total', 0, 'page', 1, 'page_size', 0,
                              'items', '[]'::jsonb, 'sectors', '[]'::jsonb, 'services', '[]'::jsonb);
  end if;

  sector_slug   := nullif(btrim(coalesce(p_params ->> 'sector', '')), '');
  service_slug  := nullif(btrim(coalesce(p_params ->> 'service', '')), '');
  only_featured := coalesce(lower(coalesce(p_params ->> 'featured', '')) in ('true','1','yes'), false);
  page := greatest(1, coalesce((nullif(btrim(coalesce(p_params ->> 'page', '')), ''))::int, 1));
  size := least(coalesce(s.public_page_size, 12), 48);

  -- المرشّحون: المنشور فقط، ثمّ التصفية على التصنيف المخزَّن في اللقطة.
  select array_agg(t.id order by t.featured desc, t.sort_order, t.publish_at desc)
    into ids
    from (
      select c.id, c.featured, c.sort_order, c.publish_at
        from public.cs_case_studies c
       where public.cs_is_public(c.id)
         and (sector_slug is null or exists (
               select 1 from public.cs_case_study_sectors j join public.cs_sectors x on x.id = j.sector_id
                where j.case_study_id = c.id and x.slug = sector_slug))
         and (service_slug is null or exists (
               select 1 from public.cs_case_study_services j join public.cs_services x on x.id = j.service_id
                where j.case_study_id = c.id and x.slug = service_slug))
         and (not only_featured or c.featured)
    ) t;

  ids   := coalesce(ids, '{}'::uuid[]);
  total := array_length(ids, 1);
  total := coalesce(total, 0);

  select coalesce(jsonb_agg(r order by ord), '[]'::jsonb) into items
    from (
      select public.cs_public_row(u.id, false) as r, u.ord
        from unnest(ids) with ordinality as u(id, ord)
       where u.ord > (page - 1) * size and u.ord <= page * size
    ) q
   where r is not null;

  return jsonb_build_object(
    'enabled', true, 'total', total, 'page', page, 'page_size', size,
    'items', coalesce(items, '[]'::jsonb),
    -- الفلاتر تُشتقّ من المنشور فعلًا: قطاع بلا دراسة منشورة لا يُعرض.
    'sectors', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('slug', x.slug, 'name_ar', x.name_ar, 'name_en', x.name_en)), '[]'::jsonb)
        from public.cs_case_study_sectors j join public.cs_sectors x on x.id = j.sector_id
       where x.active and j.case_study_id = any(ids)),
    'services', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('slug', x.slug, 'name_ar', x.name_ar, 'name_en', x.name_en)), '[]'::jsonb)
        from public.cs_case_study_services j join public.cs_services x on x.id = j.service_id
       where x.active and j.case_study_id = any(ids)));
exception when others then
  return jsonb_build_object('enabled', false, 'total', 0, 'page', 1, 'page_size', 0,
                            'items', '[]'::jsonb, 'sectors', '[]'::jsonb, 'services', '[]'::jsonb);
end $$;

create or replace function public.cs_public_study(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; body jsonb; rel jsonb; s record; k int;
begin
  select * into s from public.cs_settings where id = true;
  if not coalesce(s.public_enabled, false) then
    return jsonb_build_object('enabled', false, 'found', false);
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('enabled', true, 'found', false);
  end if;
  select id into sid from public.cs_case_studies where slug = p_slug;
  if sid is null or not public.cs_is_public(sid) then
    return jsonb_build_object('enabled', true, 'found', false);
  end if;
  body := public.cs_public_row(sid, true);
  if body is null then return jsonb_build_object('enabled', true, 'found', false); end if;

  k := coalesce(s.related_count, 3);
  -- ذات صلة = تشترك في قطاع أو خدمة، منشورة، وليست هي.
  select coalesce(jsonb_agg(r order by ord), '[]'::jsonb) into rel
    from (
      select public.cs_public_row(c.id, false) as r,
             row_number() over (order by c.featured desc, c.sort_order, c.publish_at desc) as ord
        from public.cs_case_studies c
       where c.id <> sid and public.cs_is_public(c.id)
         and (exists (select 1 from public.cs_case_study_sectors a
                       join public.cs_case_study_sectors b on b.sector_id = a.sector_id
                      where a.case_study_id = sid and b.case_study_id = c.id)
              or exists (select 1 from public.cs_case_study_services a
                          join public.cs_case_study_services b on b.service_id = a.service_id
                         where a.case_study_id = sid and b.case_study_id = c.id))
       limit greatest(k, 0)
    ) q
   where r is not null;

  return jsonb_build_object('enabled', true, 'found', true, 'study', body, 'related', coalesce(rel, '[]'::jsonb));
exception when others then
  return jsonb_build_object('enabled', false, 'found', false);
end $$;

/** للـsitemap: الـslugs المنشورة فقط، بلا أيّ حقل آخر. */
create or replace function public.cs_public_slugs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare en boolean;
begin
  select coalesce(public_enabled, false) into en from public.cs_settings where id = true;
  if not coalesce(en, false) then return jsonb_build_object('enabled', false, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('enabled', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', c.slug,
             'updated_at', coalesce(c.publish_at, c.first_published_at))
             order by c.publish_at desc), '[]'::jsonb)
      from public.cs_case_studies c where public.cs_is_public(c.id)));
exception when others then
  return jsonb_build_object('enabled', false, 'items', '[]'::jsonb);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٨) الواجهة الداخلية
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.cs_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.cs_settings where id = true;
  return jsonb_build_object(
    'installed', true,
    'can_view',    coalesce(public.can_view_case_studies_internal(), false),
    'can_edit',    coalesce(public.can_edit_case_studies(), false),
    'can_review',  coalesce(public.can_review_case_studies(), false),
    'can_publish', coalesce(public.can_publish_case_studies(), false),
    'public_enabled', coalesce(s.public_enabled, false),
    'require_permission_for_publish', coalesce(s.require_permission_for_publish, true),
    'require_metadata_stripped', coalesce(s.require_metadata_stripped, true),
    'require_virus_scan', coalesce(s.require_virus_scan, false),
    'virus_scan_provider', s.virus_scan_provider,
    'media_allowed_hosts', to_jsonb(coalesce(s.media_allowed_hosts, '{}'::text[])),
    'max_media_bytes', coalesce(s.max_media_bytes, 8000000),
    'published_count', (select count(*) from public.cs_case_studies c where public.cs_is_public(c.id)));
end $$;

create or replace function public.cs_lookups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  return jsonb_build_object(
    'sectors',  (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name_ar', name_ar, 'name_en', name_en, 'active', active) order by sort_order), '[]'::jsonb) from public.cs_sectors),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name_ar', name_ar, 'name_en', name_en, 'active', active) order by sort_order), '[]'::jsonb) from public.cs_services),
    'statuses', to_jsonb(array['draft','internal_review','legal_review','client_permission_required',
                               'client_permission_received','approved','scheduled','published','unpublished','archived']),
    'permission_statuses', to_jsonb(array['not_requested','requested','granted','refused','revoked','expired']),
    'media_kinds', to_jsonb(array['hero','gallery','before','after','logo','og_image','video','video_poster']),
    'visibility', to_jsonb(array['named','anonymized','hidden']));
end $$;

create or replace function public.cs_list(p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st text; q text; lim int;
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  st  := nullif(btrim(coalesce(p_params ->> 'status', '')), '');
  q   := nullif(btrim(coalesce(p_params ->> 'q', '')), '');
  lim := least(greatest(coalesce((nullif(btrim(coalesce(p_params ->> 'limit', '')), ''))::int, 60), 1), 200);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'internal_title', c.internal_title, 'slug', c.slug,
      'public_title_ar', c.public_title_ar, 'public_title_en', c.public_title_en,
      'status', c.status, 'featured', c.featured, 'archived', c.archived,
      'publish_at', c.publish_at, 'current_version', c.current_version,
      'has_unapproved_changes', c.has_unapproved_changes,
      'is_public_now', public.cs_is_public(c.id),
      'client_identity_visibility', c.client_identity_visibility,
      'permission_status', coalesce(p.permission_status, 'not_requested'),
      'updated_at', c.updated_at) order by c.updated_at desc)
      from public.cs_case_studies c
      left join public.cs_permissions p on p.case_study_id = c.id
     where (st is null or c.status = st)
       and (q is null or c.internal_title ilike '%' || q || '%' or c.slug ilike '%' || q || '%')
     limit lim), '[]'::jsonb);
end $$;

create or replace function public.cs_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.cs_case_studies%rowtype; can_perm boolean;
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  select * into c from public.cs_case_studies where id = p_id;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  -- ★ بيانات الإذن القانونية أضيق من الرؤية العامّة للوحدة ★
  can_perm := coalesce(public.can_review_case_studies(), false);

  return jsonb_build_object(
    'study', to_jsonb(c) - 'internal_notes' || jsonb_build_object(
      'internal_notes', case when can_perm or coalesce(public.can_edit_case_studies(), false) then c.internal_notes else null end),
    'permission', case when not can_perm then null else (
      select to_jsonb(p) from public.cs_permissions p where p.case_study_id = p_id) end,
    'permission_summary', (
      select jsonb_build_object(
        'permission_status', coalesce(p.permission_status, 'not_requested'),
        'permitted_logo', coalesce(p.permitted_logo, false),
        'permitted_project_name', coalesce(p.permitted_project_name, false),
        'permitted_metrics', coalesce(p.permitted_metrics, false),
        'permitted_testimonial', coalesce(p.permitted_testimonial, false),
        'anonymization_required', coalesce(p.anonymization_required, false),
        'embargo_until', p.embargo_until)
        from public.cs_permissions p where p.case_study_id = p_id),
    'media', (select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order), '[]'::jsonb) from public.cs_media m where m.case_study_id = p_id),
    'metrics', (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order), '[]'::jsonb) from public.cs_metrics x where x.case_study_id = p_id),
    'credits', (select coalesce(jsonb_agg(to_jsonb(k) order by k.sort_order), '[]'::jsonb) from public.cs_credits k where k.case_study_id = p_id),
    'sectors', (select coalesce(jsonb_agg(s.slug order by s.sort_order), '[]'::jsonb) from public.cs_case_study_sectors j join public.cs_sectors s on s.id = j.sector_id where j.case_study_id = p_id),
    'services', (select coalesce(jsonb_agg(s.slug order by s.sort_order), '[]'::jsonb) from public.cs_case_study_services j join public.cs_services s on s.id = j.service_id where j.case_study_id = p_id),
    'is_public_now', public.cs_is_public(p_id));
end $$;

-- ─── الإنشاء والتحرير ──────────────────────────────────────────────────────
create or replace function public.cs_upsert(p_input jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; c record; v_slug text; is_new boolean := false; summary text;
  v_clear text[] := '{}'::text[];
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '')::uuid;

  if v_id is null then
    is_new := true;
    v_slug := coalesce(public.cs_slugify(public.cs_txt(p_input, 'slug')),
                       public.cs_slugify(public.cs_txt(p_input, 'internal_title')));
    if v_slug is null then raise exception 'validation: الـslug مطلوب ويجب أن يحتوي أحرفًا لاتينية أو أرقامًا'; end if;
    insert into public.cs_case_studies(
      code, internal_title, slug, created_by, updated_by, editorial_owner)
    values (
      'CS-' || lpad(nextval('public.cs_code_seq')::text, 4, '0'),
      coalesce(public.cs_txt(p_input, 'internal_title'), 'دراسة حالة جديدة'),
      v_slug, auth.uid(), auth.uid(), auth.uid())
    returning id into v_id;
    insert into public.cs_permissions(case_study_id, recorded_by) values (v_id, auth.uid())
      on conflict (case_study_id) do nothing;
  end if;

  select * into c from public.cs_case_studies where id = v_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.archived and not is_new then raise exception 'validation: الدراسة مؤرشفة — استعِدها قبل التحرير'; end if;

  -- ★ لا تعديل صامت بعد النشر ★ أوّل تحرير بعد النشر يشترط ملخّص تغيير.
  if c.published_version_id is not null then
    summary := public.cs_txt(p_input, 'change_summary');
    if summary is null or length(btrim(summary)) < 8 then
      raise exception 'validation: تحرير دراسة منشورة يشترط ملخّص تغيير لا يقلّ عن ٨ محارف';
    end if;
  end if;

  -- الـslug يثبت بعد أوّل نشر: تغييره يكسر الروابط والمسار الكنسيّ.
  v_slug := public.cs_slugify(public.cs_txt(p_input, 'slug'));
  if v_slug is not null and v_slug <> c.slug and c.first_published_at is not null then
    raise exception 'validation: لا يمكن تغيير الـslug بعد النشر الأوّل — الروابط العامّة تعتمد عليه';
  end if;

  update public.cs_case_studies set
    internal_title            = coalesce(public.cs_txt(p_input, 'internal_title'), internal_title),
    internal_notes            = coalesce(public.cs_txt(p_input, 'internal_notes'), internal_notes),
    project_id                = case when p_input ? 'project_id' then nullif(btrim(coalesce(p_input ->> 'project_id', '')), '')::uuid else project_id end,
    project_reference_note    = coalesce(public.cs_txt(p_input, 'project_reference_note'), project_reference_note),
    slug                      = coalesce(v_slug, slug),
    public_title_ar           = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'public_title_ar')), public_title_ar),
    public_title_en           = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'public_title_en')), public_title_en),
    summary_ar                = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'summary_ar')), summary_ar),
    summary_en                = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'summary_en')), summary_en),
    client_display_name       = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'client_display_name')), client_display_name),
    client_slug               = coalesce(public.cs_slugify(public.cs_txt(p_input, 'client_slug')), client_slug),
    client_identity_visibility= coalesce(nullif(public.cs_txt(p_input, 'client_identity_visibility'), ''), client_identity_visibility),
    anonymized_label_ar       = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'anonymized_label_ar')), anonymized_label_ar),
    anonymized_label_en       = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'anonymized_label_en')), anonymized_label_en),
    challenge_ar              = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'challenge_ar')), challenge_ar),
    challenge_en              = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'challenge_en')), challenge_en),
    objectives_ar             = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'objectives_ar')), objectives_ar),
    objectives_en             = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'objectives_en')), objectives_en),
    creative_approach_ar      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'creative_approach_ar')), creative_approach_ar),
    creative_approach_en      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'creative_approach_en')), creative_approach_en),
    production_approach_ar    = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'production_approach_ar')), production_approach_ar),
    production_approach_en    = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'production_approach_en')), production_approach_en),
    operational_complexity_ar = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'operational_complexity_ar')), operational_complexity_ar),
    operational_complexity_en = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'operational_complexity_en')), operational_complexity_en),
    equipment_summary_ar      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'equipment_summary_ar')), equipment_summary_ar),
    equipment_summary_en      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'equipment_summary_en')), equipment_summary_en),
    safety_compliance_ar      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'safety_compliance_ar')), safety_compliance_ar),
    safety_compliance_en      = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'safety_compliance_en')), safety_compliance_en),
    timeline_summary_ar       = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'timeline_summary_ar')), timeline_summary_ar),
    timeline_summary_en       = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'timeline_summary_en')), timeline_summary_en),
    deliverables_summary_ar   = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'deliverables_summary_ar')), deliverables_summary_ar),
    deliverables_summary_en   = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'deliverables_summary_en')), deliverables_summary_en),
    challenges_faced_ar       = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'challenges_faced_ar')), challenges_faced_ar),
    challenges_faced_en       = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'challenges_faced_en')), challenges_faced_en),
    solution_ar               = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'solution_ar')), solution_ar),
    solution_en               = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'solution_en')), solution_en),
    results_ar                = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'results_ar')), results_ar),
    results_en                = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'results_en')), results_en),
    crew_size_min             = coalesce(public.cs_int(p_input, 'crew_size_min'), crew_size_min),
    crew_size_max             = coalesce(public.cs_int(p_input, 'crew_size_max'), crew_size_max),
    locations                 = case when p_input ? 'locations'
                                  then coalesce((select array_agg(public.cs_sanitize(x))
                                                   from jsonb_array_elements_text(p_input -> 'locations') x
                                                  where public.cs_sanitize(x) is not null), '{}'::text[])
                                  else locations end,
    project_start             = coalesce(public.cs_date(p_input, 'project_start'), project_start),
    project_end               = coalesce(public.cs_date(p_input, 'project_end'), project_end),
    testimonial_ar            = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'testimonial_ar')), testimonial_ar),
    testimonial_en            = coalesce(public.cs_sanitize_block(public.cs_txt(p_input, 'testimonial_en')), testimonial_en),
    testimonial_author        = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'testimonial_author')), testimonial_author),
    testimonial_author_title  = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'testimonial_author_title')), testimonial_author_title),
    seo_title_ar              = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'seo_title_ar')), seo_title_ar),
    seo_title_en              = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'seo_title_en')), seo_title_en),
    seo_description_ar        = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'seo_description_ar')), seo_description_ar),
    seo_description_en        = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'seo_description_en')), seo_description_en),
    og_title_ar               = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'og_title_ar')), og_title_ar),
    og_title_en               = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'og_title_en')), og_title_en),
    og_description_ar         = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'og_description_ar')), og_description_ar),
    og_description_en         = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'og_description_en')), og_description_en),
    canonical_path            = coalesce(public.cs_txt(p_input, 'canonical_path'), canonical_path),
    featured                  = case when p_input ? 'featured' then public.cs_bool(p_input, 'featured', featured) else featured end,
    sort_order                = coalesce(public.cs_int(p_input, 'sort_order'), sort_order),
    -- ⛔ الحالة **لا تُضبَط من هنا إطلاقًا**. الانتقالات عبر دوالّها وحدها،
    --    وإلّا صار «حرّر ثمّ انشر» نداءً واحدًا يتخطّى المراجعة والإذن.
    has_unapproved_changes    = case when published_version_id is not null then true else has_unapproved_changes end,
    updated_by                = auth.uid(),
    updated_at                = now()
  where id = v_id;

  -- ════════════════════════════════════════════════════════════════════════
  -- ★ التفريغ الصريح ★ cs_txt يعيد null للنصّ الفارغ وكلّ إسناد أعلاه
  --   coalesce — أي أنّ حقلًا كُتب خطأً (شهادة عميل بلا إذن، اسم جهة في
  --   الملخّص) **لا يمكن محوه بالكتابة فوقه بفراغ**، ويبقى في الصفّ إلى
  --   الأبد ينتظر إذنًا يفتحه. الباب هنا صريح ومنفصل عن الكتابة العادية.
  --
  --   القائمة ساكنة تمامًا: لا اسم عمود يُركَّب في وقت التشغيل، ولا execute
  --   format. عمود غير مذكور أدناه لا يمكن تفريغه — internal_title و slug و
  --   client_identity_visibility و status و current_version خارج القائمة
  --   عمدًا لأنّها not null أو قرارات مسار لا حقول تحرير.
  -- ════════════════════════════════════════════════════════════════════════
  if p_input ? 'clear' then
    select coalesce(array_agg(btrim(x)), '{}'::text[]) into v_clear
      from jsonb_array_elements_text(p_input -> 'clear') x;

    -- ★ نقرأ الصفّ **بعد** الكتابة أعلاه ★ الرؤية والتسميات قد تكون تغيّرت في
    --   نفس النداء، والحكم على قيمة قديمة كان سيسمح بمحو يُسقط قيد الجدول
    --   `cs_anon_label_present` برسالة غامضة بدل رسالة تقول ما الخطأ.
    select * into c from public.cs_case_studies where id = v_id;
    if c.client_identity_visibility = 'anonymized'
       and coalesce(btrim(case when 'anonymized_label_ar' = any(v_clear) then null else c.anonymized_label_ar end), '') = ''
       and coalesce(btrim(case when 'anonymized_label_en' = any(v_clear) then null else c.anonymized_label_en end), '') = '' then
      raise exception 'validation: الرؤية «مجهَّل» تحتاج تسمية معتمَدة بلغة واحدة على الأقلّ — لا يمكن محو الاثنتين';
    end if;

    update public.cs_case_studies set
      internal_notes            = case when 'internal_notes'            = any(v_clear) then null else internal_notes            end,
      project_reference_note    = case when 'project_reference_note'    = any(v_clear) then null else project_reference_note    end,
      public_title_ar           = case when 'public_title_ar'           = any(v_clear) then null else public_title_ar           end,
      public_title_en           = case when 'public_title_en'           = any(v_clear) then null else public_title_en           end,
      summary_ar                = case when 'summary_ar'                = any(v_clear) then null else summary_ar                end,
      summary_en                = case when 'summary_en'                = any(v_clear) then null else summary_en                end,
      client_display_name       = case when 'client_display_name'       = any(v_clear) then null else client_display_name       end,
      client_slug               = case when 'client_slug'               = any(v_clear) then null else client_slug               end,
      anonymized_label_ar       = case when 'anonymized_label_ar'       = any(v_clear) then null else anonymized_label_ar       end,
      anonymized_label_en       = case when 'anonymized_label_en'       = any(v_clear) then null else anonymized_label_en       end,
      challenge_ar              = case when 'challenge_ar'              = any(v_clear) then null else challenge_ar              end,
      challenge_en              = case when 'challenge_en'              = any(v_clear) then null else challenge_en              end,
      objectives_ar             = case when 'objectives_ar'             = any(v_clear) then null else objectives_ar             end,
      objectives_en             = case when 'objectives_en'             = any(v_clear) then null else objectives_en             end,
      creative_approach_ar      = case when 'creative_approach_ar'      = any(v_clear) then null else creative_approach_ar      end,
      creative_approach_en      = case when 'creative_approach_en'      = any(v_clear) then null else creative_approach_en      end,
      production_approach_ar    = case when 'production_approach_ar'    = any(v_clear) then null else production_approach_ar    end,
      production_approach_en    = case when 'production_approach_en'    = any(v_clear) then null else production_approach_en    end,
      operational_complexity_ar = case when 'operational_complexity_ar' = any(v_clear) then null else operational_complexity_ar end,
      operational_complexity_en = case when 'operational_complexity_en' = any(v_clear) then null else operational_complexity_en end,
      equipment_summary_ar      = case when 'equipment_summary_ar'      = any(v_clear) then null else equipment_summary_ar      end,
      equipment_summary_en      = case when 'equipment_summary_en'      = any(v_clear) then null else equipment_summary_en      end,
      safety_compliance_ar      = case when 'safety_compliance_ar'      = any(v_clear) then null else safety_compliance_ar      end,
      safety_compliance_en      = case when 'safety_compliance_en'      = any(v_clear) then null else safety_compliance_en      end,
      timeline_summary_ar       = case when 'timeline_summary_ar'       = any(v_clear) then null else timeline_summary_ar       end,
      timeline_summary_en       = case when 'timeline_summary_en'       = any(v_clear) then null else timeline_summary_en       end,
      deliverables_summary_ar   = case when 'deliverables_summary_ar'   = any(v_clear) then null else deliverables_summary_ar   end,
      deliverables_summary_en   = case when 'deliverables_summary_en'   = any(v_clear) then null else deliverables_summary_en   end,
      challenges_faced_ar       = case when 'challenges_faced_ar'       = any(v_clear) then null else challenges_faced_ar       end,
      challenges_faced_en       = case when 'challenges_faced_en'       = any(v_clear) then null else challenges_faced_en       end,
      solution_ar               = case when 'solution_ar'               = any(v_clear) then null else solution_ar               end,
      solution_en               = case when 'solution_en'               = any(v_clear) then null else solution_en               end,
      results_ar                = case when 'results_ar'                = any(v_clear) then null else results_ar                end,
      results_en                = case when 'results_en'                = any(v_clear) then null else results_en                end,
      crew_size_min             = case when 'crew_size_min'             = any(v_clear) then null else crew_size_min             end,
      crew_size_max             = case when 'crew_size_max'             = any(v_clear) then null else crew_size_max             end,
      project_start             = case when 'project_start'             = any(v_clear) then null else project_start             end,
      project_end               = case when 'project_end'               = any(v_clear) then null else project_end               end,
      testimonial_ar            = case when 'testimonial_ar'            = any(v_clear) then null else testimonial_ar            end,
      testimonial_en            = case when 'testimonial_en'            = any(v_clear) then null else testimonial_en            end,
      testimonial_author        = case when 'testimonial_author'        = any(v_clear) then null else testimonial_author        end,
      testimonial_author_title  = case when 'testimonial_author_title'  = any(v_clear) then null else testimonial_author_title  end,
      seo_title_ar              = case when 'seo_title_ar'              = any(v_clear) then null else seo_title_ar              end,
      seo_title_en              = case when 'seo_title_en'              = any(v_clear) then null else seo_title_en              end,
      seo_description_ar        = case when 'seo_description_ar'        = any(v_clear) then null else seo_description_ar        end,
      seo_description_en        = case when 'seo_description_en'        = any(v_clear) then null else seo_description_en        end,
      og_title_ar               = case when 'og_title_ar'               = any(v_clear) then null else og_title_ar               end,
      og_title_en               = case when 'og_title_en'               = any(v_clear) then null else og_title_en               end,
      og_description_ar         = case when 'og_description_ar'         = any(v_clear) then null else og_description_ar         end,
      og_description_en         = case when 'og_description_en'         = any(v_clear) then null else og_description_en         end,
      canonical_path            = case when 'canonical_path'            = any(v_clear) then null else canonical_path            end,
      updated_by = auth.uid(), updated_at = now()
    where id = v_id;
  end if;

  perform public.cs_log(case when is_new then 'create' else 'edit' end, v_id, true,
                        jsonb_build_object('change_summary', summary,
                                           'cleared', to_jsonb(coalesce(v_clear, '{}'::text[]))));
  return v_id;
end $$;

create or replace function public.cs_set_taxonomy(p_id uuid, p_sectors text[], p_services text[])
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  if not exists (select 1 from public.cs_case_studies where id = p_id) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  delete from public.cs_case_study_sectors where case_study_id = p_id;
  insert into public.cs_case_study_sectors(case_study_id, sector_id)
    select p_id, s.id from public.cs_sectors s where s.slug = any(coalesce(p_sectors, '{}'::text[]))
    on conflict do nothing;
  delete from public.cs_case_study_services where case_study_id = p_id;
  insert into public.cs_case_study_services(case_study_id, service_id)
    select p_id, s.id from public.cs_services s where s.slug = any(coalesce(p_services, '{}'::text[]))
    on conflict do nothing;
  update public.cs_case_studies
     set has_unapproved_changes = case when published_version_id is not null then true else has_unapproved_changes end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_log('taxonomy', p_id, true, jsonb_build_object('sectors', p_sectors, 'services', p_services));
  return true;
end $$;

-- ─── الوسائط والنتائج والاعتمادات ──────────────────────────────────────────
create or replace function public.cs_touch(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.cs_case_studies
     set has_unapproved_changes = case when published_version_id is not null then true else has_unapproved_changes end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
end $$;

create or replace function public.cs_media_upsert(p_input jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_study uuid; v_kind text; v_url text; s record;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  v_study := nullif(btrim(coalesce(p_input ->> 'case_study_id', '')), '')::uuid;
  if v_study is null or not exists (select 1 from public.cs_case_studies where id = v_study) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  v_id   := nullif(btrim(coalesce(p_input ->> 'id', '')), '')::uuid;
  v_kind := coalesce(public.cs_txt(p_input, 'asset_kind'), 'gallery');
  v_url  := public.cs_txt(p_input, 'public_url');
  select * into s from public.cs_settings where id = true;

  -- ★ المنع مبكّر وصريح ★ القيد على الجدول يمنع أيضًا، لكنّ رسالة القيد
  --   غامضة؛ هنا نقول للمحرّر ما الخطأ بالضبط بدل «انتهاك قيد».
  if v_url is not null then
    if v_url ~* '(hr-files|hr-docs|custody-evidence|custody-inventory-assets|custody-inventory-evidence|custody-inventory-signatures|rental-evidence|rental-contracts|rental-private-documents|project-deliverables)'
       or v_url ~* '/storage/v1/object/(sign|authenticated)' or v_url ~* '[?&]token='
       or v_url ~* '/client-portal/' or v_url ~* '/api/portal/' then
      raise exception 'validation: هذا رابط تخزين خاصّ أو رابط معاينة داخليّ — الوسائط العامّة مشتقّات معتمَدة فقط';
    end if;
  end if;
  if public.cs_int(p_input, 'bytes') is not null
     and public.cs_int(p_input, 'bytes') > coalesce(s.max_media_bytes, 8000000) then
    raise exception 'validation: حجم الملفّ يتجاوز الحدّ المسموح';
  end if;

  if v_id is null then
    insert into public.cs_media(
      case_study_id, asset_kind, public_url, video_provider, video_id,
      video_title_ar, video_title_en, alt_ar, alt_en, caption_ar, caption_en,
      width, height, bytes, content_type, safe_filename, metadata_stripped,
      virus_scan_status, virus_scan_provider, virus_scan_at, pair_key, sort_order, created_by, updated_by)
    values (
      v_study, v_kind, v_url,
      public.cs_txt(p_input, 'video_provider'), public.cs_txt(p_input, 'video_id'),
      public.cs_sanitize(public.cs_txt(p_input, 'video_title_ar')), public.cs_sanitize(public.cs_txt(p_input, 'video_title_en')),
      public.cs_sanitize(public.cs_txt(p_input, 'alt_ar')), public.cs_sanitize(public.cs_txt(p_input, 'alt_en')),
      public.cs_sanitize(public.cs_txt(p_input, 'caption_ar')), public.cs_sanitize(public.cs_txt(p_input, 'caption_en')),
      public.cs_int(p_input, 'width'), public.cs_int(p_input, 'height'), public.cs_int(p_input, 'bytes'),
      public.cs_txt(p_input, 'content_type'), lower(public.cs_txt(p_input, 'safe_filename')),
      public.cs_bool(p_input, 'metadata_stripped', false),
      coalesce(public.cs_txt(p_input, 'virus_scan_status'), 'not_scanned'),
      public.cs_txt(p_input, 'virus_scan_provider'), public.cs_ts(p_input, 'virus_scan_at'),
      public.cs_slugify(public.cs_txt(p_input, 'pair_key')),
      coalesce(public.cs_int(p_input, 'sort_order'), 100), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.cs_media set
      asset_kind      = v_kind,
      public_url      = case when p_input ? 'public_url' then v_url else public_url end,
      video_provider  = case when p_input ? 'video_provider' then public.cs_txt(p_input, 'video_provider') else video_provider end,
      video_id        = case when p_input ? 'video_id' then public.cs_txt(p_input, 'video_id') else video_id end,
      video_title_ar  = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'video_title_ar')), video_title_ar),
      video_title_en  = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'video_title_en')), video_title_en),
      alt_ar          = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'alt_ar')), alt_ar),
      alt_en          = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'alt_en')), alt_en),
      caption_ar      = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'caption_ar')), caption_ar),
      caption_en      = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'caption_en')), caption_en),
      width           = coalesce(public.cs_int(p_input, 'width'), width),
      height          = coalesce(public.cs_int(p_input, 'height'), height),
      bytes           = coalesce(public.cs_int(p_input, 'bytes'), bytes),
      content_type    = coalesce(public.cs_txt(p_input, 'content_type'), content_type),
      safe_filename   = coalesce(lower(public.cs_txt(p_input, 'safe_filename')), safe_filename),
      metadata_stripped = case when p_input ? 'metadata_stripped' then public.cs_bool(p_input, 'metadata_stripped', metadata_stripped) else metadata_stripped end,
      virus_scan_status = coalesce(public.cs_txt(p_input, 'virus_scan_status'), virus_scan_status),
      virus_scan_provider = coalesce(public.cs_txt(p_input, 'virus_scan_provider'), virus_scan_provider),
      virus_scan_at   = coalesce(public.cs_ts(p_input, 'virus_scan_at'), virus_scan_at),
      pair_key        = coalesce(public.cs_slugify(public.cs_txt(p_input, 'pair_key')), pair_key),
      sort_order      = coalesce(public.cs_int(p_input, 'sort_order'), sort_order),
      updated_by      = auth.uid(), updated_at = now()
    where id = v_id and case_study_id = v_study;
    if not found then raise exception 'not_found: عنصر الوسائط غير موجود ضمن هذه الدراسة'; end if;
  end if;

  perform public.cs_touch(v_study);
  perform public.cs_log('media_upsert', v_study, true, jsonb_build_object('media_id', v_id, 'kind', v_kind));
  return v_id;
end $$;

create or replace function public.cs_media_delete(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_study uuid;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'validation: سبب الحذف مطلوب'; end if;
  select case_study_id into v_study from public.cs_media where id = p_id;
  if v_study is null then raise exception 'not_found: عنصر الوسائط غير موجود'; end if;
  delete from public.cs_media where id = p_id;
  perform public.cs_touch(v_study);
  perform public.cs_log('media_delete', v_study, true, jsonb_build_object('media_id', p_id, 'reason', p_reason));
  return true;
end $$;

create or replace function public.cs_metric_upsert(p_input jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_study uuid; want_approved boolean;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  v_study := nullif(btrim(coalesce(p_input ->> 'case_study_id', '')), '')::uuid;
  if v_study is null or not exists (select 1 from public.cs_case_studies where id = v_study) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  -- ★ اعتماد الرقم فعل مراجعة لا فعل تحرير ★
  want_approved := public.cs_bool(p_input, 'approved', false);
  if want_approved and not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: اعتماد النتائج المُقاسة يحتاج صلاحية المراجعة';
  end if;
  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.cs_metrics(case_study_id, label_ar, label_en, value_text, unit_ar, unit_en,
                                  source_note, approved, approved_by, approved_at, sort_order, created_by)
    values (v_study,
      public.cs_sanitize(public.cs_txt(p_input, 'label_ar')), public.cs_sanitize(public.cs_txt(p_input, 'label_en')),
      coalesce(public.cs_sanitize(public.cs_txt(p_input, 'value_text')), '—'),
      public.cs_sanitize(public.cs_txt(p_input, 'unit_ar')), public.cs_sanitize(public.cs_txt(p_input, 'unit_en')),
      public.cs_txt(p_input, 'source_note'),
      want_approved, case when want_approved then auth.uid() end, case when want_approved then now() end,
      coalesce(public.cs_int(p_input, 'sort_order'), 100), auth.uid())
    returning id into v_id;
  else
    update public.cs_metrics set
      label_ar   = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'label_ar')), label_ar),
      label_en   = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'label_en')), label_en),
      value_text = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'value_text')), value_text),
      unit_ar    = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'unit_ar')), unit_ar),
      unit_en    = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'unit_en')), unit_en),
      source_note= coalesce(public.cs_txt(p_input, 'source_note'), source_note),
      approved   = case when p_input ? 'approved' then want_approved else approved end,
      approved_by= case when p_input ? 'approved' then (case when want_approved then auth.uid() end) else approved_by end,
      approved_at= case when p_input ? 'approved' then (case when want_approved then now() end) else approved_at end,
      sort_order = coalesce(public.cs_int(p_input, 'sort_order'), sort_order)
    where id = v_id and case_study_id = v_study;
    if not found then raise exception 'not_found: النتيجة غير موجودة ضمن هذه الدراسة'; end if;
  end if;

  perform public.cs_touch(v_study);
  perform public.cs_log('metric_upsert', v_study, true, jsonb_build_object('metric_id', v_id, 'approved', want_approved));
  return v_id;
end $$;

create or replace function public.cs_metric_delete(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_study uuid;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'validation: سبب الحذف مطلوب'; end if;
  select case_study_id into v_study from public.cs_metrics where id = p_id;
  if v_study is null then raise exception 'not_found: النتيجة غير موجودة'; end if;
  delete from public.cs_metrics where id = p_id;
  perform public.cs_touch(v_study);
  perform public.cs_log('metric_delete', v_study, true, jsonb_build_object('metric_id', p_id, 'reason', p_reason));
  return true;
end $$;

create or replace function public.cs_credit_upsert(p_input jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_study uuid; want_consent boolean; ref text;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  v_study := nullif(btrim(coalesce(p_input ->> 'case_study_id', '')), '')::uuid;
  if v_study is null or not exists (select 1 from public.cs_case_studies where id = v_study) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  want_consent := public.cs_bool(p_input, 'consent_public', false);
  ref := public.cs_txt(p_input, 'consent_reference');
  -- ★ نشر اسم شخص فعل مراجعة موثَّق ★ لا تأشير موافقة من محرّر بلا مرجع.
  if want_consent then
    if not coalesce(public.can_review_case_studies(), false) then
      raise exception 'not_authorized: تسجيل موافقة نشر اسم يحتاج صلاحية المراجعة';
    end if;
    if coalesce(btrim(ref), '') = '' then
      raise exception 'validation: الموافقة تحتاج مرجعًا موثَّقًا (بريد/نموذج/عقد) — الصندوق وحده ليس موافقة';
    end if;
  end if;
  v_id := nullif(btrim(coalesce(p_input ->> 'id', '')), '')::uuid;

  if v_id is null then
    insert into public.cs_credits(case_study_id, role_ar, role_en, person_display_name, is_employee,
                                  employee_user_id, consent_public, consent_reference,
                                  consent_recorded_by, consent_recorded_at, sort_order, created_by)
    values (v_study,
      public.cs_sanitize(public.cs_txt(p_input, 'role_ar')), public.cs_sanitize(public.cs_txt(p_input, 'role_en')),
      coalesce(public.cs_sanitize(public.cs_txt(p_input, 'person_display_name')), '—'),
      public.cs_bool(p_input, 'is_employee', false),
      nullif(btrim(coalesce(p_input ->> 'employee_user_id', '')), '')::uuid,
      want_consent, ref,
      case when want_consent then auth.uid() end, case when want_consent then now() end,
      coalesce(public.cs_int(p_input, 'sort_order'), 100), auth.uid())
    returning id into v_id;
  else
    update public.cs_credits set
      role_ar             = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'role_ar')), role_ar),
      role_en             = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'role_en')), role_en),
      person_display_name = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'person_display_name')), person_display_name),
      is_employee         = case when p_input ? 'is_employee' then public.cs_bool(p_input, 'is_employee', is_employee) else is_employee end,
      employee_user_id    = case when p_input ? 'employee_user_id' then nullif(btrim(coalesce(p_input ->> 'employee_user_id', '')), '')::uuid else employee_user_id end,
      consent_public      = case when p_input ? 'consent_public' then want_consent else consent_public end,
      consent_reference   = case when p_input ? 'consent_public' then (case when want_consent then ref end) else consent_reference end,
      consent_recorded_by = case when p_input ? 'consent_public' then (case when want_consent then auth.uid() end) else consent_recorded_by end,
      consent_recorded_at = case when p_input ? 'consent_public' then (case when want_consent then now() end) else consent_recorded_at end,
      sort_order          = coalesce(public.cs_int(p_input, 'sort_order'), sort_order)
    where id = v_id and case_study_id = v_study;
    if not found then raise exception 'not_found: الاعتماد غير موجود ضمن هذه الدراسة'; end if;
  end if;

  perform public.cs_touch(v_study);
  perform public.cs_log('credit_upsert', v_study, true, jsonb_build_object('credit_id', v_id, 'consent', want_consent));
  return v_id;
end $$;

create or replace function public.cs_credit_delete(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_study uuid;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'validation: سبب الحذف مطلوب'; end if;
  select case_study_id into v_study from public.cs_credits where id = p_id;
  if v_study is null then raise exception 'not_found: الاعتماد غير موجود'; end if;
  delete from public.cs_credits where id = p_id;
  perform public.cs_touch(v_study);
  perform public.cs_log('credit_delete', v_study, true, jsonb_build_object('credit_id', p_id, 'reason', p_reason));
  return true;
end $$;

-- ─── إذن العميل ────────────────────────────────────────────────────────────
create or replace function public.cs_permission_set(p_id uuid, p_input jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- ★ التسويق لا يسجّل الإذن ★ مفتاح التحرير لا يكفي هنا بالمرّة.
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: تسجيل إذن العميل يحتاج صلاحية المراجعة القانونية';
  end if;
  if not exists (select 1 from public.cs_case_studies where id = p_id) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  insert into public.cs_permissions(case_study_id, recorded_by) values (p_id, auth.uid())
    on conflict (case_study_id) do nothing;

  update public.cs_permissions set
    permission_status        = coalesce(public.cs_txt(p_input, 'permission_status'), permission_status),
    permission_reference     = coalesce(public.cs_txt(p_input, 'permission_reference'), permission_reference),
    permission_document_note = coalesce(public.cs_txt(p_input, 'permission_document_note'), permission_document_note),
    permission_contact_name  = coalesce(public.cs_txt(p_input, 'permission_contact_name'), permission_contact_name),
    permission_granted_at    = coalesce(public.cs_ts(p_input, 'permission_granted_at'), permission_granted_at),
    permission_expires_at    = case when p_input ? 'permission_expires_at' then public.cs_ts(p_input, 'permission_expires_at') else permission_expires_at end,
    permitted_logo           = case when p_input ? 'permitted_logo' then public.cs_bool(p_input, 'permitted_logo', permitted_logo) else permitted_logo end,
    permitted_project_name   = case when p_input ? 'permitted_project_name' then public.cs_bool(p_input, 'permitted_project_name', permitted_project_name) else permitted_project_name end,
    permitted_metrics        = case when p_input ? 'permitted_metrics' then public.cs_bool(p_input, 'permitted_metrics', permitted_metrics) else permitted_metrics end,
    permitted_testimonial    = case when p_input ? 'permitted_testimonial' then public.cs_bool(p_input, 'permitted_testimonial', permitted_testimonial) else permitted_testimonial end,
    confidentiality_restrictions = coalesce(public.cs_txt(p_input, 'confidentiality_restrictions'), confidentiality_restrictions),
    anonymization_required   = case when p_input ? 'anonymization_required' then public.cs_bool(p_input, 'anonymization_required', anonymization_required) else anonymization_required end,
    embargo_until            = case when p_input ? 'embargo_until' then public.cs_ts(p_input, 'embargo_until') else embargo_until end,
    recorded_by              = auth.uid(),
    recorded_at              = now()
  where case_study_id = p_id;

  perform public.cs_log('permission_set', p_id, true,
    jsonb_build_object('status', public.cs_txt(p_input, 'permission_status')));
  return true;
end $$;

-- ─── النسخ ─────────────────────────────────────────────────────────────────
create or replace function public.cs_version_new(p_id uuid, p_summary text, p_rolled_from int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_num int; v_ver uuid;
begin
  if coalesce(btrim(p_summary), '') = '' or length(btrim(p_summary)) < 8 then
    raise exception 'validation: ملخّص التغيير مطلوب ولا يقلّ عن ٨ محارف';
  end if;
  update public.cs_case_studies set current_version = current_version + 1
   where id = p_id returning current_version into v_num;
  if v_num is null then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  insert into public.cs_versions(case_study_id, version_number, change_summary, snapshot, rolled_back_from, created_by)
  values (p_id, v_num, btrim(p_summary), public.cs_snapshot_build(p_id), p_rolled_from, auth.uid())
  returning id into v_ver;
  return v_ver;
end $$;

create or replace function public.cs_versions_list(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'version_number', v.version_number, 'change_summary', v.change_summary,
      'is_approved', v.is_approved, 'is_published', v.is_published,
      'rolled_back_from', v.rolled_back_from,
      'created_by', v.created_by, 'created_at', v.created_at,
      'approved_at', v.approved_at, 'published_at', v.published_at)
      order by v.version_number desc)
      from public.cs_versions v where v.case_study_id = p_id), '[]'::jsonb);
end $$;

/**
 * ★ التراجع يُنشئ نسخة جديدة ★ يُعيد محتوى نسخة قديمة إلى الصفّ الحيّ **و**
 * يسجّلها نسخةً جديدة مرقّمة تشير إلى أصلها. لا يُحذف صفّ نسخة ولا يُعدَّل،
 * ولا يُنشَر شيء تلقائيًّا: العودة إلى العلن تمرّ بالاعتماد ثمّ نشر المالك.
 */
create or replace function public.cs_rollback(p_id uuid, p_version int, p_summary text) returns uuid
language plpgsql security definer set search_path = public as $$
declare snap jsonb; b jsonb; v_new uuid;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: التراجع عن نسخة يحتاج صلاحية المراجعة';
  end if;
  select v.snapshot into snap from public.cs_versions v
   where v.case_study_id = p_id and v.version_number = p_version;
  if snap is null then raise exception 'not_found: النسخة المطلوبة غير موجودة'; end if;
  b := snap -> 'body';

  update public.cs_case_studies set
    public_title_ar = snap ->> 'title_ar',   public_title_en = snap ->> 'title_en',
    summary_ar = snap ->> 'summary_ar',      summary_en = snap ->> 'summary_en',
    challenge_ar = b ->> 'challenge_ar',     challenge_en = b ->> 'challenge_en',
    objectives_ar = b ->> 'objectives_ar',   objectives_en = b ->> 'objectives_en',
    creative_approach_ar = b ->> 'creative_approach_ar', creative_approach_en = b ->> 'creative_approach_en',
    production_approach_ar = b ->> 'production_approach_ar', production_approach_en = b ->> 'production_approach_en',
    operational_complexity_ar = b ->> 'operational_complexity_ar', operational_complexity_en = b ->> 'operational_complexity_en',
    equipment_summary_ar = b ->> 'equipment_summary_ar', equipment_summary_en = b ->> 'equipment_summary_en',
    safety_compliance_ar = b ->> 'safety_compliance_ar', safety_compliance_en = b ->> 'safety_compliance_en',
    timeline_summary_ar = b ->> 'timeline_summary_ar', timeline_summary_en = b ->> 'timeline_summary_en',
    deliverables_summary_ar = b ->> 'deliverables_summary_ar', deliverables_summary_en = b ->> 'deliverables_summary_en',
    challenges_faced_ar = b ->> 'challenges_faced_ar', challenges_faced_en = b ->> 'challenges_faced_en',
    solution_ar = b ->> 'solution_ar',       solution_en = b ->> 'solution_en',
    results_ar = b ->> 'results_ar',         results_en = b ->> 'results_en',
    seo_title_ar = (snap -> 'seo') ->> 'title_ar', seo_title_en = (snap -> 'seo') ->> 'title_en',
    seo_description_ar = (snap -> 'seo') ->> 'description_ar', seo_description_en = (snap -> 'seo') ->> 'description_en',
    og_title_ar = (snap -> 'seo') ->> 'og_title_ar', og_title_en = (snap -> 'seo') ->> 'og_title_en',
    og_description_ar = (snap -> 'seo') ->> 'og_description_ar', og_description_en = (snap -> 'seo') ->> 'og_description_en',
    has_unapproved_changes = true,
    updated_by = auth.uid(), updated_at = now()
  where id = p_id;

  v_new := public.cs_version_new(p_id, p_summary, p_version);
  perform public.cs_log('rollback', p_id, true, jsonb_build_object('from_version', p_version, 'new_version_id', v_new));
  return v_new;
end $$;

-- ─── آلة الحالات ───────────────────────────────────────────────────────────
create or replace function public.cs_submit(p_id uuid, p_summary text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not coalesce(public.can_edit_case_studies(), false) then
    raise exception 'not_authorized: لا تملك صلاحية تحرير دراسات الحالة';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status not in ('draft','unpublished') then
    raise exception 'validation: لا يمكن الإرسال للمراجعة من الحالة %', c.status;
  end if;
  perform public.cs_version_new(p_id, p_summary, null);
  update public.cs_case_studies
     set status = 'internal_review', submitted_by = auth.uid(), submitted_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_log('submit', p_id, true, jsonb_build_object('summary', p_summary));
  return true;
end $$;

create or replace function public.cs_review_decide(p_id uuid, p_decision text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: المراجعة الداخلية تحتاج صلاحية المراجعة';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status <> 'internal_review' then
    raise exception 'validation: الدراسة ليست في المراجعة الداخلية (الحالة: %)', c.status;
  end if;
  if p_decision not in ('advance','return') then raise exception 'validation: قرار غير معروف'; end if;
  if p_decision = 'return' and coalesce(btrim(p_note), '') = '' then
    raise exception 'validation: الإعادة تحتاج سببًا مكتوبًا';
  end if;
  update public.cs_case_studies
     set status = case when p_decision = 'advance' then 'legal_review' else 'draft' end,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_log('review_' || p_decision, p_id, true, jsonb_build_object('note', p_note));
  return true;
end $$;

create or replace function public.cs_legal_decide(p_id uuid, p_decision text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record; b jsonb; hard int;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: المراجعة القانونية تحتاج صلاحية المراجعة';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status <> 'legal_review' then
    raise exception 'validation: الدراسة ليست في المراجعة القانونية (الحالة: %)', c.status;
  end if;
  if p_decision not in ('approve','need_permission','return') then raise exception 'validation: قرار غير معروف'; end if;

  if p_decision = 'approve' then
    -- ★ لا تجاوز للبوّابة ★ الاعتماد القانونيّ المباشر مسموح فقط حين لا تحتاج
    --   الدراسة إذنًا: أيّ مانع متعلّق بالإذن يُحوّلها إلى مسار الإذن قسرًا.
    b := public.cs_publish_blockers(p_id);
    select count(*) into hard from jsonb_array_elements(b) e
     where e ->> 'severity' = 'blocker' and (e ->> 'code') like '%permission%';
    if hard > 0 then
      raise exception 'validation: لا يمكن الاعتماد القانونيّ قبل تسوية الإذن — %', b::text;
    end if;
  end if;
  if p_decision = 'return' and coalesce(btrim(p_note), '') = '' then
    raise exception 'validation: الإعادة تحتاج سببًا مكتوبًا';
  end if;

  update public.cs_case_studies
     set status = case p_decision when 'approve' then 'approved'
                                  when 'need_permission' then 'client_permission_required'
                                  else 'draft' end,
         legal_by = auth.uid(), legal_at = now(),
         approved_by = case when p_decision = 'approve' then auth.uid() else approved_by end,
         approved_at = case when p_decision = 'approve' then now() else approved_at end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;

  if p_decision = 'approve' then perform public.cs_mark_approved(p_id); end if;
  perform public.cs_log('legal_' || p_decision, p_id, true, jsonb_build_object('note', p_note));
  return true;
end $$;

/** يعلّم أحدث نسخة بأنّها المعتمَدة، ويربطها بالدراسة. */
create or replace function public.cs_mark_approved(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ver uuid;
begin
  select id into v_ver from public.cs_versions
   where case_study_id = p_id order by version_number desc limit 1;
  if v_ver is null then
    raise exception 'validation: لا توجد نسخة لاعتمادها — أرسِل الدراسة للمراجعة أوّلًا';
  end if;
  update public.cs_versions set is_approved = true, approved_by = auth.uid(), approved_at = now()
   where id = v_ver;
  update public.cs_case_studies set approved_version_id = v_ver where id = p_id;
  return v_ver;
end $$;

create or replace function public.cs_permission_confirm(p_id uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record; p record;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: تأكيد استلام الإذن يحتاج صلاحية المراجعة';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status <> 'client_permission_required' then
    raise exception 'validation: الدراسة ليست بانتظار إذن العميل (الحالة: %)', c.status;
  end if;
  select * into p from public.cs_permissions where case_study_id = p_id;
  if coalesce(p.permission_status, 'not_requested') <> 'granted' then
    raise exception 'validation: لا إذن ممنوح مسجَّل — سجّل الإذن ومرجعه أوّلًا';
  end if;
  update public.cs_case_studies
     set status = 'client_permission_received', updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_log('permission_confirm', p_id, true, jsonb_build_object('note', p_note));
  return true;
end $$;

create or replace function public.cs_approve(p_id uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: الاعتماد يحتاج صلاحية المراجعة';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status not in ('client_permission_received','unpublished') then
    raise exception 'validation: لا يمكن الاعتماد من الحالة %', c.status;
  end if;
  update public.cs_case_studies
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_mark_approved(p_id);
  perform public.cs_log('approve', p_id, true, jsonb_build_object('note', p_note));
  return true;
end $$;

-- ─── النشر — ★ المالك وحده ★ ───────────────────────────────────────────────
create or replace function public.cs_publish(p_id uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record; b jsonb; hard int;
begin
  -- بلا مفتاح صلاحية وبلا is_admin: الملكيّة أو لا شيء.
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: النشر النهائيّ مقصور على المالك';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status not in ('approved','scheduled','unpublished') then
    raise exception 'validation: لا يمكن النشر من الحالة % — يجب أن تمرّ بالمراجعة والاعتماد', c.status;
  end if;
  if c.approved_version_id is null then
    raise exception 'validation: لا توجد نسخة معتمَدة للنشر';
  end if;
  b := public.cs_publish_blockers(p_id);
  select count(*) into hard from jsonb_array_elements(b) e where e ->> 'severity' = 'blocker';
  if hard > 0 then
    perform public.cs_log('publish', p_id, false, jsonb_build_object('blockers', b));
    raise exception 'validation: النشر ممنوع — % مانعًا: %', hard, b::text;
  end if;

  update public.cs_case_studies
     set status = 'published',
         published_version_id = approved_version_id,
         -- ★ لا «منشورة لكنّها غير ظاهرة» ★ موعد مستقبليّ متروك من جدولة سابقة
         --   كان سيجعل الحالة تقول «منشورة» والبوّابة تقول «لا». يُسحَب إلى الآن.
         publish_at = case when publish_at is null or publish_at > now() then now() else publish_at end,
         first_published_at = coalesce(first_published_at, now()),
         published_by = auth.uid(), published_at = now(),
         has_unapproved_changes = false,
         unpublished_at = null, unpublish_reason = null,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  update public.cs_versions set is_published = true, published_by = auth.uid(), published_at = now()
   where id = c.approved_version_id;
  perform public.cs_log('publish', p_id, true, jsonb_build_object('note', p_note, 'version_id', c.approved_version_id));
  return true;
end $$;

/**
 * الجدولة — ★ المالك وحده أيضًا ★ الجدولة قرار نشر مؤجَّل لا إعداد تحريريّ.
 * ⚠️ ملاحظة صدق: الدراسة المجدوَلة تصير عامّة **من تلقاء نفسها** لحظة بلوغ
 * publish_at، لأنّ cs_is_public() تقبل scheduled متى مضى الموعد. لا تعتمد على
 * cron ولا تنتظره. cs_publish_due() تسوية دفترية للحالة، لا مفتاح تشغيل.
 */
create or replace function public.cs_schedule(p_id uuid, p_at timestamptz, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record; b jsonb; hard int;
begin
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: الجدولة قرار نشر — مقصورة على المالك';
  end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status not in ('approved','scheduled','published') then
    raise exception 'validation: لا يمكن الجدولة من الحالة %', c.status;
  end if;
  if p_at is null or p_at <= now() then
    raise exception 'validation: موعد الجدولة يجب أن يكون في المستقبل';
  end if;
  if c.approved_version_id is null then raise exception 'validation: لا توجد نسخة معتمَدة'; end if;

  update public.cs_case_studies
     set status = 'scheduled', publish_at = p_at,
         published_version_id = coalesce(published_version_id, approved_version_id),
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  b := public.cs_publish_blockers(p_id);
  select count(*) into hard from jsonb_array_elements(b) e where e ->> 'severity' = 'blocker';
  if hard > 0 then raise exception 'validation: الجدولة ممنوعة — %', b::text; end if;
  perform public.cs_log('schedule', p_id, true, jsonb_build_object('at', p_at, 'note', p_note));
  return true;
end $$;

create or replace function public.cs_unpublish(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: سحب النشر مقصور على المالك';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'validation: سبب سحب النشر مطلوب'; end if;
  select * into c from public.cs_case_studies where id = p_id for update;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  if c.status not in ('published','scheduled') then
    raise exception 'validation: الدراسة ليست منشورة ولا مجدوَلة';
  end if;
  update public.cs_case_studies
     set status = 'unpublished', unpublished_at = now(), unpublish_reason = p_reason,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public.cs_log('unpublish', p_id, true, jsonb_build_object('reason', p_reason));
  return true;
end $$;

create or replace function public.cs_archive(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: الأرشفة مقصورة على المالك';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'validation: سبب الأرشفة مطلوب'; end if;
  update public.cs_case_studies
     set status = 'archived', archived = true, archived_at = now(), archive_reason = p_reason,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  perform public.cs_log('archive', p_id, true, jsonb_build_object('reason', p_reason));
  return true;
end $$;

create or replace function public.cs_restore(p_id uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: استعادة المؤرشف مقصورة على المالك';
  end if;
  update public.cs_case_studies
     set status = 'draft', archived = false, archived_at = null, archive_reason = null,
         has_unapproved_changes = true, updated_by = auth.uid(), updated_at = now()
   where id = p_id and archived;
  if not found then raise exception 'not_found: لا توجد دراسة مؤرشفة بهذا المعرّف'; end if;
  perform public.cs_log('restore', p_id, true, jsonb_build_object('note', p_note));
  return true;
end $$;

/**
 * تسوية دفترية للمجدوَل الذي حان موعده. **ليست** مفتاح تشغيل: الظهور العامّ
 * لا ينتظرها (أنظر cs_schedule). كلّ صفّ معزول باستثنائه، فمانع طارئ على
 * دراسة واحدة لا يوقف الباقي، ويُسجَّل في التدقيق بدل أن يُبتلع.
 */
create or replace function public.cs_publish_due() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; failed int := 0;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: هذه التسوية داخلية';
  end if;
  for r in select id from public.cs_case_studies
            where status = 'scheduled' and publish_at is not null and publish_at <= now() and not archived
  loop
    begin
      update public.cs_case_studies
         set status = 'published',
             first_published_at = coalesce(first_published_at, publish_at),
             published_at = coalesce(published_at, now()),
             updated_at = now()
       where id = r.id;
      n := n + 1;
    exception when others then
      failed := failed + 1;
      perform public.cs_log('publish_due', r.id, false, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('normalised', n, 'failed', failed);
end $$;

-- ─── قائمة التحقّق والمعاينة ───────────────────────────────────────────────
create or replace function public.cs_checklist(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.cs_case_studies%rowtype; p public.cs_permissions%rowtype;
        jc jsonb; pairs jsonb := '[]'::jsonb; ar_n int := 0; en_n int := 0; tot int := 0;
        k text; v_ar text; v_en text;
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  select * into c from public.cs_case_studies where id = p_id;
  if not found then raise exception 'not_found: دراسة الحالة غير موجودة'; end if;
  select * into p from public.cs_permissions where case_study_id = p_id;
  -- ★ ساكن لا ديناميكيّ ★ to_jsonb على الصفّ يغني عن execute format، فلا يصير
  --   اسم عمود نصًّا يُركَّب في وقت التشغيل.
  jc := to_jsonb(c);

  -- مقارنة اكتمال العربية والإنجليزية، حقلًا بحقل
  foreach k in array array['public_title','summary','challenge','objectives','creative_approach',
                           'production_approach','operational_complexity','equipment_summary',
                           'safety_compliance','timeline_summary','deliverables_summary',
                           'challenges_faced','solution','results','seo_title','seo_description']
  loop
    v_ar := btrim(coalesce(jc ->> (k || '_ar'), ''));
    v_en := btrim(coalesce(jc ->> (k || '_en'), ''));
    tot := tot + 1;
    if v_ar <> '' then ar_n := ar_n + 1; end if;
    if v_en <> '' then en_n := en_n + 1; end if;
    pairs := pairs || jsonb_build_object('field', k, 'ar', v_ar <> '', 'en', v_en <> '');
  end loop;

  return jsonb_build_object(
    'completeness', jsonb_build_object(
      'total_fields', tot, 'ar_filled', ar_n, 'en_filled', en_n,
      'ar_pct', case when tot = 0 then 0 else round((ar_n::numeric / tot) * 100) end,
      'en_pct', case when tot = 0 then 0 else round((en_n::numeric / tot) * 100) end,
      'fields', pairs),
    'seo_preview', jsonb_build_object(
      'canonical', coalesce(c.canonical_path, '/case-studies/' || c.slug),
      'title_ar', coalesce(nullif(btrim(coalesce(c.seo_title_ar, '')), ''), c.public_title_ar),
      'title_en', coalesce(nullif(btrim(coalesce(c.seo_title_en, '')), ''), c.public_title_en),
      'description_ar', coalesce(nullif(btrim(coalesce(c.seo_description_ar, '')), ''), left(coalesce(c.summary_ar, ''), 160)),
      'description_en', coalesce(nullif(btrim(coalesce(c.seo_description_en, '')), ''), left(coalesce(c.summary_en, ''), 160)),
      'og_title_ar', coalesce(c.og_title_ar, c.seo_title_ar, c.public_title_ar),
      'og_title_en', coalesce(c.og_title_en, c.seo_title_en, c.public_title_en),
      'og_image', (select m.public_url from public.cs_media m
                    where m.case_study_id = p_id and m.asset_kind in ('og_image','hero')
                    order by case when m.asset_kind = 'og_image' then 0 else 1 end, m.sort_order limit 1)),
    'permission_checklist', jsonb_build_array(
      jsonb_build_object('key','permission_status','ok', coalesce(p.permission_status,'not_requested') = 'granted','value', coalesce(p.permission_status,'not_requested')),
      jsonb_build_object('key','permission_reference','ok', coalesce(btrim(p.permission_reference), '') <> ''),
      jsonb_build_object('key','permitted_project_name','ok', coalesce(p.permitted_project_name,false)),
      jsonb_build_object('key','permitted_logo','ok', coalesce(p.permitted_logo,false)),
      jsonb_build_object('key','permitted_metrics','ok', coalesce(p.permitted_metrics,false)),
      jsonb_build_object('key','permitted_testimonial','ok', coalesce(p.permitted_testimonial,false)),
      jsonb_build_object('key','permission_expires_at','ok', p.permission_expires_at is null or p.permission_expires_at >= now(),'value', p.permission_expires_at)),
    'confidentiality_checklist', jsonb_build_array(
      jsonb_build_object('key','identity_visibility','value', c.client_identity_visibility),
      jsonb_build_object('key','anonymization_required','ok', not coalesce(p.anonymization_required,false),'value', coalesce(p.anonymization_required,false)),
      jsonb_build_object('key','embargo_until','ok', p.embargo_until is null or p.embargo_until <= now(),'value', p.embargo_until),
      jsonb_build_object('key','restrictions_recorded','ok', coalesce(btrim(p.confidentiality_restrictions), '') <> ''),
      jsonb_build_object('key','no_project_data_copied','ok', true,
                         'note','لا نسخ تلقائيّ من منصّة المشاريع — كلّ حقل عامّ مُدخَل يدويًّا'),
      jsonb_build_object('key','employee_consent','ok',
        not exists (select 1 from public.cs_credits k where k.case_study_id = p_id and k.is_employee and not k.consent_public),
        'suppressed', (select count(*) from public.cs_credits k where k.case_study_id = p_id and k.is_employee and not k.consent_public))),
    'blockers', public.cs_publish_blockers(p_id),
    'can_publish', coalesce(public.can_publish_case_studies(), false));
end $$;

/**
 * المعاينة الداخلية — **بالضبط** ما سيراه العامّ، مبنيًّا من المحتوى الحيّ
 * لا من اللقطة المنشورة، وبنفس دالّة التقنيع cs_mask. تطابق المعاينة والنشر
 * ليس وعدًا بل مسار كود واحد.
 * ⛔ ولا يوجد رابط معاينة: لا رمز، ولا جدول رموز، ولا مسار عامّ. من لا يملك
 *    جلسة داخلية لا يرى مسودّة، نقطة.
 */
create or replace function public.cs_preview(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  if not exists (select 1 from public.cs_case_studies where id = p_id) then
    raise exception 'not_found: دراسة الحالة غير موجودة';
  end if;
  return jsonb_build_object(
    'is_preview', true,
    'is_public_now', public.cs_is_public(p_id),
    'projection', public.cs_mask(p_id, public.cs_snapshot_build(p_id), true));
end $$;

create or replace function public.cs_audit_list(p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; lim int;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: سجلّ التدقيق مقصور على المراجعة والملكيّة';
  end if;
  sid := nullif(btrim(coalesce(p_params ->> 'case_study_id', '')), '')::uuid;
  lim := least(greatest(coalesce((nullif(btrim(coalesce(p_params ->> 'limit', '')), ''))::int, 100), 1), 500);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'case_study_id', a.case_study_id, 'action', a.action,
                                        'actor', a.actor, 'ok', a.ok, 'details', a.details, 'at', a.at)
             order by a.at desc)
      from (select * from public.cs_audit
             where (sid is null or case_study_id = sid) order by at desc limit lim) a), '[]'::jsonb);
end $$;

/**
 * تصدير داخليّ. كلّ خليّة تمرّ من cs_csv_cell: خليّة تبدأ بـ= أو + أو - أو @
 * تُنفَّذ كصيغة عند الفتح في Excel، وهذا حقن حقيقيّ لا نظريّ.
 */
create or replace function public.cs_export_csv(p_params jsonb default '{}'::jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare out_txt text; st text;
begin
  if not coalesce(public.can_view_case_studies_internal(), false) then
    raise exception 'not_authorized: لا تملك صلاحية عرض دراسات الحالة';
  end if;
  st := nullif(btrim(coalesce(p_params ->> 'status', '')), '');
  out_txt := 'code,internal_title,slug,status,visibility,permission_status,publish_at,version' || chr(10);
  select out_txt || coalesce(string_agg(
      public.cs_csv_cell(c.code) || ',' || public.cs_csv_cell(c.internal_title) || ',' ||
      public.cs_csv_cell(c.slug) || ',' || public.cs_csv_cell(c.status) || ',' ||
      public.cs_csv_cell(c.client_identity_visibility) || ',' ||
      public.cs_csv_cell(coalesce(p.permission_status, 'not_requested')) || ',' ||
      public.cs_csv_cell(coalesce(c.publish_at::text, '')) || ',' ||
      public.cs_csv_cell(c.current_version::text), chr(10) order by c.updated_at desc), '')
    into out_txt
    from public.cs_case_studies c
    left join public.cs_permissions p on p.case_study_id = c.id
   where (st is null or c.status = st);
  return out_txt;
end $$;

create or replace function public.cs_settings_set(p_input jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  -- ★ مفتاح السطح العامّ قرار نشر ★ المالك وحده يقلبه.
  if not coalesce(public.can_publish_case_studies(), false) then
    raise exception 'not_authorized: إعدادات النشر العامّ مقصورة على المالك';
  end if;
  update public.cs_settings set
    public_enabled                 = case when p_input ? 'public_enabled' then public.cs_bool(p_input, 'public_enabled', public_enabled) else public_enabled end,
    require_permission_for_publish = case when p_input ? 'require_permission_for_publish' then public.cs_bool(p_input, 'require_permission_for_publish', require_permission_for_publish) else require_permission_for_publish end,
    require_metadata_stripped      = case when p_input ? 'require_metadata_stripped' then public.cs_bool(p_input, 'require_metadata_stripped', require_metadata_stripped) else require_metadata_stripped end,
    require_virus_scan             = case when p_input ? 'require_virus_scan' then public.cs_bool(p_input, 'require_virus_scan', require_virus_scan) else require_virus_scan end,
    virus_scan_provider            = case when p_input ? 'virus_scan_provider' then public.cs_txt(p_input, 'virus_scan_provider') else virus_scan_provider end,
    media_allowed_hosts            = case when p_input ? 'media_allowed_hosts'
                                       then coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(p_input -> 'media_allowed_hosts') x
                                                       where btrim(x) ~ '^[a-z0-9.-]{3,120}$'), '{}'::text[])
                                       else media_allowed_hosts end,
    max_media_bytes                = coalesce(public.cs_int(p_input, 'max_media_bytes'), max_media_bytes),
    public_page_size               = coalesce(public.cs_int(p_input, 'public_page_size'), public_page_size),
    related_count                  = coalesce(public.cs_int(p_input, 'related_count'), related_count),
    default_anonymized_label_ar    = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'default_anonymized_label_ar')), default_anonymized_label_ar),
    default_anonymized_label_en    = coalesce(public.cs_sanitize(public.cs_txt(p_input, 'default_anonymized_label_en')), default_anonymized_label_en),
    updated_by = auth.uid(), updated_at = now()
  where id = true;
  perform public.cs_log('settings_set', null, true, p_input - 'media_allowed_hosts');
  return true;
end $$;

create or replace function public.cs_taxonomy_upsert(p_kind text, p_input jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_slug text;
begin
  if not coalesce(public.can_review_case_studies(), false) then
    raise exception 'not_authorized: تعديل الكتالوج يحتاج صلاحية المراجعة';
  end if;
  if p_kind not in ('sector','service') then raise exception 'validation: نوع كتالوج غير معروف'; end if;
  v_slug := public.cs_slugify(coalesce(public.cs_txt(p_input, 'slug'), public.cs_txt(p_input, 'name_en')));
  if v_slug is null then raise exception 'validation: الـslug مطلوب'; end if;

  if p_kind = 'sector' then
    insert into public.cs_sectors(slug, name_ar, name_en, sort_order, active)
    values (v_slug, coalesce(public.cs_sanitize(public.cs_txt(p_input, 'name_ar')), v_slug),
                    coalesce(public.cs_sanitize(public.cs_txt(p_input, 'name_en')), v_slug),
                    coalesce(public.cs_int(p_input, 'sort_order'), 100),
                    public.cs_bool(p_input, 'active', true))
    on conflict (slug) do update set
      name_ar = excluded.name_ar, name_en = excluded.name_en,
      sort_order = excluded.sort_order, active = excluded.active
    returning id into v_id;
  else
    insert into public.cs_services(slug, name_ar, name_en, sort_order, active)
    values (v_slug, coalesce(public.cs_sanitize(public.cs_txt(p_input, 'name_ar')), v_slug),
                    coalesce(public.cs_sanitize(public.cs_txt(p_input, 'name_en')), v_slug),
                    coalesce(public.cs_int(p_input, 'sort_order'), 100),
                    public.cs_bool(p_input, 'active', true))
    on conflict (slug) do update set
      name_ar = excluded.name_ar, name_en = excluded.name_en,
      sort_order = excluded.sort_order, active = excluded.active
    returning id into v_id;
  end if;
  perform public.cs_log('taxonomy_upsert', null, true, jsonb_build_object('kind', p_kind, 'slug', v_slug));
  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ١٩) RLS — قراءة فقط، وكلّ كتابة عبر RPC مُدقَّقة
--
-- ★ طبقتان لا واحدة ★ الوصول المباشر بجدول عبر PostgREST **ممنوع** بالإلغاء
--   الصريح للصلاحيات أدناه، والسياسات هنا خطّ ثانٍ لو مُنحت صلاحية يومًا
--   (سهوًا أو بـgrant عامّ). سياسة بلا صلاحية غير ضارّة؛ صلاحية بلا سياسة كارثة.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['cs_settings','cs_sectors','cs_services','cs_case_studies',
                           'cs_permissions','cs_media','cs_metrics','cs_credits',
                           'cs_case_study_sectors','cs_case_study_services','cs_versions','cs_audit']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $rls$;

drop policy if exists cs_settings_read on public.cs_settings;
create policy cs_settings_read on public.cs_settings for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_sectors_read on public.cs_sectors;
create policy cs_sectors_read on public.cs_sectors for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_services_read on public.cs_services;
create policy cs_services_read on public.cs_services for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_case_studies_read on public.cs_case_studies;
create policy cs_case_studies_read on public.cs_case_studies for select
  using (coalesce(public.can_view_case_studies_internal(), false));

-- ★ بيانات الإذن القانونية أضيق ★ مرجع العقد واسم جهة الاتّصال وقيود السرّية
--   لا يراها كلّ من يرى الوحدة.
drop policy if exists cs_permissions_read on public.cs_permissions;
create policy cs_permissions_read on public.cs_permissions for select
  using (coalesce(public.can_review_case_studies(), false));

drop policy if exists cs_media_read on public.cs_media;
create policy cs_media_read on public.cs_media for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_metrics_read on public.cs_metrics;
create policy cs_metrics_read on public.cs_metrics for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_credits_read on public.cs_credits;
create policy cs_credits_read on public.cs_credits for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_cs_sectors_read on public.cs_case_study_sectors;
create policy cs_cs_sectors_read on public.cs_case_study_sectors for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_cs_services_read on public.cs_case_study_services;
create policy cs_cs_services_read on public.cs_case_study_services for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_versions_read on public.cs_versions;
create policy cs_versions_read on public.cs_versions for select
  using (coalesce(public.can_view_case_studies_internal(), false));

drop policy if exists cs_audit_read on public.cs_audit;
create policy cs_audit_read on public.cs_audit for select
  using (coalesce(public.can_review_case_studies(), false));

-- ════════════════════════════════════════════════════════════════════════════
-- ٢٠) الصلاحيات
-- ════════════════════════════════════════════════════════════════════════════
do $grants$
declare t text; f text;
begin
  -- (أ) لا وصول مباشر بجدول لأيّ دور عميل — لا anon ولا authenticated.
  foreach t in array array['cs_settings','cs_sectors','cs_services','cs_case_studies',
                           'cs_permissions','cs_media','cs_metrics','cs_credits',
                           'cs_case_study_sectors','cs_case_study_services','cs_versions','cs_audit']
  loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
  end loop;
  execute 'revoke all on sequence public.cs_code_seq from anon';
  execute 'revoke all on sequence public.cs_code_seq from authenticated';
  execute 'revoke all on sequence public.cs_audit_id_seq from anon';
  execute 'revoke all on sequence public.cs_audit_id_seq from authenticated';

  -- (ب) المُسنَدات: authenticated فقط (تُقيَّم بدور المستدعي داخل السياسات).
  foreach f in array array['can_view_case_studies_internal()','can_edit_case_studies()',
                           'can_review_case_studies()','can_publish_case_studies()']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  -- (ج) الواجهة الداخلية: authenticated فقط، ولا anon إطلاقًا.
  foreach f in array array[
    'cs_access()','cs_lookups()','cs_list(jsonb)','cs_get(uuid)','cs_upsert(jsonb)',
    'cs_set_taxonomy(uuid,text[],text[])','cs_media_upsert(jsonb)','cs_media_delete(uuid,text)',
    'cs_metric_upsert(jsonb)','cs_metric_delete(uuid,text)','cs_credit_upsert(jsonb)',
    'cs_credit_delete(uuid,text)','cs_permission_set(uuid,jsonb)','cs_versions_list(uuid)',
    'cs_rollback(uuid,int,text)','cs_submit(uuid,text)','cs_review_decide(uuid,text,text)',
    'cs_legal_decide(uuid,text,text)','cs_permission_confirm(uuid,text)','cs_approve(uuid,text)',
    'cs_publish(uuid,text)','cs_schedule(uuid,timestamptz,text)','cs_unpublish(uuid,text)',
    'cs_archive(uuid,text)','cs_restore(uuid,text)','cs_publish_due()','cs_checklist(uuid)',
    'cs_preview(uuid)','cs_audit_list(jsonb)','cs_export_csv(jsonb)','cs_settings_set(jsonb)',
    'cs_taxonomy_upsert(text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  -- (د) ★ السطح العامّ: ثلاث دوالّ قراءة، ولا رابعة ★
  foreach f in array array['cs_public_index(jsonb)','cs_public_study(text)','cs_public_slugs()']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;

  -- (هـ) الدوالّ الداخلية: محجوبة عن anon **و** authenticated.
  foreach f in array array[
    'cs_txt(jsonb,text)','cs_bool(jsonb,text,boolean)','cs_int(jsonb,text)','cs_ts(jsonb,text)',
    'cs_date(jsonb,text)','cs_sanitize(text)','cs_sanitize_block(text)','cs_csv_cell(text)',
    'cs_slugify(text)','cs_perm(text)','cs_is_staff()','cs_is_owner()','cs_is_admin()',
    'cs_log(text,uuid,boolean,jsonb)','cs_touch(uuid)','cs_snapshot_build(uuid)',
    'cs_mask(uuid,jsonb,boolean)','cs_public_row(uuid,boolean)','cs_is_public(uuid)',
    'cs_publish_blockers(uuid)','cs_version_new(uuid,text,int)','cs_mark_approved(uuid)',
    'cs_versions_immutable()','cs_guard_publish()']
  loop
    begin
      execute format('revoke all on function public.%s from public', f);
      execute format('revoke all on function public.%s from anon', f);
      execute format('revoke all on function public.%s from authenticated', f);
    exception when undefined_object then null; end;
  end loop;
end $grants$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢١) البذور
--
-- ★ إعادة استخدام المفردات ★ القطاعات من components/Industries.tsx والخدمات
--   من components/Services.tsx حرفيًّا. لو اخترعنا تسميات جديدة لصار للموقع
--   مفرداتان لنفس المفهوم — وهو بالضبط ما يمنعه العقد.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.cs_sectors(slug, name_ar, name_en, sort_order) values
  ('government','الجهات الحكومية','Government',10),
  ('real-estate','التطوير العقاري','Real Estate',20),
  ('healthcare','القطاع الصحي','Healthcare',30),
  ('automotive','السيارات','Automotive',40),
  ('industrial','القطاع الصناعي','Industrial',50),
  ('corporate','الشركات الكبرى','Corporate',60),
  ('hospitality','الضيافة والفنادق','Hospitality',70),
  ('events','الفعاليات والمعارض','Events',80),
  ('entertainment','الترفيه والإعلام','Entertainment',90),
  ('luxury-brands','العلامات الفاخرة','Luxury Brands',100),
  ('restaurants-cafes','المطاعم والمقاهي','Restaurants & Cafés',110),
  ('sports','الرياضة','Sports',120),
  ('cinematic-productions','الإنتاج السينمائي','Cinematic Productions',130),
  ('commercial-campaigns','الحملات التجارية','Commercial Campaigns',140),
  ('weddings','الأعراس','Weddings',150)
on conflict (slug) do nothing;

insert into public.cs_services(slug, name_ar, name_en, sort_order) values
  ('cinematic','الإنتاج السينمائي','Cinematic Production',10),
  ('commercial','الإعلانات التجارية','Commercial Ads',20),
  ('corporate','الأفلام المؤسسية','Corporate Films',30),
  ('documentary','الأفلام الوثائقية','Documentary Films',40),
  ('drone','التصوير الجوي بالدرون','Drone Cinematography',50),
  ('events','تغطية الفعاليات','Event Coverage',60),
  ('live','البث المباشر متعدد الكاميرات','Live Streaming & Multi-Cam',70),
  ('realestate','التصوير العقاري السينمائي','Real Estate Cinematic',80),
  ('product','إعلانات المنتجات','Product Commercials',90),
  ('social','حملات السوشيال ميديا','Social Media Campaigns',100),
  ('story','سرد قصص العلامات','Brand Storytelling',110),
  ('direction','الإخراج الإبداعي','Creative Direction',120),
  ('podcast','إنتاج البودكاست','Podcast Production',130),
  ('photo','التصوير الفوتوغرافي','Photography',140),
  ('gov','إنتاجات الجهات الحكومية والشركات','Government & Corporate',150),
  ('wedding','أفلام الأعراس الفاخرة','Luxury Wedding Cinematography',160)
on conflict (slug) do nothing;

-- ─── مفاتيح الصلاحيات ──────────────────────────────────────────────────────
-- ثلاثة فقط. ⛔ **لا مفتاح نشر**: النشر ملكيّ بنيويًّا، والمفتاح غير الموجود
--    لا يُمنَح سهوًا ولا يُنسى ممنوحًا.
do $perm$
begin
  if to_regclass('public.permissions') is not null then
    execute $ins$
      insert into public.permissions(key, label_ar, label_en, category, sensitivity, enabled) values
        ('case_study.view','عرض دراسات الحالة','View case studies','case_study','normal',true),
        ('case_study.edit','تحرير دراسات الحالة','Edit case studies','case_study','normal',true),
        ('case_study.review','مراجعة دراسات الحالة وتسجيل الإذن','Review case studies and record permission','case_study','sensitive',true)
      on conflict (key) do nothing
    $ins$;
  end if;
exception when others then null;   -- كتالوج الصلاحيات اختياريّ بنيويًّا
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- ٢٢) SELF-TEST — ★ ساكن بالكامل ★
--
-- لا استدعاء لدالّة محميّة واحدة: المحرّر يعمل بدور postgres و auth.uid()=NULL،
-- فاستدعاء بوّابة حيّة يرفع «not authorized» ويُسقط الترحيلة، أو يعيد false
-- فيُقرأ خطأً على أنّها مكسورة. كلّ تأكيد أدناه يقرأ **تعريف** الكائن من
-- كتالوج النظام. والـdeparser يرفع حالة الكلمات المفتاحية، فالمطابقة على
-- مُعرِّفات صغيرة الحروف. ولا مصيدة catch-all: كلّ سطر قادر على الفشل.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare d text; n int; t text;
begin
  -- (١) الجداول
  foreach t in array array['cs_settings','cs_sectors','cs_services','cs_case_studies',
                           'cs_permissions','cs_media','cs_metrics','cs_credits',
                           'cs_case_study_sectors','cs_case_study_services','cs_versions','cs_audit']
  loop
    if to_regclass('public.' || t) is null then raise exception 'SELF-TEST: الجدول % مفقود', t; end if;
    if (select not c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then
      raise exception 'SELF-TEST: RLS غير مفعَّل على %', t;
    end if;
  end loop;

  -- (٢) المُسنَدات الأربعة: boolean · definer · search_path · لا NULL
  foreach t in array array['can_view_case_studies_internal()','can_edit_case_studies()',
                           'can_review_case_studies()','can_publish_case_studies()',
                           'cs_perm(text)','cs_is_owner()','cs_is_staff()','cs_is_admin()',
                           'cs_is_public(uuid)']
  loop
    if to_regprocedure('public.' || t) is null then raise exception 'SELF-TEST: المُسنَد % مفقود', t; end if;
    if (select p.prorettype <> 'boolean'::regtype from pg_proc p where p.oid = to_regprocedure('public.' || t)) then
      raise exception 'SELF-TEST: المُسنَد % لا يعيد boolean — السياسات فوقه تصير «غير محدَّد» وهو ليس منعًا', t;
    end if;
    if (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.' || t)) then
      raise exception 'SELF-TEST: المُسنَد % ليس security definer', t;
    end if;
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d not ilike '%search_path%' then raise exception 'SELF-TEST: search_path غير مثبَّت في %', t; end if;
    if d not ilike '%coalesce%' and d not ilike '%return false%' then
      raise exception 'SELF-TEST: المُسنَد % قد يعيد NULL', t;
    end if;
  end loop;

  -- (٣) ★ النشر ملكيّ ★ لا مفتاح صلاحية ولا is_admin ولا is_staff داخله.
  d := pg_get_functiondef(to_regprocedure('public.can_publish_case_studies()'));
  if d ilike '%cs_perm%' or d ilike '%emp_has_permission%' then
    raise exception 'SELF-TEST: can_publish_case_studies يستند إلى مفتاح صلاحية — النشر يجب أن يكون ملكيًّا بنيويًّا';
  end if;
  if d ilike '%cs_is_admin%' or d ilike '%cs_is_staff%' then
    raise exception 'SELF-TEST: can_publish_case_studies يقبل مديرًا أو موظّفًا — النشر للمالك وحده';
  end if;
  -- ولا مفتاح نشر في الكتالوج. (query_to_xml كي يُبلَّغ عن غياب الجدول بدل
  -- أن ينهار الملفّ معه بـ42P01 — كتالوج الصلاحيات اعتماديّة اختيارية.)
  if to_regclass('public.permissions') is not null then
    if (xpath('/row/c/text()', query_to_xml(
         'select count(*) as c from public.permissions where key = ''case_study.publish''',
         false, true, '')))[1]::text::int > 0 then
      raise exception 'SELF-TEST: وُجد مفتاح case_study.publish — المفتاح غير الموجود لا يُمنَح سهوًا ولا يُنسى ممنوحًا';
    end if;
  end if;

  -- (٤) ★ دوالّ النشر الثلاث تفحص الموانع فعلًا ★
  foreach t in array array['cs_publish(uuid,text)','cs_schedule(uuid,timestamptz,text)']
  loop
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d not ilike '%can_publish_case_studies%' then
      raise exception 'SELF-TEST: % لا تتحقّق من ملكيّة النشر', t;
    end if;
    if d not ilike '%cs_publish_blockers%' then
      raise exception 'SELF-TEST: % لا تستدعي محرّك الموانع', t;
    end if;
  end loop;
  foreach t in array array['cs_unpublish(uuid,text)','cs_archive(uuid,text)','cs_restore(uuid,text)','cs_settings_set(jsonb)']
  loop
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d not ilike '%can_publish_case_studies%' then
      raise exception 'SELF-TEST: % ليست مقصورة على المالك', t;
    end if;
  end loop;

  -- (٥) ★ الطبقة الثانية ★ المُشغِّل الحارس قائم على الجدول
  select count(*) into n from pg_trigger
   where tgrelid = 'public.cs_case_studies'::regclass and tgname = 'trg_cs_guard_publish' and not tgisinternal;
  if n <> 1 then raise exception 'SELF-TEST: حارس النشر على الجدول مفقود — كتابة مباشرة تتخطّى الموانع'; end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_guard_publish()'));
  if d not ilike '%cs_publish_blockers%' then raise exception 'SELF-TEST: الحارس لا يفحص الموانع'; end if;
  if d not ilike '%published_version_id%' then raise exception 'SELF-TEST: الحارس لا يشترط نسخة منشورة'; end if;

  -- (٦) ★ محرّك الموانع يغطّي المستحيلات المنصوص عليها ★
  d := pg_get_functiondef(to_regprocedure('public.cs_publish_blockers(uuid)'));
  foreach t in array array['named_without_permission','logo_without_permission',
                           'metrics_without_permission','testimonial_without_permission',
                           'anonymization_required','embargo_active','media_infected',
                           'media_metadata_not_stripped','media_host_not_allowed','no_hero_media']
  loop
    if d not ilike '%' || t || '%' then raise exception 'SELF-TEST: المانع % غير مُطبَّق', t; end if;
  end loop;

  -- (٧) ★ لا تعديل صامت بعد النشر ★ العامّ يقرأ اللقطة لا الصفّ الحيّ
  d := pg_get_functiondef(to_regprocedure('public.cs_public_row(uuid,boolean)'));
  if d not ilike '%published_version_id%' or d not ilike '%cs_versions%' then
    raise exception 'SELF-TEST: الإسقاط العامّ لا يقرأ من لقطة النسخة المنشورة';
  end if;
  if d not ilike '%cs_is_public%' then raise exception 'SELF-TEST: الإسقاط العامّ بلا بوّابة'; end if;

  -- (٨) ★ الأقنعة حيّة ★ سحب الإذن أو الموافقة يسري فورًا
  d := pg_get_functiondef(to_regprocedure('public.cs_mask(uuid,jsonb,boolean)'));
  if d not ilike '%permitted_project_name%' or d not ilike '%permitted_logo%'
     or d not ilike '%permitted_metrics%' or d not ilike '%permitted_testimonial%' then
    raise exception 'SELF-TEST: التقنيع لا يقرأ أعلام الإذن الحيّة';
  end if;
  if d not ilike '%consent_public%' then
    raise exception 'SELF-TEST: التقنيع لا يعيد التحقّق من موافقة نشر الاسم — سحب الموافقة لن يسري';
  end if;
  if d not ilike '%anonymization_required%' then
    raise exception 'SELF-TEST: التقنيع يتجاهل اشتراط التجهيل';
  end if;

  -- (٨-ب) ★ المحو الصريح ساكن، والهويّة خارجه ★
  d := pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)'));
  if d not ilike '%v_clear%' then
    raise exception 'SELF-TEST: cs_upsert بلا باب محو صريح — كلّ إسناد coalesce، فنصّ كُتب خطأً يبقى للأبد';
  end if;
  if d ilike '%execute format%' then
    raise exception 'SELF-TEST: cs_upsert يبني SQL في وقت التشغيل — قائمة المحو يجب أن تكون ساكنة';
  end if;
  if d ~* '''(slug|internal_title|status|client_identity_visibility)''[[:space:]]*=[[:space:]]*any\(v_clear\)' then
    raise exception 'SELF-TEST: عمود هويّة داخل قائمة المحو — الـslug والحالة ليست حقول تحرير';
  end if;

  -- (٩) ★ المعاينة والنشر مسار واحد ★
  d := pg_get_functiondef(to_regprocedure('public.cs_preview(uuid)'));
  if d not ilike '%cs_mask%' then
    raise exception 'SELF-TEST: المعاينة لا تستعمل دالّة التقنيع نفسها — قد تُظهر ما لن يُنشر';
  end if;

  -- (١٠) ⛔ لا نسخ من منصّة المشاريع المجمَّدة، ولا مفتاح أجنبيّ إليها
  foreach t in array array['cs_snapshot_build(uuid)','cs_mask(uuid,jsonb,boolean)',
                           'cs_public_row(uuid,boolean)','cs_upsert(jsonb)',
                           'cs_public_index(jsonb)','cs_public_study(text)','cs_publish(uuid,text)']
  loop
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d ilike '%public.projects%' or d ilike '%project_core%' or d ilike '%deliverables%'
       or d ilike '%deliverable_internal%' then
      raise exception 'SELF-TEST: % تقرأ من منصّة المشاريع — النسخ التلقائيّ ممنوع', t;
    end if;
  end loop;
  select count(*) into n from pg_constraint c
    join pg_class ref on ref.oid = c.confrelid
    join pg_class src on src.oid = c.conrelid
   where src.relname like 'cs\_%' and c.contype = 'f'
     and ref.relname in ('projects','project_core','deliverables','deliverable_internal','project_transition_requests');
  if n > 0 then raise exception 'SELF-TEST: مفتاح أجنبيّ إلى منصّة المشاريع المجمَّدة'; end if;

  -- (١١) ⛔ لا project_id ولا حقل داخليّ في أيّ مخرَج عامّ
  foreach t in array array['cs_mask(uuid,jsonb,boolean)','cs_snapshot_build(uuid)']
  loop
    d := pg_get_functiondef(to_regprocedure('public.' || t));
    if d ilike '%project_id%' or d ilike '%internal_notes%' or d ilike '%project_reference_note%'
       or d ilike '%permission_reference%' or d ilike '%permission_contact_name%'
       or d ilike '%confidentiality_restrictions%' or d ilike '%source_note%'
       or d ilike '%employee_user_id%' then
      raise exception 'SELF-TEST: % تُسرّب حقلًا داخليًّا إلى المخرَج العامّ', t;
    end if;
  end loop;

  -- (١٢) ⛔ لا عمود ماليّ في أيّ جدول من الوحدة
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name like 'cs\_%'
     and (column_name ~* '(^|_)(cost|budget|margin|profit|price|revenue|invoice)($|_)');
  if n > 0 then raise exception 'SELF-TEST: عمود ماليّ في وحدة دراسات الحالة — التكلفة والهامش لا يُنشران ولا يُخزَّنان هنا'; end if;

  -- (١٣) ★ التعقيم ★ يُطبَّق عند الكتابة وعند الإخراج
  d := pg_get_functiondef(to_regprocedure('public.cs_sanitize(text)'));
  if d not ilike '%javascript%' or d not ilike '%regexp_replace%' then
    raise exception 'SELF-TEST: التعقيم لا يزيل المخططات الخطرة';
  end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)'));
  if d not ilike '%cs_sanitize%' then raise exception 'SELF-TEST: الكتابة بلا تعقيم'; end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_mask(uuid,jsonb,boolean)'));
  if d not ilike '%cs_sanitize%' then raise exception 'SELF-TEST: الإخراج بلا تعقيم — صفّ قديم قد يصل المتصفّح كما هو'; end if;

  -- (١٤) ★ حقن الصيغ في CSV ★
  d := pg_get_functiondef(to_regprocedure('public.cs_csv_cell(text)'));
  if d not ilike '%=+%' and d not ilike '%^[=%' then
    raise exception 'SELF-TEST: تصدير CSV بلا حماية من حقن الصيغ';
  end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_export_csv(jsonb)'));
  if d not ilike '%cs_csv_cell%' then raise exception 'SELF-TEST: التصدير لا يمرّ بمعقّم الخلايا'; end if;

  -- (١٥) ★ النسخ لا تُحذف ولا يُعدَّل محتواها ★
  select count(*) into n from pg_trigger
   where tgrelid = 'public.cs_versions'::regclass and tgname = 'trg_cs_versions_immutable' and not tgisinternal;
  if n <> 1 then raise exception 'SELF-TEST: حارس عدم قابلية النسخ للتغيير مفقود'; end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_versions_immutable()'));
  if d not ilike '%delete%' or d not ilike '%snapshot%' then
    raise exception 'SELF-TEST: الحارس لا يمنع الحذف أو تعديل اللقطة';
  end if;
  d := pg_get_functiondef(to_regprocedure('public.cs_rollback(uuid,int,text)'));
  if d ilike '%delete from public.cs_versions%' then
    raise exception 'SELF-TEST: التراجع يحذف تاريخًا — يجب أن يُنشئ نسخة جديدة';
  end if;
  if d not ilike '%cs_version_new%' then raise exception 'SELF-TEST: التراجع لا يُنشئ نسخة جديدة'; end if;

  -- (١٦) ★ الحالة لا تُضبَط من دالّة التحرير ★
  -- \y حدّ كلمة: permission_status و virus_scan_status لا يُطابقان (الشرطة
  -- السفلية محرف كلمة في تعابير PostgreSQL)، فالفحص يخصّ عمود status وحده.
  d := pg_get_functiondef(to_regprocedure('public.cs_upsert(jsonb)'));
  if d ~* '\ystatus\y[[:space:]]*=' then
    raise exception 'SELF-TEST: cs_upsert تضبط الحالة — «حرّر ثمّ انشر» يتخطّى المراجعة والإذن';
  end if;

  -- (١٧) ★ لا كتابة لـanon، ولا دالّة تحرير ممنوحة له ★
  if exists (select 1 from pg_roles where rolname = 'anon') then
    select count(*) into n from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' and table_name like 'cs\_%';
    if n > 0 then raise exception 'SELF-TEST: توجد صلاحية جدول لـanon على وحدة دراسات الحالة'; end if;

    foreach t in array array['cs_upsert(jsonb)','cs_publish(uuid,text)','cs_permission_set(uuid,jsonb)',
                             'cs_media_upsert(jsonb)','cs_get(uuid)','cs_list(jsonb)','cs_preview(uuid)',
                             'cs_checklist(uuid)','cs_audit_list(jsonb)','cs_settings_set(jsonb)']
    loop
      if has_function_privilege('anon', to_regprocedure('public.' || t), 'EXECUTE') then
        raise exception 'SELF-TEST: ★ anon يستطيع تنفيذ % ★', t;
      end if;
    end loop;

    -- والدوالّ العامّة الثلاث **يجب** أن تكون منفَّذة من anon وإلّا لن تعمل الصفحة.
    foreach t in array array['cs_public_index(jsonb)','cs_public_study(text)','cs_public_slugs()']
    loop
      if not has_function_privilege('anon', to_regprocedure('public.' || t), 'EXECUTE') then
        raise exception 'SELF-TEST: الدالّة العامّة % غير منفَّذة من anon — الصفحة ستقرأ خطأً كاذبًا', t;
      end if;
    end loop;
  end if;

  -- (١٨) الدوالّ الداخلية محجوبة عن العميل
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach t in array array['cs_mask(uuid,jsonb,boolean)','cs_public_row(uuid,boolean)',
                             'cs_snapshot_build(uuid)','cs_publish_blockers(uuid)',
                             'cs_version_new(uuid,text,int)','cs_log(text,uuid,boolean,jsonb)',
                             'cs_is_public(uuid)','cs_mark_approved(uuid)']
    loop
      if has_function_privilege('authenticated', to_regprocedure('public.' || t), 'EXECUTE') then
        raise exception 'SELF-TEST: الدالّة الداخلية % منفَّذة من authenticated', t;
      end if;
    end loop;
  end if;

  -- (١٩) لا سياسة كتابة مباشرة على أيّ جدول من الوحدة
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename like 'cs\_%' and cmd <> 'SELECT';
  if n > 0 then raise exception 'SELF-TEST: سياسة كتابة مباشرة موجودة — الكتابة عبر RPC وحدها'; end if;

  -- (٢٠) ★ الوسائط لا تحمل مسارًا خاصًّا ولا رابطًا موقَّعًا ★
  select count(*) into n from pg_constraint
   where conrelid = 'public.cs_media'::regclass and contype = 'c'
     and conname = 'cs_media_no_private_source';
  if n <> 1 then raise exception 'SELF-TEST: قيد منع مسارات التخزين الخاصّة مفقود'; end if;
  d := pg_get_constraintdef((select oid from pg_constraint
                              where conrelid = 'public.cs_media'::regclass and conname = 'cs_media_no_private_source'));
  foreach t in array array['project-deliverables','rental-private-documents','custody-evidence','token=']
  loop
    if d not ilike '%' || t || '%' then raise exception 'SELF-TEST: القيد لا يمنع %', t; end if;
  end loop;

  -- (٢١) الموافقة والاعتماد فعلان موثَّقان لا صندوقان
  select count(*) into n from pg_constraint
   where conrelid = 'public.cs_credits'::regclass and conname = 'cs_credit_consent_audited';
  if n <> 1 then raise exception 'SELF-TEST: قيد توثيق موافقة نشر الاسم مفقود'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.cs_permissions'::regclass and conname = 'cs_perm_granted_needs_ref';
  if n <> 1 then raise exception 'SELF-TEST: قيد اشتراط مرجع الإذن مفقود'; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'public.cs_permissions'::regclass and conname = 'cs_perm_flags_need_grant';
  if n <> 1 then raise exception 'SELF-TEST: أعلام الاستعمال المأذون بلا اشتراط إذن ممنوح'; end if;

  -- (٢٢) الحالات العشر كلّها في قيد CHECK
  foreach t in array array['draft','internal_review','legal_review','client_permission_required',
                           'client_permission_received','approved','scheduled','published',
                           'unpublished','archived']
  loop
    select count(*) into n from pg_constraint c
     where c.conrelid = 'public.cs_case_studies'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%status%'
       and pg_get_constraintdef(c.oid) ilike '%' || t || '%';
    if n < 1 then raise exception 'SELF-TEST: الحالة % ليست في قيد CHECK', t; end if;
  end loop;

  -- (٢٣) السطح العامّ مطفأ افتراضيًّا — لا يُنشَر شيء بمجرّد تشغيل الترحيلة
  if (select public_enabled from public.cs_settings where id = true) then
    raise exception 'SELF-TEST: السطح العامّ مفعَّل افتراضيًّا — التفعيل قرار مالك صريح';
  end if;

  raise notice 'CASE STUDIES SELF-TEST: كلّ التأكيدات مرّت.';
end $st$;

commit;

notify pgrst, 'reload schema';
