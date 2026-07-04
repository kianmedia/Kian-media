-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — CUSTODY v2 PATCH: مطالبات مالية + صور متعددة + أدوار جديدة
-- Run ONCE in the Supabase SQL Editor AFTER docs/portal_equipment_custody_rental_RUNME.sql.
-- Idempotent — safe to rerun.
--
-- ADDS:
--   1) Staff roles: photographer/مصور، lighting_tech/فني إضاءة،
--      camera_assistant/مساعد تصوير، custody_officer/أمين عهدة
--      (profiles_staff_role_check + admin_set_staff_role recreated with the
--       FULL 12-role superset — nothing removed).
--   2) Financial-claim flow: admin REJECTS closure (رفض إقفال العهدة) with a
--      compensation amount → status claim_pending → the party PLEDGES payment
--      (click-to-sign تعهد بالسداد, timestamp+IP) → status flagged (مقفلة مع
--      مطالبة). Bond/سند data lives on the record; the printable سند is rendered
--      by the app. Creditor: شركة كيان الابتكار المتميز للإنتاج الفني.
--   3) Multi-photo evidence: custody_photos table (unlimited photos per item +
--      overall, per stage) with a MINIMUM of 2 photos per item and 2 overall at
--      checkout AND at return — enforced in the RPCs. Old single-path columns
--      stay as "first photo" mirrors (no breakage).
--   4) custody_notify_admins now also notifies custody_officer staff (أمين العهدة).
--   5) admin_delete_custody_record — soft delete, OWNER-tier only (is_owner()).
--   6) notifications type CHECK widened: 28 → 30 (custody_claim_pending,
--      custody_claim_acknowledged).
--
-- SAFETY: same house rules — SECURITY DEFINER + set search_path=public,
-- revoke/grant per function, no table write grants, RLS preserved, notify()
-- NEVER redefined, nothing existing removed.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Staff roles — recreate CHECK + allow-list with FULL superset ═════
alter table public.profiles drop constraint if exists profiles_staff_role_check;
alter table public.profiles add constraint profiles_staff_role_check
  check (staff_role is null or staff_role in
         ('super_admin','manager','support','editor','sales','hr','readonly','finance',
          'photographer','lighting_tech','camera_assistant','custody_officer'));

create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_staff() then raise exception 'owner only'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own staff role'; end if;
  if p_role is not null and p_role <> all (array[
       'super_admin','manager','support','editor','sales','hr','readonly','finance',
       'photographer','lighting_tech','camera_assistant','custody_officer']) then
    raise exception 'invalid staff role: %', p_role;
  end if;
  if exists (select 1 from public.profiles where id = p_user
             and (account_type = 'admin' or staff_role = 'super_admin')) then
    raise exception 'protected owner account';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_staff_role(uuid,text) from public, anon;
grant  execute on function public.admin_set_staff_role(uuid,text) to authenticated;

-- ════════ 2) notifications type CHECK — 28 live + 2 claim types = 30 ══════════
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  'custody_checkout_new','rental_request_new','custody_return_submitted',
  'custody_return_shortage','custody_handover_approved','custody_closed',
  'custody_rejected','custody_note_new',
  'custody_claim_pending','custody_claim_acknowledged'));

-- ════════ 3) Claim columns + claim_pending status ═════════════════════════════
alter table public.custody_records add column if not exists claim_amount        numeric(14,2);
alter table public.custody_records add column if not exists claim_note          text;
alter table public.custody_records add column if not exists claim_ack_signed    boolean not null default false;
alter table public.custody_records add column if not exists claim_ack_at        timestamptz;
alter table public.custody_records add column if not exists claim_ack_ip        text;
alter table public.custody_records add column if not exists claim_ack_signature text;

alter table public.custody_records drop constraint if exists custody_records_status_check;
alter table public.custody_records add constraint custody_records_status_check
  check (status in ('out','review_handover','rented','review_return',
                    'claim_pending','closed','rejected','flagged'));

