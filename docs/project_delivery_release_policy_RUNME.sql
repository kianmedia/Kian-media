-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §7 RELEASE WINDOW + DOWNLOAD LIMIT + DOWNLOAD NOTIFICATION (RUN ONCE)
--
-- Extends the final-delivery payment gate (project_delivery_release) with:
--   • release_window (none/24h/3d/7d/30d) — time-boxed access starting at confirm.
--   • download_limit (null=unlimited, else N) — issuances counted per deliverable
--     within the CURRENT window (window_started_at). Enforced in the gate + RPC,
--     NOT the UI.
--   • deliverable_download_state(deliverable) — honest {allowed, reason, used,
--     remaining, expires_at} for the client ("downloads remaining"). The count is
--     LINK ISSUANCE (a signed URL was handed out) — we never claim "completed".
--   • client_download_deliverable now enforces window+limit and emits ONE portal
--     notification to admins per successful issuance (email is sent by the route).
--
-- Runs AFTER docs/project_delivery_payment_gate_RUNME.sql. Idempotent, non-
-- destructive. Admin bypass, is_client_side, is_not_blocked, dues_cleared and the
-- approved-first trigger all preserved. No Zoho/finance dependency.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_delivery_release') is null then miss := miss || ' project_delivery_release (شغّل payment_gate RUNME)'; end if;
  if to_regclass('public.deliverable_downloads')    is null then miss := miss || ' deliverable_downloads'; end if;
  if to_regprocedure('public.get_deliverable_download(uuid)')       is null then miss := miss || ' get_deliverable_download'; end if;
  if to_regprocedure('public.client_download_deliverable(uuid)')    is null then miss := miss || ' client_download_deliverable'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة سياسة التحرير ═══
