-- ════════════════════════════════════════════════════════════════════════════
-- project_editor_permissions_POSTCHECK.sql            (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ بعد project_editor_permissions_RUNME.sql. لا CREATE ولا ALTER ولا
-- UPDATE ولا نداء لأيّ دالّة تكتب. كل استعلام مسبوق بنتيجته المتوقّعة؛ أيّ
-- انحراف = لا تُكمل إلى حزمة طلبات الانتقال.
--
-- منهج المطابقة: pg_get_functiondef مُفكَّك يرفع حالة الكلمات المحجوزة
-- (COALESCE) ⇒ **ilike دائمًا**، وnformation_schema حيثما أمكن بدل النصّ.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) المُسنَدات الستّة أُنشئت ─────────────────────────────────────────────
-- متوقّع: 6 صفوف، exists_now = true في كلّها.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.can_move_deliverable(uuid)'),
  ('public.can_send_to_client_review(uuid)'),
  ('public.can_finalize_deliverable(uuid)'),
  ('public.can_move_project_stage(uuid)'),
  ('public.can_request_project_transition(uuid)'),
  ('public.can_approve_project_transition(uuid)')
) f(sig);

-- ─── 2) لا واحد منها يعيد NULL (سبب حادثة fail-open سابقة) ─────────────────
-- متوقّع: كل الأعمدة الستّة = false (أي «ليست NULL»)، وكلّها تُقيَّم بلا خطأ.
select
  public.can_move_deliverable(null)           is null as p1_null,
  public.can_send_to_client_review(null)      is null as p2_null,
  public.can_finalize_deliverable(null)       is null as p3_null,
  public.can_move_project_stage(null)         is null as p4_null,
  public.can_request_project_transition(null) is null as p5_null,
  public.can_approve_project_transition(null) is null as p6_null;

-- ─── 3) ★ الإصلاح الحرج ★ الحرّاس داخل جسم الدالّة الجماعية ─────────────────
-- متوقّع: الأعمدة الثلاثة الأولى true (الحرّاس مركّبة)،
--         والثلاثة الأخيرة true أيضًا (المفاتيح **لم تُحذف** — المالك يحتفظ بها).
select
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%can_move_deliverable%'      as guards_stage_id,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%can_send_to_client_review%' as guards_client_visible,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%can_finalize_deliverable%'  as guards_status,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''stage_id''%'              as key_stage_id_kept,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''client_visible''%'        as key_client_visible_kept,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''status''%'                as key_status_kept;

-- ─── 4) المنح الثاني (مرحلة المشروع) ────────────────────────────────────────
-- متوقّع: still_gates_on_can_edit_project = false · gates_on_new_predicate = true.
-- إن كانت الأولى true فإنّ §4 تُخطّي (راجع NOTICE مخرجات RUNME): الثغرة الأولى
-- مُغلَقة لكن المونتير ما زال يحرّك مرحلة المشروع — عالِج ذلك قبل الاعتماد.
select
  pg_get_functiondef(to_regprocedure('public.project_core_set_stage(uuid,text,text)')) ilike '%can_edit_project%'       as still_gates_on_can_edit_project,
  pg_get_functiondef(to_regprocedure('public.project_core_set_stage(uuid,text,text)')) ilike '%can_move_project_stage%' as gates_on_new_predicate;

-- ─── 4b) المساران الثالث والرابع (§4b/§4c) ────────────────────────────────
-- متوقّع: guarded = true في الثلاثة (أو exists_now = false إن كانت غائبة).
-- أيّ false مع exists_now = true ⇒ المونتير ما زال يكشف للعميل أو يعتمد من
-- شاشة أخرى، وكلّ ما سبق يصبح بلا أثر عمليّ.
select f.sig,
       (to_regprocedure(f.sig) is not null) as exists_now,
       coalesce(pg_get_functiondef(to_regprocedure(f.sig)) ilike '%can_send_to_client_review%'
             or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%can_finalize_deliverable%', false) as guarded
from (values ('public.pc_deliverable_review(uuid,text,text,boolean)'),
             ('public.staff_set_deliverable(uuid,text,text,text)'),
             ('public.staff_add_deliverable(uuid,text,text,text,text,text)')) f(sig);

-- متوقّع: true — مسارات المونتير المشروعة لم تُحذف (draft/internal_review
-- و revision_requested ما زالت مقبولة، والتسليم النهائي ما زال بـcan_final_deliver).
select
  pg_get_functiondef(to_regprocedure('public.staff_set_deliverable(uuid,text,text,text)')) ilike '%internal_review%'    as editor_path_kept,
  pg_get_functiondef(to_regprocedure('public.staff_set_deliverable(uuid,text,text,text)')) ilike '%can_final_deliver%'  as final_gate_kept,
  pg_get_functiondef(to_regprocedure('public.pc_deliverable_review(uuid,text,text,boolean)')) ilike '%already_final%'   as review_guards_kept;

-- ─── 5) المُسنَدات المشتركة **لم تُمسّ** (تحقّق من عدم كسر شيء) ─────────────
-- متوقّع: can_manage_projects لا تذكر editor · can_edit_project ما زالت تذكره
--         (لم نضيّقها) · project_units_can_write ما زالت تنادي is_kian_member.
select
  pg_get_functiondef(to_regprocedure('public.can_manage_projects()'))        ilike '%editor%'         as cmp_mentions_editor,
  pg_get_functiondef(to_regprocedure('public.can_edit_project(uuid)'))       ilike '%editor%'         as cep_still_mentions_editor,
  pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)'))ilike '%is_kian_member%' as puw_unchanged;

