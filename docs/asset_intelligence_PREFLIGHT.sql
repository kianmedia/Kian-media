-- ════════════════════════════════════════════════════════════════════════════
-- asset_intelligence_PREFLIGHT.sql                    (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ قبل asset_intelligence_RUNME.sql. كلّ استعلام هنا SELECT صِرف، والقسم
-- الأخير كتلة DO ترفع استثناءً — لا تكتب صفًّا واحدًا، لكنّها **توقف التشغيل**
-- بدل ترك نصف ترحيلة على جداول عهدة حيّة.
--
-- ─── لماذا PREFLIGHT صارم هنا تحديدًا ───────────────────────────────────────
-- هذه الحزمة **توسّع جداول تحمل عهدًا حيّة** (كاميرات مصروفة الآن باسم موظفين).
-- لا تُنشئ نظام أصول ثانيًا: تُعيد استخدام custody_inventory_* بالكامل. لذلك أيّ
-- غياب في الأساس ليس «ميزة معطّلة» بل ترحيلة نصفية على بيانات حقيقية.
--
-- ─── قرار التبعية على prodops_* (مذكور صراحةً وليس ضمنًا) ──────────────────
-- محرّك التعارض في هذه الحزمة **يعيد استخدام عقد prodops**: نفس رمز الخطأ
-- 23P01 ونفس شكل الـhint ('equipment:<job_code>')، ولا يخترع قاعدة تعارض ثانية
-- متناقضة. لذلك:
--   • prodops غائب بالكامل  ⇒ مسموح. الحارس يغطّي الحجوزات والعهد فقط، ويُعلن
--     ذلك في الشاشة بدل ادّعاء تغطية كاملة (القسم 2 يطبع الحالة).
--   • prodops **نصف مطبَّق** (ops_job_equipment موجود وprodops_asset_clash غائب،
--     أو العكس) ⇒ **فشل**. عندها يكون هناك تقويم حجز ثالث لا يراه أحد، وهذا
--     أسوأ من الغياب لأنّه يبدو مغطّى.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية — الجداول ─────────────────────────────────────
-- متوقّع: present = true في كلّ صفّ. أيّ false ⇒ لا تُشغّل RUNME.
select t.name, (to_regclass(t.name) is not null) as present
from (values ('public.custody_inventory_assets'),
             ('public.custody_inventory_movements'),
             ('public.custody_inventory_assignments'),
             ('public.custody_inventory_assignment_items'),
             ('public.custody_inventory_reservations'),
             ('public.custody_inventory_maintenance'),
             ('public.custody_inventory_categories'),
             ('public.custody_inventory_locations'),
             ('public.custody_inventory_evidence')) t(name);

-- ─── 2) الاعتمادات الإلزامية — الدوالّ ─────────────────────────────────────
-- متوقّع: exists_now = true في كلّ صفّ.
-- ⚠️ civ_can_manage/civ_can_finance/civ_can_delete_asset **تُقرأ ولا تُعاد كتابتها
--    أبدًا** في هذه الحزمة. النسخة الصحيحة (فرع المهن + coalesce) موجودة في
--    authz_fixC_null_failopen_gates_RUNME.sql وحدها؛ أيّ إعادة تعريف تعيد فتح
--    ثغرة NULL fail-open عبر ~120 موضع استدعاء.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.civ_can_manage()'), ('public.civ_can_admin()'),
             ('public.civ_is_employee()'), ('public.civ_set_avail(uuid)'),
             ('public.civ_gen_no(text)'), ('public.is_owner()'), ('public.is_staff()'),
             ('public.custody_audit(text,text,uuid,jsonb)'),
             ('public.civ_notify_managers(text,uuid,text,text)')) f(sig);

-- ─── 3) هل جسم civ_can_manage() هو النسخة المحصّنة؟ ────────────────────────
-- متوقّع: has_coalesce = true. لو false فالقاعدة تعمل بنسخة fail-open: شغّل
-- authz_fixC_null_failopen_gates_RUNME.sql أوّلًا، ثمّ أعِد هذا الـPREFLIGHT.
-- (المُفكِّك يرفع حالة COALESCE، لذا المطابقة بـilike.)
select 'civ_can_manage_body' as check_name,
       coalesce(pg_get_functiondef(to_regprocedure('public.civ_can_manage()')) ilike '%coalesce%', false) as has_coalesce;

