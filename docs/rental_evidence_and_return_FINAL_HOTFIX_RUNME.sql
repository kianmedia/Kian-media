-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — EVIDENCE (server signed-upload) + CONTROLLED RETURN — FINAL HOTFIX
-- ────────────────────────────────────────────────────────────────────────────
-- (1) رفع الأدلة عبر مسار خادمي (Signed Upload URL) — لا يعتمد على سياسة Storage
--     للمستأجر. الخادم يوقّع بمفتاح الخدمة ثم يستدعي custody_rental_finalize_evidence
--     (كمستخدم) للتحقق من الملكية/المسار/وجود الكائن/عدم التكرار وإنشاء السطر.
-- (2) دورة إرجاع مضبوطة للمستأجر: طلب إرجاع بصور لكل بند + إجمالية + توقيع، ثم الإدارة/
--     أمين العهدة يفحصون ويغلقون. المستأجر لا يغلق ولا يعيد الأصل available.
-- idempotent · غير هدّام · لا يحذف صورًا/طلبات · لا يعيد Foundation · بلا Fixtures.
-- يعتمد على الطبقة التشغيلية + binding (consent cols) — طبّق ملفات التأجير أولًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_evidence') is null or to_regclass('public.custody_rental_requests') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_requests' and column_name='consent_signature_path') then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_renter_binding_evidence_HOTFIX_RUNME.sql أولًا.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) أعمدة توقيع/ملاحظة الإرجاع + ضمان مراحل الأدلة ───
alter table public.custody_rental_requests add column if not exists return_consent_signature_path text;
alter table public.custody_rental_requests add column if not exists return_consent_signed_at       timestamptz;
alter table public.custody_rental_requests add column if not exists return_note                    text;
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
create unique index if not exists uq_rental_evidence_path on public.custody_rental_evidence(file_path);
commit;

-- ─── 2) finalize موحّد (يُستدعى من /api/rental/evidence/finalize كمستخدم) ───
begin;
create or replace function public.custody_rental_finalize_evidence(
  p_rental_id uuid, p_rental_item_id uuid default null, p_stage text default 'request',
  p_evidence_type text default 'item_photo', p_storage_path text default null,
  p_mime_type text default null, p_file_size bigint default null, p_condition text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare r record; v_is_staff boolean; v_is_owner boolean; v_ok_stage boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if p_stage not in ('request','handover','return_request','return_inspection') then raise exception 'bad_stage'; end if;
  if p_evidence_type not in ('item_photo','overall_photo','signature') then raise exception 'bad_evidence_type'; end if;
  if coalesce(trim(p_storage_path),'') = '' then raise exception 'path_required'; end if;
  if p_evidence_type = 'item_photo' and p_rental_item_id is null then raise exception 'item_required'; end if;
  if p_evidence_type <> 'item_photo' and p_rental_item_id is not null then raise exception 'overall_no_item'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'not_editable'; end if;
  v_is_staff := public.civ_can_manage();
  v_is_owner := exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid());
  if not (v_is_staff or v_is_owner) then raise exception 'not authorized'; end if;
  v_ok_stage := case p_stage
    when 'request'           then (v_is_staff or (v_is_owner and r.status = 'draft'))
    when 'return_request'    then (v_is_staff or (v_is_owner and r.status in ('active','overdue','return_requested')))
    when 'handover'          then (v_is_staff and r.status in ('scheduled','preparing','ready_for_handover'))
    when 'return_inspection' then (v_is_staff and r.status = 'inspection_pending')
    else false end;
  if not v_ok_stage then raise exception 'not_editable'; end if;
  if position('rental/'||p_rental_id::text||'/' in p_storage_path) <> 1 then raise exception 'bad_path'; end if;
  if p_rental_item_id is not null and not exists (select 1 from public.custody_rental_items where id = p_rental_item_id and request_id = p_rental_id) then raise exception 'item_not_in_request'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'rental-evidence' and o.name = p_storage_path) then raise exception 'storage_object_missing'; end if;
  -- التوقيع يُخزَّن على الطلب (لا سطر دليل).
  if p_evidence_type = 'signature' then
    if p_stage = 'request' then
      update public.custody_rental_requests set consent_signature_path = p_storage_path, consent_signed_at = now(), consent_ip = public.civ_client_ip(), updated_at = now() where id = p_rental_id;
    elsif p_stage = 'return_request' then
      update public.custody_rental_requests set return_consent_signature_path = p_storage_path, return_consent_signed_at = now(), updated_at = now() where id = p_rental_id;
    else raise exception 'signature_bad_stage'; end if;
    return jsonb_build_object('ok', true, 'signature', true);
  end if;
  if exists (select 1 from public.custody_rental_evidence where file_path = p_storage_path) then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, condition, note, uploaded_by)
    values (p_rental_id, p_rental_item_id, p_stage, p_storage_path, nullif(p_condition,''),
            nullif(concat_ws(' ', p_mime_type, case when p_file_size is not null then '('||p_file_size||'B)' end),''), auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
commit;

-- ─── 3) طلب إرجاع المستأجر — يتطلب صورة لكل بند + إجمالية + توقيع (لا يُغلق ولا يُرجع available) ───
begin;
create or replace function public.custody_rental_customer_request_return(p_request uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_missing int; v_overall int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('active','overdue') then raise exception 'bad_status'; end if;
  select count(*) into v_missing from public.custody_rental_items i
    where i.request_id = p_request and i.status in ('issued','return_requested')
      and not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'return_request');
  if v_missing > 0 then raise exception 'return_item_photo_required:%', v_missing; end if;
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'return_request' and e.item_id is null;
  if v_overall = 0 then raise exception 'return_overall_photo_required'; end if;
  if coalesce(trim(r.return_consent_signature_path),'') = '' then raise exception 'consent_required'; end if;
  update public.custody_rental_requests set status = 'return_requested', return_note = nullif(trim(p_note),''),
    customer_note = coalesce(nullif(trim(p_note),''), customer_note), updated_at = now() where id = p_request;
  update public.custody_rental_items set status = 'return_requested' where request_id = p_request and status = 'issued';
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'return_requested', auth.uid(), nullif(trim(p_note),''));
  perform public.civ_notify_managers('rental_return_requested', p_request, 'طلب إرجاع تأجير '||r.request_number, 'Return requested '||r.request_number);
  perform public.civ_notify(auth.uid(), 'rental_return_requested', p_request, 'تم استلام طلب إرجاعك '||r.request_number, 'Your return request was received '||r.request_number);
  return jsonb_build_object('ok', true, 'status', 'return_requested');
end; $$;

-- بنود المستأجر (معرّفات آمنة لربط صور الإرجاع بكل معدة).
create or replace function public.custody_rental_customer_items(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid()) then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'asset_name', a.asset_name, 'asset_code', a.asset_code, 'quantity', i.quantity, 'status', i.status) order by a.asset_name)
    from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request), '[]'::jsonb);
end; $$;
commit;

-- ─── 4) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_finalize_evidence(uuid,uuid,text,text,text,text,bigint,text)',
    'custody_rental_customer_request_return(uuid,text)','custody_rental_customer_items(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Validation
-- ════════════════════════════════════════════════════════════════════════════
select 'return_cols' as k, count(*) as n from information_schema.columns
where table_schema='public' and table_name='custody_rental_requests' and column_name in ('return_consent_signature_path','return_consent_signed_at','return_note');
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_finalize_evidence','custody_rental_customer_request_return')
order by p.proname;
select 'grants' as k, p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_finalize_evidence','custody_rental_customer_request_return');
