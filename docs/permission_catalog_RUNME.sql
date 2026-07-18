-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — NORMALIZED GRANULAR PERMISSION SYSTEM (RUN ONCE)  [Permissions v2]
--
-- Replaces the 4 coarse profession booleans (perm_view_all_tasks / manage_*) with a
-- normalized capability catalog, WITHOUT changing System Access Role (staff_role) or
-- the professions themselves. Preserves employee_professions + primary metadata.
--
-- Model:
--   permissions                    — the catalog (key, labels, category, sensitivity)
--   profession_permissions         — which permission each profession grants
--   employee_permission_overrides  — per-user allow/deny (deny wins)
--
-- Canonical resolver:
--   emp_has_permission(user, key) =
--     NOT system_only AND NOT explicit-deny AND (explicit-allow OR any active
--     assigned profession grants it)
--   emp_can(cap,user) is kept as a COMPATIBILITY WRAPPER over emp_has_permission, so
--   every existing RLS/RPC (ptasks_read, pc_can_read_task, civ_can_manage, …) now
--   resolves through the granular engine unchanged.
--
-- Sensitivity: 'normal' | 'sensitive' (finance/destructive — only Owner/Super-Admin
-- may GRANT) | 'system_only' (never grantable via professions/overrides).
-- Idempotent; backfills the old flags so existing access is preserved.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.professions')          is null then miss := miss || ' professions'; end if;
  if to_regclass('public.employee_professions') is null then miss := miss || ' employee_professions'; end if;
  if to_regprocedure('public.is_owner()')            is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()')            is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()') is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then miss := miss || ' log_activity()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- ── 1) Tables ───────────────────────────────────────────────────────────────
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label_ar text not null default '', label_en text not null default '',
  description_ar text, description_en text,
  category text not null,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive','system_only')),
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.profession_permissions (
  id uuid primary key default gen_random_uuid(),
  profession_id uuid not null references public.professions(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (profession_id, permission_id)
);
create index if not exists idx_profperm_profession on public.profession_permissions(profession_id);
create table if not exists public.employee_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null check (effect in ('allow','deny')),
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, permission_id)
);
create index if not exists idx_empoverride_user on public.employee_permission_overrides(user_id);

