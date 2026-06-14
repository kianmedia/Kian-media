# Kian Client Portal — Roadmap & Implementation Plan
**Version 1.3 · 2026-06-12 · supersedes v1.2 · Status: FINAL PLAN — awaiting approval before Phase 0/1 coding**

Changes from v1.2:
1. **Soft delete architecture** — `is_deleted / deleted_at / deleted_by` on all business records; **no hard delete from the portal UI** (§2.13)
2. **Complete activity timeline** — adds login tracking, profile-update audit, review-request and delete/restore events; admin-only (§2.14)

Changes from v1.1:
1. **`project_members`** — per-project team access (client + Kian internal roles)
2. **`companies`** — company accounts: many users, many projects per company
3. **Deliverable approval workflow** expanded to 7 states; final delivery requires explicit client approval
4. **Comments split** — `client_comments` vs `internal_comments` (internal never visible to clients)
5. **`notification_preferences`** — per-user channel control (portal now; email/WhatsApp future)

Changes from v1.0 (kept): `client_level`, notifications + activity log in Phase 0/1, Frame.io-style review, fixed admin emails, all open decisions resolved.

---

## 0. Where we are today

| Piece | State |
|---|---|
| Auth | Supabase email/password, REST (no SDK), public signup **enabled**, email confirmation **ON (stays ON)** |
| Tables | `clients` (admin-provisioned), `projects` — SELECT-only RLS, working |
| UI | `/client-portal` — login + read-only dashboard (welcome, timeline, download link) |
| Users | Anyone without a `clients` row sees "account not activated" and is logged out |

Core change: **a signup is no longer a dead end.** Every new user becomes a `lead`; `client` is an admin-granted upgrade; `admin` is staff. Corporate clients get **company accounts** with multiple users, and projects get **explicit member lists** covering both client-side and Kian-side people.

---

## 1. Account & access model

### 1.1 Global account fields (on `profiles`)

```
account_type:   lead | client | admin        (upgrades admin-controlled, one-way)
account_status: active | inactive | blocked
client_level:   prospect | active | vip      (meaningful only when account_type = 'client')
```

| Business event | account_type | client_level |
|---|---|---|
| New public signup | `lead` | — |
| Quotation signed | `client` | `prospect` |
| Project becomes active | `client` | `active` |
| Strategic / high-value client | `client` | `vip` |

- `active` — full access for their tier · `inactive` — **read-only** · `blocked` — **sees nothing** ("contact us" screen)
- **Admin access ONLY:** `kianalebtikar@gmail.com` · `manager@kianmedia.com` (set by Phase 0 SQL; no other admin without updating this roadmap)

### 1.2 Companies (NEW)

One **company** ⇢ many users (`profiles.company_id`) ⇢ many projects (`projects.company_id`). Users belong to companies instead of being tied only to individual records. The legacy `clients` table stays during transition (the live portal reads it); new work keys off `companies` + `project_members`.

### 1.3 Project membership & roles (NEW)

Every project has an explicit member list (`project_members`). Roles:

| Role | Side | Can do |
|---|---|---|
| `client_owner` | Client | Everything client-side **including approve / request revision / accept final delivery** |
| `client_member` | Client | View project, comment, chat, upload links — **cannot approve** |
| `kian_admin` | Kian | Full project control (mirrors global admin within this project) |
| `kian_manager` | Kian | Manage deliverables, reply, see internal comments |
| `kian_editor` | Kian | See project + internal comments, post internal comments |
| `kian_photographer` | Kian | See project + internal comments, post internal comments |
| `kian_viewer` | Kian | Read-only incl. internal comments |

Rules:
- Project visibility = **explicit membership** (or legacy `clients` link, kept for compatibility) — company affiliation alone does NOT grant project access; each user is added per-project.
- `kian_*` roles let non-admin Kian staff (editors, photographers) work on specific projects without global admin. Global `account_type='admin'` remains only the 2 emails.
- Only `client_owner` (or the legacy single-contact client) can submit approval decisions.
- Internal comments are visible to `kian_*` members + admins ONLY — never to `client_*` users.

### 1.4 Capability matrix (global tiers)

| Capability | lead | client | admin |
|---|:--:|:--:|:--:|
| Profile, quotes, support messages, file links, offers, notifications | ✅ | ✅ | ✅ |
| Notification channel preferences | ✅ | ✅ | ✅ |
| Company info (own company) | — | ✅ | ✅ |
| Projects where they are a member: timeline, files, notes, chat, client comments | — | ✅ | ✅ |
| Approve / request revision / accept final delivery | — | `client_owner` only | ✅ |
| Internal comments | — | — (kian_* members only) | ✅ |
| Download final files | — | only if admin allows | ✅ |
| Activity log, admin notes, outbox, other users/companies | — | — | ✅ |

**Leads must never see real project data.**

---

## 2. Database schema (Phase 0 — one migration, additive only)

> Existing `clients` / `projects` keep working untouched (columns are only added). Run the whole §2 as a single migration so function references resolve.

### 2.1 Companies (NEW)

