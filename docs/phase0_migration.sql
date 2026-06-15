-- ═══════════════════════════════════════════════════════════════════════════
-- KIAN CLIENT PORTAL — PHASE 0 FOUNDATION MIGRATION
-- Compiled from docs/PORTAL_ROADMAP.md v1.3 (2026-06-12)
--
-- STATUS: ✅ EXECUTED on production 2026-06-12 (Part 1 + Part 2, incl. the
-- auth.sessions login trigger). This file has been updated post-execution to
-- fold in PATCH 8P (applied in DB during acceptance testing):
--   • activity_log.actor_role CHECK widened to the full project-role set
--   • trg_review_created / trg_note_created log the actor's real project role
-- The file now matches the deployed schema 1:1.
--
-- PART 1 (begin…commit): core migration — single transaction, atomic.
--   Any failure rolls back EVERYTHING; the database is left untouched.
-- PART 2 (after commit): login-tracking trigger on auth.sessions — run
--   separately; if the plan restricts auth-schema triggers it fails harmlessly
--   and the portal uses the log_login() RPC fallback (included in Part 1).
--
-- GUARANTEES
--   • Additive only: CREATE TABLE / CREATE FUNCTION / CREATE TRIGGER /
--     CREATE POLICY / CREATE INDEX / ALTER TABLE ADD COLUMN.
--   • Zero DROP / DELETE / TRUNCATE statements.
--   • No UPDATE touches existing business rows except the admin seed
--     (profiles.account_type for the two approved emails).
--   • Existing tables modified (columns ADDED only): public.clients,
--     public.projects. Existing policies on them are NOT dropped; a
--     RESTRICTIVE policy is added instead.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1. COMPANIES ───────────────────────────────────────────────────────────
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  name_en         text,
  cr_number       text,
  vat_number      text,
  city            text,
  zoho_account_id text,
  created_at      timestamptz not null default now()
);

-- ─── 2. ACTIVITY LOG (admin-only audit; immutable) ──────────────────────────
create table public.activity_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id),
  -- PATCH 8P: full role vocabulary so client-side reviewers log their real role
  actor_role  text check (actor_role in ('user','lead','client','client_owner','client_member',
                          'kian_admin','kian_manager','kian_editor','kian_photographer',
                          'kian_viewer','admin','system')),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create or replace function public.log_activity(
  p_actor uuid, p_role text, p_action text, p_etype text, p_eid uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (p_actor, p_role, p_action, p_etype, p_eid, coalesce(p_meta, '{}'));
$$;

-- ─── 3. NOTIFICATION PREFERENCES + NOTIFICATIONS ────────────────────────────
create table public.notification_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  portal_enabled   boolean not null default true,
  email_enabled    boolean not null default false,
  whatsapp_enabled boolean not null default false,
  updated_at       timestamptz not null default now()
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid references auth.users(id) on delete cascade,
  recipient_role text not null default 'user' check (recipient_role in ('user','admin')),
  type           text not null check (type in (
    'quote_request_new','message_new','file_link_new','project_note_new',
    'deliverable_new','revision_requested','deliverable_approved',
    'deliverable_final_delivered','project_status_changed')),
  title_ar    text not null,
  title_en    text not null,
  entity_type text,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint recipient_shape check ((recipient_role = 'admin') = (recipient_id is null))
);

