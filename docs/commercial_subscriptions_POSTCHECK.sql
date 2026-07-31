-- ════════════════════════════════════════════════════════════════════════════
-- commercial_subscriptions_POSTCHECK.sql        **قراءة فقط · Result Set واحد**
--
-- محرّر Supabase يعرض آخر Result Set فقط، فالحكم كلّه مجموع هنا في جدول واحد:
-- ord · check_name · expected · actual · verdict.
--
-- ⛔ لا يستدعي دالّة تحتاج جلسة GoTrue: المحرّر يعمل بدور `postgres` بلا جلسة،
--    وأيّ نداء محميّ يرفع «not authorized» قبل بلوغ منطقه — وهذا بالضبط ما
--    أسقط حزمة سابقة بعد ترحيل **ناجح**. المُسنَدات هنا تُستدعى بلا جلسة وهي
--    تُعيد false بلا استثناء، وباقي الفحوص بنيويّة (pg_catalog + نصّ التعريف).
--
-- القراءة: كلّ صفّ verdict = 'PASS' ⇒ الحزمة في حالتها المقصودة. لا يوجد
-- «FAIL مقبول». الصفّ الأخير 'CHECK' وحده يُقارَن يدويًّا بأرقام PREFLIGHT.
-- ════════════════════════════════════════════════════════════════════════════
with
tabs as (
  select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in
     ('csub_settings','csub_unit_types','csub_plans','csub_plan_units','csub_plan_versions',
      'csub_subscriptions','csub_subscription_units','csub_periods','csub_approval_requests',
      'csub_ledger','csub_audit')),
-- ⚠️ يُعَدّ RLS على **جداول هذه الحزمة الأحد عشر بالاسم** لا على كلّ csub_*:
--    دفعات لاحقة تضيف جداول csub_ أخرى (طلبات الخدمة مثلًا)، وعدٌّ شامل كان
--    سيقلب هذا الصفّ إلى FAIL كاذب لمجرّد أنّ الحزمة التالية طُبِّقت.
--    أمّا فحوص الصلاحيات (anon / authenticated) فتبقى شاملة عمدًا: أيّ جدول
--    csub_ جديد يُمنح كتابةً مباشرة يجب أن يظهر هنا.
rls as (
  select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relname in
     ('csub_settings','csub_unit_types','csub_plans','csub_plan_units','csub_plan_versions',
      'csub_subscriptions','csub_subscription_units','csub_periods','csub_approval_requests',
      'csub_ledger','csub_audit')),
allcsub as (
  select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'csub\_%'),
wpol as (
  select count(*)::int as n from pg_policies
   where schemaname = 'public' and tablename like 'csub\_%' and cmd <> 'SELECT'),
immut as (
  select count(*)::int as n from pg_trigger
   where not tgisinternal and tgrelid = to_regclass('public.csub_ledger')
     and tgname in ('t_csub_ledger_no_update','t_csub_ledger_no_delete','t_csub_ledger_no_truncate')),
postt as (
  select count(*)::int as n from pg_trigger
   where not tgisinternal and tgname = 't_csub_ledger_post'),
uq as (
  select count(*)::int as n from pg_indexes where schemaname = 'public'
     and indexname in ('uq_csub_ledger_idem','uq_csub_ledger_reversal')),
funcs as (
  select count(*)::int as n from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
   where nn.nspname = 'public' and p.proname like 'csub\_%'),
notdef as (
  select coalesce(string_agg(p.proname, ', '), '') as s
    from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
   where nn.nspname = 'public' and p.proname like 'csub\_%'
     and (not p.prosecdef or coalesce(array_to_string(p.proconfig, ','), '') not ilike '%search_path%')),
