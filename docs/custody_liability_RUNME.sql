-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-2: CUSTODY LIABILITY / REPAIR / COMPENSATION  (RUN ONCE)
--
-- Operational liability ledger for custody returns — SEPARATE from Zoho/project
-- accounting. Never auto-posts to Zoho, never a payroll deduction without the
-- explicit approved workflow below.
--
-- VISIBILITY SAFETY (the core requirement):
--   • custody_liabilities RLS grants SELECT ONLY to the custody-manage tier
--     (civ_can_manage()). Employees have NO direct table policy → they can never
--     read the raw row (PostgREST RLS is row-level, so hiding a column via a policy
--     is impossible; the only safe design is to deny the row and serve a REDACTED
--     projection through a SECURITY DEFINER RPC).
--   • custody_liability_my() / _get() return the employee ONLY their own rows, with
--     amount = NULL when show_to_employee = false (NULL, not merely hidden in UI),
--     internal_note ALWAYS NULL, and only when show_to_employee is on.
--   • Financial decisions (approve/waive/paid/deducted) require civ_can_admin() OR
--     the granular key custody.approve_compensation — a plain Custody Manager cannot
--     approve compensation unless explicitly granted.
--
-- Idempotent · non-destructive. Depends on: custody_inventory_assignments,
-- custody_inventory_assets, civ_can_manage(), civ_can_admin(), civ_notify /
-- civ_notify_managers, auth.users, profiles. emp_has_permission is optional.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.custody_inventory_assignments') is null then miss := miss || ' custody_inventory_assignments'; end if;
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage()'; end if;
  if to_regprocedure('public.civ_can_admin()')  is null then miss := miss || ' civ_can_admin()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل custody v1 + bridge.', miss; end if;
end $pf$;

begin;