-- ── 2) Catalog seed (idempotent — canonical category/sensitivity/labels) ─────
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
select v.key, v.category, v.sensitivity, v.ord, v.label_ar, v.label_en
from (values
  -- projects & tasks
  (10,'projects.view_assigned','projects_tasks','normal','عرض المشاريع المُسندة','View assigned projects'),
  (20,'projects.view_profession_projects','projects_tasks','normal','عرض مشاريع المهنة','View profession projects'),
  (30,'projects.view_summary','projects_tasks','normal','عرض ملخّص المشروع','View project summary'),
  (40,'tasks.view_assigned','projects_tasks','normal','عرض المهام المُسندة','View assigned tasks'),
  (50,'tasks.view_profession_queue','projects_tasks','normal','عرض طابور مهام المهنة','View profession task queue'),
  (60,'tasks.view_all_project_tasks','projects_tasks','normal','عرض كل مهام المشروع','View all project tasks'),
  (70,'tasks.create','projects_tasks','normal','إنشاء مهام','Create tasks'),
  (80,'tasks.edit','projects_tasks','normal','تعديل المهام','Edit tasks'),
  (90,'tasks.assign_employee','projects_tasks','normal','إسناد لموظف','Assign to employee'),
  (100,'tasks.assign_profession','projects_tasks','normal','إسناد لمهنة','Assign to profession'),
  (110,'tasks.complete','projects_tasks','normal','إنهاء المهام','Complete tasks'),
  (120,'tasks.reopen','projects_tasks','normal','إعادة فتح المهام','Reopen tasks'),
  (130,'tasks.view_comments','projects_tasks','normal','عرض تعليقات المهام','View task comments'),
  (140,'tasks.add_comments','projects_tasks','normal','إضافة تعليقات','Add comments'),
  (150,'tasks.upload_files','projects_tasks','normal','رفع ملفات للمهام','Upload task files'),
  -- pre-production
  (160,'preproduction.view','preproduction','normal','عرض ما قبل الإنتاج','View pre-production'),
  (170,'preproduction.create','preproduction','normal','إنشاء بنود','Create items'),
  (180,'preproduction.edit','preproduction','normal','تعديل بنود','Edit items'),
  (190,'preproduction.delete','preproduction','normal','حذف بنود','Delete items'),
  (200,'preproduction.manage_script','preproduction','normal','إدارة السيناريو','Manage script'),
  (210,'preproduction.manage_storyboard','preproduction','normal','إدارة الستوري بورد','Manage storyboard'),
  (220,'preproduction.manage_shotlist','preproduction','normal','إدارة قائمة اللقطات','Manage shot list'),
  (230,'preproduction.manage_callsheet','preproduction','normal','إدارة Call Sheet','Manage call sheet'),
  (240,'preproduction.manage_locations','preproduction','normal','إدارة المواقع','Manage locations'),
  (250,'preproduction.manage_permits','preproduction','normal','إدارة التصاريح','Manage permits'),
  (260,'preproduction.manage_equipment_plan','preproduction','normal','إدارة خطة المعدات','Manage equipment plan'),
  (270,'preproduction.manage_schedule','preproduction','normal','إدارة الجدول','Manage schedule'),
  (280,'preproduction.comment','preproduction','normal','التعليق','Comment'),
  (290,'preproduction.internal_approve','preproduction','normal','اعتماد داخلي','Internal approve'),
  (300,'preproduction.share_with_client','preproduction','normal','مشاركة مع العميل','Share with client'),
  (310,'preproduction.print_reports','preproduction','normal','طباعة التقارير','Print reports'),
  -- production & shooting
  (320,'shoots.view','production','normal','عرض جلسات التصوير','View shoots'),
  (330,'shoots.create','production','normal','إنشاء جلسة','Create shoot'),
  (340,'shoots.edit','production','normal','تعديل جلسة','Edit shoot'),
  (350,'shoots.manage_schedule','production','normal','إدارة جدول التصوير','Manage shoot schedule'),
  (360,'shoots.manage_locations','production','normal','إدارة مواقع التصوير','Manage shoot locations'),
  (370,'shoots.manage_team','production','normal','إدارة فريق التصوير','Manage shoot team'),
  (380,'shoots.record_attendance','production','normal','تسجيل الحضور','Record attendance'),
  (390,'shoots.update_status','production','normal','تحديث الحالة','Update status'),
  (400,'shoots.upload_references','production','normal','رفع مراجع','Upload references'),
  (410,'shoots.view_required_equipment','production','normal','عرض المعدات المطلوبة','View required equipment'),
  (420,'shoots.request_equipment','production','normal','طلب معدات','Request equipment'),
  (430,'shoots.complete','production','normal','إنهاء جلسة','Complete shoot'),
  (440,'shoots.manage_drone','production','normal','إدارة الدرون','Manage drone'),
  (450,'shoots.manage_audio','production','normal','إدارة الصوت','Manage audio'),
  (460,'shoots.manage_lighting','production','normal','إدارة الإضاءة','Manage lighting'),
  -- deliverables & editing
  (470,'deliverables.view_assigned','deliverables','normal','عرض المخرجات المُسندة','View assigned deliverables'),
  (480,'deliverables.view_versions','deliverables','normal','عرض النسخ','View versions'),
  (490,'deliverables.upload_preview','deliverables','normal','رفع معاينة','Upload preview'),
  (500,'deliverables.create_version','deliverables','normal','إنشاء نسخة','Create version'),
  (510,'deliverables.view_client_comments','deliverables','normal','عرض تعليقات العميل','View client comments'),
  (520,'deliverables.reply_to_client','deliverables','normal','الردّ على العميل','Reply to client'),
  (530,'deliverables.assign_comment','deliverables','normal','إسناد تعليق','Assign comment'),
  (540,'deliverables.mark_comment_in_progress','deliverables','normal','تعليق قيد المعالجة','Mark comment in progress'),
  (550,'deliverables.resolve_comment','deliverables','normal','حلّ تعليق','Resolve comment'),
  (560,'deliverables.reopen_comment','deliverables','normal','إعادة فتح تعليق','Reopen comment'),
  (570,'deliverables.upload_revision','deliverables','normal','رفع تعديل','Upload revision'),
  (580,'deliverables.send_internal_review','deliverables','normal','إرسال لمراجعة داخلية','Send internal review'),
  (590,'deliverables.send_client_review','deliverables','normal','إرسال لمراجعة العميل','Send client review'),
  (600,'deliverables.internal_approve','deliverables','normal','اعتماد داخلي','Internal approve'),
  (610,'deliverables.mark_final','deliverables','normal','تعيين نهائي','Mark final'),
  (620,'deliverables.download_internal_files','deliverables','normal','تنزيل الملفات الداخلية','Download internal files'),
  -- custody & assets
  (630,'custody.view','custody','normal','عرض العهدة','View custody'),
  (640,'custody.view_assigned','custody','normal','عرض عهدتي','View assigned custody'),
  (650,'custody.issue','custody','normal','صرف عهدة','Issue custody'),
  (660,'custody.return','custody','normal','إرجاع','Return'),
  (670,'custody.upload_asset_images','custody','normal','رفع صور الأصول','Upload asset images'),
  (680,'custody.upload_issue_return_images','custody','normal','رفع صور الصرف/الإرجاع','Upload issue/return images'),
  (690,'custody.report_damage','custody','normal','الإبلاغ عن تلف','Report damage'),
  (700,'custody.report_missing','custody','normal','الإبلاغ عن فقد','Report missing'),
  (710,'custody.update_asset_condition','custody','normal','تحديث حالة الأصل','Update asset condition'),
  (720,'custody.request_maintenance','custody','normal','طلب صيانة','Request maintenance'),
  (730,'custody.view_asset_history','custody','normal','عرض سجل الأصل','View asset history'),
  (740,'custody.edit_asset','custody','normal','تعديل الأصل','Edit asset'),
  (750,'custody.create_asset','custody','normal','إنشاء أصل','Create asset'),
  (760,'custody.archive_asset','custody','normal','أرشفة أصل','Archive asset'),
  (770,'custody.delete_asset_images','custody','sensitive','حذف صور الأصول','Delete asset images'),
  (780,'custody.restore_asset_images','custody','sensitive','استعادة صور الأصول','Restore asset images'),
  -- client communication
  (790,'clients.view_project_contact','clients','normal','عرض جهة اتصال المشروع','View project contact'),
  (800,'clients.view_project_comments','clients','normal','عرض تعليقات المشروع','View project comments'),
  (810,'clients.reply_project_comments','clients','normal','الردّ على تعليقات المشروع','Reply to project comments'),
  (820,'clients.share_files','clients','normal','مشاركة ملفات','Share files'),
  (830,'clients.request_approval','clients','normal','طلب اعتماد','Request approval'),
  (840,'clients.view_approval_history','clients','normal','سجل الاعتمادات','View approval history'),
  -- files
  (850,'files.upload_internal','files','normal','رفع ملفات داخلية','Upload internal files'),
  (860,'files.upload_client_visible','files','normal','رفع ملفات مرئية للعميل','Upload client-visible files'),
  (870,'files.preview','files','normal','معاينة الملفات','Preview files'),
  (880,'files.download_internal','files','normal','تنزيل داخلي','Download internal'),
  (890,'files.delete_own','files','normal','حذف ملفاتي','Delete own files'),
  (900,'files.delete_any','files','sensitive','حذف أي ملف','Delete any file'),
  (910,'files.create_preview_links','files','normal','إنشاء روابط معاينة','Create preview links'),
  (920,'files.manage_watermark','files','normal','إدارة العلامة المائية','Manage watermark'),
  (930,'files.manage_final_files','files','normal','إدارة الملفات النهائية','Manage final files'),
  -- notifications
  (940,'notifications.task','notifications','normal','إشعارات المهام','Task notifications'),
  (950,'notifications.profession_queue','notifications','normal','إشعارات طابور المهنة','Profession queue notifications'),
  (960,'notifications.client_comments','notifications','normal','إشعارات تعليقات العميل','Client comment notifications'),
  (970,'notifications.shoots','notifications','normal','إشعارات التصوير','Shoot notifications'),
  (980,'notifications.deliverables','notifications','normal','إشعارات المخرجات','Deliverable notifications'),
  (990,'notifications.custody','notifications','normal','إشعارات العهدة','Custody notifications'),
  (1000,'notifications.portal','notifications','normal','إشعارات البوابة','Portal notifications'),
  (1010,'notifications.email','notifications','normal','إشعارات البريد','Email notifications'),
  -- finance (sensitive)
  (1020,'finance.view_summary','finance','sensitive','عرض الملخّص المالي','View finance summary'),
  (1030,'finance.view_budget','finance','sensitive','عرض الميزانية','View budget'),
  (1040,'finance.view_costs','finance','sensitive','عرض التكاليف','View costs'),
  (1050,'finance.create_cost','finance','sensitive','إضافة تكلفة','Create cost'),
  (1060,'finance.edit_cost','finance','sensitive','تعديل تكلفة','Edit cost'),
  (1070,'finance.view_invoices','finance','sensitive','عرض الفواتير','View invoices'),
  (1080,'finance.update_payment_status','finance','sensitive','تحديث حالة الدفع','Update payment status'),
  (1090,'finance.confirm_payment','finance','sensitive','تأكيد الدفع','Confirm payment'),
  (1100,'finance.release_final_delivery','finance','sensitive','فتح التسليم النهائي','Release final delivery'),
  -- system-only (never grantable via professions)
  (1110,'users.manage','system','system_only','إدارة المستخدمين','Manage users'),
  (1120,'system_roles.manage','system','system_only','إدارة أدوار النظام','Manage system roles'),
  (1130,'system_settings.manage','system','system_only','إدارة إعدادات النظام','Manage system settings'),
  (1140,'integrations.manage','system','system_only','إدارة التكاملات','Manage integrations'),
  (1150,'unrestricted_projects.access','system','system_only','وصول غير مقيّد للمشاريع','Unrestricted project access'),
  (1160,'projects.hard_delete','system','system_only','حذف نهائي للمشاريع','Hard delete projects'),
  (1170,'owner_or_admin.assign','system','system_only','إسناد صلاحيات المالك/الأدمن','Assign owner/admin')
) as v(ord, key, category, sensitivity, label_ar, label_en)
on conflict (key) do update set
  category = excluded.category, sensitivity = excluded.sensitivity,
  label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;