anonf as (
  select coalesce(string_agg(p.proname, ', '), '') as s
    from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
   where nn.nspname = 'public' and p.proname like 'csub\_%'
     and exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
anont as (
  select coalesce(string_agg(table_name || ':' || privilege_type, ', '), '') as s
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'csub\_%' and grantee = 'anon'),
authw as (
  select coalesce(string_agg(table_name || ':' || privilege_type, ', '), '') as s
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'csub\_%'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'),
intern as (
  select coalesce(string_agg(f.sig, ', '), '') as s from (values
    ('public.csub_activate_core(uuid,text)'),('public.csub_renew_core(uuid,jsonb)'),
    ('public.csub_balance_core(uuid,text)'),('public.csub_available_core(uuid,text)'),
    ('public.csub_log(text,text,uuid,jsonb)'),('public.csub_ledger_post()'),
    ('public.csub_approval_submit_core(text,uuid,text,numeric,jsonb,text)')) f(sig)
   where to_regprocedure(f.sig) is not null
     and exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_function_privilege('authenticated', f.sig, 'EXECUTE')),
preds as (
  select (public.csub_can_view() is false and public.csub_can_manage() is false
      and public.csub_can_consume() is false and public.csub_can_adjust() is false
      and public.csub_can_view_pricing() is false and public.csub_can_export() is false
      and public.csub_can_approve() is false and public.csub_is_owner_role() is false
      and public.csub_is_client() is false and public.csub_perm('csub.manage') is false
      and public.csub_client_owns('00000000-0000-0000-0000-000000000000') is false) as ok),
approve as (select pg_get_functiondef(to_regprocedure('public.csub_can_approve()')) as d),
act as (select pg_get_functiondef(to_regprocedure('public.csub_subscription_activate(uuid,text)')) as d),
ren as (select pg_get_functiondef(to_regprocedure('public.csub_subscription_renew(uuid,jsonb)')) as d),
cons as (select pg_get_functiondef(to_regprocedure('public.csub_consume(jsonb)')) as d),
post as (select pg_get_functiondef(to_regprocedure('public.csub_ledger_post()')) as d),
imm as (select pg_get_functiondef(to_regprocedure('public.csub_ledger_immutable()')) as d),
writers as (
  select coalesce(string_agg(f.sig, ', '), '') as s from (values
    ('public.csub_reserve(jsonb)'),('public.csub_release(jsonb)'),('public.csub_consume(jsonb)'),
    ('public.csub_reverse(jsonb)'),('public.csub_adjust(jsonb)')) f(sig)
   where to_regprocedure(f.sig) is null
      or pg_get_functiondef(to_regprocedure(f.sig)) !~* 'for\s+update'
      or pg_get_functiondef(to_regprocedure(f.sig)) not ilike '%idempotency_key%'
      or pg_get_functiondef(to_regprocedure(f.sig)) not ilike '%csub_log%'),
autoren as (
  select coalesce(string_agg(f.sig, ', '), '') as s from (values
    ('public.csub_activate_core(uuid,text)'),('public.csub_renew_core(uuid,jsonb)'),
    ('public.csub_subscription_renew(uuid,jsonb)'),('public.csub_consume(jsonb)'),
    ('public.csub_period_close(jsonb)'),('public.csub_expiry_scan(jsonb)')) f(sig)
   where to_regprocedure(f.sig) is not null
     and pg_get_functiondef(to_regprocedure(f.sig)) ilike '%auto_renew%'),
clientleak as (
  select coalesce(string_agg(f.sig, ', '), '') as s from (values
    ('public.csub_my_subscriptions()'),('public.csub_my_balances(uuid)'),
    ('public.csub_my_statement(uuid,jsonb)')) f(sig)
   where to_regprocedure(f.sig) is null
      or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%internal_notes%'
      or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%internal_metadata%'
      or pg_get_functiondef(to_regprocedure(f.sig)) ilike '%csub_audit%'),
frozen as (
  select coalesce(string_agg(p.proname, ', '), '') as s
    from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
   where nn.nspname = 'public' and p.proname like 'csub\_%'
     and pg_get_functiondef(p.oid) ~* '((insert\s+into|update|delete\s+from)\s+public\.(projects|project_core|deliverables|deliverable_internal|project_transition_requests)\M|can_manage_projects|is_kian_member)'),
badcol as (
  select coalesce(string_agg(table_name || '.' || column_name, ', '), '') as s
    from information_schema.columns
   where table_schema = 'public' and table_name like 'csub\_%'
     and (column_name = 'balance' or column_name like '%\_balance'
          or column_name like '%cost%' or column_name like '%margin%' or column_name like '%profit%')),
softdel as (
  select count(*)::int as n from information_schema.columns
   where table_schema = 'public' and table_name = 'csub_ledger' and column_name = 'is_deleted'),
vat as (
  select (select is_generated from information_schema.columns
           where table_schema='public' and table_name='csub_plans' and column_name='price_gross') as a,
         (select is_generated from information_schema.columns
           where table_schema='public' and table_name='csub_subscriptions' and column_name='price_gross') as b,
         (select is_generated from information_schema.columns
           where table_schema='public' and table_name='csub_ledger' and column_name='overage_amount_gross') as c),
sar as (
  select count(distinct con.conrelid)::int as n from pg_constraint con
   where con.conrelid in (to_regclass('public.csub_plans'), to_regclass('public.csub_subscriptions'),
                          to_regclass('public.csub_ledger'))
     and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%currency%'
     and pg_get_constraintdef(con.oid) ilike '%SAR%'),
units as (select count(*)::int as n from public.csub_unit_types),
unitmiss as (
  select coalesce(string_agg(k, ', '), '') as s
    from unnest(array['filming_day','filming_hour','photography_session','edited_reel','editing_hour',
      'motion_graphics_hour','drone_session','drone_hour','event_coverage','podcast_episode',
      'design_item','live_stream_day','custom_unit']) k
   where not exists (select 1 from public.csub_unit_types t where t.key = k)),
perms as (
  select case when to_regclass('public.permissions') is null then -1
              else (select count(*)::int from public.permissions where key like 'csub.%') end as n,
         case when to_regclass('public.permissions') is null then 0
              else (select count(*)::int from public.permissions where key = 'csub.approve') end as bad),
biz as (
  select (select count(*) from public.csub_subscriptions)::int as s,
         (select count(*) from public.csub_ledger)::int as l),
plat as (
  select (select count(*) from pg_policies where schemaname = 'public'
            and tablename in ('projects','project_core','deliverables','deliverable_internal'))::int as pc,
         (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'projects')::int as cc),

-- ════════════════════════════════════════════════════════════════════════════
-- الفحوص ٣٤ … ٤٧ — أُضيفت بعد سقوط §17 عند قائمة المنع.
--
-- ⚠️ منهج هذه الكتلة: **قائمة سماح**. الفحص القديم كان يمنع أسماء تحوي
--    '%price%' أو '%amount%' أو '%vat%' … فأسقط الترحيلة على
--    reservation_entry_id («reser·VAT·ion») وهو uuid لا مال فيه، وكان في
--    الوقت نفسه سيمرّر unit_rate أو overage_value بلا اعتراض. لا قائمة منع
--    بالسلاسل الجزئية في هذا الملفّ.
-- ════════════════════════════════════════════════════════════════════════════

-- عمود في جدول الطلبات خارج قائمة السماح التشغيلية.
srallow as (
  select coalesce(string_agg(column_name, ', ' order by column_name), '') as s
    from information_schema.columns
   where table_schema = 'public' and table_name = 'csub_service_requests'
     and column_name <> all (array[
       'id','code','client_id','subscription_id','unit_type','status',
       'units','credits_required','overage_estimate_units',
       'city','location_text','preferred_date','alternative_date','scheduled_date',
       'description','contact_person_name','contact_person_phone','is_urgent',
       'client_notes','client_decision_note','internal_notes','decision_reason',
       'reservation_entry_id','consumption_entry_id','approval_request_id',
       'project_id','project_linked_at','project_linked_by',
       'submitted_at','decided_at','decided_by','fulfilled_at',
       'created_by','created_at','updated_at','is_deleted','deleted_reason'])),
sraallow as (
  select coalesce(string_agg(column_name, ', ' order by column_name), '') as s
    from information_schema.columns
   where table_schema = 'public' and table_name = 'csub_service_request_attachments'
     and column_name <> all (array[
       'id','request_id','file_name','mime_type','size_bytes','note',
       'uploaded_by','created_at','is_deleted'])),

-- ما يقرأه سطح التشغيل من صفّ الطلب — بوّابة ثانية أضيق من أعمدة الجدول.
opsallow as (
  select coalesce(string_agg(distinct x.k, ', '), '') as s
    from regexp_matches(
           regexp_replace(
             coalesce(pg_get_functiondef(to_regprocedure('public.csub_service_requests_list(jsonb)')), ''),
             chr(45) || chr(45) || '[^' || chr(10) || ']*', ' ', 'g'),
           '\mr\.([a-z_][a-z0-9_]*)', 'g') m
    cross join lateral (select m[1]) x(k)
   where x.k <> all (array[
     'id','code','status','client_id','subscription_id','unit_type',
     'units','credits_required','overage_estimate_units',
     'city','location_text','preferred_date','alternative_date','scheduled_date',
     'description','contact_person_name','contact_person_phone','is_urgent',
     'client_notes','internal_notes','decision_reason',
     'reservation_entry_id','consumption_entry_id','approval_request_id',
     'project_id','submitted_at','decided_at','fulfilled_at','created_at','is_deleted'])),

-- عمود رقميّ على الجدولين خارج عدّادات الوحدات الثلاثة. مطابقة **بالنوع**،
-- فلا يمكن لمفتاح uuid أن يظهر هنا مهما كان اسمه.
opsnumeric as (
  select coalesce(string_agg(table_name || '.' || column_name, ', '
                             order by table_name, column_name), '') as s
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('csub_service_requests','csub_service_request_attachments')
     and data_type in ('numeric','double precision','real','money')
     and column_name not in ('units','credits_required','overage_estimate_units')),

-- ⚠️ أنماط regex تُبنى بـchr(59) لا بفاصلة منقوطة حرفية: هذا الملفّ **جملة
--    واحدة** بحكم عقده، ومحرّر Supabase يعرض النتيجة الأخيرة فقط. فاصلة
--    منقوطة داخل سلسلة نصّية تبدو للقارئ الآليّ جملةً ثانيةً وتُسقط العقد.
-- ⚠️ ولا حدّ تكرار {n,m} في أيّ نمط هنا: محرّك regex في PostgreSQL يسقُف الحدّ
--    عند 255 (RE_DUP_MAX)، و{0,400} خطأ ترجمة 2201B لا نمط ضيّق — وهو ما أسقط
--    RUNME على الإنتاج. الصنف المَنفيّ `[^;]` خطّيّ أصلًا فالحدّ لم يشترِ شيئًا،
--    وإزالته أصحّ: تقنيعٌ أطول من الحدّ كان يفلت من الحذف فيُقرأ تسريبًا كاذبًا.
pat as (
  select chr(45) || chr(45) || '[^' || chr(10) || ']*' as p_comment,
         '''[a-z_]+''\s*,\s*case\s+when\s+v_price\s+then[^' || chr(59)
           || ']*?else\s+null\s+end' as p_masked_key,
         'case\s+when\s+v_price\s+then[^' || chr(59)
           || ']*?else\s+null\s+end' as p_masked,
         '-\s*''[a-z_]+''' as p_dropped,
         'return\s+jsonb_build_object\(([^' || chr(59) || ']*?)\)' || chr(59) as p_return),

-- ★ المال لا يخرج من سطح موظّف بلا مفتاح الأسعار ★
-- المنهج: احذف الذكر المُقنَّع (case when v_price … else null end) والمُسقَط
-- (- 'عمود') والتعليقات، ثمّ ابحث عمّا بقي. الباقي يخرج خامًا.
pricedleak as (
  select coalesce(string_agg(distinct f.sig || ' → ' || m.col, ', '), '') as s
    from (values ('public.csub_plans_list(jsonb)'),('public.csub_plan_detail(uuid)'),
                 ('public.csub_subscriptions_list(jsonb)'),('public.csub_subscription_detail(uuid)'),
                 ('public.csub_balances(uuid)'),('public.csub_statement(uuid,jsonb)'),
                 ('public.csub_dashboard(jsonb)')) f(sig)
   cross join (values ('price_net'),('price_gross'),('vat_amount'),('vat_rate'),
                      ('price_is_custom'),('plan_snapshot'),('overage_unit_price_net'),
                      ('overage_vat_rate'),('overage_amount_net'),('overage_vat_amount'),
                      ('overage_amount_gross'),('unit_price'),('unit_rate'),('unit_cost'),
                      ('internal_cost'),('margin'),('profit'),('profitability'),
                      ('discount'),('contract_value'),('renewal_value'),('minimum_price'),
                      ('invoice_amount'),('receivable')) m(col)
   cross join pat
   where to_regprocedure(f.sig) is not null
     and regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(pg_get_functiondef(to_regprocedure(f.sig)),
                              pat.p_comment, ' ', 'g'),
               pat.p_masked_key, ' ', 'gi'),
             pat.p_masked, ' ', 'gi'),
           pat.p_dropped, ' ', 'gi') ~* ('\m' || m.col || '\M')),