```sql
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,            -- Arabic / primary name
  name_en         text,
  cr_number       text,                     -- السجل التجاري (optional)
  vat_number      text,                     -- الرقم الضريبي (optional)
  city            text,
  zoho_account_id text,                     -- future: Zoho CRM Account
  created_at      timestamptz not null default now()
);
```

### 2.2 Profiles + signup trigger

```sql
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  company         text,                     -- free text from signup (transition)
  company_id      uuid references public.companies(id) on delete set null,  -- NEW
  mobile          text,
  preferred_lang  text not null default 'ar' check (preferred_lang in ('ar','en')),
  account_type    text not null default 'lead'     check (account_type   in ('lead','client','admin')),
  account_status  text not null default 'active'   check (account_status in ('active','inactive','blocked')),
  client_level    text not null default 'prospect' check (client_level   in ('prospect','active','vip')),
  marketing_opt_in boolean not null default false,  -- PDPL consent
  zoho_lead_id    text,
  zoho_contact_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  insert into public.notification_preferences (user_id) values (new.id);   -- NEW
  perform public.log_activity(new.id, 'user', 'user.signed_up', 'profile', new.id, '{}'::jsonb);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Backfill + admin seed:
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;
insert into public.notification_preferences (user_id) select id from auth.users on conflict (user_id) do nothing;
update public.profiles set account_type = 'admin'
 where email in ('kianalebtikar@gmail.com','manager@kianmedia.com');
```

### 2.3 Project members (NEW)

```sql
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

alter table public.projects
  add column if not exists company_id            uuid references public.companies(id) on delete set null,  -- NEW
  add column if not exists zoho_deal_id          text,
  add column if not exists zoho_books_invoice_id text;
```

### 2.4 Access helper functions (security definer → no RLS recursion)

```sql
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and account_type = 'admin' and account_status = 'active');
$$;

create or replace function public.is_active() returns boolean          -- writes require ACTIVE
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active');
$$;

create or replace function public.is_not_blocked() returns boolean     -- reads require NOT BLOCKED
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_status <> 'blocked');
$$;

create or replace function public.my_client_id() returns uuid          -- legacy compatibility path
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c
  join public.profiles p on p.id = c.user_id
  where c.user_id = auth.uid()
    and p.account_type in ('client','admin') and p.account_status <> 'blocked'
  limit 1;
$$;

create or replace function public.project_role(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid() limit 1;
$$;

-- any access to the project (member, legacy client, or admin)
create or replace function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or public.project_role(p_project) is not null
      or exists (select 1 from public.projects p
                 where p.id = p_project and p.client_id = public.my_client_id());
$$;

-- client-side participant (can comment/chat/upload as 'client')
create or replace function public.is_client_side(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) like 'client\_%'
      or exists (select 1 from public.projects p
                 where p.id = p_project and p.client_id = public.my_client_id());
$$;

-- approver: client_owner (or legacy single-contact client)
create or replace function public.is_client_owner(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) = 'client_owner'
      or exists (select 1 from public.projects p
                 where p.id = p_project and p.client_id = public.my_client_id());
$$;

-- Kian internal team on this project (sees drafts + internal comments)
create or replace function public.is_kian_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.project_role(p_project) like 'kian\_%';
$$;
```

### 2.5 Activity log (admin-only audit trail)

```sql
create table public.activity_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id),
  actor_role  text check (actor_role in ('user','admin','system')),
  action      text not null,
  -- canonical: user.signed_up | user.logged_in | profile.updated | account.updated
  --            quote.submitted | file.uploaded | message.sent
  --            project.created | project.status_changed | project.note_added
  --            member.added | member.removed
  --            deliverable.uploaded | deliverable.status_changed | review.requested
  --            revision.requested | deliverable.approved | deliverable.final_delivered
  --            record.deleted | record.restored
  entity_type text, entity_id uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create or replace function public.log_activity(
  p_actor uuid, p_role text, p_action text, p_etype text, p_eid uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (p_actor, p_role, p_action, p_etype, p_eid, coalesce(p_meta, '{}'));
$$;
```

### 2.6 Notifications + per-user preferences (NEW)

```sql
create table public.notification_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  portal_enabled   boolean not null default true,
  email_enabled    boolean not null default false,   -- channel ships Phase 5
  whatsapp_enabled boolean not null default false,   -- channel ships Phase 5 (WhatsApp API)
  updated_at       timestamptz not null default now()
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid references auth.users(id) on delete cascade,  -- null ⇒ admin broadcast
  recipient_role text not null default 'user' check (recipient_role in ('user','admin')),
  type           text not null check (type in (
    'quote_request_new','message_new','file_link_new','project_note_new',
    'deliverable_new','revision_requested','deliverable_approved',
    'deliverable_final_delivered','project_status_changed')),
  title_ar    text not null,
  title_en    text not null,
  entity_type text, entity_id uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint recipient_shape check ((recipient_role = 'admin') = (recipient_id is null))
);

-- respects portal_enabled for user-targeted notifications
create or replace function public.notify(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role = 'user' and exists (select 1 from public.notification_preferences
                                 where user_id = p_recipient and portal_enabled = false) then
    return;   -- user muted the portal channel
  end if;
  insert into public.notifications (recipient_id, recipient_role, type, entity_type, entity_id, title_ar, title_en)
  values (p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);
end; $$;
```

