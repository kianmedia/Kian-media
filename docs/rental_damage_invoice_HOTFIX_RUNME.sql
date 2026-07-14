-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — DAMAGE SETTLEMENT + AUTO-INVOICE HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- يكمل الدورة المالية للتلف:
--   • أنواع ضرر أوسع (dirty/scratch/dent/broken + السابقة) + اعتراض العميل.
--   • خصم الضرر من التأمين (موجود) + إن تجاوز التأمين أو غاب ⇒ فاتورة تلقائية للفرق
--     داخل جدول invoices الحالي (لا نظام مالي موازٍ)، مصدر rental_damage_charge،
--     ready_for_zoho=true، لا يتوقف الإقفال على Zoho.
--   • المستأجر يرى فاتورته (رقم/مبلغ/حالة/PDF) عبر RLS القياسي + RPC آمن.
-- idempotent · غير هدّام · لا يحذف بيانات · لا يعيد Foundation · بلا Fixtures.
-- يُشغَّل بعد ملفات التأجير + بعد نظام الفواتير. خلف علم rental_finance_enabled.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_charges') is null or to_regclass('public.custody_rental_requests') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if to_regclass('public.invoices') is null then
    raise exception 'PREFLIGHT FAILED — جدول invoices غير موجود (طبّق نظام الفواتير أولًا).';
  end if;
  if to_regprocedure('public.civ_gen_no(text)') is null or to_regprocedure('public.civ_can_finance()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) أعمدة الربط على invoices + الرسوم ───
alter table public.invoices add column if not exists source             text;
alter table public.invoices add column if not exists rental_id          uuid;
alter table public.invoices add column if not exists rental_customer_id uuid;
alter table public.invoices add column if not exists rental_claim_id    uuid;
alter table public.invoices add column if not exists ready_for_zoho     boolean not null default false;
alter table public.invoices add column if not exists description        text;
create index if not exists idx_invoices_rental on public.invoices(rental_id) where rental_id is not null;

alter table public.custody_rental_charges add column if not exists invoice_id uuid;
alter table public.custody_rental_charges add column if not exists objection  text;
-- توسيع أنواع الضرر (مع الحفاظ على السابق).
alter table public.custody_rental_charges drop constraint if exists custody_rental_charges_charge_type_check;
alter table public.custody_rental_charges add constraint custody_rental_charges_charge_type_check
  check (charge_type in ('damage','missing_item','missing_accessory','late_return','misuse','cleaning','other',
    'dirty','scratch','dent','broken'));
commit;

-- ─── 2) اعتماد الرسم + خصم التأمين + فاتورة تلقائية للفرق ───
begin;
create or replace function public.custody_rental_approve_charge(p_charge uuid, p_approved numeric, p_from_deposit numeric default 0, p_additional numeric default 0, p_reject boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch record; r record; v_remaining numeric; v_apply numeric; v_approved numeric; v_due numeric;
        v_inv uuid; v_no text; v_vatrate numeric; v_vat numeric; v_client uuid; v_uid uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_finance() then raise exception 'not authorized: finance only'; end if;
  select * into ch from public.custody_rental_charges where id = p_charge for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if ch.status <> 'reported' then raise exception 'already_decided'; end if;
  if p_reject then
    update public.custody_rental_charges set status = 'rejected', approved_by = auth.uid(), updated_at = now() where id = p_charge;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  v_approved := greatest(0, coalesce(p_approved,0));
  select * into r from public.custody_rental_requests where id = ch.request_id for update;
  v_remaining := greatest(0, r.deposit_received - r.deposit_applied - r.deposit_released);
  v_apply := least(greatest(0, coalesce(p_from_deposit,0)), v_remaining, v_approved);
  v_due := greatest(0, v_approved - v_apply);
  update public.custody_rental_charges set status = 'approved', approved_amount = v_approved,
    from_deposit = v_apply, additional_due = v_due, approved_by = auth.uid(), updated_at = now() where id = p_charge;
  -- خصم التأمين + تحديث حالته (partially/fully_applied حسب المتبقّي).
  if v_apply > 0 then
    update public.custody_rental_requests set deposit_applied = r.deposit_applied + v_apply,
      deposit_status = case
        when (r.deposit_received - (r.deposit_applied + v_apply) - r.deposit_released) <= 0 and r.deposit_received > 0 then 'fully_applied'
        when r.deposit_status in ('held','received') then 'partially_applied' else r.deposit_status end,
      updated_at = now() where id = ch.request_id;
  end if;
  -- فاتورة تلقائية للفرق (إن وُجد) — داخل invoices الحالي، خلف علم المالية.
  if v_due > 0 and public.civ_flag('rental_finance_enabled') then
    v_vatrate := coalesce(r.vat_rate, 15);
    v_vat := round(v_due * v_vatrate / 100.0, 2);
    v_no := public.civ_gen_no('RINV');
    -- ربط بعميل الفواتير إن كان للمستأجر حساب clients (وإلا يبقى null ويُقرأ عبر RPC التأجير الآمن).
    select cc.user_id into v_uid from public.custody_rental_customers cc where cc.id = r.customer_id;
    if v_uid is not null then select cl.id into v_client from public.clients cl where cl.user_id = v_uid and cl.is_deleted = false limit 1; end if;
    insert into public.invoices(invoice_number, client_id, status, currency, subtotal, vat, total,
        public_portal_visible, source, rental_id, rental_customer_id, rental_claim_id, description, ready_for_zoho, created_by)
      values (v_no, v_client, 'draft', coalesce(r.currency,'SAR'), v_due, v_vat, v_due + v_vat,
        true, 'rental_damage_charge', r.id, r.customer_id, p_charge,
        'فاتورة تلف تأجير '||r.request_number||coalesce(' — '||ch.description,''), true, auth.uid())
      returning id into v_inv;
    update public.custody_rental_charges set invoice_id = v_inv where id = p_charge;
    perform public.civ_notify_managers('rental_charges_pending', r.id, 'فاتورة تلف تأجير '||r.request_number||' بمبلغ '||(v_due + v_vat), 'Rental damage invoice '||r.request_number);
    if v_uid is not null then perform public.civ_notify(v_uid, 'rental_charges_pending', r.id, 'صدرت فاتورة أضرار على تأجيرك '||r.request_number||' بمبلغ '||(v_due + v_vat), 'A damage invoice was issued '||r.request_number); end if;
  end if;
  begin perform public.custody_audit('rental_charge_approved','custody_rental_charge', p_charge, jsonb_build_object('approved', v_approved, 'from_deposit', v_apply, 'additional_due', v_due, 'invoice', v_inv)); exception when others then null; end;
  return jsonb_build_object('ok', true, 'status', 'approved', 'from_deposit', v_apply, 'additional_due', v_due, 'invoice_id', v_inv);
end; $$;
commit;

-- ─── 3) تسجيل ضرر مع اعتراض العميل (توسيع add_charge غير مطلوب — objection يُضاف عبر RPC) ───
begin;
create or replace function public.custody_rental_charge_objection(p_charge uuid, p_objection text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch record; r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into ch from public.custody_rental_charges where id = p_charge;
  if ch.id is null then raise exception 'not_found'; end if;
  -- المستأجر صاحب الطلب أو الإدارة.
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = ch.request_id and (c.user_id = auth.uid() or public.civ_can_manage() or public.civ_can_finance());
  if r.id is null then raise exception 'not authorized'; end if;
  if coalesce(trim(p_objection),'') = '' then raise exception 'objection_required'; end if;
  update public.custody_rental_charges set objection = trim(p_objection), updated_at = now() where id = p_charge;
  perform public.civ_notify_managers('rental_damage_reported', ch.request_id, 'اعتراض على رسم تأجير', 'Charge objection');
  return jsonb_build_object('ok', true);
end; $$;

-- ─── 4) قراءة فواتير المستأجر لطلبه (آمنة — للمستأجر الخارجي بلا حساب clients) ───
create or replace function public.custody_rental_customer_invoices(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select exists (select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid()) into v_ok;
  if not v_ok then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'invoice_number', i.invoice_number, 'status', i.status, 'currency', i.currency,
    'subtotal', i.subtotal, 'vat', i.vat, 'total', i.total, 'pdf_url', i.pdf_url,
    'description', i.description, 'created_at', i.created_at) order by i.created_at desc)
    from public.invoices i where i.rental_id = p_request and i.source = 'rental_damage_charge' and not i.is_deleted), '[]'::jsonb);
end; $$;
commit;

-- ─── 5) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_approve_charge(uuid,numeric,numeric,numeric,boolean)',
    'custody_rental_charge_objection(uuid,text)',
    'custody_rental_customer_invoices(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'invoice_rental_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='invoices' and column_name in ('source','rental_id','rental_claim_id','ready_for_zoho');
select 'charge_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_charges' and column_name in ('invoice_id','objection');
select 'charge_types' as k, pg_get_constraintdef(oid) as def from pg_constraint where conname='custody_rental_charges_charge_type_check';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_approve_charge','custody_rental_charge_objection','custody_rental_customer_invoices')
order by p.proname;
