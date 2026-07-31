-- ════════════════════════════════════════════════════════════════════════════
-- COMMUNICATIONS HUB — PREFLIGHT (READ-ONLY)
--
-- Run this FIRST, in the Supabase SQL editor. It writes nothing, locks nothing
-- and changes nothing. It answers four questions:
--
--   1. Which parts of the EXISTING notification machinery are actually present?
--      (the hub composes over them and feature-detects each one — it never
--       assumes, because the repo's own notes disagree about what was applied)
--   2. Is anything already named comms_* that would collide?
--   3. Is any comms_* function present with a DIFFERENT return type? Replacing
--      such a function raises 42P13 and aborts the whole migration.
--   4. What is the current legacy queue backlog, so the RUNME's effect on it
--      can be judged afterwards (the answer must be: none — the hub does not
--      touch email_deliveries).
--
-- §5 additionally baselines ANONYMOUS EXPOSURE across every privilege type, on
-- tables AND on sequences, and proves the probe is not vacuous. The RUNME takes
-- anon/PUBLIC direct table access to ZERO — including the four CRUD verbs an
-- earlier pass left in place — so this baseline is what that change is measured
-- against. §5d names the single anonymous caller that must survive it.
--
-- §8 is the PRIVILEGE MAP: for anon, PUBLIC and authenticated, across all seven
-- privilege types, at TABLE *and* COLUMN granularity, reporting DIRECT and
-- INHERITED separately. §8b proves, from the code, exactly what
-- public.notification_preferences needs — the previous version of §8 could not
-- see a column-level grant at all, and a guard built on the same blind probe is
-- what aborted the last run. §8c asks whether any user is missing a preference
-- row (the first-use question), §8d prints the row-isolation policies.
--
-- Nothing here is fatal. Read the NOTICEs, then run the RUNME.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) EXISTING MACHINERY THE HUB COMPOSES OVER ────────────────────────────
select 'existing_object' as check_kind, obj as name,
       case when present then 'PRESENT' else 'ABSENT — hub feature-detects and degrades' end as state
from (
  select 'table public.notifications'              as obj, to_regclass('public.notifications')              is not null as present
  union all select 'table public.notification_preferences',  to_regclass('public.notification_preferences')  is not null
  union all select 'table public.notification_events',       to_regclass('public.notification_events')       is not null
  union all select 'table public.email_deliveries',          to_regclass('public.email_deliveries')          is not null
  union all select 'table public.notification_delivery_log', to_regclass('public.notification_delivery_log') is not null
  union all select 'table public.profiles',                  to_regclass('public.profiles')                  is not null
  union all select 'table public.project_members',           to_regclass('public.project_members')           is not null
  union all select 'fn notification_resolve_recipients',
         to_regprocedure('public.notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)') is not null
  union all select 'fn notification_dispatch_portal',
         to_regprocedure('public.notification_dispatch_portal(text,text,uuid,uuid,uuid,text,text,text,jsonb)') is not null
  union all select 'fn notify_emit_event',
         to_regprocedure('public.notify_emit_event(text,text,uuid,uuid,uuid,text,text,jsonb,uuid)') is not null
  union all select 'fn notification_trace',        to_regprocedure('public.notification_trace(jsonb)') is not null
  union all select 'fn is_owner',                  to_regprocedure('public.is_owner()')  is not null
  union all select 'fn staff_role',                to_regprocedure('public.staff_role()') is not null
) t
order by 2;

-- ─── 2) COLLISIONS: anything already called comms_* ─────────────────────────
select 'existing_comms_relation' as check_kind, c.relname as name,
       case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview'
                      when 'i' then 'index' when 'S' then 'sequence' else c.relkind::text end as state
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'comms\_%'
order by 2;

select 'existing_comms_function' as check_kind,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
       pg_get_function_result(p.oid) as state
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'comms\_%'
order by 2;

-- ─── 3) 42P13 TRAP: a comms_* function whose RETURN TYPE would change ───────
-- `create or replace function` CANNOT change a return type. If any row appears
-- here, DROP that exact function before running the RUNME, or the migration
-- aborts mid-way. This cost two production cycles on an earlier batch.
do $preflight_42p13$
declare r record; v_n int := 0;
begin
  for r in
    select p.proname as fname,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'comms\_%'
  loop
    v_n := v_n + 1;
    raise notice '42P13 CHECK — public.%(%) returns % · compare with the RUNME before running it', r.fname, r.args, r.ret;
  end loop;
  if v_n = 0 then
    raise notice '42P13 CHECK — no pre-existing comms_* function. Clean install.';
  end if;
