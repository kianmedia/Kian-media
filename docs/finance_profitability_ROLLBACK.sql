-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_ROLLBACK.sql
--
-- ⚠️ اقرأ هذا كاملًا قبل تشغيل أيّ سطر. هذا الملفّ **صادق عمّا يُفقَد**.
--
-- ─── ما الذي يُفقَد فعلًا ───────────────────────────────────────────────────
-- المرحلة (ب) تحذف بيانات مالية حقيقية لا نسخة لها في مكان آخر:
--   • مراكز التكلفة والميزانيات وبنودها     ← أساس كلّ انحراف حُسب سابقًا.
--   • دفتر التكلفة fin_costs                ← الفعليّ والملتزَم به معًا.
--   • طلبات الصرف وأثر اعتمادها             ← ★ سجلّ «من اعتمد ماذا ومتى» ★،
--     وهو أوّل ما يُطلَب في أيّ مراجعة أو نزاع. لا يُستعاد.
--   • طلبات الشراء وأوامر الشراء وبنودها    ← التزامات تجاه مورّدين.
--   • المورّدون وشروط الدفع.
--   • العقود والإيراد والاشتراكات الشهرية   ← طرف الإيراد في كلّ ربحية.
--   • الذمم والتحصيلات ودفعات العقد         ← ما دفعه العميل فعلًا ومتى.
--   • حدود الاعتماد المضبوطة.
--   • المرفقات (الإيصالات والفواتير المرفوعة).
--   • سجلّ التدقيق fin_audit                ← أثر كلّ ما سبق يختفي معه.
--
-- ★ تحذير محاسبيّ/نظاميّ ★: بيانات الضريبة والتحصيل قد تكون مطلوبة للاحتفاظ
--   بها نظامًا (هيئة الزكاة والضريبة والجمارك تشترط حفظ السجلّات لسنوات).
--   الحذف هنا قد يخالف التزامًا نظاميًّا لا مجرّد تفضيل تشغيليّ. راجع محاسبك
--   قبل تشغيل المرحلة (ب)، وليس بعدها.
--
-- ─── ما الذي لا يتأثّر إطلاقًا ─────────────────────────────────────────────
--   • منصّة المشاريع بكاملها (projects · project_core · deliverables …) وكلّ
--     ماليات المنصّة (project_costs · project_expenses · project_phase_budgets …):
--     الموديول لم يكتب فيها ولم يقرأها أصلًا.
--   • فواتير العميل المعروضة (invoices) وعروض الأسعار (quotes).
--   • Zoho Books: لم يُرسَل إليه شيء من هذه الحزمة إطلاقًا، فلا شيء «يُلغى» هناك.
--   • كتالوج الصلاحيات: مفاتيح finance.* القديمة تبقى كما هي.
--   • مركز التشغيل Phase 2 (ops_* / prodops_*) ومركز الاتصال Phase 1 (comms_*).
--
-- ─── التوصية ───────────────────────────────────────────────────────────────
-- في أغلب الأعطال المرحلة (أ) وحدها كافية: تُغلق الباب فورًا وتُبقي البيانات.
-- لا تُشغّل (ب) إلّا بقرار صريح من المالك وبعد أخذ نسخة احتياطية.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- (أ) تعطيل آمن — بلا فقدان بيانات. هذا هو التراجع الموصى به.
--     تُسحب صلاحية التنفيذ، فتتوقّف كلّ الشاشات فورًا وتبقى كلّ الصفوف.
--     الواجهة ستقرأ 42501 وتقول «لا تملك صلاحية» — لا «ترحيلة ناقصة».
-- ════════════════════════════════════════════════════════════════════════════
do $revoke$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finops%'
  loop
    begin execute format('revoke all on function %s from authenticated', f.sig);
    exception when others then null; end;
  end loop;
  raise notice 'ROLLBACK (أ): سُحبت صلاحية التنفيذ من كلّ دوالّ finops_*. البيانات كما هي.';
end $revoke$;

-- ملاحظة: سحب EXECUTE عن المُسنَدات يجعل سياسات RLS تفشل للقارئ العاديّ، وهذا
-- مقصود: لا قراءة مالية بعد التعطيل. لإعادة التشغيل بعد (أ) أعد تنفيذ
-- finance_profitability_RUNME.sql كاملًا (فهو idempotent ويُعيد المنح في §8).

