-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental & Insurance V1 — بيانات تجريبية (PREVIEW/TEST فقط — لا Production)
-- ────────────────────────────────────────────────────────────────────────────
-- تُنشئ عملاء + طلبات تأجير في حالات مختلفة تشير إلى أصول حقيقية موجودة.
-- كل السجلات مُعلَّمة internal_note = 'FIXTURE' للتنظيف السهل.
-- شغّل بعد rental_insurance_production_RUNME.sql. آمن للتكرار (يحذف FIXTURE ثم يعيد الإنشاء).
-- ⚠️ لا تشغّله على Production.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- تنظيف أي fixtures سابقة (آمن — يحذف الطلبات المعلّمة فقط وأبناءها بالـcascade).
delete from public.custody_rental_requests where internal_note = 'FIXTURE';
delete from public.custody_rental_customers where notes = 'FIXTURE';

do $$
declare v_ind uuid; v_co uuid; v_a1 uuid; v_a2 uuid; v_r uuid;
begin
  -- عميلان.
  insert into public.custody_rental_customers(party_type, full_name, phone, email, notes)
    values ('individual','عميل تجريبي (فرد)','0500000001','ind@example.test','FIXTURE') returning id into v_ind;
  insert into public.custody_rental_customers(party_type, full_name, company_name, phone, email, notes)
    values ('company','مسؤول','شركة تجريبية','0500000002','co@example.test','FIXTURE') returning id into v_co;

  -- أول أصلين متاحين (متسلسل/كمي إن وُجد).
  select id into v_a1 from public.custody_inventory_assets where is_deleted=false and quantity_available>0 order by asset_type desc, asset_name limit 1;
  select id into v_a2 from public.custody_inventory_assets where is_deleted=false and quantity_available>0 and id <> coalesce(v_a1,'00000000-0000-0000-0000-000000000000') order by asset_name limit 1;

  -- 1) مسودة.
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, rate_type, purpose, internal_note)
    values ('FX-DRAFT-'||to_char(now(),'HH24MISS'), v_ind, 'draft', now()+interval '2 day', now()+interval '5 day', 'daily', 'اختبار مسودة', 'FIXTURE') returning id into v_r;
  if v_a1 is not null then insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status) values (v_r, v_a1, 1, 1, 'reserved'); end if;

  -- 2) بانتظار الاعتماد.
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, rate_type, purpose, subtotal, vat_rate, vat_amount, grand_total, deposit_amount, deposit_status, internal_note)
    values ('FX-PEND-'||to_char(now(),'HH24MISS'), v_co, 'pending_approval', now()+interval '3 day', now()+interval '7 day', 'daily', 'اختبار اعتماد', 1000, 15, 150, 1150, 500, 'pending', 'FIXTURE') returning id into v_r;
  if v_a2 is not null then insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status) values (v_r, v_a2, 1, 1, 'reserved'); end if;

  -- 3) نشط + متأخر (نهاية بالأمس) لاختبار overdue.
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, actual_handover_at, subtotal, vat_rate, vat_amount, grand_total, deposit_amount, deposit_status, deposit_received, internal_note)
    values ('FX-OVERDUE-'||to_char(now(),'HH24MISS'), v_ind, 'active', now()-interval '5 day', now()-interval '1 day', now()-interval '5 day', 800, 15, 120, 920, 300, 'held', 300, 'FIXTURE') returning id into v_r;
  if v_a1 is not null then insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status) values (v_r, v_a1, 1, 1, 'issued'); end if;
end $$;

commit;

-- تقرير.
select 'fixtures' as k, count(*) as customers from public.custody_rental_customers where notes='FIXTURE';
select status, count(*) from public.custody_rental_requests where internal_note='FIXTURE' group by status;

-- للتنظيف لاحقًا:
-- delete from public.custody_rental_requests where internal_note='FIXTURE';
-- delete from public.custody_rental_customers where notes='FIXTURE';
