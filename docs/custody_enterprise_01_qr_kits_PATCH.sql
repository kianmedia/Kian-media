-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 01: QR/Barcode + Kits + Parent/Child Components
-- يُشغَّل بعد patch 00. idempotent. لا يلمس الأنظمة القديمة.
-- QR يحمل token عشوائيًا يُحَل عبر RPC آمنة (لا asset_id مباشر، لا بيانات مالية).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- علم مساعد: هل الميزة مفعّلة (يقرأ الإعدادات، آمن الفشل ⇒ false).
create or replace function public.civ_flag(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  execute format('select %I from public.custody_enterprise_settings where id = 1', p_name) into v;
  return coalesce(v, false);
exception when others then return false;
end; $$;
revoke execute on function public.civ_flag(text) from public, anon;
grant  execute on function public.civ_flag(text) to authenticated;

-- ─── 1) QR / Barcode على الأصل ───
alter table public.custody_inventory_assets add column if not exists qr_token uuid;
alter table public.custody_inventory_assets add column if not exists barcode_value text;
alter table public.custody_inventory_assets add column if not exists qr_status text not null default 'active'
  check (qr_status in ('active','reissued','revoked'));
alter table public.custody_inventory_assets add column if not exists label_version int not null default 1;
alter table public.custody_inventory_assets add column if not exists label_printed_at timestamptz;
alter table public.custody_inventory_assets add column if not exists label_printed_by uuid references auth.users(id);
update public.custody_inventory_assets set qr_token = gen_random_uuid() where qr_token is null;
create unique index if not exists uq_civ_asset_qr_token on public.custody_inventory_assets(qr_token) where qr_token is not null;