create or replace function public.notify(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role = 'user' and exists (select 1 from public.notification_preferences
                                 where user_id = p_recipient and portal_enabled = false) then
    return;
  end if;
  insert into public.notifications (recipient_id, recipient_role, type, entity_type, entity_id, title_ar, title_en)
  values (p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);
end; $$;

-- ─── 4. PROFILES ────────────────────────────────────────────────────────────
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  company         text,
  company_id      uuid references public.companies(id) on delete set null,
  mobile          text,
  preferred_lang  text not null default 'ar' check (preferred_lang in ('ar','en')),
  account_type    text not null default 'lead'     check (account_type   in ('lead','client','admin')),
  account_status  text not null default 'active'   check (account_status in ('active','inactive','blocked')),
  client_level    text not null default 'prospect' check (client_level   in ('prospect','active','vip')),
  marketing_opt_in boolean not null default false,
  zoho_lead_id    text,
  zoho_contact_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Backfill for users that already exist, then seed the ONLY two admins.
insert into public.profiles (id, email)
  select id, email from auth.users
  on conflict (id) do nothing;

insert into public.notification_preferences (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

-- NOTE: takes effect only for accounts that already exist in auth.users.
-- Re-run this single UPDATE after both accounts have signed up + confirmed.
update public.profiles set account_type = 'admin'
 where email in ('kianalebtikar@gmail.com','manager@kianmedia.com');

-- ─── 5. PROJECT MEMBERS + EXISTING-TABLE COLUMN ADDITIONS ───────────────────
create table public.project_members (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in
             ('client_owner','client_member',
              'kian_admin','kian_manager','kian_editor','kian_photographer','kian_viewer')),
  added_by   uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

-- NOTE (discovered during acceptance testing): the live projects.client_id
-- column is NOT NULL — every project requires a clients row. Membership-only
-- projects therefore still need a placeholder/owning clients record until the
-- legacy column is relaxed in a later phase.
alter table public.projects
  add column if not exists company_id            uuid references public.companies(id) on delete set null,
  add column if not exists zoho_deal_id          text,
  add column if not exists zoho_books_invoice_id text;

-- ─── 6. LEAD-TIER TABLES ────────────────────────────────────────────────────
create table public.quote_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  reference     text,
  services      text[] not null default '{}',
  description   text,
  budget_range  text,
  city          text,
  preferred_date date,
  status        text not null default 'new'
                check (status in ('new','in_review','quoted','accepted','rejected','archived')),
  sheet_mirrored boolean not null default false,
  zoho_deal_id           text,
  zoho_books_estimate_id text,
  created_at    timestamptz not null default now()
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  sender     text not null check (sender in ('user','admin')),
  body       text not null check (length(body) between 1 and 4000),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table public.file_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  url        text not null,
  label      text,
  created_at timestamptz not null default now()
);

create table public.offers (
  id           uuid primary key default gen_random_uuid(),
  title_ar     text, title_en text,
  body_ar      text, body_en  text,
  audience     text not null default 'all' check (audience in ('all','leads','clients')),
  is_published boolean not null default false,
  starts_at    timestamptz, ends_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ─── 7. CLIENT-TIER / REVIEW TABLES ─────────────────────────────────────────
create table public.project_notes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  author_id     uuid not null references auth.users(id),
  author_role   text not null check (author_role in ('client','admin')),
  body          text,
  reference_url text,
  created_at    timestamptz not null default now()
);

create table public.deliverables (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null,
  type             text not null default 'video' check (type in ('video','photo','other')),
  version          int  not null default 1,
  preview_url      text,
  vimeo_video_id   text,
  vimeo_review_url text,
  watermark_required boolean not null default true,
  allow_download   boolean not null default false,
  status           text not null default 'draft' check (status in
                   ('draft','internal_review','client_review',
                    'revision_requested','approved','final_delivered','archived')),
  created_at       timestamptz not null default now()
);

create table public.deliverable_assets (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  kind           text not null default 'final' check (kind in ('final','master','source')),
  url            text not null,
  created_at     timestamptz not null default now()
);

create table public.client_comments (
  id               uuid primary key default gen_random_uuid(),
  deliverable_id   uuid not null references public.deliverables(id) on delete cascade,
  author_id        uuid not null references auth.users(id),
  author_role      text not null check (author_role in ('client','admin')),
  body             text not null check (length(body) between 1 and 4000),
  timecode_seconds int check (timecode_seconds >= 0),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

create table public.internal_comments (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references public.projects(id) on delete cascade,
  deliverable_id   uuid references public.deliverables(id) on delete cascade,
  author_id        uuid not null references auth.users(id),
  category         text not null default 'general'
                   check (category in ('editor','production','budget','qa','general')),
  body             text not null check (length(body) between 1 and 4000),
  timecode_seconds int check (timecode_seconds >= 0),
  created_at       timestamptz not null default now(),
  constraint one_parent check ((project_id is null) <> (deliverable_id is null))
);

create table public.deliverable_reviews (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  reviewer_id    uuid not null references auth.users(id),
  decision       text not null check (decision in ('approved','revision_requested')),
  comments       text,
  created_at     timestamptz not null default now()
);

create table public.project_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  sender_role text not null check (sender_role in ('client','admin')),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

-- ─── 8. ADMIN-ONLY TABLES ───────────────────────────────────────────────────
create table public.admin_notes (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('profile','company','quote_request','project','deliverable')),
  entity_id   uuid not null,
  body        text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create table public.integration_outbox (
  id           uuid primary key default gen_random_uuid(),
  target       text not null check (target in ('zoho_crm','zoho_books','vimeo','email','whatsapp')),
  event        text not null,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

-- ─── 9. SOFT-DELETE COLUMNS on all 16 business tables (§2.13) ───────────────
do $$
declare t text;
begin
  foreach t in array array[
    'companies','clients','projects','project_members','quote_requests',
    'messages','file_links','offers','project_notes','deliverables',
    'deliverable_assets','client_comments','internal_comments',
    'deliverable_reviews','project_messages','admin_notes']
  loop
    execute format('alter table public.%I
      add column if not exists is_deleted boolean not null default false,
      add column if not exists deleted_at timestamptz,
      add column if not exists deleted_by uuid references auth.users(id)', t);
    execute format(
      'create index if not exists %I on public.%I (is_deleted) where is_deleted = false',
      t || '_live_idx', t);
  end loop;
end $$;

-- ─── 10. ACCESS HELPER FUNCTIONS (security definer; soft-delete aware) ──────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and account_type = 'admin' and account_status = 'active');
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and account_status = 'active');
$$;

create or replace function public.is_not_blocked() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and account_status <> 'blocked');
$$;

create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  join public.profiles p on p.id = c.user_id
  where c.user_id = auth.uid() and c.is_deleted = false
    and p.account_type in ('client','admin') and p.account_status <> 'blocked'
  limit 1;
$$;

create or replace function public.project_role(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid() and is_deleted = false
  limit 1;
$$;

create or replace function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.projects p
    where p.id = p_project and p.is_deleted = false
      and (public.project_role(p_project) is not null
           or p.client_id = public.my_client_id()));
$$;

create or replace function public.is_client_side(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) like 'client\_%'
      or exists (select 1 from public.projects p
                 where p.id = p_project and p.is_deleted = false
                   and p.client_id = public.my_client_id());
$$;

create or replace function public.is_client_owner(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) = 'client_owner'
      or exists (select 1 from public.projects p
                 where p.id = p_project and p.is_deleted = false
                   and p.client_id = public.my_client_id());
$$;

create or replace function public.is_kian_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.project_role(p_project) like 'kian\_%';
$$;

create or replace function public.project_client_user_ids(p_project uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select pm.user_id from public.project_members pm
   where pm.project_id = p_project and pm.role like 'client\_%' and pm.is_deleted = false
  union
  select c.user_id from public.clients c
   join public.projects p on p.client_id = c.id
   where p.id = p_project and c.is_deleted = false;
$$;

-- ─── 11. RPCs ───────────────────────────────────────────────────────────────
-- Gated final-file download (§2.8)
create or replace function public.get_deliverable_download(p_deliverable uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.url
  from public.deliverable_assets a
  join public.deliverables d on d.id = a.deliverable_id
  where a.deliverable_id = p_deliverable and a.kind = 'final'
    and a.is_deleted = false and d.is_deleted = false
    and (public.is_admin()
         or (d.allow_download
             and d.status in ('approved','final_delivered')
             and public.is_client_side(d.project_id)
             and public.is_not_blocked()))
  limit 1;
$$;
grant execute on function public.get_deliverable_download(uuid) to authenticated;

-- Single safe entry point for ALL portal deletions (§2.13)
-- Users may delete only rows they own (mapping below); admins may delete any.
-- Ownership map: quote_requests(user_id, only while status='new'),
-- messages(user_id + sender='user'), file_links(user_id), project_notes(author_id),
-- client_comments(author_id), internal_comments(author_id), project_messages(sender_id).
-- All other tables: admin only.
create or replace function public.soft_delete(p_table text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_pred text;
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'soft_delete: not authenticated';
  end if;
  if p_table <> all (array[
      'companies','clients','projects','project_members','quote_requests',
      'messages','file_links','offers','project_notes','deliverables',
      'deliverable_assets','client_comments','internal_comments',
      'deliverable_reviews','project_messages','admin_notes']) then
    raise exception 'soft_delete: table % not allowed', p_table;
  end if;
  if not public.is_active() then
    raise exception 'soft_delete: account is not active';
  end if;

  if public.is_admin() then
    v_pred := 'true';
  else
    v_pred := case p_table
      when 'quote_requests'    then format('user_id = %L and status = ''new''', auth.uid())
      when 'messages'          then format('user_id = %L and sender = ''user''', auth.uid())
      when 'file_links'        then format('user_id = %L', auth.uid())
      when 'project_notes'     then format('author_id = %L', auth.uid())
      when 'client_comments'   then format('author_id = %L', auth.uid())
      when 'internal_comments' then format('author_id = %L', auth.uid())
      when 'project_messages'  then format('sender_id = %L', auth.uid())
      else null
    end;
    if v_pred is null then
      raise exception 'soft_delete: % requires admin', p_table;
    end if;
  end if;

  execute format(
    'update public.%I set is_deleted = true, deleted_at = now(), deleted_by = %L
      where id = %L and is_deleted = false and (%s)',
    p_table, auth.uid(), p_id, v_pred);
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform public.log_activity(auth.uid(),
            case when public.is_admin() then 'admin' else 'user' end,
            'record.deleted', p_table, p_id, '{}');
  end if;
  return v_rows > 0;
end; $$;
grant execute on function public.soft_delete(text, uuid) to authenticated;

-- ADMIN ONLY restore (§2.13)
create or replace function public.restore_record(p_table text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then
    raise exception 'restore_record: admin only';
  end if;
  if p_table <> all (array[
      'companies','clients','projects','project_members','quote_requests',
      'messages','file_links','offers','project_notes','deliverables',
      'deliverable_assets','client_comments','internal_comments',
      'deliverable_reviews','project_messages','admin_notes']) then
    raise exception 'restore_record: table % not allowed', p_table;
  end if;
  execute format(
    'update public.%I set is_deleted = false, deleted_at = null, deleted_by = null
      where id = %L and is_deleted = true', p_table, p_id);
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.log_activity(auth.uid(), 'admin', 'record.restored', p_table, p_id, '{}');
  end if;
  return v_rows > 0;
end; $$;
grant execute on function public.restore_record(text, uuid) to authenticated;

-- Login-tracking fallback (used if the PART 2 auth.sessions trigger is unavailable)
create or replace function public.log_login() returns void
language sql security definer set search_path = public as $$
  select public.log_activity(auth.uid(), 'user', 'user.logged_in', 'session', null, '{}')
  where auth.uid() is not null;
$$;
grant execute on function public.log_login() to authenticated;

-- ─── 12. TRIGGER FUNCTIONS + TRIGGERS ───────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.notification_preferences (user_id) values (new.id);
  perform public.log_activity(new.id, 'user', 'user.signed_up', 'profile', new.id, '{}'::jsonb);
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger t_prefs_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create or replace function public.trg_quote_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.user_id, 'user', 'quote.submitted', 'quote_request', new.id,
                              jsonb_build_object('reference', new.reference));
  perform public.notify(null, 'admin', 'quote_request_new', 'quote_request', new.id,
                        'طلب عرض سعر جديد', 'New quote request');
  return new;
end; $$;
create trigger t_quote_created after insert on public.quote_requests
  for each row execute function public.trg_quote_created();

create or replace function public.trg_message_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(coalesce(auth.uid(), new.user_id),
          case when new.sender = 'user' then 'user' else 'admin' end,
          'message.sent', 'message', new.id, '{}');
  if new.sender = 'user' then
    perform public.notify(null, 'admin', 'message_new', 'message', new.id,
                          'رسالة جديدة', 'New message');
  else
    perform public.notify(new.user_id, 'user', 'message_new', 'message', new.id,
                          'رد جديد من كيان', 'New reply from Kian');
  end if;
  return new;
end; $$;
create trigger t_message_created after insert on public.messages
  for each row execute function public.trg_message_created();

create or replace function public.trg_file_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.user_id, 'user', 'file.uploaded', 'file_link', new.id, '{}');
  perform public.notify(null, 'admin', 'file_link_new', 'file_link', new.id,
                        'ملف/رابط جديد', 'New file/link uploaded');
  return new;
end; $$;
create trigger t_file_created after insert on public.file_links
  for each row execute function public.trg_file_created();

-- PATCH 8P: log the author's real project role (legacy contact ⇒ client_owner)
create or replace function public.trg_note_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_role text;
begin
  v_role := case when new.author_role = 'admin' then 'admin'
                 else coalesce(public.project_role(new.project_id), 'client_owner') end;
  perform public.log_activity(new.author_id, v_role, 'project.note_added', 'project_note', new.id, '{}');
  if new.author_role = 'client' then
    perform public.notify(null, 'admin', 'project_note_new', 'project_note', new.id,
                          'ملاحظة مشروع جديدة', 'New project note');
  else
    for r in select * from public.project_client_user_ids(new.project_id) loop
      perform public.notify(r.user_id, 'user', 'project_note_new', 'project_note', new.id,
                            'ملاحظة جديدة على مشروعك', 'New note on your project');
    end loop;
  end if;
  return new;
end; $$;
create trigger t_note_created after insert on public.project_notes
  for each row execute function public.trg_note_created();

create or replace function public.trg_deliverable_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'UPDATE' and new.status = 'final_delivered' and old.status <> 'approved'
     and old.status <> 'final_delivered' then
    raise exception 'final_delivered requires explicit client approval first (status must be approved)';
  end if;

  if tg_op = 'INSERT' then
    perform public.log_activity(auth.uid(), 'admin', 'deliverable.uploaded', 'deliverable', new.id,
                                jsonb_build_object('title', new.title, 'version', new.version, 'status', new.status));
  elsif old.status is distinct from new.status then
    perform public.log_activity(auth.uid(), 'admin', 'deliverable.status_changed', 'deliverable', new.id,
                                jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if (tg_op = 'INSERT' and new.status = 'client_review')
     or (tg_op = 'UPDATE' and new.status = 'client_review' and old.status is distinct from new.status) then
    perform public.log_activity(auth.uid(), 'admin', 'review.requested', 'deliverable', new.id, '{}');
    for r in select * from public.project_client_user_ids(new.project_id) loop
      perform public.notify(r.user_id, 'user', 'deliverable_new', 'deliverable', new.id,
                            'مخرَج جديد جاهز للمراجعة', 'New deliverable ready for review');
    end loop;
  elsif tg_op = 'UPDATE' and new.status = 'final_delivered' and old.status is distinct from new.status then
    perform public.log_activity(auth.uid(), 'admin', 'deliverable.final_delivered', 'deliverable', new.id, '{}');
    for r in select * from public.project_client_user_ids(new.project_id) loop
      perform public.notify(r.user_id, 'user', 'deliverable_final_delivered', 'deliverable', new.id,
                            'تم تسليم الملفات النهائية', 'Final files delivered');
    end loop;
  end if;
  return new;
end; $$;
create trigger t_deliverable_change after insert or update on public.deliverables
  for each row execute function public.trg_deliverable_change();

-- PATCH 8P: log the reviewer's real project role (legacy contact ⇒ client_owner)
create or replace function public.trg_review_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select coalesce(public.project_role(d.project_id), 'client_owner')
    into v_role
    from public.deliverables d where d.id = new.deliverable_id;

  update public.deliverables set status = new.decision where id = new.deliverable_id;

  if new.decision = 'revision_requested' then
    perform public.log_activity(new.reviewer_id, v_role, 'revision.requested', 'deliverable', new.deliverable_id,
                                jsonb_build_object('comments', new.comments));
    perform public.notify(null, 'admin', 'revision_requested', 'deliverable', new.deliverable_id,
                          'طلب تعديل على مخرَج', 'Revision requested on a deliverable');
  else
    perform public.log_activity(new.reviewer_id, v_role, 'deliverable.approved', 'deliverable', new.deliverable_id, '{}');
    perform public.notify(null, 'admin', 'deliverable_approved', 'deliverable', new.deliverable_id,
                          'تم اعتماد مخرَج', 'Deliverable approved');
  end if;
  return new;
end; $$;
create trigger t_review_created after insert on public.deliverable_reviews
  for each row execute function public.trg_review_created();

create or replace function public.trg_project_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(auth.uid(), 'admin', 'project.created', 'project', new.id,
                                jsonb_build_object('name', new.project_name));
  elsif old.status is distinct from new.status then
    perform public.log_activity(auth.uid(), 'admin', 'project.status_changed', 'project', new.id,
                                jsonb_build_object('from', old.status, 'to', new.status));
    for r in select * from public.project_client_user_ids(new.id) loop
      perform public.notify(r.user_id, 'user', 'project_status_changed', 'project', new.id,
                            'تحدّثت حالة مشروعك', 'Your project status was updated');
    end loop;
  end if;
  return new;
end; $$;
create trigger t_project_change after insert or update on public.projects
  for each row execute function public.trg_project_change();

-- Membership audit: insert = added; soft-delete flag = removed; hard delete
-- (dashboard only) = removed.
create or replace function public.trg_member_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(auth.uid(), 'admin', 'member.added', 'project_member', new.id,
            jsonb_build_object('project', new.project_id, 'user', new.user_id, 'role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.is_deleted and not old.is_deleted then
      perform public.log_activity(auth.uid(), 'admin', 'member.removed', 'project_member', new.id,
              jsonb_build_object('project', new.project_id, 'user', new.user_id, 'role', new.role));
    end if;
    return new;
  else
    perform public.log_activity(auth.uid(), 'admin', 'member.removed', 'project_member', old.id,
            jsonb_build_object('project', old.project_id, 'user', old.user_id, 'role', old.role, 'hard', true));
    return old;
  end if;
end; $$;
create trigger t_member_change after insert or update or delete on public.project_members
  for each row execute function public.trg_member_change();

-- Profile audit: account fields → account.updated; general fields → profile.updated
create or replace function public.trg_profile_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare changed jsonb := '{}';
begin
  if old.account_type   is distinct from new.account_type
     or old.account_status is distinct from new.account_status
     or old.client_level   is distinct from new.client_level
     or old.company_id     is distinct from new.company_id then
    perform public.log_activity(auth.uid(), 'admin', 'account.updated', 'profile', new.id,
      jsonb_build_object(
        'type',    jsonb_build_object('from', old.account_type,   'to', new.account_type),
        'status',  jsonb_build_object('from', old.account_status, 'to', new.account_status),
        'level',   jsonb_build_object('from', old.client_level,   'to', new.client_level),
        'company', jsonb_build_object('from', old.company_id,     'to', new.company_id)));
  end if;

  if old.full_name is distinct from new.full_name then
    changed := changed || jsonb_build_object('full_name', jsonb_build_object('from', old.full_name, 'to', new.full_name));
  end if;
  if old.company is distinct from new.company then
    changed := changed || jsonb_build_object('company', jsonb_build_object('from', old.company, 'to', new.company));
  end if;
  if old.mobile is distinct from new.mobile then
    changed := changed || jsonb_build_object('mobile', jsonb_build_object('from', old.mobile, 'to', new.mobile));
  end if;
  if old.preferred_lang is distinct from new.preferred_lang then
    changed := changed || jsonb_build_object('preferred_lang', jsonb_build_object('from', old.preferred_lang, 'to', new.preferred_lang));
  end if;
  if old.marketing_opt_in is distinct from new.marketing_opt_in then
    changed := changed || jsonb_build_object('marketing_opt_in', jsonb_build_object('from', old.marketing_opt_in, 'to', new.marketing_opt_in));
  end if;
  if changed <> '{}'::jsonb then
    perform public.log_activity(auth.uid(),
            case when public.is_admin() then 'admin' else 'user' end,
            'profile.updated', 'profile', new.id, changed);
  end if;

  new.updated_at = now();
  return new;
end; $$;
create trigger t_profile_audit before update on public.profiles
  for each row execute function public.trg_profile_audit();

-- ─── 13. RLS: ENABLE + GRANTS + POLICIES ────────────────────────────────────
alter table public.companies                enable row level security;
alter table public.profiles                 enable row level security;
alter table public.project_members          enable row level security;
alter table public.quote_requests           enable row level security;
alter table public.messages                 enable row level security;
alter table public.file_links               enable row level security;
alter table public.offers                   enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.activity_log             enable row level security;
alter table public.project_notes            enable row level security;
alter table public.deliverables             enable row level security;
alter table public.deliverable_assets       enable row level security;
alter table public.client_comments          enable row level security;
alter table public.internal_comments        enable row level security;
alter table public.deliverable_reviews      enable row level security;
alter table public.project_messages         enable row level security;
alter table public.admin_notes              enable row level security;
alter table public.integration_outbox       enable row level security;
-- clients & projects: RLS already enabled by the earlier portal setup (kept).

-- Grants. NOTE: activity_log / admin_notes / integration_outbox /
-- deliverable_assets get NO authenticated grants at all (zero-grant tables);
-- admins use the Supabase dashboard until the Phase-3 /admin UI adds scoped grants.
grant select on public.companies, public.profiles, public.project_members,
                public.quote_requests, public.messages, public.file_links, public.offers,
                public.notifications, public.notification_preferences,
                public.project_notes, public.deliverables, public.client_comments,
                public.internal_comments, public.deliverable_reviews, public.project_messages
  to authenticated;
grant insert on public.quote_requests, public.messages, public.file_links,
                public.project_notes, public.client_comments, public.internal_comments,
                public.deliverable_reviews, public.project_messages
  to authenticated;
grant update (full_name, company, mobile, preferred_lang, marketing_opt_in)
  on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (portal_enabled, email_enabled, whatsapp_enabled)
  on public.notification_preferences to authenticated;
-- Deliberately NO delete grants anywhere: hard delete impossible from the portal.

-- companies
create policy "own company read" on public.companies for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and is_deleted = false and id in
         (select company_id from public.profiles where id = auth.uid())));
create policy "admin all companies" on public.companies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles (no soft-delete column by design)
create policy "own profile read" on public.profiles for select to authenticated
  using ((id = auth.uid() and public.is_not_blocked()) or public.is_admin());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active()) with check (id = auth.uid());

-- project_members
create policy "members read" on public.project_members for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and is_deleted = false
         and public.can_access_project(project_id)));
create policy "members admin write" on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- projects: ADD membership read (existing legacy policy untouched) +
-- RESTRICTIVE live-rows policy so soft-deleted rows vanish under ALL policies.
create policy "projects member read" on public.projects for select to authenticated
  using (public.is_not_blocked() and public.can_access_project(id));
create policy "projects live rows only" on public.projects as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());
create policy "admin all projects" on public.projects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- clients: RESTRICTIVE live-rows policy (existing legacy policy untouched)
create policy "clients live rows only" on public.clients as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());
create policy "admin all clients" on public.clients for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- quote_requests
create policy "own quotes read" on public.quote_requests for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked() and is_deleted = false)
         or public.is_admin());
