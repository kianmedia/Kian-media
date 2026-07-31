-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_RUNME.sql                — RUN ONCE (ويُعاد تشغيله بأمان)
-- المالية والربحية · Finance & Profitability Foundation — Phase 4
--
-- ─── ما هذه الحزمة ──────────────────────────────────────────────────────────
-- موديول ماليّ **مستقلّ**: مراكز التكلفة · الميزانيات · بنود المصروف · طلبات
-- الصرف واعتمادها · المورّدون · طلبات الشراء وأوامر الشراء · تكاليف الطاقم
-- والمستقلّين والسفر وتأجير المعدّات ومشتريات الإنتاج · التكلفة الفعلية
-- والملتزَم بها · انحراف الميزانية · مرجع الإيراد · مجمل الربح وصافي الربح
-- التقديريّ · الذمم المدينة وحالة التحصيل ودفعات العقد والمتأخّرات · الاشتراكات
-- الشهرية · رصيد العقد المتبقّي · الضريبة كحقل مستقلّ · المرفقات · حدود
-- الاعتماد · التدقيق · لوحة · تصدير.
--
-- ─── علاقته بمنصّة المشاريع: قراءة اسم فقط، والربط اختياريّ ────────────────
-- كلّ جدول هنا يحمل project_id **اختياريًّا** (on delete set null) يُستعمل للتجميع
-- ولعرض اسم المشروع لا غير. لا دالّة ولا سياسة ولا trigger في هذه الحزمة تكتب في
-- projects أو project_core أو deliverables أو deliverable_internal أو
-- project_transition_requests أو أيّ كائن project_* / large_project_*.
-- ولا تقرأ هذه الحزمة جداول ماليات المنصّة (project_costs · project_expenses ·
-- project_phase_budgets · project_revenue_schedule · project_finance_settings):
-- المنصّة مجمَّدة، والاعتماد على أعمدتها كان سيربط موديولًا حيًّا بسطح مُقفَل.
--
-- ─── ما أُعيد استعماله بدل تكراره (تركيب لا نظام موازٍ) ────────────────────
--   • public.is_staff() / is_owner() / is_admin() / staff_role() — الهويّة القائمة.
--   • public.emp_has_permission(uuid,text) — كتالوج الصلاحيات القائم
--     (permission_catalog_RUNME.sql). تُضاف مفاتيح finance_ops.* إلى **نفس**
--     الكتالوج ولا يُبنى محرّك ثانٍ. الجسر مكتشَف: غياب المحرّك = منع (fail-closed).
--   • public.custody_purchase_requests — طلب شراء العهدة يبقى مصدر الحقيقة هناك؛
--     هنا **مرجع** رخو (custody_purchase_request_id) بلا نسخة وبلا تعديل.
--   • public.invoices / quotes — فواتير Zoho المعروضة للعميل تبقى كما هي؛ الذمم
--     هنا داخلية ولا تُعرَض لعميل أبدًا، وتشير إلى Zoho بمرجع نصّيّ فقط.
--   • public.prodops_* (Phase 2) — التشغيل يبقى تشغيلًا؛ التكلفة تُسجَّل هنا
--     بمرجع رخو (source_kind='rental'/'custody') ولا يُكرَّر أمر العمل.
-- لم يُنشأ: كتالوج صلاحيات ثانٍ · جدول مورّدين ثانٍ للعهدة · نسخة من الفواتير ·
-- أيّ لمسة على ماليات المنصّة.
--
-- ─── الصلاحيات: هذا أخطر موديول في البرنامج ────────────────────────────────
--   ★ قاعدة V1 الحاكمة: لا يُمنح دورٌ واحد جدولين يمكن طرح أحدهما من الآخر
--     لاستنتاج الربحية. القسمة أدناه مشتقّة من هذه القاعدة لا من الشاشات.
--   المالك (is_owner)        → كلّ شيء: التكاليف · الملتزَم به · الميزانيات ·
--                              مجمل الربح · صافي الربح التقديريّ · الهوامش ·
--                              تكاليف الطاقم والمستقلّين · أسعار المورّدين ·
--                              مشتريات الإنتاج · الذمم · التصدير الشامل.
--   موظّف التحصيل المصرَّح     → العميل · رقم/مرجع الفاتورة · المستحقّ · تاريخ
--                              الاستحقاق · المحصَّل · المتبقّي · الحالة ·
--                              ملاحظات التحصيل. **ولا شيء غير ذلك**، وعبر
--                              finops_collections_list وحدها: لا وصول جدوليّ.
--   المعتمِد                  → الطلب الذي يقرّر فيه لا غير.
--   الموظّف العاديّ           → **طلب الصرف الخاصّ به وحده**: يرفعه ويرى حالته.
--   العميل / الزائر           → **لا شيء إطلاقًا**. لا قراءة ولا كتابة ولا وجود.
--   الافتراض العمليّ: الواجهة ستُتجاوَز، وPostgREST سيُستدعى مباشرةً. المنع
--   هنا في القاعدة وحدها، وإخفاء تبويب ليس تفويضًا.
--
-- ─── قواعد ملزمة ──────────────────────────────────────────────────────────
--   • كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL أبدًا (حادثة fail-open سابقة).
--   • لا سياسة كتابة مباشرة على أيّ جدول: كلّ كتابة عبر SECURITY DEFINER RPC.
--   • لا صلاحية anon على أيّ دالّة أو جدول، ولا service_role في المتصفّح.
--   • كلّ كتابة حسّاسة مُدقَّقة في fin_audit.
--   • ★ الضريبة حقل مستقلّ (vat_amount) ولا تُطوى في مجموع. الإجمالي
--     amount_gross عمود **مولَّد** = amount_net + vat_amount، فلا يمكن أن يُكتب
--     إجماليّ يُخفي الضريبة داخله.
--   • حالة التحصيل والمتأخّر والمتبقّي **مشتقّة** لا محفوظة (لا انحراف صامت).
--   • Zoho Books: لا مزامنة حيّة، ولا بيانات اعتماد، ولا ادّعاء «متّصل».
--     جدول الصادر fin_zoho_outbox لا يملك أصلًا حالة اسمها sent.
--   • Additive · Idempotent · Transaction · بلا DROP لبيانات.
--
-- ─── ملاحظة تشغيلية: الـSELF-TEST ثابت ─────────────────────────────────────
-- محرّر SQL في Supabase يعمل بدور postgres وauth.uid() = NULL. أيّ استدعاء حيّ
-- لدالّة محميّة هنا يرفع "not authorized" ويُسقط الترحيلة كلّها (كلّفنا دورتين).
-- لذلك الفحص بـpg_get_functiondef + ilike (المُفكِّك يرفع حالة COALESCE)، ولا
-- فحص ملفوف بمصيدة تجعله ينجح مهما حدث: اختبار لا يمكن أن يفشل ليس اختبارًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── §0) PREFLIGHT صلب — الاعتمادات التي لا تُحاكى ─────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regclass('public.profiles')       is null then miss := miss || ' profiles'; end if;
  if to_regprocedure('public.is_staff()') is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.is_owner()') is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.staff_role()') is null then miss := miss || ' staff_role()'; end if;
  if miss <> '' then
    raise exception 'FIN PREFLIGHT: اعتمادات ناقصة —%. شغّل phase0_migration.sql وstaff_roles_task_assignment_RUNME.sql أوّلًا.', miss;
  end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then
    raise notice 'FIN: محرّك الصلاحيات غير مطبَّق — سيعمل المالك/الأدمن ودور المالية فقط حتى تُشغّل permission_catalog_RUNME.sql.';
  end if;
  if to_regclass('public.projects') is null then
    raise notice 'FIN: جدول projects غير موجود — الربط بالمشروع سيبقى معطّلًا (اختياريّ أصلًا).';
  end if;
  if to_regclass('public.custody_purchase_requests') is null then
    raise notice 'FIN: موديول شراء العهدة غير مطبَّق — حقل المرجع سيبقى فارغًا ولا يُدّعى تكامل.';
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) مفاتيح الصلاحيات — تُضاف إلى الكتالوج القائم، ولا يُبنى كتالوج ثانٍ.
--     البادئة finance_ops.* عمدًا: مفاتيح finance.* القائمة تخصّ ماليات منصّة
--     المشاريع المجمَّدة، وإعادة تعريف معناها كانت ستغيّر سلوك سطح مُقفَل.
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice 'FIN §1: جدول permissions غير موجود — تخطّي بذر المفاتيح.';
    return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en)
  select v.key, 'finance', v.sens, v.ord, v.ar, v.en
  from (values
    -- ★ مفاتيح V1 القابلة للمنح فعلًا — وهي وحدها التي تفتح شيئًا ★
    (1300,'finance_ops.collections_view',   'sensitive','عرض قائمة التحصيل (بلا تكاليف ولا ربحية)', 'View collections queue (no costs, no profit)'),
    (1310,'finance_ops.collections_record', 'sensitive','تسجيل تحصيل ومتابعة سداد',      'Record a collection payment'),
    (1320,'finance_ops.export_collections', 'sensitive','تصدير قائمة التحصيل وحدها',     'Export the collections queue only'),
    (1330,'finance_ops.approve',            'sensitive','اعتماد طلبات الصرف والشراء',    'Approve expense & purchase requests'),
    (1340,'finance_ops.request',            'normal',   'رفع طلب صرف شخصيّ',             'Submit own expense request'),
    -- ★ مفاتيح مُعطَّلة عمدًا في V1 — منحُها لا يفتح شيئًا، والاسم يقول ذلك ★
    --   السبب في §2: المالية الحسّاسة للمالك وحده، ولا مفتاح يتجاوز ذلك.
    (1390,'finance_ops.view',               'sensitive','[معطَّل في V1 — للمالك وحده] عرض المركز المالي',   '[Disabled in V1 — owner only] View finance centre'),
    (1391,'finance_ops.manage',             'sensitive','[معطَّل في V1 — للمالك وحده] إدارة البيانات المالية','[Disabled in V1 — owner only] Manage finance data'),
    (1392,'finance_ops.view_profit',        'sensitive','[معطَّل في V1 — للمالك وحده] عرض الربحية والهوامش',  '[Disabled in V1 — owner only] View profitability'),
    (1393,'finance_ops.manage_receivables', 'sensitive','[معطَّل في V1 — للمالك وحده] إدارة الذمم',          '[Disabled in V1 — owner only] Manage receivables'),
    (1394,'finance_ops.export',             'sensitive','[معطَّل في V1 — للمالك وحده] التصدير المالي الشامل','[Disabled in V1 — owner only] Comprehensive export')
  ) as v(ord, key, sens, ar, en)
  on conflict (key) do update set
    category = excluded.category, sensitivity = excluded.sensitivity,
    label_ar = excluded.label_ar, label_en = excluded.label_en, sort_order = excluded.sort_order;
end $perm$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) المُسنَدات — خاصّة بالموديول. لا واحد منها يعيد NULL.
--     ⚠️ لا تُبنى على can_manage_projects: مدير المشاريع ليس مديرًا ماليًّا.
--
-- ★★ نموذج V1: «المالية الحسّاسة للمالك وحده» ★★
-- المبدأ الحاكم — وهو أهمّ سطر في هذا الملفّ:
--   **لا يُمنح دورٌ واحد جدولين يمكن طرح أحدهما من الآخر لاستنتاج الربحية.**
-- الثغرة المُثبَتة في النسخة السابقة: حاملُ finance_ops.view كان يقرأ
-- fin_receivables.amount_net (إيراد مفوتَر) ويقرأ fin_costs، فيطرح ويحصل على
-- هامش تقريبيّ بلا مفتاح الربحية. البوّابة التي بُنيت لحماية الهامش كانت
-- تُلتَفّ من حولها بجمعٍ بسيط. عولجت بإعادة اشتقاق القسمة من المبدأ لا برقعة:
--
--   المالك (is_owner) وحده يرى: التكاليف · الملتزَم به · الميزانيات · مجمل
--   الربح · صافي الربح التقديريّ · الربحية والهوامش · تكاليف الموظّفين
--   والمستقلّين · أسعار المورّدين · مشتريات الإنتاج · الذمم بكامل حقولها ·
--   التصدير المالي الشامل.
--
--   موظّف التحصيل المصرَّح له يرى **فقط**: العميل · رقم/مرجع الفاتورة · المبلغ
--   المستحقّ · تاريخ الاستحقاق · ما حُصِّل · المتبقّي · حالة التحصيل · ملاحظات
--   التحصيل. ولا يرى: fin_costs ولا الربح ولا الهامش ولا أسعار المورّدين ولا
--   تكاليف الطاقم ولا الميزانيات ولا اللوحة المالية الكاملة.
--
-- وسيلة التنفيذ: موظّف التحصيل **لا يملك وصولًا جدوليًّا أصلًا** — لا سطر واحد
-- من fin_receivables يصله عبر RLS. ما يصله يمرّ بدالّة مبنيّة لغرضه
-- (finops_collections_list) تُعيد قائمة أعمدة بيضاء مكتوبة حرفيًّا. فحتى لو
-- استُدعيت PostgREST مباشرةً على أيّ جدول ماليّ، النتيجة صفر صفوف.
-- ⚠️ ولا يُمنح finance_ops.collections_view وfinance_ops.approve لشخص واحد إن
--    أردت الفصل تامًّا: قائمة الاعتماد تحمل مبالغ مصروف (تكلفة). القاعدة تسمح
--    بالجمع لأنّ الاعتماد يستحيل بلا رؤية المبلغ، والمصفوفة تنصّ على الفصل.
-- ════════════════════════════════════════════════════════════════════════════

-- جسر مكتشَف إلى محرّك الصلاحيات. غيابه = false (fail-closed) لا استثناء.
-- المصيدة هنا تُفشِل ولا تُنجِح — وهذا هو الفرق بينها وبين المصيدة الكاذبة.
create or replace function public.finops_perm(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if auth.uid() is null or p_key is null then return false; end if;
  if to_regprocedure('public.emp_has_permission(uuid,text)') is null then return false; end if;
  execute 'select coalesce(public.emp_has_permission($1,$2), false)' into v using auth.uid(), p_key;
  return coalesce(v, false);
exception when others then
  return false;                                        -- fail-closed، لا fail-open
end $$;

-- دور المالية المُعلَن في الملفّ الشخصيّ. يبقى معرَّفًا للتوافق **ولا يُستعمل
-- في أيّ بوّابة**: قيد CHECK على profiles.staff_role لا يسمح بالقيمة 'finance'
-- أصلًا (super_admin·manager·support·editor·sales·hr·readonly)، فبناء صلاحية
-- عليه كان بوّابةً ميتة تُقرأ كأنّها حيّة. البوّابات أدناه تقول is_owner صراحةً.
create or replace function public.finops_is_finance_role() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and coalesce(public.staff_role(), '') = 'finance', false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ (١) البوّابة الحسّاسة — المالك وحده. لا مفتاح، ولا دور، ولا استثناء.      ★
--   is_owner() = account_type='admin' (الحسابان المحميّان) أو staff_role='super_admin'.
--   لاحظ ما ليس هنا: لا finops_perm ولا staff_role. غيابهما **مقصود** ومُختبَر
--   ثابتًا في §9: أيّ مفتاح يُمنح لاحقًا لا يستطيع فتح هذه البوّابة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_can_view_finance_sensitive() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and coalesce(public.is_owner(), false),
  false);
$$;

-- الكتابة في البيانات الحسّاسة (تكاليف · ميزانيات · عقود · إيراد · اشتراكات ·
-- ذمم · أوامر شراء · مراكز تكلفة · بنود · حدود اعتماد · Zoho): المالك وحده.
create or replace function public.finops_can_manage_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.finops_can_view_finance_sensitive(), false),
  false);
$$;

-- المورّدون: الاسم والسعر الافتراضيّ وبيانات السداد في جدول واحد، وسعر المورّد
-- تكلفةٌ صريحة. لذلك إدارتهم داخل البوّابة الحسّاسة ولا تُمنح بمفتاح في V1.
create or replace function public.finops_can_manage_suppliers() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.finops_can_view_finance_sensitive(), false),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ (٢) بوّابتا التحصيل — قابلتان للمنح، ولا تلمسان تكلفةً واحدة.            ★
--   ما تفتحانه: finops_collections_list / _summary / _export فقط. لا وصول
--   جدوليّ: RLS لا تمنح موظّف التحصيل صفًّا واحدًا من أيّ جدول ماليّ.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_can_view_collections() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and (coalesce(public.finops_can_view_finance_sensitive(), false)
      or coalesce(public.finops_perm('finance_ops.collections_view'), false)),
  false);
$$;

create or replace function public.finops_can_record_collection() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and (coalesce(public.finops_can_view_finance_sensitive(), false)
      or coalesce(public.finops_perm('finance_ops.collections_record'), false)),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ (٣) اعتماد المصروف — مفتاح مستقلّ. المعتمِد يرى مبلغ الطلب الذي يعتمده،
--   ولا يرى سجلّ التكاليف ولا الميزانيات ولا الذمم: لا يجتمع لديه طرفا الطرح.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_can_approve_expense() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.is_staff(), false)
    and (coalesce(public.finops_can_view_finance_sensitive(), false)
      or coalesce(public.finops_perm('finance_ops.approve'), false)),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ (٤) التصدير مقسوم: شامل للمالك، وقائمة تحصيل وحدها لمن يُمنح مفتاحها.   ★
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_can_export_sensitive() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.finops_can_view_finance_sensitive(), false),
  false);
$$;

create or replace function public.finops_can_export_collections() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.uid() is not null)
    and coalesce(public.finops_can_view_collections(), false)
    and (coalesce(public.finops_can_view_finance_sensitive(), false)
      or coalesce(public.finops_perm('finance_ops.export_collections'), false)),
  false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ (٥) أسماء متوارثة — تُبقى للتوافق وتُعاد تعريفها على المعنى الأضيق.      ★
--   كانت هذه الأسماء تحمل المعنى الواسع الذي أنتج الثغرة. لم تُحذف لأنّ حزمًا
--   أخرى تشير إليها (executive_reporting)، لكنّها الآن **مرادفات** لا تفتح
--   أكثر ممّا يفتحه النموذج الجديد. لا تكتب بوّابةً جديدة عليها: استعمل
--   الأسماء الصريحة أعلاه.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_can_view() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_view_finance_sensitive(), false);
$$;

create or replace function public.finops_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_manage_finance(), false);
$$;

create or replace function public.finops_can_approve() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_approve_expense(), false);
$$;

create or replace function public.finops_can_view_profit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_view_finance_sensitive(), false);
$$;

-- ★ تحوّل جوهريّ: إنشاء ذمّة/دفعة عقد = كتابة إيراد مفوتَر ⇒ حسّاس (المالك).
--   تسجيل تحصيل ⇒ finops_can_record_collection. لم يعودا مفتاحًا واحدًا.
create or replace function public.finops_can_manage_receivables() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_manage_finance(), false);
$$;

create or replace function public.finops_can_export() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.finops_can_export_sensitive(), false);
$$;

-- الموظّف: يرفع طلب صرفه هو ويرى حالته. لا شيء غير ذلك.
create or replace function public.finops_can_request() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and coalesce(public.is_staff(), false), false);
$$;

-- تصريح صريح بأنّ صاحب الجلسة عميل/زائر — يُستعمل في الرسائل والاختبارات.
create or replace function public.finops_is_client() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((auth.uid() is not null) and not coalesce(public.is_staff(), false), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) الجداول — 22 جدولًا، كلّها fin_*.
--
--     ★ شكل المال الموحَّد في كلّ جدول ماليّ ★
--        amount_net    المبلغ قبل الضريبة
--        vat_rate      النسبة (٪) — محفوظة كي يبقى الحساب قابلًا للتفسير لاحقًا
--        vat_amount    ★ الضريبة نفسها، حقل مستقلّ لا يُطوى في مجموع ★
--        amount_gross  عمود **مولَّد** = amount_net + vat_amount
--     لأنّ الإجمالي مولَّد فلا سبيل لكتابة إجماليّ يُخفي الضريبة داخله: القاعدة
--     ترفض الكتابة على عمود مولَّد. هذا قيدٌ بنيويّ لا اتّفاق شفويّ.
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.fin_doc_seq;

