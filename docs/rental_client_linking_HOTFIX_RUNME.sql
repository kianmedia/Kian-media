-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental — CLIENT LINKING HOTFIX (إصلاح اختيار وربط عميل البوابة)
-- ────────────────────────────────────────────────────────────────────────────
-- العطل الحي: عند الضغط على عميل غير مرتبط تظهر «الخدمة غير مهيأة بعد» لأن دالة الربط
--   custody_rental_admin_link_portal_client غير موجودة في مخزّن مخطط PostgREST المطبّق
--   (كانت ضمن الـHotfix التشغيلي غير المطبّق) — أو باسم بارامتر قديم (p_profile).
-- الحل: توقيع قانوني نهائي p_profile_id uuid + منع التكرار عبر unique index + تطبيع الرد.
-- idempotent · غير هدّام · لا يحذف عملاء/طلبات · لا يعيد Foundation · بلا Fixtures.
-- صالح على قاعدة Production الحالية. الخطوة اليدوية الوحيدة لهذا الإصلاح = تشغيله كاملًا.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0) Preflight: فحص الـschema الفعلي (متطلبات موجودة مسبقًا) ───
do $$
begin
  if to_regclass('public.custody_rental_customers') is null or to_regclass('public.profiles') is null then
    raise exception 'PREFLIGHT FAILED — طبّق docs/rental_insurance_production_RUNME.sql أولًا.';
  end if;
  if to_regprocedure('public.civ_can_manage()') is null or to_regprocedure('public.civ_can_admin()') is null then
    raise exception 'PREFLIGHT FAILED — دوال civ_* مفقودة (طبّق custody_inventory v1).';
  end if;
  -- تأكيد الأعمدة الفعلية على custody_rental_customers (user_id مفتاح الربط الثابت).
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='custody_rental_customers' and column_name='user_id') then
    raise exception 'PREFLIGHT FAILED — custody_rental_customers.user_id مفقود (schema غير متوقّع).';
  end if;
  raise notice 'PREFLIGHT OK.';
end $$;

begin;

-- ─── 1) مفتاح منع التكرار: عميل تأجير واحد لكل مستخدم بوابة (idempotent) ───
create unique index if not exists uq_rental_customer_user on public.custody_rental_customers(user_id) where user_id is not null;

-- ─── 2) إزالة أي توقيع قديم متعارض بالأنواع صراحةً (اسم البارامتر تغيّر p_profile→p_profile_id،
--        وCREATE OR REPLACE لا يغيّر اسم بارامتر لنفس الأنواع ⇒ يلزم DROP بالتوقيع). لا DROP بالاسم فقط. ───
drop function if exists public.custody_rental_admin_link_portal_client(uuid);

-- ─── 3) التوقيع القانوني النهائي ───
create function public.custody_rental_admin_link_portal_client(p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare pr record; v_id uuid; v_party text;
begin
  -- الدور: owner/super_admin/admin/manager فقط. يمنع client/employee/anon.
  if not (public.civ_can_admin() or public.civ_can_manage()) then raise exception 'not authorized'; end if;
  -- تُقرأ بيانات العميل داخليًا من profiles (لا تُستقبل من المتصفح).
  select id, full_name, company, email, mobile, account_type, account_status into pr
    from public.profiles where id = p_profile_id;
  if pr.id is null then raise exception 'profile_not_found'; end if;
  if pr.account_status <> 'active' or pr.account_type not in ('client','admin') then raise exception 'invalid_account'; end if;
  v_party := case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end;
  -- إعادة استخدام السجل الموجود إن وُجد؛ وإلا إنشاء سجل واحد (upsert بمفتاح ثابت — لا تكرار).
  --   عند التعارض لا نُصفّي بيانات السجل القائم — نكتفي بلمسة updated_at ثم نعيد id نفسه.
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (p_profile_id, v_party, coalesce(nullif(trim(pr.full_name),''), pr.email, 'عميل'), nullif(trim(pr.company),''), pr.mobile, pr.email, auth.uid())
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_id;
  -- الرد القانوني الثابت (بيانات العميل من profiles للتعبئة التلقائية).
  return jsonb_build_object(
    'rental_customer_id', v_id, 'profile_id', pr.id, 'full_name', pr.full_name,
    'company', pr.company, 'email', pr.email, 'mobile', pr.mobile, 'account_type', pr.account_type);
end; $$;

-- ─── 4) الصلاحيات ───
revoke all on function public.custody_rental_admin_link_portal_client(uuid) from public, anon;
grant execute on function public.custody_rental_admin_link_portal_client(uuid) to authenticated;
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Validation (SELECT/DO فقط) — يثبت التوقيع والصلاحيات والفهرس ومنع التكرار
-- ════════════════════════════════════════════════════════════════════════════
-- (1) نسخة واحدة فقط + التوقيع p_profile_id uuid:
select 'link_fn' as k, p.proname, pg_get_function_identity_arguments(p.oid) as args, count(*) over () as versions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='custody_rental_admin_link_portal_client';
-- (3,4) Execute: authenticated=نعم، anon=لا:
select 'grants' as k, r.rolname, has_function_privilege(r.rolname, to_regprocedure('public.custody_rental_admin_link_portal_client(uuid)'), 'execute') as can_exec
from (values ('authenticated'),('anon')) r(rolname);
-- (5) فهرس منع التكرار موجود:
select 'unique_index' as k, indexname from pg_indexes where schemaname='public' and indexname='uq_rental_customer_user';
-- (6) لا تكرار حالي على user_id:
select 'dup_check' as k, coalesce(max(cnt),0) as max_per_user from (
  select user_id, count(*) cnt from public.custody_rental_customers where user_id is not null group by user_id) t;
-- (7,8) اختبار حي (يُلتقط الخطأ إن نُفّذ بلا JWT في محرّر SQL — لا يوقف الـValidation):
do $$
declare v_prof uuid; v1 jsonb; v2 jsonb;
begin
  select id into v_prof from public.profiles where account_status='active' and account_type in ('client','admin') limit 1;
  if v_prof is null then raise notice 'link sample: no eligible profile'; return; end if;
  begin
    v1 := public.custody_rental_admin_link_portal_client(v_prof);
    v2 := public.custody_rental_admin_link_portal_client(v_prof);  -- ثانية = يجب نفس المعرّف (لا تكرار)
    raise notice 'link sample: id1=% id2=% same=%', v1->>'rental_customer_id', v2->>'rental_customer_id', (v1->>'rental_customer_id') = (v2->>'rental_customer_id');
  exception when others then
    raise notice 'link sample skipped (%). الدالة موجودة؛ نفّذ الاختبار الحي من التطبيق بحساب مدير.', sqlerrm;
  end;
end $$;
