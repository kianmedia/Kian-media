-- ════════════════════════════════════════════════════════════════════════════
-- executive_reporting_ROLLBACK.sql
--
-- ⚠️ اقرأ هذا كاملًا قبل تشغيل أيّ سطر. هذا الملفّ **صادق عمّا يُفقَد**.
--
-- ─── ما الذي يُفقَد فعلًا ───────────────────────────────────────────────────
-- ★ لا يُفقَد أيّ رقم تشغيليّ أو ماليّ أو بيعيّ ★
--   هذه الحزمة لا تملك رقمًا واحدًا خاصًّا بها. كلّ ما تعرضه مقروء لحظةَ العرض
--   من comms_* وprodops_* وcrm_* وfinops_*، وتلك الموديولات لا تتأثّر إطلاقًا.
--   حذف هذه الحزمة يحذف **العدسة**، لا ما تنظر إليه.
--
-- الذي يُفقَد بالفعل شيئان لا ثالث لهما:
--   • mgmt_report_cache — نسخ مؤقّتة قابلة لإعادة التوليد بضغطة «تحديث» بعد
--     إعادة التثبيت. فقدانها بلا أثر: أوّل فتح للوحة يعيد بناءها.
--   • mgmt_audit       — ★ هذا هو الفقد الحقيقيّ ★: سجلّ «من صدّر أيّ تقرير
--     ومتى وبأيّ مرشّحات، وهل كان يرى الطبقة الحسّاسة».
--     هذا أثر رقابيّ لا نسخة له في أيّ مكان آخر،
--     وهو أوّل ما يُطلَب لو ظهر رقم ماليّ خارج الشركة.
--     خُذ نسخة منه قبل المرحلة (ب) — الاستعلام جاهز أدناه.
--
-- ─── ما الذي لا يتأثّر إطلاقًا ─────────────────────────────────────────────
--   • منصّة المشاريع المجمَّدة بكاملها: الحزمة لم تكتب فيها ولم تقرأها أصلًا.
--   • مركز الاتصال (comms_*) ومركز التشغيل (ops_*/prodops_*) والمبيعات (crm_*)
--     والمالية (fin_*/finops_*): بياناتها ودوالّها وسياساتها كما هي حرفيًّا.
--   • كتالوج الصلاحيات: تُحذف مفاتيح exec_report.* وحدها، وكلّ مفتاح آخر يبقى.
--     ⚠️ حذف المفتاح يحذف معه إسناداته في جداول محرّك الصلاحيات (إن وُجدت
--     قيود ON DELETE CASCADE)، فمن كان يملك exec_report.view سيفقده. هذا مقصود
--     في التراجع الكامل، وليس مقصودًا في المرحلة (أ).
--
-- ─── التوصية ───────────────────────────────────────────────────────────────
-- في أغلب الأعطال المرحلة (أ) وحدها كافية: تُغلق اللوحة فورًا وتُبقي كلّ شيء.
-- لا تُشغّل (ب) إلّا بقرار صريح من المالك وبعد أخذ نسخة من mgmt_audit.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── نسخة احتياطية من الأثر الرقابيّ (شغّلها أوّلًا واحفظ الناتج) ─────────
select a.created_at, a.action, a.entity_type, a.entity_id, a.detail,
       (select p.full_name from public.profiles p where p.id = a.actor_id) as actor_name
from public.mgmt_audit a order by a.created_at desc;

