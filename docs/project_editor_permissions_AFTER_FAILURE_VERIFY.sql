-- ════════════════════════════════════════════════════════════════════════════
-- إثبات حالة الإنتاج بعد فشل project_editor_permissions_RUNME
-- **قراءة فقط بالكامل** — لا create/alter/insert/update/delete/grant/revoke.
-- شغّله **أوّلًا**، قبل أيّ شيء آخر. آمن للتكرار.
--
-- ★ المتوقَّع ★ ملفّ RUNME معاملة واحدة (begin واحد، commit واحد، بلا
--   CONCURRENTLY وبلا VACUUM)، والفشل وقع في الفحص الذاتيّ قبل COMMIT
--   ⇒ PostgreSQL تراجع عن **كل شيء**. لذلك كل قسم أدناه يجب أن يقول «لم يُطبَّق».
--   أيّ «⚠️ مطبَّق» يعني حالة جزئية — **قف وأبلغني ولا تُعِد التشغيل**.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 1 · المُسنِدات الستّة الجديدة — يجب ألّا توجد ═══════════════════════════
select '1 · مُسنِدات جديدة' as check, count(*) as found_expect_0,
       coalesce(string_agg(p.proname, ', '), '(لا شيء)') as names,
       case when count(*) = 0 then '✅ لم تُنشأ — التراجع تمّ'
            else '⚠️ مطبَّقة — حالة جزئية! قف' end as verdict
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_move_deliverable','can_send_to_client_review',
                     'can_finalize_deliverable','can_move_project_stage',
                     'can_request_project_transition','can_approve_project_transition');

-- ═══ 2 · هل الحزمة ما زالت النسخة القديمة؟ ══════════════════════════════════
-- القديمة: بلا أيّ حارس قدرة.  الجديدة: تستدعي can_move_deliverable وأخواتها.
select '2 · نسخة bulk_update' as check,
       case when to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') is null
              then 'الدالّة غير موجودة — راجع معي'
            when pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'))
                 ilike '%can_move_deliverable%'
              then '⚠️ النسخة الجديدة مطبَّقة — حالة جزئية! قف'
            else '✅ النسخة القديمة — التراجع تمّ (والثغرة ما زالت مفتوحة)' end as verdict;

-- ═══ 3 · هل project_units_can_write ما زالت تمرّر is_kian_member؟ ═══════════
-- ★ هذا هو جوهر الثغرة. وجودها يعني أن المونتير ما زال يمرّ. ★
select '3 · جذر الثغرة' as check,
       pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)'))
         ilike '%is_kian_member%' as kian_member_leg_expect_TRUE,
       'TRUE هنا = الثغرة ما زالت مفتوحة على الإنتاج (متوقَّع قبل التطبيق)' as note;

-- ═══ 4 · هل ثغرة المونتير ما زالت مفتوحة فعليًّا؟ ═══════════════════════════
select '4 · حالة الثغرة' as check,
       case when pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'))
                 ilike '%can_move_deliverable%'
            then 'مُغلقة'
            else '🔴 مفتوحة — أيّ kian_editor مُسنَد يغيّر stage_id/status/client_visible' end as verdict;

-- ═══ 5 · جدول ودوالّ طلبات الانتقال — لم تُشغَّل حزمتها بعد ════════════════
select '5 · Transition Approval' as check,
       (to_regclass('public.project_transition_requests') is not null) as table_expect_false,
       (to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)') is not null) as create_fn_expect_false,
       (to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)') is not null) as decide_fn_expect_false,
       'كلّها false — لم تُشغَّل الحزمة الثانية' as note;

-- ═══ 6 · سياسات جديدة على جدول الطلبات — يجب ألّا توجد ═════════════════════
select '6 · سياسات جديدة' as check, count(*) as found_expect_0
  from pg_policies where schemaname = 'public' and tablename = 'project_transition_requests';

-- ═══ 7 · منح جديدة على المُسنِدات الستّة — يجب ألّا توجد ═══════════════════
select '7 · منح جديدة' as check, count(*) as found_expect_0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_move_deliverable','can_send_to_client_review',
                     'can_finalize_deliverable','can_move_project_stage',
                     'can_request_project_transition','can_approve_project_transition')
   and (has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute'));

-- ═══ 8 · الدوالّ الأخرى التي كان §4 سيضيّقها — ما زالت كما كانت ════════════
select '8 · دوالّ §4' as check, p.proname,
       pg_get_functiondef(p.oid) ilike '%can_send_to_client_review%' as narrowed_expect_false
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('project_core_set_stage','pc_deliverable_review',
                     'staff_set_deliverable','staff_add_deliverable')
 order by p.proname;

-- ═══ 9 · العمل الأمنيّ السابق سليم (Fix A / Fix B / Fix C) ═════════════════
select '9 · Fix A/B/C' as check,
       pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
         ilike '%role_change_denied%' as fixA_expect_true,
       pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
         ilike '%can_manage_identity%' as fixB_expect_true,
       (public.can_manage_hr() is not null) as fixC_no_null_expect_true;

-- ═══ 10 · منصّة المشاريع والاستيراد سليمة ══════════════════════════════════
select '10 · المنصّة' as check,
       (to_regclass('public.deliverable_internal') is not null)  as large_projects_expect_true,
       (to_regclass('public.import_batches') is not null)        as bulk_import_expect_true,
       (select count(*) from public.deliverable_content_types)   as content_types_expect_13;

-- ════════════════════════════════════════════════════════════════════════════
-- الخلاصة المتوقَّعة: 1=0 · 2=«النسخة القديمة» · 3=TRUE · 4=«مفتوحة» ·
-- 5 كلّها false · 6=0 · 7=0 · 8 كلّها false · 9 كلّها true · 10 true/true/13.
-- عندها الإنتاج **كما كان قبل التشغيل الفاشل تمامًا**، والثغرة ما زالت مفتوحة
-- إلى أن تُطبَّق النسخة المصحَّحة. أرسل لي أيّ صفّ يخالف ذلك قبل أن تُكمل.
-- ════════════════════════════════════════════════════════════════════════════
