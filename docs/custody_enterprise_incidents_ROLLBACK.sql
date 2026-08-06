-- ════════════════════════════════════════════════════════════════════════════
-- CUSTODY ENTERPRISE · INCIDENTS — ROLLBACK
--
-- 🔴 **يتوقّف إن كانت الجداول تحوي بيانات.** بلاغات الحوادث مستندات تشغيلية قد
--    يُبنى عليها تحميل مسؤولية أو مطالبة تأمين — حذفها قرار إنسان لا سكربت.
-- ⛔ ولا يمسّ جدولًا ولا دالّة من حزمة أخرى.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── §0 · حارس البيانات — قبل أيّ إسقاط ───────────────────────────────────
do $$
declare v_inc bigint := 0; v_act bigint := 0; v_del bigint := 0;
begin
  if to_regclass('public.custody_incidents')        is not null then
    select count(*) into v_inc from public.custody_incidents; end if;
  if to_regclass('public.custody_incident_actions') is not null then
    select count(*) into v_act from public.custody_incident_actions; end if;
  if to_regclass('public.custody_alert_deliveries') is not null then
    select count(*) into v_del from public.custody_alert_deliveries; end if;

  if (v_inc + v_act + v_del) > 0 then
    raise exception E'🔴 ROLLBACK متوقّف — الجداول ليست فارغة:\n'
      '  custody_incidents=%  custody_incident_actions=%  custody_alert_deliveries=%\n'
      '⛔ لا يُحذف بلاغ حادث تلقائيًّا. صدّر البيانات واحذفها بقرار موثَّق، '
      'ثمّ أعد تشغيل هذا الملفّ.', v_inc, v_act, v_del;
  end if;
end $$;

-- ─── §1 · السياسات ثمّ الدوالّ ثمّ المُشغِّل ثمّ الجداول ──────────────────
drop policy if exists civ_incidents_read        on public.custody_incidents;
drop policy if exists civ_incident_actions_read on public.custody_incident_actions;
drop policy if exists civ_alert_deliv_read      on public.custody_alert_deliveries;

drop trigger if exists trg_civ_item_hold on public.custody_inventory_assignment_items;

drop function if exists public.custody_run_alerts();
drop function if exists public.civ_alert_once(text,text,text,uuid);
drop function if exists public.custody_inv_admin_incident_action(uuid,text,text,boolean);
drop function if exists public.custody_inv_employee_report_incident(jsonb);
drop function if exists public.civ_item_hold_check();

drop table if exists public.custody_alert_deliveries;
drop table if exists public.custody_incident_actions;
drop table if exists public.custody_incidents;

-- ─── §2 · أعمدة الحجز — ⛔ لا تُسقَط تلقائيًّا ────────────────────────────
-- 🔴 `on_hold` عمود على جدول **حزمة أخرى** (`custody_inventory_assets`).
--    وإسقاطه يفقد أيّ حجز قائم بلا رجعة، وقد يكسر شيفرة تقرؤه.
-- ⚠️ يُبلَّغ فقط، ويُترك القرار للإنسان.
do $$
declare v_held bigint := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name::text='custody_inventory_assets'
                and column_name::text='on_hold') then
    select count(*) into v_held from public.custody_inventory_assets where on_hold = true;
    raise notice '⚠️ on_hold/hold_reason بقيا على custody_inventory_assets (% أصلًا محجوزًا). '
                 'إسقاطهما قرار يدويّ — والأسطر أدناه معطَّلة عمدًا.', v_held;
  end if;
end $$;
-- alter table public.custody_inventory_assets drop column if exists hold_reason;
-- alter table public.custody_inventory_assets drop column if exists on_hold;

-- ─── §3 · تحقّق ما بعد التراجع — المستهدَف وحده أُزيل ─────────────────────
do $$
declare v_left text[] := '{}'; v_t text; v_sig text;
begin
  foreach v_t in array array['custody_incidents','custody_incident_actions','custody_alert_deliveries']
  loop
    if to_regclass('public.'||v_t) is not null then v_left := v_left || ('TABLE '||v_t); end if;
  end loop;
  foreach v_sig in array array['public.custody_run_alerts()','public.civ_alert_once(text,text,text,uuid)',
                               'public.custody_inv_admin_incident_action(uuid,text,text,boolean)',
                               'public.custody_inv_employee_report_incident(jsonb)',
                               'public.civ_item_hold_check()']
  loop
    if to_regprocedure(v_sig) is not null then v_left := v_left || ('FUNCTION '||v_sig); end if;
  end loop;
  if exists (select 1 from pg_trigger where tgname='trg_civ_item_hold' and not tgisinternal) then
    v_left := array_append(v_left, 'TRIGGER trg_civ_item_hold');
  end if;
  if array_length(v_left,1) > 0 then
    raise exception E'🔴 ROLLBACK ناقص — بقي:\n  %', array_to_string(v_left, E'\n  ');
  end if;

  -- ⛔ وتأكيد أنّ جداول الحزم الأخرى **لم تُمَسّ**.
  foreach v_t in array array['custody_inventory_assets','custody_inventory_assignments',
                             'custody_inventory_assignment_items','custody_enterprise_settings']
  loop
    if to_regclass('public.'||v_t) is null then
      raise exception '🔴 ROLLBACK أزال جدولًا من حزمة أخرى: %', v_t;
    end if;
  end loop;
  raise notice '✅ ROLLBACK مكتمل — المستهدَف وحده أُزيل.';
end $$;

commit;
notify pgrst, 'reload schema';
