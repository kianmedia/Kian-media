-- ════════════════════════════════════════════════════════════════════════════
-- project_transition_approval_ROLLBACK.sql
--
-- ⚠️ ماذا يفعل هذا التراجع فعلًا — بصراحة:
--   يحذف الدوالّ الخمس (والدوالّ الداخلية والمحفِّز) ⇒ **يختفي المسار البديل**
--   الذي يمنح المنفِّذ طريقة مشروعة لطلب نقل مخرج أو تغيير حالته أو إظهاره.
--   حزمة صلاحيات المحرِّر تبقى سارية ⇒ الممنوع يبقى ممنوعًا، لكن بلا بديل:
--   على المدير/المالك أن ينفّذ هذه الإجراءات بنفسه. هذا **تعطيل عمل** لا ثغرة.
--   الاتجاه آمن لكنّه مكلف — لا تُشغّله إلّا لسبب.
--
--   إن كان المطلوب فتح الصلاحية للمنفِّذ من جديد فهذا ملفّ خاطئ:
--   المكان هو منح المفتاح الدقيق من شاشة الصلاحيات، أو — كحلّ أخير —
--   project_editor_permissions_ROLLBACK.sql (وهو يعيد فتح الثغرة).
--
-- ★ البيانات: هذا الملفّ **لا يحذف أيّ صفّ**. جدول
--   project_transition_requests سجلّ تدقيق: من طلب ماذا ومتى ومن اعتمد وماذا
--   نُفِّذ. حذفه يمحو تاريخًا لا يمكن استرجاعه، ولذلك هو **معطَّل** في §3
--   ويحتاج إزالة التعليق يدويًّا بقرار واعٍ.
--
-- الترتيب: شغّل هذا الملفّ **قبل** project_editor_permissions_ROLLBACK.sql
--   (دوالّ هذه الحزمة تنادي can_approve_project_transition و
--    can_request_project_transition؛ حذف المُسنَدات أوّلًا يترك دوالّ مكسورة).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الدوالّ العامّة (العقد مع الواجهة)
--     الواجهة تكتشف غيابها وتهبط إلى حالة «معطَّل» عربية صريحة بدل الانهيار،
--     ولذلك حذفها آمن على الواجهة وإن كان مكلفًا تشغيليًّا.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean);
drop function if exists public.project_transition_requests_list(uuid,text,int);
drop function if exists public.project_transition_request_decide(uuid,text,text,boolean);
drop function if exists public.project_transition_can_decide(uuid);
drop function if exists public.project_transition_requests_expire(int);

-- ════════════════════════════════════════════════════════════════════════════
-- §2) الدوالّ الداخلية والمحفِّز
--     المحفِّز يُحذف قبل دالّته (وإلّا فشل الحذف بـdependency).
-- ════════════════════════════════════════════════════════════════════════════
do $t$
begin
  if to_regclass('public.project_transition_requests') is not null then
    execute 'drop trigger if exists trg_ptr_touch on public.project_transition_requests';
  end if;
end $t$;

drop function if exists public.ptr_touch_updated_at();
drop function if exists public.ptr_current_value(text,uuid,uuid);
drop function if exists public.ptr_target_check(text,uuid,uuid,text);
drop function if exists public.ptr_project_blocked(uuid);

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجدول — **لا يُحذف** (سجلّ تدقيق)
--     الجدول يبقى بسياسة القراءة نفسها: الكوادر المخوَّلون يرون التاريخ،
--     ولا كتابة لأحد (لا سياسة كتابة أصلًا، والدوالّ اختفت) ⇒ سجلّ مجمَّد.
--     لحذفه نهائيًّا — وهذا يمحو التاريخ بلا رجعة — أزل التعليق يدويًّا:
--
--   -- drop table public.project_transition_requests;
--
--     (بديل أنظف قبل الحذف: احتفظ بنسخة —
--        create table public.project_transition_requests_archive as
--          select * from public.project_transition_requests; )
-- ════════════════════════════════════════════════════════════════════════════

-- مفاتيح الصلاحيات (transitions.request / transitions.approve) **لا تُحذف**:
-- حذف المفتاح يُسقط منحًا صريحة أعطاها المالك لأشخاص (تهيئة لا تُسترجَع).
-- مفتاح بلا مستهلك غير ضارّ؛ عطِّله من الشاشة إن أزعج.

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- تحقّق بعد التراجع (READ-ONLY) — متوقّع:
--   • fns_remaining = 0        (الدوالّ الخمس اختفت)
--   • table_present = true     (السجلّ محفوظ)
--   • rows_preserved = العدد نفسه قبل التراجع
--   • write_policies = 0       (الجدول بقي بلا كتابة مباشرة)
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from (values
     ('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)'),
     ('public.project_transition_requests_list(uuid,text,int)'),
     ('public.project_transition_request_decide(uuid,text,text,boolean)'),
     ('public.project_transition_can_decide(uuid)'),
     ('public.project_transition_requests_expire(int)')
   ) f(sig) where to_regprocedure(f.sig) is not null)                       as fns_remaining,
  (to_regclass('public.project_transition_requests') is not null)           as table_present,
  (select count(*) from public.project_transition_requests)                 as rows_preserved,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='project_transition_requests' and cmd <> 'SELECT')       as write_policies;
