-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع منصّة المشاريع الكبيرة · **اقرأ كل هذا الرأس قبل أن تُشغّل سطرًا**
-- docs/project_platform_large_projects_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★★ الحقيقة أوّلًا: هذا التراجع **ليس** كاملًا، ولا يمكن أن يكون ★★★
--
--   ما يمكن التراجع عنه بلا فقدان:  الدوالّ · المشغّلات · الفهارس · القيود الجديدة.
--   ما **يُفقد** إن أزلت الأعمدة:    كل بيانات التخطيط التي أُدخلت بعد التطبيق —
--                                    المراحل · الوحدات · الجدولة · التعليقات
--                                    الداخلية · الكابشن المقترح · أثر الاستيراد.
--   ما **لا يمكن** التراجع عنه أبدًا: (1) نسب التقدّم التي رآها العميل بالفعل.
--                                    (2) القيد الضيّق القديم لا يُستعاد إلّا إن لم
--                                        يكن هناك أيّ انحراف في العمود `type`.
--                                    (3) تعبئة projects.stage_order من
--                                        sequence_number: لا نعرف أيّ صفّ كان
--                                        فارغًا قبل التطبيق — الإفراغ الكامل هو
--                                        التقريب الوحيد المتاح وهو **خسارة**.
--
-- ★★★ public.deliverable_internal لا يُمسّ في §T1 إطلاقًا ★★★
--   هو الجدول الجانبي الذي يحمل الملاحظات الداخلية وأثر الاستيراد، وعزله عن
--   العميل هو **إصلاح أمنيّ** لا ميزة. §T1 يُبقيه كاملًا ببياناته وسياساته.
--   §T2 وحده يحذفه، بقرار صريح، وبالثمن الموضّح هناك.
--
-- ★★★ الأعمدة الـ18 لا تُحذف في هذا الملفّ افتراضيًّا ★★★
--   القسم §T2 يحتوي أوامر DROP COLUMN وهي **معلَّقة بالكامل**. لن تنفَّذ ما لم
--   تُزل التعليق بيدك سطرًا سطرًا. قبل ذلك شغّل §T0 (لوحة الخسارة) — يطبع لك
--   بالضبط كم صفًّا يحمل بيانات في كل عمود ستحذفه.
--   ⚠️ DROP COLUMN في PostgreSQL **لا يُسترجع**. لا نسخة احتياطية داخل القاعدة.
--
-- ★★★ الطبقات — ابدأ من الأخفّ ★★★
--   §T0  لوحة الخسارة (قراءة فقط)      — شغّلها دائمًا أوّلًا.
--   §T1  التعطيل الآمن                 — يزيل السلوك ويُبقي كل بايت من البيانات.
--                                        ★ هذا هو ما تريده في 95% من الحالات. ★
--   §T2  الحذف المُتلِف                 — معلَّق. لا تلمسه إلّا بقرار صريح مكتوب.
--
-- ★ ما لا يمسّه هذا الملفّ إطلاقًا ★
--   لا يمسّ MFA ولا أيّ إصلاح أمنيّ · لا يحذف مشروعًا ولا مخرجًا · لا يمسّ سياسة
--   RLS على deliverables/projects · لا يعيد كتابة أيّ صفّ عمل.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- §T0) لوحة الخسارة — قراءة فقط. لا تُشغّل §T2 قبل قراءتها.
-- ════════════════════════════════════════════════════════════════════════════
select 'stage_id (ربط المخرج بالمرحلة)'  as "العمود",
       count(*) filter (where stage_id is not null)::text          as "صفوف تحمل بيانات",
       'يُفقد ربط المراحل كلّه' as "أثر الحذف" from public.deliverables
union all select 'content_type', count(*) filter (where content_type is not null and content_type <> 'custom')::text,
       'يُفقد التصنيف الحقيقي؛ يبقى type القديم فقط (video/photo/other)' from public.deliverables
union all select 'platforms', count(*) filter (where platforms is not null and cardinality(platforms) > 0)::text,
       'تُفقد منصّات النشر' from public.deliverables
union all select 'execution_details', count(*) filter (where coalesce(btrim(execution_details),'') <> '')::text,
       'تُفقد تفاصيل التنفيذ' from public.deliverables
union all select 'proposed_caption', count(*) filter (where coalesce(btrim(proposed_caption),'') <> '')::text,
       'يُفقد الكابشن المقترح' from public.deliverables