-- ── 3) Canonical resolver ────────────────────────────────────────────────────
create or replace function public.emp_has_permission(p_user uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_perm record;
begin
  if coalesce(p_user, auth.uid()) is null then return false; end if;
  -- probing another user requires manager/admin
  if coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not (public.is_owner() or public.is_admin() or public.can_manage_projects()) then
    return false;
  end if;
  select id, sensitivity, enabled into v_perm from public.permissions where key = p_key;
  if v_perm.id is null or not v_perm.enabled then return false; end if;
  if v_perm.sensitivity = 'system_only' then return false; end if;   -- never via this engine
  -- explicit deny wins
  if exists (select 1 from public.employee_permission_overrides o
             where o.user_id = coalesce(p_user, auth.uid()) and o.permission_id = v_perm.id and o.effect = 'deny') then
    return false;
  end if;
  -- explicit allow
  if exists (select 1 from public.employee_permission_overrides o
             where o.user_id = coalesce(p_user, auth.uid()) and o.permission_id = v_perm.id and o.effect = 'allow') then
    return true;
  end if;
  -- UNION of all ACTIVE assigned professions that grant it
  return exists (
    select 1 from public.profession_permissions pp
    join public.employee_professions ep on ep.profession_id = pp.profession_id
    join public.professions pr on pr.id = ep.profession_id and pr.is_active
    where ep.profile_id = coalesce(p_user, auth.uid())
      and pp.permission_id = v_perm.id and pp.granted
  );
end $$;

-- Overload with default = the caller (so emp_has_permission('x') works in RLS).
create or replace function public.emp_has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.emp_has_permission(auth.uid(), p_key);
$$;

-- ── 4) emp_can compatibility wrapper (maps the 4 legacy caps → granular keys) ─
create or replace function public.emp_can(p_cap text, p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_key text;
begin
  if coalesce(p_user, auth.uid()) is null then return false; end if;
  if coalesce(p_user, auth.uid()) is distinct from auth.uid()
     and not (public.is_owner() or public.is_admin() or public.can_manage_projects()) then
    return false;
  end if;
  if coalesce(p_user, auth.uid()) = auth.uid()
     and (public.is_owner() or public.is_admin() or public.can_manage_projects()) then
    return true;
  end if;
  v_key := case p_cap
    when 'view_all_tasks'       then 'tasks.view_all_project_tasks'
    when 'manage_preproduction' then 'preproduction.edit'
    when 'manage_shoots'        then 'shoots.edit'
    when 'manage_custody'       then 'custody.issue'
    else null end;
  if v_key is null then return false; end if;
  return public.emp_has_permission(coalesce(p_user, auth.uid()), v_key);
end $$;

-- ── 5) Recommended templates (permission keys per template) ──────────────────
create or replace function public.permission_template_keys(p_template text)
returns text[] language sql immutable set search_path = public as $$
  select case p_template
    when 'photographer' then array[
      'projects.view_assigned','projects.view_profession_projects','tasks.view_assigned','tasks.view_profession_queue','tasks.complete','tasks.view_comments','tasks.add_comments','tasks.upload_files',
      'preproduction.view','preproduction.manage_storyboard','preproduction.manage_shotlist','preproduction.manage_locations','preproduction.comment','preproduction.print_reports',
      'shoots.view','shoots.manage_schedule','shoots.manage_locations','shoots.manage_team','shoots.record_attendance','shoots.update_status','shoots.upload_references','shoots.view_required_equipment','shoots.request_equipment','shoots.complete','shoots.manage_drone','shoots.manage_lighting',
      'custody.view','custody.view_assigned','custody.upload_issue_return_images','files.upload_internal','files.preview','notifications.task','notifications.shoots','notifications.portal','notifications.email']
    when 'videographer' then array[
      'projects.view_assigned','tasks.view_assigned','tasks.view_profession_queue','tasks.complete','tasks.add_comments','tasks.upload_files',
      'preproduction.view','preproduction.manage_shotlist','preproduction.comment',
      'shoots.view','shoots.manage_schedule','shoots.manage_team','shoots.record_attendance','shoots.update_status','shoots.upload_references','shoots.view_required_equipment','shoots.request_equipment','shoots.complete','shoots.manage_drone','shoots.manage_audio','shoots.manage_lighting',
      'custody.view','custody.view_assigned','files.upload_internal','files.preview','notifications.task','notifications.shoots','notifications.portal','notifications.email']
    when 'editor' then array[
      'projects.view_assigned','tasks.view_assigned','tasks.view_profession_queue','tasks.complete','tasks.add_comments','tasks.upload_files',
      'preproduction.view','preproduction.manage_script','preproduction.manage_storyboard',
      'deliverables.view_assigned','deliverables.view_versions','deliverables.upload_preview','deliverables.create_version','deliverables.view_client_comments','deliverables.reply_to_client','deliverables.mark_comment_in_progress','deliverables.resolve_comment','deliverables.upload_revision','deliverables.send_internal_review','deliverables.send_client_review','deliverables.download_internal_files',
      'files.upload_internal','files.preview','files.create_preview_links','files.manage_watermark','notifications.task','notifications.deliverables','notifications.client_comments','notifications.portal','notifications.email']
    when 'motion_graphics' then array[
      'projects.view_assigned','tasks.view_assigned','tasks.view_profession_queue','tasks.complete','tasks.add_comments','tasks.upload_files',
      'preproduction.view','preproduction.manage_storyboard',
      'deliverables.view_assigned','deliverables.view_versions','deliverables.upload_preview','deliverables.create_version','deliverables.view_client_comments','deliverables.upload_revision','deliverables.download_internal_files',
      'files.upload_internal','files.preview','notifications.task','notifications.deliverables','notifications.portal']
    when 'custody_manager' then array[
      'custody.view','custody.view_assigned','custody.issue','custody.return','custody.upload_asset_images','custody.upload_issue_return_images','custody.report_damage','custody.report_missing','custody.update_asset_condition','custody.request_maintenance','custody.view_asset_history','custody.edit_asset','custody.create_asset','custody.archive_asset',
      'notifications.custody','notifications.portal','notifications.email']
    when 'project_manager' then array[
      'projects.view_assigned','projects.view_profession_projects','projects.view_summary','tasks.view_all_project_tasks','tasks.create','tasks.edit','tasks.assign_employee','tasks.assign_profession','tasks.complete','tasks.reopen','tasks.view_comments','tasks.add_comments','tasks.upload_files',
      'preproduction.view','preproduction.create','preproduction.edit','preproduction.internal_approve','preproduction.share_with_client','preproduction.print_reports','preproduction.manage_schedule',
      'shoots.view','shoots.create','shoots.edit','shoots.manage_schedule','shoots.manage_team','shoots.update_status','shoots.complete',
      'deliverables.view_assigned','deliverables.view_versions','deliverables.view_client_comments','deliverables.reply_to_client','deliverables.assign_comment','deliverables.resolve_comment','deliverables.send_client_review','deliverables.internal_approve',
      'clients.view_project_contact','clients.view_project_comments','clients.reply_project_comments','clients.request_approval','clients.view_approval_history',
      'files.upload_internal','files.upload_client_visible','files.preview','notifications.task','notifications.deliverables','notifications.client_comments','notifications.shoots','notifications.portal','notifications.email']
    when 'finance' then array[
      'projects.view_summary','finance.view_summary','finance.view_budget','finance.view_costs','finance.create_cost','finance.edit_cost','finance.view_invoices','finance.update_payment_status','finance.confirm_payment','finance.release_final_delivery',
      'notifications.portal','notifications.email']
    when 'logistics' then array[
      'projects.view_assigned','tasks.view_assigned','tasks.view_profession_queue','tasks.complete','tasks.add_comments',
      'preproduction.view','preproduction.manage_locations','preproduction.manage_permits','preproduction.manage_equipment_plan','preproduction.manage_schedule',
      'shoots.view','shoots.manage_locations','shoots.request_equipment','shoots.view_required_equipment',
      'custody.view','custody.view_assigned','custody.issue','custody.return','custody.request_maintenance',
      'notifications.custody','notifications.shoots','notifications.portal','notifications.email']
    else array[]::text[] end;
