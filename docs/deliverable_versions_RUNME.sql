-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §2 TRUE CLIENT-FACING DELIVERABLE VERSIONING (RUN ONCE)
--
-- Adds a real version lineage (V1/V2/…/Final) to the client deliverable system
-- WITHOUT breaking the flat `deliverables` container. Each deliverable now owns
-- an ordered set of deliverable_versions; comments/reviews anchor to the exact
-- version; approval is per-version; only the Final version is downloadable.
--
--   • deliverable_versions — per-deliverable ordered versions (preview asset +
--     type + note + per-version decision + revision_reason + uploader/at +
--     is_current + is_final + prev_version_id + addressed_comment_ids).
--   • client_comments.version_id / deliverable_reviews.version_id (backfilled).
--   • BACKFILL: every existing deliverable → one V1 from its current fields;
--     existing comments/reviews anchored to that V1. No data lost, no overwrite.
--   • RPCs: admin_add_deliverable_version, client_review_version,
--     admin_set_final_version, plus a read helper deliverable_version_summary.
--
-- Runs AFTER deliverable_comments_resolution_RUNME.sql. Idempotent, non-
-- destructive. Reuses is_admin/project_role/staff_reads_all/is_client_owner/
-- is_client_side/can_final_deliver/log_activity/notify. Preserves the
-- approved-first trigger + the payment/download gate + all preview links.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverables')        is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.deliverable_reviews') is null then miss := miss || ' deliverable_reviews'; end if;
  if to_regclass('public.client_comments')     is null then miss := miss || ' client_comments'; end if;
  if to_regprocedure('public.is_admin()')                 is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.project_role(uuid)')         is null then miss := miss || ' project_role(uuid)'; end if;
  if to_regprocedure('public.staff_reads_all_projects()') is null then miss := miss || ' staff_reads_all_projects()'; end if;
  if to_regprocedure('public.is_client_owner(uuid)')      is null then miss := miss || ' is_client_owner(uuid)'; end if;
  if to_regprocedure('public.is_client_side(uuid)')       is null then miss := miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.can_final_deliver()')        is null then miss := miss || ' can_final_deliver()'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='client_comments' and column_name='status') = 0
    then miss := miss || ' client_comments.status (شغّل deliverable_comments_resolution_RUNME.sql)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) جدول النسخ ═══
create table if not exists public.deliverable_versions (
  id               uuid primary key default gen_random_uuid(),
  deliverable_id   uuid not null references public.deliverables(id) on delete cascade,
  version_no       int  not null,
  preview_url      text,
  vimeo_video_id   text,
  vimeo_review_url text,
  preview_type     text not null default 'other' check (preview_type in ('video','image','pdf','office','other')),
  watermark_required boolean not null default true,
  note             text,
  decision         text not null default 'pending' check (decision in ('pending','approved','revision_requested')),
  revision_reason  text,
  uploaded_by      uuid references auth.users(id),
  uploaded_at      timestamptz not null default now(),
  is_current       boolean not null default false,
  is_final         boolean not null default false,
  prev_version_id  uuid references public.deliverable_versions(id) on delete set null,
  addressed_comment_ids uuid[] not null default '{}',
  is_deleted       boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid,
  unique (deliverable_id, version_no)
);
create index if not exists idx_dv_deliverable on public.deliverable_versions(deliverable_id) where is_deleted = false;
create unique index if not exists uq_dv_current on public.deliverable_versions(deliverable_id) where is_current and not is_deleted;
create unique index if not exists uq_dv_final   on public.deliverable_versions(deliverable_id) where is_final and not is_deleted;

alter table public.client_comments     add column if not exists version_id uuid references public.deliverable_versions(id) on delete cascade;
alter table public.deliverable_reviews add column if not exists version_id uuid references public.deliverable_versions(id) on delete cascade;
create index if not exists idx_cc_version on public.client_comments(version_id);
create index if not exists idx_dr_version on public.deliverable_reviews(version_id);

-- ═══ 2) Backfill: نسخة V1 لكل مخرَج قائم + ربط التعليقات/المراجعات بها ═══
insert into public.deliverable_versions
  (deliverable_id, version_no, preview_url, vimeo_video_id, vimeo_review_url, preview_type,
   watermark_required, uploaded_at, is_current, is_final, decision)
select d.id, 1, d.preview_url, d.vimeo_video_id, d.vimeo_review_url,
  case d.type when 'video' then 'video' when 'photo' then 'image' else 'other' end,
  d.watermark_required, d.created_at, true, (d.status = 'final_delivered'),
  case when d.status in ('approved','final_delivered') then 'approved'
       when d.status = 'revision_requested' then 'revision_requested' else 'pending' end
from public.deliverables d
where d.is_deleted = false
  and not exists (select 1 from public.deliverable_versions v where v.deliverable_id = d.id);

update public.client_comments c set version_id = v.id
  from public.deliverable_versions v
  where v.deliverable_id = c.deliverable_id and v.version_no = 1 and c.version_id is null;
