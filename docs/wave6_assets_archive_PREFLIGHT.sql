-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · assets_archive · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
--
-- ★★ 🔴 ثلاثة عيوب أُصلحت هنا ★★
--
--  ١. **`to_regproc` لا تقبل توقيعًا.** كان `to_regproc(v.sig)` و`v.sig` يحمل
--     `public.civ_can_view_assets()` بأقواس. و`to_regproc` تأخذ **اسمًا
--     مجرَّدًا**، فتُعيد NULL دائمًا ⇒ بوّابات موجودة تُبلَّغ «مفقودة».
--     وPreview أثبت وجود الثلاث بـ`to_regprocedure`. الصحيح `to_regprocedure`.
--
--  ٢. **الفحص كان قائمة مشتركة بين حزمتين.** هذا الملفّ كان **نسخة طبق الأصل**
--     من `wave6_compliance_knowledge_PREFLIGHT.sql`: اتّحاد اعتمادات الحزمتين
--     في قائمة واحدة. فكان يطلب `custody_incidents` و`ai_knowledge_sources`
--     و`prodops_can_view()` — ⛔ **ولا يستعمل RUNME هذه الحزمة أيًّا منها**.
--     ⇒ `custody_incidents` الغائب كان يُحمِّر حزمةً لا تحتاجه إطلاقًا.
--
--  ٣. **الفشل كان طباعةً فقط.** 🔴 ثمّ خروج بحالة 0، فيمضي التشغيل الآليّ فوق
--     اعتماد مفقود. صار البلوك الأخير يرمي استثناءً (§٦).
--
-- ★ النطاق: اعتمادات **هذه الحزمة وحدها** — مستخرَجة من RUNME بالأدلّة ★
--   `grep public.<obj>` على `wave6_assets_archive_RUNME.sql` يعطي بالضبط:
--   `can_manage_projects` ×٧ · `projects` ×٣ · `civ_can_view_assets` ×٣ ·
--   `custody_inventory_assets` ×٢ · `asset_insurance_policies` ×٢ ·
--   `civ_can_manage_assets` ×١ (السطر ٣٢٣) — ولا شيء غيرها.
--
-- ⛔ لا كتابة · لا مِنَح · لا إنشاء.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §1 · جداول **مطلوبة** لهذه الحزمة ─────────────────────────────────────
select 'REQUIRED_DEPENDENCY' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.src as created_by, v.why as used_for
from (values
  ('custody_inventory_assets', 'asset_intelligence_RUNME.sql / custody inventory',
   'مفتاح أجنبيّ في asset_insurance_coverage'),
  ('asset_insurance_policies', 'baseline (asset insurance)',
   'مفتاح أجنبيّ في asset_insurance_coverage'),
  ('projects',                 'baseline',
   'ربط الأرشيف والتراخيص والإفراجات بالمشروع')
) v(n, src, why);

