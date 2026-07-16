-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — BATCH 5: محاسب المشروع والرقابة المالية  (نسخة مُصحَّحة الترتيب)
-- يُشغَّل مرة واحدة فوق ملفات Project Core السابقة المطبَّقة. Idempotent · Production-safe
-- · لا حذف بيانات · لا نظام فواتير موازٍ (يربط quotes/invoices القائمة) · لا Foundation.
--
-- سبب الإصلاح: النسخة السابقة عرّفت دالة pc_can_see_finance (language sql — يتحقّق
-- Postgres من جسمها لحظة الإنشاء) قبل إنشاء جدول project_finance_settings الذي تقرؤه
-- → ERROR 42P01. الترتيب الآن: Preflight → الجداول → الفهارس → الدوال → RPCs →
-- Triggers → RLS/Policies → Grants → Validation → NOTIFY → COMMIT.
-- آمن سواء لم يُطبَّق شيء، أو أُعيد تشغيله أكثر من مرة (كل شيء IF NOT EXISTS/OR REPLACE).
--
-- العزل المالي أساسي: كل الجداول والدوال محميّة بـ pc_can_see_finance(project) =
-- المالك/سوبر-أدمن/أدمن(account) أو staff_role=finance أو محاسب المشروع المُعيَّن.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ Preflight — فحص الاعتمادات الأساسية قبل أي تنفيذ (خطأ عربي واضح عند النقص) ═══
do $pf$
begin
  if to_regclass('public.projects') is null then
    raise exception 'الاعتماد المفقود: جدول public.projects غير موجود — طبِّق أساس النظام أولًا.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'الاعتماد المفقود: جدول public.profiles غير موجود — طبِّق أساس النظام أولًا.';
  end if;
  if to_regclass('public.project_shoot_sessions') is null then
    raise exception 'الاعتماد المفقود: جدول public.project_shoot_sessions غير موجود — شغِّل docs/project_core_FINAL_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.is_owner()') is null or to_regprocedure('public.staff_role()') is null then
    raise exception 'الاعتماد المفقود: دوال الصلاحيات is_owner()/staff_role() — شغِّل docs/staff_roles_task_assignment_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.pc_notify_user(uuid,text,text,uuid,text,text)') is null
     or to_regprocedure('public.pc_touch_updated_at()') is null then
    raise exception 'الاعتماد المفقود: دوال Project Core (pc_log/pc_notify_user/pc_touch_updated_at) — شغِّل docs/project_core_FINAL_RUNME.sql أولًا.';
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) الجداول (كلها أولًا — قبل أي دالة أو سياسة تعتمد عليها)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 الإعدادات المالية 1:1 (قيمة العقد/الضريبة/الميزانية/حدود الاعتماد/المحاسب)
create table if not exists public.project_finance_settings (
  project_id             uuid primary key references public.projects(id) on delete cascade,
  accountant_id          uuid references auth.users(id),
  currency               text not null default 'SAR',
  contract_value_excl_vat numeric not null default 0 check (contract_value_excl_vat >= 0),
  discount               numeric not null default 0 check (discount >= 0),
  vat_rate               numeric not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  approved_budget        numeric not null default 0 check (approved_budget >= 0),
  estimated_remaining_cost numeric not null default 0 check (estimated_remaining_cost >= 0),
  target_margin_pct      numeric not null default 25 check (target_margin_pct >= 0 and target_margin_pct <= 100),
  warn_threshold_pct     numeric not null default 80,
  critical_threshold_pct numeric not null default 90,
  approve_limit_accountant numeric not null default 2000,   -- قابلة للإعداد، لا تُفترض في الكود
  approve_limit_admin      numeric not null default 20000,
  closed_snapshot        jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id)
);

-- 1.2 ميزانيات المراحل
create table if not exists public.project_phase_budgets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  phase       text not null,
  allocated   numeric not null default 0 check (allocated >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, phase)
);

