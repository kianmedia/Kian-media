-- ════════════════════════════════════════════════════════════════════════════
-- CUSTODY ENTERPRISE · INCIDENTS + HOLD + ALERTS — حزمة إصدار ذرّية
--
-- تحلّ محلّ `custody_enterprise_03_incidents_alerts_PATCH.sql` كحزمة تشغيل.
-- ⚠️ ويبقى ملفّ الـPATCH في المستودع **مرجعًا تاريخيًّا فقط** — ⛔ لا يُشغَّل.
--
-- ★★ 🔴 لماذا حزمة جديدة لا تشغيل الـPATCH ★★
--   الـPATCH يحوي **ثلاث معاملات مستقلّة** (`begin`…`commit` ×٣). فلو فشل
--   الجزء الثاني أو الثالث، بقي الأوّل مطبَّقًا: أعمدة وحوادث بلا RLS ولا
--   صلاحيات — وهي أسوأ حالة ممكنة (بيانات بلا حارس). هنا **معاملة واحدة**.
--   وقسم التحقّق فيه `select` فقط، فينتهي بحالة خروج 0 مهما كان الناقص.
--
-- 🔴 **prerequisite رسميّ لـ`wave6_compliance_knowledge_RUNME.sql`**: تلك الحزمة
--    تقرأ `public.custody_incidents` في فرع `union` **بلا حارس وجود** داخل
--    `hse_register_v`، فغياب الجدول يُفشل `create view` ويُسقط حزمتها كلّها.
--
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1` — أيّ خطأ يُرجع حالة غير صفرية ويتراجع الكلّ.
-- ⛔ ولا بذور · لا تنبيهات تُنشأ · لا cron · لا اتصال خارجيّ.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── §0 · حارس اعتمادات صلب داخل المعاملة ─────────────────────────────────
-- ⚠️ PREFLIGHT يُشغَّل منفصلًا وقد يُنسى. هذا الحارس يجعل التشغيل فوق قاعدة
--    ناقصة **مستحيلًا** لا غير محبَّذ.
do $$
declare v_missing text[] := '{}'; v_t text; v_sig text;
begin
  foreach v_t in array array['custody_inventory_assets','custody_inventory_assignments',
                             'custody_inventory_assignment_items','custody_enterprise_settings']
  loop
    if to_regclass('public.'||v_t) is null then v_missing := v_missing || ('TABLE '||v_t); end if;
  end loop;
  -- 🔴 التواقيع بـ`to_regprocedure`: `to_regproc` لا تقبل توقيعًا وتُعيد NULL دائمًا.
  foreach v_sig in array array['public.is_staff()','public.civ_flag(text)',
                               'public.civ_gen_no(text)','public.civ_can_manage()',
                               'public.civ_notify(uuid,text,uuid,text,text)',
                               'public.civ_notify_managers(text,uuid,text,text)',
                               'public.custody_audit(text,text,uuid,jsonb)']
  loop
    if to_regprocedure(v_sig) is null then v_missing := v_missing || ('GATE '||v_sig); end if;
  end loop;
  if array_length(v_missing,1) > 0 then
    raise exception E'🔴 CUSTODY INCIDENTS: اعتمادات مفقودة:\n  %', array_to_string(v_missing, E'\n  ');
  end if;
end $$;

-- ─── §1 · Hold على الأصل ───────────────────────────────────────────────────
alter table public.custody_inventory_assets add column if not exists on_hold boolean not null default false;
alter table public.custody_inventory_assets add column if not exists hold_reason text;

create or replace function public.civ_item_hold_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.custody_inventory_assets where id = new.asset_id and on_hold = true) then
    raise exception 'asset_on_hold';   -- محتجز للمراجعة (حادث) — لا يُصرف
  end if;
  return new;
end; $$;

-- 🔴 `insert or update of asset_id` لا `insert` وحده.
-- المُشغِّل الأصليّ كان على الإدراج فقط، فتغييرُ `asset_id` في صفّ قائم كان
-- يتجاوز الحجز تمامًا. ومسحُ المستودع أثبت أنّ **لا مسار واحد يعدّل `asset_id`**
-- اليوم (كل التحديثات على status/quantity/notes) ⇒ التوسعة **محايدة سلوكيًّا
-- الآن** وتُغلق الثغرة إن أُضيف مسار لاحقًا. تشديدٌ بالدليل لا بالتخمين.
drop trigger if exists trg_civ_item_hold on public.custody_inventory_assignment_items;
create trigger trg_civ_item_hold
  before insert or update of asset_id on public.custody_inventory_assignment_items
  for each row execute function public.civ_item_hold_check();

-- ─── §2 · الحوادث والبلاغات ────────────────────────────────────────────────
create table if not exists public.custody_incidents (
  id                uuid primary key default gen_random_uuid(),
  incident_number   text not null unique,
  assignment_id     uuid references public.custody_inventory_assignments(id),
  asset_id          uuid references public.custody_inventory_assets(id),
  incident_type     text not null check (incident_type in ('damage','loss','theft','missing_accessory','technical_failure','accident','water_damage','impact','battery_issue','storage_media_issue','other')),
  occurred_at       timestamptz,
  location_text     text,
  gps_lat           double precision,
  gps_lng           double precision,
  description       text,
  witnesses         text,
  used_by           uuid references auth.users(id),
  was_work_stopped  boolean not null default false,
  immediate_action  text,
  external_reported boolean not null default false,
  police_ref        text,
  status            text not null default 'open' check (status in ('open','under_review','converted_maintenance','converted_insurance','employee_liability','closed_no_action','legal_followup')),
  resolution_note   text,
  reported_by       uuid references auth.users(id),
  reviewed_by       uuid references auth.users(id),
  reviewed_at       timestamptz,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_civ_incidents_status on public.custody_incidents(status) where is_deleted = false;
create index if not exists idx_civ_incidents_asset  on public.custody_incidents(asset_id);

create table if not exists public.custody_incident_actions (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.custody_incidents(id) on delete cascade,
  action_type  text not null,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 بلاغ الموظّف — مع إصلاح ربط الحادثة بالأصل
--
-- ★ العيب في النسخة السابقة ★
--   كانت تتحقّق أنّ `assignment_id` **للموظّف نفسه**، ⛔ ولا تتحقّق إطلاقًا أنّ
--   `asset_id` ينتمي إلى تلك العهدة ولا إلى الموظّف أصلًا. فكان بإمكانه تسجيل
--   حادثة تربط عهدته برقم أصل **يخصّ موظّفًا آخر** — سجلّ كاذب في نظام قد
--   يُبنى عليه تحميل مسؤولية أو مطالبة تأمين.
--   (الحجز التلقائيّ كان محميًّا، لكنّ **صفّ الحادثة نفسه** لم يكن.)
--
-- ★ العقد الآن — fail-closed ★
--   • `asset_id` وحده ⇒ يجب أن يكون ضمن عهدة (حالية أو سابقة) لهذا الموظّف.
--   • `asset_id` + `assignment_id` ⇒ يجب أن يكون بندًا في **تلك العهدة** بعينها.
--   • ⛔ وإلّا رُفض البلاغ — ولا يُسجَّل ثمّ يُصحَّح لاحقًا.
--   ⚠️ ورسائل الرفض لا تكشف مالك الأصل ولا وجوده من عدمه.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.custody_inv_employee_report_incident(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth.uid(); v_asset uuid; v_assign uuid; v_no text; v_id uuid;
        v_asset_is_his boolean := false;
begin
  if v_emp is null then raise exception 'unauthenticated'; end if;
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if not public.civ_flag('incident_reporting_enabled') then raise exception 'incidents_disabled'; end if;
  v_assign := nullif(p_data->>'assignment_id','')::uuid;
  v_asset  := nullif(p_data->>'asset_id','')::uuid;

  -- العهدة — إن ذُكرت — للموظّف نفسه.
  if v_assign is not null and not exists (
       select 1 from public.custody_inventory_assignments
        where id = v_assign and employee_user_id = v_emp and is_deleted = false)
  then raise exception 'not_your_assignment'; end if;

  -- 🔴 الأصل — إن ذُكر — يجب أن يعود إليه فعلًا.
  if v_asset is not null then
    if v_assign is not null then
      -- كلاهما ⇒ الأصل بندٌ في **تلك** العهدة تحديدًا.
      select exists (
        select 1 from public.custody_inventory_assignment_items i
         where i.assignment_id = v_assign and i.asset_id = v_asset) into v_asset_is_his;
      if not v_asset_is_his then raise exception 'asset_not_in_assignment'; end if;
    else
      -- الأصل وحده ⇒ ضمن أيّ عهدة له (حالية أو سابقة).
      select exists (
        select 1 from public.custody_inventory_assignment_items i
          join public.custody_inventory_assignments a on a.id = i.assignment_id
         where i.asset_id = v_asset and a.employee_user_id = v_emp) into v_asset_is_his;
      if not v_asset_is_his then raise exception 'asset_not_yours'; end if;
    end if;
  end if;

  v_no := public.civ_gen_no('INC');
  insert into public.custody_incidents(incident_number, assignment_id, asset_id, incident_type, occurred_at, location_text,
    gps_lat, gps_lng, description, witnesses, used_by, was_work_stopped, immediate_action, external_reported, police_ref, reported_by)
  values (v_no, v_assign, v_asset, coalesce(nullif(p_data->>'incident_type',''),'other'), nullif(p_data->>'occurred_at','')::timestamptz,
    nullif(trim(p_data->>'location_text'),''), nullif(p_data->>'gps_lat','')::double precision, nullif(p_data->>'gps_lng','')::double precision,
    nullif(trim(p_data->>'description'),''), nullif(trim(p_data->>'witnesses'),''), v_emp, coalesce((p_data->>'was_work_stopped')::boolean,false),
    nullif(trim(p_data->>'immediate_action'),''), coalesce((p_data->>'external_reported')::boolean,false), nullif(trim(p_data->>'police_ref'),''), v_emp)
  returning id into v_id;

  -- ⚠️ الحجز التلقائيّ: الملكية أُثبتت أعلاه، فلا فحص ثانٍ. ولا يحجز موظّفٌ
  --    أصلًا ليس له (منعُ تعطيل الصرف).
  if v_asset is not null and v_asset_is_his then
    update public.custody_inventory_assets
       set on_hold = true, hold_reason = 'incident ' || v_no
     where id = v_asset;
  end if;

  perform public.custody_audit('incident_reported', 'custody_incidents', v_id, jsonb_build_object('type', p_data->>'incident_type'));
  perform public.civ_notify_managers('custody_incident_reported', v_id, 'بلاغ حادث/تلف: ' || v_no, 'Incident reported: ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_id, 'incident_number', v_no);
end; $$;

-- ─── إجراء الإدارة: تحويل/إغلاق + تحرير أو إبقاء Hold ─────────────────────
-- 🔴 رفع الحجز يتطلّب `civ_can_manage()` **و**`p_release_hold = true` صراحةً.
-- ⚠️ و`hold_reason` تُصفَّر مع `on_hold` معًا — فلا تبقى حالة متناقضة
--    (`on_hold=false` مع سبب حجز معلّق).
create or replace function public.custody_inv_admin_incident_action(p_incident uuid, p_status text, p_note text, p_release_hold boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_asset uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_status not in ('under_review','converted_maintenance','converted_insurance','employee_liability','closed_no_action','legal_followup')
    then raise exception 'bad_status'; end if;
  update public.custody_incidents set status = p_status, resolution_note = coalesce(nullif(trim(p_note),''), resolution_note),
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p_incident and is_deleted = false returning asset_id into v_asset;
  if not found then raise exception 'not_found'; end if;
  insert into public.custody_incident_actions(incident_id, action_type, note, created_by) values (p_incident, p_status, nullif(trim(p_note),''), auth.uid());
  if coalesce(p_release_hold, false) and v_asset is not null then
    update public.custody_inventory_assets set on_hold = false, hold_reason = null where id = v_asset;
  end if;
  perform public.custody_audit('incident_action', 'custody_incidents', p_incident, jsonb_build_object('status', p_status));
  perform public.civ_notify_managers('custody_incident_updated', p_incident, 'تحديث بلاغ حادث', 'Incident updated');
  return true;
end; $$;

-- ─── §3 · محرّك التنبيهات (سجلّ التسليم + إزالة التكرار) ───────────────────
-- ⛔ لا يُشغَّل المحرّك هنا، ولا يُنشأ تنبيه واحد أثناء التطبيق.
create table if not exists public.custody_alert_deliveries (
  id            uuid primary key default gen_random_uuid(),
  dedup_key     text not null unique,          -- يمنع تكرار نفس التنبيه
  alert_type    text not null,
  entity_type   text,
  entity_id     uuid,
  channel       text not null default 'portal',
  status        text not null default 'sent' check (status in ('sent','failed','skipped')),
  retry_count   int not null default 0,
  last_attempt_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_civ_alert_deliv on public.custody_alert_deliveries(alert_type, created_at desc);

-- ⚠️ **`when others then return false` مُبقًى كما هو — عن قصد.**
--    يُخفي أخطاء تشغيلية (مثل عمود مفقود) خلف «لم يُنشأ تنبيه»، وهو سلوك يستحقّ
--    المراجعة. ⛔ لكنّ تغييره يغيّر سلوك محرّك التنبيهات كلّه، ولا يُغيَّر بلا
--    اختبار على قاعدة — وهذا خارج نطاق هذه الحزمة.
--    🔵 مسجَّل كقرار مفتوح في OVERNIGHT_DECISIONS_REQUIRED.md.
create or replace function public.civ_alert_once(p_key text, p_type text, p_etype text, p_eid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.custody_alert_deliveries(dedup_key, alert_type, entity_type, entity_id) values (p_key, p_type, p_etype, p_eid);
  return true;
exception when unique_violation then return false; when others then return false;
end; $$;

create or replace function public.custody_run_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_esc int; v_due int := 0; v_over int := 0; v_esc_n int := 0; v_warr int := 0; v_pend int := 0; v_day text := to_char(now(),'YYYYMMDD');
begin
  select overdue_escalation_hours into v_esc from public.custody_enterprise_settings where id = 1;
  v_esc := coalesce(v_esc, 24);
  if not public.civ_flag('overdue_alerts_enabled') then return jsonb_build_object('ok', true, 'disabled', true); end if;

  -- قرب الاستحقاق (خلال 24 ساعة) — مرة يوميًا لكل عهدة.
  for r in select id, employee_user_id, assignment_number from public.custody_inventory_assignments
    where is_deleted=false and status in ('active','partially_returned') and expected_return_at is not null
      and expected_return_at between now() and now() + interval '24 hours' loop
    if public.civ_alert_once('due:'||r.id||':'||v_day, 'custody_due_soon', 'custody_inventory_assignments', r.id) then
      perform public.civ_notify(r.employee_user_id, 'custody_due_soon', r.id, 'يقترب موعد إرجاع عهدتك ' || r.assignment_number, 'Custody due soon: ' || r.assignment_number);
      v_due := v_due + 1; end if;
  end loop;

  -- متأخرة — تذكير يومي للموظف.
  for r in select id, employee_user_id, assignment_number, expected_return_at from public.custody_inventory_assignments
    where is_deleted=false and status in ('active','partially_returned') and expected_return_at is not null and expected_return_at < now() loop
    if public.civ_alert_once('over:'||r.id||':'||v_day, 'custody_overdue', 'custody_inventory_assignments', r.id) then
      perform public.civ_notify(r.employee_user_id, 'custody_overdue', r.id, 'عهدتك ' || r.assignment_number || ' متأخرة الإرجاع', 'Custody overdue: ' || r.assignment_number);
      v_over := v_over + 1; end if;
    -- تصعيد للإدارة بعد تجاوز عتبة الساعات.
    if r.expected_return_at < now() - (v_esc || ' hours')::interval then
      if public.civ_alert_once('esc:'||r.id||':'||v_day, 'custody_escalated', 'custody_inventory_assignments', r.id) then
        perform public.civ_notify_managers('custody_escalated', r.id, 'تصعيد: عهدة متأخرة ' || r.assignment_number, 'Escalation: overdue custody ' || r.assignment_number);
        v_esc_n := v_esc_n + 1; end if;
    end if;
  end loop;

  -- طلبات إرجاع معلّقة أكثر من 48 ساعة بلا فحص.
  for r in select id, assignment_number from public.custody_inventory_assignments
    where is_deleted=false and status='return_requested' and updated_at < now() - interval '48 hours' loop
    if public.civ_alert_once('pend:'||r.id||':'||v_day, 'custody_escalated', 'custody_inventory_assignments', r.id) then
      perform public.civ_notify_managers('custody_escalated', r.id, 'طلب إرجاع بانتظار الفحص منذ مدة ' || r.assignment_number, 'Return pending inspection: ' || r.assignment_number);
      v_pend := v_pend + 1; end if;
  end loop;

  -- ضمانات تنتهي خلال 30 يومًا — مرة شهريًا.
  for r in select id, asset_code from public.custody_inventory_assets
    where is_deleted=false and warranty_expiry_date is not null and warranty_expiry_date between current_date and current_date + 30 loop
    if public.civ_alert_once('warr:'||r.id||':'||to_char(now(),'YYYYMM'), 'insurance_expiring', 'custody_inventory_assets', r.id) then
      perform public.civ_notify_managers('civ_warranty_expiring', r.id, 'ضمان أصل ينتهي قريبًا: ' || r.asset_code, 'Warranty expiring: ' || r.asset_code);
      v_warr := v_warr + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'due_soon', v_due, 'overdue', v_over, 'escalated', v_esc_n, 'return_pending', v_pend, 'warranty', v_warr);
end; $$;


-- ─── §4 · RLS والسياسات ───────────────────────────────────────────────────
alter table public.custody_incidents          enable row level security;
alter table public.custody_incident_actions   enable row level security;
alter table public.custody_alert_deliveries   enable row level security;
drop policy if exists civ_incidents_read on public.custody_incidents;
create policy civ_incidents_read on public.custody_incidents for select to authenticated
  using (public.civ_can_manage() or reported_by = auth.uid());
drop policy if exists civ_incident_actions_read on public.custody_incident_actions;
create policy civ_incident_actions_read on public.custody_incident_actions for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_alert_deliv_read on public.custody_alert_deliveries;
create policy civ_alert_deliv_read on public.custody_alert_deliveries for select to authenticated using (public.civ_can_manage());

-- ⛔ ولا صلاحيات هنا: كلّها في §5 موضعًا **واحدًا**. وتكرارها في موضعين يجعل
--    حذف أحدهما بلا أثر ظاهر، فيمرّ إسقاطُ حارسٍ صامتًا.

-- ─── §5 · الصلاحيات — REVOKE أوّلًا ثمّ منح محدَّد ─────────────────────────
grant select on public.custody_incidents, public.custody_incident_actions, public.custody_alert_deliveries to authenticated;

revoke execute on function public.custody_inv_employee_report_incident(jsonb) from public, anon;
revoke execute on function public.custody_inv_admin_incident_action(uuid,text,text,boolean) from public, anon;
grant execute on function public.custody_inv_employee_report_incident(jsonb) to authenticated;
grant execute on function public.custody_inv_admin_incident_action(uuid,text,text,boolean) to authenticated;

-- 🔴 المحرّك ودالّة إزالة التكرار ودالّة المُشغِّل: خادميّة بحتة.
revoke execute on function public.custody_run_alerts() from public, anon, authenticated;
revoke execute on function public.civ_alert_once(text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.civ_item_hold_check() from public, anon, authenticated;
grant  execute on function public.custody_run_alerts() to service_role;

commit;

-- ⚠️ **بعد** COMMIT فقط: إشعار PostgREST بإعادة تحميل المخطّط.
notify pgrst, 'reload schema';