-- ─── §2 · بوّابات **مطلوبة** — تُستدعى داخل دوالّ الحزمة ───────────────────
-- 🔴 تُفحص بـ`to_regprocedure`: التوقيع بأقواس، و`to_regproc` تُعيد NULL دائمًا.
select 'REQUIRED_GATE' as kind, v.sig as name,
       case when to_regprocedure(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.src as created_by, v.why as used_for
from (values
  ('public.civ_can_view_assets()',   'asset_intelligence_RUNME.sql',
   'سياسات القراءة على تغطية التأمين والأرشيف'),
  ('public.civ_can_manage_assets()', 'asset_intelligence_RUNME.sql',
   'حارس archive_media_upsert (السطر ٣٢٣)'),
  ('public.can_manage_projects()',   'baseline (project platform authz)',
   'حارس التراخيص والإفراجات وملخّص الحقوق')
) v(sig, src, why);
-- ⚠️ `civ_can_manage_assets()` **لم تكن** في القائمة الرسمية، وRUNME يستدعيها
--    بلا حارس وجود. أُضيفت بالدليل لا بالافتراض.

-- ─── §3 · ما تُنشئه هذه الحزمة — غيابه **متوقَّع** ─────────────────────────
select 'EXPECTED_ABSENT' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null
            then '✅ غائب كما هو متوقَّع (ستُنشئه RUNME)'
            else '🟡 موجود — إعادة تشغيل (الحزمة idempotent)' end as status,
       'wave6_assets_archive_RUNME.sql' as created_by,
       'من جداول الحزمة الستّة' as used_for
from (values ('asset_insurance_coverage'),('archive_media'),('archive_project_links'),
             ('music_licenses'),('music_license_project_links'),('model_releases')) v(n);

-- ─── §3-ب · تعارض سابق على عقد تفرّد التراخيص ─────────────────────────────
-- ⚠️ الحزمة تُنشئ `ml_title_license_uniq` بـ`if not exists`. لكنّ **فهرسًا
--    باسم آخر** أو **قيدًا** على نفس العمودين يمرّ من ذلك الحارس ثمّ يتعارض
--    دلاليًّا — أو يمنع إدراجًا مشروعًا بصمت.
select 'CONFLICTING_UNIQUE' as kind, i.indexname as name,
       case when i.indexname = 'ml_title_license_uniq' then '✅ فهرس الحزمة نفسه'
            else '🔴 فهرس فريد آخر على نفس الجدول — احسمه قبل التشغيل' end as status,
       '—' as created_by, i.indexdef as used_for
from pg_indexes i
where i.schemaname = 'public' and i.tablename = 'music_licenses'
  and i.indexdef ilike '%unique%'
  and i.indexdef !~* 'music_licenses_pkey';

select 'CONFLICTING_CONSTRAINT' as kind, con.conname as name,
       '🔴 قيد تفرّد على الجدول — قد يتعارض مع الفهرس التعبيريّ' as status,
       '—' as created_by, pg_get_constraintdef(con.oid) as used_for
from pg_constraint con
join pg_class r on r.oid = con.conrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname='public' and r.relname='music_licenses' and con.contype = 'u';
-- المتوقَّع: **صفر صفوف** — العقد يُفرض بفهرس تعبيريّ لا بقيد.

-- ─── §4 · ⛔ لا نظام موازٍ ──────────────────────────────────────────────────
-- ⚠️ حُصرت في ما يخصّ الأصول والأرشيف. وأصناف الامتثال والمعرفة
--    (`sops` · `knowledge_articles` · `hse_incidents` · `compliance_registry`)
--    نُقلت إلى فحص حزمة Compliance Knowledge — فهي ليست من نطاق هذه الحزمة.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود'
            else '🔴 نظام موازٍ — توقّف' end as status,
       '—' as created_by, 'ازدواج محتمل' as used_for
from (values ('assets'),('equipment_usage_log'),('maintenance_schedule'),
             ('media_archive'),('music_rights'),('model_consents')) v(n);

-- ─── §5 · خطّ أساس صلاحيات anon ────────────────────────────────────────────
select 'ANON_GRANTS' as kind, routine_name::text as name,
       privilege_type::text as status, '—' as created_by, '—' as used_for
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text='anon'
  and routine_name::text in ('project_rights_summary','archive_media_upsert',
                             'music_license_upsert','model_release_upsert',
                             'model_release_withdraw');
-- المتوقَّع: **صفر صفوف** — ولا دالّة من هذه الحزمة تُمنح لـanon.

-- ════════════════════════════════════════════════════════════════════════════
-- §6 · 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- ⛔ ولا يُحتسب هنا: EXPECTED_ABSENT (من إنتاج الحزمة)، ولا أيّ اعتماد يخصّ
--    حزمة Compliance Knowledge — إدراجه كان يحجب هذه الحزمة بلا سبب.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1` ليعود رمز الخروج غير صفريّ.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text[] := '{}';
  v_t text;
  v_sig text;
begin
  foreach v_t in array array['custody_inventory_assets','asset_insurance_policies','projects']
  loop
    if to_regclass('public.'||v_t) is null then
      v_missing := v_missing || ('TABLE ' || v_t);
    end if;
  end loop;

  foreach v_sig in array array['public.civ_can_view_assets()',
                               'public.civ_can_manage_assets()',
                               'public.can_manage_projects()']
  loop
    if to_regprocedure(v_sig) is null then
      v_missing := v_missing || ('GATE ' || v_sig);
    end if;
  end loop;

  foreach v_t in array array['assets','equipment_usage_log','maintenance_schedule',
                             'media_archive','music_rights','model_consents']
  loop
    if to_regclass('public.'||v_t) is not null then
      v_missing := v_missing || ('PARALLEL ' || v_t);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception E'🔴 WAVE 6 ASSETS ARCHIVE PREFLIGHT FAILED — اعتمادات مفقودة:\n  %\n'
      '⛔ لا تُشغّل wave6_assets_archive_RUNME.sql. '
      'وبوّابات الأصول تُنشئها asset_intelligence_RUNME.sql.',
      array_to_string(v_missing, E'\n  ');
  end if;

  raise notice '✅ WAVE 6 ASSETS ARCHIVE PREFLIGHT PASSED.';
end $$;