-- ═══ 1) الجداول ═══
create table if not exists public.custody_liabilities (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid references public.custody_inventory_assignments(id) on delete set null,
  return_case_id     uuid,                                   -- = assignment_id للحالة، أو مرجع لاحق
  assignment_item_id uuid,
  employee_user_id   uuid not null references auth.users(id),
  asset_id           uuid references public.custody_inventory_assets(id) on delete set null,
  liability_type     text not null check (liability_type in ('repair','missing_accessory','asset_damage','missing_asset','replacement','other')),
  amount             numeric,
  currency           text not null default 'SAR',
  calculation_basis  text,
  description        text,
  internal_note      text,                                   -- لا يُكشف للموظف أبدًا
  show_to_employee   boolean not null default false,
  due_date           timestamptz,
  status             text not null default 'draft'
                     check (status in ('draft','pending_admin_approval','approved','disputed','waived','paid','deducted','closed')),
  employee_evidence  jsonb not null default '[]'::jsonb,     -- مسارات أدلة الموظف (اعتراض)
  created_by         uuid references auth.users(id),
  approved_by        uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  approved_at        timestamptz,
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists idx_cust_liab_emp on public.custody_liabilities(employee_user_id) where deleted_at is null;
create index if not exists idx_cust_liab_asg on public.custody_liabilities(assignment_id);
create index if not exists idx_cust_liab_status on public.custody_liabilities(status) where deleted_at is null;

create table if not exists public.custody_liability_events (
  id              uuid primary key default gen_random_uuid(),
  liability_id    uuid not null references public.custody_liabilities(id) on delete cascade,
  actor_id        uuid references auth.users(id),
  event_type      text not null,
  previous_status text,
  new_status      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_cust_liab_ev on public.custody_liability_events(liability_id, created_at);

-- ═══ 2) مساعد داخلي: تسجيل حدث ═══
create or replace function public.custody_liability_log(p_liab uuid, p_event text, p_prev text, p_new text, p_meta jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.custody_liability_events(liability_id, actor_id, event_type, previous_status, new_status, metadata)
    values (p_liab, auth.uid(), p_event, p_prev, p_new, coalesce(p_meta,'{}'::jsonb));
exception when others then return;
end $$;

-- صلاحية القرارات المالية: أدمن/مالك أو مفتاح صريح (لا يكفي مدير عهدة عادي).
create or replace function public.custody_liability_can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select public.civ_can_admin()
    or (to_regprocedure('public.emp_has_permission(uuid,text)') is not null
        and public.emp_has_permission(auth.uid(), 'custody.approve_compensation'));
$$;

-- ═══ 3) إنشاء التزام (مدير عهدة) — يبدأ draft ═══
create or replace function public.custody_liability_create(p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_emp uuid; v_asg uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_asg := nullif(p_data->>'assignment_id','')::uuid;
  v_emp := nullif(p_data->>'employee_user_id','')::uuid;
  if v_emp is null and v_asg is not null then
    select employee_user_id into v_emp from public.custody_inventory_assignments where id = v_asg;
  end if;
  if v_emp is null then raise exception 'employee_required'; end if;
  if coalesce(p_data->>'liability_type','') = '' then raise exception 'type_required'; end if;
  insert into public.custody_liabilities(assignment_id, return_case_id, assignment_item_id, employee_user_id, asset_id,
      liability_type, amount, currency, calculation_basis, description, internal_note, show_to_employee, due_date, status, created_by)
    values (v_asg, coalesce(nullif(p_data->>'return_case_id','')::uuid, v_asg), nullif(p_data->>'assignment_item_id','')::uuid,
      v_emp, nullif(p_data->>'asset_id','')::uuid, p_data->>'liability_type',
      nullif(p_data->>'amount','')::numeric, coalesce(nullif(p_data->>'currency',''),'SAR'),
      nullif(btrim(p_data->>'calculation_basis'),''), nullif(btrim(p_data->>'description'),''),
      nullif(btrim(p_data->>'internal_note'),''), coalesce((p_data->>'show_to_employee')::boolean, false),
      nullif(p_data->>'due_date','')::timestamptz, 'draft', auth.uid())
    returning id into v_id;
  perform public.custody_liability_log(v_id, 'created', null, 'draft', jsonb_build_object('amount', p_data->>'amount', 'type', p_data->>'liability_type'));
  perform public.civ_notify_managers('custody_liability_created', v_asg, 'سُجّل التزام عهدة جديد', 'A custody liability was registered');
  if coalesce((p_data->>'show_to_employee')::boolean, false) then
    perform public.civ_notify(v_emp, 'custody_liability_created', v_asg, 'سُجّلت حالة على عهدتك — راجع بوابتك', 'A charge case was registered on your custody — check your portal');
  else
    perform public.civ_notify(v_emp, 'custody_liability_created', v_asg, 'حالة إرجاع عهدتك قيد المراجعة', 'Your custody return case is under review');
  end if;
  return v_id;
end $$;

-- ═══ 4) تعديل الحقول (مدير عهدة) — لا يغيّر الحالة ═══
create or replace function public.custody_liability_amend(p_id uuid, p_data jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into v from public.custody_liabilities where id = p_id and deleted_at is null;
  if v.id is null then raise exception 'not_found'; end if;
  if v.status in ('paid','deducted','closed') then raise exception 'locked_status'; end if;
  update public.custody_liabilities set
    amount            = case when p_data ? 'amount' then nullif(p_data->>'amount','')::numeric else amount end,
    currency          = coalesce(nullif(p_data->>'currency',''), currency),
    calculation_basis = case when p_data ? 'calculation_basis' then nullif(btrim(p_data->>'calculation_basis'),'') else calculation_basis end,
    description       = case when p_data ? 'description' then nullif(btrim(p_data->>'description'),'') else description end,
    liability_type    = coalesce(nullif(p_data->>'liability_type',''), liability_type),
    due_date          = case when p_data ? 'due_date' then nullif(p_data->>'due_date','')::timestamptz else due_date end,
    updated_at        = now()
    where id = p_id;
  perform public.custody_liability_log(p_id, 'amended', v.status, v.status, jsonb_build_object('amount', p_data->>'amount'));
  return true;
end $$;

-- إظهار/إخفاء المبلغ للموظف (مدير عهدة).
create or replace function public.custody_liability_set_visibility(p_id uuid, p_show boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into v from public.custody_liabilities where id = p_id and deleted_at is null;
  if v.id is null then raise exception 'not_found'; end if;
  update public.custody_liabilities set show_to_employee = coalesce(p_show,false), updated_at = now() where id = p_id;
  perform public.custody_liability_log(p_id, case when p_show then 'shown_to_employee' else 'hidden_from_employee' end, v.status, v.status, '{}'::jsonb);
  perform public.civ_notify(v.employee_user_id, 'custody_liability_visibility',
    v.assignment_id, case when p_show then 'تم مشاركة تفاصيل حالة العهدة معك' else 'حالة عهدتك قيد المراجعة' end,
    case when p_show then 'Custody case details were shared with you' else 'Your custody case is under review' end);
  return true;
end $$;

-- ملاحظة داخلية (مدير عهدة) — لا تُكشف للموظف.
create or replace function public.custody_liability_set_internal_note(p_id uuid, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_liabilities set internal_note = nullif(btrim(p_note),''), updated_at = now()
    where id = p_id and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
  perform public.custody_liability_log(p_id, 'internal_note', null, null, '{}'::jsonb);
  return true;
end $$;

-- ═══ 5) انتقال الحالة — القرارات المالية تتطلب صلاحية أعلى ═══
create or replace function public.custody_liability_set_status(p_id uuid, p_status text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; v_financial boolean;
begin
  select * into v from public.custody_liabilities where id = p_id and deleted_at is null;
  if v.id is null then raise exception 'not_found'; end if;
  if p_status not in ('draft','pending_admin_approval','approved','disputed','waived','paid','deducted','closed')
    then raise exception 'bad_status'; end if;
  v_financial := p_status in ('approved','waived','paid','deducted');
  -- draft→pending_admin_approval + closed reachable by a manager; financial states need approver.
  if v_financial then
    if not public.custody_liability_can_approve() then raise exception 'not authorized: compensation'; end if;
  else
    if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  end if;
  update public.custody_liabilities set
    status = p_status,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    updated_at = now()
    where id = p_id;
  perform public.custody_liability_log(p_id, 'status_changed', v.status, p_status, jsonb_build_object('note', left(coalesce(p_note,''),500)));
  -- إشعارات: الإدارة دائمًا؛ الموظف فقط إذا كانت مرئية.
  perform public.civ_notify_managers('custody_liability_'||p_status, v.assignment_id, 'تحديث حالة التزام العهدة', 'Custody liability updated');
  if v.show_to_employee then
    perform public.civ_notify(v.employee_user_id, 'custody_liability_'||p_status, v.assignment_id,
      'تحديث على حالة عهدتك: '||p_status, 'Your custody case was updated: '||p_status);
  end if;
  return true;
end $$;

-- ═══ 6) رد الموظف: اعتراض / قبول / تعليق + رفع دليل ═══
create or replace function public.custody_liability_employee_respond(p_id uuid, p_action text, p_comment text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.custody_liabilities where id = p_id and deleted_at is null;
  if v.id is null then raise exception 'not_found'; end if;
  if auth.uid() <> v.employee_user_id then raise exception 'not_your_case'; end if;
  if not v.show_to_employee then raise exception 'not_visible'; end if;   -- لا يتفاعل مع حالة مخفية
  if p_action not in ('dispute','accept','comment') then raise exception 'bad_action'; end if;
  if p_action = 'dispute' then
    update public.custody_liabilities set status = 'disputed', updated_at = now()
      where id = p_id and status in ('approved','pending_admin_approval','draft');
    perform public.custody_liability_log(p_id, 'employee_disputed', v.status, 'disputed', jsonb_build_object('comment', left(coalesce(p_comment,''),1000)));
    perform public.civ_notify_managers('custody_liability_disputed', v.assignment_id, 'اعترض الموظف على حالة العهدة', 'Employee disputed the custody case');
  else
    perform public.custody_liability_log(p_id, 'employee_'||p_action, v.status, v.status, jsonb_build_object('comment', left(coalesce(p_comment,''),1000)));
    perform public.civ_notify_managers('custody_liability_comment', v.assignment_id, 'رد الموظف على حالة العهدة', 'Employee responded on the custody case');
  end if;
  return true;
end $$;

-- رفع دليل الموظف (مسار تخزين) — على حالته المرئية فقط.
create or replace function public.custody_liability_add_employee_evidence(p_id uuid, p_path text, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.custody_liabilities where id = p_id and deleted_at is null;
  if v.id is null then raise exception 'not_found'; end if;
  if auth.uid() <> v.employee_user_id then raise exception 'not_your_case'; end if;
  if not v.show_to_employee then raise exception 'not_visible'; end if;
  if coalesce(btrim(p_path),'') = '' then raise exception 'path_required'; end if;
  update public.custody_liabilities set employee_evidence = employee_evidence ||
      jsonb_build_array(jsonb_build_object('path', btrim(p_path), 'note', nullif(btrim(p_note),''), 'at', now())),
      updated_at = now() where id = p_id;
  perform public.custody_liability_log(p_id, 'employee_evidence_added', v.status, v.status, '{}'::jsonb);
  perform public.civ_notify_managers('custody_liability_comment', v.assignment_id, 'أضاف الموظف دليلًا على حالة العهدة', 'Employee added evidence to the custody case');
  return true;
end $$;

-- ═══ 7) قراءات: إدارية كاملة / موظف مُنقّحة ═══
-- إدارية: بيانات كاملة (مدير عهدة).
create or replace function public.custody_liability_admin_list(p_status text default null, p_employee uuid default null, p_assignment uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select l.*, (select full_name from public.profiles where id = l.employee_user_id) as employee_name,
             (select asset_name from public.custody_inventory_assets where id = l.asset_id) as asset_name
      from public.custody_liabilities l
      where l.deleted_at is null
        and (p_status is null or l.status = p_status)
        and (p_employee is null or l.employee_user_id = p_employee)
        and (p_assignment is null or l.assignment_id = p_assignment)
    ) x
  ), '[]'::jsonb);
end $$;

-- موظف: التزاماته فقط، مُنقّحة (amount=NULL إن مخفية؛ internal_note لا يُعاد أبدًا).
create or replace function public.custody_liability_my()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select l.id, l.assignment_id, l.asset_id, l.liability_type,
             case when l.show_to_employee then l.amount else null end as amount,
             case when l.show_to_employee then l.currency else null end as currency,
             case when l.show_to_employee then l.calculation_basis else null end as calculation_basis,
             case when l.show_to_employee then l.description else null end as description,
             l.due_date, l.status, l.show_to_employee, l.created_at, l.updated_at,
             case when l.show_to_employee then l.employee_evidence else '[]'::jsonb end as employee_evidence,
             (select asset_name from public.custody_inventory_assets where id = l.asset_id) as asset_name
             -- internal_note intentionally NEVER selected
      from public.custody_liabilities l
      where l.deleted_at is null and l.employee_user_id = v_uid
    ) x
  ), '[]'::jsonb);
