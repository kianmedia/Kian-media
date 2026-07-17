-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — FINAL-DELIVERY PAYMENT GATE + DOWNLOAD LOG  (RUN ONCE)
--
-- Adds the missing business gate for the client preview → approval → payment →
-- final-delivery flow, on the EXISTING client-facing deliverable system
-- (deliverables + deliverable_assets + get_deliverable_download). Does NOT touch
-- the staff project-core version system, Zoho, finance, or estimates/invoices.
--
-- What it adds:
--   1) project_delivery_release  — per-project "all client dues received" flag
--      with cleared_by/at, note, revoked_by/at (admin-controlled, audited).
--   2) deliverable_downloads     — a log row per successful client download.
--   3) admin_confirm_project_payment / admin_revoke_project_payment (is_admin,
--      audited via log_activity) — the "Full payment received" + relock controls.
--   4) project_payment_cleared(project) — read for admin + client UI messaging.
--   5) get_deliverable_download — TIGHTENED: client download now requires
--      status='final_delivered' AND dues_cleared (was allow_download + approved).
--      is_admin() bypass + is_client_side + is_not_blocked preserved.
--   6) client_download_deliverable(deliverable) — same gate, LOGS the download,
--      returns the final asset URL (what the client Download button calls).
--
-- Idempotent · Production-safe · does NOT weaken RLS or the approved-first
-- trigger · no Zoho/finance dependency · no fixtures · no data deletion.
-- Depends on: is_admin(), is_client_side(uuid), is_not_blocked(),
-- is_kian_member(uuid), log_activity(uuid,text,text,text,uuid,jsonb),
-- deliverables, deliverable_assets — all already in production.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ PREFLIGHT (Arabic errors before opening the transaction) ═══
do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverables')       is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.deliverable_assets') is null then miss := miss || ' deliverable_assets'; end if;
  if to_regclass('public.projects')           is null then miss := miss || ' projects'; end if;
  if to_regprocedure('public.is_admin()')                  is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.is_client_side(uuid)')        is null then miss := miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.is_not_blocked()')            is null then miss := miss || ' is_not_blocked()'; end if;
  if to_regprocedure('public.is_kian_member(uuid)')        is null then miss := miss || ' is_kian_member(uuid)'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity'; end if;
  if to_regprocedure('public.get_deliverable_download(uuid)') is null then miss := miss || ' get_deliverable_download'; end if;
  if miss <> '' then
    raise exception 'نقص في الاعتمادات (%). شغّل phase0_migration.sql وملفات المراجعة/التسليم أولًا.', miss;
  end if;
end $pf$;

begin;

-- ═══ 1) جدول تحرير التسليم لكل مشروع (كل مستحقات العميل مُستلمة) ═══
create table if not exists public.project_delivery_release (
  project_id   uuid primary key references public.projects(id) on delete cascade,
  dues_cleared boolean not null default false,
  note         text,
  cleared_by   uuid references auth.users(id),
  cleared_at   timestamptz,
  revoked_by   uuid references auth.users(id),
  revoked_at   timestamptz,
  updated_at   timestamptz not null default now()
);

-- ═══ 2) سجل التنزيلات (صف لكل تنزيل ناجح) ═══
create table if not exists public.deliverable_downloads (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  user_id        uuid references auth.users(id),
  asset_kind     text not null default 'final',
  downloaded_at  timestamptz not null default now()
);
create index if not exists idx_dlv_downloads_project on public.deliverable_downloads(project_id, downloaded_at desc);
create index if not exists idx_dlv_downloads_dlv     on public.deliverable_downloads(deliverable_id);

-- ═══ 3) تأكيد/سحب استلام الدفعة (للأدمن فقط، موثَّق) ═══
create or replace function public.admin_confirm_project_payment(p_project uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.is_deleted = false) then
    raise exception 'project_not_found';
  end if;
  insert into public.project_delivery_release(project_id, dues_cleared, note, cleared_by, cleared_at, revoked_by, revoked_at, updated_at)
    values (p_project, true, nullif(btrim(coalesce(p_note,'')),''), auth.uid(), now(), null, null, now())
  on conflict (project_id) do update set
    dues_cleared = true,
    note         = nullif(btrim(coalesce(p_note,'')),''),
    cleared_by   = auth.uid(), cleared_at = now(),
    revoked_by   = null, revoked_at = null, updated_at = now();
  perform public.log_activity(auth.uid(), 'admin', 'delivery.payment_confirmed', 'project', p_project,
    jsonb_build_object('note', left(coalesce(p_note,''), 500)));
  return true;
end $$;

create or replace function public.admin_revoke_project_payment(p_project uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  insert into public.project_delivery_release(project_id, dues_cleared, note, revoked_by, revoked_at, updated_at)
    values (p_project, false, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), now(), now())
  on conflict (project_id) do update set
    dues_cleared = false,
    note         = coalesce(nullif(btrim(coalesce(p_reason,'')),''), public.project_delivery_release.note),
    revoked_by   = auth.uid(), revoked_at = now(), updated_at = now();
  perform public.log_activity(auth.uid(), 'admin', 'delivery.payment_revoked', 'project', p_project,
    jsonb_build_object('reason', left(coalesce(p_reason,''), 500)));
  return true;
