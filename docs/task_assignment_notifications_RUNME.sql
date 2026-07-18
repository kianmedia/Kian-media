-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — TASK ASSIGNMENT NOTIFICATIONS (RUN ONCE)  [P0-5]
--
-- Extends the notification matrix onto project_tasks using the SAME infrastructure
-- (notify() portal rows + nt_enqueue_email into the email_deliveries outbox drained
-- by /api/cron/notify-email with retry/status, surfaced by NotifyMonitor). When a
-- task gains or changes its assignee, the assignee is notified (portal + email).
-- Exception-guarded + to_regclass-guarded, so notification never rolls back the task
-- write. Uses the always-allowed 'project_note_new' type. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_tasks') is null then miss := miss || ' project_tasks'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

create or replace function public.nt_task_assigned() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  -- Only when the assignee is newly set or changed to a real user.
  if NEW.assignee_id is not null
     and (TG_OP = 'INSERT' or NEW.assignee_id is distinct from OLD.assignee_id) then
    begin
      v_url := '/client-portal/project-core/' || coalesce(NEW.project_id::text,'') || '?tab=tasks';
      perform public.notify(NEW.assignee_id, 'user', 'project_note_new', 'project_task', NEW.id,
        'أُسندت إليك مهمة: ' || coalesce(NEW.title,''), 'A task was assigned to you: ' || coalesce(NEW.title,''));
      if to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is not null then
        perform public.nt_enqueue_email((select email from public.profiles where id = NEW.assignee_id),
          'كيان | مهمة جديدة مُسندة إليك — New task assigned',
          'أُسندت إليك مهمة "' || coalesce(NEW.title,'') || '". افتح لوحة كيان لعرضها.' || chr(10) ||
          'You have been assigned the task "' || coalesce(NEW.title,'') || '". Open the Kian dashboard to view it.', v_url);
      end if;
    exception when others then null; end;
  end if;
  return NEW;
end $$;

drop trigger if exists t_nt_task_assigned on public.project_tasks;
create trigger t_nt_task_assigned after insert or update of assignee_id on public.project_tasks
  for each row execute function public.nt_task_assigned();

do $v$
begin
  if not exists (select 1 from pg_trigger where tgname = 't_nt_task_assigned') then raise exception 'فشل: t_nt_task_assigned'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