-- to_jsonb خام على وحدات الخطّة/الاشتراك = قائمة سماح مفتوحة، أي لا قائمة.
rawjsonb as (
  select coalesce(string_agg(f.sig, ', '), '') as s
    from (values ('public.csub_plan_detail(uuid)'),
                 ('public.csub_subscription_detail(uuid)')) f(sig)
   cross join pat
   where to_regprocedure(f.sig) is not null
     -- التعليقات تُحذف أوّلًا: تعليق يشرح to_jsonb(pu) ليس استعمالًا له.
     and regexp_replace(pg_get_functiondef(to_regprocedure(f.sig)), pat.p_comment, ' ', 'g')
         ~* 'to_jsonb\(\s*(pu|u)\s*\)'),

-- الجداول الحاملة للمال: سياسة القراءة بمفتاح الأسعار، لا ببوّابة التشغيل.
moneyrls as (
  select coalesce(string_agg(t.name, ', ' order by t.name), '') as s
    from (values ('csub_plans'),('csub_plan_units'),('csub_plan_versions'),
                 ('csub_subscriptions'),('csub_subscription_units'),('csub_ledger')) t(name)
   where to_regclass('public.' || t.name) is not null
     and (not exists (select 1 from pg_policies
                       where schemaname = 'public' and tablename = t.name and cmd = 'SELECT'
                         and coalesce(qual, '') ilike '%csub_can_view_pricing%')
       or exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t.name and cmd = 'SELECT'
                     and coalesce(qual, '') ~* '\mcsub_can_view\(\)'))),