-- ════════ 4) Multi-photo evidence table ═══════════════════════════════════════
create table if not exists public.custody_photos (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references public.custody_records(id) on delete cascade,
  item_id    uuid references public.custody_items(id) on delete cascade,  -- NULL = overall
  stage      text not null check (stage in ('before','after')),
  path       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_custody_photos_record on public.custody_photos(record_id, stage, position);
create index if not exists idx_custody_photos_item   on public.custody_photos(item_id);
alter table public.custody_photos enable row level security;
grant select on public.custody_photos to authenticated;
drop policy if exists custody_photos_read on public.custody_photos;
create policy custody_photos_read on public.custody_photos for select to authenticated
  using (exists (select 1 from public.custody_records r
                 where r.id = record_id
                   and (r.party_user_id = auth.uid() or public.can_manage_custody())
                   and (r.is_deleted = false or public.can_manage_custody())));

-- ════════ 5) Creation core v2 — items with ≥2 photos each + ≥2 overall ════════
drop function if exists public.custody_create_record(uuid,text,text,text,text,text,text,jsonb,text);
create or replace function public.custody_create_record(
  p_record uuid, p_kind text, p_party_role text, p_status text, p_ack_type text,
  p_party_name text, p_party_phone text, p_items jsonb, p_overall jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare it jsonb; ph text; v_no text; v_pos int := 0; v_ppos int; v_item uuid; v_n int; v_seq bigint;
begin
  if p_record is null then raise exception 'record_id_required'; end if;
  if exists (select 1 from public.custody_records where id = p_record) then raise exception 'record_exists'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0
    then raise exception 'items_required'; end if;
  if jsonb_typeof(coalesce(p_overall,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_overall,'[]'::jsonb)) < 2
    then raise exception 'overall_min_2_photos'; end if;

  v_seq := nextval('public.custody_record_no_seq');
  v_no := 'KM-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');

  insert into public.custody_records
    (id, record_no, kind, party_user_id, party_name, party_phone, party_role, status,
     overall_before_path, ack_signed, ack_signature, ack_signed_at, ack_type, ack_ip)
  values
    (p_record, v_no, p_kind, auth.uid(), p_party_name, p_party_phone, p_party_role, p_status,
     p_overall->>0, true, p_party_name, now(), p_ack_type, public.custody_client_ip());

  -- Overall BEFORE photos (unlimited, min 2 — validated above).
  v_ppos := 0;
  for ph in select value #>> '{}' from jsonb_array_elements(p_overall) loop
    if not public.custody_path_ok(p_record, ph, 'before') then raise exception 'overall_photo_invalid'; end if;
    insert into public.custody_photos (record_id, item_id, stage, path, position)
    values (p_record, null, 'before', ph, v_ppos);
    v_ppos := v_ppos + 1;
  end loop;

  -- Items, each with ≥2 BEFORE photos (unlimited above the minimum).
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(nullif(trim(it->>'name'),''), null) is null then raise exception 'item_name_required'; end if;
    if jsonb_typeof(coalesce(it->'photos','[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(it->'photos','[]'::jsonb)) < 2
      then raise exception 'item_min_2_photos'; end if;

    insert into public.custody_items (record_id, name, qty, photo_before_path, position)
    values (p_record, trim(it->>'name'),
            greatest(coalesce((it->>'qty')::int, 1), 1),
            it->'photos'->>0, v_pos)
    returning id into v_item;

    v_ppos := 0;
    for ph in select value #>> '{}' from jsonb_array_elements(it->'photos') loop
      if not public.custody_path_ok(p_record, ph, 'before') then raise exception 'item_photo_invalid'; end if;
      insert into public.custody_photos (record_id, item_id, stage, path, position)
      values (p_record, v_item, 'before', ph, v_ppos);
      v_ppos := v_ppos + 1;
    end loop;
    v_pos := v_pos + 1;
  end loop;

  return v_no;
end; $$;
revoke execute on function public.custody_create_record(uuid,text,text,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;

-- ════════ 6) submit_checkout / submit_rental_request v2 (jsonb overall) ═══════
drop function if exists public.submit_checkout(uuid,jsonb,text);
create or replace function public.submit_checkout(
  p_record uuid, p_items jsonb, p_overall jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text; v_no text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(nullif(trim(full_name),''), email), mobile into v_name, v_phone
    from public.profiles where id = auth.uid();
  if v_name is null then raise exception 'profile_name_missing'; end if;

  v_no := public.custody_create_record(p_record, 'custody', 'employee', 'out', 'custody',
                                       v_name, v_phone, p_items, p_overall);

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'استلام عهدة — خروج معدات باسم ' || v_name);

  perform public.custody_notify_admins('custody_checkout_new', p_record,
    'عهدة جديدة ' || v_no || ' — استلمها ' || v_name,
    'New custody ' || v_no || ' — taken by ' || v_name);
  perform public.custody_notify(auth.uid(), 'custody_checkout_new', p_record,
    'تم تسجيل عهدتك ' || v_no || ' — أنت مسؤول عنها حتى الإقفال',
    'Your custody ' || v_no || ' is recorded — you are responsible until closure');

  return jsonb_build_object('ok', true, 'record_no', v_no);
end; $$;
revoke execute on function public.submit_checkout(uuid,jsonb,jsonb) from public, anon;
grant  execute on function public.submit_checkout(uuid,jsonb,jsonb) to authenticated;

drop function if exists public.submit_rental_request(uuid,jsonb,text);
create or replace function public.submit_rental_request(
  p_record uuid, p_items jsonb, p_overall jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text; v_no text;
begin
  if not public.is_renter() then raise exception 'renter_registration_required'; end if;
  select full_name, phone into v_name, v_phone from public.renter_profiles where user_id = auth.uid();

  v_no := public.custody_create_record(p_record, 'rental', 'renter', 'review_handover', 'rental_contract',
                                       v_name, v_phone, p_items, p_overall);

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'طلب تأجير معدات من ' || v_name || ' — بانتظار اعتماد التسليم');

  perform public.custody_notify_admins('rental_request_new', p_record,
    'طلب تأجير جديد ' || v_no || ' من ' || v_name || ' — بانتظار اعتماد التسليم',
    'New rental request ' || v_no || ' from ' || v_name || ' — awaiting handover approval');
  perform public.custody_notify(auth.uid(), 'rental_request_new', p_record,
    'استلمنا طلب تأجيرك ' || v_no || ' — سيراجعه فريق كيان قبل التسليم',
    'Your rental request ' || v_no || ' was received — Kian will review before handover');

  return jsonb_build_object('ok', true, 'record_no', v_no);
end; $$;
revoke execute on function public.submit_rental_request(uuid,jsonb,jsonb) from public, anon;
grant  execute on function public.submit_rental_request(uuid,jsonb,jsonb) to authenticated;

-- ════════ 7) submit_return v2 — ≥2 AFTER photos per item + ≥2 overall ═════════
drop function if exists public.submit_return(uuid,jsonb,text,boolean,text);
create or replace function public.submit_return(
  p_record uuid, p_after jsonb, p_overall jsonb, p_shortage boolean, p_note text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; it jsonb; ph text; v_item uuid; v_ppos int;
begin
  select * into r from public.custody_records
   where id = p_record and not is_deleted and party_user_id = auth.uid();
  if not found then raise exception 'record not available'; end if;
  if not ((r.kind = 'custody' and r.status = 'out') or (r.kind = 'rental' and r.status = 'rented'))
    then raise exception 'return_not_allowed_in_status'; end if;
  if coalesce(p_shortage, false) and coalesce(nullif(trim(p_note),''), null) is null
    then raise exception 'shortage_note_required'; end if;
  if jsonb_typeof(coalesce(p_after,'[]'::jsonb)) <> 'array' then raise exception 'after_photos_required'; end if;
  if jsonb_typeof(coalesce(p_overall,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_overall,'[]'::jsonb)) < 2
    then raise exception 'overall_after_min_2_photos'; end if;

  -- Overall AFTER photos.
  v_ppos := 0;
  for ph in select value #>> '{}' from jsonb_array_elements(p_overall) loop
    if not public.custody_path_ok(p_record, ph, 'after') then raise exception 'overall_after_invalid'; end if;
    insert into public.custody_photos (record_id, item_id, stage, path, position)
    values (p_record, null, 'after', ph, v_ppos);
    v_ppos := v_ppos + 1;
  end loop;

  -- Per-item AFTER photos (≥2 each; item must belong to this record).
  for it in select * from jsonb_array_elements(p_after) loop
    select id into v_item from public.custody_items
     where id = (it->>'item_id')::uuid and record_id = p_record;
    if v_item is null then raise exception 'item_not_in_record'; end if;
    if jsonb_typeof(coalesce(it->'photos','[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(it->'photos','[]'::jsonb)) < 2
      then raise exception 'item_after_min_2_photos'; end if;
    v_ppos := 0;
    for ph in select value #>> '{}' from jsonb_array_elements(it->'photos') loop
      if not public.custody_path_ok(p_record, ph, 'after') then raise exception 'item_after_photo_invalid'; end if;
      insert into public.custody_photos (record_id, item_id, stage, path, position)
      values (p_record, v_item, 'after', ph, v_ppos);
      v_ppos := v_ppos + 1;
    end loop;
    update public.custody_items set photo_after_path = it->'photos'->>0 where id = v_item;
  end loop;

  -- Ground truth (duplicate-proof): EVERY item of this record must now carry
  -- at least 2 AFTER photos.
  if exists (select 1 from public.custody_items ci
             where ci.record_id = p_record
               and (select count(*) from public.custody_photos cp
                     where cp.item_id = ci.id and cp.stage = 'after') < 2)
    then raise exception 'after_photos_missing_for_items'; end if;

  update public.custody_records set
    status = 'review_return', overall_after_path = p_overall->>0,
    shortage = coalesce(p_shortage, false),
    shortage_note = case when coalesce(p_shortage,false) then trim(p_note) else null end,
    updated_at = now()
  where id = p_record;

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(),
          case when coalesce(p_shortage,false)
               then 'إرجاع — بلاغ نقص/تلف: ' || trim(p_note)
               else 'إرجاع العدة — بانتظار مراجعة الإدارة' end);

  if coalesce(p_shortage, false) then
    perform public.custody_notify_admins('custody_return_shortage', p_record,
      '⚠ إرجاع مع بلاغ نقص/تلف — ' || r.record_no || ' (' || r.party_name || '): ' || trim(p_note),
      '⚠ Return with shortage/damage — ' || r.record_no || ' (' || r.party_name || '): ' || trim(p_note));
  else
    perform public.custody_notify_admins('custody_return_submitted', p_record,
      'إرجاع ' || r.record_no || ' من ' || r.party_name || ' — بانتظار المراجعة والإقفال',
      'Return of ' || r.record_no || ' by ' || r.party_name || ' — awaiting review & closure');
  end if;
  perform public.custody_notify(auth.uid(), 'custody_return_submitted', p_record,
    'استلمنا إرجاعك لـ ' || r.record_no || ' — الإقفال النهائي بعد مراجعة الإدارة',
    'Your return of ' || r.record_no || ' was received — final closure after admin review');

  return true;
end; $$;
revoke execute on function public.submit_return(uuid,jsonb,jsonb,boolean,text) from public, anon;
grant  execute on function public.submit_return(uuid,jsonb,jsonb,boolean,text) to authenticated;

-- ════════ 8) رفض الإقفال — مطالبة مالية (admin) ═══════════════════════════════
create or replace function public.admin_reject_closure(p_record uuid, p_amount numeric, p_note text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_custody() then raise exception 'not authorized'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'claim_amount_required'; end if;
  select * into r from public.custody_records
   where id = p_record and not is_deleted and status = 'review_return';
  if not found then raise exception 'record not in review_return'; end if;

  update public.custody_records set
    status = 'claim_pending',
    claim_amount = round(p_amount, 2),
    claim_note = nullif(trim(p_note), ''),
    updated_at = now()
  where id = p_record;

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(),
          'رفض الإقفال — مطالبة مالية بمبلغ ' || round(p_amount,2)::text || ' ر.س'
          || coalesce(': ' || nullif(trim(p_note),''), ''));

  perform public.custody_notify(r.party_user_id, 'custody_claim_pending', p_record,
    'مطالبة مالية على ' || r.record_no || ' بمبلغ ' || round(p_amount,2)::text || ' ر.س — يلزم التعهد بالسداد لإقفال العهدة',
    'Financial claim on ' || r.record_no || ' for SAR ' || round(p_amount,2)::text || ' — a payment pledge is required to close');
  perform public.custody_notify_admins('custody_claim_pending', p_record,
    'سُجّلت مطالبة مالية على ' || r.record_no || ' (' || r.party_name || ') بمبلغ ' || round(p_amount,2)::text || ' ر.س',
    'Financial claim recorded on ' || r.record_no || ' (' || r.party_name || ') for SAR ' || round(p_amount,2)::text);
  return true;
end; $$;
revoke execute on function public.admin_reject_closure(uuid,numeric,text) from public, anon;
grant  execute on function public.admin_reject_closure(uuid,numeric,text) to authenticated;

-- ════════ 9) تعهد السداد (الطرف) → مقفلة مع مطالبة + بيانات السند ═════════════
create or replace function public.acknowledge_custody_claim(p_record uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.custody_records
   where id = p_record and not is_deleted and party_user_id = auth.uid() and status = 'claim_pending';
  if not found then raise exception 'no pending claim for you on this record'; end if;

  update public.custody_records set
    status = 'flagged',
    claim_ack_signed = true,
    claim_ack_at = now(),
    claim_ack_ip = public.custody_client_ip(),
    claim_ack_signature = r.party_name,
    updated_at = now()
  where id = p_record;

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(),
          'تعهد بالسداد — أقر ' || r.party_name || ' بالمطالبة (' || coalesce(r.claim_amount,0)::text
          || ' ر.س) وتعهد بسدادها لصالح شركة كيان الابتكار المتميز للإنتاج الفني');

  perform public.custody_notify_admins('custody_claim_acknowledged', p_record,
    'وقّع ' || r.party_name || ' تعهد السداد للمطالبة على ' || r.record_no || ' (' || coalesce(r.claim_amount,0)::text || ' ر.س)',
    r.party_name || ' signed the payment pledge for the claim on ' || r.record_no || ' (SAR ' || coalesce(r.claim_amount,0)::text || ')');
  perform public.custody_notify(r.party_user_id, 'custody_claim_acknowledged', p_record,
    'تم توثيق تعهدك بسداد ' || coalesce(r.claim_amount,0)::text || ' ر.س على ' || r.record_no || ' — يمكنك عرض السند من البطاقة',
    'Your payment pledge of SAR ' || coalesce(r.claim_amount,0)::text || ' on ' || r.record_no || ' is documented — view the bond from the card');
  return true;
end; $$;
revoke execute on function public.acknowledge_custody_claim(uuid) from public, anon;
grant  execute on function public.acknowledge_custody_claim(uuid) to authenticated;

-- ════════ 10) حذف سجل (soft) — للمالك/الأدمن فقط ═════════════════════════════
create or replace function public.admin_delete_custody_record(p_record uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  select * into r from public.custody_records where id = p_record and not is_deleted;
  if not found then raise exception 'record not found'; end if;
  update public.custody_records set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where id = p_record;
  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'حذف السجل من النظام' || coalesce(': ' || nullif(trim(p_reason),''), ''));
  return true;
