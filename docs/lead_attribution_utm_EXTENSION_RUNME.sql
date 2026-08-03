-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 1 · V2-1.6-C · التقاط مصدر الطلب (UTM / Attribution)
-- docs/lead_attribution_utm_EXTENSION_RUNME.sql
--
-- ⚠️ لم يُشغَّل. أُنشئ كملف فقط (MASTER_BRIEF_v2.1.md §2 G2).
-- الترتيب: §0 PREFLIGHT مدمج → هذا الملف → lead_attribution_utm_EXTENSION_POSTCHECK.sql
-- التراجع: lead_attribution_utm_EXTENSION_ROLLBACK.sql
--
-- ★ ما يفعله ★
--   (١) سبعة أعمدة **امتداد** على `public.public_intake` القائم — لا جدول جديد (G13-4).
--   (٢) دالّة `public_intake_set_attribution` **منفصلة** لا تمسّ `capture_public_intake`.
--
-- ★ لماذا دالّة ثانية ★ نفس سبب حزمة الموافقة حرفيًا: PostgREST يحلّ الدوال
--   **بأسماء المعاملات**، فإضافة `p_utm_*` إلى دالّة الالتقاط تجعل **كل إرسال عام
--   يفشل بـPGRST202** بين نشر الكود وتشغيل هذا الملف. الفصل يجعل الكود يسبق SQL بأمان.
--
-- ★ خصوصية ★ لا بيانات شخصية هنا: تسميات حملات + أصل الإحالة (origin فقط، بلا
--   مسار ولا query — رابط الإحالة الكامل قد يحمل بيانات مستخدم موقع آخر).
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ §0 · PREFLIGHT ═════════════════════════════════════════════════════════
do $pf$
declare miss text := '';
begin
  if to_regclass('public.public_intake') is null then miss := miss || ' table:public_intake'; end if;
  if to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is null then
    miss := miss || ' fn:capture_public_intake/14';
  end if;
  if miss <> '' then
    raise exception 'PREFLIGHT فشل — اعتماديات مفقودة:%', miss;
  end if;
end $pf$;

begin;

-- ═══ §1 · أعمدة الامتداد ════════════════════════════════════════════════════
-- كلها nullable بلا DEFAULT: NULL يعني «لم يصل مصدر»، وهو ليس «مصدر مباشر».
-- الصفوف التاريخية لم يكن يُلتقط لها مصدر أصلًا، فادّعاء أي قيمة لها تزوير.
alter table public.public_intake add column if not exists utm_source   text;
alter table public.public_intake add column if not exists utm_medium   text;
alter table public.public_intake add column if not exists utm_campaign text;
alter table public.public_intake add column if not exists utm_term     text;
alter table public.public_intake add column if not exists utm_content  text;
alter table public.public_intake add column if not exists referrer     text;
alter table public.public_intake add column if not exists landing_path text;

comment on column public.public_intake.referrer is
  'V2-1.6-C. أصل الإحالة فقط (origin) — لا مسار ولا query.';
comment on column public.public_intake.landing_path is
  'V2-1.6-C. مسار الصفحة التي أُرسل منها النموذج — بلا query ولا hash.';

-- ═══ §2 · الدالّة ═══════════════════════════════════════════════════════════
create or replace function public.public_intake_set_attribution(
  p_intake_id    uuid,
  p_utm_source   text,
  p_utm_medium   text,
  p_utm_campaign text,
  p_utm_term     text,
  p_utm_content  text,
  p_referrer     text,
  p_landing_path text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_intake_id is null then return false; end if;

  -- أول إسناد يثبت: زيارة لاحقة بلا وسوم يجب ألّا تمحو الحملة التي جاء منها.
  update public.public_intake
     set utm_source   = coalesce(utm_source,   nullif(btrim(p_utm_source),   '')),
         utm_medium   = coalesce(utm_medium,   nullif(btrim(p_utm_medium),   '')),
         utm_campaign = coalesce(utm_campaign, nullif(btrim(p_utm_campaign), '')),
         utm_term     = coalesce(utm_term,     nullif(btrim(p_utm_term),     '')),
         utm_content  = coalesce(utm_content,  nullif(btrim(p_utm_content),  '')),
         referrer     = coalesce(referrer,     nullif(btrim(p_referrer),     '')),
         landing_path = coalesce(landing_path, nullif(btrim(p_landing_path), '')),
         updated_at   = now()
   where id = p_intake_id;

  return found;
end $$;

revoke execute on function public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text) to service_role;

-- ═══ §3 · RLS — لا سياسة جديدة ══════════════════════════════════════════════
-- سياسة الصفّ القائمة (`public_intake_read`) تغطّي الأعمدة الجديدة تلقائيًا.
-- ❌ سياسة قراءة ثانية تُوسّع الوصول لا تُضيّقه.
do $rls$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.public_intake'::regclass) then
    raise exception 'فشل: RLS غير مفعّلة على public_intake';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema='public' and table_name='public_intake'
       and grantee in ('anon','public') and privilege_type='SELECT'
  ) then
    raise exception 'فشل: anon يملك SELECT على public_intake';
  end if;
end $rls$;

-- ═══ §4 · فحص ذاتي ══════════════════════════════════════════════════════════
do $v$
declare miss text := '';
begin
  foreach miss in array array['utm_source','utm_medium','utm_campaign','utm_term','utm_content','referrer','landing_path'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='public_intake' and column_name=miss) then
      raise exception 'فشل: العمود % مفقود بعد التطبيق', miss;
    end if;
  end loop;

  if to_regprocedure('public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)') is null then
    raise exception 'فشل: public_intake_set_attribution غير موجودة بعد التطبيق';
  end if;

  -- ★ الأهمّ ★ مسار الالتقاط القائم لم يُمَسّ.
  if to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is null then
    raise exception 'فشل خطير: توقيع capture_public_intake تغيّر — كل إرسال عام سينكسر';
  end if;

  if has_function_privilege('anon','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute')
     or has_function_privilege('authenticated','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute') then
    raise exception 'فشل أمني: anon أو authenticated يملك التنفيذ';
  end if;
  if not has_function_privilege('service_role','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute') then
    raise exception 'فشل: service_role لا يملك التنفيذ';
  end if;

  raise notice 'ATTRIBUTION EXTENSION: نجح — ٧ أعمدة امتداد + دالّة إلحاق واحدة، capture_public_intake سليمة، RLS القائمة تغطّي الأعمدة، والصلاحية لـservice_role وحده.';
end $v$;

commit;