create policy "own quotes insert" on public.quote_requests for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and status = 'new');
create policy "admin all quotes" on public.quote_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- messages
create policy "own messages read" on public.messages for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked() and is_deleted = false)
         or public.is_admin());
create policy "own messages insert" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and sender = 'user' and public.is_active());
create policy "admin all messages" on public.messages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- file_links
create policy "own files read" on public.file_links for select to authenticated
  using (public.is_admin()
         or (public.is_not_blocked() and is_deleted = false
             and (user_id = auth.uid()
                  or (project_id is not null and public.is_kian_member(project_id)))));
create policy "own files insert" on public.file_links for insert to authenticated
  with check (user_id = auth.uid() and public.is_active()
              and (project_id is null or public.is_client_side(project_id)));

-- offers
create policy "offers read" on public.offers for select to authenticated
  using (public.is_admin() or (is_published and is_deleted = false and public.is_not_blocked()
         and (audience = 'all'
              or (audience = 'clients' and exists (select 1 from public.profiles
                    where id = auth.uid() and account_type = 'client'))
              or (audience = 'leads'   and exists (select 1 from public.profiles
                    where id = auth.uid() and account_type = 'lead')))));
create policy "admin all offers" on public.offers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- notifications (no soft-delete column by design)
create policy "own notifications read" on public.notifications for select to authenticated
  using ((recipient_id = auth.uid() and public.is_not_blocked())
         or (recipient_role = 'admin' and public.is_admin()));
