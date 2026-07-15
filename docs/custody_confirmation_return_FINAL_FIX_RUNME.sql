-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — إصلاح مسار تأكيد استلام العهدة وإرجاعها (نظام مخزون الأصول)
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة: عهدة pending_employee_confirmation تبقى عالقة — الموظف يؤكّد عبر RPC
-- موجودة (custody_inv_employee_confirm_assignment) لكن لا واجهة له، والأدمن لا يملك
-- أي RPC للتأكيد الإداري/بدء الإرجاع/الإلغاء/إعادة التذكير. هذا الملف يضيف دوال
-- الأدمن الأربع فقط (لا نظام موازٍ؛ يعيد استخدام نفس الجداول والحركات والإشعارات).
--
-- نموذج المخزون: custody_inv_admin_create_assignment يخصم quantity_available وقت
-- الصرف؛ فالتأكيد/بدء الإرجاع لا يمسّان المخزون، والإلغاء قبل التأكيد يُعيده.
-- الصلاحية: civ_can_manage() (المالك/سوبر أدمن/admin/مدير/أمين عهدة). لا anon.
-- idempotent، غير هدّام، بلا Fixtures، لا يعيد Foundation، لا يلمس التأجير.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.civ_can_manage()') is null
     or to_regprocedure('public.civ_notify_managers(text,uuid,text,text)') is null
     or to_regclass('public.custody_inventory_assignments') is null
     or to_regclass('public.custody_inventory_movements') is null then
    raise exception 'PREFLIGHT: أساس مخزون الأصول/الإشعارات غير مطبّق';
  end if;
end $$;

begin;

-- أعمدة تدقيق التأكيد الإداري.
alter table public.custody_inventory_assignments add column if not exists admin_confirmed_by uuid references auth.users(id);
alter table public.custody_inventory_assignments add column if not exists admin_confirmed_reason text;

-- ═══ 1) تأكيد الاستلام إداريًا (pending_employee_confirmation → active) ═══
-- سبب إلزامي + اسم المستلم + وجود دليل تسليم. لا يزوّر توقيع الموظف (يُسجَّل admin_confirmed_by).
create or replace function public.custody_inv_admin_confirm_assignment(p_assignment uuid, p_employee_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_has_ev boolean;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending_employee_confirmation' then raise exception 'not_pending'; end if;
  select exists (select 1 from public.custody_inventory_evidence e
    where e.assignment_id = p_assignment and e.evidence_stage in ('issue_admin','issue_employee') and coalesce(e.is_deleted,false) = false)
    into v_has_ev;
  if not v_has_ev then raise exception 'handover_evidence_required'; end if;

  update public.custody_inventory_assignments
     set status = 'active', employee_confirmed_at = now(),
         ack_name = nullif(btrim(p_employee_name),''), ack_snapshot = 'تأكيد إداري: '||left(p_reason,300),
         admin_confirmed_by = auth.uid(), admin_confirmed_reason = p_reason, updated_at = now()
   where id = p_assignment;
  update public.custody_inventory_assignment_items set status = 'active', updated_at = now()
   where assignment_id = p_assignment and status = 'pending';
  insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, reason, created_by, to_employee_id)
    select i.asset_id, i.assignment_id, i.id, 'employee_confirmed', 'تأكيد إداري نيابة عن الموظف', auth.uid(), r.employee_user_id
      from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment;
  perform public.civ_notify(r.employee_user_id, 'civ_employee_confirmed', p_assignment, 'تم تأكيد استلام عهدتك إداريًا '||coalesce(r.assignment_number,''), 'Your custody receipt was confirmed by admin');
  perform public.civ_notify_managers('civ_employee_confirmed', p_assignment, 'تأكيد إداري لاستلام العهدة '||coalesce(r.assignment_number,''), 'Admin-confirmed custody '||coalesce(r.assignment_number,''));
  return jsonb_build_object('ok', true, 'status', 'active');
end $$;
revoke all on function public.custody_inv_admin_confirm_assignment(uuid,text,text) from public, anon;
grant  execute on function public.custody_inv_admin_confirm_assignment(uuid,text,text) to authenticated;

