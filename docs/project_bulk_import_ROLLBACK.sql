-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع الاستيراد الجماعي · **اقرأ الرأس كاملًا قبل أن تُشغّل سطرًا**
-- docs/project_bulk_import_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★★★ الحقيقة الأولى، وهي الأهمّ ★★★
--
--   هذا الملفّ يُزيل **آلة الاستيراد**. وهو **لا يحذف — ولن يحذف — أيّ مشروع أو
--   مرحلة أو مخرج أنشأه الاستيراد.** تلك بيانات عمل حقيقية، صارت بعد إنشائها
--   ملكًا للمنصّة لا للاستيراد، وقد يكون فريقٌ عمل عليها منذ ذلك الحين: علّق،
--   راجع، رفع نسخة، غيّر حالة. حذفها آليًّا كان سيُلحق ضررًا أكبر من أيّ خطأ استيراد.
--
--   إن أردت التراجع عن **محتوى** دفعة معيّنة فذلك قرار بشريّ صفًّا صفًّا:
--     select * from public.import_rows where batch_id = '<batch>' and status = 'applied';
--   ثم أرشِف/احذف بنعومة كل صفّ عبر مسارات المنصّة العادية (soft delete)،
--   بعد أن تتأكّد بعينك أنه لم يُبنَ عليه شيء. لا تحذف من الجداول مباشرةً.
--
-- ★★★ ما يُفقد فعلًا بتشغيل §T1 ★★★
--   • أثر التدقيق كلّه: أيّ ملفّ أنتج أيّ صفّ، ومن نفّذ ومتى، وماذا فشل ولماذا.
--     (import_batches / import_rows / import_batch_events)
--   • القدرة على تشغيل استيراد جديد حتى تُعاد الحزمة.
--
-- ★★★ ما لا يمكن التراجع عنه أبدًا ★★★
--   حذف عمود projects.external_key (وهو **معلَّق** في §T2) يُلغي أساس idempotency
--   للمراحل: بعده، إعادة استيراد نفس الملفّ **ستُنشئ مراحل مكرّرة صامتة**.
--   والأمر نفسه ينطبق على deliverable_internal.external_key المملوك للحزمة الأولى —
--   لا تحذفه من هنا ولا من هناك إلّا بقرار صريح.
--
-- ★ الطبقات ★
--   §T0  لوحة الخسارة (قراءة فقط) — شغّلها أوّلًا دائمًا.
--   §T1  إزالة آلة الاستيراد وجداولها — يُبقي كل بيانات العمل. ★ هذا هو المقصود عادةً ★
--   §T2  حذف عمودَي الأثر على projects — **معلَّق**، مُتلِف، ولا يُسترجع.
--
-- ★ لا يمسّ ★ MFA · أيّ إصلاح أمنيّ · أيّ سياسة RLS على projects/deliverables ·
--   حزمة docs/project_platform_large_projects_* (تراجعها ملفّ مستقلّ).
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- §T0) لوحة الخسارة — قراءة فقط
-- ════════════════════════════════════════════════════════════════════════════
select 'دفعات استيراد'                              as "الكائن",
       count(*)::text                                as "العدد",
       '★ يُفقد أثر التدقيق: أيّ ملفّ أنتج أيّ صفّ ومن نفّذه ومتى' as "أثر §T1"
  from public.import_batches
union all
select 'صفوف staging', (select count(*)::text from public.import_rows),
       'تُفقد خريطة external_key ← الصفّ الذي أُنشئ منه'
union all
select 'أحداث تدقيق', (select count(*)::text from public.import_batch_events),
       'يُفقد سجلّ الانتقالات'
union all
select '★ مشاريع/مراحل أنشأها الاستيراد',
       (select count(*)::text from public.projects where import_batch_id is not null),
       '✅ **تبقى كما هي** — §T1 لا يحذف مشروعًا'
union all
select '★ مخرجات أنشأها الاستيراد',
       (select count(*)::text from public.deliverable_internal where import_batch_id is not null),
       '✅ **تبقى كما هي** — §T1 لا يحذف مخرجًا'
union all
select 'مشاريع تحمل external_key',
       (select count(*)::text from public.projects where external_key is not null),
       '⚠️ حذف العمود (§T2) يجعل إعادة الاستيراد تُنشئ مراحل مكرّرة';