$$;

-- ── 6) Backfill: preserve existing access from the 4 old flags ───────────────
-- perm_view_all_tasks
insert into public.profession_permissions (profession_id, permission_id, granted)
select pr.id, p.id, true from public.professions pr
join public.permissions p on p.key in ('tasks.view_all_project_tasks','projects.view_summary')
where pr.perm_view_all_tasks = true
on conflict (profession_id, permission_id) do nothing;
-- perm_manage_preproduction → all preproduction.*
insert into public.profession_permissions (profession_id, permission_id, granted)
select pr.id, p.id, true from public.professions pr
join public.permissions p on p.category = 'preproduction'
where pr.perm_manage_preproduction = true
on conflict (profession_id, permission_id) do nothing;
-- perm_manage_shoots → all shoots.*
insert into public.profession_permissions (profession_id, permission_id, granted)
select pr.id, p.id, true from public.professions pr
join public.permissions p on p.category = 'production'
where pr.perm_manage_shoots = true
on conflict (profession_id, permission_id) do nothing;
-- perm_manage_custody → core custody.* (NOT the sensitive delete/restore images)
insert into public.profession_permissions (profession_id, permission_id, granted)
select pr.id, p.id, true from public.professions pr
join public.permissions p on p.category = 'custody' and p.sensitivity = 'normal'
where pr.perm_manage_custody = true
on conflict (profession_id, permission_id) do nothing;