Channel plan: this table IS the in-portal center. Email/WhatsApp (Phase 5) fan out from the same rows via `integration_outbox` (targets `email`, `whatsapp`), each checking `email_enabled` / `whatsapp_enabled` per user. Admin broadcasts are stored once; each admin's own preference is applied in the admin UI.

### 2.7 Lead-tier tables

```sql
create table public.quote_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  reference     text,                       -- QR-2026-xxxxxx (reuse lib/submitForm.makeRef)
  services      text[] not null default '{}',
  description   text,
  budget_range  text,
  city          text,
  preferred_date date,
  status        text not null default 'new'
                check (status in ('new','in_review','quoted','accepted','rejected','archived')),
  sheet_mirrored boolean not null default false,  -- transition: also posted to Google Sheet
  zoho_deal_id           text,
  zoho_books_estimate_id text,
  created_at    timestamptz not null default now()
);

create table public.messages (               -- general support thread (one per user)
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  sender     text not null check (sender in ('user','admin')),
  body       text not null check (length(body) between 1 and 4000),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table public.file_links (             -- link uploads now; Storage in Phase 5
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  url        text not null,
  label      text,
  created_at timestamptz not null default now()
);

create table public.offers (                  -- LAUNCHES EMPTY — no fake offers
  id           uuid primary key default gen_random_uuid(),
  title_ar     text, title_en text,
  body_ar      text, body_en  text,
  audience     text not null default 'all' check (audience in ('all','leads','clients')),
  is_published boolean not null default false,
  starts_at    timestamptz, ends_at timestamptz,
  created_at   timestamptz not null default now()
);
```

### 2.8 Deliverables — 7-state approval workflow (UPDATED)

```
draft → internal_review → client_review → approved → final_delivered → archived
                ▲               │
                └── revision_requested ◄──┘   (loop until approved)
```

| State | Meaning | Visible to client? |
|---|---|:--:|
| `draft` | Being prepared | ❌ |
| `internal_review` | Kian QA (kian_* members review) | ❌ |
| `client_review` | Waiting for client decision | ✅ |
| `revision_requested` | Client asked for changes | ✅ |
| `approved` | **Explicit client_owner approval recorded** | ✅ |
| `final_delivered` | Final files released — **only allowed from `approved`** (DB-enforced) | ✅ |
| `archived` | Closed out | ❌ (admin/Kian only) |

```sql
create table public.project_notes (            -- client notes & reference links
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
  preview_url      text,                      -- fallback protected link
  vimeo_video_id   text,                      -- future: Vimeo
  vimeo_review_url text,                      -- protected Vimeo review link
  watermark_required boolean not null default true,
    -- previews carry Kian logo + client name + timestamp where pipeline supports it
  allow_download   boolean not null default false,
  status           text not null default 'draft' check (status in
                   ('draft','internal_review','client_review',
                    'revision_requested','approved','final_delivered','archived')),
  created_at       timestamptz not null default now()
);

-- Final/master files: ADMIN-ONLY table; clients only via gated RPC below
create table public.deliverable_assets (
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  kind           text not null default 'final' check (kind in ('final','master','source')),
  url            text not null,
  created_at     timestamptz not null default now()
);

-- CLIENT comments: visible to client-side + Kian; timecode 92 ⇒ "00:01:32"
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

-- INTERNAL comments: Kian-only — NEVER visible to clients (editor/production/budget/QA notes)
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

create table public.deliverable_reviews (      -- formal client decisions
  id             uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  reviewer_id    uuid not null references auth.users(id),
  decision       text not null check (decision in ('approved','revision_requested')),
  comments       text,
  created_at     timestamptz not null default now()
);

create table public.project_messages (         -- chat inside each project
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  sender_role text not null check (sender_role in ('client','admin')),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

-- Gated download: only after explicit approval AND admin allowed it
create or replace function public.get_deliverable_download(p_deliverable uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.url
  from public.deliverable_assets a
  join public.deliverables d on d.id = a.deliverable_id
  where a.deliverable_id = p_deliverable and a.kind = 'final'
    and (public.is_admin()
         or (d.allow_download
             and d.status in ('approved','final_delivered')
             and public.is_client_side(d.project_id)
             and public.is_not_blocked()))
  limit 1;
$$;
grant execute on function public.get_deliverable_download(uuid) to authenticated;
```

### 2.9 Admin-only tables

```sql
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
```

### 2.10 Event triggers (log + notify + workflow guards)

