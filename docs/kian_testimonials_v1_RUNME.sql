-- ════════════════════════════════════════════════════════════════════════════
-- RUN ME — Kian Operations Platform · Module 1: Testimonials (آراء العملاء)
-- ────────────────────────────────────────────────────────────────────────────
-- أول قيمة مرئية للمنصة: يحوّل قسم "Reviews" في الصفحة الرئيسية من حالة فارغة
-- ثابتة إلى نظام حقيقي (عرض معتمد + استقبال عام + اعتدال إداري).
--
-- SAFETY / العقد:
--   • إضافي بالكامل: لا يعدّل أي جدول/دالة قائمة عدا إضافة عمود علم واحد آمن.
--   • خلف Feature Flag `testimonials_enabled` (افتراضيًا OFF) — لا يظهر شيء للعامة
--     حتى تفعّله يدويًا؛ الصفحة الرئيسية تُبقي حالتها الأنيقة الحالية كـ fallback.
--   • الاستقبال العام عبر RPC واحدة security definer ممنوحة لـ anon (لا صلاحيات
--     جدول لـ anon)، مع Rate-Limit على IP. الاعتدال عبر RPCs محمية civ_can_manage().
--   • لا service_role، لا bucket عام، لا حذف بيانات، RLS مفعّل، القراءة العامة
--     تُظهر فقط الحقول الآمنة (لا IP/UA).
--   • idempotent: يُعاد تشغيله بأمان (IF [NOT] EXISTS / CREATE OR REPLACE /
--     drop-then-create policies). Rollback بلوك معلّق منفصل بالأسفل (لا يعمل باللصق).
--
-- يعتمد على (من الأنظمة القائمة — preflight يتحقق):
--   custody_enterprise_settings, civ_flag(text), civ_can_manage(), civ_can_admin(),
--   civ_client_ip(), custody_audit(text,text,uuid,jsonb).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Preflight: تأكّد من وجود الاعتماديات قبل أي تعديل ───
do $$
begin
  if to_regclass('public.custody_enterprise_settings') is null then
    raise exception 'PREFLIGHT: custody_enterprise_settings مفقود — شغّل custody_enterprise_00 أولًا';
  end if;
  if to_regprocedure('public.civ_flag(text)') is null
     or to_regprocedure('public.civ_can_manage()') is null
     or to_regprocedure('public.civ_can_admin()') is null
     or to_regprocedure('public.civ_client_ip()') is null then
    raise exception 'PREFLIGHT: دوال civ_* المطلوبة مفقودة — شغّل أساس نظام المخزون/العهد أولًا';
  end if;
end $$;

begin;

-- ─── 1) علم الميزة (آمن، افتراضيًا OFF) ───
alter table public.custody_enterprise_settings
  add column if not exists testimonials_enabled boolean not null default false;

-- ─── 2) جدول الشهادات ───
create table if not exists public.kian_testimonials (
  id            uuid primary key default gen_random_uuid(),
  client_name   text not null check (char_length(btrim(client_name)) between 2 and 120),
  client_title  text check (client_title is null or char_length(client_title) <= 160),
  company       text check (company is null or char_length(company) <= 160),
  rating        int  check (rating is null or rating between 1 and 5),
  body          text not null check (char_length(btrim(body)) between 10 and 2000),
  lang          text not null default 'ar' check (lang in ('ar','en')),
  project_ref   text check (project_ref is null or char_length(project_ref) <= 200),
  source        text not null default 'public_form' check (source in ('public_form','admin','invite')),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','hidden')),
  is_featured   boolean not null default false,
  display_order int not null default 0,
  consent       boolean not null default false,
  submitted_ip  text,
  submitted_ua  text,
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 400),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists kian_testimonials_status_idx
  on public.kian_testimonials (status, is_featured desc, display_order asc, created_at desc);
create index if not exists kian_testimonials_public_idx
  on public.kian_testimonials (is_featured desc, display_order asc, created_at desc)
  where status = 'approved';
-- فهرس Rate-Limit: بحث سريع بحسب IP خلال نافذة زمنية.
create index if not exists kian_testimonials_ip_time_idx
  on public.kian_testimonials (submitted_ip, created_at desc)
  where submitted_ip is not null;

-- ─── 3) RLS: القراءة عبر PostgREST لمن يملك الإدارة فقط؛ لا صلاحيات anon على الجدول ───
alter table public.kian_testimonials enable row level security;
grant select on public.kian_testimonials to authenticated;
-- (لا insert/update/delete grants، ولا anon grants — كل الكتابة عبر RPCs.)

drop policy if exists "testimonials manage read" on public.kian_testimonials;
create policy "testimonials manage read" on public.kian_testimonials
  for select to authenticated
  using (public.civ_can_manage());

-- ─── 4) قراءة عامة (anon) — معتمدة فقط + محكومة بالعلم؛ حقول آمنة فقط ───
create or replace function public.kian_public_testimonials(p_limit int default 12)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled boolean := public.civ_flag('testimonials_enabled');
  v_items   jsonb   := '[]'::jsonb;
  v_lim     int     := greatest(1, least(coalesce(p_limit, 12), 50));
