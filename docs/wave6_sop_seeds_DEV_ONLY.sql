-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · V2-6.6-B — بذور الإجراءات الثلاثة.
--
-- 🔴🔴 DEVELOPMENT / TEST FIXTURES — **ليست سياسة كيان الرسمية** 🔴🔴
--
-- ★ اقرأ هذا قبل أيّ شيء ★
-- هذه **قوائم تشغيلية عملية**، لا سياسة سلامة ولا إجراء نظاميّ ولا التزامًا
-- تعاقديًّا. الفرق ليس لفظيًّا: قائمة موسومة «سياسة السلامة المعتمدة» تُقرأ في
-- تحقيق حادث بوصفها التزامًا أخلّت به الشركة. فكلّ صفّ هنا:
--   • موسوم `[SEED]` في عنوانه.
--   • `status = 'draft'` — ⛔ **غير معتمَد**، فلا يُرفَق بمهمّة
--     (`sop_attach_to_task` يشترط `approved`).
--   • `sensitivity = 'internal'`.
--
-- ⛔ ولا ادّعاء اعتماد: لا ISO ولا شهادة ولا مرجع نظاميّ. الاعتماد فعل بشريّ
--    لاحق يغيّر الحالة إلى `approved` بعد مراجعة حقيقية.
--
-- ★ الحارس ★
--     set local kian.allow_seed = 'yes';
-- تشغيله بلا ذلك يرفع استثناءً ولا يكتب صفًّا.
--
-- ★ الحذف ★
--     delete from public.sop_items where source_id in (
--       select id from public.ai_knowledge_sources where title_ar like '[SEED]%');
--     delete from public.ai_knowledge_sources where title_ar like '[SEED]%';
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if coalesce(current_setting('kian.allow_seed', true), '') <> 'yes' then
    raise exception
      '⛔ بذور تطوير: التشغيل يحتاج اختيارًا صريحًا. نفّذ أولًا: set local kian.allow_seed = ''yes'';';
  end if;
  if to_regclass('public.sop_items') is null then
    raise exception '🔴 sop_items مفقود — شغّل wave6_compliance_knowledge_RUNME.sql أولًا';
  end if;
end $$;

-- ─── الوثائق الثلاث في قاعدة المعرفة القائمة ───────────────────────────────
-- ⛔ لا جدول إجراءات موازٍ: الوثيقة صفّ في ai_knowledge_sources بنوعها القائم.
insert into public.ai_knowledge_sources
  (source_type, title_ar, title_en, language, status, sensitivity, content_kind, content_text, notes)
select 'operations_procedure', t.title, '', 'ar',
       -- 🔴 مسوّدة: غير معتمَدة، فلا تُرفَق بمهمّة (sop_attach_to_task يشترط approved).
       'draft', 'internal', 'inline',
       'بذرة تطوير — قائمة تشغيلية عملية. ليست سياسة سلامة معتمدة ولا إجراءً نظاميًّا.',
       -- 🔴 W6-2: الحالة المعلنة صراحةً في السجلّ نفسه، لا في وثيقة خارجية.
       'seed:development-fixture · PENDING INTERNAL HSE REVIEW'
from (values
  ('[SEED] ما قبل إقلاع الدرون'),
  ('[SEED] ما قبل البثّ المباشر'),
  ('[SEED] تجهيز استوديو البودكاست')
) as t(title)
where not exists (
  select 1 from public.ai_knowledge_sources s where s.title_ar = t.title);