union all select 'expected_units / completed_units',
       count(*) filter (where expected_units is not null or coalesce(completed_units,0) > 0)::text,
       'يُفقد كل عدّ الوحدات ⇒ محرّك التقدّم الموزون يستحيل' from public.deliverables
union all select 'schedule_status / planned_start_date',
       count(*) filter (where coalesce(schedule_status,'awaiting_schedule') <> 'awaiting_schedule'
                           or planned_start_date is not null)::text,
       'تُفقد الجدولة' from public.deliverables
union all select 'recurrence_type / recurrence_config',
       count(*) filter (where coalesce(recurrence_type,'none') <> 'none' or recurrence_config is not null)::text,
       'يُفقد التكرار' from public.deliverables
union all select 'requires_* (أربعة أعلام)',
       count(*) filter (where coalesce(requires_shooting,false) or coalesce(requires_editing,false)
                           or coalesce(requires_design,false)   or coalesce(requires_printing,false))::text,
       'تُفقد متطلّبات التنفيذ' from public.deliverables
union all select 'deliverable_internal · internal_notes',
       (select count(*) filter (where coalesce(btrim(internal_notes),'') <> '')::text
          from public.deliverable_internal),
       'تُفقد الملاحظات الداخلية (الجدول الجانبي — §T2 وحده يحذفه)'
union all select 'deliverable_internal · external_key / import_batch_id / source_*',
       (select count(*) filter (where external_key is not null or import_batch_id is not null)::text
          from public.deliverable_internal),
       '★ يُفقد أثر الاستيراد ⇒ إعادة استيراد نفس الملفّ ستُنشئ نسخًا مكرّرة ★'
union all select 'deliverable_internal · metadata غير فارغ',
       (select count(*) filter (where coalesce(metadata,'{}'::jsonb) <> '{}'::jsonb)::text
          from public.deliverable_internal),
       'تُفقد الحقول الحرّة (ومنها «المجموعة داخل المرحلة»)'
union all select 'client_visible = true', count(*) filter (where coalesce(client_visible,false))::text,
       'يُفقد قرار الإظهار للعميل' from public.deliverables
union all select 'sort_order', count(*) filter (where sort_order is not null)::text,
       'يُفقد الترتيب اليدوي' from public.deliverables
union all select 'projects.stage_order', count(*) filter (where stage_order is not null)::text,
       'يُفقد ترتيب المراحل (لا نعرف ما كان فارغًا قبل التطبيق)' from public.projects
union all select 'projects.schedule_status ≠ الافتراضي',
       count(*) filter (where coalesce(schedule_status,'awaiting_schedule') <> 'awaiting_schedule')::text,
       'تُفقد جدولة المشاريع/المراحل' from public.projects;

-- هل يمكن استعادة القيد الضيّق أصلًا؟
select 'قيم type خارج (video, photo, other)'                          as "المحور",
       count(*)::text                                                  as "العدد",
       case when count(*) = 0
            then 'يمكن استعادة القيد الضيّق (القسم §T1-ب اختياري)'
            else '⛔ لا يمكن استعادته — استعادته ستجعل هذه الصفوف غير قانونية' end as "الحكم"
  from public.deliverables where coalesce(type,'') not in ('video','photo','other');


-- ════════════════════════════════════════════════════════════════════════════
-- §T1) التعطيل الآمن — يزيل السلوك ويُبقي **كل** البيانات
--      بعد تشغيله: الأعمدة تبقى، القيم تبقى، لكن لا مزامنة ولا حرّاس ولا دوالّ
--      تقدّم. الواجهة يجب أن تكتشف غياب الدوالّ (PGRST202) وتُعطّل الميزة برسالة
--      عربية واضحة — هذا هو السلوك المصمَّم أصلًا.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- (أ) المشغّلات — أوّل ما يُزال (السلوك يتوقّف فورًا)
drop trigger if exists trg_deliverables_type_sync   on public.deliverables;
drop trigger if exists trg_deliverables_stage_guard on public.deliverables;
drop trigger if exists trg_projects_depth_guard     on public.projects;

-- (ب) الدوالّ — كلّها من هذه الحزمة وحدها، لا يشاركها أحد
-- ⛔ public.deliverable_internal_is_staff **غير مذكورة هنا عمدًا**: سياستا
--    deliverable_internal تعتمدان عليها، وإسقاطها يفشل بخطأ تبعية — والأسوأ لو
--    نجح: جدول بلا بوّابة. §T2 يُسقط الجدول أوّلًا ثم الدالّة.
drop function if exists public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean);
drop function if exists public.project_units_can_write(uuid);
drop function if exists public.deliverables_type_sync();