end $preflight_42p13$;

-- ─── 4) LEGACY QUEUE BASELINE (the RUNME must not change any of these) ──────
do $preflight_baseline$
declare v_txt text := 'email_deliveries ABSENT';
begin
  if to_regclass('public.email_deliveries') is not null then
    execute $q$
      select 'email_deliveries · ' || coalesce(string_agg(status || '=' || n::text, ', ' order by status), 'empty')
      from (select status, count(*) as n from public.email_deliveries group by status) s
    $q$ into v_txt;
  end if;
  raise notice 'LEGACY BASELINE — %', v_txt;
  raise notice 'LEGACY BASELINE — the hub NEVER writes to email_deliveries. Re-run this block after the RUNME; the numbers must be identical.';
end $preflight_baseline$;

-- ─── 5) ANON EXPOSURE BASELINE — ALL PRIVILEGE TYPES, NOT JUST CRUD ────────
-- No filter on privilege_type on purpose. A check that looks only for SELECT /
-- INSERT / UPDATE / DELETE is a denylist of four verbs wearing an allowlist's
-- name, and it is exactly why REFERENCES / TRIGGER / TRUNCATE sat unnoticed on
-- the legacy notification tables. TRUNCATE in particular is not restricted by
-- row level security at all.
select 'anon_grant_on_notification_object' as check_kind,
       table_schema || '.' || table_name as name, privilege_type as state
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','PUBLIC')
  and (table_name like 'comms\_%' or table_name in
       ('notifications','notification_preferences','notification_events',
        'email_deliveries','notification_delivery_log'))
order by 2, 3;

-- ─── 5b) THE SAME QUESTION FOR SEQUENCES ───────────────────────────────────
-- `revoke all on table` does NOT reach a sequence, and a sequence carries its
-- own USAGE / SELECT / UPDATE privileges. comms_audit.id is
-- `bigint generated always as identity`, so at least one sequence exists here.
-- A cleanup that reports "no table privileges" while anon still holds USAGE on
-- the owned sequence has not finished the job.
select 'anon_grant_on_notification_sequence' as check_kind,
       u.object_schema || '.' || u.object_name as name,
       u.grantee || ' ' || u.privilege_type as state
from information_schema.usage_privileges u
where u.object_schema = 'public' and u.object_type = 'SEQUENCE'
  and u.grantee in ('anon','PUBLIC')
  and exists (
    select 1
      from pg_class s
      join pg_namespace sn on sn.oid = s.relnamespace
      join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
      join pg_class tb on tb.oid = d.refobjid
     where s.relkind = 'S' and sn.nspname = 'public'
       and s.relname::text = u.object_name::text
       and d.deptype in ('a','i')
       and (tb.relname::text like 'comms\_%'
         or tb.relname::text in ('notifications','notification_events',
                                 'notification_preferences','notification_delivery_log',
                                 'email_deliveries')))
order by 2, 3;

-- ─── 5c) PROVE THE PROBE IS NOT BLIND (non-vacuity) ─────────────────────────
-- §5 and §5b are "expect zero rows" checks. A zero-row result proves nothing if
-- the catalogue query itself is wrong — a typo'd grantee name, an unsupported
-- view — because a broken query also returns zero. anon legitimately holds
-- privileges on OTHER public tables in this database, so the count below must be
-- greater than zero. If it is zero, §5 is vacuous and must be fixed, not trusted.
do $preflight_nonvacuity$
declare v_any bigint; v_types text;
begin
  select count(*) into v_any
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC');
  select string_agg(distinct privilege_type, ', ' order by privilege_type) into v_types
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon','PUBLIC');
  if v_any = 0 then
    raise notice 'NON-VACUITY — ⚠️ anon/PUBLIC hold NOTHING anywhere in public. §5 cannot distinguish "clean" from "blind". Verify the probe before trusting it.';
  else
    raise notice 'NON-VACUITY — the probe sees % anon/PUBLIC grant(s) elsewhere in public, across types: %. §5 is therefore a real observation.', v_any, v_types;
  end if;
end $preflight_nonvacuity$;

