-- ════════════════════════════════════════════════════════════════════════════
-- project_transition_approval_RUNME.sql          — RUN ONCE (ويُعاد تشغيله بأمان)
--
-- ⚠️ يُشغَّل **بعد** project_editor_permissions_RUNME.sql (يعتمد على مُسنَداته).
--
-- ─── ما هذه الحزمة ───────────────────────────────────────────────────────────
-- حزمة صلاحيات المحرِّر أغلقت الباب: من ينفّذ العمل لم يعد ينقل المخرج بين
-- المراحل، ولا يقفز بحالته، ولا يكشفه للعميل. **إغلاق بلا بديل يعطّل العمل.**
-- هذه الحزمة هي البديل: يسجّل المنفِّذ **طلبًا**، ولا يقع أيّ تغيير إلّا حين
-- يعتمده صاحب القرار. الطلب نفسه لا يغيّر شيئًا إطلاقًا.
--
-- ─── لماذا جدول جديد ولماذا واحد فقط ────────────────────────────────────────
-- قُرئت الجداول القائمة قبل أيّ سطر (انظر PREFLIGHT §6):
--   • project_approvals       — توقيع/اعتماد عامّ (internal/manager/client).
--     لا يحمل «من حالة → إلى حالة» ولا تنفيذًا ولا ضمان مرّة-واحدة، وحالاته
--     لا تعرف cancelled/expired. حشو ١٢ عمودًا فيه يفسد معناه ويكسر مستهلكيه
--     (5A/5C يقرآنه اليوم).
--   • project_change_requests — حوكمة تغيير النطاق/الجدول: ١١ حالة وتحليل أثر
--     وخطة تنفيذ ورجوع. «انقل هذا المخرج إلى مرحلة أخرى» ليس طلب تغيير نطاق،
--     ووضعه هناك يُغرق سجلّ الحوكمة بضجيج تشغيليّ يوميّ.
--   • project_decisions       — سجلّ قرارات، لا محرّك تنفيذ.
-- ⇒ جدول واحد جديد للانتقالات، ولا يُنشأ نظام موافقات ثانٍ بجانبه: القرارات
--   الإدارية تبقى في الاعتمادات، وتغيير النطاق يبقى في طلبات التغيير.
--
-- ─── القواعد المفروضة على الخادم (لا في الواجهة) ────────────────────────────
--   1) إنشاء الطلب لا يغيّر شيئًا في الهدف. إطلاقًا.
--   2) البتّ لصاحب الصلاحية وحده، و**الطالب لا يعتمد طلبه أبدًا** (ولو كان
--      مالكًا). له أن يلغيه فقط.
--   3) عند الاعتماد تُعاد قراءة الحالة الحالية: إن تغيّرت منذ الطلب يُعلَّم
--      الطلب متقادمًا ويُرفض التنفيذ — لا انتقال فوق بيانات قديمة.
--   4) التنفيذ في معاملة واحدة، مُدقَّق قبله وبعده، و**مرّة واحدة**: البتّ
--      الثاني لا يفعل شيئًا (لا تنفيذ ثانٍ) بفضل قفل الصفّ وشرط status='pending'.
--   5) الرفض لا يغيّر شيئًا. لا اعتماد تلقائيّ. لا fail-open: أيّ شكّ = رفض.
--   6) طلب معلَّق مطابق (نفس الهدف ونفس الانتقال) يُبلَّغ عنه ولا يُنشأ ثانيًا
--      (فهرس فريد جزئيّ + فحص مسبق).
--   7) المشروع المغلق يبقى مغلقًا: الطلب لا يتجاوز أيّ قاعدة قائمة، بل يمرّ
--      عبر نفس الدوالّ والحرّاس (project_core_set_stage · حارس المرحلة · CHECK).
--   8) النقل بين المشاريع يتحقّق من العميل والشجرة والصلاحية ومن غياب الدورة.
--
-- ─── العقد مع الواجهة (lib/portal/transitions.ts) — بالاسم والتوقيع ────────
--   public.project_transition_requests
--   project_transition_request_create(uuid,uuid,text,text,text,text,boolean) → jsonb
--   project_transition_requests_list(uuid,text,int) → jsonb
--   project_transition_request_decide(uuid,text,text,boolean) → jsonb
--   project_transition_can_decide(uuid) → boolean (لا NULL أبدًا)
--   p_dry_run في create/decide = **فحص وجود بلا أثر** (تعتمد عليه الواجهة
--   للكشف عن الترحيلة؛ بدونه تُقرأ PGRST202 خطأً كمنع صلاحية).
--
-- قيود: Additive · Idempotent · Transaction · بلا حذف بيانات · لا شيء لـanon ·
--   العميل لا يقرأ ولا يُشعَر · قدرة المالك والإدارة محفوظة.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
declare miss text := '';
begin
  if to_regprocedure('public.can_request_project_transition(uuid)') is null
     or to_regprocedure('public.can_approve_project_transition(uuid)') is null then
    raise exception 'PREFLIGHT: مُسنَدات الانتقال مفقودة — شغّل project_editor_permissions_RUNME.sql أوّلًا.';
  end if;
  if to_regprocedure('public.is_staff()')                is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then miss := miss || ' pc_can_read_project(uuid)'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then miss := miss || ' pc_log(...)'; end if;
  if to_regprocedure('public.project_hierarchy_root(uuid)') is null then miss := miss || ' project_hierarchy_root(uuid)'; end if;
  if to_regclass('public.deliverables') is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.project_core') is null then miss := miss || ' project_core'; end if;
  if miss <> '' then raise exception 'PREFLIGHT: اعتمادات ناقصة —%', miss; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الجدول