-- ─── 4) الاعتمادات الاختيارية — تُكتشف ولا تُفترض ──────────────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويغيّر السلوك بصدق:
--   • custody_condition_reports غائب ⇒ لا مزامنة درجة الحالة (العمود يبقى NULL،
--     ولا يُعرض صفر ولا «جيّد» كاذبة).
--   • custody_qr_events / assets.qr_token غائب ⇒ وحدة QR تُعلن «بانتظار التفعيل».
--   • permissions/emp_has_permission غائب ⇒ المُسنَدات الستّة تسقط إلى
--     civ_can_manage() وحدها (fail-closed، لا توسيع).
--   • custody_rental_charges غائب ⇒ سطر «تكلفة الاستبدال بالإيجار» = null صراحةً
--     في ملخّص التكلفة، لا صفر.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.custody_condition_reports'), ('public.custody_qr_events'),
             ('public.custody_enterprise_settings'), ('public.custody_inventory_kits'),
             ('public.custody_inventory_asset_components'), ('public.custody_incidents'),
             ('public.permissions'), ('public.custody_rental_items'),
             ('public.custody_rental_charges'), ('public.ops_job_equipment'),
             ('public.ops_jobs'), ('public.notifications')) o(name);

select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(text)'), ('public.civ_can_finance()'),
             ('public.civ_flag(text)'), ('public.custody_inv_admin_reissue_qr(uuid,text)'),
             ('public.custody_inv_admin_close_maintenance(uuid,text,text,numeric,text)'),
             ('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)')) f(sig);

-- ─── 5) أعمدة QR من الترقيع المؤسّسي 01 ────────────────────────────────────
-- متوقّع: 4 صفوف (qr_token, qr_status, label_version, barcode_value) أو صفر.
-- صفر ⇒ وحدة QR في هذه الحزمة تُبنى لكنّها تُعلن «بانتظار الترقيع 01».
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'custody_inventory_assets'
  and column_name in ('qr_token','qr_status','label_version','barcode_value');

-- ─── 6) لا تصادم أسماء: الكائنات الجديدة غير موجودة بعد ────────────────────
-- متوقّع: صفر صفّ في الجدولين. أيّ صفّ ⇒ الحزمة (أو ما يشبهها) مطبّقة سلفًا؛
-- إعادة التشغيل idempotent لكن اقرأ الفرق أوّلًا.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings');

-- متوقّع: صفر صفّ — لا جدول باسم asset_* يُنشأ في هذه الحزمة إطلاقًا.
-- (الحكم الحاكم: نظام أصول واحد فقط، custody_inventory_*.)
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'asset\_%'
  and c.relname <> 'asset_insurance_policies';   -- قائم مسبقًا من حزمة التأجير/التأمين

-- ─── 7) صحّة البيانات القائمة قبل شدّ الثوابت ──────────────────────────────
-- متوقّع: صفر في كلّ عمود. أيّ رقم > 0 يعني أنّ صفًّا حيًّا يخالف ثابتًا سنفرضه،
-- والـRUNME سيتوقّف عليه صراحةً بدل تجاهله.
select
  (select count(*) from public.custody_inventory_assets
    where quantity_available < 0 or quantity_available > quantity_total) as bad_qty,
  (select count(*) from public.custody_inventory_assets a
    where a.is_deleted = false and a.availability_status = 'retired'
      and exists (select 1 from public.custody_inventory_assignment_items i
                   where i.asset_id = a.id and i.status in ('pending','active','return_requested','disputed'))) as retired_with_live_custody,
  (select count(*) from public.custody_inventory_reservations r
    where r.status = 'active' and r.reserved_from is not null and r.reserved_to is not null
      and r.reserved_to <= r.reserved_from) as inverted_reservation_windows,
  -- ★ نوافذ مقلوبة في جداول **لا** يوقف عليها البوّاب، وعمدًا: RUNME يقرأها عبر
  --   civ_window التي تُطبّع المقلوب بدل أن تنفجر بـ22000. تُقاس هنا للعلم فقط —
  --   رقم > 0 يعني تاريخًا مُرحَّلًا بتواريخ غير منطقيّة يستحقّ تصحيحًا محاسبيًّا،
  --   لا عطلًا في الوحدة. (عهدة بتاريخ عودة أقدم من تاريخ الصرف = سجلّ ورقيّ
  --   قديم مُرحَّل، أو سنة مطبوعة خطأً.)
  (select count(*) from public.custody_inventory_assignments
    where is_deleted = false and issued_at is not null and expected_return_at is not null
      and expected_return_at < issued_at) as inverted_custody_windows_informational,
  (select count(*) from public.custody_inventory_maintenance
    where coalesce(sent_at, created_at) is not null and returned_at is not null
      and returned_at < coalesce(sent_at, created_at)) as inverted_maintenance_windows_informational;