end $$;

-- سجل أحداث التزام (مدير عهدة).
create or replace function public.custody_liability_events_list(p_liab uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(row_to_json(e) order by e.created_at)
    from (select ev.*, (select full_name from public.profiles where id = ev.actor_id) as actor_name
          from public.custody_liability_events ev where ev.liability_id = p_liab) e), '[]'::jsonb);
end $$;

-- ═══ 8) RLS — الجدول للمُدير فقط؛ الموظف عبر RPC المُنقّح فقط ═══
alter table public.custody_liabilities       enable row level security;
alter table public.custody_liability_events  enable row level security;

drop policy if exists cust_liab_read on public.custody_liabilities;
create policy cust_liab_read on public.custody_liabilities for select to authenticated
  using (public.civ_can_manage());   -- الموظف ليس له سياسة → لا يقرأ الصف مطلقًا (لا تسريب المبلغ)

drop policy if exists cust_liab_ev_read on public.custody_liability_events;
create policy cust_liab_ev_read on public.custody_liability_events for select to authenticated
  using (public.civ_can_manage());
-- كل الكتابة عبر RPCs (SECURITY DEFINER) — لا سياسات كتابة.

-- ═══ 9) Grants ═══
grant select on public.custody_liabilities, public.custody_liability_events to authenticated;
do $g$
declare f text;
begin
  foreach f in array array[
    'public.custody_liability_create(jsonb)',
    'public.custody_liability_amend(uuid,jsonb)',
    'public.custody_liability_set_visibility(uuid,boolean)',
    'public.custody_liability_set_internal_note(uuid,text)',
    'public.custody_liability_set_status(uuid,text,text)',
    'public.custody_liability_employee_respond(uuid,text,text)',
    'public.custody_liability_add_employee_evidence(uuid,text,text)',
    'public.custody_liability_admin_list(text,uuid,uuid)',
    'public.custody_liability_my()',
    'public.custody_liability_events_list(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- internal helpers: not client-callable.
  execute 'revoke all on function public.custody_liability_log(uuid,text,text,text,jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.custody_liability_can_approve() from public, anon';
  execute 'grant execute on function public.custody_liability_can_approve() to authenticated';
end $g$;

-- ═══ 10) VALIDATION ═══
do $v$
declare miss text := '';
begin
  if to_regclass('public.custody_liabilities')      is null then miss := miss || ' custody_liabilities'; end if;
  if to_regclass('public.custody_liability_events') is null then miss := miss || ' custody_liability_events'; end if;
  if to_regprocedure('public.custody_liability_my()')                 is null then miss := miss || ' custody_liability_my'; end if;
  if to_regprocedure('public.custody_liability_set_status(uuid,text,text)') is null then miss := miss || ' custody_liability_set_status'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.custody_liabilities'::regclass) then miss := miss || ' RLS(custody_liabilities)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
