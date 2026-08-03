-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · V2-3.5-B — بذرتا «فيلم مؤسسي» و«عرس».
--
-- 🔴🔴 DEVELOPMENT / TEST FIXTURES — **ليست جزءًا من ترحيلات Production** 🔴🔴
--
-- الـBrief: «بذرتا «فيلم مؤسسي» و«عرس» — **بذور لا نظام**».
-- ولذلك: لا جدول جديد. النظام قائم بالكامل (`project_templates` +
-- `project_template_versions` + `apply_template_v2` + حزمة 7A) — وهذه صفوف فيه.
--
-- ⛔ لا يُستدعى هذا الملفّ من أيّ RUNME، وليس في RELEASE_SQL_MANIFEST بوصفه
--    خطوة إصدار. تشغيله **اختيار صريح** يقوم به إنسان.
--
-- ★ الحارس ★
-- §0 يرفض التشغيل ما لم تُمرَّر موافقة صريحة في الجلسة:
--     set local kian.allow_seed = 'yes';
-- تشغيله بلا ذلك يرفع استثناءً ولا يكتب صفًّا واحدًا. الغرض أن يكون تشغيله
-- على Production بالخطأ **مستحيلًا بالصمت**، لا «غير مستحسن».
--
-- ★ الحذف ★
-- كلّ صفّ يحمل الوسم `[SEED]` في اسمه و`seed: true` في `spec`. الحذف:
--     delete from public.project_templates where name like '[SEED]%';
-- (أو §9 في نهاية هذا الملفّ، معلَّقًا.)
--
-- ⛔ لا اسم عميل حقيقيّ · لا سعر · لا تصريح · لا مشروع حقيقيّ. المحتوى مراحل
--    إنتاج عامّة يعرفها أيّ فريق، ولا يدّعي أنّه اعتماد أيّ جهة.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── §0 · الحارس ───────────────────────────────────────────────────────────
do $$
begin
  if coalesce(current_setting('kian.allow_seed', true), '') <> 'yes' then
    raise exception
      '⛔ بذور تطوير: التشغيل يحتاج اختيارًا صريحًا. نفّذ أولًا: set local kian.allow_seed = ''yes'';';
  end if;
  if to_regclass('public.project_templates') is null then
    raise exception '🔴 project_templates مفقود — حزمة القوالب (7A) غير مطبَّقة';
  end if;
end $$;

-- ─── §1 · قالب «فيلم مؤسسي» ────────────────────────────────────────────────
insert into public.project_templates (name, description, spec, is_active)
select
  '[SEED] فيلم مؤسسي',
  'بذرة تطوير — مراحل إنتاج فيلم تعريفيّ مؤسسيّ. ليست اعتمادًا ولا تسعيرة.',
  jsonb_build_object(
    'seed', true,
    'fixture_kind', 'development',
    'phases', jsonb_build_array(
      jsonb_build_object('name','التحضير',       'order',1, 'tasks', jsonb_build_array('اجتماع تعريفيّ','بحث ومحتوى','سيناريو','لوحة قصصية','خطّة تصوير')),
      jsonb_build_object('name','ما قبل الإنتاج','order',2, 'tasks', jsonb_build_array('معاينة المواقع','التصاريح','الطاقم','المعدّات','جدول التصوير')),
      jsonb_build_object('name','التصوير',       'order',3, 'tasks', jsonb_build_array('يوم تصوير رئيسيّ','لقطات تكميلية','مقابلات')),
      jsonb_build_object('name','ما بعد الإنتاج','order',4, 'tasks', jsonb_build_array('تفريغ المادّة','مونتاج أوّليّ','تصحيح ألوان','صوت وموسيقى','نسخة للمراجعة')),
      jsonb_build_object('name','التسليم',       'order',5, 'tasks', jsonb_build_array('تعديلات العميل','النسخة النهائية','صيغ النشر','الأرشفة'))
    )
  ),
  true
where not exists (select 1 from public.project_templates where name = '[SEED] فيلم مؤسسي');

-- ─── §2 · قالب «عرس» ───────────────────────────────────────────────────────
insert into public.project_templates (name, description, spec, is_active)
select
  '[SEED] عرس',
  'بذرة تطوير — مراحل تغطية حفل زفاف. ليست اعتمادًا ولا تسعيرة.',
  jsonb_build_object(
    'seed', true,
    'fixture_kind', 'development',
    'phases', jsonb_build_array(
      jsonb_build_object('name','التنسيق',       'order',1, 'tasks', jsonb_build_array('لقاء العائلة','تحديد الموعد والقاعة','نطاق التغطية')),
      jsonb_build_object('name','ما قبل الحفل',  'order',2, 'tasks', jsonb_build_array('معاينة القاعة','تصاريح القاعة','الطاقم','المعدّات','خطّة الإضاءة')),
      jsonb_build_object('name','يوم الحفل',     'order',3, 'tasks', jsonb_build_array('تغطية الاستقبال','تغطية المراسم','لقطات عائلية','تغطية الحفل')),
      jsonb_build_object('name','ما بعد الحفل',  'order',4, 'tasks', jsonb_build_array('نسخ احتياطي للمادّة','انتقاء','مونتاج','تصحيح ألوان')),
      jsonb_build_object('name','التسليم',       'order',5, 'tasks', jsonb_build_array('نسخة للمراجعة','التعديلات','التسليم النهائي','الأرشفة'))
    )
  ),
  true
where not exists (select 1 from public.project_templates where name = '[SEED] عرس');

commit;

-- ─── §9 · الحذف — أزل التعليق عند الحاجة ──────────────────────────────────
-- begin;
-- delete from public.project_templates where name like '[SEED]%';
-- commit;

-- ─── التحقّق (قراءة فقط) ───────────────────────────────────────────────────
-- select name, spec->>'seed' as seed, is_active from public.project_templates where name like '[SEED]%';
