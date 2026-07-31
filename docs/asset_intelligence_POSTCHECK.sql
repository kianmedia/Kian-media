-- ════════════════════════════════════════════════════════════════════════════
-- asset_intelligence_POSTCHECK.sql              (READ-ONLY — مجموعة نتائج واحدة)
--
-- يُنفَّذ بعد asset_intelligence_RUNME.sql. **جملة SQL واحدة** تُرجع جدول فحوص:
-- محرّر SQL يعرض نتيجة الجملة الأخيرة فقط، فلو كُتبت الفحوص جملًا متتالية لضاعت
-- كلّها إلّا الأخيرة وبدا الملفّ ناجحًا وهو لم يُقرأ.
--
-- ─── لماذا ساكن بالكامل ────────────────────────────────────────────────────
-- المحرّر يعمل بدور postgres وauth.uid() = NULL. أيّ نداء لدالّة محميّة هنا يرفع
-- «not authorized» فيقتل الفحص، وأيّ نداء لدالّة تكتب يُلوّث بيانات عهدة حيّة.
-- لذلك كلّ فحص مصدره pg_catalog: وجود الكائن، وجسمه عبر pg_get_functiondef مع
-- ilike (المُفكِّك يرفع حالة COALESCE فلا تصلح المطابقة الحسّاسة)، وصلاحياته.
--
-- ─── لماذا to_regclass/to_regprocedure في كلّ مرجع ─────────────────────────
-- PostgreSQL يحلّ أسماء الجداول وقت التحليل: ذكر جدول غائب في FROM ينهار بـ42P01
-- ويقتل الملفّ كلّه بدل أن يُبلّغ عن غيابه. to_regclass تعيد NULL بهدوء، فيصير
-- «غائب» نتيجةَ فحص لا انهيارًا.
--
-- القراءة: كلّ صفّ verdict='PASS' ⇒ نجاح. أيّ '❌ FAIL' ⇒ اقرأ actual قبل أيّ شيء.
-- الصفوف 'ℹ️ INFO' توثيقيّة: تصف تغطية اختيارية ولا تُفشل شيئًا.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── مصادر مشتركة تُحسب مرّة واحدة ─────────────────────────────────────────
rival as (
  select c.relname,
         (select count(*) from pg_attribute a
           where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             and a.attname in ('asset_code','barcode','qr_code_value','asset_name',
                               'serial_number','category_id','condition_status',
                               'availability_status')) as ident,
         (exists (select 1 from pg_constraint fk
                   join pg_attribute a on a.attrelid = c.oid and a.attnum = fk.conkey[1]
                  where fk.conrelid = c.oid and fk.contype = 'f'
                    and fk.confrelid = to_regclass('public.custody_inventory_assets')
                    and a.attnotnull)
          or exists (select 1 from pg_constraint j1
                      join pg_constraint j2 on j2.conrelid = j1.conrelid and j2.contype = 'f'
                                           and j2.confrelid = to_regclass('public.custody_inventory_assets')
                     where j1.contype = 'f' and j1.confrelid = c.oid)) as linked
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.oid is distinct from to_regclass('public.custody_inventory_assets')),
src as (
  select
    to_regclass('public.custody_inventory_maintenance_plans')       as plans_rel,
    to_regclass('public.custody_inventory_meter_readings')          as meter_rel,
    to_regclass('public.custody_inventory_reservations')            as resv_rel,
    to_regclass('public.custody_inventory_assets')                  as assets_rel,
    to_regclass('public.custody_inventory_assignments')             as assign_rel,
    to_regclass('public.custody_inventory_evidence')                as evid_rel,
    to_regclass('public.custody_condition_reports')                 as cond_rel,
    pg_get_functiondef(to_regprocedure('public.civ_can_manage()'))                  as def_gate,
    pg_get_functiondef(to_regprocedure('public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid)')) as def_conflict,
    pg_get_functiondef(to_regprocedure('public.civ_guard_reservation()'))           as def_resvguard,
    pg_get_functiondef(to_regprocedure('public.civ_guard_assignment_closure()'))    as def_closeguard,
    pg_get_functiondef(to_regprocedure('public.civ_guard_asset_disposal()'))        as def_dispguard,
    pg_get_functiondef(to_regprocedure('public.custody_inv_qr_public_payload(uuid)')) as def_qrpay,
    pg_get_functiondef(to_regprocedure('public.custody_inv_qr_scan(uuid,text)'))    as def_qrscan,
    pg_get_functiondef(to_regprocedure('public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz)')) as def_util,
    pg_get_functiondef(to_regprocedure('public.custody_inv_asset_cost_summary(uuid)')) as def_cost,
    pg_get_functiondef(to_regprocedure('public.custody_inv_maintenance_signals(uuid)')) as def_signals,
    pg_get_functiondef(to_regprocedure('public.custody_inv_record_meter(jsonb)'))   as def_meter,
    to_regprocedure('public.custody_inv_qr_public_payload(uuid)')                   as oid_qrpay,
    to_regprocedure('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)') as oid_prodops,
    to_regprocedure('public.emp_has_permission(text)')                              as oid_perm
),
-- المُسنَدات الستّة: موجودة؟ لا تعيد NULL؟ SECURITY DEFINER بمسار مثبَّت؟
preds as (
  select p.sig,
         pg_get_functiondef(to_regprocedure(p.sig)) as def
    from (values
      ('public.civ_can_view_assets()'), ('public.civ_can_manage_assets()'),
      ('public.civ_can_issue_custody()'), ('public.civ_can_close_custody()'),
      ('public.civ_can_manage_maintenance()'), ('public.civ_can_view_asset_sensitive_costs()')
    ) p(sig)
),
-- كلّ كتابة حسّاسة تُدقَّق
writers as (
  select w.sig, pg_get_functiondef(to_regprocedure(w.sig)) as def
    from (values
      ('public.custody_inv_admin_create_reservation_v2(jsonb)'),
      ('public.custody_inv_fulfil_reservation(uuid,uuid)'),
      ('public.custody_inv_admin_revoke_qr(uuid,text)'),
      ('public.custody_inv_record_meter(jsonb)'),
      ('public.custody_inv_reverse_meter(uuid,text)'),
      ('public.custody_inv_maint_plan_upsert(jsonb)'),
      ('public.custody_inv_maint_plan_archive(uuid,text)'),
      ('public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric)'),
      ('public.custody_inv_post_closure_correction(uuid,text,jsonb)')
    ) w(sig)
),
-- كلّ واجهة الحزمة موجودة بتوقيعها بالضبط
api as (
  select a.sig, (to_regprocedure(a.sig) is not null) as ok
    from (values
      ('public.civ_asset_state(uuid)'), ('public.civ_allowed_transitions(text,text)'),
      ('public.civ_grade_to_condition(text)'), ('public.civ_condition_to_grade(text)'),
      ('public.civ_reservation_conflict(uuid,numeric,timestamptz,timestamptz,uuid,uuid)'),
      ('public.custody_inv_admin_create_reservation_v2(jsonb)'),
      ('public.custody_inv_fulfil_reservation(uuid,uuid)'),
      ('public.custody_inv_expire_reservations()'),
      ('public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid)'),
      ('public.custody_inv_qr_scan(uuid,text)'), ('public.custody_inv_admin_revoke_qr(uuid,text)'),
      ('public.custody_inv_lookup_asset(text)'), ('public.custody_inv_record_meter(jsonb)'),
      ('public.custody_inv_reverse_meter(uuid,text)'), ('public.custody_inv_asset_meter_totals(uuid)'),
      ('public.custody_inv_maint_plan_upsert(jsonb)'), ('public.custody_inv_maint_plan_archive(uuid,text)'),
      ('public.custody_inv_maint_plan_due(uuid)'), ('public.custody_inv_maintenance_signals(uuid)'),
      ('public.custody_inv_maint_close_with_inspection(uuid,text,text,numeric)'),
      ('public.custody_inv_asset_utilization(uuid,timestamptz,timestamptz)'),
      ('public.custody_inv_asset_cost_summary(uuid)'),
      ('public.custody_inv_post_closure_correction(uuid,text,jsonb)')
    ) a(sig)
),
-- دوالّ هذه الحزمة وحدها (بلا دوالّ المُشغِّلات: نداؤها المباشر مستحيل أصلًا).
-- النطاق مقصود: فحص كلّ civ_*/custody_inv_* في القاعدة كان سيخلط تسريبًا قديمًا
-- لا تملكه هذه الحزمة بتسريب تُحدثه هي، فيصير الفحص ضجيجًا يُتجاهَل.
pkg_fns as (
  select to_regprocedure(s.sig) as oid from api s
  union all select to_regprocedure(sig) from preds
  union all select to_regprocedure(s.sig)
    from (values ('public.civ_perm(text)'), ('public.civ_qr_rate_ok(int)'),
                 ('public.custody_inv_qr_public_payload(uuid)')) s(sig)
),
-- ★ proacl = NULL يعني «EXECUTE إلى PUBLIC» ضمنًا — وanon يرث PUBLIC. الغياب
--   هنا تسريبٌ صامت تمامًا كالمنح الصريح، فيُعامَل مثله.
leaked as (
  select p.oid::regprocedure::text as sig,
         coalesce(r.rolname, case when p.proacl is null then 'PUBLIC (ضمنيًّا — لا REVOKE)' else 'PUBLIC' end) as rolname
    from pg_proc p
    join pkg_fns k on k.oid = p.oid
    left join lateral aclexplode(p.proacl) a on true
    left join pg_roles r on r.oid = a.grantee
   where p.prorettype <> 'pg_catalog.trigger'::regtype
     and (p.proacl is null
       or (a.privilege_type = 'EXECUTE' and (r.rolname = 'anon' or a.grantee = 0)))
),
-- الحمولة العامّة للـQR: مَن يستطيع نداءها مباشرةً (يجب: لا أحد)
-- proacl = NULL ⇒ EXECUTE إلى PUBLIC ضمنًا ⇒ تُحسب تسريبًا لا صفرًا.
qrpay_grants as (
  select count(*) as n
    from pg_proc p
    left join lateral aclexplode(p.proacl) a on true
    left join pg_roles r on r.oid = a.grantee
   where p.oid = (select oid_qrpay from src)
     and (p.proacl is null
       or (a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated'))))
),
checks as (

-- ═══ ١) الجدولان الجديدان — وهما الوحيدان ══════════════════════════════════
select 1 as n, 'الجدولان الجديدان موجودان' as check_name,
       'plans + meter_readings' as expected,
       concat_ws(' · ',
         case when (select plans_rel from src) is not null then 'plans ✓' else 'plans ✗' end,
         case when (select meter_rel from src) is not null then 'meter ✓' else 'meter ✗' end) as actual,
       ((select plans_rel from src) is not null and (select meter_rel from src) is not null) as passed

union all
select 2, 'RLS مفعّلة على الجدولين', 'true/true',
       coalesce(string_agg(c.relname || '=' || c.relrowsecurity::text, ' · ' order by c.relname), 'لا جدول'),
       coalesce(bool_and(c.relrowsecurity), false)
  from pg_class c
 where c.oid in ((select plans_rel from src), (select meter_rel from src))

union all
-- ★ الحكم الحاكم: نظام أصول واحد — ويُقاس بالبنية لا بالاسم.
--   المصدر الموازي = يحمل هويّة أصل (عمودان فأكثر) **و** بلا رابط إلزاميّ إلى
--   custody_inventory_assets. فبوليصة التأمين تمرّ لأنّها بلا أعمدة هويّة، لا
--   لأنّها مذكورة في استثناء؛ وجدولٌ يخزّن barcode وserial_number يسقط ولو لم
--   يبدأ اسمه بـasset_. ويُطبَع سببُ التصنيف لا الاسم وحده.
select 3, '★ لا مصدر حقيقة ثانٍ للأصول', 'لا جدول يحمل هويّة أصل بلا رابط إلزاميّ',
       coalesce((select string_agg(x.relname || ' (هويّة: ' || x.ident::text
                                   || ' · رابط إلزاميّ: ' || case when x.linked then 'نعم' else 'لا' end || ')', ', ')
                   from rival x where x.ident >= 2 and not x.linked), 'لا شيء'),
       not exists (select 1 from rival x where x.ident >= 2 and not x.linked)

-- ═══ ٢) البوّابة القائمة لم تُمَسّ ═══════════════════════════════════════════
union all
select 4, '★ civ_can_manage() ما زالت محصّنة بـcoalesce', 'coalesce موجود',
       case when (select def_gate from src) is null then 'الدالّة غائبة'
            when (select def_gate from src) ilike '%coalesce%' then 'محصّنة'
            else 'بلا coalesce ⇒ fail-open في ~١٢٠ موضع' end,
       coalesce((select def_gate from src) ilike '%coalesce%', false)

union all
select 5, 'البوّابة ما زالت تعرف فرع المهن (لم تُستبدَل بنسخة أفقر)', 'emp_can أو staff_role',
       case when (select def_gate from src) is null then 'غائبة'
            when (select def_gate from src) ilike '%staff_role%' then 'سليمة' else 'مشبوهة' end,
       coalesce((select def_gate from src) ilike '%staff_role%', false)

-- ═══ ٣) المُسنَدات الستّة ═══════════════════════════════════════════════════
union all
select 6, 'المُسنَدات الستّة موجودة', '6',
       count(*) filter (where def is not null)::text,
       count(*) filter (where def is not null) = 6 from preds

