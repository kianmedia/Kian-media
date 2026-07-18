-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PRE-PRODUCTION COMPLETION (RUN ONCE)  [P0-3]
--
-- Adds the remaining item fields + admin controls to make every pre-production
-- section fully operational, and hardens client visibility.
--   • columns: contact_name, contact_mobile, needs_internal_approval,
--     internal_approved_by/at, is_active, notes
--   • preproduction_upsert handles the new fields (attachments jsonb already exists
--     for external links / uploaded file refs [{name,url,kind,size,mime,by,at}])
--   • new RPCs: preproduction_duplicate, preproduction_set_active,
--     preproduction_restore, preproduction_internal_approve
--   • RLS: the CLIENT now sees an item only when it is client_visible AND is_active
--     AND not deleted — internal/inactive/deleted items are never retrievable
--     through the direct API.
-- Idempotent & additive. No storage bucket is created here (binary uploads are a
-- separate follow-up); external links + file references work through attachments.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.preproduction_items') is null then miss := miss || ' preproduction_items (شغّل preproduction_center_RUNME.sql)'; end if;
  if to_regprocedure('public.pp_can_manage(uuid)') is null then miss := miss || ' pp_can_manage'; end if;
  if to_regprocedure('public.is_client_side(uuid)') is null then miss := miss || ' is_client_side'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

alter table public.preproduction_items add column if not exists contact_name             text;
alter table public.preproduction_items add column if not exists contact_mobile           text;
alter table public.preproduction_items add column if not exists needs_internal_approval  boolean not null default false;
alter table public.preproduction_items add column if not exists internal_approved_by     uuid references auth.users(id);
alter table public.preproduction_items add column if not exists internal_approved_at     timestamptz;
alter table public.preproduction_items add column if not exists is_active                boolean not null default true;
alter table public.preproduction_items add column if not exists notes                    text;

-- ── Upsert: superset of preproduction_center_RUNME's version (adds new fields) ──
create or replace function public.preproduction_upsert(p_project uuid, p_data jsonb)
returns public.preproduction_items language plpgsql security definer set search_path = public as $$
declare r public.preproduction_items; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.pp_can_manage(p_project) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;

  if v_id is null then
    insert into public.preproduction_items(project_id, section, title, body, detail, attachments, owner_id,
        profession, due_date, status, priority, client_visible, needs_approval, sort_order, created_by,
        contact_name, contact_mobile, needs_internal_approval, is_active, notes)
      values (p_project, p_data->>'section', btrim(p_data->>'title'), nullif(btrim(coalesce(p_data->>'body','')),''),
        coalesce(p_data->'detail','{}'::jsonb), coalesce(p_data->'attachments','[]'::jsonb),
        nullif(p_data->>'owner_id','')::uuid, nullif(btrim(coalesce(p_data->>'profession','')),''),
        nullif(p_data->>'due_date','')::date, coalesce(nullif(p_data->>'status',''),'todo'),
        coalesce(nullif(p_data->>'priority',''),'normal'), coalesce((p_data->>'client_visible')::boolean,false),
        coalesce((p_data->>'needs_approval')::boolean,false), coalesce(nullif(p_data->>'sort_order','')::int,0), auth.uid(),
        nullif(btrim(coalesce(p_data->>'contact_name','')),''), nullif(btrim(coalesce(p_data->>'contact_mobile','')),''),
        coalesce((p_data->>'needs_internal_approval')::boolean,false), coalesce((p_data->>'is_active')::boolean,true),
        nullif(btrim(coalesce(p_data->>'notes','')),''))
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
      contact_name = case when p_data ? 'contact_name' then nullif(btrim(coalesce(p_data->>'contact_name','')),'') else contact_name end,
      contact_mobile = case when p_data ? 'contact_mobile' then nullif(btrim(coalesce(p_data->>'contact_mobile','')),'') else contact_mobile end,
      needs_internal_approval = coalesce((p_data->>'needs_internal_approval')::boolean, needs_internal_approval),
      is_active = coalesce((p_data->>'is_active')::boolean, is_active),
      notes = case when p_data ? 'notes' then nullif(btrim(coalesce(p_data->>'notes','')),'') else notes end,
      updated_at = now()
    where id = v_id and project_id = p_project and is_deleted = false
    returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
    perform public.log_activity(auth.uid(), 'admin', 'preproduction.updated', 'project', p_project,
      jsonb_build_object('id', v_id, 'section', r.section));
  end if;
  return r;
