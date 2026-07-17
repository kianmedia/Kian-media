-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §4 STRUCTURED PRE-PRODUCTION CENTER (RUN ONCE)
--
-- A structured planning store (NOT one JSON textarea): every pre-production item
-- is a typed row under a fixed section taxonomy, with common operational fields
-- (owner, profession, due, status, priority, visibility, approval) + section-
-- specific structured detail (storyboard / shot-list fields) + per-item comments.
--
--   preproduction_items — one row per item; section ∈ 28 fixed sections.
--   preproduction_comments — threaded notes per item.
--   RPCs: preproduction_upsert / _delete / _set_status / _approve / _comment.
--   RLS: staff (project role / read-all / admin) read+manage via RPC; the CLIENT
--        reads ONLY items explicitly marked client_visible. Writes via SECURITY
--        DEFINER RPCs only. Audit via log_activity.
--
-- Idempotent · non-destructive · reuses is_admin/project_role/staff_reads_all/
-- is_client_side/can_manage_projects/log_activity. `profession` is a text slug now;
-- §5 adds the profession catalog and can key off it. No Zoho/finance touch.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects') is null then miss := miss || ' projects'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.project_role(uuid)') is null then miss := miss || ' project_role(uuid)'; end if;
  if to_regprocedure('public.staff_reads_all_projects()') is null then miss := miss || ' staff_reads_all_projects()'; end if;
  if to_regprocedure('public.is_client_side(uuid)') is null then miss := miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) بنود ما قبل الإنتاج ═══
create table if not exists public.preproduction_items (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  section        text not null check (section in (
    'client_brief','objectives','audience','key_message','concept','treatment','script',
    'interview_questions','storyboard','shot_list','scene_list','locations','permits',
    'drone_permits','cast','wardrobe','props','equipment','crew_plan','filming_schedule',
    'call_sheet','logistics','health_safety','risk_assessment','contingency','client_references',
    'brand_assets','approvals')),
  title          text not null,
  body           text,                              -- brief/script/treatment rich text
  detail         jsonb not null default '{}',       -- section-specific structured fields (storyboard/shot-list)
  attachments    jsonb not null default '[]',       -- [{ name, url }]
  owner_id       uuid references auth.users(id) on delete set null,
  profession     text,                              -- responsible profession slug (§5)
  due_date       date,
  status         text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority       text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  client_visible boolean not null default false,
  needs_approval boolean not null default false,
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  sort_order     int not null default 0,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz,
  deleted_by     uuid,
  delete_reason  text
);
create index if not exists idx_pp_project on public.preproduction_items(project_id, section) where is_deleted = false;