--
--   تسمية الأعمدة تتبع عقد الواجهة القائم (kind/from_value/to_value/
--   decided_by/decided_at/decision_note). المرادفات المفاهيمية:
--     kind          ≡ request_type        (نوع الانتقال المطلوب)
--     from_value    ≡ from_state          (الحالة وقت الطلب — يملؤها الخادم)
--     to_value      ≡ requested_state     (الحالة المطلوبة)
--     decided_by/at ≡ reviewed_by/at      · decision_note ≡ review_note
--   وأمّا from_parent_id/requested_parent_id فعمودان حقيقيّان يُملآن في نقل
--   المخرج بين المراحل ويُستعملان في إعادة الفحص عند الاعتماد — لا حشو.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.project_transition_requests (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  deliverable_id       uuid references public.deliverables(id) on delete cascade,
  target_type          text not null check (target_type in ('project','deliverable','stage')),
  target_id            uuid not null,
  kind                 text not null check (kind in ('project_stage','stage','status','client_visibility')),
  from_value           text,
  to_value             text,
  from_parent_id       uuid,
  requested_parent_id  uuid,
  reason               text not null check (length(btrim(reason)) between 3 and 2000),
  requested_by         uuid not null references auth.users(id),
  requested_at         timestamptz not null default now(),
  status               text not null default 'pending'
                       check (status in ('pending','approved','rejected','cancelled','expired')),
  decided_by           uuid references auth.users(id),
  decided_at           timestamptz,
  decision_note        text,
  executed_at          timestamptz,
  execution_result     jsonb not null default '{}'::jsonb,
  request_snapshot     jsonb not null default '{}'::jsonb,
  correlation_id       uuid not null default gen_random_uuid(),
  expires_at           timestamptz not null default (now() + interval '30 days'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.project_transition_requests is
  'طلبات انتقال حالة/مرحلة/ظهور. الطلب لا يغيّر شيئًا؛ التنفيذ عند الاعتماد فقط، '
  'مرّة واحدة، بعد إعادة فحص الحالة. ليس بديلًا عن project_approvals (اعتماد عامّ) '
  'ولا عن project_change_requests (حوكمة تغيير النطاق).';

create index if not exists ix_ptr_project_status on public.project_transition_requests(project_id, status, requested_at desc);
create index if not exists ix_ptr_deliverable    on public.project_transition_requests(deliverable_id) where deliverable_id is not null;
create index if not exists ix_ptr_requester      on public.project_transition_requests(requested_by, status);
create index if not exists ix_ptr_pending_expiry on public.project_transition_requests(expires_at) where status = 'pending';

-- الحارس القاطع ضدّ الازدواج: طلب معلَّق واحد لكلّ (مشروع، مخرج، نوع، هدف).
-- coalesce ثابتة (immutable) ⇒ صالحة في فهرس تعبيريّ.
create unique index if not exists uq_ptr_pending_target
  on public.project_transition_requests
     (project_id,
      coalesce(deliverable_id, '00000000-0000-0000-0000-000000000000'::uuid),
      kind,
      coalesce(to_value, ''))
  where status = 'pending';

-- updated_at
create or replace function public.ptr_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_ptr_touch on public.project_transition_requests;
create trigger trg_ptr_touch before update on public.project_transition_requests
  for each row execute function public.ptr_touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- §2) RLS — قراءة للكوادر المخوَّلين فقط · **لا كتابة مباشرة لأحد**
--     لا سياسة INSERT/UPDATE/DELETE عمدًا: كلّ كتابة تمرّ عبر دوالّ
--     SECURITY DEFINER التي تفرض القواعد الثمانية. سياسة كتابة واحدة هنا كانت
--     ستسمح للطالب بتعديل صفّه عبر PostgREST مباشرةً.
--     العميل: is_staff() = false له ⇒ لا يرى شيئًا، ولا يُشعَر بشيء.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_transition_requests enable row level security;

drop policy if exists ptr_read on public.project_transition_requests;
create policy ptr_read on public.project_transition_requests for select to authenticated
  using (coalesce(public.is_staff(), false) and coalesce(public.pc_can_read_project(project_id), false));

revoke all on public.project_transition_requests from public, anon;
grant select on public.project_transition_requests to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) دوالّ داخلية (لا تُمنح لأحد — تُستدعى من داخل الدوالّ العامّة فقط)
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 القيمة الحالية للهدف — مصدر الحقيقة الوحيد لـfrom_value ولفحص التقادم.
create or replace function public.ptr_current_value(p_kind text, p_project uuid, p_deliverable uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_kind = 'project_stage' then
    select core_stage into v from public.project_core where project_id = p_project;
    return v;
  end if;
  if p_deliverable is null then return null; end if;
  if p_kind = 'status' then
    select d.status into v from public.deliverables d
      where d.id = p_deliverable and coalesce(d.is_deleted,false) = false;
  elsif p_kind = 'client_visibility' then
    select case when d.client_visible then 'true' else 'false' end into v from public.deliverables d
      where d.id = p_deliverable and coalesce(d.is_deleted,false) = false;
  elsif p_kind = 'stage' then
    select d.stage_id::text into v from public.deliverables d
      where d.id = p_deliverable and coalesce(d.is_deleted,false) = false;
  end if;
  return v;
end $$;
revoke all on function public.ptr_current_value(text,uuid,uuid) from public, anon, authenticated;

-- 3.2 فحص صلاحية الهدف — يُنفَّذ عند الطلب **وعند الاعتماد** (لا يُفترض ثباته).
--     يعيد jsonb {ok, reason} ولا يرفع استثناءً ⇒ القرار يُسجَّل لا يُبتلع.
create or replace function public.ptr_target_check(p_kind text, p_project uuid, p_deliverable uuid, p_to text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_stage uuid; v_root_p uuid; v_root_s uuid; v_client_p uuid; v_client_s uuid;
  v_cur uuid; v_hops int := 0;
  v_status_vocab constant text[] := array['draft','internal_review','client_review',
    'revision_requested','approved','final_delivered','archived'];
  v_stage_vocab  constant text[] := array['lead_approved','project_created','planning','ready','scheduled',
    'in_production','post_production','internal_review','client_review','revision','approved','delivered','closed'];
begin
  if p_to is null or btrim(p_to) = '' then return jsonb_build_object('ok', false, 'reason', 'missing_target_value'); end if;

  if p_kind = 'status' then
    if p_deliverable is null then return jsonb_build_object('ok', false, 'reason', 'deliverable_required'); end if;
    if not (btrim(p_to) = any (v_status_vocab)) then return jsonb_build_object('ok', false, 'reason', 'bad_status'); end if;
    return jsonb_build_object('ok', true, 'reason', null);

  elsif p_kind = 'client_visibility' then
    if p_deliverable is null then return jsonb_build_object('ok', false, 'reason', 'deliverable_required'); end if;
    if btrim(p_to) not in ('true','false') then return jsonb_build_object('ok', false, 'reason', 'bad_visibility'); end if;
    return jsonb_build_object('ok', true, 'reason', null);

  elsif p_kind = 'project_stage' then
    if p_deliverable is not null then return jsonb_build_object('ok', false, 'reason', 'deliverable_not_allowed'); end if;
    if not (btrim(p_to) = any (v_stage_vocab)) then return jsonb_build_object('ok', false, 'reason', 'bad_stage'); end if;
    return jsonb_build_object('ok', true, 'reason', null);

  elsif p_kind = 'stage' then
    if p_deliverable is null then return jsonb_build_object('ok', false, 'reason', 'deliverable_required'); end if;
    begin v_stage := btrim(p_to)::uuid; exception when others then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage_id'); end;
    if not exists (select 1 from public.projects p where p.id = v_stage and coalesce(p.is_deleted,false) = false) then
      return jsonb_build_object('ok', false, 'reason', 'stage_not_found_or_deleted');
    end if;
    -- (أ) نفس الشجرة — نفس قاعدة trg_deliverables_stage_guard القائمة، لا قاعدة موازية.
    begin
      v_root_p := public.project_hierarchy_root(p_project);
      v_root_s := public.project_hierarchy_root(v_stage);
    exception when others then return jsonb_build_object('ok', false, 'reason', 'hierarchy_unavailable'); end;
    if v_root_p is null or v_root_s is null or v_root_p <> v_root_s then
      return jsonb_build_object('ok', false, 'reason', 'stage_must_share_project_tree');
    end if;
    -- (ب) نقل عبر المشاريع: العميل يجب أن يكون نفسه (لا تسريب بين عملاء).
    select client_id into v_client_p from public.projects where id = p_project;
    select client_id into v_client_s from public.projects where id = v_stage;
    if v_client_p is distinct from v_client_s then
      return jsonb_build_object('ok', false, 'reason', 'cross_client_move_forbidden');
    end if;
    -- (ج) سلامة الهرمية: مشي مُقيَّد صعودًا. سلسلة دائرية أو أعمق من الحدّ ⇒ رفض.
    --     (stage_id مؤشِّر داخل الشجرة لا رابط أبوّة؛ رابط الأبوّة نفسه
    --      محميّ بـtrg_projects_depth_guard/project_hierarchy_can_parent ولا
    --      يغيّره أيّ نوع انتقال هنا. هذا الفحص حزامٌ إضافيّ لا استبدال.)
    v_cur := v_stage;
    loop
      select parent_project_id into v_cur from public.projects where id = v_cur;
      exit when v_cur is null;
      v_hops := v_hops + 1;
      if v_cur = v_stage or v_hops > 20 then
        return jsonb_build_object('ok', false, 'reason', 'circular_hierarchy');
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'reason', null);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'bad_kind');
end $$;
revoke all on function public.ptr_target_check(text,uuid,uuid,text) from public, anon, authenticated;

