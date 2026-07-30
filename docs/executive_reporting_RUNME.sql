-- ════════════════════════════════════════════════════════════════════════════
-- executive_reporting_RUNME.sql — المرحلة ٥: التقارير التنفيذية.
-- idempotent · معاملة واحدة · لا anon · SECURITY DEFINER بمسار بحث مثبَّت.
--
-- ─── ما هذه الحزمة ────────────────────────────────────────────────────────
-- لوحة تنفيذية **تقرأ** من الموديولات القائمة ولا تملك رقمًا واحدًا خاصًّا بها:
--   • مركز الاتصال      (Phase 1) comms_*   → المعلّق والفاشل من الإشعارات
--   • مركز التشغيل      (Phase 2) prodops_* → الجاهزية والتعارضات والمهامّ القادمة
--   • المبيعات          (Phase 3) crm_*     → العملاء المحتملون والأنبوب والمتعثّر
--   • المالية والربحية  (Phase 4) finops_*  → المصروف والالتزامات والتحصيل والربحية
--
-- ─── ثلاث قواعد تحكم كلّ سطر هنا ──────────────────────────────────────────
-- ★ (١) الصفر لا يعني «غير مطبَّق» أبدًا ★
--     كلّ مؤشّر يمرّ بـmgmt_kpi، وهي المكان **الوحيد** الذي تُكتب فيه القيمة،
--     وفيها شرط واحد لا يُخترَق: القيمة تساوي NULL في كلّ حالة غير ok. الموديول
--     الغائب يُعيد state='unavailable' مع اسم ملفّ الـRUNME المطلوب، والموديول
--     الذي رفض القارئ يُعيد state='restricted'. صفرٌ يعني صفرًا حقيقيًّا فقط.
--
-- ★ (٢) الحسّاس للمالك وحده — وبلا مفتاح يُمنَح ★
--     mgmt_can_view_sensitive() = is_owner() فقط. لا مفتاح exec_report.* يفتحها،
--     عمدًا: مفتاح قابل للمنح يعني أنّ الهامش يخرج بقرار إداريّ عابر. وقسم
--     «المالية» كلّه في هذه اللوحة حسّاس: غير المالك لا تُستدعى له finops أصلًا،
--     فلا يتسرّب إليه حتى عدد الذمم المتأخّرة.
--
-- ★ (٣) الطزاجة مُعلَنة دائمًا ★
--     كلّ ردّ يحمل generated_at وage_seconds وis_stale وfrom_cache. ولو فشل
--     الحساب ووُجدت نسخة مخبّأة، تُعاد **موسومة بـis_stale=true وسبب** ولا
--     تُقدَّم قطّ على أنّها حيّة.
--
-- ─── حدود صريحة ──────────────────────────────────────────────────────────
--   • لا كتابة في منصّة المشاريع المجمَّدة، ولا حتى قراءة: لا دالّة هنا تذكر
--     projects/project_core/deliverables أو أيّ دالّة project_*/large_project_*.
--     السبب: هذه اللوحة لا تحتاجها، والاقتراب من سطح مُقفَل بلا حاجة مخاطرة.
--   • لا عميل ولا زائر: mgmt_can_view() تشترط is_staff().
--   • لا مكالمة شبكية ولا بيانات اعتماد ولا service_role.
--   • البادئة mgmt_ لا exec_/executive_ — هاتان محجوزتان لتقارير المنصّة.
--
-- ⚠️ الـSELF-TEST ثابت. محرّر SQL يعمل بدور postgres وauth.uid() = NULL، فاستدعاء
--    دالّة محميّة هناك يرفع "not authorized" ويُسقط الترحيلة كلّها. حيث يُستدعى
--    شيء محميّ هنا فالاستدعاء **ملفوف بمصيدة تتحقّق من وقوع المنع** — أي اختبار
--    يستطيع أن يفشل — لا مصيدة تجعله ينجح مهما حدث.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) PREFLIGHT صلب — الاعتمادات التي لا تُحاكى ─────────────────────────
do $pre$
declare miss text := ''; n int := 0; n_opt int := 0;
begin
  if to_regclass('public.profiles')       is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if miss <> '' then
    raise exception 'MGMT PREFLIGHT: اعتمادات ناقصة —%. شغّل staff_roles_task_assignment_RUNME.sql أوّلًا.', miss;
  end if;

  -- المصادر اختيارية بالتصميم: غيابها لا يمنع التشغيل، بل يُعرَض في اللوحة بصدق.
  if to_regprocedure('public.comms_health()') is null then
    raise notice 'MGMT: مركز الاتصال غير مطبَّق — مؤشّرات الإشعارات ستُعرض «غير متاح» لا صفرًا.'; n := n + 1;
  end if;
  if to_regprocedure('public.prodops_dashboard(jsonb)') is null then
    raise notice 'MGMT: مركز التشغيل غير مطبَّق — مؤشّرات الجاهزية والتعارضات ستُعرض «غير متاح» لا صفرًا.'; n := n + 1;
  end if;
  if to_regprocedure('public.crm_dashboard(jsonb)') is null then
    raise notice 'MGMT: المبيعات غير مطبَّقة — مؤشّرات الأنبوب ستُعرض «غير متاح» لا صفرًا.'; n := n + 1;
  end if;
  if to_regprocedure('public.finops_dashboard(jsonb)') is null then
    raise notice 'MGMT: المالية غير مطبَّقة — المؤشّرات المالية ستُعرض «غير متاح» لا صفرًا.'; n := n + 1;
  end if;
  -- ★ المصدران المضافان في التدقيق النهائيّ — اختياريّان كسابقيهما تمامًا.
  --   يُعدّان في n_opt لا في n كي يبقى شرط «لا مصدر واحد مطبَّق» (n = 4)
  --   محسوبًا على المصادر الأربعة الأساسية نفسها ولا يتغيّر معناه.
  if to_regprocedure('public.liveops_session_list(jsonb)') is null then
    raise notice 'MGMT: العمليات المباشرة غير مطبَّقة — مؤشّرا البثّ سيُعرضان «غير متاح» لا صفرًا.'; n_opt := n_opt + 1;
  end if;
  if to_regprocedure('public.ai_admin_overview()') is null then
    raise notice 'MGMT: مساعد كيان غير مطبَّق — مؤشّرا المعرفة والمسوّدات سيُعرضان «غير متاح» لا صفرًا.'; n_opt := n_opt + 1;
  end if;
  if n = 4 then
    raise notice 'MGMT: لا مصدر واحد مطبَّق. اللوحة ستعمل وتقول ذلك صراحةً — وهذا أصدق من لوحة أصفار.';
  end if;
  if n_opt > 0 then
    raise notice 'MGMT: % من الموديولين الإضافيّين (العمليات المباشرة · مساعد كيان) غير مطبَّق. '
                 'هذه الحزمة تعمل بدونهما، ومؤشّراتهما تُعلن الغياب باسم ملفّ التشغيل.', n_opt;
  end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then
    raise notice 'MGMT: محرّك الصلاحيات غير مطبَّق — المالك وحده يرى اللوحة حتى تشغيله (فشل مغلق).';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--
--     ★ مفتاحان فقط، ولا مفتاح ثالث ★
--     exec_report.view    يفتح اللوحة بمؤشّراتها غير الحسّاسة.
--     exec_report.export  يسمح بالتصدير (بالحدود نفسها: لا يوسّع الرؤية).
--     ولا يوجد exec_report.view_sensitive عمدًا — المؤشّرات المالية والهوامش
--     مقصورة على is_owner() بنيويًّا، ولا تُمنَح بمفتاح يستطيع أحد إسناده.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'MGMT §1: جدول permissions غير موجود — تخطّي بذر المفاتيح (المالك وحده يرى اللوحة).';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'reporting', v.sens, v.ord, v.ar, v.en
  from (values
    (1500,'exec_report.view',   'sensitive','عرض اللوحة التنفيذية',     'View executive dashboard'),
    (1510,'exec_report.export', 'sensitive','تصدير التقارير التنفيذية', 'Export executive reports')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) المُسنَدات — خاصّة بالموديول، وكلّها تعيد boolean صريحًا لا NULL.
--     ⚠️ لا تُبنى على can_manage_projects: مدير المشاريع ليس قارئًا تنفيذيًّا.
--     حادثة NULL-collapse في هذا المستودع جعلت مُسنَدًا يعيد NULL ففُتح الباب؛
--     لذلك كلّ سطر هنا ملفوف بـcoalesce(..., false).
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (فشل مغلق) لا استثناء.
-- المصيدة هنا تُفشِل ولا تُنجِح.
create or replace function public.mgmt_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then
  return false;
end $$;

-- بوّابة اللوحة. is_staff() تستبعد العميل والزائر بنيويًّا حتى برابط مباشر.
create or replace function public.mgmt_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and (coalesce(public.is_owner(), false)
      or coalesce(public.mgmt_perm('exec_report.view'), false)),
  false);
$$;

-- ★ الطبقة الحسّاسة ★ — المالك وحده. لا مفتاح، ولا دور، ولا اشتقاق.
-- is_owner() في هذا المستودع = is_admin() أو staff_role='super_admin'.
create or replace function public.mgmt_can_view_sensitive() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.is_owner(), false),
  false);
$$;

create or replace function public.mgmt_can_export() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.mgmt_can_view(), false)
    and (coalesce(public.is_owner(), false)
      or coalesce(public.mgmt_perm('exec_report.export'), false)),
  false);
$$;

-- تصريح صريح بأنّ صاحب الجلسة عميل/زائر — يُستعمل في الرسائل والاختبارات.
create or replace function public.mgmt_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — جدولان فقط. هذه الحزمة لا تخزّن مقاييس ولا تبني مستودع بيانات:
--     الأرقام تبقى مملوكة لموديولاتها، وما يُخزَّن هنا هو **النسخة المؤقّتة**
--     ووقتُها. تخزين مقياس محسوب كان سيخلق مصدر حقيقة ثانيًا ينحرف بصمت.
-- ════════════════════════════════════════════════════════════════════════════

-- ذاكرة مؤقّتة **لكلّ مستخدم على حدة**. المفتاح يتضمّن auth.uid() وبصمة قدرته
-- الحسّاسة، فلا يمكن بنيويًّا أن تُقدَّم نسخة المالك لغير المالك.
create table if not exists public.mgmt_report_cache (
  cache_key      text primary key,
  user_id        uuid not null,
  filters        jsonb not null default '{}'::jsonb,
  sensitive_view boolean not null default false,
  payload        jsonb not null,
  computed_at    timestamptz not null default now(),
  compute_ms     int,
  ttl_seconds    int not null default 300
);
create index if not exists mgmt_report_cache_user_idx on public.mgmt_report_cache (user_id, computed_at desc);

create table if not exists public.mgmt_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists mgmt_audit_created_idx on public.mgmt_audit (created_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- §4) RLS — قراءة فقط، ولا سياسة كتابة على أيّ جدول.
--     كلّ كتابة تمرّ بدالّة SECURITY DEFINER. إخفاء زرّ ليس تصريحًا؛ المنع هنا.
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ enable وليس force عمدًا. الجدولان مملوكان للدور نفسه الذي تعمل به دوالّ
--    SECURITY DEFINER، وforce كانت ستُخضِع كتابة الذاكرة المؤقّتة لسياسات
--    SELECT-فقط فتفشل كلّ إعادة حساب بصمت. المنع الحقيقيّ على القارئ الخارجيّ
--    (authenticated) تفرضه enable، وهذا هو المطلوب.
do $rls$
declare t text;
begin
  foreach t in array array['mgmt_report_cache','mgmt_audit'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $rls$;

drop policy if exists mgmt_report_cache_sel on public.mgmt_report_cache;
create policy mgmt_report_cache_sel on public.mgmt_report_cache
  for select using (
    coalesce(public.mgmt_can_view(), false) and user_id = auth.uid()
  );

drop policy if exists mgmt_audit_sel on public.mgmt_audit;
create policy mgmt_audit_sel on public.mgmt_audit
  for select using (coalesce(public.mgmt_can_view_sensitive(), false));

-- ════════════════════════════════════════════════════════════════════════════
-- §5) الأدوات الداخلية — لا تُمنَح لأحد، وتُنفَّذ داخل سلسلة SECURITY DEFINER.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.mgmt_log(
  p_action text, p_entity_type text, p_entity_id text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.mgmt_audit (actor_id, action, entity_type, entity_id, detail)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end $$;

-- الأقسام المعروفة. أيّ قيمة أخرى تُبلَّغ للمستخدم في unknown_departments بدل
-- أن تُبتلَع بصمت وتترك اللوحة تبدو مُرشَّحة وهي ليست كذلك.
create or replace function public.mgmt_departments() returns text[]
language sql immutable set search_path = public as $$
  select array['production','sales','finance','communications']::text[];
$$;

-- غلاف موحّد لنتيجة أيّ مصدر: الحالة والسبب والرسالة والبيانات.
create or replace function public.mgmt_env(
  p_state text, p_reason text, p_ar text, p_en text, p_data jsonb default null)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'state', p_state, 'reason', p_reason,
    'message_ar', p_ar, 'message_en', p_en,
    'data', coalesce(p_data, 'null'::jsonb));
