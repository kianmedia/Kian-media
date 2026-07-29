-- ════════════════════════════════════════════════════════════════════════════
-- project_editor_permissions_DIAGNOSTIC.sql        (READ-ONLY — لا يكتب شيئًا)
--
-- الغرض: تقرير كامل عن صلاحيات مستخدم واحد على منصّة المشاريع — مِهَنه،
--        استثناءاته، صلاحياته الفعّالة، **مصدر كل منحة**، والعمليات الحسّاسة
--        التي يستطيع تنفيذها فعليًّا اليوم.
--
-- Purpose: full, evidence-grade report on ONE user's project-platform authority —
--          professions, overrides, effective permissions, the SOURCE of every
--          grant, and which sensitive operations they can perform right now.
--
-- ─── SAFETY CONTRACT ────────────────────────────────────────────────────────
--   • SELECT statements only. No CREATE / ALTER / INSERT / UPDATE / DELETE /
--     GRANT / REVOKE / DO / TRUNCATE / temp objects. Safe on production.
--   • Prints identifiers, roles, profession keys and permission keys ONLY.
--     No e-mail, no full name, no phone, no token, no password, no secret.
--   • Nothing here depends on the caller's own session rights, and nothing here
--     grants, changes or reveals anything the owner cannot already read.
--
-- ─── HOW TO RUN ─────────────────────────────────────────────────────────────
--   1) Replace EVERY occurrence of the placeholder below with the target user id.
--      One find-and-replace over the whole file does it (8 live occurrences; the
--      one on the next line is this instruction and is harmless either way):
--        00000000-0000-0000-0000-000000000000
--   2) Run section 0 first. It tells you which later sections are applicable.
--      Sections whose objects are missing WILL error — skip them, that is the
--      signal, not a failure of the diagnostic.
--   3) Sections run independently and in any order.
--
-- ─── WHY THIS RECOMPUTES INSTEAD OF CALLING THE LIVE PREDICATES ─────────────
--   ★ Do NOT "simplify" this file by calling public.emp_has_permission(user,key),
--     public.can_edit_project(project) or public.is_kian_member(project) here.
--     Every one of those resolves against auth.uid(). In the SQL editor / psql
--     auth.uid() is NULL, so:
--       · emp_has_permission(<other user>, key) returns FALSE ALWAYS — it refuses
--         cross-user probes unless the CALLER is owner/admin/manager
--         (docs/permission_catalog_RUNME.sql:216).
--       · can_edit_project / is_kian_member would answer for the CALLER, not for
--         the target user.
--     A diagnostic that silently answers "no permissions" for every user is worse
--     than no diagnostic. So sections 2, 3, 6 and 8 REPLICATE the deployed
--     resolution logic against the base tables, and each result column names the
--     exact function it mirrors. If a predicate is ever changed, this file must
--     be re-verified against it.
--
-- ─── COMPANION DOCUMENTS ────────────────────────────────────────────────────
--   docs/PROJECT_EDITOR_PERMISSION_AUDIT.md   — findings with file:line
--   docs/PROJECT_ROLE_PERMISSION_MATRIX.md    — role × capability matrix
--   docs/project_editor_permissions_PREFLIGHT.sql — pre-change state proof
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ 0) PREFLIGHT — which objects exist here? Run this FIRST ════════════════
-- Any object reported false means the section that needs it must be skipped.
select 'table'    as kind, o.name, (to_regclass(o.name) is not null) as exists_now
from (values ('public.profiles'), ('public.project_members'), ('public.projects'),
             ('public.professions'), ('public.employee_professions'),
             ('public.permissions'), ('public.profession_permissions'),
             ('public.employee_permission_overrides'), ('public.clients'),
             ('public.deliverables')) o(name)
union all
select 'function', f.sig, (to_regprocedure(f.sig) is not null)
from (values ('public.is_admin()'), ('public.is_owner()'), ('public.staff_role()'),
             ('public.project_role(uuid)'), ('public.is_kian_member(uuid)'),
             ('public.is_client_side(uuid)'), ('public.can_manage_projects()'),
             ('public.can_edit_project(uuid)'), ('public.can_final_deliver()'),
             ('public.emp_has_permission(uuid,text)'),
             ('public.project_units_can_write(uuid)'),
             ('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'),
             ('public.pc_member_add(uuid,uuid,text)'),
             ('public.pc_member_remove(uuid,uuid)'),
             ('public.project_core_set_stage(uuid,text,text)'),
             ('public.import_can_manage()')) f(sig)
