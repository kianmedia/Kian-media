-- ════════════════════════════════════════════════════════════════════════════
-- live_operations_dashboard_PREFLIGHT.sql            (READ-ONLY — لا يكتب شيئًا)
--
-- يُنفَّذ قبل live_operations_dashboard_RUNME.sql. كلّ استعلام هنا SELECT صِرف،
-- والقسم الأخير كتلة DO **ترفع استثناءً** — لا تكتب صفًّا واحدًا، لكنّها توقف
-- التشغيل بدل ترك نصف ترحيلة.
--
-- ─── لماذا PREFLIGHT هنا أخفّ من حزم أخرى، ولماذا هو مع ذلك إلزاميّ ────────
-- هذه الوحدة **لا توسّع جدولًا قائمًا ولا تعدّل سطرًا في وحدة أخرى**: كلّ
-- جداولها جديدة بادئتها liveops_. لذلك لا يوجد «صفّ مخالف» ينبغي إصلاحه يدويًّا.
-- لكنّها تبني بوّاباتها فوق is_owner/is_admin/is_staff، وتشترط sha256 لبصمة
-- الرمز. غياب أيّ من هذه لا يُنتج ميزة معطّلة بل **بوّابة تُقيَّم إلى NULL**،
-- وهي أخطر من بوّابة غائبة لأنّها تبدو موجودة.
--
-- القراءة: كلّ صفّ present/exists_now = true ⇒ امضِ. أيّ false ⇒ لا تُشغّل RUNME.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── ١) الاعتمادات الإلزامية — الجداول ─────────────────────────────────────
-- متوقّع: present = true في كلّ صفّ.
select t.name, (to_regclass(t.name) is not null) as present
from (values ('public.profiles'), ('auth.users')) t(name);

-- ─── ٢) الاعتمادات الإلزامية — الدوالّ ─────────────────────────────────────
-- متوقّع: exists_now = true في كلّ صفّ.
-- ⚠️ pg_catalog.sha256(bytea) هو ما يجعل تخزين **بصمة** الرمز ممكنًا. غيابه
--    يعني أنّ الرمز الخامّ سيُخزَّن يومًا، وهذا بالضبط ما تمنعه الوحدة.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_owner()'),
             ('public.is_admin()'),
             ('public.is_staff()'),
             ('pg_catalog.sha256(bytea)'),
             ('pg_catalog.gen_random_uuid()')) f(sig);

-- ─── ٣) ★ أنواع الإرجاع — بوّابة تعيد غير boolean تُنتج «غير محدَّد» لا «منع» ─
-- متوقّع: is_boolean = true في الصفوف الثلاثة.
-- هذا هو الفحص الذي يمنع تكرار حادثة انهيار NULL في بوّابات SECURITY DEFINER.
select r.sig,
       coalesce((select p.prorettype = 'boolean'::regtype from pg_proc p
                  where p.oid = to_regprocedure(r.sig)), false) as is_boolean
from (values ('public.is_owner()'), ('public.is_admin()'), ('public.is_staff()')) r(sig);

-- ─── ٤) الاعتمادات الاختيارية — تُكتشَف وقت التشغيل ولا توقف شيئًا ────────
-- متوقّع: أيّ قيمة. false يعني أنّ الميزة المرتبطة تبقى صامتة، لا معطوبة:
--   permissions          غائب ⇒ لا تُبذَر مفاتيح live_ops.* والبوّابات تعتمد
--                        على المالك/الأدمن وحدهما (fail closed).
--   emp_has_permission   غائب ⇒ liveops_perm يعيد false دائمًا.
--   notify               غائب ⇒ liveops_notify يسجّل notify_unavailable ويمضي.
--   ops_jobs / projects  غائب ⇒ الربط الاختياريّ يُرفَض بـ«غير موجود» بدل ربط وهميّ.
select o.name, (coalesce(to_regclass(o.name)::text, to_regprocedure(o.name)::text) is not null) as present
from (values ('public.permissions'),
             ('public.emp_has_permission(uuid,text)'),
             ('public.notify(uuid,text,text,text,uuid,text,text)'),
             ('public.ops_jobs'),
             ('public.projects')) o(name);

-- ─── ٥) ★★ تضارب الأسماء: كائن liveops_* قائم من قبل ★★ ───────────────────
-- متوقّع: existing_objects = 0 في تشغيل أوّل.
-- أيّ رقم أكبر من صفر على تشغيل أوّل ⇒ توقّف واقرأ الاستعلام التالي: قد يكون
-- هناك نظام آخر بالاسم نفسه، والاستبدال سيخلط سجلَّين تشغيليَّين.
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname like 'liveops\_%' and c.relkind in ('r','v','m'))
       as existing_tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'liveops\_%')
       as existing_functions;

select c.relname as object_name, c.relkind as kind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'liveops\_%'
 order by 1;

-- ─── ٦) ★ 42P13: دالّة liveops_* قائمة بنوع إرجاع مختلف ────────────────────
-- متوقّع: لا صفوف. أيّ صفّ هنا سيُفشل §0 في RUNME — احذف الدالّة أوّلًا.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as current_result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'liveops\_%'
 order by 1;

-- ─── ٧) الوحدات المجمَّدة/المكتملة — نتحقّق أنّنا لن نلمسها ────────────────
-- متوقّع: توثيقيّ. الوحدة **لا تنشئ مفتاحًا أجنبيًّا** نحو أيّ من هذه، ولا
-- تعدّلها. يُقرأ project_id و prodops_job_id كمعرّف نصّيّ فقط.
select t.name, (to_regclass(t.name) is not null) as present,
       'read-only reference only — no FK, no write' as contract
from (values ('public.projects'), ('public.project_core'), ('public.deliverables'),
             ('public.ops_jobs')) t(name);

-- ─── ٨) الحارس الصارم — يرفع استثناء ولا يكتب ─────────────────────────────
do $pre$
declare v_missing text := '';
begin
  if to_regclass('public.profiles') is null then v_missing := v_missing || ' profiles'; end if;
  if to_regprocedure('public.is_owner()') is null then v_missing := v_missing || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then v_missing := v_missing || ' is_admin()'; end if;
  if to_regprocedure('public.is_staff()') is null then v_missing := v_missing || ' is_staff()'; end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then v_missing := v_missing || ' sha256(bytea)'; end if;
  if v_missing <> '' then
    raise exception 'LIVEOPS PREFLIGHT: اعتمادات غائبة ⇒ لا تُشغّل RUNME:%', v_missing;
  end if;

  -- بوّابة تعيد غير boolean = بوّابة تُقيَّم إلى NULL في تركيب منطقيّ.
  if (select p.prorettype from pg_proc p where p.oid = to_regprocedure('public.is_staff()')) <> 'boolean'::regtype then
    raise exception 'LIVEOPS PREFLIGHT: is_staff() لا تعيد boolean — كلّ بوّابات الوحدة ستُبنى على قيمة غير محدَّدة';
  end if;

  raise notice 'LIVEOPS PREFLIGHT: الاعتمادات مكتملة. امضِ إلى RUNME.';
end $pre$;
