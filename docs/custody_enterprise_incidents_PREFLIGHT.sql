-- ════════════════════════════════════════════════════════════════════════════
-- CUSTODY ENTERPRISE · INCIDENTS — PREFLIGHT. يقرأ ولا يكتب. آمن على Production.
--
-- نطاقه **هذه الحزمة وحدها**. ⛔ ولا يفحص اعتمادات حزم أخرى.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1` ليعود رمز الخروج غير صفريّ عند النقص.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §1 · جداول مطلوبة ─────────────────────────────────────────────────────
select 'REQUIRED_DEPENDENCY' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.src as created_by
from (values
  ('custody_inventory_assets',            'portal_custody_inventory_system_v1_RUNME.sql'),
  ('custody_inventory_assignments',       'portal_custody_inventory_system_v1_RUNME.sql'),
  ('custody_inventory_assignment_items',  'portal_custody_inventory_system_v1_RUNME.sql'),
  ('custody_enterprise_settings',         'custody_enterprise_00_feature_flags_PATCH.sql')
) v(n, src);

-- ─── §2 · أعمدة يعتمد عليها الكود — بالاسم الفعليّ لا بالافتراض ────────────
select 'REQUIRED_COLUMN' as kind, v.t||'.'||v.c as name,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name::text=v.t and column_name::text=v.c)
            then '✅ موجود' else '🔴 مفقود' end as status,
       v.why as created_by
from (values
  ('custody_inventory_assignments','employee_user_id',   'ملكية العهدة للموظّف'),
  ('custody_inventory_assignments','expected_return_at', 'الاستحقاق والتأخّر'),
  ('custody_inventory_assignments','assignment_number',  'نصّ التنبيه'),
  ('custody_inventory_assignments','status',             'active/partially_returned/return_requested'),
  ('custody_inventory_assignments','is_deleted',         'استبعاد المحذوف'),
  ('custody_inventory_assignments','updated_at',         'طلبات الإرجاع المعلّقة'),
  ('custody_inventory_assignment_items','assignment_id', 'ربط البند بالعهدة'),
  ('custody_inventory_assignment_items','asset_id',      'المُشغِّل وربط الحادثة'),
  ('custody_inventory_assets','asset_code',              'نصّ تنبيه الضمان'),
  ('custody_inventory_assets','warranty_expiry_date',    'تنبيه انتهاء الضمان'),
  ('custody_inventory_assets','is_deleted',              'استبعاد المحذوف'),
  ('custody_enterprise_settings','overdue_escalation_hours','عتبة التصعيد')
) v(t, c, why);

-- ─── §3 · بوّابات ودوالّ مطلوبة — بالتوقيع الدقيق ─────────────────────────
-- 🔴 `to_regprocedure` لا `to_regproc`: الثانية لا تقبل توقيعًا وتُعيد NULL دائمًا.
-- ⚠️ والاسم `is_staff()` — **لا وجود** لدالّة `civ_is_staff()` في المستودع.
select 'REQUIRED_GATE' as kind, v.sig as name,
       case when to_regprocedure(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.src as created_by
from (values
  ('public.is_staff()',                              'phase1_s4_db_addendum_PROPOSAL.sql'),
  ('public.civ_flag(text)',                          'custody_enterprise_01_qr_kits_PATCH.sql'),
  ('public.civ_gen_no(text)',                        'portal_custody_inventory_system_v1_RUNME.sql'),
  ('public.civ_can_manage()',                        'authz_fixC_null_failopen_gates_RUNME.sql'),
  ('public.civ_notify(uuid,text,uuid,text,text)',    'custody_inventory_email_outbox_RUNME.sql'),
  ('public.civ_notify_managers(text,uuid,text,text)','custody_notification_matrix_RUNME.sql'),
  ('public.custody_audit(text,text,uuid,jsonb)',     'custody_enterprise_00_feature_flags_PATCH.sql')
) v(sig, src);

-- ════════════════════════════════════════════════════════════════════════════
-- §4 · APPLY_STATE — الحزمة قابلة للتشغيل فوق قاعدة **نظيفة أو مطبَّقة**
--
-- 🔴 لماذا لم يعد `EXPECTED_ABSENT` وحده كافيًا: RUNME نجح فعلًا على Preview
--    وCOMMIT تمّ. فاشتراطُ الغياب يحوّل كلّ إصلاح لاحق (صلاحيات مثلًا) إلى
--    إسقاطٍ للجداول — وهو **بالضبط** ما لا يجوز على بيانات حقيقية.
--
--   • صفر من الثلاثة        ⇒ FRESH_APPLY
--   • ثلاثة + تعريف مطابق   ⇒ MATCHING_REAPPLY (إصلاح صلاحيات آمن)
--   • واحد أو اثنان         ⇒ 🔴 PARTIAL — توقّف
--   • موجود بتعريف مخالف    ⇒ 🔴 MISMATCH — توقّف ولا يُستبدل بصمت
-- ⛔ ولا حالة بين هذه: التشغيل فوق حالة مجهولة هو ما ينتج مخطّطًا هجينًا.
-- ════════════════════════════════════════════════════════════════════════════
select 'APPLY_STATE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '⚪️ غائب'
            else '🟢 موجود' end as status,
       'custody_enterprise_incidents_RUNME.sql' as created_by
from (values ('custody_incidents'),('custody_incident_actions'),('custody_alert_deliveries')) v(n);

-- التصنيف الإجماليّ.
select 'APPLY_STATE' as kind, 'CLASSIFICATION' as name,
       case count(*) filter (where to_regclass('public.'||v.n) is not null)
         when 0 then '✅ FRESH_APPLY — تطبيق أوّل'
         when 3 then '✅ MATCHING_REAPPLY — إعادة تطبيق/إصلاح صلاحيات (راجع §4-ب)'
         else '🔴 PARTIAL — بعض الجداول فقط · توقّف' end as status,
       '—' as created_by
from (values ('custody_incidents'),('custody_incident_actions'),('custody_alert_deliveries')) v(n);

-- ─── §4-ب · مطابقة التعريف — لا يُعاد التطبيق فوق جدول يحمل الاسم فقط ──────
-- ⚠️ `create table if not exists` يتجاهل جدولًا قائمًا **مهما كان تعريفه**.
--    فالجدول المخالف يبقى مخالفًا بلا إنذار — يُحسم هنا لا هناك.
select 'DEFINITION_MATCH' as kind, v.t||'.'||v.c as name,
       case when to_regclass('public.'||v.t) is null then '⚪️ الجدول غائب — لا مطابقة مطلوبة'
            when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name::text=v.t and column_name::text=v.c)
                 then '✅ مطابق'
            else '🔴 الجدول موجود بلا هذا العمود — تعريف مخالف · توقّف' end as status,
       '—' as created_by
from (values
  ('custody_incidents','incident_number'), ('custody_incidents','incident_type'),
  ('custody_incidents','status'),          ('custody_incidents','is_deleted'),
  ('custody_incidents','reported_by'),     ('custody_incidents','assignment_id'),
  ('custody_incidents','asset_id'),
  ('custody_incident_actions','incident_id'), ('custody_incident_actions','action_type'),
  ('custody_alert_deliveries','dedup_key'),   ('custody_alert_deliveries','alert_type'),
  ('custody_alert_deliveries','status')
) v(t, c);

-- ─── §4-ج · الصلاحيات القائمة — تشخيص قرائيّ يسبق الإصلاح ─────────────────
-- 🔴 Preview أظهر `anon = Dxtm` على جداول لم يمنحها أحد شيئًا. المصدر ACL
--    افتراضيّ في المشروع، ⛔ ولا ملفّ في المستودع يُنشئه — بل ثلاثة ملفّات
--    تنفي وجوده. هذا القسم يطبع الواقع بدل الاعتقاد.
select 'CURRENT_TABLE_ACL' as kind, c.relname::text as name,
       coalesce(array_to_string(c.relacl, ' · '), '(افتراضيّ — لا ACL صريح)') as status,
       pg_get_userbyid(c.relowner)::text as created_by
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries');

-- 🔴 مصدر المنح التلقائيّ نفسه — يُقرأ ولا يُغيَّر.
select 'DEFAULT_ACL' as kind,
       coalesce(pg_get_userbyid(d.defaclrole),'?')||' → '||coalesce(n2.nspname,'(كل المخطّطات)') as name,
       array_to_string(d.defaclacl, ' · ') as status,
       case d.defaclobjtype when 'r' then 'جداول' when 'S' then 'تسلسلات'
                            when 'f' then 'دوالّ'  else d.defaclobjtype::text end as created_by
from pg_default_acl d left join pg_namespace n2 on n2.oid = d.defaclnamespace;
-- 🔴 اقرأ هذا الصفّ جيّدًا: `grant … on all tables in schema public` **لا يمسّ
--    جدولًا يُنشأ بعده**. فظهور Dxtm على جدول وُلد للتوّ لا يُفسَّر إلّا بـACL
--    افتراضيّ هنا. وإن خرج هذا القسم **فارغًا** رغم ذلك، فالمصدر الوحيد
--    المتبقّي event trigger يمنح تلقائيًّا — وذلك اكتشافٌ يستحقّ ملفًّا خاصًّا،
--    ⛔ ولا يُعالَج بتخمين داخل هذه الحزمة. وفي الحالتين: السحب الصريح يُصلح
--    جداولنا الثلاثة، ⛔ ولا يدّعي إصلاح المشروع كلّه.

-- ─── §5 · حالة الأعمدة القائمة — مطابقة أو غائبة، ⛔ ولا شيء بينهما ───────
-- 🔴 عمود موجود **بنوع مختلف** لا يُستبدل بصمت: `add column if not exists`
--    يتجاهله، فيبقى المخطّط مخالفًا للعقد بلا إنذار.
select 'EXISTING_COLUMN_STATE' as kind, 'custody_inventory_assets.'||v.c as name,
       case
         when not exists (select 1 from information_schema.columns
                           where table_schema='public' and table_name::text='custody_inventory_assets'
                             and column_name::text=v.c)
              then '✅ غائب — ستُنشئه الحزمة'
         when exists (select 1 from information_schema.columns
                       where table_schema='public' and table_name::text='custody_inventory_assets'
                         and column_name::text=v.c and data_type = v.t)
              then '✅ موجود بالنوع المتوقَّع'
         else '🔴 موجود بنوع مختلف — توقّف ولا تستبدل بصمت' end as status,
       v.t as created_by
from (values ('on_hold','boolean'),('hold_reason','text')) v(c, t);

-- ─── §6 · حالة المُشغِّل القائم ───────────────────────────────────────────
-- ⚠️ الحزمة تُعيد إنشاءه بحدث أوسع (`insert or update of asset_id`). فوجوده
--    بالحدث القديم حالة متوقَّعة تُرقّى، ⛔ ووجوده على **جدول آخر** توقّف.
select 'EXISTING_TRIGGER_STATE' as kind, 'trg_civ_item_hold' as name,
       case
         when not exists (select 1 from pg_trigger where tgname='trg_civ_item_hold' and not tgisinternal)
              then '✅ غائب — ستُنشئه الحزمة'
         when exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                       where t.tgname='trg_civ_item_hold' and not t.tgisinternal
                         and c.relname='custody_inventory_assignment_items')
              then '🟡 موجود على الجدول الصحيح — سيُرقَّى إلى insert+update of asset_id'
         else '🔴 موجود على جدول آخر — توقّف' end as status,
       '—' as created_by;

-- ─── §7 · ⛔ لا نظام موازٍ ────────────────────────────────────────────────
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود'
            else '🔴 نظام موازٍ — توقّف' end as status, '—' as created_by
from (values ('incidents'),('asset_incidents'),('custody_holds'),('alert_log'),
             ('custody_alerts'),('incident_reports')) v(n);

-- ════════════════════════════════════════════════════════════════════════════
-- §8 · 🔴 الحسم — يفشل فعليًّا لا طباعةً
-- ⛔ ولا يُحتسب وجودُ جداول الحزمة بذاته: FRESH_APPLY وMATCHING_REAPPLY كلاهما
--    حالة صحيحة. ما يُحتسب هو **الحالة الهجينة**: بعضُها موجود، أو موجود
--    بتعريف مخالف.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_missing text[] := '{}'; v_t text; v_sig text; v_pair text; v_present int;
begin
  foreach v_t in array array['custody_inventory_assets','custody_inventory_assignments',
                             'custody_inventory_assignment_items','custody_enterprise_settings']
  loop
    if to_regclass('public.'||v_t) is null then v_missing := v_missing || ('TABLE '||v_t); end if;
  end loop;

  foreach v_pair in array array[
    'custody_inventory_assignments.employee_user_id','custody_inventory_assignments.expected_return_at',
    'custody_inventory_assignments.assignment_number','custody_inventory_assignments.status',
    'custody_inventory_assignments.is_deleted','custody_inventory_assignments.updated_at',
    'custody_inventory_assignment_items.assignment_id','custody_inventory_assignment_items.asset_id',
    'custody_inventory_assets.asset_code','custody_inventory_assets.warranty_expiry_date',
    'custody_inventory_assets.is_deleted','custody_enterprise_settings.overdue_escalation_hours']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public'
                      and table_name::text  = split_part(v_pair,'.',1)
                      and column_name::text = split_part(v_pair,'.',2))
    then v_missing := v_missing || ('COLUMN '||v_pair); end if;
  end loop;

  foreach v_sig in array array['public.is_staff()','public.civ_flag(text)',
                               'public.civ_gen_no(text)','public.civ_can_manage()',
                               'public.civ_notify(uuid,text,uuid,text,text)',
                               'public.civ_notify_managers(text,uuid,text,text)',
                               'public.custody_audit(text,text,uuid,jsonb)']
  loop
    if to_regprocedure(v_sig) is null then v_missing := v_missing || ('GATE '||v_sig); end if;
  end loop;

  -- 🔴 APPLY_STATE: صفر أو ثلاثة. وما بينهما حالة هجينة يُمنع التشغيل فوقها.
  select count(*) into v_present
  from (values ('custody_incidents'),('custody_incident_actions'),('custody_alert_deliveries')) t(n)
  where to_regclass('public.'||t.n) is not null;
  if v_present not in (0, 3) then
    v_missing := v_missing || format('PARTIAL %s/3 من جداول الحزمة موجودة — أكمِل يدويًّا أو احسم الحالة', v_present);
  end if;

  -- 🔴 MISMATCH: جدول يحمل الاسم بلا التعريف. `create table if not exists`
  --    يتجاوزه بصمت، فيبقى المخطّط مخالفًا للعقد بلا إنذار واحد.
  if v_present > 0 then
    foreach v_pair in array array[
      'custody_incidents.incident_number','custody_incidents.incident_type',
      'custody_incidents.status','custody_incidents.is_deleted',
      'custody_incidents.reported_by','custody_incidents.assignment_id','custody_incidents.asset_id',
      'custody_incident_actions.incident_id','custody_incident_actions.action_type',
      'custody_alert_deliveries.dedup_key','custody_alert_deliveries.alert_type',
      'custody_alert_deliveries.status']
    loop
      if to_regclass('public.'||split_part(v_pair,'.',1)) is not null
         and not exists (select 1 from information_schema.columns
                          where table_schema='public'
                            and table_name::text  = split_part(v_pair,'.',1)
                            and column_name::text = split_part(v_pair,'.',2))
      then v_missing := v_missing || ('MISMATCH '||v_pair||' — الجدول موجود بتعريف مخالف'); end if;
    end loop;
  end if;

  -- 🔴 حالة جزئية غير معروفة: عمود بنوع مخالف، أو مُشغِّل على جدول آخر.
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name::text='custody_inventory_assets'
                and column_name::text='on_hold' and data_type <> 'boolean') then
    v_missing := v_missing || 'PARTIAL on_hold بنوع مخالف';
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
              where t.tgname='trg_civ_item_hold' and not t.tgisinternal
                and c.relname <> 'custody_inventory_assignment_items') then
    v_missing := v_missing || 'PARTIAL trg_civ_item_hold على جدول آخر';
  end if;

  foreach v_t in array array['incidents','asset_incidents','custody_holds','alert_log',
                             'custody_alerts','incident_reports']
  loop
    if to_regclass('public.'||v_t) is not null then v_missing := v_missing || ('PARALLEL '||v_t); end if;
  end loop;

  if array_length(v_missing,1) > 0 then
    raise exception E'🔴 CUSTODY INCIDENTS PREFLIGHT FAILED:\n  %\n'
      '⛔ لا تُشغّل custody_enterprise_incidents_RUNME.sql.',
      array_to_string(v_missing, E'\n  ');
  end if;
  raise notice '✅ CUSTODY INCIDENTS PREFLIGHT PASSED.';
end $$;