-- 1.3 المصروفات (سجل محاسبي بدورة اعتماد)
create table if not exists public.project_expenses (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects(id) on delete cascade,
  phase                text,
  shoot_session_id     uuid references public.project_shoot_sessions(id) on delete set null,
  category             text not null default 'other',
  description          text,
  supplier             text,
  employee_id          uuid references auth.users(id),
  quantity             numeric not null default 1 check (quantity > 0),
  unit_cost            numeric not null default 0 check (unit_cost >= 0),
  amount_excl_vat      numeric not null default 0 check (amount_excl_vat >= 0),
  vat_amount           numeric not null default 0 check (vat_amount >= 0),
  amount_incl_vat      numeric not null default 0 check (amount_incl_vat >= 0),
  recoverable_vat      boolean not null default false,
  kind                 text not null default 'actual' check (kind in ('expected','actual')),
  billable             boolean not null default true,
  payment_status       text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid','refunded')),
  status               text not null default 'draft'
                       check (status in ('draft','submitted','under_review','approved','rejected','scheduled_for_payment','partially_paid','paid','refunded','voided')),
  currency             text not null default 'SAR',
  expense_date         date not null default (now() at time zone 'utc')::date,
  due_date             date,
  paid_date            date,
  payment_method       text,
  supplier_invoice_number text,
  reference_number     text,
  cost_center          text,
  receipt_url          text,
  notes                text,
  entered_by           uuid references auth.users(id),
  approved_by          uuid references auth.users(id),
  approved_at          timestamptz,
  paid_by              uuid references auth.users(id),
  reject_reason        text,
  override_reason      text,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users(id),
  delete_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- 1.4 جدول الإيرادات/التحصيل (يربط بالفواتير القائمة، لا نظام فواتير موازٍ)
create table if not exists public.project_revenue_schedule (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  name             text not null,
  pct              numeric check (pct is null or (pct >= 0 and pct <= 100)),
  amount_excl_vat  numeric not null default 0 check (amount_excl_vat >= 0),
  vat_amount       numeric not null default 0 check (vat_amount >= 0),
  amount_incl_vat  numeric not null default 0 check (amount_incl_vat >= 0),
  due_date         date,
  collected_date   date,
  collected_amount numeric not null default 0 check (collected_amount >= 0),
  status           text not null default 'planned'
                   check (status in ('planned','invoice_pending','invoiced','partially_paid','paid','overdue','cancelled','refunded')),
  invoice_id       uuid,          -- ربط ناعم بجدول invoices القائم (لا FK صلب لتفادي كسر إن اختلف)
  payment_method   text,
  reference_number text,
  notes            text,
  created_by       uuid references auth.users(id),
  is_deleted       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 1.5 التنبيهات المالية
create table if not exists public.project_financial_alerts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  level         text not null check (level in ('info','warning','critical')),
  kind          text not null,
  phase         text,
  message       text not null,
  amount        numeric,
  pct           numeric,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (project_id, kind, phase)
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) الفهارس
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists idx_pexp_project on public.project_expenses(project_id) where is_deleted = false;
create index if not exists idx_pexp_status  on public.project_expenses(status) where is_deleted = false;
create index if not exists idx_prev_project on public.project_revenue_schedule(project_id) where is_deleted = false;
create index if not exists idx_pfa_project  on public.project_financial_alerts(project_id) where resolved_at is null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) دوال العزل المالي (بعد إنشاء الجداول التي تقرؤها — كانت قبلها فسبّبت 42P01)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.pc_can_see_finance(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()                                   -- owner/super_admin/admin(account)
      or public.staff_role() = 'finance'
      or exists (select 1 from public.project_finance_settings s
                 where s.project_id = p_project and s.accountant_id = auth.uid());
$$;
revoke all on function public.pc_can_see_finance(uuid) from public, anon;
grant  execute on function public.pc_can_see_finance(uuid) to authenticated;

-- من يعتمد ماليًا نهائيًا (فوق الحدود) — المالك فقط. من يعتمد إداريًا — أدمن(account)/سوبر.
create or replace function public.pc_finance_is_admin() returns boolean language sql stable
  set search_path = public as $$ select public.is_owner(); $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 تعيين محاسب المشروع (المالك/الأدمن/مدير المالية)
create or replace function public.pc_finance_assign_accountant(p_project uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.staff_role() = 'finance') then raise exception 'not authorized'; end if;
  if p_user is not null and not exists (select 1 from public.profiles where id = p_user and staff_role = 'finance' and account_status = 'active')
    then raise exception 'not_finance_user'; end if;
  insert into public.project_finance_settings(project_id, accountant_id, updated_by)
    values (p_project, p_user, auth.uid())
    on conflict (project_id) do update set accountant_id = excluded.accountant_id, updated_at = now(), updated_by = auth.uid();
  perform public.pc_log(p_project, 'finance_accountant_set', 'finance', p_project, jsonb_build_object('accountant', p_user));
  if p_user is not null then perform public.pc_notify_user(p_user, 'project_note_new', 'project', p_project, 'عُيّنت محاسبًا لمشروع', 'You were assigned as project accountant'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 4.2 الإعدادات المالية (قيمة العقد للمالك/المالية؛ الحدود للمالك فقط)
create or replace function public.pc_finance_settings_set(p_project uuid, p_data jsonb)
returns public.project_finance_settings language plpgsql security definer set search_path = public as $$
declare r public.project_finance_settings; v_admin boolean;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  v_admin := public.is_owner() or public.staff_role() = 'finance';
  insert into public.project_finance_settings(project_id, updated_by) values (p_project, auth.uid()) on conflict (project_id) do nothing;
  update public.project_finance_settings set
    currency               = coalesce(nullif(p_data->>'currency','')::text, currency),
    -- قيمة العقد/الضريبة: للمالك/المالية فقط.
    contract_value_excl_vat = case when v_admin and p_data ? 'contract_value_excl_vat' then coalesce(nullif(p_data->>'contract_value_excl_vat','')::numeric,0) else contract_value_excl_vat end,
    discount               = case when v_admin and p_data ? 'discount' then coalesce(nullif(p_data->>'discount','')::numeric,0) else discount end,
    vat_rate               = case when v_admin and p_data ? 'vat_rate' then coalesce(nullif(p_data->>'vat_rate','')::numeric,15) else vat_rate end,
    approved_budget        = case when v_admin and p_data ? 'approved_budget' then coalesce(nullif(p_data->>'approved_budget','')::numeric,0) else approved_budget end,
    estimated_remaining_cost = case when p_data ? 'estimated_remaining_cost' then coalesce(nullif(p_data->>'estimated_remaining_cost','')::numeric,0) else estimated_remaining_cost end,
    target_margin_pct      = case when v_admin and p_data ? 'target_margin_pct' then coalesce(nullif(p_data->>'target_margin_pct','')::numeric,25) else target_margin_pct end,
    warn_threshold_pct     = case when v_admin and p_data ? 'warn_threshold_pct' then coalesce(nullif(p_data->>'warn_threshold_pct','')::numeric,80) else warn_threshold_pct end,
    critical_threshold_pct = case when v_admin and p_data ? 'critical_threshold_pct' then coalesce(nullif(p_data->>'critical_threshold_pct','')::numeric,90) else critical_threshold_pct end,
    approve_limit_accountant = case when public.is_owner() and p_data ? 'approve_limit_accountant' then coalesce(nullif(p_data->>'approve_limit_accountant','')::numeric,2000) else approve_limit_accountant end,
    approve_limit_admin      = case when public.is_owner() and p_data ? 'approve_limit_admin' then coalesce(nullif(p_data->>'approve_limit_admin','')::numeric,20000) else approve_limit_admin end,
    updated_at = now(), updated_by = auth.uid()
    where project_id = p_project returning * into r;
  perform public.pc_log(p_project, 'finance_settings_set', 'finance', p_project, '{}');
  return r;
end $$;

-- 4.3 ميزانية مرحلة
create or replace function public.pc_phase_budget_upsert(p_project uuid, p_phase text, p_allocated numeric, p_note text default null)
returns public.project_phase_budgets language plpgsql security definer set search_path = public as $$
declare r public.project_phase_budgets;
begin
  if not (public.is_owner() or public.staff_role() = 'finance'
          or exists (select 1 from public.project_finance_settings s where s.project_id = p_project and s.accountant_id = auth.uid()))
    then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_phase),'') = '' then raise exception 'phase_required'; end if;
  insert into public.project_phase_budgets(project_id, phase, allocated, note)
    values (p_project, btrim(p_phase), greatest(coalesce(p_allocated,0),0), nullif(btrim(p_note),''))
    on conflict (project_id, phase) do update set allocated = greatest(coalesce(excluded.allocated,0),0), note = coalesce(excluded.note, project_phase_budgets.note), updated_at = now()
    returning * into r;
  perform public.pc_log(p_project, 'phase_budget_set', 'finance', p_project, jsonb_build_object('phase', p_phase));
  return r;