-- الخطوات تُدرَج بصياغة صريحة (أوضح من حلقات متداخلة، وأسهل مراجعةً).
insert into public.sop_items (source_id, sort_order, label_ar, is_required)
select s.id, x.ord, x.label, true
from public.ai_knowledge_sources s
join (values
  ('[SEED] ما قبل إقلاع الدرون', 1, 'تأكّد من وجود تصريح الطيران ساري المفعول للموقع والتاريخ'),
  ('[SEED] ما قبل إقلاع الدرون', 2, 'راجع حدّ الرياح المُعلن للطائرة، وقارنه بتوقّع اليوم'),
  ('[SEED] ما قبل إقلاع الدرون', 3, 'افحص المراوح والهيكل بصريًّا بحثًا عن شروخ'),
  ('[SEED] ما قبل إقلاع الدرون', 4, 'تحقّق من شحن بطاريات الطائرة ووحدة التحكّم والشاشة'),
  ('[SEED] ما قبل إقلاع الدرون', 5, 'عايِر البوصلة ونظام تحديد الموقع في الموقع نفسه'),
  ('[SEED] ما قبل إقلاع الدرون', 6, 'حدّد منطقة إقلاع وهبوط خالية، وأبلغ من في محيطها'),
  ('[SEED] ما قبل إقلاع الدرون', 7, 'اتّفق على إشارة توقّف فوريّ مع المنسّق الأرضيّ'),
  ('[SEED] ما قبل البثّ المباشر', 1, 'اختبر الاتصال الأساسيّ وقِس سرعة الرفع الفعلية'),
  ('[SEED] ما قبل البثّ المباشر', 2, 'جهّز اتصالًا احتياطيًّا مستقلًّا واختبره فعليًّا'),
  ('[SEED] ما قبل البثّ المباشر', 3, 'شغّل الـencoder وتحقّق من معدّل البتّ ومقاومة الانقطاع'),
  ('[SEED] ما قبل البثّ المباشر', 4, 'اختبر البثّ إلى وجهة تجريبية قبل الوجهة الحقيقية'),
  ('[SEED] ما قبل البثّ المباشر', 5, 'تحقّق من مستويات الصوت ومن وجود مصدر صوت احتياطيّ'),
  ('[SEED] ما قبل البثّ المباشر', 6, 'تأكّد من مصدر طاقة احتياطيّ للأجهزة الحرجة'),
  ('[SEED] ما قبل البثّ المباشر', 7, 'حدّد المسؤول عن المتابعة أثناء البثّ وطريقة التنبيه'),
  ('[SEED] تجهيز استوديو البودكاست', 1, 'اضبط المايكات واختبر كلّ قناة منفردة'),
  ('[SEED] تجهيز استوديو البودكاست', 2, 'سجّل مقطعًا تجريبيًّا واستمع إليه بسمّاعة'),
  ('[SEED] تجهيز استوديو البودكاست', 3, 'افحص العزل الصوتيّ وأوقف مصادر الضجيج'),
  ('[SEED] تجهيز استوديو البودكاست', 4, 'اضبط الإضاءة على الوجوه وتجنّب انعكاس النظّارات'),
  ('[SEED] تجهيز استوديو البودكاست', 5, 'تحقّق من مساحة التخزين ومن التسجيل الاحتياطيّ المتزامن'),
  ('[SEED] تجهيز استوديو البودكاست', 6, 'ثبّت زوايا الكاميرات وراجع التأطير لكلّ متحدّث'),
  ('[SEED] تجهيز استوديو البودكاست', 7, 'سجّل ثلاثين ثانية صمت للغرفة لاستعمالها في المونتاج')
) as x(title, ord, label) on s.title_ar = x.title
where s.source_type = 'operations_procedure'
  and not exists (
    select 1 from public.sop_items i where i.source_id = s.id and i.sort_order = x.ord);

commit;

-- ─── الحذف — أزل التعليق عند الحاجة ───────────────────────────────────────
-- begin;
-- delete from public.sop_items where source_id in (
--   select id from public.ai_knowledge_sources where title_ar like '[SEED]%');
-- delete from public.ai_knowledge_sources where title_ar like '[SEED]%';
-- commit;

-- ─── التحقّق (قراءة فقط) ───────────────────────────────────────────────────
-- select s.title_ar, s.status, count(i.id) as steps
--   from public.ai_knowledge_sources s
--   left join public.sop_items i on i.source_id = s.id
--  where s.title_ar like '[SEED]%' group by 1,2;
