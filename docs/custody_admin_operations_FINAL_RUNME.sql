-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — مركز إدارة العهد والإرجاع (قراءة إدارية مُثرّاة) — نظام مخزون الأصول
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة: تبويب «العهد والإرجاع» كان يقرأ custody_inventory_assignments خامًا
-- (يعرض employee_user_id UUID + status تقنيًا + رقم الحركة) بلا ربط باسم الموظف أو
-- اسم المعدة أو حساب التأخير. الإصلاح: RPC قراءة واحدة مُثرّاة تُرجع بيانات بشرية كاملة
-- + عدّادات، على نفس نظام مخزون الأصول (لا نظام موازٍ، لا جداول جديدة).
--
-- idempotent، غير هدّام، بلا Fixtures، لا يعيد Foundation، لا يلمس التأجير.
-- الصلاحية: civ_can_manage() (المالك/سوبر أدمن/admin/مدير/أمين عهدة). لا anon.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.civ_can_manage()') is null
     or to_regclass('public.custody_inventory_assignments') is null
     or to_regclass('public.custody_inventory_assignment_items') is null then
    raise exception 'PREFLIGHT: أساس مخزون الأصول غير مطبّق';
  end if;
  -- الدالة تُثري ببيانات HR (المسمى/القسم) والمشاريع؛ الجدولان مُشار إليهما في SQL ثابت
  -- (يُخطَّط كاملًا قبل التنفيذ) فلا يجدي حارس منطقي. نشترطهما هنا ليفشل التثبيت بوضوح
  -- بدل الفشل عند كل نداء. قاعدة كيان الحالية تحوي الجدولين.
  if to_regclass('public.hr_employee_profiles') is null then
    raise exception 'PREFLIGHT: hr_employee_profiles مفقود — شغّل بوابة الموظف (portal_hr_employee_portal_RUNME.sql) أولًا';
  end if;
  if to_regclass('public.projects') is null then
    raise exception 'PREFLIGHT: projects مفقود — شغّل أساس البوابة (phase0_migration.sql) أولًا';
  end if;
end $$;

begin;