union all
select 7, '★ لا مُسنَد يعيد NULL (coalesce على كلّ مسار)', 'كلّها',
       coalesce(string_agg(sig, ', ') filter (where def is not null and def not ilike '%coalesce%'), 'كلّها محصّنة'),
       not exists (select 1 from preds where def is not null and def not ilike '%coalesce%') from preds

union all
select 8, 'كلّ مُسنَد SECURITY DEFINER بمسار بحث مثبَّت', 'كلّها',
       coalesce(string_agg(sig, ', ') filter (where def is not null and (def not ilike '%security definer%' or def not ilike '%search_path%')), 'كلّها سليمة'),
       not exists (select 1 from preds where def is not null and (def not ilike '%security definer%' or def not ilike '%search_path%')) from preds

-- ═══ ٤) الواجهة كاملة بتوقيعاتها ════════════════════════════════════════════
union all
select 9, 'كلّ دوالّ الواجهة موجودة بالتوقيع المتّفق عليه', '23',
       count(*) filter (where ok)::text || '/' || count(*)::text,
       bool_and(ok) from api

union all
select 10, 'الدوالّ الناقصة (إن وُجدت)', 'لا شيء',
       coalesce(string_agg(sig, ', ') filter (where not ok), 'لا شيء'),
       not exists (select 1 from api where not ok) from api

