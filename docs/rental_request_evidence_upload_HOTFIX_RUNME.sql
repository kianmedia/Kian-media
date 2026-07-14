-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — REQUEST EVIDENCE UPLOAD HOTFIX (إصلاح رفع صور الطلب)
-- ────────────────────────────────────────────────────────────────────────────
-- العطل الحي: «تعذر رفع الصورة» — سببان: (1) bucket rental-evidence يقبل jpeg/png/webp
--   فقط فيرفض HEIC/HEIF (صور iPhone) وحدّ 10MB؛ (2) سياسة كتابة المستأجر غير مطبّقة/غير
--   محدّدة النطاق. الحل: توسيع MIME/الحجم + سياسات مُحكمة (موظف أي مسار / المستأجر مسارات
--   طلبه فقط) + RPC إرفاق موحّدة (تحقّق مسار/تكرار/وجود الملف/عدم الإغلاق) + RPC حذف قبل
--   الإرسال + RPC اكتمال. (العميل يطبّع الصور إلى JPEG قبل الرفع أيضًا.)
-- idempotent · غير هدّام · لا يحذف صورًا/طلبات · لا يعيد Foundation · بلا Fixtures.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight ───
do $$
begin
  if to_regclass('public.custody_rental_requests') is null or to_regclass('public.custody_rental_evidence') is null then
    raise exception 'PREFLIGHT FAILED — طبّق ملفات التأجير أولًا.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_evidence' and column_name='stage') then
    raise exception 'PREFLIGHT FAILED — custody_rental_evidence.stage مفقود.';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;
-- ─── 1) توسيع صيغ/حجم bucket rental-evidence (+HEIC/HEIF، 20MB) ───
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'],
       file_size_limit = 20971520
 where id = 'rental-evidence';

-- منع تكرار سطر دليل بنفس المسار (idempotent + retry آمن).
create unique index if not exists uq_rental_evidence_path on public.custody_rental_evidence(file_path);
create index if not exists idx_rental_evidence_stage on public.custody_rental_evidence(request_id, stage);
-- ضمان أن مرحلة 'request' مسموحة (لو طُبّق هذا الملف قبل binding) — superset، لا قيمة محذوفة.
alter table public.custody_rental_evidence drop constraint if exists custody_rental_evidence_stage_check;
alter table public.custody_rental_evidence add constraint custody_rental_evidence_stage_check
  check (stage in ('handover','return_request','return_inspection','request','closeout'));
commit;

-- ─── 2) سياسات Storage مُحكمة (تستبدل السياسات السابقة) ───
begin;
-- ملكية مسار: (storage.foldername(name))[2] = rental_id، والمستخدم صاحب هذا الطلب.
drop policy if exists "rental evidence write"        on storage.objects;
drop policy if exists "rental evidence renter write" on storage.objects;
drop policy if exists "rental evidence read"         on storage.objects;
drop policy if exists "rental evidence write v2"     on storage.objects;
drop policy if exists "rental evidence read v2"      on storage.objects;
drop policy if exists "rental evidence delete v2"    on storage.objects;

-- INSERT: موظف أي مسار rental/ ، أو المستأجر لمسار طلبه.
create policy "rental evidence write v2" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-evidence' and (storage.foldername(name))[1] = 'rental' and (
    public.civ_can_manage() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.id::text = (storage.foldername(name))[2])));

-- SELECT: موظف/مالية أي مسار، أو المستأجر أدلة طلبه (لتوليد Signed URL لصوره فقط).
create policy "rental evidence read v2" on storage.objects for select to authenticated
  using (bucket_id = 'rental-evidence' and (
    public.civ_can_manage() or public.civ_can_finance() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.id::text = (storage.foldername(name))[2])));

-- DELETE: المستأجر لمسار طلبه ما دام draft (حذف/استبدال قبل الإرسال)، أو موظف.
create policy "rental evidence delete v2" on storage.objects for delete to authenticated
  using (bucket_id = 'rental-evidence' and (
    public.civ_can_manage() or exists (
      select 1 from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
      where c.user_id = auth.uid() and req.status = 'draft' and req.id::text = (storage.foldername(name))[2])));
commit;