end; $$;
revoke execute on function public.admin_delete_custody_record(uuid,text) from public, anon;
grant  execute on function public.admin_delete_custody_record(uuid,text) to authenticated;

-- ════════ 11) أمين العهدة يستلم كل الإشعارات (custody_officer) ═════════════════
create or replace function public.custody_notify_admins(
  p_type text, p_record uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.custody_notify(null, p_type, p_record, p_ar, p_en);
  for r in select id from public.profiles
            where account_status = 'active' and account_type <> 'admin'
              and staff_role in ('super_admin','manager','custody_officer') loop
    perform public.custody_notify(r.id, p_type, p_record, p_ar, p_en);
  end loop;
end; $$;
revoke execute on function public.custody_notify_admins(text,uuid,text,text) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الأدوار الجديدة مقبولة:
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.profiles'::regclass and conname='profiles_staff_role_check';
-- 2) الحالة الجديدة + أعمدة المطالبة:
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.custody_records'::regclass and conname='custody_records_status_check';
select column_name from information_schema.columns
 where table_name='custody_records' and column_name like 'claim%' order by 1;
-- 3) جدول الصور + الدوال الجديدة:
select to_regclass('public.custody_photos') as custody_photos;
select proname from pg_proc where proname in
 ('admin_reject_closure','acknowledge_custody_claim','admin_delete_custody_record') order by 1;
-- 4) قيد الإشعارات = 30 نوعًا (يشمل custody_claim_*):
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.notifications'::regclass and conname='notifications_type_check';
-- ════════════════════════════════════════════════════════════════════════════
