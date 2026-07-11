-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 02: Project linking + E-signature + 3-stage Conditions
-- يُشغَّل بعد patch 01. idempotent. لا يلمس الأنظمة القديمة.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) ربط العهدة بالمشروع (Snapshot — لا ينشئ عميلًا ماليًا) ───
-- لا يوجد جدول projects؛ نخزّن لقطة قابلة للاستعلام + بقية الحقول في project_meta.
alter table public.custody_inventory_assignments add column if not exists project_company_id uuid references public.companies(id);
alter table public.custody_inventory_assignments add column if not exists project_name text;
alter table public.custody_inventory_assignments add column if not exists project_number text;
alter table public.custody_inventory_assignments add column if not exists is_external boolean not null default false;
alter table public.custody_inventory_assignments add column if not exists expected_out_at timestamptz;
alter table public.custody_inventory_assignments add column if not exists actual_return_at timestamptz;
alter table public.custody_inventory_assignments add column if not exists project_meta jsonb;   -- work_order/task_type/location/team/contact/needs_*
create index if not exists idx_civ_assign_project on public.custody_inventory_assignments(project_number) where is_deleted = false;

create or replace function public.custody_inv_set_project(p_assignment uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  -- صاحب العهدة أو الإدارة/أمين العهدة.
  if auth.uid() <> v_owner and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_assignments set
    project_company_id = nullif(p_data->>'company_id','')::uuid,
    project_name = nullif(trim(p_data->>'project_name'),''),
    project_number = nullif(trim(p_data->>'project_number'),''),
    is_external = coalesce((p_data->>'is_external')::boolean, is_external),
    expected_out_at = nullif(p_data->>'expected_out_at','')::timestamptz,
    project_meta = p_data - 'company_id' - 'project_name' - 'project_number' - 'is_external' - 'expected_out_at',
    updated_at = now()
  where id = p_assignment;
  perform public.custody_audit('project_linked', 'custody_inventory_assignments', p_assignment, jsonb_build_object('project', p_data->>'project_name'));
  return true;
end; $$;

-- تقرير أصول المشروع (للإدارة).
create or replace function public.custody_inv_admin_project_dashboard(p_project text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'assignments', (select count(*) from public.custody_inventory_assignments where project_number = p_project and is_deleted=false),
    'active', (select count(*) from public.custody_inventory_assignments where project_number = p_project and is_deleted=false and status in ('active','partially_returned','return_requested')),
    'overdue', (select count(*) from public.custody_inventory_assignments where project_number = p_project and is_deleted=false and status in ('active','partially_returned') and expected_return_at is not null and expected_return_at < now()),
    'items', (select count(*) from public.custody_inventory_assignment_items i join public.custody_inventory_assignments a on a.id=i.assignment_id where a.project_number = p_project and a.is_deleted=false)
  );
end; $$;

-- ─── 2) التوقيع الإلكتروني (إثبات موافقة داخلي — ليس توثيقًا حكوميًا) ───
create table if not exists public.custody_signatures (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid not null references public.custody_inventory_assignments(id) on delete cascade,
  signer_user_id     uuid not null references auth.users(id),
  stage              text not null default 'issue' check (stage in ('issue','return','reissue')),
  ack_version        int not null default 1,
  ack_text_snapshot  text not null,
  ack_hash           text,                       -- hash لمحتوى الإقرار + بيانات العهدة
  signature_path     text,                       -- صورة التوقيع في bucket خاص (اختياري)
  signer_name        text,
  ip                 text,
  user_agent         text,
  signed_at          timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_civ_sign_assign on public.custody_signatures(assignment_id);

create or replace function public.custody_inv_record_signature(
  p_assignment uuid, p_stage text, p_ack_text text, p_ack_hash text, p_signature_path text, p_signer_name text, p_user_agent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_ver int; v_id uuid;
begin
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_ack_text),'') = '' then raise exception 'ack_required'; end if;
  if p_signature_path is not null and split_part(p_signature_path,'/',1) <> auth.uid()::text then raise exception 'bad_evidence_path'; end if;
  select ack_version into v_ver from public.custody_enterprise_settings where id = 1;
  insert into public.custody_signatures(assignment_id, signer_user_id, stage, ack_version, ack_text_snapshot, ack_hash, signature_path, signer_name, ip, user_agent)
    values (p_assignment, auth.uid(), coalesce(nullif(p_stage,''),'issue'), coalesce(v_ver,1), p_ack_text, p_ack_hash, p_signature_path, nullif(trim(p_signer_name),''), public.civ_client_ip(), left(p_user_agent, 400))
    returning id into v_id;
  perform public.civ_notify_managers('custody_signature_completed', p_assignment, 'اكتمل توقيع إقرار العهدة', 'Custody acknowledgement signed');
  return v_id;
end; $$;

