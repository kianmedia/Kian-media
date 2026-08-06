-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 4 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
--
-- ★★ 🔴 ثلاثة عيوب أُصلحت هنا — كلّها جعلت الفحص يكذب ★★
--
--  ١. **`to_regproc` لا يقبل توقيعًا.** كان الفحص يكتب
--     `to_regproc('public.crm_can_manage()')`، و`to_regproc` تأخذ **اسمًا
--     مجرّدًا** لا توقيعًا بأقواس، فتُعيد NULL دائمًا. ⇒ كانت البوّابات الثلاث
--     تُبلَّغ «مفقودة» **وهي موجودة**، فبدا الحجب في القاعدة وهو في الفحص.
--     الصحيح `to_regprocedure` — وهي المستعملة أصلًا في
--     `activity_log_role_hardening_RUNME.sql` و`SECURITY_POST_APPLY_VERIFICATION.sql`.
--
--  ٢. **خلطُ ما تُنشئه RUNME بما تشترطه.** `crm_opportunity_tender` و
--     `crm_testimonial_invites` تُنشئهما هذه الحزمة نفسها، فغيابهما قبل
--     التشغيل هو **الحالة الصحيحة** لا عطلًا. صارا `EXPECTED_ABSENT`.
--
--  ٣. **الفشل كان طباعةً فقط.** كان الملفّ يطبع 🔴 ويخرج بحالة 0، فيمرّ
--     التشغيل الآليّ فوق اعتماد مفقود. صار ينتهي بـ`raise exception` (§الحسم).
--
-- ⛔ لا كتابة · لا مِنَح · لا إنشاء. القراءة فقط.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §1 · اعتمادات خارجية **مطلوبة** — غيابها يمنع التشغيل ─────────────────
select 'REQUIRED_DEPENDENCY' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.src as created_by
from (values
  ('crm_opportunities',       'crm_sales_FOUNDATION_RUNME.sql'),
  ('crm_companies',           'crm_sales_FOUNDATION_RUNME.sql'),
  ('crm_activities',          'crm_sales_FOUNDATION_RUNME.sql'),
  ('project_shoot_sessions',  'baseline (operations/project core)'),
  ('project_closure_requests','baseline (phase 5C)'),
  ('fin_payment_milestones',  'baseline (finance)'),
  ('fin_collections',         'baseline (finance)')
) v(n, src);

-- ─── §2 · بوّابات CRM **مطلوبة** — تُستدعى بلا شرط داخل دوالّ الحزمة ───────
-- 🔴 `crm_can_manage()` تُستدعى ٧ مرّات، وكلّ استدعاء بلا حارس وجود: غيابها
--    يعني خطأ 42883 عند أوّل نداء، لا تدهورًا لطيفًا.
select 'REQUIRED_GATE' as kind, v.sig as name,
       case when to_regprocedure(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status,
       'crm_sales_FOUNDATION_RUNME.sql' as created_by
from (values ('public.crm_can_manage()'),
             ('public.crm_can_read_opportunity(uuid)'),
             ('public.crm_can_edit_opportunity(uuid)')) v(sig);

-- ─── §3 · بوّابة مالية **اختيارية** — والغياب يُخفي ولا يكشف ────────────────
-- ⚠️ الاسم `can_see_financials` — و**لا وجود** لدالّة اسمها `crm_see_financials`
--    في هذا المستودع إطلاقًا. أيّ تقرير يذكرها يذكر اسمًا لم يوجد قطّ.
select 'OPTIONAL_GATE' as kind, 'public.can_see_financials()' as name,
       case when to_regprocedure('public.can_see_financials()') is null
            then '🟡 غائبة — الهامش يبقى محجوبًا (fail-closed)'
            else '✅ موجودة' end as status,
       'staff_roles_task_assignment_RUNME.sql' as created_by;

-- ─── §4 · اختياريّ: الشهادات ───────────────────────────────────────────────
-- ⚠️ `kian_testimonials` **ليست** اعتمادًا مطلوبًا: ميزة الشهادات خلف علم مطفأ،
--    والحزمة تربط `testimonial_id` بها **شرطيًّا** (§7 في RUNME). فغيابها
--    يعني دعوات بلا ربط مرجعيّ، لا فشل تطبيق.
select 'OPTIONAL_DEPENDENCY' as kind, 'kian_testimonials' as name,
       case when to_regclass('public.kian_testimonials') is null
            then '🟡 غائب — قيد المفتاح الأجنبيّ يُتخطّى، والميزة تبقى خلف علمها'
            else '✅ موجود — يُضاف قيد المفتاح الأجنبيّ' end as status,
       'kian_testimonials_v1_RUNME.sql (RUNME OPTIONAL)' as created_by;

-- ─── §5 · ما تُنشئه هذه الحزمة — غيابه **متوقَّع** ─────────────────────────
select 'EXPECTED_ABSENT' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null
            then '✅ غائب كما هو متوقَّع (ستُنشئه RUNME)'
            else '🟡 موجود — إعادة تشغيل (الحزمة idempotent)' end as status,
       'wave4_crm_business_RUNME.sql' as created_by
from (values ('crm_opportunity_tender'),('crm_testimonial_invites')) v(n);

-- ─── §5-ب · 🔴 أعمدة الإسناد التي تعتمد عليها `crm_client_health_v` ────────
-- سقطت الحزمة كلّها على Preview لأنّ الـview افترضت `crm_activities.company_id`
-- وهو **غير موجود**. الإسناد الحقيقيّ عبر lead/opportunity/contact ثمّ
-- `company_id` على كلٍّ منها. هذه الأعمدة تُفحص بالاسم قبل التشغيل.
select 'REQUIRED_COLUMN' as kind, v.t || '.' || v.c as name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public'
                            and table_name::text = v.t
                            and column_name::text = v.c)
            then '✅ موجود' else '🔴 مفقود' end as status,
       'crm_sales_FOUNDATION_RUNME.sql' as created_by
