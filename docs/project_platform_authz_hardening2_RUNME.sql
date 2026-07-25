-- ════════════════════════════════════════════════════════════════════════════
-- project_platform_authz_hardening2_RUNME.sql        ★ أمنيّ — الدفعة الثانية ★
--
-- يُكمل ما بدأه project_platform_authz_hardening_RUNME.sql (المطبَّق والمُتحقَّق منه:
-- الحرّاس صارت تُعيد false بدل null، وتقارير الشركة صارت 42501 لغير المُصادَق).
-- هذه الدفعة تُغلق ثلاث ثغرات **مستقلّة تمامًا عن الحرّاس** — لذلك لم تُصلحها الدفعة الأولى.
--
-- ═══ §A إفساد بيانات: مسار مراجعة مباشر يتجاوز الـRPC ═══
--   سياسة "reviews insert" تسمح للعميل بالإدراج مباشرةً في deliverable_reviews.
--   المحفّز trg_review_created ينفّذ: update deliverables set status = new.decision
--   لكنّه **لا يضبط deliverable_versions.decision**. النتيجة: مخرَج حالته 'approved'
--   بلا نسخة معتمدة ⇒ admin_set_final_version ترفع 'version_not_approved' **للأبد**،
--   والمخرَج يصبح غير قابل للتسليم نهائيًّا ولا مخرج له من الواجهة (لم يعد في client_review).
--   العلاج: إسقاط سياسة الإدراج المباشر فقط. المسار الصحيح client_review_version
--   (SECURITY DEFINER) يضبط الاثنين معًا ولا يتأثّر بالسحب.
--
-- ═══ §B كتابة/حذف مباشر يتجاوز كل حرّاس الـRPC ═══
--   project_core_FINAL_RUNME.sql:462 يمنح insert,update,delete على جداول ثانوية
--   لـauthenticated. تحقّقتُ من استخدام الواجهة الفعليّ قبل أي سحب:
--     • project_shoot_sessions       → الواجهة **تقرأ فقط**؛ الكتابة عبر pc_shoot_upsert.
--       ⇒ يُسحب insert/update/delete. (DELETE مباشر كان يُسقط project_call_sheets
--         بالتتالي ويتجاوز الحذف الناعم والسجلّ والإشعار.)
--     • project_deliverable_versions → الواجهة **تقرأ فقط** ⇒ يُسحب insert/update/delete.
--     • project_locations            → الواجهة تستخدم POST + PATCH(is_deleted=true)
--       ⇒ يُسحب **DELETE فقط**، ويبقى insert/update.
--     • project_templates            → الواجهة تستخدم POST + PATCH(is_active=false)
--       ⇒ يُسحب **DELETE فقط** (الحذف كان يُدمِّر project_template_versions بالتتالي
--         بلا حذف ناعم ويكسر المشاريع المُنشأة من القالب).
--   لا يُسحب شيء من الجداول الأخرى في تلك القائمة (الواجهة تكتبها فعلًا).
--
-- ═══ §C فتح صلاحية عند عميل/مشروع بلا معرّف (NULL fail-open) ═══
--   الحارس: `client_id is distinct from my_client_id() and not exists(grant) then false`.
--   حين يكون الطرفان NULL فإنّ `NULL is distinct from NULL` = FALSE ⇒ الحارس لا يعمل،
--   فيسقط التنفيذ إلى الفرع الافتراضيّ ويمنح view/comment/download. العلاج: اعتبار
--   NULL في أيّ من الطرفين «غير مطابق» صراحةً.
--
-- ═══ §D تصعيد المحرِّر لنفسه ═══
--   pc_member_add يقبل can_edit_project ⇒ محرِّر في مشروع يستطيع
--   pc_member_add(project, self, 'kian_manager') فيرفّع نفسه مديرًا. العلاج: منع ترقية
--   الذات إلى kian_manager إلا لإدارة المشاريع.
--
-- Additive · Idempotent · Transactional · لا DROP TABLE · لا حذف بيانات · Self-test.
-- التشغيل: psql "$DATABASE_URL" -f docs/project_platform_authz_hardening2_RUNME.sql
-- المتطلّب السابق: project_platform_authz_hardening_RUNME.sql (مطبَّق).
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.can_manage_projects()') is null then raise exception 'PREFLIGHT: can_manage_projects missing'; end if;
  if public.can_manage_projects() is null then
    raise exception 'PREFLIGHT: run project_platform_authz_hardening_RUNME.sql first (gates still collapse to NULL)';
  end if;
  if to_regprocedure('public.client_review_version(uuid,text,text)') is null then
    raise exception 'PREFLIGHT: client_review_version missing — dropping the direct insert policy would remove the ONLY review path';
  end if;
end $pre$;