-- ─── 8) حجوزات متداخلة قائمة — تُقاس قبل تركيب الحارس ──────────────────────
-- متوقّع: توثيقيّ. الحارس BEFORE يمنع الجديد ولا يحذف القديم؛ هذا العدد يخبرك
-- كم صفًّا قائمًا سيرفض الحارس تعديله لاحقًا (وهو الرفض الصحيح).
-- ★ الحدّ المقلوب يُطبَّع صراحةً بـCASE بدل tstzrange الخام: صفٌّ واحد بنافذة
--   مقلوبة كان سيرفع 22000 هنا فيُجهض الفحص **قبل** أن يصل البوّاب إلى رسالته
--   الواضحة، فيرى المشغّل رمزًا غامضًا بدل تعليمات التصحيح. civ_window غير
--   موجودة بعد (تُنشئها RUNME)، فالتطبيع مكتوب هنا حرفيًّا.
--   ⚠️ لا least/greatest: هما يتجاهلان NULL، فيحوّلان حجزًا مفتوح الطرف
--   (reserved_from فارغ = من الأزل) إلى نطاق فارغ لا يتقاطع مع شيء — أي عدّ
--   ناقص يطمئن المشغّل كذبًا. الشرط الصريح يحفظ دلالة NULL كما هي.
select count(*) as existing_overlapping_active_reservations
from public.custody_inventory_reservations r1
join public.custody_inventory_reservations r2
  on r2.asset_id = r1.asset_id and r2.id > r1.id
 and r1.status = 'active' and r2.status = 'active'
 and (case when r1.reserved_from is not null and r1.reserved_to is not null
                and r1.reserved_to < r1.reserved_from
           then tstzrange(r1.reserved_to, r1.reserved_from)
           else tstzrange(r1.reserved_from, r1.reserved_to) end)
  && (case when r2.reserved_from is not null and r2.reserved_to is not null
                and r2.reserved_to < r2.reserved_from
           then tstzrange(r2.reserved_to, r2.reserved_from)
           else tstzrange(r2.reserved_from, r2.reserved_to) end);

-- ─── 9) لا صلاحية anon على ما سنبني فوقه ───────────────────────────────────
-- متوقّع: صفر صفّ.
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'custody\_inventory\_%' and grantee = 'anon';

-- ─── 10) تجميد منصّة المشاريع — لقطة قبل ───────────────────────────────────
-- متوقّع: احتفظ بالأرقام وقارنها في POSTCHECK. أيّ تغيّر ⇒ خرق تجميد.
-- هذه الحزمة لا تكتب في projects/project_core/deliverables إطلاقًا، وتقرأ
-- project_id كمرجع اختياريّ فقط.
select 'frozen_snapshot' as label,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects') as projects_columns;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) البوّابة الصلبة — ترفع استثناءً ولا تكتب شيئًا
-- ════════════════════════════════════════════════════════════════════════════
do $gate$
declare
  t text;
  missing text := '';