-- ─── 5d) THE DEPENDENCY THIS PHASE IS ABOUT: IS THERE AN ANONYMOUS CALLER? ──
-- The RUNME revokes ALL anon table privileges, including SELECT/INSERT/UPDATE/
-- DELETE that an earlier pass deliberately left behind. That is only safe if no
-- anonymous caller uses them. Proven in the repo, restated here so the operator
-- can see the dependency before running anything:
--   • no browser module reads or writes these tables directly (zero .from(...)
--     hits in app/, lib/, components/);
--   • every server route uses lib/server/supabaseAdmin (service_role or a user
--     JWT) — including app/api/cron/notify-email, which is rpcAsService only;
--   • the one anonymous entry point, submit_opportunity_request, is SECURITY
--     DEFINER and needs no table grant.
-- The block below checks the LIVE database for the piece that must be true after
-- the migration: that RPC must exist and keep its anon EXECUTE.
do $preflight_public_caller$
declare v_oid oid;
begin
  v_oid := to_regprocedure('public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean)');
  if v_oid is null then
    raise notice 'PUBLIC CALLER — submit_opportunity_request is ABSENT on this database. Nothing anonymous reaches the notification tables.';
    return;
  end if;
  raise notice 'PUBLIC CALLER — submit_opportunity_request present · SECURITY DEFINER = % · anon EXECUTE = % · pinned search_path = %',
    (select prosecdef from pg_proc where oid = v_oid),
    has_function_privilege('anon', v_oid, 'EXECUTE'),
    (select coalesce(array_to_string(proconfig, ','), '') ilike '%search_path%' from pg_proc where oid = v_oid);
  raise notice 'PUBLIC CALLER — all three must still read true in the POSTCHECK. The RUNME revokes TABLE privileges only; it never touches this FUNCTION grant.';
end $preflight_public_caller$;

-- ─── 6) PROVENANCE COLUMNS — only relevant if comms_outbox already exists ───
-- The RUNME adds source_kind / is_legacy_mirror / delivery_mode / provider_state
-- and backfills them. If the table is already there WITHOUT them, that backfill
-- is the interesting part of the run; if the table is absent this is a clean
-- install and there is nothing to migrate.
do $preflight_provenance$
declare v_missing text; v_rows bigint;
begin
  if to_regclass('public.comms_outbox') is null then
    raise notice 'PROVENANCE — comms_outbox absent. Clean install; nothing to backfill.';
    return;
  end if;
  execute 'select count(*) from public.comms_outbox' into v_rows;
  select string_agg(c, ', ') into v_missing
    from unnest(array['source_kind','is_legacy_mirror','delivery_mode','provider_state']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'comms_outbox'
                        and column_name = c);
  if v_missing is null then
    raise notice 'PROVENANCE — all four columns already present on comms_outbox (% row(s)).', v_rows;
  else
    raise notice 'PROVENANCE — comms_outbox has % row(s); the RUNME will add and backfill: %', v_rows, v_missing;
  end if;
end $preflight_provenance$;

-- ─── 7) FORGED-SUCCESS BASELINE ────────────────────────────────────────────
-- If comms_outbox already exists, how many rows would TODAY be reported as a
-- live send purely because of the free-text provider string? Compare with the
-- POSTCHECK, which counts on explicit provenance instead.
do $preflight_forged$
declare v_txt text;
begin
  if to_regclass('public.comms_outbox') is null then
    raise notice 'FORGED-SUCCESS BASELINE — comms_outbox absent; nothing can be miscounted yet.';
    return;
  end if;
  execute $q$
    select 'claims sent/delivered and not dry_run = ' ||
           count(*) filter (where status in ('sent','delivered') and not dry_run) ||
           ' · of which tagged legacy_email_deliveries = ' ||
           count(*) filter (where status in ('sent','delivered') and not dry_run
                              and coalesce(provider,'') = 'legacy_email_deliveries')
      from public.comms_outbox $q$ into v_txt;
  raise notice 'FORGED-SUCCESS BASELINE — %', v_txt;
end $preflight_forged$;

