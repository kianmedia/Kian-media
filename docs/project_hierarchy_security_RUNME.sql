-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — PROJECT HIERARCHY · BATCH 2: RLS & ACCESS  (RUN ONCE)
--
-- Adds client-visibility control for master/subprojects WITHOUT breaking standalone
-- projects. A client who can reach a MASTER does NOT automatically see its
-- subprojects (requirement #4). Enforcement is SERVER-SIDE / RLS only — a direct
-- link to an unauthorized subproject returns zero rows across every dependent table
-- that gates client access through can_access_project()/is_client_side().
--
-- HOW IT STAYS NON-BREAKING (all 24 existing projects are 'standalone'):
--   The three choke-point helpers (can_access_project, is_client_side,
--   is_client_owner) keep is_admin() + explicit project_role() paths verbatim, and
--   replace ONLY the raw `client_id = my_client_id()` auto-grant with the
--   visibility-aware pc_client_cap(). For a standalone/master (client_visibility
--   'inherit'/'visible'), pc_client_cap() returns exactly what the old clause did,
--   so behaviour is identical. The gate narrows ONLY subprojects.
--
-- CAPABILITY MODEL (pc_client_cap(project, cap)):
--   • active client_project_access grant present  → the grant's flag is authoritative.
--   • else standalone/master (not 'hidden')       → today's defaults (view/comment/
--       download = true; approve = client_owner-or-org; view_financials = false).
--   • else subproject 'visible' (no grant)        → VIEW only; all write caps need a grant.
--   • else (subproject inherit/hidden, or wrong org, no grant) → false.  ← satisfies #4
--
-- Feature flag stays OFF; no master/subproject exists yet, so this is inert on live
-- data and only defines the mechanism. Templates/Clone/Dashboard are NOT in this batch.
--
-- Idempotent · non-destructive · no data deletion · no column rename. Depends on:
-- projects (+ Batch 1 columns), clients, project_members, my_client_id(),
-- project_role(), is_admin(), is_owner(), can_manage_projects(), can_see_financials(),
-- is_staff(), is_kian_member(), log_activity(). Run AFTER project_hierarchy_schema_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects') is null then miss := miss || ' projects'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='project_scope')=0
    then miss := miss || ' projects.project_scope (شغّل Batch 1 أولًا)'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='projects' and column_name='client_visibility')=0
    then miss := miss || ' projects.client_visibility'; end if;
  if to_regprocedure('public.my_client_id()')       is null then miss := miss || ' my_client_id()'; end if;
  if to_regprocedure('public.project_role(uuid)')   is null then miss := miss || ' project_role(uuid)'; end if;
  if to_regprocedure('public.is_admin()')           is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()')is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.can_see_financials()') is null then miss := miss || ' can_see_financials()'; end if;
  if to_regprocedure('public.is_staff()')           is null then miss := miss || ' is_staff()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) جدول منح وصول العميل للمشروع (per-user, per-project) ═══
create table if not exists public.client_project_access (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  can_view            boolean not null default true,
  can_comment         boolean not null default false,
  can_approve         boolean not null default false,
  can_download        boolean not null default false,
  can_view_financials boolean not null default false,
  starts_at           timestamptz,
  expires_at          timestamptz,
  note                text,
  granted_by          uuid references auth.users(id),
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, user_id)
);
create index if not exists idx_cpa_project on public.client_project_access(project_id) where revoked_at is null;
create index if not exists idx_cpa_user    on public.client_project_access(user_id)    where revoked_at is null;

