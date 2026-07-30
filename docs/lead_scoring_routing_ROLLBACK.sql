-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_ROLLBACK.sql — ★ للطوارئ وحدها ★
--
-- ثلاثة مستويات. **المستوى ١ وحده حيّ**؛ المستويان ٢ و٣ معلَّقان سطرًا سطرًا،
-- ويحتاجان إزالة التعليق بيد إنسان. التراجع قرار لا حادث، والملفّ الذي يهدم
-- بمجرّد لصقه في المحرّر هو فخّ لا أداة.
--
-- ─── ما الذي يُفقَد فعلًا في المستوى ٣، بلا تجميل ──────────────────────────
--  ★ يُفقَد نهائيًّا ولا يمكن استرجاعه من أيّ مكان آخر:
--    • lsr_lead_profile   — كلّ السمات التجارية التي أدخلها البشر يدويًّا:
--      نوع الجهة، نوع الخدمة، عدد المواقع والمدن، الاستعجال، مدّة التسليم،
--      احتمال العقد المستمرّ، القيمة السنوية، التعقيد، الإقليم، القطاع
--      الاستراتيجيّ، سبب الخسارة السابقة، وربط العميل الحاليّ.
--      ★ هذه بيانات عمل حقيقية لا نسخة مشتقّة ★
--    • lsr_score_manual   — كلّ تعديل يدويّ للدرجة **وسببه المكتوب**.
--    • lsr_assignments    — تاريخ الإسناد كلّه: من أسند لمن ولماذا، ومن تجاوز
--      ولماذا، ومن كان المالك السابق. هذا سجلّ مساءلة؛ فقده يعني أنّ سؤال
--      «لماذا صار هذا العميل لفلان؟» يصير بلا جواب إلى الأبد.
--    • lsr_audit          — أثر التدقيق كلّه.
--    • lsr_review_queue   — طابور المراجعة وأسبابه.
--    • lsr_event_log      — ★ سجلّ التكرار ★ فقده يعني أنّ أحداثًا سبق إدراجها
--      يمكن أن تُدرَج ثانيةً بعد إعادة التركيب.
--    • lsr_agents / lsr_routing_rules / lsr_rules / lsr_rulesets —
--      القواعد المزروعة تعود بإعادة تشغيل RUNME؛ وما حُرِّر بعدها لا يعود.
--
--  ★ لا يُفقَد ولا يُمسّ في أيّ مستوى:
--    crm_leads وكلّ موديول المبيعات · الاشتراكات · العروض · المالية ·
--    مركز الاتصالات · منصّة المشاريع. هذا الملفّ لا يحذف صفًّا واحدًا منها.
--
--  ⚠️ أثر جانبيّ مقصود ومذكور: عمود crm_leads.owner_user_id الذي كتبته
--     lsr_assign **يبقى كما هو**. لا نُعيد الملكية إلى ما قبل التوزيع، لأنّ
--     «تراجعًا» يغيّر ملكية عملاء يعمل عليهم مندوبون الآن يُحدث ضررًا أكبر
--     ممّا يُصلح. النتيجة: تبقى الملكية، ويضيع **تفسيرها**.
--
-- ─── قبل المستوى ٣ — خُذ نسخة احتياطية بنفسك ───────────────────────────────
--   ★ هذا الملفّ لا يصنع نسخًا ★
--   create table public._bak_lsr_lead_profile as select * from public.lsr_lead_profile;
--   create table public._bak_lsr_assignments  as select * from public.lsr_assignments;
--   create table public._bak_lsr_score_manual as select * from public.lsr_score_manual;
--   create table public._bak_lsr_audit        as select * from public.lsr_audit;
--   create table public._bak_lsr_event_log    as select * from public.lsr_event_log;
--
-- ─── مفاتيح الصلاحيات ───────────────────────────────────────────────────────
--   مفاتيح lead.* و commercial.operations_queue **لا تُحذف في أيّ مستوى**: هي
--   في الكتالوج المشترك، وحذفها يلمس موديولات أخرى. عطّلها يدويًّا إن أردت.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ١ — تعطيل فوريّ **بلا فقد**. آمن، ويُلغى بإعادة تشغيل RUNME.
--
-- استعمله حين تريد إيقاف الأثر الآن والتفكير لاحقًا. بعده:
--   • لا توزيع ولا تقييم من الواجهة: تقول «لا تملك صلاحية» لا «ترحيلة ناقصة».
--   • كلّ البيانات والتاريخ سليمة تمامًا.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $off$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'lsr\_%'
  loop
    begin execute format('revoke all on function %s from authenticated', f.sig);
    exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from anon', f.sig);
    exception when undefined_object then null; end;
  end loop;

  -- إيقاف محرّك التوزيع بلا حذف قاعدة واحدة.
  if to_regclass('public.lsr_routing_rules') is not null then
    update public.lsr_routing_rules set is_active = false where is_active;
  end if;
  if to_regclass('public.lsr_agents') is not null then
    update public.lsr_agents set is_available = false where is_available;
  end if;

  raise notice 'المستوى ١: سُحب التنفيذ وأُوقف التوزيع. لم تُفقد بيانة واحدة، وكلّ توزيع يذهب إلى المراجعة.';