-- عزل العميل: لا سياسة جدولية واحدة تعترف بالعميل. RLS تصفّي صفوفًا لا أعمدة،
-- فأيّ سياسة عميل تعني internal_notes مقروءة عبر PostgREST مباشرةً.
clientiso as (
  select coalesce(string_agg(tablename || '.' || policyname, ', '
                             order by tablename, policyname), '') as s
    from pg_policies
   where schemaname = 'public' and tablename like 'csub\_%'
     and coalesce(qual, '') ~* '(my_client_id|csub_is_client|csub_client_owns)'),

-- ★ لا استهلاك مزدوج ★ مفتاح تكرار فريد + منع إعادة استعمال اعتماد التجاوز
-- + منع استهلاك طلب خدمة مرّتين.
dblcons as (
  select (select count(*) from pg_indexes where schemaname = 'public'
            and indexname = 'uq_csub_ledger_idem')::int as idx,
         coalesce(pg_get_functiondef(to_regprocedure('public.csub_consume(jsonb)')), '') as d),

-- ★ اعتماد التجاوز معزول ★ الطلب لا يتقدّم قبل قرار المالك، والقرار يُقرأ من
-- صفّ الاعتماد لا من صلاحية المُنادي.
ovgiso as (
  select coalesce(pg_get_functiondef(
           to_regprocedure('public.csub_request_transition(uuid,text,text,text,date)')), '') as d),