-- ─── 6) الصلاحيات: لا شيء لـanon · authenticated يُنفّذ ─────────────────────
-- متوقّع: anon_exec = false في كلّ صفّ · auth_exec = true في كلّ صفّ.
select f.sig,
       has_function_privilege('anon',          f.sig, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', f.sig, 'EXECUTE') as auth_exec
from (values
  ('public.can_move_deliverable(uuid)'),
  ('public.can_send_to_client_review(uuid)'),
  ('public.can_finalize_deliverable(uuid)'),
  ('public.can_move_project_stage(uuid)'),
  ('public.can_request_project_transition(uuid)'),
  ('public.can_approve_project_transition(uuid)'),
  ('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')
) f(sig)
where to_regprocedure(f.sig) is not null;

-- ─── 7) مفاتيح الكتالوج الستّة موجودة وحسّاسة حيث يجب ───────────────────────
-- متوقّع: 6 صفوف. transitions.request = normal، والخمسة الباقية sensitive.
select key, category, sensitivity from public.permissions
where key in ('transitions.request','transitions.approve','projects.move_stage',
              'deliverables.move_stage','deliverables.set_client_visible','deliverables.finalize')
order by key;

-- ─── 8) جدول النسخ الاحتياطية للتعريفات مُقفل ──────────────────────────────
-- متوقّع: rls_enabled = true · policy_count = 0 · anon/authenticated select = false.
select
  (select relrowsecurity from pg_class where oid = 'public.project_authz_fn_backup'::regclass) as rls_enabled,
  (select count(*) from pg_policies where schemaname='public' and tablename='project_authz_fn_backup') as policy_count,
  has_table_privilege('anon','public.project_authz_fn_backup','SELECT')          as anon_select,
  has_table_privilege('authenticated','public.project_authz_fn_backup','SELECT') as auth_select;

-- متوقّع: صفّان (أو صفّ واحد إن كانت project_core_set_stage غائبة) بلا نصّ مكشوف.
select fn_signature, length(fn_definition) as def_len, captured_at
from public.project_authz_fn_backup order by fn_signature;

-- ─── 9) لا تغيير على حقوق العميل ───────────────────────────────────────────
-- متوقّع: سياسة قراءة deliverables ما زالت تشترط client_visible للعميل،
--         ولا سياسة UPDATE/ALL لغير is_admin.
select policyname, cmd,
       coalesce(qual,'') ilike '%client_visible%' as qual_has_client_visible,
       coalesce(qual,'') ilike '%is_admin%'       as qual_has_is_admin
from pg_policies where schemaname='public' and tablename='deliverables'
order by cmd, policyname;

-- ─── 10) مسار فحص التوفّر — **فحص نصّيّ لا نداء حيّ** ──────────────────────
--
-- ★ هنا سقط هذا الملفّ على الإنتاج، والسبب في **الفاحص** لا في الترحيل. ★
--   كان السطر: select public.large_project_deliverables_bulk_update('{}','{}',null,true);
--   وأوّل سطر في جسم الدالّة: if auth.uid() is null then raise 'not authorized'.
--   ومحرّر SQL يعمل بدور `postgres` بلا جلسة GoTrue ⇒ auth.uid() = NULL دائمًا.
--   وصفتُه سابقًا بأنه «نداء آمن بلا أثر» — وهو كذلك من حيث الكتابة، لكنه
--   **غير قابل للتنفيذ** من هذا السياق أصلًا. الوصف كان ناقصًا، والخطأ خطئي.
--
--   ⛔ لا استثناء لـpostgres داخل الدالّة الإنتاجية لإرضاء فاحص.
--   ⛔ ولا `exception when others then null` — فيصير الفحص ناجحًا مهما حدث.
--   ✅ نُثبت نصًّا أن المسار قائم وأن بوّابة الجلسة تسبقه.
--
-- متوقّع: fast_path_present = true · session_gate_present = true · gate_first = true.
select
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'))
    ilike '%cardinality(v_ids) = 0%'                                   as fast_path_present,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'))
    ilike '%auth.uid() is null%'                                       as session_gate_present,
  position('auth.uid() is null' in
    pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')))
  < position('cardinality(v_ids) = 0' in
    pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')))
                                                                       as gate_before_fast_path;

-- السلوك الحيّ (المونتير يُمنع · المالك يُسمح) لا يُثبت من هنا إطلاقًا.
-- شغّل بجلستَين حقيقيّتين: docs/project_editor_permissions_BEHAVIOR_DIAGNOSTIC.sql

-- ─── 11) عدّاد أمان: لا مخرجات تغيّرت أثناء التشغيل ────────────────────────
-- متوقّع: صفر صفوف — الحزمة لا تلمس بيانات المخرجات إطلاقًا.
select count(*) as deliverables_touched_by_this_package
from public.activity_log
where action in ('deliverables.bulk_update')
  and created_at > (select coalesce(max(captured_at), now()) from public.project_authz_fn_backup);