-- ═══ ٥) الأعمدة والقيود الإضافية على الجداول القائمة ════════════════════════
union all
select 11, 'أعمدة الأصل الإضافية', '12 عمودًا',
       count(*)::text,
       count(*) = 12
  from information_schema.columns
 where table_schema = 'public' and table_name = 'custody_inventory_assets'
   and column_name in ('condition_grade','condition_grade_at','salvage_value','tags',
                       'stolen_reported_at','stolen_report_ref','disposal_date','disposal_method',
                       'disposal_reason','disposal_proceeds','disposal_approved_by','disposal_approved_at')

union all
select 12, 'أعمدة QR على الأصل (رمز غير قابل للتخمين + حالة + إصدار الملصق)', '4',
       count(*)::text, count(*) = 4
  from information_schema.columns
 where table_schema = 'public' and table_name = 'custody_inventory_assets'
   and column_name in ('qr_token','qr_status','label_version','barcode_value')

union all
select 13, 'رمز QR فريد (فهرس فريد قائم)', 'uq_civ_asset_qr_token',
       coalesce((select indexname from pg_indexes
                  where schemaname='public' and indexname='uq_civ_asset_qr_token'), 'غائب'),
       exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_civ_asset_qr_token')

union all
select 14, 'أعمدة الحجز الإضافية (إتمام + مهلة)', '4',
       count(*)::text, count(*) = 4
  from information_schema.columns
 where table_schema = 'public' and table_name = 'custody_inventory_reservations'
   and column_name in ('fulfilled_by_assignment_id','fulfilled_at','hold_expires_at','updated_by')

