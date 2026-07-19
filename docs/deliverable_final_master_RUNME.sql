-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-1: CLEAN-FINAL MASTER (CLOSE THE GATE BYPASS)  (RUN ONCE)
--
-- Defect: admin_set_final_version defaulted the gated "final" asset URL to the
-- version's own preview_url (deliverable_versions_RUNME.sql:196), so the payment-
-- gated final could be byte-identical to the freely-viewable review preview.
--
-- Model:
--   • REVIEW asset  = deliverable_versions.preview_url — always watermarked, may be
--     a public/derivative preview, NEVER the clean final.
--   • FINAL MASTER  = a DISTINCT clean file in the PRIVATE project-deliverables
--     bucket, recorded on the version (final_master_path + metadata + status). It
--     must exist before Mark Final succeeds and is served only via the gated,
--     short-lived signed URL (app/api/portal/deliverable-download).
--
-- This migration:
--   1) Adds final_master_* columns + final_master_status (none|present|missing_or_unsafe).
--   2) admin_set_version_final_master(...) — validates the storage object exists in
--      project-deliverables, rejects a URL / a value equal to preview_url, records
--      metadata, sets status='present'.
--   3) admin_set_final_version REWRITTEN — REQUIRES a present clean master; NEVER
--      falls back to preview_url; no longer writes a preview-derived final asset.
--   4) get_deliverable_download REWRITTEN — serves the version's final_master_path
--      (bare "project-deliverables/<path>" for the route to sign) and DENIES when the
--      master is missing/unsafe, in addition to the existing dues+window+limit gate.
--   5) deliverable_final_master_state(deliverable) — admin/staff read of the master
--      status + metadata (drives the "Clean final master required" admin warning).
--   6) BACKFILL — every existing final version is flagged: 'present' only if a
--      distinct storage-backed master can be derived from its final asset; otherwise
--      'missing_or_unsafe' (never silently exposed; client stays on watermarked
--      preview until an admin uploads a real master).
--
-- Idempotent · non-destructive · preserves the payment gate/release/versioning.
-- Depends on: deliverable_versions, deliverables, deliverable_assets,
-- project_delivery_release, is_admin(), can_final_deliver(), is_client_side(uuid),
-- is_not_blocked(), pc_release_window_ok(text,timestamptz), log_activity, storage.objects.
-- Run AFTER deliverable_versions_RUNME.sql + project_delivery_release_policy_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.deliverable_versions') is null then miss := miss || ' deliverable_versions'; end if;
  if to_regclass('public.deliverable_assets')   is null then miss := miss || ' deliverable_assets'; end if;
  if to_regclass('public.project_delivery_release') is null then miss := miss || ' project_delivery_release (شغّل release_policy)'; end if;
  if to_regprocedure('public.is_admin()')             is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_final_deliver()')    is null then miss := miss || ' can_final_deliver()'; end if;
  if to_regprocedure('public.is_client_side(uuid)')   is null then miss := miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.pc_release_window_ok(text,timestamptz)') is null then miss := miss || ' pc_release_window_ok'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة النسخة النهائية النظيفة ═══
alter table public.deliverable_versions add column if not exists final_master_path        text;
alter table public.deliverable_versions add column if not exists final_master_name        text;
alter table public.deliverable_versions add column if not exists final_master_mime        text;
alter table public.deliverable_versions add column if not exists final_master_size        bigint;
alter table public.deliverable_versions add column if not exists final_master_uploaded_by uuid references auth.users(id);
alter table public.deliverable_versions add column if not exists final_master_uploaded_at timestamptz;
alter table public.deliverable_versions add column if not exists final_master_status      text not null default 'none';
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'dlv_ver_master_status_ck') then
    alter table public.deliverable_versions add constraint dlv_ver_master_status_ck
      check (final_master_status in ('none','present','missing_or_unsafe'));
  end if;
end $c$;