end $$;

-- 4.4 إنشاء مصروف (مسودّة) — يحسب VAT تلقائيًا من الصافي إن لم يُعطَ
create or replace function public.pc_expense_create(p_project uuid, p_data jsonb)
returns public.project_expenses language plpgsql security definer set search_path = public as $$
declare r public.project_expenses; v_excl numeric; v_vat numeric; v_rate numeric;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  select vat_rate into v_rate from public.project_finance_settings where project_id = p_project;
  v_rate := coalesce(v_rate, 15);
  v_excl := coalesce(nullif(p_data->>'amount_excl_vat','')::numeric,
                     coalesce(nullif(p_data->>'unit_cost','')::numeric,0) * coalesce(nullif(p_data->>'quantity','')::numeric,1));
  v_vat  := coalesce(nullif(p_data->>'vat_amount','')::numeric, round(v_excl * v_rate / 100.0, 2));
  insert into public.project_expenses(project_id, phase, shoot_session_id, category, description, supplier,
      employee_id, quantity, unit_cost, amount_excl_vat, vat_amount, amount_incl_vat, recoverable_vat, kind,
      billable, currency, expense_date, due_date, payment_method, supplier_invoice_number, reference_number,
      cost_center, receipt_url, notes, entered_by)
    values (p_project, nullif(btrim(p_data->>'phase'),''), nullif(p_data->>'shoot_session_id','')::uuid,
      coalesce(nullif(btrim(p_data->>'category'),''),'other'), nullif(btrim(p_data->>'description'),''), nullif(btrim(p_data->>'supplier'),''),
      nullif(p_data->>'employee_id','')::uuid, coalesce(nullif(p_data->>'quantity','')::numeric,1), coalesce(nullif(p_data->>'unit_cost','')::numeric,0),
      v_excl, v_vat, v_excl + v_vat, coalesce((p_data->>'recoverable_vat')::boolean,false),
      coalesce(nullif(p_data->>'kind',''),'actual'), coalesce((p_data->>'billable')::boolean,true),
      coalesce(nullif(p_data->>'currency',''),'SAR'), coalesce(nullif(p_data->>'expense_date','')::date,(now() at time zone 'utc')::date),
      nullif(p_data->>'due_date','')::date, nullif(btrim(p_data->>'payment_method'),''), nullif(btrim(p_data->>'supplier_invoice_number'),''),
      nullif(btrim(p_data->>'reference_number'),''), nullif(btrim(p_data->>'cost_center'),''), nullif(btrim(p_data->>'receipt_url'),''),
      nullif(btrim(p_data->>'notes'),''), auth.uid())
    returning * into r;
  perform public.pc_log(p_project, 'expense_created', 'expense', r.id, jsonb_build_object('amount', r.amount_incl_vat));
  return r;