-- Seed recommended templates onto any custom profession whose key/name matches a
-- template and that has NO permissions yet (never overwrites an already-configured
-- profession; safe re-run).
do $tpl$
declare pr record; tkey text; keys text[];
begin
  for pr in select id, key, name_en, name_ar from public.professions loop
    if exists (select 1 from public.profession_permissions where profession_id = pr.id) then continue; end if;
    tkey := case
      when pr.key ilike '%photograph%' or pr.name_en ilike '%photograph%' or pr.name_ar like '%مصوّر فوتو%' then 'photographer'
      when pr.key ilike '%videograph%' or pr.name_en ilike '%videograph%' then 'videographer'
      when pr.key ilike '%motion%' then 'motion_graphics'
      when pr.key ilike '%editor%' or pr.key ilike '%montage%' or pr.name_en ilike '%editor%' then 'editor'
      when pr.key ilike '%custody%' or pr.key = 'custody_officer' or pr.name_ar like '%عهد%' then 'custody_manager'
      when pr.key ilike '%manager%' or pr.name_en ilike '%project manager%' then 'project_manager'
      when pr.key ilike '%finance%' or pr.name_ar like '%مالي%' then 'finance'
      when pr.key ilike '%logistic%' then 'logistics'
      else null end;
    if tkey is null then continue; end if;
    keys := public.permission_template_keys(tkey);
    insert into public.profession_permissions (profession_id, permission_id, granted)
    select pr.id, p.id, true from public.permissions p
    where p.key = any(keys) and p.sensitivity <> 'system_only'
    on conflict (profession_id, permission_id) do nothing;
  end loop;
