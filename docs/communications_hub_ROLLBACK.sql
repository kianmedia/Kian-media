-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — ROLLBACK
--
-- ⚠️ READ THIS BEFORE RUNNING. It is honest about what is destroyed.
--
-- WHAT THIS REMOVES PERMANENTLY (there is no undo, and no backup is taken here):
--   • public.comms_outbox        — every queued, retrying, sent, dead-lettered
--                                  and cancelled message, with its provider
--                                  responses and error history. Anything still
--                                  'queued' or 'retrying' is DELETED, not sent.
--   • public.comms_audit         — the record of who retried, cancelled,
--                                  changed a channel flag or published a
--                                  template. THIS IS AUDIT EVIDENCE. Once it is
--                                  gone you cannot answer "who turned email on".
--   • public.comms_preferences   — every user's per-category choices. Users will
--                                  silently fall back to the defaults.
--   • public.comms_templates     — every template AND every published version.
--                                  Custom Arabic/English wording written by the
--                                  team is lost; the seeds can be recreated by
--                                  re-running the RUNME, edits cannot.
--   • public.comms_event_catalog, public.comms_channels, public.comms_rate_counters
--   • all comms_* functions and the comms_outbox guard trigger.
--
-- WHAT THIS DOES **NOT** TOUCH (deliberately — the hub never owned them):
--   • public.notifications, public.notification_preferences
--   • public.notification_events, public.email_deliveries       ← the legacy queue
--   • public.notification_delivery_log
--   • notification_resolve_recipients / notify_emit_event / pc_event_emit
--   • every existing sender in lib/server/*.ts
--   The pre-hub system is exactly as it was. Removing the hub does not remove a
--   single message from the legacy path, and does not send one either.
--
-- WHAT THIS CANNOT UNDO
--   • Nothing, because nothing was ever sent. Every channel shipped dry_run and
--     email/whatsapp shipped disabled, so there is no delivered message to recall.
--     If somebody enabled a channel and took it out of dry-run before this
--     rollback, messages MAY have gone out; this file cannot recall them. Check
--     `select * from public.comms_audit where action = 'channel_flag'` FIRST —
--     and note that this rollback then destroys that very evidence.
--
-- RECOMMENDED INSTEAD OF ROLLBACK
--   To stop the hub without losing anything, disable the channels:
--     select public.comms_channel_set('portal', false);
--     select public.comms_channel_set('email', false, true);
--     select public.comms_channel_set('whatsapp', false, true);
--   That halts all enqueuing (comms_enqueue skips a disabled channel) and keeps
--   the history, the audit and the preferences. Prefer it.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── OPTIONAL: run this FIRST and keep the output if you may ever need it ───
-- select jsonb_pretty(jsonb_build_object(
--   'outbox_by_status', (select jsonb_object_agg(status, n) from
--                        (select status, count(*) n from public.comms_outbox group by status) s),
--   'channel_flag_changes', (select jsonb_agg(to_jsonb(a)) from public.comms_audit a
--                            where a.action = 'channel_flag'),
--   'live_sends', (select count(*) from public.comms_outbox
--                  where status in ('sent','delivered') and not dry_run)));

begin;

-- A last, loud refusal: if a real (non-dry-run, non-mirror) send was recorded,
-- this rollback would destroy the only record of it. Deleting delivery evidence
-- silently is exactly the kind of thing that leaves nobody able to answer what
-- happened. Comment the block out ONLY if you accept that.
do $guard$
declare v_n int := 0;
begin
  if to_regclass('public.comms_outbox') is not null then
    select count(*) into v_n from public.comms_outbox
     where status in ('sent','delivered') and not dry_run
       and coalesce(provider, '') <> 'legacy_email_deliveries';
  end if;
  if v_n > 0 then
    raise exception 'ROLLBACK REFUSED: % real send(s) are recorded in comms_outbox. Export them first, then comment out this guard block.', v_n;
  end if;
end $guard$;

-- ─── 1) Trigger ─────────────────────────────────────────────────────────────
drop trigger if exists t_comms_outbox_guard on public.comms_outbox;

-- ─── 2) Functions (explicit signatures; no blind CASCADE) ───────────────────
drop function if exists public.comms_adapter_import_legacy(int);
drop function if exists public.comms_prefs_set(text,boolean,boolean,boolean,text);
drop function if exists public.comms_prefs_get();
drop function if exists public.comms_health();
drop function if exists public.comms_dashboard(text,text,text,text,timestamptz,timestamptz,int,int);
drop function if exists public.comms_template_publish(text,text,text,text,text);
drop function if exists public.comms_channel_set(text,boolean,boolean,text);
drop function if exists public.comms_preview(text,text,text,jsonb);
drop function if exists public.comms_cancel(uuid,text);
drop function if exists public.comms_retry(uuid);
drop function if exists public.comms_reap();
drop function if exists public.comms_settle(uuid,text,text,text,jsonb,text,text);
drop function if exists public.comms_claim(int,uuid[]);
drop function if exists public.comms_enqueue(text,text,uuid,uuid,uuid,jsonb,uuid);
drop function if exists public.comms_resolve(text,text,uuid,uuid,uuid,jsonb);
drop function if exists public.comms_render(text,jsonb);
drop function if exists public.comms_audit_write(text,text,text,jsonb);
drop function if exists public.comms_rate_check(text,int,int);
drop function if exists public.comms_outbox_guard();
drop function if exists public.comms_body_has_restricted_content(text);

-- ─── 3) Tables — DATA LOSS STARTS HERE ──────────────────────────────────────
drop table if exists public.comms_outbox;
drop table if exists public.comms_preferences;
drop table if exists public.comms_rate_counters;
drop table if exists public.comms_audit;
drop table if exists public.comms_templates;
drop table if exists public.comms_event_catalog;
drop table if exists public.comms_channels;

-- ─── 4) Predicates last: the RLS policies above depended on them ────────────
drop function if exists public.comms_can_admin();
drop function if exists public.comms_can_view();
drop function if exists public.comms_is_staff();
drop function if exists public.comms_is_external(uuid);

-- ─── 5) Prove nothing of the pre-hub system was taken with it ───────────────
do $verify$
declare t text;
begin
  foreach t in array array['notifications','notification_preferences','notification_events',
                           'email_deliveries','notification_delivery_log'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'ROLLBACK BUG: public.% disappeared — it was never the hub''s to drop', t;
    end if;
  end loop;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'comms\_%') then
    raise exception 'ROLLBACK INCOMPLETE: a comms_* relation survived';
  end if;
  raise notice 'ROLLBACK COMPLETE — the hub is gone; the pre-hub notification system is untouched.';
end $verify$;

commit;

notify pgrst, 'reload schema';

-- After this, the UI degrades on purpose: every hub surface feature-detects and
-- renders «الميزة بانتظار تفعيل قاعدة البيانات» instead of crashing. No code
-- deployment is required to complete this rollback.