-- ─── 8) ★ THE FULL PRIVILEGE MAP: DIRECT vs INHERITED, TABLE vs COLUMN ★ ────
-- §13.b of the RUNME revokes EVERY table privilege from anon AND from PUBLIC on
-- the five legacy notification tables. `authenticated` is a MEMBER of PUBLIC,
-- so that revoke is only safe if authenticated holds its OWN direct grant.
--
-- ══ WHY THIS SECTION WAS REWRITTEN ══
-- Its previous version measured only two things: has_table_privilege() and
-- information_schema.role_table_grants. BOTH ARE TABLE-LEVEL ONLY. A privilege
-- granted on individual COLUMNS is invisible to both, and
-- docs/phase0_migration.sql:781 grants exactly that:
--     grant update (portal_enabled, email_enabled, whatsapp_enabled)
--       on public.notification_preferences to authenticated;
-- So the old §8 reported UPDATE on notification_preferences as simply not held —
-- neither DIRECT nor VIA PUBLIC — and the RUNME's guard, built on the same blind
-- probe, then aborted the migration claiming a revoke had "stripped" a privilege
-- that had never been table-level in the first place.
--
-- The map below therefore reports FOUR states, per role, per table, per
-- privilege type, and it does not stop at the table:
--     DIRECT · table-level        — granted straight to the role. A revoke from
--                                   PUBLIC cannot touch it.
--     DIRECT · column-level       — granted on named columns. THIS IS THE STATE
--                                   THAT WAS INVISIBLE BEFORE.
--     INHERITED                   — effective, but not a direct grant: it comes
--                                   from PUBLIC or a group role, and a revoke
--                                   from PUBLIC WOULD remove it.
--     absent                      — not held at all, at either granularity.
-- Read from the ACLs themselves (pg_class.relacl, pg_attribute.attacl) rather
-- than from information_schema, which shows only table-level grants and only for
-- roles the current session happens to have enabled. In an ACL, grantee 0 is
-- literally PUBLIC, which is how PUBLIC gets a column in this report at all.
--
-- Every row for public.notification_preferences is printed even when the answer
-- is "absent", because that is the table whose contract the RUNME asserts; for
-- the other tables only the states that actually exist are listed.
select 'privilege_map' as check_kind,
       g.role || ' · public.' || g.tbl || ' · ' || g.priv as name,
       g.state
from (
  select r.role, t.tbl, p.priv,
         case
           when x.direct_tbl        then 'DIRECT · table-level'
           when x.direct_cols is not null
                                    then 'DIRECT · column-level (' || x.direct_cols || ')'
           when x.eff_tbl           then 'INHERITED · effective but NOT direct — revoking PUBLIC removes it'
           when x.eff_col           then 'INHERITED · column-level, effective but NOT direct'
           else 'absent'
         end as state
  from (values ('anon'), ('authenticated'), ('PUBLIC')) r(role)
  -- Driven off the catalogue, so a table that does not exist never reaches the
  -- privilege functions (which raise rather than return null on a bad name).
  cross join (
    select c.relname::text as tbl, c.oid as reloid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
       and c.relname::text in ('notifications','notification_events','notification_preferences',
                               'notification_delivery_log','email_deliveries')
  ) t
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
  cross join lateral (
    select
      exists (
        select 1 from pg_class c
        cross join lateral aclexplode(c.relacl) a
         where c.oid = t.reloid and a.privilege_type = p.priv
           and a.grantee = case when r.role = 'PUBLIC' then 0::oid else to_regrole(r.role)::oid end
      ) as direct_tbl,
      (
        select string_agg(at.attname, '+' order by at.attnum)
          from pg_attribute at
          cross join lateral aclexplode(at.attacl) a
         where at.attrelid = t.reloid and at.attnum > 0 and not at.attisdropped
           and a.privilege_type = p.priv
           and a.grantee = case when r.role = 'PUBLIC' then 0::oid else to_regrole(r.role)::oid end
      ) as direct_cols,
      case when r.role = 'PUBLIC' or to_regrole(r.role) is null then false
           else has_table_privilege(r.role::name, t.reloid, p.priv::text) end as eff_tbl,
      -- Only these four types can be granted per column in PostgreSQL; passing
      -- any other type to the column functions raises an error.
      case when r.role = 'PUBLIC' or to_regrole(r.role) is null
             or p.priv not in ('SELECT','INSERT','UPDATE','REFERENCES') then false
           else has_any_column_privilege(r.role::name, t.reloid, p.priv::text) end as eff_col
  ) x
) g
where g.tbl = 'notification_preferences' or g.state <> 'absent'
order by g.tbl, g.role, g.priv;

