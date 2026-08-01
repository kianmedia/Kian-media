-- ════════════════════════════════════════════════════════════════════════════
-- docs/final_platform_acceptance_RUNME.sql
--
-- قبول المنصّة النهائيّ — مِشْحَنُ الاختبار.
-- Final platform acceptance — HARNESS.  (NOT a migration.)
--
-- ✅ هذا ملفّ SQL: يُنفَّذ في محرّر SQL.  (‎.md‎ = يُقرأ فقط ولا يُنسخ هنا)
--
-- ⛔ ليست هذه ترحيلة. لا تُنشئ كائنًا ولا تُغيّر بيانات ولا تمنح صلاحية.
--
-- كيف يبقى بلا أثر — والبرهان لا الوعد:
--   • لا جملة كتابة واحدة على أيّ جدول دائم: لا INSERT ولا UPDATE ولا DELETE
--     ولا GRANT ولا ALTER. الاختبار يقرأ ويحاكي جلسةً ويقرأ ثانية.
--   • محاكاة الجلسة بـ‎set local role‎ و‎set_config(..., is_local => true)‎،
--     وكلاهما ينتهي حتمًا بانتهاء المعاملة.
--   • تُستدعى **المُسنَدات القارئة فقط** (mgmt_can_view · mgmt_can_view_sensitive
--     · mgmt_can_export · mgmt_is_client). ولا تُستدعى mgmt_dashboard ولا
--     mgmt_refresh ولا mgmt_export: هذه تكتب في mgmt_report_cache وmgmt_audit،
--     وحتّى مع التراجع تتقدّم المتسلسلات — فالتراجع ليس نظافةً كاملة.
--     الاختيار المحافظ: لا نُناديها أصلًا، ونُعلن ما لم يُختبَر.
--   • المعاملة تنتهي COMMIT لأنّها **لم تكتب شيئًا**؛ ولو أُنهيت ROLLBACK
--     لضاع التقرير معها: PostgreSQL يتراجع عن SET وعن set_config غير المحلّيّ
--     كما يتراجع عن الصفوف، فلا قناة تنجو من التراجع إلا الاستثناء.
--   • جدول التقرير مؤقّت (temp) على مستوى الجلسة: يزول بإغلاق الاتّصال، ولا
--     يراه التطبيق ولا يظهر في أيّ مخطّط دائم.
--
-- ما لا يستطيع هذا الملفّ إثباته — ولا يدّعيه:
--   سلوكَ الواجهة تحت جلسة متصفّح حقيقيّة. محاكاة الدور والمطالبات تُثبت
--   **البوّابة** لا **الشاشة**. كلّ بند كهذا يخرج MANUAL_REQUIRED، ولا يُحسب
--   نجاحًا، ومكانه docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md.
--
-- الحكم النهائيّ في الصفّ الأخير: READY | READY_WITH_MANUAL_STEPS | STOP.
-- ════════════════════════════════════════════════════════════════════════════

drop table if exists pg_temp.kian_acceptance_report;

create temp table kian_acceptance_report(
  sort_key  int,
  area      text,
  check_id  text,
  verdict   text,          -- PASS | FAIL | INFO | MANUAL_REQUIRED
  expected  text,
  detail    text
) on commit preserve rows;

begin;

do $harness$
declare
  v_owner   uuid;
  v_staff   uuid;
  v_client  uuid;
  v_n       int := 0;
  b_view    boolean; b_sens boolean; b_exp boolean; b_cli boolean;

  -- يُشغّل المُسنَدات الأربعة تحت هويّة مُحاكاة، ثمّ يعود إلى الدور الأصليّ.
  procedure_note text;
