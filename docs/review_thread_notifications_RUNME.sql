-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — REVIEW-THREAD PORTAL NOTIFICATIONS (RUN ONCE)  [P0-2 / P0-4 core]
--
-- Adds reliable PORTAL notifications for the review conversation, which previously
-- emitted none:
--   • client posts a comment / annotation → notify all admins + the deliverable's
--     assigned employee
--   • client submits a formal review decision (revision/approve) → notify admins
--   • staff resolves / replies to a client comment → notify the client who wrote it
--
-- SAFETY (critical): notifications.type has a CHECK constraint and notify() is
-- granted only to service_role. To guarantee we NEVER regress comment insertion,
-- every emit uses the always-allowed 'project_note_new' type and runs inside an
-- exception-guarded SECURITY DEFINER trigger — if notification delivery fails for
-- any reason, the underlying insert/update still succeeds. No email path is wired
-- here (that is the separate outbox engine); portal rows are the reliable channel.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.client_comments')     is null then miss := miss || ' client_comments'; end if;
  if to_regclass('public.deliverable_reviews')  is null then miss := miss || ' deliverable_reviews'; end if;
  if to_regclass('public.deliverables')         is null then miss := miss || ' deliverables'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- Client comment inserted → notify admins + assignee (never blocks the insert).
create or replace function public.nt_review_comment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_assignee uuid;
begin
  if coalesce(NEW.author_role,'') = 'client' then
    begin
      select project_id, assignee_id into v_proj, v_assignee from public.deliverables where id = NEW.deliverable_id;
      perform public.notify(null, 'admin', 'project_note_new', 'deliverable', NEW.deliverable_id,
        'تعليق جديد من العميل على مخرج', 'New client comment on a deliverable');
      if v_assignee is not null then
        perform public.notify(v_assignee, 'user', 'project_note_new', 'deliverable', NEW.deliverable_id,
          'تعليق جديد من العميل على مخرجك', 'New client comment on your deliverable');
      end if;
    exception when others then null; end;
  end if;
  return NEW;
end $$;
drop trigger if exists t_nt_review_comment_insert on public.client_comments;
create trigger t_nt_review_comment_insert after insert on public.client_comments
  for each row execute function public.nt_review_comment_insert();

-- Staff resolved/replied to a client comment → notify the client who wrote it.
create or replace function public.nt_review_comment_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(NEW.author_role,'') = 'client'
     and ( (coalesce(NEW.resolution_note,'') <> coalesce(OLD.resolution_note,''))
        or (coalesce(NEW.status,'') = 'resolved' and coalesce(OLD.status,'') <> 'resolved') )
     and NEW.author_id is not null then
    begin
      perform public.notify(NEW.author_id, 'user', 'project_note_new', 'deliverable', NEW.deliverable_id,
        'ردّ فريق كيان على تعليقك', 'Kian responded to your comment');
    exception when others then null; end;
  end if;
  return NEW;
end $$;
drop trigger if exists t_nt_review_comment_resolve on public.client_comments;
create trigger t_nt_review_comment_resolve after update on public.client_comments
  for each row execute function public.nt_review_comment_resolve();

-- Client review decision (revision/approve) → notify admins.
create or replace function public.nt_review_decision_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify(null, 'admin', 'project_note_new', 'deliverable', NEW.deliverable_id,
      case when NEW.decision = 'revision_requested' then 'طلب تعديل من العميل' else 'اعتماد من العميل' end,
      case when NEW.decision = 'revision_requested' then 'Client requested a revision' else 'Client approved a version' end);
  exception when others then null; end;
  return NEW;
end $$;
drop trigger if exists t_nt_review_decision_insert on public.deliverable_reviews;
create trigger t_nt_review_decision_insert after insert on public.deliverable_reviews
  for each row execute function public.nt_review_decision_insert();

do $v$
begin
  if not exists (select 1 from pg_trigger where tgname = 't_nt_review_comment_insert') then raise exception 'فشل: comment_insert trigger'; end if;
  if not exists (select 1 from pg_trigger where tgname = 't_nt_review_comment_resolve') then raise exception 'فشل: comment_resolve trigger'; end if;
  if not exists (select 1 from pg_trigger where tgname = 't_nt_review_decision_insert') then raise exception 'فشل: decision_insert trigger'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