$$;

-- ★ نقطة الاختناق الوحيدة التي تُكتب فيها قيمة مؤشّر ★
-- القاعدة المكتوبة هنا هي كلّ عقد هذه الحزمة: **لا قيمة إلّا في الحالة ok**.
-- لا يوجد مسار ثانٍ لبناء مؤشّر، فلا يمكن لصفر أن يعني «غير مطبَّق» أو «ممنوع».
create or replace function public.mgmt_kpi(
  p_key text, p_department text, p_unit text, p_sensitive boolean,
  p_state text, p_reason text, p_ar text, p_en text,
  p_value numeric default null, p_count bigint default null,
  p_scope text default 'current_state', p_detail jsonb default null)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'key', p_key, 'department', p_department, 'unit', p_unit,
    'sensitive', coalesce(p_sensitive, false),
    'state', p_state,
    'value', case when p_state = 'ok' then p_value else null end,
    'count', case when p_state = 'ok' then p_count else null end,
    'detail', case when p_state = 'ok' then coalesce(p_detail, '{}'::jsonb) else '{}'::jsonb end,
    'reason', p_reason,
    'message_ar', p_ar, 'message_en', p_en,
    'date_scope', coalesce(p_scope, 'current_state'));
$$;

-- تصنيف أمين لفشل مصدر: المنع ليس ترحيلة ناقصة، والعكس بالعكس.
create or replace function public.mgmt_classify(p_sqlstate text, p_msg text)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(p_msg, '') ilike '%not authorized%'
      or coalesce(p_msg, '') ilike '%لا تملك صلاحية%'
      or coalesce(p_sqlstate, '') = '42501' then 'restricted'
    when coalesce(p_sqlstate, '') in ('42883','42P01') then 'unavailable'
    else 'error'
  end;
$$;

-- مِجَسّ وجود دالّة مصدر. الغياب حقيقة تُعلَن، لا تُخمَّن.
create or replace function public.mgmt_source_installed(p_sig text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(to_regprocedure(p_sig) is not null, false);
$$;

-- ─── قارئ عامّ لمصدر بحمولة jsonb واحدة ───────────────────────────────────
-- ⚠️ الاستدعاء ديناميكيّ عمدًا: الحزمة تُشغَّل حتى لو لم يكن الموديول مطبَّقًا،
--    وauth.uid() يبقى كما هو داخل SECURITY DEFINER، فبوّابة الموديول المصدر
--    تُقيَّم على القارئ الحقيقيّ ولا تُتجاوَز. هذه الحزمة لا تمنح رؤية جديدة.
create or replace function public.mgmt_read_jsonb(
  p_sig text, p_call text, p_args jsonb, p_module text, p_runme text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_state text; v_msg text; v_ss text;
begin
  if not coalesce(public.mgmt_source_installed(p_sig), false) then
    return public.mgmt_env('unavailable', 'module_not_installed',
      'الموديول (' || p_module || ') غير مطبَّق على قاعدة البيانات — شغّل ' || p_runme || '. هذه ليست «صفرًا».',
      'Module (' || p_module || ') is not installed — run ' || p_runme || '. This is NOT a zero.');
  end if;
  begin
    if p_args is null then
      execute 'select ' || p_call into v;
    else
      execute 'select ' || p_call into v using p_args;
    end if;
  exception when others then
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    v_state := public.mgmt_classify(v_ss, v_msg);
    if v_state = 'restricted' then
      return public.mgmt_env('restricted', 'not_authorized',
        'الموديول (' || p_module || ') رفض قراءتك: لا تملك صلاحية فيه. هذا منع مقصود لا عطل ولا نقص بيانات.',
        'Module (' || p_module || ') refused this reader: you lack permission there. Deliberate denial, not a fault.');
    end if;
    if v_state = 'unavailable' then
      return public.mgmt_env('unavailable', 'module_object_missing',
        'كائن مطلوب في الموديول (' || p_module || ') غير موجود — شغّل ' || p_runme || '.',
        'A required object in module (' || p_module || ') is missing — run ' || p_runme || '.');
    end if;
    return public.mgmt_env('error', coalesce(nullif(v_ss, ''), 'unknown'),
      'تعذّرت قراءة الموديول (' || p_module || '). الرمز: ' || coalesce(v_ss, '-') || '.',
      'Reading module (' || p_module || ') failed. Code: ' || coalesce(v_ss, '-') || '.');
  end;
  if v is null then
    return public.mgmt_env('error', 'null_payload',
      'الموديول (' || p_module || ') أعاد حمولة فارغة.',
      'Module (' || p_module || ') returned an empty payload.');
  end if;
  return public.mgmt_env('ok', null, null, null, v);
end $$;

-- قارئ التقويم: توقيعه موضعيّ (date,date,jsonb) فيحتاج غلافًا خاصًّا به.
create or replace function public.mgmt_read_calendar(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_state text; v_msg text; v_ss text;
  SIG constant text := 'public.prodops_calendar(date,date,jsonb)';
begin
  if not coalesce(public.mgmt_source_installed(SIG), false) then
    return public.mgmt_env('unavailable', 'module_not_installed',
      'مركز التشغيل غير مطبَّق — شغّل docs/operations_center_RUNME.sql. هذه ليست «صفرًا».',
      'Operations centre is not installed — run docs/operations_center_RUNME.sql. This is NOT a zero.');
  end if;
  begin
    execute 'select public.prodops_calendar($1,$2,$3)' into v using p_from, p_to, '{}'::jsonb;
  exception when others then
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    v_state := public.mgmt_classify(v_ss, v_msg);
    if v_state = 'restricted' then
      return public.mgmt_env('restricted', 'not_authorized',
        'مركز التشغيل رفض قراءتك: لا تملك صلاحية فيه.',
        'Operations centre refused this reader: you lack permission there.');
    end if;
    return public.mgmt_env(v_state, coalesce(nullif(v_ss, ''), 'unknown'),
      'تعذّرت قراءة تقويم التشغيل. الرمز: ' || coalesce(v_ss, '-') || '.',
      'Reading the operations calendar failed. Code: ' || coalesce(v_ss, '-') || '.');
  end;
  return public.mgmt_env('ok', null, null, null, coalesce(v, '{}'::jsonb));
end $$;

-- تطبيع المرشّحات — مصدر واحد للمدى والأقسام ومفتاح الذاكرة المؤقّتة.
create or replace function public.mgmt_norm_filters(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb);
        v_from date; v_to date; v_in text[]; v_ok text[] := '{}'; v_bad text[] := '{}';
        d text; v_ttl int;
begin
  v_from := coalesce(nullif(btrim(coalesce(f->>'from', '')), '')::date, (current_date - 29));
  v_to   := coalesce(nullif(btrim(coalesce(f->>'to',   '')), '')::date, current_date);
  if v_to < v_from then v_to := v_from; end if;
  -- سقف سنة: مدى مفتوح يجعل قراءة المصادر بطيئة فتبدو اللوحة معطّلة.
  if v_to > v_from + 366 then v_to := v_from + 366; end if;

  begin
    v_in := case
      when jsonb_typeof(f->'departments') = 'array'
        then array(select jsonb_array_elements_text(f->'departments'))
      else '{}'::text[] end;
  exception when others then v_in := '{}'::text[];
  end;

  -- المجهول يُجمَع ليُبلَّغ به، والمعروف يُصفّى.
  foreach d in array coalesce(v_in, '{}'::text[]) loop
    if not (d = any (public.mgmt_departments())) then v_bad := v_bad || d; end if;
  end loop;
  -- ⚠️ الترتيب **قانونيّ** لا ترتيب المستخدم: مفتاح الذاكرة يُبنى من نصّ هذه
  --    المصفوفة، و["sales","finance"] مقابل ["finance","sales"] كانا سيولّدان
  --    مفتاحين مختلفين لنتيجة واحدة — أي إعادة حساب كاملة كلّما بدّل المستخدم
  --    ترتيب ضغطاته. التكرار يختفي هنا أيضًا.
  foreach d in array public.mgmt_departments() loop
    if d = any (coalesce(v_in, '{}'::text[])) then v_ok := v_ok || d; end if;
  end loop;
  if array_length(v_ok, 1) is null then v_ok := public.mgmt_departments(); end if;

  -- ★ سقف العمر ٣٠٠ ثانية، والمتصل يستطيع تقصيره لا تمديده ★
  --   عمر النسخة المخبّأة هو **نافذة قراءة بعد سحب الصلاحية**: مفتاح الذاكرة
  --   يتضمّن قدرة الحسّاسية، فسحب الملكية يُبطل النسخة فورًا — لكنّ سحب صلاحية
  --   في موديول مصدر (التشغيل مثلًا) لا يغيّر المفتاح، فتبقى أرقامه معروضة حتى
  --   انتهاء العمر. سقف ٣٦٠٠ كان يجعل تلك النافذة ساعةً **يختارها المتصل نفسه**.
  v_ttl := least(greatest(coalesce(nullif(btrim(coalesce(f->>'ttl_seconds', '')), '')::int, 300), 0), 300);

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'departments', to_jsonb(v_ok),
    'unknown_departments', to_jsonb(v_bad),
    'ttl_seconds', v_ttl,
    'fallback', false);
exception when others then
  -- مرشّح غير قابل للتفسير (تاريخ تالف مثلًا) ⇒ الافتراض، **مُعلَنًا**. الردّ
  -- يحمل filters المطبَّقة فعلًا وfallback=true، فلا يظنّ القارئ أنّ مرشّحه سرى.
  return jsonb_build_object('from', (current_date - 29), 'to', current_date,
    'departments', to_jsonb(public.mgmt_departments()),
    'unknown_departments', '[]'::jsonb, 'ttl_seconds', 300,
    'fallback', true,
    'fallback_reason_ar', 'تعذّر تفسير المرشّحات المُرسَلة، فطُبِّق المدى الافتراضيّ (٣٠ يومًا) وكلّ الأقسام.',
    'fallback_reason_en', 'The submitted filters could not be parsed; the default 30-day range and all departments were applied.');
end $$;

create or replace function public.mgmt_cache_key(p_norm jsonb, p_sensitive boolean)
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce(auth.uid()::text, '-') || '|' ||
             coalesce(p_norm->>'from', '-') || '|' || coalesce(p_norm->>'to', '-') || '|' ||
             coalesce(p_norm->>'departments', '[]') || '|' ||
             case when coalesce(p_sensitive, false) then 'S' else 'N' end);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) المحرّك — يقرأ المصادر، يبني ١٤ مؤشّرًا، ويشتقّ تنبيهات الإدارة.