-- نطاق المبيعات: csub.manage لا يمنح رؤية السعر. لو اشتقّ أحدهما من الآخر
-- لانهار الفصل بين «يدير الاشتراكات» و«يرى الأرقام».
salescope as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.csub_can_manage()')), '') as m,
         coalesce(pg_get_functiondef(to_regprocedure('public.csub_can_view_pricing()')), '') as p),

-- ★ لا مِجَسّ سعر ★ لا مفردة مال في جواب أيّ دالّة دفتر: لا مبلغ بجوار عدد
-- وحدات يُطرح منه سعر الوحدة، ولا عتبة ماليّة تُبحَث ثنائيًّا برايةٍ منطقية.
oracle as (
  select coalesce(string_agg(distinct f.sig || ' → ' || m.col, ', '), '') as s
    from (values ('public.csub_reserve(jsonb)'),('public.csub_release(jsonb)'),
                 ('public.csub_consume(jsonb)'),('public.csub_reverse(jsonb)'),
                 ('public.csub_adjust(jsonb)'),
                 ('public.csub_request_submit(jsonb)'),
                 ('public.csub_request_transition(uuid,text,text,text,date)'),
                 ('public.csub_request_set_credits(uuid,numeric,text)'),
                 ('public.csub_service_requests_list(jsonb)'),
                 ('public.csub_my_credits_page(uuid)')) f(sig)
   cross join (values ('price_net'),('price_gross'),('vat_amount'),('vat_rate'),
                      ('overage_unit_price_net'),('overage_amount_net'),
                      ('overage_amount_gross'),('unit_price'),('unit_rate'),
                      ('cost'),('margin'),('profit'),('discount'),
                      ('contract_value'),('minimum_price')) m(col)
   cross join pat
   where to_regprocedure(f.sig) is not null
     and exists (
       select 1 from regexp_matches(
              regexp_replace(pg_get_functiondef(to_regprocedure(f.sig)),
                             pat.p_comment, ' ', 'g'),
              pat.p_return, 'g') rm
        where rm[1] ~* ('\m' || m.col || '\M'))),

-- الحزم الأربع المطبَّقة — تُعَدّ بسوابق كائناتها هي، لا بادّعاء.
applied4 as (
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'comms\_%')::int as comms_t,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ops\_%')::int   as ops_t,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\_%')::int   as crm_t,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'fin\_%')::int   as fin_t),

-- التواصل ما زال محاكاةً. النصّ يُختار قبل تنفيذه، فغياب الجدول لا يصير خطأً.
commsdry as (
  select (xpath('/row/v/text()', query_to_xml(
            case when to_regclass('public.comms_channels') is not null
                 then 'select count(*)::text as v from public.comms_channels
                        where (enabled and channel <> ''portal'') or not dry_run'
                 else 'select ''-1'' as v' end, false, true, '')))[1]::text as s),

-- لا حالة نصفية: الجداول والدوالّ والمُشغِّلات متّسقة معًا.
partial as (
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'csub\_%')::int as t,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'csub\_%')::int as f,
         (select count(*) from pg_trigger where not tgisinternal
            and tgname in ('t_csub_ledger_no_update','t_csub_ledger_no_delete',
                           't_csub_ledger_no_truncate','t_csub_ledger_post'))::int as g)
