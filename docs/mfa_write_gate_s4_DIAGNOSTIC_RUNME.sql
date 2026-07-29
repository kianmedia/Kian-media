-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P2 · S4 · **مِسبار اتّجاه المنع** — تشخيص غير مُتلِف، لا يكتب شيئًا
-- docs/mfa_write_gate_s4_DIAGNOSTIC_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ لماذا يوجد هذا الملفّ — العيب البنيويّ الذي يُخفيه كل فحص نصّيّ ★
--
--   `public.mfa_write_ok()` تفشل **مفتوحةً** في كل مسار خطأ، عمدًا:
--       exception when others then return true;   -- (s4a:94-100)
--   ومن ضمن تلك المسارات قراءة `auth.mfa_factors` (s4a:82-88).
--   ⇒ إن كان **الدور المالك للدالّة** لا يملك SELECT على `auth.mfa_factors`،
--     فالقراءة ترفع 42501، فيبتلعها المعالج، فتُعيد الدالّة `true` **دائمًا**.
--     البوّابة عندها **لا تمنع أحدًا أبدًا** — وهي تبدو مُطبَّقة تمامًا:
--     الملفّ موجود، التعريف صحيح، الفحص النصّيّ (like '%mfa_require_aal2%')
--     يطبع PASS على كل سطر. لا شيء في المستودع كلّه يُثبت اتّجاه **المنع**.
--
--   ⇒ هذا الملفّ يُثبته أو ينفيه بالتجربة، بلا كتابة، وبلا لمس أيّ تعريف حيّ.
--
-- ★ ما يفعله ★
--   يُنشئ `public.mfa_gate_selftest()` — دالّة قراءة واحدة:
--     • تستدعي **نفس** `public.mfa_write_ok()` (لا نسخة، لا إعادة تنفيذ للمنطق)
--     • تُعيد booleans ونصوص تصنيف مغلقة فقط
--     • تُجرّب قراءة `auth.mfa_factors` من داخل SECURITY DEFINER وتُبلّغ **بنجاحها
--       أو فشلها كقيمة منطقية مستقلّة** — لأن هذا وحده هو الافتراض الذي يجعل
--       البوّابة خاملة إلى الأبد
--
-- ★ ما لا يُعيده أبدًا — قيد بالبناء لا بالنيّة ★
--   لا JWT · لا claims · لا `sub`/`session_id` · لا معرّف عامل · لا معرّف تحدٍّ ·
--   لا رمز TOTP · لا سرّ · لا بريد · لا صفّ من `auth.mfa_factors`.
--   كل ما يخرج: قيم منطقية، ونصوص من مفردات مُعرَّفة هنا، وSQLSTATE (خمسة محارف).
--
-- ★ السلامة ★
--   لا INSERT/UPDATE/DELETE/TRUNCATE · لا DROP · لا ALTER · لا جدول · لا trigger ·
--   لا سياسة RLS · لا مساس بـ `mfa_write_ok`/`mfa_require_aal2`/`is_admin`/`is_owner`
--   ولا بأيّ دالّة أعمال · idempotent · `stable`.
--
-- ★★ الصلاحيات ★★  `revoke ... from public, anon` صريح ثم `grant` لـ`authenticated`
--   وحدها. (حادثة `authz-null-collapse` في هذا المستودع كانت SECURITY DEFINER
--   بلا REVOKE — لا يتكرّر ذلك هنا.)
--
-- ★ التنظيف ★  docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql — يحذف هذه الدالّة
--   وحدها. شغّله فور انتهاء القبول.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · اعتماديات — الرفض هنا صريح، فلا يُنشأ مِسبار يقيس العدم
-- ─────────────────────────────────────────────────────────────────────────────
do $pre$
begin
  if to_regprocedure('public.mfa_write_ok()') is null then
    raise exception 'رفض: public.mfa_write_ok() غير موجودة — شغّل docs/mfa_write_gate_s4a_RUNME.sql أولًا';
  end if;
  if to_regclass('public.mfa_settings') is null then
    raise exception 'رفض: public.mfa_settings غير موجود — شغّل docs/mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;
  if to_regclass('auth.mfa_factors') is null then
    raise exception 'رفض: auth.mfa_factors غير مرئي لهذه الجلسة — شغّل الملفّ في محرّر SQL بدور postgres';
  end if;
