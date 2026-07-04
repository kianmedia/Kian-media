-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — v3 PATCH عاجل: خصوصية الإشعارات + مستلمو إشعارات العهدة
-- Run ONCE in the Supabase SQL Editor — يعمل فورًا على قاعدة الإنتاج (idempotent).
--
-- المشكلة 1 (تسريب حرج): أي مستخدم مسجّل في البوابة كان يرى إشعارات الإدارة
-- (كل خطوات البوابة). السبب: سياسة قراءة متساهلة/قديمة على public.notifications.
-- الحل: إسقاط كل سياسات SELECT/UPDATE/ALL الموجودة على الجدول أيًا كانت أسماؤها
-- (كتلة DO ديناميكية — تصيب السياسة المسرِّبة مهما كان اسمها) ثم إنشاء سياسات
-- صارمة: كل مستخدم يرى صفوفه فقط (recipient_id = auth.uid())، وبثّ الإدارة
-- (recipient_id IS NULL + recipient_role='admin') يظهر حصراً لحسابات is_admin().
--
-- المشكلة 2: إشعارات خروج/إرجاع العهدة كانت تصل فعليًا لأمين العهدة فقط (البثّ
-- لا يظهر في عدّاد الجرس ولا يصل للمدراء). الحل: custody_notify_admins ترسل
-- صفوفًا شخصية لكل من: حسابات الأدمن (account_type='admin') + المالك super_admin
-- + المدير manager + أمين العهدة custody_officer — بلا بث (لا تكرار، وعدّاد
-- الجرس يعمل للجميع).
--
-- آمن: لا يغيّر بنية الجدول ولا notify() ولا أي وحدة أخرى؛ سياسات فقط + دالة عهدة.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) خصوصية الإشعارات — سياسات صارمة ═════════════════════════════════
alter table public.notifications enable row level security;

-- أسقط كل سياسات القراءة/التحديث/الشاملة الحالية أياً كانت أسماؤها (يصيب السياسة
-- المسرِّبة حتى لو أنشأها ترحيل قديم باسم مختلف). سياسات INSERT/DELETE لا وجود
-- لها (الكتابة عبر notify() الأمنية فقط) لكن الكتلة تسقطها أيضاً إن وُجدت شذوذاً.
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

-- القراءة: صفوفي فقط + بثّ الإدارة لحسابات الأدمن حصراً.
create policy notifications_read_strict on public.notifications
  for select to authenticated
  using (
    recipient_id = auth.uid()
    or (recipient_id is null and recipient_role = 'admin' and public.is_admin())
  );

-- التحديث (تعليم كمقروء فقط — grant update(read_at) القائم يبقى كما هو):
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

-- ════════ 2) مستلمو إشعارات العهدة: أدمن + مالك + مدير + أمين عهدة ═══════════
-- صفوف شخصية للجميع (بلا بث): تظهر في القائمة وفي عدّاد الجرس لكل مستلم.
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

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION — شغّلها بعد التنفيذ:
-- 1) يجب أن تظهر سياستان فقط على notifications (القراءة والتحديث الصارمتان):
select policyname, cmd from pg_policies
 where schemaname='public' and tablename='notifications' order by policyname;
-- 2) نص سياسة القراءة (يجب أن يتضمن is_admin() لبثّ الإدارة):
select policyname, qual from pg_policies
 where schemaname='public' and tablename='notifications' and policyname='notifications_read_strict';
-- 3) اختبار عملي: افتح تبويب الإشعارات بحساب عميل/زائر جديد — يجب ألا يرى إلا
--    إشعاراته الشخصية فقط (ولا أي إشعار إداري).
-- ════════════════════════════════════════════════════════════════════════════
