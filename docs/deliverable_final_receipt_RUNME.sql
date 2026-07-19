-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-1: CLIENT FINAL-RECEIPT CONFIRMATION  (RUN ONCE)
--
-- Adds the client action "تأكيد استلام الملفات النهائية" on top of the existing
-- final-delivery payment gate (project_delivery_release / get_deliverable_download
-- / deliverable_download_state). Records an explicit, client-identified receipt
-- with timestamp + optional note and notifies Admin/Owner. Feeds the delivery
-- timeline via log_activity ('deliverable.receipt_confirmed').
--
--   • deliverable_receipts               — one row per (deliverable, client user).
--   • client_confirm_final_receipt(...)  — client-of-project only, requires the
--     deliverable to be final_delivered; stores received_by + received_at (+name/
--     note), notifies admins, logs the timeline event. Idempotent (re-confirm just
--     refreshes note/time).
--   • deliverable_receipt(deliverable)   — {confirmed, received_at, received_by_name}
--     read for admin / kian member / project client (UI shows the confirmed state).
--
-- Idempotent · non-destructive · no Zoho/finance · does not weaken RLS. Writes go
-- through the SECURITY DEFINER RPC only. Depends on: deliverables, projects,
-- is_admin(), is_client_side(uuid), is_not_blocked(), is_kian_member(uuid),
-- notify(uuid,text,text,text,uuid,text,text), log_activity(uuid,text,text,text,uuid,jsonb).
-- Run AFTER docs/project_delivery_payment_gate_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverables') is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.projects')     is null then miss := miss || ' projects'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.is_client_side(uuid)')  is null then miss := miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.is_not_blocked()')      is null then miss := miss || ' is_not_blocked()'; end if;
  if to_regprocedure('public.is_kian_member(uuid)')  is null then miss := miss || ' is_kian_member(uuid)'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل payment_gate RUNME أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) سجل تأكيد استلام النسخة النهائية (صف لكل مخرَج × عميل) ═══
create table if not exists public.deliverable_receipts (
  id               uuid primary key default gen_random_uuid(),
  deliverable_id   uuid not null references public.deliverables(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  received_by      uuid references auth.users(id),
  received_by_name text,
  note             text,
  user_agent       text,
  received_at      timestamptz not null default now(),
  unique (deliverable_id, received_by)
);
create index if not exists idx_dlv_receipts_project on public.deliverable_receipts(project_id, received_at desc);
create index if not exists idx_dlv_receipts_dlv     on public.deliverable_receipts(deliverable_id);

-- ═══ 2) تأكيد الاستلام (عميل المشروع فقط، بعد التسليم النهائي) ═══
create or replace function public.client_confirm_final_receipt(p_deliverable uuid, p_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_status text; v_title text; v_at timestamptz;
begin
  select project_id, status, title into v_proj, v_status, v_title
    from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  -- عميل المشروع فقط (غير محظور). الاستلام إقرار العميل — ليس فعل إدارة.
  if not (public.is_client_side(v_proj) and public.is_not_blocked()) then raise exception 'not authorized'; end if;
  if v_status <> 'final_delivered' then raise exception 'not_final'; end if;
  insert into public.deliverable_receipts(deliverable_id, project_id, received_by, received_by_name, note, received_at)
    values (p_deliverable, v_proj, auth.uid(), nullif(btrim(coalesce(p_name,'')),''), nullif(btrim(coalesce(p_note,'')),''), now())
  on conflict (deliverable_id, received_by) do update set
    received_by_name = coalesce(nullif(btrim(coalesce(p_name,'')),''), public.deliverable_receipts.received_by_name),
    note             = coalesce(nullif(btrim(coalesce(p_note,'')),''), public.deliverable_receipts.note),
    received_at      = now()
  returning received_at into v_at;
  -- إشعار الإدارة (بثّ admin؛ recipient=null).
  perform public.notify(null, 'admin', 'deliverable_receipt_confirmed', 'deliverable', p_deliverable,
    'أكّد العميل استلام الملفات النهائية: '||coalesce(v_title,''),
    'Client confirmed receipt of the final files: '||coalesce(v_title,''));
  perform public.log_activity(auth.uid(), 'user', 'deliverable.receipt_confirmed', 'deliverable', p_deliverable,
    jsonb_build_object('project_id', v_proj));
  return jsonb_build_object('ok', true, 'received_at', v_at);
end $$;

-- ═══ 3) قراءة حالة التأكيد (أدمن/كادر/عميل المشروع) ═══
create or replace function public.deliverable_receipt(p_deliverable uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid; r record;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.is_kian_member(v_proj) or public.is_client_side(v_proj)) then
    raise exception 'not authorized';
  end if;
  -- العميل يرى تأكيده هو؛ الإدارة/الكادر يرون أحدث تأكيد للمخرَج.
  if public.is_admin() or public.is_kian_member(v_proj) then
    select received_at, received_by_name into r from public.deliverable_receipts
      where deliverable_id = p_deliverable order by received_at desc limit 1;
  else
    select received_at, received_by_name into r from public.deliverable_receipts
      where deliverable_id = p_deliverable and received_by = auth.uid() limit 1;
  end if;
  return jsonb_build_object('confirmed', r.received_at is not null, 'received_at', r.received_at, 'received_by_name', r.received_by_name);
end $$;

-- ═══ 4) RLS ═══
alter table public.deliverable_receipts enable row level security;
drop policy if exists dlvr_read on public.deliverable_receipts;
create policy dlvr_read on public.deliverable_receipts for select to authenticated
  using (public.is_admin() or public.is_kian_member(project_id)
         or (received_by = auth.uid() and public.is_not_blocked()));
-- الكتابة عبر client_confirm_final_receipt (SECURITY DEFINER) فقط — لا سياسة كتابة.

-- ═══ 5) Grants ═══
grant select on public.deliverable_receipts to authenticated;
do $g$
declare f text;
begin
  foreach f in array array[
    'public.client_confirm_final_receipt(uuid,text,text)',
    'public.deliverable_receipt(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

-- ═══ 6) VALIDATION ═══
do $v$
declare miss text := '';
begin
  if to_regclass('public.deliverable_receipts') is null then miss := miss || ' deliverable_receipts'; end if;
  if to_regprocedure('public.client_confirm_final_receipt(uuid,text,text)') is null then miss := miss || ' client_confirm_final_receipt'; end if;
  if to_regprocedure('public.deliverable_receipt(uuid)')                    is null then miss := miss || ' deliverable_receipt'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.deliverable_receipts'::regclass) then miss := miss || ' RLS(deliverable_receipts)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- فحص اختياري:
--   select public.client_confirm_final_receipt('<final_delivered_dlv>', 'اسم العميل', 'تم الاستلام');
--   select public.deliverable_receipt('<dlv>');