end $$;

-- 4.5 انتقالات دورة المصروف — منع Double Approval/Payment + حارس الصرف الزائد
create or replace function public.pc_expense_transition(p_expense uuid, p_action text, p_reason text default null, p_override boolean default false)
returns public.project_expenses language plpgsql security definer set search_path = public as $$
declare r record; s record; v_actual numeric; v_committed numeric; v_after numeric; v_can_approve boolean;
begin
  select * into r from public.project_expenses where id = p_expense and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.pc_can_see_finance(r.project_id) then raise exception 'not authorized'; end if;
  select * into s from public.project_finance_settings where project_id = r.project_id;

  if p_action = 'submit' then
    if r.status <> 'draft' then raise exception 'bad_state'; end if;
    update public.project_expenses set status = 'submitted' where id = p_expense;
  elsif p_action = 'review' then
    if r.status not in ('submitted') then raise exception 'bad_state'; end if;
    update public.project_expenses set status = 'under_review' where id = p_expense;
  elsif p_action = 'reject' then
    if r.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
    update public.project_expenses set status = 'rejected', reject_reason = left(p_reason,500) where id = p_expense;
  elsif p_action = 'approve' then
    if r.status not in ('submitted','under_review') then raise exception 'bad_state'; end if;   -- منع Double Approval
    perform 1 from public.project_finance_settings where project_id = r.project_id for update;   -- تسلسل الاعتمادات لكل مشروع (يمنع سباق تجاوز الميزانية)
    -- صلاحية الاعتماد حسب الحد المُعدّ: حتى حدّ المحاسب أي مالي يعتمد؛ فوقه المالك فقط
    -- (لا يوجد دور وسيط بين المالية والمالك، فحدّ المحاسب هو السقف الفعلي لغير المالك).
    if r.amount_incl_vat <= coalesce(s.approve_limit_accountant, 2000) then v_can_approve := public.pc_can_see_finance(r.project_id);
    else v_can_approve := public.is_owner(); end if;
    if not v_can_approve then raise exception 'approval_limit'; end if;
    -- حارس الصرف الزائد بأساس التكلفة (صافي + ضريبة غير مستردّة) مقابل الميزانية المعتمدة.
    select coalesce(sum(amount_excl_vat + case when recoverable_vat then 0 else vat_amount end),0) into v_actual from public.project_expenses
      where project_id = r.project_id and is_deleted = false and status in ('approved','scheduled_for_payment','partially_paid','paid');
    v_after := v_actual + (r.amount_excl_vat + case when r.recoverable_vat then 0 else r.vat_amount end);
    if coalesce(s.approved_budget,0) > 0 and v_after > s.approved_budget then
      -- تجاوز 100%: المالك فقط + سبب + تأكيد (override).
      if not public.is_owner() then raise exception 'over_budget'; end if;
      if not p_override or coalesce(btrim(p_reason),'') = '' then raise exception 'override_required'; end if;
      update public.project_expenses set override_reason = left(p_reason,500) where id = p_expense;
    end if;
    update public.project_expenses set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_expense;
  elsif p_action = 'pay' then
    if r.status not in ('approved','scheduled_for_payment','partially_paid') then raise exception 'bad_state'; end if;   -- منع Double Payment
    update public.project_expenses set status = 'paid', payment_status = 'paid', paid_by = auth.uid(),
      paid_date = coalesce(r.paid_date, (now() at time zone 'utc')::date),
      payment_method = coalesce(nullif(btrim(p_reason),''), r.payment_method) where id = p_expense;
  elsif p_action = 'void' then
    if r.status = 'paid' then raise exception 'cannot_void_paid'; end if;
    if not public.is_owner() and not (public.staff_role()='finance') then raise exception 'not authorized'; end if;
    update public.project_expenses set status = 'voided' where id = p_expense;
  else raise exception 'bad_action'; end if;

  perform public.pc_log(r.project_id, 'expense_'||p_action, 'expense', p_expense, '{}');
  select * into r from public.project_expenses where id = p_expense;
  -- إشعار المالية عند الاعتماد/التجاوز.
  if p_action = 'approve' then perform public.pc_notify_user(r.entered_by, 'project_note_new', 'expense', p_expense, 'اعتُمد مصروفك', 'Your expense was approved'); end if;
  return r;