union all
select 15, 'القيود المضافة', '4 قيود',
       coalesce(string_agg(conname, ', ' order by conname), 'لا شيء'),
       count(*) = 4
  from pg_constraint
 where conname in ('civ_asset_condition_grade_chk','civ_asset_salvage_chk',
                   'civ_asset_disposal_method_chk','civ_resv_window_chk')

union all
-- NOT VALID مقصود على جدول حيّ: يحرس الجديد ولا يحكم على تاريخ ملغى
select 16, 'ℹ️ قيد نافذة الحجز NOT VALID (مقصود — لا يُعاد كتابة التاريخ)', 'convalidated=false',
       coalesce((select case when convalidated then 'مُتحقَّق (صفوف قديمة سليمة)' else 'NOT VALID — يحرس الجديد' end
                   from pg_constraint where conname='civ_resv_window_chk'), 'غائب'),
       exists (select 1 from pg_constraint where conname='civ_resv_window_chk')

-- ═══ ٦) دفتر الاستخدام ملحق فعلًا ═══════════════════════════════════════════
union all
select 17, '★ دفتر الاستخدام ملحق: UPDATE وDELETE وTRUNCATE ممنوعة بمُشغِّلات', '3 مُشغِّلات',
       coalesce((select string_agg(g.tgname, ', ' order by g.tgname) from pg_trigger g
                  where g.tgrelid = (select meter_rel from src) and not g.tgisinternal
                    and g.tgname in ('trg_civ_meter_no_update','trg_civ_meter_no_delete','trg_civ_meter_no_truncate')), 'لا شيء'),
       (select count(*) from pg_trigger g
         where g.tgrelid = (select meter_rel from src) and not g.tgisinternal
           and g.tgname in ('trg_civ_meter_no_update','trg_civ_meter_no_delete','trg_civ_meter_no_truncate')) = 3

union all
select 18, '★ مفتاح تعطيل التكرار فريد **عالميًّا** (حماية عبر-الأصول)', 'uq_civ_meter_idem',
       coalesce((select indexdef from pg_indexes where schemaname='public' and indexname='uq_civ_meter_idem'), 'غائب'),
       exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_civ_meter_idem'
                 and indexdef ilike '%unique%')

union all
select 19, 'عكس واحد لكلّ قراءة (لا عكس العكس)', 'uq_civ_meter_one_reversal',
       coalesce((select indexname from pg_indexes where schemaname='public' and indexname='uq_civ_meter_one_reversal'), 'غائب'),
       exists (select 1 from pg_indexes where schemaname='public' and indexname='uq_civ_meter_one_reversal')

union all
select 20, 'التصحيح بعكس القيد لا بتعديله (قيد entry_type/reverses)', 'civ_meter_reversal_chk',
       coalesce((select conname from pg_constraint where conname='civ_meter_reversal_chk'), 'غائب'),
       exists (select 1 from pg_constraint where conname='civ_meter_reversal_chk')

union all
select 21, 'تسجيل القراءة يحمل مفتاح تعطيل تكرار', 'idempotency_key',
       case when (select def_meter from src) ilike '%idempotency_key%' then 'موجود' else 'غائب' end,
       coalesce((select def_meter from src) ilike '%idempotency_key%', false)

-- ═══ ٧) الحجوزات — الحارس على الجدول لا داخل RPC واحدة ══════════════════════
union all
select 22, '★ حارس الحجز على **الجدول** (v1 المُصرَّحة لا تتجاوزه)', 'trg_civ_guard_reservation',
       coalesce((select g.tgname from pg_trigger g
                  where g.tgrelid = (select resv_rel from src) and not g.tgisinternal
                    and g.tgname = 'trg_civ_guard_reservation'), 'غائب — v1 تتجاوز أيّ ضمان في v2'),
       exists (select 1 from pg_trigger g where g.tgrelid = (select resv_rel from src)
                 and not g.tgisinternal and g.tgname = 'trg_civ_guard_reservation')