-- ════════════════════════════════════════════════════════════════════════════
-- (أ) تعطيل آمن — بلا فقدان بيانات. هذا هو التراجع الموصى به.
--     تُسحب المنح فتفشل كلّ استدعاءات الواجهة بـ42501 (منع صريح)، وتبقى
--     الجداول والدوالّ والأثر الرقابيّ كما هي، والعودة = إعادة المنح فقط.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $a$
declare f text;
begin
  foreach f in array array[
    'public.mgmt_access()', 'public.mgmt_sources()',
    'public.mgmt_dashboard(jsonb,boolean)', 'public.mgmt_refresh(jsonb)',
    'public.mgmt_export(text,jsonb)', 'public.mgmt_audit_list(int)'
  ] loop
    if to_regprocedure(f) is not null then
      begin execute format('revoke all on function %s from authenticated', f);
      exception when undefined_object then null; end;
    end if;
  end loop;

  -- الجداول: سحب القراءة أيضًا (RLS كانت تحجب أصلًا، وهذا حزام ثانٍ).
  begin execute 'revoke all on table public.mgmt_report_cache from authenticated'; exception when undefined_table then null; end;
  begin execute 'revoke all on table public.mgmt_audit from authenticated';        exception when undefined_table then null; end;
end $a$;

commit;
notify pgrst, 'reload schema';

-- للعودة من المرحلة (أ): أعِد تشغيل executive_reporting_RUNME.sql كاملًا
-- (idempotent، ولا يمسّ بياناتك) — سيعيد المنح كما كانت.

-- ════════════════════════════════════════════════════════════════════════════
-- (ب) حذف كامل — ★ يُفقِد سجلّ التدقيق mgmt_audit نهائيًّا ★
--     لا تُشغّل هذا القسم إلّا بعد حفظ ناتج استعلام النسخة الاحتياطية أعلاه.
--     أزل التعليق سطرًا سطرًا بوعي؛ لم يُترك جاهزًا للّصق عمدًا.
-- ════════════════════════════════════════════════════════════════════════════

-- begin;
--
-- drop policy if exists mgmt_report_cache_sel on public.mgmt_report_cache;
-- drop policy if exists mgmt_audit_sel        on public.mgmt_audit;
--
-- drop function if exists public.mgmt_audit_list(int);
-- drop function if exists public.mgmt_export(text,jsonb);
-- drop function if exists public.mgmt_refresh(jsonb);
-- drop function if exists public.mgmt_dashboard(jsonb,boolean);
-- drop function if exists public.mgmt_sources();
-- drop function if exists public.mgmt_access();
-- drop function if exists public.mgmt_alerts_from(jsonb,boolean);
-- drop function if exists public.mgmt_compute(jsonb);
-- drop function if exists public.mgmt_cache_key(jsonb,boolean);
-- drop function if exists public.mgmt_norm_filters(jsonb);
-- drop function if exists public.mgmt_read_calendar(date,date);
-- drop function if exists public.mgmt_read_jsonb(text,text,jsonb,text,text);
-- drop function if exists public.mgmt_source_installed(text);
-- drop function if exists public.mgmt_classify(text,text);
-- drop function if exists public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb);
-- drop function if exists public.mgmt_env(text,text,text,text,jsonb);
-- drop function if exists public.mgmt_departments();
-- drop function if exists public.mgmt_log(text,text,text,jsonb);
-- drop function if exists public.mgmt_can_export();
-- drop function if exists public.mgmt_can_view_sensitive();
-- drop function if exists public.mgmt_can_view();
-- drop function if exists public.mgmt_is_client();
-- drop function if exists public.mgmt_perm(text);
--
-- -- ★ هنا يختفي الأثر الرقابيّ ★
-- drop table if exists public.mgmt_report_cache;
-- drop table if exists public.mgmt_audit;
--
-- -- مفاتيح الصلاحيات — حذفها يسحبها ممّن مُنحت له.
-- delete from public.permissions where key like 'exec\_report.%';
--
-- commit;
-- notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد أيّ مرحلة: أزل تبويب «اللوحة التنفيذية» من components/portal/nav.ts
-- (وإلّا ظهر رابط يفتح شاشة منع). الواجهة لا تنهار: كلّ سطح فيها يكتشف غياب
-- الدوالّ ويعرض «الميزة بانتظار تفعيل قاعدة البيانات» بدل أن يتعطّل.
-- ════════════════════════════════════════════════════════════════════════════