```sql
-- Quote submitted → log + notify admins
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

-- Message → log + notify the other side
create or replace function public.trg_message_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(coalesce(auth.uid(), new.user_id),
          case when new.sender = 'user' then 'user' else 'admin' end,
          'message.sent', 'message', new.id, '{}');
  if new.sender = 'user' then
    perform public.notify(null, 'admin', 'message_new', 'message', new.id, 'رسالة جديدة', 'New message');
  else
    perform public.notify(new.user_id, 'user', 'message_new', 'message', new.id, 'رد جديد من كيان', 'New reply from Kian');
  end if;
  return new;
end; $$;
create trigger t_message_created after insert on public.messages
  for each row execute function public.trg_message_created();

-- File link → log + notify admins
create or replace function public.trg_file_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.user_id, 'user', 'file.uploaded', 'file_link', new.id, '{}');
  perform public.notify(null, 'admin', 'file_link_new', 'file_link', new.id, 'ملف/رابط جديد', 'New file/link uploaded');
  return new;
end; $$;
create trigger t_file_created after insert on public.file_links
  for each row execute function public.trg_file_created();

-- Project note → log + notify other side (client members get notified individually)
create or replace function public.trg_note_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.log_activity(new.author_id, new.author_role, 'project.note_added', 'project_note', new.id, '{}');
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

-- helper: all client-side recipients of a project (members + legacy contact)
create or replace function public.project_client_user_ids(p_project uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select pm.user_id from public.project_members pm
   where pm.project_id = p_project and pm.role like 'client\_%'
  union
  select c.user_id from public.clients c
   join public.projects p on p.client_id = c.id where p.id = p_project;
$$;

-- Deliverable lifecycle: guard transitions + log + notify on key states
create or replace function public.trg_deliverable_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'UPDATE' and new.status = 'final_delivered' and old.status <> 'approved' then
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

-- Review decision → flip status + log + notify admins
create or replace function public.trg_review_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.deliverables set status = new.decision where id = new.deliverable_id;
  if new.decision = 'revision_requested' then
    perform public.log_activity(new.reviewer_id, 'client', 'revision.requested', 'deliverable', new.deliverable_id,
                                jsonb_build_object('comments', new.comments));
    perform public.notify(null, 'admin', 'revision_requested', 'deliverable', new.deliverable_id,
                          'طلب تعديل على مخرَج', 'Revision requested on a deliverable');
  else
    perform public.log_activity(new.reviewer_id, 'client', 'deliverable.approved', 'deliverable', new.deliverable_id, '{}');
    perform public.notify(null, 'admin', 'deliverable_approved', 'deliverable', new.deliverable_id,
                          'تم اعتماد مخرَج', 'Deliverable approved');
  end if;
  return new;
end; $$;
create trigger t_review_created after insert on public.deliverable_reviews
  for each row execute function public.trg_review_created();

-- Project created / status changed → log + notify client members
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

-- Membership changes → audit
create or replace function public.trg_member_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(auth.uid(), 'admin', 'member.added', 'project_member', new.id,
                                jsonb_build_object('project', new.project_id, 'user', new.user_id, 'role', new.role));
    return new;
  else
    perform public.log_activity(auth.uid(), 'admin', 'member.removed', 'project_member', old.id,
                                jsonb_build_object('project', old.project_id, 'user', old.user_id, 'role', old.role));
    return old;
  end if;
end; $$;
create trigger t_member_change after insert or delete on public.project_members
  for each row execute function public.trg_member_change();

-- Admin changed account_type / account_status / client_level / company → audit + updated_at
create or replace function public.trg_profile_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.account_type is distinct from new.account_type
     or old.account_status is distinct from new.account_status
     or old.client_level  is distinct from new.client_level
     or old.company_id    is distinct from new.company_id then
    perform public.log_activity(auth.uid(), 'admin', 'account.updated', 'profile', new.id,
      jsonb_build_object('type',   jsonb_build_object('from', old.account_type,   'to', new.account_type),
                         'status', jsonb_build_object('from', old.account_status, 'to', new.account_status),
                         'level',  jsonb_build_object('from', old.client_level,   'to', new.client_level),
                         'company',jsonb_build_object('from', old.company_id,     'to', new.company_id)));
  end if;
  new.updated_at = now();
  return new;
end; $$;
create trigger t_profile_audit before update on public.profiles
  for each row execute function public.trg_profile_audit();
```

### 2.11 RLS — enable, grant, policies

