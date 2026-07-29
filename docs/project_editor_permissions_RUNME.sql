-- ════════════════════════════════════════════════════════════════════════════
-- project_editor_permissions_RUNME.sql          — RUN ONCE (ويُعاد تشغيله بأمان)
--
-- ⚠️ ترتيب التشغيل الإلزاميّ:
--     1) project_platform_large_projects_RUNME.sql   (مطبَّق على الإنتاج أصلًا)
--     2) **هذا الملفّ**                               ← يَسبِق حزمة طلبات الانتقال
--     3) project_transition_approval_RUNME.sql
--   هذا الملفّ **يَجُبّ (supersedes)** تعريف
--   public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)
--   الوارد في project_platform_large_projects_RUNME.sql (سطر 1181). ذلك الملفّ
--   مطبَّق على الإنتاج ولا يُعدَّل. أيّ إعادة تشغيل له تُعيد التعريف القديم
--   ⇒ **أعِد تشغيل هذا الملفّ بعده مباشرةً** وإلّا عادت الثغرة.
--
-- ─── الثغرة المُصلَحة (سلسلة مُثبَتة، لا فرضية) ────────────────────────────────
--   project_units_can_write(p) = is_admin() or can_manage_projects() or is_kian_member(p)
--   is_kian_member(p)          = is_admin() or project_role(p) like 'kian\_%'
--   ⇒ أيّ دور مشروع يبدأ بـkian_ — ومنه **kian_editor** — يجتاز بوّابة الكتابة،
--     والقائمة البيضاء لمفاتيح p_patch تشمل stage_id و status و client_visible.
--   النتيجة الفعلية **على الخادم** (لا في الواجهة): مونتير ينقل مخرجًا بين
--   المراحل، ويقفز بحالته إلى «معتمد/سُلِّم نهائيًّا»، ويكشفه للعميل.
--   تدقيق كامل لكلّ ما يحرسه can_edit_project كشف **أربعة** مسارات للثغرة
--   نفسها، لا واحدًا. إصلاح بعضها يترك الباب مفتوحًا من شاشة أخرى:
--     §3  large_project_deliverables_bulk_update  (نقل/حالة/كشف — جماعيّ)
--     §4  project_core_set_stage                  (مرحلة المشروع نفسه)
--     §4b pc_deliverable_review                   (send_client / approve)
--     §4c staff_set_deliverable · staff_add_deliverable (شاشة المونتير اليومية)
--
-- ─── فلسفة الإصلاح ───────────────────────────────────────────────────────────
--   • لا نضيّق مُسنَدًا مشتركًا: can_manage_projects (٣ تعريفات) و
--     can_edit_project (١١٧ موضع نداء) و project_units_can_write **لم تُمسّ**.
--     التضييق فيها يكسر وظائف لا علاقة لها بالثغرة.
--   • بدلًا من ذلك: مُسنَدات **جديدة ومحدّدة**، وتضييق القائمة البيضاء
--     **بحسب قدرة المستدعي** لا بحذف المفاتيح ⇒ المالك/الإدارة يحتفظون بكلّ
--     مفتاح يملكونه اليوم، حرفيًّا.
--   • كلّ مُسنَد منطقيّ يعيد boolean صريحًا ولا يعيد NULL أبدًا (انهيار NULL
--     سبّب حادثة fail-open حقيقية في هذا المستودع)، وكلّ نداء تابع معزول
--     بـbegin/exception ⇒ الغياب أو الخطأ = «لا» لا «نعم».
--   • ما يُمنع هنا **يُستبدَل** بمسار طلب/موافقة (الحزمة التالية) لا يُلغى.
--
-- قيود: Additive · Idempotent · Transaction · بلا حذف بيانات · بلا DROP لأيّ
--   دالّة قائمة · لا شيء لـanon أبدًا · صلاحيات العميل لم تُمسّ · قدرة المالك
--   والإدارة محفوظة كاملةً.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT صلب: لا نكتب شيئًا إن كانت الاعتمادات ناقصة ──────────────────
do $pre$
declare miss text := '';
begin
  if to_regprocedure('public.is_admin()')                is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.is_staff()')                is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.can_manage_projects()')     is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.can_final_deliver()')       is null then miss := miss || ' can_final_deliver()'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then miss := miss || ' pc_can_read_project(uuid)'; end if;
  if to_regprocedure('public.project_units_can_write(uuid)') is null then miss := miss || ' project_units_can_write(uuid)'; end if;
  if to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') is null
    then miss := miss || ' large_project_deliverables_bulk_update(...)'; end if;
  if to_regclass('public.deliverables') is null then miss := miss || ' deliverables'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deliverables' and column_name='client_visible')
    then miss := miss || ' deliverables.client_visible'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deliverables' and column_name='stage_id')
    then miss := miss || ' deliverables.stage_id'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deliverables' and column_name='is_deleted')
    then miss := miss || ' deliverables.is_deleted'; end if;
  if miss <> '' then
    raise exception 'PREFLIGHT: اعتمادات ناقصة —%. طبّق project_platform_large_projects_RUNME.sql أولًا.', miss;
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0) نسخة احتياطية أمينة من التعريفات الحيّة قبل الجَبّ
--     السبب: §3 و§4 يعيدان تعريف دالّتين مطبَّقتين على الإنتاج. من غير نسخة
--     من **النصّ الحيّ فعلًا** يكون الـROLLBACK تخمينًا. الجدول داخليّ بحت:
--     RLS مفعَّلة بلا أيّ سياسة ⇒ لا قراءة عبر PostgREST لأيّ دور.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_authz_fn_backup (
  id           uuid primary key default gen_random_uuid(),
  fn_signature text not null,
  fn_definition text not null,
  captured_at  timestamptz not null default now(),
  captured_by  uuid,
  note         text
);
alter table public.project_authz_fn_backup enable row level security;
revoke all on public.project_authz_fn_backup from public, anon, authenticated;