end $pre$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · المِسبار
-- ─────────────────────────────────────────────────────────────────────────────
-- ملاحظة على `search_path`: مطابق لـ`mfa_write_ok` (`public, auth`)، ومع ذلك كل
-- مرجع هنا مؤهَّل بالكامل (`public.` / `auth.` / `pg_catalog.`) فلا يعتمد الحلّ
-- على المسار إطلاقًا.
--
-- مفردات `reason` — مغلقة، وبنفس ترتيب فروع `mfa_write_ok` حرفيًا:
--   service_role_bypass    (فرع 1) مفتاح خدمة — لا بوّابة، ولا يجوز أن تكون
--   enforcement_mode_off   (فرع 2) الوضع ≠ enrollment — زرّ الطوارئ فعّال
--   not_authenticated      (فرع 3) لا جلسة
--   role_lookup_failed     (فرع 4) تعذّرت قراءة profiles ⇒ سماح (فشل مفتوح)
--   role_out_of_scope      (فرع 4) موظّف/عميل — خارج نطاق البوّابة أصلًا
--   factor_read_failed     (فرع 5) ★ تعذّرت قراءة auth.mfa_factors ⇒ سماح دائم ★
--   no_verified_factor     (فرع 5) لا عامل مُفعَّل للمتصل ⇒ سماح (منع الإقفال)
--   aal2_satisfied         (فرع 6) إداريّ · عامل · aal2 ⇒ سماح مستحقّ
--   denied_aal1            (فرع 6) ★ الحالة الوحيدة التي تُنتج منعًا ★
--
-- مفردات `verdict` — مغلقة:
--   gate_can_deny                    البوّابة قادرة على المنع فعلًا
--   gate_inert_cannot_read_factors   ★ خاملة بنيويًّا: المالك لا يقرأ mfa_factors
--   gate_inert_no_factor_visible     تقرأ لكن لا ترى أيّ عامل مُفعَّل في المشروع
--   gate_off_by_mode                 معطّلة بالوضع (enforcement_mode ≠ enrollment)
--   gate_definition_drift            الجسم الحيّ لا يقرأ mfa_factors / ليس definer
--   probe_inconclusive_owner_mismatch  مالك المِسبار ≠ مالك البوّابة ⇒ القياس غير ملزم
--   gate_unavailable                 تعذّر استدعاء mfa_write_ok نفسها
create or replace function public.mfa_gate_selftest()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $fn$
declare
  v_raw        text;
  v_j          jsonb;
  v_uid        uuid;
  v_is_service boolean := false;
  v_is_aal2    boolean := false;
  v_mode       text;
  v_acct       text;
  v_staff      text;
  v_in_scope   boolean := false;
  v_role_ok    boolean := true;     -- هل نجحت قراءة profiles أصلًا
  v_self_has   boolean := false;    -- عامل مُفعَّل للمتصل — **قيمة منطقية فقط**
  v_read_ok    boolean := false;    -- ★ هل استطاع المالك قراءة auth.mfa_factors
  v_read_state text := null;        -- SQLSTATE عند الفشل (خمسة محارف — آمن)
  v_any_factor boolean := null;     -- هل يرى المالك أيّ عامل مُفعَّل (يُعرض للمتميّز فقط)
  v_actual     boolean := null;     -- ناتج mfa_write_ok() الحقيقي
  v_gate_state text := null;        -- SQLSTATE إن فشل استدعاؤها
  v_reason     text;
  v_predicted  boolean;
  v_def        text;
  v_secdef     boolean := false;
  v_reads      boolean := false;
  v_owner_gate text;
  v_owner_self text;
  v_conclusive boolean := false;
  v_inert      boolean := false;
  v_verdict    text;
