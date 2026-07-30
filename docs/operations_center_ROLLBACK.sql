-- ════════════════════════════════════════════════════════════════════════════
-- operations_center_ROLLBACK.sql
--
-- ⚠️ اقرأ هذا كاملًا قبل تشغيل أيّ سطر. هذا الملفّ **صادق عمّا يُفقَد**.
--
-- ─── ما الذي يُفقَد فعلًا ───────────────────────────────────────────────────
-- المرحلة (ب) تحذف بيانات تشغيلية حقيقية لا نسخة لها في مكان آخر:
--   • أوامر العمل وجداولها الزمنية.
--   • إسناد الطاقم وتأكيدات الحضور  ← شهادات أشخاص، لا تُستعاد.
--   • التقارير اليومية               ← شهادات موقّعة بأسماء كاتبيها.
--   • تقارير الحوادث وأسباب التأخير  ← قد تكون مطلوبة تأمينيًّا/قانونيًّا.
--   • قوائم السلامة (HSE) المُغلقة    ← إثبات أنّ الفحص جرى.
--   • بطاقات الذاكرة وقوائم النسخ الاحتياطي وحالة الرفع.
--   • Call Sheets المنشورة.
--   • سجلّ التدقيق ops_audit         ← أثر «من فعل ماذا ومتى» يختفي معه.
--
-- ─── ما الذي لا يتأثّر إطلاقًا ─────────────────────────────────────────────
--   • منصّة المشاريع بكاملها (projects · project_core · deliverables …).
--     الموديول لم يكتب فيها أصلًا، والحذف هنا لا يلمسها.
--   • مخزون الأصول والعهدة (custody_inventory_*): كانت مرجعًا لا نسخة.
--   • طبقة تخطيط الموارد 4B (planning_resources · resource_bookings).
--   • الإشعارات المُرسَلة: صفوف notifications تبقى (لا تُحذف من هنا).
--   • ops_can_view() و7B — دوالّ مختلفة تمامًا، لا تُمَسّ.
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
    where n.nspname = 'public' and p.proname like 'prodops%'
  loop
    begin execute format('revoke all on function %s from authenticated', f.sig);
    exception when others then null; end;
  end loop;
  raise notice 'ROLLBACK (أ): سُحبت صلاحية التنفيذ من كلّ دوالّ prodops_*. البيانات كما هي.';
end $revoke$;

-- ⚠️ ما لا يُلغيه (أ): حرّاس منع الحجز المزدوج (trg_ops_*_no_double_booking) تبقى
--    فعّالة، لأنّ المُشغِّل لا يعتمد على منح EXECUTE. وهذا مقصود: تعطيل الشاشات
--    شيء، والسماح بإخراج طاقم واحد إلى موقعين شيء آخر. إن أردت تعطيلها فعلًا
--    فذلك قرار صريح منفصل — أزل التعليق عن هذه الأسطر الثلاثة وحدها:
-- drop trigger if exists trg_ops_crew_no_double_booking  on public.ops_job_crew;
-- drop trigger if exists trg_ops_equip_no_double_booking on public.ops_job_equipment;
-- drop trigger if exists trg_ops_job_no_double_booking   on public.ops_jobs;
--    بعد إزالتها يصير الازدواج ممكنًا من أيّ مسار، ويبقى §7 يكشفه بعد وقوعه فقط.

-- لإعادة التشغيل بعد (أ): أعد تنفيذ operations_center_RUNME.sql كاملًا
-- (فهو idempotent ويُعيد المنح في §12 ويُعيد تركيب الحرّاس في §7B).

-- ════════════════════════════════════════════════════════════════════════════
-- (ب) الحذف الكامل — يُفقد كلّ ما ورد أعلاه. أزل التعليق يدويًّا سطرًا سطرًا.
--     تُرك معلّقًا عمدًا: تشغيل ملفّ كامل بالخطأ يجب ألّا يمحو تاريخ التشغيل.
-- ════════════════════════════════════════════════════════════════════════════

-- خذ نسخة قبل أيّ حذف (استبدل الاسم بما يناسبك):
-- create table public.ops_backup_jobs_20260730 as select * from public.ops_jobs;
-- create table public.ops_backup_audit_20260730 as select * from public.ops_audit;
-- create table public.ops_backup_reports_20260730 as select * from public.ops_daily_reports;
-- create table public.ops_backup_incidents_20260730 as select * from public.ops_incidents;

-- begin;
--
-- -- (ب-1) الدوالّ — تُحذف قبل الجداول لأنّ سياسات RLS تعتمد عليها.
-- do $dropfn$
-- declare f record;
-- begin
--   for f in select p.oid::regprocedure as sig from pg_proc p
--            join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname like 'prodops%'
--   loop execute format('drop function if exists %s cascade', f.sig); end loop;
-- end $dropfn$;
--
-- -- (ب-2) الجداول — الترتيب يحترم المفاتيح الخارجية (cascade يكفي).
-- drop table if exists public.ops_audit             cascade;
-- drop table if exists public.ops_call_sheets       cascade;
-- drop table if exists public.ops_delays            cascade;
-- drop table if exists public.ops_incidents         cascade;
-- drop table if exists public.ops_daily_reports     cascade;
-- drop table if exists public.ops_post_handoff      cascade;
-- drop table if exists public.ops_ingest_jobs       cascade;
-- drop table if exists public.ops_media_backups     cascade;
-- drop table if exists public.ops_media_cards       cascade;
-- drop table if exists public.ops_job_weather       cascade;
-- drop table if exists public.ops_job_hse           cascade;
-- drop table if exists public.ops_job_vehicles      cascade;
-- drop table if exists public.ops_job_accommodation cascade;
-- drop table if exists public.ops_job_travel        cascade;
-- drop table if exists public.ops_job_permits       cascade;
-- drop table if exists public.ops_job_equipment     cascade;
-- drop table if exists public.ops_job_crew          cascade;
-- drop table if exists public.ops_jobs              cascade;
-- drop table if exists public.ops_vehicles          cascade;
-- drop table if exists public.ops_locations         cascade;
-- drop sequence if exists public.ops_job_code_seq;
--
-- -- (ب-3) مفاتيح الصلاحيات — تُترك في الكتالوج عمدًا.
-- --   حذفها يُسقط سجلّات المنح المرتبطة بها في profession_permissions
-- --   وemployee_permission_overrides عبر ON DELETE CASCADE، أي يمحو قرارات
-- --   إدارية سابقة. أزل التعليق فقط إن كنت تريد ذلك فعلًا:
-- -- delete from public.permissions where key like 'operations.%';
--
-- commit;
--
-- notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد أيّ مرحلة: شغّل operations_center_POSTCHECK.sql وتحقّق من §9 خاصّةً
-- (أعداد كائنات المنصّة المجمَّدة يجب أن تبقى كما هي قبل وبعد).
-- ════════════════════════════════════════════════════════════════════════════
