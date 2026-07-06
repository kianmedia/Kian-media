-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — v4 PATCH: توجيه إشعارات العهدة + خصوصية الإشعارات + عرض سعر التأجير
-- شغّله مرة واحدة في Supabase SQL Editor (idempotent — يشمل محتوى v3 كاملاً،
-- فإن كنت شغّلت v3 فلا مشكلة، وإن لم تشغّله فهذا الملف يكفي وحده).
--
-- يتضمن:
--   1) [خصوصية حرجة] سياسات صارمة على public.notifications: كل مستخدم يرى صفوفه
--      فقط؛ بثّ الإدارة (recipient_id IS NULL) يظهر حصراً لحسابات is_admin().
--      كتلة DO تسقط كل السياسات القديمة أياً كانت أسماؤها (تصيب السياسة المسرِّبة).
--   2) custody_notify_admins: صفوف شخصية (بلا بث) إلى: حسابات الأدمن +
--      المالك super_admin + المدير manager + أمين العهدة custody_officer —
--      فتصل إشعارات الخروج/الإرجاع/المطالبات للجميع مع عمل عدّاد الجرس.
--   3) [جديد] custody_notify_rental_quote: عند إرسال "طلب تأجير معدات — عرض سعر"
--      تُنشأ إشعارات بوابة شخصية لنفس المجموعة (النوع quote_request_new القائم —
--      لا تغيير على قيد الأنواع)، بعد التحقق أن الطلب يخص المستدعي نفسه.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) خصوصية الإشعارات — سياسات صارمة ═════════════════════════════════
alter table public.notifications enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'notifications'
  loop
    execute format('drop policy %I on public.notifications', p.policyname);
  end loop;
end $$;

create policy notifications_read_strict on public.notifications
  for select to authenticated
  using (
    recipient_id = auth.uid()
    or (recipient_id is null and recipient_role = 'admin' and public.is_admin())
  );

create policy notifications_mark_read_strict on public.notifications
  for update to authenticated
  using (
    recipient_id = auth.uid()
    or (recipient_id is null and recipient_role = 'admin' and public.is_admin())
  )
  with check (
    recipient_id = auth.uid()
    or (recipient_id is null and recipient_role = 'admin' and public.is_admin())
  );

-- ════════ 2) مستلمو إشعارات العهدة (صفوف شخصية بلا بث) ═══════════════════════
create or replace function public.custody_notify_admins(
  p_type text, p_record uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles
            where account_status = 'active'
              and (account_type = 'admin'
                   or staff_role in ('super_admin','manager','custody_officer')) loop
    perform public.custody_notify(r.id, p_type, p_record, p_ar, p_en);
  end loop;
end; $$;
revoke execute on function public.custody_notify_admins(text,uuid,text,text) from public, anon, authenticated;

-- ════════ 3) إشعار بوابة عند طلب عرض سعر تأجير معدات ═════════════════════════
-- يتحقق أن طلب السعر يخص المستدعي (user_id = auth.uid()) ثم يُشعر مجموعة الإدارة
-- بصفوف شخصية. النوع quote_request_new موجود أصلاً في قيد الأنواع — لا تعديل عليه.
create or replace function public.custody_notify_rental_quote(
  p_quote_request uuid, p_reference text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_ref text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.quote_requests
                  where id = p_quote_request and user_id = auth.uid())
    then raise exception 'quote request not yours'; end if;

  select coalesce(rp.full_name, pr.full_name, pr.email) into v_name
    from public.profiles pr
    left join public.renter_profiles rp on rp.user_id = pr.id
   where pr.id = auth.uid();
  v_ref := coalesce(nullif(trim(p_reference), ''), 'بدون مرجع');

  for r in select id from public.profiles
            where account_status = 'active'
              and (account_type = 'admin'
                   or staff_role in ('super_admin','manager','custody_officer')) loop
    perform public.notify(r.id, 'user', 'quote_request_new', 'quote_request', p_quote_request,
      'طلب تأجير معدات (عرض سعر) ' || v_ref || ' من ' || coalesce(v_name, 'مستأجر'),
      'Equipment rental quote request ' || v_ref || ' from ' || coalesce(v_name, 'a renter'));
  end loop;
  return true;
end; $$;
revoke execute on function public.custody_notify_rental_quote(uuid,text) from public, anon;
grant  execute on function public.custody_notify_rental_quote(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION:
-- 1) سياستان فقط على notifications:
select policyname, cmd from pg_policies
 where schemaname='public' and tablename='notifications' order by policyname;
-- 2) الدوال الثلاث موجودة:
select proname from pg_proc where proname in
 ('custody_notify_admins','custody_notify_rental_quote','custody_notify') order by 1;
-- 3) اختبار عملي: حساب عميل جديد يفتح تبويب الإشعارات → يرى إشعاراته فقط.
--    حساب أدمن/مالك/مدير/أمين عهدة → يصله إشعار شخصي (مع العدّاد) عند أي حركة عهدة.
-- ════════════════════════════════════════════════════════════════════════════
