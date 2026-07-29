-- ════════════════════════════════════════════════════════════════════════════
-- مسبار 10 — التحقّق بعد الاستيراد · **قراءة فقط بالكامل**
-- ════════════════════════════════════════════════════════════════════════════
-- لا INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/REVOKE. آمن للتكرار.
-- ضَع معرّف المشروع الرئيسيّ في السطر التالي ثم شغّل الملفّ كاملًا.
-- ════════════════════════════════════════════════════════════════════════════
\set root_id '00000000-0000-0000-0000-000000000000'   -- ← ضع project_id هنا

-- إن لم يدعم محرّرك \set، استبدل :'root_id' بالمعرّف بين علامتَي اقتباس مفردتين.

-- ═══ 1-2 · مشروع رئيسيّ واحد + 11 مرحلة ═════════════════════════════════════
select '1-2 · الجذر والمراحل' as check,
       (select project_name from public.projects where id = :'root_id'::uuid) as root_title,
       (select project_scope from public.projects where id = :'root_id'::uuid) as scope_expect_master,
       (select count(*) from public.projects
         where parent_project_id = :'root_id'::uuid and coalesce(is_deleted,false)=false) as stages_expect_11;

-- ═══ 3 · 79 مخرجًا ══════════════════════════════════════════════════════════
select '3 · عدد المخرجات' as check, count(*) as expect_79
  from public.deliverables d
 where d.project_id = :'root_id'::uuid
    or d.project_id in (select id from public.projects where parent_project_id = :'root_id'::uuid)
    or d.stage_id  in (select id from public.projects where parent_project_id = :'root_id'::uuid);

-- ═══ 4 · لا مراحل ولا مخرجات مكرّرة ═════════════════════════════════════════
select '4 · مراحل مكرّرة' as check, count(*) as expect_zero from (
  select project_name from public.projects
   where parent_project_id = :'root_id'::uuid and coalesce(is_deleted,false)=false
   group by project_name having count(*) > 1) x;

-- ═══ 5-6 · كل مخرج مرتبط بمرحلته · والمراحل مرتّبة ══════════════════════════
select '5-6 · التوزيع والترتيب' as check,
       p.stage_order, p.project_name,
       count(d.id) as deliverables
  from public.projects p
  left join public.deliverables d on d.stage_id = p.id
 where p.parent_project_id = :'root_id'::uuid and coalesce(p.is_deleted,false)=false
 group by p.stage_order, p.project_name
 order by p.stage_order;
-- المتوقَّع: 11 صفًّا بالترتيب، والأعداد 7,5,8,4,3,4,9,7,16,10,6

select '5b · مخرجات بلا مرحلة' as check, count(*) as expect_zero
  from public.deliverables d
 where d.stage_id is null
   and (d.project_id = :'root_id'::uuid
        or d.project_id in (select id from public.projects where parent_project_id = :'root_id'::uuid));

-- ═══ 7-9 · انتظار الجدولة · لا متأخّر · لا تواريخ وهمية ═════════════════════
select '7-9 · الجدولة' as check,
       count(*) filter (where d.schedule_status = 'awaiting_schedule') as awaiting_expect_79,
       count(*) filter (where d.schedule_status <> 'awaiting_schedule') as scheduled_expect_0,
       count(*) filter (where d.due_date is not null)            as with_due_expect_0,
       count(*) filter (where d.planned_start_date is not null)  as with_start_expect_0
  from public.deliverables d
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid);

select '7b · المراحل بلا تواريخ' as check,
       count(*) filter (where schedule_status = 'awaiting_schedule') as awaiting_expect_11,
       count(*) filter (where planned_start_date is not null)       as with_start_expect_0
  from public.projects where parent_project_id = :'root_id'::uuid;

-- ═══ 10-11 · المفاتيح الخارجية وأرقام الصفوف ════════════════════════════════
select '10-11 · المفاتيح' as check,
       count(*)                                   as rows_expect_79,
       count(distinct i.external_key)             as distinct_keys_expect_79,
       count(*) filter (where i.external_key is null)      as missing_key_expect_0,
       count(*) filter (where i.source_row_number is null) as missing_row_expect_0
  from public.deliverable_internal i
  join public.deliverables d on d.id = i.deliverable_id
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid);

-- ═══ 12-13 · العربية · النوع · المنصات ══════════════════════════════════════
select '12-13 · المحتوى' as check,
       count(*) filter (where d.content_type is null)                    as no_type_expect_0,
       count(*) filter (where d.platforms is null or cardinality(d.platforms)=0) as no_platform_expect_1,
       count(*) filter (where d.execution_details is null)               as no_details_expect_2,
       count(*) filter (where d.proposed_caption is null)                as no_caption_expect_23,
       count(*) filter (where d.title ~ '[؀-ۿ]')               as arabic_titles_expect_79
  from public.deliverables d
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid);

-- ═══ 16 · كل المخرجات مخفيّة عن العميل ══════════════════════════════════════
select '16 · ظهور العميل' as check,
       count(*) filter (where coalesce(d.client_visible,true) = false) as hidden_expect_79,
       count(*) filter (where coalesce(d.client_visible,true) = true)  as visible_expect_0
  from public.deliverables d
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid);

-- ═══ 19 · صفّا «إعلان المقبولين» منفصلان ════════════════════════════════════
select '19 · الصفّان المتشابهان' as check,
       count(*) as expect_2, count(distinct i.external_key) as distinct_keys_expect_2,
       count(distinct d.execution_details) as distinct_details_expect_2
  from public.deliverables d
  join public.deliverable_internal i on i.deliverable_id = d.id
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid)
   and i.source_row_number in (20, 21);

-- ═══ 20 · لا صفوف من الورقة الجانبية ════════════════════════════════════════
select '20 · صفوف ورقة1' as check, count(*) as expect_zero
  from public.deliverable_internal i
  join public.deliverables d on d.id = i.deliverable_id
 where d.stage_id in (select id from public.projects where parent_project_id = :'root_id'::uuid)
   and coalesce(i.metadata->>'source_sheet','') ilike '%ورقة1%';

-- ═══ 18 · التقدّم لا يُضلَّل بعناصر بلا جدول ════════════════════════════════
select '18 · التقدّم' as check,
       (select progress_pct from public.project_core where project_id = :'root_id'::uuid) as root_progress,
       'المتوقَّع 0 أو NULL — لا شيء أُنجز بعد' as note;

-- ═══ 17 · لم تُرسل إشعارات بسبب الاستيراد ═══════════════════════════════════
select '17 · الإشعارات' as check, count(*) as recent_expect_low
  from public.notifications
 where created_at > now() - interval '1 hour'
   and (payload::text ilike '%' || :'root_id' || '%' or title ilike '%مسبار%');

-- ════════════════════════════════════════════════════════════════════════════
-- أرسل لي أيّ صفّ لا يطابق المتوقَّع قبل أن تغيّر شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