create policy "own notifications mark-read" on public.notifications for update to authenticated
  using (recipient_id = auth.uid() and public.is_not_blocked())
  with check (recipient_id = auth.uid());

-- notification_preferences
create policy "own prefs read" on public.notification_preferences for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "own prefs update" on public.notification_preferences for update to authenticated
  using (user_id = auth.uid() and public.is_not_blocked()) with check (user_id = auth.uid());

-- activity_log: admin-only read policy (no grants yet → dashboard-only until Phase 3)
create policy "log admin read" on public.activity_log for select to authenticated
  using (public.is_admin());

-- project_notes
create policy "project notes read" on public.project_notes for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and is_deleted = false
         and public.can_access_project(project_id)));
create policy "project notes insert" on public.project_notes for insert to authenticated
  with check (author_id = auth.uid() and author_role = 'client' and public.is_active()
              and public.is_client_side(project_id));

-- deliverables
create policy "deliverables read" on public.deliverables for select to authenticated
  using (public.is_admin()
         or (is_deleted = false
             and (public.is_kian_member(project_id)
                  or (public.is_not_blocked() and public.is_client_side(project_id)
                      and status in ('client_review','revision_requested','approved','final_delivered')))));
create policy "admin all dlv" on public.deliverables for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- deliverable_assets: admin-only (zero grants; policy future-proofs Phase 3)
create policy "assets admin all" on public.deliverable_assets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- client_comments
create policy "client comments read" on public.client_comments for select to authenticated
  using (public.is_admin()
         or (is_deleted = false and exists (
               select 1 from public.deliverables d
               where d.id = deliverable_id and d.is_deleted = false
                 and (public.is_kian_member(d.project_id)
                      or (public.is_not_blocked() and public.is_client_side(d.project_id)
                          and d.status in ('client_review','revision_requested','approved','final_delivered'))))));