select * from (
  select 1::numeric as ord, 'الجداول الأحد عشر موجودة' as check_name, '11' as expected,
         tabs.n::text as actual, case when tabs.n = 11 then 'PASS' else 'FAIL' end as verdict from tabs
  union all select 2, 'RLS مفعّلة على جداول هذه الحزمة الأحد عشر', '11', rls.n::text,
         case when rls.n = 11 then 'PASS' else 'FAIL' end from rls
  union all select 2.5, 'إجمالي جداول csub_ في القاعدة (توثيقيّ — دفعات لاحقة تزيده)', '>= 11',
         allcsub.n::text, case when allcsub.n >= 11 then 'PASS' else 'FAIL' end from allcsub
  union all select 3, 'لا سياسة كتابة مباشرة (كلّ كتابة عبر RPC)', '0', wpol.n::text,
         case when wpol.n = 0 then 'PASS' else 'FAIL' end from wpol
  union all select 4, '★★ مُشغِّلات منع تعديل/حذف/تفريغ الدفتر', '3', immut.n::text,
         case when immut.n = 3 then 'PASS' else 'FAIL' end from immut
  union all select 5, 'مُشغِّل الترحيل المحاسبيّ موجود', '1', postt.n::text,
         case when postt.n = 1 then 'PASS' else 'FAIL' end from postt
  union all select 6, 'دالّة المنع ترفع 0A000 ولا تعيد NEW', 'raise 0A000',
         case when imm.d ilike '%0A000%' and imm.d not ilike '%return new%' then 'raise 0A000' else 'ضعيفة' end,
         case when imm.d ilike '%0A000%' and imm.d not ilike '%return new%' then 'PASS' else 'FAIL' end from imm
  union all select 7, 'الدفتر بلا حذف ليّن (سجلّ محاسبيّ لا تُخفى صفوفه)', '0', softdel.n::text,
         case when softdel.n = 0 then 'PASS' else 'FAIL' end from softdel
  union all select 8, 'فهرسا مفتاح التكرار ومنع العكس المزدوج', '2', uq.n::text,
         case when uq.n = 2 then 'PASS' else 'FAIL' end from uq
  union all select 9, 'عدد دوالّ الموديول', '>= 62', funcs.n::text,
         case when funcs.n >= 62 then 'PASS' else 'FAIL' end from funcs
  union all select 10, 'كلّ الدوالّ SECURITY DEFINER بمسار بحث مثبَّت', 'لا استثناء',
         case when notdef.s = '' then 'لا استثناء' else notdef.s end,
         case when notdef.s = '' then 'PASS' else 'FAIL' end from notdef
  union all select 11, 'لا EXECUTE لـanon على أيّ دالّة', 'لا شيء',
         case when anonf.s = '' then 'لا شيء' else anonf.s end,
         case when anonf.s = '' then 'PASS' else 'FAIL' end from anonf
  union all select 12, 'لا صلاحية جدول لـanon', 'لا شيء',
         case when anont.s = '' then 'لا شيء' else anont.s end,
         case when anont.s = '' then 'PASS' else 'FAIL' end from anont
  union all select 13, '★ authenticated لا يملك إلّا SELECT — الدفتر غير قابل للكتابة مباشرة', 'لا شيء',
         case when authw.s = '' then 'لا شيء' else authw.s end,
         case when authw.s = '' then 'PASS' else 'FAIL' end from authw
  union all select 14, 'النوى الداخلية غير ممنوحة لـauthenticated', 'لا شيء',
         case when intern.s = '' then 'لا شيء' else intern.s end,
         case when intern.s = '' then 'PASS' else 'FAIL' end from intern
  union all select 15, 'المُسنَدات تعيد false بلا جلسة (لا NULL ولا fail-open)', 'true',
         preds.ok::text, case when preds.ok then 'PASS' else 'FAIL' end from preds
  union all select 16, '★★ اعتماد المالك لا يُشترى بمفتاح صلاحية', 'بلا csub_perm',
         case when approve.d ilike '%csub_perm%' then 'يمرّ بمفتاح' else 'بلا csub_perm' end,
         case when approve.d not ilike '%csub_perm%' and approve.d ilike '%csub_is_owner_role%'
              then 'PASS' else 'FAIL' end from approve
  union all select 17, 'لا مفتاح csub.approve في الكتالوج', '0',
         case when perms.bad < 0 then 'لا كتالوج' else perms.bad::text end,
         case when perms.bad = 0 then 'PASS' else 'FAIL' end from perms
  union all select 18, '★★ التفعيل يمرّ ببوّابة المالك حصرًا', 'csub_can_approve()',
         case when act.d ilike '%csub_can_approve()%' then 'csub_can_approve()' else 'غائبة' end,
         case when act.d ilike '%csub_can_approve()%' and act.d not ilike '%csub_perm(%'
              then 'PASS' else 'FAIL' end from act
  union all select 19, '★★ التجديد يمرّ ببوّابة المالك حصرًا', 'csub_can_approve()',
         case when ren.d ilike '%csub_can_approve()%' then 'csub_can_approve()' else 'غائبة' end,
         case when ren.d ilike '%csub_can_approve()%' then 'PASS' else 'FAIL' end from ren
  union all select 20, '★★ كلّ كاتب في الدفتر: قفل صفّ + مفتاح تكرار + تدقيق', 'لا استثناء',
         case when writers.s = '' then 'لا استثناء' else writers.s end,
         case when writers.s = '' then 'PASS' else 'FAIL' end from writers
  union all select 21, '★★ الاستهلاك يحمل الاستحالات الستّ صراحةً', 'كلّها',
         case when cons.d ilike '%insufficient_balance%' and cons.d ilike '%subscription_not_active%'
               and cons.d ilike '%subscription_expired%' and cons.d ilike '%unit_not_in_subscription%'
               and cons.d ilike '%service_request_already_consumed%' and cons.d ilike '%idempotency_key_required%'
              then 'كلّها' else 'ناقصة' end,
         case when cons.d ilike '%insufficient_balance%' and cons.d ilike '%subscription_not_active%'
               and cons.d ilike '%subscription_expired%' and cons.d ilike '%unit_not_in_subscription%'
               and cons.d ilike '%service_request_already_consumed%' and cons.d ilike '%idempotency_key_required%'
              then 'PASS' else 'FAIL' end from cons
  union all select 22, '★★ العميل يُشتقّ من الاشتراك داخل مُشغِّل الترحيل', 'ledger_client_mismatch',
         case when post.d ilike '%ledger_client_mismatch%' then 'ledger_client_mismatch' else 'غائب' end,
         case when post.d ilike '%ledger_client_mismatch%' and post.d ilike '%unit_not_in_subscription%'
               and post.d ilike '%reservation_exhausted%'
              then 'PASS' else 'FAIL' end from post
  union all select 23, '★ auto_renew لا يُقرأ في أيّ مسار منح رصيد', 'لا شيء',
         case when autoren.s = '' then 'لا شيء' else autoren.s end,
         case when autoren.s = '' then 'PASS' else 'FAIL' end from autoren
  union all select 24, '★ واجهة العميل بلا حقول داخلية ولا سجلّ تدقيق', 'لا تسريب',
         case when clientleak.s = '' then 'لا تسريب' else clientleak.s end,
         case when clientleak.s = '' then 'PASS' else 'FAIL' end from clientleak
  union all select 25, '★ لا كتابة في منصّة المشاريع ولا استعمال لبوّاباتها', 'لا شيء',
         case when frozen.s = '' then 'لا شيء' else frozen.s end,
         case when frozen.s = '' then 'PASS' else 'FAIL' end from frozen
  union all select 26, '★ لا عمود رصيد محفوظ ولا تكلفة/هامش/ربح', 'لا شيء',
         case when badcol.s = '' then 'لا شيء' else badcol.s end,
         case when badcol.s = '' then 'PASS' else 'FAIL' end from badcol
  union all select 27, '★ الإجمالي عمود مولَّد في الثلاثة (الضريبة لا تُطوى)', 'ALWAYS×3',
         coalesce(vat.a,'-') || '/' || coalesce(vat.b,'-') || '/' || coalesce(vat.c,'-'),
         case when vat.a = 'ALWAYS' and vat.b = 'ALWAYS' and vat.c = 'ALWAYS' then 'PASS' else 'FAIL' end from vat
  union all select 28, 'قيد العملة SAR على الجداول المالية الثلاثة', '3', sar.n::text,
         case when sar.n = 3 then 'PASS' else 'FAIL' end from sar
  union all select 29, 'أنواع الوحدات الثلاثة عشر مبذورة', 'لا نقص',
         case when unitmiss.s = '' then 'لا نقص' else unitmiss.s end,
         case when unitmiss.s = '' then 'PASS' else 'FAIL' end from unitmiss
  union all select 30, 'عدد أنواع الوحدات', '>= 13', units.n::text,
         case when units.n >= 13 then 'PASS' else 'FAIL' end from units
  union all select 31, 'مفاتيح csub.* مبذورة (أو الكتالوج غير مطبَّق — المالك وحده)', '6',
         case when perms.n < 0 then 'لا كتالوج' else perms.n::text end,
         case when perms.n = 6 or perms.n < 0 then 'PASS' else 'FAIL' end from perms
  union all select 32, 'الترحيلة لم تُنشئ بيانات عمل (اشتراكات / قيود)', '0 / 0',
         biz.s::text || ' / ' || biz.l::text,
         case when biz.s = 0 and biz.l = 0 then 'PASS' else 'CHECK — قد تكون بيانات حقيقية من تشغيل سابق' end from biz
  union all select 33, 'تجميد المنصّة — قارن يدويًّا بأرقام PREFLIGHT §7', 'مطابق لـPREFLIGHT',
         plat.pc::text || ' policies / ' || plat.cc::text || ' projects columns', 'CHECK' from plat

  -- ─── ٣٤ … ٤٧ — ما أضافته معالجة سقوط §17 ────────────────────────────────
  union all select 34, '★ لا حالة نصفية — الجداول والدوالّ والمُشغِّلات متّسقة', '13 / >=62 / 4',
         partial.t::text || ' / ' || partial.f::text || ' / ' || partial.g::text,
         case when partial.t >= 13 and partial.f >= 62 and partial.g = 4 then 'PASS' else 'FAIL' end
         from partial
  union all select 35, '★★ قائمة سماح أعمدة الطلبات (لا قائمة منع بالسلاسل) ★★', 'لا عمود خارجها',
         case when srallow.s = '' then 'لا عمود خارجها' else srallow.s end,
         case when srallow.s = '' then 'PASS' else 'FAIL' end from srallow
  union all select 36, 'قائمة سماح أعمدة المرفقات', 'لا عمود خارجها',
         case when sraallow.s = '' then 'لا عمود خارجها' else sraallow.s end,
         case when sraallow.s = '' then 'PASS' else 'FAIL' end from sraallow
  union all select 37, '★ سطح التشغيل لا يقرأ عمودًا خارج قائمة السماح', 'لا شيء',
         case when opsallow.s = '' then 'لا شيء' else opsallow.s end,
         case when opsallow.s = '' then 'PASS' else 'FAIL' end from opsallow
  union all select 38, '★ لا عمود رقميّ تشغيليّ غير عدّاد وحدات (مطابقة بالنوع)', 'لا شيء',
         case when opsnumeric.s = '' then 'لا شيء' else opsnumeric.s end,
         case when opsnumeric.s = '' then 'PASS' else 'FAIL' end from opsnumeric
  union all select 39, '★★ لا مبلغ يخرج من سطح موظّف بلا مفتاح الأسعار ★★', 'لا تسريب',
         case when pricedleak.s = '' then 'لا تسريب' else pricedleak.s end,
         case when pricedleak.s = '' then 'PASS' else 'FAIL' end from pricedleak
  union all select 40, '★ الوحدات تُسقَط بالاسم لا بـto_jsonb خام', 'لا شيء',
         case when rawjsonb.s = '' then 'لا شيء' else rawjsonb.s end,
         case when rawjsonb.s = '' then 'PASS' else 'FAIL' end from rawjsonb
  union all select 41, '★★ التشغيل لا يُمنح الجدول الماليّ أصلًا (RLS بمفتاح الأسعار) ★★', 'لا شيء',
         case when moneyrls.s = '' then 'لا شيء' else moneyrls.s end,
         case when moneyrls.s = '' then 'PASS' else 'FAIL' end from moneyrls
  union all select 42, '★ عزل العميل بنيويّ — لا سياسة جدولية تعترف بالعميل', 'لا شيء',
         case when clientiso.s = '' then 'لا شيء' else clientiso.s end,
         case when clientiso.s = '' then 'PASS' else 'FAIL' end from clientiso
  union all select 43, '★★ لا استهلاك مزدوج — مفتاح فريد + اعتماد يُستهلك مرّة + طلب لا يُستهلك مرّتين',
         'الثلاثة',
         case when dblcons.idx = 1 and dblcons.d ilike '%overage_approval_already_used%'
               and dblcons.d ilike '%service_request_already_consumed%'
              then 'الثلاثة' else 'ناقصة' end,
         case when dblcons.idx = 1 and dblcons.d ilike '%overage_approval_already_used%'
               and dblcons.d ilike '%service_request_already_consumed%'
              then 'PASS' else 'FAIL' end from dblcons
  union all select 44, '★★ اعتماد التجاوز معزول — الحُكم صفّ الاعتماد لا صلاحية المُنادي',
         'overage_not_approved',
         case when ovgiso.d ilike '%overage_not_approved%'
               and ovgiso.d ilike '%v_ap.status <> ''approved''%'
              then 'overage_not_approved' else 'غائب' end,
         case when ovgiso.d ilike '%overage_not_approved%'
               and ovgiso.d ilike '%v_ap.status <> ''approved''%'
              then 'PASS' else 'FAIL' end from ovgiso
  union all select 45, '★ نطاق المبيعات — csub.manage لا يمنح رؤية السعر', 'مفتاحان منفصلان',
         case when salescope.m not ilike '%csub_can_view_pricing%'
               and salescope.m not ilike '%csub.view_pricing%'
               and salescope.p ilike '%csub.view_pricing%'
              then 'مفتاحان منفصلان' else 'مشتقّ أحدهما من الآخر' end,
         case when salescope.m not ilike '%csub_can_view_pricing%'
               and salescope.m not ilike '%csub.view_pricing%'
               and salescope.p ilike '%csub.view_pricing%'
              then 'PASS' else 'FAIL' end from salescope
  union all select 46, '★★ لا مِجَسّ سعر ولا مِجَسّ ربح — لا مبلغ في جواب أيّ دالّة ★★', 'لا شيء',
         case when oracle.s = '' then 'لا شيء' else oracle.s end,
         case when oracle.s = '' then 'PASS' else 'FAIL' end from oracle
  union all select 47, '★ التواصل ما زال محاكاةً — لا قناة تستطيع الإرسال', '0 أو -1',
         coalesce(commsdry.s, 'unknown'),
         case when coalesce(commsdry.s, '') in ('0','-1') then 'PASS' else 'FAIL' end from commsdry
  union all select 48, '★★ الحزم الأربع المطبَّقة سليمة (تواصل · تشغيل · CRM · مالية) ★★',
         '>=7 / >=20 / >=20 / >=22',
         applied4.comms_t::text || ' / ' || applied4.ops_t::text || ' / '
           || applied4.crm_t::text || ' / ' || applied4.fin_t::text,
         case when applied4.comms_t >= 7 and applied4.ops_t >= 20
               and applied4.crm_t >= 20 and applied4.fin_t >= 22
              then 'PASS' else 'FAIL' end from applied4
) q order by ord;
