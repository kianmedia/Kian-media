-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 5 · تدقيق حالة Phase A/B المالية — **قراءة فقط**.
--
-- MANUAL PRODUCTION VERIFICATION REQUIRED
--
-- ⛔⛔ هذا الملفّ لم يُشغَّل، ولا يجوز أن يُشغَّل من هنا. هو أداة يشغّلها إنسان
--     على Production ويقرأ مخرجاتها. ⛔ لا INSERT · لا UPDATE · لا DELETE ·
--     لا ALTER · لا CREATE · لا DROP. SELECT وفحص كتالوج فقط.
--
-- ★ لماذا يوجد أصلًا ★
-- «هل Phase B المالية مطبَّقة على Production؟» هو سؤال GATE A رقم ٦ في
-- MASTER_BRIEF_v2.1.md، ولم يُجَب. ووجود ملفّ `RUNME` في المستودع **ليس** دليل
-- تطبيق: خمسة ملفّات فقط من ٢٩٢ تحمل دليلًا مؤرَّخًا
-- (`docs/DATABASE_APPLICATION_STATUS.md`).
--
-- ★ ولماذا يفحص التعريفات لا الأسماء ★
-- دالّة موجودة بالاسم قد تكون نسخة قديمة سبقت الإحكام. فوجود الاسم يعطي
-- APPLIED كاذبًا. لذلك §3 يقرأ `prosrc` ويبحث عن **علامات الإحكام** نفسها.
--
-- ★ والحالة UNKNOWN حالة مشروعة ★
-- لا يُصنَّف مكوِّن APPLIED إلّا بدليل موجب. غياب الدليل ⇒ ABSENT أو UNKNOWN،
-- ولا يُقرأ أبدًا كنجاح.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0 · بطاقة تعريف التشغيل ──────────────────────────────────────────────
select
  'AUDIT_RUN'                       as section,
  current_database()                as database,
  current_user                      as run_as,
  now()                             as run_at,
  'READ-ONLY · no DDL · no DML'     as guarantee;

-- ─── §1 · الجداول المتوقَّعة ────────────────────────────────────────────────
select
  'TABLE' as section, v.n as component,
  case when to_regclass('public.'||v.n) is null then 'ABSENT' else 'APPLIED' end as status,
  coalesce((select count(*)::text from information_schema.columns c
             where c.table_schema='public' and c.table_name=v.n), '0') as column_count
from (values
  ('fin_payment_milestones'), ('fin_collections'), ('fin_receivables'),
  ('fin_revenue'), ('fin_costs'), ('project_expenses')
) v(n)
order by 2;

-- ─── §2 · الأعمدة الحسّاسة — وجودها ونوعها ─────────────────────────────────
-- عمود موجود بنوع مختلف = DRIFTED، وهو أخطر من الغياب لأنّه يمرّ صامتًا.
select
  'COLUMN' as section,
  v.t||'.'||v.c as component,
  case
    when c.column_name is null then 'ABSENT'
    when c.data_type <> v.expected_type then 'DRIFTED'
    else 'APPLIED'
  end as status,
  coalesce(c.data_type, '—')||' (expected '||v.expected_type||')' as detail
from (values
  ('fin_payment_milestones','amount','numeric'),
  ('fin_payment_milestones','project_id','uuid'),
  ('fin_collections','amount','numeric'),
  ('fin_collections','milestone_id','uuid'),
  ('fin_receivables','amount','numeric')
) v(t,c,expected_type)
left join information_schema.columns c
  on c.table_schema='public' and c.table_name=v.t and c.column_name=v.c
order by 2;

-- ─── §3 · 🔴 الدوالّ — بالتعريف لا بالاسم ──────────────────────────────────
-- علامات الإحكام المبحوث عنها:
--   • search_path مثبَّت  • security definer  • بوّابة صلاحية داخل الجسم
select
  'FUNCTION' as section,
  p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as component,
  case
    when p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%'
         and p.prosrc ~* '(can_see_financials|not authorized|42501)' then 'APPLIED'
    when p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%' then 'PARTIAL'
    when p.prosecdef then 'DRIFTED'          -- definer بلا search_path مثبَّت
    else 'PARTIAL'
  end as status,
  concat(
    case when p.prosecdef then 'SECURITY DEFINER' else 'INVOKER' end,
    case when array_to_string(p.proconfig,',') like '%search_path%' then ' · search_path pinned' else ' · ⚠️ NO search_path' end,
    case when p.prosrc ~* 'can_see_financials' then ' · financial gate' else ' · ⚠️ no financial gate' end
  ) as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('pc_project_financials','can_see_financials',
                    'fin_receivables_summary','fin_collection_record')
order by 2;

-- الدوالّ المتوقَّعة والغائبة تمامًا — تظهر هنا لأنّ الاستعلام أعلاه لا يُظهر ما لا يوجد.
select 'FUNCTION_MISSING' as section, v.n as component, 'ABSENT' as status, '—' as detail
from (values ('pc_project_financials'),('can_see_financials')) v(n)
where to_regproc('public.'||v.n) is null;

-- ─── §4 · العروض والمُشغِّلات ───────────────────────────────────────────────
select 'VIEW' as section, viewname as component, 'APPLIED' as status,
       left(definition, 120) as detail