end $$;

-- ═══ 4) قراءة حالة الدفعة (أدمن + كوادر + عميل المشروع) ═══
create or replace function public.project_payment_cleared(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_kian_member(p_project) or public.is_client_side(p_project)) then
    raise exception 'not authorized';
  end if;
  return coalesce((select dues_cleared from public.project_delivery_release where project_id = p_project), false);
end $$;

-- ═══ 5) تشديد بوابة التنزيل: العميل يُنزّل فقط عند (final_delivered) + (الدفعة مؤكَّدة) ═══
--     (يبقى تجاوز الأدمن + is_client_side + is_not_blocked). لا اعتماد على Zoho.
create or replace function public.get_deliverable_download(p_deliverable uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.url
  from public.deliverable_assets a
  join public.deliverables d on d.id = a.deliverable_id
  where a.deliverable_id = p_deliverable and a.kind = 'final'
    and a.is_deleted = false and d.is_deleted = false
    and (
      public.is_admin()
      or (
        d.status = 'final_delivered'
        and public.is_client_side(d.project_id)
        and public.is_not_blocked()
        and coalesce((select r.dues_cleared from public.project_delivery_release r
                      where r.project_id = d.project_id), false)
      )
    )
  limit 1;
$$;

-- ═══ 6) تنزيل مُسجَّل (نفس البوابة + يكتب سجل التنزيل) ═══
create or replace function public.client_download_deliverable(p_deliverable uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_url text; v_proj uuid;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  v_url := public.get_deliverable_download(p_deliverable);   -- تُعيد NULL إذا كانت البوابة مغلقة
  if v_url is null then
    return null;   -- مغلق (لم يُسلَّم نهائيًا أو لم تُؤكَّد الدفعة) — لا تسجيل
  end if;
  insert into public.deliverable_downloads(deliverable_id, project_id, user_id, asset_kind)
    values (p_deliverable, v_proj, auth.uid(), 'final');
  return v_url;
end $$;

-- ═══ 7) RLS ═══
alter table public.project_delivery_release enable row level security;
alter table public.deliverable_downloads    enable row level security;

drop policy if exists pdr_read on public.project_delivery_release;
create policy pdr_read on public.project_delivery_release for select to authenticated
  using (public.is_admin() or public.is_kian_member(project_id) or public.is_client_side(project_id));
-- الكتابة عبر RPCs (SECURITY DEFINER) فقط — لا سياسة كتابة.

drop policy if exists ddl_read on public.deliverable_downloads;
create policy ddl_read on public.deliverable_downloads for select to authenticated
  using (public.is_admin() or public.is_kian_member(project_id));
-- الإدراج عبر client_download_deliverable (SECURITY DEFINER) فقط — لا سياسة إدراج.

-- ═══ 8) Grants ═══
grant select on public.project_delivery_release, public.deliverable_downloads to authenticated;
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_confirm_project_payment(uuid,text)',
    'public.admin_revoke_project_payment(uuid,text)',
    'public.project_payment_cleared(uuid)',
    'public.client_download_deliverable(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- get_deliverable_download يبقى متاحًا لـauthenticated (كما كان).
  execute 'grant execute on function public.get_deliverable_download(uuid) to authenticated';
end $g$;

-- ═══ 9) VALIDATION داخل المعاملة ═══
do $v$
declare miss text := '';
begin
  if to_regclass('public.project_delivery_release') is null then miss := miss || ' project_delivery_release'; end if;
  if to_regclass('public.deliverable_downloads')    is null then miss := miss || ' deliverable_downloads'; end if;
  if to_regprocedure('public.admin_confirm_project_payment(uuid,text)') is null then miss := miss || ' admin_confirm_project_payment'; end if;
  if to_regprocedure('public.admin_revoke_project_payment(uuid,text)')  is null then miss := miss || ' admin_revoke_project_payment'; end if;
  if to_regprocedure('public.client_download_deliverable(uuid)')        is null then miss := miss || ' client_download_deliverable'; end if;
  if to_regprocedure('public.project_payment_cleared(uuid)')            is null then miss := miss || ' project_payment_cleared'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.project_delivery_release'::regclass) then miss := miss || ' RLS(project_delivery_release)'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.deliverable_downloads'::regclass) then miss := miss || ' RLS(deliverable_downloads)'; end if;
  -- the approved-first trigger must still exist (we did NOT touch it)
  if not exists (select 1 from pg_trigger where tgname = 't_deliverable_change') then miss := miss || ' t_deliverable_change (must still exist)'; end if;
  if miss <> '' then raise exception 'فشل التحقق النهائي — عناصر ناقصة:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';

commit;

-- فحوص قراءة اختيارية بعد التطبيق:
-- select public.project_payment_cleared('<project_id>');                 -- false افتراضيًا
-- select public.admin_confirm_project_payment('<project_id>', 'دفعة نقدية');  -- true (أدمن)
-- select public.get_deliverable_download('<final_delivered_deliverable>');    -- URL بعد التأكيد
-- select public.admin_revoke_project_payment('<project_id>', 'ارتجاع');       -- يُعيد القفل
