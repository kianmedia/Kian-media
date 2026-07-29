-- ════════════════════════════════════════════════════════════════════════════
-- project_editor_permissions_PREFLIGHT.sql            (READ-ONLY — لا يكتب شيئًا)
--
-- الغرض: إثبات الحالة القائمة قبل تشغيل project_editor_permissions_RUNME.sql.
-- لا CREATE ولا ALTER ولا UPDATE هنا. نفّذ الاستعلامات وقارن بالنتيجة المتوقّعة.
--
-- ترتيب التشغيل الكلّي:
--   1) project_editor_permissions_{PREFLIGHT,RUNME,POSTCHECK}.sql   ← أوّلًا (يغلق الثغرة)
--   2) project_transition_approval_{PREFLIGHT,RUNME,POSTCHECK}.sql  ← ثانيًا (يعتمد على المسنَدات)
--
-- ملاحظة منهجية: عند مطابقة نصّ مُفكَّك (pg_get_functiondef / pg_get_expr /
-- pg_policies.qual / pg_get_constraintdef) استعمل ilike دائمًا — المُفكِّك يرفع
-- حالة الكلمات المحجوزة (COALESCE) وقد سبق أن سبّبت مطابقةٌ حسّاسةٌ للحالة إخفاقًا
-- كاذبًا هنا. نفضّل information_schema / pg_proc على مطابقة النصّ حيثما أمكن.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الدوالّ الأساسية التي يعتمد عليها RUNME موجودة ───────────────────────
-- متوقّع: 12 صفًّا، وكل exists_now = true. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.is_admin()'),
  ('public.is_owner()'),
  ('public.is_staff()'),
  ('public.staff_role()'),
  ('public.project_role(uuid)'),
  ('public.is_kian_member(uuid)'),
  ('public.can_manage_projects()'),
  ('public.can_edit_project(uuid)'),
  ('public.can_final_deliver()'),
  ('public.emp_has_permission(text)'),
  ('public.project_units_can_write(uuid)'),
  ('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')
) f(sig);

-- ─── 2) إثبات سلسلة الثغرة كما هي الآن ───────────────────────────────────────
-- متوقّع: is_kian_member: mentions_kian_prefix=true, calls_project_role=true
--         (أيّ دور kian_* يمرّ، ومنه kian_editor)
--         project_units_can_write: calls_is_kian_member=true.
-- (نستعمل position/strpos لا LIKE هنا تجنّبًا لرموز الهروب في النمط.)
select p.proname,
       strpos(pg_get_functiondef(p.oid), 'kian')           > 0 as mentions_kian_prefix,
       strpos(pg_get_functiondef(p.oid), 'project_role')   > 0 as calls_project_role,
       strpos(pg_get_functiondef(p.oid), 'is_kian_member') > 0 as calls_is_kian_member
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_kian_member','project_units_can_write');

-- ─── 3) القائمة البيضاء الحالية لمفاتيح p_patch ─────────────────────────────
-- متوقّع: has_stage_id / has_status / has_client_visible = true (هذه هي المفاتيح
--         الثلاثة الممنوعة على المحرِّر) و has_capability_gate = false قبل الإصلاح.
select
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''stage_id''%'        as has_stage_id,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''status''%'          as has_status,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%''client_visible''%'  as has_client_visible,
  pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) ilike '%can_move_deliverable%' as has_capability_gate;

-- ─── 4) can_manage_projects لا يشمل المحرِّر (تحقّق من الادّعاء، لا تفترضه) ──
-- متوقّع: mentions_editor = false في كلّ التعريفات الحيّة.
select p.oid::regprocedure::text as sig,
       pg_get_functiondef(p.oid) ilike '%editor%' as mentions_editor
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'can_manage_projects';

-- ─── 5) RLS على deliverables: لا سياسة UPDATE مسموحة لغير is_admin ──────────
-- متوقّع: لا صفّ بـ cmd='UPDATE' أو 'ALL' إلّا سياسة الإدارة (qual تذكر is_admin).
-- هذا يثبت أنّ PATCH مباشرًا عبر PostgREST محجوب أصلًا، وأنّ الثغرة في الـRPC
-- ذي SECURITY DEFINER وحده.
select policyname, cmd, permissive,
       coalesce(qual,'') ilike '%is_admin%' as qual_has_is_admin,
       coalesce(qual,'') as qual_text
