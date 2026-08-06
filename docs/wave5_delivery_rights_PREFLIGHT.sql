-- WAVE 5 · delivery_rights · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('deliverables'),('deliverable_versions'),('project_deliverable_versions'),
             ('project_member_roles'),('projects'),('project_delivery_release')) v(n);

select 'GATE' as kind, v.n as name,
       case when to_regprocedure(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('can_manage_projects','public.can_manage_projects()')) v(n,sig);

-- 🔴 قبل تركيب حارس النهائيّ الواحد: هل توجد مخالفات قائمة تمنع الفهرس الفريد؟
select 'PRE_EXISTING_CONFLICT' as kind, deliverable_id::text as name,
       '🔴 أكثر من نسخة نهائية — الفهرس الفريد سيفشل. صحّحها أوّلًا' as status
from public.deliverable_versions
where is_final = true and coalesce(is_deleted,false) = false
group by deliverable_id having count(*) > 1;

-- ⛔ لا نظام موازٍ.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام موازٍ — توقّف' end as status
from (values ('deliverable_rights'),('showreel_items'),('share_links'),('deemed_approvals')) v(n);
