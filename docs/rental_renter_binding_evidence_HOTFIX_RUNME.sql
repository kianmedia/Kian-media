-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — RENTER LEGAL-BINDING + EVIDENCE HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- يجعل طلب المستأجر ملزِمًا قانونيًا ومُوثَّقًا عند الإنشاء:
--   • هوية إلزامية: الاسم الكامل + الجوال + نوع/رقم الهوية + العنوان.
--   • توقيع إقرار/عقد قانوني من حساب المستأجر عند إنشاء الطلب.
--   • صورة إلزامية لكل معدة (حد أدنى 1) + صورة إجمالية (حد أدنى 1) عند الإنشاء.
--   • اختيار المعدة بالباركود/QR/الكود.
--   • تذكير قبل موعد التسليم (بوابة+إيميل) — يشغّله الكرون اليومي (دقة تقريبية).
-- idempotent · غير هدّام · لا يحذف طلبات/عملاء · لا يعيد Foundation · بلا Fixtures.
-- يُشغَّل بعد ملفات التأجير الحالية. الخطوة اليدوية الوحيدة لهذا الإصلاح = تشغيله كاملًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null or to_regclass('public.custody_rental_evidence') is null
     or to_regclass('public.custody_rental_customers') is null or to_regclass('public.custody_inventory_assets') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.civ_flag(text)') is null or to_regprocedure('public.civ_client_ip()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة.';
  end if;
  -- يعتمد على الطبقة التشغيلية (free_qty/recheck) — طبّق الـHotfix التشغيلي أولًا.
  if to_regprocedure('public.custody_rental_free_qty(uuid,timestamptz,timestamptz,uuid)') is null
     or to_regprocedure('public.custody_rental_recheck(uuid)') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_portal_operational_HOTFIX_RUNME.sql أولًا (custody_rental_free_qty/recheck مفقودة).';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;

-- ─── 1) أعمدة الإقرار/التوقيع عند الإنشاء + التذكير + توسيع مراحل الأدلة ───
alter table public.custody_rental_requests add column if not exists consent_signature_path text;
alter table public.custody_rental_requests add column if not exists consent_signed_at       timestamptz;
alter table public.custody_rental_requests add column if not exists consent_text            text;
alter table public.custody_rental_requests add column if not exists consent_ip              text;
alter table public.custody_rental_requests add column if not exists consent_ua              text;
alter table public.custody_rental_requests add column if not exists reminder_sent_at        timestamptz;

-- توسيع مراحل الأدلة: request (صور الإنشاء) + closeout (صور الإقفال) — مع الحفاظ على السابق.
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
commit;

-- ─── 2) دليل مرحلة الإنشاء للمستأجر (ملكيته فقط) ───
begin;
create or replace function public.custody_rental_customer_add_request_evidence(p_request uuid, p_item uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if p_item is not null and not exists (select 1 from public.custody_rental_items where id = p_item and request_id = p_request) then raise exception 'item_not_in_request'; end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, uploaded_by)
    values (p_request, p_item, 'request', p_path, auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
commit;

-- ─── 3) البحث عن معدة بالباركود/QR/الكود للمستأجر (أعمدة آمنة + توفّر) ───
begin;
create or replace function public.custody_rental_customer_lookup_asset(p_code text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_free numeric; v_photo text; v_code text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  v_code := nullif(trim(coalesce(p_code,'')),'');
  if v_code is null then raise exception 'code_required'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'end_before_start'; end if;
  select id, asset_code, asset_name, asset_type, serial_number, quantity_total, availability_status
    into a from public.custody_inventory_assets
   where is_deleted = false and (lower(barcode) = lower(v_code) or lower(qr_code_value) = lower(v_code) or lower(asset_code) = lower(v_code))
   limit 1;
  if a.id is null then return jsonb_build_object('found', false); end if;
  v_free := public.custody_rental_free_qty(a.id, p_from, p_to);
  select file_path into v_photo from public.custody_inventory_asset_files
    where asset_id = a.id and is_deleted = false and file_type = 'asset_photo' order by is_primary desc nulls last, created_at desc limit 1;
  return jsonb_build_object('found', true, 'asset_id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'asset_type', a.asset_type, 'serial_number', a.serial_number, 'total_quantity', a.quantity_total,
    'available_quantity', greatest(coalesce(v_free,0),0), 'is_available', coalesce(v_free,0) > 0,
    'catalog_photo_path', v_photo, 'availability_status', a.availability_status);
end; $$;
commit;

-- ─── 3b) نص الإقرار/العقد للعرض للمستأجر (settings محمي بالـRLS للمدراء؛ هذا RPC آمن للقراءة) ───
create or replace function public.custody_rental_consent_text() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_terms text; v_ver int; v_curr text;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select contract_terms_ar, contract_version, currency into v_terms, v_ver, v_curr from public.custody_rental_settings where id = 1;
  return jsonb_build_object('consent_text', coalesce(v_terms,''), 'version', coalesce(v_ver,1), 'currency', coalesce(v_curr,'SAR'));