order by kind, name;


-- ═══ 1) IDENTITY — the three axes for this user ═════════════════════════════
-- account_type = identity · staff_role = staff tier · memberships = section 3.
-- No name / e-mail is selected, by design.
select p.id                                            as user_id,
       p.account_type,
       p.account_status,
       coalesce(p.staff_role, '(none)')                as staff_role,
       (p.account_type = 'admin'
        and p.account_status = 'active')               as mirrors_is_admin,
       exists (select 1 from public.clients c
                where c.user_id = p.id and c.is_deleted = false)
                                                       as is_a_client_account
from public.profiles p
where p.id = '00000000-0000-0000-0000-000000000000'::uuid;


-- ═══ 2) GLOBAL PREDICATES — recomputed for this user ════════════════════════
-- Each column names the deployed function it mirrors. See the header note on
-- why these are recomputed rather than called.
-- Every column is coalesce'd to false on purpose: a NULL staff_role must read as
-- "no", never as an empty cell. (This file is about NULL fail-open; it will not
-- commit the same sin in its own output.)
select p.id as user_id,
       coalesce(p.account_type = 'admin' and p.account_status = 'active', false)    as is_admin,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role = 'super_admin'), false)
                                                                                    as is_owner,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role is not null), false)
                                                                                    as is_staff,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role in ('super_admin','manager')), false)
                                                                                    as can_manage_projects,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role in ('super_admin','manager')), false)
                                                                                    as can_final_deliver,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role in ('super_admin','manager','sales')), false)
                                                                                    as can_see_financials,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role in ('super_admin','manager','support','readonly')), false)
                                                                                    as staff_reads_all_projects,
       coalesce((p.account_type = 'admin' and p.account_status = 'active')
                or (p.account_status = 'active' and p.staff_role = 'super_admin'), false)
                                                                                    as can_manage_staff
from public.profiles p
where p.id = '00000000-0000-0000-0000-000000000000'::uuid;


-- ═══ 3) PROJECT MEMBERSHIPS — the per-project grant surface ═════════════════
-- write_gate_project_units_can_write mirrors the ROOT-CAUSE predicate:
--   is_admin OR can_manage_projects OR is_kian_member  (any kian_* role).
-- Read the kian_viewer / kian_photographer rows carefully — a `true` there is
-- the finding, not a formality.
select m.project_id,
       m.role                                            as project_role,
       coalesce(m.is_deleted, false)                     as membership_deleted,
       (m.role like 'kian\_%')                           as counts_as_is_kian_member,
       (m.role like 'client\_%')                         as counts_as_client_side,
       -- mirrors public.can_edit_project(project)
       coalesce((select pr.staff_role from public.profiles pr
                  where pr.id = m.user_id and pr.account_status = 'active') = 'editor'
                and m.role = 'kian_editor', false)       as mirrors_can_edit_project,
       -- mirrors public.project_units_can_write(project)  ← the bulk-update gate
       coalesce((select coalesce((pr.account_type = 'admin' and pr.account_status = 'active')
                                 or (pr.account_status = 'active'
                                     and pr.staff_role in ('super_admin','manager')), false)
                   from public.profiles pr where pr.id = m.user_id)
                or m.role like 'kian\_%', false)         as mirrors_project_units_can_write
from public.project_members m
where m.user_id = '00000000-0000-0000-0000-000000000000'::uuid
order by counts_as_is_kian_member desc, m.role, m.project_id;


-- ═══ 4) PROFESSIONS assigned to this user ══════════════════════════════════
-- Includes the four legacy capability flags, which still feed emp_can().
select pr.key                as profession_key,
       pr.name_ar,
       pr.is_active,
       ep.is_primary,
       pr.perm_view_all_tasks,
       pr.perm_manage_preproduction,
       pr.perm_manage_shoots,
       pr.perm_manage_custody
from public.employee_professions ep
join public.professions pr on pr.id = ep.profession_id
where ep.profile_id = '00000000-0000-0000-0000-000000000000'::uuid
order by ep.is_primary desc, pr.key;