-- ═══ 2) أوراكل القدرات: pc_client_cap(project, cap) — بلا استدعاء ذاتي (لا تعاود) ═══
create or replace function public.pc_client_cap(p_project uuid, p_cap text)
returns boolean language sql stable security definer set search_path = public as $$
  with p as (
    select project_scope, coalesce(client_visibility,'inherit') as cv, client_id, is_deleted
    from public.projects where id = p_project
  ),
  g as (
    select can_view, can_comment, can_approve, can_download, can_view_financials
    from public.client_project_access
    where project_id = p_project and user_id = auth.uid() and revoked_at is null
      and (starts_at is null or starts_at <= now())
      and (expires_at is null or expires_at > now())
    limit 1
  )
  select case
    when coalesce((select is_deleted from p), true) then false
    -- must be this project's client org OR hold an explicit grant
    when (select client_id from p) is distinct from public.my_client_id()
         and not exists (select 1 from g) then false
    -- (a) active grant is authoritative
    when exists (select 1 from g) then case p_cap
        when 'view'            then (select can_view            from g)
        when 'comment'         then (select can_comment         from g)
        when 'approve'         then (select can_approve         from g)
        when 'download'        then (select can_download        from g)
        when 'view_financials' then (select can_view_financials from g)
        else false end
    -- (b) top-level (standalone/master), not hidden → today's default client caps
    when (select project_scope from p) in ('standalone','master') and (select cv from p) <> 'hidden' then case p_cap
        when 'view'            then true
        when 'comment'         then true
        when 'download'        then true
        when 'approve'         then (public.project_role(p_project) = 'client_owner'
                                     or (select client_id from p) = public.my_client_id())
        when 'view_financials' then false
        else false end
    -- (c) subproject explicitly 'visible' (no grant) → VIEW only; write caps need a grant
    when (select project_scope from p) = 'subproject' and (select cv from p) = 'visible' then (p_cap = 'view')
    -- (d) subproject inherit/hidden without a grant → nothing (requirement #4)
    else false
  end;
$$;

-- اختصارات مقروءة للقدرات (تُستعمل في RLS/RPCs لاحقًا).
create or replace function public.pc_client_can_view(p_project uuid)            returns boolean language sql stable security definer set search_path = public as $$ select public.pc_client_cap(p_project,'view'); $$;
create or replace function public.pc_client_can_comment(p_project uuid)         returns boolean language sql stable security definer set search_path = public as $$ select public.pc_client_cap(p_project,'comment'); $$;
create or replace function public.pc_client_can_approve(p_project uuid)         returns boolean language sql stable security definer set search_path = public as $$ select public.pc_client_cap(p_project,'approve'); $$;
create or replace function public.pc_client_can_download(p_project uuid)        returns boolean language sql stable security definer set search_path = public as $$ select public.pc_client_cap(p_project,'download'); $$;
create or replace function public.pc_client_can_view_financials(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.pc_client_cap(p_project,'view_financials'); $$;

-- ═══ 3) إعادة تعريف نقاط الاختناق (تحافظ على المسارات الحالية؛ NO-OP للـstandalone) ═══
-- can_access_project: admin + عضو صريح (كما كان) + مسار العميل الآن مُدرك للرؤية.
create or replace function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.projects p
    where p.id = p_project and p.is_deleted = false
      and (public.project_role(p_project) is not null
           or public.pc_client_cap(p_project, 'view')));
$$;

-- is_client_side: دور عميل صريح، أو رؤية عميل مُدركة (بدل مطابقة client_id الخام).
create or replace function public.is_client_side(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) like 'client\_%'
      or public.pc_client_cap(p_project, 'view');
$$;

-- is_client_owner: دور client_owner صريح، أو قدرة الاعتماد (approve) — يمنع اعتماد
-- مشروع فرعي غير مصرّح به دون منح، ويبقى مطابقًا تمامًا للـstandalone.
create or replace function public.is_client_owner(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) = 'client_owner'
      or public.pc_client_cap(p_project, 'approve');
$$;

-- ═══ 4) RLS + Grants على client_project_access ═══
alter table public.client_project_access enable row level security;
drop policy if exists cpa_read on public.client_project_access;
create policy cpa_read on public.client_project_access for select to authenticated
  using (public.is_admin() or public.is_kian_member(project_id) or user_id = auth.uid());
-- الكتابة عبر RPCs (SECURITY DEFINER) فقط — لا سياسة كتابة.
grant select on public.client_project_access to authenticated;