```sql
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
-- clients & projects already have RLS + SELECT policies (keep; add membership read below)

-- Grants
grant select on public.companies, public.profiles, public.project_members, public.quote_requests,
                public.messages, public.file_links, public.offers, public.notifications,
                public.notification_preferences, public.project_notes, public.deliverables,
                public.client_comments, public.internal_comments, public.deliverable_reviews,
                public.project_messages
  to authenticated;
grant insert on public.quote_requests, public.messages, public.file_links, public.project_notes,
                public.client_comments, public.internal_comments, public.deliverable_reviews,
                public.project_messages
  to authenticated;
grant update (full_name, company, mobile, preferred_lang, marketing_opt_in)
  on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (portal_enabled, email_enabled, whatsapp_enabled)
  on public.notification_preferences to authenticated;
-- activity_log / admin_notes / integration_outbox / deliverable_assets: NO authenticated grants

-- companies: members of the company read it
create policy "own company read" on public.companies for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and id in
         (select company_id from public.profiles where id = auth.uid())));

-- profiles
create policy "own profile read" on public.profiles for select to authenticated
  using ((id = auth.uid() and public.is_not_blocked()) or public.is_admin());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active()) with check (id = auth.uid());

-- project_members: members of a project can see its member list; only admin manages
create policy "members read" on public.project_members for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and public.can_access_project(project_id)));
create policy "members admin write" on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- projects: membership-based read (in addition to existing legacy client policy)
create policy "projects member read" on public.projects for select to authenticated
  using (public.is_not_blocked() and public.can_access_project(id));

-- quote_requests / messages / file_links / offers / notifications / prefs
create policy "own quotes read" on public.quote_requests for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked()) or public.is_admin());
create policy "own quotes insert" on public.quote_requests for insert to authenticated
  with check (user_id = auth.uid() and public.is_active() and status = 'new');

create policy "own messages read" on public.messages for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked()) or public.is_admin());
create policy "own messages insert" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and sender = 'user' and public.is_active());

create policy "own files read" on public.file_links for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked()) or public.is_admin()
         or (project_id is not null and public.is_kian_member(project_id)));
create policy "own files insert" on public.file_links for insert to authenticated
  with check (user_id = auth.uid() and public.is_active()
              and (project_id is null or public.is_client_side(project_id)));

create policy "offers read" on public.offers for select to authenticated
  using (public.is_admin() or (is_published and public.is_not_blocked()
         and (audience = 'all'
              or (audience = 'clients' and exists (select 1 from public.profiles
                    where id = auth.uid() and account_type = 'client'))
              or (audience = 'leads'   and exists (select 1 from public.profiles
                    where id = auth.uid() and account_type = 'lead')))));

create policy "own notifications read" on public.notifications for select to authenticated
  using ((recipient_id = auth.uid() and public.is_not_blocked())
         or (recipient_role = 'admin' and public.is_admin()));
create policy "own notifications mark-read" on public.notifications for update to authenticated
  using (recipient_id = auth.uid() and public.is_not_blocked())
  with check (recipient_id = auth.uid());

create policy "own prefs read" on public.notification_preferences for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "own prefs update" on public.notification_preferences for update to authenticated
  using (user_id = auth.uid() and public.is_not_blocked()) with check (user_id = auth.uid());

-- activity_log: admin read only
create policy "log admin read" on public.activity_log for select to authenticated
  using (public.is_admin());

-- project chain — membership-based
create policy "project notes read" on public.project_notes for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and public.can_access_project(project_id)));
create policy "project notes insert" on public.project_notes for insert to authenticated
  with check (author_id = auth.uid() and author_role = 'client' and public.is_active()
              and public.is_client_side(project_id));

-- deliverables: Kian members see everything; clients only client-visible states
create policy "deliverables read" on public.deliverables for select to authenticated
  using (public.is_kian_member(project_id)
         or (public.is_not_blocked() and public.is_client_side(project_id)
             and status in ('client_review','revision_requested','approved','final_delivered')));

-- client comments: both sides of the project; clients only on client-visible deliverables
create policy "client comments read" on public.client_comments for select to authenticated
  using (exists (select 1 from public.deliverables d
                 where d.id = deliverable_id
                   and (public.is_kian_member(d.project_id)
                        or (public.is_not_blocked() and public.is_client_side(d.project_id)
                            and d.status in ('client_review','revision_requested','approved','final_delivered')))));
create policy "client comments insert" on public.client_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active()
              and exists (select 1 from public.deliverables d
                          where d.id = deliverable_id
                            and ((author_role = 'client' and public.is_client_side(d.project_id)
                                  and d.status in ('client_review','revision_requested'))
                                 or (author_role = 'admin' and public.is_kian_member(d.project_id)))));

-- INTERNAL comments: Kian members + admin ONLY — clients can never read or write
create policy "internal comments read" on public.internal_comments for select to authenticated
  using (public.is_kian_member(coalesce(project_id,
           (select d.project_id from public.deliverables d where d.id = deliverable_id))));
create policy "internal comments insert" on public.internal_comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_active()
              and public.is_kian_member(coalesce(project_id,
                    (select d.project_id from public.deliverables d where d.id = deliverable_id))));

-- reviews: only client_owner may decide, only while in client_review
create policy "reviews read" on public.deliverable_reviews for select to authenticated
  using (exists (select 1 from public.deliverables d
                 where d.id = deliverable_id
                   and (public.is_kian_member(d.project_id)
                        or (public.is_not_blocked() and public.is_client_side(d.project_id)))));
create policy "reviews insert" on public.deliverable_reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_active()
              and exists (select 1 from public.deliverables d
                          where d.id = deliverable_id
                            and d.status = 'client_review'
                            and public.is_client_owner(d.project_id)));

-- project chat: any member of the project
create policy "project chat read" on public.project_messages for select to authenticated
  using (public.is_admin() or (public.is_not_blocked() and public.can_access_project(project_id)));
create policy "project chat insert" on public.project_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_active()
              and ((sender_role = 'client' and public.is_client_side(project_id))
                   or (sender_role = 'admin' and public.is_kian_member(project_id))));

-- admin-only tables
create policy "admin notes all"  on public.admin_notes        for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "outbox admin all" on public.integration_outbox for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "assets admin all" on public.deliverable_assets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- admin write access across user tables (future /admin UI; service role bypasses RLS anyway)
create policy "admin all companies" on public.companies      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all quotes"    on public.quote_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all messages"  on public.messages       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all dlv"       on public.deliverables   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all offers"    on public.offers         for all to authenticated using (public.is_admin()) with check (public.is_admin());
```

