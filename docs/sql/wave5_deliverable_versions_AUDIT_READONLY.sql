-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 5 · تدقيق جدولَي الإصدارات — **قراءة فقط**.
--
-- MANUAL PRODUCTION VERIFICATION REQUIRED · W5-1
--
-- ⛔⛔ لا يُشغَّل من هنا، ولا ينقل بيانات. SELECT فقط.
--     لا INSERT · لا UPDATE · لا DELETE · لا ALTER · لا CREATE · لا DROP.
--
-- ★ الغرض ★
-- D-4 محسوم: `deliverable_versions` هو المصدر. لكنّ **مصير صفوف**
-- `project_deliverable_versions` لا يُقرَّر بلا عدّ. وهذه الأداة تُنتج ذلك العدّ
-- ومعه ما هو أهمّ منه: **التعارضات**.
--
-- ★★ ما يجعل هذا التدقيق ضروريًّا لا احتياطيًّا ★★
-- كلا الجدولين يحمل `is_final`، ولكلٍّ **كاتبه الحيّ المستقلّ**:
--   • `deliverable_versions`        ← admin_set_final_version / _final_master
--   • `project_deliverable_versions`← project_core_ABSOLUTE_FINAL / project_editor_permissions
-- فقد يوجد **إصداران نهائيّان مختلفان للمخرَج الواحد**، ولا شيء يمنع ذلك اليوم.
-- §4 يعدّها بالاسم.
--
-- ⚠️ والحذف النهائيّ في الجدول القديم يعني أنّ فجواته **غير قابلة للاسترجاع**
--    (§6): لا `is_deleted` فيه، فالصفّ المحذوف ذهب بلا أثر.
-- ════════════════════════════════════════════════════════════════════════════

select 'AUDIT_RUN' as section, current_database() as database, now() as run_at,
       'READ-ONLY · no data movement' as guarantee;

-- ─── §1 · وجود الجدولين ────────────────────────────────────────────────────
select 'TABLE' as section, v.n as component,
       case when to_regclass('public.'||v.n) is null then 'ABSENT' else 'PRESENT' end as status
from (values ('deliverable_versions'),('project_deliverable_versions')) v(n);

-- ─── §2 · عدّ الصفوف — مدخل قرار W5-1 ──────────────────────────────────────
-- 🔴 لا يُكتب رقم هنا في أيّ تقرير قبل تشغيل هذا الاستعلام فعليًّا.
select 'ROW_COUNT' as section, 'deliverable_versions (canonical, live)' as component,
       count(*)::text as value
from public.deliverable_versions where coalesce(is_deleted,false) = false;

select 'ROW_COUNT' as section, 'deliverable_versions (soft-deleted)' as component,
       count(*)::text as value
from public.deliverable_versions where coalesce(is_deleted,false) = true;

select 'ROW_COUNT' as section, 'project_deliverable_versions (legacy)' as component,
       count(*)::text as value
from public.project_deliverable_versions;

-- ─── §3 · التداخل والانفراد ────────────────────────────────────────────────
-- المفتاح المشترك: (deliverable_id, رقم الإصدار). الأسماء تختلف بين الجدولين.
select 'OVERLAP' as section, 'in BOTH (same deliverable + version no)' as component,
       count(*)::text as value
from public.deliverable_versions dv
join public.project_deliverable_versions pdv
  on pdv.deliverable_id = dv.deliverable_id and pdv.version = dv.version_no;

select 'LEGACY_ONLY' as section, 'rows that exist ONLY in the legacy table' as component,
       count(*)::text as value
from public.project_deliverable_versions pdv
where not exists (
  select 1 from public.deliverable_versions dv
   where dv.deliverable_id = pdv.deliverable_id and dv.version_no = pdv.version);

select 'CANONICAL_ONLY' as section, 'rows that exist ONLY in the canonical table' as component,
       count(*)::text as value
from public.deliverable_versions dv
where coalesce(dv.is_deleted,false) = false
  and not exists (
  select 1 from public.project_deliverable_versions pdv
   where pdv.deliverable_id = dv.deliverable_id and pdv.version = dv.version_no);

-- ─── §4 · 🔴 التعارض النهائيّ — أخطر ما يكشفه هذا التدقيق ──────────────────
-- مخرَج له إصدار نهائيّ في كلّ جدول، والرقمان مختلفان.
select
  'CONFLICTING_FINAL' as section,
  dv.deliverable_id::text as component,
  'canonical v'||dv.version_no::text||' vs legacy v'||pdv.version::text as value