create policy "client comments insert" on public.client_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active()
              and exists (select 1 from public.deliverables d
                          where d.id = deliverable_id and d.is_deleted = false
                            and ((author_role = 'client' and public.is_client_side(d.project_id)
                                  and d.status in ('client_review','revision_requested'))
                                 or (author_role = 'admin' and public.is_kian_member(d.project_id)))));

-- internal_comments: Kian members + admin ONLY — clients can never read or write
create policy "internal comments read" on public.internal_comments for select to authenticated
  using (public.is_admin()
         or (is_deleted = false and public.is_kian_member(coalesce(project_id,
               (select d.project_id from public.deliverables d where d.id = deliverable_id)))));
create policy "internal comments insert" on public.internal_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active()
              and public.is_kian_member(coalesce(project_id,
                    (select d.project_id from public.deliverables d where d.id = deliverable_id))));

-- deliverable_reviews: only client_owner decides, only during client_review
create policy "reviews read" on public.deliverable_reviews for select to authenticated
  using (public.is_admin()
         or (is_deleted = false and exists (
               select 1 from public.deliverables d
               where d.id = deliverable_id
                 and (public.is_kian_member(d.project_id)
                      or (public.is_not_blocked() and public.is_client_side(d.project_id))))));
create policy "reviews insert" on public.deliverable_reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_active()
              and exists (select 1 from public.deliverables d
                          where d.id = deliverable_id and d.is_deleted = false
                            and d.status = 'client_review'
                            and public.is_client_owner(d.project_id)));