from pg_policies where schemaname='public' and tablename='deliverables'
order by cmd, policyname;

-- ─── 6) مفاتيح الصلاحيات الجديدة غير موجودة بعد ─────────────────────────────
-- متوقّع: 0 صفوف قبل التشغيل (٦ مفاتيح بعده).
select key, category, sensitivity from public.permissions
where key in ('transitions.request','transitions.approve','projects.move_stage',
              'deliverables.move_stage','deliverables.set_client_visible','deliverables.finalize')
order by key;

-- ─── 6b) المنح الثاني: هل تقبل project_core_set_stage مُسنَد المحرِّر؟ ───────
-- متوقّع قبل الإصلاح: gates_on_can_edit_project = true
--   (can_edit_project = مدير مشاريع أو staff_role='editor' مع project_role='kian_editor'
--    ⇒ المونتير المسنَد يحرّك **مرحلة المشروع** نفسها، لا المخرجات وحدها).
-- بعد §4 من RUNME: false، و gates_on_new_predicate = true.
select
  pg_get_functiondef(to_regprocedure('public.project_core_set_stage(uuid,text,text)')) ilike '%can_edit_project%'      as gates_on_can_edit_project,
  pg_get_functiondef(to_regprocedure('public.project_core_set_stage(uuid,text,text)')) ilike '%can_move_project_stage%' as gates_on_new_predicate;

-- ─── 6d) المساران الثالث والرابع لنفس الثغرة (تدقيق can_edit_project) ──────
-- متوقّع قبل الإصلاح: guarded = false في الثلاثة، أي:
--   pc_deliverable_review  → send_client يكشف للعميل و approve يعتمد، بلا قدرة.
--   staff_set_deliverable  → يسمح صراحةً بـ'client_review' و'approved'.
--   staff_add_deliverable  → ينشئ مخرجًا مباشرةً في 'client_review'.
-- بعد RUNME: true في الثلاثة (أو الدالّة غائبة في هذه البيئة).
select f.sig,
       (to_regprocedure(f.sig) is not null) as exists_now,
       coalesce(pg_get_functiondef(to_regprocedure(f.sig)) ilike '%can_send_to_client_review%'
             or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%can_finalize_deliverable%', false) as guarded
from (values ('public.pc_deliverable_review(uuid,text,text,boolean)'),
             ('public.staff_set_deliverable(uuid,text,text,text)'),
             ('public.staff_add_deliverable(uuid,text,text,text,text,text)')) f(sig);

-- ─── 6c) لا تُضيَّق المُسنَدات المشتركة: احصِ مواضع الاعتماد قبل أيّ تغيير ──
-- متوقّع: أرقام غير صفرية (can_edit_project مستعملة في عشرات الدوالّ) — وهي
-- **الدليل** على أنّ إعادة تعريفها ممنوعة؛ الإصلاح يضيف مُسنَدات جديدة بدلها.
select count(*) as functions_depending_on_can_edit_project
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prokind='f'
  and p.proname <> 'can_edit_project'
  and pg_get_functiondef(p.oid) ilike '%can_edit_project(%';

-- ─── 7) المسنَدات الجديدة غير موجودة بعد ────────────────────────────────────
-- متوقّع: 6 صفوف وكلّها exists_now = false.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.can_request_project_transition(uuid)'),
  ('public.can_approve_project_transition(uuid)'),
  ('public.can_move_deliverable(uuid)'),
  ('public.can_send_to_client_review(uuid)'),
  ('public.can_finalize_deliverable(uuid)'),
  ('public.can_move_project_stage(uuid)')
) f(sig);

-- ─── 8) مفردات حالة deliverables (لا تخترع قيمًا خارجها) ────────────────────
-- متوقّع: القيد يذكر draft/internal_review/client_review/revision_requested/
--         approved/final_delivered/archived.
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con
where con.conrelid = 'public.deliverables'::regclass and con.contype='c'
  and pg_get_constraintdef(con.oid) ilike '%status%';

-- ─── 9) لا صلاحية تنفيذ لـ anon على الدالّة الهدف ───────────────────────────
-- متوقّع: anon_can_execute = false (وإن كان true فهذه ملاحظة حرجة مستقلّة).
select has_function_privilege('anon',
  'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)','EXECUTE') as anon_can_execute;
