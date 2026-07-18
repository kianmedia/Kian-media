-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — AUTO-CREATE V1 PER DELIVERABLE (RUN ONCE)  [P0-1 root-cause fix]
--
-- §2 versioning backfilled a V1 only for deliverables that existed when
-- deliverable_versions_RUNME.sql ran. New deliverables added afterward through the
-- flat admin/editor "Add Preview" flow (a plain deliverables INSERT) got NO
-- deliverable_versions row — so VersionHistory showed zero versions, the client got
-- no "View Preview" action, and client comments could not anchor to a version.
--
-- Fix: an AFTER INSERT trigger on deliverables auto-creates V1 (copying the preview
-- URLs / type / watermark), and a one-time re-backfill covers any deliverable added
-- between the §2 migration and now (plus re-anchors orphan comments/reviews to V1).
-- Idempotent; the trigger no-ops if a version already exists.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverables')         is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.deliverable_versions') is null then miss := miss || ' deliverable_versions (شغّل deliverable_versions_RUNME.sql)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- One V1 per deliverable, mirroring the §2 backfill mapping.
create or replace function public.dv_autocreate_v1() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(NEW.is_deleted, false) = false
     and not exists (select 1 from public.deliverable_versions v where v.deliverable_id = NEW.id) then
    insert into public.deliverable_versions
      (deliverable_id, version_no, preview_url, vimeo_video_id, vimeo_review_url, preview_type,
       watermark_required, uploaded_at, is_current, is_final, decision)
    values (NEW.id, 1, NEW.preview_url, NEW.vimeo_video_id, NEW.vimeo_review_url,
       case NEW.type when 'video' then 'video' when 'photo' then 'image' else 'other' end,
       coalesce(NEW.watermark_required, true), coalesce(NEW.created_at, now()), true,
       (NEW.status = 'final_delivered'),
       case when NEW.status in ('approved','final_delivered') then 'approved'
            when NEW.status = 'revision_requested' then 'revision_requested' else 'pending' end);
  end if;
  return NEW;
end $$;

drop trigger if exists t_deliverable_autoversion on public.deliverables;
create trigger t_deliverable_autoversion after insert on public.deliverables
  for each row execute function public.dv_autocreate_v1();

-- Re-backfill any deliverable still missing a V1 (added since the §2 migration).
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

-- Anchor any orphan comments/reviews (version_id null) to their V1.
update public.client_comments c set version_id = v.id
  from public.deliverable_versions v
  where v.deliverable_id = c.deliverable_id and v.version_no = 1 and c.version_id is null;
update public.deliverable_reviews r set version_id = v.id
  from public.deliverable_versions v
  where v.deliverable_id = r.deliverable_id and v.version_no = 1 and r.version_id is null;

do $v$
begin
  if not exists (select 1 from pg_trigger where tgname = 't_deliverable_autoversion') then
    raise exception 'فشل: t_deliverable_autoversion'; end if;
  if exists (select 1 from public.deliverables d where d.is_deleted = false
             and not exists (select 1 from public.deliverable_versions v where v.deliverable_id = d.id)) then
    raise exception 'فشل: ما زالت هناك مخرجات بلا نسخة V1'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