-- ═══ 5) PER-USER OVERRIDES (explicit allow / deny) ═════════════════════════
-- `deny` beats everything; `allow` beats the profession union.
-- The reason text is NOT printed (it can contain free-form personal notes);
-- only whether one was recorded.
select p.key                          as permission_key,
       p.category,
       p.sensitivity,
       o.effect,
       (nullif(btrim(coalesce(o.reason,'')),'') is not null) as reason_recorded,
       o.created_at
from public.employee_permission_overrides o
join public.permissions p on p.id = o.permission_id
where o.user_id = '00000000-0000-0000-0000-000000000000'::uuid
order by o.effect, p.category, p.key;


-- ═══ 6) EFFECTIVE PERMISSIONS + THE SOURCE OF EACH GRANT ═══════════════════
-- Mirrors public.emp_has_permission(user,key) exactly:
--   disabled / system_only  → never
--   override 'deny'         → denied  (wins over everything)
--   override 'allow'        → granted
--   otherwise               → union of ACTIVE assigned professions that grant it
-- `grant_source` is the answer to "why does this user have this?".
with t as (select '00000000-0000-0000-0000-000000000000'::uuid as uid),
ov as (
  select p.key, o.effect
  from public.employee_permission_overrides o
  join public.permissions p on p.id = o.permission_id
  cross join t
  where o.user_id = t.uid
),
prof as (
  select p.key, string_agg(distinct pr.key, ', ' order by pr.key) as via_professions
  from public.profession_permissions pp
  join public.permissions p            on p.id  = pp.permission_id
  join public.employee_professions ep  on ep.profession_id = pp.profession_id
  join public.professions pr           on pr.id = ep.profession_id and pr.is_active
  cross join t
  where ep.profile_id = t.uid and pp.granted
  group by p.key
)
select p.key                              as permission_key,
       p.category,
       p.sensitivity,
       case
         when not p.enabled                          then false
         when p.sensitivity = 'system_only'          then false
         when (select effect from ov where ov.key = p.key) = 'deny'  then false
         when (select effect from ov where ov.key = p.key) = 'allow' then true
         when exists (select 1 from prof where prof.key = p.key)     then true
         else false
       end                                as effective,
       case
         when not p.enabled                          then 'blocked: permission disabled'
         when p.sensitivity = 'system_only'          then 'blocked: system_only (never via this engine)'
         when (select effect from ov where ov.key = p.key) = 'deny'  then 'blocked: per-user DENY override'
         when (select effect from ov where ov.key = p.key) = 'allow' then 'granted: per-user ALLOW override'
         when exists (select 1 from prof where prof.key = p.key)
           then 'granted: profession(s) → ' || (select via_professions from prof where prof.key = p.key)
         else 'not granted'
       end                                as grant_source
from public.permissions p
order by (case when (select effect from ov where ov.key = p.key) = 'deny' then 2
               when not p.enabled or p.sensitivity = 'system_only' then 3
               when (select effect from ov where ov.key = p.key) = 'allow' then 0
               when exists (select 1 from prof where prof.key = p.key) then 0
               else 1 end),
         p.category, p.key;


-- ═══ 7) HONESTY CHECK — permission keys that DECIDE NOTHING ════════════════
-- These keys exist in the catalog and appear in the permissions UI, but no
-- deployed gate reads them: the real gate for deliverable stage / status /
-- client-visibility is project_units_can_write (any kian_* member).
-- Toggling any key listed here changes NOTHING for this or any user.
-- (Audit finding F-12. Re-verify with a repo grep before trusting a change.)
select p.key                              as permission_key,
       p.sensitivity,
       'DECORATIVE — no enforcement call site in the deployed SQL' as enforcement_status
from public.permissions p
where p.key in ('deliverables.view_assigned','deliverables.view_versions',
                'deliverables.upload_preview','deliverables.create_version',
                'deliverables.view_client_comments','deliverables.reply_to_client',
                'deliverables.assign_comment','deliverables.mark_comment_in_progress',
                'deliverables.resolve_comment','deliverables.reopen_comment',
                'deliverables.upload_revision','deliverables.send_internal_review',
                'deliverables.send_client_review','deliverables.internal_approve',
                'deliverables.mark_final','deliverables.download_internal_files')
