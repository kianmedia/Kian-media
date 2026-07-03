-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — Billing accept: ensure_my_client_id() (REQUIRED)
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- WHY REQUIRED: public.clients has NO direct table write grant (by design — all
-- writes go through SECURITY DEFINER RPCs). So the accept-with-billing route creates
-- the caller's own clients row by calling this SECURITY DEFINER function via the
-- user's JWT (rpcAsUser → auth.uid()). Without it, the route returns code
-- 'sql_not_run' and acceptance cannot complete. (An earlier attempt to INSERT into
-- clients directly with the service role failed with "permission denied for table
-- clients" precisely because there is no write grant — this RPC is the fix.)
--
-- Idempotent. SECURITY DEFINER sets search_path=public. Granted to `authenticated`
-- (callable as the logged-in user). Changes NO data; weakens NO RLS; adds NO
-- WhatsApp/email/n8n/media objects. If you already ran
-- docs/portal_billing_accept_client_resolution_PATCH_RUNME.sql, this function
-- already exists and re-running is a harmless no-op.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Re-assert the caller-scoped client resolver (harmless if already present).
create or replace function public.ensure_my_client_id() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_email text; v_name text; v_client uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id into v_client from public.clients where user_id = v_uid and is_deleted = false order by created_at limit 1;
  if v_client is not null then return v_client; end if;
  select email, full_name into v_email, v_name from public.profiles where id = v_uid;
  v_email := lower(trim(coalesce(v_email, '')));
  if v_email <> '' then
    update public.clients set user_id = v_uid, updated_at = now()
     where user_id is null and is_deleted = false and coalesce(email_is_placeholder,false) = false
       and lower(coalesce(email,'')) = v_email
     returning id into v_client;
    if v_client is not null then
      update public.profiles set account_type = 'client' where id = v_uid and account_type = 'lead';
      return v_client;
    end if;
  end if;
  insert into public.clients (user_id, full_name, email, email_is_placeholder)
  values (v_uid, nullif(trim(coalesce(v_name,'')),''),
          coalesce(nullif(v_email,''), public.gen_pending_email()), (v_email = ''))
  returning id into v_client;
  update public.profiles set account_type = 'client' where id = v_uid and account_type = 'lead';
  return v_client;
end; $$;
revoke execute on function public.ensure_my_client_id() from public, anon;
grant  execute on function public.ensure_my_client_id() to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION — run these; every row should return true / a value.
-- 1) Required functions exist:
select
  to_regprocedure('public.ensure_my_client_id()')                                             is not null as has_ensure_my_client_id,
  to_regprocedure('public.upsert_client_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)') is not null as has_upsert_billing,
  to_regprocedure('public.accept_quote_with_billing_profile(uuid,text)')                       is not null as has_accept_with_billing,
  to_regprocedure('public.set_billing_profile_zoho(uuid,text,text,text)')                       is not null as has_set_billing_zoho;
-- 2) Required tables exist:
select to_regclass('public.billing_profiles') as billing_profiles, to_regclass('public.invoice_notes') as invoice_notes;
-- 3) For the failing quote (replace the number), confirm the fields RLS/ownership needs:
--    select q.id, q.quote_number, q.estimate_number, q.email, q.client_id, q.total,
--           q.public_portal_visible, q.status,
--           (select count(*) from public.quote_items qi where qi.quote_id = q.id) as items
--      from public.quotes q where q.estimate_number = 'EST-000099' or q.quote_number = 'EST-000099';
-- 4) The client's auth user + email (to confirm email match):
--    select id, email, account_type from public.profiles where email ilike '<client_email>';
-- ════════════════════════════════════════════════════════════════════════════
