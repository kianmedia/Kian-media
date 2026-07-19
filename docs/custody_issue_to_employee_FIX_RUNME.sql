-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-2: CUSTODY MANAGER CAN ISSUE TO OTHER EMPLOYEES  (RUN ONCE)
--
-- ROOT CAUSE of the confirmed defect ("a Custody Manager can manage their own
-- custody but cannot reliably issue custody to ANOTHER employee"):
--   The issue RPC public.custody_inv_admin_create_assignment(jsonb) is correctly
--   gated on civ_can_manage() and fully supports any employee_user_id. BUT the
--   Issue-tab employee PICKER was populated by a DIRECT PostgREST read of
--   public.profiles (CustodyInventoryConsole.tsx: profiles?...staff_role.not.is.null).
--   The profiles SELECT RLS (phase0_migration.sql:793) is:
--     using ((id = auth.uid() and is_not_blocked()) or is_admin())
--   so a Custody Manager who is staff_role='custody_officer'/'manager' or holds the
--   manage_custody profession — but is NOT account_type='admin' — can read ONLY
--   THEIR OWN profile row. The picker therefore renders empty/self-only and they
--   cannot select another employee. The RPC never gets a chance to run.
--
-- FIX: a SECURITY DEFINER read RPC civ_list_eligible_employees() gated on
-- civ_can_manage() that returns the active INTERNAL employees eligible to receive
-- custody (bypassing the profiles RLS as owner), replacing the direct profiles read.
-- Eligible = account_status='active' AND (account_type='admin' OR staff_role is not
-- null) — i.e. active staff, never clients/leads, never inactive (spec: "cannot
-- issue to inactive users"). Owner/Admin already saw the full list; this only opens
-- the SAME set to authorized non-admin custody managers. No RLS is weakened.
--
-- Idempotent · non-destructive · no Zoho/finance · does not touch profiles RLS.
-- Depends on: profiles, civ_can_manage(), staff_role() — all already in production.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.profiles')            is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage() (شغّل custody v1 + bridge)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- قائمة الموظفين المؤهّلين لاستلام العهدة (لمديري العهدة المصرّح لهم) —
-- تتجاوز RLS على profiles عبر SECURITY DEFINER، لكنها محكومة بـ civ_can_manage().
create or replace function public.civ_list_eligible_employees()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x->>'full_name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'staff_role', p.staff_role,
      'account_type', p.account_type
    ) as x
    from public.profiles p
    where p.account_status = 'active'
      and (p.account_type = 'admin' or p.staff_role is not null)
  ) t;
  return v;
end $$;

revoke all on function public.civ_list_eligible_employees() from public, anon;
grant execute on function public.civ_list_eligible_employees() to authenticated;

do $v$
begin
  if to_regprocedure('public.civ_list_eligible_employees()') is null then
    raise exception 'فشل التحقق: civ_list_eligible_employees غير موجودة';
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- فحص اختياري بعد التطبيق (بحساب مدير عهدة غير أدمن):
--   select public.civ_list_eligible_employees();   -- يجب أن تُعيد قائمة الموظفين النشطين