create table if not exists public.preproduction_comments (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.preproduction_items(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid references auth.users(id),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create index if not exists idx_ppc_item on public.preproduction_comments(item_id) where is_deleted = false;

-- ═══ 2) RLS — staff manage; client reads only client_visible ═══
alter table public.preproduction_items    enable row level security;
alter table public.preproduction_comments enable row level security;

drop policy if exists pp_read on public.preproduction_items;
create policy pp_read on public.preproduction_items for select to authenticated using (
  is_deleted = false and (
    public.is_admin() or public.staff_reads_all_projects() or public.project_role(project_id) is not null
    or (public.is_client_side(project_id) and client_visible = true)
  )
);
drop policy if exists ppc_read on public.preproduction_comments;
create policy ppc_read on public.preproduction_comments for select to authenticated using (
  is_deleted = false and exists (
    select 1 from public.preproduction_items i where i.id = item_id and i.is_deleted = false and (
      public.is_admin() or public.staff_reads_all_projects() or public.project_role(i.project_id) is not null
      or (public.is_client_side(i.project_id) and i.client_visible = true)
    )
  )
);
grant select on public.preproduction_items, public.preproduction_comments to authenticated;

-- ═══ 3) صلاحية الإدارة (كادر المشروع أو إدارة) ═══
create or replace function public.pp_can_manage(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.can_manage_projects() or public.project_role(p_project) is not null;
$$;

-- ═══ 4) إنشاء/تعديل بند ═══
create or replace function public.preproduction_upsert(p_project uuid, p_data jsonb)
returns public.preproduction_items language plpgsql security definer set search_path = public as $$
declare r public.preproduction_items; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.pp_can_manage(p_project) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
  if v_id is null then
    insert into public.preproduction_items(project_id, section, title, body, detail, attachments, owner_id,
        profession, due_date, status, priority, client_visible, needs_approval, sort_order, created_by)
      values (p_project, p_data->>'section', btrim(p_data->>'title'), nullif(btrim(coalesce(p_data->>'body','')),''),
        coalesce(p_data->'detail','{}'::jsonb), coalesce(p_data->'attachments','[]'::jsonb),
        nullif(p_data->>'owner_id','')::uuid, nullif(btrim(coalesce(p_data->>'profession','')),''),
        nullif(p_data->>'due_date','')::date, coalesce(nullif(p_data->>'status',''),'todo'),
        coalesce(nullif(p_data->>'priority',''),'normal'), coalesce((p_data->>'client_visible')::boolean,false),
        coalesce((p_data->>'needs_approval')::boolean,false), coalesce(nullif(p_data->>'sort_order','')::int,0), auth.uid())
      returning * into r;
    perform public.log_activity(auth.uid(), 'admin', 'preproduction.created', 'project', p_project,
      jsonb_build_object('section', r.section, 'title', r.title));
  else
    update public.preproduction_items set
      title = btrim(p_data->>'title'),
      body = case when p_data ? 'body' then nullif(btrim(coalesce(p_data->>'body','')),'') else body end,
      detail = case when p_data ? 'detail' then coalesce(p_data->'detail','{}'::jsonb) else detail end,
      attachments = case when p_data ? 'attachments' then coalesce(p_data->'attachments','[]'::jsonb) else attachments end,
      owner_id = case when p_data ? 'owner_id' then nullif(p_data->>'owner_id','')::uuid else owner_id end,
      profession = case when p_data ? 'profession' then nullif(btrim(coalesce(p_data->>'profession','')),'') else profession end,
      due_date = case when p_data ? 'due_date' then nullif(p_data->>'due_date','')::date else due_date end,
      status = coalesce(nullif(p_data->>'status',''), status),
      priority = coalesce(nullif(p_data->>'priority',''), priority),
      client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      needs_approval = coalesce((p_data->>'needs_approval')::boolean, needs_approval),
      sort_order = coalesce(nullif(p_data->>'sort_order','')::int, sort_order),
      updated_at = now()
      where id = v_id and project_id = p_project and is_deleted = false returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.log_activity(auth.uid(), 'admin', 'preproduction.updated', 'project', p_project,
      jsonb_build_object('id', v_id, 'section', r.section));
  end if;
  return r;
end $$;

create or replace function public.preproduction_delete(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can_manage(v_proj) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  update public.preproduction_items set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = left(btrim(p_reason),500), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.deleted', 'project', v_proj, jsonb_build_object('id', p_id));
  return true;
end $$;

create or replace function public.preproduction_approve(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  -- الاعتماد للإدارة/المدير فقط.
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  update public.preproduction_items set approved_by = auth.uid(), approved_at = now(), status = 'done', updated_at = now()
    where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.approved', 'project', v_proj, jsonb_build_object('id', p_id));
  return true;
end $$;

create or replace function public.preproduction_comment(p_item uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_id uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_item and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  -- تعليق: كادر المشروع، أو العميل إن كان البند مرئيًا له.
  if not (public.pp_can_manage(v_proj) or (public.is_client_side(v_proj)
          and exists (select 1 from public.preproduction_items i where i.id = p_item and i.client_visible))) then
    raise exception 'not authorized';
  end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'body_required'; end if;
  insert into public.preproduction_comments(item_id, project_id, author_id, body)
    values (p_item, v_proj, auth.uid(), left(btrim(p_body),4000)) returning id into v_id;
  return v_id;
end $$;

-- ═══ 5) Grants + VALIDATION ═══
do $g$
declare f text;
begin
  foreach f in array array[
    'public.preproduction_upsert(uuid,jsonb)',
    'public.preproduction_delete(uuid,text)',
    'public.preproduction_approve(uuid)',
    'public.preproduction_comment(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.pp_can_manage(uuid) from public, anon';
  execute 'grant execute on function public.pp_can_manage(uuid) to authenticated';
end $g$;

do $v$
declare miss text := '';
begin
  if to_regclass('public.preproduction_items')    is null then miss := miss || ' preproduction_items'; end if;
  if to_regclass('public.preproduction_comments') is null then miss := miss || ' preproduction_comments'; end if;
  if to_regprocedure('public.preproduction_upsert(uuid,jsonb)') is null then miss := miss || ' preproduction_upsert'; end if;
  if not (select relrowsecurity from pg_class where oid='public.preproduction_items'::regclass) then miss := miss || ' RLS(preproduction_items)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