from (values
  ('crm_activities','lead_id'), ('crm_activities','opportunity_id'),
  ('crm_activities','contact_id'), ('crm_activities','occurred_at'),
  ('crm_opportunities','company_id'), ('crm_leads','company_id'),
  ('crm_contacts','company_id')
) v(t, c);

-- ⚠️ ولا يُفترض وجود `crm_activities.company_id`: وجودُه لا يضرّ، لكنّ الـview
--    **لا تستعمله** — الإسناد يمرّ بالآباء دائمًا.
select 'MUST_NOT_BE_ASSUMED' as kind, 'crm_activities.company_id' as name,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name::text='crm_activities'
                            and column_name::text='company_id')
            then '🟡 موجود — والـview لا تستعمله (الإسناد عبر الآباء)'
            else '✅ غير موجود كما هو متوقَّع' end as status,
       '—' as created_by;

-- ─── §5-ج · علاقات المفاتيح الأجنبية أو مسار مكافئ معتمَد ──────────────────
-- ⚠️ يُقبل بديلان: قيد FK حقيقيّ، أو عمود موجود بنوع uuid يشير إلى نفس الجدول
--    منطقيًّا. الـview لا تشترط القيد — تشترط **العمود**. والقيد يُبلَّغ إعلاميًّا.
select 'FK_RELATION' as kind,
       v.child || '.' || v.col || ' → ' || v.parent as name,
       case when exists (
              select 1
              from information_schema.table_constraints tc
              join information_schema.key_column_usage kcu
                on kcu.constraint_name = tc.constraint_name
               and kcu.constraint_schema = tc.constraint_schema
              join information_schema.constraint_column_usage ccu
                on ccu.constraint_name = tc.constraint_name
               and ccu.constraint_schema = tc.constraint_schema
              where tc.constraint_type = 'FOREIGN KEY'
                and tc.table_schema = 'public'
                and tc.table_name::text = v.child
                and kcu.column_name::text = v.col
                and ccu.table_name::text = v.parent)
            then '✅ قيد FK موجود'
            when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name::text=v.child
                            and column_name::text=v.col)
            then '🟡 العمود موجود بلا قيد FK — الـview تعمل، والسلامة المرجعية أضعف'
            else '🔴 لا عمود ولا قيد' end as status,
       'crm_sales_FOUNDATION_RUNME.sql' as created_by