create table if not exists public.custody_qr_events (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.custody_inventory_assets(id),
  event_type  text not null check (event_type in ('printed','reissued','revoked','scanned')),
  old_token   uuid,
  new_token   uuid,
  format      text,
  context     text,   -- issue|return|audit|maintenance|transfer|rental|manual
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_civ_qr_events_asset on public.custody_qr_events(asset_id, created_at desc);

-- حلّ QR: is_staff فقط، يعيد بيانات تشغيلية بلا أي شيء مالي.
create or replace function public.custody_inv_resolve_qr(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select id, asset_code, asset_name, serial_number, brand, model, asset_type, quantity_available,
         availability_status, condition_status, qr_status,
         (select l.name from public.custody_inventory_locations l where l.id = a0.warehouse_location_id) as location
    into a from public.custody_inventory_assets a0 where a0.qr_token = p_token and a0.is_deleted = false;
  if a.id is null then raise exception 'qr_not_found'; end if;
  if a.qr_status = 'revoked' then raise exception 'qr_revoked'; end if;
  return jsonb_build_object('id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
    'serial_number', a.serial_number, 'brand', a.brand, 'model', a.model, 'asset_type', a.asset_type,
    'quantity_available', a.quantity_available, 'availability_status', a.availability_status,
    'condition_status', a.condition_status, 'location', a.location);
end; $$;

create or replace function public.custody_inv_admin_reissue_qr(p_asset uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_new uuid := gen_random_uuid();
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select qr_token into v_old from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  update public.custody_inventory_assets set qr_token = v_new, qr_status = 'active', label_version = label_version + 1, updated_at = now() where id = p_asset;
  insert into public.custody_qr_events(asset_id, event_type, old_token, new_token, context, created_by)
    values (p_asset, 'reissued', v_old, v_new, coalesce(nullif(p_reason,''),'reissue'), auth.uid());
  perform public.custody_audit('qr_reissued', 'custody_inventory_assets', p_asset, jsonb_build_object('reason', p_reason));
  perform public.civ_notify_managers('qr_reissued', p_asset, 'أُعيد إصدار QR للأصل', 'Asset QR reissued');
  return v_new;
end; $$;

create or replace function public.custody_inv_log_label_print(p_asset_ids uuid[], p_format text) returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  foreach v_id in array coalesce(p_asset_ids, '{}') loop
    update public.custody_inventory_assets set label_printed_at = now(), label_printed_by = auth.uid() where id = v_id and is_deleted = false;
    if found then
      insert into public.custody_qr_events(asset_id, event_type, format, context, created_by) values (v_id, 'printed', p_format, 'manual', auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end; $$;

-- ─── 2) المكوّنات Parent/Child ───
create table if not exists public.custody_inventory_asset_components (
  id                  uuid primary key default gen_random_uuid(),
  parent_asset_id     uuid not null references public.custody_inventory_assets(id) on delete cascade,
  child_asset_id      uuid references public.custody_inventory_assets(id),   -- إن كان الملحق أصلًا متتبعًا
  accessory_name      text,                                                 -- ملحق غير متتبع برقم
  relation_type       text not null default 'accessory'
                      check (relation_type in ('accessory','battery','charger','lens','case','cage','media','part','other')),
  required_on_issue   boolean not null default false,
  required_on_return  boolean not null default false,
  default_quantity    numeric not null default 1 check (default_quantity > 0),
  can_be_issued_separately boolean not null default true,
  replacement_allowed boolean not null default true,
  sort_order          int not null default 0,
  is_deleted          boolean not null default false,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  constraint civ_component_target check (child_asset_id is not null or nullif(trim(accessory_name),'') is not null)
);
create index if not exists idx_civ_components_parent on public.custody_inventory_asset_components(parent_asset_id) where is_deleted = false;

create or replace function public.custody_inv_admin_upsert_component(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if nullif(p_data->>'parent_asset_id','') is null then raise exception 'parent_required'; end if;
  if p_id is null then
    insert into public.custody_inventory_asset_components(parent_asset_id, child_asset_id, accessory_name, relation_type,
      required_on_issue, required_on_return, default_quantity, can_be_issued_separately, replacement_allowed, sort_order, created_by)
    values ((p_data->>'parent_asset_id')::uuid, nullif(p_data->>'child_asset_id','')::uuid, nullif(trim(p_data->>'accessory_name'),''),
      coalesce(nullif(p_data->>'relation_type',''),'accessory'), coalesce((p_data->>'required_on_issue')::boolean,false),
      coalesce((p_data->>'required_on_return')::boolean,false), coalesce((p_data->>'default_quantity')::numeric,1),
      coalesce((p_data->>'can_be_issued_separately')::boolean,true), coalesce((p_data->>'replacement_allowed')::boolean,true),
      coalesce((p_data->>'sort_order')::int,0), auth.uid())
    returning id into v_id;
  else
    update public.custody_inventory_asset_components set
      accessory_name = coalesce(nullif(trim(p_data->>'accessory_name'),''), accessory_name),
      relation_type = coalesce(nullif(p_data->>'relation_type',''), relation_type),
      required_on_issue = coalesce((p_data->>'required_on_issue')::boolean, required_on_issue),
      required_on_return = coalesce((p_data->>'required_on_return')::boolean, required_on_return),
      default_quantity = coalesce((p_data->>'default_quantity')::numeric, default_quantity),
      can_be_issued_separately = coalesce((p_data->>'can_be_issued_separately')::boolean, can_be_issued_separately),
      replacement_allowed = coalesce((p_data->>'replacement_allowed')::boolean, replacement_allowed),
      sort_order = coalesce((p_data->>'sort_order')::int, sort_order)
      where id = p_id and is_deleted = false returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_remove_component(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_asset_components set is_deleted = true where id = p_id and is_deleted = false;
  return found;
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Kits — الحقائب/الأطقم الجاهزة
-- ════════════════════════════════════════════════════════════════════════════
begin;
create table if not exists public.custody_inventory_kits (
  id                uuid primary key default gen_random_uuid(),
  kit_code          text not null unique,
  name_ar           text not null,
  name_en           text,
  description       text,
  usage_type        text,
  photo_path        text,
  status            text not null default 'active' check (status in ('active','inactive','archived')),
  location_id       uuid references public.custody_inventory_locations(id),
  version           int not null default 1,
  is_deleted        boolean not null default false,
  deleted_at        timestamptz, deleted_by uuid references auth.users(id), delete_reason text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table if not exists public.custody_inventory_kit_items (
  id            uuid primary key default gen_random_uuid(),
  kit_id        uuid not null references public.custody_inventory_kits(id) on delete cascade,
  asset_id      uuid references public.custody_inventory_assets(id),
  accessory_name text,
  quantity      numeric not null default 1 check (quantity > 0),
  is_required   boolean not null default true,
  sort_order    int not null default 0,
  is_deleted    boolean not null default false,
  constraint civ_kititem_target check (asset_id is not null or nullif(trim(accessory_name),'') is not null)
);
create index if not exists idx_civ_kit_items on public.custody_inventory_kit_items(kit_id) where is_deleted = false;
create table if not exists public.custody_inventory_kit_versions (
  id          uuid primary key default gen_random_uuid(),
  kit_id      uuid not null references public.custody_inventory_kits(id) on delete cascade,
  version     int not null,
  snapshot    jsonb not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create table if not exists public.custody_inventory_kit_movements (
  id           uuid primary key default gen_random_uuid(),
  kit_id       uuid not null references public.custody_inventory_kits(id),
  assignment_id uuid references public.custody_inventory_assignments(id),
  movement_type text not null check (movement_type in ('issued','returned','modified','archived')),
  snapshot     jsonb,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
-- لقطة محتوى الحقيبة على العهدة (لا تتغيّر بتعديل تعريف الحقيبة لاحقًا).
alter table public.custody_inventory_assignments add column if not exists kit_id uuid references public.custody_inventory_kits(id);
alter table public.custody_inventory_assignments add column if not exists kit_snapshot jsonb;

-- إدارة القالب.
create or replace function public.custody_inv_admin_upsert_kit(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if nullif(trim(p_data->>'name_ar'),'') is null then raise exception 'name_required'; end if;
  if p_id is null then
    v_code := coalesce(nullif(trim(p_data->>'kit_code'),''), public.civ_gen_no('KIT'));
    insert into public.custody_inventory_kits(kit_code, name_ar, name_en, description, usage_type, location_id, created_by)
      values (v_code, trim(p_data->>'name_ar'), nullif(trim(p_data->>'name_en'),''), nullif(trim(p_data->>'description'),''),
        nullif(trim(p_data->>'usage_type'),''), nullif(p_data->>'location_id','')::uuid, auth.uid())
      returning id into v_id;
  else
    update public.custody_inventory_kits set name_ar = coalesce(nullif(trim(p_data->>'name_ar'),''), name_ar),
      name_en = coalesce(nullif(trim(p_data->>'name_en'),''), name_en), description = coalesce(nullif(trim(p_data->>'description'),''), description),
      usage_type = coalesce(nullif(trim(p_data->>'usage_type'),''), usage_type), location_id = coalesce(nullif(p_data->>'location_id','')::uuid, location_id),
      updated_at = now() where id = p_id and is_deleted = false returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_upsert_kit_item(p_id uuid, p_kit uuid, p_asset uuid, p_accessory text, p_qty numeric, p_required boolean, p_sort int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_id is null then
    insert into public.custody_inventory_kit_items(kit_id, asset_id, accessory_name, quantity, is_required, sort_order)
      values (p_kit, p_asset, nullif(trim(p_accessory),''), coalesce(p_qty,1), coalesce(p_required,true), coalesce(p_sort,0)) returning id into v_id;
  else
    update public.custody_inventory_kit_items set asset_id = coalesce(p_asset, asset_id), accessory_name = coalesce(nullif(trim(p_accessory),''), accessory_name),
      quantity = coalesce(p_qty, quantity), is_required = coalesce(p_required, is_required), sort_order = coalesce(p_sort, sort_order)
      where id = p_id and is_deleted = false returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_remove_kit_item(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_kit_items set is_deleted = true where id = p_id and is_deleted = false; return found;
end; $$;

-- لقطة نسخة من تكوين الحقيبة (تُستدعى بعد أي تعديل جوهري).
create or replace function public.custody_inv_admin_snapshot_kit(p_kit uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_ver int; v_snap jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_kits set version = version + 1, updated_at = now() where id = p_kit returning version into v_ver;
  select jsonb_agg(jsonb_build_object('asset_id', asset_id, 'accessory_name', accessory_name, 'quantity', quantity, 'is_required', is_required))
    into v_snap from public.custody_inventory_kit_items where kit_id = p_kit and is_deleted = false;
  insert into public.custody_inventory_kit_versions(kit_id, version, snapshot, created_by) values (p_kit, v_ver, coalesce(v_snap,'[]'::jsonb), auth.uid());
  return v_ver;
end; $$;

-- حلّ محتوى الحقيبة الجاهز للصرف (للموظف/الإدارة) — قطع متسلسلة/كمية + إلزامية.
create or replace function public.custody_inv_get_kit_resolved(p_kit uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  return jsonb_build_object(
    'kit', (select jsonb_build_object('id', id, 'kit_code', kit_code, 'name_ar', name_ar, 'version', version)
            from public.custody_inventory_kits where id = p_kit and is_deleted = false),
    'items', coalesce((select jsonb_agg(jsonb_build_object('kit_item_id', ki.id, 'asset_id', ki.asset_id, 'accessory_name', ki.accessory_name,
        'quantity', ki.quantity, 'is_required', ki.is_required, 'asset_name', a.asset_name, 'asset_code', a.asset_code,
        'asset_type', a.asset_type, 'availability_status', a.availability_status, 'quantity_available', a.quantity_available)
        order by ki.sort_order)
      from public.custody_inventory_kit_items ki left join public.custody_inventory_assets a on a.id = ki.asset_id
      where ki.kit_id = p_kit and ki.is_deleted = false), '[]'::jsonb));
end; $$;

-- صرف حقيبة ذاتيًا (Transaction + قفل بترتيب asset_id + snapshot). العميل يمرّر البنود
-- المشمولة (يمكن حذف الاختياري) وصور كل قطعة + صورة مجموعة + مسارات الأدلة (مثل self_issue).
-- p_data = { kit_id, items:[{asset_id, quantity, item_photos:[path]}], group_photos:[path], note,
--            override_required(bool), override_reason }
create or replace function public.custody_inv_employee_issue_kit(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth.uid(); v_empid uuid; v_no text; v_aid uuid; v_kit uuid;
        v_items jsonb; elem jsonb; v_path text; v_asset uuid; v_qty numeric; rec record;
        v_reserved numeric; v_count int := 0; v_missing_required int; v_snap jsonb;
begin
  if v_emp is null then raise exception 'unauthenticated'; end if;
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if not public.civ_flag('custody_kits_enabled') then raise exception 'kits_disabled'; end if;
  v_kit := nullif(p_data->>'kit_id','')::uuid;
  if v_kit is null then raise exception 'kit_required'; end if;
  v_items := coalesce(p_data->'items','[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'items_required'; end if;
  if jsonb_array_length(coalesce(p_data->'group_photos','[]'::jsonb)) < 1 then raise exception 'group_photo_required'; end if;
  for elem in select value from jsonb_array_elements(v_items) loop
    if jsonb_array_length(coalesce(elem->'item_photos','[]'::jsonb)) < 1 then raise exception 'item_photo_required'; end if;
  end loop;
  -- منع حذف قطعة إلزامية إلا بموافقة+سبب.
  select count(*) into v_missing_required from public.custody_inventory_kit_items ki
   where ki.kit_id = v_kit and ki.is_deleted = false and ki.is_required = true and ki.asset_id is not null
     and not exists (select 1 from jsonb_array_elements(v_items) e where (e->>'asset_id')::uuid = ki.asset_id);
  if v_missing_required > 0 and not coalesce((p_data->>'override_required')::boolean, false) then
    raise exception 'required_item_missing'; end if;
  if v_missing_required > 0 and nullif(trim(p_data->>'override_reason'),'') is null then raise exception 'override_reason_required'; end if;

  if to_regclass('public.hr_employee_profiles') is not null then
    execute 'select id from public.hr_employee_profiles where user_id=$1 and is_deleted=false limit 1' into v_empid using v_emp; end if;
  select snapshot into v_snap from public.custody_inventory_kit_versions where kit_id = v_kit order by version desc limit 1;
  if v_snap is null then
    select jsonb_agg(jsonb_build_object('asset_id', asset_id, 'accessory_name', accessory_name, 'quantity', quantity, 'is_required', is_required))
      into v_snap from public.custody_inventory_kit_items where kit_id = v_kit and is_deleted = false;
  end if;

  v_no := public.civ_gen_no('CIV');
  insert into public.custody_inventory_assignments(assignment_number, employee_id, employee_user_id, assignment_type, purpose,
    issued_by, issued_at, employee_confirmed_at, status, issue_source, employee_note, kit_id, kit_snapshot)
  values (v_no, v_empid, v_emp, 'field_task', nullif(trim(p_data->>'note'),''), v_emp, now(), now(), 'active', 'employee_self',
    nullif(trim(p_data->>'note'),''), v_kit, coalesce(v_snap,'[]'::jsonb))
  returning id into v_aid;

  for elem in select value from jsonb_array_elements(v_items) order by (value->>'asset_id') loop
    v_asset := (elem->>'asset_id')::uuid;
    if v_asset is null then continue; end if;   -- ملحق غير متتبع يُتجاهل في الخصم
    v_qty := coalesce((elem->>'quantity')::numeric, 1);
    select * into rec from public.custody_inventory_assets where id = v_asset and is_deleted = false for update;
    if rec.id is null then raise exception 'asset_not_found'; end if;
    if rec.availability_status in ('maintenance','lost','retired') then raise exception 'asset_unavailable: %', rec.asset_code; end if;
    if rec.asset_type = 'serialized' then
      v_qty := 1;
      if exists (select 1 from public.custody_inventory_assignment_items where asset_id = v_asset and status in ('pending','active','return_requested','disputed'))
        then raise exception 'asset_already_assigned: %', rec.asset_code; end if;
    end if;
    if v_qty <= 0 then raise exception 'bad_quantity'; end if;
    if v_qty > rec.quantity_available then raise exception 'insufficient_stock: %', rec.asset_code; end if;
    select coalesce(sum(quantity),0) into v_reserved from public.custody_inventory_reservations
      where asset_id = v_asset and status='active' and (reserved_to is null or reserved_to >= now()) and (employee_id is null or employee_id is distinct from v_emp);
    if (rec.quantity_available - v_qty) < v_reserved then raise exception 'reserved_shortage: %', rec.asset_code; end if;
    update public.custody_inventory_assets set quantity_available = quantity_available - v_qty where id = v_asset;
    perform public.civ_set_avail(v_asset);
    insert into public.custody_inventory_assignment_items(assignment_id, asset_id, quantity, status) values (v_aid, v_asset, v_qty, 'active');
    insert into public.custody_inventory_movements(asset_id, assignment_id, movement_type, quantity_before, quantity_change, quantity_after, to_employee_id, reason, created_by, reference_type, reference_id)
      values (v_asset, v_aid, 'issue_to_employee', rec.quantity_available, -v_qty, rec.quantity_available - v_qty, v_emp, 'صرف حقيبة ' || v_no, v_emp, 'kit', v_kit);
    v_count := v_count + 1;
  end loop;

  for elem in select value from jsonb_array_elements(v_items) loop
    if nullif(elem->>'asset_id','') is null then continue; end if;
    for v_path in select value from jsonb_array_elements_text(coalesce(elem->'item_photos','[]'::jsonb)) loop
      if split_part(v_path,'/',1) <> v_emp::text then raise exception 'bad_evidence_path'; end if;
      insert into public.custody_inventory_evidence(assignment_id, assignment_item_id, asset_id, evidence_stage, file_path, uploaded_by)
      select v_aid, i.id, i.asset_id, 'issue_item', v_path, v_emp from public.custody_inventory_assignment_items i
       where i.assignment_id = v_aid and i.asset_id = (elem->>'asset_id')::uuid limit 1;
    end loop;
  end loop;
  for v_path in select value from jsonb_array_elements_text(coalesce(p_data->'group_photos','[]'::jsonb)) loop
    if split_part(v_path,'/',1) <> v_emp::text then raise exception 'bad_evidence_path'; end if;
    insert into public.custody_inventory_evidence(assignment_id, evidence_stage, file_path, uploaded_by) values (v_aid, 'issue_group', v_path, v_emp);
  end loop;

  insert into public.custody_inventory_kit_movements(kit_id, assignment_id, movement_type, snapshot, created_by)
    values (v_kit, v_aid, 'issued', coalesce(v_snap,'[]'::jsonb), v_emp);
  if v_missing_required > 0 then
    perform public.custody_audit('kit_required_override', 'custody_inventory_assignments', v_aid, jsonb_build_object('reason', p_data->>'override_reason'));
  end if;
  perform public.civ_notify(v_emp, 'kit_issued', v_aid, 'تم صرف حقيبة برقم عهدة ' || v_no, 'Kit issued: ' || v_no);
  perform public.civ_notify_managers('kit_issued', v_aid, 'صرف حقيبة ذاتي — عهدة ' || v_no, 'Self kit-issue: ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_aid, 'assignment_number', v_no, 'items', v_count);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RLS + GRANTS
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_qr_events                     enable row level security;
alter table public.custody_inventory_asset_components    enable row level security;
alter table public.custody_inventory_kits                enable row level security;
alter table public.custody_inventory_kit_items           enable row level security;
alter table public.custody_inventory_kit_versions        enable row level security;
alter table public.custody_inventory_kit_movements       enable row level security;

-- الإدارة/أمين العهدة يقرؤون كل جداول QR/Kits/Components. الموظف يقرأ الحقائب والمكوّنات
-- (تشغيليًا للصرف) لكن لا يقرأ سجل QR events (إداري).
drop policy if exists civ_qr_events_read on public.custody_qr_events;
create policy civ_qr_events_read on public.custody_qr_events for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_components_read on public.custody_inventory_asset_components;
create policy civ_components_read on public.custody_inventory_asset_components for select to authenticated using (public.is_staff());
drop policy if exists civ_kits_read on public.custody_inventory_kits;
create policy civ_kits_read on public.custody_inventory_kits for select to authenticated using (public.is_staff());
drop policy if exists civ_kit_items_read on public.custody_inventory_kit_items;
create policy civ_kit_items_read on public.custody_inventory_kit_items for select to authenticated using (public.is_staff());
drop policy if exists civ_kit_versions_read on public.custody_inventory_kit_versions;
create policy civ_kit_versions_read on public.custody_inventory_kit_versions for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_kit_moves_read on public.custody_inventory_kit_movements;
create policy civ_kit_moves_read on public.custody_inventory_kit_movements for select to authenticated using (public.civ_can_manage());

grant select on public.custody_qr_events, public.custody_inventory_asset_components, public.custody_inventory_kits,
  public.custody_inventory_kit_items, public.custody_inventory_kit_versions, public.custody_inventory_kit_movements to authenticated;

revoke execute on function public.custody_inv_admin_reissue_qr(uuid,text), public.custody_inv_log_label_print(uuid[],text), public.custody_inv_employee_issue_kit(jsonb) from public, anon;
grant execute on function public.civ_flag(text) to authenticated;
grant execute on function public.custody_inv_resolve_qr(uuid) to authenticated;
grant execute on function public.custody_inv_admin_reissue_qr(uuid,text) to authenticated;
grant execute on function public.custody_inv_log_label_print(uuid[],text) to authenticated;
grant execute on function public.custody_inv_admin_upsert_component(uuid,jsonb) to authenticated;
grant execute on function public.custody_inv_admin_remove_component(uuid) to authenticated;
grant execute on function public.custody_inv_admin_upsert_kit(uuid,jsonb) to authenticated;
grant execute on function public.custody_inv_admin_upsert_kit_item(uuid,uuid,uuid,text,numeric,boolean,int) to authenticated;
grant execute on function public.custody_inv_admin_remove_kit_item(uuid) to authenticated;
grant execute on function public.custody_inv_admin_snapshot_kit(uuid) to authenticated;
grant execute on function public.custody_inv_get_kit_resolved(uuid) to authenticated;
grant execute on function public.custody_inv_employee_issue_kit(jsonb) to authenticated;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'qr_cols' as k, count(*) from information_schema.columns where table_name='custody_inventory_assets' and column_name in ('qr_token','barcode_value','qr_status','label_version');
select 'kit_tables' as k, count(*) from information_schema.tables where table_name like 'custody_inventory_kit%';
select 'components' as k, count(*) from information_schema.tables where table_name='custody_inventory_asset_components';
select 'qr_rpcs' as k, count(*) from pg_proc where proname in ('custody_inv_resolve_qr','custody_inv_admin_reissue_qr','custody_inv_employee_issue_kit','custody_inv_get_kit_resolved');
select 'no_null_qr' as k, count(*) from public.custody_inventory_assets where qr_token is null and is_deleted = false;
-- ════════════════════════════════════════════════════════════════════════════
