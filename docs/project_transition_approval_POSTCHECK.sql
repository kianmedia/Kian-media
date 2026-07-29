-- ════════════════════════════════════════════════════════════════════════════
-- project_transition_approval_POSTCHECK.sql           (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ بعد project_transition_approval_RUNME.sql. لا CREATE/ALTER/UPDATE،
-- ولا نداء لأيّ دالّة تكتب: النداءات الوحيدة هنا إمّا p_dry_run (بلا أثر بحكم
-- التعريف، ويُثبَت ذلك بعدّ الصفوف قبل/بعد) أو دوالّ قراءة STABLE.
-- كل استعلام مسبوق بنتيجته المتوقّعة.
-- ملاحظة منهجية: ilike عند مطابقة أيّ نصّ مُفكَّك (COALESCE يُرفَع حالةً).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجدول والأعمدة المطلوبة ───────────────────────────────────────────
-- متوقّع: table_present = true.
select (to_regclass('public.project_transition_requests') is not null) as table_present;

-- متوقّع: 24 صفًّا present = true (لا عمود ناقص).
select c.col,
       (select count(*) from information_schema.columns i
         where i.table_schema='public' and i.table_name='project_transition_requests'
           and i.column_name=c.col) = 1 as present
from (values ('id'),('project_id'),('deliverable_id'),('target_type'),('target_id'),('kind'),
             ('from_value'),('to_value'),('from_parent_id'),('requested_parent_id'),
             ('reason'),('requested_by'),('requested_at'),('status'),
             ('decided_by'),('decided_at'),('decision_note'),('executed_at'),
             ('execution_result'),('request_snapshot'),('correlation_id'),
             ('expires_at'),('created_at'),('updated_at')) c(col)
order by c.col;

-- ─── 2) مفردات الحالة ونوع الانتقال مقيَّدة بـCHECK ────────────────────────
-- متوقّع: قيد status يذكر pending/approved/rejected/cancelled/expired،
--         وقيد kind يذكر project_stage/stage/status/client_visibility.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.project_transition_requests'::regclass and contype = 'c'
order by conname;

-- ─── 3) ★ الحارس القاطع ضدّ الازدواج ★ ─────────────────────────────────────
-- متوقّع: صفّ واحد اسمه uq_ptr_pending_target · is_unique = true ·
--         ويذكر «WHERE (status = 'pending')» (partial).
select indexname,
       indexdef ilike '%unique%'  as is_unique,
       indexdef ilike '%pending%' as is_partial_on_pending
from pg_indexes
where schemaname='public' and tablename='project_transition_requests'
order by indexname;

-- ─── 4) ★ RLS: قراءة مقيَّدة · **لا كتابة مباشرة لأحد** ★ ──────────────────
-- متوقّع: rls_enabled = true.
select relrowsecurity as rls_enabled, relforcerowsecurity as force_rls
from pg_class where oid = 'public.project_transition_requests'::regclass;

-- متوقّع: صفّ واحد فقط، cmd = 'SELECT'، وqual يذكر is_staff و pc_can_read_project.
-- أيّ صفّ بـcmd في (INSERT/UPDATE/DELETE/ALL) = خرق: الكتابة يجب أن تمرّ بالدوالّ.
select policyname, cmd,
       coalesce(qual,'') ilike '%is_staff%'             as qual_has_is_staff,
       coalesce(qual,'') ilike '%pc_can_read_project%'  as qual_has_project_scope
from pg_policies
where schemaname='public' and tablename='project_transition_requests'
order by cmd, policyname;

-- ─── 5) صلاحيات الجدول: لا شيء لـanon · قراءة فقط لـauthenticated ─────────
-- متوقّع: anon_* = false في الأربعة · auth_select = true ·
--         auth_insert/update/delete = false.
select
  has_table_privilege('anon','public.project_transition_requests','SELECT')          as anon_select,
  has_table_privilege('anon','public.project_transition_requests','INSERT')          as anon_insert,
  has_table_privilege('anon','public.project_transition_requests','UPDATE')          as anon_update,
  has_table_privilege('anon','public.project_transition_requests','DELETE')          as anon_delete,
  has_table_privilege('authenticated','public.project_transition_requests','SELECT') as auth_select,
  has_table_privilege('authenticated','public.project_transition_requests','INSERT') as auth_insert,
  has_table_privilege('authenticated','public.project_transition_requests','UPDATE') as auth_update,
  has_table_privilege('authenticated','public.project_transition_requests','DELETE') as auth_delete;

-- ─── 6) الدوالّ الخمس بتوقيعها الحرفيّ (العقد مع الواجهة) ──────────────────
-- متوقّع: 5 صفوف exists_now = true. أيّ اختلاف في التوقيع ⇒ الواجهة تقرأ
-- PGRST202 وتُعطّل الشاشة (وهو الاتجاه الآمن، لكنّه تعطيل).
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values
  ('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)'),
  ('public.project_transition_requests_list(uuid,text,int)'),
  ('public.project_transition_request_decide(uuid,text,text,boolean)'),
  ('public.project_transition_can_decide(uuid)'),
  ('public.project_transition_requests_expire(int)')
) f(sig);