from (values
  ('crm_activities','lead_id','crm_leads'),
  ('crm_activities','opportunity_id','crm_opportunities'),
  ('crm_activities','contact_id','crm_contacts'),
  ('crm_opportunities','company_id','crm_companies'),
  ('crm_leads','company_id','crm_companies'),
  ('crm_contacts','company_id','crm_companies')
) v(child, col, parent);

-- ─── §6 · امتداد مطلوب ─────────────────────────────────────────────────────
select 'REQUIRED_EXTENSION' as kind, 'pgcrypto' as name,
       case when count(*)=0 then '🔴 مفقود — إصدار الدعوات سيفشل' else '✅ موجود' end as status,
       'extension' as created_by
from pg_extension where extname='pgcrypto';

-- ─── §7 · ⛔ لا نظام موازٍ ──────────────────────────────────────────────────
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود'
            else '🔴 نظام موازٍ — توقّف' end as status,
       '—' as created_by
from (values ('tenders'),('client_health'),('follow_ups'),('rate_card_items')) v(n);

-- ─── §8 · خطّ أساس صلاحيات anon ────────────────────────────────────────────
select 'ANON_GRANTS' as kind, routine_name::text as name,
       privilege_type::text as status, '—' as created_by
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text='anon' and routine_name like 'crm_%';

-- ════════════════════════════════════════════════════════════════════════════
-- §9 · 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- طباعة 🔴 مع خروج بحالة 0 تجعل أيّ تشغيل آليّ يمضي فوق اعتماد مفقود. هذا
-- البلوك **يرمي استثناءً**، فيخرج `psql` بحالة غير صفرية ويتوقّف الخطّ.
-- ⛔ ولا يُحتسب `kian_testimonials` ولا `can_see_financials` هنا: كلاهما
--    اختياريّ، وإدراجه كان سيحجب Wave 4 بلا سبب.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text[] := '{}';
  v_t text;
  v_sig text;
begin
  foreach v_t in array array['crm_opportunities','crm_companies','crm_activities',
                             'project_shoot_sessions','project_closure_requests',
                             'fin_payment_milestones','fin_collections']
  loop
    if to_regclass('public.'||v_t) is null then
      v_missing := v_missing || ('TABLE ' || v_t);
    end if;
  end loop;

  foreach v_sig in array array['public.crm_can_manage()',
                               'public.crm_can_read_opportunity(uuid)',
                               'public.crm_can_edit_opportunity(uuid)']
  loop
    if to_regprocedure(v_sig) is null then
      v_missing := v_missing || ('GATE ' || v_sig);
    end if;
  end loop;

  -- 🔴 أعمدة الإسناد: غيابها يُفشل `crm_client_health_v` ⇒ تراجع الحزمة كلّها.
  declare
    v_pair text;
  begin
    foreach v_pair in array array['crm_activities.lead_id','crm_activities.opportunity_id',
                                  'crm_activities.contact_id','crm_activities.occurred_at',
                                  'crm_opportunities.company_id','crm_leads.company_id',
                                  'crm_contacts.company_id']
    loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name::text  = split_part(v_pair, '.', 1)
           and column_name::text = split_part(v_pair, '.', 2)
      ) then
        v_missing := v_missing || ('COLUMN ' || v_pair);
      end if;
    end loop;
  end;

  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    v_missing := v_missing || 'EXTENSION pgcrypto';
  end if;

  -- ⛔ ونظام موازٍ يوقف التشغيل أيضًا.
  foreach v_t in array array['tenders','client_health','follow_ups','rate_card_items']
  loop
    if to_regclass('public.'||v_t) is not null then
      v_missing := v_missing || ('PARALLEL ' || v_t);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception E'🔴 WAVE 4 PREFLIGHT FAILED — اعتمادات مفقودة:\n  %\n'
      '⛔ لا تُشغّل wave4_crm_business_RUNME.sql. '
      'شغّل crm_sales_FOUNDATION_RUNME.sql أوّلًا إن كانت البوّابات مفقودة.',
      array_to_string(v_missing, E'\n  ');
  end if;

  raise notice '✅ WAVE 4 PREFLIGHT PASSED — كل الاعتمادات المطلوبة موجودة.';
end $$;