begin
  if v_enabled then
    -- LIMIT applied in the subquery (correct rows); jsonb_agg carries its own
    -- ORDER BY so the JSON array order is guaranteed (agg does not inherit it).
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', t.id,
                 'client_name', t.client_name,
                 'client_title', t.client_title,
                 'company', t.company,
                 'rating', t.rating,
                 'body', t.body,
                 'lang', t.lang,
                 'is_featured', t.is_featured
               )
               order by t.is_featured desc, t.display_order asc, t.created_at desc
             ), '[]'::jsonb)
      into v_items
      from (
        select * from public.kian_testimonials
        where status = 'approved'
        order by is_featured desc, display_order asc, created_at desc
        limit v_lim
      ) t;
  end if;
  return jsonb_build_object('enabled', v_enabled, 'items', v_items);
end $$;
revoke execute on function public.kian_public_testimonials(int) from public;
grant  execute on function public.kian_public_testimonials(int) to anon, authenticated;

-- ─── 5) استقبال عام (anon) — تحقّق + Rate-Limit على IP + إدراج pending ───
create or replace function public.kian_submit_testimonial(
  p_name text, p_body text,
  p_title text default null, p_company text default null,
  p_rating int default null, p_lang text default 'ar',
  p_project_ref text default null, p_consent boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_lang text := lower(coalesce(nullif(btrim(p_lang), ''), 'ar'));
  v_ip   text := public.civ_client_ip();
  v_ua   text;
  v_recent int;
  v_id   uuid;
begin
  -- تحقّق المدخلات (رسائل أخطاء بمفاتيح ثابتة يترجمها العميل).
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'name_invalid'; end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then raise exception 'body_invalid'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'rating_invalid'; end if;
  if v_lang not in ('ar','en') then v_lang := 'ar'; end if;
  if p_consent is not true then raise exception 'consent_required'; end if;

  -- Rate-Limit: 3 إرساليات كحد أقصى من نفس الـ IP خلال ساعة (حين يتوفّر IP).
  if v_ip is not null then
    select count(*) into v_recent from public.kian_testimonials
     where submitted_ip = v_ip and created_at > now() - interval '1 hour';
    if v_recent >= 3 then raise exception 'rate_limited'; end if;
  end if;

  begin v_ua := left((current_setting('request.headers', true)::json)->>'user-agent', 400);
  exception when others then v_ua := null; end;

  insert into public.kian_testimonials
    (client_name, client_title, company, rating, body, lang, project_ref,
     source, status, consent, submitted_ip, submitted_ua)
  values
    (v_name, nullif(btrim(coalesce(p_title,'')),''), nullif(btrim(coalesce(p_company,'')),''),
     p_rating, v_body, v_lang, nullif(btrim(coalesce(p_project_ref,'')),''),
     'public_form', 'pending', true, v_ip, v_ua)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function public.kian_submit_testimonial(text,text,text,text,int,text,text,boolean) from public;
grant  execute on function public.kian_submit_testimonial(text,text,text,text,int,text,text,boolean) to anon, authenticated;

-- ─── 6) إعدادات/عدّادات الاعتدال (get) — لمن يملك الإدارة ───
create or replace function public.kian_testimonials_admin_settings()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pending int; v_approved int; v_enabled boolean;
begin
  if not public.civ_can_manage() then raise exception 'not_authorized'; end if;
  v_enabled := public.civ_flag('testimonials_enabled');
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'approved')
    into v_pending, v_approved
    from public.kian_testimonials;
  return jsonb_build_object('enabled', v_enabled, 'pending', v_pending, 'approved', v_approved);
end $$;
revoke execute on function public.kian_testimonials_admin_settings() from public, anon;
grant  execute on function public.kian_testimonials_admin_settings() to authenticated;