end $off$;

notify pgrst, 'reload schema';
commit;


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ٢ — إزالة المنطق مع **إبقاء البيانات**.
--
-- استعمله حين يكون العطب في دالّة أو سياسة لا في البيانات. بعده تصير الجداول
-- غير مقروءة من الواجهة (RLS مفعّل بلا سياسات = منع شامل)، وكلّ صفوفها باقية.
--
-- ★ أزِل التعليق يدويًّا سطرًا سطرًا ★
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- drop trigger if exists lsr_rules_frozen_trg on public.lsr_rules;
-- drop trigger if exists lsr_lead_profile_touch on public.lsr_lead_profile;
-- drop trigger if exists lsr_agents_touch on public.lsr_agents;
-- drop trigger if exists lsr_routing_rules_touch on public.lsr_routing_rules;
-- drop trigger if exists lsr_rules_touch on public.lsr_rules;
--
-- -- أزِل تسجيلاتنا في مركز الاتصالات وحدها (بادئة commercial.) ولا تلمس غيرها.
-- -- ملاحظة: صفوف comms_outbox **تبقى** — كلّها dry_run لم يغادر منها شيء،
-- -- ومحو أثر لا ضرر منه ليس تراجعًا.
-- do $ev$
-- begin
--   if to_regclass('public.comms_templates') is not null then
--     execute 'delete from public.comms_templates where event_key like ''commercial.%''';
--   end if;
--   if to_regclass('public.comms_event_catalog') is not null then
--     -- ★ execute لا جملة ثابتة ★ ذكر comms_outbox نصًّا يُحلَّل وقت التحليل،
--     --   فلو غاب الجدول لانهار الملفّ بدل أن يتخطّى الفرع.
--     if to_regclass('public.comms_outbox') is not null then
--       execute 'delete from public.comms_event_catalog c
--                 where c.event_key like ''commercial.%''
--                   and not exists (select 1 from public.comms_outbox o
--                                    where o.event_key = c.event_key)';
--     else
--       execute 'delete from public.comms_event_catalog where event_key like ''commercial.%''';
--     end if;
--   end if;
-- end $ev$;
--
-- drop function if exists public.lsr_dashboard_operations(jsonb);
-- drop function if exists public.lsr_dashboard_client(jsonb);
-- drop function if exists public.lsr_dashboard_sales(jsonb);
-- drop function if exists public.lsr_dashboard_owner(jsonb);
-- drop function if exists public.lsr_finance_reference(uuid);
-- drop function if exists public.lsr_events_list(jsonb);
-- drop function if exists public.lsr_event_emit(text,text,uuid,jsonb,text);
-- drop function if exists public.lsr_event_keys();
-- drop function if exists public.lsr_routing_rule_upsert(jsonb);
-- drop function if exists public.lsr_agent_set(jsonb);
-- drop function if exists public.lsr_review_dismiss(uuid,text);
-- drop function if exists public.lsr_review_list(jsonb);
-- drop function if exists public.lsr_assign(jsonb);
-- drop function if exists public.lsr_route_preview(uuid);
-- drop function if exists public.lsr_route_core(uuid);
-- drop function if exists public.lsr_agent_workload(uuid);
-- drop function if exists public.lsr_ruleset_publish(int,text);
-- drop function if exists public.lsr_rule_upsert(jsonb);
-- drop function if exists public.lsr_ruleset_clone(text);
-- drop function if exists public.lsr_score_manual_set(jsonb);
-- drop function if exists public.lsr_profile_set(jsonb);
-- drop function if exists public.lsr_score_scan(jsonb);
-- drop function if exists public.lsr_score(uuid);
-- drop function if exists public.lsr_score_core(uuid);
-- drop function if exists public.lsr_rule_matches(text,text,jsonb,text,text,numeric,numeric,text[]);
-- drop function if exists public.lsr_context(uuid);
-- drop function if exists public.lsr_access();
-- drop function if exists public.lsr_log(text,text,uuid,text,jsonb);
-- drop function if exists public.lsr_touch();
-- drop function if exists public.lsr_rules_frozen();
-- drop function if exists public.lsr_norm_city(text);
-- drop function if exists public.lsr_bool(jsonb,text);
-- drop function if exists public.lsr_num(jsonb,text);
-- drop function if exists public.lsr_txt(jsonb,text);
-- drop function if exists public.lsr_setting_bool(text,boolean);
-- drop function if exists public.lsr_setting_int(text,int);
-- -- ★ المُسنَدات أخيرًا ★ سياسات RLS تعتمد عليها، وحذفها قبل إسقاط السياسات
-- --   يفشل بـdependency. أسقِط السياسات أوّلًا إن أردت إبقاء الجداول مقروءة.
-- drop function if exists public.lsr_can_view_ops_queue() cascade;
-- drop function if exists public.lsr_can_view_owner_dashboard() cascade;
-- drop function if exists public.lsr_can_reassign() cascade;
-- drop function if exists public.lsr_can_route() cascade;
-- drop function if exists public.lsr_can_override_score() cascade;
-- drop function if exists public.lsr_can_manage_scoring() cascade;
-- drop function if exists public.lsr_can_view() cascade;
-- drop function if exists public.lsr_is_sales_manager() cascade;
-- drop function if exists public.lsr_is_client() cascade;
-- drop function if exists public.lsr_is_owner_role() cascade;
-- drop function if exists public.lsr_perm(text) cascade;
--
-- notify pgrst, 'reload schema';
-- commit;