from public.deliverable_versions dv
join public.project_deliverable_versions pdv on pdv.deliverable_id = dv.deliverable_id
where dv.is_final = true
  and coalesce(dv.is_deleted,false) = false
  and coalesce(pdv.is_final,false) = true
  and pdv.version <> dv.version_no
order by 2;

-- وأكثر من نهائيّ داخل الجدول المعتمد نفسه (يجب أن يكون صفرًا).
select 'MULTIPLE_FINAL_CANONICAL' as section, deliverable_id::text as component,
       count(*)::text as value
from public.deliverable_versions
where is_final = true and coalesce(is_deleted,false) = false
group by deliverable_id having count(*) > 1
order by 2;

-- وأكثر من نهائيّ في الجدول القديم.
select 'MULTIPLE_FINAL_LEGACY' as section, deliverable_id::text as component,
       count(*)::text as value
from public.project_deliverable_versions
where coalesce(is_final,false) = true
group by deliverable_id having count(*) > 1
order by 2;

-- ─── §5 · حالات مفقودة في الصفوف المنفردة ──────────────────────────────────
-- الجدول القديم لا يملك `watermark_required` إطلاقًا. فكلّ صفّ منفرد فيه هو
-- إصدار **بلا حالة علامة مائية معروفة** — لا يُفترض له افتراض.
select 'MISSING_WATERMARK_STATE' as section,
       'legacy-only rows have NO watermark column at all' as component,
       count(*)::text as value
from public.project_deliverable_versions pdv
where not exists (
  select 1 from public.deliverable_versions dv
   where dv.deliverable_id = pdv.deliverable_id and dv.version_no = pdv.version);

-- ولا يملك سبب الرفض: صفّ غير معتمَد فيه لا يُعرف **لماذا**.
select 'MISSING_DECISION_STATE' as section,
       'legacy rows not approved, with no revision reason recorded' as component,
       count(*)::text as value
from public.project_deliverable_versions
where coalesce(is_approved,false) = false;

-- ─── §6 · فجوات لا يمكن استرجاعها ──────────────────────────────────────────
-- الجدول القديم يُحذف منه نهائيًّا (لا is_deleted). فأيّ انقطاع في تسلسل
-- الأرقام لمخرَج ما هو صفّ ذهب بلا أثر — ولا سبيل لمعرفة ماذا كان.
select
  'IRRECOVERABLE_GAP' as section,
  pdv.deliverable_id::text as component,
  'max v'||max(pdv.version)::text||' but only '||count(*)::text||' rows present' as value
from public.project_deliverable_versions pdv
group by pdv.deliverable_id
having max(pdv.version) <> count(*)
order by 2;

-- ─── §7 · أهليّة الترحيل ───────────────────────────────────────────────────
-- 🔴 التصنيف قرار قراءة، لا أمر تنفيذ. لا يُنقل صفّ بناءً على هذا الملفّ.
select
  'MIGRATION_ELIGIBILITY' as section,
  pdv.deliverable_id::text as component,
  case
    when exists (select 1 from public.deliverable_versions dv
                  where dv.deliverable_id = pdv.deliverable_id
                    and dv.version_no = pdv.version)
      then 'ALREADY IN CANONICAL — no action'
    when coalesce(pdv.is_final,false) = true
      then '🔴 MANUAL ONLY — legacy-only FINAL version; may have been delivered to a client'
    when coalesce(pdv.is_approved,false) = true
      then '🔴 MANUAL ONLY — legacy-only APPROVED version; approval history would be lost'
    when pdv.preview_url is null and pdv.file_path is null
      then 'AUTOMATIC CANDIDATE — metadata only, no artefact'
    else '⚠️ MANUAL REVIEW — carries an artefact with no canonical counterpart'
  end as value
from public.project_deliverable_versions pdv
order by 3, 2;

-- ─── §8 · الخلاصة ──────────────────────────────────────────────────────────
select 'VERDICT' as section, 'how to read this audit' as component,
       'Zero rows in LEGACY_ONLY and CONFLICTING_FINAL ⇒ the duplication is on paper '
       'and freezing suffices. Any row in CONFLICTING_FINAL is a live defect: two '
       'different final versions for one deliverable. ⛔ Nothing here authorises a '
       'migration — that needs its own package and Khaled''s decision (W5-1).' as value;