-- §8c: إعادة سياسة القراءة إلى صيغتها الأصلية (بلا شرط client_visible).
-- تُنفَّذ قبل إسقاط العمود، وإلّا بقيت سياسة تشير إلى عمود غير موجود.
drop policy if exists "deliverables read" on public.deliverables;
create policy "deliverables read" on public.deliverables for select to authenticated
  using (public.is_admin()
         or (is_deleted = false
             and (public.is_kian_member(project_id)
                  or (public.is_not_blocked() and public.is_client_side(project_id)
                      and status in ('client_review','revision_requested',
                                     'approved','final_delivered')))));
drop function if exists public.deliverables_stage_guard();
drop function if exists public.projects_depth_guard();
drop function if exists public.deliverable_content_types_list(boolean);
drop function if exists public.project_breadcrumb(uuid);
drop function if exists public.project_stage_progress(uuid);
drop function if exists public.project_units_rollup(uuid);
drop function if exists public.project_units_progress(uuid,uuid);
drop function if exists public.project_units_client_view(uuid);
drop function if exists public.project_units_can_read(uuid);
drop function if exists public.project_hierarchy_can_parent(uuid,uuid);
drop function if exists public.project_hierarchy_depth(uuid);
drop function if exists public.project_hierarchy_root(uuid);
drop function if exists public.project_hierarchy_max_depth();
drop function if exists public.deliverable_status_progress_fraction(text);
-- ⚠️ deliverable_content_type_legacy يستعمله POSTCHECK فقط؛ إزالته آمنة.
drop function if exists public.deliverable_content_type_legacy(text);

-- (ج) القيود الجديدة — إزالتها تُرخي التحقّق ولا تُتلف صفًّا
alter table public.deliverables drop constraint if exists deliverables_content_type_fk;
alter table public.deliverables drop constraint if exists deliverables_schedule_status_ck;
alter table public.deliverables drop constraint if exists deliverables_priority_ck;
alter table public.deliverables drop constraint if exists deliverables_recurrence_type_ck;
alter table public.deliverables drop constraint if exists deliverables_units_ck;
alter table public.projects     drop constraint if exists projects_schedule_status_ck;

-- (د) الفهارس
-- ⚠️ فهرسا الجدول الجانبي (ux_deliverable_internal_external_key و
--    idx_deliverable_internal_batch) **لا يُسقطان هنا**: الأوّل هو أساس
--    idempotency للاستيراد، وإسقاطه يفتح باب التكرار الصامت عند إعادة الاستيراد.
--    §T2 وحده — بقرار صريح — يُسقط الجدول الجانبي كلّه.
drop index if exists public.idx_deliverables_stage;
drop index if exists public.idx_deliverables_schedule;
drop index if exists public.idx_deliverables_content_type;
drop index if exists public.idx_deliverables_project_sort;
drop index if exists public.idx_deliverables_platforms;
drop index if exists public.idx_projects_stage_order;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- §T1-ب) استعادة القيد الضيّق على `type` — **اختياري ومشروط**
--   لا يُنفَّذ إلّا إن لم يكن هناك أيّ قيمة خارج المفردات الثلاث (يفحص بنفسه).
--   ⚠️ استعادته تعني: المنصّة تعود عاجزة عن تمثيل الطباعة/الفعاليات/الهدايا.
--      لا تستعده إلّا إن كان هدفك العودة الحرفية إلى ما قبل الترقية.
--   ⚠️ الاسم المُستعاد `deliverables_type_check` قد يخالف اسم القيد الأصلي في
--      قاعدتك (كان مولَّدًا) — الوظيفة متطابقة والاسم لا يُستعمل في أيّ كود.
-- ─────────────────────────────────────────────────────────────────────────────
do $restore$
declare n int;
begin
  select count(*) into n from public.deliverables where coalesce(type,'') not in ('video','photo','other');
  if n > 0 then
    raise notice '⛔ لن يُستعاد القيد الضيّق: % صفًّا يحمل قيمة type خارج المفردات الثلاث. استعادته كانت ستُفشل الترحيل.', n;
    return;
  end if;
  alter table public.deliverables drop constraint if exists deliverables_type_open_ck;
  if not exists (select 1 from pg_constraint
                  where conrelid='public.deliverables'::regclass and conname='deliverables_type_check') then
    alter table public.deliverables add constraint deliverables_type_check
      check (type in ('video','photo','other'));
  end if;
  raise notice 'أُعيد القيد الضيّق على deliverables.type — المنصّة عادت إلى المفردات الثلاث.';
