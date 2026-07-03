-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — FINAL: portal_prepare_quote_accept_client_v1  (MANDATORY)
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- WHY: the accept-with-billing route needs to resolve/create the caller's OWN
-- clients row for an email-linked quote (quotes.client_id NULL). public.clients has
-- NO direct write grant (all writes go through SECURITY DEFINER RPCs), so the route
-- calls THIS function. Unlike the generic ensure_my_client_id(), this one:
--   • is purpose-specific (verifies ownership of a SPECIFIC quote), and
--   • RETURNS STRUCTURED JSON — it NEVER lets an internal error propagate as a raw
--     PostgREST exception (an "exception when others" block returns the real code/
--     message as data). That stops the route from mislabeling any internal error
--     (e.g. a missing helper) as "function not found / sql_not_run".
--   • does NOT reference public.gen_pending_email() (authenticated users have a real
--     verified email), removing that dependency from the plan path entirely.
--
-- Security: SECURITY DEFINER, set search_path=public. Ownership = the SAME rule the
-- quotes RLS uses (client_id is the caller's own client OR the quote email equals the
-- caller's VERIFIED profile email). Never resolves/claims another person's row. No
-- direct write grant added; RLS unchanged. No WhatsApp/email/n8n/media objects.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.portal_prepare_quote_accept_client_v1(p_quote_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_email text; v_name text;
        v_qclient uuid; v_qemail text; v_self uuid; v_client uuid; v_mode text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated', 'message', 'not authenticated');
  end if;

  select email, full_name into v_email, v_name from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'profile_missing', 'message', 'profile not found for this user');
  end if;
  v_email := lower(trim(coalesce(v_email, '')));

  select client_id, email into v_qclient, v_qemail from public.quotes where id = p_quote_id and not is_deleted;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'quote_missing', 'message', 'quote not found');
  end if;

  -- The caller's existing own client row (WITHOUT my_client_id()'s account_type filter,
  -- so a freshly-promoted client is not excluded mid-transaction). Only their own uid.
  select id into v_self from public.clients where user_id = v_uid and is_deleted = false order by created_at limit 1;

  -- ── Ownership + client resolution (mirrors the quotes_read RLS ownership rule) ──
  if v_qclient is not null and v_self is not null and v_qclient = v_self then
    v_client := v_self; v_mode := 'client_id';

  elsif v_qemail is not null and v_email <> '' and lower(v_qemail) = v_email then
    if v_self is not null then
      v_client := v_self; v_mode := 'email_link';
    else
      -- Claim a pending (unlinked, real-email) client row matching the verified email.
      -- NOTE: public.clients has NO updated_at column — do not set it here.
      update public.clients set user_id = v_uid
       where user_id is null and is_deleted = false and coalesce(email_is_placeholder, false) = false
         and lower(coalesce(email, '')) = v_email
       returning id into v_client;
      if v_client is not null then
        v_mode := 'claimed';
      else
        -- Create a fresh client row for this user (real verified email — no placeholder).
        insert into public.clients (user_id, full_name, email, email_is_placeholder)
        values (v_uid, nullif(trim(coalesce(v_name, '')), ''), v_email, false)
        returning id into v_client;
        v_mode := 'created';
      end if;
    end if;

  elsif v_self is not null and v_qclient is null and v_qemail is null then
    -- Defensive: quote with neither client nor email but the caller has a client row
    -- and (per route-side RLS) could see it. Attach to their own client.
    v_client := v_self; v_mode := 'client_id';

  else
    return jsonb_build_object('ok', false, 'code', 'not_owner', 'message', 'quote is not linked to this account');
  end if;

  if v_client is null then
    return jsonb_build_object('ok', false, 'code', 'client_create_failed', 'message', 'could not resolve or create the client row');
  end if;

  -- Promote lead → client so my_client_id()/RLS resolve for the linked client.
  update public.profiles set account_type = 'client' where id = v_uid and account_type = 'lead';
  -- Link the quote to the resolved client if it was email-only.
  update public.quotes set client_id = coalesce(client_id, v_client), updated_at = now() where id = p_quote_id;

  return jsonb_build_object('ok', true, 'client_id', v_client, 'quote_id', p_quote_id, 'ownership_mode', v_mode);

exception
  when others then
    -- Never propagate a raw exception to PostgREST (which the route could misread as
    -- "function not found"). Return the real reason as structured data instead.
    return jsonb_build_object('ok', false, 'code', 'prepare_exception', 'message', left(coalesce(sqlerrm, 'unknown'), 200), 'sqlstate', sqlstate);
end; $$;

revoke execute on function public.portal_prepare_quote_accept_client_v1(uuid) from public, anon;
grant  execute on function public.portal_prepare_quote_accept_client_v1(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION — run these; each should return a value / true.
-- 1) Function exists:
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc where proname = 'portal_prepare_quote_accept_client_v1';
-- 2) Grants:
select has_function_privilege('authenticated', 'public.portal_prepare_quote_accept_client_v1(uuid)', 'execute') as authenticated_can_execute,
       has_function_privilege('service_role',  'public.portal_prepare_quote_accept_client_v1(uuid)', 'execute') as service_role_can_execute;
-- 3) Required tables:
select to_regclass('public.clients') as clients, to_regclass('public.quotes') as quotes,
       to_regclass('public.billing_profiles') as billing_profiles, to_regclass('public.profiles') as profiles;
-- 4) Dry-run for EST-000099 as the SQL editor (service role → auth.uid() is null, so it
--    will report not_authenticated; run it from the app as the client to see ok:true):
-- select public.portal_prepare_quote_accept_client_v1(
--   (select id from public.quotes where estimate_number = 'EST-000099' or quote_number = 'EST-000099' limit 1));
-- ════════════════════════════════════════════════════════════════════════════