begin
  -- ── اختيار حساب واحد لكلّ دور. لا بريد ولا اسم: المعرّف وحده، ولا يُعرَض
  --    منه إلّا ثمانية محارف.
  select p.id into v_owner from public.profiles p
   where p.account_status = 'active'
     and (p.account_type = 'admin' or p.staff_role = 'super_admin')
   order by p.id limit 1;

  select p.id into v_staff from public.profiles p
   where p.account_status = 'active'
     and p.staff_role is not null and p.staff_role <> 'super_admin'
     and coalesce(p.account_type, '') <> 'admin'
   order by p.id limit 1;

  select p.id into v_client from public.profiles p
   where p.account_status = 'active'
     and p.staff_role is null
     and coalesce(p.account_type, '') <> 'admin'
   order by p.id limit 1;

  -- ══ (أ) الأدوار: البوّابة تحت هويّة مُحاكاة ══════════════════════════════
  -- المالك
  if v_owner is null then
    insert into kian_acceptance_report values
      (100, 'الأدوار', 'owner.gates', 'MANUAL_REQUIRED',
       'owner sees reporting and sensitive metrics',
       'لا حساب مالك نشط — البند غير مُختبَر ولا يُحسب نجاحًا');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    b_view := public.mgmt_can_view();
    b_sens := public.mgmt_can_view_sensitive();
    b_exp  := public.mgmt_can_export();
    b_cli  := public.mgmt_is_client();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into kian_acceptance_report values
      (100, 'الأدوار', 'owner.gates',
       case when b_view and b_sens and b_exp and not b_cli then 'PASS' else 'FAIL' end,
       'can_view=t · can_view_sensitive=t · can_export=t · is_client=f',
       'uuid8=' || left(v_owner::text, 8) || ' → view=' || b_view || ' sens=' || b_sens
         || ' export=' || b_exp || ' client=' || b_cli);
  end if;

  -- موظّف غير مالك
  if v_staff is null then
    insert into kian_acceptance_report values
      (110, 'الأدوار', 'staff.no_sensitive', 'MANUAL_REQUIRED',
       'non-owner staff never sees sensitive profitability',
       'لا حساب موظّف غير مالك — البند غير مُختبَر');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    b_view := public.mgmt_can_view();
    b_sens := public.mgmt_can_view_sensitive();
    b_exp  := public.mgmt_can_export();
    b_cli  := public.mgmt_is_client();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into kian_acceptance_report values
      (110, 'الأدوار', 'staff.no_sensitive',
       case when (not b_sens) and (not b_cli) then 'PASS' else 'FAIL' end,
       'can_view_sensitive=f (owner-only) · is_client=f',
       'uuid8=' || left(v_staff::text, 8) || ' → view=' || b_view || ' sens=' || b_sens
         || ' export=' || b_exp);
  end if;

  -- عميل
  if v_client is null then
    insert into kian_acceptance_report values
      (120, 'الأدوار', 'client.denied', 'MANUAL_REQUIRED',
       'client sees no internal executive reporting at all',
       'لا حساب عميل نشط — البند غير مُختبَر');
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
    b_view := public.mgmt_can_view();
    b_sens := public.mgmt_can_view_sensitive();
    b_exp  := public.mgmt_can_export();
    b_cli  := public.mgmt_is_client();
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into kian_acceptance_report values
      (120, 'الأدوار', 'client.denied',
       case when (not b_view) and (not b_sens) and (not b_exp) and b_cli then 'PASS' else 'FAIL' end,
       'can_view=f · sensitive=f · export=f · is_client=t',
       'uuid8=' || left(v_client::text, 8) || ' → view=' || b_view || ' sens=' || b_sens
         || ' export=' || b_exp || ' client=' || b_cli);
  end if;

  -- زائر بلا جلسة: الدور anon وبلا مطالبات
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    insert into kian_acceptance_report values
      (130, 'الأدوار', 'anon.zero_access', 'MANUAL_REQUIRED',
       'anon reaches nothing', 'دور anon غير موجود — البند غير مُختبَر');
  else
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    b_view := public.mgmt_can_view();
    b_sens := public.mgmt_can_view_sensitive();
    procedure_note := 'view=' || coalesce(b_view::text,'null') || ' sens=' || coalesce(b_sens::text,'null');
  exception when insufficient_privilege then
    b_view := false; b_sens := false;
    procedure_note := 'EXECUTE مرفوض لـanon — وهو أقوى من إرجاع false';
  end;
  reset role;
  insert into kian_acceptance_report values
    (130, 'الأدوار', 'anon.zero_access',
     case when (not coalesce(b_view, false)) and (not coalesce(b_sens, false)) then 'PASS' else 'FAIL' end,
     'anon reaches nothing and never returns NULL-as-true',
     procedure_note);
  end if;

  -- ══ (ب) دلالات المال — بنيويّة، تُقرأ من نصّ الدوالّ لا من جلسة ══════════
  -- الأساس المالي مفصول: قيمة العقد ≠ المفوتر ≠ المحصّل، والمُعترف به يبقى NULL
  -- ما لم يُوصَل مصدر اعتراف معتمد.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mgmt_revenue_basis';
  insert into kian_acceptance_report
  select 200, 'المال', 'finance.bases_separated',
         case when v_n = 1
               and d like '%contract_value_net%' and d like '%invoiced_revenue_net%'
               and d like '%collected_revenue_net%' and d like '%recognized_revenue_net%'
              then 'PASS' else 'FAIL' end,
         'contract ≠ invoiced ≠ collected, and recognized is a separate key',
         'keys present in mgmt_revenue_basis: ' || v_n::text
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_revenue_basis(date,date)')) as d) q;

  insert into kian_acceptance_report
  select 210, 'المال', 'finance.recognized_stays_null',
         case when d like '%''recognized_revenue_net'', null%' then 'PASS' else 'FAIL' end,
         'recognized revenue is NULL — never inferred from invoiced or collected',
         'no accounting-recognition source is wired; the key is emitted as NULL by construction'
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_revenue_basis(date,date)')) as d) q;

  insert into kian_acceptance_report
  select 220, 'المال', 'finance.vat_excluded',
         case when d like '%vat_included%' then 'PASS' else 'FAIL' end,
         'VAT is declared and excluded from net revenue',
         'mgmt_revenue_basis emits vat_included = false alongside the net figures'
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_revenue_basis(date,date)')) as d) q;

  insert into kian_acceptance_report
  select 230, 'المال', 'finance.mixed_currency_not_summed',
         case when d like '%mixed_currency%' and d like '%unavailable_grouped_by_currency%'
              then 'PASS' else 'FAIL' end,
         'more than one currency ⇒ no total is produced',
         'cross-currency total is refused, not converted at an invented rate'
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_revenue_basis(date,date)')) as d) q;

  -- الربح لا يُستنتج: غياب الأساس يُبقيه NULL ولا يصير صفرًا
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mgmt_compute'
     and pg_get_functiondef(p.oid) ~ 'coalesce\s*\([^)]*profit[^)]*,\s*0\s*\)';
  insert into kian_acceptance_report values
    (240, 'المال', 'finance.no_profit_inference',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'profit/margin stay NULL when the basis is incomplete — never collapsed to 0',
     'coalesce(profit…, 0) occurrences in mgmt_compute: ' || v_n);

  -- ══ (ج) سلامة الحزم الأربع + تجميد منصّة المشاريع ════════════════════════
  select count(*) into v_n from (values
      ('case_studies_platform','cs\_%'), ('live_operations_dashboard','liveops\_%'),
      ('kian_ai_assistant','ai\_%'), ('executive_reporting','mgmt\_%')
    ) as x(pkg, pre)
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind in ('r','p')
                        and c.relname like x.pre escape '\');
  insert into kian_acceptance_report values
    (300, 'الحزم', 'packages.four_intact',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'case studies · live ops · AI assistant · executive reporting all installed',
     'missing packages: ' || v_n);

  -- لا دالّة في الحزم الأربع تكتب على منصّة المشاريع
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'cs\_%' or p.proname like 'liveops\_%'
       or p.proname like 'ai\_%' or p.proname like 'mgmt\_%')
     and lower(pg_get_functiondef(p.oid)) ~
         '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(only[[:space:]]+)?(public\.)?(projects|project_core|deliverables)\M';
  insert into kian_acceptance_report values
    (310, 'الحزم', 'packages.no_project_writes',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'the four packages never write to projects / project_core / deliverables',
     'writer functions found: ' || v_n);

  -- لا نداء شبكيّ ولا مزوّد حيّ من أيّ دالّة في الحزم الأربع
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'cs\_%' or p.proname like 'liveops\_%'
       or p.proname like 'ai\_%' or p.proname like 'mgmt\_%')
     and lower(pg_get_functiondef(p.oid)) ~ '(net\.http|http_post|http_get|pg_net|dblink|curl_)';
  insert into kian_acceptance_report values
    (320, 'الحزم', 'packages.no_external_http',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'no function performs an outbound HTTP call',
     'functions naming an HTTP mechanism: ' || v_n);

  -- ══ (د) السطح العامّ لدراسات الحالة: ثلاثة تواقيع، ولا رابع ═════════════
  --   العقد من الحزمة نفسها (القسم د في كتلة منحها). يُقاس بالتوقيع الكامل
  --   لا بالبادئة، فالبادئة تخلط السطح المقصود بالدوالّ الداخليّة.
  -- ★ الحكم على OID لا على نصّ: pg_get_function_identity_arguments يُبقي
  --   أسماء الوسائط، فأنتج على الإنتاج «cs_public_index(p_params jsonb)»
  --   ولم يطابق قائمةً مكتوبةً بالأنواع. to_regprocedure تُحوّل، والنصّ للعرض.
  --   ⚠️ NULL مُستبعَد: NOT IN مع NULL يُعيد NULL فيبتلع كلّ صفّ.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
       or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
     and exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.oid not in (select o from unnest(array[
           to_regprocedure('public.cs_public_index(jsonb)')::oid,
           to_regprocedure('public.cs_public_study(text)')::oid,
           to_regprocedure('public.cs_public_slugs()')::oid]) as t(o)
                        where o is not null);
  insert into kian_acceptance_report values
    (340, 'السطح العامّ', 'anon.only_three_public_reads',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'anon executes exactly the three declared public reads and nothing else',
     'unexpected anon-executable signatures: ' || v_n);

  -- والثلاثة قراءةٌ فقط، بإسقاطٍ صريح، ومحروسة بالنشر والإذن.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cs_public_index','cs_public_study','cs_public_slugs')
     and (p.provolatile <> 's'                                  -- ليست stable
       or not p.prosecdef                                       -- ليست definer
       or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
       or lower(pg_get_functiondef(p.oid)) ~ '(insert[[:space:]]+into|update[[:space:]]|delete[[:space:]]+from)'
       or lower(pg_get_functiondef(p.oid)) ~ 'to_jsonb[[:space:]]*\([[:space:]]*[a-z_]+[[:space:]]*\)'
       or lower(pg_get_functiondef(p.oid)) ~ 'select[[:space:]]+\*[[:space:]]+from[[:space:]]+public\.cs_case_studies');
  insert into kian_acceptance_report values
    (341, 'السطح العامّ', 'public_reads_are_safe',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'stable · security definer · pinned search_path · no writes · explicit projection',
     'violating public functions: ' || v_n);

  -- ولا مسوّدة تُقرأ: البوّابة cs_is_public في كلٍّ منها.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('cs_public_index','cs_public_study','cs_public_slugs')
     and pg_get_functiondef(p.oid) not like '%cs_is_public%';
  insert into kian_acceptance_report values
    (342, 'السطح العامّ', 'public_reads_gate_on_published',
     case when v_n = 0 then 'PASS' else 'FAIL' end,
     'every public read filters through cs_is_public (published + consent + no embargo)',
     'public functions missing the gate: ' || v_n);

  insert into kian_acceptance_report
  select 330, 'الحزم', 'ai.provider_disabled',
         case when coalesce(bool_or(provider_enabled), false) then 'FAIL' else 'PASS' end,
         'the external AI provider stays disabled — acceptance never wakes it',
         'ai_settings.provider_enabled = ' || coalesce(bool_or(provider_enabled), false)::text
  from public.ai_settings;

  -- ══ (د) ما لا يُثبَت هنا — يُعلَن ولا يُحوَّل إلى PASS ════════════════════
  insert into kian_acceptance_report values
    (900, 'يدويّ', 'ui.owner_view_renders', 'MANUAL_REQUIRED',
     'owner opens executive reporting and sees labels, freshness, NULL states',
     'browser only — §1 of docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md'),
    (901, 'يدويّ', 'ui.non_owner_denied', 'MANUAL_REQUIRED',
     'non-owner staff sees no profitability and no sensitive export',
     'browser only — §2 of the manual'),
    (902, 'يدويّ', 'ui.client_denied', 'MANUAL_REQUIRED',
     'client cannot reach the internal reporting route at all',
     'browser only — §3 of the manual'),
    (903, 'يدويّ', 'ui.case_studies_lifecycle', 'MANUAL_REQUIRED',
     'draft → review → publish → unpublish, consent respected, no internal leak',
     'browser only — §4 of the manual'),
    (904, 'يدويّ', 'ui.liveops_no_cost', 'MANUAL_REQUIRED',
     'live operations shows freshness and never a cost, margin or vendor rate',
     'browser only — §5 of the manual'),
    (905, 'يدويّ', 'ui.ai_disabled_state', 'MANUAL_REQUIRED',
     'the assistant declares itself disabled / configuration_required and claims no provider',
     'browser only — §6 of the manual');

  -- تنظيف صريح: لا دور مُحاكًى ولا مطالبات باقية بعد الاختبار.
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ (هـ) برهان الكتابة الصفريّة — من المحرّك لا من الادّعاء ══════════════
  --   pg_stat_xact_user_tables تعدّ صفوف هذه المعاملة وحدها. الجداول المؤقّتة
  --   مستثناة بالمخطّط (pg_temp%) لأنّ تقرير الاختبار نفسه يُكتب فيها.
  --   إن لمس الاختبار جدولًا دائمًا فالإجهاض هنا، **قبل** COMMIT.
  select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) into v_n
    from pg_stat_xact_user_tables
   where schemaname not like 'pg\_temp%' and schemaname <> 'pg_toast';
  if v_n > 0 then
    raise exception 'ACCEPTANCE ABORTED: الاختبار كتب % صفًّا على جدول دائم — '
      'وهو مِشْحَنُ قراءة لا ترحيلة. لم يُحفظ شيء.', v_n;
  end if;
  insert into kian_acceptance_report values
    (400, 'الأثر', 'harness.wrote_nothing', 'PASS',
     '0 rows inserted/updated/deleted on any permanent table',
     'مقيسٌ من pg_stat_xact_user_tables داخل المعاملة نفسها: ' || v_n || ' صفًّا');
