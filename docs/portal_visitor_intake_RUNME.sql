-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — visitor/lead intake: project briefs + generic portal requests.
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
-- Powers the lead "Project Tools" dashboard (/client-portal/explore):
--   • project_briefs  — structured scope brief from the brief builder.
--   • portal_requests — generic request/ticket (brief / calculator → quote / etc.).
-- Both are RLS-scoped: a user sees only their own rows; staff see all (for the
-- future admin inbox). Writes go through SECURITY DEFINER submit RPCs (no table
-- write grants) so we can notify sales server-side via the existing notify() RPC.
--
-- Depends on: phase0_migration.sql (profiles, notify(), is_admin) + staff role
-- helpers (is_staff()). Run those first (already live).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Widen the notifications type CHECK (preserve ALL existing values) ═
-- LIVE set = the 9 base (phase0) + 'opportunity_new' + 'whatsapp_new'
-- (whatsapp_inbox_RUNME.sql:228). We add 'project_brief_new' + 'portal_request_new'.
-- The list below MUST stay a superset of every value already in the table, or the
-- re-add fails on existing rows (e.g. existing 'whatsapp_new' notifications).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new'));

-- ════════ 2) project_briefs ══════════════════════════════════════════════════
create table if not exists public.project_briefs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  email          text,
  service_type   text,
  goal           text,
  city           text,
  expected_date  date,
  deliverables   jsonb not null default '[]'::jsonb,
  budget_range   text,
  notes          text,
  ai_summary     text,
  status         text not null default 'new' check (status in ('new','reviewing','contacted','converted','closed')),
  source         text not null default 'portal',
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_project_briefs_user on public.project_briefs(user_id, created_at);
alter table public.project_briefs enable row level security;
drop policy if exists project_briefs_read on public.project_briefs;
create policy project_briefs_read on public.project_briefs for select to authenticated
  using (not is_deleted and (user_id = auth.uid() or public.is_staff()));
grant select on public.project_briefs to authenticated;

-- ════════ 3) portal_requests (generic ticket/request) ════════════════════════
create table if not exists public.portal_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete set null,
  email               text,
  phone               text,
  request_type        text not null check (request_type in ('quote','meeting','call','contact','whatsapp','support','brief')),
  status              text not null default 'new' check (status in ('new','assigned','in_progress','waiting_client','completed','closed')),
  title               text,
  summary             text,
  source              text,
  assigned_department text,
  assigned_to         uuid references auth.users(id) on delete set null,
  is_deleted          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_portal_requests_user on public.portal_requests(user_id, created_at);
alter table public.portal_requests enable row level security;
drop policy if exists portal_requests_read on public.portal_requests;
create policy portal_requests_read on public.portal_requests for select to authenticated
  using (not is_deleted and (user_id = auth.uid() or public.is_staff()));
grant select on public.portal_requests to authenticated;

-- ════════ 4) Submit RPCs (SECURITY DEFINER; insert as the user + notify) ══════
create or replace function public.submit_project_brief(
  p_service_type text, p_goal text, p_city text, p_expected_date date,
  p_deliverables jsonb, p_budget_range text, p_notes text, p_ai_summary text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text; r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.project_briefs
    (user_id, email, service_type, goal, city, expected_date, deliverables, budget_range, notes, ai_summary)
  values (auth.uid(), v_email, nullif(p_service_type,''), nullif(p_goal,''), nullif(p_city,''), p_expected_date,
          coalesce(p_deliverables,'[]'::jsonb), nullif(p_budget_range,''), nullif(p_notes,''), nullif(p_ai_summary,''))
  returning id into v_id;
  -- Mirror as a portal_request of type 'brief' so it shows in the requests center + admin queue.
  insert into public.portal_requests (user_id, email, request_type, title, summary, source)
  values (auth.uid(), v_email, 'brief',
          coalesce(nullif(p_service_type,''), 'موجز مشروع'), left(coalesce(nullif(p_ai_summary,''), p_goal, ''), 300), 'portal');
  -- Notify owner/admin + sales/manager.
  perform public.notify(null, 'admin', 'project_brief_new', 'project_brief', v_id, 'موجز مشروع جديد من الزائر', 'New visitor project brief');
  for r in select id from public.profiles where account_status='active' and staff_role in ('manager','super_admin','sales') loop
    perform public.notify(r.id, 'user', 'project_brief_new', 'project_brief', v_id, 'موجز مشروع جديد من الزائر', 'New visitor project brief');
  end loop;
  return v_id;
end; $$;
revoke execute on function public.submit_project_brief(text,text,text,date,jsonb,text,text,text) from public, anon;
grant  execute on function public.submit_project_brief(text,text,text,date,jsonb,text,text,text) to authenticated;

create or replace function public.submit_portal_request(
  p_request_type text, p_title text, p_summary text, p_phone text, p_source text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text; v_type text; r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_type := case when p_request_type in ('quote','meeting','call','contact','whatsapp','support','brief') then p_request_type else 'support' end;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.portal_requests (user_id, email, phone, request_type, title, summary, source)
  values (auth.uid(), v_email, nullif(p_phone,''), v_type, nullif(p_title,''), nullif(p_summary,''), nullif(p_source,''))
  returning id into v_id;
  perform public.notify(null, 'admin', 'portal_request_new', 'portal_request', v_id, 'طلب جديد من البوابة', 'New portal request');
  for r in select id from public.profiles where account_status='active' and staff_role in ('manager','super_admin','sales') loop
    perform public.notify(r.id, 'user', 'portal_request_new', 'portal_request', v_id, 'طلب جديد من البوابة', 'New portal request');
  end loop;
  return v_id;
end; $$;
revoke execute on function public.submit_portal_request(text,text,text,text,text) from public, anon;
grant  execute on function public.submit_portal_request(text,text,text,text,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior notifications CHECK; leaves the additive tables —
-- they are harmless. Drop them too only if you really want to):
-- begin;
--   drop function if exists public.submit_portal_request(text,text,text,text,text);
--   drop function if exists public.submit_project_brief(text,text,text,date,jsonb,text,text,text);
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new'));
--   -- drop table if exists public.portal_requests cascade;
--   -- drop table if exists public.project_briefs cascade;
-- commit;