end; $$;

-- ─── 4) إنشاء طلب المستأجر — يحفظ الهوية + الإقرار + البنود، ويعيد معرّفات البنود ───
--     لا يُرسِل تلقائيًا (الصور تُرفع بعد الإنشاء ثم يُستدعى submit الذي يتحقق من كل شيء).
begin;
create or replace function public.custody_rental_customer_create_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; pr record; v_cust uuid; v_from timestamptz; v_to timestamptz; v_no text; v_req uuid; it jsonb; av numeric; v_items jsonb := '[]'::jsonb; v_item uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_flag('rental_customer_portal_enabled') then raise exception 'customer_portal_disabled'; end if;
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not authorized'; end if;
  v_from := nullif(p_data->>'rental_from','')::timestamptz;
  v_to   := nullif(p_data->>'rental_to','')::timestamptz;
  if v_from is null then raise exception 'invalid_start'; end if;
  if v_to   is null then raise exception 'invalid_end'; end if;
  if v_to <= v_from then raise exception 'end_before_start'; end if;
  -- عميل التأجير المرتبط (upsert بمفتاح ثابت) + حفظ الهوية المُدخلة.
  select id, full_name, company, email, mobile into pr from public.profiles where id = v_uid;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (v_uid, case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end,
            coalesce(nullif(trim(p_data->>'full_name'),''), nullif(trim(pr.full_name),''), pr.email, 'مستأجر'),
            nullif(trim(pr.company),''), coalesce(nullif(trim(p_data->>'phone'),''), pr.mobile), pr.email, v_uid)
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_cust;
  -- تحديث حقول الهوية على العميل (لا تُصفّى القيم القائمة إن لم تُرسَل).
  update public.custody_rental_customers set
    full_name = coalesce(nullif(trim(p_data->>'full_name'),''), full_name),
    phone     = coalesce(nullif(trim(p_data->>'phone'),''), phone),
    id_type   = coalesce(nullif(p_data->>'id_type',''), id_type),
    id_number_ref = coalesce(nullif(trim(p_data->>'id_number_ref'),''), id_number_ref),
    address   = coalesce(nullif(trim(p_data->>'address'),''), address), updated_at = now()
  where id = v_cust;
  -- المسودة + الإقرار (إن أُرسل توقيعه الآن).
  v_no := public.civ_gen_no('RNT');
  insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, delivery_location, return_location, purpose, customer_note,
      consent_signature_path, consent_text, consent_signed_at, consent_ip, consent_ua, created_by)
    values (v_no, v_cust, 'draft', v_from, v_to, nullif(trim(p_data->>'delivery_location'),''), nullif(trim(p_data->>'return_location'),''),
            nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'customer_note'),''),
            nullif(trim(p_data->>'consent_signature_path'),''), nullif(trim(p_data->>'consent_text'),''),
            case when nullif(trim(p_data->>'consent_signature_path'),'') is not null then now() else null end,
            case when nullif(trim(p_data->>'consent_signature_path'),'') is not null then public.civ_client_ip() else null end,
            left(nullif(trim(p_data->>'consent_ua'),''),400), v_uid)
    returning id into v_req;
  insert into public.custody_rental_events(request_id, to_status, actor_id, reason) values (v_req, 'draft', v_uid, 'customer_created');
  -- البنود (مع فحص توفّر) — تعيد معرّفاتها لربط الصور.
  if jsonb_typeof(p_data->'items') = 'array' then
    for it in select * from jsonb_array_elements(p_data->'items') loop
      if (it->>'asset_id') is not null then
        perform 1 from public.custody_inventory_assets where id = (it->>'asset_id')::uuid and is_deleted = false for update;
        av := public.custody_rental_free_qty((it->>'asset_id')::uuid, v_from, v_to);
        if av < coalesce((it->>'quantity')::numeric,1) then raise exception 'quantity_unavailable:%', it->>'asset_id'; end if;
        insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status)
          values (v_req, (it->>'asset_id')::uuid, coalesce((it->>'quantity')::numeric,1), coalesce((it->>'quantity')::numeric,1), 'reserved')
          returning id into v_item;
        v_items := v_items || jsonb_build_object('item_id', v_item, 'asset_id', (it->>'asset_id')::uuid, 'quantity', coalesce((it->>'quantity')::numeric,1));
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_req, 'request_number', v_no, 'status', 'draft', 'items', v_items);
end; $$;