-- ═══ 2) بدء الإرجاع إداريًا نيابة عن الموظف (active/partially_returned → return_requested) ═══
-- لا يعيد المخزون ولا يغلق — الفحص يليه (custody_inv_admin_inspect_return الموجود).
create or replace function public.custody_inv_admin_start_return(p_assignment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('active','partially_returned') then raise exception 'not_active'; end if;

  update public.custody_inventory_assignments
     set status = 'return_requested',
         admin_note_internal = left(concat_ws(' | ', nullif(admin_note_internal,''), 'بدء إرجاع إداري: '||p_reason), 1000),
         updated_at = now()
   where id = p_assignment;
  update public.custody_inventory_assignment_items set status = 'return_requested', updated_at = now()
   where assignment_id = p_assignment and status = 'active';
  insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, reason, created_by, to_employee_id)
    select i.asset_id, i.assignment_id, i.id, 'return_requested', 'بدء إرجاع إداري', auth.uid(), r.employee_user_id
      from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment and i.status = 'return_requested';
  perform public.civ_notify(r.employee_user_id, 'civ_return_requested', p_assignment, 'بدأت الإدارة إجراء إرجاع عهدتك '||coalesce(r.assignment_number,''), 'Admin started return for your custody');
  perform public.civ_notify_managers('civ_return_requested', p_assignment, 'بدء إرجاع إداري للعهدة '||coalesce(r.assignment_number,''), 'Admin-initiated return '||coalesce(r.assignment_number,''));
  return jsonb_build_object('ok', true, 'status', 'return_requested');
end $$;
revoke all on function public.custody_inv_admin_start_return(uuid,text) from public, anon;
grant  execute on function public.custody_inv_admin_start_return(uuid,text) to authenticated;

-- ═══ 3) إعادة إرسال طلب التأكيد للموظف (تذكير — بلا تغيير حالة) ═══
create or replace function public.custody_inv_admin_resend_confirmation(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending_employee_confirmation' then raise exception 'not_pending'; end if;
  perform public.civ_notify(r.employee_user_id, 'civ_employee_confirmed', p_assignment, 'تذكير: يرجى تأكيد استلام عهدتك '||coalesce(r.assignment_number,''), 'Reminder: please confirm your custody receipt');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.custody_inv_admin_resend_confirmation(uuid) from public, anon;
grant  execute on function public.custody_inv_admin_resend_confirmation(uuid) to authenticated;

-- ═══ 4) إلغاء التسليم قبل التأكيد (draft/pending → cancelled) + إرجاع المخزون المخصوم ═══
create or replace function public.custody_inv_admin_cancel_assignment(p_assignment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_assets uuid[];
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('draft','pending_employee_confirmation') then raise exception 'cannot_cancel_after_confirmation'; end if;

  -- إرجاع الكمية المخصومة وقت الصرف (create_assignment يخصم فورًا). نحدّها بـ quantity_total
  -- حتى لا نتجاوز السقف (civ_asset_qty_bound) إذا خُفّض الإجمالي بينما العهدة معلّقة.
  update public.custody_inventory_assets a set quantity_available = least(a.quantity_total, a.quantity_available + s.qty)
    from (select asset_id, sum(quantity) as qty from public.custody_inventory_assignment_items where assignment_id = p_assignment group by asset_id) s
   where a.id = s.asset_id;
  select array_agg(distinct asset_id) into v_assets from public.custody_inventory_assignment_items where assignment_id = p_assignment;
  if v_assets is not null then perform public.civ_set_avail(a) from unnest(v_assets) a; end if;
  insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, reason, created_by, to_employee_id)
    select i.asset_id, i.assignment_id, i.id, 'return_to_stock', 'إلغاء تسليم قبل التأكيد', auth.uid(), r.employee_user_id
      from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment;
  update public.custody_inventory_assignment_items set status = 'returned', updated_at = now() where assignment_id = p_assignment;
  update public.custody_inventory_assignments set status = 'cancelled', delete_reason = left(p_reason,500), updated_at = now() where id = p_assignment;
  perform public.civ_notify(r.employee_user_id, 'civ_employee_rejected', p_assignment, 'أُلغي تسليم العهدة '||coalesce(r.assignment_number,''), 'Custody handover was cancelled');
  perform public.civ_notify_managers('civ_employee_rejected', p_assignment, 'إلغاء تسليم العهدة '||coalesce(r.assignment_number,''), 'Custody handover cancelled '||coalesce(r.assignment_number,''));
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;
revoke all on function public.custody_inv_admin_cancel_assignment(uuid,text) from public, anon;
grant  execute on function public.custody_inv_admin_cancel_assignment(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'fns' as k, proname, pg_get_function_identity_arguments(oid) as args,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('anon', oid, 'execute') as anon_exec
  from pg_proc where proname in (
    'custody_inv_admin_confirm_assignment','custody_inv_admin_start_return',
    'custody_inv_admin_resend_confirmation','custody_inv_admin_cancel_assignment')
  order by proname;
select 'columns' as k, count(*) from information_schema.columns
  where table_schema='public' and table_name='custody_inventory_assignments' and column_name in ('admin_confirmed_by','admin_confirmed_reason');
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (يدوي):
-- begin;
--   drop function if exists public.custody_inv_admin_confirm_assignment(uuid,text,text);
--   drop function if exists public.custody_inv_admin_start_return(uuid,text);
--   drop function if exists public.custody_inv_admin_resend_confirmation(uuid);
--   drop function if exists public.custody_inv_admin_cancel_assignment(uuid,text);
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