alter table public.project_delivery_release add column if not exists release_window    text not null default 'none';
alter table public.project_delivery_release add column if not exists download_limit    int;
alter table public.project_delivery_release add column if not exists window_started_at timestamptz;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'pdr_window_ck') then
    alter table public.project_delivery_release add constraint pdr_window_ck
      check (release_window in ('none','24h','3d','7d','30d'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pdr_limit_ck') then
    alter table public.project_delivery_release add constraint pdr_limit_ck
      check (download_limit is null or download_limit > 0);
  end if;
end $c$;
-- window_started_at لصفوف مؤكَّدة سابقًا = cleared_at (وإلا يبقى null ⇒ لا نافذة).
update public.project_delivery_release set window_started_at = cleared_at
  where dues_cleared = true and window_started_at is null and cleared_at is not null;

-- ═══ 2) دالة داخلية: هل النافذة سارية؟ (interval من release_window) ═══
create or replace function public.pc_release_window_ok(p_window text, p_started timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_window = 'none' then true
    when p_started is null then false
    when p_window = '24h' then now() <= p_started + interval '24 hours'
    when p_window = '3d'  then now() <= p_started + interval '3 days'
    when p_window = '7d'  then now() <= p_started + interval '7 days'
    when p_window = '30d' then now() <= p_started + interval '30 days'
    else true end;
$$;

-- ═══ 3) بوابة التنزيل — تضيف النافذة والحدّ (تبقى الشروط السابقة) ═══
create or replace function public.get_deliverable_download(p_deliverable uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.url
  from public.deliverable_assets a
  join public.deliverables d on d.id = a.deliverable_id
  left join public.project_delivery_release r on r.project_id = d.project_id
  where a.deliverable_id = p_deliverable and a.kind = 'final'
    and a.is_deleted = false and d.is_deleted = false
    and (
      public.is_admin()
      or (
        d.status = 'final_delivered'
        and public.is_client_side(d.project_id)
        and public.is_not_blocked()
        and coalesce(r.dues_cleared, false)
        and public.pc_release_window_ok(coalesce(r.release_window,'none'), r.window_started_at)
        and (
          r.download_limit is null
          or (select count(*) from public.deliverable_downloads dd
              where dd.deliverable_id = d.id
                and (r.window_started_at is null or dd.downloaded_at >= r.window_started_at)) < r.download_limit
        )
      )
    )
  limit 1;
$$;

-- ═══ 4) حالة التنزيل للعميل (صادقة: العدّ = إصدار رابط موقّع) ═══
create or replace function public.deliverable_download_state(p_deliverable uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d record; r record; v_used int; v_expires timestamptz; v_allowed boolean; v_reason text;
begin
  select dv.id, dv.project_id, dv.status into d from public.deliverables dv where dv.id = p_deliverable and dv.is_deleted = false;
  if d.id is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.is_client_side(d.project_id) or public.staff_reads_all_projects() or public.project_role(d.project_id) is not null) then
    raise exception 'not authorized';
  end if;
  select * into r from public.project_delivery_release where project_id = d.project_id;
  select count(*) into v_used from public.deliverable_downloads dd
    where dd.deliverable_id = p_deliverable
      and (r.window_started_at is null or dd.downloaded_at >= r.window_started_at);
  v_expires := case coalesce(r.release_window,'none')
    when '24h' then r.window_started_at + interval '24 hours'
    when '3d'  then r.window_started_at + interval '3 days'
    when '7d'  then r.window_started_at + interval '7 days'
    when '30d' then r.window_started_at + interval '30 days'
    else null end;
  v_allowed := d.status = 'final_delivered' and coalesce(r.dues_cleared,false)
    and public.pc_release_window_ok(coalesce(r.release_window,'none'), r.window_started_at)
    and (r.download_limit is null or v_used < r.download_limit);
  v_reason := case
    when d.status <> 'final_delivered' then 'not_final'
    when not coalesce(r.dues_cleared,false) then 'payment_pending'
    when not public.pc_release_window_ok(coalesce(r.release_window,'none'), r.window_started_at) then 'window_expired'
    when r.download_limit is not null and v_used >= r.download_limit then 'limit_reached'
    else 'ok' end;
  return jsonb_build_object(
    'allowed', v_allowed, 'reason', v_reason,
    'used', v_used,
    'limit', r.download_limit,
    'remaining', case when r.download_limit is null then null else greatest(0, r.download_limit - v_used) end,
    'window', coalesce(r.release_window,'none'), 'expires_at', v_expires);
end $$;

-- ═══ 5) التنزيل المُسجَّل — يفرض النافذة والحدّ + إشعار المنصة للإدارة (مرة لكل إصدار) ═══
create or replace function public.client_download_deliverable(p_deliverable uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_url text; v_proj uuid; v_title text;
begin
  select project_id, title into v_proj, v_title from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  v_url := public.get_deliverable_download(p_deliverable);   -- يطبّق dues + window + limit
  if v_url is null then return null; end if;                 -- مقفول: لا تسجيل ولا إشعار
  insert into public.deliverable_downloads(deliverable_id, project_id, user_id, asset_kind)
    values (p_deliverable, v_proj, auth.uid(), 'final');
  -- إشعار المنصة للإدارة (بثّ admin؛ recipient_shape يتطلّب recipient_id=null).
  perform public.notify(null, 'admin', 'deliverable_final_delivered', 'deliverable', p_deliverable,
    'بدأ العميل تنزيل الملف النهائي: '||coalesce(v_title,''),
    'Client started downloading the final file: '||coalesce(v_title,''));
  perform public.log_activity(auth.uid(), 'user', 'deliverable.download_started', 'deliverable', p_deliverable, '{}');
  return v_url;
end $$;

-- ═══ 6) ضبط سياسة التحرير (أدمن) — نافذة + حدّ ═══
create or replace function public.admin_set_release_policy(p_project uuid, p_window text, p_limit int default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_window <> all (array['none','24h','3d','7d','30d']) then raise exception 'bad_window'; end if;
  if p_limit is not null and p_limit <= 0 then raise exception 'bad_limit'; end if;
  insert into public.project_delivery_release(project_id, release_window, download_limit, updated_at)
    values (p_project, p_window, p_limit, now())
  on conflict (project_id) do update set release_window = p_window, download_limit = p_limit, updated_at = now();
  perform public.log_activity(auth.uid(), 'admin', 'delivery.release_policy_set', 'project', p_project,
    jsonb_build_object('window', p_window, 'limit', p_limit));
  return true;
end $$;

-- ═══ 7) تأكيد الدفعة — يبدأ نافذة التحرير الآن (نفس التوقيع؛ لا Overload) ═══
create or replace function public.admin_confirm_project_payment(p_project uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.is_deleted = false) then
    raise exception 'project_not_found';
  end if;
  insert into public.project_delivery_release(project_id, dues_cleared, note, cleared_by, cleared_at, window_started_at, revoked_by, revoked_at, updated_at)
    values (p_project, true, nullif(btrim(coalesce(p_note,'')),''), auth.uid(), now(), now(), null, null, now())
  on conflict (project_id) do update set
    dues_cleared = true, note = nullif(btrim(coalesce(p_note,'')),''),
    cleared_by = auth.uid(), cleared_at = now(), window_started_at = now(),
    revoked_by = null, revoked_at = null, updated_at = now();
  perform public.log_activity(auth.uid(), 'admin', 'delivery.payment_confirmed', 'project', p_project,
    jsonb_build_object('note', left(coalesce(p_note,''), 500)));
  return true;
end $$;

-- ═══ 8) Grants + VALIDATION ═══
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_set_release_policy(uuid,text,int)',
    'public.deliverable_download_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.pc_release_window_ok(text,timestamptz) from public, anon, authenticated';
end $g$;

do $v$
declare miss text := '';
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_delivery_release' and column_name='release_window') = 0 then miss := miss || ' release_window'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_delivery_release' and column_name='download_limit') = 0 then miss := miss || ' download_limit'; end if;
  if to_regprocedure('public.admin_set_release_policy(uuid,text,int)') is null then miss := miss || ' admin_set_release_policy'; end if;
  if to_regprocedure('public.deliverable_download_state(uuid)')        is null then miss := miss || ' deliverable_download_state'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='admin_confirm_project_payment') <> 1 then miss := miss || ' overload(admin_confirm_project_payment)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