update public.deliverable_reviews r set version_id = v.id
  from public.deliverable_versions v
  where v.deliverable_id = r.deliverable_id and v.version_no = 1 and r.version_id is null;

-- ═══ 3) RLS — client reads versions of a client-visible deliverable; staff read theirs ═══
alter table public.deliverable_versions enable row level security;
drop policy if exists dv_read on public.deliverable_versions;
create policy dv_read on public.deliverable_versions for select to authenticated using (
  is_deleted = false and (
    public.is_admin() or public.staff_reads_all_projects()
    or exists (select 1 from public.deliverables d where d.id = deliverable_id and d.is_deleted = false
               and (public.project_role(d.project_id) is not null
                    or (public.is_client_side(d.project_id)
                        and d.status in ('client_review','revision_requested','approved','final_delivered'))))
  )
);
-- الكتابة عبر RPCs (SECURITY DEFINER) فقط — لا سياسة كتابة.
grant select on public.deliverable_versions to authenticated;

-- ═══ 4) إضافة نسخة جديدة (أدمن/كادر المشروع) — لا تستبدل السابقة ═══
create or replace function public.admin_add_deliverable_version(p_deliverable uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_no int; v_prev uuid; v_id uuid; v_addr uuid[];
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.staff_reads_all_projects() or public.project_role(v_proj) is not null) then
    raise exception 'not authorized';
  end if;
  select coalesce(max(version_no),0)+1, (select id from public.deliverable_versions where deliverable_id = p_deliverable and is_current and not is_deleted limit 1)
    into v_no, v_prev from public.deliverable_versions where deliverable_id = p_deliverable;
  select coalesce(array_agg(x::uuid),'{}') into v_addr
    from jsonb_array_elements_text(case when jsonb_typeof(p_data->'addressed_comment_ids')='array' then p_data->'addressed_comment_ids' else '[]'::jsonb end) as t(x);

  update public.deliverable_versions set is_current = false where deliverable_id = p_deliverable and is_current;
  insert into public.deliverable_versions
    (deliverable_id, version_no, preview_url, vimeo_video_id, vimeo_review_url, preview_type, watermark_required,
     note, uploaded_by, is_current, prev_version_id, addressed_comment_ids)
  values (p_deliverable, v_no, nullif(btrim(p_data->>'preview_url'),''), nullif(btrim(p_data->>'vimeo_video_id'),''),
     nullif(btrim(p_data->>'vimeo_review_url'),''), coalesce(nullif(p_data->>'preview_type',''),'other'),
     coalesce((p_data->>'watermark_required')::boolean, true), nullif(btrim(p_data->>'note'),''), auth.uid(), true, v_prev, v_addr)
  returning id into v_id;

  -- مرآة إلى صف المخرَج الحاوي: النسخة الجديدة تعود لمراجعة العميل.
  update public.deliverables set version = v_no,
    preview_url = coalesce(nullif(btrim(p_data->>'preview_url'),''), preview_url),
    vimeo_review_url = coalesce(nullif(btrim(p_data->>'vimeo_review_url'),''), vimeo_review_url),
    status = case when status = 'final_delivered' then status else 'client_review' end
    where id = p_deliverable;

  -- علِّم التعليقات التي تعالجها هذه النسخة كمحلولة.
  if array_length(v_addr,1) is not null then
    update public.client_comments set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
      where id = any(v_addr) and status <> 'resolved';
  end if;

  perform public.log_activity(auth.uid(), 'admin', 'deliverable.version_added', 'deliverable', p_deliverable,
    jsonb_build_object('version', v_no, 'addressed', coalesce(array_length(v_addr,1),0)));
  return v_id;
end $$;