order by p.key;


-- ═══ 8) SENSITIVE OPERATIONS — what this user can do RIGHT NOW ═════════════
-- One row per sensitive operation. `allowed` is the recomputed server answer;
-- `granted_by` names the branch that grants it; `deciding_gate` names the
-- deployed function/policy so the answer can be checked at source.
with t as (select '00000000-0000-0000-0000-000000000000'::uuid as uid),
me as (   -- every flag coalesce'd to false: a NULL staff_role must read as "no"
  select p.id,
         coalesce(p.account_type = 'admin' and p.account_status = 'active', false)        as is_admin,
         coalesce(p.account_status = 'active' and p.staff_role = 'super_admin', false)    as is_super,
         coalesce(p.account_status = 'active' and p.staff_role = 'manager', false)        as is_manager,
         coalesce(p.account_status = 'active' and p.staff_role = 'editor', false)         as is_editor_tier,
         p.staff_role
  from public.profiles p cross join t where p.id = t.uid
),
mgr as (select (is_admin or is_super or is_manager) as can_manage, * from me),
mem as (
  select count(*) filter (where m.role like 'kian\_%'  and coalesce(m.is_deleted,false)=false) as kian_any,
         count(*) filter (where m.role = 'kian_editor' and coalesce(m.is_deleted,false)=false) as kian_editor,
         count(*) filter (where m.role = 'kian_viewer' and coalesce(m.is_deleted,false)=false) as kian_viewer,
         count(*) filter (where m.role like 'client\_%'and coalesce(m.is_deleted,false)=false) as client_any
  from public.project_members m cross join t where m.user_id = t.uid
),
eff as (   -- effective permission keys, same logic as section 6
  select p.key from public.permissions p cross join t
  where p.enabled and p.sensitivity <> 'system_only'
    and not exists (select 1 from public.employee_permission_overrides o
                     where o.user_id = t.uid and o.permission_id = p.id and o.effect = 'deny')
    and ( exists (select 1 from public.employee_permission_overrides o
                   where o.user_id = t.uid and o.permission_id = p.id and o.effect = 'allow')
       or exists (select 1 from public.profession_permissions pp
                  join public.employee_professions ep on ep.profession_id = pp.profession_id
                  join public.professions pr on pr.id = ep.profession_id and pr.is_active
                  where ep.profile_id = t.uid and pp.permission_id = p.id and pp.granted) )
)
select x.operation, x.allowed, x.granted_by, x.deciding_gate
from mgr, mem,
lateral (values
  ('Move a deliverable between stages (bulk stage_id)',
     (mgr.can_manage or mem.kian_any > 0),
     case when mgr.can_manage then 'can_manage_projects'
          when mem.kian_any > 0 then 'is_kian_member on '||mem.kian_any||' project(s)'
          else 'none' end,
     'project_units_can_write → large_project_deliverables_bulk_update'),
  ('Change deliverable status incl. approved (bulk status)',
     (mgr.can_manage or mem.kian_any > 0),
     case when mgr.can_manage then 'can_manage_projects'
          when mem.kian_any > 0 then 'is_kian_member on '||mem.kian_any||' project(s)'
          else 'none' end,
     'project_units_can_write → large_project_deliverables_bulk_update'),
  ('Set status final_delivered WITHOUT the final-master checks',
     (mgr.can_manage or mem.kian_any > 0),
     case when mgr.can_manage then 'can_manage_projects'
          when mem.kian_any > 0 then 'is_kian_member on '||mem.kian_any||' project(s)'
          else 'none' end,
     'project_units_can_write (bypasses admin_set_final_version)'),
  ('Reveal a deliverable to the client (bulk client_visible)',
     (mgr.can_manage or mem.kian_any > 0),
     case when mgr.can_manage then 'can_manage_projects'
          when mem.kian_any > 0 then 'is_kian_member on '||mem.kian_any||' project(s)'
          else 'none' end,
     'project_units_can_write → large_project_deliverables_bulk_update'),
  ('Set the FINAL version / final master (hardened path)',
     (mgr.is_admin or mgr.can_manage),
     case when mgr.is_admin then 'is_admin' when mgr.can_manage then 'can_final_deliver' else 'none' end,
     'admin_set_final_version / admin_set_version_final_master'),
  ('Advance the project stage one step forward',
     (mgr.can_manage or (mgr.is_editor_tier and mem.kian_editor > 0)),
     case when mgr.can_manage then 'can_manage_projects'
          when mgr.is_editor_tier and mem.kian_editor > 0 then 'can_edit_project on '||mem.kian_editor||' project(s)'
          else 'none' end,
     'project_core_set_stage'),
  ('Set stage delivered / closed, or move backwards',
     mgr.can_manage, case when mgr.can_manage then 'can_manage_projects' else 'none' end,
     'project_core_set_stage (restricted branch)'),
  ('Add a team member AS kian_manager (any user but self)',
     (mgr.can_manage or (mgr.is_editor_tier and mem.kian_editor > 0)),
     case when mgr.can_manage then 'can_manage_projects'
          when mgr.is_editor_tier and mem.kian_editor > 0 then 'can_edit_project (self-promotion guard does NOT cover others)'
          else 'none' end,
     'pc_member_add'),
  ('Remove the project manager from the team',
     (mgr.can_manage or (mgr.is_editor_tier and mem.kian_editor > 0)),
     case when mgr.can_manage then 'can_manage_projects'
          when mgr.is_editor_tier and mem.kian_editor > 0 then 'can_edit_project (no role protection)'
          else 'none' end,
     'pc_member_remove'),
  ('HARD DELETE risks/meetings/locations/shoots/deps/task-files via PostgREST',
     (mgr.can_manage or (mgr.is_editor_tier and mem.kian_editor > 0)),
     case when mgr.can_manage then 'can_manage_projects'
          when mgr.is_editor_tier and mem.kian_editor > 0 then 'can_edit_project (RLS "for all" + DELETE grant)'
          else 'none' end,
     'project_core_FINAL RLS write policies'),
  ('Bulk IMPORT deliverables from a file',
     mgr.can_manage, case when mgr.can_manage then 'can_manage_projects' else 'none' end,
     'import_can_manage'),
  ('Create an internal deliverable version',
     (mgr.is_admin or mgr.can_manage or mem.kian_any > 0 or mem.client_any > 0),
     case when mgr.is_admin then 'is_admin' when mgr.can_manage then 'staff_reads_all_projects'
          when mem.kian_any > 0 then 'project member (kian)'
          when mem.client_any > 0 then 'project member (CLIENT — finding F-11)'
          else 'none' end,
     'admin_add_deliverable_version'),
  ('Resolve a client / timecode comment',
     (mgr.is_admin or mgr.can_manage or mem.kian_any > 0 or mem.client_any > 0),
     case when mgr.is_admin then 'is_admin' when mgr.can_manage then 'staff_reads_all_projects'
          when mem.kian_any > 0 then 'project member (kian)'
          when mem.client_any > 0 then 'project member (CLIENT — finding F-11)'
          else 'none' end,
     'admin_resolve_note'),
  ('Download the gated FINAL client file',
     mgr.is_admin, case when mgr.is_admin then 'is_admin' else 'none — all staff excluded by design' end,
     'get_deliverable_download'),
  ('Confirm payment / set the release policy',
     mgr.is_admin, case when mgr.is_admin then 'is_admin' else 'none' end,
     'admin_confirm_project_payment / admin_set_release_policy'),
  ('Override the stage-readiness gate (audited path)',
     (mgr.is_admin or mgr.is_super or exists (select 1 from eff where key = 'projects.override_stage_readiness')),
     case when mgr.is_admin or mgr.is_super then 'is_owner'
          when exists (select 1 from eff where key = 'projects.override_stage_readiness')
               then 'permission projects.override_stage_readiness'
          else 'none' end,
     'project_stage_advance'),
  ('Approve a decision / apply a change request / override a stage gate',
     (mgr.can_manage
      or exists (select 1 from eff where key in ('decisions.approve','changes.approve','changes.apply','stage_gates.override'))),
     case when mgr.can_manage then 'can_manage_projects'
          when exists (select 1 from eff where key in ('decisions.approve','changes.approve','changes.apply','stage_gates.override'))
               then 'explicit governance permission'
          else 'none' end,
     'gov_can (sensitive-key branch — reference pattern)'),
  ('Manage staff roles / professions / permissions',
     (mgr.is_admin or mgr.is_super),
     case when mgr.is_admin or mgr.is_super then 'is_owner' else 'none' end,
     'can_manage_staff')
) as x(operation, allowed, granted_by, deciding_gate)
order by x.allowed desc, x.operation;