-- project_messages
create policy "project chat read" on public.project_messages for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and is_deleted = false
         and public.can_access_project(project_id)));
create policy "project chat insert" on public.project_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_active()
              and ((sender_role = 'client' and public.is_client_side(project_id))
                   or (sender_role = 'admin' and public.is_kian_member(project_id))));

-- admin-only tables (zero grants; policies future-proof the Phase-3 /admin UI)
create policy "admin notes all" on public.admin_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "outbox admin all" on public.integration_outbox for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── 14. INDEXES ────────────────────────────────────────────────────────────
create index if not exists profiles_company_idx        on public.profiles (company_id);
create index if not exists project_members_user_idx    on public.project_members (user_id);
create index if not exists project_members_project_idx on public.project_members (project_id);
create index if not exists quote_requests_user_idx     on public.quote_requests (user_id, created_at desc);
create index if not exists messages_user_idx           on public.messages (user_id, created_at desc);
create index if not exists file_links_user_idx         on public.file_links (user_id);
create index if not exists file_links_project_idx      on public.file_links (project_id);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_admin_idx     on public.notifications (recipient_role, created_at desc) where recipient_role = 'admin';
create index if not exists activity_log_entity_idx     on public.activity_log (entity_type, entity_id);
create index if not exists activity_log_actor_idx      on public.activity_log (actor_id, created_at desc);
create index if not exists activity_log_created_idx    on public.activity_log (created_at desc);
create index if not exists project_notes_project_idx   on public.project_notes (project_id);
create index if not exists deliverables_project_idx    on public.deliverables (project_id);
create index if not exists client_comments_dlv_idx     on public.client_comments (deliverable_id, created_at);
create index if not exists internal_comments_dlv_idx   on public.internal_comments (deliverable_id);
create index if not exists internal_comments_proj_idx  on public.internal_comments (project_id);
create index if not exists reviews_dlv_idx             on public.deliverable_reviews (deliverable_id);
create index if not exists project_messages_proj_idx   on public.project_messages (project_id, created_at);
create index if not exists projects_company_idx        on public.projects (company_id);
create index if not exists outbox_pending_idx          on public.integration_outbox (status, created_at) where status = 'pending';

commit;

-- ─── PostgREST schema reload (harmless if automatic) ────────────────────────
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — LOGIN TRACKING via auth.sessions (run AFTER Part 1 commits)
-- May fail on plans that restrict auth-schema triggers. If it fails:
-- do nothing — the portal will call public.log_login() after sign-in (Phase 1).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.trg_session_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.user_id, 'user', 'user.logged_in', 'session', new.id, '{}');
  return new;
end; $$;

create trigger t_session_created after insert on auth.sessions
  for each row execute function public.trg_session_created();