-- ─── 7) صلاحيات الدوالّ ────────────────────────────────────────────────────
-- متوقّع: anon_exec = false في كلّ صفّ · auth_exec = true في الخمسة.
select f.sig,
       has_function_privilege('anon', f.sig, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', f.sig, 'EXECUTE') as auth_exec
from (values
  ('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)'),
  ('public.project_transition_requests_list(uuid,text,int)'),
  ('public.project_transition_request_decide(uuid,text,text,boolean)'),
  ('public.project_transition_can_decide(uuid)'),
  ('public.project_transition_requests_expire(int)')
) f(sig)
where to_regprocedure(f.sig) is not null;

-- متوقّع: false في الصفوف الثلاثة — الدوالّ الداخلية لا تُنادى من الواجهة.
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as auth_exec
from (values ('public.ptr_current_value(text,uuid,uuid)'),
             ('public.ptr_target_check(text,uuid,uuid,text)'),
             ('public.ptr_project_blocked(uuid)')) f(sig);

-- ─── 8) القواعد مركّبة فعلًا في جسم دالّة البتّ ────────────────────────────
-- متوقّع: true في كلّ الأعمدة.
-- enforces_actor_capability = «الاعتماد ليس طريقًا لاكتساب قدرة»: المعتمِد
-- يجب أن يملك قدرة الإجراء نفسه (can_finalize_deliverable / can_move_deliverable
-- / can_send_to_client_review) لا مجرّد صلاحية البتّ.
select
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%can_finalize_deliverable%'    as enforces_actor_capability,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%for update%'                  as locks_row_once,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%self_approval_forbidden%'      as blocks_self_approval,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%stale_conflict%'               as rechecks_state,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%transition_execute_begin%'     as audits_before,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%transition_executed%'          as audits_after,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)')) ilike '%can_approve_project_transition%' as checks_capability;

-- متوقّع: true — الإنشاء لا يلمس أيّ جدول هدف (لا UPDATE على deliverables/project_core).
select
  pg_get_functiondef(to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)')) not ilike '%update public.deliverables%' as create_never_updates_deliverables,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)')) not ilike '%update public.project_core%' as create_never_updates_project_core,
  pg_get_functiondef(to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)')) not ilike '%project_core_set_stage%'     as create_never_moves_stage;

-- ─── 9) لا نظام موازٍ: الجداول القائمة لم تُمسّ ────────────────────────────
-- متوقّع: صفر في العمودين — لم يُضَف عمود انتقال إلى جداول الاعتماد/التغيير.
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='project_approvals'
      and column_name in ('from_value','to_value','executed_at','kind_transition')) as approvals_polluted,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='project_change_requests'
      and column_name in ('from_value','to_value')) as changes_polluted;

-- ─── 10) فحص سلوكيّ بلا أثر: p_dry_run لا يكتب صفًّا ───────────────────────
-- متوقّع: rows_before = rows_after · create_ok = false · decide_applied = false.
with before_cnt as (select count(*) as n from public.project_transition_requests),
     probe as (
       select public.project_transition_request_create(
                '00000000-0000-0000-0000-000000000000'::uuid, null, 'status',
                null, null, 'postcheck probe', true) as c,
              public.project_transition_request_decide(
                '00000000-0000-0000-0000-000000000000'::uuid, 'reject', 'postcheck probe', true) as d
     ),
     after_cnt as (select count(*) as n from public.project_transition_requests)
select (select n from before_cnt) as rows_before,
       (select n from after_cnt)  as rows_after,
       (select (c->>'ok')::boolean from probe)      as create_ok,
       (select (d->>'applied')::boolean from probe) as decide_applied;

-- ─── 11) فحص المفردات: لا قيمة مخترعة تمرّ ────────────────────────────────
-- متوقّع: bad_status_rejected = false · good_status_accepted = true ·
--         bad_stage_rejected = false · deliverable_with_project_stage = false.
select
  (public.ptr_target_check('status','00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,'shipped')->>'ok')::boolean   as bad_status_rejected,
  (public.ptr_target_check('status','00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,'approved')->>'ok')::boolean  as good_status_accepted,
  (public.ptr_target_check('project_stage','00000000-0000-0000-0000-000000000000'::uuid,
     null,'launched')->>'ok')::boolean                                          as bad_stage_rejected,
  (public.ptr_target_check('project_stage','00000000-0000-0000-0000-000000000000'::uuid,
     '00000000-0000-0000-0000-000000000000'::uuid,'delivered')->>'ok')::boolean as deliverable_with_project_stage;

-- ─── 12) الحالة التشغيلية (بعد أوّل استعمال حقيقيّ) ────────────────────────
-- متوقّع مباشرةً بعد التشغيل: صفر صفوف.
-- لاحقًا: لا يوجد صفّ status='approved' بلا executed_at (تنفيذ بلا سجلّ)،
--         ولا صفّ status='pending' وله executed_at (سجلّ بلا حسم).
select status, count(*) as rows,
       count(*) filter (where status='approved' and executed_at is null) as approved_without_execution,
       count(*) filter (where status='pending'  and executed_at is not null) as pending_with_execution
from public.project_transition_requests group by status order by status;

-- متوقّع: صفر — لا طلب اعتمده صاحبه.
select count(*) as self_approved_rows
from public.project_transition_requests
where status = 'approved' and decided_by = requested_by;