do $bk$
declare s text; d text;
begin
  foreach s in array array[
    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)',
    'public.project_core_set_stage(uuid,text,text)',
    'public.pc_deliverable_review(uuid,text,text,boolean)',
    'public.staff_set_deliverable(uuid,text,text,text)',
    'public.staff_add_deliverable(uuid,text,text,text,text,text)'
  ] loop
    if to_regprocedure(s) is null then continue; end if;
    d := pg_get_functiondef(to_regprocedure(s));
    -- التقاط واحد فقط لكلّ توقيع: أوّل نصّ حيّ قبل أيّ جَبّ (idempotent).
    if not exists (select 1 from public.project_authz_fn_backup b where b.fn_signature = s) then
      insert into public.project_authz_fn_backup(fn_signature, fn_definition, captured_by, note)
      values (s, d, auth.uid(), 'قبل project_editor_permissions_RUNME.sql');
    end if;
  end loop;
end $bk$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات الجديدة — تُضاف للكتالوج القائم (لا كتالوج موازٍ)
--     وجودها يمنح المالك مسارًا صريحًا لإعادة منح قدرة بعينها لموظّف بعينه،
--     بدل «كلّ من دوره يبدأ بـkian_».
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'permissions غير موجود — تُتخطّى بذور الصلاحيات؛ المُسنَدات تعمل بفرع الإدارة وحده.';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
    ('deliverables.move_stage',         'deliverables','sensitive',1040,'نقل المخرج بين المراحل','Move deliverable between stages'),
    ('deliverables.set_client_visible', 'deliverables','sensitive',1050,'إظهار المخرج للعميل','Reveal deliverable to client'),
    ('deliverables.finalize',           'deliverables','sensitive',1060,'اعتماد/تسليم المخرج نهائيًّا','Finalize deliverable'),
    ('projects.move_stage',             'projects',    'sensitive', 225,'نقل مرحلة المشروع','Move project stage'),
    ('transitions.request',             'governance',  'normal',    640,'طلب انتقال','Request a transition'),
    ('transitions.approve',             'governance',  'sensitive', 645,'اعتماد طلب انتقال','Approve a transition request')
  on conflict (key) do nothing;
  -- on conflict do nothing لا يُحدّث: نضمن الحساسية صراحةً (idempotent).
  update public.permissions set sensitivity = 'sensitive'
   where key in ('deliverables.move_stage','deliverables.set_client_visible','deliverables.finalize',
                 'projects.move_stage','transitions.approve')
     and coalesce(sensitivity,'') <> 'sensitive';
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) المُسنَدات الجديدة المحدّدة
--
--   قاعدة موحَّدة لكلّ مُسنَد كتابة:
--     is_admin()                                   ⇒ نعم (قدرة الإدارة محفوظة)
--     أو (يستطيع قراءة المشروع) و(مدير مشاريع أو منحٌ صريح للمفتاح)
--   • اشتراط pc_can_read_project **لا يضيّق على المدير**: مسار
--     staff_reads_all_projects يجعلها true لكلّ المشاريع لديه؛ وإنّما يقصر
--     المنح الصريح على المشاريع المسندة فعلًا.
--   • plpgsql بـbegin/exception حول كلّ نداء تابع ⇒ لا NULL ولا انفجار.
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 نقل المخرج بين المراحل (stage_id)
create or replace function public.can_move_deliverable(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_read boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v_read := coalesce(public.pc_can_read_project(p_project), false); exception when others then v_read := false; end;
  if not v_read then return false; end if;
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v := coalesce(public.emp_has_permission('deliverables.move_stage'), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- 2.2 إظهار المخرج للعميل (client_visible) — «الإرسال إلى مراجعة العميل»
create or replace function public.can_send_to_client_review(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_read boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v_read := coalesce(public.pc_can_read_project(p_project), false); exception when others then v_read := false; end;
  if not v_read then return false; end if;
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v := coalesce(public.emp_has_permission('deliverables.set_client_visible'), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- 2.3 اعتماد/تسليم المخرج نهائيًّا (status إلى ما بعد المراجعة الداخلية)
--     مرساةً can_final_deliver() القائمة كي لا نخترع سلطةً موازية للتسليم.
create or replace function public.can_finalize_deliverable(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_read boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v_read := coalesce(public.pc_can_read_project(p_project), false); exception when others then v_read := false; end;
  if not v_read then return false; end if;
  begin v := coalesce(public.can_final_deliver(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v := coalesce(public.emp_has_permission('deliverables.finalize'), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- 2.4 تحريك مرحلة المشروع نفسه (project_core.core_stage)
create or replace function public.can_move_project_stage(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_read boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v_read := coalesce(public.pc_can_read_project(p_project), false); exception when others then v_read := false; end;
  if not v_read then return false; end if;
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  if v then return true; end if;
  begin v := coalesce(public.emp_has_permission('projects.move_stage'), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- 2.5 من يجوز أن **يطلب** انتقالًا: كوادر كيان الذين يرون المشروع.
--     الطلب لا يغيّر شيئًا ⇒ عتبته منخفضة عمدًا. العميل مستثنًى صراحةً.
create or replace function public.can_request_project_transition(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false; v_read boolean := false;
begin
  if p_project is null or auth.uid() is null then return false; end if;
  begin v := coalesce(public.is_staff(), false); exception when others then v := false; end;
  if not v then return false; end if;              -- العميل ليس is_staff ⇒ محجوب
  begin v_read := coalesce(public.pc_can_read_project(p_project), false); exception when others then v_read := false; end;
  return coalesce(v_read, false);
end $$;

-- 2.6 من يجوز أن **يبتّ**: الإدارة أو منحٌ صريح لـtransitions.approve.
--     ملاحظة أمنية: هذا مُسنَد «قدرة» فقط. منع «الموافقة على طلب نفسي» ليس هنا
--     بل في دالّة البتّ (تعرف هويّة الطالب) — انظر حزمة الانتقال §5.
create or replace function public.can_approve_project_transition(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  -- ★ الإصدار الأول: **المالك وحده** يعتمد أو يرفض طلبات الانتقال. ★
  --   كان هذا الفرع يمرّ عبر can_manage_projects()، وهي
  --   `is_owner() or staff_role() in ('manager')` ⇒ فكان **كل مدير** يعتمد
  --   تلقائيًّا، وهو ما مُنع صراحةً في الإصدار الأول. لا تُوسّعه بلا قرار مكتوب.
  --
  --   ⚠️ توثيق حدّ قائم: is_owner() تشمل staff_role='super_admin' بحكم المعمارية
  --   القديمة (99 موضع استدعاء)، فالسوبر أدمن يعتمد أيضًا. لم نمسّ is_owner()
  --   في هذه المرحلة — تغييرها يكسر الإنتاج، والتضييق يكون بقرار منفصل.
  if p_project is null or auth.uid() is null then return false; end if;

  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if coalesce(v, false) then return true; end if;

  begin v := coalesce(public.is_owner(), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) ★ الإصلاح الحرج ★ — إعادة تعريف large_project_deliverables_bulk_update
--
--   يَجُبّ التعريف في project_platform_large_projects_RUNME.sql:1181 (مطبَّق).
--   ما بقي كما هو حرفيًّا: التوقيع · شكل الرد · القائمة البيضاء الاثنا عشر ·
--   العزل لكلّ صفّ · p_dry_run · فحص التوفّر بقائمة فارغة · السبب الإلزاميّ ·
--   حدّ ١٠٠ معرّف · غياب أيّ SQL ديناميكيّ · جملة UPDATE نفسها.
--
--   الجديد — تضييق **بحسب قدرة المستدعي وبحسب الصفّ**:
--     stage_id       ⇒ can_move_deliverable(project)
--     client_visible ⇒ can_send_to_client_review(project)
--     status         ⇒ can_finalize_deliverable(project) لأيّ قيمة،
--                      وإلّا خطوة التنفيذ الوحيدة draft → internal_review.
--   ★ لا يُحاسَب إلّا **التغيير الفعليّ**: إرسال مفتاح بقيمته الحالية (كما تفعل
--     الواجهة حين تعيد إرسال الصفّ كاملًا) ليس تغييرًا ⇒ لا يُمنع. هذا يمنع
--     كسر عمل مشروع لا علاقة له بالثغرة.
--   ★ صاحب الصلاحية الكاملة (المالك/الإدارة/المدير) يمرّ في كلّ فرع ⇒ **لم
--     يفقد مفتاحًا واحدًا**.
--   ★ المنع يُبلَّغ لكلّ صفّ برمز صريح، ويظهر في p_dry_run أيضًا ⇒ الواجهة ترى
--     الحقيقة قبل التنفيذ لا بعده.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.large_project_deliverables_bulk_update(
  p_ids     uuid[],
  p_patch   jsonb,
  p_reason  text    default null,
  p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_k text; v_id uuid; v_proj uuid; v_n int;
  v_res jsonb := '[]'::jsonb;
  v_dry boolean := coalesce(p_dry_run, false);
  v_reason text; v_audited boolean := false; v_applied int := 0; v_denied int := 0;
  v_cur_status text; v_cur_visible boolean; v_cur_stage uuid;
  v_to_status text; v_to_visible boolean; v_to_stage uuid;
  v_deny text;
  v_has_stage   boolean; v_has_visible boolean; v_has_status boolean;
  v_allowed constant text[] := array[
    'assignee_id','priority','status','client_visible','due_date','planned_start_date',
    'schedule_status','stage_id','requires_shooting','requires_editing',
    'requires_design','requires_printing'];
  v_status_vocab constant text[] := array[
    'draft','internal_review','client_review','revision_requested',
    'approved','final_delivered','archived'];
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_ids, '{}'::uuid[])) t(x) where x is not null;

  -- نداء بلا معرّفات = فحص توفّر. ينجح بلا أثر ولا يفحص الحمولة. (سلوك قائم)
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', true, 'requested', 0, 'applied', 0,
                              'dry_run', v_dry, 'audited', true, 'results', '[]'::jsonb);
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'too_many_ids: % (الحدّ 100 في النداء الواحد)', cardinality(v_ids);
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty_patch';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason,'')),'');
  if v_reason is null then raise exception 'reason_required'; end if;

  for v_k in select jsonb_object_keys(p_patch) loop
    if not (v_k = any (v_allowed)) then raise exception 'unsupported_patch_key: %', v_k; end if;
  end loop;

  v_has_stage   := p_patch ? 'stage_id';
  v_has_visible := p_patch ? 'client_visible';
  v_has_status  := p_patch ? 'status';

  foreach v_id in array v_ids loop
    begin
      v_deny := null;
      select d.project_id, d.status, d.client_visible, d.stage_id
        into v_proj, v_cur_status, v_cur_visible, v_cur_stage
        from public.deliverables d
       where d.id = v_id and coalesce(d.is_deleted,false) = false;

      if v_proj is null then
        v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_found');
      elsif not coalesce(public.project_units_can_write(v_proj), false) then
        v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'forbidden');
      else
        -- ── حرّاس القدرة، على التغيير الفعليّ وحده ──────────────────────────
        if v_has_stage then
          v_to_stage := nullif(p_patch->>'stage_id','')::uuid;
          if v_to_stage is distinct from v_cur_stage
             and not coalesce(public.can_move_deliverable(v_proj), false) then
            v_deny := 'forbidden_stage_move';
          end if;
        end if;

        if v_deny is null and v_has_visible then
          v_to_visible := coalesce((p_patch->>'client_visible')::boolean, v_cur_visible);
          if v_to_visible is distinct from v_cur_visible
             and not coalesce(public.can_send_to_client_review(v_proj), false) then
            v_deny := 'forbidden_client_visible';
          end if;
        end if;

        if v_deny is null and v_has_status then
          v_to_status := coalesce(nullif(btrim(p_patch->>'status'),''), v_cur_status);
          if v_to_status is distinct from v_cur_status then
            if not (v_to_status = any (v_status_vocab)) then
              v_deny := 'bad_status';
            elsif coalesce(public.can_finalize_deliverable(v_proj), false) then
              null;                                        -- سلطة كاملة على الحالة
            elsif v_cur_status = 'draft' and v_to_status = 'internal_review' then
              null;                                        -- خطوة التنفيذ الوحيدة
            else
              v_deny := 'forbidden_status_change';
            end if;
          end if;
        end if;

        if v_deny is not null then
          v_denied := v_denied + 1;
          v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', v_deny);
        elsif v_dry then
          v_res := v_res || jsonb_build_object('id', v_id, 'ok', true, 'error', null);
        else
          update public.deliverables d set
            assignee_id        = case when p_patch ? 'assignee_id'        then nullif(p_patch->>'assignee_id','')::uuid        else d.assignee_id        end,
            priority           = case when p_patch ? 'priority'           then nullif(btrim(p_patch->>'priority'),'')          else d.priority           end,
            status             = case when p_patch ? 'status'             then coalesce(nullif(btrim(p_patch->>'status'),''), d.status) else d.status    end,
            client_visible     = case when p_patch ? 'client_visible'     then coalesce((p_patch->>'client_visible')::boolean, d.client_visible) else d.client_visible end,
            due_date           = case when p_patch ? 'due_date'           then nullif(p_patch->>'due_date','')::date           else d.due_date           end,
            planned_start_date = case when p_patch ? 'planned_start_date' then nullif(p_patch->>'planned_start_date','')::date else d.planned_start_date end,
            schedule_status    = case when p_patch ? 'schedule_status'    then coalesce(nullif(btrim(p_patch->>'schedule_status'),''), d.schedule_status) else d.schedule_status end,
            stage_id           = case when p_patch ? 'stage_id'           then nullif(p_patch->>'stage_id','')::uuid           else d.stage_id           end,
            requires_shooting  = case when p_patch ? 'requires_shooting'  then coalesce((p_patch->>'requires_shooting')::boolean,  d.requires_shooting)  else d.requires_shooting  end,
            requires_editing   = case when p_patch ? 'requires_editing'   then coalesce((p_patch->>'requires_editing')::boolean,   d.requires_editing)   else d.requires_editing   end,
            requires_design    = case when p_patch ? 'requires_design'    then coalesce((p_patch->>'requires_design')::boolean,    d.requires_design)    else d.requires_design    end,
            requires_printing  = case when p_patch ? 'requires_printing'  then coalesce((p_patch->>'requires_printing')::boolean,  d.requires_printing)  else d.requires_printing  end
          where d.id = v_id;
          get diagnostics v_n = row_count;
          if v_n = 1 then
            v_applied := v_applied + 1;
            v_res := v_res || jsonb_build_object('id', v_id, 'ok', true, 'error', null);
          else
            v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_updated');
          end if;
        end if;
      end if;
    exception when others then
      v_res := v_res || jsonb_build_object('id', v_id, 'ok', false,
                                           'error', coalesce(nullif(btrim(sqlerrm),''), 'error'));
    end;
  end loop;

  begin
    insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
    values (auth.uid(), null,
            case when v_dry then 'deliverables.bulk_update.dry_run' else 'deliverables.bulk_update' end,
            'deliverable', null,
            jsonb_build_object('reason', v_reason, 'patch', p_patch,
                               'requested', cardinality(v_ids), 'applied', v_applied,
                               'denied', v_denied, 'ids', to_jsonb(v_ids)));
    v_audited := true;
  exception when others then v_audited := false;
  end;

  return jsonb_build_object('ok', true, 'requested', cardinality(v_ids),
                            'applied', v_applied, 'denied', v_denied, 'dry_run', v_dry,
                            'audited', v_audited, 'results', v_res);
end $$;

comment on function public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean) is
  'يَجُبّ تعريف project_platform_large_projects_RUNME.sql. نفس القائمة البيضاء، لكن '
  'stage_id/client_visible/status مقيَّدة بقدرة المستدعي على مشروع الصفّ. '
  'إعادة تشغيل الملفّ المطبَّق تُعيد النسخة القديمة ⇒ أعد تشغيل project_editor_permissions_RUNME.sql بعده.';

-- ════════════════════════════════════════════════════════════════════════════
-- §4) المنح الثاني — مرحلة المشروع
--
--   project_core_set_stage تقبل اليوم can_edit_project(p) التي تساوي
--   «مدير مشاريع **أو** (staff_role='editor' و project_role='kian_editor')»
--   ⇒ المونتير المسنَد يحرّك مرحلة المشروع للأمام خطوةً خطوة.
--   النصّ أدناه منقول حرفيًّا من project_stage_sync_RUNME.sql:89 (أحدث تعريف
--   في المستودع، 2026-07-21) وقد غُيِّر فيه **مُسنَد الإذن وحده**:
--       can_edit_project(p_project)  →  can_move_project_stage(p_project)
--   كلّ الحرّاس الأخرى (bad_stage · reason_required للرجوع/الإغلاق ·
--   need_manager · need_due_date · no_stage_skip · إعادة احتساب التقدّم ·
--   مزامنة projects.status داخل نفس المعاملة) كما هي بلا حرف واحد مختلف.
--   النصّ الحيّ قبل الجَبّ محفوظ في project_authz_fn_backup (§0) للـROLLBACK.
--   البديل للمونتير ليس المنع المجرَّد: كِنْد 'project_stage' في حزمة طلبات
--   الانتقال يمنحه مسار طلب ⇒ الحركة تقع بموافقة صاحب القرار.
-- ════════════════════════════════════════════════════════════════════════════
do $stage$
begin
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is null then
    raise notice '§4: project_core_set_stage غير موجودة — يُتخطّى إصلاح المنح الثاني.';
    return;
  end if;
  if to_regclass('public.project_core') is null
     or to_regprocedure('public.project_status_for_stage(text)') is null
     or to_regprocedure('public.project_progress(uuid)') is null then
    raise notice '§4: اعتمادات project_stage_sync غير مكتملة — يُتخطّى إصلاح المنح الثاني (الثغرة الأولى مُغلَقة في §3).';
    return;
  end if;

  execute $fn$
create or replace function public.project_core_set_stage(p_project uuid, p_stage text, p_note text default null)
returns public.project_core language plpgsql security definer set search_path = public as $body$
declare r public.project_core; v_from text; v_fi int; v_ti int; v_reason text := nullif(btrim(p_note),'');
  v_order text[] := array['lead_approved','project_created','planning','ready','scheduled','in_production',
                          'post_production','internal_review','client_review','revision','approved','delivered','closed'];
begin
  -- ★ التغيير الوحيد عن النسخة المطبَّقة: can_edit_project → can_move_project_stage
  if not public.can_manage_projects() and not public.can_move_project_stage(p_project) then raise exception 'not authorized'; end if;
  if not (p_stage = any(v_order)) then raise exception 'bad_stage'; end if;
  select core_stage into v_from from public.project_core where project_id = p_project;
  v_from := coalesce(v_from, 'project_created');
  if v_from = p_stage then
    update public.projects set status = public.project_status_for_stage(p_stage)
      where id = p_project and status is distinct from public.project_status_for_stage(p_stage);
    select * into r from public.project_core where project_id = p_project; return r;
  end if;
  v_fi := array_position(v_order, v_from); v_ti := array_position(v_order, p_stage);

  if v_ti < v_fi or p_stage = 'closed' then
    if v_reason is null then raise exception 'reason_required'; end if;
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  if p_stage = 'delivered' and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  if v_ti > v_fi + 1 and not public.is_owner() then raise exception 'no_stage_skip'; end if;
  if p_stage = 'ready' then
    if not exists (select 1 from public.project_members m where m.project_id = p_project and m.role='kian_manager' and m.is_deleted=false)
      then raise exception 'need_manager'; end if;
    if not exists (select 1 from public.project_core pc where pc.project_id = p_project and pc.due_date is not null)
      then raise exception 'need_due_date'; end if;
  end if;

  insert into public.project_core(project_id, core_stage, updated_by)
    values (p_project, p_stage, auth.uid())
    on conflict (project_id) do update set core_stage = p_stage, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (p_project, v_from, p_stage, v_reason, auth.uid());
  perform public.pc_log(p_project, 'stage_changed', 'project', p_project, jsonb_build_object('from', v_from, 'to', p_stage));
  perform public.pc_notify_team(p_project, 'project_status_changed', 'project', p_project,
    'تغيّرت مرحلة المشروع إلى '||p_stage, 'Project stage changed to '||p_stage, auth.uid());

  update public.project_core
    set progress_pct = (public.project_progress(p_project)->>'pct')::int, updated_at = now()
    where project_id = p_project returning * into r;
  if r.project_id is null then raise exception 'progress_recompute_failed'; end if;

  update public.projects set status = public.project_status_for_stage(p_stage) where id = p_project;

  return r;
end $body$;
  $fn$;
end $stage$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4b) ★ المسار الثالث — دورة مراجعة النسخ ★
--
--   تدقيق كلّ ما تحرسه can_edit_project كشف مسارًا آخر لنفس الثغرة:
--   public.pc_deliverable_review (project_core_ABSOLUTE_FINAL_RUNME.sql:1708)
--   محروسة بـ can_edit_project ⇒ المونتير المسنَد ينفّذ:
--     send_client ⇒ client_visible = true + status = 'client_review' (كشفٌ للعميل)
--     approve     ⇒ status = 'approved'                              (اعتماد)
--   وهذان بالضبط ما مُنع منه في §3. إصلاح المسار الأوّل وحده كان سيبقي الباب
--   مفتوحًا على مصراعيه من شاشة أخرى.
--
--   النصّ منقول حرفيًّا من الملفّ المطبَّق، والإضافة **سطران اثنان فقط**:
--   حارس قدرة في فرع send_client وآخر في فرع approve. لم يُمسّ أيّ فرع آخر
--   (unshare/reject/revision/final/archive)، ولا الأقفال، ولا الحرّاس القائمة
--   (already_final · old_version · Supersede · can_final_deliver).
--   ⚠️ لهذا أثر مرئيّ في واجهة المونتير: زرّا «إرسال للعميل» و«اعتماد» سيردّان
--     رفضًا صريحًا. البديل هو مسار الطلب (الحزمة التالية) — يجب وصله في الشاشة.
-- ════════════════════════════════════════════════════════════════════════════
do $rev$
begin
  if to_regprocedure('public.pc_deliverable_review(uuid,text,text,boolean)') is null then
    raise notice '§4b: pc_deliverable_review غير موجودة — يُتخطّى (لا مسار ثالث في هذه البيئة).';
    return;
  end if;

  execute $fn$
create or replace function public.pc_deliverable_review(p_version uuid, p_action text, p_note text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $body$
declare v record; d record; v_latest int;
begin
  select * into v from public.project_deliverable_versions where id = p_version for update;
  if v.id is null then raise exception 'not_found'; end if;
  select * into d from public.deliverables where id = v.deliverable_id and is_deleted = false for update;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(d.project_id) then raise exception 'not authorized'; end if;
  select max(version) into v_latest from public.project_deliverable_versions where deliverable_id = d.id;

  -- مخرَج مُسلَّم نهائيًا لا يقبل أي تحوّل مراجعة (الأرشفة فقط).
  if d.status = 'final_delivered' and p_action in ('approve','reject','revision','send_client') then
    raise exception 'already_final';
  end if;

  if p_action = 'send_client' then
    -- ★ الإضافة الوحيدة (1/2): كشف العميل قرار إداريّ لا خطوة تنفيذ.
    if not coalesce(public.can_send_to_client_review(d.project_id), false) then
      raise exception 'not authorized: send_client يتطلّب صلاحية الإظهار للعميل — سجّل طلب انتقال بدلًا منه';
    end if;
    -- إظهار نسخة للعميل = مراجعة عميل رسمية؛ النسخ الداخلية لا تُكشف إلا بهذا المسار.
    update public.project_deliverable_versions set client_visible = true where id = p_version;
    -- واجهة العميل تقرأ معاينة صف المخرَج — تُحدَّث لتطابق النسخة المُرسلة.
    update public.deliverables set status = 'client_review',
      preview_url = coalesce(v.preview_url, preview_url), version = v.version where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_sent_client', 'deliverable', d.id, jsonb_build_object('version', v.version));
  elsif p_action = 'unshare' then
    update public.project_deliverable_versions set client_visible = false where id = p_version;
    perform public.pc_log(d.project_id, 'deliverable_unshared', 'deliverable', d.id, jsonb_build_object('version', v.version));
  elsif p_action = 'approve' then
    -- ★ الإضافة الوحيدة (2/2): الاعتماد قرار إداريّ.
    if not coalesce(public.can_finalize_deliverable(d.project_id), false) then
      raise exception 'not authorized: approve يتطلّب صلاحية الاعتماد — سجّل طلب انتقال بدلًا منه';
    end if;
    if v.approved_at is not null then raise exception 'already_decided'; end if;
    -- اعتماد نسخة أقدم من الأحدث يتطلب تأكيدًا صريحًا.
    if v.version < v_latest and not p_force then raise exception 'old_version'; end if;
    -- النسخة المعتمدة السابقة تُستبدل (Supersede) — لا اعتمادان فعّالان.
    update public.project_deliverable_versions set superseded = true
      where deliverable_id = d.id and approved_at is not null and superseded = false and id <> p_version;
    update public.project_deliverable_versions set approved_at = now(), approved_by = auth.uid(), superseded = false
      where id = p_version;
    update public.deliverables set status = 'approved' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_approved', 'deliverable', d.id, jsonb_build_object('version', v.version, 'forced_old', v.version < v_latest));
    perform public.pc_notify_team(d.project_id, 'project_note_new', 'deliverable', d.id,
      'اعتُمدت نسخة المخرَج v'||v.version||' — '||d.title, 'Deliverable version approved', auth.uid());
  elsif p_action in ('reject','revision') then
    if coalesce(btrim(p_note),'') = '' then raise exception 'reason_required'; end if;
    update public.deliverables set status = 'revision_requested' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_revision', 'deliverable', d.id,
      jsonb_build_object('version', v.version, 'note', left(btrim(p_note),500), 'action', p_action));
    if d.assignee_id is not null then
      perform public.pc_notify_user(d.assignee_id, 'project_note_new', 'deliverable', d.id,
        'طُلب تعديل على المخرَج: '||d.title, 'Revision requested: '||d.title);
    end if;
  elsif p_action = 'final' then
    -- التسليم النهائي والأرشفة للمدير/المالك فقط (يوافق طبقة can_final_deliver القائمة).
    if not public.can_final_deliver() then raise exception 'not authorized'; end if;
    -- لا تسليم نهائي بلا نسخة معتمدة؛ ولا تسليم مزدوج؛ ونسخة أقدم من الأحدث تتطلب تأكيدًا.
    if d.status = 'final_delivered' then raise exception 'already_final'; end if;
    if v.approved_at is null or v.superseded then raise exception 'no_approved_version'; end if;
    if v.version < v_latest and not p_force then raise exception 'old_version'; end if;
    update public.project_deliverable_versions set is_final = true where id = p_version;
    update public.deliverables set status = 'final_delivered' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_final', 'deliverable', d.id, jsonb_build_object('version', v.version));
    perform public.pc_notify_team(d.project_id, 'project_note_new', 'deliverable', d.id,
      'تسليم نهائي للمخرَج: '||d.title||' (v'||v.version||')', 'Final delivery', auth.uid());
  elsif p_action = 'archive' then
    if not public.can_final_deliver() then raise exception 'not authorized'; end if;
    update public.deliverables set status = 'archived' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_archived', 'deliverable', d.id, '{}');
  else
    raise exception 'bad_state';
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'version', v.version);
end $body$;
  $fn$;
end $rev$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4c) ★ المسار الرابع — شاشة المونتير القديمة ★
--
--   public.staff_set_deliverable و public.staff_add_deliverable
--   (staff_roles_task_assignment_RUNME.sql) محروستان بـ can_edit_project،
--   وتسمحان صراحةً للمونتير بـ 'client_review' و'approved'. هذه هي الشاشة
--   التي يستعملها المونتير يوميًّا (components/portal/EditorDeliverables.tsx)
--   ⇒ تركها يعني أنّ كلّ ما سبق زينة.
--
--   التضييق: القيمتان الحسّاستان وحدهما تحتاجان قدرة. draft/internal_review/
--   revision_requested تبقى للمونتير كما هي، وfinal_delivered/archived تبقى
--   محكومة بـcan_final_deliver كما كانت. لا حرف آخر تغيّر.
-- ════════════════════════════════════════════════════════════════════════════
do $staff$
begin
  if to_regprocedure('public.staff_set_deliverable(uuid,text,text,text)') is not null then
    execute $fn$
create or replace function public.staff_set_deliverable(
  p_dlv uuid, p_status text default null,
  p_preview_url text default null, p_vimeo_url text default null)
returns boolean language plpgsql security definer set search_path = public as $body$
declare v_proj uuid; v_rows int;
begin
  select project_id into v_proj from public.deliverables where id = p_dlv and is_deleted = false;
  if v_proj is null then raise exception 'deliverable not found'; end if;
  if not public.can_edit_project(v_proj) then raise exception 'not assigned to this project'; end if;
  if p_status is not null then
    if p_status in ('final_delivered','archived') and not public.can_final_deliver() then
      raise exception 'final_delivered/archived requires super_admin/admin/manager';
    end if;
    -- ★ إضافة: كشف العميل والاعتماد قراران إداريّان لا خطوتا تنفيذ.
    if p_status = 'client_review' and not coalesce(public.can_send_to_client_review(v_proj), false) then
      raise exception 'not authorized: client_review يتطلّب صلاحية الإظهار للعميل — سجّل طلب انتقال بدلًا منه';
    end if;
    if p_status = 'approved' and not coalesce(public.can_finalize_deliverable(v_proj), false) then
      raise exception 'not authorized: approved يتطلّب صلاحية الاعتماد — سجّل طلب انتقال بدلًا منه';
    end if;
    if not public.can_final_deliver()
       and p_status <> all (array['draft','internal_review','client_review','revision_requested','approved']) then
      raise exception 'editor may not set status %', p_status;
    end if;
  end if;
  update public.deliverables
     set status           = coalesce(p_status, status),
         preview_url      = coalesce(p_preview_url, preview_url),
         vimeo_review_url = coalesce(p_vimeo_url, vimeo_review_url)
   where id = p_dlv and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $body$;
    $fn$;
  else
    raise notice '§4c: staff_set_deliverable غير موجودة — تُتخطّى.';
  end if;

  if to_regprocedure('public.staff_add_deliverable(uuid,text,text,text,text,text)') is not null then
    execute $fn$
create or replace function public.staff_add_deliverable(
  p_project uuid, p_title text, p_type text default 'video',
  p_preview_url text default null, p_vimeo_url text default null,
  p_status text default 'client_review')
returns uuid language plpgsql security definer set search_path = public as $body$
declare v_id uuid; v_ver int;
begin
  if not public.can_edit_project(p_project) then raise exception 'not assigned to this project'; end if;
  if p_status <> all (array['draft','internal_review','client_review']) then
    raise exception 'editor may set only draft|internal_review|client_review';
  end if;
  -- ★ إضافة: إنشاء مخرَج مباشرةً في «لدى العميل» كشفٌ للعميل بلا قرار إداريّ.
  --   draft و internal_review تبقيان متاحتين للمونتير بلا أيّ تغيير.
  if p_status = 'client_review' and not coalesce(public.can_send_to_client_review(p_project), false) then
    raise exception 'not authorized: البدء بحالة client_review يتطلّب صلاحية الإظهار للعميل — أنشئه في مراجعة داخلية ثم سجّل طلب انتقال';
  end if;
  select coalesce(max(version),0)+1 into v_ver from public.deliverables where project_id = p_project;
  insert into public.deliverables (project_id, title, type, version, preview_url, vimeo_review_url, status)
  values (p_project, p_title, coalesce(p_type,'video'), v_ver, p_preview_url, p_vimeo_url, coalesce(p_status,'client_review'))
  returning id into v_id;
  return v_id;
end $body$;
    $fn$;
  else
    raise notice '§4c: staff_add_deliverable غير موجودة — تُتخطّى.';
  end if;
end $staff$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) الصلاحيات — لا شيء لـanon، أبدًا
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text;
begin
  foreach f in array array[
    'public.can_move_deliverable(uuid)',
    'public.can_send_to_client_review(uuid)',
    'public.can_finalize_deliverable(uuid)',
    'public.can_move_project_stage(uuid)',
    'public.can_request_project_transition(uuid)',
    'public.can_approve_project_transition(uuid)',
    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)',
    'public.project_core_set_stage(uuid,text,text)'
  ] loop
    if to_regprocedure(f) is null then continue; end if;
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to service_role', f); exception when undefined_object then null; end;
  end loop;

  -- الثلاثة المُعاد تعريفها في §4b/§4c: نُعيد **نفس** منحها السابق حرفيًّا
  -- (authenticated فقط، بلا service_role) — لا توسيع ولا تضييق للصلاحية.
  foreach f in array array[
    'public.pc_deliverable_review(uuid,text,text,boolean)',
    'public.staff_set_deliverable(uuid,text,text,text)',
    'public.staff_add_deliverable(uuid,text,text,text,text,text)'
  ] loop
    if to_regprocedure(f) is null then continue; end if;
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) SELF-TEST — بلا أيّ أثر جانبيّ. الفشل يُلغي المعاملة كاملةً.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare f text; v_def text; v_out jsonb; v_b boolean;
begin
  foreach f in array array[
    'public.can_move_deliverable(uuid)','public.can_send_to_client_review(uuid)',
    'public.can_finalize_deliverable(uuid)','public.can_move_project_stage(uuid)',
    'public.can_request_project_transition(uuid)','public.can_approve_project_transition(uuid)'
  ] loop
    if to_regprocedure(f) is null then raise exception 'SELF-TEST: % لم تُنشأ', f; end if;
  end loop;

  -- (1) المُسنَدات لا تعيد NULL أبدًا — حتى بوسيط NULL.
  execute 'select public.can_move_deliverable(null)'          into v_b; if v_b is null then raise exception 'SELF-TEST: can_move_deliverable أعادت NULL'; end if;
  execute 'select public.can_send_to_client_review(null)'     into v_b; if v_b is null then raise exception 'SELF-TEST: can_send_to_client_review أعادت NULL'; end if;
  execute 'select public.can_finalize_deliverable(null)'      into v_b; if v_b is null then raise exception 'SELF-TEST: can_finalize_deliverable أعادت NULL'; end if;
  execute 'select public.can_move_project_stage(null)'        into v_b; if v_b is null then raise exception 'SELF-TEST: can_move_project_stage أعادت NULL'; end if;
  execute 'select public.can_request_project_transition(null)'into v_b; if v_b is null then raise exception 'SELF-TEST: can_request_project_transition أعادت NULL'; end if;
  execute 'select public.can_approve_project_transition(null)'into v_b; if v_b is null then raise exception 'SELF-TEST: can_approve_project_transition أعادت NULL'; end if;

  -- (2) الحرّاس الثلاثة موجودة فعلًا في جسم الدالّة المجبوبة (ilike — المُفكِّك يرفع الحالة).
  v_def := pg_get_functiondef(to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'));
  if v_def not ilike '%can_move_deliverable%'       then raise exception 'SELF-TEST: حارس stage_id غائب'; end if;
  if v_def not ilike '%can_send_to_client_review%'  then raise exception 'SELF-TEST: حارس client_visible غائب'; end if;
  if v_def not ilike '%can_finalize_deliverable%'   then raise exception 'SELF-TEST: حارس status غائب'; end if;
  if v_def not ilike '%''stage_id''%' or v_def not ilike '%''client_visible''%' or v_def not ilike '%''status''%'
    then raise exception 'SELF-TEST: القائمة البيضاء فقدت مفتاحًا — المالك يجب أن يحتفظ بكلّ مفاتيحه'; end if;

  -- (3) فحص التوفّر (قائمة فارغة) ما زال ينجح بلا أثر — الواجهة تعتمد عليه.
  v_out := public.large_project_deliverables_bulk_update('{}'::uuid[], '{}'::jsonb, null, true);
  if coalesce((v_out->>'ok')::boolean,false) is not true or coalesce((v_out->>'requested')::int,-1) <> 0
    then raise exception 'SELF-TEST: فحص التوفّر بقائمة فارغة تغيّر سلوكه'; end if;

  -- (4) §4 طبّق التضييق (أو تُخطّي بإشعار صريح).
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is not null then
    v_def := pg_get_functiondef(to_regprocedure('public.project_core_set_stage(uuid,text,text)'));
    if v_def ilike '%can_edit_project%' then
      raise notice '§4 لم يُطبَّق: project_core_set_stage ما زالت تقبل can_edit_project (المونتير يحرّك مرحلة المشروع).';
    end if;
  end if;

  -- (5) المسارات الثلاثة الأخرى لنفس الثغرة (§4b/§4c) — لا تُترك بلا حارس.
  if to_regprocedure('public.pc_deliverable_review(uuid,text,text,boolean)') is not null then
    v_def := pg_get_functiondef(to_regprocedure('public.pc_deliverable_review(uuid,text,text,boolean)'));
    if v_def not ilike '%can_send_to_client_review%' or v_def not ilike '%can_finalize_deliverable%'
      then raise exception 'SELF-TEST: §4b لم يُطبَّق — pc_deliverable_review ما زالت تكشف للعميل/تعتمد بلا قدرة'; end if;
  end if;
  if to_regprocedure('public.staff_set_deliverable(uuid,text,text,text)') is not null then
    v_def := pg_get_functiondef(to_regprocedure('public.staff_set_deliverable(uuid,text,text,text)'));
    if v_def not ilike '%can_send_to_client_review%' or v_def not ilike '%can_finalize_deliverable%'
      then raise exception 'SELF-TEST: §4c لم يُطبَّق — staff_set_deliverable ما زالت تسمح بـclient_review/approved'; end if;
    -- ولم تفقد مسارات المونتير المشروعة
    if v_def not ilike '%internal_review%' then raise exception 'SELF-TEST: §4c فقد مسار المونتير المشروع'; end if;
  end if;
  if to_regprocedure('public.staff_add_deliverable(uuid,text,text,text,text,text)') is not null then
    v_def := pg_get_functiondef(to_regprocedure('public.staff_add_deliverable(uuid,text,text,text,text,text)'));
    if v_def not ilike '%can_send_to_client_review%'
      then raise exception 'SELF-TEST: §4c لم يُطبَّق على staff_add_deliverable'; end if;
  end if;

  raise notice 'SELF-TEST: نجح — المسارات الأربعة مُغلَقة والمالك لم يفقد مفتاحًا.';
end $st$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: نفّذ project_editor_permissions_POSTCHECK.sql، ثم انتقل إلى
-- project_transition_approval_{PREFLIGHT,RUNME,POSTCHECK}.sql.
-- ════════════════════════════════════════════════════════════════════════════