-- ═══ 5) مراجعة العميل لنسخة بعينها (اعتماد/طلب تعديل) ═══
create or replace function public.client_review_version(p_version uuid, p_decision text, p_comments text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select dv.*, d.project_id, d.status as dlv_status into v
    from public.deliverable_versions dv join public.deliverables d on d.id = dv.deliverable_id
    where dv.id = p_version and dv.is_deleted = false and d.is_deleted = false;
  if v.id is null then raise exception 'not_found'; end if;
  if p_decision <> all (array['approved','revision_requested']) then raise exception 'bad_decision'; end if;
  if not public.is_client_owner(v.project_id) then raise exception 'not authorized'; end if;
  if not v.is_current then raise exception 'not_current_version'; end if;
  if v.dlv_status <> 'client_review' then raise exception 'not_in_review'; end if;
  if p_decision = 'revision_requested' and coalesce(btrim(p_comments),'') = '' then raise exception 'reason_required'; end if;

  insert into public.deliverable_reviews(deliverable_id, version_id, reviewer_id, decision, comments)
    values (v.deliverable_id, p_version, auth.uid(), p_decision, nullif(btrim(coalesce(p_comments,'')),''));
  -- (trg_review_created يضبط deliverables.status = decision) — نضبط قرار النسخة:
  update public.deliverable_versions set decision = p_decision,
    revision_reason = case when p_decision='revision_requested' then nullif(btrim(coalesce(p_comments,'')),'') else revision_reason end
    where id = p_version;
  return true;
end $$;

-- ═══ 6) تعيين النسخة النهائية (أدمن/مدير) — تكون معتمدة، وتربط أصل التنزيل النهائي ═══
create or replace function public.admin_set_final_version(p_deliverable uuid, p_version uuid, p_final_url text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; v_url text;
begin
  if not (public.is_admin() or public.can_final_deliver()) then raise exception 'not authorized'; end if;
  select dv.*, d.project_id into v from public.deliverable_versions dv join public.deliverables d on d.id = dv.deliverable_id
    where dv.id = p_version and dv.deliverable_id = p_deliverable and dv.is_deleted = false and d.is_deleted = false;
  if v.id is null then raise exception 'not_found'; end if;
  if v.decision <> 'approved' then raise exception 'version_not_approved'; end if;

  update public.deliverable_versions set is_final = false where deliverable_id = p_deliverable and is_final;
  update public.deliverable_versions set is_final = true, is_current = true where id = p_version;
  update public.deliverable_versions set is_current = false where deliverable_id = p_deliverable and id <> p_version and is_current;
  -- المخرَج: approved (شرط الـtrigger) ثم final_delivered.
  update public.deliverables set status = 'approved', version = v.version_no where id = p_deliverable and status <> 'final_delivered';
  update public.deliverables set status = 'final_delivered' where id = p_deliverable and status <> 'final_delivered';
  -- أصل التنزيل النهائي (نظيف، بلا علامة مائية): الرابط الممرَّر أو رابط النسخة.
  v_url := coalesce(nullif(btrim(coalesce(p_final_url,'')),''), v.preview_url);
  if v_url is not null and not exists (select 1 from public.deliverable_assets a where a.deliverable_id = p_deliverable and a.kind = 'final' and a.is_deleted = false) then
    insert into public.deliverable_assets(deliverable_id, kind, url) values (p_deliverable, 'final', v_url);
  end if;
  perform public.log_activity(auth.uid(), 'admin', 'deliverable.final_version_set', 'deliverable', p_deliverable,
    jsonb_build_object('version', v.version_no));
  return true;
end $$;

-- ═══ 7) ملخّص النسخ (عدّاد التعليقات المفتوحة/المحلولة لكل نسخة) — قراءة UI ═══
create or replace function public.deliverable_version_summary(p_deliverable uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid; v jsonb;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.staff_reads_all_projects() or public.project_role(v_proj) is not null
          or public.is_client_side(v_proj)) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row order by (row->>'version_no')::int desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', dv.id, 'version_no', dv.version_no,
      'label', case when dv.is_final then 'Final' else 'V'||dv.version_no end,
      'preview_url', dv.preview_url, 'vimeo_review_url', dv.vimeo_review_url, 'preview_type', dv.preview_type,
      'note', dv.note, 'decision', dv.decision, 'revision_reason', dv.revision_reason,
      'uploaded_by', dv.uploaded_by,
      'uploaded_by_name', (select p.full_name from public.profiles p where p.id = dv.uploaded_by),
      'uploaded_at', dv.uploaded_at, 'is_current', dv.is_current, 'is_final', dv.is_final,
      'addressed_comment_ids', to_jsonb(dv.addressed_comment_ids),
      'open_comments', (select count(*) from public.client_comments c where c.version_id = dv.id and c.is_deleted = false and c.status <> 'resolved'),
      'resolved_comments', (select count(*) from public.client_comments c where c.version_id = dv.id and c.is_deleted = false and c.status = 'resolved')
    ) as row
    from public.deliverable_versions dv where dv.deliverable_id = p_deliverable and dv.is_deleted = false
  ) rows(row);
  return v;
end $$;

-- ═══ 8) Grants + VALIDATION ═══
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_add_deliverable_version(uuid,jsonb)',
    'public.client_review_version(uuid,text,text)',
    'public.admin_set_final_version(uuid,uuid,text)',
    'public.deliverable_version_summary(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

do $v$
declare miss text := '';
begin
  if to_regclass('public.deliverable_versions') is null then miss := miss || ' deliverable_versions'; end if;
  if to_regprocedure('public.admin_add_deliverable_version(uuid,jsonb)') is null then miss := miss || ' admin_add_deliverable_version'; end if;
  if to_regprocedure('public.client_review_version(uuid,text,text)')     is null then miss := miss || ' client_review_version'; end if;
  if to_regprocedure('public.admin_set_final_version(uuid,uuid,text)')   is null then miss := miss || ' admin_set_final_version'; end if;
  if not (select relrowsecurity from pg_class where oid='public.deliverable_versions'::regclass) then miss := miss || ' RLS(deliverable_versions)'; end if;
  -- كل مخرَج غير محذوف يجب أن يملك V1 بعد الـBackfill
  if exists (select 1 from public.deliverables d where d.is_deleted = false
             and not exists (select 1 from public.deliverable_versions v where v.deliverable_id = d.id)) then
    miss := miss || ' backfill(missing V1)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