end $tpl$;

-- ── 7) RLS: catalog readable by any authenticated user; joins read own/admin ─
alter table public.permissions                  enable row level security;
alter table public.profession_permissions        enable row level security;
alter table public.employee_permission_overrides  enable row level security;
drop policy if exists permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated using (true);
drop policy if exists profperm_read on public.profession_permissions;
create policy profperm_read on public.profession_permissions for select to authenticated using (true);
drop policy if exists empoverride_read on public.employee_permission_overrides;
create policy empoverride_read on public.employee_permission_overrides for select to authenticated
  using (user_id = auth.uid() or public.can_manage_projects() or public.is_admin());
grant select on public.permissions, public.profession_permissions, public.employee_permission_overrides to authenticated;

-- ── 8) Config RPCs (writes; sensitive → owner/super-admin only; audited) ─────
create or replace function public.admin_set_profession_permission(p_profession uuid, p_key text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select id, sensitivity into v_perm from public.permissions where key = p_key and enabled;
  if v_perm.id is null then raise exception 'صلاحية غير معروفة: %', p_key; end if;
  if v_perm.sensitivity = 'system_only' then raise exception 'لا يمكن منح صلاحية نظامية عبر المهن'; end if;
  if v_perm.sensitivity = 'sensitive' and p_granted and not public.is_owner() then
    raise exception 'الصلاحيات الحساسة (المالية/الحساسة) يمنحها المالك/السوبر-أدمن فقط';
  end if;
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  values (p_profession, v_perm.id, p_granted, auth.uid())
  on conflict (profession_id, permission_id) do update set granted = excluded.granted, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.permission_changed', 'profession', p_profession,
    jsonb_build_object('key', p_key, 'granted', p_granted));