begin
  -- ── (أ) الادّعاءات — تُقرأ للتصنيف فقط، ولا يخرج منها بايت واحد ──────────
  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j   := v_raw::jsonb;                                exception when others then v_j   := null; end;
  v_is_service := coalesce(v_j ->> 'role', '') = 'service_role';
  v_is_aal2    := coalesce(v_j ->> 'aal',  '') = 'aal2';
  v_raw := null;  -- لا يُحتفظ بالنصّ الخام لحظةً أطول من اللازم
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;

  -- ── (ب) ★ سؤال الرؤية — الافتراض الوحيد الذي يجعل البوّابة خاملة إلى الأبد ★
  --     يُنفَّذ **داخل** SECURITY DEFINER تمامًا كما تفعل البوّابة، فيقيس نفس
  --     الصلاحية بنفس الطريقة. النتيجة قيمة منطقية واحدة — لا صفوف ولا عدد.
  begin
    select exists (
      select 1 from auth.mfa_factors f
       where f.status = 'verified' and f.factor_type = 'totp'
    ) into v_any_factor;
    v_read_ok := true;
  exception when others then
    v_read_ok    := false;
    v_read_state := sqlstate;      -- '42501' = ممنوع · '42P01' = غير موجود
    v_any_factor := null;
  end;

  -- ── (ج) عامل المتصل نفسه — boolean، ولا شيء عنه غير ذلك ──────────────────
  if v_uid is not null and v_read_ok then
    begin
      select exists (
        select 1 from auth.mfa_factors f
         where f.user_id = v_uid and f.status = 'verified' and f.factor_type = 'totp'
      ) into v_self_has;
    exception when others then v_self_has := false;
    end;
  end if;

  -- ── (د) الوضع والدور — نفس قراءتَي البوّابة، بنفس عزل الاستثناء ───────────
  begin
    select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  exception when others then v_mode := null;
  end;

  if v_uid is not null then
    begin
      select account_type, staff_role into v_acct, v_staff
        from public.profiles where id = v_uid;
      v_role_ok := true;
    exception when others then
      v_role_ok := false;
    end;
    v_in_scope := v_role_ok
              and (coalesce(v_acct, '') = 'admin' or coalesce(v_staff, '') = 'super_admin');
  end if;

  -- ── (هـ) التصنيف — بنفس ترتيب فروع mfa_write_ok، لا بإعادة اختراعها ──────
  if v_is_service then                              v_reason := 'service_role_bypass';
  elsif coalesce(v_mode, 'off') <> 'enrollment' then v_reason := 'enforcement_mode_off';
  elsif v_uid is null then                           v_reason := 'not_authenticated';
  elsif not v_role_ok then                           v_reason := 'role_lookup_failed';
  elsif not v_in_scope then                          v_reason := 'role_out_of_scope';
  elsif not v_read_ok then                           v_reason := 'factor_read_failed';
  elsif not v_self_has then                          v_reason := 'no_verified_factor';
  elsif v_is_aal2 then                               v_reason := 'aal2_satisfied';
  else                                               v_reason := 'denied_aal1';
  end if;
  v_predicted := (v_reason <> 'denied_aal1');

  -- ── (و) القرار الحقيقي — من الدالّة الحيّة نفسها، لا من التصنيف أعلاه ────
  begin
    v_actual := public.mfa_write_ok();
  exception when others then
    v_actual   := null;
    v_gate_state := sqlstate;
  end;

  -- ── (ز) بنية البوّابة الحيّة + تطابق المالك (شرط أن يكون القياس ملزمًا) ──
  begin
    select p.prosecdef,
           pg_catalog.pg_get_functiondef(p.oid),
           r.rolname
      into v_secdef, v_def, v_owner_gate
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = to_regprocedure('public.mfa_write_ok()')::oid;
    v_reads := coalesce(v_def, '') ilike '%mfa_factors%';
  exception when others then
    v_secdef := false; v_reads := false; v_owner_gate := null;
  end;
  v_def := null;  -- لا يخرج نصّ التعريف من هنا

  begin
    select r.rolname into v_owner_self
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = to_regprocedure('public.mfa_gate_selftest()')::oid;
  exception when others then v_owner_self := null;
  end;

  -- المِسبار يقيس صلاحية **مالكه**. إن اختلف المالكان فالقياس دلالة لا برهان.
  v_conclusive := (v_owner_gate is not null and v_owner_gate = v_owner_self);

  -- ── (ح) الحكم ─────────────────────────────────────────────────────────────
  v_inert := (not v_read_ok) or (v_read_ok and coalesce(v_any_factor, false) = false);

  if v_actual is null then                              v_verdict := 'gate_unavailable';
  elsif not v_secdef or not v_reads then                v_verdict := 'gate_definition_drift';
  elsif not v_read_ok then                              v_verdict := 'gate_inert_cannot_read_factors';
  elsif not v_conclusive then                           v_verdict := 'probe_inconclusive_owner_mismatch';
  elsif coalesce(v_any_factor, false) = false then      v_verdict := 'gate_inert_no_factor_visible';
  elsif coalesce(v_mode, 'off') <> 'enrollment' then    v_verdict := 'gate_off_by_mode';
  else                                                  v_verdict := 'gate_can_deny';
  end if;

  -- ── (ط) الناتج — booleans ونصوص مغلقة فقط ────────────────────────────────
  return jsonb_build_object(
    -- حالة المتصل
    'authenticated',            (v_uid is not null),
    'is_aal2',                  v_is_aal2,
    'in_scope_role',            v_in_scope,
    'has_verified_factor',      v_self_has,        -- ★ boolean، لا بيانات عامل
    -- القرار
    'allowed',                  v_actual,          -- ★ من public.mfa_write_ok() نفسها
    'reason',                   v_reason,
    'predicted_allowed',        v_predicted,
    'prediction_matches',       (v_actual is not null and v_actual = v_predicted),
    'gate_call_sqlstate',       v_gate_state,
    -- ★ سؤال الرؤية — سبب وجود هذا الملفّ ★
    'definer_can_read_factors', v_read_ok,
    'definer_read_sqlstate',    v_read_state,
    'definer_sees_any_verified_factor',
        case when v_in_scope or v_is_service then v_any_factor else null end,
    'gate_structurally_inert',  v_inert,
    -- البنية
    'gate_is_security_definer', v_secdef,
    'gate_body_reads_factors',  v_reads,
    'gate_owner',               v_owner_gate,
    'probe_owner',              v_owner_self,
    'probe_is_conclusive',      v_conclusive,
    -- السياق
    'enforcement_mode',         coalesce(v_mode, '(تعذّرت القراءة)'),
    'verdict',                  v_verdict,
    'checked_at',               now()
  );