-- ─── 8b) WHAT notification_preferences ACTUALLY NEEDS, PROVEN FROM THE CODE ──
-- Not from the error message the failed run printed — that message named only
-- SELECT and UPDATE and was itself derived from the wrong probe. This is the
-- complete list of readers and writers in the working tree:
--
--   lib/portal/account.ts:32   pget  'notification_preferences?user_id=eq.<uid>&select=*'
--        → PostgREST GET carrying `Bearer <session.access_token>`
--          (lib/portal/client.ts:121) → runs as `authenticated`
--          → needs a REAL table SELECT covering every column, because select=*.
--   lib/portal/account.ts:42   ppatch 'notification_preferences?user_id=eq.<uid>'
--        with Partial<portal_enabled | email_enabled | whatsapp_enabled>
--        → PostgREST PATCH, same identity, sent with `Prefer: return=representation`
--          (lib/portal/client.ts:131) → needs UPDATE on exactly those three
--          columns AND SELECT to return the updated row.
--   components/portal/ProfileSettings.tsx:47 and :75 — the only UI on this path.
--   public.notify()            (phase0_migration.sql:95)  — SECURITY DEFINER
--   public.handle_new_user()   (phase0_migration.sql:515) — SECURITY DEFINER
--   project_core email helpers (project_core_ABSOLUTE_FINAL_RUNME.sql:2024,2048)
--        → all three run as the function OWNER and need NO grant on this table.
--
-- THEREFORE, and each of these was checked rather than assumed:
--   • INSERT is NOT needed. The preference centre does NOT create a row on first
--     use: updateMyPrefs issues a PATCH, never a POST. The row is created at
--     signup by the SECURITY DEFINER trigger handle_new_user()
--     (phase0_migration.sql:515,519) and backfilled for accounts that predate
--     Phase 0 (phase0_migration.sql:127). There is also no INSERT policy on the
--     table, so an INSERT grant would be dead privilege that no test could catch
--     going wrong. §8c below reports whether any user is actually missing a row.
--   • DELETE is NOT needed — no code path deletes, and Phase 0 grants no delete
--     anywhere in the portal by design.
--   • No SEQUENCE is involved: the primary key is user_id uuid, not an identity.
--   • No function EXECUTE is involved: this path is PostgREST table access, not
--     an RPC. The hub's OWN preference centre is the separate, finer-grained
--     public.comms_preferences, reached through comms_prefs_get/comms_prefs_set,
--     which ARE SECURITY DEFINER and need no table grant at all.
do $preflight_np_contract$
declare
  v_np constant text := 'public.notification_preferences';
  v_cols constant text[] := array['portal_enabled','email_enabled','whatsapp_enabled'];
  c text;
  v_state text := '';
