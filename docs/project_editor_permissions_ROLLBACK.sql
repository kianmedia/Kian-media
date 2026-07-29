-- ════════════════════════════════════════════════════════════════════════════
-- project_editor_permissions_ROLLBACK.sql
--
-- ⚠️⚠️ اقرأ قبل التشغيل — تراجعٌ صادق لا تجميليّ ⚠️⚠️
--   §1 يستعيد التعريفات الخمسة السابقة، و§2 يحذف المُسنَدات ⇒ يعود للمونتير
--   (staff_role='editor' بدور مشروع kian_editor) — **على الخادم** — نقلُ
--   المخرجات بين المراحل، وقفزُ حالتها إلى معتمد/سُلِّم نهائيًّا، وكشفُها
--   للعميل، وتحريكُ مرحلة المشروع، من **أربع** شاشات لا واحدة.
--   أي أنّه **يعيد فتح الثغرة الأمنية بالكامل**.
--   لا تُشغّله إلّا إذا كسر الإصلاح عملًا مشروعًا ولم يمكن علاجه بالمنح الدقيق.
--
--   ★ البديل شبه دائمًا أفضل: بدل التراجع، امنح الشخص المعنيّ المفتاح المحدَّد
--     (deliverables.move_stage / deliverables.set_client_visible /
--      deliverables.finalize / projects.move_stage) عبر شاشة الصلاحيات
--     الحبيبية القائمة. هذا يعيد القدرة لمن يحتاجها **وحده** بدل الجميع.
--
-- ترتيب إلزاميّ: إن كانت حزمة طلبات الانتقال مطبَّقة، شغّل
--   project_transition_approval_ROLLBACK.sql **أوّلًا** — دوالّها تعتمد على
--   can_approve_project_transition و can_request_project_transition، وحذفهما
--   قبلها يترك دوالّ مكسورة.
--
-- ما لا يفعله هذا الملفّ (عمدًا):
--   • لا يحذف صفًّا واحدًا من أيّ جدول بيانات.
--   • لا يحذف مفاتيح الصلاحيات من الكتالوج: مفتاح غير مستعمَل غير ضارّ، وحذفه
--     يُسقِط منحًا صريحة أعطاها المالك لأشخاص (employee_permission_overrides /
--     profession_permissions) ⇒ فقدان تهيئة لا يمكن استرجاعها. احذفها يدويًّا
--     من الشاشة إن أردت.
--   • لا يمسّ can_manage_projects ولا can_edit_project ولا
--     project_units_can_write — لم تُعدَّل أصلًا.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) استعادة التعريفات الحيّة المحفوظة قبل الجَبّ (§0 من RUNME)
--     المصدر هو النصّ الملتقط من قاعدة البيانات نفسها، لا نسخة من ملفّ.
--     غياب النسخة ⇒ لا استعادة عمياء: نرفع خطأً بدل التخمين.
-- ════════════════════════════════════════════════════════════════════════════
do $restore$
declare s text; d text; v_missing text := '';
begin
  if to_regclass('public.project_authz_fn_backup') is null then
    raise exception 'ROLLBACK: جدول النسخ الاحتياطية غير موجود — لم يُشغَّل RUNME أو حُذف الجدول. لا استعادة عمياء.';
  end if;

  foreach s in array array[
    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)',
    'public.project_core_set_stage(uuid,text,text)',
    'public.pc_deliverable_review(uuid,text,text,boolean)',
    'public.staff_set_deliverable(uuid,text,text,text)',
    'public.staff_add_deliverable(uuid,text,text,text,text,text)'
  ] loop
    select b.fn_definition into d
      from public.project_authz_fn_backup b
     where b.fn_signature = s
     order by b.captured_at asc limit 1;      -- أقدم التقاط = ما قبل أوّل جَبّ
    if d is null then
      v_missing := v_missing || ' ' || s;
      continue;
    end if;
    execute d;
    raise notice 'ROLLBACK: استُعيد التعريف السابق لـ%', s;
  end loop;

  if v_missing <> '' then
    raise notice 'ROLLBACK: لا نسخة محفوظة لـ% — بقيت النسخة الحالية كما هي (لم تُلمس).', v_missing;
  end if;
end $restore$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) حذف المُسنَدات الجديدة
--     يُحذف فقط ما لا تعتمد عليه دالّة أخرى. drop ... restrict (الافتراضي)
--     يفشل صراحةً بدل أن يجرّ معه كائنات لم يطلب أحد حذفها — وهذا مقصود.
-- ════════════════════════════════════════════════════════════════════════════
do $drop$
declare f text; v_dep int;
begin
  foreach f in array array[
    'public.can_move_deliverable(uuid)',
    'public.can_send_to_client_review(uuid)',
    'public.can_finalize_deliverable(uuid)',
    'public.can_move_project_stage(uuid)',
    'public.can_request_project_transition(uuid)',
    'public.can_approve_project_transition(uuid)'
  ] loop
    if to_regprocedure(f) is null then continue; end if;

    -- هل ما زالت دالّة حيّة تناديها؟ (حزمة الانتقال مثلًا)
    select count(*) into v_dep
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.oid <> to_regprocedure(f)::oid
       and pg_get_functiondef(p.oid) ilike '%' || split_part(split_part(f,'.',2),'(',1) || '(%';
    if v_dep > 0 then
      raise notice 'ROLLBACK: % ما زالت مستعمَلة في % دالّة — لم تُحذف. شغّل تراجع حزمة الانتقال أوّلًا.', f, v_dep;
      continue;
    end if;

    execute format('drop function if exists %s', f);
    raise notice 'ROLLBACK: حُذفت %', f;
  end loop;
end $drop$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- تحقّق بعد التراجع (READ-ONLY) — متوقّع:
--   • guards_gone = true   (الحرّاس اختفت من جسم الدالّة الجماعية)
--   • keys_present = true  (المفاتيح الاثنا عشر ما زالت كلّها موجودة)
--   ⇒ وهذا يعني حرفيًّا: **الثغرة مفتوحة من جديد**.
-- ════════════════════════════════════════════════════════════════════════════
select
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) not ilike '%can_move_deliverable%' as guards_gone,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''stage_id''%'             as keys_present;

-- جدول النسخ الاحتياطية يبقى — سجلّ تدقيق لما كان عليه النظام. لحذفه يدويًّا:
--   drop table public.project_authz_fn_backup;
