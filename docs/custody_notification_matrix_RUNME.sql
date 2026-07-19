-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-5: CUSTODY NOTIFICATION MATRIX (PM recipient + case link)  (RUN ONCE)
--
-- Extends the durable Portal+Email custody path (custody_inventory_email_outbox_RUNME)
-- with the two remaining P0-5 requirements. AUTHORITATIVE redefinition of both
-- helpers (supersedes the outbox file's civ_notify — same fail-safe + rental
-- exclusion, plus a direct case link):
--
--   • civ_notify()          — portal + durable email (best-effort, fail-isolated;
--     excludes rental_% events which embed amounts) NOW with a direct link to the
--     custody portal in the email, so recipients open the exact case.
--   • civ_notify_managers()  — role fan-out (owner/admin/super-admin/manager/
--     custody_officer) PLUS the LINKED PROJECT's manager(s) (project_members role
--     kian_manager/kian_admin) whenever the notified entity is a custody assignment
--     tied to a project. So a project-manager gets custody notifications ONLY for
--     cases on their own project.
--
-- Every existing custody action RPC already calls civ_notify / civ_notify_managers,
-- so this activates PM routing + email case-links for ALL events (issue / accept /
-- reject / due / overdue / return / inspect / maintenance / liability / close) with
-- no change to the action RPCs. Arabic/English bodies come from each caller's
-- message (per-event "templates"); dedup/retry/backoff/status are handled by the
-- existing email_deliveries outbox + /api/cron/notify-email. No hidden liability
-- amount or internal note is ever emailed (rental amounts excluded; the liability
-- module never puts a figure in a civ_notify message).
--
-- Idempotent · non-destructive. Depends on: civ_notify, notify, profiles,
-- project_members, custody_inventory_assignments. nt_enqueue_email optional.
-- Run AFTER custody_inventory_email_outbox_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)') is null then miss := miss || ' civ_notify'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if to_regclass('public.project_members') is null then miss := miss || ' project_members'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- civ_notify: portal + durable email (fail-safe, rental-excluded) + direct case link.
create or replace function public.civ_notify(p_recipient uuid, p_type text, p_entity uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if p_recipient is null then return; end if;
  perform public.notify(p_recipient, 'user', p_type, 'custody_inventory', p_entity, p_ar, p_en);
  begin
    if coalesce(left(p_type, 7), '') <> 'rental_'
       and to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is not null then
      select email into v_email from public.profiles where id = p_recipient and account_status <> 'blocked';
      if v_email is not null and position('@' in v_email) > 0 then
        perform public.nt_enqueue_email(
          v_email,
          'كيان | إشعار عهدة — Custody notification',
          coalesce(nullif(btrim(p_ar),''),'') || E'\n' || coalesce(nullif(btrim(p_en),''),''),
          '/client-portal/asset-custody');   -- direct link to the custody portal
      end if;
    end if;
  exception when others then null;
  end;
exception when others then return;
end $$;

-- civ_notify_managers: role tier + LINKED-PROJECT manager(s).
create or replace function public.civ_notify_managers(p_type text, p_entity uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_proj uuid;
begin
  -- role-based custody-manage tier (owner/admin/super-admin/manager/custody_officer)
  for r in
    select id from public.profiles
     where account_status = 'active'
       and (account_type = 'admin' or staff_role in ('super_admin','manager','custody_officer'))
  loop
    perform public.civ_notify(r.id, p_type, p_entity, p_ar, p_en);
  end loop;
  -- P0-5: linked-project manager(s) — only when the entity is a custody assignment
  -- tied to a project (rental entities won't match → no spurious PM notify).
  begin
    select project_id into v_proj from public.custody_inventory_assignments
      where id = p_entity and is_deleted = false;
    if v_proj is not null then
      for r in
        select pm.user_id from public.project_members pm
         where pm.project_id = v_proj and pm.role in ('kian_manager','kian_admin')
      loop
        perform public.civ_notify(r.user_id, p_type, p_entity, p_ar, p_en);
      end loop;
    end if;
  exception when others then null;
  end;
exception when others then return;
end $$;

-- keep the v1 lock-down (internal helpers; called by SECURITY DEFINER RPCs only).
revoke execute on function public.civ_notify(uuid,text,uuid,text,text)        from public, anon, authenticated;
revoke execute on function public.civ_notify_managers(text,uuid,text,text)    from public, anon, authenticated;

do $v$
begin
  if to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)')     is null then raise exception 'فشل: civ_notify'; end if;
  if to_regprocedure('public.civ_notify_managers(text,uuid,text,text)') is null then raise exception 'فشل: civ_notify_managers'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