end
$harness$;

commit;   -- ★ المعاملة لم تكتب على أيّ جدول دائم؛ وSET LOCAL انتهى بانتهائها.

-- ── التقرير ────────────────────────────────────────────────────────────────
select
  case verdict when 'FAIL' then 1 when 'MANUAL_REQUIRED' then 2
               when 'INFO' then 3 else 4 end                    as "ترتيب",
  area      as "المجال",
  check_id  as "الفحص",
  verdict   as "الحكم",
  expected  as "المتوقّع",
  detail    as "المرصود"
from (
  select * from kian_acceptance_report
  union all
  select 9999, '★', '★ VERDICT',
         case when exists (select 1 from kian_acceptance_report where verdict = 'FAIL')
                then 'STOP'
              when exists (select 1 from kian_acceptance_report where verdict = 'MANUAL_REQUIRED')
                then 'READY_WITH_MANUAL_STEPS'
              else 'READY' end,
         'READY | READY_WITH_MANUAL_STEPS | STOP',
         'MANUAL_REQUIRED لا يُحوَّل إلى PASS أبدًا: البنود اليدويّة في '
           || 'docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md — وهو ملفّ Markdown '
           || 'يُقرأ في المتصفّح ولا يُنسخ إلى هذا المحرّر.'
) z
order by sort_key;
