-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — REVIEW-THREAD EMAIL ENQUEUE (RUN ONCE)  [P0-4]
--
-- Wires the review-thread events into the EXISTING email outbox (email_deliveries)
-- that the /api/cron/notify-email processor already drains with retry/backoff and
-- status tracking (pending→processing→sent/failed/skipped, attempts, next_attempt_at,
-- last_error, sent_at). No parallel system.
--
-- Redefines the 3 review triggers to ALSO enqueue emails alongside the portal rows:
--   • client comment      → admins + the deliverable's assignee
--   • client decision      → admins
--   • staff resolve/reply  → the client who wrote the comment
-- Everything is to_regclass-guarded (no-op if the outbox isn't present) and
-- exception-wrapped, so email enqueue can NEVER roll back the comment/review.
-- Client emails carry no internal/financial data. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.client_comments')    is null then miss := miss || ' client_comments'; end if;
  if to_regclass('public.deliverable_reviews') is null then miss := miss || ' deliverable_reviews'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- Enqueue one email row into the existing outbox (safe no-op if it isn't installed).
create or replace function public.nt_enqueue_email(p_email text, p_subject text, p_body text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_email is null or position('@' in p_email) = 0 then return; end if;
  if to_regclass('public.email_deliveries') is null then return; end if;   -- outbox not installed
  begin
    insert into public.email_deliveries (recipient_email, subject, body_text, direct_url, status)
    values (p_email, p_subject, p_body, p_url, 'pending');
  exception when others then null; end;
end $$;
revoke all on function public.nt_enqueue_email(text,text,text,text) from public, anon;
grant execute on function public.nt_enqueue_email(text,text,text,text) to authenticated, service_role;

-- Client comment → admins + assignee (portal + email).
create or replace function public.nt_review_comment_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_assignee uuid; v_url text; r record;
begin
  if coalesce(NEW.author_role,'') = 'client' then
    begin
      select project_id, assignee_id into v_proj, v_assignee from public.deliverables where id = NEW.deliverable_id;
      v_url := '/client-portal/projects/' || coalesce(v_proj::text,'');
      perform public.notify(null, 'admin', 'project_note_new', 'deliverable', NEW.deliverable_id,
        'تعليق جديد من العميل على مخرج', 'New client comment on a deliverable');
      if v_assignee is not null then
        perform public.notify(v_assignee, 'user', 'project_note_new', 'deliverable', NEW.deliverable_id,
          'تعليق جديد من العميل على مخرجك', 'New client comment on your deliverable');
      end if;
      for r in select email from public.profiles where account_type = 'admin' and account_status = 'active' loop
        perform public.nt_enqueue_email(r.email, 'كيان | تعليق جديد من العميل — New client comment',
          'أضاف العميل تعليقًا على مخرج. افتح لوحة كيان لمراجعته.'||chr(10)||'A client added a comment on a deliverable. Open the Kian dashboard to review.', v_url);
      end loop;
      if v_assignee is not null then
        perform public.nt_enqueue_email((select email from public.profiles where id = v_assignee),
          'كيان | تعليق جديد على مخرجك — New comment on your deliverable',
          'أضاف العميل تعليقًا على مخرج مُسند إليك.'||chr(10)||'A client commented on a deliverable assigned to you.', v_url);
      end if;
    exception when others then null; end;
  end if;
  return NEW;
end $$;

-- Staff resolved/replied → notify + email the client who wrote it (no internal data).
create or replace function public.nt_review_comment_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_url text;
begin
  if coalesce(NEW.author_role,'') = 'client'
     and ( (coalesce(NEW.resolution_note,'') <> coalesce(OLD.resolution_note,''))
        or (coalesce(NEW.status,'') = 'resolved' and coalesce(OLD.status,'') <> 'resolved') )
     and NEW.author_id is not null then
    begin
      select project_id into v_proj from public.deliverables where id = NEW.deliverable_id;
      v_url := '/client-portal/projects/' || coalesce(v_proj::text,'');
      perform public.notify(NEW.author_id, 'user', 'project_note_new', 'deliverable', NEW.deliverable_id,
        'ردّ فريق كيان على تعليقك', 'Kian responded to your comment');
      perform public.nt_enqueue_email((select email from public.profiles where id = NEW.author_id),
        'كيان | ردّ على تعليقك — Kian responded',
        'ردّ فريق كيان على تعليقك على المخرج. افتح البوابة لعرض الرد وحالة المعالجة.'||chr(10)||'Kian responded to your comment. Open the portal to see the reply and its status.', v_url);
    exception when others then null; end;
  end if;
  return NEW;
end $$;

-- Client decision (revision/approve) → admins (portal + email).
create or replace function public.nt_review_decision_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_url text; r record; v_rev boolean;
begin
  begin
    v_rev := (NEW.decision = 'revision_requested');
    select project_id into v_proj from public.deliverables where id = NEW.deliverable_id;
    v_url := '/client-portal/projects/' || coalesce(v_proj::text,'');
    perform public.notify(null, 'admin', 'project_note_new', 'deliverable', NEW.deliverable_id,
      case when v_rev then 'طلب تعديل من العميل' else 'اعتماد من العميل' end,
      case when v_rev then 'Client requested a revision' else 'Client approved a version' end);
    for r in select email from public.profiles where account_type = 'admin' and account_status = 'active' loop
      perform public.nt_enqueue_email(r.email,
        case when v_rev then 'كيان | طلب تعديل من العميل — Revision requested' else 'كيان | اعتماد من العميل — Client approved' end,
        case when v_rev then 'طلب العميل تعديلًا على نسخة مخرج.'||chr(10)||'The client requested a revision on a deliverable version.'
             else 'اعتمد العميل نسخة مخرج.'||chr(10)||'The client approved a deliverable version.' end, v_url);
    end loop;
  exception when others then null; end;
  return NEW;
end $$;

do $v$
begin
  if to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is null then raise exception 'فشل: nt_enqueue_email'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