end $restore$;


-- ════════════════════════════════════════════════════════════════════════════
-- §T2) ★★ الحذف المُتلِف — معلَّق بالكامل ★★
--
--   لا تُزل التعليق إلّا بعد أن:
--     1. شغّلت §T0 وقرأت كل رقم فيها.
--     2. أخذت نسخة احتياطية كاملة خارج القاعدة (Supabase → Database → Backups)،
--        وتحقّقت أنها قابلة للاستعادة فعلًا.
--     3. كتبت قرارًا صريحًا بأنك تقبل فقدان البيانات المذكورة أعلاه.
--
--   ⚠️ ALTER TABLE ... DROP COLUMN لا يُسترجع بأمر SQL. المسار الوحيد للعودة
--      هو استعادة نسخة احتياطية كاملة — أي فقدان **كل** ما كُتب بعدها.
--
--   ⚠️ حذف public.deliverable_internal له أثر خاصّ مزدوج: (1) تُفقد الملاحظات
--      الداخلية كلّها، (2) يزول external_key وهو أساس idempotency، فإعادة استيراد
--      نفس الملفّ لاحقًا **ستُنشئ نسخًا مكرّرة صامتة**.
--      ⛔ ولا تُعِد هذه الأعمدة إلى public.deliverables بأيّ حال: إعادتها تُعيد
--         فتح تسريب مؤكَّد (العميل يقرؤها بـ select يدويّ عبر PostgREST).
--
--   ملاحظة: حذف public.deliverable_content_types يتطلّب إزالة المفتاح الخارجي
--   أولًا (يفعلها §T1-ج). بعد حذفه تبقى قيم content_type نصوصًا بلا مرجع.
-- ════════════════════════════════════════════════════════════════════════════
--
-- begin;
--
-- alter table public.deliverables drop column if exists stage_id;
-- alter table public.deliverables drop column if exists content_type;
-- alter table public.deliverables drop column if exists platforms;
-- alter table public.deliverables drop column if exists execution_details;
-- alter table public.deliverables drop column if exists proposed_caption;
-- alter table public.deliverables drop column if exists priority;
-- alter table public.deliverables drop column if exists client_visible;
-- alter table public.deliverables drop column if exists schedule_status;
-- alter table public.deliverables drop column if exists planned_start_date;
-- alter table public.deliverables drop column if exists expected_units;
-- alter table public.deliverables drop column if exists completed_units;
-- alter table public.deliverables drop column if exists recurrence_type;
-- alter table public.deliverables drop column if exists recurrence_config;
-- alter table public.deliverables drop column if exists requires_shooting;
-- alter table public.deliverables drop column if exists requires_editing;
-- alter table public.deliverables drop column if exists requires_design;
-- alter table public.deliverables drop column if exists requires_printing;
-- alter table public.deliverables drop column if exists sort_order;
--
-- alter table public.projects drop column if exists schedule_status;
-- alter table public.projects drop column if exists planned_start_date;
-- alter table public.projects drop column if exists stage_order;
--
-- -- ★★ الجدول الجانبي: حذفه يُفقد **الملاحظات الداخلية كلّها** و**أثر الاستيراد
-- --    كلّه** دفعةً واحدة، فيصير كل استيراد لاحق يُنشئ نسخًا مكرّرة صامتة.
-- --    الترتيب إلزاميّ: الجدول أوّلًا (السياستان تعتمدان على الدالّة) ثم الدالّة.
-- drop table    if exists public.deliverable_internal;
-- drop function if exists public.deliverable_internal_is_staff(uuid);
--
-- drop table if exists public.deliverable_content_types;
--
-- -- مفاتيح الصلاحيات المزروعة (إزالتها اختيارية؛ صفوف كتالوج لا أكثر):
-- -- delete from public.permissions where key in
-- --   ('deliverables.manage_content_types','deliverables.manage_schedule','deliverables.manage_units');
--
-- commit;
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★ العمود القديم public.deliverables.type لا يُحذف في أيّ طبقة من هذا الملفّ.
--   حذفه يكسر docs/deliverable_versions_RUNME.sql:82 وطبقة النسخ كلّها.
-- ★ لا شيء في هذا الملفّ يحذف مشروعًا أو مخرجًا أو صفّ عمل واحدًا.
-- ════════════════════════════════════════════════════════════════════════════
