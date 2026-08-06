-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 6 · compliance_knowledge · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
--
-- ★★ 🔴 نفس عيوب حزمة assets_archive — وهذا الملفّ كان **نسخة طبق الأصل** منها
--
--  ١. `to_regproc(v.sig)` مع توقيع بأقواس ⇒ NULL دائمًا ⇒ بوّابة موجودة
--     تُبلَّغ «مفقودة». الصحيح `to_regprocedure`.
--  ٢. القائمة كانت اتّحاد اعتمادات الحزمتين، فطلبت
--     `custody_inventory_assets` و`asset_insurance_policies` و
--     `civ_can_view_assets()` — ⛔ **ولا تستعملها هذه الحزمة**.
--  ٣. 🔴 ثمّ خروج بحالة 0 ⇒ لا توقّف حقيقيّ.
--
-- ★ النطاق مستخرَج من RUNME بالأدلّة ★
--   `grep public.<obj>` على `wave6_compliance_knowledge_RUNME.sql` يعطي:
--   `ai_knowledge_sources` · `custody_incidents` · `ops_incidents` ·
--   `ops_job_hse` · `project_task_checklists` · `project_tasks` ·
--   `prodops_can_view` · `can_manage_projects` · `log_activity`.
--
-- ⛔ لا كتابة · لا مِنَح · لا إنشاء.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §1 · جداول **مطلوبة** لهذه الحزمة ─────────────────────────────────────
select 'REQUIRED_DEPENDENCY' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.why as used_for
from (values
  ('ai_knowledge_sources',    'الإجراءات التشغيلية تُكتب داخل مصادر المعرفة القائمة'),
  ('ops_job_hse',             'سجلّ السلامة على أيّام التصوير'),
  ('ops_incidents',           'حوادث التشغيل'),
  ('project_task_checklists', 'ربط الإجراء بقوائم مهامّ المشروع'),
  ('project_tasks',           'الربط بالمهامّ القائمة'),
  -- 🔴 مطلوب لا اختياريّ: `hse_register_v` تقرؤه في فرع UNION **بلا حارس وجود**
  --    (السطر ٧٦). فغيابه ⇒ فشل `create view` بـ42P01 ⇒ تراجع الحزمة كلّها،
  --    وهو **بالضبط** ما وقع لحزمة Wave 4 مع عمود غير موجود.
  -- 🔴 المنشئ: `custody_enterprise_incidents_RUNME.sql` (prerequisite رسميّ).
  --    ⛔ ولا يُنسخ تعريف الجدول هنا: حزمة واحدة تملكه.
  ('custody_incidents',       'فرع في hse_register_v — غير محروس · يُنشئه custody_enterprise_incidents_RUNME.sql')
) v(n, why);

-- ⚠️ **تنبيه تشغيليّ:** Preview أثبت أنّ `custody_incidents` **غير موجود**.
--    ⇒ شغّل `custody_enterprise_incidents_RUNME.sql` **أوّلًا** (الموضع ٧ في
--    ترتيب الإصدار). ⛔ ولا يُنسخ تعريف الجدول إلى هذه الحزمة: نسختان من نفس
--    الجدول تنحرفان، والانحراف في سجلّ حوادث أخطر من غيابه.

-- ─── §2 · بوّابات **مطلوبة** ───────────────────────────────────────────────
select 'REQUIRED_GATE' as kind, v.sig as name,
       case when to_regprocedure(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status,
       v.why as used_for
from (values
  ('public.prodops_can_view()',    'قراءة سجلّ السلامة والتشغيل'),
  ('public.can_manage_projects()', 'إدارة الإجراءات وربطها بالمهامّ')
) v(sig, why);
-- ⛔ ولا `civ_can_view_assets()` هنا: تخصّ حزمة Assets Archive.

-- ─── §3 · قيد نوع الإجراء في الجدول القائم ─────────────────────────────────
-- 🔴 نوع الإجراء يجب أن يكون مقبولًا في القيد القائم — وإلّا فشل الإدراج.
select 'REQUIRED_CONSTRAINT' as kind, 'ai_sources_type_known' as name,
       case when count(*) = 0 then '🔴 القيد غير موجود'
            when bool_or(pg_get_constraintdef(oid) like '%operations_procedure%')
                 then '✅ مقبول — لا توسعة قيد'
            else '🔴 غير مقبول — راجع القيد' end as status,
       'operations_procedure' as used_for
from pg_constraint where conname = 'ai_sources_type_known';

-- ─── §4 · ⛔ لا نظام موازٍ (امتثال ومعرفة) ─────────────────────────────────
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود'
            else '🔴 نظام موازٍ — توقّف' end as status,
       'ازدواج محتمل' as used_for
from (values ('sops'),('knowledge_articles'),('hse_incidents'),('compliance_registry')) v(n);

-- ════════════════════════════════════════════════════════════════════════════
-- §5 · 🔴 الحسم — يفشل فعليًّا لا طباعةً
-- 🔴 و`custody_incidents` **محتسَب**: غيابه يُفشل `create view` فتتراجع الحزمة.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_missing text[] := '{}'; v_t text; v_sig text;
begin
  foreach v_t in array array['ai_knowledge_sources','ops_job_hse','ops_incidents',
                             'project_task_checklists','project_tasks',
                             'custody_incidents']
  loop
    if to_regclass('public.'||v_t) is null then
      v_missing := v_missing || ('TABLE ' || v_t);
    end if;
  end loop;

  foreach v_sig in array array['public.prodops_can_view()','public.can_manage_projects()']
  loop
    if to_regprocedure(v_sig) is null then
      v_missing := v_missing || ('GATE ' || v_sig);
    end if;
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'ai_sources_type_known'
                   and pg_get_constraintdef(oid) like '%operations_procedure%') then
    v_missing := v_missing || 'CONSTRAINT ai_sources_type_known لا يقبل operations_procedure';
  end if;

  foreach v_t in array array['sops','knowledge_articles','hse_incidents','compliance_registry']
  loop
    if to_regclass('public.'||v_t) is not null then
      v_missing := v_missing || ('PARALLEL ' || v_t);
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception E'🔴 WAVE 6 COMPLIANCE KNOWLEDGE PREFLIGHT FAILED:\n  %\n'
      '⛔ لا تُشغّل wave6_compliance_knowledge_RUNME.sql.',
      array_to_string(v_missing, E'\n  ');
  end if;

  raise notice '✅ WAVE 6 COMPLIANCE KNOWLEDGE PREFLIGHT PASSED.';
end $$;