begin
  if to_regclass(v_np) is null then
    raise notice 'NP CONTRACT — public.notification_preferences does not exist on this database; nothing to prove.';
    return;
  end if;

  -- Table-level SELECT: the literal probe, so the reading is unambiguous.
  raise notice 'NP CONTRACT — the caller whose breakage is being ruled out is lib/portal/account.ts:32 (read) and '
               'lib/portal/account.ts:42 (write), reached from components/portal/ProfileSettings.tsx. Both go '
               'through PostgREST with a user JWT, so both execute as `authenticated`.';
  raise notice 'NP CONTRACT — required SELECT (table, every column, for select=* and for return=representation): effective = %',
               has_table_privilege('authenticated', v_np, 'SELECT');
  foreach c in array v_cols loop
    v_state := v_state || ' ' || c || '=' ||
               has_column_privilege('authenticated', v_np, c, 'UPDATE')::text;
  end loop;
  raise notice 'NP CONTRACT — required UPDATE, per column (has_column_privilege, NOT has_table_privilege):%', v_state;
  raise notice 'NP CONTRACT — the same three columns as seen by the TABLE-level probe: has_table_privilege(UPDATE) = % '
               '· has_any_column_privilege(UPDATE) = %',
               has_table_privilege('authenticated', v_np, 'UPDATE'),
               has_any_column_privilege('authenticated', v_np, 'UPDATE');
  raise notice 'NP CONTRACT — ⚠️ IF THOSE TWO DISAGREE, that disagreement IS the bug the earlier run hit: the grant '
               'is column-level, and the table-level probe cannot see it.';

  -- Privileges that must NOT be there, so the operator sees the starting drift.
  raise notice 'NP CONTRACT — types that are NOT required (each must read false): %',
               (select string_agg(p || '=' || has_table_privilege('authenticated', v_np, p)::text, ' · ')
                  from unnest(array['INSERT','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p);
  raise notice 'NP CONTRACT — user_id writable by authenticated (must be false; a writable user_id lets one user '
               'hand its row to another): %',
               has_column_privilege('authenticated', v_np, 'user_id', 'UPDATE');

  -- Non-vacuity: prove the probes can actually SEE a privilege, so a row of
  -- `false` is a finding rather than a broken query. public.profiles carries
  -- BOTH kinds — a table-level SELECT and a column-level UPDATE grant
  -- (phase0_migration.sql:768,778) — so one control covers both probes.
  if to_regclass('public.profiles') is null then
    raise notice 'NON-VACUITY — public.profiles absent; no control available for the probes above.';
    return;
  end if;
  raise notice 'NON-VACUITY — control on public.profiles: has_table_privilege(SELECT) = % (expect true) · '
               'has_column_privilege(full_name, UPDATE) = % (expect true) · '
               'has_column_privilege(account_type, UPDATE) = % (expect FALSE — proves the column probe discriminates)',
               has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
               has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
               has_column_privilege('authenticated', 'public.profiles', 'account_type', 'UPDATE');
end $preflight_np_contract$;

-- ─── 8c) IS ANY USER MISSING A PREFERENCE ROW? ─────────────────────────────
-- The reason this matters: updateMyPrefs PATCHes; a PATCH that matches no row
-- succeeds and returns an empty array, so getMyPrefs returns null and
-- ProfileSettings.tsx:136 renders no toggles at all — silently, with no error.
-- If this count is greater than zero, that is a PRE-EXISTING data gap in the
-- signup trigger's coverage. It is NOT fixed by granting INSERT (there is no
-- INSERT policy, so the browser still could not create the row); it is fixed by
-- backfilling, exactly as phase0_migration.sql:127 does. Reported, not changed —
-- this file writes nothing.
do $preflight_np_rows$
declare v_missing bigint;
begin
  if to_regclass('public.notification_preferences') is null then return; end if;
  select count(*) into v_missing
    from auth.users u
   where not exists (select 1 from public.notification_preferences p where p.user_id = u.id);
  if v_missing = 0 then
    raise notice 'NP ROWS — every auth.users row has a preference row. The decision to withhold INSERT is safe.';
  else
    raise notice 'NP ROWS — ⚠️ % user(s) have NO preference row. Their preference toggles render blank today, '
                 'before and after this migration. Backfill with the INSERT ... on conflict do nothing from '
                 'phase0_migration.sql:127. Do NOT open INSERT for authenticated to paper over it.', v_missing;
  end if;
exception when insufficient_privilege then
  raise notice 'NP ROWS — auth.users is not readable from this session; run the count as the postgres role to check it.';
end $preflight_np_rows$;

-- ─── 8d) ROW ISOLATION AS IT STANDS TODAY ──────────────────────────────────
-- A table grant is worth exactly what the policy behind it is worth. These are
-- the policies the RUNME's grant will operate under. What to look for:
--   • USING on the SELECT policy must be keyed on auth.uid(), or every logged-in
--     user reads every other user's preferences.
--   • The UPDATE policy must have a WITH CHECK keyed on auth.uid(). Without one
--     PostgreSQL falls back to USING — which is reported here as such rather
--     than as a hole — and without either, a user rewrites someone else's row.
select 'notification_preferences_policy' as check_kind,
       p.polname || ' · ' ||
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                     when 'd' then 'DELETE' else 'ALL' end ||
       case when p.polpermissive then '' else ' (restrictive)' end as name,
       'USING ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '(none)') ||
       '  ·  WITH CHECK ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid),
                                      '(none — PostgreSQL falls back to USING)') as state
from pg_policy p
where p.polrelid = to_regclass('public.notification_preferences')
order by p.polname;

select 'notification_preferences_rls' as check_kind,
       'row level security enabled' as name,
       case when c.relrowsecurity then 'YES' else 'NO — a table privilege here would expose every row' end as state
from pg_class c
where c.oid = to_regclass('public.notification_preferences');

do $preflight_done$
begin
  raise notice 'PREFLIGHT COMPLETE — read-only. Nothing was changed. Next: docs/communications_hub_RUNME.sql';
end $preflight_done$;
