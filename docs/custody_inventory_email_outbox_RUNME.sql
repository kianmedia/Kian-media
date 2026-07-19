-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-5: CUSTODY (CIV) NOTIFICATIONS → DURABLE EMAIL OUTBOX  (RUN ONCE)
--
-- The custody-inventory workflow (issue / confirm / return / inspect / etc.) fans
-- out PORTAL notifications through civ_notify()/civ_notify_managers() but sends NO
-- email — so the P0-5 "immediate Portal + Email on every custody action" is unmet
-- for the CIV system, and any browser-relayed email is lost on transient failure.
--
-- Fix: redefine civ_notify() to ALSO enqueue one durable email per recipient via
-- the EXISTING outbox helper nt_enqueue_email (→ email_deliveries, drained by the
-- /api/cron/notify-email processor with retry/backoff/status). Because every
-- custody event already routes through civ_notify (directly or via
-- civ_notify_managers' per-manager fan-out), this single change activates email
-- for ALL events + recipients (employee + admin/super-admin/manager/custody_officer
-- = owner tier) with ZERO changes to the action RPCs.
--
-- SAFETY (spec: "notification failure must never roll back custody state"):
--   • The email block is nested-exception-isolated AND the whole function keeps its
--     outer exception→return guard, so neither a missing outbox nor an email error
--     can ever break the custody/inventory transaction.
--   • Only the operational bilingual message (assignment no. / status) is emailed —
--     never admin_note_internal or any financial/liability figure.
--   • Guarded by to_regprocedure: no-op (portal-only, as before) if the outbox
--     helper isn't installed yet.
--
-- Idempotent · non-destructive · reuses the outbox (no parallel email system).
-- Depends on: civ_notify (custody v1), notify(...), profiles. Optional at runtime:
-- nt_enqueue_email(text,text,text,text) (from review_thread_email_RUNME.sql).
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)') is null then miss := miss || ' civ_notify (شغّل custody v1)'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)') is null then miss := miss || ' notify'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
  if to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is null then
    raise notice 'ملاحظة: nt_enqueue_email غير مُثبّت بعد — سيبقى الإشعار عبر المنصة فقط حتى تشغيل review_thread_email_RUNME.sql';
  end if;
end $pf$;

begin;

-- civ_notify: portal notification (كما كان) + بريد دائم عبر الصندوق الصادر (P0-5).
create or replace function public.civ_notify(p_recipient uuid, p_type text, p_entity uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if p_recipient is null then return; end if;
  perform public.notify(p_recipient, 'user', p_type, 'custody_inventory', p_entity, p_ar, p_en);
  -- P0-5: durable email via the existing outbox — fully isolated (best-effort).
  begin
    if to_regprocedure('public.nt_enqueue_email(text,text,text,text)') is not null then
      select email into v_email from public.profiles
        where id = p_recipient and account_status <> 'blocked';
      if v_email is not null and position('@' in v_email) > 0 then
        perform public.nt_enqueue_email(
          v_email,
          'كيان | إشعار عهدة — Custody notification',
          coalesce(nullif(btrim(p_ar),''),'') || E'\n' || coalesce(nullif(btrim(p_en),''),''),
          null);
      end if;
    end if;
  exception when others then null;  -- بريد best-effort — لا يكسر حركة العهدة
  end;
exception when others then return;   -- الإشعار كله best-effort (كما كان)
end; $$;

-- keep the same lock-down as v1 (internal helper; called by SECURITY DEFINER RPCs).
revoke execute on function public.civ_notify(uuid,text,uuid,text,text) from public, anon, authenticated;

do $v$
begin
  if to_regprocedure('public.civ_notify(uuid,text,uuid,text,text)') is null then
    raise exception 'فشل التحقق: civ_notify';
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;
