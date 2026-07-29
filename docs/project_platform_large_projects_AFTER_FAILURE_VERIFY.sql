-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — إثبات حالة الإنتاج بعد فشل RUNME · **قراءة فقط بالكامل**
-- ════════════════════════════════════════════════════════════════════════════
--
-- شغّل هذا **أوّلًا** قبل أيّ شيء آخر.
--
-- لا يوجد في هذا الملفّ أيّ INSERT / UPDATE / DELETE / DROP / ALTER / CREATE /
-- GRANT / REVOKE. لا يغيّر شيئًا. آمن للتشغيل أكثر من مرّة.
--
-- ★ ما نتوقّعه ولماذا ★
--   ملفّ RUNME كلّه معاملة واحدة: `begin;` في السطر 74 و`commit;` في السطر 1556،
--   ولا يحوي `CREATE INDEX CONCURRENTLY` ولا أيّ أمر غير معامليّ. والفشل وقع في
--   الفحص الذاتيّ **قبل** `commit;` ⇒ PostgreSQL تراجع عن **كل شيء** تلقائيًّا.
--   ⇒ المتوقّع أن **كل** فحص أدناه يقول `لم يُنشأ` — أي أن قاعدة البيانات كما
--     كانت تمامًا قبل التشغيل.
--
--   لو ظهر أيّ `⚠️ موجود` فهذا يعني تغييرًا جزئيًّا لم يُتراجَع عنه — **قف
--   وأبلغني فورًا ولا تشغّل RUNME مرّة أخرى.**
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ §1 · الجدول الجانبيّ — يجب ألّا يكون موجودًا ═══════════════════════════
select '1 · deliverable_internal' as check,
       case when to_regclass('public.deliverable_internal') is null
            then '✅ لم يُنشأ — التراجع تمّ'
            else '⚠️ موجود — تغيير جزئيّ! قف وأبلغ' end as result;


-- ═══ §2 · جدول أنواع المحتوى المرجعيّ — يجب ألّا يكون موجودًا ═══════════════
select '2 · deliverable_content_types' as check,
       case when to_regclass('public.deliverable_content_types') is null
            then '✅ لم يُنشأ — التراجع تمّ'
            else '⚠️ موجود — تغيير جزئيّ! قف وأبلغ' end as result;


-- ═══ §3 · الأعمدة الجديدة على deliverables — يجب أن تكون صفرًا ══════════════
-- 18 عمودًا كان الملفّ سيضيفها. المتوقَّع: 0.
select '3 · أعمدة جديدة على deliverables' as check,
       count(*) as found_expect_zero,
       case when count(*) = 0 then '✅ لم يُضف شيء'
            else '⚠️ أُضيفت أعمدة — تغيير جزئيّ! قف وأبلغ' end as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'deliverables'
   and column_name in ('stage_id','content_type','platforms','execution_details',
        'proposed_caption','priority','client_visible','schedule_status',
        'planned_start_date','expected_units','completed_units','recurrence_type',
        'recurrence_config','requires_shooting','requires_editing','requires_design',
        'requires_printing','sort_order');


-- ═══ §4 · الأعمدة الجديدة على projects — يجب أن تكون صفرًا ══════════════════
select '4 · أعمدة جديدة على projects' as check,
       count(*) as found_expect_zero,
       case when count(*) = 0 then '✅ لم يُضف شيء'
            else '⚠️ أُضيفت أعمدة — تغيير جزئيّ! قف وأبلغ' end as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'projects'
   and column_name in ('schedule_status','planned_start_date','stage_order');


-- ═══ §5 · الدوالّ الجديدة — يجب أن تكون صفرًا ═══════════════════════════════
select '5 · دوالّ جديدة' as check,
       count(*) as found_expect_zero,
       coalesce(string_agg(p.proname, ', '), '(لا شيء)') as names,
       case when count(*) = 0 then '✅ لم تُنشأ'
            else '⚠️ أُنشئت دوالّ — تغيير جزئيّ! قف وأبلغ' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('deliverable_internal_is_staff','large_project_deliverables_bulk_update',
                     'project_units_can_write');


-- ═══ §6 · القيد الضيّق الأصليّ — يجب أن يكون ما زال كما هو ══════════════════
-- هذا **عكس** الفحوص أعلاه: نتوقّع أن القيد القديم **باقٍ**، لأن الترحيل تراجع.
-- وجوده يُثبت أن قاعدة البيانات لم تتغيّر، وأن «طباعة» ما زالت مرفوضة.
select '6 · قيد type الضيّق (يجب أن يبقى)' as check,
       coalesce(string_agg(c.conname, ', '), '(لا يوجد)') as constraint_name,
       case when count(*) > 0 then '✅ باقٍ — القاعدة لم تتغيّر (الطباعة ما زالت مرفوضة)'
            else 'ℹ️ غير موجود — راجع معي قبل المتابعة' end as result
  from pg_constraint c
 where c.conrelid = 'public.deliverables'::regclass
   and c.contype = 'c'
   and pg_get_constraintdef(c.oid) ilike '%video%'
   and pg_get_constraintdef(c.oid) ilike '%photo%'
   and pg_get_constraintdef(c.oid) not ilike '%photography%';


-- ═══ §7 · جداول الاستيراد — يجب ألّا تكون موجودة (لم تُشغَّل حزمتها) ════════
select '7 · جداول bulk import' as check,
       count(*) as found_expect_zero,
       case when count(*) = 0 then '✅ لم تُنشأ — لم تُشغَّل الحزمة الثانية'
            else '⚠️ موجودة — قف وأبلغ' end as result
  from information_schema.tables
 where table_schema = 'public' and table_name in ('import_batches','import_rows');


-- ═══ §8 · سلامة عامّة — لم يُنشأ أيّ مشروع ولا مخرج ═════════════════════════
-- الترحيل **لا يُنشئ بيانات إطلاقًا** بحكم تصميمه. هذا يؤكّد ذلك.
select '8 · لا بيانات أُنشئت' as check,
       (select count(*) from public.projects)     as projects_now,
       (select count(*) from public.deliverables) as deliverables_now,
       'قارن بالعدد الذي تعرفه — يجب ألّا يتغيّر' as note;


-- ═══ §9 · العمل الأمنيّ المطبَّق سابقًا ما زال سليمًا ═══════════════════════
-- الترحيل الفاشل يجب ألّا يكون قد مسّ Fix A / Fix B / Fix C. تأكيد سريع.
select '9 · Fix A/B/C سليمة' as check,
       pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
         ilike '%role_change_denied%' as fixA_expect_true,
       pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
         ilike '%can_manage_identity%' as fixB_expect_true,
       coalesce(public.can_manage_hr(), null) is not null as fixC_no_null_expect_true;


-- ════════════════════════════════════════════════════════════════════════════
-- الخلاصة المتوقَّعة: §1–§5 و§7 كلّها «لم يُنشأ» · §6 «باقٍ» · §9 كلّها true.
-- عندها الإنتاج **كما كان تمامًا**، ويمكن تشغيل RUNME المُصحَّح بأمان.
-- ════════════════════════════════════════════════════════════════════════════