-- ═══ 5) RPCs الإدارية: منح/سحب الوصول ═══
create or replace function public.admin_grant_client_project_access(p_project uuid, p_user uuid, p_caps jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fin boolean;
begin
  if not (public.is_owner() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.projects where id = p_project and is_deleted = false) then raise exception 'project_not_found'; end if;
  if p_user is null then raise exception 'user_required'; end if;
  -- منح رؤية المالية حسّاس: يتطلب صلاحية مالية أو مالك.
  v_fin := coalesce((p_caps->>'can_view_financials')::boolean, false)
           and (public.is_owner() or public.can_see_financials());
  insert into public.client_project_access(project_id, user_id, can_view, can_comment, can_approve, can_download, can_view_financials,
      starts_at, expires_at, note, granted_by, revoked_at, revoked_by, updated_at)
    values (p_project, p_user,
      coalesce((p_caps->>'can_view')::boolean, true),
      coalesce((p_caps->>'can_comment')::boolean, false),
      coalesce((p_caps->>'can_approve')::boolean, false),
      coalesce((p_caps->>'can_download')::boolean, false),
      v_fin,
      nullif(p_caps->>'starts_at','')::timestamptz, nullif(p_caps->>'expires_at','')::timestamptz,
      nullif(btrim(p_caps->>'note'),''), auth.uid(), null, null, now())
  on conflict (project_id, user_id) do update set
      can_view=excluded.can_view, can_comment=excluded.can_comment, can_approve=excluded.can_approve,
      can_download=excluded.can_download, can_view_financials=excluded.can_view_financials,
      starts_at=excluded.starts_at, expires_at=excluded.expires_at, note=excluded.note,
      granted_by=auth.uid(), revoked_at=null, revoked_by=null, updated_at=now()
  returning id into v_id;
  perform public.log_activity(auth.uid(), 'admin', 'client_project_access.granted', 'project', p_project,
    jsonb_build_object('user', p_user, 'caps', p_caps - 'note'));
  return v_id;
end $$;

create or replace function public.admin_revoke_client_project_access(p_project uuid, p_user uuid, p_reason text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  update public.client_project_access set revoked_at = now(), revoked_by = auth.uid(),
      note = coalesce(nullif(btrim(p_reason),''), note), updated_at = now()
    where project_id = p_project and user_id = p_user and revoked_at is null;
  if not found then raise exception 'grant_not_found'; end if;
  perform public.log_activity(auth.uid(), 'admin', 'client_project_access.revoked', 'project', p_project,
    jsonb_build_object('user', p_user, 'reason', left(coalesce(p_reason,''),500)));
  return true;
end $$;

-- ═══ 6) قراءات: قائمة المنوح لهم (إدارة) + القدرات الفعّالة للمتصل (UI) ═══
create or replace function public.client_project_access_list(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_kian_member(p_project)) then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select a.*, (select full_name from public.profiles where id = a.user_id) as user_name
    from public.client_project_access a where a.project_id = p_project) x), '[]'::jsonb);
end $$;

-- القدرات الفعّالة للمتصل على مشروع (خادمية موثوقة — للواجهة كي لا تعتمد على الإخفاء).
create or replace function public.pc_project_client_caps(p_project uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_view',            public.pc_client_cap(p_project,'view'),
    'can_comment',         public.pc_client_cap(p_project,'comment'),
    'can_approve',         public.pc_client_cap(p_project,'approve'),
    'can_download',        public.pc_client_cap(p_project,'download'),
    'can_view_financials', public.pc_client_cap(p_project,'view_financials'));
$$;

-- ═══ 7) Grants ═══
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_grant_client_project_access(uuid,uuid,jsonb)',
    'public.admin_revoke_client_project_access(uuid,uuid,text)',
    'public.client_project_access_list(uuid)',
    'public.pc_project_client_caps(uuid)',
    'public.pc_client_can_view(uuid)','public.pc_client_can_comment(uuid)',
    'public.pc_client_can_approve(uuid)','public.pc_client_can_download(uuid)',
    'public.pc_client_can_view_financials(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- pc_client_cap + نقاط الاختناق تبقى متاحة لـauthenticated (كما كانت).
  execute 'grant execute on function public.pc_client_cap(uuid,text) to authenticated';