create or replace function public.custody_admin_custody_dashboard(
  p_status        text    default null,
  p_search        text    default null,
  p_employee_id   uuid    default null,
  p_project_id    uuid    default null,
  p_overdue_only  boolean default false,
  p_limit         int     default 50,
  p_offset        int     default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows     jsonb;
  v_counters jsonb;
  v_lim      int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off      int := greatest(0, coalesce(p_offset, 0));
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;

  -- ─── العدّادات (كل العهد الحيّة) ───
  select jsonb_build_object(
    'total_active',     count(*) filter (where status in ('pending_employee_confirmation','active','return_requested','under_inspection','partially_returned')),
    'active',           count(*) filter (where status = 'active'),
    'pending_confirm',  count(*) filter (where status = 'pending_employee_confirmation'),
    'due_today',        count(*) filter (where status = 'active' and expected_return_at is not null
                                          and (expected_return_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date),
    'overdue',          count(*) filter (where status in ('active','return_requested','under_inspection')
                                          and expected_return_at is not null and expected_return_at < now()),
    'return_requested', count(*) filter (where status = 'return_requested'),
    'under_inspection', count(*) filter (where status = 'under_inspection'),
    'returned',         count(*) filter (where status in ('returned','partially_returned'))
  ) into v_counters
  from public.custody_inventory_assignments where is_deleted = false;

  -- ─── الصفوف المُثرّاة (مع فلترة/بحث) ───
  with base as (
    select
      a.id, a.assignment_number, a.status, a.assignment_type, a.purpose,
      a.employee_user_id, a.project_id, a.issued_at, a.expected_return_at,
      a.employee_confirmed_at, a.employee_note, a.custodian_note,
      coalesce(nullif(btrim(pr.full_name),''), nullif(btrim(hr.full_name),''), pr.email, 'موظف') as emp_name,
      hr.job_title as emp_job,
      hr.department as emp_dept,
      coalesce(pr.mobile, hr.phone) as emp_mobile,
      coalesce(pr.email,  hr.email) as emp_email,
      pr.account_status as emp_account_status,
      pj.project_name as project_name
    from public.custody_inventory_assignments a
    left join public.profiles pr on pr.id = a.employee_user_id
    left join lateral (
      select hep.full_name, hep.job_title, hep.department, hep.phone, hep.email
      from public.hr_employee_profiles hep
      where hep.user_id = a.employee_user_id and hep.is_deleted = false
      limit 1
    ) hr on true
    left join public.projects pj on pj.id = a.project_id
    where a.is_deleted = false
      and (p_status is null or a.status = p_status)
      and (p_employee_id is null or a.employee_user_id = p_employee_id)
      and (p_project_id  is null or a.project_id = p_project_id)
      and (not p_overdue_only or (a.expected_return_at is not null and a.expected_return_at < now()
                                   and a.status in ('active','return_requested','under_inspection')))
      and (nullif(btrim(p_search),'') is null or (
            a.assignment_number ilike '%'||p_search||'%'
        or coalesce(pr.full_name,'') ilike '%'||p_search||'%'
        or coalesce(pr.mobile,'')    ilike '%'||p_search||'%'
        or coalesce(pr.email,'')     ilike '%'||p_search||'%'
        or coalesce(pj.project_name,'') ilike '%'||p_search||'%'
        or exists (select 1 from public.custody_inventory_assignment_items ai
                    join public.custody_inventory_assets ast on ast.id = ai.asset_id
                   where ai.assignment_id = a.id
                     and (ast.asset_name ilike '%'||p_search||'%' or ast.asset_code ilike '%'||p_search||'%'
                          or coalesce(ast.serial_number,'') ilike '%'||p_search||'%'))
      ))
  ),
  row_data as (
    select
      b.id as custody_id, b.assignment_number as custody_number, b.status,
      b.employee_user_id, b.emp_name as employee_name, b.emp_job as employee_job_title,
      b.emp_dept as employee_department, b.emp_mobile as employee_mobile, b.emp_email as employee_email,
      b.emp_account_status as employee_account_status,
      b.project_id, b.project_name, b.assignment_type, b.purpose,
      b.issued_at, b.expected_return_at, b.employee_confirmed_at,
      (b.employee_confirmed_at is not null) as employee_confirmed,
      case when b.expected_return_at is null or b.expected_return_at <= now() then 0
           else floor(extract(epoch from (b.expected_return_at - now())))::bigint end as remaining_seconds,
      case when b.expected_return_at is not null and b.expected_return_at < now()
                and b.status in ('active','return_requested','under_inspection')
           then floor(extract(epoch from (now() - b.expected_return_at)))::bigint else 0 end as overdue_seconds,
      (select count(*) from public.custody_inventory_assignment_items ai where ai.assignment_id = b.id) as item_count,
      (select coalesce(jsonb_agg(jsonb_build_object(
                 'item_id', ai.id, 'asset_id', ai.asset_id, 'asset_name', ast.asset_name,
                 'asset_code', ast.asset_code, 'serial_number', ast.serial_number,
                 'brand', ast.brand, 'model', ast.model,
                 'quantity', ai.quantity, 'quantity_returned', ai.quantity_returned,
                 'condition_at_issue', ai.condition_at_issue, 'condition_at_return', ai.condition_at_return,
                 'status', ai.status,
                 'photo_path', (select f.file_path from public.custody_inventory_asset_files f
                                 where f.asset_id = ai.asset_id and f.file_type = 'asset_photo' and f.is_deleted = false
                                 order by f.created_at asc limit 1)
               ) order by ai.created_at), '[]'::jsonb)
       from public.custody_inventory_assignment_items ai
       join public.custody_inventory_assets ast on ast.id = ai.asset_id
       where ai.assignment_id = b.id) as items,
      (select count(*) from public.custody_inventory_evidence e
        where e.assignment_id = b.id and e.evidence_stage = 'damage' and coalesce(e.is_deleted,false) = false) as issue_count,
      -- أعلام الإجراءات (الإنفاذ الفعلي داخل كل RPC — هذه للعرض فقط)
      (b.status = 'pending_employee_confirmation') as can_resend_confirm,
      (b.status in ('active','return_requested')) as can_request_return,
      (b.status in ('return_requested','under_inspection')) as can_inspect,
      (b.status in ('under_inspection','partially_returned')) as can_close,
      (b.status in ('draft','pending_employee_confirmation')) as can_cancel
    from base b
    order by overdue_seconds desc, b.issued_at desc
    limit v_lim offset v_off
  )
  select jsonb_build_object(
    'total_count', (select count(*) from base),
    'counters', v_counters,
    'rows', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.overdue_seconds desc, row_data.issued_at desc) from row_data), '[]'::jsonb)
  ) into v_rows;

  return v_rows;
end $$;
revoke all on function public.custody_admin_custody_dashboard(text,text,uuid,uuid,boolean,int,int) from public, anon;
grant  execute on function public.custody_admin_custody_dashboard(text,text,uuid,uuid,boolean,int,int) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'fn' as k, pg_get_function_identity_arguments(oid) as args,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('anon', oid, 'execute') as anon_exec
  from pg_proc where proname = 'custody_admin_custody_dashboard';
select 'overloads' as k, count(*) as n from pg_proc where proname = 'custody_admin_custody_dashboard';   -- يجب = 1
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (يدوي):
-- begin;
--   drop function if exists public.custody_admin_custody_dashboard(text,text,uuid,uuid,boolean,int,int);
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