-- ════════════════════════════════════════════════════════════════════════════
-- (أ-٢) تجميد الكتابة وحدها مع إبقاء القراءة — تراجع أخفّ.
--       يُفيد حين تريد إيقاف كلّ حركة مالية جديدة بينما تُراجع الأرقام.
--       أزل التعليق عن الكتلة لتشغيلها.
-- ════════════════════════════════════════════════════════════════════════════
-- do $freeze$
-- declare f record;
-- begin
--   for f in
--     select p.oid::regprocedure as sig from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and (p.proname like 'finops%upsert' or p.proname like 'finops%submit'
--         or p.proname like 'finops%decide' or p.proname like 'finops%record'
--         or p.proname in ('finops_row_delete','finops_po_set_status',
--                          'finops_expense_mark_paid','finops_expense_second_approve',
--                          'finops_attachment_add','finops_zoho_outbox_enqueue',
--                          'finops_zoho_outbox_replay'))
--   loop
--     begin execute format('revoke all on function %s from authenticated', f.sig);
--     exception when others then null; end;
--   end loop;
--   raise notice 'ROLLBACK (أ-٢): الكتابة موقوفة والقراءة تعمل.';
-- end $freeze$;

-- ════════════════════════════════════════════════════════════════════════════
-- (ب) الحذف الكامل — يُفقد كلّ ما ورد أعلاه. أزل التعليق يدويًّا سطرًا سطرًا.
--     تُرك معلّقًا عمدًا: تشغيل ملفّ كامل بالخطأ يجب ألّا يمحو دفترًا ماليًّا.
-- ════════════════════════════════════════════════════════════════════════════

-- خذ نسخة قبل أيّ حذف (استبدل التاريخ بما يناسبك):
-- create table public.fin_backup_costs_20260730     as select * from public.fin_costs;
-- create table public.fin_backup_expreq_20260730    as select * from public.fin_expense_requests;
-- create table public.fin_backup_expappr_20260730   as select * from public.fin_expense_approvals;
-- create table public.fin_backup_recv_20260730      as select * from public.fin_receivables;
-- create table public.fin_backup_coll_20260730      as select * from public.fin_collections;
-- create table public.fin_backup_contracts_20260730 as select * from public.fin_contracts;
-- create table public.fin_backup_revenue_20260730   as select * from public.fin_revenue;
-- create table public.fin_backup_audit_20260730     as select * from public.fin_audit;

-- begin;
--
-- -- (ب-1) الدوالّ — تُحذف قبل الجداول لأنّ سياسات RLS تعتمد عليها.
-- do $dropfn$
-- declare f record;
-- begin
--   for f in select p.oid::regprocedure as sig from pg_proc p
--            join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname like 'finops%'
--   loop execute format('drop function if exists %s cascade', f.sig); end loop;
-- end $dropfn$;
--
-- -- (ب-2) الجداول — الترتيب يحترم المفاتيح الخارجية (cascade يكفي).
-- drop table if exists public.fin_zoho_outbox           cascade;
-- drop table if exists public.fin_audit                 cascade;
-- drop table if exists public.fin_attachments           cascade;
-- drop table if exists public.fin_costs                 cascade;
-- drop table if exists public.fin_purchase_order_items  cascade;
-- drop table if exists public.fin_purchase_orders       cascade;
-- drop table if exists public.fin_purchase_request_items cascade;
-- drop table if exists public.fin_purchase_requests     cascade;
-- drop table if exists public.fin_expense_approvals     cascade;
-- drop table if exists public.fin_expense_requests      cascade;
-- drop table if exists public.fin_approval_thresholds   cascade;
-- drop table if exists public.fin_payment_milestones    cascade;
-- drop table if exists public.fin_collections           cascade;
-- drop table if exists public.fin_receivables           cascade;
-- drop table if exists public.fin_retainers             cascade;
-- drop table if exists public.fin_revenue               cascade;
-- drop table if exists public.fin_contracts             cascade;
-- drop table if exists public.fin_budget_lines          cascade;
-- drop table if exists public.fin_budgets               cascade;
-- drop table if exists public.fin_suppliers             cascade;
-- drop table if exists public.fin_expense_categories    cascade;
-- drop table if exists public.fin_cost_centers          cascade;
-- drop sequence if exists public.fin_doc_seq;
--
-- -- (ب-3) مفاتيح الصلاحيات — تُترك في الكتالوج عمدًا.
-- --   حذفها يُسقط سجلّات المنح المرتبطة بها في profession_permissions
-- --   وemployee_permission_overrides عبر ON DELETE CASCADE، أي يمحو قرارات
-- --   إدارية سابقة. أزل التعليق فقط إن كنت تريد ذلك فعلًا:
-- -- delete from public.permissions where key like 'finance_ops.%';
-- --   ⚠️ ولا تحذف finance.* أبدًا من هنا: تلك مفاتيح موديول آخر.
--
-- commit;
--
-- notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد أيّ مرحلة: شغّل finance_profitability_POSTCHECK.sql وتحقّق من §14 خاصّةً
-- (أعداد كائنات المنصّة المجمَّدة يجب أن تبقى كما هي قبل وبعد).
-- ════════════════════════════════════════════════════════════════════════════