### 2.12 RLS matrix (summary)

| Table | lead | client_member | client_owner | kian_* member | admin | blocked |
|---|---|---|---|---|---|:--:|
| `companies` | ∅ | own company R | own company R | — | all | ∅ |
| `profiles` | own R/U* | own R/U* | own R/U* | own R/U* | all | ∅ |
| `project_members` | ∅ | own-project R | own-project R | own-project R | all + write | ∅ |
| `quote_requests` / `messages` | own R+I | own R+I | own R+I | own R+I | all | ∅ |
| `file_links` | own R+I | own R+I (+project) | own R+I (+project) | project R | all | ∅ |
| `offers` | published R | published R | published R | published R | all | ∅ |
| `notifications` | own R+mark-read | own | own | own | all+broadcasts | ∅ |
| `notification_preferences` | own R/U | own R/U | own R/U | own R/U | all | ∅ |
| `activity_log` | ∅ | ∅ | ∅ | ∅ | R | ∅ |
| `projects` | ∅ | member R | member R | member R | all | ∅ |
| `project_notes` / `project_messages` | ∅ | R+I | R+I | R (+I as admin-side) | all | ∅ |
| `deliverables` | ∅ | client-visible states R | client-visible states R | ALL states R | all | ∅ |
| `client_comments` | ∅ | R+I | R+I | R+I | all | ∅ |
| `internal_comments` | ∅ | **∅ — never** | **∅ — never** | R+I | all | ∅ |
| `deliverable_assets` | ∅ | ∅ (RPC) | ∅ (gated RPC) | ∅ (RPC) | all | ∅ |
| `deliverable_reviews` | ∅ | R only — **cannot approve** | R+I (approve/revise) | R | all | ∅ |
| `admin_notes` / `integration_outbox` | ∅ | ∅ | ∅ | ∅ | all | ∅ |

\* profile U limited to `full_name, company, mobile, preferred_lang, marketing_opt_in` — `account_type` / `account_status` / `client_level` / `company_id` not user-updatable.
`inactive` = reads only (all writes require `is_active()`). `blocked` (∅) = nothing. Client-visible deliverable states: `client_review, revision_requested, approved, final_delivered`. **Soft-deleted rows (`is_deleted = true`, §2.13) are invisible to everyone except admins.**

### 2.13 Soft delete architecture (NEW v1.3)

**No hard delete from the portal UI — ever.** Business records are flagged, never removed. `authenticated` has **no DELETE grant on any table**, so a hard delete is structurally impossible from the portal. Hard deletes remain possible only via the Supabase dashboard/service role (discouraged — use restore/archival).

Soft-delete columns apply to **all 16 business tables**:
`companies, clients, projects, project_members, quote_requests, messages, file_links, offers, project_notes, deliverables, deliverable_assets, client_comments, internal_comments, deliverable_reviews, project_messages, admin_notes`

Excluded by design: `profiles` (lifecycle = `account_status`; PDPL erasure is a separate future process), `notifications` (ephemeral — retention policy instead), `activity_log` (**immutable audit — never deleted**), `integration_outbox` (operational queue).

```sql
-- generic pattern, applied to each business table <t> in the migration
alter table public.<t>
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);
create index if not exists <t>_live_idx on public.<t> (is_deleted) where is_deleted = false;

-- single safe entry point for ALL portal deletions
-- contract: admins may delete any row; users only rows they own
-- (user_id/author_id/sender_id/reviewer_id = auth.uid()); sets the three columns
-- and logs 'record.deleted'. Full per-table ownership map is compiled in the
-- Phase-0 migration.
create or replace function public.soft_delete(p_table text, p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as $$ ... $$;
grant execute on function public.soft_delete(text, uuid) to authenticated;

-- ADMIN ONLY: clears the three columns and logs 'record.restored'
create or replace function public.restore_record(p_table text, p_id uuid) returns boolean
  language plpgsql security definer set search_path = public as $$ ... $$;
```

**RLS rule (normative):** every non-admin SELECT policy in §2.11 gains `and is_deleted = false`; admin policies do NOT (admins see deleted rows in order to restore). Example:

```sql
create policy "own quotes read" on public.quote_requests for select to authenticated
  using ((user_id = auth.uid() and public.is_not_blocked() and is_deleted = false)
         or public.is_admin());
```