-- ─── 7) تفعيل/تعطيل العرض العام — أدمن فقط (بوابة أعلى للنشر العام) ───
create or replace function public.kian_testimonials_set_enabled(p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_admin() then raise exception 'not_authorized'; end if;
  if p_enabled is null then raise exception 'enabled_required'; end if;
  update public.custody_enterprise_settings
     set testimonials_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where id = 1;
  perform public.custody_audit('testimonials_display_toggled', 'kian_testimonials', null,
                               jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end $$;
revoke execute on function public.kian_testimonials_set_enabled(boolean) from public, anon;
grant  execute on function public.kian_testimonials_set_enabled(boolean) to authenticated;

-- ─── 8) اعتدال: تغيير الحالة (approve/reject/hide/pending) — إدارة ───
create or replace function public.kian_testimonials_moderate(
  p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.kian_testimonials;
begin
  if not public.civ_can_manage() then raise exception 'not_authorized'; end if;
  if p_status not in ('pending','approved','rejected','hidden') then raise exception 'status_invalid'; end if;
  update public.kian_testimonials
     set status = p_status,
         reject_reason = case when p_status = 'rejected' then nullif(btrim(coalesce(p_reason,'')),'') else null end,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_id
  returning * into v_row;
  if v_row.id is null then raise exception 'not_found'; end if;
  perform public.custody_audit('testimonial_moderated', 'kian_testimonials', p_id,
                               jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end $$;
revoke execute on function public.kian_testimonials_moderate(uuid,text,text) from public, anon;
grant  execute on function public.kian_testimonials_moderate(uuid,text,text) to authenticated;

-- ─── 9) اعتدال: تمييز/ترتيب العرض — إدارة ───
create or replace function public.kian_testimonials_set_feature(
  p_id uuid, p_featured boolean, p_order int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.kian_testimonials;
begin
  if not public.civ_can_manage() then raise exception 'not_authorized'; end if;
  update public.kian_testimonials
     set is_featured = coalesce(p_featured, is_featured),
         display_order = coalesce(p_order, display_order),
         updated_at = now()
   where id = p_id
  returning * into v_row;
  if v_row.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke execute on function public.kian_testimonials_set_feature(uuid,boolean,int) from public, anon;
grant  execute on function public.kian_testimonials_set_feature(uuid,boolean,int) to authenticated;

-- ─── 10) إضافة يدوية من الإدارة (تُنشر مباشرة معتمدة) ───
create or replace function public.kian_testimonials_admin_create(
  p_name text, p_body text,
  p_title text default null, p_company text default null,
  p_rating int default null, p_lang text default 'ar',
  p_project_ref text default null, p_featured boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name,''));
  v_body text := btrim(coalesce(p_body,''));
  v_lang text := lower(coalesce(nullif(btrim(p_lang),''),'ar'));
  v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not_authorized'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'name_invalid'; end if;
  if char_length(v_body) < 10 or char_length(v_body) > 2000 then raise exception 'body_invalid'; end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then raise exception 'rating_invalid'; end if;
  if v_lang not in ('ar','en') then v_lang := 'ar'; end if;

  insert into public.kian_testimonials
    (client_name, client_title, company, rating, body, lang, project_ref,
     source, status, is_featured, consent, reviewed_by, reviewed_at)
  values
    (v_name, nullif(btrim(coalesce(p_title,'')),''), nullif(btrim(coalesce(p_company,'')),''),
     p_rating, v_body, v_lang, nullif(btrim(coalesce(p_project_ref,'')),''),
     'admin', 'approved', coalesce(p_featured,false), true, auth.uid(), now())
  returning id into v_id;
  perform public.custody_audit('testimonial_admin_created', 'kian_testimonials', v_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function public.kian_testimonials_admin_create(text,text,text,text,int,text,text,boolean) from public, anon;
grant  execute on function public.kian_testimonials_admin_create(text,text,text,text,int,text,text,boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (تظهر نتائجها بعد التشغيل — لا تعدّل شيئًا)
select 'flag_column'   as k, count(*) from information_schema.columns
  where table_schema='public' and table_name='custody_enterprise_settings' and column_name='testimonials_enabled';
select 'table'         as k, count(*) from information_schema.tables
  where table_schema='public' and table_name='kian_testimonials';
select 'rls_enabled'   as k, relrowsecurity from pg_class where oid='public.kian_testimonials'::regclass;
select 'rpcs'          as k, count(*) from pg_proc where proname in (
  'kian_public_testimonials','kian_submit_testimonial','kian_testimonials_admin_settings',
  'kian_testimonials_set_enabled','kian_testimonials_moderate','kian_testimonials_set_feature',
  'kian_testimonials_admin_create');
select 'anon_grants'   as k, p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
  from pg_proc p where p.proname in ('kian_public_testimonials','kian_submit_testimonial');
select 'flag_default'  as k, testimonials_enabled from public.custody_enterprise_settings where id=1;
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (لا يعمل باللصق — انسخه يدويًا عند الحاجة فقط. غير مدمّر للبيانات:
-- يُبقي الجدول والبيانات، يزيل فقط الدوال والعمود إن أردت تراجعًا كاملًا.)
-- begin;
--   drop function if exists public.kian_public_testimonials(int);
--   drop function if exists public.kian_submit_testimonial(text,text,text,text,int,text,text,boolean);
--   drop function if exists public.kian_testimonials_admin_settings();
--   drop function if exists public.kian_testimonials_set_enabled(boolean);
--   drop function if exists public.kian_testimonials_moderate(uuid,text,text);
--   drop function if exists public.kian_testimonials_set_feature(uuid,boolean,int);
--   drop function if exists public.kian_testimonials_admin_create(text,text,text,text,int,text,text,boolean);
--   -- الجدول والعمود يُتركان عمدًا (لا حذف بيانات). لإزالة العمود يدويًا:
--   -- alter table public.custody_enterprise_settings drop column if exists testimonials_enabled;
-- commit;
-- ════════════════════════════════════════════════════════════════════════════