end $$;

-- 4.6 حذف مصروف ناعم (لا للمعتمد/المدفوع إلا المالك)
create or replace function public.pc_expense_delete(p_expense uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.project_expenses where id = p_expense and is_deleted = false;
  if r.id is null then raise exception 'not_found'; end if;
  if not (public.is_owner() or public.staff_role()='finance'
          or exists (select 1 from public.project_finance_settings s where s.project_id=r.project_id and s.accountant_id=auth.uid()))
    then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if r.status in ('approved','scheduled_for_payment','partially_paid','paid') and not public.is_owner()
    then raise exception 'cannot_delete_approved'; end if;   -- لا حذف معتمد/مدفوع إلا المالك
  update public.project_expenses set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(p_reason,500) where id = p_expense;
  perform public.pc_log(r.project_id, 'expense_deleted', 'expense', p_expense, '{}');
  return true;
end $$;

-- 4.7 دفعة إيراد (upsert)
create or replace function public.pc_revenue_upsert(p_project uuid, p_data jsonb)
returns public.project_revenue_schedule language plpgsql security definer set search_path = public as $$
declare r public.project_revenue_schedule; v_id uuid := nullif(p_data->>'id','')::uuid; v_excl numeric; v_vat numeric; v_rate numeric;
begin
  if not (public.is_owner() or public.staff_role()='finance'
          or exists (select 1 from public.project_finance_settings s where s.project_id=p_project and s.accountant_id=auth.uid()))
    then raise exception 'not authorized'; end if;
  select vat_rate into v_rate from public.project_finance_settings where project_id = p_project; v_rate := coalesce(v_rate,15);
  v_excl := coalesce(nullif(p_data->>'amount_excl_vat','')::numeric,0);
  v_vat  := coalesce(nullif(p_data->>'vat_amount','')::numeric, round(v_excl*v_rate/100.0,2));
  if v_id is null then
    insert into public.project_revenue_schedule(project_id, name, pct, amount_excl_vat, vat_amount, amount_incl_vat, due_date, status, invoice_id, notes, created_by)
      values (p_project, coalesce(nullif(btrim(p_data->>'name'),''),'دفعة'), nullif(p_data->>'pct','')::numeric, v_excl, v_vat, v_excl+v_vat,
        nullif(p_data->>'due_date','')::date, coalesce(nullif(p_data->>'status',''),'planned'), nullif(p_data->>'invoice_id','')::uuid, nullif(btrim(p_data->>'notes'),''), auth.uid())
      returning * into r;
  else
    update public.project_revenue_schedule set name=coalesce(nullif(btrim(p_data->>'name'),''),name),
      amount_excl_vat=coalesce(nullif(p_data->>'amount_excl_vat','')::numeric,amount_excl_vat),
      vat_amount=case when p_data ? 'amount_excl_vat' then v_vat else vat_amount end,
      amount_incl_vat=case when p_data ? 'amount_excl_vat' then v_excl+v_vat else amount_incl_vat end,
      due_date=coalesce(nullif(p_data->>'due_date','')::date,due_date), status=coalesce(nullif(p_data->>'status',''),status),
      collected_amount=coalesce(nullif(p_data->>'collected_amount','')::numeric,collected_amount),
      collected_date=coalesce(nullif(p_data->>'collected_date','')::date,collected_date), updated_at=now()
      where id=v_id and project_id=p_project returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  perform public.pc_log(p_project, 'revenue_upsert', 'finance', p_project, '{}');
  return r;
end $$;

-- 4.8 ملخّص الربحية — VAT مستبعدة، حماية القسمة على صفر
create or replace function public.pc_finance_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; v_net numeric; v_actual numeric; v_committed numeric; v_forecast numeric;
        v_collected numeric; v_receivable numeric; v_actual_profit numeric; v_proj_profit numeric;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  select * into s from public.project_finance_settings where project_id = p_project;
  v_net := coalesce(s.contract_value_excl_vat,0) - coalesce(s.discount,0);
  -- التكلفة = الصافي + ضريبة غير قابلة للاسترداد (لا تُحتسب الضريبة القابلة للاسترداد تكلفةً).
  -- الفعلي = المدفوع فعليًا؛ الملتزَم = المعتمد غير المدفوع (منفصلان لا تداخل).
  select coalesce(sum(amount_excl_vat + case when recoverable_vat then 0 else vat_amount end),0) into v_actual from public.project_expenses
    where project_id=p_project and is_deleted=false and status = 'paid';
  select coalesce(sum(amount_excl_vat + case when recoverable_vat then 0 else vat_amount end),0) into v_committed from public.project_expenses
    where project_id=p_project and is_deleted=false and status in ('approved','scheduled_for_payment','partially_paid');
  v_forecast := v_actual + v_committed + coalesce(s.estimated_remaining_cost,0);
  select coalesce(sum(collected_amount),0) into v_collected from public.project_revenue_schedule where project_id=p_project and is_deleted=false;
  v_receivable := greatest(0, v_net - v_collected);
  v_actual_profit := v_net - v_actual;
  v_proj_profit   := v_net - v_forecast;
  return jsonb_build_object(
    'currency', coalesce(s.currency,'SAR'),
    'net_revenue', v_net,
    'contract_incl_vat', v_net + round(v_net*coalesce(s.vat_rate,15)/100.0,2),
    'approved_budget', coalesce(s.approved_budget,0),
    'actual_cost', v_actual,
    'committed_cost', v_committed,
    'forecast_cost', v_forecast,
    'remaining_budget', coalesce(s.approved_budget,0) - v_actual - v_committed,
    'budget_used_pct', case when coalesce(s.approved_budget,0) > 0 then round((v_actual+v_committed)/s.approved_budget*100,1) else 0 end,
    'collected', v_collected,
    'receivable', v_receivable,
    'actual_profit', v_actual_profit,
    'projected_profit', v_proj_profit,
    'actual_margin_pct', case when v_net > 0 then round(v_actual_profit/v_net*100,1) else 0 end,
    'projected_margin_pct', case when v_net > 0 then round(v_proj_profit/v_net*100,1) else 0 end,
    'budget_variance', coalesce(s.approved_budget,0) - v_actual - v_committed,
    'target_margin_pct', coalesce(s.target_margin_pct,25),
    'pending_expenses', (select count(*) from public.project_expenses where project_id=p_project and is_deleted=false and status in ('draft','submitted','under_review')),
    'open_alerts', (select count(*) from public.project_financial_alerts where project_id=p_project and resolved_at is null),
    'accountant_id', s.accountant_id,
    'projected_loss', (v_proj_profit < 0)
  );
end $$;

-- 4.9 إعادة توليد التنبيهات المالية (on-demand)
create or replace function public.pc_finance_alerts_recompute(p_project uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s record; sm jsonb; v_n int := 0; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  delete from public.project_financial_alerts where project_id = p_project and resolved_at is null;
  select * into s from public.project_finance_settings where project_id = p_project;
  sm := public.pc_finance_summary(p_project);
  -- ميزانية المشروع.
  if (sm->>'budget_used_pct')::numeric >= coalesce(s.critical_threshold_pct,90) and (sm->>'budget_used_pct')::numeric < 100 then
    insert into public.project_financial_alerts(project_id, level, kind, message, pct) values (p_project,'critical','budget_critical','استهلاك حرج لميزانية المشروع',(sm->>'budget_used_pct')::numeric) on conflict do nothing; v_n:=v_n+1;
  elsif (sm->>'budget_used_pct')::numeric >= coalesce(s.warn_threshold_pct,80) then
    insert into public.project_financial_alerts(project_id, level, kind, message, pct) values (p_project,'warning','budget_warning','اقتراب استهلاك ميزانية المشروع',(sm->>'budget_used_pct')::numeric) on conflict do nothing; v_n:=v_n+1;
  end if;
  if (sm->>'budget_used_pct')::numeric >= 100 then
    insert into public.project_financial_alerts(project_id, level, kind, message, pct) values (p_project,'critical','budget_over','تجاوز ميزانية المشروع',(sm->>'budget_used_pct')::numeric) on conflict do nothing; v_n:=v_n+1;
  end if;
  if (sm->>'projected_loss')::boolean then
    insert into public.project_financial_alerts(project_id, level, kind, message, amount) values (p_project,'critical','projected_loss','المشروع متوقع أن يحقق خسارة',(sm->>'projected_profit')::numeric) on conflict do nothing; v_n:=v_n+1;
  elsif (sm->>'projected_margin_pct')::numeric < coalesce(s.target_margin_pct,25) then
    insert into public.project_financial_alerts(project_id, level, kind, message, pct) values (p_project,'warning','low_margin','هامش الربح أقل من المستهدف',(sm->>'projected_margin_pct')::numeric) on conflict do nothing; v_n:=v_n+1;
  end if;
  -- دفعات متأخرة.
  if exists (select 1 from public.project_revenue_schedule where project_id=p_project and is_deleted=false and status not in ('paid','cancelled','refunded') and due_date is not null and due_date < v_today) then
    insert into public.project_financial_alerts(project_id, level, kind, message) values (p_project,'warning','overdue_payment','توجد دفعات عميل متأخرة') on conflict do nothing; v_n:=v_n+1;
  end if;
  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Triggers (بعد الجداول والدالة pc_touch_updated_at الموجودة مسبقًا)
-- ════════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_pfs_touch on public.project_finance_settings;
create trigger trg_pfs_touch before update on public.project_finance_settings for each row execute function public.pc_touch_updated_at();
drop trigger if exists trg_pexp_touch on public.project_expenses;
create trigger trg_pexp_touch before update on public.project_expenses for each row execute function public.pc_touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 6) RLS + Policies (بعد الجداول والدالة pc_can_see_finance)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_finance_settings   enable row level security;
alter table public.project_phase_budgets      enable row level security;
alter table public.project_expenses           enable row level security;
alter table public.project_revenue_schedule   enable row level security;
alter table public.project_financial_alerts   enable row level security;

drop policy if exists pfs_read on public.project_finance_settings;
create policy pfs_read on public.project_finance_settings for select to authenticated using (public.pc_can_see_finance(project_id));
drop policy if exists ppb_read on public.project_phase_budgets;
create policy ppb_read on public.project_phase_budgets for select to authenticated using (public.pc_can_see_finance(project_id));
drop policy if exists pexp_read on public.project_expenses;
create policy pexp_read on public.project_expenses for select to authenticated using (public.pc_can_see_finance(project_id));
drop policy if exists prev_read on public.project_revenue_schedule;
create policy prev_read on public.project_revenue_schedule for select to authenticated using (public.pc_can_see_finance(project_id));
drop policy if exists pfa_read on public.project_financial_alerts;
create policy pfa_read on public.project_financial_alerts for select to authenticated using (public.pc_can_see_finance(project_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Grants/Revoke
-- ════════════════════════════════════════════════════════════════════════════
grant select on public.project_finance_settings, public.project_phase_budgets, public.project_expenses,
  public.project_revenue_schedule, public.project_financial_alerts to authenticated;   -- الكتابة عبر RPCs فقط

do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'pc_finance_assign_accountant(uuid,uuid)','pc_finance_settings_set(uuid,jsonb)','pc_phase_budget_upsert(uuid,text,numeric,text)',
    'pc_expense_create(uuid,jsonb)','pc_expense_transition(uuid,text,text,boolean)','pc_expense_delete(uuid,text)',
    'pc_revenue_upsert(uuid,jsonb)','pc_finance_summary(uuid)','pc_finance_alerts_recompute(uuid)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $g$;
revoke all on function public.pc_finance_is_admin() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Validation داخل المعاملة — يرفع خطأ عربيًا واضحًا لو نقص شيء
-- ════════════════════════════════════════════════════════════════════════════
do $v$
declare n int;
begin
  select count(*) into n from information_schema.tables where table_schema='public'
    and table_name in ('project_finance_settings','project_phase_budgets','project_expenses','project_revenue_schedule','project_financial_alerts');
  if n <> 5 then raise exception 'فشل التحقق: عدد الجداول المالية % من 5.', n; end if;
  if to_regprocedure('public.pc_can_see_finance(uuid)') is null then raise exception 'فشل التحقق: دالة pc_can_see_finance غير موجودة.'; end if;
  select count(*) into n from pg_proc where proname = 'pc_expense_transition';
  if n <> 1 then raise exception 'فشل التحقق: pc_expense_transition لها % نسخة (Overload متعارض).', n; end if;
  select count(*) into n from pg_class where relname in ('project_finance_settings','project_expenses') and relrowsecurity = true;
  if n <> 2 then raise exception 'فشل التحقق: RLS غير مفعّلة على الجداول المالية.'; end if;
end $v$;

notify pgrst, 'reload schema';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- فحوص قراءة اختيارية بعد التطبيق (لا تُعدّل شيئًا)
-- ════════════════════════════════════════════════════════════════════════════
select count(*) as finance_tables from information_schema.tables where table_schema='public'
  and table_name in ('project_finance_settings','project_phase_budgets','project_expenses','project_revenue_schedule','project_financial_alerts');
select proname, has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') an
  from pg_proc where proname in ('pc_can_see_finance','pc_finance_assign_accountant','pc_finance_settings_set','pc_expense_create',
    'pc_expense_transition','pc_finance_summary','pc_finance_alerts_recompute') order by proname;
select relname, relrowsecurity from pg_class where relname in ('project_expenses','project_finance_settings','project_revenue_schedule') order by relname;
