-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — Billing accept RUNTIME diagnostic + safety re-assert (OPTIONAL)
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- CONTEXT: the accept-with-billing API route was made SELF-SUFFICIENT — after it
-- authenticates the user (their JWT) and proves quote ownership via RLS, it ensures
-- the caller's own clients row with the service role, so acceptance now works even
-- if this or the previous patch was never run. This file is therefore OPTIONAL: it
-- (a) re-asserts ensure_my_client_id() idempotently (belt-and-suspenders for the
-- RPC path), and (b) VALIDATES that the billing feature objects exist.
--
-- It changes NO data, weakens NO RLS, and adds NO WhatsApp/email/n8n/media objects.
-- SECURITY DEFINER fn sets search_path=public.
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