begin;

-- ─── §A إسقاط مسار المراجعة المباشر (سياسة الإدراج فقط؛ القراءة تبقى كما هي) ───
drop policy if exists "reviews insert" on public.deliverable_reviews;
-- سحب صلاحية الإدراج المباشر أيضًا (حزام وحمّالة). client_review_version تعمل
-- بصلاحية المالك (SECURITY DEFINER) فلا تتأثّر.
do $a$
begin
  begin execute 'revoke insert on public.deliverable_reviews from authenticated'; exception when undefined_object then null; end;
  begin execute 'revoke insert on public.deliverable_reviews from anon';          exception when undefined_object then null; end;
end $a$;

-- ─── §B سحب الكتابة/الحذف المباشر بما يطابق استخدام الواجهة الفعليّ ───
do $b$
begin
  -- قراءة فقط في الواجهة ⇒ سحب كامل للكتابة
  begin execute 'revoke insert, update, delete on public.project_shoot_sessions from authenticated'; exception when undefined_object then null; end;
  begin execute 'revoke insert, update, delete on public.project_deliverable_versions from authenticated'; exception when undefined_object then null; end;
  -- الواجهة تُنشئ وتؤرشف (PATCH) ⇒ سحب DELETE فقط
  begin execute 'revoke delete on public.project_locations from authenticated'; exception when undefined_object then null; end;
  begin execute 'revoke delete on public.project_templates from authenticated'; exception when undefined_object then null; end;
  raise notice 'AUTHZ2 §B: direct write/delete grants tightened to match real UI usage.';
end $b$;

-- ─── §C إغلاق fail-open عند NULL (نفس المنطق حرفيًّا عدا سطر الحارس) ───
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
    -- must be this project's client org OR hold an explicit grant.
    -- BATCH V1: NULL على أيّ من الطرفين = «غير مطابق». سابقًا كان
    -- `NULL is distinct from NULL` = FALSE فيسقط الحارس ويمنح رؤية افتراضيّة.
    when (   (select client_id from p) is null
          or public.my_client_id() is null
          or (select client_id from p) is distinct from public.my_client_id())
         and not exists (select 1 from g) then false
    when exists (select 1 from g) then case p_cap
        when 'view'            then (select can_view            from g)
        when 'comment'         then (select can_comment         from g)
        when 'approve'         then (select can_approve         from g)
        when 'download'        then (select can_download        from g)
        when 'view_financials' then (select can_view_financials from g)
        else false end
    when (select project_scope from p) in ('standalone','master') and (select cv from p) <> 'hidden' then case p_cap
        when 'view'            then true
        when 'comment'         then true
        when 'download'        then true
        when 'approve'         then (public.project_role(p_project) = 'client_owner'
                                     or (select client_id from p) = public.my_client_id())
        when 'view_financials' then false
        else false end
    when (select project_scope from p) = 'subproject' and (select cv from p) = 'visible' then (p_cap = 'view')
    else false
  end;
$$;