--     ★ كلّ مصدر معزول باستثنائه ★: سقوط موديول واحد لا يُسقط اللوحة، ويظهر
--     مؤشّره «غير متاح/ممنوع» بينما تبقى بقيّة المؤشّرات حيّة وصادقة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.mgmt_compute(p_norm jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_sens   boolean := coalesce(public.mgmt_can_view_sensitive(), false);
  v_depts  text[]  := array(select jsonb_array_elements_text(p_norm->'departments'));
  v_from   date    := (p_norm->>'from')::date;
  v_to     date    := (p_norm->>'to')::date;
  v_kpis   jsonb   := '[]'::jsonb;
  v_alerts jsonb   := '[]'::jsonb;
  e_comms  jsonb; e_ops jsonb; e_conf jsonb; e_cal jsonb; e_crm jsonb; e_leads jsonb; e_fin jsonb;
  e_live   jsonb; e_ai jsonb;
  d        jsonb;
  v_n      numeric; v_c bigint; v_jobs bigint; v_lb boolean; v_min timestamptz;
  OWNER_AR constant text := 'مؤشّر حسّاس: مقصور على المالك. هذا منع مقصود، والقيمة ليست صفرًا بل محجوبة.';
  OWNER_EN constant text := 'Sensitive KPI: owner-only. Deliberate denial — the value is withheld, not zero.';
  OFF_AR   constant text := 'خارج نطاق المرشّح المختار (القسم غير محدَّد في هذا العرض).';
  OFF_EN   constant text := 'Outside the selected department filter.';
begin
  -- ── الاتّصالات: المعلّق والفاشل ──────────────────────────────────────────
  if 'communications' = any (v_depts) then
    e_comms := public.mgmt_read_jsonb('public.comms_health()', 'public.comms_health()', null,
                 'communications', 'docs/communications_hub_RUNME.sql');
    -- comms_health لا ترفع استثناء عند المنع، بل تعيد ok:false/error — تُترجَم هنا.
    if (e_comms->>'state') = 'ok'
       and coalesce(((e_comms->'data')->>'ok')::boolean, false) is not true then
      e_comms := public.mgmt_env('restricted', 'not_authorized',
        'مركز الاتصال رفض قراءتك: لا تملك صلاحية فيه.',
        'Communications hub refused this reader: you lack permission there.');
    end if;

    if (e_comms->>'state') = 'ok' then
      d := (e_comms->'data')->'counts';
      v_c := coalesce((d->>'queued')::bigint, 0) + coalesce((d->>'retrying')::bigint, 0)
             + coalesce((d->>'processing')::bigint, 0);
      v_kpis := v_kpis || public.mgmt_kpi('notifications_pending','communications','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('queued', d->'queued', 'retrying', d->'retrying',
          'processing', d->'processing', 'oldest_runnable_at', (e_comms->'data')->'oldest_runnable_at'));
      v_c := coalesce((d->>'failed')::bigint, 0) + coalesce((d->>'dead_letter')::bigint, 0);
      v_kpis := v_kpis || public.mgmt_kpi('notifications_failed','communications','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('failed', d->'failed', 'dead_letter', d->'dead_letter'));
    else
      v_kpis := v_kpis || public.mgmt_kpi('notifications_pending','communications','count', false,
        e_comms->>'state', e_comms->>'reason', e_comms->>'message_ar', e_comms->>'message_en');
      v_kpis := v_kpis || public.mgmt_kpi('notifications_failed','communications','count', false,
        e_comms->>'state', e_comms->>'reason', e_comms->>'message_ar', e_comms->>'message_en');
    end if;

    -- ── مساعد كيان — عدّان إداريّان فقط ───────────────────────────────────
    -- ⚠️ ما لا يُقرأ هنا، عمدًا: نصّ سؤال، نصّ جواب، محتوى محادثة، بيانات
    --    متواصل. المؤشّران عدّان على الحوكمة: كم مصدرًا معتمَدًا، وكم مسوّدة
    --    عميل محتمَل تنتظر مراجعة إنسان. لا شيء منهما يقول إنّ المساعد يعمل:
    --    ai_admin_overview تُرفق provider ودائمًا external_calls = 0.
    -- ⚠️ ai_admin_overview لا ترفع استثناء عند المنع بل تُعيد
    --    state = not_permitted لكلّ قسم — تُترجَم هنا إلى restricted صراحةً
    --    كي لا يُقرأ المنع صفرًا.
    e_ai := public.mgmt_read_jsonb('public.ai_admin_overview()', 'public.ai_admin_overview()', null,
              'ai_assistant', 'docs/kian_ai_assistant_RUNME.sql');
    if (e_ai->>'state') = 'ok'
       and ((e_ai->'data')->'knowledge'->>'state') = 'ok' then
      v_c := coalesce((((e_ai->'data')->'knowledge')->>'approved')::bigint, 0);
      v_kpis := v_kpis || public.mgmt_kpi('ai_knowledge_approved','communications','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('in_review', ((e_ai->'data')->'knowledge')->'in_review',
                           'expiring_30d', ((e_ai->'data')->'knowledge')->'expiring_30d',
                           'assistant_enabled', ((e_ai->'data')->'provider')->'enabled',
                           'external_calls', ((e_ai->'data')->'provider_calls')->'external_calls'));
    elsif (e_ai->>'state') = 'ok' then
      v_kpis := v_kpis || public.mgmt_kpi('ai_knowledge_approved','communications','count', false,
        'restricted','not_authorized',
        'سجلّ معرفة المساعد رفض قراءتك: لا تملك صلاحية فيه. هذا منع مقصود لا صفر.',
        'The assistant knowledge base refused this reader: you lack permission there. A denial, not a zero.');
    else
      v_kpis := v_kpis || public.mgmt_kpi('ai_knowledge_approved','communications','count', false,
        e_ai->>'state', e_ai->>'reason', e_ai->>'message_ar', e_ai->>'message_en');
    end if;

    if (e_ai->>'state') = 'ok'
       and ((e_ai->'data')->'leads'->>'state') = 'ok' then
      v_c := coalesce((((e_ai->'data')->'leads')->>'pending')::bigint, 0);
      v_kpis := v_kpis || public.mgmt_kpi('ai_leads_pending_review','communications','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('note_ar','مسوّدات لا عملاء: لا شيء يدخل المبيعات قبل مراجعة إنسان.'));
    elsif (e_ai->>'state') = 'ok' then
      v_kpis := v_kpis || public.mgmt_kpi('ai_leads_pending_review','communications','count', false,
        'restricted','not_authorized',
        'مسوّدات المساعد رفضت قراءتك: مراجعة المسوّدات صلاحية مستقلّة. هذا منع مقصود لا صفر.',
        'Assistant lead drafts refused this reader: reviewing drafts is a separate permission. A denial, not a zero.');
    else
      v_kpis := v_kpis || public.mgmt_kpi('ai_leads_pending_review','communications','count', false,
        e_ai->>'state', e_ai->>'reason', e_ai->>'message_ar', e_ai->>'message_en');
    end if;
  else
    v_kpis := v_kpis || public.mgmt_kpi('notifications_pending','communications','count', false,
      'filtered_out','department_not_selected', OFF_AR, OFF_EN);
    v_kpis := v_kpis || public.mgmt_kpi('notifications_failed','communications','count', false,
      'filtered_out','department_not_selected', OFF_AR, OFF_EN);
    v_kpis := v_kpis || public.mgmt_kpi('ai_knowledge_approved','communications','count', false,
      'filtered_out','department_not_selected', OFF_AR, OFF_EN);
    v_kpis := v_kpis || public.mgmt_kpi('ai_leads_pending_review','communications','count', false,
      'filtered_out','department_not_selected', OFF_AR, OFF_EN);
  end if;

  -- ── التشغيل: الجاهزية والتعارضات والمهامّ القادمة ───────────────────────
  if 'production' = any (v_depts) then
    e_ops := public.mgmt_read_jsonb('public.prodops_dashboard(jsonb)',
               'public.prodops_dashboard($1)', '{}'::jsonb,
               'production', 'docs/operations_center_RUNME.sql');
    if (e_ops->>'state') = 'ok' then
      d := (e_ops->'data')->'counters';
      -- ★ الجاهزية = متوسّط درجات جاهزية المهامّ في النافذة نفسها ★
      --   الصيغة السابقة كانت: (اليوم + ٧ أيام) − (نقص طاقم + نقص معدّات + نقص
      --   تصاريح) ÷ (اليوم + ٧ أيام). وهي خاطئة من وجهين معًا:
      --     (١) البسط والمقام من **نافذتين مختلفتين**: عدّادات النقص في مركز
      --         التشغيل محسوبة على ١٤ يومًا (الطاقم والمعدّات) و٢١ يومًا
      --         (التصاريح)، بينما المقام ٨ أيام. المطروح يستطيع أن يتجاوز المقام.
      --     (٢) المهمّة الناقصة في ثلاثة أوجه تُطرَح **ثلاث مرّات**.
      --   النتيجة العملية: ٣ مهامّ جاهزة تمامًا هذا الأسبوع، و٥ مهامّ ناقصة طاقمًا
      --   بعد أسبوعين ⇒ الجاهزية ٠٪ وتنبيه «جاهزية منخفضة» بشدّة عالية. رقم
      --   يصحّ حسابيًّا ويكذب دلاليًّا — وهو ما تُوجد هذه اللوحة لمنعه.
      --   الصفوف نفسها تحمل readiness لكلّ مهمّة (من prodops_readiness_core،
      --   وهي ثمانية فحوص مطلوبة على الأقلّ)، وهي المقياس الصحيح: النافذة نفسها،
      --   وبلا ازدواج عدّ.
      select count(*),
             count(*) filter (where nullif(x->>'readiness', '') is not null),
             round(avg(nullif(x->>'readiness', '')::numeric), 1)
        into v_jobs, v_c, v_n
        from (
          select e as x from jsonb_array_elements(coalesce((e_ops->'data')->'today', '[]'::jsonb)) e
          union all
          select e as x from jsonb_array_elements(coalesce((e_ops->'data')->'next_7_days', '[]'::jsonb)) e
        ) s;
      if coalesce(v_jobs, 0) = 0 then
        -- ★ لا تُحسب حين لا توجد مهامّ ★ — «١٠٠٪ جاهز» بلا مهمّة رقم فارغ يطمئن كذبًا.
        v_kpis := v_kpis || public.mgmt_kpi('operational_readiness','production','percent', false,
          'no_basis','no_scheduled_jobs',
          'لا مهامّ مجدولة في نافذة الموديول (اليوم + ٧ أيام) — لا أساس لحساب نسبة جاهزية. هذا ليس ١٠٠٪.',
          'No scheduled jobs in the module window (today + 7 days) — no basis for a readiness percentage. This is not 100%.',
          null, null, 'module_default');
      elsif coalesce(v_c, 0) = 0 or v_n is null then
        -- مهامّ موجودة ولا درجة جاهزية لواحدة منها: هذا «لا نعرف» لا «صفر».
        v_kpis := v_kpis || public.mgmt_kpi('operational_readiness','production','percent', false,
          'no_basis','readiness_not_reported',
          'مركز التشغيل لم يُعِد درجة جاهزية لأيّ مهمّة في النافذة — لا أساس للنسبة. هذا ليس صفرًا.',
          'The operations centre reported no readiness score for any job in the window — no basis for a percentage. This is not a zero.',
          null, null, 'module_default');
      else
        v_kpis := v_kpis || public.mgmt_kpi('operational_readiness','production','percent', false,
          'ok', null, null, null, v_n, v_c, 'module_default',
          jsonb_build_object(
            'basis', 'avg_job_readiness_score',
            'jobs_in_window', v_jobs, 'scored_jobs', v_c,
            'missing_crew', d->'missing_crew', 'missing_equipment', d->'missing_equipment',
            'missing_permits', d->'missing_permits', 'media_not_backed_up', d->'media_not_backed_up',
            'counters_window_note_ar', 'عدّادات النقص أعلاه محسوبة على نافذة مركز التشغيل (١٤ يومًا للطاقم والمعدّات و٢١ للتصاريح) لا على نافذة هذه النسبة (اليوم + ٧ أيام)، ولا تُطرَح منها.',
            'counters_window_note_en', 'The shortage counters above use the operations centre''s own window (14 days for crew and equipment, 21 for permits), not this percentage''s window (today + 7 days). They are not subtracted from it.'));
      end if;
    else
      v_kpis := v_kpis || public.mgmt_kpi('operational_readiness','production','percent', false,
        e_ops->>'state', e_ops->>'reason', e_ops->>'message_ar', e_ops->>'message_en',
        null, null, 'module_default');
    end if;

    e_conf := public.mgmt_read_jsonb('public.prodops_conflicts(jsonb)',
                'public.prodops_conflicts($1)',
                jsonb_build_object('from', v_from::text, 'to', (v_to + 1)::text),
                'production', 'docs/operations_center_RUNME.sql');
    if (e_conf->>'state') = 'ok' then
      v_c := coalesce(((e_conf->'data')->>'total')::bigint, 0);
      v_kpis := v_kpis || public.mgmt_kpi('resource_conflicts','production','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'filtered',
        jsonb_build_object(
          'internal', jsonb_array_length(coalesce((e_conf->'data')->'internal', '[]'::jsonb)),
          'external', jsonb_array_length(coalesce(((e_conf->'data')->'external')->'items', '[]'::jsonb)),
          'external_sources', ((e_conf->'data')->'external')->'sources'));
    else
      v_kpis := v_kpis || public.mgmt_kpi('resource_conflicts','production','count', false,
        e_conf->>'state', e_conf->>'reason', e_conf->>'message_ar', e_conf->>'message_en',
        null, null, 'filtered');
    end if;

    -- ★ نافذة ماضية بالكامل لا «مهامّ قادمة» فيها ★
    --   prodops_calendar تصحّح المدى المقلوب بجعل to = from، فتمرير
    --   (current_date, تاريخ ماضٍ) كان سيُعيد **مهامّ اليوم** ويعرضها إجابةً عن
    --   سؤال عن الماضي. الرقم كان سيصحّ حسابيًّا ويكذب دلاليًّا.
    if v_to < current_date then
      v_kpis := v_kpis || public.mgmt_kpi('upcoming_jobs','production','count', false,
        'no_basis','window_entirely_in_past',
        'النافذة المختارة تنتهي قبل اليوم، فلا «مهامّ قادمة» فيها. هذا ليس صفرًا بل سؤال لا محلّ له.',
        'The selected window ends before today, so it holds no upcoming jobs. This is not a zero — the question does not apply.',
        null, null, 'filtered');
      e_cal := null;
    else
      e_cal := public.mgmt_read_calendar(greatest(v_from, current_date), v_to);
    end if;
    if e_cal is null then
      null;                                   -- عولجت أعلاه بحالة no_basis
    elsif (e_cal->>'state') = 'ok' then
      -- prodops_calendar تُسمّي المصفوفة days (وهي صفوف مهامّ لا أيّام).
      v_c := jsonb_array_length(coalesce((e_cal->'data')->'days', '[]'::jsonb));
      v_kpis := v_kpis || public.mgmt_kpi('upcoming_jobs','production','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'filtered',
        jsonb_build_object('window_from', greatest(v_from, current_date), 'window_to', v_to));
    else
      v_kpis := v_kpis || public.mgmt_kpi('upcoming_jobs','production','count', false,
        e_cal->>'state', e_cal->>'reason', e_cal->>'message_ar', e_cal->>'message_en',
        null, null, 'filtered');
    end if;
    -- ── العمليات المباشرة (live ops) — عدّان تشغيليّان لا أكثر ─────────────
    -- ⚠️ ما لا يُقرأ هنا، عمدًا: مفاتيح البثّ، عناوين الشبكة، الأرقام
    --    التسلسلية، الملاحظات الداخلية، أسباب الحوادث الجذرية، والتكاليف.
    --    هذه الحزمة **لا تمنح رؤية جديدة**: liveops_session_list تُنادى تحت
    --    هويّة القارئ نفسه، وبوّابتها liveops_can_view() تُقيَّم عليه، فالعميل
    --    والزائر يحصلان على restricted لا على رقم.
    -- ⚠️ ولا يُشتقّ من هنا أيّ ادّعاء «قياس»: عدّ الجلسات وعدّ الحوادث
    --    المفتوحة إدخال بشريّ، تمامًا كما يقوله liveops_client_payload.
    e_live := public.mgmt_read_jsonb('public.liveops_session_list(jsonb)',
                'public.liveops_session_list($1)', '{}'::jsonb,
                'live_operations', 'docs/live_operations_dashboard_RUNME.sql');
    if (e_live->>'state') = 'ok' then
      select count(*) filter (where x->>'status' in ('live','rehearsal','paused','degraded','interrupted')),
             coalesce(sum(coalesce((x->>'open_incidents')::bigint, 0))
                        filter (where x->>'status' in ('live','rehearsal','paused','degraded','interrupted')), 0)
        into v_c, v_jobs
        from jsonb_array_elements(coalesce((e_live->'data')->'rows', '[]'::jsonb)) x;

      v_kpis := v_kpis || public.mgmt_kpi('live_sessions_active','production','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('counts_statuses', 'live/rehearsal/paused/degraded/interrupted',
                           'telemetry_connected', false));
      v_kpis := v_kpis || public.mgmt_kpi('live_open_incidents','production','count', false,
        'ok', null, null, null, v_jobs::numeric, v_jobs, 'current_state',
        jsonb_build_object('scope', 'open incidents on sessions that are on air now',
                           'telemetry_connected', false));
    else
      v_kpis := v_kpis || public.mgmt_kpi('live_sessions_active','production','count', false,
        e_live->>'state', e_live->>'reason', e_live->>'message_ar', e_live->>'message_en');
      v_kpis := v_kpis || public.mgmt_kpi('live_open_incidents','production','count', false,
        e_live->>'state', e_live->>'reason', e_live->>'message_ar', e_live->>'message_en');
    end if;
  else
    v_kpis := v_kpis
      || public.mgmt_kpi('operational_readiness','production','percent', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('resource_conflicts','production','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('upcoming_jobs','production','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('live_sessions_active','production','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('live_open_incidents','production','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN);
  end if;

  -- ── المبيعات ────────────────────────────────────────────────────────────
  if 'sales' = any (v_depts) then
    e_crm := public.mgmt_read_jsonb('public.crm_dashboard(jsonb)', 'public.crm_dashboard($1)',
               '{}'::jsonb, 'sales', 'docs/crm_sales_FOUNDATION_RUNME.sql');

    -- العملاء المحتملون الجدد داخل المدى — تُحسب من قائمة المبيعات نفسها كي
    -- تبقى مقيّدة برؤية القارئ. ★ سقف المصدر ٥٠٠ صفّ ★: إن لم تُغطَّ النافذة
    -- كاملةً يُعلَن الرقم **حدًّا أدنى** (is_lower_bound) ولا يُقدَّم كعدد نهائيّ.
    e_leads := public.mgmt_read_jsonb('public.crm_leads_list(jsonb)', 'public.crm_leads_list($1)',
                 jsonb_build_object('limit', 500), 'sales', 'docs/crm_sales_FOUNDATION_RUNME.sql');
    if (e_leads->>'state') = 'ok' then
      select count(*) into v_c
        from jsonb_array_elements(coalesce((e_leads->'data')->'rows', '[]'::jsonb)) x
       where (x->>'created_at')::date between v_from and v_to;
      -- أقدم صفّ **في القائمة كلّها** لا في النافذة: هو الذي يقرّر إن كانت
      -- النافذة مُغطّاة. القائمة مرتَّبة تنازليًّا ومقصوصة عند ٥٠٠.
      select min((x->>'created_at')::timestamptz) into v_min
        from jsonb_array_elements(coalesce((e_leads->'data')->'rows', '[]'::jsonb)) x;
      v_lb := (jsonb_array_length(coalesce((e_leads->'data')->'rows', '[]'::jsonb)) >= 500)
              and (v_min is null or v_min::date > v_from);
      v_kpis := v_kpis || public.mgmt_kpi('new_leads','sales','count', false,
        'ok', null, null, null, coalesce(v_c, 0)::numeric, coalesce(v_c, 0), 'filtered',
        jsonb_build_object('is_lower_bound', coalesce(v_lb, false), 'source_row_cap', 500,
          'note_ar', case when coalesce(v_lb, false)
            then 'بلغت القائمة سقف المصدر (٥٠٠) ولم تُغطَّ النافذة كاملةً — الرقم حدّ أدنى لا عدد نهائيّ.'
            else null end,
          'note_en', case when coalesce(v_lb, false)
            then 'Source row cap (500) reached and the window is not fully covered — this is a lower bound, not a final count.'
            else null end));
    else
      v_kpis := v_kpis || public.mgmt_kpi('new_leads','sales','count', false,
        e_leads->>'state', e_leads->>'reason', e_leads->>'message_ar', e_leads->>'message_en',
        null, null, 'filtered');
    end if;

    if (e_crm->>'state') = 'ok' then
      d := (e_crm->'data')->'counters';
      -- crm_stale_alerts تقصّ عند ٢٠٠ صفّ. بلوغ السقف يعني «٢٠٠ على الأقلّ»،
      -- ويُعلَن كذلك بدل أن يُقدَّم عددًا نهائيًّا.
      v_c := coalesce(jsonb_array_length(coalesce(((e_crm->'data')->'stale')->'rows', '[]'::jsonb)), 0);
      v_lb := (v_c >= 200);
      v_kpis := v_kpis || public.mgmt_kpi('stalled_opportunities','sales','count', false,
        'ok', null, null, null, v_c::numeric, v_c, 'current_state',
        jsonb_build_object('opps_open', d->'opps_open', 'awaiting_handoff', d->'awaiting_handoff',
          'is_lower_bound', v_lb, 'source_row_cap', 200,
          'note_ar', case when v_lb then 'بلغت قائمة المتعثّر سقف المصدر (٢٠٠) — الرقم حدّ أدنى.' else null end,
          'note_en', case when v_lb then 'Stale list hit the source cap (200) — this is a lower bound.' else null end));
    else
      v_kpis := v_kpis || public.mgmt_kpi('stalled_opportunities','sales','count', false,
        e_crm->>'state', e_crm->>'reason', e_crm->>'message_ar', e_crm->>'message_en');
    end if;

    -- الأنبوب والتوقّع المرجّح: مال ⇒ حسّاس ⇒ المالك وحده.
    if not v_sens then
      v_kpis := v_kpis
        || public.mgmt_kpi('pipeline_value','sales','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN)
        || public.mgmt_kpi('weighted_forecast','sales','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN);
    elsif (e_crm->>'state') = 'ok' then
      d := (e_crm->'data')->'counters';
      v_n := coalesce((d->>'pipeline_value')::numeric, 0);
      v_kpis := v_kpis || public.mgmt_kpi('pipeline_value','sales','money', true,
        'ok', null, null, null, v_n, coalesce((d->>'opps_open')::bigint, 0), 'current_state',
        jsonb_build_object('currency', (e_crm->'data')->'currency', 'opps_open', d->'opps_open'));
      v_n := coalesce((d->>'weighted_value')::numeric, 0);
      v_kpis := v_kpis || public.mgmt_kpi('weighted_forecast','sales','money', true,
        'ok', null, null, null, v_n, null, 'current_state',
        jsonb_build_object('currency', (e_crm->'data')->'currency',
          'forecast_months', ((e_crm->'data')->'forecast')->'rows'));
    else
      v_kpis := v_kpis
        || public.mgmt_kpi('pipeline_value','sales','money', true,
             e_crm->>'state', e_crm->>'reason', e_crm->>'message_ar', e_crm->>'message_en')
        || public.mgmt_kpi('weighted_forecast','sales','money', true,
             e_crm->>'state', e_crm->>'reason', e_crm->>'message_ar', e_crm->>'message_en');
    end if;
  else
    v_kpis := v_kpis
      || public.mgmt_kpi('new_leads','sales','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('stalled_opportunities','sales','count', false,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('pipeline_value','sales','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('weighted_forecast','sales','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN);
  end if;

  -- ── المالية ─────────────────────────────────────────────────────────────
  -- ★ القسم كلّه حسّاس ★ — غير المالك **لا تُستدعى له finops أصلًا**، فلا يتسرّب
  --   إليه حتى عدد الذمم المتأخّرة عبر تنبيه أو تفصيل.
  if not ('finance' = any (v_depts)) then
    v_kpis := v_kpis
      || public.mgmt_kpi('expenses','finance','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('commitments','finance','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('overdue_collections','finance','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN)
      || public.mgmt_kpi('estimated_profitability','finance','money', true,'filtered_out','department_not_selected', OFF_AR, OFF_EN);
  elsif not v_sens then
    v_kpis := v_kpis
      || public.mgmt_kpi('expenses','finance','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN)
      || public.mgmt_kpi('commitments','finance','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN)
      || public.mgmt_kpi('overdue_collections','finance','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN)
      || public.mgmt_kpi('estimated_profitability','finance','money', true,'restricted','owner_only', OWNER_AR, OWNER_EN);
  else
    e_fin := public.mgmt_read_jsonb('public.finops_dashboard(jsonb)', 'public.finops_dashboard($1)',
               jsonb_build_object('from', v_from::text, 'to', v_to::text),
               'finance', 'docs/finance_profitability_RUNME.sql');
    if (e_fin->>'state') = 'ok' then
      d := (e_fin->'data')->'counters';
      v_kpis := v_kpis || public.mgmt_kpi('expenses','finance','money', true,
        'ok', null, null, null, coalesce((d->>'actual_cost_gross')::numeric, 0),
        coalesce((d->>'expense_pending')::bigint, 0), 'filtered',
        jsonb_build_object('expense_pending', d->'expense_pending', 'basis', 'gross_incl_vat'));
      v_kpis := v_kpis || public.mgmt_kpi('commitments','finance','money', true,
        'ok', null, null, null, coalesce((d->>'committed_cost_gross')::numeric, 0),
        coalesce((d->>'open_po')::bigint, 0), 'filtered',
        jsonb_build_object('open_po', d->'open_po', 'purchase_pending', d->'purchase_pending',
          'basis', 'gross_incl_vat'));
      v_kpis := v_kpis || public.mgmt_kpi('overdue_collections','finance','money', true,
        'ok', null, null, null, coalesce((d->>'overdue_gross')::numeric, 0),
        coalesce((d->>'overdue_count')::bigint, 0), 'current_state',
        jsonb_build_object('outstanding_gross', d->'outstanding_gross',
          'aging', (e_fin->'data')->'aging', 'basis', 'gross_incl_vat'));

      -- الربحية: بوّابتها في المالية أضيق من بوّابة العرض. احترامها حرفيًّا.
      if coalesce(((e_fin->'data')->>'profit_visible')::boolean, false) then
        v_kpis := v_kpis || public.mgmt_kpi('estimated_profitability','finance','money', true,
          'ok', null, null, null,
          coalesce((((e_fin->'data')->'profit')->>'estimated_net_profit')::numeric, 0), null, 'filtered',
          jsonb_build_object(
            'gross_profit_net', ((e_fin->'data')->'profit')->'gross_profit_net',
            'gross_margin_pct', ((e_fin->'data')->'profit')->'gross_margin_pct',
            'estimated_net_margin_pct', ((e_fin->'data')->'profit')->'estimated_net_margin_pct',
            'basis', ((e_fin->'data')->'profit')->'basis',
            'is_estimate', true,
            'note_ar', 'رقم تقديريّ محسوب على الصافي قبل الضريبة، ولا يقوم مقام الدفاتر المحاسبية.',
            'note_en', 'An estimate computed net of VAT; it does not replace the accounting books.'));
      else
        v_kpis := v_kpis || public.mgmt_kpi('estimated_profitability','finance','money', true,
          'restricted', 'finance_profit_gate',
          'الموديول المالي يحجب الربحية عن هذا الحساب (بوّابة finance_ops.view_profit). القيمة محجوبة لا صفرًا.',
          'The finance module withholds profitability from this account (finance_ops.view_profit gate). Withheld, not zero.',
          null, null, 'filtered');
      end if;
    else
      v_kpis := v_kpis
        || public.mgmt_kpi('expenses','finance','money', true, e_fin->>'state', e_fin->>'reason', e_fin->>'message_ar', e_fin->>'message_en', null, null, 'filtered')
        || public.mgmt_kpi('commitments','finance','money', true, e_fin->>'state', e_fin->>'reason', e_fin->>'message_ar', e_fin->>'message_en', null, null, 'filtered')
        || public.mgmt_kpi('overdue_collections','finance','money', true, e_fin->>'state', e_fin->>'reason', e_fin->>'message_ar', e_fin->>'message_en')
        || public.mgmt_kpi('estimated_profitability','finance','money', true, e_fin->>'state', e_fin->>'reason', e_fin->>'message_ar', e_fin->>'message_en', null, null, 'filtered');
    end if;
  end if;

  -- ── تنبيهات الإدارة — مشتقّة من المؤشّرات أعلاه، لا من مصدر خامس ────────
  --    ★ لا يُبنى تنبيه على مؤشّر ليس ok ★: تنبيه مبنيّ على «غير متاح» يقول
  --      «لا مشكلة» بينما الحقيقة «لا نعرف».
  v_alerts := public.mgmt_alerts_from(v_kpis, v_sens);

  return jsonb_build_object(
    'kpis', v_kpis,
    'alerts', v_alerts,
    'sensitive_visible', v_sens,
    'sensitive_message_ar', case when v_sens then null else OWNER_AR end,
    'sensitive_message_en', case when v_sens then null else OWNER_EN end);
end $$;

-- اشتقاق التنبيهات. مفصولة عن الحساب كي تُختبَر وحدها.
create or replace function public.mgmt_alerts_from(p_kpis jsonb, p_sensitive boolean)
returns jsonb language plpgsql immutable set search_path = public as $$
declare k jsonb; out_j jsonb := '[]'::jsonb; v numeric; c bigint; unknown_n int := 0;
begin
  for k in select * from jsonb_array_elements(coalesce(p_kpis, '[]'::jsonb)) loop
    -- كلّ مؤشّر ليس ok وليس مُرشَّحًا خارجًا هو **فجوة معرفة** تُعلَن كتنبيه
    -- من نوعها الخاصّ. الصمت عنه يجعل اللوحة تبدو نظيفة وهي عمياء.
    if (k->>'state') not in ('ok','filtered_out') then
      if (k->>'state') in ('unavailable','error') then unknown_n := unknown_n + 1; end if;
      continue;
    end if;
    if (k->>'state') <> 'ok' then continue; end if;
    if coalesce((k->>'sensitive')::boolean, false) and not coalesce(p_sensitive, false) then continue; end if;

    v := nullif(k->>'value', '')::numeric;
    c := nullif(k->>'count', '')::bigint;

    if (k->>'key') = 'notifications_failed' and coalesce(v, 0) > 0 then
      out_j := out_j || jsonb_build_object('key','notifications_failed','severity','high',
        'department','communications','sensitive', false,
        'title_ar','إشعارات فشل إرسالها', 'title_en','Failed notifications',
        'detail_ar', v::text || ' إشعارًا في حالة فشل أو صندوق ميّت — رسائل لم تصل ولن تصل بلا تدخّل.',
        'detail_en', v::text || ' notification(s) failed or dead-lettered — messages that did not and will not arrive unattended.');
    end if;
    if (k->>'key') = 'notifications_pending' and coalesce(v, 0) > 50 then
      out_j := out_j || jsonb_build_object('key','notifications_backlog','severity','medium',
        'department','communications','sensitive', false,
        'title_ar','تراكم في طابور الإشعارات', 'title_en','Notification backlog',
        'detail_ar', v::text || ' إشعارًا معلّقًا. راجع تشغيل العامل قبل أن يتحوّل التأخّر إلى فشل.',
        'detail_en', v::text || ' pending. Check the worker before delay turns into failure.');
    end if;
    if (k->>'key') = 'resource_conflicts' and coalesce(v, 0) > 0 then
      out_j := out_j || jsonb_build_object('key','resource_conflicts','severity','high',
        'department','production','sensitive', false,
        'title_ar','تعارض في الطاقم أو المعدّات', 'title_en','Crew / equipment conflicts',
        'detail_ar', v::text || ' تعارضًا في النافذة المختارة — مورد واحد محجوز مرّتين.',
        'detail_en', v::text || ' conflict(s) in the selected window — a resource is double-booked.');
    end if;
    if (k->>'key') = 'operational_readiness' and coalesce(v, 100) < 80 then
      out_j := out_j || jsonb_build_object('key','operational_readiness','severity',
        case when coalesce(v, 100) < 50 then 'high' else 'medium' end,
        'department','production','sensitive', false,
        'title_ar','جاهزية تشغيلية منخفضة', 'title_en','Low operational readiness',
        'detail_ar', 'الجاهزية ' || v::text || '٪ — مهامّ قادمة بلا طاقم أو معدّات أو تصاريح مكتملة.',
        'detail_en', 'Readiness at ' || v::text || '% — upcoming jobs missing crew, equipment or permits.');
    end if;
    if (k->>'key') = 'operational_readiness' and coalesce(((k->'detail')->>'media_not_backed_up')::int, 0) > 0 then
      out_j := out_j || jsonb_build_object('key','media_not_backed_up','severity','high',
        'department','production','sensitive', false,
        'title_ar','مادّة مصوَّرة غير مؤمَّنة', 'title_en','Media not backed up',
        'detail_ar', ((k->'detail')->>'media_not_backed_up') || ' بطاقة بلا نسخ احتياطيّ مُتحقَّق منه.',
        'detail_en', ((k->'detail')->>'media_not_backed_up') || ' card(s) without verified backup.');
    end if;
    if (k->>'key') = 'stalled_opportunities' and coalesce(v, 0) > 0 then
      out_j := out_j || jsonb_build_object('key','stalled_opportunities','severity','medium',
        'department','sales','sensitive', false,
        'title_ar','فرص متعثّرة', 'title_en','Stalled opportunities',
        'detail_ar', v::text || ' فرصة بلا حركة منذ مدّة تتجاوز الحدّ المضبوط في المبيعات.',
        'detail_en', v::text || ' opportunit(ies) idle beyond the threshold configured in Sales.');
    end if;
    if (k->>'key') = 'overdue_collections' and coalesce(c, 0) > 0 then
      out_j := out_j || jsonb_build_object('key','overdue_collections','severity','high',
        'department','finance','sensitive', true,
        'title_ar','تحصيلات متأخّرة', 'title_en','Overdue collections',
        'detail_ar', c::text || ' ذمّة متأخّرة بإجماليّ ' || coalesce(v, 0)::text || ' (شامل الضريبة).',
        'detail_en', c::text || ' overdue receivable(s) totalling ' || coalesce(v, 0)::text || ' (VAT incl.).');
    end if;
    if (k->>'key') = 'estimated_profitability'
       and coalesce(((k->'detail')->>'gross_margin_pct')::numeric, 100) < 20 then
      out_j := out_j || jsonb_build_object('key','thin_margin','severity','medium',
        'department','finance','sensitive', true,
        'title_ar','هامش إجماليّ منخفض', 'title_en','Thin gross margin',
        'detail_ar', 'الهامش الإجماليّ ' || ((k->'detail')->>'gross_margin_pct') || '٪ في المدى المختار (رقم تقديريّ).',
        'detail_en', 'Gross margin at ' || ((k->'detail')->>'gross_margin_pct') || '% for the selected range (an estimate).');
    end if;
  end loop;

  if unknown_n > 0 then
    out_j := out_j || jsonb_build_object('key','blind_spots','severity','medium',
      'department','reporting','sensitive', false,
      'title_ar','مؤشّرات لا تُقرأ', 'title_en','KPIs that cannot be read',
      'detail_ar', unknown_n::text || ' مؤشّرًا غير متاح أو أخفق — اللوحة **لا تعرف** حالتها، وهذا ليس «لا مشاكل».',
      'detail_en', unknown_n::text || ' KPI(s) unavailable or errored — the dashboard does NOT know their state. This is not "no problems".');
  end if;
  return out_j;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) الواجهة العامّة.
-- ════════════════════════════════════════════════════════════════════════════

-- مِجَسّ الوصول — لا يرفع استثناء أبدًا، كي تفرّق الواجهة بين المنع والترحيلة.
create or replace function public.mgmt_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'authenticated', false,
      'can_view', false, 'can_view_sensitive', false, 'can_export', false,
      'is_client', false, 'user_id', null,
      'message_ar', 'سجّل الدخول للوصول إلى اللوحة التنفيذية.',
      'message_en', 'Sign in to reach the executive dashboard.');
  end if;
  return jsonb_build_object('ok', true, 'authenticated', true, 'user_id', v_uid,
    'can_view',           coalesce(public.mgmt_can_view(), false),
    'can_view_sensitive', coalesce(public.mgmt_can_view_sensitive(), false),
    'can_export',         coalesce(public.mgmt_can_export(), false),
    'is_client',          coalesce(public.mgmt_is_client(), false),
    'departments',        to_jsonb(public.mgmt_departments()),
    'message_ar', case
      when coalesce(public.mgmt_is_client(), false)
        then 'اللوحة التنفيذية داخلية بالكامل ولا تُتاح لحسابات العملاء.'
      when not coalesce(public.mgmt_can_view(), false)
        then 'لا تملك صلاحية اللوحة التنفيذية (exec_report.view).'
      when not coalesce(public.mgmt_can_view_sensitive(), false)
        then 'المؤشّرات المالية والهوامش مقصورة على المالك وحده ولا تُمنَح بمفتاح.'
      else null end,
    'message_en', case
      when coalesce(public.mgmt_is_client(), false)
        then 'The executive dashboard is internal only and is not available to client accounts.'
      when not coalesce(public.mgmt_can_view(), false)
        then 'You do not have the executive dashboard permission (exec_report.view).'
      when not coalesce(public.mgmt_can_view_sensitive(), false)
        then 'Financial KPIs and margins are owner-only and are not grantable by key.'
      else null end);
end $$;

-- حالة المصادر — تُقال كما هي: مطبَّق؟ مسموح لك؟ وأيّ ملفّ يُشغَّل إن لا.
create or replace function public.mgmt_sources()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; r record; v_auth boolean; v_ss text;
begin
  if not coalesce(public.mgmt_can_view(), false) then raise exception 'not authorized'; end if;
  for r in
    select * from (values
      ('communications','public.comms_health()','public.comms_can_view()','docs/communications_hub_RUNME.sql'),
      ('production','public.prodops_dashboard(jsonb)','public.prodops_can_view()','docs/operations_center_RUNME.sql'),
      ('sales','public.crm_dashboard(jsonb)','public.crm_can_view()','docs/crm_sales_FOUNDATION_RUNME.sql'),
      ('finance','public.finops_dashboard(jsonb)','public.finops_can_view()','docs/finance_profitability_RUNME.sql'),
      ('live_operations','public.liveops_session_list(jsonb)','public.liveops_can_view()','docs/live_operations_dashboard_RUNME.sql'),
      ('ai_assistant','public.ai_admin_overview()','public.ai_can_view_knowledge()','docs/kian_ai_assistant_RUNME.sql')
    ) t(module, sig, gate, runme)
  loop
    v_auth := null;
    if coalesce(public.mgmt_source_installed(r.gate), false) then
      begin
        execute 'select coalesce(' || r.gate || ', false)' into v_auth;
      exception when others then
        get stacked diagnostics v_ss = returned_sqlstate;
        v_auth := null;
      end;
    end if;
    v := v || jsonb_build_object(
      'module', r.module,
      'installed', coalesce(public.mgmt_source_installed(r.sig), false),
      'authorized', v_auth,
      'runme', r.runme,
      'note_ar', case
        when not coalesce(public.mgmt_source_installed(r.sig), false)
          then 'غير مطبَّق — شغّل ' || r.runme || '. مؤشّراته ستظهر «غير متاح» لا صفرًا.'
        when v_auth is false then 'مطبَّق لكنّه لا يسمح لك بالقراءة — منع لا عطل.'
        when v_auth is null  then 'مطبَّق، وتعذّر تقييم بوّابته — تُعرض المؤشّرات بحالتها الحقيقية.'
        else null end,
      'note_en', case
        when not coalesce(public.mgmt_source_installed(r.sig), false)
          then 'Not installed — run ' || r.runme || '. Its KPIs will read "unavailable", never zero.'
        when v_auth is false then 'Installed but it denies you — a denial, not a fault.'
        when v_auth is null  then 'Installed; its gate could not be evaluated — KPIs show their true state.'
        else null end);
  end loop;
  return jsonb_build_object('ok', true, 'sources', v, 'checked_at', now());
end $$;

-- ★ اللوحة ★ — volatile لأنّها تكتب النسخة المؤقّتة. الطزاجة مُعلَنة دائمًا.
create or replace function public.mgmt_dashboard(
  p_filters jsonb default '{}'::jsonb, p_force_refresh boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_norm jsonb; v_sens boolean; v_key text; v_ttl int;
        v_row public.mgmt_report_cache%rowtype; v_payload jsonb;
        v_age numeric; v_t0 timestamptz := clock_timestamp(); v_ms int;
        v_msg text; v_ss text;
begin
  if not coalesce(public.mgmt_can_view(), false) then raise exception 'not authorized'; end if;

  v_norm := public.mgmt_norm_filters(p_filters);
  v_sens := coalesce(public.mgmt_can_view_sensitive(), false);
  v_key  := public.mgmt_cache_key(v_norm, v_sens);
  v_ttl  := coalesce((v_norm->>'ttl_seconds')::int, 300);

  select * into v_row from public.mgmt_report_cache where cache_key = v_key;

  -- (١) نسخة طازجة ⇒ تُقدَّم كما هي، ومعها عمرها بالثواني.
  if v_row.cache_key is not null and not coalesce(p_force_refresh, false) then
    v_age := extract(epoch from (now() - v_row.computed_at));
    if v_age <= v_ttl then
      return jsonb_build_object('ok', true, 'from_cache', true, 'is_stale', false,
        'generated_at', v_row.computed_at, 'age_seconds', round(v_age)::int,
        'ttl_seconds', v_ttl, 'served_at', now(),
        'filters', v_norm, 'sensitive_visible', v_sens) || v_row.payload;
    end if;
  end if;

  -- (٢) إعادة الحساب. الفشل هنا لا يجوز أن يُقدَّم كنجاح ولا أن يُقدَّم القديمُ حيًّا.
  begin
    v_payload := public.mgmt_compute(v_norm);
  exception when others then
    get stacked diagnostics v_ss = returned_sqlstate, v_msg = message_text;
    if v_row.cache_key is not null then
      v_age := extract(epoch from (now() - v_row.computed_at));
      return jsonb_build_object('ok', true, 'from_cache', true,
        'is_stale', true, 'stale_reason', 'recompute_failed',
        'stale_sqlstate', coalesce(v_ss, '-'),
        'stale_message_ar', 'تعذّرت إعادة الحساب، وهذه أرقام قديمة عمرها ' || round(v_age)::int::text
                            || ' ثانية. لا تُقرأ على أنّها حيّة.',
        'stale_message_en', 'Recompute failed; these numbers are ' || round(v_age)::int::text
                            || ' seconds old. Do not read them as live.',
        'generated_at', v_row.computed_at, 'age_seconds', round(v_age)::int,
        'ttl_seconds', v_ttl, 'served_at', now(),
        'filters', v_norm, 'sensitive_visible', v_sens) || v_row.payload;
    end if;
    return jsonb_build_object('ok', false, 'error', 'compute_failed',
      'sqlstate', coalesce(v_ss, '-'), 'generated_at', null, 'is_stale', false,
      'served_at', now(), 'filters', v_norm,
      'message_ar', 'تعذّر حساب اللوحة ولا توجد نسخة سابقة تُعرض. الرمز: ' || coalesce(v_ss, '-') || '.',
      'message_en', 'The dashboard could not be computed and there is no earlier copy. Code: '
                    || coalesce(v_ss, '-') || '.');
  end;

  v_ms := (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int;
  insert into public.mgmt_report_cache
    (cache_key, user_id, filters, sensitive_view, payload, computed_at, compute_ms, ttl_seconds)
  values (v_key, auth.uid(), v_norm, v_sens, v_payload, now(), v_ms, v_ttl)
  on conflict (cache_key) do update set
    filters = excluded.filters, sensitive_view = excluded.sensitive_view,
    payload = excluded.payload, computed_at = excluded.computed_at,
    compute_ms = excluded.compute_ms, ttl_seconds = excluded.ttl_seconds;

  -- كنس محدود لصفوف هذا المستخدم وحده: كلّ تركيبة مرشّحات تُنشئ صفًّا، فبلا هذا
  -- ينمو الجدول بلا سقف. حذف مفهرَس ورخيص، ولا يمسّ صفوف أحد آخر.
  delete from public.mgmt_report_cache
   where user_id = auth.uid() and cache_key <> v_key
     and computed_at < now() - interval '1 day';

  return jsonb_build_object('ok', true, 'from_cache', false, 'is_stale', false,
    'generated_at', now(), 'age_seconds', 0, 'ttl_seconds', v_ttl,
    'compute_ms', v_ms, 'served_at', now(),
    'filters', v_norm, 'sensitive_visible', v_sens) || v_payload;
end $$;

-- تحديث صريح بطلب المستخدم — مُدقَّق، لأنّ إعادة الحساب قراءة موسَّعة للمصادر.
create or replace function public.mgmt_refresh(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.mgmt_can_view(), false) then raise exception 'not authorized'; end if;
  v := public.mgmt_dashboard(p_filters, true);
  perform public.mgmt_log('refresh', 'dashboard', null,
    jsonb_build_object('filters', v->'filters',
                       'sensitive_visible', coalesce(public.mgmt_can_view_sensitive(), false)));
  return v;
end $$;

-- التصدير — مجموعتان محدَّدتان سلفًا، لا SQL حرّ من الواجهة، وأثرٌ مكتوب دائمًا.
-- ★ لا يوسّع الرؤية ★: الصفوف تُبنى من ناتج mgmt_dashboard نفسه، فالمؤشّر المحجوب
--   يخرج محجوبًا بحالته ولا يخرج بقيمة.
create or replace function public.mgmt_export(p_dataset text, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb; v_rows jsonb; v_cols jsonb;
begin
  if not coalesce(public.mgmt_can_view(), false)  then raise exception 'not authorized'; end if;
  if not coalesce(public.mgmt_can_export(), false) then raise exception 'not authorized'; end if;
  if p_dataset is null or p_dataset not in ('kpis','alerts') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_dataset');
  end if;

  v := public.mgmt_dashboard(p_filters, false);
  if coalesce((v->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'dashboard_unavailable',
      'message_ar', v->>'message_ar', 'message_en', v->>'message_en');
  end if;

  if p_dataset = 'kpis' then
    v_cols := '["key","department","unit","sensitive","state","value","count","date_scope","reason","message_ar"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object(
        'key', k->>'key', 'department', k->>'department', 'unit', k->>'unit',
        'sensitive', k->>'sensitive', 'state', k->>'state',
        'value', k->'value', 'count', k->'count',
        'date_scope', k->>'date_scope', 'reason', k->>'reason',
        'message_ar', k->>'message_ar')), '[]'::jsonb)
      into v_rows from jsonb_array_elements(coalesce(v->'kpis', '[]'::jsonb)) k;
  else
    v_cols := '["key","severity","department","title_ar","detail_ar","title_en","detail_en"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object(
        'key', a->>'key', 'severity', a->>'severity', 'department', a->>'department',
        'title_ar', a->>'title_ar', 'detail_ar', a->>'detail_ar',
        'title_en', a->>'title_en', 'detail_en', a->>'detail_en')), '[]'::jsonb)
      into v_rows from jsonb_array_elements(coalesce(v->'alerts', '[]'::jsonb)) a;
  end if;

  perform public.mgmt_log('export', 'dataset', p_dataset,
    jsonb_build_object('filters', v->'filters', 'rows', jsonb_array_length(v_rows),
                       'sensitive_visible', coalesce(public.mgmt_can_view_sensitive(), false)));

  return jsonb_build_object('ok', true, 'dataset', p_dataset,
    'columns', v_cols, 'rows', v_rows,
    'generated_at', v->'generated_at', 'is_stale', v->'is_stale',
    'age_seconds', v->'age_seconds', 'filters', v->'filters',
    'sensitive_visible', coalesce(public.mgmt_can_view_sensitive(), false),
    'note_ar', 'الطابع الزمنيّ أعلاه هو وقت حساب الأرقام لا وقت التصدير.',
    'note_en', 'The timestamp above is when the numbers were computed, not when they were exported.');
end $$;

-- سجلّ التدقيق — للمالك وحده، ومقروء.
create or replace function public.mgmt_audit_list(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; n int;
begin
  if not coalesce(public.mgmt_can_view_sensitive(), false) then raise exception 'not authorized'; end if;
  n := least(greatest(coalesce(p_limit, 100), 1), 500);
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v from (
    select jsonb_build_object('id', a.id, 'action', a.action, 'entity_type', a.entity_type,
      'entity_id', a.entity_id, 'detail', a.detail, 'created_at', a.created_at,
      'actor_name', (select p.full_name from public.profiles p where p.id = a.actor_id)) as x
    from public.mgmt_audit a order by a.created_at desc limit n
  ) s;
  return jsonb_build_object('ok', true, 'rows', v);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) الصلاحيات — سحب صريح من public/anon، ومنح ضيّق لـauthenticated.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  -- (أ) الواجهة العامّة + المُسنَدات (تُقيَّم داخل RLS بدور المُنادي).
  foreach f in array array[
    'public.mgmt_access()',
    'public.mgmt_sources()',
    'public.mgmt_dashboard(jsonb,boolean)',
    'public.mgmt_refresh(jsonb)',
    'public.mgmt_export(text,jsonb)',
    'public.mgmt_audit_list(int)',
    'public.mgmt_can_view()',
    'public.mgmt_can_view_sensitive()',
    'public.mgmt_can_export()',
    'public.mgmt_is_client()',
    'public.mgmt_perm(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ب) الداخلية: لا تُمنَح لأحد. أخطرها mgmt_compute وmgmt_read_jsonb —
  --     منحهما لـauthenticated يعني قراءة المصادر خارج بوّابة اللوحة.
  foreach f in array array[
    'public.mgmt_log(text,text,text,jsonb)',
    'public.mgmt_departments()',
    'public.mgmt_env(text,text,text,text,jsonb)',
    'public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)',
    'public.mgmt_classify(text,text)',
    'public.mgmt_source_installed(text)',
    'public.mgmt_read_jsonb(text,text,jsonb,text,text)',
    'public.mgmt_read_calendar(date,date)',
    'public.mgmt_norm_filters(jsonb)',
    'public.mgmt_cache_key(jsonb,boolean)',
    'public.mgmt_compute(jsonb)',
    'public.mgmt_alerts_from(jsonb,boolean)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ج) الجداول: قراءة فقط لـauthenticated (وRLS هي الفاصل)، ولا شيء لـanon.
  foreach t in array array['mgmt_report_cache','mgmt_audit'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) SELF-TEST — ثابت. الاستدعاءات الحيّة الوحيدة إمّا مُسنَدات بلا بوّابة
--      (النتيجة الصحيحة بلا جلسة = false)، أو استدعاء محميّ **ملفوف بمصيدة
--      تتحقّق من وقوع المنع فعلًا** — أي اختبار يستطيع أن يفشل. لا مصيدة
--      كاسحة تجعل فحصًا ينجح مهما حدث.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare
  t text; f text; v_def text; v jsonb; v_b boolean; v_n bigint; v_err text;
  v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  TABLES     constant text[] := array['mgmt_report_cache','mgmt_audit'];
  PREDICATES constant text[] := array['public.mgmt_can_view()','public.mgmt_can_view_sensitive()',
                                      'public.mgmt_can_export()','public.mgmt_is_client()'];
  INTERNAL   constant text[] := array['public.mgmt_compute(jsonb)',
    'public.mgmt_read_jsonb(text,text,jsonb,text,text)','public.mgmt_read_calendar(date,date)',
    'public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)',
    'public.mgmt_log(text,text,text,jsonb)','public.mgmt_alerts_from(jsonb,boolean)',
    'public.mgmt_cache_key(jsonb,boolean)','public.mgmt_norm_filters(jsonb)'];
  GATED      constant text[] := array['public.mgmt_dashboard(jsonb,boolean)',
    'public.mgmt_refresh(jsonb)','public.mgmt_export(text,jsonb)','public.mgmt_sources()'];
  KPI_KEYS   constant text[] := array['notifications_pending','notifications_failed',
    'operational_readiness','resource_conflicts','upcoming_jobs','new_leads','pipeline_value',
    'weighted_forecast','stalled_opportunities','expenses','commitments','overdue_collections',
    'estimated_profitability',
    -- ★ العمليات المباشرة ومساعد كيان — أضيفا في التدقيق النهائيّ.
    --   كلاهما عدّ غير حسّاس، وكلاهما يُقرأ عبر mgmt_read_jsonb فيبقى غياب
    --   الموديول «غير مطبَّق» لا صفرًا، ويبقى منع القارئ «ممنوع» لا صفرًا.
    'live_sessions_active','live_open_incidents',
    'ai_knowledge_approved','ai_leads_pending_review'];
begin
  -- (1) الجدولان موجودان، RLS مفعّلة، ولا سياسة كتابة على أيّهما
  foreach t in array TABLES loop
    if to_regclass('public.' || t) is null then raise exception 'MGMT SELF-TEST: الجدول % غير موجود', t; end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = t) then
      raise exception 'MGMT SELF-TEST: RLS غير مفعّلة على %', t; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'MGMT SELF-TEST: % بلا سياسة — جدول مفتوح', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT') then
      raise exception 'MGMT SELF-TEST: سياسة كتابة على % — الكتابة يجب أن تمرّ بـRPC', t; end if;
  end loop;

  -- (2) لا anon على جدول ولا على دالّة
  if v_anon then
    foreach t in array TABLES loop
      if exists (select 1 from information_schema.role_table_grants
                  where table_schema = 'public' and table_name = t and grantee = 'anon') then
        raise exception 'MGMT SELF-TEST: anon يملك صلاحية على %', t; end if;
    end loop;
    for f in select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'mgmt\_%' loop
      if has_function_privilege('anon', f, 'EXECUTE') then
        raise exception 'MGMT SELF-TEST: anon يملك EXECUTE على %', f; end if;
    end loop;
  end if;

  -- (3) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت
  for f, v_b, v_def in
    select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mgmt\_%'
  loop
    -- الدوالّ الثابتة النقيّة (immutable) لا تلمس كائنات، لكنّ المسار يبقى مثبَّتًا.
    if v_def not ilike '%search_path%' then
      raise exception 'MGMT SELF-TEST: % بلا search_path مثبَّت', f; end if;
  end loop;
  foreach f in array (PREDICATES || GATED) loop
    if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(f)) then
      raise exception 'MGMT SELF-TEST: % ليست SECURITY DEFINER', f; end if;
  end loop;

  -- (4) الدوالّ الداخلية لا تُنفَّذ من الواجهة
  foreach f in array INTERNAL loop
    if to_regprocedure(f) is null then raise exception 'MGMT SELF-TEST: الدالّة الداخلية % مفقودة', f; end if;
    if has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'MGMT SELF-TEST: authenticated يملك EXECUTE على الداخلية %', f; end if;
  end loop;

  -- (5) المُسنَدات تعيد false لا NULL بلا جلسة (استدعاء حيّ آمن: لا بوّابة فيها)
  v_b := public.mgmt_can_view();
  if v_b is null then raise exception 'MGMT SELF-TEST: can_view أعادت NULL — انهيار fail-closed'; end if;
  if v_b then raise exception 'MGMT SELF-TEST: can_view = true بلا جلسة — fail-open'; end if;
  v_b := public.mgmt_can_view_sensitive();
  if v_b is null then raise exception 'MGMT SELF-TEST: can_view_sensitive أعادت NULL'; end if;
  if v_b then raise exception 'MGMT SELF-TEST: can_view_sensitive = true بلا جلسة — تسريب مال'; end if;
  v_b := public.mgmt_can_export();
  if v_b is null then raise exception 'MGMT SELF-TEST: can_export أعادت NULL'; end if;
  if v_b then raise exception 'MGMT SELF-TEST: can_export = true بلا جلسة'; end if;
  v_b := public.mgmt_is_client();
  if v_b is null then raise exception 'MGMT SELF-TEST: is_client أعادت NULL'; end if;
  v_b := public.mgmt_perm('exec_report.view');
  if v_b is null then raise exception 'MGMT SELF-TEST: perm أعادت NULL'; end if;
  if v_b then raise exception 'MGMT SELF-TEST: perm = true بلا جلسة'; end if;
  v_b := public.mgmt_perm(null);
  if v_b is null then raise exception 'MGMT SELF-TEST: perm(NULL) أعادت NULL'; end if;

  -- (6) المِجَسّ يعمل بلا جلسة ولا يرفع، ويعلن انعدام القدرة
  v := public.mgmt_access();
  if coalesce((v->>'ok')::boolean, false) is not true then raise exception 'MGMT SELF-TEST: access لم تُرجع ok'; end if;
  if coalesce((v->>'can_view')::boolean, true) is not false then
    raise exception 'MGMT SELF-TEST: access تمنح can_view بلا جلسة'; end if;
  if coalesce((v->>'can_view_sensitive')::boolean, true) is not false then
    raise exception 'MGMT SELF-TEST: access تمنح can_view_sensitive بلا جلسة'; end if;
  if pg_get_functiondef(to_regprocedure('public.mgmt_access()')) ilike '%raise exception%' then
    raise exception 'MGMT SELF-TEST: المِجَسّ يرفع استثناء — تفقد الواجهة التفريق بين المنع والترحيلة'; end if;

  -- (7) ★ فحص يستطيع أن يفشل ★: اللوحة والتصدير يرفعان المنع فعلًا بلا جلسة.
  --     المصيدة هنا تتحقّق من نصّ الخطأ ولا تبتلعه.
  v_err := '';
  begin
    perform public.mgmt_dashboard('{}'::jsonb, false);
  exception when others then v_err := SQLERRM;
  end;
  if v_err not ilike '%not authorized%' then
    raise exception 'MGMT SELF-TEST: mgmt_dashboard لم ترفع منعًا بلا جلسة (%) — fail-open',
      coalesce(nullif(v_err, ''), 'بلا خطأ'); end if;
  v_err := '';
  begin
    perform public.mgmt_export('kpis', '{}'::jsonb);
  exception when others then v_err := SQLERRM;
  end;
  if v_err not ilike '%not authorized%' then
    raise exception 'MGMT SELF-TEST: mgmt_export لم ترفع منعًا بلا جلسة (%)',
      coalesce(nullif(v_err, ''), 'بلا خطأ'); end if;
  v_err := '';
  begin
    perform public.mgmt_audit_list(10);
  exception when others then v_err := SQLERRM;
  end;
  if v_err not ilike '%not authorized%' then
    raise exception 'MGMT SELF-TEST: سجلّ التدقيق مقروء بلا جلسة (%)',
      coalesce(nullif(v_err, ''), 'بلا خطأ'); end if;

  -- (8) كلّ دالّة عامّة مُبوَّبة قبل أن تقرأ شيئًا (عدا المِجَسّ عمدًا)
  foreach f in array GATED loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%mgmt_can_view()%' then
      raise exception 'MGMT SELF-TEST: % بلا بوّابة اللوحة', f; end if;
    if v_def not ilike '%not authorized%' then
      raise exception 'MGMT SELF-TEST: % لا ترفع منعًا صريحًا', f; end if;
  end loop;
  if pg_get_functiondef(to_regprocedure('public.mgmt_audit_list(int)')) not ilike '%mgmt_can_view_sensitive()%' then
    raise exception 'MGMT SELF-TEST: سجلّ التدقيق ليس خلف بوّابة المالك'; end if;

  -- (9) ★ العميل مستبعد بنيويًّا ★ ولا اشتقاق من صلاحية المشاريع
  foreach f in array PREDICATES loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if f <> 'public.mgmt_is_client()' and v_def not ilike '%is_staff%' then
      raise exception 'MGMT SELF-TEST: % لا تشترط كون المستخدم موظّفًا', f; end if;
    if v_def ilike '%can_manage_projects%' then
      raise exception 'MGMT SELF-TEST: % تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته', f; end if;
  end loop;

  -- (10) ★ الطبقة الحسّاسة للمالك وحده ولا مفتاح يفتحها ★
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_can_view_sensitive()'));
  if v_def not ilike '%is_owner()%' then
    raise exception 'MGMT SELF-TEST: بوّابة المؤشّرات الحسّاسة لا تشترط المالك'; end if;
  if v_def ilike '%mgmt_perm%' then
    raise exception 'MGMT SELF-TEST: بوّابة المؤشّرات الحسّاسة تُفتَح بمفتاح — الهامش يخرج بقرار إداريّ عابر'; end if;
  if exists (select 1 from public.permissions where key ilike 'exec\_report.%sensitive%') then
    raise exception 'MGMT SELF-TEST: وُجد مفتاح صلاحية للمؤشّرات الحسّاسة — يناقض «المالك وحده»'; end if;
  -- المالية كلّها خلف بوّابة المالك داخل المحرّك نفسه
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)'));
  if v_def not ilike '%mgmt_can_view_sensitive()%' then
    raise exception 'MGMT SELF-TEST: المحرّك لا يستشير بوّابة المالك'; end if;
  if v_def !~ 'elsif\s+not\s+v_sens\s+then' then
    raise exception 'MGMT SELF-TEST: قسم المالية غير محجوب عن غير المالك قبل استدعاء finops'; end if;

  -- (11) ★★ العقد الأساسيّ: لا قيمة إلّا في الحالة ok ★★
  --      نقطة الاختناق واحدة، وهذا الفحص يحرسها نصًّا وسلوكًا معًا.
  v_def := pg_get_functiondef(to_regprocedure(
    'public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)'));
  if v_def !~* 'case\s+when\s+p_state\s*=\s*''ok''\s+then\s+p_value\s+else\s+null\s+end' then
    raise exception 'MGMT SELF-TEST: mgmt_kpi لا تُصفّر القيمة خارج الحالة ok — صفرٌ سيعني «غير مطبَّق»'; end if;
  -- سلوكيًّا: مؤشّر «غير متاح» بقيمة ٩٩ يجب أن يخرج بقيمة NULL لا ٩٩ ولا ٠.
  v := public.mgmt_kpi('t','production','count', false,'unavailable','module_not_installed','x','x', 99, 99, 'filtered', '{"a":1}'::jsonb);
  if (v->'value') <> 'null'::jsonb then
    raise exception 'MGMT SELF-TEST: مؤشّر غير متاح خرج بقيمة % — كذبة تُقرأ كـ«لا مشاكل»', v->>'value'; end if;
  if (v->'count') <> 'null'::jsonb then
    raise exception 'MGMT SELF-TEST: مؤشّر غير متاح خرج بعدّاد'; end if;
  if (v->'detail') <> '{}'::jsonb then
    raise exception 'MGMT SELF-TEST: مؤشّر غير متاح خرج بتفاصيل'; end if;
  v := public.mgmt_kpi('t','production','count', false,'ok', null, null, null, 0, 0, 'filtered', null);
  if (v->>'value') <> '0' then
    raise exception 'MGMT SELF-TEST: صفرٌ حقيقيّ لا يخرج كصفر — الاتّجاه الآخر من الكذبة نفسها'; end if;

  -- (12) كلّ مصدر يكتشف قبل أن يقرأ، ويُسمّي ملفّ الـRUNME في رسالته
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_read_jsonb(text,text,jsonb,text,text)'));
  if v_def not ilike '%mgmt_source_installed%' then
    raise exception 'MGMT SELF-TEST: القارئ لا يكتشف وجود المصدر'; end if;
  if v_def not ilike '%module_not_installed%' then
    raise exception 'MGMT SELF-TEST: القارئ لا يميّز «غير مطبَّق»'; end if;
  if v_def not ilike '%not_authorized%' then
    raise exception 'MGMT SELF-TEST: القارئ لا يميّز المنع عن الترحيلة الناقصة'; end if;
  if v_def ilike '%return 0%' or v_def ilike '%''value'', 0%' then
    raise exception 'MGMT SELF-TEST: القارئ يستبدل الفشل بصفر'; end if;
  -- التصنيف يفرّق فعلًا (فحص سلوكيّ يستطيع أن يفشل)
  if public.mgmt_classify('42501','permission denied') <> 'restricted' then
    raise exception 'MGMT SELF-TEST: 42501 لا يُصنَّف منعًا'; end if;
  if public.mgmt_classify('P0001','not authorized') <> 'restricted' then
    raise exception 'MGMT SELF-TEST: «not authorized» لا يُصنَّف منعًا'; end if;
  if public.mgmt_classify('42883','function does not exist') <> 'unavailable' then
    raise exception 'MGMT SELF-TEST: غياب الدالّة لا يُصنَّف «غير متاح»'; end if;
  if public.mgmt_classify('22012','division by zero') <> 'error' then
    raise exception 'MGMT SELF-TEST: خطأ عامّ يُصنَّف خطأً — التصنيف يبتلع'; end if;

  -- (13) اللوحة تُعلن الطزاجة دائمًا ولا تقدّم قديمًا كحيّ
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_dashboard(jsonb,boolean)'));
  foreach t in array array['generated_at','age_seconds','is_stale','from_cache','ttl_seconds','served_at'] loop
    if v_def not ilike '%' || t || '%' then
      raise exception 'MGMT SELF-TEST: اللوحة لا تُعلن %', t; end if;
  end loop;
  if v_def not ilike '%recompute_failed%' then
    raise exception 'MGMT SELF-TEST: فشل إعادة الحساب لا يُوسَم — نسخة قديمة ستُقرأ كحيّة'; end if;
  if v_def !~* '''is_stale'',\s*true' then
    raise exception 'MGMT SELF-TEST: لا مسار يضع is_stale = true — الوسم صوريّ'; end if;
  if v_def not ilike '%mgmt_cache_key%' then
    raise exception 'MGMT SELF-TEST: اللوحة لا تستعمل مفتاح ذاكرة'; end if;
  -- مفتاح الذاكرة يفصل بين المستخدمين وبين مستويَي الحساسية
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_cache_key(jsonb,boolean)'));
  if v_def not ilike '%auth.uid()%' then
    raise exception 'MGMT SELF-TEST: مفتاح الذاكرة لا يتضمّن المستخدم — نسخة المالك قد تُقدَّم لغيره'; end if;
  if v_def not ilike '%p_sensitive%' then
    raise exception 'MGMT SELF-TEST: مفتاح الذاكرة لا يتضمّن مستوى الحساسية'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'mgmt_report_cache' and qual ilike '%user_id = auth.uid()%') then
    raise exception 'MGMT SELF-TEST: سياسة الذاكرة لا تقصر الصفّ على صاحبه'; end if;
  -- كنس الذاكرة يجري بدور المالك (SECURITY DEFINER) فلا تكبحه RLS: حذف غير
  -- مقيَّد بصاحب الصفّ كان سيمحو ذاكرة كلّ المستخدمين عند كلّ إعادة حساب.
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_dashboard(jsonb,boolean)'));
  if v_def ilike '%delete from public.mgmt_report_cache%'
     and v_def !~* 'delete from public\.mgmt_report_cache[\s\S]{0,120}user_id = auth\.uid\(\)' then
    raise exception 'MGMT SELF-TEST: كنس الذاكرة غير مقيَّد بصاحب الصفّ — يمحو ذاكرة الآخرين';
  end if;

  -- (14) الكتابات الحسّاسة مُدقَّقة
  foreach f in array array['public.mgmt_refresh(jsonb)','public.mgmt_export(text,jsonb)'] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%mgmt_log%' then
      raise exception 'MGMT SELF-TEST: % بلا تدقيق', f; end if;
  end loop;
  if pg_get_functiondef(to_regprocedure('public.mgmt_export(text,jsonb)')) not ilike '%unknown_dataset%' then
    raise exception 'MGMT SELF-TEST: التصدير يقبل مجموعة غير معروفة — SQL حرّ من الواجهة'; end if;

  -- (15) ★ حارس تجميد منصّة المشاريع ★
  --     هذه الحزمة لا تكتب في المنصّة، ولا تقرأها، ولا تذكرها إطلاقًا.
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mgmt\_%'
  loop
    if v_def ~* '\b(insert\s+into|update|delete\s+from)\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b' then
      raise exception 'MGMT SELF-TEST: دالّة تكتب في منصّة المشاريع المجمَّدة'; end if;
    if v_def ~* '\bpublic\.(projects|project_core|deliverables|deliverable_internal)\b'
    or v_def ~* '\bpublic\.(project|large_project)_[a-z_]+\s*\(' then
      raise exception 'MGMT SELF-TEST: دالّة تلمس منصّة المشاريع المجمَّدة ولو بالقراءة'; end if;
    if v_def ~* '\b(pg_net|net\.http_post|net\.http_get|dblink)\b' then
      raise exception 'MGMT SELF-TEST: دالّة تحاول مكالمة شبكية خارجية'; end if;
    if v_def ~* '(client_secret|refresh_token|access_token|api_key|service_role)' then
      raise exception 'MGMT SELF-TEST: دالّة تتعامل مع بيانات اعتماد'; end if;
  end loop;

  -- (16) الترحيلة لا تنشئ بيانات ولا تكتب في التدقيق
  select count(*) into v_n from public.mgmt_report_cache;
  if v_n <> 0 then raise exception 'MGMT SELF-TEST: الترحيلة أنشأت % صفّ ذاكرة', v_n; end if;
  select count(*) into v_n from public.mgmt_audit;
  if v_n <> 0 then raise exception 'MGMT SELF-TEST: الترحيلة كتبت في سجلّ التدقيق'; end if;

  -- (17) المؤشّرات الثلاثة عشر مبنيّة فعلًا داخل المحرّك (لا كتالوج معلَّق)
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)'));
  foreach t in array KPI_KEYS loop
    if v_def not ilike '%''' || t || '''%' then
      raise exception 'MGMT SELF-TEST: المؤشّر % غير مبنيّ في المحرّك', t; end if;
  end loop;

  -- (18) تطبيع المرشّحات صادق: قسم مجهول يُبلَّغ ولا يُبتلَع
  v := public.mgmt_norm_filters('{"departments":["sales","atlantis"],"from":"2026-01-01","to":"2026-01-10"}'::jsonb);
  if (v->'departments') <> '["sales"]'::jsonb then
    raise exception 'MGMT SELF-TEST: تطبيع الأقسام غير صحيح (%)', v->>'departments'; end if;
  if (v->'unknown_departments') <> '["atlantis"]'::jsonb then
    raise exception 'MGMT SELF-TEST: قسم مجهول ابتُلع بصمت — العرض يبدو مُرشَّحًا وليس كذلك'; end if;
  v := public.mgmt_norm_filters('{"from":"2026-05-01","to":"2026-01-01"}'::jsonb);
  if (v->>'from') <> (v->>'to') then
    raise exception 'MGMT SELF-TEST: مدى مقلوب لم يُصحَّح'; end if;
  v := public.mgmt_norm_filters('{}'::jsonb);
  if jsonb_array_length(v->'departments') <> 4 then
    raise exception 'MGMT SELF-TEST: الافتراض ليس «كلّ الأقسام»'; end if;
  -- المتصل يقصّر عمر النسخة ولا يمدّده: تمديده = نافذة قراءة بعد سحب الصلاحية
  v := public.mgmt_norm_filters('{"ttl_seconds":3600}'::jsonb);
  if (v->>'ttl_seconds')::int > 300 then
    raise exception 'MGMT SELF-TEST: المتصل مدّد عمر النسخة المخبّأة إلى % ثانية — يقرأ بعد سحب صلاحيته',
      v->>'ttl_seconds'; end if;
  v := public.mgmt_norm_filters('{"ttl_seconds":30}'::jsonb);
  if (v->>'ttl_seconds')::int <> 30 then
    raise exception 'MGMT SELF-TEST: التقصير الطوعيّ للعمر لا يسري'; end if;

  -- (18b) ★ الجاهزية لا تُبنى بطرح عدّادات من نافذة أخرى ★
  --       فحص يستطيع أن يفشل: الصيغة القديمة كانت تطرح عدّادات ١٤/٢١ يومًا من
  --       مقام ٨ أيام وتعدّ المهمّة الواحدة ثلاث مرّات ⇒ ٠٪ لفريق جاهز.
  v_def := pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)'));
  if v_def not ilike '%avg_job_readiness_score%' then
    raise exception 'MGMT SELF-TEST: الجاهزية لا تُحسب من متوسّط درجات المهامّ في النافذة نفسها'; end if;
  if v_def ilike '%(d->>''missing_crew'')::bigint%' then
    raise exception 'MGMT SELF-TEST: الجاهزية ما زالت تطرح عدّادات النقص من مقام نافذة أخرى'; end if;
  if v_def not ilike '%readiness_not_reported%' then
    raise exception 'MGMT SELF-TEST: غياب درجات الجاهزية يُقرأ صفرًا بدل «لا أساس»'; end if;

  -- (19) التنبيهات لا تُبنى على مؤشّر ليس ok، وتُعلن العمى بدل الصمت عنه
  v := public.mgmt_alerts_from(jsonb_build_array(
        public.mgmt_kpi('notifications_failed','communications','count', false,
          'unavailable','module_not_installed','x','x', 7, 7, 'current_state', null)), true);
  if jsonb_array_length(v) <> 1 or (v->0->>'key') <> 'blind_spots' then
    raise exception 'MGMT SELF-TEST: تنبيه بُني على مؤشّر غير متاح، أو العمى لم يُعلَن (%)', v::text; end if;
  v := public.mgmt_alerts_from(jsonb_build_array(
        public.mgmt_kpi('overdue_collections','finance','money', true,
          'ok', null, null, null, 5000, 3, 'current_state', null)), false);
  if jsonb_array_length(v) <> 0 then
    raise exception 'MGMT SELF-TEST: تنبيه ماليّ حسّاس وصل إلى غير المالك'; end if;
  v := public.mgmt_alerts_from(jsonb_build_array(
        public.mgmt_kpi('notifications_failed','communications','count', false,
          'ok', null, null, null, 3, 3, 'current_state', null)), false);
  if jsonb_array_length(v) <> 1 or (v->0->>'severity') <> 'high' then
    raise exception 'MGMT SELF-TEST: تنبيه غير حسّاس لم يصل، أو شدّته خاطئة'; end if;

  raise notice 'MGMT SELF-TEST: نجح — جدولان · RLS قراءة فقط · لا anon · مُسنَدات لا تعيد NULL · الحسّاس للمالك بلا مفتاح · «غير متاح» لا يساوي صفرًا أبدًا · الطزاجة مُعلَنة · ومنصّة المشاريع لم تُمَسّ ولو بالقراءة.';
end $st$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: executive_reporting_POSTCHECK.sql
-- المنح: لا شيء يُمنَح تلقائيًّا. امنح exec_report.view (وexec_report.export عند
--   الحاجة) من شاشة الصلاحيات. المؤشّرات المالية والهوامش لا مفتاح لها: المالك
--   وحده، بالتصميم.
-- التفاصيل: docs/EXECUTIVE_REPORTING_CONTRACT.md · docs/EXECUTIVE_REPORTING_ACCEPTANCE.md
-- ════════════════════════════════════════════════════════════════════════════