-- ═══ 2) رفع/تعيين النسخة النهائية النظيفة (أدمن/مُسلِّم) ═══
-- p_path = مسار كائن داخل bucket الخاص project-deliverables (بلا scheme). يُرفض إن كان
-- رابطًا، أو مساويًا لرابط المعاينة، أو غير موجود فعليًا في التخزين.
create or replace function public.admin_set_version_final_master(
  p_version uuid, p_path text, p_name text default null, p_mime text default null, p_size bigint default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; v_clean text;
begin
  if not (public.is_admin() or public.can_final_deliver()) then raise exception 'not authorized'; end if;
  select dv.id, dv.deliverable_id, dv.preview_url, dv.vimeo_review_url into v
    from public.deliverable_versions dv where dv.id = p_version and dv.is_deleted = false;
  if v.id is null then raise exception 'not_found'; end if;
  v_clean := btrim(coalesce(p_path,''));
  if v_clean = '' then raise exception 'master_path_required'; end if;
  if v_clean ~ '://' then raise exception 'master_must_be_storage_object_not_url'; end if;
  if v_clean = btrim(coalesce(v.preview_url,'')) or v_clean = btrim(coalesce(v.vimeo_review_url,'')) then
    raise exception 'master_must_not_equal_preview';
  end if;
  -- normalize: allow "project-deliverables/<path>" or bare "<path>"; store bare object path.
  v_clean := regexp_replace(v_clean, '^/*project-deliverables/+', '');
  v_clean := regexp_replace(v_clean, '^/+', '');
  if v_clean = '' then raise exception 'master_path_required'; end if;
  -- object must physically exist in the private bucket.
  if not exists (select 1 from storage.objects where bucket_id = 'project-deliverables' and name = v_clean) then
    raise exception 'master_object_not_found';
  end if;
  update public.deliverable_versions set
    final_master_path = v_clean,
    final_master_name = nullif(btrim(coalesce(p_name,'')),''),
    final_master_mime = nullif(btrim(coalesce(p_mime,'')),''),
    final_master_size = p_size,
    final_master_uploaded_by = auth.uid(),
    final_master_uploaded_at = now(),
    final_master_status = 'present'
    where id = p_version;
  perform public.log_activity(auth.uid(), 'admin', 'deliverable.final_master_set', 'deliverable', v.deliverable_id,
    jsonb_build_object('version', p_version, 'name', left(coalesce(p_name,''),200)));
  return true;
end $$;

-- ═══ 3) تعيين النسخة النهائية — يتطلب نسخة نظيفة موجودة، ولا يستخدم رابط المعاينة أبدًا ═══
create or replace function public.admin_set_final_version(p_deliverable uuid, p_version uuid, p_final_url text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not (public.is_admin() or public.can_final_deliver()) then raise exception 'not authorized'; end if;
  select dv.*, d.project_id into v from public.deliverable_versions dv join public.deliverables d on d.id = dv.deliverable_id
    where dv.id = p_version and dv.deliverable_id = p_deliverable and dv.is_deleted = false and d.is_deleted = false;
  if v.id is null then raise exception 'not_found'; end if;
  if v.decision <> 'approved' then raise exception 'version_not_approved'; end if;

  -- P0-1: a DISTINCT clean master must exist before Mark Final. If a path is passed
  -- here (back-compat), set it first (validated) — otherwise require it up-front.
  if nullif(btrim(coalesce(p_final_url,'')),'') is not null and coalesce(v.final_master_status,'none') <> 'present' then
    perform public.admin_set_version_final_master(p_version, p_final_url, null, null, null);
    select dv.final_master_status into v.final_master_status from public.deliverable_versions dv where dv.id = p_version;
  end if;
  if coalesce(v.final_master_status,'none') <> 'present' then
    raise exception 'clean_final_master_required';
  end if;

  update public.deliverable_versions set is_final = false where deliverable_id = p_deliverable and is_final;
  update public.deliverable_versions set is_final = true, is_current = true where id = p_version;
  update public.deliverable_versions set is_current = false where deliverable_id = p_deliverable and id <> p_version and is_current;
  update public.deliverables set status = 'approved', version = v.version_no where id = p_deliverable and status <> 'final_delivered';
  update public.deliverables set status = 'final_delivered' where id = p_deliverable and status <> 'final_delivered';
  -- NOTE: intentionally NO deliverable_assets insert from preview_url. The gated
  -- download reads deliverable_versions.final_master_path directly (§4).
  perform public.log_activity(auth.uid(), 'admin', 'deliverable.final_version_set', 'deliverable', p_deliverable,
    jsonb_build_object('version', v.version_no));
  return true;
end $$;

-- ═══ 4) بوابة التنزيل — تُقدّم النسخة النظيفة الخاصة فقط، وتمنع إن كانت مفقودة/غير آمنة ═══
create or replace function public.get_deliverable_download(p_deliverable uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'project-deliverables/' || dv.final_master_path
  from public.deliverable_versions dv
  join public.deliverables d on d.id = dv.deliverable_id
  left join public.project_delivery_release r on r.project_id = d.project_id
  where dv.deliverable_id = p_deliverable and dv.is_final = true and dv.is_deleted = false
    and dv.final_master_status = 'present' and nullif(btrim(coalesce(dv.final_master_path,'')),'') is not null
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

-- ═══ 5) حالة النسخة النهائية النظيفة (أدمن/كادر) — تُظهر تحذير "مطلوب نسخة نهائية نظيفة" ═══
create or replace function public.deliverable_final_master_state(p_deliverable uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid; v record;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not (public.is_admin() or public.staff_reads_all_projects() or public.project_role(v_proj) is not null) then
    raise exception 'not authorized';
  end if;
  select dv.id, dv.version_no, dv.final_master_status, dv.final_master_name, dv.final_master_mime,
         dv.final_master_size, dv.final_master_uploaded_at, dv.final_master_uploaded_by
    into v from public.deliverable_versions dv
    where dv.deliverable_id = p_deliverable and dv.is_final = true and dv.is_deleted = false limit 1;
  if v.id is null then
    return jsonb_build_object('has_final', false, 'status', 'none', 'safe', false);
  end if;
  return jsonb_build_object(
    'has_final', true, 'version_id', v.id, 'version_no', v.version_no,
    'status', v.final_master_status,
    'safe', v.final_master_status = 'present',
    'name', v.final_master_name, 'mime', v.final_master_mime, 'size', v.final_master_size,
    'uploaded_at', v.final_master_uploaded_at,
    'uploaded_by', (select full_name from public.profiles where id = v.final_master_uploaded_by));
end $$;

-- ═══ 6) BACKFILL — وسم كل نسخة نهائية قائمة ═══
-- 'present' فقط إذا أمكن اشتقاق نسخة نظيفة مخزّنة (أصل final مختلف عن رابط المعاينة ويشير
-- إلى bucket project-deliverables). غير ذلك = 'missing_or_unsafe' (لا كشف صامت).
do $bf$
declare r record; v_final_url text; v_path text;
begin
  for r in select dv.id as version_id, dv.deliverable_id, dv.preview_url, dv.vimeo_review_url
           from public.deliverable_versions dv
           where dv.is_final = true and dv.is_deleted = false
             and coalesce(dv.final_master_status,'none') = 'none'
  loop
    select a.url into v_final_url from public.deliverable_assets a
      where a.deliverable_id = r.deliverable_id and a.kind = 'final' and a.is_deleted = false
      order by a.created_at desc limit 1;
    v_path := null;
    if v_final_url is not null
       and btrim(v_final_url) <> btrim(coalesce(r.preview_url,''))
       and btrim(v_final_url) <> btrim(coalesce(r.vimeo_review_url,''))
       and position('project-deliverables/' in v_final_url) > 0 then
      -- derive the object path after the bucket segment.
      v_path := regexp_replace(v_final_url, '^.*project-deliverables/+', '');
      v_path := regexp_replace(v_path, '[?#].*$', '');
    end if;
    if v_path is not null and v_path <> '' then
      update public.deliverable_versions set final_master_path = v_path, final_master_status = 'present',
        final_master_uploaded_at = coalesce(final_master_uploaded_at, now()) where id = r.version_id;
    else
      update public.deliverable_versions set final_master_status = 'missing_or_unsafe' where id = r.version_id;
    end if;
  end loop;
end $bf$;

-- ═══ 7) Grants + VALIDATION ═══
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_set_version_final_master(uuid,text,text,text,bigint)',
    'public.deliverable_final_master_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

do $v$
declare miss text := '';
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='deliverable_versions' and column_name='final_master_status') = 0 then miss := miss || ' final_master_status'; end if;
  if to_regprocedure('public.admin_set_version_final_master(uuid,text,text,text,bigint)') is null then miss := miss || ' admin_set_version_final_master'; end if;
  if to_regprocedure('public.deliverable_final_master_state(uuid)') is null then miss := miss || ' deliverable_final_master_state'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- فحص بعد التطبيق:
--   select public.deliverable_final_master_state('<deliverable>');   -- status=missing_or_unsafe لأصل قديم
--   -- (رفع الملف النظيف إلى project-deliverables ثم) select public.admin_set_version_final_master('<ver>','<path>');