-- بعد §T1 يصير عمود import_batch_id على projects/deliverables «يتيمًا»: يحمل
-- معرّف دفعة لم تعد موجودة. هذا مقصود ومقبول — قيمة تاريخية لا مرجع لها.
select 'صفوف ستحمل import_batch_id يتيمًا بعد §T1' as "المحور",
       ((select count(*) from public.projects     where import_batch_id is not null)
      + (select count(*) from public.deliverable_internal where import_batch_id is not null))::text as "العدد",
       'غير ضارّ: لا مفتاح خارجي على العمودين — لا يفشل شيء' as "الحكم";


-- ════════════════════════════════════════════════════════════════════════════
-- §T1) إزالة آلة الاستيراد — يُبقي **كل** بيانات العمل
--      بعد تشغيله تختفي دوالّ الاستيراد ⇒ الواجهة يجب أن تكتشف PGRST202 وتُظهر
--      حالة معطّلة برسالة عربية واضحة، لا أن تنهار.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- (أ) الدوالّ — بالترتيب العكسي للاعتمادية
drop function if exists public.import_batch_cancel(uuid,text);
drop function if exists public.import_batch_list(int,int);
drop function if exists public.import_batch_report(uuid,int);
drop function if exists public.import_batch_execute(uuid,boolean);
drop function if exists public.import_batch_dry_run(uuid,boolean);
drop function if exists public.import_batch_execute_core(uuid,boolean);
drop function if exists public.import_batch_preview(uuid);
drop function if exists public.import_batch_load_rows(uuid,jsonb);
drop function if exists public.import_batch_create(text,text,uuid,text);
drop function if exists public.import_batch_guard(uuid,text[]);
drop function if exists public.import_audit(uuid,text,jsonb);
drop function if exists public.import_text_array(jsonb);
drop function if exists public.import_can_create_stages();
drop function if exists public.import_can_manage();

-- (ب) الجداول — ★ هنا يُفقد أثر التدقيق ★
--     import_rows و import_batch_events مرتبطان بـ ON DELETE CASCADE، فحذف
--     import_batches وحده يكفي؛ نكتبها الثلاثة صراحةً كي لا يعتمد أحد على ضمنيّ.
drop table if exists public.import_batch_events;
drop table if exists public.import_rows;
drop table if exists public.import_batches;

-- (ج) الفهارس الخاصّة بالاستيراد على projects
--     ⚠️ ux_projects_external_key: إبقاؤه لا يضرّ ويحمي من التكرار لو أُعيدت
--        الحزمة لاحقًا. نُسقط فهرس الدفعة فقط ونُبقي الفريد.
drop index if exists public.idx_projects_import_batch;

-- ★ لا نُسقط ux_projects_external_key هنا عمدًا: إسقاطه يفتح باب التكرار الصامت
--   بلا أيّ مكسب. أسقِطه يدويًّا فقط إن حذفت العمود في §T2.

-- (د) مفتاح الصلاحية (صفّ كتالوج لا أكثر — إبقاؤه غير ضارّ)
-- delete from public.permissions where key = 'projects.import';

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- §T2) ★★ حذف عمودَي الأثر على public.projects — معلَّق ومُتلِف ★★
--
--   لا تُزل التعليق إلّا بعد أن:
--     1. شغّلت §T0 وقرأت كم مشروعًا يحمل external_key.
--     2. أخذت نسخة احتياطية كاملة خارج القاعدة وتحقّقت أنها قابلة للاستعادة.
--     3. قبلت صراحةً أن إعادة استيراد أيّ ملفّ سابق ستُنشئ **مراحل مكرّرة**،
--        لأن المفتاح الذي كان يُعرّف «نفس المرحلة» لم يعد موجودًا.
--
--   ⚠️ ALTER TABLE ... DROP COLUMN لا يُسترجع بأمر SQL.
--   ⚠️ لا تحذف public.deliverable_internal من هنا — هو ملك الحزمة الأولى،
--      وحذفه يكسر idempotency المخرجات كلّها. راجع
--      docs/project_platform_large_projects_ROLLBACK.sql §T2 إن كان هذا قصدك.
-- ════════════════════════════════════════════════════════════════════════════
--
-- begin;
-- drop index if exists public.ux_projects_external_key;
-- alter table public.projects drop column if exists external_key;      -- ★ يزيل idempotency المراحل
-- alter table public.projects drop column if exists import_batch_id;
-- commit;
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★ لا شيء في هذا الملفّ — في أيّ طبقة — يحذف مشروعًا أو مرحلة أو مخرجًا أو
--   نسخة أو تعليقًا. آلة الاستيراد تزول؛ ما أنتجته يبقى.
-- ════════════════════════════════════════════════════════════════════════════