union all
select 23, '★ التعارض يرفع 23P01 (لا يُقرأ «ترحيلة ناقصة»)', '23P01',
       case when (select def_resvguard from src) ilike '%23P01%' then 'يرفع 23P01' else 'رمز عامّ' end,
       coalesce((select def_resvguard from src) ilike '%23P01%', false)

union all
select 24, '★ محرّك التعارض يحترم reserved_from', 'reserved_from مذكور',
       case when (select def_conflict from src) ilike '%reserved_from%' then 'يحترمه'
            else 'يتجاهله ⇒ حجز الشهر القادم يمنع اليوم' end,
       coalesce((select def_conflict from src) ilike '%reserved_from%', false)

union all
select 25, '★ يستهلك عقد prodops ولا يخترع قاعدة ثانية', 'prodops_asset_clash مذكور',
       case when (select def_conflict from src) ilike '%prodops_asset_clash%' then 'يستهلكه' else 'قاعدة ثانية متناقضة' end,
       coalesce((select def_conflict from src) ilike '%prodops_asset_clash%', false)

union all
select 26, '★ لا مصيدة شاملة تحوّل «تعارض» إلى «لا تعارض»', 'لا when others then return null',
       case when (select def_conflict from src) ilike '%when others then return null%' then 'يبتلع الأخطاء' else 'سليم' end,
       not coalesce((select def_conflict from src) ilike '%when others then return null%', true)

union all
select 27, 'ℹ️ تغطية محرّك التعارض على هذه القاعدة', 'حجوزات + عهد (+ أوامر تشغيل إن وُجدت)',
       'reservations ✓ · live_custody ✓ · prodops ' ||
         case when (select oid_prodops from src) is not null then '✓' else '✗ (تُعلَن الشاشة صراحةً)' end ||
         ' · planning_bookings ✗ (خارج التغطية — معلن)',
       true

-- ═══ ٨) حرّاس النزاهة الأربعة ═══════════════════════════════════════════════
union all
select 28, '★ لا أحد يعتمد إغلاق عهدته بنفسه', 'trg_civ_guard_assignment_closure',
       coalesce((select g.tgname from pg_trigger g where g.tgrelid = (select assign_rel from src)
                  and not g.tgisinternal and g.tgname='trg_civ_guard_assignment_closure'), 'غائب'),
       exists (select 1 from pg_trigger g where g.tgrelid = (select assign_rel from src)
                 and not g.tgisinternal and g.tgname='trg_civ_guard_assignment_closure')
       and coalesce((select def_closeguard from src) ilike '%employee_user_id%', false)

union all
select 29, '★ تاريخ العهدة المغلقة لا يُحرَّر بصمت', 'trg_civ_guard_assignment_history',
       coalesce((select g.tgname from pg_trigger g where g.tgrelid = (select assign_rel from src)
                  and not g.tgisinternal and g.tgname='trg_civ_guard_assignment_history'), 'غائب'),
       exists (select 1 from pg_trigger g where g.tgrelid = (select assign_rel from src)
                 and not g.tgisinternal and g.tgname='trg_civ_guard_assignment_history')

union all
select 30, '★ مسار الدليل الأصليّ لا يُعاد كتابته', 'trg_civ_guard_evidence_path',
       coalesce((select g.tgname from pg_trigger g where g.tgrelid = (select evid_rel from src)
                  and not g.tgisinternal and g.tgname='trg_civ_guard_evidence_path'), 'غائب'),
       exists (select 1 from pg_trigger g where g.tgrelid = (select evid_rel from src)
                 and not g.tgisinternal and g.tgname='trg_civ_guard_evidence_path')

union all
select 31, '★ لا تخريد لأصل على عهدة حيّة', 'trg_civ_guard_asset_disposal',
       coalesce((select g.tgname from pg_trigger g where g.tgrelid = (select assets_rel from src)
                  and not g.tgisinternal and g.tgname='trg_civ_guard_asset_disposal'), 'غائب'),
       exists (select 1 from pg_trigger g where g.tgrelid = (select assets_rel from src)
                 and not g.tgisinternal and g.tgname='trg_civ_guard_asset_disposal')

union all
select 32, '★ حارس التخريد لا ينهار إلى NULL', 'coalesce على كلّ طرف',
       case when (select def_dispguard from src) ilike '%coalesce%' then 'محصّن' else 'قد يُتخطّى بصمت' end,
       coalesce((select def_dispguard from src) ilike '%coalesce%', false)

union all
select 33, 'التصحيح بعد الإغلاق حدثٌ مُدقَّق لا تعديل صامت', 'custody_inv_post_closure_correction',
       case when to_regprocedure('public.custody_inv_post_closure_correction(uuid,text,jsonb)') is not null
            then 'موجود' else 'غائب' end,
       to_regprocedure('public.custody_inv_post_closure_correction(uuid,text,jsonb)') is not null