end $$;

-- ── Duplicate an item (same section, "(نسخة)" suffix, inactive draft) ──
create or replace function public.preproduction_duplicate(p_id uuid)
returns public.preproduction_items language plpgsql security definer set search_path = public as $$
declare src public.preproduction_items; r public.preproduction_items;
begin
  select * into src from public.preproduction_items where id = p_id and is_deleted = false;
  if src.id is null then raise exception 'not_found'; end if;
  if not public.pp_can_manage(src.project_id) then raise exception 'not authorized'; end if;
  insert into public.preproduction_items(project_id, section, title, body, detail, attachments, owner_id,
      profession, due_date, status, priority, client_visible, needs_approval, sort_order, created_by,
      contact_name, contact_mobile, needs_internal_approval, is_active, notes)
    values (src.project_id, src.section, src.title || ' (نسخة)', src.body, src.detail, src.attachments, src.owner_id,
      src.profession, src.due_date, 'todo', src.priority, false, src.needs_approval, src.sort_order + 1, auth.uid(),
      src.contact_name, src.contact_mobile, src.needs_internal_approval, true, src.notes)
    returning * into r;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.duplicated', 'project', src.project_id,
    jsonb_build_object('from', p_id, 'to', r.id));
  return r;
end $$;

create or replace function public.preproduction_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can_manage(v_proj) then raise exception 'not authorized'; end if;
  update public.preproduction_items set is_active = coalesce(p_active, true), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.active_changed', 'project', v_proj,
    jsonb_build_object('id', p_id, 'active', p_active));
end $$;

create or replace function public.preproduction_restore(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = true;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pp_can_manage(v_proj) then raise exception 'not authorized'; end if;
  update public.preproduction_items set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.restored', 'project', v_proj, jsonb_build_object('id', p_id));
end $$;

create or replace function public.preproduction_internal_approve(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.preproduction_items where id = p_id and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  update public.preproduction_items set internal_approved_by = auth.uid(), internal_approved_at = now(), updated_at = now() where id = p_id;
  perform public.log_activity(auth.uid(), 'admin', 'preproduction.internal_approved', 'project', v_proj, jsonb_build_object('id', p_id));
end $$;

-- ── RLS: client sees only client_visible AND is_active (and never deleted) ──
drop policy if exists pp_read on public.preproduction_items;
create policy pp_read on public.preproduction_items for select to authenticated using (
  (public.pp_can_manage(project_id))                                            -- staff manage/read all
  or (public.is_client_side(project_id) and client_visible = true and is_active = true and is_deleted = false)
);

do $g$
declare f text;
begin
  foreach f in array array[
    'public.preproduction_upsert(uuid,jsonb)',
    'public.preproduction_duplicate(uuid)',
    'public.preproduction_set_active(uuid,boolean)',
    'public.preproduction_restore(uuid)',
    'public.preproduction_internal_approve(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon;', f);
    execute format('grant execute on function %s to authenticated;', f);
  end loop;
end $g$;

do $v$
begin
  if not exists (select 1 from information_schema.columns where table_name='preproduction_items' and column_name='contact_mobile') then raise exception 'فشل: contact_mobile'; end if;
  if not exists (select 1 from information_schema.columns where table_name='preproduction_items' and column_name='is_active') then raise exception 'فشل: is_active'; end if;
  if to_regprocedure('public.preproduction_duplicate(uuid)') is null then raise exception 'فشل: preproduction_duplicate'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
