-- ════════════════════════════════════════════════════════════════════════════
-- الإثبات السلوكيّ لحماية المونتير — **يتطلّب جلسة مستخدم حقيقية**
-- **قراءة فقط** — لا create/alter/insert/update/delete/grant/revoke.
--
-- ★ لماذا ملفّ منفصل ★
--   الفحص داخل RUNME **نصّيّ** (يقرأ pg_get_functiondef ويُثبت وجود الحرّاس
--   وترتيبها). وهذا يُثبت أن الكود المكتوب صحيح، ولا يُثبت أن قاعدة البيانات
--   تُطبّقه على جلسة حقيقية. محرّر SQL في Supabase يعمل بدور `postgres` بلا
--   جلسة GoTrue، فـ`auth.uid()` تساوي NULL دائمًا ⇒ كل استدعاء محميّ يفشل
--   بـ«not authorized» قبل بلوغ المنطق. الحكم من ذلك الفشل **خاطئ في
--   الاتجاهين**: لا يُثبت أن الحماية تعمل، ولا يُثبت أنها معطّلة.
--
-- ★ كيف تُشغّله ★
--   ليس من محرّر SQL. شغّله بجلسة حقيقية عبر البوابة أو بمفتاح anon مع
--   Bearer token للمستخدم. الطريقة العملية: افتح البوابة بحساب المونتير، ثم
--   نفّذ الخطوات في §أ من واجهة البوابة وراقب Network. ثم كرّرها بحساب المالك.
--   ⛔ لا تستخدم service_role — يتجاوز RLS ويُبطل معنى الاختبار كلّه.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ §0 · مَن أنا الآن؟ شغّله أوّلًا للتأكّد أنك لست postgres ═══════════════
select '0 · هويّة الجلسة' as check,
       auth.uid()                       as my_uid_must_not_be_null,
       public.staff_role()              as my_staff_role,
       public.is_owner()                as is_owner,
       public.is_admin()                as is_admin;
-- ⛔ إن كان my_uid_must_not_be_null فارغًا فأنت في محرّر SQL: **توقّف**.
--    نتائج ما بعده بلا معنى.


-- ═══ §أ · بحساب المونتير — كل هذه يجب أن تكون false ═════════════════════════
-- ضع معرّف مشروع **مُسنَد إليه** مكان :'proj'
\set proj '00000000-0000-0000-0000-000000000000'

select 'أ · قدرات المونتير' as check,
       public.can_move_deliverable(:'proj'::uuid)         as move_stage_expect_FALSE,
       public.can_send_to_client_review(:'proj'::uuid)    as to_client_expect_FALSE,
       public.can_finalize_deliverable(:'proj'::uuid)     as finalize_expect_FALSE,
       public.can_move_project_stage(:'proj'::uuid)       as move_project_expect_FALSE,
       public.can_approve_project_transition(:'proj'::uuid) as approve_expect_FALSE,
       public.can_request_project_transition(:'proj'::uuid) as request_expect_TRUE;

-- ⚠️ `request_expect_TRUE` هي الفحص المضادّ للتفريغ: لو كانت **كلّها** false
--    فقد يكون السبب أن الجلسة غير مُسنَدة على المشروع أصلًا، لا أن الحماية تعمل.


-- ═══ §ب · بحساب المالك — نفس الاستعلام، والنتيجة معكوسة ════════════════════
-- أعد تشغيل §أ بجلسة المالك. المتوقَّع: الخمسة الأولى **true**.
-- لو بقيت false للمالك فهذا انحدار خطير — أبلغني ولا تُكمل.


-- ═══ §ج · الثغرة الأصلية مُغلقة؟ ═══════════════════════════════════════════
-- بحساب المونتير، وعلى مخرج **يملك الوصول إليه**، جرّب من البوابة:
--   • نقله بين المراحل            ⇒ يجب أن يُرفض (forbidden_stage_move)
--   • إظهاره للعميل               ⇒ يجب أن يُرفض
--   • نقله إلى approved            ⇒ يجب أن يُرفض
--   • رفع نسخة                     ⇒ يجب أن **ينجح**
--   • إرساله إلى internal_review   ⇒ يجب أن **ينجح**
--   • إنشاء «طلب انتقال»           ⇒ يجب أن **ينجح** ولا يغيّر المخرج
-- الرفض يجب أن يأتي برسالة صلاحية واضحة، لا بـ«الترحيل معلّق» ولا بخطأ SQL خام.

select 'ج · حالة المخرج بعد المحاولات' as check,
       d.id, d.status, d.client_visible, d.stage_id
  from public.deliverables d
 where d.project_id = :'proj'::uuid
    or d.stage_id in (select id from public.projects where parent_project_id = :'proj'::uuid)
 order by d.created_at desc limit 10;
-- المتوقَّع: لم يتغيّر شيء بفعل المحاولات المرفوضة.


-- ═══ §د · طلبات الانتقال ═══════════════════════════════════════════════════
select 'د · الطلبات' as check, r.id, r.kind, r.from_value, r.to_value,
       r.status, r.requested_by, r.decided_by, r.executed_at
  from public.project_transition_requests r
 where r.project_id = :'proj'::uuid
 order by r.created_at desc limit 10;
-- بحساب المونتير: يرى طلباته. بحساب العميل: **صفر صفوف**.
-- بعد قبول المالك: status='approved' و executed_at غير فارغ ومرّة واحدة.


-- ════════════════════════════════════════════════════════════════════════════
-- الحالة الصادقة إلى أن يُشغَّل هذا الملفّ بجلستَي مونتير ومالك:
--   STATIC SERVER GUARDS: VERIFIED
--   LIVE ROLE BEHAVIOR:   PRODUCTION MANUAL ACCEPTANCE REQUIRED
-- ════════════════════════════════════════════════════════════════════════════