Helper functions that traverse business tables (`my_client_id`, `project_role`, `can_access_project`, `project_client_user_ids`) gain the same predicate. **Member "removal" becomes a soft delete**: the audit trigger logs `member.removed` on the flag update, and because `project_role()` ignores deleted rows, access is revoked instantly.

### 2.14 Complete activity timeline — login tracking & extended audit (NEW v1.3)

`activity_log` is the complete, **admin-only** timeline. Required coverage and where each event comes from:

| Required event | Source |
|---|---|
| Signup | `handle_new_user` → `user.signed_up` (exists) |
| **Login** | NEW trigger on `auth.sessions` insert → `user.logged_in` |
| **Profile updates** | `trg_profile_audit` extended: changes to name/company/mobile/lang/marketing log `profile.updated` (changed-field metadata); role/status/level/company changes stay `account.updated` |
| File uploads | `t_file_created` → `file.uploaded` (exists) |
| Messages | `t_message_created` → `message.sent` (exists) |
| **Review requests** | deliverable transition → `client_review` now ALSO logs `review.requested` |
| Approvals | `deliverable.approved` (exists) |
| Revision requests | `revision.requested` (exists) |
| Project status changes | `project.status_changed` (exists) |
| Admin actions | `account.updated`, `member.added/removed`, `deliverable.status_changed`, `deliverable.final_delivered`, `record.deleted`, `record.restored` |

```sql
-- login tracking via Supabase auth schema
create or replace function public.trg_session_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.user_id, 'user', 'user.logged_in', 'session', new.id, '{}');
  return new;
end; $$;
create trigger t_session_created after insert on auth.sessions
  for each row execute function public.trg_session_created();
-- NOTE: trigger lives on the auth schema — validate during Phase 0.
-- Fallback if restricted: a log RPC the portal calls right after successful login.
```

Immutability & visibility: `activity_log` has **no UPDATE/DELETE grants or policies for anyone** (including the admin UI); reads are admin-only (`log admin read`). Phase 3 ships the Activity Timeline view (filter by user / entity / action / date). Retention/archival policy is a Phase 5 decision.

---

## 3. UI structure

```
/client-portal
├── Auth gate (login + signup w/ marketing opt-in; email confirmation stays ON)
├── Blocked screen / Inactive read-only banner
└── Dashboard (tabs by role)
    ├── 🔔 Notification center (bell + unread + list + mark read; polling)
    ├── نظرة عامة   Overview
    ├── طلبات السعر  Quotes        — DB + Google Sheet mirror (transition)
    ├── الرسائل      Messages
    ├── ملفاتي       My Files
    ├── العروض       Offers        — EMPTY STATE at launch
    ├── ملفي         Profile       — limited fields + client_level badge + COMPANY card
    ├── الإعدادات    Settings      — notification_preferences toggles (portal ✅ / email 🔜 / WhatsApp 🔜)
    └── مشاريعي      Projects      — projects where user is a member (or legacy contact)
        └── /client-portal/projects/[id]  Project workspace
            ├── Timeline · فريق المشروع Team (member list w/ roles)
            ├── المخرجات Deliverables (Frame.io-style)
            │   ├── Status chip: client_review / revision_requested / approved / final_delivered
            │   ├── Player: vimeo_review_url embed, else preview_url (watermarked)
            │   ├── Client comments incl. timestamps (00:01:32)
            │   ├── [اعتماد ✓] [طلب تعديل ↺ + comment]  — client_owner ONLY
            │   ├── Internal comments panel — Kian members only (never rendered for clients)
            │   └── Download — only when allow_download && approved/final_delivered (gated RPC)
            ├── ملفات المشروع Files/links · ملاحظات Notes · محادثة Chat (polling)
```

Admin ops additions (Phase 3 SOP): create company → link users → create project (company + legacy client row) → add project_members (client_owner first) → move deliverable draft → internal_review → client_review → after approval, set final_delivered + allow_download. **Every delete control in the portal calls `soft_delete()` (no hard delete anywhere); restore + the full Activity Timeline view live in the Phase-3 admin UI.**

---

## 4. Integrations (schema-ready now, built in Phase 4 — NOT NOW)

| Integration | Hook points in schema | Phase 4 |
|---|---|---|
| **Zoho CRM** | `profiles.zoho_lead_id/zoho_contact_id`, `companies.zoho_account_id`, `quote_requests.zoho_deal_id`, outbox | Edge Function: signup→Lead, upgrade→Contact, company→Account, quote→Deal |
| **Zoho Books** | `quote_requests.zoho_books_estimate_id`, `projects.zoho_books_invoice_id`, outbox | Estimate on acceptance; invoice on project; read-only in portal |
| **Vimeo** | `deliverables.vimeo_video_id/vimeo_review_url`, `watermark_required`, `preview_url` fallback | Protected review links per deliverable |
| **Email / WhatsApp** | `notifications` + `notification_preferences` flags + outbox targets | Phase 5 fan-out honoring per-user channel prefs |

Hard rules: secrets only in Edge Functions/Vault — **never `NEXT_PUBLIC_*`**; portal never calls Zoho/Vimeo directly; all sync through `integration_outbox`.

---