-- ─── 3) الفحص الثلاثي للحالة (يُحفظ منفصلًا — لا يُستبدل تقرير الموظف بنتيجة الفاحص) ───
create table if not exists public.custody_condition_reports (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid references public.custody_inventory_assignments(id) on delete cascade,
  assignment_item_id uuid references public.custody_inventory_assignment_items(id) on delete cascade,
  asset_id           uuid references public.custody_inventory_assets(id),
  stage              text not null check (stage in ('before_issue','employee_return','inspector_final')),
  grade              text not null check (grade in ('excellent','good','used','has_notes','partially_damaged','damaged','unusable','incomplete','missing')),
  notes              text,
  photos             jsonb not null default '[]',   -- مسارات صور مرتبطة (أدلة موجودة)
  video_path         text,
  recorded_by        uuid references auth.users(id),
  recorded_at        timestamptz not null default now(),
  is_deleted         boolean not null default false
);
create index if not exists idx_civ_cond_item on public.custody_condition_reports(assignment_item_id, stage);

create or replace function public.custody_inv_record_condition(
  p_assignment uuid, p_item uuid, p_stage text, p_grade text, p_notes text, p_photos jsonb, p_video text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_asset uuid; v_id uuid;
begin
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  -- الموظف يسجّل employee_return لعهده؛ الإدارة تسجّل before_issue/inspector_final.
  if p_stage = 'employee_return' then
    if auth.uid() <> v_owner then raise exception 'not authorized'; end if;
  else
    if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  end if;
  if p_item is not null then select asset_id into v_asset from public.custody_inventory_assignment_items where id = p_item and assignment_id = p_assignment; end if;
  insert into public.custody_condition_reports(assignment_id, assignment_item_id, asset_id, stage, grade, notes, photos, video_path, recorded_by)
    values (p_assignment, p_item, v_asset, p_stage, p_grade, nullif(trim(p_notes),''), coalesce(p_photos,'[]'::jsonb), nullif(trim(p_video),''), auth.uid())
    returning id into v_id;
  return v_id;
end; $$;

-- مقارنة الحالات لبند (كل المراحل + الأدلة).
create or replace function public.custody_inv_get_condition_history(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  select a.employee_user_id into v_owner from public.custody_inventory_assignment_items i
    join public.custody_inventory_assignments a on a.id = i.assignment_id where i.id = p_item;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'grade', grade, 'notes', notes, 'photos', photos,
    'recorded_at', recorded_at) order by recorded_at) from public.custody_condition_reports where assignment_item_id = p_item and is_deleted=false), '[]'::jsonb);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Storage bucket للتواقيع (خاص) + RLS + GRANTS
-- ════════════════════════════════════════════════════════════════════════════
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-inventory-signatures','custody-inventory-signatures', false, 3145728, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false, file_size_limit=3145728, allowed_mime_types=array['image/png','image/jpeg','image/webp'];
drop policy if exists "civ sign read" on storage.objects;
create policy "civ sign read" on storage.objects for select to authenticated
  using (bucket_id='custody-inventory-signatures' and (public.civ_can_manage() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "civ sign upload" on storage.objects;
create policy "civ sign upload" on storage.objects for insert to authenticated
  with check (bucket_id='custody-inventory-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.custody_signatures        enable row level security;
alter table public.custody_condition_reports enable row level security;
drop policy if exists civ_sign_read on public.custody_signatures;
create policy civ_sign_read on public.custody_signatures for select to authenticated
  using (public.civ_can_manage() or signer_user_id = auth.uid());
drop policy if exists civ_cond_read on public.custody_condition_reports;
create policy civ_cond_read on public.custody_condition_reports for select to authenticated
  using (public.civ_can_manage() or exists (select 1 from public.custody_inventory_assignments a where a.id = assignment_id and a.employee_user_id = auth.uid()));

grant select on public.custody_signatures, public.custody_condition_reports to authenticated;
revoke execute on function public.custody_inv_set_project(uuid,jsonb), public.custody_inv_admin_project_dashboard(text),
  public.custody_inv_record_signature(uuid,text,text,text,text,text,text), public.custody_inv_record_condition(uuid,uuid,text,text,text,jsonb,text),
  public.custody_inv_get_condition_history(uuid) from public, anon;
grant execute on function public.custody_inv_set_project(uuid,jsonb) to authenticated;
grant execute on function public.custody_inv_admin_project_dashboard(text) to authenticated;
grant execute on function public.custody_inv_record_signature(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.custody_inv_record_condition(uuid,uuid,text,text,text,jsonb,text) to authenticated;
grant execute on function public.custody_inv_get_condition_history(uuid) to authenticated;
commit;

notify pgrst, 'reload schema';

-- VALIDATION
select 'sig_table' as k, count(*) from information_schema.tables where table_name='custody_signatures';
select 'cond_table' as k, count(*) from information_schema.tables where table_name='custody_condition_reports';
select 'proj_cols' as k, count(*) from information_schema.columns where table_name='custody_inventory_assignments' and column_name in ('project_name','project_meta','is_external');
select 'sig_bucket' as k, public from storage.buckets where id='custody-inventory-signatures';