end $$;

create or replace function public.admin_bulk_set_profession_permissions(p_profession uuid, p_keys text[], p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_keys is null then return; end if;
  foreach k in array p_keys loop perform public.admin_set_profession_permission(p_profession, k, p_granted); end loop;
end $$;

create or replace function public.admin_copy_profession_permissions(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  -- copies non-sensitive grants always; sensitive only if the caller is owner.
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  select p_to, pp.permission_id, pp.granted, auth.uid()
  from public.profession_permissions pp
  join public.permissions p on p.id = pp.permission_id
  where pp.profession_id = p_from and pp.granted
    and (p.sensitivity = 'normal' or public.is_owner())
  on conflict (profession_id, permission_id) do update set granted = excluded.granted, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.permissions_copied', 'profession', p_to,
    jsonb_build_object('from', p_from));
end $$;

create or replace function public.admin_apply_profession_template(p_profession uuid, p_template text)
returns void language plpgsql security definer set search_path = public as $$
declare keys text[];
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  keys := public.permission_template_keys(p_template);
  if array_length(keys,1) is null then raise exception 'قالب غير معروف: %', p_template; end if;
  insert into public.profession_permissions (profession_id, permission_id, granted, updated_by)
  select p_profession, p.id, true, auth.uid() from public.permissions p
  where p.key = any(keys) and p.sensitivity <> 'system_only'
    and (p.sensitivity = 'normal' or public.is_owner())
  on conflict (profession_id, permission_id) do update set granted = true, updated_at = now(), updated_by = auth.uid();
  perform public.log_activity(auth.uid(), public.staff_role(), 'profession.template_applied', 'profession', p_profession,
    jsonb_build_object('template', p_template));
end $$;

create or replace function public.admin_set_employee_override(p_user uuid, p_key text, p_effect text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm record;
begin
  if not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select id, sensitivity into v_perm from public.permissions where key = p_key;
  if v_perm.id is null then raise exception 'صلاحية غير معروفة: %', p_key; end if;
  if v_perm.sensitivity = 'system_only' then raise exception 'لا يمكن تجاوز صلاحية نظامية'; end if;
  if p_effect is null or p_effect not in ('allow','deny') then   -- clear the override
    delete from public.employee_permission_overrides where user_id = p_user and permission_id = v_perm.id;
  else
    if v_perm.sensitivity = 'sensitive' and p_effect = 'allow' and not public.is_owner() then
      raise exception 'منح صلاحية حساسة لموظف يقتصر على المالك/السوبر-أدمن';
    end if;
    insert into public.employee_permission_overrides (user_id, permission_id, effect, reason, created_by)
    values (p_user, v_perm.id, p_effect, p_reason, auth.uid())
    on conflict (user_id, permission_id) do update set effect = excluded.effect, reason = excluded.reason, created_by = auth.uid(), created_at = now();
  end if;
  perform public.log_activity(auth.uid(), public.staff_role(), 'employee.permission_override', 'profile', p_user,
    jsonb_build_object('key', p_key, 'effect', p_effect));
end $$;

-- Reads for the UI (SECURITY DEFINER; authenticated may read the catalog/grants).
create or replace function public.admin_list_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'key',key,'label_ar',label_ar,'label_en',label_en,
    'category',category,'sensitivity',sensitivity,'enabled',enabled,'sort_order',sort_order) order by sort_order), '[]'::jsonb)
  from public.permissions where enabled;