-- ════════════════════════════════════════════════════════════════════════════
-- المستوى ٣ — ★★ إزالة كاملة · هنا يقع فقد البيانات ★★
--
-- لا تُشغّله قبل أن تقرأ رأس هذا الملفّ كاملًا وتأخذ نسخة احتياطية بنفسك.
-- الترتيب يحترم المفاتيح الأجنبية الداخلية (lsr_rules → lsr_rulesets).
--
-- ★ أزِل التعليق يدويًّا سطرًا سطرًا ★
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- drop table if exists public.lsr_event_log;
-- drop table if exists public.lsr_audit;
-- drop table if exists public.lsr_review_queue;
-- drop table if exists public.lsr_assignments;
-- drop table if exists public.lsr_routing_rules;
-- drop table if exists public.lsr_agents;
-- drop table if exists public.lsr_score_manual;
-- drop table if exists public.lsr_territories;
-- drop table if exists public.lsr_lead_profile;
-- drop table if exists public.lsr_rules;
-- drop table if exists public.lsr_rulesets;
-- drop table if exists public.lsr_factors;
-- drop table if exists public.lsr_settings;
--
-- -- تحقّق داخل المعاملة: نصف تراجع أسوأ من عدمه.
-- do $verify$
-- declare v_t int; v_f int;
-- begin
--   select count(*) into v_t from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'lsr\_%';
--   select count(*) into v_f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'lsr\_%';
--   if v_t <> 0 or v_f <> 0 then
--     raise exception 'ROLLBACK غير مكتمل: % جدولًا و% دالّة ما زالت قائمة. لم يُلتزَم بشيء.', v_t, v_f;
--   end if;
--   raise notice 'المستوى ٣: أُزيلت الحزمة بالكامل. المبيعات والاشتراكات والعروض والمالية والمشاريع لم تُمسّ.';
-- end $verify$;
--
-- notify pgrst, 'reload schema';
-- commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد أيّ مستوى: crm_leads.owner_user_id يبقى كما هو (انظر رأس الملفّ)، وأيّ
-- سطح كان يعرض التقييم سيقول «الميزة بانتظار تفعيل قاعدة البيانات» — وهي
-- الرسالة الصادقة: الكود موجود، والقاعدة لم تعد تحمل الحزمة.
-- ════════════════════════════════════════════════════════════════════════════