## 5. Phases

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| **0 — Foundation** | Full §2 migration: **companies**, profiles (+`company_id`, `client_level`), **project_members**, notifications + **preferences**, activity_log (**complete timeline incl. login tracking**), 7-state deliverables, split comments, **soft-delete columns + `soft_delete()`/`restore_record()` RPCs**, RLS (incl. `is_deleted = false` predicates); backfill; admin seed; **acceptance checklist passes** | 2 sessions | Low — additive |
| **1 — Lead Portal** | Signup UI, gates, tabs: Overview, Quotes (DB+Sheet), Messages, Files, Profile (+company card), Offers (empty), Notification center, **Settings (channel prefs)** | 2–3 sessions | Low |
| **2 — Client Workspace** | Member-based projects list, team panel, timeline, chat, files, notes, **deliverable review: 7-state workflow, timestamp comments, owner-only approvals, internal-comments panel (Kian), final-delivery gate, download gating** | 3–4 sessions | Medium |
| **3 — Admin Ops** | Supabase-dashboard SOP (companies, members, lifecycle, deliverable states, offers) → minimal `/admin` later incl. **Activity Timeline view + restore deleted records** | 1–2 sessions | Low |
| **4 — Integrations** | Zoho CRM, Zoho Books, Vimeo — Edge Functions + Vault + outbox consumer | per-integration | Medium |
| **5 — Polish** | Realtime, email + WhatsApp notification channels (honoring prefs), Storage uploads, UI improvements | ongoing | Low |

---

## 6. Phase 0 acceptance checklist (must pass before Phase 1 coding)

**Roles & lifecycle**
- [ ] New signup → `profiles` (lead/active/prospect) + `notification_preferences` row; email confirmation required
- [ ] Only the 2 admin emails are `admin`; lead cannot update own `account_type`/`account_status`/`client_level`/`company_id`
- [ ] Upgrades + company link changes logged as `account.updated`

**Companies & membership**
- [ ] User sees own company only; other companies invisible
- [ ] Project visible only to its members (+legacy contact); company affiliation alone grants nothing
- [ ] Adding/removing a member grants/revokes access immediately and is logged (`member.added`/`member.removed`)
- [ ] Client A's company users see ∅ of company B's projects

**Approval workflow**
- [ ] `draft` and `internal_review` deliverables invisible to all client_* users; visible to kian_* members
- [ ] Moving to `client_review` notifies all client-side members
- [ ] `client_member` can comment but **cannot** insert a review (approve/revise) — only `client_owner`
- [ ] Review approve → status `approved` + admin notification + log; revise → `revision_requested` + both
- [ ] Setting `final_delivered` from any state except `approved` raises an exception (DB-enforced)
- [ ] `final_delivered` notifies client members; `get_deliverable_download()` returns URL only when `allow_download` AND status approved/final_delivered; admin always

**Comments split**
- [ ] `internal_comments` (editor/production/budget/qa) return ∅ for every client_* user — read AND write
- [ ] `client_comments` visible to both sides; timestamp comments accept `timecode_seconds`

**Notifications & log**
- [ ] All 9 notification types fire from their triggers; user with `portal_enabled=false` receives none
- [ ] User can update own channel prefs; cannot touch another user's
- [ ] All canonical activity_log actions write correctly; log readable by admin only

**Soft delete & complete timeline**
- [ ] DELETE is denied for `authenticated` on every table (no grant exists)
- [ ] `soft_delete()` lets a user delete only own rows; sets `is_deleted/deleted_at/deleted_by` + logs `record.deleted`
- [ ] Soft-deleted rows are invisible to all non-admins (lists, project chain, helper functions); admin still sees them
- [ ] `restore_record()` is admin-only; clears the flags + logs `record.restored`
- [ ] Soft-deleting a `project_members` row revokes project access instantly + logs `member.removed`
- [ ] Login creates `user.logged_in`; profile field change creates `profile.updated` with changed fields
- [ ] Deliverable transition to `client_review` logs `review.requested`
- [ ] `activity_log` rows cannot be updated or deleted by anyone (incl. admin UI)

**Isolation & regression**
- [ ] Lead sees ∅ from companies/projects/deliverables/assets/internal_comments/log/admin tables
- [ ] `inactive` = read-only; `blocked` = nothing at all
- [ ] Existing live portal still works for the current test client (legacy path intact)

---

## 7. Resolved decisions

1. Email confirmation → **ON** · 2. Quotes → **DB + Sheet mirror** until Zoho · 3. Offers → **launch empty** · 4. Admins → **2 fixed emails** · 5. (v1.2) Project access → **explicit membership** (company affiliation ≠ project access) · 6. (v1.2) Final delivery → **DB-enforced approval gate** · 7. (v1.2) Internal comments → **separate table, zero client grants** (not column filtering) · 8. (v1.3) Deletion → **soft delete only from the portal** (`soft_delete()` RPC; restore admin-only; no DELETE grants anywhere) · 9. (v1.3) Activity timeline → **complete incl. logins** (`auth.sessions` trigger, RPC fallback), admin-only, immutable