$$;
create or replace function public.admin_list_profession_permission_keys(p_profession uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(p.key), '[]'::jsonb)
  from public.profession_permissions pp join public.permissions p on p.id = pp.permission_id
  where pp.profession_id = p_profession and pp.granted;
$$;

-- ── 9) Expanded effective-access diagnostic ──────────────────────────────────
create or replace function public.emp_effective_access(p_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := coalesce(p_user, auth.uid()); v jsonb;
begin
  if uid is null then raise exception 'not authorized'; end if;
  if uid <> auth.uid() and not (public.is_admin() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'user_id', uid,
    'system_role', (select staff_role from public.profiles where id = uid),
    'account_type', (select account_type from public.profiles where id = uid),
    'active_profession_ids', to_jsonb(public.emp_profession_ids(uid)),
    'active_profession_keys', coalesce((select jsonb_agg(pr.key order by pr.key) from public.employee_professions ep join public.professions pr on pr.id=ep.profession_id where ep.profile_id=uid and pr.is_active),'[]'::jsonb),
    'profession_permissions', coalesce((
      select jsonb_object_agg(t.key, t.keys) from (
        select pr.id, pr.key, coalesce(jsonb_agg(p.key) filter (where p.key is not null), '[]'::jsonb) as keys
        from public.employee_professions ep
        join public.professions pr on pr.id = ep.profession_id and pr.is_active
        left join public.profession_permissions pp on pp.profession_id = pr.id and pp.granted
        left join public.permissions p on p.id = pp.permission_id
        where ep.profile_id = uid group by pr.id, pr.key
      ) t), '{}'::jsonb),
    'allows', coalesce((select jsonb_agg(p.key) from public.employee_permission_overrides o join public.permissions p on p.id=o.permission_id where o.user_id=uid and o.effect='allow'),'[]'::jsonb),
    'denies', coalesce((select jsonb_agg(p.key) from public.employee_permission_overrides o join public.permissions p on p.id=o.permission_id where o.user_id=uid and o.effect='deny'),'[]'::jsonb),
    'effective_permissions', coalesce((
      select jsonb_agg(p.key order by p.sort_order) from public.permissions p
      where p.enabled and p.sensitivity <> 'system_only' and public.emp_has_permission(uid, p.key)),'[]'::jsonb),
    -- keep the 4-flag 'capabilities' object for backward compatibility (AssetDetailModal etc.)
    'capabilities', jsonb_build_object(
      'view_all_tasks', public.emp_can('view_all_tasks', uid),
      'manage_preproduction', public.emp_can('manage_preproduction', uid),
      'manage_shoots', public.emp_can('manage_shoots', uid),
      'manage_custody', public.emp_can('manage_custody', uid)),
    'custody', case when uid = auth.uid() then jsonb_build_object(
      'can_manage', (to_regprocedure('public.civ_can_manage()') is not null and public.civ_can_manage()),
      'can_delete_asset', (to_regprocedure('public.civ_can_delete_asset()') is not null and public.civ_can_delete_asset())) else null end,
    'note', 'effective = UNION(active professions) + allows − denies; deny wins; primary is display-only; system_only never via professions'
  ) into v;
  return v;
end $$;

-- ── 10) Grants ───────────────────────────────────────────────────────────────
do $g$
declare f text;
begin
  foreach f in array array[
    'public.emp_has_permission(uuid,text)','public.emp_has_permission(text)','public.emp_can(text,uuid)',
    'public.permission_template_keys(text)','public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_bulk_set_profession_permissions(uuid,text[],boolean)','public.admin_copy_profession_permissions(uuid,uuid)',
    'public.admin_apply_profession_template(uuid,text)','public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_list_permissions()','public.admin_list_profession_permission_keys(uuid)','public.emp_effective_access(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon;', f);
    execute format('grant execute on function %s to authenticated;', f);
  end loop;
end $g$;

do $v$
begin
  if to_regclass('public.permissions') is null then raise exception 'فشل: permissions'; end if;
  if (select count(*) from public.permissions) < 100 then raise exception 'فشل: الكتالوج ناقص'; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then raise exception 'فشل: emp_has_permission'; end if;
  if to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)') is null then raise exception 'فشل: admin_set_profession_permission'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