end $g$;

-- ═══ 8) VALIDATION ═══
do $v$
declare miss text := '';
begin
  if to_regclass('public.client_project_access') is null then miss := miss || ' client_project_access'; end if;
  if to_regprocedure('public.pc_client_cap(uuid,text)')      is null then miss := miss || ' pc_client_cap'; end if;
  if to_regprocedure('public.pc_project_client_caps(uuid)')  is null then miss := miss || ' pc_project_client_caps'; end if;
  if to_regprocedure('public.admin_grant_client_project_access(uuid,uuid,jsonb)') is null then miss := miss || ' admin_grant'; end if;
  if not (select relrowsecurity from pg_class where oid='public.client_project_access'::regclass) then miss := miss || ' RLS(cpa)'; end if;
  -- ★ عدم الكسر: كل مشروع standalone حالي يجب أن يبقى مرئيًا لعميله كما كان.
  -- (تحقّق منطقي: pc_client_cap لمشروع standalone غير مخفي = مطابقة العميل ⇔ السلوك القديم.)
  if to_regprocedure('public.can_access_project(uuid)') is null then miss := miss || ' can_access_project(uuid)'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- ─── فحوص ما بعد التشغيل (Read-only) ───
--  -- 1) لا كسر للـstandalone: عدّ المشاريع القابلة للوصول لن يتغيّر (شغّل كحساب عميل قائم قبل/بعد).
--  -- 2) الدوال أُعيد تعريفها بالتوقيع نفسه:
--     select proname, pg_get_function_identity_arguments(oid) from pg_proc
--       where proname in ('can_access_project','is_client_side','is_client_owner','pc_client_cap') and pronamespace='public'::regnamespace;
--  -- 3) الجدول + RLS:
--     select relrowsecurity from pg_class where oid='public.client_project_access'::regclass;   -- t
--  -- 4) منطق الرؤية (بيئة اختبار): مشروع subproject بـclient_visibility='inherit' يجب أن يُرجع
--     --   pc_client_cap(sp,'view') = false لعميل بلا منح، و=true بعد admin_grant_client_project_access.
--
-- ─── ROLLBACK NOTES ───
-- التراجع الآمن (يعيد نقاط الاختناق إلى تعريفها الأصلي في phase0_migration.sql دون فقد بيانات):
--   begin;
--   -- أعد تشغيل تعريفات phase0 الأصلية الثلاثة (CREATE OR REPLACE — تُعيد المطابقة الخام):
--   --   can_access_project / is_client_side / is_client_owner
--   --   (انسخها من docs/phase0_migration.sql:359-382، أو أعد تشغيل phase0 كاملًا فهو idempotent)
--   -- ثم (اختياري) أسقط طبقة القدرات — الأعمدة/الجدول خاملة ولا تكسر شيئًا إن بقيت:
--   drop function if exists public.pc_project_client_caps(uuid);
--   drop function if exists public.pc_client_can_view(uuid), public.pc_client_can_comment(uuid),
--        public.pc_client_can_approve(uuid), public.pc_client_can_download(uuid), public.pc_client_can_view_financials(uuid);
--   drop function if exists public.admin_grant_client_project_access(uuid,uuid,jsonb),
--        public.admin_revoke_client_project_access(uuid,uuid,text), public.client_project_access_list(uuid);
--   drop function if exists public.pc_client_cap(uuid,text);
--   -- الجدول قابل للإبقاء (منح موثّقة)؛ أسقطه فقط إن أردت إزالة كل الأثر:
--   -- drop table if exists public.client_project_access;
--   commit;
-- ملاحظة: بما أنّ لا مشروع master/subproject قائم بعد، فإعادة التعريف لا تغيّر سلوك أي صف حالي.
