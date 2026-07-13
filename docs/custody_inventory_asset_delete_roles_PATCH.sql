-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Inventory: توسيع صلاحية حذف/استعادة الأصل (idempotent، صغير مستقل)
-- ────────────────────────────────────────────────────────────────────────────
-- يوسّع civ_can_delete_asset() من (account_type='admin' فقط) إلى:
--        المالك + السوبر أدمن + الأدمن  =  account_type='admin' OR staff_role='super_admin' (نشط).
-- يظل الحذف/الاستعادة ممنوعًا عن: custody_officer / manager / finance / employee / client / renter / غيرهم.
--
-- كل دوال الحذف/الاستعادة تستدعي civ_can_delete_asset() داخليًا، لذا تعديل هذه الدالة
-- وحدها يُحدّث تلقائيًا:
--   custody_inv_admin_delete_asset · custody_inv_admin_restore_asset ·
--   custody_inv_admin_list_deleted_assets · custody_inv_admin_archive_asset · custody_inv_can_delete
-- (والواجهة تقرأ custody_inv_can_delete فتُظهر/تُخفي الأزرار وفق النتيجة).
--
-- يُشغَّل بعد: docs/custody_inventory_asset_soft_delete_PATCH.sql (أو بدله إن لم يُشغَّل بعد).
-- لا يلمس: قواعد منع الحذف، آلية Soft Delete، سبب الحذف، أو أي دالة أخرى.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.civ_can_delete_asset() returns boolean
language sql stable security definer set search_path = public as $$
  -- المالك/الأدمن = account_type='admin' ؛ السوبر أدمن = staff_role='super_admin' ؛ نشط فقط.
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'active'
      and (account_type = 'admin' or staff_role = 'super_admin')
  );
$$;
revoke execute on function public.civ_can_delete_asset() from public, anon;
grant  execute on function public.civ_can_delete_asset() to authenticated;

commit;

-- ─── تحقق (SELECT فقط) ───
-- تعريف الدالة الحالي:
select pg_get_functiondef('public.civ_can_delete_asset()'::regprocedure);
-- أي الأدوار سيُسمح لها (توزيع الحسابات النشطة المؤهَّلة):
select account_type, staff_role, count(*)
  from public.profiles
 where account_status = 'active' and (account_type = 'admin' or staff_role = 'super_admin')
 group by account_type, staff_role order by account_type, staff_role;