-- 3.3 هل المشروع مغلق؟ (يستعمل الحماية القائمة إن وُجدت — لا يعيد تعريفها)
create or replace function public.ptr_project_blocked(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_project is null then return true; end if;
  if not exists (select 1 from public.projects p where p.id = p_project and coalesce(p.is_deleted,false) = false) then
    return true;
  end if;
  if to_regprocedure('public.pc_project_is_closed(uuid)') is not null then
    begin v := coalesce(public.pc_project_is_closed(p_project), false); exception when others then v := false; end;
  end if;
  return coalesce(v, false);
end $$;
revoke all on function public.ptr_project_blocked(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) من يبتّ؟ — مُسنَد عرض للواجهة. boolean صريح في كلّ مسار، ولا NULL.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_transition_can_decide(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_project is null or auth.uid() is null then return false; end if;
  begin v := coalesce(public.can_approve_project_transition(p_project), false);
  exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) إنشاء طلب — **لا يغيّر الهدف إطلاقًا**
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_transition_request_create(
  p_project    uuid,
  p_deliverable uuid,
  p_kind       text,
  p_from_value text default null,
  p_to_value   text default null,
  p_reason     text default null,
  p_dry_run    boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_kind text := btrim(coalesce(p_kind,''));
  v_to   text := nullif(btrim(coalesce(p_to_value,'')),'');
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_cur text; v_chk jsonb; v_dup uuid; v_id uuid;
  v_target_type text; v_target_id uuid;
  v_dproj uuid; v_snap jsonb; v_cur_stage uuid; v_req_parent uuid;
begin
  -- فحص وجود بلا أثر (تعتمد عليه الواجهة). أوّل سطر عمدًا: لا قراءة ولا كتابة
  -- ولا تسريب — ردٌّ ثابت يثبت وجود الدالّة بتوقيعها فقط.
  if coalesce(p_dry_run, false) then
    return jsonb_build_object('ok', false, 'request_id', null, 'status', 'dry_run',
                              'duplicate', false, 'message', 'فحص توفّر فقط — بلا أيّ أثر.');
  end if;

  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not (v_kind = any (array['project_stage','stage','status','client_visibility'])) then
    raise exception 'bad_kind: %', v_kind;
  end if;

  if not coalesce(public.can_request_project_transition(p_project), false) then
    raise exception 'not authorized';
  end if;
  if v_reason is null or length(v_reason) < 3 then raise exception 'reason_required'; end if;

  if public.ptr_project_blocked(p_project) then
    return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
      'duplicate', false, 'message', 'المشروع مغلق أو محذوف — لا يُقبل طلب انتقال عليه.');
  end if;

  -- المخرج (إن وُجد) يجب أن يكون حيًّا وتابعًا لهذا المشروع.
  if p_deliverable is not null then
    select d.project_id into v_dproj from public.deliverables d
      where d.id = p_deliverable and coalesce(d.is_deleted,false) = false;
    if v_dproj is null then
      return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
        'duplicate', false, 'message', 'المخرج غير موجود أو محذوف.');
    end if;
    if v_dproj is distinct from p_project then
      return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
        'duplicate', false, 'message', 'المخرج لا يتبع هذا المشروع.');
    end if;
  end if;

  v_chk := public.ptr_target_check(v_kind, p_project, p_deliverable, v_to);
  if not coalesce((v_chk->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
      'duplicate', false, 'message', 'هدف غير صالح: ' || coalesce(v_chk->>'reason','unknown'));
  end if;

  -- الحالة الحالية من الخادم لا من الواجهة.
  v_cur := public.ptr_current_value(v_kind, p_project, p_deliverable);
  if v_cur is not distinct from v_to then
    return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
      'duplicate', false, 'message', 'لا تغيير: القيمة المطلوبة هي القيمة الحالية.');
  end if;
  -- شاشة قديمة: الواجهة أرسلت حالةً لم تعد قائمة ⇒ لا نسجّل طلبًا مبنيًّا على وهم.
  if nullif(btrim(coalesce(p_from_value,'')),'') is not null
     and nullif(btrim(p_from_value),'') is distinct from v_cur then
    return jsonb_build_object('ok', false, 'request_id', null, 'status', 'not_created',
      'duplicate', false, 'message', 'تغيّرت الحالة منذ فتح الشاشة (الآن: ' || coalesce(v_cur,'—') || ') — حدّث الصفحة ثم أعد الطلب.');
  end if;

  -- طلب معلَّق مطابق: يُبلَّغ عنه ولا يُنشأ ثانٍ.
  select r.id into v_dup from public.project_transition_requests r
   where r.project_id = p_project
     and r.deliverable_id is not distinct from p_deliverable
     and r.kind = v_kind
     and coalesce(r.to_value,'') = coalesce(v_to,'')
     and r.status = 'pending'
   limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', true, 'request_id', v_dup, 'status', 'pending',
      'duplicate', true, 'message', 'طلب مطابق معلَّق موجود أصلًا — لم يُنشأ طلب ثانٍ.');
  end if;

  if v_kind = 'project_stage' then
    v_target_type := 'project'; v_target_id := p_project;
  else
    v_target_type := 'deliverable'; v_target_id := p_deliverable;
  end if;

  -- لقطة الحالة وقت الطلب (سجلّ لا يُعاد بناؤه لاحقًا).
  if p_deliverable is not null then
    select d.stage_id into v_cur_stage from public.deliverables d where d.id = p_deliverable;
    select jsonb_build_object('status', d.status, 'client_visible', d.client_visible,
                              'stage_id', d.stage_id, 'title', d.title)
      into v_snap from public.deliverables d where d.id = p_deliverable;
  else
    select jsonb_build_object('core_stage', pc.core_stage) into v_snap
      from public.project_core pc where pc.project_id = p_project;
  end if;
  v_snap := coalesce(v_snap, '{}'::jsonb) || jsonb_build_object('captured_at', now(), 'kind', v_kind);

  -- عمودا الأبوّة يُملآن لنقل المرحلة وحده، والتحويل هنا لا في تعبير CASE
  -- (كي لا يُقيَّم cast لقيمة ليست uuid في أنواع أخرى).
  if v_kind = 'stage' then v_req_parent := v_to::uuid; else v_req_parent := null; v_cur_stage := null; end if;

  begin
    insert into public.project_transition_requests(
      project_id, deliverable_id, target_type, target_id, kind,
      from_value, to_value, from_parent_id, requested_parent_id,
      reason, requested_by, request_snapshot)
    values (p_project, p_deliverable, v_target_type, v_target_id, v_kind,
      v_cur, v_to, v_cur_stage, v_req_parent,
      v_reason, auth.uid(), v_snap)
    returning id into v_id;
  exception when unique_violation then
    select r.id into v_dup from public.project_transition_requests r
     where r.project_id = p_project
       and r.deliverable_id is not distinct from p_deliverable
       and r.kind = v_kind and coalesce(r.to_value,'') = coalesce(v_to,'')
       and r.status = 'pending' limit 1;
    return jsonb_build_object('ok', true, 'request_id', v_dup, 'status', 'pending',
      'duplicate', true, 'message', 'طلب مطابق معلَّق موجود أصلًا — لم يُنشأ طلب ثانٍ.');
  end;

  -- تدقيق (لا يُبتلع فشله بصمت: pc_log جزء من نفس المعاملة).
  perform public.pc_log(p_project, 'transition_requested', 'transition_request', v_id,
    jsonb_build_object('kind', v_kind, 'from', v_cur, 'to', v_to,
                       'deliverable_id', p_deliverable, 'reason', v_reason));

  -- إشعار أصحاب القرار داخل البوّابة. **لا إشعار للعميل إطلاقًا.**
  -- معزول: قيد notifications.type انجرف تاريخيًّا في هذا المستودع، وسقوط إشعار
  -- يجب ألّا يُسقِط طلبًا مسجَّلًا ومُدقَّقًا.
  begin
    perform public.notify(m.user_id, 'user', 'transition_requested', 'transition_request', v_id,
      'طلب انتقال جديد بانتظار اعتمادك', 'A transition request is awaiting your approval')
    from public.project_members m
    where m.project_id = p_project and m.is_deleted = false
      and m.role in ('kian_manager','kian_admin')
      and m.user_id is distinct from auth.uid();
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'pending',
    'duplicate', false, 'message', 'سُجّل الطلب. لم يتغيّر شيء حتى الآن — التنفيذ عند الاعتماد.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) القائمة — قراءة مُثراة، معزولة لكلّ صفّ بمشروعه
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_transition_requests_list(
  p_project uuid, p_status text default 'pending', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_status text := lower(btrim(coalesce(p_status,'pending')));
        v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.is_staff(), false) then raise exception 'not authorized'; end if;
  -- مشروع لا يراه المستدعي ⇒ قائمة فارغة (لا تسريب وجود/عدم وجود).
  if p_project is null or not coalesce(public.pc_can_read_project(p_project), false) then
    return '[]'::jsonb;
  end if;
  if v_status not in ('pending','all','approved','rejected','cancelled','expired') then
    raise exception 'bad_status_filter: %', v_status;
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.requested_at desc), '[]'::jsonb) into v
  from (
    select r.id, r.project_id, p.project_name as project_name,
           r.deliverable_id, d.title as deliverable_title,
           r.kind, r.from_value, r.to_value,
           case r.kind
             when 'status' then (case r.from_value
                when 'draft' then 'مسودّة' when 'internal_review' then 'مراجعة داخلية'
                when 'client_review' then 'لدى العميل' when 'revision_requested' then 'طلب تعديل'
                when 'approved' then 'معتمد' when 'final_delivered' then 'سُلِّم نهائيًّا'
                when 'archived' then 'مؤرشف' else r.from_value end)
             when 'client_visibility' then (case when r.from_value = 'true' then 'ظاهر للعميل' else 'مخفيّ عن العميل' end)
             when 'stage' then (select sp.project_name from public.projects sp where sp.id::text = r.from_value)
             else r.from_value end as from_label,
           case r.kind
             when 'status' then (case r.to_value
                when 'draft' then 'مسودّة' when 'internal_review' then 'مراجعة داخلية'
                when 'client_review' then 'لدى العميل' when 'revision_requested' then 'طلب تعديل'
                when 'approved' then 'معتمد' when 'final_delivered' then 'سُلِّم نهائيًّا'
                when 'archived' then 'مؤرشف' else r.to_value end)
             when 'client_visibility' then (case when r.to_value = 'true' then 'ظاهر للعميل' else 'مخفيّ عن العميل' end)
             when 'stage' then (select sp.project_name from public.projects sp where sp.id::text = r.to_value)
             else r.to_value end as to_label,
           r.reason, r.status,
           r.requested_by, rq.full_name as requester_name, r.requested_at,
           r.decided_by, dc.full_name as decider_name, r.decided_at, r.decision_note,
           r.executed_at, r.execution_result, r.expires_at, r.correlation_id
    from public.project_transition_requests r
    join public.projects p on p.id = r.project_id
    left join public.deliverables d on d.id = r.deliverable_id
    left join public.profiles rq on rq.id = r.requested_by
    left join public.profiles dc on dc.id = r.decided_by
    where r.project_id = p_project
      and (v_status = 'all' or r.status = v_status)
    order by r.requested_at desc
    limit v_limit
  ) x;

  return coalesce(v, '[]'::jsonb);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) البتّ — الاعتماد وحده ينفّذ، مرّة واحدة، بعد إعادة الفحص
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_transition_request_decide(
  p_request uuid, p_decision text, p_note text default null, p_dry_run boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r public.project_transition_requests%rowtype;
  v_dec text := lower(btrim(coalesce(p_decision,'')));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_cur text; v_chk jsonb; v_n int; v_err text; v_after text;
  v_is_requester boolean; v_can boolean;
begin
  -- فحص وجود بلا أثر — أوّل سطر عمدًا (انظر create).
  if coalesce(p_dry_run, false) then
    return jsonb_build_object('ok', false, 'request_id', p_request, 'status', 'dry_run',
                              'applied', false, 'message', 'فحص توفّر فقط — بلا أيّ أثر.');
  end if;

  if auth.uid() is null then raise exception 'not authorized'; end if;
  if v_dec not in ('approve','reject') then raise exception 'bad_decision: %', v_dec; end if;

  -- قفل الصفّ: ضمان «مرّة واحدة» أمام بتّين متزامنين.
  select * into r from public.project_transition_requests where id = p_request for update;
  if not found then
    return jsonb_build_object('ok', false, 'request_id', p_request, 'status', 'not_found',
                              'applied', false, 'message', 'الطلب غير موجود.');
  end if;

  v_is_requester := (r.requested_by = auth.uid());
  v_can := coalesce(public.can_approve_project_transition(r.project_id), false);

  -- الطالب لا يعتمد طلبه أبدًا — ولو كان مالكًا. له أن يلغيه فقط.
  if v_is_requester and v_dec = 'approve' then
    raise exception 'self_approval_forbidden';
  end if;
  if not v_can and not (v_is_requester and v_dec = 'reject') then
    raise exception 'not authorized';
  end if;

  -- بتّ ثانٍ = لا شيء. لا تنفيذ ثانٍ ولا تعديل قرار سابق.
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', r.status, 'applied', false,
      'message', 'الطلب حُسم سابقًا (' || r.status || ') — لم يقع أيّ تغيير.');
  end if;

  -- انتهاء الصلاحية: لا ينفَّذ طلب قديم.
  if r.expires_at is not null and r.expires_at < now() then
    update public.project_transition_requests
       set status = 'expired', execution_result = jsonb_build_object('reason','expired','at',now())
     where id = r.id and status = 'pending';
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'expired', 'applied', false,
      'message', 'انتهت صلاحية الطلب — سجّل طلبًا جديدًا.');
  end if;

  -- ─── الرفض/الإلغاء: لا يغيّر أيّ شيء في الهدف ─────────────────────────────
  if v_dec = 'reject' then
    update public.project_transition_requests
       set status = case when v_is_requester then 'cancelled' else 'rejected' end,
           decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = r.id and status = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      return jsonb_build_object('ok', false, 'request_id', r.id, 'status', r.status, 'applied', false,
        'message', 'حُسم الطلب في نفس اللحظة من مسار آخر — لم يقع أيّ تغيير.');
    end if;
    perform public.pc_log(r.project_id,
      case when v_is_requester then 'transition_cancelled' else 'transition_rejected' end,
      'transition_request', r.id,
      jsonb_build_object('kind', r.kind, 'to', r.to_value, 'note', v_note));
    begin
      if not v_is_requester then
        perform public.notify(r.requested_by, 'user', 'transition_decided', 'transition_request', r.id,
          'رُفض طلب الانتقال', 'Your transition request was rejected');
      end if;
    exception when others then null; end;
    return jsonb_build_object('ok', true, 'request_id', r.id,
      'status', case when v_is_requester then 'cancelled' else 'rejected' end,
      'applied', false, 'message', 'لم يتغيّر شيء في المشروع أو المخرج.');
  end if;

  -- ─── الاعتماد ─────────────────────────────────────────────────────────────
  -- (1) المشروع ما زال مفتوحًا وقواعده كما هي — الطلب لا يتجاوزها.
  if public.ptr_project_blocked(r.project_id) then
    update public.project_transition_requests
       set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
           execution_result = jsonb_build_object('reason','project_closed_or_deleted','at',now())
     where id = r.id and status = 'pending';
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'cancelled', 'applied', false,
      'message', 'المشروع مغلق أو محذوف — لا يُنفَّذ الطلب ولا يتجاوز قواعد الإغلاق.');
  end if;

  -- (2) ★ إعادة قراءة الحالة الحالية ★ — لا انتقال فوق بيانات متقادمة.
  v_cur := public.ptr_current_value(r.kind, r.project_id, r.deliverable_id);
  if v_cur is distinct from r.from_value then
    update public.project_transition_requests
       set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
           execution_result = jsonb_build_object('reason','stale_conflict',
             'expected', r.from_value, 'actual', v_cur, 'at', now())
     where id = r.id and status = 'pending';
    perform public.pc_log(r.project_id, 'transition_stale_conflict', 'transition_request', r.id,
      jsonb_build_object('kind', r.kind, 'expected', r.from_value, 'actual', v_cur));
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'cancelled', 'applied', false,
      'message', 'تغيّرت الحالة منذ الطلب (المتوقّع: ' || coalesce(r.from_value,'—') ||
                 ' · الحالي: ' || coalesce(v_cur,'—') || ') — أُلغي الطلب ولم يُنفَّذ. سجّل طلبًا جديدًا.');
  end if;

  -- (3) الهدف ما زال صالحًا (شجرة/عميل/مفردات/دورة).
  v_chk := public.ptr_target_check(r.kind, r.project_id, r.deliverable_id, r.to_value);
  if not coalesce((v_chk->>'ok')::boolean, false) then
    update public.project_transition_requests
       set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
           execution_result = jsonb_build_object('reason', coalesce(v_chk->>'reason','invalid_target'), 'at', now())
     where id = r.id and status = 'pending';
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'cancelled', 'applied', false,
      'message', 'لم يعد الهدف صالحًا: ' || coalesce(v_chk->>'reason','unknown') || ' — لم يُنفَّذ شيء.');
  end if;

  -- (3b) ★ الاعتماد ليس طريقًا لاكتساب قدرة ★
  --      المعتمِد يجب أن يملك **قدرة الإجراء نفسه** لا مجرّد قدرة البتّ، وإلّا
  --      صار مفتاح transitions.approve بابًا خلفيًّا يمنح ما لم يُمنَح صراحةً.
  --      المالك/الإدارة/المدير يملكون الثلاثة أصلًا ⇒ لا أثر عليهم إطلاقًا.
  --      يبقى الطلب معلَّقًا (لا يُلغى) كي يبتّ فيه من يملك القدرة فعلًا.
  if (r.kind = 'stage'             and not coalesce(public.can_move_deliverable(r.project_id), false))
  or (r.kind = 'client_visibility' and not coalesce(public.can_send_to_client_review(r.project_id), false))
  or (r.kind = 'status'            and not coalesce(public.can_finalize_deliverable(r.project_id), false))
  or (r.kind = 'project_stage'     and not coalesce(public.can_move_project_stage(r.project_id), false)) then
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'pending', 'applied', false,
      'message', 'لا تملك صلاحية تنفيذ هذا الإجراء بنفسك، فلا تملك اعتماده. بقي الطلب معلَّقًا بلا تغيير.');
  end if;

  -- (4) تدقيق **قبل** التنفيذ.
  perform public.pc_log(r.project_id, 'transition_execute_begin', 'transition_request', r.id,
    jsonb_build_object('kind', r.kind, 'from', r.from_value, 'to', r.to_value,
                       'deliverable_id', r.deliverable_id, 'decided_by', auth.uid()));

  -- (5) التنفيذ — كتلة فرعية: فشلها لا يُسقط السجلّ ولا يُخفى.
  v_err := null;
  begin
    if r.kind = 'status' then
      update public.deliverables set status = r.to_value
       where id = r.deliverable_id and status = r.from_value and coalesce(is_deleted,false) = false;
      get diagnostics v_n = row_count;
      if v_n <> 1 then v_err := 'row_changed_during_execute'; end if;

    elsif r.kind = 'client_visibility' then
      update public.deliverables set client_visible = (r.to_value = 'true')
       where id = r.deliverable_id and client_visible = (r.from_value = 'true')
         and coalesce(is_deleted,false) = false;
      get diagnostics v_n = row_count;
      if v_n <> 1 then v_err := 'row_changed_during_execute'; end if;

    elsif r.kind = 'stage' then
      -- حارس المرحلة القائم (trg_deliverables_stage_guard) يبقى الفاصل النهائيّ.
      update public.deliverables set stage_id = r.to_value::uuid
       where id = r.deliverable_id and stage_id is not distinct from r.from_parent_id
         and coalesce(is_deleted,false) = false;
      get diagnostics v_n = row_count;
      if v_n <> 1 then v_err := 'row_changed_during_execute'; end if;

    elsif r.kind = 'project_stage' then
      -- المسار الفائز القائم: كلّ حرّاسه تُطبَّق بهويّة المعتمِد لا الطالب.
      perform public.project_core_set_stage(r.project_id, r.to_value,
                coalesce(v_note, r.reason));
    else
      v_err := 'bad_kind';
    end if;
  exception when others then
    v_err := coalesce(nullif(btrim(sqlerrm),''), 'execute_failed');
  end;

  if v_err is not null then
    -- يبقى معلَّقًا: الفشل قد يكون عارضًا (حارس/قيد) ويستحقّ محاولة واعية.
    update public.project_transition_requests
       set execution_result = jsonb_build_object('reason','execution_failed','error', v_err,
             'attempted_by', auth.uid(), 'at', now())
     where id = r.id and status = 'pending';
    perform public.pc_log(r.project_id, 'transition_execute_failed', 'transition_request', r.id,
      jsonb_build_object('kind', r.kind, 'error', v_err));
    return jsonb_build_object('ok', false, 'request_id', r.id, 'status', 'pending', 'applied', false,
      'message', 'لم يُنفَّذ الطلب: ' || v_err || '. بقي معلَّقًا ولم يتغيّر شيء.');
  end if;

  -- (6) الحسم الذرّيّ — شرط status='pending' هو ضمان «مرّة واحدة» الثاني.
  v_after := public.ptr_current_value(r.kind, r.project_id, r.deliverable_id);
  update public.project_transition_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         executed_at = now(),
         execution_result = jsonb_build_object('before', r.from_value, 'after', v_after,
                                               'kind', r.kind, 'at', now())
   where id = r.id and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- لا يُترك تنفيذ بلا سجلّ: نُجهض المعاملة كاملةً (يُلغى التغيير أيضًا).
    raise exception 'transition_record_conflict: تعذّر حسم الطلب بعد التنفيذ — أُلغيت المعاملة.';
  end if;

  -- (7) تدقيق **بعد** التنفيذ + إشعار الطالب (لا إشعار للعميل).
  perform public.pc_log(r.project_id, 'transition_executed', 'transition_request', r.id,
    jsonb_build_object('kind', r.kind, 'from', r.from_value, 'to', r.to_value,
                       'after', v_after, 'decided_by', auth.uid()));
  begin
    perform public.notify(r.requested_by, 'user', 'transition_decided', 'transition_request', r.id,
      'اعتُمد طلب الانتقال ونُفِّذ', 'Your transition request was approved and applied');
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'request_id', r.id, 'status', 'approved', 'applied', true,
    'message', 'اعتُمد الطلب ونُفِّذ. الحالة الآن: ' || coalesce(v_after,'—'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) صيانة — انتهاء صلاحية الطلبات المعلَّقة. لا يغيّر أيّ هدف.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_transition_requests_expire(p_limit int default 500)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0; v_limit int := least(greatest(coalesce(p_limit,500),1),5000);