-- ═══ 9) EXPOSURE SUMMARY — one row, for the incident log ═══════════════════
select t.uid                                   as user_id,
       (select coalesce(staff_role,'(none)') from public.profiles where id = t.uid) as staff_role,
       (select count(*) from public.project_members m
         where m.user_id = t.uid and m.role like 'kian\_%'
           and coalesce(m.is_deleted,false) = false)                                as kian_memberships,
       (select count(*) from public.employee_professions e where e.profile_id = t.uid)
                                                                                    as professions_assigned,
       (select count(*) from public.employee_permission_overrides o
         where o.user_id = t.uid and o.effect = 'allow')                            as allow_overrides,
       (select count(*) from public.employee_permission_overrides o
         where o.user_id = t.uid and o.effect = 'deny')                             as deny_overrides,
       (select count(*) from public.project_members m
         where m.user_id = t.uid and m.role in ('kian_viewer','kian_photographer')
           and coalesce(m.is_deleted,false) = false)                                as write_capable_via_non_editor_roles
from (select '00000000-0000-0000-0000-000000000000'::uuid as uid) t;


-- ═══ 10) GLOBAL CHECKS — not user-specific, but part of the same picture ═══
-- (a) No sensitive project function may be executable by anon.
--     Expected: every anon_can_execute = false. A true here is its own incident.
select f.sig,
       has_function_privilege('anon', f.sig, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_can_execute
from (values
  ('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'),
  ('public.project_units_can_write(uuid)'),
  ('public.project_core_set_stage(uuid,text,text)'),
  ('public.pc_member_add(uuid,uuid,text)'),
  ('public.pc_member_remove(uuid,uuid)'),
  ('public.get_deliverable_download(uuid)')
) f(sig)
where to_regprocedure(f.sig) is not null;

-- (b) The NULL fail-open predicates (audit finding F-10).
--     `likely_returns_null_for_a_stranger = true` means: in PL/pgSQL, a gate
--     written as `if not (<predicate>) then raise exception` NEVER FIRES for a
--     user with no membership row — the call proceeds. In RLS the same NULL
--     denies, so RLS is safe and only the RPC call sites are exposed.
--     This is a HEURISTIC (absence of coalesce in the body). Confirm by reading
--     `definition_head` before acting on it.
select p.proname,
       pg_get_function_result(p.oid)                        as returns,
       (pg_get_functiondef(p.oid) ilike '%coalesce%')       as has_coalesce_guard,
       not (pg_get_functiondef(p.oid) ilike '%coalesce%')   as likely_returns_null_for_a_stranger,
       left(pg_get_functiondef(p.oid), 400)                 as definition_head
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_kian_member','is_client_side','is_client_owner',
                    'can_edit_project','can_manage_projects','project_units_can_write')
order by p.proname;

-- (c) Direct-write policies on the eight tables an editor can hard-delete from.
--     Expected today: cmd='ALL' with can_edit_project in the qual (finding F-09).
select tablename, policyname, cmd,
       (coalesce(qual,'') ilike '%can_edit_project%') as qual_has_can_edit_project
from pg_policies
where schemaname = 'public'
  and tablename in ('project_risks','project_meetings','project_locations',
                    'project_shoot_sessions','project_dependencies','project_tag_map',
                    'project_deliverable_versions','task_files')
order by tablename, policyname;

-- (d) Table-level DELETE grant on the same set (the other half of F-09).
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and privilege_type = 'DELETE'
  and grantee in ('authenticated','anon','PUBLIC','public')
  and table_name in ('project_risks','project_meetings','project_locations',
                     'project_shoot_sessions','project_dependencies','project_tag_map',
                     'project_deliverable_versions','task_files','deliverables','projects')
order by table_name, grantee;

-- ════════════════════════════════════════════════════════════════════════════
-- END. Read-only throughout: every statement above is a SELECT.
-- ════════════════════════════════════════════════════════════════════════════