-- ─── 5) إرسال المستأجر — يضبط الإقرار (إن أُرسل) ثم يتحقق: هوية + بند + صورة لكل بند +
--        صورة إجمالية + توقيع الإقرار. توقيع موسّع (drop لتغيّر عدد الوسائط). ───
drop function if exists public.custody_rental_customer_submit(uuid);
create or replace function public.custody_rental_customer_submit(p_request uuid, p_consent_signature_path text default null, p_consent_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; c record; v_missing int; v_overall int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers cc on cc.id = req.customer_id
    where req.id = p_request and cc.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'draft' then raise exception 'not_editable'; end if;
  if r.rental_from is null or r.rental_to is null or r.rental_to <= r.rental_from then raise exception 'end_before_start'; end if;
  -- ضبط توقيع الإقرار الآن إن أُرسل (يُوقَّع في مرحلة الصور بعد إنشاء المسودة).
  if nullif(trim(p_consent_signature_path),'') is not null then
    update public.custody_rental_requests set consent_signature_path = trim(p_consent_signature_path),
      consent_text = coalesce(nullif(trim(p_consent_text),''), consent_text), consent_signed_at = now(),
      consent_ip = public.civ_client_ip(), updated_at = now() where id = p_request;
    r.consent_signature_path := trim(p_consent_signature_path);
  end if;
  -- هوية إلزامية كاملة.
  select * into c from public.custody_rental_customers where id = r.customer_id;
  if coalesce(trim(c.full_name),'') = '' or coalesce(trim(c.phone),'') = '' or coalesce(c.id_type,'') = ''
     or coalesce(trim(c.id_number_ref),'') = '' or coalesce(trim(c.address),'') = '' then
    raise exception 'identity_incomplete';
  end if;
  -- بند واحد على الأقل.
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  -- صورة لكل بند (مرحلة request).
  select count(*) into v_missing from public.custody_rental_items i
    where i.request_id = p_request and not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'request');
  if v_missing > 0 then raise exception 'item_photo_required:%', v_missing; end if;
  -- صورة إجمالية واحدة على الأقل.
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'request' and e.item_id is null;
  if v_overall = 0 then raise exception 'overall_photo_required'; end if;
  -- توقيع الإقرار القانوني.
  if coalesce(trim(r.consent_signature_path),'') = '' then raise exception 'consent_required'; end if;
  -- إعادة فحص التوفّر (منع الحجز المزدوج).
  perform public.custody_rental_recheck(p_request);
  update public.custody_rental_requests set status = 'pending_approval', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, 'draft', 'pending_approval', auth.uid(), 'customer_submitted');
  perform public.civ_notify_managers('rental_request_created', p_request, 'طلب تأجير جديد من مستأجر '||r.request_number, 'New self-service rental '||r.request_number);
  if c.user_id is not null then perform public.civ_notify(c.user_id, 'rental_request_created', p_request, 'تم استلام طلب تأجيرك '||r.request_number||' وسيُراجَع', 'Your rental request was received '||r.request_number); end if;
  return jsonb_build_object('ok', true, 'status', 'pending_approval');
