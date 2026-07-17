-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §1 REVISION NOTES + VERSION COMMENTS + RESOLUTION WORKFLOW (RUN ONCE)
--
-- ROOT CAUSE of the Production bug: NO admin/staff view ever fetched or rendered
-- client_comments — only deliverable_reviews.comments (the formal decision note)
-- was shown, and in a separate side section, not under the item. So any note the
-- client entered as a general / timecode comment was invisible to Kian. Neither
-- client_comments nor deliverable_reviews had a resolution workflow.
--
-- This migration adds (idempotent, non-destructive, no RLS weakening):
--   • client_comments:   status(open/in_progress/resolved), resolved_by,
--     resolution_note (Kian response), kind(comment/revision/annotation),
--     page_number, pos_x, pos_y (normalized 0..1) — seeds §3 annotations.
--   • deliverable_reviews: status, resolved_by, resolved_at, resolution_note —
--     so a revision REQUEST itself carries a resolution workflow.
--   • admin_resolve_note(kind,id,status,response) — staff/admin resolve + respond.
--   • Backfill: existing revision reviews → status='open'; approved → 'resolved'.
--     Existing comments keep the 'open' default. Nothing is deleted.
--
-- Depends on: deliverables, deliverable_reviews, client_comments, is_admin(),
-- project_role(uuid), staff_reads_all_projects(), log_activity(...). Does NOT
-- touch Zoho, finance, the payment gate, or the version bucket.
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
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل phase0 + staff_roles + review RUNME أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة سير حلّ التعليق + الموضع (تعليقات العميل) ═══
alter table public.client_comments add column if not exists status          text not null default 'open';
alter table public.client_comments add column if not exists resolved_by     uuid references auth.users(id);
alter table public.client_comments add column if not exists resolution_note text;
alter table public.client_comments add column if not exists kind            text not null default 'comment';
alter table public.client_comments add column if not exists page_number     int;
alter table public.client_comments add column if not exists pos_x           numeric;
alter table public.client_comments add column if not exists pos_y           numeric;
-- قيود آمنة (تُضاف مرة واحدة فقط إن لم تكن موجودة)
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_comments_status_ck') then
    alter table public.client_comments add constraint client_comments_status_ck
      check (status in ('open','in_progress','resolved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_comments_kind_ck') then
    alter table public.client_comments add constraint client_comments_kind_ck
      check (kind in ('comment','revision','annotation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_comments_pos_ck') then
    alter table public.client_comments add constraint client_comments_pos_ck
      check ((pos_x is null or (pos_x >= 0 and pos_x <= 1)) and (pos_y is null or (pos_y >= 0 and pos_y <= 1)));
  end if;
end $c$;

-- ═══ 2) سير حلّ لطلب المراجعة نفسه ═══
alter table public.deliverable_reviews add column if not exists status          text not null default 'open';
alter table public.deliverable_reviews add column if not exists resolved_by     uuid references auth.users(id);
alter table public.deliverable_reviews add column if not exists resolved_at     timestamptz;
alter table public.deliverable_reviews add column if not exists resolution_note text;
do $r$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliverable_reviews_status_ck') then
    alter table public.deliverable_reviews add constraint deliverable_reviews_status_ck
      check (status in ('open','in_progress','resolved'));
  end if;
end $r$;

-- ═══ 3) Backfill آمن — لا حذف بيانات ═══
-- طلبات المراجعة القديمة = مفتوحة؛ الاعتمادات = محلولة (لا شيء لحلّه).
update public.deliverable_reviews set status = 'resolved'
  where decision = 'approved' and status = 'open';
-- تعليقات محلولة سابقًا (resolved_at موجود) تُعلَّم resolved.
update public.client_comments set status = 'resolved'
  where resolved_at is not null and status = 'open';

-- ═══ 4) حلّ/ردّ من الكوادر (SECURITY DEFINER؛ أدمن أو كادر على المشروع) ═══
create or replace function public.admin_resolve_note(p_kind text, p_id uuid, p_status text, p_response text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_rows int;
begin
  if p_status is not null and p_status <> all (array['open','in_progress','resolved']) then
    raise exception 'bad_status';
  end if;
  if p_kind = 'comment' then
    select d.project_id into v_proj
      from public.client_comments c join public.deliverables d on d.id = c.deliverable_id
      where c.id = p_id and c.is_deleted = false and d.is_deleted = false;
  elsif p_kind = 'review' then
    select d.project_id into v_proj
      from public.deliverable_reviews rv join public.deliverables d on d.id = rv.deliverable_id
      where rv.id = p_id and d.is_deleted = false;
  else
    raise exception 'bad_kind';
  end if;
  if v_proj is null then raise exception 'not_found'; end if;
  -- تفويض: أدمن، أو كادر يقرأ كل المشاريع، أو كادر معيَّن على هذا المشروع.
  if not (public.is_admin() or public.staff_reads_all_projects() or public.project_role(v_proj) is not null) then
    raise exception 'not authorized';
  end if;

  if p_kind = 'comment' then
    update public.client_comments set
      status          = coalesce(p_status, status),
      resolution_note = coalesce(nullif(btrim(coalesce(p_response,'')),''), resolution_note),
      resolved_by     = case when coalesce(p_status, status) = 'resolved' then auth.uid() else resolved_by end,
      resolved_at     = case when coalesce(p_status, status) = 'resolved' then now() else resolved_at end
      where id = p_id;
  else
    update public.deliverable_reviews set
      status          = coalesce(p_status, status),
      resolution_note = coalesce(nullif(btrim(coalesce(p_response,'')),''), resolution_note),
      resolved_by     = case when coalesce(p_status, status) = 'resolved' then auth.uid() else resolved_by end,
      resolved_at     = case when coalesce(p_status, status) = 'resolved' then now() else resolved_at end
      where id = p_id;
  end if;
  get diagnostics v_rows = row_count;
  perform public.log_activity(auth.uid(), 'admin', 'deliverable.note_resolved', 'deliverable', v_proj,
    jsonb_build_object('kind', p_kind, 'note_id', p_id, 'status', p_status));
  return v_rows > 0;
end $$;
revoke all on function public.admin_resolve_note(text,uuid,text,text) from public, anon;
grant execute on function public.admin_resolve_note(text,uuid,text,text) to authenticated;

-- ═══ 5) VALIDATION ═══
do $v$
declare miss text := '';
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='client_comments' and column_name='status') = 0 then miss := miss || ' client_comments.status'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='client_comments' and column_name='pos_x') = 0 then miss := miss || ' client_comments.pos_x'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='deliverable_reviews' and column_name='resolution_note') = 0 then miss := miss || ' deliverable_reviews.resolution_note'; end if;
  if to_regprocedure('public.admin_resolve_note(text,uuid,text,text)') is null then miss := miss || ' admin_resolve_note'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- فحوص اختيارية:
-- select id, decision, status, resolution_note from public.deliverable_reviews order by created_at desc limit 5;
-- select public.admin_resolve_note('comment','<comment_id>','resolved','عالجناها في V2');