-- 3.1 مراكز التكلفة
create table if not exists public.fin_cost_centers (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (length(btrim(code)) between 2 and 40),
  name_ar      text not null check (length(btrim(name_ar)) between 2 and 200),
  name_en      text,
  kind         text not null default 'department'
               check (kind in ('company','department','program','project','client','other')),
  parent_id    uuid references public.fin_cost_centers(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  notes        text,
  is_active    boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
comment on table public.fin_cost_centers is 'مراكز التكلفة. مستقلّة تمامًا عن هيكل المشاريع المجمَّد؛ الربط بمشروع اختياريّ وعلى مستوى الصفّ المالي لا هنا.';
create index if not exists ix_fin_cc_live on public.fin_cost_centers(is_active) where is_deleted = false;

-- 3.2 بنود المصروف
create table if not exists public.fin_expense_categories (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  name_ar          text not null check (length(btrim(name_ar)) between 2 and 200),
  name_en          text,
  cost_nature      text not null default 'other'
                   check (cost_nature in ('crew','freelancer','travel','equipment_rental',
                                          'production_purchase','logistics','software','other')),
  is_capex         boolean not null default false,
  default_vat_rate numeric(6,3) not null default 15 check (default_vat_rate >= 0 and default_vat_rate <= 100),
  sort_order       int not null default 100,
  is_active        boolean not null default true,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false
);
create index if not exists ix_fin_cat_live on public.fin_expense_categories(sort_order) where is_deleted = false;

-- 3.3 المورّدون
-- ⚠️ لا يُخزَّن رقم حساب بنكيّ كاملًا هنا. المرجع البنكيّ نصّ تعريفيّ فقط
--    (اسم البنك/آخر أربعة)، فتسريب هذا الجدول لا يسلّم بيانات دفع قابلة للاستعمال.
create table if not exists public.fin_suppliers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null check (length(btrim(name)) between 2 and 200),
  legal_name    text,
  supplier_type text not null default 'company'
                check (supplier_type in ('company','freelancer','individual','government','other')),
  vat_number    text, cr_number text,
  contact_name  text, phone text, email text, city text, country text default 'SA',
  payment_terms_days int not null default 0 check (payment_terms_days >= 0 and payment_terms_days <= 365),
  bank_ref      text,
  rating        int check (rating is null or rating between 1 and 5),
  notes         text,
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);
comment on column public.fin_suppliers.bank_ref is
  'مرجع بنكيّ تعريفيّ فقط (اسم البنك/آخر أربعة). ممنوع تخزين IBAN كاملًا أو رقم حساب كامل.';
create index if not exists ix_fin_sup_live on public.fin_suppliers(is_active) where is_deleted = false;

-- 3.4 الميزانيات + بنودها
create table if not exists public.fin_budgets (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  title          text not null check (length(btrim(title)) between 2 and 300),
  scope          text not null default 'cost_center'
                 check (scope in ('company','cost_center','project','program')),
  fiscal_year    int check (fiscal_year is null or fiscal_year between 2000 and 2100),
  period_start   date, period_end date,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  project_id     uuid,                       -- ★ اختياريّ · للتجميع والعرض فقط ★
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  status         text not null default 'draft' check (status in ('draft','active','locked','closed')),
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  constraint fin_budget_period check (period_end is null or period_start is null or period_end >= period_start)
);
comment on column public.fin_budgets.project_id is
  'رابط اختياريّ بمشروع للتجميع والعرض. المنصّة مجمَّدة: لا كتابة فيها ولا اعتماد عليها في أيّ حارس.';
create index if not exists ix_fin_budget_live    on public.fin_budgets(status) where is_deleted = false;
create index if not exists ix_fin_budget_project on public.fin_budgets(project_id) where project_id is not null and is_deleted = false;

create table if not exists public.fin_budget_lines (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.fin_budgets(id) on delete cascade,
  category_id    uuid references public.fin_expense_categories(id) on delete set null,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  label          text not null check (length(btrim(label)) between 2 and 200),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_fin_bline_budget on public.fin_budget_lines(budget_id) where is_deleted = false;
create unique index if not exists uq_fin_bline on public.fin_budget_lines(budget_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(label))) where is_deleted = false;

-- 3.5 العقود — أساس «رصيد العقد المتبقّي» (المتبقّي مشتقّ لا محفوظ)
create table if not exists public.fin_contracts (
  id            uuid primary key default gen_random_uuid(),
  contract_no   text not null unique,
  title         text not null check (length(btrim(title)) between 2 and 300),
  client_label  text,                         -- نصّ حرّ؛ لا حساب عميل يُكشف هنا
  client_id     uuid,                         -- مرجع رخو إلى profiles (بلا FK: إضافيّة)
  project_id    uuid,                         -- ★ اختياريّ · للتجميع والعرض فقط ★
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  signed_on     date, start_date date, end_date date,
  currency      text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net    numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross  numeric(14,2) generated always as (amount_net + vat_amount) stored,
  is_retainer   boolean not null default false,
  status        text not null default 'draft' check (status in ('draft','active','completed','cancelled')),
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint fin_contract_period check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists ix_fin_contract_live    on public.fin_contracts(status) where is_deleted = false;
create index if not exists ix_fin_contract_project on public.fin_contracts(project_id) where project_id is not null and is_deleted = false;

-- 3.6 مرجع الإيراد — مرجعيّ لا محاسبيّ. الفاتورة الرسمية تبقى في Zoho Books.
create table if not exists public.fin_revenue (
  id            uuid primary key default gen_random_uuid(),
  revenue_no    text not null unique,
  revenue_type  text not null default 'contract'
                check (revenue_type in ('contract','retainer','change_order','other')),
  contract_id   uuid references public.fin_contracts(id) on delete set null,
  project_id    uuid,                         -- ★ اختياريّ · للتجميع والعرض فقط ★
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  client_label  text,
  title         text not null check (length(btrim(title)) between 2 and 300),
  recognized_on date not null default current_date,
  currency      text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net    numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross  numeric(14,2) generated always as (amount_net + vat_amount) stored,
  source        text not null default 'manual' check (source in ('manual','zoho_books_reference')),
  zoho_reference text,
  status        text not null default 'expected' check (status in ('expected','confirmed','cancelled')),
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);
comment on table public.fin_revenue is
  'مرجع إيراد داخليّ للربحية. ليس دفترًا محاسبيًّا ولا يُصدِر فاتورة: الفاتورة الرسمية في Zoho Books، وهنا مرجع نصّيّ فقط.';
create index if not exists ix_fin_rev_live    on public.fin_revenue(recognized_on) where is_deleted = false;
create index if not exists ix_fin_rev_project on public.fin_revenue(project_id) where project_id is not null and is_deleted = false;

-- 3.7 الاشتراكات الشهرية
create table if not exists public.fin_retainers (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid references public.fin_contracts(id) on delete set null,
  title         text not null check (length(btrim(title)) between 2 and 300),
  client_label  text,
  project_id    uuid,                         -- ★ اختياريّ · للتجميع والعرض فقط ★
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  currency      text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net    numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross  numeric(14,2) generated always as (amount_net + vat_amount) stored,
  start_month   date not null,
  end_month     date,
  billing_day   int not null default 1 check (billing_day between 1 and 28),
  status        text not null default 'active' check (status in ('active','paused','ended')),
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint fin_retainer_period check (end_month is null or end_month >= start_month)
);
comment on column public.fin_retainers.billing_day is
  'يوم الفوترة الشهريّ. حدّ ٢٨ عمدًا: أيّ يوم أكبر يسقط في فبراير ويولّد استحقاقًا وهميًّا.';
create index if not exists ix_fin_ret_live on public.fin_retainers(status) where is_deleted = false;

-- 3.8 الذمم المدينة — الحالة والتحصيل والمتأخّر كلّها **مشتقّة** لا محفوظة
create table if not exists public.fin_receivables (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  contract_id   uuid references public.fin_contracts(id) on delete set null,
  project_id    uuid,                         -- ★ اختياريّ · للتجميع والعرض فقط ★
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  client_label  text,
  client_id     uuid,                         -- مرجع رخو إلى profiles (بلا FK)
  title         text not null check (length(btrim(title)) between 2 and 300),
  issue_date    date not null default current_date,
  due_date      date,
  currency      text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net    numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross  numeric(14,2) generated always as (amount_net + vat_amount) stored,
  source        text not null default 'manual' check (source in ('manual','zoho_books_reference')),
  zoho_invoice_id text,
  status        text not null default 'open' check (status in ('draft','open','void','written_off')),
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint fin_recv_due check (due_date is null or due_date >= issue_date)
);
comment on table public.fin_receivables is
  'ذمم داخلية. ★ لا تُعرَض لعميل أبدًا ★. حالة التحصيل والمتأخّر والمتبقّي مشتقّة من fin_collections وقت القراءة، فلا عمود يمكن أن ينحرف عن الواقع.';
create index if not exists ix_fin_recv_live on public.fin_receivables(status, due_date) where is_deleted = false;
create index if not exists ix_fin_recv_project on public.fin_receivables(project_id) where project_id is not null and is_deleted = false;

create table if not exists public.fin_collections (
  id             uuid primary key default gen_random_uuid(),
  receivable_id  uuid not null references public.fin_receivables(id) on delete cascade,
  collected_on   date not null default current_date,
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  method         text not null default 'bank_transfer'
                 check (method in ('bank_transfer','cheque','cash','card','offset','other')),
  reference      text, note text,
  recorded_by    uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists ix_fin_coll_recv on public.fin_collections(receivable_id) where is_deleted = false;

-- 3.9 دفعات العقد
create table if not exists public.fin_payment_milestones (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid references public.fin_contracts(id) on delete set null,
  project_id    uuid,                         -- ★ اختياريّ · للتجميع والعرض فقط ★
  title         text not null check (length(btrim(title)) between 2 and 300),
  sort_order    int not null default 100,
  due_on        date,
  currency      text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net    numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross  numeric(14,2) generated always as (amount_net + vat_amount) stored,
  status        text not null default 'planned' check (status in ('planned','invoiced','cancelled')),
  receivable_id uuid references public.fin_receivables(id) on delete set null,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);
comment on column public.fin_payment_milestones.status is
  'الدفعة تُفوتَر أو لا. ★ لا حالة collected هنا عمدًا ★: التحصيل واقعة تخصّ الذمّة ويُشتقّ منها، فلا مصدرا حقيقة لحدث واحد.';
create index if not exists ix_fin_ms_contract on public.fin_payment_milestones(contract_id) where is_deleted = false;

-- 3.10 حدود الاعتماد
create table if not exists public.fin_approval_thresholds (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null check (scope in ('expense','purchase')),
  category_id    uuid references public.fin_expense_categories(id) on delete set null,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  min_amount     numeric(14,2) not null default 0 check (min_amount >= 0),
  max_amount     numeric(14,2) check (max_amount is null or max_amount > min_amount),
  required_role  text not null default 'finance' check (required_role in ('finance','owner')),
  requires_second_approval boolean not null default false,
  notes          text,
  is_active      boolean not null default true,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create unique index if not exists uq_fin_threshold on public.fin_approval_thresholds(
  scope,
  coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
  min_amount) where is_deleted = false;

-- 3.11 طلبات الصرف + أثر الاعتماد
create table if not exists public.fin_expense_requests (
  id             uuid primary key default gen_random_uuid(),
  request_no     text not null unique,
  requested_by   uuid not null references auth.users(id) on delete restrict,
  category_id    uuid references public.fin_expense_categories(id) on delete set null,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  budget_id      uuid references public.fin_budgets(id) on delete set null,
  budget_line_id uuid references public.fin_budget_lines(id) on delete set null,
  project_id     uuid,                        -- ★ اختياريّ · للتجميع والعرض فقط ★
  supplier_id    uuid references public.fin_suppliers(id) on delete set null,
  title          text not null check (length(btrim(title)) between 2 and 300),
  description    text,
  spent_on       date not null default current_date,
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved','rejected','paid','cancelled')),
  submitted_at   timestamptz,
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  needs_second_approval boolean not null default false,
  second_decided_by uuid references auth.users(id) on delete set null,
  second_decided_at timestamptz,
  cost_id        uuid,                        -- الصفّ المُنشأ في دفتر التكلفة
  paid_on        date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz, deleted_by uuid, delete_reason text
);
create index if not exists ix_fin_exp_status on public.fin_expense_requests(status) where is_deleted = false;
create index if not exists ix_fin_exp_mine   on public.fin_expense_requests(requested_by) where is_deleted = false;

create table if not exists public.fin_expense_approvals (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.fin_expense_requests(id) on delete cascade,
  step        int not null default 1 check (step between 1 and 5),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null check (action in ('submitted','approved','rejected','returned','paid','cancelled')),
  note        text,
  amount_gross_at_action numeric(14,2),
  acted_at    timestamptz not null default now()
);
create index if not exists ix_fin_expapp_req on public.fin_expense_approvals(request_id);

-- 3.12 طلبات الشراء + بنودها
create table if not exists public.fin_purchase_requests (
  id             uuid primary key default gen_random_uuid(),
  request_no     text not null unique,
  requested_by   uuid not null references auth.users(id) on delete restrict,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  budget_id      uuid references public.fin_budgets(id) on delete set null,
  project_id     uuid,                        -- ★ اختياريّ · للتجميع والعرض فقط ★
  supplier_id    uuid references public.fin_suppliers(id) on delete set null,
  title          text not null check (length(btrim(title)) between 2 and 300),
  justification  text,
  needed_by      date,
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','approved','rejected','ordered','cancelled')),
  submitted_at   timestamptz,
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz, decision_note text,
  custody_purchase_request_id uuid,           -- مرجع رخو لموديول شراء العهدة (بلا FK ولا نسخة)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz, deleted_by uuid, delete_reason text
);
comment on column public.fin_purchase_requests.custody_purchase_request_id is
  'مرجع اختياريّ إلى custody_purchase_requests. مصدر حقيقة شراء الأصول يبقى هناك — هنا الأثر المالي فقط، بلا تكرار ولا كتابة في موديول العهدة.';
create index if not exists ix_fin_pr_status on public.fin_purchase_requests(status) where is_deleted = false;
create index if not exists ix_fin_pr_mine   on public.fin_purchase_requests(requested_by) where is_deleted = false;

create table if not exists public.fin_purchase_request_items (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.fin_purchase_requests(id) on delete cascade,
  line_no       int not null default 1 check (line_no >= 1),
  description   text not null check (length(btrim(description)) between 1 and 400),
  quantity      numeric(12,3) not null default 1 check (quantity > 0),
  unit          text not null default 'unit',
  unit_price_net numeric(14,2) not null default 0 check (unit_price_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  line_net      numeric(14,2) generated always as (round(quantity * unit_price_net, 2)) stored,
  line_gross    numeric(14,2) generated always as (round(quantity * unit_price_net, 2) + vat_amount) stored,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false
);
create index if not exists ix_fin_pritem_req on public.fin_purchase_request_items(request_id) where is_deleted = false;

-- 3.13 أوامر الشراء (أساس) + بنودها
create table if not exists public.fin_purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  po_no          text not null unique,
  supplier_id    uuid not null references public.fin_suppliers(id) on delete restrict,
  request_id     uuid references public.fin_purchase_requests(id) on delete set null,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  budget_id      uuid references public.fin_budgets(id) on delete set null,
  budget_line_id uuid references public.fin_budget_lines(id) on delete set null,
  project_id     uuid,                        -- ★ اختياريّ · للتجميع والعرض فقط ★
  issue_date     date not null default current_date,
  expected_date  date,
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  status         text not null default 'draft'
                 check (status in ('draft','issued','partially_received','received','closed','cancelled')),
  issued_at      timestamptz, closed_at timestamptz,
  terms          text, notes text,
  committed_cost_id uuid,                     -- صفّ الالتزام المُنشأ عند الإصدار
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz, deleted_by uuid, delete_reason text,
  constraint fin_po_dates check (expected_date is null or expected_date >= issue_date)
);
create index if not exists ix_fin_po_status   on public.fin_purchase_orders(status) where is_deleted = false;
create index if not exists ix_fin_po_supplier on public.fin_purchase_orders(supplier_id) where is_deleted = false;

create table if not exists public.fin_purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.fin_purchase_orders(id) on delete cascade,
  line_no       int not null default 1 check (line_no >= 1),
  description   text not null check (length(btrim(description)) between 1 and 400),
  quantity      numeric(12,3) not null default 1 check (quantity > 0),
  unit          text not null default 'unit',
  unit_price_net numeric(14,2) not null default 0 check (unit_price_net >= 0),
  vat_rate      numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  line_net      numeric(14,2) generated always as (round(quantity * unit_price_net, 2)) stored,
  line_gross    numeric(14,2) generated always as (round(quantity * unit_price_net, 2) + vat_amount) stored,
  received_qty  numeric(12,3) not null default 0 check (received_qty >= 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_deleted    boolean not null default false,
  constraint fin_poitem_received check (received_qty <= quantity)
);
create index if not exists ix_fin_poitem_po on public.fin_purchase_order_items(po_id) where is_deleted = false;

-- 3.14 ★ دفتر التكلفة الموحَّد ★ — الملتزَم به والفعليّ في جدول واحد.
--      طاقم · مستقلّون · سفر · تأجير معدّات · مشتريات إنتاج · لوجستيّات …
--      جدولٌ واحد بدل ستّة: نوع التكلفة عمود، لا جدول. هذا ما يجعل «التكلفة
--      الفعلية» و«الملتزَم بها» و«انحراف الميزانية» أرقامًا من مصدر واحد.
create table if not exists public.fin_costs (
  id             uuid primary key default gen_random_uuid(),
  cost_no        text not null unique,
  cost_type      text not null default 'other'
                 check (cost_type in ('crew','freelancer','travel','equipment_rental',
                                      'production_purchase','logistics','software','other')),
  commitment     text not null default 'actual' check (commitment in ('committed','actual')),
  category_id    uuid references public.fin_expense_categories(id) on delete set null,
  cost_center_id uuid references public.fin_cost_centers(id) on delete set null,
  budget_id      uuid references public.fin_budgets(id) on delete set null,
  budget_line_id uuid references public.fin_budget_lines(id) on delete set null,
  project_id     uuid,                        -- ★ اختياريّ · للتجميع والعرض فقط ★
  supplier_id    uuid references public.fin_suppliers(id) on delete set null,
  person_user_id uuid references auth.users(id) on delete set null,   -- تكلفة فرد الطاقم
  person_label   text,                                                -- أو مستقلّ خارجيّ
  source_kind    text not null default 'manual'
                 check (source_kind in ('manual','expense_request','purchase_order','rental','custody','payroll')),
  source_id      uuid,
  title          text not null check (length(btrim(title)) between 2 and 300),
  description    text,
  incurred_on    date not null default current_date,
  currency       text not null default 'SAR' check (currency ~ '^[A-Z]{3}$'),
  amount_net     numeric(14,2) not null default 0 check (amount_net >= 0),
  vat_rate       numeric(6,3)  not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount     numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_gross   numeric(14,2) generated always as (amount_net + vat_amount) stored,
  status         text not null default 'confirmed' check (status in ('draft','confirmed','void')),
  notes          text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false,
  deleted_at     timestamptz, deleted_by uuid, delete_reason text
);
comment on table public.fin_costs is
  'دفتر التكلفة الموحَّد: commitment=committed التزام (أمر شراء مُصدَر/طلب صرف معتمد) وcommitment=actual تكلفة واقعة. الانحراف يُشتقّ من هنا ومن fin_budget_lines، ولا يُخزَّن.';
create index if not exists ix_fin_cost_live    on public.fin_costs(incurred_on) where is_deleted = false;
create index if not exists ix_fin_cost_project on public.fin_costs(project_id) where project_id is not null and is_deleted = false;
create index if not exists ix_fin_cost_budget  on public.fin_costs(budget_id) where budget_id is not null and is_deleted = false;
create index if not exists ix_fin_cost_person  on public.fin_costs(person_user_id) where person_user_id is not null and is_deleted = false;
create index if not exists ix_fin_cost_source  on public.fin_costs(source_kind, source_id) where source_id is not null and is_deleted = false;

-- 3.15 المرفقات
create table if not exists public.fin_attachments (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('expense_request','purchase_request','purchase_order',
                                                    'cost','receivable','collection','contract','supplier','budget')),
  entity_id    uuid not null,
  file_url     text not null check (length(btrim(file_url)) between 3 and 2000),
  file_name    text, mime_type text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  note         text,
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  is_deleted   boolean not null default false,
  deleted_at   timestamptz, deleted_by uuid, delete_reason text
);
create index if not exists ix_fin_att_entity on public.fin_attachments(entity_type, entity_id) where is_deleted = false;

-- 3.16 التدقيق
create table if not exists public.fin_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text, entity_id uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists ix_fin_audit_time on public.fin_audit(created_at desc);

-- 3.17 صادر Zoho Books — تصميم إعادة الإرسال، بلا أيّ إرسال.
-- ★ لاحظ قائمة الحالات: لا وجود لـsent ولا synced ولا delivered ★. غياب الحالة
--   هو البرهان البنيويّ على أنّ شيئًا لا يُرسَل: لا يمكن لصفّ أن يدّعي الإرسال.
create table if not exists public.fin_zoho_outbox (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null check (event_type in ('expense.create','bill.create','vendor.upsert',
                                                   'invoice.reference','payment.reference','contact.upsert')),
  entity_type  text not null, entity_id uuid,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
               check (status in ('pending','held','failed','cancelled')),
  hold_reason  text not null default 'integration_not_built',
  attempt_count int not null default 0 check (attempt_count >= 0),
  last_error   text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.fin_zoho_outbox is
  'صندوق صادر لتكامل Zoho Books غير المبنيّ. لا يوجد عامل يقرأه ولا بيانات اعتماد ولا اتصال خارجيّ. قائمة الحالات لا تتضمّن sent عمدًا: لا صفّ يستطيع الادّعاء بأنّه أُرسل.';
create index if not exists ix_fin_outbox_status on public.fin_zoho_outbox(status, created_at);

-- المفاتيح الخارجية إلى projects تُضاف **فقط** إن كان الجدول موجودًا، وبـset null
-- كي لا يمنع الموديول حذف مشروع ولا يفرض ترتيب تشغيل على المنصّة المجمَّدة.
do $fk$
declare r record;
begin
  if to_regclass('public.projects') is null then
    raise notice 'FIN: projects غير موجود — لا مفاتيح خارجية للمشروع (السلوك اختياريّ أصلًا).';
    return;
  end if;
  for r in select * from (values
      ('fin_budgets'),('fin_contracts'),('fin_revenue'),('fin_retainers'),('fin_receivables'),
      ('fin_payment_milestones'),('fin_expense_requests'),('fin_purchase_requests'),
      ('fin_purchase_orders'),('fin_costs')) as v(t)
  loop
    if not exists (select 1 from pg_constraint where conname = r.t || '_project_fk') then
      execute format(
        'alter table public.%I add constraint %I foreign key (project_id) references public.projects(id) on delete set null',
        r.t, r.t || '_project_fk');
    end if;
  end loop;
end $fk$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) RLS — تفعيل على كلّ جدول، وسياسات **قراءة فقط**.
--     لا سياسة INSERT/UPDATE/DELETE على أيّ جدول: كلّ كتابة عبر RPC.
--
--     ★ ثلاث طبقات، وواحدة منها ليست هنا ★
--       (أ) كلّ جدول ماليّ         → finops_can_view_finance_sensitive()  (المالك)
--       (ب) صفّ الموظّف نفسه       → requested_by = auth.uid()، ومعه المعتمِد
--       (ج) موظّف التحصيل          → **لا سياسة له إطلاقًا**. لا يقرأ جدولًا.
--
--     ⚠️ الطبقة (ج) هي الإصلاح: القسمة القديمة أعطت حاملَ finance_ops.view
--     جدولَي fin_receivables وfin_costs معًا، والطرح بينهما يقارب الهامش بلا
--     مفتاح ربحية. لا يكفي تضييق عمود ولا حجب لوحة: ما دام الوصول جدوليًّا،
--     تُلتَفّ كلّ بوّابة عبر PostgREST مباشرةً. لذلك أُلغي وصول التحصيل
--     الجدوليّ من أصله، ويمرّ عبر finops_collections_list وحدها (§6).
--     النتيجة القابلة للاختبار: من يملك مفاتيح التحصيل ولا يملك is_owner()
--     يرى **صفر صفوف** في أيّ جدول fin_* عبر أيّ استدعاء مباشر.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
declare t text;
begin
  foreach t in array array['fin_cost_centers','fin_expense_categories','fin_suppliers','fin_budgets',
    'fin_budget_lines','fin_contracts','fin_revenue','fin_retainers','fin_receivables','fin_collections',
    'fin_payment_milestones','fin_approval_thresholds','fin_expense_requests','fin_expense_approvals',
    'fin_purchase_requests','fin_purchase_request_items','fin_purchase_orders','fin_purchase_order_items',
    'fin_costs','fin_attachments','fin_audit','fin_zoho_outbox'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- (أ) كلّ جدول يحمل تكلفةً أو إيرادًا أو سعرًا أو ذمّة: المالك وحده.
  --     ولاحظ أنّ fin_receivables وfin_collections وfin_payment_milestones هنا
  --     ولم يُترك أيّ منها لبوّابة التحصيل: الوصول الجدوليّ إليها هو نصف
  --     معادلة الهامش، ولن يُمنح لمن يملك — أو يستطيع أن يبلغ — النصف الآخر.
  foreach t in array array['fin_cost_centers','fin_expense_categories','fin_suppliers','fin_budgets',
    'fin_budget_lines','fin_contracts','fin_revenue','fin_retainers','fin_receivables',
    'fin_collections','fin_payment_milestones','fin_approval_thresholds',
    'fin_purchase_orders','fin_purchase_order_items','fin_costs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.finops_can_view_finance_sensitive())',
      t || '_read', t);
  end loop;

  -- (ب) طلبات الموظّف: المالك يرى الكلّ، والمعتمِد يرى ما يعتمده، والموظّف
  --     يرى **صفّه هو** فقط. مبلغ الطلب ليس سجلّ تكاليف: صفّ واحد يخصّ قرارًا.
  drop policy if exists fin_expense_requests_read on public.fin_expense_requests;
  create policy fin_expense_requests_read on public.fin_expense_requests for select to authenticated
    using (public.finops_can_view_finance_sensitive()
        or public.finops_can_approve_expense()
        or requested_by = auth.uid());

  drop policy if exists fin_purchase_requests_read on public.fin_purchase_requests;
  create policy fin_purchase_requests_read on public.fin_purchase_requests for select to authenticated
    using (public.finops_can_view_finance_sensitive()
        or public.finops_can_approve_expense()
        or requested_by = auth.uid());

  drop policy if exists fin_expense_approvals_read on public.fin_expense_approvals;
  create policy fin_expense_approvals_read on public.fin_expense_approvals for select to authenticated
    using (public.finops_can_view_finance_sensitive()
        or public.finops_can_approve_expense()
        or exists (select 1 from public.fin_expense_requests r
                    where r.id = request_id and r.requested_by = auth.uid()));

  drop policy if exists fin_purchase_request_items_read on public.fin_purchase_request_items;
  create policy fin_purchase_request_items_read on public.fin_purchase_request_items for select to authenticated
    using (public.finops_can_view_finance_sensitive()
        or public.finops_can_approve_expense()
        or exists (select 1 from public.fin_purchase_requests r
                    where r.id = request_id and r.requested_by = auth.uid()));

  -- المرفقات: المالك، أو من رفع الملفّ بنفسه (إيصاله هو)، أو المعتمِد لمرفق
  --   طلبٍ فقط. لا يُفتح مرفق تكلفة ولا عقد ولا ذمّة لغير المالك، لأنّ اسم
  --   الملفّ نفسه يسرّب رقمًا أحيانًا.
  drop policy if exists fin_attachments_read on public.fin_attachments;
  create policy fin_attachments_read on public.fin_attachments for select to authenticated
    using (public.finops_can_view_finance_sensitive()
        or uploaded_by = auth.uid()
        or (public.finops_can_approve_expense()
            and entity_type in ('expense_request','purchase_request')));

  -- التدقيق وصندوق الصادر: المالك وحده — سجلّ التدقيق يحمل المبالغ في detail.
  drop policy if exists fin_audit_read on public.fin_audit;
  create policy fin_audit_read on public.fin_audit for select to authenticated
    using (public.finops_can_manage_finance());

  drop policy if exists fin_zoho_outbox_read on public.fin_zoho_outbox;
  create policy fin_zoho_outbox_read on public.fin_zoho_outbox for select to authenticated
    using (public.finops_can_manage_finance());
end $rls$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) التدقيق + المساعدات الداخلية (REVOKE في §8 — لا تُستدعى من الواجهة)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.finops_log(
  p_action text, p_etype text, p_eid uuid, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.fin_audit(actor_id, action, entity_type, entity_id, detail)
  values (auth.uid(), p_action, p_etype, p_eid, coalesce(p_detail, '{}'::jsonb));
end $$;

-- اسم المشروع للعرض فقط — قراءة واحدة، مكتشَفة، ولا تلمس المنصّة.
-- ⚠️ اسم العمود يُكتشف من الكتالوج ولا يُخمَّن: تخمين اسم عمود في هذا المستودع
--    سبق أن أنتج 42703 وأسقط عملية كاملة. الترتيب: project_name ثمّ title ثمّ name.
create or replace function public.finops_project_label(p_project uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text; v_col text;
begin
  if p_project is null or to_regclass('public.projects') is null then return null; end if;
  select c.column_name into v_col
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'projects'
     and c.column_name in ('project_name','title','name')
   order by case c.column_name when 'project_name' then 1 when 'title' then 2 else 3 end
   limit 1;
  if v_col is null then return null; end if;
  begin
    execute format('select coalesce(nullif(btrim(p.%I), ''''), p.id::text) from public.projects p where p.id = $1', v_col)
      into v using p_project;
  exception when others then v := null;
  end;
  return v;
end $$;

create or replace function public.finops_next_code(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select upper(coalesce(nullif(btrim(p_prefix), ''), 'FIN')) || '-' ||
         to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.fin_doc_seq')::text, 5, '0');
$$;

-- ★ مُطبِّع المال ★ — نقطة واحدة يمرّ بها كلّ مبلغ في الموديول.
--   • يرفض صراحةً أيّ محاولة لإرسال إجماليّ (amount_gross/total): الإجمالي عمود
--     مولَّد، وقبول إجماليّ من الواجهة هو بالضبط الطريقة التي تُطوى بها الضريبة.
--   • إن لم تُرسَل الضريبة صراحةً تُحسب من النسبة — ولا تُترك صفرًا صامتًا.
create or replace function public.finops_money(p jsonb, p_default_rate numeric default 15)
returns jsonb language plpgsql immutable security definer set search_path = public as $$
declare v_net numeric; v_rate numeric; v_vat numeric;
begin
  p := coalesce(p, '{}'::jsonb);
  if p ? 'amount_gross' or p ? 'total' or p ? 'amount_total' then
    raise exception 'gross_not_writable';   -- الإجمالي مشتقّ؛ الضريبة لا تُطوى فيه
  end if;
  v_net  := round(coalesce(nullif(btrim(coalesce(p->>'amount_net','')), '')::numeric, 0), 2);
  if v_net < 0 then raise exception 'negative_amount'; end if;
  v_rate := coalesce(nullif(btrim(coalesce(p->>'vat_rate','')), '')::numeric, p_default_rate, 15);
  if v_rate < 0 or v_rate > 100 then raise exception 'invalid_vat_rate'; end if;
  if p ? 'vat_amount' and nullif(btrim(coalesce(p->>'vat_amount','')), '') is not null then
    v_vat := round((p->>'vat_amount')::numeric, 2);
  else
    v_vat := round(v_net * v_rate / 100.0, 2);
  end if;
  if v_vat < 0 then raise exception 'negative_vat'; end if;
  return jsonb_build_object('amount_net', v_net, 'vat_rate', v_rate, 'vat_amount', v_vat,
                            'amount_gross', v_net + v_vat);
end $$;

-- حدّ الاعتماد المنطبق. لا صفّ مطابق ⇒ الافتراض الأشدّ (المالك) لا الأسهل.
create or replace function public.finops_threshold_for(
  p_scope text, p_amount numeric, p_category uuid default null, p_cost_center uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; v_amount numeric := coalesce(p_amount, 0);
begin
  select t.required_role, t.requires_second_approval, t.min_amount, t.max_amount into r
    from public.fin_approval_thresholds t
   where t.is_deleted = false and t.is_active = true and t.scope = p_scope
     and v_amount >= t.min_amount
     and (t.max_amount is null or v_amount <= t.max_amount)
     and (t.category_id is null or t.category_id = p_category)
     and (t.cost_center_id is null or t.cost_center_id = p_cost_center)
   order by (t.category_id is not null) desc, (t.cost_center_id is not null) desc, t.min_amount desc
   limit 1;
  if not found then
    -- لا سياسة مُعرَّفة لهذا المبلغ: يُشترط المالك. الافتراض المتساهل هنا كان
    -- سيسمح باعتماد أيّ مبلغ لمجرّد أنّ أحدًا لم يضبط جدول الحدود بعد.
    return jsonb_build_object('required_role','owner','requires_second', (v_amount > 0),
      'matched', false,
      'message','لا حدّ اعتماد مضبوط لهذا المبلغ — يلزم اعتماد المالك حتى يُضبط جدول الحدود.');
  end if;
  return jsonb_build_object('required_role', r.required_role,
    'requires_second', coalesce(r.requires_second_approval, false), 'matched', true,
    'min_amount', r.min_amount, 'max_amount', r.max_amount, 'message', null);
end $$;

-- ★ حالة الذمّة مشتقّة ★ — محصَّل/متبقٍّ/متأخّر تُحسب وقت القراءة من fin_collections.
--   لا عمود محفوظ يمكن أن يفترق عن مجموع الدفعات.
create or replace function public.finops_receivable_state(p_recv uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; v_coll numeric := 0; v_out numeric; v_status text; v_days int := 0;
begin
  select id, due_date, status, amount_net, vat_amount, (amount_net + vat_amount) as gross
    into r from public.fin_receivables where id = p_recv and is_deleted = false;
  if not found then return jsonb_build_object('found', false, 'reason','row_not_found'); end if;

  select coalesce(sum(amount_net + vat_amount), 0) into v_coll
    from public.fin_collections where receivable_id = p_recv and is_deleted = false;
  v_out := round(r.gross - v_coll, 2);

  if r.status = 'written_off' then v_status := 'written_off';
  elsif r.status = 'void'     then v_status := 'void';
  elsif r.status = 'draft'    then v_status := 'draft';
  elsif v_out <= 0            then v_status := 'collected';
  elsif v_coll > 0            then v_status := 'partially_collected';
  elsif r.due_date is not null and r.due_date < current_date then v_status := 'overdue';
  elsif r.due_date is not null and r.due_date >= current_date then v_status := 'due';
  else v_status := 'not_due';
  end if;

  if r.due_date is not null and v_out > 0 and r.due_date < current_date
     and r.status not in ('void','written_off','draft') then
    v_days := (current_date - r.due_date);
  end if;

  return jsonb_build_object(
    'found', true, 'gross', r.gross, 'collected', round(v_coll, 2), 'outstanding', v_out,
    'collection_status', v_status, 'is_overdue', (v_days > 0), 'days_overdue', v_days,
    'aging_bucket', case when v_days <= 0 then 'current' when v_days <= 30 then '1_30'
                         when v_days <= 60 then '31_60' when v_days <= 90 then '61_90'
                         else 'over_90' end);
end $$;

-- ★ رصيد العقد المتبقّي مشتقّ ★ = قيمة العقد − ما فُوتِر عليه (ذمم غير ملغاة).
create or replace function public.finops_contract_state(p_contract uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_gross numeric; v_invoiced numeric := 0; v_collected numeric := 0;
begin
  select (amount_net + vat_amount) into v_gross
    from public.fin_contracts where id = p_contract and is_deleted = false;
  if v_gross is null then return jsonb_build_object('found', false, 'reason','row_not_found'); end if;
  select coalesce(sum(amount_net + vat_amount), 0) into v_invoiced
    from public.fin_receivables
   where contract_id = p_contract and is_deleted = false and status in ('open','written_off');
  select coalesce(sum(c.amount_net + c.vat_amount), 0) into v_collected
    from public.fin_collections c join public.fin_receivables r on r.id = c.receivable_id
   where r.contract_id = p_contract and c.is_deleted = false and r.is_deleted = false;
  return jsonb_build_object('found', true, 'contract_gross', v_gross,
    'invoiced', round(v_invoiced, 2), 'collected', round(v_collected, 2),
    'remaining_balance', round(v_gross - v_invoiced, 2),
    'uncollected', round(v_invoiced - v_collected, 2));
end $$;

-- ★ محرّك انحراف الميزانية ★ — مخطَّط · ملتزَم · فعليّ · متاح. كلّه مشتقّ.
create or replace function public.finops_variance_core(p_budget uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_planned numeric := 0; v_committed numeric := 0; v_actual numeric := 0; v_lines jsonb;
begin
  if p_budget is null then return jsonb_build_object('found', false, 'reason','budget_required'); end if;
  if not exists (select 1 from public.fin_budgets where id = p_budget and is_deleted = false) then
    return jsonb_build_object('found', false, 'reason','row_not_found');
  end if;
  select coalesce(sum(amount_net + vat_amount), 0) into v_planned
    from public.fin_budget_lines where budget_id = p_budget and is_deleted = false;
  select coalesce(sum(amount_net + vat_amount) filter (where commitment = 'committed'), 0),
         coalesce(sum(amount_net + vat_amount) filter (where commitment = 'actual'), 0)
    into v_committed, v_actual
    from public.fin_costs where budget_id = p_budget and is_deleted = false and status <> 'void';

  select coalesce(jsonb_agg(x order by x->>'label'), '[]'::jsonb) into v_lines from (
    select jsonb_build_object(
      'line_id', l.id, 'label', l.label,
      'category', (select c.name_ar from public.fin_expense_categories c where c.id = l.category_id),
      'planned_net', l.amount_net, 'planned_vat', l.vat_amount,
      'planned_gross', (l.amount_net + l.vat_amount),
      'committed_gross', coalesce((select sum(k.amount_net + k.vat_amount) from public.fin_costs k
         where k.budget_line_id = l.id and k.is_deleted = false and k.status <> 'void' and k.commitment = 'committed'), 0),
      'actual_gross', coalesce((select sum(k.amount_net + k.vat_amount) from public.fin_costs k
         where k.budget_line_id = l.id and k.is_deleted = false and k.status <> 'void' and k.commitment = 'actual'), 0)
    ) as x
    from public.fin_budget_lines l where l.budget_id = p_budget and l.is_deleted = false
  ) s;

  return jsonb_build_object('found', true, 'budget_id', p_budget,
    'planned_gross', round(v_planned, 2), 'committed_gross', round(v_committed, 2),
    'actual_gross', round(v_actual, 2),
    'consumed_gross', round(v_committed + v_actual, 2),
    'variance_gross', round(v_planned - (v_committed + v_actual), 2),
    'consumed_pct', case when v_planned > 0
      then round(((v_committed + v_actual) / v_planned) * 100, 1) else null end,
    'over_budget', ((v_committed + v_actual) > v_planned and v_planned > 0),
    'lines', v_lines);
end $$;

-- ★ محرّك الربحية ★ — داخليّ بحت. لا يُمنح لأحد، ولا يُستدعى إلّا من غلاف
--   يفحص البوّابة الحسّاسة أوّلًا. صافي الربح **تقديريّ** ويُعلن ذلك.
create or replace function public.finops_profit_core(p_project uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rev numeric := 0; v_rev_net numeric := 0; v_direct numeric := 0; v_direct_net numeric := 0;
        v_overhead_pct numeric := 0; v_gross numeric; v_est_net numeric;
begin
  select coalesce(sum(amount_net + vat_amount), 0), coalesce(sum(amount_net), 0)
    into v_rev, v_rev_net
    from public.fin_revenue
   where is_deleted = false and status <> 'cancelled'
     and (p_project is null or project_id = p_project)
     and (p_from is null or recognized_on >= p_from)
     and (p_to   is null or recognized_on <= p_to);

  select coalesce(sum(amount_net + vat_amount), 0), coalesce(sum(amount_net), 0)
    into v_direct, v_direct_net
    from public.fin_costs
   where is_deleted = false and status <> 'void' and commitment = 'actual'
     and (p_project is null or project_id = p_project)
     and (p_from is null or incurred_on >= p_from)
     and (p_to   is null or incurred_on <= p_to);

  -- نسبة تحميل غير مباشر مقدّرة: تكاليف بلا مشروع ÷ إجمالي التكاليف الفعلية.
  -- تقدير مُعلَن لا محاسبة: لا يُقدَّم كصافٍ نهائيّ في أيّ شاشة.
  select case when coalesce(sum(amount_net), 0) > 0
              then round(coalesce(sum(amount_net) filter (where project_id is null), 0)
                         / sum(amount_net) * 100, 2) else 0 end
    into v_overhead_pct
    from public.fin_costs
   where is_deleted = false and status <> 'void' and commitment = 'actual'
     and (p_from is null or incurred_on >= p_from) and (p_to is null or incurred_on <= p_to);

  -- ★ الربح يُحسب على الصافي قبل الضريبة ★: الضريبة تُحصَّل لصالح الدولة ولا
  --   تدخل ربحًا ولا تكلفةً. حسابها ضمن الهامش كان سيضخّم الرقم بلا معنى.
  v_gross    := round(v_rev_net - v_direct_net, 2);
  v_est_net  := round(v_gross - (v_direct_net * v_overhead_pct / 100.0), 2);

  return jsonb_build_object(
    'project_id', p_project, 'from', p_from, 'to', p_to,
    'revenue_net', round(v_rev_net, 2), 'revenue_gross', round(v_rev, 2),
    'direct_cost_net', round(v_direct_net, 2), 'direct_cost_gross', round(v_direct, 2),
    'gross_profit_net', v_gross,
    'gross_margin_pct', case when v_rev_net > 0 then round(v_gross / v_rev_net * 100, 1) else null end,
    'overhead_rate_pct', v_overhead_pct,
    'estimated_net_profit', v_est_net,
    'estimated_net_margin_pct', case when v_rev_net > 0 then round(v_est_net / v_rev_net * 100, 1) else null end,
    'basis', 'net_of_vat',
    'is_estimate', true,
    'note', 'صافي الربح تقديريّ: يحمّل غير المباشر بنسبة مشتقّة ولا يقوم مقام الدفاتر المحاسبية في Zoho Books.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) دوالّ القراءة — كلّها تُغلق على غير المصرَّح **قبل أن تقرأ صفًّا واحدًا**.
--     المِجَسّ finops_access وحده لا يرفع استثناء، لأنّ وظيفته أن تعرف الواجهة
--     أين هي: لو رفع استثناءً لعجزت عن التفريق بين «ممنوع» و«ترحيلة ناقصة».
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.finops_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'authenticated', (auth.uid() is not null),
    -- الأسماء الصريحة للنموذج الجديد
    'can_view_finance_sensitive', coalesce(public.finops_can_view_finance_sensitive(), false),
    'can_manage_finance',         coalesce(public.finops_can_manage_finance(), false),
    'can_manage_suppliers',       coalesce(public.finops_can_manage_suppliers(), false),
    'can_view_collections',       coalesce(public.finops_can_view_collections(), false),
    'can_record_collection',      coalesce(public.finops_can_record_collection(), false),
    'can_approve_expense',        coalesce(public.finops_can_approve_expense(), false),
    'can_export_sensitive',       coalesce(public.finops_can_export_sensitive(), false),
    'can_export_collections',     coalesce(public.finops_can_export_collections(), false),
    'can_request',                coalesce(public.finops_can_request(), false),
    'is_client',                  coalesce(public.finops_is_client(), false),
    -- أسماء متوارثة تُبقيها الواجهة القديمة حيّة (مرادفات، لا صلاحية إضافية)
    'can_view',              coalesce(public.finops_can_view(), false),
    'can_manage',            coalesce(public.finops_can_manage(), false),
    'can_approve',           coalesce(public.finops_can_approve(), false),
    'can_view_profit',       coalesce(public.finops_can_view_profit(), false),
    'can_manage_receivables',coalesce(public.finops_can_manage_receivables(), false),
    'can_export',            coalesce(public.finops_can_export(), false),
    'user_id', auth.uid(),
    'message', case
      when auth.uid() is null then 'سجّل الدخول للوصول إلى المركز المالي.'
      when coalesce(public.finops_is_client(), false) then 'المركز المالي داخليّ بالكامل ولا يُتاح لحسابات العملاء.'
      when coalesce(public.finops_can_view_finance_sensitive(), false) then null
      when coalesce(public.finops_can_view_collections(), false)
        then 'صلاحيتك تحصيل: العميل والفاتورة والمستحقّ والمحصَّل والمتبقّي. التكاليف والربحية والميزانيات مقصورة على المالك — وهذا منع مقصود لا عطل.'
      when coalesce(public.finops_can_approve_expense(), false)
        then 'صلاحيتك اعتماد الطلبات: ترى الطلب الذي تقرّر فيه لا غير. لا تكاليف ولا ذمم ولا ربحية.'
      when coalesce(public.finops_can_request(), false)
        then 'تستطيع رفع طلب صرفك ومتابعته. البيانات المالية للشركة مقصورة على المالك.'
      else null end);
$$;

-- المراجع الكاملة — للمالية وحدها (تحمل أرقامًا وحدودًا).
create or replace function public.finops_lookups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'ok', true,
    'cost_centers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code,
        'name_ar', name_ar, 'kind', kind) order by code)
      from public.fin_cost_centers where is_deleted = false and is_active = true), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', key,
        'name_ar', name_ar, 'cost_nature', cost_nature, 'default_vat_rate', default_vat_rate) order by sort_order)
      from public.fin_expense_categories where is_deleted = false and is_active = true), '[]'::jsonb),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name,
        'supplier_type', supplier_type) order by name)
      from public.fin_suppliers where is_deleted = false and is_active = true), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'title', title,
        'status', status) order by created_at desc)
      from public.fin_budgets where is_deleted = false), '[]'::jsonb),
    'thresholds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'scope', scope,
        'min_amount', min_amount, 'max_amount', max_amount, 'required_role', required_role,
        'requires_second_approval', requires_second_approval) order by scope, min_amount)
      from public.fin_approval_thresholds where is_deleted = false and is_active = true), '[]'::jsonb));
end $$;

-- مراجع مقصورة على مُقدِّم الطلب: أسماء بنود ومراكز تكلفة فقط. لا مبالغ، لا
-- ميزانيات، لا حدود اعتماد — الموظّف لا يعرف من هنا شيئًا عن مال الشركة.
create or replace function public.finops_request_lookups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.finops_can_request(), false) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'ok', true,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', key, 'name_ar', name_ar)
        order by sort_order)
      from public.fin_expense_categories where is_deleted = false and is_active = true), '[]'::jsonb),
    'cost_centers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name_ar', name_ar)
        order by code)
      from public.fin_cost_centers where is_deleted = false and is_active = true), '[]'::jsonb));
end $$;

create or replace function public.finops_budgets_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_status text; v_project uuid;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_status  := nullif(btrim(coalesce(f->>'status','')), '');
  v_project := nullif(btrim(coalesce(f->>'project_id','')), '')::uuid;
  select coalesce(jsonb_agg(x order by x->>'code' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', b.id, 'code', b.code, 'title', b.title, 'scope', b.scope,
      'status', b.status, 'fiscal_year', b.fiscal_year, 'currency', b.currency,
      'period_start', b.period_start, 'period_end', b.period_end,
      'cost_center', (select c.name_ar from public.fin_cost_centers c where c.id = b.cost_center_id),
      'project_id', b.project_id, 'project_label', public.finops_project_label(b.project_id),
      'variance', public.finops_variance_core(b.id)) as x
    from public.fin_budgets b
    where b.is_deleted = false
      and (v_status is null or b.status = v_status)
      and (v_project is null or b.project_id = v_project)
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

create or replace function public.finops_budget_variance(p_budget uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v := public.finops_variance_core(p_budget);
  if coalesce((v->>'found')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', coalesce(v->>'reason','row_not_found'));
  end if;
  return jsonb_build_object('ok', true, 'variance', v);
end $$;

create or replace function public.finops_costs_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb;
        v_from date; v_to date; v_project uuid; v_type text; v_commit text; v_limit int;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_from    := nullif(btrim(coalesce(f->>'from','')), '')::date;
  v_to      := nullif(btrim(coalesce(f->>'to','')), '')::date;
  v_project := nullif(btrim(coalesce(f->>'project_id','')), '')::uuid;
  v_type    := nullif(btrim(coalesce(f->>'cost_type','')), '');
  v_commit  := nullif(btrim(coalesce(f->>'commitment','')), '');
  v_limit   := least(greatest(coalesce(nullif(btrim(coalesce(f->>'limit','')), '')::int, 200), 1), 1000);
  select coalesce(jsonb_agg(x order by x->>'incurred_on' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', k.id, 'cost_no', k.cost_no, 'cost_type', k.cost_type,
      'commitment', k.commitment, 'title', k.title, 'incurred_on', k.incurred_on,
      'currency', k.currency, 'amount_net', k.amount_net, 'vat_rate', k.vat_rate,
      'vat_amount', k.vat_amount, 'amount_gross', k.amount_gross, 'status', k.status,
      'source_kind', k.source_kind, 'source_id', k.source_id,
      'supplier', (select s.name from public.fin_suppliers s where s.id = k.supplier_id),
      'category', (select c.name_ar from public.fin_expense_categories c where c.id = k.category_id),
      'cost_center', (select cc.name_ar from public.fin_cost_centers cc where cc.id = k.cost_center_id),
      'person_label', coalesce(k.person_label,
        (select p.full_name from public.profiles p where p.id = k.person_user_id)),
      'project_id', k.project_id, 'project_label', public.finops_project_label(k.project_id)) as x
    from public.fin_costs k
    where k.is_deleted = false
      and (v_from is null or k.incurred_on >= v_from)
      and (v_to   is null or k.incurred_on <= v_to)
      and (v_project is null or k.project_id = v_project)
      and (v_type   is null or k.cost_type = v_type)
      and (v_commit is null or k.commitment = v_commit)
    order by k.incurred_on desc, k.created_at desc
    limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

create or replace function public.finops_suppliers_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_q text;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_q := nullif(btrim(coalesce(f->>'q','')), '');
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'legal_name', s.legal_name,
      'supplier_type', s.supplier_type, 'vat_number', s.vat_number, 'phone', s.phone, 'email', s.email,
      'payment_terms_days', s.payment_terms_days, 'rating', s.rating, 'is_active', s.is_active,
      'spend_actual_gross', coalesce((select sum(k.amount_net + k.vat_amount) from public.fin_costs k
         where k.supplier_id = s.id and k.is_deleted = false and k.status <> 'void' and k.commitment = 'actual'), 0),
      'open_po_count', coalesce((select count(*) from public.fin_purchase_orders o
         where o.supplier_id = s.id and o.is_deleted = false
           and o.status in ('issued','partially_received')), 0)) as x
    from public.fin_suppliers s
    where s.is_deleted = false
      and (v_q is null or s.name ilike '%' || v_q || '%' or s.code ilike '%' || v_q || '%')
  ) t;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- طلبات الصرف — قائمة المالية (كلّ الطلبات).
create or replace function public.finops_expense_requests_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_status text; v_limit int;
begin
  -- المالك، أو المعتمِد الذي لا يستطيع أن يقرّر في مبلغ لا يراه. وهذا كلّ ما
  -- يراه المعتمِد: طلبات الصرف. لا fin_costs ولا ذمم ⇒ لا طرفَي طرح.
  if not (coalesce(public.finops_can_view_finance_sensitive(), false)
       or coalesce(public.finops_can_approve_expense(), false)) then
    raise exception 'not authorized';
  end if;
  v_status := nullif(btrim(coalesce(f->>'status','')), '');
  v_limit  := least(greatest(coalesce(nullif(btrim(coalesce(f->>'limit','')), '')::int, 200), 1), 1000);
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title,
      'status', r.status, 'spent_on', r.spent_on, 'created_at', r.created_at,
      'currency', r.currency, 'amount_net', r.amount_net, 'vat_rate', r.vat_rate,
      'vat_amount', r.vat_amount, 'amount_gross', r.amount_gross,
      'requested_by', r.requested_by,
      'requester_name', (select p.full_name from public.profiles p where p.id = r.requested_by),
      'category', (select c.name_ar from public.fin_expense_categories c where c.id = r.category_id),
      'cost_center', (select cc.name_ar from public.fin_cost_centers cc where cc.id = r.cost_center_id),
      'project_id', r.project_id, 'project_label', public.finops_project_label(r.project_id),
      'needs_second_approval', r.needs_second_approval,
      'decided_at', r.decided_at, 'decision_note', r.decision_note,
      'threshold', public.finops_threshold_for('expense', r.amount_gross, r.category_id, r.cost_center_id)) as x
    from public.fin_expense_requests r
    where r.is_deleted = false and (v_status is null or r.status = v_status)
    order by r.created_at desc
    limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- ★ قائمة الموظّف: صفّه هو فقط ★ — القيد requested_by = auth.uid() مكتوب في
--   الاستعلام نفسه، لا فلتر يأتي من الواجهة ويمكن تزويره.
create or replace function public.finops_my_requests(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_exp jsonb; v_pur jsonb; v_limit int;
begin
  if not coalesce(public.finops_can_request(), false) then raise exception 'not authorized'; end if;
  v_limit := least(greatest(coalesce(nullif(btrim(coalesce(f->>'limit','')), '')::int, 100), 1), 500);
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_exp from (
    select jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title,
      'status', r.status, 'spent_on', r.spent_on, 'created_at', r.created_at,
      'currency', r.currency, 'amount_net', r.amount_net, 'vat_rate', r.vat_rate,
      'vat_amount', r.vat_amount, 'amount_gross', r.amount_gross,
      'decision_note', r.decision_note, 'decided_at', r.decided_at, 'paid_on', r.paid_on) as x
    from public.fin_expense_requests r
    where r.is_deleted = false and r.requested_by = auth.uid()
    order by r.created_at desc limit v_limit
  ) s;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_pur from (
    select jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title,
      'status', r.status, 'needed_by', r.needed_by, 'created_at', r.created_at,
      'currency', r.currency, 'amount_net', r.amount_net, 'vat_amount', r.vat_amount,
      'amount_gross', r.amount_gross, 'decision_note', r.decision_note) as x
    from public.fin_purchase_requests r
    where r.is_deleted = false and r.requested_by = auth.uid()
    order by r.created_at desc limit v_limit
  ) s;
  -- لا عدّادات شركة ولا ميزانية ولا هامش هنا — عمدًا.
  return jsonb_build_object('ok', true, 'expense_requests', v_exp, 'purchase_requests', v_pur,
    'scope', 'own_rows_only');
end $$;

create or replace function public.finops_purchase_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_req jsonb; v_po jsonb; v_status text;
        v_sensitive boolean := coalesce(public.finops_can_view_finance_sensitive(), false);
begin
  if not (coalesce(public.finops_can_view_finance_sensitive(), false)
       or coalesce(public.finops_can_approve_expense(), false)) then
    raise exception 'not authorized';
  end if;
  v_status := nullif(btrim(coalesce(f->>'status','')), '');
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_req from (
    select jsonb_build_object('id', r.id, 'request_no', r.request_no, 'title', r.title,
      'status', r.status, 'needed_by', r.needed_by, 'created_at', r.created_at,
      'currency', r.currency, 'amount_net', r.amount_net, 'vat_amount', r.vat_amount,
      'amount_gross', r.amount_gross,
      'requester_name', (select p.full_name from public.profiles p where p.id = r.requested_by),
      'supplier', (select s.name from public.fin_suppliers s where s.id = r.supplier_id),
      'custody_link', (r.custody_purchase_request_id is not null),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'line_no', i.line_no,
          'description', i.description, 'quantity', i.quantity, 'unit', i.unit,
          'unit_price_net', i.unit_price_net, 'vat_amount', i.vat_amount,
          'line_net', i.line_net, 'line_gross', i.line_gross) order by i.line_no)
        from public.fin_purchase_request_items i
        where i.request_id = r.id and i.is_deleted = false), '[]'::jsonb),
      'threshold', public.finops_threshold_for('purchase', r.amount_gross, null, r.cost_center_id)) as x
    from public.fin_purchase_requests r
    where r.is_deleted = false and (v_status is null or r.status = v_status)
  ) s;
  select coalesce(jsonb_agg(x order by x->>'issue_date' desc), '[]'::jsonb) into v_po from (
    select jsonb_build_object('id', o.id, 'po_no', o.po_no, 'status', o.status,
      'issue_date', o.issue_date, 'expected_date', o.expected_date, 'currency', o.currency,
      'amount_net', o.amount_net, 'vat_amount', o.vat_amount, 'amount_gross', o.amount_gross,
      'supplier', (select s.name from public.fin_suppliers s where s.id = o.supplier_id),
      'project_id', o.project_id, 'project_label', public.finops_project_label(o.project_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'line_no', i.line_no,
          'description', i.description, 'quantity', i.quantity, 'received_qty', i.received_qty,
          'unit_price_net', i.unit_price_net, 'vat_amount', i.vat_amount,
          'line_net', i.line_net, 'line_gross', i.line_gross) order by i.line_no)
        from public.fin_purchase_order_items i where i.po_id = o.id and i.is_deleted = false), '[]'::jsonb)) as x
    from public.fin_purchase_orders o where o.is_deleted = false
    -- ★ أمر الشراء يحمل سعر المورّد = تكلفة شراء إنتاج ⇒ للمالك وحده. المعتمِد
    --   يرى الطلب الذي يقرّر فيه، ولا يرى دفتر أوامر الشراء ولا أسعار المورّدين.
    and v_sensitive
  ) s;
  return jsonb_build_object('ok', true, 'requests', v_req,
    'purchase_orders', case when v_sensitive then v_po else '[]'::jsonb end,
    'purchase_orders_masked', (not v_sensitive));
end $$;

-- الذمم والتحصيل والمتأخّرات — الحالة مشتقّة لكلّ صفّ.
create or replace function public.finops_receivables(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_only_overdue boolean;
        v_project uuid; v_totals jsonb;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_only_overdue := coalesce(nullif(btrim(coalesce(f->>'only_overdue','')), '')::boolean, false);
  v_project := nullif(btrim(coalesce(f->>'project_id','')), '')::uuid;

  select coalesce(jsonb_agg(x order by (x->>'days_overdue')::int desc nulls last), '[]'::jsonb)
    into v_rows from (
    select (jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'title', r.title,
      'client_label', r.client_label, 'issue_date', r.issue_date, 'due_date', r.due_date,
      'currency', r.currency, 'amount_net', r.amount_net, 'vat_rate', r.vat_rate,
      'vat_amount', r.vat_amount, 'amount_gross', r.amount_gross, 'status', r.status,
      'source', r.source, 'zoho_invoice_id', r.zoho_invoice_id,
      'project_id', r.project_id, 'project_label', public.finops_project_label(r.project_id),
      'contract_id', r.contract_id)
      || public.finops_receivable_state(r.id)) as x
    from public.fin_receivables r
    where r.is_deleted = false and (v_project is null or r.project_id = v_project)
  ) s
  where (not v_only_overdue) or coalesce((x->>'is_overdue')::boolean, false);

  select jsonb_build_object(
      'invoiced_gross', coalesce(round(sum((e->>'gross')::numeric), 2), 0),
      'collected_gross', coalesce(round(sum((e->>'collected')::numeric), 2), 0),
      'outstanding_gross', coalesce(round(sum((e->>'outstanding')::numeric), 2), 0),
      'overdue_gross', coalesce(round(sum(case when coalesce((e->>'is_overdue')::boolean, false)
                                                then (e->>'outstanding')::numeric else 0 end), 2), 0),
      'overdue_count', coalesce(count(*) filter (where coalesce((e->>'is_overdue')::boolean, false)), 0),
      'aging', jsonb_build_object(
        'current', coalesce(round(sum(case when e->>'aging_bucket' = 'current' then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd1_30',   coalesce(round(sum(case when e->>'aging_bucket' = '1_30'   then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd31_60',  coalesce(round(sum(case when e->>'aging_bucket' = '31_60'  then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd61_90',  coalesce(round(sum(case when e->>'aging_bucket' = '61_90'  then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'over_90', coalesce(round(sum(case when e->>'aging_bucket' = 'over_90' then (e->>'outstanding')::numeric else 0 end), 2), 0)))
    into v_totals
  from jsonb_array_elements(v_rows) e;

  return jsonb_build_object('ok', true, 'rows', v_rows,
    'totals', coalesce(v_totals, jsonb_build_object('invoiced_gross', 0, 'collected_gross', 0,
      'outstanding_gross', 0, 'overdue_gross', 0, 'overdue_count', 0,
      'aging', jsonb_build_object('current', 0, 'd1_30', 0, 'd31_60', 0, 'd61_90', 0, 'over_90', 0))),
    'note', 'حالة التحصيل والمتأخّر مشتقّتان من الدفعات المسجَّلة، لا من عمود محفوظ.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★★ سطح التحصيل — مبنيّ لغرضه، لا نسخة مقصوصة من الذمم ★★
--
-- هذه هي الإجابة العملية على المبدأ: موظّف التحصيل لا يُمنح وصولًا جدوليًّا إلى
-- fin_receivables (ولا إلى غيره)، ويُعطى الحدّ الأدنى عبر هذه الدالّة وحدها.
-- قائمة الأعمدة مكتوبة **حرفيًّا** أدناه، فما ليس فيها لا يخرج مهما تغيّر
-- الجدول لاحقًا (select * كان سيسرّب أوّل عمود يُضاف).
--
--   يخرج: العميل · رقم/مرجع الفاتورة · تاريخ الإصدار والاستحقاق · المستحقّ ·
--          الضريبة كحقل مستقلّ · المحصَّل · المتبقّي · الحالة · التقادم ·
--          ملاحظات التحصيل ودفعاته.
--   لا يخرج: أيّ تكلفة · ميزانية · عقد أو قيمته · إيراد معترَف به · اشتراك ·
--          هامش أو ربح · مورّد أو سعره · مركز تكلفة · ملاحظات الذمّة الداخلية
--          (notes قد تحمل تعليقًا عن التكلفة) · معرّف المشروع أو اسمه.
--
-- ملاحظة صريحة عن amount_net: الضريبة حقل مستقلّ في هذا البرنامج، وعرض
-- المستحقّ بلا تفصيل ضريبته يكسر ذلك ويمنع مطابقة سند القبض. وبما أنّ
-- net = gross − vat فالإبقاء عليه لا يضيف تسريبًا. المهمّ أنّ الطرف الآخر من
-- معادلة الهامش (التكلفة) لا يبلغه هذا الدور بأيّ طريق.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_collections_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_totals jsonb;
        v_only_overdue boolean; v_status text; v_q text;
begin
  if not coalesce(public.finops_can_view_collections(), false) then raise exception 'not authorized'; end if;
  v_only_overdue := coalesce(nullif(btrim(coalesce(f->>'only_overdue','')), '')::boolean, false);
  v_status := nullif(btrim(coalesce(f->>'collection_status','')), '');
  v_q      := nullif(btrim(coalesce(f->>'q','')), '');

  select coalesce(jsonb_agg(x order by (x->>'days_overdue')::int desc nulls last), '[]'::jsonb)
    into v_rows from (
    select (jsonb_build_object(
        'id', r.id,
        'doc_no', r.doc_no,                       -- رقم الفاتورة الداخليّ
        'invoice_ref', coalesce(nullif(btrim(coalesce(r.zoho_invoice_id,'')), ''), r.doc_no),
        'title', r.title,
        'client_label', r.client_label,
        'issue_date', r.issue_date,
        'due_date', r.due_date,
        'currency', r.currency,
        'amount_net', r.amount_net,               -- = gross − vat (لا يضيف تسريبًا)
        'vat_amount', r.vat_amount,               -- ★ الضريبة حقل مستقلّ ★
        'amount_due_gross', r.amount_gross,
        'doc_status', r.status,
        'collection_notes', coalesce((select jsonb_agg(jsonb_build_object(
              'id', c.id, 'collected_on', c.collected_on, 'currency', c.currency,
              'amount_net', c.amount_net, 'vat_amount', c.vat_amount,
              'amount_gross', c.amount_gross, 'method', c.method,
              'reference', c.reference, 'note', c.note) order by c.collected_on desc)
            from public.fin_collections c
           where c.receivable_id = r.id and c.is_deleted = false), '[]'::jsonb))
      -- الحالة والمتبقّي والتقادم: مشتقّة من الدفعات، لا أعمدة محفوظة.
      || (public.finops_receivable_state(r.id) - 'found')) as x
    from public.fin_receivables r
    where r.is_deleted = false
      and r.status in ('open','written_off')        -- المسودّة والملغاة ليست عملًا تحصيليًّا
      and (v_q is null
           or r.client_label ilike '%'||v_q||'%'
           or r.doc_no       ilike '%'||v_q||'%'
           or coalesce(r.zoho_invoice_id,'') ilike '%'||v_q||'%')
  ) s
  where ((not v_only_overdue) or coalesce((x->>'is_overdue')::boolean, false))
    and (v_status is null or x->>'collection_status' = v_status);

  select jsonb_build_object(
      'due_gross',        coalesce(round(sum((e->>'gross')::numeric), 2), 0),
      'collected_gross',  coalesce(round(sum((e->>'collected')::numeric), 2), 0),
      'outstanding_gross',coalesce(round(sum((e->>'outstanding')::numeric), 2), 0),
      'overdue_gross',    coalesce(round(sum(case when coalesce((e->>'is_overdue')::boolean, false)
                                                  then (e->>'outstanding')::numeric else 0 end), 2), 0),
      'overdue_count',    coalesce(count(*) filter (where coalesce((e->>'is_overdue')::boolean, false)), 0),
      'open_count',       coalesce(count(*), 0),
      'aging', jsonb_build_object(
        'current', coalesce(round(sum(case when e->>'aging_bucket' = 'current' then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd1_30',   coalesce(round(sum(case when e->>'aging_bucket' = '1_30'   then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd31_60',  coalesce(round(sum(case when e->>'aging_bucket' = '31_60'  then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'd61_90',  coalesce(round(sum(case when e->>'aging_bucket' = '61_90'  then (e->>'outstanding')::numeric else 0 end), 2), 0),
        'over_90', coalesce(round(sum(case when e->>'aging_bucket' = 'over_90' then (e->>'outstanding')::numeric else 0 end), 2), 0)))
    into v_totals
  from jsonb_array_elements(v_rows) e;

  return jsonb_build_object('ok', true, 'rows', v_rows,
    'totals', coalesce(v_totals, jsonb_build_object('due_gross', 0, 'collected_gross', 0,
      'outstanding_gross', 0, 'overdue_gross', 0, 'overdue_count', 0, 'open_count', 0,
      'aging', jsonb_build_object('current', 0, 'd1_30', 0, 'd31_60', 0, 'd61_90', 0, 'over_90', 0))),
    'scope', 'collections_only',
    'note', 'قائمة تحصيل فقط: لا تكاليف ولا ميزانيات ولا ربحية. الحالة والمتبقّي مشتقّان من الدفعات المسجَّلة.');
end $$;

-- ملخّص التحصيل — نفس البوّابة، أرقام تشغيلية بحتة، ولا رقم تكلفة واحد.
create or replace function public.finops_collections_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce(public.finops_can_view_collections(), false) then raise exception 'not authorized'; end if;
  v := public.finops_collections_list(jsonb_build_object());
  return jsonb_build_object('ok', true, 'totals', v->'totals',
    'scope', 'collections_only',
    'note', 'لوحة التحصيل ليست اللوحة المالية: لا مصروف ولا ميزانية ولا هامش.');
end $$;

-- ★ الربحية ★ — أضيق بوّابة. الاستدعاء بلا الوصول الحسّاس يُرفض هنا،
--   لا في الواجهة، ولا يُعاد أيّ رقم إيراد ولو مجمَّعًا.
create or replace function public.finops_profitability(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_from date; v_to date; v_project uuid;
        v_by_project jsonb;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_from    := nullif(btrim(coalesce(f->>'from','')), '')::date;
  v_to      := nullif(btrim(coalesce(f->>'to','')), '')::date;
  v_project := nullif(btrim(coalesce(f->>'project_id','')), '')::uuid;

  select coalesce(jsonb_agg(x order by (x->>'gross_profit_net')::numeric desc nulls last), '[]'::jsonb)
    into v_by_project from (
    select (public.finops_profit_core(p.pid, v_from, v_to)
            || jsonb_build_object('project_label', public.finops_project_label(p.pid))) as x
    from (
      select distinct project_id as pid from public.fin_revenue
       where is_deleted = false and status <> 'cancelled' and project_id is not null
         and (v_project is null or project_id = v_project)
      union
      select distinct project_id from public.fin_costs
       where is_deleted = false and status <> 'void' and project_id is not null
         and (v_project is null or project_id = v_project)
    ) p
  ) s;

  return jsonb_build_object('ok', true,
    'company', public.finops_profit_core(null, v_from, v_to),
    'by_project', v_by_project,
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'contract_no', c.contract_no,
        'title', c.title, 'client_label', c.client_label, 'status', c.status,
        'currency', c.currency, 'amount_net', c.amount_net, 'vat_amount', c.vat_amount,
        'amount_gross', c.amount_gross, 'is_retainer', c.is_retainer,
        'project_id', c.project_id, 'project_label', public.finops_project_label(c.project_id),
        'state', public.finops_contract_state(c.id)) order by c.created_at desc)
      from public.fin_contracts c where c.is_deleted = false
        and (v_project is null or c.project_id = v_project)), '[]'::jsonb),
    'retainers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
        'client_label', t.client_label, 'status', t.status, 'currency', t.currency,
        'amount_net', t.amount_net, 'vat_amount', t.vat_amount, 'amount_gross', t.amount_gross,
        'start_month', t.start_month, 'end_month', t.end_month, 'billing_day', t.billing_day)
        order by t.start_month desc)
      from public.fin_retainers t where t.is_deleted = false), '[]'::jsonb));
end $$;

-- اللوحة — عدّادات المركز. ★ لا تُدرِج الربحية إلّا لمن يملك بوّابتها ★،
-- وتقول صراحةً إنّها محجوبة بدل أن تُعيد أصفارًا تبدو كحقيقة.
create or replace function public.finops_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_from date; v_to date;
        v_out jsonb; v_recv jsonb; v_actual numeric := 0; v_committed numeric := 0;
begin
  if not coalesce(public.finops_can_view_finance_sensitive(), false) then raise exception 'not authorized'; end if;
  v_from := coalesce(nullif(btrim(coalesce(f->>'from','')), '')::date, date_trunc('year', current_date)::date);
  v_to   := coalesce(nullif(btrim(coalesce(f->>'to','')), '')::date, current_date);

  select coalesce(sum(amount_net + vat_amount) filter (where commitment = 'actual'), 0),
         coalesce(sum(amount_net + vat_amount) filter (where commitment = 'committed'), 0)
    into v_actual, v_committed
    from public.fin_costs
   where is_deleted = false and status <> 'void' and incurred_on between v_from and v_to;

  v_recv := public.finops_receivables(jsonb_build_object());

  v_out := jsonb_build_object('ok', true, 'from', v_from, 'to', v_to,
    'counters', jsonb_build_object(
      'actual_cost_gross', round(v_actual, 2),
      'committed_cost_gross', round(v_committed, 2),
      'expense_pending', (select count(*) from public.fin_expense_requests
                           where is_deleted = false and status = 'submitted'),
      'purchase_pending', (select count(*) from public.fin_purchase_requests
                           where is_deleted = false and status = 'submitted'),
      'open_po', (select count(*) from public.fin_purchase_orders
                   where is_deleted = false and status in ('issued','partially_received')),
      'suppliers', (select count(*) from public.fin_suppliers where is_deleted = false and is_active),
      'outstanding_gross', (v_recv->'totals'->>'outstanding_gross')::numeric,
      'overdue_gross', (v_recv->'totals'->>'overdue_gross')::numeric,
      'overdue_count', (v_recv->'totals'->>'overdue_count')::int,
      'budgets_over', (select count(*) from public.fin_budgets b
                        where b.is_deleted = false and b.status = 'active'
                          and coalesce((public.finops_variance_core(b.id)->>'over_budget')::boolean, false))),
    'aging', v_recv->'totals'->'aging',
    'over_budget', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code,
        'title', b.title, 'variance', public.finops_variance_core(b.id)))
      from public.fin_budgets b where b.is_deleted = false and b.status = 'active'
        and coalesce((public.finops_variance_core(b.id)->>'over_budget')::boolean, false)), '[]'::jsonb),
    'pending_expenses', coalesce((select jsonb_agg(jsonb_build_object('id', r.id,
        'request_no', r.request_no, 'title', r.title, 'amount_gross', r.amount_gross,
        'requester_name', (select p.full_name from public.profiles p where p.id = r.requested_by),
        'created_at', r.created_at) order by r.created_at)
      from public.fin_expense_requests r where r.is_deleted = false and r.status = 'submitted'), '[]'::jsonb));

  -- دفاع في العمق: اللوحة نفسها حسّاسة، والحارس هنا يبقى صريحًا كي لا يفتحها
  -- توسيعٌ مستقبليّ لبوّابة اللوحة على الربحية بالتبعية.
  if coalesce(public.finops_can_view_finance_sensitive(), false) then
    v_out := v_out || jsonb_build_object('profit_visible', true,
      'profit', public.finops_profit_core(null, v_from, v_to));
  else
    v_out := v_out || jsonb_build_object('profit_visible', false, 'profit', null,
      'profit_message', 'الربحية والهوامش مقصورة على المالك وحده.');
  end if;
  return v_out;
end $$;

create or replace function public.finops_audit_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb); v_rows jsonb; v_limit int;
begin
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_limit := least(greatest(coalesce(nullif(btrim(coalesce(f->>'limit','')), '')::int, 100), 1), 500);
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', a.id, 'action', a.action, 'entity_type', a.entity_type,
      'entity_id', a.entity_id, 'detail', a.detail, 'created_at', a.created_at,
      'actor_name', (select p.full_name from public.profiles p where p.id = a.actor_id)) as x
    from public.fin_audit a order by a.created_at desc limit v_limit
  ) s;
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- التصدير — مجموعات محدَّدة سلفًا. لا SQL حرّ من الواجهة، والتصدير نفسه
-- واقعة مُدقَّقة: من صدَّر ماذا ومتى يبقى مكتوبًا.
create or replace function public.finops_export(p_dataset text, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_rows jsonb; v_cols jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_dataset is null or p_dataset not in
     ('costs','receivables','collections','collections_queue','budget_lines',
      'expense_requests','purchase_orders','revenue') then
    raise exception 'unknown_dataset';
  end if;
  -- ★ صلاحية التصدير مقسومة ★
  --   collections_queue → قائمة التحصيل وحدها، بمفتاحها المستقلّ.
  --   ما عداها          → تصدير ماليّ شامل ⇒ المالك وحده.
  -- الترتيب مقصود: فحص المجموعة أوّلًا ثمّ البوّابة المناسبة لها، لا بوّابة
  -- واحدة عريضة في الأعلى تفتح كلّ شيء لمن يملك أضيق مفتاح.
  if p_dataset = 'collections_queue' then
    if not coalesce(public.finops_can_export_collections(), false) then
      raise exception 'not authorized';
    end if;
    v_cols := '["invoice_ref","client_label","title","issue_date","due_date","currency","amount_net","vat_amount","amount_due_gross","collection_status","collected","outstanding","days_overdue","aging_bucket"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object(
        'invoice_ref', e->>'invoice_ref', 'client_label', e->>'client_label',
        'title', e->>'title', 'issue_date', e->>'issue_date', 'due_date', e->>'due_date',
        'currency', e->>'currency', 'amount_net', e->>'amount_net', 'vat_amount', e->>'vat_amount',
        'amount_due_gross', e->>'amount_due_gross', 'collection_status', e->>'collection_status',
        'collected', e->>'collected', 'outstanding', e->>'outstanding',
        'days_overdue', e->>'days_overdue', 'aging_bucket', e->>'aging_bucket')), '[]'::jsonb)
      into v_rows
      from jsonb_array_elements((public.finops_collections_list(p_filters))->'rows') e;
    perform public.finops_log('export', 'collections_queue', null,
      jsonb_build_object('rows', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)), 'filters', p_filters));
    return jsonb_build_object('ok', true, 'dataset', p_dataset, 'columns', v_cols,
      'rows', coalesce(v_rows, '[]'::jsonb), 'scope', 'collections_only',
      'note', 'قائمة تحصيل فقط. الضريبة عمود مستقلّ، ولا عمود تكلفة ولا ربح في هذا الملفّ.');
  end if;

  if not coalesce(public.finops_can_export_sensitive(), false) then raise exception 'not authorized'; end if;

  if p_dataset = 'costs' then
    v_cols := '["cost_no","cost_type","commitment","title","incurred_on","currency","amount_net","vat_rate","vat_amount","amount_gross","status"]'::jsonb;
    v_rows := (public.finops_costs_list(p_filters))->'rows';
  elsif p_dataset = 'receivables' then
    v_cols := '["doc_no","title","client_label","issue_date","due_date","currency","amount_net","vat_rate","vat_amount","amount_gross","collection_status","collected","outstanding","days_overdue"]'::jsonb;
    v_rows := (public.finops_receivables(p_filters))->'rows';
  elsif p_dataset = 'collections' then
    v_cols := '["receivable_id","collected_on","currency","amount_net","vat_amount","amount_gross","method","reference"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('receivable_id', c.receivable_id,
        'collected_on', c.collected_on, 'currency', c.currency, 'amount_net', c.amount_net,
        'vat_amount', c.vat_amount, 'amount_gross', c.amount_gross, 'method', c.method,
        'reference', c.reference) order by c.collected_on desc), '[]'::jsonb)
      into v_rows from public.fin_collections c where c.is_deleted = false;
  elsif p_dataset = 'budget_lines' then
    v_cols := '["budget_code","label","amount_net","vat_amount","amount_gross"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('budget_code', b.code, 'label', l.label,
        'amount_net', l.amount_net, 'vat_amount', l.vat_amount, 'amount_gross', l.amount_gross)
        order by b.code, l.label), '[]'::jsonb)
      into v_rows from public.fin_budget_lines l join public.fin_budgets b on b.id = l.budget_id
      where l.is_deleted = false and b.is_deleted = false;
  elsif p_dataset = 'expense_requests' then
    v_cols := '["request_no","title","status","spent_on","currency","amount_net","vat_rate","vat_amount","amount_gross","requester_name"]'::jsonb;
    v_rows := (public.finops_expense_requests_list(p_filters))->'rows';
  elsif p_dataset = 'purchase_orders' then
    v_cols := '["po_no","status","issue_date","currency","amount_net","vat_amount","amount_gross","supplier"]'::jsonb;
    v_rows := (public.finops_purchase_list(p_filters))->'purchase_orders';
  else -- revenue
    v_cols := '["revenue_no","revenue_type","title","recognized_on","currency","amount_net","vat_rate","vat_amount","amount_gross","status"]'::jsonb;
    select coalesce(jsonb_agg(jsonb_build_object('revenue_no', r.revenue_no, 'revenue_type', r.revenue_type,
        'title', r.title, 'recognized_on', r.recognized_on, 'currency', r.currency,
        'amount_net', r.amount_net, 'vat_rate', r.vat_rate, 'vat_amount', r.vat_amount,
        'amount_gross', r.amount_gross, 'status', r.status) order by r.recognized_on desc), '[]'::jsonb)
      into v_rows from public.fin_revenue r where r.is_deleted = false;
  end if;

  perform public.finops_log('export', p_dataset, null,
    jsonb_build_object('rows', jsonb_array_length(coalesce(v_rows, '[]'::jsonb)), 'filters', p_filters));
  return jsonb_build_object('ok', true, 'dataset', p_dataset, 'columns', v_cols,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'note', 'الضريبة عمود مستقلّ في كلّ تصدير ولا تُطوى داخل الإجمالي.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ★ تشخيص Zoho Books — صادق بالبناء ★
-- لا يقرأ سرًّا، ولا يفتح اتصالًا، ولا يستطيع أن يقول «متّصل»: القيمة connected
-- مكتوبة false حرفيًّا في جسم الدالّة. التكامل غير مبنيّ، وهذا ما تقوله الشاشة.
-- التفاصيل في docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.finops_zoho_diagnostic()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pending int := 0; v_failed int := 0; v_held int := 0;
begin
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status = 'held')
    into v_pending, v_failed, v_held from public.fin_zoho_outbox;
  return jsonb_build_object(
    'ok', true,
    'connected', false,
    'integration_state', 'not_built',
    'live_sync_attempted', false,
    'credentials_read', false,
    'outbox', jsonb_build_object('pending', v_pending, 'failed', v_failed, 'held', v_held,
      'delivered', 0, 'note', 'لا حالة اسمها sent في هذا الجدول: لا صفّ يستطيع ادّعاء الإرسال.'),
    'checks', jsonb_build_array(
      jsonb_build_object('key','outbox_table','status','present','detail','fin_zoho_outbox موجود ويستقبل الأحداث.'),
      jsonb_build_object('key','worker','status','absent','detail','لا عامل ولا cron يقرأ الصادر — بالتصميم.'),
      jsonb_build_object('key','credentials','status','not_checked','detail','لا تُقرأ بيانات اعتماد من قاعدة البيانات إطلاقًا.'),
      jsonb_build_object('key','outbound_call','status','never','detail','لا توجد أيّ مكالمة شبكية خارجية في هذه الحزمة.')),
    'message', 'تكامل Zoho Books غير مبنيّ. ما يظهر هنا حالة صندوق صادر محلّيّ فقط، ولا يعني أيّ اتصال.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) الكتابة — كلّها SECURITY DEFINER، كلّها مُبوَّبة، كلّها مُدقَّقة.
--     لا سياسة كتابة على أيّ جدول، فهذه الدوالّ هي المدخل الوحيد.
--     كلّ مبلغ يمرّ بـfinops_money، فلا يدخل إجماليّ يُخفي الضريبة.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── المراجع الأساسية ──────────────────────────────────────────────────────
create or replace function public.finops_cost_center_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_cost_centers as t (id, code, name_ar, name_en, kind, parent_id,
    owner_user_id, notes, is_active, created_by)
  values (v_id,
    upper(btrim(coalesce(nullif(btrim(coalesce(p->>'code','')), ''), 'CC-' || substr(v_id::text, 1, 6)))),
    btrim(coalesce(p->>'name_ar','')), nullif(btrim(coalesce(p->>'name_en','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'kind','')), ''), 'department'),
    nullif(btrim(coalesce(p->>'parent_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'owner_user_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'notes','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'is_active','')), '')::boolean, true), auth.uid())
  on conflict (id) do update set
    code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en,
    kind = excluded.kind, parent_id = excluded.parent_id, owner_user_id = excluded.owner_user_id,
    notes = excluded.notes, is_active = excluded.is_active, updated_at = now(), is_deleted = false;
  -- دورة في شجرة مراكز التكلفة تُجمّد أيّ تجميع لاحق — تُمنع صراحةً.
  -- ⚠️ حدّ العمق ليس تجميلًا: بلا حدٍّ يدور الاستعلام إلى الأبد على شجرة فيها
  --    دورة، لأنّ Postgres لا يكتشف الدورات في CTE العوديّ من تلقائه.
  if exists (with recursive up(id, parent_id, depth) as (
       select c.id, c.parent_id, 0 from public.fin_cost_centers c where c.id = v_id
       union all
       select c.id, c.parent_id, up.depth + 1
         from public.fin_cost_centers c join up on c.id = up.parent_id
        where up.depth < 20
     ) select 1 from up where up.parent_id = v_id) then
    raise exception 'cycle_detected';
  end if;
  perform public.finops_log('cost_center_upsert', 'fin_cost_centers', v_id, jsonb_build_object('code', p->>'code'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.finops_category_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_expense_categories as t (id, key, name_ar, name_en, cost_nature,
    is_capex, default_vat_rate, sort_order, is_active, created_by)
  values (v_id,
    lower(btrim(coalesce(nullif(btrim(coalesce(p->>'key','')), ''), 'cat_' || substr(v_id::text, 1, 6)))),
    btrim(coalesce(p->>'name_ar','')), nullif(btrim(coalesce(p->>'name_en','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'cost_nature','')), ''), 'other'),
    coalesce(nullif(btrim(coalesce(p->>'is_capex','')), '')::boolean, false),
    coalesce(nullif(btrim(coalesce(p->>'default_vat_rate','')), '')::numeric, 15),
    coalesce(nullif(btrim(coalesce(p->>'sort_order','')), '')::int, 100),
    coalesce(nullif(btrim(coalesce(p->>'is_active','')), '')::boolean, true), auth.uid())
  on conflict (id) do update set
    key = excluded.key, name_ar = excluded.name_ar, name_en = excluded.name_en,
    cost_nature = excluded.cost_nature, is_capex = excluded.is_capex,
    default_vat_rate = excluded.default_vat_rate, sort_order = excluded.sort_order,
    is_active = excluded.is_active, updated_at = now(), is_deleted = false;
  perform public.finops_log('category_upsert', 'fin_expense_categories', v_id, jsonb_build_object('key', p->>'key'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.finops_supplier_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_bank text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_bank := nullif(btrim(coalesce(p->>'bank_ref','')), '');
  -- ★ لا رقم حساب كامل في القاعدة ★: أيّ سلسلة تشبه IBAN أو رقم حساب تُرفض،
  --   فتسريب جدول المورّدين لا يسلّم بيانات دفع صالحة للاستعمال.
  if v_bank is not null and (v_bank ~* '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,}$' or v_bank ~ '[0-9]{10,}') then
    raise exception 'bank_ref_too_sensitive';
  end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_suppliers as t (id, code, name, legal_name, supplier_type, vat_number,
    cr_number, contact_name, phone, email, city, country, payment_terms_days, bank_ref, rating,
    notes, is_active, created_by)
  values (v_id,
    upper(btrim(coalesce(nullif(btrim(coalesce(p->>'code','')), ''), 'SUP-' || substr(v_id::text, 1, 6)))),
    btrim(coalesce(p->>'name','')), nullif(btrim(coalesce(p->>'legal_name','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'supplier_type','')), ''), 'company'),
    nullif(btrim(coalesce(p->>'vat_number','')), ''), nullif(btrim(coalesce(p->>'cr_number','')), ''),
    nullif(btrim(coalesce(p->>'contact_name','')), ''), nullif(btrim(coalesce(p->>'phone','')), ''),
    nullif(btrim(coalesce(p->>'email','')), ''), nullif(btrim(coalesce(p->>'city','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'country','')), ''), 'SA'),
    coalesce(nullif(btrim(coalesce(p->>'payment_terms_days','')), '')::int, 0),
    v_bank, nullif(btrim(coalesce(p->>'rating','')), '')::int,
    nullif(btrim(coalesce(p->>'notes','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'is_active','')), '')::boolean, true), auth.uid())
  -- حمولة جزئية لا تمحو عمودًا (انظر التعليق في finops_cost_upsert).
  on conflict (id) do update set
    code = excluded.code, name = excluded.name,
    legal_name   = coalesce(excluded.legal_name,   t.legal_name),
    supplier_type = excluded.supplier_type,
    vat_number   = coalesce(excluded.vat_number,   t.vat_number),
    cr_number    = coalesce(excluded.cr_number,    t.cr_number),
    contact_name = coalesce(excluded.contact_name, t.contact_name),
    phone        = coalesce(excluded.phone,        t.phone),
    email        = coalesce(excluded.email,        t.email),
    city         = coalesce(excluded.city,         t.city),
    country = excluded.country,
    payment_terms_days = excluded.payment_terms_days,
    bank_ref     = coalesce(excluded.bank_ref,     t.bank_ref),
    rating       = coalesce(excluded.rating,       t.rating),
    notes        = coalesce(excluded.notes,        t.notes),
    is_active = excluded.is_active,
    updated_at = now(), is_deleted = false;
  perform public.finops_log('supplier_upsert', 'fin_suppliers', v_id, jsonb_build_object('name', p->>'name'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ★ حدود الاعتماد يضبطها المالك وحده ★ — لو ضبطها من يعتمد لرفع سقفه بنفسه،
--   وهي أوّل ثغرة يبحث عنها أيّ مراجع. هذه ليست تشدّدًا زائدًا بل جوهر الضابط.
create or replace function public.finops_threshold_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_scope text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    raise exception 'not authorized';
  end if;
  v_scope := coalesce(nullif(btrim(coalesce(p->>'scope','')), ''), 'expense');
  if v_scope not in ('expense','purchase') then raise exception 'invalid_scope'; end if;
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_approval_thresholds as t (id, scope, category_id, cost_center_id,
    min_amount, max_amount, required_role, requires_second_approval, notes, is_active, created_by)
  values (v_id, v_scope,
    nullif(btrim(coalesce(p->>'category_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    coalesce(nullif(btrim(coalesce(p->>'min_amount','')), '')::numeric, 0),
    nullif(btrim(coalesce(p->>'max_amount','')), '')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'required_role','')), ''), 'finance'),
    coalesce(nullif(btrim(coalesce(p->>'requires_second_approval','')), '')::boolean, false),
    nullif(btrim(coalesce(p->>'notes','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'is_active','')), '')::boolean, true), auth.uid())
  on conflict (id) do update set
    scope = excluded.scope, category_id = excluded.category_id, cost_center_id = excluded.cost_center_id,
    min_amount = excluded.min_amount, max_amount = excluded.max_amount,
    required_role = excluded.required_role,
    requires_second_approval = excluded.requires_second_approval,
    notes = excluded.notes, is_active = excluded.is_active, updated_at = now(), is_deleted = false;
  perform public.finops_log('threshold_upsert', 'fin_approval_thresholds', v_id, p - 'notes');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─── الميزانيات ────────────────────────────────────────────────────────────
create or replace function public.finops_budget_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_status text; v_old text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_status := coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'draft');
  if v_status not in ('draft','active','locked','closed') then raise exception 'invalid_status'; end if;
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select status into v_old from public.fin_budgets where id = v_id and is_deleted = false;
    if v_old is null then raise exception 'row_not_found'; end if;
    -- ميزانية مُقفَلة/مُغلَقة لا تُعاد فتحها إلّا بيد المالك: القفل ضابط لا زينة.
    if v_old in ('locked','closed') and v_status <> v_old
       and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
      raise exception 'budget_locked';
    end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_budgets as t (id, code, title, scope, fiscal_year, period_start, period_end,
    cost_center_id, project_id, currency, status, notes, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'code','')), ''), public.finops_next_code('BUD')),
    btrim(coalesce(p->>'title','')),
    coalesce(nullif(btrim(coalesce(p->>'scope','')), ''), 'cost_center'),
    nullif(btrim(coalesce(p->>'fiscal_year','')), '')::int,
    nullif(btrim(coalesce(p->>'period_start','')), '')::date,
    nullif(btrim(coalesce(p->>'period_end','')), '')::date,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    v_status, nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  -- حمولة جزئية لا تمحو عمودًا (انظر التعليق في finops_cost_upsert).
  on conflict (id) do update set
    title = excluded.title, scope = excluded.scope,
    fiscal_year    = coalesce(excluded.fiscal_year,    t.fiscal_year),
    period_start   = coalesce(excluded.period_start,   t.period_start),
    period_end     = coalesce(excluded.period_end,     t.period_end),
    cost_center_id = coalesce(excluded.cost_center_id, t.cost_center_id),
    project_id     = coalesce(excluded.project_id,     t.project_id),
    currency = excluded.currency, status = excluded.status,
    notes          = coalesce(excluded.notes,          t.notes),
    updated_at = now(), is_deleted = false;
  perform public.finops_log('budget_upsert', 'fin_budgets', v_id, jsonb_build_object('status', v_status));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.finops_budget_line_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_budget uuid; m jsonb; v_bstatus text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_budget := nullif(btrim(coalesce(p->>'budget_id','')), '')::uuid;
  if v_budget is null then raise exception 'budget_required'; end if;
  select status into v_bstatus from public.fin_budgets where id = v_budget and is_deleted = false;
  if v_bstatus is null then raise exception 'row_not_found'; end if;
  if v_bstatus in ('locked','closed') then raise exception 'budget_locked'; end if;
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_budget_lines as t (id, budget_id, category_id, cost_center_id, label,
    amount_net, vat_rate, vat_amount, note, created_by)
  values (v_id, v_budget,
    nullif(btrim(coalesce(p->>'category_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    btrim(coalesce(p->>'label','')),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    nullif(btrim(coalesce(p->>'note','')), ''), auth.uid())
  on conflict (id) do update set
    category_id = excluded.category_id, cost_center_id = excluded.cost_center_id,
    label = excluded.label, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, note = excluded.note, updated_at = now(), is_deleted = false;
  perform public.finops_log('budget_line_upsert', 'fin_budget_lines', v_id,
    jsonb_build_object('budget_id', v_budget, 'net', m->>'amount_net', 'vat', m->>'vat_amount'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

-- ─── العقود · الإيراد · الاشتراكات (بوّابة الهامش) ─────────────────────────
create or replace function public.finops_contract_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_contracts as t (id, contract_no, title, client_label, client_id, project_id,
    cost_center_id, signed_on, start_date, end_date, currency, amount_net, vat_rate, vat_amount,
    is_retainer, status, notes, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'contract_no','')), ''), public.finops_next_code('CON')),
    btrim(coalesce(p->>'title','')), nullif(btrim(coalesce(p->>'client_label','')), ''),
    nullif(btrim(coalesce(p->>'client_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'signed_on','')), '')::date,
    nullif(btrim(coalesce(p->>'start_date','')), '')::date,
    nullif(btrim(coalesce(p->>'end_date','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'is_retainer','')), '')::boolean, false),
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'draft'),
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  on conflict (id) do update set
    title = excluded.title, client_label = excluded.client_label, client_id = excluded.client_id,
    project_id = excluded.project_id, cost_center_id = excluded.cost_center_id,
    signed_on = excluded.signed_on, start_date = excluded.start_date, end_date = excluded.end_date,
    currency = excluded.currency, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, is_retainer = excluded.is_retainer, status = excluded.status,
    notes = excluded.notes, updated_at = now(), is_deleted = false;
  perform public.finops_log('contract_upsert', 'fin_contracts', v_id, jsonb_build_object('net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m,
    'state', public.finops_contract_state(v_id));
end $$;

create or replace function public.finops_revenue_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_revenue as t (id, revenue_no, revenue_type, contract_id, project_id,
    cost_center_id, client_label, title, recognized_on, currency, amount_net, vat_rate, vat_amount,
    source, zoho_reference, status, notes, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'revenue_no','')), ''), public.finops_next_code('REV')),
    coalesce(nullif(btrim(coalesce(p->>'revenue_type','')), ''), 'contract'),
    nullif(btrim(coalesce(p->>'contract_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'client_label','')), ''), btrim(coalesce(p->>'title','')),
    coalesce(nullif(btrim(coalesce(p->>'recognized_on','')), '')::date, current_date),
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'source','')), ''), 'manual'),
    nullif(btrim(coalesce(p->>'zoho_reference','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'expected'),
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  on conflict (id) do update set
    revenue_type = excluded.revenue_type, contract_id = excluded.contract_id,
    project_id = excluded.project_id, cost_center_id = excluded.cost_center_id,
    client_label = excluded.client_label, title = excluded.title,
    recognized_on = excluded.recognized_on, currency = excluded.currency,
    amount_net = excluded.amount_net, vat_rate = excluded.vat_rate, vat_amount = excluded.vat_amount,
    source = excluded.source, zoho_reference = excluded.zoho_reference, status = excluded.status,
    notes = excluded.notes, updated_at = now(), is_deleted = false;
  perform public.finops_log('revenue_upsert', 'fin_revenue', v_id, jsonb_build_object('net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

create or replace function public.finops_retainer_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_retainers as t (id, contract_id, title, client_label, project_id,
    cost_center_id, currency, amount_net, vat_rate, vat_amount, start_month, end_month,
    billing_day, status, notes, created_by)
  values (v_id,
    nullif(btrim(coalesce(p->>'contract_id','')), '')::uuid, btrim(coalesce(p->>'title','')),
    nullif(btrim(coalesce(p->>'client_label','')), ''),
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'start_month','')), '')::date, date_trunc('month', current_date)::date),
    nullif(btrim(coalesce(p->>'end_month','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'billing_day','')), '')::int, 1),
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'active'),
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  on conflict (id) do update set
    contract_id = excluded.contract_id, title = excluded.title, client_label = excluded.client_label,
    project_id = excluded.project_id, cost_center_id = excluded.cost_center_id,
    currency = excluded.currency, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, start_month = excluded.start_month, end_month = excluded.end_month,
    billing_day = excluded.billing_day, status = excluded.status, notes = excluded.notes,
    updated_at = now(), is_deleted = false;
  perform public.finops_log('retainer_upsert', 'fin_retainers', v_id, jsonb_build_object('net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

-- ─── الذمم · الدفعات · التحصيل ─────────────────────────────────────────────
create or replace function public.finops_receivable_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb; v_coll numeric := 0;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  m := public.finops_money(p, 15);
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select coalesce(sum(amount_net + vat_amount), 0) into v_coll
      from public.fin_collections where receivable_id = v_id and is_deleted = false;
    -- خفض قيمة ذمّة تحتها تحصيل فعليّ يخلق «محصَّل أكثر من المستحقّ» — يُمنع.
    if v_coll > (m->>'amount_gross')::numeric then raise exception 'below_collected'; end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_receivables as t (id, doc_no, contract_id, project_id, cost_center_id,
    client_label, client_id, title, issue_date, due_date, currency, amount_net, vat_rate,
    vat_amount, source, zoho_invoice_id, status, notes, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'doc_no','')), ''), public.finops_next_code('AR')),
    nullif(btrim(coalesce(p->>'contract_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'client_label','')), ''),
    nullif(btrim(coalesce(p->>'client_id','')), '')::uuid,
    btrim(coalesce(p->>'title','')),
    coalesce(nullif(btrim(coalesce(p->>'issue_date','')), '')::date, current_date),
    nullif(btrim(coalesce(p->>'due_date','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'source','')), ''), 'manual'),
    nullif(btrim(coalesce(p->>'zoho_invoice_id','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'open'),
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  -- حمولة جزئية لا تمحو عمودًا (انظر التعليق في finops_cost_upsert).
  on conflict (id) do update set
    contract_id     = coalesce(excluded.contract_id,     t.contract_id),
    project_id      = coalesce(excluded.project_id,      t.project_id),
    cost_center_id  = coalesce(excluded.cost_center_id,  t.cost_center_id),
    client_label    = coalesce(excluded.client_label,    t.client_label),
    client_id       = coalesce(excluded.client_id,       t.client_id),
    title = excluded.title, issue_date = excluded.issue_date,
    due_date        = coalesce(excluded.due_date,        t.due_date),
    currency = excluded.currency, amount_net = excluded.amount_net,
    vat_rate = excluded.vat_rate, vat_amount = excluded.vat_amount, source = excluded.source,
    zoho_invoice_id = coalesce(excluded.zoho_invoice_id, t.zoho_invoice_id),
    status = excluded.status,
    notes           = coalesce(excluded.notes,           t.notes),
    updated_at = now(), is_deleted = false;
  perform public.finops_log('receivable_upsert', 'fin_receivables', v_id,
    jsonb_build_object('net', m->>'amount_net', 'vat', m->>'vat_amount'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m, 'state', public.finops_receivable_state(v_id));
end $$;

create or replace function public.finops_collection_record(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_recv uuid; m jsonb;
        v_state jsonb; v_outstanding numeric; v_self numeric := 0; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  -- ★ تسجيل التحصيل هو الكتابة الوحيدة المتاحة لدور التحصيل ★
  if not coalesce(public.finops_can_record_collection(), false) then raise exception 'not authorized'; end if;
  v_recv := nullif(btrim(coalesce(p->>'receivable_id','')), '')::uuid;
  if v_recv is null then raise exception 'receivable_required'; end if;
  v_state := public.finops_receivable_state(v_recv);
  if coalesce((v_state->>'found')::boolean, false) is not true then raise exception 'row_not_found'; end if;
  m := public.finops_money(p, 15);
  v_outstanding := (v_state->>'outstanding')::numeric;
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    -- الصفّ المُعدَّل يجب أن يتبع هذه الذمّة: تمرير معرّف من ذمّة أخرى كان
    -- سيعدّل صفًّا لا علاقة له بالحساب الذي جرى التحقّق عليه.
    select receivable_id into v_owner from public.fin_collections
     where id = v_id and is_deleted = false;
    if v_owner is not null and v_owner <> v_recv then raise exception 'row_not_found'; end if;
    -- ★ عند التعديل يُستبعد أثر الصفّ نفسه ★: المتبقّي المحسوب يتضمّن مبلغه
    --   القديم، فقياس المبلغ الجديد عليه كان يسمح برفع تحصيل فوق المستحقّ.
    select coalesce(sum(amount_net + vat_amount), 0) into v_self
      from public.fin_collections
     where id = v_id and receivable_id = v_recv and is_deleted = false;
    v_outstanding := v_outstanding + v_self;
  end if;
  -- تحصيل يتجاوز المتبقّي = خطأ إدخال يخلق رصيدًا سالبًا. يُرفض برسالة مفهومة
  -- قبل أن يصير رقمًا في لوحة أحدهم — عند الإنشاء وعند التعديل معًا.
  if (m->>'amount_gross')::numeric > v_outstanding + 0.009 then
    return jsonb_build_object('ok', false, 'reason','exceeds_outstanding',
      'outstanding', v_outstanding,
      'message','مبلغ التحصيل أكبر من المتبقّي على هذه الذمّة.');
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_collections as t (id, receivable_id, collected_on, currency, amount_net,
    vat_rate, vat_amount, method, reference, note, recorded_by)
  values (v_id, v_recv,
    coalesce(nullif(btrim(coalesce(p->>'collected_on','')), '')::date, current_date),
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'method','')), ''), 'bank_transfer'),
    nullif(btrim(coalesce(p->>'reference','')), ''), nullif(btrim(coalesce(p->>'note','')), ''),
    auth.uid())
  on conflict (id) do update set
    collected_on = excluded.collected_on, currency = excluded.currency,
    amount_net = excluded.amount_net, vat_rate = excluded.vat_rate, vat_amount = excluded.vat_amount,
    method = excluded.method, reference = excluded.reference, note = excluded.note,
    updated_at = now(), is_deleted = false;
  perform public.finops_log('collection_record', 'fin_collections', v_id,
    jsonb_build_object('receivable_id', v_recv, 'gross', m->>'amount_gross'));
  return jsonb_build_object('ok', true, 'id', v_id, 'state', public.finops_receivable_state(v_recv));
end $$;

create or replace function public.finops_milestone_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_payment_milestones as t (id, contract_id, project_id, title, sort_order,
    due_on, currency, amount_net, vat_rate, vat_amount, status, receivable_id, notes, created_by)
  values (v_id,
    nullif(btrim(coalesce(p->>'contract_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    btrim(coalesce(p->>'title','')),
    coalesce(nullif(btrim(coalesce(p->>'sort_order','')), '')::int, 100),
    nullif(btrim(coalesce(p->>'due_on','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'planned'),
    nullif(btrim(coalesce(p->>'receivable_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  on conflict (id) do update set
    contract_id = excluded.contract_id, project_id = excluded.project_id, title = excluded.title,
    sort_order = excluded.sort_order, due_on = excluded.due_on, currency = excluded.currency,
    amount_net = excluded.amount_net, vat_rate = excluded.vat_rate, vat_amount = excluded.vat_amount,
    status = excluded.status, receivable_id = excluded.receivable_id, notes = excluded.notes,
    updated_at = now(), is_deleted = false;
  perform public.finops_log('milestone_upsert', 'fin_payment_milestones', v_id, jsonb_build_object('net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

-- ─── دفتر التكلفة ──────────────────────────────────────────────────────────
create or replace function public.finops_cost_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb; v_commit text; v_type text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_commit := coalesce(nullif(btrim(coalesce(p->>'commitment','')), ''), 'actual');
  if v_commit not in ('committed','actual') then raise exception 'invalid_commitment'; end if;
  v_type := coalesce(nullif(btrim(coalesce(p->>'cost_type','')), ''), 'other');
  m := public.finops_money(p, 15);
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_costs as t (id, cost_no, cost_type, commitment, category_id, cost_center_id,
    budget_id, budget_line_id, project_id, supplier_id, person_user_id, person_label,
    source_kind, source_id, title, description, incurred_on, currency, amount_net, vat_rate,
    vat_amount, status, notes, created_by)
  values (v_id,
    coalesce(nullif(btrim(coalesce(p->>'cost_no','')), ''), public.finops_next_code('COST')),
    v_type, v_commit,
    nullif(btrim(coalesce(p->>'category_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_line_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'supplier_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'person_user_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'person_label','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'source_kind','')), ''), 'manual'),
    nullif(btrim(coalesce(p->>'source_id','')), '')::uuid,
    btrim(coalesce(p->>'title','')), nullif(btrim(coalesce(p->>'description','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'incurred_on','')), '')::date, current_date),
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'confirmed'),
    nullif(btrim(coalesce(p->>'notes','')), ''), auth.uid())
  -- ★ حمولة جزئية لا تمحو عمودًا ★ — شاشة التعديل تُغذَّى من صفّ قائمة لا يحمل
  --   كلّ الأعمدة (القائمة تعيد اسم البند لا معرّفه مثلًا). بلا coalesce كان
  --   تعديل مبلغ تكلفة يمسح مركزها وميزانيتها ومورّدها بصمت. المقابل المقبول:
  --   لا يمكن **تفريغ** حقل بإرسال فراغ — والتفريغ الصامت أخطر من بقاء قيمة.
  on conflict (id) do update set
    cost_type = excluded.cost_type, commitment = excluded.commitment,
    category_id    = coalesce(excluded.category_id,    t.category_id),
    cost_center_id = coalesce(excluded.cost_center_id, t.cost_center_id),
    budget_id      = coalesce(excluded.budget_id,      t.budget_id),
    budget_line_id = coalesce(excluded.budget_line_id, t.budget_line_id),
    project_id     = coalesce(excluded.project_id,     t.project_id),
    supplier_id    = coalesce(excluded.supplier_id,    t.supplier_id),
    person_user_id = coalesce(excluded.person_user_id, t.person_user_id),
    person_label   = coalesce(excluded.person_label,   t.person_label),
    source_kind = excluded.source_kind,
    source_id      = coalesce(excluded.source_id,      t.source_id),
    title = excluded.title,
    description    = coalesce(excluded.description,    t.description),
    incurred_on = excluded.incurred_on, currency = excluded.currency, amount_net = excluded.amount_net,
    vat_rate = excluded.vat_rate, vat_amount = excluded.vat_amount, status = excluded.status,
    notes          = coalesce(excluded.notes,          t.notes),
    updated_at = now(), is_deleted = false;
  perform public.finops_log('cost_upsert', 'fin_costs', v_id,
    jsonb_build_object('commitment', v_commit, 'type', v_type, 'net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

-- ─── طلب الصرف: يرفعه صاحبه، ويعتمده غيره ─────────────────────────────────
-- ★ requested_by = auth.uid() دائمًا ★ ولا يُقرأ من الحمولة إطلاقًا: قبول هويّة
--   مُرسِلة من الواجهة يعني رفع طلب باسم موظّف آخر.
create or replace function public.finops_expense_request_submit(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb; v_status text; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_request(), false) then raise exception 'not authorized'; end if;
  v_status := coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'submitted');
  if v_status not in ('draft','submitted') then raise exception 'invalid_status'; end if;
  m := public.finops_money(p, 15);
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select requested_by into v_owner from public.fin_expense_requests
     where id = v_id and is_deleted = false;
    if v_owner is null then raise exception 'row_not_found'; end if;
    if v_owner <> auth.uid() then raise exception 'not authorized'; end if;   -- طلب غيرك لا يُحرَّر
    if exists (select 1 from public.fin_expense_requests
                where id = v_id and status not in ('draft','submitted')) then
      return jsonb_build_object('ok', false, 'reason','already_decided',
        'message','هذا الطلب خرج من يدك بعد صدور قرار فيه.');
    end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_expense_requests as t (id, request_no, requested_by, category_id,
    cost_center_id, budget_id, budget_line_id, project_id, supplier_id, title, description,
    spent_on, currency, amount_net, vat_rate, vat_amount, status, submitted_at)
  values (v_id, public.finops_next_code('EXP'), auth.uid(),
    nullif(btrim(coalesce(p->>'category_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_line_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'supplier_id','')), '')::uuid,
    btrim(coalesce(p->>'title','')), nullif(btrim(coalesce(p->>'description','')), ''),
    coalesce(nullif(btrim(coalesce(p->>'spent_on','')), '')::date, current_date),
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    v_status, case when v_status = 'submitted' then now() else null end)
  on conflict (id) do update set
    category_id = excluded.category_id, cost_center_id = excluded.cost_center_id,
    budget_id = excluded.budget_id, budget_line_id = excluded.budget_line_id,
    project_id = excluded.project_id, supplier_id = excluded.supplier_id,
    title = excluded.title, description = excluded.description, spent_on = excluded.spent_on,
    currency = excluded.currency, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, status = excluded.status,
    submitted_at = case when excluded.status = 'submitted' then coalesce(t.submitted_at, now()) else null end,
    updated_at = now();
  if v_status = 'submitted' then
    insert into public.fin_expense_approvals (request_id, step, actor_id, action, amount_gross_at_action)
    values (v_id, 1, auth.uid(), 'submitted', (m->>'amount_gross')::numeric);
  end if;
  perform public.finops_log('expense_submit', 'fin_expense_requests', v_id,
    jsonb_build_object('status', v_status, 'gross', m->>'amount_gross'));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'money', m);
end $$;

-- الاعتماد — الضابط الحقيقيّ: لا اعتماد ذاتيّ، وسقف الاعتماد يُفرض هنا.
create or replace function public.finops_expense_decide(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_th jsonb; v_cost uuid; v_nature text; v_step int;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_approve_expense(), false) then raise exception 'not authorized'; end if;
  if p_action is null or p_action not in ('approved','rejected','returned') then
    raise exception 'invalid_action';
  end if;
  if p_action in ('rejected','returned') and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'reason_required';
  end if;

  select * into r from public.fin_expense_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'row_not_found'; end if;
  if r.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason','not_pending',
      'message','هذا الطلب ليس في انتظار قرار.');
  end if;
  -- ★ فصل المهامّ ★: لا أحد يعتمد طلبه هو. المالك استثناء مُسجَّل في التدقيق
  --   لا استثناء صامت، لأنّه صاحب المال في النهاية.
  if r.requested_by = auth.uid()
     and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    raise exception 'self_approval_forbidden';
  end if;

  v_th := public.finops_threshold_for('expense', r.amount_gross, r.category_id, r.cost_center_id);
  if p_action = 'approved' and coalesce(v_th->>'required_role','owner') = 'owner'
     and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    return jsonb_build_object('ok', false, 'reason','threshold_exceeded',
      'threshold', v_th,
      'message', coalesce(v_th->>'message', 'هذا المبلغ يتجاوز سقف اعتمادك ويتطلّب اعتماد المالك.'));
  end if;

  select coalesce(max(step), 1) + 1 into v_step from public.fin_expense_approvals where request_id = p_id;
  insert into public.fin_expense_approvals (request_id, step, actor_id, action, note, amount_gross_at_action)
  values (p_id, least(v_step, 5), auth.uid(), p_action, nullif(btrim(coalesce(p_note, '')), ''), r.amount_gross);

  if p_action = 'approved' then
    -- الاعتماد يولّد **التزامًا** لا تكلفة واقعة: المال لم يُصرَف بعد.
    select cost_nature into v_nature from public.fin_expense_categories where id = r.category_id;
    insert into public.fin_costs (cost_no, cost_type, commitment, category_id, cost_center_id,
      budget_id, budget_line_id, project_id, supplier_id, person_user_id, source_kind, source_id,
      title, incurred_on, currency, amount_net, vat_rate, vat_amount, status, created_by)
    values (public.finops_next_code('COST'), coalesce(v_nature, 'other'), 'committed', r.category_id,
      r.cost_center_id, r.budget_id, r.budget_line_id, r.project_id, r.supplier_id, r.requested_by,
      'expense_request', r.id, r.title, r.spent_on, r.currency, r.amount_net, r.vat_rate,
      r.vat_amount, 'confirmed', auth.uid())
    returning id into v_cost;

    update public.fin_expense_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(btrim(coalesce(p_note, '')), ''),
           needs_second_approval = coalesce((v_th->>'requires_second')::boolean, false),
           cost_id = v_cost, updated_at = now()
     where id = p_id;
  else
    update public.fin_expense_requests
       set status = case when p_action = 'rejected' then 'rejected' else 'draft' end,
           decided_by = auth.uid(), decided_at = now(),
           decision_note = btrim(p_note), updated_at = now()
     where id = p_id;
  end if;

  perform public.finops_log('expense_decide', 'fin_expense_requests', p_id,
    jsonb_build_object('action', p_action, 'gross', r.amount_gross, 'threshold', v_th,
      'self_approved', (r.requested_by = auth.uid()), 'cost_id', v_cost));
  return jsonb_build_object('ok', true, 'id', p_id, 'action', p_action, 'cost_id', v_cost,
    'threshold', v_th);
end $$;

create or replace function public.finops_expense_mark_paid(p_id uuid, p_paid_on date default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  select * into r from public.fin_expense_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'row_not_found'; end if;
  if r.status <> 'approved' then
    return jsonb_build_object('ok', false, 'reason','not_approved',
      'message','لا يُصرَف طلب لم يُعتمد.');
  end if;
  if r.needs_second_approval and r.second_decided_by is null then
    return jsonb_build_object('ok', false, 'reason','second_approval_required',
      'message','هذا المبلغ يتطلّب اعتمادًا ثانيًا قبل الصرف.');
  end if;
  -- ★ هنا فقط يصير الالتزام تكلفة فعلية ★ — لا صفّ جديد، بل تحويل الصفّ نفسه،
  --   فلا يُحتسب المبلغ مرّتين في الانحراف.
  if r.cost_id is not null then
    update public.fin_costs set commitment = 'actual',
           incurred_on = coalesce(p_paid_on, incurred_on), updated_at = now()
     where id = r.cost_id and is_deleted = false;
  end if;
  update public.fin_expense_requests
     set status = 'paid', paid_on = coalesce(p_paid_on, current_date), updated_at = now()
   where id = p_id;
  insert into public.fin_expense_approvals (request_id, step, actor_id, action, amount_gross_at_action)
  values (p_id, 5, auth.uid(), 'paid', r.amount_gross);
  perform public.finops_log('expense_paid', 'fin_expense_requests', p_id,
    jsonb_build_object('cost_id', r.cost_id, 'gross', r.amount_gross));
  return jsonb_build_object('ok', true, 'id', p_id, 'cost_id', r.cost_id);
end $$;

create or replace function public.finops_expense_second_approve(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_approve_expense(), false) then raise exception 'not authorized'; end if;
  select * into r from public.fin_expense_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'row_not_found'; end if;
  if not r.needs_second_approval then
    return jsonb_build_object('ok', false, 'reason','second_not_required',
      'message','هذا الطلب لا يتطلّب اعتمادًا ثانيًا.');
  end if;
  -- المعتمِد الثاني شخص آخر فعلًا، وإلّا فالاعتماد المزدوج مسرحية.
  if r.decided_by = auth.uid() then raise exception 'same_approver_forbidden'; end if;
  if r.requested_by = auth.uid() then raise exception 'self_approval_forbidden'; end if;
  update public.fin_expense_requests
     set second_decided_by = auth.uid(), second_decided_at = now(), updated_at = now()
   where id = p_id;
  insert into public.fin_expense_approvals (request_id, step, actor_id, action, note, amount_gross_at_action)
  values (p_id, 4, auth.uid(), 'approved', nullif(btrim(coalesce(p_note, '')), ''), r.amount_gross);
  perform public.finops_log('expense_second_approve', 'fin_expense_requests', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ─── طلبات الشراء وأوامر الشراء ────────────────────────────────────────────
create or replace function public.finops_purchase_request_submit(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb; v_status text; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_request(), false) then raise exception 'not authorized'; end if;
  v_status := coalesce(nullif(btrim(coalesce(p->>'status','')), ''), 'submitted');
  if v_status not in ('draft','submitted') then raise exception 'invalid_status'; end if;
  m := public.finops_money(p, 15);
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select requested_by into v_owner from public.fin_purchase_requests where id = v_id and is_deleted = false;
    if v_owner is null then raise exception 'row_not_found'; end if;
    if v_owner <> auth.uid() then raise exception 'not authorized'; end if;
    if exists (select 1 from public.fin_purchase_requests
                where id = v_id and status not in ('draft','submitted')) then
      return jsonb_build_object('ok', false, 'reason','already_decided',
        'message','هذا الطلب خرج من يدك بعد صدور قرار فيه.');
    end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_purchase_requests as t (id, request_no, requested_by, cost_center_id,
    budget_id, project_id, supplier_id, title, justification, needed_by, currency, amount_net,
    vat_rate, vat_amount, status, submitted_at, custody_purchase_request_id)
  values (v_id, public.finops_next_code('PR'), auth.uid(),
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'supplier_id','')), '')::uuid,
    btrim(coalesce(p->>'title','')), nullif(btrim(coalesce(p->>'justification','')), ''),
    nullif(btrim(coalesce(p->>'needed_by','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    v_status, case when v_status = 'submitted' then now() else null end,
    nullif(btrim(coalesce(p->>'custody_purchase_request_id','')), '')::uuid)
  on conflict (id) do update set
    cost_center_id = excluded.cost_center_id, budget_id = excluded.budget_id,
    project_id = excluded.project_id, supplier_id = excluded.supplier_id, title = excluded.title,
    justification = excluded.justification, needed_by = excluded.needed_by,
    currency = excluded.currency, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, status = excluded.status,
    submitted_at = case when excluded.status = 'submitted' then coalesce(t.submitted_at, now()) else null end,
    custody_purchase_request_id = excluded.custody_purchase_request_id, updated_at = now();
  perform public.finops_log('purchase_submit', 'fin_purchase_requests', v_id,
    jsonb_build_object('status', v_status, 'gross', m->>'amount_gross'));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status, 'money', m);
end $$;

create or replace function public.finops_purchase_item_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_req uuid; v_owner uuid;
        v_status text; v_qty numeric; v_price numeric; v_rate numeric; v_vat numeric;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_req := nullif(btrim(coalesce(p->>'request_id','')), '')::uuid;
  if v_req is null then raise exception 'request_required'; end if;
  select requested_by, status into v_owner, v_status
    from public.fin_purchase_requests where id = v_req and is_deleted = false;
  if v_owner is null then raise exception 'row_not_found'; end if;
  if not (coalesce(public.finops_can_manage_finance(), false) or v_owner = auth.uid()) then
    raise exception 'not authorized';
  end if;
  if v_status not in ('draft','submitted') and not coalesce(public.finops_can_manage_finance(), false) then
    raise exception 'not authorized';
  end if;
  v_qty   := coalesce(nullif(btrim(coalesce(p->>'quantity','')), '')::numeric, 1);
  v_price := round(coalesce(nullif(btrim(coalesce(p->>'unit_price_net','')), '')::numeric, 0), 2);
  v_rate  := coalesce(nullif(btrim(coalesce(p->>'vat_rate','')), '')::numeric, 15);
  if v_qty <= 0 then raise exception 'invalid_quantity'; end if;
  if v_price < 0 or v_rate < 0 or v_rate > 100 then raise exception 'invalid_amount'; end if;
  v_vat := coalesce(nullif(btrim(coalesce(p->>'vat_amount','')), '')::numeric,
                    round(v_qty * v_price * v_rate / 100.0, 2));
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_purchase_request_items as t (id, request_id, line_no, description,
    quantity, unit, unit_price_net, vat_rate, vat_amount, note)
  values (v_id, v_req,
    coalesce(nullif(btrim(coalesce(p->>'line_no','')), '')::int, 1),
    btrim(coalesce(p->>'description','')),
    v_qty, coalesce(nullif(btrim(coalesce(p->>'unit','')), ''), 'unit'), v_price, v_rate, v_vat,
    nullif(btrim(coalesce(p->>'note','')), ''))
  on conflict (id) do update set
    line_no = excluded.line_no, description = excluded.description, quantity = excluded.quantity,
    unit = excluded.unit, unit_price_net = excluded.unit_price_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, note = excluded.note, updated_at = now(), is_deleted = false;
  -- رأس الطلب يساوي مجموع بنوده دائمًا: رقمان لا يتطابقان يفسدان كلّ اعتماد.
  update public.fin_purchase_requests r
     set amount_net = coalesce((select sum(i.line_net) from public.fin_purchase_request_items i
                                 where i.request_id = v_req and i.is_deleted = false), 0),
         vat_amount = coalesce((select sum(i.vat_amount) from public.fin_purchase_request_items i
                                 where i.request_id = v_req and i.is_deleted = false), 0),
         updated_at = now()
   where r.id = v_req;
  perform public.finops_log('purchase_item_upsert', 'fin_purchase_request_items', v_id,
    jsonb_build_object('request_id', v_req));
  return jsonb_build_object('ok', true, 'id', v_id, 'request_id', v_req);
end $$;

create or replace function public.finops_purchase_decide(p_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_th jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_approve_expense(), false) then raise exception 'not authorized'; end if;
  if p_action is null or p_action not in ('approved','rejected') then raise exception 'invalid_action'; end if;
  if p_action = 'rejected' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into r from public.fin_purchase_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'row_not_found'; end if;
  if r.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason','not_pending', 'message','هذا الطلب ليس في انتظار قرار.');
  end if;
  if r.requested_by = auth.uid()
     and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    raise exception 'self_approval_forbidden';
  end if;
  v_th := public.finops_threshold_for('purchase', r.amount_gross, null, r.cost_center_id);
  if p_action = 'approved' and coalesce(v_th->>'required_role','owner') = 'owner'
     and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    return jsonb_build_object('ok', false, 'reason','threshold_exceeded', 'threshold', v_th,
      'message', coalesce(v_th->>'message', 'هذا المبلغ يتجاوز سقف اعتمادك ويتطلّب اعتماد المالك.'));
  end if;
  update public.fin_purchase_requests
     set status = p_action, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id;
  perform public.finops_log('purchase_decide', 'fin_purchase_requests', p_id,
    jsonb_build_object('action', p_action, 'gross', r.amount_gross, 'threshold', v_th));
  return jsonb_build_object('ok', true, 'id', p_id, 'action', p_action, 'threshold', v_th);
end $$;

create or replace function public.finops_po_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; m jsonb; v_old text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p->>'supplier_id','')), '') is null then raise exception 'supplier_required'; end if;
  m := public.finops_money(p, 15);
  v_id := nullif(btrim(coalesce(p->>'id','')), '')::uuid;
  if v_id is not null then
    select status into v_old from public.fin_purchase_orders where id = v_id and is_deleted = false;
    if v_old is null then raise exception 'row_not_found'; end if;
    -- أمر شراء مُصدَر عقدٌ مع مورّد: لا تُعدَّل بنوده صامتًا بعد الإصدار.
    if v_old <> 'draft' then
      return jsonb_build_object('ok', false, 'reason','po_issued',
        'message','أمر الشراء صادر ولا يُعدَّل. ألغِه وأصدِر أمرًا جديدًا.');
    end if;
  end if;
  v_id := coalesce(v_id, gen_random_uuid());
  insert into public.fin_purchase_orders as t (id, po_no, supplier_id, request_id, cost_center_id,
    budget_id, budget_line_id, project_id, issue_date, expected_date, currency, amount_net,
    vat_rate, vat_amount, status, terms, notes, created_by)
  values (v_id, coalesce(nullif(btrim(coalesce(p->>'po_no','')), ''), public.finops_next_code('PO')),
    (p->>'supplier_id')::uuid,
    nullif(btrim(coalesce(p->>'request_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'cost_center_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'budget_line_id','')), '')::uuid,
    nullif(btrim(coalesce(p->>'project_id','')), '')::uuid,
    coalesce(nullif(btrim(coalesce(p->>'issue_date','')), '')::date, current_date),
    nullif(btrim(coalesce(p->>'expected_date','')), '')::date,
    coalesce(nullif(btrim(coalesce(p->>'currency','')), ''), 'SAR'),
    (m->>'amount_net')::numeric, (m->>'vat_rate')::numeric, (m->>'vat_amount')::numeric,
    'draft', nullif(btrim(coalesce(p->>'terms','')), ''), nullif(btrim(coalesce(p->>'notes','')), ''),
    auth.uid())
  on conflict (id) do update set
    supplier_id = excluded.supplier_id, request_id = excluded.request_id,
    cost_center_id = excluded.cost_center_id, budget_id = excluded.budget_id,
    budget_line_id = excluded.budget_line_id, project_id = excluded.project_id,
    issue_date = excluded.issue_date, expected_date = excluded.expected_date,
    currency = excluded.currency, amount_net = excluded.amount_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, terms = excluded.terms, notes = excluded.notes,
    updated_at = now(), is_deleted = false;
  perform public.finops_log('po_upsert', 'fin_purchase_orders', v_id, jsonb_build_object('net', m->>'amount_net'));
  return jsonb_build_object('ok', true, 'id', v_id, 'money', m);
end $$;

create or replace function public.finops_po_item_upsert(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_po uuid; v_status text;
        v_qty numeric; v_price numeric; v_rate numeric; v_vat numeric; v_recv numeric;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_po := nullif(btrim(coalesce(p->>'po_id','')), '')::uuid;
  if v_po is null then raise exception 'po_required'; end if;
  select status into v_status from public.fin_purchase_orders where id = v_po and is_deleted = false;
  if v_status is null then raise exception 'row_not_found'; end if;
  v_qty   := coalesce(nullif(btrim(coalesce(p->>'quantity','')), '')::numeric, 1);
  v_price := round(coalesce(nullif(btrim(coalesce(p->>'unit_price_net','')), '')::numeric, 0), 2);
  v_rate  := coalesce(nullif(btrim(coalesce(p->>'vat_rate','')), '')::numeric, 15);
  v_recv  := coalesce(nullif(btrim(coalesce(p->>'received_qty','')), '')::numeric, 0);
  if v_qty <= 0 then raise exception 'invalid_quantity'; end if;
  if v_price < 0 or v_rate < 0 or v_rate > 100 or v_recv < 0 then raise exception 'invalid_amount'; end if;
  if v_status = 'draft' and v_recv > 0 then raise exception 'receive_before_issue'; end if;
  v_vat := coalesce(nullif(btrim(coalesce(p->>'vat_amount','')), '')::numeric,
                    round(v_qty * v_price * v_rate / 100.0, 2));
  v_id := coalesce(nullif(btrim(coalesce(p->>'id','')), '')::uuid, gen_random_uuid());
  insert into public.fin_purchase_order_items as t (id, po_id, line_no, description, quantity,
    unit, unit_price_net, vat_rate, vat_amount, received_qty, note)
  values (v_id, v_po, coalesce(nullif(btrim(coalesce(p->>'line_no','')), '')::int, 1),
    btrim(coalesce(p->>'description','')), v_qty,
    coalesce(nullif(btrim(coalesce(p->>'unit','')), ''), 'unit'), v_price, v_rate, v_vat, v_recv,
    nullif(btrim(coalesce(p->>'note','')), ''))
  on conflict (id) do update set
    line_no = excluded.line_no, description = excluded.description, quantity = excluded.quantity,
    unit = excluded.unit, unit_price_net = excluded.unit_price_net, vat_rate = excluded.vat_rate,
    vat_amount = excluded.vat_amount, received_qty = excluded.received_qty, note = excluded.note,
    updated_at = now(), is_deleted = false;
  if v_status = 'draft' then
    update public.fin_purchase_orders o
       set amount_net = coalesce((select sum(i.line_net) from public.fin_purchase_order_items i
                                   where i.po_id = v_po and i.is_deleted = false), 0),
           vat_amount = coalesce((select sum(i.vat_amount) from public.fin_purchase_order_items i
                                   where i.po_id = v_po and i.is_deleted = false), 0),
           updated_at = now()
     where o.id = v_po;
  end if;
  perform public.finops_log('po_item_upsert', 'fin_purchase_order_items', v_id, jsonb_build_object('po_id', v_po));
  return jsonb_build_object('ok', true, 'id', v_id, 'po_id', v_po);
end $$;

-- حالة أمر الشراء: الإصدار يُنشئ التزامًا، والاستلام يحوّله إلى تكلفة فعلية.
create or replace function public.finops_po_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r record; v_cost uuid;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  if p_status is null or p_status not in
     ('issued','partially_received','received','closed','cancelled') then
    raise exception 'invalid_status';
  end if;
  if p_status = 'cancelled' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into r from public.fin_purchase_orders where id = p_id and is_deleted = false;
  if not found then raise exception 'row_not_found'; end if;
  if r.status = 'closed' then
    return jsonb_build_object('ok', false, 'reason','po_closed', 'message','أمر الشراء مغلق.');
  end if;

  if p_status = 'issued' then
    if r.status <> 'draft' then
      return jsonb_build_object('ok', false, 'reason','invalid_transition',
        'message','لا يُصدَر إلّا أمر شراء في حالة مسوّدة.');
    end if;
    insert into public.fin_costs (cost_no, cost_type, commitment, cost_center_id, budget_id,
      budget_line_id, project_id, supplier_id, source_kind, source_id, title, incurred_on,
      currency, amount_net, vat_rate, vat_amount, status, created_by)
    values (public.finops_next_code('COST'), 'production_purchase', 'committed', r.cost_center_id,
      r.budget_id, r.budget_line_id, r.project_id, r.supplier_id, 'purchase_order', r.id,
      'أمر شراء ' || r.po_no, r.issue_date, r.currency, r.amount_net, r.vat_rate, r.vat_amount,
      'confirmed', auth.uid())
    returning id into v_cost;
    update public.fin_purchase_orders
       set status = 'issued', issued_at = now(), committed_cost_id = v_cost, updated_at = now()
     where id = p_id;

  elsif p_status in ('received','partially_received') then
    if r.status not in ('issued','partially_received') then
      return jsonb_build_object('ok', false, 'reason','invalid_transition',
        'message','لا يُستلَم إلّا أمر شراء صادر.');
    end if;
    -- الاستلام الكامل يحوّل الالتزام نفسه إلى تكلفة فعلية (لا صفّ ثانٍ).
    if p_status = 'received' and r.committed_cost_id is not null then
      update public.fin_costs set commitment = 'actual', incurred_on = current_date, updated_at = now()
       where id = r.committed_cost_id and is_deleted = false;
    end if;
    update public.fin_purchase_orders set status = p_status, updated_at = now() where id = p_id;

  elsif p_status = 'cancelled' then
    -- إلغاء الأمر يُبطل التزامه: التزام معلّق بلا أمر يشوّه كلّ انحراف لاحق.
    if r.committed_cost_id is not null then
      update public.fin_costs set status = 'void', updated_at = now()
       where id = r.committed_cost_id and is_deleted = false and commitment = 'committed';
    end if;
    update public.fin_purchase_orders set status = 'cancelled', updated_at = now() where id = p_id;
  else
    update public.fin_purchase_orders set status = 'closed', closed_at = now(), updated_at = now()
     where id = p_id;
  end if;

  perform public.finops_log('po_status', 'fin_purchase_orders', p_id,
    jsonb_build_object('from', r.status, 'to', p_status, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status, 'cost_id', v_cost);
end $$;

-- ─── المرفقات ──────────────────────────────────────────────────────────────
create or replace function public.finops_attachment_add(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_type text; v_entity uuid; v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  v_type   := nullif(btrim(coalesce(p->>'entity_type','')), '');
  v_entity := nullif(btrim(coalesce(p->>'entity_id','')), '')::uuid;
  if v_type is null or v_entity is null then raise exception 'entity_required'; end if;
  if nullif(btrim(coalesce(p->>'file_url','')), '') is null then raise exception 'file_required'; end if;

  if coalesce(public.finops_can_manage_finance(), false) then
    v_ok := true;
  elsif v_type = 'collection' then
    -- سند القبض: موظّف التحصيل يرفق إيصال الدفعة التي سجّلها. مرفق واحد على
    -- صفّ تحصيل قائم — ولا يفتح له ذلك قراءة أيّ جدول ماليّ (RLS لم تتغيّر).
    v_ok := coalesce(public.finops_can_record_collection(), false)
            and exists (select 1 from public.fin_collections
                         where id = v_entity and is_deleted = false
                           and recorded_by = auth.uid());
  elsif v_type = 'expense_request' then
    v_ok := exists (select 1 from public.fin_expense_requests
                     where id = v_entity and requested_by = auth.uid() and is_deleted = false);
  elsif v_type = 'purchase_request' then
    v_ok := exists (select 1 from public.fin_purchase_requests
                     where id = v_entity and requested_by = auth.uid() and is_deleted = false);
  end if;
  if not v_ok then raise exception 'not authorized'; end if;

  v_id := gen_random_uuid();
  insert into public.fin_attachments (id, entity_type, entity_id, file_url, file_name, mime_type,
    size_bytes, note, uploaded_by)
  values (v_id, v_type, v_entity, btrim(p->>'file_url'),
    nullif(btrim(coalesce(p->>'file_name','')), ''), nullif(btrim(coalesce(p->>'mime_type','')), ''),
    nullif(btrim(coalesce(p->>'size_bytes','')), '')::bigint,
    nullif(btrim(coalesce(p->>'note','')), ''), auth.uid());
  perform public.finops_log('attachment_add', v_type, v_entity, jsonb_build_object('attachment_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─── الحذف الليّن الموحَّد — بسبب مكتوب دائمًا ─────────────────────────────
create or replace function public.finops_row_delete(p_kind text, p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_tbl text; v_has_reason boolean; v_owner uuid; v_status text; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  v_tbl := case p_kind
    when 'cost_center'      then 'fin_cost_centers'
    when 'category'         then 'fin_expense_categories'
    when 'supplier'         then 'fin_suppliers'
    when 'budget'           then 'fin_budgets'
    when 'budget_line'      then 'fin_budget_lines'
    when 'contract'         then 'fin_contracts'
    when 'revenue'          then 'fin_revenue'
    when 'retainer'         then 'fin_retainers'
    when 'receivable'       then 'fin_receivables'
    when 'collection'       then 'fin_collections'
    when 'milestone'        then 'fin_payment_milestones'
    when 'threshold'        then 'fin_approval_thresholds'
    when 'expense_request'  then 'fin_expense_requests'
    when 'purchase_request' then 'fin_purchase_requests'
    when 'purchase_item'    then 'fin_purchase_request_items'
    when 'purchase_order'   then 'fin_purchase_orders'
    when 'po_item'          then 'fin_purchase_order_items'
    when 'cost'             then 'fin_costs'
    when 'attachment'       then 'fin_attachments'
    else null end;
  if v_tbl is null then raise exception 'unknown_kind'; end if;

  -- الحذف إداريّ افتراضًا. الاستثناء الوحيد: صاحب طلب ما زال مسوّدة/مُرسَلًا.
  if not coalesce(public.finops_can_manage_finance(), false) then
    if v_tbl in ('fin_expense_requests','fin_purchase_requests') then
      execute format('select requested_by, status from public.%I where id = $1 and is_deleted = false', v_tbl)
        into v_owner, v_status using p_id;
      if v_owner is null then raise exception 'row_not_found'; end if;
      if v_owner <> auth.uid() or v_status not in ('draft','submitted') then raise exception 'not authorized'; end if;
    elsif v_tbl = 'fin_attachments' then
      execute 'select uploaded_by from public.fin_attachments where id = $1 and is_deleted = false'
        into v_owner using p_id;
      if v_owner is null or v_owner <> auth.uid() then raise exception 'not authorized'; end if;
    else
      raise exception 'not authorized';
    end if;
  end if;
  -- حدود الاعتماد يحذفها المالك وحده، تمامًا كما يضبطها.
  if v_tbl = 'fin_approval_thresholds'
     and not (coalesce(public.is_owner(), false) or coalesce(public.is_admin(), false)) then
    raise exception 'not authorized';
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = v_tbl and column_name = 'delete_reason')
    into v_has_reason;
  if v_has_reason then
    execute format('update public.%I set is_deleted = true, deleted_at = now(), deleted_by = $2, delete_reason = $3 where id = $1 and is_deleted = false', v_tbl)
      using p_id, auth.uid(), btrim(p_reason);
  else
    execute format('update public.%I set is_deleted = true where id = $1 and is_deleted = false', v_tbl)
      using p_id;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'row_not_found'; end if;
  perform public.finops_log('row_delete', v_tbl, p_id, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_id, 'kind', p_kind);
end $$;

-- ─── صادر Zoho Books — إدراج وإعادة جدولة فقط. لا إرسال. ──────────────────
create or replace function public.finops_zoho_outbox_enqueue(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p jsonb := coalesce(p_payload, '{}'::jsonb); v_id uuid; v_event text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  v_event := nullif(btrim(coalesce(p->>'event_type','')), '');
  if v_event is null then raise exception 'event_required'; end if;
  v_id := gen_random_uuid();
  insert into public.fin_zoho_outbox (id, event_type, entity_type, entity_id, payload, status,
    hold_reason, created_by)
  values (v_id, v_event, coalesce(nullif(btrim(coalesce(p->>'entity_type','')), ''), 'unknown'),
    nullif(btrim(coalesce(p->>'entity_id','')), '')::uuid,
    coalesce(p->'payload', '{}'::jsonb), 'held', 'integration_not_built', auth.uid());
  perform public.finops_log('zoho_enqueue', 'fin_zoho_outbox', v_id, jsonb_build_object('event', v_event));
  -- ★ الصدق هنا جزء من العقد ★: الصفّ محجوز ولن يُرسَل، ويُقال ذلك في الردّ نفسه.
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'held', 'sent', false,
    'message','سُجّل الحدث في صندوق الصادر ولن يُرسَل: تكامل Zoho Books غير مبنيّ.');
end $$;

create or replace function public.finops_zoho_outbox_replay(p_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not coalesce(public.finops_can_manage_finance(), false) then raise exception 'not authorized'; end if;
  update public.fin_zoho_outbox
     set status = 'pending', attempt_count = attempt_count + 1,
         last_error = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id and status in ('held','failed');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'row_not_found'; end if;
  perform public.finops_log('zoho_replay', 'fin_zoho_outbox', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'pending', 'sent', false,
    'message','أُعيدت جدولة الصفّ. لا عامل يقرأ هذا الصندوق بعد، فلن يُرسَل شيء.');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §8) الصلاحيات — لا شيء لـanon، أبدًا. الجداول قراءة فقط عبر RLS.
-- ════════════════════════════════════════════════════════════════════════════
do $g$
declare f text; t text;
begin
  -- (أ) الدوالّ العامّة: authenticated فقط (والبوّابة داخل كلّ دالّة).
  foreach f in array array[
    'public.finops_access()',
    'public.finops_lookups()',
    'public.finops_request_lookups()',
    'public.finops_budgets_list(jsonb)',
    'public.finops_budget_variance(uuid)',
    'public.finops_costs_list(jsonb)',
    'public.finops_suppliers_list(jsonb)',
    'public.finops_expense_requests_list(jsonb)',
    'public.finops_my_requests(jsonb)',
    'public.finops_purchase_list(jsonb)',
    'public.finops_receivables(jsonb)',
    'public.finops_collections_list(jsonb)',
    'public.finops_collections_summary()',
    'public.finops_profitability(jsonb)',
    'public.finops_dashboard(jsonb)',
    'public.finops_audit_list(jsonb)',
    'public.finops_export(text,jsonb)',
    'public.finops_zoho_diagnostic()',
    'public.finops_cost_center_upsert(jsonb)',
    'public.finops_category_upsert(jsonb)',
    'public.finops_supplier_upsert(jsonb)',
    'public.finops_threshold_upsert(jsonb)',
    'public.finops_budget_upsert(jsonb)',
    'public.finops_budget_line_upsert(jsonb)',
    'public.finops_contract_upsert(jsonb)',
    'public.finops_revenue_upsert(jsonb)',
    'public.finops_retainer_upsert(jsonb)',
    'public.finops_receivable_upsert(jsonb)',
    'public.finops_collection_record(jsonb)',
    'public.finops_milestone_upsert(jsonb)',
    'public.finops_cost_upsert(jsonb)',
    'public.finops_expense_request_submit(jsonb)',
    'public.finops_expense_decide(uuid,text,text)',
    'public.finops_expense_mark_paid(uuid,date)',
    'public.finops_expense_second_approve(uuid,text)',
    'public.finops_purchase_request_submit(jsonb)',
    'public.finops_purchase_item_upsert(jsonb)',
    'public.finops_purchase_decide(uuid,text,text)',
    'public.finops_po_upsert(jsonb)',
    'public.finops_po_item_upsert(jsonb)',
    'public.finops_po_set_status(uuid,text,text)',
    'public.finops_attachment_add(jsonb)',
    'public.finops_row_delete(text,uuid,text)',
    'public.finops_zoho_outbox_enqueue(jsonb)',
    'public.finops_zoho_outbox_replay(uuid,text)',
    -- المُسنَدات: تُقيَّم داخل سياسات RLS بدور المُنادي، فلا بدّ من EXECUTE له.
    'public.finops_can_view_finance_sensitive()',
    'public.finops_can_manage_finance()',
    'public.finops_can_manage_suppliers()',
    'public.finops_can_view_collections()',
    'public.finops_can_record_collection()',
    'public.finops_can_approve_expense()',
    'public.finops_can_export_sensitive()',
    'public.finops_can_export_collections()',
    'public.finops_can_view()',
    'public.finops_can_manage()',
    'public.finops_can_approve()',
    'public.finops_can_view_profit()',
    'public.finops_can_manage_receivables()',
    'public.finops_can_export()',
    'public.finops_can_request()',
    'public.finops_is_client()',
    'public.finops_is_finance_role()',
    'public.finops_perm(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('grant execute on function %s to authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ب) الدوالّ الداخلية: لا تُمنح لأحد — تُنفَّذ ضمن سلسلة SECURITY DEFINER فقط.
  --     أخطرها finops_profit_core: منحها لـauthenticated كان سيسرّب الهامش
  --     لمن لا يملك بوّابة الربحية، مهما كانت الأغلفة مُحكَمة.
  foreach f in array array[
    'public.finops_log(text,text,uuid,jsonb)',
    'public.finops_project_label(uuid)',
    'public.finops_next_code(text)',
    'public.finops_money(jsonb,numeric)',
    'public.finops_threshold_for(text,numeric,uuid,uuid)',
    'public.finops_receivable_state(uuid)',
    'public.finops_contract_state(uuid)',
    'public.finops_variance_core(uuid)',
    'public.finops_profit_core(uuid,date,date)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f); exception when undefined_object then null; end;
  end loop;

  -- (ج) الجداول: قراءة فقط لـauthenticated (وRLS هي الفاصل)، ولا شيء لـanon.
  foreach t in array array['fin_cost_centers','fin_expense_categories','fin_suppliers','fin_budgets',
    'fin_budget_lines','fin_contracts','fin_revenue','fin_retainers','fin_receivables','fin_collections',
    'fin_payment_milestones','fin_approval_thresholds','fin_expense_requests','fin_expense_approvals',
    'fin_purchase_requests','fin_purchase_request_items','fin_purchase_orders','fin_purchase_order_items',
    'fin_costs','fin_attachments','fin_audit','fin_zoho_outbox'] loop
    execute format('revoke all on table public.%I from public', t);
    begin execute format('revoke all on table public.%I from anon', t); exception when undefined_object then null; end;
    execute format('revoke all on table public.%I from authenticated', t);
    begin execute format('grant select on table public.%I to authenticated', t); exception when undefined_object then null; end;
  end loop;

  execute 'revoke all on sequence public.fin_doc_seq from public';
  begin execute 'revoke all on sequence public.fin_doc_seq from anon'; exception when undefined_object then null; end;
  begin execute 'revoke all on sequence public.fin_doc_seq from authenticated'; exception when undefined_object then null; end;
end $g$;

-- ════════════════════════════════════════════════════════════════════════════
-- §9) SELF-TEST — ثابت. لا يستدعي دالّة محميّة (auth.uid() = NULL في المحرّر)،
--      ولا يلتفّ حول فحص بمصيدة تجعله ينجح مهما حدث. الفشل يُلغي المعاملة.
-- ════════════════════════════════════════════════════════════════════════════
do $st$
declare t text; f text; v_def text; v jsonb; v_b boolean; v_n bigint; v_err text := '';
  v_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
  ZERO constant uuid := '00000000-0000-0000-0000-000000000000';
  -- ★ محلّل الانحدار (20-ب) — حالته المحلّية ★
  v_src text; v_work text[]; v_next text[]; v_seen text[]; v_calls text[];
  v_cur text; v_hit boolean; v_hop int; v_deep int := -1; v_want boolean;
  -- الجذر الحسّاس: كلّ بوّابة مالك يجب أن تصله، ولا شيء آخر يفتح ما يفتحه.
  ROOT_GATE constant text := 'finops_can_view_finance_sensitive';
  -- بوّابات المالك — بعضها يفوّض بقفزة وبعضها بقفزتين. الاثنتان مقبولتان.
  OWNER_GATES constant text[] := array[
    'finops_can_manage_finance','finops_can_manage_suppliers','finops_can_export_sensitive',
    'finops_can_view_profit','finops_can_view','finops_can_manage',
    'finops_can_manage_receivables','finops_can_export'];
  -- ★ ضابطا لا-فراغ ★ — مُسنَدان يجب أن يقول المحلّل عنهما «لا ينحدران».
  --   لو صار المحلّل يقول «وصل» لكلّ شيء لصار كلّ ما فوق بلا معنى.
  NO_DESCENT constant text[] := array['finops_can_request','finops_is_finance_role'];
  -- مُسنَدات واسعة: ظهور أيّ منها على طريق بوّابة مالك = توسيع صامت.
  -- ليست قائمة أعمدة ولا قائمة جداول: أسماء مُسنَدات تُفتح بمفتاح أو بدور.
  BROAD_FNS constant text[] := array[
    'finops_perm','emp_has_permission','emp_can','has_permission','staff_role',
    'finops_is_finance_role','can_manage_projects','can_final_deliver','can_manage_staff',
    'is_kian_member','civ_can_finance','civ_can_manage','can_see_invoices','is_hr_admin',
    'can_manage_hr','pc_can_read_project','crm_perm','ops_perm','comms_perm',
    'finops_can_view_collections','finops_can_record_collection','finops_can_approve_expense',
    'finops_can_export_collections','finops_can_request','finops_is_client'];
  -- كلّ بوّابة قابلة للمنح ومفتاحها الخاصّ بها. مفتاح واحد لبوّابتين = توسيع.
  GRANTABLE_KEYS constant text[] := array[
    'finops_can_view_collections|finance_ops.collections_view',
    'finops_can_record_collection|finance_ops.collections_record',
    'finops_can_approve_expense|finance_ops.approve',
    'finops_can_export_collections|finance_ops.export_collections'];
  MONEY_TABLES constant text[] := array['fin_budget_lines','fin_contracts','fin_revenue','fin_retainers',
    'fin_receivables','fin_collections','fin_payment_milestones','fin_expense_requests',
    'fin_purchase_requests','fin_purchase_orders','fin_costs'];
  WRITE_FNS constant text[] := array[
    'public.finops_cost_center_upsert(jsonb)','public.finops_category_upsert(jsonb)',
    'public.finops_supplier_upsert(jsonb)','public.finops_threshold_upsert(jsonb)',
    'public.finops_budget_upsert(jsonb)','public.finops_budget_line_upsert(jsonb)',
    'public.finops_contract_upsert(jsonb)','public.finops_revenue_upsert(jsonb)',
    'public.finops_retainer_upsert(jsonb)','public.finops_receivable_upsert(jsonb)',
    'public.finops_collection_record(jsonb)','public.finops_milestone_upsert(jsonb)',
    'public.finops_cost_upsert(jsonb)','public.finops_expense_request_submit(jsonb)',
    'public.finops_expense_decide(uuid,text,text)','public.finops_expense_mark_paid(uuid,date)',
    'public.finops_expense_second_approve(uuid,text)','public.finops_purchase_request_submit(jsonb)',
    'public.finops_purchase_item_upsert(jsonb)','public.finops_purchase_decide(uuid,text,text)',
    'public.finops_po_upsert(jsonb)','public.finops_po_item_upsert(jsonb)',
    'public.finops_po_set_status(uuid,text,text)','public.finops_attachment_add(jsonb)',
    'public.finops_row_delete(text,uuid,text)','public.finops_zoho_outbox_enqueue(jsonb)',
    'public.finops_zoho_outbox_replay(uuid,text)'];
begin
  -- (1) الجداول الاثنان والعشرون: موجودة · RLS مفعّلة · لا سياسة كتابة · لا anon
  foreach t in array array['fin_cost_centers','fin_expense_categories','fin_suppliers','fin_budgets',
    'fin_budget_lines','fin_contracts','fin_revenue','fin_retainers','fin_receivables','fin_collections',
    'fin_payment_milestones','fin_approval_thresholds','fin_expense_requests','fin_expense_approvals',
    'fin_purchase_requests','fin_purchase_request_items','fin_purchase_orders','fin_purchase_order_items',
    'fin_costs','fin_attachments','fin_audit','fin_zoho_outbox'] loop
    if to_regclass('public.' || t) is null then raise exception 'FIN SELF-TEST: الجدول % لم يُنشأ', t; end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'FIN SELF-TEST: RLS غير مفعّلة على %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT') then
      raise exception 'FIN SELF-TEST: توجد سياسة كتابة مباشرة على % — الكتابة يجب أن تمرّ بـRPC', t;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'FIN SELF-TEST: % بلا سياسة قراءة — RLS مفعّلة بلا سياسة تحجب الجميع صامتًا', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants
                where table_schema = 'public' and table_name = t and grantee = 'anon') then
      raise exception 'FIN SELF-TEST: anon يملك صلاحية على %', t;
    end if;
  end loop;

  -- (2) الدوالّ كلّها أُنشئت ولا anon يملك تنفيذها
  foreach f in array WRITE_FNS || array[
    'public.finops_access()','public.finops_lookups()','public.finops_request_lookups()',
    'public.finops_budgets_list(jsonb)','public.finops_budget_variance(uuid)',
    'public.finops_costs_list(jsonb)','public.finops_suppliers_list(jsonb)',
    'public.finops_expense_requests_list(jsonb)','public.finops_my_requests(jsonb)',
    'public.finops_purchase_list(jsonb)','public.finops_receivables(jsonb)',
    'public.finops_profitability(jsonb)','public.finops_dashboard(jsonb)',
    'public.finops_audit_list(jsonb)','public.finops_export(text,jsonb)',
    'public.finops_zoho_diagnostic()',
    'public.finops_collections_list(jsonb)','public.finops_collections_summary()',
    'public.finops_can_view_finance_sensitive()','public.finops_can_manage_finance()',
    'public.finops_can_manage_suppliers()','public.finops_can_view_collections()',
    'public.finops_can_record_collection()','public.finops_can_approve_expense()',
    'public.finops_can_export_sensitive()','public.finops_can_export_collections()',
    'public.finops_can_view()','public.finops_can_manage()',
    'public.finops_can_approve()','public.finops_can_view_profit()',
    'public.finops_can_manage_receivables()','public.finops_can_export()',
    'public.finops_can_request()','public.finops_is_client()','public.finops_is_finance_role()',
    'public.finops_perm(text)','public.finops_money(jsonb,numeric)',
    'public.finops_threshold_for(text,numeric,uuid,uuid)','public.finops_receivable_state(uuid)',
    'public.finops_contract_state(uuid)','public.finops_variance_core(uuid)',
    'public.finops_profit_core(uuid,date,date)','public.finops_log(text,text,uuid,jsonb)',
    'public.finops_project_label(uuid)','public.finops_next_code(text)'] loop
    if to_regprocedure(f) is null then raise exception 'FIN SELF-TEST: الدالّة % لم تُنشأ', f; end if;
    if v_anon and has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'FIN SELF-TEST: anon يملك EXECUTE على %', f;
    end if;
  end loop;

  -- (2ب) محرّك الربحية داخليّ: لا authenticated يملكه (لو مُنح لتسرّب الهامش)
  foreach f in array array['public.finops_profit_core(uuid,date,date)',
    'public.finops_variance_core(uuid)','public.finops_money(jsonb,numeric)',
    'public.finops_log(text,text,uuid,jsonb)','public.finops_next_code(text)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'FIN SELF-TEST: authenticated يملك EXECUTE على الدالّة الداخلية %', f;
    end if;
  end loop;

  -- (3) المُسنَدات لا تعيد NULL — **استدعاء حيّ آمن**: لا بوّابة فيها، وauth.uid()
  --     يساوي NULL هنا، فالنتيجة الصحيحة false. لو أعادت NULL انهار fail-closed.
  -- النموذج الجديد أوّلًا: كلّ مُسنَد يعيد boolean صريحًا وfalse بلا جلسة.
  v_b := public.finops_can_view_finance_sensitive();
  if v_b is null then raise exception 'FIN SELF-TEST: can_view_finance_sensitive أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_view_finance_sensitive = true بلا جلسة — تسريب مالية'; end if;
  v_b := public.finops_can_manage_finance();
  if v_b is null then raise exception 'FIN SELF-TEST: can_manage_finance أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_manage_finance = true بلا جلسة'; end if;
  v_b := public.finops_can_manage_suppliers();
  if v_b is null then raise exception 'FIN SELF-TEST: can_manage_suppliers أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_manage_suppliers = true بلا جلسة'; end if;
  v_b := public.finops_can_view_collections();
  if v_b is null then raise exception 'FIN SELF-TEST: can_view_collections أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_view_collections = true بلا جلسة'; end if;
  v_b := public.finops_can_record_collection();
  if v_b is null then raise exception 'FIN SELF-TEST: can_record_collection أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_record_collection = true بلا جلسة'; end if;
  v_b := public.finops_can_approve_expense();
  if v_b is null then raise exception 'FIN SELF-TEST: can_approve_expense أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_approve_expense = true بلا جلسة'; end if;
  v_b := public.finops_can_export_sensitive();
  if v_b is null then raise exception 'FIN SELF-TEST: can_export_sensitive أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_export_sensitive = true بلا جلسة'; end if;
  v_b := public.finops_can_export_collections();
  if v_b is null then raise exception 'FIN SELF-TEST: can_export_collections أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_export_collections = true بلا جلسة'; end if;
  v_b := public.finops_can_view();     if v_b is null then raise exception 'FIN SELF-TEST: can_view أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_view = true بلا جلسة — fail-open'; end if;
  v_b := public.finops_can_manage();   if v_b is null then raise exception 'FIN SELF-TEST: can_manage أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_manage = true بلا جلسة — fail-open'; end if;
  v_b := public.finops_can_approve();  if v_b is null then raise exception 'FIN SELF-TEST: can_approve أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_approve = true بلا جلسة'; end if;
  v_b := public.finops_can_view_profit(); if v_b is null then raise exception 'FIN SELF-TEST: can_view_profit أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_view_profit = true بلا جلسة — تسريب هامش'; end if;
  v_b := public.finops_can_manage_receivables(); if v_b is null then raise exception 'FIN SELF-TEST: can_manage_receivables أعادت NULL'; end if;
  v_b := public.finops_can_export();   if v_b is null then raise exception 'FIN SELF-TEST: can_export أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_export = true بلا جلسة'; end if;
  v_b := public.finops_can_request();  if v_b is null then raise exception 'FIN SELF-TEST: can_request أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: can_request = true بلا جلسة'; end if;
  v_b := public.finops_is_client();    if v_b is null then raise exception 'FIN SELF-TEST: is_client أعادت NULL'; end if;
  v_b := public.finops_is_finance_role(); if v_b is null then raise exception 'FIN SELF-TEST: is_finance_role أعادت NULL'; end if;
  v_b := public.finops_perm('finance_ops.collections_view'); if v_b is null then raise exception 'FIN SELF-TEST: perm أعادت NULL'; end if;
  if v_b then raise exception 'FIN SELF-TEST: perm = true بلا جلسة'; end if;
  v_b := public.finops_perm(null);     if v_b is null then raise exception 'FIN SELF-TEST: perm(NULL) أعادت NULL'; end if;

  -- (4) مِجَسّ الكشف يعمل بلا جلسة ويعلن انعدام القدرة (لا يتظاهر بالنجاح)
  v := public.finops_access();
  if coalesce((v->>'ok')::boolean, false) is not true then raise exception 'FIN SELF-TEST: access لم تُرجع ok'; end if;
  if coalesce((v->>'can_view')::boolean, true) is not false then
    raise exception 'FIN SELF-TEST: access تمنح can_view بلا جلسة'; end if;
  if coalesce((v->>'can_view_profit')::boolean, true) is not false then
    raise exception 'FIN SELF-TEST: access تمنح can_view_profit بلا جلسة'; end if;
  foreach f in array array['can_view_finance_sensitive','can_manage_finance','can_view_collections',
    'can_record_collection','can_approve_expense','can_export_sensitive','can_export_collections'] loop
    if v->f is null then raise exception 'FIN SELF-TEST: access لا تُعلن %', f; end if;
    if coalesce((v->>f)::boolean, true) is not false then
      raise exception 'FIN SELF-TEST: access تمنح % بلا جلسة', f; end if;
  end loop;

  -- (5) بوّابات مكتوبة فعلًا داخل كلّ دالّة كتابة (فحص نصّيّ لا استدعاء حيّ)
  foreach f in array WRITE_FNS loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%auth.uid() is null%' then raise exception 'FIN SELF-TEST: % بلا بوّابة جلسة', f; end if;
    if v_def not ilike '%not authorized%'     then raise exception 'FIN SELF-TEST: % لا ترفع منعًا صريحًا', f; end if;
    if v_def not ilike '%security definer%'   then raise exception 'FIN SELF-TEST: % ليست SECURITY DEFINER', f; end if;
    if v_def not ilike '%search_path%'        then raise exception 'FIN SELF-TEST: % بلا search_path مثبَّت', f; end if;
    if v_def not ilike '%finops_log%'         then raise exception 'FIN SELF-TEST: % بلا تدقيق', f; end if;
  end loop;

  -- (6) كلّ دالّة قراءة تُغلق قبل أن تقرأ صفًّا (عدا المِجَسّ عمدًا)
  foreach f in array array['public.finops_lookups()','public.finops_budgets_list(jsonb)',
    'public.finops_costs_list(jsonb)','public.finops_suppliers_list(jsonb)',
    'public.finops_expense_requests_list(jsonb)','public.finops_purchase_list(jsonb)',
    'public.finops_receivables(jsonb)','public.finops_dashboard(jsonb)'] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%finops_can_view_finance_sensitive()%' then
      raise exception 'FIN SELF-TEST: % بلا البوّابة الحسّاسة', f;
    end if;
  end loop;
  foreach f in array array['public.finops_collections_list(jsonb)','public.finops_collections_summary()'] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%finops_can_view_collections()%' then
      raise exception 'FIN SELF-TEST: % بلا بوّابة التحصيل', f;
    end if;
  end loop;
  if pg_get_functiondef(to_regprocedure('public.finops_access()')) ilike '%raise exception%' then
    raise exception 'FIN SELF-TEST: المِجَسّ يرفع استثناء — تفقد الواجهة القدرة على التفريق بين المنع والترحيلة';
  end if;

  -- (7) ★ العميل مستبعد بنيويًّا ★ وبوّابات الموديول مستقلّة عن صلاحية المشاريع
  v_def := pg_get_functiondef(to_regprocedure('public.finops_can_view_finance_sensitive()'));
  if v_def not ilike '%is_staff%' then raise exception 'FIN SELF-TEST: البوّابة الحسّاسة لا تستبعد العميل'; end if;
  foreach f in array array['public.finops_can_view_finance_sensitive()',
    'public.finops_can_view_collections()','public.finops_can_record_collection()',
    'public.finops_can_approve_expense()','public.finops_can_request()'] loop
    if pg_get_functiondef(to_regprocedure(f)) not ilike '%is_staff%' then
      raise exception 'FIN SELF-TEST: % لا تشترط كون المستخدم موظّفًا', f; end if;
    if pg_get_functiondef(to_regprocedure(f)) ilike '%can_manage_projects%' then
      raise exception 'FIN SELF-TEST: % تعتمد can_manage_projects — الموديول يجب أن يملك مُسنَداته', f; end if;
  end loop;

  -- (8) ★ الموظّف لا يرى إلّا صفّه ★ ولا يرفع طلبًا باسم غيره
  v_def := pg_get_functiondef(to_regprocedure('public.finops_my_requests(jsonb)'));
  if v_def not ilike '%requested_by = auth.uid()%' then
    raise exception 'FIN SELF-TEST: قائمة الموظّف غير مقيّدة بصاحب الجلسة'; end if;
  if v_def ilike '%fin_budget%' or v_def ilike '%finops_profit%' or v_def ilike '%fin_revenue%' then
    raise exception 'FIN SELF-TEST: قائمة الموظّف تقرأ ميزانية أو إيرادًا أو ربحية'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.finops_expense_request_submit(jsonb)'));
  if v_def ilike '%p->>''requested_by''%' then
    raise exception 'FIN SELF-TEST: طلب الصرف يقبل هويّة مُرسِل من الحمولة — رفع باسم غيرك ممكن'; end if;
  if v_def not ilike '%requested_by, %' and v_def not ilike '%auth.uid()%' then
    raise exception 'FIN SELF-TEST: طلب الصرف لا يُنسب لصاحب الجلسة'; end if;

  -- (9) ★ فصل المهامّ ★: لا اعتماد ذاتيّ، وسقف الاعتماد مفروض في القاعدة
  v_def := pg_get_functiondef(to_regprocedure('public.finops_expense_decide(uuid,text,text)'));
  if v_def not ilike '%self_approval_forbidden%' then
    raise exception 'FIN SELF-TEST: اعتماد الطلب الذاتيّ غير ممنوع'; end if;
  if v_def not ilike '%threshold_exceeded%' then
    raise exception 'FIN SELF-TEST: سقف الاعتماد غير مفروض في القاعدة'; end if;
  if pg_get_functiondef(to_regprocedure('public.finops_purchase_decide(uuid,text,text)'))
       not ilike '%self_approval_forbidden%' then
    raise exception 'FIN SELF-TEST: اعتماد طلب الشراء الذاتيّ غير ممنوع'; end if;
  -- الحدود يضبطها المالك وحده (لا يرفع المعتمِد سقفه بنفسه)
  v_def := pg_get_functiondef(to_regprocedure('public.finops_threshold_upsert(jsonb)'));
  if v_def not ilike '%is_owner()%' then
    raise exception 'FIN SELF-TEST: حدود الاعتماد يضبطها غير المالك'; end if;
  if v_def ilike '%finops_can_manage()%' then
    raise exception 'FIN SELF-TEST: حدود الاعتماد مفتوحة لمن يعتمد'; end if;
  -- غياب سياسة حدّ = يلزم المالك (الافتراض الأشدّ لا الأسهل)
  v := public.finops_threshold_for('expense', 999999, null, null);
  if coalesce(v->>'required_role','') <> 'owner' then
    raise exception 'FIN SELF-TEST: مبلغ بلا سياسة حدّ لا يشترط المالك — افتراض متساهل'; end if;

  -- (10) ★ عقد الضريبة ★: حقل مستقلّ + إجمالي مولَّد + لا عمود يطوي الضريبة
  foreach t in array MONEY_TABLES loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'vat_amount') then
      raise exception 'FIN SELF-TEST: % بلا حقل ضريبة مستقلّ', t; end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t
                      and column_name = 'amount_gross' and is_generated = 'ALWAYS') then
      raise exception 'FIN SELF-TEST: إجمالي % ليس عمودًا مولَّدًا — يمكن كتابة إجماليّ يُخفي الضريبة', t; end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t
                  and column_name in ('total','amount_total','grand_total')) then
      raise exception 'FIN SELF-TEST: % يحمل عمود مجموع يطوي الضريبة', t; end if;
  end loop;
  foreach t in array array['fin_purchase_request_items','fin_purchase_order_items'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t
                      and column_name = 'line_gross' and is_generated = 'ALWAYS') then
      raise exception 'FIN SELF-TEST: إجمالي سطر % ليس مولَّدًا', t; end if;
  end loop;
  -- مُطبِّع المال يرفض الإجماليّ فعلًا (اختبار يمكن أن يفشل: يتحقّق من السبب)
  begin
    perform public.finops_money('{"amount_gross":"115"}'::jsonb, 15);
    v_err := '';
  exception when others then v_err := SQLERRM;
  end;
  if v_err not ilike '%gross_not_writable%' then
    raise exception 'FIN SELF-TEST: finops_money تقبل إجماليًّا جاهزًا (%). الضريبة ستُطوى.', coalesce(nullif(v_err,''), 'بلا خطأ');
  end if;
  v := public.finops_money('{"amount_net":"100","vat_rate":"15"}'::jsonb, 15);
  if (v->>'vat_amount')::numeric <> 15 or (v->>'amount_gross')::numeric <> 115 then
    raise exception 'FIN SELF-TEST: حساب الضريبة غير صحيح (%)', v::text; end if;

  -- (11) ★ ما هو مشتقّ يبقى مشتقًّا ★ — لا عمود محفوظ يمكن أن ينحرف
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'fin_receivables'
                and column_name in ('collection_status','collected_amount','outstanding','days_overdue','is_overdue')) then
    raise exception 'FIN SELF-TEST: حالة التحصيل محفوظة كعمود — يجب أن تبقى مشتقّة'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'fin_contracts'
                and column_name in ('remaining_balance','invoiced_amount','collected_amount')) then
    raise exception 'FIN SELF-TEST: رصيد العقد محفوظ كعمود — يجب أن يبقى مشتقًّا'; end if;
  v := public.finops_receivable_state(ZERO);
  if coalesce(v->>'reason','') <> 'row_not_found' then
    raise exception 'FIN SELF-TEST: حالة الذمّة لا تُبلّغ عن صفّ غير موجود بصدق'; end if;
  v := public.finops_variance_core(null);
  if coalesce(v->>'reason','') <> 'budget_required' then
    raise exception 'FIN SELF-TEST: محرّك الانحراف لا يُبلّغ عن ميزانية مفقودة بصدق'; end if;
  v := public.finops_profit_core(null, null, null);
  if coalesce(v->>'basis','') <> 'net_of_vat' then
    raise exception 'FIN SELF-TEST: الربح لا يُحسب على الصافي قبل الضريبة'; end if;
  if coalesce((v->>'is_estimate')::boolean, false) is not true then
    raise exception 'FIN SELF-TEST: صافي الربح لا يُعلن أنّه تقديريّ'; end if;

  -- (12) ★ بوّابة الهامش أضيق فعلًا ★ — في الدوالّ وفي سياسات RLS معًا
  if pg_get_functiondef(to_regprocedure('public.finops_profitability(jsonb)'))
       not ilike '%finops_can_view_finance_sensitive()%' then
    raise exception 'FIN SELF-TEST: الربحية بلا البوّابة الحسّاسة'; end if;
  if pg_get_functiondef(to_regprocedure('public.finops_dashboard(jsonb)'))
       not ilike '%profit_visible%' then
    raise exception 'FIN SELF-TEST: اللوحة لا تُصرّح بحجب الربحية'; end if;
  foreach t in array array['fin_revenue','fin_contracts','fin_retainers'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and qual ilike '%finops_can_view_finance_sensitive%') then
      raise exception 'FIN SELF-TEST: سياسة % لا تستعمل البوّابة الحسّاسة', t; end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'fin_expense_requests' and qual ilike '%requested_by = auth.uid()%') then
    raise exception 'FIN SELF-TEST: سياسة طلبات الصرف لا تتيح للموظّف صفّه — أو تتيح له أكثر منه'; end if;

  -- (13) التصدير مُبوَّب ومُدقَّق، ولا SQL حرّ من الواجهة
  v_def := pg_get_functiondef(to_regprocedure('public.finops_export(text,jsonb)'));
  if v_def not ilike '%unknown_dataset%'     then raise exception 'FIN SELF-TEST: التصدير يقبل مجموعة غير معروفة'; end if;
  if v_def not ilike '%finops_log%'          then raise exception 'FIN SELF-TEST: التصدير غير مُدقَّق'; end if;
  -- ★ الصلاحية مقسومة فعلًا: بوّابة شاملة + بوّابة قائمة تحصيل، لا واحدة تكفي للكلّ
  if v_def not ilike '%finops_can_export_sensitive()%' then
    raise exception 'FIN SELF-TEST: التصدير الشامل بلا بوّابته'; end if;
  if v_def not ilike '%finops_can_export_collections()%' then
    raise exception 'FIN SELF-TEST: تصدير التحصيل بلا مفتاحه المستقلّ — الصلاحية غير مقسومة'; end if;

  -- (14) ★ حارس تجميد منصّة المشاريع ★ — لا دالّة من الموديول تكتب في المنصّة
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finops%'
  loop
    if v_def ~* 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b'
    or v_def ~* 'update\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b'
    or v_def ~* 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal|project_[a-z_]+|large_project_[a-z_]+)\b' then
      raise exception 'FIN SELF-TEST: دالّة تكتب في منصّة المشاريع المجمَّدة';
    end if;
  end loop;

  -- (15) ★ صدق Zoho Books ★ — لا حالة إرسال، ولا ادّعاء اتصال، ولا مكالمة خارجية
  if exists (select 1 from pg_constraint
              where conrelid = 'public.fin_zoho_outbox'::regclass and contype = 'c'
                and (pg_get_constraintdef(oid) ilike '%''sent''%'
                  or pg_get_constraintdef(oid) ilike '%''synced''%'
                  or pg_get_constraintdef(oid) ilike '%''delivered''%')) then
    raise exception 'FIN SELF-TEST: صندوق الصادر يملك حالة إرسال — صفّ يستطيع ادّعاء ما لم يحدث'; end if;
  v_def := pg_get_functiondef(to_regprocedure('public.finops_zoho_diagnostic()'));
  if v_def not ilike '%''connected'', false%' then
    raise exception 'FIN SELF-TEST: تشخيص Zoho لا يُثبّت connected=false'; end if;
  if v_def ilike '%''connected'', true%' then
    raise exception 'FIN SELF-TEST: تشخيص Zoho يستطيع ادّعاء الاتصال'; end if;
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finops%'
  loop
    if v_def ~* '\b(pg_net|net\.http_post|net\.http_get|dblink|extension\s+http)\b' then
      raise exception 'FIN SELF-TEST: دالّة في الموديول تحاول مكالمة شبكية خارجية';
    end if;
    if v_def ~* '(client_secret|refresh_token|access_token|api_key|service_role)' then
      raise exception 'FIN SELF-TEST: دالّة في الموديول تتعامل مع بيانات اعتماد';
    end if;
  end loop;

  -- (16) الترحيلة لا تُنشئ بيانات مالية ولا تكتب في التدقيق
  select count(*) into v_n from public.fin_costs;
  if v_n <> 0 then raise exception 'FIN SELF-TEST: الترحيلة أنشأت % صفّ تكلفة', v_n; end if;
  select count(*) into v_n from public.fin_receivables;
  if v_n <> 0 then raise exception 'FIN SELF-TEST: الترحيلة أنشأت ذممًا'; end if;
  select count(*) into v_n from public.fin_audit;
  if v_n <> 0 then raise exception 'FIN SELF-TEST: الترحيلة كتبت في سجلّ التدقيق'; end if;
  select count(*) into v_n from public.fin_zoho_outbox;
  if v_n <> 0 then raise exception 'FIN SELF-TEST: الترحيلة أدرجت في صندوق الصادر'; end if;

  -- (17) لا رقم بنكيّ كامل يدخل جدول المورّدين
  if pg_get_functiondef(to_regprocedure('public.finops_supplier_upsert(jsonb)'))
       not ilike '%bank_ref_too_sensitive%' then
    raise exception 'FIN SELF-TEST: المورّد يقبل رقم حساب بنكيّ كاملًا'; end if;

  -- (18) ★ حمولة جزئية لا تمحو عمودًا ★ — شاشة التعديل تُغذَّى من صفّ قائمة لا
  --      يحمل كلّ الأعمدة، فبلا coalesce يمسح تعديلُ مبلغٍ مركزَ التكلفة والميزانية
  --      والمورّد بصمت. الأربع أدناه هي وحدها التي تُعدَّل من الواجهة اليوم.
  foreach f in array array['public.finops_cost_upsert(jsonb)',
    'public.finops_budget_upsert(jsonb)','public.finops_receivable_upsert(jsonb)',
    'public.finops_supplier_upsert(jsonb)'] loop
    -- ⚠️ الفحص مستقلّ عن المسافات عمدًا: نمط يشترط مسافة واحدة بعد الفاصلة كان
    --    سيفشل على السطور المحاذاة ويُسقط الترحيلة كلّها بلا سبب حقيقيّ.
    v_def := pg_get_functiondef(to_regprocedure(f));
    if v_def not ilike '%coalesce(excluded.cost_center_id%'
       and v_def not ilike '%coalesce(excluded.contact_name%' then
      raise exception 'FIN SELF-TEST: % تمحو أعمدة غائبة عن الحمولة — فقدان بيانات صامت عند التعديل', f;
    end if;
  end loop;

  -- (19) التحصيل يُفحص عند التعديل أيضًا لا عند الإنشاء وحده
  v_def := pg_get_functiondef(to_regprocedure('public.finops_collection_record(jsonb)'));
  if v_def ilike '%v_id is null and (m->>''amount_gross'')%' then
    raise exception 'FIN SELF-TEST: فحص تجاوز المتبقّي مقصور على الإنشاء — تعديل دفعة يستطيع تجاوز المستحقّ';
  end if;
  if v_def not ilike '%v_outstanding := v_outstanding + v_self%' then
    raise exception 'FIN SELF-TEST: التعديل يقيس المبلغ الجديد على متبقٍّ يتضمّن المبلغ القديم';
  end if;

  -- ════════════════════════════════════════════════════════════════════════
  -- (20) ★★ الثابتة الأهمّ: لا دور يجمع طرفَي معادلة الهامش ★★
  --      كلّ فحص هنا ثابت (pg_policies + pg_get_functiondef) ولا يستدعي دالّة
  --      محميّة، لأنّ auth.uid() = NULL في محرّر SQL.
  -- ════════════════════════════════════════════════════════════════════════

  -- (20-أ) كلّ جدول يحمل تكلفةً أو إيرادًا أو ذمّة خلف البوّابة الحسّاسة وحدها.
  --        وجود finops_can_view_collections في qual أيّ منها = عودة الثغرة.
  foreach t in array array['fin_costs','fin_receivables','fin_collections','fin_budgets',
    'fin_budget_lines','fin_contracts','fin_revenue','fin_retainers','fin_suppliers',
    'fin_purchase_orders','fin_purchase_order_items','fin_payment_milestones'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and qual ilike '%finops_can_view_finance_sensitive%') then
      raise exception 'FIN SELF-TEST: سياسة % لا تستعمل البوّابة الحسّاسة', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and (qual ilike '%can_view_collections%' or qual ilike '%can_record_collection%'
                  or qual ilike '%collections_view%')) then
      raise exception 'FIN SELF-TEST: ★ الثغرة عادت ★ — دور التحصيل يملك وصولًا جدوليًّا إلى %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and qual ilike '%finops_perm%') then
      raise exception 'FIN SELF-TEST: سياسة % تُفتح بمفتاح مباشر بدل البوّابة الحسّاسة', t; end if;
  end loop;

  -- ════════════════════════════════════════════════════════════════════════
  -- (20-ب) ★★ الانحدار يُفحص بالمشي على رسم النداء، لا بمطابقة نصّية ★★
  --
  -- الفحص القديم كان: «هل يظهر اسم البوّابة الحسّاسة في نصّ تعريف الدالّة؟».
  -- سقط على finops_can_manage() لأنّها تفوّض بقفزة واحدة:
  --     finops_can_manage → finops_can_manage_finance → البوّابة الحسّاسة
  -- فالاسم ليس في جسمها وهي **منحدرة فعلًا**. كان الفحص معطوبًا لا الدالّة.
  --
  -- البديل هنا محلّل وصول حقيقيّ:
  --   • يقرأ **جسم الدالّة وحده** (prosrc)، لا الملفّ ولا تعريفًا يحمل اسمها
  --     في ترويسته — فالنطاق محصور بالدالّة المفحوصة وبمن تناديه فعلًا.
  --   • ينزع التعليقات (سطرية وكتلية) **قبل** أيّ مطابقة: اسم يظهر في تعليق
  --     لا يُعَدّ نداءً.
  --   • يخفض الحالة، فلا يهمّ أن يرفع المُفكِّك COALESCE إلى حروف كبيرة
  --     (حادثة سابقة في هذا المستودع سببها مطابقة حسّاسة للحالة).
  --   • يلتقط النداءات بنمط «مُعرِّف يليه قوس» لا بنمط [^)]* الذي يتوقّف عند
  --     أوّل قوس (حادثة سابقة أخرى).
  --   • يتبع نداءات finops_* وحدها ويتوقّف عند الجذر: is_owner/is_staff أوراق
  --     تُفحَص هنا صراحةً ولا يُنزَل تحتها.
  --   • يرفض أيّ مُسنَد واسع على الطريق كلّه، لا في الجسم الأوّل فقط.
  -- ════════════════════════════════════════════════════════════════════════
  select lower(regexp_replace(regexp_replace(string_agg(p.prosrc, E'\n'),
                                             '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'))
    into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = ROOT_GATE;
  if v_src is null or btrim(v_src) = '' then
    raise exception 'FIN SELF-TEST: تعذّرت قراءة جسم البوّابة الحسّاسة — المحلّل أجوف ولا يجوز أن يمرّ'; end if;
  if v_src !~ '\mis_owner\M' then
    raise exception 'FIN SELF-TEST: البوّابة الحسّاسة لا تشترط المالك'; end if;
  if v_src !~ '\mis_staff\M' then
    raise exception 'FIN SELF-TEST: البوّابة الحسّاسة لا تستبعد العميل'; end if;
  if v_src !~ '\mcoalesce\M' then
    raise exception 'FIN SELF-TEST: البوّابة الحسّاسة بلا coalesce — NULL سيُقرأ نجاحًا'; end if;
  if v_src !~ '\mauth\M' then
    raise exception 'FIN SELF-TEST: البوّابة الحسّاسة لا تشترط جلسة'; end if;
  foreach t in array BROAD_FNS loop
    if v_src ~ ('\m' || t || '\M') then
      raise exception 'FIN SELF-TEST: البوّابة الحسّاسة تُفتح بـ%() — V1 للمالك وحده', t; end if;
  end loop;

  foreach f in array OWNER_GATES || NO_DESCENT loop
    v_want := not (f = any (NO_DESCENT));
    v_work := array[f]; v_seen := array[]::text[]; v_hit := false; v_hop := 0;
    while coalesce(array_length(v_work, 1), 0) > 0 and v_hop <= 8 loop
      v_next := array[]::text[];
      foreach v_cur in array v_work loop
        if v_cur = any (v_seen) then continue; end if;
        v_seen := v_seen || v_cur;
        if v_cur = ROOT_GATE then
          v_hit := true;
          if v_hop > v_deep then v_deep := v_hop; end if;
          continue;                        -- الجذر طرفيّ: فُحص أعلاه ولا يُنزَل تحته
        end if;
        select lower(regexp_replace(regexp_replace(string_agg(p.prosrc, E'\n'),
                                                   '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'))
          into v_src
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_cur;
        if v_src is null then continue; end if;   -- اسم finops_* بلا دالّة ⇒ الطريق مقطوع
        if v_want then
          if v_src !~ '\mcoalesce\M' then
            raise exception 'FIN SELF-TEST: طريق % يمرّ بـ%() بلا coalesce — NULL سيُقرأ نجاحًا', f, v_cur; end if;
          foreach t in array BROAD_FNS loop
            if v_src ~ ('\m' || t || '\M') then
              raise exception 'FIN SELF-TEST: % تبلغ الحسّاس عبر %() التي تستعمل %() — توسيع صامت', f, v_cur, t;
            end if;
          end loop;
        end if;
        select coalesce(array_agg(distinct rx.m[1]), array[]::text[]) into v_calls
          from regexp_matches(v_src, '([a-z_][a-z0-9_]*)\s*\(', 'g') as rx(m)
         where rx.m[1] like 'finops\_%' and rx.m[1] <> v_cur;
        v_next := v_next || v_calls;
      end loop;
      v_work := v_next; v_hop := v_hop + 1;
    end loop;
    if v_want and not v_hit then
      raise exception 'FIN SELF-TEST: % لا تنحدر إلى البوّابة الحسّاسة — مُشِيَ على % عقدة ولم يُبلَغ الجذر',
        f, coalesce(array_length(v_seen, 1), 0);
    end if;
    if (not v_want) and v_hit then
      raise exception 'FIN SELF-TEST: ضابط لا-الانحدار انكسر — % صارت تبلغ البوّابة الحسّاسة', f; end if;
    if coalesce(array_length(v_seen, 1), 0) = 0 then
      raise exception 'FIN SELF-TEST: المحلّل لم يزر عقدة واحدة عند % — أجوف', f; end if;
  end loop;
  -- ★ لا-فراغ ★ — لا بدّ أن تكون بوّابة واحدة على الأقلّ قد بلغت الجذر بقفزتين
  --   لا بقفزة. لو كان الأقصى قفزة واحدة لكان المحلّل مطابقةً نصّيةً متنكّرة،
  --   ولكان finops_can_manage قد سقط من جديد.
  if v_deep < 2 then
    raise exception 'FIN SELF-TEST: المحلّل لم يعبر أكثر من ضلع واحد (أقصى عمق %) — التفويض غير المباشر لم يُفحص', v_deep;
  end if;

  -- (20-ب-٢) ★ لكلّ بوّابة قابلة للمنح مفتاحها الخاصّ — لا مفتاح يفتح بوّابتين ★
  --   لو حملت بوّابتان المفتاح نفسه لصار منح «عرض التحصيل» منحًا للاعتماد.
  foreach t in array GRANTABLE_KEYS loop
    f := split_part(t, '|', 1);
    select lower(regexp_replace(regexp_replace(string_agg(p.prosrc, E'\n'),
                                               '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g'))
      into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    if v_src is null then raise exception 'FIN SELF-TEST: البوّابة القابلة للمنح % غائبة', f; end if;
    if position(lower(split_part(t, '|', 2)) in v_src) = 0 then
      raise exception 'FIN SELF-TEST: % لا تحمل مفتاحها % — إمّا صارت مرادفًا وإمّا تُفتح بمفتاح غيرها',
        f, split_part(t, '|', 2); end if;
    if v_src !~ '\mcoalesce\M' then
      raise exception 'FIN SELF-TEST: % بلا coalesce — NULL سيُقرأ نجاحًا', f; end if;
    foreach v_cur in array GRANTABLE_KEYS loop
      if split_part(v_cur, '|', 1) <> f
         and position(lower(split_part(v_cur, '|', 2)) in v_src) > 0 then
        raise exception 'FIN SELF-TEST: % تُفتح أيضًا بمفتاح % — الصلاحيتان التصقتا',
          f, split_part(v_cur, '|', 2);
      end if;
    end loop;
  end loop;

  -- (20-ج) سطح التحصيل لا يلمس تكلفةً ولا ميزانية ولا عقدًا ولا إيرادًا ولا
  --        محرّك ربح — فحص نصّيّ على جسم الدالّة نفسها.
  foreach f in array array['public.finops_collections_list(jsonb)',
    'public.finops_collections_summary()'] loop
    v_def := pg_get_functiondef(to_regprocedure(f));
    foreach t in array array['fin_costs','fin_budgets','fin_budget_lines','fin_contracts',
      'fin_revenue','fin_retainers','fin_suppliers','fin_purchase_orders','fin_purchase_order_items',
      'finops_profit_core','finops_variance_core','finops_contract_state'] loop
      if v_def ilike '%' || t || '%' then
        raise exception 'FIN SELF-TEST: سطح التحصيل % يقرأ % — طرف التكلفة يصل دور التحصيل', f, t;
      end if;
    end loop;
    if v_def ilike '%select *%' then
      raise exception 'FIN SELF-TEST: % تستعمل select * — أوّل عمود يُضاف يتسرّب', f; end if;
    if v_def ilike '%r.notes%' then
      raise exception 'FIN SELF-TEST: % تُخرج ملاحظات الذمّة الداخلية', f; end if;
    if v_def ilike '%cost_center_id%' or v_def ilike '%contract_id%' then
      raise exception 'FIN SELF-TEST: % تُخرج ربطًا بمركز تكلفة أو عقد', f; end if;
  end loop;

  -- (20-د) الكتابة المتاحة لدور التحصيل واحدة فقط: تسجيل الدفعة.
  --        أيّ دالّة كتابة أخرى تذكر can_record_collection = توسيع صامت.
  for v_def, v_err in
    select p.proname, pg_get_functiondef(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finops%'
  loop
    if v_err ilike '%finops_can_record_collection()%'
       and v_def not in ('finops_collection_record','finops_can_record_collection',
                         'finops_access','finops_attachment_add') then
      raise exception 'FIN SELF-TEST: % تعترف ببوّابة التحصيل خارج مسارها المحدَّد', v_def;
    end if;
  end loop;

  -- (20-هـ) لا VIEW في الموديول يتجاوز RLS (view يملكه postgres يقرأ كلّ شيء).
  if exists (select 1 from pg_views where schemaname = 'public' and viewname like 'fin\_%') then
    raise exception 'FIN SELF-TEST: يوجد VIEW باسم fin_* — العروض تتجاوز RLS وتفتح طريقًا جانبيًّا';
  end if;

  raise notice 'FIN SELF-TEST: نجح — ٢٢ جدولًا · RLS قراءة فقط · لا anon · مُسنَدات لا تعيد NULL · الضريبة حقل مستقلّ والإجمالي مولَّد · المالية الحسّاسة للمالك وحده ودور التحصيل بلا وصول جدوليّ · Zoho غير متّصل بالتصميم · والمنصّة لم تُمَسّ.';
end $st$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التشغيل: finance_profitability_POSTCHECK.sql
-- المنح: المالية الحسّاسة (تكاليف · ميزانيات · ربحية · مورّدون · ذمم · تصدير
--   شامل) **للمالك وحده في V1**، ولا مفتاح يفتحها — المفاتيح المعطَّلة موسومة
--   بذلك في كتالوج الصلاحيات. القابل للمنح فعلًا:
--     finance_ops.collections_view   → قائمة التحصيل (بلا تكلفة ولا ربح)
--     finance_ops.collections_record → تسجيل دفعة تحصيل + إرفاق سند القبض
--     finance_ops.export_collections → تصدير قائمة التحصيل وحدها
--     finance_ops.approve            → اعتماد طلبات الصرف والشراء
--     finance_ops.request            → رفع طلب صرف شخصيّ
--   ولا شيء يُشتقّ من دور مشاريع، ولا من staff_role.
-- الحدود: اضبط fin_approval_thresholds بحساب المالك — قبل ضبطها كلّ مبلغ
--   يتطلّب اعتماد المالك (افتراض مقصود، لا عطل).
-- التفاصيل: docs/FINANCE_GO_LIVE_GUIDE.md · docs/FINANCE_ROLE_MATRIX.md
-- ════════════════════════════════════════════════════════════════════════════