exception when others then
  -- المِسبار لا يُخفي فشله ولا يزعم نتيجة. لا يُعيد `true` ولا يبتلع.
  return jsonb_build_object('verdict', 'gate_unavailable',
                            'probe_error_sqlstate', sqlstate,
                            'checked_at', now());
end $fn$;

comment on function public.mfa_gate_selftest() is
  'تشخيص S4 غير مُتلِف: يستدعي public.mfa_write_ok() نفسها ويُبلّغ هل يستطيع مالكها قراءة auth.mfa_factors. لا يكتب شيئًا ولا يُعيد أيّ بيانات حسّاسة. احذفه بـ docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql بعد القبول.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · الصلاحيات — anon ممنوع صراحةً، authenticated وحدها
-- ─────────────────────────────────────────────────────────────────────────────
revoke all     on function public.mfa_gate_selftest() from public;
revoke all     on function public.mfa_gate_selftest() from anon;
grant  execute on function public.mfa_gate_selftest() to   authenticated;

do $g$
begin
  if has_function_privilege('anon', 'public.mfa_gate_selftest()', 'execute') then
    raise exception 'فشل: anon يملك EXECUTE على المِسبار — أُجهض التطبيق';
  end if;
  if not has_function_privilege('authenticated', 'public.mfa_gate_selftest()', 'execute') then
    raise exception 'فشل: authenticated لا يملك EXECUTE على المِسبار';
  end if;
  raise notice '✓ الصلاحيات: anon ممنوع · authenticated مسموح';
end $g$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- §3 · تقرير البنية — قراءة محضة، شغّله في نفس الجلسة واقرأ كل صفّ
--      (مالك mfa_write_ok · prosecdef · proconfig · صلاحيات auth.mfa_factors)
-- ════════════════════════════════════════════════════════════════════════════
-- ::oid صراحةً — فتُحسم كل مقارنة وكل استدعاء has_*_privilege على الحِمل الصحيح،
-- ويُعيد NULL بدل أن يرفع خطأً لو غاب الكائن.
with g as (select to_regprocedure('public.mfa_write_ok()')::oid as oid_gate),
     t as (select to_regclass('auth.mfa_factors')::oid          as oid_tab)
