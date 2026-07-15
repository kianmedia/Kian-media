-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — إصلاح رفع صور أدلة التأجير (السبب الجذري المُثبَت)
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة المُثبَتة من السياسات المطبّقة فعلًا:
--   سياسات storage.objects لمخزن rental-evidence تتحقق من ملكية المستأجر عبر
--   subquery مباشر: (select 1 from custody_rental_requests req join
--   custody_rental_customers c ...). هذا الـsubquery يخضع لـRLS الجدول
--   custody_rental_requests، وسياسته النهائية (civ_rental_req_read، آخر تعريف في
--   rental_insurance_production_RUNME.sql سطر 770) = civ_can_manage() OR
--   civ_can_finance() فقط — أي أن المستأجر (غير الموظف) لا يستطيع قراءة صف طلبه
--   مباشرةً. لذا يعود الـEXISTS فارغًا ⇒ يفشل فحص الملكية ⇒ يُرفض رفع الصورة (403)
--   لكل مستأجر غير موظف. (الموظف/المالك ينجح لأنه يمرّ عبر civ_can_manage.)
--
-- الإصلاح: تحقّق الملكية عبر دالة SECURITY DEFINER تتجاوز RLS على الطلبات (دون
--   لمس سياسة قراءة الطلبات المقصودة أن تكون للموظفين). auth.uid() يبقى المستأجر.
--
-- idempotent + غير مدمّر. لا يغيّر المخزن ولا بيانات. Rollback معلّق بالأسفل.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.civ_can_manage()') is null
     or to_regclass('public.custody_rental_requests') is null
     or to_regclass('public.custody_rental_customers') is null then
    raise exception 'PREFLIGHT: أساس التأجير غير مطبّق';
  end if;
end $$;

begin;

-- ─── 1) دالة تحقّق الملكية (تتجاوز RLS على الطلبات؛ auth.uid() = المستأجر) ───
-- p_name = اسم كائن التخزين (المسار). الملكية عبر segment رقم 2 = معرّف الطلب.
create or replace function public.rental_evidence_is_owner(p_name text, p_draft_only boolean default false)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select exists (
    select 1
    from public.custody_rental_requests req
    join public.custody_rental_customers c on c.id = req.customer_id
    where c.user_id = auth.uid()
      and req.id::text = (storage.foldername(p_name))[2]
      and (not p_draft_only or req.status = 'draft'));
$$;
revoke all on function public.rental_evidence_is_owner(text, boolean) from public, anon;
grant  execute on function public.rental_evidence_is_owner(text, boolean) to authenticated;

-- ─── 2) إعادة إنشاء سياسات storage للمخزن باستخدام الدالة (لا subquery خاضع لـRLS) ───
-- INSERT: موظف أي مسار rental/ ، أو المستأجر صاحب الطلب.
drop policy if exists "rental evidence write v2" on storage.objects;
create policy "rental evidence write v2" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'rental-evidence'
    and (storage.foldername(name))[1] = 'rental'
    and (public.civ_can_manage() or public.rental_evidence_is_owner(name, false)));

-- SELECT: موظف/مالية أي مسار، أو المستأجر أدلة طلبه (لتوليد Signed URL لصوره).
drop policy if exists "rental evidence read v2" on storage.objects;
create policy "rental evidence read v2" on storage.objects for select to authenticated
  using (
    bucket_id = 'rental-evidence'
    and (public.civ_can_manage() or public.civ_can_finance() or public.rental_evidence_is_owner(name, false)));

-- DELETE: المستأجر لمسار طلبه ما دام draft (حذف/استبدال قبل الإرسال)، أو موظف.
drop policy if exists "rental evidence delete v2" on storage.objects;
create policy "rental evidence delete v2" on storage.objects for delete to authenticated
  using (
    bucket_id = 'rental-evidence'
    and (public.civ_can_manage() or public.rental_evidence_is_owner(name, true)));

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
select 'fn' as k, proname, has_function_privilege('authenticated', oid, 'execute') as auth_exec
  from pg_proc where proname = 'rental_evidence_is_owner';
select 'policies' as k, policyname, cmd from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'rental evidence%'
  order by policyname;
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (يدوي عند الحاجة فقط — يعيد السياسات إلى صيغة الـsubquery المباشر):
-- begin;
--   drop policy if exists "rental evidence write v2"  on storage.objects;
--   create policy "rental evidence write v2" on storage.objects for insert to authenticated
--     with check (bucket_id='rental-evidence' and (storage.foldername(name))[1]='rental' and (
--       public.civ_can_manage() or exists (select 1 from public.custody_rental_requests req
--         join public.custody_rental_customers c on c.id=req.customer_id
--         where c.user_id=auth.uid() and req.id::text=(storage.foldername(name))[2])));
--   -- (وبالمثل read/delete) ثم:
--   drop function if exists public.rental_evidence_is_owner(text, boolean);
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