-- ═══ ٩) QR ═════════════════════════════════════════════════════════════════
union all
select 34, '★ الحمولة العامّة للـQR بلا تكلفة ولا بيانات موظّف ولا مسار تخزين',
       'لا purchase_price/current_value/book_value/file_path/employee_user_id',
       coalesce((select string_agg(w, ', ') from unnest(array['purchase_price','current_value','book_value','file_path','employee_user_id','auth.users']) as t(w)
                  where (select def_qrpay from src) ilike '%' || w || '%'), 'نظيفة'),
       not exists (select 1 from unnest(array['purchase_price','current_value','book_value','file_path','employee_user_id','auth.users']) as t(w)
                    where (select def_qrpay from src) ilike '%' || w || '%')

union all
select 35, '★ الحمولة العامّة لا تُنادى مباشرةً (تمرّ عبر المسح: معدّل + تدقيق)', '0 صلاحية',
       (select n from qrpay_grants)::text || ' صلاحية تنفيذ',
       (select n from qrpay_grants) = 0

union all
select 36, '★ المسح يشترط جلسة موظّف (V1: لا بحث مجهول الهوية)', 'is_staff',
       case when (select def_qrscan from src) ilike '%is_staff%' then 'يشترطها' else 'مفتوح' end,
       coalesce((select def_qrscan from src) ilike '%is_staff%', false)

union all
select 37, 'المسح: تحديد معدّل + احترام الإلغاء + تسجيل الحدث', '3/3',
       concat_ws(' · ',
         case when (select def_qrscan from src) ilike '%civ_qr_rate_ok%'    then 'معدّل ✓' else 'معدّل ✗' end,
         case when (select def_qrscan from src) ilike '%qr_revoked%'        then 'إلغاء ✓' else 'إلغاء ✗' end,
         case when (select def_qrscan from src) ilike '%custody_qr_events%' then 'تسجيل ✓' else 'تسجيل ✗' end),
       coalesce((select def_qrscan from src) ilike '%civ_qr_rate_ok%', false)
       and coalesce((select def_qrscan from src) ilike '%qr_revoked%', false)
       and coalesce((select def_qrscan from src) ilike '%custody_qr_events%', false)

union all
select 38, 'إعادة الإصدار تُبطل الرمز السابق (الدالّة القائمة — لم تُعَد كتابتها)', 'old_token مسجّل',
       case when to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)') is null then 'ℹ️ الترقيع 01 غير مطبَّق'
            when pg_get_functiondef(to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)')) ilike '%old_token%' then 'تُبطله وتسجّله'
            else 'لا تُبطله' end,
       to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)') is null
       or pg_get_functiondef(to_regprocedure('public.custody_inv_admin_reissue_qr(uuid,text)')) ilike '%old_token%'

union all
select 39, 'بديل البحث حين يتلف الرمز', 'custody_inv_lookup_asset',
       case when to_regprocedure('public.custody_inv_lookup_asset(text)') is not null then 'موجود' else 'غائب' end,
       to_regprocedure('public.custody_inv_lookup_asset(text)') is not null

-- ═══ ١٠) الفصل المالي — العمليات لا ترى مالًا، والمالك لا يستنتج ربحًا ══════
union all
select 40, '★ سطح الاستغلال التشغيليّ خالٍ من المال',
       'لا purchase_price/current_value/book_value/salvage_value/cost',
       coalesce((select string_agg(w, ', ') from unnest(array['purchase_price','current_value','book_value','salvage_value','cost']) as t(w)
                  where (select def_util from src) ilike '%' || w || '%'), 'نظيف'),
       not exists (select 1 from unnest(array['purchase_price','current_value','book_value','salvage_value','cost']) as t(w)
                    where (select def_util from src) ilike '%' || w || '%')

union all
select 41, 'سطح الاستغلال يُعلن خلوّه من المال للواجهة', 'contains_financials',
       case when (select def_util from src) ilike '%contains_financials%' then 'يُعلنه' else 'صامت' end,
       coalesce((select def_util from src) ilike '%contains_financials%', false)

union all
select 42, '★ ملخّص التكلفة خلف مُسنَد التكلفة الحسّاسة', 'civ_can_view_asset_sensitive_costs',
       case when (select def_cost from src) ilike '%civ_can_view_asset_sensitive_costs%' then 'مالكيّ' else 'مكشوف' end,
       coalesce((select def_cost from src) ilike '%civ_can_view_asset_sensitive_costs%', false)

union all
select 43, '★ ملخّص التكلفة لا يلمس أيّ جدول مالي (لا استنتاج ربح)',
       'لا fin_/invoices/quotes/opportunities/zoho',
       coalesce((select string_agg(w, ', ') from unnest(array['fin_','invoices','quotes','opportunities','zoho','profit']) as t(w)
                  where (select def_cost from src) ilike '%public.' || w || '%'), 'نظيف'),
       not exists (select 1 from unnest(array['fin_','invoices','quotes','opportunities','zoho','profit']) as t(w)
                    where (select def_cost from src) ilike '%public.' || w || '%')

union all
select 44, '★ لا صفر يقف مقام «المصدر غير مفعّل»', 'source_available معلن',
       case when (select def_cost from src) ilike '%source_available%' then 'يُعلن التوفّر' else 'الصفر سيُقرأ «لا تكلفة»' end,
       coalesce((select def_cost from src) ilike '%source_available%', false)