-- ─── 3) RPC إرفاق دليل موحّدة (مستأجر صاحب الطلب أو موظف) ───
begin;
create or replace function public.custody_rental_add_request_evidence(
  p_rental_id uuid, p_rental_item_id uuid default null, p_evidence_type text default 'item_photo',
  p_storage_path text default null, p_mime_type text default null, p_file_size bigint default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare r record; v_is_staff boolean; v_is_owner boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if p_evidence_type not in ('item_photo','overall_photo') then raise exception 'bad_evidence_type'; end if;
  if coalesce(trim(p_storage_path),'') = '' then raise exception 'path_required'; end if;
  if p_evidence_type = 'item_photo' and p_rental_item_id is null then raise exception 'item_required'; end if;
  if p_evidence_type = 'overall_photo' and p_rental_item_id is not null then raise exception 'overall_no_item'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'not_editable'; end if;
  v_is_staff := public.civ_can_manage();
  v_is_owner := exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid());
  if not (v_is_staff or v_is_owner) then raise exception 'not authorized'; end if;
  -- المستأجر لا يضيف إلا لمسودته.
  if v_is_owner and not v_is_staff and r.status <> 'draft' then raise exception 'not_editable'; end if;
  -- المسار يجب أن يبدأ بمسار هذا الطلب في bucket الأدلة.
  if position('rental/'||p_rental_id::text||'/' in p_storage_path) <> 1 then raise exception 'bad_path'; end if;
  if p_rental_item_id is not null and not exists (select 1 from public.custody_rental_items where id = p_rental_item_id and request_id = p_rental_id) then raise exception 'item_not_in_request'; end if;
  -- تأكيد أن كائن التخزين مرفوع فعلًا (يمنع سجلًا يتيمًا).
  if not exists (select 1 from storage.objects o where o.bucket_id = 'rental-evidence' and o.name = p_storage_path) then raise exception 'storage_object_missing'; end if;
  -- منع التكرار (idempotent / retry آمن) — إن وُجد نفس المسار نعيده ناجحًا.
  if exists (select 1 from public.custody_rental_evidence where file_path = p_storage_path) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, note, uploaded_by)
    values (p_rental_id, p_rental_item_id, 'request', p_storage_path,
            nullif(concat_ws(' ', p_mime_type, case when p_file_size is not null then '('||p_file_size||'B)' end),''), auth.uid());
  return jsonb_build_object('ok', true);
end; $$;

-- حذف دليل مرحلة الإنشاء قبل الإرسال (المستأجر لمسودته أو موظف). لا يحذف كائن التخزين هنا
--   (تتكفّل به الواجهة عبر سياسة DELETE)؛ يزيل سجل القاعدة فقط.
create or replace function public.custody_rental_remove_request_evidence(p_rental_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into r from public.custody_rental_requests where id = p_rental_id;
  if r.id is null then raise exception 'not_found'; end if;
  if not (public.civ_can_manage() or exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid())) then raise exception 'not authorized'; end if;
  if not public.civ_can_manage() and r.status <> 'draft' then raise exception 'not_editable'; end if;
  delete from public.custody_rental_evidence where request_id = p_rental_id and stage = 'request' and file_path = p_path;
  return jsonb_build_object('ok', true);
end; $$;

-- حالة اكتمال صور الإنشاء (لعرض المعدات الناقصة صورها).
create or replace function public.custody_rental_request_evidence_status(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; v_items jsonb; v_overall int;
begin
  select req.* into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and (c.user_id = auth.uid() or public.civ_can_manage() or public.civ_can_finance());
  if r.id is null then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'asset_name', a.asset_name, 'asset_code', a.asset_code,
      'has_photo', exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'request'))
    order by a.asset_name), '[]'::jsonb) into v_items
    from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request;
  select count(*) into v_overall from public.custody_rental_evidence e where e.request_id = p_request and e.stage = 'request' and e.item_id is null;
  return jsonb_build_object('items', v_items, 'overall_count', v_overall,
    'all_items_have_photo', not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'has_photo')::boolean = false),
    'complete', v_overall > 0 and not exists (select 1 from jsonb_array_elements(v_items) x where (x->>'has_photo')::boolean = false));
end; $$;
commit;

-- ─── 4) الصلاحيات + إعادة تحميل المخطط ───
begin;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_add_request_evidence(uuid,uuid,text,text,text,bigint)',
    'custody_rental_remove_request_evidence(uuid,text)',
    'custody_rental_request_evidence_status(uuid)'])
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
select 'bucket_mime' as k, allowed_mime_types, file_size_limit from storage.buckets where id = 'rental-evidence';
select 'evidence_policies' as k, policyname, cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'rental evidence%' order by policyname;
select 'uq_evidence_path' as k, count(*) from pg_indexes where indexname='uq_rental_evidence_path';
select 'rpcs' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('custody_rental_add_request_evidence','custody_rental_remove_request_evidence','custody_rental_request_evidence_status')
order by p.proname;