end; $$;
commit;

-- ─── 6) تذكير قبل موعد التسليم (بوابة + قائمة للإيميل) — idempotent عبر reminder_sent_at ───
--     يشغّله الكرون اليومي. دقة تقريبية (نافذة p_window_hours). خدمة (uid=null) أو مدير.
begin;
create or replace function public.custody_rental_due_reminders(p_window_hours int default 2) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_out jsonb := '[]'::jsonb; v_win interval;
begin
  if auth.uid() is not null and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_win := (greatest(coalesce(p_window_hours,2),1) || ' hours')::interval;
  for r in
    select req.id, req.request_number, req.rental_from, c.user_id as cust_uid, c.email as cust_email, c.full_name, c.company_name
      from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
     where req.status in ('approved','contract_pending_signature','scheduled','preparing','ready_for_handover')
       and req.rental_from is not null and req.rental_from > now() and req.rental_from <= now() + v_win
       and req.reminder_sent_at is null
  loop
    perform public.civ_notify_managers('rental_due_soon', r.id, 'قرب موعد تسليم تأجير '||r.request_number, 'Rental handover due soon '||r.request_number);
    if r.cust_uid is not null then perform public.civ_notify(r.cust_uid, 'rental_due_soon', r.id, 'تنبيه: موعد استلام تأجيرك '||r.request_number||' قريب', 'Reminder: your rental handover '||r.request_number||' is due soon'); end if;
    update public.custody_rental_requests set reminder_sent_at = now() where id = r.id;
    v_out := v_out || jsonb_build_object('request_id', r.id, 'request_number', r.request_number, 'rental_from', r.rental_from,
      'customer_email', r.cust_email, 'customer_user_id', r.cust_uid, 'party_name', coalesce(r.company_name, r.full_name));
  end loop;
  return jsonb_build_object('ok', true, 'reminded', jsonb_array_length(v_out), 'due', v_out);
end; $$;
commit;

-- ─── 6b) تخزين: يسمح للمستأجر المصادَق بكتابة أدلة الإنشاء + توقيع الإقرار (write-only)
--        داخل bucket rental-evidence تحت مسار rental/ فقط. القراءة تبقى للمدراء (سياسة SELECT
--        القائمة دون تغيير). السجل في القاعدة (add_request_evidence) هو البوابة الحقيقية. ───
begin;
drop policy if exists "rental evidence renter write" on storage.objects;
create policy "rental evidence renter write" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-evidence' and (storage.foldername(name))[1] = 'rental');
commit;

-- ─── 7) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_customer_add_request_evidence(uuid,uuid,text)',
    'custody_rental_customer_lookup_asset(text,timestamptz,timestamptz)',
    'custody_rental_consent_text()',
    'custody_rental_customer_create_request(jsonb)','custody_rental_customer_submit(uuid,text,text)',
    'custody_rental_due_reminders(integer)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'new_request_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_requests'
  and column_name in ('consent_signature_path','consent_signed_at','consent_text','reminder_sent_at');
select 'evidence_stages' as k, pg_get_constraintdef(oid) as def from pg_constraint where conname='custody_rental_evidence_stage_check';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_customer_add_request_evidence','custody_rental_customer_lookup_asset',
   'custody_rental_customer_create_request','custody_rental_customer_submit','custody_rental_due_reminders')
order by p.proname;
select 'grants' as k, p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('custody_rental_customer_add_request_evidence','custody_rental_customer_lookup_asset','custody_rental_due_reminders');