-- ═══ ١١) الإشارات قواعد لا ذكاء اصطناعيّ ════════════════════════════════════
union all
select 45, '★ كلّ إشارة تحمل قاعدتها وأساسها الرقميّ', 'rule + basis',
       concat_ws(' · ',
         case when (select def_signals from src) ilike '%''rule''%'  then 'rule ✓'  else 'rule ✗'  end,
         case when (select def_signals from src) ilike '%''basis''%' then 'basis ✓' else 'basis ✗' end),
       coalesce((select def_signals from src) ilike '%''rule''%', false)
       and coalesce((select def_signals from src) ilike '%''basis''%', false)

union all
select 46, '★ لا تُسمّى تنبّؤية ولا ذكاءً اصطناعيًّا', 'لا predict/ai_/forecast_model',
       coalesce((select string_agg(w, ', ') from unnest(array['predict','ai_','machine_learning','forecast_model']) as t(w)
                  where (select def_signals from src) ilike '%' || w || '%'), 'قواعد صريحة'),
       not exists (select 1 from unnest(array['predict','ai_','machine_learning','forecast_model']) as t(w)
                    where (select def_signals from src) ilike '%' || w || '%')

-- ═══ ١٢) التدقيق والصلاحيات ════════════════════════════════════════════════
union all
select 47, '★ كلّ كتابة حسّاسة مُدقَّقة', '9/9',
       coalesce(string_agg(sig, ', ') filter (where def is null or def not ilike '%custody_audit%'), 'كلّها مُدقَّقة'),
       not exists (select 1 from writers where def is null or def not ilike '%custody_audit%') from writers

union all
select 48, '★ لا anon ولا PUBLIC على أيّ دالّة من العائلة', '0',
       coalesce((select string_agg(distinct sig, ', ') from leaked), 'لا تسريب'),
       not exists (select 1 from leaked)

union all
select 49, '★ لا anon على الجدولين الجديدين', '0',
       coalesce((select string_agg(distinct table_name || ':' || privilege_type, ', ')
                   from information_schema.role_table_grants
                  where table_schema='public' and grantee='anon'
                    and table_name in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings')), 'لا شيء'),
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema='public' and grantee='anon'
                      and table_name in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings'))

union all
select 50, '★ لا سياسة كتابة مباشرة تتجاوز الـRPC', 'SELECT فقط',
       coalesce((select string_agg(policyname || ':' || cmd, ', ') from pg_policies
                  where schemaname='public'
                    and tablename in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings')), 'لا سياسة'),
       not exists (select 1 from pg_policies where schemaname='public'
                    and tablename in ('custody_inventory_maintenance_plans','custody_inventory_meter_readings')
                    and cmd <> 'SELECT')

-- ═══ ١٣) آلة الحالة مُشتقّة ═════════════════════════════════════════════════
union all
select 51, '★ حالة الأصل مُشتقّة لا محفوظة (لا تنحرف عن الواقع)', 'لا عمود state',
       coalesce((select string_agg(column_name, ', ') from information_schema.columns
                  where table_schema='public' and table_name='custody_inventory_assets'
                    and column_name in ('asset_state','lifecycle_state','state')), 'مُشتقّة ✓'),
       not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='custody_inventory_assets'
                      and column_name in ('asset_state','lifecycle_state','state'))

union all
select 52, 'الانتقالات المسموحة مُعلَنة (الشاشة تكفّ عن التخمين)', 'civ_allowed_transitions',
       case when to_regprocedure('public.civ_allowed_transitions(text,text)') is not null then 'مُعلَنة' else 'غائبة' end,
       to_regprocedure('public.civ_allowed_transitions(text,text)') is not null

-- ═══ ١٤) تجميد منصّة المشاريع — قارن الأرقام بلقطة PREFLIGHT §10 ════════════
union all
select 53, 'ℹ️ لقطة التجميد (طابقها مع PREFLIGHT §10 — أيّ فرق ⇒ خرق)', 'مطابِقة للقطة قبل',
       'policies=' || (select count(*) from pg_policies where schemaname='public'
                        and tablename in ('projects','project_core','deliverables','deliverable_internal'))::text
       || ' · funcs=' || (select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                           where ns.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%'))::text
       || ' · projects_cols=' || (select count(*) from information_schema.columns
                                   where table_schema='public' and table_name='projects')::text,
       true

union all
select 54, '★ الحزمة لم تُنشئ أيّ دالّة project_*/large_project_*', '0 جديد',
       coalesce((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                  where ns.nspname='public'
                    and (p.proname like 'project\_%asset%' or p.proname like '%asset%project\_%')), 'لا شيء'),
       not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                    where ns.nspname='public'
                      and (p.proname like 'project\_%asset%' or p.proname like '%asset%project\_%'))

-- ═══ ١٥) تغطية اختيارية — توثيقيّة، لا تُفشل ═══════════════════════════════
union all
select 55, 'ℹ️ مزامنة درجة الحالة (تعتمد custody_condition_reports)', 'اختياريّ',
       case when (select cond_rel from src) is null then 'الجدول غائب ⇒ الدرجة تبقى NULL بصدق (لا «جيّد» كاذبة)'
            when exists (select 1 from pg_trigger g where g.tgrelid = (select cond_rel from src)
                          and not g.tgisinternal and g.tgname='trg_civ_sync_condition_grade') then 'مربوطة ✓'
            else 'الجدول موجود والمُشغِّل غائب — أعِد تشغيل §4' end,
       (select cond_rel from src) is null
       or exists (select 1 from pg_trigger g where g.tgrelid = (select cond_rel from src)
                   and not g.tgisinternal and g.tgname='trg_civ_sync_condition_grade')