select * from (

  select 10 as ord, 'A. mfa_write_ok · المالك' as "المحور",
         coalesce((select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner, g
                    where p.oid = g.oid_gate), '(غير موجودة)') as "القيمة",
         '★ هذا الدور — لا المتصل — هو من يجب أن يقرأ auth.mfa_factors' as "التفاصيل"

  union all
  select 11, 'A. mfa_write_ok · prosecdef',
         coalesce((select p.prosecdef::text from pg_proc p, g where p.oid = g.oid_gate), '(غير موجودة)'),
         'يجب true — لو false فالدالّة تعمل بصلاحيات المتصل، وأحدٌ منهم لا يقرأ mfa_factors ⇒ خاملة'

  union all
  select 12, 'A. mfa_write_ok · proconfig',
         coalesce((select coalesce(array_to_string(p.proconfig, ' , '), '(بلا search_path مثبّت)')
                     from pg_proc p, g where p.oid = g.oid_gate), '(غير موجودة)'),
         'المتوقَّع: search_path=public, auth'

  union all
  select 13, 'A. mfa_write_ok · provolatile',
         coalesce((select p.provolatile::text from pg_proc p, g where p.oid = g.oid_gate), '(غير موجودة)'),
         's = stable (المتوقَّع)'

  union all
  select 14, 'A. mfa_write_ok · ACL',
         coalesce((select coalesce(array_to_string(p.proacl, ' , '), '(بلا ACL صريح ⇒ EXECUTE موروث لـ PUBLIC)')
                     from pg_proc p, g where p.oid = g.oid_gate), '(غير موجودة)'),
         'المتوقَّع من s4a: authenticated + service_role فقط'

  -- ★ الاختبار المباشر: هل يملك **المالك** SELECT على auth.mfa_factors؟ ★
  union all
  select 20, '★ B. مالك البوّابة يملك SELECT على auth.mfa_factors',
         coalesce((select has_table_privilege(
                            (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner, g
                              where p.oid = g.oid_gate),
                            (select t.oid_tab from t), 'select')::text), '(تعذّر التقييم)'),
         'false ⇒ البوّابة تفشل مفتوحةً في كل مرّة ⇒ لا تمنع أحدًا أبدًا (خاملة بنيويًّا)'

  union all
  select 21, 'B. مالك البوّابة يملك USAGE على مخطّط auth',
         coalesce((select has_schema_privilege(
                            (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner, g
                              where p.oid = g.oid_gate), 'auth', 'usage')::text), '(تعذّر التقييم)'),
         'الصلاحية على الجدول بلا USAGE على المخطّط = لا وصول'

  union all
  select 22, 'B. مالك البوّابة · rolbypassrls',
         coalesce((select r.rolbypassrls::text from pg_proc p join pg_roles r on r.oid = p.proowner, g
                    where p.oid = g.oid_gate), '(تعذّر التقييم)'),
         'لو فُعّلت RLS على auth.mfa_factors ولم يتجاوزها المالك ⇒ يقرأ صفرًا من الصفوف ⇒ خاملة أيضًا'

  union all
  select 23, 'B. auth.mfa_factors · RLS مفعّلة؟',
         coalesce((select c.relrowsecurity::text from pg_class c, t where c.oid = t.oid_tab), '(الجدول غير مرئي)'),
         'المتوقَّع false في Supabase — الحماية بالمنح لا بالسياسات'

  -- ★ القيد غير القابل للتفاوض: لا SELECT مباشر لـ anon/authenticated ★
  union all
  select 30, '★ C. anon · SELECT مباشر على auth.mfa_factors',
         coalesce(has_table_privilege('anon', (select t.oid_tab from t), 'select')::text, '(الجدول غير مرئي)'),
         '★ يجب false دائمًا — قيد غير قابل للتفاوض'

  union all
  select 31, '★ C. authenticated · SELECT مباشر على auth.mfa_factors',
         coalesce(has_table_privilege('authenticated', (select t.oid_tab from t), 'select')::text, '(الجدول غير مرئي)'),
         '★ يجب false دائمًا — قيد غير قابل للتفاوض'

  union all
  select 32, 'C. anon · USAGE على مخطّط auth',
         has_schema_privilege('anon', 'auth', 'usage')::text,
         'الوصول الفعليّ يحتاج USAGE + SELECT معًا'

  union all
  select 33, 'C. authenticated · USAGE على مخطّط auth',
         has_schema_privilege('authenticated', 'auth', 'usage')::text, ''

  union all
  select 34, '★ C. منح على مستوى الأعمدة (باب خلفي لا يظهر في فحص الجدول)',
         coalesce((select string_agg(distinct coalesce(r.rolname, 'PUBLIC') || '.' || a.attname, ' , ')
                     from pg_attribute a, t
                     cross join lateral aclexplode(a.attacl) x
                     left join pg_roles r on r.oid = x.grantee
                    where a.attrelid = t.oid_tab and a.attnum > 0 and a.attacl is not null
                      and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')),
                  '(لا منح أعمدة — سليم)'),
         'has_table_privilege لا يرى منح الأعمدة، ولذلك يُفحص هنا صراحةً'

  union all
  select 35, 'C. ACL الكامل لـ auth.mfa_factors',
         coalesce((select coalesce(array_to_string(c.relacl, ' , '), '(بلا ACL صريح)')
                     from pg_class c, t where c.oid = t.oid_tab), '(الجدول غير مرئي)'),
         'المتوقَّع: supabase_auth_admin (وربّما postgres) فقط'

  -- السياق التشغيلي
  union all
  select 40, 'D. enforcement_mode',
         coalesce((select enforcement_mode from public.mfa_settings where id = 1), '(لا صفّ id=1)'),
         'البوّابة لا تمنع إلّا عند enrollment'

  union all
  select 41, 'D. حسابات متميّزة تملك عاملًا مُفعَّلًا (القابلون للمنع)',
         (select count(*)::text from public.profiles p
           where (p.account_type = 'admin' or p.staff_role = 'super_admin')
             and exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp')),
         '0 ⇒ لا أحد يمكن منعه ⇒ عرض المنع غير ممكن أصلًا'

  union all
  select 42, 'D. المِسبار · ACL',
         coalesce((select coalesce(array_to_string(p.proacl, ' , '), '(بلا ACL — خطأ)')
                     from pg_proc p where p.oid = to_regprocedure('public.mfa_gate_selftest()')::oid), '(غير موجود)'),
         'المتوقَّع: authenticated=X فقط'

) s order by ord;

-- ════════════════════════════════════════════════════════════════════════════
-- §4 · نصّ القبول للمالك — خمس خطوات، لا سادسة
-- ════════════════════════════════════════════════════════════════════════════
--
--  0) في محرّر SQL (دور postgres): شغّل هذا الملفّ، واقرأ تقرير §3.
--     ★ إن كان الصفّ B «مالك البوّابة يملك SELECT» = false ⇒ **توقّف الآن**:
--       البوّابة خاملة بنيويًّا، وS4b سيربط قفلًا لا يُغلق. عالج المنح أوّلًا.
--
--  1) سجّل الدخول إلى البوّابة بحساب المالك **عند aal1** (دخول عادي، بلا خطوة
--     تحقّق)، وتأكّد أن لديك عامل TOTP مُفعَّلًا (صفحة الأمان تُظهره).
--
--  2) نفّذ من جلسة المتصفّح نفسها (لوحة الشبكة/الطرفية):
--        await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/mfa_gate_selftest`, {
--          method: 'POST',
--          headers: { apikey: SUPABASE_KEY,
--                     Authorization: `Bearer ${ACCESS_TOKEN}`,
--                     'Content-Type': 'application/json' },
--          body: '{}' })).json()
--     ★ المتوقَّع:
--          allowed                   = false
--          reason                    = "denied_aal1"
--          has_verified_factor       = true
--          definer_can_read_factors  = true
--          verdict                   = "gate_can_deny"
--     أيّ نتيجة أخرى = البوّابة **لا تمنع**. لا تُشغّل S4b.
--
--  3) ارفع الجلسة إلى aal2 (نافذة التحقّق بخطوتين المعتادة)، ثم كرّر نفس النداء.
--     ★ المتوقَّع:  allowed = true · reason = "aal2_satisfied" · is_aal2 = true
--
--  4) سجّل التاريخ الذي شاهدت فيه الخطوة (2) — ستحتاجه سطرًا واحدًا في الفحص
--     القبْليّ لـS4b:
--        set kian.s4_deny_demonstrated = 'deny-observed:YYYY-MM-DD';
--
--  5) شغّل docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql — يحذف المِسبار وحده.
--
-- ملاحظة: الخطوتان (2) و(3) **لا تكتبان شيئًا**؛ فشلهما لا يترك أثرًا، ونجاحهما
--         لا يغيّر صفًّا واحدًا. أعِدهما كما تشاء.
-- ════════════════════════════════════════════════════════════════════════════