from pg_views where schemaname='public' and viewname like 'fin_%' or viewname like 'pc_fin%'
order by 2;

select 'TRIGGER' as section, t.tgname as component, 'APPLIED' as status,
       c.relname as detail
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and not t.tgisinternal and c.relname like 'fin_%'
order by 2;

-- ─── §5 · RLS والسياسات ────────────────────────────────────────────────────
select
  'RLS' as section, c.relname as component,
  case when c.relrowsecurity then 'APPLIED' else 'ABSENT' end as status,
  (select count(*)::text from pg_policies p
    where p.schemaname='public' and p.tablename=c.relname)||' policies' as detail
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'fin_%'
order by 2;

select 'POLICY' as section, tablename||' · '||policyname as component,
       'APPLIED' as status, cmd||' → '||coalesce(left(qual,90),'—') as detail
from pg_policies where schemaname='public' and tablename like 'fin_%'
order by 2;

-- ─── §6 · 🔴 الصلاحيات — أخطر ما يُفحص ─────────────────────────────────────
-- أيّ صفّ هنا لـanon أو PUBLIC على جدول ماليّ = تسريب قائم، لا ملاحظة.
select
  'GRANT_TABLE' as section, table_name||' → '||grantee as component,
  case when grantee in ('anon','PUBLIC') then '🔴 LEAK' else 'APPLIED' end as status,
  privilege_type as detail
from information_schema.role_table_grants
where table_schema='public' and table_name like 'fin_%'
order by 1, 2;

select
  'GRANT_FUNCTION' as section, routine_name||' → '||grantee as component,
  case when grantee in ('anon','PUBLIC') then '🔴 LEAK' else 'APPLIED' end as status,
  privilege_type as detail
from information_schema.role_routine_grants
where routine_schema='public'
  and (routine_name like 'fin_%' or routine_name in ('pc_project_financials','can_see_financials'))
order by 1, 2;

-- ─── §7 · الفهارس الحرجة ───────────────────────────────────────────────────
select 'INDEX' as section, indexname as component, 'APPLIED' as status, tablename as detail
from pg_indexes where schemaname='public' and tablename like 'fin_%'
order by 2;

-- ─── §8 · دليل التطبيق المؤرَّخ إن وُجد نظام له ─────────────────────────────
-- لا يُفترض وجوده: هذا المشروع يستعمل عُرف docs/*_RUNME.sql لا supabase/migrations.
select
  'MIGRATION_MARKER' as section,
  case when to_regclass('supabase_migrations.schema_migrations') is null
       then 'no migration ledger on this database'
       else 'ledger present — inspect it separately' end as component,
  'UNKNOWN' as status, '—' as detail;

-- ─── §9 · 🔴 تركيب جزئيّ بين A وB ──────────────────────────────────────────
-- Phase A تُنشئ محرّك القراءة، وPhase B تُحكمه. وجود A بلا B = **PARTIAL**،
-- وهو أخطر حالة: الأرقام تُقرأ بلا الإحكام الذي يفترضه من يقرؤها.
select
  'PHASE_COMPOSITION' as section,
  'Phase A engine vs Phase B lockdown' as component,
  case
    when to_regproc('public.pc_project_financials()') is null then 'ABSENT (neither)'
    when to_regproc('public.can_see_financials()') is null then '🔴 PARTIAL (A without B)'
    when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname like 'fin_%'
                    and c.relkind='r' and not c.relrowsecurity)
      then '🔴 PARTIAL (B incomplete — a fin_ table without RLS)'
    else 'APPLIED (both present)'
  end as status,
  'A without B means figures are readable without the lockdown that readers assume' as detail;

-- ─── §10 · مصدر حقيقة ماليّ موازٍ ──────────────────────────────────────────
-- أيّ جدول يحمل مبلغًا خارج نطاق fin_* هو مرشَّح لمصدر ثانٍ يتباعد.
select
  'PARALLEL_SOURCE' as section, c.relname as component,
  '⚠️ REVIEW' as status,
  string_agg(a.attname, ', ' order by a.attname) as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname='public' and c.relkind='r'
  and c.relname not like 'fin_%'
  and a.attname in ('amount','total_amount','paid_amount','invoice_total','cost','margin','profit')
group by c.relname
order by 2;

-- ─── §11 · استنتاج ربح من بيانات ناقصة ─────────────────────────────────────
-- دالّة تحسب هامشًا/ربحًا دون بوّابة مالية = استنتاج يُقرأ كحقيقة.
select
  'PROFIT_INFERENCE' as section, p.proname as component,
  case when p.prosrc ~* 'can_see_financials' then 'APPLIED' else '🔴 UNGATED' end as status,
  'computes margin/profit' as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.prosrc ~* '(margin|profit)'
  and p.prosrc ~* '(sum\(|/)'
order by 2;

-- ─── §12 · الخلاصة التي تُقرأ ──────────────────────────────────────────────
select
  'VERDICT' as section,
  'how to read this audit' as component,
  'UNKNOWN' as status,
  'APPLIED requires positive evidence. ABSENT/UNKNOWN is never a pass. '
  'Any 🔴 row blocks every Wave 5 financial item (V2-5.5-B/D/E/F).' as detail;