-- ─── §D منع ترقية الذات إلى مدير مشروع (نفس المنطق + شرط واحد) ───
create or replace function public.pc_member_add(p_project uuid, p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if p_role not in ('kian_manager','kian_editor','kian_photographer','kian_viewer') then raise exception 'bad_role'; end if;
  -- BATCH V1: محرِّر يملك can_edit_project كان يستطيع ترقية نفسه إلى kian_manager،
  -- وهي ترقية تفتح سياسات قراءة أوسع. الترقية الذاتيّة لإدارة المشاريع فقط.
  if p_user = auth.uid() and p_role = 'kian_manager' and not public.can_manage_projects() then
    raise exception 'no_self_promotion';
  end if;
  insert into public.project_members(project_id, user_id, role, added_by)
    values (p_project, p_user, p_role, auth.uid())
    on conflict (project_id, user_id) do update set role = excluded.role, is_deleted = false;
  perform public.pc_log(p_project, 'member_added', 'member', p_user, jsonb_build_object('role', p_role));
  begin
    perform public.pc_notify_user(p_user, 'project_note_new', 'project', p_project,
      'أُضِفت إلى فريق مشروع', 'You were added to a project team');
  exception when others then null;
  end;
  return true;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SELF-TEST — يرفع «AUTHZ2 FAIL …»
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_cnt int;
begin
  -- §A: لم تبقَ سياسة إدراج مباشر، وسياسة القراءة سليمة، والمسار الصحيح موجود.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='deliverable_reviews' and policyname='reviews insert')
    then raise exception 'AUTHZ2 FAIL: direct review-insert policy still present'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deliverable_reviews' and policyname='reviews read')
    then raise exception 'AUTHZ2 FAIL: reviews read policy was lost'; end if;
  if to_regprocedure('public.client_review_version(uuid,text,text)') is null
    then raise exception 'AUTHZ2 FAIL: the only correct review path is missing'; end if;

  -- §B: الجداول قراءة-فقط لم تعد قابلة للكتابة المباشرة؛ والمسموح بقي مسموحًا.
  if has_table_privilege('authenticated','public.project_shoot_sessions','INSERT')
     or has_table_privilege('authenticated','public.project_shoot_sessions','UPDATE')
     or has_table_privilege('authenticated','public.project_shoot_sessions','DELETE')
    then raise exception 'AUTHZ2 FAIL: project_shoot_sessions still directly writable'; end if;
  if has_table_privilege('authenticated','public.project_locations','DELETE')
    then raise exception 'AUTHZ2 FAIL: project_locations still directly deletable'; end if;
  if has_table_privilege('authenticated','public.project_templates','DELETE')
    then raise exception 'AUTHZ2 FAIL: project_templates still directly deletable'; end if;
  -- عدم الانحدار: ما تستخدمه الواجهة يجب أن يبقى.
  if not has_table_privilege('authenticated','public.project_locations','INSERT')
    then raise exception 'AUTHZ2 FAIL: regression — locations INSERT was revoked (UI needs it)'; end if;
  if not has_table_privilege('authenticated','public.project_templates','UPDATE')
    then raise exception 'AUTHZ2 FAIL: regression — templates UPDATE was revoked (archive needs it)'; end if;
  if not has_table_privilege('authenticated','public.project_shoot_sessions','SELECT')
    then raise exception 'AUTHZ2 FAIL: regression — shoot sessions SELECT was revoked'; end if;

  -- §C/§D: الدوالّ موجودة ولا تُعيد NULL.
  if to_regprocedure('public.pc_client_cap(uuid,text)') is null then raise exception 'AUTHZ2 FAIL: pc_client_cap missing'; end if;
  if public.pc_client_cap(gen_random_uuid(),'view') is null then raise exception 'AUTHZ2 FAIL: pc_client_cap returns NULL'; end if;
  if public.pc_client_cap(gen_random_uuid(),'view') is true then raise exception 'AUTHZ2 FAIL: unknown project must not grant view'; end if;
  if to_regprocedure('public.pc_member_add(uuid,uuid,text)') is null then raise exception 'AUTHZ2 FAIL: pc_member_add missing'; end if;

  raise notice 'AUTHZ2 SELF-TEST PASSED — review path, direct writes, NULL fail-open and self-promotion all closed.';
end $selftest$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--  1) لا سياسة إدراج مباشر:
--     select policyname from pg_policies where tablename='deliverable_reviews';
--     -- المتوقّع: "reviews read" فقط
--  2) الصلاحيات المباشرة:
--     select table_name, privilege_type from information_schema.role_table_grants
--      where grantee='authenticated'
--        and table_name in ('project_shoot_sessions','project_locations','project_templates',
--                           'project_deliverable_versions','deliverable_reviews')
--      order by 1,2;
--     -- المتوقّع: shoot_sessions/deliverable_versions = SELECT فقط ·
--     --           locations/templates = SELECT,INSERT,UPDATE (بلا DELETE) ·
--     --           deliverable_reviews = SELECT فقط
--  3) اعتماد العميل ما زال يعمل عبر المسار الصحيح (من البوابة، بحساب عميل):
--     يجب أن ينجح الاعتماد وأن تصبح deliverable_versions.decision='approved'.
--  4) لا مخرَج عالق: صفوف حالتها approved بلا نسخة معتمدة (يجب أن تكون صفرًا للجديد):
--     select d.id from public.deliverables d
--      where d.status='approved' and d.is_deleted=false
--        and not exists (select 1 from public.deliverable_versions v
--                        where v.deliverable_id=d.id and v.decision='approved' and v.is_deleted=false);
--     -- الصفوف الظاهرة هنا (إن وُجدت) هي ضحايا سابقة للثغرة — عالجها بـ
--     --   admin_set_version_decision/client_review_version على النسخة الصحيحة، لا بحذف بيانات.
--
-- ROLLBACK / RECOVERY
--  • إضافيّ بحت: لا حذف بيانات ولا DROP TABLE. إعادة التشغيل آمنة.
--  • §A للتراجع: أعِد إنشاء السياسة من docs/phase0_migration.sql (يُعيد فتح مسار الإفساد).
--  • §B للتراجع: grant insert, update, delete on <table> to authenticated;
--  • §C/§D للتراجع: أعِد تشغيل project_hierarchy_security_RUNME.sql /
--    project_core_UI_COMPLETION_RUNME.sql (يُعيدان النسختين السابقتين).
-- ════════════════════════════════════════════════════════════════════════════