begin
  -- (أ) الجداول الأساسية
  foreach t in array array[
    'public.custody_inventory_assets','public.custody_inventory_movements',
    'public.custody_inventory_assignments','public.custody_inventory_assignment_items',
    'public.custody_inventory_reservations','public.custody_inventory_maintenance',
    'public.custody_inventory_categories','public.custody_inventory_locations',
    'public.custody_inventory_evidence'
  ] loop
    if to_regclass(t) is null then missing := missing || ' ' || t; end if;
  end loop;

  -- (ب) الدوالّ الأساسية
  -- ★ custody_audit وciv_notify_managers ضمن الإلزاميّ: تُنادَيان بلا حارس داخل
  --   كلّ كتابة حسّاسة، وplpgsql متأخّرة الربط — الغياب لا يُفشل الترحيلة بل يُفشل
  --   أوّل حجز حقيقيّ بـ42883. الفشل هنا أرخص بكثير.
  foreach t in array array[
    'public.civ_can_manage()','public.civ_can_admin()','public.civ_is_employee()',
    'public.civ_set_avail(uuid)','public.civ_gen_no(text)','public.is_owner()','public.is_staff()',
    'public.custody_audit(text,text,uuid,jsonb)','public.civ_notify_managers(text,uuid,text,text)'
  ] loop
    if to_regprocedure(t) is null then missing := missing || ' ' || t; end if;
  end loop;

  if missing <> '' then
    raise exception 'ASSET PREFLIGHT: أساس نظام العهدة ناقص (%). هذه الحزمة **توسّع** custody_inventory_* ولا تُنشئ نظام أصول ثانيًا — شغّل portal_custody_inventory_system_v1_RUNME.sql أوّلًا. لا تُشغّل RUNME الآن.', missing;
  end if;

  -- (ج) بوّابة fail-open: لا نُطبّق فوق نسخة gate غير محصّنة
  if not coalesce(pg_get_functiondef(to_regprocedure('public.civ_can_manage()')) ilike '%coalesce%', false) then
    raise exception 'ASSET PREFLIGHT: civ_can_manage() ما زالت بلا coalesce ⇒ «if not civ_can_manage()» تنهار إلى NULL فيُتخطّى الرفض في كلّ RPC. شغّل authz_fixC_null_failopen_gates_RUNME.sql ثمّ أعِد المحاولة.';
  end if;

  -- (د) prodops نصف مطبَّق ⇒ تقويم حجز ثالث أعمى يبدو مغطّى
  if (to_regclass('public.ops_job_equipment') is not null)
     <> (to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null) then
    raise exception 'ASSET PREFLIGHT: prodops نصف مطبَّق (ops_job_equipment=% ، prodops_asset_clash=%). محرّك الحجز هنا يعيد استخدام عقد prodops (23P01 + hint equipment:) — نصف تطبيق يعني حجوزات معدّات لا يراها الحارس بينما تبدو الشاشة مغطّاة. أكمِل operations_center_RUNME.sql أو أزِل بقاياه، ثمّ أعِد المحاولة.',
      (to_regclass('public.ops_job_equipment') is not null),
      (to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null);
  end if;

  -- (هـ) بيانات قائمة تخالف ثابتًا سنفرضه
  if exists (select 1 from public.custody_inventory_assets
              where quantity_available < 0 or quantity_available > quantity_total) then
    raise exception 'ASSET PREFLIGHT: صفوف أصول تخالف ثابت المخزون (متاح سالب أو أكبر من الإجمالي). صحّحها بحركة stock_adjustment قبل شدّ الثوابت.';
  end if;

  if exists (select 1 from public.custody_inventory_reservations
              where status = 'active' and reserved_from is not null and reserved_to is not null
                and reserved_to <= reserved_from) then
    raise exception 'ASSET PREFLIGHT: حجوزات نشطة بنافذة مقلوبة (reserved_to <= reserved_from). ألغِها أو صحّحها — الحارس الجديد سيرفض أيّ تعديل عليها.';
  end if;

  raise notice 'ASSET PREFLIGHT: نجح — الأساس مكتمل، البوّابة محصّنة، لا نصف-تطبيق لـprodops، والبيانات القائمة تحترم الثوابت. يمكن تشغيل asset_intelligence_RUNME.sql.';
  raise notice 'ASSET PREFLIGHT: تذكير — prodops حاضر؟ % . إن كان false فمحرّك التعارض يغطّي الحجوزات والعهد فقط، والشاشة تقول ذلك صراحةً.',
    (to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') is not null);
end $gate$;
