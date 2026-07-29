-- ════════════════════════════════════════════════════════════════════════════
-- project_transition_approval_PREFLIGHT.sql            (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ قبل project_transition_approval_RUNME.sql و**بعد** حزمة صلاحيات
-- المحرِّر (المُسنَدات الجديدة شرطٌ لهذه الحزمة).
--
-- ترتيب التشغيل الكلّي:
--   1) project_editor_permissions_{PREFLIGHT,RUNME,POSTCHECK}.sql
--   2) project_transition_approval_{PREFLIGHT,RUNME,POSTCHECK}.sql   ← أنت هنا
--
-- منهج المطابقة: ilike دائمًا مع pg_get_functiondef/pg_get_constraintdef/qual
-- (المُفكِّك يرفع حالة COALESCE)، وinformation_schema بدل مطابقة النصّ حيثما أمكن.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) اعتمادات إلزامية موجودة ────────────────────────────────────────────
-- متوقّع: 14 صفًّا، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.is_admin()'),
  ('public.is_staff()'),
  ('public.can_manage_projects()'),
  ('public.pc_can_read_project(uuid)'),
  ('public.pc_log(uuid,text,text,uuid,jsonb)'),
  ('public.notify(uuid,text,text,text,uuid,text,text)'),
  ('public.project_hierarchy_root(uuid)'),
  ('public.project_core_set_stage(uuid,text,text)'),
  -- من حزمة صلاحيات المحرِّر (الخطوة 1) — غيابها يعني أنّك تشغّل بترتيب خاطئ
  ('public.can_request_project_transition(uuid)'),
  ('public.can_approve_project_transition(uuid)'),
  ('public.can_move_deliverable(uuid)'),
  ('public.can_send_to_client_review(uuid)'),
  ('public.can_finalize_deliverable(uuid)'),
  ('public.can_move_project_stage(uuid)')
) f(sig);

-- ─── 2) الجداول المرجعية موجودة ────────────────────────────────────────────
-- متوقّع: 5 صفوف وكلّها present = true.
select t.name, (to_regclass(t.name) is not null) as present
from (values ('public.projects'),('public.deliverables'),('public.project_core'),
             ('public.project_members'),('public.profiles')) t(name);

-- ─── 3) أعمدة يعتمد عليها المُنفِّذ ────────────────────────────────────────
-- متوقّع: 6 صفوف وكلّها present = true.
select c.tbl, c.col,
       (select count(*) from information_schema.columns i
         where i.table_schema='public' and i.table_name=c.tbl and i.column_name=c.col) = 1 as present
from (values ('deliverables','status'),('deliverables','client_visible'),
             ('deliverables','stage_id'),('deliverables','is_deleted'),
             ('project_core','core_stage'),('projects','client_id')) c(tbl,col);

-- ─── 4) مفردات الحالات — لا تُخترع قيمة خارجها ─────────────────────────────
-- متوقّع: قيد deliverables يذكر draft/internal_review/client_review/
--         revision_requested/approved/final_delivered/archived.
select con.conname, pg_get_constraintdef(con.oid) as def
from pg_constraint con
where con.conrelid = 'public.deliverables'::regclass and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%status%';

-- متوقّع: القيمة الحيّة لـcore_stage محصورة في الـ13 مرحلة المعروفة.
select distinct core_stage from public.project_core order by 1;

-- ─── 5) الجدول والدوالّ الجديدة غير موجودة بعد ─────────────────────────────
-- متوقّع: table_present = false.
select (to_regclass('public.project_transition_requests') is not null) as table_present;

-- متوقّع: 5 صفوف وكلّها exists_now = false قبل التشغيل.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)'),
  ('public.project_transition_requests_list(uuid,text,int)'),
  ('public.project_transition_request_decide(uuid,text,text,boolean)'),
  ('public.project_transition_can_decide(uuid)'),
  ('public.project_transition_requests_expire(int)')
) f(sig);

-- ─── 6) لا نظام موازٍ: الجداول القائمة ودورها (قرار إعادة الاستخدام) ───────
-- متوقّع: الثلاثة موجودة. قُرِئت جميعًا وتُركت كما هي:
--   project_approvals        = توقيع/اعتماد عامّ (kind: internal/manager/client)
--                              بلا from/to ولا تنفيذ ولا مرّة-واحدة.
--   project_change_requests  = حوكمة تغيير النطاق/الجدول (11 حالة، أثر مالي،
--                              خطة تنفيذ) — معناها إداريّ لا آليّ.
--   project_decisions        = سجلّ قرارات.
-- لا واحد منها يحمل «الحالة الحالية → الحالة المطلوبة + تنفيذ ذرّيّ مرّة واحدة»،
-- وحشو ذلك فيها يُفسد معناها. لذلك جدول جديد **واحد**، ويظلّ الاعتماد العامّ
-- والتغيير الإداريّ كما هما بلا ازدواج.
select t.name, (to_regclass(t.name) is not null) as present
from (values ('public.project_approvals'),
             ('public.project_change_requests'),
             ('public.project_decisions')) t(name);

-- متوقّع (توثيقيّ): أعمدة project_approvals لا تشمل from/to ولا executed_at.
select column_name from information_schema.columns
where table_schema='public' and table_name='project_approvals' order by ordinal_position;

-- ─── 7) حماية ما بعد الإغلاق (إن كانت مطبَّقة) ─────────────────────────────
-- متوقّع: exists_now = true إن كانت الحماية مطبَّقة. غيابها ليس مانعًا:
-- RUNME يفحصها ديناميكيًّا ويكتفي بقواعد المشروع القائمة.
select (to_regprocedure('public.pc_project_is_closed(uuid)') is not null) as post_closure_guard_present;

-- ─── 8) حارس ربط المخرج بالمرحلة قائم (المُنفِّذ يعتمد عليه لا يستبدله) ────
-- متوقّع: صفّ واحد لـtrg_deliverables_stage_guard.
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.deliverables'::regclass and not tgisinternal
order by tgname;

-- ─── 9) لا صلاحية anon على أيّ شيء سنبنيه فوقه ─────────────────────────────
-- متوقّع: false في كلّ صفّ.
select f.sig, has_function_privilege('anon', f.sig, 'EXECUTE') as anon_exec
from (values ('public.can_approve_project_transition(uuid)'),
             ('public.project_core_set_stage(uuid,text,text)')) f(sig)
where to_regprocedure(f.sig) is not null;