union all
select 57, '★ العدّاد المطلق محسوب (لا صفر صامت)', 'المساعدان + لا تصفية increment',
       case when to_regprocedure('public.civ_meter_total(uuid,text)') is null
                 or to_regprocedure('public.civ_meter_usage_between(uuid,text,timestamptz,timestamptz)') is null
            then 'مساعد مفقود ⇒ قراءة عدّاد الغالق ستُجمَع صفرًا ولن يحين استحقاق الاستخدام'
            when pg_get_functiondef(to_regprocedure('public.custody_inv_maint_plan_due(uuid)')) ilike '%reading_mode = ''increment''%'
            then 'استحقاق الصيانة ما زال يصفّي increment ⇒ صفر صامت'
            else 'المجموع والاستحقاق يشتقّان من المساعد الموحّد ✓' end,
       to_regprocedure('public.civ_meter_total(uuid,text)') is not null
       and to_regprocedure('public.civ_meter_usage_between(uuid,text,timestamptz,timestamptz)') is not null
       and not (pg_get_functiondef(to_regprocedure('public.custody_inv_maint_plan_due(uuid)')) ilike '%reading_mode = ''increment''%')
       and not (pg_get_functiondef(to_regprocedure('public.custody_inv_asset_meter_totals(uuid)')) ilike '%reading_mode = ''increment''%')

union all
-- ★ النافذة المقلوبة: tstzrange(lo,hi) ترفع 22000 حين hi < lo. والحزمة تُبقي
--   عمدًا صفوفًا مقلوبة (civ_resv_window_chk أُضيف NOT VALID، والبوّاب يوقف على
--   النشط فقط)، فقراءتها الخام كانت ستُسقط تقويم الحجز ومحرّك التعارض برمز لا
--   يصنّفه pgerror.ts. الفحص يثبت وجود البانية الآمنة **و** أنّ المستهلكين
--   الأربعة الحسّاسين يستدعونها فعلًا بدل tstzrange الخام.
select 58, '★★ النوافذ الزمنيّة تمرّ ببانية آمنة (لا 22000 على صفّ مقلوب)',
       'civ_window موجودة ومستهلَكة في التعارض والتقويم والحالة والاستغلال',
       case when to_regprocedure('public.civ_window(timestamptz,timestamptz)') is null
            then 'civ_window مفقودة ⇒ أوّل صفّ بنافذة مقلوبة يُسقط الحجز والتقويم بـ22000'
            when (select def_conflict from src) not ilike '%civ_window%'
            then 'محرّك التعارض ما زال على tstzrange الخام ⇒ عهدة بتاريخ عودة أقدم من الصرف تمنع كلّ حجز على ذلك الأصل'
            when pg_get_functiondef(to_regprocedure('public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid)')) not ilike '%civ_window%'
            then 'التقويم ما زال على tstzrange الخام ⇒ حجز ملغى مقلوب (وقد تعمّدنا إبقاءه) يُسقط الشاشة'
            when (select def_util from src) not ilike '%civ_window%'
            then 'الاستغلال ما زال على tstzrange الخام'
            else 'البانية موجودة والمستهلكون الأربعة يمرّون بها ✓' end,
       to_regprocedure('public.civ_window(timestamptz,timestamptz)') is not null
       and (select def_conflict from src) ilike '%civ_window%'
       and pg_get_functiondef(to_regprocedure('public.custody_inv_reservation_calendar(timestamptz,timestamptz,uuid)')) ilike '%civ_window%'
       and pg_get_functiondef(to_regprocedure('public.civ_asset_state(uuid)')) ilike '%civ_window%'
       and (select def_util from src) ilike '%civ_window%'

union all
select 56, 'ℹ️ كتالوج الصلاحيات الدقيق', 'اختياريّ',
       case when (select oid_perm from src) is null then 'غائب ⇒ المُسنَدات تسقط إلى civ_can_manage() وحدها (fail-closed)'
            else 'حاضر ⇒ 4 مفاتيح دقيقة مُسجَّلة (لا مفتاح للتكلفة الحسّاسة عمدًا)' end,
       true

)
select n as "#", check_name as "الفحص", expected as "المتوقَّع", actual as "الواقع",
       case when passed then 'PASS'
            when check_name like 'ℹ️%' then 'ℹ️ INFO'
            else '❌ FAIL' end as verdict
  from checks
 order by n;
