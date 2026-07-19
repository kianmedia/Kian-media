-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-6: FINAL-DELIVERY AUDIT (opens + issuance + receipt + revoke)  (RUN ONCE)
--
-- Completes the delivery audit trail on top of the existing gate:
--   • deliverable_final_opens         — one row each time the client opens the FINAL
--     preview (first_opened_at = min). Distinct from download issuance.
--   • client_open_final_preview(dlv)  — client-of-project logs a final-preview open.
--   • deliverable_delivery_audit(dlv) — admin/staff consolidated view: client, exact
--     final version, first_opened_at, first_download_started_at, download_count,
--     receipt_confirmed_at + by, release window/expiry, cleared_at, revoked_at.
--
-- Honest wording preserved: we record "download STARTED" (link issuance is provable;
-- completion is not) — reusing the existing deliverable_downloads issuance rows.
-- Receipt (deliverable_receipts) and release (project_delivery_release) already exist.
--
-- Idempotent · non-destructive. Depends on: deliverables, deliverable_versions,
-- deliverable_downloads, deliverable_receipts (deliverable_final_receipt_RUNME),
-- project_delivery_release, is_admin/is_client_side/is_not_blocked/is_kian_member,
-- staff_reads_all_projects/project_role, log_activity.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverables')           is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.deliverable_downloads')  is null then miss := miss || ' deliverable_downloads (payment_gate)'; end if;
  if to_regprocedure('public.is_client_side(uuid)') is null then miss := miss || ' is_client_side'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) سجل فتح المعاينة النهائية ═══
create table if not exists public.deliverable_final_opens (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid references auth.users(id),
  opened_at      timestamptz not null default now()
);
create index if not exists idx_dlv_final_opens on public.deliverable_final_opens(deliverable_id, opened_at);

-- ═══ 2) العميل يفتح المعاينة النهائية (تسجيل حدث) ═══
create or replace function public.client_open_final_preview(p_deliverable uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_status text;
begin
  select project_id, status into v_proj, v_status from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.is_client_side(v_proj)) then raise exception 'not authorized'; end if;
  if v_status <> 'final_delivered' then return false; end if;
  insert into public.deliverable_final_opens(deliverable_id, project_id, user_id) values (p_deliverable, v_proj, auth.uid());
  perform public.log_activity(auth.uid(), 'user', 'deliverable.final_preview_opened', 'deliverable', p_deliverable, '{}'::jsonb);
  return true;
end $$;

-- ═══ 3) عرض تدقيق التسليم المُجمّع (أدمن/كادر) ═══
create or replace function public.deliverable_delivery_audit(p_deliverable uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid; d record; r record; fv record; v_first_open timestamptz; v_first_dl timestamptz; v_count int;
        v_receipt record; v_expires timestamptz;
begin
  select id, project_id, title, status into d from public.deliverables where id = p_deliverable and is_deleted = false;
  if d.id is null then raise exception 'not_found'; end if;
  v_proj := d.project_id;
  if not (public.is_admin() or public.staff_reads_all_projects() or public.project_role(v_proj) is not null) then
    raise exception 'not authorized';
  end if;
  select version_no, final_master_status into fv from public.deliverable_versions
    where deliverable_id = p_deliverable and is_final = true and is_deleted = false limit 1;
  select min(opened_at) into v_first_open from public.deliverable_final_opens where deliverable_id = p_deliverable;
  select min(downloaded_at) into v_first_dl from public.deliverable_downloads where deliverable_id = p_deliverable;
  select count(*) into v_count from public.deliverable_downloads where deliverable_id = p_deliverable;
  select received_at, received_by_name into v_receipt from public.deliverable_receipts
    where deliverable_id = p_deliverable order by received_at desc limit 1;
  select * into r from public.project_delivery_release where project_id = v_proj;
  v_expires := case coalesce(r.release_window,'none')
    when '24h' then r.window_started_at + interval '24 hours'
    when '3d'  then r.window_started_at + interval '3 days'
    when '7d'  then r.window_started_at + interval '7 days'
    when '30d' then r.window_started_at + interval '30 days'
    else null end;
  return jsonb_build_object(
    'deliverable_id', d.id, 'title', d.title, 'status', d.status,
    'client_name', (select coalesce(c.company, c.full_name, p.project_name) from public.projects p left join public.clients c on c.id = p.client_id where p.id = v_proj),
    'final_version_no', fv.version_no,
    'final_master_status', fv.final_master_status,
    'first_opened_at', v_first_open,
    'first_download_started_at', v_first_dl,
    'download_count', v_count,
    'download_limit', r.download_limit,
    'receipt_confirmed_at', v_receipt.received_at,
    'receipt_confirmed_by', v_receipt.received_by_name,
    'dues_cleared', coalesce(r.dues_cleared, false),
    'payment_cleared_at', r.cleared_at,
    'release_window', coalesce(r.release_window,'none'),
    'release_expires_at', v_expires,
    'revoked_at', r.revoked_at);
end $$;

-- ═══ 4) RLS + Grants ═══
alter table public.deliverable_final_opens enable row level security;
drop policy if exists dfo_read on public.deliverable_final_opens;
create policy dfo_read on public.deliverable_final_opens for select to authenticated
  using (public.is_admin() or public.is_kian_member(project_id));
grant select on public.deliverable_final_opens to authenticated;
do $g$
declare f text;
begin
  foreach f in array array['public.client_open_final_preview(uuid)','public.deliverable_delivery_audit(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

do $v$
declare miss text := '';
begin
  if to_regclass('public.deliverable_final_opens') is null then miss := miss || ' deliverable_final_opens'; end if;
  if to_regprocedure('public.deliverable_delivery_audit(uuid)') is null then miss := miss || ' deliverable_delivery_audit'; end if;
  if to_regprocedure('public.client_open_final_preview(uuid)')  is null then miss := miss || ' client_open_final_preview'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