begin
  if not (coalesce(public.is_admin(),false) or coalesce(public.can_manage_projects(),false)) then
    raise exception 'not authorized';
  end if;
  update public.project_transition_requests t
     set status = 'expired',
         execution_result = jsonb_build_object('reason','expired','at',now())
   where t.id in (select id from public.project_transition_requests
                   where status = 'pending' and expires_at < now()
                   order by expires_at asc limit v_limit);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'expired', v_n, 'at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) الصلاحيات — لا شيء لـanon، أبدًا
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text;
begin
  foreach f in array array[
    'public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)',
    'public.project_transition_requests_list(uuid,text,int)',
    'public.project_transition_request_decide(uuid,text,text,boolean)',
    'public.project_transition_can_decide(uuid)',
    'public.project_transition_requests_expire(int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;
  -- الصيانة وحدها تُمنح لـservice_role (تشغيل دوريّ) — لا الكتابة التشغيلية.
  begin execute 'grant execute on function public.project_transition_requests_expire(int) to service_role';
  exception when undefined_object then null; end;
end $g$;

-- الدوالّ الداخلية: لا تُمنح لأحد (تُنفَّذ ضمن سلسلة SECURITY DEFINER فقط).
revoke all on function public.ptr_current_value(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.ptr_target_check(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.ptr_project_blocked(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) SELF-TEST — بلا أيّ أثر على بيانات المشاريع. الفشل يُلغي المعاملة.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare f text; v jsonb; v_b boolean; v_before bigint; v_after bigint; v_def text;
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if to_regclass('public.project_transition_requests') is null then
    raise exception 'SELF-TEST: الجدول لم يُنشأ'; end if;

  foreach f in array array[
    'public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)',
    'public.project_transition_requests_list(uuid,text,int)',
    'public.project_transition_request_decide(uuid,text,text,boolean)',
    'public.project_transition_can_decide(uuid)',
    'public.project_transition_requests_expire(int)'
  ] loop
    if to_regprocedure(f) is null then raise exception 'SELF-TEST: % لم تُنشأ', f; end if;
  end loop;

  -- (1) مُسنَد العرض لا يعيد NULL أبدًا.
  v_b := public.project_transition_can_decide(null);
  if v_b is null then raise exception 'SELF-TEST: can_decide أعادت NULL'; end if;

  -- (2) و(3) — **فحص نصّيّ لا استدعاء حيّ.**
  --
  -- ★ هنا كان الملفّ سيموت مثل حزمة الصلاحيات تمامًا. ★
  --   كان القسمان يستدعيان project_transition_request_create/decide فعليًّا،
  --   وأوّل ما تفعله كلّ منهما هو التحقّق من الجلسة. ومحرّر SQL يعمل بدور
  --   `postgres` بلا جلسة GoTrue ⇒ auth.uid() = NULL ⇒ «not authorized»
  --   قبل بلوغ أيّ منطق، فتتراجع المعاملة كلّها.
  --
  --   وكان القسم (3) أسوأ من ذلك: ملفوفًا بـ`exception when others then v_b := true`
  --   ⇒ **ينجح مهما حدث**. اختبار لا يستطيع الفشل ليس اختبارًا؛ يطبع PASS
  --   ولا يُثبت شيئًا. حُذف الالتفاف ولم يُستبدل بمثله.
  --
  --   الإثبات السلوكيّ الحقيقيّ — بجلستَي مونتير ومالك — في:
  --     docs/project_editor_permissions_BEHAVIOR_DIAGNOSTIC.sql
  --   ولا يُقال إنه نجح قبل تشغيله بهما فعلًا.
  v_def := pg_get_functiondef(to_regprocedure(
    'public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)'));
  if v_def not ilike '%auth.uid() is null%' then
    raise exception 'SELF-TEST: بوّابة الجلسة غائبة عن create'; end if;
  if v_def not ilike '%p_dry_run%' and v_def not ilike '%v_dry%' then
    raise exception 'SELF-TEST: مسار dry_run غائب عن create'; end if;
  if v_def not ilike '%can_request_project_transition%' then
    raise exception 'SELF-TEST: create لا تفحص قدرة الطلب'; end if;

  v_def := pg_get_functiondef(to_regprocedure(
    'public.project_transition_request_decide(uuid,text,text,boolean)'));
  if v_def not ilike '%auth.uid() is null%' then
    raise exception 'SELF-TEST: بوّابة الجلسة غائبة عن decide'; end if;
  if v_def not ilike '%can_approve_project_transition%' then
    raise exception 'SELF-TEST: decide لا تفحص قدرة الاعتماد'; end if;
  -- منع اعتماد صاحب الطلب نفسه — الحارس الذي لا يجوز أن يغيب.
  if v_def not ilike '%requested_by%' then
    raise exception 'SELF-TEST: decide لا تقارن بمقدّم الطلب — الاعتماد الذاتيّ ممكن'; end if;
  -- إعادة التحقّق من الحالة الحالية قبل التنفيذ (منع الطلب البائت).
  if v_def not ilike '%ptr_current_value%' then
    raise exception 'SELF-TEST: decide لا تُعيد التحقّق من الحالة — تنفيذ على بيانات قديمة'; end if;
  -- التنفيذ مرّة واحدة: قفل الصفّ + شرط pending.
  if v_def not ilike '%for update%' or v_def not ilike '%pending%' then
    raise exception 'SELF-TEST: decide بلا قفل/شرط pending — تنفيذ مزدوج ممكن'; end if;

  -- الجدول فارغ فعلًا: الترحيل يجب ألّا يُنشئ أيّ طلب.
  select count(*) into v_after from public.project_transition_requests;
  if v_after <> 0 then
    raise exception 'SELF-TEST: الترحيل أنشأ % طلبًا — يجب ألّا يُنشئ شيئًا', v_after; end if;

  -- (4) فحص الهدف يرفض المفردات المخترعة ويقبل القائمة.
  if coalesce((public.ptr_target_check('status', ZERO, ZERO, 'shipped')->>'ok')::boolean, true) is not false then
    raise exception 'SELF-TEST: قُبلت حالة خارج المفردات'; end if;
  if coalesce((public.ptr_target_check('status', ZERO, ZERO, 'approved')->>'ok')::boolean, false) is not true then
    raise exception 'SELF-TEST: رُفضت حالة صحيحة'; end if;
  if coalesce((public.ptr_target_check('project_stage', ZERO, ZERO, 'delivered')->>'ok')::boolean, true) is not false then
    raise exception 'SELF-TEST: قُبل انتقال مرحلة مع مخرج (deliverable_not_allowed)'; end if;

  -- (5) لا سياسة كتابة على الجدول (كلّ كتابة عبر الدوالّ).
  if exists (select 1 from pg_policies where schemaname='public'
              and tablename='project_transition_requests' and cmd <> 'SELECT') then
    raise exception 'SELF-TEST: توجد سياسة كتابة مباشرة على الجدول'; end if;

  -- (6) الفهرس الفريد الجزئيّ قائم (الحارس القاطع ضدّ الازدواج).
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and tablename='project_transition_requests' and indexname='uq_ptr_pending_target') then
    raise exception 'SELF-TEST: فهرس منع الازدواج غائب'; end if;

  raise notice 'SELF-TEST: نجح — الطلب لا ينفّذ، والبتّ ينفّذ مرّة واحدة بعد إعادة الفحص.';
end $st$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: project_transition_approval_POSTCHECK.sql
-- اختياريّ (تشغيل دوريّ): select public.project_transition_requests_expire(500);
-- ════════════════════════════════════════════════════════════════════════════
